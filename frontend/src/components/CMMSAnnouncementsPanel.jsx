import React, { useEffect, useMemo, useState } from 'react';
import {
  Megaphone, Briefcase, Plus, Edit2, Trash2, X, Save, Image as ImageIcon,
  FileText, Check, Users, Globe, Lock, Loader, Share2, Radio, ClipboardList,
  Video, Copy, Award
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { uploadToR2 } from '../services/r2StorageService';
import cmmsAnnouncementsService from '../services/cmmsAnnouncementsService';
import { getAccessibleBusinesses } from '../services/businessManagementService';
import cmmsWrittenTestService from '../services/cmmsWrittenTestService';
import cmmsInterviewService from '../services/cmmsInterviewService';
import CMMSWrittenTestBuilder from './CMMSWrittenTestBuilder';
import CMMSEmploymentDocumentsPanel from './CMMSEmploymentDocumentsPanel';
import LiveBoardroom from './LiveBoardroom';

const MAX_POSTER_BYTES = 6 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const EMPLOYMENT_TYPES = [
  { id: 'full_time', label: 'Full-time' },
  { id: 'part_time', label: 'Part-time' },
  { id: 'contract', label: 'Contract' },
  { id: 'internship', label: 'Internship' },
  { id: 'temporary', label: 'Temporary' },
  { id: 'volunteer', label: 'Volunteer' },
];

const emptyDraft = {
  id: null,
  postType: 'announcement',
  visibility: 'internal',
  status: 'draft',
  title: '',
  summary: '',
  body: '',
  department: '',
  location: '',
  employmentType: '',
  positionsAvailable: '',
  salaryRange: '',
  applicationDeadline: '',
  applicationInstructions: '',
};

const statusBadge = {
  draft: 'bg-slate-500/25 text-slate-300',
  published: 'bg-emerald-500/20 text-emerald-300',
  closed: 'bg-amber-500/20 text-amber-300',
  archived: 'bg-slate-700/40 text-slate-400',
};

const applicationStatusOptions = [
  { id: 'submitted', label: 'Submitted' },
  { id: 'under_review', label: 'Under review' },
  { id: 'shortlisted', label: 'Shortlisted' },
  { id: 'written_test', label: 'Written test' },
  { id: 'interview', label: 'Interview' },
  { id: 'hired', label: 'Hired' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn' },
];

/**
 * CMMS admin tool for public/internal announcements and job postings.
 * Publishing a "public" post makes it visible with no login at
 * /notices/<companyId> (see PublicCompanyNoticeBoard.jsx); an "internal"
 * post only notifies/shows to signed-in staff of this company.
 */
const CMMSAnnouncementsPanel = ({
  companyId,
  currentUser,
  canView = false,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  canManageApplications = false,
}) => {
  const [subTab, setSubTab] = useState('posts');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [myCmmsUserId, setMyCmmsUserId] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [posterFile, setPosterFile] = useState(null);
  const [posterPreview, setPosterPreview] = useState('');
  const [existingPosterUrl, setExistingPosterUrl] = useState('');
  const [documentFile, setDocumentFile] = useState(null);
  const [existingDocumentUrl, setExistingDocumentUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [sharingUpdateId, setSharingUpdateId] = useState(null);

  const [applications, setApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [jobFilter, setJobFilter] = useState('all');
  const [savingApplicationId, setSavingApplicationId] = useState(null);

  // Position Details roles (CMMSRoleConfiguration.jsx) for the "Fill from
  // role" job-posting autofill, the company's staff list for the interview
  // scheduler's interviewer picker, and the company's display name for
  // issued employment documents.
  const [roles, setRoles] = useState([]);
  const [companyStaff, setCompanyStaff] = useState([]);
  const [companyName, setCompanyName] = useState('');
  const [testBuilderJob, setTestBuilderJob] = useState(null);
  const [documentsForApplication, setDocumentsForApplication] = useState(null);

  // The public board's "About" text and its optional link to one of this
  // admin's own Dropship storefronts (see CMMS_NOTICE_BOARD_PRODUCTS.sql) --
  // both live on cmms_company_profiles, not cmms_announcements, so they're
  // loaded/saved separately from the posts list above.
  const [aboutDraft, setAboutDraft] = useState('');
  const [savedAbout, setSavedAbout] = useState('');
  const [savingAbout, setSavingAbout] = useState(false);
  const [businessProfileId, setBusinessProfileId] = useState('');
  const [savedBusinessProfileId, setSavedBusinessProfileId] = useState('');
  const [myBusinessProfiles, setMyBusinessProfiles] = useState([]);
  const [savingStorefront, setSavingStorefront] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    supabase.from('cmms_company_profiles').select('about, business_profile_id, company_name').eq('id', companyId).maybeSingle()
      .then(({ data }) => {
        setAboutDraft(data?.about || '');
        setSavedAbout(data?.about || '');
        setBusinessProfileId(data?.business_profile_id || '');
        setSavedBusinessProfileId(data?.business_profile_id || '');
        setCompanyName(data?.company_name || '');
      });
    cmmsAnnouncementsService.getRolesForAutofill(companyId).then((result) => { if (result.success) setRoles(result.data); });
    supabase.from('cmms_users').select('id, full_name, user_name, email').eq('cmms_company_id', companyId).eq('is_active', true)
      .then(({ data }) => setCompanyStaff(data || []));
  }, [companyId]);

  useEffect(() => {
    if (!canEdit || !currentUser?.id) return;
    getAccessibleBusinesses({ userId: currentUser.id, email: currentUser.email })
      .then(({ data }) => setMyBusinessProfiles((data || []).filter((b) => b.canManage)));
  }, [canEdit, currentUser?.id, currentUser?.email]);

  const saveAbout = async () => {
    setSavingAbout(true);
    const result = await cmmsAnnouncementsService.updateCompanyAbout(companyId, aboutDraft);
    setSavingAbout(false);
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    setSavedAbout(aboutDraft);
  };

  const saveStorefront = async () => {
    setSavingStorefront(true);
    const result = await cmmsAnnouncementsService.setCompanyBusinessProfileLink(companyId, businessProfileId || null);
    setSavingStorefront(false);
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    setSavedBusinessProfileId(businessProfileId);
  };

  const loadPosts = async () => {
    setLoading(true);
    const result = await cmmsAnnouncementsService.getCompanyAnnouncements(companyId);
    if (result.success) setPosts(result.data);
    else setError(result.error || 'Failed to load announcements');
    setLoading(false);
  };

  useEffect(() => {
    if (!companyId) return;
    loadPosts();
  }, [companyId]);

  useEffect(() => {
    const resolveMyCmmsUserId = async () => {
      if (!companyId || !currentUser?.email) return;
      const { data } = await supabase
        .from('cmms_users')
        .select('id')
        .eq('cmms_company_id', companyId)
        .ilike('email', currentUser.email)
        .maybeSingle();
      setMyCmmsUserId(data?.id || null);
    };
    resolveMyCmmsUserId();
  }, [companyId, currentUser?.email]);

  const loadApplications = async () => {
    setApplicationsLoading(true);
    const result = await cmmsAnnouncementsService.getJobApplications(companyId);
    if (result.success) setApplications(result.data);
    setApplicationsLoading(false);
  };

  useEffect(() => {
    if (subTab === 'applications' && companyId) loadApplications();
  }, [subTab, companyId]);

  const jobPosts = useMemo(() => posts.filter((p) => p.post_type === 'job'), [posts]);
  const visibleApplications = useMemo(() => (
    jobFilter === 'all' ? applications : applications.filter((a) => a.job_posting_id === jobFilter)
  ), [applications, jobFilter]);

  const resetForm = () => {
    if (posterPreview) URL.revokeObjectURL(posterPreview);
    setDraft(emptyDraft);
    setPosterFile(null);
    setPosterPreview('');
    setExistingPosterUrl('');
    setDocumentFile(null);
    setExistingDocumentUrl('');
    setShowForm(false);
  };

  const openCreate = (postType) => {
    setDraft({ ...emptyDraft, postType });
    setPosterFile(null);
    setPosterPreview('');
    setExistingPosterUrl('');
    setDocumentFile(null);
    setExistingDocumentUrl('');
    setShowForm(true);
  };

  const openEdit = (post) => {
    setDraft({
      id: post.id,
      postType: post.post_type,
      visibility: post.visibility,
      status: post.status,
      title: post.title || '',
      summary: post.summary || '',
      body: post.body || '',
      department: post.department || '',
      location: post.location || '',
      employmentType: post.employment_type || '',
      positionsAvailable: post.positions_available || '',
      salaryRange: post.salary_range || '',
      applicationDeadline: post.application_deadline || '',
      applicationInstructions: post.application_instructions || '',
    });
    setPosterFile(null);
    setPosterPreview('');
    setExistingPosterUrl(post.poster_url || '');
    setDocumentFile(null);
    setExistingDocumentUrl(post.document_url || '');
    setShowForm(true);
  };

  // "Fill from role" -- copies a role's Position Details (CMMSRoleConfiguration.jsx)
  // onto the job draft. A convenience prefill only: every field stays
  // editable afterward, so admin can tweak per-posting without touching the
  // role definition itself.
  const applyRoleAutofill = (roleId) => {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    setDraft((current) => ({
      ...current,
      title: role.job_title || current.title,
      department: role.department || current.department,
      employmentType: role.employment_type || current.employmentType,
      positionsAvailable: role.positions_available ?? current.positionsAvailable,
      salaryRange: role.salary_range || current.salaryRange,
      body: [role.job_description, role.responsibilities && `Responsibilities:\n${role.responsibilities}`, role.required_skills && `Requirements:\n${role.required_skills}`]
        .filter(Boolean).join('\n\n') || current.body,
    }));
  };

  const handlePosterSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file (PNG, JPG, or WEBP) for the poster.');
      return;
    }
    if (file.size > MAX_POSTER_BYTES) {
      alert('Poster image is too large. Please use an image under 6MB.');
      return;
    }
    if (posterPreview) URL.revokeObjectURL(posterPreview);
    setPosterFile(file);
    setPosterPreview(URL.createObjectURL(file));
  };

  const handleDocumentSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') {
      alert('Please attach a PDF document.');
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      alert('Document is too large. Please attach a PDF under 10MB.');
      return;
    }
    setDocumentFile(file);
  };

  const saveDraft = async (nextStatus) => {
    if (!draft.title.trim() || !draft.body.trim()) {
      alert('Please provide a title and the notice details.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      let posterUpload = null;
      if (posterFile) {
        if (!accessToken) throw new Error('Could not verify your session to upload the poster.');
        const result = await uploadToR2({ file: posterFile, folder: 'cmms-announcements', accessToken });
        if (!result.success) throw new Error(result.error || 'Poster upload failed');
        posterUpload = { url: result.url, key: result.key };
      }

      let documentUpload = null;
      if (documentFile) {
        if (!accessToken) throw new Error('Could not verify your session to upload the document.');
        const result = await uploadToR2({ file: documentFile, folder: 'cmms-announcements', accessToken });
        if (!result.success) throw new Error(result.error || 'Document upload failed');
        documentUpload = { url: result.url, key: result.key };
      }

      const commonFields = {
        postType: draft.postType,
        visibility: draft.visibility,
        status: nextStatus || draft.status,
        title: draft.title,
        summary: draft.summary,
        body: draft.body,
        department: draft.postType === 'job' ? draft.department : null,
        location: draft.postType === 'job' ? draft.location : null,
        employmentType: draft.postType === 'job' ? (draft.employmentType || null) : null,
        positionsAvailable: draft.postType === 'job' && draft.positionsAvailable ? Number(draft.positionsAvailable) : null,
        salaryRange: draft.postType === 'job' ? draft.salaryRange : null,
        applicationDeadline: draft.postType === 'job' && draft.applicationDeadline ? draft.applicationDeadline : null,
        applicationInstructions: draft.postType === 'job' ? draft.applicationInstructions : null,
      };

      if (draft.id) {
        // Only touch poster/document columns when a new file was uploaded --
        // otherwise the already-resolved live URL sitting in state would
        // overwrite the stored r2:// marker with an expiring signed link.
        const patch = { ...commonFields };
        if (posterUpload) { patch.poster_url = posterUpload.url; patch.poster_path = posterUpload.key; }
        if (documentUpload) { patch.document_url = documentUpload.url; patch.document_path = documentUpload.key; }
        const snakeCasePatch = toSnakeCase(patch);
        const result = await cmmsAnnouncementsService.updateAnnouncement(draft.id, snakeCasePatch);
        if (!result.success) throw new Error(result.error);
      } else {
        const result = await cmmsAnnouncementsService.createAnnouncement(companyId, myCmmsUserId, {
          ...commonFields,
          posterUrl: posterUpload?.url || null,
          posterPath: posterUpload?.key || null,
          documentUrl: documentUpload?.url || null,
          documentPath: documentUpload?.key || null,
        });
        if (!result.success) throw new Error(result.error);
      }

      resetForm();
      await loadPosts();
    } catch (err) {
      console.error('Error saving announcement:', err);
      setError(err.message || 'Failed to save');
      alert(`❌ ${err.message || 'Failed to save'}`);
    } finally {
      setSaving(false);
    }
  };

  const toSnakeCase = (patch) => ({
    post_type: patch.postType,
    visibility: patch.visibility,
    status: patch.status,
    title: patch.title?.trim(),
    summary: patch.summary?.trim() || null,
    body: patch.body?.trim(),
    department: patch.department?.trim() || null,
    location: patch.location?.trim() || null,
    employment_type: patch.employmentType || null,
    positions_available: patch.positionsAvailable || null,
    salary_range: patch.salaryRange?.trim() || null,
    application_deadline: patch.applicationDeadline || null,
    application_instructions: patch.applicationInstructions?.trim() || null,
    ...(patch.poster_url !== undefined ? { poster_url: patch.poster_url, poster_path: patch.poster_path } : {}),
    ...(patch.document_url !== undefined ? { document_url: patch.document_url, document_path: patch.document_path } : {}),
  });

  const setPostStatus = async (post, status) => {
    const result = await cmmsAnnouncementsService.updateAnnouncement(post.id, { status });
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    await loadPosts();
  };

  const removePost = async (post) => {
    if (!window.confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    const result = await cmmsAnnouncementsService.deleteAnnouncement(post.id);
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    await loadPosts();
  };

  const boardLink = (companyIdForLink) => cmmsAnnouncementsService.buildPublicNoticeLink(companyIdForLink);

  // Hands the post off to whatever the device's own share sheet offers
  // (WhatsApp, email, SMS, etc.) -- same pattern as PublicPitchViewer's
  // handleShare. Falls back to copying the link when the Web Share API
  // isn't available (most desktop browsers).
  const sharePost = async (post) => {
    const link = cmmsAnnouncementsService.buildPublicNoticeLink(post.cmms_company_id || companyId, post.id);
    const shareData = { title: post.title, text: post.summary || post.title, url: link };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(post.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      alert(link);
    }
  };

  const shareToUpdates = async (post) => {
    setSharingUpdateId(post.id);
    const result = await cmmsAnnouncementsService.shareAnnouncementAsUpdate(post, currentUser?.id);
    setSharingUpdateId(null);
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    alert('✅ Shared to your Updates feed!');
  };

  const saveApplicationStatus = async (application, status, note) => {
    setSavingApplicationId(application.id);
    const result = await cmmsAnnouncementsService.updateApplicationStatus(application.id, status, note, myCmmsUserId);
    if (!result.success) alert(`❌ ${result.error}`);
    else await loadApplications();
    setSavingApplicationId(null);
  };

  // "view" alone is a legitimate grant -- a role trusted only to read posts
  // (not draft, edit, or see applicant PII) still needs the panel to render,
  // just without any of the write controls below.
  if (!canView && !canCreate && !canEdit && !canManageApplications) {
    return (
      <div className="glass-card p-6 text-orange-200">
        Your role does not have access to Announcements &amp; job postings. Ask your company administrator to grant this tool under Role configuration.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="glass-card p-5 border border-purple-400/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-purple-300" /> Announcements &amp; Job Postings
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Post public posters and job vacancies visible with no login at{' '}
              <span className="text-purple-300 font-mono text-xs break-all">{boardLink(companyId)}</span>, or share internal-only notices with your signed-in staff.
            </p>
          </div>
          {canCreate && (
            <div className="flex gap-2">
              <button onClick={() => openCreate('announcement')} className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold flex items-center gap-2">
                <Plus className="w-4 h-4" /> New announcement
              </button>
              <button onClick={() => openCreate('job')} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center gap-2">
                <Briefcase className="w-4 h-4" /> New job posting
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-5 border-b border-white/10">
          <button onClick={() => setSubTab('posts')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${subTab === 'posts' ? 'border-purple-400 text-white' : 'border-transparent text-gray-400 hover:text-white'}`}>Posts</button>
          {canManageApplications && (
            <button onClick={() => setSubTab('applications')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${subTab === 'applications' ? 'border-purple-400 text-white' : 'border-transparent text-gray-400 hover:text-white'}`}>
              Applications {applications.length > 0 && <span className="ml-1 text-xs text-gray-500">({applications.length})</span>}
            </button>
          )}
          {canEdit && (
            <button onClick={() => setSubTab('profile')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${subTab === 'profile' ? 'border-purple-400 text-white' : 'border-transparent text-gray-400 hover:text-white'}`}>
              Board profile
            </button>
          )}
        </div>
      </div>

      {subTab === 'profile' && canEdit && (
        <div className="space-y-4">
          <div className="glass-card p-5 border border-white/10">
            <h3 className="text-white font-semibold mb-1">About this business</h3>
            <p className="text-sm text-gray-400 mb-3">Shown at the top of your public board — in your visitors' own words, what does this business actually do?</p>
            <textarea
              value={aboutDraft}
              onChange={(e) => setAboutDraft(e.target.value)}
              placeholder="e.g. DAb Construction builds and renovates commercial properties across Kampala, from foundation work to finishing..."
              rows={4}
              maxLength={2000}
              className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20"
            />
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                disabled={savingAbout || aboutDraft === savedAbout}
                onClick={saveAbout}
                className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-semibold"
              >
                {savingAbout ? 'Saving…' : 'Save about'}
              </button>
            </div>
          </div>

          <div className="glass-card p-5 border border-white/10">
            <h3 className="text-white font-semibold mb-1">Products &amp; services</h3>
            <p className="text-sm text-gray-400 mb-3">
              Link one of your own ICANera Dropship storefronts to show its products on your public board. Visitors can browse for free; paying uses their own ICANera wallet, same as your storefront's normal checkout.
            </p>
            {myBusinessProfiles.length === 0 ? (
              <p className="text-sm text-gray-500">You don't have a Dropship storefront yet under this ICANera account. Set one up from Business &rarr; Dropship, then come back here to link it.</p>
            ) : (
              <>
                <select
                  value={businessProfileId}
                  onChange={(e) => setBusinessProfileId(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-slate-900 text-white border border-white/20"
                >
                  <option value="">Don't show products/services on the board</option>
                  {myBusinessProfiles.map((b) => (
                    <option key={b.id} value={b.id}>{b.business_name}</option>
                  ))}
                </select>
                <div className="flex items-center justify-end gap-2 mt-2">
                  <button
                    disabled={savingStorefront || businessProfileId === savedBusinessProfileId}
                    onClick={saveStorefront}
                    className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold"
                  >
                    {savingStorefront ? 'Saving…' : 'Save storefront link'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {subTab === 'posts' && (
        <div className="space-y-4">
          {error && <p className="text-red-300 text-sm">{error}</p>}
          {loading ? (
            <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-purple-400 animate-spin" /></div>
          ) : posts.length === 0 ? (
            <div className="glass-card p-8 text-center text-gray-400">
              <Megaphone className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              No announcements or job postings yet. {canCreate ? 'Create your first one above.' : ''}
            </div>
          ) : (
            posts.map((post) => (
              <div key={post.id} className="glass-card p-4 border border-white/10">
                <div className="flex flex-wrap gap-4">
                  {post.poster_url && (
                    <img src={post.poster_url} alt="" className="w-24 h-24 object-cover rounded-lg border border-white/10 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-[240px]">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      {post.post_type === 'job' ? <Briefcase className="w-4 h-4 text-emerald-300" /> : <Megaphone className="w-4 h-4 text-purple-300" />}
                      <h3 className="text-white font-semibold">{post.title}</h3>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusBadge[post.status] || statusBadge.draft}`}>{post.status}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-300 flex items-center gap-1">
                        {post.visibility === 'public' ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />} {post.visibility}
                      </span>
                    </div>
                    {post.summary && <p className="text-sm text-gray-300 mb-1">{post.summary}</p>}
                    <p className="text-xs text-gray-500 line-clamp-2">{post.body}</p>
                    {post.post_type === 'job' && (
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-400">
                        {post.location && <span>📍 {post.location}</span>}
                        {post.employment_type && <span>{EMPLOYMENT_TYPES.find((t) => t.id === post.employment_type)?.label || post.employment_type}</span>}
                        {post.application_deadline && <span>Deadline: {post.application_deadline}</span>}
                        <span>{post.applications_count || 0} application{post.applications_count === 1 ? '' : 's'}</span>
                      </div>
                    )}
                    {post.document_url && (
                      <a href={post.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200 mt-2">
                        <FileText className="w-3.5 h-3.5" /> View attached document
                      </a>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    {canEdit && (
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(post)} className="p-2 text-blue-300 hover:text-white" title="Edit"><Edit2 className="w-4 h-4" /></button>
                        {canDelete && <button onClick={() => removePost(post)} className="p-2 text-red-300 hover:text-white" title="Delete"><Trash2 className="w-4 h-4" /></button>}
                      </div>
                    )}
                    {canEdit && post.post_type === 'job' && (
                      <button onClick={() => setTestBuilderJob(post)} className="text-xs text-indigo-300 hover:text-indigo-200 flex items-center gap-1">
                        <ClipboardList className="w-3.5 h-3.5" /> Written test
                      </button>
                    )}
                    {canEdit && (
                      <select value={post.status} onChange={(e) => setPostStatus(post, e.target.value)} className="text-xs rounded bg-slate-900 border border-white/20 px-2 py-1 text-white">
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                        <option value="closed">Closed</option>
                        <option value="archived">Archived</option>
                      </select>
                    )}
                    {post.visibility === 'public' && post.status === 'published' && (
                      <div className="flex flex-col gap-1.5 items-end">
                        <button onClick={() => sharePost(post)} className="text-xs text-purple-300 hover:text-purple-200 flex items-center gap-1">
                          {copiedId === post.id ? <><Check className="w-3.5 h-3.5" /> Link copied</> : <><Share2 className="w-3.5 h-3.5" /> Share</>}
                        </button>
                        <button
                          onClick={() => shareToUpdates(post)}
                          disabled={sharingUpdateId === post.id}
                          className="text-xs text-emerald-300 hover:text-emerald-200 flex items-center gap-1 disabled:opacity-50"
                          title="Post this to the ICAN Updates feed"
                        >
                          <Radio className="w-3.5 h-3.5" /> {sharingUpdateId === post.id ? 'Sharing…' : 'Share to Updates'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'applications' && canManageApplications && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-400">Filter by job:</label>
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} className="rounded bg-slate-900 border border-white/20 px-2 py-1.5 text-white text-sm">
              <option value="all">All jobs</option>
              {jobPosts.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
            </select>
          </div>
          {applicationsLoading ? (
            <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-purple-400 animate-spin" /></div>
          ) : visibleApplications.length === 0 ? (
            <div className="glass-card p-8 text-center text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              No applications yet.
            </div>
          ) : (
            visibleApplications.map((application) => (
              <ApplicationRow
                key={application.id}
                application={application}
                saving={savingApplicationId === application.id}
                onSave={saveApplicationStatus}
                companyId={companyId}
                companyStaff={companyStaff}
                currentCmmsUserId={myCmmsUserId}
                onIssueDocuments={() => setDocumentsForApplication(application)}
              />
            ))
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 overflow-y-auto overscroll-contain">
          {/* pb-16 (plus the safe-area inset) keeps the Publish/Cancel row
              clear of the mobile home-indicator/browser-chrome instead of
              sitting flush against it once this long form (job postings add
              a whole extra field section) is scrolled to the bottom. */}
          <div
            className="min-h-screen flex items-start justify-center p-4 pb-16"
            style={{ paddingBottom: 'max(4rem, calc(env(safe-area-inset-bottom) + 2rem))' }}
          >
            <div className="glass-card w-full max-w-2xl p-6 my-8 border border-purple-400/30">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">
                  {draft.id ? 'Edit' : 'New'} {draft.postType === 'job' ? 'job posting' : 'announcement'}
                </h3>
                <button onClick={resetForm} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-3">
                  {draft.postType === 'job' && roles.length > 0 && (
                    <select
                      value={roles.find((r) => r.job_title === draft.title)?.id || ''}
                      onChange={(e) => { if (e.target.value) applyRoleAutofill(e.target.value); }}
                      className="w-full px-3 py-2 rounded bg-slate-900 text-emerald-300 border border-emerald-400/40 md:col-span-2"
                    >
                      <option value="">Job title — pick from a configured role…</option>
                      {roles.map((role) => <option key={role.id} value={role.id}>{role.job_title} ({role.display_name})</option>)}
                    </select>
                  )}
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder={draft.postType === 'job' ? (roles.length > 0 ? 'Job title (edit if needed, or type a custom one)' : 'Job title (e.g. Warehouse Supervisor)') : 'Announcement title'}
                    className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20 md:col-span-2"
                  />
                  <select value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-900 text-white border border-white/20">
                    <option value="internal">Internal notice (staff only)</option>
                    <option value="public">Public (no login required)</option>
                  </select>
                  <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className="w-full px-3 py-2 rounded bg-slate-900 text-white border border-white/20">
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="closed">Closed</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <input
                  value={draft.summary}
                  onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                  placeholder="Short summary (shown in lists and notifications)"
                  maxLength={500}
                  className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20"
                />
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  placeholder="Full details"
                  rows={5}
                  className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20"
                />

                {draft.postType === 'job' && (
                  <div className="grid md:grid-cols-2 gap-3 border-t border-white/10 pt-4">
                    <input value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })} placeholder="Department" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
                    <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="Location" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
                    <select value={draft.employmentType} onChange={(e) => setDraft({ ...draft, employmentType: e.target.value })} className="px-3 py-2 rounded bg-slate-900 text-white border border-white/20">
                      <option value="">Employment type</option>
                      {EMPLOYMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    <input type="number" min="1" value={draft.positionsAvailable} onChange={(e) => setDraft({ ...draft, positionsAvailable: e.target.value })} placeholder="Positions available" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
                    <input value={draft.salaryRange} onChange={(e) => setDraft({ ...draft, salaryRange: e.target.value })} placeholder="Salary range (optional)" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
                    <input type="date" value={draft.applicationDeadline} onChange={(e) => setDraft({ ...draft, applicationDeadline: e.target.value })} className="px-3 py-2 rounded bg-slate-900 text-white border border-white/20" />
                    <textarea value={draft.applicationInstructions} onChange={(e) => setDraft({ ...draft, applicationInstructions: e.target.value })} placeholder="Application instructions shown to applicants (optional)" rows={2} className="px-3 py-2 rounded bg-white/10 text-white border border-white/20 md:col-span-2" />
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-4 border-t border-white/10 pt-4">
                  <div>
                    <p className="text-sm font-semibold text-white mb-2 flex items-center gap-1"><ImageIcon className="w-4 h-4" /> Poster image</p>
                    {(posterPreview || existingPosterUrl) && (
                      <img src={posterPreview || existingPosterUrl} alt="Poster preview" className="w-full h-32 object-cover rounded-lg border border-white/10 mb-2" />
                    )}
                    <label className="block text-xs text-gray-400 cursor-pointer">
                      <span className="inline-block px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white">Choose image</span>
                      <input type="file" accept="image/*" onChange={handlePosterSelect} className="hidden" />
                    </label>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white mb-2 flex items-center gap-1"><FileText className="w-4 h-4" /> PDF document</p>
                    {(documentFile || existingDocumentUrl) && (
                      <p className="text-xs text-blue-300 mb-2 truncate">{documentFile?.name || 'Existing document attached'}</p>
                    )}
                    <label className="block text-xs text-gray-400 cursor-pointer">
                      <span className="inline-block px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white">Choose PDF</span>
                      <input type="file" accept="application/pdf" onChange={handleDocumentSelect} className="hidden" />
                    </label>
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2 pt-2 pb-1">
                  <button onClick={resetForm} className="px-4 py-2 rounded text-gray-300 hover:text-white">Cancel</button>
                  <button disabled={saving} onClick={() => saveDraft('draft')} className="px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-white font-semibold">
                    {saving ? 'Saving…' : 'Save as draft'}
                  </button>
                  <button disabled={saving} onClick={() => saveDraft('published')} className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold flex items-center gap-2">
                    <Save className="w-4 h-4" /> {saving ? 'Publishing…' : 'Publish'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {testBuilderJob && (
        <CMMSWrittenTestBuilder
          companyId={companyId}
          jobPostingId={testBuilderJob.id}
          jobTitle={testBuilderJob.title}
          currentCmmsUserId={myCmmsUserId}
          onClose={() => setTestBuilderJob(null)}
        />
      )}

      {documentsForApplication && (
        <CMMSEmploymentDocumentsPanel
          companyId={companyId}
          companyName={companyName}
          application={documentsForApplication}
          currentCmmsUserId={myCmmsUserId}
          onClose={() => setDocumentsForApplication(null)}
        />
      )}
    </div>
  );
};

const ApplicationRow = ({ application, saving, onSave, companyId, companyStaff, currentCmmsUserId, onIssueDocuments }) => {
  const [status, setStatus] = useState(application.status);
  const [note, setNote] = useState(application.status_note || '');
  const [pipelineAction, setPipelineAction] = useState(null);
  const dirty = status !== application.status || note !== (application.status_note || '');

  // Picking "Written test" or "Interview" from the status dropdown isn't
  // just a label -- it should open the actual page for doing that step,
  // instead of leaving the admin to separately notice the buttons below.
  const changeStatus = (nextStatus) => {
    setStatus(nextStatus);
    if (nextStatus === 'written_test') setPipelineAction('test');
    else if (nextStatus === 'interview') setPipelineAction('interview');
  };

  return (
    <div className="glass-card p-4 border border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-white font-semibold">{application.applicant_name}</p>
          <p className="text-xs text-gray-400">{application.applicant_email} {application.applicant_phone ? `· ${application.applicant_phone}` : ''}</p>
          <p className="text-xs text-purple-300 font-mono mt-1">{application.reference_code}</p>
          <p className="text-xs text-gray-500 mt-1">Applied for: {application.job?.title || 'Job posting'} · {new Date(application.created_at).toLocaleDateString()}</p>
          {application.ican_verified && <p className="text-xs text-emerald-400 mt-1">✓ Linked to an ICAN account</p>}
          {application.cover_note && <p className="text-sm text-gray-300 mt-2 max-w-xl">{application.cover_note}</p>}
          <div className="flex flex-wrap gap-3 mt-2">
            {application.resume_url && (
              <a href={application.resume_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
                <FileText className="w-3.5 h-3.5" /> View resume/CV
              </a>
            )}
            {application.applicant_portfolio_handle && (
              <a href={`${window.location.origin}/portfolio/${application.applicant_portfolio_handle}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
                <FileText className="w-3.5 h-3.5" /> View ICAN portfolio (resume)
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 min-w-[220px]">
          <select value={status} onChange={(e) => changeStatus(e.target.value)} className="text-sm rounded bg-slate-900 border border-white/20 px-2 py-1.5 text-white">
            {applicationStatusOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
          </select>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note visible to applicant on follow-up (optional)" rows={2} className="text-xs rounded bg-white/10 border border-white/20 px-2 py-1.5 text-white" />
          <button
            disabled={!dirty || saving}
            onClick={() => onSave(application, status, note)}
            className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-semibold"
          >
            {saving ? 'Saving…' : 'Save status'}
          </button>
        </div>
      </div>

      <ApplicationPipelineControls
        application={application}
        companyId={companyId}
        companyStaff={companyStaff}
        currentCmmsUserId={currentCmmsUserId}
        onIssueDocuments={onIssueDocuments}
        openAction={pipelineAction}
        onActionOpened={() => setPipelineAction(null)}
      />
    </div>
  );
};

/**
 * The "clear interview follow-up" pipeline: send a written test (must
 * already be published for this job, see the Posts tab's "Written test"
 * button), schedule a live video interview (reuses LiveBoardroom via
 * CandidateInterviewRoom.jsx), and -- once hired -- issue a QR-sealed
 * appointment letter/contract. Admin can trigger any of these at any point
 * (a flexible pipeline, not a rigid gate).
 */
const ApplicationPipelineControls = ({ application, companyId, companyStaff, currentCmmsUserId, onIssueDocuments, openAction, onActionOpened }) => {
  const [tests, setTests] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [sendingTestId, setSendingTestId] = useState(null);
  const [copiedLink, setCopiedLink] = useState('');
  const [showTestPicker, setShowTestPicker] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ scheduledAt: '', durationMinutes: 30, interviewerIds: [], notes: '' });
  const [scheduling, setScheduling] = useState(false);
  const [joiningInterviewId, setJoiningInterviewId] = useState(null);
  const [boardroomAccess, setBoardroomAccess] = useState(null);

  // Picking "Written test" or "Interview" from the status dropdown above
  // opens the matching panel directly, instead of leaving the admin to find
  // the right button on their own -- a clear next step for each stage.
  useEffect(() => {
    if (!openAction) return;
    if (openAction === 'test') setShowTestPicker(true);
    if (openAction === 'interview') setShowScheduler(true);
    onActionOpened?.();
  }, [openAction, onActionOpened]);

  const loadPipeline = async () => {
    if (application.job_posting_id) {
      const testsResult = await cmmsWrittenTestService.getTestsForJob(application.job_posting_id);
      if (testsResult.success) setTests(testsResult.data.filter((t) => t.status === 'published'));
    }
    const [assignmentsResult, interviewsResult] = await Promise.all([
      cmmsWrittenTestService.getAssignmentsForApplication(application.id),
      cmmsInterviewService.getInterviewsForApplication(application.id),
    ]);
    if (assignmentsResult.success) setAssignments(assignmentsResult.data);
    if (interviewsResult.success) setInterviews(interviewsResult.data);
  };

  useEffect(() => { loadPipeline(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [application.id]);

  const copyLink = async (link) => {
    try { await navigator.clipboard.writeText(link); setCopiedLink(link); setTimeout(() => setCopiedLink(''), 2000); }
    catch { alert(link); }
  };

  const sendTest = async (test) => {
    setSendingTestId(test.id);
    const result = await cmmsWrittenTestService.assignTestToApplication(test.id, application, currentCmmsUserId);
    setSendingTestId(null);
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    setShowTestPicker(false);
    await loadPipeline();
    await copyLink(cmmsWrittenTestService.buildCandidateTestLink(result.accessToken));
  };

  const toggleInterviewer = (userId) => setScheduleForm((current) => ({
    ...current,
    interviewerIds: current.interviewerIds.includes(userId) ? current.interviewerIds.filter((id) => id !== userId) : [...current.interviewerIds, userId],
  }));

  const submitSchedule = async () => {
    if (!scheduleForm.scheduledAt) { alert('Choose a date and time for the interview.'); return; }
    setScheduling(true);
    const result = await cmmsInterviewService.scheduleInterview(companyId, application, scheduleForm, currentCmmsUserId);
    setScheduling(false);
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    setShowScheduler(false);
    setScheduleForm({ scheduledAt: '', durationMinutes: 30, interviewerIds: [], notes: '' });
    await loadPipeline();
    await copyLink(cmmsInterviewService.buildCandidateInterviewLink(result.data.id));
  };

  const cancelInterview = async (schedule) => {
    if (!window.confirm('Cancel this scheduled interview?')) return;
    const result = await cmmsInterviewService.cancelInterview(schedule.id);
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    await loadPipeline();
  };

  // Lets an interviewer (or the admin, if they're one of the named
  // interviewers) join the live call without ever leaving the CMMS panel --
  // same fn_can_join_interview gate and LiveBoardroom the standalone
  // /candidate-interview page uses (CandidateInterviewRoom.jsx), just
  // rendered in place instead of navigating away from the app.
  const joinInterview = async (interview) => {
    setJoiningInterviewId(interview.id);
    const result = await cmmsInterviewService.canJoinInterview(interview.id);
    setJoiningInterviewId(null);
    if (!result.success || !result.data?.can_join) {
      alert(`❌ ${result.data?.status === 'cancelled' ? 'This interview has been cancelled.' : (result.error || 'You are not authorized to join this interview.')}`);
      return;
    }
    setBoardroomAccess(result.data);
  };

  return (
    <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center gap-2">
      <button onClick={() => setShowTestPicker((v) => !v)} className="px-3 py-1.5 rounded bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5">
        <ClipboardList className="w-3.5 h-3.5" /> Send written test
      </button>

      <button onClick={() => setShowScheduler((v) => !v)} className="px-3 py-1.5 rounded bg-sky-600/80 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5">
        <Video className="w-3.5 h-3.5" /> Schedule live interview
      </button>

      {application.status === 'hired' && (
        <button onClick={onIssueDocuments} className="px-3 py-1.5 rounded bg-amber-600/80 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5">
          <Award className="w-3.5 h-3.5" /> Issue appointment letter / contract
        </button>
      )}

      {copiedLink && <span className="text-xs text-emerald-300 flex items-center gap-1"><Copy className="w-3 h-3" /> Link copied — send it to the candidate</span>}

      {assignments.length > 0 && (
        <div className="w-full flex flex-wrap gap-2 text-xs text-gray-400">
          {assignments.map((a) => (
            <span key={a.id} className="px-2 py-1 rounded bg-white/5 border border-white/10">
              {a.test?.title || 'Test'}: {a.status === 'completed' ? `${a.score}/${a.max_score}` : a.status.replace('_', ' ')}
            </span>
          ))}
        </div>
      )}

      {interviews.filter((i) => i.status === 'scheduled').map((interview) => (
        <div key={interview.id} className="w-full flex items-center gap-2 text-xs text-gray-400">
          <Video className="w-3.5 h-3.5 text-sky-300" />
          Interview scheduled: {new Date(interview.scheduled_at).toLocaleString()} ({interview.duration_minutes} min)
          <button onClick={() => joinInterview(interview)} disabled={joiningInterviewId === interview.id} className="text-emerald-300 hover:text-emerald-200 disabled:opacity-50">
            {joiningInterviewId === interview.id ? 'Checking…' : 'Join call'}
          </button>
          <button onClick={() => copyLink(cmmsInterviewService.buildCandidateInterviewLink(interview.id))} className="text-blue-300 hover:text-blue-200">Copy link</button>
          <button onClick={() => cancelInterview(interview)} className="text-red-300 hover:text-red-200">Cancel</button>
        </div>
      ))}

      {boardroomAccess && (
        <div className="fixed inset-0 z-[90] bg-black">
          <LiveBoardroom
            groupId={boardroomAccess.room_id}
            groupName={`Interview — ${boardroomAccess.candidate_name}`}
            members={boardroomAccess.is_interviewer ? [{ id: boardroomAccess.candidate_ican_user_id, email: boardroomAccess.candidate_name }] : (boardroomAccess.members || [])}
            creatorId={null}
            context="cmms-interview"
            onClose={() => setBoardroomAccess(null)}
            autoStart
          />
        </div>
      )}

      {showTestPicker && (
        <div className="w-full mt-2 p-3 rounded bg-white/5 border border-white/10 space-y-2">
          <p className="text-sm font-semibold text-white">Send a written test</p>
          {tests.length === 0 ? (
            <p className="text-xs text-gray-400">
              No published written test for this job yet. Go to the <span className="text-white font-medium">Posts</span> tab and use the <span className="text-white font-medium">Written test</span> button on this job posting to build and publish one first.
            </p>
          ) : (
            <div className="space-y-1.5">
              {tests.map((test) => (
                <button
                  key={test.id}
                  disabled={sendingTestId === test.id}
                  onClick={() => sendTest(test)}
                  className="w-full text-left px-3 py-2 rounded bg-white/10 hover:bg-white/20 text-white text-sm disabled:opacity-50"
                >
                  {sendingTestId === test.id ? 'Sending…' : test.title}
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={() => setShowTestPicker(false)} className="px-3 py-1.5 text-xs text-gray-300 hover:text-white">Close</button>
          </div>
        </div>
      )}

      {showScheduler && (
        <div className="w-full mt-2 p-3 rounded bg-white/5 border border-white/10 space-y-2">
          <p className="text-sm font-semibold text-white">Schedule a live video interview</p>
          <div className="grid md:grid-cols-2 gap-2">
            <input type="datetime-local" value={scheduleForm.scheduledAt} onChange={(e) => setScheduleForm((c) => ({ ...c, scheduledAt: e.target.value }))} className="px-2 py-1.5 rounded bg-slate-900 text-white border border-white/20 text-sm" />
            <input type="number" min="5" value={scheduleForm.durationMinutes} onChange={(e) => setScheduleForm((c) => ({ ...c, durationMinutes: e.target.value }))} placeholder="Duration (minutes)" className="px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Interviewer(s)</p>
            <div className="flex flex-wrap gap-2">
              {companyStaff.map((s) => (
                <label key={s.id} className="flex items-center gap-1 text-xs text-gray-300">
                  <input type="checkbox" checked={scheduleForm.interviewerIds.includes(s.id)} onChange={() => toggleInterviewer(s.id)} />
                  {s.full_name || s.user_name || s.email}
                </label>
              ))}
            </div>
          </div>
          <textarea value={scheduleForm.notes} onChange={(e) => setScheduleForm((c) => ({ ...c, notes: e.target.value }))} placeholder="Notes for interviewers (optional)" rows={2} className="w-full px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowScheduler(false)} className="px-3 py-1.5 text-xs text-gray-300 hover:text-white">Cancel</button>
            <button disabled={scheduling} onClick={submitSchedule} className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold">{scheduling ? 'Scheduling…' : 'Schedule & get link'}</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CMMSAnnouncementsPanel;
