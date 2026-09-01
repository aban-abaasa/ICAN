import React, { useEffect, useState } from 'react';
import { Search, ChevronDown, ChevronUp, Loader, Store, Truck, AlertCircle } from 'lucide-react';
import { getDropshipBrowseProducts, getDropshipProductOffers } from '../services/dropshipService';

const formatUGX = (amount) => `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

// Lets any ICAN user -- no reseller storefront of their own required --
// discover dropship-listed products across every reseller. One row per
// product; clicking a row expands it to that product's individual reseller
// offers, from which "Buy" hands off to the real reseller storefront
// (PublicDropshipStorefront) for cart + checkout.
const DropshipBrowse = () => {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
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

  const toggleExpand = async (productId) => {
    if (expandedId === productId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(productId);
    if (!offersByProduct[productId]) {
      setOffersLoading(productId);
      const { data } = await getDropshipProductOffers(productId);
      setOffersByProduct((prev) => ({ ...prev, [productId]: data }));
      setOffersLoading(null);
    }
  };

  const goToStorefront = (businessProfileId) => {
    window.location.href = `/store/${businessProfileId}`;
  };

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
        <div className="space-y-2">
          {products.map((product) => {
            const isExpanded = expandedId === product.product_id;
            const offers = offersByProduct[product.product_id];
            return (
              <div key={product.product_id} className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                <button
                  onClick={() => toggleExpand(product.product_id)}
                  className="w-full flex items-center gap-3 p-3 text-left"
                >
                  <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden flex items-center justify-center shrink-0">
                    {product.images?.[0] ? (
                      <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
                    ) : (
                      <Store className="w-5 h-5 text-slate-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white font-medium truncate">{product.name}</p>
                    <p className="text-xs text-slate-400">
                      From {formatUGX(product.min_price)} · {product.reseller_count} reseller{product.reseller_count === 1 ? '' : 's'}
                      {product.any_free_delivery && <span className="text-emerald-400"> · Free delivery available</span>}
                    </p>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-800 divide-y divide-slate-800/70">
                    {offersLoading === product.product_id ? (
                      <div className="flex justify-center py-6"><Loader className="w-5 h-5 text-slate-500 animate-spin" /></div>
                    ) : (offers || []).length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-4">No resellers available right now</p>
                    ) : (
                      offers.map((offer) => (
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DropshipBrowse;
