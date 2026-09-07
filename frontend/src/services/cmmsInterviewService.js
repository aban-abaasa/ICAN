/**
 * CMMS Live Video Interview Scheduling
 *
 * Reuses the app's existing full-mesh WebRTC "boardroom" (LiveBoardroom.jsx)
 * for the actual call -- this service only manages who/when (the schedule
 * row) and the single join-permission check (fn_can_join_interview, see
 * backend/CMMS_INTERVIEW_SCHEDULES.sql).
 */

import { supabase } from '../lib/supabase/client';

export const scheduleInterview = async (companyId, application, fields, createdByCmmsUserId) => {
  const { data, error } = await supabase
    .from('cmms_interview_schedules')
    .insert({
      job_application_id: application.id,
      cmms_company_id: companyId,
      scheduled_at: fields.scheduledAt,
      duration_minutes: Number(fields.durationMinutes) || 30,
      interviewer_cmms_user_ids: fields.interviewerIds || [],
      notes: fields.notes?.trim() || null,
      created_by: createdByCmmsUserId || null,
    })
    .select()
    .single();
  if (error) return { success: false, error: error.message };

  await supabase
    .from('cmms_job_applications')
    .update({ status: 'interview', status_note: 'Live interview scheduled', status_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', application.id);

  return { success: true, data };
};

export const getInterviewsForApplication = async (applicationId) => {
  const { data, error } = await supabase
    .from('cmms_interview_schedules')
    .select('*')
    .eq('job_application_id', applicationId)
    .order('scheduled_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export const cancelInterview = async (scheduleId) => {
  const { error } = await supabase
    .from('cmms_interview_schedules')
    .update({ status: 'cancelled' })
    .eq('id', scheduleId);
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const buildCandidateInterviewLink = (scheduleId) => `${window.location.origin}/candidate-interview?scheduleId=${scheduleId}`;

/** The single join-permission check both the admin's and candidate's
 * boardroom entry points call before mounting LiveBoardroom. */
export const canJoinInterview = async (scheduleId) => {
  const { data, error } = await supabase.rpc('fn_can_join_interview', { p_schedule_id: scheduleId });
  if (error) return { success: false, error: error.message, data: null };
  return { success: true, data: data?.[0] || null };
};

/** Callable before the candidate is signed in at all -- pre-fills the ICAN
 * signup form from the application's name/email/phone. */
export const getInterviewPrefillContact = async (scheduleId) => {
  const { data, error } = await supabase.rpc('fn_get_interview_prefill_contact', { p_schedule_id: scheduleId });
  if (error || !data?.length) return { success: false, error: error?.message, data: null };
  return { success: true, data: data[0] };
};

/** Called right after the candidate signs up/signs in via the interview
 * link -- links their new ICAN account to the application. */
export const linkIcanAccountViaInterviewSchedule = async (scheduleId) => {
  const { data, error } = await supabase.rpc('fn_link_ican_account_via_interview_schedule', { p_schedule_id: scheduleId });
  if (error) return { success: false, error: error.message };
  return { success: true, linked: Boolean(data) };
};

export default {
  scheduleInterview,
  getInterviewsForApplication,
  cancelInterview,
  buildCandidateInterviewLink,
  canJoinInterview,
  getInterviewPrefillContact,
  linkIcanAccountViaInterviewSchedule,
};
