import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Loader2, Heart } from 'lucide-react';
import { searchChurches } from '../services/churchTitheService';

const LAST_CHURCH_KEY = 'ican_last_tithe_church';
export const loadLastChurch = () => { try { return JSON.parse(localStorage.getItem(LAST_CHURCH_KEY) || 'null'); } catch { return null; } };
export const saveLastChurch = (c) => { try { localStorage.setItem(LAST_CHURCH_KEY, JSON.stringify({ id: c.id, name: c.name, type: c.type, isChurch: c.isChurch })); } catch { /* storage unavailable */ } };

/**
 * Search the businesses registered on IcanEra (churches first) and pick one to pay.
 * Nothing is fetched until the person types or taps Browse.
 *
 * Props:
 *  - value / onChange(church|null): the chosen business ({ id, name, type, isChurch })
 *  - compact: once a business is chosen, collapse to a single "Paying to …  Change" row (used inside forms)
 */
export default function ChurchPicker({ value, onChange, compact = false }) {
  const [query, setQuery] = useState('');
  const [churchesOnly, setChurchesOnly] = useState(false); // every registered business is searchable; this narrows to churches
  const [loaded, setLoaded] = useState(false);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [lastChurch] = useState(loadLastChurch);

  // A stale response never overwrites a newer one.
  const seq = useRef(0);
  const runSearch = useCallback(async (q, churchesOnlyFlag) => {
    const mine = ++seq.current;
    setSearching(true); setSearchErr('');
    try {
      const rows = await searchChurches({ query: q, includeAll: !churchesOnlyFlag });
      if (mine === seq.current) { setResults(rows); setLoaded(true); }
    } catch (e) {
      if (mine === seq.current) setSearchErr(e.message || 'Could not load churches');
    } finally {
      if (mine === seq.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!loaded && !query.trim()) return undefined;
    const t = setTimeout(() => runSearch(query, churchesOnly), 300);
    return () => clearTimeout(t);
  }, [query, churchesOnly, loaded, runSearch]);

  if (compact && value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-400 bg-amber-500/10 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-amber-400">Paying to</p>
          <p className="text-sm font-bold text-white truncate">{value.isChurch === false ? '🏢' : '⛪'} {value.name}</p>
        </div>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-400 hover:text-white underline flex-shrink-0">Change</button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by church or business name…"
          className="w-full bg-slate-700/50 border border-purple-500/30 rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
          aria-label="Search registered businesses"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-3">
        {!loaded && (
          <button type="button" onClick={() => runSearch(query, churchesOnly)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-600/30 border border-purple-500/40 text-purple-200 hover:bg-purple-600/50">
            🔎 Browse registered businesses
          </button>
        )}
        <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
          <input type="checkbox" checked={churchesOnly} onChange={(e) => { setChurchesOnly(e.target.checked); setLoaded(true); }} />
          Churches only
        </label>
        {lastChurch && !value && (
          <button type="button" onClick={() => onChange(lastChurch)}
            className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 ml-auto">
            <Heart className="w-3 h-3 inline mr-1" />Again: {lastChurch.name}
          </button>
        )}
      </div>

      {searching && <p className="text-xs text-gray-400 mt-3 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Searching…</p>}
      {searchErr && <p className="text-xs text-rose-400 mt-3" role="alert">{searchErr}</p>}
      {loaded && !searching && !searchErr && results.length === 0 && (
        <p className="text-xs text-gray-400 mt-3">
          Nothing found{query ? ` for “${query}”` : ''}. {churchesOnly ? 'Untick “Churches only” to search every registered business, or ' : ''}Ask them to register on IcanEra.
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 max-h-72 overflow-y-auto pr-1">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onChange(c)} disabled={c.isMine}
                className={`w-full text-left rounded-lg border px-3 py-2 transition disabled:opacity-50 ${value?.id === c.id ? 'border-amber-400 bg-amber-500/10' : 'border-slate-600 bg-slate-700/40 hover:border-purple-400'}`}>
                <p className="text-sm font-semibold text-white truncate">{c.isChurch ? '⛪' : '🏢'} {c.name}</p>
                <p className="text-[11px] text-gray-400 truncate">{c.type || 'Business'}{c.country ? ` · ${c.country}` : ''}{c.isMine ? ' · yours' : ''}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
