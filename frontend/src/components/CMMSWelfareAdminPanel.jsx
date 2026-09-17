import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, HeartPulse, Loader, ShieldCheck } from 'lucide-react';
import {
  WELFARE_CATEGORIES, decideLeaveRequest, decideProbation, getCompanyLeaveRequests,
  getCompanyProbationRecords, getCompanyWelfareRequests, getProbationReviews, getWelfareSummary,
  respondToWelfareRequest, startEmployeeProbation, submitProbationReview
} from '../services/cmmsWelfareService';
import { resolveEmployeeAuthIds } from '../services/businessManagementService';

const STATUS_STYLES = {
  pending: 'bg-amber-500/15 text-amber-300', submitted: 'bg-amber-500/15 text-amber-300',
  approved: 'bg-emerald-500/15 text-emerald-300', resolved: 'bg-emerald-500/15 text-emerald-300', confirmed: 'bg-emerald-500/15 text-emerald-300',
  rejected: 'bg-red-500/15 text-red-300', declined: 'bg-red-500/15 text-red-300', terminated: 'bg-red-500/15 text-red-300',
  cancelled: 'bg-slate-600/30 text-slate-300',
  in_review: 'bg-blue-500/15 text-blue-300', on_probation: 'bg-blue-500/15 text-blue-300', extended: 'bg-amber-500/15 text-amber-300'
};
const StatusBadge = ({ status }) => <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[status] || 'bg-slate-600/30 text-slate-300'}`}>{(status || '').replace(/_/g, ' ')}</span>;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
const person = (row) => row?.cmms_users?.full_name || row?.cmms_users?.email || 'Employee';

// Tailwind's JIT scanner needs whole class names present verbatim in the
// source, so the tone -> classes mapping has to be a static lookup rather
// than a `border-${tone}-800/40` template string (that would silently
// generate no CSS at all).
const SUMMARY_TONES = {
  amber: { border: 'border-amber-800/40', bg: 'bg-amber-950/10', text: 'text-amber-300' },
  blue: { border: 'border-blue-800/40', bg: 'bg-blue-950/10', text: 'text-blue-300' },
  rose: { border: 'border-rose-800/40', bg: 'bg-rose-950/10', text: 'text-rose-300' },
  emerald: { border: 'border-emerald-800/40', bg: 'bg-emerald-950/10', text: 'text-emerald-300' },
  slate: { border: 'border-slate-800', bg: 'bg-slate-950/50', text: 'text-slate-400' }
};
const SummaryCard = ({ label, value, tone = 'slate' }) => {
  const t = SUMMARY_TONES[tone] || SUMMARY_TONES.slate;
  return (
    <div className={`rounded-lg border p-3 ${t.border} ${t.bg}`}>
      <p className={`text-xs uppercase ${t.text}`}>{label}</p>
      <p className="mt-1 text-xl font-bold text-white">{value ?? '—'}</p>
    </div>
  );
};

// HR/admin side of the welfare module — a "Leave & Welfare" sub-tab inside
// Staff Attendance. Deciding anything here requires `canManage` (a full
// admin, or an Attendance role with Manual/Add-days, or Payroll -> Approve —
// see cmms_can_manage_welfare() in backend/CMMS_EMPLOYEE_WELFARE_SYSTEM.sql);
// without it this still renders read-only for a plain Attendance "view" role.
export default function CMMSWelfareAdminPanel({ companyProfile, cmmsUsers = [], canManage = false }) {
  const companyId = companyProfile?.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null);

  const [leaveFilter, setLeaveFilter] = useState('pending');
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [leaveNotes, setLeaveNotes] = useState({});

  const [probationFilter, setProbationFilter] = useState('active');
  const [probationRecords, setProbationRecords] = useState([]);
  const [expandedProbation, setExpandedProbation] = useState(null);
  const [probationReviews, setProbationReviews] = useState([]);
  const [reviewForm, setReviewForm] = useState({ rating: '', strengths: '', areas_for_improvement: '', recommendation: '', comments: '' });
  const [decisionForm, setDecisionForm] = useState({ decision: 'confirmed', new_end_date: '', note: '' });
  const [startForm, setStartForm] = useState({ cmms_user_id: '', duration_value: '3', duration_unit: 'months' });
  const [showStartForm, setShowStartForm] = useState(false);

  const [welfareFilter, setWelfareFilter] = useState('open');
  const [welfareRequests, setWelfareRequests] = useState([]);
  const [responseNotes, setResponseNotes] = useState({});

  // cmms_users_with_roles (what cmmsUsers is loaded from, in CSSModule.jsx)
  // never selects ican_user_id, so every cmmsUsers[].authUserId is null even
  // for employees who genuinely are ICAN-linked -- the "Select employee"
  // dropdown below would otherwise always be empty. resolveEmployeeAuthIds
  // is the same by-email lookup CMMSPayrollPanel.jsx/CMMSMySalaryPanel.jsx
  // already use to work around this exact gap.
  const [resolvedUsers, setResolvedUsers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!cmmsUsers.length) { setResolvedUsers([]); return; }
    resolveEmployeeAuthIds(cmmsUsers).then((resolved) => { if (!cancelled) setResolvedUsers(resolved || []); });
    return () => { cancelled = true; };
  }, [cmmsUsers]);
  const employeesWithAuthId = useMemo(() => {
    const byId = new Map();
    [...cmmsUsers, ...resolvedUsers].filter((u) => u.authUserId).forEach((u) => byId.set(u.authUserId, u));
    return [...byId.values()];
  }, [cmmsUsers, resolvedUsers]);

  const say = (text, bad = false) => { setNotice(bad ? '' : text); setError(bad ? text : ''); };

  const loadSummary = async () => { if (companyId) { const r = await getWelfareSummary(companyId); setSummary(r.data); } };
  const loadLeave = async () => {
    if (!companyId) return;
    const status = leaveFilter === 'all' ? null : leaveFilter;
    const r = await getCompanyLeaveRequests(companyId, status);
    setLeaveRequests(r.data || []);
  };
  const loadProbation = async () => {
    if (!companyId) return;
    const status = probationFilter === 'active' ? null : probationFilter;
    const r = await getCompanyProbationRecords(companyId, status);
    const rows = probationFilter === 'active' ? (r.data || []).filter((p) => ['on_probation', 'extended'].includes(p.status)) : (r.data || []);
    setProbationRecords(rows);
  };
  const loadWelfare = async () => {
    if (!companyId) return;
    // "open" spans two statuses (submitted, in_review), so it can't be
    // pushed down as a single-value DB filter -- fetch everything and
    // narrow client-side for that one case only.
    const dbStatus = welfareFilter === 'all' || welfareFilter === 'open' ? null : welfareFilter;
    const r = await getCompanyWelfareRequests(companyId, dbStatus);
    const rows = welfareFilter === 'open' ? (r.data || []).filter((w) => ['submitted', 'in_review'].includes(w.status)) : (r.data || []);
    setWelfareRequests(rows);
  };

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    Promise.all([loadSummary(), loadLeave(), loadProbation(), loadWelfare()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);
  useEffect(() => { loadLeave(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leaveFilter]);
  useEffect(() => { loadProbation(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [probationFilter]);
  useEffect(() => { loadWelfare(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [welfareFilter]);

  const decideLeave = async (id, decision) => {
    setBusy(true); say('');
    const result = await decideLeaveRequest(id, decision, leaveNotes[id] || null);
    if (result.success) { say(`Leave request ${decision}.`); setLeaveNotes((v) => ({ ...v, [id]: '' })); await Promise.all([loadLeave(), loadSummary()]); }
    else say(result.error, true);
    setBusy(false);
  };

  const toggleProbation = async (id) => {
    if (expandedProbation === id) { setExpandedProbation(null); return; }
    setExpandedProbation(id);
    const r = await getProbationReviews(id);
    setProbationReviews(r.data || []);
  };

  const startProbation = async (e) => {
    e.preventDefault();
    if (!startForm.cmms_user_id) { say('Choose an employee.', true); return; }
    setBusy(true); say('');
    const result = await startEmployeeProbation(companyId, startForm.cmms_user_id, {
      durationValue: Number(startForm.duration_value) || 1, durationUnit: startForm.duration_unit
    });
    if (result.success) { say('Probation started.'); setStartForm({ cmms_user_id: '', duration_value: '3', duration_unit: 'months' }); setShowStartForm(false); await Promise.all([loadProbation(), loadSummary()]); }
    else say(result.error, true);
    setBusy(false);
  };

  const addReview = async (probationId) => {
    setBusy(true); say('');
    const result = await submitProbationReview(probationId, {
      rating: reviewForm.rating ? Number(reviewForm.rating) : null,
      strengths: reviewForm.strengths, areasForImprovement: reviewForm.areas_for_improvement,
      recommendation: reviewForm.recommendation || null, comments: reviewForm.comments
    });
    if (result.success) {
      say('Review recorded.');
      setReviewForm({ rating: '', strengths: '', areas_for_improvement: '', recommendation: '', comments: '' });
      const r = await getProbationReviews(probationId);
      setProbationReviews(r.data || []);
    } else say(result.error, true);
    setBusy(false);
  };

  const decideProbationOutcome = async (probationId) => {
    setBusy(true); say('');
    const result = await decideProbation(probationId, decisionForm.decision, decisionForm.note || null, decisionForm.decision === 'extended' ? decisionForm.new_end_date : null);
    if (result.success) {
      say(`Probation ${decisionForm.decision}.`);
      setDecisionForm({ decision: 'confirmed', new_end_date: '', note: '' });
      setExpandedProbation(null);
      await Promise.all([loadProbation(), loadSummary()]);
    } else say(result.error, true);
    setBusy(false);
  };

  const respondWelfare = async (id, status) => {
    setBusy(true); say('');
    const result = await respondToWelfareRequest(id, status, responseNotes[id] || null);
    if (result.success) { say('Response saved.'); setResponseNotes((v) => ({ ...v, [id]: '' })); await Promise.all([loadWelfare(), loadSummary()]); }
    else say(result.error, true);
    setBusy(false);
  };

  const eligibleForProbation = employeesWithAuthId.filter((u) => !probationRecords.some((p) => ['on_probation', 'extended'].includes(p.status) && p.employee_user_id === u.authUserId));

  if (loading) return <div className="flex items-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 text-sm text-slate-300"><Loader className="h-4 w-4 animate-spin" /> Loading welfare records…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <HeartPulse className="h-6 w-6 text-rose-400" />
          <div>
            <h2 className="text-xl font-bold text-white">Leave &amp; welfare</h2>
            <p className="text-sm text-slate-400">Leave approvals, probation tracking, and HR requests for the whole team.{!canManage && ' You can view these records but do not have permission to decide them.'}</p>
          </div>
        </div>
        {notice && <p className="mt-3 rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-2 text-sm text-emerald-300">{notice}</p>}
        {error && <p className="mt-3 rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{error}</p>}
        {summary && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Pending leave requests" value={summary.pending_leave_requests} tone="amber" />
            <SummaryCard label="On probation" value={summary.employees_on_probation} tone="blue" />
            <SummaryCard label="Probation review due (14d)" value={summary.probations_due_within_14_days} tone="rose" />
            <SummaryCard label="Open HR requests" value={summary.open_welfare_requests} tone="emerald" />
          </div>
        )}
      </div>

      {/* Leave requests */}
      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-white">Leave requests</h3>
          <select value={leaveFilter} onChange={(e) => setLeaveFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white">
            {['pending', 'approved', 'rejected', 'cancelled', 'all'].map((s) => <option key={s} value={s}>{s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        <div className="mt-3 space-y-2">
          {leaveRequests.length === 0 ? <p className="text-sm text-slate-400">No leave requests here.</p> : leaveRequests.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-white">{person(r)} <span className="text-xs font-normal text-slate-500">{r.cmms_users?.department ? `· ${r.cmms_users.department}` : ''}</span></p>
                  <p className="text-xs text-slate-400">{r.cmms_leave_types?.name} · {fmtDate(r.start_date)} – {fmtDate(r.end_date)} ({r.total_days} day{r.total_days === 1 ? '' : 's'})</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {r.reason && <p className="mt-1 text-xs text-slate-400">Reason: {r.reason}</p>}
              {r.supporting_document_url && <a href={r.supporting_document_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-blue-300 hover:text-blue-200">Supporting document</a>}
              {r.decision_note && <p className="mt-1 text-xs text-slate-500">Decision note: {r.decision_note}</p>}
              {canManage && r.status === 'pending' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input value={leaveNotes[r.id] || ''} onChange={(e) => setLeaveNotes((v) => ({ ...v, [r.id]: e.target.value }))} placeholder="Note (optional)" className="flex-1 min-w-[10rem] rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" />
                  <button disabled={busy} onClick={() => decideLeave(r.id, 'approved')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Approve</button>
                  <button disabled={busy} onClick={() => decideLeave(r.id, 'rejected')} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Probation */}
      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold text-white"><ShieldCheck className="h-4 w-4" /> Probation</h3>
          <div className="flex items-center gap-2">
            <select value={probationFilter} onChange={(e) => setProbationFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white">
              <option value="active">Active</option>
              <option value="confirmed">Confirmed</option>
              <option value="terminated">Terminated</option>
              <option value="all">All</option>
            </select>
            {canManage && <button type="button" onClick={() => setShowStartForm((v) => !v)} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500">{showStartForm ? 'Close' : '+ Start probation'}</button>}
          </div>
        </div>

        {showStartForm && canManage && (
          <form onSubmit={startProbation} className="mt-3 grid gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-4">
            <select required value={startForm.cmms_user_id} onChange={(e) => setStartForm((v) => ({ ...v, cmms_user_id: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white sm:col-span-2">
              <option value="">Select employee…</option>
              {eligibleForProbation.map((u) => <option key={u.id} value={u.id}>{u.name}{u.department ? ` — ${u.department}` : ''}</option>)}
            </select>
            <input
              type="number" min={startForm.duration_unit === 'days' ? '1' : '0.5'} step={startForm.duration_unit === 'days' ? '1' : '0.5'}
              value={startForm.duration_value} onChange={(e) => setStartForm((v) => ({ ...v, duration_value: e.target.value }))}
              placeholder="Duration" className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
            <select value={startForm.duration_unit} onChange={(e) => setStartForm((v) => ({ ...v, duration_unit: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
              <option value="days">Days</option>
              <option value="months">Months</option>
            </select>
            <button disabled={busy} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white sm:col-span-4 disabled:opacity-50">{busy ? 'Starting…' : 'Start probation'}</button>
          </form>
        )}

        <div className="mt-3 space-y-2">
          {probationRecords.length === 0 ? <p className="text-sm text-slate-400">No probation records here.</p> : probationRecords.map((p) => (
            <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm">
              <button type="button" onClick={() => toggleProbation(p.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                <div>
                  <p className="font-semibold text-white">{person(p)} <span className="text-xs font-normal text-slate-500">{p.cmms_users?.department ? `· ${p.cmms_users.department}` : ''}</span></p>
                  <p className="text-xs text-slate-400">
                    Started {fmtDate(p.start_date)} · {p.duration_days ? `${p.duration_days} day${p.duration_days === 1 ? '' : 's'}` : `${p.duration_months} month${Number(p.duration_months) === 1 ? '' : 's'}`} · Review by {fmtDate(p.probation_end_date)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={p.status} />
                  {expandedProbation === p.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </div>
              </button>

              {expandedProbation === p.id && (
                <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
                  {probationReviews.length > 0 && (
                    <div className="space-y-2">
                      {probationReviews.map((rev) => (
                        <div key={rev.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
                          <p className="font-semibold text-slate-200">{fmtDate(rev.review_date)}{rev.rating ? ` · ${rev.rating}/5` : ''}{rev.recommendation ? ` · Recommends: ${rev.recommendation}` : ''}</p>
                          {rev.strengths && <p className="mt-1 text-slate-400">Strengths: {rev.strengths}</p>}
                          {rev.areas_for_improvement && <p className="text-slate-400">Improve: {rev.areas_for_improvement}</p>}
                          {rev.comments && <p className="text-slate-400">{rev.comments}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                  {canManage && ['on_probation', 'extended'].includes(p.status) && (
                    <>
                      <div className="grid gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-2 sm:grid-cols-2">
                        <p className="text-xs font-semibold text-slate-300 sm:col-span-2">Add a review</p>
                        <select value={reviewForm.rating} onChange={(e) => setReviewForm((v) => ({ ...v, rating: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white">
                          <option value="">Rating…</option>
                          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
                        </select>
                        <select value={reviewForm.recommendation} onChange={(e) => setReviewForm((v) => ({ ...v, recommendation: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white">
                          <option value="">Recommendation…</option>
                          <option value="confirm">Confirm</option>
                          <option value="extend">Extend</option>
                          <option value="terminate">Terminate</option>
                        </select>
                        <textarea value={reviewForm.strengths} onChange={(e) => setReviewForm((v) => ({ ...v, strengths: e.target.value }))} placeholder="Strengths" rows={2} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white sm:col-span-2" />
                        <textarea value={reviewForm.areas_for_improvement} onChange={(e) => setReviewForm((v) => ({ ...v, areas_for_improvement: e.target.value }))} placeholder="Areas for improvement" rows={2} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white sm:col-span-2" />
                        <textarea value={reviewForm.comments} onChange={(e) => setReviewForm((v) => ({ ...v, comments: e.target.value }))} placeholder="Other comments" rows={2} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white sm:col-span-2" />
                        <button disabled={busy} onClick={() => addReview(p.id)} className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white sm:col-span-2 disabled:opacity-50">Save review</button>
                      </div>

                      <div className="grid gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-2 sm:grid-cols-2">
                        <p className="text-xs font-semibold text-slate-300 sm:col-span-2">Decide outcome</p>
                        <select value={decisionForm.decision} onChange={(e) => setDecisionForm((v) => ({ ...v, decision: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white">
                          <option value="confirmed">Confirm employment</option>
                          <option value="extended">Extend probation</option>
                          <option value="terminated">End employment</option>
                        </select>
                        {decisionForm.decision === 'extended' && (
                          <input type="date" value={decisionForm.new_end_date} onChange={(e) => setDecisionForm((v) => ({ ...v, new_end_date: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" />
                        )}
                        <textarea value={decisionForm.note} onChange={(e) => setDecisionForm((v) => ({ ...v, note: e.target.value }))} placeholder="Note (optional)" rows={2} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white sm:col-span-2" />
                        <button disabled={busy} onClick={() => decideProbationOutcome(p.id)} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white sm:col-span-2 disabled:opacity-50">Confirm decision</button>
                      </div>
                    </>
                  )}
                  {p.outcome_note && <p className="text-xs text-slate-500">Outcome note: {p.outcome_note}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* General HR / welfare requests */}
      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-white">HR &amp; wellbeing requests</h3>
          <select value={welfareFilter} onChange={(e) => setWelfareFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white">
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="declined">Declined</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="mt-3 space-y-2">
          {welfareRequests.length === 0 ? <p className="text-sm text-slate-400">No requests here.</p> : welfareRequests.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-white">{r.subject} {r.is_confidential && <span className="ml-1 rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-purple-300">Confidential</span>}</p>
                  <p className="text-xs text-slate-400">{person(r)}{r.cmms_users?.department ? ` · ${r.cmms_users.department}` : ''} · {WELFARE_CATEGORIES.find((c) => c.id === r.category)?.label || r.category}</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-1 text-xs text-slate-300">{r.description}</p>
              {r.response && <p className="mt-1 text-xs text-emerald-300">Response: {r.response}</p>}
              {canManage && ['submitted', 'in_review'].includes(r.status) && (
                <div className="mt-2 space-y-2">
                  <textarea value={responseNotes[r.id] || ''} onChange={(e) => setResponseNotes((v) => ({ ...v, [r.id]: e.target.value }))} placeholder="Response to employee (optional)" rows={2} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" />
                  <div className="flex flex-wrap gap-2">
                    {r.status === 'submitted' && <button disabled={busy} onClick={() => respondWelfare(r.id, 'in_review')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Mark in review</button>}
                    <button disabled={busy} onClick={() => respondWelfare(r.id, 'resolved')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Resolve</button>
                    <button disabled={busy} onClick={() => respondWelfare(r.id, 'declined')} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Decline</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
