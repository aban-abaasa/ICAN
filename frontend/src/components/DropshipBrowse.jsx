import React, { useEffect, useState } from 'react';
import { Search, Loader, AlertCircle, ExternalLink } from 'lucide-react';
import { getDropshipBrowseProducts } from '../services/dropshipService';
import ShopTiles from './shop/ShopTiles';
import ProductOffersSheet from './shop/ProductOffersSheet';

// In-app Shop: lets any ICAN user -- no reseller storefront of their own
// required -- discover dropship-listed products across every reseller as a
// compact picture grid with price tags. Tapping a tile opens a sheet with
// that product's reseller offers, from which "Buy" hands off to the real
// reseller storefront (PublicDropshipStorefront) for cart + checkout.
// The same products are public at /shop for anyone (and search engines).
const DropshipBrowse = () => {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      const { data } = await getDropshipBrowseProducts({ query: query.trim(), limit: 60 });
      if (!cancelled) {
        setProducts(data);
        setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products…"
            className="w-full bg-slate-800 border border-slate-700 rounded-md pl-8 pr-3 py-1.5 text-xs md:text-sm text-white placeholder-slate-500"
          />
        </div>
        <a href="/shop" target="_blank" rel="noreferrer" title="Open the public shop" className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1.5 text-[11px] text-slate-300 hover:text-white hover:border-slate-500 shrink-0">
          <ExternalLink className="w-3 h-3" /> Public shop
        </a>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader className="w-5 h-5 text-slate-500 animate-spin" /></div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <AlertCircle className="w-6 h-6 text-slate-600" />
          <p className="text-xs text-slate-500">No products found</p>
        </div>
      ) : (
        <ShopTiles products={products} onSelect={setSelectedProduct} dense />
      )}

      {selectedProduct && <ProductOffersSheet product={selectedProduct} onClose={() => setSelectedProduct(null)} />}
    </div>
  );
};

export default DropshipBrowse;
