/**
 * FullscreenStatusViewer Component
 * Fullscreen status viewer with swipe gestures and interactions
 */

import React, { useState, useEffect, useRef } from 'react';
import { X, Heart, Share2, ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { incrementStatusView } from '../../services/statusService';
import { sendStatusMessage } from '../../services/statusMessagesService';
import { useAuth } from '../../context/AuthContext';

export const FullscreenStatusViewer = ({ statuses, initialIndex = 0, onClose }) => {
  const { user } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [liked, setLiked] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const lastTapRef = useRef(0);

  const currentStatus = statuses[currentIndex];

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
    const timer = setTimeout(() => {
      incrementStatusView(currentStatus.id).catch(console.error);
    }, 1000); // Record view after 1 second

    return () => clearTimeout(timer);
  }, [currentIndex, currentStatus.id]);

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
    heart.innerHTML = '❤️';
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
        msg.innerHTML = '✓ Message sent';
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
            <img
              src={currentStatus.media_url}
              alt="Status"
              className="w-full h-full object-contain"
            />
          ) : currentStatus.media_type === 'video' ? (
            <video
              src={currentStatus.media_url}
              autoPlay
              className="w-full h-full object-contain"
            />
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
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-6 z-30">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setLiked(!liked)}
                className={`p-3 rounded-full backdrop-blur-sm transition-all ${
                  liked
                    ? 'bg-red-500/30 text-red-400'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
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
              >
                <Share2 className="w-6 h-6" />
              </button>

              <form onSubmit={handleSendMessage} className="flex-1 flex items-center gap-2">
                <input
                  type="text"
                  placeholder={user ? "Send a message..." : "Sign in to message"}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  disabled={!user || sendingMessage}
                  className="flex-1 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:border-white/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                />
                <button
                  type="submit"
                  disabled={!user || !messageText.trim() || sendingMessage}
                  className="p-3 rounded-full backdrop-blur-sm bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  title={!user ? "Sign in to send messages" : "Send message"}
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
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
