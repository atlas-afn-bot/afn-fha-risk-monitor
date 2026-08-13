/**
 * POST /api/evaluate
 *
 * Scenario evaluator endpoint — PR-A of the Scenario Builder work
 * (docs/scenario-builder-design.md §3.2).
 *
 * Auth is enforced at the SWA route layer via `staticwebapp.config.json`
 * (`allowedRoles: ["authenticated"]`) — same pattern as `/api/snapshot/*`
 * and `/api/ai-analysis`. We keep `authLevel: anonymous` on the function
 * binding so SWA is the sole gate.
 *
 * Request body:
 *   {
 *     "snapshot_month": "YYYY-MM",
 *     "predicates": [ { "predicate_id": "…", "params": {…} }, … ],
 *     "composition_op": "AND" | "OR"
 *   }
 *
 * Response: see design doc §3.2. Includes `cache_key` for downstream use.
 *
 * Caching:
 *   Blob at `snapshots/evaluations/{cache_key}.json`. Read-through; write on
 *   miss. Errors reading the cache are treated as a miss (never block).
 *   Cache invalidation on snapshot rewrite is M-only and handled outside
 *   this handler (§9 Q11); manual purge is `POST /api/evaluate/purge`.
 */
const { evaluate } = require('../lib/evaluator');
const { loadSnapshot } = require('../lib/evaluator/snapshotLoader');
const { cacheKey, readCache, writeCache } = require('../lib/evaluator/cache');

const SNAPSHOTS_CONTAINER = process.env.SNAPSHOTS_CONTAINER || 'snapshots';

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

function readRequestBody(req) {
  const body = req && req.body;
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (_err) {
      return null;
    }
  }
  return body;
}

function validate(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'invalid_body: expected JSON object';
  }
  if (!payload.snapshot_month || !/^\d{4}-\d{2}$/.test(payload.snapshot_month)) {
    return "invalid_snapshot_month: expected 'YYYY-MM'";
  }
  if (!Array.isArray(payload.predicates)) {
    return 'invalid_predicates: expected array';
  }
  if (payload.composition_op && payload.composition_op !== 'AND' && payload.composition_op !== 'OR') {
    return "invalid_composition_op: expected 'AND' or 'OR'";
  }
  return null;
}

module.exports = async function (context, req) {
  const connStr = process.env.UPLOADS_STORAGE_CONNECTION;
  if (!connStr) {
    return jsonResponse(context, 500, {
      error: 'server_misconfigured',
      message: 'UPLOADS_STORAGE_CONNECTION is not set.',
    });
  }

  const payload = readRequestBody(req);
  const validationError = validate(payload);
  if (validationError) {
    return jsonResponse(context, 400, { error: 'validation_error', message: validationError });
  }

  const { snapshot_month, predicates } = payload;
  const composition_op = payload.composition_op || 'OR';

  const key = cacheKey({ snapshot_month, predicates, composition_op });

  // Cache read-through.
  const cached = await readCache({ connStr, container: SNAPSHOTS_CONTAINER, key });
  if (cached) {
    return jsonResponse(context, 200, Object.assign({}, cached, { cache_key: key, cache: 'hit' }));
  }

  // Miss → load snapshot and compute.
  let snapshot;
  try {
    snapshot = await loadSnapshot({ connStr, container: SNAPSHOTS_CONTAINER, period: snapshot_month });
  } catch (err) {
    if (err && err.code === 'snapshot_not_found') {
      return jsonResponse(context, 404, { error: 'snapshot_not_found', message: err.message });
    }
    context.log.error(`evaluate: snapshot load failed: ${err && err.message}`);
    return jsonResponse(context, 500, { error: 'snapshot_load_failed', message: err && err.message });
  }

  let result;
  try {
    result = evaluate({ snapshot, predicates, composition_op, snapshot_month });
  } catch (err) {
    if (err && err.code === 'unknown_predicate') {
      return jsonResponse(context, 400, { error: 'unknown_predicate', message: err.message });
    }
    context.log.error(`evaluate: computation failed: ${err && err.message}`);
    return jsonResponse(context, 500, { error: 'evaluation_failed', message: err && err.message });
  }

  const response = Object.assign({}, result, { cache_key: key, cache: 'miss' });

  // Best-effort cache write; do not block response on failure.
  writeCache({ connStr, container: SNAPSHOTS_CONTAINER, key, body: result }).catch((err) => {
    context.log.warn(`evaluate: cache write failed: ${err && err.message}`);
  });

  return jsonResponse(context, 200, response);
};
