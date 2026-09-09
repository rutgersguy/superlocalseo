const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../backend/node_modules/typescript');

const source = ts.transpileModule(fs.readFileSync(`${__dirname}/../frontend/src/services/api.ts`, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function client(responses) {
  const context = { exports: {}, window: { location: { href: '/dashboard/reviews' } },
    fetch: async () => {
      const [status, body] = responses.shift();
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    } };
  vm.runInNewContext(source, context);
  return context;
}
for (const code of ['TRIAL_EXPIRED', 'PAYMENT_OVERDUE', 'PAYMENT_FAILED', 'SUBSCRIPTION_CANCELED', 'SUBSCRIPTION_CANCELLED']) {
  for (const nested of [false, true]) {
    test(`402 ${code}, ${nested ? 'nested' : 'flat'} error never becomes empty data`, async () => {
      const body = nested ? { success: false, error: { code, message: 'Access restricted' } }
        : { success: false, error: 'Access restricted', code };
      const c = client([[402, body]]);
      await assert.rejects(c.exports.fetcher('/reviews'), /Access restricted/);
      assert.equal(c.window.location.href, '/billing');
    });
  }
}
test('SWR rejects a failed API envelope', async () => {
  const c = client([[500, { success: false, error: { message: 'Database unavailable' } }]]);
  await assert.rejects(c.exports.fetcher('/reviews'), /Database unavailable/);
});
test('successful empty review response remains a valid empty state', async () => {
  const body = { success: true, data: { reviews: [], total: 0 } };
  const c = client([[200, body]]);
  assert.deepEqual(await c.exports.fetcher('/reviews'), body);
});
test('mutation callers retain their explicit error envelope', async () => {
  const body = { success: false, error: { message: 'Invalid input' } };
  const c = client([[422, body]]);
  assert.deepEqual(await c.exports.apiFetch('/example', { method: 'POST' }), body);
});
test('402 after successful token refresh also rejects and redirects', async () => {
  const c = client([[401, {}], [200, { data: { accessToken: 'test-only' } }],
    [402, { success: false, code: 'TRIAL_EXPIRED', error: 'Access restricted' }]]);
  await assert.rejects(c.exports.fetcher('/reviews'), /Access restricted/);
  assert.equal(c.window.location.href, '/billing');
});
