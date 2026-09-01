import React, { useEffect, useState } from 'react';
import { Search, X, Loader, Store, Truck, AlertCircle } from 'lucide-react';
import { getDropshipBrowseProducts, getDropshipProductOffers } from '../services/dropshipService';

const formatUGX = (amount) => `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

// Lets any ICAN user -- no reseller storefront of their own required --
// discover dropship-listed products across every reseller: all products sit
// in a single horizontal scrolling shelf, and tapping one opens a panel
// below the shelf listing that product's individual reseller offers, from
// which "Buy" hands off to the real reseller storefront
// (PublicDropshipStorefront) for cart + checkout.
const DropshipBrowse = () => {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [offersByProduct, setOffersByProduct] = useState({});
  const [offersLoading, setOffersLoading] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      const { data } = await getDropshipBrowseProducts({ query: query.trim() });
      if (!cancelled) {
        setProducts(data);
        setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query]);

  const selectProduct = async (product) => {
    if (selectedProduct?.product_id === product.product_id) {
      setSelectedProduct(null);
      return;
    }
    setSelectedProduct(product);
    if (!offersByProduct[product.product_id]) {
      setOffersLoading(product.product_id);
      const { data } = await getDropshipProductOffers(product.product_id);
      setOffersByProduct((prev) => ({ ...prev, [product.product_id]: data }));
      setOffersLoading(null);
    }
  };

  const goToStorefront = (businessProfileId) => {
    window.location.href = `/store/${businessProfileId}`;
  };

  const selectedOffers = selectedProduct ? offersByProduct[selectedProduct.product_id] : null;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products…"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-slate-500 animate-spin" /></div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <AlertCircle className="w-8 h-8 text-slate-600" />
          <p className="text-sm text-slate-500">No products found</p>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
          {products.map((product) => {
            const isSelected = selectedProduct?.product_id === product.product_id;
            return (
              <button
                key={product.product_id}
                onClick={() => selectProduct(product)}
                className={`w-28 shrink-0 text-left rounded-xl border overflow-hidden transition ${
                  isSelected ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/60'
                }`}
              >
                <div className="w-28 h-28 bg-slate-800 overflow-hidden flex items-center justify-center">
                  {product.images?.[0] ? (
                    <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <Store className="w-6 h-6 text-slate-600" />
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs text-white font-medium line-clamp-2 min-h-[2rem]">{product.name}</p>
                  <p className="text-[11px] text-indigo-300 font-semibold mt-0.5">From {formatUGX(product.min_price)}</p>
                  <p className="text-[10px] text-slate-500">{product.reseller_count} reseller{product.reseller_count === 1 ? '' : 's'}</p>
                  {product.any_free_delivery && (
                    <p className="text-[10px] text-emerald-400 flex items-center gap-0.5 mt-0.5"><Truck className="w-2.5 h-2.5" />Free delivery</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedProduct && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800">
            <p className="text-sm text-white font-medium truncate">{selectedProduct.name}</p>
            <button onClick={() => setSelectedProduct(null)} className="p-1 text-slate-500 hover:text-white shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y divide-slate-800/70">
            {offersLoading === selectedProduct.product_id ? (
              <div className="flex justify-center py-6"><Loader className="w-5 h-5 text-slate-500 animate-spin" /></div>
            ) : (selectedOffers || []).length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No resellers available right now</p>
            ) : (
              selectedOffers.map((offer) => (
                <div key={offer.listing_id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{offer.reseller_name}</p>
                    <p className="text-xs text-slate-400 flex items-center gap-1.5">
                      {formatUGX(offer.listed_price)}
                      {offer.free_delivery && <span className="flex items-center gap-0.5 text-emerald-400"><Truck className="w-3 h-3" />Free delivery</span>}
                      {!offer.in_stock && <span className="text-red-400">Out of stock</span>}
                    </p>
                  </div>
                  <button
                    disabled={!offer.in_stock}
                    onClick={() => goToStorefront(offer.reseller_business_profile_id)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition shrink-0"
                  >
                    Buy
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DropshipBrowse;
