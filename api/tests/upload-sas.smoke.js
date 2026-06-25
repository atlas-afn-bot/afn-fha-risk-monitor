/**
 * Standalone smoke test for upload-sas (run with `node upload-sas.smoke.js`).
 * Not packaged with the function; just a developer aid.
 *
 * Refreshed 2026-06-17 for the 6-slot uploader: all 200-expected cases must
 * carry a `category` slug now; new cases cover slug-validation, month
 * override, and back-compat for the four previous test branches.
 */
process.env.UPLOADS_STORAGE_CONNECTION =
  process.env.UPLOADS_STORAGE_CONNECTION ||
  'DefaultEndpointsProtocol=https;AccountName=fakeacct;AccountKey=' +
    Buffer.from('fakekey-fakekey-fakekey-fakekey-fakekey=').toString('base64') +
    ';EndpointSuffix=core.windows.net';
process.env.UPLOADS_CONTAINER = 'uploads';

const handler = require('../upload-sas/index');

const VALID_SLUG = 'hud-branches';

function makePrincipal(email) {
  const p = {
    identityProvider: 'aad',
    userId: 'abc',
    userDetails: email,
    userRoles: ['authenticated'],
    claims: [{ typ: 'preferred_username', val: email }],
  };
  return Buffer.from(JSON.stringify(p)).toString('base64');
}

async function callHandler(headers, body, method = 'POST') {
  const ctx = {
    log: Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} }),
    res: undefined,
  };
  await handler(ctx, { method, headers, body });
  return ctx.res;
}

(async () => {
  const cases = [
    {
      name: 'allowlisted user with valid filename + category',
      headers: { 'x-ms-client-principal': makePrincipal('jdewindt@afncorp.com') },
      body: { filename: 'test.xlsx', category: VALID_SLUG },
      expect: 200,
      assertBody: (b) => b.category === VALID_SLUG && /^\d{4}-\d{2}\//.test(b.blobPath),
    },
    {
      name: 'allowlisted user, case-insensitive email',
      headers: { 'x-ms-client-principal': makePrincipal('JDeWindt@AFNCorp.com') },
      body: { filename: 'mixed_case.csv', category: 'nw-data' },
      expect: 200,
    },
    {
      name: 'Stefanie is now in the allowlist',
      headers: { 'x-ms-client-principal': makePrincipal('sbarkey@afncorp.com') },
      body: { filename: 'stefanie.csv', category: 'hoc-compare-ratios' },
      expect: 200,
    },
    {
      name: 'NON-allowlisted user (with valid body otherwise)',
      headers: { 'x-ms-client-principal': makePrincipal('intruder@afncorp.com') },
      body: { filename: 'sneaky.xlsx', category: VALID_SLUG },
      expect: 403,
    },
    {
      name: 'no principal header',
      headers: {},
      body: { filename: 'x.xlsx', category: VALID_SLUG },
      expect: 401,
    },
    {
      name: 'missing category',
      headers: { 'x-ms-client-principal': makePrincipal('mkunisaki@afncorp.com') },
      body: { filename: 'orphan.xlsx' },
      expect: 400,
    },
    {
      name: 'bogus category',
      headers: { 'x-ms-client-principal': makePrincipal('mkunisaki@afncorp.com') },
      body: { filename: 'orphan.xlsx', category: 'not-a-slot' },
      expect: 400,
    },
    {
      name: 'category accepts case-insensitive input',
      headers: { 'x-ms-client-principal': makePrincipal('mkunisaki@afncorp.com') },
      body: { filename: 'mixed.csv', category: 'HUD-NATIONAL-TOTALS' },
      expect: 200,
    },
    {
      name: 'valid month override',
      headers: { 'x-ms-client-principal': makePrincipal('mkunisaki@afncorp.com') },
      body: { filename: 'override.csv', category: 'hud-field-office', month: '2026-04' },
      expect: 200,
      assertBody: (b) => b.month === '2026-04' && b.blobPath.startsWith('2026-04/hud-field-office/'),
    },
    {
      name: 'invalid month override (13 month)',
      headers: { 'x-ms-client-principal': makePrincipal('mkunisaki@afncorp.com') },
      body: { filename: 'bad.csv', category: 'hud-field-office', month: '2026-13' },
      expect: 400,
    },
    {
      name: 'invalid filename (path traversal — sanitizer strips path, still OK)',
      headers: { 'x-ms-client-principal': makePrincipal('mkunisaki@afncorp.com') },
      body: { filename: '../../etc/passwd', category: VALID_SLUG },
      expect: 200,
    },
    {
      name: 'invalid filename (spaces)',
      headers: { 'x-ms-client-principal': makePrincipal('mkunisaki@afncorp.com') },
      body: { filename: 'a file with spaces.xlsx', category: VALID_SLUG },
      expect: 400,
    },
    {
      name: 'GET method rejected',
      headers: { 'x-ms-client-principal': makePrincipal('jdewindt@afncorp.com') },
      body: {},
      method: 'GET',
      expect: 405,
    },
  ];

  // Sanity: the function module exposes its slug set; verify the six expected
  // slugs are present and nothing extra.
  const exported = Array.from(handler.CATEGORY_SLUGS || []).sort();
  const expected = [
    'hoc-compare-ratios',
    'hud-branches',
    'hud-field-office',
    'hud-total-compare-ratios',
    'nw-data',
  ];
  if (JSON.stringify(exported) !== JSON.stringify(expected)) {
    console.log(`FAIL  CATEGORY_SLUGS mismatch — got=${exported.join(',')} expected=${expected.join(',')}`);
    process.exit(1);
  } else {
    console.log('PASS  CATEGORY_SLUGS contains exactly the six expected slugs');
  }

  let failed = 0;
  for (const c of cases) {
    const res = await callHandler(c.headers, c.body, c.method || 'POST');
    const ok = res && res.status === c.expect;
    let tag = ok ? 'PASS' : 'FAIL';
    if (ok && c.assertBody) {
      const bodyOK = !!c.assertBody(res.body || {});
      if (!bodyOK) tag = 'FAIL';
      console.log(`${tag}  ${c.name} → status=${res.status} (expected ${c.expect}) assertBody=${bodyOK}`);
      if (!bodyOK) {
        failed++;
        console.log('       body:', JSON.stringify(res.body).slice(0, 200));
      }
      continue;
    }
    console.log(`${tag}  ${c.name} → status=${res?.status} (expected ${c.expect})`);
    if (!ok) {
      failed++;
      console.log('       body:', JSON.stringify(res?.body).slice(0, 200));
    } else if (res.status === 200 && res.body?.uploadUrl) {
      const u = res.body.uploadUrl;
      const hasMonth = /\d{4}-\d{2}\//.test(u);
      const hasSig = /sig=/.test(u);
      console.log(`       blobPath=${res.body.blobPath}  hasMonth=${hasMonth}  hasSig=${hasSig}`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
})();
