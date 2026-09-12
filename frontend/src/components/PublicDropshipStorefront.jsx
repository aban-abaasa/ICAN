import React, { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, Plus, Minus, X, Loader, AlertCircle, CheckCircle, Store, Trash2, Truck, Navigation, Bike, Star, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import { getDropshipStorefront, dropshipCheckout, findDeliveryRiders } from '../services/dropshipService';

// Presets for the customer-chosen delivery deadline — mirrors the backend's
// delivery.min_deadline_hours/delivery.max_deadline_hours bounds (1-48h by
// default). Once this window elapses after the store scans the order out,
// the rider is warned and the order becomes refundable straight from their
// own wallet — see ADD_DELIVERY_ESCROW_DEADLINE_AND_RIDER_LIABILITY.sql.
const DELIVERY_WINDOW_OPTIONS = [
  { hours: 1, label: 'Within 1 hour' },
  { hours: 2, label: 'Within 2 hours' },
  { hours: 4, label: 'Within 4 hours' },
  { hours: 8, label: 'Within 8 hours' },
  { hours: 24, label: 'Within 24 hours' },
  { hours: 48, label: 'Within 2 days' },
];

// mbg_riders.vehicle_type values dropship actually matches against — same
// bike/car/van choice BodaGoera's own ride screen offers, filtered straight
// through mbg_find_available_riders' existing p_vehicle_types.
const VEHICLE_TYPE_OPTIONS = [
  { value: null, label: 'Any' },
  { value: 'motorcycle', label: '🏍️ Boda' },
  { value: 'car', label: '🚗 Car' },
  { value: 'van', label: '🚐 Van' },
];

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

  // Delivery location, window and rider choice — required by dropship_checkout
  // so it can book a real BodaGoera rider (see dropshipService.js).
  const [deliveryCoords, setDeliveryCoords] = useState(null); // { lat, lng }
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [maxDeliveryHours, setMaxDeliveryHours] = useState(4);
  const [riders, setRiders] = useState([]);
  const [ridersLoading, setRidersLoading] = useState(false);
  const [selectedRiderId, setSelectedRiderId] = useState(null); // null = auto-assign nearest
  const [vehicleType, setVehicleType] = useState(null); // null = any bike/car/van

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
  const storeLat = listings[0]?.store_lat;
  const storeLng = listings[0]?.store_lng;

  // Once we know both the store's pickup point and where the customer wants
  // it delivered, look up real nearby riders so they can actually pick one —
  // same list BodaGoera's own ride-request screen shows, not a silent
  // auto-assign.
  useEffect(() => {
    let cancelled = false;
    // mbg_find_available_riders is authenticated-only — an anonymous visitor
    // can still share their location and pick a delivery window, they just
    // won't see the picker (and checkout itself requires sign-in anyway).
    if (!user || storeLat == null || storeLng == null || !deliveryCoords) {
      setRiders([]);
      return;
    }
    setRidersLoading(true);
    setSelectedRiderId(null);
    findDeliveryRiders(storeLat, storeLng, deliveryCoords.lat, deliveryCoords.lng, {
      vehicleTypes: vehicleType ? [vehicleType] : null,
    }).then(({ data }) => {
      if (cancelled) return;
      setRiders(data || []);
      setRidersLoading(false);
    });
    return () => { cancelled = true; };
  }, [user, storeLat, storeLng, deliveryCoords, vehicleType]);

  const shareLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Your browser can\'t share location — enter your address and we\'ll auto-assign a rider');
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDeliveryCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSelectedRiderId(null);
        setLocating(false);
      },
      () => {
        setLocationError('Could not get your location — please allow location access to book delivery');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const cartItems = useMemo(
    () => Object.entries(cart)
      .map(([listingId, qty]) => ({ listing: listings.find((l) => l.listing_id === listingId), qty }))
      .filter((row) => row.listing && row.qty > 0),
    [cart, listings]
  );
  const cartTotal = cartItems.reduce((sum, row) => sum + row.listing.listed_price * row.qty, 0);
  const cartCount = cartItems.reduce((sum, row) => sum + row.qty, 0);
  const allFreeDelivery = cartItems.length > 0 && cartItems.every((row) => row.listing.free_delivery);
  // Preview only — dropship_checkout always recomputes the REAL fare
  // server-side (BodaGoera's own fare formula for whichever rider actually
  // gets assigned) and applies the reseller's subsidy itself; this just
  // mirrors that logic client-side using the picked/nearest rider's already-
  // computed .fare so the customer isn't surprised at checkout.
  const selectedRider = riders.find((r) => r.rider_id === selectedRiderId);
  const estimatedFare = selectedRider?.fare ?? riders[0]?.fare ?? null;
  const subsidyCap = allFreeDelivery
    ? Infinity
    : cartItems.reduce((min, row) => Math.min(min, Number(row.listing.max_delivery_subsidy) || 0), Infinity);
  const deliveryFeeAmount = estimatedFare == null ? null : Math.max(estimatedFare - Math.min(subsidyCap, estimatedFare), 0);
  const orderTotal = cartTotal + (deliveryFeeAmount || 0);

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
    if (!deliveryCoords) {
      setCheckoutError('Share your delivery location first — a real rider is booked for this order');
      return;
    }

    setPlacing(true);
    setCheckoutError(null);
    try {
      const cartPayload = cartItems.map((row) => ({ product_id: row.listing.product_id, quantity: row.qty }));
      const { data, error } = await dropshipCheckout(businessProfileId, cartPayload, {
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        deliveryLat: deliveryCoords.lat,
        deliveryLng: deliveryCoords.lng,
        maxDeliveryHours,
        riderId: selectedRiderId || undefined,
        vehicleTypes: vehicleType ? [vehicleType] : undefined,
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
            {receipt.delivery_fee > 0 && (
              <div className="flex justify-between text-sm"><span className="text-slate-400">Delivery fee</span><span className="text-white">{formatUGX(receipt.delivery_fee)}</span></div>
            )}
            {receipt.reseller_transport_subsidy > 0 && (
              <div className="flex justify-between text-sm"><span className="text-slate-400">Covered by seller</span><span className="text-emerald-400">-{formatUGX(receipt.reseller_transport_subsidy)}</span></div>
            )}
            <div className="flex justify-between text-base font-semibold border-t border-slate-800 pt-2 mt-2"><span className="text-slate-300">Total paid</span><span className="text-white">{formatUGX(receipt.customer_paid_total)}</span></div>
            {receipt.delivery_address && (
              <div className="flex justify-between text-sm"><span className="text-slate-400">Delivery to</span><span className="text-white text-right">{receipt.delivery_address}</span></div>
            )}
            {receipt.max_delivery_hours && (
              <div className="flex justify-between text-sm"><span className="text-slate-400">Delivery window</span><span className="text-white">Within {receipt.max_delivery_hours}h of dispatch</span></div>
            )}
            <p className="text-xs text-slate-500 pt-2">
              A BodaGoera rider has been booked for this order. The store/reseller only gets paid once the rider scans it out — track that and confirm delivery at{' '}
              {receipt.verify_url ? (
                <a href={receipt.verify_url} target="_blank" rel="noreferrer" className="text-indigo-400 underline">{receipt.verify_url}</a>
              ) : 'your receipt link'}.
              {' '}If it misses the window above, you can reclaim your money from the rider's account there.
            </p>
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
                {listing.free_delivery ? (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-400"><Truck className="w-3 h-3" />Free delivery</p>
                ) : listing.max_delivery_subsidy > 0 ? (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-400"><Truck className="w-3 h-3" />Up to {formatUGX(listing.max_delivery_subsidy)} off delivery</p>
                ) : null}
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
                  <div className="space-y-2 pt-2">
                    <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Your name" className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                    <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Phone number" className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                    <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Delivery address (e.g. street, landmark)" className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />

                    <button
                      type="button"
                      onClick={shareLocation}
                      disabled={locating}
                      className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold border transition ${
                        deliveryCoords ? 'border-emerald-700 bg-emerald-500/10 text-emerald-400' : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {locating ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}
                      {deliveryCoords ? 'Delivery location shared' : 'Share my delivery location'}
                    </button>
                    {locationError && <p className="text-xs text-red-400">{locationError}</p>}

                    <div>
                      <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1"><Clock className="w-3.5 h-3.5" />Deliver within</label>
                      <select
                        value={maxDeliveryHours}
                        onChange={(e) => setMaxDeliveryHours(Number(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                      >
                        {DELIVERY_WINDOW_OPTIONS.map((opt) => (
                          <option key={opt.hours} value={opt.hours}>{opt.label}</option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-slate-500">If the rider misses this window, you can reclaim your money straight from their account.</p>
                    </div>

                    {deliveryCoords && user && (
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1"><Bike className="w-3.5 h-3.5" />Vehicle</label>
                        <div className="flex gap-1.5 mb-2">
                          {VEHICLE_TYPE_OPTIONS.map((opt) => (
                            <button
                              key={opt.value ?? 'any'}
                              type="button"
                              onClick={() => setVehicleType(opt.value)}
                              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                                vehicleType === opt.value ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1"><Bike className="w-3.5 h-3.5" />Rider / driver</label>
                        {ridersLoading ? (
                          <div className="flex items-center gap-2 text-xs text-slate-500 py-2"><Loader className="w-3.5 h-3.5 animate-spin" />Finding nearby riders…</div>
                        ) : riders.length === 0 ? (
                          <p className="text-xs text-amber-400 py-1">No riders nearby right now — we'll auto-assign one as soon as checkout completes.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            <button
                              type="button"
                              onClick={() => setSelectedRiderId(null)}
                              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left text-xs transition ${
                                selectedRiderId === null ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-900 hover:bg-slate-800'
                              }`}
                            >
                              <span className="text-white font-medium">Auto-assign nearest available</span>
                              <span className="text-slate-500">Fastest</span>
                            </button>
                            {riders.map((r) => (
                              <button
                                key={r.rider_id}
                                type="button"
                                onClick={() => setSelectedRiderId(r.rider_id)}
                                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left text-xs transition ${
                                  selectedRiderId === r.rider_id ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-900 hover:bg-slate-800'
                                }`}
                              >
                                <span className="min-w-0">
                                  <span className="block text-white font-medium truncate">{r.full_name} · {r.vehicle_type}</span>
                                  <span className="flex items-center gap-1 text-slate-400"><Star className="w-3 h-3 text-amber-400" />{Number(r.rating || 0).toFixed(1)} · {Number(r.distance_to_pickup_km || 0).toFixed(1)}km away</span>
                                </span>
                                <span className="shrink-0 text-slate-500 text-right">~{r.estimated_arrival_min}min<br />{formatUGX(r.fare)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {allFreeDelivery ? (
                      <p className="flex items-center gap-1.5 text-xs text-emerald-400"><Truck className="w-3.5 h-3.5" />Free delivery on this order — covered by the seller</p>
                    ) : (
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1"><Truck className="w-3.5 h-3.5" />Delivery fee</label>
                        <p className="text-sm text-white bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
                          {deliveryFeeAmount == null ? 'Calculated once a rider is matched' : formatUGX(deliveryFeeAmount)}
                          {isFinite(subsidyCap) && subsidyCap > 0 && deliveryFeeAmount != null && (
                            <span className="text-emerald-400 text-xs ml-1">(seller covers part of the real fare)</span>
                          )}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">Real BodaGoera fare for the rider you pick — never a fee you set yourself.</p>
                      </div>
                    )}
                  </div>
                  <div className="border-t border-slate-800 pt-3 space-y-1">
                    <div className="flex justify-between text-sm text-slate-400"><span>Items</span><span>{formatUGX(cartTotal)}</span></div>
                    {deliveryFeeAmount > 0 && (
                      <div className="flex justify-between text-sm text-slate-400"><span>Delivery</span><span>{formatUGX(deliveryFeeAmount)}</span></div>
                    )}
                    <div className="flex justify-between text-white font-semibold"><span>Total</span><span>{formatUGX(orderTotal)}</span></div>
                  </div>
                  {checkoutError && <p className="text-xs text-red-400">{checkoutError}</p>}
                  <button
                    onClick={handleCheckout}
                    disabled={placing || (!!user && !deliveryCoords)}
                    className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2"
                  >
                    {placing ? <Loader className="w-4 h-4 animate-spin" /> : null}
                    {!user ? 'Sign in to pay with ICANera' : !deliveryCoords ? 'Share your delivery location to continue' : `Pay ${formatUGX(orderTotal)} with ICANera`}
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
