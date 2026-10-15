# ICEC-S inside IcanEra (no blockchain, no gas, no operator)

One ICEC-S is worth one US dollar at the live rates in `public.ican_currency_rates`, the table icaneracoin's own price comes from (kept current by the hourly `ican-fx-request` / `ican-fx-apply` jobs and the Google-sheet feed). Like the coin it has an inflation floor:

    dollar value (UGX) = GREATEST( live USD rate , start value x (1 + Uganda inflation) ^ years since the anchor )

Every currency's price is that UGX value divided by the currency's live rate, so every wallet sees the same value.

## Deploy
1. Run `ICEC_S_IN_SYSTEM_PASTE_INTO_SUPABASE.sql` in the Supabase SQL editor (the three migrations in order: `20261024100000_icec_stable_in_system.sql`, `20261025100000_icec_stable_automatic.sql`, `20261026100000_icec_stable_dollar_pool.sql`). Safe to run twice.
2. Deploy the frontend. Wallet -> Trade -> **ICEC-S & C** works straight away. There is nothing to fund and no switch to press.

## How it works, user to user, held in dollars
- Whatever a buyer pays, in any wallet currency, is converted at the live rate and **held in the pool as US dollars**. A seller's dollars come out of the pool and are paid into the wallet at the live rate.
- One ICEC-S is owed one dollar (a little more when the inflation floor is above the plain dollar rate). The pool and what it owes are in the **same unit**, so the shilling falling or rising changes neither: the hedge is the pool itself.
- The price is the smaller of the full value and the **pool's dollars per ICEC-S**. Fees stay in the pool, so the pool per ICEC-S only rises. A new buyer never dilutes a holder and nobody is paid ahead of anybody else (tested with 300 random swaps through wild exchange rates).
- Swaps are refused whenever the currency rates are older than `rates_max_age_s` (default 3 h; the feed runs hourly).

## The honest limit
There is no company reserve behind it. The shilling cannot hurt it, but the pool is only what holders paid in: if the inflation floor sits above a plain dollar the pool can hold slightly less than the full value, and then the price is the pool's share (the screen says so). Nothing is guaranteed beyond the pool. An administrator can optionally top it up (dev panel -> ICEC-S -> Pool, in UGX, held as dollars); that only ever helps holders. Nothing can be taken out of the pool while anyone holds ICEC-S. The dev panel's Pause button is an emergency stop only.

Tests: `supabase/tests/stable_unit/run.sh` (42 checks) and `frontend/tests/stableUnitRules.test.js`.
