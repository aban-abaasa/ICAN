import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, X, Send, Headphones, Globe, ThumbsUp, Briefcase, Shield, ArrowLeft, Radio, Expand, Minimize, GripVertical, Mic, Trash2, Loader2, Phone, Video } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import VoiceNotePlayer from './voice/VoiceNotePlayer';
import VoiceNoteRetentionPrompt from './voice/VoiceNoteRetentionPrompt';
import CallDock from './calls/CallDock';
import CallStage from './calls/CallStage';
import CommunityLiveStage from './community/CommunityLiveStage';
import CommunityLiveBanner from './community/CommunityLiveBanner';
import { useDirectCall } from '../hooks/useDirectCall';
import { useCommunityLive } from '../hooks/useCommunityLive';
import { uploadVoiceNote, linkVoiceNoteMessages } from '../services/voiceNoteService';
import {
  resolveChatIdentity,
  isDeveloperSession,
  getGuestIdentity,
  setGuestIdentity,
  getStoredConversationId,
  storeConversationId,
  createConversation,
  fetchConversation,
  fetchMessages,
  sendMessage,
  markConversationRead,
  subscribeToMessages,
  subscribeToConversation,
} from '../services/chatService';
import {
  createLandingMessage,
  fetchPublicThreads,
  getOrCreateGuestLikeKey,
  likeMessage,
  replyToLandingMessage,
  subscribeToPublicLandingMessages,
} from '../services/landingMessagesService';
import cmmsMessagingService from '../services/cmmsMessagingService';
import { getUserTrustGroups, getGroupMembersDetailed, getGroupMessages, sendGroupMessage } from '../services/trustService';

const dedupe = (list, item) => (list.some((m) => m.id === item.id) ? list : [...list, item]);
const oldestFirst = (messages = []) => [...messages].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
const sortedPair = (a, b) => [String(a), String(b)].sort().join('_');

// Small audio/video call-launch buttons, reused wherever a channel has one
// clear "who am I talking to" contact (support/cmms/trust contact header,
// community thread header) — hidden once a call is already in progress.
const CallButtons = ({ call, onAudio, onVideo, dark = false, onLight = false }) => {
  if (!call?.canCall) return null;
  const btnClass = onLight ? 'text-white hover:bg-white/20' : dark ? 'text-slate-300 hover:bg-white/10' : 'text-slate-500 hover:bg-black/5';
  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      <button onClick={onAudio} className={`rounded-full p-1.5 transition ${btnClass}`} title="Audio call">
        <Phone className="h-4 w-4" />
      </button>
      <button onClick={onVideo} className={`rounded-full p-1.5 transition ${btnClass}`} title="Video call">
        <Video className="h-4 w-4" />
      </button>
    </div>
  );
};
const WIDGET_POSITION_KEY = 'ican_chat_widget_position';
const ALL_CMMS_RECIPIENTS = '__all_cmms_employees__';
const ALL_TRUST_MEMBERS = '__all_trust_members__';

// Voice notes are stored as a prefixed message body in every channel's
// existing text column — no schema change needed on any of the four chat
// backends (support conversations, landing Q&A, CMMS messages, Trust chat).
const VOICE_NOTE_PREFIX = 'voice-note::';
const isVoiceNoteBody = (text) => typeof text === 'string' && text.startsWith(VOICE_NOTE_PREFIX);
const voiceNoteUrlFromBody = (text) => text.slice(VOICE_NOTE_PREFIX.length);
const formatVoiceDuration = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
const MessageBody = ({ text, className = '', tint = 'cyan' }) => (
  isVoiceNoteBody(text)
    ? <VoiceNotePlayer url={voiceNoteUrlFromBody(text)} tint={tint} />
    : <p className={className}>{text}</p>
);

const AVATAR_HUES = ['bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-emerald-500', 'bg-amber-500', 'bg-cyan-500'];
const hueForId = (id) => {
  const str = String(id || '?');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[hash % AVATAR_HUES.length];
};
const initialsFor = (name) => {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[1][0]).toUpperCase();
};
const ContactAvatar = ({ id, name, broadcast = false, size = 'h-8 w-8 text-xs' }) => (
  <div className={`${size} ${broadcast ? 'bg-gradient-to-br from-indigo-500 to-purple-600' : hueForId(id)} flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white`}>
    {broadcast ? <Radio className="h-3.5 w-3.5" /> : initialsFor(name)}
  </div>
);

const getSavedPosition = (hasBottomNav) => {
  try {
    const saved = JSON.parse(localStorage.getItem(WIDGET_POSITION_KEY));
    if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) return saved;
  } catch (_) { /* Use the default position. */ }
  return { left: Math.max(12, window.innerWidth - 76), top: Math.max(12, window.innerHeight - (hasBottomNav ? 112 : 76)) };
};

const ChatWidget = ({ hasBottomNav = false }) => {
  const { actualTheme } = useTheme();
  const dark = actualTheme === 'dark';

  const [identity, setIdentity] = useState(null);
  const [identityReady, setIdentityReady] = useState(false);
  const [guestForm, setGuestForm] = useState({ name: '', email: '' });
  const [guestFormError, setGuestFormError] = useState('');
  const [guestLikeKey] = useState(() => getOrCreateGuestLikeKey());

  const [open, setOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [position, setPosition] = useState(() => getSavedPosition(hasBottomNav));
  const [channel, setChannel] = useState('support'); // 'support' | 'community' | 'cmms'
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [supportConvId, setSupportConvId] = useState(null);
  const [supportMessages, setSupportMessages] = useState([]);
  const [supportUnread, setSupportUnread] = useState(false);

  const [communityThreads, setCommunityThreads] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [cmmsMessages, setCmmsMessages] = useState([]);
  const [cmmsTasks, setCmmsTasks] = useState([]);
  const [cmmsLoading, setCmmsLoading] = useState(false);
  const [cmmsMembershipVerified, setCmmsMembershipVerified] = useState(false);
  const [cmmsRecipients, setCmmsRecipients] = useState([]);
  const [cmmsActiveContactId, setCmmsActiveContactId] = useState('');
  const [cmmsConversation, setCmmsConversation] = useState([]);
  const [cmmsConversationLoading, setCmmsConversationLoading] = useState(false);
  const [cmmsComposeError, setCmmsComposeError] = useState('');

  const [trustGroupId, setTrustGroupId] = useState(null);
  const [trustGroupName, setTrustGroupName] = useState('');
  const [trustMembershipVerified, setTrustMembershipVerified] = useState(false);
  const [trustLoading, setTrustLoading] = useState(false);
  const [trustMembers, setTrustMembers] = useState([]);
  const [trustMessages, setTrustMessages] = useState([]);
  const [trustActiveContactId, setTrustActiveContactId] = useState('');
  const [trustComposeError, setTrustComposeError] = useState('');

  const [voicePhase, setVoicePhase] = useState('idle'); // 'idle' | 'recording' | 'uploading'
  const [voiceElapsed, setVoiceElapsed] = useState(0);
  const [voiceError, setVoiceError] = useState('');

  const scrollRef = useRef(null);
  const openRef = useRef(open);
  const channelRef = useRef(channel);
  const dragRef = useRef(null);
  const dragMovedRef = useRef(false);
  const voiceRecorderRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceStreamRef = useRef(null);
  const voiceTimerRef = useRef(null);
  const voiceSendRef = useRef(false);
  const identityRef = useRef(identity);
  const guestFormRef = useRef(guestForm);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { channelRef.current = channel; }, [channel]);
  useEffect(() => { identityRef.current = identity; }, [identity]);
  useEffect(() => { guestFormRef.current = guestForm; }, [guestForm]);
  useEffect(() => () => {
    if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
    if (voiceStreamRef.current) voiceStreamRef.current.getTracks().forEach((t) => t.stop());
  }, []);

  const hidden = isDeveloperSession();
  const scopeKey = identity ? (identity.isGuest ? 'guest' : `user_${identity.userId}`) : null;
  // Mirrors CMSSModule.jsx's per-user company scoping: 'cmms_company_id' alone is a
  // shared browser-level cache that can point at a company from a different CMMS
  // user/session, so prefer the email-scoped key before falling back to it.
  const getScopedCmmsCompanyId = (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const scopedValue = normalizedEmail ? localStorage.getItem(`cmms_active_company::${normalizedEmail}`) : null;
    return scopedValue || localStorage.getItem('cmms_company_id');
  };
  const cmmsCompanyId = !identity?.isGuest ? getScopedCmmsCompanyId(identity?.email) : null;
  const canCheckCmmsAccess = Boolean(cmmsCompanyId && identity?.authId);
  const hasCmmsAccess = canCheckCmmsAccess && cmmsMembershipVerified;

  const canCheckTrustAccess = Boolean(identity?.authId && !identity?.isGuest);
  const hasTrustAccess = canCheckTrustAccess && trustMembershipVerified && Boolean(trustGroupId);

  useEffect(() => {
    const keepWidgetVisible = () => {
      setPosition((current) => ({
        left: Math.min(Math.max(8, current.left), Math.max(8, window.innerWidth - 64)),
        top: Math.min(Math.max(8, current.top), Math.max(8, window.innerHeight - 64)),
      }));
    };
    window.addEventListener('resize', keepWidgetVisible);
    return () => window.removeEventListener('resize', keepWidgetVisible);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(WIDGET_POSITION_KEY, JSON.stringify(position)); } catch (_) { /* Storage is optional. */ }
  }, [position]);

  useEffect(() => {
    if (!canCheckCmmsAccess) {
      setCmmsMessages([]);
      setCmmsTasks([]);
      setCmmsMembershipVerified(false);
      if (channel === 'cmms') setChannel('support');
      return undefined;
    }
    let cancelled = false;
    const loadCmmsFeed = async () => {
      setCmmsLoading(true);
      try {
        const [messagesResult, tasksResult, usersResult] = await Promise.all([
          cmmsMessagingService.getUserMessages(cmmsCompanyId),
          cmmsMessagingService.getUserJobAssignments(cmmsCompanyId),
          cmmsMessagingService.getCompanyUsers(cmmsCompanyId),
        ]);
        if (cancelled) return;
        const verified = messagesResult.success || tasksResult.success || usersResult.success;
        setCmmsMembershipVerified(verified);
        setCmmsMessages(messagesResult.success ? oldestFirst(messagesResult.data) : []);
        setCmmsTasks(tasksResult.success ? tasksResult.data || [] : []);
        setCmmsRecipients(usersResult.success ? (usersResult.data || []).filter((user) => (
          user.id !== identity?.userId
          && user.id !== identity?.authId
          && user.email?.toLowerCase() !== identity?.email?.toLowerCase()
        )) : []);
        if (!verified && channelRef.current === 'cmms') setChannel('support');
      } finally {
        if (!cancelled) setCmmsLoading(false);
      }
    };
    loadCmmsFeed();
    const intervalId = window.setInterval(loadCmmsFeed, 30000);
    return () => { cancelled = true; window.clearInterval(intervalId); };
  }, [canCheckCmmsAccess, cmmsCompanyId]);

  useEffect(() => {
    if (!cmmsActiveContactId || cmmsActiveContactId === ALL_CMMS_RECIPIENTS) { setCmmsConversation([]); return undefined; }
    let cancelled = false;
    setCmmsConversationLoading(true);
    cmmsMessagingService.getConversationWithUser(cmmsCompanyId, cmmsActiveContactId)
      .then((result) => { if (!cancelled) setCmmsConversation(result?.success ? result.data || [] : []); })
      .catch(() => { if (!cancelled) setCmmsConversation([]); })
      .finally(() => { if (!cancelled) setCmmsConversationLoading(false); });
    return () => { cancelled = true; };
  }, [cmmsActiveContactId, cmmsCompanyId]);

  useEffect(() => {
    if (!canCheckTrustAccess) {
      setTrustMembers([]);
      setTrustMessages([]);
      setTrustMembershipVerified(false);
      setTrustGroupId(null);
      if (channel === 'trust') setChannel('support');
      return undefined;
    }
    let cancelled = false;
    const loadTrustFeed = async () => {
      setTrustLoading(true);
      try {
        const groups = await getUserTrustGroups(identity.authId);
        if (cancelled) return;
        // A user may belong to several groups; the widget is a small global
        // surface (like the single-company CMMS scope above), so it follows
        // the same one-group convention rather than merging multiple threads.
        const activeGroup = (groups || []).find((g) => (g.status || 'active') === 'active') || groups?.[0] || null;
        if (!activeGroup) {
          setTrustMembershipVerified(false);
          setTrustGroupId(null);
          if (channelRef.current === 'trust') setChannel('support');
          return;
        }
        const [members, messages] = await Promise.all([
          getGroupMembersDetailed(activeGroup.id),
          getGroupMessages(activeGroup.id),
        ]);
        if (cancelled) return;
        setTrustGroupId(activeGroup.id);
        setTrustGroupName(activeGroup.name || 'Trust & SACCO');
        setTrustMembershipVerified(true);
        // trust_group_members has no name/email column, so members are
        // labeled the same way TrustSystem.jsx itself labels them.
        setTrustMembers((members || [])
          .filter((m) => m.user_id !== identity?.authId)
          .map((m) => ({
            user_id: m.user_id,
            name: `Member #${m.member_number ?? '?'}`,
            role: m.role,
          })));
        setTrustMessages(oldestFirst(messages || []));
      } finally {
        if (!cancelled) setTrustLoading(false);
      }
    };
    loadTrustFeed();
    const intervalId = window.setInterval(loadTrustFeed, 30000);
    return () => { cancelled = true; window.clearInterval(intervalId); };
  }, [canCheckTrustAccess, identity?.authId]);

  useEffect(() => {
    if (hidden) { setIdentityReady(true); return; }
    let cancelled = false;
    (async () => {
      const resolved = await resolveChatIdentity();
      if (cancelled) return;
      if (resolved) {
        setIdentity({ ...resolved, isGuest: false });
      } else {
        const stored = getGuestIdentity();
        if (stored?.name) setIdentity({ ...stored, isGuest: true });
      }
      setIdentityReady(true);
    })();
    return () => { cancelled = true; };
  }, [hidden]);

  useEffect(() => {
    setSupportMessages([]);
    setSupportConvId(null);
    setSupportUnread(false);
    if (!scopeKey) return;
    const storedId = getStoredConversationId(scopeKey);
    if (!storedId) return;

    let cancelled = false;
    (async () => {
      const conv = await fetchConversation(storedId);
      if (!conv || cancelled) return;
      setSupportConvId(conv.id);
      setSupportUnread(!!conv.unread_by_user);
    })();
    return () => { cancelled = true; };
  }, [scopeKey]);

  useEffect(() => {
    if (!supportConvId) return;
    let cancelled = false;
    (async () => {
      const msgs = await fetchMessages(supportConvId);
      if (!cancelled) setSupportMessages(msgs);
    })();

    const unsubMessages = subscribeToMessages(supportConvId, (msg) => {
      setSupportMessages((prev) => dedupe(prev, msg));
      if (msg.sender_role === 'dev' && !(openRef.current && channelRef.current === 'support')) {
        setSupportUnread(true);
      }
    });
    const unsubConversation = subscribeToConversation(supportConvId, (conv) => {
      if (conv.unread_by_user && !(openRef.current && channelRef.current === 'support')) {
        setSupportUnread(true);
      }
    });

    return () => { cancelled = true; unsubMessages(); unsubConversation(); };
  }, [supportConvId]);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    const load = () => fetchPublicThreads(50, { authId: identity?.isGuest ? null : identity?.authId, guestKey: guestLikeKey })
      .then((rows) => { if (!cancelled) setCommunityThreads(rows); }).catch(() => {});
    load();
    const unsubscribe = subscribeToPublicLandingMessages(() => load());
    return () => { cancelled = true; unsubscribe(); };
  }, [hidden, identity?.authId, identity?.isGuest, guestLikeKey]);

  const selectedThread = communityThreads.find((t) => t.id === selectedThreadId) || null;

  const trustActiveConversation = trustActiveContactId && trustActiveContactId !== ALL_TRUST_MEMBERS
    ? trustMessages.filter((m) => m.user_id === identity?.authId || m.user_id === trustActiveContactId)
    : trustActiveContactId === ALL_TRUST_MEMBERS ? trustMessages : [];

  // Who a "call" button in the current channel would reach, and what room
  // to reach them at — one fixed 1:1 room per channel's existing notion of
  // "who am I talking to" (the open support conversation, the selected CMMS/
  // Trust contact, the author of the community thread I'm reading). Group
  // targets ("All employees"/"All members") aren't callable.
  const callContext = useMemo(() => {
    const selfName = identity?.name || 'Guest';
    if (channel === 'support') {
      if (!supportConvId) return null;
      const selfId = identity?.userId || identity?.authId || guestLikeKey;
      return { roomId: `support:${supportConvId}`, selfId, selfName, peerNameHint: 'Support team' };
    }
    if (channel === 'community') {
      if (!identity || identity.isGuest || !identity.authId || !selectedThread) return null;
      const authorId = selectedThread.user_id;
      if (!authorId || authorId === identity.authId) return null;
      return { roomId: `community:${sortedPair(identity.authId, authorId)}`, selfId: identity.authId, selfName, peerNameHint: selectedThread.name || 'Member' };
    }
    if (channel === 'cmms') {
      if (!cmmsActiveContactId || cmmsActiveContactId === ALL_CMMS_RECIPIENTS || !identity) return null;
      const selfId = identity.userId || identity.authId;
      const peerNameHint = cmmsRecipients.find((m) => m.id === cmmsActiveContactId)?.name || 'Teammate';
      return { roomId: `cmms:${cmmsCompanyId}:${sortedPair(selfId, cmmsActiveContactId)}`, selfId, selfName, peerNameHint };
    }
    if (channel === 'trust') {
      if (!trustActiveContactId || trustActiveContactId === ALL_TRUST_MEMBERS || !identity?.authId) return null;
      const peerNameHint = trustMembers.find((m) => m.user_id === trustActiveContactId)?.name || 'Member';
      return { roomId: `trust:${trustGroupId}:${sortedPair(identity.authId, trustActiveContactId)}`, selfId: identity.authId, selfName, peerNameHint };
    }
    return null;
  }, [channel, supportConvId, identity, guestLikeKey, selectedThread, cmmsActiveContactId, cmmsCompanyId, cmmsRecipients, trustActiveContactId, trustGroupId, trustMembers]);

  const call = useDirectCall({
    roomId: callContext?.roomId || null,
    selfId: callContext?.selfId || null,
    selfName: callContext?.selfName || '',
  });
  const peerNameHintRef = useRef('');
  peerNameHintRef.current = callContext?.peerNameHint || '';
  const startAudioCall = () => call.startCall(false, peerNameHintRef.current);
  const startVideoCall = () => call.startCall(true, peerNameHintRef.current);
  // A video call takes over the whole widget (real room to see the other
  // person) instead of the slim dock — audio calls and an incoming ring
  // (no camera yet, media isn't requested until Accept) stay on the dock.
  const showCallStage = call.isVideo && (call.callState === 'ringing-out' || call.callState === 'active');

  // Community "Go Live" broadcast — independent of `channel` so a stream you
  // started keeps running (and its full-screen stage keeps showing) even if
  // you switch to another tab in the widget. Guests can watch but not go live.
  const communityLive = useCommunityLive({
    selfId: identity?.userId || identity?.authId || guestLikeKey,
    selfName: identity?.name || 'Guest',
    canBroadcast: Boolean(identity && !identity.isGuest && identity.authId),
  });
  const showCommunityLiveStage = communityLive.role === 'broadcasting' || communityLive.role === 'watching';

  // Tapping a "X is live" push notification (or its NOTIFICATION_CLICK
  // message from sw.js when a tab is already open — see MobileView.jsx)
  // should drop the visitor straight into the stream, not just onto
  // whatever screen happened to be showing.
  const [pendingCommunityJoin, setPendingCommunityJoin] = useState(false);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('join') === 'community-live') {
        setPendingCommunityJoin(true);
        params.delete('join');
        const rest = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
      }
    } catch (_) { /* URL not available */ }

    const onOpenCommunityLive = () => setPendingCommunityJoin(true);
    window.addEventListener('ican-open-community-live', onOpenCommunityLive);
    return () => window.removeEventListener('ican-open-community-live', onOpenCommunityLive);
  }, []);
  useEffect(() => {
    if (!pendingCommunityJoin) return;
    setOpen(true);
    setChannel('community');
    setSelectedThreadId(null);
    if (communityLive.canWatch) {
      communityLive.watch();
      setPendingCommunityJoin(false);
    }
  }, [pendingCommunityJoin, communityLive.canWatch]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [supportMessages, communityThreads, selectedThreadId, cmmsConversation, cmmsActiveContactId, trustMessages, trustActiveContactId, open, channel]);

  const markChannelRead = (ch) => {
    if (ch === 'support') {
      setSupportUnread(false);
      if (supportConvId) markConversationRead(supportConvId, 'user');
    }
  };

  const handleOpen = () => {
    setOpen(true);
    markChannelRead(channel);
  };

  const handleSwitchChannel = (ch) => {
    setChannel(ch);
    markChannelRead(ch);
  };

  const startDrag = (event) => {
    if (fullScreen || event.button !== 0) return;
    dragMovedRef.current = false;
    dragRef.current = { startX: event.clientX, startY: event.clientY, left: position.left, top: position.top, moved: false };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const left = Math.min(Math.max(8, drag.left + event.clientX - drag.startX), Math.max(8, window.innerWidth - 64));
    const top = Math.min(Math.max(8, drag.top + event.clientY - drag.startY), Math.max(8, window.innerHeight - 64));
    if (Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4) {
      drag.moved = true;
      dragMovedRef.current = true;
    }
    setPosition({ left, top });
  };

  const endDrag = () => { dragRef.current = null; setDragging(false); };

  // Reads via refs (not the `identity`/`guestForm` state closures directly) so
  // this is safe to call from a callback captured well before it runs, like
  // the voice recorder's onstop handler — otherwise it would see whatever the
  // guest form held at the moment recording *started*, not what's in it now.
  const ensureIdentity = () => {
    if (identityRef.current) return identityRef.current;
    const name = guestFormRef.current.name.trim();
    const email = guestFormRef.current.email.trim();
    if (!name || !email) {
      setGuestFormError('Please enter your name and email so we can reply.');
      return null;
    }
    const guest = { name, email, isGuest: true };
    setGuestIdentity(guest);
    setIdentity(guest);
    identityRef.current = guest;
    return guest;
  };

  const handleLike = async (messageId) => {
    setCommunityThreads((prev) => prev.map((t) => {
      const bump = (m) => (m.id === messageId && !m.likedByMe
        ? { ...m, likeCount: (m.likeCount || 0) + 1, likedByMe: true }
        : m);
      return { ...bump(t), replies: t.replies.map(bump) };
    }));
    try {
      await likeMessage({ messageId, authId: identity?.isGuest ? null : identity?.authId, guestKey: guestLikeKey });
    } catch (err) {
      console.error('[ChatWidget] failed to like message:', err);
    }
  };

  // Shared per-channel routing for both a typed message and a recorded voice
  // note (sent as VOICE_NOTE_PREFIX + url) — the two compose paths differ
  // only in how `body` is produced.
  const deliverMessage = async (body, who) => {
      if (channel === 'cmms') {
        if (!cmmsActiveContactId) {
          setCmmsComposeError('Choose someone to message first.');
          return;
        }
        const recipientIds = cmmsActiveContactId === ALL_CMMS_RECIPIENTS
          ? cmmsRecipients.map((member) => member.id)
          : [cmmsActiveContactId];
        if (recipientIds.length === 0) throw new Error('There are no other CMMS employees to message.');
        const results = await Promise.all(recipientIds.map((recipientId) => cmmsMessagingService.sendReportMessage(
          cmmsCompanyId,
          null,
          body,
          recipientId,
          'comment'
        )));
        const failed = results.find((result) => !result.success);
        if (failed) throw new Error(failed.error || 'Unable to send CMMS message.');
        setCmmsComposeError('');
        if (cmmsActiveContactId === ALL_CMMS_RECIPIENTS) {
          const messagesResult = await cmmsMessagingService.getUserMessages(cmmsCompanyId);
          if (messagesResult.success) setCmmsMessages(oldestFirst(messagesResult.data));
        } else {
          const convResult = await cmmsMessagingService.getConversationWithUser(cmmsCompanyId, cmmsActiveContactId);
          if (convResult?.success) setCmmsConversation(convResult.data || []);
        }
        return results
          .filter((result) => result.success && result.data?.id)
          .map((result) => ({ table: 'cmms_report_messages', id: result.data.id }));
      } else if (channel === 'trust') {
        if (!trustActiveContactId) {
          setTrustComposeError('Choose someone to message first.');
          return;
        }
        const contact = trustMembers.find((m) => m.user_id === trustActiveContactId);
        const message = trustActiveContactId === ALL_TRUST_MEMBERS ? body : `@${contact?.name || 'Member'} ${body}`;
        const result = await sendGroupMessage({ groupId: trustGroupId, userId: identity.authId, userEmail: identity.email, message });
        if (!result.success) throw new Error(result.error || 'Unable to send Trust & SACCO message.');
        setTrustComposeError('');
        const messages = await getGroupMessages(trustGroupId);
        setTrustMessages(oldestFirst(messages || []));
        return result.data?.id ? [{ table: 'group_messages', id: result.data.id }] : [];
      } else if (channel === 'community') {
        const senderAuthId = who.isGuest ? null : who.authId;
        const created = selectedThreadId
          ? await replyToLandingMessage({ parentId: selectedThreadId, name: who.name, email: who.email, authId: senderAuthId, message: body })
          : await createLandingMessage({ name: who.name, email: who.email, authId: senderAuthId, message: body, isPublic: true });
        setCommunityThreads(await fetchPublicThreads(50, { authId: senderAuthId, guestKey: guestLikeKey }));
        return created?.id ? [{ table: 'landing_messages', id: created.id }] : [];
      } else {
        const key = who.isGuest ? 'guest' : `user_${who.userId}`;
        let convId = supportConvId;
        if (!convId) {
          const conv = await createConversation({
            name: who.name,
            email: who.email,
            userId: who.userId || null,
            role: who.role || 'guest',
            portal: 'landing',
            subject: 'Support chat',
          });
          convId = conv.id;
          storeConversationId(key, convId);
          setSupportConvId(convId);
        }
        const senderRole = who.isGuest ? 'guest' : (who.role || 'guest');
        const msg = await sendMessage(convId, { senderRole, senderName: who.name, body });
        setSupportMessages((prev) => dedupe(prev, msg));
        return msg?.id ? [{ table: 'chat_messages', id: msg.id }] : [];
      }
  };

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;

    const who = ensureIdentity();
    if (!who) return;

    setSending(true);
    try {
      await deliverMessage(body, who);
      setDraft('');
    } catch (err) {
      console.error('[ChatWidget] send failed:', err);
      if (channel === 'cmms') setCmmsComposeError(err.message || 'Unable to send CMMS message.');
      if (channel === 'trust') setTrustComposeError(err.message || 'Unable to send Trust & SACCO message.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startVoiceRecording = async () => {
    setVoiceError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      voiceRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) voiceChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);

        const shouldSend = voiceSendRef.current;
        voiceSendRef.current = false;
        if (!shouldSend) {
          setVoicePhase('idle');
          return;
        }

        const blob = new Blob(voiceChunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) {
          setVoicePhase('idle');
          return;
        }

        setVoicePhase('uploading');
        const who = ensureIdentity();
        if (!who) {
          setVoicePhase('idle');
          return;
        }
        const result = await uploadVoiceNote(blob);
        if (result.success) {
          try {
            const links = await deliverMessage(VOICE_NOTE_PREFIX + result.url, who);
            if (result.retentionId && links?.length) {
              await linkVoiceNoteMessages(result.retentionId, links);
            }
          } catch (err) {
            console.error('[ChatWidget] voice note send failed:', err);
            if (channel === 'cmms') setCmmsComposeError(err.message || 'Unable to send CMMS message.');
            else if (channel === 'trust') setTrustComposeError(err.message || 'Unable to send Trust & SACCO message.');
            else setVoiceError(err.message || 'Unable to send voice note.');
          }
        } else {
          setVoiceError(result.error || 'Upload failed');
        }
        setVoicePhase('idle');
      };

      recorder.start();
      setVoiceElapsed(0);
      setVoicePhase('recording');
      voiceTimerRef.current = setInterval(() => setVoiceElapsed((s) => s + 1), 1000);
    } catch (err) {
      console.error('Voice note recording failed:', err);
      setVoiceError(err?.name === 'NotAllowedError' ? 'Microphone permission denied' : 'Could not access microphone');
    }
  };

  const stopAndSendVoiceRecording = () => {
    if (voiceRecorderRef.current && voicePhase === 'recording') {
      voiceSendRef.current = true;
      voiceRecorderRef.current.stop();
    }
  };

  const cancelVoiceRecording = () => {
    if (voiceRecorderRef.current && voicePhase === 'recording') {
      voiceSendRef.current = false;
      voiceRecorderRef.current.stop();
    } else {
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      setVoicePhase('idle');
    }
  };

  const handleDraftChange = (event) => {
    setDraft(event.target.value);
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 144)}px`;
  };

  if (hidden || !identityReady) return null;

  const needsGuestForm = !identity;

  return (
    <>
      {!identity?.isGuest && <VoiceNoteRetentionPrompt ownerId={identity?.authId} />}
    <div className="fixed z-[999]" style={fullScreen ? undefined : { left: position.left, top: position.top }}>
      {open && (
        <div
          className={`${fullScreen ? 'fixed inset-0 h-[100dvh] w-full rounded-none' : 'fixed left-1/2 top-1/2 h-[min(28rem,calc(100dvh-2rem))] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl'} flex flex-col overflow-hidden border shadow-2xl ${
            dark ? 'border-slate-700/50 bg-slate-950' : 'border-slate-200 bg-white'
          }`}
        >
          <div className={`flex items-center justify-between bg-gradient-to-r ${channel === 'trust' ? 'from-amber-500 via-orange-600 to-slate-800' : 'from-indigo-500 via-purple-600 to-slate-800'} px-4 text-white ${channel === 'cmms' || channel === 'trust' ? 'py-2' : 'py-3'}`}>
            <div>
              <p className="text-sm font-semibold">{channel === 'community' ? 'Community' : channel === 'cmms' ? 'CMMS' : channel === 'trust' ? (trustGroupName || 'Trust & SACCO') : 'IcanEra Support'}</p>
              {channel !== 'cmms' && channel !== 'trust' && <p className="text-[11px] text-white/80">
                {channel === 'community' ? 'Public Q&A — everyone can read this' : 'We usually reply within a few minutes'}
              </p>}
            </div>
            <div className="flex items-center gap-1">
              {channel === 'support' && <CallButtons call={call} onAudio={startAudioCall} onVideo={startVideoCall} onLight />}
              {channel === 'community' && communityLive.canBroadcast && (
                <button onClick={communityLive.goLive} className="rounded-lg p-1.5 text-white hover:bg-white/20 transition" title="Go live to Community">
                  <Radio className="h-4 w-4" />
                </button>
              )}
              <button onClick={() => setFullScreen((value) => !value)} className="rounded-lg p-1.5 hover:bg-white/20 transition" title={fullScreen ? 'Exit full screen' : 'Open full screen'}>
                {fullScreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
              </button>
              <button onClick={() => { setOpen(false); setFullScreen(false); }} className="rounded-lg p-1.5 hover:bg-white/20 transition" title="Close"><X className="h-4 w-4" /></button>
            </div>
          </div>

          {showCallStage && <CallStage call={call} />}
          {!showCallStage && <CallDock call={call} dark={dark} tint={channel === 'trust' ? 'amber' : 'indigo'} />}
          {showCommunityLiveStage && <CommunityLiveStage live={communityLive} />}

          <div className={`flex gap-1 border-b px-3 py-2 ${dark ? 'border-slate-700/50 bg-slate-950' : 'border-slate-200 bg-slate-50'}`}>
            <button
              onClick={() => handleSwitchChannel('support')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                channel === 'support'
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                  : dark ? 'text-slate-400 hover:bg-white/5' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <Headphones className="h-3.5 w-3.5" /> Support
              {supportUnread && channel !== 'support' && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
            </button>
            <button
              onClick={() => handleSwitchChannel('community')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                channel === 'community'
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                  : dark ? 'text-slate-400 hover:bg-white/5' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <Globe className="h-3.5 w-3.5" /> Community
              {communityLive.liveInfo && channel !== 'community' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />}
            </button>
            {hasCmmsAccess && (
              <button
                onClick={() => handleSwitchChannel('cmms')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                  channel === 'cmms'
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                    : dark ? 'text-slate-400 hover:bg-white/5' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Briefcase className="h-3.5 w-3.5" /> CMMS
              </button>
            )}
            {hasTrustAccess && (
              <button
                onClick={() => handleSwitchChannel('trust')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                  channel === 'trust'
                    ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white'
                    : dark ? 'text-slate-400 hover:bg-white/5' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Shield className="h-3.5 w-3.5" /> Trust
              </button>
            )}
          </div>

          <div ref={scrollRef} className={`flex-1 space-y-2 overflow-y-auto px-3 py-3 ${dark ? 'bg-slate-950' : 'bg-slate-50'}`}>
            {channel === 'cmms' ? (
              cmmsLoading && cmmsMessages.length === 0 && cmmsTasks.length === 0 && cmmsRecipients.length === 0 ? (
                <p className={`mt-6 text-center text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Loading your CMMS work feed...</p>
              ) : cmmsActiveContactId ? (
                <>
                  <div className={`sticky top-0 z-10 -mx-3 -mt-3 mb-2 flex items-center gap-2 border-b px-3 py-2 ${dark ? 'border-slate-700/50 bg-slate-950' : 'border-slate-200 bg-slate-50'}`}>
                    <button onClick={() => setCmmsActiveContactId('')} className="flex-shrink-0 rounded-full p-1 hover:bg-black/10" title="Back to teammates">
                      <ArrowLeft className={`h-4 w-4 ${dark ? 'text-slate-300' : 'text-slate-600'}`} />
                    </button>
                    <ContactAvatar
                      id={cmmsActiveContactId}
                      name={cmmsRecipients.find((m) => m.id === cmmsActiveContactId)?.name}
                      broadcast={cmmsActiveContactId === ALL_CMMS_RECIPIENTS}
                    />
                    <span className={`truncate text-sm font-semibold ${dark ? 'text-slate-100' : 'text-slate-800'}`}>
                      {cmmsActiveContactId === ALL_CMMS_RECIPIENTS ? 'All CMMS employees' : (cmmsRecipients.find((m) => m.id === cmmsActiveContactId)?.name || cmmsRecipients.find((m) => m.id === cmmsActiveContactId)?.email || 'CMMS member')}
                    </span>
                    <CallButtons call={call} onAudio={startAudioCall} onVideo={startVideoCall} dark={dark} />
                  </div>
                  {cmmsActiveContactId === ALL_CMMS_RECIPIENTS ? (
                    cmmsMessages.length === 0 ? <p className={`mt-6 text-center text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>No broadcast messages yet.</p> : cmmsMessages.map((message) => {
                      const isOwnMessage = message.sender_email?.toLowerCase() === identity?.email?.toLowerCase();
                      return (
                        <div key={message.id} className={`mb-2 flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                            isOwnMessage
                              ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-br-md'
                              : dark ? 'border border-slate-700/50 bg-white/5 text-slate-100 rounded-bl-md' : 'border border-slate-200 bg-white text-slate-800 rounded-bl-md'
                          }`}>
                            <p className={`text-[10px] font-semibold uppercase tracking-wide ${isOwnMessage ? 'text-white/75' : 'text-indigo-400'}`}>
                              {isOwnMessage ? `You → ${message.recipient_name || 'CMMS member'}` : (message.sender_name || message.sender_email || 'CMMS team')}
                            </p>
                            <MessageBody text={message.message_text || message.body || ''} className="mt-0.5 whitespace-pre-wrap break-words text-sm" tint={isOwnMessage ? 'white' : 'cyan'} />
                            {message.created_at && <p className={`mt-1 text-right text-[10px] ${isOwnMessage ? 'text-white/70' : dark ? 'text-slate-500' : 'text-slate-400'}`}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                          </div>
                        </div>
                      );
                    })
                  ) : cmmsConversationLoading ? (
                    <p className={`mt-6 text-center text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Loading conversation...</p>
                  ) : cmmsConversation.length === 0 ? (
                    <p className={`mt-6 text-center text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>No messages yet — say hello!</p>
                  ) : cmmsConversation.map((message) => {
                    const isOwnMessage = message.sender_id
                      ? (message.sender_id === identity?.userId || message.sender_id === identity?.authId)
                      : message.sender_email?.toLowerCase() === identity?.email?.toLowerCase();
                    return (
                      <div key={message.id} className={`mb-2 flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                          isOwnMessage
                            ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-br-md'
                            : dark ? 'border border-slate-700/50 bg-white/5 text-slate-100 rounded-bl-md' : 'border border-slate-200 bg-white text-slate-800 rounded-bl-md'
                        }`}>
                          <MessageBody text={message.message_text || message.body || ''} className="whitespace-pre-wrap break-words text-sm" tint={isOwnMessage ? 'white' : 'cyan'} />
                          {message.created_at && <p className={`mt-1 text-right text-[10px] ${isOwnMessage ? 'text-white/70' : dark ? 'text-slate-500' : 'text-slate-400'}`}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <>
                  <section>
                    <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Assigned tasks</p>
                    {cmmsTasks.length === 0 ? <p className={`rounded-xl border px-3 py-2 text-xs ${dark ? 'border-slate-700/50 text-slate-500' : 'border-slate-200 text-slate-400'}`}>No CMMS tasks are assigned to you.</p> : cmmsTasks.map((task) => (
                      <div key={task.id} className={`mb-2 rounded-xl border px-3 py-2 ${dark ? 'border-slate-700/50 bg-white/5 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`}>
                        <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{task.job_title || 'Assigned task'}</p><span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold capitalize text-indigo-400">{(task.assignment_status || 'pending').replace('_', ' ')}</span></div>
                        {task.job_description && <p className={`mt-1 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{task.job_description}</p>}
                        {task.due_date && <p className={`mt-1 text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Due {new Date(task.due_date).toLocaleDateString()}</p>}
                      </div>
                    ))}
                  </section>
                  <section className="pt-2">
                    <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Message a teammate</p>
                    {cmmsRecipients.length === 0 ? (
                      <p className={`rounded-xl border px-3 py-2 text-xs ${dark ? 'border-slate-700/50 text-slate-500' : 'border-slate-200 text-slate-400'}`}>No teammates to message yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {cmmsRecipients.length > 1 && (
                          <button
                            onClick={() => { setCmmsActiveContactId(ALL_CMMS_RECIPIENTS); setCmmsComposeError(''); }}
                            className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition ${dark ? 'hover:bg-white/5' : 'hover:bg-slate-100'}`}
                          >
                            <ContactAvatar broadcast />
                            <span className={`truncate text-sm font-medium ${dark ? 'text-slate-100' : 'text-slate-800'}`}>All CMMS employees</span>
                          </button>
                        )}
                        {cmmsRecipients.map((member) => (
                          <button
                            key={member.id}
                            onClick={() => { setCmmsActiveContactId(member.id); setCmmsComposeError(''); }}
                            className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition ${dark ? 'hover:bg-white/5' : 'hover:bg-slate-100'}`}
                          >
                            <ContactAvatar id={member.id} name={member.name || member.email} />
                            <span className={`truncate text-sm font-medium ${dark ? 'text-slate-100' : 'text-slate-800'}`}>{member.name || member.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )
            ) : channel === 'trust' ? (
              trustLoading && trustMembers.length === 0 ? (
                <p className={`mt-6 text-center text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Loading your Trust & SACCO feed...</p>
              ) : trustActiveContactId ? (
                <>
                  <div className={`sticky top-0 z-10 -mx-3 -mt-3 mb-2 flex items-center gap-2 border-b px-3 py-2 ${dark ? 'border-slate-700/50 bg-slate-950' : 'border-slate-200 bg-slate-50'}`}>
                    <button onClick={() => setTrustActiveContactId('')} className="flex-shrink-0 rounded-full p-1 hover:bg-black/10" title="Back to members">
                      <ArrowLeft className={`h-4 w-4 ${dark ? 'text-slate-300' : 'text-slate-600'}`} />
                    </button>
                    <ContactAvatar
                      id={trustActiveContactId}
                      name={trustMembers.find((m) => m.user_id === trustActiveContactId)?.name}
                      broadcast={trustActiveContactId === ALL_TRUST_MEMBERS}
                    />
                    <span className={`truncate text-sm font-semibold ${dark ? 'text-slate-100' : 'text-slate-800'}`}>
                      {trustActiveContactId === ALL_TRUST_MEMBERS ? 'All group members' : (trustMembers.find((m) => m.user_id === trustActiveContactId)?.name || 'Member')}
                    </span>
                    <CallButtons call={call} onAudio={startAudioCall} onVideo={startVideoCall} dark={dark} />
                  </div>
                  {trustActiveConversation.length === 0 ? (
                    <p className={`mt-6 text-center text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>No messages yet — say hello!</p>
                  ) : trustActiveConversation.map((message) => {
                    const isOwnMessage = message.user_id === identity?.authId;
                    return (
                      <div key={message.id} className={`mb-2 flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                          isOwnMessage
                            ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-br-md'
                            : dark ? 'border border-slate-700/50 bg-white/5 text-slate-100 rounded-bl-md' : 'border border-slate-200 bg-white text-slate-800 rounded-bl-md'
                        }`}>
                          {!isOwnMessage && (
                            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                              {trustMembers.find((m) => m.user_id === message.user_id)?.name || message.user_email || 'Member'}
                            </p>
                          )}
                          <MessageBody text={message.message} className="whitespace-pre-wrap break-words text-sm" tint={isOwnMessage ? 'white' : 'cyan'} />
                          {message.created_at && <p className={`mt-1 text-right text-[10px] ${isOwnMessage ? 'text-white/70' : dark ? 'text-slate-500' : 'text-slate-400'}`}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <section>
                  <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Message a group member</p>
                  {trustMembers.length === 0 ? (
                    <p className={`rounded-xl border px-3 py-2 text-xs ${dark ? 'border-slate-700/50 text-slate-500' : 'border-slate-200 text-slate-400'}`}>No other members in this group yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {trustMembers.length > 1 && (
                        <button
                          onClick={() => { setTrustActiveContactId(ALL_TRUST_MEMBERS); setTrustComposeError(''); }}
                          className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition ${dark ? 'hover:bg-white/5' : 'hover:bg-slate-100'}`}
                        >
                          <ContactAvatar broadcast />
                          <span className={`truncate text-sm font-medium ${dark ? 'text-slate-100' : 'text-slate-800'}`}>All group members</span>
                        </button>
                      )}
                      {trustMembers.map((member) => (
                        <button
                          key={member.user_id}
                          onClick={() => { setTrustActiveContactId(member.user_id); setTrustComposeError(''); }}
                          className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition ${dark ? 'hover:bg-white/5' : 'hover:bg-slate-100'}`}
                        >
                          <ContactAvatar id={member.user_id} name={member.name} />
                          <span className={`truncate text-sm font-medium ${dark ? 'text-slate-100' : 'text-slate-800'}`}>{member.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )
            ) : channel === 'community' ? (
              <>
              {!selectedThread && <CommunityLiveBanner live={communityLive} dark={dark} />}
              {selectedThread ? (
                <>
                  <div className="mb-1 flex items-center justify-between">
                    <button
                      onClick={() => setSelectedThreadId(null)}
                      className={`text-[11px] font-medium ${dark ? 'text-indigo-400' : 'text-indigo-600'}`}
                    >
                      ← Back to Community
                    </button>
                    <CallButtons call={call} onAudio={startAudioCall} onVideo={startVideoCall} dark={dark} />
                  </div>
                  <div className={`rounded-xl px-3 py-2 text-sm ${dark ? 'bg-white/5 text-slate-100' : 'bg-white text-slate-800 border border-slate-200'}`}>
                    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-400">
                      {selectedThread.name || 'Website visitor'}
                    </p>
                    <MessageBody text={selectedThread.message} className="whitespace-pre-wrap break-words" tint="cyan" />
                    <button
                      onClick={() => handleLike(selectedThread.id)}
                      disabled={selectedThread.likedByMe}
                      className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        selectedThread.likedByMe ? 'text-indigo-400' : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      <ThumbsUp className="h-3 w-3" /> {selectedThread.likeCount || 0}
                    </button>
                  </div>
                  {selectedThread.replies.map((r) => (
                    <div
                      key={r.id}
                      className={`ml-4 mt-2 rounded-xl px-3 py-2 text-sm ${
                        r.sender_role === 'dev'
                          ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
                          : dark ? 'bg-white/5 text-slate-100' : 'bg-white text-slate-800 border border-slate-200'
                      }`}
                    >
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                        {r.sender_role === 'dev' ? 'IcanEra Team' : (r.name || 'Website visitor')}
                        {r.reward_reason && ' · 🪙'}
                      </p>
                      <MessageBody text={r.message} className="whitespace-pre-wrap break-words" tint={r.sender_role === 'dev' ? 'white' : 'cyan'} />
                      <button
                        onClick={() => handleLike(r.id)}
                        disabled={r.likedByMe}
                        className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          r.likedByMe ? 'text-indigo-300' : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        <ThumbsUp className="h-3 w-3" /> {r.likeCount || 0}
                      </button>
                    </div>
                  ))}
                  {selectedThread.replies.length === 0 && (
                    <p className={`mt-3 text-center text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                      No replies yet — be the first to reply.
                    </p>
                  )}
                </>
              ) : communityThreads.length === 0 ? (
                <p className={`mt-6 text-center text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                  No public questions yet — ask something below.
                </p>
              ) : (
                [...communityThreads].reverse().map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedThreadId(t.id)}
                    className={`block w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                      dark ? 'border-slate-700/50 bg-white/5 hover:bg-white/10 text-slate-100' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-400">
                      {t.name || 'Website visitor'}
                    </p>
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words">
                      {isVoiceNoteBody(t.message) ? (
                        <span className="inline-flex items-center gap-1 text-cyan-400"><Mic className="h-3 w-3" /> Voice message</span>
                      ) : t.message}
                    </p>
                    {t.replies.length > 0 && (
                      <p className={`mt-1 text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                        {t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}
                      </p>
                    )}
                  </button>
                ))
              )}
              </>
            ) : (
              <>
                {supportMessages.length === 0 && (
                  <p className={`mt-6 text-center text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                    Send us a message — a real person from the team will reply here.
                  </p>
                )}
                {supportMessages.map((m) => {
                  const isMe = m.sender_role !== 'dev';
                  return (
                    <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                          isMe
                            ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
                            : dark ? 'bg-white/5 text-slate-100' : 'bg-white text-slate-800 border border-slate-200'
                        }`}
                      >
                        {!isMe && <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-400">Team</p>}
                        <MessageBody text={m.body} className="whitespace-pre-wrap break-words" tint={isMe ? 'white' : 'cyan'} />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {needsGuestForm && channel !== 'cmms' && channel !== 'trust' && (
            <div className={`space-y-2 border-t px-3 py-2 ${dark ? 'border-slate-700/50' : 'border-slate-200'}`}>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={guestForm.name}
                  onChange={(e) => setGuestForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Your name"
                  className={`rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 ${
                    dark ? 'border-slate-700/50 bg-white/5 text-white placeholder:text-slate-500' : 'border-slate-200 bg-white text-slate-800'
                  }`}
                />
                <input
                  value={guestForm.email}
                  onChange={(e) => setGuestForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="Your email"
                  type="email"
                  className={`rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 ${
                    dark ? 'border-slate-700/50 bg-white/5 text-white placeholder:text-slate-500' : 'border-slate-200 bg-white text-slate-800'
                  }`}
                />
              </div>
              {guestFormError && <p className="text-[11px] text-red-400">{guestFormError}</p>}
            </div>
          )}

          {((channel === 'cmms' && !cmmsActiveContactId) || (channel === 'trust' && !trustActiveContactId)) ? (
            <div className={`border-t px-3 py-3 text-center text-xs ${dark ? 'border-slate-700/50 text-slate-500' : 'border-slate-200 text-slate-400'}`}>
              Select a person to start or continue a conversation.
            </div>
          ) : (
            <div className={`border-t px-3 py-3 ${dark ? 'border-slate-700/50' : 'border-slate-200'}`}>
              {(cmmsComposeError && channel === 'cmms') && <p className="mb-2 text-[11px] text-red-400">{cmmsComposeError}</p>}
              {(trustComposeError && channel === 'trust') && <p className="mb-2 text-[11px] text-red-400">{trustComposeError}</p>}
              {voiceError && <p className="mb-2 text-[11px] text-red-400">{voiceError}</p>}
              {channel === 'community' && selectedThread && (
                <div className={`mb-2 flex items-center justify-between gap-2 text-[11px] ${dark ? 'text-indigo-400' : 'text-indigo-600'}`}>
                  <span className="truncate">Replying to: "{selectedThread.message}"</span>
                  <button onClick={() => setSelectedThreadId(null)} className="flex-shrink-0 underline">Cancel</button>
                </div>
              )}
              <div className="flex items-center gap-2">
                {voicePhase === 'recording' ? (
                  <div className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 ${dark ? 'border-red-500/30 bg-red-500/10' : 'border-red-300 bg-red-50'}`}>
                    <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-red-500" />
                    <span className="flex-shrink-0 text-xs font-mono tabular-nums text-red-400">{formatVoiceDuration(voiceElapsed)}</span>
                    <span className={`flex-1 truncate text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Recording voice note…</span>
                    <button onClick={cancelVoiceRecording} className="flex-shrink-0 rounded-full p-1 hover:bg-black/10" title="Cancel">
                      <Trash2 className="h-4 w-4 text-slate-400" />
                    </button>
                  </div>
                ) : (
                  <textarea
                    value={draft}
                    onChange={handleDraftChange}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      channel === 'cmms'
                        ? `Message ${cmmsActiveContactId === ALL_CMMS_RECIPIENTS ? 'all CMMS employees' : (cmmsRecipients.find((m) => m.id === cmmsActiveContactId)?.name || 'this teammate')}...`
                        : channel === 'trust'
                        ? `Message ${trustActiveContactId === ALL_TRUST_MEMBERS ? 'the group' : (trustMembers.find((m) => m.user_id === trustActiveContactId)?.name || 'this member')}...`
                        : channel === 'community'
                        ? (selectedThreadId ? 'Write a reply…' : 'Ask something publicly…')
                        : 'Type your message…'
                    }
                    rows={1}
                    className={`max-h-36 min-h-9 flex-1 resize-none overflow-y-auto rounded-xl border px-3 py-2 text-sm outline-none focus:border-indigo-500 ${
                      dark ? 'border-slate-700/50 bg-white/5 text-white placeholder:text-slate-500' : 'border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  />
                )}
                {channel === 'community' && communityLive.canBroadcast && voicePhase === 'idle' && (
                  <button
                    onClick={communityLive.goLive}
                    className="flex h-9 flex-shrink-0 items-center gap-1 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 px-3 text-xs font-semibold text-white shadow-lg transition"
                    title="Go live to Community"
                  >
                    <Radio className="h-3.5 w-3.5" /> Live
                  </button>
                )}
                {voicePhase === 'recording' ? (
                  <button
                    onClick={stopAndSendVoiceRecording}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg transition"
                    title="Stop and send"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                ) : voicePhase === 'uploading' ? (
                  <button disabled className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white opacity-60 shadow-lg">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </button>
                ) : draft.trim() ? (
                  <button
                    onClick={handleSend}
                    disabled={sending}
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-lg transition disabled:opacity-40 bg-gradient-to-br ${channel === 'trust' ? 'from-amber-500 to-orange-600' : 'from-indigo-500 to-purple-600'}`}
                  >
                    <Send className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    onClick={startVoiceRecording}
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-lg transition bg-gradient-to-br ${channel === 'trust' ? 'from-amber-500 to-orange-600' : 'from-indigo-500 to-purple-600'}`}
                    title="Record a voice note"
                  >
                    <Mic className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!open && call.callState === 'ringing-in' && (
        <div className={`absolute bottom-full right-0 mb-2 flex w-56 animate-bounce items-center gap-2 rounded-2xl border px-3 py-2 shadow-2xl ${dark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
            {call.isVideo ? <Video className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
          </span>
          <span className={`min-w-0 flex-1 truncate text-xs font-medium ${dark ? 'text-slate-100' : 'text-slate-800'}`}>{call.peerName || 'Someone'} is calling</span>
          <button onClick={call.declineCall} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-white" title="Decline"><X className="h-3.5 w-3.5" /></button>
          <button onClick={() => { handleOpen(); call.acceptCall(); }} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white" title="Accept"><Phone className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {!fullScreen && <button
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => {
          if (dragMovedRef.current) { dragMovedRef.current = false; return; }
          if (!dragRef.current && !dragging) (open ? setOpen(false) : handleOpen());
        }}
        className={`relative flex h-14 w-14 touch-none items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-600 to-slate-800 text-white shadow-2xl transition hover:scale-105 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        title="Chat with us"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        <GripVertical className="pointer-events-none absolute -right-1 -bottom-1 h-3.5 w-3.5 rounded-full bg-slate-900/50 p-0.5 text-white/80" />
        {!open && supportUnread && (
          <span className="absolute -top-1 -right-1 h-4 w-4 animate-pulse rounded-full border-2 border-white bg-red-500" />
        )}
      </button>
      }
    </div>
    </>
  );
};

export default ChatWidget;
