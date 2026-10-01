import React, { useEffect, useState } from 'react';
import { Bus, CalendarDays, DollarSign, FileText, Loader, Star, Trash2, UploadCloud, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { getEmployeeRewardPoints, getStaffVisitorRatings, getAttendanceCheckoutPayConfirmations, getMyTransportPlan, getMySalaryAdvances, requestSalaryAdvance, confirmSalaryAdvanceReceived, cancelSalaryAdvance, getMyCompanySalaryWalletTransactions } from '../services/businessManagementService';
import cmmsEmploymentDocumentsService from '../services/cmmsEmploymentDocumentsService';
import { EMPLOYEE_DOCUMENT_CATEGORIES, addEmployeeDocument, removeEmployeeDocument, getMyEmployeeDocuments, getApplicationDocumentsForEmployee, importApplicationDocument } from '../services/cmmsEmployeeDocumentsService';
import CMMSDocumentSignModal from './CMMSDocumentSignModal';
import CMMSEmployeeWelfare from './CMMSEmployeeWelfare.jsx';
import CMMSItemCustodyPanel from './CMMSItemCustodyPanel.jsx';

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
  const [documents, setDocuments] = useState([]);
  const [myUserId, setMyUserId] = useState(null);
  const [signingDocument, setSigningDocument] = useState(null);
  const [myFiles, setMyFiles] = useState([]);
  const [fileForm, setFileForm] = useState({ category: EMPLOYEE_DOCUMENT_CATEGORIES[0].id, label: '', file: null });
  const [fileBusy, setFileBusy] = useState(false);
  const [fileNotice, setFileNotice] = useState('');
  const [fileError, setFileError] = useState('');
  const [applicationDocs, setApplicationDocs] = useState([]);

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

  useEffect(() => {
    if (mode !== 'payroll' || !companyProfile?.id) return;
    let cancelled = false;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (cancelled || !authData?.user?.id) return;
      setMyUserId(authData.user.id);
      const result = await cmmsEmploymentDocumentsService.getMyEmploymentDocuments(companyProfile.id);
      if (!cancelled && result.success) setDocuments(result.data);
      const filesResult = await getMyEmployeeDocuments(companyProfile.id);
      if (!cancelled && filesResult.success) setMyFiles(filesResult.data);
      const applicationResult = await getApplicationDocumentsForEmployee(companyProfile.id, authData.user.id);
      if (!cancelled && applicationResult.success) setApplicationDocs(applicationResult.data);
    })();
    return () => { cancelled = true; };
  }, [mode, companyProfile?.id]);

  const reloadDocuments = async () => {
    const result = await cmmsEmploymentDocumentsService.getMyEmploymentDocuments(companyProfile.id);
    if (result.success) setDocuments(result.data);
  };

  const reloadMyFiles = async () => {
    const result = await getMyEmployeeDocuments(companyProfile.id);
    if (result.success) setMyFiles(result.data);
  };
  const importMyApplicationDoc = async (jobApplicationId) => {
    if (!myUserId) return;
    setFileBusy(true); setFileNotice(''); setFileError('');
    const result = await importApplicationDocument({ companyId: companyProfile.id, employeeUserId: myUserId, jobApplicationId });
    if (result.success) { setFileNotice('CV imported from your job application.'); await reloadMyFiles(); }
    else setFileError(result.error);
    setFileBusy(false);
  };
  const uploadMyFile = async (e) => {
    e.preventDefault();
    if (!myUserId) return;
    if (!fileForm.label.trim()) { setFileError('Give this document a label.'); setFileNotice(''); return; }
    setFileBusy(true); setFileNotice(''); setFileError('');
    const result = await addEmployeeDocument({
      companyId: companyProfile.id, employeeUserId: myUserId,
      category: fileForm.category, label: fileForm.label.trim(), file: fileForm.file,
    });
    if (result.success) {
      setFileNotice('Document added.');
      setFileForm({ category: EMPLOYEE_DOCUMENT_CATEGORIES[0].id, label: '', file: null });
      await reloadMyFiles();
    } else setFileError(result.error);
    setFileBusy(false);
  };
  const removeMyFile = async (documentId) => {
    setFileBusy(true); setFileNotice(''); setFileError('');
    const result = await removeEmployeeDocument(documentId);
    if (result.success) { setFileNotice('Document removed.'); await reloadMyFiles(); }
    else setFileError(result.error);
    setFileBusy(false);
  };

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

  if (loading) return <div className="flex items-center gap-2 cmms-classic-card p-6 text-sm cmms-classic-muted"><Loader className="h-4 w-4 animate-spin" /> Loading your records…</div>;
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

  if (mode === 'transport') {
    const limit = Number(transportPlan?.monthly_limit || 0);
    const spend = Number(transportPlan?.spend_this_month || 0);
    const remaining = limit > 0 ? Math.max(limit - spend, 0) : null;
    // "completed"/"dispatched" rides carry an actual or estimated cost that's
    // already counted in spend_this_month above -- everything else (pending,
    // approved, cancelled, rejected) hasn't been charged against the plan yet.
    const chargedStatuses = ['completed', 'dispatched'];
    return (
      <div className="space-y-4 cmms-classic-card p-4 md:p-6">
        <div className="flex items-center gap-3">
          <Bus className="h-6 w-6 text-orange-400" />
          <div>
            <h2 className="cmms-classic-heading text-xl">My transport plan</h2>
            <p className="text-sm cmms-classic-muted">Only transport requests made by your account are shown.</p>
          </div>
        </div>
        {transportPlan?.has_plan ? (
          <div className="cmms-classic-callout">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold cmms-classic-heading">{transportPlan.contract_name}</p>
              <span className="cmms-classic-chip capitalize">{transportPlan.billing_cycle} plan</span>
            </div>
            <p className="mt-1 text-xs cmms-classic-muted">Allowed vehicles: {(transportPlan.allowed_vehicle_types || []).join(', ') || 'any'}</p>
            {limit > 0 && (
              <>
                <dl className="cmms-field-list mt-2">
                  <div className="cmms-field-row">
                    <dt>Used this month</dt>
                    <dd>{money(spend, transportPlan.currency)}</dd>
                  </div>
                  <div className="cmms-field-row">
                    <dt>Remaining</dt>
                    <dd className="text-emerald-400">{money(remaining, transportPlan.currency)}</dd>
                  </div>
                  <div className="cmms-field-row">
                    <dt>Plan limit</dt>
                    <dd>{money(limit, transportPlan.currency)}</dd>
                  </div>
                </dl>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/10">
                  <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(transportPlan.percent_used || 0, 100)}%` }} />
                </div>
              </>
            )}
            <p className="mt-2 text-xs cmms-classic-muted">{transportPlan.rides_this_month} ride(s) across {transportPlan.days_covered_this_month} day(s) this month</p>
          </div>
        ) : (
          <p className="text-sm cmms-classic-muted">Your company has no active transport plan yet.</p>
        )}
        <section className="cmms-classic-divider">
          <h3 className="mb-2 cmms-classic-heading text-sm">My journeys</h3>
          {rides.length === 0 ? <p className="text-sm cmms-classic-muted">No personal transport records yet.</p> : (
            <div>
              {rides.map(ride => {
                const cost = ride.estimated_total || 0;
                const charged = chargedStatuses.includes(ride.status);
                return (
                  <div key={ride.id} className="border-b last:border-b-0 py-2.5 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold cmms-classic-heading capitalize">{ride.status}</span>
                      <span className="cmms-classic-muted">{new Date(ride.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-1 cmms-classic-muted">{ride.pickup_location} → {ride.dropoff_location}</p>
                    <p className="mt-1 text-xs cmms-classic-muted opacity-75">
                      {ride.ride_count} ride(s) · {ride.requested_vehicle_type || 'Any vehicle'}
                      {cost > 0 ? ` · ${money(cost, transportPlan?.currency)} ${charged ? '(paid from plan)' : '(pending)'}` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  }

  return <div className="space-y-4 cmms-classic-card p-4 md:p-6"><div className="flex items-center gap-3"><DollarSign className="h-6 w-6 text-emerald-400" /><div><h2 className="cmms-classic-heading text-xl">My salary and attendance</h2><p className="text-sm cmms-classic-muted">Only your salary, payroll entries, and attendance are shown.</p></div></div>{compensation && <div className="cmms-classic-callout"><p className="cmms-classic-label">Current salary</p><p className="mt-1 text-2xl font-bold cmms-classic-heading">{money(compensation.base_salary, compensation.currency)}</p><p className="text-xs cmms-classic-muted capitalize">{compensation.pay_frequency || 'monthly'} · {compensation.payroll_status || 'on pay'}</p></div>}{(entries.length > 0 || unpaidDayCount > 0) && <dl className="cmms-field-list"><div className="cmms-field-row"><dt>Paid so far</dt><dd className="text-emerald-400">{money(paidTotal, currency)}</dd></div><div className="cmms-field-row"><dt>Waiting to be paid</dt><dd className="text-amber-400">{money(waitingTotal, currency)}{unpaidDayCount > 0 && <span className="block text-xs cmms-classic-muted font-normal normal-case">+ {unpaidDayCount} day(s) checked out, pay not yet confirmed</span>}</dd></div></dl>}<section className="cmms-classic-divider"><h3 className="mb-2 flex items-center gap-2 cmms-classic-heading text-sm"><CalendarDays className="h-4 w-4" /> My attendance</h3>
      {monthlyAttendance ? <dl className="cmms-field-list"><div className="cmms-field-row"><dt>Days present this month</dt><dd>{monthlyAttendance.days_present}</dd></div><div className="cmms-field-row"><dt>Check-ins this month</dt><dd>{monthlyAttendance.check_in_count}{monthlyAttendance.currently_checked_in && <span className="block text-xs text-emerald-400 font-normal normal-case">Currently checked in</span>}</dd></div></dl> : <p className="text-sm cmms-classic-muted">No attendance recorded this month yet.</p>}
      {attendance.length > 0 && <div className="mt-3 max-h-56 overflow-y-auto">{attendance.map((rec, i) => <div key={i} className="flex items-center justify-between gap-3 border-b last:border-b-0 px-1 py-2 text-xs cmms-classic-muted" style={{ borderColor: 'var(--color-border)' }}><span className="font-medium cmms-classic-heading text-xs">{new Date(rec.check_in_time).toLocaleDateString()}</span><span>In {new Date(rec.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{rec.check_out_time ? ` · Out ${new Date(rec.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' · Still checked in'}</span><span className="capitalize">{rec.status}</span></div>)}</div>}
      {(rewardPoints || myRating) && <dl className="cmms-field-list mt-3">{rewardPoints && <div className="cmms-field-row"><dt>Reward points</dt><dd>{rewardPoints.balance_points}<span className="block text-xs cmms-classic-muted font-normal normal-case">{rewardPoints.lifetime_earned_points} earned all-time{rewardPoints.pending_redemption_points > 0 ? ` · ${rewardPoints.pending_redemption_points} pending payout` : ''}</span></dd></div>}{myRating?.average_rating != null && <div className="cmms-field-row"><dt>Visitor rating</dt><dd className="flex items-center gap-1">{myRating.average_rating} <Star className="h-4 w-4 fill-amber-400 text-amber-400" /><span className="block text-xs cmms-classic-muted font-normal normal-case">from {myRating.rating_count} visitor rating(s)</span></dd></div>}</dl>}
    </section>
    <section className="cmms-classic-divider"><h3 className="mb-2 cmms-classic-heading text-sm">My payroll entries</h3>{entries.length === 0 ? <p className="text-sm cmms-classic-muted">No payroll entries yet.</p> : <div>{entries.map(entry => <div key={entry.id} className="flex justify-between border-b last:border-b-0 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }}><span className="capitalize cmms-classic-muted">{entry.status || 'draft'}</span><span className="font-semibold text-emerald-400">{money(entry.net_amount ?? entry.base_amount, entry.metadata?.currency)}</span></div>)}</div>}</section>
    <section className="cmms-classic-divider">
      <h3 className="mb-2 flex items-center gap-2 cmms-classic-heading text-sm"><Wallet className="h-4 w-4" /> IcanEra wallet activity</h3>
      <p className="mb-2 text-xs cmms-classic-muted">On-chain ICAN transactions between this company's business wallet and your personal wallet — the record behind a "paid" salary or advance.</p>
      {walletTransactions.length === 0 ? <p className="text-sm cmms-classic-muted">No wallet transactions from this company yet.</p> : <div className="max-h-56 overflow-y-auto">{walletTransactions.map(tx => <div key={tx.id} className="flex items-center justify-between gap-3 border-b last:border-b-0 px-1 py-2 text-xs" style={{ borderColor: 'var(--color-border)' }}><div><span className={`font-semibold ${tx.direction === 'received' ? 'text-emerald-400' : 'text-amber-400'}`}>{tx.direction === 'received' ? 'Received' : 'Sent'} {Number(tx.ican_amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ICAN</span>{tx.note && <p className="mt-0.5 cmms-classic-muted">{tx.note}</p>}</div><div className="text-right cmms-classic-muted"><p>{money(tx.local_amount, tx.local_currency)}</p><p>{new Date(tx.created_at).toLocaleDateString()}</p></div></div>)}</div>}
    </section>
    <section className="cmms-classic-divider">
      <h3 className="mb-2 flex items-center gap-2 cmms-classic-heading text-sm"><Wallet className="h-4 w-4" /> Salary advance</h3>
      {advanceError && <p className="mb-2 rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{advanceError}</p>}
      {advanceNotice && <p className="mb-2 rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-2 text-sm text-emerald-300">{advanceNotice}</p>}
      {liveAdvance ? <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between"><span className="font-semibold cmms-classic-heading">{money(liveAdvance.amount, liveAdvance.currency)}</span><span className="cmms-classic-chip capitalize">{liveAdvance.status}</span></div>
        {liveAdvance.reason && <p className="text-xs cmms-classic-muted">{liveAdvance.reason}</p>}
        {liveAdvance.status === 'pending' && <button type="button" disabled={advanceBusy} onClick={() => cancelMyAdvance(liveAdvance.id)} className="cmms-classic-btn-secondary px-3 py-1.5 text-xs">Cancel request</button>}
        {liveAdvance.status === 'approved' && <p className="text-xs text-amber-400">Approved — waiting to be paid.</p>}
        {liveAdvance.status === 'paid' && <><p className="text-xs text-amber-400">Marked paid ({liveAdvance.payment_method === 'ican' ? 'IcanEra wallet' : 'cash'}). Confirm below once you have actually received it — this is required before it can be deducted from your pay.</p><button type="button" disabled={advanceBusy} onClick={() => confirmAdvanceReceipt(liveAdvance.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">I received this</button></>}
        {liveAdvance.status === 'confirmed' && <p className="text-xs cmms-classic-muted">{money(liveAdvance.recovered_amount, liveAdvance.currency)} of {money(liveAdvance.amount, liveAdvance.currency)} recovered from your pay so far.</p>}
      </div> : <form onSubmit={submitAdvanceRequest} className="grid gap-2 sm:grid-cols-3">
        <input required type="number" min="0.01" step="0.01" value={advanceForm.amount} onChange={e => setAdvanceForm(v => ({ ...v, amount: e.target.value }))} placeholder={`Amount (${currency || 'UGX'})`} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
        <input value={advanceForm.reason} onChange={e => setAdvanceForm(v => ({ ...v, reason: e.target.value }))} placeholder="Reason (optional)" className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
        <button disabled={advanceBusy} className="cmms-classic-btn-primary px-3 py-2 text-sm">{advanceBusy ? 'Requesting…' : 'Request advance'}</button>
      </form>}
    </section>
    <CMMSEmployeeWelfare companyProfile={companyProfile} />
    <CMMSItemCustodyPanel companyProfile={companyProfile} embedded />
    <section className="cmms-classic-divider">
      <h3 className="mb-2 flex items-center gap-2 cmms-classic-heading text-sm"><UploadCloud className="h-4 w-4" /> My documents</h3>
      <p className="mb-2 text-xs cmms-classic-muted">Add your National ID, certificates, CV, bank details, tax PIN/NSSF certificates, or anything else HR needs on file for your payroll record. Only you and payroll staff can see these.</p>
      {fileError && <p className="mb-2 rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{fileError}</p>}
      {fileNotice && <p className="mb-2 rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-2 text-sm text-emerald-300">{fileNotice}</p>}
      {applicationDocs.filter((doc) => !myFiles.some((f) => f.source_job_application_id === doc.job_application_id)).length > 0 && (
        <div className="mb-3 space-y-2 cmms-classic-callout">
          <p className="text-xs cmms-classic-muted">Already on file from your job application — no need to upload again:</p>
          {applicationDocs.filter((doc) => !myFiles.some((f) => f.source_job_application_id === doc.job_application_id)).map((doc) => (
            <div key={doc.job_application_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="cmms-classic-heading">CV / Resume ({doc.reference_code})</span>
              <button type="button" disabled={fileBusy} onClick={() => importMyApplicationDoc(doc.job_application_id)} className="cmms-classic-btn-primary px-3 py-1.5 text-xs">Use this document</button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={uploadMyFile} className="grid gap-2 sm:grid-cols-4">
        <select value={fileForm.category} onChange={(e) => setFileForm((v) => ({ ...v, category: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
          {EMPLOYEE_DOCUMENT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input required value={fileForm.label} onChange={(e) => setFileForm((v) => ({ ...v, label: e.target.value }))} placeholder="Label, e.g. Bachelor's degree" className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white sm:col-span-2" />
        <input required type="file" onChange={(e) => setFileForm((v) => ({ ...v, file: e.target.files?.[0] || null }))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:text-white" />
        <button disabled={fileBusy} className="cmms-classic-btn-primary px-3 py-2 text-sm sm:col-span-4">{fileBusy ? 'Uploading…' : 'Add document'}</button>
      </form>
      {myFiles.length > 0 && (
        <div className="mt-3">
          {myFiles.map((doc) => (
            <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 border-b last:border-b-0 py-2.5 text-sm" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <p className="font-semibold cmms-classic-heading">{doc.label}</p>
                <p className="text-xs cmms-classic-muted">{EMPLOYEE_DOCUMENT_CATEGORIES.find((c) => c.id === doc.category)?.label || doc.category}{doc.verified ? ' · Verified by HR' : ''}</p>
              </div>
              <div className="flex items-center gap-3">
                {doc.file_url && <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300">View</a>}
                <button type="button" disabled={fileBusy} onClick={() => removeMyFile(doc.id)} className="text-red-400 hover:text-red-300 disabled:opacity-50" title="Remove"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
    {documents.length > 0 && (
      <section className="cmms-classic-divider">
        <h3 className="mb-2 flex items-center gap-2 cmms-classic-heading text-sm"><FileText className="h-4 w-4" /> My employment documents</h3>
        <div>
          {documents.map((doc) => (
            <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 border-b last:border-b-0 py-2.5 text-sm" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <p className="font-semibold cmms-classic-heading">{doc.title}</p>
                <p className="text-xs capitalize cmms-classic-muted">{doc.status} · {doc.document_type === 'employment_contract' ? 'Contract' : 'Appointment letter'}</p>
              </div>
              <div className="flex items-center gap-3">
                {doc.document_url && <a href={doc.document_url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300">View PDF</a>}
                {doc.status === 'issued' && <button onClick={() => setSigningDocument(doc)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">Review & sign</button>}
                {doc.status === 'signed' && <span className="text-xs text-emerald-400">Signed {doc.signed_at ? new Date(doc.signed_at).toLocaleDateString() : ''}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>
    )}
    {signingDocument && (
      <CMMSDocumentSignModal
        document={signingDocument}
        userId={myUserId}
        onClose={() => setSigningDocument(null)}
        onSigned={() => { setSigningDocument(null); reloadDocuments(); }}
      />
    )}
  </div>;
}
