/**
 * CMMS Supabase Service
 * Handles all database operations for Computerized Maintenance Management System
 * Integrates with CMMS_IMPLEMENTATION_DATA_SPECIFIC schema
 */

import { supabase } from '../client';

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
      .single();

    // If profile exists, update it
    if (existingProfile && !checkError) {
      console.log('📝 Company profile already exists, updating it...');
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
        .single();

      if (error) throw error;
      console.log('✅ CMMS Company profile updated:', data);
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
      .single();

    if (error) throw error;

    console.log('✅ CMMS Company profile created:', data);
    return { data, error: null };
  } catch (error) {
    console.error('❌ Error creating CMMS company profile:', error);
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
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('❌ Error fetching company profile:', error);
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
      .from('companies')
      .update({
        company_name: updates.companyName,
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

    console.log('✅ Company profile updated:', data);
    return { data, error: null };
  } catch (error) {
    console.error('❌ Error updating company profile:', error);
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

    const { data, error } = await supabase
      .from('cmms_users')
      .insert({
        cmms_company_id: cmmsCompanyId,
        email: userData.email,
        user_name: userData.name,
        full_name: userData.name,
        phone: userData.phone || '',
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    // Assign Admin role (role_id = 1 for CMMS_Admin)
    await assignUserRole(cmmsCompanyId, data.id, 1);

    console.log('✅ CMMS Admin user created:', data);
    return { data, error: null };
  } catch (error) {
    console.error('❌ Error creating CMMS admin user:', error);
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
    const { data, error } = await supabase
      .from('cmms_users')
      .select('*')
      .eq('cmms_company_id', cmmsCompanyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('❌ Error fetching company users:', error);
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
    console.error('❌ Error assigning role:', error);
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
    console.error('❌ Error fetching user roles:', error);
    return { data: null, error };
  }
};

// ============================================
// DEPARTMENT OPERATIONS
// ============================================

/**
 * Create department
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
    console.error('❌ Error creating department:', error);
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
    console.error('❌ Error fetching departments:', error);
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
    console.error('❌ Error fetching work orders:', error);
    return { data: null, error };
  }
};

// ============================================
// INVENTORY OPERATIONS
// ============================================

/**
 * Get inventory items for company
 * @param {string} companyId - Company UUID
 * @returns {Object} Array of inventory items or error
 */
export const getCompanyInventory = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('item_code', { ascending: true });

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('❌ Error fetching inventory:', error);
    return { data: null, error };
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
    console.error('❌ Error fetching transactions:', error);
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
    console.error('❌ Error fetching budget:', error);
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
    console.error('❌ Error fetching equipment:', error);
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
    console.error('❌ Error fetching maintenance plans:', error);
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
  createDepartment,
  getCompanyDepartments,
  getCompanyWorkOrders,
  getCompanyInventory,
  getInventoryTransactions,
  getCompanyBudget,
  getCompanyEquipment,
  getMaintenancePlans
};
