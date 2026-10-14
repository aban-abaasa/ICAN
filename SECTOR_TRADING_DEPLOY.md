# IcanEra Sector Markets: deploy guide

Ten sector index coins (`iAGRI`, `iTRNS`, `iRETL`, `iSOCL`, `iHLTH`, `iEDUC`, `iFINC`, `iCNST`, `iHOSP`, `iTECH`) traded with icaneracoin. Each index follows the **anonymous, combined sales totals** of the businesses in that sector on IcanEra. You trade against a clearing vault. **Trading ships OFF.**

## Deploy (Supabase SQL editor, in this order)

1. `supabase/migrations/20261019100000_sector_trading_core.sql`
2. `supabase/migrations/20261019110000_sector_trading_telemetry.sql`
3. `supabase/migrations/20261019120000_sector_trading_index.sql`
4. `supabase/migrations/20261019130000_sector_trading_execute.sql`
5. Deploy the frontend.

Every file is safe to run twice, and an administrator's settings, sector names and category map survive a re-run. The app works at every step: the **Sector Markets** tab hides itself until file 3 is installed, and nothing changes for businesses until file 2 is.

File 3 also schedules a 5-second fold with `pg_cron` (needs pg_cron 1.5+; skipped quietly otherwise, in which case viewers and trades fold on demand).

Optional: `VITE_SECTOR_PUSH=true` at build time makes open screens refresh within about a second instead of at the next 4-second poll. Off by default because it holds one Realtime connection per open screen.

## Before you turn trading on

Nothing below is code. Trading must stay OFF until all of it is true.

1. **The data clause has been read by a lawyer.** The wording is data (`icanera_trading.data_terms_text`, version 1) and **is a draft**. Check it against Uganda's Data Protection and Privacy Act 2019. A tick-box in the Terms & Conditions is a weaker basis than a separate opt-in, so the wording matters.
2. **The regulatory position is settled** for a product where the platform is the counterparty to users' bets on sector performance (Capital Markets Authority / Bank of Uganda).
3. **Each sector you want open has enough businesses.** A sector stays "Opening soon" until `k_min` (default 10) businesses are contributing, so no single business can be identified from its sector's total. Check the dev panel's Sector Markets tab.
4. **The vault is funded** and the stress margin is set conservatively (see "The vault" below).
5. You have run `supabase/tests/sector_trading/run.sh` against a copy of production-shaped data and read the throughput line.

Then: dev panel → **Sector Markets** → *Turn ON*. Or in SQL: `UPDATE icanera_trading.sector_settings SET trading_enabled = TRUE;`

## How it works

**Revenue in.** Every customer sale that lands in a business wallet goes through `ican_settle_business_wallet_income()` and leaves one row in `ican_business_wallet_settlements`. A trigger on that table (`pos_sale` rows only) drops one small event into an insert-only outbox: the sector, the amount in UGX, and a keyed hash of the business. It never names the business or the customer. Investments, refunds and other income are not counted. The trigger swallows every error, so it can never fail or block a sale.

**Consent.** A business contributes only after someone who manages it has accepted the current version of the data clause. New business accounts must tick it (`BusinessProfileForm`); existing businesses are asked once, with *I agree* / *Not now* (`SectorDataTermsGate` in Pitchin). Until a business agrees it is simply left out of the totals; nothing else about its account changes. Changing the wording = add a row to `data_terms_text`, then raise `current_terms_version`; every business is asked again.

**The index.** Per sector, over a trailing window (24 h): each business's revenue is summed and capped at 3x the sector median, and the index is the mean of those capped figures (revenue per active business), smoothed over time and expressed as a level that is 100 on the day the sector opened. A circuit breaker limits how fast it can move per hour. One folder worker does this, at most once per 2 seconds however many people ask.

**Trading.** `ican_sector_trade` is one atomic, idempotent, server-priced step: who is trading comes from the session, the price is the sector's current index price, both wallet rows are locked before anything is checked, and a retry with the same request id moves nothing. Buy: the fee comes off, the rest becomes units at the index price. Sell: units x price, less the fee. Pay in ICEC or any wallet currency the user holds (converted at the server's coin price and FX).

**Sector trades are not written to `ican_coin_transactions`.** The ICEC price engine counts every completed row there as usage, so booking sector trades there would let someone move the coin's price by churning them. Sector activity has its own immutable ledger (`sector_fills`) and the vault ledger. A side effect: these trades do not appear in the wallet's ICEC history; they appear in the Sector Markets tab.

## The vault

The vault is the counterparty. It is an insert-only ledger (`vault_entries`), not a balance row everyone updates, so trades by different users never queue on each other.

- A **buy** is refused (`capacity_reached`) unless the vault would still cover everything users hold even if every index rose by `stress_pct` (default 50%): `vault >= owed x 1.5`.
- A **sell** is refused (`vault_insufficient`) if the vault cannot pay it. There are no IOUs.
- Two buys by different users can pass the stress check at the same instant; the worst over-admission is (trades in that instant x `max_trade_icec`), which is what the margin is for.
- An operator withdrawal that would break the margin is refused. Every movement is a permanent entry with a reason.
- Fund it from the dev panel (*Vault*) or `SELECT public.ican_sector_dev_vault_adjust('<dev token>', 1000, 'opening balance');`

## Controls

Dev panel → **Sector Markets**: kill switch, vault, halt/hide a sector, every setting, the category-to-sector map, and *Reconcile the books* (recomputes the vault and everyone's holdings from the immutable ledgers and compares them with the caches; run it after any incident).

```sql
-- pause every buy and sell at once, and resume
UPDATE icanera_trading.sector_settings SET trading_enabled = FALSE;
UPDATE icanera_trading.sector_settings SET trading_enabled = TRUE;
```

Which businesses feed which sector comes from the business's category (`business_profiles.metadata->>'category_key'`, falling back to `business_type`); churches are recognised by the same rule the tithe feature uses and go to `iSOCL`. Government and "other" businesses are unmapped on purpose. The map is editable in the dev panel.

## What was measured

`supabase/tests/sector_trading/run.sh` (needs Postgres 14+ and `pgbench`), on a 4-core shared sandbox, one run:

- 230 database checks pass, then every migration is re-applied, then both rollbacks and a clean re-install are exercised.
- **Sales hook:** adds about 0.5 ms to recording a sale (0.3 ms to 0.8 ms single session). The sale never fails because of it (tested with the outbox broken, the coin price missing, and the pseudonym secret deleted).
- **Outbox:** about 9,000 sales/s dropped in while the folder runs; every sale is counted exactly once, including one whose transaction commits late.
- **Trades:** 120 concurrent attempts to spend a balance that funds 3 -> exactly 3 succeed; one request id sent 40 times -> one trade; 30 sessions selling the same units -> exactly the units held are sold; **100 users trading at once (about 1,400 trades/s): total ICEC in wallets + vault is identical before and after, to the last digit, and the books reconcile.** A coin trade and a sector trade by the same person at once never deadlock.

Frontend: `cd frontend && npm test` (adds `tests/sectorTradeRules.test.js`, which holds the preview maths to the same numbers the database tests assert).

## Rollback

`supabase/rollback/20261019_rollback_sector_trading.sql` stops trading, removes the revenue hook, the `ican_sector_*` functions and the scheduled jobs, and **keeps every ledger**. Nobody's ICEC moves. Only after users are made whole, `20261019_rollback_sector_trading_DROP_DATA.sql` deletes the schema; it refuses while any user still holds units.

## Known limits, and what is not built

- **Self-purchases cannot be excluded.** The settlement row does not say who paid, so a business owner buying from their own business counts as revenue. The 3x-median cap per business and the minimum number of businesses limit what one business can do to a sector, and wash-trading costs the owner real fees, but it is not impossible.
- **Only `pos_sale` settlements count as revenue.** That already covers card-QR, dropship and installment sales, because they all settle through the same function. Tithes and other income paths are counted only if they settle as `pos_sale`.
- **Sectors are only as good as their category data.** The ERA/CMMS category list has no agriculture or finance category of its own (farms are mapped from `farm` / `agriculture` / `agribusiness` keys if they exist; `sacco` / `insurance` / `bank` are mapped if a business uses them). Those sectors may stay "Opening soon" for a long time.
- **The stable inflation-indexed token (ICEC-S) is NOT built.** See the open question below.
- No on-chain anchoring. Ledgers are append-only and can be anchored later.
- No shorts, leverage or liquidations.

### Open question: the "inflation" token

The plan assumed the icaneracoin ledger price never falls below the per-currency inflation floor, so a reserve of locked ICEC would always cover an inflation-indexed token. That assumption does not hold: `ADD_ICAN_INFLATION_FLOOR_GUARANTEE.sql` applies the floor only where the shared UGX price is shown in a local currency, and says explicitly that it does not touch the shared ledger price that trades execute at. A token that promises inflation protection but is backed only by a floating coin would not deliver it. The options are: (A) a 1:1-locked token that can never pay out more than the ICEC locked, labelled honestly as "tracks the inflation reference, never more than you locked"; (B) a platform-funded guarantee reserve, which is a real liability and carries regulatory weight; (C) leave it for later.
