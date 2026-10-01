import React, { useEffect, useState } from 'react';
import { Megaphone, Briefcase, MapPin, Building2, ArrowRight } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
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

// Landing-page shelf of public CMMS notices/jobs from EVERY business on
// IcanEra, browsable with no account -- same "no login required" posture as
// DropshipPreview, just for company notice boards instead of the
// marketplace. Clicking a card hands off to that business's own public
// board (/notices/:companyId?post=:id, handled in main.jsx) rather than
// trying to render the full detail/apply flow here.
const CMMSNoticeBoardPreview = () => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

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

  if (!loading && posts.length === 0) return null;

  return (
    <section id="cmms-notices-preview" className="relative py-10 md:py-16 lg:py-20 2xl:py-24 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto">
        <div className="text-center mb-8 md:mb-12">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs md:text-sm font-bold mb-4 ${isDarkTheme ? 'border-purple-300/40 bg-purple-900/25 text-purple-200' : 'border-purple-400/50 bg-purple-100 text-purple-800'}`}>
            <Megaphone className="w-4 h-4" />
            Notices &amp; Jobs
          </div>
          <h2 className={`text-2xl md:text-4xl font-black ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Announcements &amp; Job Openings from IcanEra Businesses</h2>
          <p className={`mt-2 text-sm md:text-base ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>Anyone can browse public business announcements and job openings without an account. Open a card to visit the company website, read the full post, or apply for a job.</p>
        </div>

        {loading ? (
          <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" aria-label="Loading public company announcements and job openings">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-64 w-[min(84vw,22rem)] shrink-0 snap-start rounded-xl border animate-pulse ${isDarkTheme ? 'border-slate-700 bg-slate-900' : 'border-stone-200 bg-white'}`} />
            ))}
          </div>
        ) : (
          <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0" aria-label="Public company announcements and job openings. Scroll horizontally to browse.">
            {posts.map((post) => (
              <a
                key={post.id}
                href={cmmsAnnouncementsService.buildPublicNoticeLink(post.cmms_company_id, post.id)}
                className={`group flex w-[min(84vw,22rem)] shrink-0 snap-start flex-col overflow-hidden rounded-xl border text-left transition-colors ${isDarkTheme ? 'border-slate-700 bg-slate-900 hover:border-emerald-600' : 'border-stone-200 bg-white hover:border-emerald-700'}`}
              >
                <div className={`aspect-[16/9] flex items-center justify-center overflow-hidden ${isDarkTheme ? 'bg-slate-800' : 'bg-stone-100'}`}>
                  {post.poster_url ? (
                    <img src={post.poster_url} alt="" className="w-full h-full object-cover" />
                  ) : post.post_type === 'job' ? (
                    <Briefcase className={`w-8 h-8 ${isDarkTheme ? 'text-slate-600' : 'text-slate-400'}`} />
                  ) : (
                    <Megaphone className={`w-8 h-8 ${isDarkTheme ? 'text-slate-600' : 'text-slate-400'}`} />
                  )}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-center gap-1.5 mb-1">
                    {post.company_logo_url ? (
                      <img src={post.company_logo_url} alt="" className="w-4 h-4 rounded object-cover flex-shrink-0" />
                    ) : (
                      <Building2 className={`w-3.5 h-3.5 flex-shrink-0 ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`} />
                    )}
                    <p className={`text-[11px] font-semibold truncate ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>{post.company_name}</p>
                  </div>
                  <h3 className={`text-base font-semibold leading-6 line-clamp-2 min-h-12 ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{post.title}</h3>
                  {post.summary && <p className={`mt-2 line-clamp-2 text-sm leading-5 ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>{post.summary}</p>}
                  <div className="mt-auto pt-2 flex flex-wrap gap-1.5">
                    {post.post_type === 'job' ? (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isDarkTheme ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>
                        <Briefcase className="w-2.5 h-2.5" />{post.employment_type ? EMPLOYMENT_LABELS[post.employment_type] || post.employment_type : 'Job opening'}
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isDarkTheme ? 'bg-purple-400/10 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
                        <Megaphone className="w-2.5 h-2.5" />Notice
                      </span>
                    )}
                    {post.location && (
                      <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isDarkTheme ? 'bg-slate-700/50 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                        <MapPin className="w-2.5 h-2.5" />{post.location}
                      </span>
                    )}
                  </div>
                  <span className={`mt-4 inline-flex items-center gap-2 text-sm font-semibold ${isDarkTheme ? 'text-emerald-300' : 'text-emerald-800'}`}>
                    {post.post_type === 'job' ? 'View vacancy' : 'Read announcement'}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
        {!loading && hasMore && (
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className={`rounded-md border px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${isDarkTheme ? 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800' : 'border-stone-300 bg-white text-slate-700 hover:bg-stone-50'}`}
            >
              {loadingMore ? 'Loading…' : 'Load more public posts'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

export default CMMSNoticeBoardPreview;
