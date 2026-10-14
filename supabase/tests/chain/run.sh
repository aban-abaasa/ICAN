#!/usr/bin/env bash
# Runs the on-chain bridge database tests against a throwaway Postgres database, including real concurrency tests
# (many sessions at once) with pgbench.
#
#   supabase/tests/chain/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, with psql and pgbench on the PATH. Connection comes from
# the usual libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); nothing here touches your real Supabase project.
#   KEEP_DB=1   keep the database afterwards so you can look around
#   DB_NAME=x   use another database name (default ican_chain_test)
#
# The base is the repo's own icaneracoin stack (the same one the sector tests build), so the bridge is tested against the
# real wallets and the real ledger table, not copies of them. The chain itself is simulated: the relayer's calls are made
# directly, because what is under test is the database's side of the bargain (what it will and will not believe, and that no
# ICEC is ever created or lost). The contracts have their own suite in /blockchain.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_chain_test}"
CHART="$ROOT/supabase/tests/icaneracoin_chart"
MIG="$ROOT/supabase/migrations"
BASE_FILES=(
  "$CHART/00_stub.sql"
  "$ROOT/frontend/backend/ICAN_PRICE_ENGINE.sql"
  "$ROOT/frontend/backend/ICAN_REAL_CANDLESTICK_ENGINE.sql"
  "$MIG/20261017100000_public_icaneracoin_chart.sql"
  "$MIG/20261018100000_icaneracoin_burst_safe_feed.sql"
  "$MIG/20261018110000_icaneracoin_atomic_trade.sql"
)
CHAIN_MIGRATIONS=(
  "$MIG/20261020100000_chain_core.sql"
  "$MIG/20261020110000_chain_bridge.sql"
  "$MIG/20261020120000_chain_fx_oracle.sql"
)
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
quiet() { "$@" >/dev/null 2>"$WORK/err.txt" || { grep -v NOTICE "$WORK/err.txt" >&2; return 1; }; }

build_db() { # $1 = database name: the repo's icaneracoin stack as it is today
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$1\"" -c "CREATE DATABASE \"$1\"" >/dev/null 2>&1
  local f
  for f in "${BASE_FILES[@]}"; do
    psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$f" >/dev/null 2>"$WORK/err.txt" || { grep -v NOTICE "$WORK/err.txt" >&2; echo "$(basename "$f") failed" >&2; exit 2; }
  done
}

build_db "$DB"
for f in "${CHAIN_MIGRATIONS[@]}"; do
  quiet psql_db -f "$f" || { echo "$(basename "$f") failed" >&2; exit 2; }
done
# every migration must be safe to run again, and again must not undo what an administrator set
for f in "${CHAIN_MIGRATIONS[@]}"; do
  psql_db -f "$f" >/dev/null 2>&1 || { echo "re-applying $(basename "$f") FAILED" >&2; exit 1; }
done
echo "migrations applied. re-applied all of them to prove they are safe to run twice."
psql_db -c "UPDATE icanera_chain.chain_settings SET max_withdrawal_icec = 77, confirmations = 5, chain_id = 4242, icec_community_address = '0x$(printf 'ab%.0s' {1..20})', bridge_enabled = TRUE" >/dev/null
for f in "${CHAIN_MIGRATIONS[@]}"; do psql_db -f "$f" >/dev/null 2>&1; done
kept=$(psql_db -Atc "SELECT max_withdrawal_icec || ',' || confirmations || ',' || chain_id || ',' || bridge_enabled FROM icanera_chain.chain_settings")
[ "$kept" = "77,5,4242,true" ] || { echo "re-applying a migration overwrote an administrator's setting ($kept)" >&2; exit 1; }
psql_db -c "UPDATE icanera_chain.chain_settings SET max_withdrawal_icec = 1000, confirmations = 12, chain_id = NULL, icec_community_address = NULL, bridge_enabled = FALSE" >/dev/null
echo "an administrator's switches and contract addresses survive a re-run."

for f in "$HERE"/0[1-9]_*.sql; do
  echo "running $(basename "$f")"
  psql_db -f "$f" >/dev/null 2>"$WORK/test.err" || { grep -v NOTICE "$WORK/test.err" >&2; echo "$(basename "$f") aborted" >&2; exit 1; }
done

# ---------------------------------------------------------------- concurrency
uid() { printf '00000000-0000-0000-0000-%012d' "$1"; }
pgb() { pgbench -n "$@" 2>&1; }
failed_of() { grep -E 'number of failed transactions' | head -1 | sed -E 's/.*: ([0-9]+) .*/\1/'; }   # the overall figure
as_user_sql() { # $1 user number; the lines every user script starts with
  printf "BEGIN;\nSELECT set_config('request.jwt.claim.sub', '%s', true);\nSELECT set_config('request.jwt.claim.role', 'authenticated', true);\nSET LOCAL ROLE authenticated;\n" "$(uid "$1")"
}
as_service_sql() {
  printf "BEGIN;\nSELECT set_config('request.jwt.claim.sub', '', true);\nSELECT set_config('request.jwt.claim.role', 'service_role', true);\nSET LOCAL ROLE service_role;\n"
}
HASH64="'0x' || md5(random()::text || clock_timestamp()::text) || md5(clock_timestamp()::text || random()::text)"
reconcile_ok() { psql_db -Atc "SELECT (public.ican_chain_dev_reconcile('dev_test_secret') ->> 'ok')"; }

# a clean slate, limits out of the way: the races below are about correctness, not about the limits
psql_db >/dev/null <<'SQL'
TRUNCATE public.ican_user_wallets, public.wallet_accounts, public.ican_coin_transactions;
TRUNCATE icanera_chain.locked_entries, icanera_chain.bridge_deposits, icanera_chain.bridge_withdrawals, icanera_chain.user_addresses,
         icanera_chain.link_challenges, icanera_chain.anomalies, icanera_chain.supply_checks, icanera_chain.sync_state RESTART IDENTITY CASCADE;
UPDATE icanera_chain.chain_settings SET bridge_enabled = TRUE, min_withdrawal_icec = 1, max_withdrawal_icec = 1000000,
  max_daily_withdrawal_icec = 1000000000000, max_withdrawals_per_hour = 1000000, max_addresses_per_user = 20;
SQL
link_user() { psql_db -Atc "SELECT t.link($1, t.a($2))" >/dev/null; }
mint_all() { # record the mint event for every withdrawal of user $1 that is not yet minted
  psql_db -Atc "SELECT count(*) FROM (SELECT t.mint(id, 600000 + row_number() OVER (), 7000) FROM icanera_chain.bridge_withdrawals WHERE user_id = '$(uid "$1")' AND status IN ('pending','submitted')) q" >/dev/null
}

# 1. Many tabs and retries at once, each a DIFFERENT request, all spending the same 100 ICEC at 30 a time.
link_user 50 5050
psql_db -c "INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('$(uid 50)', 100)" >/dev/null
{ as_user_sql 50; echo "\\set rid random(1, 2000000000)"; echo "SELECT public.ican_bridge_request_withdrawal(30, t.a(5050), 'race-wd-' || :rid);"; echo "COMMIT;"; } > "$WORK/race1.sql"
out=$(pgb -c 40 -j 4 -t 3 -f "$WORK/race1.sql" "$DB")
read -r wins bal locked <<<"$(psql_db -At -F ' ' -c "select (select count(*) from icanera_chain.bridge_withdrawals where user_id='$(uid 50)'), (select ican_balance from public.ican_user_wallets where user_id='$(uid 50)'), icanera_chain.locked_total()")"
echo "race 1 (120 attempts to withdraw 30 from a 100 balance): $wins succeeded, ICEC left $bal, locked $locked"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$wins" = "3" ] && [ "${bal%.*}" = "10" ] && [ "${locked%.*}" = "90" ] && [ "$(reconcile_ok)" = "true" ] \
  || { echo "FAILED: a 100 balance was withdrawn more than three times at 30, or the books disagree" >&2; echo "$out" >&2; exit 1; }

# 2. The very same request sent 40 times at once (a double tap, a retrying network, two tabs).
link_user 51 5151
psql_db -c "INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('$(uid 51)', 100000)" >/dev/null
{ as_user_sql 51; echo "SELECT public.ican_bridge_request_withdrawal(30, t.a(5151), 'same-request-0001');"; echo "COMMIT;"; } > "$WORK/race2.sql"
out=$(pgb -c 40 -j 4 -t 1 -f "$WORK/race2.sql" "$DB")
read -r rows bal <<<"$(psql_db -At -F ' ' -c "select (select count(*) from icanera_chain.bridge_withdrawals where user_id='$(uid 51)'), (select ican_balance from public.ican_user_wallets where user_id='$(uid 51)')")"
echo "race 2 (one request sent 40 times at once): $rows withdrawal(s), ICEC left $bal"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$rows" = "1" ] && [ "${bal%.*}" = "99970" ] \
  || { echo "FAILED: one request id executed more than once" >&2; echo "$out" >&2; exit 1; }

# 3. The same burn event reported 40 times at once (a re-scan, two overlapping relayer runs): credited once.
link_user 52 5252
psql_db -c "INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('$(uid 52)', 1000)" >/dev/null
psql_db -Atc "SELECT t.wd(52, 10, t.a(5252), 'race3-wd-0001', 'r3')" >/dev/null
psql_db -Atc "SELECT t.mint(t.id('r3'), 700001, 7001)" >/dev/null
{ as_service_sql; echo "SELECT public.ican_chain_operator_record_burn(31337, t.h(700002), 0, 7002, t.a(5252), '400000000', 'c');"; echo "COMMIT;"; } > "$WORK/race3.sql"
out=$(pgb -c 40 -j 4 -t 1 -f "$WORK/race3.sql" "$DB")
read -r rows bal <<<"$(psql_db -At -F ' ' -c "select (select count(*) from icanera_chain.bridge_deposits where from_address = t.a(5252)), (select ican_balance from public.ican_user_wallets where user_id='$(uid 52)')")"
echo "race 3 (one burn event reported 40 times at once): $rows burn row(s), balance $bal (990 + 4 credited)"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$rows" = "1" ] && [ "${bal%.*}" = "994" ] && [ "$(reconcile_ok)" = "true" ] \
  || { echo "FAILED: one burn was credited more than once" >&2; echo "$out" >&2; exit 1; }

# 4. Twenty DIFFERENT burns racing for 6 ICEC of outstanding tokens, 3 each: exactly two can be credited.
link_user 53 5353
psql_db -c "INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('$(uid 53)', 1000)" >/dev/null
psql_db -Atc "SELECT t.wd(53, 6, t.a(5353), 'race4-wd-0001', 'r4')" >/dev/null
psql_db -Atc "SELECT t.mint(t.id('r4'), 700011, 7011)" >/dev/null
{ as_service_sql; echo "SELECT public.ican_chain_operator_record_burn(31337, $HASH64, 0, 7012, t.a(5353), '300000000', 'c');"; echo "COMMIT;"; } > "$WORK/race4.sql"
out=$(pgb -c 20 -j 4 -t 1 -f "$WORK/race4.sql" "$DB")
read -r credited parked bal <<<"$(psql_db -At -F ' ' -c "select (select count(*) from icanera_chain.bridge_deposits where from_address = t.a(5353) and status='credited'), (select count(*) from icanera_chain.bridge_deposits where from_address = t.a(5353) and status='unclaimed'), (select ican_balance from public.ican_user_wallets where user_id='$(uid 53)')")"
echo "race 4 (20 burns of 3 against 6 outstanding): $credited credited, $parked parked, balance $bal"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$credited" = "2" ] && [ "$parked" = "18" ] && [ "${bal%.*}" = "1000" ] && [ "$(reconcile_ok)" = "true" ] \
  || { echo "FAILED: more was credited than was ever minted to the address" >&2; echo "$out" >&2; exit 1; }
echo "a burn is credited once, and never beyond what was minted to its address."

# 5. A cancel and a "signed" racing for the same withdrawals: exactly one of them wins each time, never both.
link_user 54 5454
psql_db -c "INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('$(uid 54)', 1000000)" >/dev/null
psql_db >/dev/null <<SQL
CREATE TABLE IF NOT EXISTS t.race_ids (i INT PRIMARY KEY, id UUID);
GRANT ALL ON t.race_ids TO PUBLIC;
TRUNCATE t.race_ids;
SELECT t.wd(54, 5, t.a(5454), 'race5-wd-' || n) FROM generate_series(1, 300) n;
INSERT INTO t.race_ids SELECT row_number() OVER (ORDER BY created_at, id), id FROM icanera_chain.bridge_withdrawals WHERE user_id = '$(uid 54)';
SQL
{ as_user_sql 54; echo "\\set i random(1, 300)"; echo "SELECT id AS wid FROM t.race_ids WHERE i = :i \\gset"; echo "SELECT public.ican_bridge_cancel_withdrawal(NULLIF(':wid', '')::uuid);"; echo "COMMIT;"; } > "$WORK/race5a.sql"
{ as_service_sql; echo "\\set i random(1, 300)"; echo "SELECT id AS wid FROM t.race_ids WHERE i = :i \\gset"; echo "SELECT public.ican_chain_operator_mark_submitted(NULLIF(':wid', '')::uuid, $HASH64);"; echo "COMMIT;"; } > "$WORK/race5b.sql"
out=$(pgb -c 24 -j 4 -T 4 -f "$WORK/race5a.sql"@1 -f "$WORK/race5b.sql"@1 "$DB")
read -r both cancelled signed pending ok <<<"$(psql_db -At -F ' ' -c "select (select count(*) from icanera_chain.bridge_withdrawals where user_id='$(uid 54)' and status='cancelled' and (attempts > 0 or tx_hash is not null)), (select count(*) from icanera_chain.bridge_withdrawals where user_id='$(uid 54)' and status='cancelled'), (select count(*) from icanera_chain.bridge_withdrawals where user_id='$(uid 54)' and status='submitted'), (select count(*) from icanera_chain.bridge_withdrawals where user_id='$(uid 54)' and status='pending'), (public.ican_chain_dev_reconcile('dev_test_secret') ->> 'ok')")"
echo "race 5 (cancel vs signed, 24 sessions, 4 s): $cancelled cancelled, $signed signed, $pending untouched, cancelled-and-signed: $both"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$both" = "0" ] && [ "$((cancelled + signed + pending))" = "300" ] && [ "$cancelled" -gt 20 ] && [ "$signed" -gt 20 ] && [ "$ok" = "true" ] \
  || { echo "FAILED: a withdrawal was both refunded and signed, or the books disagree" >&2; echo "$out" >&2; exit 1; }
echo "a withdrawal is either refunded or sent to the chain, never both."

# 6. 100 users bridging at once while the relayer mints and users burn back: every ICEC is accounted for.
#    (A real chain emits one mint event per reference, so the simulated chain does too: the same withdrawal reported by two
#    sessions is the SAME event, which the database must treat as a repeat, not as a second mint.)
psql_db >/dev/null <<'SQL'
TRUNCATE public.ican_user_wallets;
INSERT INTO public.ican_user_wallets (user_id, ican_balance) SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 10000 FROM generate_series(100, 199) n;
SELECT t.link(n, t.a(10000 + n)) FROM generate_series(100, 199) n;
TRUNCATE icanera_chain.locked_entries, icanera_chain.bridge_deposits, icanera_chain.bridge_withdrawals RESTART IDENTITY CASCADE;
SQL
read -r start_total <<<"$(psql_db -Atc "SELECT (SELECT coalesce(sum(ican_balance), 0) FROM public.ican_user_wallets) + icanera_chain.locked_total()")"
{ echo "\\set u random(100, 199)"; echo "\\set amt random(1, 50)"; echo "\\set rid random(1, 2000000000)"
  echo "BEGIN;"; echo "SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(cast(:u as text), 12, '0'), true);"
  echo "SELECT set_config('request.jwt.claim.role', 'authenticated', true);"; echo "SET LOCAL ROLE authenticated;"
  echo "SELECT public.ican_bridge_request_withdrawal(:amt, t.a(10000 + :u), 'many-' || :rid);"; echo "COMMIT;"; } > "$WORK/many_wd.sql"
{ echo "SELECT COALESCE(w.id::text, '') AS wid, COALESCE(w.ref, '') AS wref, COALESCE(w.to_address, '') AS wto, COALESCE(w.amount_units::text, '0') AS wunits FROM (SELECT 1) d LEFT JOIN (SELECT * FROM icanera_chain.bridge_withdrawals WHERE status IN ('pending','submitted') ORDER BY random() LIMIT 1) w ON TRUE \\gset"
  as_service_sql
  # the relayer only broadcasts if the database let it record the signed transaction first (a cancelled one is refused)
  echo "SELECT CASE WHEN ':wid' = '' THEN NULL WHEN NOT COALESCE((public.ican_chain_operator_mark_submitted(NULLIF(':wid', '')::uuid, $HASH64) ->> 'success')::boolean, false) THEN NULL ELSE public.ican_chain_operator_record_mint(31337, ':wref', '0x' || md5(':wref') || md5(':wref' || 'tx'), 0, 8000 + get_byte(decode(substr(md5(':wref'), 1, 2), 'hex'), 0), ':wto', ':wunits') END;"
  echo "COMMIT;"; } > "$WORK/many_mint.sql"
{ echo "SELECT COALESCE((SELECT to_address FROM icanera_chain.bridge_withdrawals WHERE status = 'minted' ORDER BY random() LIMIT 1), '') AS addr, 1 + floor(random() * 2000000000)::bigint AS units \\gset"
  as_service_sql
  echo "SELECT CASE WHEN ':addr' = '' THEN NULL ELSE public.ican_chain_operator_record_burn(31337, $HASH64, 0, 9000, ':addr', :units::text, 'c') END;"
  echo "COMMIT;"; } > "$WORK/many_burn.sql"
{ echo "SELECT COALESCE((SELECT id::text FROM icanera_chain.bridge_withdrawals WHERE status = 'pending' AND attempts = 0 ORDER BY random() LIMIT 1), '') AS wid, COALESCE((SELECT user_id::text FROM icanera_chain.bridge_withdrawals WHERE status = 'pending' AND attempts = 0 ORDER BY random() LIMIT 1), '') AS uid \\gset"
  echo "BEGIN;"; echo "SELECT set_config('request.jwt.claim.sub', ':uid', true);"; echo "SELECT set_config('request.jwt.claim.role', 'authenticated', true);"; echo "SET LOCAL ROLE authenticated;"
  echo "SELECT CASE WHEN ':wid' = '' THEN NULL ELSE public.ican_bridge_cancel_withdrawal(NULLIF(':wid', '')::uuid) END;"; echo "COMMIT;"; } > "$WORK/many_cancel.sql"
printf 'SELECT public.ican_chain_operator_retry_unclaimed(50);\nSELECT pg_sleep(0.2);\n' > "$WORK/many_retry.sql"
sed -i '1s/^/BEGIN;\nSELECT set_config('"'"'request.jwt.claim.role'"'"', '"'"'service_role'"'"', true);\nSET LOCAL ROLE service_role;\n/; $a COMMIT;' "$WORK/many_retry.sql"
( pgb -c 24 -j 4 -T 8 -f "$WORK/many_wd.sql"@6 -f "$WORK/many_mint.sql"@5 -f "$WORK/many_burn.sql"@3 -f "$WORK/many_cancel.sql"@1 "$DB" >"$WORK/pg_many.txt" ) &
( pgb -c 2 -j 1 -T 8 -f "$WORK/many_retry.sql" "$DB" >"$WORK/pg_retry.txt" ) &
wait
read -r wds mints burns credited end_total rec neg over <<<"$(psql_db -At -F ' ' -c "select (select count(*) from icanera_chain.bridge_withdrawals), (select count(*) from icanera_chain.bridge_withdrawals where status='minted'), (select count(*) from icanera_chain.bridge_deposits), (select count(*) from icanera_chain.bridge_deposits where status='credited'), (select (select coalesce(sum(ican_balance), 0) from public.ican_user_wallets) + icanera_chain.locked_total()), (public.ican_chain_dev_reconcile('dev_test_secret') ->> 'ok'), (select count(*) from public.ican_user_wallets where ican_balance < 0), (public.ican_chain_dev_reconcile('dev_test_secret') ->> 'addresses_paid_back_more_than_minted')")"
tps=$(grep -E '^tps' "$WORK/pg_many.txt" | awk '{print int($3)}')
echo "race 6 (100 users, 24 sessions, relayer retrying): $wds withdrawals, $mints minted, $burns burns ($credited credited) ($tps/s); ICEC in wallets + locked $start_total -> $end_total; books balance: $rec; negative: $neg; over-credited addresses: $over"
[ "$(cat "$WORK/pg_many.txt" | failed_of)" = "0" ] && [ "$wds" -gt 200 ] && [ "$mints" -gt 100 ] && [ "$burns" -gt 20 ] && awk -v a="$start_total" -v b="$end_total" 'BEGIN { exit !(a == b) }' && [ "$rec" = "true" ] && [ "$neg" = "0" ] && [ "$over" = "0" ] \
  || { echo "FAILED: ICEC was created or lost, or a book disagrees, under concurrent bridging" >&2; cat "$WORK/pg_many.txt" >&2; exit 1; }
! grep -qi deadlock "$WORK/pg_many.txt" "$WORK/pg_retry.txt" || { echo "FAILED: a deadlock under concurrent bridging" >&2; exit 1; }
echo "100 users bridging at once: every ICEC is accounted for to the last digit, nobody negative, no deadlocks, and the books reconcile."

# 7. The same person on the coin screen and the bridge at once: the two functions never deadlock (they share the wallet row).
psql_db >/dev/null <<'SQL'
UPDATE public.ican_trade_settings SET max_trades_per_minute = 1000000, trading_enabled = TRUE, max_trade_ugx = NULL;
SQL
psql_db -c "INSERT INTO public.wallet_accounts (user_id, balance, currency) VALUES ('$(uid 55)', 100000000, 'UGX'); INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES ('$(uid 55)', 100000)" >/dev/null
link_user 55 5555
{ as_user_sql 55; echo "\\set rid random(1, 2000000000)"; echo "SELECT public.ican_trade_execute('buy', 6000, 'UGX', 'UG', 'coin-' || :rid, NULL, 50);"; echo "COMMIT;"; } > "$WORK/coin.sql"
{ as_user_sql 55; echo "\\set rid random(1, 2000000000)"; echo "SELECT public.ican_bridge_request_withdrawal(2, t.a(5555), 'brg-' || :rid);"; echo "COMMIT;"; } > "$WORK/brg.sql"
out=$(pgb -c 16 -j 4 -T 5 -f "$WORK/coin.sql"@1 -f "$WORK/brg.sql"@1 "$DB")
nc=$(psql_db -Atc "SELECT count(*) FROM public.ican_coin_transactions WHERE user_id = '$(uid 55)'")
nb=$(psql_db -Atc "SELECT count(*) FROM icanera_chain.bridge_withdrawals WHERE user_id = '$(uid 55)'")
echo "race 7 (one person, coin trades and bridge withdrawals at once): $nc coin trades and $nb withdrawals"
[ "$(echo "$out" | failed_of)" = "0" ] && [ "$nc" -gt 10 ] && [ "$nb" -gt 10 ] && ! echo "$out" | grep -qi deadlock && [ "$(reconcile_ok)" = "true" ] \
  || { echo "FAILED: the coin trade and the bridge interfered or deadlocked" >&2; echo "$out" >&2; exit 1; }
echo "coin trades and bridge withdrawals by the same person run side by side with no deadlock."

# ---------------------------------------------------------------- rollback
ROLLBACK1="$ROOT/supabase/rollback/20261020_rollback_chain.sql"
ROLLBACK2="$ROOT/supabase/rollback/20261020_rollback_chain_DROP_DATA.sql"
psql_db -c "UPDATE icanera_chain.chain_settings SET bridge_enabled = TRUE" >/dev/null
wd_before=$(psql_db -Atc "SELECT count(*) FROM icanera_chain.bridge_withdrawals")
locked_before=$(psql_db -Atc "SELECT icanera_chain.locked_total()")
wallets_before=$(psql_db -Atc "SELECT sum(ican_balance) FROM public.ican_user_wallets")
psql_db -f "$ROLLBACK1" >/dev/null 2>&1 || { echo "FAILED: the stop-and-keep rollback failed" >&2; exit 1; }
psql_db -f "$ROLLBACK1" >/dev/null 2>&1 || { echo "FAILED: the stop-and-keep rollback is not safe to run twice" >&2; exit 1; }
left=$(psql_db -Atc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (p.proname LIKE 'ican_chain_%' OR p.proname LIKE 'ican_bridge_%' OR p.proname = 'ican_fx_rate')")
paused=$(psql_db -Atc "SELECT NOT bridge_enabled FROM icanera_chain.chain_settings")
wd_after=$(psql_db -Atc "SELECT count(*) FROM icanera_chain.bridge_withdrawals")
locked_after=$(psql_db -Atc "SELECT icanera_chain.locked_total()")
wallets_after=$(psql_db -Atc "SELECT sum(ican_balance) FROM public.ican_user_wallets")
echo "rollback 1: $left public chain functions left, bridge paused: $paused; withdrawals $wd_before -> $wd_after, locked $locked_before -> $locked_after, wallets untouched: $([ "$wallets_before" = "$wallets_after" ] && echo yes || echo NO)"
[ "$left" = "0" ] && [ "$paused" = "t" ] && [ "$wd_before" = "$wd_after" ] && [ "$locked_before" = "$locked_after" ] && [ "$wallets_before" = "$wallets_after" ] \
  || { echo "FAILED: the stop-and-keep rollback left something behind or touched the books" >&2; exit 1; }
psql_db -c "SET request.jwt.claim.sub = '$(uid 55)'; SET ROLE authenticated; SELECT public.ican_trade_execute('buy', 6000, 'UGX', 'UG', 'after-rollback-1', NULL, 50)" >/dev/null \
  || { echo "FAILED: the icaneracoin trade broke" >&2; exit 1; }
echo "after rollback 1 the API is gone, the icaneracoin trade still works, and the books are exactly as they were."

# the destructive half refuses while ICEC is still locked...
if psql_db -f "$ROLLBACK2" >/dev/null 2>"$WORK/rb2.err"; then echo "FAILED: the destructive rollback ran while ICEC was still locked" >&2; exit 1; fi
grep -q "still locked" "$WORK/rb2.err" || { echo "FAILED: the destructive rollback refused for the wrong reason:" >&2; cat "$WORK/rb2.err" >&2; exit 1; }
[ "$(psql_db -Atc "SELECT count(*) FROM icanera_chain.bridge_withdrawals")" = "$wd_before" ] || { echo "FAILED: a refused rollback dropped data" >&2; exit 1; }
echo "the destructive rollback refuses while ICEC is still locked, and drops nothing."
# ...and drops everything once told to
psql_db -c "SET icanera.force_drop = 'yes'" -f "$ROLLBACK2" >/dev/null 2>&1 || { echo "FAILED: the forced destructive rollback failed" >&2; exit 1; }
[ "$(psql_db -Atc "SELECT to_regnamespace('icanera_chain') IS NULL")" = "t" ] || { echo "FAILED: the schema is still there after the destructive rollback" >&2; exit 1; }
# a clean re-install from nothing works
for f in "${CHAIN_MIGRATIONS[@]}"; do
  quiet psql_db -f "$f" || { echo "FAILED: $(basename "$f") does not apply after a rollback" >&2; exit 1; }
done
[ "$(psql_db -Atc "SELECT bridge_enabled FROM icanera_chain.chain_settings")" = "f" ] || { echo "FAILED: a fresh install does not start with the bridge off" >&2; exit 1; }
echo "the migrations apply again after a full rollback, and start switched off."

# ---------------------------------------------------------------- the verdict
read -r total failed <<<"$(psql_db -At -F ' ' -c "select count(*), count(*) filter (where not ok) from t.results")"
if [ "$failed" != "0" ]; then
  echo "FAILED: $failed of $total database checks failed:" >&2
  psql_db -At -F ' | ' -c "select name, coalesce(info, '') from t.results where not ok order by n" >&2
  exit 1
fi
echo "OK: $total of $total database checks passed."
