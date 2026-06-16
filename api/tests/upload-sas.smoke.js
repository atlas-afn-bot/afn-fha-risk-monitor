/**
 * Standalone smoke test for upload-sas (run with `node _smoke.js`).
 * Not packaged with the function; just a developer aid.
 */
process.env.UPLOADS_STORAGE_CONNECTION =
  process.env.UPLOADS_STORAGE_CONNECTION ||
  'DefaultEndpointsProtocol=https;AccountName=fakeacct;AccountKey=' +
    Buffer.from('fakekey-fakekey-fakekey-fakekey-fakekey=').toString('base64') +
    ';EndpointSuffix=core.windows.net';
process.env.UPLOADS_CONTAINER = 'uploads';

const handler = require('../upload-sas/index');

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
  let captured;
  const ctx = {
    log: Object.assign(() => {}, { warn: () => {}, error: () => {}, info: () => {} }),
    res: undefined,
  };
  await handler(ctx, { method, headers, body });
  captured = ctx.res;
  return captured;
}

(async () => {
  const cases = [
    {
      name: 'allowlisted user with valid filename',
      headers: { 'x-ms-client-principal': makePrincipal('jdewindt@afncorp.com') },
      body: { filename: 'test.xlsx' },
      expect: 200,
    },
    {
      name: 'allowlisted user, case-insensitive email',
      headers: { 'x-ms-client-principal': makePrincipal('JDeWindt@AFNCorp.com') },
      body: { filename: 'mixed_case.csv' },
      expect: 200,
    },
    {
      name: 'NON-allowlisted user',
      headers: { 'x-ms-client-principal': makePrincipal('intruder@afncorp.com') },
      body: { filename: 'sneaky.xlsx' },
      expect: 403,
    },
    {
      name: 'no principal header',
      headers: {},
      body: { filename: 'x.xlsx' },
      expect: 401,
    },
    {
      name: 'invalid filename (path traversal)',
      headers: { 'x-ms-client-principal': makePrincipal('mkunisaki@afncorp.com') },
      body: { filename: '../../etc/passwd' },
      expect: 200, // sanitizer strips the path and accepts "passwd"
    },
    {
      name: 'invalid filename (spaces)',
      headers: { 'x-ms-client-principal': makePrincipal('mkunisaki@afncorp.com') },
      body: { filename: 'a file with spaces.xlsx' },
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

  let failed = 0;
  for (const c of cases) {
    const res = await callHandler(c.headers, c.body, c.method || 'POST');
    const ok = res && res.status === c.expect;
    const tag = ok ? 'PASS' : 'FAIL';
    console.log(`${tag}  ${c.name} → status=${res?.status} (expected ${c.expect})`);
    if (!ok) {
      failed++;
      console.log('       body:', JSON.stringify(res?.body).slice(0, 200));
    } else if (res.status === 200 && res.body?.uploadUrl) {
      // Sanity: SAS URL should contain ?sv= and our container/folder
      const u = res.body.uploadUrl;
      const hasMonth = /\d{4}-\d{2}\//.test(u);
      const hasSig = /sig=/.test(u);
      console.log(`       blobPath=${res.body.blobPath}  hasMonth=${hasMonth}  hasSig=${hasSig}`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
})();
