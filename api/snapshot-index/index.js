/**
 * GET /api/snapshot/index
 *
 * Returns the JSON body of `snapshots/index.json` from the `stafnfhauploads`
 * storage account. Used by the SWA frontend to enumerate available snapshot
 * periods.
 *
 * Auth is enforced at the SWA route layer (`allowedRoles: ["authenticated"]`
 * in public/staticwebapp.config.json). We keep `authLevel: anonymous` on the
 * function binding so SWA is the sole gate — matches the `ai-analysis`
 * pattern rather than the API-key-gated `files-list` pattern.
 *
 * Response: application/json, `Cache-Control: no-cache` — the index is small
 * (< 1 KB) and freshness matters when a new snapshot is written to blob.
 *
 * Errors:
 *   - 500 if `UPLOADS_STORAGE_CONNECTION` isn't set or the blob read throws.
 *   - 502 if the blob body isn't valid JSON.
 *   - No 404 for the index: if the pipeline has never populated it, that's
 *     a config problem, not a routing problem.
 */
const { BlobServiceClient } = require('@azure/storage-blob');

const SNAPSHOTS_CONTAINER =
  process.env.SNAPSHOTS_CONTAINER || 'snapshots';
const INDEX_BLOB = 'index.json';

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
  const connStr = process.env.UPLOADS_STORAGE_CONNECTION;
  if (!connStr) {
    return jsonResponse(context, 500, {
      error: 'server_misconfigured',
      message: 'UPLOADS_STORAGE_CONNECTION is not set.',
    });
  }

  let bodyText;
  try {
    const service = BlobServiceClient.fromConnectionString(connStr);
    const container = service.getContainerClient(SNAPSHOTS_CONTAINER);
    const blob = container.getBlobClient(INDEX_BLOB);
    const dl = await blob.download();
    const buf = await streamToBuffer(dl.readableStreamBody);
    bodyText = buf.toString('utf8');
  } catch (err) {
    context.log.error(
      `snapshot-index: read failed for ${SNAPSHOTS_CONTAINER}/${INDEX_BLOB}: ${
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
    context.log.error(`snapshot-index: JSON parse failed: ${err && err.message}`);
    return jsonResponse(context, 502, {
      error: 'invalid_json',
      message: 'Snapshot index blob is not valid JSON.',
    });
  }

  return jsonResponse(context, 200, parsed);
};

// Exported for smoke tests.
module.exports.streamToBuffer = streamToBuffer;
