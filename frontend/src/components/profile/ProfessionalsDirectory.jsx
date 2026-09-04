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
    <div className="max-w-5xl mx-auto w-full px-3 sm:px-4 md:px-6 py-4">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Users className="w-6 h-6 text-amber-400" />
          Professionals
        </h1>
        <p className="text-sm text-amber-100/60 mt-1">
          Discover members sharing their resume &amp; portfolio, powered by IcanEra.
        </p>
      </div>

      <div className="relative mb-5">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or headline..."
          className="w-full pl-9 pr-4 py-2.5 bg-slate-900/60 border border-amber-700/30 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-amber-200/70">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading professionals...
        </div>
      ) : professionals.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          No public profiles yet. Be the first — set a handle in My Resume on your profile.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {professionals.map((p) => (
            <ProfessionalCard key={p.user_id} professional={p} onOpen={setViewingHandle} />
          ))}
        </div>
      )}

      {viewingHandle && <PublicPortfolioPage handle={viewingHandle} onClose={() => setViewingHandle(null)} />}
    </div>
  );
}
