/**
 * POST /api/nw-trigger-check
 *
 * The FHA uploader calls this after every successful HUD file upload. When
 * all 5 HUD slot folders for a given month contain at least one file, we
 * enqueue an Automation Anywhere WLM work item that fires the
 * Neighborhood Watch report bot. The bot POSTs its results back to the
 * existing `/api/files/{month}/enc-data` endpoint when it's done.
 *
 * Request body:
 *   { month: "YYYY-MM", force?: boolean }
 *
 * Response shapes (all HTTP 200 unless otherwise noted):
 *   { triggered:false, disabled:true }              — feature flag off
 *   { triggered:false, missing:[…slotSlugs] }       — some slots empty
 *   { triggered:false, alreadyTriggered:true, month } — marker exists (auto-trigger only)
 *   { triggered:true, month, aaWorkItemId?, message, forced? } — bot enqueued
 *   { triggered:false, error:"…", correlationId } (500) — auth/enqueue fail
 *
 * When `force: true` is set on the POST body, the marker-blob idempotency
 * check is skipped (the marker is deleted and rewritten after a successful
 * enqueue). The completeness check is NOT bypassed — force still requires
 * all 5 HUD slots to be present.
 *
 * GET /api/nw-trigger-check?month=YYYY-MM
 *
 * Lightweight status probe used by the FileUploads UI to decide whether
 * to enable the "Manually trigger" button and whether to warn about
 * clobbering an existing enc-data blob. Never touches AA.
 *
 *   { month, allSlotsComplete:boolean, missing:string[], encDataExists:boolean }
 *
 * Idempotency:
 *   After a successful enqueue we write a zero-byte marker blob at
 *   `uploads/{month}/.nw-triggered`. Its metadata records the timestamp
 *   and (when AA returned one) the workItemId. If the marker exists we
 *   short-circuit — the UI treats that as silent success.
 *
 * Auth model:
 *   - The SWA `public/staticwebapp.config.json` route rule requires
 *     `authenticated` role via Entra SSO for `/api/nw-trigger-check`.
 *     Unlike `/api/files/*` (which is API-key-only so RPA can reach it),
 *     this endpoint is only ever called by a signed-in human's browser
 *     right after they upload the 5th HUD file.
 *   - Inside the Function we do NOT re-check the SWA principal against
 *     the upload allowlist. The endpoint is idempotent and side-effect
 *     safe (marker prevents replays), and Michael's live testing needs
 *     the ability to poke it manually.
 *
 * Never logged or returned to the client:
 *   AA_API_KEY, AA auth tokens, or the response bodies from AA that
 *   might contain them. `aa-client.js` + `rpa-failure-email.js` both
 *   redact those fields before they leave this module.
 */
const crypto = require('crypto');
const { BlobServiceClient } = require('@azure/storage-blob');

const aaClient = require('../lib/aa-client');
const { sendFailureEmail } = require('../lib/rpa-failure-email');

// Must match `api/upload-sas/index.js` CATEGORY_SLUGS exactly. See the
// note in that file about the truth being duplicated across TS and JS —
// the smoke test for upload-sas locks that Set to these 5 slugs, so we
// can hard-code the same list here safely.
const REQUIRED_SLOTS = Object.freeze([
  'hud-branches',
  'hoc-compare-ratios',
  'nw-data',
  'hud-total-compare-ratios',
  'hud-field-office',
]);

const MARKER_BLOB_NAME_SUFFIX = '.nw-triggered';
const ENC_DATA_PREFIX = 'enc-data';
const MONTH_RE = /^(\d{4})-(\d{2})$/;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function jsonResponse(context, status, body) {
  context.res = {
    status,
    headers: { 'Content-Type': 'application/json' },
    body,
  };
}

function validateMonth(raw) {
  if (typeof raw !== 'string') return null;
  const m = MONTH_RE.exec(raw.trim());
  if (!m) return null;
  const mm = parseInt(m[2], 10);
  if (mm < 1 || mm > 12) return null;
  return `${m[1]}-${m[2]}`;
}

function monthNameFor(monthStr) {
  const [y, m] = monthStr.split('-');
  const idx = parseInt(m, 10) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx > 11) return monthStr;
  return `${MONTH_NAMES[idx]} ${y}`;
}

/**
 * Build a mapping of slot → { count, latestName, latestSize, latestUploadedAt }
 * by listing blobs under `{month}/{slot}/` for each of the 5 required slots.
 * A slot is considered "present" iff count >= 1.
 */
async function scanMonth({ containerClient, month, blobClientFactory }) {
  const summary = {};
  const missing = [];

  for (const slot of REQUIRED_SLOTS) {
    const prefix = `${month}/${slot}/`;
    let count = 0;
    let latestName;
    let latestSize;
    let latestUploadedAt;
    let latestTs = -Infinity;

    // (blobClientFactory only used by unit test harness — normal path
    //  goes through containerClient.listBlobsFlat.)
    const iter = (blobClientFactory && blobClientFactory(prefix)) ||
      containerClient.listBlobsFlat({ prefix });
    for await (const blob of iter) {
      // Guard: skip anything that looks like a sub-folder marker (blobs
      // whose "name after the prefix" contains a `/`). Real files sit
      // directly under `{month}/{slot}/`.
      const rest = blob.name.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      count += 1;
      const props = blob.properties || {};
      const uploadedAt = props.lastModified
        ? new Date(props.lastModified).toISOString()
        : null;
      const ts = props.lastModified ? new Date(props.lastModified).getTime() : 0;
      if (ts > latestTs) {
        latestTs = ts;
        latestName = rest;
        latestSize = props.contentLength ?? null;
        latestUploadedAt = uploadedAt;
      }
    }

    summary[slot] = { count, latestName, latestSize, latestUploadedAt };
    if (count === 0) missing.push(slot);
  }

  return { summary, missing };
}

async function markerExists(containerClient, month) {
  const blobClient = containerClient.getBlobClient(`${month}/${MARKER_BLOB_NAME_SUFFIX}`);
  try {
    return await blobClient.exists();
  } catch (_e) {
    return false;
  }
}

async function deleteMarker(containerClient, month) {
  const blobClient = containerClient.getBlobClient(`${month}/${MARKER_BLOB_NAME_SUFFIX}`);
  try {
    if (typeof blobClient.deleteIfExists === 'function') {
      await blobClient.deleteIfExists();
    } else if (typeof blobClient.delete === 'function') {
      // Fallback for older SDK / test fakes: exists+delete.
      const exists = await blobClient.exists();
      if (exists) await blobClient.delete();
    }
  } catch (_e) {
    // Non-fatal: marker will be overwritten by writeMarker.
  }
}

/**
 * Check whether any blob exists under `uploads/{month}/enc-data/`.
 * Used by the GET status probe to warn the UI that a manual re-trigger
 * would overwrite an existing Neighborhood Watch report.
 */
async function encDataExists({ containerClient, month, blobClientFactory }) {
  const prefix = `${month}/${ENC_DATA_PREFIX}/`;
  const iter = (blobClientFactory && blobClientFactory(prefix)) ||
    containerClient.listBlobsFlat({ prefix });
  for await (const blob of iter) {
    const rest = blob.name.slice(prefix.length);
    if (!rest) continue;
    return true;
  }
  return false;
}

async function writeMarker(containerClient, month, { workItemId, correlationId }) {
  const blockClient = containerClient.getBlockBlobClient(`${month}/${MARKER_BLOB_NAME_SUFFIX}`);
  const now = new Date().toISOString();
  const metadata = {
    triggeredAt: now,
    correlationId: correlationId || '',
  };
  if (workItemId) metadata.aaWorkItemId = String(workItemId);
  await blockClient.upload('', 0, {
    metadata,
    blobHTTPHeaders: { blobContentType: 'application/x-nw-trigger-marker' },
  });
  return { triggeredAt: now };
}

function getContainerClient() {
  const connStr = process.env.UPLOADS_STORAGE_CONNECTION;
  const containerName = process.env.UPLOADS_CONTAINER || 'uploads';
  if (!connStr) throw new Error('UPLOADS_STORAGE_CONNECTION is not set');
  const svc = BlobServiceClient.fromConnectionString(connStr);
  return svc.getContainerClient(containerName);
}

/**
 * Core handler split out for testability: callers can inject
 *   deps.containerClient  — replaces the real blob container
 *   deps.aa               — { authenticate, enqueueWorkItem }
 *   deps.emailSender      — replaces the real email module
 *   deps.now              — timestamp source
 *   deps.uuid             — correlation id source
 */
async function handleRequest(context, req, deps = {}) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse(context, 405, { error: 'method_not_allowed' });
  }

  // GET status probe — validates the month and returns
  // { allSlotsComplete, missing, encDataExists } without touching AA.
  if (req.method === 'GET') {
    const monthRaw = (req.query && req.query.month) || (req.params && req.params.month);
    const monthG = validateMonth(monthRaw);
    if (!monthG) {
      return jsonResponse(context, 400, {
        error: 'invalid_month',
        message: 'month query parameter must be a "YYYY-MM" string with a 01..12 month part.',
      });
    }

    let cc;
    try {
      cc = deps.containerClient || getContainerClient();
    } catch (err) {
      context.log.error(`nw-trigger-check GET: ${err.message}`);
      return jsonResponse(context, 500, { error: 'server_misconfigured' });
    }

    const scan = await scanMonth({
      containerClient: cc,
      month: monthG,
      blobClientFactory: deps.blobClientFactory,
    });
    const enc = await encDataExists({
      containerClient: cc,
      month: monthG,
      blobClientFactory: deps.encBlobClientFactory || deps.blobClientFactory,
    });
    return jsonResponse(context, 200, {
      month: monthG,
      allSlotsComplete: scan.missing.length === 0,
      missing: scan.missing,
      encDataExists: enc,
    });
  }

  // Feature flag short-circuit — never touch AA if disabled.
  if (process.env.RPA_TRIGGER_ENABLED !== 'true') {
    return jsonResponse(context, 200, { triggered: false, disabled: true });
  }

  const month = validateMonth(req.body && req.body.month);
  if (!month) {
    return jsonResponse(context, 400, {
      error: 'invalid_month',
      message: 'month must be a "YYYY-MM" string with a 01..12 month part.',
    });
  }

  const force = !!(req.body && req.body.force === true);

  let containerClient;
  try {
    containerClient = deps.containerClient || getContainerClient();
  } catch (err) {
    context.log.error(`nw-trigger-check: ${err.message}`);
    return jsonResponse(context, 500, { error: 'server_misconfigured' });
  }

  // 1) Completeness check — NOT bypassed by force.
  const { summary, missing } = await scanMonth({
    containerClient,
    month,
    blobClientFactory: deps.blobClientFactory,
  });
  if (missing.length > 0) {
    return jsonResponse(context, 200, { triggered: false, month, missing });
  }

  // 2) Idempotency — skipped when force=true.
  if (!force && (await markerExists(containerClient, month))) {
    return jsonResponse(context, 200, {
      triggered: false,
      alreadyTriggered: true,
      month,
    });
  }

  // 3) AA auth + enqueue
  const aa = deps.aa || aaClient;
  const timestamp = (deps.now && deps.now()) || new Date().toISOString();
  const correlationId = (deps.uuid && deps.uuid()) || crypto.randomUUID();
  const aaQueueId = process.env.AA_QUEUE_ID;
  const dateColumn = process.env.AA_DATE_COLUMN || 'Date';
  const dateValue = `${month}-01`;

  // Fail fast on missing critical config (mirrors upload-sas pattern).
  const crUrl = process.env.AA_CR_URL;
  const username = process.env.AA_USERNAME;
  const apiKey = process.env.AA_API_KEY;
  if (!crUrl || !username || !apiKey || !aaQueueId) {
    context.log.error(
      `nw-trigger-check: AA config missing (crUrl=${!!crUrl}, username=${!!username}, apiKey=${!!apiKey}, queueId=${!!aaQueueId}) corr=${correlationId}`,
    );
    await tryEmail(context, deps, {
      month,
      timestamp,
      correlationId,
      phase: 'other',
      httpStatus: null,
      responseBody: 'AA_* environment variables not fully configured',
      slotSummary: summary,
    });
    return jsonResponse(context, 500, {
      triggered: false,
      error: 'aa_config_missing',
      correlationId,
    });
  }

  let token;
  try {
    token = await aa.authenticate({ crUrl, username, apiKey });
  } catch (err) {
    const phase = err.phase || 'auth';
    context.log.error(
      `nw-trigger-check: AA authenticate failed phase=${phase} status=${err.status ?? 'n/a'} corr=${correlationId}`,
    );
    await tryEmail(context, deps, {
      month,
      timestamp,
      correlationId,
      phase,
      httpStatus: err.status,
      responseBody: err.body || err.message,
      slotSummary: summary,
    });
    return jsonResponse(context, 500, {
      triggered: false,
      error: 'aa_auth_failed',
      correlationId,
    });
  }

  let enqueueResult;
  try {
    enqueueResult = await aa.enqueueWorkItem({
      crUrl,
      token,
      queueId: aaQueueId,
      dateColumn,
      dateValue,
    });
  } catch (err) {
    const phase = err.phase || 'enqueue';
    context.log.error(
      `nw-trigger-check: AA enqueue failed phase=${phase} status=${err.status ?? 'n/a'} corr=${correlationId}`,
    );
    await tryEmail(context, deps, {
      month,
      timestamp,
      correlationId,
      phase,
      httpStatus: err.status,
      responseBody: err.body || err.message,
      slotSummary: summary,
    });
    return jsonResponse(context, 500, {
      triggered: false,
      error: 'aa_enqueue_failed',
      correlationId,
    });
  }

  // 4) Marker write happens ONLY after AA succeeds.
  //    When force=true, delete any existing marker first so the fresh
  //    marker's timestamp reflects the manual re-trigger.
  if (force) {
    await deleteMarker(containerClient, month);
  }
  try {
    await writeMarker(containerClient, month, {
      workItemId: enqueueResult && enqueueResult.aaWorkItemId,
      correlationId,
    });
  } catch (err) {
    // Marker write failure is not fatal for the trigger, but it means
    // a subsequent upload could retrigger the bot. Surface loudly.
    context.log.error(
      `nw-trigger-check: marker write failed after successful AA enqueue: ${err.message} corr=${correlationId}`,
    );
  }

  context.log.info(
    `nw-trigger-check: enqueued month=${month} workItemId=${enqueueResult && enqueueResult.aaWorkItemId ? enqueueResult.aaWorkItemId : 'n/a'} forced=${force} corr=${correlationId}`,
  );

  return jsonResponse(context, 200, {
    triggered: true,
    month,
    ...(enqueueResult && enqueueResult.aaWorkItemId
      ? { aaWorkItemId: enqueueResult.aaWorkItemId }
      : {}),
    ...(force ? { forced: true } : {}),
    message: force
      ? `Neighborhood Watch bot re-enqueued for ${monthNameFor(month)}.`
      : `Neighborhood Watch bot enqueued for ${monthNameFor(month)}.`,
  });
}

async function tryEmail(context, deps, params) {
  const sender = (deps.emailSender && deps.emailSender.sendFailureEmail) || sendFailureEmail;
  try {
    await sender(context, {
      ...params,
      monthName: monthNameFor(params.month),
      aaQueueId: process.env.AA_QUEUE_ID || '(unset)',
    });
  } catch (err) {
    context.log.error(
      `nw-trigger-check: failure email sender threw: ${err.message} corr=${params.correlationId}`,
    );
  }
}

module.exports = async function (context, req) {
  try {
    await handleRequest(context, req);
  } catch (err) {
    context.log.error(`nw-trigger-check: unhandled error: ${err.stack || err.message}`);
    jsonResponse(context, 500, {
      triggered: false,
      error: 'internal_error',
    });
  }
};

// Test surface — matches the pattern used by upload-sas/index.js.
module.exports.handleRequest = handleRequest;
module.exports.REQUIRED_SLOTS = REQUIRED_SLOTS;
module.exports._internals = { validateMonth, monthNameFor, scanMonth, markerExists, deleteMarker, encDataExists };
