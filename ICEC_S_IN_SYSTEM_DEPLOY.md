# ICEC-S inside IcanEra (no blockchain, no gas, no operator)

One ICEC-S is worth one US dollar at the live rates in `public.ican_currency_rates`, the table icaneracoin's own price comes from (kept current by the hourly `ican-fx-request` / `ican-fx-apply` jobs and the Google-sheet feed). Like the coin it has an inflation floor:

    dollar value (UGX) = GREATEST( live USD rate , start value x (1 + Uganda inflation) ^ years since the anchor )

Every currency's price is that UGX value divided by the currency's live rate, so every wallet sees the same value.

## Deploy
1. Run `ICEC_S_IN_SYSTEM_PASTE_INTO_SUPABASE.sql` in the Supabase SQL editor (the two migrations, `20261024100000_icec_stable_in_system.sql` then `20261025100000_icec_stable_automatic.sql`). Safe to run twice.
2. Deploy the frontend. Wallet -> Trade -> **ICEC-S & C** works straight away. There is nothing to fund and no switch to press.

## How it works, user to user
- What buyers pay in becomes the **pool** (an insert-only UGX ledger). What sellers take out comes from it.
- The price of one ICEC-S is the smaller of **a dollar's worth** and the **pool's share per ICEC-S**. While the pool holds a dollar per ICEC-S (normal: every buy is paid in at the dollar value and fees stay in the pool) the price is the dollar value.
- If the shilling falls so sharply that the pool holds less than a dollar per ICEC-S, everyone holds the same smaller share until the rate recovers; the screen says so. New buyers are never diluting holders and nobody is paid ahead of anybody else, so the pool can always pay what it owes (tested with 300 random swaps through wild exchange rates).
- Swaps are refused whenever the currency rates are older than `rates_max_age_s` (default 3 h; the feed runs hourly).

## The honest limit
There is no company reserve behind it, so the dollar is **not guaranteed**: it is a dollar as long as the pool covers it. An administrator can optionally top the pool up (dev panel -> ICEC-S -> Pool); that only ever helps holders. Nothing can be taken out of the pool while anyone holds ICEC-S. The dev panel's Pause button is an emergency stop only.

Tests: `supabase/tests/stable_unit/run.sh` (38 checks) and `frontend/tests/stableUnitRules.test.js`.
