import React, { useEffect, useRef, useState } from 'react';
import { X, Send, Paperclip, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  startConversation, getConversationMessages, sendMessage, uploadChatAttachment,
} from '../../services/portfolioChatService';
import ChatBubble from './ChatBubble';

// Guests don't get Realtime (RLS can't authenticate an anonymous guest_id —
// see CREATE_PORTFOLIO_DIRECT_MESSAGES.sql), so this polls instead. Short
// enough to feel live for a low-volume 1:1 chat without hammering the RPC.
const POLL_MS = 4000;

/**
 * Embedded direct-chat panel on the public /portfolio/<handle> page — one
 * visitor (signed-in or anonymous guest) talking to the resume owner.
 * Distinct from the app-wide ChatWidget's group "Community" room: this is
 * always exactly two participants, and works with no app shell mounted
 * (the standalone /portfolio/<handle> route has none).
 */
export default function PortfolioChatPanel({ ownerUserId, ownerName, guestId, guestName, onGuestNameChange, onClose }) {
  const { user, profile: viewerProfile } = useAuth();
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isStarting, setIsStarting] = useState(true);
  const [error, setError] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const pollRef = useRef(null);

  const effectiveGuestName = viewerProfile?.full_name || guestName?.trim() || '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await startConversation(ownerUserId, { guestId, guestName: effectiveGuestName });
        if (cancelled) return;
        setConversationId(id);
        const msgs = await getConversationMessages(id, { guestId });
        if (!cancelled) setMessages(msgs);
      } catch (err) {
        console.error('PortfolioChatPanel: could not start conversation', err);
        if (!cancelled) setError(err.message || 'Could not start this conversation.');
      } finally {
        if (!cancelled) setIsStarting(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerUserId]);

  useEffect(() => {
    if (!conversationId) return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const msgs = await getConversationMessages(conversationId, { guestId });
        setMessages(msgs);
      } catch (err) {
        console.error('PortfolioChatPanel: poll failed', err);
      }
    }, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [conversationId, guestId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handlePickFile = (e) => {
    const file = e.target.files?.[0];
    if (file) setPendingFile(file);
    e.target.value = '';
  };

  const handleSend = async () => {
    if (!conversationId || isSending) return;
    if (!body.trim() && !pendingFile) return;

    setIsSending(true);
    setError(null);
    try {
      let attachment = null;
      if (pendingFile) {
        attachment = await uploadChatAttachment(pendingFile);
      }
      const sent = await sendMessage(conversationId, {
        body: body.trim() || null,
        attachment,
        guestId,
        guestName: effectiveGuestName,
      });
      setMessages((prev) => [...prev, sent]);
      setBody('');
      setPendingFile(null);
    } catch (err) {
      console.error('PortfolioChatPanel: send failed', err);
      setError(err.message || 'Could not send — please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden animate-fadeIn">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/90">
        <div>
          <p className="text-sm font-semibold text-white">Message {ownerName?.split(' ')[0] || ''}</p>
          <p className="text-[10px] text-slate-500">Messages disappear after 24h unless kept</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/5">
          <X className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {!user && (
        <div className="px-3 pt-2">
          <input
            value={guestName}
            onChange={(e) => onGuestNameChange(e.target.value)}
            placeholder="Your name (so they know who's messaging)"
            className="w-full px-3 py-1.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500/60"
          />
        </div>
      )}

      <div ref={scrollRef} className="max-h-80 min-h-[10rem] overflow-y-auto px-3 py-3 space-y-2">
        {isStarting ? (
          <div className="flex items-center justify-center py-8 text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Connecting...
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-slate-500 py-8">
            Say hello — {ownerName?.split(' ')[0] || 'they'}'ll see this the next time they're online.
          </p>
        ) : (
          messages.map((m) => (
            <ChatBubble key={m.id} message={m} isMine={m.sender_role === 'visitor'} />
          ))
        )}
      </div>

      {error && <p className="px-3 text-[11px] text-red-400">{error}</p>}

      {pendingFile && (
        <div className="mx-3 mb-1.5 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800 text-xs text-slate-300 w-fit">
          <Paperclip className="w-3 h-3" />
          <span className="truncate max-w-[10rem]">{pendingFile.name}</span>
          <button onClick={() => setPendingFile(null)} className="text-slate-500 hover:text-white">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-slate-800">
        <input type="file" accept="image/*,.pdf" ref={fileInputRef} className="hidden" onChange={handlePickFile} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isStarting}
          className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-40"
          title="Attach an image or file"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStarting}
          placeholder="Write a message..."
          rows={1}
          className="flex-1 min-w-0 resize-none px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500/60"
        />
        <button
          onClick={handleSend}
          disabled={isStarting || isSending || (!body.trim() && !pendingFile)}
          className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40"
        >
          {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
