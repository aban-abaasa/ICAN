import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock3, Coins, Loader, UserPlus, WalletCards } from 'lucide-react';
import { decideSalaryAdvance, getBusinessAccessMembers, getCompanySalaryAdvances, paySalaryAdvance, resolveEmployeeAuthIds, saveBusinessCompensation } from '../services/businessManagementService';
import { ICAN_TO_UGX, transferFromBusinessWallet } from '../services/icanWalletService';
import { supabase } from '../lib/supabase/client';
import CMMSEmployeeSelfService from './CMMSEmployeeSelfService.jsx';

const today = new Date().toISOString().slice(0, 10);
const amount = (value, currency = 'UGX') => `${currency} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// The "My Salary" tab is what a role sees when its Payroll access is scoped
// to "own" records. View-only shows just the self-service screen below. The
// two sections here (add a salary, work schedule + day credit) only appear
// once the administrator also ticks Create / Approve on the Payroll tool
// for that role — they extend the same "own"-scoped role with a couple of
// specific admin actions instead of unlocking the full company Payroll tab.
export default function CMMSMySalaryPanel({ companyProfile, users = [], currentUser, canCreate = false, canApprove = false }) {
  const businessProfileId = companyProfile?.pichin_business_profile_id;
  const [members, setMembers] = useState([]);
  const [extraUsers, setExtraUsers] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [salary, setSalary] = useState({ employee: '', pay_type: 'monthly', pay_frequency: 'monthly', base_salary: '', currency: 'UGX', payroll_status: 'on_pay' });
  const [schedule, setSchedule] = useState({ enabled: false, timezone: 'UTC', scheduled_start: '09:00', scheduled_end: '17:00', grace_minutes: 0, monthly_work_days: 22, deduct_late_arrivals: true, deduct_early_departures: true });
  const [addDays, setAddDays] = useState({ employee: '', count: '', reason: '' });
  const [dayAdjustments, setDayAdjustments] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [advancePayment, setAdvancePayment] = useState({ advance: '', method: 'cash', pin: '' });

  const needsStaffList = canCreate || canApprove;
  const say = (text, bad = false) => { setNotice(bad ? '' : text); setError(bad ? text : ''); };

  const employees = useMemo(() => {
    const byId = new Map();
    [...users, ...extraUsers].filter((u) => u.authUserId).forEach((u) => byId.set(u.authUserId, u));
    members.forEach((m) => byId.set(m.auth_user_id, { authUserId: m.auth_user_id, name: m.user?.full_name || m.job_title || 'Employee', email: m.user?.email || '', role: m.job_title || 'Employee' }));
    return [...byId.values()].filter((u) => u.authUserId);
  }, [users, extraUsers, members]);

  useEffect(() => {
    if (!needsStaffList || !companyProfile?.id) return;
    let cancelled = false;
    setLoadingStaff(true);
    (async () => {
      const [resolvedUsers, memberResult, settingsResult, adjustmentsResult, advancesResult] = await Promise.all([
        resolveEmployeeAuthIds(users),
        businessProfileId ? getBusinessAccessMembers(businessProfileId) : Promise.resolve({ data: [] }),
        supabase.from('cmms_attendance_payroll_settings').select('*').eq('cmms_company_id', companyProfile.id).maybeSingle(),
        canApprove ? supabase.rpc('get_attendance_day_adjustments', { p_cmms_company_id: companyProfile.id }) : Promise.resolve({ data: [] }),
        canApprove ? getCompanySalaryAdvances(companyProfile.id) : Promise.resolve({ data: [] })
      ]);
      if (cancelled) return;
      setExtraUsers(resolvedUsers || []);
      setMembers(memberResult.data || []);
      if (settingsResult.data) setSchedule((current) => ({ ...current, ...settingsResult.data }));
      setDayAdjustments(adjustmentsResult.data || []);
      setAdvances(advancesResult.data || []);
      setLoadingStaff(false);
    })();
    return () => { cancelled = true; };
  }, [needsStaffList, companyProfile?.id, businessProfileId, users, canApprove]);

  const saveSalary = async (event) => {
    event.preventDefault();
    if (!canCreate) return say('Your role cannot add employees to salary.', true);
    if (!salary.employee) return say('Select an employee.', true);
    setBusy(true);
    const result = await saveBusinessCompensation(businessProfileId, salary.employee, salary);
    if (result.success) {
      say('Employee added to salary.');
      setSalary({ employee: '', pay_type: 'monthly', pay_frequency: 'monthly', base_salary: '', currency: 'UGX', payroll_status: 'on_pay' });
    } else say(result.error, true);
    setBusy(false);
  };

  const saveSchedule = async (event) => {
    event.preventDefault();
    if (!canApprove) return say('Your role cannot set the work schedule.', true);
    if (schedule.scheduled_end <= schedule.scheduled_start) return say('Scheduled end time must be after the start time.', true);
    setBusy(true);
    const { error: saveError } = await supabase.from('cmms_attendance_payroll_settings').upsert({
      ...schedule,
      cmms_company_id: companyProfile.id,
      grace_minutes: Number(schedule.grace_minutes),
      monthly_work_days: Number(schedule.monthly_work_days),
      updated_at: new Date().toISOString()
    }, { onConflict: 'cmms_company_id' });
    if (saveError) say(saveError.message, true); else say(schedule.enabled ? 'Attendance deductions enabled and work schedule saved.' : 'Work schedule saved.');
    setBusy(false);
  };

  const creditDays = async (event) => {
    event.preventDefault();
    if (!canApprove) return say('Your role cannot add attendance days.', true);
    const days = parseInt(addDays.count, 10);
    if (!addDays.employee) return say('Select a staff member to credit days to.', true);
    if (!Number.isFinite(days) || days <= 0) return say('Days to add must be a positive whole number.', true);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('admin_add_attendance_days', {
      p_cmms_company_id: companyProfile.id,
      p_cmms_user_id: addDays.employee,
      p_days: days,
      p_reason: addDays.reason.trim() || null
    });
    if (rpcError) say(rpcError.message, true);
    else {
      say(`Added ${days} day${days === 1 ? '' : 's'} to the selected staff member.`);
      setAddDays({ employee: '', count: '', reason: '' });
      const refreshed = await supabase.rpc('get_attendance_day_adjustments', { p_cmms_company_id: companyProfile.id });
      setDayAdjustments(refreshed.data || []);
    }
    setBusy(false);
  };

  const reloadAdvances = async () => { const refreshed = await getCompanySalaryAdvances(companyProfile.id); setAdvances(refreshed.data || []); };
  const decideAdvance = async (advanceId, decision) => {
    if (!canApprove) return say('Your role cannot approve salary advances.', true);
    setBusy(true);
    const result = await decideSalaryAdvance(advanceId, decision);
    if (result.success) { say(decision === 'approved' ? 'Advance approved. Pay it from the list below.' : 'Advance rejected.'); await reloadAdvances(); }
    else say(result.error, true);
    setBusy(false);
  };
  const payAdvance = async (event) => {
    event.preventDefault();
    if (!canApprove) return say('Your role cannot pay salary advances.', true);
    const advance = advances.find((x) => x.id === advancePayment.advance);
    if (!advance) return say('Choose an approved advance to pay.', true);
    setBusy(true);
    try {
      let transactionId = null;
      if (advancePayment.method === 'ican') {
        if (advance.currency !== 'UGX') throw new Error('IcanEra wallet payroll currently supports UGX only. Record another currency as cash.');
        if (!advancePayment.pin) throw new Error('Enter the business-wallet PIN.');
        const transfer = await transferFromBusinessWallet({ businessProfileId, recipientUserId: advance.employee_user_id, amount: Number(advance.amount) / ICAN_TO_UGX, note: 'Salary advance', referenceId: advance.id, pin: advancePayment.pin });
        transactionId = transfer.transaction_id || transfer.id || null;
      }
      const result = await paySalaryAdvance({ advanceId: advance.id, paymentMethod: advancePayment.method, walletTransactionId: transactionId });
      if (!result.success) throw new Error(result.error);
      say(advancePayment.method === 'ican' ? 'Advance sent through the IcanEra business wallet. The employee still needs to confirm receipt.' : 'Cash advance recorded as paid. The employee still needs to confirm receipt.');
      setAdvancePayment({ advance: '', method: 'cash', pin: '' });
      await reloadAdvances();
    } catch (err) { say(err.message || 'Payment failed.', true); }
    setBusy(false);
  };

  return <div className="space-y-5">
    <CMMSEmployeeSelfService companyProfile={companyProfile} mode="payroll" />
    {(error || notice) && <p className={`rounded-lg border p-2 text-sm ${error ? 'border-red-800/50 bg-red-900/20 text-red-300' : 'border-emerald-800/50 bg-emerald-900/20 text-emerald-300'}`}>{error || notice}</p>}
    {busy && <p className="flex items-center gap-2 text-sm text-slate-400"><Loader size={16} className="animate-spin" /> Saving…</p>}

    {canCreate && <form onSubmit={saveSalary} className="grid gap-3 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6 md:grid-cols-2">
      <h3 className="flex items-center gap-2 font-semibold text-white md:col-span-2"><UserPlus className="h-5 w-5 text-emerald-400" />Add an employee to salary</h3>
      <label className="text-sm text-slate-300 md:col-span-2">Employee<select required value={salary.employee} onChange={(e) => setSalary((v) => ({ ...v, employee: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"><option value="">{loadingStaff ? 'Loading employees…' : 'Select employee'}</option>{employees.map((x) => <option key={x.authUserId} value={x.authUserId}>{x.name} — {x.role}</option>)}</select></label>
      <label className="text-sm text-slate-300">Pay type<select value={salary.pay_type} onChange={(e) => setSalary((v) => ({ ...v, pay_type: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"><option value="monthly">Salary</option><option value="hourly">Hourly worker</option><option value="per_ride">Per ride</option><option value="hybrid">Hybrid</option></select></label>
      <label className="text-sm text-slate-300">Pay period<select value={salary.pay_frequency} onChange={(e) => setSalary((v) => ({ ...v, pay_frequency: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="contract">Fixed contract</option></select></label>
      <label className="text-sm text-slate-300">Rate / base pay<input required type="number" min="0.01" step="0.01" value={salary.base_salary} onChange={(e) => setSalary((v) => ({ ...v, base_salary: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
      <label className="text-sm text-slate-300">Currency<input value={salary.currency} onChange={(e) => setSalary((v) => ({ ...v, currency: e.target.value.toUpperCase() }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
      <button disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50 md:col-span-2">Add to salary</button>
    </form>}

    {canApprove && <>
      <form onSubmit={saveSchedule} className="grid gap-3 rounded-2xl border border-indigo-800/60 bg-indigo-950/20 p-4 md:p-6 md:grid-cols-3">
        <h3 className="flex items-center gap-2 font-semibold text-white md:col-span-3"><Clock3 size={17} className="text-indigo-300" />Work schedule</h3>
        <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule((v) => ({ ...v, enabled: e.target.checked }))} /> Enable attendance deductions</label>
        <label className="text-sm text-slate-300">Time zone<input required value={schedule.timezone} onChange={(e) => setSchedule((v) => ({ ...v, timezone: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
        <label className="text-sm text-slate-300">Grace minutes<input required min="0" max="240" type="number" value={schedule.grace_minutes} onChange={(e) => setSchedule((v) => ({ ...v, grace_minutes: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
        <label className="text-sm text-slate-300">Work start<input required type="time" value={schedule.scheduled_start} onChange={(e) => setSchedule((v) => ({ ...v, scheduled_start: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
        <label className="text-sm text-slate-300">Work end<input required type="time" value={schedule.scheduled_end} onChange={(e) => setSchedule((v) => ({ ...v, scheduled_end: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
        <label className="text-sm text-slate-300">Monthly work days<input required min="1" step="0.5" type="number" value={schedule.monthly_work_days} onChange={(e) => setSchedule((v) => ({ ...v, monthly_work_days: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
        <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-50 md:col-span-3">Save work schedule</button>
      </form>

      <form onSubmit={creditDays} className="space-y-3 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
        <div><h3 className="flex items-center gap-2 font-semibold text-white"><Calendar className="h-5 w-5 text-emerald-400" />Apply days restriction</h3><p className="mt-1 text-xs text-slate-400">Credit extra attendance days present (for example approved field work, or an outage that stopped QR check-in). This can only add days — it can never reduce a staff member's recorded attendance.</p></div>
        <div className="grid gap-3 md:grid-cols-4">
          <select value={addDays.employee} onChange={(e) => setAddDays((v) => ({ ...v, employee: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"><option value="">{loadingStaff ? 'Loading staff…' : 'Select staff member'}</option>{(users || []).filter((u) => u?.is_active !== false).map((u) => <option key={u.id} value={u.id}>{u.full_name || u.user_name || u.email || 'Unnamed staff'}</option>)}</select>
          <input type="number" min="1" step="1" value={addDays.count} onChange={(e) => setAddDays((v) => ({ ...v, count: e.target.value }))} placeholder="Days to add" className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
          <input type="text" value={addDays.reason} onChange={(e) => setAddDays((v) => ({ ...v, reason: e.target.value }))} placeholder="Reason (optional)" className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
          <button disabled={busy || !addDays.employee || !addDays.count} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Add days</button>
        </div>
        {dayAdjustments.length > 0 && <div className="pt-2"><p className="text-xs font-semibold text-slate-400 mb-2">Adjustment history</p><div className="space-y-1 max-h-56 overflow-y-auto">{dayAdjustments.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 text-xs text-slate-400 px-3 py-2 bg-slate-950/60 border border-slate-800 rounded-lg"><span><span className="text-slate-200 font-semibold">{entry.user_name}</span> +{entry.days_added} day{entry.days_added === 1 ? '' : 's'}{entry.reason && <> — {entry.reason}</>}</span><span className="whitespace-nowrap">{new Date(entry.created_at).toLocaleDateString()}</span></div>)}</div></div>}
      </form>

      <div className="space-y-3 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
        <h3 className="flex items-center gap-2 font-semibold text-white"><Coins className="h-5 w-5 text-emerald-400" />Salary advance requests</h3>
        {advances.filter((a) => ['pending', 'approved', 'paid', 'confirmed'].includes(a.status)).length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">No open salary advance requests.</p> : <div className="space-y-2">{advances.filter((a) => ['pending', 'approved', 'paid', 'confirmed'].includes(a.status)).map((a) => { const employee = employees.find((x) => x.authUserId === a.employee_user_id); return <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm"><div><p className="font-medium text-slate-100">{employee?.name || a.employee_user_id}</p><p className="text-xs text-slate-400">{amount(a.amount, a.currency)}{a.reason ? ` — ${a.reason}` : ''}{a.status === 'confirmed' ? ` · ${amount(a.recovered_amount, a.currency)} recovered so far` : ''}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-800 px-2 py-1 text-xs capitalize text-slate-300">{a.status}</span>{a.status === 'pending' && <><button type="button" disabled={busy} onClick={() => decideAdvance(a.id, 'approved')} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">Approve</button><button type="button" disabled={busy} onClick={() => decideAdvance(a.id, 'rejected')} className="rounded-lg border border-red-600/60 px-2 py-1 text-xs font-semibold text-red-200 disabled:opacity-50">Reject</button></>}</div></div>; })}</div>}
        {advances.some((a) => a.status === 'approved') && <form onSubmit={payAdvance} className="grid gap-3 border-t border-slate-800 pt-4 md:grid-cols-4">
          <label className="text-sm text-slate-300 md:col-span-2">Advance to pay<select required value={advancePayment.advance} onChange={(e) => setAdvancePayment((v) => ({ ...v, advance: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"><option value="">Select an approved advance</option>{advances.filter((a) => a.status === 'approved').map((a) => <option key={a.id} value={a.id}>{employees.find((x) => x.authUserId === a.employee_user_id)?.name || a.employee_user_id} — {amount(a.amount, a.currency)}</option>)}</select></label>
          <label className="text-sm text-slate-300">Method<select value={advancePayment.method} onChange={(e) => setAdvancePayment((v) => ({ ...v, method: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"><option value="cash">Cash</option><option value="ican">IcanEra wallet</option></select></label>
          {advancePayment.method === 'ican' && <label className="text-sm text-slate-300">Wallet PIN<input required type="password" value={advancePayment.pin} onChange={(e) => setAdvancePayment((v) => ({ ...v, pin: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>}
          <button disabled={busy || !advancePayment.advance} className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50"><WalletCards size={16} />{advancePayment.method === 'ican' ? 'Pay with IcanEra wallet' : 'Record cash payment'}</button>
        </form>}
      </div>
    </>}
  </div>;
}
