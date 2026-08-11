/**
 * POST /api/regenerate-risk-factor-bullets
 *
 * On-demand regenerate path for the Portfolio Risk Factor bullets baked
 * into each monthly snapshot by `scripts/build-snapshot.py :: build_risk_factor_bullets()`
 * (PR #70, PR A of 2). This is PR B: the write-back sibling.
 *
 * Request body (JSON):
 *   {
 *     "period": "YYYY-MM",              // required — target snapshot
 *     "facts": "…",                     // required — the assembled facts string
 *                                       //   the frontend already builds for the
 *                                       //   generic /api/ai-analysis path (see
 *                                       //   src/lib/aiAnalysis.ts :: buildDataSummary).
 *                                       //   Passing it in from the client keeps the
 *                                       //   endpoint slim and avoids re-doing the
 *                                       //   full ~500-line _build_risk_factor_facts()
 *                                       //   port from build-snapshot.py.
 *     "snapshot_facts_hash": "…"        // optional, currently ignored — reserved for
 *                                       //   future stale-facts detection.
 *   }
 *
 * Behavior:
 *   1. Auth — reads `X-MS-CLIENT-PRINCIPAL` (base64-encoded JSON injected by
 *      SWA). On missing/malformed principal → 401. The parsed `oid` claim is
 *      stored as `risk_factor_bullets.regenerated_by` in the written snapshot.
 *   2. System prompt — loaded from `data/prompts/risk-factor-analysis.system.md`.
 *      Falls back to an INLINE COPY only if the file read fails; a WARN is
 *      logged in that case so drift from the shared prompt is visible.
 *   3. Azure OpenAI — POST to the same deployment as `/api/ai-analysis`, using
 *      the same env vars (AZURE_OPENAI_ENDPOINT / DEPLOYMENT / API_KEY /
 *      API_VERSION). Response is JSON-mode `{ executiveSummary: [...] }`.
 *   4. Blob read/write — reads `stafnfhauploads/snapshots/{period}.json`,
 *      captures its ETag, mutates `risk_factor_bullets.bullets`,
 *      `regenerated_at`, `regenerated_by`, and (if absent) `generated_at` /
 *      `generated_by`, then writes back with `If-Match: <etag>` for
 *      last-writer-wins conflict detection (→ 409).
 *
 * Response 200:
 *   {
 *     "bullets": [ { text, severity }, … ],
 *     "regenerated_at": "2026-08-11T…",
 *     "regenerated_by": "<entra oid>"
 *   }
 *
 * Auth is enforced at the SWA route layer (see public/staticwebapp.config.json);
 * `authLevel: anonymous` on the function binding means SWA is the sole gate.
 */
const fs = require('fs');
const path = require('path');
const { BlobServiceClient } = require('@azure/storage-blob');

const SNAPSHOTS_CONTAINER =
  process.env.SNAPSHOTS_CONTAINER || 'snapshots';
const PERIOD_RE = /^\d{4}-\d{2}$/;
const VALID_SEVERITIES = new Set(['red', 'yellow', 'green', 'neutral']);
const SCHEMA_VERSION = 1;
const GENERATED_BY_TAG = 'api/regenerate-risk-factor-bullets v1.0';

// Inline fallback of data/prompts/risk-factor-analysis.system.md. Kept only
// as a last-resort copy so a missing prompt file doesn't take the endpoint
// down. If this string ever diverges from the file, ATLAS/Michael will see
// the WARN log line and can pin a fix.
const INLINE_FALLBACK_PROMPT = `You are a senior FHA risk analyst preparing an executive summary and action items for the HUD Compare Ratio Committee at American Financial Network (AFN).

The dashboard UI already shows termination risk office cards, credit watch count, DPA concentration, channel gap, and HUD enforcement note in dedicated visual sections. DO NOT repeat any of those topics.

Your executive summary bullets should ONLY cover the DEEP TREND ANALYSIS from the underwriting and risk factor data. Focus exclusively on:
1-8. DEEP TREND ANALYSIS — analyze the underwriting and risk factor data to identify:
   - Which risk factors have the strongest correlation with delinquency (e.g., Source of Funds: Secured Borrowed at 9.7% vs Borrower Funds at 3.1%)
   - Manual underwriting vs auto-approved DQ rate differences and what that implies
   - LTV concentration risk (high-LTV loans and their DQ rates)
   - First-time homebuyer risk patterns
   - DTI threshold effects on delinquency
   - Payment shock patterns
   - Risk indicator layering (how DQ rate escalates with more risk indicators)
   - Reserves adequacy — which reserve levels show elevated default
   - Any surprising findings or combinations that stand out
   Each trend bullet should reference specific numbers and state the risk implication.

Keep bullets concise (1-2 sentences). Use the exact same language patterns shown above.

For action items, classify as:
- immediate: needs action this week (e.g., respond to QC findings, prepare HUD responses)
- monitoring: ongoing tracking required
- strategic: longer-term process/policy changes

Return your response as JSON with this exact structure:
{
  "executiveSummary": [
    { "text": "...", "severity": "red|yellow|green|neutral" }
  ],
  "actionItems": [
    { "text": "...", "category": "immediate|monitoring|strategic", "assignee": "optional team/person" }
  ]
}

Generate the executive summary bullets following the structure above, and 6-10 action items focused on what the committee needs to decide and act on.`;

function jsonResponse(context, status, body, extraHeaders) {
  context.res = {
    status,
    headers: Object.assign(
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      extraHeaders || {},
    ),
    body,
  };
}

/**
 * Load the shared system prompt from
 * `data/prompts/risk-factor-analysis.system.md`. Returns `{ prompt, source }`.
 * On any read failure returns the inline fallback and logs a WARN so we
 * never silently succeed with a divergent prompt.
 */
function loadSystemPrompt(context) {
  // The SWA `api/` folder is deployed one level below the repo root. The
  // shared prompt lives at `data/prompts/…` at the repo root, so it's
  // `../../data/prompts/…` relative to this file (`api/regenerate-.../index.js`).
  const candidates = [
    path.resolve(__dirname, '..', '..', 'data', 'prompts', 'risk-factor-analysis.system.md'),
    // Fallback candidate — some SWA build layouts flatten `api/` next to the
    // repo root instead of nesting it. Try one level up too.
    path.resolve(__dirname, '..', 'data', 'prompts', 'risk-factor-analysis.system.md'),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      // Strip leading HTML/Markdown comment block used to document the file
      // (see data/prompts/risk-factor-analysis.system.md). Everything after
      // the first `-->` is the actual prompt.
      const closeIdx = raw.indexOf('-->');
      const prompt = (closeIdx >= 0 ? raw.slice(closeIdx + 3) : raw).trim();
      if (prompt.length > 0) return { prompt, source: p };
    } catch (_err) {
      // Try the next candidate.
    }
  }
  context.log.warn(
    'regenerate-risk-factor-bullets: could not load shared prompt from ' +
      candidates.join(' | ') +
      ' — falling back to inline copy (drift possible).',
  );
  return { prompt: INLINE_FALLBACK_PROMPT, source: '<inline-fallback>' };
}

/**
 * Parse the SWA-injected `X-MS-CLIENT-PRINCIPAL` header. Returns
 * `{ ok, oid, principal }` on success or `{ ok: false, reason }` on any
 * failure. Never throws.
 */
function parseClientPrincipal(req) {
  const headers = (req && req.headers) || {};
  // Header keys arrive lowercased in Azure Functions HTTP triggers.
  const b64 =
    headers['x-ms-client-principal'] ||
    headers['X-MS-CLIENT-PRINCIPAL'] ||
    null;
  if (!b64) {
    return { ok: false, reason: 'missing_principal_header' };
  }
  let jsonText;
  try {
    jsonText = Buffer.from(String(b64), 'base64').toString('utf8');
  } catch (_e) {
    return { ok: false, reason: 'principal_base64_decode_failed' };
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (_e) {
    return { ok: false, reason: 'principal_json_parse_failed' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'principal_not_object' };
  }
  const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
  // Entra's stable object ID is emitted under either the AAD claim URI or
  // the short "oid" alias depending on SWA version.
  const oidClaim = claims.find(
    (c) =>
      c &&
      (c.typ === 'oid' ||
        c.typ ===
          'http://schemas.microsoft.com/identity/claims/objectidentifier'),
  );
  const oid =
    (oidClaim && oidClaim.val) || parsed.userId || parsed.userDetails || null;
  if (!oid) {
    return { ok: false, reason: 'principal_missing_oid' };
  }
  return { ok: true, oid: String(oid), principal: parsed };
}

async function streamToBuffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (d) =>
      chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)),
    );
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

/**
 * Normalize one bullet from the model — drop invalid entries, coerce
 * severity to the allowed enum. Mirrors _normalize_risk_factor_bullet()
 * in scripts/build-snapshot.py.
 */
function normalizeBullet(item) {
  if (!item || typeof item !== 'object') return null;
  const text = String(item.text || '').trim();
  if (!text) return null;
  let severity = String(item.severity || '').trim().toLowerCase();
  if (!VALID_SEVERITIES.has(severity)) severity = 'neutral';
  return { text, severity };
}

/**
 * POST to Azure OpenAI's chat/completions endpoint. Returns the parsed
 * bullets array. Throws with a stable `.status` field on any hard failure.
 */
async function callAzureOpenAI({ endpoint, deployment, apiKey, apiVersion, systemPrompt, userPrompt, context }) {
  const url =
    `${endpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const body = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '<no body>');
    context.log.error(
      `regenerate-risk-factor-bullets: Azure OpenAI ${resp.status} — ${errText.slice(0, 400)}`,
    );
    const err = new Error(`Azure OpenAI error ${resp.status}`);
    err.status = resp.status >= 500 ? 502 : resp.status;
    err.upstream = errText.slice(0, 800);
    throw err;
  }
  const result = await resp.json();
  const content =
    result && result.choices && result.choices[0] && result.choices[0].message
      ? result.choices[0].message.content
      : null;
  if (!content) {
    const err = new Error('Azure OpenAI returned empty content');
    err.status = 502;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_e) {
    // Model sometimes wraps in ```json fences — strip and retry.
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    }
    try {
      parsed = JSON.parse(cleaned);
    } catch (_e2) {
      const err = new Error('Azure OpenAI response was not valid JSON');
      err.status = 502;
      err.upstream = content.slice(0, 400);
      throw err;
    }
  }
  const items = parsed && Array.isArray(parsed.executiveSummary)
    ? parsed.executiveSummary
    : null;
  if (!items) {
    const err = new Error('Azure OpenAI response missing executiveSummary list');
    err.status = 502;
    throw err;
  }
  const bullets = items.map(normalizeBullet).filter((b) => b !== null);
  if (bullets.length === 0) {
    const err = new Error('Azure OpenAI returned 0 valid bullets');
    err.status = 502;
    throw err;
  }
  return bullets;
}

module.exports = async function (context, req) {
  if (!req || req.method !== 'POST') {
    return jsonResponse(context, 405, {
      error: 'method_not_allowed',
      message: 'POST only.',
    });
  }

  // ── Auth: parse SWA principal ─────────────────────────────────────────
  const authRes = parseClientPrincipal(req);
  if (!authRes.ok) {
    return jsonResponse(context, 401, {
      error: 'unauthenticated',
      message: `Missing or invalid client principal (${authRes.reason}).`,
    });
  }
  const oid = authRes.oid;

  // ── Body validation ───────────────────────────────────────────────────
  const body = (req && req.body) || {};
  const period = typeof body.period === 'string' ? body.period.trim() : '';
  const facts = typeof body.facts === 'string' ? body.facts : '';
  if (!period || !PERIOD_RE.test(period)) {
    return jsonResponse(context, 400, {
      error: 'invalid_period',
      message: 'period must be a "YYYY-MM" string.',
    });
  }
  if (period === 'index') {
    return jsonResponse(context, 400, {
      error: 'invalid_period',
      message: 'period "index" is reserved.',
    });
  }
  if (!facts || facts.length < 50) {
    return jsonResponse(context, 400, {
      error: 'invalid_facts',
      message: 'facts must be a non-empty string of portfolio analysis data (>= 50 chars).',
    });
  }

  // ── Env config ────────────────────────────────────────────────────────
  const connStr = process.env.UPLOADS_STORAGE_CONNECTION;
  if (!connStr) {
    return jsonResponse(context, 500, {
      error: 'server_misconfigured',
      message: 'UPLOADS_STORAGE_CONNECTION is not set.',
    });
  }
  const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || '';
  const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || '';
  const API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';
  const API_KEY = process.env.AZURE_OPENAI_API_KEY || '';
  if (!API_KEY || !AZURE_ENDPOINT || !DEPLOYMENT) {
    return jsonResponse(context, 500, {
      error: 'server_misconfigured',
      message: 'Missing Azure OpenAI settings (AZURE_OPENAI_ENDPOINT / DEPLOYMENT / API_KEY).',
    });
  }

  // ── Load shared system prompt ─────────────────────────────────────────
  const { prompt: systemPrompt, source: promptSource } = loadSystemPrompt(context);
  const userPrompt =
    'Analyze this FHA portfolio data and generate the executive summary and action items:\n\n' +
    facts;

  // ── Read snapshot from blob (capture ETag) ────────────────────────────
  const blobName = `${period}.json`;
  let snapshot;
  let etag;
  let blobClient;
  try {
    const service = BlobServiceClient.fromConnectionString(connStr);
    const container = service.getContainerClient(SNAPSHOTS_CONTAINER);
    blobClient = container.getBlobClient(blobName);
    const exists = await blobClient.exists();
    if (!exists) {
      return jsonResponse(context, 404, {
        error: 'not_found',
        message: `Snapshot for ${period} does not exist.`,
      });
    }
    const dl = await blobClient.download();
    etag = dl && dl.etag ? dl.etag : null;
    const buf = await streamToBuffer(dl.readableStreamBody);
    snapshot = JSON.parse(buf.toString('utf8'));
  } catch (err) {
    context.log.error(
      `regenerate-risk-factor-bullets: read failed for ${SNAPSHOTS_CONTAINER}/${blobName}: ${err && err.message}`,
    );
    return jsonResponse(context, 500, {
      error: 'snapshot_read_failed',
      message: err && err.message,
    });
  }

  // ── Call Azure OpenAI ─────────────────────────────────────────────────
  let bullets;
  try {
    bullets = await callAzureOpenAI({
      endpoint: AZURE_ENDPOINT,
      deployment: DEPLOYMENT,
      apiKey: API_KEY,
      apiVersion: API_VERSION,
      systemPrompt,
      userPrompt,
      context,
    });
  } catch (err) {
    return jsonResponse(context, err.status || 502, {
      error: 'llm_call_failed',
      message: err && err.message,
    });
  }

  // ── Mutate snapshot + write back with If-Match ETag ───────────────────
  const nowIso = new Date().toISOString();
  const existing =
    snapshot && snapshot.risk_factor_bullets && typeof snapshot.risk_factor_bullets === 'object'
      ? snapshot.risk_factor_bullets
      : {};
  snapshot.risk_factor_bullets = {
    bullets,
    // Preserve original bake provenance if present; only stamp defaults
    // when the field is being minted for the first time (historical
    // snapshots that never had baked bullets before).
    generated_at: existing.generated_at || nowIso,
    generated_by: existing.generated_by || GENERATED_BY_TAG,
    regenerated_at: nowIso,
    regenerated_by: oid,
    schema_version: existing.schema_version || SCHEMA_VERSION,
  };

  try {
    // Use `getBlockBlobClient` for the upload — `BlobClient` doesn't
    // expose `upload()` on its own.
    const service = BlobServiceClient.fromConnectionString(connStr);
    const container = service.getContainerClient(SNAPSHOTS_CONTAINER);
    const blockBlob = container.getBlockBlobClient(blobName);
    const bodyText = JSON.stringify(snapshot);
    const uploadOpts = {
      blobHTTPHeaders: {
        blobContentType: 'application/json; charset=utf-8',
        blobCacheControl: 'no-cache',
      },
    };
    if (etag) {
      uploadOpts.conditions = { ifMatch: etag };
    }
    await blockBlob.upload(bodyText, Buffer.byteLength(bodyText, 'utf8'), uploadOpts);
  } catch (err) {
    // Storage SDK signals 412 Precondition Failed on ETag mismatch.
    const statusCode =
      (err && (err.statusCode || err.response?.status)) || 0;
    if (statusCode === 412) {
      context.log.warn(
        `regenerate-risk-factor-bullets: ETag conflict on ${blobName} — another writer beat us. Client should retry.`,
      );
      return jsonResponse(context, 409, {
        error: 'etag_conflict',
        message:
          'Snapshot was modified by another writer while regenerate was in flight. Retry once.',
      });
    }
    context.log.error(
      `regenerate-risk-factor-bullets: write failed for ${SNAPSHOTS_CONTAINER}/${blobName}: ${err && err.message}`,
    );
    return jsonResponse(context, 500, {
      error: 'snapshot_write_failed',
      message: err && err.message,
    });
  }

  context.log.info(
    `regenerate-risk-factor-bullets: rewrote ${blobName} with ${bullets.length} bullets ` +
      `(by=${oid}, prompt_source=${promptSource})`,
  );

  return jsonResponse(context, 200, {
    bullets,
    regenerated_at: nowIso,
    regenerated_by: oid,
  });
};

// ── Exposed for smoke tests ──────────────────────────────────────────────
module.exports.PERIOD_RE = PERIOD_RE;
module.exports.parseClientPrincipal = parseClientPrincipal;
module.exports.normalizeBullet = normalizeBullet;
module.exports.loadSystemPrompt = loadSystemPrompt;
module.exports.INLINE_FALLBACK_PROMPT = INLINE_FALLBACK_PROMPT;
module.exports.streamToBuffer = streamToBuffer;
