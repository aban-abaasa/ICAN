import { supabase } from '../config/supabaseClient';

/**
 * Shareholder Notifications Service
 * Handles all operations related to shareholder and investor approval notifications
 * Supports:
 * - Shareholder approvals (when investors sign)
 * - Investor approvals (when business pitches need investor sign-off)
 * - Generic approval workflows
 */

const shareholderNotificationsService = {
  /**
   * Create a new shareholder notification
   * @param {Object} notification - Notification data
   * @returns {Promise<Object>} Created notification
   */
  async createNotification(notification) {
    try {
      const {
        business_profile_id,
        shareholder_id,
        shareholder_email,
        shareholder_name,
        notification_type = 'approval_request',
        notification_title,
        notification_message,
        investor_name,
        investor_email,
        investment_amount = 0,
        investment_currency = 'USD',
        investment_shares = 0,
        notification_sent_via = 'in_app'
      } = notification;

      const { data, error } = await supabase
        .from('shareholder_notifications')
        .insert([{
          business_profile_id,
          shareholder_id,
          shareholder_email,
          shareholder_name,
          notification_type,
          notification_title,
          notification_message,
          investor_name,
          investor_email,
          investment_amount,
          investment_currency,
          investment_shares,
          notification_sent_via
        }])
        .select();

      if (error) {
        console.error('Error creating notification:', error);
        throw new Error(`Failed to create notification: ${error.message}`);
      }

      return data?.[0];
    } catch (error) {
      console.error('Error in createNotification:', error);
      throw error;
    }
  },

  /**
   * Get pending notifications for a shareholder
   * @param {string} shareholderId - UUID of the shareholder
   * @returns {Promise<Array>} Pending notifications
   */
  async getPendingNotifications(shareholderId) {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .select('*')
        .eq('shareholder_id', shareholderId)
        .is('read_at', null)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching pending notifications:', error);
        throw new Error(`Failed to fetch pending notifications: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Error in getPendingNotifications:', error);
      throw error;
    }
  },

  /**
   * Get all notifications for a shareholder
   * @param {string} shareholderId - UUID of the shareholder
   * @param {Object} options - Query options (limit, offset, etc.)
   * @returns {Promise<Array>} All notifications
   */
  async getNotifications(shareholderId, options = {}) {
    try {
      const { limit = 50, offset = 0 } = options;

      let query = supabase
        .from('shareholder_notifications')
        .select('*')
        .eq('shareholder_id', shareholderId)
        .order('created_at', { ascending: false });

      if (limit) {
        query = query.limit(limit);
      }
      if (offset) {
        query = query.range(offset, offset + limit - 1);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching notifications:', error);
        throw new Error(`Failed to fetch notifications: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Error in getNotifications:', error);
      throw error;
    }
  },

  /**
   * Get notifications for a business profile
   * @param {string} businessProfileId - UUID of the business profile
   * @returns {Promise<Array>} Notifications for the profile
   */
  async getProfileNotifications(businessProfileId) {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .select('*')
        .eq('business_profile_id', businessProfileId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching profile notifications:', error);
        throw new Error(`Failed to fetch profile notifications: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Error in getProfileNotifications:', error);
      throw error;
    }
  },

  /**
   * Get pending notifications count for a shareholder
   * @param {string} shareholderId - UUID of the shareholder
   * @returns {Promise<number>} Count of pending notifications
   */
  async getPendingCount(shareholderId) {
    try {
      const { count, error } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('shareholder_id', shareholderId)
        .is('read_at', null);

      if (error) {
        console.error('Error fetching pending count:', error);
        throw new Error(`Failed to fetch pending count: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      console.error('Error in getPendingCount:', error);
      throw error;
    }
  },

  /**
   * Get pending notifications count for a business profile
   * @param {string} businessProfileId - UUID of the business profile
   * @returns {Promise<number>} Count of pending notifications
   */
  async getProfilePendingCount(businessProfileId) {
    try {
      const { count, error } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('business_profile_id', businessProfileId)
        .is('read_at', null);

      if (error) {
        console.error('Error fetching profile pending count:', error);
        throw new Error(`Failed to fetch profile pending count: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      console.error('Error in getProfilePendingCount:', error);
      throw error;
    }
  },

  /**
   * Mark notification as read
   * @param {string} notificationId - UUID of the notification
   * @returns {Promise<Object>} Updated notification
   */
  async markAsRead(notificationId) {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notificationId)
        .select();

      if (error) {
        console.error('Error marking notification as read:', error);
        throw new Error(`Failed to mark notification as read: ${error.message}`);
      }

      return data?.[0];
    } catch (error) {
      console.error('Error in markAsRead:', error);
      throw error;
    }
  },

  /**
   * Mark multiple notifications as read
   * @param {Array<string>} notificationIds - Array of notification UUIDs
   * @returns {Promise<Array>} Updated notifications
   */
  async markMultipleAsRead(notificationIds) {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .update({ read_at: new Date().toISOString() })
        .in('id', notificationIds)
        .select();

      if (error) {
        console.error('Error marking notifications as read:', error);
        throw new Error(`Failed to mark notifications as read: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Error in markMultipleAsRead:', error);
      throw error;
    }
  },

  /**
   * Delete a notification
   * @param {string} notificationId - UUID of the notification
   * @returns {Promise<void>}
   */
  async deleteNotification(notificationId) {
    try {
      const { error } = await supabase
        .from('shareholder_notifications')
        .delete()
        .eq('id', notificationId);

      if (error) {
        console.error('Error deleting notification:', error);
        throw new Error(`Failed to delete notification: ${error.message}`);
      }
    } catch (error) {
      console.error('Error in deleteNotification:', error);
      throw error;
    }
  },

  /**
   * Delete old notifications (older than specified days)
   * @param {number} daysOld - Delete notifications older than this many days
   * @returns {Promise<number>} Number of deleted notifications
   */
  async deleteOldNotifications(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const { count, error } = await supabase
        .from('shareholder_notifications')
        .delete()
        .lt('created_at', cutoffDate.toISOString());

      if (error) {
        console.error('Error deleting old notifications:', error);
        throw new Error(`Failed to delete old notifications: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      console.error('Error in deleteOldNotifications:', error);
      throw error;
    }
  },

  /**
   * Subscribe to real-time notifications for a shareholder
   * @param {string} shareholderId - UUID of the shareholder
   * @param {Function} callback - Callback function for updates
   * @returns {Object} Subscription object with unsubscribe method
   */
  subscribeToNotifications(shareholderId, callback) {
    try {
      const subscription = supabase
        .channel(`shareholder-notifications-${shareholderId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'shareholder_notifications',
            filter: `shareholder_id=eq.${shareholderId}`
          },
          (payload) => {
            callback(payload);
          }
        )
        .subscribe();

      return {
        unsubscribe: () => {
          subscription.unsubscribe();
        }
      };
    } catch (error) {
      console.error('Error subscribing to notifications:', error);
      throw error;
    }
  },

  /**
   * Create multiple notifications (batch operation)
   * @param {Array<Object>} notifications - Array of notification objects
   * @returns {Promise<Array>} Created notifications
   */
  async createBatchNotifications(notifications) {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .insert(notifications)
        .select();

      if (error) {
        console.error('Error creating batch notifications:', error);
        throw new Error(`Failed to create batch notifications: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Error in createBatchNotifications:', error);
      throw error;
    }
  },

  /**
   * Get notification statistics for a business profile
   * @param {string} businessProfileId - UUID of the business profile
   * @returns {Promise<Object>} Statistics object
   */
  async getProfileStats(businessProfileId) {
    try {
      const { count: totalCount, error: totalError } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('business_profile_id', businessProfileId);

      const { count: pendingCount, error: pendingError } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('business_profile_id', businessProfileId)
        .is('read_at', null);

      const { count: readCount, error: readError } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('business_profile_id', businessProfileId)
        .not('read_at', 'is', null);

      if (totalError || pendingError || readError) {
        throw new Error('Failed to fetch statistics');
      }

      return {
        total: totalCount || 0,
        pending: pendingCount || 0,
        read: readCount || 0
      };
    } catch (error) {
      console.error('Error in getProfileStats:', error);
      throw error;
    }
  },

  // ============================================
  // INVESTOR APPROVAL FUNCTIONS
  // ============================================

  /**
   * Create investor approval notification
   * @param {Object} approval - Approval data
   * @returns {Promise<Object>} Created approval notification
   */
  async createInvestorApproval(approval) {
    try {
      const {
        business_profile_id,
        investor_id,
        investor_email,
        investor_name,
        pitch_title,
        pitch_description,
        requested_amount,
        currency = 'USD',
        approval_reason = 'pitch_review'
      } = approval;

      const { data, error } = await supabase
        .from('shareholder_notifications')
        .insert([{
          business_profile_id,
          shareholder_id: investor_id, // Use investor_id as shareholder_id for flexibility
          shareholder_email: investor_email,
          shareholder_name: investor_name,
          notification_type: 'investor_approval_request',
          notification_title: `Investment Review: ${pitch_title}`,
          notification_message: pitch_description,
          investment_amount: requested_amount,
          investment_currency: currency,
          investor_name: investor_name,
          investor_email: investor_email,
          notification_sent_via: 'in_app'
        }])
        .select();

      if (error) {
        console.error('Error creating investor approval:', error);
        throw new Error(`Failed to create investor approval: ${error.message}`);
      }

      return data?.[0];
    } catch (error) {
      console.error('Error in createInvestorApproval:', error);
      throw error;
    }
  },

  /**
   * Get pending investor approvals
   * @param {string} investorId - UUID of the investor
   * @returns {Promise<Array>} Pending investor approvals
   */
  async getPendingInvestorApprovals(investorId) {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .select('*')
        .eq('shareholder_id', investorId)
        .eq('notification_type', 'investor_approval_request')
        .is('read_at', null)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching investor approvals:', error);
        throw new Error(`Failed to fetch investor approvals: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Error in getPendingInvestorApprovals:', error);
      throw error;
    }
  },

  /**
   * Get pending investor approvals count
   * @param {string} investorId - UUID of the investor
   * @returns {Promise<number>} Count of pending approvals
   */
  async getPendingInvestorApprovalsCount(investorId) {
    try {
      const { count, error } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('shareholder_id', investorId)
        .eq('notification_type', 'investor_approval_request')
        .is('read_at', null);

      if (error) {
        console.error('Error fetching investor approvals count:', error);
        throw new Error(`Failed to fetch investor approvals count: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      console.error('Error in getPendingInvestorApprovalsCount:', error);
      throw error;
    }
  },

  /**
   * Approve investor request
   * @param {string} approvalId - UUID of the approval notification
   * @returns {Promise<Object>} Updated approval
   */
  async approveInvestorRequest(approvalId) {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .update({ 
          read_at: new Date().toISOString(),
          notification_type: 'investor_approved'
        })
        .eq('id', approvalId)
        .select();

      if (error) {
        console.error('Error approving investor request:', error);
        throw new Error(`Failed to approve investor request: ${error.message}`);
      }

      return data?.[0];
    } catch (error) {
      console.error('Error in approveInvestorRequest:', error);
      throw error;
    }
  },

  /**
   * Reject investor request
   * @param {string} approvalId - UUID of the approval notification
   * @param {string} rejectionReason - Reason for rejection
   * @returns {Promise<Object>} Updated approval
   */
  async rejectInvestorRequest(approvalId, rejectionReason = '') {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .update({ 
          read_at: new Date().toISOString(),
          notification_type: 'investor_rejected',
          notification_message: rejectionReason || 'Investor declined this opportunity'
        })
        .eq('id', approvalId)
        .select();

      if (error) {
        console.error('Error rejecting investor request:', error);
        throw new Error(`Failed to reject investor request: ${error.message}`);
      }

      return data?.[0];
    } catch (error) {
      console.error('Error in rejectInvestorRequest:', error);
      throw error;
    }
  },

  /**
   * Get all investor approvals (approved, rejected, pending)
   * @param {string} investorId - UUID of the investor
   * @returns {Promise<Object>} Approval statistics
   */
  async getInvestorApprovalStats(investorId) {
    try {
      const { count: pendingCount } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('shareholder_id', investorId)
        .eq('notification_type', 'investor_approval_request')
        .is('read_at', null);

      const { count: approvedCount } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('shareholder_id', investorId)
        .eq('notification_type', 'investor_approved');

      const { count: rejectedCount } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('shareholder_id', investorId)
        .eq('notification_type', 'investor_rejected');

      return {
        pending: pendingCount || 0,
        approved: approvedCount || 0,
        rejected: rejectedCount || 0
      };
    } catch (error) {
      console.error('Error in getInvestorApprovalStats:', error);
      throw error;
    }
  },

  /**
   * Create approval request for investors (batch)
   * @param {string} businessProfileId - UUID of business profile
   * @param {Array<Object>} investors - Array of investor objects
   * @param {Object} pitchData - Pitch/investment data
   * @returns {Promise<Array>} Created approvals
   */
  async requestInvestorApprovals(businessProfileId, investors, pitchData) {
    try {
      const notifications = investors.map(investor => ({
        business_profile_id: businessProfileId,
        shareholder_id: investor.id,
        shareholder_email: investor.email,
        shareholder_name: investor.name,
        notification_type: 'investor_approval_request',
        notification_title: `Investment Review: ${pitchData.title}`,
        notification_message: pitchData.description,
        investment_amount: pitchData.amount,
        investment_currency: pitchData.currency || 'USD',
        investor_name: investor.name,
        investor_email: investor.email,
        notification_sent_via: 'in_app'
      }));

      const { data, error } = await supabase
        .from('shareholder_notifications')
        .insert(notifications)
        .select();

      if (error) {
        console.error('Error requesting investor approvals:', error);
        throw new Error(`Failed to request investor approvals: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Error in requestInvestorApprovals:', error);
      throw error;
    }
  },

  /**
   * Get received investor approvals for a pitch
   * @param {string} businessProfileId - UUID of business profile
   * @returns {Promise<Array>} All investor approvals
   */
  async getReceivedInvestorApprovals(businessProfileId) {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .select('*')
        .eq('business_profile_id', businessProfileId)
        .in('notification_type', ['investor_approval_request', 'investor_approved', 'investor_rejected'])
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching investor approvals:', error);
        throw new Error(`Failed to fetch investor approvals: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Error in getReceivedInvestorApprovals:', error);
      throw error;
    }
  }
};

export default shareholderNotificationsService;
