import React, { useEffect, useMemo, useState } from 'react';
import { Search, Loader, ShoppingBag, Truck, ArrowRight, Sparkles } from 'lucide-react';
import { getDropshipBrowseProducts } from '../services/dropshipService';
import ShopTiles from './shop/ShopTiles';
import ProductOffersSheet from './shop/ProductOffersSheet';

const PAGE_SIZE = 30;
const FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'free', label: 'Free delivery', icon: Truck },
  { id: 'stock', label: 'In stock' },
];

// The public shop at /shop -- every product any IcanEra reseller currently
// lists, shown as a picture wall with price tags. No account needed to look;
// tapping a product opens its reseller offers and "Buy" goes to that
// reseller's storefront (/store/:id). Server-side, /api/share-preview?type=shop
// wraps this same page in crawlable title/description/JSON-LD so it can be
// found through search.
//
// Self-contained palette (not the app ThemeProvider), like the other public
// share pages, so it always looks the same to a visitor.
const PublicShopPage = () => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    document.title = 'Shop — Products from IcanEra Resellers | IcanEra';
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      const { data } = await getDropshipBrowseProducts({ query: query.trim(), limit: PAGE_SIZE });
      if (cancelled) return;
      setProducts(data);
      setHasMore(data.length >= PAGE_SIZE);
      setLoading(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query]);

  const loadMore = async () => {
    setLoadingMore(true);
    const { data } = await getDropshipBrowseProducts({ query: query.trim(), limit: PAGE_SIZE, offset: products.length });
    setProducts((prev) => [...prev, ...data]);
    setHasMore(data.length >= PAGE_SIZE);
    setLoadingMore(false);
  };

  const visible = useMemo(() => products.filter((p) => (
    filter === 'free' ? p.any_free_delivery : filter === 'stock' ? p.any_in_stock : true
  )), [products, filter]);

  return (
    <div className="min-h-screen bg-slate-950 text-white" style={{ backgroundImage: 'radial-gradient(1200px 500px at 15% -10%, rgba(99,102,241,0.28), transparent), radial-gradient(900px 400px at 95% 0%, rgba(236,72,153,0.18), transparent)' }}>
      <header className="sticky top-0 z-30 backdrop-blur bg-slate-950/80 border-b border-white/10">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 px-4 py-2.5">
          <a href="/" className="flex items-center gap-2 font-black tracking-tight">
            <span className="inline-flex w-7 h-7 items-center justify-center rounded-lg bg-indigo-600"><ShoppingBag className="w-4 h-4" /></span>
            IcanEra <span className="text-slate-400 font-semibold">Shop</span>
          </a>
          <a href="/" className="text-xs font-semibold rounded-full border border-white/20 px-3 py-1.5 hover:bg-white/10 transition">Open IcanEra</a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 pb-16">
        <section className="pt-8 pb-5 md:pt-12 md:pb-8 text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300/30 bg-indigo-500/10 px-3 py-1 text-[11px] md:text-xs font-bold text-indigo-200">
            <Sparkles className="w-3.5 h-3.5" /> Fresh from IcanEra resellers
          </p>
          <h1 className="mt-3 text-3xl md:text-5xl font-black tracking-tight">
            Find it. Tap it. <span className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-amber-200 bg-clip-text text-transparent">Get it delivered.</span>
          </h1>
          <p className="mt-3 text-sm md:text-base text-slate-400 max-w-xl mx-auto">
            Every product listed by resellers across Uganda, in one place. Compare prices, pick a reseller, check out with IcanEra — no account needed to browse.
          </p>

          <div className="mt-5 max-w-lg mx-auto relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, brands…"
              aria-label="Search products"
              className="w-full rounded-full bg-slate-900/80 border border-white/15 pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
            />
          </div>

          <div className="mt-3 flex items-center justify-center gap-1.5 flex-wrap">
            {FILTERS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] md:text-xs font-semibold transition ${filter === id ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-white/15 text-slate-400 hover:text-white'}`}
              >
                {Icon && <Icon className="w-3 h-3" />}{label}
              </button>
            ))}
          </div>
        </section>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 md:gap-4">
            {Array.from({ length: 10 }).map((_, i) => <div key={i} className="aspect-square rounded-2xl bg-slate-800/60 animate-pulse" />)}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-16">
            {products.length === 0 ? 'No products found.' : 'Nothing matches that filter yet — try "Everything".'}
          </p>
        ) : (
          <ShopTiles products={visible} onSelect={setSelected} featured />
        )}

        {!loading && hasMore && (
          <div className="flex justify-center mt-8">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded-full bg-white text-slate-900 px-6 py-2.5 text-sm font-bold hover:bg-indigo-100 disabled:opacity-60 transition"
            >
              {loadingMore ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Show more
            </button>
          </div>
        )}

        <section className="mt-14 rounded-3xl border border-white/10 bg-gradient-to-r from-indigo-600/20 to-fuchsia-600/20 p-6 md:p-8 text-center">
          <h2 className="text-lg md:text-2xl font-black">Want your own shop window?</h2>
          <p className="mt-1 text-sm text-slate-300">Resell any store's products at your own price on IcanEra — free to start.</p>
          <a href="/" className="mt-4 inline-flex items-center gap-2 rounded-full bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-sm font-bold transition">
            Start reselling <ArrowRight className="w-4 h-4" />
          </a>
        </section>
      </main>

      {selected && <ProductOffersSheet product={selected} onClose={() => setSelected(null)} />}
    </div>
  );
};

export default PublicShopPage;
