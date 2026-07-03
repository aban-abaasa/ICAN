import React, { useCallback, useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { fetchPublishedUpdates, subscribeToPublishedUpdates } from '../../services/landingUpdatesService';
import { fmtRelativeTime } from './relativeTime';

const UpdatesFeed = () => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    return fetchPublishedUpdates(10)
      .then((rows) => setUpdates(rows))
      .catch((err) => console.error('[UpdatesFeed] failed to load updates:', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    return subscribeToPublishedUpdates(() => load());
  }, [load]);

  return (
    <section id="live-explore" className="relative py-10 md:py-16 lg:py-20 2xl:py-24 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-5xl 2xl:max-w-6xl mx-auto">
        <div className="text-center mb-8 md:mb-12">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs md:text-sm font-bold mb-4 ${isDarkTheme ? 'border-emerald-300/40 bg-emerald-900/25 text-emerald-200' : 'border-emerald-400/50 bg-emerald-100 text-emerald-800'}`}>
            <Megaphone className="w-4 h-4" />
            Live from ICANera
          </div>
          <h2 className={`text-2xl md:text-4xl font-black ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Latest Updates</h2>
          <p className={`mt-2 text-sm md:text-base ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>What's new across the platform — no account needed to browse.</p>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className={`h-28 rounded-2xl border animate-pulse ${isDarkTheme ? 'border-slate-700/40 bg-slate-800/40' : 'border-slate-200 bg-slate-100'}`} />
            ))}
          </div>
        ) : updates.length === 0 ? (
          <p className={`text-center text-sm ${isDarkTheme ? 'text-slate-500' : 'text-slate-500'}`}>No updates yet — check back soon.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {updates.map((u) => (
              <div key={u.id} className={`rounded-2xl border p-5 transition-colors ${isDarkTheme ? 'border-slate-700/40 bg-slate-900/60 hover:border-emerald-400/40' : 'border-slate-200 bg-white hover:border-emerald-400/60'}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-[11px] font-bold uppercase tracking-wide ${isDarkTheme ? 'text-emerald-300' : 'text-emerald-700'}`}>{u.category}</span>
                  <span className={`text-xs ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>{fmtRelativeTime(u.created_at)}</span>
                </div>
                <h3 className={`mt-2 text-lg font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{u.title}</h3>
                <p className={`mt-1 text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>{u.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default UpdatesFeed;
