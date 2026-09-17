// Employee welfare — leave, sick leave & probation tracking, plus general HR
// requests (grievances, wellness/counseling, flexible work, training
// sponsorship, medical/bereavement assistance). See
// backend/CMMS_EMPLOYEE_WELFARE_SYSTEM.sql for the schema and RLS this talks to.
//
// "My ..." reads go through a dedicated self-scoped RPC rather than a plain
// table select, same reasoning as getMySalaryAdvances in
// businessManagementService.js: an HR approver's broader RLS grant on these
// tables must never leak into what "my own records" returns for themselves.
import { getSupabase } from './pitchingService';

const db = () => getSupabase();

// ── Leave types & balances ──────────────────────────────────────────────
export const getLeaveTypes = async (cmmsCompanyId) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  await sb.rpc('cmms_ensure_default_leave_types', { p_company_id: cmmsCompanyId });
  const { data, error } = await sb.from('cmms_leave_types')
    .select('*').eq('cmms_company_id', cmmsCompanyId).eq('is_active', true).order('name');
  return { data: data || [], error };
};

export const getMyLeaveBalances = async (cmmsCompanyId, year = null) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  const { data, error } = await sb.rpc('get_my_leave_balances', { p_cmms_company_id: cmmsCompanyId, p_year: year });
  return { data: data || [], error };
};

// ── Leave requests ──────────────────────────────────────────────────────
export const requestLeave = async (cmmsCompanyId, { leaveTypeId, startDate, endDate, reason = null, documentUrl = null }) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { data, error } = await sb.rpc('request_leave', {
    p_cmms_company_id: cmmsCompanyId, p_leave_type_id: leaveTypeId,
    p_start_date: startDate, p_end_date: endDate, p_reason: reason, p_supporting_document_url: documentUrl
  });
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const getMyLeaveRequests = async (cmmsCompanyId) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  const { data, error } = await sb.rpc('get_my_leave_requests', { p_cmms_company_id: cmmsCompanyId });
  return { data: data || [], error };
};

export const getCompanyLeaveRequests = async (cmmsCompanyId, status = null) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  let query = sb.from('cmms_leave_requests').select('*, cmms_leave_types(name,code), cmms_users(full_name,email,department,job_title)')
    .eq('cmms_company_id', cmmsCompanyId).order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  return { data: data || [], error };
};

export const decideLeaveRequest = async (requestId, decision, note = null) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { error } = await sb.rpc('decide_leave_request', { p_request_id: requestId, p_decision: decision, p_note: note });
  return error ? { success: false, error: error.message } : { success: true };
};

export const cancelLeaveRequest = async (requestId) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { error } = await sb.rpc('cancel_leave_request', { p_request_id: requestId });
  return error ? { success: false, error: error.message } : { success: true };
};

// ── Probation ────────────────────────────────────────────────────────────
// durationUnit is 'days' or 'months' -- e.g. a short 14-day trial vs. a
// standard 3-month probation. See start_employee_probation in
// backend/CMMS_EMPLOYEE_WELFARE_SYSTEM.sql.
export const startEmployeeProbation = async (cmmsCompanyId, cmmsUserId, { startDate = null, durationValue = 3, durationUnit = 'months' } = {}) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { data, error } = await sb.rpc('start_employee_probation', {
    p_cmms_company_id: cmmsCompanyId, p_cmms_user_id: cmmsUserId,
    p_start_date: startDate || new Date().toISOString().slice(0, 10),
    p_duration_value: durationValue, p_duration_unit: durationUnit
  });
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const getMyProbationStatus = async (cmmsCompanyId) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: null, error: null };
  const { data, error } = await sb.rpc('get_my_probation_status', { p_cmms_company_id: cmmsCompanyId });
  return { data: data?.[0] || null, error };
};

export const getCompanyProbationRecords = async (cmmsCompanyId, status = null) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  let query = sb.from('cmms_probation_records').select('*, cmms_users(full_name,email,department,job_title)')
    .eq('cmms_company_id', cmmsCompanyId).order('probation_end_date', { ascending: true });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  return { data: data || [], error };
};

export const getProbationReviews = async (probationId) => {
  const sb = db();
  if (!sb || !probationId) return { data: [], error: null };
  const { data, error } = await sb.from('cmms_probation_reviews').select('*')
    .eq('probation_id', probationId).order('review_date', { ascending: false });
  return { data: data || [], error };
};

export const submitProbationReview = async (probationId, { rating = null, strengths = null, areasForImprovement = null, recommendation = null, comments = null }) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { data, error } = await sb.rpc('submit_probation_review', {
    p_probation_id: probationId, p_rating: rating, p_strengths: strengths,
    p_areas_for_improvement: areasForImprovement, p_recommendation: recommendation, p_comments: comments
  });
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const decideProbation = async (probationId, decision, note = null, newEndDate = null) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { error } = await sb.rpc('decide_probation', {
    p_probation_id: probationId, p_decision: decision, p_note: note, p_new_end_date: newEndDate
  });
  return error ? { success: false, error: error.message } : { success: true };
};

// ── General welfare requests ────────────────────────────────────────────
export const WELFARE_CATEGORIES = [
  { id: 'grievance', label: 'Grievance / complaint' },
  { id: 'wellness_counseling', label: 'Wellness & counseling support' },
  { id: 'flexible_work', label: 'Flexible work / work-from-home' },
  { id: 'training_sponsorship', label: 'Training & development sponsorship' },
  { id: 'medical_assistance', label: 'Medical assistance' },
  { id: 'bereavement_support', label: 'Bereavement support' },
  { id: 'other', label: 'Other' }
];

export const submitWelfareRequest = async (cmmsCompanyId, { category, subject, description, isConfidential = false }) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { data, error } = await sb.rpc('submit_welfare_request', {
    p_cmms_company_id: cmmsCompanyId, p_category: category, p_subject: subject,
    p_description: description, p_is_confidential: isConfidential
  });
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const getMyWelfareRequests = async (cmmsCompanyId) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  const { data, error } = await sb.rpc('get_my_welfare_requests', { p_cmms_company_id: cmmsCompanyId });
  return { data: data || [], error };
};

export const getCompanyWelfareRequests = async (cmmsCompanyId, status = null) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  let query = sb.from('cmms_welfare_requests').select('*, cmms_users(full_name,email,department,job_title)')
    .eq('cmms_company_id', cmmsCompanyId).order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  return { data: data || [], error };
};

export const respondToWelfareRequest = async (requestId, status, response = null) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { error } = await sb.rpc('respond_to_welfare_request', { p_request_id: requestId, p_status: status, p_response: response });
  return error ? { success: false, error: error.message } : { success: true };
};

export const cancelWelfareRequest = async (requestId) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { error } = await sb.rpc('cancel_welfare_request', { p_request_id: requestId });
  return error ? { success: false, error: error.message } : { success: true };
};

// ── HR dashboard ─────────────────────────────────────────────────────────
export const getWelfareSummary = async (cmmsCompanyId) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: null, error: null };
  const { data, error } = await sb.rpc('get_company_welfare_summary', { p_cmms_company_id: cmmsCompanyId });
  return { data: data?.[0] || null, error };
};
