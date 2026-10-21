import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// api/share-preview.js for a business at its own address (icanera.space/<business-name>), with Supabase and the app shell stubbed.

const COMPANY_ID = '7a61ac98-f8c6-49b5-b75d-da194669d471';
const SHELL = '<!doctype html><html><head><title>IcanEra</title><meta name="description" content="x"></head><body><div id="root"></div></body></html>';
const calls = [];
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const stubFetch = async (input, init = {}) => {
  const target = String(input);
  calls.push(target);
  if (target.endsWith('/index.html')) return { ok: true, status: 200, text: async () => SHELL };
  const body = init.body ? JSON.parse(init.body) : {};
  if (target.endsWith('/rpc/fn_resolve_public_site_slug')) {
    if (body.p_slug === 'godmindera-organisation-u-ltd') return json([{ company_id: COMPANY_ID, site_slug: 'godmindera-organisation-u-ltd', is_current: true }]);
    if (body.p_slug === 'old-godmindera') return json([{ company_id: COMPANY_ID, site_slug: 'godmindera-organisation-u-ltd', is_current: false }]);
    return json([]);
  }
  if (target.endsWith('/rpc/fn_get_public_cmms_company_header')) {
    return json([{ id: COMPANY_ID, company_name: 'GODMINDERA ORGANISATION (U) LTD', industry: 'Technology', tagline: 'Builders of IcanEra', about: 'The company behind IcanEra.' }]);
  }
  if (target.endsWith('/rpc/fn_get_public_cmms_notices')) return json([]);
  if (target.endsWith('/rpc/fn_get_public_site_slugs')) return json([{ company_id: COMPANY_ID, site_slug: 'godmindera-organisation-u-ltd' }]);
  return json(null, 404);
};

// tests/run.mjs runs every test file in ONE process, so the stubs live only while this suite runs (hooks sit INSIDE the describe).
let handler;
let realFetch;
let realEnv;

const run = async (query) => {
  calls.length = 0;
  const res = { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, send(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ query, headers: { host: 'icanera.space', 'x-forwarded-proto': 'https' } }, res);
  return res;
};

describe('api/share-preview.js for a business address', () => {
  before(async () => {
    realFetch = globalThis.fetch;
    realEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY };
    process.env.SUPABASE_URL = 'https://stub.supabase.test';
    process.env.SUPABASE_ANON_KEY = 'anon-stub';
    globalThis.fetch = stubFetch;
    ({ default: handler } = await import('../api/share-preview.js'));
  });
  after(() => {
    globalThis.fetch = realFetch;
    if (realEnv.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = realEnv.url;
    if (realEnv.key === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = realEnv.key;
  });

  test('a business address opens that business, with its own title, canonical address and structured data', async () => {
    const res = await run({ type: 'site', slug: 'godmindera-organisation-u-ltd' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<title>GODMINDERA ORGANISATION \(U\) LTD — Builders of IcanEra \| IcanEra<\/title>/);
    assert.match(res.body, /<link rel="canonical" href="https:\/\/icanera\.space\/godmindera-organisation-u-ltd">/);
    assert.match(res.body, /"url":"https:\/\/icanera\.space\/godmindera-organisation-u-ltd"/);
    assert.ok(!res.body.includes('/notices/'), 'no old-style link should be left on the page');
    assert.match(res.body, /<noscript>/);
  });

  test('the address is not case sensitive', async () => {
    const res = await run({ type: 'site', slug: 'GODMINDERA-Organisation-U-LTD' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /rel="canonical" href="https:\/\/icanera\.space\/godmindera-organisation-u-ltd"/);
  });

  test('a retired address is sent on to the current one for good, keeping the link into a post', async () => {
    const res = await run({ type: 'site', slug: 'old-godmindera', post: 'abc', junk: 'dropped' });
    assert.equal(res.statusCode, 301);
    assert.equal(res.headers.Location, '/godmindera-organisation-u-ltd?post=abc');
  });

  test('an address nobody has gets the app exactly as before: untouched page, no invented canonical', async () => {
    const res = await run({ type: 'site', slug: 'no-such-business' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, SHELL);
  });

  test('app pages and malformed addresses never reach the database', async () => {
    for (const slug of ['pricing', 'shop', 'notices', 'ab', 'a--b', '-abc', '']) {
      const res = await run({ type: 'site', slug });
      assert.equal(res.body, SHELL, slug);
      assert.ok(!calls.some((call) => call.includes('/rpc/')), `${slug} must not be looked up`);
    }
  });

  test('the old /notices/<id> link still works and now names the readable address as its canonical one', async () => {
    const res = await run({ type: 'notices', id: COMPANY_ID });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /rel="canonical" href="https:\/\/icanera\.space\/godmindera-organisation-u-ltd"/);
  });

  test('a business with no address yet keeps its /notices/<id> canonical (the migration may not be applied)', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => (String(input).endsWith('/rpc/fn_get_public_site_slugs') ? json(null, 404) : stubFetch(input, init));
    try {
      const res = await run({ type: 'notices', id: COMPANY_ID });
      assert.match(res.body, new RegExp(`rel="canonical" href="https://icanera\\.space/notices/${COMPANY_ID}"`));
    } finally {
      globalThis.fetch = original;
    }
  });
});
