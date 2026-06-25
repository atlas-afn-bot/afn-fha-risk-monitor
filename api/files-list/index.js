/**
 * GET /api/files
 * GET /api/files?month=YYYY-MM
 * GET /api/files?month=YYYY-MM&slot=<slot-slug>
 *
 * Read-only file listing for RPA consumption (Michael Kunisaki's team).
 *
 * Auth: `X-API-Key` header MUST match `FHA_FILES_API_KEY` env var.
 *   - No SWA session cookie required (RPA runs as a service, not a user).
 *   - 401 if header is missing/empty.
 *   - 401 if header doesn't match. (We don't 403 — RPA shouldn't be told
 *     "authenticated but unauthorized"; the only valid state is "valid key".)
 *
 * Response shape:
 *   {
 *     container: "uploads",
 *     count: <number>,
 *     files: [
 *       {
 *         month:       "2026-05",
 *         slot:        "hud-branches",
 *         filename:    "HUD Branches - 5.31.26.xlsx",
 *         size:        124567,
 *         uploadedAt:  "2026-06-17T19:23:11.000Z",
 *         contentType: "application/vnd.openxmlformats-...",
 *         downloadUrl: "/api/files/2026-05/hud-branches/HUD%20Branches%20-%205.31.26.xlsx"
 *       },
 *       ...
 *     ]
 *   }
 *
 * Notes:
 *   - `hud-national-totals` has been removed — use `hud-total-compare-ratios`
 *     instead (same file).
 *   - Blobs that don't match the expected `{month}/{slot}/{filename}` path
 *     are silently skipped (defensive against any stray blobs).
 *   - File names returned in `filename` and `downloadUrl` are the original
 *     uploaded basename (sanitized at upload time to `[A-Za-z0-9._-]+`,
 *     so no encoding hazards beyond the standard percent-encoding the
 *     URL field already does).
 */
const { BlobServiceClient } = require('@azure/storage-blob');

const VALID_SLOTS = new Set([
  'hud-branches',
  'hoc-compare-ratios',
  'nw-data',
  'hud-total-compare-ratios',
  'hud-field-office',
  'enc-data',
]);

const MONTH_RE = /^(\d{4})-(\d{2})$/;

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
  // Constant-time-ish compare. Lengths differ → reject; otherwise compare byte by byte.
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
  if (raw == null || raw === '') return null; // not provided → no filter
  if (typeof raw !== 'string') return undefined;
  const m = MONTH_RE.exec(raw.trim());
  if (!m) return undefined;
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return undefined;
  return `${m[1]}-${m[2]}`;
}

function validateSlot(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase();
  return VALID_SLOTS.has(s) ? s : undefined;
}

/**
 * Parse blob name into { month, slot, filename }.
 * Blobs are written by upload-sas as `{YYYY-MM}/{slot-slug}/{filename}`.
 * Anything that doesn't match returns null.
 */
function parseBlobName(name) {
  if (typeof name !== 'string' || !name) return null;
  const parts = name.split('/');
  if (parts.length !== 3) return null;
  const [month, slot, filename] = parts;
  if (!MONTH_RE.test(month)) return null;
  if (!VALID_SLOTS.has(slot)) return null;
  if (!filename) return null;
  return { month, slot, filename };
}

module.exports = async function (context, req) {
  const auth = requireApiKey(req);
  if (!auth.ok) {
    return jsonResponse(context, auth.status, { error: auth.error });
  }

  const monthFilter = validateMonth(req.query && req.query.month);
  if (monthFilter === undefined) {
    return jsonResponse(context, 400, {
      error: 'invalid_month',
      message: 'month must be a "YYYY-MM" string with a 01..12 month part.',
    });
  }

  const slotFilter = validateSlot(req.query && req.query.slot);
  if (slotFilter === undefined) {
    return jsonResponse(context, 400, {
      error: 'invalid_slot',
      message: `slot must be one of: ${Array.from(VALID_SLOTS).sort().join(', ')}`,
    });
  }

  const connStr = process.env.UPLOADS_STORAGE_CONNECTION;
  const containerName = process.env.UPLOADS_CONTAINER || 'uploads';
  if (!connStr) {
    return jsonResponse(context, 500, { error: 'server_misconfigured' });
  }

  try {
    const service = BlobServiceClient.fromConnectionString(connStr);
    const container = service.getContainerClient(containerName);

    // Use a prefix when filters allow it — cheaper for the API and avoids
    // pulling every blob across all months when RPA wants a single slot.
    let prefix;
    if (monthFilter && slotFilter) {
      prefix = `${monthFilter}/${slotFilter}/`;
    } else if (monthFilter) {
      prefix = `${monthFilter}/`;
    } else {
      prefix = undefined;
    }

    const files = [];
    const iter = prefix
      ? container.listBlobsFlat({ prefix })
      : container.listBlobsFlat();

    for await (const blob of iter) {
      const parsed = parseBlobName(blob.name);
      if (!parsed) continue;
      if (slotFilter && parsed.slot !== slotFilter) continue;
      // (monthFilter is already enforced by the prefix when set)

      files.push({
        month: parsed.month,
        slot: parsed.slot,
        filename: parsed.filename,
        size: blob.properties.contentLength || 0,
        uploadedAt:
          blob.properties.lastModified instanceof Date
            ? blob.properties.lastModified.toISOString()
            : String(blob.properties.lastModified || ''),
        contentType: blob.properties.contentType || 'application/octet-stream',
        downloadUrl: `/api/files/${parsed.month}/${parsed.slot}/${encodeURIComponent(
          parsed.filename,
        )}`,
      });
    }

    // Newest first, then deterministic tiebreak by slot then filename.
    files.sort((a, b) => {
      if (a.uploadedAt !== b.uploadedAt) {
        return (b.uploadedAt || '').localeCompare(a.uploadedAt || '');
      }
      if (a.slot !== b.slot) return a.slot.localeCompare(b.slot);
      return a.filename.localeCompare(b.filename);
    });

    return jsonResponse(context, 200, {
      container: containerName,
      count: files.length,
      files,
    });
  } catch (err) {
    context.log.error(`files-list: ${err && err.message}`);
    return jsonResponse(context, 500, { error: 'list_failed', message: err && err.message });
  }
};

// Exported for smoke tests / re-use by other Functions in this app.
module.exports.VALID_SLOTS = VALID_SLOTS;
module.exports.parseBlobName = parseBlobName;
module.exports.requireApiKey = requireApiKey;
