/**
 * Standalone smoke test for /api/regenerate-risk-factor-bullets.
 *
 *   node api/tests/regenerate-risk-factor-bullets.smoke.js
 *
 * Exercises auth parsing, request validation, blob read/write shapes, and
 * ETag conflict → 409 handling without hitting Azure. `BlobServiceClient`
 * and the `fetch` used to call Azure OpenAI are both mocked at load time.
 * Mirrors the style of `snapshot-api.smoke.js`.
 */
const Module = require('module');
const { Readable } = require('stream');

process.env.UPLOADS_STORAGE_CONNECTION =
  process.env.UPLOADS_STORAGE_CONNECTION ||
  'DefaultEndpointsProtocol=https;AccountName=fakeacct;AccountKey=' +
    Buffer.from('fakekey-fakekey-fakekey-fakekey-fakekey=').toString('base64') +
    ';EndpointSuffix=core.windows.net';
process.env.SNAPSHOTS_CONTAINER = 'snapshots';
process.env.AZURE_OPENAI_ENDPOINT = 'https://fake-openai.example.com/';
process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-4-fake';
process.env.AZURE_OPENAI_API_KEY = 'sk-fake';
process.env.AZURE_OPENAI_API_VERSION = '2025-01-01-preview';

// ── Fixture snapshot the mock blob store hands out ──
const FIXTURE_SNAPSHOT = {
  snapshot_meta: {
    period: '2026-06',
    label: 'June 2026',
    generated_at: '2026-08-11T19:59:53Z',
  },
  loans: [],
  offices: [],
  risk_factor_bullets: {
    bullets: [
      { text: 'baseline baked bullet', severity: 'yellow' },
    ],
    generated_at: '2026-08-01T00:00:00Z',
    generated_by: 'scripts/build-snapshot.py v1.0',
    regenerated_at: null,
    regenerated_by: null,
    schema_version: 1,
  },
};

const FIXTURES = {
  '2026-06.json': JSON.stringify(FIXTURE_SNAPSHOT),
};

function makeReadable(text) {
  return Readable.from([Buffer.from(text, 'utf8')]);
}

// Captured by the mocked upload() so tests can assert what got written.
let lastUpload = null;

function makeMockBlobServiceClient(opts) {
  const failMode = (opts && opts.failMode) || null;
  const returnEtag = (opts && opts.etag) || '"fake-etag-abc123"';
  return {
    getContainerClient(_name) {
      return {
        getBlobClient(name) {
          return {
            async exists() {
              return Object.prototype.hasOwnProperty.call(FIXTURES, name);
            },
            async download() {
              if (failMode === 'read-throws') {
                throw new Error('mock read failure');
              }
              const text = FIXTURES[name];
              if (text == null) {
                const e = new Error(`BlobNotFound: ${name}`);
                e.statusCode = 404;
                throw e;
              }
              return {
                etag: returnEtag,
                contentLength: Buffer.byteLength(text, 'utf8'),
                readableStreamBody: makeReadable(text),
              };
            },
          };
        },
        getBlockBlobClient(name) {
          return {
            async upload(body, _len, uploadOpts) {
              if (failMode === 'write-throws') {
                throw new Error('mock write failure');
              }
              if (failMode === 'etag-conflict') {
                const e = new Error('The condition specified using HTTP conditional header(s) is not met.');
                e.statusCode = 412;
                throw e;
              }
              lastUpload = { name, body, uploadOpts };
            },
          };
        },
      };
    },
  };
}

// ── Mock @azure/storage-blob ──
let currentFailMode = null;
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === '@azure/storage-blob') {
    const real = originalLoad.call(this, request, parent, ...rest);
    return {
      ...real,
      BlobServiceClient: {
        fromConnectionString: () =>
          makeMockBlobServiceClient({ failMode: currentFailMode }),
      },
    };
  }
  return originalLoad.call(this, request, parent, ...rest);
};

// ── Mock global fetch (used only by the Azure OpenAI call) ──
let fetchMode = 'happy';
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (_url, _opts) {
  if (fetchMode === 'openai-500') {
    return {
      ok: false,
      status: 500,
      text: async () => 'upstream boom',
    };
  }
  if (fetchMode === 'openai-empty-bullets') {
    const body = JSON.stringify({ executiveSummary: [] });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: body } }],
      }),
    };
  }
  if (fetchMode === 'openai-bad-json') {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'not json at all {' } }],
      }),
    };
  }
  // happy path
  const body = JSON.stringify({
    executiveSummary: [
      { text: 'Manual UW loans DQ at 12.3% vs Auto at 3.4% — significant lift.', severity: 'red' },
      { text: 'High-LTV (>=96.5) DQ at 5.6% dominates portfolio risk.', severity: 'yellow' },
    ],
    actionItems: [],
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: body } }],
    }),
  };
};

const handler = require('../regenerate-risk-factor-bullets/index');

// Helper: build a fake SWA principal header value for `oid` → given string.
function makePrincipalHeader(oid) {
  const principal = {
    userId: 'user-guid',
    userDetails: 'test@example.com',
    identityProvider: 'aad',
    userRoles: ['authenticated'],
    claims: [
      { typ: 'oid', val: oid },
      { typ: 'name', val: 'Test User' },
    ],
  };
  return Buffer.from(JSON.stringify(principal), 'utf8').toString('base64');
}

function makeCtx() {
  const log = Object.assign(() => {}, {
    warn: () => {},
    error: () => {},
    info: () => {},
  });
  return { log, bindingData: {}, res: undefined };
}

async function callHandler(reqOverrides) {
  lastUpload = null;
  const ctx = makeCtx();
  const req = Object.assign(
    {
      method: 'POST',
      headers: {
        'x-ms-client-principal': makePrincipalHeader('entra-oid-11111'),
      },
      body: {
        period: '2026-06',
        facts:
          'FHA LOAN PORTFOLIO ANALYSIS DATA:\n\nPORTFOLIO OVERVIEW:\n- Total Loans: 12,345\n- Overall DQ Rate: 4.20%\n(more facts here — long enough to pass the 50-char floor)',
      },
      query: {},
    },
    reqOverrides || {},
  );
  await handler(ctx, req);
  return ctx.res;
}

// ─────────────────────────────────────────────────────────────────────────
(async () => {
  let failed = 0;
  const cases = [];

  cases.push({
    name: 'happy path → 200 with bullets + regenerated_by from principal + blob upload',
    setup: () => {
      currentFailMode = null;
      fetchMode = 'happy';
    },
    run: () => callHandler(),
    expect: 200,
    assertBody: (b) =>
      Array.isArray(b.bullets) &&
      b.bullets.length === 2 &&
      b.regenerated_by === 'entra-oid-11111' &&
      typeof b.regenerated_at === 'string' &&
      b.regenerated_at.length > 10,
    assertExtra: () => {
      if (!lastUpload) return 'no upload captured';
      const written = JSON.parse(lastUpload.body);
      const rfb = written.risk_factor_bullets;
      if (!rfb || !Array.isArray(rfb.bullets) || rfb.bullets.length !== 2) {
        return 'written snapshot bullets shape wrong';
      }
      if (rfb.regenerated_by !== 'entra-oid-11111') return 'written regenerated_by wrong';
      if (rfb.generated_at !== '2026-08-01T00:00:00Z') {
        return 'original generated_at should be preserved';
      }
      if (
        !lastUpload.uploadOpts ||
        !lastUpload.uploadOpts.conditions ||
        !lastUpload.uploadOpts.conditions.ifMatch
      ) {
        return 'expected If-Match ETag condition on upload';
      }
      return null;
    },
  });

  cases.push({
    name: 'missing principal → 401',
    setup: () => {
      currentFailMode = null;
      fetchMode = 'happy';
    },
    run: () => callHandler({ headers: {} }),
    expect: 401,
    assertBody: (b) => b.error === 'unauthenticated',
  });

  cases.push({
    name: 'malformed principal (not base64) → 401',
    setup: () => {
      currentFailMode = null;
      fetchMode = 'happy';
    },
    run: () =>
      callHandler({
        headers: {
          'x-ms-client-principal': '@@@ definitely not base64 @@@',
        },
      }),
    expect: 401,
    assertBody: (b) => b.error === 'unauthenticated',
  });

  cases.push({
    name: 'GET → 405',
    setup: () => {
      currentFailMode = null;
      fetchMode = 'happy';
    },
    run: () => callHandler({ method: 'GET' }),
    expect: 405,
    assertBody: (b) => b.error === 'method_not_allowed',
  });

  cases.push({
    name: 'invalid period format → 400',
    setup: () => {
      currentFailMode = null;
      fetchMode = 'happy';
    },
    run: () =>
      callHandler({
        body: { period: '2026/06', facts: 'x'.repeat(80) },
      }),
    expect: 400,
    assertBody: (b) => b.error === 'invalid_period',
  });

  cases.push({
    name: 'reserved period "index" → 400',
    setup: () => {
      currentFailMode = null;
      fetchMode = 'happy';
    },
    run: () =>
      callHandler({
        body: { period: 'index', facts: 'x'.repeat(80) },
      }),
    // "index" fails the YYYY-MM regex first, so 400 with invalid_period.
    expect: 400,
    assertBody: (b) => b.error === 'invalid_period',
  });

  cases.push({
    name: 'missing/short facts → 400',
    setup: () => {
      currentFailMode = null;
      fetchMode = 'happy';
    },
    run: () =>
      callHandler({
        body: { period: '2026-06', facts: 'too short' },
      }),
    expect: 400,
    assertBody: (b) => b.error === 'invalid_facts',
  });

  cases.push({
    name: 'nonexistent period → 404',
    setup: () => {
      currentFailMode = null;
      fetchMode = 'happy';
    },
    run: () =>
      callHandler({
        body: { period: '2099-01', facts: 'x'.repeat(80) },
      }),
    expect: 404,
    assertBody: (b) => b.error === 'not_found',
  });

  cases.push({
    name: 'blob write ETag conflict → 409',
    setup: () => {
      currentFailMode = 'etag-conflict';
      fetchMode = 'happy';
    },
    run: () => callHandler(),
    expect: 409,
    assertBody: (b) => b.error === 'etag_conflict',
  });

  cases.push({
    name: 'Azure OpenAI 500 → 502',
    setup: () => {
      currentFailMode = null;
      fetchMode = 'openai-500';
    },
    run: () => callHandler(),
    expect: 502,
    assertBody: (b) => b.error === 'llm_call_failed',
  });

  cases.push({
    name: 'Azure OpenAI returns 0 bullets → 502',
    setup: () => {
      currentFailMode = null;
      fetchMode = 'openai-empty-bullets';
    },
    run: () => callHandler(),
    expect: 502,
    assertBody: (b) => b.error === 'llm_call_failed',
  });

  cases.push({
    name: 'Azure OpenAI returns non-JSON → 502',
    setup: () => {
      currentFailMode = null;
      fetchMode = 'openai-bad-json';
    },
    run: () => callHandler(),
    expect: 502,
    assertBody: (b) => b.error === 'llm_call_failed',
  });

  // ── parseClientPrincipal unit checks ──
  {
    const good = makePrincipalHeader('oid-happy');
    const parsed = handler.parseClientPrincipal({ headers: { 'x-ms-client-principal': good } });
    cases.push({
      name: 'parseClientPrincipal: happy path returns oid',
      setup: () => {},
      run: async () => ({ status: parsed.ok ? 200 : 500, body: parsed }),
      expect: 200,
      assertBody: (b) => b.oid === 'oid-happy',
    });
  }
  {
    const parsed = handler.parseClientPrincipal({ headers: {} });
    cases.push({
      name: 'parseClientPrincipal: missing header returns ok=false',
      setup: () => {},
      run: async () => ({ status: !parsed.ok ? 200 : 500, body: parsed }),
      expect: 200,
      assertBody: (b) => b.ok === false && b.reason === 'missing_principal_header',
    });
  }

  // ── normalizeBullet unit checks ──
  cases.push({
    name: 'normalizeBullet: coerces bogus severity to neutral',
    setup: () => {},
    run: async () => {
      const b = handler.normalizeBullet({ text: 'hi', severity: 'purple' });
      return { status: b && b.severity === 'neutral' ? 200 : 500, body: b };
    },
    expect: 200,
  });
  cases.push({
    name: 'normalizeBullet: drops empty text',
    setup: () => {},
    run: async () => {
      const b = handler.normalizeBullet({ text: '   ', severity: 'red' });
      return { status: b === null ? 200 : 500, body: { got: b } };
    },
    expect: 200,
  });

  // ── loadSystemPrompt should return SOMETHING non-empty ──
  cases.push({
    name: 'loadSystemPrompt returns a non-empty prompt (file or inline fallback)',
    setup: () => {},
    run: async () => {
      const ctx = makeCtx();
      const { prompt } = handler.loadSystemPrompt(ctx);
      return {
        status: typeof prompt === 'string' && prompt.length > 100 ? 200 : 500,
        body: { len: (prompt || '').length },
      };
    },
    expect: 200,
  });

  for (const c of cases) {
    if (c.setup) c.setup();
    let res;
    try {
      res = await c.run();
    } catch (e) {
      console.log(`FAIL  ${c.name} → threw ${e && e.message}`);
      failed++;
      continue;
    }
    const ok = res && res.status === c.expect;
    let tag = ok ? 'PASS' : 'FAIL';
    let bodyOK = true;
    if (ok && c.assertBody) {
      bodyOK = !!c.assertBody(res.body || {});
      if (!bodyOK) tag = 'FAIL';
    }
    let extraErr = null;
    if (ok && bodyOK && c.assertExtra) {
      extraErr = c.assertExtra();
      if (extraErr) tag = 'FAIL';
    }
    console.log(
      `${tag}  ${c.name} → status=${res && res.status}${c.assertBody ? ' assertBody=' + bodyOK : ''}${
        extraErr ? ' extra=' + extraErr : ''
      }`,
    );
    if (tag === 'FAIL') {
      failed++;
      console.log('       body:', JSON.stringify(res && res.body).slice(0, 300));
    }
  }
  // Restore
  globalThis.fetch = originalFetch;
  process.exit(failed === 0 ? 0 : 1);
})();
