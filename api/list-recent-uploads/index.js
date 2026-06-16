/**
 * GET /api/list-recent-uploads
 *
 * Returns the 20 most recent blobs from the uploads container, sorted by
 * lastModified descending. Same allowlist semantics as upload-sas.
 */
const { BlobServiceClient } = require('@azure/storage-blob');

const ALLOWED_EMAILS = new Set([
  'jdewindt@afncorp.com',
  'mkunisaki@afncorp.com',
  'stallman@afncorp.com',
]);

const MAX_ITEMS = 20;

function jsonResponse(context, status, body) {
  context.res = {
    status,
    headers: { 'Content-Type': 'application/json' },
    body,
  };
}

function decodeClientPrincipal(req) {
  const header =
    (req.headers && (req.headers['x-ms-client-principal'] || req.headers['X-MS-CLIENT-PRINCIPAL'])) || '';
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch (_e) {
    return null;
  }
}

function extractEmail(principal) {
  if (!principal) return null;
  const candidates = [principal.userDetails];
  for (const c of principal.claims || []) {
    if (!c || !c.val) continue;
    const t = (c.typ || '').toLowerCase();
    if (
      t === 'preferred_username' ||
      t === 'email' ||
      t.endsWith('/emailaddress') ||
      t === 'upn' ||
      t.endsWith('/upn')
    ) {
      candidates.push(c.val);
    }
  }
  for (const c of candidates) {
    if (typeof c === 'string' && c.includes('@')) {
      return c.trim().toLowerCase();
    }
  }
  return null;
}

module.exports = async function (context, req) {
  const principal = decodeClientPrincipal(req);
  const email = extractEmail(principal);

  if (!email) {
    return jsonResponse(context, 401, { error: 'unauthenticated' });
  }
  if (!ALLOWED_EMAILS.has(email)) {
    return jsonResponse(context, 403, { error: 'forbidden' });
  }

  const connStr = process.env.UPLOADS_STORAGE_CONNECTION;
  const containerName = process.env.UPLOADS_CONTAINER || 'uploads';
  if (!connStr) {
    return jsonResponse(context, 500, { error: 'server_misconfigured' });
  }

  try {
    const service = BlobServiceClient.fromConnectionString(connStr);
    const container = service.getContainerClient(containerName);

    // Pull a reasonable working set then sort+slice on the server. The
    // uploads volume is tiny (a handful per month) so we don't need to
    // paginate aggressively.
    const items = [];
    for await (const blob of container.listBlobsFlat()) {
      items.push({
        name: blob.name,
        size: blob.properties.contentLength || 0,
        uploadedAt:
          blob.properties.lastModified instanceof Date
            ? blob.properties.lastModified.toISOString()
            : String(blob.properties.lastModified || ''),
        contentType: blob.properties.contentType || 'application/octet-stream',
      });
      if (items.length > 500) break; // hard ceiling
    }

    items.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
    const recent = items.slice(0, MAX_ITEMS);

    return jsonResponse(context, 200, {
      container: containerName,
      count: recent.length,
      items: recent,
    });
  } catch (err) {
    context.log.error(`list-recent-uploads: ${err.message}`);
    return jsonResponse(context, 500, { error: 'list_failed', message: err.message });
  }
};
