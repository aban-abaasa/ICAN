import React, { useEffect, useState } from 'react';
import { Search, Users, Loader2 } from 'lucide-react';
import ProfessionalCard from './ProfessionalCard';
import PublicPortfolioPage from './PublicPortfolioPage';
import { listProfessionals } from '../../services/portfolioService';

/**
 * "Professionals" dashboard tab — a searchable grid of every public
 * resume/portfolio (see public_professionals view). Opening a card shows
 * that person's portfolio in-app via PublicPortfolioPage rather than
 * navigating away, so it works the same for logged-in users browsing inside
 * the dashboard.
 */
export default function ProfessionalsDirectory() {
  const [professionals, setProfessionals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewingHandle, setViewingHandle] = useState(null);

  const load = async (searchTerm = '') => {
    setIsLoading(true);
    try {
      const data = await listProfessionals({ search: searchTerm });
      setProfessionals(data);
    } catch (err) {
      console.error('Error loading professionals directory:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => load(search), 350);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="max-w-5xl mx-auto w-full pb-10">
      <div className="icn-page-head !static">
        <div className="min-w-0">
          <p className="icn-page-eyebrow">Career &amp; growth</p>
          <h1 className="icn-page-title flex items-center gap-2">
            <Users className="w-6 h-6 text-[#c4a052]" />
            Professionals
          </h1>
          <p className="icn-page-sub">Discover members sharing their resume &amp; portfolio, powered by IcanEra.</p>
        </div>
      </div>

      <div className="px-3 sm:px-4 md:px-6 pt-5">
        <div className="relative mb-5 max-w-xl">
          <Search className="w-4 h-4 text-[#c4a052] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or headline…"
            aria-label="Search professionals"
            className="w-full pl-10 pr-4 py-2.5 bg-black/30 border border-[#c4a052]/30 rounded-xl text-white placeholder-slate-500"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[#e6c980]">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> <span className="font-serif">Loading professionals…</span>
          </div>
        ) : professionals.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">
            <Users className="w-9 h-9 mx-auto mb-3 text-[#c4a052]/70" />
            <p className="font-serif text-lg text-white mb-1">{search ? 'No matches found' : 'No public profiles yet'}</p>
            <p>{search ? 'Try a different name or headline.' : 'Be the first — set a handle in My Resume on your profile.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {professionals.map((p) => (
              <ProfessionalCard key={p.user_id} professional={p} onOpen={setViewingHandle} />
            ))}
          </div>
        )}
      </div>

      {viewingHandle && <PublicPortfolioPage handle={viewingHandle} onClose={() => setViewingHandle(null)} />}
    </div>
  );
}
