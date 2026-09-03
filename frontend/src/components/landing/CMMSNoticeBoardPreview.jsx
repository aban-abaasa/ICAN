import React, { useEffect, useState } from 'react';
import { Megaphone, Briefcase, MapPin, Building2 } from 'lucide-react';
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

// Landing-page shelf of public CMMS notices/jobs from EVERY business on
// ICANEra, browsable with no account -- same "no login required" posture as
// DropshipPreview, just for company notice boards instead of the
// marketplace. Clicking a card hands off to that business's own public
// board (/notices/:companyId?post=:id, handled in main.jsx) rather than
// trying to render the full detail/apply flow here.
const CMMSNoticeBoardPreview = () => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cmmsAnnouncementsService.browsePublicNotices({ limit: 8 })
      .then((result) => setPosts(result.data || []))
      .catch((err) => console.error('[CMMSNoticeBoardPreview] failed to load posts:', err))
      .finally(() => setLoading(false));
  }, []);

  const openPost = (post) => {
    window.location.href = cmmsAnnouncementsService.buildPublicNoticeLink(post.cmms_company_id, post.id);
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
          <h2 className={`text-2xl md:text-4xl font-black ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Announcements &amp; Job Openings from ICANEra Businesses</h2>
          <p className={`mt-2 text-sm md:text-base ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>Public notices and vacancies posted straight from CMMS — no account needed to browse or apply.</p>
        </div>

        {loading ? (
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-48 rounded-2xl border animate-pulse ${isDarkTheme ? 'border-slate-700/40 bg-slate-800/40' : 'border-slate-200 bg-slate-100'}`} />
            ))}
          </div>
        ) : (
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {posts.map((post) => (
              <button
                key={post.id}
                onClick={() => openPost(post)}
                className={`flex flex-col text-left rounded-2xl border overflow-hidden transition ${isDarkTheme ? 'border-slate-700/40 bg-slate-900/60 hover:border-purple-400/60' : 'border-slate-200 bg-white hover:border-purple-400/60'}`}
              >
                <div className={`aspect-video flex items-center justify-center overflow-hidden ${isDarkTheme ? 'bg-slate-800' : 'bg-slate-100'}`}>
                  {post.poster_url ? (
                    <img src={post.poster_url} alt="" className="w-full h-full object-cover" />
                  ) : post.post_type === 'job' ? (
                    <Briefcase className={`w-8 h-8 ${isDarkTheme ? 'text-slate-600' : 'text-slate-400'}`} />
                  ) : (
                    <Megaphone className={`w-8 h-8 ${isDarkTheme ? 'text-slate-600' : 'text-slate-400'}`} />
                  )}
                </div>
                <div className="flex flex-col flex-1 p-3.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    {post.company_logo_url ? (
                      <img src={post.company_logo_url} alt="" className="w-4 h-4 rounded object-cover flex-shrink-0" />
                    ) : (
                      <Building2 className={`w-3.5 h-3.5 flex-shrink-0 ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`} />
                    )}
                    <p className={`text-[11px] font-semibold truncate ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>{post.company_name}</p>
                  </div>
                  <p className={`text-sm font-bold line-clamp-2 min-h-[2.5rem] ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{post.title}</p>
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
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default CMMSNoticeBoardPreview;
