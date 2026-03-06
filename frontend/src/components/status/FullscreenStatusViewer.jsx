/**
 * FullscreenStatusViewer Component
 * Fullscreen status viewer with swipe gestures and interactions
 */

import React, { useState, useEffect, useRef } from 'react';
import { X, Heart, Share2, ChevronLeft, ChevronRight, Send, MessageCircle } from 'lucide-react';
import { incrementStatusView } from '../../services/statusService';
import {
  sendStatusMessage,
  getStatusMessages,
  subscribeToStatusMessages
} from '../../services/statusMessagesService';
import { useAuth } from '../../context/AuthContext';

export const FullscreenStatusViewer = ({ statuses, initialIndex = 0, onClose }) => {
  const { user } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [liked, setLiked] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [statusMessages, setStatusMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const lastTapRef = useRef(0);
  const [showCommentsPanel, setShowCommentsPanel] = useState(false);
  const messagesEndRef = useRef(null);
  const [captionExpanded, setCaptionExpanded] = useState(false);

  const currentStatus = statuses[currentIndex];

  // Auto-scroll to bottom of comments
  useEffect(() => {
    if (showCommentsPanel && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [statusMessages, showCommentsPanel]);

  // Reset caption expanded state when status changes
  useEffect(() => {
    setCaptionExpanded(false);
  }, [currentIndex]);

  // Progress bar animation
  useEffect(() => {
    setProgress(0);
    let interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          // Auto advance to next status
          if (currentIndex < statuses.length - 1) {
            setCurrentIndex(currentIndex + 1);
          } else {
            onClose();
          }
          return 0;
        }
        return p + (100 / 5000); // 5 seconds per status
      });
    }, 50);

    return () => clearInterval(interval);
  }, [currentIndex, statuses.length, onClose]);

  // Track view
  useEffect(() => {
    if (!currentStatus?.id) return undefined;

    const timer = setTimeout(() => {
      incrementStatusView(currentStatus.id).catch(console.error);
    }, 1000); // Record view after 1 second

    return () => clearTimeout(timer);
  }, [currentStatus?.id]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, statuses.length]);

  useEffect(() => {
    let isMounted = true;

    const loadMessages = async () => {
      if (!currentStatus?.id) return;
      setLoadingMessages(true);
      const { messages } = await getStatusMessages(currentStatus.id);
      if (isMounted) {
        setStatusMessages(messages || []);
        setLoadingMessages(false);
      }
    };

    loadMessages();
    const unsubscribe = currentStatus?.id
      ? subscribeToStatusMessages(currentStatus.id, (newMessage) => {
          setStatusMessages((prev) => {
            if (prev.some((msg) => msg.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
        })
      : null;

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, [currentStatus?.id]);

  // Handle touch swipe
  const handleTouchStart = (e) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e) => {
    if (!touchStart) return;
    const diff = touchStart - e.changedTouches[0].clientX;
    
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        goNext();
      } else {
        goPrev();
      }
    }
    setTouchStart(null);
  };

  // Handle double tap for like
  const handleDoubleTap = (e) => {
    const now = Date.now();
    const lastTap = lastTapRef.current;

    if (now - lastTap < 300) {
      setLiked(!liked);
      showHeartAnimation(e.clientX, e.clientY);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  const showHeartAnimation = (x, y) => {
    const heart = document.createElement('div');
    heart.innerHTML = '♥';
    heart.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      font-size: 48px;
      pointer-events: none;
      z-index: 9999;
      animation: heartFloat 1s ease-out forwards;
    `;
    document.body.appendChild(heart);
    setTimeout(() => heart.remove(), 1000);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    if (!messageText.trim() || !user || sendingMessage) return;

    setSendingMessage(true);
    try {
      const { error } = await sendStatusMessage(
        currentStatus.id,
        user.id,
        messageText
      );

      if (error) {
        console.error('Failed to send message:', error);
      } else {
        setMessageText('');
        // Show success feedback
        const msg = document.createElement('div');
        msg.innerHTML = 'Message sent';
        msg.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(34, 197, 94, 0.9);
          color: white;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          z-index: 99999;
        `;
        document.body.appendChild(msg);
        setTimeout(() => msg.remove(), 2000);
      }
    } finally {
      setSendingMessage(false);
    }
  };

  const goNext = () => {
    if (currentIndex < statuses.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      onClose();
    }
  };

  const goPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  if (!currentStatus) return null;

  return (
    <>
      <style>{`
        @keyframes heartFloat {
          0% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -200px) scale(1.5);
          }
        }
        @keyframes slideUpFade {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .comments-panel-animate {
          animation: slideUpFade 0.2s ease-out;
        }
      `}</style>

      <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
        {/* Progress bars at top */}
        <div className="absolute top-0 left-0 right-0 flex gap-1 p-2 z-40">
          {statuses.map((_, idx) => (
            <div
              key={idx}
              className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-white transition-all duration-75"
                style={{ width: idx === currentIndex ? `${progress}%` : idx < currentIndex ? '100%' : '0%' }}
              />
            </div>
          ))}
        </div>

        {/* Main content */}
        <div
          className="relative w-full h-full flex items-center justify-center cursor-pointer"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleDoubleTap}
        >
          {/* Status content */}
          {currentStatus.media_type === 'image' ? (
            <div className="relative w-full h-full">
              <img
                src={currentStatus.media_url}
                alt="Status"
                className="w-full h-full object-contain"
              />
              {/* Caption overlay on image */}
              {currentStatus.caption && (
                <div
                  className="absolute bottom-32 left-0 right-0 px-6 flex flex-col items-center justify-center cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setCaptionExpanded(v => !v); }}
                >
                  <p className={`text-white text-center text-xl font-bold leading-snug max-w-xs drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] [text-shadow:0_2px_8px_rgba(0,0,0,0.9),0_0_2px_rgba(0,0,0,1)] ${
                    captionExpanded ? '' : 'line-clamp-2'
                  }`}>
                    {currentStatus.caption}
                  </p>
                  {currentStatus.caption.length > 80 && (
                    <span className="mt-1 text-xs font-semibold text-white/80 bg-black/40 backdrop-blur-sm px-3 py-0.5 rounded-full">
                      {captionExpanded ? 'less' : 'more'}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : currentStatus.media_type === 'video' ? (
            <div className="relative w-full h-full">
              <video
                src={currentStatus.media_url}
                autoPlay
                className="w-full h-full object-contain"
              />
              {/* Caption overlay on video */}
              {currentStatus.caption && (
                <div
                  className="absolute bottom-32 left-0 right-0 px-6 flex flex-col items-center justify-center cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setCaptionExpanded(v => !v); }}
                >
                  <p className={`text-white text-center text-xl font-bold leading-snug max-w-xs drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] [text-shadow:0_2px_8px_rgba(0,0,0,0.9),0_0_2px_rgba(0,0,0,1)] ${
                    captionExpanded ? '' : 'line-clamp-2'
                  }`}>
                    {currentStatus.caption}
                  </p>
                  {currentStatus.caption.length > 80 && (
                    <span className="mt-1 text-xs font-semibold text-white/80 bg-black/40 backdrop-blur-sm px-3 py-0.5 rounded-full">
                      {captionExpanded ? 'less' : 'more'}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div
              style={{ backgroundColor: currentStatus.background_color }}
              className="w-full h-full flex items-center justify-center p-8"
            >
              <p className="text-4xl font-bold text-white text-center max-w-2xl">
                {currentStatus.caption}
              </p>
            </div>
          )}

          {/* User info overlay */}
          <div className="absolute top-12 left-0 right-0 px-4 z-30 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-bold border-2 border-white">
                U
              </div>
              <div>
                <p className="text-white font-semibold">@User</p>
                <p className="text-white/70 text-xs">Now</p>
              </div>
            </div>

            {/* View count */}
            <div className="text-white text-sm bg-black/40 backdrop-blur-sm px-3 py-1 rounded-full">
              {currentStatus.view_count} views
            </div>
          </div>

          {/* Bottom actions */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black to-transparent p-4 z-30">
            {/* Action buttons */}
            <div className="flex items-center justify-between gap-3 mb-3">
              <button
                onClick={() => setLiked(!liked)}
                className={`p-3 rounded-full backdrop-blur-sm transition-all ${
                  liked
                    ? 'bg-red-500/30 text-red-400'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
                title={liked ? 'Unlike' : 'Like'}
              >
                <Heart className={`w-6 h-6 ${liked ? 'fill-current' : ''}`} />
              </button>

              <button
                onClick={() => {
                  navigator.share?.({
                    title: 'Check this status',
                    text: currentStatus.caption,
                    url: window.location.href
                  }).catch(() => {});
                }}
                className="p-3 rounded-full backdrop-blur-sm bg-white/10 text-white hover:bg-white/20 transition-all"
                title="Share"
              >
                <Share2 className="w-6 h-6" />
              </button>

              <button
                onClick={() => setShowCommentsPanel(!showCommentsPanel)}
                className="flex-1 flex items-center justify-center gap-2 p-3 rounded-full backdrop-blur-sm bg-white/10 text-white hover:bg-white/20 transition-all"
                title={showCommentsPanel ? 'Hide comments' : 'Show comments'}
              >
                <MessageCircle className="w-6 h-6" />
                <span className="text-sm font-medium">{statusMessages.length}</span>
              </button>
            </div>

            {/* Mobile-optimized comment section */}
            {showCommentsPanel && (
              <div className="mt-3 max-h-64 rounded-2xl bg-black/60 border border-white/20 backdrop-blur-md flex flex-col overflow-hidden comments-panel-animate w-full">
                {/* Comments list */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2 min-w-0">
                  {loadingMessages ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/30 border-t-white"></div>
                    </div>
                  ) : statusMessages.length === 0 ? (
                    <div className="flex items-center justify-center py-6">
                      <p className="text-sm text-white/60">No comments yet. Be the first!</p>
                    </div>
                  ) : (
                    <>
                      {statusMessages.map((msg) => (
                        <div key={msg.id} className="bg-white/5 rounded-lg p-2.5 border border-white/10 min-w-0">
                          <div className="flex items-start gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {(msg.sender_id === user?.id ? 'Y' : 'U')}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-white">
                                {msg.sender_id === user?.id ? 'You' : `User`}
                              </p>
                              <p className="text-xs text-white/90 break-words leading-relaxed">
                                {msg.message_text}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                {/* Comment input */}
                <form
                  onSubmit={handleSendMessage}
                  className="border-t border-white/10 p-2 bg-black/40 flex items-center gap-2 flex-shrink-0 min-w-0"
                >
                  <input
                    type="text"
                    placeholder={user ? 'Say something...' : 'Sign in to comment'}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    disabled={!user || sendingMessage}
                    autoFocus={showCommentsPanel}
                    className="flex-1 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-3 py-2 text-xs text-white placeholder-white/50 focus:outline-none focus:border-white/40 focus:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition-all min-w-0"
                  />
                  <button
                    type="submit"
                    disabled={!user || !messageText.trim() || sendingMessage}
                    className="p-2 rounded-full backdrop-blur-sm bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-500 hover:to-pink-500 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all flex-shrink-0 shadow-md hover:shadow-lg"
                    title={!user ? 'Sign in to send comments' : sendingMessage ? 'Sending...' : 'Send comment'}
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Navigation arrows */}
          {currentIndex > 0 && (
            <button
              onClick={goPrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all z-40"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {currentIndex < statuses.length - 1 && (
            <button
              onClick={goNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all z-40"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all z-40"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>
    </>
  );
};

export default FullscreenStatusViewer;
