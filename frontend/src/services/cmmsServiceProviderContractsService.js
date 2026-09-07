/**
 * CMMS Service Provider Contracts -- public, time-limited contract pages for
 * outside contractors (no CMMS/ICAN login) doing a task for the company.
 *
 * Same "opaque token + narrow SECURITY DEFINER RPC" pattern as
 * cmmsEmploymentDocumentsService.js: staff create/publish/revoke rows via
 * direct table access under RLS (gated by the 'tasks' tool's
 * 'publish_contract' action, see CMMSRoleConfiguration.jsx), the contractor
 * only ever reaches a row through fn_get_service_provider_contract_public /
 * fn_add_service_provider_followup (backend/CMMS_SERVICE_PROVIDER_CONTRACTS.sql).
 */

import { supabase } from '../lib/supabase/client';

const genAccessToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const buildServiceProviderContractUrl = (accessToken) =>
  `${window.location.origin}/service-provider-contract?token=${accessToken}`;

// ============================================================
// Staff-facing (authenticated, RLS-enforced)
// ============================================================

export const createServiceProviderContract = async (companyId, fields) => {
  const accessToken = genAccessToken();
  const { data, error } = await supabase
    .from('cmms_service_provider_contracts')
    .insert({
      cmms_company_id: companyId,
      job_assignment_id: fields.jobAssignmentId || null,
      provider_name: fields.providerName?.trim(),
      provider_contact: fields.providerContact?.trim() || null,
      title: fields.title?.trim(),
      content: fields.content || {},
      status: 'draft',
      access_token: accessToken,
    })
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

/** Publishes a draft contract, opening the public link. Leave validDays
 * null to take the backend's default 30-day window. */
export const publishServiceProviderContract = async (contractId, validDays = null) => {
  const update = { status: 'published' };
  if (validDays) {
    const validFrom = new Date();
    update.valid_from = validFrom.toISOString();
    update.valid_until = new Date(validFrom.getTime() + validDays * 24 * 60 * 60 * 1000).toISOString();
  }
  const { data, error } = await supabase
    .from('cmms_service_provider_contracts')
    .update(update)
    .eq('id', contractId)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
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
    .select('*')
    .eq('cmms_company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export const getServiceProviderContractsForJobAssignment = async (jobAssignmentId) => {
  const { data, error } = await supabase
    .from('cmms_service_provider_contracts')
    .select('*')
    .eq('job_assignment_id', jobAssignmentId)
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

export const getServiceProviderContractPublic = async (token) => {
  const { data, error } = await supabase.rpc('fn_get_service_provider_contract_public', { p_token: token });
  if (error) return { success: false, error: error.message, data: null };
  if (!data?.length) return { success: false, error: 'Contract not found', data: null };
  return { success: true, data: data[0] };
};

export const addServiceProviderFollowupPublic = async (token, note) => {
  const { error } = await supabase.rpc('fn_add_service_provider_followup', { p_token: token, p_note: note });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export default {
  buildServiceProviderContractUrl,
  createServiceProviderContract,
  publishServiceProviderContract,
  extendServiceProviderContractAccess,
  revokeServiceProviderContract,
  getServiceProviderContractsForCompany,
  getServiceProviderContractsForJobAssignment,
  addStaffFollowup,
  getFollowupsForContract,
  recordServiceProviderPayment,
  getPaymentsForContract,
  getServiceProviderContractPublic,
  addServiceProviderFollowupPublic,
};
