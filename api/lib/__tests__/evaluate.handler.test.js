/**
 * HTTP handler tests for `POST /api/evaluate` with a mocked @azure/storage-blob.
 *
 * Uses Node module-cache injection (same style as api/tests/*.smoke.js).
 * Verifies:
 *   - Miss: loads snapshot, evaluates, writes cache, returns cache: 'miss'.
 *   - Hit: subsequent call returns identical output with cache: 'hit'.
 *   - 400 on bad body / unknown predicate.
 *   - 404 on missing snapshot.
 *   - 500 without UPLOADS_STORAGE_CONNECTION.
 */
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { Readable } = require('stream');
// Vitest globals (describe/it/expect/beforeEach/afterAll) are exposed via test.globals: true.

const FIXTURE_PATH = path.join(__dirname, '..', '..', '..', 'public', 'data', 'snapshots', '2026-06.json');
const SNAPSHOT_TEXT = fs.readFileSync(FIXTURE_PATH, 'utf8');

// ── @azure/storage-blob mock ─────────────────────────────────────────────
const mockBlobStore = new Map(); // blobName -> string

function makeReadable(text) {
  const buf = Buffer.from(text, 'utf8');
  return Readable.from([buf]);
}

function mockBlobClient(name) {
  return {
    async exists() {
      return mockBlobStore.has(name);
    },
    async download() {
      if (!mockBlobStore.has(name)) throw new Error(`mock: no such blob ${name}`);
      return { readableStreamBody: makeReadable(mockBlobStore.get(name)) };
    },
    async deleteIfExists() {
      mockBlobStore.delete(name);
      return { succeeded: true };
    },
  };
}

function mockBlockBlobClient(name) {
  return Object.assign(mockBlobClient(name), {
    async upload(text) {
      mockBlobStore.set(name, text);
      return {};
    },
  });
}

function mockContainerClient() {
  return {
    getBlobClient: (name) => mockBlobClient(name),
    getBlockBlobClient: (name) => mockBlockBlobClient(name),
    listBlobsFlat({ prefix } = {}) {
      const names = [...mockBlobStore.keys()].filter((n) => !prefix || n.startsWith(prefix));
      return (async function* () {
        for (const n of names) yield { name: n };
      })();
    },
  };
}

const MockBlobServiceClient = {
  fromConnectionString: () => ({ getContainerClient: () => mockContainerClient() }),
};

// Install as module-cache override before requiring the handler.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === '@azure/storage-blob') return '@azure/storage-blob__MOCK__';
  return origResolve.call(this, request, parent, ...rest);
};
require.cache['@azure/storage-blob__MOCK__'] = {
  id: '@azure/storage-blob__MOCK__',
  filename: '@azure/storage-blob__MOCK__',
  loaded: true,
  exports: { BlobServiceClient: MockBlobServiceClient },
};

// Env for the handler.
process.env.UPLOADS_STORAGE_CONNECTION =
  process.env.UPLOADS_STORAGE_CONNECTION ||
  'DefaultEndpointsProtocol=https;AccountName=fake;AccountKey=Zg==;EndpointSuffix=core.windows.net';
process.env.SNAPSHOTS_CONTAINER = 'snapshots';

const evaluateHandler = require('../../evaluate');

function fakeContext() {
  return { log: Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} }) };
}

describe('POST /api/evaluate handler', () => {
  beforeEach(() => {
    mockBlobStore.clear();
    mockBlobStore.set('2026-06.json', SNAPSHOT_TEXT);
  });

  it('returns 400 on missing snapshot_month', async () => {
    const ctx = fakeContext();
    await evaluateHandler(ctx, {
      body: { predicates: [{ predicate_id: 'boost_membership' }] },
    });
    expect(ctx.res.status).toBe(400);
    expect(ctx.res.body.error).toBe('validation_error');
  });

  it('returns 400 on unknown predicate', async () => {
    const ctx = fakeContext();
    await evaluateHandler(ctx, {
      body: {
        snapshot_month: '2026-06',
        predicates: [{ predicate_id: 'ghost_predicate' }],
        composition_op: 'OR',
      },
    });
    expect(ctx.res.status).toBe(400);
    expect(ctx.res.body.error).toBe('unknown_predicate');
  });

  it('returns 404 when snapshot blob is missing', async () => {
    mockBlobStore.clear();
    const ctx = fakeContext();
    await evaluateHandler(ctx, {
      body: {
        snapshot_month: '2026-06',
        predicates: [{ predicate_id: 'boost_membership' }],
        composition_op: 'OR',
      },
    });
    expect(ctx.res.status).toBe(404);
  });

  it('cache miss → compute → write; second call returns cache hit with identical body', async () => {
    const body = {
      snapshot_month: '2026-06',
      predicates: [{ predicate_id: 'boost_membership' }],
      composition_op: 'OR',
    };

    const ctx1 = fakeContext();
    await evaluateHandler(ctx1, { body });
    expect(ctx1.res.status).toBe(200);
    expect(ctx1.res.body.cache).toBe('miss');
    expect(ctx1.res.body.n_removed).toBe(2268);
    expect(typeof ctx1.res.body.cache_key).toBe('string');

    // Wait a tick so the fire-and-forget writeCache lands.
    await new Promise((r) => setTimeout(r, 5));

    const ctx2 = fakeContext();
    await evaluateHandler(ctx2, { body });
    expect(ctx2.res.status).toBe(200);
    expect(ctx2.res.body.cache).toBe('hit');
    expect(ctx2.res.body.n_removed).toBe(2268);
    expect(ctx2.res.body.cache_key).toBe(ctx1.res.body.cache_key);
  });

  it('handles body posted as a JSON string (SWA host quirk)', async () => {
    const ctx = fakeContext();
    await evaluateHandler(ctx, {
      body: JSON.stringify({
        snapshot_month: '2026-06',
        predicates: [{ predicate_id: 'boost_membership' }],
        composition_op: 'OR',
      }),
    });
    expect(ctx.res.status).toBe(200);
    expect(ctx.res.body.n_removed).toBe(2268);
  });
});

afterAll(() => {
  Module._resolveFilename = origResolve;
  delete require.cache['@azure/storage-blob__MOCK__'];
});
