import React, { useEffect, useState } from 'react';
import {
  Megaphone, Briefcase, MapPin, Calendar, Users, FileText, X, Loader,
  AlertCircle, CheckCircle2, Search, Building2, ArrowLeft, Upload, Share2,
  Check, ChevronRight, Clock
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

// Status chips read off the "how far along" scale rather than fixed colors
// per status, so the palette stays inside the green/maroon/neutral brand
// instead of the old ad-hoc slate/amber/blue/violet/red mix.
const STATUS_STYLES = {
  submitted: 'nb-chip-neutral',
  under_review: 'nb-chip-amber',
  shortlisted: 'nb-chip-teal',
  interview: 'nb-chip-green',
  hired: 'nb-chip-green-solid',
  rejected: 'nb-chip-maroon',
  withdrawn: 'nb-chip-neutral nb-chip-faded',
};

// Scoped CSS variables (light by default, swapped under prefers-color-scheme)
// so this page renders identically whether an applicant's device is in light
// or dark mode -- and, crucially, so it never gets caught by the app-wide
// dynamic theme override in ThemeContext.jsx, which repaints any element
// using stock Tailwind slate/indigo/violet classes. None of the classnames
// below are stock Tailwind color utilities, so that override can't touch
// them; this file owns its own light/dark palette instead.
const NB_STYLES = `
.icanera-nb {
  --nb-bg: #f6f9f7;
  --nb-surface: #ffffff;
  --nb-surface-alt: #eef3f0;
  --nb-surface-alt-hover: #e2ebe4;
  --nb-text: #16211b;
  --nb-text-muted: #56675d;
  --nb-text-faint: #8a9a90;
  --nb-border: #dbe6de;
  --nb-border-strong: #c3d3c8;
  --nb-green: #166534;
  --nb-green-hover: #114f28;
  --nb-green-soft-bg: #e3f3e8;
  --nb-green-soft-text: #166534;
  --nb-green-solid-text: #ffffff;
  --nb-teal-soft-bg: #e1f2ef;
  --nb-teal-soft-text: #0f5c52;
  --nb-maroon: #7a1f2b;
  --nb-maroon-hover: #5f1721;
  --nb-maroon-soft-bg: #f5e6e7;
  --nb-maroon-soft-text: #7a1f2b;
  --nb-amber-soft-bg: #faf1da;
  --nb-amber-soft-text: #8a5a12;
  --nb-backdrop: rgba(15, 23, 18, 0.55);
}
@media (prefers-color-scheme: dark) {
  .icanera-nb {
    --nb-bg: #0f1613;
    --nb-surface: #17211c;
    --nb-surface-alt: #202b24;
    --nb-surface-alt-hover: #2a362e;
    --nb-text: #eef4f0;
    --nb-text-muted: #a9baaf;
    --nb-text-faint: #7c8d82;
    --nb-border: #2b3830;
    --nb-border-strong: #3a4a40;
    --nb-green: #4ade80;
    --nb-green-hover: #22c55e;
    --nb-green-soft-bg: #163524;
    --nb-green-soft-text: #86efac;
    --nb-green-solid-text: #0f1613;
    --nb-teal-soft-bg: #123330;
    --nb-teal-soft-text: #7dd3c0;
    --nb-maroon: #e5828d;
    --nb-maroon-hover: #f0a1a9;
    --nb-maroon-soft-bg: #3a1a1e;
    --nb-maroon-soft-text: #f3a9b0;
    --nb-amber-soft-bg: #3a2f13;
    --nb-amber-soft-text: #f4c86a;
    --nb-backdrop: rgba(0, 0, 0, 0.65);
  }
}
.icanera-nb { background: var(--nb-bg); color: var(--nb-text); }
.nb-surface { background: var(--nb-surface); }
.nb-surface-alt { background: var(--nb-surface-alt); }
.nb-text { color: var(--nb-text); }
.nb-text-muted { color: var(--nb-text-muted); }
.nb-text-faint { color: var(--nb-text-faint); }
.nb-border { border-color: var(--nb-border); }
.nb-border-strong { border-color: var(--nb-border-strong); }
.nb-header { background: color-mix(in srgb, var(--nb-surface) 92%, transparent); border-color: var(--nb-border); }
.nb-card { background: var(--nb-surface); border: 1px solid var(--nb-border); }
.nb-card:hover { border-color: var(--nb-green); }
.nb-tab { color: var(--nb-text-muted); border-color: transparent; }
.nb-tab:hover { color: var(--nb-text); }
.nb-tab-active { color: var(--nb-green); border-color: var(--nb-green); }
.nb-icon-box { background: var(--nb-surface-alt); }
.nb-icon-muted { color: var(--nb-text-faint); }
.nb-btn-primary { background: var(--nb-green); color: #ffffff; }
.nb-btn-primary:hover { background: var(--nb-green-hover); }
.nb-btn-secondary { background: var(--nb-surface-alt); color: var(--nb-text); }
.nb-btn-secondary:hover { background: var(--nb-surface-alt-hover); }
.nb-link { color: var(--nb-green); }
.nb-link:hover { color: var(--nb-green-hover); }
.nb-input { background: var(--nb-surface); color: var(--nb-text); border: 1px solid var(--nb-border-strong); }
.nb-input::placeholder { color: var(--nb-text-faint); }
.nb-input:focus { outline: none; border-color: var(--nb-green); box-shadow: 0 0 0 4px var(--nb-green-soft-bg); }
.nb-modal-backdrop { background: var(--nb-backdrop); }
.nb-chip-neutral { background: var(--nb-surface-alt); color: var(--nb-text-muted); }
.nb-chip-faded { opacity: 0.75; }
.nb-chip-green { background: var(--nb-green-soft-bg); color: var(--nb-green-soft-text); }
.nb-chip-green-solid { background: var(--nb-green); color: var(--nb-green-solid-text); }
.nb-chip-teal { background: var(--nb-teal-soft-bg); color: var(--nb-teal-soft-text); }
.nb-chip-maroon { background: var(--nb-maroon-soft-bg); color: var(--nb-maroon-soft-text); }
.nb-chip-amber { background: var(--nb-amber-soft-bg); color: var(--nb-amber-soft-text); }
.nb-accent-top { background: linear-gradient(90deg, var(--nb-green), var(--nb-maroon)); }
.nb-wordmark-a { color: var(--nb-text-muted); }
.nb-wordmark-b { color: var(--nb-green); }
.nb-copied { background: var(--nb-green-soft-bg); color: var(--nb-green-soft-text); }
.nb-share-btn { background: var(--nb-surface-alt); color: var(--nb-text-muted); }
.nb-share-btn:hover { background: var(--nb-surface-alt-hover); }
.nb-closed-banner { background: var(--nb-amber-soft-bg); color: var(--nb-amber-soft-text); }
.nb-error-text { color: var(--nb-maroon); }
.nb-empty-icon { background: var(--nb-surface-alt); color: var(--nb-text-faint); }
`;

/**
 * The company's public notice board -- no ICAN account required. Rendered
 * from main.jsx for /notices/:companyId, same "share link needs no login"
 * pattern as PublicPitchViewer/PublicDropshipStorefront. It uses its own
 * scoped light/dark palette (see NB_STYLES above, keyed to the visitor's OS
 * color scheme) rather than the app's ThemeContext -- a careers/notice board
 * needs to read as a trustworthy business page in whatever mode the visitor
 * already has set, not swap between ICAN's in-app theme choices. Job
 * applications are submitted here directly (not gated behind a sign-in
 * prompt) since the whole point is that applicants never need an account.
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
      <div className="icanera-nb min-h-screen flex items-center justify-center">
        <style>{NB_STYLES}</style>
        <Loader className="w-8 h-8 nb-link animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="icanera-nb min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center animate-fadeIn">
        <style>{NB_STYLES}</style>
        <div className="w-16 h-16 rounded-2xl nb-icon-box flex items-center justify-center">
          <AlertCircle className="w-8 h-8 nb-icon-muted" />
        </div>
        <p className="nb-text text-lg font-semibold">This notice board isn't available</p>
        <button
          onClick={goToApp}
          className="px-5 py-2.5 nb-btn-primary rounded-xl font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm"
        >
          Open IcanEra
        </button>
      </div>
    );
  }

  return (
    <div className="icanera-nb min-h-screen">
      <style>{NB_STYLES}</style>
      <header className="border-b nb-header backdrop-blur sticky top-0 z-20 animate-fadeInDown">
        <div className="h-1 nb-accent-top" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 pb-2 flex items-center gap-3.5">
          {company.logo_url ? (
            <img src={company.logo_url} alt={company.company_name} className="w-12 h-12 rounded-xl object-cover border nb-border shadow-sm flex-shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-xl nb-btn-primary flex items-center justify-center font-bold text-lg shadow-sm flex-shrink-0">
              {company.company_name?.charAt(0)?.toUpperCase() || <Building2 className="w-6 h-6" />}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-extrabold tracking-tight nb-text truncate">{company.company_name}</h1>
            <p className="text-xs nb-text-faint truncate">
              {[company.industry, company.location].filter(Boolean).join(' · ') || 'Notice board'}
            </p>
          </div>
          <span className="text-[11px] nb-text-faint nb-surface-alt px-2.5 py-1 rounded-full hidden sm:block flex-shrink-0">
            via <IcanEraWordmark />
          </span>
        </div>
        <nav className="max-w-5xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
          {[
            { id: 'notices', label: 'Notices', icon: Megaphone },
            { id: 'careers', label: 'Careers', icon: Briefcase },
            { id: 'track', label: 'Track my application', icon: Search },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSection(tab.id)}
              className={`px-3.5 sm:px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 border-b-2 whitespace-nowrap transition-colors ${section === tab.id ? 'nb-tab-active' : 'nb-tab'}`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-7">
        <div key={section} className="animate-fadeInUp" style={{ animationDuration: '0.35s' }}>
          {section === 'notices' && (
            <NoticeList notices={notices} onSelect={(notice) => openDetail(notice, setSelectedNotice)} />
          )}
          {section === 'careers' && (
            <JobList jobs={jobs} onSelect={(job) => openDetail(job, setSelectedJob)} />
          )}
          {section === 'track' && <TrackApplication />}
        </div>
      </main>

      <footer className="text-center text-xs nb-text-faint pb-8 pt-2">
        Powered by{' '}
        <button onClick={goToApp} className="align-middle hover:opacity-80 transition-opacity">
          <IcanEraWordmark />
        </button>
      </footer>

      {selectedNotice && <NoticeDetailModal notice={selectedNotice} onClose={() => setSelectedNotice(null)} onShare={handleShare} />}
      {selectedJob && <JobDetailModal job={selectedJob} onClose={() => setSelectedJob(null)} onShare={handleShare} />}
    </div>
  );
};

// The brand name is "IcanEra" (capital I/E, lowercase elsewhere) everywhere
// else in the app -- LandingPage.jsx, MainNavigation's logo alt text, etc.
// A two-tone treatment (rather than plain gray text) reads as a proper
// wordmark instead of an afterthought footer credit.
const IcanEraWordmark = () => (
  <span className="font-bold tracking-tight">
    <span className="nb-wordmark-a">Ican</span><span className="nb-wordmark-b">Era</span>
  </span>
);

const EmptyState = ({ icon: Icon, text }) => (
  <div className="text-center py-20 animate-fadeIn">
    <div className="w-14 h-14 rounded-2xl nb-empty-icon flex items-center justify-center mx-auto mb-4">
      <Icon className="w-7 h-7" />
    </div>
    <p className="nb-text-muted text-sm">{text}</p>
  </div>
);

const NoticeList = ({ notices, onSelect }) => {
  if (notices.length === 0) {
    return <EmptyState icon={Megaphone} text="No public notices right now. Check back later." />;
  }
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
      {notices.map((notice, i) => (
        <button
          key={notice.id}
          onClick={() => onSelect(notice)}
          style={{ animationDelay: `${Math.min(i, 8) * 60}ms`, animationFillMode: 'backwards' }}
          className="group text-left nb-card rounded-2xl shadow-sm overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 animate-fadeInUp"
        >
          <div className="aspect-video w-full overflow-hidden nb-surface-alt">
            {notice.poster_url ? (
              <img src={notice.poster_url} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Megaphone className="w-8 h-8 nb-icon-muted" />
              </div>
            )}
          </div>
          <div className="p-4">
            <h3 className="font-bold nb-text line-clamp-2">{notice.title}</h3>
            {notice.summary && <p className="text-sm nb-text-muted mt-1 line-clamp-2">{notice.summary}</p>}
            <p className="text-xs nb-text-faint mt-3 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {notice.published_at ? new Date(notice.published_at).toLocaleDateString() : ''}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
};

const JobList = ({ jobs, onSelect }) => {
  if (jobs.length === 0) {
    return <EmptyState icon={Briefcase} text="No open positions right now. Check back later." />;
  }
  return (
    <div className="space-y-3">
      {jobs.map((job, i) => (
        <button
          key={job.id}
          onClick={() => onSelect(job)}
          style={{ animationDelay: `${Math.min(i, 8) * 60}ms`, animationFillMode: 'backwards' }}
          className="group w-full text-left nb-card rounded-2xl shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-4 p-4 animate-fadeInUp"
        >
          {job.poster_url ? (
            <img src={job.poster_url} alt="" className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-xl flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl nb-chip-green flex items-center justify-center flex-shrink-0">
              <Briefcase className="w-7 h-7" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold nb-text line-clamp-1">{job.title}</h3>
            {job.summary && <p className="text-sm nb-text-muted line-clamp-1">{job.summary}</p>}
            <div className="flex flex-wrap gap-2 mt-2">
              {job.employment_type && (
                <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-green">
                  {EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}
                </span>
              )}
              {job.location && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-neutral">
                  <MapPin className="w-3 h-3" /> {job.location}
                </span>
              )}
              {job.application_deadline && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-amber">
                  <Calendar className="w-3 h-3" /> Apply by {job.application_deadline}
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="w-5 h-5 nb-icon-muted flex-shrink-0 transition-transform duration-300 group-hover:translate-x-1" />
        </button>
      ))}
    </div>
  );
};

const NoticeDetailModal = ({ notice, onClose, onShare }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Modal onClose={onClose}>
      {notice.poster_url && <img src={notice.poster_url} alt="" className="w-full max-h-72 object-cover rounded-xl mb-4" />}
      <div className="flex items-start justify-between gap-3 mb-2">
        <h2 className="text-xl font-bold nb-text">{notice.title}</h2>
        <ShareButton copied={copied} onClick={() => onShare(notice, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); })} />
      </div>
      <p className="text-xs nb-text-faint mb-4 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {notice.published_at ? new Date(notice.published_at).toLocaleString() : ''}</p>
      <p className="nb-text-muted whitespace-pre-wrap leading-relaxed">{notice.body}</p>
      {notice.document_url && (
        <a href={notice.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-5 nb-link text-sm font-semibold">
          <FileText className="w-4 h-4" /> View attached document (PDF)
        </a>
      )}
    </Modal>
  );
};

const ShareButton = ({ copied, onClick }) => (
  <button
    onClick={onClick}
    className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${copied ? 'nb-copied' : 'nb-share-btn'}`}
    title="Share"
  >
    {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Share2 className="w-3.5 h-3.5" /> Share</>}
  </button>
);

const JobDetailModal = ({ job, onClose, onShare }) => {
  const [showApply, setShowApply] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <Modal onClose={onClose}>
      {!showApply ? (
        <>
          {job.poster_url && <img src={job.poster_url} alt="" className="w-full max-h-64 object-cover rounded-xl mb-4" />}
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-xl font-bold nb-text">{job.title}</h2>
            <ShareButton copied={copied} onClick={() => onShare(job, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); })} />
          </div>
          <div className="flex flex-wrap gap-2 mb-4 mt-2">
            {job.location && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-neutral">
                <MapPin className="w-3 h-3" /> {job.location}
              </span>
            )}
            {job.employment_type && (
              <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-green">
                {EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}
              </span>
            )}
            {job.positions_available && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-neutral">
                <Users className="w-3 h-3" /> {job.positions_available} position{job.positions_available === 1 ? '' : 's'}
              </span>
            )}
            {job.salary_range && (
              <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-green">
                {job.salary_range}
              </span>
            )}
            {job.application_deadline && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full nb-chip-amber">
                <Calendar className="w-3 h-3" /> Apply by {job.application_deadline}
              </span>
            )}
          </div>
          <p className="nb-text-muted whitespace-pre-wrap leading-relaxed">{job.body}</p>
          {job.application_instructions && (
            <div className="mt-4 p-3.5 rounded-xl nb-surface-alt border nb-border text-sm nb-text-muted">
              <p className="font-semibold nb-text mb-1">How to apply</p>
              {job.application_instructions}
            </div>
          )}
          {job.document_url && (
            <a href={job.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-4 nb-link text-sm font-semibold">
              <FileText className="w-4 h-4" /> Full job description (PDF)
            </a>
          )}
          {job.is_open === false ? (
            <p className="mt-6 nb-closed-banner rounded-lg px-4 py-2.5 text-sm font-semibold text-center">Applications are closed for this posting.</p>
          ) : (
            <button
              onClick={() => setShowApply(true)}
              className="mt-6 w-full py-3 rounded-xl nb-btn-primary font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-sm"
            >
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

  const inputClass = 'w-full px-3.5 py-2.5 rounded-xl nb-input transition';

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
      <div className="text-center py-4 animate-fadeIn">
        <div className="w-16 h-16 rounded-full nb-chip-green flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-9 h-9" />
        </div>
        <h3 className="text-lg font-bold nb-text mb-2">Application submitted!</h3>
        <p className="nb-text-muted text-sm mb-4">Save this reference code to check your status later using the "Track my application" tab.</p>
        <p className="text-2xl font-mono font-bold nb-link tracking-wider nb-chip-green rounded-xl py-3 px-4 inline-block">{referenceCode}</p>
        <button onClick={onClose} className="block mx-auto mt-6 px-5 py-2.5 rounded-xl nb-btn-secondary font-semibold transition">Close</button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm nb-text-muted hover:opacity-80 mb-4 transition-colors"><ArrowLeft className="w-4 h-4" /> Back</button>
      <h3 className="text-lg font-bold nb-text mb-1">Apply for {job.title}</h3>
      <p className="text-sm nb-text-muted mb-4">No account required. You'll receive a reference code to track your application.</p>
      <div className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={inputClass} />
        <div className="grid sm:grid-cols-2 gap-3">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className={inputClass} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number (optional)" className={inputClass} />
        </div>
        <textarea value={coverNote} onChange={(e) => setCoverNote(e.target.value)} placeholder="Short cover note (optional)" rows={3} className={inputClass} />
        <label className="flex items-center justify-center gap-2 border-2 border-dashed nb-border-strong rounded-xl p-4 text-center cursor-pointer transition hover:border-current">
          <Upload className="w-4 h-4 nb-text-muted" />
          <span className="text-sm nb-text-muted">{resumeFile ? resumeFile.name : 'Attach resume/CV (PDF)'}</span>
          <input type="file" accept="application/pdf" onChange={handleResumeSelect} className="hidden" />
        </label>
        {error && <p className="nb-error-text text-sm">{error}</p>}
        <button
          disabled={submitting}
          onClick={submit}
          className="w-full py-3 rounded-xl nb-btn-primary disabled:opacity-50 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-sm"
        >
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

  const inputClass = 'w-full px-3.5 py-2.5 rounded-xl nb-input transition';

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
      <h2 className="text-xl font-bold nb-text mb-1">Track my application</h2>
      <p className="text-sm nb-text-muted mb-5">Enter the reference code you received, plus the email or phone you applied with.</p>
      <div className="space-y-3">
        <input value={referenceCode} onChange={(e) => setReferenceCode(e.target.value)} placeholder="Reference code (e.g. JOB-A1B2C3D4)" className={`${inputClass} font-mono`} />
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or phone used to apply" className={inputClass} />
        {error && <p className="nb-error-text text-sm">{error}</p>}
        <button
          disabled={loading}
          onClick={search}
          className="w-full py-3 rounded-xl nb-btn-primary disabled:opacity-50 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-sm flex items-center justify-center gap-2"
        >
          {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} {loading ? 'Searching…' : 'Check status'}
        </button>
      </div>

      {searched && !loading && (
        result ? (
          <div className="mt-5 nb-card rounded-2xl shadow-sm p-4 animate-fadeInUp">
            <p className="nb-text font-semibold">{result.job_title}</p>
            <p className="text-xs nb-text-faint mb-3">{result.company_name} · Applied {new Date(result.submitted_at).toLocaleDateString()}</p>
            <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold capitalize ${STATUS_STYLES[result.status] || STATUS_STYLES.submitted}`}>
              {result.status.replace('_', ' ')}
            </span>
            {result.status_note && <p className="text-sm nb-text-muted mt-3">{result.status_note}</p>}
          </div>
        ) : (
          <p className="mt-5 text-center nb-text-faint text-sm animate-fadeIn">No application found for that reference code and contact. Double-check for typos.</p>
        )
      )}
    </div>
  );
};

// Fades the backdrop in immediately but scales+fades the panel itself in a
// beat later via a mount-triggered class flip -- purely CSS transitions, no
// animation library, matching the rest of this component.
const Modal = ({ onClose, children }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`icanera-nb fixed inset-0 nb-modal-backdrop backdrop-blur-sm z-50 overflow-y-auto transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div
        className="min-h-screen flex items-start justify-center p-4"
        style={{ paddingBottom: 'max(4rem, calc(env(safe-area-inset-bottom) + 2rem))' }}
      >
        <div
          className={`nb-surface w-full max-w-lg p-6 my-8 rounded-2xl shadow-2xl border nb-border relative transition-all duration-200 ${visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'}`}
        >
          <button onClick={onClose} className="absolute top-4 right-4 nb-text-faint hover:opacity-80 transition-colors p-1 rounded-full nb-share-btn">
            <X className="w-5 h-5" />
          </button>
          {children}
        </div>
      </div>
    </div>
  );
};

export default PublicCompanyNoticeBoard;
