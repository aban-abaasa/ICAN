#!/usr/bin/env node
/**
 * Keeps the Era API's shared files identical across the four ICANERA apps.
 *
 * ICAN is the source of truth. The same page, console, gateway and tests are used by BodaGoEra, SupermarketEra and
 * FarmAgentEra, so a fix lands once and is copied here instead of being re-typed four times.
 *
 *   node scripts/sync-era-api.mjs           copy them into the sibling repos
 *   node scripts/sync-era-api.mjs --check   exit 1 if any sibling copy has drifted (good for CI)
 *
 * Sibling repos are looked up next to this one (../mybodaguy, ../digital-city-era, ../farm-agentera). Override with
 *   ERA_API_TARGETS=/path/a,/path/b node scripts/sync-era-api.mjs
 *
 * Not shared on purpose (they differ per app): the dev-panel wiring (EraApiDevTab.*) and vercel.json.
 * The catalogue snapshot public/developers/catalog.json is generated from the database registry by
 * supabase/tests/era_api/run.sh (UPDATE_CATALOG=1) and only copied here.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARED = [
  'frontend/api/_lib/eraApi.js',
  'frontend/api/v1/[...path].js',
  'frontend/public/developers/index.html',
  'frontend/public/developers/admin.js',
  'frontend/public/developers/catalog.json',
  'frontend/tests/eraApi.test.js',
];

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = (process.env.ERA_API_TARGETS
  ? process.env.ERA_API_TARGETS.split(',').map((p) => resolve(p.trim()))
  : ['mybodaguy', 'digital-city-era', 'farm-agentera'].map((n) => join(here, '..', n))).filter((t) => existsSync(t));

const check = process.argv.includes('--check');
if (!targets.length) { console.error('No sibling repos found next to ICAN. Set ERA_API_TARGETS.'); process.exit(2); }

let drift = 0;
for (const t of targets) {
  for (const rel of SHARED) {
    const from = join(here, rel); const to = join(t, rel);
    const same = existsSync(to) && readFileSync(from).equals(readFileSync(to));
    if (check) { if (!same) { drift++; console.log(`DRIFT  ${t.split('/').pop()}/${rel}`); } continue; }
    if (same) continue;
    mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to);
    console.log(`copied ${t.split('/').pop()}/${rel}`);
  }
}
if (check) { console.log(drift ? `${drift} file(s) drifted. Run: node scripts/sync-era-api.mjs` : `All ${SHARED.length} shared files are identical in ${targets.length} repo(s).`); process.exit(drift ? 1 : 0); }
