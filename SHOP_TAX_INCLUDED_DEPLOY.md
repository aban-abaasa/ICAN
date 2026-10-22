# Shop checkout: tax is included in the selling price, never added on top

`products.selling_price` already contains the tax, and the shop apps show the shelf price as the total ("Selling prices already
include tax"). The `customer_self_checkout` deployed in the live project still **added** tax on top, so a UGX 10,000 product with 18%
tax cost the customer **11,800** while the screen said 10,000.

| 3 × UGX 10,000 (18% tax) | before | now |
|---|---|---|
| Customer pays | **35,400** | **30,000** |
| of which tax | 5,400 (added) | 4,576.27 (inside the price) |
| Net subtotal | 30,000 | 25,423.73 |
| A product with no tax | 30,000 | 30,000 (unchanged) |

The receipt, the transaction, the line items (which now record the tax inside the line) and the ICAN the store receives all follow the
new total. Orders already placed are not touched.

## Deploy

Run **`SHOP_TAX_INCLUDED_PASTE_INTO_SUPABASE.sql`** (same file as `supabase/migrations/20261108100000_shop_checkout_tax_included.sql`) in
the SQL editor. No website or Edge Function change. It is independent of `SALE_PLATFORM_FEES_PASTE_INTO_SUPABASE.sql`: run them in either
order, or only one of them. Safe to run twice.

It **patches the deployed function in place** rather than running `FIX_CUSTOMER_SELF_CHECKOUT_TAX_INCLUSIVE.sql`, because that file would also
undo changes the live function already has (shop points, the store on the receipt) and brings multi-currency pricing. Every piece of text
it replaces must be found exactly once; otherwise it stops with a message and changes **nothing**. If the function is already tax-included
it says so and does nothing.

Roll back with `supabase/rollback/20261108_rollback_shop_checkout_tax_included.sql` (tax goes back on top).

## Not covered

**Dropship** also adds tax on top of the reseller's price (in `dropship_checkout`, the guest-checkout quote and the installment pricing,
which must all agree). Making it tax-included changes what stores and resellers are paid, and the VAT inside a reseller's markup has to come
out of someone's share, so it is a separate decision.

## Tests

`supabase/tests/shop_tax/run.sh` — a throwaway Postgres (`psql`, nothing touches Supabase). It runs the real migrations against the checkout
exactly as deployed live (`supabase/tests/sale_fees/fixtures/`), in both orders with the sale-fee migration, plus rollback, running twice,
an unknown function shape (refused, nothing changed) and the repo's own already-tax-included copy (left alone).
