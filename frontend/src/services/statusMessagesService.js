/**
 * Status Messages Service
 * Handles sending and receiving messages on status posts
 */

import { supabase } from '../lib/supabase';

/**
 * Send a message reply to a status
 * @param {string} statusId - Status ID to reply to
 * @param {string} senderId - User ID sending the message
 * @param {string} messageText - Message content
 * @returns {Promise<{message: Object, error: Object|null}>}
 */
export const sendStatusMessage = async (statusId, senderId, messageText) => {
  try {
    if (!messageText?.trim()) {
      throw new Error('Message cannot be empty');
    }

    const { data, error } = await supabase
      .from('ican_status_messages')
      .insert([{
        status_id: statusId,
        sender_id: senderId,
        message_text: messageText.trim(),
        created_at: new Date().toISOString()
      }])
      .select('*')
      .single();

    if (error) throw error;

    return { message: data, error: null };
  } catch (error) {
    console.error('Send status message error:', error);
    return { message: null, error };
  }
};

/**
 * Get all messages for a status
 * @param {string} statusId - Status ID
 * @returns {Promise<{messages: Array, error: Object|null}>}
 */
export const getStatusMessages = async (statusId) => {
  try {
    const { data, error } = await supabase
      .from('ican_status_messages')
      .select('*')
      .eq('status_id', statusId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return { messages: data || [], error: null };
  } catch (error) {
    console.error('Get status messages error:', error);
    return { messages: [], error };
  }
};

/**
 * Delete a message
 * @param {string} messageId - Message ID
 * @param {string} userId - User ID (to verify ownership)
 * @returns {Promise<{success: boolean, error: Object|null}>}
 */
export const deleteStatusMessage = async (messageId, userId) => {
  try {
    // First verify ownership
    const { data: message, error: fetchError } = await supabase
      .from('ican_status_messages')
      .select('sender_id')
      .eq('id', messageId)
      .single();

    if (fetchError) throw fetchError;
    if (message.sender_id !== userId) {
      throw new Error('You can only delete your own messages');
    }

    // Delete the message
    const { error: deleteError } = await supabase
      .from('ican_status_messages')
      .delete()
      .eq('id', messageId);

    if (deleteError) throw deleteError;

    return { success: true, error: null };
  } catch (error) {
    console.error('Delete status message error:', error);
    return { success: false, error };
  }
};

/**
 * Subscribe to new messages for a status (realtime)
 * @param {string} statusId - Status ID
 * @param {Function} callback - Callback when new message arrives
 * @returns {Function} Unsubscribe function
 */
export const subscribeToStatusMessages = (statusId, callback) => {
  try {
    const subscription = supabase
      .channel(`status-messages:${statusId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ican_status_messages',
          filter: `status_id=eq.${statusId}`
        },
        (payload) => {
          callback(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  } catch (error) {
    console.error('Subscribe to status messages error:', error);
    return () => {};
  }
};
