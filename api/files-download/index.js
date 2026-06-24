/**
 * GET /api/files/{month}/{slot}/{filename}
 * GET /api/files/{month}/{slot}/latest
 *
 * Returns a 302 redirect to a short-lived (5 min) read-only SAS URL for the
 * requested blob. Auth: `X-API-Key` header MUST match `FHA_FILES_API_KEY`
 * env var.
 *
 * Why 302-to-SAS instead of streaming through the Function:
 *   - Removes the function as a bandwidth choke point (RPA pulls real
 *     Excel files — bytes, not JSON).
 *   - The SAS is scoped to exactly one blob, read-only, 5-minute window.
 *   - Functions execution time stays cheap (auth + SAS mint + 302 only).
 *
 * The special filename `latest` resolves to the most recently modified
 * blob in `{month}/{slot}/`. If the folder is empty, 404.
 */
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} = require('@azure/storage-blob');

const VALID_SLOTS = new Set([
  'hud-branches',
  'hoc-compare-ratios',
  'nw-data',
  'hud-total-compare-ratios',
  'hud-national-totals',
  'hud-field-office',
  'enc-data',
]);

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const FILENAME_RE = /^[A-Za-z0-9._-]+$/;
const MAX_FILENAME_LEN = 200;
const DOWNLOAD_SAS_TTL_MINUTES = 5;

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
  return VALID_SLOTS.has(s) ? s : null;
}

function validateFilename(raw) {
  if (typeof raw !== 'string') return null;
  // Allow URL-encoded forms (function host decodes route params already,
  // but be defensive — strip any directory portion just in case).
  const base = raw.split(/[/\\]/).pop() || '';
  if (!base || base.length > MAX_FILENAME_LEN) return null;
  if (base === 'latest') return 'latest';
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

function buildSasUrl({ accountName, accountKey, containerName, blobName }) {
  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const startsOn = new Date(Date.now() - 2 * 60 * 1000); // 2-min skew tolerance
  const expiresOn = new Date(Date.now() + DOWNLOAD_SAS_TTL_MINUTES * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'), // read-only
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
      version: '2021-08-06',
    },
    credential,
  ).toString();

  // Encode each path segment but preserve `/` separators.
  const encodedBlobName = blobName
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  const url = `https://${accountName}.blob.core.windows.net/${containerName}/${encodedBlobName}?${sas}`;
  return { url, expiresOn };
}

module.exports = async function (context, req) {
  const auth = requireApiKey(req);
  if (!auth.ok) {
    return jsonResponse(context, auth.status, { error: auth.error });
  }

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
      message: `slot must be one of: ${Array.from(VALID_SLOTS).sort().join(', ')}`,
    });
  }

  const filename = validateFilename(context.bindingData && context.bindingData.filename);
  if (!filename) {
    return jsonResponse(context, 400, {
      error: 'invalid_filename',
      message:
        'filename must match [A-Za-z0-9._-]+ (no directory separators, no leading dot), or be the literal "latest".',
    });
  }

  const connStr = process.env.UPLOADS_STORAGE_CONNECTION;
  const containerName = process.env.UPLOADS_CONTAINER || 'uploads';
  if (!connStr) {
    return jsonResponse(context, 500, { error: 'server_misconfigured' });
  }
  const parsed = parseConnectionString(connStr);
  const accountName = parsed.AccountName;
  const accountKey = parsed.AccountKey;
  if (!accountName || !accountKey) {
    return jsonResponse(context, 500, { error: 'server_misconfigured' });
  }

  // Resolve `latest` → newest blob in the {month}/{slot}/ folder.
  let resolvedFilename = filename;
  if (filename === 'latest') {
    try {
      const service = BlobServiceClient.fromConnectionString(connStr);
      const container = service.getContainerClient(containerName);
      const prefix = `${month}/${slot}/`;

      let newest = null;
      for await (const blob of container.listBlobsFlat({ prefix })) {
        // Skip "directory-marker" zero-byte blobs and anything below this depth.
        const parts = blob.name.split('/');
        if (parts.length !== 3) continue;
        const last = parts[2];
        if (!last) continue;
        const lm =
          blob.properties.lastModified instanceof Date
            ? blob.properties.lastModified
            : new Date(blob.properties.lastModified || 0);
        if (!newest || lm > newest.lastModified) {
          newest = { name: last, lastModified: lm };
        }
      }

      if (!newest) {
        return jsonResponse(context, 404, {
          error: 'not_found',
          message: `No files in ${month}/${slot}/.`,
        });
      }
      resolvedFilename = newest.name;
    } catch (err) {
      context.log.error(`files-download (latest): ${err && err.message}`);
      return jsonResponse(context, 500, {
        error: 'list_failed',
        message: err && err.message,
      });
    }
  } else {
    // Specific filename: verify the blob exists before issuing a SAS so we
    // can give RPA a clean 404 instead of a working SAS that 404s on GET.
    try {
      const service = BlobServiceClient.fromConnectionString(connStr);
      const blobClient = service
        .getContainerClient(containerName)
        .getBlobClient(`${month}/${slot}/${resolvedFilename}`);
      const exists = await blobClient.exists();
      if (!exists) {
        return jsonResponse(context, 404, {
          error: 'not_found',
          message: `Blob ${month}/${slot}/${resolvedFilename} does not exist.`,
        });
      }
    } catch (err) {
      context.log.error(`files-download (exists): ${err && err.message}`);
      return jsonResponse(context, 500, {
        error: 'exists_check_failed',
        message: err && err.message,
      });
    }
  }

  const blobName = `${month}/${slot}/${resolvedFilename}`;
  const { url, expiresOn } = buildSasUrl({
    accountName,
    accountKey,
    containerName,
    blobName,
  });

  context.log.info(
    `files-download: issued SAS for ${containerName}/${blobName} (expires ${expiresOn.toISOString()})`,
  );

  context.res = {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'no-store',
      'X-Resolved-Filename': resolvedFilename,
      'X-Expires-At': expiresOn.toISOString(),
    },
    body: '',
  };
};

// Exported for smoke tests.
module.exports.VALID_SLOTS = VALID_SLOTS;
module.exports.requireApiKey = requireApiKey;
