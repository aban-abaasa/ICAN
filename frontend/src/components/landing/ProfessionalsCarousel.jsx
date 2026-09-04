import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
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

  useEffect(() => {
    let cancelled = false;
    listFeaturedProfessionals(12)
      .then((rows) => { if (!cancelled) setProfessionals(rows); })
      .catch(() => { if (!cancelled) setProfessionals([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

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
          </div>
        )}
      </div>
    </section>
  );
};

export default ProfessionalsCarousel;
