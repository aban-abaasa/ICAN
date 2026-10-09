import React, { useEffect, useState } from 'react';
import { Search, Loader, Store, Truck, AlertCircle, ChevronRight } from 'lucide-react';
import { getDropshipResellers } from '../services/dropshipService';
import { formatStorePrice } from './shop/storeCurrency';

const money = (ugx, country) => { const p = formatStorePrice(ugx, country); return `${p.currency} ${p.amount}`; };

// Compact directory of resellers that currently have a live storefront.
// Plain list rows in small type: one column on phones, two on tablets and
// three on wide desktops so a big directory doesn't become a long scroll.
// Tapping a row opens that reseller's public storefront (/store/:id).
const DropshipResellersList = () => {
  const [query, setQuery] = useState('');
  const [resellers, setResellers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      const { data, error: err } = await getDropshipResellers({ query: query.trim() });
      if (!cancelled) {
        setResellers(data);
        setError(!!err);
        setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search resellers…"
          className="w-full bg-slate-800 border border-slate-700 rounded-md pl-8 pr-3 py-1.5 text-xs md:text-sm text-white placeholder-slate-500"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader className="w-5 h-5 text-slate-500 animate-spin" /></div>
      ) : resellers.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <AlertCircle className="w-6 h-6 text-slate-600" />
          <p className="text-xs text-slate-500">
            {error ? 'Resellers are unavailable right now' : 'No resellers available yet'}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-3 rounded-lg border border-slate-800 bg-slate-900/60 md:border-0 md:bg-transparent divide-y divide-slate-800/70 md:divide-y-0">
          {resellers.map((r) => (
            <li key={r.business_profile_id} className="md:border-b md:border-slate-800/70">
              <a
                href={`/store/${r.business_profile_id}`}
                className="flex items-center gap-2 px-2.5 py-2 hover:bg-slate-800/60 transition"
              >
                <span className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center shrink-0">
                  <Store className="w-3.5 h-3.5 text-slate-400" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs md:text-[13px] text-white font-medium truncate">{r.business_name}</span>
                  <span className="flex items-center gap-1.5 text-[10px] md:text-[11px] text-slate-400">
                    <span>{r.product_count} product{Number(r.product_count) === 1 ? '' : 's'}</span>
                    <span>·</span>
                    <span className="text-indigo-300">from {money(r.min_price, r.store_country)}</span>
                    {r.any_free_delivery && <Truck className="w-3 h-3 text-emerald-400 shrink-0" title="Free delivery" />}
                    {!r.any_in_stock && <span className="text-red-400">Out of stock</span>}
                  </span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default DropshipResellersList;
