/**
 * CMMS Supabase Service
 * Handles all database operations for Computerized Maintenance Management System
 * Integrates with CMMS_IMPLEMENTATION_DATA_SPECIFIC schema
 */

import { supabase } from '../client';

const normalizeCmmsRoleKey = (rawRole) => {
  if (!rawRole) return '';

  const normalizedToken = String(rawRole)
    .trim()
    .toLowerCase()
    .replace(/^cmms[_-]/, '')
    .replace(/[\s_]+/g, '-');

  const aliases = {
    administrator: 'admin',
    admin: 'admin',
    'department-coordinator': 'coordinator',
    coordinator: 'coordinator',
    'financial-officer': 'finance',
    finance: 'finance',
    supervisor: 'supervisor',
    technician: 'technician',
    storeman: 'storeman',
    'service-provider': 'service-provider',
    serviceprovider: 'service-provider',
    viewer: 'viewer'
  };

  return aliases[normalizedToken] || normalizedToken;
};

const findCmmsRoleId = async (targetRoleKey) => {
  const normalizedRoleKey = normalizeCmmsRoleKey(targetRoleKey);
  const { data: roleRows, error: roleLookupError } = await supabase
    .from('cmms_roles')
    .select('id, role_name');

  if (roleLookupError) {
    throw roleLookupError;
  }

  const matchingRole = (roleRows || []).find((roleRow) => (
    normalizeCmmsRoleKey(roleRow.role_name) === normalizedRoleKey
  ));

  if (!matchingRole) {
    throw new Error(`Role "${normalizedRoleKey}" not found in cmms_roles`);
  }

  return matchingRole.id;
};

const isMissingRpcFunctionError = (rpcError) => {
  const errorText = `${rpcError?.message || ''} ${rpcError?.details || ''}`.toLowerCase();
  return errorText.includes('could not find the function') || errorText.includes('does not exist');
};

const resolveCmmsUserIdByEmail = async (companyId, userEmail) => {
  if (!companyId || !userEmail) {
    return null;
  }

  const { data, error } = await supabase
    .from('cmms_users')
    .select('id')
    .eq('cmms_company_id', companyId)
    .ilike('email', userEmail)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.id || null;
};

const mapCmmsInventoryItem = (itemRow) => {
  if (!itemRow) return null;

  console.log(`ðŸ” Mapping item ${itemRow.item_code}:`, {
    unit_price: itemRow.unit_price,
    unit_cost: itemRow.unit_cost,
    reorder_level: itemRow.reorder_level,
    minimum_stock_level: itemRow.minimum_stock_level,
    is_active: itemRow.is_active
  });

  return {
    ...itemRow,
    minimum_stock_level: itemRow.reorder_level ?? itemRow.minimum_stock_level ?? 0,
    unit_cost: itemRow.unit_price ?? itemRow.unit_cost ?? 0
  };
};

// ============================================
// COMPANY PROFILE OPERATIONS
// ============================================

/**
 * Create or update a CMMS company profile (UNIQUE - CMMS ONLY)
 * @param {Object} companyData - Company information
 * @returns {Object} Created/updated company data or error
 */
export const createCompanyProfile = async (companyData) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // First, check if profile with this email already exists
    const { data: existingProfile, error: checkError } = await supabase
      .from('cmms_company_profiles')
      .select('id')
      .eq('email', companyData.email)
      .maybeSingle();

    // If profile exists, update it
    if (existingProfile && !checkError) {
      console.log('Company profile already exists, updating it...');
      const { data, error } = await supabase
        .from('cmms_company_profiles')
        .update({
          company_name: companyData.companyName,
          company_registration: companyData.companyRegistration,
          location: companyData.location,
          industry: companyData.industry || 'Manufacturing',
          phone: companyData.phone,
          website: companyData.website || '',
          is_active: true
        })
        .eq('id', existingProfile.id)
        .select()
        .maybeSingle();

      if (error) {
        const isNoRow = error?.code === 'PGRST116' || /0 rows/i.test(error?.details || '');
        if (!isNoRow) throw error;
      }

      if (!data) {
        const { data: fresh, error: freshError } = await supabase
          .from('cmms_company_profiles')
          .select('*')
          .eq('id', existingProfile.id)
          .maybeSingle();
        if (freshError) throw freshError;
        return { data: fresh || existingProfile, error: null };
      }

      console.log('CMMS Company profile updated:', data);
      return { data, error: null };
    }

    // If no profile exists, create new one
    const { data, error } = await supabase
      .from('cmms_company_profiles')
      .insert({
        company_name: companyData.companyName,
        company_registration: companyData.companyRegistration,
        location: companyData.location,
        industry: companyData.industry || 'Manufacturing',
        phone: companyData.phone,
        email: companyData.email,
        website: companyData.website || '',
        cmms_enabled: true,
        is_active: true,
        created_by: user.id,
        maintenance_budget_annual: 0,
        preventive_maintenance_enabled: true,
        inventory_enabled: true,
        work_order_enabled: true,
        analytics_enabled: true,
        mobile_app_enabled: true
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    console.log('âœ… CMMS Company profile created:', data);
    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error creating CMMS company profile:', error);
    return { data: null, error };
  }
};

/**
 * Get company profile by ID
 * @param {string} companyId - Company UUID
 * @returns {Object} Company data or error
 */
export const getCompanyProfile = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('cmms_company_profiles')
      .select('*')
      .eq('id', companyId)
      .single();

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error fetching company profile:', error);
    return { data: null, error };
  }
};

/**
 * Update company profile
 * @param {string} companyId - Company UUID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated company data or error
 */
export const updateCompanyProfile = async (companyId, updates) => {
  try {
    const { data, error } = await supabase
      .from('cmms_company_profiles')
      .update({
        company_name: updates.companyName,
        company_registration: updates.companyRegistration,
        location: updates.location,
        phone: updates.phone,
        email: updates.email,
        industry: updates.industry,
        website: updates.website,
        updated_at: new Date().toISOString()
      })
      .eq('id', companyId)
      .select()
      .single();

    if (error) throw error;

    console.log('âœ… Company profile updated:', data);
    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error updating company profile:', error);
    return { data: null, error };
  }
};

/**
 * Create CMMS company with departments (ATOMIC - Company + All Departments)
 * @param {Object} companyData - Company information
 * @param {Array} departments - Array of department objects with name, description, location
 * @returns {Object} Created company, departments, status or error
 */
export const createCompanyWithDepartments = async (companyData, departments = []) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Format departments as JSONB array with proper field names
    const departmentsJsonb = departments.length > 0 
      ? departments.map(dept => ({
          department_name: dept.department_name || dept.name || '',
          description: dept.description || '',
          location: dept.location || ''
        }))
      : null;

    console.log('ðŸ“¤ Calling RPC fn_create_cmms_company_with_departments with:', {
      p_company_name: companyData.companyName,
      p_departments: departmentsJsonb
    });

    // Call RPC function that creates company and all departments atomically
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'fn_create_cmms_company_with_departments',
      {
        p_company_name: companyData.companyName,
        p_company_registration: companyData.companyRegistration || '',
        p_location: companyData.location || '',
        p_email: companyData.email,
        p_phone: companyData.phone,
        p_departments: departmentsJsonb
      }
    );

    if (rpcError) {
      console.error('âŒ RPC Error:', rpcError);
      throw rpcError;
    }

    console.log('ðŸ“¥ RPC Response:', rpcResult);

    // Extract result (might be array or single object)
    const resultRow = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    
    if (!resultRow) {
      throw new Error('RPC returned no result');
    }

    if (resultRow.status && resultRow.status.includes('ERROR')) {
      throw new Error(resultRow.message || 'RPC returned error status');
    }

    const companyId = resultRow.company_id;
    const departmentsCreated = resultRow.departments_created || 0;

    if (!companyId) {
      throw new Error('RPC returned null company_id');
    }

    console.log('âœ… Company created by RPC:', { companyId, departmentsCreated });

    // Fetch the created company profile
    const { data: companyProfile, error: companyError } = await supabase
      .from('cmms_company_profiles')
      .select('*')
      .eq('id', companyId)
      .single();

    if (companyError) throw companyError;

    // Fetch the created departments via RPC
    let deptsList = [];
    if (departmentsCreated > 0) {
      const { data: depts, error: deptsError } = await supabase.rpc('fn_get_departments_by_company', {
        p_company_id: companyId
      });
      if (deptsError) {
        console.error('âš ï¸ Error fetching departments:', deptsError);
      } else {
        deptsList = depts || [];
      }
    }

    console.log('âœ… Company with departments ready:', {
      company: companyProfile,
      departments: deptsList
    });

    return {
      data: {
        company: companyProfile,
        departments: deptsList,
        departmentsCreated
      },
      error: null
    };
  } catch (error) {
    console.error('âŒ Error creating company with departments:', error);
    return { data: null, error };
  }
};

// ============================================
// USER MANAGEMENT (CMMS Users - Different from Auth Users)
// ============================================

/**
 * Create admin user for newly created CMMS company
 * @param {string} cmmsCompanyId - CMMS Company UUID
 * @param {Object} userData - User information
 * @returns {Object} Created user data or error
 */
export const createAdminUser = async (cmmsCompanyId, userData) => {
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) throw new Error('User not authenticated');
    const bootstrapEmail = authUser.email || userData.email;

    const { data: rpcUserId, error: rpcError } = await supabase.rpc('cmms_bootstrap_creator', {
      p_company_id: cmmsCompanyId,
      p_email: bootstrapEmail,
      p_name: userData.name || 'Company Owner',
      p_phone: userData.phone || ''
    });

    if (rpcError) throw rpcError;

    const { data, error } = await supabase
      .from('cmms_users')
      .select('*')
      .eq('id', rpcUserId)
      .maybeSingle();

    if (error) throw error;

    try {
      const adminRoleId = await findCmmsRoleId('admin');
      const { error: roleError } = await assignUserRole(cmmsCompanyId, data.id, adminRoleId);
      if (roleError) {
        console.warn('âš ï¸ Direct admin role assignment failed, will rely on creator enforcement RPC:', roleError);
      }
    } catch (roleSetupError) {
      console.warn('âš ï¸ Could not assign admin role during createAdminUser, creator enforcement RPC will handle it:', roleSetupError);
    }

    console.log('âœ… CMMS Admin user created:', data);
    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error creating CMMS admin user:', error);
    return { data: null, error };
  }
};

/**
 * Get users for a company
 * @param {string} companyId - Company UUID
 * @returns {Object} Array of users or error
 */
export const getCompanyUsers = async (cmmsCompanyId) => {
  try {
    // Use RPC function that bypasses RLS
    const { data, error } = await supabase.rpc('fn_get_company_users_list', {
      p_company_id: cmmsCompanyId
    });

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error fetching company users:', error);
    return { data: null, error };
  }
};

// ============================================
// ROLE MANAGEMENT
// ============================================

/**
 * Assign role to user
 * @param {string} companyId - Company UUID
 * @param {string} userId - User UUID
 * @param {number} roleId - Role ID (1=Admin, 2=Coordinator, etc.)
 * @returns {Object} Created assignment or error
 */
export const assignUserRole = async (cmmsCompanyId, cmmsUserId, cmmsRoleId) => {
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('cmms_user_roles')
      .insert({
        cmms_company_id: cmmsCompanyId,
        cmms_user_id: cmmsUserId,
        cmms_role_id: cmmsRoleId,
        assigned_by: authUser.id,
        assigned_at: new Date().toISOString(),
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error assigning role:', error);
    return { data: null, error };
  }
};

/**
 * Get user roles for a company
 * @param {string} companyId - Company UUID
 * @returns {Object} Array of user roles or error
 */
export const getUserRoles = async (cmmsCompanyId) => {
  try {
    const { data, error } = await supabase
      .from('cmms_user_roles')
      .select(`
        *,
        cmms_users:cmms_user_id(id, user_name, email),
        cmms_roles:cmms_role_id(role_name, permission_level)
      `)
      .eq('cmms_company_id', cmmsCompanyId)
      .eq('is_active', true);

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error fetching user roles:', error);
    return { data: null, error };
  }
};

// ============================================
// DEPARTMENT OPERATIONS (CMMS DEPARTMENTS)
// ============================================

/**
 * Create CMMS department
 * @param {string} companyId - CMMS Company UUID
 * @param {Object} deptData - Department information
 * @returns {Object} Created department data or error
 */
export const createCmmsDepartment = async (companyId, deptData) => {
  try {
    if (!companyId) {
      throw new Error('Company ID is required to create a department');
    }

    console.log('ðŸ“¤ Creating department for company:', companyId, deptData);

    let rpcResult;
    let rpcError;

    ({ data: rpcResult, error: rpcError } = await supabase.rpc('fn_create_cmms_department', {
      p_company_id: companyId,
      p_department_name: deptData.department_name || deptData.departmentName || '',
      p_description: deptData.description || null,
      p_location: deptData.location || null
    }));

    console.log('ðŸ“¥ RPC response:', rpcResult, 'Error:', rpcError);

    if (rpcError && isMissingRpcFunctionError(rpcError)) {
      console.log('âš ï¸ RPC not found, using fallback direct insert');
      const fallback = await supabase
        .from('cmms_departments')
        .insert({
          cmms_company_id: companyId,
          department_name: deptData.department_name || deptData.departmentName || '',
          description: deptData.description || '',
          location: deptData.location || '',
          is_active: true
        })
        .select()
        .single();

      if (fallback.error) throw fallback.error;
      console.log('âœ… Department created via fallback:', fallback.data);
      return { data: fallback.data, error: null };
    }

    if (rpcError) {
      console.error('âŒ RPC Error:', rpcError);
      throw rpcError;
    }

    const resultRow = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    
    // Check if RPC returned valid result
    if (!resultRow) {
      throw new Error('RPC returned empty result');
    }

    // Check for error status in RPC result
    if (resultRow.status === 'ERROR' || resultRow.message?.includes('ERROR')) {
      console.error('âŒ RPC returned error status:', resultRow);
      throw new Error(resultRow.message || 'RPC function returned an error');
    }

    // If result row already has department data, return it directly
    if (resultRow.id && resultRow.department_name) {
      console.log('âœ… Department created by RPC:', resultRow);
      return { data: resultRow, error: null };
    }

    // If RPC returned a department_id, construct the department object from it
    if (resultRow.department_id) {
      // Build minimal department object from what we know
      const createdDept = {
        id: resultRow.department_id,
        cmms_company_id: companyId,
        department_name: deptData.department_name || deptData.departmentName || '',
        description: deptData.description || '',
        location: deptData.location || '',
        is_active: true,
        created_at: new Date().toISOString()
      };
      
      console.log('âœ… Department created by RPC (ID: ' + resultRow.department_id + ')');
      return { data: createdDept, error: null };
    }

    // If we get here, result has unexpected format
    console.warn('âš ï¸ Unexpected RPC result format:', resultRow);
    return { data: resultRow, error: null };

  } catch (error) {
    console.error('âŒ Error creating CMMS department:', error);
    return { data: null, error };
  }
};

/**
 * Get CMMS departments for company
 * @param {string} companyId - CMMS Company UUID
 * @returns {Object} Array of departments or error
 */
export const getCmmsDepartments = async (companyId) => {
  try {
    // Use RPC function that bypasses RLS
    const { data, error } = await supabase.rpc('fn_get_departments_by_company', {
      p_company_id: companyId
    });

    if (error) throw error;

    return { data: data || [], error: null };
  } catch (error) {
    console.error('Error fetching CMMS departments:', error);
    return { data: [], error };
  }
};

/**
 * Update CMMS department
 * @param {string} departmentId - Department UUID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated department data or error
 */
export const updateCmmsDepartment = async (departmentId, updates) => {
  try {
    let rpcResult;
    let rpcError;

    ({ data: rpcResult, error: rpcError } = await supabase.rpc('fn_update_cmms_department', {
      p_department_id: departmentId,
      p_department_name: updates.department_name ?? null,
      p_description: updates.description ?? null,
      p_location: updates.location ?? null,
      p_is_active: updates.is_active ?? null
    }));

    if (rpcError && isMissingRpcFunctionError(rpcError)) {
      const fallback = await supabase
        .from('cmms_departments')
        .update({
          department_name: updates.department_name,
          description: updates.description,
          location: updates.location,
          updated_at: new Date().toISOString()
        })
        .eq('id', departmentId)
        .select()
        .single();

      if (fallback.error) throw fallback.error;
      return { data: fallback.data, error: null };
    }

    if (rpcError) throw rpcError;

    const resultRow = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    if (!resultRow || resultRow.status !== 'SUCCESS') {
      throw new Error(resultRow?.message || 'Unable to update department');
    }

    const { data: updatedDept, error: fetchError } = await supabase
      .from('cmms_departments')
      .select('*')
      .eq('id', departmentId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    return { data: updatedDept || resultRow, error: null };
  } catch (error) {
    console.error('Error updating CMMS department:', error);
    return { data: null, error };
  }
};

/**
 * Delete (deactivate) CMMS department
 * @param {string} departmentId - Department UUID
 * @returns {Object} Success or error
 */
export const deleteCmmsDepartment = async (departmentId) => {
  try {
    let rpcResult;
    let rpcError;

    ({ data: rpcResult, error: rpcError } = await supabase.rpc('fn_delete_cmms_department', {
      p_department_id: departmentId
    }));

    if (rpcError && isMissingRpcFunctionError(rpcError)) {
      const fallback = await supabase
        .from('cmms_departments')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', departmentId);

      if (fallback.error) throw fallback.error;
      return { data: { success: true }, error: null };
    }

    if (rpcError) throw rpcError;

    const resultRow = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    if (!resultRow || resultRow.status !== 'SUCCESS') {
      throw new Error(resultRow?.message || 'Unable to delete department');
    }

    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('Error deleting CMMS department:', error);
    return { data: null, error };
  }
};

/**
 * Get storemen for a department
 * @param {string} departmentId - Department UUID
 * @returns {Object} Array of storemen or error
 */
export const getDepartmentStoremen = async (departmentId) => {
  try {
    if (!departmentId) {
      return { data: [], error: null };
    }

    const { data, error } = await supabase
      .from('cmms_users')
      .select(`
        id,
        user_name,
        email,
        department_id,
        cmms_user_roles:cmms_user_id(
          is_active,
          cmms_roles:cmms_role_id(role_name)
        )
      `)
      .eq('department_id', departmentId)
      .eq('is_active', true)
      .order('user_name', { ascending: true });

    if (error) throw error;

    const storemen = (data || [])
      .filter((userRow) => {
        const roles = userRow.cmms_user_roles || [];
        return roles.some((roleRow) => (
          roleRow.is_active !== false &&
          ['storeman', 'admin'].includes(normalizeCmmsRoleKey(roleRow.cmms_roles?.role_name))
        ));
      })
      .map((userRow) => ({
        ...userRow,
        name: userRow.user_name
      }));

    return { data: storemen, error: null };
  } catch (error) {
    console.error('Error fetching department storemen:', error);
    return { data: [], error };
  }
};

/**
 * Create department (legacy - uses departments table)
 * @param {string} companyId - Company UUID
 * @param {Object} deptData - Department information
 * @returns {Object} Created department data or error
 */
export const createDepartment = async (companyId, deptData) => {
  try {
    const { data, error } = await supabase
      .from('departments')
      .insert({
        company_id: companyId,
        department_name: deptData.departmentName,
        description: deptData.description || '',
        head_id: deptData.headId || null,
        budget: deptData.budget || 0,
        budget_year: new Date().getFullYear(),
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error creating department:', error);
    return { data: null, error };
  }
};

/**
 * Get company departments
 * @param {string} companyId - Company UUID
 * @returns {Object} Array of departments or error
 */
export const getCompanyDepartments = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('department_name', { ascending: true });

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error fetching departments:', error);
    return { data: null, error };
  }
};

// ============================================
// WORK ORDER OPERATIONS
// ============================================

/**
 * Get work orders for company
 * @param {string} companyId - Company UUID
 * @returns {Object} Array of work orders or error
 */
export const getCompanyWorkOrders = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('work_orders')
      .select(`
        *,
        equipment:equipment_id(equipment_name, equipment_code)
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error fetching work orders:', error);
    return { data: null, error };
  }
};

// ============================================
// INVENTORY OPERATIONS
// ============================================

/**
 * Get inventory items for company
 * Uses RPC function that bypasses RLS
 * @param {string} companyId - Company UUID
 * @returns {Object} Array of inventory items or error
 */
export const getCompanyInventory = async (companyId) => {
  try {
    console.log('ðŸ“¦ Fetching inventory for company via RPC:', companyId);
    
    // Use RPC function that bypasses RLS (SECURITY DEFINER)
    const { data, error } = await supabase.rpc('fn_get_company_inventory', {
      p_company_id: companyId
    });

    if (error) {
      console.error('âŒ RPC fetch error:', error);
      throw error;
    }

    console.log(`ðŸ“¦ RPC response: ${data?.length || 0} items returned`);
    if (data && data.length > 0) {
      console.log('ðŸ” Sample item from RPC:', data[0]);
    }

    const mappedItems = (data || []).map(mapCmmsInventoryItem);
    console.log(`âœ… Mapped inventory: ${mappedItems.length} items`, mappedItems.slice(0, 2));
    
    return { data: mappedItems, error: null };
  } catch (error) {
    console.error('âŒ Error fetching inventory:', error);
    return { data: [], error };
  }
};

/**
 * Get inventory transactions
 * @param {string} companyId - Company UUID
 * @returns {Object} Array of transactions or error
 */
export const getInventoryTransactions = async (companyId, limit = 50) => {
  try {
    const { data, error } = await supabase
      .from('inventory_transactions')
      .select(`
        *,
        inventory_item:inventory_item_id(item_name, item_code)
      `)
      .eq('company_id', companyId)
      .order('transaction_date', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error fetching transactions:', error);
    return { data: null, error };
  }
};

/**
 * Add a new inventory item
 * @param {string} companyId - Company UUID
 * @param {Object} itemData - Item data
 * @returns {Object} Created item or error
 */
export const addInventoryItem = async (companyId, itemData) => {
  try {
    console.log('ðŸ“ Adding inventory item via RPC function...');
    console.log('ðŸ” Parameters:', { 
      company_id: companyId,
      department_id: itemData.department_id,
      item_name: itemData.item_name,
      item_code: itemData.item_code,
      unit_price: parseFloat(itemData.unit_price ?? itemData.unit_cost),
      quantity_in_stock: parseFloat(itemData.quantity_in_stock)
    });
    
    // Use RPC function to bypass RLS
    const { data, error } = await supabase.rpc('fn_create_cmms_inventory_item', {
      p_company_id: companyId,
      p_department_id: itemData.department_id || null,
      p_item_name: itemData.item_name,
      p_item_code: itemData.item_code || null,
      p_category: itemData.category || 'Spare Parts',
      p_supplier_name: itemData.supplier_name || '',
      p_quantity_in_stock: parseFloat(itemData.quantity_in_stock) || 0,
      p_reorder_level: parseFloat(itemData.reorder_level ?? itemData.minimum_stock_level) || 0,
      p_unit_price: parseFloat(itemData.unit_price ?? itemData.unit_cost) || 0,
      p_storage_location: itemData.storage_location || '',
      p_bin_number: itemData.bin_number || '',
      p_unit_of_measure: itemData.unit_of_measure || 'units',
      p_description: itemData.description || '',
      p_lead_time_days: parseInt(itemData.lead_time_days) || 0
    });

    if (error) {
      console.error('âŒ RPC error:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.error('âŒ Function returned no data');
      throw new Error('No data returned from function');
    }

    const result = data[0];
    console.log('ðŸ“¦ RPC Response:', result);

    if (result.status === 'ERROR') {
      const errorMsg = result.message || 'Unknown error';
      console.error('âŒ Function returned error:', errorMsg);
      throw new Error(errorMsg);
    }

    // IMPORTANT: Map returned data to inventory item format with field mappings
    const unitPrice = parseFloat(itemData.unit_price ?? itemData.unit_cost) || 0;
    const mappedItem = {
      id: result.item_id,
      cmms_company_id: companyId,
      department_id: itemData.department_id,
      item_code: result.item_code,
      item_name: result.item_name,
      category: itemData.category || 'Spare Parts',
      quantity_in_stock: parseFloat(itemData.quantity_in_stock) || 0,
      reorder_level: parseFloat(itemData.reorder_level ?? itemData.minimum_stock_level) || 0,
      unit_price: unitPrice,
      unit_cost: unitPrice,  // Ensure both are set for compatibility
      minimum_stock_level: parseFloat(itemData.reorder_level ?? itemData.minimum_stock_level) || 0,
      supplier_name: itemData.supplier_name || '',
      storage_location: itemData.storage_location || '',
      bin_number: itemData.bin_number || '',
      unit_of_measure: itemData.unit_of_measure || 'units',
      description: itemData.description || '',
      lead_time_days: parseInt(itemData.lead_time_days) || 0,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('âœ… Inventory item created via RPC:', {
      item_code: result.item_code,
      unit_price: mappedItem.unit_price,
      is_active: mappedItem.is_active
    });
    return { data: mappedItem, error: null };
  } catch (error) {
    console.error('âŒ Error adding inventory item:', error);
    return { data: null, error };
  }
};

/**
 * Update inventory item
 * @param {string} itemId - Item UUID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated item or error
 */
export const updateInventoryItem = async (itemId, updates) => {
  try {
    let cmmsUserId = null;
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) {
      const { data: existingItem } = await supabase
        .from('cmms_inventory_items')
        .select('cmms_company_id')
        .eq('id', itemId)
        .maybeSingle();
      cmmsUserId = await resolveCmmsUserIdByEmail(existingItem?.cmms_company_id, user.email);
    }

    const { data, error } = await supabase
      .from('cmms_inventory_items')
      .update({
        ...(updates.item_name && { item_name: updates.item_name }),
        ...(updates.category && { category: updates.category }),
        ...(updates.quantity_in_stock !== undefined && { quantity_in_stock: parseFloat(updates.quantity_in_stock) }),
        ...(updates.minimum_stock_level !== undefined && { reorder_level: parseFloat(updates.minimum_stock_level) }),
        ...(updates.reorder_level !== undefined && { reorder_level: parseFloat(updates.reorder_level) }),
        ...(updates.unit_cost !== undefined && { unit_price: parseFloat(updates.unit_cost) }),
        ...(updates.unit_price !== undefined && { unit_price: parseFloat(updates.unit_price) }),
        ...(updates.department_id !== undefined && { department_id: updates.department_id || null }),
        ...(updates.assigned_storeman_id !== undefined && { assigned_storeman_id: updates.assigned_storeman_id || null }),
        ...(updates.storage_location && { storage_location: updates.storage_location }),
        ...(updates.supplier_name && { supplier_name: updates.supplier_name }),
        updated_at: new Date().toISOString(),
        last_stock_check: new Date().toISOString(),
        ...(cmmsUserId && { last_updated_by: cmmsUserId })
      })
      .eq('id', itemId)
      .select()
      .single();

    if (error) throw error;

    return { data: mapCmmsInventoryItem(data), error: null };
  } catch (error) {
    console.error('Error updating inventory item:', error);
    return { data: null, error };
  }
};

/**
 * Delete (deactivate) inventory item
 * @param {string} itemId - Item UUID
 * @returns {Object} Success or error
 */
export const deleteInventoryItem = async (itemId) => {
  try {
    const { error } = await supabase
      .from('cmms_inventory_items')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId);

    if (error) throw error;

    return { data: { success: true }, error: null };
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    return { data: null, error };
  }
};

/**
 * Update inventory quantity with transaction logging
 * @param {string} itemId - Item UUID
 * @param {number} newQuantity - New quantity
 * @param {string} reason - Reason for change
 * @returns {Object} Success or error
 */
export const updateInventoryQuantity = async (itemId, newQuantity, reason = 'Quantity update') => {
  try {
    let cmmsUserId = null;
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) {
      const { data: existingItem } = await supabase
        .from('cmms_inventory_items')
        .select('cmms_company_id')
        .eq('id', itemId)
        .maybeSingle();
      cmmsUserId = await resolveCmmsUserIdByEmail(existingItem?.cmms_company_id, user.email);
    }

    const { data, error } = await supabase
      .from('cmms_inventory_items')
      .update({
        quantity_in_stock: parseFloat(newQuantity),
        last_stock_check: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(cmmsUserId && { last_updated_by: cmmsUserId })
      })
      .eq('id', itemId)
      .select()
      .single();

    if (error) throw error;

    // Quantity audit logging is handled by DB trigger on cmms_inventory_items.
    void reason;

    return { data: mapCmmsInventoryItem(data), error: null };
  } catch (error) {
    console.error('Error updating quantity:', error);
    return { data: null, error };
  }
};

// ============================================
// BUDGET TRACKING
// ============================================

/**
 * Get budget tracking for company
 * @param {string} companyId - Company UUID
 * @returns {Object} Array of budget records or error
 */
export const getCompanyBudget = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('budget_tracking')
      .select(`
        *,
        departments:department_id(department_name)
      `)
      .eq('company_id', companyId)
      .eq('budget_year', new Date().getFullYear());

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error fetching budget:', error);
    return { data: null, error };
  }
};

// ============================================
// EQUIPMENT OPERATIONS
// ============================================

/**
 * Get equipment for company
 * @param {string} companyId - Company UUID
 * @returns {Object} Array of equipment or error
 */
export const getCompanyEquipment = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('equipment')
      .select('*')
      .eq('company_id', companyId)
      .order('equipment_code', { ascending: true });

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error fetching equipment:', error);
    return { data: null, error };
  }
};

// ============================================
// MAINTENANCE PLANS
// ============================================

/**
 * Get maintenance plans for company
 * @param {string} companyId - Company UUID
 * @returns {Object} Array of maintenance plans or error
 */
export const getMaintenancePlans = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('maintenance_plans')
      .select(`
        *,
        equipment:equipment_id(equipment_name, equipment_code)
      `)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('next_due_date', { ascending: true });

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('âŒ Error fetching maintenance plans:', error);
    return { data: null, error };
  }
};

/**
 * Get all storemen for a company
 * @param {string} companyId - CMMS Company UUID
 * @returns {Object} Array of all storemen or error
 */
export const getCompanyStoremen = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('cmms_users')
      .select(`
        id,
        user_name,
        name,
        email,
        department_id,
        cmms_user_roles:cmms_user_id(
          cmms_role_id,
          cmms_roles:cmms_role_id(role_name)
        )
      `)
      .eq('cmms_company_id', companyId)
      .eq('is_active', true);

    if (error) throw error;

    // Filter for storemen only
    const storemen = (data || []).filter(user => {
      const roles = user.cmms_user_roles || [];
      return roles.some(r => r.cmms_roles?.role_name === 'storeman');
    });

    return { data: storemen, error: null };
  } catch (error) {
    console.error('âŒ Error fetching company storemen:', error);
    return { data: [], error };
  }
};

export const markCompanyCreator = async (companyId, userId, creatorEmail) => {
  try {
    console.log('ðŸ”‘ Marking company creator:', { companyId, userId, creatorEmail });

    const rpcPayload = {
      p_company_id: companyId,
      p_user_id: userId,
      p_creator_email: creatorEmail
    };

    let { data, error } = await supabase.rpc('ensure_cmms_creator_admin', rpcPayload);

    if (error && isMissingRpcFunctionError(error)) {
      console.warn('âš ï¸ ensure_cmms_creator_admin RPC not found, falling back to mark_company_creator');
      const fallbackResult = await supabase.rpc('mark_company_creator', rpcPayload);
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) {
      console.error('âŒ Error marking creator:', error);
      return { data: null, error };
    }

    console.log('âœ… Company creator marked successfully');
    return { data, error: null };
  } catch (error) {
    console.error('âŒ Exception marking company creator:', error);
    return { data: null, error };
  }
};

// ============================================
// MAINTENANCE REQUISITIONS MANAGEMENT
// ============================================

const mapRequisitionLineItem = (itemRow = {}) => {
  const quantity = Number(itemRow.requested_quantity ?? itemRow.quantity ?? 0);
  const costPerUnit = Number(itemRow.unit_price ?? itemRow.costPerUnit ?? itemRow.unit_cost ?? 0);
  const lineTotal = Number(itemRow.line_total ?? itemRow.totalCost ?? quantity * costPerUnit);
  const equipment = itemRow.item_name || itemRow.equipment || 'Inventory item';

  return {
    ...itemRow,
    id: itemRow.id,
    equipment,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    costPerUnit: Number.isFinite(costPerUnit) ? costPerUnit : 0,
    totalCost: Number.isFinite(lineTotal) ? lineTotal : 0,
    condition: itemRow.condition || itemRow.item_condition || itemRow.item_description || ''
  };
};

const toRequisitionItemInsertRow = (item = {}, requisitionId, departmentId) => {
  const quantity = Number(item.quantity ?? item.requested_quantity ?? 0);
  const unitPrice = Number(item.costPerUnit ?? item.unit_price ?? item.unit_cost ?? 0);

  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

  return {
    requisition_id: requisitionId,
    department_id: departmentId,
    inventory_item_id: item.inventory_item_id || null,
    item_code: item.item_code || null,
    item_name: item.equipment || item.item_name || 'Inventory item',
    item_description: item.condition || item.item_description || null,
    category: item.category || null,
    requested_quantity: quantity,
    unit_of_measure: item.unit_of_measure || 'unit',
    unit_price: unitPrice,
    reason_for_requisition: item.reason_for_requisition || null
  };
};

const isRlsPolicyError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42501' || message.includes('row-level security') || message.includes('policy');
};

/**
 * Fetch company requisitions from Supabase
 * Includes all requisition details and approval chain status
 */
export const getCompanyRequisitions = async (companyId) => {
  try {
    console.log(`Fetching requisitions for company: ${companyId}`);

    // Try RPC first (bypasses RLS)
    let requisitions = null;
    let error = null;

    const { data: rpcData, error: rpcError } = await supabase.rpc('fn_get_company_requisitions', {
      p_company_id: companyId
    });

    if (!rpcError && rpcData) {
      requisitions = rpcData;
      console.log('Requisitions loaded via RPC');
    } else {
      if (rpcError) console.warn('RPC fn_get_company_requisitions failed, falling back:', rpcError.message);
      const { data: directData, error: directError } = await supabase
        .from('cmms_requisitions')
        .select(`
          id,
          cmms_company_id,
          requisition_number,
          requisition_date,
          requested_by,
          requested_by_name,
          requested_by_email,
          requested_by_role,
          purpose,
          justification,
          urgency_level,
          required_by_date,
          status,
          total_estimated_cost,
          budget_sufficient,
          dept_head_approved_at,
          dept_head_decision_notes,
          finance_approved_at,
          finance_decision_notes,
          order_placed_date,
          po_number,
          expected_delivery_date,
          actual_delivery_date
        `)
        .eq('cmms_company_id', companyId)
        .order('requisition_date', { ascending: false });

      requisitions = directData;
      error = directError;
    }

    if (error) {
      console.error('Error fetching requisitions:', error);
      console.error('Error details:', { code: error.code, message: error.message });
      return { data: null, error };
    }

    const requisitionRows = requisitions || [];
    const requisitionIds = requisitionRows.map((row) => row.id).filter(Boolean);
    let itemsByRequisition = {};

    if (requisitionIds.length > 0) {
      const { data: lineItems, error: lineItemsError } = await supabase
        .from('cmms_requisition_items')
        .select(`
          id,
          requisition_id,
          inventory_item_id,
          item_code,
          item_name,
          item_description,
          category,
          requested_quantity,
          unit_of_measure,
          unit_price,
          line_total,
          reason_for_requisition,
          status
        `)
        .in('requisition_id', requisitionIds);

      if (lineItemsError) {
        console.warn('Could not fetch requisition line items:', lineItemsError);
      } else {
        itemsByRequisition = (lineItems || []).reduce((acc, row) => {
          if (!acc[row.requisition_id]) acc[row.requisition_id] = [];
          acc[row.requisition_id].push(mapRequisitionLineItem(row));
          return acc;
        }, {});
      }
    }

    const merged = requisitionRows.map((row) => ({
      ...row,
      items: itemsByRequisition[row.id] || []
    }));

    console.log(`Loaded ${merged.length} requisitions`);
    if (merged.length > 0) {
      console.log('Sample requisition:', merged[0]);
    }

    return { data: merged, error: null };
  } catch (error) {
    console.error('Exception fetching requisitions:', error);
    return { data: null, error };
  }
};

/**
 * Create a new maintenance requisition
 * Uses RPC function (SECURITY DEFINER) to bypass RLS, falls back to direct insert
 */
export const createRequisition = async (companyId, departmentId, requisitionData, userId) => {
  try {
    console.log(`Creating requisition for company: ${companyId}`);
    console.log('Department ID:', departmentId);
    console.log('User ID (auth):', userId);
    console.log('Requisition Data:', requisitionData);

    // Resolve cmms_users.id from email (auth.uid != cmms_users.id)
    let cmmsUserId = null;
    const requesterEmail = requisitionData.requesterEmail;
    if (companyId && requesterEmail) {
      try {
        cmmsUserId = await resolveCmmsUserIdByEmail(companyId, requesterEmail);
        console.log('Resolved cmms_users.id:', cmmsUserId);
      } catch (e) {
        console.warn('Could not resolve cmms_users.id by email:', e.message);
      }
    }

    if (!cmmsUserId) {
      console.error('No cmms_users entry found for this email/company. The user must be added to CMMS first.');
      return { data: null, error: { code: 'CMMS_USER_NOT_FOUND', message: 'Your account is not registered as a CMMS user for this company. Ask an admin to add you to the CMMS users list.' } };
    }

    let createdRequisition = null;

    // Try RPC function first (bypasses RLS)
    const { data: rpcResult, error: rpcError } = await supabase.rpc('fn_create_requisition', {
      p_company_id: companyId,
      p_department_id: departmentId,
      p_requested_by: cmmsUserId,
      p_requested_by_name: requisitionData.requesterName || 'Unknown',
      p_requested_by_email: requisitionData.requesterEmail || null,
      p_requested_by_role: requisitionData.requesterRole || null,
      p_purpose: requisitionData.purpose || 'maintenance',
      p_justification: requisitionData.description || null,
      p_urgency_level: requisitionData.priority || 'normal',
      p_required_by_date: requisitionData.requiredByDate || null,
      p_total_estimated_cost: requisitionData.estimatedCost || 0,
      p_budget_sufficient: requisitionData.budgetSufficient !== false
    });

    if (!rpcError && rpcResult) {
      createdRequisition = rpcResult;
      console.log('Requisition created via RPC:', createdRequisition);
    } else {
      // Fallback to direct insert
      if (rpcError) console.warn('RPC fn_create_requisition failed, falling back to direct insert:', rpcError.message);

      const requisitionNumber = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

      const insertData = {
        cmms_company_id: companyId,
        department_id: departmentId,
        requisition_number: requisitionNumber,
        requested_by: cmmsUserId,
        requested_by_name: requisitionData.requesterName || 'Unknown',
        requested_by_email: requisitionData.requesterEmail,
        requested_by_role: requisitionData.requesterRole,
        purpose: requisitionData.purpose || 'maintenance',
        justification: requisitionData.description,
        urgency_level: requisitionData.priority || 'normal',
        required_by_date: requisitionData.requiredByDate,
        total_estimated_cost: requisitionData.estimatedCost || 0,
        status: 'pending_department_head',
        budget_sufficient: requisitionData.budgetSufficient !== false
      };

      const { data, error } = await supabase
        .from('cmms_requisitions')
        .insert(insertData)
        .select();

      if (error) {
        console.error('Error creating requisition:', error);
        return { data: null, error };
      }

      createdRequisition = data?.[0] || null;
    }

    if (createdRequisition && Array.isArray(requisitionData.items) && requisitionData.items.length > 0) {
      const lineItemRows = requisitionData.items
        .map((item) => toRequisitionItemInsertRow(item, createdRequisition.id, departmentId))
        .filter(Boolean);

      if (lineItemRows.length > 0) {
        const { data: lineItemsData, error: lineItemsError } = await supabase
          .from('cmms_requisition_items')
          .insert(lineItemRows)
          .select(`
            id,
            requisition_id,
            inventory_item_id,
            item_code,
            item_name,
            item_description,
            category,
            requested_quantity,
            unit_of_measure,
            unit_price,
            line_total,
            reason_for_requisition,
            status
          `);

        if (lineItemsError) {
          console.warn('Requisition created, but line items were not persisted:', lineItemsError);
        } else {
          createdRequisition.items = (lineItemsData || []).map(mapRequisitionLineItem);
        }
      }
    }

    console.log('Requisition created successfully');
    return { data: createdRequisition, error: null };
  } catch (error) {
    console.error('Exception creating requisition:', error);
    return { data: null, error };
  }
};

/**
 * Update requisition status during approval workflow
 */
export const updateRequisitionStatus = async (requisitionId, newStatus, approverNotes = '', approverRole = 'department_head') => {
  try {
    console.log(`Updating requisition ${requisitionId} to status: ${newStatus}`);

    let updatedRow = null;

    // Try RPC first (bypasses RLS)
    const { data: rpcResult, error: rpcError } = await supabase.rpc('fn_update_requisition_status', {
      p_requisition_id: requisitionId,
      p_status: newStatus,
      p_approver_role: approverRole,
      p_decision_notes: approverNotes || null
    });

    if (!rpcError && rpcResult) {
      updatedRow = rpcResult;
      console.log('Requisition updated via RPC');
    } else {
      if (rpcError) console.warn('RPC fn_update_requisition_status failed, falling back:', rpcError.message);

      const nowIso = new Date().toISOString();
      const updateData = {
        status: newStatus,
        updated_at: nowIso
      };

      if (approverRole === 'department_head') {
        updateData.dept_head_approved_at = nowIso;
        updateData.dept_head_decision_notes = approverNotes || null;
      } else if (approverRole === 'finance') {
        updateData.finance_approved_at = nowIso;
        updateData.finance_decision_notes = approverNotes || null;
      }

      const { data, error } = await supabase
        .from('cmms_requisitions')
        .update(updateData)
        .eq('id', requisitionId)
        .select();

      if (error) {
        console.error('Error updating requisition:', error);
        return { data: null, error };
      }

      updatedRow = data?.[0] || null;
    }

    try {
      const decision = String(newStatus).startsWith('rejected') ? 'rejected' : 'approved';
      const { data: requisitionRow, error: requisitionLookupError } = await supabase
        .from('cmms_requisitions')
        .select('id, cmms_company_id')
        .eq('id', requisitionId)
        .maybeSingle();

      if (!requisitionLookupError && requisitionRow?.cmms_company_id) {
        const { data: authData } = await supabase.auth.getUser();
        const approverEmail = authData?.user?.email || null;
        const approverName = authData?.user?.user_metadata?.full_name || authData?.user?.email || 'Unknown';
        const approverId = await resolveCmmsUserIdByEmail(requisitionRow.cmms_company_id, approverEmail);

        if (approverId) {
          const { error: approvalInsertError } = await supabase
            .from('cmms_requisition_approvals')
            .insert({
              requisition_id: requisitionId,
              approval_level: approverRole,
              approved_by: approverId,
              approved_by_email: approverEmail,
              approved_by_name: approverName,
              approved_by_role: approverRole,
              decision,
              decision_comment: approverNotes || null
            });

          if (approvalInsertError) {
            console.warn('Decision saved but approval history insert failed:', approvalInsertError);
          }
        }
      }
    } catch (approvalHistoryError) {
      console.warn('Decision saved but approval history logging failed:', approvalHistoryError);
    }

    console.log('Requisition updated successfully');
    return { data: updatedRow, error: null };
  } catch (error) {
    console.error('Exception updating requisition:', error);
    return { data: null, error };
  }
};

export default {
  createCompanyProfile,
  getCompanyProfile,
  updateCompanyProfile,
  createAdminUser,
  getCompanyUsers,
  assignUserRole,
  getUserRoles,
  createCmmsDepartment,
  updateCmmsDepartment,
  deleteCmmsDepartment,
  createDepartment,
  getCompanyDepartments,
  getCmmsDepartments,
  getDepartmentStoremen,
  getCompanyStoremen,
  getCompanyWorkOrders,
  getCompanyInventory,
  getInventoryTransactions,
  addInventoryItem,
  updateInventoryItem,
  updateInventoryQuantity,
  deleteInventoryItem,
  getCompanyBudget,
  getCompanyEquipment,
  getMaintenancePlans,
  markCompanyCreator,
  getCompanyRequisitions,
  createRequisition,
  updateRequisitionStatus
};


