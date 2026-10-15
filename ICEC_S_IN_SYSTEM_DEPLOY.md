# ICEC-S inside IcanEra (no blockchain, no gas)

One ICEC-S is worth one US dollar at the live rates in `public.ican_currency_rates`, the table icaneracoin's own price comes from (kept current by the hourly `ican-fx-request` / `ican-fx-apply` jobs and the Google-sheet feed). Like the coin it has an inflation floor:

    value (UGX) = GREATEST( live USD rate , start value x (1 + Uganda inflation) ^ years since the anchor )

Every currency's price is that UGX value divided by the currency's live rate, so every wallet sees the same value.

## Deploy
1. Run `supabase/migrations/20261024100000_icec_stable_in_system.sql` in the Supabase SQL editor (or paste `ICEC_S_IN_SYSTEM_PASTE_INTO_SUPABASE.sql`). Safe to run twice; nothing moves money until step 3.
2. Deploy the frontend. Wallet -> Trade -> **ICEC-S & C** now shows the in-system ICEC-S. ICEC-C (the blockchain receipt) is unchanged and hides until a chain is set up.
3. Dev panel -> **ICEC-S**: record the UGX you really hold in reserve (*Vault*), check the fee and limits, then *Turn ON*. Swaps ship **OFF**.

## What keeps the dollar promise honest
- A **buy** is refused unless the vault would still cover every ICEC-S in circulation after the stress margin (default +25%). An unfunded vault means no buys.
- A **sell** is paid from the vault; if it cannot pay, nothing is sold.
- Swaps are refused whenever the currency rates are older than `rates_max_age_s` (default 3 h; the feed runs hourly).
- If the shilling weakens sharply, what holders are owed in UGX rises; the margin is there for that, and new buys pause when it is used up. Watch the *Cover* figure in the dev panel.
- The vault and fills are insert-only ledgers; *Reconcile the books* recomputes everything from them.

Tests: `supabase/tests/stable_unit/run.sh` (36 checks) and `frontend/tests/stableUnitRules.test.js`.
