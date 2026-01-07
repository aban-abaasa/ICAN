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
    <div className="flex flex-col h-full bg-gradient-to-b from-slate-900 to-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900/80 border-b border-slate-700 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-5 h-5 text-blue-400" />
          <div>
            <h3 className="font-bold text-white">{groupName}</h3>
            <p className="text-xs text-gray-400">{messages.length} messages</p>
          </div>
        </div>
        <button className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
          <MoreVertical className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-8 h-8 bg-blue-500 rounded-full animate-spin mx-auto mb-2"></div>
              <p className="text-gray-400">Loading messages...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MessageCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">No messages yet. Start the conversation!</p>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isOwn = msg.user_id === user?.id;
            return (
              <div key={msg.id || idx} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                    isOwn
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-slate-700 text-gray-100 rounded-bl-none'
                  }`}
                >
                  {!isOwn && (
                    <p className="text-xs font-semibold text-gray-300 mb-1">{msg.user_email}</p>
                  )}
                  <p className="text-sm break-words">{msg.message}</p>
                  <p className="text-xs opacity-70 mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
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
      <div className="bg-slate-900/80 border-t border-slate-700 p-4 space-y-3">
        <div className="flex gap-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message... (Shift+Enter for new line)"
            disabled={sending}
            rows="2"
            className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none disabled:opacity-50"
          />
          <button
            onClick={handleSendMessage}
            disabled={sending || !newMessage.trim()}
            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-all flex items-center gap-2"
          >
            {sending ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-2 justify-center">
          <button className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-gray-400 hover:text-pink-400">
            <Heart className="w-4 h-4" />
          </button>
          <button className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-gray-400 hover:text-blue-400">
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default GroupChatRoom;
