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
import { resolveMediaValues } from './r2StorageService';

const MEDIA_FIELDS = ['poster_url', 'document_url'];
const PUBLIC_SITE_ORIGIN = 'https://icanera.space';

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
      poster_url: fields.posterUrl || null,
      poster_path: fields.posterPath || null,
      document_url: fields.documentUrl || null,
      document_path: fields.documentPath || null,
    })
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const updateOpportunity = async (opportunityId, fields) => {
  const patch = {
    title: fields.title?.trim(),
    description: fields.description || null,
    budget_hint: fields.budgetHint || null,
    deadline: fields.deadline || null,
  };
  // Only touch poster/document columns when a new file was uploaded --
  // otherwise the already-resolved live URL sitting in component state would
  // overwrite the stored key with an expiring signed link (same reasoning as
  // CMMSAnnouncementsPanel's saveDraft).
  if (fields.posterUrl !== undefined) { patch.poster_url = fields.posterUrl; patch.poster_path = fields.posterPath || null; }
  if (fields.documentUrl !== undefined) { patch.document_url = fields.documentUrl; patch.document_path = fields.documentPath || null; }
  const { data, error } = await supabase
    .from('cmms_business_opportunities')
    .update(patch)
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

/** Moves a bid through the screening pipeline (submitted/under_review/
 * shortlisted/interview/rejected/withdrawn) -- mirrors
 * cmmsAnnouncementsService.updateApplicationStatus. NOT used for 'selected':
 * that stays exclusively through selectWinningBid (fn_select_opportunity_bid),
 * which atomically rejects every other bid and closes the opportunity --
 * the RLS policy backing this plain update rejects status='selected'. */
export const updateBidStatus = async (bidId, status, note, updatedByCmmsUserId) => {
  const { error } = await supabase
    .from('cmms_business_opportunity_bids')
    .update({
      status,
      status_note: note || null,
      status_updated_at: new Date().toISOString(),
      status_updated_by: updatedByCmmsUserId || null,
    })
    .eq('id', bidId);
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
// Public page -- no ICAN account needed to browse (see
// backend/CMMS_OPPORTUNITY_PUBLIC_PAGE.sql). Rendered from
// PublicCompanyNoticeBoard.jsx's "Opportunities" tab, same
// /notices/<companyId> board jobs/announcements already share. Bidding
// itself is unchanged -- still requires signing in first, then goes through
// submitBidAsIndividual below like anywhere else in the app.
// ============================================================

export const getPublicCompanyOpportunities = async (companyId) => {
  const { data, error } = await supabase.rpc('fn_get_public_cmms_opportunities', { p_company_id: companyId });
  if (error) return { success: false, error: error.message, data: [] };
  const resolved = await resolveMediaValues(data || [], MEDIA_FIELDS);
  return { success: true, data: resolved };
};

export const getPublicOpportunity = async (opportunityId) => {
  const { data, error } = await supabase.rpc('fn_get_public_cmms_opportunity', { p_opportunity_id: opportunityId });
  if (error || !data?.length) return { success: false, error: error?.message, data: null };
  const [resolved] = await resolveMediaValues([data[0]], MEDIA_FIELDS);
  return { success: true, data: resolved };
};

export const buildPublicOpportunityLink = (companyId, opportunityId) =>
  `${PUBLIC_SITE_ORIGIN}/notices/${companyId}${opportunityId ? `?opp=${opportunityId}` : ''}`;

// ============================================================
// Public bidding -- no ICAN account needed (see
// backend/CMMS_OPPORTUNITY_ANONYMOUS_BID.sql). A visitor who happens to
// already be signed in bids as themselves immediately; a signed-out visitor
// gets a reference code to track status later, exactly like a public job
// application.
// ============================================================

export const submitPublicOpportunityBid = async (opportunityId, fields) => {
  const { data, error } = await supabase.rpc('fn_submit_public_opportunity_bid', {
    p_opportunity_id: opportunityId,
    p_bidder_name: fields.bidderName?.trim(),
    p_bidder_email: fields.bidderEmail?.trim(),
    p_bidder_phone: fields.bidderPhone?.trim() || null,
    p_amount: fields.amount || null,
    p_proposal: fields.proposal?.trim(),
  });
  if (error || !data?.length) return { success: false, error: error?.message };
  return { success: true, referenceCode: data[0].reference_code };
};

export const trackPublicOpportunityBid = async (referenceCode, contact) => {
  const { data, error } = await supabase.rpc('fn_track_public_opportunity_bid', {
    p_reference_code: referenceCode,
    p_contact: contact,
  });
  if (error) return { success: false, error: error.message, data: null };
  return { success: true, data: data?.[0] || null };
};

export const linkIcanAccountToOpportunityBid = async (referenceCode, contact) => {
  const { data, error } = await supabase.rpc('fn_link_ican_account_to_opportunity_bid', {
    p_reference_code: referenceCode,
    p_contact: contact,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, linked: Boolean(data) };
};

/** Self-healing "my bids" for a signed-in visitor -- no reference code
 * needed. See ResumeOpportunityBidsPanel.jsx (in-app) and
 * PublicCompanyNoticeBoard.jsx's "Track my bid" tab (public page). */
export const getMyOpportunityBids = async () => {
  const { data, error } = await supabase.rpc('fn_get_my_opportunity_bids');
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
  updateBidStatus,
  getOpenOpportunities,
  getMyCompanies,
  getPublicCompanyOpportunities,
  getPublicOpportunity,
  buildPublicOpportunityLink,
  submitPublicOpportunityBid,
  trackPublicOpportunityBid,
  linkIcanAccountToOpportunityBid,
  getMyOpportunityBids,
  submitBidAsIndividual,
  submitBidAsBusiness,
  withdrawBid,
  getMyIndividualBids,
  getMyCompanyBids,
};
