import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, HeartPulse, Loader, Send, ShieldCheck, X, Info } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import {
  WELFARE_CATEGORIES, cancelLeaveRequest, cancelWelfareRequest, getLeaveTypes,
  getMyLeaveBalances, getMyLeaveRequests, getMyProbationStatus, getMyWelfareRequests,
  requestLeave, submitWelfareRequest
} from '../services/cmmsWelfareService';

// Self-contained status-tone palette instead of plain Tailwind color
// utilities -- the app's ThemeContext.jsx repaints several of those stock
// classes (with !important) to a single mapped "primary" color based on
// whichever theme is active, which would otherwise flatten "approved"
// (green), "pending" (amber) and "rejected" (red) into one indistinguishable
// color. None of the welfare- classnames below are stock Tailwind
// utilities, so that override can't reach them -- same fix
// CMMSAnnouncementsPanel's CAP_STYLES and CMMSPayrollPanel's PAYROLL_STYLES
// already use. Defaults to readable tones on the classic ivory surface;
// re-pointed for the dark-background theme presets.
const WELFARE_STYLES = `
.welfare-scope {
  --wf-success-bg: rgba(16, 185, 129, 0.15); --wf-success-text: #047857;
  --wf-info-bg: rgba(14, 165, 233, 0.15); --wf-info-text: #0369a1;
  --wf-warning-bg: rgba(245, 158, 11, 0.15); --wf-warning-text: #b45309;
  --wf-danger-bg: rgba(239, 68, 68, 0.13); --wf-danger-text: #dc2626;
  --wf-neutral-bg: rgba(100, 116, 139, 0.15); --wf-neutral-text: #475569;
}
:root[data-theme="dark"] .welfare-scope, :root[data-theme="purple"] .welfare-scope,
:root[data-theme="green"] .welfare-scope, :root[data-theme="ocean"] .welfare-scope,
:root[data-theme="sienna"] .welfare-scope {
  --wf-success-bg: rgba(16, 185, 129, 0.18); --wf-success-text: #6ee7b7;
  --wf-info-bg: rgba(14, 165, 233, 0.18); --wf-info-text: #7dd3fc;
  --wf-warning-bg: rgba(245, 158, 11, 0.18); --wf-warning-text: #fcd34d;
  --wf-danger-bg: rgba(239, 68, 68, 0.18); --wf-danger-text: #fca5a5;
  --wf-neutral-bg: rgba(148, 163, 184, 0.18); --wf-neutral-text: #cbd5e1;
}
.wf-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: .25rem .65rem; font-size: .7rem; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
.wf-badge-success { background: var(--wf-success-bg); color: var(--wf-success-text); }
.wf-badge-info { background: var(--wf-info-bg); color: var(--wf-info-text); }
.wf-badge-warning { background: var(--wf-warning-bg); color: var(--wf-warning-text); }
.wf-badge-danger { background: var(--wf-danger-bg); color: var(--wf-danger-text); }
.wf-badge-neutral { background: var(--wf-neutral-bg); color: var(--wf-neutral-text); }
.wf-tile { border-radius: 10px; border: 1px solid rgba(196, 160, 82, 0.26); padding: .75rem; }
:root[data-theme="dark"] .welfare-scope .wf-tile, :root[data-theme="purple"] .welfare-scope .wf-tile,
:root[data-theme="green"] .welfare-scope .wf-tile, :root[data-theme="ocean"] .welfare-scope .wf-tile,
:root[data-theme="sienna"] .welfare-scope .wf-tile { border-color: var(--color-border); }
.wf-field { margin-top: .25rem; width: 100%; }
`;

const STATUS_TONE = {
  pending: 'warning', submitted: 'warning', approved: 'success', resolved: 'success', confirmed: 'success',
  rejected: 'danger', declined: 'danger', terminated: 'danger',
  cancelled: 'neutral', in_review: 'info', on_probation: 'info', extended: 'warning'
};
const StatusBadge = ({ status }) => <span className={`wf-badge wf-badge-${STATUS_TONE[status] || 'neutral'}`}>{(status || '').replace(/_/g, ' ')}</span>;

const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

// Collapsed by default -- opens only when tapped -- so "My welfare" reads as
// three labeled headers on a phone instead of every leave-type row, every
// past request, and two open forms all stacked and visible at once. Same
// accordion pattern as CMMSPayrollPanel's CollapsibleSection.
function CollapsibleSection({ title, subtitle, icon, badge, accent, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const [info, setInfo] = useState(false);
  const bodyId = useRef(`sec-${Math.random().toString(36).slice(2)}`).current;
  const toggle = () => setOpen(o => !o);
  return (
    <section className={`cmms-sec cmms-accent-${accent || (/^Probation/.test(title) ? 'navy' : /^Leave/.test(title) ? 'emerald' : 'plum')}`} data-open={open}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-3 text-left !bg-transparent"
          style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
          <span className="cmms-medallion">{icon}</span>
          <span className="cmms-classic-heading cmms-sec-title min-w-0">{title}</span>
        </button>
        {badge && <span className="flex-shrink-0">{badge}</span>}
        {subtitle && (
          <button type="button" onClick={() => setInfo(v => !v)} aria-expanded={info} aria-label={`About ${title}`} title="What is this?" className="cmms-info-btn">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        <button type="button" onClick={toggle} tabIndex={-1} aria-hidden="true" className="flex-shrink-0 !bg-transparent" style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
          <ChevronDown className={`h-4 w-4 cmms-classic-muted transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {info && subtitle && <p className="cmms-info cmms-classic-muted">{subtitle}</p>}
      {open && <div id={bodyId} className="cmms-sec-body mt-4">{children}</div>}
    </section>
  );
}

// Employee-facing HR self-service: leave balances & requests, probation
// status (read-only — HR decides outcomes from the admin welfare screen),
// and a general request form for anything else HR handles for staff
// wellbeing. See backend/CMMS_EMPLOYEE_WELFARE_SYSTEM.sql.
export default function CMMSEmployeeWelfare({ companyProfile, bare = false }) {
  const companyId = companyProfile?.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [probation, setProbation] = useState(null);
  const [welfareRequests, setWelfareRequests] = useState([]);
  const [busy, setBusy] = useState(false);

  const [leaveForm, setLeaveForm] = useState({ leave_type_id: '', start_date: '', end_date: '', reason: '', document_url: '' });
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [welfareForm, setWelfareForm] = useState({ category: WELFARE_CATEGORIES[0].id, subject: '', description: '', is_confidential: false });
  const [showWelfareForm, setShowWelfareForm] = useState(false);

  const loadAll = async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user?.id) { setError('Sign in to view your welfare records.'); setLoading(false); return; }
    const [typesRes, balancesRes, leaveRes, probationRes, welfareRes] = await Promise.all([
      getLeaveTypes(companyId), getMyLeaveBalances(companyId), getMyLeaveRequests(companyId),
      getMyProbationStatus(companyId), getMyWelfareRequests(companyId)
    ]);
    setLeaveTypes(typesRes.data || []);
    setBalances(balancesRes.data || []);
    setLeaveRequests(leaveRes.data || []);
    setProbation(probationRes.data || null);
    setWelfareRequests(welfareRes.data || []);
    setError(typesRes.error?.message || balancesRes.error?.message || leaveRes.error?.message || '');
    setLoading(false);
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  const say = (text, bad = false) => { setNotice(bad ? '' : text); setError(bad ? text : ''); };

  const submitLeave = async (e) => {
    e.preventDefault();
    if (!leaveForm.leave_type_id || !leaveForm.start_date || !leaveForm.end_date) { say('Choose a leave type and both dates.', true); return; }
    setBusy(true); say('');
    const result = await requestLeave(companyId, {
      leaveTypeId: leaveForm.leave_type_id, startDate: leaveForm.start_date, endDate: leaveForm.end_date,
      reason: leaveForm.reason, documentUrl: leaveForm.document_url || null
    });
    if (result.success) {
      say('Leave request submitted — waiting for a decision.');
      setLeaveForm({ leave_type_id: '', start_date: '', end_date: '', reason: '', document_url: '' });
      setShowLeaveForm(false);
      await loadAll();
    } else say(result.error, true);
    setBusy(false);
  };

  const withdrawLeave = async (id) => {
    setBusy(true); say('');
    const result = await cancelLeaveRequest(id);
    if (result.success) { say('Leave request cancelled.'); await loadAll(); } else say(result.error, true);
    setBusy(false);
  };

  const submitWelfare = async (e) => {
    e.preventDefault();
    if (!welfareForm.subject.trim() || !welfareForm.description.trim()) { say('Add a subject and a short description.', true); return; }
    setBusy(true); say('');
    const result = await submitWelfareRequest(companyId, welfareForm);
    if (result.success) {
      say('Request sent to HR.');
      setWelfareForm({ category: WELFARE_CATEGORIES[0].id, subject: '', description: '', is_confidential: false });
      setShowWelfareForm(false);
      await loadAll();
    } else say(result.error, true);
    setBusy(false);
  };

  const withdrawWelfare = async (id) => {
    setBusy(true); say('');
    const result = await cancelWelfareRequest(id);
    if (result.success) { say('Request withdrawn.'); await loadAll(); } else say(result.error, true);
    setBusy(false);
  };

  if (loading) return (
    <div className="welfare-scope flex items-center gap-2 cmms-classic-card p-6 text-sm cmms-classic-muted">
      <style>{WELFARE_STYLES}</style>
      <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading your welfare records…
    </div>
  );

  return (
    <div className="welfare-scope">
      <style>{WELFARE_STYLES}</style>
      <div className={bare ? '' : 'cmms-classic-divider'}>
        {!bare && <div className="flex items-center gap-3">
          <HeartPulse className="h-6 w-6" style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
          <div>
            <h2 className="cmms-classic-heading text-xl">My welfare</h2>
            <p className="cmms-classic-muted text-sm">Leave, probation status, and HR requests — only your own records.</p>
          </div>
        </div>}
        {notice && <p className="mt-1 wf-badge wf-badge-success !rounded-lg !px-3 !py-2 !text-sm !normal-case" role="status">{notice}</p>}
        {error && <p className="mt-3 wf-badge wf-badge-danger !rounded-lg !px-3 !py-2 !text-sm !normal-case" role="alert">{error}</p>}
      </div>

      {probation && (
        <CollapsibleSection
          title="Probation status"
          icon={<ShieldCheck className="h-5 w-5" style={{ color: 'var(--wf-info-text)' }} aria-hidden="true" />}
          badge={<StatusBadge status={probation.status} />}
          defaultOpen={false}
        >
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={probation.status} />
            <span className="cmms-classic-muted">Started {fmtDate(probation.start_date)} · {probation.status === 'terminated' ? 'ended' : 'review by'} {fmtDate(probation.probation_end_date)}</span>
          </div>
          {probation.outcome_note && <p className="mt-2 cmms-classic-muted text-xs">HR note: {probation.outcome_note}</p>}
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title={`Leave balances (${new Date().getFullYear()})`}
        icon={<CalendarDays className="h-4 w-4" style={{ color: 'var(--color-primary)' }} aria-hidden="true" />}
        defaultOpen={false}
      >
        <button type="button" onClick={() => setShowLeaveForm((v) => !v)} className="cmms-classic-btn-primary px-3 py-1.5 text-xs mb-3" aria-expanded={showLeaveForm}>
          {showLeaveForm ? 'Close' : '+ Request leave'}
        </button>

        {balances.length > 0 && (
          <dl className="cmms-field-list mt-3">
            {balances.map((b) => (
              <div key={b.leave_type_id} className="cmms-field-row">
                <dt>{b.name}</dt>
                <dd>{Number(b.remaining_days).toLocaleString()} <span className="cmms-classic-muted font-normal">of {b.entitled_days > 0 ? Number(b.entitled_days).toLocaleString() : '∞'} days</span>{!b.is_paid && <span className="ml-2 text-xs" style={{ color: 'var(--wf-warning-text)' }}>Unpaid</span>}</dd>
              </div>
            ))}
          </dl>
        )}

        {showLeaveForm && (
          <form onSubmit={submitLeave} className="mt-4 space-y-2 cmms-classic-divider">
            <select required value={leaveForm.leave_type_id} onChange={(e) => setLeaveForm((v) => ({ ...v, leave_type_id: e.target.value }))} className="wf-field">
              <option value="">Select leave type…</option>
              {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}{t.requires_document ? ' (supporting document recommended)' : ''}</option>)}
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="cmms-classic-muted text-xs">Start date
                <input required type="date" value={leaveForm.start_date} onChange={(e) => setLeaveForm((v) => ({ ...v, start_date: e.target.value }))} className="wf-field" />
              </label>
              <label className="cmms-classic-muted text-xs">End date
                <input required type="date" min={leaveForm.start_date || undefined} value={leaveForm.end_date} onChange={(e) => setLeaveForm((v) => ({ ...v, end_date: e.target.value }))} className="wf-field" />
              </label>
            </div>
            <textarea value={leaveForm.reason} onChange={(e) => setLeaveForm((v) => ({ ...v, reason: e.target.value }))} placeholder="Reason (optional)" rows={2} className="wf-field" />
            <input value={leaveForm.document_url} onChange={(e) => setLeaveForm((v) => ({ ...v, document_url: e.target.value }))} placeholder="Supporting document link (optional)" className="wf-field" type="text" />
            <button disabled={busy} className="cmms-classic-btn-primary flex items-center gap-2 px-3 py-2 text-sm"><Send className="h-4 w-4" aria-hidden="true" /> {busy ? 'Submitting…' : 'Submit request'}</button>
          </form>
        )}

        <div className="mt-4 space-y-2">
          {leaveRequests.length === 0 ? <p className="cmms-classic-muted text-sm">No leave requests yet.</p> : leaveRequests.map((r) => (
            <div key={r.id} className="wf-tile flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <p className="cmms-classic-heading font-semibold">{fmtDate(r.start_date)} – {fmtDate(r.end_date)} <span className="cmms-classic-muted text-xs font-normal">({r.total_days} day{r.total_days === 1 ? '' : 's'})</span></p>
                {r.reason && <p className="cmms-classic-muted mt-0.5 text-xs">{r.reason}</p>}
                {r.decision_note && <p className="cmms-classic-muted mt-0.5 text-xs">HR note: {r.decision_note}</p>}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={r.status} />
                {(r.status === 'pending' || (r.status === 'approved' && new Date(r.start_date) > new Date())) && (
                  <button type="button" disabled={busy} onClick={() => withdrawLeave(r.id)} className="cmms-classic-btn-secondary p-1.5" aria-label="Cancel leave request" title="Cancel"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="HR & wellbeing requests"
        icon={<HeartPulse className="h-4 w-4" aria-hidden="true" />}
        subtitle="Grievances, wellness & counseling support, flexible work, training sponsorship, medical or bereavement assistance."
        defaultOpen={false}
      >
        <button type="button" onClick={() => setShowWelfareForm((v) => !v)} className="cmms-classic-btn-primary px-3 py-1.5 text-xs mb-3" aria-expanded={showWelfareForm}>
          {showWelfareForm ? 'Close' : '+ New request'}
        </button>

        {showWelfareForm && (
          <form onSubmit={submitWelfare} className="mt-4 space-y-2 cmms-classic-divider">
            <select value={welfareForm.category} onChange={(e) => setWelfareForm((v) => ({ ...v, category: e.target.value }))} className="wf-field">
              {WELFARE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <input required value={welfareForm.subject} onChange={(e) => setWelfareForm((v) => ({ ...v, subject: e.target.value }))} placeholder="Subject" className="wf-field" type="text" />
            <textarea required value={welfareForm.description} onChange={(e) => setWelfareForm((v) => ({ ...v, description: e.target.value }))} placeholder="Describe your request…" rows={3} className="wf-field" />
            <label className="flex items-center gap-2 cmms-classic-muted text-xs">
              <input type="checkbox" checked={welfareForm.is_confidential} onChange={(e) => setWelfareForm((v) => ({ ...v, is_confidential: e.target.checked }))} />
              Keep this confidential (visible to HR only)
            </label>
            <button disabled={busy} className="cmms-classic-btn-primary flex items-center gap-2 px-3 py-2 text-sm"><Send className="h-4 w-4" aria-hidden="true" /> {busy ? 'Sending…' : 'Send to HR'}</button>
          </form>
        )}

        <div className="mt-4 space-y-2">
          {welfareRequests.length === 0 ? <p className="cmms-classic-muted text-sm">No requests yet.</p> : welfareRequests.map((r) => (
            <div key={r.id} className="wf-tile text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="cmms-classic-heading font-semibold">{r.subject} <span className="cmms-classic-muted text-xs font-normal capitalize">· {WELFARE_CATEGORIES.find((c) => c.id === r.category)?.label || r.category}</span></p>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {r.status === 'submitted' && <button type="button" disabled={busy} onClick={() => withdrawWelfare(r.id)} className="cmms-classic-btn-secondary p-1.5" aria-label="Withdraw request" title="Withdraw"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>}
                </div>
              </div>
              <p className="cmms-classic-muted mt-1 text-xs">{r.description}</p>
              {r.response && <p className="mt-1 text-xs" style={{ color: 'var(--wf-success-text)' }}>HR response: {r.response}</p>}
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
}
