import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, Briefcase, Award, GraduationCap, FolderKanban, Loader2 } from 'lucide-react';
import { getPublicPortfolio } from '../../services/portfolioService';
import RatingWidget from './RatingWidget';

const ITEM_ICONS = {
  experience: Briefcase,
  achievement: Award,
  education: GraduationCap,
  project: FolderKanban,
};

/**
 * Read-only public resume/portfolio page.
 * - As a real unauthenticated URL: App.jsx renders this when the path is
 *   /portfolio/<handle>, reading the handle from window.location.
 * - In-app: rendered as an overlay with a `handle` prop + `onClose`, e.g.
 *   from the Professionals directory or the "Preview" button in the My
 *   Resume tab.
 */
export default function PublicPortfolioPage({ handle: handleProp, onClose }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const handle = handleProp || window.location.pathname.replace(/^\/portfolio\//, '').replace(/\/$/, '');

  const load = async () => {
    setIsLoading(true);
    setNotFound(false);
    try {
      const result = await getPublicPortfolio(handle);
      if (!result) {
        setNotFound(true);
      } else {
        setData(result);
      }
    } catch (err) {
      console.error('Error loading public portfolio:', err);
      setNotFound(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  // Overlay chrome (close button, fixed positioning) only applies when a
  // caller gives us a way to close — the in-app preview/directory usages.
  // The real /portfolio/<handle> route (main.jsx) passes `handle` with no
  // `onClose` and should render as a plain full page.
  const isOverlay = Boolean(onClose);

  const content = (
    <div className="min-h-[100dvh] bg-gradient-to-b from-[#241511] via-[#3a2418] to-[#241511] text-white">
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        {isOverlay && (
          <button onClick={onClose} className="mb-4 p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-24 text-amber-200/70">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading portfolio...
          </div>
        )}

        {!isLoading && notFound && (
          <div className="text-center py-24">
            <p className="text-xl font-semibold mb-2">Profile not found</p>
            <p className="text-gray-400 text-sm">This IcanEra portfolio link isn't available or was made private.</p>
          </div>
        )}

        {!isLoading && data && (
          <>
            <div className="flex items-center gap-4 mb-6">
              {data.profile.avatar_url ? (
                <img
                  src={data.profile.avatar_url}
                  alt={data.profile.full_name}
                  className="w-24 h-24 rounded-full object-cover ring-4 ring-purple-600/50"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-700 to-purple-600 flex items-center justify-center text-3xl font-bold ring-4 ring-purple-600/50">
                  {(data.profile.full_name || 'U').charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold truncate">{data.profile.full_name}</h1>
                  {data.profile.is_verified && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" /> Verified
                    </span>
                  )}
                </div>
                <p className="text-amber-200/70 text-sm">@{data.profile.handle}</p>
                {data.portfolio?.headline && <p className="text-gray-200 mt-1">{data.portfolio.headline}</p>}
              </div>
            </div>

            {data.portfolio?.summary && (
              <p className="text-gray-300 leading-relaxed mb-6 whitespace-pre-wrap">{data.portfolio.summary}</p>
            )}

            {data.portfolio?.skills?.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-8">
                {data.portfolio.skills.map((skill) => (
                  <span key={skill} className="px-3 py-1 bg-purple-900/40 border border-purple-600/30 rounded-full text-xs text-purple-200">
                    {skill}
                  </span>
                ))}
              </div>
            )}

            {data.items.length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-3">Experience &amp; Achievements</h2>
                <div className="space-y-3">
                  {data.items.map((item) => {
                    const Icon = ITEM_ICONS[item.item_type] || Briefcase;
                    return (
                      <div key={item.id} className="flex gap-3 p-3 bg-slate-900/40 border border-amber-700/20 rounded-lg">
                        <Icon className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-white">{item.title}</p>
                            {item.source === 'cmms' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                Auto · CMMS
                              </span>
                            )}
                          </div>
                          {item.org_name && <p className="text-sm text-amber-200/70">{item.org_name}</p>}
                          {item.description && <p className="text-sm text-gray-400 mt-1">{item.description}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <RatingWidget
              rateeUserId={data.profile.id}
              ratingSummary={data.ratingSummary}
              ratings={data.ratings}
              onRated={load}
            />

            <div className="mt-10 text-center text-xs text-amber-200/50">
              Powered by <span className="font-semibold text-amber-300">IcanEra</span>
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (!isOverlay) return content;

  return <div className="fixed inset-0 z-50 overflow-y-auto">{content}</div>;
}
