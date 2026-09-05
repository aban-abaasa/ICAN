/**
 * Portfolio Direct Chat — 1:1 messaging between a resume/portfolio owner and
 * a visitor to their public /portfolio/<handle> page (see
 * backend/db/CREATE_PORTFOLIO_DIRECT_MESSAGES.sql).
 *
 * Visitor-side calls (signed-in or anonymous guest) always go through the
 * SECURITY DEFINER RPCs — an anonymous guest_id can't be authenticated by
 * RLS the way auth.uid() authenticates a real session, so every write goes
 * through send_portfolio_message()/start_portfolio_conversation() for one
 * consistent, server-validated path. Owner-side dashboard inbox functions
 * use direct table access + Realtime, since the owner is always an
 * authenticated participant and RLS already scopes what they can see.
 */

import { supabase } from '../lib/supabase/client';
import { getBackendUrl } from '../lib/backendUrl';
import { toR2Value, resolveMediaValue } from './r2StorageService';

const CHAT_ATTACHMENT_MAX_MB = 15;

// ─── Attachments ────────────────────────────────────────────────────────

/**
 * Upload a chat attachment (image or file). Uses the authenticated presign
 * route when a session exists — namespaced by the real user id, so it's
 * later deletable like any other authenticated upload — otherwise falls
 * back to the anonymous, rate-limited, image/PDF-only guest route.
 */
export async function uploadChatAttachment(file) {
  if (!file) throw new Error('No file selected');
  if (file.size > CHAT_ATTACHMENT_MAX_MB * 1024 * 1024) {
    throw new Error(`File exceeds ${CHAT_ATTACHMENT_MAX_MB}MB limit`);
  }

  const { data: { session } } = await supabase.auth.getSession();
  const backendUrl = getBackendUrl();
  const contentType = file.type || 'application/octet-stream';
  const filename = file.name || `attachment-${Date.now()}`;

  const presignRes = session?.access_token
    ? await fetch(`${backendUrl}/api/storage/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ folder: 'portfolio-chat', filename, contentType }),
      })
    : await fetch(`${backendUrl}/api/storage/presign-upload-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, contentType }),
      });

  const presignData = await presignRes.json().catch(() => null);
  if (!presignRes.ok || !presignData?.success) {
    throw new Error(presignData?.error || 'Could not prepare upload');
  }

  const putRes = await fetch(presignData.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!putRes.ok) throw new Error('Upload failed — please try again');

  return {
    url: toR2Value(presignData.key),
    type: contentType.startsWith('image/') ? 'image' : 'file',
    name: filename,
  };
}

/** Resolve a message's stored r2:// attachment key to a live, fetchable URL. */
export const resolveAttachmentUrl = resolveMediaValue;

// ─── Visitor side (public page — guest or signed-in) ───────────────────────

export async function startConversation(ownerUserId, { guestId, guestName } = {}) {
  const { data, error } = await supabase.rpc('start_portfolio_conversation', {
    p_owner_user_id: ownerUserId,
    p_guest_id: guestId || null,
    p_guest_name: guestName || null,
  });
  if (error) throw error;
  return data;
}

export async function getConversationMessages(conversationId, { guestId } = {}) {
  const { data, error } = await supabase.rpc('get_portfolio_conversation_messages', {
    p_conversation_id: conversationId,
    p_guest_id: guestId || null,
  });
  if (error) throw error;
  return data || [];
}

export async function sendMessage(conversationId, { body, attachment, guestId, guestName } = {}) {
  const { data, error } = await supabase.rpc('send_portfolio_message', {
    p_conversation_id: conversationId,
    p_body: body || null,
    p_attachment_url: attachment?.url || null,
    p_attachment_type: attachment?.type || null,
    p_attachment_name: attachment?.name || null,
    p_guest_id: guestId || null,
    p_guest_name: guestName || null,
  });
  if (error) throw error;
  return data;
}

// ─── Owner side (dashboard "Messages" inbox — always authenticated) ───────

export async function listMyConversations() {
  const { data, error } = await supabase
    .from('portfolio_conversations')
    .select('*')
    .order('last_message_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getConversationMessagesDirect(conversationId) {
  const { data, error } = await supabase
    .from('portfolio_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function sendOwnerMessage(conversationId, { body, attachment } = {}) {
  return sendMessage(conversationId, { body, attachment });
}

export async function markConversationRead(conversationId) {
  const { error } = await supabase.rpc('mark_portfolio_conversation_read', { p_conversation_id: conversationId });
  if (error) throw error;
}

export function subscribeToConversationMessages(conversationId, onInsert) {
  const channel = supabase
    .channel(`portfolio_messages_${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'portfolio_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function subscribeToMyConversations(onChange) {
  const channel = supabase
    .channel('portfolio_conversations_mine')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'portfolio_conversations' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
