// Insurance company applications from the landing site: pure helpers, no React and no network, so the
// form can say "no" before a round trip. They mirror ins_submit_application() in
// supabase/migrations/20261010100000_insurer_applications.sql, which stays the source of truth.
// Unit tested in tests/insurerApplication.test.js.

import { COVER_TYPE_IDS } from './insuranceCatalog.js';
import { isCountryCode } from './franchise.js';

export const APPLICATION_STATUS = {
  new:       { label: 'Under review',  tone: 'warn',  help: 'Support is checking your licence. You will see the decision here.' },
  approved:  { label: 'Approved',      tone: 'ok',    help: 'Approved. Create your business profile, then register it under Compliance > Insurance > Sell cover. You will be verified straight away.' },
  rejected:  { label: 'Not approved',  tone: 'bad',   help: 'Support could not approve this application.' },
  onboarded: { label: 'Registered',    tone: 'ok',    help: 'Your company is registered as an insurer on IcanEra.' },
};

// Regulators we can suggest; any other country types its own.
export const REGULATORS = {
  UG: 'Insurance Regulatory Authority (IRA Uganda)',
  KE: 'Insurance Regulatory Authority (IRA Kenya)',
  TZ: 'Tanzania Insurance Regulatory Authority (TIRA)',
  RW: 'National Bank of Rwanda (BNR)',
};
export const regulatorFor = (countryCode) => REGULATORS[String(countryCode || '').toUpperCase()] || '';

const len = (v) => String(v ?? '').trim().length;

/** True when `value` (YYYY-MM-DD) is today or later and within ten years, the same window the database allows. */
export function isFutureLicenceDate(value, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return false;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((d.getTime() - start) / 86_400_000);
  return days >= 0 && days <= 3660;
}

/** "UG/INS/0042" and "ug ins 0042" are the same licence. */
export const normalizeLicence = (raw) => String(raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export const emptyApplication = () => ({
  contact_name: '', company_name: '', licence_number: '', licence_expiry: '', country_code: '',
  regulator: '', cover_types: [], phone: '', description: '', website: '',
});

/** The landing-page form. Returns { ok, errors: { field: message } }. */
export function validateApplication(form = {}, today = new Date()) {
  const errors = {};
  if (len(form.contact_name) < 2 || len(form.contact_name) > 120) errors.contact_name = 'Please enter your name.';
  if (len(form.company_name) < 2 || len(form.company_name) > 160) errors.company_name = 'Enter your insurance company\'s registered name.';
  if (len(form.licence_number) < 3 || len(form.licence_number) > 60 || !normalizeLicence(form.licence_number)) {
    errors.licence_number = 'Enter your insurance licence number.';
  }
  if (!isFutureLicenceDate(form.licence_expiry, today)) errors.licence_expiry = 'Enter a licence expiry date in the future. An expired licence cannot be approved.';
  if (!isCountryCode(form.country_code)) errors.country_code = 'Choose the country you are licensed in.';
  if (len(form.regulator) < 2 || len(form.regulator) > 60) errors.regulator = 'Enter the regulator that licensed you.';
  const types = Array.isArray(form.cover_types) ? form.cover_types : [];
  if (types.length < 1 || !types.every((t) => COVER_TYPE_IDS.includes(t))) errors.cover_types = 'Choose at least one kind of cover you offer.';
  if (len(form.phone) > 40) errors.phone = 'That phone number is too long.';
  if (len(form.description) > 1000) errors.description = 'Please keep this under 1000 characters.';
  return { ok: Object.keys(errors).length === 0, errors };
}
