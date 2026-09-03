/**
 * CMMS Announcements, Job Postings & Public Notice Board
 *
 * Two audiences:
 *  - CMMS staff (authenticated, role-gated by cmms_has_tool_action via RLS)
 *    manage posts and applications through plain table calls, same as
 *    cmms_roles/cmms_notifications elsewhere in the app.
 *  - Anonymous visitors (no ICAN account) read published public posts and
 *    apply to jobs through narrow SECURITY DEFINER RPCs
 *    (backend/CMMS_ANNOUNCEMENTS_AND_JOBS.sql).
 */

import { supabase } from '../lib/supabase/client';
import { resolveMediaValues, resolveMediaValue } from './r2StorageService';
import { getBackendUrl } from '../lib/backendUrl';
import { createStatus } from './statusService';

const MEDIA_FIELDS = ['poster_url', 'document_url'];

// ============================================================
// Staff-facing (authenticated, RLS-enforced)
// ============================================================

export const getCompanyAnnouncements = async (companyId) => {
  if (!companyId) return { success: false, error: 'companyId is required', data: [] };
  const { data, error } = await supabase
    .from('cmms_announcements')
    .select('*')
    .eq('cmms_company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) return { success: false, error: error.message, data: [] };
  const resolved = await resolveMediaValues(data || [], MEDIA_FIELDS);
  return { success: true, data: resolved };
};

export const createAnnouncement = async (companyId, createdByCmmsUserId, fields) => {
  if (!companyId) return { success: false, error: 'companyId is required' };
  const payload = {
    cmms_company_id: companyId,
    created_by_cmms_user_id: createdByCmmsUserId || null,
    post_type: fields.postType || 'announcement',
    visibility: fields.visibility || 'internal',
    status: fields.status || 'draft',
    title: fields.title?.trim(),
    summary: fields.summary?.trim() || null,
    body: fields.body?.trim(),
    poster_url: fields.posterUrl || null,
    poster_path: fields.posterPath || null,
    document_url: fields.documentUrl || null,
    document_path: fields.documentPath || null,
    department: fields.department?.trim() || null,
    location: fields.location?.trim() || null,
    employment_type: fields.employmentType || null,
    positions_available: fields.positionsAvailable || null,
    salary_range: fields.salaryRange?.trim() || null,
    application_deadline: fields.applicationDeadline || null,
    application_instructions: fields.applicationInstructions?.trim() || null,
  };

  const { data, error } = await supabase.from('cmms_announcements').insert(payload).select().single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const updateAnnouncement = async (id, patch) => {
  const { data, error } = await supabase
    .from('cmms_announcements')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const deleteAnnouncement = async (id) => {
  const { error } = await supabase.from('cmms_announcements').delete().eq('id', id);
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const getJobApplications = async (companyId) => {
  if (!companyId) return { success: false, error: 'companyId is required', data: [] };
  const { data, error } = await supabase
    .from('cmms_job_applications')
    .select('*, job:cmms_announcements!job_posting_id(title, post_type)')
    .eq('cmms_company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) return { success: false, error: error.message, data: [] };
  const resolved = await resolveMediaValues(data || [], ['resume_url']);
  return { success: true, data: resolved };
};

export const updateApplicationStatus = async (applicationId, status, statusNote, updatedByCmmsUserId) => {
  const { data, error } = await supabase
    .from('cmms_job_applications')
    .update({
      status,
      status_note: statusNote || null,
      status_updated_at: new Date().toISOString(),
      status_updated_by: updatedByCmmsUserId || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

// ============================================================
// Public (no login) -- SECURITY DEFINER RPCs, anon-safe
// ============================================================

export const getPublicCompanyHeader = async (companyId) => {
  const { data, error } = await supabase.rpc('fn_get_public_cmms_company_header', { p_company_id: companyId });
  if (error || !data?.length) return { success: false, error: error?.message, data: null };
  const row = { ...data[0] };
  row.logo_url = await resolveMediaValue(row.logo_url);
  return { success: true, data: row };
};

export const getPublicNotices = async (companyId, postType = null) => {
  const { data, error } = await supabase.rpc('fn_get_public_cmms_notices', {
    p_company_id: companyId,
    p_post_type: postType,
  });
  if (error) return { success: false, error: error.message, data: [] };
  const resolved = await resolveMediaValues(data || [], MEDIA_FIELDS);
  return { success: true, data: resolved };
};

export const getPublicNotice = async (noticeId) => {
  const { data, error } = await supabase.rpc('fn_get_public_cmms_notice', { p_notice_id: noticeId });
  if (error || !data?.length) return { success: false, error: error?.message, data: null };
  const [resolved] = await resolveMediaValues([data[0]], MEDIA_FIELDS);
  return { success: true, data: resolved };
};

export const submitPublicJobApplication = async ({
  jobPostingId,
  applicantName,
  applicantEmail,
  applicantPhone,
  coverNote,
  resumeUrl,
  resumePath,
}) => {
  const { data, error } = await supabase.rpc('fn_submit_public_job_application', {
    p_job_posting_id: jobPostingId,
    p_applicant_name: applicantName,
    p_applicant_email: applicantEmail,
    p_applicant_phone: applicantPhone || null,
    p_cover_note: coverNote || null,
    p_resume_url: resumeUrl || null,
    p_resume_path: resumePath || null,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, referenceCode: data?.[0]?.reference_code };
};

export const trackPublicJobApplication = async (referenceCode, contact) => {
  const { data, error } = await supabase.rpc('fn_track_public_job_application', {
    p_reference_code: referenceCode,
    p_contact: contact,
  });
  if (error) return { success: false, error: error.message, data: null };
  if (!data?.length) return { success: true, data: null };
  return { success: true, data: data[0] };
};

/**
 * Upload a job applicant's resume PDF with no auth token -- the one
 * anonymous upload path in the app (backend/routes/storageRoutes.js
 * POST /presign-upload-public), locked to PDF + a fixed folder.
 */
export const uploadPublicResume = async (file) => {
  try {
    if (!file) return { success: false, error: 'No file selected' };
    if (file.type !== 'application/pdf') {
      return { success: false, error: 'Please attach your resume/CV as a PDF file.' };
    }
    const MAX_BYTES = 8 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return { success: false, error: 'Resume is too large. Please attach a PDF under 8MB.' };
    }

    const backendUrl = getBackendUrl();
    const presignRes = await fetch(`${backendUrl}/api/storage/presign-upload-public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    });
    const presignData = await presignRes.json();
    if (!presignRes.ok || !presignData?.success) {
      return { success: false, error: presignData?.error || 'Failed to get upload URL' };
    }

    const putRes = await fetch(presignData.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!putRes.ok) {
      return { success: false, error: `Upload failed (${putRes.status})` };
    }

    return { success: true, key: presignData.key, url: `r2://${presignData.key}` };
  } catch (error) {
    console.error('Public resume upload error:', error);
    return { success: false, error: error.message || 'Unexpected upload error' };
  }
};

// Hardcoded like PublicPitchViewer's shareUrl -- a share link must always
// point at the real production domain regardless of where the share action
// itself was triggered from (a dev/staging build's window.location.origin
// would otherwise produce a link nobody else could open).
const PUBLIC_SITE_ORIGIN = 'https://icanera.space';

/** The one shareable URL for a specific post -- deep-links straight to it
 * via PublicCompanyNoticeBoard's ?post= handling, instead of just the
 * board's front page. */
export const buildPublicNoticeLink = (companyId, noticeId) =>
  `${PUBLIC_SITE_ORIGIN}/notices/${companyId}${noticeId ? `?post=${noticeId}` : ''}`;

/**
 * Cross-company feed for the marketing landing page -- every published
 * public post across all businesses, not just one company's board (mirrors
 * get_dropship_browsable_products' marketplace-wide browse).
 */
export const browsePublicNotices = async ({ postType = null, limit = 12, offset = 0 } = {}) => {
  const { data, error } = await supabase.rpc('fn_browse_public_cmms_notices', {
    p_post_type: postType,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return { success: false, error: error.message, data: [] };
  const resolved = await resolveMediaValues(data || [], ['poster_url', 'company_logo_url']);
  return { success: true, data: resolved };
};

/**
 * Cross-post a published public announcement/job into the ICAN "Updates"
 * feed (ican_statuses) so it reaches existing app users, not just people who
 * follow the shared link. Reuses createStatus (statusService.js) as-is --
 * no schema change -- with the notice's poster image and a caption carrying
 * a deep link back to the full post. Only public+published posts qualify:
 * an internal notice's link isn't viewable by anyone who isn't staff, so
 * broadcasting it to the public Updates feed would be a dead link for
 * everyone else.
 */
export const shareAnnouncementAsUpdate = async (post, authUserId) => {
  if (!authUserId) return { success: false, error: 'You must be signed in to post to Updates.' };
  if (post.visibility !== 'public' || post.status !== 'published') {
    return { success: false, error: 'Only published public posts can be shared to Updates.' };
  }

  const link = buildPublicNoticeLink(post.cmms_company_id, post.id);
  const ctaLabel = post.post_type === 'job' ? 'Apply now' : 'Read more';
  const caption = [post.title, post.summary, `${ctaLabel}: ${link}`]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2000);

  const { status, error } = await createStatus(authUserId, {
    media_type: post.poster_url ? 'image' : 'text',
    media_url: post.poster_url || null,
    caption,
    visibility: 'public',
    background_color: post.post_type === 'job' ? '#0f766e' : '#6d28d9',
  });

  if (error) return { success: false, error: error.message || 'Failed to share to Updates' };
  return { success: true, status };
};

export default {
  getCompanyAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getJobApplications,
  updateApplicationStatus,
  getPublicCompanyHeader,
  getPublicNotices,
  getPublicNotice,
  submitPublicJobApplication,
  trackPublicJobApplication,
  uploadPublicResume,
  buildPublicNoticeLink,
  browsePublicNotices,
  shareAnnouncementAsUpdate,
};
