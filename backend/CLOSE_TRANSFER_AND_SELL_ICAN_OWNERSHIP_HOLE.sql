-- ============================================================================
-- URGENT — CLOSE: transfer_ican / sell_ican_coins accept an arbitrary
-- p_from_user / p_user_id with no check that it's the caller
-- ============================================================================
-- Run this immediately in the shared Supabase SQL editor. It's the same
-- project every one of ICAN, digital-city-era, farm-agent, and mybodaguy
-- points at, so this one run fixes all four apps.
--
-- transfer_ican(p_from_user, p_to_user, p_amount, ...) is called directly
-- from the browser (supabase.rpc('transfer_ican', {...})) by every app's
-- "Send IcanEra" feature, exactly the way CLOSE_BUY_ICAN_DIRECT_CALL_HOLE.sql
-- already documented for buy_ican_coins. Every version of the function on
-- record (ICAN_CROSS_APP_WALLET_MIGRATION.sql, ICAN_FEE_STRUCTURE_UPDATE.sql,
-- ICAN_TRANSACTION_CONTEXT_MIGRATION.sql) debits whatever wallet
-- p_from_user names, with SECURITY DEFINER privileges, and never once checks
-- that p_from_user is auth.uid() — unlike transfer_ican_to_business, which
-- already does this correctly (ICAN_BUSINESS_WALLET_TRANSFERS.sql line ~120).
-- Any signed-in user of any of the four apps can currently drain any other
-- user's real ICAN balance by calling the exact same RPC their own app
-- already calls, just substituting a different user's id for p_from_user.
--
-- sell_ican_coins(p_user_id, p_ican_amount, ...) has the identical gap on
-- p_user_id, and — unlike buy_ican_coins — is meant to stay directly
-- client-callable (icanWalletService.js's sellICAN() calls it straight from
-- the browser for the offline cashier-payout flow, and request_ican_payout
-- calls it server-side for Flutterwave cash-outs), so it cannot simply be
-- locked to service_role the way buy_ican_coins was. It needs the same
-- ownership check instead. Any signed-in user can currently force-sell
-- (destroy) another user's ICAN balance with nothing paid out to the victim.
--
-- FIX: patch both functions in place to require auth.uid() = the debited
-- user, whatever their current live body happens to be — looked up and
-- patched dynamically (same reasoning as CLOSE_BUY_ICAN_DIRECT_CALL_HOLE.sql:
-- the live signature/body may not exactly match any single migration file on
-- disk, since it's uncertain which of the historical versions actually ran
-- on this database). Idempotent: skips a function whose body already has the
-- check.
-- ============================================================================

DO $$
DECLARE
  r        RECORD;
  def      TEXT;
  patched  TEXT;
  targets  TEXT[] := ARRAY['transfer_ican', 'sell_ican_coins'];
  checks   JSONB := jsonb_build_object(
    'transfer_ican',
      'IF auth.uid() IS NULL OR auth.uid() <> p_from_user THEN RETURN jsonb_build_object(''success'', false, ''error'', ''Not authorized: sender must be the authenticated user''); END IF;',
    'sell_ican_coins',
      'IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RETURN jsonb_build_object(''success'', false, ''error'', ''Not authorized: p_user_id must be the authenticated user''); END IF;'
  );
  fname    TEXT;
  check_sql TEXT;
  found_any BOOLEAN;
BEGIN
  FOREACH fname IN ARRAY targets LOOP
    found_any := false;
    check_sql := checks->>fname;

    FOR r IN
      SELECT p.oid, p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = fname AND n.nspname = 'public'
    LOOP
      found_any := true;
      def := pg_get_functiondef(r.oid);

      IF position('sender must be the authenticated user' in def) > 0
         OR position('p_user_id must be the authenticated user' in def) > 0 THEN
        RAISE NOTICE 'Already patched, skipping: %', r.sig;
        CONTINUE;
      END IF;

      -- Insert the ownership check right after the body's opening BEGIN
      -- (the first BEGIN in the definition text — the signature/header
      -- before it never contains the word BEGIN).
      patched := regexp_replace(def, 'BEGIN', 'BEGIN' || E'\n  ' || check_sql, '');

      IF patched = def THEN
        RAISE EXCEPTION 'Could not locate BEGIN in % — inspect manually, did not patch.', r.sig;
      END IF;

      EXECUTE patched;
      RAISE NOTICE 'Patched: %', r.sig;
    END LOOP;

    IF NOT found_any THEN
      RAISE EXCEPTION 'public.% does not exist — nothing to patch.', fname;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  RAISE NOTICE '✅ transfer_ican and sell_ican_coins now require auth.uid() to match the debited user.';
END $$;
