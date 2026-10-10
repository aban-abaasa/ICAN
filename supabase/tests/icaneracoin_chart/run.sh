#!/usr/bin/env bash
# Runs the icaneracoin live-chart and atomic-trade database tests against a throwaway Postgres database,
# including real concurrency tests (many sessions at once) with pgbench.
#
#   supabase/tests/icaneracoin_chart/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, with psql and pgbench on the PATH. Connection comes from
# the usual libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); nothing here touches your real Supabase project.
#   KEEP_DB=1   keep the database afterwards so you can look around
#   DB_NAME=x   use another database name (default ican_chart_test)
#   BURST=1     also print before/after throughput for a burst of transactions (takes ~40 s)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_chart_test}"
PRICE_ENGINE="$ROOT/frontend/backend/ICAN_PRICE_ENGINE.sql"
CANDLE_ENGINE="$ROOT/frontend/backend/ICAN_REAL_CANDLESTICK_ENGINE.sql"
PUBLIC_CHART="$ROOT/supabase/migrations/20261017100000_public_icaneracoin_chart.sql"
FEED="$ROOT/supabase/migrations/20261018100000_icaneracoin_burst_safe_feed.sql"
FEED_ROLLBACK="$ROOT/supabase/rollback/20261018_rollback_burst_safe_feed.sql"
TRADE="$ROOT/supabase/migrations/20261018110000_icaneracoin_atomic_trade.sql"
TRADE_ROLLBACK="$ROOT/supabase/rollback/20261018_rollback_atomic_trade.sql"
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
quiet() { "$@" >/dev/null 2>"$WORK/err.txt" || { grep -v NOTICE "$WORK/err.txt" >&2; return 1; }; }

build_db() { # $1 = database name; the repo's own engine, as it is today, on top of the stub
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$1\"" -c "CREATE DATABASE \"$1\"" >/dev/null 2>&1
  local p="psql -X -q -v ON_ERROR_STOP=1 -d $1"
  for f in "$HERE/00_stub.sql" "$PRICE_ENGINE" "$CANDLE_ENGINE" "$PUBLIC_CHART"; do
    $p -f "$f" >/dev/null 2>"$WORK/err.txt" || { grep -v NOTICE "$WORK/err.txt" >&2; echo "$(basename "$f") failed" >&2; exit 2; }
  done
}

build_db "$DB"
quiet psql_db -f "$FEED" || { echo "the feed migration failed" >&2; exit 2; }
psql_db -f "$FEED" >/dev/null 2>&1 || { echo "re-applying the feed migration FAILED" >&2; exit 1; }
quiet psql_db -f "$TRADE" || { echo "the trade migration failed" >&2; exit 2; }
psql_db -f "$TRADE" >/dev/null 2>&1 || { echo "re-applying the trade migration FAILED" >&2; exit 1; }
echo "migrations applied. re-applied both to prove they are safe to run twice."
# an administrator's switches must survive a re-run
psql_db -c "UPDATE public.ican_trade_settings SET max_trades_per_minute = 7, trading_enabled = FALSE" >/dev/null
psql_db -f "$TRADE" >/dev/null 2>&1
kept=$(psql_db -Atc "SELECT max_trades_per_minute || ',' || trading_enabled FROM public.ican_trade_settings")
[ "$kept" = "7,false" ] || { echo "re-applying the trade migration overwrote an administrator's setting ($kept)" >&2; exit 1; }
psql_db -c "UPDATE public.ican_trade_settings SET max_trades_per_minute = 60, trading_enabled = TRUE" >/dev/null
echo "an administrator's trading switches survive a re-run."

for f in "$HERE"/0[1-9]_*.sql; do
  echo "running $(basename "$f")"
  psql_db -f "$f" >/dev/null 2>"$WORK/test.err" || { grep -v NOTICE "$WORK/test.err" >&2; echo "$(basename "$f") aborted" >&2; exit 1; }
done

# ---------------------------------------------------------------- concurrency: traders + viewers at once
# Many sessions insert completed transactions while others poll the public feed. Every coin must be accounted for.
cat > "$WORK/trade.sql" <<'SQL'
INSERT INTO public.ican_coin_transactions (user_id, type, ican_amount, local_amount, status, transaction_type)
VALUES ('00000000-0000-0000-0000-000000000001', 'purchase', 1, 6000, 'completed', 'purchase');
SQL
echo "SELECT public.ican_get_public_feed(200, NULL, NULL);" > "$WORK/view.sql"
psql_db -c "TRUNCATE public.ican_coin_transactions, public.ican_price_ohlc, public.ican_price_ticks" >/dev/null
( pgbench -n -c 16 -j 4 -T 6 -f "$WORK/trade.sql" "$DB" >"$WORK/pg_trade.txt" 2>&1 ) &
( pgbench -n -c 8 -j 2 -T 6 -f "$WORK/view.sql" "$DB" >"$WORK/pg_view.txt" 2>&1 ) &
wait
psql_db -c "SELECT public.ican_flush_price_ticks(TRUE, TRUE)" >/dev/null
read -r rows vol cnt left <<<"$(psql_db -At -F ' ' -c "select (select count(*) from public.ican_coin_transactions), (select coalesce(sum(trading_volume),0) from public.ican_price_ohlc), (select coalesce(sum(transaction_count),0) from public.ican_price_ohlc), (select count(*) from public.ican_price_ticks)")"
tps=$(grep -E '^tps' "$WORK/pg_trade.txt" | awk '{print int($3)}')
vps=$(grep -E '^tps' "$WORK/pg_view.txt" | awk '{print int($3)}')
echo "burst: $rows transactions ($tps/s) while viewers polled the feed ($vps/s): candle volume $vol, candle count $cnt, ticks left $left"
[ "$rows" -gt 0 ] && [ "$vol" = "$rows" ] && [ "$cnt" = "$rows" ] && [ "$left" = "0" ] \
  || { echo "FAILED: the candles do not account for every transaction in the burst" >&2; exit 1; }
echo "every transaction in the burst is in the candles, none lost, none doubled."

# ---------------------------------------------------------------- single flight: a busy flusher is never queued behind
psql_db -c "UPDATE public.ican_price_cache SET refreshed_at = now() - interval '1 minute'" >/dev/null
psql_db -c "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('ican_flush_price_ticks', 0)); SELECT pg_sleep(2.5); COMMIT;" >/dev/null &
holder=$!
sleep 0.6
start=$(date +%s%N)
skipped=$(psql_db -Atc "SELECT public.ican_flush_price_ticks(FALSE, FALSE)")
ms=$(( ($(date +%s%N) - start) / 1000000 ))
[ "$skipped" = "f" ] && [ "$ms" -lt 800 ] || { echo "FAILED: a flush queued behind a running flush (answered '$skipped' after ${ms} ms)" >&2; kill "$holder" 2>/dev/null || true; exit 1; }
start=$(date +%s%N)
waited=$(psql_db -Atc "SELECT public.ican_flush_price_ticks(TRUE, TRUE)")
ms=$(( ($(date +%s%N) - start) / 1000000 ))
wait "$holder"
[ "$waited" = "t" ] && [ "$ms" -gt 1000 ] || { echo "FAILED: a trade-side flush did not wait for the running one (answered '$waited' after ${ms} ms)" >&2; exit 1; }
echo "a viewer's flush is skipped instantly while one is running; a trade's flush waits for it."


# ---------------------------------------------------------------- concurrency: the trade itself
# Raise the per-minute limit so the races below are about correctness, not throttling.
psql_db -c "UPDATE public.ican_trade_settings SET max_trades_per_minute = 1000000" >/dev/null
uid() { printf '00000000-0000-0000-0000-%012d' "$1"; }
trade_script() { # $1 user number, $2 side, $3 amount, $4 request id expression (SQL), writes the pgbench script to stdout
  cat <<SQL
\set rid random(1, 2000000000)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$(uid "$1")', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.ican_trade_execute('$2', $3, 'UGX', 'UG', $4, NULL, 5);
COMMIT;
SQL
}
pgb() { pgbench -n "$@" 2>&1; }
failed_of() { grep -E 'number of failed transactions' | sed -E 's/.*: ([0-9]+) .*/\1/'; }

psql_db -c "TRUNCATE public.ican_coin_transactions, public.ican_price_ohlc, public.ican_price_ticks, public.ican_trade_requests, public.ican_user_wallets, public.wallet_accounts" >/dev/null
psql_db -c "SELECT public.ican_flush_price_ticks(TRUE, TRUE)" >/dev/null

# 1. Many tabs, taps and retries at once, each a DIFFERENT request, all spending the same 100 UGX at 30 a time.
psql_db -c "INSERT INTO public.wallet_accounts (user_id, balance, currency) VALUES ('$(uid 20)', 100, 'UGX')" >/dev/null
trade_script 20 buy 30 "'race-buy-' || :rid" > "$WORK/race1.sql"
out=$(pgb -c 40 -j 4 -t 3 -f "$WORK/race1.sql" "$DB")
read -r wins cash ok <<<"$(psql_db -At -F ' ' -c "select (select count(*) from public.ican_coin_transactions where user_id='$(uid 20)'), (select balance from public.wallet_accounts where user_id='$(uid 20)'), (select (select ican_balance from public.ican_user_wallets where user_id='$(uid 20)') = (select sum(ican_amount) from public.ican_coin_transactions where user_id='$(uid 20)'))")"
echo "race 1 (120 attempts to spend 30 of a 100 balance): $wins succeeded, cash left $cash"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$wins" = "3" ] && [ "$cash" = "10" ] && [ "$ok" = "t" ] \
  || { echo "FAILED: a 100 balance was spent more than three times at 30, or coins and cash disagree" >&2; echo "$out" >&2; exit 1; }

# 2. The very same request sent 40 times at once (a double tap, a retrying network, two tabs).
psql_db -c "INSERT INTO public.wallet_accounts (user_id, balance, currency) VALUES ('$(uid 21)', 100000, 'UGX')" >/dev/null
trade_script 21 buy 30 "'same-request-0001'" > "$WORK/race2.sql"
out=$(pgb -c 40 -j 4 -t 1 -f "$WORK/race2.sql" "$DB")
read -r rows cash <<<"$(psql_db -At -F ' ' -c "select (select count(*) from public.ican_coin_transactions where user_id='$(uid 21)'), (select balance from public.wallet_accounts where user_id='$(uid 21)')")"
echo "race 2 (one request sent 40 times at once): $rows ledger row(s), cash left $cash"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$rows" = "1" ] && [ "${cash%.*}" = "99970" ] \
  || { echo "FAILED: one request id executed more than once" >&2; echo "$out" >&2; exit 1; }

# 3. Selling the same coins from 30 sessions at once: five coins can pay out five times, not thirty.
psql_db -c "INSERT INTO public.wallet_accounts (user_id, balance, currency) VALUES ('$(uid 22)', 0, 'UGX'); INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('$(uid 22)', 5)" >/dev/null
trade_script 22 sell 1 "'race-sell-' || :rid" > "$WORK/race3.sql"
out=$(pgb -c 30 -j 4 -t 1 -f "$WORK/race3.sql" "$DB")
read -r sold gone cashok <<<"$(psql_db -At -F ' ' -c "select (select count(*) from public.ican_coin_transactions where user_id='$(uid 22)'), (select ican_balance = 0 from public.ican_user_wallets where user_id='$(uid 22)'), (select (select balance from public.wallet_accounts where user_id='$(uid 22)') = (select coalesce(sum(local_amount),0) from public.ican_coin_transactions where user_id='$(uid 22)'))")"
echo "race 3 (30 sessions selling 1 coin each from a balance of 5): $sold paid out, all coins gone: $gone"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$sold" = "5" ] && [ "$gone" = "t" ] && [ "$cashok" = "t" ] \
  || { echo "FAILED: more coins were paid out than the seller owned" >&2; echo "$out" >&2; exit 1; }

# 4. A crowd: 100 users trading at random, 32 sessions, 8 seconds, while viewers poll the chart.
psql_db -c "INSERT INTO public.wallet_accounts (user_id, balance, currency) SELECT ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 1000000, 'UGX' FROM generate_series(100, 199) g;
            INSERT INTO public.ican_user_wallets (user_id, ican_balance) SELECT ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 1 FROM generate_series(100, 199) g;
            TRUNCATE public.ican_coin_transactions, public.ican_price_ticks, public.ican_price_ohlc, public.ican_trade_requests" >/dev/null
cat > "$WORK/crowd.sql" <<'SQL'
\set u random(100, 199)
\set side random(0, 1)
\set cash random(10, 400)
\set coin random(1, 40)
\set rid random(1, 2000000000)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(:u::text, 12, '0'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.ican_trade_execute(CASE WHEN :side = 0 THEN 'buy' ELSE 'sell' END, CASE WHEN :side = 0 THEN :cash ELSE :coin / 1000.0 END, 'UGX', 'UG', 'crowd-' || :rid, NULL, 50);
COMMIT;
SQL
( pgb -c 32 -j 4 -T 8 -f "$WORK/crowd.sql" "$DB" > "$WORK/crowd.out" ) &
( pgb -c 8 -j 2 -T 8 -f "$WORK/view.sql" "$DB" > /dev/null ) &
wait
psql_db -c "SELECT public.ican_flush_price_ticks(TRUE, TRUE)" >/dev/null
read -r trades off neg candles <<<"$(psql_db -At -F ' ' -c "
  with l as (select user_id,
      sum(case type when 'purchase' then -local_amount else local_amount end) as dcash,
      sum(case type when 'purchase' then ican_amount else -ican_amount end) as dcoin
    from public.ican_coin_transactions group by user_id)
  select (select count(*) from public.ican_coin_transactions),
         (select count(*) from public.wallet_accounts a join public.ican_user_wallets w using (user_id) left join l using (user_id)
           where a.user_id between '$(uid 100)' and '$(uid 199)'
             and (a.balance <> 1000000 + coalesce(l.dcash, 0) or w.ican_balance <> 1 + coalesce(l.dcoin, 0))),
         (select count(*) from public.wallet_accounts where balance < 0) + (select count(*) from public.ican_user_wallets where ican_balance < 0),
         (select coalesce(sum(transaction_count), 0) from public.ican_price_ohlc)")"
tps=$(grep -E '^tps' "$WORK/crowd.out" | awk '{print int($3)}')
echo "race 4 (100 users, 32 sessions): $trades trades ($tps/s), $off wallet(s) off from their own ledger, $neg negative balance(s), chart counted $candles"
[ "$(failed_of < "$WORK/crowd.out")" = "0" ] && [ "$trades" -gt 0 ] && [ "$off" = "0" ] && [ "$neg" = "0" ] && [ "$candles" = "$trades" ] \
  || { echo "FAILED: the crowd left a wallet that does not match its ledger, a negative balance, a failed transaction (deadlock?) or an uncounted trade" >&2; cat "$WORK/crowd.out" >&2; exit 1; }
echo "100 users trading at once: every wallet equals its own ledger to the last digit, nobody negative, no deadlocks, and the chart counted every trade."
psql_db -c "UPDATE public.ican_trade_settings SET max_trades_per_minute = 60" >/dev/null

# ---------------------------------------------------------------- optional: before / after
if [ "${BURST:-0}" = "1" ]; then
  build_db "${DB}_before"
  seed="ALTER TABLE public.ican_coin_transactions DISABLE TRIGGER ALL;
    INSERT INTO public.user_accounts (user_id, country_code, ican_coin_balance) SELECT gen_random_uuid(), 'UG', 1 FROM generate_series(1,5000);
    INSERT INTO public.ican_coin_transactions (user_id, type, ican_amount, local_amount, status, transaction_type) SELECT gen_random_uuid(), 'purchase', 1, 1000, 'completed', 'purchase' FROM generate_series(1,20000);
    ALTER TABLE public.ican_coin_transactions ENABLE TRIGGER ALL; ANALYZE;"
  psql -X -q -d "${DB}_before" -c "$seed" >/dev/null
  before=$(pgbench -n -c 32 -j 8 -T 10 -f "$WORK/trade.sql" "${DB}_before" | grep -E '^(tps|latency average)' | tr '\n' ' ')
  psql -X -q -v ON_ERROR_STOP=1 -d "${DB}_before" -f "$FEED" >/dev/null 2>&1
  after=$(pgbench -n -c 32 -j 8 -T 10 -f "$WORK/trade.sql" "${DB}_before" | grep -E '^(tps|latency average)' | tr '\n' ' ')
  echo "BEFORE: $before"; echo "AFTER:  $after"
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"${DB}_before\"" >/dev/null 2>&1
fi

# ---------------------------------------------------------------- rollback (trade first, then the feed)
psql_db -f "$TRADE_ROLLBACK" >/dev/null 2>"$WORK/rb.err" || { grep -v NOTICE "$WORK/rb.err" >&2; echo "trade rollback FAILED" >&2; exit 1; }
left=$(psql_db -Atc "select (select count(*) from pg_proc where proname = 'ican_trade_execute') + (select count(*) from information_schema.tables where table_name in ('ican_trade_requests','ican_trade_settings'))")
[ "$left" = "0" ] || { echo "trade rollback left $left object(s) behind" >&2; exit 1; }
kept=$(psql_db -Atc "select count(*) from public.ican_coin_transactions")
[ "$kept" -gt 0 ] || { echo "trade rollback removed the ledger rows" >&2; exit 1; }
echo "trade rollback leaves nothing behind and keeps every ledger row."
psql_db -c "INSERT INTO public.ican_coin_transactions (user_id, type, ican_amount, local_amount, status, transaction_type) VALUES ('00000000-0000-0000-0000-000000000001','purchase',3,18000,'completed','purchase')" >/dev/null
psql_db -f "$FEED_ROLLBACK" >/dev/null 2>"$WORK/rb.err" || { grep -v NOTICE "$WORK/rb.err" >&2; echo "rollback FAILED" >&2; exit 1; }
left=$(psql_db -Atc "select (select count(*) from pg_proc where proname in ('ican_flush_price_ticks','ican_current_price_ugx','ican_get_public_feed','ican_notify_price_change')) + (select count(*) from information_schema.tables where table_name in ('ican_price_ticks','ican_price_cache'))")
[ "$left" = "0" ] || { echo "rollback left $left object(s) behind" >&2; exit 1; }
# the old behaviour is back and works
psql_db -c "SELECT public.ican_ensure_current_candle(); SELECT * FROM public.ican_get_market_snapshot();" >/dev/null 2>&1 || { echo "the restored functions do not work" >&2; exit 1; }
anon_tick=$(psql_db -Atc "select has_function_privilege('anon', 'public.ican_record_price_tick(numeric)', 'EXECUTE')")
[ "$anon_tick" = "f" ] || { echo "rollback reopened ican_record_price_tick to anon" >&2; exit 1; }
echo "rollback restores the earlier functions (still closed to clients) and leaves nothing behind."
# and the migration applies cleanly again afterwards
psql_db -f "$FEED" >/dev/null 2>&1 || { echo "re-applying after a rollback FAILED" >&2; exit 1; }
echo "the migration applies again after a rollback."

read -r passed failed total <<<"$(psql_db -At -F ' ' -c "select count(*) filter (where ok), count(*) filter (where not ok), count(*) from t.results" 2>/dev/null || echo '0 0 0')"
if [ "${failed:-0}" != "0" ] || [ "${total:-0}" = "0" ]; then
  psql_db -c "select name, left(info, 300) as detail from t.results where not ok order by n" 2>/dev/null || true
  echo "FAILED: $failed of $total checks" >&2; exit 1
fi
echo "OK: $passed of $total database checks passed."
