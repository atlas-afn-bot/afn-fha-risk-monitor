/**
 * POST /api/files/{month}/{slot}
 *
 * Upload a file to blob storage for RPA-produced outputs (e.g., the
 * Encompass Data file the AA bot generates after processing HUD inputs).
 *
 * Auth: `X-API-Key` header MUST match `FHA_FILES_API_KEY` env var.
 *   - Same key as the read endpoints — single RPA service identity.
 *   - No SWA session cookie required.
 *
 * Request:
 *   - Content-Type should match the file type (e.g.,
 *     application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
 *   - `X-Filename` header: the desired filename (sanitized, [A-Za-z0-9._-]+)
 *   - Body: raw file bytes
 *
 * Response:
 *   {
 *     blobPath: "2026-05/enc-data/Enc_Data_5.31.26.xlsx",
 *     container: "uploads",
 *     month: "2026-05",
 *     slot: "enc-data",
 *     filename: "Enc_Data_5.31.26.xlsx",
 *     size: 12345678,
 *     uploadedAt: "2026-06-24T22:30:00.000Z"
 *   }
 *
 * Slots:
 *   Accepts all 6 original HUD slots plus `enc-data` (the Encompass
 *   Data file the RPA bot produces). Additional slots can be added to
 *   UPLOAD_SLOTS below.
 *
 * Size limit: 100 MB (enforced here; SWA/Functions may impose lower
 * limits depending on plan — Premium Functions support up to 100 MB
 * request bodies).
 */
const { BlobServiceClient } = require('@azure/storage-blob');

// All slots the upload endpoint accepts. Superset of the download
// endpoint's VALID_SLOTS — includes bot-produced output slots.
const UPLOAD_SLOTS = new Set([
  'hud-branches',
  'hoc-compare-ratios',
  'nw-data',
  'hud-total-compare-ratios',
  'hud-field-office',
  'enc-data',
]);

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const FILENAME_RE = /^[A-Za-z0-9._\- ]+$/;
const MAX_FILENAME_LEN = 200;
const MAX_BODY_BYTES = 100 * 1024 * 1024; // 100 MB

function jsonResponse(context, status, body) {
  context.res = {
    status,
    headers: { 'Content-Type': 'application/json' },
    body,
  };
}

function requireApiKey(req) {
  const expected = process.env.FHA_FILES_API_KEY;
  if (!expected) return { ok: false, status: 500, error: 'server_misconfigured' };
  const provided =
    (req.headers && (req.headers['x-api-key'] || req.headers['X-API-Key'])) || '';
  if (!provided || typeof provided !== 'string') {
    return { ok: false, status: 401, error: 'unauthenticated' };
  }
  // Constant-time comparison
  if (provided.length !== expected.length) {
    return { ok: false, status: 401, error: 'unauthenticated' };
  }
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) {
    return { ok: false, status: 401, error: 'unauthenticated' };
  }
  return { ok: true };
}

function validateMonth(raw) {
  if (typeof raw !== 'string') return null;
  const m = MONTH_RE.exec(raw.trim());
  if (!m) return null;
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}`;
}

function validateSlot(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return UPLOAD_SLOTS.has(s) ? s : null;
}

function sanitizeFilename(raw) {
  if (typeof raw !== 'string') return null;
  const base = raw.split(/[/\\]/).pop() || '';
  if (!base || base.length > MAX_FILENAME_LEN) return null;
  if (!FILENAME_RE.test(base)) return null;
  if (base === '.' || base === '..' || base.startsWith('.')) return null;
  return base;
}

function parseConnectionString(cs) {
  const parts = {};
  for (const seg of String(cs).split(';')) {
    const i = seg.indexOf('=');
    if (i <= 0) continue;
    parts[seg.slice(0, i)] = seg.slice(i + 1);
  }
  return parts;
}

module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    return jsonResponse(context, 405, { error: 'method_not_allowed' });
  }

  // 1) Auth
  const auth = requireApiKey(req);
  if (!auth.ok) {
    return jsonResponse(context, auth.status, { error: auth.error });
  }

  // 2) Validate route params
  const month = validateMonth(context.bindingData && context.bindingData.month);
  if (!month) {
    return jsonResponse(context, 400, {
      error: 'invalid_month',
      message: 'month must be a "YYYY-MM" string with a 01..12 month part.',
    });
  }

  const slot = validateSlot(context.bindingData && context.bindingData.slot);
  if (!slot) {
    return jsonResponse(context, 400, {
      error: 'invalid_slot',
      message: `slot must be one of: ${Array.from(UPLOAD_SLOTS).sort().join(', ')}`,
    });
  }

  // 3) Validate filename from header
  const filenameRaw =
    (req.headers && (req.headers['x-filename'] || req.headers['X-Filename'])) || '';
  const filename = sanitizeFilename(filenameRaw);
  if (!filename) {
    return jsonResponse(context, 400, {
      error: 'invalid_filename',
      message:
        'X-Filename header is required and must match [A-Za-z0-9._ -]+ (1-200 chars, no directory separators, no leading dot).',
    });
  }

  // 4) Validate body
  const body = req.body;
  if (!body || (Buffer.isBuffer(body) && body.length === 0)) {
    return jsonResponse(context, 400, {
      error: 'empty_body',
      message: 'Request body must contain the file bytes.',
    });
  }

  const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (bodyBuffer.length > MAX_BODY_BYTES) {
    return jsonResponse(context, 413, {
      error: 'payload_too_large',
      message: `File exceeds ${MAX_BODY_BYTES / (1024 * 1024)} MB limit.`,
    });
  }

  // 5) Storage config
  const connStr = process.env.UPLOADS_STORAGE_CONNECTION;
  const containerName = process.env.UPLOADS_CONTAINER || 'uploads';
  if (!connStr) {
    context.log.error('files-upload: UPLOADS_STORAGE_CONNECTION is not set');
    return jsonResponse(context, 500, { error: 'server_misconfigured' });
  }

  // 6) Upload to blob storage
  const blobName = `${month}/${slot}/${filename}`;
  const contentType =
    (req.headers && (req.headers['content-type'] || req.headers['Content-Type'])) ||
    'application/octet-stream';

  try {
    const service = BlobServiceClient.fromConnectionString(connStr);
    const container = service.getContainerClient(containerName);
    const blockBlob = container.getBlockBlobClient(blobName);

    await blockBlob.upload(bodyBuffer, bodyBuffer.length, {
      blobHTTPHeaders: {
        blobContentType: contentType,
      },
    });

    const now = new Date().toISOString();
    context.log.info(
      `files-upload: ${filename} → ${containerName}/${blobName} (${bodyBuffer.length} bytes)`,
    );

    return jsonResponse(context, 201, {
      blobPath: blobName,
      container: containerName,
      month,
      slot,
      filename,
      size: bodyBuffer.length,
      uploadedAt: now,
    });
  } catch (err) {
    context.log.error(`files-upload: ${err && err.message}`);
    return jsonResponse(context, 500, {
      error: 'upload_failed',
      message: err && err.message,
    });
  }
};

// Exported for tests.
module.exports.UPLOAD_SLOTS = UPLOAD_SLOTS;
