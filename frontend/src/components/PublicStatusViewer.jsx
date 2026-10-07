import './pitchin-classic.css';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { X, Heart, Share2, Send, MessageCircle, AlertCircle, AlertTriangle, Loader, Check, Compass, Volume2, VolumeX } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import { getStatusById, incrementStatusView } from '../services/statusService';
import { getStatusMessages, sendStatusMessage, subscribeToStatusMessages } from '../services/statusMessagesService';
import StatusCaptionText from './status/StatusCaptionText';
import { Linkify } from '../utils/linkify';

const timeAgo = (timestamp) => {
  if (!timestamp) return 'Now';
  const minutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

// How long a still update (image or text) stays up before the next one
// starts, and how many progress segments are drawn at once.
const STILL_MS = 6000;
const HOLD_MS = 220;
const MAX_SEGMENTS = 8;

// The app theme repaints stock Tailwind colours and every <button>, which
// washes out controls layered on media (white text turns dark, glass buttons
// turn solid). This viewer is always a dark, full-bleed surface, so its text
// and glass buttons are pinned here. Selectors are doubled up on the root
// classes to out-rank the theme's single-class !important rules.
const CSS = `
@keyframes sv-fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.pitchin-classic.sv-root .text-white,.pitchin-classic.sv-root [class*="text-white/"],.pitchin-classic.sv-root p,.pitchin-classic.sv-root button{color:#fff!important}
.pitchin-classic.sv-root button.sv-glass{background-color:rgba(255,255,255,.16)!important}
.pitchin-classic.sv-root button.sv-glass:hover{background-color:rgba(255,255,255,.28)!important}
.pitchin-classic.sv-root button.sv-liked{background-color:rgba(239,68,68,.3)!important;color:#f87171!important}
`;

// Rendered instead of the normal authenticated app (see main.jsx, via
// PublicShareFlow) when the URL is a shared status/"Updates" link
// (/status/:statusId) -- same idea as PublicPitchViewer: the update itself is
// visible to anyone with the link, signed in or not, and only commenting (a
// real write) prompts sign-in.
//
// The shared update plays first; after it the viewer carries on like stories --
// the same poster's other live updates, then everyone else's -- so a link
// opens a flow instead of one frame. Tap the right side for next, the left for
// previous, hold to pause; running out of updates hands off to `onEnd`.
const PublicStatusViewer = ({ statusId, feedStatuses = [], onPosition, onEnd, onExplore }) => {
  const { user, getAvatarUrl, getDisplayName, getInitials, loading: authLoading } = useAuth();
  const [first, setFirst] = useState(null);
  const [index, setIndex] = useState(0);
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
  const [held, setHeld] = useState(false);
  const [muted, setMuted] = useState(true);
  const [videoPct, setVideoPct] = useState(0);
  const messagesEndRef = useRef(null);
  const videoRef = useRef(null);
  const hold = useRef({ timer: null, active: false });
  const reduceMotion = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

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
        setFirst(data);
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [statusId]);

  // The shared update first, then the same poster's other live updates
  // oldest-to-newest (a story reads in the order it was posted), then
  // everyone else's newest first.
  const queue = useMemo(() => {
    if (!first) return [];
    const others = feedStatuses.filter((s) => s.id !== first.id);
    const sameUser = others
      .filter((s) => s.user_id === first.user_id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const rest = others.filter((s) => s.user_id !== first.user_id);
    return [first, ...sameUser, ...rest];
  }, [first, feedStatuses]);

  const status = queue[index] || null;

  // Keep refs of what the stable callbacks below need, so they don't change
  // identity (and restart timers) on every render.
  const indexRef = useRef(index);
  indexRef.current = index;
  const queueLenRef = useRef(queue.length);
  queueLenRef.current = queue.length;

  const goNext = useCallback(() => {
    if (indexRef.current + 1 >= queueLenRef.current) { onEnd?.(); return; }
    setIndex(indexRef.current + 1);
  }, [onEnd]);

  const goPrev = useCallback(() => {
    if (indexRef.current > 0) setIndex(indexRef.current - 1);
  }, []);

  // Per-update reset, and tell the flow which update is on screen so the
  // address bar (and Share) follow it.
  useEffect(() => {
    if (!status?.id) return;
    setMediaBroken(false);
    setLiked(false);
    setCaptionExpanded(false);
    setShowComments(false);
    setMessages([]);
    setVideoPct(0);
    onPosition?.(status.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.id]);

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

  const paused = held || showComments || showAuthModal;

  // Pausing also has to stop the video itself, not just the progress bar.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else video.play().catch(() => {});
  }, [paused, status?.id]);

  // Arrow keys / Escape-free keyboard flow for desktop visitors.
  useEffect(() => {
    const onKey = (e) => {
      if (showComments || showAuthModal) return;
      if (/^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '')) return;
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, showComments, showAuthModal]);

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
        await navigator.share({ title: 'Check this update on IcanEra', text: status.caption, url: shareUrl });
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

  // Tap = next/previous, hold = pause (the story convention). A press that
  // lasts past HOLD_MS is a hold; releasing it resumes instead of navigating.
  const onZoneDown = () => {
    hold.current.active = false;
    clearTimeout(hold.current.timer);
    hold.current.timer = setTimeout(() => { hold.current.active = true; setHeld(true); }, HOLD_MS);
  };
  const endHold = () => {
    clearTimeout(hold.current.timer);
    if (!hold.current.active) return false;
    hold.current.active = false;
    setHeld(false);
    return true;
  };
  const onZoneUp = (direction) => {
    if (endHold()) return;
    if (direction === 'prev') goPrev();
    else goNext();
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
      <div className="pitchin-classic fixed inset-0 bg-black flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="w-14 h-14 text-slate-500" />
        <p className="text-white text-lg font-semibold">
          {expired ? 'This update has expired' : "This update isn't available anymore"}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button onClick={onExplore} className="icon-btn-transparent px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-lg font-semibold transition inline-flex items-center gap-2 sv-glass">
            <Compass className="w-4 h-4" /> Explore more
          </button>
          <button onClick={goToApp} className="icon-btn-transparent px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white rounded-lg font-semibold transition">
            Open IcanEra
          </button>
        </div>
      </div>
    );
  }

  const posterName = status.poster_full_name || 'User';
  const posterPhoto = status.poster_avatar_url;
  const isVideo = status.media_type === 'video';

  // A window of progress segments around the current update, so a long queue
  // doesn't render dozens of hairlines.
  const segStart = Math.max(0, Math.min(index - 3, queue.length - MAX_SEGMENTS));
  const segments = queue.slice(segStart, segStart + MAX_SEGMENTS);

  return (
    <div className="pitchin-classic sv-root fixed inset-0 bg-black z-50 flex items-center justify-center select-none">
      <style>{CSS}</style>
      <div className="relative w-full h-full flex items-center justify-center">
        {mediaBroken && (status.media_type === 'image' || isVideo) ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-slate-900">
            <AlertTriangle className="w-8 h-8 text-white/40" />
            <span className="text-sm text-white/40">Preview unavailable</span>
          </div>
        ) : status.media_type === 'image' ? (
          <img
            key={status.id}
            src={status.media_url}
            alt="Update"
            className="w-full h-full object-contain"
            draggable={false}
            onError={() => {
              console.error('Failed to load shared status image:', status.media_url);
              setMediaBroken(true);
            }}
          />
        ) : isVideo ? (
          <video
            key={status.id}
            ref={videoRef}
            src={status.media_url}
            autoPlay
            muted={muted}
            playsInline
            className="w-full h-full object-contain"
            onTimeUpdate={(e) => {
              const { currentTime, duration } = e.currentTarget;
              if (duration > 0) setVideoPct(currentTime / duration);
            }}
            onEnded={goNext}
            onError={() => {
              console.error('Failed to load shared status video:', status.media_url);
              setMediaBroken(true);
            }}
          />
        ) : (
          <div style={{ backgroundColor: status.background_color || '#6366f1' }} className="w-full h-full" />
        )}

        {/* Tap zones: left third = previous, the rest = next, hold = pause. */}
        <div className="absolute inset-0 z-10 flex">
          <button
            type="button"
            aria-label="Previous update"
            className="icon-btn-transparent h-full w-[30%] cursor-pointer"
            onPointerDown={onZoneDown}
            onPointerUp={() => onZoneUp('prev')}
            onPointerLeave={endHold}
            onPointerCancel={endHold}
            onContextMenu={(e) => e.preventDefault()}
          />
          <button
            type="button"
            aria-label="Next update"
            className="icon-btn-transparent h-full flex-1 cursor-pointer"
            onPointerDown={onZoneDown}
            onPointerUp={() => onZoneUp('next')}
            onPointerLeave={endHold}
            onPointerCancel={endHold}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>

        {/* Caption layer: transparent to taps, so tapping anywhere over the
            text still goes to next/previous. Only the "See more" chip and
            links inside the caption take clicks. */}
        {status.media_type === 'text' ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-8 pointer-events-none">
            <div className="w-full max-w-md">
              <StatusCaptionText
                text={status.caption}
                expanded={captionExpanded}
                onToggle={() => setCaptionExpanded(v => !v)}
                variant="big"
                clampLines={8}
                className="w-full [&_span]:pointer-events-auto [&_span]:cursor-pointer [&_a]:pointer-events-auto"
              />
            </div>
          </div>
        ) : (
          <div className="absolute bottom-32 left-0 right-0 z-20 px-6 flex justify-center pointer-events-none">
            <div className="w-full max-w-md">
              <StatusCaptionText
                text={status.caption}
                expanded={captionExpanded}
                onToggle={() => setCaptionExpanded(v => !v)}
                variant="overlay"
                clampLines={4}
                className="flex flex-col items-center justify-center [&_span]:pointer-events-auto [&_span]:cursor-pointer [&_a]:pointer-events-auto [&_p]:max-w-md [&_p]:mx-auto [&_p]:drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]"
              />
            </div>
          </div>
        )}

        {/* Story progress + poster + controls */}
        <div className="absolute top-0 left-0 right-0 z-30 px-3 pt-3 pb-8 pointer-events-none"
             style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,.6), transparent)' }}>
          <div className="flex gap-1">
            {segments.map((seg, i) => {
              const segIndex = segStart + i;
              const done = segIndex < index;
              const active = segIndex === index;
              return (
                <div key={seg.id} className="h-[3px] flex-1 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,.3)' }}>
                  {done && <div className="h-full w-full" style={{ backgroundColor: '#fff' }} />}
                  {active && (
                    isVideo ? (
                      <div className="h-full w-full origin-left" style={{ backgroundColor: '#fff', transform: `scaleX(${videoPct})` }} />
                    ) : (
                      <div
                        key={seg.id}
                        className="h-full w-full origin-left"
                        style={{
                          backgroundColor: '#fff',
                          animation: `sv-fill ${STILL_MS}ms linear forwards`,
                          animationPlayState: paused || reduceMotion.current ? 'paused' : 'running',
                        }}
                        onAnimationEnd={goNext}
                      />
                    )
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              {posterPhoto ? (
                <img src={posterPhoto} alt={posterName} className="w-10 h-10 rounded-full object-cover border-2 border-white" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-bold border-2 border-white">
                  {posterName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-white font-semibold truncate">{posterName}</p>
                <p className="text-white/70 text-xs">{timeAgo(status.created_at)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 pointer-events-auto">
              {isVideo && (
                <button
                  onClick={() => setMuted((m) => !m)}
                  className="icon-btn-transparent p-2 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all sv-glass"
                  title={muted ? 'Turn sound on' : 'Mute'}
                  aria-label={muted ? 'Turn sound on' : 'Mute'}
                >
                  {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
              )}
              <button
                onClick={onExplore}
                className="icon-btn-transparent whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full bg-white/15 hover:bg-white/25 text-white backdrop-blur-sm transition sv-glass"
                title="Explore more updates and pitches"
              >
                <Compass className="w-4 h-4" /> Explore
              </button>
              {!authLoading && !user && (
                <button onClick={() => setShowAuthModal(true)} className="icon-btn-transparent whitespace-nowrap text-xs font-semibold px-3 py-2 rounded-full bg-white/15 hover:bg-white/25 text-white transition sv-glass">
                  Sign up
                </button>
              )}
              <button onClick={goToApp} className="icon-btn-transparent p-2 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all sv-glass" title="Open IcanEra">
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="absolute bottom-0 left-0 right-0 p-4 z-30 pointer-events-none"
           style={{ background: 'linear-gradient(to top, #000 60%, transparent)' }}>
          <div className="flex items-center justify-between gap-3 pointer-events-auto">
            <button
              onClick={() => {
                if (authLoading) return;
                if (!user) { setShowAuthModal(true); return; }
                setLiked((v) => !v);
              }}
              className={`icon-btn-transparent p-3 rounded-full backdrop-blur-sm transition-all ${liked ? 'sv-liked' : 'sv-glass'}`}
            >
              <Heart className={`w-6 h-6 ${liked ? 'fill-current' : ''}`} />
            </button>
            <button onClick={handleShare} className="icon-btn-transparent p-3 rounded-full backdrop-blur-sm bg-white/10 text-white hover:bg-white/20 transition-all sv-glass">
              {copied ? <Check className="w-6 h-6 text-green-400" /> : <Share2 className="w-6 h-6" />}
            </button>
            <button
              onClick={() => {
                if (authLoading) return;
                if (!user) { setShowAuthModal(true); return; }
                setShowComments((v) => !v);
              }}
              className="icon-btn-transparent flex-1 flex items-center justify-center gap-2 p-3 rounded-full backdrop-blur-sm bg-white/10 text-white hover:bg-white/20 transition-all sv-glass"
            >
              <MessageCircle className="w-6 h-6" />
              <span className="text-sm font-medium">{messages.length || ''}</span>
            </button>
          </div>

          {showComments && (
            <div className="mt-3 max-h-64 rounded-2xl border border-white/20 backdrop-blur-md flex flex-col overflow-hidden w-full pointer-events-auto"
               style={{ backgroundColor: 'rgba(0,0,0,.7)' }}>
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
                              <p className="text-xs text-white/90 break-words leading-relaxed"><Linkify text={msg.message_text} /></p>
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
