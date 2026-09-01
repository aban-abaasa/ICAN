import React, { useEffect, useState } from 'react';
import { ShoppingBag, Truck, Store, X, Loader } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { getDropshipBrowseProducts, getDropshipProductOffers } from '../../services/dropshipService';

const formatUGX = (amount) => `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

// Landing-page shelf of dropship-listed products, browsable by anyone with no
// account required. Tapping a product expands its individual reseller offers
// inline; "Buy" hands off straight to that reseller's public storefront
// (/store/:businessProfileId, handled in main.jsx) for cart + checkout —
// same posture as DropshipBrowse.jsx inside the authenticated app.
const DropshipPreview = () => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [offersByProduct, setOffersByProduct] = useState({});
  const [offersLoading, setOffersLoading] = useState(null);
  const PAGE_SIZE = 8;

  useEffect(() => {
    getDropshipBrowseProducts({ limit: PAGE_SIZE })
      .then(({ data }) => {
        setProducts(data || []);
        setHasMore((data || []).length >= PAGE_SIZE);
      })
      .catch((err) => console.error('[DropshipPreview] failed to load products:', err))
      .finally(() => setLoading(false));
  }, []);

  const handleLoadMore = () => {
    setLoadingMore(true);
    getDropshipBrowseProducts({ limit: PAGE_SIZE, offset: products.length })
      .then(({ data }) => {
        setProducts((prev) => [...prev, ...(data || [])]);
        setHasMore((data || []).length >= PAGE_SIZE);
      })
      .catch((err) => console.error('[DropshipPreview] failed to load more products:', err))
      .finally(() => setLoadingMore(false));
  };

  const selectProduct = async (product) => {
    if (selectedProduct?.product_id === product.product_id) {
      setSelectedProduct(null);
      return;
    }
    setSelectedProduct(product);
    if (!offersByProduct[product.product_id]) {
      setOffersLoading(product.product_id);
      const { data } = await getDropshipProductOffers(product.product_id);
      setOffersByProduct((prev) => ({ ...prev, [product.product_id]: data || [] }));
      setOffersLoading(null);
    }
  };

  const goToStorefront = (businessProfileId) => {
    window.location.href = `/store/${businessProfileId}`;
  };

  const selectedOffers = selectedProduct ? offersByProduct[selectedProduct.product_id] : null;

  if (!loading && products.length === 0) return null;

  return (
    <section id="dropship-preview" className="relative py-10 md:py-16 lg:py-20 2xl:py-24 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto">
        <div className="text-center mb-8 md:mb-12">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs md:text-sm font-bold mb-4 ${isDarkTheme ? 'border-indigo-300/40 bg-indigo-900/25 text-indigo-200' : 'border-indigo-400/50 bg-indigo-100 text-indigo-800'}`}>
            <ShoppingBag className="w-4 h-4" />
            Marketplace
          </div>
          <h2 className={`text-2xl md:text-4xl font-black ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Shop Products Resellers Are Offering</h2>
          <p className={`mt-2 text-sm md:text-base ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>Browse dropship-listed products from IcanEra resellers — no account needed to look, buy straight from their storefront.</p>
        </div>

        {loading ? (
          <div className="grid gap-5 grid-cols-2 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-56 rounded-2xl border animate-pulse ${isDarkTheme ? 'border-slate-700/40 bg-slate-800/40' : 'border-slate-200 bg-slate-100'}`} />
            ))}
          </div>
        ) : (
          <div className="grid gap-5 grid-cols-2 md:grid-cols-4">
            {products.map((product) => {
              const isSelected = selectedProduct?.product_id === product.product_id;
              return (
                <button
                  key={product.product_id}
                  onClick={() => selectProduct(product)}
                  className={`flex flex-col text-left rounded-2xl border overflow-hidden transition ${
                    isSelected
                      ? (isDarkTheme ? 'border-indigo-400 bg-indigo-500/10' : 'border-indigo-500 bg-indigo-50')
                      : (isDarkTheme ? 'border-slate-700/40 bg-slate-900/60' : 'border-slate-200 bg-white')
                  }`}
                >
                  <div className={`aspect-square flex items-center justify-center overflow-hidden ${isDarkTheme ? 'bg-slate-800' : 'bg-slate-100'}`}>
                    {product.images?.[0] ? (
                      <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
                    ) : (
                      <Store className={`w-8 h-8 ${isDarkTheme ? 'text-slate-600' : 'text-slate-400'}`} />
                    )}
                  </div>
                  <div className="flex flex-col flex-1 p-3">
                    <p className={`text-sm font-bold line-clamp-2 min-h-[2.5rem] ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{product.name}</p>
                    <p className={`mt-1 text-sm font-bold ${isDarkTheme ? 'text-indigo-300' : 'text-indigo-700'}`}>From {formatUGX(product.min_price)}</p>
                    <p className={`text-[11px] ${isDarkTheme ? 'text-slate-500' : 'text-slate-500'}`}>
                      {product.reseller_count} reseller{Number(product.reseller_count) === 1 ? '' : 's'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {product.any_free_delivery && (
                        <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isDarkTheme ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>
                          <Truck className="w-2.5 h-2.5" />Free delivery
                        </span>
                      )}
                      {!product.any_in_stock && (
                        <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isDarkTheme ? 'bg-red-400/10 text-red-300' : 'bg-red-100 text-red-700'}`}>
                          Out of stock
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!loading && hasMore && products.length > 0 && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className={`rounded-xl border px-5 py-2.5 text-sm font-bold transition disabled:opacity-50 ${isDarkTheme ? 'border-slate-600/40 bg-white/5 text-slate-200 hover:bg-white/10' : 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}

        {selectedProduct && (
          <div className={`mt-6 rounded-2xl border overflow-hidden ${isDarkTheme ? 'border-slate-700/40 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
            <div className={`flex items-center justify-between px-4 py-3 border-b ${isDarkTheme ? 'border-slate-700/40' : 'border-slate-200'}`}>
              <p className={`text-sm font-bold truncate ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{selectedProduct.name} — offers</p>
              <button onClick={() => setSelectedProduct(null)} className={`p-1 shrink-0 ${isDarkTheme ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-900'}`}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className={`divide-y ${isDarkTheme ? 'divide-slate-800/70' : 'divide-slate-100'}`}>
              {offersLoading === selectedProduct.product_id ? (
                <div className="flex justify-center py-8"><Loader className={`w-5 h-5 animate-spin ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`} /></div>
              ) : (selectedOffers || []).length === 0 ? (
                <p className={`text-sm text-center py-6 ${isDarkTheme ? 'text-slate-500' : 'text-slate-500'}`}>No resellers available right now</p>
              ) : (
                selectedOffers.map((offer) => (
                  <div key={offer.listing_id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{offer.reseller_name}</p>
                      <p className={`text-xs flex items-center gap-2 mt-0.5 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                        {formatUGX(offer.listed_price)}
                        {offer.free_delivery && <span className="flex items-center gap-0.5 text-emerald-500"><Truck className="w-3 h-3" />Free delivery</span>}
                        {!offer.in_stock && <span className="text-red-500">Out of stock</span>}
                      </p>
                    </div>
                    <button
                      disabled={!offer.in_stock}
                      onClick={() => goToStorefront(offer.reseller_business_profile_id)}
                      className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-3.5 py-2 text-xs font-bold text-white transition-colors"
                    >
                      Buy Now
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default DropshipPreview;
