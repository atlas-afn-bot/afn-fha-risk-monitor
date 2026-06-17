/**
 * POST /api/upload-sas
 *
 * Defense-in-depth uploader for the FHA Risk Monitor dashboard.
 *
 * Auth flow:
 *   1. SWA enforces Entra/AAD SSO via staticwebapp.config.json on the
 *      /uploads route and on /api/upload-sas, so unauthenticated callers
 *      never reach this function.
 *   2. This function additionally parses `x-ms-client-principal` and
 *      enforces a small hard-coded allowlist of AFN identities. Even if
 *      the SWA-level rule were misconfigured we still 403 anyone outside
 *      the allowlist.
 *
 * Request body:
 *   {
 *     filename: string,         // sanitized [A-Za-z0-9._-]+ (1..200)
 *     category: string,         // one of the 6 slugs in CATEGORY_SLUGS
 *     month?:   "YYYY-MM"       // optional; defaults to current UTC month
 *   }
 *
 * What it returns:
 *   { uploadUrl, blobPath, expiresAt, category, month }
 *
 * The SAS is scoped to a *single* blob at
 *   /uploads/{yyyy-MM}/{category-slug}/{filename}
 * with create+write permissions only and a 10-minute window.
 *
 * Category model (added 2026-06-17, see PR for "6-slot uploader"):
 *   The committee's six monthly inputs each get their own subfolder under
 *   the month root. The Python snapshot pipeline reads from those slot
 *   folders directly, which lets it identify each input by its slot rather
 *   than parsing the filename (filenames stay free-form for audit trail).
 */
const {
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} = require('@azure/storage-blob');

// Authorized uploaders (lowercased). Defense-in-depth allowlist.
const ALLOWED_EMAILS = new Set([
  'jdewindt@afncorp.com',
  'juliandomingo@afncorp.com',
  'mkunisaki@afncorp.com',
  'sbarkey@afncorp.com',
  'stallman@afncorp.com',
]);

// The six canonical slot slugs. These map 1:1 to the inputs the Python
// snapshot pipeline (`scripts/build-snapshot.py`) consumes. Frontend and
// backend share the list via duplication — there's no shared TS+JS package
// in this repo, so we keep the truth in *two* places and bake a unit-style
// invariant into the smoke tests (see api/tests/upload-sas.smoke.js).
const CATEGORY_SLUGS = new Set([
  'hud-branches',
  'hoc-compare-ratios',
  'nw-data',
  'hud-total-compare-ratios',
  'hud-national-totals',
  'hud-field-office',
]);

const MAX_FILENAME_LEN = 200;
const SAS_TTL_MINUTES = 10;
const FILENAME_RE = /^[A-Za-z0-9._-]+$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

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
    const decoded = Buffer.from(header, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (_e) {
    return null;
  }
}

function extractEmail(principal) {
  if (!principal) return null;
  // SWA AAD principal: userDetails is usually the UPN/email.
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

function sanitizeFilename(raw) {
  if (typeof raw !== 'string') return null;
  // Strip any directory portion the caller might have included.
  const base = raw.split(/[/\\]/).pop() || '';
  // Reject control chars / disallowed chars.
  if (!base || base.length > MAX_FILENAME_LEN) return null;
  if (!FILENAME_RE.test(base)) return null;
  // Defensive: reject hidden / traversal-ish names.
  if (base === '.' || base === '..' || base.startsWith('.')) return null;
  return base;
}

function validateCategory(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return CATEGORY_SLUGS.has(s) ? s : null;
}

function validateMonth(raw) {
  // Optional. If supplied, must match YYYY-MM with a sane month part.
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return undefined; // sentinel for "bad input"
  const m = MONTH_RE.exec(raw.trim());
  if (!m) return undefined;
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return undefined;
  return `${m[1]}-${m[2]}`;
}

function currentMonthFolder() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function parseConnectionString(cs) {
  // Minimal parser — we only need AccountName + AccountKey.
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

  // 1) Identity check (defense-in-depth on top of SWA auth)
  const principal = decodeClientPrincipal(req);
  const email = extractEmail(principal);

  if (!email) {
    return jsonResponse(context, 401, {
      error: 'unauthenticated',
      message: 'No authenticated principal on request.',
    });
  }

  if (!ALLOWED_EMAILS.has(email)) {
    context.log.warn(`upload-sas: denied non-allowlisted user ${email}`);
    return jsonResponse(context, 403, {
      error: 'forbidden',
      message: 'You are signed in but not authorized to upload.',
    });
  }

  // 2) Validate the requested filename
  const filename = sanitizeFilename(req.body && req.body.filename);
  if (!filename) {
    return jsonResponse(context, 400, {
      error: 'invalid_filename',
      message:
        'Filename must match [A-Za-z0-9._-]+ and be 1-200 chars (no directory separators, no leading dot).',
    });
  }

  // 3) Validate the slot category
  const category = validateCategory(req.body && req.body.category);
  if (!category) {
    return jsonResponse(context, 400, {
      error: 'invalid_category',
      message: `category must be one of: ${Array.from(CATEGORY_SLUGS).sort().join(', ')}`,
    });
  }

  // 4) Validate optional month override
  const monthInput = req.body && req.body.month;
  const monthParsed = validateMonth(monthInput);
  if (monthParsed === undefined) {
    return jsonResponse(context, 400, {
      error: 'invalid_month',
      message: 'month must be a "YYYY-MM" string with a 01..12 month part.',
    });
  }
  const folder = monthParsed || currentMonthFolder();

  // 5) Storage config
  const connStr = process.env.UPLOADS_STORAGE_CONNECTION;
  const containerName = process.env.UPLOADS_CONTAINER || 'uploads';
  if (!connStr) {
    context.log.error('upload-sas: UPLOADS_STORAGE_CONNECTION is not set');
    return jsonResponse(context, 500, { error: 'server_misconfigured' });
  }
  const parsed = parseConnectionString(connStr);
  const accountName = parsed.AccountName;
  const accountKey = parsed.AccountKey;
  if (!accountName || !accountKey) {
    context.log.error('upload-sas: connection string missing AccountName/AccountKey');
    return jsonResponse(context, 500, { error: 'server_misconfigured' });
  }

  // 6) Build the blob path: {folder}/{slug}/{filename}
  const blobName = `${folder}/${category}/${filename}`;

  // 7) Issue a narrowly-scoped SAS (single blob, create+write, 10 min)
  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const startsOn = new Date(Date.now() - 2 * 60 * 1000); // 2-min skew tolerance
  const expiresOn = new Date(Date.now() + SAS_TTL_MINUTES * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('cw'), // create + write
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
      version: '2021-08-06',
    },
    credential,
  ).toString();

  const uploadUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${encodeURIComponent(folder)}/${encodeURIComponent(category)}/${encodeURIComponent(filename)}?${sas}`;

  context.log.info(
    `upload-sas: issued SAS for ${email} → ${containerName}/${blobName} (expires ${expiresOn.toISOString()})`,
  );

  return jsonResponse(context, 200, {
    uploadUrl,
    blobPath: blobName,
    container: containerName,
    category,
    month: folder,
    expiresAt: expiresOn.toISOString(),
  });
};

// Exported for smoke tests.
module.exports.CATEGORY_SLUGS = CATEGORY_SLUGS;
