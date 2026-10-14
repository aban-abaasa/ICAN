#!/usr/bin/env node
/**
 * Builds the two paste-into-Supabase files for the Sector Markets and the on-chain tokens, so each can be pasted into the SQL
 * editor and run once. Generated, so they can never drift from the migrations.
 *
 *   node scripts/build-onchain-paste.mjs           write both files
 *   node scripts/build-onchain-paste.mjs --check   exit 1 if either is out of date
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  {
    out: 'SECTOR_TRADING_PASTE_INTO_SUPABASE.sql',
    title: 'SECTOR MARKETS (ten business-sector coins, on the wallet and the public /icaneracoin page)',
    guide: 'SECTOR_TRADING_DEPLOY.md',
    rollback: 'supabase/rollback/20261019_rollback_sector_trading.sql',
    parts: [
      ['supabase/migrations/20261019100000_sector_trading_core.sql', 'the isolated schema, settings, the ten sectors, consent wording, the vault ledger'],
      ['supabase/migrations/20261019110000_sector_trading_telemetry.sql', 'the revenue hook (anonymous totals) and the consent gate'],
      ['supabase/migrations/20261019120000_sector_trading_index.sql', 'the index engine, candles, the public feed, the 5-second fold'],
      ['supabase/migrations/20261019130000_sector_trading_execute.sql', 'buying and selling, the vault, risk limits, operator tools'],
    ],
    after: `-- After it runs: trading is OFF. Nothing changes for businesses until they accept the data clause.
-- Turn trading on only after the checklist in SECTOR_TRADING_DEPLOY.md ("Before you turn trading on"):
--   dev panel > Sector Markets > Turn ON.
`,
  },
  {
    out: 'CHAIN_TOKENS_PASTE_INTO_SUPABASE.sql',
    title: 'ON-CHAIN TOKENS (ICEC-S the stable form, ICEC-C the community form, the bridge, the exchange-rate feed)',
    guide: 'CHAIN_TOKENS_DEPLOY.md',
    rollback: 'supabase/rollback/20261020_rollback_chain.sql',
    parts: [
      ['supabase/migrations/20261020100000_chain_core.sql', 'the isolated schema: linked addresses, withdrawals, burns, the locked ledger, guards'],
      ['supabase/migrations/20261020110000_chain_bridge.sql', 'the bridge functions for users, the relayer and administrators'],
      ['supabase/migrations/20261020120000_chain_fx_oracle.sql', 'the informational USD -> local exchange rate (display only)'],
      ['supabase/migrations/20261021100000_chain_auto_contracts.sql', 'contract addresses and the chain id that fill themselves in from the chain'],
    ],
    after: `-- After it runs: the bridge is OFF and no contract is configured. Next (see CHAIN_TOKENS_DEPLOY.md):
--   1. deploy the contracts to a TEST network with your own key (blockchain/scripts/deploy.js), then
--   2. tell the database the TWO addresses it cannot work out for itself (paste an address or an explorer link):
--        SELECT public.ican_chain_dev_set_contracts('<dev token>', '{"icec_community_address": "0x...", "stable_vault_address": "0x..."}'::jsonb);
--      The chain id, the ICEC-S token, the reserve coin and its symbol are read from the chain by the relayer.
--   3. set the relayer's environment and schedule /api/chain-sync and /api/fx-oracle,
--   4. turn the bridge on in the dev panel (On-chain tab) only after the launch gates in CHAIN_TOKENS_DEPLOY.md are true.
`,
  },
];

const header = (f) => `-- ============================================================================
-- ${f.title}
-- Paste this WHOLE file into the Supabase SQL editor and press Run. Once.
--
-- It is the ${f.parts.length} migrations in the right order:
${f.parts.map(([p, d], i) => `--   ${i + 1}. ${p.replace('supabase/migrations/', '')}\n--        ${d}`).join('\n')}
--
-- Safe to run twice: every part keeps any setting an administrator changed. It only ADDS its own schema and functions;
-- it never edits an existing table's data. Needs the icaneracoin tables that are already deployed (wallets, rates, the dev secret).
-- To undo: ${f.rollback}   (read the note at the top of it first)
-- Guide:   ${f.guide}
--
${f.after}-- ============================================================================
`;

export function build(f) {
  const body = f.parts.map(([p], i) => `\n-- ################################ PART ${i + 1} of ${f.parts.length}: ${p.replace('supabase/migrations/', '')} ################################\n${readFileSync(join(root, p), 'utf8').replace(/\s+$/, '')}\n`).join('');
  return header(f) + body;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let stale = false;
  for (const f of FILES) {
    const out = join(root, f.out);
    const next = build(f);
    if (process.argv.includes('--check')) {
      const cur = existsSync(out) ? readFileSync(out, 'utf8') : '';
      if (cur !== next) { console.error(`${f.out} is out of date. Run: node scripts/build-onchain-paste.mjs`); stale = true; }
    } else { writeFileSync(out, next); console.log(`wrote ${f.out} (${next.split('\n').length} lines)`); }
  }
  if (process.argv.includes('--check')) { if (stale) process.exit(1); console.log('paste files are up to date.'); }
}
