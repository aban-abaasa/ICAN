#!/usr/bin/env bash
# Database tests for the in-system ICEC-S (20261024100000_icec_stable_in_system.sql), against a throwaway Postgres 14+.
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
MIGS=("$ROOT/supabase/migrations/20261024100000_icec_stable_in_system.sql" "$ROOT/supabase/migrations/20261025100000_icec_stable_automatic.sql" "$ROOT/supabase/migrations/20261026100000_icec_stable_dollar_pool.sql")
for MIG in "${MIGS[@]}"; do
  psql_db -f "$MIG" >/dev/null 2>"$WORK/err.txt" || { grep -v NOTICE "$WORK/err.txt" >&2; echo "$(basename "$MIG") failed" >&2; exit 2; }
done
for MIG in "${MIGS[@]}"; do
  psql_db -f "$MIG" >/dev/null 2>&1 || { echo "re-applying $(basename "$MIG") FAILED" >&2; exit 1; }
done
echo "the three migrations applied, and again (safe to run twice)."
psql_db -c "UPDATE icanera_stable.settings SET fee_bps = 77" >/dev/null
for MIG in "${MIGS[@]}"; do psql_db -f "$MIG" >/dev/null 2>&1; done
[ "$(psql_db -Atc "SELECT fee_bps FROM icanera_stable.settings")" = "77" ] || { echo "re-applying overwrote an administrator's setting" >&2; exit 1; }
psql_db -c "UPDATE icanera_stable.settings SET fee_bps = 50" >/dev/null
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
