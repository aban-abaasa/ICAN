import React, { useEffect, useMemo, useState } from 'react';
import { Search, Loader, ShoppingBag, Truck, ArrowRight } from 'lucide-react';
import { getDropshipBrowseProducts } from '../services/dropshipService';
import ShopTiles, { SHOP_TONES } from './shop/ShopTiles';
import ProductOffersSheet from './shop/ProductOffersSheet';

const PAGE_SIZE = 30;
const FILTERS = [
  { id: 'all', label: 'All products' },
  { id: 'free', label: 'Free delivery', icon: Truck },
  { id: 'stock', label: 'In stock' },
];

// Ivory & gold, like the app's own "boardroom classic" theme. All colours are
// inline: index.css repaints stock Tailwind colour classes app-wide.
const C = { page: '#faf6ec', ink: '#1f2937', muted: '#8a7a55', line: '#e6dcc3', gold: '#b8862e', panel: '#fffdf8' };
const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";

// The public shop at /shop -- every product any IcanEra reseller currently
// lists, for visitors anywhere in the world. No account needed to look;
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
          <a href="/" className="text-xs font-semibold rounded px-3 py-1.5 hover:opacity-80 transition" style={{ border: `1px solid ${C.gold}`, color: C.ink }}>Open IcanEra</a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 pb-16">
        <section className="pt-8 pb-5 md:pt-12 md:pb-7 text-center">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight" style={{ fontFamily: SERIF }}>The IcanEra Shop</h1>
          <div className="mx-auto mt-3 h-px w-16" style={{ backgroundColor: C.gold }} />
          <p className="mt-3 text-sm md:text-base max-w-xl mx-auto" style={{ color: C.muted }}>
            Products from independent resellers around the world. Compare sellers, choose delivery, and check out securely — no account needed to browse.
          </p>

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
            {Array.from({ length: 10 }).map((_, i) => <div key={i} className="aspect-[3/4] rounded-lg animate-pulse" style={{ backgroundColor: SHOP_TONES.classic.imageBg }} />)}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-center text-sm py-16" style={{ color: C.muted }}>
            {products.length === 0 ? 'No products found.' : 'Nothing matches that filter yet — try "All products".'}
          </p>
        ) : (
          <ShopTiles products={visible} onSelect={setSelected} tone="classic" />
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

      {selected && <ProductOffersSheet product={selected} tone="classic" onClose={() => setSelected(null)} />}
    </div>
  );
};

export default PublicShopPage;
