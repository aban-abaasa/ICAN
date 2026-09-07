/**
 * CMMS Service Provider Contracts -- public, GATED, time-limited contract
 * pages for outside contractors (no CMMS/ICAN login) doing a task for the
 * company.
 *
 * Every contract is private by construction: staff choose a PIN or a
 * single allowed email when publishing (see fn_publish_service_provider_
 * contract, backend/CMMS_SERVICE_PROVIDER_CONTRACTS.sql), and the
 * contractor's link only ever unlocks content after that gate is passed
 * -- same "narrow SECURITY DEFINER RPC + tell the caller which gate to
 * show, reveal nothing else pre-auth" pattern as cmmsReportShareService.js.
 * Because the PIN must be hashed server-side, publishing is one RPC call
 * rather than a raw table insert; extend/revoke have no secret involved
 * so those stay plain client-side UPDATEs under RLS (gated by the
 * 'tasks' tool's 'publish_contract' action, see CMMSRoleConfiguration.jsx).
 */

import { supabase } from '../lib/supabase/client';

export const buildServiceProviderContractUrl = (accessToken) =>
  `${window.location.origin}/service-provider-contract?token=${accessToken}`;

// ============================================================
// Staff-facing (authenticated)
// ============================================================

/** fields: { jobAssignmentId, providerName, providerContact, title, content,
 * accessMode: 'pin' | 'email', pin, allowedEmail, validDays, opportunityBidId }
 * opportunityBidId (optional) is the "won bid becomes a task" step -- see
 * backend/CMMS_OPPORTUNITY_BID_PIPELINE.sql: the bid must already be
 * status='selected' and not yet converted, and this call stamps the bid's
 * converted_contract_id in the same transaction. */
export const publishServiceProviderContract = async (companyId, fields) => {
  const { data, error } = await supabase.rpc('fn_publish_service_provider_contract', {
    p_company_id: companyId,
    p_job_assignment_id: fields.jobAssignmentId || null,
    p_provider_name: fields.providerName,
    p_provider_contact: fields.providerContact || null,
    p_title: fields.title,
    p_content: fields.content || {},
    p_access_mode: fields.accessMode,
    p_pin: fields.accessMode === 'pin' ? fields.pin : null,
    p_allowed_email: fields.accessMode === 'email' ? fields.allowedEmail : null,
    p_valid_days: fields.validDays || 30,
    p_opportunity_bid_id: fields.opportunityBidId || null,
  });
  if (error) return { success: false, error: error.message };
  if (!data?.length) return { success: false, error: 'Could not publish contract.' };
  return { success: true, data: data[0] };
};

/** Extends (or shortens) an already-published contract's access window. */
export const extendServiceProviderContractAccess = async (contractId, newValidUntilIso) => {
  const { data, error } = await supabase
    .from('cmms_service_provider_contracts')
    .update({ valid_until: newValidUntilIso })
    .eq('id', contractId)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const revokeServiceProviderContract = async (contractId) => {
  const { error } = await supabase
    .from('cmms_service_provider_contracts')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', contractId);
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const getServiceProviderContractsForCompany = async (companyId) => {
  const { data, error } = await supabase
    .from('cmms_service_provider_contracts')
    .select('id, cmms_company_id, job_assignment_id, provider_name, provider_contact, title, content, status, access_mode, allowed_email, access_token, valid_from, valid_until, published_at, revoked_at, created_at')
    .eq('cmms_company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export const addStaffFollowup = async (contractId, note, authorCmmsUserId) => {
  const { error } = await supabase.from('cmms_service_provider_followups').insert({
    contract_id: contractId,
    author_type: 'staff',
    author_cmms_user_id: authorCmmsUserId || null,
    note: note?.trim(),
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const getFollowupsForContract = async (contractId) => {
  const { data, error } = await supabase
    .from('cmms_service_provider_followups')
    .select('*')
    .eq('contract_id', contractId)
    .order('created_at', { ascending: true });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export const recordServiceProviderPayment = async (contractId, companyId, fields, recordedByCmmsUserId) => {
  const { data, error } = await supabase
    .from('cmms_service_provider_payments')
    .insert({
      contract_id: contractId,
      cmms_company_id: companyId,
      amount: fields.amount,
      currency: fields.currency || 'UGX',
      method: fields.method || null,
      reference: fields.reference || null,
      payment_date: fields.paymentDate || new Date().toISOString().slice(0, 10),
      notes: fields.notes || null,
      recorded_by: recordedByCmmsUserId || null,
    })
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const getPaymentsForContract = async (contractId) => {
  const { data, error } = await supabase
    .from('cmms_service_provider_payments')
    .select('*')
    .eq('contract_id', contractId)
    .order('payment_date', { ascending: true });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

// ============================================================
// Public (no login) -- the contractor's own link
// ============================================================

/** Pre-auth check: tells the page which gate to show ('pin_required' |
 * 'email_required' | 'locked' | 'invalid'). Reveals nothing about the
 * contract itself until the gate is passed. */
export const getServiceProviderContractGateStatus = async (token) => {
  const { data, error } = await supabase.rpc('fn_get_service_provider_contract_public', { p_token: token });
  if (error) return { success: false, error: error.message, data: null };
  if (!data?.length) return { success: false, error: 'Contract not found', data: null };
  return { success: true, data: data[0] };
};

export const verifyServiceProviderContractPin = async (token, pin) => {
  const { data, error } = await supabase.rpc('fn_verify_service_provider_contract_pin', { p_token: token, p_pin: pin });
  if (error) return { success: false, error: error.message, data: null };
  if (!data?.length) return { success: false, error: 'Verification failed', data: null };
  return { success: true, data: data[0] };
};

export const verifyServiceProviderContractEmail = async (token, email) => {
  const { data, error } = await supabase.rpc('fn_verify_service_provider_contract_email', { p_token: token, p_email: email });
  if (error) return { success: false, error: error.message, data: null };
  if (!data?.length) return { success: false, error: 'Verification failed', data: null };
  return { success: true, data: data[0] };
};

/** credential is whatever the contract's access_mode requires (PIN or the
 * allowed email) -- re-checked on every call since the public page holds
 * no session. */
export const addServiceProviderFollowupPublic = async (token, credential, note) => {
  const { error } = await supabase.rpc('fn_add_service_provider_followup', { p_token: token, p_credential: credential, p_note: note });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export default {
  buildServiceProviderContractUrl,
  publishServiceProviderContract,
  extendServiceProviderContractAccess,
  revokeServiceProviderContract,
  getServiceProviderContractsForCompany,
  addStaffFollowup,
  getFollowupsForContract,
  recordServiceProviderPayment,
  getPaymentsForContract,
  getServiceProviderContractGateStatus,
  verifyServiceProviderContractPin,
  verifyServiceProviderContractEmail,
  addServiceProviderFollowupPublic,
};
