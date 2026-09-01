import React, { useEffect, useState, useCallback } from 'react';
import { Search, Copy, Check, Loader, Store, TrendingUp, Package, ExternalLink, ClipboardList, Truck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getDropshippableProducts, setDropshipListing, getResellerDropshipSales, getDropshipStorefront } from '../services/dropshipService';

const formatUGX = (amount) => `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
const suggestPrice = (sellingPrice) => Math.ceil((Number(sellingPrice) || 0) * 1.15 / 100) * 100;

// The reseller side of dropshipping: pick any product from any store, set
// your own price (must be >= the store's price), and share your storefront
// link. Stands alone with just a business_profiles id — plug this in
// wherever a "Dropshipping" business profile is managed (e.g. as a new tab
// keyed off business_profile_modules.module_key = 'dropship').
const DropshipResellerDashboard = ({ businessProfileId }) => {
  const [businessName, setBusinessName] = useState('');
  const [tab, setTab] = useState('browse');
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [priceDrafts, setPriceDrafts] = useState({});
  const [freeDeliveryDrafts, setFreeDeliveryDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [sales, setSales] = useState([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [myListings, setMyListings] = useState([]);
  const [loadingMyListings, setLoadingMyListings] = useState(false);
  const [copied, setCopied] = useState(false);

  const storefrontUrl = `${window.location.origin}/store/${businessProfileId}`;

  useEffect(() => {
    let cancelled = false;
    supabase.from('business_profiles').select('business_name').eq('id', businessProfileId).single()
      .then(({ data }) => { if (!cancelled) setBusinessName(data?.business_name || ''); });
    return () => { cancelled = true; };
  }, [businessProfileId]);

  const loadProducts = useCallback(async (searchQuery) => {
    setLoadingProducts(true);
    const { data } = await getDropshippableProducts(businessProfileId, { query: searchQuery });
    setProducts(data);
    setLoadingProducts(false);
  }, [businessProfileId]);

  useEffect(() => {
    if (tab !== 'browse') return;
    const t = setTimeout(() => loadProducts(query), 300);
    return () => clearTimeout(t);
  }, [tab, query, loadProducts]);

  useEffect(() => {
    if (tab !== 'sales') return;
    setLoadingSales(true);
    getResellerDropshipSales(businessProfileId).then(({ data }) => { setSales(data); setLoadingSales(false); });
  }, [tab, businessProfileId]);

  const loadMyListings = useCallback(async () => {
    setLoadingMyListings(true);
    const { data } = await getDropshipStorefront(businessProfileId);
    setMyListings(data);
    setLoadingMyListings(false);
  }, [businessProfileId]);

  useEffect(() => {
    if (tab !== 'listings') return;
    loadMyListings();
  }, [tab, loadMyListings]);

  const handleList = async (product) => {
    const draft = priceDrafts[product.product_id];
    const price = Number(draft ?? product.listed_price ?? suggestPrice(product.selling_price));
    if (!price || price < product.selling_price) return;
    const freeDelivery = freeDeliveryDrafts[product.product_id] ?? product.free_delivery ?? false;
    setSavingId(product.product_id);
    const { error } = await setDropshipListing(businessProfileId, product.product_id, price, true, freeDelivery);
    if (!error) loadProducts(query);
    setSavingId(null);
  };

  const handleUnlist = async (product) => {
    setSavingId(product.product_id);
    const { error } = await setDropshipListing(businessProfileId, product.product_id, product.listed_price, false, product.free_delivery);
    if (!error) loadProducts(query);
    setSavingId(null);
  };

  const handleUpdateMyListing = async (item) => {
    const draft = priceDrafts[item.product_id];
    const price = Number(draft ?? item.listed_price);
    if (!price) return;
    const freeDelivery = freeDeliveryDrafts[item.product_id] ?? item.free_delivery ?? false;
    setSavingId(item.product_id);
    const { error } = await setDropshipListing(businessProfileId, item.product_id, price, true, freeDelivery);
    if (!error) loadMyListings();
    setSavingId(null);
  };

  const handleUnlistMyListing = async (item) => {
    setSavingId(item.product_id);
    const { error } = await setDropshipListing(businessProfileId, item.product_id, item.listed_price, false, item.free_delivery);
    if (!error) loadMyListings();
    setSavingId(null);
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(storefrontUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-indigo-400/30 bg-indigo-500/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-indigo-300 font-semibold">Your storefront</p>
          <p className="text-white font-medium truncate">{businessName || 'Dropshipping business'}</p>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <code className="text-xs text-indigo-200 bg-black/30 rounded-lg px-2.5 py-1.5 truncate max-w-[220px]">{storefrontUrl}</code>
          <button onClick={copyLink} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white shrink-0" title="Copy link">
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
          <a href={storefrontUrl} target="_blank" rel="noreferrer" className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white shrink-0" title="Open storefront">
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-800">
        <button onClick={() => setTab('browse')} className={`px-3 py-2 text-sm font-medium border-b-2 transition ${tab === 'browse' ? 'border-indigo-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
          <Package className="w-4 h-4 inline mr-1.5 -mt-0.5" />Browse products
        </button>
        <button onClick={() => setTab('listings')} className={`px-3 py-2 text-sm font-medium border-b-2 transition ${tab === 'listings' ? 'border-indigo-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
          <ClipboardList className="w-4 h-4 inline mr-1.5 -mt-0.5" />My listings
        </button>
        <button onClick={() => setTab('sales')} className={`px-3 py-2 text-sm font-medium border-b-2 transition ${tab === 'sales' ? 'border-indigo-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
          <TrendingUp className="w-4 h-4 inline mr-1.5 -mt-0.5" />Your sales
        </button>
      </div>

      {tab === 'browse' && (
        <div>
          <div className="relative mb-3">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products across every store..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500"
            />
          </div>

          {loadingProducts ? (
            <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-slate-500 animate-spin" /></div>
          ) : products.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">No dropshippable products found.</p>
          ) : (
            <div className="space-y-2">
              {products.map((product) => {
                const draftValue = priceDrafts[product.product_id] ?? (product.already_listed ? product.listed_price : suggestPrice(product.selling_price));
                const invalid = Number(draftValue) < Number(product.selling_price);
                return (
                  <div key={product.product_id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                      {product.images?.[0] ? <img src={product.images[0]} alt="" className="w-full h-full object-cover" /> : <Store className="w-5 h-5 text-slate-600" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{product.name}</p>
                      <p className="text-xs text-slate-500 truncate">{product.supermarket_name} · store price {formatUGX(product.selling_price)} · stock {product.available_stock}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer" title="Free delivery">
                        <input
                          type="checkbox"
                          checked={freeDeliveryDrafts[product.product_id] ?? product.free_delivery ?? false}
                          onChange={(e) => setFreeDeliveryDrafts((prev) => ({ ...prev, [product.product_id]: e.target.checked }))}
                          className="accent-indigo-500"
                        />
                        <Truck className="w-3.5 h-3.5" />
                      </label>
                      <input
                        type="number"
                        min={product.selling_price}
                        value={draftValue}
                        onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [product.product_id]: e.target.value }))}
                        className={`w-24 bg-slate-800 border rounded-lg px-2 py-1.5 text-sm text-white ${invalid ? 'border-red-500' : 'border-slate-700'}`}
                      />
                      {product.already_listed ? (
                        <button onClick={() => handleUnlist(product)} disabled={savingId === product.product_id} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition">
                          Unlist
                        </button>
                      ) : null}
                      <button
                        onClick={() => handleList(product)}
                        disabled={invalid || savingId === product.product_id}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold transition"
                      >
                        {product.already_listed ? 'Update' : 'List'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'listings' && (
        <div>
          {loadingMyListings ? (
            <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-slate-500 animate-spin" /></div>
          ) : myListings.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">You haven't listed any products yet. List one from "Browse products".</p>
          ) : (
            <div className="space-y-2">
              {myListings.map((item) => {
                const draftValue = priceDrafts[item.product_id] ?? item.listed_price;
                return (
                  <div key={item.listing_id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                      {item.images?.[0] ? <img src={item.images[0]} alt="" className="w-full h-full object-cover" /> : <Store className="w-5 h-5 text-slate-600" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{item.name}</p>
                      <p className="text-xs text-slate-500 truncate">{item.in_stock ? `In stock · ${item.available_stock}` : 'Out of stock'}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer" title="Free delivery">
                        <input
                          type="checkbox"
                          checked={freeDeliveryDrafts[item.product_id] ?? item.free_delivery ?? false}
                          onChange={(e) => setFreeDeliveryDrafts((prev) => ({ ...prev, [item.product_id]: e.target.checked }))}
                          className="accent-indigo-500"
                        />
                        <Truck className="w-3.5 h-3.5" />
                      </label>
                      <input
                        type="number"
                        value={draftValue}
                        onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [item.product_id]: e.target.value }))}
                        className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
                      />
                      <button onClick={() => handleUnlistMyListing(item)} disabled={savingId === item.product_id} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition">
                        Unlist
                      </button>
                      <button onClick={() => handleUpdateMyListing(item)} disabled={savingId === item.product_id} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold transition">
                        Update
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'sales' && (
        <div>
          {loadingSales ? (
            <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-slate-500 animate-spin" /></div>
          ) : sales.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">No sales yet. Share your storefront link!</p>
          ) : (
            <div className="space-y-2">
              {sales.map((order) => (
                <div key={order.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <div>
                    <p className="text-sm text-white">{order.customer_receipt_number}</p>
                    <p className="text-xs text-slate-500">{new Date(order.created_at).toLocaleString()} · delivery {order.transport_status}</p>
                  </div>
                  <p className="text-emerald-400 font-semibold">+{formatUGX(order.reseller_margin_amount)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DropshipResellerDashboard;
