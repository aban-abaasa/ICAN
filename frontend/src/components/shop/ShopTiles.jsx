import React from 'react';
import { Store, Truck } from 'lucide-react';

// Whole numbers in the viewer's own locale (1,234 / 1.234 / 1 234 ...) -- not
// hard-wired to any one country. Prices are stored in UGX, so the label stays
// UGX until per-viewer currency conversion exists.
export const formatUGX = (amount) => Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

// Colours are inline (not Tailwind classes) on purpose: index.css repaints
// stock colour classes like bg-white / text-slate-900 app-wide, which turned
// these cards dark-on-dark.
export const SHOP_TONES = {
  // Ivory & gold storefront -- the public /shop page and light landing themes.
  classic: {
    card: { backgroundColor: '#fffdf8', border: '1px solid #e6dcc3' },
    imageBg: '#f1ead8',
    iconColor: '#b9a97d',
    name: '#1f2937',
    price: '#111827',
    muted: '#8a7a55',
    free: '#0f766e',
    soldBadge: { backgroundColor: '#1f2937', color: '#fffdf8' },
    hover: '#b8862e',
  },
  // For the app's dark screens and dark landing themes.
  dark: {
    card: { backgroundColor: 'rgba(15,23,42,0.7)', border: '1px solid #1e293b' },
    imageBg: '#1e293b',
    iconColor: '#64748b',
    name: '#e2e8f0',
    price: '#ffffff',
    muted: '#94a3b8',
    free: '#34d399',
    soldBadge: { backgroundColor: 'rgba(0,0,0,0.75)', color: '#ffffff' },
    hover: '#818cf8',
  },
};

// Classic storefront grid: a square product picture, then its name and price
// underneath -- the layout shoppers already know. `dense` is the compact
// variant for in-app tabs (more columns, smaller type); `columnsClass`
// overrides the responsive column counts.
const ShopTiles = ({ products, onSelect, dense = false, tone = 'classic', columnsClass }) => {
  const t = SHOP_TONES[tone] || SHOP_TONES.classic;
  return (
    <ul
      className={`grid ${
        dense
          ? 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5 md:gap-2'
          : `${columnsClass || 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'} gap-3 md:gap-5`
      }`}
    >
      {products.map((product, index) => {
        const soldOut = product.any_in_stock === false;
        return (
          <li key={product.product_id}>
            <button
              type="button"
              onClick={() => onSelect?.(product)}
              aria-label={`${product.name} — from ${formatUGX(product.min_price)} UGX`}
              className="group flex flex-col justify-start w-full h-full overflow-hidden rounded-lg text-left transition-shadow hover:shadow-lg outline-none focus-visible:ring-2"
              style={t.card}
            >
              <span className="relative block w-full aspect-square overflow-hidden shrink-0" style={{ backgroundColor: t.imageBg }}>
                {product.images?.[0] ? (
                  <img
                    src={product.images[0]}
                    alt={product.name}
                    loading={index < 6 ? 'eager' : 'lazy'}
                    decoding="async"
                    className={`absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105 ${soldOut ? 'grayscale opacity-60' : ''}`}
                  />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Store className={dense ? 'w-5 h-5' : 'w-8 h-8'} style={{ color: t.iconColor }} />
                  </span>
                )}
                {soldOut && (
                  <span className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] md:text-[10px] font-bold uppercase tracking-wide" style={t.soldBadge}>Sold out</span>
                )}
              </span>

              <span className={`block w-full flex-1 ${dense ? 'px-1.5 py-1' : 'px-2.5 py-2 md:px-3 md:py-2.5'}`}>
                <span
                  className={`block font-medium leading-snug line-clamp-2 ${dense ? 'text-[10px] min-h-[1.65rem]' : 'text-xs md:text-sm min-h-[2.1rem] md:min-h-[2.5rem]'}`}
                  style={{ color: t.name }}
                >
                  {product.name}
                </span>
                <span className="mt-0.5 flex items-baseline gap-1 flex-wrap">
                  <span className={dense ? 'text-[8px]' : 'text-[10px] md:text-[11px]'} style={{ color: t.muted }}>UGX</span>
                  <span className={`font-bold tabular-nums ${dense ? 'text-[11px]' : 'text-sm md:text-base'}`} style={{ color: t.price }}>{formatUGX(product.min_price)}</span>
                  {Number(product.reseller_count) > 1 && !dense && (
                    <span className="text-[10px]" style={{ color: t.muted }}>· {product.reseller_count} sellers</span>
                  )}
                </span>
                {product.any_free_delivery && !soldOut && (
                  <span className={`mt-0.5 flex items-center gap-1 font-semibold ${dense ? 'text-[8px]' : 'text-[10px] md:text-[11px]'}`} style={{ color: t.free }}>
                    <Truck className={dense ? 'w-2.5 h-2.5' : 'w-3 h-3'} /> Free delivery
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default ShopTiles;
