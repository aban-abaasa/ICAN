// The restricted-zone screens call database functions by name with named arguments. A function that is renamed, or an
// argument that is spelled differently on the two sides, does not fail a build: it fails at the gate. This keeps both
// sides honest by reading the migration (the database's side) and the service (the screens' side).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// the zone functions live in three migrations: the zones themselves, the two read-only functions the rider card page adds on top, and the
// public record of a rider who went in by force
const migration = ['20261110100000_restricted_zone_access.sql', '20261111100000_zone_gate_from_card_page.sql', '20261112100000_zone_forced_entry_record.sql']
  .map((file) => readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')).join('\n');
const service = readFileSync(path.join(root, 'frontend/src/services/cmmsZoneAccessService.js'), 'utf8');
// The rider's side lives in the mybodaguy repo; it is checked when that repo sits next to this one, and skipped when it does not.
const riderPath = path.join(root, '../mybodaguy/frontend/src/mybodaguy/services/zoneAccessService.ts');
const riderService = existsSync(riderPath) ? readFileSync(riderPath, 'utf8') : '';
// ...and so is the gate run from the rider card page
const gatePath = path.join(root, '../mybodaguy/frontend/src/mybodaguy/services/gateStaffService.ts');
const gateService = existsSync(gatePath) ? readFileSync(gatePath, 'utf8') : '';

// name -> argument names, for every function the migration defines
const defined = new Map();
for (const m of migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([\s\S]*?)\)\s*(?:RETURNS|$)/g)) {
  const args = [...m[2].matchAll(/\b(p_\w+)\b/g)].map((a) => a[1]);
  defined.set(m[1], args);
}

// every rpc the screens make: name -> argument names
const used = (source) => {
  const calls = new Map();
  for (const m of source.matchAll(/(?:call(?:<[\s\S]*?>)?|supabase\.rpc)\(\s*'(\w+)'\s*(?:,\s*\{([\s\S]*?)\}\s*)?\)/g)) {
    calls.set(m[1], [...(m[2] || '').matchAll(/\b(p_\w+)\s*:/g)].map((a) => a[1]));
  }
  return calls;
};

for (const [label, source] of [['CMMS service', service], ['rider service', riderService], ['card page gate service', gateService]]) {
  if (!source) { test(`${label}: not checked out next to this repo`, { skip: true }, () => {}); continue; }
  const calls = used(source);
  test(`${label}: makes calls to find`, () => assert.ok(calls.size >= 3, `found ${calls.size} calls`));

  for (const [fn, args] of calls) {
    test(`${label}: ${fn} exists in the migration and is called with its own argument names`, () => {
      assert.ok(defined.has(fn), `${fn} is not defined in the migration`);
      const known = new Set(defined.get(fn));
      for (const arg of args) assert.ok(known.has(arg), `${fn} has no argument ${arg} (it has: ${[...known].join(', ')})`);
    });
  }
}

test('every API function the migration grants is used by a screen, or is meant for another caller', () => {
  const granted = new Set([...migration.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)\(/g)].map((m) => m[1]));
  const calledBySomeone = new Set([...used(service).keys(), ...used(riderService).keys(), ...used(gateService).keys()]);
  // the older per-direction check-in / check-out are what mbg_zone_gate_scan is built from; no screen needs them separately
  const meantForOthers = new Set(['mbg_zone_gate_check_in', 'mbg_zone_gate_check_out']);
  if (!riderService || !gateService) return;   // the rider and card page functions are called from the other repo
  for (const fn of granted) {
    assert.ok(calledBySomeone.has(fn) || meantForOthers.has(fn), `${fn} is granted but no screen calls it`);
  }
});

test('the fee rate is a row in the developer-editable fee table with a safe fallback', () => {
  assert.match(migration, /INSERT INTO public\.ican_fee_rates[\s\S]*?'zone_access_fee',\s*0\.03/);
  assert.match(migration, /WHEN 'zone_access_fee'\s+THEN 0\.03/);
});

test('the Transport tool has the gate action so a security role can be given the gate desk', () => {
  const roles = readFileSync(path.join(root, 'frontend/src/components/CMMSRoleConfiguration.jsx'), 'utf8');
  assert.match(roles, /id: 'transport'[^\n]*actions: \[[^\]]*'gate'/);
});
