// =====================================================
// MEMBER APPROVAL SERVICE
// =====================================================
// Service for managing member approval workflow
// for business profile edits requiring unanimous approval
// =====================================================

import { getSupabase } from './pitchingService';

const supabase = getSupabase();

export const memberApprovalService = {
  /**
   * Propose an edit to the business profile (shareholder roster changes)
   * @param {string} businessProfileId - Business profile ID
   * @param {string} proposedById - User ID proposing the change
   * @param {string} proposedByEmail - User email proposing the change
   * @param {string} proposedByName - User name proposing the change
   * @param {string} editType - Type of edit ('add_member', 'remove_member', 'update_member')
   * @param {object} oldValue - Old values (JSON)
   * @param {object} newValue - New values (JSON)
   * @param {string} description - Description of the change
   * @returns {Promise} Result with pending edit ID
   */
  async proposeEdit(
    businessProfileId,
    proposedById,
    proposedByEmail,
    proposedByName,
    editType,
    oldValue,
    newValue,
    description
  ) {
    try {
      console.log('📝 Proposing edit:', editType, description);

      const { data, error } = await supabase.rpc('propose_member_edit', {
        p_business_profile_id: businessProfileId,
        p_proposed_by_id: proposedById,
        p_proposed_by_email: proposedByEmail,
        p_proposed_by_name: proposedByName,
        p_edit_type: editType,
        p_old_value: oldValue,
        p_new_value: newValue,
        p_description: description
      });

      if (error) {
        console.error('❌ Error proposing edit:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Edit proposed:', data);
      return { success: true, data };
    } catch (error) {
      console.error('Exception in proposeEdit:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Propose an investment approval (when investor buys shares/signs)
   * @param {string} businessProfileId - Business profile ID
   * @param {string} proposedById - User ID (investor) making the investment
   * @param {string} proposedByEmail - Investor email
   * @param {string} proposedByName - Investor name
   * @param {object} investmentDetails - Investment details (amount, shares, currency, etc.)
   * @returns {Promise} Result with pending edit ID
   */
  async proposeInvestmentApproval(
    businessProfileId,
    proposedById,
    proposedByEmail,
    proposedByName,
    investmentDetails
  ) {
    try {
      console.log('💰 Proposing investment approval:', investmentDetails);

      const { data, error } = await supabase.rpc('propose_member_edit', {
        p_business_profile_id: businessProfileId,
        p_proposed_by_id: proposedById,
        p_proposed_by_email: proposedByEmail,
        p_proposed_by_name: proposedByName,
        p_edit_type: 'investment_signed',
        p_old_value: null,
        p_new_value: investmentDetails,
        p_description: `Investment from ${proposedByName}: ${investmentDetails.amount} ${investmentDetails.currency} for ${investmentDetails.share_percentage}% equity`
      });

      if (error) {
        console.error('❌ Error proposing investment:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Investment approval proposed:', data);
      return { success: true, data };
    } catch (error) {
      console.error('Exception in proposeInvestmentApproval:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get all pending edits for a business profile
   * @param {string} businessProfileId - Business profile ID
   * @returns {Promise} Array of pending edits
   */
  async getPendingEdits(businessProfileId) {
    try {
      console.log('🔍 getPendingEdits called with businessProfileId:', businessProfileId);
      
      const { data, error } = await supabase
        .from('pending_edits')
        .select(`
          id,
          business_profile_id,
          proposed_by_id,
          proposed_by_email,
          proposed_by_name,
          edit_type,
          field_name,
          old_value,
          new_value,
          description,
          status,
          approval_received_count,
          approval_required_count,
          created_at,
          expires_at,
          member_approvals(
            id,
            member_id,
            member_email,
            status,
            comment,
            responded_at
          )
        `)
        .eq('business_profile_id', businessProfileId)
        .order('created_at', { ascending: false });

      console.log('📊 getPendingEdits response - error:', error, 'data:', data);

      if (error) {
        console.error('❌ Error fetching pending edits:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getPendingEdits:', error);
      return [];
    }
  },

  /**
   * Get approval records for a pending edit
   * @param {string} pendingEditId - Pending edit ID
   * @returns {Promise} Array of member approvals
   */
  async getPendingEditApprovals(pendingEditId) {
    try {
      const { data, error } = await supabase
        .from('member_approvals')
        .select('*')
        .eq('pending_edit_id', pendingEditId);

      if (error) {
        console.error('❌ Error fetching approvals:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getPendingEditApprovals:', error);
      return [];
    }
  },

  /**
   * Approve a proposed edit
   * @param {string} approvalId - Approval record ID
   * @param {string} memberId - Member ID approving
   * @param {string} comment - Optional comment
   * @returns {Promise} Approval result
   */
  async approveEdit(approvalId, memberId, comment = null) {
    try {
      console.log('✅ Approving edit:', approvalId);

      const { data, error } = await supabase.rpc('respond_to_edit', {
        p_approval_id: approvalId,
        p_member_id: memberId,
        p_response: 'approved',
        p_comment: comment
      });

      if (error) {
        console.error('❌ Error approving edit:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Edit approved:', data);
      return { success: true, data };
    } catch (error) {
      console.error('Exception in approveEdit:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Reject a proposed edit
   * @param {string} approvalId - Approval record ID
   * @param {string} memberId - Member ID rejecting
   * @param {string} comment - Reason for rejection
   * @returns {Promise} Rejection result
   */
  async rejectEdit(approvalId, memberId, comment) {
    try {
      console.log('❌ Rejecting edit:', approvalId);

      const { data, error } = await supabase.rpc('respond_to_edit', {
        p_approval_id: approvalId,
        p_member_id: memberId,
        p_response: 'rejected',
        p_comment: comment
      });

      if (error) {
        console.error('❌ Error rejecting edit:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Edit rejected:', data);
      return { success: true, data };
    } catch (error) {
      console.error('Exception in rejectEdit:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify members of approval request
   * @param {string} businessProfileId - Business profile ID
   * @param {string} pendingEditId - Pending edit ID
   * @param {string} proposedByName - Name of proposer
   * @param {string} editType - Type of edit
   * @param {string} description - Description of change
   * @returns {Promise} Result
   */
  async notifyMembersOfApprovalNeeded(
    businessProfileId,
    pendingEditId,
    proposedByName,
    editType,
    description
  ) {
    try {
      console.log('📢 Notifying members of approval request...');

      const { data, error } = await supabase.rpc(
        'notify_members_approval_needed',
        {
          p_business_profile_id: businessProfileId,
          p_pending_edit_id: pendingEditId,
          p_proposed_by_name: proposedByName,
          p_edit_type: editType,
          p_description: description
        }
      );

      if (error) {
        console.error('❌ Error notifying members:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Members notified:', data?.length || 0);
      return { success: true, data };
    } catch (error) {
      console.error('Exception in notifyMembersOfApprovalNeeded:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Apply an approved edit (once all approvals received)
   * @param {string} pendingEditId - Pending edit ID
   * @returns {Promise} Result
   */
  async applyApprovedEdit(pendingEditId) {
    try {
      console.log('🎯 Applying approved edit:', pendingEditId);

      const { data, error } = await supabase.rpc('apply_approved_edit', {
        p_edit_id: pendingEditId
      });

      if (error) {
        console.error('❌ Error applying edit:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Edit applied:', data);
      return { success: true, data };
    } catch (error) {
      console.error('Exception in applyApprovedEdit:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get approval notifications for a member
   * @param {string} memberId - Member ID
   * @returns {Promise} Array of approval request notifications
   */
  async getApprovalNotifications(memberId) {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .select('*')
        .eq('shareholder_id', memberId)
        .eq('requires_approval', true)
        .is('read_at', null)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Error fetching approval notifications:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getApprovalNotifications:', error);
      return [];
    }
  },

  /**
   * Get approval status for a specific member on a pending edit
   * @param {string} pendingEditId - Pending edit ID
   * @param {string} memberId - Member ID
   * @returns {Promise} Approval record
   */
  async getMemberApprovalStatus(pendingEditId, memberId) {
    try {
      const { data, error } = await supabase
        .from('member_approvals')
        .select('*')
        .eq('pending_edit_id', pendingEditId)
        .eq('member_id', memberId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('❌ Error fetching approval status:', error);
        return null;
      }

      return data || null;
    } catch (error) {
      console.error('Exception in getMemberApprovalStatus:', error);
      return null;
    }
  },

  /**
   * Subscribe to approval status changes
   * @param {string} pendingEditId - Pending edit ID
   * @param {function} onStatusChange - Callback when status changes
   * @returns {function} Unsubscribe function
   */
  subscribeToApprovalUpdates(pendingEditId, onStatusChange) {
    try {
      const subscription = supabase
        .from(`member_approvals:pending_edit_id=eq.${pendingEditId}`)
        .on('UPDATE', (payload) => {
          console.log('✨ Approval status updated:', payload.new);
          onStatusChange(payload.new);
        })
        .subscribe();

      // Return unsubscribe function
      return () => {
        supabase.removeSubscription(subscription);
      };
    } catch (error) {
      console.error('Exception in subscribeToApprovalUpdates:', error);
      return () => {}; // Return no-op function
    }
  }
};

export default memberApprovalService;
