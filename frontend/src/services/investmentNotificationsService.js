/**
 * Investment Notifications Service
 * Handles all notification operations for investment agreements,
 * shareholder signatures, and document reviews
 */

import { getSupabase } from './pitchingService';

// ==============================================
// NOTIFICATION CREATION
// ==============================================

/**
 * Create a new investment notification
 */
export const createInvestmentNotification = async ({
  recipientId,
  senderId = null,
  notificationType,
  title,
  message,
  agreementId = null,
  pitchId = null,
  businessProfileId = null,
  priority = 'normal',
  actionLabel = null,
  actionUrl = null,
  metadata = {}
}) => {
  const supabase = getSupabase();
  if (!supabase) {
    console.warn('Supabase not available - notification not created');
    return { success: false, error: 'Supabase not available' };
  }

  try {
    const { data, error } = await supabase
      .from('investment_notifications')
      .insert([{
        recipient_id: recipientId,
        sender_id: senderId,
        notification_type: notificationType,
        title,
        message,
        agreement_id: agreementId,
        pitch_id: pitchId,
        business_profile_id: businessProfileId,
        priority,
        action_label: actionLabel,
        action_url: actionUrl,
        metadata
      }])
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Notification created:', data);
    return { success: true, data };
  } catch (error) {
    if (error?.message?.includes('row-level security') || error?.code === 'PGRST100') {
      console.warn('⚠️ RLS: Cannot create notification via direct insert.');
      console.warn('   → This is expected - shareholder notifications will be created via backup process');
      return { 
        success: false, 
        error: error.message,
        isRLSError: true,
        gracefulDegradation: 'Notification will be handled during 60% approval process'
      };
    }
    console.error('❌ Error creating notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Notify all shareholders about new signature request
 */
export const notifyShareholdersSignatureRequest = async (agreementId, investorId, pitchTitle, businessName) => {
  const supabase = getSupabase();
  if (!supabase) return { success: false };

  try {
    // Get agreement details
    const { data: agreement, error: agreementError } = await supabase
      .from('investment_agreements')
      .select('*, business_profiles(*)')
      .eq('id', agreementId)
      .single();

    if (agreementError) throw agreementError;

    // Get all business profile members/shareholders
    const { data: shareholders, error: shareholdersError } = await supabase
      .from('business_profile_members')
      .select('user_id, email, name')
      .eq('business_profile_id', agreement.business_profile_id);

    if (shareholdersError) throw shareholdersError;

    // Create notification for each shareholder
    const notifications = shareholders
      .filter(sh => sh.user_id !== investorId) // Don't notify investor
      .map(shareholder => createInvestmentNotification({
        recipientId: shareholder.user_id,
        senderId: investorId,
        notificationType: 'signature_request',
        title: `✍️ Signature Required: ${pitchTitle}`,
        message: `A new investment agreement for "${pitchTitle}" requires your signature. ${agreement.total_investment} ICAN investment pending your approval.`,
        agreementId: agreement.id,
        pitchId: agreement.pitch_id,
        businessProfileId: agreement.business_profile_id,
        priority: 'high',
        actionLabel: 'Review & Sign',
        actionUrl: `/investments/${agreementId}`,
        metadata: {
          investor_name: agreement.investor_name || 'Investor',
          shares_amount: agreement.shares_amount,
          total_investment: agreement.total_investment,
          business_name: businessName
        }
      }));

    await Promise.all(notifications);

    return { success: true, notificationCount: notifications.length };
  } catch (error) {
    console.error('❌ Error notifying shareholders:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Notify investor when agreement is sealed
 */
export const notifyInvestorAgreementSealed = async (agreementId) => {
  const supabase = getSupabase();
  if (!supabase) return { success: false };

  try {
    const { data: agreement } = await supabase
      .from('investment_agreements')
      .select('*, pitches(title), business_profiles(business_name)')
      .eq('id', agreementId)
      .single();

    if (!agreement) return { success: false };

    return await createInvestmentNotification({
      recipientId: agreement.investor_id,
      notificationType: 'agreement_sealed',
      title: '🎉 Investment Agreement Sealed!',
      message: `Your investment in "${agreement.pitches.title}" (${agreement.business_profiles.business_name}) has been sealed with ${agreement.signatures_count || '60%'} shareholder approval. You are now a shareholder!`,
      agreementId: agreement.id,
      pitchId: agreement.pitch_id,
      businessProfileId: agreement.business_profile_id,
      priority: 'high',
      actionLabel: 'View Agreement',
      actionUrl: `/agreements/${agreementId}`,
      metadata: {
        escrow_id: agreement.escrow_id,
        total_investment: agreement.total_investment,
        shares_amount: agreement.shares_amount,
        sealed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Error notifying investor:', error);
    return { success: false, error: error.message };
  }
};

// ==============================================
// NOTIFICATION RETRIEVAL
// ==============================================

/**
 * Get all notifications for a user
 */
export const getUserNotifications = async (userId, { unreadOnly = false, limit = 50 } = {}) => {
  const supabase = getSupabase();
  if (!supabase) return { success: false, data: [] };

  try {
    let query = supabase
      .from('investment_notifications')
      .select('*')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
    return { success: false, data: [], error: error.message };
  }
};

/**
 * Get unread notification count
 */
export const getUnreadNotificationCount = async (userId) => {
  const supabase = getSupabase();
  if (!supabase) return { success: false, count: 0 };

  try {
    const { count, error } = await supabase
      .from('investment_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_id', userId)
      .eq('is_read', false);

    if (error) throw error;

    return { success: true, count: count || 0 };
  } catch (error) {
    console.error('❌ Error fetching unread count:', error);
    return { success: false, count: 0, error: error.message };
  }
};

// ==============================================
// NOTIFICATION UPDATES
// ==============================================

/**
 * Mark notification as read
 */
export const markNotificationAsRead = async (notificationId) => {
  const supabase = getSupabase();
  if (!supabase) return { success: false };

  try {
    const { data, error } = await supabase
      .from('investment_notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('id', notificationId)
      .select()
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Mark all notifications as read for a user
 */
export const markAllNotificationsAsRead = async (userId) => {
  const supabase = getSupabase();
  if (!supabase) return { success: false };

  try {
    const { data, error } = await supabase
      .from('investment_notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('recipient_id', userId)
      .eq('is_read', false)
      .select();

    if (error) throw error;

    return { success: true, count: data?.length || 0 };
  } catch (error) {
    console.error('❌ Error marking all as read:', error);
    return { success: false, error: error.message };
  }
};

// ==============================================
// REAL-TIME SUBSCRIPTIONS
// ==============================================

/**
 * Subscribe to new notifications for a user
 */
export const subscribeToUserNotifications = (userId, callback) => {
  const supabase = getSupabase();
  if (!supabase) {
    console.warn('Supabase not available - cannot subscribe to notifications');
    return () => {};
  }

  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'investment_notifications',
        filter: `recipient_id=eq.${userId}`
      },
      (payload) => {
        console.log('📬 New notification received:', payload.new);
        callback(payload.new);
      }
    )
    .subscribe();

  return () => {
    console.log('Unsubscribing from notifications');
    supabase.removeChannel(channel);
  };
};

// ==============================================
// NOTIFICATION HELPERS
// ==============================================

/**
 * Get notification icon based on type
 */
export const getNotificationIcon = (type) => {
  const icons = {
    new_investment: '💰',
    signature_request: '✍️',
    signature_completed: '✅',
    agreement_sealed: '🎉',
    document_review: '📄',
    escrow_released: '🔓',
    shareholder_added: '👥'
  };
  return icons[type] || '🔔';
};

/**
 * Get notification color based on priority
 */
export const getNotificationColor = (priority) => {
  const colors = {
    low: 'text-gray-400 bg-gray-500/10 border-gray-500/30',
    normal: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
    high: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
    urgent: 'text-red-400 bg-red-500/10 border-red-500/30'
  };
  return colors[priority] || colors.normal;
};

/**
 * Format time ago
 */
export const formatTimeAgo = (timestamp) => {
  const now = new Date();
  const then = new Date(timestamp);
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return then.toLocaleDateString();
};

export default {
  createInvestmentNotification,
  notifyShareholdersSignatureRequest,
  notifyInvestorAgreementSealed,
  getUserNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  subscribeToUserNotifications,
  getNotificationIcon,
  getNotificationColor,
  formatTimeAgo
};
