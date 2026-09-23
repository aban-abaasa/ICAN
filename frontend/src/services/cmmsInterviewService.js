/**
 * CMMS Live Video Interview Scheduling
 *
 * Reuses the app's existing full-mesh WebRTC "boardroom" (LiveBoardroom.jsx)
 * for the actual call -- this service only manages who/when (the schedule
 * row) and the single join-permission check (fn_can_join_interview, see
 * backend/CMMS_INTERVIEW_SCHEDULES.sql).
 */

import { supabase } from '../lib/supabase/client';
import { getPublicAppUrl } from '../utils/publicAppUrl';

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

  // Each named interviewer gets their own notification with a direct join
  // link (fn_notify_interview_scheduled, CMMS_INTERVIEW_NOTIFICATIONS.sql)
  // -- best-effort, never blocks scheduling itself if it fails.
  Promise.resolve(supabase.rpc('fn_notify_interview_scheduled', { p_schedule_id: data.id })).catch(() => {});

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

/** Same schedule table, keyed by opportunity_bid_id instead of
 * job_application_id (see backend/CMMS_OPPORTUNITY_BID_PIPELINE.sql) --
 * only ever used for an individual bidder, who already has a known
 * bidder_ican_user_id at bid time. */
export const scheduleInterviewForBid = async (companyId, bid, fields, createdByCmmsUserId) => {
  const { data, error } = await supabase
    .from('cmms_interview_schedules')
    .insert({
      opportunity_bid_id: bid.id,
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
    .from('cmms_business_opportunity_bids')
    .update({ status: 'interview', status_note: 'Live interview scheduled', status_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', bid.id);

  Promise.resolve(supabase.rpc('fn_notify_interview_scheduled', { p_schedule_id: data.id })).catch(() => {});

  return { success: true, data };
};

export const getInterviewsForBid = async (bidId) => {
  const { data, error } = await supabase
    .from('cmms_interview_schedules')
    .select('*')
    .eq('opportunity_bid_id', bidId)
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

/** The interview-stage equivalent of grading a written test -- an
 * interviewer marks whether they were satisfied with the candidate (kept in
 * cmms_interview_feedback, a separate staff-only table -- see
 * CMMS_INTERVIEW_FEEDBACK.sql for why this never lives as columns on the
 * candidate-readable schedule row). Upserts so re-opening "Mark outcome"
 * after the fact edits the same record instead of creating a second one,
 * and -- since marking an outcome only makes sense once the call actually
 * happened -- also flips a still-'scheduled' row to 'completed', the same
 * "the action IS the status change" shortcut written-test assignment/
 * grading already uses. Mirrors the outcome onto the application's
 * status_note so it reads at a glance in the Applications list, same as a
 * written test's score. */
export const markInterviewOutcome = async (schedule, applicationId, { outcome, feedback }, markedByCmmsUserId) => {
  const { data, error } = await supabase
    .from('cmms_interview_feedback')
    .upsert({
      interview_schedule_id: schedule.id,
      cmms_company_id: schedule.cmms_company_id,
      outcome,
      feedback: feedback?.trim() || null,
      marked_by: markedByCmmsUserId || null,
      marked_at: new Date().toISOString(),
    }, { onConflict: 'interview_schedule_id' })
    .select()
    .single();
  if (error) return { success: false, error: error.message };

  if (schedule.status === 'scheduled') {
    await supabase.from('cmms_interview_schedules').update({ status: 'completed' }).eq('id', schedule.id);
  }

  if (applicationId) {
    await supabase
      .from('cmms_job_applications')
      .update({
        status_note: outcome === 'satisfied' ? 'Interview outcome: Satisfied ✓' : 'Interview outcome: Not satisfied',
        updated_at: new Date().toISOString(),
      })
      .eq('id', applicationId);
  }

  return { success: true, data };
};

/** Every recorded outcome for a set of schedules at once (one query, not
 * one per interview row) -- keyed lookups happen client-side via
 * interview_schedule_id. */
export const getFeedbackForInterviews = async (scheduleIds) => {
  if (!scheduleIds?.length) return { success: true, data: [] };
  const { data, error } = await supabase
    .from('cmms_interview_feedback')
    .select('*')
    .in('interview_schedule_id', scheduleIds);
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

// Always the real production domain (icanera.space), not
// window.location.origin -- an admin scheduling from a dev/staging build
// would otherwise hand the candidate/interviewer a link nobody but them
// can open, and video calls (Supabase Realtime signaling) must always run
// on the canonical domain.
export const buildCandidateInterviewLink = (scheduleId) => getPublicAppUrl(`/candidate-interview?scheduleId=${scheduleId}`);

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
  scheduleInterviewForBid,
  getInterviewsForBid,
  cancelInterview,
  markInterviewOutcome,
  getFeedbackForInterviews,
  buildCandidateInterviewLink,
  canJoinInterview,
  getInterviewPrefillContact,
  linkIcanAccountViaInterviewSchedule,
};
