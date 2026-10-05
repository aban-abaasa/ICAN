import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// A tiny local server stands in for Cloudflare R2, so DELETE requests are real S3 calls we can see.
const r2Hits = [];
const r2 = http.createServer((req, res) => { r2Hits.push(`${req.method} ${decodeURIComponent(req.url.split("?")[0])}`); res.statusCode = 204; res.end(); });
await new Promise((resolve) => r2.listen(0, '127.0.0.1', resolve));

// r2Client reads these when it is first imported. The Supabase values match the other test files.
process.env.R2_BUCKET_NAME = 'test-bucket';
process.env.R2_ENDPOINT = `http://127.0.0.1:${r2.address().port}`;
process.env.R2_ACCESS_KEY_ID = 'key';
process.env.R2_SECRET_ACCESS_KEY = 'secret';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';

const { default: storage } = await import('../api/storage/[action].js');
after(() => new Promise((resolve) => r2.close(resolve)));

// tests/run.mjs loads every test file into one process: the fetch mock lives in this suite's hooks.
describe('visitor vehicle photos through /api/storage', () => {
  const realFetch = globalThis.fetch;
  let purgeable;
  let rpcCalls;

  beforeEach(() => {
    r2Hits.length = 0;
    rpcCalls = [];
    purgeable = false;
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) {
        const token = String(init.headers?.Authorization || '').replace('Bearer ', '');
        return token.startsWith('good-') ? new Response(JSON.stringify({ id: token.slice(5) }), { status: 200 }) : new Response('{}', { status: 401 });
      }
      if (u.endsWith('/rest/v1/rpc/visitor_photo_purgeable')) {
        rpcCalls.push({ headers: init.headers, body: JSON.parse(init.body) });
        return new Response(JSON.stringify(purgeable), { status: 200 });
      }
      return realFetch(url, init);
    };
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const call = async ({ action, method = 'POST', token, body }) => {
    const res = { headers: {}, code: 200, payload: undefined };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.status = (c) => { res.code = c; return res; };
    res.json = (p) => { res.payload = p; return res; };
    res.end = () => res;
    await storage({ method, query: { action }, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
    return res;
  };

  it('staff can upload a vehicle photo to the new folder (existing signed-in route)', async () => {
    const res = await call({ action: 'presign-upload', token: 'good-staff1', body: { folder: 'cmms-visitor-vehicles', filename: 'car.jpg', contentType: 'image/jpeg' } });
    assert.equal(res.code, 200);
    assert.match(res.payload.key, /^cmms-visitor-vehicles\/staff1\/\d+-[0-9a-f]{8}-car\.jpg$/);
  });

  it('a visitor can upload only an image, into its own guest folder (existing anonymous route)', async () => {
    const ok = await call({ action: 'presign-upload-chat', body: { filename: 'car.png', contentType: 'image/png', purpose: 'visitor-vehicle' } });
    assert.equal(ok.code, 200);
    assert.match(ok.payload.key, /^cmms-visitor-vehicles-guest\/[0-9a-f-]{36}\/\d+-[0-9a-f]{8}-car\.png$/);
    const pdf = await call({ action: 'presign-upload-chat', body: { filename: 'x.pdf', contentType: 'application/pdf', purpose: 'visitor-vehicle' } });
    assert.equal(pdf.code, 400);
  });

  it('the guest chat upload is unchanged when no purpose is given', async () => {
    const res = await call({ action: 'presign-upload-chat', body: { filename: 'x.pdf', contentType: 'application/pdf' } });
    assert.equal(res.code, 200);
    assert.match(res.payload.key, /^portfolio-chat-guest\//);
  });

  it('staff can delete a finished visit\'s photo even though someone else uploaded it', async () => {
    purgeable = true;
    const key = 'cmms-visitor-vehicles/uploader9/1759600000000-1a2b3c4d-car.jpg';
    const res = await call({ action: 'object', method: 'DELETE', token: 'good-approver2', body: { key } });
    assert.equal(res.code, 200);
    assert.deepEqual(r2Hits, [`DELETE /test-bucket/${key}`]);
    assert.equal(rpcCalls[0].body.p_path, key);
    assert.equal(rpcCalls[0].headers.Authorization, 'Bearer good-approver2'); // asked as the caller, not with a service key
  });

  it('the guest-folder photo of a finished visit is deletable the same way', async () => {
    purgeable = true;
    const key = 'cmms-visitor-vehicles-guest/6f1c2d3e-0000-4000-8000-000000000001/1759600000000-1a2b3c4d-car.png';
    assert.equal((await call({ action: 'object', method: 'DELETE', token: 'good-approver2', body: { key } })).code, 200);
  });

  it('a photo of a visit that is still open cannot be deleted', async () => {
    purgeable = false;
    const res = await call({ action: 'object', method: 'DELETE', token: 'good-approver2', body: { key: 'cmms-visitor-vehicles/uploader9/1759600000000-1a2b3c4d-car.jpg' } });
    assert.equal(res.code, 403);
    assert.deepEqual(r2Hits, []);
  });

  it('delete still needs a valid session', async () => {
    purgeable = true;
    const res = await call({ action: 'object', method: 'DELETE', token: 'bad', body: { key: 'cmms-visitor-vehicles/u/1759600000000-1a2b3c4d-car.jpg' } });
    assert.equal(res.code, 401);
    assert.deepEqual(r2Hits, []);
  });

  it('other folders keep their owner-only delete rule', async () => {
    purgeable = true; // must not matter for other folders
    const mine = 'cmms-reports/staff1/1759600000000-1a2b3c4d-a.jpg';
    const theirs = 'cmms-reports/someoneelse/1759600000000-1a2b3c4d-a.jpg';
    assert.equal((await call({ action: 'object', method: 'DELETE', token: 'good-staff1', body: { key: theirs } })).code, 403);
    assert.equal((await call({ action: 'object', method: 'DELETE', token: 'good-staff1', body: { key: mine } })).code, 200);
    assert.deepEqual(r2Hits, [`DELETE /test-bucket/${mine}`]);
    assert.equal(rpcCalls.length, 0);
  });
});
