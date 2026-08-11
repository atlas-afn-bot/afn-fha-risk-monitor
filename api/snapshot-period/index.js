/**
 * GET /api/snapshot/{period}
 *
 * Returns `snapshots/{period}.json` from the `stafnfhauploads` storage
 * account. `{period}` must be a `YYYY-MM` string.
 *
 * Note: the sibling `/api/snapshot/index` route is served by the
 * `snapshot-index` function. Azure Functions routes `snapshot/index` to
 * that function (more specific match) rather than here — but we defend
 * against `{period} === "index"` anyway so this function never claims
 * that path if route matching ever changes.
 *
 * Auth is enforced at the SWA route layer (see
 * public/staticwebapp.config.json). `authLevel` is `anonymous` on the
 * binding so SWA is the sole gate.
 *
 * Response: application/json, `Cache-Control: no-cache`. `Content-Length`
 * is set from `blob.properties.contentLength` when available. Snapshots
 * can be ~40 MB — the blob body is streamed into a buffer (Azure Functions
 * v3/v4 for JS wants a buffer or string in `context.res.body` for JSON;
 * chunked streaming isn't a first-class shape).
 *
 * Errors:
 *   - 400 if period doesn't match /^\d{4}-\d{2}$/.
 *   - 404 if the snapshot blob doesn't exist.
 *   - 500 for connection-string / read failures.
 *   - 502 if the blob body isn't valid JSON.
 */
const { BlobServiceClient } = require('@azure/storage-blob');

const SNAPSHOTS_CONTAINER =
  process.env.SNAPSHOTS_CONTAINER || 'snapshots';
const PERIOD_RE = /^\d{4}-\d{2}$/;

function jsonResponse(context, status, body, extraHeaders) {
  context.res = {
    status,
    headers: Object.assign(
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      extraHeaders || {},
    ),
    body,
  };
}

async function streamToBuffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

module.exports = async function (context, _req) {
  const period = context.bindingData && context.bindingData.period;
  if (!period || typeof period !== 'string' || !PERIOD_RE.test(period)) {
    return jsonResponse(context, 400, {
      error: 'invalid_period',
      message: 'period must be a "YYYY-MM" string.',
    });
  }
  // Defensive: never let this route serve /api/snapshot/index — that's
  // owned by the snapshot-index function.
  if (period === 'index') {
    return jsonResponse(context, 400, {
      error: 'invalid_period',
      message: 'period "index" is reserved.',
    });
  }

  const connStr = process.env.UPLOADS_STORAGE_CONNECTION;
  if (!connStr) {
    return jsonResponse(context, 500, {
      error: 'server_misconfigured',
      message: 'UPLOADS_STORAGE_CONNECTION is not set.',
    });
  }

  const blobName = `${period}.json`;

  let bodyText;
  let contentLength;
  try {
    const service = BlobServiceClient.fromConnectionString(connStr);
    const container = service.getContainerClient(SNAPSHOTS_CONTAINER);
    const blob = container.getBlobClient(blobName);
    const exists = await blob.exists();
    if (!exists) {
      return jsonResponse(context, 404, {
        error: 'not_found',
        message: `Snapshot for ${period} does not exist.`,
      });
    }
    const dl = await blob.download();
    if (dl && dl.contentLength != null) {
      contentLength = dl.contentLength;
    }
    const buf = await streamToBuffer(dl.readableStreamBody);
    bodyText = buf.toString('utf8');
  } catch (err) {
    context.log.error(
      `snapshot-period: read failed for ${SNAPSHOTS_CONTAINER}/${blobName}: ${
        err && err.message
      }`,
    );
    return jsonResponse(context, 500, {
      error: 'read_failed',
      message: err && err.message,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (err) {
    context.log.error(
      `snapshot-period: JSON parse failed for ${blobName}: ${err && err.message}`,
    );
    return jsonResponse(context, 502, {
      error: 'invalid_json',
      message: 'Snapshot blob is not valid JSON.',
    });
  }

  const extraHeaders = {};
  if (contentLength != null) {
    // Content-Length here reflects the blob's on-disk size, not necessarily
    // the byte length of the re-serialized JSON body. Included as an
    // advisory hint; SWA will recompute the real Content-Length on the wire.
    extraHeaders['X-Snapshot-Blob-Length'] = String(contentLength);
  }

  return jsonResponse(context, 200, parsed, extraHeaders);
};

// Exported for smoke tests.
module.exports.PERIOD_RE = PERIOD_RE;
module.exports.streamToBuffer = streamToBuffer;
