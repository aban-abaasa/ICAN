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
  return { data: data.map(member => ({ ...member, user: byId.get(member.auth_user_id) || { email: 'ICAN account', full_name: member.auth_user_id } })), error: null };
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
  const compensation = { business_profile_id: businessProfileId, employee_user_id: employeeUserId, pay_type: values.pay_type || 'monthly', base_salary: amount, currency: String(values.currency || 'UGX').trim().toUpperCase(), effective_from: values.effective_from || new Date().toISOString().slice(0, 10), overtime_rate: Number(values.overtime_rate || 0), payroll_status: values.payroll_status || 'on_pay', notes: values.notes || null, created_by: authData?.user?.id || null };
  let { data, error } = await sb.from('business_compensation_profiles').upsert(compensation, { onConflict: 'business_profile_id,employee_user_id,effective_from' }).select().single();
  if (error && /payroll_status.*schema cache|column .*payroll_status.*does not exist/i.test(error.message || '')) {
    const { payroll_status: _ignored, ...legacyCompensation } = compensation;
    ({ data, error } = await sb.from('business_compensation_profiles').upsert(legacyCompensation, { onConflict: 'business_profile_id,employee_user_id,effective_from' }).select().single());
  }
  return error ? { success: false, error: error.message } : { success: true, data };
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
    const { data, error } = await sb.from('business_profiles').select('id, business_name, business_type, metadata, status').eq('user_id', userId).eq('status', 'active');
    if (error) firstError = error;
    (data || []).forEach(profile => { if (!seen.has(profile.id)) { seen.add(profile.id); rows.push({ ...profile, canManage: true, matchedBy: 'owner' }); } });

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
      if (!profile?.id || profile.status !== 'active' || seen.has(profile.id)) return;
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
