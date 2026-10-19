/**
 * National ID service — talks to backend/NATIONAL_ID_PER_COUNTRY.sql.
 *
 * Every function here is safe to call before that migration has been run: a missing
 * function is reported as `available: false`, and the wallet screens then simply do not
 * ask for an ID. The ID itself is never stored by the browser; the database keeps a keyed
 * hash plus the last 4 characters.
 */

import { getSupabaseClient } from '../lib/supabase/client';
import { checkNationalIdFormat, isMissingFunctionError, nationalIdFormatMessage, normalizeNationalId } from '../utils/nationalId';

const ruleCache = new Map();

const toRule = (row) => (row ? {
  countryCode: row.country_code,
  idType: row.id_type,
  label: row.label,
  pattern: row.pattern,
  example: row.example,
  hint: row.hint,
  isFallback: !!row.is_fallback
} : null);

/** The format rule for a country (other countries get the generic rule). null if unavailable. */
export const getNationalIdRule = async (country) => {
  const code = String(country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  if (ruleCache.has(code)) return ruleCache.get(code);
  const { data, error } = await getSupabaseClient().rpc('get_national_id_rule', { p_country: code });
  if (error) return null;
  const rule = toRule(Array.isArray(data) ? data[0] : data);
  if (rule) ruleCache.set(code, rule);
  return rule;
};

/**
 * Where the signed-in user stands.
 * { available, enforced, exempt, hasId, idType, last4, countryCode, accountCountry, error? }
 * `available: false` means the migration is not installed — treat the feature as off.
 */
export const getNationalIdStatus = async () => {
  const { data, error } = await getSupabaseClient().rpc('get_my_national_id_status');
  if (error) {
    if (isMissingFunctionError(error)) return { available: false };
    // A real failure (offline, timeout): stay "available" so callers do not silently skip the
    // requirement, and surface the problem instead.
    return { available: true, hasId: false, enforced: false, exempt: false, error: error.message };
  }
  if (!data?.authenticated) return { available: true, authenticated: false, hasId: false, enforced: false, exempt: false };
  return {
    available: true,
    authenticated: true,
    enforced: !!data.enforced,
    exempt: !!data.exempt,
    hasId: !!data.hasId,
    idType: data.idType || null,
    last4: data.last4 || null,
    countryCode: data.countryCode || null,
    accountCountry: data.accountCountry || null
  };
};

/** Save the signed-in user's national ID. Resolves { success, error?, last4?, idType? }. */
export const saveNationalId = async (country, value) => {
  const code = String(country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return { success: false, error: 'Choose your country first.' };
  if (!normalizeNationalId(value)) return { success: false, error: 'Enter your national ID.' };

  // Catch an obvious typo before a round trip (the server re-checks everything).
  const rule = await getNationalIdRule(code);
  const local = checkNationalIdFormat(rule, value);
  if (!local.ok) return { success: false, error: nationalIdFormatMessage(rule) };

  const { data, error } = await getSupabaseClient().rpc('set_my_national_id', { p_country: code, p_id: value });
  if (error) return { success: false, error: error.message || 'Could not save your national ID.' };
  if (!data?.success) return { success: false, error: data?.error || 'Could not save your national ID.' };
  return { success: true, last4: data.last4, idType: data.idType, countryCode: data.countryCode };
};

/**
 * The one call the wallet-creation paths make before they carry on: does nothing if the
 * feature is not installed or an ID is already on file, otherwise saves the ID that was typed
 * (or says it is missing). The wallet's own recorded country wins over `country`: the database
 * insists the ID comes from the country the wallet is registered in.
 */
export const ensureNationalId = async ({ country, value } = {}) => {
  const status = await getNationalIdStatus();
  if (!status.available || status.exempt || status.hasId) return { success: true, skipped: true };
  if (!normalizeNationalId(value)) return { success: false, error: 'Enter your national ID to continue.' };
  return saveNationalId(status.accountCountry || country, value);
};

export const nationalIdService = { getNationalIdRule, getNationalIdStatus, saveNationalId, ensureNationalId };
export default nationalIdService;
