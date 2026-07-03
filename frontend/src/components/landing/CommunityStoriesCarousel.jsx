import React, { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
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

  useEffect(() => {
    let cancelled = false;
    fetchPublicStatusStories(12)
      .then((rows) => { if (!cancelled) setStories(rows); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (!loading && stories.length === 0) return null;

  return (
    <section id="community-stories" className="relative py-8 md:py-12 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <Camera className={`w-4 h-4 ${isDarkTheme ? 'text-rose-300' : 'text-rose-600'}`} />
          <h3 className={`text-sm md:text-base font-bold uppercase tracking-wide ${isDarkTheme ? 'text-rose-300' : 'text-rose-700'}`}>Community Stories</h3>
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
                  <video src={s.media_url} className="w-full h-full object-cover" muted playsInline preload="none" controls />
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
          </div>
        )}
      </div>
    </section>
  );
};

export default CommunityStoriesCarousel;
