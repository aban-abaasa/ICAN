# Delivery on the business website Market

A business with its own store can now offer **delivery** on the Market tab of its website. Until now the store's own products
("Our products") could only be picked up and paid on the Pay tab; only dropship listings could be delivered.

It is **dropship's delivery, not a new one**: the same BodaGoEra riders, the real fare, the delivery window, payment held until the
rider has collected the order. The store's products are **not** turned into dropship listings - nothing is copied, nothing new
appears in the Dropship dashboard, the reseller directory or the dropship product browse. The store's `products` stay the one
record, so prices, stock and new products are always current.

## Turn it on (two steps)

1. Supabase → SQL editor → paste **`SITE_DELIVERY_PASTE_INTO_SUPABASE.sql`** → Run.
   (Same file as `supabase/migrations/20261113100000_site_delivery.sql`. Safe to run twice.)
   Look at the messages it prints: it should say **`guest_checkout_fulfil now lends store products while it places the order`**
   (or `... already lends ...` on a second run). If it instead warns that `guest_checkout_fulfil is not the version this migration was
   written for`, nothing was changed there and delivery stays **wallet-only** (the website then does not offer Mobile Money / card / bank
   for delivery) - tell us and we will adapt the patch.
2. In CMMS → *Products & services* (the website settings), with *Products on the website come from* set to **Store** or **Both**, a
   **Delivery** card appears. Switch it on.

The website code is deployed as usual. Until step 1 has run, nothing changes for anyone.

## What the owner sees

The switch will not move until the store can really deliver; the card shows a checklist and how to fix each missing item:

| Needed | Why |
|---|---|
| A store linked to the business | delivery is for the store's products |
| The store's **pickup point on the map** | a rider is routed to it (CMMS → Store room → Edit pin) |
| The store's **business wallet** | the store is paid through it when the rider has collected the order |
| The store **sells in UGX** | rider fares are in UGX |

It also says how many products will be offered and why the others cannot be (no tax rate, kept out of dropshipping, no price, a
service). A product the owner already listed **by hand** in the Dropship dashboard is never touched - it is delivered as that
listing, as before.

## What the customer sees

On *Our products* the deliverable items say **We deliver this**. They tick what they want, then choose **Deliver it to me** (or pay /
pick up as before). The delivery cart is the one dropship listings already use: share the delivery location, choose a delivery
window and bike/car/van, pick a rider or let the nearest (the store's own rider first) be assigned, see the real fare, pay with the IcanEra
wallet (PIN) - or, without an account, Mobile Money / card / bank.

## How it works (so nobody is surprised)

* **Lent for one transaction.** When an order is placed, the store's products in it are handed to `dropship_checkout` as listings owned
  by the business itself, at the store price, and handed back before the transaction ends (`_site_delivery_lend` / `_site_delivery_return`).
  If anything fails the loan is rolled back with the rest. A loaned listing can never be seen by anyone else, and the tests check that
  none ever survives.
* `site_checkout_with_pin` = lend + `dropship_checkout_with_pin` (the PIN is checked there, as for every dropship order).
* `site_guest_checkout_start` = lend + `guest_checkout_start`. `guest_checkout_fulfil` (which runs when Flutterwave has confirmed the
  payment) is **patched in place** with the same two calls; the patch changes nothing else in it and is exactly reversed by the rollback.
* **Tax.** Dropship adds the product's tax on top of the price, as it does for every dropship order. The cart shows the server's exact
  total (items with tax, fare, total) before anyone pays. (The shop's pickup price is tax-inclusive; changing how dropship applies tax is a
  separate decision, as noted in `20261108100000_shop_checkout_tax_included.sql`.)
* **One store per order**, like every dropship order. Instalments are not offered on store products (they are built on dropship listings);
  they are paid in full.
* If the store later loses its pin, wallet or currency, delivery quietly stops being offered (the switch stays on and comes back by itself
  when it is fixed).

## Undo

`supabase/rollback/20261113_rollback_site_delivery.sql` removes the feature and puts `guest_checkout_fulfil` back to exactly the text it
had. No product, store, dropship listing or already-placed order is touched.

## Tests

* `supabase/tests/site_delivery/run.sh` - builds a throwaway Postgres, runs the real migration against the real `guest_checkout_fulfil`
  (cut out of `backend/ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql`) with dropship's checkout, PIN wrapper and rider ranking as stand-ins that refuse any
  product without an active listing, exactly like the real one. 68 checks: permissions, readiness, the storefront, wallet and guest orders,
  "nothing is ever left lent", a hand-made listing untouched, the patch applied once / left alone on a different function / reversed.
* `frontend/tests/siteDelivery.test.js` - the cart helpers and the owner's checklist.

Not covered by these tests (needs the real dropship tables, riders and wallets): an end-to-end order on a live project. After deploying, place
one small test order on a store product with delivery and check the rider is booked and the order appears with the store's other delivery orders.
