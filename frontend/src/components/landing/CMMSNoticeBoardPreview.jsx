import React, { useEffect, useRef, useState } from 'react';
import { Megaphone, Briefcase, MapPin, Building2, ArrowRight, Search, X, Globe, ExternalLink, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTheme, isDarkFamilyTheme } from '../../context/ThemeContext';
import cmmsAnnouncementsService from '../../services/cmmsAnnouncementsService';

const EMPLOYMENT_LABELS = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
  volunteer: 'Volunteer',
};
const PAGE_SIZE = 50;
const BIZ_PAGE_SIZE = 12;
// Collapsed by default so this section stays a compact strip of the page; the
// visitor opens it up with "Show more" and folds it back with "Show less".
const SLIDE_MS = 4200;
// One accent pair per card, cycled -- each business slides in with its own colour.
const ACCENTS = [
  { a: '#14532d', b: '#c9a24a' }, // forest & brass
  { a: '#9a3412', b: '#f59e0b' }, // terracotta & amber
  { a: '#1e3a8a', b: '#38bdf8' }, // navy & sky
  { a: '#6b21a8', b: '#e879f9' }, // plum & orchid
  { a: '#0f766e', b: '#5eead4' }, // teal & mint
  { a: '#9f1239', b: '#fb7185' }, // wine & rose
];
const POSTS_COLLAPSED = 4;

// Landing-page shelf of public CMMS notices/jobs from EVERY business on
// IcanEra, browsable with no account -- same "no login required" posture as
// DropshipPreview, just for company notice boards instead of the
// marketplace. Clicking a card hands off to that business's own public
// board (/notices/:companyId?post=:id, handled in main.jsx) rather than
// trying to render the full detail/apply flow here.
const CMMSNoticeBoardPreview = () => {
  const { actualTheme } = useTheme();
  const isDarkTheme = isDarkFamilyTheme(actualTheme);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [businesses, setBusinesses] = useState([]);
  const [bizLoading, setBizLoading] = useState(true);
  const [bizLoadingMore, setBizLoadingMore] = useState(false);
  const [bizHasMore, setBizHasMore] = useState(false);
  const [bizPaused, setBizPaused] = useState(false);
  const bizTrackRef = useRef(null);
  const [postsExpanded, setPostsExpanded] = useState(false);

  useEffect(() => {
    cmmsAnnouncementsService.browsePublicNotices({ limit: PAGE_SIZE })
      .then((result) => {
        const nextPosts = result.data || [];
        setPosts(nextPosts);
        setHasMore(nextPosts.length === PAGE_SIZE);
      })
      .catch((err) => console.error('[CMMSNoticeBoardPreview] failed to load posts:', err))
      .finally(() => setLoading(false));
  }, []);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await cmmsAnnouncementsService.browsePublicNotices({ limit: PAGE_SIZE, offset: posts.length });
      const nextPosts = result.data || [];
      setPosts((current) => [...current, ...nextPosts]);
      setHasMore(nextPosts.length === PAGE_SIZE);
    } catch (err) {
      console.error('[CMMSNoticeBoardPreview] failed to load more posts:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Business directory: debounced search by name (also industry/town/tagline).
  // Empty box = the most active businesses, so the section is never blank.
  useEffect(() => {
    let cancelled = false;
    setBizLoading(true);
    const timer = setTimeout(() => {
      cmmsAnnouncementsService.searchPublicBusinesses({ query, limit: BIZ_PAGE_SIZE })
        .then((result) => {
          if (cancelled) return;
          setBusinesses(result.data || []);
          setBizHasMore((result.data || []).length === BIZ_PAGE_SIZE);
        })
        .catch((err) => console.error('[CMMSNoticeBoardPreview] business search failed:', err))
        .finally(() => { if (!cancelled) setBizLoading(false); });
    }, query ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const loadMoreBusinesses = async () => {
    if (bizLoadingMore || !bizHasMore) return;
    setBizLoadingMore(true);
    try {
      const result = await cmmsAnnouncementsService.searchPublicBusinesses({ query, limit: BIZ_PAGE_SIZE, offset: businesses.length });
      const next = result.data || [];
      setBusinesses((current) => [...current, ...next]);
      setBizHasMore(next.length === BIZ_PAGE_SIZE);
    } catch (err) {
      console.error('[CMMSNoticeBoardPreview] failed to load more businesses:', err);
    } finally {
      setBizLoadingMore(false);
    }
  };

  const slideBiz = (direction) => {
    const track = bizTrackRef.current;
    if (!track) return;
    const step = (track.firstElementChild?.getBoundingClientRect().width || 280) + 12;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
    if (direction > 0 && atEnd) {
      if (bizHasMore && !bizLoadingMore) loadMoreBusinesses();
      track.scrollTo({ left: 0, behavior: 'smooth' });
    } else if (direction < 0 && track.scrollLeft <= 8) {
      track.scrollTo({ left: track.scrollWidth, behavior: 'smooth' });
    } else {
      track.scrollBy({ left: direction * step, behavior: 'smooth' });
    }
  };

  // Gentle auto-slide; pauses on hover/touch/focus and for reduced-motion users.
  useEffect(() => {
    if (bizPaused || businesses.length < 2) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = setInterval(() => slideBiz(1), SLIDE_MS);
    return () => clearInterval(id);
  });

  const hasQuery = query.trim().length > 0;
  if (!loading && !bizLoading && posts.length === 0 && businesses.length === 0 && !hasQuery) return null;

  const muted = isDarkTheme ? 'text-slate-400' : 'text-slate-600';
  const shownPosts = postsExpanded ? posts : posts.slice(0, POSTS_COLLAPSED);
  // classic printed-card look shared by every card/button in this section
  const cardBase = isDarkTheme
    ? 'border-amber-300/30 bg-slate-900 hover:border-amber-300/70 shadow-[3px_3px_0_0_rgba(0,0,0,0.35)]'
    : 'border-[#1f1a12]/35 bg-[#fffdf6] hover:border-[#14532d] shadow-[3px_3px_0_0_rgba(31,26,18,0.12)]';
  const ruleBtn = isDarkTheme
    ? 'border-amber-300/50 text-amber-200 hover:bg-amber-300/10'
    : 'border-[#1f1a12]/60 text-[#1f1a12] hover:bg-[#1f1a12] hover:text-[#f7f3e8]';

  return (
    <section id="cmms-notices-preview" className="relative py-8 md:py-12 lg:py-14 2xl:py-16 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto">
        <div className="text-center mb-6 md:mb-8">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs md:text-sm font-bold mb-4 ${isDarkTheme ? 'border-purple-300/40 bg-purple-900/25 text-purple-200' : 'border-purple-400/50 bg-purple-100 text-purple-800'}`}>
            <Megaphone className="w-4 h-4" />
            Notices &amp; Jobs
          </div>
          <h2 className={`text-2xl md:text-4xl font-black ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Announcements &amp; Job Openings from IcanEra Businesses</h2>
          <p className={`mt-2 text-sm md:text-base ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>Anyone can browse public business announcements and job openings without an account. Or search any business by name to open its free IcanEra website.</p>
        </div>

        {/* Business directory search */}
        <div className="mx-auto mb-8">
          <div className={`mx-auto flex max-w-3xl items-center gap-3 rounded-sm border-2 px-4 py-3 transition-colors focus-within:border-emerald-700 ${isDarkTheme ? 'border-amber-300/40 bg-slate-900 shadow-[4px_4px_0_0_rgba(0,0,0,0.35)]' : 'border-[#1f1a12]/60 bg-[#fffdf6] shadow-[4px_4px_0_0_rgba(31,26,18,0.14)]'}`}>
            <Search className={`h-5 w-5 flex-shrink-0 ${isDarkTheme ? 'text-emerald-300' : 'text-emerald-700'}`} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a business by name — e.g. “Kampala Hardware”"
              aria-label="Search businesses on IcanEra by name"
              maxLength={80}
              className={`min-w-0 flex-1 bg-transparent text-base outline-none ${isDarkTheme ? 'text-white placeholder:text-slate-500' : 'text-slate-900 placeholder:text-slate-400'}`}
            />
            {hasQuery && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className={`rounded-full p-1 ${isDarkTheme ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-stone-100'}`}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className={`mx-auto mt-2 max-w-3xl text-center text-xs ${muted}`}>
            {hasQuery ? 'Matches business name, industry, town and tagline.' : 'Showing active businesses. Every business on IcanEra gets its own website with jobs, notices, products and contact details.'}
          </p>

          {bizLoading && businesses.length === 0 ? (
            <div className="mt-5 flex gap-3 overflow-hidden" aria-label="Searching businesses">
              {[0, 1, 2].map((i) => (
                <div key={i} className={`h-36 w-[min(78vw,17rem)] shrink-0 animate-pulse rounded-sm border ${isDarkTheme ? 'border-slate-700 bg-slate-900' : 'border-stone-200 bg-white'}`} />
              ))}
            </div>
          ) : businesses.length === 0 ? (
            <p className={`mt-6 text-center text-sm ${muted}`}>No business found for “{query.trim()}”. Try a shorter name or another spelling.</p>
          ) : (
            <div
              className={`relative mt-5 transition-opacity ${bizLoading ? 'opacity-60' : ''}`}
              onMouseEnter={() => setBizPaused(true)}
              onMouseLeave={() => setBizPaused(false)}
              onTouchStart={() => setBizPaused(true)}
              onFocusCapture={() => setBizPaused(true)}
              onBlurCapture={() => setBizPaused(false)}
            >
              <style>{`
                @keyframes nbSlideIn { from { opacity: 0; transform: translateX(28px) scale(.97); } to { opacity: 1; transform: none; } }
                @keyframes nbBar { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
                @keyframes nbGlow { 0%, 100% { box-shadow: 3px 3px 0 0 var(--nb-a-soft); } 50% { box-shadow: 3px 3px 0 0 var(--nb-a-soft), 0 0 18px 2px var(--nb-b-soft); } }
                .nb-slide { animation: nbSlideIn .6s cubic-bezier(.22,1,.36,1) both, nbGlow 4.5s ease-in-out infinite; transition: transform .25s ease; }
                .nb-slide:hover { transform: translateY(-4px); }
                .nb-bar { background-size: 200% 100%; animation: nbBar 3.2s linear infinite; }
                .nb-track { scrollbar-width: none; -ms-overflow-style: none; }
                .nb-track::-webkit-scrollbar { display: none; }
                @media (prefers-reduced-motion: reduce) { .nb-slide, .nb-bar { animation: none; } }
              `}</style>
              <div ref={bizTrackRef} className="nb-track -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-4 pt-1 sm:mx-0 sm:px-1" aria-label="Businesses on IcanEra. Scroll or use the arrows to browse.">
                {businesses.map((biz, i) => {
                  const ac = ACCENTS[i % ACCENTS.length];
                  const accent = isDarkTheme ? ac.b : ac.a;
                  return (
                    <div
                      key={biz.id}
                      className={`nb-slide group flex w-[min(78vw,17rem)] shrink-0 snap-start flex-col overflow-hidden rounded-sm border ${isDarkTheme ? 'border-white/15 bg-slate-900' : 'border-[#1f1a12]/30 bg-[#fffdf6]'}`}
                      style={{ '--nb-a-soft': `${ac.a}38`, '--nb-b-soft': `${ac.b}66`, animationDelay: `${Math.min(i, 8) * 90}ms, ${i * 400}ms`, borderColor: undefined }}
                    >
                      <div className="nb-bar h-1.5 w-full" style={{ backgroundImage: `linear-gradient(90deg, ${ac.a}, ${ac.b}, ${ac.a})` }} />
                      <a href={cmmsAnnouncementsService.buildPublicBusinessLink(biz.id)} className="flex flex-1 items-start gap-3 p-3">
                        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm" style={{ border: `2px solid ${accent}`, background: `${ac.b}22` }}>
                          {biz.logo_url ? <img src={biz.logo_url} alt="" className="h-full w-full object-cover" /> : <Building2 className="h-6 w-6" style={{ color: accent }} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className={`truncate text-[15px] font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{biz.company_name}</h3>
                          {biz.tagline && <p className={`line-clamp-1 text-[13px] ${muted}`}>{biz.tagline}</p>}
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {biz.industry && <span className="rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: accent, borderColor: `${accent}55` }}>{biz.industry}</span>}
                            {biz.location && <span className={`inline-flex items-center gap-0.5 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold ${isDarkTheme ? 'border-white/15 text-slate-300' : 'border-[#1f1a12]/20 text-slate-600'}`}><MapPin className="h-2.5 w-2.5" />{biz.location}</span>}
                            {Number(biz.open_jobs) > 0 && <span className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: ac.a }}><Briefcase className="h-2.5 w-2.5" />{biz.open_jobs} {Number(biz.open_jobs) === 1 ? 'job' : 'jobs'}</span>}
                            {Number(biz.notices) > 0 && <span className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold" style={{ background: ac.b, color: '#1f1a12' }}><Megaphone className="h-2.5 w-2.5" />{biz.notices} {Number(biz.notices) === 1 ? 'notice' : 'notices'}</span>}
                          </div>
                        </div>
                      </a>
                      <div className={`flex items-center justify-between gap-2 border-t border-double px-3 py-1.5 text-sm font-semibold ${isDarkTheme ? 'border-white/10' : 'border-[#1f1a12]/15'}`}>
                        <a href={cmmsAnnouncementsService.buildPublicBusinessLink(biz.id)} className="inline-flex items-center gap-1.5" style={{ color: accent }}>
                          <Globe className="h-4 w-4" />Visit website<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </a>
                        {biz.website && (
                          <a href={/^https?:\/\//i.test(biz.website) ? biz.website : `https://${biz.website}`} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 text-xs ${muted} hover:underline`}>
                            Own site<ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
                {bizHasMore && (
                  <button type="button" onClick={loadMoreBusinesses} disabled={bizLoadingMore} className={`flex w-[min(60vw,11rem)] shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-sm border-2 border-dashed p-4 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${ruleBtn}`}>
                    {bizLoadingMore ? 'Loading…' : <>More businesses<ArrowRight className="h-4 w-4" /></>}
                  </button>
                )}
              </div>
              {businesses.length > 1 && (
                <>
                  <button type="button" onClick={() => slideBiz(-1)} aria-label="Previous businesses" className={`absolute -left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-sm border-2 shadow-md transition-colors md:flex ${isDarkTheme ? 'border-amber-300/60 bg-slate-900 text-amber-200 hover:bg-slate-800' : 'border-[#1f1a12]/70 bg-[#fffdf6] text-[#1f1a12] hover:bg-[#1f1a12] hover:text-[#f7f3e8]'}`}>
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => slideBiz(1)} aria-label="Next businesses" className={`absolute -right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-sm border-2 shadow-md transition-colors md:flex ${isDarkTheme ? 'border-amber-300/60 bg-slate-900 text-amber-200 hover:bg-slate-800' : 'border-[#1f1a12]/70 bg-[#fffdf6] text-[#1f1a12] hover:bg-[#1f1a12] hover:text-[#f7f3e8]'}`}>
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {posts.length > 0 && (
          <h3 className={`mb-4 text-lg font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Latest notices &amp; job openings</h3>
        )}

        {loading ? (
          <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" aria-label="Loading public company announcements and job openings">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-64 w-[min(84vw,22rem)] shrink-0 snap-start rounded-xl border animate-pulse ${isDarkTheme ? 'border-slate-700 bg-slate-900' : 'border-stone-200 bg-white'}`} />
            ))}
          </div>
        ) : (
          <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0" aria-label="Public company announcements and job openings. Scroll horizontally to browse.">
            {shownPosts.map((post) => (
              <a
                key={post.id}
                href={cmmsAnnouncementsService.buildPublicNoticeLink(post.cmms_company_id, post.id)}
                className={`group flex w-[min(78vw,18rem)] shrink-0 snap-start flex-col overflow-hidden rounded-sm border text-left transition-colors ${cardBase}`}
              >
                <div className={`aspect-[16/7] flex items-center justify-center overflow-hidden ${isDarkTheme ? 'bg-slate-800' : 'bg-stone-100'}`}>
                  {post.poster_url ? (
                    <img src={post.poster_url} alt="" className="w-full h-full object-cover" />
                  ) : post.post_type === 'job' ? (
                    <Briefcase className={`w-8 h-8 ${isDarkTheme ? 'text-slate-600' : 'text-slate-400'}`} />
                  ) : (
                    <Megaphone className={`w-8 h-8 ${isDarkTheme ? 'text-slate-600' : 'text-slate-400'}`} />
                  )}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    {post.company_logo_url ? (
                      <img src={post.company_logo_url} alt="" className="w-4 h-4 rounded object-cover flex-shrink-0" />
                    ) : (
                      <Building2 className={`w-3.5 h-3.5 flex-shrink-0 ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`} />
                    )}
                    <p className={`text-[11px] font-semibold truncate ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>{post.company_name}</p>
                  </div>
                  <h3 className={`text-[15px] font-semibold leading-5 line-clamp-2 min-h-10 ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{post.title}</h3>
                  {post.summary && <p className={`mt-1.5 line-clamp-2 text-[13px] leading-5 ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>{post.summary}</p>}
                  <div className="mt-auto pt-2 flex flex-wrap gap-1.5">
                    {post.post_type === 'job' ? (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border border-current/20 ${isDarkTheme ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>
                        <Briefcase className="w-2.5 h-2.5" />{post.employment_type ? EMPLOYMENT_LABELS[post.employment_type] || post.employment_type : 'Job opening'}
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border border-current/20 ${isDarkTheme ? 'bg-purple-400/10 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
                        <Megaphone className="w-2.5 h-2.5" />Notice
                      </span>
                    )}
                    {post.location && (
                      <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border border-current/20 ${isDarkTheme ? 'bg-slate-700/50 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                        <MapPin className="w-2.5 h-2.5" />{post.location}
                      </span>
                    )}
                  </div>
                  <span className={`mt-3 inline-flex items-center gap-2 text-sm font-semibold ${isDarkTheme ? 'text-emerald-300' : 'text-emerald-800'}`}>
                    {post.post_type === 'job' ? 'View vacancy' : 'Read announcement'}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
        {!loading && (posts.length > POSTS_COLLAPSED || hasMore) && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {!postsExpanded ? (
              <button type="button" onClick={() => setPostsExpanded(true)} className={`inline-flex items-center gap-1.5 rounded-sm border-2 px-4 py-2 text-sm font-semibold transition-colors ${ruleBtn}`}>
                Show more notices &amp; jobs<ChevronDown className="h-4 w-4" />
              </button>
            ) : (
              <>
                {hasMore && (
                  <button type="button" onClick={loadMore} disabled={loadingMore} className={`rounded-sm border-2 px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${ruleBtn}`}>
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                )}
                <button type="button" onClick={() => setPostsExpanded(false)} className={`inline-flex items-center gap-1.5 rounded-sm border-2 px-4 py-2 text-sm font-semibold transition-colors ${ruleBtn}`}>
                  Show less<ChevronUp className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default CMMSNoticeBoardPreview;
