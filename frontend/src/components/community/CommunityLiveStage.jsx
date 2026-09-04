import React, { useEffect, useRef } from 'react';
import { Eye, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';

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

/**
 * Full-page YouTube-Live-style takeover for the Community "Go Live" feature —
 * shown for as long as `live.role` is 'broadcasting' or 'watching'. The
 * broadcaster sees their own camera as the main feed (there's nothing else
 * to show — viewers don't send video back); a viewer sees the broadcaster's
 * stream.
 */
const CommunityLiveStage = ({ live }) => {
  const videoRef = useRef(null);
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
            <span className="text-[11px] font-bold uppercase tracking-wider text-white">Live</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm">
              <Eye className="h-3 w-3" /> {live.viewerCount}
            </span>
            <span className="rounded-full bg-black/40 px-2.5 py-1 font-mono text-[11px] tabular-nums text-white/90 backdrop-blur-sm">
              {formatElapsed(live.elapsed)}
            </span>
          </div>
        </div>

        <div className="absolute bottom-4 left-4 max-w-[60%] rounded-lg bg-black/50 px-2.5 py-1 backdrop-blur-sm">
          <p className="truncate text-sm font-medium text-white">{isBroadcaster ? "You're live to Community" : title}</p>
        </div>
      </div>

      {live.error && <p className="bg-red-500/90 px-4 py-1.5 text-center text-xs text-white">{live.error}</p>}

      <div className="flex items-center justify-center gap-6 bg-slate-950/95 px-4 py-3.5 backdrop-blur">
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
