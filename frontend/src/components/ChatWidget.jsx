import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, X, Send, Headphones, Globe, ThumbsUp, Briefcase, Shield, ArrowLeft, Radio, Expand, Minimize, GripVertical, Mic, Trash2, Loader2, Phone, Video } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import VoiceNotePlayer from './voice/VoiceNotePlayer';
import VoiceNoteRetentionPrompt from './voice/VoiceNoteRetentionPrompt';
import CallDock from './calls/CallDock';
import CallStage from './calls/CallStage';
import IncomingCallOverlay from './calls/IncomingCallOverlay';
import LiveBoardroom from './LiveBoardroom';
import CommunityLiveStage from './community/CommunityLiveStage';
import CommunityLiveBanner from './community/CommunityLiveBanner';
import { useDirectCall } from '../hooks/useDirectCall';
import { useCommunityLive } from '../hooks/useCommunityLive';
import { uploadVoiceNote, linkVoiceNoteMessages } from '../services/voiceNoteService';
import { getAudioNotificationService } from '../services/audioNotificationService';
import { getCustomRingtone, setCustomRingtone } from '../services/ringtoneService';
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
  const [cmmsSelfId, setCmmsSelfId] = useState('');
  const [cmmsActiveContactId, setCmmsActiveContactId] = useState('');
  const [cmmsConversation, setCmmsConversation] = useState([]);
  const [cmmsConversationLoading, setCmmsConversationLoading] = useState(false);
  const [cmmsComposeError, setCmmsComposeError] = useState('');

  // Group ("call all members") calling reuses the same multi-person mesh
  // engine as TrustSystem's "Boardroom" button (see LiveBoardroom.jsx)
  // instead of the 1:1 useDirectCall hook, which can only ever have two
  // participants. null = closed; otherwise { context, groupId, groupName,
  // members, creatorId } describing which room to open.
  const [boardroom, setBoardroom] = useState(null);

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

  const [ringtoneName, setRingtoneName] = useState('');

  // Load whatever ringtone the user picked on a past visit (see
  // IncomingCallOverlay) and hand it to the shared audio service so the very
  // next incoming call already rings with it.
  useEffect(() => {
    let cancelled = false;
    getCustomRingtone().then((ringtone) => {
      if (cancelled || !ringtone) return;
      getAudioNotificationService().setCustomRingtoneUrl(ringtone.url);
      setRingtoneName(ringtone.name);
    });
    return () => { cancelled = true; };
  }, []);

  const handlePickRingtone = async (file) => {
    try {
      const ringtone = await setCustomRingtone(file);
      if (ringtone) {
        getAudioNotificationService().setCustomRingtoneUrl(ringtone.url);
        setRingtoneName(ringtone.name);
      }
    } catch (err) {
      console.error('[ChatWidget] failed to save custom ringtone:', err);
    }
  };

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
      setCmmsRecipients([]);
      setCmmsSelfId('');
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
        // fn_get_company_users returns every active member of the company,
        // self included — cmms_users.id is its own uuid (resolved server-side
        // by email, not auth.uid()/profiles.id), so this is the only place
        // that tells us the current user's id in that space. Pull it out
        // before filtering self out of the pick-a-contact list.
        const cmmsUsers = usersResult.success ? (usersResult.data || []) : [];
        const selfCmmsUser = cmmsUsers.find((user) => user.email?.toLowerCase() === identity?.email?.toLowerCase());
        setCmmsSelfId(selfCmmsUser?.id || '');
        setCmmsRecipients(cmmsUsers.filter((user) => user.id !== selfCmmsUser?.id));
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

  // One card per author in the Community list instead of one per post — a
  // prolific poster no longer pushes everyone else's questions off screen.
  // user_id identifies a logged-in author across posts; a guest has no id,
  // so name+email stands in (imperfect, but the best guest identity this
  // board has — matches how the reply/like code treats guests elsewhere).
  const communityAuthorKey = (m) => m.user_id || `guest:${(m.email || '').trim().toLowerCase()}:${(m.name || '').trim().toLowerCase()}`;
  const communityMessagesByAuthor = useMemo(() => {
    const map = new Map();
    // communityThreads is newest-first (see fetchPublicThreads), so each
    // author's bucket ends up newest-first too — index 0 is their "current".
    communityThreads.forEach((m) => {
      const key = communityAuthorKey(m);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    });
    return map;
  }, [communityThreads]);
  // Oldest-author-activity-first, matching the existing feed's layout (it
  // scrolls to the bottom, so the newest is the one already in view).
  const groupedCommunityFeed = useMemo(
    () => [...communityMessagesByAuthor.values()].map((msgs) => ({ current: msgs[0], earlier: msgs.slice(1) })).reverse(),
    [communityMessagesByAuthor]
  );
  const selectedAuthorEarlierMessages = selectedThread
    ? (communityMessagesByAuthor.get(communityAuthorKey(selectedThread)) || []).filter((m) => m.id !== selectedThread.id)
    : [];
  const [showAuthorHistory, setShowAuthorHistory] = useState(false);
  useEffect(() => { setShowAuthorHistory(false); }, [selectedThreadId]);

  const trustActiveConversation = trustActiveContactId && trustActiveContactId !== ALL_TRUST_MEMBERS
    ? trustMessages.filter((m) => m.user_id === identity?.authId || m.user_id === trustActiveContactId)
    : trustActiveContactId === ALL_TRUST_MEMBERS ? trustMessages : [];

  // Each channel gets its own always-on call listener, bound to *my own*
  // stable "personal inbox" room — never to who I currently have selected as
  // a contact, and never to which tab happens to be open. That's what makes
  // a CMMS/Trust call actually reach someone: they're reachable the instant
  // they have access, not only while they happen to be staring at that exact
  // 1:1 conversation. A caller then dials straight into the callee's own
  // inbox room via `startCall`'s `dialRoomId` (see useDirectCall.js).
  const selfName = identity?.name || 'Guest';
  const supportSelfId = identity?.userId || identity?.authId || guestLikeKey;
  const supportRoomId = supportConvId ? `support:${supportConvId}` : null;
  const supportCall = useDirectCall({ roomId: supportRoomId, selfId: supportSelfId, selfName });

  const communityRoomId = (identity && !identity.isGuest && identity.authId) ? `community:${identity.authId}` : null;
  const communityCall = useDirectCall({ roomId: communityRoomId, selfId: identity?.authId || null, selfName });

  const cmmsRoomId = (hasCmmsAccess && cmmsSelfId) ? `cmms:${cmmsCompanyId}:${cmmsSelfId}` : null;
  const cmmsCall = useDirectCall({ roomId: cmmsRoomId, selfId: cmmsSelfId || null, selfName });

  const trustRoomId = (hasTrustAccess && identity?.authId) ? `trust:${trustGroupId}:${identity.authId}` : null;
  const trustCall = useDirectCall({ roomId: trustRoomId, selfId: identity?.authId || null, selfName });

  const callInstances = { support: supportCall, community: communityCall, cmms: cmmsCall, trust: trustCall };
  const callChannelKeys = ['cmms', 'trust', 'community', 'support'];
  // Only one call can realistically be happening at once — whichever
  // instance is ringing (or, failing that, active) drives the shared
  // overlay/dock/stage; otherwise fall back to whichever channel tab is
  // open so its call button correctly shows as available.
  const ringingChannel = callChannelKeys.find((key) => callInstances[key].callState === 'ringing-in');
  const activeChannel = ringingChannel || callChannelKeys.find((key) => callInstances[key].callState !== 'idle');
  const call = callInstances[activeChannel || channel] || supportCall;

  const callCommunityContact = (video) => {
    if (!selectedThread || selectedThread.user_id === identity?.authId) return;
    communityCall.startCall(video, selectedThread.name || 'Member', `community:${selectedThread.user_id}`);
  };
  const callCmmsContact = (video) => {
    if (!cmmsActiveContactId) return;
    if (cmmsActiveContactId === ALL_CMMS_RECIPIENTS) {
      if (cmmsRecipients.length < 2) return;
      setBoardroom({
        context: 'cmms',
        groupId: `cmms-${cmmsCompanyId}`,
        groupName: 'CMMS Team',
        members: cmmsRecipients.map((m) => ({ id: m.id, email: m.email || m.name })),
        creatorId: null,
      });
      return;
    }
    const peerNameHint = cmmsRecipients.find((m) => m.id === cmmsActiveContactId)?.name || 'Teammate';
    cmmsCall.startCall(video, peerNameHint, `cmms:${cmmsCompanyId}:${cmmsActiveContactId}`);
  };
  const callTrustContact = (video) => {
    if (!trustActiveContactId) return;
    if (trustActiveContactId === ALL_TRUST_MEMBERS) {
      if (trustMembers.length < 2) return;
      // Members prop deliberately omitted: trustMembers here has no email
      // (see loadTrustFeed above), so LiveBoardroom's own trust_group_members
      // + profiles lookup (its fallback when `members` is empty) resolves
      // real names — the same query TrustSystem.jsx's Boardroom relies on.
      // Same groupId as TrustSystem's Boardroom button, so both entry points
      // join the same live call.
      setBoardroom({
        context: 'trust',
        groupId: trustGroupId,
        groupName: trustGroupName,
        members: [],
        creatorId: null,
      });
      return;
    }
    const peerNameHint = trustMembers.find((m) => m.user_id === trustActiveContactId)?.name || 'Member';
    trustCall.startCall(video, peerNameHint, `trust:${trustGroupId}:${trustActiveContactId}`);
  };

  const handleAcceptCall = () => {
    handleOpen();
    if (ringingChannel) {
      setChannel(ringingChannel);
      if (ringingChannel === 'cmms' && call.peerId) setCmmsActiveContactId(call.peerId);
      if (ringingChannel === 'trust' && call.peerId) setTrustActiveContactId(call.peerId);
    }
    call.acceptCall();
  };

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

  // CommunityLiveStage renders `fixed inset-0` meaning to cover the whole
  // screen, but the non-fullscreen widget panel below has a CSS `transform`
  // (`-translate-x-1/2 -translate-y-1/2`, for centering) — and a transformed
  // ancestor becomes the containing block for any `position: fixed`
  // descendant. Left alone, that traps the "full-screen" live stage inside
  // the small ~22rem widget box instead of the real viewport, leaving the
  // app's own header/bottom-nav visible around it. Forcing the widget itself
  // into fullscreen (which drops that transform) sidesteps the trap.
  const wasFullScreenBeforeLiveRef = useRef(false);
  useEffect(() => {
    if (showCommunityLiveStage) {
      wasFullScreenBeforeLiveRef.current = fullScreen;
      if (!fullScreen) setFullScreen(true);
    } else if (!wasFullScreenBeforeLiveRef.current) {
      setFullScreen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCommunityLiveStage]);

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

  // Posts to the same public Community board (landing_messages) whether it's
  // typed in the normal Community tab or in the live-stream chat drawer
  // (CommunityLiveStage) — one board, reused everywhere instead of the live
  // stage growing its own separate chat storage.
  const postCommunityMessage = async (body, who, parentId) => {
    const senderAuthId = who.isGuest ? null : who.authId;
    const created = parentId
      ? await replyToLandingMessage({ parentId, name: who.name, email: who.email, authId: senderAuthId, message: body })
      : await createLandingMessage({ name: who.name, email: who.email, authId: senderAuthId, message: body, isPublic: true });
    setCommunityThreads(await fetchPublicThreads(50, { authId: senderAuthId, guestKey: guestLikeKey }));
    return created;
  };

  const [liveChatDraft, setLiveChatDraft] = useState('');
  const [liveChatSending, setLiveChatSending] = useState(false);
  const [liveChatError, setLiveChatError] = useState('');
  const handleSendLiveChat = async () => {
    const body = liveChatDraft.trim();
    if (!body || liveChatSending) return;
    const who = ensureIdentity();
    if (!who) { setLiveChatError(guestFormError || 'Enter your name and email in the Community tab to chat.'); return; }
    setLiveChatSending(true);
    setLiveChatError('');
    try {
      await postCommunityMessage(body, who, null);
      setLiveChatDraft('');
    } catch (err) {
      console.error('[ChatWidget] live chat send failed:', err);
      setLiveChatError('Could not send — try again.');
    } finally {
      setLiveChatSending(false);
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
        const created = await postCommunityMessage(body, who, selectedThreadId);
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
      {/* Forces itself over everything — open widget, closed widget, whatever
          tab/stage is showing — the instant a call rings in, WhatsApp-style.
          Accepting opens the widget too, so the active-call UI underneath
          (CallStage for video, CallDock for audio) isn't hidden behind a
          closed bubble the moment this overlay goes away. */}
      <IncomingCallOverlay
        call={call}
        onAccept={handleAcceptCall}
        onPickRingtone={handlePickRingtone}
        ringtoneName={ringtoneName}
      />
      {boardroom && (
        <div className="fixed inset-0 z-[1000] bg-black">
          <LiveBoardroom
            groupId={boardroom.groupId}
            groupName={boardroom.groupName}
            members={boardroom.members}
            creatorId={boardroom.creatorId}
            context={boardroom.context}
            onClose={() => setBoardroom(null)}
          />
        </div>
      )}
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
              {channel === 'support' && <CallButtons call={supportCall} onAudio={() => supportCall.startCall(false, 'Support team')} onVideo={() => supportCall.startCall(true, 'Support team')} onLight />}
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
          {showCommunityLiveStage && (
            <CommunityLiveStage
              live={communityLive}
              messages={communityThreads}
              onLike={handleLike}
              draft={liveChatDraft}
              onDraftChange={setLiveChatDraft}
              onSend={handleSendLiveChat}
              sending={liveChatSending}
              error={liveChatError}
            />
          )}

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
                    <CallButtons
                      call={cmmsActiveContactId === ALL_CMMS_RECIPIENTS ? { canCall: cmmsRecipients.length > 1 } : cmmsCall}
                      onAudio={() => callCmmsContact(false)}
                      onVideo={() => callCmmsContact(true)}
                      dark={dark}
                    />
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
                    <CallButtons
                      call={trustActiveContactId === ALL_TRUST_MEMBERS ? { canCall: trustMembers.length > 1 } : trustCall}
                      onAudio={() => callTrustContact(false)}
                      onVideo={() => callTrustContact(true)}
                      dark={dark}
                    />
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
                    <CallButtons call={selectedThread.user_id !== identity?.authId ? communityCall : null} onAudio={() => callCommunityContact(false)} onVideo={() => callCommunityContact(true)} dark={dark} />
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
                  {selectedAuthorEarlierMessages.length > 0 && (
                    <div className="mt-2">
                      <button
                        onClick={() => setShowAuthorHistory((v) => !v)}
                        className={`text-[11px] font-medium ${dark ? 'text-slate-400 hover:text-slate-300' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        {showAuthorHistory ? '▾' : '▸'} {selectedAuthorEarlierMessages.length} earlier {selectedAuthorEarlierMessages.length === 1 ? 'message' : 'messages'} from {selectedThread.name || 'them'}
                      </button>
                      {showAuthorHistory && (
                        <div className="mt-1.5 space-y-1.5">
                          {selectedAuthorEarlierMessages.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => setSelectedThreadId(m.id)}
                              className={`block w-full rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
                                dark ? 'border-slate-700/50 bg-white/5 hover:bg-white/10 text-slate-300' : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600'
                              }`}
                            >
                              <p className="line-clamp-2 whitespace-pre-wrap break-words">
                                {isVoiceNoteBody(m.message) ? 'Voice message' : m.message}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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
                groupedCommunityFeed.map(({ current: t, earlier }) => (
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
                    {(t.replies.length > 0 || earlier.length > 0) && (
                      <p className={`mt-1 text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                        {[
                          t.replies.length > 0 ? `${t.replies.length} ${t.replies.length === 1 ? 'reply' : 'replies'}` : null,
                          earlier.length > 0 ? `${earlier.length} earlier ${earlier.length === 1 ? 'message' : 'messages'}` : null,
                        ].filter(Boolean).join(' · ')}
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
