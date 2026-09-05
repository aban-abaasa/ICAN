import React, { useEffect, useState } from 'react';
import { MessageCircle, ArrowLeft, Send, Paperclip, X, Loader2 } from 'lucide-react';
import {
  listMyConversations, getConversationMessages, sendOwnerMessage,
  markConversationRead, subscribeToConversationMessages, subscribeToMyConversations,
  uploadChatAttachment, setMessageKept,
} from '../../services/portfolioChatService';
import { fmtRelativeTime } from '../landing/relativeTime';
import ChatBubble from './ChatBubble';

/**
 * The resume owner's direct-message inbox — conversations started from
 * their public /portfolio/<handle> page. Self-contained (fetches its own
 * data off `userId`), so it can be dropped into both the dashboard's My
 * Resume tab (PortfolioTab.jsx) and the owner's own view of their public
 * page (PublicPortfolioPage.jsx), rather than keeping two copies of this
 * logic in sync.
 */
export default function PortfolioMessagesInbox({ userId, className = '' }) {
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [messageBody, setMessageBody] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [messageError, setMessageError] = useState(null);

  useEffect(() => {
    if (!userId) return undefined;
    const refresh = () => listMyConversations().then(setConversations).catch(() => {});
    refresh();
    // Realtime for the instant case, plus a 10s poll fallback —
    // belt-and-suspenders in case Realtime isn't delivering (e.g.
    // project-specific Realtime/replication config), so a new message from
    // a visitor never just goes unnoticed.
    const unsubscribe = subscribeToMyConversations(refresh);
    const interval = setInterval(refresh, 10000);
    return () => { unsubscribe(); clearInterval(interval); };
  }, [userId]);

  useEffect(() => {
    if (!selectedConversationId) {
      setThreadMessages([]);
      return undefined;
    }
    let cancelled = false;

    const refreshThread = () =>
      getConversationMessages(selectedConversationId, {})
        .then((msgs) => { if (!cancelled) setThreadMessages(msgs); })
        .catch((err) => console.error('Error loading conversation:', err));

    setThreadLoading(true);
    refreshThread().finally(() => { if (!cancelled) setThreadLoading(false); });
    markConversationRead(selectedConversationId).catch(() => {});

    // Realtime for instant delivery, plus a 5s poll fallback — the poll
    // also picks up server-side expiry sweeps (a message that just aged
    // past 24h and wasn't kept), which a realtime INSERT listener alone
    // would never reflect.
    const unsubscribe = subscribeToConversationMessages(selectedConversationId, () => {
      refreshThread();
      markConversationRead(selectedConversationId).catch(() => {});
    });
    const interval = setInterval(refreshThread, 5000);
    return () => { cancelled = true; unsubscribe(); clearInterval(interval); };
  }, [selectedConversationId]);

  const openConversation = (conversationId) => {
    setMessageError(null);
    setSelectedConversationId(conversationId);
  };

  const pickMessageFile = (e) => {
    const file = e.target.files?.[0];
    if (file) setPendingFile(file);
    e.target.value = '';
  };

  const sendConversationMessage = async () => {
    if (!selectedConversationId || isSendingMessage) return;
    if (!messageBody.trim() && !pendingFile) return;

    setIsSendingMessage(true);
    setMessageError(null);
    try {
      let attachment = null;
      if (pendingFile) {
        attachment = await uploadChatAttachment(pendingFile);
      }
      const sent = await sendOwnerMessage(selectedConversationId, { body: messageBody.trim() || null, attachment });
      setThreadMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      setMessageBody('');
      setPendingFile(null);
      listMyConversations().then(setConversations).catch(() => {});
    } catch (err) {
      console.error('Error sending message:', err);
      setMessageError(err.message || 'Could not send — please try again.');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const toggleKeepMessage = async (messageId, keep) => {
    try {
      const updated = await setMessageKept(messageId, keep);
      setThreadMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
    } catch (err) {
      console.error('Error updating message:', err);
    }
  };

  return (
    <div className={`bg-slate-900/50 border border-indigo-700/30 rounded-xl p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-indigo-400" /> Messages
          {conversations.some((c) => c.unread_by_owner) && (
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
          )}
        </h3>
        {selectedConversationId && (
          <button
            onClick={() => setSelectedConversationId(null)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        )}
      </div>

      {!selectedConversationId ? (
        <div className="space-y-1.5">
          {conversations.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">
              No messages yet — visitors to your public resume page can message you here.
            </p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className="w-full flex items-center gap-2 p-2.5 bg-slate-950/30 hover:bg-slate-950/60 rounded-lg text-left transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm text-white font-medium truncate">
                    {c.visitor_name || c.guest_name || 'A visitor'}
                  </p>
                  {c.unread_by_owner && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />}
                </div>
                {c.last_message_preview && (
                  <p className="text-xs text-gray-400 truncate">{c.last_message_preview}</p>
                )}
              </div>
              {c.last_message_at && (
                <span className="text-[10px] text-gray-500 flex-shrink-0">{fmtRelativeTime(c.last_message_at)}</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div>
          <div className="max-h-80 min-h-[8rem] overflow-y-auto space-y-2 mb-2 px-0.5">
            {threadLoading ? (
              <div className="flex items-center justify-center py-8 text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...
              </div>
            ) : (
              threadMessages.map((m) => (
                <ChatBubble
                  key={m.id}
                  message={m}
                  isMine={m.sender_role === 'owner'}
                  canManage
                  onToggleKeep={(keep) => toggleKeepMessage(m.id, keep)}
                />
              ))
            )}
          </div>

          {messageError && <p className="text-xs text-red-400 mb-1.5">{messageError}</p>}

          {pendingFile && (
            <div className="mb-1.5 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800 text-xs text-slate-300 w-fit">
              <Paperclip className="w-3 h-3" />
              <span className="truncate max-w-[10rem]">{pendingFile.name}</span>
              <button onClick={() => setPendingFile(null)} className="text-slate-500 hover:text-white">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <input type="file" id={`portfolio-message-file-${userId}`} accept="image/*,.pdf" className="hidden" onChange={pickMessageFile} />
            <label
              htmlFor={`portfolio-message-file-${userId}`}
              className="p-2 rounded-lg text-gray-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
            >
              <Paperclip className="w-4 h-4" />
            </label>
            <textarea
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendConversationMessage();
                }
              }}
              placeholder="Write a reply..."
              rows={1}
              className="flex-1 min-w-0 resize-none px-3 py-2 bg-slate-950/50 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-sm"
            />
            <button
              onClick={sendConversationMessage}
              disabled={isSendingMessage || (!messageBody.trim() && !pendingFile)}
              className="p-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-40"
            >
              {isSendingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
