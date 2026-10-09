import React, { useEffect, useState } from 'react';
import { Search, ChevronDown, Loader, Store, Truck, AlertCircle } from 'lucide-react';
import { getDropshipBrowseProducts, getDropshipProductOffers } from '../services/dropshipService';

const formatUGX = (amount) => `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

// Lets any ICAN user -- no reseller storefront of their own required --
// discover dropship-listed products across every reseller: products are a
// compact small-type list, and tapping a row expands that product's
// individual reseller offers inline, from which "Buy" hands off to the real reseller storefront
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

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products…"
          className="w-full bg-slate-800 border border-slate-700 rounded-md pl-8 pr-3 py-1.5 text-xs md:text-sm text-white placeholder-slate-500"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader className="w-5 h-5 text-slate-500 animate-spin" /></div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <AlertCircle className="w-6 h-6 text-slate-600" />
          <p className="text-xs text-slate-500">No products found</p>
        </div>
      ) : (
        <ul className="rounded-lg border border-slate-800 bg-slate-900/60 divide-y divide-slate-800/70 overflow-hidden">
          {products.map((product) => {
            const isSelected = selectedProduct?.product_id === product.product_id;
            const offers = offersByProduct[product.product_id];
            return (
              <li key={product.product_id} className={isSelected ? 'bg-indigo-500/10' : ''}>
                <button
                  onClick={() => selectProduct(product)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 md:py-2 text-left hover:bg-slate-800/60 transition"
                >
                  <span className="w-8 h-8 md:w-9 md:h-9 rounded bg-slate-800 overflow-hidden flex items-center justify-center shrink-0">
                    {product.images?.[0] ? (
                      <img src={product.images[0]} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <Store className="w-3.5 h-3.5 text-slate-600" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs md:text-[13px] text-white font-medium truncate">{product.name}</span>
                    <span className="flex items-center gap-1.5 text-[10px] md:text-[11px] text-slate-400">
                      <span className="text-indigo-300 font-semibold">From {formatUGX(product.min_price)}</span>
                      <span>·</span>
                      <span>{product.reseller_count} reseller{Number(product.reseller_count) === 1 ? '' : 's'}</span>
                      {product.any_free_delivery && <Truck className="w-3 h-3 text-emerald-400 shrink-0" title="Free delivery" />}
                    </span>
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                </button>

                {isSelected && (
                  <div className="border-t border-slate-800/70 bg-slate-950/40 divide-y divide-slate-800/60">
                    {offersLoading === product.product_id ? (
                      <div className="flex justify-center py-3"><Loader className="w-4 h-4 text-slate-500 animate-spin" /></div>
                    ) : (offers || []).length === 0 ? (
                      <p className="text-[11px] text-slate-500 text-center py-3">No resellers available right now</p>
                    ) : (
                      offers.map((offer) => (
                        <div key={offer.listing_id} className="flex items-center justify-between gap-2 pl-[3.25rem] pr-2.5 py-1.5">
                          <div className="min-w-0">
                            <p className="text-xs text-white truncate">{offer.reseller_name}</p>
                            <p className="text-[10px] md:text-[11px] text-slate-400 flex items-center gap-1.5">
                              {formatUGX(offer.listed_price)}
                              {offer.free_delivery && <span className="flex items-center gap-0.5 text-emerald-400"><Truck className="w-3 h-3" />Free delivery</span>}
                              {!offer.in_stock && <span className="text-red-400">Out of stock</span>}
                            </p>
                          </div>
                          <button
                            disabled={!offer.in_stock}
                            onClick={() => goToStorefront(offer.reseller_business_profile_id)}
                            className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-semibold transition shrink-0"
                          >
                            Buy
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default DropshipBrowse;
