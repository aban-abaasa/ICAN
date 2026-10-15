#!/usr/bin/env bash
# Runs the sector-markets database tests against a throwaway Postgres database, including real concurrency
# tests (many sessions at once) with pgbench.
#
#   supabase/tests/sector_trading/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, with psql and pgbench on the PATH. Connection comes from
# the usual libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); nothing here touches your real Supabase project.
#   KEEP_DB=1   keep the database afterwards so you can look around
#   DB_NAME=x   use another database name (default ican_sector_test)
#
# The base is the repo's own icaneracoin stack (the same one the icaneracoin_chart tests build), so the sector
# code is tested against the real price engine, the real atomic trade and the real wallets, not copies of them.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_sector_test}"
CHART="$ROOT/supabase/tests/icaneracoin_chart"
MIG="$ROOT/supabase/migrations"
BASE_FILES=(
  "$CHART/00_stub.sql"
  "$ROOT/frontend/backend/ICAN_PRICE_ENGINE.sql"
  "$ROOT/frontend/backend/ICAN_REAL_CANDLESTICK_ENGINE.sql"
  "$MIG/20261017100000_public_icaneracoin_chart.sql"
  "$MIG/20261018100000_icaneracoin_burst_safe_feed.sql"
  "$MIG/20261018110000_icaneracoin_atomic_trade.sql"
  "$HERE/00_stub.sql"
)
SECTOR_MIGRATIONS=(
  "$MIG/20261019100000_sector_trading_core.sql"
  "$MIG/20261019110000_sector_trading_telemetry.sql"
  "$MIG/20261019120000_sector_trading_index.sql"
  "$MIG/20261019130000_sector_trading_execute.sql"
  "$MIG/20261023100000_sector_registered_businesses.sql"
)
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
quiet() { "$@" >/dev/null 2>"$WORK/err.txt" || { grep -v NOTICE "$WORK/err.txt" >&2; return 1; }; }

build_db() { # $1 = database name: the repo's icaneracoin stack as it is today, plus the business-side stubs
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$1\"" -c "CREATE DATABASE \"$1\"" >/dev/null 2>&1
  local f
  for f in "${BASE_FILES[@]}"; do
    psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$f" >/dev/null 2>"$WORK/err.txt" || { grep -v NOTICE "$WORK/err.txt" >&2; echo "$(basename "$f") failed" >&2; exit 2; }
  done
}

build_db "$DB"
for f in "${SECTOR_MIGRATIONS[@]}"; do
  quiet psql_db -f "$f" || { echo "$(basename "$f") failed" >&2; exit 2; }
done
# every migration must be safe to run again, and again must not undo what an administrator set
for f in "${SECTOR_MIGRATIONS[@]}"; do
  psql_db -f "$f" >/dev/null 2>&1 || { echo "re-applying $(basename "$f") FAILED" >&2; exit 1; }
done
echo "migrations applied. re-applied all of them to prove they are safe to run twice."
psql_db -c "UPDATE icanera_trading.sector_settings SET fee_bps = 77, k_min = 5, trading_enabled = TRUE" >/dev/null
psql_db -c "UPDATE icanera_trading.sector_catalog SET name = 'Farming' WHERE ticker = 'iAGRI'" >/dev/null
psql_db -c "DELETE FROM icanera_trading.sector_industry_map WHERE industry_value = 'farm'" >/dev/null
for f in "${SECTOR_MIGRATIONS[@]}"; do psql_db -f "$f" >/dev/null 2>&1; done
kept=$(psql_db -Atc "SELECT fee_bps || ',' || k_min || ',' || trading_enabled FROM icanera_trading.sector_settings")
[ "$kept" = "77,5,true" ] || { echo "re-applying a migration overwrote an administrator's setting ($kept)" >&2; exit 1; }
[ "$(psql_db -Atc "SELECT name FROM icanera_trading.sector_catalog WHERE ticker = 'iAGRI'")" = "Farming" ] \
  || { echo "re-applying a migration reset an administrator's sector name" >&2; exit 1; }
psql_db -c "UPDATE icanera_trading.sector_settings SET fee_bps = 50, k_min = 10, trading_enabled = FALSE" >/dev/null
psql_db -c "UPDATE icanera_trading.sector_catalog SET name = 'Agriculture' WHERE ticker = 'iAGRI'" >/dev/null
echo "an administrator's switches and sector edits survive a re-run."

for f in "$HERE"/0[1-9]_*.sql; do
  echo "running $(basename "$f")"
  psql_db -f "$f" >/dev/null 2>"$WORK/test.err" || { grep -v NOTICE "$WORK/test.err" >&2; echo "$(basename "$f") aborted" >&2; exit 1; }
done

# ---------------------------------------------------------------- concurrency: the index folder
psql_db -c "TRUNCATE icanera_trading.telemetry_events, icanera_trading.contributor_buckets, icanera_trading.sector_index_cache, icanera_trading.sector_index_candles" >/dev/null
psql_db -c "UPDATE icanera_trading.fold_state SET folded_at = NULL, last_bucket = NULL" >/dev/null
psql_db -c "UPDATE icanera_trading.sector_settings SET k_min = 3" >/dev/null

# 1. Single flight: a viewer's fold is skipped instantly while one is running; a trade's fold waits for it.
psql_db -c "UPDATE icanera_trading.fold_state SET folded_at = now() - interval '1 minute'" >/dev/null
psql_db -c "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('icanera_fold_sector_indices', 0)); SELECT pg_sleep(2.5); COMMIT;" >/dev/null &
holder=$!
sleep 0.6
start=$(date +%s%N)
skipped=$(psql_db -Atc "SELECT icanera_trading.fold_sector_indices(FALSE, FALSE)")
ms=$(( ($(date +%s%N) - start) / 1000000 ))
[ "$skipped" = "f" ] && [ "$ms" -lt 800 ] || { echo "FAILED: a fold queued behind a running fold (answered '$skipped' after ${ms} ms)" >&2; kill "$holder" 2>/dev/null || true; exit 1; }
start=$(date +%s%N)
waited=$(psql_db -Atc "SELECT icanera_trading.fold_sector_indices(TRUE, TRUE)")
ms=$(( ($(date +%s%N) - start) / 1000000 ))
wait "$holder"
[ "$waited" = "t" ] && [ "$ms" -gt 1000 ] || { echo "FAILED: a waiting fold did not wait for the running one (answered '$waited' after ${ms} ms)" >&2; exit 1; }
echo "a viewer's fold is skipped instantly while one is running; a trade's fold waits for it."

# 2. A transaction that took an earlier id but commits LATER is still counted (a high-water mark would skip it forever).
EV="INSERT INTO icanera_trading.telemetry_events (source, source_ref, sector, contributor_key, amount_ugx)"
( psql_db -c "BEGIN; $EV VALUES ('late', 'a', 'iEDUC', 'late-a', 7); SELECT pg_sleep(2); COMMIT;" >/dev/null ) &
slow=$!
sleep 0.5
psql_db -c "$EV VALUES ('late', 'b', 'iEDUC', 'late-b', 11)" >/dev/null
psql_db -c "SELECT icanera_trading.fold_sector_indices(TRUE, TRUE)" >/dev/null
mid=$(psql_db -Atc "SELECT coalesce(sum(amount_ugx), 0) FROM icanera_trading.contributor_buckets WHERE sector = 'iEDUC'")
wait "$slow"
psql_db -c "SELECT icanera_trading.fold_sector_indices(TRUE, TRUE)" >/dev/null
fin=$(psql_db -Atc "SELECT coalesce(sum(amount_ugx), 0) FROM icanera_trading.contributor_buckets WHERE sector = 'iEDUC'")
left=$(psql_db -Atc "SELECT count(*) FROM icanera_trading.telemetry_events WHERE folded_at IS NULL")
echo "late committer: after the first fold $mid counted (the open transaction invisible), after the second $fin, $left left uncounted"
[ "${mid%.*}" = "11" ] && [ "${fin%.*}" = "18" ] && [ "$left" = "0" ] \
  || { echo "FAILED: an event that committed late was skipped or counted twice" >&2; exit 1; }

# 3. A burst of sales while the folder runs flat out: every event is counted exactly once.
psql_db -c "TRUNCATE icanera_trading.telemetry_events, icanera_trading.contributor_buckets" >/dev/null
cat > "$WORK/emit.sql" <<'SQL'
\set k random(1, 40)
\set u random(1, 2000000000)
INSERT INTO icanera_trading.telemetry_events (source, source_ref, sector, contributor_key, amount_ugx)
VALUES ('burst', 'e' || :u || '-' || :k, 'iTECH', 'burst-' || :k, 1) ON CONFLICT DO NOTHING;
SQL
echo "SELECT icanera_trading.fold_sector_indices(TRUE, FALSE);" > "$WORK/fold.sql"
( pgbench -n -c 16 -j 4 -T 6 -f "$WORK/emit.sql" "$DB" >"$WORK/pg_emit.txt" 2>&1 ) &
( pgbench -n -c 4 -j 2 -T 6 -f "$WORK/fold.sql" "$DB" >"$WORK/pg_fold.txt" 2>&1 ) &
wait
psql_db -c "SELECT icanera_trading.fold_sector_indices(TRUE, TRUE)" >/dev/null
read -r rows counted unfolded <<<"$(psql_db -At -F ' ' -c "select (select count(*) from icanera_trading.telemetry_events), (select coalesce(sum(amount_ugx),0) from icanera_trading.contributor_buckets), (select count(*) from icanera_trading.telemetry_events where folded_at is null)")"
eps=$(grep -E '^tps' "$WORK/pg_emit.txt" | awk '{print int($3)}')
fps=$(grep -E '^tps' "$WORK/pg_fold.txt" | awk '{print int($3)}')
echo "burst: $rows sales dropped in the outbox ($eps/s) while the folder ran ($fps folds/s): $counted counted, $unfolded left"
[ "$rows" -gt 0 ] && [ "${counted%.*}" = "$rows" ] && [ "$unfolded" = "0" ] \
  || { echo "FAILED: the index did not count every sale exactly once under a burst" >&2; exit 1; }
echo "every sale in the burst is counted, none lost, none doubled."

# ---------------------------------------------------------------- concurrency: the trade itself
uid() { printf '00000000-0000-0000-0000-%012d' "$1"; }
pgb() { pgbench -n "$@" 2>&1; }
failed_of() { grep -E 'number of failed transactions' | head -1 | sed -E 's/.*: ([0-9]+) .*/\1/'; }   # the overall figure
trade_script() { # $1 user number, $2 side, $3 amount, $4 request id expression (SQL), $5 currency (default ICEC)
  cat <<SQL
\set rid random(1, 2000000000)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$(uid "$1")', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.ican_sector_trade('iRETL', '$2', $3, '${5:-ICEC}', $4, NULL, 5);
COMMIT;
SQL
}

# a fresh, live market: iRETL with 5 contributors, a funded vault, no stale state
psql_db >/dev/null <<'SQL'
TRUNCATE icanera_trading.telemetry_events, icanera_trading.contributor_buckets, icanera_trading.sector_index_cache,
         icanera_trading.sector_index_candles, icanera_trading.vault_entries, icanera_trading.sector_fills,
         icanera_trading.sector_holdings, icanera_trading.trade_requests, icanera_trading.sector_exposure,
         public.ican_user_wallets, public.wallet_accounts, public.ican_coin_transactions;
UPDATE icanera_trading.vault_cache SET balance = 0;
UPDATE icanera_trading.fold_state SET folded_at = NULL, last_bucket = NULL, ledger_txid = '0'::xid8;
UPDATE icanera_trading.sector_settings SET trading_enabled = TRUE, fee_bps = 100, max_trades_per_minute = 1000000,
  max_trade_icec = 1000000, max_position_icec = 1000000, stress_pct = 50, k_min = 3, stale_s = 120;
UPDATE public.ican_trade_settings SET max_trades_per_minute = 1000000, trading_enabled = TRUE, max_trade_ugx = NULL;
INSERT INTO icanera_trading.telemetry_events (source, source_ref, sector, contributor_key, amount_ugx)
  SELECT 'race', 'r' || n, 'iRETL', 'race-' || n, 100 FROM generate_series(1, 5) n;
SELECT icanera_trading.fold_sector_indices(TRUE, TRUE);
SELECT public.ican_sector_dev_vault_adjust('dev_test_secret', 1000000, 'race tests');
SQL
[ "$(psql_db -Atc "SELECT status || ',' || price_icec FROM icanera_trading.sector_index_cache WHERE ticker = 'iRETL'")" = "live,1.000000" ] \
  || { echo "FAILED: the race market did not open at 1.00" >&2; exit 1; }

# 1. Many tabs and retries at once, each a DIFFERENT request, all spending the same 100 ICEC at 30 a time.
psql_db -c "INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('$(uid 20)', 100)" >/dev/null
trade_script 20 buy 30 "'race-buy-' || :rid" > "$WORK/race1.sql"
out=$(pgb -c 40 -j 4 -t 3 -f "$WORK/race1.sql" "$DB")
read -r wins bal units ok <<<"$(psql_db -At -F ' ' -c "select (select count(*) from icanera_trading.sector_fills where user_id='$(uid 20)'), (select ican_balance from public.ican_user_wallets where user_id='$(uid 20)'), (select units from icanera_trading.sector_holdings where user_id='$(uid 20)'), (select ((public.ican_sector_dev_reconcile('dev_test_secret')) ->> 'ok')::boolean)")"
echo "race 1 (120 attempts to spend 30 of a 100 balance): $wins succeeded, ICEC left $bal, units held $units"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$wins" = "3" ] && [ "${bal%.*}" = "10" ] && [ "$units" = "89.10000000" ] && [ "$ok" = "t" ] \
  || { echo "FAILED: a 100 balance was spent more than three times at 30, or the books disagree" >&2; echo "$out" >&2; exit 1; }

# 2. The very same request sent 40 times at once (a double tap, a retrying network, two tabs).
psql_db -c "INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('$(uid 21)', 100000)" >/dev/null
trade_script 21 buy 30 "'same-request-0001'" > "$WORK/race2.sql"
out=$(pgb -c 40 -j 4 -t 1 -f "$WORK/race2.sql" "$DB")
read -r rows bal <<<"$(psql_db -At -F ' ' -c "select (select count(*) from icanera_trading.sector_fills where user_id='$(uid 21)'), (select ican_balance from public.ican_user_wallets where user_id='$(uid 21)')")"
echo "race 2 (one request sent 40 times at once): $rows fill(s), ICEC left $bal"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$rows" = "1" ] && [ "${bal%.*}" = "99970" ] \
  || { echo "FAILED: one request id executed more than once" >&2; echo "$out" >&2; exit 1; }

# 3. Selling the same units from 30 sessions at once: five units can pay out five times, not thirty.
psql_db -c "INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('$(uid 22)', 100)" >/dev/null
psql_db -c "SET request.jwt.claim.sub = '$(uid 22)'; SET ROLE authenticated; SELECT public.ican_sector_trade('iRETL', 'buy', 6, 'ICEC', 'seed-5-units-1')" >/dev/null
# 6 ICEC at 1.00 with a 1% fee: fee 0.06, 5.94 units. Five whole units can be sold, 0.94 cannot.
[ "$(psql_db -Atc "SELECT units FROM icanera_trading.sector_holdings WHERE user_id = '$(uid 22)'")" = "5.94000000" ] || { echo "FAILED: the seller did not get exactly 5.94 units" >&2; exit 1; }
trade_script 22 sell 1 "'race-sell-' || :rid" > "$WORK/race3.sql"
out=$(pgb -c 30 -j 4 -t 1 -f "$WORK/race3.sql" "$DB")
read -r sold left <<<"$(psql_db -At -F ' ' -c "select (select count(*) from icanera_trading.sector_fills where user_id='$(uid 22)' and side='sell'), (select units from icanera_trading.sector_holdings where user_id='$(uid 22)')")"
echo "race 3 (30 sessions selling 1 unit each from a holding of 5.94): $sold paid out, units left $left"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$sold" = "5" ] && [ "$left" = "0.94000000" ] \
  || { echo "FAILED: more units were sold than the seller held" >&2; echo "$out" >&2; exit 1; }

# 4. 100 users buying and selling at once while the folder runs flat out: every ICEC is accounted for.
psql_db -c "INSERT INTO public.ican_user_wallets (user_id, ican_balance) SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 1000 FROM generate_series(100, 199) n" >/dev/null
read -r start_total <<<"$(psql_db -Atc "SELECT (SELECT coalesce(sum(ican_balance), 0) FROM public.ican_user_wallets) + icanera_trading.vault_balance()")"
cat > "$WORK/many_buy.sql" <<'SQL'
\set u random(100, 199)
\set amt random(1, 40)
\set rid random(1, 2000000000)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(cast(:u as text), 12, '0'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.ican_sector_trade('iRETL', 'buy', :amt, 'ICEC', 'many-' || :rid, NULL, 5);
COMMIT;
SQL
cat > "$WORK/many_sell.sql" <<'SQL'
\set u random(100, 199)
\set amt random(1, 30)
\set rid random(1, 2000000000)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(cast(:u as text), 12, '0'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.ican_sector_trade('iRETL', 'sell', :amt, 'ICEC', 'many-' || :rid, NULL, 5);
COMMIT;
SQL
# The folder as production runs it: asked every quarter second (viewers and pg_cron), it works at most once per 2 s.
printf 'SELECT icanera_trading.fold_sector_indices(FALSE, FALSE);\nSELECT pg_sleep(0.25);\n' > "$WORK/fold_loop.sql"
( pgb -c 32 -j 4 -T 8 -f "$WORK/many_buy.sql"@7 -f "$WORK/many_sell.sql"@3 "$DB" >"$WORK/pg_many.txt" ) &
( pgb -c 2 -j 1 -T 8 -f "$WORK/fold_loop.sql" "$DB" >"$WORK/pg_foldloop.txt" ) &
wait
psql_db -c "SELECT icanera_trading.fold_sector_indices(TRUE, TRUE)" >/dev/null
read -r fills end_total rec neg level <<<"$(psql_db -At -F ' ' -c "select (select count(*) from icanera_trading.sector_fills), (select (select coalesce(sum(ican_balance), 0) from public.ican_user_wallets) + icanera_trading.vault_balance()), (public.ican_sector_dev_reconcile('dev_test_secret') ->> 'ok'), (select count(*) from public.ican_user_wallets where ican_balance < 0) + (select count(*) from icanera_trading.sector_holdings where units < 0), (select level from icanera_trading.sector_index_cache where ticker = 'iRETL')")"
tps=$(grep -E '^tps' "$WORK/pg_many.txt" | awk '{print int($3)}')
echo "race 4 (100 users, 32 sessions, folder running): $fills fills ($tps/s); ICEC in wallets + vault $start_total -> $end_total; books balance: $rec; negative balances: $neg"
[ "$(cat "$WORK/pg_many.txt" | failed_of)" = "0" ] && [ "$fills" -gt 1000 ] && [ "$start_total" = "$end_total" ] && [ "$rec" = "true" ] && [ "$neg" = "0" ] \
  || { echo "FAILED: ICEC was created or lost, or a book disagrees, under concurrent trading" >&2; cat "$WORK/pg_many.txt" >&2; exit 1; }
echo "100 users trading at once: every ICEC is accounted for to the last digit, nobody negative, no deadlocks, and the books reconcile."

# 5. The same person on the coin screen and the sector screen at once: the two trade functions never deadlock.
psql_db -c "INSERT INTO public.wallet_accounts (user_id, balance, currency) VALUES ('$(uid 23)', 100000000, 'UGX'); INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('$(uid 23)', 100000)" >/dev/null
cat > "$WORK/coin.sql" <<SQL
\set rid random(1, 2000000000)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$(uid 23)', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.ican_trade_execute('buy', 6000, 'UGX', 'UG', 'coin-' || :rid, NULL, 50);
COMMIT;
SQL
trade_script 23 buy 2 "'sec-' || :rid" > "$WORK/sec.sql"
out=$(pgb -c 16 -j 4 -T 5 -f "$WORK/coin.sql"@1 -f "$WORK/sec.sql"@1 "$DB")
nc=$(psql_db -Atc "SELECT count(*) FROM public.ican_coin_transactions WHERE user_id = '$(uid 23)'")
ns=$(psql_db -Atc "SELECT count(*) FROM icanera_trading.sector_fills WHERE user_id = '$(uid 23)'")
echo "race 5 (one person, coin trades and sector trades at once): $nc coin trades and $ns sector trades"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$nc" -gt 10 ] && [ "$ns" -gt 10 ] && ! echo "$out" | grep -qi deadlock \
  || { echo "FAILED: the coin trade and the sector trade interfered or deadlocked" >&2; echo "$out" >&2; exit 1; }
echo "coin trades and sector trades by the same person run side by side with no deadlock."

# 6. What the telemetry hook costs a sale. A hot path: 16 sessions each recording a sale, with and without the hook.
psql_db >/dev/null <<'SQL'
TRUNCATE public.ican_business_wallet_settlements, public.business_co_owners, public.business_profiles CASCADE;
INSERT INTO public.business_profiles (id, user_id, business_name, business_type, metadata)
  SELECT ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, gen_random_uuid(), 'Shop ' || n, 'LLC', '{"category_key":"retail"}' FROM generate_series(1, 50) n;
INSERT INTO icanera_trading.data_terms_acceptance (business_id, terms_version, accepted_by)
  SELECT id, 1, user_id FROM public.business_profiles ON CONFLICT DO NOTHING;
SQL
cat > "$WORK/sale.sql" <<'SQL'
\set b random(1, 50)
INSERT INTO public.ican_business_wallet_settlements (business_profile_id, source_app, source_reference, amount_ican, settlement_type)
VALUES (('b1000000-0000-0000-0000-' || lpad(cast(:b as text), 12, '0'))::uuid, 'bench', 'sale-' || gen_random_uuid(), 1, 'pos_sale');
SQL
bench_sales() { # $1 = clients; prints the average latency in ms. Fails loudly: a silent failure here would hide a real problem.
  pgbench -n -c "$1" -j "$(( $1 > 4 ? 4 : $1 ))" -T 3 -f "$WORK/sale.sql" "$DB" >"$WORK/pg_sale.txt" 2>&1 \
    || { echo "FAILED: the sale benchmark aborted:" >&2; cat "$WORK/pg_sale.txt" >&2; exit 1; }
  grep -E 'latency average' "$WORK/pg_sale.txt" | awk '{print $4}'
}
hook() { psql_db -c "ALTER TABLE public.ican_business_wallet_settlements $1 TRIGGER trg_icanera_capture_settlement" >/dev/null; }
bench_sales 1 >/dev/null                       # warm up
hook DISABLE; off1=$(bench_sales 1); hook ENABLE; on1=$(bench_sales 1)
hook DISABLE; off2=$(bench_sales 1); hook ENABLE; on2=$(bench_sales 1)
hook ENABLE; on16=$(bench_sales 16)
captured=$(psql_db -Atc "SELECT count(*) FROM icanera_trading.telemetry_events WHERE source = 'settlement'")
added=$(awk -v a="$on1" -v b="$on2" -v c="$off1" -v d="$off2" 'BEGIN { printf "%.3f", ((a + b) - (c + d)) / 2 }')
echo "telemetry hook: one session records a sale in ${off1}/${off2} ms without the hook and ${on1}/${on2} ms with it (+${added} ms); 16 sessions: ${on16} ms each; $captured sales captured"
awk -v x="$added" 'BEGIN { exit !(x < 1.0) }' || { echo "FAILED: the telemetry hook adds ${added} ms to a sale (limit 1 ms)" >&2; exit 1; }
[ "${captured:-0}" -gt 100 ] || { echo "FAILED: the hook captured almost nothing under load" >&2; exit 1; }
echo "the revenue hook adds ${added} ms to a sale (limit 1 ms) and never fails one."

# ---------------------------------------------------------------- rollback
ROLLBACK1="$ROOT/supabase/rollback/20261019_rollback_sector_trading.sql"
ROLLBACK2="$ROOT/supabase/rollback/20261019_rollback_sector_trading_DROP_DATA.sql"
psql_db -c "UPDATE icanera_trading.sector_settings SET trading_enabled = TRUE" >/dev/null
fills_before=$(psql_db -Atc "SELECT count(*) FROM icanera_trading.sector_fills")
vault_before=$(psql_db -Atc "SELECT icanera_trading.vault_balance()")
wallets_before=$(psql_db -Atc "SELECT sum(ican_balance) FROM public.ican_user_wallets")
psql_db -f "$ROLLBACK1" >/dev/null 2>&1 || { echo "FAILED: the stop-and-keep rollback failed" >&2; exit 1; }
psql_db -f "$ROLLBACK1" >/dev/null 2>&1 || { echo "FAILED: the stop-and-keep rollback is not safe to run twice" >&2; exit 1; }
left=$(psql_db -Atc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'ican_%sector%'")
hook=$(psql_db -Atc "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_icanera_capture_settlement'")
paused=$(psql_db -Atc "SELECT NOT trading_enabled FROM icanera_trading.sector_settings")
fills_after=$(psql_db -Atc "SELECT count(*) FROM icanera_trading.sector_fills")
vault_after=$(psql_db -Atc "SELECT icanera_trading.vault_balance()")
wallets_after=$(psql_db -Atc "SELECT sum(ican_balance) FROM public.ican_user_wallets")
echo "rollback 1: $left public sector functions left, $hook hooks left, trading paused: $paused; fills $fills_before -> $fills_after, vault $vault_before -> $vault_after, wallets untouched: $([ "$wallets_before" = "$wallets_after" ] && echo yes || echo NO)"
[ "$left" = "0" ] && [ "$hook" = "0" ] && [ "$paused" = "t" ] && [ "$fills_before" = "$fills_after" ] && [ "$vault_before" = "$vault_after" ] && [ "$wallets_before" = "$wallets_after" ] \
  || { echo "FAILED: the stop-and-keep rollback left something behind or touched the books" >&2; exit 1; }
# a sale after the rollback behaves exactly as before and records nothing for trading
before=$(psql_db -Atc "SELECT count(*) FROM icanera_trading.telemetry_events")
psql_db -c "INSERT INTO public.ican_business_wallet_settlements (business_profile_id, source_app, source_reference, amount_ican, settlement_type) VALUES ('b1000000-0000-0000-0000-000000000001', 'after-rollback', 'x1', 1, 'pos_sale')" >/dev/null \
  || { echo "FAILED: a sale failed after the rollback" >&2; exit 1; }
[ "$(psql_db -Atc "SELECT count(*) FROM icanera_trading.telemetry_events")" = "$before" ] || { echo "FAILED: a sale was still captured after the rollback" >&2; exit 1; }
# the existing icaneracoin trade is untouched by all of it
psql_db -c "SET request.jwt.claim.sub = '$(uid 23)'; SET ROLE authenticated; SELECT public.ican_trade_execute('buy', 6000, 'UGX', 'UG', 'after-rollback-1', NULL, 50)" >/dev/null \
  || { echo "FAILED: the icaneracoin trade broke" >&2; exit 1; }
echo "after rollback 1 a sale is not captured, the icaneracoin trade still works, and the books are exactly as they were."

# the destructive half refuses while users still hold units...
if psql_db -f "$ROLLBACK2" >/dev/null 2>"$WORK/rb2.err"; then echo "FAILED: the destructive rollback ran while users still held units" >&2; exit 1; fi
grep -q "still hold" "$WORK/rb2.err" || { echo "FAILED: the destructive rollback refused for the wrong reason:" >&2; cat "$WORK/rb2.err" >&2; exit 1; }
[ "$(psql_db -Atc "SELECT count(*) FROM icanera_trading.sector_fills")" = "$fills_before" ] || { echo "FAILED: a refused rollback dropped data" >&2; exit 1; }
echo "the destructive rollback refuses while users still hold sector units, and drops nothing."
# ...and drops everything once they do not
psql_db -c "SET icanera.force_drop = 'yes'" -f "$ROLLBACK2" >/dev/null 2>&1 || { echo "FAILED: the forced destructive rollback failed" >&2; exit 1; }
[ "$(psql_db -Atc "SELECT to_regnamespace('icanera_trading') IS NULL")" = "t" ] || { echo "FAILED: the schema is still there after the destructive rollback" >&2; exit 1; }
# a clean re-install from nothing works
for f in "${SECTOR_MIGRATIONS[@]}"; do
  quiet psql_db -f "$f" || { echo "FAILED: $(basename "$f") does not apply after a rollback" >&2; exit 1; }
done
[ "$(psql_db -Atc "SELECT count(*) FROM icanera_trading.sector_catalog")" = "10" ] || { echo "FAILED: the re-install is incomplete" >&2; exit 1; }
echo "the migrations apply again after a full rollback."

# ---------------------------------------------------------------- the verdict
read -r total failed <<<"$(psql_db -At -F ' ' -c "select count(*), count(*) filter (where not ok) from t.results")"
if [ "$failed" != "0" ]; then
  echo "FAILED: $failed of $total database checks failed:" >&2
  psql_db -At -F ' | ' -c "select name, coalesce(info, '') from t.results where not ok order by n" >&2
  exit 1
fi
echo "OK: $total of $total database checks passed."
