import React, { useEffect, useState } from 'react';
import { X, Loader, Truck, Store } from 'lucide-react';
import { getDropshipProductOffers } from '../../services/dropshipService';
import { SHOP_TONES } from './ShopTiles';
import { useIcanCoinPrice, formatIcan } from './useIcanCoinPrice';
import { formatStorePrice } from './storeCurrency';

const SHEET = {
  classic: { panel: '#fffdf8', border: '#e6dcc3', title: '#1f2937', muted: '#8a7a55', line: '#ece3cc', button: '#1f2937', buttonText: '#fffdf8', accent: '#8a6a1f', closeBg: 'rgba(255,253,248,0.9)', closeText: '#1f2937' },
  dark: { panel: '#0f172a', border: 'rgba(255,255,255,0.1)', title: '#ffffff', muted: '#94a3b8', line: 'rgba(255,255,255,0.06)', button: '#4f46e5', buttonText: '#ffffff', accent: '#a5b4fc', closeBg: 'rgba(0,0,0,0.6)', closeText: '#ffffff' },
};

// Bottom sheet on phones, centred card on larger screens: the big product
// picture, then every reseller's offer (cheapest first) with a Buy button
// that hands off to that reseller's public storefront for cart + checkout.
const ProductOffersSheet = ({ product, onClose, tone = 'dark' }) => {
  const c = SHEET[tone] || SHEET.dark;
  const tiles = SHOP_TONES[tone] || SHOP_TONES.dark;
  const [offers, setOffers] = useState(null);
  const coin = useIcanCoinPrice();
  const money = (ugx, country) => { const p = formatStorePrice(ugx, country); return `${p.currency} ${p.amount}`; };
  const icanOf = (ugx) => { const v = formatIcan(ugx, coin); return v ? <span className="font-semibold" style={{ color: tiles.coin }}> · ≈ {v} ICAN</span> : null; };

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
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center backdrop-blur-sm" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} role="dialog" aria-modal="true" aria-label={product.name}>
      <div className="relative w-full sm:max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl" style={{ backgroundColor: c.panel, border: `1px solid ${c.border}` }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-3 top-3 z-10 p-1.5 rounded-full" style={{ backgroundColor: c.closeBg, color: c.closeText }} aria-label="Close">
          <X className="w-4 h-4" />
        </button>

        <div className="aspect-[4/3] flex items-center justify-center overflow-hidden" style={{ backgroundColor: tiles.imageBg }}>
          {product.images?.[0] ? (
            <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <Store className="w-10 h-10" style={{ color: tiles.iconColor }} />
          )}
        </div>

        <div className="px-4 pt-3 pb-1">
          <h3 className="text-base font-bold leading-snug" style={{ color: c.title }}>{product.name}</h3>
          <p className="text-xs mt-0.5" style={{ color: c.muted }}>
            From <span className="font-bold" style={{ color: c.accent }}>{money(product.min_price, product.store_country)}</span>{icanOf(product.min_price)}
            {product.brand ? ` · ${product.brand}` : ''}
          </p>
        </div>

        <div className="px-2 pb-3 pt-1">
          <p className="px-2 pb-1 text-[10px] uppercase tracking-wider font-semibold" style={{ color: c.muted }}>Available from</p>
          {offers === null ? (
            <div className="flex justify-center py-6"><Loader className="w-5 h-5 animate-spin" style={{ color: c.muted }} /></div>
          ) : offers.length === 0 ? (
            <p className="text-xs text-center py-5" style={{ color: c.muted }}>No resellers available right now</p>
          ) : (
            <ul>
              {offers.map((offer) => (
                <li key={offer.listing_id} className="flex items-center justify-between gap-3 px-2 py-2" style={{ borderTop: `1px solid ${c.line}` }}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: c.title }}>{offer.reseller_name}</p>
                    <p className="text-[11px] flex items-center gap-2" style={{ color: c.muted }}>
                      <span>{money(offer.listed_price, offer.store_country || product.store_country)}{icanOf(offer.listed_price)}</span>
                      {offer.free_delivery && <span className="flex items-center gap-0.5" style={{ color: tiles.free }}><Truck className="w-3 h-3" />Free delivery</span>}
                      {!offer.in_stock && <span style={{ color: '#dc2626' }}>Out of stock</span>}
                    </p>
                  </div>
                  <a
                    href={offer.in_stock ? `/store/${offer.reseller_business_profile_id}` : undefined}
                    aria-disabled={!offer.in_stock}
                    className={`shrink-0 rounded-md px-3.5 py-1.5 text-xs font-bold transition ${offer.in_stock ? 'hover:opacity-90' : 'opacity-40 pointer-events-none'}`}
                    style={{ backgroundColor: c.button, color: c.buttonText }}
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
