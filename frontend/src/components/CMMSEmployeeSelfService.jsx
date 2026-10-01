import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bus, CalendarDays, ChevronDown, DollarSign, FileText, HeartPulse, Loader, LogOut, Maximize2, Receipt, Star, Trash2, UploadCloud, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { getEmployeeRewardPoints, getStaffVisitorRatings, getAttendanceCheckoutPayConfirmations, getMyTransportPlan, getMySalaryAdvances, requestSalaryAdvance, confirmSalaryAdvanceReceived, cancelSalaryAdvance, getMyCompanySalaryWalletTransactions } from '../services/businessManagementService';
import cmmsEmploymentDocumentsService from '../services/cmmsEmploymentDocumentsService';
import { EMPLOYEE_DOCUMENT_CATEGORIES, addEmployeeDocument, removeEmployeeDocument, getMyEmployeeDocuments, getApplicationDocumentsForEmployee, importApplicationDocument } from '../services/cmmsEmployeeDocumentsService';
import CMMSDocumentSignModal from './CMMSDocumentSignModal';
import CMMSEmployeeWelfare from './CMMSEmployeeWelfare.jsx';
import CMMSItemCustodyPanel from './CMMSItemCustodyPanel.jsx';

// Plain titled block used inside a tab: small serif heading, optional hint on
// the right, no box around it.
function Block({ title, hint, children }) {
  return (
    <section className="cmms-block py-3 first:pt-1">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="cmms-classic-heading text-sm">{title}</h3>
        {hint && <span className="text-xs cmms-classic-muted">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

// Scrollable tab bar -- one row that swipes sideways on the smallest phones.
// A dot on a tab means something there needs the employee's attention.
function TabBar({ tabs, active, onChange, flush = false }) {
  return (
    <div role="tablist" className={`flex gap-1 overflow-x-auto border-b ${flush ? 'mt-2' : '-mx-4 mt-4 px-4 md:-mx-6 md:px-6'}`} style={{ borderColor: 'var(--color-border)', scrollbarWidth: 'none' }}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={active === t.id} onClick={() => onChange(t.id)}
          className={`relative flex flex-shrink-0 items-center !bg-transparent gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm ${active === t.id ? 'cmms-classic-heading' : 'cmms-classic-muted'}`}
          style={{ border: 0, borderRadius: 0, boxShadow: active === t.id ? 'inset 0 -3px 0 var(--ac, #c4a052)' : 'none', marginBottom: -1, fontWeight: active === t.id ? 700 : 500, color: active === t.id ? 'var(--ac, #c4a052)' : undefined, transition: 'box-shadow .25s ease, color .2s ease' }}>
          {t.icon}{t.label}
          {t.alert && <span className="h-2 w-2 rounded-full" style={{ background: '#d97706' }} aria-label="Needs attention" />}
        </button>
      ))}
    </div>
  );
}

const MAX_OPEN_ADVANCES = 3;
const INSTALLMENT_CHOICES = [1, 2, 3, 4, 6, 9, 12];
const planInstallment = (amount, installments) => Math.ceil((amount / Math.max(installments || 1, 1)) * 100) / 100;
const rowLine = { borderColor: 'var(--color-border)' };
const timeFmt = { hour: '2-digit', minute: '2-digit' };

const money = (value, currency = 'UGX') => `${currency} ${Number(value || 0).toLocaleString()}`;

// This screen intentionally makes employee-level requests only. It is used
// for roles whose tool scope is "own" and must never receive company payroll
// or transport records through component props.
export default function CMMSEmployeeSelfService({ companyProfile, mode, autoFull = true }) {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pay');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [fullPage, setFullPage] = useState(false);
  useEffect(() => {
    if (!fullPage) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFullPage(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [fullPage]);
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
  const [advanceForm, setAdvanceForm] = useState({ amount: '', reason: '', installments: '1', note: '' });
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
    const result = await requestSalaryAdvance(companyProfile.id, amount, compensation?.currency || null, advanceForm.reason, Number(advanceForm.installments) || 1, advanceForm.note);
    if (result.success) { setAdvanceNotice('Advance requested. Waiting for approval.'); setAdvanceForm({ amount: '', reason: '', installments: '1', note: '' }); await reloadAdvances(); }
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
  const OPEN_ADVANCE = ['pending', 'approved', 'paid', 'confirmed'];
  const openAdvances = advances.filter(a => OPEN_ADVANCE.includes(a.status));
  const closedAdvances = advances.filter(a => !OPEN_ADVANCE.includes(a.status));

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

  const unconfirmedAdvanceAction = openAdvances.some(a => a.status === 'paid');
  const filesToImport = applicationDocs.filter((doc) => !myFiles.some((f) => f.source_job_application_id === doc.job_application_id));
  const needsSigning = documents.filter(d => d.status === 'issued').length;

  const tabsDef = [
        { id: 'pay', accent: 'gold', label: 'Pay', icon: <Receipt className="h-4 w-4" /> },
        { id: 'attendance', accent: 'navy', label: 'Attendance', icon: <CalendarDays className="h-4 w-4" /> },
        { id: 'advance', accent: 'emerald', label: 'Advance', icon: <Wallet className="h-4 w-4" />, alert: unconfirmedAdvanceAction },
        { id: 'leave', accent: 'plum', label: 'Leave & HR', icon: <HeartPulse className="h-4 w-4" /> },
        { id: 'items', accent: 'teal', label: 'Items', icon: <LogOut className="h-4 w-4" /> },
        { id: 'docs', accent: 'burgundy', label: 'Documents', icon: <FileText className="h-4 w-4" />, alert: needsSigning > 0 || filesToImport.length > 0 }
      ];

  const panel = (
    <div role="tabpanel">
        {tab === 'pay' && (
          <div className="divide-y" style={rowLine}>
            <Block title="Payroll entries" hint={entries.length ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` : null}>
              {entries.length === 0 ? <p className="text-sm cmms-classic-muted">No payroll entries yet.</p> : entries.map(entry => (
                <div key={entry.id} className="flex justify-between border-b last:border-b-0 py-2 text-sm" style={rowLine}>
                  <span className="capitalize cmms-classic-muted">{entry.status || 'draft'}</span>
                  <span className="font-semibold cmms-tone-ok">{money(entry.net_amount ?? entry.base_amount, entry.metadata?.currency)}</span>
                </div>
              ))}
            </Block>
            <Block title="IcanEra wallet activity">
              <p className="mb-2 text-xs cmms-classic-muted">ICAN transactions between this company's business wallet and your personal wallet — the record behind a "paid" salary or advance.</p>
              {walletTransactions.length === 0 ? <p className="text-sm cmms-classic-muted">No wallet transactions from this company yet.</p> : (
                <div className="max-h-56 overflow-y-auto">
                  {walletTransactions.map(tx => (
                    <div key={tx.id} className="flex items-start justify-between gap-3 border-b last:border-b-0 px-1 py-2 text-xs" style={rowLine}>
                      <div className="min-w-0">
                        <span className={`font-semibold ${tx.direction === 'received' ? 'cmms-tone-ok' : 'cmms-tone-warn'}`}>{tx.direction === 'received' ? 'Received' : 'Sent'} {Number(tx.ican_amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ICAN</span>
                        {tx.note && <p className="mt-0.5 break-words cmms-classic-muted">{tx.note}</p>}
                      </div>
                      <div className="flex-shrink-0 text-right cmms-classic-muted"><p>{money(tx.local_amount, tx.local_currency)}</p><p>{new Date(tx.created_at).toLocaleDateString()}</p></div>
                    </div>
                  ))}
                </div>
              )}
            </Block>
          </div>
        )}

        {tab === 'attendance' && (
          <Block title="This month" hint={monthlyAttendance ? `${monthlyAttendance.days_present} day(s) present` : null}>
            {monthlyAttendance ? (
              <dl className="cmms-field-list">
                <div className="cmms-field-row"><dt>Days present this month</dt><dd>{monthlyAttendance.days_present}</dd></div>
                <div className="cmms-field-row"><dt>Check-ins this month</dt><dd>{monthlyAttendance.check_in_count}{monthlyAttendance.currently_checked_in && <span className="block text-xs cmms-tone-ok font-normal normal-case">Currently checked in</span>}</dd></div>
              </dl>
            ) : <p className="text-sm cmms-classic-muted">No attendance recorded this month yet.</p>}
            {attendance.length > 0 && (
              <div className="mt-3 max-h-56 overflow-y-auto">
                {attendance.map((rec, i) => (
                  <div key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b last:border-b-0 px-1 py-2 text-xs cmms-classic-muted" style={rowLine}>
                    <span className="font-medium cmms-classic-heading">{new Date(rec.check_in_time).toLocaleDateString()}</span>
                    <span>In {new Date(rec.check_in_time).toLocaleTimeString([], timeFmt)}{rec.check_out_time ? ` · Out ${new Date(rec.check_out_time).toLocaleTimeString([], timeFmt)}` : ' · Still checked in'}</span>
                    <span className="capitalize">{rec.status}</span>
                  </div>
                ))}
              </div>
            )}
            {(rewardPoints || myRating) && (
              <dl className="cmms-field-list mt-3">
                {rewardPoints && <div className="cmms-field-row"><dt>Reward points</dt><dd>{rewardPoints.balance_points}<span className="block text-xs cmms-classic-muted font-normal normal-case">{rewardPoints.lifetime_earned_points} earned all-time{rewardPoints.pending_redemption_points > 0 ? ` · ${rewardPoints.pending_redemption_points} pending payout` : ''}</span></dd></div>}
                {myRating?.average_rating != null && <div className="cmms-field-row"><dt>Visitor rating</dt><dd className="flex items-center gap-1">{myRating.average_rating} <Star className="h-4 w-4 fill-amber-400 text-amber-400" /><span className="block text-xs cmms-classic-muted font-normal normal-case">from {myRating.rating_count} visitor rating(s)</span></dd></div>}
              </dl>
            )}
          </Block>
        )}

        {tab === 'advance' && (
          <div className="divide-y" style={rowLine}>
            <Block title="Ask for an advance" hint={`${openAdvances.length} of ${MAX_OPEN_ADVANCES} open`}>
              {advanceError && <p className="mb-2 text-sm cmms-tone-bad">{advanceError}</p>}
              {advanceNotice && <p className="mb-2 text-sm cmms-tone-ok">{advanceNotice}</p>}
              {openAdvances.length >= MAX_OPEN_ADVANCES ? (
                <p className="text-sm cmms-classic-muted">You have {MAX_OPEN_ADVANCES} advances open, which is the most allowed at once. You can ask for another when one is fully paid back or cancelled.</p>
              ) : (
                <form onSubmit={submitAdvanceRequest} className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="cmms-classic-label">Amount ({currency || 'UGX'})
                      <input required type="number" min="0.01" step="0.01" value={advanceForm.amount} onChange={e => setAdvanceForm(v => ({ ...v, amount: e.target.value }))} placeholder="e.g. 50000" className="cmms-classic-field mt-1 normal-case tracking-normal font-normal" />
                    </label>
                    <label className="cmms-classic-label">What it is for
                      <input value={advanceForm.reason} onChange={e => setAdvanceForm(v => ({ ...v, reason: e.target.value }))} placeholder="e.g. school fees (optional)" className="cmms-classic-field mt-1 normal-case tracking-normal font-normal" />
                    </label>
                  </div>
                  <label className="cmms-classic-label block">How you will pay it back
                    <select value={advanceForm.installments} onChange={e => setAdvanceForm(v => ({ ...v, installments: e.target.value }))} className="cmms-classic-field mt-1 normal-case tracking-normal font-normal">
                      {INSTALLMENT_CHOICES.map(n => <option key={n} value={n}>{n === 1 ? 'All at once, from my next pay' : `In ${n} equal parts, one from each pay`}</option>)}
                    </select>
                  </label>
                  <p className="rounded-lg px-3 py-2 text-xs cmms-classic-muted" style={{ border: '1px dashed var(--color-border)' }}>
                    {Number(advanceForm.amount) > 0
                      ? <>Repayment plan: <strong className="cmms-classic-heading">{money(planInstallment(Number(advanceForm.amount), Number(advanceForm.installments)), currency)}</strong> is taken from {Number(advanceForm.installments) === 1 ? 'your next pay' : `each of your next ${advanceForm.installments} pays`}{Number(advanceForm.installments) > 1 ? ` (${money(Number(advanceForm.amount), currency)} in total)` : ''}. It starts only after you confirm you received the money.</>
                      : 'Enter an amount to see exactly how it will be taken back from your pay.'}
                  </p>
                  <label className="cmms-classic-label block">Note for the approver (optional)
                    <textarea rows={2} value={advanceForm.note} onChange={e => setAdvanceForm(v => ({ ...v, note: e.target.value }))} placeholder="Anything about how you would like to repay" className="cmms-classic-field mt-1 resize-none normal-case tracking-normal font-normal" />
                  </label>
                  <button disabled={advanceBusy} className="cmms-classic-btn-primary w-full px-3 py-2 text-sm sm:w-auto">{advanceBusy ? 'Requesting…' : 'Request advance'}</button>
                </form>
              )}
            </Block>

            {openAdvances.length > 0 && (
              <Block title="My open advances">
                {openAdvances.map((a) => {
                  const plan = Math.max(Number(a.repayment_installments) || 1, 1);
                  const pct = Math.min(100, Math.round((Number(a.recovered_amount || 0) / Number(a.amount || 1)) * 100));
                  return (
                    <div key={a.id} className="space-y-1.5 border-b last:border-b-0 py-3 text-sm" style={rowLine}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold cmms-classic-heading">{money(a.amount, a.currency)}</span>
                        <span className="cmms-classic-chip capitalize">{a.status}</span>
                      </div>
                      {a.reason && <p className="text-xs cmms-classic-muted">{a.reason}</p>}
                      <p className="text-xs cmms-classic-muted">Pay back: {plan === 1 ? 'all at once from the next pay' : `${money(planInstallment(Number(a.amount), plan), a.currency)} from each of ${plan} pays`}{a.repayment_note ? ` · “${a.repayment_note}”` : ''}</p>
                      {a.status === 'confirmed' && (
                        <>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#c4a052' }} /></div>
                          <p className="text-xs cmms-classic-muted">{money(a.recovered_amount, a.currency)} of {money(a.amount, a.currency)} paid back so far.</p>
                        </>
                      )}
                      {a.status === 'pending' && <button type="button" disabled={advanceBusy} onClick={() => cancelMyAdvance(a.id)} className="cmms-classic-btn-secondary px-3 py-1.5 text-xs">Cancel request</button>}
                      {a.status === 'approved' && <p className="text-xs cmms-tone-warn">Approved — waiting to be paid.</p>}
                      {a.status === 'paid' && <>
                        <p className="text-xs cmms-tone-warn">Marked paid ({a.payment_method === 'ican' ? 'IcanEra wallet' : 'cash'}). Confirm once you have actually received it — paying it back starts only after you confirm.</p>
                        <button type="button" disabled={advanceBusy} onClick={() => confirmAdvanceReceipt(a.id)} className="cmms-classic-btn-primary w-full px-3 py-2 text-xs disabled:opacity-50 sm:w-auto">I received this</button>
                      </>}
                    </div>
                  );
                })}
              </Block>
            )}

            {closedAdvances.length > 0 && (
              <Block title="Earlier requests">
                {closedAdvances.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 border-b last:border-b-0 py-2 text-sm" style={rowLine}>
                    <span className="cmms-classic-heading font-semibold">{money(a.amount, a.currency)}{a.created_at && <span className="ml-2 text-xs font-normal cmms-classic-muted">{new Date(a.created_at).toLocaleDateString()}</span>}</span>
                    <span className="cmms-classic-chip capitalize">{a.status}</span>
                  </div>
                ))}
              </Block>
            )}
          </div>
        )}

        {tab === 'leave' && <CMMSEmployeeWelfare companyProfile={companyProfile} bare />}

        {tab === 'items' && <CMMSItemCustodyPanel companyProfile={companyProfile} embedded bare />}

        {tab === 'docs' && (
          <div className="divide-y" style={rowLine}>
            {documents.length > 0 && (
              <Block title="Employment documents" hint={needsSigning ? `${needsSigning} to sign` : null}>
                {documents.map((doc) => (
                  <div key={doc.id} className="flex flex-col gap-2 border-b last:border-b-0 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" style={rowLine}>
                    <div className="min-w-0">
                      <p className="break-words font-semibold cmms-classic-heading">{doc.title}</p>
                      <p className="text-xs capitalize cmms-classic-muted">{doc.status} · {doc.document_type === 'employment_contract' ? 'Contract' : 'Appointment letter'}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0 sm:justify-end">
                      {doc.document_url && <a href={doc.document_url} target="_blank" rel="noreferrer" className="cmms-classic-btn-secondary flex-1 px-3 py-1.5 text-center text-xs sm:flex-none">View PDF</a>}
                      {doc.status === 'issued' && <button onClick={() => setSigningDocument(doc)} className="cmms-classic-btn-primary flex-1 px-3 py-1.5 text-xs sm:flex-none">Review & sign</button>}
                      {doc.status === 'signed' && <span className="text-xs font-semibold cmms-tone-ok">Signed {doc.signed_at ? new Date(doc.signed_at).toLocaleDateString() : ''}</span>}
                    </div>
                  </div>
                ))}
              </Block>
            )}
            <Block title="My documents">
              <p className="mb-2 text-xs cmms-classic-muted">National ID, certificates, CV, bank details, tax PIN/NSSF — anything HR needs on file. Only you and payroll staff can see these.</p>
              {fileError && <p className="mb-2 text-sm cmms-tone-bad">{fileError}</p>}
              {fileNotice && <p className="mb-2 text-sm cmms-tone-ok">{fileNotice}</p>}
              {filesToImport.length > 0 && (
                <div className="mb-3 space-y-2 cmms-classic-callout">
                  <p className="text-xs cmms-classic-muted">Already on file from your job application — no need to upload again:</p>
                  {filesToImport.map((doc) => (
                    <div key={doc.job_application_id} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className="cmms-classic-heading">CV / Resume ({doc.reference_code})</span>
                      <button type="button" disabled={fileBusy} onClick={() => importMyApplicationDoc(doc.job_application_id)} className="cmms-classic-btn-primary px-3 py-1.5 text-xs">Use this document</button>
                    </div>
                  ))}
                </div>
              )}
              <form onSubmit={uploadMyFile} className="grid gap-2 sm:grid-cols-4">
                <select value={fileForm.category} onChange={(e) => setFileForm((v) => ({ ...v, category: e.target.value }))} className="cmms-classic-field">
                  {EMPLOYEE_DOCUMENT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <input required value={fileForm.label} onChange={(e) => setFileForm((v) => ({ ...v, label: e.target.value }))} placeholder="Label, e.g. Bachelor's degree" className="cmms-classic-field sm:col-span-2" />
                <input required type="file" onChange={(e) => setFileForm((v) => ({ ...v, file: e.target.files?.[0] || null }))} className="cmms-classic-field !px-2 !py-1.5 text-xs" />
                <button disabled={fileBusy} className="cmms-classic-btn-primary px-3 py-2 text-sm sm:col-span-4">{fileBusy ? 'Uploading…' : 'Add document'}</button>
              </form>
              {myFiles.length > 0 && (
                <div className="mt-3">
                  {myFiles.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between gap-3 border-b last:border-b-0 py-2.5 text-sm" style={rowLine}>
                      <div className="min-w-0">
                        <p className="break-words font-semibold cmms-classic-heading">{doc.label}</p>
                        <p className="text-xs cmms-classic-muted">{EMPLOYEE_DOCUMENT_CATEGORIES.find((c) => c.id === doc.category)?.label || doc.category}{doc.verified ? ' · Verified' : ''}</p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-3">
                        {doc.file_url && <a href={doc.file_url} target="_blank" rel="noreferrer" className="cmms-classic-btn-secondary px-3 py-1 text-xs">View</a>}
                        <button type="button" disabled={fileBusy} onClick={() => removeMyFile(doc.id)} className="cmms-tone-bad disabled:opacity-50" title="Remove" aria-label="Remove document"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Block>
          </div>
        )}
      </div>
  );

  return (
    <div className="cmms-classic-card p-4 md:p-6">
      <button type="button" onClick={() => setSummaryOpen((o) => !o)} aria-expanded={summaryOpen}
        className="flex w-full items-center justify-between gap-3 text-left !bg-transparent"
        style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
        <span className="flex min-w-0 items-center gap-3">
          <DollarSign className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--color-primary)' }} />
          <span className="min-w-0">
            <span className="cmms-classic-heading block text-lg leading-tight">My salary and attendance</span>
            {!summaryOpen && <span className="block truncate text-xs cmms-classic-muted">
              {compensation ? `${money(compensation.base_salary, compensation.currency)} · ` : ''}Paid {money(paidTotal, currency)} · Waiting {money(waitingTotal, currency)}{unpaidDayCount > 0 ? ` · ${unpaidDayCount} day(s) unconfirmed` : ''}
            </span>}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 cmms-classic-muted transition-transform ${summaryOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {summaryOpen && (compensation || entries.length > 0 || unpaidDayCount > 0) && (
        <dl className="mt-4 grid grid-cols-1 gap-y-3 sm:grid-cols-3">
          {compensation && (
            <div className="sm:pr-4">
              <dt className="cmms-classic-label">Current salary</dt>
              <dd className="cmms-classic-heading text-xl">{money(compensation.base_salary, compensation.currency)}</dd>
              <dd className="text-xs capitalize cmms-classic-muted">{compensation.pay_frequency || 'monthly'} · {compensation.payroll_status || 'on pay'}</dd>
            </div>
          )}
          {(entries.length > 0 || unpaidDayCount > 0) && (
            <>
              <div className="sm:border-l sm:px-4" style={rowLine}>
                <dt className="cmms-classic-label">Paid so far</dt>
                <dd className="cmms-tone-ok text-lg font-bold">{money(paidTotal, currency)}</dd>
              </div>
              <div className="sm:border-l sm:pl-4" style={rowLine}>
                <dt className="cmms-classic-label">Waiting to be paid</dt>
                <dd className="cmms-tone-warn text-lg font-bold">{money(waitingTotal, currency)}</dd>
                {unpaidDayCount > 0 && <dd className="text-xs cmms-classic-muted">+ {unpaidDayCount} day(s) checked out, pay not yet confirmed</dd>}
              </div>
            </>
          )}
        </dl>
      )}

      <TabBar active={tab} onChange={(id) => { setTab(id); if (autoFull) setFullPage(true); }} tabs={tabsDef} />

      {!fullPage && (
        <div className="mt-3">
          <div className="flex justify-end">
            <button type="button" onClick={() => setFullPage(true)} className="inline-flex items-center gap-1.5 text-xs cmms-classic-muted !bg-transparent" style={{ background: 'transparent', border: 0, boxShadow: 'none' }}>
              <Maximize2 className="h-3.5 w-3.5" /> Open full page
            </button>
          </div>
          {panel}
        </div>
      )}

      {fullPage && (
        <div className="cmms-fullpage fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="sticky top-0 z-10 border-b px-4 pb-0 pt-3 md:px-6" style={{ background: 'var(--color-bg, #fbf7ee)', borderColor: 'var(--color-border)' }}>
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <button type="button" onClick={() => setFullPage(false)} className="cmms-classic-btn-secondary inline-flex !h-auto !min-h-0 items-center gap-1.5 !px-3 !py-1.5 text-xs"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
              <h2 className="cmms-classic-heading truncate text-lg">{tabsDef.find((t) => t.id === tab)?.label}</h2>
            </div>
            <div className="mx-auto max-w-3xl"><TabBar active={tab} onChange={setTab} tabs={tabsDef} flush /></div>
          </div>
          <div className="mx-auto max-w-3xl px-4 py-4 md:px-6">{panel}</div>
        </div>
      )}

      {signingDocument && (
        <CMMSDocumentSignModal
          document={signingDocument}
          userId={myUserId}
          onClose={() => setSigningDocument(null)}
          onSigned={() => { setSigningDocument(null); reloadDocuments(); }}
        />
      )}
    </div>
  );
}
