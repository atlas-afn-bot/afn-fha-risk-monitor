/**
 * Standalone smoke test for the read-only files API.
 *
 *   node api/tests/files-api.smoke.js
 *
 * Exercises the auth gate, query validation, and listing/download logic
 * without hitting Azure — `BlobServiceClient` is module-mocked at load time
 * via Node's require cache. Mirrors the style of `upload-sas.smoke.js`.
 */
const path = require('path');
const Module = require('module');

const TEST_API_KEY = 'test-api-key-32-chars-min-aaaaaaa'; // 32 chars
process.env.FHA_FILES_API_KEY = TEST_API_KEY;
process.env.UPLOADS_STORAGE_CONNECTION =
  process.env.UPLOADS_STORAGE_CONNECTION ||
  'DefaultEndpointsProtocol=https;AccountName=fakeacct;AccountKey=' +
    Buffer.from('fakekey-fakekey-fakekey-fakekey-fakekey=').toString('base64') +
    ';EndpointSuffix=core.windows.net';
process.env.UPLOADS_CONTAINER = 'uploads';

// ---- Mock @azure/storage-blob -------------------------------------------
const FIXTURE_BLOBS = [
  {
    name: '2026-04/hud-branches/HUD_Branches_4.30.26.xlsx',
    properties: { contentLength: 12345, lastModified: new Date('2026-05-01T12:00:00Z'), contentType: 'application/vnd.openxmlformats' },
  },
  {
    name: '2026-05/hud-branches/HUD_Branches_5.31.26.xlsx',
    properties: { contentLength: 23456, lastModified: new Date('2026-06-01T12:00:00Z'), contentType: 'application/vnd.openxmlformats' },
  },
  {
    name: '2026-05/hud-branches/HUD_Branches_5.31.26_v2.xlsx',
    properties: { contentLength: 24000, lastModified: new Date('2026-06-02T12:00:00Z'), contentType: 'application/vnd.openxmlformats' },
  },

  {
    name: '2026-05/hud-field-office/Field_Office.xlsx',
    properties: { contentLength: 45678, lastModified: new Date('2026-06-01T15:00:00Z'), contentType: 'application/vnd.openxmlformats' },
  },
  {
    name: 'malformed/stray-blob.txt',
    properties: { contentLength: 10, lastModified: new Date('2026-01-01T00:00:00Z'), contentType: 'text/plain' },
  },
];

function makeMockBlobServiceClient() {
  return {
    getContainerClient(_name) {
      return {
        listBlobsFlat(opts) {
          const prefix = (opts && opts.prefix) || '';
          const filtered = FIXTURE_BLOBS.filter((b) => b.name.startsWith(prefix));
          return (async function* () {
            for (const b of filtered) yield b;
          })();
        },
        getBlobClient(blobName) {
          return {
            async exists() {
              return FIXTURE_BLOBS.some((b) => b.name === blobName);
            },
          };
        },
      };
    },
  };
}

// Intercept require('@azure/storage-blob') for the Functions under test.
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === '@azure/storage-blob') {
    const real = originalLoad.call(this, request, parent, ...rest);
    return {
      ...real,
      BlobServiceClient: {
        fromConnectionString: () => makeMockBlobServiceClient(),
      },
    };
  }
  return originalLoad.call(this, request, parent, ...rest);
};

const listHandler = require('../files-list/index');
const downloadHandler = require('../files-download/index');

function makeCtx() {
  return {
    log: Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} }),
    bindingData: {},
    res: undefined,
  };
}

async function callList(headers, query) {
  const ctx = makeCtx();
  await listHandler(ctx, { method: 'GET', headers: headers || {}, query: query || {} });
  return ctx.res;
}

async function callDownload(headers, params) {
  const ctx = makeCtx();
  ctx.bindingData = params || {};
  await downloadHandler(ctx, { method: 'GET', headers: headers || {} });
  return ctx.res;
}

const AUTH = { 'x-api-key': TEST_API_KEY };

(async () => {
  let failed = 0;
  const cases = [];

  // ----- Auth gate
  cases.push({
    name: 'list: missing api key → 401',
    run: () => callList({}, {}),
    expect: 401,
  });
  cases.push({
    name: 'list: wrong api key → 401',
    run: () => callList({ 'x-api-key': 'nope' }, {}),
    expect: 401,
  });
  cases.push({
    name: 'list: valid api key, no filter → 200 with 5 files (malformed blob skipped)',
    run: () => callList(AUTH, {}),
    expect: 200,
    assertBody: (b) =>
      b.count === 5 &&
      b.files.every((f) => f.month && f.slot && f.filename) &&
      !b.files.some((f) => f.filename === 'stray-blob.txt'),
  });
  cases.push({
    name: 'list: month filter → 200 with only May files',
    run: () => callList(AUTH, { month: '2026-05' }),
    expect: 200,
    assertBody: (b) => b.count === 4 && b.files.every((f) => f.month === '2026-05'),
  });
  cases.push({
    name: 'list: month + slot filter → 200 with May hud-branches only',
    run: () => callList(AUTH, { month: '2026-05', slot: 'hud-branches' }),
    expect: 200,
    assertBody: (b) =>
      b.count === 2 &&
      b.files.every((f) => f.month === '2026-05' && f.slot === 'hud-branches'),
  });

  cases.push({
    name: 'list: invalid slot → 400',
    run: () => callList(AUTH, { slot: 'not-a-real-slot' }),
    expect: 400,
  });
  cases.push({
    name: 'list: invalid month → 400',
    run: () => callList(AUTH, { month: '2026/05' }),
    expect: 400,
  });
  cases.push({
    name: 'list: month 13 → 400',
    run: () => callList(AUTH, { month: '2026-13' }),
    expect: 400,
  });

  // ----- Download
  cases.push({
    name: 'download: missing api key → 401',
    run: () =>
      callDownload(
        {},
        { month: '2026-05', slot: 'hud-branches', filename: 'HUD_Branches_5.31.26.xlsx' },
      ),
    expect: 401,
  });
  cases.push({
    name: 'download: specific file exists → 302 with Location SAS',
    run: () =>
      callDownload(AUTH, {
        month: '2026-05',
        slot: 'hud-branches',
        filename: 'HUD_Branches_5.31.26.xlsx',
      }),
    expect: 302,
    assertHeaders: (h) => /\?.*sig=/.test(h.Location) && /sp=r/.test(h.Location),
  });
  cases.push({
    name: 'download: specific file missing → 404',
    run: () =>
      callDownload(AUTH, {
        month: '2026-05',
        slot: 'hud-branches',
        filename: 'does-not-exist.xlsx',
      }),
    expect: 404,
  });
  cases.push({
    name: 'download: latest resolves to newest blob in folder',
    run: () =>
      callDownload(AUTH, {
        month: '2026-05',
        slot: 'hud-branches',
        filename: 'latest',
      }),
    expect: 302,
    assertHeaders: (h) =>
      h['X-Resolved-Filename'] === 'HUD_Branches_5.31.26_v2.xlsx',
  });

  cases.push({
    name: 'download: latest on empty folder → 404',
    run: () =>
      callDownload(AUTH, {
        month: '2026-01',
        slot: 'hud-branches',
        filename: 'latest',
      }),
    expect: 404,
  });
  cases.push({
    name: 'download: invalid slot → 400',
    run: () =>
      callDownload(AUTH, {
        month: '2026-05',
        slot: 'bogus',
        filename: 'latest',
      }),
    expect: 400,
  });
  cases.push({
    // Mirrors upload-sas behavior: directory traversal is sanitized down to
    // the basename rather than rejected outright. `passwd` then 404s on the
    // existence check, which is the right outcome.
    name: 'download: path traversal sanitized → 404 (basename does not exist)',
    run: () =>
      callDownload(AUTH, {
        month: '2026-05',
        slot: 'hud-branches',
        filename: '../etc/passwd',
      }),
    expect: 404,
  });
  cases.push({
    name: 'download: filename with spaces → 400',
    run: () =>
      callDownload(AUTH, {
        month: '2026-05',
        slot: 'hud-branches',
        filename: 'bad name.xlsx',
      }),
    expect: 400,
  });

  for (const c of cases) {
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
    if (ok && c.assertBody) {
      const bodyOK = !!c.assertBody(res.body || {});
      if (!bodyOK) tag = 'FAIL';
      console.log(`${tag}  ${c.name} → status=${res.status} assertBody=${bodyOK}`);
      if (!bodyOK) {
        failed++;
        console.log('       body:', JSON.stringify(res.body).slice(0, 300));
      }
      continue;
    }
    if (ok && c.assertHeaders) {
      const headersOK = !!c.assertHeaders(res.headers || {});
      if (!headersOK) tag = 'FAIL';
      console.log(`${tag}  ${c.name} → status=${res.status} assertHeaders=${headersOK}`);
      if (!headersOK) {
        failed++;
        console.log('       headers:', JSON.stringify(res.headers).slice(0, 300));
      }
      continue;
    }
    console.log(`${tag}  ${c.name} → status=${res && res.status} (expected ${c.expect})`);
    if (!ok) {
      failed++;
      console.log('       body:', JSON.stringify(res && res.body).slice(0, 300));
    }
  }
  process.exit(failed === 0 ? 0 : 1);
})();
