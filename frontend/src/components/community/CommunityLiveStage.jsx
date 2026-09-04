import React, { useEffect, useRef, useState } from 'react';
import { Eye, MessageCircle, Mic, MicOff, PhoneOff, Send, ThumbsUp, Video, VideoOff, X } from 'lucide-react';

const formatElapsed = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const ToolbarButton = ({ icon, label, active = true, danger = false, onClick, big = false }) => (
  <button onClick={onClick} className="flex flex-col items-center gap-1 text-white/90 transition hover:text-white" title={label}>
    <span
      className={`flex items-center justify-center rounded-full transition ${big ? 'h-14 w-14' : 'h-11 w-11'} ${
        danger ? 'bg-red-500 hover:bg-red-600' : active ? 'bg-white/15 hover:bg-white/25' : 'bg-red-500/90 hover:bg-red-500'
      }`}
    >
      {icon}
    </span>
    <span className="text-[10px] font-medium">{label}</span>
  </button>
);

// Chat + reactions drawer over the live video — reuses the existing public
// Community board (landing_messages, the same one the normal Community tab
// reads/writes) rather than inventing separate live-stream-only storage, so
// a message posted during the stream is still there (and still gets
// replies) after the stream ends.
const LiveChatDrawer = ({ messages, onLike, draft, onDraftChange, onSend, sending, error, onClose, isMobile }) => {
  const listRef = useRef(null);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    // Capped shorter on phones than on desktop — at 55% a small phone's
    // drawer swallows most of the video behind it, leaving almost nothing
    // of the stream visible while chatting.
    <div className={`absolute inset-x-0 bottom-0 z-10 flex ${isMobile ? 'max-h-[38%]' : 'max-h-[55%]'} flex-col rounded-t-2xl bg-black/70 backdrop-blur-md`}>
      <div className="flex items-center justify-between px-4 pt-2.5">
        <p className="text-xs font-bold uppercase tracking-wide text-white/70">Community chat</p>
        <button onClick={onClose} className="rounded-full p-2 -mr-1 text-white/70 hover:bg-white/10 hover:text-white" title="Hide chat">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-2">
        {messages.length === 0 && (
          <p className="py-4 text-center text-xs text-white/50">No messages yet — say something!</p>
        )}
        {[...messages].reverse().map((m) => (
          <div key={m.id} className="rounded-xl bg-white/10 px-2.5 py-1.5 text-sm text-white">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/60">{m.name || 'Website visitor'}</p>
            <p className="whitespace-pre-wrap break-words">{m.message}</p>
            <button
              onClick={() => onLike(m.id)}
              disabled={m.likedByMe}
              className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${m.likedByMe ? 'text-indigo-300' : 'text-white/60 hover:text-white'}`}
            >
              <ThumbsUp className="h-3 w-3" /> {m.likeCount || 0}
            </button>
          </div>
        ))}
      </div>

      {error && <p className="px-4 pb-1 text-xs text-red-300">{error}</p>}

      {/* Bottom padding respects the iOS home-indicator/gesture-bar safe
          area so the input isn't crowded against it on a phone. */}
      <div className="flex items-center gap-2 px-4 pt-1" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Say something to Community…"
          className="min-w-0 flex-1 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/50 outline-none focus:border-white/40"
        />
        <button
          onClick={onSend}
          disabled={sending || !draft.trim()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg transition disabled:opacity-40"
          title="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

/**
 * Full-page YouTube-Live-style takeover for the Community "Go Live" feature —
 * shown for as long as `live.role` is 'broadcasting' or 'watching'. The
 * broadcaster sees their own camera as the main feed (there's nothing else
 * to show — viewers don't send video back); a viewer sees the broadcaster's
 * stream. A chat/reactions drawer (`LiveChatDrawer`) can slide up over the
 * video, reusing the same public Community message board as the regular
 * Community tab.
 */
const CommunityLiveStage = ({ live, messages = [], onLike, draft = '', onDraftChange, onSend, sending = false, error = '' }) => {
  const videoRef = useRef(null);
  const [chatOpen, setChatOpen] = useState(false);
  // Matches the `window.innerWidth < 768` convention used elsewhere in the
  // app (App.jsx, ChatWidget.jsx) rather than inventing a new breakpoint.
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const isBroadcaster = live.role === 'broadcasting';
  const mainStream = isBroadcaster ? live.localStream : live.remoteStream;

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = mainStream || null;
  }, [mainStream]);

  const hasVideo = Boolean(mainStream);
  const title = isBroadcaster ? 'You' : (live.liveInfo?.broadcasterName || 'Broadcaster');

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col bg-black">
      <div className="relative flex-1 bg-slate-900">
        {hasVideo ? (
          <video ref={videoRef} autoPlay playsInline muted={isBroadcaster} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-white">
            <span className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-orange-500 text-2xl font-bold">
              {title.trim().slice(0, 1).toUpperCase()}
            </span>
            <p className="text-sm font-medium text-white/90">
              {isBroadcaster ? 'Starting your camera…' : `Connecting to ${title}…`}
            </p>
          </div>
        )}

        <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 via-black/30 to-transparent px-4 py-3">
          <div className="flex items-center gap-2 rounded-full bg-black/40 px-2.5 py-1 backdrop-blur-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            <span className="text-xs font-bold uppercase tracking-wider text-white">Live</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-xs font-medium text-white/90 backdrop-blur-sm">
              <Eye className="h-3 w-3" /> {live.viewerCount}
            </span>
            <span className="rounded-full bg-black/40 px-2.5 py-1 font-mono text-xs tabular-nums text-white/90 backdrop-blur-sm">
              {formatElapsed(live.elapsed)}
            </span>
          </div>
        </div>

        <div className="absolute bottom-4 left-4 max-w-[60%] rounded-lg bg-black/50 px-2.5 py-1 backdrop-blur-sm">
          <p className="truncate text-sm font-medium text-white">{isBroadcaster ? "You're live to Community" : title}</p>
        </div>

        {!chatOpen && (
          <button
            onClick={() => setChatOpen(true)}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-black/70"
            title="Show chat"
          >
            <MessageCircle className="h-4 w-4" /> Chat {messages.length > 0 && `(${messages.length})`}
          </button>
        )}

        {chatOpen && (
          <LiveChatDrawer
            messages={messages}
            onLike={onLike}
            draft={draft}
            onDraftChange={onDraftChange}
            onSend={onSend}
            sending={sending}
            error={error}
            onClose={() => setChatOpen(false)}
            isMobile={isMobile}
          />
        )}
      </div>

      {live.error && <p className="bg-red-500/90 px-4 py-1.5 text-center text-xs text-white">{live.error}</p>}

      {/* Bottom padding respects the iOS home-indicator/gesture-bar safe
          area so the mic/camera/leave controls aren't crowded against it. */}
      <div
        className="flex items-center justify-center gap-6 bg-slate-950/95 px-4 pt-3.5 backdrop-blur"
        style={{ paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' }}
      >
        {isBroadcaster && (
          <ToolbarButton
            icon={live.micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            label={live.micOn ? 'Mute' : 'Unmute'}
            active={live.micOn}
            onClick={live.toggleMic}
          />
        )}
        {isBroadcaster && (
          <ToolbarButton
            icon={live.camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            label={live.camOn ? 'Stop video' : 'Start video'}
            active={live.camOn}
            onClick={live.toggleCam}
          />
        )}
        <ToolbarButton
          icon={<PhoneOff className="h-6 w-6" />}
          label={isBroadcaster ? 'End stream' : 'Leave'}
          danger
          big
          onClick={isBroadcaster ? live.stopLive : live.stopWatching}
        />
      </div>
    </div>
  );
};

export default CommunityLiveStage;
