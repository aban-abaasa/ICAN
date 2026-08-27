import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Headphones, Globe, ThumbsUp, Briefcase, Expand, Minimize, GripVertical } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
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

const dedupe = (list, item) => (list.some((m) => m.id === item.id) ? list : [...list, item]);
const oldestFirst = (messages = []) => [...messages].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
const WIDGET_POSITION_KEY = 'ican_chat_widget_position';
const ALL_CMMS_RECIPIENTS = '__all_cmms_employees__';

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
  const [cmmsRecipientId, setCmmsRecipientId] = useState('');
  const [cmmsComposeError, setCmmsComposeError] = useState('');

  const scrollRef = useRef(null);
  const openRef = useRef(open);
  const channelRef = useRef(channel);
  const dragRef = useRef(null);
  const dragMovedRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { channelRef.current = channel; }, [channel]);

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

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [supportMessages, communityThreads, selectedThreadId, open, channel]);

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

  const ensureIdentity = () => {
    if (identity) return identity;
    const name = guestForm.name.trim();
    const email = guestForm.email.trim();
    if (!name || !email) {
      setGuestFormError('Please enter your name and email so we can reply.');
      return null;
    }
    const guest = { name, email, isGuest: true };
    setGuestIdentity(guest);
    setIdentity(guest);
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

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;

    const who = ensureIdentity();
    if (!who) return;

    setSending(true);
    try {
      if (channel === 'cmms') {
        if (!cmmsRecipientId) {
          setCmmsComposeError('Choose a CMMS member before sending.');
          return;
        }
        const recipientIds = cmmsRecipientId === ALL_CMMS_RECIPIENTS
          ? cmmsRecipients.map((member) => member.id)
          : [cmmsRecipientId];
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
        const messagesResult = await cmmsMessagingService.getUserMessages(cmmsCompanyId);
        if (messagesResult.success) setCmmsMessages(oldestFirst(messagesResult.data));
      } else if (channel === 'community') {
        const senderAuthId = who.isGuest ? null : who.authId;
        if (selectedThreadId) {
          await replyToLandingMessage({ parentId: selectedThreadId, name: who.name, email: who.email, authId: senderAuthId, message: body });
        } else {
          await createLandingMessage({ name: who.name, email: who.email, authId: senderAuthId, message: body, isPublic: true });
        }
        setCommunityThreads(await fetchPublicThreads(50, { authId: senderAuthId, guestKey: guestLikeKey }));
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
      }
      setDraft('');
    } catch (err) {
      console.error('[ChatWidget] send failed:', err);
      if (channel === 'cmms') setCmmsComposeError(err.message || 'Unable to send CMMS message.');
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

  const handleDraftChange = (event) => {
    setDraft(event.target.value);
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 144)}px`;
  };

  if (hidden || !identityReady) return null;

  const needsGuestForm = !identity;

  return (
    <div className="fixed z-[999]" style={fullScreen ? undefined : { left: position.left, top: position.top }}>
      {open && (
        <div
          className={`${fullScreen ? 'fixed inset-0 h-[100dvh] w-full rounded-none' : 'fixed left-1/2 top-1/2 h-[min(28rem,calc(100dvh-2rem))] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl'} flex flex-col overflow-hidden border shadow-2xl ${
            dark ? 'border-slate-700/50 bg-slate-950' : 'border-slate-200 bg-white'
          }`}
        >
          <div className={`flex items-center justify-between bg-gradient-to-r from-indigo-500 via-purple-600 to-slate-800 px-4 text-white ${channel === 'cmms' ? 'py-2' : 'py-3'}`}>
            <div>
              <p className="text-sm font-semibold">{channel === 'community' ? 'Community' : channel === 'cmms' ? 'CMMS' : 'ICAN Support'}</p>
              {channel !== 'cmms' && <p className="text-[11px] text-white/80">
                {channel === 'community' ? 'Public Q&A — everyone can read this' : 'We usually reply within a few minutes'}
              </p>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setFullScreen((value) => !value)} className="rounded-lg p-1.5 hover:bg-white/20 transition" title={fullScreen ? 'Exit full screen' : 'Open full screen'}>
                {fullScreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
              </button>
              <button onClick={() => { setOpen(false); setFullScreen(false); }} className="rounded-lg p-1.5 hover:bg-white/20 transition" title="Close"><X className="h-4 w-4" /></button>
            </div>
          </div>

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
          </div>

          <div ref={scrollRef} className={`flex-1 space-y-2 overflow-y-auto px-3 py-3 ${dark ? 'bg-slate-950' : 'bg-slate-50'}`}>
            {channel === 'cmms' ? (
              cmmsLoading && cmmsMessages.length === 0 && cmmsTasks.length === 0 ? (
                <p className={`mt-6 text-center text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Loading your CMMS work feed...</p>
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
                    <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Messages</p>
                    {cmmsMessages.length === 0 ? <p className={`rounded-xl border px-3 py-2 text-xs ${dark ? 'border-slate-700/50 text-slate-500' : 'border-slate-200 text-slate-400'}`}>No CMMS messages yet.</p> : cmmsMessages.map((message) => {
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
                            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{message.message_text || message.body || ''}</p>
                            {message.created_at && <p className={`mt-1 text-right text-[10px] ${isOwnMessage ? 'text-white/70' : dark ? 'text-slate-500' : 'text-slate-400'}`}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                </>
              )
            ) : channel === 'community' ? (
              selectedThread ? (
                <>
                  <button
                    onClick={() => setSelectedThreadId(null)}
                    className={`mb-1 text-[11px] font-medium ${dark ? 'text-indigo-400' : 'text-indigo-600'}`}
                  >
                    ← Back to Community
                  </button>
                  <div className={`rounded-xl px-3 py-2 text-sm ${dark ? 'bg-white/5 text-slate-100' : 'bg-white text-slate-800 border border-slate-200'}`}>
                    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-400">
                      {selectedThread.name || 'Website visitor'}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{selectedThread.message}</p>
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
                        {r.sender_role === 'dev' ? 'ICAN Team' : (r.name || 'Website visitor')}
                        {r.reward_reason && ' · 🪙'}
                      </p>
                      <p className="whitespace-pre-wrap break-words">{r.message}</p>
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
                communityThreads.map((t) => (
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
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words">{t.message}</p>
                    {t.replies.length > 0 && (
                      <p className={`mt-1 text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                        {t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}
                      </p>
                    )}
                  </button>
                ))
              )
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
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {needsGuestForm && channel !== 'cmms' && (
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

          <div className={`border-t px-3 py-3 ${dark ? 'border-slate-700/50' : 'border-slate-200'}`}>
            {channel === 'cmms' && (
              <div className="mb-2">
                <label className={`mb-1 block text-[11px] font-medium ${dark ? 'text-slate-400' : 'text-slate-500'}`} htmlFor="cmms-message-recipient">Send to</label>
                <select
                  id="cmms-message-recipient"
                  value={cmmsRecipientId}
                  onChange={(event) => { setCmmsRecipientId(event.target.value); setCmmsComposeError(''); }}
                  className={`w-full rounded-lg border px-2.5 py-2 text-xs outline-none focus:border-indigo-500 ${dark ? 'border-slate-700/50 bg-white/5 text-white' : 'border-slate-200 bg-white text-slate-800'}`}
                >
                  <option value="">Choose a CMMS member</option>
                  {cmmsRecipients.length > 1 && <option value={ALL_CMMS_RECIPIENTS}>All CMMS employees</option>}
                  {cmmsRecipients.map((member) => <option key={member.id} value={member.id}>{member.name || member.full_name || member.email || 'CMMS member'}</option>)}
                </select>
                {cmmsComposeError && <p className="mt-1 text-[11px] text-red-400">{cmmsComposeError}</p>}
              </div>
            )}
            {channel === 'community' && selectedThread && (
              <div className={`mb-2 flex items-center justify-between gap-2 text-[11px] ${dark ? 'text-indigo-400' : 'text-indigo-600'}`}>
                <span className="truncate">Replying to: "{selectedThread.message}"</span>
                <button onClick={() => setSelectedThreadId(null)} className="flex-shrink-0 underline">Cancel</button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <textarea
                value={draft}
                onChange={handleDraftChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  channel === 'cmms'
                    ? 'Write a direct CMMS message...'
                    : channel === 'community'
                    ? (selectedThreadId ? 'Write a reply…' : 'Ask something publicly…')
                    : 'Type your message…'
                }
                rows={1}
                className={`max-h-36 min-h-9 flex-1 resize-none overflow-y-auto rounded-xl border px-3 py-2 text-sm outline-none focus:border-indigo-500 ${
                  dark ? 'border-slate-700/50 bg-white/5 text-white placeholder:text-slate-500' : 'border-slate-200 bg-slate-50 text-slate-800'
                }`}
              />
              <button
                onClick={handleSend}
                disabled={sending || !draft.trim()}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg transition disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
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
  );
};

export default ChatWidget;
