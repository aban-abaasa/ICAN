/**
 * CMMS Written Online Tests (admin-built MCQ, auto-scored)
 *
 * Staff side (authenticated, RLS-enforced by cmms_has_tool_action same as
 * the rest of the hiring pipeline) manages tests/questions/assignments via
 * plain table calls. Candidate side (also authenticated -- a candidate must
 * hold a lightweight ICAN account, see cmmsAnnouncementsService's
 * linkIcanAccountToApplication) goes through narrow SECURITY DEFINER RPCs
 * (backend/CMMS_WRITTEN_TESTS.sql) that never expose correct answers.
 */

import { supabase } from '../lib/supabase/client';
import { getPublicAppUrl } from '../utils/publicAppUrl';

const genAccessToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

// ============================================================
// Staff-facing
// ============================================================

export const getTestsForJob = async (jobPostingId) => {
  const { data, error } = await supabase
    .from('cmms_written_tests')
    .select('*, questions:cmms_test_questions(count)')
    .eq('job_posting_id', jobPostingId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

export const createTest = async (companyId, jobPostingId, createdByCmmsUserId, fields) => {
  const { data, error } = await supabase
    .from('cmms_written_tests')
    .insert({
      cmms_company_id: companyId,
      job_posting_id: jobPostingId || null,
      created_by: createdByCmmsUserId || null,
      title: fields.title?.trim(),
      description: fields.description?.trim() || null,
      time_limit_minutes: fields.timeLimitMinutes ? Number(fields.timeLimitMinutes) : null,
      passing_score: fields.passingScore ? Number(fields.passingScore) : null,
      status: fields.status || 'draft',
    })
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const updateTest = async (testId, patch) => {
  const { data, error } = await supabase
    .from('cmms_written_tests')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', testId)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const deleteTest = async (testId) => {
  const { error } = await supabase.from('cmms_written_tests').delete().eq('id', testId);
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const getQuestions = async (testId) => {
  const { data, error } = await supabase
    .from('cmms_test_questions')
    .select('*')
    .eq('test_id', testId)
    .order('order_index', { ascending: true });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

/** Replaces a test's entire question list -- simplest correct behavior for
 * a small admin-built question bank (a handful to a few dozen questions),
 * avoiding a separate add/remove/reorder API. */
export const saveQuestions = async (testId, questions) => {
  const { error: deleteError } = await supabase.from('cmms_test_questions').delete().eq('test_id', testId);
  if (deleteError) return { success: false, error: deleteError.message };
  if (!questions.length) return { success: true };

  const rows = questions.map((q, index) => ({
    test_id: testId,
    question_text: q.questionText.trim(),
    options: q.options.map((o) => ({ id: o.id, text: o.text.trim() })),
    correct_option_id: q.correctOptionId,
    points: Number(q.points) || 1,
    order_index: index,
  }));
  const { error } = await supabase.from('cmms_test_questions').insert(rows);
  if (error) return { success: false, error: error.message };
  return { success: true };
};

/** Assigns a test to one applicant and moves their application into the
 * 'written_test' stage. The access token is what the candidate's emailed
 * link carries (/candidate-test?token=...). */
export const assignTestToApplication = async (testId, application, createdByCmmsUserId) => {
  const accessToken = genAccessToken();
  const { data, error } = await supabase
    .from('cmms_test_assignments')
    .insert({
      test_id: testId,
      job_application_id: application.id,
      cmms_company_id: application.cmms_company_id,
      access_token: accessToken,
      created_by: createdByCmmsUserId || null,
    })
    .select()
    .single();
  if (error) return { success: false, error: error.message };

  await supabase
    .from('cmms_job_applications')
    .update({ status: 'written_test', status_note: 'Written test sent', status_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', application.id);

  return { success: true, data, accessToken };
};

export const getAssignmentsForApplication = async (applicationId) => {
  const { data, error } = await supabase
    .from('cmms_test_assignments')
    .select('*, test:cmms_written_tests(title)')
    .eq('job_application_id', applicationId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: data || [] };
};

// Always the real production domain -- see buildCandidateInterviewLink.
export const buildCandidateTestLink = (accessToken) => getPublicAppUrl(`/candidate-test?token=${accessToken}`);

// ============================================================
// Candidate-facing (authenticated -- SECURITY DEFINER RPCs)
// ============================================================

/** Callable before the candidate is signed in at all -- pre-fills the ICAN
 * signup form from the application's name/email/phone. */
export const getTestPrefillContact = async (accessToken) => {
  const { data, error } = await supabase.rpc('fn_get_test_prefill_contact', { p_access_token: accessToken });
  if (error || !data?.length) return { success: false, error: error?.message, data: null };
  return { success: true, data: data[0] };
};

export const getTestAssignmentByToken = async (accessToken) => {
  const { data, error } = await supabase.rpc('fn_get_test_assignment', { p_access_token: accessToken });
  if (error) return { success: false, error: error.message, data: null };
  if (!data?.length) return { success: false, error: 'Test not found', data: null };
  const [first] = data;
  const questions = data
    .filter((row) => row.question_id)
    .map((row) => ({ id: row.question_id, text: row.question_text, options: row.options, orderIndex: row.order_index }));
  return {
    success: true,
    data: {
      assignmentId: first.assignment_id,
      status: first.status,
      startedAt: first.started_at,
      expiresAt: first.expires_at,
      score: first.score,
      maxScore: first.max_score,
      testTitle: first.test_title,
      testDescription: first.test_description,
      timeLimitMinutes: first.time_limit_minutes,
      companyName: first.company_name,
      questions,
    },
  };
};

/** Called right after the candidate signs up/signs in via the test link --
 * links their new ICAN account to the application, proven by matching the
 * email they just authenticated with. */
export const linkIcanAccountViaTestToken = async (accessToken) => {
  const { data, error } = await supabase.rpc('fn_link_ican_account_via_test_token', { p_access_token: accessToken });
  if (error) return { success: false, error: error.message };
  return { success: true, linked: Boolean(data) };
};

export const startTestAssignment = async (accessToken) => {
  const { data, error } = await supabase.rpc('fn_start_test_assignment', { p_access_token: accessToken });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data?.[0] || null };
};

export const submitTestAssignment = async (accessToken, answers) => {
  const { data, error } = await supabase.rpc('fn_submit_test_assignment', {
    p_access_token: accessToken,
    p_answers: answers,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data?.[0] || null };
};

export default {
  getTestsForJob,
  createTest,
  updateTest,
  deleteTest,
  getQuestions,
  saveQuestions,
  assignTestToApplication,
  getAssignmentsForApplication,
  buildCandidateTestLink,
  getTestPrefillContact,
  linkIcanAccountViaTestToken,
  getTestAssignmentByToken,
  startTestAssignment,
  submitTestAssignment,
};
