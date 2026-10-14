import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN_JOBS, chainRouteFor } from '../api/_lib/chainRoutes.js';
import sweep from '../api/investment-expiry-sweep.js';

// The relayer's endpoints share an existing serverless function (Vercel's Hobby plan caps the project at 12). These tests hold the
// hand-off to its promises: only the three known jobs are routed, the older sweep rules never apply to them, and a request
// without a job behaves exactly as the sweep always did.

const fakeRes = () => ({ code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const withEnv = async (vars, fn) => {
  const keys = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'CHAIN_CRON_SECRET', 'CRON_SECRET',
    'CHAIN_RPC_URL', 'CHAIN_ID', 'BRIDGE_OPERATOR_KEY', 'REPORT_AUTOMATION_SECRET'];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
};

test('only the three known jobs are routed; anything else (including object-prototype names and repeated params) is not', () => {
  assert.equal(chainRouteFor({ query: { job: 'chain-sync' } }), CHAIN_JOBS['chain-sync']);
  assert.equal(chainRouteFor({ query: { job: 'chain-link' } }), CHAIN_JOBS['chain-link']);
  assert.equal(chainRouteFor({ query: { job: 'fx-oracle' } }), CHAIN_JOBS['fx-oracle']);
  for (const job of [undefined, '', 'sweep', 'CHAIN-SYNC', '__proto__', 'constructor', 'toString', 'hasOwnProperty', ['chain-sync'], ['chain-sync', 'x'], 1, null]) {
    assert.equal(chainRouteFor({ query: { job } }), null, JSON.stringify(job));
  }
  assert.equal(chainRouteFor({}), null);
  assert.equal(chainRouteFor(null), null);
  assert.equal(Object.keys(CHAIN_JOBS).length, 3);
  assert.ok(Object.isFrozen(CHAIN_JOBS));
});

test('a request with no job runs the sweep exactly as before (missing environment is still its own answer)', async () => {
  await withEnv({}, async () => {
    const res = fakeRes();
    await sweep({ method: 'GET', headers: {}, query: {} }, res);
    assert.equal(res.code, 500);
    assert.match(res.body.error, /Missing Supabase automation environment variables/);
    const bad = fakeRes();
    await sweep({ method: 'DELETE', headers: {}, query: {} }, bad);
    assert.equal(bad.code, 405);
  });
});

test('the x-vercel-cron header, which the sweep trusts, opens nothing on the relayer routes', async () => {
  await withEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', CHAIN_CRON_SECRET: 'a-long-enough-shared-secret-123', CHAIN_RPC_URL: 'http://127.0.0.1:1', CHAIN_ID: '31337', BRIDGE_OPERATOR_KEY: `0x${'11'.repeat(32)}` }, async () => {
    for (const job of ['chain-sync', 'fx-oracle']) {
      const res = fakeRes();
      await sweep({ method: 'GET', headers: { 'x-vercel-cron': '1' }, query: { job } }, res);
      assert.equal(res.code, 401, job);
      assert.equal(res.body.error, 'Unauthorized');
    }
    const wrong = fakeRes();
    await sweep({ method: 'GET', headers: { authorization: 'Bearer not-the-secret-not-the-secret' }, query: { job: 'chain-sync' } }, wrong);
    assert.equal(wrong.code, 401);
  });
});

test('with no secret configured the scheduled routes refuse everything, and say what is missing without echoing a value', async () => {
  await withEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-secret-value' }, async () => {
    const sync = fakeRes();
    await sweep({ method: 'GET', headers: { authorization: 'Bearer anything-anything' }, query: { job: 'chain-sync' } }, sync);
    assert.equal(sync.code, 500);
    assert.ok(sync.body.missing.includes('CHAIN_CRON_SECRET'));
    assert.ok(!JSON.stringify(sync.body).includes('svc-secret-value'));
    const fx = fakeRes();
    await sweep({ method: 'GET', headers: { authorization: 'Bearer anything-anything' }, query: { job: 'fx-oracle' } }, fx);
    assert.equal(fx.code, 500);
  });
});

test('wallet linking needs POST and a signed-in session, and never reads the user from the request body', async () => {
  await withEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon' }, async () => {
    const get = fakeRes();
    await sweep({ method: 'GET', headers: {}, query: { job: 'chain-link' } }, get);
    assert.equal(get.code, 405);
    const anon = fakeRes();
    await sweep({ method: 'POST', headers: {}, query: { job: 'chain-link' }, body: { userId: '00000000-0000-4000-8000-000000000001', challengeId: 'x', signature: 'y' } }, anon);
    assert.equal(anon.code, 401);
    assert.equal(anon.body.code, 'not_signed_in');
  });
});
