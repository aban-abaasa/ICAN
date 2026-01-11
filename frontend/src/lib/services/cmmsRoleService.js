/**
 * CMMS Role-Based Permission Service
 * 
 * Handles all role-based permission checking, validation, and logging
 * Mirrors the Business Profile pattern but for role-based access control
 */

import { supabase } from '../lib/supabase/client';

/**
 * Get user's active role profile with complete permission information
 * @param {string} userId - User ID
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} Complete role profile with effective permissions
 */
export const getUserActiveRoleProfile = async (userId, companyId) => {
  try {
    console.log('🔍 Loading active role profile for user:', userId);

    const { data, error } = await supabase
      .from('vw_user_role_profiles')
      .select('*')
      .eq('cmms_user_id', userId)
      .eq('cmms_company_id', companyId)
      .eq('is_primary_profile', true)
      .eq('status', 'active')
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (data) {
      console.log('✅ Active role profile found:', data.role_label);
      return {
        success: true,
        data,
        error: null
      };
    }

    console.log('ℹ️ No active role profile found');
    return {
      success: false,
      data: null,
      error: 'No active role profile'
    };
  } catch (error) {
    console.error('❌ Error getting role profile:', error);
    return {
      success: false,
      data: null,
      error: error.message
    };
  }
};

/**
 * Check if user has specific permission
 * Considers: base role + custom overrides + delegation
 * @param {string} userId - User ID
 * @param {string} permission - Permission name
 * @param {string} companyId - Company ID
 * @returns {Promise<boolean>}
 */
export const userHasPermission = async (userId, permission, companyId) => {
  try {
    const profile = await getUserActiveRoleProfile(userId, companyId);

    if (!profile.success || !profile.data) {
      return false;
    }

    const { effective_permissions, status } = profile.data;

    // Check if profile is active
    if (status !== 'active') {
      console.warn('⚠️ Profile status is not active:', status);
      return false;
    }

    // Check effective permissions (base + custom)
    const hasPermission = effective_permissions?.[permission] || false;

    console.log(`🔐 Permission check: ${permission} = ${hasPermission ? '✓' : '✗'}`);

    return hasPermission;
  } catch (error) {
    console.error('❌ Error checking permission:', error);
    return false;
  }
};

/**
 * Get all permissions for user
 * @param {string} userId - User ID
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} Object with all permissions as key-value pairs
 */
export const getUserPermissions = async (userId, companyId) => {
  try {
    const profile = await getUserActiveRoleProfile(userId, companyId);

    if (!profile.success || !profile.data) {
      return {};
    }

    return profile.data.effective_permissions || {};
  } catch (error) {
    console.error('❌ Error getting user permissions:', error);
    return {};
  }
};

/**
 * Check multiple permissions (all must be true)
 * @param {string} userId - User ID
 * @param {Array<string>} permissions - List of permissions
 * @param {string} companyId - Company ID
 * @returns {Promise<boolean>}
 */
export const userHasAllPermissions = async (userId, permissions, companyId) => {
  try {
    const profile = await getUserActiveRoleProfile(userId, companyId);

    if (!profile.success || !profile.data) {
      return false;
    }

    const { effective_permissions } = profile.data;

    // Check all permissions
    return permissions.every(permission => effective_permissions?.[permission] || false);
  } catch (error) {
    console.error('❌ Error checking permissions:', error);
    return false;
  }
};

/**
 * Check if user can perform action on resource (with delegation support)
 * @param {string} userId - User ID
 * @param {string} permission - Permission name
 * @param {string} resourceType - Type of resource ('inventory', 'work_order', etc.)
 * @param {string} resourceId - ID of resource
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} {allowed: boolean, reason?: string}
 */
export const checkPermissionWithContext = async (userId, permission, resourceType, resourceId, companyId) => {
  try {
    const profile = await getUserActiveRoleProfile(userId, companyId);

    if (!profile.success || !profile.data) {
      return {
        allowed: false,
        reason: 'No active role profile found'
      };
    }

    const { effective_permissions, status, data_access_level, assigned_department_id } = profile.data;

    // Check 1: Profile is active
    if (status !== 'active') {
      return {
        allowed: false,
        reason: `Profile status is ${status}`
      };
    }

    // Check 2: Has required permission
    if (!effective_permissions?.[permission]) {
      return {
        allowed: false,
        reason: `Permission ${permission} denied`
      };
    }

    // Check 3: Data access level
    if (data_access_level === 'own_only' && resourceId) {
      // User can only access own resources
      const isOwn = await checkResourceOwnership(userId, resourceId, resourceType, companyId);
      if (!isOwn) {
        return {
          allowed: false,
          reason: 'Access restricted to own resources only'
        };
      }
    } else if (data_access_level === 'department_only' && assigned_department_id) {
      // User can only access resources in their department
      const inDept = await checkResourceInDepartment(resourceId, assigned_department_id, resourceType);
      if (!inDept) {
        return {
          allowed: false,
          reason: 'Access restricted to own department only'
        };
      }
    }

    // All checks passed
    return {
      allowed: true,
      reason: 'Permission granted'
    };
  } catch (error) {
    console.error('❌ Error checking context permission:', error);
    return {
      allowed: false,
      reason: 'Error checking permission: ' + error.message
    };
  }
};

/**
 * Log permission usage for audit trail
 * @param {string} userId - User ID
 * @param {string} permission - Permission name
 * @param {string} resourceType - Resource type
 * @param {string} resourceId - Resource ID
 * @param {boolean} wasSuccessful - Was action successful
 * @param {string} denialReason - Why denied (if not successful)
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>}
 */
export const logPermissionUsage = async (userId, permission, resourceType, resourceId, wasSuccessful, denialReason, companyId) => {
  try {
    const { data, error } = await supabase
      .from('cmms_role_permission_audit')
      .insert([
        {
          cmms_company_id: companyId,
          cmms_user_id: userId,
          permission_name: permission,
          action: wasSuccessful ? 'used' : 'denied',
          resource_type: resourceType,
          resource_id: resourceId,
          was_successful: wasSuccessful,
          denial_reason: denialReason,
          ip_address: await getUserIpAddress(),
          user_agent: navigator.userAgent
        }
      ])
      .select()
      .single();

    if (error) throw error;

    console.log(`📋 Permission usage logged: ${permission} (${wasSuccessful ? 'allowed' : 'denied'})`);
    return {
      success: true,
      auditId: data.id
    };
  } catch (error) {
    console.error('❌ Error logging permission usage:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Log user activity for comprehensive audit trail
 * @param {string} userId - User ID
 * @param {string} activityType - Type: 'view', 'create', 'update', 'delete', 'export', 'sign', 'approve'
 * @param {string} resourceType - Type of resource
 * @param {string} resourceId - Resource ID
 * @param {string} resourceName - Human-readable resource name
 * @param {Object} oldValue - Previous value (for updates)
 * @param {Object} newValue - New value (for updates/creates)
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>}
 */
export const logActivity = async (userId, activityType, resourceType, resourceId, resourceName, oldValue, newValue, companyId) => {
  try {
    const { data, error } = await supabase
      .from('cmms_role_activity_logs')
      .insert([
        {
          cmms_company_id: companyId,
          cmms_user_id: userId,
          activity_type: activityType,
          activity_description: `${activityType} ${resourceType}: ${resourceName}`,
          resource_type: resourceType,
          resource_id: resourceId,
          resource_name: resourceName,
          old_value: oldValue,
          new_value: newValue,
          status: 'completed',
          ip_address: await getUserIpAddress(),
          session_id: localStorage.getItem('session_id'),
          device_fingerprint: generateDeviceFingerprint()
        }
      ])
      .select()
      .single();

    if (error) throw error;

    console.log(`📝 Activity logged: ${activityType} on ${resourceType}`);
    return {
      success: true,
      activityId: data.id
    };
  } catch (error) {
    console.error('❌ Error logging activity:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get audit trail for user
 * @param {string} userId - User ID
 * @param {string} companyId - Company ID
 * @param {number} days - Number of days to look back
 * @returns {Promise<Array>}
 */
export const getUserAuditTrail = async (userId, companyId, days = 30) => {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase
      .from('cmms_role_activity_logs')
      .select('*')
      .eq('cmms_user_id', userId)
      .eq('cmms_company_id', companyId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log(`📊 Retrieved ${data?.length || 0} audit logs`);
    return {
      success: true,
      data: data || [],
      error: null
    };
  } catch (error) {
    console.error('❌ Error getting audit trail:', error);
    return {
      success: false,
      data: [],
      error: error.message
    };
  }
};

/**
 * Get permission change history
 * @param {string} userId - User ID
 * @param {string} companyId - Company ID
 * @param {number} days - Number of days to look back
 * @returns {Promise<Array>}
 */
export const getPermissionChangeHistory = async (userId, companyId, days = 30) => {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase
      .from('cmms_role_permission_audit')
      .select('*')
      .eq('cmms_user_id', userId)
      .eq('cmms_company_id', companyId)
      .in('action', ['granted', 'revoked', 'denied'])
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log(`📊 Retrieved ${data?.length || 0} permission changes`);
    return {
      success: true,
      data: data || [],
      error: null
    };
  } catch (error) {
    console.error('❌ Error getting permission history:', error);
    return {
      success: false,
      data: [],
      error: error.message
    };
  }
};

/**
 * List all role definitions for company
 * @param {string} companyId - Company ID
 * @returns {Promise<Array>}
 */
export const getRoleDefinitions = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('cmms_role_definitions')
      .select('*')
      .eq('cmms_company_id', companyId)
      .eq('is_active', true)
      .order('role_level', { ascending: false });

    if (error) throw error;

    console.log(`📋 Retrieved ${data?.length || 0} role definitions`);
    return {
      success: true,
      data: data || [],
      error: null
    };
  } catch (error) {
    console.error('❌ Error getting role definitions:', error);
    return {
      success: false,
      data: [],
      error: error.message
    };
  }
};

/**
 * Check if user can delegate permission
 * @param {string} userId - User ID
 * @param {string} companyId - Company ID
 * @returns {Promise<boolean>}
 */
export const canUserDelegate = async (userId, companyId) => {
  try {
    const profile = await getUserActiveRoleProfile(userId, companyId);

    if (!profile.success || !profile.data) {
      return false;
    }

    return profile.data.can_delegate_permissions || false;
  } catch (error) {
    console.error('❌ Error checking delegation capability:', error);
    return false;
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if resource belongs to user
 * @private
 */
const checkResourceOwnership = async (userId, resourceId, resourceType, companyId) => {
  try {
    let tableName = resourceType === 'work_order' ? 'cmms_work_orders' : 'cmms_inventory';
    let userField = resourceType === 'work_order' ? 'assigned_to' : 'created_by';

    const { data, error } = await supabase
      .from(tableName)
      .select(userField)
      .eq('id', resourceId)
      .single();

    if (error) return false;
    return data[userField] === userId;
  } catch (error) {
    console.error('❌ Error checking ownership:', error);
    return false;
  }
};

/**
 * Check if resource is in user's department
 * @private
 */
const checkResourceInDepartment = async (resourceId, departmentId, resourceType) => {
  try {
    const tableName = resourceType === 'work_order' ? 'cmms_work_orders' : 'cmms_inventory';

    const { data, error } = await supabase
      .from(tableName)
      .select('department_id')
      .eq('id', resourceId)
      .single();

    if (error) return false;
    return data.department_id === departmentId;
  } catch (error) {
    console.error('❌ Error checking department:', error);
    return false;
  }
};

/**
 * Get user's IP address
 * @private
 */
const getUserIpAddress = async () => {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip;
  } catch (error) {
    return 'unknown';
  }
};

/**
 * Generate device fingerprint
 * @private
 */
const generateDeviceFingerprint = () => {
  const fingerprint = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screen: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: new Date().toISOString()
  };
  return JSON.stringify(fingerprint);
};

export default {
  getUserActiveRoleProfile,
  userHasPermission,
  getUserPermissions,
  userHasAllPermissions,
  checkPermissionWithContext,
  logPermissionUsage,
  logActivity,
  getUserAuditTrail,
  getPermissionChangeHistory,
  getRoleDefinitions,
  canUserDelegate
};
