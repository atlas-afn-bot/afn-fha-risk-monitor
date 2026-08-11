/**
 * Standalone smoke test for the snapshot API (index + period functions).
 *
 *   node api/tests/snapshot-api.smoke.js
 *
 * Exercises route-param validation and blob read/parse paths without hitting
 * Azure \u2014 `BlobServiceClient` is module-mocked at load time via Node's
 * require cache. Mirrors the style of `files-api.smoke.js`.
 */
const Module = require('module');
const { Readable } = require('stream');

process.env.UPLOADS_STORAGE_CONNECTION =
  process.env.UPLOADS_STORAGE_CONNECTION ||
  'DefaultEndpointsProtocol=https;AccountName=fakeacct;AccountKey=' +
    Buffer.from('fakekey-fakekey-fakekey-fakekey-fakekey=').toString('base64') +
    ';EndpointSuffix=core.windows.net';
process.env.SNAPSHOTS_CONTAINER = 'snapshots';

// ---- Fixture blobs the mock knows about ----------------------------------
const INDEX_JSON = {
  periods: [
    { period: '2026-06', label: 'June 2026', generated_at: '2026-08-11T19:59:53Z' },
    { period: '2026-05', label: 'May 2026', generated_at: '2026-07-15T12:00:00Z' },
  ],
};

const SNAPSHOT_2026_06 = {
  snapshot_meta: {
    period: '2026-06',
    label: 'June 2026',
    generated_at: '2026-08-11T19:59:53Z',
  },
  offices: [],
};

const FIXTURES = {
  'index.json': JSON.stringify(INDEX_JSON),
  '2026-06.json': JSON.stringify(SNAPSHOT_2026_06),
  'malformed.json': '{not-json',
};

function makeReadable(text) {
  const buf = Buffer.from(text, 'utf8');
  return Readable.from([buf]);
}

function makeMockBlobServiceClient(opts) {
  const failMode = (opts && opts.failMode) || null;
  return {
    getContainerClient(_name) {
      return {
        getBlobClient(name) {
          return {
            async exists() {
              if (failMode === 'exists-throws') {
                throw new Error('mock exists() failure');
              }
              return Object.prototype.hasOwnProperty.call(FIXTURES, name);
            },
            async download() {
              if (failMode === 'download-throws') {
                throw new Error('mock download() failure');
              }
              const text = FIXTURES[name];
              if (text == null) {
                const e = new Error(`BlobNotFound: ${name}`);
                e.statusCode = 404;
                throw e;
              }
              return {
                contentLength: Buffer.byteLength(text, 'utf8'),
                readableStreamBody: makeReadable(text),
              };
            },
          };
        },
      };
    },
  };
}

// Intercept require('@azure/storage-blob') for the Functions under test.
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

const indexHandler = require('../snapshot-index/index');
const periodHandler = require('../snapshot-period/index');

function makeCtx(bindingData) {
  return {
    log: Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} }),
    bindingData: bindingData || {},
    res: undefined,
  };
}

async function callIndex() {
  const ctx = makeCtx();
  await indexHandler(ctx, { method: 'GET', headers: {}, query: {} });
  return ctx.res;
}

async function callPeriod(period) {
  const ctx = makeCtx({ period });
  await periodHandler(ctx, { method: 'GET', headers: {}, query: {} });
  return ctx.res;
}

(async () => {
  let failed = 0;
  const cases = [];

  // ----- index
  cases.push({
    name: 'index: happy path \u2192 200 with periods list',
    setup: () => {
      currentFailMode = null;
    },
    run: () => callIndex(),
    expect: 200,
    assertBody: (b) =>
      Array.isArray(b.periods) &&
      b.periods.length === 2 &&
      b.periods[0].period === '2026-06',
  });

  cases.push({
    name: 'index: download() throws \u2192 500',
    setup: () => {
      currentFailMode = 'download-throws';
    },
    run: () => callIndex(),
    expect: 500,
    assertBody: (b) => b.error === 'read_failed',
  });

  // ----- period
  cases.push({
    name: 'period 2026-06: happy path \u2192 200 with matching snapshot_meta',
    setup: () => {
      currentFailMode = null;
    },
    run: () => callPeriod('2026-06'),
    expect: 200,
    assertBody: (b) =>
      b.snapshot_meta &&
      b.snapshot_meta.period === '2026-06' &&
      b.snapshot_meta.label === 'June 2026',
  });

  cases.push({
    name: 'period: missing blob \u2192 404',
    setup: () => {
      currentFailMode = null;
    },
    run: () => callPeriod('2099-01'),
    expect: 404,
    assertBody: (b) => b.error === 'not_found',
  });

  cases.push({
    name: 'period: bad format (2026/06) \u2192 400',
    setup: () => {
      currentFailMode = null;
    },
    run: () => callPeriod('2026/06'),
    expect: 400,
    assertBody: (b) => b.error === 'invalid_period',
  });

  cases.push({
    name: 'period: bad format (2026-6) \u2192 400',
    setup: () => {
      currentFailMode = null;
    },
    run: () => callPeriod('2026-6'),
    expect: 400,
    assertBody: (b) => b.error === 'invalid_period',
  });

  cases.push({
    name: 'period: reserved "index" \u2192 400',
    setup: () => {
      currentFailMode = null;
    },
    run: () => callPeriod('index'),
    expect: 400,
    assertBody: (b) => b.error === 'invalid_period',
  });

  cases.push({
    name: 'period: exists() throws \u2192 500',
    setup: () => {
      currentFailMode = 'exists-throws';
    },
    run: () => callPeriod('2026-06'),
    expect: 500,
    assertBody: (b) => b.error === 'read_failed',
  });

  for (const c of cases) {
    if (c.setup) c.setup();
    let res;
    try {
      res = await c.run();
    } catch (e) {
      console.log(`FAIL  ${c.name} \u2192 threw ${e && e.message}`);
      failed++;
      continue;
    }
    const ok = res && res.status === c.expect;
    let tag = ok ? 'PASS' : 'FAIL';
    if (ok && c.assertBody) {
      const bodyOK = !!c.assertBody(res.body || {});
      if (!bodyOK) tag = 'FAIL';
      console.log(`${tag}  ${c.name} \u2192 status=${res.status} assertBody=${bodyOK}`);
      if (!bodyOK) {
        failed++;
        console.log('       body:', JSON.stringify(res.body).slice(0, 300));
      }
      continue;
    }
    console.log(`${tag}  ${c.name} \u2192 status=${res && res.status} (expected ${c.expect})`);
    if (!ok) {
      failed++;
      console.log('       body:', JSON.stringify(res && res.body).slice(0, 300));
    }
  }
  process.exit(failed === 0 ? 0 : 1);
})();
