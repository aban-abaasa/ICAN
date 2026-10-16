#!/usr/bin/env bash
# Database tests for the in-system ICEC-S (20261024100000_icec_stable_in_system.sql .. 20261104100000_icec_stable_fee_off_by_default.sql), against a throwaway Postgres 14+.
#   supabase/tests/stable_unit/run.sh      (connection from the usual libpq variables; touches nothing real)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_stable_test}"
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT
psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null 2>&1
for f in "$ROOT/supabase/tests/icaneracoin_chart/00_stub.sql" "$HERE/00_stub.sql"; do
  psql_db -f "$f" >/dev/null 2>"$WORK/err.txt" || { grep -v NOTICE "$WORK/err.txt" >&2; echo "$(basename "$f") failed" >&2; exit 2; }
done
MIGS=("$ROOT/supabase/migrations/20261024100000_icec_stable_in_system.sql" "$ROOT/supabase/migrations/20261025100000_icec_stable_automatic.sql" "$ROOT/supabase/migrations/20261026100000_icec_stable_dollar_pool.sql" "$ROOT/supabase/migrations/20261027100000_icec_stable_global_currencies.sql" "$ROOT/supabase/migrations/20261028100000_icec_stable_cash_out_fee.sql" "$ROOT/supabase/migrations/20261104100000_icec_stable_fee_off_by_default.sql")
for MIG in "${MIGS[@]}"; do
  psql_db -f "$MIG" >/dev/null 2>"$WORK/err.txt" || { grep -v NOTICE "$WORK/err.txt" >&2; echo "$(basename "$MIG") failed" >&2; exit 2; }
done
for MIG in "${MIGS[@]}"; do
  psql_db -f "$MIG" >/dev/null 2>&1 || { echo "re-applying $(basename "$MIG") FAILED" >&2; exit 1; }
done
echo "the six migrations applied, and again (safe to run twice)."
# no fee as shipped: the value is 0 and so is the default for a fresh row
[ "$(psql_db -Atc "SELECT fee_bps FROM icanera_stable.settings")" = "0" ] || { echo "the cash-out fee is not 0 after the migrations" >&2; exit 1; }
[ "$(psql_db -Atc "SELECT column_default FROM information_schema.columns WHERE table_schema = 'icanera_stable' AND table_name = 'settings' AND column_name = 'fee_bps'")" = "0" ] || { echo "the default cash-out fee is not 0" >&2; exit 1; }
echo "no fee as shipped."
# a fee the developer panel sets later survives re-running the whole bundle (including a deliberate 3%, the old default)
for FEE in 77 300; do
  psql_db -c "UPDATE icanera_stable.settings SET fee_bps = $FEE" >/dev/null
  for MIG in "${MIGS[@]}"; do psql_db -f "$MIG" >/dev/null 2>&1; done
  [ "$(psql_db -Atc "SELECT fee_bps FROM icanera_stable.settings")" = "$FEE" ] || { echo "re-applying overwrote an administrator's fee of $FEE" >&2; exit 1; }
done
psql_db -c "UPDATE icanera_stable.settings SET fee_bps = 0" >/dev/null
echo "an administrator's settings survive a re-run."

for f in "$HERE"/0[1-9]_*.sql; do
  echo "running $(basename "$f")"
  psql_db -f "$f" >/dev/null 2>"$WORK/test.err" || { grep -v NOTICE "$WORK/test.err" >&2; echo "$(basename "$f") aborted" >&2; exit 1; }
done

read -r total failed <<<"$(psql_db -At -F ' ' -c "select count(*), count(*) filter (where not ok) from t.results")"
if [ "$failed" != "0" ]; then
  echo "FAILED: $failed of $total database checks failed:" >&2
  psql_db -At -F ' | ' -c "select name, coalesce(info, '') from t.results where not ok order by n" >&2
  exit 1
fi
echo "OK: $total of $total database checks passed."
