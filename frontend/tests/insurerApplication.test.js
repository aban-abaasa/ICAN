import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  validateApplication, isFutureLicenceDate, normalizeLicence, regulatorFor, emptyApplication, APPLICATION_STATUS,
} from '../src/utils/insurerApplication.js';
import { COVER_TYPE_IDS } from '../src/utils/insuranceCatalog.js';

const TODAY = new Date('2026-10-07T10:00:00Z');

const good = () => ({
  contact_name: 'Grace Namuli', email: 'grace@pearl.example', company_name: 'Pearl Assurance Ltd', licence_number: 'IRA/UG/0042',
  licence_expiry: '2027-03-31', country_code: 'UG', regulator: 'IRA Uganda',
  cover_types: ['accident', 'third_party'], phone: '+256700000001', description: 'Motor and personal accident cover.',
});

test('a complete application from a licensed insurer passes', () => {
  const r = validateApplication(good(), TODAY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
});

test('an empty form is rejected on every required field', () => {
  const r = validateApplication(emptyApplication(), TODAY);
  assert.equal(r.ok, false);
  for (const k of ['contact_name', 'email', 'company_name', 'licence_number', 'licence_expiry', 'country_code', 'regulator', 'cover_types']) {
    assert.ok(r.errors[k], `${k} should be required`);
  }
});

test('an expired or far-future licence cannot be applied with', () => {
  assert.ok(validateApplication({ ...good(), licence_expiry: '2026-10-06' }, TODAY).errors.licence_expiry);
  assert.equal(validateApplication({ ...good(), licence_expiry: '2026-10-07' }, TODAY).ok, true);
  assert.ok(validateApplication({ ...good(), licence_expiry: '2040-01-01' }, TODAY).errors.licence_expiry);
});

test('licence dates must be real calendar dates', () => {
  assert.equal(isFutureLicenceDate('2027-02-30', TODAY), false);
  assert.equal(isFutureLicenceDate('31/03/2027', TODAY), false);
  assert.equal(isFutureLicenceDate('', TODAY), false);
  assert.equal(isFutureLicenceDate('2027-03-31', TODAY), true);
});

test('a valid email is required, since it is how the company is found after approval', () => {
  assert.ok(validateApplication({ ...good(), email: '' }, TODAY).errors.email);
  assert.ok(validateApplication({ ...good(), email: 'not-an-email' }, TODAY).errors.email);
  assert.equal(validateApplication({ ...good(), email: 'a@b.co' }, TODAY).ok, true);
});

test('the country must be one the app supports, and cover types must be known', () => {
  assert.ok(validateApplication({ ...good(), country_code: 'ZZ' }, TODAY).errors.country_code);
  assert.ok(validateApplication({ ...good(), cover_types: ['pets'] }, TODAY).errors.cover_types);
  assert.ok(validateApplication({ ...good(), cover_types: [] }, TODAY).errors.cover_types);
  assert.equal(validateApplication({ ...good(), cover_types: COVER_TYPE_IDS }, TODAY).ok, true);
});

test('length limits match the database', () => {
  assert.ok(validateApplication({ ...good(), company_name: 'x' }, TODAY).errors.company_name);
  assert.ok(validateApplication({ ...good(), licence_number: '12' }, TODAY).errors.licence_number);
  assert.ok(validateApplication({ ...good(), licence_number: '---' }, TODAY).errors.licence_number);
  assert.ok(validateApplication({ ...good(), description: 'x'.repeat(1001) }, TODAY).errors.description);
  assert.ok(validateApplication({ ...good(), phone: '1'.repeat(41) }, TODAY).errors.phone);
});

test('licence numbers compare ignoring punctuation and case', () => {
  assert.equal(normalizeLicence('ira/ug/0042'), normalizeLicence('IRA UG 0042'));
  assert.equal(normalizeLicence(null), '');
});

test('regulator suggestions exist for the launch countries only', () => {
  assert.match(regulatorFor('ug'), /Uganda/);
  assert.equal(regulatorFor('FR'), '');
});

test('every application status has a label for the applicant', () => {
  for (const s of ['new', 'approved', 'rejected', 'onboarded']) assert.ok(APPLICATION_STATUS[s].label && APPLICATION_STATUS[s].help);
});

// The form and the database must agree on what an applicant may send.
const MIGRATIONS = ['20261010100000_insurer_applications.sql', '20261010200000_insurer_applications_public.sql']
  .map((f) => new URL(`../../supabase/migrations/${f}`, import.meta.url));
const present = MIGRATIONS.every((u) => existsSync(u));
const [FIRST, PUBLIC] = MIGRATIONS;

test('the migration allows exactly the cover types the form offers', { skip: !present }, () => {
  const m = readFileSync(FIRST, 'utf8').match(/cover_types <@ ARRAY\[([^\]]+)\]/);
  assert.ok(m, 'cover_types constraint found');
  const inSql = m[1].split(',').map((x) => x.replace(/['\s]/g, '')).sort();
  assert.deepEqual(inSql, [...COVER_TYPE_IDS].sort());
});

test('like franchise, applying needs no account: submit and status are granted to anon', { skip: !present }, () => {
  const sql = readFileSync(PUBLIC, 'utf8');
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.ins_submit_application\([^)]*\) TO anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.ins_application_status\([^)]*\) TO anon, authenticated;/);
});

test('the old account-only submit function is dropped so the two cannot be confused', { skip: !present }, () => {
  assert.match(readFileSync(PUBLIC, 'utf8'), /DROP FUNCTION IF EXISTS public\.ins_submit_application\(TEXT, TEXT, TEXT, DATE/);
});

// One company, more than one licence.
const MULTI = new URL('../../supabase/migrations/20261010300000_insurer_multiple_licences.sql', import.meta.url);
test('one business may register several insurers: unique per licence and country, not per business', { skip: !existsSync(MULTI) }, () => {
  const sql = readFileSync(MULTI, 'utf8');
  assert.match(sql, /DROP CONSTRAINT/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS ins_insurers_business_licence_uq\s+ON public\.ins_insurers \(business_profile_id, public\.ins_norm_licence\(licence_number\), country_code\)/);
  assert.match(sql, /This licence is already registered for this business/);
  assert.doesNotMatch(sql, /This business is already registered as an insurer/);
});

test('a company can send up to ten applications a day', { skip: !existsSync(MULTI) }, () => {
  assert.match(readFileSync(MULTI, 'utf8'), /created_at > now\(\) - interval '24 hours'\) >= 10/);
});

// Insurance used to be reachable only as a sub-tab of Readiness, so signed-in users never found it.
test('insurance has its own entry in the desktop and mobile navigation', () => {
  const desktop = readFileSync(new URL('../src/components/ICAN_Capital_Engine.jsx', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('../src/components/MobileView.jsx', import.meta.url), 'utf8');
  assert.match(desktop, /id: 'insurance', label: 'Insurance'/);
  assert.match(desktop, /VALID_TABS = \[[^\]]*'insurance'/);
  assert.match(desktop, /activeTab === 'insurance' && renderInsurance\(\)/);
  assert.match(mobile, /openDetailView\('readiness', 'Readiness', 'insurance'\)/);
});

// The insurance partner console sits beside Franchise: avatar menu on mobile, a top tab on desktop.
test('the insurance partner console has its own entry in the desktop and mobile navigation', () => {
  const desktop = readFileSync(new URL('../src/components/ICAN_Capital_Engine.jsx', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('../src/components/MobileView.jsx', import.meta.url), 'utf8');
  assert.match(desktop, /id: 'insurer',\s+label: 'Insurers'/);
  assert.match(desktop, /VALID_TABS = \[[^\]]*'insurer'/);
  assert.match(desktop, /activeTab === 'insurer' && renderInsurer\(\)/);
  assert.match(mobile, /openDetailView\('insurer', 'Insurance partner'\)/);
  assert.match(mobile, /selectedDetail\.tab === 'insurer' && selectedDetail\.item === 'Insurance partner'/);
});

test('the landing page carries the public insurer directory', () => {
  const section = readFileSync(new URL('../src/components/landing/InsurerSection.jsx', import.meta.url), 'utf8');
  assert.match(section, /<InsurerDirectory /);
});
