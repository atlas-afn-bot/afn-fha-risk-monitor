/**
 * Evaluator response cache — blob-backed.
 *
 * Cache key: sha256(snapshot_month + canonical(predicate_set + composition_op)).
 * Storage: `stafnfhauploads/snapshots/evaluations/{cache_key}.json`
 * Invalidation: M-only on snapshot rewrite (design doc §9 Q11).
 * Concurrency: last-writer-wins (§9 Q12).
 */
const crypto = require('crypto');
const { BlobServiceClient } = require('@azure/storage-blob');

const CACHE_PREFIX = 'evaluations/';

/**
 * Canonical serialization of an evaluate() input: predicates sorted by
 * predicate_id, each params object with sorted keys, composition_op included.
 */
function canonicalizeInput({ snapshot_month, predicates, composition_op }) {
  const sortedPreds = (predicates || [])
    .filter((p) => p && p.predicate_id)
    .map((p) => ({
      predicate_id: p.predicate_id,
      params: canonicalizeParams(p.params || {}),
    }))
    .sort((a, b) => (a.predicate_id < b.predicate_id ? -1 : a.predicate_id > b.predicate_id ? 1 : 0));
  return JSON.stringify({
    snapshot_month,
    composition_op: composition_op === 'AND' ? 'AND' : 'OR',
    predicates: sortedPreds,
  });
}

function canonicalizeParams(params) {
  if (params === null || params === undefined || typeof params !== 'object') return {};
  const out = {};
  for (const key of Object.keys(params).sort()) {
    const v = params[key];
    if (Array.isArray(v)) {
      out[key] = [...v].sort();
    } else if (v !== null && typeof v === 'object') {
      out[key] = canonicalizeParams(v);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function cacheKey({ snapshot_month, predicates, composition_op }) {
  const canon = canonicalizeInput({ snapshot_month, predicates, composition_op });
  const hex = crypto.createHash('sha256').update(canon).digest('hex');
  return hex;
}

function getContainerClient(connStr, containerName) {
  const service = BlobServiceClient.fromConnectionString(connStr);
  return service.getContainerClient(containerName);
}

async function streamToBuffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

/**
 * @returns cached response object or null on miss.
 */
async function readCache({ connStr, container, key }) {
  const c = getContainerClient(connStr, container);
  const blob = c.getBlobClient(`${CACHE_PREFIX}${key}.json`);
  try {
    const exists = await blob.exists();
    if (!exists) return null;
    const dl = await blob.download();
    const buf = await streamToBuffer(dl.readableStreamBody);
    return JSON.parse(buf.toString('utf8'));
  } catch (err) {
    // Cache read errors should NOT block the request; just treat as miss.
    return null;
  }
}

async function writeCache({ connStr, container, key, body }) {
  const c = getContainerClient(connStr, container);
  const blob = c.getBlockBlobClient(`${CACHE_PREFIX}${key}.json`);
  const text = JSON.stringify(body);
  await blob.upload(text, Buffer.byteLength(text, 'utf8'), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
}

/**
 * Purge all cache entries under the evaluations/ prefix.
 * Returns { purged_count }.
 */
async function purgeAll({ connStr, container }) {
  const c = getContainerClient(connStr, container);
  let count = 0;
  for await (const b of c.listBlobsFlat({ prefix: CACHE_PREFIX })) {
    try {
      await c.getBlobClient(b.name).deleteIfExists();
      count++;
    } catch (_err) {
      // Continue purging; one failure shouldn't block the rest.
    }
  }
  return { purged_count: count };
}

module.exports = {
  CACHE_PREFIX,
  canonicalizeInput,
  canonicalizeParams,
  cacheKey,
  readCache,
  writeCache,
  purgeAll,
};
