/**
 * CMMS Business Opportunities & Bids -- a company posts an open
 * opportunity; individuals (from their own resume/portfolio page) and
 * other CMMS companies (bidding as a business) submit private bids on it.
 *
 * Everyone here already has an ICAN account, so unlike
 * cmmsServiceProviderContractsService.js there is no opaque-token/anon-RPC
 * layer -- this is a plain authenticated table + RLS feature (see
 * backend/CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql). Only picking a winner
 * goes through an RPC, since it must atomically update the winning bid,
 * reject the rest, and close the opportunity.
 */

import { supabase } from '../lib/supabase/client';

// ============================================================
// Posting company (staff, gated by the 'opportunities' tool's
// 'manage'/'view' actions -- see CMMSRoleConfiguration.jsx)
// ============================================================

export const createOpportunity = async (companyId, fields, createdByCmmsUserId) => {
  const { data, error } = await supabase
    .from('cmms_business_opportunities')
    .insert({
      cmms_company_id: companyId,
      title: fields.title?.trim(),
      description: fields.description || null,
      budget_hint: fields.budgetHint || null,
      deadline: fields.deadline || null,
      created_by: createdByCmmsUserId || null,
    })
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const updateOpportunity = async (opportunityId, fields) => {
  const { data, error } = await supabase
    .from('cmms_business_opportunities')
    .update({
      title: fields.title?.trim(),
      description: fields.description || null,
      budget_hint: fields.budgetHint || null,
      deadline: fields.deadline || null,
    })
    .eq('id', opportunityId)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const setOpportunityStatus = async (opportunityId, status) => {
  const { error } = await supabase.from('cmms_business_opportunities').update({ status }).eq('id', opportunityId);
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const getOpportunitiesForCompany = async (companyId) => {
  const { data, error } = await supabase
    .from('cmms_business_opportunities')
    .select('*')
    .eq('cmms_company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export const getBidsForOpportunity = async (opportunityId) => {
  const { data, error } = await supabase
    .from('cmms_business_opportunity_bids')
    .select('*')
    .eq('opportunity_id', opportunityId)
    .order('created_at', { ascending: true });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export const selectWinningBid = async (bidId) => {
  const { error } = await supabase.rpc('fn_select_opportunity_bid', { p_bid_id: bidId });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

// ============================================================
// Browsing (any signed-in ICAN user) -- the "available businesses" list
// ============================================================

export const getOpenOpportunities = async () => {
  const { data, error } = await supabase
    .from('cmms_business_opportunities')
    .select('*, cmms_company_profiles(company_name)')
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

/** Companies the current user is an active member of -- the "which
 * business [are you bidding as]?" picker. */
export const getMyCompanies = async (userEmail) => {
  if (!userEmail) return { success: true, data: [] };
  const { data, error } = await supabase
    .from('cmms_users')
    .select('cmms_company_id, role, cmms_company_profiles(company_name)')
    .ilike('email', userEmail)
    .eq('is_active', true);
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

// ============================================================
// Bidding
// ============================================================

export const submitBidAsIndividual = async (opportunityId, icanUserId, fields) => {
  const { data, error } = await supabase
    .from('cmms_business_opportunity_bids')
    .insert({
      opportunity_id: opportunityId,
      bidder_type: 'individual',
      bidder_ican_user_id: icanUserId,
      bidder_name: fields.bidderName?.trim(),
      bidder_contact: fields.bidderContact || null,
      amount: fields.amount || null,
      proposal: fields.proposal?.trim(),
    })
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const submitBidAsBusiness = async (opportunityId, bidderCompanyId, fields) => {
  const { data, error } = await supabase
    .from('cmms_business_opportunity_bids')
    .insert({
      opportunity_id: opportunityId,
      bidder_type: 'business',
      bidder_cmms_company_id: bidderCompanyId,
      bidder_name: fields.bidderName?.trim(),
      bidder_contact: fields.bidderContact || null,
      amount: fields.amount || null,
      proposal: fields.proposal?.trim(),
    })
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const withdrawBid = async (bidId) => {
  const { error } = await supabase.from('cmms_business_opportunity_bids').update({ status: 'withdrawn' }).eq('id', bidId);
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const getMyIndividualBids = async (icanUserId) => {
  const { data, error } = await supabase
    .from('cmms_business_opportunity_bids')
    .select('*, cmms_business_opportunities(title, status, cmms_company_profiles(company_name))')
    .eq('bidder_ican_user_id', icanUserId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export const getMyCompanyBids = async (companyId) => {
  const { data, error } = await supabase
    .from('cmms_business_opportunity_bids')
    .select('*, cmms_business_opportunities(title, status, cmms_company_profiles(company_name))')
    .eq('bidder_cmms_company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export default {
  createOpportunity,
  updateOpportunity,
  setOpportunityStatus,
  getOpportunitiesForCompany,
  getBidsForOpportunity,
  selectWinningBid,
  getOpenOpportunities,
  getMyCompanies,
  submitBidAsIndividual,
  submitBidAsBusiness,
  withdrawBid,
  getMyIndividualBids,
  getMyCompanyBids,
};
