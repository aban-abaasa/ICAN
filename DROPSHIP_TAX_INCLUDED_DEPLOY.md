# Dropship: tax is included in the selling price, everywhere

`products.selling_price` already contains the tax (the cashier portal, the shop apps and - since
`20261108100000_shop_checkout_tax_included.sql` - the shop checkout all treat it that way). Dropship still **added the tax on top**:
a UGX 10,000 product with 18% VAT cost the customer 11,800 while the storefront, the cart and the website's Market all said
10,000. Instalments and the Mobile Money / card / bank quote copied that maths.

After this change a dropship customer pays **exactly the price they were shown** (plus the rider's fare, as before).

| Line (quantity q) | Before | After |
|---|---|---|
| Customer pays | listed x q + 18% tax on top | **listed x q** |
| Store receives | selling x q + the tax on top | **selling x q** (the tax inside it is the store's) |
| Reseller keeps | (listed - selling) x q | unchanged |
| Example, 2 x listed 12,500 (shelf 10,000, 18% VAT) | customer 29,500, store 24,500, reseller 5,000 | customer **25,000**, store **20,000**, reseller 5,000 |

With no markup the customer pays the shelf price. The delivery fare, the rider's pay, the delivery subsidy and the ICANera sale fee
rules are untouched (the fee's base is simply the goods total, now without tax on top).

## Turn it on (one step)

Supabase → SQL editor → paste **`DROPSHIP_TAX_INCLUDED_PASTE_INTO_SUPABASE.sql`** → Run.
(Same file as `supabase/migrations/20261114100000_dropship_tax_included.sql`. Safe to run twice, and in either order with the sale-fee
migration.)

It patches four functions **in place**, from whatever version is deployed - the way the sale-fee and shop-tax migrations do:

| Function | What it is |
|---|---|
| `dropship_checkout` (the 11-argument one) | the order itself |
| `guest_checkout_start` | the Mobile Money / card / bank quote - must equal the order |
| `_inst_price_cart` | instalment pricing - must equal the order |
| `_inst_record_sale` | the receipts an instalment sale writes |

Every piece of text it replaces must be found **exactly once**. If any of the four is not the version it was written for, it stops
with a message and **changes nothing** (all four are checked before any is touched). Guest checkout and instalments are skipped if they
are not installed. The website code needs no change.

## What happens to things already in flight

* **Sales already made**: untouched.
* **Instalment plans already open** keep the amounts they were started with (tax on top); each plan is consistent with itself and its
  receipts are written exactly as before. New plans carry `tax_inclusive` on every line. A plan *delivered* after this goes live is
  simply charged less by dropship, and the difference stays in the customer's wallet.
* **A guest order started before and paid after**: charged less; guest checkout hands the difference back, as it already does when a fare
  comes in under its quote.

## Check it worked

```sql
-- place one small dropship order, then:
select wholesale_amount, reseller_margin_amount, customer_paid_amount, real_transport_fare
from public.dropship_orders order by created_at desc limit 1;
-- wholesale + margin + delivery fare = customer_paid_amount   (no tax on top)
```

## Undo

`supabase/rollback/20261114_rollback_dropship_tax_included.sql` puts all four functions back to exactly the text they had. It **refuses**
while an instalment plan started after this change is still open (its store receipt would count the tax twice) - let those finish, then
roll back. Sales made in between keep what they were charged.

## Tests

`supabase/tests/dropship_tax/run.sh` - a throwaway Postgres running the **real** `dropship_checkout`, `guest_checkout_start`,
`_inst_price_cart` and `_inst_record_sale` (cut out of the repo files), 61 checks in three scenarios: the tax migration then the fee
migration; the fee migration then the tax migration; a project without guest checkout or instalments. It checks the customer's charge
to the shilling, every settlement leg, the order record, the transaction, both receipts and the sale items; that the guest quote and
instalment pricing equal the order; that plans started before the change are recorded as they always were; the all-or-nothing refusal;
a second run; the rollback restoring every function's text exactly, and refusing while a new-style plan is open.
