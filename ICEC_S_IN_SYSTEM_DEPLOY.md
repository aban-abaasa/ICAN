# ICEC-S inside IcanEra (no blockchain, no gas, no operator)

One ICEC-S is worth one US dollar at the live rates in `public.ican_currency_rates`, the table icaneracoin's own price comes from (kept current by the hourly `ican-fx-request` / `ican-fx-apply` jobs and the Google-sheet feed). Like the coin it has an inflation floor:

    dollar value (UGX) = GREATEST( live USD rate , start value x (1 + Uganda inflation) ^ years since the anchor )

Every currency's price is that UGX value divided by the currency's live rate, so every wallet sees the same value.

## Deploy
1. Run `ICEC_S_IN_SYSTEM_PASTE_INTO_SUPABASE.sql` in the Supabase SQL editor (the five migrations in order: `..._in_system`, `..._automatic`, `..._dollar_pool`, `..._global_currencies`, `20261028100000_icec_stable_cash_out_fee.sql`). Safe to run twice.
2. Run `supabase/migrations/20261029110000_icec_stable_minute_history.sql` (the chart's history: a point every minute for the last 24 hours, hourly before that; needs `pg_cron` enabled for the every-minute job). Safe to run twice.
3. Deploy the frontend. Wallet -> Trade -> **ICEC-S & C** works straight away. There is nothing to fund and no switch to press.

## How it works, user to user, held in dollars
- Whatever a buyer pays, in any wallet currency, is converted at the live rate and **held in the pool as US dollars**. A seller's dollars come out of the pool and are paid into the wallet at the live rate.
- One ICEC-S is owed one dollar (a little more when the inflation floor is above the plain dollar rate). The pool and what it owes are in the **same unit**, so the shilling falling or rising changes neither: the hedge is the pool itself.
- The price is the smaller of the full value and the **pool's dollars per ICEC-S**. Fees stay in the pool, so the pool per ICEC-S only rises. A new buyer never dilutes a holder and nobody is paid ahead of anybody else (tested with 300 random swaps through wild exchange rates).
- Swaps are refused whenever the currency rates are older than `rates_max_age_s` (default 3 h; the feed refreshes at least hourly).

## Fees: none to buy, one cash-out fee, paid to GODMINDERA ORGANISATION
- **Buying is free.** Everything paid goes into the pool.
- **Cashing out costs 3%** (`fee_bps`, default 300), the same single cash-out fee the rest of IcanEra uses (`backend/ICAN_FEE_STRUCTURE_UPDATE.sql`).
- **The fee goes to the platform fee business**, the recipient every platform fee already uses (`ican_platform_fee_recipient`, read through `fn_get_platform_fee_business_id()`), which is **GODMINDERA ORGANISATION (U) LTD** (formerly IWOS; the same company whose public notice board is `/notices/7a61ac98-...`). It is credited in ICEC at the live coin price through `fn_credit_platform_fee_to_business`, once per swap (the reference is the swap's id).
- **It cannot be lost.** If the credit cannot be made for any reason (no recipient configured, no live coin price, an error) the fee stays in the pool, and the seller is charged exactly the same. The dev panel's *Reconcile the books* shows the total paid to the organisation.
- To point fees somewhere else later, change `ican_platform_fee_recipient` (every platform fee follows it).

## Global: every country's currency
- The live rate table covers about 120 currencies (pounds, yen, euros, rupees, ...). `ican_country_currency_map` says which currency each country uses, i.e. the country a person picks at sign-up, and the screen opens on **that** currency ("GBP (your country)").
- A person whose currency has no wallet row yet (a new UK or Japan user has UGX/KES/USD only) gets an empty wallet in it the first time they sell into it. A buy still needs money that is really there.
- Money is cut to the decimals the currency really has: whole yen (also won, dong, rupiah, CFA francs), three places for dinars, two for pounds, euros and shillings.

## The honest limit
There is no company reserve behind it. The shilling cannot hurt it, but the pool is only what holders paid in: if the inflation floor sits above a plain dollar the pool can hold slightly less than the full value, and then the price is the pool's share (the screen says so). Nothing is guaranteed beyond the pool. An administrator can optionally top it up (dev panel -> ICEC-S -> Pool, in UGX, held as dollars); that only ever helps holders. Nothing can be taken out of the pool while anyone holds ICEC-S. The dev panel's Pause button is an emergency stop only.

Tests: `supabase/tests/stable_unit/run.sh` (66 checks) and `frontend/tests/stableUnitRules.test.js`.
