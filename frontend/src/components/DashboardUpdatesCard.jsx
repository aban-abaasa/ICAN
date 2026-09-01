import React, { useEffect, useState, useCallback } from 'react';
import { Play, AlertTriangle, MessageSquare, Plus, ChevronRight, Loader2 } from 'lucide-react';
import { getActiveStatuses } from '../services/statusService';
import { useTheme } from '../context/ThemeContext';
import { fmtRelativeTime } from './landing/relativeTime';

// Figure out how to render a status's media without trusting media_type alone --
// a row can claim 'image'/'video' while media_url is empty (failed/partial save),
// so treat "no usable url" as its own case rather than letting a bad tag hide it.
const resolveMediaKind = (status) => {
  const hasUrl = Boolean(status.media_url && String(status.media_url).trim());
  if (!hasUrl) return 'text';
  const declared = (status.media_type || '').toLowerCase().trim();
  if (declared === 'image' || declared === 'video') return declared;
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(status.media_url) ? 'video' : 'image';
};

// One "Updates" thumbnail -- styled to match the landing page's Live Updates
// preview card exactly (same w-32 h-56 shape, avatar+time top overlay,
// caption bottom overlay), just with the extra interactivity the dashboard
// needs that a read-only public preview doesn't: click-to-open, an
// expiry countdown, and explicit loading/broken media states so the card
// never just sits there dark with nothing to look at.
const UpdateThumbnail = ({ status, onOpen, isDarkTheme }) => {
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mediaBroken, setMediaBroken] = useState(false);
  const kind = resolveMediaKind(status);
  const hoursLeft = Math.max(0, Math.ceil((new Date(status.expires_at) - new Date()) / (1000 * 60 * 60)));
  const posterName = status.isOwn ? 'You' : (status.poster_full_name || 'User');

  return (
    <div
      onClick={onOpen}
      className={`group relative w-32 h-56 shrink-0 snap-start rounded-xl overflow-hidden cursor-pointer hover:scale-105 transition-transform duration-300 border ${isDarkTheme ? 'border-slate-700/40 bg-slate-900' : 'border-slate-200 bg-slate-100'}`}
    >
      {kind === 'image' && !mediaBroken && (
        <img
          src={status.media_url}
          alt="Update"
          className={`w-full h-full object-cover group-hover:brightness-75 transition-all duration-300 ${mediaLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setMediaLoaded(true)}
          onError={() => setMediaBroken(true)}
        />
      )}

      {kind === 'video' && !mediaBroken && (
        <>
          <video
            src={status.media_url}
            muted
            loop
            autoPlay
            playsInline
            preload="auto"
            className={`w-full h-full object-cover group-hover:brightness-75 transition-all duration-300 ${mediaLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoadedData={(e) => {
              // Some browsers hold a video on a black frame after autoplay is
              // blocked -- nudge the playhead so a real frame is always painted.
              const v = e.currentTarget;
              try { v.currentTime = Math.min(0.15, (v.duration || 1) / 8); } catch {}
              setMediaLoaded(true);
            }}
            onError={() => setMediaBroken(true)}
          />
          {mediaLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none">
              <Play className="w-6 h-6 text-white/80" />
            </div>
          )}
        </>
      )}

      {kind === 'text' && (
        <div
          style={{ backgroundColor: status.background_color || '#6366f1' }}
          className="w-full h-full flex items-center justify-center p-4"
        >
          {status.caption ? (
            <p className="text-white text-center text-sm font-medium line-clamp-4">{status.caption}</p>
          ) : (
            <MessageSquare className="w-6 h-6 text-white/70" />
          )}
        </div>
      )}

      {/* Loading state -- covers image/video until a frame is actually ready */}
      {(kind === 'image' || kind === 'video') && !mediaLoaded && !mediaBroken && (
        <div className="absolute inset-0 flex items-center justify-center bg-black animate-pulse">
          <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
        </div>
      )}

      {/* Broken state -- explicit instead of a silent blank box */}
      {mediaBroken && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black">
          <AlertTriangle className="w-5 h-5 text-white/50" />
          <span className="text-[10px] text-white/50">Preview unavailable</span>
        </div>
      )}

      {/* Top overlay -- avatar, name, and posted time, matching the landing
          page's Live Updates card exactly (avatar chip + time over a
          top-down gradient), with the poster's name added since the
          dashboard (unlike the anonymous public preview) needs to tell
          "You" apart from everyone else. */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 p-2 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
        {status.poster_avatar_url ? (
          <img
            src={status.poster_avatar_url}
            alt={posterName}
            className="w-5 h-5 rounded-full object-cover border border-white/40 flex-shrink-0"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
        ) : null}
        <span
          className="w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex-shrink-0 items-center justify-center"
          style={{ display: status.poster_avatar_url ? 'none' : 'flex' }}
        >
          {posterName.charAt(0).toUpperCase()}
        </span>
        <span className="text-[10px] text-white/90 font-semibold truncate">{posterName}</span>
        <span className="text-[10px] text-white/70 ml-auto flex-shrink-0">{fmtRelativeTime(status.created_at)}</span>
      </div>

      {/* Expiry badge -- the dashboard's own concern, kept as a small
          secondary indicator so it doesn't compete with the top overlay. */}
      <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded-full text-[10px] text-white font-medium pointer-events-none">
        {hoursLeft}h
      </div>

      {/* Bottom overlay -- caption, exactly like the landing preview's
          caption block. Skipped for text-kind cards, which already show
          their caption centered on the colored background above. */}
      {kind !== 'text' && status.caption && (
        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent pointer-events-none">
          <p className="text-[11px] text-white line-clamp-2">{status.caption}</p>
        </div>
      )}
    </div>
  );
};

// Self-contained "Updates" card for the dashboard: fetches its own statuses,
// refreshes on an interval, and never leaves a thumbnail sitting fully blank
// -- every media state (loading/ready/broken) renders something.
const DashboardUpdatesCard = ({ userId, sectionBorder, cardBackground, onOpenViewer, onOpenComposer, refreshToken }) => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme !== 'light';
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadStatuses = useCallback(async () => {
    try {
      const { statuses: active = [] } = await getActiveStatuses();
      const own = active.filter(s => s.user_id === userId).map(s => ({ ...s, isOwn: true }));
      const others = active.filter(s => s.user_id !== userId);
      setStatuses([...own, ...others]);
    } catch (err) {
      console.error('DashboardUpdatesCard: failed to load statuses', err);
      setStatuses([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadStatuses();
    const interval = setInterval(loadStatuses, 60000);
    return () => clearInterval(interval);
  }, [loadStatuses, refreshToken]);

  const borderColor = sectionBorder || 'rgba(148,163,184,0.3)';
  const background = cardBackground || 'linear-gradient(135deg, rgba(17,24,39,0.9) 0%, rgba(30,58,138,0.28) 100%)';

  if (loading) {
    return (
      <div className="relative rounded-2xl overflow-hidden border-2 p-8" style={{ borderColor, background }}>
        <h2 className="absolute top-3 left-4 text-lg font-bold z-10 text-white">Updates</h2>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-6 h-6 text-white/50 animate-spin" />
        </div>
      </div>
    );
  }

  if (statuses.length === 0) {
    return (
      <button
        onClick={onOpenComposer}
        className="relative w-full border-2 rounded-2xl p-6 flex flex-col items-center gap-4 transition-all group"
        style={{ borderColor, background }}
      >
        <span className="absolute top-3 left-4 text-lg font-bold drop-shadow-lg text-white">Updates</span>
        <div className="w-16 h-16 rounded-full flex items-center justify-center transition mt-4 bg-white/10">
          <Plus className="w-8 h-8 text-white/80" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-bold text-white">Any Updates</h3>
          <p className="text-sm text-white/60 mt-1">Share a moment with your community</p>
        </div>
        <div className="flex items-center gap-2 text-white/80">
          <span className="text-sm font-medium">Start Now</span>
          <ChevronRight className="w-4 h-4" />
        </div>
      </button>
    );
  }

  return (
    <div className="relative">
      <h2 className="absolute top-3 left-4 text-lg font-bold z-10 drop-shadow-lg text-white">Updates</h2>

      <div className="overflow-x-auto pb-4 -mr-4 pr-4 scrollbar-hide pt-10 snap-x snap-mandatory">
        <div className="flex gap-3 min-w-min">
          {statuses.map(status => (
            <UpdateThumbnail key={status.id} status={status} onOpen={() => onOpenViewer?.(status)} isDarkTheme={isDarkTheme} />
          ))}
        </div>
      </div>

      <button
        onClick={() => onOpenViewer?.()}
        className="w-full border-2 rounded-2xl py-3 flex items-center justify-center gap-2 transition-all group mt-2 hover:scale-[1.01]"
        style={{ borderColor, background }}
      >
        <span className="text-sm font-medium text-white">View All Updates ({statuses.length})</span>
        <ChevronRight className="w-4 h-4 text-white/80" />
      </button>
    </div>
  );
};

export default DashboardUpdatesCard;
