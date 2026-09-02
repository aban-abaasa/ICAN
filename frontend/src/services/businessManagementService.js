import { getSupabase } from './pitchingService';

const db = () => getSupabase();

export const getBusinessCategoryTemplates = async () => {
  const sb = db();
  if (!sb) return { data: [], error: null };
  const { data, error } = await sb.rpc('get_business_category_templates');
  return { data: data || [], error };
};

export const createBusinessProfileFromCategory = async ({ businessName, categoryKey, businessType, sourceApp = 'pichin' }) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { data, error } = await sb.rpc('create_business_profile_from_category', {
    p_business_name: businessName,
    p_category_key: categoryKey,
    p_business_type: businessType || null,
    p_source_app: sourceApp,
    p_metadata: {}
  });
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const getBusinessModules = async (businessProfileId) => {
  const sb = db();
  if (!sb || !businessProfileId) return { data: [], error: null };
  const { data, error } = await sb.from('business_profile_modules').select('*').eq('business_profile_id', businessProfileId).order('module_key');
  return { data: data || [], error };
};

export const setBusinessModule = async (businessProfileId, moduleKey, enabled) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { data, error } = await sb.from('business_profile_modules').upsert({
    business_profile_id: businessProfileId,
    module_key: moduleKey,
    enabled,
    updated_by: (await sb.auth.getUser()).data.user?.id || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'business_profile_id,module_key' }).select().single();
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const getBusinessDepartments = async (businessProfileId) => {
  const sb = db();
  if (!sb || !businessProfileId) return { data: [], error: null };
  const { data, error } = await sb.from('business_departments').select('*').eq('business_profile_id', businessProfileId).eq('is_active', true).order('department_name');
  return { data: data || [], error };
};

export const createBusinessDepartment = async (businessProfileId, departmentName) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { data, error } = await sb.rpc('create_business_department', {
    p_business_profile_id: businessProfileId,
    p_department_name: departmentName.trim(),
    p_description: null
  });
  if (!error && data) {
    const { data: department } = await sb.from('business_departments').select('*').eq('id', data).single();
    return { success: true, data: department };
  }
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const getBusinessRoles = async (businessProfileId) => {
  const sb = db();
  if (!sb || !businessProfileId) return { data: [], error: null };
  const { data, error } = await sb.from('business_roles').select('*, business_role_permissions(*)').eq('business_profile_id', businessProfileId).eq('is_active', true).order('display_name');
  return { data: data || [], error };
};

export const searchGlobalSuppliers = async (search = '', category = '') => {
  const sb = db();
  if (!sb) return { data: [], error: null };
  const { data, error } = await sb.rpc('search_global_suppliers_v2', { p_search: search || null, p_category: category || null });
  return { data: data || [], error };
};

export const getSupplierListing = async (businessProfileId) => {
  const sb = db();
  if (!sb || !businessProfileId) return { data: null, error: null };
  const { data, error } = await sb.from('supplier_directory').select('*').eq('business_profile_id', businessProfileId).maybeSingle();
  return { data, error };
};

export const getBusinessLinkedApplications = async (businessProfileId) => {
  const sb = db();
  if (!sb || !businessProfileId) return { data: [], error: null };
  const { data, error } = await sb.from('business_app_links')
    .select('app_key, source_entity_id, status, metadata')
    .eq('business_profile_id', businessProfileId)
    .order('app_key');
  return { data: data || [], error };
};

export const publishBusinessAsSupplier = async (businessProfileId, supplierType = 'supplier') => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { data, error } = await sb.rpc('publish_business_as_supplier', { p_business_profile_id: businessProfileId, p_supplier_type: supplierType });
  return error ? { success: false, error: error.message } : { success: true, data };
};

// Existing administration and payroll consumers share this service. Keep
// their legacy access helpers alongside the new business-management APIs.
export const getBusinessAccessMembers = async (businessProfileId) => {
  const sb = db();
  if (!sb || !businessProfileId) return { data: [], error: null };
  const { data, error } = await sb.from('business_account_members')
    .select('id, auth_user_id, employment_status, job_title, department, employee_number, permissions, joined_at, created_at')
    .eq('business_profile_id', businessProfileId)
    .in('employment_status', ['invited', 'active'])
    .order('created_at', { ascending: false });
  if (error || !data?.length) return { data: data || [], error };
  const ids = data.map(member => member.auth_user_id).filter(Boolean);
  const { data: users } = await sb.from('all_users').select('id, user_id, email, full_name').in('user_id', ids);
  const byId = new Map((users || []).map(item => [item.user_id || item.id, item]));
  return { data: data.map(member => ({ ...member, user: byId.get(member.auth_user_id) || { email: 'IcanEra account', full_name: member.auth_user_id } })), error: null };
};

export const resolveEmployeeAuthIds = async (employees = []) => {
  const sb = db();
  const unresolved = employees.filter(employee => employee?.email && !employee.authUserId);
  if (!sb || !unresolved.length) return [];
  const emails = [...new Set(unresolved.map(employee => employee.email.trim().toLowerCase()))];
  const { data, error } = await sb.from('all_users').select('id, user_id, email, full_name').in('email', emails);
  if (error) return [];
  const byEmail = new Map((data || []).map(item => [String(item.email || '').toLowerCase(), item]));
  return unresolved.map(employee => {
    const match = byEmail.get(employee.email.trim().toLowerCase());
    const authUserId = match?.user_id || match?.id;
    return authUserId ? { ...employee, authUserId, name: employee.name || match.full_name || employee.email.split('@')[0] } : null;
  }).filter(Boolean);
};

export const grantBusinessAccess = async (businessProfileId, user, permissions, details = {}) => {
  const sb = db();
  if (!sb || !businessProfileId || !user?.id) return { success: false, error: 'Missing business or user' };
  const { data, error } = await sb.from('business_account_members').upsert({
    business_profile_id: businessProfileId, auth_user_id: user.id, employment_status: 'active',
    job_title: details.job_title || null, department: details.department || null,
    employee_number: details.employee_number || null, permissions: permissions || {},
    invited_by: (await sb.auth.getUser()).data.user?.id || null, joined_at: new Date().toISOString()
  }, { onConflict: 'business_profile_id,auth_user_id' }).select().single();
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const revokeBusinessAccess = async (memberId) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured' };
  const { error } = await sb.from('business_account_members').update({ employment_status: 'suspended' }).eq('id', memberId);
  return error ? { success: false, error: error.message } : { success: true };
};

export const getBusinessCompensation = async (businessProfileId) => {
  const sb = db();
  if (!sb || !businessProfileId) return { data: [], error: null };
  const { data, error } = await sb.from('business_compensation_profiles').select('*').eq('business_profile_id', businessProfileId).order('effective_from', { ascending: false });
  return { data: data || [], error };
};

export const saveBusinessCompensation = async (businessProfileId, employeeUserId, values) => {
  const sb = db();
  if (!sb || !businessProfileId || !employeeUserId) return { success: false, error: 'Missing employee or business' };
  const amount = Number(values.base_salary);
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: 'Enter a salary or rate greater than zero.' };
  const { data: authData } = await sb.auth.getUser();
  const payFrequency = ['hourly', 'daily', 'weekly', 'monthly', 'contract'].includes(values.pay_frequency) ? values.pay_frequency : (values.pay_type === 'hourly' ? 'hourly' : 'monthly');
  const compensation = { business_profile_id: businessProfileId, employee_user_id: employeeUserId, pay_type: values.pay_type || (payFrequency === 'hourly' ? 'hourly' : 'monthly'), base_salary: amount, currency: String(values.currency || 'UGX').trim().toUpperCase(), pay_frequency: payFrequency, contract_start: values.contract_start || null, contract_end: values.contract_end || null, contract_total: values.contract_total ? Number(values.contract_total) : null, effective_from: values.effective_from || new Date().toISOString().slice(0, 10), overtime_rate: Number(values.overtime_rate || 0), payroll_status: values.payroll_status || 'on_pay', notes: values.notes || null, created_by: authData?.user?.id || null };
  let { data, error } = await sb.from('business_compensation_profiles').upsert(compensation, { onConflict: 'business_profile_id,employee_user_id,effective_from' }).select().single();
  if (error && /(payroll_status|pay_frequency|contract_start|contract_end|contract_total).*schema cache|column .*(payroll_status|pay_frequency|contract_start|contract_end|contract_total).*does not exist/i.test(error.message || '')) {
    // These columns exist in SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql, so
    // this only fires when PostgREST's schema cache is stale. Retrying
    // without them keeps legacy environments from hard-failing, but doing
    // so silently would drop the very field (pay_frequency) the admin is
    // often here to change — e.g. switching someone to daily pay would
    // "succeed" while quietly leaving them on the old frequency, and
    // cmms_checkout_pay_status would never notice the change. Surface it
    // instead of pretending the save was complete.
    const { payroll_status: _status, pay_frequency: _frequency, contract_start: _start, contract_end: _end, contract_total: _total, ...legacyCompensation } = compensation;
    ({ data, error } = await sb.from('business_compensation_profiles').upsert(legacyCompensation, { onConflict: 'business_profile_id,employee_user_id,effective_from' }).select().single());
    if (!error) return { success: false, error: 'Base pay was saved, but pay frequency/status/contract details could not be — the database schema needs to be refreshed (ask an admin to re-run the payroll schema migration). Try again after that.', data };
  }
  return error ? { success: false, error: error.message } : { success: true, data };
};

const daysInclusive = (start, end) => Math.max(1, Math.floor((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000) + 1);
const weekdayCount = (start, end) => {
  let count = 0;
  for (let date = new Date(`${start}T00:00:00Z`); date <= new Date(`${end}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) count += 1;
  }
  return count;
};

const payrollBaseForPeriod = (profile, periodStart, periodEnd) => {
  const frequency = profile.pay_frequency || (profile.pay_type === 'hourly' ? 'hourly' : 'monthly');
  const days = daysInclusive(periodStart, periodEnd);
  if (frequency === 'hourly') return Number(profile.base_salary || 0) * weekdayCount(periodStart, periodEnd) * 8;
  if (frequency === 'daily') return Number(profile.base_salary || 0) * days;
  if (frequency === 'weekly') return Number(profile.base_salary || 0) * (days / 7);
  if (frequency === 'contract') {
    const contractStart = profile.contract_start || profile.effective_from;
    const contractEnd = profile.contract_end || profile.effective_to || periodEnd;
    const overlapStart = contractStart > periodStart ? contractStart : periodStart;
    const overlapEnd = contractEnd < periodEnd ? contractEnd : periodEnd;
    if (overlapEnd < overlapStart) return 0;
    const contractDays = daysInclusive(contractStart, contractEnd);
    return Number(profile.contract_total || profile.base_salary || 0) * (daysInclusive(overlapStart, overlapEnd) / contractDays);
  }
  return Number(profile.base_salary || 0);
};

// Payroll periods and entries deliberately use the shared business tables.
// Payment itself is performed by the existing ICAN business-wallet service.
export const getBusinessPayrollPeriods = async (businessProfileId) => {
  const sb = db();
  if (!sb || !businessProfileId) return { data: [], error: null };
  const { data, error } = await sb.from('business_payroll_periods').select('*')
    .eq('business_profile_id', businessProfileId).order('period_start', { ascending: false }).limit(24);
  return { data: data || [], error };
};

export const getBusinessPayrollEntries = async (periodId) => {
  const sb = db();
  if (!sb || !periodId) return { data: [], error: null };
  const { data, error } = await sb.from('business_payroll_entries').select('*')
    .eq('payroll_period_id', periodId).order('created_at');
  return { data: data || [], error };
};

export const createBusinessPayrollPeriod = async ({ businessProfileId, periodStart, periodEnd, compensation }) => {
  const sb = db();
  if (!sb || !businessProfileId) return { success: false, error: 'Supabase is not configured.' };
  const { data: auth } = await sb.auth.getUser();
  const { data: period, error: periodError } = await sb.from('business_payroll_periods').insert({
    business_profile_id: businessProfileId, period_start: periodStart, period_end: periodEnd, created_by: auth?.user?.id || null
  }).select().single();
  if (periodError) return { success: false, error: periodError.message };
  // Saved salary profiles are the payroll source of truth. A staff member
  // must not be skipped merely because the CMMS user list is stale or filtered.
  // Daily-paid staff are excluded here: cmms_settle_attendance_pay already
  // settles them one day at a time at check-out, writing its own paid entry
  // for that single day. Including them again here would add a second,
  // whole-period lump-sum entry on top of what they already got paid daily.
  const activeComp = new Map();
  (compensation || [])
    .filter(item => item.employee_user_id && item.payroll_status === 'on_pay' && item.pay_frequency !== 'daily')
    .filter(item => item.effective_from <= periodEnd && (!item.effective_to || item.effective_to >= periodStart))
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))
    .forEach(item => { if (!activeComp.has(item.employee_user_id)) activeComp.set(item.employee_user_id, item); });
  const entries = [...activeComp.values()].map(pay => ({
    payroll_period_id: period.id,
    business_profile_id: businessProfileId,
    employee_user_id: pay.employee_user_id,
    base_amount: Number(payrollBaseForPeriod(pay, periodStart, periodEnd).toFixed(2)),
    metadata: { pay_type: pay.pay_type, pay_frequency: pay.pay_frequency || (pay.pay_type === 'hourly' ? 'hourly' : 'monthly'), currency: pay.currency || 'UGX', compensation_profile_id: pay.id }
  }));
  if (entries.length) {
    const { error } = await sb.from('business_payroll_entries').insert(entries);
    if (error) return { success: false, error: error.message };
  }
  return { success: true, data: period };
};

// A staff pay allocation can be saved after a draft has been opened. Keep
// draft reviews in sync with the same saved on-pay staff source of truth.
export const syncBusinessPayrollDraftStaff = async ({ payrollPeriod, compensation }) => {
  const sb = db();
  if (!sb || !payrollPeriod || payrollPeriod.status !== 'draft') return { success: true, data: [] };
  // Daily-paid staff are excluded for the same reason as createBusinessPayrollPeriod
  // above: they are already settled one day at a time at check-out.
  const activeComp = new Map();
  (compensation || [])
    .filter(item => item.employee_user_id && item.payroll_status === 'on_pay' && item.pay_frequency !== 'daily')
    .filter(item => item.effective_from <= payrollPeriod.period_end && (!item.effective_to || item.effective_to >= payrollPeriod.period_start))
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))
    .forEach(item => { if (!activeComp.has(item.employee_user_id)) activeComp.set(item.employee_user_id, item); });
  const entries = [...activeComp.values()].map(pay => ({
    payroll_period_id: payrollPeriod.id,
    business_profile_id: payrollPeriod.business_profile_id,
    employee_user_id: pay.employee_user_id,
    base_amount: Number(payrollBaseForPeriod(pay, payrollPeriod.period_start, payrollPeriod.period_end).toFixed(2)),
    metadata: { pay_type: pay.pay_type, pay_frequency: pay.pay_frequency || (pay.pay_type === 'hourly' ? 'hourly' : 'monthly'), currency: pay.currency || 'UGX', compensation_profile_id: pay.id }
  }));
  if (!entries.length) return { success: true, data: [] };
  const { data, error } = await sb.from('business_payroll_entries')
    .upsert(entries, { onConflict: 'payroll_period_id,employee_user_id', ignoreDuplicates: true })
    .select();
  return error ? { success: false, error: error.message } : { success: true, data: data || [] };
};

export const applyAttendanceToPayroll = async (periodId) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { data, error } = await sb.rpc('cmms_apply_attendance_payroll_deductions', { p_payroll_period_id: periodId });
  return error ? { success: false, error: error.message } : { success: true, data: data || [] };
};

export const recordPayrollPayment = async ({ entryId, paymentMethod, walletTransactionId = null }) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { error } = await sb.rpc('complete_cmms_payroll_payment', { p_payroll_entry_id: entryId, p_payment_method: paymentMethod, p_wallet_transaction_id: walletTransactionId });
  return error ? { success: false, error: error.message } : { success: true };
};

export const requestPayrollEmployeeApproval = async (entryId) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { data, error } = await sb.rpc('request_cmms_payroll_employee_approval', { p_payroll_entry_id: entryId });
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const getMyPayrollApprovals = async () => {
  const sb = db();
  if (!sb) return { data: [], error: null };
  const { data, error } = await sb.from('cmms_payroll_employee_approvals').select('*').order('requested_at', { ascending: false });
  return { data: data || [], error };
};

export const respondToPayrollApproval = async (approvalId, approved, note = '') => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured.' };
  const { data, error } = await sb.rpc('respond_cmms_payroll_employee_approval', { p_approval_id: approvalId, p_approved: approved, p_note: note || null });
  return error ? { success: false, error: error.message } : { success: true, data };
};

// Tells the attendance check-out screen, before check-out is attempted,
// whether a pay decision is due today (daily staff: every day; monthly/
// weekly/hourly/contract staff: once check-outs this month reach the
// company's agreed monthly_work_days). A no-op-safe read used purely to
// decide whether to show the "have you been paid?" prompt.
export const getCheckoutPayStatus = async ({ cmmsUserId, cmmsCompanyId, attendanceId = null }) => {
  const sb = db();
  if (!sb || !cmmsUserId || !cmmsCompanyId) return { data: { required: false }, error: null };
  const { data, error } = await sb.rpc('cmms_checkout_pay_status', { p_cmms_user_id: cmmsUserId, p_cmms_company_id: cmmsCompanyId, p_attendance_id: attendanceId });
  return error ? { data: { required: false }, error } : { data: data || { required: false }, error: null };
};

// Same lookup for the public QR self check-out page, which only has the token.
export const getCheckoutPayStatusByQr = async (token) => {
  const sb = db();
  if (!sb || !token) return { data: { required: false }, error: null };
  const { data, error } = await sb.rpc('cmms_checkout_pay_status_by_qr', { p_token: token });
  return error ? { data: { required: false }, error } : { data: data || { required: false }, error: null };
};

// Daily-paid staff never get a business_payroll_entries row through the
// Payroll panel's own draft builders (see createBusinessPayrollPeriod /
// syncBusinessPayrollDraftStaff above) — they are settled one day at a time
// by cmms_settle_attendance_pay at check-out instead. This reads those
// check-out settlements back so the Payroll panel can show, per employee,
// that the days were actually confirmed paid, rather than looking like an
// unpaid gap. cmms_attendance_pay_confirmations already grants SELECT to
// anyone who can manage attendance payroll for the company.
export const getAttendanceCheckoutPayConfirmations = async ({ cmmsCompanyId, periodStart, periodEnd }) => {
  const sb = db();
  if (!sb || !cmmsCompanyId || !periodStart || !periodEnd) return { data: [], error: null };
  const { data, error } = await sb.from('cmms_attendance_pay_confirmations')
    .select('*')
    .eq('cmms_company_id', cmmsCompanyId)
    .gte('period_start', periodStart)
    .lte('period_end', periodEnd)
    .order('period_start', { ascending: false });
  return { data: data || [], error };
};

// ── Employee rewards (points for attendance/reports/messages/tasks) ──────
// See backend/CMMS_EMPLOYEE_REWARDS_POINTS.sql. Points are earned
// automatically via database triggers; these calls only read balances/
// history and drive the admin-only redemption actions.
export const getRewardsSettings = async (cmmsCompanyId) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: null, error: null };
  const { data, error } = await sb.from('cmms_rewards_settings').select('*').eq('cmms_company_id', cmmsCompanyId).maybeSingle();
  return { data: data || null, error };
};

export const saveRewardsSettings = async (cmmsCompanyId, values) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { success: false, error: 'Supabase is not configured' };
  const { data: authData } = await sb.auth.getUser();
  const settings = {
    cmms_company_id: cmmsCompanyId,
    enabled: Boolean(values.enabled),
    points_per_checkin: Number(values.points_per_checkin || 0),
    points_per_early_checkin: Number(values.points_per_early_checkin || 0),
    early_checkin_minutes: Number(values.early_checkin_minutes || 0),
    points_per_report: Number(values.points_per_report || 0),
    points_per_task_completed: Number(values.points_per_task_completed || 0),
    points_per_message: Number(values.points_per_message || 0),
    message_daily_cap: Number(values.message_daily_cap || 0),
    points_per_positive_visitor_rating: Number(values.points_per_positive_visitor_rating || 0),
    visitor_rating_positive_threshold: Number(values.visitor_rating_positive_threshold || 4),
    ican_coins_per_point: Number(values.ican_coins_per_point || 0),
    auto_redeem_enabled: Boolean(values.auto_redeem_enabled),
    auto_redeem_threshold_points: Number(values.auto_redeem_threshold_points || 1),
    updated_by: authData?.user?.id || null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await sb.from('cmms_rewards_settings').upsert(settings, { onConflict: 'cmms_company_id' }).select().single();
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const getEmployeeRewardPoints = async (cmmsCompanyId, cmmsUserId = null) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  const { data, error } = await sb.rpc('get_employee_reward_points', { p_cmms_company_id: cmmsCompanyId, p_cmms_user_id: cmmsUserId });
  return { data: data || [], error };
};

export const getRewardPointsHistory = async (cmmsCompanyId, cmmsUserId = null, limit = 50) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  const { data, error } = await sb.rpc('get_reward_points_history', { p_cmms_company_id: cmmsCompanyId, p_cmms_user_id: cmmsUserId, p_limit: limit });
  return { data: data || [], error };
};

export const getPendingRewardRedemptions = async (cmmsCompanyId) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  const { data, error } = await sb.rpc('get_pending_reward_redemptions', { p_cmms_company_id: cmmsCompanyId });
  return { data: data || [], error };
};

export const requestRewardRedemption = async (cmmsCompanyId, cmmsUserId, points = null) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured' };
  const { data, error } = await sb.rpc('cmms_request_reward_redemption', { p_cmms_company_id: cmmsCompanyId, p_cmms_user_id: cmmsUserId, p_points: points });
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const cancelRewardRedemption = async (redemptionId) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured' };
  const { error } = await sb.rpc('cmms_cancel_reward_redemption', { p_redemption_id: redemptionId });
  return error ? { success: false, error: error.message } : { success: true };
};

export const payRewardRedemption = async ({ redemptionId, paymentMethod, walletTransactionId = null }) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured' };
  const { data, error } = await sb.rpc('cmms_pay_reward_redemption', { p_redemption_id: redemptionId, p_payment_method: paymentMethod, p_wallet_transaction_id: walletTransactionId });
  return error ? { success: false, error: error.message } : { success: true, data };
};

// ── Visitor ratings (optional, at check-out; feeds staff reward points) ──
// See backend/CMMS_VISITOR_RATINGS_AND_STAFF_POINTS.sql. submit is callable
// by an anonymous visitor (no sign-in) — it identifies the visit by the
// visitor_id returned from check-out, not by auth.
export const submitVisitorRating = async ({ visitorId, staffRating = null, departmentRating = null, comment = null }) => {
  const sb = db();
  if (!sb || !visitorId) return { success: false, error: 'Missing visitor record' };
  const { data, error } = await sb.rpc('submit_visitor_rating', {
    p_visitor_id: visitorId, p_staff_rating: staffRating, p_department_rating: departmentRating, p_comment: comment
  });
  return error ? { success: false, error: error.message } : { success: true, data };
};

export const getStaffVisitorRatings = async (cmmsCompanyId, cmmsUserId = null) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  const { data, error } = await sb.rpc('get_staff_visitor_ratings', { p_cmms_company_id: cmmsCompanyId, p_cmms_user_id: cmmsUserId });
  return { data: data || [], error };
};

export const getDepartmentVisitorRatings = async (cmmsCompanyId) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: [], error: null };
  const { data, error } = await sb.rpc('get_department_visitor_ratings', { p_cmms_company_id: cmmsCompanyId });
  return { data: data || [], error };
};

// ── Transport plan (self-service) ─────────────────────────────────────────
// See backend/CMMS_EMPLOYEE_TRANSPORT_PLAN_SELF_SERVICE.sql. Self-restricted
// server-side to the caller's own active CMMS membership; returns only an
// aggregate summary of the company's shared BodaGoEra contract, never other
// employees' individual ride requests.
export const getMyTransportPlan = async (cmmsCompanyId) => {
  const sb = db();
  if (!sb || !cmmsCompanyId) return { data: { has_plan: false }, error: null };
  const { data, error } = await sb.rpc('cmms_get_my_transport_plan', { p_cmms_company_id: cmmsCompanyId });
  return { data: data || { has_plan: false }, error };
};

export const getAccessibleBusinesses = async ({ userId, email } = {}) => {
  const sb = db();
  if (!sb) return { data: [], error: null };
  const { findPichinShareholderBusinesses } = await import('./businessManagementService');
  return findPichinShareholderBusinesses({ userId, email });
};

export const findPichinShareholderBusinesses = async ({ email, userId } = {}) => {
  const sb = db();
  if (!sb) return { data: [], error: null };
  const rows = [];
  const seen = new Set();
  let firstError = null;
  if (userId) {
    const { data, error } = await sb.from('business_profiles').select('id, business_name, business_type, metadata, status').eq('user_id', userId);
    if (error) firstError = error;
    (data || []).forEach(profile => {
      if (['inactive', 'suspended', 'rejected', 'deleted'].includes(String(profile.status || 'active').toLowerCase()) || seen.has(profile.id)) return;
      seen.add(profile.id);
      rows.push({ ...profile, canManage: true, matchedBy: 'owner' });
    });

    // The unified business migration records the owner as a business role too.
    // Include those profiles so the Business tab remains connected to the
    // same authority used by CMMS, even when the legacy owner lookup changes.
    const { data: roleRows, error: roleError } = await sb.from('business_member_roles')
      .select('business_profile_id, status, business_profiles(id, business_name, business_type, metadata, status)')
      .eq('auth_user_id', userId)
      .eq('status', 'active');
    if (roleError && !firstError) firstError = roleError;
    (roleRows || []).forEach(row => {
      const profile = row.business_profiles;
      if (!profile?.id || ['inactive', 'suspended', 'rejected', 'deleted'].includes(String(profile.status || 'active').toLowerCase()) || seen.has(profile.id)) return;
      seen.add(profile.id);
      rows.push({ ...profile, canManage: true, matchedBy: 'business-role' });
    });
  }
  if (email) {
    const { data, error } = await sb.from('business_co_owners').select('business_profile_id, role, ownership_share, status, business_profiles(id, business_name, business_type, metadata, status)').ilike('owner_email', email.toLowerCase()).gt('ownership_share', 0);
    if (error && !firstError) firstError = error;
    (data || []).forEach(row => {
      const profile = row.business_profiles;
      if (!profile?.id || seen.has(profile.id) || !['active', 'approved', 'verified'].includes(String(row.status || 'active').toLowerCase())) return;
      seen.add(profile.id);
      rows.push({ ...profile, canManage: Number(row.ownership_share) > 0 || ['owner', 'co-owner', 'shareholder', 'ceo', 'administrator'].includes(String(row.role || '').toLowerCase()), matchedBy: 'shareholder' });
    });
  }
  return { data: rows, error: firstError };
};
