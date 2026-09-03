import React, { useEffect, useState } from 'react';
import { Bus, CalendarDays, DollarSign, Loader, Star, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { getEmployeeRewardPoints, getStaffVisitorRatings, getAttendanceCheckoutPayConfirmations, getMyTransportPlan, getMySalaryAdvances, requestSalaryAdvance, confirmSalaryAdvanceReceived, cancelSalaryAdvance, getMyCompanySalaryWalletTransactions } from '../services/businessManagementService';

const money = (value, currency = 'UGX') => `${currency} ${Number(value || 0).toLocaleString()}`;

// This screen intentionally makes employee-level requests only. It is used
// for roles whose tool scope is "own" and must never receive company payroll
// or transport records through component props.
export default function CMMSEmployeeSelfService({ companyProfile, mode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [compensation, setCompensation] = useState(null);
  const [entries, setEntries] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [rides, setRides] = useState([]);
  const [rewardPoints, setRewardPoints] = useState(null);
  const [myRating, setMyRating] = useState(null);
  const [payConfirmations, setPayConfirmations] = useState([]);
  const [transportPlan, setTransportPlan] = useState(null);
  const [advances, setAdvances] = useState([]);
  const [monthlyAttendance, setMonthlyAttendance] = useState(null);
  const [walletTransactions, setWalletTransactions] = useState([]);
  const [advanceForm, setAdvanceForm] = useState({ amount: '', reason: '' });
  const [advanceBusy, setAdvanceBusy] = useState(false);
  const [advanceNotice, setAdvanceNotice] = useState('');
  const [advanceError, setAdvanceError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError('');
      const { data: authData, error: authError } = await supabase.auth.getUser();
      const employeeId = authData?.user?.id;
      if (authError || !employeeId || !companyProfile?.id) {
        if (!cancelled) { setError('Sign in to view your employee records.'); setLoading(false); }
        return;
      }

      if (mode === 'payroll') {
        // Email is the stable membership key across the older CMMS schemas
        // (some use ican_user_id, others use auth_user_id).
        const { data: cmmsUser } = await supabase.from('cmms_users')
          .select('id').eq('cmms_company_id', companyProfile.id)
          .ilike('email', authData.user.email || '').maybeSingle();
        const today = new Date();
        const periodStart = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const periodEnd = today.toISOString().slice(0, 10);
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
        const [compensationResult, entriesResult, attendanceResult, rewardsResult, ratingResult, payConfirmationsResult, advancesResult, monthlyAttendanceResult, walletTransactionsResult] = await Promise.all([
          supabase.from('business_compensation_profiles').select('base_salary,currency,pay_frequency,payroll_status,effective_from')
            .eq('business_profile_id', companyProfile.pichin_business_profile_id).eq('employee_user_id', employeeId)
            .order('effective_from', { ascending: false }).limit(1),
          supabase.from('business_payroll_entries').select('id,base_amount,net_amount,status,metadata,created_at')
            .eq('business_profile_id', companyProfile.pichin_business_profile_id).eq('employee_user_id', employeeId)
            .order('created_at', { ascending: false }).limit(12),
          cmmsUser?.id
            ? supabase.from('cmms_staff_attendance').select('check_in_time,check_out_time,status')
              .eq('cmms_company_id', companyProfile.id).eq('cmms_user_id', cmmsUser.id)
              .order('check_in_time', { ascending: false }).limit(31)
            : Promise.resolve({ data: [], error: null }),
          // Both RPCs self-restrict a non-admin caller to their own row, so
          // no need to resolve/pass cmmsUser.id here.
          getEmployeeRewardPoints(companyProfile.id),
          getStaffVisitorRatings(companyProfile.id),
          // RLS on cmms_attendance_pay_confirmations already restricts a
          // non-admin caller to their own rows (cmms_users.ican_user_id =
          // auth.uid()), so this only ever returns this employee's own
          // daily pay confirmations even though it isn't filtered here.
          getAttendanceCheckoutPayConfirmations({ cmmsCompanyId: companyProfile.id, periodStart, periodEnd }),
          getMySalaryAdvances(),
          // Self-restricted to the caller's own row by get_attendance_summary
          // itself, so no need to pass/resolve cmmsUser.id here either.
          supabase.rpc('get_attendance_summary', { p_cmms_company_id: companyProfile.id, p_start_date: monthStart, p_end_date: periodEnd }),
          getMyCompanySalaryWalletTransactions(companyProfile.id)
        ]);
        if (!cancelled) {
          setCompensation(compensationResult.data?.[0] || null);
          setEntries(entriesResult.data || []);
          setAttendance(attendanceResult.data || []);
          setRewardPoints(rewardsResult.data?.[0] || null);
          setMyRating(ratingResult.data?.[0] || null);
          setPayConfirmations(payConfirmationsResult.data || []);
          setAdvances(advancesResult.data || []);
          setMonthlyAttendance(monthlyAttendanceResult.data?.[0] || null);
          setWalletTransactions(walletTransactionsResult.data || []);
          setError(compensationResult.error?.message || entriesResult.error?.message || attendanceResult.error?.message || '');
        }
      } else {
        const [{ data, error: ridesError }, planResult] = await Promise.all([
          supabase.from('mbg_corporate_ride_requests')
            .select('id,ride_count,requested_vehicle_type,recurrence,pickup_location,dropoff_location,scheduled_for,status,estimated_total,created_at')
            .eq('business_profile_id', companyProfile.pichin_business_profile_id).eq('requested_by', employeeId)
            .order('created_at', { ascending: false }).limit(30),
          getMyTransportPlan(companyProfile.id)
        ]);
        if (!cancelled) { setRides(data || []); setTransportPlan(planResult.data); setError(ridesError?.message || ''); }
      }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [companyProfile?.id, companyProfile?.pichin_business_profile_id, mode]);

  const reloadAdvances = async () => { const refreshed = await getMySalaryAdvances(); setAdvances(refreshed.data || []); };
  const submitAdvanceRequest = async (e) => {
    e.preventDefault();
    const amount = Number(advanceForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setAdvanceError('Enter an amount greater than zero.'); setAdvanceNotice(''); return; }
    setAdvanceBusy(true); setAdvanceNotice(''); setAdvanceError('');
    const result = await requestSalaryAdvance(companyProfile.id, amount, compensation?.currency || null, advanceForm.reason);
    if (result.success) { setAdvanceNotice('Advance requested. Waiting for approval.'); setAdvanceForm({ amount: '', reason: '' }); await reloadAdvances(); }
    else setAdvanceError(result.error);
    setAdvanceBusy(false);
  };
  const confirmAdvanceReceipt = async (advanceId) => {
    setAdvanceBusy(true); setAdvanceNotice(''); setAdvanceError('');
    const result = await confirmSalaryAdvanceReceived(advanceId);
    if (result.success) { setAdvanceNotice('Thanks — confirmed. This will now be recovered from your upcoming pay.'); await reloadAdvances(); }
    else setAdvanceError(result.error);
    setAdvanceBusy(false);
  };
  const cancelMyAdvance = async (advanceId) => {
    setAdvanceBusy(true); setAdvanceNotice(''); setAdvanceError('');
    const result = await cancelSalaryAdvance(advanceId);
    if (result.success) { setAdvanceNotice('Request cancelled.'); await reloadAdvances(); }
    else setAdvanceError(result.error);
    setAdvanceBusy(false);
  };

  if (loading) return <div className="flex items-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 text-sm text-slate-300"><Loader className="h-4 w-4 animate-spin" /> Loading your records…</div>;
  if (error) return <div className="rounded-2xl border border-red-700/40 bg-red-900/15 p-6 text-sm text-red-200">{error}</div>;

  // "Paid" entries already cover both salaried payroll runs and daily-paid
  // check-out settlements (cmms_settle_attendance_pay writes a
  // business_payroll_entries row either way). "Waiting" entries only exist
  // for salaried staff, whose draft/approved entries are pre-created with an
  // amount before payday — a daily-paid employee's not-yet-paid days never
  // get an entry until they're actually paid, so those are counted
  // separately below from payConfirmations instead.
  const paidTotal = entries.filter(e => e.status === 'paid').reduce((sum, e) => sum + Number(e.net_amount ?? e.base_amount ?? 0), 0);
  const waitingEntries = entries.filter(e => e.status === 'draft' || e.status === 'approved');
  const waitingTotal = waitingEntries.reduce((sum, e) => sum + Number(e.net_amount ?? e.base_amount ?? 0), 0);
  const unpaidDayCount = payConfirmations.filter(c => !c.paid).length;
  const currency = compensation?.currency || entries[0]?.metadata?.currency;
  const liveAdvance = advances.find(a => ['pending', 'approved', 'paid', 'confirmed'].includes(a.status));

  if (mode === 'transport') return <div className="space-y-4 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6"><div className="flex items-center gap-3"><Bus className="h-6 w-6 text-orange-400" /><div><h2 className="text-xl font-bold text-white">My transport records</h2><p className="text-sm text-slate-400">Only transport requests made by your account are shown.</p></div></div>{transportPlan?.has_plan && <div className="rounded-xl border border-orange-800/40 bg-orange-950/10 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-white">{transportPlan.contract_name}</p><span className="rounded-full bg-orange-500/15 px-3 py-1 text-xs capitalize text-orange-300">{transportPlan.billing_cycle} plan</span></div><p className="mt-1 text-xs text-slate-400">Allowed vehicles: {(transportPlan.allowed_vehicle_types || []).join(', ') || 'any'}</p>{transportPlan.monthly_limit > 0 && <div className="mt-3"><div className="flex justify-between text-xs text-slate-400"><span>{money(transportPlan.spend_this_month, transportPlan.currency)} used this month</span><span>of {money(transportPlan.monthly_limit, transportPlan.currency)}</span></div><div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(transportPlan.percent_used || 0, 100)}%` }} /></div></div>}<p className="mt-2 text-xs text-slate-500">{transportPlan.rides_this_month} ride(s) across {transportPlan.days_covered_this_month} day(s) this month</p></div>}{rides.length === 0 ? <p className="text-sm text-slate-400">No personal transport records yet.</p> : <div className="space-y-2">{rides.map(ride => <div key={ride.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"><div className="flex justify-between gap-3"><span className="font-semibold text-white capitalize">{ride.status}</span><span className="text-slate-400">{new Date(ride.created_at).toLocaleDateString()}</span></div><p className="mt-1 text-slate-300">{ride.pickup_location} → {ride.dropoff_location}</p><p className="mt-1 text-xs text-slate-500">{ride.ride_count} ride(s) · {ride.requested_vehicle_type || 'Any vehicle'}{ride.estimated_total ? ` · ${money(ride.estimated_total)}` : ''}</p></div>)}</div>}</div>;

  return <div className="space-y-4 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6"><div className="flex items-center gap-3"><DollarSign className="h-6 w-6 text-emerald-400" /><div><h2 className="text-xl font-bold text-white">My salary and attendance</h2><p className="text-sm text-slate-400">Only your salary, payroll entries, and attendance are shown.</p></div></div>{compensation && <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-4"><p className="text-xs uppercase text-emerald-300">Current salary</p><p className="mt-1 text-2xl font-bold text-white">{money(compensation.base_salary, compensation.currency)}</p><p className="text-xs text-slate-400 capitalize">{compensation.pay_frequency || 'monthly'} · {compensation.payroll_status || 'on pay'}</p></div>}{(entries.length > 0 || unpaidDayCount > 0) && <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-emerald-800/40 bg-emerald-950/10 p-3"><p className="text-xs uppercase text-emerald-300">Paid so far</p><p className="mt-1 text-xl font-bold text-white">{money(paidTotal, currency)}</p></div><div className="rounded-lg border border-amber-800/40 bg-amber-950/10 p-3"><p className="text-xs uppercase text-amber-300">Waiting to be paid</p><p className="mt-1 text-xl font-bold text-white">{money(waitingTotal, currency)}</p>{unpaidDayCount > 0 && <p className="mt-1 text-xs text-slate-500">+ {unpaidDayCount} day(s) checked out, pay not yet confirmed</p>}</div></div>}<section><h3 className="mb-2 flex items-center gap-2 font-semibold text-white"><CalendarDays className="h-4 w-4" /> My attendance</h3>
      {monthlyAttendance ? <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"><p className="text-xs uppercase text-slate-400">Days present this month</p><p className="mt-1 text-xl font-bold text-white">{monthlyAttendance.days_present}</p></div><div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"><p className="text-xs uppercase text-slate-400">Check-ins this month</p><p className="mt-1 text-xl font-bold text-white">{monthlyAttendance.check_in_count}</p>{monthlyAttendance.currently_checked_in && <p className="mt-1 text-xs text-emerald-400">Currently checked in</p>}</div></div> : <p className="text-sm text-slate-400">No attendance recorded this month yet.</p>}
      {attendance.length > 0 && <div className="mt-3 space-y-1 max-h-56 overflow-y-auto">{attendance.map((rec, i) => <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-400"><span className="font-medium text-slate-200">{new Date(rec.check_in_time).toLocaleDateString()}</span><span>In {new Date(rec.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{rec.check_out_time ? ` · Out ${new Date(rec.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' · Still checked in'}</span><span className="capitalize">{rec.status}</span></div>)}</div>}
      {(rewardPoints || myRating) && <div className="mt-3 grid gap-3 sm:grid-cols-3">{rewardPoints && <div className="rounded-lg border border-indigo-800/40 bg-indigo-950/20 p-3"><p className="text-xs uppercase text-indigo-300">Reward points</p><p className="mt-1 text-xl font-bold text-white">{rewardPoints.balance_points}</p><p className="text-xs text-slate-500">{rewardPoints.lifetime_earned_points} earned all-time{rewardPoints.pending_redemption_points > 0 ? ` · ${rewardPoints.pending_redemption_points} pending payout` : ''}</p></div>}{myRating?.average_rating != null && <div className="rounded-lg border border-amber-800/40 bg-amber-950/10 p-3"><p className="text-xs uppercase text-amber-300">Visitor rating</p><p className="mt-1 flex items-center gap-1 text-xl font-bold text-white">{myRating.average_rating} <Star className="h-4 w-4 fill-amber-400 text-amber-400" /></p><p className="text-xs text-slate-500">from {myRating.rating_count} visitor rating(s)</p></div>}</div>}
    </section>
    <section><h3 className="mb-2 font-semibold text-white">My payroll entries</h3>{entries.length === 0 ? <p className="text-sm text-slate-400">No payroll entries yet.</p> : <div className="space-y-2">{entries.map(entry => <div key={entry.id} className="flex justify-between rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"><span className="capitalize text-slate-300">{entry.status || 'draft'}</span><span className="font-semibold text-emerald-300">{money(entry.net_amount ?? entry.base_amount, entry.metadata?.currency)}</span></div>)}</div>}</section>
    <section>
      <h3 className="mb-2 flex items-center gap-2 font-semibold text-white"><Wallet className="h-4 w-4" /> IcanEra wallet activity</h3>
      <p className="mb-2 text-xs text-slate-500">On-chain ICAN transactions between this company's business wallet and your personal wallet — the record behind a "paid" salary or advance.</p>
      {walletTransactions.length === 0 ? <p className="text-sm text-slate-400">No wallet transactions from this company yet.</p> : <div className="space-y-1 max-h-56 overflow-y-auto">{walletTransactions.map(tx => <div key={tx.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs"><div><span className={`font-semibold ${tx.direction === 'received' ? 'text-emerald-300' : 'text-amber-300'}`}>{tx.direction === 'received' ? 'Received' : 'Sent'} {Number(tx.ican_amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ICAN</span>{tx.note && <p className="mt-0.5 text-slate-500">{tx.note}</p>}</div><div className="text-right text-slate-400"><p>{money(tx.local_amount, tx.local_currency)}</p><p>{new Date(tx.created_at).toLocaleDateString()}</p></div></div>)}</div>}
    </section>
    <section>
      <h3 className="mb-2 flex items-center gap-2 font-semibold text-white"><Wallet className="h-4 w-4" /> Salary advance</h3>
      {advanceError && <p className="mb-2 rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{advanceError}</p>}
      {advanceNotice && <p className="mb-2 rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-2 text-sm text-emerald-300">{advanceNotice}</p>}
      {liveAdvance ? <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm">
        <div className="flex items-center justify-between"><span className="font-semibold text-white">{money(liveAdvance.amount, liveAdvance.currency)}</span><span className="rounded-full bg-slate-800 px-2 py-1 text-xs capitalize text-slate-300">{liveAdvance.status}</span></div>
        {liveAdvance.reason && <p className="text-xs text-slate-400">{liveAdvance.reason}</p>}
        {liveAdvance.status === 'pending' && <button type="button" disabled={advanceBusy} onClick={() => cancelMyAdvance(liveAdvance.id)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50">Cancel request</button>}
        {liveAdvance.status === 'approved' && <p className="text-xs text-amber-300">Approved — waiting to be paid.</p>}
        {liveAdvance.status === 'paid' && <><p className="text-xs text-amber-300">Marked paid ({liveAdvance.payment_method === 'ican' ? 'IcanEra wallet' : 'cash'}). Confirm below once you have actually received it — this is required before it can be deducted from your pay.</p><button type="button" disabled={advanceBusy} onClick={() => confirmAdvanceReceipt(liveAdvance.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">I received this</button></>}
        {liveAdvance.status === 'confirmed' && <p className="text-xs text-slate-400">{money(liveAdvance.recovered_amount, liveAdvance.currency)} of {money(liveAdvance.amount, liveAdvance.currency)} recovered from your pay so far.</p>}
      </div> : <form onSubmit={submitAdvanceRequest} className="grid gap-2 sm:grid-cols-3">
        <input required type="number" min="0.01" step="0.01" value={advanceForm.amount} onChange={e => setAdvanceForm(v => ({ ...v, amount: e.target.value }))} placeholder={`Amount (${currency || 'UGX'})`} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
        <input value={advanceForm.reason} onChange={e => setAdvanceForm(v => ({ ...v, reason: e.target.value }))} placeholder="Reason (optional)" className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
        <button disabled={advanceBusy} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{advanceBusy ? 'Requesting…' : 'Request advance'}</button>
      </form>}
    </section>
  </div>;
}
