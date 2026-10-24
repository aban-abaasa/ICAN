#!/usr/bin/env bash
# Runs the PitchIn product-badge database tests against a throwaway Postgres database.
#
#   supabase/tests/pitch_badges/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# Uses the REAL migration under test; the auth schema, the PitchIn / store / CMMS tables it reads, the developer allowlist and the
# platform-fee credit are stubbed (so the payment logic is proven against a stand-in for that last function, not the live one).
# Nothing touches a real Supabase project.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_pitchbadge_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20261119100000_video_product_badges.sql"
ROLLBACK="$ROOT/supabase/rollback/20261119_rollback_video_product_badges.sql"
PASTE="$ROOT/VIDEO_PRODUCT_BADGES_PASTE_INTO_SUPABASE.sql"
DB="${DB_NAME:-ican_pitchbadge_test}"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1' EXIT

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null
for f in "$HERE/00_stub.sql" "$HERE/01_seed.sql" "$MIGRATION" "$HERE/02_tests.sql"; do
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1) || { echo "$out" | grep -v NOTICE >&2; echo "FAILED: $f" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
done

# The paste-into-Supabase copy must be the migration, byte for byte.
cmp -s "$MIGRATION" "$PASTE" && echo "PASS paste file equals the migration" || { echo "FAIL paste file differs from the migration"; exit 1; }

# Re-running must not undo a price the developer set, and must not error.
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -c "UPDATE public.ican_service_prices SET price_ic = 7, charged = true WHERE key = 'pitch_product_badge'" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIGRATION" >/dev/null 2>&1 || { echo "FAIL migration is idempotent (error on second run)"; exit 1; }
kept=$(psql -X -q -t -d "$DB" -c "SELECT price_ic::text || ',' || charged::text FROM public.ican_service_prices WHERE key = 'pitch_product_badge'" | tr -d ' ')
[ "$kept" = "7.00000000,true" ] && echo "PASS re-running the migration keeps the developer's price and switch" || { echo "FAIL re-run changed the price: $kept"; exit 1; }

# The rollback removes the feature and leaves pitches and wallets alone.
pitches=$(psql -X -q -t -d "$DB" -c "SELECT count(*) FROM public.pitches" | tr -d ' ')
wallet=$(psql -X -q -t -d "$DB" -c "SELECT ican_balance FROM public.ican_business_wallets LIMIT 1" | tr -d ' ')
psql -X -q -d "$DB" -c "DROP VIEW t.badges, t.charges" >/dev/null   # the tests' own inspection views would otherwise block the drop
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROLLBACK" >/dev/null 2>&1 || { echo "FAIL rollback errored"; exit 1; }
left=$(psql -X -q -t -d "$DB" -c "SELECT (to_regclass('public.video_product_badges') IS NULL)::text || ',' || (to_regclass('public.ican_service_prices') IS NULL)::text || ',' || (to_regprocedure('public.fn_publish_video_badge(uuid)') IS NULL)::text || ',' || (SELECT count(*) FROM public.pitches)::text || ',' || (SELECT ican_balance FROM public.ican_business_wallets LIMIT 1)::text" | tr -d ' ')
[ "$left" = "true,true,true,$pitches,$wallet" ] && echo "PASS rollback removes the feature and keeps every pitch and wallet" || { echo "FAIL rollback left: $left"; exit 1; }
echo "ALL PITCH BADGE TESTS PASSED"
