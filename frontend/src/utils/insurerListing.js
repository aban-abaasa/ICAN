// Insurance partner listings: the pure logic behind the insurer console (no React, no network), so it
// is unit tested (tests/insurerListing.test.js). It mirrors the rules in
// supabase/migrations/20261010400000_insurer_listings.sql, which stays the source of truth: the screens
// use these helpers to say "no" before a round trip and to coach the insurer towards a listing customers
// trust. Nothing here is a gate; the database decides what is visible and sellable.

import { COVER_TYPES } from './insuranceCatalog.js';
import { isCountryCode, isValidEmail } from './franchise.js';

// ── Listing profile ──────────────────────────────────────────────────────────

export const LANGUAGE_SUGGESTIONS = [
  'English', 'Swahili', 'Luganda', 'Kinyarwanda', 'French', 'Arabic', 'Portuguese', 'Amharic', 'Hausa', 'Yoruba', 'Zulu', 'Afrikaans',
];

const HTTPS_URL_RE = /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:\d+)?(\/\S*)?$/i;
export const isHttpsUrl = (v, max = 200) => {
  const s = String(v ?? '').trim();
  return s.length > 0 && s.length <= max && HTTPS_URL_RE.test(s);
};

const len = (v) => String(v ?? '').trim().length;

/** Two letters for the logo placeholder: "Pearl Assurance Ltd" -> "PA". */
export const initials = (name) => {
  const words = String(name ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
    .filter((w) => !/^(ltd|limited|plc|inc|co|company|the|of|and)$/i.test(w));
  const letters = (words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [(words[0] || '?').slice(0, 2)]).join('');
  return letters.toUpperCase();
};

/** The editable listing as the form holds it (strings, so inputs stay controlled). */
export const listingFromInsurer = (i = {}) => ({
  tagline: i.tagline || '',
  description: i.description || '',
  website: i.website || '',
  logo_url: i.logo_url || '',
  service_countries: Array.isArray(i.service_countries) ? i.service_countries : [],
  languages: Array.isArray(i.languages) ? i.languages : [],
  claims_decision_days: i.claims_decision_days == null ? '' : String(i.claims_decision_days),
  claims_hours: i.claims_hours || '',
  founded_year: i.founded_year == null ? '' : String(i.founded_year),
  claims_phone: i.claims_phone || '',
  contact_email: i.contact_email || '',
  contact_phone: i.contact_phone || '',
  listed: i.listed !== false,
});

/** The payload ins_update_listing() takes: numbers as numbers, blanks as null. */
export const listingToPayload = (f) => ({
  tagline: f.tagline.trim() || null,
  description: f.description.trim() || null,
  website: f.website.trim() || null,
  logo_url: f.logo_url.trim() || null,
  service_countries: f.service_countries,
  languages: f.languages,
  claims_decision_days: f.claims_decision_days === '' ? null : Number(f.claims_decision_days),
  claims_hours: f.claims_hours.trim() || null,
  founded_year: f.founded_year === '' ? null : Number(f.founded_year),
  claims_phone: f.claims_phone.trim() || null,
  contact_email: f.contact_email.trim() || null,
  contact_phone: f.contact_phone.trim() || null,
  listed: Boolean(f.listed),
});

export function validateListing(f = {}, today = new Date()) {
  const errors = {};
  if (len(f.tagline) > 120) errors.tagline = 'Keep the tagline to 120 characters.';
  if (len(f.description) > 500) errors.description = 'Keep the description to 500 characters.';
  if (len(f.website) > 0 && !isHttpsUrl(f.website, 200)) errors.website = 'Use your website\'s full https:// address.';
  if (len(f.logo_url) > 0 && !isHttpsUrl(f.logo_url, 300)) errors.logo_url = 'Use the logo\'s full https:// image address.';
  if (len(f.contact_email) > 0 && !isValidEmail(f.contact_email)) errors.contact_email = 'Enter a valid contact email.';
  if (len(f.claims_phone) > 30) errors.claims_phone = 'That phone number is too long.';
  if (len(f.contact_phone) > 30) errors.contact_phone = 'That phone number is too long.';
  if (f.claims_decision_days !== '' && f.claims_decision_days != null) {
    const n = Number(f.claims_decision_days);
    if (!Number.isInteger(n) || n < 1 || n > 90) errors.claims_decision_days = 'Claims decisions take 1 to 90 days.';
  }
  if (len(f.claims_hours) > 120) errors.claims_hours = 'Keep the claims hours to 120 characters.';
  if (f.founded_year !== '' && f.founded_year != null) {
    const y = Number(f.founded_year);
    if (!Number.isInteger(y) || y < 1800 || y > today.getUTCFullYear()) errors.founded_year = 'Enter the year the company was founded.';
  }
  const countries = Array.isArray(f.service_countries) ? f.service_countries : [];
  if (countries.length > 60 || !countries.every(isCountryCode)) errors.service_countries = 'Choose countries from the list.';
  const langs = Array.isArray(f.languages) ? f.languages : [];
  if (langs.length > 12 || !langs.every((l) => len(l) >= 2 && len(l) <= 30)) errors.languages = 'List up to 12 languages.';
  return { ok: Object.keys(errors).length === 0, errors };
}

// ── How listed am I? ─────────────────────────────────────────────────────────

const activePlans = (plans) => (Array.isArray(plans) ? plans : []).filter((p) => p.active);
const planIsWellDescribed = (p) => len(p.summary) >= 20 && (p.benefits || []).length >= 3 && isHttpsUrl(p.terms_url, 300);

/**
 * A 0-100 listing score and the specific things to fix, most valuable first. `visible` says whether the
 * insurer is in the public directory right now and `blockers` says why not. The checks are weighted by how
 * much they help a customer decide: a verified licence and a plan on sale matter most.
 */
export function listingHealth({ insurer, plans }) {
  const i = insurer || {};
  const live = activePlans(plans);
  const verified = i.status === 'verified';
  const licenceOk = i.licence_state ? i.licence_state !== 'expired' : true;
  const wellDescribed = live.length > 0 && live.every(planIsWellDescribed);

  const checks = [
    { key: 'verified', weight: 20, required: true, tab: 'apply', label: 'Licence verified by support', done: verified,
      hint: i.status === 'pending' ? 'Support is checking your licence.' : i.status === 'suspended' ? 'Your listing is suspended. Contact support.' : 'Apply, then register your business.' },
    { key: 'licence', weight: 5, required: true, tab: 'apply', label: 'Licence in date', done: licenceOk,
      hint: 'Update the licence under Applications as soon as it is renewed.' },
    { key: 'plan', weight: 20, required: true, tab: 'plans', label: 'At least one plan on sale', done: live.length > 0,
      hint: 'Create a plan from a template in a minute. Customers only see insurers with a plan on sale.' },
    { key: 'about', weight: 10, tab: 'listing', label: 'A real description (80+ characters)', done: len(i.description) >= 80,
      hint: 'Say who you insure, what you are known for, and how you pay claims.' },
    { key: 'claims_phone', weight: 8, tab: 'listing', label: 'Claims phone number', done: len(i.claims_phone) > 0,
      hint: 'Policyholders look for this first when something goes wrong.' },
    { key: 'tagline', weight: 5, tab: 'listing', label: 'One-line tagline', done: len(i.tagline) >= 10,
      hint: 'A short promise shown under your name, e.g. "Claims paid in 5 days".' },
    { key: 'decision_days', weight: 5, tab: 'listing', label: 'Claims decision time', done: i.claims_decision_days != null,
      hint: 'A promised decision time is the strongest trust signal you can give.' },
    { key: 'website', weight: 5, tab: 'listing', label: 'Website', done: isHttpsUrl(i.website),
      hint: 'An https:// link lets customers check you out.' },
    { key: 'logo', weight: 5, tab: 'listing', label: 'Logo', done: isHttpsUrl(i.logo_url, 300),
      hint: 'A link to your logo image (https://). Without one customers see your initials.' },
    { key: 'countries', weight: 4, tab: 'listing', label: 'Countries you serve', done: (i.service_countries || []).length > 0,
      hint: 'Customers filter by country. Your licence country always counts.' },
    { key: 'hours', weight: 3, tab: 'listing', label: 'Claims hours', done: len(i.claims_hours) > 0,
      hint: 'e.g. "Mon-Sat, 8am-6pm".' },
    { key: 'languages', weight: 3, tab: 'listing', label: 'Languages you serve in', done: (i.languages || []).length > 0,
      hint: 'People choose insurers who speak their language.' },
    { key: 'founded', weight: 2, tab: 'listing', label: 'Year founded', done: i.founded_year != null,
      hint: 'Track record builds trust.' },
    { key: 'plan_quality', weight: 5, tab: 'plans', label: 'Every plan has a summary, 3+ benefits and a terms link', done: wellDescribed,
      hint: 'Clear plans sell more and cause fewer claim disputes.' },
  ];

  const score = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  const missing = checks.filter((c) => !c.done).sort((a, b) => (Number(!!b.required) - Number(!!a.required)) || b.weight - a.weight);

  const blockers = [];
  if (!verified) blockers.push(i.status === 'suspended' ? 'Your insurer is suspended.' : 'Support has not verified your licence yet.');
  if (!licenceOk) blockers.push('Your licence has expired.');
  if (live.length === 0) blockers.push('You have no plan on sale.');
  if (i.listed === false) blockers.push('You switched the public listing off.');
  if (i.hidden_by_support) blockers.push(i.hidden_note ? `Support hid your listing: ${i.hidden_note}` : 'Support hid your listing.');

  const level = score >= 90 ? 'Excellent' : score >= 70 ? 'Strong' : score >= 40 ? 'Getting there' : 'Just started';
  return { score, level, checks, missing, next: missing[0] || null, visible: blockers.length === 0, blockers };
}

// ── The journey from "interested" to "customers can find me" ─────────────────────

/**
 * Seven steps with a state each: done | current | wait | bad | todo. Exactly one step is the one to act on
 * (or wait for). `applications` come from ins_my_applications, `insurer` is the one being looked at.
 */
export function journeySteps({ applications = [], insurer = null, plans = [] } = {}) {
  const apps = Array.isArray(applications) ? applications : [];
  const hasApproved = apps.some((a) => a.status === 'approved' || a.status === 'onboarded');
  const hasOpen = apps.some((a) => a.status === 'new');
  const allRejected = apps.length > 0 && apps.every((a) => a.status === 'rejected');
  const i = insurer;
  const health = listingHealth({ insurer: i, plans });
  const coreProfile = Boolean(i && len(i.description) >= 40 && len(i.claims_phone) > 0 && len(i.tagline) > 0);

  const steps = [
    { key: 'apply', label: 'Apply', sub: 'Send your licence', state: apps.length > 0 || i ? 'done' : 'todo' },
    { key: 'approval', label: 'Approval', sub: 'Support checks it',
      state: i && i.status === 'verified' ? 'done' : hasApproved || i ? 'done' : allRejected ? 'bad' : hasOpen ? 'wait' : 'todo' },
    { key: 'register', label: 'Register', sub: 'Link your business', state: i ? 'done' : 'todo' },
    { key: 'verified', label: 'Verified', sub: 'Badge on your listing',
      state: !i ? 'todo' : i.status === 'verified' ? 'done' : i.status === 'pending' ? 'wait' : 'bad' },
    { key: 'profile', label: 'Profile', sub: 'Tell customers who you are', state: coreProfile ? 'done' : 'todo' },
    { key: 'plan', label: 'First plan', sub: 'Put cover on sale', state: activePlans(plans).length > 0 ? 'done' : 'todo' },
    { key: 'live', label: 'Listed', sub: 'Found in the directory', state: health.visible ? 'done' : 'todo' },
  ];
  // The first step that is not done is where the insurer is now.
  const idx = steps.findIndex((s) => s.state !== 'done');
  if (idx >= 0 && steps[idx].state === 'todo') steps[idx] = { ...steps[idx], state: 'current' };
  return steps;
}

// ── Plans: templates and the coach ───────────────────────────────────────────

/** A starting point for each kind of cover; every field stays editable. Benefits are one per line, as the form holds them. */
export const PLAN_TEMPLATES = {
  accident: {
    name: 'Personal Accident Cover', audience: ['person', 'rider'], period_days: 30, waiting_days: 0,
    summary: 'Pays hospital bills and a death or disability benefit after an accident.',
    benefits: ['Hospital bills up to the limit', 'Death benefit', 'Permanent disability benefit', 'Ambulance and emergency transport'],
    tip: 'Riders look for hospital cover first. Keep the waiting period short.',
  },
  third_party: {
    name: 'Third-Party Motor Cover', audience: ['rider'], period_days: 365, waiting_days: 0,
    summary: 'The legal minimum: pays for injury or damage you cause to other people.',
    benefits: ['Injury to other people', 'Damage to other people\'s property', 'Legal costs of the claim', 'Valid across the country'],
    tip: 'A yearly period matches how the legal minimum is usually bought.',
  },
  comprehensive: {
    name: 'Comprehensive Motor Cover', audience: ['rider', 'business'], period_days: 365, waiting_days: 0,
    summary: 'Your vehicle and anyone you harm are covered, including theft and accidental damage.',
    benefits: ['Accidental damage to your vehicle', 'Theft and total loss', 'Injury and damage to other people', 'Towing after an accident'],
    tip: 'Say clearly what is excluded; it prevents most claim disputes.',
  },
  medical: {
    name: 'Everyday Medical Cover', audience: ['person'], period_days: 30, waiting_days: 14,
    summary: 'Clinic visits, hospital stays and prescribed medicines, paid up to the limit.',
    benefits: ['Clinic and doctor visits', 'Hospital admission', 'Prescribed medicines', 'Laboratory tests'],
    tip: 'A short waiting period (about two weeks) is normal and protects the plan from abuse.',
  },
  life: {
    name: 'Family Life Cover', audience: ['person'], period_days: 365, waiting_days: 30,
    summary: 'A lump sum for your family if you die, with funeral costs paid quickly.',
    benefits: ['Lump sum to your family', 'Funeral costs paid within 48 hours', 'Accidental death top-up'],
    tip: 'Paying funeral costs fast is what families remember.',
  },
  goods_in_transit: {
    name: 'Parcel & Cargo Cover', audience: ['business'], period_days: 30, waiting_days: 0,
    summary: 'Covers parcels and goods you carry against loss, theft and accidents on the road.',
    benefits: ['Loss or theft in transit', 'Damage from an accident', 'Cover for the day\'s deliveries'],
    tip: 'Delivery businesses want monthly cover that follows their volume.',
  },
  property: {
    name: 'Shop & Stock Cover', audience: ['business'], period_days: 365, waiting_days: 0,
    summary: 'Protects your stock, equipment and premises from fire, theft and break-ins.',
    benefits: ['Fire and theft of stock', 'Damage to equipment', 'Repairs after a break-in'],
    tip: 'List the stock and equipment limits plainly so owners can pick the right plan.',
  },
  liability: {
    name: 'Business Liability Cover', audience: ['business'], period_days: 365, waiting_days: 0,
    summary: 'Pays when a customer or member of the public claims against your business, including staff injury.',
    benefits: ['Injury or damage claims by customers', 'Staff injury at work', 'Legal defence costs'],
    tip: 'Employers are often required to carry this. Mention the law it satisfies.',
  },
  fleet: {
    name: 'Fleet Cover', audience: ['business'], period_days: 30, waiting_days: 0, group_discount_pct: 10,
    summary: 'All your vehicles on one policy, with a discount for insuring many drivers together.',
    benefits: ['All vehicles on one policy', 'Add or remove vehicles any time', 'Group discount for larger fleets', 'Towing after an accident'],
    tip: 'A group discount is how fleets compare insurers. Offer one.',
  },
};

/** Form defaults for a cover type, shaped like the plan form's state. Unknown types give an empty object. */
export function applyTemplate(coverType) {
  const t = PLAN_TEMPLATES[coverType];
  if (!t) return {};
  return {
    cover_type: coverType, name: t.name, summary: t.summary, benefits: t.benefits.join('\n'), audience: [...t.audience],
    period_days: t.period_days, waiting_days: t.waiting_days, group_discount_pct: t.group_discount_pct || 0,
    vehicle_types: [],
  };
}

/** The programme commission as a percent, learned from a plan the insurer already has (customer price / take-home). Null if unknown. */
export function feeFromPlans(plans) {
  const p = (Array.isArray(plans) ? plans : []).find((x) => Number(x.premium_ican) > 0 && Number(x.customer_price_ican) > 0);
  if (!p) return null;
  return Math.round((Number(p.customer_price_ican) / Number(p.premium_ican) - 1) * 10000) / 100;
}

/** What a customer would pay for a plan form, or null when the fee or the price is not known yet. */
export function customerPrice(premium, feePct) {
  const p = Number(premium);
  if (!(p > 0) || feePct == null) return null;
  return Math.round(p * (1 + feePct / 100) * 1e8) / 1e8;
}

/**
 * Advice on one plan while it is being written. Returns a 0-100 score and items of level
 * 'warn' (fix before saving), 'tip' (worth doing) or 'ok'. `benchmark` is ins_market_benchmark()'s answer
 * (or null), `existing` the insurer's other plans. Never blocks saving: the database is the gate.
 */
export function planCoach(f = {}, { benchmark = null, maxDataDiscount = 30, existing = [], editingId = null } = {}) {
  const items = [];
  const add = (level, id, text) => items.push({ level, id, text });
  const benefits = String(f.benefits || '').split('\n').map((b) => b.trim()).filter(Boolean);
  const premium = Number(f.premium_ican);
  const limit = Number(f.cover_limit_ican);
  const period = Number(f.period_days) || 30;
  const audience = Array.isArray(f.audience) ? f.audience : [];

  if (len(f.name) < 8) add('tip', 'name', 'Give the plan a descriptive name, e.g. "Boda Accident Shield".');

  if (len(f.summary) === 0) add('warn', 'summary', 'Add a one-line summary: what it protects, in plain words.');
  else if (len(f.summary) < 30) add('tip', 'summary', 'The summary is very short. One clear sentence of what is covered sells better.');
  else if (len(f.summary) > 200) add('tip', 'summary', 'Keep the summary to one or two sentences. Put detail in the benefits.');

  if (benefits.length < 3) add('warn', 'benefits', 'List at least 3 benefits. Customers compare plans line by line.');
  else if (benefits.length > 8) add('warn', 'benefits', 'A plan can list at most 8 benefits.');
  if (benefits.some((b) => b.length > 120)) add('warn', 'benefits_len', 'Each benefit can be at most 120 characters.');

  if (audience.length === 0) add('warn', 'audience', 'Choose who can buy this plan.');
  if (audience.includes('rider') && (f.vehicle_types || []).length === 0) {
    add('tip', 'vehicles', 'No vehicle ticked means every vehicle is covered. Tick the ones you really cover.');
  }

  if (!(premium > 0)) add('warn', 'premium', 'Enter what you take home per person, per period.');
  else if (!(limit > 0)) add('warn', 'limit', 'Enter the cover limit.');
  else {
    const monthly = premium * (30 / period);
    const ratio = limit / monthly;
    if (ratio < 12) add('tip', 'ratio', 'The cover limit is low for the price. Customers may see poor value.');
    else if (ratio > 3000) add('tip', 'ratio', 'The cover limit is very high for the price. Make sure you can pay claims at that limit.');
  }

  if (premium > 0 && benchmark && benchmark.available) {
    const med = Number(benchmark.premium_median_ican);
    const lo = Number(benchmark.premium_min_ican);
    const hi = Number(benchmark.premium_max_ican);
    if (premium > med * 1.5) add('tip', 'market', `Above the market: insurers take home ${lo}-${hi} ICAN for this cover (median ${med}). Show what makes yours worth more.`);
    else if (premium < med * 0.6) add('tip', 'market', `Well below the market (median ${med} ICAN). Check the price covers your claims.`);
    else add('ok', 'market', `In line with the market: insurers take home ${lo}-${hi} ICAN for this cover (median ${med}).`);
  } else if (premium > 0 && benchmark && !benchmark.available) {
    add('tip', 'market', 'Not enough plans of this kind yet for a price guide. You can set the pace.');
  }

  if ((f.cover_type === 'medical' || f.cover_type === 'life') && Number(f.waiting_days) === 0) {
    add('tip', 'waiting', 'Medical and life plans normally have a waiting period. Without one the plan can be abused.');
  }
  if (f.cover_type === 'accident' && Number(f.waiting_days) > 14) {
    add('tip', 'waiting', 'A long waiting period puts riders off accident cover. Under two weeks converts better.');
  }

  if (len(f.terms_url) === 0) add('tip', 'terms', 'Add a link to your full policy terms. Customers and regulators expect it.');
  else if (!isHttpsUrl(f.terms_url, 300)) add('warn', 'terms', 'The terms link must be a full https:// address.');

  if (Number(f.data_discount_pct) > maxDataDiscount) add('warn', 'discount', `A data-sharing discount can be at most ${maxDataDiscount}%.`);

  const twin = (Array.isArray(existing) ? existing : []).find((p) => p.plan_id !== editingId && p.active
    && p.cover_type === f.cover_type && Number(p.period_days) === period
    && (p.audience || []).some((a) => audience.includes(a)));
  if (twin) add('tip', 'twin', `You already sell "${twin.name}" for the same cover, period and customers. Make this one clearly different or edit that one.`);

  const warns = items.filter((x) => x.level === 'warn').length;
  const tips = items.filter((x) => x.level === 'tip').length;
  const score = Math.max(0, 100 - warns * 20 - tips * 7);
  return { score, items, ready: warns === 0, label: score >= 90 ? 'Great plan' : score >= 70 ? 'Good plan' : 'Needs work' };
}

/** Cover types sorted so the ones the insurer has not got a plan for yet come first (suggestions for the plan builder). */
export function suggestCoverTypes(plans) {
  const have = new Set(activePlans(plans).map((p) => p.cover_type));
  return Object.keys(COVER_TYPES).sort((a, b) => Number(have.has(a)) - Number(have.has(b)));
}

/**
 * What the public directory shows for an insurer, built from the console's own data, so the live preview
 * in "My listing" is the same card customers see (ins_public_directory() returns this shape).
 */
export function toDirectoryCard(insurer, plans) {
  const i = insurer || {};
  const live = activePlans(plans);
  const priced = live.map((p) => ({
    name: p.name, summary: p.summary || null, cover_type: p.cover_type, audience: p.audience || [], period_days: p.period_days,
    price_ican: Number(p.customer_price_ican ?? p.premium_ican), cover_limit_ican: Number(p.cover_limit_ican), waiting_days: p.waiting_days,
  })).sort((a, b) => a.price_ican - b.price_ican);
  return {
    insurer_id: i.insurer_id || null, name: i.display_name || 'Your company', tagline: i.tagline || null, about: i.description || null,
    regulator: i.regulator || '', licence_number: i.licence_number || '', country: i.country_code || '',
    service_countries: i.service_countries || [], website: isHttpsUrl(i.website) ? i.website : null,
    logo_url: isHttpsUrl(i.logo_url, 300) ? i.logo_url : null, languages: i.languages || [],
    claims_decision_days: i.claims_decision_days ?? null, claims_hours: i.claims_hours || null, founded_year: i.founded_year ?? null,
    plan_count: live.length, cover_types: [...new Set(live.map((p) => p.cover_type))].sort(),
    audiences: [...new Set(live.flatMap((p) => p.audience || []))].sort(),
    from_price_ican: priced.length ? priced[0].price_ican : null, plans: priced.slice(0, 6),
  };
}

/** The visitor's likely country from their browser languages ("en-UG" -> "UG"), only if the app supports it, else "". */
export function guessCountry(languages = (typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [])) {
  for (const l of languages || []) {
    const region = String(l || '').split('-')[1];
    if (region && isCountryCode(region.toUpperCase())) return region.toUpperCase();
  }
  return '';
}
