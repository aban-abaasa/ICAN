import React, { useEffect, useState } from 'react';
import { CalendarDays, HeartPulse, Loader, Send, ShieldCheck, X } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import {
  WELFARE_CATEGORIES, cancelLeaveRequest, cancelWelfareRequest, getLeaveTypes,
  getMyLeaveBalances, getMyLeaveRequests, getMyProbationStatus, getMyWelfareRequests,
  requestLeave, submitWelfareRequest
} from '../services/cmmsWelfareService';

const STATUS_STYLES = {
  pending: 'bg-amber-500/15 text-amber-300', submitted: 'bg-amber-500/15 text-amber-300',
  approved: 'bg-emerald-500/15 text-emerald-300', resolved: 'bg-emerald-500/15 text-emerald-300',
  confirmed: 'bg-emerald-500/15 text-emerald-300',
  rejected: 'bg-red-500/15 text-red-300', declined: 'bg-red-500/15 text-red-300', terminated: 'bg-red-500/15 text-red-300',
  cancelled: 'bg-slate-600/30 text-slate-300',
  in_review: 'bg-blue-500/15 text-blue-300', on_probation: 'bg-blue-500/15 text-blue-300', extended: 'bg-amber-500/15 text-amber-300'
};
const StatusBadge = ({ status }) => <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[status] || 'bg-slate-600/30 text-slate-300'}`}>{(status || '').replace(/_/g, ' ')}</span>;

const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

// Employee-facing HR self-service: leave balances & requests, probation
// status (read-only — HR decides outcomes from the admin welfare screen),
// and a general request form for anything else HR handles for staff
// wellbeing. See backend/CMMS_EMPLOYEE_WELFARE_SYSTEM.sql.
export default function CMMSEmployeeWelfare({ companyProfile }) {
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

  if (loading) return <div className="flex items-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 text-sm text-slate-300"><Loader className="h-4 w-4 animate-spin" /> Loading your welfare records…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <HeartPulse className="h-6 w-6 text-rose-400" />
          <div>
            <h2 className="text-xl font-bold text-white">My welfare</h2>
            <p className="text-sm text-slate-400">Leave, probation status, and HR requests — only your own records.</p>
          </div>
        </div>
        {notice && <p className="mt-3 rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-2 text-sm text-emerald-300">{notice}</p>}
        {error && <p className="mt-3 rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{error}</p>}
      </div>

      {probation && (
        <section className="rounded-2xl border border-blue-800/40 bg-blue-950/10 p-4 md:p-6">
          <div className="flex items-center gap-2 text-white"><ShieldCheck className="h-5 w-5 text-blue-300" /><h3 className="font-semibold">Probation status</h3></div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={probation.status} />
            <span className="text-slate-300">Started {fmtDate(probation.start_date)} · {probation.status === 'terminated' ? 'ended' : 'review by'} {fmtDate(probation.probation_end_date)}</span>
          </div>
          {probation.outcome_note && <p className="mt-2 text-xs text-slate-400">HR note: {probation.outcome_note}</p>}
        </section>
      )}

      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold text-white"><CalendarDays className="h-4 w-4" /> Leave balances ({new Date().getFullYear()})</h3>
          <button type="button" onClick={() => setShowLeaveForm((v) => !v)} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500">
            {showLeaveForm ? 'Close' : '+ Request leave'}
          </button>
        </div>

        {balances.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((b) => (
              <div key={b.leave_type_id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <p className="text-xs uppercase text-slate-400">{b.name}</p>
                <p className="mt-1 text-lg font-bold text-white">{Number(b.remaining_days).toLocaleString()} <span className="text-xs font-normal text-slate-500">of {b.entitled_days > 0 ? Number(b.entitled_days).toLocaleString() : '∞'} days</span></p>
                {!b.is_paid && <p className="text-xs text-amber-400">Unpaid</p>}
              </div>
            ))}
          </div>
        )}

        {showLeaveForm && (
          <form onSubmit={submitLeave} className="mt-4 space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <select required value={leaveForm.leave_type_id} onChange={(e) => setLeaveForm((v) => ({ ...v, leave_type_id: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
              <option value="">Select leave type…</option>
              {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}{t.requires_document ? ' (supporting document recommended)' : ''}</option>)}
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-slate-400">Start date
                <input required type="date" value={leaveForm.start_date} onChange={(e) => setLeaveForm((v) => ({ ...v, start_date: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs text-slate-400">End date
                <input required type="date" min={leaveForm.start_date || undefined} value={leaveForm.end_date} onChange={(e) => setLeaveForm((v) => ({ ...v, end_date: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
            </div>
            <textarea value={leaveForm.reason} onChange={(e) => setLeaveForm((v) => ({ ...v, reason: e.target.value }))} placeholder="Reason (optional)" rows={2} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
            <input value={leaveForm.document_url} onChange={(e) => setLeaveForm((v) => ({ ...v, document_url: e.target.value }))} placeholder="Supporting document link (optional)" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
            <button disabled={busy} className="flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Send className="h-4 w-4" /> {busy ? 'Submitting…' : 'Submit request'}</button>
          </form>
        )}

        <div className="mt-4 space-y-2">
          {leaveRequests.length === 0 ? <p className="text-sm text-slate-400">No leave requests yet.</p> : leaveRequests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm">
              <div>
                <p className="font-semibold text-white">{fmtDate(r.start_date)} – {fmtDate(r.end_date)} <span className="text-xs font-normal text-slate-500">({r.total_days} day{r.total_days === 1 ? '' : 's'})</span></p>
                {r.reason && <p className="mt-0.5 text-xs text-slate-400">{r.reason}</p>}
                {r.decision_note && <p className="mt-0.5 text-xs text-slate-500">HR note: {r.decision_note}</p>}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={r.status} />
                {(r.status === 'pending' || (r.status === 'approved' && new Date(r.start_date) > new Date())) && (
                  <button type="button" disabled={busy} onClick={() => withdrawLeave(r.id)} className="rounded-lg border border-slate-600 p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-50" title="Cancel"><X className="h-3.5 w-3.5" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-white">HR &amp; wellbeing requests</h3>
          <button type="button" onClick={() => setShowWelfareForm((v) => !v)} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500">
            {showWelfareForm ? 'Close' : '+ New request'}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Grievances, wellness &amp; counseling support, flexible work, training sponsorship, medical or bereavement assistance — anything else HR can help with.</p>

        {showWelfareForm && (
          <form onSubmit={submitWelfare} className="mt-4 space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <select value={welfareForm.category} onChange={(e) => setWelfareForm((v) => ({ ...v, category: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
              {WELFARE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <input required value={welfareForm.subject} onChange={(e) => setWelfareForm((v) => ({ ...v, subject: e.target.value }))} placeholder="Subject" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
            <textarea required value={welfareForm.description} onChange={(e) => setWelfareForm((v) => ({ ...v, description: e.target.value }))} placeholder="Describe your request…" rows={3} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={welfareForm.is_confidential} onChange={(e) => setWelfareForm((v) => ({ ...v, is_confidential: e.target.checked }))} />
              Keep this confidential (visible to HR only)
            </label>
            <button disabled={busy} className="flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Send className="h-4 w-4" /> {busy ? 'Sending…' : 'Send to HR'}</button>
          </form>
        )}

        <div className="mt-4 space-y-2">
          {welfareRequests.length === 0 ? <p className="text-sm text-slate-400">No requests yet.</p> : welfareRequests.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-white">{r.subject} <span className="text-xs font-normal capitalize text-slate-500">· {WELFARE_CATEGORIES.find((c) => c.id === r.category)?.label || r.category}</span></p>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {r.status === 'submitted' && <button type="button" disabled={busy} onClick={() => withdrawWelfare(r.id)} className="rounded-lg border border-slate-600 p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-50" title="Withdraw"><X className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-400">{r.description}</p>
              {r.response && <p className="mt-1 text-xs text-emerald-300">HR response: {r.response}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
