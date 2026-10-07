// IcanEra Cover (insurance): every call the apps make to the insurance backend.
// Backend: backend/ADD_INSURANCE_PLATFORM.sql. Everything goes through SECURITY DEFINER
// functions; the browser never touches the insurance tables directly.

import { getSupabaseClient } from '../lib/supabase/client';
import { looksNotSetUp } from '../utils/insuranceCatalog';

export class InsuranceNotInstalledError extends Error {
  constructor() {
    super('Insurance is not switched on for this server yet. An administrator needs to run the insurance migration.');
    this.name = 'InsuranceNotInstalledError';
  }
}
export const isNotInstalled = (e) => e instanceof InsuranceNotInstalledError;

const client = () => {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('The app is not connected to its database. Check your connection and try again.');
  return sb;
};

/** A read: returns the data, or throws a plain-English error. */
async function read(fn, args = {}) {
  const { data, error } = await client().rpc(fn, args);
  if (error) {
    if (looksNotSetUp(error.message)) throw new InsuranceNotInstalledError();
    throw new Error(error.message || 'Something went wrong. Please try again.');
  }
  return data;
}

/** A change: always resolves { success, error?, ...result } so screens can show the reason. */
async function act(fn, args, fallback) {
  try {
    const { data, error } = await client().rpc(fn, args);
    if (error) return { success: false, error: looksNotSetUp(error.message) ? new InsuranceNotInstalledError().message : error.message };
    if (!data || typeof data !== 'object') return { success: false, error: 'Unexpected response' };
    return data.success ? data : { ...data, success: false, error: data.error || fallback };
  } catch (e) {
    return { success: false, error: e?.message || fallback };
  }
}

export const insuranceService = {
  // ── customers ──────────────────────────────────────────────────────────
  listPlans: ({ audience = null, coverType = null, vehicleType = null } = {}) =>
    read('ins_list_plans', { p_audience: audience, p_cover_type: coverType, p_vehicle_type: vehicleType }),
  quote: (planId, members = 1, shareScopes = []) =>
    read('ins_quote', { p_plan_id: planId, p_members: members, p_share_scopes: shareScopes }),
  subscribePersonal: ({ planId, riderId = null, usePoints = false, pointsOnly = false, shareScopes = [], autoRenew = false, renewWith = 'wallet' }) =>
    act('ins_subscribe_personal', {
      p_plan_id: planId, p_rider_id: riderId, p_use_points: usePoints, p_points_only: pointsOnly,
      p_share_scopes: shareScopes, p_auto_renew: autoRenew, p_renew_with: renewWith,
    }, 'Could not buy this cover'),
  subscribeBusiness: ({ planId, businessId, kind, riderIds = null, pin }) =>
    act('ins_subscribe_business', {
      p_plan_id: planId, p_business_id: businessId, p_insured_kind: kind, p_rider_ids: kind === 'rider' ? riderIds : null, p_pin: pin,
    }, 'Could not buy this cover'),
  myPolicies: () => read('ins_my_policies'),
  businessPolicies: (businessId) => read('ins_business_policies', { p_business_id: businessId }),
  coverStatus: (businessId = null) => read('ins_my_cover_status', { p_business_id: businessId }),
  // A company's drivers and their cover (BodaGoEra's roster). Empty, never an error, where that app is not installed.
  driverCoverSafe: async (businessId) => {
    try {
      const { data, error } = await client().rpc('mbg_business_driver_cover', { p_business_profile_id: businessId });
      return error ? [] : (data || []);
    } catch {
      return [];
    }
  },
  payments: (policyId) => read('ins_policy_payments', { p_policy_id: policyId }),
  renew: (policyId, { usePoints = false, pointsOnly = false, pin = null } = {}) =>
    act('ins_renew_policy', { p_policy_id: policyId, p_use_points: usePoints, p_points_only: pointsOnly, p_pin: pin }, 'Could not renew'),
  setAutoRenew: (policyId, autoRenew, renewWith) =>
    act('ins_set_auto_renew', { p_policy_id: policyId, p_auto_renew: autoRenew, p_renew_with: renewWith }, 'Could not change renewal'),
  stopRenewing: (policyId, reason = null) =>
    act('ins_cancel_policy', { p_policy_id: policyId, p_reason: reason }, 'Could not stop renewal'),
  setConsent: (policyId, scopes) =>
    act('ins_set_data_consent', { p_policy_id: policyId, p_scopes: scopes }, 'Could not save what you share'),
  setBusinessConsent: (policyId, scopes) =>
    act('ins_set_business_data_consent', { p_policy_id: policyId, p_scopes: scopes }, 'Could not save what the business shares'),
  accessLog: (policyId) => read('ins_policy_access_log', { p_policy_id: policyId }),
  messages: (policyId) => read('ins_list_messages', { p_policy_id: policyId }),
  postMessage: (policyId, body, claimId = null) =>
    act('ins_post_message', { p_policy_id: policyId, p_body: body, p_claim_id: claimId }, 'Could not send'),
  fileClaim: ({ policyId, incidentDate, description, amount = null, evidenceUrls = [] }) =>
    act('ins_file_claim', {
      p_policy_id: policyId, p_incident_date: incidentDate, p_description: description,
      p_amount_claimed_ican: amount, p_ride_id: null, p_evidence_urls: evidenceUrls,
    }, 'Could not file the claim'),
  myClaims: (policyId = null) => read('ins_my_claims', { p_policy_id: policyId }),

  // ── insurers ───────────────────────────────────────────────────────────
  myInsurers: () => read('ins_my_insurers'),
  registerInsurer: ({ businessId, displayName, licenceNumber, licenceExpiry, regulator, countryCode, contactEmail, contactPhone, claimsPhone, description }) =>
    act('ins_register_insurer', {
      p_business_id: businessId, p_display_name: displayName, p_licence_number: licenceNumber, p_licence_expiry: licenceExpiry,
      p_regulator: regulator, p_country_code: countryCode, p_contact_email: contactEmail || null,
      p_contact_phone: contactPhone || null, p_claims_phone: claimsPhone || null, p_description: description || null,
    }, 'Could not register the insurance company'),
  updateInsurer: (insurerId, payload) =>
    act('ins_update_insurer', { p_insurer_id: insurerId, p_payload: payload }, 'Could not save'),
  insurerPlans: (insurerId) => read('ins_insurer_plans', { p_insurer_id: insurerId }),
  savePlan: (insurerId, planId, payload) =>
    act('ins_save_plan', { p_insurer_id: insurerId, p_plan_id: planId, p_payload: payload }, 'Could not save the plan'),
  insurerPolicies: (insurerId, state = null) => read('ins_insurer_policies', { p_insurer_id: insurerId, p_state: state, p_limit: 1000 }),
  insurerClients: (insurerId) => read('ins_insurer_clients', { p_insurer_id: insurerId }),
  insurerStats: (insurerId) => read('ins_insurer_stats', { p_insurer_id: insurerId }),
  insurerClaims: (insurerId, status = null) => read('ins_insurer_claims', { p_insurer_id: insurerId, p_status: status }),
  updateClaim: (claimId, status, note = null, approvedAmount = null) =>
    act('ins_insurer_update_claim', { p_claim_id: claimId, p_status: status, p_note: note, p_approved_amount: approvedAmount }, 'Could not update the claim'),
  payClaim: (claimId, { pin = null, offlineReference = null } = {}) =>
    act('ins_insurer_pay_claim', { p_claim_id: claimId, p_pin: pin, p_offline_reference: offlineReference }, 'Could not pay the claim'),
  policyData: (policyId) => act('ins_insurer_policy_data', { p_policy_id: policyId }, 'Could not open the data room'),

  // ── applying from the landing site (no account needed to apply; one with the same email is needed to be set up) ──
  submitApplication: (f) =>
    act('ins_submit_application', {
      p_contact_name: f.contact_name, p_email: f.email, p_company_name: f.company_name, p_licence_number: f.licence_number,
      p_licence_expiry: f.licence_expiry, p_country_code: f.country_code, p_regulator: f.regulator,
      p_cover_types: f.cover_types, p_phone: f.phone || null, p_description: f.description || null, p_website: f.website || null,
    }, 'Could not send the application'),
  applicationStatus: (reference, email) => read('ins_application_status', { p_reference: reference, p_email: email }),
  myApplications: () => read('ins_my_applications'),

  // ── the ICAN dev panel ─────────────────────────────────────────────────
  devOverview: (devToken) => read('ins_dev_overview', { p_dev_token: devToken }),
  devListInsurers: (status, devToken) => read('ins_dev_list_insurers', { p_status: status || null, p_dev_token: devToken }),
  devReviewInsurer: (insurerId, decision, note, devToken) =>
    act('ins_dev_review_insurer', { p_insurer_id: insurerId, p_decision: decision, p_note: note || null, p_dev_token: devToken }, 'Could not save the decision'),
  devListApplications: (status, devToken) => read('ins_dev_list_applications', { p_status: status || null, p_dev_token: devToken }),
  devReviewApplication: (applicationId, decision, note, devToken) =>
    act('ins_dev_review_application', { p_application_id: applicationId, p_decision: decision, p_note: note || null, p_dev_token: devToken }, 'Could not save the decision'),
  devUpdateSettings: (patch, devToken) =>
    act('ins_dev_update_settings', { p_patch: patch, p_dev_token: devToken }, 'Could not save the settings'),
};

/**
 * The businesses the signed-in person owns (they can act as one of these), and the personal
 * wallet price helper the screens use to show ICAN in the person's own currency.
 */
export async function listMyBusinesses(userId) {
  const { data, error } = await client().from('business_profiles').select('id, business_name, business_type').eq('user_id', userId).order('created_at');
  if (error) return [];
  return data || [];
}

/** Live ICAN price in the user's own currency, exactly as the wallet shows it. Null if the engine is unreachable. */
export async function getLocalRate(userId) {
  try {
    const { data, error } = await client().rpc('ican_get_user_wallet_display', { p_user_id: userId });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row || !(Number(row.price_local) > 0)) return null;
    return { currency: row.currency_code || 'UGX', priceLocal: Number(row.price_local) };
  } catch {
    return null;
  }
}

export async function getWalletBalances(userId) {
  const { data } = await client().from('ican_user_wallets').select('ican_balance').eq('user_id', userId).maybeSingle();
  return { personal: Number(data?.ican_balance ?? 0) };
}

export async function getBusinessBalance(businessId) {
  const { data } = await client().from('ican_business_wallets').select('ican_balance').eq('business_profile_id', businessId).maybeSingle();
  return data ? Number(data.ican_balance ?? 0) : null;
}

/** Reward points (BodaGoEra loyalty). Zero when that app's tables are not there. */
export async function getRewardPoints(userId) {
  try {
    const { data, error } = await client().rpc('mbg_get_reward_summary', { p_user_id: userId });
    if (error) return 0;
    return Math.floor(Number(data?.points_balance ?? 0));
  } catch {
    return 0;
  }
}

/**
 * Every live or recent cover the person holds, personally and through the businesses they own, without
 * duplicates. This is what the Compliance checklist ticks its insurance items from.
 */
export async function loadAllCovers(userId) {
  const businesses = await listMyBusinesses(userId);
  const lists = await Promise.all([
    insuranceService.coverStatus(null),
    ...businesses.map((b) => insuranceService.coverStatus(b.id).catch(() => [])),
  ]);
  const byId = new Map();
  lists.flat().forEach((c) => byId.set(c.policy_id, c));
  return Array.from(byId.values());
}
