// Franchise program: Supabase access for the landing page, the partner console and the developer panel.
//
// Everything goes through the RPCs and read-only tables from
// supabase/migrations/20261004100000_franchise_layer.sql. The browser can never write the franchise
// tables directly; every change is a function that checks who is asking.
//
// Administration needs a REAL signed-in account (a developer, or one on the franchise admin
// allowlist). The developer panel's own login is a token in the public JavaScript and is never
// accepted here: no function in this file sends it.

import { getSupabaseClient } from '../lib/supabase/client';
import { friendlyError, isBackendMissing } from '../utils/franchise';

export class FranchiseBackendMissingError extends Error {
  constructor() {
    super('Franchises are not switched on for this server yet. An administrator needs to apply the franchise migration.');
    this.name = 'FranchiseBackendMissingError';
  }
}
export const isFranchiseBackendMissing = (e) => e instanceof FranchiseBackendMissingError;

const client = () => {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('The app is not connected to its database. Check your connection and try again.');
  return sb;
};

const unwrap = ({ data, error }) => {
  if (error) {
    if (isBackendMissing(error)) throw new FranchiseBackendMissingError();
    throw new Error(friendlyError(error));
  }
  return data;
};

const rpc = async (fn, args = {}) => unwrap(await client().rpc(fn, args));

// ------------------------------------------------------------------ public (no account needed)

/** Open countries and the headline share, for the landing page. Never throws: the page just hides the numbers. */
export async function getPublicOverview() {
  try {
    return await rpc('ican_franchise_public_overview');
  } catch (e) {
    if (isFranchiseBackendMissing(e)) return null;
    return null;
  }
}

/** The landing page request form. `website` is the honeypot: it must stay empty for real people. */
export async function submitEnquiry(form) {
  return rpc('ican_franchise_submit_enquiry', {
    p_full_name: form.full_name,
    p_email: form.email,
    p_country: form.country,
    p_company_name: form.company_name,
    p_company_reg_number: form.company_reg_number,
    p_company_reg_country: form.company_reg_country || null,
    p_partner_type: form.partner_type,
    p_products: form.products,
    p_phone: form.phone || null,
    p_clients_estimate: form.clients_estimate === '' || form.clients_estimate == null ? null : Number(form.clients_estimate),
    p_message: form.message || null,
    p_website: form.website || null,
  });
}

// ------------------------------------------------------------------ signed-in partner

export async function currentUserId() {
  const { data, error } = await client().auth.getUser();
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

export const listTerritories = async () =>
  unwrap(await client().from('ican_franchise_territories').select('*').neq('status', 'paused').order('tier').order('country_name')) || [];

/** Every territory, paused ones included (HQ administration). */
export const adminListAllTerritories = async () =>
  unwrap(await client().from('ican_franchise_territories').select('*').order('tier').order('country_name')) || [];

/** The rate card partners may see (HQ / master / agency percentages). */
export const listRules = async () =>
  unwrap(await client().from('ican_franchise_split_rules').select('*').order('stream').order('structure').order('agency_tier')) || [];

export const applyForSeat = (form) =>
  rpc('ican_franchise_apply', {
    p_partner_type: form.partner_type,
    p_country: form.country,
    p_company_name: form.company_name,
    p_company_reg_number: form.company_reg_number,
    p_company_reg_country: form.company_reg_country || form.country,
    p_company_document_url: form.company_document_url || null,
    p_trading_name: form.trading_name || null,
    p_region: form.region || null,
    p_products: form.products,
    p_business_profile_id: form.business_profile_id || null,
    p_notes: form.notes || null,
  });

export const getMySummary = async () => (await rpc('ican_franchise_my_summary')) || [];
export const getMyEarnings = async (partnerId, months = 12) =>
  (await rpc('ican_franchise_my_earnings', { p_partner_id: partnerId, p_months: months })) || [];
export const getMyCustomers = async (partnerId, limit = 200) =>
  (await rpc('ican_franchise_my_customers', { p_partner_id: partnerId, p_limit: limit })) || [];
export const listMyStatements = async (partnerId) =>
  unwrap(await client().from('ican_franchise_statements').select('*').eq('partner_id', partnerId).neq('status', 'void').order('created_at', { ascending: false })) || [];

// Customer side: pick or leave an agency for one of my businesses.
export const listMyBusinesses = async () => {
  const uid = await currentUserId();
  if (!uid) return [];
  return unwrap(await client().from('business_profiles').select('id, business_name, country').eq('user_id', uid).order('created_at')) || [];
};
export const getMyAgency = (businessId) => rpc('ican_franchise_my_agency', { p_business_profile_id: businessId });
export const claimAgency = (code, businessId) => rpc('ican_franchise_claim_agency', { p_code: code, p_business_profile_id: businessId });
export const releaseAgency = (businessId) => rpc('ican_franchise_release_agency', { p_business_profile_id: businessId });

// ------------------------------------------------------------------ HQ administration

/** True when the current session is a real HQ admin. Anonymous or ordinary users get false, never an error. */
export async function isHqAdmin() {
  try {
    const { data, error } = await client().rpc('ican_franchise_is_hq_admin');
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/** Sign in with a real account for franchise administration. */
export async function signInAsAdmin(email, password) {
  const { error } = await client().auth.signInWithPassword({ email: String(email || '').trim(), password });
  if (error) throw new Error(/invalid login/i.test(error.message || '') ? 'That email or password is not right.' : friendlyError(error));
  return true;
}

export const adminOverview = () => rpc('ican_franchise_admin_overview');
export const adminListPartners = async ({ status = null, type = null, country = null } = {}) =>
  (await rpc('ican_franchise_admin_list_partners', { p_status: status, p_type: type, p_country: country })) || [];
export const adminSavePartner = (partnerId, patch) => rpc('ican_franchise_admin_save_partner', { p_partner_id: partnerId, p_patch: patch });
export const adminSetStatus = (partnerId, status, note = null) => rpc('ican_franchise_admin_set_status', { p_partner_id: partnerId, p_status: status, p_note: note });
export const adminTerminate = (partnerId, reassignTo = null, reason = null) =>
  rpc('ican_franchise_admin_terminate_partner', { p_partner_id: partnerId, p_reassign_to: reassignTo, p_reason: reason });
/** Send (or re-send) a partner's franchise code to their Support chat, with an optional note from HQ. */
export const adminSendCode = (partnerId, note = null) =>
  rpc('ican_franchise_admin_send_code', { p_partner_id: partnerId, p_note: note || null });
/** Support writes to a partner: lands in their Support chat thread, with a notification. */
export const adminMessagePartner = (partnerId, body) =>
  rpc('ican_franchise_admin_message_partner', { p_partner_id: partnerId, p_body: body });
/** Send the code to every approved/active partner that has not received one yet. */
export const adminSendPendingCodes = () => rpc('ican_franchise_admin_send_pending_codes');
export const adminAssignCustomer = (businessId, partnerId = null) =>
  rpc('ican_franchise_admin_assign_customer', { p_business_profile_id: businessId, p_partner_id: partnerId });
export const adminSaveTerritory = ({ country, name = null, tier = null, status = null, currency = null, notes = null }) =>
  rpc('ican_franchise_admin_save_territory', { p_country: country, p_name: name, p_tier: tier, p_status: status, p_currency: currency, p_notes: notes });
export const adminSaveRule = ({ stream, structure, agency_tier = 'any', hq_pct, master_pct, agency_pct, active = true, note = null }) =>
  rpc('ican_franchise_admin_save_rule', {
    p_stream: stream, p_structure: structure, p_agency_tier: agency_tier,
    p_hq_pct: hq_pct, p_master_pct: master_pct, p_agency_pct: agency_pct, p_active: active, p_note: note,
  });
export const adminSaveSettings = (patch) => rpc('ican_franchise_admin_save_settings', { p_patch: patch });
export const adminRefreshTiers = () => rpc('ican_franchise_refresh_tiers');

export const adminGenerateStatements = (start, end) => rpc('ican_franchise_admin_generate_statements', { p_start: start, p_end: end });
export const adminApproveStatement = (id) => rpc('ican_franchise_admin_approve_statement', { p_statement_id: id });
export const adminMarkStatementPaid = (id, reference) => rpc('ican_franchise_admin_mark_statement_paid', { p_statement_id: id, p_reference: reference });
export const adminVoidStatement = (id) => rpc('ican_franchise_admin_void_statement', { p_statement_id: id });
export const adminListStatements = async (status = null, limit = 100) =>
  (await rpc('ican_franchise_admin_list_statements', { p_status: status, p_limit: limit })) || [];

export const adminVoidEvent = (eventId, reason) => rpc('ican_franchise_admin_void_event', { p_event_id: eventId, p_reason: reason });
export const adminRetryErrors = () => rpc('ican_franchise_admin_retry_errors');
export const adminBackfill = (since = null) => rpc('ican_franchise_admin_backfill', { p_since: since });

export const adminListEnquiries = async (status = null, limit = 200) =>
  (await rpc('ican_franchise_admin_list_enquiries', { p_status: status, p_limit: limit })) || [];
export const adminSetEnquiryStatus = (id, status, note = null) => rpc('ican_franchise_admin_set_enquiry_status', { p_id: id, p_status: status, p_note: note });
export const adminConvertEnquiry = (id) => rpc('ican_franchise_admin_convert_enquiry', { p_id: id });

export const adminListAdmins = async () => (await rpc('ican_franchise_admin_list_admins')) || [];
export const adminGrantAdmin = (email, note = null) => rpc('ican_franchise_admin_grant_admin', { p_email: email, p_note: note });
export const adminRevokeAdmin = (userId) => rpc('ican_franchise_admin_revoke_admin', { p_user_id: userId });
