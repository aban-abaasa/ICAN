import React, { useState, useEffect, useRef } from 'react';
import { X, Heart, Share2, Send, MessageCircle, AlertCircle, AlertTriangle, Loader, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import { getStatusById, incrementStatusView } from '../services/statusService';
import { getStatusMessages, sendStatusMessage, subscribeToStatusMessages } from '../services/statusMessagesService';
import StatusCaptionText from './status/StatusCaptionText';

const timeAgo = (timestamp) => {
  if (!timestamp) return 'Now';
  const minutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

// Rendered instead of the normal authenticated app (see main.jsx) when the
// URL is a shared status/"Updates" link (/status/:statusId) -- same idea as
// PublicPitchViewer: the update itself is visible to anyone with the link,
// signed in or not, and only commenting (a real write) prompts sign-in.
const PublicStatusViewer = ({ statusId }) => {
  const { user, getAvatarUrl, getDisplayName, getInitials, loading: authLoading } = useAuth();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expired, setExpired] = useState(false);
  const [liked, setLiked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [mediaBroken, setMediaBroken] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setMediaBroken(false);
      const { status: data, expired: isExpired } = await getStatusById(statusId);
      if (cancelled) return;
      if (!data) {
        setExpired(isExpired);
        setNotFound(true);
      } else {
        setStatus(data);
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [statusId]);

  useEffect(() => {
    if (!status?.id) return undefined;
    const timer = setTimeout(() => { incrementStatusView(status.id).catch(() => {}); }, 1000);
    return () => clearTimeout(timer);
  }, [status?.id]);

  useEffect(() => {
    if (!showComments || !status?.id) return undefined;
    let isMounted = true;
    setLoadingMessages(true);
    getStatusMessages(status.id).then(({ messages: data }) => {
      if (isMounted) {
        setMessages(data || []);
        setLoadingMessages(false);
      }
    });
    const unsubscribe = subscribeToStatusMessages(status.id, (newMessage) => {
      setMessages((prev) => (prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage]));
    });
    return () => { isMounted = false; unsubscribe?.(); };
  }, [showComments, status?.id]);

  useEffect(() => {
    if (showComments) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showComments]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (authLoading) return;
    if (!user) { setShowAuthModal(true); return; }
    if (!messageText.trim() || sending) return;

    setSending(true);
    try {
      const { error } = await sendStatusMessage(status.id, user.id, messageText.trim());
      if (!error) setMessageText('');
    } finally {
      setSending(false);
    }
  };

  const handleShare = async () => {
    if (authLoading) return;
    if (!user) { setShowAuthModal(true); return; }
    const shareUrl = `https://icanera.space/status/${status.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Check this update on ICANEra', text: status.caption, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (error) {
      // user cancelled the native share sheet -- not an error worth logging
    }
  };

  const goToApp = () => {
    window.history.replaceState({}, '', '/');
    window.location.href = '/';
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader className="w-10 h-10 text-white animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="w-14 h-14 text-slate-500" />
        <p className="text-white text-lg font-semibold">
          {expired ? 'This update has expired' : "This update isn't available anymore"}
        </p>
        <button onClick={goToApp} className="icon-btn-transparent px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white rounded-lg font-semibold transition">
          Open ICANEra
        </button>
      </div>
    );
  }

  const posterName = status.poster_full_name || 'User';
  const posterPhoto = status.poster_avatar_url;

  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
      <div className="relative w-full h-full flex items-center justify-center">
        {mediaBroken && (status.media_type === 'image' || status.media_type === 'video') ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-slate-900">
            <AlertTriangle className="w-8 h-8 text-white/40" />
            <span className="text-sm text-white/40">Preview unavailable</span>
          </div>
        ) : status.media_type === 'image' ? (
          <img
            src={status.media_url}
            alt="Update"
            className="w-full h-full object-contain"
            onError={() => {
              console.error('Failed to load shared status image:', status.media_url);
              setMediaBroken(true);
            }}
          />
        ) : status.media_type === 'video' ? (
          <video
            src={status.media_url}
            autoPlay
            controls
            className="w-full h-full object-contain"
            onError={() => {
              console.error('Failed to load shared status video:', status.media_url);
              setMediaBroken(true);
            }}
          />
        ) : (
          <div style={{ backgroundColor: status.background_color || '#6366f1' }} className="w-full h-full flex items-center justify-center p-8">
            <StatusCaptionText
              text={status.caption}
              expanded={captionExpanded}
              onToggle={() => setCaptionExpanded(v => !v)}
              variant="big"
              clampLines={8}
              className="w-full max-w-md cursor-pointer"
            />
          </div>
        )}

        {status.media_type !== 'text' && (
          <StatusCaptionText
            text={status.caption}
            expanded={captionExpanded}
            onToggle={() => setCaptionExpanded(v => !v)}
            variant="overlay"
            clampLines={4}
            className="absolute bottom-32 left-0 right-0 px-6 flex flex-col items-center justify-center cursor-pointer [&_p]:max-w-md [&_p]:mx-auto [&_p]:drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]"
          />
        )}

        {/* Poster + close */}
        <div className="absolute top-12 left-0 right-0 px-4 z-30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {posterPhoto ? (
              <img src={posterPhoto} alt={posterName} className="w-10 h-10 rounded-full object-cover border-2 border-white" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-bold border-2 border-white">
                {posterName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-white font-semibold">{posterName}</p>
              <p className="text-white/70 text-xs">{timeAgo(status.created_at)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!authLoading && !user && (
              <button onClick={() => setShowAuthModal(true)} className="icon-btn-transparent text-xs font-semibold px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white transition">
                Sign up
              </button>
            )}
            <button onClick={goToApp} className="icon-btn-transparent p-2 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all" title="Open ICANEra">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black to-transparent p-4 z-30">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => {
                if (authLoading) return;
                if (!user) { setShowAuthModal(true); return; }
                setLiked((v) => !v);
              }}
              className={`icon-btn-transparent p-3 rounded-full backdrop-blur-sm transition-all ${liked ? 'bg-red-500/30 text-red-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
            >
              <Heart className={`w-6 h-6 ${liked ? 'fill-current' : ''}`} />
            </button>
            <button onClick={handleShare} className="icon-btn-transparent p-3 rounded-full backdrop-blur-sm bg-white/10 text-white hover:bg-white/20 transition-all">
              {copied ? <Check className="w-6 h-6 text-green-400" /> : <Share2 className="w-6 h-6" />}
            </button>
            <button
              onClick={() => {
                if (authLoading) return;
                if (!user) { setShowAuthModal(true); return; }
                setShowComments((v) => !v);
              }}
              className="icon-btn-transparent flex-1 flex items-center justify-center gap-2 p-3 rounded-full backdrop-blur-sm bg-white/10 text-white hover:bg-white/20 transition-all"
            >
              <MessageCircle className="w-6 h-6" />
              <span className="text-sm font-medium">{messages.length || ''}</span>
            </button>
          </div>

          {showComments && (
            <div className="mt-3 max-h-64 rounded-2xl bg-black/60 border border-white/20 backdrop-blur-md flex flex-col overflow-hidden w-full">
              <div className="flex-1 overflow-y-auto p-3 space-y-2 min-w-0">
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/30 border-t-white"></div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex items-center justify-center py-6">
                    <p className="text-sm text-white/60">No comments yet. Be the first!</p>
                  </div>
                ) : (
                  <>
                    {messages.map((msg) => {
                      const isOwn = msg.sender_id === user?.id;
                      const senderName = isOwn ? getDisplayName() : (msg.sender_full_name || 'User');
                      const senderPhoto = isOwn ? getAvatarUrl() : msg.sender_avatar_url;
                      return (
                        <div key={msg.id} className="bg-white/5 rounded-lg p-2.5 border border-white/10 min-w-0">
                          <div className="flex items-start gap-2 min-w-0">
                            {senderPhoto ? (
                              <img src={senderPhoto} alt={senderName} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                {isOwn ? getInitials(senderName) : senderName.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-white">{isOwn ? 'You' : senderName}</p>
                              <p className="text-xs text-white/90 break-words leading-relaxed">{msg.message_text}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>
              <form onSubmit={handleSendMessage} className="border-t border-white/10 p-2 bg-black/40 flex items-center gap-2 flex-shrink-0 min-w-0">
                <input
                  type="text"
                  placeholder={user ? 'Say something...' : 'Sign in to comment'}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onFocus={() => { if (!authLoading && !user) setShowAuthModal(true); }}
                  disabled={sending}
                  className="flex-1 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-3 py-2 text-xs text-white placeholder-white/50 focus:outline-none focus:border-white/40 focus:bg-white/15 disabled:opacity-50 transition-all min-w-0"
                />
                <button
                  type="submit"
                  disabled={!messageText.trim() || sending}
                  className="icon-btn-transparent p-2 rounded-full backdrop-blur-sm bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-500 hover:to-pink-500 disabled:opacity-40 transition-all flex-shrink-0"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {showAuthModal && (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <button onClick={() => setShowAuthModal(false)} className="icon-btn-transparent fixed top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-black/40 z-10">
            <X className="w-6 h-6" />
          </button>
          <AuthPage initialView="signup" onAuthSuccess={() => setShowAuthModal(false)} />
        </div>
      )}
    </div>
  );
};

export default PublicStatusViewer;
