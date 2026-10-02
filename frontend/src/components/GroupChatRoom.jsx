/**
 * GroupChatRoom - Real-time messaging for group members
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Send,
  MessageCircle,
  Heart,
  Share2,
  MoreVertical,
  Clock
} from 'lucide-react';
import {
  getGroupMessages,
  sendGroupMessage
} from '../services/trustService';
import { Linkify } from '../utils/linkify';

const GroupChatRoom = ({ groupId, groupName }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    loadMessages();
    // Poll for new messages every 3 seconds
    const interval = setInterval(loadMessages, 3000);
    return () => clearInterval(interval);
  }, [groupId]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadMessages = async () => {
    if (!groupId) return;
    try {
      const data = await getGroupMessages(groupId);
      setMessages(data || []);
      setLoading(false);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !user?.id) return;

    setSending(true);
    try {
      await sendGroupMessage({
        groupId,
        userId: user.id,
        userEmail: user.email,
        message: newMessage.trim()
      });
      setNewMessage('');
      await loadMessages();
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="bd-page cmms-classic-card flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="bd-bar cmms-accent-plum flex items-center justify-between gap-3 p-3 sm:p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="cmms-medallion !h-9 !w-9"><MessageCircle className="h-4 w-4" aria-hidden="true" /></span>
          <div className="min-w-0">
            <h3 className="cmms-classic-heading truncate text-base leading-tight">{groupName}</h3>
            <p className="cmms-classic-muted text-xs">{messages.length} {messages.length === 1 ? 'message' : 'messages'}</p>
          </div>
        </div>
        <button type="button" aria-label="More" className="cmms-info-btn">
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: '#b8892b', borderTopColor: 'transparent' }}></div>
              <p className="cmms-classic-muted text-sm">Loading messages…</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="cmms-accent-plum text-center">
              <span className="cmms-medallion mx-auto mb-3 !h-12 !w-12"><MessageCircle className="h-5 w-5" aria-hidden="true" /></span>
              <p className="cmms-classic-muted text-sm">No messages yet. Start the conversation!</p>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isOwn = msg.user_id === user?.id;
            return (
              <div key={msg.id || idx} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                <div className={`bd-bubble max-w-[85%] px-3.5 py-2.5 sm:max-w-md ${isOwn ? 'bd-bubble-me' : ''}`}>
                  {!isOwn && (
                    <p className="mb-1 text-xs font-bold" style={{ color: '#2f4a7a' }}>@{String(msg.user_email || 'member').split('@')[0]}</p>
                  )}
                  <p className="break-words text-sm"><Linkify text={msg.message} /></p>
                  <p className="mt-1 flex items-center gap-1 text-[0.68rem] opacity-70">
                    <Clock className="h-3 w-3" />
                    {new Date(msg.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bd-bar bd-bar-bottom space-y-2 p-3 sm:p-4">
        <div className="flex items-end gap-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Write a message… (Shift+Enter for a new line)"
            disabled={sending}
            rows="2"
            className="cmms-classic-field flex-1 resize-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSendMessage}
            disabled={sending || !newMessage.trim()}
            aria-label="Send"
            className="cmms-classic-btn-primary flex h-11 w-11 flex-shrink-0 items-center justify-center !rounded-full"
          >
            {sending ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Quick Actions */}
        <div className="flex justify-center gap-2">
          <button type="button" aria-label="Like" className="cmms-info-btn"><Heart className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="Share" className="cmms-info-btn"><Share2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  );
};

export default GroupChatRoom;
