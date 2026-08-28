/**
 * Status Messages Service
 * Handles sending and receiving messages on status posts
 */

import { supabase } from '../lib/supabase';
import { resolveMediaValues } from './r2StorageService';

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

    const {
      data: { user: authUser },
      error: authError
    } = await supabase.auth.getUser();

    if (authError || !authUser) {
      throw new Error('You must be signed in to comment');
    }

    const actualSenderId = senderId || authUser.id;
    if (actualSenderId !== authUser.id) {
      throw new Error('Invalid sender for this session');
    }

    // Ensure target status exists and is still active before allowing comments.
    const { data: targetStatus, error: statusError } = await supabase
      .from('ican_statuses')
      .select('id, expires_at')
      .eq('id', statusId)
      .single();

    if (statusError || !targetStatus) {
      throw new Error('Status not found');
    }

    if (new Date(targetStatus.expires_at).getTime() <= Date.now()) {
      throw new Error('Cannot comment on expired status');
    }

    const { data, error } = await supabase
      .from('ican_status_messages')
      .insert([{
        status_id: statusId,
        sender_id: actualSenderId,
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
      .select('id, status_id, sender_id, message_text, created_at, updated_at')
      .eq('status_id', statusId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const enriched = await enrichMessagesWithSenderProfiles(data || []);
    return { messages: enriched, error: null };
  } catch (error) {
    console.error('Get status messages error:', error);
    return { messages: [], error };
  }
};

/**
 * Attach each message's real sender profile photo/name (sender_avatar_url,
 * sender_full_name) -- ican_status_messages only stores sender_id, so this is
 * a separate batched `profiles` lookup, same pattern as statusService's
 * enrichStatusesWithPosterProfiles.
 */
const enrichMessagesWithSenderProfiles = async (messages) => {
  if (!messages || messages.length === 0) return messages;
  try {
    const senderIds = [...new Set(messages.map(m => m.sender_id).filter(Boolean))];
    if (senderIds.length === 0) return messages;

    // profiles RLS is "auth.uid() = id", so a plain select would only ever
    // return the CALLER's own row -- other senders' photos would never show.
    // fn_get_public_profile_info is SECURITY DEFINER and returns only
    // id/full_name/avatar_url (backend/PITCHIN_PUBLIC_PROFILE_INFO_RPC.sql).
    const { data: profiles, error } = await supabase
      .rpc('fn_get_public_profile_info', { p_user_ids: senderIds });
    if (error) throw error;
    // avatar_url can be an r2:// key that needs a live presigned URL.
    const resolvedProfiles = await resolveMediaValues(profiles || [], ['avatar_url']);

    const profileById = new Map(resolvedProfiles.map(p => [p.id, p]));
    return messages.map(message => {
      const sender = profileById.get(message.sender_id);
      return sender
        ? { ...message, sender_full_name: sender.full_name || null, sender_avatar_url: sender.avatar_url || null }
        : message;
    });
  } catch (err) {
    console.warn('Could not enrich status messages with sender profiles:', err?.message);
    return messages;
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
          // Realtime INSERT payloads carry only the raw row -- enrich with the
          // sender's real photo/name before handing it to the UI, same as the
          // initial getStatusMessages load.
          enrichMessagesWithSenderProfiles([payload.new])
            .then(([enriched]) => callback(enriched || payload.new))
            .catch(() => callback(payload.new));
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
