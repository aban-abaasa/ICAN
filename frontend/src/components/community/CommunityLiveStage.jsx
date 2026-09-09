import React, { useEffect, useRef, useState } from 'react';
import { Eye, MessageCircle, Mic, MicOff, PhoneOff, ScreenShare, ScreenShareOff, Send, SwitchCamera, ThumbsUp, Video, VideoOff, X } from 'lucide-react';

const formatElapsed = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// Icon-only, no caption and no boxed bar behind it — just a soft transparent
// circle so it reads as a simple overlay floating on the video itself
// instead of a solid control panel. `title` still gives a hover tooltip and
// `aria-label` keeps it accessible now that there's no visible text.
const ToolbarButton = ({ icon, label, active = true, danger = false, onClick, big = false }) => (
  <button onClick={onClick} title={label} aria-label={label} className="text-white/90 transition hover:text-white">
    <span
      className={`flex items-center justify-center rounded-full backdrop-blur-sm transition ${big ? 'h-14 w-14' : 'h-11 w-11'} ${
        danger ? 'bg-red-500/80 hover:bg-red-500' : active ? 'bg-black/30 hover:bg-black/45' : 'bg-red-500/70 hover:bg-red-500/85'
      }`}
    >
      {icon}
    </span>
  </button>
);

// Chat drawer over the live video — reuses whichever board the caller's
// audience already reads/writes (landing_messages for Community, the CMMS
// broadcast feed or Trust group chat for those scopes) rather than inventing
// separate live-stream-only storage, so a message posted during the stream
// is still there after the stream ends. `onLike` is optional — CMMS/Trust
// messages have no like feature, so the reaction button only renders when
// a handler is passed (Community).
const LiveChatDrawer = ({ messages, onLike, draft, onDraftChange, onSend, sending, error, onClose, isMobile, scopeLabel = 'Community' }) => {
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
        <p className="text-xs font-bold uppercase tracking-wide text-white/70">{scopeLabel} chat</p>
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
            {onLike && (
              <button
                onClick={() => onLike(m.id)}
                disabled={m.likedByMe}
                className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${m.likedByMe ? 'text-indigo-300' : 'text-white/60 hover:text-white'}`}
              >
                <ThumbsUp className="h-3 w-3" /> {m.likeCount || 0}
              </button>
            )}
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
          placeholder={`Say something to ${scopeLabel}…`}
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
 * Full-page YouTube-Live-style takeover for a "Go Live" broadcast — shown
 * for as long as `live.role` is 'broadcasting' or 'watching'. The
 * broadcaster sees their own camera as the main feed (there's nothing else
 * to show — viewers don't send video back); a viewer sees the broadcaster's
 * stream. A chat drawer (`LiveChatDrawer`) can slide up over the video.
 *
 * Originally built for the public Community "Go Live" feature and reused
 * as-is (via `scopeLabel`) for the CMMS and Trust & SACCO group video calls
 * in ChatWidget.jsx — same one-tap takeover, just labeled for whichever
 * audience `live` (a useCommunityLive instance) is scoped to.
 */
const CommunityLiveStage = ({ live, messages = [], onLike, draft = '', onDraftChange, onSend, sending = false, error = '', scopeLabel = 'Community' }) => {
  const videoRef = useRef(null);
  const videoWrapRef = useRef(null);
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

  // A static `object-contain` fixed the "extra large"/cropped complaint for
  // a portrait phone stream stretched across a wide desktop screen, but it
  // over-corrected: a landscape desktop stream (or a phone stream watched on
  // another phone — by far the common case) now sits as a needlessly small
  // strip with big black bars instead of filling the screen. The two
  // orientations need opposite treatment, so pick per-stream instead of
  // fixing one globally: `cover` (fills edge to edge, negligible crop) when
  // the video's own orientation matches the viewport it's showing in,
  // `contain` (letterboxed, no crop) only when they actually mismatch —
  // that's the one case cover would zoom in hard to compensate for.
  const [objectFit, setObjectFit] = useState('cover');
  useEffect(() => {
    const video = videoRef.current;
    const wrap = videoWrapRef.current;
    if (!video || !wrap) return undefined;

    const updateFit = () => {
      const { videoWidth, videoHeight } = video;
      const { clientWidth, clientHeight } = wrap;
      if (!videoWidth || !videoHeight || !clientWidth || !clientHeight) return;
      const videoIsPortrait = videoHeight > videoWidth;
      const wrapIsPortrait = clientHeight > clientWidth;
      setObjectFit(videoIsPortrait === wrapIsPortrait ? 'cover' : 'contain');
    };

    updateFit();
    video.addEventListener('loadedmetadata', updateFit);
    window.addEventListener('resize', updateFit);
    window.addEventListener('orientationchange', updateFit);
    return () => {
      video.removeEventListener('loadedmetadata', updateFit);
      window.removeEventListener('resize', updateFit);
      window.removeEventListener('orientationchange', updateFit);
    };
  }, [mainStream]);

  const hasVideo = Boolean(mainStream);
  const personLabel = isBroadcaster ? 'You' : (live.activeStream?.broadcasterName || 'Broadcaster');

  return (
    // `h-screen` then `h-[100dvh]` (not `inset-0`, which also pins bottom:0):
    // on mobile Chrome/Safari the address bar can shrink the *visible*
    // viewport below the *layout* viewport that `100vh`/`inset-0` measure
    // against, which was pushing the bottom toolbar (mic/camera/end call)
    // below the visible fold with no way to scroll down to it. `100dvh`
    // tracks the actual visible area; `h-screen` is the fallback for
    // browsers that don't support dvh yet (later valid rule wins, invalid
    // dvh is simply ignored by those browsers).
    <div className="fixed inset-x-0 top-0 z-[1000] flex h-screen h-[100dvh] flex-col overflow-hidden bg-black">
      <div ref={videoWrapRef} className="relative min-h-0 flex-1 bg-black">
        {hasVideo ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isBroadcaster}
            // objectFit is computed above per-stream (cover when the video's
            // orientation matches the viewport, contain when it doesn't) —
            // see the comment on that effect for why a single fixed choice
            // doesn't work across phone/web. Mirror only the broadcaster's
            // own front-camera preview for a natural selfie feel; this is
            // local-only (a CSS flip on the <video> element) and doesn't
            // touch what viewers actually receive. It's skipped once they
            // flip to the back camera, and while screen-sharing — mirroring
            // a shared screen/window would read
            // backwards for the broadcaster themselves.
            className={`h-full w-full ${objectFit === 'cover' ? 'object-cover' : 'object-contain'}`}
            style={
              isBroadcaster && !live.isScreenSharing && live.facingMode !== 'environment'
                ? { transform: 'scaleX(-1)' }
                : undefined
            }
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-white">
            <span className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-orange-500 text-2xl font-bold">
              {personLabel.trim().slice(0, 1).toUpperCase()}
            </span>
            <p className="text-sm font-medium text-white/90">
              {isBroadcaster ? 'Starting your camera…' : `Connecting to ${personLabel}…`}
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
          <p className="truncate text-sm font-medium text-white">
            {isBroadcaster
              ? live.isScreenSharing ? `Sharing your screen to ${scopeLabel}` : `You're live to ${scopeLabel}`
              : personLabel}
          </p>
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
            scopeLabel={scopeLabel}
          />
        )}
      </div>

      {live.error && (
        <p className="flex-shrink-0 bg-red-500/90 px-4 py-1.5 text-center text-xs text-white">{live.error}</p>
      )}

      {/* No boxed bar behind these anymore — each button carries its own
          translucent circle (see ToolbarButton), so the row reads as simple
          floating icons rather than a solid control panel. Bottom padding
          still respects the iOS home-indicator/gesture-bar safe area, and
          flex-wrap keeps the now-up-to-4-button row from overflowing off
          the narrowest phones instead of getting clipped. */}
      <div
        className="flex flex-shrink-0 flex-wrap items-center justify-center gap-x-6 gap-y-2 bg-transparent px-4 pt-3.5"
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
        {/* Camera on/off and flip don't apply to what's on screen while
            screen-sharing (viewers are seeing the shared screen, not the
            camera), so both are hidden rather than shown as dead buttons. */}
        {isBroadcaster && !live.isScreenSharing && (
          <ToolbarButton
            icon={live.camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            label={live.camOn ? 'Stop video' : 'Start video'}
            active={live.camOn}
            onClick={live.toggleCam}
          />
        )}
        {/* Only shown when the device actually has more than one camera
            (front + back phone) — hidden for a single-webcam desktop, so it
            never appears as a dead button. */}
        {isBroadcaster && !live.isScreenSharing && live.canSwitchCamera && (
          <ToolbarButton
            icon={<SwitchCamera className="h-5 w-5" />}
            label="Flip"
            onClick={live.switchCamera}
          />
        )}
        {/* Hidden on browsers without getDisplayMedia (notably iOS Safari)
            instead of showing a share button that can only fail. Reuses the
            same getDisplayMedia + RTCRtpSender.replaceTrack approach as the
            CMMS/Trust group calls in LiveBoardroom.jsx. */}
        {isBroadcaster && live.canShareScreen && (
          <ToolbarButton
            icon={live.isScreenSharing ? <ScreenShareOff className="h-5 w-5" /> : <ScreenShare className="h-5 w-5" />}
            label={live.isScreenSharing ? 'Stop sharing' : 'Share screen'}
            active={!live.isScreenSharing}
            onClick={live.toggleScreenShare}
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
