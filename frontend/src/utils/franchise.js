// Franchise program: pure helpers shared by the landing page, the partner console and the
// developer panel. No React, no network: everything here is unit tested (tests/franchise.test.js)
// and mirrors the rules in supabase/migrations/20261004100000_franchise_layer.sql, which stays the
// source of truth. These exist so a form can say "no" before a round trip, and so a calculator
// shows exactly what the engine would pay.

import { COUNTRIES, getCountryName } from '../constants/countries.js';

// Every country the app supports at sign-up is open to franchise partners from day one: the same
// shared list feeds sign-up, business profiles and these forms. HQ configures a country (tier, reserve,
// pause); it never has to open one. The database seed is kept in step with this list by a test.
export { COUNTRIES };
export const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));
export const isCountryCode = (raw) => COUNTRY_CODES.has(String(raw ?? '').trim().toUpperCase());
export const countryName = (code) => getCountryName(code);

export const PARTNER_TYPES = [
  {
    value: 'country_master',
    label: 'Country Master',
    short: 'Run IcanEra for a whole country',
    blurb: 'You recruit and support agencies in your country, handle local compliance and regulators, and earn an override on everything they sell, plus your own direct sales.',
  },
  {
    value: 'agency',
    label: 'Authorized Agency',
    short: 'Serve businesses in your city',
    blurb: 'You onboard, train and support local businesses on IcanEra and earn a recurring share of every subscription for as long as the customer stays.',
  },
  {
    value: 'referral',
    label: 'Referral Partner',
    short: 'Introduce businesses, no support duty',
    blurb: 'You introduce businesses to IcanEra and earn a share of what they pay for the first year. Nothing to run or support.',
  },
];

export const PRODUCTS = [
  { value: 'icanera', label: 'IcanEra', blurb: 'Business management: books, stock, offline-first' },
  { value: 'supermarketera', label: 'SupermarketEra', blurb: 'Retail: checkout, inventory, suppliers' },
  { value: 'bodagoera', label: 'BodaGoEra', blurb: 'Rides and deliveries (operator licence)' },
];

export const STATUS_LABEL = {
  applied: 'Applied', approved: 'Approved', active: 'Active', suspended: 'Suspended', terminated: 'Terminated',
};
export const STREAM_LABEL = {
  subscription: 'Subscriptions', marketplace_fee: 'Marketplace fees', ride_commission: 'Ride commission', wallet_fee: 'Wallet fees',
};
export const STRUCTURE_LABEL = {
  with_master: 'Agency under a country master', master_direct: 'Country master direct', hq_direct: 'Agency under HQ', referral: 'Referral partner',
};

// ------------------------------------------------------------------ validation (mirrors the SQL)

// Same pattern as the partners / enquiries CHECK constraint on company_reg_number.
const REG_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 ./-]{2,59}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const isValidRegNumber = (raw) => REG_NUMBER_RE.test(String(raw ?? '').trim());
export const isValidEmail = (raw) => {
  const v = String(raw ?? '').trim();
  return v.length > 0 && v.length <= 254 && EMAIL_RE.test(v);
};

/** Punctuation and case are ignored when deciding whether two registrations are the same company. */
export const normalizeRegNumber = (raw) => String(raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export const isSecureUrl = (raw) => {
  const v = String(raw ?? '').trim();
  return v.length > 0 && v.length <= 500 && /^https:\/\//i.test(v);
};

const len = (v) => String(v ?? '').trim().length;

/** Landing-page request form. Returns { ok, errors: { field: message } }. */
export function validateEnquiry(form = {}) {
  const errors = {};
  if (len(form.full_name) < 2 || len(form.full_name) > 120) errors.full_name = 'Please enter your name.';
  if (!isValidEmail(form.email)) errors.email = 'Please enter a valid email address.';
  if (!isCountryCode(form.country)) errors.country = 'Please choose the country you want to operate in.';
  if (len(form.company_reg_country) > 0 && !isCountryCode(form.company_reg_country)) errors.company_reg_country = 'Please choose the country where the company is registered.';
  if (len(form.company_name) < 2 || len(form.company_name) > 160) {
    errors.company_name = 'Franchises are for registered companies: enter the company\'s registered name.';
  }
  if (!isValidRegNumber(form.company_reg_number)) {
    errors.company_reg_number = 'Enter your company registration number (3 to 60 letters, numbers, spaces or - . /).';
  }
  if (!form.confirm_registered) errors.confirm_registered = 'Please confirm that your business is a registered company.';
  if (!PARTNER_TYPES.some((t) => t.value === form.partner_type)) errors.partner_type = 'Choose what you would like to become.';
  const products = Array.isArray(form.products) ? form.products : [];
  if (products.length < 1 || !products.every((p) => PRODUCTS.some((x) => x.value === p))) errors.products = 'Choose at least one product.';
  if (len(form.message) > 2000) errors.message = 'Please keep your message under 2000 characters.';
  if (len(form.phone) > 40) errors.phone = 'That phone number is too long.';
  if (form.clients_estimate !== '' && form.clients_estimate != null) {
    const n = Number(form.clients_estimate);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) errors.clients_estimate = 'Enter a whole number of clients (or leave blank).';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Signed-in application (partner console). Same company rules, plus the optional certificate link. */
export function validateApplication(form = {}) {
  const errors = {};
  if (!PARTNER_TYPES.some((t) => t.value === form.partner_type)) errors.partner_type = 'Choose what you would like to become.';
  if (!isCountryCode(form.country)) errors.country = 'Choose the country you will operate in.';
  if (len(form.company_name) < 2 || len(form.company_name) > 160) errors.company_name = 'Enter the company\'s registered name.';
  if (!isValidRegNumber(form.company_reg_number)) errors.company_reg_number = 'Enter your company registration number.';
  if (!isCountryCode(form.company_reg_country)) errors.company_reg_country = 'Choose the country where the company is registered.';
  if (len(form.company_document_url) > 0 && !isSecureUrl(form.company_document_url)) {
    errors.company_document_url = 'The certificate link must start with https://';
  }
  if (!form.confirm_registered) errors.confirm_registered = 'Please confirm that your business is a registered company.';
  const products = Array.isArray(form.products) ? form.products : [];
  if (products.length < 1) errors.products = 'Choose at least one product.';
  return { ok: Object.keys(errors).length === 0, errors };
}

// ------------------------------------------------------------------ the split (mirrors ican_franchise_allocate)

const SCALE = 100_000_000n; // 8 decimal places, like numeric(18,8)

const toUnits = (n) => BigInt(Math.round(Number(n) * 1e8));
const fromUnits = (u) => Number(u) / 1e8;
/** round-half-up of (units * pctMilli / 100000), exactly, with no float error. */
const shareUnits = (units, pct) => {
  const milli = BigInt(Math.round(Number(pct) * 1000));
  return (units * milli * 2n + 100000n) / 200000n;
};

export const DEFAULT_SETTINGS = Object.freeze({ hq_share_floor_pct: 37, max_kicker_pts: 3, max_penalty_pts: 5 });

/**
 * What the engine would pay on one fee.
 * rule:    { hq_pct, master_pct, agency_pct }
 * who:     { master: boolean, agency: boolean, agencyPartner: boolean }  (who actually exists on the deal;
 *          agencyPartner = the serving partner is an agency, the only kind a quality kicker applies to)
 * Returns amounts (8dp) that always add up to the fee; HQ keeps the rounding remainder.
 */
export function computeSplit(amount, rule, who = {}, adjustPts = 0, settings = DEFAULT_SETTINGS) {
  const gross = toUnits(amount);
  let hq = Number(rule.hq_pct);
  let master = Number(rule.master_pct);
  let agency = Number(rule.agency_pct);

  if (who.agency && who.agencyPartner) {
    let delta = Math.max(-settings.max_penalty_pts, Math.min(settings.max_kicker_pts, Number(adjustPts) || 0));
    if (delta > 0) delta = Math.min(delta, Math.max(hq - settings.hq_share_floor_pct, 0));
    hq -= delta;
    agency += delta;
  }
  const masterU = who.master ? shareUnits(gross, master) : 0n;
  const agencyU = who.agency ? shareUnits(gross, agency) : 0n;
  const hqU = gross - masterU - agencyU;
  return {
    hq: fromUnits(hqU), master: fromUnits(masterU), agency: fromUnits(agencyU),
    hqPct: hq, masterPct: master, agencyPct: agency,
    total: fromUnits(hqU + masterU + agencyU),
    scale: SCALE.toString(),
  };
}

// ------------------------------------------------------------------ tiers

export function tierFor(accounts, settings = { silver_min_accounts: 0, gold_min_accounts: 50, platinum_min_accounts: 200 }) {
  const n = Number(accounts) || 0;
  if (n >= settings.platinum_min_accounts) return 'platinum';
  if (n >= settings.gold_min_accounts) return 'gold';
  return 'silver';
}

/** { tier, next, needed, pct } for a progress bar toward the next tier. */
export function tierProgress(accounts, settings = { silver_min_accounts: 0, gold_min_accounts: 50, platinum_min_accounts: 200 }) {
  const n = Number(accounts) || 0;
  const tier = tierFor(n, settings);
  if (tier === 'platinum') return { tier, next: null, needed: 0, pct: 100 };
  const next = tier === 'silver' ? 'gold' : 'platinum';
  const from = tier === 'silver' ? settings.silver_min_accounts : settings.gold_min_accounts;
  const to = next === 'gold' ? settings.gold_min_accounts : settings.platinum_min_accounts;
  const span = Math.max(to - from, 1);
  return { tier, next, needed: Math.max(to - n, 0), pct: Math.max(0, Math.min(100, Math.round(((n - from) / span) * 100))) };
}

// ------------------------------------------------------------------ formatting

/** ICAN amounts: up to 4 decimals, no trailing zeros, thousands separators. */
export function fmtIcan(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const s = n.toLocaleString('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 0 });
  return s === '-0' ? '0' : s;
}

export const fmtPct = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${Number.isInteger(n) ? n : n.toFixed(1).replace(/\.0$/, '')}%`;
};

// ------------------------------------------------------------------ agency links (?agency=CODE)

const AGENCY_REF_KEY = 'ican_agency_ref';
const AGENCY_CODE_RE = /^[A-Z]{2}-(MS|AG|RF)-[A-Z0-9]{5}$/;

export const isAgencyCode = (raw) => AGENCY_CODE_RE.test(String(raw ?? '').trim().toUpperCase());

/** Read ?agency=CODE out of a query string. Returns the upper-cased code or null. */
export function agencyRefFromSearch(search) {
  try {
    const raw = new URLSearchParams(String(search || '')).get('agency');
    const code = String(raw || '').trim().toUpperCase();
    return AGENCY_CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

/** Remember an agency link a visitor arrived on, so a later sign-up can offer it. Never throws. */
export function captureAgencyRef(search, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  const code = agencyRefFromSearch(search);
  if (!code || !storage) return code;
  try { storage.setItem(AGENCY_REF_KEY, code); } catch { /* storage blocked: the link still works this visit */ }
  return code;
}

export function getStoredAgencyRef(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try {
    const v = String(storage?.getItem(AGENCY_REF_KEY) || '').trim().toUpperCase();
    return AGENCY_CODE_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export const clearStoredAgencyRef = (storage = (typeof localStorage !== 'undefined' ? localStorage : null)) => {
  try { storage?.removeItem(AGENCY_REF_KEY); } catch { /* nothing to clear */ }
};

export const buildAgencyLink = (code, origin = '') => `${String(origin).replace(/\/$/, '')}/?agency=${encodeURIComponent(String(code || '').toUpperCase())}`;

// ------------------------------------------------------------------ errors

/** True when the error means the franchise migration has not been applied to this database. */
export function isBackendMissing(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return code === '42883' || code === '42P01' || code === 'PGRST202' || code === 'PGRST205'
    || /could not find the function|schema cache|does not exist/i.test(msg);
}

/** A person-readable message from a Supabase/Postgres error. RAISE EXCEPTION text is already written for people. */
export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  if (isBackendMissing(error)) return 'Franchises are not switched on for this server yet.';
  const msg = String(error.message || '').trim();
  if (!msg) return fallback;
  if (/permission denied/i.test(msg) || error.code === '42501') {
    return /restricted to the platform developers/i.test(msg)
      ? msg
      : 'You need to be signed in with an authorised account to do that.';
  }
  if (/jwt|not authenticated/i.test(msg)) return 'Please sign in again.';
  if (/duplicate key value/i.test(msg)) return 'That already exists.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'No connection. Check your internet and try again.';
  return msg.length > 240 ? `${msg.slice(0, 237)}...` : msg;
}
