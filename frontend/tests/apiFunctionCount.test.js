import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every file under api/ (except names starting with "_") is its own Vercel serverless function, and the Hobby plan allows 12 per
// deployment: one more and the WHOLE deploy fails, for every branch and for production. This has happened before (api/storage
// was consolidated for it) and again with the on-chain relayer. Put new endpoints in api/_lib and hand requests to them from an
// existing function (see api/_lib/chainRoutes.js), or consolidate; do not add a thirteenth file.
const LIMIT = 12;
const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'api');

const functionFiles = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name.startsWith('_')) return [];
  if (e.isDirectory()) return functionFiles(path.join(dir, e.name), `${prefix}${e.name}/`);
  return /\.(js|mjs|cjs|ts)$/.test(e.name) ? [`${prefix}${e.name}`] : [];
});

test(`api/ holds at most ${LIMIT} serverless functions (Vercel's Hobby limit)`, () => {
  const files = functionFiles(apiDir).sort();
  assert.ok(files.length <= LIMIT, `api/ has ${files.length} function files, over Vercel's Hobby limit of ${LIMIT}. The deploy will fail.\n${files.join('\n')}`);
});

test('the relayer endpoints are served by an existing function through rewrites, not as files of their own', () => {
  const files = functionFiles(apiDir);
  for (const name of ['chain-sync.js', 'chain-link.js', 'fx-oracle.js']) assert.ok(!files.includes(name), `${name} must not be a function file`);
  const rewrites = JSON.parse(readFileSync(path.join(apiDir, '..', 'vercel.json'), 'utf8')).rewrites;
  for (const job of ['chain-sync', 'chain-link', 'fx-oracle']) {
    const r = rewrites.find((x) => x.source === `/api/${job}`);
    assert.ok(r, `vercel.json has no rewrite for /api/${job}`);
    assert.equal(r.destination, `/api/investment-expiry-sweep?job=${job}`);
  }
  // and the rewrites come before the catch-all that sends everything else to the app
  const idx = (s) => rewrites.findIndex((x) => x.source === s);
  assert.ok(idx('/api/chain-sync') < rewrites.findIndex((x) => x.source.startsWith('/((?!api/')));
});

test('the host function hands the relayer jobs off before any of its own checks', () => {
  const src = readFileSync(path.join(apiDir, 'investment-expiry-sweep.js'), 'utf8');
  assert.ok(src.indexOf('chainRouteFor(req)') > -1);
  assert.ok(src.indexOf('chainRouteFor(req)') < src.indexOf('x-vercel-cron'), 'the hand-off must come before the sweep\'s own auth');
});
