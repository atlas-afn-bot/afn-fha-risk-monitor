/**
 * Load a snapshot for a given period (`YYYY-MM`) from blob storage.
 *
 * Mirrors the read pattern in `api/snapshot-index/index.js` and
 * `api/snapshot-period/index.js`. Container defaults to `SNAPSHOTS_CONTAINER`
 * env or `snapshots`.
 */
const { BlobServiceClient } = require('@azure/storage-blob');

async function streamToBuffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

async function loadSnapshot({ connStr, container, period }) {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    const err = new Error(`invalid_period: expected YYYY-MM, got '${period}'`);
    err.code = 'invalid_period';
    throw err;
  }
  const service = BlobServiceClient.fromConnectionString(connStr);
  const c = service.getContainerClient(container);
  const blob = c.getBlobClient(`${period}.json`);
  const exists = await blob.exists();
  if (!exists) {
    const err = new Error(`snapshot_not_found: ${period}.json`);
    err.code = 'snapshot_not_found';
    throw err;
  }
  const dl = await blob.download();
  const buf = await streamToBuffer(dl.readableStreamBody);
  return JSON.parse(buf.toString('utf8'));
}

module.exports = { loadSnapshot };
