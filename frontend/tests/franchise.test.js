import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  validateEnquiry, validateApplication, isValidRegNumber, isValidEmail, normalizeRegNumber, isSecureUrl,
  computeSplit, tierFor, tierProgress, fmtIcan, fmtPct,
  agencyRefFromSearch, captureAgencyRef, getStoredAgencyRef, clearStoredAgencyRef, buildAgencyLink, isAgencyCode,
  isBackendMissing, friendlyError, PARTNER_TYPES, PRODUCTS, COUNTRIES, isCountryCode, countryName,
} from '../src/utils/franchise.js';

// A storage double so no test depends on a browser.
const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

const goodEnquiry = () => ({
  full_name: 'Amina Okello', email: 'amina@example.com', country: 'KE',
  company_name: 'Okello & Co Accountants Ltd', company_reg_number: 'PVT-AB12CD', confirm_registered: true,
  partner_type: 'agency', products: ['icanera'], phone: '+254700000001', clients_estimate: '80', message: 'Hello',
});

// ---------------------------------------------------------------- the registered-company rule

test('a complete request from a registered company passes', () => {
  const r = validateEnquiry(goodEnquiry());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
});

test('a request without a company name or registration number is refused', () => {
  const noName = validateEnquiry({ ...goodEnquiry(), company_name: '' });
  assert.equal(noName.ok, false);
  assert.match(noName.errors.company_name, /registered compan/i);
  const noReg = validateEnquiry({ ...goodEnquiry(), company_reg_number: '' });
  assert.equal(noReg.ok, false);
  assert.ok(noReg.errors.company_reg_number);
});

test('the "we are a registered company" confirmation is required', () => {
  const r = validateEnquiry({ ...goodEnquiry(), confirm_registered: false });
  assert.equal(r.ok, false);
  assert.ok(r.errors.confirm_registered);
});

test('registration numbers: real-world shapes pass, junk fails (same rule as the database)', () => {
  for (const ok of ['80020001234567', 'PVT-AB12CD', 'CPR/2019/123456', 'UG 2020 0012', 'C.123.456', 'A12']) {
    assert.equal(isValidRegNumber(ok), true, ok);
  }
  for (const bad of ['', 'x', 'ab', '-123456', ' ', '12', '#12345', 'DROP TABLE;--', 'a'.repeat(61)]) {
    assert.equal(isValidRegNumber(bad), false, JSON.stringify(bad));
  }
});

test('the same registration is recognised through case and punctuation', () => {
  assert.equal(normalizeRegNumber('reg.000005'), normalizeRegNumber('REG-000005'));
  assert.equal(normalizeRegNumber(' pvt ab12-cd '), 'PVTAB12CD');
  assert.notEqual(normalizeRegNumber('REG-000005'), normalizeRegNumber('REG-000006'));
});

test('email, products, partner type and numeric fields are validated', () => {
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(isValidEmail(`${'x'.repeat(250)}@b.co`), false);
  assert.ok(validateEnquiry({ ...goodEnquiry(), products: [] }).errors.products);
  assert.ok(validateEnquiry({ ...goodEnquiry(), products: ['bitcoin'] }).errors.products);
  assert.ok(validateEnquiry({ ...goodEnquiry(), partner_type: 'emperor' }).errors.partner_type);
  assert.ok(validateEnquiry({ ...goodEnquiry(), clients_estimate: '-3' }).errors.clients_estimate);
  assert.ok(validateEnquiry({ ...goodEnquiry(), clients_estimate: '1.5' }).errors.clients_estimate);
  assert.equal(validateEnquiry({ ...goodEnquiry(), clients_estimate: '' }).ok, true);
  assert.ok(validateEnquiry({ ...goodEnquiry(), message: 'x'.repeat(2001) }).errors.message);
});

test('an application needs a registration country and an https certificate link', () => {
  const base = {
    partner_type: 'agency', country: 'UG', company_name: 'Real Registered Ltd', company_reg_number: '80020001234567',
    company_reg_country: 'UG', company_document_url: '', confirm_registered: true, products: ['icanera'],
  };
  assert.equal(validateApplication(base).ok, true);
  assert.equal(validateApplication({ ...base, company_document_url: 'https://drive.google.com/file/d/abc/view' }).ok, true);
  assert.ok(validateApplication({ ...base, company_document_url: 'http://insecure.example/cert.pdf' }).errors.company_document_url);
  assert.ok(validateApplication({ ...base, company_reg_country: '' }).errors.company_reg_country);
  assert.ok(validateApplication({ ...base, company_name: '' }).errors.company_name);
  assert.equal(isSecureUrl('https://x.co/a'), true);
  assert.equal(isSecureUrl('javascript:alert(1)'), false);
  assert.equal(isSecureUrl('//x.co/a'), false);
});

test('every partner type and product the UI offers is one the database accepts', () => {
  assert.deepEqual(PARTNER_TYPES.map((t) => t.value).sort(), ['agency', 'country_master', 'referral']);
  assert.deepEqual(PRODUCTS.map((p) => p.value).sort(), ['bodagoera', 'icanera', 'supermarketera']);
});

// ---------------------------------------------------------------- the split: held to what the engine pays

const SUB_SILVER = { hq_pct: 40, master_pct: 20, agency_pct: 40 };

test('split: agency under a master, silver, is 40/20/40', () => {
  const s = computeSplit(100, SUB_SILVER, { master: true, agency: true, agencyPartner: true });
  assert.deepEqual([s.hq, s.master, s.agency], [40, 20, 40]);
  assert.equal(s.total, 100);
});

test('split: gold and platinum shrink the master override, not HQ', () => {
  const gold = computeSplit(100, { hq_pct: 40, master_pct: 15, agency_pct: 45 }, { master: true, agency: true, agencyPartner: true });
  assert.deepEqual([gold.hq, gold.master, gold.agency], [40, 15, 45]);
  const plat = computeSplit(100, { hq_pct: 40, master_pct: 10, agency_pct: 50 }, { master: true, agency: true, agencyPartner: true });
  assert.deepEqual([plat.hq, plat.master, plat.agency], [40, 10, 50]);
});

test('split: country master selling direct takes 60%, HQ 40%', () => {
  const s = computeSplit(100, { hq_pct: 40, master_pct: 60, agency_pct: 0 }, { master: true, agency: false });
  assert.deepEqual([s.hq, s.master, s.agency], [40, 60, 0]);
});

test('split: rounding to 8 decimals leaves HQ the remainder and the parts always add up', () => {
  const s = computeSplit(0.33333333, SUB_SILVER, { master: true, agency: true, agencyPartner: true });
  assert.equal(s.agency, 0.13333333);
  assert.equal(s.master, 0.06666667);
  assert.equal(s.hq, 0.13333333);
  assert.equal(s.total, 0.33333333);
});

test('split: a fee too small to give a share does not invent money', () => {
  const s = computeSplit(0.00000001, SUB_SILVER, { master: true, agency: true, agencyPartner: true });
  assert.equal(s.total, 0.00000001);
  assert.ok(s.agency >= 0 && s.master >= 0 && s.hq >= 0);
});

test('split: quality kicker +3 moves 3 points from HQ to the agency', () => {
  const s = computeSplit(100, SUB_SILVER, { master: true, agency: true, agencyPartner: true }, 3);
  assert.deepEqual([s.hq, s.master, s.agency], [37, 20, 43]);
});

test('split: kicker and penalty are clamped to the configured bounds', () => {
  const who = { master: true, agency: true, agencyPartner: true };
  assert.equal(computeSplit(100, SUB_SILVER, who, 10).agency, 43);   // clamped to +3
  const pen = computeSplit(100, SUB_SILVER, who, -10);               // clamped to -5
  assert.deepEqual([pen.hq, pen.agency], [45, 35]);
});

test('split: HQ never drops under its floor because of a kicker', () => {
  const who = { master: true, agency: true, agencyPartner: true };
  const s = computeSplit(100, SUB_SILVER, who, 3, { hq_share_floor_pct: 39, max_kicker_pts: 3, max_penalty_pts: 5 });
  assert.deepEqual([s.hq, s.agency], [39, 41]);
});

test('split: a kicker never applies to a referral partner or to the country master', () => {
  const ref = computeSplit(100, { hq_pct: 80, master_pct: 0, agency_pct: 20 }, { master: false, agency: true, agencyPartner: false }, 3);
  assert.deepEqual([ref.hq, ref.agency], [80, 20]);
});

test('split: parity with exact decimal arithmetic across many awkward amounts', () => {
  // Reference: integer maths in 1e-8 units with round-half-up, the way numeric ROUND(x, 8) behaves.
  const ref = (amount, pct) => {
    const g = BigInt(Math.round(amount * 1e8));
    const milli = BigInt(Math.round(pct * 1000));
    return Number((g * milli * 2n + 100000n) / 200000n) / 1e8;
  };
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 500; i += 1) {
    const amount = Math.round(rnd() * 1e6) / 1e4 + 0.00000001 * Math.floor(rnd() * 99);
    const s = computeSplit(amount, SUB_SILVER, { master: true, agency: true, agencyPartner: true });
    assert.equal(s.agency, ref(amount, 40), `agency @ ${amount}`);
    assert.equal(s.master, ref(amount, 20), `master @ ${amount}`);
    assert.equal(Math.round((s.hq + s.master + s.agency) * 1e8), Math.round(amount * 1e8), `sum @ ${amount}`);
  }
});

// ---------------------------------------------------------------- tiers

test('tiers follow active accounts at the configured thresholds', () => {
  const cfg = { silver_min_accounts: 0, gold_min_accounts: 50, platinum_min_accounts: 200 };
  assert.equal(tierFor(0, cfg), 'silver');
  assert.equal(tierFor(49, cfg), 'silver');
  assert.equal(tierFor(50, cfg), 'gold');
  assert.equal(tierFor(199, cfg), 'gold');
  assert.equal(tierFor(200, cfg), 'platinum');
  assert.equal(tierFor(undefined, cfg), 'silver');
});

test('tier progress reports what is left and never leaves 0..100', () => {
  const cfg = { silver_min_accounts: 0, gold_min_accounts: 50, platinum_min_accounts: 200 };
  assert.deepEqual(tierProgress(25, cfg), { tier: 'silver', next: 'gold', needed: 25, pct: 50 });
  assert.deepEqual(tierProgress(125, cfg), { tier: 'gold', next: 'platinum', needed: 75, pct: 50 });
  assert.deepEqual(tierProgress(500, cfg), { tier: 'platinum', next: null, needed: 0, pct: 100 });
  assert.equal(tierProgress(-5, cfg).pct, 0);
});

// ---------------------------------------------------------------- formatting

test('amounts format sensibly', () => {
  assert.equal(fmtIcan(1234.5), '1,234.5');
  assert.equal(fmtIcan(0.13333333), '0.1333');
  assert.equal(fmtIcan(0), '0');
  assert.equal(fmtIcan('abc'), '0');
  assert.equal(fmtPct(40), '40%');
  assert.equal(fmtPct(12.5), '12.5%');
});

// ---------------------------------------------------------------- agency links

test('an agency link is read, stored and cleared safely', () => {
  assert.equal(agencyRefFromSearch('?agency=ug-ag-k7m2x'), 'UG-AG-K7M2X');
  assert.equal(agencyRefFromSearch('?agency=<script>'), null);
  assert.equal(agencyRefFromSearch('?agency=UG-AG-K7M2X0'), null);
  assert.equal(agencyRefFromSearch(''), null);
  const store = memoryStorage();
  assert.equal(captureAgencyRef('?utm=1&agency=KE-RF-ABCDE', store), 'KE-RF-ABCDE');
  assert.equal(getStoredAgencyRef(store), 'KE-RF-ABCDE');
  captureAgencyRef('?agency=garbage', store);                 // a bad link never overwrites a good one
  assert.equal(getStoredAgencyRef(store), 'KE-RF-ABCDE');
  clearStoredAgencyRef(store);
  assert.equal(getStoredAgencyRef(store), null);
});

test('blocked storage never throws', () => {
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(captureAgencyRef('?agency=UG-AG-K7M2X', blocked), 'UG-AG-K7M2X');
  assert.equal(getStoredAgencyRef(blocked), null);
  assert.doesNotThrow(() => clearStoredAgencyRef(blocked));
});

test('agency links and codes', () => {
  assert.equal(buildAgencyLink('ug-ag-k7m2x', 'https://icanera.space/'), 'https://icanera.space/?agency=UG-AG-K7M2X');
  assert.equal(isAgencyCode('UG-AG-K7M2X'), true);
  assert.equal(isAgencyCode('UG-XX-K7M2X'), false);
  assert.equal(isAgencyCode(''), false);
});

// ---------------------------------------------------------------- errors

test('a database without the migration is recognised, and explained plainly', () => {
  for (const e of [{ code: '42883', message: 'function x does not exist' }, { code: 'PGRST202', message: 'Could not find the function public.x' },
                   { code: '42P01', message: 'relation does not exist' }, { message: 'schema cache' }]) {
    assert.equal(isBackendMissing(e), true);
    assert.match(friendlyError(e), /not switched on/i);
  }
  assert.equal(isBackendMissing({ message: 'Please enter your name' }), false);
  assert.equal(isBackendMissing(null), false);
});

test('database messages written for people pass through; technical ones are softened', () => {
  assert.equal(friendlyError({ message: 'Please enter a valid email address' }), 'Please enter a valid email address');
  assert.match(friendlyError({ code: '42501', message: 'permission denied for function x' }), /signed in with an authorised account/i);
  assert.match(friendlyError({ code: '42501', message: 'Franchise administration is restricted to the platform developers' }), /restricted to the platform developers/);
  assert.match(friendlyError({ message: 'Failed to fetch' }), /No connection/);
  assert.match(friendlyError({ message: 'duplicate key value violates unique constraint "x"' }), /already exists/);
  assert.equal(friendlyError(null, 'fallback'), 'fallback');
  assert.ok(friendlyError({ message: 'x'.repeat(500) }).length <= 240);
});

// ---------------------------------------------------------------- every country is open

test('every country the app supports at sign-up is accepted, in any case', () => {
  assert.ok(COUNTRIES.length >= 180);
  for (const c of COUNTRIES) {
    assert.equal(isCountryCode(c.code), true, c.code);
    assert.equal(isCountryCode(c.code.toLowerCase()), true, c.code);
    assert.equal(validateEnquiry({ ...goodEnquiry(), country: c.code }).ok, true, c.code);
  }
  for (const bad of ['', 'ZZ', 'XX', 'Kenya', 'K', 'KEN', null, undefined, 'U G']) assert.equal(isCountryCode(bad), false, String(bad));
  assert.equal(countryName('BR'), 'Brazil');
  assert.ok(validateEnquiry({ ...goodEnquiry(), country: 'ZZ' }).errors.country);
  assert.ok(validateEnquiry({ ...goodEnquiry(), company_reg_country: 'ZZ' }).errors.company_reg_country);
  assert.equal(validateEnquiry({ ...goodEnquiry(), company_reg_country: 'PT' }).ok, true);
});

test('applications may be made for, and registered in, any country in the list', () => {
  const base = { partner_type: 'agency', country: 'BR', company_name: 'Sao Paulo Digital Ltda', company_reg_number: 'BR-CNPJ-123456',
    company_reg_country: 'PT', confirm_registered: true, products: ['icanera'] };
  assert.equal(validateApplication(base).ok, true);
  assert.ok(validateApplication({ ...base, country: 'ZZ' }).errors.country);
  assert.ok(validateApplication({ ...base, company_reg_country: '' }).errors.company_reg_country);
});

// The database seeds one territory per country. If the app's list gains or loses a country and the migration
// does not, a company there could not apply (or a stale row would linger). This keeps the two in step.
const MIGRATION = new URL('../../supabase/migrations/20261004100000_franchise_layer.sql', import.meta.url);
test('the database seed covers exactly the app\'s country list', { skip: !existsSync(MIGRATION) && 'migration file not in this checkout' }, () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const from = sql.indexOf('Every country the app supports at sign-up');
  assert.ok(from > 0, 'seed block not found');
  const block = sql.slice(from, sql.indexOf('ON CONFLICT (country_code)', from));
  const seeded = new Map([...block.matchAll(/^\s+\('([A-Z]{2})', '((?:[^']|'')*)'\)/gm)].map((m) => [m[1], m[2].replace(/''/g, "'")]));
  const app = new Map(COUNTRIES.map((c) => [c.code, c.name]));
  const missing = [...app.keys()].filter((k) => !seeded.has(k));
  const extra = [...seeded.keys()].filter((k) => !app.has(k));
  const renamed = [...app].filter(([k, v]) => seeded.has(k) && seeded.get(k) !== v).map(([k]) => k);
  assert.deepEqual({ missing, extra, renamed }, { missing: [], extra: [], renamed: [] });
});
