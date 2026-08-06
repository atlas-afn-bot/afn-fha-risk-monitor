/**
 * Small Automation Anywhere Control Room (v2019 / A360) client.
 *
 * Only implements the two calls we need:
 *   1) POST /v1/authentication  — exchange svc account + apiKey for a token
 *   2) POST /v3/wlm/queues/{id}/workitems — enqueue a work item
 *
 * We deliberately do NOT pull in the vendor SDK. The AA REST surface is
 * small, the SDK adds ~megabytes to a Function's cold-start budget, and
 * mocking a hand-rolled client is much simpler in tests. Global `fetch`
 * from Node 20 is enough.
 *
 * Common AA integration mistakes this file guards against:
 *   - Passing the token as `Authorization: Bearer <token>` — AA A360
 *     requires the header `X-Authorization: <token>` and does NOT
 *     accept the `Bearer` scheme on this endpoint.
 *   - Passing `apiKey` under `password`. AA supports both, but only when
 *     the account is configured for password auth. The FHA service
 *     account is API-key-only, so we send `{ username, apiKey }`.
 *   - Formatting the Date column as anything other than `YYYY-MM-DD`.
 *     The bot's Data Table lookup uses a string equality check on the
 *     Date column and rejects other shapes silently (the work item just
 *     sits `PENDING` forever).
 */

const DEFAULT_TIMEOUT_MS = 15_000;

class AAError extends Error {
  constructor(message, { phase, status, body }) {
    super(message);
    this.name = 'AAError';
    this.phase = phase;      // 'auth' | 'enqueue' | 'other'
    this.status = status;    // HTTP status if available, else null
    this.body = body;        // raw response body (redacted upstream)
  }
}

function redactBody(text) {
  if (typeof text !== 'string') return text;
  // Belt & braces: strip anything that looks like a token/apiKey out of
  // response bodies before we surface them to the caller (which writes
  // them into an email + JSON response).
  return text
    // Bearer tokens (defensive — AA shouldn't emit these, but just in case)
    .replace(/Bearer\s+[A-Za-z0-9\-_\.=]+/gi, 'Bearer [REDACTED]')
    // Explicit token JSON fields ("token":"...", "apiKey":"...", etc)
    .replace(/("(?:token|apiKey|password|X-Authorization|authorization)"\s*:\s*")([^"]*)(")/gi,
             '$1[REDACTED]$3');
}

async function timedFetch(url, options, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Exchange (username, apiKey) for a bearer token.
 * Returns the raw token string on success. Throws AAError on failure.
 */
async function authenticate({ crUrl, username, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl }) {
  const impl = fetchImpl || timedFetch;
  // AA A2019 dev returns 404 on /v1/authentication; the correct path is
  // /v2/authentication. Verified 2026-08-06 against a2019afn-1dev.
  const url = `${trimTrailingSlash(crUrl)}/v2/authentication`;

  let res;
  try {
    res = await impl(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username, apiKey }),
      },
      timeoutMs,
    );
  } catch (err) {
    throw new AAError(`AA auth network error: ${err.message}`, {
      phase: 'auth',
      status: null,
      body: err.name === 'AbortError' ? 'timeout' : String(err.message || err),
    });
  }

  const rawText = await safeText(res);
  if (!res.ok) {
    throw new AAError(`AA auth failed with HTTP ${res.status}`, {
      phase: 'auth',
      status: res.status,
      body: redactBody(rawText).slice(0, 2000),
    });
  }
  let parsed;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch (_e) {
    throw new AAError('AA auth returned non-JSON body', {
      phase: 'auth',
      status: res.status,
      body: redactBody(rawText).slice(0, 2000),
    });
  }
  const token = parsed && typeof parsed.token === 'string' ? parsed.token : null;
  if (!token) {
    throw new AAError('AA auth response missing token', {
      phase: 'auth',
      status: res.status,
      body: '[REDACTED body without token]',
    });
  }
  return token;
}

/**
 * Enqueue a single work item with a single JSON column.
 *
 *   dateColumn: name of the AA queue column, e.g. "Date"
 *   dateValue:  string in YYYY-MM-DD format
 *
 * Returns { aaWorkItemId? } if we can parse an id out of the response,
 * else {}. Throws AAError on failure.
 */
async function enqueueWorkItem({
  crUrl,
  token,
  queueId,
  dateColumn,
  dateValue,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl,
}) {
  const impl = fetchImpl || timedFetch;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue))) {
    throw new AAError(`enqueue: dateValue must be YYYY-MM-DD, got "${dateValue}"`, {
      phase: 'other',
      status: null,
      body: null,
    });
  }
  const url = `${trimTrailingSlash(crUrl)}/v3/wlm/queues/${encodeURIComponent(queueId)}/workitems`;
  // AA v3 WLM expects json as an object keyed by column name, NOT the
  // {name,value} array shape. Verified 2026-08-06 against queue 100015881;
  // the {name,value} shape returns HTTP 400 "Required column 'X' missing in json".
  const body = {
    workItems: [
      {
        json: { [dateColumn]: dateValue },
      },
    ],
  };

  let res;
  try {
    res = await impl(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          // AA A360 requires this header name — NOT `Authorization: Bearer …`.
          'X-Authorization': token,
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
  } catch (err) {
    throw new AAError(`AA enqueue network error: ${err.message}`, {
      phase: 'enqueue',
      status: null,
      body: err.name === 'AbortError' ? 'timeout' : String(err.message || err),
    });
  }

  const rawText = await safeText(res);
  if (!res.ok) {
    throw new AAError(`AA enqueue failed with HTTP ${res.status}`, {
      phase: 'enqueue',
      status: res.status,
      body: redactBody(rawText).slice(0, 2000),
    });
  }
  // Best-effort parse of the returned work item id (AA sometimes returns
  // { list: [ { id: "1234" } ] } and sometimes { workItems: [...] }).
  let aaWorkItemId;
  try {
    const parsed = rawText ? JSON.parse(rawText) : null;
    if (parsed) {
      const first =
        (Array.isArray(parsed.list) && parsed.list[0]) ||
        (Array.isArray(parsed.workItems) && parsed.workItems[0]) ||
        null;
      if (first && (first.id || first.workItemId)) {
        aaWorkItemId = String(first.id || first.workItemId);
      }
    }
  } catch (_e) {
    // non-fatal — we still enqueued successfully
  }
  return aaWorkItemId ? { aaWorkItemId } : {};
}

async function safeText(res) {
  try {
    return await res.text();
  } catch (_e) {
    return '';
  }
}

function trimTrailingSlash(s) {
  return String(s || '').replace(/\/+$/, '');
}

module.exports = {
  authenticate,
  enqueueWorkItem,
  AAError,
  // exported for tests
  _redactBody: redactBody,
  DEFAULT_TIMEOUT_MS,
};
