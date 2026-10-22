# Sale fees: what ICANera takes when a business makes a sale

| Sale | Fee | Paid by | Taken from |
|---|---|---|---|
| **Dropship** — however the customer pays (wallet, mobile money, installments) | **2%** of the goods | the **reseller** | their markup |
| **Digital City Era store sale** paid from an IcanEra wallet (the shop's self-checkout) | **1%** of the order | the **store** | what the store receives |

**The customer never pays it.** They pay the shelf price / the quote they were shown — not a coin more. (Before this, the shop
added an **8% surcharge on top of the customer's total**. That is gone for shop orders; rides still use that setting.)

## What it looks like

**Dropship** — UGX 10,000 × 2, the reseller lists it at 12,500, delivery UGX 6,000. Customer pays **UGX 35,500**, as before.

| | before | now |
|---|---|---|
| Store (wholesale + VAT) | 24,500 | 24,500 |
| Rider (delivery) | 6,000 | 6,000 |
| Reseller | 5,000 | **4,410** |
| ICANera | — | **590** (2% of the 29,500 goods; delivery is not part of it) |

**Shop** — UGX 10,000 × 3 = **UGX 30,000** (6 ICAN).

| | before | now |
|---|---|---|
| Customer pays | 6.48 ICAN (6 + 8%) | **6 ICAN** |
| Store receives | 6 | **5.94** |
| ICANera | 0.48 (from the customer) | **0.06** (from the store) |

## Change a rate

**From the developer panel** (no SQL, no redeploy): open the Dev Console, tab **Sale fees**, type the new percentage (up to four
decimals, `0` switches it off) and Save. It asks you to confirm, and asks twice above 10% so a typo like 20 for 2 does not go through
on one click. The change applies from the next sale and is written to a record (`ican_fee_rate_changes`: which fee, old → new, who,
when), which the tab shows. Needs `SALE_FEES_DEV_PANEL_PASTE_INTO_SUPABASE.sql` (run after the fees SQL) and a website deploy.

Only the two sale fees can be changed there. The wallet fees (sending money out, cashing out) stay a SQL-editor change.
It works only from the **allowlisted developer account** (`ican_dev_operators`): the dev token alone is not enough, because a
support-console link hands its visitor that token. The tab is never offered to a support link either.

**Or in SQL**, as before:

```sql
UPDATE public.ican_fee_rates SET rate = 0.025 WHERE key = 'dropship_sale';   -- 2.5%
UPDATE public.ican_fee_rates SET rate = 0     WHERE key = 'store_sale';      -- free
```
(A change made in SQL does not appear in the panel's record.)

Takes effect on the next sale. A rate is a fraction from 0 up to (not including) 1; the table refuses anything else. A deleted
row falls back to the default (2% / 1%), never to "free".

## The rules worth knowing

- **A reseller is never charged more than the sale earned them.** The fee comes out of the markup *after* any delivery subsidy and
  is capped at what is left. Thin markup → a smaller fee; no markup → no fee. The store's wholesale money and the rider's fare are
  never touched. This also means a "free delivery" listing that spends the whole markup on the rider pays no fee on that sale.
- **ICANera is paid when the store and reseller are**: the dropship fee is one more settlement leg, released by the seal scan.
- **No fee-recipient business configured** (`ican_platform_fee_recipient`) → nothing is taken. A fee with nowhere to go is not charged.
- A reseller's recorded margin (`dropship_orders.reseller_margin_amount`, the "+UGX …" on their Sales tab) is now what they actually
  keep. The fee and the rate it was charged at are on the order: `platform_fee_amount`, `platform_fee_rate`.

## Heads-up: the live shop checkout adds tax on top of the shelf price

The `customer_self_checkout` deployed in the live project is an older one than `backend/FIX_CUSTOMER_SELF_CHECKOUT_TAX_INCLUSIVE.sql`:
it **adds tax on top** of the shelf price (an 18% product at UGX 10,000 costs the customer 11,800). This migration works with both and
changes neither: the 1% is simply 1% of whatever total the customer is charged. The tax fix is its own migration,
`SHOP_TAX_INCLUDED_PASTE_INTO_SUPABASE.sql` (see `SHOP_TAX_INCLUDED_DEPLOY.md`); the two can be run in either order.

## Not covered (separate money flows that say "no fee" in their own code and tests)

Cash / card / mobile-money tenders rung up at a shop till, and the IcanEra digital card paid at a till (`imc_pay_with_card`, which
promises "the store receives the full sale amount"). If those should carry the 1% too, say so and it is a follow-up.

## Deploy

1. Make sure these have been run before (it stops with a message if one is missing): `FEE_RATES_PASTE_INTO_SUPABASE.sql`,
   `ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql`, `ADD_DROPSHIP_SMART_TRANSPORT.sql`, `DCE_CUSTOMER_SELFCHECKOUT.sql`.
2. Run **`SALE_PLATFORM_FEES_PASTE_INTO_SUPABASE.sql`** (same file as `supabase/migrations/20261107100000_sale_platform_fees.sql`)
   in the SQL editor. Safe to run twice; it never overwrites a rate you have changed.
3. Deploy the website (the reseller's Sales tab shows "after the 2% ICANera fee", and the Dev Console gets its **Sale fees** tab).
   To change the rates from the panel also run `SALE_FEES_DEV_PANEL_PASTE_INTO_SUPABASE.sql` (see above). No Edge Function changes.

It **patches `dropship_checkout` and `customer_self_checkout` in place** from whatever is deployed (the way
`FIX_SELF_CHECKOUT_POINTS_AND_ADMIN_HISTORY.sql` already does), so it keeps whatever later changes those functions have. Every piece
of text it replaces must be found exactly once in each; if not, it stops with a message naming the piece and **changes nothing** —
it never overwrites a version it was not written for. Customers keep exactly the same access to both functions.

## See what ICANera earned

```sql
-- dropship (per order, with the rate it was charged at)
select date_trunc('day', created_at) d, sum(platform_fee_amount) ugx, count(*) filter (where platform_fee_amount > 0) orders
  from public.dropship_orders group by 1 order by 1 desc;

-- shop sales (credited as platform fees, like sell/payout fees)
select date_trunc('day', created_at) d, sum(amount_ican) ican
  from public.ican_business_wallet_settlements
 where settlement_type = 'platform_fee' and metadata->>'fee_type' = 'supermarket_order_fee' group by 1 order by 1 desc;
```

(Dropship fees reach ICANera's wallet through the shared pickup release, so they appear there as an ordinary settlement with the note
"ICANera dropship fee | receipt …" rather than as a `platform_fee` row — report them from `dropship_orders`.)

A delivery refunded after pickup (the rider never delivered) is recovered from the **rider** for the whole order value, which now
includes the fee; the store, the reseller and ICANera keep what the seal scan released to them. That is how that refund already works.

## Roll back

`supabase/rollback/20261107_rollback_sale_platform_fees.sql` puts both functions back as they were (the shop's 8% customer surcharge
returns with it), removes the two rates and the helper, and keeps the `platform_fee_*` columns so past orders keep their record.

## Tests

`supabase/tests/sale_fees_panel/run.sh` covers the panel's two functions (a change reaches both real checkouts, a wrong caller is refused);
`frontend/tests/saleFees.test.js` covers the percentage handling. `supabase/tests/sale_fees/run.sh` — a throwaway Postgres (`psql`, nothing touches Supabase). It loads the **real** `dropship_checkout`
and `customer_self_checkout` text out of the backend files (and the older shape deployed live, saved as `fixtures/live_customer_self_checkout.sql`) and runs sales through them before and after the migration: the customer's
total is unchanged, every coin lands somewhere, the cap, the subsidy, 0%, a changed rate, no recipient, an unknown function shape
(refused, nothing changed), running twice, rollback and rollback → migrate again. Only the wallet / shop / rider tables are stand-ins.
