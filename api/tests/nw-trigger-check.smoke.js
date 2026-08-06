/**
 * Standalone smoke test for nw-trigger-check.
 *
 *   node api/tests/nw-trigger-check.smoke.js
 *
 * Exercises the endpoint + AA client + failure-email module WITHOUT
 * hitting Automation Anywhere, real Azure Blob storage, or SMTP. Mirrors
 * the style of `upload-sas.smoke.js` and `files-api.smoke.js`.
 */

const assert = require('assert');

process.env.UPLOADS_STORAGE_CONNECTION =
  process.env.UPLOADS_STORAGE_CONNECTION ||
  'DefaultEndpointsProtocol=https;AccountName=fakeacct;AccountKey=' +
    Buffer.from('fakekey-fakekey-fakekey-fakekey-fakekey=').toString('base64') +
    ';EndpointSuffix=core.windows.net';
process.env.UPLOADS_CONTAINER = 'uploads';
process.env.AA_CR_URL = 'https://aa-fake.example.test';
process.env.AA_USERNAME = 'svc_fha_monitor_dev';
process.env.AA_API_KEY = 'test-api-key-40chars-aaaaaaaaaaaaaaaaaaa';
process.env.AA_QUEUE_ID = '100015881';
process.env.AA_DATE_COLUMN = 'Date';
process.env.RPA_SUPPORT_EMAIL = 'RPASupport@afncorp.com';
process.env.RPA_SUPPORT_CC = 'mkunisaki@afncorp.com';
process.env.RPA_TRIGGER_ENABLED = 'true';

const handlerModule = require('../nw-trigger-check');
const handler = handlerModule.handleRequest;
const aaClient = require('../lib/aa-client');
const emailModule = require('../lib/rpa-failure-email');

const REQUIRED_SLOTS = handlerModule.REQUIRED_SLOTS;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

// ── Test fixtures ──────────────────────────────────────────────────────────

function makeCtx() {
  const messages = [];
  const log = (...args) => messages.push(['info', ...args]);
  log.info = (...args) => messages.push(['info', ...args]);
  log.warn = (...args) => messages.push(['warn', ...args]);
  log.error = (...args) => messages.push(['error', ...args]);
  return {
    log,
    _messages: messages,
    res: undefined,
  };
}

/**
 * Minimal fake container client. `slots` is an object slug → array of blob
 * name suffixes (e.g. { 'hud-branches': ['a.xlsx'], 'nw-data': [] }).
 * Also supports a `markerExists` flag which the fake exists() honors.
 */
function makeContainer({
  slots = {},
  markerExists = false,
  markerWriteWillThrow = false,
  encDataBlobs = [],
  markerMetadata = null,
} = {}) {
  const blobs = [];
  for (const slot of REQUIRED_SLOTS) {
    const entries = slots[slot] || [];
    for (const entry of entries) {
      // entry can be a string or { name, size, uploadedAt, isFolderMarker }
      const spec = typeof entry === 'string' ? { name: entry } : entry;
      const rel = spec.name || 'file.bin';
      const full = `${(spec._monthOverride || currentMonth())}/${slot}/${rel}`;
      blobs.push({
        name: full,
        properties: {
          contentLength: spec.size ?? 1024,
          lastModified: new Date(spec.uploadedAt || '2026-08-01T12:00:00Z'),
          contentType: 'application/octet-stream',
        },
      });
    }
  }
  // Enc-data blobs live under `{month}/enc-data/...`.
  const encBlobs = [];
  for (const entry of encDataBlobs) {
    const spec = typeof entry === 'string' ? { name: entry } : entry;
    const rel = spec.name || 'Enc_Data.xlsx';
    encBlobs.push({
      name: `${currentMonth()}/enc-data/${rel}`,
      properties: {
        contentLength: spec.size ?? 4096,
        lastModified: new Date(spec.uploadedAt || '2026-08-02T12:00:00Z'),
        contentType: 'application/octet-stream',
      },
    });
  }
  const markerBlobs = new Set();
  const markerMeta = new Map();
  if (markerExists) {
    markerBlobs.add(`${currentMonth()}/.nw-triggered`);
    if (markerMetadata) {
      markerMeta.set(`${currentMonth()}/.nw-triggered`, markerMetadata);
    }
  }

  const container = {
    _blobs: blobs,
    _encBlobs: encBlobs,
    _markerBlobs: markerBlobs,
    _markerMeta: markerMeta,
    _markerWriteWillThrow: markerWriteWillThrow,
    _markerDeleteCalls: 0,
    listBlobsFlat(opts) {
      const prefix = (opts && opts.prefix) || '';
      const pool = [...blobs, ...encBlobs];
      const matching = pool.filter((b) => b.name.startsWith(prefix));
      return (async function* () {
        for (const b of matching) yield b;
      })();
    },
    getBlobClient(name) {
      return {
        exists: async () => markerBlobs.has(name),
        deleteIfExists: async () => {
          container._markerDeleteCalls += 1;
          const had = markerBlobs.has(name);
          markerBlobs.delete(name);
          markerMeta.delete(name);
          return { succeeded: had };
        },
      };
    },
    getBlockBlobClient(name) {
      return {
        upload: async (_body, _len, options) => {
          if (markerWriteWillThrow) {
            throw new Error('simulated marker write failure');
          }
          markerBlobs.add(name);
          if (options && options.metadata) {
            markerMeta.set(name, { ...options.metadata });
          }
          container._lastMarkerOptions = options;
          return {};
        },
      };
    },
  };
  return container;
}

function currentMonth() {
  return '2026-08';
}

function fullSlots() {
  // 5 slots, each with 1 file → completeness check passes.
  const s = {};
  for (const slot of REQUIRED_SLOTS) s[slot] = ['file.xlsx'];
  return s;
}

// ── Section 1: completeness check ─────────────────────────────────────────
(async () => {
  // 4 of 5 present
  {
    const ctx = makeCtx();
    const slots = fullSlots();
    delete slots['nw-data'];
    slots['nw-data'] = [];
    const container = makeContainer({ slots });
    await handler(ctx, { method: 'POST', body: { month: '2026-08' } }, {
      containerClient: container,
      aa: { authenticate: async () => 'unused', enqueueWorkItem: async () => ({}) },
    });
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.triggered === false &&
      Array.isArray(ctx.res.body.missing) &&
      ctx.res.body.missing.length === 1 &&
      ctx.res.body.missing[0] === 'nw-data';
    record('completeness: 4/5 slots → missing:[nw-data]', ok,
           `status=${ctx.res.status} body=${JSON.stringify(ctx.res.body)}`);
  }

  // 5 slots, each with ≥1 real file → passes to next stage
  {
    const ctx = makeCtx();
    const container = makeContainer({ slots: fullSlots() });
    let authCalled = false;
    let enqueueCalled = false;
    await handler(ctx, { method: 'POST', body: { month: '2026-08' } }, {
      containerClient: container,
      aa: {
        authenticate: async () => { authCalled = true; return 'tok-1'; },
        enqueueWorkItem: async () => { enqueueCalled = true; return { aaWorkItemId: 'wi-42' }; },
      },
    });
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.triggered === true &&
      ctx.res.body.month === '2026-08' &&
      ctx.res.body.aaWorkItemId === 'wi-42' &&
      authCalled && enqueueCalled;
    record('completeness: 5/5 → triggered:true, AA called', ok,
           `status=${ctx.res.status} body=${JSON.stringify(ctx.res.body)}`);
  }

  // 5 slots but nw-data only has a sub-folder-shaped blob (no direct file)
  {
    const ctx = makeCtx();
    const slots = fullSlots();
    // "sub-folder only" — put a blob whose name AFTER the prefix contains a `/`
    slots['nw-data'] = [{ name: 'sub/deep.xlsx' }];
    const container = makeContainer({ slots });
    await handler(ctx, { method: 'POST', body: { month: '2026-08' } }, {
      containerClient: container,
      aa: { authenticate: async () => 'unused', enqueueWorkItem: async () => ({}) },
    });
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.triggered === false &&
      Array.isArray(ctx.res.body.missing) &&
      ctx.res.body.missing.includes('nw-data');
    record('completeness: sub-folder only counts as missing', ok,
           `body=${JSON.stringify(ctx.res.body)}`);
  }

  // Empty container → all 5 missing
  {
    const ctx = makeCtx();
    const container = makeContainer({ slots: {} });
    await handler(ctx, { method: 'POST', body: { month: '2026-08' } }, {
      containerClient: container,
      aa: { authenticate: async () => 'unused', enqueueWorkItem: async () => ({}) },
    });
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.triggered === false &&
      Array.isArray(ctx.res.body.missing) &&
      ctx.res.body.missing.length === 5;
    record('completeness: empty container → all 5 missing', ok,
           `missing.length=${ctx.res.body.missing.length}`);
  }

  // ── Section 2: marker idempotency ──────────────────────────────────────
  {
    // Marker exists → alreadyTriggered:true, AA NOT invoked
    const ctx = makeCtx();
    const container = makeContainer({ slots: fullSlots(), markerExists: true });
    let aaTouched = false;
    await handler(ctx, { method: 'POST', body: { month: '2026-08' } }, {
      containerClient: container,
      aa: {
        authenticate: async () => { aaTouched = true; return 'tok'; },
        enqueueWorkItem: async () => { aaTouched = true; return {}; },
      },
    });
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.triggered === false &&
      ctx.res.body.alreadyTriggered === true &&
      aaTouched === false;
    record('idempotency: marker present → AA not called', ok,
           `aaTouched=${aaTouched} body=${JSON.stringify(ctx.res.body)}`);
  }

  {
    // Marker absent + AA success → marker written
    const ctx = makeCtx();
    const container = makeContainer({ slots: fullSlots() });
    await handler(ctx, { method: 'POST', body: { month: '2026-08' } }, {
      containerClient: container,
      aa: {
        authenticate: async () => 'tok',
        enqueueWorkItem: async () => ({ aaWorkItemId: 'wi-77' }),
      },
    });
    const markerKey = `2026-08/.nw-triggered`;
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.triggered === true &&
      container._markerBlobs.has(markerKey);
    record('idempotency: AA ok → marker written', ok,
           `markerBlobs=${JSON.stringify(Array.from(container._markerBlobs))}`);
  }

  {
    // Marker absent + AA auth fail → marker NOT written, email attempted, 500
    const ctx = makeCtx();
    const container = makeContainer({ slots: fullSlots() });
    let emailCalled = false;
    let emailParams = null;
    await handler(ctx, { method: 'POST', body: { month: '2026-08' } }, {
      containerClient: container,
      aa: {
        authenticate: async () => {
          throw new aaClient.AAError('AA auth failed with HTTP 401', {
            phase: 'auth', status: 401, body: '{"detail":"invalid apikey"}',
          });
        },
        enqueueWorkItem: async () => ({}),
      },
      emailSender: {
        sendFailureEmail: async (_ctx, params) => {
          emailCalled = true;
          emailParams = params;
          return { sent: true };
        },
      },
    });
    const ok =
      ctx.res.status === 500 &&
      ctx.res.body.triggered === false &&
      ctx.res.body.error === 'aa_auth_failed' &&
      typeof ctx.res.body.correlationId === 'string' &&
      emailCalled === true &&
      emailParams.phase === 'auth' &&
      emailParams.httpStatus === 401 &&
      container._markerBlobs.size === 0;
    record('idempotency: AA auth fail → email sent, marker NOT written, 500', ok,
           `emailCalled=${emailCalled} status=${ctx.res.status} markers=${container._markerBlobs.size}`);
  }

  {
    // Marker absent + AA enqueue fail → marker NOT written, email attempted, 500
    const ctx = makeCtx();
    const container = makeContainer({ slots: fullSlots() });
    let emailCalled = false;
    let emailParams = null;
    await handler(ctx, { method: 'POST', body: { month: '2026-08' } }, {
      containerClient: container,
      aa: {
        authenticate: async () => 'tok-x',
        enqueueWorkItem: async () => {
          throw new aaClient.AAError('AA enqueue failed with HTTP 500', {
            phase: 'enqueue', status: 500, body: 'internal error',
          });
        },
      },
      emailSender: {
        sendFailureEmail: async (_ctx, params) => {
          emailCalled = true; emailParams = params; return { sent: true };
        },
      },
    });
    const ok =
      ctx.res.status === 500 &&
      ctx.res.body.error === 'aa_enqueue_failed' &&
      emailCalled === true &&
      emailParams.phase === 'enqueue' &&
      emailParams.httpStatus === 500 &&
      container._markerBlobs.size === 0;
    record('smoke: AA enqueue 500 → email sent, marker NOT written, 500', ok,
           `emailCalled=${emailCalled} status=${ctx.res.status}`);
  }

  // ── Section 3: AA client contract ──────────────────────────────────────
  {
    // Auth: POST body is exactly {username, apiKey}
    let capturedAuth;
    const fakeFetch = async (url, opts, _timeout) => {
      capturedAuth = { url, opts };
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ token: 'AA-TOKEN-XYZ' }),
      };
    };
    const tok = await aaClient.authenticate({
      crUrl: 'https://cr.example.test/',
      username: 'svc',
      apiKey: 'k',
      fetchImpl: fakeFetch,
    });
    const bodyParsed = JSON.parse(capturedAuth.opts.body);
    const bodyKeys = Object.keys(bodyParsed).sort();
    const ok =
      tok === 'AA-TOKEN-XYZ' &&
      capturedAuth.url === 'https://cr.example.test/v2/authentication' &&
      capturedAuth.opts.method === 'POST' &&
      capturedAuth.opts.headers['Content-Type'] === 'application/json' &&
      JSON.stringify(bodyKeys) === JSON.stringify(['apiKey', 'username']) &&
      bodyParsed.username === 'svc' &&
      bodyParsed.apiKey === 'k';
    record('aa-client: auth POST body = {username, apiKey}', ok,
           `body=${capturedAuth.opts.body}`);
  }

  {
    // Enqueue: v3 shape, YYYY-MM-DD date, X-Authorization header
    let capturedEnq;
    const fakeFetch = async (url, opts, _timeout) => {
      capturedEnq = { url, opts };
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ list: [{ id: '99' }] }),
      };
    };
    const res = await aaClient.enqueueWorkItem({
      crUrl: 'https://cr.example.test/',
      token: 'THE-TOKEN',
      queueId: '100015881',
      dateColumn: 'Date',
      dateValue: '2026-08-01',
      fetchImpl: fakeFetch,
    });
    const body = JSON.parse(capturedEnq.opts.body);
    const okShape =
      Array.isArray(body.workItems) &&
      body.workItems.length === 1 &&
      body.workItems[0].json &&
      !Array.isArray(body.workItems[0].json) &&
      typeof body.workItems[0].json === 'object' &&
      body.workItems[0].json.Date === '2026-08-01';
    const okHeader =
      capturedEnq.opts.headers['X-Authorization'] === 'THE-TOKEN' &&
      capturedEnq.opts.headers['Authorization'] === undefined;
    const okId = res.aaWorkItemId === '99';
    const okUrl = capturedEnq.url ===
      'https://cr.example.test/v3/wlm/queues/100015881/workitems';
    record('aa-client: enqueue shape + X-Authorization header + id parsed',
           okShape && okHeader && okId && okUrl,
           `shape=${okShape} header=${okHeader} id=${okId} url=${okUrl}`);
  }

  {
    // Enqueue: date column with malformed date is rejected before hitting network
    let networkCalled = false;
    try {
      await aaClient.enqueueWorkItem({
        crUrl: 'https://cr.example.test',
        token: 'x',
        queueId: 'q',
        dateColumn: 'Date',
        dateValue: '2026-08-1',
        fetchImpl: async () => { networkCalled = true; return {}; },
      });
      record('aa-client: rejects malformed date', false, 'did not throw');
    } catch (err) {
      record('aa-client: rejects malformed date',
             err instanceof aaClient.AAError && !networkCalled,
             `err=${err.message}`);
    }
  }

  {
    // Timeout: promise doesn't hang forever
    const start = Date.now();
    // We can't actually call the un-injected timedFetch fast, but we can
    // check the constant exists.
    const okConst = aaClient.DEFAULT_TIMEOUT_MS === 15000;
    record('aa-client: DEFAULT_TIMEOUT_MS = 15000', okConst,
           `value=${aaClient.DEFAULT_TIMEOUT_MS}`);
    // Cheap smoke that the auth timeout path fires when fetch itself rejects.
    let raised = false;
    try {
      await aaClient.authenticate({
        crUrl: 'http://x', username: 'u', apiKey: 'k',
        fetchImpl: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
      });
    } catch (e) {
      raised = e instanceof aaClient.AAError && e.body === 'timeout';
    }
    record('aa-client: auth path surfaces AbortError as timeout', raised,
           `elapsed=${Date.now() - start}ms`);
  }

  // ── Section 4: failure email contents ──────────────────────────────────
  {
    const ctx = makeCtx();
    const captured = [];
    const fakeTransport = { sendMail: async (msg) => { captured.push(msg); } };
    const result = await emailModule.sendFailureEmail(ctx, {
      month: '2026-08',
      monthName: 'August 2026',
      aaQueueId: '100015881',
      timestamp: '2026-08-06T17:00:00Z',
      correlationId: 'corr-abc-123',
      phase: 'auth',
      httpStatus: 401,
      responseBody:
        '{"error":"bad creds","token":"leaked-token-shouldnt-be-here","Authorization":"Bearer AAAA.BBBB.CCCC"}',
      slotSummary: {
        'hud-branches':            { count: 1, latestName: 'a.xlsx', latestSize: 1024, latestUploadedAt: '2026-08-06T10:00:00Z' },
        'hoc-compare-ratios':      { count: 1, latestName: 'b.xlsx', latestSize: 2048, latestUploadedAt: '2026-08-06T10:05:00Z' },
        'nw-data':                 { count: 1, latestName: 'c.xlsx', latestSize: 3072, latestUploadedAt: '2026-08-06T10:10:00Z' },
        'hud-total-compare-ratios':{ count: 1, latestName: 'd.xlsx', latestSize: 4096, latestUploadedAt: '2026-08-06T10:15:00Z' },
        'hud-field-office':        { count: 1, latestName: 'e.xlsx', latestSize: 5120, latestUploadedAt: '2026-08-06T10:20:00Z' },
      },
      transportOverride: fakeTransport,
    });
    const msg = captured[0] || {};
    const bodyStr = msg.text || '';
    const okSubject = msg.subject === '[FHA Risk Monitor] NW trigger failed for 2026-08';
    const okTo = msg.to === 'RPASupport@afncorp.com';
    const okCc = msg.cc === 'mkunisaki@afncorp.com';
    const okMonth = bodyStr.includes('August 2026');
    const okCorr = bodyStr.includes('corr-abc-123');
    const okStatus = bodyStr.includes('HTTP status:   401');
    const okPhase = bodyStr.includes('Failure phase: auth');
    const okRetrigger = bodyStr.includes('Date = 2026-08-01');
    const okRedactToken =
      !bodyStr.includes('leaked-token-shouldnt-be-here') &&
      !bodyStr.includes('Bearer AAAA.BBBB.CCCC') &&
      bodyStr.includes('[REDACTED]');
    const okSlots =
      bodyStr.includes('hud-branches') &&
      bodyStr.includes('hoc-compare-ratios') &&
      bodyStr.includes('nw-data') &&
      bodyStr.includes('hud-total-compare-ratios') &&
      bodyStr.includes('hud-field-office');
    const okReturn = result.sent === true;
    record('email: all template fields populated + tokens redacted',
           okSubject && okTo && okCc && okMonth && okCorr && okStatus &&
           okPhase && okRetrigger && okRedactToken && okSlots && okReturn,
           `subject=${okSubject} to=${okTo} cc=${okCc} month=${okMonth} corr=${okCorr} status=${okStatus} phase=${okPhase} retrig=${okRetrigger} redact=${okRedactToken} slots=${okSlots} sent=${okReturn}`);
  }

  {
    // No SMTP config, no transport override → log-only, still returns metadata
    delete process.env.SMTP_HOST;
    const ctx = makeCtx();
    const result = await emailModule.sendFailureEmail(ctx, {
      month: '2026-08',
      monthName: 'August 2026',
      aaQueueId: '100015881',
      timestamp: '2026-08-06T17:00:00Z',
      correlationId: 'corr-xyz',
      phase: 'enqueue',
      httpStatus: 500,
      responseBody: 'boom',
      slotSummary: {},
    });
    const ok = result.sent === false && result.reason === 'no-transport' &&
               typeof result.subject === 'string' && result.text.includes('corr-xyz');
    record('email: no SMTP transport → sent:false, log-only, still rendered', ok,
           `result=${JSON.stringify({ sent: result.sent, reason: result.reason })}`);
  }

  // ── Section 5: end-to-end smoke with mocked AA + happy path receipts ─
  {
    const ctx = makeCtx();
    const container = makeContainer({ slots: fullSlots() });
    let authFetch, enqFetch;
    const authenticateOrig = aaClient.authenticate;
    const enqueueOrig = aaClient.enqueueWorkItem;
    const aa = {
      authenticate: async (args) => authenticateOrig({
        ...args, fetchImpl: async (u, o, _t) => { authFetch = { u, o }; return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ token: 'HAPPY-TOKEN' }),
        }; },
      }),
      enqueueWorkItem: async (args) => enqueueOrig({
        ...args, fetchImpl: async (u, o, _t) => { enqFetch = { u, o }; return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ list: [{ id: 'happy-1' }] }),
        }; },
      }),
    };
    await handler(ctx, { method: 'POST', body: { month: '2026-08' } }, {
      containerClient: container, aa,
    });
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.triggered === true &&
      ctx.res.body.aaWorkItemId === 'happy-1' &&
      container._markerBlobs.has('2026-08/.nw-triggered') &&
      authFetch.o.body === JSON.stringify({ username: 'svc_fha_monitor_dev', apiKey: process.env.AA_API_KEY }) &&
      enqFetch.o.headers['X-Authorization'] === 'HAPPY-TOKEN';
    record('smoke: happy path — 5 files, AA ok, marker written', ok,
           `status=${ctx.res.status} body=${JSON.stringify(ctx.res.body)}`);
  }

  // ── Section 6: feature flag ────────────────────────────────────────────
  {
    process.env.RPA_TRIGGER_ENABLED = 'false';
    const ctx = makeCtx();
    const container = makeContainer({ slots: fullSlots() });
    let aaTouched = false;
    await handler(ctx, { method: 'POST', body: { month: '2026-08' } }, {
      containerClient: container,
      aa: {
        authenticate: async () => { aaTouched = true; return 't'; },
        enqueueWorkItem: async () => { aaTouched = true; return {}; },
      },
    });
    process.env.RPA_TRIGGER_ENABLED = 'true';
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.triggered === false &&
      ctx.res.body.disabled === true &&
      aaTouched === false;
    record('feature-flag: RPA_TRIGGER_ENABLED=false short-circuits', ok,
           `body=${JSON.stringify(ctx.res.body)}`);
  }

  // ── Section 7: input validation ────────────────────────────────────────
  // GET is now a supported status probe; only unsupported verbs return 405.
  {
    const ctx = makeCtx();
    await handler(ctx, { method: 'PUT', body: { month: '2026-08' } }, {});
    record('validation: PUT method → 405', ctx.res.status === 405,
           `status=${ctx.res.status}`);
  }

  {
    const ctx = makeCtx();
    await handler(ctx, { method: 'POST', body: { month: 'not-a-month' } }, {});
    record('validation: bad month → 400', ctx.res.status === 400,
           `status=${ctx.res.status}`);
  }

  {
    const ctx = makeCtx();
    await handler(ctx, { method: 'POST', body: {} }, {});
    record('validation: missing month → 400', ctx.res.status === 400,
           `status=${ctx.res.status}`);
  }

  // ── Section 8: GET status probe ────────────────────
  {
    // 5 slots, no enc-data → allSlotsComplete:true, missing:[], encDataExists:false, AA never called
    const ctx = makeCtx();
    const container = makeContainer({ slots: fullSlots() });
    let aaTouched = false;
    await handler(
      ctx,
      { method: 'GET', query: { month: '2026-08' } },
      {
        containerClient: container,
        aa: {
          authenticate: async () => { aaTouched = true; return 't'; },
          enqueueWorkItem: async () => { aaTouched = true; return {}; },
        },
      },
    );
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.month === '2026-08' &&
      ctx.res.body.allSlotsComplete === true &&
      Array.isArray(ctx.res.body.missing) &&
      ctx.res.body.missing.length === 0 &&
      ctx.res.body.encDataExists === false &&
      aaTouched === false;
    record('GET probe: 5/5 no enc-data → complete, no encData, AA not called', ok,
           `body=${JSON.stringify(ctx.res.body)} aaTouched=${aaTouched}`);
  }

  {
    // 4/5 slots → allSlotsComplete:false, missing:[<slug>]
    const ctx = makeCtx();
    const slots = fullSlots();
    slots['hoc-compare-ratios'] = [];
    const container = makeContainer({ slots });
    await handler(
      ctx,
      { method: 'GET', query: { month: '2026-08' } },
      { containerClient: container },
    );
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.allSlotsComplete === false &&
      Array.isArray(ctx.res.body.missing) &&
      ctx.res.body.missing.length === 1 &&
      ctx.res.body.missing[0] === 'hoc-compare-ratios' &&
      ctx.res.body.encDataExists === false;
    record('GET probe: 4/5 slots → incomplete, missing lists slug', ok,
           `body=${JSON.stringify(ctx.res.body)}`);
  }

  {
    // 5 slots + enc-data blob → encDataExists:true
    const ctx = makeCtx();
    const container = makeContainer({
      slots: fullSlots(),
      encDataBlobs: ['Enc_Data.xlsx'],
    });
    await handler(
      ctx,
      { method: 'GET', query: { month: '2026-08' } },
      { containerClient: container },
    );
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.allSlotsComplete === true &&
      ctx.res.body.encDataExists === true;
    record('GET probe: 5/5 + enc-data present → encDataExists:true', ok,
           `body=${JSON.stringify(ctx.res.body)}`);
  }

  {
    // GET with bad month → 400
    const ctx = makeCtx();
    await handler(
      ctx,
      { method: 'GET', query: { month: 'nope' } },
      { containerClient: makeContainer({ slots: fullSlots() }) },
    );
    record('GET probe: bad month query → 400', ctx.res.status === 400,
           `status=${ctx.res.status}`);
  }

  // ── Section 9: POST force=true ────────────────────
  {
    // Marker exists + force:true → AA IS called, marker rewritten, {triggered:true, forced:true, aaWorkItemId}
    const ctx = makeCtx();
    const container = makeContainer({
      slots: fullSlots(),
      markerExists: true,
      markerMetadata: { triggeredAt: '2026-07-01T00:00:00Z', correlationId: 'old-corr' },
    });
    let authCalled = false;
    let enqueueCalled = false;
    await handler(
      ctx,
      { method: 'POST', body: { month: '2026-08', force: true } },
      {
        containerClient: container,
        aa: {
          authenticate: async () => { authCalled = true; return 'tok'; },
          enqueueWorkItem: async () => { enqueueCalled = true; return { aaWorkItemId: 'wi-force-1' }; },
        },
      },
    );
    const markerKey = `2026-08/.nw-triggered`;
    const meta = container._markerMeta.get(markerKey);
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.triggered === true &&
      ctx.res.body.forced === true &&
      ctx.res.body.aaWorkItemId === 'wi-force-1' &&
      authCalled && enqueueCalled &&
      container._markerBlobs.has(markerKey) &&
      container._markerDeleteCalls >= 1 &&
      meta && meta.triggeredAt !== '2026-07-01T00:00:00Z' &&
      meta.correlationId !== 'old-corr';
    record('force: marker exists + force:true → AA called, marker rewritten, forced:true', ok,
           `status=${ctx.res.status} body=${JSON.stringify(ctx.res.body)} deleteCalls=${container._markerDeleteCalls}`);
  }

  {
    // 4/5 slots + force:true → still returns {triggered:false, missing:[...]}. Force does NOT override completeness.
    const ctx = makeCtx();
    const slots = fullSlots();
    slots['hud-field-office'] = [];
    const container = makeContainer({ slots });
    let aaTouched = false;
    await handler(
      ctx,
      { method: 'POST', body: { month: '2026-08', force: true } },
      {
        containerClient: container,
        aa: {
          authenticate: async () => { aaTouched = true; return 't'; },
          enqueueWorkItem: async () => { aaTouched = true; return {}; },
        },
      },
    );
    const ok =
      ctx.res.status === 200 &&
      ctx.res.body.triggered === false &&
      Array.isArray(ctx.res.body.missing) &&
      ctx.res.body.missing.includes('hud-field-office') &&
      aaTouched === false;
    record('force: 4/5 + force:true → still missing, AA not called', ok,
           `body=${JSON.stringify(ctx.res.body)} aaTouched=${aaTouched}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log(`SUMMARY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL: ${f.name}${f.detail ? '  — ' + f.detail : ''}`);
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error('SMOKE TEST CRASHED:', err.stack || err.message);
  process.exit(1);
});
