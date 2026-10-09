import React, { useEffect, useMemo, useState } from 'react';
import { Search, Loader, ShoppingBag, Truck, ArrowRight, Moon, Sun } from 'lucide-react';
import { getDropshipBrowseProducts } from '../services/dropshipService';
import ShopTiles from './shop/ShopTiles';
import ProductOffersSheet from './shop/ProductOffersSheet';
import { useIcanCoinPrice } from './shop/useIcanCoinPrice';

const PAGE_SIZE = 30;
const FILTERS = [
  { id: 'all', label: 'All products' },
  { id: 'free', label: 'Free delivery', icon: Truck },
  { id: 'stock', label: 'In stock' },
];

// Ivory & gold, like the app's own "boardroom classic" theme. All colours are
// inline: index.css repaints stock Tailwind colour classes app-wide.
const PALETTES = {
  classic: { page: '#faf6ec', ink: '#1f2937', muted: '#8a7a55', line: '#e6dcc3', gold: '#b8862e', panel: '#fffdf8', skeleton: '#f1ead8', up: '#15803d', down: '#b91c1c' },
  dark: { page: '#0b1120', ink: '#e2e8f0', muted: '#94a3b8', line: '#1e293b', gold: '#d9a441', panel: '#0f172a', skeleton: '#1e293b', up: '#34d399', down: '#f87171' },
};
const THEME_KEY = 'icanera-shop-theme';

// Saved choice first, then the visitor's device setting.
const initialTheme = () => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'classic') return saved;
  } catch { /* storage blocked */ }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'classic';
};
const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";

// The public shop at /shop -- every product any IcanEra reseller currently
// lists, for visitors anywhere in the world. No account needed to look;
// tapping a product opens its reseller offers and "Buy" goes to that
// reseller's storefront (/store/:id). Server-side, /api/share-preview?type=shop
// wraps this same page in crawlable title/description/JSON-LD so it can be
// found through search.
//
// Self-contained palettes (not the app ThemeProvider), like the other public
// share pages. Visitors can switch between light and dark; the choice is kept.
const PublicShopPage = () => {
  const [theme, setTheme] = useState(initialTheme);
  const C = PALETTES[theme];
  const toggleTheme = () => setTheme((prev) => {
    const next = prev === 'dark' ? 'classic' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked */ }
    return next;
  });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState(null);
  const coin = useIcanCoinPrice();

  useEffect(() => {
    document.title = 'Shop — Products from Resellers Worldwide | IcanEra';
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
    <div className="min-h-screen" style={{ backgroundColor: C.page, color: C.ink }}>
      <header style={{ backgroundColor: C.panel, borderBottom: `1px solid ${C.line}` }} className="sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 px-4 py-3">
          <a href="/" className="flex items-center gap-2" style={{ fontFamily: SERIF, color: C.ink }}>
            <ShoppingBag className="w-5 h-5" style={{ color: C.gold }} />
            <span className="text-lg font-bold tracking-tight">IcanEra</span>
            <span className="text-sm italic" style={{ color: C.muted }}>Shop</span>
          </a>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              className="inline-flex items-center justify-center w-8 h-8 rounded hover:opacity-80 transition"
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <a href="/" className="text-xs font-semibold rounded px-3 py-1.5 hover:opacity-80 transition" style={{ border: `1px solid ${C.gold}`, color: C.ink }}>Open IcanEra</a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 pb-16">
        <section className="pt-8 pb-5 md:pt-12 md:pb-7 text-center">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight" style={{ fontFamily: SERIF }}>The IcanEra Shop</h1>
          <div className="mx-auto mt-3 h-px w-16" style={{ backgroundColor: C.gold }} />
          <p className="mt-3 text-sm md:text-base max-w-xl mx-auto" style={{ color: C.muted }}>
            Skip the traffic and the queues. Shop from the comfort of your home — great finds from trusted sellers, delivered right to your door.
          </p>

          {coin && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] md:text-xs font-semibold tabular-nums" style={{ border: `1px solid ${C.line}`, backgroundColor: C.panel, color: C.ink }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#16a34a' }} />
              1 ICAN = UGX {Math.round(coin.priceUGX).toLocaleString()}
              <span style={{ color: coin.change24h >= 0 ? C.up : C.down }}>{coin.change24h >= 0 ? '▲' : '▼'} {Math.abs(coin.change24h).toFixed(2)}%</span>
              <span style={{ color: C.muted }}>live</span>
            </p>
          )}

          <div className="mt-5 max-w-lg mx-auto relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.muted }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products or brands"
              aria-label="Search products"
              className="w-full rounded-md pl-10 pr-4 py-2.5 text-sm focus:outline-none"
              style={{ backgroundColor: C.panel, border: `1px solid ${C.line}`, color: C.ink }}
            />
          </div>

          <div className="mt-3 flex items-center justify-center gap-1.5 flex-wrap">
            {FILTERS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className="inline-flex items-center gap-1 rounded px-3 py-1 text-[11px] md:text-xs font-semibold transition"
                style={filter === id
                  ? { backgroundColor: C.ink, color: C.panel, border: `1px solid ${C.ink}` }
                  : { backgroundColor: 'transparent', color: C.ink, border: `1px solid ${C.line}` }}
              >
                {Icon && <Icon className="w-3 h-3" />}{label}
              </button>
            ))}
          </div>
        </section>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-5">
            {Array.from({ length: 10 }).map((_, i) => <div key={i} className="aspect-[3/4] rounded-lg animate-pulse" style={{ backgroundColor: C.skeleton }} />)}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-center text-sm py-16" style={{ color: C.muted }}>
            {products.length === 0 ? 'No products found.' : 'Nothing matches that filter yet — try "All products".'}
          </p>
        ) : (
          <ShopTiles products={visible} onSelect={setSelected} tone={theme} />
        )}

        {!loading && hasMore && (
          <div className="flex justify-center mt-8">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded px-6 py-2.5 text-sm font-semibold disabled:opacity-60 hover:opacity-90 transition"
              style={{ backgroundColor: C.ink, color: C.panel }}
            >
              {loadingMore ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Show more
            </button>
          </div>
        )}

        <section className="mt-14 rounded-lg p-6 md:p-8 text-center" style={{ backgroundColor: C.panel, border: `1px solid ${C.line}` }}>
          <h2 className="text-lg md:text-2xl font-bold" style={{ fontFamily: SERIF }}>Have something to sell?</h2>
          <p className="mt-1 text-sm" style={{ color: C.muted }}>Resell any store's products at your own price on IcanEra — free to start.</p>
          <a href="/" className="mt-4 inline-flex items-center gap-2 rounded px-5 py-2 text-sm font-semibold hover:opacity-90 transition" style={{ backgroundColor: C.gold, color: '#ffffff' }}>
            Start reselling <ArrowRight className="w-4 h-4" />
          </a>
        </section>
      </main>

      {selected && <ProductOffersSheet product={selected} tone={theme} onClose={() => setSelected(null)} />}
    </div>
  );
};

export default PublicShopPage;
