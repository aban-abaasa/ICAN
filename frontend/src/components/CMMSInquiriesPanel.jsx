import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Inbox, Loader, Mail, MessageCircle, Phone, RefreshCw, Send, Sparkles, User } from 'lucide-react';
import businessChatService from '../services/businessChatService';

/**
 * Lives inside the Jobs & Announcements panel (CMMSAnnouncementsPanel.jsx) as its "Inquiries" sub-tab: the staff
 * side of the "Ask us" bubble on the company's public website. A visitor who wants a person (after chatting with
 * the AI assistant, or straight away) becomes a thread here; staff reply and the visitor sees the answer in the
 * same bubble. The visitor's phone/email is shown too, so staff can also just call or WhatsApp them.
 * Visible to anyone who can edit the board or manage applications (the same rule the database enforces).
 */

const STATUS_LABELS = { open: 'Needs reply', answered: 'Answered', resolved: 'Resolved' };
const STATUS_STYLES = {
  open: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  answered: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
  resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
};

const timeAgo = (iso) => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

const contactLinks = (contact) => {
  const value = String(contact || '').trim();
  if (value.includes('@')) return [{ key: 'mail', href: `mailto:${value}`, icon: Mail, label: 'Email' }];
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length < 7) return [];
  return [
    { key: 'call', href: `tel:+${digits}`.replace('++', '+'), icon: Phone, label: 'Call' },
    { key: 'wa', href: `https://wa.me/${digits}`, icon: MessageCircle, label: 'WhatsApp', external: true },
  ];
};

export default function CMMSInquiriesPanel({ companyId, onUnreadChange }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('active'); // 'active' | 'all'
  const [selectedId, setSelectedId] = useState(null);
  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);
  const endRef = useRef(null);

  const loadList = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const result = await businessChatService.listInquiries(companyId);
    if (result.success) {
      setThreads(result.data);
      setError('');
      onUnreadChange?.(result.data.filter((t) => t.staff_unread).length);
    } else if (!quiet) {
      setError(result.error || 'Could not load inquiries.');
    }
    setLoading(false);
  }, [companyId, onUnreadChange]);

  useEffect(() => {
    loadList();
    const id = setInterval(() => { if (document.visibilityState === 'visible') loadList({ quiet: true }); }, 30000);
    return () => clearInterval(id);
  }, [loadList]);

  const openThread = useCallback(async (id, { quiet = false } = {}) => {
    setSelectedId(id);
    if (!quiet) setThreadLoading(true);
    const result = await businessChatService.getInquiryThread(id);
    if (result.success) { setThread(result.data); setError(''); } else setError(result.error || 'Could not open this inquiry.');
    setThreadLoading(false);
    loadList({ quiet: true }); // opening marks it read
  }, [loadList]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages?.length]);

  // keep an open conversation fresh while the visitor may be typing back
  useEffect(() => {
    if (!selectedId) return undefined;
    const id = setInterval(() => { if (document.visibilityState === 'visible') openThread(selectedId, { quiet: true }); }, 20000);
    return () => clearInterval(id);
  }, [selectedId, openThread]);

  const sendReply = async (e) => {
    e.preventDefault();
    const body = reply.trim();
    if (!body || saving || !selectedId) return;
    setSaving(true);
    const result = await businessChatService.replyToInquiry(selectedId, body);
    setSaving(false);
    if (!result.success) { setError(result.error || 'Could not send your reply.'); return; }
    setReply('');
    openThread(selectedId, { quiet: true });
  };

  const changeStatus = async (status) => {
    if (!selectedId) return;
    const result = await businessChatService.setInquiryStatus(selectedId, status);
    if (!result.success) { setError(result.error || 'Could not update this inquiry.'); return; }
    openThread(selectedId, { quiet: true });
  };

  const visible = threads.filter((t) => filter === 'all' || t.status !== 'resolved');
  const unreadCount = threads.filter((t) => t.staff_unread).length;

  const list = (
    <div className={`${selectedId ? 'hidden lg:block' : ''} space-y-2`}>
      <div className="flex items-center gap-2 text-xs">
        {[['active', 'Active'], ['all', 'All']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} className={`px-3 py-1.5 rounded-full border ${filter === id ? 'cmms-classic-btn-primary' : 'cmms-classic-btn-secondary'} !h-auto !min-h-0`}>{label}</button>
        ))}
        <button type="button" onClick={() => loadList()} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-2.5 py-1.5 ml-auto inline-flex items-center gap-1" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-purple-400 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <div className="cmms-classic-card p-8 text-center cmms-classic-muted">
          <Inbox className="w-10 h-10 mx-auto mb-3 opacity-50" />
          No inquiries yet. When a visitor to your public page asks to speak to your team, it shows up here.
        </div>
      ) : (
        visible.map((t) => (
          <button
            key={t.thread_id}
            type="button"
            onClick={() => openThread(t.thread_id)}
            className={`w-full text-left cmms-classic-card p-3 transition ${selectedId === t.thread_id ? 'ring-1 ring-purple-400/60' : ''}`}
          >
            <div className="flex items-center gap-2">
              {t.staff_unread && <span className="w-2 h-2 rounded-full bg-rose-400 flex-shrink-0" aria-label="Unread" />}
              <span className="font-semibold text-white truncate flex-1">{t.visitor_name}</span>
              <span className="text-[11px] cmms-classic-muted flex-shrink-0">{timeAgo(t.last_message_at)}</span>
            </div>
            <p className="text-sm cmms-classic-muted truncate mt-0.5">{t.last_sender === 'staff' ? 'You: ' : ''}{t.last_message}</p>
            <span className={`inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLES[t.status]}`}>{STATUS_LABELS[t.status]}</span>
          </button>
        ))
      )}
    </div>
  );

  const conversation = (
    <div className={`${selectedId ? '' : 'hidden lg:flex'} cmms-classic-card p-0 flex-col min-h-[420px] lg:min-h-[520px] max-h-[75vh]`} style={{ display: selectedId ? 'flex' : undefined }}>
      {!selectedId ? (
        <div className="m-auto text-center cmms-classic-muted p-8">
          <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
          Pick a conversation to read and reply.
        </div>
      ) : threadLoading || !thread ? (
        <div className="m-auto"><Loader className="w-6 h-6 text-purple-400 animate-spin" /></div>
      ) : (
        <>
          <div className="p-3 border-b border-white/10 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setSelectedId(null); setThread(null); }} className="lg:hidden cmms-classic-btn-secondary !h-auto !min-h-0 px-2 py-1.5" aria-label="Back to the list"><ArrowLeft className="w-4 h-4" /></button>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white truncate">{thread.visitor_name}</p>
              <p className="text-xs cmms-classic-muted truncate">{thread.visitor_contact}</p>
            </div>
            {contactLinks(thread.visitor_contact).map((link) => (
              <a key={link.key} href={link.href} target={link.external ? '_blank' : undefined} rel={link.external ? 'noreferrer' : undefined} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-2.5 py-1.5 text-xs inline-flex items-center gap-1">
                <link.icon className="w-3.5 h-3.5" /> {link.label}
              </a>
            ))}
            <select value={thread.status} onChange={(e) => changeStatus(e.target.value)} className="text-xs rounded bg-slate-900 border border-white/20 px-2 py-1.5 text-white" aria-label="Status">
              {Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
            {thread.messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === 'staff' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[85%]">
                  <p className={`text-[10px] font-bold cmms-classic-muted mb-0.5 flex items-center gap-1 ${m.sender === 'staff' ? 'justify-end' : ''}`}>
                    {m.sender === 'staff' ? 'Your team' : m.sender === 'assistant' ? <><Sparkles className="w-3 h-3" /> AI assistant</> : <><User className="w-3 h-3" /> {thread.visitor_name}</>}
                    <span className="font-normal opacity-70">· {timeAgo(m.created_at)}</span>
                  </p>
                  <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${m.sender === 'staff' ? 'bg-purple-600 text-white' : m.sender === 'assistant' ? 'bg-slate-800/70 text-slate-300 italic' : 'bg-slate-700 text-white'}`}>{m.body}</div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <form onSubmit={sendReply} className="p-3 border-t border-white/10 flex items-end gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value.slice(0, 2000))}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(e); }}
              rows={2}
              placeholder="Write a reply… (the visitor sees it in the chat bubble on your site)"
              className="flex-1 rounded bg-slate-900 border border-white/20 px-3 py-2 text-white text-sm resize-none"
            />
            <button type="submit" disabled={!reply.trim() || saving} className="cmms-classic-btn-primary px-4 py-2 text-sm disabled:opacity-50 inline-flex items-center gap-1.5">
              {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Reply
            </button>
          </form>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="cmms-classic-card p-3 text-sm cmms-classic-muted flex items-start gap-2">
        <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-400" />
        <span>
          Visitors on your public page chat with an AI assistant that answers from your page's details. When they want a person,
          the conversation lands here{unreadCount > 0 ? ` (${unreadCount} waiting for a reply)` : ''}. Replies appear in their chat bubble.
        </span>
      </div>
      {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr] items-start">
        {list}
        {conversation}
      </div>
    </div>
  );
}
