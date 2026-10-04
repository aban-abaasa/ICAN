import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { default: sweep } = await import('../api/visitor-photo-sweep.js');

// tests/run.mjs loads every test file into ONE process, so the fetch mock and env
// changes live inside this suite's hooks and are put back afterwards — a
// module-level mock would leak into the other files' tests.
describe('visitor photo sweep endpoint', () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  let calls;
  let purgeList;
  let failStorage;

  beforeEach(() => {
    calls = [];
    purgeList = [];
    failStorage = false;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    delete process.env.REPORT_AUTOMATION_SECRET;
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      calls.push({ url: u, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
      if (u.endsWith('/rest/v1/rpc/get_visitor_photos_to_purge')) return new Response(JSON.stringify(purgeList), { status: 200 });
      if (u.endsWith('/storage/v1/object/cmms-visitor-vehicle-photos')) return failStorage ? new Response('boom', { status: 500 }) : new Response('[]', { status: 200 });
      if (u.endsWith('/rest/v1/rpc/confirm_visitor_photos_purged')) return new Response('2', { status: 200 });
      throw new Error(`unexpected fetch ${u}`);
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REPORT_AUTOMATION_SECRET']) {
      if (realEnv[key] === undefined) delete process.env[key]; else process.env[key] = realEnv[key];
    }
  });

  const call = async ({ method = 'GET', headers = {}, query = {} } = {}) => {
    const res = { code: 0, payload: undefined };
    res.status = (c) => { res.code = c; return res; };
    res.json = (p) => { res.payload = p; return res; };
    await sweep({ method, headers, query }, res);
    return res;
  };

  it('rejects methods other than GET/POST', async () => {
    assert.equal((await call({ method: 'DELETE' })).code, 405);
  });

  it('does nothing (and calls no delete) when there is nothing to purge', async () => {
    const res = await call();
    assert.equal(res.code, 200);
    assert.deepEqual(res.payload, { success: true, deleted: 0 });
    assert.equal(calls.length, 1);
  });

  it('deletes the listed files from the bucket, then confirms them with the service key', async () => {
    purgeList = [{ storage_path: 'co/aaa.jpg', reason: 'visit_closed' }, { storage_path: 'tok/bbb.jpg', reason: 'unattached' }];
    const res = await call({ headers: { 'x-vercel-cron': '1' } });
    assert.equal(res.code, 200);
    assert.deepEqual(res.payload, { success: true, deleted: 2 });

    assert.deepEqual(calls.map((c) => c.url.replace('https://example.supabase.co', '')), [
      '/rest/v1/rpc/get_visitor_photos_to_purge',
      '/storage/v1/object/cmms-visitor-vehicle-photos',
      '/rest/v1/rpc/confirm_visitor_photos_purged'
    ]);
    assert.deepEqual(calls[0].body, { p_cmms_company_id: null }); // service role sweeps every company
    assert.equal(calls[1].method, 'DELETE');
    assert.deepEqual(calls[1].body, { prefixes: ['co/aaa.jpg', 'tok/bbb.jpg'] });
    assert.deepEqual(calls[2].body, { p_paths: ['co/aaa.jpg', 'tok/bbb.jpg'] });
    assert.ok(calls.every((c) => c.headers.Authorization === 'Bearer service-key' && c.headers.apikey === 'service-key'));
  });

  it('never clears a path when the Storage delete failed (so the next run retries it)', async () => {
    purgeList = [{ storage_path: 'co/aaa.jpg', reason: 'visit_closed' }];
    failStorage = true;
    const res = await call();
    assert.equal(res.code, 502);
    assert.equal(calls.some((c) => c.url.endsWith('confirm_visitor_photos_purged')), false);
  });

  it('requires the automation secret when one is configured (cron header also accepted)', async () => {
    process.env.REPORT_AUTOMATION_SECRET = 's3cret';
    assert.equal((await call()).code, 401);
    assert.equal((await call({ query: { secret: 'wrong' } })).code, 401);
    assert.equal((await call({ query: { secret: 's3cret' } })).code, 200);
    assert.equal((await call({ headers: { 'x-automation-secret': 's3cret' } })).code, 200);
    assert.equal((await call({ headers: { 'x-vercel-cron': '1' } })).code, 200);
  });

  it('fails clearly when the service key is not configured', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal((await call()).code, 500);
  });
});
