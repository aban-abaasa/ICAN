import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Bike, CheckCircle, ImageOff, Loader, MapPin, Minus, Navigation, Plus, Search,
  ShoppingCart, Sparkles, Truck, X
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { formatKm, haversineKm, productKey, searchCatalog, suggestCorrection } from '../utils/supplierSearch';
import {
  getCurrentPosition, getSupplierLocations, quoteDelivery, requestSupplierOrderDelivery,
  setCompanyDeliveryPoint
} from '../services/cmmsSupplierDeliveryService';

const PAGE_SIZE = 24;

const VEHICLES = [
  { id: 'motorcycle', label: 'Boda', hint: 'Small, light loads', Icon: Bike },
  { id: 'van', label: 'Van', hint: 'Medium loads', Icon: Truck },
  { id: 'truck', label: 'Truck', hint: 'Bulky or heavy loads', Icon: Truck }
];

const SORTS = [
  { id: 'best', label: 'Best match' },
  { id: 'nearest', label: 'Nearest' },
  { id: 'cheapest', label: 'Lowest price' }
];

const priceTagOf = (item) =>
  item.price_tag || `${item.currency || 'UGX'} ${Number(item.price_per_unit || 0).toLocaleString()} / ${item.unit || 'unit'}`;

const ugx = (value) => `UGX ${Number(value || 0).toLocaleString()}`;

const TRANSPORT_LABEL = {
  requested: 'BodaGoera · requested',
  dispatched: 'BodaGoera · on the way',
  delivered: 'BodaGoera · delivered',
  cancelled: 'Delivery cancelled'
};

// Falls back to a neutral placeholder when there is no image or it fails to load.
function ProductImage({ src, alt, className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);

  if (!src || failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-slate-800 text-slate-500 ${className}`}>
        <ImageOff className="h-6 w-6" />
        <span className="text-[10px]">No image</span>
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
}

const byDistance = (a, b) => {
  if (a.distanceKm == null && b.distanceKm == null) return 0;
  if (a.distanceKm == null) return 1;
  if (b.distanceKm == null) return -1;
  return a.distanceKm - b.distanceKm;
};

export default function CMSSupplierPurchasePanel({ companyId, requisitionId = null, canOrder = false }) {
  const [catalog, setCatalog] = useState([]);
  const [orders, setOrders] = useState([]);
  const [locations, setLocations] = useState({ company: null, suppliers: {} });
  const [deliveryAvailable, setDeliveryAvailable] = useState(false);
  const [dest, setDest] = useState({ latitude: null, longitude: null, address: '' });
  const [locating, setLocating] = useState(false);
  const [savingPoint, setSavingPoint] = useState(false);

  const [query, setQuery] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [sortBy, setSortBy] = useState('best');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [deliveryMode, setDeliveryMode] = useState('bodagoera');
  const [vehicle, setVehicle] = useState('');
  const [quotes, setQuotes] = useState({});
  const [quoting, setQuoting] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null); // { type: 'ok' | 'warn', text }
  const [error, setError] = useState('');

  const loadOrders = async () => {
    const result = await supabase.rpc('cmms_get_supplier_orders', { p_cmms_company_id: companyId });
    if (!result.error) setOrders(result.data || []);
  };

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    const [catalogResult, ordersResult, locationResult] = await Promise.all([
      supabase.rpc('cmms_get_supplier_catalog', { p_cmms_company_id: companyId }),
      supabase.rpc('cmms_get_supplier_orders', { p_cmms_company_id: companyId }),
      getSupplierLocations(companyId)
    ]);
    if (catalogResult.error) {
      setCatalog([]);
      setError(`Unable to load real suppliers: ${catalogResult.error.message}`);
    } else {
      setCatalog(catalogResult.data || []);
      setError('');
    }
    if (!ordersResult.error) setOrders(ordersResult.data || []);

    // Distances and BodaGoera delivery need the locations SQL; without it the
    // panel still searches and orders, just with supplier delivery only.
    if (locationResult.data) {
      const suppliers = {};
      (locationResult.data.suppliers || []).forEach((row) => { suppliers[row.business_profile_id] = row; });
      const company = locationResult.data.company || null;
      setLocations({ company, suppliers });
      setDeliveryAvailable(true);
      if (company?.latitude != null && company?.longitude != null) {
        setDest((current) => (current.latitude != null ? current : {
          latitude: Number(company.latitude), longitude: Number(company.longitude), address: company.address || ''
        }));
      }
    } else {
      setDeliveryAvailable(false);
      setDeliveryMode('supplier');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [companyId]);

  // ---------------------------------------------------------------- catalogue
  const allItems = useMemo(() => catalog.filter((item) => item.catalog_item_id).map((item) => {
    const loc = locations.suppliers[item.supplier_business_profile_id];
    const hasLocation = loc?.latitude != null && loc?.longitude != null;
    return {
      ...item,
      hasLocation,
      transportEnabled: loc?.transport_enabled !== false,
      distanceKm: hasLocation && dest.latitude != null
        ? haversineKm(dest.latitude, dest.longitude, loc.latitude, loc.longitude)
        : null
    };
  }), [catalog, locations, dest.latitude, dest.longitude]);

  const suppliers = useMemo(() => {
    const seen = new Map();
    catalog.forEach((row) => {
      if (!seen.has(row.supplier_business_profile_id)) {
        seen.set(row.supplier_business_profile_id, { id: row.supplier_business_profile_id, name: row.supplier_business_name });
      }
    });
    return [...seen.values()].map((supplier) => {
      const sample = allItems.find((item) => item.supplier_business_profile_id === supplier.id);
      return { ...supplier, distanceKm: sample?.distanceKm ?? null };
    }).sort((a, b) => byDistance(a, b) || a.name.localeCompare(b.name));
  }, [catalog, allItems]);

  const scoped = useMemo(
    () => (supplierFilter ? allItems.filter((item) => item.supplier_business_profile_id === supplierFilter) : allItems),
    [allItems, supplierFilter]
  );

  const search = useMemo(() => searchCatalog(scoped, query), [scoped, query]);
  const correction = useMemo(
    () => (query.trim() && !search.exact ? suggestCorrection(allItems, query) : null),
    [allItems, query, search.exact]
  );

  const ranked = useMemo(() => {
    const rows = [...search.results];
    rows.sort((a, b) => {
      if (sortBy === 'cheapest') return Number(a.item.price_per_unit || 0) - Number(b.item.price_per_unit || 0);
      if (sortBy === 'nearest') return byDistance(a.item, b.item) || b.score - a.score;
      return (b.score - a.score) || byDistance(a.item, b.item) || String(a.item.item_name || '').localeCompare(String(b.item.item_name || ''));
    });
    return rows.map((row) => row.item);
  }, [search.results, sortBy]);

  // "Closest" / "Best price" among suppliers that stock the same product.
  const marks = useMemo(() => {
    const groups = new Map();
    ranked.forEach((item) => {
      const key = productKey(item);
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    const result = {};
    groups.forEach((members) => {
      if (members.length < 2) return;
      const cheapest = members.reduce((best, item) => (Number(item.price_per_unit) < Number(best.price_per_unit) ? item : best));
      const located = members.filter((item) => item.distanceKm != null);
      const nearest = located.length > 1 ? located.reduce((best, item) => (item.distanceKm < best.distanceKm ? item : best)) : null;
      result[cheapest.catalog_item_id] = { ...(result[cheapest.catalog_item_id] || {}), cheapest: true };
      if (nearest) result[nearest.catalog_item_id] = { ...(result[nearest.catalog_item_id] || {}), nearest: true };
    });
    return result;
  }, [ranked]);

  // Smart picks for what was searched: the closest relevant supplier and the
  // lowest price for the best-matching product.
  const picks = useMemo(() => {
    if (!query.trim() || ranked.length === 0) return [];
    const relevant = search.results
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((row) => row.item);
    const closest = relevant.filter((item) => item.distanceKm != null).sort(byDistance)[0] || null;
    const topKey = productKey(relevant[0]);
    const sameProduct = relevant.filter((item) => productKey(item) === topKey);
    const cheapest = sameProduct.length > 1
      ? sameProduct.reduce((best, item) => (Number(item.price_per_unit) < Number(best.price_per_unit) ? item : best))
      : null;

    const rows = [];
    if (closest) rows.push({ label: cheapest && cheapest.catalog_item_id === closest.catalog_item_id ? 'Closest & cheapest' : 'Closest to you', item: closest });
    if (cheapest && !(closest && cheapest.catalog_item_id === closest.catalog_item_id)) rows.push({ label: 'Lowest price', item: cheapest });
    return rows;
  }, [query, ranked, search.results]);

  const visibleItems = ranked.slice(0, visibleCount);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [query, supplierFilter, sortBy]);

  // ------------------------------------------------------- selected product
  const selectedItem = allItems.find((item) => item.catalog_item_id === itemId) || null;
  const minQty = Number(selectedItem?.min_order_qty) || 1;
  const goodsTotal = selectedItem ? (Number(quantity) || 0) * Number(selectedItem.price_per_unit || 0) : 0;
  const selectedLocation = selectedItem ? locations.suppliers[selectedItem.supplier_business_profile_id] : null;
  const canUseBodaGoera = deliveryAvailable && !!selectedItem?.transportEnabled;
  const useBodaGoera = canUseBodaGoera && deliveryMode === 'bodagoera';
  const hasDestination = dest.latitude != null && dest.longitude != null;

  // Live BodaGoera quotes for each vehicle, from the supplier to the delivery point.
  const supplierLat = selectedLocation?.latitude;
  const supplierLng = selectedLocation?.longitude;
  useEffect(() => {
    setQuotes({});
    if (!useBodaGoera || !hasDestination || supplierLat == null || supplierLng == null) return undefined;
    let cancelled = false;
    setQuoting(true);
    const pickup = { latitude: Number(supplierLat), longitude: Number(supplierLng) };
    Promise.all(VEHICLES.map((v) => quoteDelivery(pickup, dest, v.id))).then((results) => {
      if (cancelled) return;
      const next = {};
      results.forEach((result, index) => { if (result.data) next[VEHICLES[index].id] = result.data; });
      setQuotes(next);
      setQuoting(false);
    });
    return () => { cancelled = true; };
  }, [useBodaGoera, hasDestination, dest.latitude, dest.longitude, supplierLat, supplierLng, itemId]);

  // Recommend the cheapest vehicle that is actually free right now; the buyer
  // can still pick a bigger one for bulky loads.
  const recommendedVehicle = useMemo(() => {
    const free = VEHICLES.filter((v) => quotes[v.id]?.available_count > 0);
    if (free.length === 0) return quotes.motorcycle ? 'motorcycle' : '';
    return free.reduce((best, v) => (Number(quotes[v.id].fare) < Number(quotes[best.id].fare) ? v : best)).id;
  }, [quotes]);
  const chosenVehicle = vehicle || recommendedVehicle || 'motorcycle';
  const chosenQuote = quotes[chosenVehicle] || null;

  const pickItem = (item) => {
    setItemId(item.catalog_item_id);
    setQuantity(String(Number(item.min_order_qty) || 1));
    setVehicle('');
    setNotice(null);
  };

  const stepQuantity = (delta) => setQuantity(String(Math.max(minQty, (Number(quantity) || 0) + delta)));

  // ----------------------------------------------------- delivery location
  const useMyLocation = async () => {
    setLocating(true); setError('');
    try {
      const position = await getCurrentPosition();
      setDest((current) => ({ ...current, ...position }));
    } catch (locationError) {
      setError(locationError.message);
    }
    setLocating(false);
  };

  const savedPoint = locations.company;
  const pointIsSaved = savedPoint?.latitude != null && hasDestination
    && Math.abs(Number(savedPoint.latitude) - dest.latitude) < 0.00005
    && Math.abs(Number(savedPoint.longitude) - dest.longitude) < 0.00005
    && (savedPoint.address || '') === dest.address.trim();

  const savePoint = async () => {
    setSavingPoint(true); setError('');
    const result = await setCompanyDeliveryPoint(companyId, dest);
    if (result.error) setError(result.error.message);
    else setLocations((current) => ({ ...current, company: { latitude: dest.latitude, longitude: dest.longitude, address: dest.address.trim() } }));
    setSavingPoint(false);
  };

  // ------------------------------------------------------------------ order
  const missingDestination = useBodaGoera && (!hasDestination || !dest.address.trim());
  const canSubmit = !!selectedItem && !saving && Number(quantity) >= minQty && !missingDestination;

  const placeOrder = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true); setError(''); setNotice(null);
    const { data, error: orderError } = await supabase.rpc('cmms_create_supplier_purchase_order', {
      p_cmms_company_id: companyId,
      p_supplier_business_profile_id: selectedItem.supplier_business_profile_id,
      p_catalog_item_id: itemId,
      p_quantity: Number(quantity),
      p_delivery_details: {
        address: dest.address.trim() || null,
        latitude: hasDestination ? dest.latitude : null,
        longitude: hasDestination ? dest.longitude : null,
        delivery_method: useBodaGoera ? 'bodagoera' : 'supplier'
      },
      p_cmms_requisition_id: requisitionId
    });
    if (orderError) {
      setError(orderError.message);
      setSaving(false);
      return;
    }

    let text = `Supplier order ${data.order_number} submitted.`;
    let type = 'ok';
    if (useBodaGoera) {
      const delivery = await requestSupplierOrderDelivery(data.id, chosenVehicle, dest);
      if (delivery.error) {
        type = 'warn';
        text += ` The BodaGoera delivery could not be requested (${delivery.error.message}). The order stands; request delivery again from Book Transport.`;
      } else if (delivery.data?.success === false) {
        type = 'warn';
        text += ` ${delivery.data.message}`;
      } else {
        const fare = Number(delivery.data?.estimated_fare || 0);
        text += ` BodaGoera delivery requested${fare > 0 ? ` (about ${ugx(fare)})` : ''}.`;
      }
    }
    setNotice({ type, text });
    setItemId(''); setQuantity('1'); setVehicle('');
    await loadOrders();
    setSaving(false);
  };

  // ------------------------------------------------------------------- view
  const renderCard = (item) => {
    const active = item.catalog_item_id === itemId;
    const mark = marks[item.catalog_item_id] || {};
    return (
      <button
        type="button"
        key={item.catalog_item_id}
        onClick={() => pickItem(item)}
        aria-pressed={active}
        className={`relative overflow-hidden rounded-xl border text-left transition-colors ${active ? 'border-cyan-300 ring-2 ring-cyan-400/70 bg-cyan-500/15' : 'border-white/15 bg-slate-900/70 hover:border-white/30'}`}
      >
        <div className="relative aspect-square w-full">
          <ProductImage src={item.image_url} alt={item.item_name} className="h-full w-full" />
          <span className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-md bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-slate-900 shadow">
            {priceTagOf(item)}
          </span>
          <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1">
            {mark.nearest && <span className="rounded-md bg-sky-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">Closest</span>}
            {mark.cheapest && <span className="rounded-md bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">Best price</span>}
          </div>
          {active && <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500 text-white shadow"><CheckCircle className="h-4 w-4" /></span>}
        </div>
        <div className="p-2">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-white">{item.item_name}</p>
          <p className="mt-0.5 truncate text-[11px] text-cyan-200">{item.supplier_business_name}</p>
          <p className="truncate text-[11px] text-gray-400">
            {item.distanceKm != null
              ? <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{formatKm(item.distanceKm)} away</span>
              : (item.category || ' ')}
            {Number(item.min_order_qty) > 1 ? ` · Min ${item.min_order_qty}` : ''}
          </p>
        </div>
      </button>
    );
  };

  return <div className="mb-6 rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3 sm:p-4">
    <div className="flex items-center gap-2 mb-2"><ShoppingCart className="w-5 h-5 shrink-0 text-cyan-300" /><h3 className="font-bold text-white">Order from supplier</h3></div>
    <p className="text-xs text-gray-300 mb-3">Search every supplier at once, compare price and distance, and have BodaGoera deliver it.</p>
    {loading ? <div className="flex items-center gap-2 text-gray-300"><Loader className="w-4 h-4 animate-spin" /> Loading supplier catalogs…</div> : <>
      {canOrder ? <form onSubmit={placeOrder} className="space-y-3">
        {/* Delivery point: drives distances, quotes and where the goods go */}
        <div className="rounded-xl border border-white/15 bg-slate-950/40 p-2.5">
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-200"><MapPin className="h-3.5 w-3.5" /> Deliver to</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={dest.address}
              onChange={(e) => setDest((current) => ({ ...current, address: e.target.value }))}
              placeholder="Delivery address or site"
              className="h-11 min-w-0 flex-1 rounded-lg border border-white/20 bg-slate-900 px-3 text-base text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:text-sm"
            />
            <button type="button" onClick={useMyLocation} disabled={locating} className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-60">
              {locating ? <Loader className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />} Use my location
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400">
            {hasDestination
              ? <>Map point set{pointIsSaved ? ' · saved as the company delivery point' : ''}. Distances below are measured from here.</>
              : 'Set your map point to see how far each supplier is and get live delivery prices.'}
            {hasDestination && !pointIsSaved && dest.address.trim() && (
              <button type="button" onClick={savePoint} disabled={savingPoint} className="ml-2 font-semibold text-cyan-300 underline disabled:opacity-60">
                {savingPoint ? 'Saving…' : 'Save as company delivery point'}
              </button>
            )}
          </p>
        </div>

        {/* Search across every supplier */}
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any product — all suppliers"
              className="h-12 w-full rounded-xl border border-white/20 bg-slate-900 pl-9 pr-10 text-base text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:text-white"><X className="h-4 w-4" /></button>
            )}
          </div>

          <div className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            <button type="button" onClick={() => setSupplierFilter('')} className={`min-h-[36px] shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium ${!supplierFilter ? 'border-cyan-300 bg-cyan-500 text-white' : 'border-white/20 bg-slate-900/70 text-gray-200'}`}>All suppliers</button>
            {suppliers.map((supplier) => (
              <button
                type="button"
                key={supplier.id}
                onClick={() => setSupplierFilter(supplierFilter === supplier.id ? '' : supplier.id)}
                className={`min-h-[36px] shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium ${supplierFilter === supplier.id ? 'border-cyan-300 bg-cyan-500 text-white' : 'border-white/20 bg-slate-900/70 text-gray-200'}`}
              >
                {supplier.name}{supplier.distanceKm != null ? ` · ${formatKm(supplier.distanceKm)}` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Smart picks */}
        {picks.length > 0 && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-2.5">
            <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200"><Sparkles className="h-3.5 w-3.5" /> Suggested for “{query.trim()}”</p>
            <div className="space-y-2">
              {picks.map(({ label, item }) => (
                <button type="button" key={label} onClick={() => pickItem(item)} className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-slate-900/70 p-2 text-left hover:border-white/30">
                  <ProductImage src={item.image_url} alt={item.item_name} className="h-14 w-14 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-amber-300">{label}</p>
                    <p className="truncate text-sm font-semibold text-white">{item.item_name}</p>
                    <p className="truncate text-[11px] text-gray-300">{item.supplier_business_name}{item.distanceKm != null ? ` · ${formatKm(item.distanceKm)} away` : ''}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-slate-900">{priceTagOf(item)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-gray-400">{ranked.length} product{ranked.length === 1 ? '' : 's'}{supplierFilter ? ' from this supplier' : ' from all suppliers'}</span>
            <div className="flex gap-1">
              {SORTS.map((sort) => (
                <button type="button" key={sort.id} onClick={() => setSortBy(sort.id)} className={`min-h-[32px] rounded-md px-2.5 text-[11px] font-semibold ${sortBy === sort.id ? 'bg-cyan-500 text-white' : 'bg-slate-900/70 text-gray-300'}`}>{sort.label}</button>
              ))}
            </div>
          </div>

          {query.trim() && !search.exact && (
            <p className="mb-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {ranked.length > 0 ? `No exact match for “${query.trim()}”. Closest products:` : `Nothing found for “${query.trim()}”.`}
              {correction && (
                <button type="button" onClick={() => setQuery(correction)} className="ml-2 font-semibold text-amber-300 underline">Did you mean “{correction}”?</button>
              )}
            </p>
          )}

          {ranked.length === 0
            ? <p className="rounded-lg border border-dashed border-white/15 px-3 py-6 text-center text-xs text-gray-400">{suppliers.length === 0 ? 'No published suppliers yet.' : 'No products to show.'}</p>
            : <>
              <div className="grid max-h-[32rem] grid-cols-2 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {visibleItems.map(renderCard)}
              </div>
              {ranked.length > visibleCount && (
                <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="mt-2 min-h-[44px] w-full rounded-lg border border-white/20 bg-slate-900/70 text-sm font-semibold text-gray-200 hover:bg-slate-800">
                  Show more ({ranked.length - visibleCount} left)
                </button>
              )}
            </>}
        </div>

        {/* Selected product: quantity, delivery, submit */}
        {selectedItem && <div className="space-y-3 rounded-xl border border-cyan-400/30 bg-slate-950/50 p-3">
          <div className="flex items-start gap-3">
            <ProductImage src={selectedItem.image_url} alt={selectedItem.item_name} className="h-20 w-20 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">{selectedItem.item_name}</p>
              <p className="text-[11px] text-cyan-200">{selectedItem.supplier_business_name}{selectedItem.distanceKm != null ? ` · ${formatKm(selectedItem.distanceKm)} from you` : ''}</p>
              <span className="mt-1 inline-block rounded-md bg-amber-400 px-2 py-0.5 text-xs font-bold text-slate-900">{priceTagOf(selectedItem)}</span>
              {Number(selectedItem.min_order_qty) > 1 && <p className="mt-1 text-[11px] text-gray-400">Minimum order: {selectedItem.min_order_qty}</p>}
            </div>
            <button type="button" onClick={() => setItemId('')} aria-label="Clear selection" className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
          </div>

          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-400">Quantity</label>
            <div className="flex items-stretch gap-2">
              <button type="button" onClick={() => stepQuantity(-1)} aria-label="Decrease quantity" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-slate-900 text-white hover:bg-slate-800"><Minus className="h-4 w-4" /></button>
              <input
                type="number"
                inputMode="decimal"
                min={minQty}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-lg border border-white/20 bg-slate-900 px-3 text-center text-base text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
              />
              <button type="button" onClick={() => stepQuantity(1)} aria-label="Increase quantity" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-slate-900 text-white hover:bg-slate-800"><Plus className="h-4 w-4" /></button>
            </div>
          </div>

          {/* Delivery */}
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-200">Delivery</p>
            <div className="space-y-2">
              {canUseBodaGoera && (
                <div className={`rounded-xl border p-2.5 ${useBodaGoera ? 'border-cyan-300 bg-cyan-500/10' : 'border-white/15 bg-slate-900/60'}`}>
                  <button type="button" onClick={() => setDeliveryMode('bodagoera')} className="flex w-full items-start gap-2 text-left">
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${useBodaGoera ? 'border-cyan-300 bg-cyan-500' : 'border-white/30'}`}>{useBodaGoera && <CheckCircle className="h-3.5 w-3.5 text-white" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                        BodaGoera delivery
                        <span className="rounded-md bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Recommended</span>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-gray-300">Real riders near the supplier, a live price before you order, tracked pickup to drop-off, billed on your company transport contract.</span>
                    </span>
                  </button>

                  {useBodaGoera && (
                    <div className="mt-2.5 space-y-2">
                      {!hasDestination ? (
                        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-200"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Tap “Use my location” above and enter the delivery address to get live prices.</p>
                      ) : supplierLat == null ? (
                        <p className="flex items-start gap-1.5 rounded-lg bg-slate-800 px-2.5 py-2 text-xs text-gray-300"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> This supplier hasn’t pinned its location yet, so BodaGoera confirms the price after you request delivery.</p>
                      ) : quoting ? (
                        <p className="flex items-center gap-2 text-xs text-gray-300"><Loader className="h-4 w-4 animate-spin" /> Getting live BodaGoera prices…</p>
                      ) : Object.keys(quotes).length === 0 ? (
                        <p className="text-xs text-gray-400">Live prices are unavailable right now. BodaGoera will confirm the price when you request delivery.</p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-3">
                          {VEHICLES.map(({ id, label, hint, Icon }) => {
                            const quote = quotes[id];
                            if (!quote) return null;
                            const active = chosenVehicle === id;
                            return (
                              <button type="button" key={id} onClick={() => setVehicle(id)} aria-pressed={active} className={`rounded-lg border p-2 text-left ${active ? 'border-cyan-300 bg-cyan-500/15' : 'border-white/15 bg-slate-900/70'}`}>
                                <span className="flex items-center justify-between gap-1">
                                  <span className="flex items-center gap-1.5 text-sm font-semibold text-white"><Icon className="h-4 w-4" /> {label}</span>
                                  {id === recommendedVehicle && <span className="rounded bg-emerald-500/20 px-1 text-[10px] font-bold text-emerald-300">Best</span>}
                                </span>
                                <span className="mt-1 block text-base font-bold text-amber-300">{ugx(quote.fare)}</span>
                                <span className="block text-[11px] text-gray-400">{quote.distance_km} km · {hint}</span>
                                <span className={`block text-[11px] ${quote.available_count > 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                                  {quote.available_count > 0
                                    ? `${quote.available_count} free now${quote.eta_min ? ` · ~${quote.eta_min} min away` : ''}`
                                    : 'None free right now (estimate)'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {Object.keys(quotes).length > 0 && <p className="text-[11px] text-gray-400">Pick Van or Truck for bulky or heavy loads. Delivery is billed separately by BodaGoera, not added to the supplier payment.</p>}
                    </div>
                  )}
                </div>
              )}

              <button type="button" onClick={() => setDeliveryMode('supplier')} className={`flex w-full items-start gap-2 rounded-xl border p-2.5 text-left ${!useBodaGoera ? 'border-cyan-300 bg-cyan-500/10' : 'border-white/15 bg-slate-900/60'}`}>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${!useBodaGoera ? 'border-cyan-300 bg-cyan-500' : 'border-white/30'}`}>{!useBodaGoera && <CheckCircle className="h-3.5 w-3.5 text-white" />}</span>
                <span>
                  <span className="block text-sm font-semibold text-white">Supplier delivers / I collect</span>
                  <span className="block text-[11px] text-gray-400">
                    {canUseBodaGoera ? 'Arrange it directly with the supplier.' : deliveryAvailable ? 'BodaGoera delivery is not enabled for this supplier.' : 'Arrange it directly with the supplier.'}
                  </span>
                </span>
              </button>
            </div>
          </div>

          {/* Totals */}
          <div className="space-y-1 rounded-lg bg-amber-500/10 px-3 py-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-xs text-amber-200">Goods (paid via wallet approval)</span><span className="font-bold text-amber-100">{selectedItem.currency || 'UGX'} {goodsTotal.toLocaleString()}</span></div>
            {useBodaGoera && chosenQuote && <div className="flex items-center justify-between"><span className="text-xs text-amber-200">BodaGoera delivery (est.)</span><span className="font-bold text-amber-100">{ugx(chosenQuote.fare)}</span></div>}
          </div>

          <button
            disabled={!canSubmit}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2.5 font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
          >{saving ? <Loader className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />} {useBodaGoera ? 'Order + request BodaGoera delivery' : 'Submit supplier order'}</button>
          {missingDestination && <p className="text-center text-[11px] text-amber-200">Add the delivery address and map point to order with BodaGoera.</p>}
        </div>}
      </form> : <p className="text-xs text-amber-200">Your role can view supplier orders but cannot create them.</p>}
      {error && <p className="mt-2 break-words text-sm text-red-300">{error}</p>}
      {notice && (
        <p className={`mt-2 flex items-start gap-1 text-sm ${notice.type === 'ok' ? 'text-emerald-300' : 'text-amber-200'}`}>
          {notice.type === 'ok' ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="break-words">{notice.text}</span>
        </p>
      )}
      {orders.length > 0 && <div className="mt-4 space-y-1"><p className="text-xs uppercase text-gray-400">Recent supplier orders</p>{orders.slice(0, 5).map((order) => (
        <div key={order.id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 rounded bg-black/20 px-2 py-1.5 text-xs text-gray-200">
          <span className="break-all">{order.order_number}</span>
          <span>{order.status} · {order.quantity} {order.currency}{TRANSPORT_LABEL[order.transport_status] ? ` · ${TRANSPORT_LABEL[order.transport_status]}` : ''}</span>
        </div>
      ))}</div>}
    </>}
  </div>;
}
