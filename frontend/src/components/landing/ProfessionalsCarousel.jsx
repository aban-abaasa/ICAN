import React, { useEffect, useState } from 'react';
import { Users, ArrowRight } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { listFeaturedProfessionals } from '../../services/portfolioService';
import ProfessionalCard from '../profile/ProfessionalCard';

/**
 * Real public IcanEra resume/portfolio cards, surfaced for anonymous
 * landing-page visitors — same "no-login share link" reasoning as the
 * Pitchin/status/dropship previews on this page. Mirrors
 * CommunityStoriesCarousel's scroll-snap layout and fail-silent behavior.
 * Opening a card sends the visitor to the real public /portfolio/<handle>
 * page (a fresh navigation, since this page hasn't signed in yet).
 */
const ProfessionalsCarousel = () => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const [professionals, setProfessionals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 12;

  useEffect(() => {
    let cancelled = false;
    listFeaturedProfessionals(PAGE_SIZE, 0)
      .then((rows) => {
        if (cancelled) return;
        setProfessionals(rows);
        setHasMore(rows.length >= PAGE_SIZE);
      })
      .catch(() => { if (!cancelled) setProfessionals([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleLoadMore = () => {
    setLoadingMore(true);
    listFeaturedProfessionals(PAGE_SIZE, professionals.length)
      .then((rows) => {
        setProfessionals((prev) => [...prev, ...rows]);
        setHasMore(rows.length >= PAGE_SIZE);
      })
      .catch((err) => console.error('[ProfessionalsCarousel] failed to load more professionals:', err))
      .finally(() => setLoadingMore(false));
  };

  if (!loading && professionals.length === 0) return null;

  return (
    <section id="professionals" className="relative py-8 md:py-12 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <Users className={`w-4 h-4 ${isDarkTheme ? 'text-amber-300' : 'text-amber-700'}`} />
          <h3 className={`text-sm md:text-base font-bold uppercase tracking-wide ${isDarkTheme ? 'text-amber-300' : 'text-amber-700'}`}>
            Professionals on IcanEra
          </h3>
          <span className={`text-xs ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>· real resumes &amp; portfolios</span>
        </div>

        {loading ? (
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`w-56 h-32 shrink-0 rounded-xl border animate-pulse ${isDarkTheme ? 'border-slate-700/40 bg-slate-800/40' : 'border-slate-200 bg-slate-100'}`} />
            ))}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
            {professionals.map((p) => (
              <div key={p.user_id} className="snap-start">
                <ProfessionalCard
                  professional={p}
                  compact
                  onOpen={(handle) => { window.location.href = `/portfolio/${handle}`; }}
                />
              </div>
            ))}

            {/* "More" tile at the end of the row instead of a button below
                a growing grid — keeps this a single scrollable row. */}
            {hasMore && professionals.length > 0 && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className={`flex flex-col items-center justify-center gap-2 w-28 h-32 shrink-0 snap-start rounded-xl border-2 border-dashed transition disabled:opacity-50 ${isDarkTheme ? 'border-slate-600/50 bg-white/5 text-slate-200 hover:bg-white/10 hover:border-amber-400/50' : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:border-amber-400/60'}`}
              >
                {loadingMore ? (
                  <span className="text-xs font-bold">Loading…</span>
                ) : (
                  <>
                    <span className={`flex items-center justify-center w-8 h-8 rounded-full ${isDarkTheme ? 'bg-amber-400/10' : 'bg-amber-100'}`}>
                      <ArrowRight className="w-4 h-4 text-amber-500" />
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

export default ProfessionalsCarousel;
