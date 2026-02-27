// ============================================================
// CMMS Requisition Confirmations Service
// Handles separation of requisitions from confirmations
// Admin: MUST approve, Coordinator/Supervisor: Optional, Financial Officer: Read-only
// ============================================================

import { supabase } from '../supabaseClient';

/**
 * Create a new requisition with pending confirmations
 * @param {Object} requisitionData - Requisition details
 * @returns {Promise<Object>} - Created requisition with confirmations setup
 */
export const createRequisitionWithConfirmations = async (requisitionData) => {
  try {
    const {
      cmms_company_id,
      department_id,
      requested_by,
      purpose,
      justification,
      urgency_level = 'normal',
      required_by_date,
      total_estimated_cost = 0,
    } = requisitionData;

    // Call Supabase function to create requisition + confirmations
    const { data, error } = await supabase.rpc(
      'create_requisition_with_confirmations',
      {
        p_company_id: cmms_company_id,
        p_department_id: department_id,
        p_requested_by: requested_by,
        p_purpose: purpose,
        p_justification: justification || null,
        p_urgency_level: urgency_level,
        p_required_by_date: required_by_date || null,
        p_total_estimated_cost: total_estimated_cost,
      }
    );

    if (error) {
      console.error('❌ Error creating requisition with confirmations:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      requisition_id: data,
      message: '✅ Requisition created. Awaiting admin approval...',
    };
  } catch (err) {
    console.error('Exception in createRequisitionWithConfirmations:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Get all confirmations for a requisition
 * @param {string} requisitionId - Requisition ID
 * @returns {Promise<Array>} - List of confirmations
 */
export const getRequisitionConfirmations = async (requisitionId) => {
  try {
    const { data, error } = await supabase.rpc(
      'get_requisition_confirmations',
      { p_requisition_id: requisitionId }
    );

    if (error) {
      console.error('❌ Error fetching confirmations:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Exception in getRequisitionConfirmations:', err);
    return [];
  }
};

/**
 * Submit confirmation as Coordinator or Supervisor
 * @param {string} requisitionId - Requisition ID
 * @param {string} userId - User confirming
 * @param {string} confirmationType - 'coordinator_confirmation' or 'supervisor_confirmation'
 * @param {string} status - 'confirmed' or 'rejected'
 * @param {string} notes - Optional notes
 * @returns {Promise<Object>} - Confirmation result
 */
export const submitRequisitionConfirmation = async (
  requisitionId,
  userId,
  confirmationType,
  status,
  notes = null
) => {
  try {
    // Validate confirmation type
    if (
      !['coordinator_confirmation', 'supervisor_confirmation'].includes(
        confirmationType
      )
    ) {
      return {
        success: false,
        error: 'Invalid confirmation type',
      };
    }

    const { data, error } = await supabase.rpc(
      'submit_requisition_confirmation',
      {
        p_requisition_id: requisitionId,
        p_confirmed_by: userId,
        p_confirmation_type: confirmationType,
        p_confirmation_status: status,
        p_notes: notes || null,
      }
    );

    if (error) {
      console.error('❌ Error submitting confirmation:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      ...data,
    };
  } catch (err) {
    console.error('Exception in submitRequisitionConfirmation:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Admin approval of requisition (required)
 * @param {string} requisitionId - Requisition ID
 * @param {string} adminId - Admin user ID
 * @param {string} approvalStatus - 'approved' or 'rejected'
 * @param {string} notes - Optional notes
 * @returns {Promise<Object>} - Approval result
 */
export const approveRequisitionAsAdmin = async (
  requisitionId,
  adminId,
  approvalStatus,
  notes = null
) => {
  try {
    // Validate status
    if (!['approved', 'rejected'].includes(approvalStatus)) {
      return {
        success: false,
        error: 'Invalid approval status. Must be "approved" or "rejected"',
      };
    }

    const { data, error } = await supabase.rpc(
      'approve_requisition_as_admin',
      {
        p_requisition_id: requisitionId,
        p_approved_by: adminId,
        p_approval_status: approvalStatus,
        p_notes: notes || null,
      }
    );

    if (error) {
      console.error('❌ Error approving requisition:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      ...data,
    };
  } catch (err) {
    console.error('Exception in approveRequisitionAsAdmin:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Get requisitions with confirmation summaries
 * @param {string} companyId - Company filtering
 * @param {string} status - Optional status filter
 * @returns {Promise<Array>} - Requisitions with confirmation info
 */
export const getRequisitionsWithConfirmations = async (companyId, status = null) => {
  try {
    let query = supabase
      .from('vw_requisitions_with_confirmations')
      .select(
        `
        id,
        requisition_number,
        status,
        purpose,
        urgency_level,
        total_estimated_cost,
        requisition_date,
        required_by_date,
        admin_approval_status,
        admin_approved_by,
        admin_approved_at,
        coordinator_confirmations_count,
        supervisor_confirmations_count,
        overall_status,
        created_at
      `
      )
      .eq('cmms_company_id', companyId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('overall_status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching requisitions with confirmations:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Exception in getRequisitionsWithConfirmations:', err);
    return [];
  }
};

/**
 * Get requisition approval workflow summary
 * @param {string} requisitionId - Requisition ID
 * @returns {Promise<Object>} - Workflow summary
 */
export const getRequisitionApprovalWorkflow = async (requisitionId) => {
  try {
    // Get requisition with confirmations view
    const { data: requisition, error: reqError } = await supabase
      .from('vw_requisitions_with_confirmations')
      .select(
        `
        id,
        requisition_number,
        status,
        overall_status,
        admin_approval_status,
        admin_approved_by,
        admin_approved_at,
        coordinator_confirmations_count,
        supervisor_confirmations_count
      `
      )
      .eq('id', requisitionId)
      .single();

    if (reqError) {
      return { success: false, error: 'Requisition not found' };
    }

    // Get all confirmations
    const confirmations = await getRequisitionConfirmations(requisitionId);

    // Structure the workflow
    const workflow = {
      requisition_id: requisitionId,
      requisition_number: requisition.requisition_number,
      overall_status: requisition.overall_status,
      workflow_steps: [
        {
          step: 1,
          role: 'Admin',
          type: 'admin_approval',
          required: true,
          status: requisition.admin_approval_status,
          confirmations: confirmations.filter(
            (c) => c.confirmation_type === 'admin_approval'
          ),
          description: 'Admin approval is REQUIRED before proceeding',
        },
        {
          step: 2,
          role: 'Coordinator',
          type: 'coordinator_confirmation',
          required: false,
          count: requisition.coordinator_confirmations_count,
          confirmations: confirmations.filter(
            (c) => c.confirmation_type === 'coordinator_confirmation'
          ),
          description:
            'Optional confirmation from coordinator for verification',
        },
        {
          step: 3,
          role: 'Supervisor',
          type: 'supervisor_confirmation',
          required: false,
          count: requisition.supervisor_confirmations_count,
          confirmations: confirmations.filter(
            (c) => c.confirmation_type === 'supervisor_confirmation'
          ),
          description:
            'Optional confirmation from supervisor for verification',
        },
        {
          step: 4,
          role: 'Financial Officer',
          type: 'financial_review',
          required: false,
          status: 'view_only',
          description: 'Financial officer can view but cannot approve',
        },
      ],
    };

    return {
      success: true,
      workflow,
    };
  } catch (err) {
    console.error('Exception in getRequisitionApprovalWorkflow:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Check if user can perform action on requisition
 * @param {string} userId - User ID
 * @param {string} userRole - User role
 * @param {string} requisitionId - Requisition ID
 * @returns {Promise<Object>} - User permissions
 */
export const checkRequisitionPermissions = async (userId, userRole, requisitionId) => {
  try {
    const requisition = await getRequisitionApprovalWorkflow(requisitionId);

    if (!requisition.success) {
      return { success: false, error: 'Requisition not found' };
    }

    const permissions = {
      canViewRequisition:
        ['admin', 'coordinator', 'supervisor', 'financial_officer'].includes(
          userRole
        ),
      canApproveRequisition: userRole === 'admin',
      canConfirmRequisition:
        userRole === 'coordinator' || userRole === 'supervisor',
      canViewConfirmations:
        ['admin', 'coordinator', 'supervisor', 'financial_officer'].includes(
          userRole
        ),
      userRole,
      userId,
      requisitionId,
    };

    return {
      success: true,
      permissions,
      workflow: requisition.workflow,
    };
  } catch (err) {
    console.error('Exception in checkRequisitionPermissions:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Get pending requisitions for admin approval
 * @param {string} companyId - Company ID
 * @returns {Promise<Array>} - Pending requisitions awaiting admin approval
 */
export const getPendingAdminApprovals = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('vw_requisitions_with_confirmations')
      .select(
        `
        id,
        requisition_number,
        status,
        purpose,
        urgency_level,
        total_estimated_cost,
        requisition_date,
        required_by_date,
        admin_approval_status,
        overall_status
      `
      )
      .eq('cmms_company_id', companyId)
      .eq('overall_status', 'awaiting_admin_approval')
      .eq('admin_approval_status', 'pending')
      .order('requisition_date', { ascending: true });

    if (error) {
      console.error('❌ Error fetching pending approvals:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Exception in getPendingAdminApprovals:', err);
    return [];
  }
};

export default {
  createRequisitionWithConfirmations,
  getRequisitionConfirmations,
  submitRequisitionConfirmation,
  approveRequisitionAsAdmin,
  getRequisitionsWithConfirmations,
  getRequisitionApprovalWorkflow,
  checkRequisitionPermissions,
  getPendingAdminApprovals,
};
