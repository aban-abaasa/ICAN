import { getSupabaseClient } from '../lib/supabase/client';

const supabase = getSupabaseClient();

const GUEST_KEY = 'chat_guest_identity_v1';
const CONV_PREFIX = 'chat_conversation_id_v1_';

export const getGuestIdentity = () => {
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
  } catch {
    return null;
  }
};

export const setGuestIdentity = (identity) => {
  localStorage.setItem(GUEST_KEY, JSON.stringify(identity));
};

export const getStoredConversationId = (scopeKey) =>
  localStorage.getItem(CONV_PREFIX + scopeKey);

export const storeConversationId = (scopeKey, conversationId) => {
  localStorage.setItem(CONV_PREFIX + scopeKey, conversationId);
};

export const clearStoredConversationId = (scopeKey) => {
  localStorage.removeItem(CONV_PREFIX + scopeKey);
};

export const createConversation = async ({ name, email, userId, role, portal, subject }) => {
  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({
      guest_name: name || null,
      guest_email: email || null,
      user_id: userId || null,
      role: role || 'guest',
      portal: portal || 'landing',
      origin_app: 'ican',
      subject: subject || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const fetchConversation = async (conversationId) => {
  const { data } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();
  return data;
};

export const fetchMessages = async (conversationId) => {
  const { data } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return data || [];
};

export const sendMessage = async (conversationId, { senderRole, senderName, body }) => {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      conversation_id: conversationId,
      sender_role: senderRole,
      sender_name: senderName || null,
      body,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const markConversationRead = async (conversationId, side) => {
  const field = side === 'dev' ? 'unread_by_dev' : 'unread_by_user';
  await supabase.from('chat_conversations').update({ [field]: false }).eq('id', conversationId);
};

export const closeConversation = async (conversationId) => {
  await supabase.from('chat_conversations').update({ status: 'closed' }).eq('id', conversationId);
};

// ICAN's Dev Panel inbox only shows its own app's support threads —
// origin_app scoping keeps it from wading through every other app's
// conversations too (each app has its own inbox).
export const listConversations = async ({ kind = 'support' } = {}) => {
  let query = supabase
    .from('chat_conversations')
    .select('*')
    .eq('origin_app', 'ican')
    .order('last_message_at', { ascending: false });
  if (kind) query = query.eq('kind', kind);
  const { data } = await query;
  return data || [];
};

export const subscribeToMessages = (conversationId, onInsert) => {
  const channel = supabase
    .channel(`chat_messages_${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
};

export const subscribeToConversation = (conversationId, onUpdate) => {
  const channel = supabase
    .channel(`chat_conversation_${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'chat_conversations', filter: `id=eq.${conversationId}` },
      (payload) => onUpdate(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
};

export const subscribeToAllConversations = (onChange) => {
  const channel = supabase
    .channel('chat_conversations_all_ican')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations', filter: 'origin_app=eq.ican' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
};

// The hidden dev-panel login (token intercept in SignIn.jsx) sets this flag
// before ever creating a real Supabase session for the dev — it's the one
// reliable signal that "this session is the developer".
export const isDeveloperSession = () => {
  try {
    return sessionStorage.getItem('ican_dev_panel_auth') === 'true';
  } catch {
    return false;
  }
};

// Resolve who's chatting: real signed-in user (via profiles table) or null for guest.
export const resolveChatIdentity = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) return null;

    return {
      userId: profile.id,
      authId: user.id,
      name: profile.full_name || profile.email || 'User',
      email: profile.email || user.email || '',
      role: 'user',
    };
  } catch {
    return null;
  }
};
