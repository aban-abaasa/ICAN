/**
 * Delivery on a business website's OWN store products (see supabase/migrations/20261113100000_site_delivery.sql).
 *
 * The Market tab's delivery cart was built for dropship listings ({ listing_id, product_id, listed_price, ... }). A store product is
 * not a listing - nothing is ever listed - but the cart only needs those few fields, so a deliverable store product is dressed in
 * the same shape here (`from_store: true`). When the order is placed the server hands it to the very same dropship checkout.
 *
 * Everything in this file is plain data in, plain data out.
 */

export const STORE_LISTING_PREFIX = 'store:';

/** A store product the server says can be delivered, in the cart's listing shape. */
export const toStoreListing = (product, store = {}) => ({
  listing_id: `${STORE_LISTING_PREFIX}${product.product_id}`,
  product_id: product.product_id,
  name: product.name,
  sku: product.sku ?? null,
  brand: product.brand ?? null,
  images: Array.isArray(product.images) ? product.images : [],
  listed_price: Number(product.price) || 0,
  tax_rate: product.tax_rate == null ? null : Number(product.tax_rate),
  available_stock: Math.max(Number(product.available_stock) || 0, 0),
  in_stock: Boolean(product.in_stock),
  reseller_name: store.name || 'Store',
  free_delivery: false,
  max_delivery_subsidy: 0,
  store_lat: store.lat ?? null,
  store_lng: store.lng ?? null,
  from_store: true,
});

export const isStoreListing = (listing) => Boolean(listing?.from_store);

const OFF = Object.freeze({ enabled: false, guestOk: false, store: null, listings: [] });

/** get_site_delivery_storefront's answer -> { enabled, guestOk, store, listings }. Anything odd means "not on offer". */
export const normalizeStorefront = (raw) => {
  if (!raw || raw.enabled !== true || !Array.isArray(raw.products)) return OFF;
  const store = raw.store && typeof raw.store === 'object' ? raw.store : {};
  const listings = raw.products
    .filter((p) => p && p.product_id && Number(p.price) > 0)
    .map((p) => toStoreListing(p, store));
  return { enabled: true, guestOk: raw.guest_ok === true, store, listings };
};

/**
 * product_id -> the listing that delivers it. A listing the owner made by hand (dropship) wins over a store one; either way the
 * product is delivered by the same rider machinery.
 */
export const indexDeliveryByProduct = (realListings = [], storeListings = []) => {
  const byProduct = new Map();
  storeListings.forEach((l) => byProduct.set(String(l.product_id), l));
  realListings.forEach((l) => byProduct.set(String(l.product_id), l));
  return byProduct;
};

/**
 * The products ticked on the Market ({ product_id: qty }) -> what can go in the delivery cart:
 *   cart   { listing_id: qty }  (capped by free stock)
 *   moved  the product ids that left the ticked list
 *   count  items in the cart
 * A product with no listing, or out of stock, stays ticked for the Pay tab.
 */
export const planDelivery = (picked, deliveryByProduct) => {
  const cart = {};
  const moved = [];
  let count = 0;
  Object.entries(picked || {}).forEach(([productId, qty]) => {
    const wanted = Math.floor(Number(qty));
    const listing = deliveryByProduct.get(String(productId));
    if (!(wanted > 0) || !listing || !listing.in_stock) return;
    const free = Number(listing.available_stock);
    const take = Number.isFinite(free) && free > 0 ? Math.min(wanted, free) : wanted;
    cart[listing.listing_id] = take;
    moved.push(String(productId));
    count += take;
  });
  return { cart, moved, count };
};

/** Add a plan's items to the delivery cart without ever going over what is in stock. */
export const mergeDeliveryCart = (current, planCart, listingsById) => {
  const next = { ...(current || {}) };
  Object.entries(planCart || {}).forEach(([listingId, qty]) => {
    const free = Number(listingsById.get(listingId)?.available_stock);
    const sum = (Number(next[listingId]) || 0) + qty;
    next[listingId] = Number.isFinite(free) && free > 0 ? Math.min(sum, free) : sum;
  });
  return next;
};

/** The ticked list without the products that moved to the delivery cart. */
export const withoutMoved = (picked, moved) => {
  const gone = new Set(moved.map(String));
  return Object.fromEntries(Object.entries(picked || {}).filter(([productId]) => !gone.has(String(productId))));
};

// ── The owner's checklist (CMMS > Products & services > Delivery) ───────────────────────────────

/** The four things dropship delivery needs from a store, in the order an owner fixes them. */
export const deliveryChecklist = (info) => {
  const checks = info?.checks || {};
  return [
    { key: 'store', ok: Boolean(checks.store), label: 'A store is linked to this business',
      hint: 'Delivery is for the products of your store. Link your store to this business in CMMS > Store room.' },
    { key: 'location', ok: Boolean(checks.location), label: 'The store\'s pickup point is on the map',
      hint: 'A rider has to know where to collect the order. Set the store\'s pin in CMMS > Store room (Edit pin).' },
    { key: 'wallet', ok: Boolean(checks.wallet), label: 'The store has its business wallet',
      hint: 'Orders are paid into the store\'s business wallet. Create it from the store\'s settings.' },
    { key: 'ugx', ok: Boolean(checks.ugx), label: 'The store sells in UGX',
      hint: 'Rider fares are in UGX, so delivery is only for stores that sell in UGX.' },
  ];
};

/** "3 products can't go: 1 has no tax rate, 1 is kept out of dropshipping" - or '' when everything can. */
export const describeUndeliverable = (counts) => {
  const c = counts || {};
  const parts = [
    [c.no_tax, 'has no tax rate (0% is fine - it just has to be set)', 'have no tax rate (0% is fine - it just has to be set)'],
    [c.excluded, 'is kept out of dropshipping', 'are kept out of dropshipping'],
    [c.no_price, 'has no price', 'have no price'],
    [c.services, 'is a service (nothing to carry)', 'are services (nothing to carry)'],
  ].filter(([n]) => Number(n) > 0).map(([n, one, many]) => `${n} ${Number(n) === 1 ? one : many}`);
  if (parts.length === 0) return '';
  const total = [c.no_tax, c.excluded, c.no_price, c.services].reduce((sum, n) => sum + (Number(n) || 0), 0);
  return `${total} product${total === 1 ? '' : 's'} can't be delivered: ${parts.join('; ')}.`;
};
