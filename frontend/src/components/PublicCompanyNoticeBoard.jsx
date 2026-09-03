import React, { useEffect, useState } from 'react';
import {
  Megaphone, Briefcase, MapPin, Calendar, Users, FileText, X, Loader,
  AlertCircle, CheckCircle2, Search, Building2, ArrowLeft, Upload, Share2, Check
} from 'lucide-react';
import cmmsAnnouncementsService from '../services/cmmsAnnouncementsService';

const EMPLOYMENT_LABELS = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
  volunteer: 'Volunteer',
};

/**
 * The company's public notice board -- no ICAN account required. Rendered
 * from main.jsx for /notices/:companyId, same "share link needs no login"
 * pattern as PublicPitchViewer/PublicDropshipStorefront. Job applications
 * are submitted here directly (not gated behind a sign-in prompt) since
 * the whole point is that applicants never need an account.
 */
const PublicCompanyNoticeBoard = ({ companyId }) => {
  const [company, setCompany] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState('notices');
  const [notices, setNotices] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedNotice, setSelectedNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [headerResult, noticesResult, jobsResult] = await Promise.all([
        cmmsAnnouncementsService.getPublicCompanyHeader(companyId),
        cmmsAnnouncementsService.getPublicNotices(companyId, 'announcement'),
        cmmsAnnouncementsService.getPublicNotices(companyId, 'job'),
      ]);
      if (cancelled) return;
      if (!headerResult.success || !headerResult.data) {
        setNotFound(true);
      } else {
        setCompany(headerResult.data);
        setNotices(noticesResult.data || []);
        setJobs(jobsResult.data || []);
      }
      setLoading(false);
    };
    if (companyId) load();
    return () => { cancelled = true; };
  }, [companyId]);

  // A shared post link (?post=<id>) should open straight to that specific
  // announcement/job, not just the board's front page -- the whole point
  // of "Share" below is that the recipient lands exactly where the sharer
  // was looking, the same way a shared Pitchin link opens that one video.
  useEffect(() => {
    if (loading || notFound) return;
    const postId = new URLSearchParams(window.location.search).get('post');
    if (!postId) return;
    cmmsAnnouncementsService.getPublicNotice(postId).then((result) => {
      if (!result.success || !result.data) return;
      if (result.data.post_type === 'job') {
        setSection('careers');
        setSelectedJob(result.data);
      } else {
        setSection('notices');
        setSelectedNotice(result.data);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, notFound]);

  const goToApp = () => {
    window.history.replaceState({}, '', '/');
    window.location.href = '/';
  };

  // The list RPC (fn_get_public_cmms_notices) doesn't compute is_open (it
  // depends on "now", not just the row) or count a view -- open the modal
  // immediately with the list's data for a snappy UI, then swap in the
  // single-notice RPC's fresher copy (which does both) once it lands. This
  // matters most for jobs: without it, a job whose deadline has passed
  // would still show "Apply now" until this refresh corrects it.
  const openDetail = (item, setSelected) => {
    setSelected(item);
    cmmsAnnouncementsService.getPublicNotice(item.id).then((result) => {
      if (result.success && result.data) {
        setSelected((current) => (current?.id === item.id ? result.data : current));
      }
    });
  };

  // Hands the specific post off to whatever apps the visitor's own device
  // offers to share through (WhatsApp, email, SMS, etc.) via the Web Share
  // API, falling back to a clipboard copy where that API isn't available
  // (most desktop browsers) -- same pattern as PublicPitchViewer's Share.
  const handleShare = async (item, onCopied) => {
    const link = cmmsAnnouncementsService.buildPublicNoticeLink(companyId, item.id);
    const shareData = { title: item.title, text: item.summary || item.title, url: link };
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
      onCopied?.();
    } catch {
      window.prompt('Copy this link:', link);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="w-14 h-14 text-slate-500" />
        <p className="text-white text-lg font-semibold">This notice board isn't available</p>
        <button onClick={goToApp} className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold transition">Open ICANEra</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-900/60 backdrop-blur sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          {company.logo_url ? (
            <img src={company.logo_url} alt={company.company_name} className="w-12 h-12 rounded-xl object-cover border border-white/10" />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold text-lg">
              {company.company_name?.charAt(0)?.toUpperCase() || <Building2 className="w-6 h-6" />}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold truncate">{company.company_name}</h1>
            <p className="text-xs text-gray-400 truncate">
              {[company.industry, company.location].filter(Boolean).join(' · ') || 'Notice board'}
            </p>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-gray-500 hidden sm:block">via ICANEra</span>
        </div>
        <div className="max-w-4xl mx-auto px-4 flex gap-1 border-t border-white/5">
          {[
            { id: 'notices', label: 'Notices', icon: Megaphone },
            { id: 'careers', label: 'Careers', icon: Briefcase },
            { id: 'track', label: 'Track my application', icon: Search },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSection(tab.id)}
              className={`px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 border-b-2 transition ${section === tab.id ? 'border-purple-400 text-white' : 'border-transparent text-gray-400 hover:text-white'}`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {section === 'notices' && (
          <NoticeList notices={notices} onSelect={(notice) => openDetail(notice, setSelectedNotice)} />
        )}
        {section === 'careers' && (
          <JobList jobs={jobs} onSelect={(job) => openDetail(job, setSelectedJob)} />
        )}
        {section === 'track' && <TrackApplication />}
      </main>

      {selectedNotice && <NoticeDetailModal notice={selectedNotice} onClose={() => setSelectedNotice(null)} onShare={handleShare} />}
      {selectedJob && <JobDetailModal job={selectedJob} onClose={() => setSelectedJob(null)} onShare={handleShare} />}
    </div>
  );
};

const NoticeList = ({ notices, onSelect }) => {
  if (notices.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <Megaphone className="w-10 h-10 mx-auto mb-3 text-gray-700" />
        No public notices right now. Check back later.
      </div>
    );
  }
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {notices.map((notice) => (
        <button key={notice.id} onClick={() => onSelect(notice)} className="text-left glass-card p-4 border border-white/10 hover:border-purple-400/50 transition">
          {notice.poster_url && <img src={notice.poster_url} alt="" className="w-full h-36 object-cover rounded-lg mb-3" />}
          <h3 className="font-semibold text-white">{notice.title}</h3>
          {notice.summary && <p className="text-sm text-gray-400 mt-1 line-clamp-2">{notice.summary}</p>}
          <p className="text-xs text-gray-500 mt-2">{notice.published_at ? new Date(notice.published_at).toLocaleDateString() : ''}</p>
        </button>
      ))}
    </div>
  );
};

const NoticeDetailModal = ({ notice, onClose, onShare }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Modal onClose={onClose}>
      {notice.poster_url && <img src={notice.poster_url} alt="" className="w-full max-h-72 object-cover rounded-lg mb-4" />}
      <div className="flex items-start justify-between gap-3 mb-2">
        <h2 className="text-xl font-bold text-white">{notice.title}</h2>
        <ShareButton copied={copied} onClick={() => onShare(notice, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); })} />
      </div>
      <p className="text-xs text-gray-500 mb-4">{notice.published_at ? new Date(notice.published_at).toLocaleString() : ''}</p>
      <p className="text-gray-200 whitespace-pre-wrap">{notice.body}</p>
      {notice.document_url && (
        <a href={notice.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-4 text-blue-300 hover:text-blue-200 text-sm">
          <FileText className="w-4 h-4" /> View attached document (PDF)
        </a>
      )}
    </Modal>
  );
};

const ShareButton = ({ copied, onClick }) => (
  <button
    onClick={onClick}
    className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-gray-200 transition"
    title="Share"
  >
    {copied ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copied</> : <><Share2 className="w-3.5 h-3.5" /> Share</>}
  </button>
);

const JobList = ({ jobs, onSelect }) => {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <Briefcase className="w-10 h-10 mx-auto mb-3 text-gray-700" />
        No open positions right now. Check back later.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <button key={job.id} onClick={() => onSelect(job)} className="w-full text-left glass-card p-4 border border-white/10 hover:border-emerald-400/50 transition flex gap-4">
          {job.poster_url && <img src={job.poster_url} alt="" className="w-20 h-20 object-cover rounded-lg flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white">{job.title}</h3>
            {job.summary && <p className="text-sm text-gray-400 line-clamp-1">{job.summary}</p>}
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-400">
              {job.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {job.location}</span>}
              {job.employment_type && <span>{EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}</span>}
              {job.application_deadline && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Apply by {job.application_deadline}</span>}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
};

const JobDetailModal = ({ job, onClose, onShare }) => {
  const [showApply, setShowApply] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <Modal onClose={onClose}>
      {!showApply ? (
        <>
          {job.poster_url && <img src={job.poster_url} alt="" className="w-full max-h-64 object-cover rounded-lg mb-4" />}
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-xl font-bold text-white">{job.title}</h2>
            <ShareButton copied={copied} onClick={() => onShare(job, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); })} />
          </div>
          <div className="flex flex-wrap gap-3 mb-4 text-xs text-gray-400">
            {job.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {job.location}</span>}
            {job.employment_type && <span>{EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}</span>}
            {job.positions_available && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {job.positions_available} position{job.positions_available === 1 ? '' : 's'}</span>}
            {job.salary_range && <span>{job.salary_range}</span>}
            {job.application_deadline && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Apply by {job.application_deadline}</span>}
          </div>
          <p className="text-gray-200 whitespace-pre-wrap">{job.body}</p>
          {job.application_instructions && (
            <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-300">
              <p className="font-semibold text-white mb-1">How to apply</p>
              {job.application_instructions}
            </div>
          )}
          {job.document_url && (
            <a href={job.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-4 text-blue-300 hover:text-blue-200 text-sm">
              <FileText className="w-4 h-4" /> Full job description (PDF)
            </a>
          )}
          {job.is_open === false ? (
            <p className="mt-5 text-amber-300 text-sm font-semibold">Applications are closed for this posting.</p>
          ) : (
            <button onClick={() => setShowApply(true)} className="mt-5 w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">
              Apply now — no account needed
            </button>
          )}
        </>
      ) : (
        <ApplyForm job={job} onBack={() => setShowApply(false)} onClose={onClose} />
      )}
    </Modal>
  );
};

const ApplyForm = ({ job, onBack, onClose }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [coverNote, setCoverNote] = useState('');
  const [resumeFile, setResumeFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [referenceCode, setReferenceCode] = useState('');

  const handleResumeSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Please attach your resume/CV as a PDF file.');
      return;
    }
    setError('');
    setResumeFile(file);
  };

  const submit = async () => {
    if (!name.trim() || !email.trim()) {
      setError('Please provide your name and email.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      let resumeUrl = null;
      let resumePath = null;
      if (resumeFile) {
        const uploaded = await cmmsAnnouncementsService.uploadPublicResume(resumeFile);
        if (!uploaded.success) throw new Error(uploaded.error);
        resumeUrl = uploaded.url;
        resumePath = uploaded.key;
      }

      const result = await cmmsAnnouncementsService.submitPublicJobApplication({
        jobPostingId: job.id,
        applicantName: name.trim(),
        applicantEmail: email.trim(),
        applicantPhone: phone.trim() || null,
        coverNote: coverNote.trim() || null,
        resumeUrl,
        resumePath,
      });
      if (!result.success) throw new Error(result.error);
      setReferenceCode(result.referenceCode);
    } catch (err) {
      setError(err.message || 'Failed to submit your application. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (referenceCode) {
    return (
      <div className="text-center py-4">
        <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-white mb-2">Application submitted!</h3>
        <p className="text-gray-300 text-sm mb-4">Save this reference code to check your status later using the "Track my application" tab.</p>
        <p className="text-2xl font-mono font-bold text-purple-300 tracking-wider bg-white/5 rounded-lg py-3 px-4 inline-block">{referenceCode}</p>
        <button onClick={onClose} className="block mx-auto mt-6 px-5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white">Close</button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4"><ArrowLeft className="w-4 h-4" /> Back</button>
      <h3 className="text-lg font-bold text-white mb-1">Apply for {job.title}</h3>
      <p className="text-sm text-gray-400 mb-4">No account required. You'll receive a reference code to track your application.</p>
      <div className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
        <div className="grid sm:grid-cols-2 gap-3">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number (optional)" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
        </div>
        <textarea value={coverNote} onChange={(e) => setCoverNote(e.target.value)} placeholder="Short cover note (optional)" rows={3} className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
        <label className="block cursor-pointer">
          <span className="inline-flex items-center gap-2 px-3 py-2 rounded bg-white/10 hover:bg-white/20 text-white text-sm">
            <Upload className="w-4 h-4" /> {resumeFile ? resumeFile.name : 'Attach resume/CV (PDF)'}
          </span>
          <input type="file" accept="application/pdf" onChange={handleResumeSelect} className="hidden" />
        </label>
        {error && <p className="text-red-300 text-sm">{error}</p>}
        <button disabled={submitting} onClick={submit} className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold">
          {submitting ? 'Submitting…' : 'Submit application'}
        </button>
      </div>
    </div>
  );
};

const TrackApplication = () => {
  const [referenceCode, setReferenceCode] = useState('');
  const [contact, setContact] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!referenceCode.trim() || !contact.trim()) {
      setError('Enter your reference code and the email or phone you applied with.');
      return;
    }
    setLoading(true);
    setError('');
    setSearched(true);
    const response = await cmmsAnnouncementsService.trackPublicJobApplication(referenceCode.trim(), contact.trim());
    if (!response.success) setError(response.error || 'Something went wrong. Please try again.');
    setResult(response.data || null);
    setLoading(false);
  };

  return (
    <div className="max-w-md mx-auto">
      <h2 className="text-lg font-bold text-white mb-1">Track my application</h2>
      <p className="text-sm text-gray-400 mb-4">Enter the reference code you received, plus the email or phone you applied with.</p>
      <div className="space-y-3">
        <input value={referenceCode} onChange={(e) => setReferenceCode(e.target.value)} placeholder="Reference code (e.g. JOB-A1B2C3D4)" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20 font-mono" />
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or phone used to apply" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
        {error && <p className="text-red-300 text-sm">{error}</p>}
        <button disabled={loading} onClick={search} className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2">
          {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} {loading ? 'Searching…' : 'Check status'}
        </button>
      </div>

      {searched && !loading && (
        result ? (
          <div className="mt-5 glass-card p-4 border border-white/10">
            <p className="text-white font-semibold">{result.job_title}</p>
            <p className="text-xs text-gray-400 mb-3">{result.company_name} · Applied {new Date(result.submitted_at).toLocaleDateString()}</p>
            <span className="inline-block px-3 py-1 rounded-full text-sm font-bold bg-purple-500/20 text-purple-200 capitalize">{result.status.replace('_', ' ')}</span>
            {result.status_note && <p className="text-sm text-gray-300 mt-3">{result.status_note}</p>}
          </div>
        ) : (
          <p className="mt-5 text-center text-gray-500 text-sm">No application found for that reference code and contact. Double-check for typos.</p>
        )
      )}
    </div>
  );
};

const Modal = ({ onClose, children }) => (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 overflow-y-auto">
    <div className="min-h-screen flex items-start justify-center p-4">
      <div className="glass-card w-full max-w-lg p-6 mt-8 border border-white/10 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        {children}
      </div>
    </div>
  </div>
);

export default PublicCompanyNoticeBoard;
