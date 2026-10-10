# icaneracoin live chart: safe under bursts

What happens to the live chart and to buying and selling when many people trade, send or watch at the same instant.

## What changed

| Area | Before | After |
| --- | --- | --- |
| Every money transaction | Recomputed the whole fair price (table scans) and queued on one shared candle row | Appends one row to a log. Nothing else on the money path |
| Candles and price | Rebuilt on every transaction and on every viewer poll | Folded once per 2 s by one worker (single-flight), then cached |
| Viewers | Each chart made 3 calls per poll, and each call recomputed | One call (`ican_get_public_feed`). A quiet market answers "unchanged" in a few bytes; a busy one sends only the newest candles |
| Chart polling | Fixed 20 s, hammered on errors | 4 s while the tab is visible, paused when hidden, backs off with jitter on errors |
| Chart badge | Always "Live" | Live / Connecting / Delayed / Offline, from the age of the last good answer |
| Buy and sell | Several browser round trips: read, compute in JS, write back (lost updates, double spend) | One atomic database call (`ican_trade_execute`): server price, server FX, locked wallets, all or nothing |
| Retries and double taps | Executed again | Same request id returns the first result and moves nothing |
| Booked orders | Could fill twice (two tabs) or at a worse price than the target | Fill exactly once; never worse than the order's target |
| Volume spoofing | `ican_record_price_tick(volume)` was callable by anyone | Closed to every API role |

Measured on a local 4-core Postgres 16 (`supabase/tests/icaneracoin_chart/run.sh`, `BURST=1`): 32 concurrent traders went from roughly 470-690 to roughly 21,000-23,000 transactions per second, and from 46-68 ms to about 1.4 ms average latency (two runs; your hardware will differ, the ratio is the point). Every transaction in a burst is accounted for in the candles (checked: inserted volume equals candle volume equals candle count, with viewers polling at the same time).

## Deploy (Supabase SQL editor, in this order)

1. `supabase/migrations/20261018100000_icaneracoin_burst_safe_feed.sql`
2. `supabase/migrations/20261018110000_icaneracoin_atomic_trade.sql`
3. Deploy the frontend.

Both files are safe to run twice, and an administrator's trading switches survive a re-run. The app works at every step: until file 1 is run the chart uses its old three calls, and until file 2 is run buying and selling use the old browser-side path (with a console warning).

File 1 also schedules a 5-second flush with `pg_cron` (needs pg_cron 1.5 or newer for second-level schedules; it is skipped quietly otherwise and viewers and trades flush on demand).

## Controls (SQL editor)

```sql
-- pause every buy and sell at once, and resume
UPDATE public.ican_trade_settings SET trading_enabled = FALSE;
UPDATE public.ican_trade_settings SET trading_enabled = TRUE;

-- per-user rate limit (default 60 trades a minute) and an optional ceiling per trade, in UGX
UPDATE public.ican_trade_settings SET max_trades_per_minute = 30, max_trade_ugx = 20000000;
```

## Optional: push updates instead of polling

The database already sends a tiny "something changed" ping (a version number, never prices) on `icaneracoin:price`. The chart ignores it unless `VITE_ICANERACOIN_PUSH=true` is set at build time, because it holds one Realtime connection per open chart, which counts against the project's connection quota. Leave it off until the quota is known to cover the audience. This part has not been exercised against a real Realtime server; polling is the tested path.

## Behaviour to know about

* A trade executes at the cached fair price, never older than 3 seconds, converted with `ican_currency_rates`. The Buy and Sell screens now load that same table for their previews, so what they show is what executes. (The browser's built-in rates were far from it, for example USD at 2,778 UGX against 4,089.)
* A buy or sell can now answer "the price moved" if the price got worse than the user's tolerance (1 % by default) between the screen and the trade. The screen shows the new price. Better prices are always accepted.
* The browser-side fallback is used only when `ican_trade_execute` is not installed. A dropped connection is retried with the same request id and never falls back.

## Tests

```bash
supabase/tests/icaneracoin_chart/run.sh        # needs Postgres 14+ and pgbench; BURST=1 adds the before/after numbers
cd frontend && npm test
```

The database suite covers grants, the tick path, folding, the freshness throttle, the feed's shapes, every trade rule, and real concurrency: 120 attempts to spend a balance that funds 3, one request id sent 40 times, 30 sessions selling 5 coins, and 100 users trading at once with every wallet reconciled against its own ledger.

## Rollback

`supabase/rollback/20261018_rollback_atomic_trade.sql` first, then `supabase/rollback/20261018_rollback_burst_safe_feed.sql`. Executed trades stay in the ledger. The tick function stays closed to API roles after the rollback.
