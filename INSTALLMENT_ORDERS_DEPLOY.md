# Installment orders — pay in instalments, then collect or have it delivered

Customers can pay for storefront / business-website products over several weeks, then collect the order at the store
or have it delivered once it is paid in full. Works on every dropship storefront (the ICAN storefront, the business
website's Shop tab, and — through the same database — mybodaguy and SupermartKera).

## Deploy (in this order)

1. Run `INSTALLMENT_ORDERS_PASTE_INTO_SUPABASE.sql` (same file as `supabase/migrations/20261011100000_installment_orders.sql`)
   in the Supabase SQL editor. It needs the dropship, delivery-receipt and guest-checkout SQL already applied, and says so if not.
   Safe to run twice; it never overwrites settings you changed.
2. `supabase functions deploy installment-pay` (uses the `FLUTTERWAVE_SECRET_KEY` secret the other payment functions use;
   `verify_jwt = false` is already set in `backend/components/supabase/config.toml`).
3. Deploy the frontend.

## How it works

- A plan needs a free IcanEra account (created in place on any site). Registering on a business website makes the person
  that business's customer: they track plans and payments in **My account** on the site (and `/plans`), the business sees them in
  **Instalments → Customers** in its dropship dashboard, and can switch customer accounts off there.
- The deposit is taken at once and the items are **reserved**. Money paid in is held inside the plan — credited to nobody — until the
  order is collected or delivered.
- **Collect**: the customer gets a pickup QR/code. The store's scan (the same receipt scan used for deliveries) hands the order over and
  releases the store's and reseller's money.
- **Delivery**: the customer is quoted the real BodaGoera fare, pays it, and the normal `dropship_checkout` runs as the customer
  (rider booking, escrow, delivery window, refund rights all as usual).
- Price lock: while a plan is open, its listing can't be raised in price or switched off. A plan unpaid after its last due date + 7 days
  lapses; the stock is released and the money returns to the wallet less a 5 % fee to the seller (no fee in the first 24 h, or if the seller cancels).

## Settings (plain `UPDATE`)

```sql
UPDATE public.installment_config SET value = '30' WHERE key = 'min_deposit_pct';   -- default 20
-- keys: min_order_ugx, min_deposit_pct, min_payment_ugx, max_installments, max_plan_days, grace_days,
--       cancel_fee_pct, cooling_off_hours, deposit_hold_hours
```
The Mobile Money / card / bank processing fee is the existing `guest_checkout_config.gateway_fee_pct`.

## Not included: cash

A cash instalment would have to be credited from the seller's business wallet, and `pitchin_business_wallet_transfer` always waits for
the owners' approval, so it can't be applied instantly without bypassing the wallet's PIN / approval controls. Cash is therefore not offered.

## Checks

`supabase/tests/installments/run.sh` runs 140 database checks against a throwaway Postgres (coin conservation, stock reservation, price lock,
both payment rails, pickup release, delivery, cancel/lapse, access control, grants, re-run safety, rollback).
Rollback: `supabase/rollback/20261011_rollback_installment_orders.sql` (refuses while any plan holds money).
