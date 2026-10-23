/**
 * National ID service — talks to backend/NATIONAL_ID_PER_COUNTRY.sql.
 *
 * Every function here is safe to call before that migration has been run: a missing
 * function is reported as `available: false`, and the wallet screens then simply do not
 * ask for an ID. The ID itself is never stored by the browser; the database keeps a keyed
 * hash plus the last 4 characters.
 *
 * Proving an ID is the holder's (backend/NATIONAL_ID_OWNERSHIP.sql): requestIdVerification / claimNationalId upload the
 * ID photo and selfie to the existing R2 folder through the existing upload route (no new serverless function), then file a
 * request that a reviewer approves in the Dev console (devNationalId).
 */

import { getSupabaseClient } from '../lib/supabase/client';
import { uploadToR2 } from './r2StorageService';
import {
  checkNationalIdFormat, ID_PROOF_FOLDER, isMissingFunctionError, nationalIdFormatMessage, normalizeNationalId, proofFormProblem
} from '../utils/nationalId';

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
    accountCountry: data.accountCountry || null,
    verified: !!data.verified,
    verifiedAt: data.verifiedAt || null,
    nameOnId: data.nameOnId || null,
    requireVerified: !!data.requireVerified,
    walletName: data.walletName || null,
    // The newest ownership request, whatever became of it: { id, kind, status, reviewNote, createdAt, reviewedAt } or null.
    check: data.check || null
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
  if (!data?.success) return { success: false, error: data?.error || 'Could not save your national ID.', code: data?.code || null };
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

// ── Proving an ID is yours ───────────────────────────────────────────────────────────────────────

const uploadProofImage = async (file) => {
  const { data } = await getSupabaseClient().auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) return { success: false, error: 'Your session expired. Please sign in again.' };
  return uploadToR2({ file, folder: ID_PROOF_FOLDER, accessToken });
};

/**
 * File an ownership request. Both photos are checked, uploaded, then handed to the database with the name on the ID.
 *   mode 'verify'  the ID already saved on this wallet is the holder's
 *   mode 'claim'   the ID was saved by someone else first and is really this person's (also needs country + value)
 * Resolves { success, error?, code? }; code is 'not_taken' / 'already_yours' for the claim cases the screen explains.
 */
export const submitIdProof = async ({ mode = 'verify', country, value, nameOnId, idPhoto, selfie, note, walletName } = {}) => {
  const claim = mode === 'claim';
  const problem = proofFormProblem({ nameOnId, walletName, idPhoto, selfie, needsId: claim, country, value });
  if (problem) return { success: false, error: problem };

  const idUpload = await uploadProofImage(idPhoto);
  if (!idUpload.success) return { success: false, error: idUpload.error || 'Could not upload the photo of your ID.' };
  const selfieUpload = await uploadProofImage(selfie);
  if (!selfieUpload.success) return { success: false, error: selfieUpload.error || 'Could not upload your selfie.' };

  const args = { p_name_on_id: String(nameOnId).trim(), p_id_photo: idUpload.url, p_selfie_photo: selfieUpload.url, p_note: String(note || '').trim() || null };
  const { data, error } = claim
    ? await getSupabaseClient().rpc('claim_national_id', { p_country: String(country).trim().toUpperCase(), p_id: value, ...args })
    : await getSupabaseClient().rpc('request_my_id_verification', args);
  if (error) {
    if (isMissingFunctionError(error)) return { success: false, error: 'ID verification is not switched on yet. Please try again later.' };
    return { success: false, error: error.message || 'Could not send your request.' };
  }
  if (!data?.success) return { success: false, error: data?.error || 'Could not send your request.', code: data?.code || null };
  return { success: true, checkId: data.checkId };
};

export const requestIdVerification = (fields) => submitIdProof({ ...fields, mode: 'verify' });
export const claimNationalId = (fields) => submitIdProof({ ...fields, mode: 'claim' });

/**
 * Is the person behind each wallet ID-verified? { [userId]: { verified, nameMatches } }, or null when the database cannot
 * say (not installed, offline): the screen then shows nothing rather than a wrong "not verified". At most 20 per call.
 */
export const getIdTrust = async (userIds) => {
  const ids = [...new Set((userIds || []).filter(Boolean))].slice(0, 20);
  if (!ids.length) return {};
  const { data, error } = await getSupabaseClient().rpc('get_id_trust', { p_user_ids: ids });
  if (error || !Array.isArray(data)) return null;
  return Object.fromEntries(data.map((row) => [row.user_id, { verified: !!row.verified, nameMatches: !!row.name_matches }]));
};

/**
 * The Dev console's side: the queue of ownership requests and the decision. Both take the panel's dev token like every
 * other Dev console tab. `missing: true` means the SQL is not installed.
 */
const devRpc = async (name, args) => {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) {
    if (isMissingFunctionError(error)) return { missing: true };
    throw error;
  }
  return { data };
};

export const devNationalId = {
  list: (token, status = 'pending') => devRpc('ican_id_dev_list', { dev_token: token, p_status: status }),
  review: (token, { checkId, approve, note = null, replaceVerified = false }) => devRpc('ican_id_dev_review', {
    dev_token: token, p_check_id: checkId, p_approve: !!approve, p_note: note, p_replace_verified: !!replaceVerified
  })
};

export const nationalIdService = {
  getNationalIdRule, getNationalIdStatus, saveNationalId, ensureNationalId,
  submitIdProof, requestIdVerification, claimNationalId, getIdTrust, devNationalId
};
export default nationalIdService;
