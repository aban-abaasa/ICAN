import React, { useEffect, useState } from 'react';
import { Users2, ShieldCheck } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { getPublicTrustGroups } from '../../services/trustService';

const TrustGroupsPreview = ({ onGetStarted }) => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPublicTrustGroups()
      .then((rows) => setGroups(rows || []))
      .catch((err) => console.error('[TrustGroupsPreview] failed to load trust groups:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section id="trust-groups-preview" className="relative py-10 md:py-16 lg:py-20 2xl:py-24 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto">
        <div className="text-center mb-8 md:mb-12">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs md:text-sm font-bold mb-4 ${isDarkTheme ? 'border-amber-300/40 bg-amber-900/25 text-amber-200' : 'border-amber-400/50 bg-amber-100 text-amber-800'}`}>
            <ShieldCheck className="w-4 h-4" />
            TRUST Groups
          </div>
          <h2 className={`text-2xl md:text-4xl font-black ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Save Together, Grow Faster</h2>
          <p className={`mt-2 text-sm md:text-base ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>Browse active, democratic savings groups. Sign in to join one.</p>
        </div>

        {loading ? (
          <div className="grid gap-5 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-40 rounded-2xl border animate-pulse ${isDarkTheme ? 'border-slate-700/40 bg-slate-800/40' : 'border-slate-200 bg-slate-100'}`} />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className={`text-center text-sm ${isDarkTheme ? 'text-slate-500' : 'text-slate-500'}`}>No active groups yet — be the first to start one after signing in.</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-3">
            {groups.slice(0, 6).map((group) => (
              <div key={group.id} className={`flex flex-col rounded-2xl border p-5 ${isDarkTheme ? 'border-slate-700/40 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
                <h3 className={`text-base font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{group.name}</h3>
                <p className={`mt-1 text-sm line-clamp-3 flex-1 ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>{group.description}</p>

                <div className={`mt-3 flex items-center gap-1.5 text-xs ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                  <Users2 className="w-3.5 h-3.5" />
                  {group.member_count}{group.max_members ? ` / ${group.max_members}` : ''} members
                </div>
                <p className={`mt-1 text-xs font-semibold ${isDarkTheme ? 'text-amber-300' : 'text-amber-700'}`}>
                  {group.monthly_contribution?.toLocaleString?.() ?? group.monthly_contribution} {group.currency} / month
                </p>

                <button
                  onClick={() => onGetStarted?.('signin')}
                  className={`mt-3 text-xs font-bold underline decoration-dotted ${isDarkTheme ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  Sign in to join this group →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default TrustGroupsPreview;
