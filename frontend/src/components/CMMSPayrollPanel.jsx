import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Clock3, DollarSign, Loader, Maximize2, Trash2, UploadCloud, WalletCards, Info } from 'lucide-react';
import { applyAttendanceToPayroll, applyLeavePayrollDeductions, applySalaryAdvanceRecovery, createBusinessPayrollPeriod, decideSalaryAdvance, getAttendanceCheckoutPayConfirmations, getBusinessAccessMembers, getBusinessCompensation, getBusinessPayrollEntries, getBusinessPayrollPeriods, getCompanySalaryAdvances, getPendingRewardRedemptions, getRewardsSettings, payRewardRedemption, paySalaryAdvance, recordPayrollPayment, resolveEmployeeAuthIds, saveBusinessCompensation, saveRewardsSettings, syncBusinessPayrollDraftStaff } from '../services/businessManagementService';
import { ICAN_TO_UGX, transferFromBusinessWallet } from '../services/icanWalletService';
import { supabase } from '../lib/supabase/client';
import CMMSEmployeeSelfService from './CMMSEmployeeSelfService.jsx';
import TimeZoneSelect from './TimeZoneSelect.jsx';
import { EMPLOYEE_DOCUMENT_CATEGORIES, addEmployeeDocument, getApplicationDocumentsForEmployee, getCompanyEmployeeDocuments, importApplicationDocument, removeEmployeeDocument, setEmployeeDocumentVerified } from '../services/cmmsEmployeeDocumentsService';

const today = new Date().toISOString().slice(0, 10);
const amount = (value, currency = 'UGX') => `${currency} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Self-contained status-tone palette instead of plain Tailwind color
// utilities (bg-emerald-600, text-red-300, ...) -- the app's
// ThemeContext.jsx repaints several of those stock classes (with
// !important) to a single mapped "primary" color based on whichever theme
// is active, which would otherwise flatten "paid" (green), "pending"
// (amber) and "rejected" (red) into one indistinguishable color. None of
// the pay- classnames below are stock Tailwind utilities, so that override
// can't reach them -- same fix CMMSAnnouncementsPanel's CAP_STYLES and
// CMMSWrittenTestBuilder's WTB_STYLES already use. Defaults to readable
// tones on the classic ivory surface; re-pointed for the dark-background
// theme presets.
const PAYROLL_STYLES = `
.payroll-scope {
  --pay-success-bg: rgba(16, 185, 129, 0.15);
  --pay-success-text: #047857;
  --pay-info-bg: rgba(14, 165, 233, 0.15);
  --pay-info-text: #0369a1;
  --pay-warning-bg: rgba(245, 158, 11, 0.15);
  --pay-warning-text: #b45309;
  --pay-danger-bg: rgba(239, 68, 68, 0.13);
  --pay-danger-text: #dc2626;
  --pay-neutral-bg: rgba(100, 116, 139, 0.15);
  --pay-neutral-text: #475569;
}
:root[data-theme="dark"] .payroll-scope,
:root[data-theme="purple"] .payroll-scope,
:root[data-theme="green"] .payroll-scope,
:root[data-theme="ocean"] .payroll-scope,
:root[data-theme="sienna"] .payroll-scope {
  --pay-success-bg: rgba(16, 185, 129, 0.18);
  --pay-success-text: #6ee7b7;
  --pay-info-bg: rgba(14, 165, 233, 0.18);
  --pay-info-text: #7dd3fc;
  --pay-warning-bg: rgba(245, 158, 11, 0.18);
  --pay-warning-text: #fcd34d;
  --pay-danger-bg: rgba(239, 68, 68, 0.18);
  --pay-danger-text: #fca5a5;
  --pay-neutral-bg: rgba(148, 163, 184, 0.18);
  --pay-neutral-text: #cbd5e1;
}
.pay-badge { display: inline-flex; align-items: center; gap: .25rem; border-radius: 999px; padding: .25rem .6rem; font-size: .7rem; font-weight: 700; white-space: nowrap; }
.pay-badge-success { background: var(--pay-success-bg); color: var(--pay-success-text); }
.pay-badge-info { background: var(--pay-info-bg); color: var(--pay-info-text); }
.pay-badge-warning { background: var(--pay-warning-bg); color: var(--pay-warning-text); }
.pay-badge-danger { background: var(--pay-danger-bg); color: var(--pay-danger-text); }
.pay-badge-neutral { background: var(--pay-neutral-bg); color: var(--pay-neutral-text); }
.pay-notice { border-radius: 10px; padding: .6rem .9rem; font-size: .85rem; border: 1px solid; }
.pay-notice-success { border-color: var(--pay-success-text); background: var(--pay-success-bg); color: var(--pay-success-text); }
.pay-notice-danger { border-color: var(--pay-danger-text); background: var(--pay-danger-bg); color: var(--pay-danger-text); }
.pay-btn-approve { background: #10b981; color: #fff; border-radius: 10px; font-weight: 700; }
.pay-btn-approve:hover { background: #059669; }
.pay-btn-approve:disabled { opacity: .5; }
.pay-btn-reject { background: transparent; border: 1px solid #ef4444; color: #dc2626; border-radius: 10px; font-weight: 700; }
.pay-btn-reject:hover { background: rgba(239, 68, 68, 0.08); }
.pay-btn-reject:disabled { opacity: .5; }
:root[data-theme="dark"] .payroll-scope .pay-btn-reject,
:root[data-theme="purple"] .payroll-scope .pay-btn-reject,
:root[data-theme="green"] .payroll-scope .pay-btn-reject,
:root[data-theme="ocean"] .payroll-scope .pay-btn-reject,
:root[data-theme="sienna"] .payroll-scope .pay-btn-reject { color: #fca5a5; border-color: #fca5a5; }
.pay-table th { text-align: left; padding: .5rem; font-size: .68rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--pay-neutral-text); border-bottom: 1px solid rgba(196, 160, 82, 0.28); }
:root[data-theme="dark"] .payroll-scope .pay-table th,
:root[data-theme="purple"] .payroll-scope .pay-table th,
:root[data-theme="green"] .payroll-scope .pay-table th,
:root[data-theme="ocean"] .payroll-scope .pay-table th,
:root[data-theme="sienna"] .payroll-scope .pay-table th { border-bottom-color: var(--color-border); }
.pay-table td { padding: .5rem; border-bottom: 1px solid rgba(196, 160, 82, 0.16); }
:root[data-theme="dark"] .payroll-scope .pay-table td,
:root[data-theme="purple"] .payroll-scope .pay-table td,
:root[data-theme="green"] .payroll-scope .pay-table td,
:root[data-theme="ocean"] .payroll-scope .pay-table td,
:root[data-theme="sienna"] .payroll-scope .pay-table td { border-bottom-color: var(--color-border); }
.pay-field { margin-top: .25rem; width: 100%; }
.pay-row { border-radius: 10px; border: 1px solid rgba(196, 160, 82, 0.26); padding: .75rem; }
:root[data-theme="dark"] .payroll-scope .pay-row,
:root[data-theme="purple"] .payroll-scope .pay-row,
:root[data-theme="green"] .payroll-scope .pay-row,
:root[data-theme="ocean"] .payroll-scope .pay-row,
:root[data-theme="sienna"] .payroll-scope .pay-row { border-color: var(--color-border); }
`;

const BADGE_TONE_CLASS = { success: 'pay-badge-success', info: 'pay-badge-info', warning: 'pay-badge-warning', danger: 'pay-badge-danger', neutral: 'pay-badge-neutral' };
function StatusBadge({ tone = 'neutral', title, children }) {
  return <span className={`pay-badge ${BADGE_TONE_CLASS[tone] || BADGE_TONE_CLASS.neutral}`} title={title}>{children}</span>;
}

function Banner({ error, notice }) {
  if (!error && !notice) return null;
  return error
    ? <p className="pay-notice pay-notice-danger" role="alert">{error}</p>
    : <p className="pay-notice pay-notice-success" role="status">{notice}</p>;
}

// Accordion wrapper used throughout this page so a long stack of setup
// forms and review tables reads as a set of clearly labeled, individually
// collapsible sections instead of one long undifferentiated scroll --
// especially on a phone, where every one of these forms used to render
// fully expanded whether or not it was the thing someone opened Payroll to
// do today.
const SECTION_ACCENTS = {
  'Attendance deductions and work time': 'navy',
  'Salary profile': 'emerald',
  'New attendance payroll run': 'gold',
  'Review and pay': 'burgundy',
  'Reward redemptions': 'plum',
  'Salary advance requests': 'teal'
};
function CollapsibleSection({ title, subtitle, icon, badge, accent, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const [info, setInfo] = useState(false);
  const bodyId = useRef(`sec-${Math.random().toString(36).slice(2)}`).current;
  const toggle = () => setOpen(o => !o);
  return (
    <section className={`cmms-sec cmms-accent-${accent || SECTION_ACCENTS[title] || 'gold'}`} data-open={open}>
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

// Small (i) button that reveals a short explanation only when asked.
function InfoTip({ label = 'More information', children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label={label} title={label} className="cmms-info-btn"><Info className="h-3.5 w-3.5" aria-hidden="true" /></button>
      {open && <div className="cmms-info cmms-classic-muted basis-full">{children}</div>}
    </>
  );
}

// Page header shared by every payroll view. It stays one slim row: a gold
// medallion, the title with the company beneath it, a couple of live chips,
// and an (i) button that opens the longer explanation only when asked.
// "Full page" lifts the whole view (tabs included) to a full-screen page.
function PayrollHeader({ Icon = DollarSign, description, intro, chips = [], tabs, fullPage, onFullPage, onBack, company }) {
  const [info, setInfo] = useState(false);
  const shown = chips.filter(Boolean);
  return (
    <div className="cmms-accent-gold space-y-2.5">
      <div className="flex items-center gap-3">
        <span className="cmms-medallion"><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="cmms-classic-heading text-lg leading-tight">CMMS Payroll</h2>
          {company && <p className="truncate text-xs cmms-classic-muted">{company}</p>}
        </div>
        {(description || intro) && (
          <button type="button" onClick={() => setInfo(v => !v)} aria-expanded={info} aria-label="About this page" title="What is this page?" className="cmms-info-btn">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        {fullPage
          ? <button type="button" onClick={onBack} className="cmms-classic-btn-secondary inline-flex !h-auto !min-h-0 flex-shrink-0 items-center gap-1.5 !px-3 !py-1.5 text-xs"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back</button>
          : <button type="button" onClick={onFullPage} className="cmms-info-btn" title="Open this tab as a full page" aria-label="Open full page"><Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /></button>}
      </div>
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((c, i) => <span key={i} className="cmms-classic-chip" style={{ animation: `cmms-rise .45s ease ${i * 80}ms both` }}>{c}</span>)}
        </div>
      )}
      {info && (
        <div className="cmms-info cmms-classic-muted space-y-1">
          {description && <p>{description}</p>}
          {intro && <p>{intro}</p>}
        </div>
      )}
      <div className="cmms-ornament" aria-hidden="true" />
      {tabs}
    </div>
  );
}

const PAYROLL_TABS = [
  { id: 'payroll', label: 'Payroll runs' },
  { id: 'staff', label: 'Staff on payroll' },
  { id: 'my-salary', label: 'My Salary' },
  { id: 'files', label: 'Employee files', requiresFiles: true },
];
const TAB_ACCENTS = { payroll: 'gold', staff: 'emerald', 'my-salary': 'navy', files: 'burgundy' };
function PayrollTabs({ current, onChange, canViewFiles, staffCount }) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [&>button]:flex-shrink-0 [&>button]:whitespace-nowrap" role="tablist" aria-label="Payroll sections" style={{ scrollbarWidth: 'none' }}>
      {PAYROLL_TABS.filter(tab => !tab.requiresFiles || canViewFiles).map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={current === tab.id}
          onClick={() => onChange(tab.id)}
          className={`cmms-ptab cmms-accent-${TAB_ACCENTS[tab.id] || 'gold'} ${current === tab.id ? 'is-active' : ''}`}
        >
          {tab.label}{tab.id === 'staff' && staffCount != null ? ` (${staffCount})` : ''}
        </button>
      ))}
    </div>
  );
}

export default function CMMSPayrollPanel({ companyProfile, users = [], currentUser, userRole, isCreator, canCreate = false, canEdit = false, canApprove = false, canView = false, attendancePayrollOnly = false }) {
  const businessProfileId = companyProfile?.pichin_business_profile_id;
  const [members, setMembers] = useState([]); const [extraUsers, setExtraUsers] = useState([]); const [compensation, setCompensation] = useState([]);
  const [periods, setPeriods] = useState([]); const [entries, setEntries] = useState([]); const [periodId, setPeriodId] = useState('');
  const [payrollTab, setPayrollTab] = useState('payroll');
  const [fullPage, setFullPage] = useState(false);
  useEffect(() => {
    if (!fullPage) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFullPage(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [fullPage]);
  const [salary, setSalary] = useState({ employee: '', pay_type: 'monthly', pay_frequency: 'monthly', base_salary: '', currency: 'UGX', payroll_status: 'on_pay', contract_start: '', contract_end: '', contract_total: '' });
  const [dates, setDates] = useState({ start: `${today.slice(0, 8)}01`, end: today }); const [payment, setPayment] = useState({ entry: '', method: 'cash', pin: '' });
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const automaticRunRef = useRef(new Set());
  const [dailyConfirmations, setDailyConfirmations] = useState([]);
  const [rewardRedemptions, setRewardRedemptions] = useState([]);
  const [rewardPayment, setRewardPayment] = useState({ redemption: '', method: 'cash', pin: '' });
  const [rewardsSettings, setRewardsSettings] = useState(null);
  const [rewardRateSaving, setRewardRateSaving] = useState(false);
  const [advances, setAdvances] = useState([]);
  const [advancePayment, setAdvancePayment] = useState({ advance: '', method: 'cash', pin: '' });
  const [attendanceSettings, setAttendanceSettings] = useState({ enabled: false, timezone: 'UTC', scheduled_start: '09:00', scheduled_end: '17:00', grace_minutes: 0, monthly_work_days: 22, deduct_late_arrivals: true, deduct_early_departures: true });
  const [employeeFiles, setEmployeeFiles] = useState([]);
  const [fileFilterEmployee, setFileFilterEmployee] = useState('');
  const [fileForm, setFileForm] = useState({ employee: '', category: EMPLOYEE_DOCUMENT_CATEGORIES[0].id, label: '', file: null });
  const [applicationDocs, setApplicationDocs] = useState([]);
  const canManageFiles = canEdit;
  const canViewFiles = canEdit || canView;
  const employees = useMemo(() => {
    const byId = new Map(); const adminId = currentUser?.id || currentUser?.user?.id || currentUser?.user_id;
    [...users, ...extraUsers].filter(u => u.authUserId).forEach(u => byId.set(u.authUserId, u));
    members.forEach(m => byId.set(m.auth_user_id, { authUserId: m.auth_user_id, name: m.user?.full_name || m.job_title || 'Employee', email: m.user?.email || '', role: m.job_title || 'Employee' }));
    if (adminId && (isCreator || userRole === 'admin') && !byId.has(adminId)) byId.set(adminId, { authUserId: adminId, name: currentUser?.full_name || currentUser?.email || 'Administrator', role: 'Administrator' });
    return [...byId.values()].filter(u => u.authUserId);
  }, [users, extraUsers, members, currentUser, userRole, isCreator]);
  // The most recent compensation row per employee (by effective_from). A
  // salary "update" is really just saving a new effective-dated row — this
  // map is what lets the form pre-fill with what's currently on file instead
  // of the admin having to retype every field from a blank slate.
  const latestPayByEmployee = useMemo(() => {
    const map = new Map();
    [...compensation]
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))
      .forEach(profile => { if (profile.employee_user_id && !map.has(profile.employee_user_id)) map.set(profile.employee_user_id, profile); });
    return map;
  }, [compensation]);
  // Daily-paid staff never get a business_payroll_entries row from this panel
  // (see createBusinessPayrollPeriod/syncBusinessPayrollDraftStaff) — they are
  // settled one day at a time by cmms_settle_attendance_pay at check-out. This
  // rolls this month's confirmations up per employee so the Staff on payroll
  // table can show what checkout already confirmed instead of a false "unpaid".
  const dailySummaryByEmployee = useMemo(() => {
    const map = new Map();
    dailyConfirmations.forEach(row => {
      const current = map.get(row.cmms_user_id) || { confirmedDays: 0, paidDays: 0, unpaidDays: 0, lastConfirmedAt: null, currency: null };
      current.confirmedDays += 1;
      if (row.paid) current.paidDays += 1; else current.unpaidDays += 1;
      if (!current.lastConfirmedAt || row.confirmed_at > current.lastConfirmedAt) current.lastConfirmedAt = row.confirmed_at;
      map.set(row.cmms_user_id, current);
    });
    return map;
  }, [dailyConfirmations]);
  const staffOnPayroll = useMemo(() => {
    const staffById = new Map(employees.map(employee => [employee.authUserId, employee]));
    // A selected payroll run is authoritative: the staff tab and its review
    // table must describe the exact same group of employees.
    if (periodId) return entries.map(entry => {
      const profile = latestPayByEmployee.get(entry.employee_user_id) || {};
      return {
        ...profile,
        id: profile.id || entry.id,
        employee_user_id: entry.employee_user_id,
        base_salary: entry.base_amount,
        currency: entry.metadata?.currency || profile.currency || 'UGX',
        payroll_status: profile.payroll_status || 'on_pay',
        payroll_progress: entry.status,
        employee: staffById.get(entry.employee_user_id) || { name: 'Saved payroll staff', role: 'Employee' }
      };
    });
    return [...latestPayByEmployee.values()].filter(profile => profile.payroll_status === 'on_pay').map(profile => ({
      ...profile,
      dailySummary: profile.pay_frequency === 'daily' ? (dailySummaryByEmployee.get(profile.employee_user_id) || { confirmedDays: 0, paidDays: 0, unpaidDays: 0, lastConfirmedAt: null }) : null,
      employee: staffById.get(profile.employee_user_id) || { name: 'Saved payroll staff', role: 'Employee' }
    }));
  }, [latestPayByEmployee, employees, entries, periodId, dailySummaryByEmployee]);
  const period = periods.find(p => p.id === periodId);
  // Selecting an employee loads their current pay allocation into the form
  // (if any) so "updating" a salary means adjusting what's on file rather
  // than retyping every field from blank. Saving still writes a new
  // effective-dated row — payroll history for past periods is unaffected.
  const editingProfile = salary.employee ? latestPayByEmployee.get(salary.employee) : null;
  const pickEmployeeForSalary = employeeId => {
    const existing = employeeId ? latestPayByEmployee.get(employeeId) : null;
    setSalary(existing ? {
      employee: employeeId,
      pay_type: existing.pay_type || 'monthly',
      pay_frequency: existing.pay_frequency || 'monthly',
      base_salary: String(existing.base_salary ?? ''),
      currency: existing.currency || 'UGX',
      payroll_status: existing.payroll_status || 'on_pay',
      contract_start: existing.contract_start || '',
      contract_end: existing.contract_end || '',
      contract_total: existing.contract_total != null ? String(existing.contract_total) : ''
    } : { employee: employeeId, pay_type: 'monthly', pay_frequency: 'monthly', base_salary: '', currency: 'UGX', payroll_status: 'on_pay', contract_start: '', contract_end: '', contract_total: '' });
  };
  const say = (text, bad = false) => { setNotice(bad ? '' : text); setError(bad ? text : ''); };
  const load = async () => { if (!businessProfileId || !companyProfile?.id) return; setBusy(true); const settingsRequest = supabase.from('cmms_attendance_payroll_settings').select('*').eq('cmms_company_id', companyProfile.id).maybeSingle(); if (attendancePayrollOnly) { const settings = await settingsRequest; if (settings.data) setAttendanceSettings(current => ({ ...current, ...settings.data })); if (settings.error) say(settings.error.message, true); setBusy(false); return; } const now = new Date(); const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`; const [c, m, u, p, settings, dailyPay, rewards, rewardSettings, advanceRequests] = await Promise.all([getBusinessCompensation(businessProfileId), getBusinessAccessMembers(businessProfileId), resolveEmployeeAuthIds(users), getBusinessPayrollPeriods(businessProfileId), settingsRequest, getAttendanceCheckoutPayConfirmations({ cmmsCompanyId: companyProfile.id, periodStart: monthStart, periodEnd: monthEnd }), getPendingRewardRedemptions(companyProfile.id), getRewardsSettings(companyProfile.id), getCompanySalaryAdvances(companyProfile.id)]); setCompensation(c.data || []); setMembers(m.data || []); setExtraUsers(u || []); setPeriods(p.data || []); if (settings.data) setAttendanceSettings(current => ({ ...current, ...settings.data })); setDailyConfirmations(dailyPay.data || []); setRewardRedemptions(rewards.data || []); setRewardsSettings(rewardSettings.data || { cmms_company_id: companyProfile.id, enabled: false, points_per_checkin: 1, points_per_early_checkin: 2, early_checkin_minutes: 10, points_per_report: 3, points_per_task_completed: 5, points_per_message: 0, message_daily_cap: 5, ican_coins_per_point: 0, auto_redeem_enabled: false, auto_redeem_threshold_points: 100 }); setAdvances(advanceRequests.data || []); if (c.error || m.error || p.error || settings.error || dailyPay.error) say(c.error?.message || m.error?.message || p.error?.message || settings.error?.message || dailyPay.error?.message, true); setBusy(false); };
  const payReward = async e => { e.preventDefault(); if (!canApprove) return say('Your role cannot approve or pay payroll entries.', true); const redemption = rewardRedemptions.find(x => x.id === rewardPayment.redemption); if (!redemption) return say('Choose a reward redemption to pay.', true); setBusy(true); try { let walletTransactionId = null; if (rewardPayment.method === 'ican') { if (!rewardPayment.pin) throw new Error('Enter the business-wallet PIN.'); const transfer = await transferFromBusinessWallet({ businessProfileId, recipientUserId: redemption.employee_user_id, amount: Number(redemption.ican_amount), note: `Reward points redeemed (${redemption.user_name})`, referenceId: redemption.id, pin: rewardPayment.pin }); walletTransactionId = transfer.transaction_id || transfer.id || null; } const result = await payRewardRedemption({ redemptionId: redemption.id, paymentMethod: rewardPayment.method, walletTransactionId }); if (!result.success) throw new Error(result.error); say(rewardPayment.method === 'ican' ? 'Reward points paid through the IcanEra business wallet.' : 'Reward points recorded as paid in cash.'); setRewardPayment({ redemption: '', method: 'cash', pin: '' }); await load(); } catch (err) { say(err.message || 'Payment failed.', true); } setBusy(false); };
  // Only the coins-per-point rate is editable here — full point-value tuning
  // stays in Attendance -> Rewards. Always saves the whole settings object
  // we already loaded (not just this field) so this can't silently zero out
  // the other point values or flip enabled/auto_redeem_enabled back off.
  const saveRewardRate = async e => { e.preventDefault(); if (!canEdit) return say('Your role cannot edit payroll settings.', true); if (!rewardsSettings) return; setRewardRateSaving(true); const result = await saveRewardsSettings(companyProfile.id, rewardsSettings); result.success ? say('icaneracoins-per-point rate saved.') : say(result.error, true); if (result.success) await load(); setRewardRateSaving(false); };
  const loadEntries = async id => { setPeriodId(id); const selectedPeriod = periods.find(item => item.id === id); if (selectedPeriod?.status === 'draft') { const sync = await syncBusinessPayrollDraftStaff({ payrollPeriod: selectedPeriod, compensation }); if (!sync.success) say(sync.error, true); } const result = await getBusinessPayrollEntries(id); setEntries(result.data || []); if (result.error) say(result.error.message, true); };
  const loadFiles = async () => { if (!companyProfile?.id) return; const result = await getCompanyEmployeeDocuments(companyProfile.id); if (result.success) setEmployeeFiles(result.data); else say(result.error, true); };
  const uploadEmployeeFile = async e => { e.preventDefault(); if (!canManageFiles) return say('Your role cannot add employee documents.', true); if (!fileForm.employee) return say('Select an employee.', true); if (!fileForm.label.trim()) return say('Give this document a label.', true); setBusy(true); const result = await addEmployeeDocument({ companyId: companyProfile.id, employeeUserId: fileForm.employee, category: fileForm.category, label: fileForm.label.trim(), file: fileForm.file }); if (result.success) { say('Document added.'); setFileForm({ employee: '', category: EMPLOYEE_DOCUMENT_CATEGORIES[0].id, label: '', file: null }); await loadFiles(); } else say(result.error, true); setBusy(false); };
  const removeEmployeeFile = async documentId => { if (!canManageFiles) return say('Your role cannot remove employee documents.', true); setBusy(true); const result = await removeEmployeeDocument(documentId); if (result.success) { say('Document removed.'); await loadFiles(); } else say(result.error, true); setBusy(false); };
  const toggleFileVerified = async (documentId, verified) => { if (!canManageFiles) return say('Your role cannot verify employee documents.', true); setBusy(true); const result = await setEmployeeDocumentVerified(documentId, verified); if (result.success) { say(verified ? 'Document marked verified.' : 'Verification cleared.'); await loadFiles(); } else say(result.error, true); setBusy(false); };
  const importApplicationDoc = async jobApplicationId => { if (!canManageFiles || !fileForm.employee) return; setBusy(true); const result = await importApplicationDocument({ companyId: companyProfile.id, employeeUserId: fileForm.employee, jobApplicationId }); if (result.success) { say('Document imported from job application.'); await loadFiles(); } else say(result.error, true); setBusy(false); };
  useEffect(() => { load(); }, [businessProfileId, users]);
  useEffect(() => { if (payrollTab === 'files' && canViewFiles) loadFiles(); }, [payrollTab, canViewFiles, companyProfile?.id]);
  useEffect(() => {
    if (!canManageFiles || !fileForm.employee || !companyProfile?.id) { setApplicationDocs([]); return; }
    let cancelled = false;
    getApplicationDocumentsForEmployee(companyProfile.id, fileForm.employee).then(result => { if (!cancelled && result.success) setApplicationDocs(result.data); });
    return () => { cancelled = true; };
  }, [canManageFiles, fileForm.employee, companyProfile?.id]);
  useEffect(() => { if (!periodId && periods[0]?.id) loadEntries(periods[0].id); }, [periods]);
  useEffect(() => {
    if (attendancePayrollOnly || !businessProfileId || !compensation.some(profile => profile.payroll_status === 'on_pay' && profile.pay_frequency !== 'daily')) return;
    const now = new Date();
    const year = now.getFullYear(); const month = now.getMonth();
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;
    const runKey = `${businessProfileId}:${monthStart}:${monthEnd}:${attendanceSettings.enabled ? 'attendance' : 'base'}`;
    if (automaticRunRef.current.has(runKey)) return;
    automaticRunRef.current.add(runKey);
    // This draft/calc run is an automatic background convenience, not
    // something the person on screen asked for. Surfacing its failures
    // through the same notice/error banner used for explicit actions
    // (like "Salary profile saved") overwrites that message and makes a
    // successful save look like it failed. Log instead so it's still
    // diagnosable without misleading the user; automaticRunRef keeps this
    // from silently retrying every render, and the explicit "Create run"
    // button still surfaces its own errors normally.
    const ensureCurrentMonthDraft = async () => {
      let currentPeriod = periods.find(item => item.period_start === monthStart && item.period_end === monthEnd && !['cancelled', 'locked'].includes(item.status));
      if (!currentPeriod) {
        const created = await createBusinessPayrollPeriod({ businessProfileId, periodStart: monthStart, periodEnd: monthEnd, compensation });
        if (!created.success) { console.warn('Automatic payroll draft creation skipped:', created.error); return; }
        currentPeriod = created.data;
        await load();
      }
      await loadEntries(currentPeriod.id);
      if (attendanceSettings.enabled && ['draft', 'pending_approval'].includes(currentPeriod.status)) {
        const calculated = await applyAttendanceToPayroll(currentPeriod.id);
        if (!calculated.success) console.warn('Automatic attendance payroll calculation skipped:', calculated.error);
        else await loadEntries(currentPeriod.id);
      }
    };
    ensureCurrentMonthDraft();
  }, [attendancePayrollOnly, attendanceSettings.enabled, businessProfileId, compensation, periods]);
  const saveSalary = async e => { e.preventDefault(); if (!canEdit) return say('Your role cannot edit payroll salary profiles.', true); if (!salary.employee) return say('Select an employee.', true); setBusy(true); const wasEditing = Boolean(editingProfile); const result = await saveBusinessCompensation(businessProfileId, salary.employee, salary); result.success ? say(wasEditing ? 'Salary profile updated.' : 'Salary profile saved.') : say(result.error, true); if (result.success) { setSalary({ employee: '', pay_type: 'monthly', pay_frequency: 'monthly', base_salary: '', currency: 'UGX', payroll_status: 'on_pay', contract_start: '', contract_end: '', contract_total: '' }); await load(); } setBusy(false); };
  const createRun = async e => { e.preventDefault(); if (!canCreate) return say('Your role cannot create payroll runs.', true); if (dates.end < dates.start) return say('Period end must be on or after start.', true); setBusy(true); const result = await createBusinessPayrollPeriod({ businessProfileId, periodStart: dates.start, periodEnd: dates.end, compensation }); if (result.success) { say('Draft payroll created from saved active salary profiles.'); await load(); await loadEntries(result.data.id); } else say(result.error, true); setBusy(false); };
  const calculate = async () => { if (!canEdit) return say('Your role cannot calculate or edit payroll.', true); if (!periodId) return say('Select a payroll period.', true); setBusy(true); const result = await applyAttendanceToPayroll(periodId); result.success ? say(`Attendance deductions calculated for ${result.data.length} employee(s).`) : say(result.error, true); if (result.success) await loadEntries(periodId); setBusy(false); };
  const saveAttendanceSettings = async e => { e.preventDefault(); if (!canEdit) return say('Your role cannot edit payroll settings.', true); if (attendanceSettings.scheduled_end <= attendanceSettings.scheduled_start) return say('Scheduled end time must be after the start time.', true); setBusy(true); const { error: saveError } = await supabase.from('cmms_attendance_payroll_settings').upsert({ ...attendanceSettings, cmms_company_id: companyProfile.id, grace_minutes: Number(attendanceSettings.grace_minutes), monthly_work_days: Number(attendanceSettings.monthly_work_days), updated_at: new Date().toISOString() }, { onConflict: 'cmms_company_id' }); if (saveError) say(saveError.message, true); else say(attendanceSettings.enabled ? 'Attendance deductions enabled and work schedule saved.' : 'Work schedule saved. Enable deductions when ready.'); setBusy(false); };
  const pay = async e => { e.preventDefault(); if (!canApprove) return say('Your role cannot approve or pay payroll entries.', true); const entry = entries.find(x => x.id === payment.entry); if (!entry) return say('Choose an unpaid employee.', true); setBusy(true); try { let transactionId = null; if (payment.method === 'ican') { if ((entry.metadata?.currency || 'UGX') !== 'UGX') throw new Error('IcanEra wallet payroll currently supports UGX salary entries only. Record another currency as cash.'); if (!payment.pin) throw new Error('Enter the business-wallet PIN.'); const transfer = await transferFromBusinessWallet({ businessProfileId, recipientUserId: entry.employee_user_id, amount: Number(entry.net_amount) / ICAN_TO_UGX, note: `Payroll ${period?.period_start || ''} - ${period?.period_end || ''}`, referenceId: entry.id, pin: payment.pin }); transactionId = transfer.transaction_id || transfer.id || null; } const result = await recordPayrollPayment({ entryId: entry.id, paymentMethod: payment.method, walletTransactionId: transactionId }); if (!result.success) throw new Error(result.error); say(payment.method === 'ican' ? 'Salary sent through the existing IcanEra business wallet.' : 'Cash salary recorded as paid.'); setPayment({ entry: '', method: 'cash', pin: '' }); await loadEntries(periodId); } catch (err) { say(err.message || 'Payment failed.', true); } setBusy(false); };
  const decideAdvance = async (advanceId, decision) => { if (!canApprove) return say('Your role cannot approve salary advances.', true); setBusy(true); const result = await decideSalaryAdvance(advanceId, decision); if (result.success) { say(decision === 'approved' ? 'Advance approved. Pay it from the list below.' : 'Advance rejected.'); await load(); } else say(result.error, true); setBusy(false); };
  const payAdvance = async e => { e.preventDefault(); if (!canApprove) return say('Your role cannot pay salary advances.', true); const advance = advances.find(x => x.id === advancePayment.advance); if (!advance) return say('Choose an approved advance to pay.', true); setBusy(true); try { let transactionId = null; if (advancePayment.method === 'ican') { if (advance.currency !== 'UGX') throw new Error('IcanEra wallet payroll currently supports UGX only. Record another currency as cash.'); if (!advancePayment.pin) throw new Error('Enter the business-wallet PIN.'); const transfer = await transferFromBusinessWallet({ businessProfileId, recipientUserId: advance.employee_user_id, amount: Number(advance.amount) / ICAN_TO_UGX, note: `Salary advance`, referenceId: advance.id, pin: advancePayment.pin }); transactionId = transfer.transaction_id || transfer.id || null; } const result = await paySalaryAdvance({ advanceId: advance.id, paymentMethod: advancePayment.method, walletTransactionId: transactionId }); if (!result.success) throw new Error(result.error); say(advancePayment.method === 'ican' ? 'Advance sent through the IcanEra business wallet. The employee still needs to confirm receipt.' : 'Cash advance recorded as paid. The employee still needs to confirm receipt.'); setAdvancePayment({ advance: '', method: 'cash', pin: '' }); await load(); } catch (err) { say(err.message || 'Payment failed.', true); } setBusy(false); };
  const recoverAdvances = async () => { if (!canApprove) return say('Your role cannot recover salary advances.', true); if (!periodId) return say('Select a payroll period.', true); setBusy(true); const result = await applySalaryAdvanceRecovery(periodId); result.success ? say(result.data.length ? `Salary advance recovery applied for ${result.data.length} employee(s).` : 'No confirmed salary advances to recover in this run.') : say(result.error, true); if (result.success) { await loadEntries(periodId); await load(); } setBusy(false); };
  const applyLeave = async () => { if (!canEdit) return say('Your role cannot calculate or edit payroll.', true); if (!periodId) return say('Select a payroll period.', true); setBusy(true); const result = await applyLeavePayrollDeductions(periodId); result.success ? say(result.data.length ? `Unpaid-leave deductions applied for ${result.data.length} employee(s).` : 'No approved unpaid leave to deduct in this run.') : say(result.error, true); if (result.success) await loadEntries(periodId); setBusy(false); };

  if (!businessProfileId) return <div className="cmms-classic-callout p-6 text-sm">Link this CMMS company to its Pichin business profile before using payroll.</div>;

  const payrollStatusTone = status => status === 'on_pay' ? 'success' : status === 'on_hold' ? 'warning' : 'neutral';
  const payrollStatusLabel = status => status === 'on_pay' ? 'On pay' : status === 'on_hold' ? 'On hold' : 'Ended';
  const progressTone = progress => progress === 'paid' ? 'success' : progress === 'approved' ? 'info' : 'warning';
  const advanceTone = status => status === 'rejected' ? 'danger' : status === 'paid' || status === 'confirmed' ? 'success' : status === 'approved' ? 'info' : 'warning';

  const rootProps = fullPage
    ? { className: 'payroll-scope cmms-fullpage space-y-5 fixed inset-0 z-50 overflow-y-auto p-4 md:p-8' }
    : { className: 'payroll-scope space-y-5 cmms-classic-card p-4 md:p-6' };
  const currentPeriod = periods.find(p => p.id === periodId);
  const headerProps = { chips: [`${staffOnPayroll.length} on pay`, currentPeriod && `${currentPeriod.period_start} → ${currentPeriod.period_end} · ${currentPeriod.status}`], fullPage, onFullPage: () => setFullPage(true), onBack: () => setFullPage(false), company: companyProfile.company_name };
  const openTab = id => { setPayrollTab(id); setFullPage(true); }; // choosing a tab opens it as a full page
  const tabsFor = count => <PayrollTabs current={payrollTab} onChange={openTab} canViewFiles={canViewFiles} staffCount={count} />;

  if (payrollTab === 'my-salary') return (
    <div {...rootProps}>
      <style>{PAYROLL_STYLES}</style>
      <PayrollHeader {...headerProps} description="Your own salary and payroll records" tabs={tabsFor(null)} />
      <CMMSEmployeeSelfService companyProfile={companyProfile} mode="payroll" autoFull={!fullPage} />
    </div>
  );

  if (payrollTab === 'staff') return (
    <div {...rootProps}>
      <style>{PAYROLL_STYLES}</style>
      <PayrollHeader {...headerProps} description={`Saved staff pay allocations for ${companyProfile.company_name}`} tabs={tabsFor(staffOnPayroll.length)} />
      <Banner error={error} notice={notice} />
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="cmms-classic-heading flex-1">Staff on payroll</h3>
          <StatusBadge tone="success">{staffOnPayroll.length} saved</StatusBadge>
          <InfoTip label="About staff on payroll">Every saved on-pay staff allocation is included in the current draft, except daily-paid staff, who are settled one day at a time at check-out. Progress shows where each staff member is in that payroll.</InfoTip>
        </div>
        {staffOnPayroll.length === 0 ? <p className="cmms-classic-muted text-sm">No staff pay allocations saved yet. Add a salary profile from Payroll runs.</p> : (
          <>
          <ul className="space-y-2.5 md:hidden">
            {staffOnPayroll.map((profile, i) => {
              const name = profile.employee.name || 'Staff';
              const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
              return (
                <li key={profile.id} className="cmms-staff-card cmms-accent-emerald" style={{ animationDelay: `${Math.min(i, 8) * 70}ms` }}>
                  <div className="flex items-start gap-3">
                    <span className="cmms-monogram" aria-hidden="true">{initials}</span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words cmms-classic-heading leading-tight">{name}</p>
                      <p className="text-xs cmms-classic-muted">{profile.employee.role || 'Employee'} · <span className="capitalize">{String(profile.pay_frequency || profile.pay_type || 'monthly').replace('_', ' ')}</span></p>
                    </div>
                    <p className="flex-shrink-0 text-right text-sm font-bold" style={{ color: 'var(--pay-success-text)' }}>{amount(profile.base_salary, profile.currency)}</p>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone={payrollStatusTone(profile.payroll_status)}>{payrollStatusLabel(profile.payroll_status)}</StatusBadge>
                      {profile.dailySummary
                        ? <StatusBadge tone={profile.dailySummary.confirmedDays === 0 ? 'neutral' : profile.dailySummary.unpaidDays > 0 ? 'warning' : 'success'}>{profile.dailySummary.confirmedDays === 0 ? 'No check-out settled yet' : `${profile.dailySummary.paidDays}/${profile.dailySummary.confirmedDays} day(s) paid`}</StatusBadge>
                        : <StatusBadge tone={progressTone(profile.payroll_progress)}>{profile.payroll_progress ? profile.payroll_progress.replace('_', ' ') : 'Saved / awaiting draft'}</StatusBadge>}
                    </div>
                    {canEdit && profile.employee_user_id && (
                      <button type="button" onClick={() => { pickEmployeeForSalary(profile.employee_user_id); setPayrollTab('payroll'); }} className="cmms-classic-btn-secondary !h-auto !min-h-0 !px-3 !py-1 text-xs" aria-label={`Edit ${name}'s salary`}>Edit</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="pay-table w-full text-left text-sm">
              <thead><tr><th>Staff</th><th>Role</th><th>Pay period</th><th>Allocated pay</th><th>Employment</th><th>Payroll progress</th><th aria-label="Actions"></th></tr></thead>
              <tbody>
                {staffOnPayroll.map(profile => (
                  <tr key={profile.id}>
                    <td className="cmms-classic-heading font-medium">{profile.employee.name}</td>
                    <td className="cmms-classic-muted">{profile.employee.role || 'Employee'}</td>
                    <td className="cmms-classic-muted capitalize">{String(profile.pay_frequency || profile.pay_type || 'monthly').replace('_', ' ')}</td>
                    <td className="font-semibold" style={{ color: 'var(--pay-success-text)' }}>{amount(profile.base_salary, profile.currency)}</td>
                    <td><StatusBadge tone={payrollStatusTone(profile.payroll_status)}>{payrollStatusLabel(profile.payroll_status)}</StatusBadge></td>
                    <td>{profile.dailySummary
                      ? <StatusBadge tone={profile.dailySummary.confirmedDays === 0 ? 'neutral' : profile.dailySummary.unpaidDays > 0 ? 'warning' : 'success'} title={profile.dailySummary.lastConfirmedAt ? `Last confirmed at check-out: ${new Date(profile.dailySummary.lastConfirmedAt).toLocaleString()}` : 'No check-out settlement recorded yet this month'}>
                          {profile.dailySummary.confirmedDays === 0 ? 'No check-out settled yet this month' : `${profile.dailySummary.paidDays}/${profile.dailySummary.confirmedDays} day(s) paid at check-out`}
                        </StatusBadge>
                      : <StatusBadge tone={progressTone(profile.payroll_progress)}>{profile.payroll_progress ? profile.payroll_progress.replace('_', ' ') : 'Saved / awaiting draft'}</StatusBadge>}
                    </td>
                    <td className="text-right">{canEdit && profile.employee_user_id && (
                      <button type="button" onClick={() => { pickEmployeeForSalary(profile.employee_user_id); setPayrollTab('payroll'); }} className="cmms-classic-btn-secondary px-2 py-1 text-xs" aria-label={`Edit ${profile.employee.name}'s salary`}>Edit</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
    </div>
  );

  if (payrollTab === 'files') {
    const importableDocs = applicationDocs.filter(doc => !employeeFiles.some(f => f.employee_user_id === fileForm.employee && f.source_job_application_id === doc.job_application_id));
    const fileEmployeeCount = new Set(employeeFiles.map(d => d.employee_user_id)).size;
    const filteredFiles = fileFilterEmployee ? employeeFiles.filter(f => f.employee_user_id === fileFilterEmployee) : employeeFiles;
    return (
      <div {...rootProps}>
        <style>{PAYROLL_STYLES}</style>
        <PayrollHeader {...headerProps} Icon={UploadCloud} description={`Employee credential files for ${companyProfile.company_name}`} tabs={tabsFor(staffOnPayroll.length)} />
        <Banner error={error} notice={notice} />
        {!canViewFiles ? (
          <p className="cmms-classic-muted text-sm">Your role cannot view company-wide employee files. Use "My Salary" to manage your own documents.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <span className="cmms-classic-chip" style={{ animation: 'cmms-rise .45s ease both' }}>{employeeFiles.length} document{employeeFiles.length === 1 ? '' : 's'}</span>
              <span className="cmms-classic-chip" style={{ animation: 'cmms-rise .45s ease 80ms both' }}>{employeeFiles.filter(d => d.verified).length} verified</span>
              <span className="cmms-classic-chip" style={{ animation: 'cmms-rise .45s ease 160ms both' }}>{fileEmployeeCount} employee{fileEmployeeCount === 1 ? '' : 's'}</span>
            </div>

            {canManageFiles && (
              <CollapsibleSection
                title="Add a document"
                subtitle="File a National ID, certificate, CV, bank details or any other credential against an employee. Only that employee and payroll staff can see it."
                icon={<UploadCloud size={17} aria-hidden="true" />}
                accent="emerald"
              >
                <form onSubmit={uploadEmployeeFile} className="grid gap-3 md:grid-cols-2">
                  <label className="cmms-classic-label md:col-span-2">Employee
                    <select required value={fileForm.employee} onChange={e => setFileForm(v => ({ ...v, employee: e.target.value }))} className="cmms-classic-field mt-1 normal-case tracking-normal font-normal">
                      <option value="">Select employee</option>
                      {employees.map(x => <option key={x.authUserId} value={x.authUserId}>{x.name} — {x.role}</option>)}
                    </select>
                  </label>
                  {fileForm.employee && importableDocs.length > 0 && (
                    <div className="md:col-span-2 space-y-2 cmms-classic-callout p-3">
                      <p className="text-xs" style={{ color: 'var(--pay-info-text)' }}>Already on file from this employee's job application — no need to upload again:</p>
                      {importableDocs.map(doc => (
                        <div key={doc.job_application_id} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                          <span className="cmms-classic-muted">CV / Resume ({doc.reference_code})</span>
                          <button type="button" disabled={busy} onClick={() => importApplicationDoc(doc.job_application_id)} className="cmms-classic-btn-primary px-3 py-1.5 text-xs">Use this document</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="cmms-classic-label">Category
                    <select value={fileForm.category} onChange={e => setFileForm(v => ({ ...v, category: e.target.value }))} className="cmms-classic-field mt-1 normal-case tracking-normal font-normal">
                      {EMPLOYEE_DOCUMENT_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </label>
                  <label className="cmms-classic-label">Label
                    <input required value={fileForm.label} onChange={e => setFileForm(v => ({ ...v, label: e.target.value }))} placeholder="e.g. National ID copy" className="cmms-classic-field mt-1 normal-case tracking-normal font-normal" type="text" />
                  </label>
                  <label className="cmms-dropzone md:col-span-2" data-filled={!!fileForm.file}>
                    <UploadCloud className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{fileForm.file ? fileForm.file.name : 'Tap to choose a file'}</span>
                    <input required type="file" className="sr-only" onChange={e => setFileForm(v => ({ ...v, file: e.target.files?.[0] || null }))} aria-label="Choose a file to upload" />
                  </label>
                  <button disabled={busy} className="cmms-classic-btn-primary px-4 py-2.5 md:col-span-2">{busy ? 'Adding…' : 'Add document'}</button>
                </form>
              </CollapsibleSection>
            )}

            <CollapsibleSection
              title="All employee documents"
              subtitle="Every credential file on record for the company. Tick Verified once you have checked the original."
              icon={<WalletCards size={17} aria-hidden="true" />}
              accent="burgundy"
              defaultOpen
              badge={<StatusBadge tone="neutral">{filteredFiles.length}</StatusBadge>}
            >
              <label className="mb-3 block text-sm cmms-classic-muted">
                <span className="sr-only">Filter by employee</span>
                <select value={fileFilterEmployee} onChange={e => setFileFilterEmployee(e.target.value)} className="cmms-classic-field" aria-label="Filter documents by employee">
                  <option value="">All employees</option>
                  {employees.map(x => <option key={x.authUserId} value={x.authUserId}>{x.name}</option>)}
                </select>
              </label>
              {filteredFiles.length === 0 ? <p className="cmms-classic-muted text-sm">No documents on file yet.</p> : (
                <ul className="space-y-2">
                  {filteredFiles.map((doc, i) => (
                    <li key={doc.id} className="cmms-doc-row cmms-accent-burgundy" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-semibold cmms-classic-heading">{doc.file_url ? <a href={doc.file_url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'rgba(196,160,82,.7)' }}>{doc.label}</a> : doc.label}</p>
                        <p className="text-xs cmms-classic-muted">{doc.employee_name} · {EMPLOYEE_DOCUMENT_CATEGORIES.find(c => c.id === doc.category)?.label || doc.category} · {new Date(doc.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-3">
                        {canManageFiles ? (
                          <label className="flex items-center gap-1.5 text-xs cmms-classic-muted">
                            <input type="checkbox" checked={doc.verified} onChange={e => toggleFileVerified(doc.id, e.target.checked)} /> Verified
                          </label>
                        ) : <StatusBadge tone={doc.verified ? 'success' : 'neutral'}>{doc.verified ? 'Verified' : 'Unverified'}</StatusBadge>}
                        {canManageFiles && (
                          <button type="button" onClick={() => removeEmployeeFile(doc.id)} className="!bg-transparent" style={{ color: 'var(--pay-danger-text)', background: 'transparent', border: 0, boxShadow: 'none', padding: 0 }} aria-label={`Remove ${doc.label}`} title="Remove"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CollapsibleSection>
          </>
        )}
      </div>
    );
  }

  // Default view: "Payroll runs" -- attendance-adjusted salaries and payment.
  return (
    <div {...rootProps}>
      <style>{PAYROLL_STYLES}</style>
      <PayrollHeader {...headerProps} description={`Attendance-adjusted salaries and payment for ${companyProfile.company_name}`} intro="Save a staff member's pay allocation, then create a draft period. Every saved active salary profile is included in IcanEra payroll." tabs={tabsFor(staffOnPayroll.length)} />

      <Banner error={error} notice={notice} />
      {busy && <p className="flex items-center gap-2 text-sm cmms-classic-muted" role="status"><Loader size={16} className="animate-spin" aria-hidden="true" /> Updating payroll…</p>}

      <CollapsibleSection
        title="Attendance deductions and work time"
        subtitle="Normal work hours used to calculate late-arrival and early-departure deductions. Must be enabled before calculating attendance in a payroll run."
        icon={<Clock3 size={17} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />}
        defaultOpen={false}
      >
        <form onSubmit={saveAttendanceSettings} className="grid gap-3 md:grid-cols-3">
          <label className="flex items-center gap-2 text-sm cmms-classic-muted md:col-span-3">
            <input type="checkbox" checked={attendanceSettings.enabled} onChange={e => setAttendanceSettings(v => ({ ...v, enabled: e.target.checked }))} /> Enable attendance deductions
          </label>
          <label className="text-sm cmms-classic-muted">Time zone
            <TimeZoneSelect value={attendanceSettings.timezone} onChange={(timezone) => setAttendanceSettings(v => ({ ...v, timezone }))} className="pay-field" />
          </label>
          <label className="text-sm cmms-classic-muted">Grace minutes
            <input required min="0" max="240" type="number" value={attendanceSettings.grace_minutes} onChange={e => setAttendanceSettings(v => ({ ...v, grace_minutes: e.target.value }))} className="pay-field" />
          </label>
          <label className="text-sm cmms-classic-muted">Work start
            <input required type="time" value={attendanceSettings.scheduled_start} onChange={e => setAttendanceSettings(v => ({ ...v, scheduled_start: e.target.value }))} className="pay-field" />
          </label>
          <label className="text-sm cmms-classic-muted">Work end
            <input required type="time" value={attendanceSettings.scheduled_end} onChange={e => setAttendanceSettings(v => ({ ...v, scheduled_end: e.target.value }))} className="pay-field" />
          </label>
          <label className="text-sm cmms-classic-muted">Monthly work days
            <input required min="1" step="0.5" type="number" value={attendanceSettings.monthly_work_days} onChange={e => setAttendanceSettings(v => ({ ...v, monthly_work_days: e.target.value }))} className="pay-field" />
          </label>
          <label className="flex items-center gap-2 text-sm cmms-classic-muted">
            <input type="checkbox" checked={attendanceSettings.deduct_late_arrivals} onChange={e => setAttendanceSettings(v => ({ ...v, deduct_late_arrivals: e.target.checked }))} /> Deduct late arrivals
          </label>
          <label className="flex items-center gap-2 text-sm cmms-classic-muted">
            <input type="checkbox" checked={attendanceSettings.deduct_early_departures} onChange={e => setAttendanceSettings(v => ({ ...v, deduct_early_departures: e.target.checked }))} /> Deduct early departures
          </label>
          <button disabled={busy} className="cmms-classic-btn-primary px-4 py-2 md:col-span-3">Save work schedule</button>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        title="Salary profile"
        subtitle="Save or update a staff member's pay allocation."
        icon={<DollarSign size={17} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />}
        defaultOpen={false}
        badge={editingProfile ? <StatusBadge tone="info">Editing</StatusBadge> : null}
      >
        <form onSubmit={saveSalary} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm cmms-classic-muted md:col-span-2">Employee
            <select required value={salary.employee} onChange={e => pickEmployeeForSalary(e.target.value)} className="pay-field">
              <option value="">Select employee</option>
              {employees.map(x => <option key={x.authUserId} value={x.authUserId}>{x.name} — {x.role}{latestPayByEmployee.has(x.authUserId) ? ' (on payroll)' : ''}</option>)}
            </select>
          </label>
          <label className="text-sm cmms-classic-muted">Pay type
            <select value={salary.pay_type} onChange={e => setSalary(v => ({ ...v, pay_type: e.target.value }))} className="pay-field">
              <option value="monthly">Salary</option><option value="hourly">Hourly worker</option><option value="per_ride">Per ride</option><option value="hybrid">Hybrid</option>
            </select>
          </label>
          <label className="text-sm cmms-classic-muted">Pay period
            <select value={salary.pay_frequency} onChange={e => setSalary(v => ({ ...v, pay_frequency: e.target.value, pay_type: e.target.value === 'hourly' ? 'hourly' : v.pay_type === 'hourly' ? 'monthly' : v.pay_type }))} className="pay-field">
              <option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="contract">Fixed contract</option>
            </select>
          </label>
          <label className="text-sm cmms-classic-muted">Rate / base pay
            <input required type="number" min="0.01" step="0.01" value={salary.base_salary} onChange={e => setSalary(v => ({ ...v, base_salary: e.target.value }))} className="pay-field" />
          </label>
          <label className="text-sm cmms-classic-muted">Currency
            <input value={salary.currency} onChange={e => setSalary(v => ({ ...v, currency: e.target.value.toUpperCase() }))} className="pay-field" type="text" />
          </label>
          {salary.pay_frequency === 'contract' && <>
            <label className="text-sm cmms-classic-muted">Contract starts
              <input required type="date" value={salary.contract_start} onChange={e => setSalary(v => ({ ...v, contract_start: e.target.value }))} className="pay-field" />
            </label>
            <label className="text-sm cmms-classic-muted">Contract ends
              <input required type="date" value={salary.contract_end} onChange={e => setSalary(v => ({ ...v, contract_end: e.target.value }))} className="pay-field" />
            </label>
            <label className="text-sm cmms-classic-muted md:col-span-2">Total contract value
              <input required type="number" min="0.01" step="0.01" value={salary.contract_total} onChange={e => setSalary(v => ({ ...v, contract_total: e.target.value }))} className="pay-field" />
            </label>
          </>}
          <label className="text-sm cmms-classic-muted">Status
            <select value={salary.payroll_status} onChange={e => setSalary(v => ({ ...v, payroll_status: e.target.value }))} className="pay-field">
              <option value="on_pay">On pay</option><option value="on_hold">On hold</option>
            </select>
          </label>
          <button disabled={busy} className="cmms-classic-btn-primary px-4 py-2 md:col-span-2">{editingProfile ? 'Update salary' : 'Save salary'}</button>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        title="New attendance payroll run"
        subtitle="Create a draft period from saved salary profiles, then calculate deductions."
        icon={<Clock3 size={17} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />}
        defaultOpen={false}
      >
        <form onSubmit={createRun} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm cmms-classic-muted">Start
            <input required type="date" value={dates.start} onChange={e => setDates(v => ({ ...v, start: e.target.value }))} className="pay-field" />
          </label>
          <label className="text-sm cmms-classic-muted">End
            <input required type="date" value={dates.end} onChange={e => setDates(v => ({ ...v, end: e.target.value }))} className="pay-field" />
          </label>
          <button disabled={busy || !compensation.length} className="cmms-classic-btn-primary px-4 py-2">Create draft</button>
          <button type="button" disabled={busy || !periodId || !['draft', 'pending_approval'].includes(period?.status)} onClick={calculate} className="cmms-classic-btn-secondary px-4 py-2">Calculate attendance</button>
          <button type="button" disabled={busy || !periodId || !['draft', 'pending_approval'].includes(period?.status)} onClick={recoverAdvances} className="cmms-classic-btn-secondary px-4 py-2">Recover advances</button>
          <button type="button" disabled={busy || !periodId || !['draft', 'pending_approval'].includes(period?.status)} onClick={applyLeave} className="cmms-classic-btn-secondary px-4 py-2">Apply leave deductions</button>
          <p className="cmms-classic-muted text-xs md:col-span-2">The calculation uses the company's existing attendance-payroll settings and remains reviewable in the draft. Recover advances deducts any confirmed, unpaid salary advance balance for staff in this run. Apply leave deductions prorates a deduction for approved unpaid leave overlapping this period — approved paid leave never needs a deduction here, and a daily-paid employee's approved paid leave already gets its own draft entry the moment HR approves it.</p>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        title="Review and pay"
        icon={<WalletCards size={17} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />}
        defaultOpen={true}
      >
        <label className="text-sm cmms-classic-muted">
          <span className="sr-only">Select payroll period</span>
          <select value={periodId} onChange={e => loadEntries(e.target.value)} className="pay-field !mt-0 max-w-sm" aria-label="Select payroll period">
            <option value="">Select period</option>
            {periods.map(p => <option key={p.id} value={p.id}>{p.period_start} to {p.period_end} — {p.status}</option>)}
          </select>
        </label>
        {periodId && <>
          <div className="mt-3 overflow-x-auto">
            <table className="pay-table w-full text-left text-sm">
              <thead><tr><th>Employee</th><th>Base</th><th>Attendance deduction</th><th>Net salary</th><th>Status</th></tr></thead>
              <tbody>
                {entries.map(entry => {
                  const employee = employees.find(x => x.authUserId === entry.employee_user_id); const currency = entry.metadata?.currency || 'UGX';
                  return (
                    <tr key={entry.id}>
                      <td className="cmms-classic-muted">{employee?.name || entry.employee_user_id}</td>
                      <td>{amount(entry.base_amount, currency)}</td>
                      <td style={{ color: 'var(--pay-warning-text)' }}>-{amount(entry.metadata?.attendance_deduction, currency)}</td>
                      <td className="font-semibold" style={{ color: 'var(--pay-success-text)' }}>{amount(entry.net_amount, currency)}</td>
                      <td><StatusBadge tone={progressTone(entry.status)}>{entry.status}</StatusBadge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <form onSubmit={pay} className="mt-4 grid gap-3 cmms-classic-divider md:grid-cols-4">
            <label className="text-sm cmms-classic-muted md:col-span-2">Employee to pay
              <select required value={payment.entry} onChange={e => setPayment(v => ({ ...v, entry: e.target.value }))} className="pay-field">
                <option value="">Select staff and view payment status</option>
                {entries.map(x => <option key={x.id} value={x.id} disabled={x.status === 'paid'}>{employees.find(e => e.authUserId === x.employee_user_id)?.name || x.employee_user_id} — {amount(x.net_amount, x.metadata?.currency)} — {x.status === 'paid' ? 'Paid' : x.status === 'approved' ? 'Ready to pay' : x.status === 'draft' ? 'Draft / unpaid' : x.status}</option>)}
              </select>
            </label>
            <p className="self-end pb-2 text-xs cmms-classic-muted">All staff in this payroll period are listed. Paid staff are shown but cannot be selected again.</p>
            <label className="text-sm cmms-classic-muted">Method
              <select value={payment.method} onChange={e => setPayment(v => ({ ...v, method: e.target.value }))} className="pay-field">
                <option value="cash">Cash</option><option value="ican">IcanEra wallet</option>
              </select>
            </label>
            {payment.method === 'ican' && <label className="text-sm cmms-classic-muted">Wallet PIN
              <input required type="password" value={payment.pin} onChange={e => setPayment(v => ({ ...v, pin: e.target.value }))} className="pay-field" />
            </label>}
            <button disabled={busy || !entries.some(x => x.status !== 'paid')} className="cmms-classic-btn-primary flex items-center justify-center gap-2 px-4 py-2"><WalletCards size={16} aria-hidden="true" />{payment.method === 'ican' ? 'Pay with IcanEra wallet' : 'Record cash payment'}</button>
          </form>
        </>}
      </CollapsibleSection>

      <CollapsibleSection
        title="Reward redemptions"
        subtitle="Points earned for attendance, reports, messages and completed tasks (Attendance → Rewards) queue up here once redeemed, ready to pay the same way as any other payroll payment."
        icon={<WalletCards size={17} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />}
        defaultOpen={rewardRedemptions.length > 0}
        badge={<StatusBadge tone="info">{rewardRedemptions.length} pending</StatusBadge>}
      >
        {rewardsSettings && (
          <form onSubmit={saveRewardRate} className="mb-4 flex flex-wrap items-end gap-3 cmms-classic-callout p-3">
            <label className="text-sm cmms-classic-muted">IcanEra coins per point
              <input type="number" min="0" step="0.00000001" value={rewardsSettings.ican_coins_per_point} onChange={e => setRewardsSettings(v => ({ ...v, ican_coins_per_point: e.target.value }))} className="pay-field w-40" />
            </label>
            <button disabled={rewardRateSaving} className="cmms-classic-btn-primary px-4 py-2 text-sm">{rewardRateSaving ? 'Saving…' : 'Save rate'}</button>
            <p className="text-xs cmms-classic-muted">Sets how many icaneracoins each point is worth when redeemed. Other point values live in Attendance → Rewards.</p>
          </form>
        )}
        {rewardRedemptions.length === 0 ? <p className="cmms-classic-muted text-sm">Nothing queued for reward payout right now.</p> : <>
          <div className="overflow-x-auto">
            <table className="pay-table w-full text-left text-sm">
              <thead><tr><th>Staff</th><th>Points</th><th>Amount</th><th>Queued</th></tr></thead>
              <tbody>
                {rewardRedemptions.map(row => (
                  <tr key={row.id}>
                    <td className="cmms-classic-muted">{row.user_name}</td>
                    <td>{row.points_redeemed}</td>
                    <td className="font-semibold" style={{ color: 'var(--pay-success-text)' }}>{Number(row.ican_amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ICAN</td>
                    <td className="cmms-classic-muted capitalize">{row.triggered_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form onSubmit={payReward} className="mt-4 grid gap-3 cmms-classic-divider md:grid-cols-4">
            <label className="text-sm cmms-classic-muted md:col-span-2">Redemption to pay
              <select required value={rewardPayment.redemption} onChange={e => setRewardPayment(v => ({ ...v, redemption: e.target.value }))} className="pay-field">
                <option value="">Select a queued redemption</option>
                {rewardRedemptions.map(x => <option key={x.id} value={x.id}>{x.user_name} — {Number(x.ican_amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ICAN ({x.points_redeemed} pts)</option>)}
              </select>
            </label>
            <label className="text-sm cmms-classic-muted">Method
              <select value={rewardPayment.method} onChange={e => setRewardPayment(v => ({ ...v, method: e.target.value }))} className="pay-field">
                <option value="cash">Cash</option><option value="ican">IcanEra wallet</option>
              </select>
            </label>
            {rewardPayment.method === 'ican' && <label className="text-sm cmms-classic-muted">Wallet PIN
              <input required type="password" value={rewardPayment.pin} onChange={e => setRewardPayment(v => ({ ...v, pin: e.target.value }))} className="pay-field" />
            </label>}
            <button disabled={busy || !rewardPayment.redemption} className="cmms-classic-btn-primary flex items-center justify-center gap-2 px-4 py-2"><WalletCards size={16} aria-hidden="true" />{rewardPayment.method === 'ican' ? 'Pay with IcanEra wallet' : 'Record cash payment'}</button>
          </form>
        </>}
      </CollapsibleSection>

      {canApprove && (
        <CollapsibleSection
          title="Salary advance requests"
          subtitle="Employees request these from their own My Salary tab. Approve, then pay by cash or the IcanEra wallet (on-chain icaneracoin) — the employee still has to confirm receipt before it is deducted from a future payroll run."
          icon={<DollarSign size={17} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />}
          defaultOpen={advances.some(a => a.status === 'pending')}
          badge={<StatusBadge tone="warning">{advances.filter(a => a.status === 'pending').length} pending</StatusBadge>}
        >
          {advances.filter(a => ['pending', 'approved', 'paid', 'confirmed'].includes(a.status)).length === 0 ? (
            <p className="cmms-classic-muted text-sm">No open salary advance requests.</p>
          ) : (
            <div className="space-y-2">
              {advances.filter(a => ['pending', 'approved', 'paid', 'confirmed'].includes(a.status)).map(a => {
                const employee = employees.find(x => x.authUserId === a.employee_user_id);
                return (
                  <div key={a.id} className="pay-row flex flex-wrap items-center justify-between gap-3 text-sm">
                    <div>
                      <p className="cmms-classic-heading font-medium">{employee?.name || a.employee_user_id}</p>
                      <p className="cmms-classic-muted text-xs">{amount(a.amount, a.currency)}{a.reason ? ` — ${a.reason}` : ''}{(a.repayment_installments || 1) > 1 ? ` · Repay in ${a.repayment_installments} parts of ${amount(Math.ceil(Number(a.amount) / a.repayment_installments * 100) / 100, a.currency)}` : ' · Repay all from next pay'}{a.repayment_note ? ` · “${a.repayment_note}”` : ''}{a.status === 'confirmed' ? ` · ${amount(a.recovered_amount, a.currency)} recovered so far` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={advanceTone(a.status)}>{a.status}</StatusBadge>
                      {a.status === 'pending' && <>
                        <button type="button" disabled={busy} onClick={() => decideAdvance(a.id, 'approved')} className="pay-btn-approve px-2 py-1 text-xs" aria-label={`Approve ${employee?.name || 'this'} advance`}>Approve</button>
                        <button type="button" disabled={busy} onClick={() => decideAdvance(a.id, 'rejected')} className="pay-btn-reject px-2 py-1 text-xs" aria-label={`Reject ${employee?.name || 'this'} advance`}>Reject</button>
                      </>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {advances.some(a => a.status === 'approved') && (
            <form onSubmit={payAdvance} className="mt-4 grid gap-3 cmms-classic-divider md:grid-cols-4">
              <label className="text-sm cmms-classic-muted md:col-span-2">Advance to pay
                <select required value={advancePayment.advance} onChange={e => setAdvancePayment(v => ({ ...v, advance: e.target.value }))} className="pay-field">
                  <option value="">Select an approved advance</option>
                  {advances.filter(a => a.status === 'approved').map(a => <option key={a.id} value={a.id}>{employees.find(x => x.authUserId === a.employee_user_id)?.name || a.employee_user_id} — {amount(a.amount, a.currency)}</option>)}
                </select>
              </label>
              <label className="text-sm cmms-classic-muted">Method
                <select value={advancePayment.method} onChange={e => setAdvancePayment(v => ({ ...v, method: e.target.value }))} className="pay-field">
                  <option value="cash">Cash</option><option value="ican">IcanEra wallet</option>
                </select>
              </label>
              {advancePayment.method === 'ican' && <label className="text-sm cmms-classic-muted">Wallet PIN
                <input required type="password" value={advancePayment.pin} onChange={e => setAdvancePayment(v => ({ ...v, pin: e.target.value }))} className="pay-field" />
              </label>}
              <button disabled={busy || !advancePayment.advance} className="cmms-classic-btn-primary flex items-center justify-center gap-2 px-4 py-2"><WalletCards size={16} aria-hidden="true" />{advancePayment.method === 'ican' ? 'Pay with IcanEra wallet' : 'Record cash payment'}</button>
            </form>
          )}
        </CollapsibleSection>
      )}
    </div>
  );
}
