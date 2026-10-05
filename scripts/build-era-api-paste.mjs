#!/usr/bin/env node
/**
 * Builds ERA_API_PASTE_INTO_SUPABASE.sql: the four Era API migrations, in order, as one file you paste into the
 * Supabase SQL editor and Run once. Generated so it can never drift from the migrations.
 *
 *   node scripts/build-era-api-paste.mjs           write the file
 *   node scripts/build-era-api-paste.mjs --check   exit 1 if the file is out of date
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PARTS = [
  ['supabase/migrations/20261005100000_era_api.sql', 'core: tables, keys, limits, sandbox, sign-up, admin'],
  ['supabase/migrations/20261005100100_era_api_endpoints.sql', 'the public endpoints (coins, FX, tax, boda, stores, farms)'],
  ['supabase/migrations/20261006100000_era_api_business.sql', 'business layer: owner keys and scopes, payment and booking requests, gas, idempotency'],
  ['supabase/migrations/20261006100100_era_api_business_endpoints.sql', 'valuation, supply, gas, journey quotes, product catalogue, and the business endpoints (inventory with expiry, CMMS, payments, bookings)'],
  ['supabase/migrations/20261007100000_era_api_developer_accounts.sql', 'developer accounts: sign in with Google, country (reusing the existing lookup), instant sandbox keys'],
];

const header = `-- ============================================================================
-- ERA API: paste this WHOLE file into the Supabase SQL editor and press Run. Once.
--
-- It is the ${PARTS.length} migrations in the right order:
${PARTS.map(([f, d], i) => `--   ${i + 1}. ${f.replace('supabase/migrations/', '')}\n--        ${d}`).join('\n')}
--
-- Safe to run twice. Changes nothing that exists today: it only ADDS era_api_* tables and era_* functions
-- (and a few nullable columns on those tables). It never touches wallets, payments, rides or stock.
-- Already ran an earlier version of this file? Run this one anyway: the parts you already have are no-ops and the new ones are added.
-- To undo everything: supabase/rollback/20261005_rollback_era_api.sql
--
-- After it runs:
--   * open https://icanera.space/developers/ and press Send
--   * business owners mint their own keys in ICAN: Business > Administration > Developer API
--   * developer accounts (Sign in with Google on /developers): Supabase > Authentication > URL Configuration > Redirect URLs,
--     add https://<each app's domain>/developers/** . Google sign-in itself is already on for ICAN.
--   * make yourself an API admin ONLY if you are not already a platform developer or franchise admin:
--       INSERT INTO public.era_api_admins (user_id, note)
--       SELECT id, 'founder' FROM auth.users WHERE lower(email) = lower('YOUR-EMAIL');
-- ============================================================================
`;

export function build() {
  const body = PARTS.map(([f], i) => `\n-- ################################ PART ${i + 1} of ${PARTS.length}: ${f.replace('supabase/migrations/', '')} ################################\n${readFileSync(join(root, f), 'utf8').replace(/\s+$/, '')}\n`).join('');
  return header + body;
}

const out = join(root, 'ERA_API_PASTE_INTO_SUPABASE.sql');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = build();
  if (process.argv.includes('--check')) {
    const cur = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (cur !== next) { console.error('ERA_API_PASTE_INTO_SUPABASE.sql is out of date. Run: node scripts/build-era-api-paste.mjs'); process.exit(1); }
    console.log('paste file is up to date.');
  } else { writeFileSync(out, next); console.log(`wrote ${out} (${next.split('\n').length} lines)`); }
}
