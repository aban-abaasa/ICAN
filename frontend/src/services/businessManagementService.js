import { getSupabase } from './pitchingService';

const db = () => getSupabase();

// Finds Pichin businesses that the signed-in account owns or holds shares in.
// This is intentionally limited to business identity/access metadata; it never
// returns payroll or other financial records.
export const findPichinShareholderBusinesses = async ({ email, userId } = {}) => {
  const sb = db();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!sb || (!normalizedEmail && !userId)) return { data: [], error: null };

  const matches = [];
  const seen = new Set();

  if (normalizedEmail) {
    const { data, error } = await sb
      .from('business_co_owners')
      .select('business_profile_id, owner_email, user_id, ownership_share, status, role, business_profiles(id, business_name)')
      .ilike('owner_email', normalizedEmail)
      .gt('ownership_share', 0);

    if (!error) {
      const profileIds = [...new Set((data || []).map(row => row.business_profile_id).filter(Boolean))];
      let ownershipRows = data || [];
      if (profileIds.length) {
        const { data: allOwners } = await sb
          .from('business_co_owners')
          .select('business_profile_id, owner_email, user_id, ownership_share, role, status')
          .in('business_profile_id', profileIds);
        if (allOwners?.length) ownershipRows = allOwners;
      }

      (data || []).forEach(row => {
        const status = String(row.status || 'active').toLowerCase();
        if (!['active', 'approved', 'verified'].includes(status)) return;
        const profile = row.business_profiles || {};
        const id = row.business_profile_id || profile.id;
        if (!id || seen.has(id)) return;
        const role = String(row.role || '').toLowerCase();
        const currentShare = Number(row.ownership_share) || 0;
        const otherShares = ownershipRows
          .filter(owner => owner.business_profile_id === id)
          .filter(owner => owner.user_id !== row.user_id || String(owner.owner_email || '').toLowerCase() !== String(row.owner_email || '').toLowerCase())
          .map(owner => Number(owner.ownership_share) || 0);
        const majorityOwner = currentShare >= 50 || currentShare > Math.max(0, ...otherShares);
        seen.add(id);
        matches.push({
          id,
          businessName: profile.business_name || 'Pichin business',
          ownershipShare: row.ownership_share,
          matchedBy: 'email',
          // A shareholder can be discovered, but auto-linking CMMS requires
          // an explicit Pichin administrator/co-owner role.
          canManage: ['owner', 'co-owner', 'cofounder', 'ceo', 'administrator'].includes(role) || majorityOwner,
          role: row.role || null
        });
      });
    }
  }

  if (userId) {
    const { data, error } = await sb
      .from('business_profiles')
      .select('id, business_name')
      .eq('user_id', userId);

    if (!error) {
      (data || []).forEach(profile => {
        if (!profile.id || seen.has(profile.id)) return;
        seen.add(profile.id);
        matches.push({
          id: profile.id,
          businessName: profile.business_name || 'Pichin business',
          matchedBy: 'owner',
          canManage: true,
          role: 'owner'
        });
      });
    }
  }

  return { data: matches, error: null };
};

export const getBusinessAccessMembers = async (businessProfileId) => {
  const sb = db();
  if (!sb || !businessProfileId) return { data: [], error: null };

  const { data, error } = await sb
    .from('business_account_members')
    .select('id, auth_user_id, employment_status, job_title, department, employee_number, permissions, joined_at, created_at')
    .eq('business_profile_id', businessProfileId)
    .in('employment_status', ['invited', 'active'])
    .order('created_at', { ascending: false });

  if (error || !data?.length) return { data: data || [], error };

  // auth.users is intentionally not directly readable from the browser. The
  // shared all_users view provides safe display fields for the access panel.
  const ids = data.map(member => member.auth_user_id).filter(Boolean);
  const { data: users } = await sb
    .from('all_users')
    .select('id, user_id, email, full_name')
    .in('user_id', ids);
  const byId = new Map((users || []).map(user => [user.user_id || user.id, user]));

  return {
    data: data.map(member => ({
      ...member,
      user: byId.get(member.auth_user_id) || { email: 'ICAN account', full_name: member.auth_user_id }
    })),
    error: null
  };
};

// CMMS can contain an employee row before its auth UUID is copied into the
// CMMS view. Resolve those employees by their verified ICAN email so payroll
// can still reference auth.users, which is required by the shared ledger.
export const resolveEmployeeAuthIds = async (employees = []) => {
  const sb = db();
  const unresolved = employees.filter(employee => employee?.email && !employee.authUserId);
  if (!sb || unresolved.length === 0) return [];

  const emails = [...new Set(unresolved.map(employee => employee.email.trim().toLowerCase()))];
  const { data, error } = await sb
    .from('all_users')
    .select('id, user_id, email, full_name')
    .in('email', emails);
  if (error) return [];

  const byEmail = new Map((data || []).map(user => [String(user.email || '').toLowerCase(), user]));
  return unresolved.map(employee => {
    const match = byEmail.get(employee.email.trim().toLowerCase());
    const authUserId = match?.user_id || match?.id;
    return authUserId ? {
      ...employee,
      authUserId,
      name: employee.name || match.full_name || employee.email.split('@')[0]
    } : null;
  }).filter(Boolean);
};

export const grantBusinessAccess = async (businessProfileId, user, permissions, details = {}) => {
  const sb = db();
  if (!sb || !businessProfileId || !user?.id) return { success: false, error: 'Missing business or user' };

  const { data, error } = await sb
    .from('business_account_members')
    .upsert({
      business_profile_id: businessProfileId,
      auth_user_id: user.id,
      employment_status: 'active',
      job_title: details.job_title || null,
      department: details.department || null,
      employee_number: details.employee_number || null,
      permissions: permissions || {},
      invited_by: (await sb.auth.getUser()).data.user?.id || null,
      joined_at: new Date().toISOString()
    }, { onConflict: 'business_profile_id,auth_user_id' })
    .select()
    .single();

  return error
    ? { success: false, error: error.message }
    : { success: true, data };
};

export const revokeBusinessAccess = async (memberId) => {
  const sb = db();
  if (!sb) return { success: false, error: 'Supabase is not configured' };
  const { error } = await sb
    .from('business_account_members')
    .update({ employment_status: 'suspended' })
    .eq('id', memberId);
  return error ? { success: false, error: error.message } : { success: true };
};

export const getBusinessCompensation = async (businessProfileId) => {
  const sb = db();
  if (!sb || !businessProfileId) return { data: [], error: null };
  const { data, error } = await sb
    .from('business_compensation_profiles')
    .select('*')
    .eq('business_profile_id', businessProfileId)
    .order('effective_from', { ascending: false });
  return { data: data || [], error };
};

export const saveBusinessCompensation = async (businessProfileId, employeeUserId, values) => {
  const sb = db();
  if (!sb || !businessProfileId || !employeeUserId) return { success: false, error: 'Missing employee or business' };
  const amount = Number(values.base_salary);
  const overtimeRate = Number(values.overtime_rate || 0);
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: 'Enter a salary or rate greater than zero.' };
  if (!Number.isFinite(overtimeRate) || overtimeRate < 0) return { success: false, error: 'Enter a valid overtime/rate amount.' };
  const currency = String(values.currency || 'UGX').trim().toUpperCase();
  if (!/^[A-Z]{3,6}$/.test(currency)) return { success: false, error: 'Currency must be 3–6 letters.' };
  const payrollStatus = ['on_pay', 'on_hold', 'ended'].includes(values.payroll_status)
    ? values.payroll_status
    : 'on_pay';
  const { data: authData } = await sb.auth.getUser();
  const effectiveFrom = values.effective_from || new Date().toISOString().slice(0, 10);
  const compensation = {
      business_profile_id: businessProfileId,
      employee_user_id: employeeUserId,
      pay_type: values.pay_type || 'monthly',
      base_salary: amount,
      currency,
      effective_from: effectiveFrom,
      overtime_rate: overtimeRate,
      payroll_status: payrollStatus,
      notes: values.notes || null,
      created_by: authData?.user?.id || null
  };
  let { data, error } = await sb
    .from('business_compensation_profiles')
    .upsert(compensation, { onConflict: 'business_profile_id,employee_user_id,effective_from' })
    .select()
    .single();

  // Older deployments may not have applied the payroll_status migration yet.
  // Keep salary assignment usable until the shared SQL migration is run.
  if (error && /payroll_status.*schema cache|column .*payroll_status.*does not exist/i.test(error.message || '')) {
    const { payroll_status: _payrollStatus, ...legacyCompensation } = compensation;
    ({ data, error } = await sb
      .from('business_compensation_profiles')
      .upsert(legacyCompensation, { onConflict: 'business_profile_id,employee_user_id,effective_from' })
      .select()
      .single());
  }
  return error ? { success: false, error: error.message } : { success: true, data };
};
