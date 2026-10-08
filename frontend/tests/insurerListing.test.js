import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  isHttpsUrl, initials, listingFromInsurer, listingToPayload, validateListing, listingHealth, journeySteps,
  PLAN_TEMPLATES, applyTemplate, planCoach, feeFromPlans, customerPrice, suggestCoverTypes, toDirectoryCard, guessCountry,
} from '../src/utils/insurerListing.js';
import { COVER_TYPE_IDS } from '../src/utils/insuranceCatalog.js';

const TODAY = new Date('2026-10-08T10:00:00Z');

const fullInsurer = () => ({
  status: 'verified', licence_state: 'valid', listed: true, hidden_by_support: false,
  tagline: 'Claims paid in 5 days', description: 'x'.repeat(90), website: 'https://pearl.example',
  logo_url: 'https://pearl.example/logo.png', claims_phone: '+256700111222', claims_decision_days: 5,
  claims_hours: 'Mon-Sat 8am-6pm', service_countries: ['UG', 'KE'], languages: ['English'], founded_year: 2009,
});
const goodPlan = (over = {}) => ({
  plan_id: 'p1', name: 'Boda Shield', active: true, cover_type: 'accident', period_days: 30, audience: ['rider'],
  summary: 'Pays hospital bills after a boda accident.', benefits: ['a', 'b', 'c'], terms_url: 'https://pearl.example/terms',
  premium_ican: 0.5, customer_price_ican: 0.525, ...over,
});

// ── profile ──
test('https links only, with a host', () => {
  assert.equal(isHttpsUrl('https://pearl.example/a?b=1'), true);
  assert.equal(isHttpsUrl('http://pearl.example'), false);
  assert.equal(isHttpsUrl('javascript:alert(1)'), false);
  assert.equal(isHttpsUrl('https://x y.test'), false);
  assert.equal(isHttpsUrl('https://' + 'a'.repeat(250) + '.test'), false);
});

test('initials skip legal suffixes', () => {
  assert.equal(initials('Pearl Assurance Ltd'), 'PA');
  assert.equal(initials('Jubilee'), 'JU');
  assert.equal(initials(''), '?');
});

test('a good listing validates; bad values are named', () => {
  const ok = validateListing(listingFromInsurer(fullInsurer()), TODAY);
  assert.equal(ok.ok, true);
  const bad = validateListing({
    ...listingFromInsurer(fullInsurer()), website: 'http://x.test', logo_url: 'nope', claims_decision_days: '120',
    founded_year: '2999', service_countries: ['UG', 'ZZ'], contact_email: 'x', tagline: 'x'.repeat(121),
  }, TODAY);
  for (const k of ['website', 'logo_url', 'claims_decision_days', 'founded_year', 'service_countries', 'contact_email', 'tagline']) {
    assert.ok(bad.errors[k], `${k} should be flagged`);
  }
});

test('the payload turns blanks into null and numbers into numbers', () => {
  const p = listingToPayload({ ...listingFromInsurer({}), tagline: '  Hi  ', claims_decision_days: '5', founded_year: '' });
  assert.equal(p.tagline, 'Hi');
  assert.equal(p.claims_decision_days, 5);
  assert.equal(p.founded_year, null);
  assert.equal(p.website, null);
  assert.equal(p.listed, true);
});

// ── health ──
test('a complete, verified insurer with a good plan scores 100 and is visible', () => {
  const h = listingHealth({ insurer: fullInsurer(), plans: [goodPlan()] });
  assert.equal(h.score, 100);
  assert.equal(h.visible, true);
  assert.deepEqual(h.blockers, []);
  assert.equal(h.next, null);
  assert.equal(h.level, 'Excellent');
});

test('the weights add up to exactly 100', () => {
  const h = listingHealth({ insurer: {}, plans: [] });
  assert.equal(h.checks.reduce((s, c) => s + c.weight, 0), 100);
});

test('an unverified insurer without plans is invisible, and the first fix is a required one', () => {
  const h = listingHealth({ insurer: { status: 'pending', licence_state: 'valid' }, plans: [] });
  assert.equal(h.visible, false);
  assert.ok(h.blockers.some((b) => /not verified/i.test(b)));
  assert.ok(h.blockers.some((b) => /no plan/i.test(b)));
  assert.equal(h.next.required, true);
  assert.equal(h.next.key, 'verified');
});

test('opting out, support hiding and an expired licence each keep an insurer out of the directory', () => {
  const base = { insurer: fullInsurer(), plans: [goodPlan()] };
  assert.equal(listingHealth({ ...base, insurer: { ...fullInsurer(), listed: false } }).visible, false);
  const hidden = listingHealth({ ...base, insurer: { ...fullInsurer(), hidden_by_support: true, hidden_note: 'Logo is not yours' } });
  assert.equal(hidden.visible, false);
  assert.ok(hidden.blockers.some((b) => b.includes('Logo is not yours')));
  assert.equal(listingHealth({ ...base, insurer: { ...fullInsurer(), licence_state: 'expired' } }).visible, false);
});

test('plans off sale do not count', () => {
  assert.equal(listingHealth({ insurer: fullInsurer(), plans: [goodPlan({ active: false })] }).visible, false);
});

test('a thin plan costs the plan-quality points', () => {
  const thin = listingHealth({ insurer: fullInsurer(), plans: [goodPlan({ benefits: ['a'], terms_url: null })] });
  assert.equal(thin.score, 95);
  assert.ok(thin.missing.some((c) => c.key === 'plan_quality'));
});

// ── journey ──
const state = (steps, key) => steps.find((s) => s.key === key).state;

test('a stranger starts at Apply', () => {
  const s = journeySteps({});
  assert.equal(state(s, 'apply'), 'current');
  assert.equal(state(s, 'live'), 'todo');
});

test('an application under review makes Approval the waiting step', () => {
  const s = journeySteps({ applications: [{ status: 'new' }] });
  assert.equal(state(s, 'apply'), 'done');
  assert.equal(state(s, 'approval'), 'wait');
});

test('after approval the next move is registering the business', () => {
  const s = journeySteps({ applications: [{ status: 'approved' }] });
  assert.equal(state(s, 'approval'), 'done');
  assert.equal(state(s, 'register'), 'current');
});

test('a rejected application is flagged', () => {
  assert.equal(state(journeySteps({ applications: [{ status: 'rejected' }] }), 'approval'), 'bad');
});

test('a verified insurer with a profile and a plan is fully listed', () => {
  const s = journeySteps({ applications: [{ status: 'onboarded' }], insurer: fullInsurer(), plans: [goodPlan()] });
  assert.ok(s.every((x) => x.state === 'done'));
});

test('a verified insurer with no plan is told to add one', () => {
  const s = journeySteps({ insurer: fullInsurer(), plans: [] });
  assert.equal(state(s, 'plan'), 'current');
});

// ── templates ──
test('every cover type has a template that fits the plan limits', () => {
  for (const id of COVER_TYPE_IDS) {
    const t = PLAN_TEMPLATES[id];
    assert.ok(t, `template for ${id}`);
    assert.ok(t.name.length >= 2 && t.name.length <= 80);
    assert.ok(t.summary.length <= 300);
    assert.ok(t.benefits.length >= 3 && t.benefits.length <= 8);
    assert.ok(t.benefits.every((b) => b.length <= 120));
    assert.ok([7, 30, 90, 365].includes(t.period_days));
    assert.ok(t.waiting_days >= 0 && t.waiting_days <= 90);
    assert.ok(t.audience.every((a) => ['person', 'rider', 'business'].includes(a)));
  }
});

test('applying a template fills the form and leaves price to the insurer', () => {
  const f = applyTemplate('medical');
  assert.equal(f.cover_type, 'medical');
  assert.equal(f.waiting_days, 14);
  assert.equal(f.benefits.split('\n').length, 4);
  assert.equal(f.premium_ican, undefined);
  assert.deepEqual(applyTemplate('nope'), {});
});

// ── coach ──
const goodForm = (over = {}) => ({
  name: 'Boda Accident Shield', summary: 'Pays hospital bills and a death benefit after a boda accident.',
  benefits: 'Hospital\nDeath benefit\nTowing', cover_type: 'accident', audience: ['person'], vehicle_types: [],
  period_days: 30, premium_ican: '0.5', cover_limit_ican: '50', waiting_days: 0, terms_url: 'https://pearl.example/t',
  data_discount_pct: 0, ...over,
});

test('a well-made plan scores high with no warnings', () => {
  const c = planCoach(goodForm());
  assert.equal(c.ready, true);
  assert.ok(c.score >= 90);
});

test('an empty plan is told exactly what is missing', () => {
  const c = planCoach({ name: '', summary: '', benefits: '', audience: [], period_days: 30 });
  const ids = c.items.map((x) => x.id);
  for (const id of ['summary', 'benefits', 'audience', 'premium']) assert.ok(ids.includes(id), id);
  assert.equal(c.ready, false);
});

test('the price is judged against the market when there is enough data, and never invented when there is not', () => {
  const bench = { available: true, premium_min_ican: 0.4, premium_median_ican: 0.5, premium_max_ican: 0.6 };
  assert.equal(planCoach(goodForm(), { benchmark: bench }).items.find((x) => x.id === 'market').level, 'ok');
  assert.equal(planCoach(goodForm({ premium_ican: '1.2' }), { benchmark: bench }).items.find((x) => x.id === 'market').level, 'tip');
  assert.match(planCoach(goodForm({ premium_ican: '0.1' }), { benchmark: bench }).items.find((x) => x.id === 'market').text, /Well below/);
  assert.match(planCoach(goodForm(), { benchmark: { available: false } }).items.find((x) => x.id === 'market').text, /Not enough plans/);
  assert.equal(planCoach(goodForm(), { benchmark: null }).items.some((x) => x.id === 'market'), false);
});

test('waiting-period advice depends on the kind of cover', () => {
  assert.ok(planCoach(goodForm({ cover_type: 'life', waiting_days: 0 })).items.some((x) => x.id === 'waiting'));
  assert.ok(planCoach(goodForm({ cover_type: 'accident', waiting_days: 30 })).items.some((x) => x.id === 'waiting'));
  assert.equal(planCoach(goodForm({ cover_type: 'accident', waiting_days: 0 })).items.some((x) => x.id === 'waiting'), false);
});

test('a value ratio that looks wrong is flagged either way', () => {
  assert.ok(planCoach(goodForm({ cover_limit_ican: '2' })).items.some((x) => x.id === 'ratio'));
  assert.ok(planCoach(goodForm({ cover_limit_ican: '900000' })).items.some((x) => x.id === 'ratio'));
  // yearly premium is compared per month, so a yearly plan is not penalised for a large number
  assert.equal(planCoach(goodForm({ period_days: 365, premium_ican: '6', cover_limit_ican: '60' })).items.some((x) => x.id === 'ratio'), false);
});

test('a near-duplicate of an existing plan is pointed out, but not the plan being edited', () => {
  const existing = [goodPlan({ plan_id: 'p1', audience: ['person'] })];
  assert.ok(planCoach(goodForm(), { existing }).items.some((x) => x.id === 'twin'));
  assert.equal(planCoach(goodForm(), { existing, editingId: 'p1' }).items.some((x) => x.id === 'twin'), false);
});

test('data-sharing discounts above the programme cap are a warning', () => {
  const c = planCoach(goodForm({ data_discount_pct: 40 }), { maxDataDiscount: 30 });
  assert.equal(c.items.find((x) => x.id === 'discount').level, 'warn');
  assert.equal(c.ready, false);
});

test('the commission is learned from an existing plan and used for the customer price', () => {
  assert.equal(feeFromPlans([goodPlan()]), 5);
  assert.equal(feeFromPlans([]), null);
  assert.equal(customerPrice(0.5, 5), 0.525);
  assert.equal(customerPrice('', 5), null);
  assert.equal(customerPrice(0.5, null), null);
});

test('cover types without a plan yet are suggested first', () => {
  const order = suggestCoverTypes([goodPlan({ cover_type: 'accident' })]);
  assert.equal(order[order.length - 1], 'accident');
  assert.equal(order.length, COVER_TYPE_IDS.length);
});

// ── directory ──
test('the visitor\'s country is guessed from their browser language, only when supported', () => {
  assert.equal(guessCountry(['en-UG', 'en']), 'UG');
  assert.equal(guessCountry(['en', 'sw-KE']), 'KE');
  assert.equal(guessCountry(['en']), '');
  assert.equal(guessCountry(['xx-ZZ']), '');
  assert.equal(guessCountry([]), '');
});

// ── preview ──
test('the preview card matches what the directory returns: live plans only, cheapest first, unsafe links dropped', () => {
  const card = toDirectoryCard({ ...fullInsurer(), display_name: 'Pearl', website: 'javascript:alert(1)', country_code: 'UG' }, [
    goodPlan({ plan_id: 'a', name: 'Dear', customer_price_ican: 2 }),
    goodPlan({ plan_id: 'b', name: 'Cheap', customer_price_ican: 0.5 }),
    goodPlan({ plan_id: 'c', name: 'Off', active: false, customer_price_ican: 0.1 }),
  ]);
  assert.equal(card.plan_count, 2);
  assert.equal(card.from_price_ican, 0.5);
  assert.deepEqual(card.plans.map((p) => p.name), ['Cheap', 'Dear']);
  assert.equal(card.website, null);
  assert.equal(card.logo_url, 'https://pearl.example/logo.png');
  assert.deepEqual(card.cover_types, ['accident']);
});

// ── the SQL and the helpers agree ──
const MIG = new URL('../../supabase/migrations/20261010400000_insurer_listings.sql', import.meta.url);
test('the helpers and the migration agree on the listing limits', { skip: !existsSync(MIG) }, () => {
  const sql = readFileSync(MIG, 'utf8');
  assert.match(sql, /char_length\(tagline\) <= 120/);
  assert.match(sql, /claims_decision_days BETWEEN 1 AND 90/);
  assert.match(sql, /founded_year BETWEEN 1800 AND 2100/);
  assert.match(sql, /cardinality\(languages\) <= 12/);
  assert.match(sql, /cardinality\(service_countries\) <= 60/);
});

test('the public directory never exposes contact details and is open to visitors', { skip: !existsSync(MIG) }, () => {
  const sql = readFileSync(MIG, 'utf8');
  const dir = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.ins_public_directory('), sql.indexOf('-- 5. Anonymous price guide'));
  assert.doesNotMatch(dir, /contact_email|contact_phone|claims_phone/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.ins_public_directory\(TEXT, TEXT, TEXT\) TO anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.ins_market_benchmark\(TEXT, TEXT, INT, UUID\) TO authenticated;/);
});
