import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE_LISTING_PREFIX, toStoreListing, isStoreListing, normalizeStorefront, indexDeliveryByProduct,
  planDelivery, mergeDeliveryCart, withoutMoved, deliveryChecklist, describeUndeliverable,
} from '../src/utils/siteDelivery.js';

// Delivery on a business website's own store products: the cart was built for dropship listings, so a deliverable store product
// is dressed in the same shape; the server hands the order to the very same dropship checkout.

const store = { name: 'Kampala Mart Ntinda', lat: 0.3476, lng: 32.6169 };
const rice = { product_id: 'p-rice', name: 'Rice 5kg', price: 10000, tax_rate: 18, available_stock: 20, in_stock: true, images: ['a.jpg'] };
const sugar = { product_id: 'p-sugar', name: 'Sugar 1kg', price: 4000, tax_rate: 0, available_stock: 0, in_stock: false };

test('a store product becomes a cart listing with the store pin, no markup and no subsidy', () => {
  const l = toStoreListing(rice, store);
  assert.equal(l.listing_id, `${STORE_LISTING_PREFIX}p-rice`);
  assert.equal(l.product_id, 'p-rice');
  assert.equal(l.listed_price, 10000);
  assert.equal(l.available_stock, 20);
  assert.equal(l.in_stock, true);
  assert.equal(l.store_lat, 0.3476);
  assert.equal(l.store_lng, 32.6169);
  assert.equal(l.reseller_name, 'Kampala Mart Ntinda');
  assert.equal(l.free_delivery, false);
  assert.equal(l.max_delivery_subsidy, 0);
  assert.deepEqual(l.images, ['a.jpg']);
  assert.equal(isStoreListing(l), true);
});

test('a dropship listing is not a store listing, and odd data does not break the shape', () => {
  assert.equal(isStoreListing({ listing_id: 'abc', product_id: 'x' }), false);
  assert.equal(isStoreListing(undefined), false);
  const l = toStoreListing({ product_id: 'p', name: 'N', price: '2500', available_stock: -3, images: null }, {});
  assert.equal(l.listed_price, 2500);
  assert.equal(l.available_stock, 0);
  assert.deepEqual(l.images, []);
  assert.equal(l.reseller_name, 'Store');
  assert.equal(l.store_lat, null);
});

test('the server\'s storefront answer: only an explicit "enabled" with products counts', () => {
  const off = { enabled: false, guestOk: false, store: null, listings: [] };
  assert.deepEqual(normalizeStorefront(null), off);
  assert.deepEqual(normalizeStorefront(undefined), off);
  assert.deepEqual(normalizeStorefront({ enabled: false }), off);
  assert.deepEqual(normalizeStorefront({ enabled: true }), off);
  assert.deepEqual(normalizeStorefront({ enabled: 'true', products: [] }), off);
  const on = normalizeStorefront({ enabled: true, guest_ok: true, store, products: [rice, sugar, { product_id: 'free', price: 0 }, null] });
  assert.equal(on.enabled, true);
  assert.equal(on.guestOk, true);
  assert.equal(on.listings.length, 2);                       // the one without a price, and null, are dropped
  assert.equal(on.listings[0].store_lat, 0.3476);
  assert.equal(normalizeStorefront({ enabled: true, guest_ok: 'yes', store, products: [rice] }).guestOk, false);
});

test('a hand-made dropship listing wins over the store one for the same product', () => {
  const real = { listing_id: 'L1', product_id: 'p-rice', listed_price: 11000, in_stock: true, available_stock: 5 };
  const byProduct = indexDeliveryByProduct([real], [toStoreListing(rice, store), toStoreListing(sugar, store)]);
  assert.equal(byProduct.get('p-rice'), real);
  assert.equal(byProduct.get('p-sugar').from_store, true);
  assert.equal(byProduct.get('nope'), undefined);
});

test('ticked products move into the delivery cart, capped by stock; the rest stay ticked', () => {
  const byProduct = indexDeliveryByProduct([], [toStoreListing(rice, store), toStoreListing(sugar, store)]);
  const plan = planDelivery({ 'p-rice': 25, 'p-sugar': 2, 'p-unknown': 1, 'p-zero': 0 }, byProduct);
  assert.deepEqual(plan.cart, { [`${STORE_LISTING_PREFIX}p-rice`]: 20 });   // 25 asked, 20 in stock
  assert.deepEqual(plan.moved, ['p-rice']);                                  // out of stock + unknown stay for the Pay tab
  assert.equal(plan.count, 20);
  assert.deepEqual(planDelivery({}, byProduct), { cart: {}, moved: [], count: 0 });
  assert.deepEqual(planDelivery(null, byProduct), { cart: {}, moved: [], count: 0 });
  assert.deepEqual(planDelivery({ 'p-rice': -2 }, byProduct).cart, {});
  assert.deepEqual(planDelivery({ 'p-rice': 2.9 }, byProduct).cart, { [`${STORE_LISTING_PREFIX}p-rice`]: 2 });
});

test('adding to the delivery cart never goes over what is in stock', () => {
  const l = toStoreListing(rice, store);
  const byId = new Map([[l.listing_id, l]]);
  assert.deepEqual(mergeDeliveryCart({}, { [l.listing_id]: 3 }, byId), { [l.listing_id]: 3 });
  assert.deepEqual(mergeDeliveryCart({ [l.listing_id]: 18 }, { [l.listing_id]: 5 }, byId), { [l.listing_id]: 20 });
  assert.deepEqual(mergeDeliveryCart({ other: 1 }, { [l.listing_id]: 1 }, byId), { other: 1, [l.listing_id]: 1 });
  assert.deepEqual(mergeDeliveryCart(null, {}, byId), {});
});

test('what moved to the delivery cart leaves the ticked list; the rest stays', () => {
  assert.deepEqual(withoutMoved({ a: 1, b: 2, c: 3 }, ['a', 'c']), { b: 2 });
  assert.deepEqual(withoutMoved({ a: 1 }, []), { a: 1 });
  assert.deepEqual(withoutMoved(null, ['a']), {});
});

test('the owner\'s checklist lists the four things dropship delivery needs, in order, with a fix for each missing one', () => {
  const all = deliveryChecklist({ checks: { store: true, location: true, wallet: true, ugx: true } });
  assert.deepEqual(all.map((i) => i.key), ['store', 'location', 'wallet', 'ugx']);
  assert.ok(all.every((i) => i.ok));
  const some = deliveryChecklist({ checks: { store: true, location: false, wallet: true } });
  assert.deepEqual(some.map((i) => i.ok), [true, false, true, false]);
  assert.ok(some.filter((i) => !i.ok).every((i) => i.hint.length > 10));
  assert.ok(deliveryChecklist(null).every((i) => !i.ok));
});

test('products that cannot be delivered are explained, not just counted', () => {
  assert.equal(describeUndeliverable({ deliverable: 9 }), '');
  assert.equal(describeUndeliverable(null), '');
  assert.equal(describeUndeliverable({ no_tax: 1 }), '1 product can\'t be delivered: 1 has no tax rate (0% is fine - it just has to be set).');
  const text = describeUndeliverable({ no_tax: 2, excluded: 1, no_price: 0, services: 3 });
  assert.match(text, /^6 products can't be delivered: /);
  assert.match(text, /2 have no tax rate/);
  assert.match(text, /1 is kept out of dropshipping/);
  assert.match(text, /3 are services/);
  assert.doesNotMatch(text, /no price/);
});
