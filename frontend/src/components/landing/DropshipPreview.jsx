import React, { useEffect, useState } from 'react';
import { ShoppingBag, ArrowRight } from 'lucide-react';
import { useTheme, isDarkFamilyTheme } from '../../context/ThemeContext';
import { getDropshipBrowseProducts } from '../../services/dropshipService';
import ShopTiles from '../shop/ShopTiles';
import ProductOffersSheet from '../shop/ProductOffersSheet';

const SHOWCASE_SIZE = 13; // 1 hero (2x2) + 12 tiles fills a 4-column bento with no gaps

// Landing-page shop window: a picture wall of dropship-listed products with
// price tags, open to anyone with no account. Tapping a product opens its
// reseller offers; "See the whole shop" goes to the public, search-indexed
// /shop page.
const DropshipPreview = () => {
  const { actualTheme } = useTheme();
  const isDarkTheme = isDarkFamilyTheme(actualTheme);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    getDropshipBrowseProducts({ limit: SHOWCASE_SIZE })
      .then(({ data }) => setProducts(data || []))
      .catch((err) => console.error('[DropshipPreview] failed to load products:', err))
      .finally(() => setLoading(false));
  }, []);

  if (!loading && products.length === 0) return null;

  return (
    <section id="dropship-preview" className="relative py-10 md:py-16 lg:py-20 2xl:py-24 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto">
        <div className="text-center mb-6 md:mb-10">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs md:text-sm font-bold mb-4 ${isDarkTheme ? 'border-indigo-300/40 bg-indigo-900/25 text-indigo-200' : 'border-indigo-400/50 bg-indigo-100 text-indigo-800'}`}>
            <ShoppingBag className="w-4 h-4" />
            The IcanEra Shop
          </div>
          <h2 className={`text-2xl md:text-4xl font-black ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Fresh from our resellers</h2>
          <p className={`mt-2 text-sm md:text-base ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>Tap anything you like — compare resellers, then buy straight from their storefront. No account needed to look.</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={`aspect-square rounded-2xl animate-pulse ${isDarkTheme ? 'bg-slate-800/50' : 'bg-slate-200'}`} />
            ))}
          </div>
        ) : (
          <ShopTiles products={products} onSelect={setSelected} featured columnsClass="grid-cols-2 md:grid-cols-4" />
        )}

        <div className="mt-8 flex justify-center">
          <a
            href="/shop"
            className="group inline-flex items-center gap-2 rounded-full bg-indigo-600 hover:bg-indigo-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 transition"
          >
            See the whole shop
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </a>
        </div>
      </div>

      {selected && <ProductOffersSheet product={selected} onClose={() => setSelected(null)} />}
    </section>
  );
};

export default DropshipPreview;
