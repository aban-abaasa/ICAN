import React, { useEffect, useState } from 'react';
import { X, Loader, Truck, Store } from 'lucide-react';
import { getDropshipProductOffers } from '../../services/dropshipService';
import { formatUGX } from './ShopTiles';

// Bottom sheet on phones, centred card on larger screens: the big product
// picture, then every reseller's offer (cheapest first) with a Buy button
// that hands off to that reseller's public storefront for cart + checkout.
const ProductOffersSheet = ({ product, onClose }) => {
  const [offers, setOffers] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setOffers(null);
    getDropshipProductOffers(product.product_id).then(({ data }) => { if (!cancelled) setOffers(data || []); });
    return () => { cancelled = true; };
  }, [product.product_id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label={product.name}>
      <div className="relative w-full sm:max-w-md max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-slate-900 border border-white/10 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-3 top-3 z-10 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80" aria-label="Close">
          <X className="w-4 h-4" />
        </button>

        <div className="aspect-[4/3] bg-slate-800 flex items-center justify-center overflow-hidden">
          {product.images?.[0] ? (
            <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <Store className="w-10 h-10 text-slate-600" />
          )}
        </div>

        <div className="px-4 pt-3 pb-1">
          <h3 className="text-base font-bold text-white leading-snug">{product.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            From <span className="text-indigo-300 font-bold">UGX {formatUGX(product.min_price)}</span>
            {product.brand ? ` · ${product.brand}` : ''}
          </p>
        </div>

        <div className="px-2 pb-3 pt-1">
          <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Available from</p>
          {offers === null ? (
            <div className="flex justify-center py-6"><Loader className="w-5 h-5 text-slate-500 animate-spin" /></div>
          ) : offers.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-5">No resellers available right now</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {offers.map((offer) => (
                <li key={offer.listing_id} className="flex items-center justify-between gap-3 px-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium truncate">{offer.reseller_name}</p>
                    <p className="text-[11px] text-slate-400 flex items-center gap-2">
                      UGX {formatUGX(offer.listed_price)}
                      {offer.free_delivery && <span className="flex items-center gap-0.5 text-emerald-400"><Truck className="w-3 h-3" />Free delivery</span>}
                      {!offer.in_stock && <span className="text-red-400">Out of stock</span>}
                    </p>
                  </div>
                  <a
                    href={offer.in_stock ? `/store/${offer.reseller_business_profile_id}` : undefined}
                    aria-disabled={!offer.in_stock}
                    className={`shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-bold text-white transition ${offer.in_stock ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-slate-700 opacity-50 pointer-events-none'}`}
                  >
                    Buy
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductOffersSheet;
