import React, { useEffect, useState } from 'react';
import { Camera, ArrowRight, Play } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { fetchPublicStatusStories } from '../../services/landingStatusService';
import { fmtRelativeTime } from './relativeTime';

// Real public Status posts (photos/videos, 24h stories) from ICANera's
// dashboard, surfaced here read-only for anonymous visitors. Fails silently
// to an empty list (section just doesn't render) if the storage bucket's
// policy doesn't permit anonymous signed-URL generation — see
// src/services/landingStatusService.js.
const CommunityStoriesCarousel = () => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [playingIds, setPlayingIds] = useState(() => new Set());
  const PAGE_SIZE = 12;

  useEffect(() => {
    let cancelled = false;
    fetchPublicStatusStories(PAGE_SIZE, 0)
      .then((rows) => {
        if (cancelled) return;
        setStories(rows);
        setHasMore(rows.length >= PAGE_SIZE);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleLoadMore = () => {
    setLoadingMore(true);
    fetchPublicStatusStories(PAGE_SIZE, stories.length)
      .then((rows) => {
        setStories((prev) => [...prev, ...rows]);
        setHasMore(rows.length >= PAGE_SIZE);
      })
      .finally(() => setLoadingMore(false));
  };

  if (!loading && stories.length === 0) return null;

  return (
    <section id="live-explore" className="relative py-8 md:py-12 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <Camera className={`w-4 h-4 ${isDarkTheme ? 'text-rose-300' : 'text-rose-600'}`} />
          <h3 className={`text-sm md:text-base font-bold uppercase tracking-wide ${isDarkTheme ? 'text-rose-300' : 'text-rose-700'}`}>Live Updates</h3>
          <span className={`text-xs ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>· real posts, expire after 24h</span>
        </div>

        {loading ? (
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`w-32 h-56 shrink-0 rounded-xl border animate-pulse ${isDarkTheme ? 'border-slate-700/40 bg-slate-800/40' : 'border-slate-200 bg-slate-100'}`} />
            ))}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
            {stories.map((s) => (
              <div key={s.id} className={`relative w-32 h-56 shrink-0 snap-start rounded-xl overflow-hidden border ${isDarkTheme ? 'border-slate-700/40 bg-slate-900' : 'border-slate-200 bg-slate-100'}`}>
                {s.media_type === 'video' ? (
                  <>
                    {/* preload="metadata" (not "none") so the browser paints the
                        first frame as a poster instead of a solid black box
                        before the visitor presses play. */}
                    <video
                      src={`${s.media_url}#t=0.1`}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                      controls
                      onPlay={() => setPlayingIds((prev) => new Set(prev).add(s.id))}
                      onPause={() => setPlayingIds((prev) => { const next = new Set(prev); next.delete(s.id); return next; })}
                    />
                    {!playingIds.has(s.id) && (
                      <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                          <Play className="w-4 h-4 text-white fill-white" />
                        </span>
                      </span>
                    )}
                  </>
                ) : (
                  <img src={s.media_url} alt={s.caption || 'Community story'} className="w-full h-full object-cover" loading="lazy" />
                )}
                <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 p-2 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
                  <span className="w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {(s.user_id || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-[10px] text-white/90 font-semibold">{fmtRelativeTime(s.created_at)}</span>
                </div>
                {s.caption && (
                  <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent pointer-events-none">
                    <p className="text-[11px] text-white line-clamp-2">{s.caption}</p>
                  </div>
                )}
              </div>
            ))}

            {/* "More" tile at the end of the row instead of a button below
                a growing grid — keeps this a single scrollable row. */}
            {hasMore && stories.length > 0 && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className={`flex flex-col items-center justify-center gap-2 w-20 h-56 shrink-0 snap-start rounded-xl border-2 border-dashed transition disabled:opacity-50 ${isDarkTheme ? 'border-slate-600/50 bg-white/5 text-slate-200 hover:bg-white/10 hover:border-rose-400/50' : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:border-rose-400/60'}`}
              >
                {loadingMore ? (
                  <span className="text-xs font-bold">Loading…</span>
                ) : (
                  <>
                    <span className={`flex items-center justify-center w-8 h-8 rounded-full ${isDarkTheme ? 'bg-rose-400/10' : 'bg-rose-100'}`}>
                      <ArrowRight className="w-4 h-4 text-rose-500" />
                    </span>
                    <span className="text-xs font-bold">More</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default CommunityStoriesCarousel;
