import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, X, Send, Loader, Sparkles, User, ArrowRight, CheckCircle2, Users } from 'lucide-react';
import { askAssistant, startInquiry, sendInquiryMessage, getInquiry } from '../services/businessChatService';

/**
 * The floating "Ask us" bubble on a business's public website (rendered inside PublicCompanyNoticeBoard, so it
 * inherits that page's own scoped light/dark palette -- the nb-* classes).
 *
 *   Assistant  -- an AI that answers from the business's public facts (api/business-chat.js). Replies can carry
 *                 buttons that jump to a page of the site (Careers, Market, Pay...) and follow-up suggestions.
 *   Team       -- a real conversation with the business's staff. Visitors leave a name and a phone/email (no
 *                 account) and keep a private token in this browser to read replies and write back; staff answer
 *                 from CMMS. A dot on the bubble says the team has replied.
 */

const GREETING_ID = 'greeting';
const MAX_INPUT = 600;
const POLL_OPEN_MS = 12000;
const POLL_CLOSED_MS = 60000;

const read = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
const write = (storage, key, value) => { try { if (value == null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* storage blocked */ } };
const readJson = (storage, key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };

const formatTime = (iso) => {
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
};

// Explicit colours (not stock Tailwind utilities): this page's palette repaints those, which turned the active tab dark.
const ACTIVE_SEGMENT = { background: '#ffffff', color: '#0f1613' };

const WIDGET_STYLES = `
@keyframes nb-chat-dot { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
.nb-chat-dot { width: 6px; height: 6px; border-radius: 9999px; background: var(--nb-text-faint); animation: nb-chat-dot 1.2s infinite ease-in-out; }
.nb-chat-dot:nth-child(2) { animation-delay: .15s; } .nb-chat-dot:nth-child(3) { animation-delay: .3s; }
@keyframes nb-chat-pop { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
.nb-chat-sheet { animation: nb-chat-pop .22s ease-out; }
.nb-chat-fab { box-shadow: 0 10px 28px -8px rgba(0,0,0,.45); }
@media (prefers-reduced-motion: reduce) { .nb-chat-dot, .nb-chat-sheet { animation: none; } }
`;

export default function BusinessChatWidget({ company, companyId, availableTabs = [], onNavigate, jobCount = 0, noticeCount = 0, payOnline = false }) {
  const tokenKey = `nb_inquiry_token_${companyId}`;
  const seenKey = `nb_inquiry_seen_${companyId}`;
  const chatKey = `nb_chat_${companyId}`;
  const visitorKey = `nb_chat_visitor_${companyId}`;

  const [open, setOpen] = useState(false);
  const [view, setView] = useState('assistant'); // 'assistant' | 'handoff' | 'thread'
  const [token, setToken] = useState(() => read(localStorage, tokenKey));
  const [messages, setMessages] = useState(() => readJson(sessionStorage, chatKey, []));
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [thread, setThread] = useState(null); // { status, messages }
  const [threadError, setThreadError] = useState('');
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(false);
  const [form, setForm] = useState(() => ({ name: '', contact: '', message: '', ...readJson(localStorage, visitorKey, {}) }));
  const [formError, setFormError] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const openRef = useRef(open);
  openRef.current = open;

  const tabIds = useMemo(() => new Set(availableTabs), [availableTabs]);
  const name = company.company_name;

  // ---- starter questions: only things this business can actually answer ----
  const starters = useMemo(() => [
    company.hours_text && 'What are your opening hours?',
    jobCount > 0 && 'Are you hiring?',
    (company.location || company.google_maps_url) && 'Where are you located?',
    tabIds.has('shop') && 'What do you offer?',
    payOnline && 'How can I pay?',
    noticeCount > 0 && "What's new?",
  ].filter(Boolean).slice(0, 4), [company.hours_text, company.location, company.google_maps_url, jobCount, noticeCount, payOnline, tabIds]);

  const greeting = useMemo(() => ({
    id: GREETING_ID, role: 'assistant', local: true,
    text: `Hi! I'm the ${name} assistant. Ask me anything about us, or talk to the team directly.`,
  }), [name]);
  const shown = useMemo(() => [greeting, ...messages], [greeting, messages]);

  useEffect(() => { write(sessionStorage, chatKey, JSON.stringify(messages.slice(-30))); }, [messages, chatKey]);

  // keep the newest message in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, thinking, thread?.messages?.length, view, open]);

  // ---- the team thread: load, poll, unread dot ----
  const loadThread = useCallback(async () => {
    if (!token) return null;
    try {
      const data = await getInquiry(token);
      setThread({ status: data.status, messages: data.messages || [] });
      setThreadError('');
      const lastStaff = [...(data.messages || [])].reverse().find((m) => m.sender === 'staff');
      if (lastStaff) {
        if (openRef.current) { write(localStorage, seenKey, lastStaff.id); setUnread(false); }
        else setUnread(read(localStorage, seenKey) !== lastStaff.id);
      }
      return data;
    } catch (err) {
      // The thread was deleted (or the token is stale): forget it rather than show a broken Team tab.
      if (/could not be found/i.test(err.message)) { write(localStorage, tokenKey, null); setToken(null); setThread(null); setView('assistant'); }
      else setThreadError(err.message);
      return null;
    }
  }, [token, seenKey, tokenKey]);

  useEffect(() => {
    if (!token) return undefined;
    loadThread();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') loadThread();
    }, open && view === 'thread' ? POLL_OPEN_MS : POLL_CLOSED_MS);
    return () => clearInterval(id);
  }, [token, open, view, loadThread]);

  // ---- open / close ----
  const openWidget = () => {
    setOpen(true);
    if (token && unread) setView('thread');
    setTimeout(() => inputRef.current?.focus(), 60);
  };
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    if (open && view === 'thread' && thread?.messages) {
      const lastStaff = [...thread.messages].reverse().find((m) => m.sender === 'staff');
      if (lastStaff) { write(localStorage, seenKey, lastStaff.id); setUnread(false); }
    }
  }, [open, view, thread, seenKey]);

  // ---- assistant ----
  const ask = async (rawText) => {
    const text = rawText.trim().slice(0, MAX_INPUT);
    if (!text || thinking) return;
    const userMessage = { id: `u${Date.now()}`, role: 'user', text };
    const next = [...messages, userMessage];
    setMessages(next);
    setInput('');
    setThinking(true);
    const history = next.filter((m) => !m.local && !m.error).map((m) => ({ role: m.role, text: m.text }));
    try {
      const answer = await askAssistant(companyId, history);
      setMessages((current) => [...current, { id: `a${Date.now()}`, role: 'assistant', text: answer.reply, needsHuman: answer.needsHuman, suggestions: answer.suggestions, actions: answer.actions.filter((a) => tabIds.has(a.tab)) }]);
    } catch (err) {
      setMessages((current) => [...current, { id: `e${Date.now()}`, role: 'assistant', error: true, needsHuman: true, text: `${err.message} You can leave a message for the team instead.` }]);
    } finally {
      setThinking(false);
    }
  };

  const goTo = (tab) => {
    onNavigate?.(tab);
    if (window.matchMedia?.('(max-width: 639px)').matches) setOpen(false);
  };

  // ---- hand off to the team ----
  const openHandoff = () => {
    const lastQuestion = [...messages].reverse().find((m) => m.role === 'user')?.text || '';
    setForm((f) => ({ ...f, message: f.message || lastQuestion }));
    setFormError('');
    setView(token ? 'thread' : 'handoff');
  };

  const submitHandoff = async (e) => {
    e.preventDefault();
    if (sending) return;
    setFormError('');
    setSending(true);
    try {
      let transcript = messages.filter((m) => !m.local && !m.error).map((m) => ({ role: m.role, text: m.text }));
      // The question is usually the visitor's last chat message (the form is prefilled with it): don't list it
      // twice. Cut the transcript back to the turn before it, dropping the assistant's "ask the team" answer too.
      const sameAsLast = transcript.map((t) => t.role === 'user' && t.text.trim() === form.message.trim()).lastIndexOf(true);
      if (sameAsLast !== -1) transcript = transcript.slice(0, sameAsLast);
      const newToken = await startInquiry({ companyId, name: form.name, contact: form.contact, message: form.message, transcript });
      write(localStorage, tokenKey, newToken);
      write(localStorage, visitorKey, JSON.stringify({ name: form.name, contact: form.contact }));
      setToken(newToken);
      setForm((f) => ({ ...f, message: '' }));
      setView('thread');
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSending(false);
    }
  };

  const sendToTeam = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending || !token) return;
    setSending(true);
    setThreadError('');
    try {
      await sendInquiryMessage(token, text);
      setInput('');
      await loadThread();
    } catch (err) {
      setThreadError(err.message);
    } finally {
      setSending(false);
    }
  };

  const submitInput = (e) => {
    e.preventDefault();
    if (view === 'thread') sendToTeam();
    else ask(input);
  };

  const lastIndex = shown.length - 1;
  const teamLabel = token ? 'Team' : 'Talk to the team';

  return (
    <>
      <style>{WIDGET_STYLES}</style>

      {!open && (
        <button
          type="button"
          onClick={openWidget}
          aria-label={`Chat with ${name}`}
          className="nb-chat-fab nb-btn-primary fixed z-40 right-4 sm:right-6 bottom-[calc(76px+env(safe-area-inset-bottom))] sm:bottom-6 h-14 pl-4 pr-5 rounded-full flex items-center gap-2 font-bold text-sm transition-transform hover:scale-[1.04] active:scale-[0.97]"
        >
          <MessageCircle className="w-5 h-5" />
          <span>Ask us</span>
          {unread && <span className="nb-badge-count absolute -top-1 -right-1 w-4 h-4 rounded-full border-2" style={{ borderColor: 'var(--nb-bg)' }} aria-label="The team has replied" />}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={`Chat with ${name}`}
          className="nb-chat-sheet nb-surface nb-text fixed z-[45] inset-0 sm:inset-auto sm:right-6 sm:bottom-6 sm:w-[390px] sm:h-[600px] sm:max-h-[calc(100vh-3rem)] sm:rounded-2xl sm:border nb-border flex flex-col overflow-hidden shadow-2xl"
        >
          {/* header */}
          <div className="nb-btn-primary flex-shrink-0 px-4 pt-3 pb-3">
            <div className="flex items-center gap-3">
              {company.logo_url ? (
                <img src={company.logo_url} alt="" className="w-9 h-9 rounded-full object-cover bg-white/90" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center font-bold">{name?.charAt(0)?.toUpperCase()}</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-bold leading-tight truncate">{name}</p>
                <p className="text-[11px] opacity-85 truncate">
                  {view === 'thread' ? 'Chatting with the team' : 'AI assistant · the team follows up'}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/15 text-xs font-bold" role="tablist" aria-label="Chat with">
              <button type="button" role="tab" aria-selected={view === 'assistant'} onClick={() => setView('assistant')} style={view === 'assistant' ? ACTIVE_SEGMENT : undefined} className="py-1.5 rounded-lg flex items-center justify-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Assistant
              </button>
              <button type="button" role="tab" aria-selected={view !== 'assistant'} onClick={openHandoff} style={view !== 'assistant' ? ACTIVE_SEGMENT : undefined} className="py-1.5 rounded-lg flex items-center justify-center gap-1.5 relative">
                <Users className="w-3.5 h-3.5" /> {teamLabel}
                {unread && <span className="nb-badge-count w-2 h-2 rounded-full" aria-label="New reply" />}
              </button>
            </div>
          </div>

          {/* body */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3 space-y-3" aria-live="polite">
            {view === 'assistant' && (
              <>
                {shown.map((m, i) => (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[85%]">
                      <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${m.role === 'user' ? 'nb-btn-primary rounded-br-md' : 'nb-surface-alt nb-text rounded-bl-md'}`}>
                        {m.text}
                      </div>
                      {m.role === 'assistant' && !m.local && (m.actions?.length > 0 || m.needsHuman) && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {m.actions?.map((a) => (
                            <button key={`${a.tab}-${a.label}`} type="button" onClick={() => goTo(a.tab)} className="nb-action-btn rounded-full px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1">
                              {a.label} <ArrowRight className="w-3 h-3" />
                            </button>
                          ))}
                          {m.needsHuman && (
                            <button type="button" onClick={openHandoff} className="nb-btn-primary rounded-full px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1">
                              <Users className="w-3 h-3" /> Message the team
                            </button>
                          )}
                        </div>
                      )}
                      {i === lastIndex && !thinking && (m.suggestions?.length > 0 || (m.local && starters.length > 0)) && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {(m.local ? starters : m.suggestions).map((s) => (
                            <button key={s} type="button" onClick={() => ask(s)} className="nb-option rounded-full px-3 py-1.5 text-xs font-semibold">
                              {s}
                            </button>
                          ))}
                          {m.local && (
                            <button type="button" onClick={openHandoff} className="nb-option rounded-full px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1">
                              <Users className="w-3 h-3" /> Talk to the team
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {thinking && (
                  <div className="flex justify-start">
                    <div className="nb-surface-alt rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5" aria-label="The assistant is typing">
                      <span className="nb-chat-dot" /><span className="nb-chat-dot" /><span className="nb-chat-dot" />
                    </div>
                  </div>
                )}
              </>
            )}

            {view === 'handoff' && (
              <form onSubmit={submitHandoff} className="space-y-3">
                <div className="nb-surface-alt rounded-2xl p-3.5 text-sm leading-relaxed">
                  <p className="font-bold nb-text mb-0.5">Message the team</p>
                  <p className="nb-text-muted text-[13px]">Leave your details and a real person at {name} will reply here, and can reach you by phone or email too.</p>
                </div>
                <label className="block">
                  <span className="text-xs font-semibold nb-text-muted">Your name</span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} autoComplete="name" required className="nb-input mt-1 w-full rounded-xl px-3 py-2.5 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold nb-text-muted">Phone or email</span>
                  <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} maxLength={120} autoComplete="email" inputMode="email" placeholder="+256 7… or you@example.com" required className="nb-input mt-1 w-full rounded-xl px-3 py-2.5 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold nb-text-muted">Your question</span>
                  <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} maxLength={2000} rows={4} required className="nb-input mt-1 w-full rounded-xl px-3 py-2.5 text-sm resize-none" />
                </label>
                {formError && <p className="nb-error-text text-xs" role="alert">{formError}</p>}
                <button type="submit" disabled={sending} className="nb-btn-primary w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                  {sending ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to the team
                </button>
                <p className="text-[11px] nb-text-faint text-center">We keep this conversation in your browser so you can come back to it. No account needed.</p>
              </form>
            )}

            {view === 'thread' && (
              <>
                {!thread && !threadError && <div className="flex justify-center py-10"><Loader className="w-5 h-5 nb-link animate-spin" /></div>}
                {thread && (
                  <div className="nb-chip-green rounded-xl px-3 py-2 text-xs flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-px" />
                    <span>{thread.status === 'resolved' ? 'This conversation was marked resolved. Write again to reopen it.' : "Message sent. The team will reply here, so check back soon."}</span>
                  </div>
                )}
                {thread?.messages?.map((m) => (
                  <div key={m.id} className={`flex ${m.sender === 'visitor' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[85%]">
                      {m.sender !== 'visitor' && (
                        <p className="text-[10px] font-bold nb-text-faint mb-0.5 ml-1 flex items-center gap-1">
                          {m.sender === 'staff' ? <><User className="w-3 h-3" /> {name} team</> : <><Sparkles className="w-3 h-3" /> Assistant</>}
                        </p>
                      )}
                      <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${m.sender === 'visitor' ? 'nb-btn-primary rounded-br-md' : m.sender === 'staff' ? 'nb-chip-green rounded-bl-md' : 'nb-surface-alt nb-text rounded-bl-md'}`}>
                        {m.body}
                      </div>
                      <p className={`text-[10px] nb-text-faint mt-0.5 mx-1 ${m.sender === 'visitor' ? 'text-right' : ''}`}>{formatTime(m.created_at)}</p>
                    </div>
                  </div>
                ))}
                {threadError && <p className="nb-error-text text-xs text-center" role="alert">{threadError}</p>}
              </>
            )}
          </div>

          {/* composer */}
          {view !== 'handoff' && (
            <form onSubmit={submitInput} className="flex-shrink-0 border-t nb-border p-2.5 flex items-end gap-2" style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, view === 'thread' ? 2000 : MAX_INPUT))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitInput(e); } }}
                rows={1}
                placeholder={view === 'thread' ? 'Write to the team…' : 'Ask a question…'}
                aria-label={view === 'thread' ? 'Message to the team' : 'Your question'}
                className="nb-input flex-1 rounded-xl px-3 py-2.5 text-sm resize-none max-h-28"
              />
              <button type="submit" disabled={!input.trim() || thinking || sending} aria-label="Send" className="nb-btn-primary w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-50 flex-shrink-0">
                {thinking || sending ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
          )}
          {view === 'handoff' && (
            <div className="flex-shrink-0 border-t nb-border px-3 py-2 text-center">
              <button type="button" onClick={() => setView('assistant')} className="nb-link text-xs font-semibold">Back to the assistant</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
