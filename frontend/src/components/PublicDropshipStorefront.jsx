import React, { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, Plus, Minus, X, Loader, AlertCircle, CheckCircle, Store, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import { getDropshipStorefront, dropshipCheckout } from '../services/dropshipService';

const formatUGX = (amount) => `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

// Rendered instead of the normal authenticated app (see main.jsx) when the URL
// is a shared dropship storefront link (/store/:businessProfileId) -- same
// "public to view, sign in in place to act" pattern as PublicStatusViewer and
// PublicPitchViewer. Browsing works for anyone; checkout requires an ICANera
// wallet since payment is a live transfer_ican() split between the source
// store and this reseller.
const PublicDropshipStorefront = ({ businessProfileId }) => {
  const { user, loading: authLoading } = useAuth();

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [cart, setCart] = useState({}); // { [listing_id]: quantity }
  const [showCart, setShowCart] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [placing, setPlacing] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await getDropshipStorefront(businessProfileId);
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
      } else {
        setListings(data);
        setNotFound(data.length === 0);
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [businessProfileId]);

  const resellerName = listings[0]?.reseller_name || 'Store';

  const cartItems = useMemo(
    () => Object.entries(cart)
      .map(([listingId, qty]) => ({ listing: listings.find((l) => l.listing_id === listingId), qty }))
      .filter((row) => row.listing && row.qty > 0),
    [cart, listings]
  );
  const cartTotal = cartItems.reduce((sum, row) => sum + row.listing.listed_price * row.qty, 0);
  const cartCount = cartItems.reduce((sum, row) => sum + row.qty, 0);

  const changeQty = (listingId, delta, maxStock) => {
    setCart((prev) => {
      const next = Math.max(0, Math.min(maxStock ?? Infinity, (prev[listingId] || 0) + delta));
      return { ...prev, [listingId]: next };
    });
  };

  const goToApp = () => {
    window.history.replaceState({}, '', '/');
    window.location.href = '/';
  };

  const handleCheckout = async () => {
    if (authLoading) return;
    if (!user) { setShowAuthModal(true); return; }
    if (cartItems.length === 0) return;

    setPlacing(true);
    setCheckoutError(null);
    try {
      const cartPayload = cartItems.map((row) => ({ product_id: row.listing.product_id, quantity: row.qty }));
      const { data, error } = await dropshipCheckout(businessProfileId, cartPayload, {
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
      });
      if (error || !data?.success) {
        throw new Error(error?.message || data?.error || 'Checkout failed');
      }
      setReceipt(data);
      setCart({});
    } catch (err) {
      setCheckoutError(err.message || 'Checkout failed. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center">
        <Loader className="w-10 h-10 text-white animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="w-14 h-14 text-slate-500" />
        <p className="text-white text-lg font-semibold">This storefront isn't available right now</p>
        <button onClick={goToApp} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold transition">
          Open ICANEra
        </button>
      </div>
    );
  }

  if (receipt) {
    return (
      <div className="fixed inset-0 bg-slate-950 overflow-y-auto">
        <div className="max-w-lg mx-auto p-6 pt-16 text-center">
          <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-1">Order placed!</h1>
          <p className="text-slate-400 mb-6">Purchased from {resellerName}</p>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-left space-y-2">
            <div className="flex justify-between text-sm"><span className="text-slate-400">Receipt number</span><span className="text-white font-mono">{receipt.customer_receipt_number}</span></div>
            <div className="flex justify-between text-sm"><span className="text-slate-400">Items</span><span className="text-white">{receipt.items_count}</span></div>
            <div className="flex justify-between text-base font-semibold border-t border-slate-800 pt-2 mt-2"><span className="text-slate-300">Total paid</span><span className="text-white">{formatUGX(receipt.customer_paid_total)}</span></div>
            {receipt.delivery_address && (
              <div className="flex justify-between text-sm"><span className="text-slate-400">Delivery to</span><span className="text-white text-right">{receipt.delivery_address}</span></div>
            )}
            <p className="text-xs text-slate-500 pt-2">Delivery is arranged via BodaGoera. Keep your receipt number handy.</p>
          </div>
          <button onClick={goToApp} className="mt-6 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold transition">
            Open ICANEra
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-y-auto">
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Store className="w-5 h-5 text-indigo-400 shrink-0" />
          <span className="text-white font-semibold truncate">{resellerName}</span>
        </div>
        <button onClick={() => setShowCart(true)} className="relative p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition">
          <ShoppingCart className="w-5 h-5" />
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-indigo-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{cartCount}</span>
          )}
        </button>
      </div>

      <div className="max-w-3xl mx-auto p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {listings.map((listing) => {
          const qty = cart[listing.listing_id] || 0;
          return (
            <div key={listing.listing_id} className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden flex flex-col">
              <div className="aspect-square bg-slate-800 flex items-center justify-center overflow-hidden">
                {listing.images?.[0] ? (
                  <img src={listing.images[0]} alt={listing.name} className="w-full h-full object-cover" />
                ) : (
                  <Store className="w-8 h-8 text-slate-600" />
                )}
              </div>
              <div className="p-2.5 flex-1 flex flex-col">
                <p className="text-sm text-white font-medium line-clamp-2 min-h-[2.5rem]">{listing.name}</p>
                <p className="text-indigo-300 font-bold mt-1">{formatUGX(listing.listed_price)}</p>
                {!listing.in_stock ? (
                  <p className="mt-2 text-xs text-red-400">Out of stock</p>
                ) : qty === 0 ? (
                  <button onClick={() => changeQty(listing.listing_id, 1, listing.available_stock)} className="mt-2 w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition">
                    Add to cart
                  </button>
                ) : (
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-800">
                    <button onClick={() => changeQty(listing.listing_id, -1, listing.available_stock)} className="p-1.5 text-white"><Minus className="w-3.5 h-3.5" /></button>
                    <span className="text-white text-sm font-semibold">{qty}</span>
                    <button onClick={() => changeQty(listing.listing_id, 1, listing.available_stock)} className="p-1.5 text-white"><Plus className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showCart && (
        <div className="fixed inset-0 z-30 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md max-h-[90vh] bg-slate-950 border border-slate-800 rounded-t-2xl sm:rounded-2xl overflow-y-auto">
            <div className="sticky top-0 bg-slate-950 border-b border-slate-800 p-4 flex items-center justify-between">
              <h2 className="text-white font-semibold">Your cart</h2>
              <button onClick={() => setShowCart(false)} className="p-1.5 rounded-full text-slate-400 hover:bg-white/10 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              {cartItems.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">Your cart is empty</p>
              ) : (
                cartItems.map((row) => (
                  <div key={row.listing.listing_id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{row.listing.name}</p>
                      <p className="text-xs text-slate-400">{formatUGX(row.listing.listed_price)} × {row.qty}</p>
                    </div>
                    <button onClick={() => setCart((prev) => ({ ...prev, [row.listing.listing_id]: 0 }))} className="p-1.5 text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))
              )}
              {cartItems.length > 0 && (
                <>
                  <div className="border-t border-slate-800 pt-3 flex justify-between text-white font-semibold">
                    <span>Total</span><span>{formatUGX(cartTotal)}</span>
                  </div>
                  <div className="space-y-2 pt-2">
                    <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Your name" className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                    <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Phone number" className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                    <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Delivery address" className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                  </div>
                  {checkoutError && <p className="text-xs text-red-400">{checkoutError}</p>}
                  <button
                    onClick={handleCheckout}
                    disabled={placing}
                    className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2"
                  >
                    {placing ? <Loader className="w-4 h-4 animate-spin" /> : null}
                    {user ? `Pay ${formatUGX(cartTotal)} with ICANera` : 'Sign in to pay with ICANera'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showAuthModal && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950">
          <button onClick={() => setShowAuthModal(false)} className="fixed top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-black/40 z-10">
            <X className="w-6 h-6" />
          </button>
          <AuthPage initialView="signup" onAuthSuccess={() => setShowAuthModal(false)} />
        </div>
      )}
    </div>
  );
};

export default PublicDropshipStorefront;
