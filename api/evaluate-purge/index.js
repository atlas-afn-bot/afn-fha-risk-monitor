/**
 * POST /api/evaluate/purge
 *
 * Manual purge-all endpoint for the evaluator's blob-backed response cache
 * (docs/scenario-builder-design.md §9 Q11). Intended use = registry version
 * bumps.
 *
 * Auth:
 *   - Route-layer SSO via staticwebapp.config.json (same as everything else).
 *   - Additional admin gate via `X-MS-CLIENT-PRINCIPAL` email membership in
 *     ADMIN_ALLOWLIST env var (comma-separated).
 *
 * TODO(admin-gate): The v1 admin gate is a hardcoded email allowlist from
 * ADMIN_ALLOWLIST. The design doc leaves the mechanism for a follow-up PR;
 * see §5.4 admin authoring and §9 Q10. When we wire an in-site admin form
 * we should promote this gate to the same AAD group / role check.
 *
 * Response 200: { purged_count: N }
 * Response 401: { error: 'unauthenticated' } — principal missing/invalid
 * Response 403: { error: 'forbidden' } — principal not in allowlist
 */
const { purgeAll } = require('../lib/evaluator/cache');

const SNAPSHOTS_CONTAINER = process.env.SNAPSHOTS_CONTAINER || 'snapshots';

function jsonResponse(context, status, body) {
  context.res = {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body,
  };
}

function parsePrincipal(req) {
  const headers = (req && req.headers) || {};
  const raw = headers['x-ms-client-principal'] || headers['X-MS-CLIENT-PRINCIPAL'];
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (_err) {
    return null;
  }
}

function principalEmail(principal) {
  if (!principal) return null;
  // SWA populates userDetails with the email/UPN.
  if (typeof principal.userDetails === 'string') return principal.userDetails.toLowerCase();
  const emailClaim =
    (principal.claims || []).find(
      (c) => c && (c.typ === 'emails' || c.typ === 'email' || (c.type && /email/i.test(c.type))),
    ) || null;
  if (emailClaim && emailClaim.val) return String(emailClaim.val).toLowerCase();
  return null;
}

function isAllowed(email) {
  const raw = process.env.ADMIN_ALLOWLIST || '';
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(email || '').toLowerCase());
}

module.exports = async function (context, req) {
  const connStr = process.env.UPLOADS_STORAGE_CONNECTION;
  if (!connStr) {
    return jsonResponse(context, 500, {
      error: 'server_misconfigured',
      message: 'UPLOADS_STORAGE_CONNECTION is not set.',
    });
  }

  const principal = parsePrincipal(req);
  if (!principal) {
    return jsonResponse(context, 401, { error: 'unauthenticated' });
  }
  const email = principalEmail(principal);
  if (!isAllowed(email)) {
    return jsonResponse(context, 403, {
      error: 'forbidden',
      message: 'Caller not in ADMIN_ALLOWLIST.',
    });
  }

  try {
    const result = await purgeAll({ connStr, container: SNAPSHOTS_CONTAINER });
    return jsonResponse(context, 200, Object.assign({ purged_by: email }, result));
  } catch (err) {
    context.log.error(`evaluate/purge: failed: ${err && err.message}`);
    return jsonResponse(context, 500, { error: 'purge_failed', message: err && err.message });
  }
};
