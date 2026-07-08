/**
 * 💬 LANDING MESSAGES SERVICE
 * Community message board shared across all 4 icaneracoin apps
 * (ICAN, digital-city-era, mybodaguy, FARM-AGENT) via public.landing_messages.
 */

import { getSupabaseClient } from '../lib/supabase/client';

const supabase = getSupabaseClient();

export const ORIGIN_APP = 'ican';

// authId = auth.uid(), obtained via supabase.auth.getUser() -> data.user.id.
// NOT any local profiles.id — landing_messages.user_id references auth.users(id) directly.
export const createLandingMessage = async ({ name, email, company, message, authId, isPublic }) => {
  const { data, error } = await supabase.from('landing_messages').insert({
    name: name || null,
    email: email || null,
    company: company || null,
    message,
    user_id: authId || null,
    origin_app: ORIGIN_APP,
    is_public: authId ? !!isPublic : true,
    sender_role: authId ? 'user' : 'guest',
  }).select().single();
  if (error) throw error;
  return data;
};

export const replyToLandingMessage = async ({ parentId, name, email, authId, message }) => {
  const { data, error } = await supabase.from('landing_messages').insert({
    parent_id: parentId,
    name: name || null,
    email: email || null,
    message,
    user_id: authId || null,
    origin_app: ORIGIN_APP,
    is_public: true,
    sender_role: authId ? 'user' : 'guest',
  }).select().single();
  if (error) throw error;
  return data;
};

export const listMyLandingMessages = async (authId) => {
  if (!authId) return [];
  const { data, error } = await supabase
    .from('landing_messages')
    .select('*')
    .eq('user_id', authId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

export const hasIcanWallet = async (authId) => {
  if (!authId) return false;
  const { data, error } = await supabase
    .from('ican_user_wallets')
    .select('user_id')
    .eq('user_id', authId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return !!data;
};

// Balances are only ever safe to show to their owner — ican_user_wallets
// RLS currently lets any authenticated user in any app read any wallet
// (pre-existing, shared by every wallet feature, not something this file
// changes), so the privacy guarantee here is enforced by convention at the
// call site: only ever call this with the CURRENT viewer's own authId,
// never for another poster's id.
export const getMyIcanBalance = async (authId) => {
  if (!authId) return null;
  const { data, error } = await supabase
    .from('ican_user_wallets')
    .select('ican_balance')
    .eq('user_id', authId)
    .maybeSingle();
  if (error) throw error;
  return data?.ican_balance ?? 0;
};

// A stable per-browser identifier for guest likes — separate from the
// name/email guest identity used for posting/replying, since liking needs
// no name at all, just something to dedupe against (matches the DB's
// one-like-per-guest_key-per-message unique constraint).
const GUEST_LIKE_KEY = 'landing_guest_like_key';
export const getOrCreateGuestLikeKey = () => {
  let key = localStorage.getItem(GUEST_LIKE_KEY);
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem(GUEST_LIKE_KEY, key);
  }
  return key;
};

// Guests like with guestKey, logged-in visitors like with authId — never
// both. 23505 (unique violation) means "already liked this", a harmless
// no-op rather than an error the caller needs to handle.
export const likeMessage = async ({ messageId, authId, guestKey }) => {
  const { error } = await supabase.from('landing_message_reactions').insert({
    message_id: messageId,
    user_id: authId || null,
    guest_key: authId ? null : (guestKey || null),
  });
  if (error && error.code !== '23505') throw error;
};

// Groups flat public rows into top-level messages with nested `replies`.
// Also attaches `likeCount`/`likedByMe` per message so cards can render
// the like button state.
export const fetchPublicThreads = async (limit = 50, viewer = {}) => {
  const { authId, guestKey } = viewer;

  const { data, error } = await supabase
    .from('landing_messages')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;

  const rows = data || [];
  const ids = rows.map((r) => r.id);

  let reactionsByMessage = {};
  if (ids.length) {
    const { data: reactions, error: reactionsError } = await supabase
      .from('landing_message_reactions')
      .select('message_id, user_id, guest_key')
      .in('message_id', ids);
    if (reactionsError) throw reactionsError;
    reactionsByMessage = (reactions || []).reduce((acc, r) => {
      (acc[r.message_id] ||= []).push(r);
      return acc;
    }, {});
  }

  const withLikes = (m) => {
    const rs = reactionsByMessage[m.id] || [];
    return {
      ...m,
      likeCount: rs.length,
      likedByMe: rs.some((r) => (authId ? r.user_id === authId : guestKey && r.guest_key === guestKey)),
    };
  };

  const topLevel = rows.filter((r) => !r.parent_id);
  const repliesByParent = rows.reduce((acc, r) => {
    if (!r.parent_id) return acc;
    (acc[r.parent_id] ||= []).push(r);
    return acc;
  }, {});
  return topLevel
    .map((m) => ({ ...withLikes(m), replies: (repliesByParent[m.id] || []).map(withLikes) }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
};

export const subscribeToPublicLandingMessages = (onInsert) => {
  // Unique name per subscription — supabase.channel() returns the SAME
  // already-subscribed channel instance for a repeated fixed name (e.g. two
  // components subscribing on the same page), and calling .on() on an
  // already-subscribed channel throws "cannot add postgres_changes
  // callbacks ... after subscribe()". A unique name guarantees a fresh
  // channel every time. Matches the same fix applied on the
  // digital-city-era and mybodaguy sides.
  const channelName = `landing_messages_public_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'landing_messages', filter: 'is_public=eq.true' },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
};

export const devListAllLandingMessages = async (devToken) => {
  const { data, error } = await supabase.rpc('dev_get_landing_messages', { dev_token: devToken });
  if (error) throw error;
  return data || [];
};

export const devDeleteLandingMessage = async (devToken, messageId) => {
  const { error } = await supabase.rpc('dev_delete_landing_message', { dev_token: devToken, message_id: messageId });
  if (error) throw error;
};

export const devReplyToLandingMessage = async (devToken, parentId, body, teamName = 'ICAN Team') => {
  const { data, error } = await supabase.rpc('dev_reply_landing_message', {
    dev_token: devToken,
    parent_id: parentId,
    body,
    team_name: teamName,
  });
  if (error) throw error;
  return data;
};

// Fixed 1 ICAN reward to the replier — DB rejects guest replies and
// already-rewarded ones (see dev_mark_correct_answer in
// ADD_LANDING_MESSAGE_REWARDS.sql).
export const devMarkCorrectAnswer = async (devToken, replyId) => {
  const { data, error } = await supabase.rpc('dev_mark_correct_answer', {
    dev_token: devToken,
    reply_id: replyId,
  });
  if (error) throw error;
  return data;
};

// General manual grant — independent of the correct-answer/popular-message
// auto-rewards, for a developer to award any amount to any poster.
export const devGrantLandingBonus = async (devToken, targetUserId, amount, note = 'Manual grant from Public Board') => {
  const { data, error } = await supabase.rpc('dev_grant_landing_bonus', {
    dev_token: devToken,
    target_user_id: targetUserId,
    amount,
    note,
    source_app: ORIGIN_APP,
  });
  if (error) throw error;
  return data;
};
