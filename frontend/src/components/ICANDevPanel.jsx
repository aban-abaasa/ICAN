import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, LogOut, RefreshCw, Moon, Sun, Users, Zap, TrendingUp,
  Building2, Briefcase, Search, Gift, BarChart3, Star,
  Lock, Database, Hash, CreditCard, ToggleLeft, ToggleRight,
  CheckCircle, Copy, Activity, Layers, Clock, AlertTriangle,
  Network, Wallet, ArrowUp, ArrowDown, Eye, EyeOff, ShieldCheck,
  MessageCircle, Globe, Trash2, Send, Mail,
} from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase/client';
import {
  devListAllLandingMessages,
  devDeleteLandingMessage,
  devReplyToLandingMessage,
  devMarkCorrectAnswer,
  devGrantLandingBonus,
} from '../services/landingMessagesService';
import {
  listConversations,
  fetchMessages as fetchChatMessages,
  sendMessage as sendChatMessage,
  markConversationRead,
  subscribeToAllConversations,
  subscribeToMessages as subscribeToChatMessages,
} from '../services/chatService';

export const SESSION_KEY = 'ican_dev_panel_auth';
const DEV_TOKEN   = 'dev_ICAN_Pr0_KV25';
const ICAN_TO_UGX = 5000;

// Must match agentService.js / walletAccountService.js's hashPIN() exactly —
// PIN verification (process_cashout_with_pin etc.) compares against this
// salted hash, NOT plain base64. A mismatch here silently "wrong-PINs"
// every login attempt and re-locks the account.
const hashAgentPin = (pin) => {
  let hash = 0;
  const string = `pin-${pin}-salt-ican-hash`;
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return btoa(`hash-${Math.abs(hash)}-${pin.length}`);
};

// group_accounts uses a different salt/prefix (groupWalletAccountService.js's
// hashPIN) than personal user_accounts — must match exactly or every login
// after a dev-panel PIN reset "wrong-PIN"s and re-locks the group wallet.
const hashGroupPin = (pin) => {
  let hash = 0;
  const string = `pin-${pin}-salt-ican-group-hash`;
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return btoa(`group-hash-${Math.abs(hash)}-${pin.length}`);
};

// Country ISO-2 → currency code (mirrors ican_country_currency_map)
const COUNTRY_CURRENCY = {
  UG:'UGX',KE:'KES',TZ:'TZS',RW:'RWF',BI:'RWF',
  NG:'NGN',GH:'GHS',ET:'ETB',ZA:'ZAR',EG:'EGP',MA:'MAD',
  SN:'XOF',CI:'XOF',ML:'XOF',BF:'XOF',NE:'XOF',TG:'XOF',BJ:'XOF',
  CM:'XAF',GA:'XAF',CG:'XAF',
  US:'USD',CA:'CAD',BR:'BRL',MX:'MXN',
  GB:'GBP',CH:'CHF',SE:'SEK',NO:'NOK',DK:'SEK',
  DE:'EUR',FR:'EUR',IT:'EUR',ES:'EUR',NL:'EUR',BE:'EUR',PT:'EUR',
  AT:'EUR',FI:'EUR',GR:'EUR',IE:'EUR',PL:'EUR',CZ:'EUR',HU:'EUR',
  RO:'EUR',SK:'EUR',SI:'EUR',HR:'EUR',BG:'EUR',EE:'EUR',LV:'EUR',LT:'EUR',
  AE:'AED',SA:'SAR',QA:'AED',KW:'AED',BH:'AED',OM:'AED',
  IN:'INR',CN:'CNY',JP:'JPY',KR:'KRW',ID:'IDR',PH:'PHP',PK:'PKR',
  AU:'AUD',NZ:'NZD',
};

const PLANS = ['basic', 'pro', 'enterprise'];
const PLAN_META = {
  basic:      { grad: 'from-slate-500 to-slate-600',   glow: '#64748b', price: 'Free'           },
  pro:        { grad: 'from-cyan-500 to-blue-600',     glow: '#06b6d4', price: 'UGX 50,000/mo'  },
  enterprise: { grad: 'from-violet-500 to-purple-600', glow: '#8b5cf6', price: 'UGX 120,000/mo' },
};
const PLAN_BADGE = {
  basic:      'bg-slate-500/15 text-slate-500 border-slate-400/30',
  pro:        'bg-cyan-500/15 text-cyan-600 border-cyan-500/30',
  enterprise: 'bg-violet-500/15 text-violet-600 border-violet-500/30',
};

const TABS = [
  { id: 'overview',   label: 'Overview',     Icon: BarChart3,   color: '#06b6d4' },
  { id: 'users',      label: 'Users',        Icon: Users,       color: '#8b5cf6' },
  { id: 'companies',  label: 'Companies',    Icon: Layers,      color: '#6366f1' },
  { id: 'businesses', label: 'Businesses',   Icon: Building2,   color: '#10b981' },
  { id: 'groups',     label: 'Trust Groups', Icon: ShieldCheck, color: '#f59e0b' },
  { id: 'agents',     label: 'Agents',       Icon: Briefcase,   color: '#f97316' },
  { id: 'recovery',   label: 'Recovery',     Icon: AlertTriangle, color: '#ef4444' },
  { id: 'blockchain', label: 'Blockchain',   Icon: Lock,        color: '#ec4899' },
  { id: 'plans',      label: 'Plans',        Icon: Star,        color: '#eab308' },
  { id: 'board',      label: 'Public Board', Icon: MessageCircle, color: '#14b8a6' },
  { id: 'messages',   label: 'Messages',     Icon: Mail,          color: '#0ea5e9' },
];

// CSS variable themes
const DARK_VARS = {
  '--dp-bg':       'linear-gradient(160deg,#07091a 0%,#0d1124 50%,#07091a 100%)',
  '--dp-hdr':      'rgba(7,9,26,0.94)',
  '--dp-hdr-bd':   'rgba(255,255,255,0.07)',
  '--dp-card':     'rgba(255,255,255,0.04)',
  '--dp-card-bd':  'rgba(255,255,255,0.08)',
  '--dp-inner':    'rgba(255,255,255,0.025)',
  '--dp-inner-bd': 'rgba(255,255,255,0.06)',
  '--dp-sep':      'rgba(255,255,255,0.06)',
  '--dp-input':    'rgba(255,255,255,0.06)',
  '--dp-input-bd': 'rgba(255,255,255,0.10)',
  '--dp-pill':     'rgba(255,255,255,0.06)',
  '--dp-pill-bd':  'rgba(255,255,255,0.10)',
  '--dp-txt':      '#ffffff',
  '--dp-sub':      '#94a3b8',
  '--dp-muted':    '#64748b',
  '--dp-track':    'rgba(255,255,255,0.10)',
};
const LIGHT_VARS = {
  '--dp-bg':       'linear-gradient(160deg,#f0f4ff 0%,#e8eeff 50%,#f0f4ff 100%)',
  '--dp-hdr':      'rgba(255,255,255,0.96)',
  '--dp-hdr-bd':   '#e2e8f0',
  '--dp-card':     '#ffffff',
  '--dp-card-bd':  '#e2e8f0',
  '--dp-inner':    '#f8fafc',
  '--dp-inner-bd': '#e2e8f0',
  '--dp-sep':      '#f1f5f9',
  '--dp-input':    '#ffffff',
  '--dp-input-bd': '#cbd5e1',
  '--dp-pill':     '#f1f5f9',
  '--dp-pill-bd':  '#e2e8f0',
  '--dp-txt':      '#0f172a',
  '--dp-sub':      '#475569',
  '--dp-muted':    '#94a3b8',
  '--dp-track':    '#e2e8f0',
};

const fmt      = n => Number(n || 0).toLocaleString();
const fmtI     = n => Number(n || 0).toFixed(2);
const fmtUGX   = i => 'UGX ' + (Number(i || 0) * ICAN_TO_UGX).toLocaleString();
const fmtDate  = d => d ? new Date(d).toLocaleDateString('en-UG', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const fmtTime  = d => d ? new Date(d).toLocaleString('en-UG', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
const pct      = (n, t) => t > 0 ? Math.min((Number(n)/Number(t))*100, 100) : 0;
const initials = n => (n||'').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('');
const truncHash= h => h ? h.slice(0,8)+'…'+h.slice(-6) : '—';

// ── Themed inline-style helpers ───────────────────────────────────────────────
const Card  = ({ children, style={}, className='' }) => (
  <div className={`rounded-2xl border p-4 transition-colors ${className}`}
    style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)', ...style }}>
    {children}
  </div>
);
const Inner = ({ children, style={}, className='' }) => (
  <div className={`rounded-xl border transition-colors ${className}`}
    style={{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)', ...style }}>
    {children}
  </div>
);
const Sep = ({ className='' }) => (
  <div className={`border-t ${className}`} style={{ borderColor:'var(--dp-sep)' }} />
);
const Txt   = ({ children, className='' }) => <span className={className} style={{ color:'var(--dp-txt)' }}>{children}</span>;
const Sub   = ({ children, className='' }) => <span className={className} style={{ color:'var(--dp-sub)' }}>{children}</span>;
const Muted = ({ children, className='' }) => <span className={className} style={{ color:'var(--dp-muted)' }}>{children}</span>;

const Skel = ({ h='h-16', cls='' }) => (
  <div className={`rounded-2xl animate-pulse ${h} ${cls}`} style={{ background:'var(--dp-inner)' }} />
);

const AVATAR_COLORS = ['#06b6d4','#8b5cf6','#10b981','#f59e0b','#f97316','#ec4899','#6366f1'];
const Avatar = ({ name, color, size=36 }) => {
  const safeName = name || '';
  const bg = color || AVATAR_COLORS[(safeName.charCodeAt(0)||0) % AVATAR_COLORS.length];
  return (
    <div className="flex-shrink-0 flex items-center justify-center rounded-xl font-bold text-white text-xs select-none"
      style={{ width:size, height:size, background:`linear-gradient(135deg,${bg}dd,${bg}88)`, boxShadow:`0 2px 8px ${bg}44` }}>
      {initials(safeName)||'?'}
    </div>
  );
};

const Badge = ({ label, cls='' }) => (
  <span className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[10px] font-bold capitalize tracking-wide ${cls}`}>{label}</span>
);

const PBar = ({ val, color='#06b6d4' }) => (
  <div className="h-1 rounded-full overflow-hidden" style={{ background:'var(--dp-track)' }}>
    <div className="h-full rounded-full transition-all duration-700" style={{ width:`${val}%`, background:`linear-gradient(90deg,${color}88,${color})` }} />
  </div>
);

const GlowDot = ({ color='#10b981' }) => (
  <span className="relative flex h-2 w-2">
    <span className="animate-ping absolute h-full w-full rounded-full opacity-75" style={{ background:color }} />
    <span className="relative h-2 w-2 rounded-full" style={{ background:color }} />
  </span>
);

const ValueChip = ({ ican }) => (
  <div className="text-right flex-shrink-0">
    <p className="text-sm font-black text-cyan-500 leading-none">{fmtI(ican)}</p>
    <p className="text-[9px] mt-0.5" style={{ color:'var(--dp-muted)' }}>ICAN · {fmtUGX(ican)}</p>
  </div>
);

const EmptyState = ({ msg, hint, Icon: Ic=Database }) => (
  <div className="flex flex-col items-center justify-center py-20 gap-3">
    <div className="h-14 w-14 rounded-2xl border flex items-center justify-center"
      style={{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)' }}>
      <Ic size={22} style={{ color:'var(--dp-muted)' }} />
    </div>
    <p className="text-sm" style={{ color:'var(--dp-sub)' }}>{msg}</p>
    {hint && <p className="text-[11px] max-w-xs text-center" style={{ color:'var(--dp-muted)' }}>{hint}</p>}
  </div>
);

const CopyBtn = ({ text }) => {
  const [done, setDone] = useState(false);
  const doCopy = async () => {
    await navigator.clipboard.writeText(text||'').catch(()=>{});
    setDone(true); setTimeout(()=>setDone(false), 1400);
  };
  return (
    <button onClick={doCopy} className="rounded-lg p-1.5 border transition-all hover:border-cyan-500/40 hover:text-cyan-500"
      style={{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)', color:'var(--dp-muted)' }}>
      {done ? <CheckCircle size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  );
};

const StatCard = ({ Icon, label, value, sub, color='#06b6d4', loading }) => (
  <div className="relative rounded-2xl border p-5 overflow-hidden transition-colors group"
    style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
      style={{ background:`radial-gradient(ellipse at top left,${color}0a,transparent 65%)` }} />
    {loading ? <Skel h="h-7 w-24" cls="mb-2" /> : (
      <p className="text-3xl font-black leading-none" style={{ color:'var(--dp-txt)' }}>{value}</p>
    )}
    <p className="mt-1.5 text-[10px] uppercase tracking-widest font-semibold" style={{ color:'var(--dp-muted)' }}>{label}</p>
    {sub && <p className="mt-0.5 text-xs" style={{ color:'var(--dp-sub)' }}>{sub}</p>}
    <div className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl"
      style={{ background:`${color}18`, border:`1px solid ${color}30` }}>
      <Icon size={16} style={{ color }} />
    </div>
  </div>
);

// ─── Public landing-page message board (moderation) ────────────────────────
const fmtChatTime = (d) => {
  if (!d) return '';
  const date = new Date(d);
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return date.toLocaleDateString();
};

const MessagesTab = () => {
  const [conversations, setConversations] = useState([]);
  const [selectedId,    setSelectedId]    = useState(null);
  const [messages,      setMessages]      = useState([]);
  const [reply,         setReply]         = useState('');
  const [sending,       setSending]       = useState(false);
  const scrollRef = useRef(null);

  const refresh = useCallback(async () => {
    setConversations(await listConversations());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    return subscribeToAllConversations((payload) => {
      const row = payload.new;
      if (!row || row.kind === 'team') return;
      setConversations(prev =>
        [row, ...prev.filter(c => c.id !== row.id)]
          .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
      );
    });
  }, []);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      const msgs = await fetchChatMessages(selectedId);
      if (cancelled) return;
      setMessages(msgs);
      await markConversationRead(selectedId, 'dev');
      setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, unread_by_dev: false } : c));
    })();
    const unsub = subscribeToChatMessages(selectedId, (msg) => {
      setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
    });
    return () => { cancelled = true; unsub(); };
  }, [selectedId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const selected = conversations.find(c => c.id === selectedId);

  const handleReply = async () => {
    const body = reply.trim();
    if (!body || !selectedId || sending) return;
    setSending(true);
    try {
      const msg = await sendChatMessage(selectedId, { senderRole: 'dev', senderName: 'ICAN Team', body });
      setMessages(prev => [...prev, msg]);
      setReply('');
    } catch (e) {
      console.warn('[MessagesTab] reply failed:', e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="rounded-2xl border overflow-hidden" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
        <div className="px-4 py-3 border-b text-xs font-bold uppercase tracking-wider" style={{ color:'var(--dp-muted)', borderColor:'var(--dp-sep)' }}>
          Conversations ({conversations.length})
        </div>
        <div className="max-h-[65vh] overflow-y-auto">
          {conversations.map(c => (
            <button key={c.id} onClick={() => setSelectedId(c.id)}
              className="w-full border-b last:border-0 px-4 py-3 text-left transition"
              style={{ borderColor:'var(--dp-sep)', background: selectedId === c.id ? 'rgba(20,184,166,0.10)' : 'transparent' }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold truncate" style={{ color:'var(--dp-txt)' }}>{c.guest_name || c.role || 'Guest'}</p>
                {c.unread_by_dev && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />}
              </div>
              <p className="text-xs truncate" style={{ color:'var(--dp-muted)' }}>{c.guest_email}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize"
                  style={{ borderColor:'var(--dp-inner-bd)', background:'var(--dp-inner)', color:'var(--dp-sub)' }}>{c.portal}</span>
                <span className="text-[10px]" style={{ color:'var(--dp-muted)' }}>{fmtChatTime(c.last_message_at)}</span>
              </div>
              {c.last_message_preview && <p className="mt-1 truncate text-xs" style={{ color:'var(--dp-muted)' }}>{c.last_message_preview}</p>}
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="px-4 py-10 text-center text-sm" style={{ color:'var(--dp-muted)' }}>No conversations yet.</p>
          )}
        </div>
      </div>

      <div className="flex flex-col overflow-hidden rounded-2xl border" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm" style={{ color:'var(--dp-muted)' }}>
            <div className="text-center">
              <MessageCircle className="mx-auto mb-2 h-8 w-8 opacity-40" />
              Select a conversation to reply
            </div>
          </div>
        ) : (
          <>
            <div className="border-b px-4 py-3" style={{ borderColor:'var(--dp-sep)' }}>
              <p className="text-sm font-semibold" style={{ color:'var(--dp-txt)' }}>{selected.guest_name || 'Guest'}</p>
              <p className="text-xs" style={{ color:'var(--dp-muted)' }}>{selected.guest_email} · {selected.portal}</p>
            </div>
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3" style={{ maxHeight: '48vh' }}>
              {messages.map(m => {
                const fromDev = m.sender_role === 'dev';
                return (
                  <div key={m.id} className={`flex ${fromDev ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[75%] rounded-2xl px-3 py-2 text-sm"
                      style={fromDev
                        ? { background:'linear-gradient(135deg,#14b8a6,#0f766e)', color:'#fff' }
                        : { background:'var(--dp-inner)', color:'var(--dp-txt)' }}>
                      {!fromDev && (
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color:'var(--dp-muted)' }}>
                          {m.sender_name || selected.role}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 border-t px-3 py-3" style={{ borderColor:'var(--dp-sep)' }}>
              <input value={reply} onChange={e => setReply(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleReply(); }}
                placeholder="Reply as ICAN Team…"
                className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none transition"
                style={{ background:'var(--dp-input)', borderColor:'var(--dp-input-bd)', color:'var(--dp-txt)' }} />
              <button onClick={handleReply} disabled={sending || !reply.trim()}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-white transition disabled:opacity-40"
                style={{ background:'linear-gradient(135deg,#14b8a6,#0f766e)' }}>
                <Send size={14} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const PublicBoardTab = () => {
  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replying,   setReplying]   = useState(false);
  const [markingId,  setMarkingId]  = useState(null);
  const [markError,  setMarkError]  = useState('');
  const [grantTargetId, setGrantTargetId] = useState(null);
  const [grantAmount,   setGrantAmount]   = useState('');
  const [grantingId,    setGrantingId]    = useState(null);
  const [grantError,    setGrantError]    = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await devListAllLandingMessages(DEV_TOKEN));
    } catch (e) {
      console.warn('[PublicBoardTab] failed to load messages:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (id) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await devDeleteLandingMessage(DEV_TOKEN, id);
      if (expandedId === id) setExpandedId(null);
      await refresh();
    } catch (e) {
      console.warn('[PublicBoardTab] failed to delete message:', e);
    } finally {
      setDeletingId(null);
    }
  };

  const handleReply = async (id) => {
    const body = replyDraft.trim();
    if (!body || replying) return;
    setReplying(true);
    try {
      await devReplyToLandingMessage(DEV_TOKEN, id, body, 'ICAN Team');
      setReplyDraft('');
      await refresh();
    } catch (e) {
      console.warn('[PublicBoardTab] failed to reply:', e);
    } finally {
      setReplying(false);
    }
  };

  const handleMarkCorrect = async (id) => {
    if (markingId) return;
    setMarkingId(id);
    setMarkError('');
    try {
      await devMarkCorrectAnswer(DEV_TOKEN, id);
      await refresh();
    } catch (e) {
      console.warn('[PublicBoardTab] failed to mark correct answer:', e);
      setMarkError(e?.message || 'Failed to mark as correct answer.');
    } finally {
      setMarkingId(null);
    }
  };

  const handleOpenGrant = (id) => {
    setGrantTargetId(prev => (prev === id ? null : id));
    setGrantAmount('');
    setGrantError('');
  };

  const handleGrant = async (item) => {
    const amt = parseFloat(grantAmount);
    if (!amt || amt <= 0 || grantingId) return;
    setGrantingId(item.id);
    setGrantError('');
    try {
      await devGrantLandingBonus(DEV_TOKEN, item.user_id, amt, 'Manual grant from Public Board');
      setGrantTargetId(null);
      setGrantAmount('');
      await refresh();
    } catch (e) {
      console.warn('[PublicBoardTab] failed to grant bonus:', e);
      setGrantError(e?.message || 'Failed to grant ICAN.');
    } finally {
      setGrantingId(null);
    }
  };

  const topLevel = items.filter(m => !m.parent_id);

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm font-black" style={{ color:'var(--dp-txt)' }}>
          Landing page messages <span style={{ color:'var(--dp-muted)' }}>({topLevel.length})</span>
        </p>
        <button onClick={refresh} disabled={loading}
          className="rounded-lg p-1.5 border transition disabled:opacity-40"
          style={{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)', color:'var(--dp-sub)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/>
        </button>
      </div>

      {loading && [1,2,3].map(i => <Skel key={i} h="h-20"/>)}

      {topLevel.map(m => {
        const replies = items.filter(i => i.parent_id === m.id);
        const isExpanded = expandedId === m.id;
        return (
          <div key={m.id} className="rounded-2xl border p-4 transition-all" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
            <div className="flex items-start justify-between gap-3">
              <button onClick={() => { setExpandedId(isExpanded ? null : m.id); setReplyDraft(''); }} className="min-w-0 flex-1 text-left">
                <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                  <p className="font-bold" style={{ color:'var(--dp-txt)' }}>{m.name || 'Website visitor'}</p>
                  <span className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold"
                    style={m.is_public
                      ? { borderColor:'rgba(6,182,212,0.3)', background:'rgba(6,182,212,0.1)', color:'#06b6d4' }
                      : { borderColor:'rgba(245,158,11,0.3)', background:'rgba(245,158,11,0.1)', color:'#f59e0b' }}>
                    {m.is_public ? <Globe size={10}/> : <Lock size={10}/>}
                    {m.is_public ? 'Public' : 'Private'}
                  </span>
                  {m.origin_app && <Badge label={m.origin_app} cls="bg-slate-500/10 text-slate-400 border-slate-500/20"/>}
                  {m.reward_reason === 'popular' && <Badge label="🪙 Popular" cls="bg-amber-500/10 text-amber-400 border-amber-500/20"/>}
                  <span className="text-[10px]" style={{ color:'var(--dp-muted)' }}>{fmtTime(m.created_at)}</span>
                  {replies.length > 0 && (
                    <span className="text-[10px]" style={{ color:'var(--dp-muted)' }}>· {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                  )}
                </div>
                {m.email && <p className="text-xs truncate" style={{ color:'var(--dp-sub)' }}>{m.email}</p>}
                <p className="mt-1 whitespace-pre-wrap break-words text-sm" style={{ color:'var(--dp-sub)' }}>{m.message}</p>
              </button>
              <button onClick={() => handleDelete(m.id)} disabled={deletingId === m.id}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-40"
                title="Delete message">
                <Trash2 size={14}/>
              </button>
            </div>

            {isExpanded && (
              <div className="mt-3 space-y-2 border-l-2 pl-3" style={{ borderColor:'var(--dp-sep)' }}>
                {m.user_id && (
                  <div>
                    <button onClick={() => handleOpenGrant(m.id)}
                      className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition"
                      style={{ borderColor:'rgba(245,158,11,0.3)', background:'rgba(245,158,11,0.1)', color:'#f59e0b' }}>
                      <Gift size={11}/> Grant ICAN to {m.name || 'this poster'}
                    </button>
                    {grantTargetId === m.id && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <input type="number" min="0.01" step="0.01" value={grantAmount}
                          onChange={e => setGrantAmount(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleGrant(m); }}
                          placeholder="Amount"
                          className="w-24 rounded-lg border px-2 py-1 text-xs outline-none"
                          style={{ background:'var(--dp-input)', borderColor:'var(--dp-input-bd)', color:'var(--dp-txt)' }}/>
                        <button onClick={() => handleGrant(m)} disabled={grantingId === m.id || !grantAmount}
                          className="rounded-lg px-2.5 py-1 text-[10px] font-bold transition disabled:opacity-40"
                          style={{ background:'#f59e0b', color:'#1e1300' }}>
                          {grantingId === m.id ? 'Granting…' : 'Confirm'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {replies.map(r => (
                  <div key={r.id} className="flex items-start justify-between gap-2 rounded-lg px-3 py-2"
                    style={{ background: r.sender_role === 'dev' ? 'rgba(139,92,246,0.1)' : 'var(--dp-inner)' }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold" style={{ color:'var(--dp-txt)' }}>
                          {r.sender_role === 'dev' ? 'ICAN Team' : (r.name || 'Website visitor')}
                        </p>
                        {r.reward_reason && <Badge label="🪙 Correct answer" cls="bg-amber-500/10 text-amber-400 border-amber-500/20"/>}
                        <span className="text-[10px]" style={{ color:'var(--dp-muted)' }}>{fmtTime(r.created_at)}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm" style={{ color:'var(--dp-sub)' }}>{r.message}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {r.sender_role !== 'dev' && r.user_id && !r.rewarded_at && (
                          <button onClick={() => handleMarkCorrect(r.id)} disabled={markingId === r.id}
                            className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition disabled:opacity-40"
                            style={{ borderColor:'rgba(34,197,94,0.3)', background:'rgba(34,197,94,0.1)', color:'#4ade80' }}>
                            <CheckCircle size={11}/> {markingId === r.id ? 'Marking…' : 'Mark correct answer (+1 ICAN)'}
                          </button>
                        )}
                        {r.sender_role !== 'dev' && r.user_id && (
                          <button onClick={() => handleOpenGrant(r.id)}
                            className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition"
                            style={{ borderColor:'rgba(245,158,11,0.3)', background:'rgba(245,158,11,0.1)', color:'#f59e0b' }}>
                            <Gift size={11}/> Grant ICAN
                          </button>
                        )}
                      </div>
                      {grantTargetId === r.id && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <input type="number" min="0.01" step="0.01" value={grantAmount}
                            onChange={e => setGrantAmount(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleGrant(r); }}
                            placeholder="Amount"
                            className="w-24 rounded-lg border px-2 py-1 text-xs outline-none"
                            style={{ background:'var(--dp-input)', borderColor:'var(--dp-input-bd)', color:'var(--dp-txt)' }}/>
                          <button onClick={() => handleGrant(r)} disabled={grantingId === r.id || !grantAmount}
                            className="rounded-lg px-2.5 py-1 text-[10px] font-bold transition disabled:opacity-40"
                            style={{ background:'#f59e0b', color:'#1e1300' }}>
                            {grantingId === r.id ? 'Granting…' : 'Confirm'}
                          </button>
                        </div>
                      )}
                    </div>
                    <button onClick={() => handleDelete(r.id)} disabled={deletingId === r.id}
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-40"
                      title="Delete reply">
                      <Trash2 size={12}/>
                    </button>
                  </div>
                ))}
                {replies.length === 0 && <p className="text-xs" style={{ color:'var(--dp-muted)' }}>No replies yet.</p>}
                {markError && <p className="text-xs text-rose-400">{markError}</p>}
                {grantError && <p className="text-xs text-rose-400">{grantError}</p>}

                {m.is_public && (
                  <div className="flex items-center gap-2 pt-1">
                    <input value={replyDraft} onChange={e => setReplyDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleReply(m.id); }}
                      placeholder="Reply as ICAN Team…"
                      className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none transition"
                      style={{ background:'var(--dp-input)', borderColor:'var(--dp-input-bd)', color:'var(--dp-txt)' }}/>
                    <button onClick={() => handleReply(m.id)} disabled={replying || !replyDraft.trim()}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-white transition disabled:opacity-40"
                      style={{ background:'linear-gradient(135deg,#06b6d4,#0284c7)' }}>
                      <Send size={14}/>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!loading && topLevel.length === 0 && <EmptyState msg="No landing page messages yet." Icon={MessageCircle}/>}
    </>
  );
};

// =============================================================================
// RECOVERY — locked accounts / forgotten PINs, resolved here (no self-service)
// =============================================================================
const RecoveryTab = () => {
  const supabase = getSupabaseClient();
  const [requests,    setRequests]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [resolvingId, setResolvingId] = useState(null);
  const [pinDrafts,   setPinDrafts]   = useState({});
  const [error,       setError]       = useState(null);
  const [lastResolved, setLastResolved] = useState(null); // { requestId, pin }

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.rpc('ican_dev_get_recovery_requests', { dev_token: DEV_TOKEN });
    if (err) { console.warn('[Dev] ican_dev_get_recovery_requests:', err.message); setRequests([]); }
    else setRequests(data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { refresh(); }, [refresh]);

  const resolve = async (requestId, action) => {
    const pin = (pinDrafts[requestId] || '').trim();
    if (action === 'unlock' && pin && !/^\d{4}$/.test(pin)) {
      setError('New PIN must be exactly 4 digits, or leave it blank to keep the current PIN.');
      return;
    }
    const isGroupRequest = !!requests.find(r => r.request_id === requestId)?.group_id;
    setResolvingId(requestId);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc('ican_dev_resolve_recovery_request', {
        dev_token: DEV_TOKEN,
        p_request_id: requestId,
        p_action: action,
        p_new_pin_hash: pin ? (isGroupRequest ? hashGroupPin(pin) : hashAgentPin(pin)) : null,
        p_new_pin_plain: pin || null,
      });
      if (err) throw err;
      if (!data?.[0]?.success) throw new Error(data?.[0]?.message || 'Failed to resolve request');
      setLastResolved(action === 'unlock' && pin ? { requestId, pin } : null);
      setPinDrafts(prev => { const n = { ...prev }; delete n[requestId]; return n; });
      await refresh();
    } catch (e) {
      setError(e.message || 'Failed to resolve request');
    } finally {
      setResolvingId(null);
    }
  };

  const pending  = requests.filter(r => r.status === 'pending');
  const resolved = requests.filter(r => r.status !== 'pending');

  const RequestCard = (r) => (
    <div key={r.request_id} className="rounded-2xl border p-4" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold" style={{ color:'var(--dp-txt)' }}>
            {r.account_holder_name || 'Unknown'}{r.group_name ? ` · Group: ${r.group_name}` : ''}
          </p>
          <p className="text-xs" style={{ color:'var(--dp-muted)' }}>
            {r.account_number} · {r.email} · {r.phone_number}
          </p>
          <p className="mt-1 text-xs" style={{ color:'var(--dp-muted)' }}>
            {r.request_type === 'pin_reset' ? 'Forgot PIN' : 'Account locked'} · failed attempts: {r.failed_pin_attempts ?? '—'}
            {r.pin_locked_until ? ` · locked until ${new Date(r.pin_locked_until).toLocaleString()}` : ''}
          </p>
          {r.reason && <p className="mt-1.5 text-xs italic" style={{ color:'var(--dp-sub)' }}>&ldquo;{r.reason}&rdquo;</p>}
        </div>
        <span className="flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize"
          style={{
            borderColor: r.status==='pending' ? 'rgba(245,158,11,0.3)' : r.status==='completed' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
            background:  r.status==='pending' ? 'rgba(245,158,11,0.1)' : r.status==='completed' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color:       r.status==='pending' ? '#f59e0b' : r.status==='completed' ? '#22c55e' : '#ef4444',
          }}>
          {r.status}
        </span>
      </div>

      {r.status === 'pending' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={pinDrafts[r.request_id] || ''}
            onChange={e => setPinDrafts(prev => ({ ...prev, [r.request_id]: e.target.value.replace(/\D/g,'').slice(0,4) }))}
            placeholder="New 4-digit PIN (optional)"
            maxLength={4}
            className="w-44 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
            style={{ background:'var(--dp-input)', borderColor:'var(--dp-input-bd)', color:'var(--dp-txt)' }}
          />
          <button onClick={() => resolve(r.request_id, 'unlock')} disabled={resolvingId === r.request_id}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-40"
            style={{ background:'linear-gradient(135deg,#22c55e,#15803d)' }}>
            {resolvingId === r.request_id ? 'Working…' : pinDrafts[r.request_id] ? 'Unlock + set PIN' : 'Unlock'}
          </button>
          <button onClick={() => resolve(r.request_id, 'reject')} disabled={resolvingId === r.request_id}
            className="rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-40"
            style={{ borderColor:'rgba(239,68,68,0.3)', background:'rgba(239,68,68,0.1)', color:'#ef4444' }}>
            Reject
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {error && <p className="mb-3 text-xs text-rose-400">{error}</p>}
      {lastResolved && (
        <div className="mb-3 flex items-center justify-between rounded-xl border p-3"
          style={{ borderColor:'rgba(34,197,94,0.3)', background:'rgba(34,197,94,0.1)' }}>
          <p className="text-xs font-semibold" style={{ color:'#22c55e' }}>
            Unlocked — new PIN set: <span className="font-bold tracking-widest">{lastResolved.pin}</span>. Make sure this reaches the account holder.
          </p>
          <button onClick={() => setLastResolved(null)} className="text-xs" style={{ color:'#22c55e' }}>Dismiss</button>
        </div>
      )}
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color:'var(--dp-muted)' }}>Pending ({pending.length})</p>
        <button onClick={refresh} className="flex items-center gap-1 text-xs font-semibold" style={{ color:'var(--dp-muted)' }}>
          <RefreshCw size={11}/> Refresh
        </button>
      </div>
      <div className="space-y-3">
        {pending.map(RequestCard)}
        {!loading && pending.length === 0 && <EmptyState msg="No pending recovery requests." Icon={Lock}/>}
      </div>

      {resolved.length > 0 && (
        <>
          <p className="mb-2 mt-6 text-xs font-bold uppercase tracking-wider" style={{ color:'var(--dp-muted)' }}>Recent ({resolved.length})</p>
          <div className="space-y-3 opacity-70">
            {resolved.slice(0, 20).map(RequestCard)}
          </div>
        </>
      )}
    </>
  );
};

// =============================================================================
// DASHBOARD
// =============================================================================
const ICANDevDashboard = ({ onExit }) => {
  const [tab, setTab]   = useState('overview');
  const [loading, setL] = useState(true);
  const [search,  setQ] = useState('');
  const [ts,      setTs]= useState(null);
  const [dark, setDark] = useState(() => localStorage.getItem('ican_dev_theme') !== 'light');

  const toggleTheme = () => setDark(d => {
    const n = !d;
    localStorage.setItem('ican_dev_theme', n ? 'dark' : 'light');
    return n;
  });

  // CSS variables applied directly on the root node — no Tailwind dark mode needed
  const cssVars = dark ? DARK_VARS : LIGHT_VARS;

  // data
  const [users,     setUsers]     = useState([]);
  const [walletMap, setWMap]      = useState({});
  const [wallets,   setWallets]   = useState([]);
  const [companies, setCompanies] = useState([]);
  const [businesses,setBiz]       = useState([]);
  const [groups,    setGroups]    = useState([]);
  const [agents,    setAgents]    = useState([]);
  const [txs,       setTxs]       = useState([]);
  const [market,    setMarket]    = useState(null);
  const [subs,      setSubs]      = useState([]);
  const [subsOk,    setSubsOk]    = useState(false);
  const [priceEng,  setPE]        = useState(null);
  const [globalFx,  setFx]        = useState([]);
  const [fxRegion,  setFxRegion]  = useState('All');
  const [applying,  setApplying]  = useState(false);

  const supabase = getSupabaseClient();

  const rpc = useCallback(async (fn, params={}) => {
    try {
      const { data, error } = await supabase.rpc(fn, { dev_token: DEV_TOKEN, ...params });
      if (error) { console.warn(`[Dev] ${fn}:`, error.message); return []; }
      return Array.isArray(data) ? data : (data ? [data] : []);
    } catch (e) { console.warn(`[Dev] ${fn}:`, e); return []; }
  }, [supabase]);

  const fetchAll = useCallback(async () => {
    setL(true);
    const [uR, wR, cR, bR, gR, aR, tR, mR, pR, fxR] = await Promise.all([
      rpc('ican_dev_get_users'),
      rpc('ican_dev_get_wallets'),
      rpc('ican_dev_get_cmms_companies'),
      rpc('ican_dev_get_pitchin_businesses'),
      rpc('ican_dev_get_trust_groups'),
      rpc('ican_dev_get_agents'),
      rpc('ican_dev_get_blockchain_txs'),
      rpc('ican_dev_get_market_price'),
      rpc('ican_compute_fair_price'),
      rpc('ican_dev_get_global_prices'),
    ]);
    setUsers(uR); setWallets(wR);
    const wm={}; wR.forEach(w=>{ wm[w.user_id]=w; }); setWMap(wm);
    setCompanies(cR); setBiz(bR); setGroups(Array.isArray(gR)?gR:[]); setAgents(aR); setTxs(tR); setMarket(mR[0]||null); setPE(pR[0]||null); setFx(fxR||[]);
    const { data:sd, error:se } = await supabase.from('ican_subscriptions').select('*').order('created_at',{ascending:false});
    if (!se) { setSubs(sd||[]); setSubsOk(true); }
    setTs(new Date()); setL(false);
  }, [rpc, supabase]);

  useEffect(()=>{ fetchAll(); },[fetchAll]);

  const subFor   = uid => subs.find(s=>s.user_id===uid);
  const totalI            = wallets.reduce((s,w)=>s+Number(w.ican_balance||0),0);
  const totalE            = wallets.reduce((s,w)=>s+Number(w.total_earned||0),0);
  const totalFl           = agents.reduce((s,a)=>s+Number(a.float_balance||0),0);
  const totalR            = businesses.reduce((s,b)=>s+Number(b.raised_amount||0),0);
  const priceChg          = Number(market?.percentage_change_24h||0);
  const totalGroupSavings = groups.reduce((s,g)=>s+Number(g.total_savings||0),0);
  const totalTxVol        = txs.reduce((s,t)=>s+Number(t.ican_amount||0),0);
  const totalMembers      = companies.reduce((s,c)=>s+Number(c.member_count||0),0);
  const activeAgents      = agents.filter(a=>a.is_active).length;
  const activeGroups      = groups.filter(g=>g.is_active!==false).length;
  const walletPct         = users.length>0 ? (wallets.length/users.length*100) : 0;
  const agentPct          = agents.length>0 ? (activeAgents/agents.length*100) : 0;
  const groupPct          = groups.length>0 ? (activeGroups/groups.length*100) : 0;
  const livePrice         = Number(market?.price_ugx||ICAN_TO_UGX);
  const pegDrift          = ((livePrice - ICAN_TO_UGX) / ICAN_TO_UGX * 100);
  const inflationHealth   = Math.max(0, Math.min(100, 100 - Math.abs(pegDrift)*2));
  const totalNetworkUGX   = totalI * livePrice;

  const applyPrice = async () => {
    setApplying(true);
    await rpc('ican_apply_computed_price');
    await fetchAll();
    setApplying(false);
  };

  const grantBonus = async (userId, amount) => {
    await rpc('ican_dev_grant_bonus',{target_user_id:userId,bonus_amount:amount}); fetchAll();
  };
  const [floatDrafts, setFloatDrafts] = useState({}); // agent_id -> { currency, amount }
  const [grantingFloatId, setGrantingFloatId] = useState(null);
  const [floatError, setFloatError] = useState(null);
  const grantFloat = async (agentId) => {
    const draft = floatDrafts[agentId] || {};
    const currency = (draft.currency || 'UGX').toUpperCase();
    const amount = parseFloat(draft.amount);
    if (!amount || amount <= 0) { setFloatError('Enter an amount greater than zero.'); return; }
    setGrantingFloatId(agentId);
    setFloatError(null);
    try {
      const { data, error: err } = await supabase.rpc('ican_dev_grant_float', {
        dev_token: DEV_TOKEN,
        p_agent_id: agentId,
        p_currency: currency,
        p_amount: amount,
      });
      if (err) throw err;
      if (!data?.[0]?.success) throw new Error(data?.[0]?.message || 'Failed to grant float');
      setFloatDrafts(prev => { const n = { ...prev }; delete n[agentId]; return n; });
      await fetchAll();
    } catch (e) {
      setFloatError(e.message || 'Failed to grant float');
    } finally {
      setGrantingFloatId(null);
    }
  };
  const upsertSub = async (userId, plan, tt='user') => {
    if (!subsOk) return;
    const ex=subFor(userId); const now=new Date().toISOString();
    if (ex) {
      const {data}=await supabase.from('ican_subscriptions').update({plan,updated_at:now}).eq('id',ex.id).select().single();
      if(data) setSubs(p=>p.map(s=>s.id===ex.id?data:s));
    } else {
      const {data}=await supabase.from('ican_subscriptions').insert({user_id:userId,plan,target_type:tt,active:true}).select().single();
      if(data) setSubs(p=>[data,...p]);
    }
  };
  const toggleSub = async (id,cur) => {
    await supabase.from('ican_subscriptions').update({active:!cur}).eq('id',id);
    setSubs(p=>p.map(s=>s.id===id?{...s,active:!cur}:s));
  };

  const q    = search.toLowerCase();
  const filt = (list,keys) => !q ? list : list.filter(r=>keys.some(k=>String(r[k]||'').toLowerCase().includes(q)));

  return (
    <div className="min-h-screen font-sans transition-all duration-300" style={{ ...cssVars, background:'var(--dp-bg)', color:'var(--dp-txt)' }}>

      {/* ══ HEADER ══ */}
      <header className="sticky top-0 z-40 border-b transition-colors"
        style={{ background:'var(--dp-hdr)', borderColor:'var(--dp-hdr-bd)', backdropFilter:'blur(24px)' }}>
        <div className="flex items-center justify-between px-5 py-3 gap-4">

          {/* brand */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl"
              style={{ background:'linear-gradient(135deg,#06b6d4,#0284c7)', boxShadow:'0 0 20px #06b6d440' }}>
              <Shield size={18} className="text-white" />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2"
                style={{ background:'#10b981', borderColor: dark ? '#07091a' : '#fff', boxShadow:'0 0 6px #10b981' }} />
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-[0.25em]" style={{ color:'var(--dp-muted)' }}>ICAN Capital</p>
              <p className="text-sm font-black leading-tight bg-gradient-to-r from-cyan-500 to-blue-500 bg-clip-text text-transparent">Dev Console</p>
            </div>
          </div>

          {/* ticker */}
          {market && (
            <div className="hidden sm:flex items-center gap-2 rounded-xl border px-3 py-2 flex-1 max-w-xs"
              style={{ borderColor:'rgba(6,182,212,0.2)', background:'rgba(6,182,212,0.06)' }}>
              <Zap size={11} className="text-cyan-500 flex-shrink-0" />
              <span className="text-xs font-bold text-cyan-500">{fmt(market.price_ugx)} UGX</span>
              <span className={`text-[10px] font-bold ml-auto flex items-center gap-0.5 ${priceChg>=0?'text-emerald-500':'text-red-500'}`}>
                {priceChg>=0?<ArrowUp size={9}/>:<ArrowDown size={9}/>}{Math.abs(priceChg).toFixed(2)}%
              </span>
              <span className="text-[10px]" style={{ color:'var(--dp-muted)' }}>24h</span>
            </div>
          )}

          {/* actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {ts && <span className="hidden sm:block text-[10px]" style={{ color:'var(--dp-muted)' }}>{ts.toLocaleTimeString()}</span>}
            <button onClick={fetchAll} disabled={loading}
              className="rounded-xl border p-2 transition disabled:opacity-40"
              style={{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)', color:'var(--dp-sub)' }}>
              <RefreshCw size={14} className={loading?'animate-spin':''} />
            </button>

            {/* ── Theme toggle — always visible ── */}
            <button onClick={toggleTheme}
              className="flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-bold transition-all"
              style={dark
                ? { borderColor:'rgba(250,204,21,0.4)', background:'rgba(250,204,21,0.12)', color:'#fbbf24' }
                : { borderColor:'rgba(99,102,241,0.4)',  background:'rgba(99,102,241,0.12)', color:'#6366f1' }}>
              {dark ? <Sun size={13}/> : <Moon size={13}/>}
              <span className="hidden sm:inline">{dark ? 'Light' : 'Dark'}</span>
            </button>

            <button onClick={onExit}
              className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold text-red-500 transition"
              style={{ borderColor:'rgba(239,68,68,0.25)', background:'rgba(239,68,68,0.08)' }}>
              <LogOut size={12}/> Exit
            </button>
          </div>
        </div>

        {/* tabs */}
        <div className="flex overflow-x-auto px-5 scrollbar-none">
          {TABS.map(t => (
            <button key={t.id} onClick={()=>{ setTab(t.id); setQ(''); }}
              className="relative flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2.5 text-[11px] font-bold transition-all duration-200 border-b-2"
              style={{
                borderColor: tab===t.id ? t.color : 'transparent',
                color: tab===t.id ? t.color : 'var(--dp-muted)',
              }}>
              <t.Icon size={11}/>
              {t.label}
              {tab===t.id && <span className="absolute inset-0 opacity-[0.07] rounded-t-lg" style={{ background:t.color }}/>}
            </button>
          ))}
        </div>
      </header>

      <main className="px-5 py-5 space-y-4">

        {/* search */}
        {['users','companies','businesses','groups','agents'].includes(tab) && (
          <div className="relative">
            <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color:'var(--dp-muted)' }}/>
            <input value={search} onChange={e=>setQ(e.target.value)} placeholder={`Search ${tab}…`}
              className="w-full rounded-xl border py-2.5 pl-9 pr-4 text-sm outline-none transition"
              style={{ background:'var(--dp-input)', borderColor:'var(--dp-input-bd)', color:'var(--dp-txt)' }}/>
          </div>
        )}

        {/* ══ OVERVIEW ══ */}
        {tab==='overview' && (<>

          {/* ── Top 4 stat cards ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard Icon={Users}       label="Users"        value={loading?'—':fmt(users.length)}      color="#8b5cf6" loading={loading} sub={`${wallets.length} wallets active`}/>
            <StatCard Icon={Layers}      label="Companies"    value={loading?'—':fmt(companies.length)}  color="#6366f1" loading={loading} sub={`${fmt(totalMembers)} members`}/>
            <StatCard Icon={Building2}   label="Businesses"   value={loading?'—':fmt(businesses.length)} color="#10b981" loading={loading} sub={`${fmtI(totalR)} ICAN raised`}/>
            <StatCard Icon={ShieldCheck} label="Trust Groups" value={loading?'—':fmt(groups.length)}     color="#f59e0b" loading={loading} sub={`${activeAgents} active agents`}/>
          </div>

          {/* ── icaneracoin Economy Hero ── */}
          <div className="rounded-2xl border p-5 relative overflow-hidden transition-colors"
            style={{ background:'var(--dp-card)', borderColor:'rgba(6,182,212,0.22)' }}>
            <div className="pointer-events-none absolute -top-10 -right-10 h-48 w-48 rounded-full opacity-[0.12] blur-3xl" style={{ background:'#06b6d4' }}/>
            <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full opacity-[0.08] blur-2xl" style={{ background:'#8b5cf6' }}/>
            <div className="relative flex items-center gap-2 mb-5">
              <div className="h-7 w-7 rounded-xl flex items-center justify-center"
                style={{ background:'rgba(6,182,212,0.15)', border:'1px solid rgba(6,182,212,0.3)' }}>
                <Zap size={13} className="text-cyan-500"/>
              </div>
              <div>
                <p className="text-xs font-black tracking-widest uppercase text-cyan-500">icaneracoin Economy</p>
                <p className="text-[9px]" style={{ color:'var(--dp-muted)' }}>Live network snapshot · all values from Supabase</p>
              </div>
              <div className="ml-auto flex items-center gap-1.5"><GlowDot color="#10b981"/><span className="text-[10px] font-bold text-emerald-500">LIVE</span></div>
            </div>

            {/* ── 4 live price boxes ── */}
            <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label:'Floor Price',        val: `${fmt(ICAN_TO_UGX)} UGX`,       sub:'permanent peg',                              color:'#06b6d4' },
                { label:'Live Price',         val: loading?'—':`${fmt(livePrice)} UGX`, sub:`${priceChg>=0?'+':''}${priceChg.toFixed(2)}% 24h`, color: priceChg>=0?'#10b981':'#ef4444' },
                { label:'Circulating Supply', val: loading?'—':`${fmtI(totalI)}`,    sub:'ICAN across all wallets',                    color:'#8b5cf6' },
                { label:'Network UGX Value',  val: loading?'—':`UGX ${(totalNetworkUGX/1e6).toFixed(2)}M`, sub:'supply × live price', color:'#f59e0b' },
              ].map(r=>(
                <div key={r.label} className="rounded-xl border p-3 text-center transition-colors"
                  style={{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)' }}>
                  <p className="text-lg font-black leading-none" style={{ color:r.color }}>{r.val}</p>
                  <p className="text-[9px] mt-1" style={{ color:r.color, opacity:.65 }}>{r.sub}</p>
                  <p className="text-[9px] mt-1.5 uppercase tracking-widest font-semibold" style={{ color:'var(--dp-muted)' }}>{r.label}</p>
                </div>
              ))}
            </div>

            {/* ── Adoption bars ── */}
            <div className="relative space-y-2.5">
              {[
                { label:'Wallet participation', val:walletPct,  color:'#06b6d4', suffix:`${wallets.length} / ${users.length} users` },
                { label:'Agent network active',  val:agentPct,  color:'#f97316', suffix:`${activeAgents} / ${agents.length} agents` },
                { label:'Trust group activation',val:groupPct,  color:'#f59e0b', suffix:`${activeGroups} / ${groups.length} groups` },
              ].map(r=>(
                <div key={r.label}>
                  <div className="flex justify-between mb-1 text-[10px]">
                    <span style={{ color:'var(--dp-sub)' }}>{r.label}</span>
                    <span style={{ color:'var(--dp-muted)' }}>{r.suffix}</span>
                  </div>
                  <PBar val={r.val} color={r.color}/>
                </div>
              ))}
            </div>
          </div>

          {/* ── 3-panel: Inflation Shield · Capital Pools · Network Stats ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

            {/* Inflation shield */}
            <div className="rounded-2xl border p-4 relative overflow-hidden transition-colors"
              style={{ background:'var(--dp-card)', borderColor:'rgba(245,158,11,0.22)' }}>
              <div className="pointer-events-none absolute -top-6 -right-6 h-28 w-28 rounded-full opacity-[0.15] blur-2xl" style={{ background:'#f59e0b' }}/>
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-6 w-6 rounded-lg flex items-center justify-center"
                    style={{ background:'rgba(245,158,11,0.15)', border:'1px solid rgba(245,158,11,0.3)' }}>
                    <ShieldCheck size={11} className="text-amber-500"/>
                  </div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-amber-500">Inflation Shield</p>
                </div>
                <div className="flex items-end gap-1 mb-1">
                  <p className="text-4xl font-black leading-none"
                    style={{ color:inflationHealth>80?'#10b981':inflationHealth>50?'#f59e0b':'#ef4444' }}>
                    {inflationHealth.toFixed(0)}
                  </p>
                  <p className="text-sm font-bold mb-1" style={{ color:'var(--dp-muted)' }}>/100</p>
                </div>
                <p className="text-[9px] font-bold uppercase tracking-widest mb-3"
                  style={{ color:inflationHealth>80?'#10b981':inflationHealth>50?'#f59e0b':'#ef4444' }}>
                  {inflationHealth>80?'✦ STABLE PEG':inflationHealth>50?'PEG DRIFTING':'⚠ PEG ALERT'}
                </p>
                <PBar val={inflationHealth} color={inflationHealth>80?'#10b981':inflationHealth>50?'#f59e0b':'#ef4444'}/>
                <div className="mt-3 space-y-1.5">
                  {[
                    { k:'Floor peg',    v:`${fmt(ICAN_TO_UGX)} UGX`,                    c:'var(--dp-sub)'    },
                    { k:'Peg drift',    v:`${pegDrift>=0?'+':''}${pegDrift.toFixed(2)}%`, c:Math.abs(pegDrift)<5?'#10b981':'#f59e0b' },
                    { k:'24h change',   v:`${priceChg>=0?'+':''}${priceChg.toFixed(2)}%`, c:priceChg>=0?'#10b981':'#ef4444' },
                    { k:'Market cap',   v:`UGX ${fmt(market?.market_cap||0)}`,            c:'var(--dp-sub)'    },
                  ].map(r=>(
                    <div key={r.k} className="flex justify-between text-[9px]">
                      <span style={{ color:'var(--dp-muted)' }}>{r.k}</span>
                      <span className="font-black" style={{ color:r.c }}>{r.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Capital Pools */}
            <div className="rounded-2xl border p-4 relative overflow-hidden transition-colors"
              style={{ background:'var(--dp-card)', borderColor:'rgba(16,185,129,0.22)' }}>
              <div className="pointer-events-none absolute -top-6 -right-6 h-28 w-28 rounded-full opacity-[0.12] blur-2xl" style={{ background:'#10b981' }}/>
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-6 w-6 rounded-lg flex items-center justify-center"
                    style={{ background:'rgba(16,185,129,0.15)', border:'1px solid rgba(16,185,129,0.3)' }}>
                    <Wallet size={11} className="text-emerald-500"/>
                  </div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500">Capital Pools</p>
                </div>
                <div className="space-y-2.5">
                  {[
                    { label:'Wallet holdings',   val:fmtI(totalI),            unit:'ICAN', color:'#06b6d4',  bar: pct(totalI, totalE||1) },
                    { label:'Business raised',   val:fmtI(totalR),            unit:'ICAN', color:'#10b981',  bar: businesses.length>0?pct(businesses.filter(b=>Number(b.raised_amount)>0).length,businesses.length):0 },
                    { label:'Agent liquidity',   val:fmtI(totalFl),           unit:'UGX',  color:'#f97316',  bar: agentPct },
                    { label:'Group savings',     val:fmtI(totalGroupSavings), unit:'ICAN', color:'#f59e0b',  bar: groupPct },
                    { label:'Tx volume (total)', val:fmtI(totalTxVol),        unit:'ICAN', color:'#ec4899',  bar: pct(txs.length,200) },
                  ].map(r=>(
                    <div key={r.label}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[9px]" style={{ color:'var(--dp-sub)' }}>{r.label}</span>
                        <span className="text-[9px] font-black" style={{ color:r.color }}>{loading?'—':r.val} {r.unit}</span>
                      </div>
                      <PBar val={r.bar} color={r.color}/>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Network Stats */}
            <div className="rounded-2xl border p-4 relative overflow-hidden transition-colors"
              style={{ background:'var(--dp-card)', borderColor:'rgba(139,92,246,0.22)' }}>
              <div className="pointer-events-none absolute -top-6 -right-6 h-28 w-28 rounded-full opacity-[0.10] blur-2xl" style={{ background:'#8b5cf6' }}/>
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-6 w-6 rounded-lg flex items-center justify-center"
                    style={{ background:'rgba(139,92,246,0.15)', border:'1px solid rgba(139,92,246,0.3)' }}>
                    <Network size={11} className="text-violet-500"/>
                  </div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-violet-500">Network</p>
                </div>
                <div className="space-y-2">
                  {[
                    { label:'Total users',      val:fmt(users.length),      color:'#8b5cf6' },
                    { label:'Active wallets',   val:fmt(wallets.length),    color:'#06b6d4' },
                    { label:'CMMS companies',   val:fmt(companies.length),  color:'#6366f1' },
                    { label:'Total members',    val:fmt(totalMembers),      color:'#6366f1' },
                    { label:'Pitchin pitches',  val:fmt(businesses.length), color:'#10b981' },
                    { label:'Trust groups',     val:fmt(groups.length),     color:'#f59e0b' },
                    { label:'Active agents',    val:`${activeAgents} / ${agents.length}`, color:'#f97316' },
                    { label:'Txns recorded',    val:fmt(txs.length),        color:'#ec4899' },
                    { label:'Subscriptions',    val:fmt(subs.filter(s=>s.active).length), color:'#eab308' },
                  ].map(r=>(
                    <div key={r.label} className="flex items-center justify-between">
                      <span className="text-[9px]" style={{ color:'var(--dp-sub)' }}>{r.label}</span>
                      <span className="text-[9px] font-black" style={{ color:r.color }}>{loading?'—':r.val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── icaneracoin Price Engine + Global Currency Dashboard ── */}
          {(() => {
            // USD-anchored price fields
            const baseUsd    = Number(priceEng?.base_usd_value       || 0);
            const initRate   = Number(priceEng?.initial_ugx_rate     || 3700);
            const currRate   = Number(priceEng?.current_ugx_rate     || 3700);
            const deprPct    = Number(priceEng?.ugx_depreciation_pct || 0);
            const origFloor  = Number(priceEng?.original_floor_ugx   || ICAN_TO_UGX);
            const fxFloor    = Number(priceEng?.fx_adjusted_floor    || ICAN_TO_UGX);
            const fxProtect  = Number(priceEng?.fx_protection_ugx    || 0);
            const txC        = Number(priceEng?.tx_contribution      || 0);
            const vlC        = Number(priceEng?.volume_contribution  || 0);
            const hlC        = Number(priceEng?.holder_contribution  || 0);
            const usagePrem  = Number(priceEng?.usage_premium        || 0);
            const fairUgx    = Number(priceEng?.fair_price_ugx       || ICAN_TO_UGX);
            const fairUsd    = Number(priceEng?.fair_price_usd       || baseUsd);
            const appPct     = Number(priceEng?.appreciation_pct     || 0);
            const txN        = Number(priceEng?.tx_count             || 0);
            const hlN        = Number(priceEng?.active_holders       || 0);
            const vlN        = Number(priceEng?.total_volume         || 0);
            // Global FX
            const regions        = ['All', ...new Set(globalFx.map(r=>r.region).filter(Boolean))];
            const fxRows         = fxRegion==='All' ? globalFx : globalFx.filter(r=>r.region===fxRegion);
            const protectedCount = globalFx.filter(r=>r.is_protected).length;
            const fmtLocal = v => {
              const n = Number(v||0);
              if (n >= 100000) return n.toLocaleString('en', {maximumFractionDigits:0});
              if (n >= 1000)   return n.toLocaleString('en', {maximumFractionDigits:1});
              if (n >= 10)     return n.toLocaleString('en', {maximumFractionDigits:2});
              return n.toLocaleString('en', {maximumFractionDigits:4});
            };
            return (<>
              {/* ── Price Engine card ── */}
              <div className="rounded-2xl border p-5 relative overflow-hidden transition-colors"
                style={{ background:'var(--dp-card)', borderColor:'rgba(16,185,129,0.25)' }}>
                <div className="pointer-events-none absolute -top-10 right-0 h-48 w-48 rounded-full opacity-[0.10] blur-3xl" style={{ background:'#10b981' }}/>
                <div className="pointer-events-none absolute -bottom-8 left-0 h-32 w-32 rounded-full opacity-[0.07] blur-2xl" style={{ background:'#06b6d4' }}/>

                {/* header */}
                <div className="relative flex items-start gap-3 mb-5">
                  <div className="h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background:'rgba(16,185,129,0.15)', border:'1px solid rgba(16,185,129,0.3)' }}>
                    <TrendingUp size={15} className="text-emerald-500"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black uppercase tracking-widest text-emerald-500">Price Engine · USD-Anchored Global Stability</p>
                    <p className="text-[9px] mt-0.5" style={{ color:'var(--dp-muted)' }}>
                      Real value fixed in USD · when UGX loses value the coin rises in UGX to protect you · more usage = higher value worldwide
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-2xl font-black text-emerald-500">{fmt(fairUgx)}</p>
                    <p className="text-[9px] font-bold text-emerald-500">UGX / ICAN</p>
                    <p className="text-[9px] font-bold text-cyan-500">${fairUsd.toFixed(4)} USD</p>
                  </div>
                </div>

                {/* ── How the price is built ── */}
                <div className="relative space-y-2 mb-5">
                  {/* Step 1: USD anchor */}
                  <div className="rounded-xl border p-3 flex items-center gap-3"
                    style={{ background:'var(--dp-inner)', borderColor:'rgba(6,182,212,0.2)' }}>
                    <div className="h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background:'rgba(6,182,212,0.15)', border:'1px solid rgba(6,182,212,0.3)' }}>
                      <Lock size={10} className="text-cyan-500"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color:'var(--dp-muted)' }}>USD Anchor — fixed forever</p>
                      <p className="text-[10px]" style={{ color:'var(--dp-sub)' }}>
                        At launch: {fmt(origFloor)} UGX ÷ {fmt(initRate)} UGX/USD = <span className="font-black text-cyan-500">${baseUsd.toFixed(6)} USD per ICAN</span>
                      </p>
                    </div>
                    <span className="text-xs font-black text-cyan-500 flex-shrink-0">${baseUsd.toFixed(4)}</span>
                  </div>

                  {/* Step 2: FX adjustment */}
                  <div className="rounded-xl border p-3 flex items-center gap-3"
                    style={{
                      background:'var(--dp-inner)',
                      borderColor: deprPct > 0 ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.2)',
                    }}>
                    <div className="h-6 w-6 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{
                        background: deprPct>0 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
                        border:`1px solid ${deprPct>0?'rgba(245,158,11,0.3)':'rgba(16,185,129,0.3)'}`,
                      }}>
                      <ArrowUp size={10} style={{ color: deprPct>0?'#f59e0b':'#10b981' }}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color:'var(--dp-muted)' }}>
                        FX Auto-Adjustment {deprPct>0?'— UGX weakened vs USD':'— UGX stable'}
                      </p>
                      <p className="text-[10px]" style={{ color:'var(--dp-sub)' }}>
                        {deprPct>0
                          ? <>UGX lost <span className="font-black text-amber-500">{deprPct.toFixed(2)}%</span> vs USD ({fmt(initRate)} → {fmt(currRate)} UGX/USD) · coin auto-rose <span className="font-black text-amber-500">+{fmt(fxProtect.toFixed(0))} UGX</span> to protect your USD value</>
                          : <>UGX/USD unchanged · floor stays at {fmt(origFloor)} UGX = ${baseUsd.toFixed(4)}</>
                        }
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-black" style={{ color: deprPct>0?'#f59e0b':'#10b981' }}>{fmt(fxFloor)} UGX</p>
                      {deprPct>0 && <p className="text-[9px] text-amber-500">+{fmt(fxProtect.toFixed(0))} UGX</p>}
                    </div>
                  </div>

                  {/* Step 3: Usage premium */}
                  <div className="rounded-xl border p-3 flex items-center gap-3"
                    style={{ background:'var(--dp-inner)', borderColor:'rgba(139,92,246,0.2)' }}>
                    <div className="h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background:'rgba(139,92,246,0.12)', border:'1px solid rgba(139,92,246,0.3)' }}>
                      <Activity size={10} className="text-violet-500"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color:'var(--dp-muted)' }}>Usage Premium — grows with every transaction</p>
                      <p className="text-[10px]" style={{ color:'var(--dp-sub)' }}>
                        {fmt(txN)} txns × 0.50 = {fmt(txC.toFixed(0))} · {fmtI(vlN)} vol × 0.002 = {fmt(vlC.toFixed(0))} · {fmt(hlN)} wallets × 15 = {fmt(hlC.toFixed(0))}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-black text-violet-500">+{fmt(usagePrem.toFixed(0))} UGX</p>
                    </div>
                  </div>

                  {/* Result line */}
                  <div className="rounded-xl border p-3 flex items-center gap-3"
                    style={{ background:'rgba(16,185,129,0.08)', borderColor:'rgba(16,185,129,0.35)' }}>
                    <div className="h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background:'rgba(16,185,129,0.15)', border:'1px solid rgba(16,185,129,0.35)' }}>
                      <Zap size={10} className="text-emerald-500"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500">Fair Price = FX Floor + Usage Premium</p>
                      <p className="text-[10px]" style={{ color:'var(--dp-sub)' }}>
                        {fmt(fxFloor.toFixed(0))} + {fmt(usagePrem.toFixed(0))} = <span className="font-black text-emerald-500">{fmt(fairUgx)} UGX</span> = <span className="font-black text-cyan-500">${fairUsd.toFixed(4)} USD</span>
                        <span className="ml-2 text-emerald-500 font-bold">+{appPct.toFixed(2)}% above original floor</span>
                      </p>
                    </div>
                    <button onClick={applyPrice} disabled={applying||loading}
                      className="flex-shrink-0 flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[10px] font-black text-emerald-500 transition disabled:opacity-40"
                      style={{ borderColor:'rgba(16,185,129,0.4)', background:'rgba(16,185,129,0.12)' }}>
                      {applying?<RefreshCw size={10} className="animate-spin"/>:<Zap size={10}/>}
                      Apply
                    </button>
                  </div>
                </div>

                {/* Comparison: holding UGX vs holding ICAN */}
                {deprPct > 0 && (
                  <div className="relative grid grid-cols-2 gap-3">
                    <div className="rounded-xl border p-3" style={{ background:'var(--dp-inner)', borderColor:'rgba(239,68,68,0.2)' }}>
                      <p className="text-[9px] font-bold text-red-500 mb-2 uppercase tracking-wide">If you held {fmt(origFloor)} UGX cash</p>
                      <p className="text-lg font-black text-red-500">${(origFloor/currRate).toFixed(4)}</p>
                      <p className="text-[9px]" style={{ color:'var(--dp-muted)' }}>USD value today</p>
                      <p className="text-[9px] text-red-500 mt-1">Lost {deprPct.toFixed(2)}% vs USD</p>
                    </div>
                    <div className="rounded-xl border p-3" style={{ background:'rgba(16,185,129,0.06)', borderColor:'rgba(16,185,129,0.25)' }}>
                      <p className="text-[9px] font-bold text-emerald-500 mb-2 uppercase tracking-wide">If you held 1 ICAN instead</p>
                      <p className="text-lg font-black text-emerald-500">${fairUsd.toFixed(4)}</p>
                      <p className="text-[9px]" style={{ color:'var(--dp-muted)' }}>USD value today</p>
                      <p className="text-[9px] text-emerald-500 mt-1">Protected + {appPct.toFixed(2)}% gain</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Global Currency Dashboard */}
              <div className="rounded-2xl border p-5 transition-colors"
                style={{ background:'var(--dp-card)', borderColor:'rgba(6,182,212,0.2)' }}>
                {/* header */}
                <div className="flex items-start gap-3 mb-4">
                  <div className="h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background:'rgba(6,182,212,0.15)', border:'1px solid rgba(6,182,212,0.3)' }}>
                    <Network size={15} className="text-cyan-500"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black uppercase tracking-widest text-cyan-500">Global Currency Stability</p>
                    <p className="text-[9px] mt-0.5" style={{ color:'var(--dp-muted)' }}>
                      ICAN price in every country's local currency · green = ICAN outpaces local inflation
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xl font-black text-cyan-500">{globalFx.length}</p>
                    <p className="text-[9px]" style={{ color:'var(--dp-muted)' }}>currencies</p>
                    {globalFx.length>0 && (
                      <p className="text-[9px] font-bold text-emerald-500">{protectedCount} protected</p>
                    )}
                  </div>
                </div>

                {/* Region filter pills */}
                {regions.length > 1 && (
                  <div className="flex gap-1.5 flex-wrap mb-4">
                    {regions.map(r=>(
                      <button key={r} onClick={()=>setFxRegion(r)}
                        className="rounded-lg border px-2.5 py-1 text-[9px] font-bold transition"
                        style={fxRegion===r
                          ? { background:'rgba(6,182,212,0.15)', borderColor:'rgba(6,182,212,0.4)', color:'#06b6d4' }
                          : { background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)', color:'var(--dp-muted)' }}>
                        {r}
                      </button>
                    ))}
                  </div>
                )}

                {globalFx.length === 0 && !loading && (
                  <div className="rounded-xl border p-4 text-center" style={{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)' }}>
                    <p className="text-[10px]" style={{ color:'var(--dp-muted)' }}>
                      Run <span className="font-mono font-bold text-cyan-500">ICAN_GLOBAL_CURRENCY.sql</span> in Supabase to enable global pricing.
                    </p>
                  </div>
                )}

                {/* Currency grid */}
                {fxRows.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {fxRows.map(row=>{
                      const prot      = row.is_protected;
                      const net       = Number(row.net_protection    || 0);
                      const inf       = Number(row.local_inflation   || 0);
                      const fairLocal = Number(row.fair_price_local  || 0);
                      const origLocal = Number(row.original_floor_local || 0);
                      const fxLocal   = Number(row.fx_floor_local   || origLocal);
                      const fxLift    = fxLocal - origLocal;
                      return (
                        <div key={row.currency_code}
                          className="rounded-xl border p-3 flex items-start gap-3 transition-colors"
                          style={{
                            background:'var(--dp-inner)',
                            borderColor: prot ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.15)',
                          }}>
                          <div className="flex-shrink-0 rounded-lg flex items-center justify-center h-9 w-10 font-black text-[9px]"
                            style={{
                              background: prot ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.10)',
                              border:`1px solid ${prot?'rgba(16,185,129,0.25)':'rgba(239,68,68,0.2)'}`,
                              color: prot ? '#10b981' : '#ef4444',
                            }}>
                            {row.currency_code}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <p className="text-[10px] font-bold truncate" style={{ color:'var(--dp-txt)' }}>{row.country_name}</p>
                              <span className="text-[8px] font-semibold rounded px-1 py-0.5 flex-shrink-0"
                                style={{ background:prot?'rgba(16,185,129,0.12)':'rgba(239,68,68,0.10)', color:prot?'#10b981':'#ef4444' }}>
                                {prot?`+${net.toFixed(1)}%`:`${net.toFixed(1)}%`} vs inflation
                              </span>
                            </div>
                            <p className="text-[9px]" style={{ color:'var(--dp-muted)' }}>
                              1 ICAN = <span className="font-black" style={{ color:'var(--dp-sub)' }}>{fmtLocal(fairLocal)} {row.currency_code}</span>
                              {fxLift > 0.0001 && (
                                <span className="text-amber-500 ml-1.5">
                                  (was {fmtLocal(origLocal)} · +{fmtLocal(fxLift)} FX shield)
                                </span>
                              )}
                            </p>
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background:'var(--dp-track)' }}>
                                <div className="h-full rounded-full" style={{ width:`${Math.min(inf,60)*1.67}%`, background:'#ef444440' }}/>
                              </div>
                              <span className="text-[8px] flex-shrink-0" style={{ color:'var(--dp-muted)' }}>infl. {inf}%/yr</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Global insight footer */}
                {globalFx.length > 0 && (
                  <div className="mt-4 rounded-xl border px-3 py-2.5 flex items-center gap-2"
                    style={{ background:'rgba(6,182,212,0.06)', borderColor:'rgba(6,182,212,0.15)' }}>
                    <GlowDot color="#06b6d4"/>
                    <p className="text-[9px]" style={{ color:'var(--dp-sub)' }}>
                      <span className="font-black text-cyan-500">{protectedCount}/{globalFx.length} countries</span> where ICAN appreciation already outpaces local inflation.
                      As network usage grows, every country becomes protected.
                    </p>
                  </div>
                )}
              </div>
            </>);
          })()}

          {/* ── Subscriptions + Top Holders ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {subsOk && (
              <div className="rounded-2xl border p-5 transition-colors"
                style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color:'var(--dp-muted)' }}>Subscriptions</p>
                <div className="space-y-3">
                  {PLANS.map(plan=>{
                    const cnt=subs.filter(s=>s.plan===plan&&s.active).length;
                    const total=subs.filter(s=>s.active).length;
                    return (
                      <div key={plan}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold capitalize" style={{ color:'var(--dp-sub)' }}>{plan}</span>
                          <span className="text-xs font-black" style={{ color:'var(--dp-txt)' }}>{cnt}</span>
                        </div>
                        <PBar val={pct(cnt,total||1)} color={PLAN_META[plan].glow}/>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="rounded-2xl border p-5 transition-colors"
              style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color:'var(--dp-muted)' }}>Top ICAN Holders</p>
              {loading ? [1,2,3].map(i=><Skel key={i} h="h-7" cls="mb-2"/>) : (
                <div className="space-y-3">
                  {[...wallets].sort((a,b)=>Number(b.ican_balance)-Number(a.ican_balance)).slice(0,5).map((w,i)=>{
                    const u=users.find(u=>u.user_id===w.user_id);
                    const name=u?.account_holder_name||'—';
                    const RC=['#f59e0b','#94a3b8','#f97316','#06b6d4','#8b5cf6'];
                    return (
                      <div key={w.user_id} className="flex items-center gap-2.5">
                        <span className="w-5 text-[10px] font-black text-center" style={{ color:RC[i]||'var(--dp-muted)' }}>#{i+1}</span>
                        <Avatar name={name} size={28}/>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold truncate" style={{ color:'var(--dp-sub)' }}>{name}</p>
                          <p className="text-[9px]" style={{ color:'var(--dp-muted)' }}>{fmtUGX(w.ican_balance)}</p>
                        </div>
                        <p className="text-xs font-black text-cyan-500 flex-shrink-0">{fmtI(w.ican_balance)}</p>
                      </div>
                    );
                  })}
                  {wallets.length===0&&<p className="text-xs text-center py-4" style={{ color:'var(--dp-muted)' }}>No wallet data yet.</p>}
                </div>
              )}
            </div>
          </div>

          {/* ── Recent Transactions ── */}
          <div className="rounded-2xl border p-5 transition-colors"
            style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--dp-muted)' }}>Recent Transactions</p>
              <span className="flex items-center gap-1.5 text-[9px] font-bold text-pink-500">
                <GlowDot color="#ec4899"/>{fmt(txs.length)} recorded
              </span>
            </div>
            <div className="space-y-2">
              {txs.slice(0,6).map(tx=>(
                <div key={tx.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors"
                  style={{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)' }}>
                  <div className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background:'rgba(236,72,153,0.12)', border:'1px solid rgba(236,72,153,0.25)' }}>
                    <Hash size={10} className="text-pink-500"/>
                  </div>
                  <span className="text-[10px] font-mono flex-1 truncate" style={{ color:'var(--dp-muted)' }}>{truncHash(tx.tx_hash)||fmtTime(tx.created_at)}</span>
                  <Badge label={tx.tx_type||'tx'} cls="border text-[9px]"/>
                  <span className="text-xs font-black text-cyan-500 flex-shrink-0">{fmtI(tx.ican_amount)} ICAN</span>
                  <span className={`text-[10px] font-semibold flex-shrink-0 ${tx.status==='confirmed'||tx.status==='completed'?'text-emerald-500':'text-amber-500'}`}>{tx.status}</span>
                </div>
              ))}
              {txs.length===0&&!loading&&<p className="text-xs text-center py-4" style={{ color:'var(--dp-muted)' }}>No transactions yet.</p>}
              {loading&&[1,2,3].map(i=><Skel key={i} h="h-10"/>)}
            </div>
          </div>
        </>)}

        {/* ══ USERS ══ */}
        {tab==='users' && (<>
          <div className="flex items-center justify-between">
            <p className="text-sm font-black" style={{ color:'var(--dp-txt)' }}>Users <span style={{ color:'var(--dp-muted)' }}>({users.length})</span></p>
            <p className="text-xs" style={{ color:'var(--dp-sub)' }}>Total: <span className="font-bold text-cyan-500">{fmtI(totalI)} ICAN</span></p>
          </div>
          {loading&&[1,2,3,4].map(i=><Skel key={i} h="h-24"/>)}
          {filt(users,['account_holder_name','email','phone_number','account_number']).map(u=>{
            const w=walletMap[u.user_id]; const sub=subFor(u.user_id);
            // resolve user's local currency from their registered country
            const currCode = COUNTRY_CURRENCY[u.country_code?.toUpperCase()] || 'USD';
            const fxRow    = globalFx.find(r=>r.currency_code===currCode);
            const localPrice   = fxRow ? Number(fxRow.fair_price_local||0)   : null;
            const localBal     = fxRow && w ? Number(w.ican_balance||0) * localPrice : null;
            const origLocal    = fxRow ? Number(fxRow.original_floor_local||0) : null;
            const fxLiftLocal  = fxRow ? Number(fxRow.fx_floor_local||0) - (origLocal||0) : 0;
            return (
              <div key={u.user_id} className="rounded-2xl border p-4 transition-all" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
                <div className="flex items-start gap-3">
                  <Avatar name={u.account_holder_name} size={42}/>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <p className="font-bold" style={{ color:'var(--dp-txt)' }}>{u.account_holder_name||'—'}</p>
                      {u.country_code&&<Badge label={u.country_code} cls="bg-cyan-500/10 text-cyan-600 border-cyan-500/20"/>}
                      {fxRow&&<Badge label={currCode} cls="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"/>}
                      {sub?.plan&&<Badge label={sub.plan} cls={PLAN_BADGE[sub.plan]||''}/>}
                      {sub?.active===false&&<Badge label="paused" cls="bg-red-500/10 text-red-500 border-red-500/20"/>}
                    </div>
                    <p className="text-xs truncate" style={{ color:'var(--dp-sub)' }}>{u.email}</p>
                    <p className="text-[10px]" style={{ color:'var(--dp-muted)' }}>{u.phone_number||'—'} · #{u.account_number||'—'} · {fmtDate(u.created_at)}</p>
                    {w&&(<div className="mt-2 space-y-1">
                      <PBar val={pct(w.ican_balance,totalE||1)} color="#06b6d4"/>
                      <p className="text-[9px]" style={{ color:'var(--dp-muted)' }}>Earned {fmtI(w.total_earned)} · Spent {fmtI(w.total_spent)}</p>
                    </div>)}
                    {/* Local currency live price */}
                    {fxRow && localPrice !== null && (
                      <div className="mt-2 rounded-lg border px-2.5 py-1.5" style={{ background:'rgba(16,185,129,0.06)', borderColor:'rgba(16,185,129,0.2)' }}>
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[9px] font-bold text-emerald-500">1 ICAN in {fxRow.country_name}</p>
                            <p className="text-[10px] font-black" style={{ color:'var(--dp-txt)' }}>
                              {localPrice >= 1000
                                ? localPrice.toLocaleString('en',{maximumFractionDigits:0})
                                : localPrice.toLocaleString('en',{maximumFractionDigits:4})
                              } {currCode}
                            </p>
                          </div>
                          {localBal !== null && w && Number(w.ican_balance) > 0 && (
                            <div className="text-right">
                              <p className="text-[9px]" style={{ color:'var(--dp-muted)' }}>Wallet value</p>
                              <p className="text-[10px] font-black text-cyan-500">
                                {localBal >= 1000
                                  ? localBal.toLocaleString('en',{maximumFractionDigits:0})
                                  : localBal.toLocaleString('en',{maximumFractionDigits:2})
                                } {currCode}
                              </p>
                            </div>
                          )}
                          {fxLiftLocal > 0.0001 && (
                            <div className="text-right">
                              <p className="text-[9px]" style={{ color:'var(--dp-muted)' }}>FX shield</p>
                              <p className="text-[9px] font-bold text-amber-500">+{fxLiftLocal.toFixed(4)} {currCode}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <ValueChip ican={w?.ican_balance||0}/>
                    <button onClick={()=>grantBonus(u.user_id,10)}
                      className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold text-amber-500 transition hover:bg-amber-500/20"
                      style={{ borderColor:'rgba(245,158,11,0.25)', background:'rgba(245,158,11,0.1)' }}>
                      <Gift size={9}/>+10
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {!loading&&filt(users,['account_holder_name','email']).length===0&&<EmptyState msg="No users found." Icon={Users}/>}
        </>)}

        {/* ══ COMPANIES ══ */}
        {tab==='companies' && (<>
          <div className="flex items-center justify-between">
            <p className="text-sm font-black" style={{ color:'var(--dp-txt)' }}>CMMS Companies <span style={{ color:'var(--dp-muted)' }}>({companies.length})</span></p>
            <p className="text-xs" style={{ color:'var(--dp-sub)' }}>{companies.reduce((s,c)=>s+Number(c.member_count||0),0)} members</p>
          </div>
          {loading&&[1,2,3].map(i=><Skel key={i} h="h-32"/>)}
          {filt(companies,['company_name','email','creator_name','creator_email','location']).map(c=>{
            const ow=walletMap[c.created_by]; const sub=subFor(c.created_by);
            return (
              <div key={c.id} className="rounded-2xl border p-4 transition-all" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background:'linear-gradient(135deg,#6366f1,#4f46e5)', boxShadow:'0 4px 12px #6366f144' }}>
                    <Layers size={18} className="text-white"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <p className="font-bold" style={{ color:'var(--dp-txt)' }}>{c.company_name||'—'}</p>
                      {sub?.plan&&<Badge label={sub.plan} cls={PLAN_BADGE[sub.plan]||''}/>}
                    </div>
                    <p className="text-xs" style={{ color:'var(--dp-sub)' }}>{c.email||'—'}{c.phone?` · ${c.phone}`:''}</p>
                    <p className="text-[10px]" style={{ color:'var(--dp-muted)' }}>{c.location||'—'}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-[10px]" style={{ color:'var(--dp-muted)' }}>
                      <span className="flex items-center gap-1"><Users size={9} style={{ color:'#6366f1' }}/>{fmt(c.member_count)} members</span>
                      <span className="flex items-center gap-1"><Database size={9} style={{ color:'#6366f1' }}/>{fmt(c.dept_count)} depts</span>
                      <span className="flex items-center gap-1"><Clock size={9}/>{fmtDate(c.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <ValueChip ican={ow?.ican_balance||0}/>
                    <CopyBtn text={c.id}/>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t flex items-center gap-2 flex-wrap" style={{ borderColor:'var(--dp-sep)' }}>
                  <Avatar name={c.creator_name} size={24} color="#6366f1"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color:'var(--dp-sub)' }}>{c.creator_name||'—'}</p>
                    <p className="text-[9px] truncate" style={{ color:'var(--dp-muted)' }}>{c.creator_email||'—'}</p>
                  </div>
                  <Badge label="owner" cls="bg-indigo-500/10 text-indigo-500 border-indigo-500/20"/>
                  {c.created_by&&(
                    <div className="flex gap-1 ml-auto">
                      {PLANS.map(plan=>(
                        <button key={plan} onClick={()=>upsertSub(c.created_by,plan,'company')}
                          className={`rounded-lg border px-2 py-0.5 text-[9px] font-bold capitalize transition ${sub?.plan===plan?PLAN_BADGE[plan]+' ring-1 ring-current':''}`}
                          style={sub?.plan!==plan?{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)', color:'var(--dp-sub)' }:{}}>{plan}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!loading&&companies.length===0&&<EmptyState msg="No CMMS companies yet." hint="Run CMMS_DEV_PANEL_FUNCTIONS.sql in Supabase first." Icon={Layers}/>}
        </>)}

        {/* ══ BUSINESSES ══ */}
        {tab==='businesses' && (<>
          <div className="grid grid-cols-2 gap-3 mb-2">
            <StatCard Icon={Building2}  label="Pitches"      value={fmt(businesses.length)} color="#10b981" loading={loading}/>
            <StatCard Icon={TrendingUp} label="Total Raised" value={fmtI(totalR)}           color="#06b6d4" loading={loading} sub={fmtUGX(totalR)}/>
          </div>
          {loading&&[1,2,3].map(i=><Skel key={i} h="h-32"/>)}
          {filt(businesses,['title','category','owner_name','owner_email','status']).map(b=>{
            const ow=walletMap[b.owner_id]; const sub=subFor(b.owner_id); const pr=pct(b.raised_amount,b.target_amount||1);
            return (
              <div key={b.id} className="rounded-2xl border p-4 transition-all" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background:'linear-gradient(135deg,#10b981,#059669)', boxShadow:'0 4px 12px #10b98144' }}>
                    <Building2 size={18} className="text-white"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <p className="font-bold" style={{ color:'var(--dp-txt)' }}>{b.title||'—'}</p>
                      <Badge label={b.status||'—'} cls={b.status==='active'?'bg-emerald-500/10 text-emerald-600 border-emerald-500/20':b.status==='funded'?'bg-cyan-500/10 text-cyan-600 border-cyan-500/20':'bg-slate-500/10 border-slate-500/20'} style={{ color:b.status?undefined:'var(--dp-muted)' }}/>
                      {sub?.plan&&<Badge label={sub.plan} cls={PLAN_BADGE[sub.plan]||''}/>}
                    </div>
                    <p className="text-xs" style={{ color:'var(--dp-muted)' }}>{b.category||'—'} · {fmtDate(b.created_at)}</p>
                  </div>
                  <ValueChip ican={ow?.ican_balance||0}/>
                </div>
                <div className="mb-3">
                  <PBar val={pr} color="#10b981"/>
                  <div className="mt-1 flex justify-between text-[10px]" style={{ color:'var(--dp-muted)' }}>
                    <span>{fmtI(b.raised_amount)} raised · {fmt(b.investor_count)} investors</span>
                    <span>Target {fmtI(b.target_amount)} ({pr.toFixed(0)}%)</span>
                  </div>
                </div>
                <div className="pt-3 border-t flex items-center gap-2 flex-wrap" style={{ borderColor:'var(--dp-sep)' }}>
                  <Avatar name={b.owner_name} size={24} color="#10b981"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color:'var(--dp-sub)' }}>{b.owner_name||'—'}</p>
                    <p className="text-[9px] truncate" style={{ color:'var(--dp-muted)' }}>{b.owner_email||'—'}</p>
                  </div>
                  <Badge label="owner" cls="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"/>
                  {b.owner_id&&(
                    <div className="flex gap-1 ml-auto">
                      {PLANS.map(plan=>(
                        <button key={plan} onClick={()=>upsertSub(b.owner_id,plan,'business')}
                          className={`rounded-lg border px-2 py-0.5 text-[9px] font-bold capitalize transition ${sub?.plan===plan?PLAN_BADGE[plan]+' ring-1 ring-current':''}`}
                          style={sub?.plan!==plan?{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)', color:'var(--dp-sub)' }:{}}>{plan}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!loading&&businesses.length===0&&<EmptyState msg="No PitchIn businesses yet." hint="Run CMMS_DEV_PANEL_FUNCTIONS.sql in Supabase first." Icon={Building2}/>}
        </>)}

        {/* ══ TRUST GROUPS ══ */}
        {tab==='groups' && (<>
          <p className="text-sm font-black" style={{ color:'var(--dp-txt)' }}>Trust Groups <span style={{ color:'var(--dp-muted)' }}>({groups.length})</span></p>
          {loading&&[1,2,3].map(i=><Skel key={i} h="h-24"/>)}
          {filt(groups,['group_name','name','description','owner_name','owner_email']).map(g=>{
            const ow=walletMap[g.owner_id||g.created_by]; const sub=subFor(g.owner_id||g.created_by);
            return (
              <div key={g.id} className="rounded-2xl border p-4 transition-all" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background:'linear-gradient(135deg,#f59e0b,#d97706)', boxShadow:'0 4px 12px #f59e0b44' }}>
                    <ShieldCheck size={18} className="text-white"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <p className="font-bold" style={{ color:'var(--dp-txt)' }}>{g.group_name||g.name||'—'}</p>
                      {sub?.plan&&<Badge label={sub.plan} cls={PLAN_BADGE[sub.plan]||''}/>}
                      {g.is_active!=null&&<Badge label={g.is_active?'active':'inactive'} cls={g.is_active?'bg-emerald-500/10 text-emerald-600 border-emerald-500/20':'bg-red-500/10 text-red-500 border-red-500/20'}/>}
                    </div>
                    {g.description&&<p className="text-xs line-clamp-1" style={{ color:'var(--dp-sub)' }}>{g.description}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-3 text-[10px]" style={{ color:'var(--dp-muted)' }}>
                      {g.member_count!=null&&<span className="flex items-center gap-1"><Users size={9} style={{ color:'#f59e0b' }}/>{fmt(g.member_count)} members</span>}
                      {g.total_savings!=null&&<span className="flex items-center gap-1"><Wallet size={9} style={{ color:'#f59e0b' }}/>{fmtI(g.total_savings)} ICAN</span>}
                      <span className="flex items-center gap-1"><Clock size={9}/>{fmtDate(g.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2"><ValueChip ican={ow?.ican_balance||0}/><CopyBtn text={g.id}/></div>
                </div>
                {(g.owner_name||g.owner_email)&&(
                  <div className="mt-3 pt-3 border-t flex items-center gap-2" style={{ borderColor:'var(--dp-sep)' }}>
                    <Avatar name={g.owner_name||'?'} size={24} color="#f59e0b"/>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color:'var(--dp-sub)' }}>{g.owner_name||'—'}</p>
                      <p className="text-[9px] truncate" style={{ color:'var(--dp-muted)' }}>{g.owner_email||'—'}</p>
                    </div>
                    <Badge label="admin" cls="bg-amber-500/10 text-amber-600 border-amber-500/20"/>
                  </div>
                )}
              </div>
            );
          })}
          {!loading&&groups.length===0&&<EmptyState msg="No trust groups yet." Icon={ShieldCheck}/>}
        </>)}

        {/* ══ AGENTS ══ */}
        {tab==='agents' && (<>
          <div className="grid grid-cols-2 gap-3 mb-2">
            <StatCard Icon={Briefcase} label="Agents"      value={fmt(agents.length)} color="#f97316" loading={loading}/>
            <StatCard Icon={Wallet}    label="Total Float" value={fmtI(totalFl)}      color="#f59e0b" loading={loading} sub={fmtUGX(totalFl)}/>
          </div>
          {floatError && <p className="mb-2 text-xs text-rose-400">{floatError}</p>}
          {loading&&[1,2,3].map(i=><Skel key={i} h="h-24"/>)}
          {filt(agents,['agent_name','agent_code']).map(a=>{
            const w=walletMap[a.user_id]; const sub=subFor(a.user_id);
            return (
              <div key={a.agent_id||a.id} className="rounded-2xl border p-4 transition-all" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
                <div className="flex items-start gap-3">
                  <Avatar name={a.agent_name} size={42} color="#f97316"/>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <p className="font-bold" style={{ color:'var(--dp-txt)' }}>{a.agent_name}</p>
                      <Badge label={a.is_active?'active':'inactive'} cls={a.is_active?'bg-emerald-500/10 text-emerald-600 border-emerald-500/20':'bg-slate-500/10 border-slate-500/20'} style={{ color:a.is_active?undefined:'var(--dp-muted)' }}/>
                      {sub?.plan&&<Badge label={sub.plan} cls={PLAN_BADGE[sub.plan]||''}/>}
                    </div>
                    <p className="text-xs" style={{ color:'var(--dp-muted)' }}>Code: {a.agent_code||'—'}</p>
                    <p className="text-[10px]" style={{ color:'var(--dp-muted)' }}>{fmtDate(a.created_at)}</p>
                    <div className="mt-1.5 flex gap-3 text-[10px]">
                      <span className="font-bold text-amber-500">{fmtI(a.float_balance)} float</span>
                      <span style={{ color:'var(--dp-muted)' }}>Settled: {fmtI(a.total_settled)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <ValueChip ican={w?.ican_balance||0}/>
                    {a.user_id&&(
                      <button onClick={()=>grantBonus(a.user_id,10)}
                        className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold text-amber-500 transition hover:bg-amber-500/20"
                        style={{ borderColor:'rgba(245,158,11,0.25)', background:'rgba(245,158,11,0.1)' }}>
                        <Gift size={9}/>+10
                      </button>
                    )}
                  </div>
                </div>
                {a.agent_id && (
                  <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-2" style={{ borderColor:'var(--dp-sep)' }}>
                    <select
                      value={floatDrafts[a.agent_id]?.currency || 'UGX'}
                      onChange={e => setFloatDrafts(prev => ({ ...prev, [a.agent_id]: { ...prev[a.agent_id], currency: e.target.value } }))}
                      className="rounded-lg border px-2 py-1.5 text-xs outline-none"
                      style={{ background:'var(--dp-input)', borderColor:'var(--dp-input-bd)', color:'var(--dp-txt)' }}>
                      <option value="UGX">UGX</option>
                      <option value="USD">USD</option>
                      <option value="KES">KES</option>
                    </select>
                    <input
                      type="number" min="0.01" step="0.01"
                      value={floatDrafts[a.agent_id]?.amount || ''}
                      onChange={e => setFloatDrafts(prev => ({ ...prev, [a.agent_id]: { ...prev[a.agent_id], amount: e.target.value } }))}
                      placeholder="Amount"
                      className="w-28 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                      style={{ background:'var(--dp-input)', borderColor:'var(--dp-input-bd)', color:'var(--dp-txt)' }}/>
                    <button onClick={()=>grantFloat(a.agent_id)} disabled={grantingFloatId===a.agent_id}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-white transition disabled:opacity-40"
                      style={{ background:'linear-gradient(135deg,#f59e0b,#b45309)' }}>
                      <Wallet size={9}/>{grantingFloatId===a.agent_id ? 'Working…' : 'Give Float'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {!loading&&agents.length===0&&<EmptyState msg="No agents yet." Icon={Briefcase}/>}
        </>)}

        {/* ══ BLOCKCHAIN ══ */}
        {tab==='blockchain' && (<>
          <div className="rounded-2xl border p-5 transition-colors"
            style={{ background:'var(--dp-card)', borderColor:'rgba(236,72,153,0.2)' }}>
            <div className="flex items-center gap-2 mb-4">
              <div className="h-6 w-6 rounded-lg flex items-center justify-center" style={{ background:'rgba(236,72,153,0.12)', border:'1px solid rgba(236,72,153,0.25)' }}>
                <Network size={12} className="text-pink-500"/>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--dp-muted)' }}>Network Status</p>
              <div className="ml-auto flex items-center gap-1.5"><GlowDot color="#10b981"/><span className="text-[10px] font-bold text-emerald-500">ONLINE</span></div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label:'Floor price',  val:`${fmt(market?.price_ugx??5000)} UGX`, color:'#06b6d4' },
                { label:'24h change',   val:market?`${priceChg>=0?'+':''}${priceChg.toFixed(2)}%`:'—', color:priceChg>=0?'#10b981':'#ef4444' },
                { label:'Market cap',   val:`UGX ${fmt(market?.market_cap)}`, color:'#8b5cf6' },
                { label:'Supply',       val:`${fmtI(totalI)} ICAN`, color:'#f59e0b' },
              ].map(r=>(
                <div key={r.label} className="rounded-xl border p-3 transition-colors"
                  style={{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)' }}>
                  <p className="text-sm font-black" style={{ color:r.color }}>{r.val}</p>
                  <p className="text-[10px] uppercase tracking-widest mt-1" style={{ color:'var(--dp-muted)' }}>{r.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border p-4 transition-colors"
            style={{ background:'var(--dp-card)', borderColor:'rgba(245,158,11,0.2)' }}>
            <ShieldCheck size={16} className="text-amber-500 flex-shrink-0 mt-0.5"/>
            <div>
              <p className="text-xs font-bold text-amber-500">Blockchain-Token Security Active</p>
              <p className="text-[10px] mt-0.5" style={{ color:'var(--dp-muted)' }}>Every call carries a signed token verified server-side (SECURITY DEFINER). No raw table access exposed.</p>
            </div>
          </div>

          {(() => {
            const byType=txs.reduce((acc,tx)=>{ const k=tx.tx_type||'unknown'; if(!acc[k]) acc[k]={count:0,total:0}; acc[k].count++; acc[k].total+=Number(tx.ican_amount||0); return acc; },{});
            return Object.keys(byType).length>0&&(
              <div className="rounded-2xl border p-5 transition-colors" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color:'var(--dp-muted)' }}>Transaction Summary</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Object.entries(byType).map(([type,d])=>(
                    <div key={type} className="rounded-xl border p-3 transition-colors" style={{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)' }}>
                      <p className="text-2xl font-black text-cyan-500">{d.count}</p>
                      <p className="text-xs capitalize font-medium" style={{ color:'var(--dp-sub)' }}>{type}</p>
                      <p className="text-[10px]" style={{ color:'var(--dp-muted)' }}>{fmtI(d.total)} ICAN</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <p className="text-sm font-black" style={{ color:'var(--dp-txt)' }}>Recent Transactions <span style={{ color:'var(--dp-muted)' }}>({txs.length})</span></p>
          {loading&&[1,2,3].map(i=><Skel key={i} h="h-16"/>)}
          {txs.slice(0,50).map(tx=>(
            <div key={tx.id} className="rounded-2xl border p-4 transition-all" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-pink-500">{truncHash(tx.tx_hash)}</span>
                    <CopyBtn text={tx.tx_hash||''}/>
                  </div>
                  <p className="text-[10px]" style={{ color:'var(--dp-muted)' }}>Type: {tx.tx_type||'—'} · Block #{fmt(tx.block_number)} · {fmtTime(tx.created_at)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-black text-cyan-500">{fmtI(tx.ican_amount)} ICAN</p>
                  <Badge label={tx.status||'—'} cls={tx.status==='confirmed'?'bg-emerald-500/10 text-emerald-600 border-emerald-500/20':tx.status==='pending'?'bg-amber-500/10 text-amber-600 border-amber-500/20':'border-slate-500/20'} style={{ color:tx.status?undefined:'var(--dp-muted)' }}/>
                </div>
              </div>
            </div>
          ))}
          {!loading&&txs.length===0&&<EmptyState msg="No blockchain transactions yet." Icon={Hash}/>}
        </>)}

        {/* ══ PLANS ══ */}
        {tab==='plans' && (<>
          {!subsOk ? (
            <div className="rounded-2xl border p-5" style={{ background:'var(--dp-card)', borderColor:'rgba(245,158,11,0.2)' }}>
              <p className="font-bold text-amber-500 mb-2">Subscriptions table not available</p>
              <p className="text-sm" style={{ color:'var(--dp-sub)' }}>Run DEV_PANEL_ACCESS.sql in Supabase SQL Editor, then refresh.</p>
            </div>
          ) : (<>
            <div className="grid grid-cols-3 gap-3">
              {PLANS.map(plan=>{
                const cnt=subs.filter(s=>s.plan===plan&&s.active).length;
                return (
                  <div key={plan} className={`rounded-2xl border border-white/10 p-5 bg-gradient-to-br ${PLAN_META[plan].grad}`}>
                    <p className="text-3xl font-black text-white">{cnt}</p>
                    <p className="text-[10px] uppercase tracking-widest text-white/70 mt-1 capitalize">{plan}</p>
                    <p className="text-[10px] text-white/40 mt-0.5">{PLAN_META[plan].price}</p>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border p-4 transition-colors" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color:'var(--dp-muted)' }}>Bulk Apply — All Users</p>
              <div className="flex flex-wrap gap-2">
                {PLANS.map(plan=>(
                  <button key={plan} onClick={async()=>{ for(const u of users) await upsertSub(u.user_id,plan,'user'); }}
                    className={`rounded-xl border border-white/10 px-4 py-2 text-xs font-bold capitalize text-white bg-gradient-to-r ${PLAN_META[plan].grad} transition hover:opacity-90`}>
                    Set All → {plan}
                  </button>
                ))}
              </div>
            </div>

            {users.map(u=>{
              const sub=subFor(u.user_id); const w=walletMap[u.user_id];
              return (
                <div key={u.user_id} className="rounded-2xl border p-4 transition-all" style={{ background:'var(--dp-card)', borderColor:'var(--dp-card-bd)' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={u.account_holder_name} size={38}/>
                      <div className="min-w-0">
                        <p className="font-semibold truncate" style={{ color:'var(--dp-txt)' }}>{u.account_holder_name||'—'}</p>
                        <p className="text-xs truncate" style={{ color:'var(--dp-sub)' }}>{u.email}</p>
                        <p className="text-[10px]" style={{ color:'var(--dp-muted)' }}>{fmtI(w?.ican_balance||0)} ICAN</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center flex-shrink-0">
                      {PLANS.map(plan=>(
                        <button key={plan} onClick={()=>upsertSub(u.user_id,plan,'user')}
                          className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold capitalize transition ${sub?.plan===plan?PLAN_BADGE[plan]+' ring-1 ring-current':''}`}
                          style={sub?.plan!==plan?{ background:'var(--dp-inner)', borderColor:'var(--dp-inner-bd)', color:'var(--dp-sub)' }:{}}>{plan}</button>
                      ))}
                      {sub&&(
                        <button onClick={()=>toggleSub(sub.id,sub.active)}
                          className={`flex items-center gap-0.5 rounded-lg border px-2 py-1 text-[10px] font-bold transition ${sub.active?'border-red-500/20 bg-red-500/10 text-red-500':'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'}`}>
                          {sub.active?<><ToggleLeft size={10}/>Pause</>:<><ToggleRight size={10}/>Resume</>}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </>)}
        </>)}

        {/* ══ PUBLIC BOARD ══ */}
        {tab==='board' && <PublicBoardTab/>}
        {tab==='messages' && <MessagesTab/>}
        {tab==='recovery' && <RecoveryTab/>}

      </main>
    </div>
  );
};

// =============================================================================
// LOGIN GATE
// =============================================================================
const LoginGate = ({ onAuth }) => {
  const [token, setToken] = useState('');
  const [err,   setErr]   = useState('');
  const [vis,   setVis]   = useState(false);
  const [shake, setShake] = useState(false);
  const ref = useRef(null);
  useEffect(()=>{ ref.current?.focus(); },[]);

  const submit = e => {
    e.preventDefault();
    if (token === DEV_TOKEN) { sessionStorage.setItem(SESSION_KEY,'true'); onAuth(); }
    else { setErr('Invalid security token.'); setShake(true); setTimeout(()=>{ setErr(''); setShake(false); },2000); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 font-sans"
      style={{ background:'linear-gradient(160deg,#07091a,#0d1124,#07091a)' }}>
      <div className={`w-full max-w-sm transition-transform duration-150 ${shake?'translate-x-1':''}`}>
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 relative flex h-16 w-16 items-center justify-center rounded-3xl"
            style={{ background:'linear-gradient(135deg,#06b6d4,#0284c7)', boxShadow:'0 0 40px #06b6d460' }}>
            <Shield size={28} className="text-white"/>
            <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 bg-emerald-400"
              style={{ borderColor:'#07091a', boxShadow:'0 0 10px #10b981' }}/>
          </div>
          <h1 className="text-2xl font-black text-white">ICAN Dev Console</h1>
          <p className="mt-1 text-xs tracking-widest" style={{ color:'#475569' }}>BLOCKCHAIN-SECURED ACCESS</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <Lock size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color:'#475569' }}/>
            <input ref={ref} type={vis?'text':'password'} value={token} onChange={e=>setToken(e.target.value)}
              placeholder="Enter security token…"
              className="w-full rounded-2xl border py-3.5 pl-10 pr-11 text-sm text-white outline-none transition"
              style={{ background:'rgba(255,255,255,0.06)', borderColor:'rgba(255,255,255,0.1)' }}/>
            <button type="button" onClick={()=>setVis(v=>!v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 transition" style={{ color:'#475569' }}>
              {vis?<EyeOff size={13}/>:<Eye size={13}/>}
            </button>
          </div>
          {err&&(
            <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
              <AlertTriangle size={12} className="text-red-400"/><p className="text-[11px] text-red-400">{err}</p>
            </div>
          )}
          <button type="submit" disabled={!token}
            className="w-full rounded-2xl py-3.5 text-sm font-black text-white transition disabled:opacity-30"
            style={{ background:'linear-gradient(135deg,#06b6d4,#0284c7)', boxShadow:token?'0 0 24px #06b6d430':'none' }}>
            Access Console
          </button>
        </form>
        <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-amber-500/15 bg-amber-500/[0.05] p-3.5">
          <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5"/>
          <p className="text-[10px] leading-relaxed" style={{ color:'rgba(251,191,36,0.7)' }}>Authorized personnel only. All access is logged on the ICAN blockchain.</p>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// ROOT
// =============================================================================
const ICANDevPanel = ({ onExit }) => {
  const [authed, setAuthed] = useState(sessionStorage.getItem(SESSION_KEY)==='true');
  const exit = () => { sessionStorage.removeItem(SESSION_KEY); setAuthed(false); onExit?.(); };
  if (!authed) return <LoginGate onAuth={()=>setAuthed(true)}/>;
  return <ICANDevDashboard onExit={exit}/>;
};

export default ICANDevPanel;
