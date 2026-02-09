// =====================================================
// SHAREHOLDER NOTIFICATION SERVICE
// =====================================================
// Service for managing shareholder notifications
// Handles sending notifications to shareholders when:
// - Investors buy shares
// - Someone becomes a partner
// - Support contributions are received
// =====================================================

import { getSupabase } from './pitchingService';

const supabase = getSupabase();

export const shareholderNotificationService = {
  /**
   * Send notification when investor buys shares
   * @param {string} businessProfileId - Business profile ID
   * @param {string} investorId - Investor user ID
   * @param {string} investorName - Investor name
   * @param {string} investorEmail - Investor email
   * @param {number} investmentAmount - Amount invested
   * @param {string} investmentCurrency - Currency code (UGX, KES, USD, etc)
   * @param {number} investmentShares - Number of shares purchased
   * @returns {Promise} Notification result
   */
  async notifySharePurchase(
    businessProfileId,
    investorId,
    investorName,
    investorEmail,
    investmentAmount,
    investmentCurrency,
    investmentShares
  ) {
    try {
      console.log('📢 Notifying shareholders about share purchase...');
      
      const { data, error } = await supabase.rpc(
        'notify_shareholders_on_share_purchase',
        {
          p_business_profile_id: businessProfileId,
          p_investor_id: investorId,
          p_investor_name: investorName,
          p_investor_email: investorEmail,
          p_investment_amount: parseFloat(investmentAmount),
          p_investment_currency: investmentCurrency,
          p_investment_shares: parseFloat(investmentShares)
        }
      );

      if (error) {
        console.error('❌ Error sending share purchase notifications:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Share purchase notifications sent to', data?.length || 0, 'shareholders');
      return { success: true, data, notificationsCount: data?.length || 0 };
    } catch (error) {
      console.error('Exception in notifySharePurchase:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send notification when someone becomes a partner
   * @param {string} businessProfileId - Business profile ID
   * @param {string} partnerId - Partner user ID
   * @param {string} partnerName - Partner name
   * @param {string} partnerEmail - Partner email
   * @param {number} equityStake - Equity percentage
   * @param {string} announcementText - Optional additional details
   * @returns {Promise} Notification result
   */
  async notifyPartnerInvestment(
    businessProfileId,
    partnerId,
    partnerName,
    partnerEmail,
    equityStake,
    announcementText = null
  ) {
    try {
      console.log('📢 Notifying shareholders about new partner...');
      
      const { data, error } = await supabase.rpc(
        'notify_shareholders_on_partner_investment',
        {
          p_business_profile_id: businessProfileId,
          p_partner_id: partnerId,
          p_partner_name: partnerName,
          p_partner_email: partnerEmail,
          p_equity_stake: parseFloat(equityStake),
          p_announcement_text: announcementText
        }
      );

      if (error) {
        console.error('❌ Error sending partner notifications:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Partner notifications sent to', data?.length || 0, 'shareholders');
      return { success: true, data, notificationsCount: data?.length || 0 };
    } catch (error) {
      console.error('Exception in notifyPartnerInvestment:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send notification for support contribution
   * @param {string} businessProfileId - Business profile ID
   * @param {string} supporterId - Supporter user ID
   * @param {string} supporterName - Supporter name
   * @param {string} supporterEmail - Supporter email
   * @param {number} supportAmount - Support amount
   * @param {string} supportCurrency - Currency code (default: UGX)
   * @returns {Promise} Notification result
   */
  async notifySupport(
    businessProfileId,
    supporterId,
    supporterName,
    supporterEmail,
    supportAmount,
    supportCurrency = 'UGX'
  ) {
    try {
      console.log('📢 Notifying shareholders about support contribution...');
      
      const { data, error } = await supabase.rpc(
        'notify_shareholders_on_support',
        {
          p_business_profile_id: businessProfileId,
          p_supporter_id: supporterId,
          p_supporter_name: supporterName,
          p_supporter_email: supporterEmail,
          p_support_amount: parseFloat(supportAmount),
          p_support_currency: supportCurrency
        }
      );

      if (error) {
        console.error('❌ Error sending support notifications:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Support notifications sent to', data?.length || 0, 'shareholders');
      return { success: true, data, notificationsCount: data?.length || 0 };
    } catch (error) {
      console.error('Exception in notifySupport:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get all notifications for a shareholder
   * @param {string} shareholderId - Shareholder user ID
   * @returns {Promise} Array of notifications
   */
  async getShareholderNotifications(shareholderId) {
    try {
      const { data, error } = await supabase.rpc(
        'get_shareholder_notifications',
        {
          p_shareholder_id: shareholderId
        }
      );

      if (error) {
        console.error('❌ Error fetching notifications:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getShareholderNotifications:', error);
      return [];
    }
  },

  /**
   * Get unread notification count for shareholder
   * @param {string} shareholderId - Shareholder user ID
   * @returns {Promise} Count of unread notifications
   */
  async getUnreadCount(shareholderId) {
    try {
      const { count, error } = await supabase
        .from('shareholder_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('shareholder_id', shareholderId)
        .is('read_at', null);

      if (error) {
        console.error('❌ Error getting unread count:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Exception in getUnreadCount:', error);
      return 0;
    }
  },

  /**
   * Mark notification as read
   * @param {string} notificationId - Notification ID
   * @returns {Promise} Update result
   */
  async markAsRead(notificationId) {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notificationId)
        .select();

      if (error) {
        console.error('❌ Error marking notification as read:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Exception in markAsRead:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Subscribe to real-time notifications for a shareholder
   * @param {string} shareholderId - Shareholder user ID
   * @param {function} onNotification - Callback when new notification arrives
   * @returns {function} Unsubscribe function
   */
  subscribeToNotifications(shareholderId, onNotification) {
    try {
      const subscription = supabase
        .from(`shareholder_notifications:shareholder_id=eq.${shareholderId}`)
        .on('INSERT', (payload) => {
          console.log('✨ New notification received:', payload.new);
          onNotification(payload.new);
        })
        .subscribe();

      // Return unsubscribe function
      return () => {
        supabase.removeSubscription(subscription);
      };
    } catch (error) {
      console.error('Exception in subscribeToNotifications:', error);
      return () => {}; // Return no-op function
    }
  },

  /**
   * Get notifications for a business (for business owner view)
   * @param {string} businessProfileId - Business profile ID
   * @param {number} limit - Number of notifications to fetch (default: 50)
   * @returns {Promise} Array of notifications
   */
  async getBusinessNotifications(businessProfileId, limit = 50) {
    try {
      const { data, error } = await supabase
        .from('shareholder_notifications')
        .select('*')
        .eq('business_profile_id', businessProfileId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('❌ Error fetching business notifications:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception in getBusinessNotifications:', error);
      return [];
    }
  },

  /**
   * Get notification statistics for a business
   * @param {string} businessProfileId - Business profile ID
   * @returns {Promise} Statistics object
   */
  async getNotificationStats(businessProfileId) {
    try {
      // Get total notifications
      const { count: totalCount } = await supabase
        .from('shareholder_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('business_profile_id', businessProfileId);

      // Get read vs unread
      const { count: readCount } = await supabase
        .from('shareholder_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('business_profile_id', businessProfileId)
        .not('read_at', 'is', null);

      // Get by notification type
      const { data: byType } = await supabase
        .from('shareholder_notifications')
        .select('notification_type')
        .eq('business_profile_id', businessProfileId);

      const typeStats = {};
      byType?.forEach(item => {
        typeStats[item.notification_type] = (typeStats[item.notification_type] || 0) + 1;
      });

      return {
        total: totalCount || 0,
        read: readCount || 0,
        unread: (totalCount || 0) - (readCount || 0),
        byType: typeStats
      };
    } catch (error) {
      console.error('Exception in getNotificationStats:', error);
      return { total: 0, read: 0, unread: 0, byType: {} };
    }
  },

  /**
   * Delete a notification
   * @param {string} notificationId - Notification ID
   * @returns {Promise} Delete result
   */
  async deleteNotification(notificationId) {
    try {
      const { error } = await supabase
        .from('shareholder_notifications')
        .delete()
        .eq('id', notificationId);

      if (error) {
        console.error('❌ Error deleting notification:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Exception in deleteNotification:', error);
      return { success: false, error: error.message };
    }
  }
};

export default shareholderNotificationService;
