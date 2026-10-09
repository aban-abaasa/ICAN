import React from 'react';
import { Store, Truck } from 'lucide-react';

// Inline (not Tailwind classes): the app's theme layer repaints stock colour
// classes like bg-white, which turned the tag dark-on-dark.
const TAG_STYLE = { backgroundColor: '#ffffff', color: '#0f172a' };

export const formatUGX = (amount) => Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });

// Image-first product grid: nothing but the picture and a price tag. The
// product name only appears on hover/focus (and in the alt text and the
// sheet that opens on tap), so the grid reads like a shop window.
//
// `featured` makes every 7th tile a 2x2 hero so a long grid has rhythm
// instead of being a uniform wall of squares; `dense` is the compact variant
// for in-app tabs (more columns, smaller tag); `columnsClass` overrides the
// responsive column counts (the landing showcase caps at 4 so its 13 tiles
// fill a clean bento).
const ShopTiles = ({ products, onSelect, featured = false, dense = false, columnsClass }) => (
  <ul
    className={`grid [grid-auto-flow:dense] ${
      dense
        ? 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5 md:gap-2'
        : `${columnsClass || 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'} gap-2.5 md:gap-4`
    }`}
  >
    {products.map((product, index) => {
      const hero = featured && !dense && index % 7 === 0;
      const soldOut = product.any_in_stock === false;
      return (
        <li key={product.product_id} className={hero ? 'col-span-2 row-span-2' : ''}>
          <button
            type="button"
            onClick={() => onSelect?.(product)}
            aria-label={`${product.name} — from UGX ${formatUGX(product.min_price)}`}
            className="group relative block w-full h-full aspect-square overflow-hidden rounded-xl md:rounded-2xl bg-slate-800 text-left ring-1 ring-white/10 hover:ring-indigo-400/70 focus-visible:ring-2 focus-visible:ring-indigo-400 outline-none transition"
          >
            {product.images?.[0] ? (
              <img
                src={product.images[0]}
                alt={product.name}
                loading={index < 6 ? 'eager' : 'lazy'}
                decoding="async"
                className={`absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-110 ${soldOut ? 'grayscale opacity-60' : ''}`}
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900">
                <Store className={dense ? 'w-5 h-5 text-slate-500' : 'w-8 h-8 text-slate-500'} />
              </span>
            )}

            <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 via-black/25 to-transparent pointer-events-none" />

            {/* Name slides up on hover/focus (desktop); touch users tap through to the sheet. */}
            <span className="absolute inset-x-0 bottom-7 md:bottom-9 px-2 md:px-3 text-[11px] md:text-xs font-semibold text-white line-clamp-2 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 transition duration-300 pointer-events-none hidden md:block">
              {product.name}
            </span>

            {/* The price tag: a white pill with a punched hole, like a swing tag. */}
            <span className={`absolute left-1.5 bottom-1.5 md:left-2.5 md:bottom-2.5 inline-flex items-center gap-1 rounded-full shadow-lg shadow-black/40 -rotate-2 group-hover:rotate-0 transition ${dense ? 'pl-1.5 pr-2 py-0.5' : 'pl-2 pr-2.5 py-0.5 md:py-1'}`} style={TAG_STYLE}>
              <span className={`rounded-full shrink-0 ${dense ? 'w-1 h-1' : 'w-1.5 h-1.5'}`} style={{ backgroundColor: '#cbd5e1' }} />
              <span className={`font-black leading-none tabular-nums ${dense ? 'text-[10px]' : 'text-[11px] md:text-sm'}`}>
                <span className="font-semibold mr-0.5 text-[8px] md:text-[9px]" style={{ color: '#64748b' }}>UGX</span>
                {formatUGX(product.min_price)}
              </span>
            </span>

            {product.any_free_delivery && !soldOut && (
              <span className="absolute right-1.5 top-1.5 md:right-2.5 md:top-2.5 inline-flex items-center justify-center w-5 h-5 md:w-6 md:h-6 rounded-full bg-emerald-500 text-white shadow" title="Free delivery">
                <Truck className="w-3 h-3 md:w-3.5 md:h-3.5" />
              </span>
            )}
            {soldOut && (
              <span className="absolute right-1.5 top-1.5 md:right-2.5 md:top-2.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] md:text-[10px] font-bold uppercase tracking-wide text-white">Sold out</span>
            )}
          </button>
        </li>
      );
    })}
  </ul>
);

export default ShopTiles;
