-- ============================================================================
-- SUPABASE LINTER SECURITY FIXES — Run ONCE in Supabase SQL Editor
-- ============================================================================
-- Fixes the 14 ERROR-level findings (auth_users_exposed x2,
-- security_definer_view x12) plus the function_search_path_mutable WARN
-- findings (Part 4) from the Supabase database linter, across the shared
-- ICAN / digital-city-era / FARM-AGENT / mybodaguy Supabase project.
--
-- ROOT CAUSE (applies to every security_definer_view finding):
-- Views created without `security_invoker = true` run with the privileges
-- of the view OWNER (a superuser-like role), not the querying user. That
-- means the view silently bypasses RLS on its underlying tables for every
-- caller, including anon. Setting security_invoker = true makes the view
-- honor the RLS policies of whoever is actually running the query.
--
-- PART 1 fixes a real data leak, not just linter noise: v_personal_tithe_
-- tracking / v_business_tithe_tracking / v_transactions_with_tithe joined
-- auth.users with NO per-user filter, so `.single()` calls in
-- titheTransactionService.js / TitheTransactionReport.jsx returned an
-- arbitrary user's tithe summary + email to every caller. Fixed by scoping
-- each view to auth.uid() and swapping the auth.users join for
-- auth.email(), which also removes the auth.users exposure entirely (the
-- `authenticated` role has no SELECT grant on auth.users, so a
-- security_invoker view that still touched auth.users would have failed
-- with "permission denied" for normal users).
--
-- PART 2 is the mechanical fix for the remaining 10 flagged views
-- (dashboards/leaderboards meant to be broadly readable by authenticated
-- users, per their already-permissive `USING (true)` RLS policies on the
-- underlying tables — security_invoker=true preserves that behavior while
-- making it explicit instead of accidental) plus the FARM-AGENT messaging
-- views, where security_invoker=true also closes a real leak: any caller
-- could currently read every user's conversation summaries/unread counts.
-- ============================================================================

-- ============================================================================
-- PART 1: Tithe views — scope to auth.uid(), stop touching auth.users
-- ============================================================================

-- CREATE OR REPLACE VIEW cannot change an existing column's type, and
-- auth.email() (text) replaces what used to be u.email (varchar(255)) —
-- so these three are dropped and recreated instead of replaced. Dropping
-- a view also drops its previously granted privileges, so grants are
-- reissued explicitly below (and anon access is intentionally not
-- restored — these carry personal financial data and auth.uid() is NULL
-- for anon anyway, so there was never a legitimate reason for it to read).

DROP VIEW IF EXISTS public.v_transactions_with_tithe;
CREATE VIEW public.v_transactions_with_tithe
WITH (security_invoker = true) AS
SELECT
  t.id,
  t.user_id,
  auth.email() as user_email,
  t.created_at,
  t.amount,
  t.description,
  t.transaction_type,
  t.status,
  ttr.tithe_type,
  ttr.tithe_calculated,
  ttr.amount_paid as tithe_paid,
  ttr.amount_remaining as tithe_remaining,
  ttr.tithe_status,
  ttr.recipient_name,
  ttr.payment_transaction_id,
  CASE
    WHEN ttr.tithe_status = 'paid' THEN '✅ Paid'
    WHEN ttr.tithe_status = 'partially_paid' THEN '⚠️ Partially Paid'
    WHEN ttr.tithe_status = 'pending' THEN '⏳ Pending'
    ELSE '❓ ' || ttr.tithe_status
  END as tithe_status_display
FROM ican_transactions t
LEFT JOIN tithe_transaction_records ttr ON t.id = ttr.source_transaction_id
WHERE t.transaction_type IN ('income', 'sale', 'gift', 'bonus')
  AND t.user_id = auth.uid()
ORDER BY t.created_at DESC;
GRANT SELECT ON public.v_transactions_with_tithe TO authenticated;

DROP VIEW IF EXISTS public.v_personal_tithe_tracking;
CREATE VIEW public.v_personal_tithe_tracking
WITH (security_invoker = true) AS
SELECT
  me.id,
  auth.email() as email,
  ts.personal_tithe_total,
  ts.personal_tithe_paid,
  ts.personal_tithe_remaining,
  ts.personal_pending_count,
  ts.last_personal_payment_date,
  COUNT(CASE WHEN ttr.tithe_status = 'pending' THEN 1 END) as pending_transactions
FROM (SELECT auth.uid() AS id) me
LEFT JOIN user_tithe_summary ts ON ts.user_id = me.id
LEFT JOIN tithe_transaction_records ttr ON ttr.user_id = me.id AND ttr.tithe_type = 'personal'
GROUP BY me.id, ts.personal_tithe_total, ts.personal_tithe_paid, ts.personal_tithe_remaining,
         ts.personal_pending_count, ts.last_personal_payment_date;
GRANT SELECT ON public.v_personal_tithe_tracking TO authenticated;

DROP VIEW IF EXISTS public.v_business_tithe_tracking;
CREATE VIEW public.v_business_tithe_tracking
WITH (security_invoker = true) AS
SELECT
  me.id,
  auth.email() as email,
  ts.business_tithe_total,
  ts.business_tithe_paid,
  ts.business_tithe_remaining,
  ts.business_pending_count,
  ts.last_business_payment_date,
  COUNT(CASE WHEN ttr.tithe_status = 'pending' THEN 1 END) as pending_transactions
FROM (SELECT auth.uid() AS id) me
LEFT JOIN user_tithe_summary ts ON ts.user_id = me.id
LEFT JOIN tithe_transaction_records ttr ON ttr.user_id = me.id AND ttr.tithe_type = 'business'
GROUP BY me.id, ts.business_tithe_total, ts.business_tithe_paid, ts.business_tithe_remaining,
         ts.business_pending_count, ts.last_business_payment_date;
GRANT SELECT ON public.v_business_tithe_tracking TO authenticated;

-- ============================================================================
-- PART 2: Remaining flagged views — add security_invoker = true
-- ============================================================================

DO $$
BEGIN
  ALTER VIEW public.mbg_committee_hierarchy SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'mbg_committee_hierarchy: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER VIEW public.supermarket_ownership SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'supermarket_ownership: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER VIEW public.ican_wallet_portfolio SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'ican_wallet_portfolio: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER VIEW public.ican_tx_summary_by_app SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'ican_tx_summary_by_app: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER VIEW public.mbg_rider_ican_leaderboard SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'mbg_rider_ican_leaderboard: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER VIEW public.dce_customer_ican_loyalty SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'dce_customer_ican_loyalty: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER VIEW public.ican_agent_commission_tracker SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'ican_agent_commission_tracker: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER VIEW public.conversation_blockchain_stats SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'conversation_blockchain_stats: %', SQLERRM;
END $$;

-- FARM-AGENT messaging views live in both the "messages" schema and a
-- "public" wrapper (SELECT * FROM messages.x). Both layers need
-- security_invoker = true — the public wrapper needs it to pass the real
-- caller's identity through, and the messages.* view needs it so that
-- identity is actually checked against conversation_participants/messages
-- RLS instead of being bypassed again at the inner layer.
DO $$
BEGIN
  ALTER VIEW public.conversation_summaries SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'public.conversation_summaries: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER VIEW public.unread_message_counts SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'public.unread_message_counts: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER VIEW messages.conversation_summaries SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'messages.conversation_summaries: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER VIEW messages.unread_message_counts SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'messages.unread_message_counts: %', SQLERRM;
END $$;

-- ============================================================================
-- PART 3: Verification
-- ============================================================================

-- security_invoker views show reloptions containing security_invoker=true
SELECT
  n.nspname as schema,
  c.relname as view_name,
  c.reloptions
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v'
  AND c.relname IN (
    'v_transactions_with_tithe', 'v_personal_tithe_tracking', 'v_business_tithe_tracking',
    'mbg_committee_hierarchy', 'supermarket_ownership', 'ican_wallet_portfolio',
    'ican_tx_summary_by_app', 'mbg_rider_ican_leaderboard', 'dce_customer_ican_loyalty',
    'ican_agent_commission_tracker', 'conversation_blockchain_stats',
    'conversation_summaries', 'unread_message_counts'
  )
ORDER BY view_name;

-- ============================================================================
-- PART 4: function_search_path_mutable (WARN) — every public function
-- ============================================================================
-- A function with no search_path set resolves unqualified identifiers
-- (table names, other function calls) against whatever search_path the
-- calling session happens to have — which a caller can influence (e.g. by
-- creating a same-named object earlier in their own schema), letting them
-- redirect what the function actually reads/writes. This affects 70+
-- functions across the project (the linter output was truncated before it
-- finished listing them all), many of them SECURITY DEFINER (credit_ican_
-- earning, transfer_ican, mbg_credit_rider_delivery, etc.) where that
-- redirection risk is highest.
--
-- Rather than hand-transcribe ~70+ argument signatures (several are
-- overloaded, e.g. assign_chairperson / mbg_assign_rider each have two
-- versions), this loops over every function in the public schema that has
-- no search_path entry in its config and pins one dynamically, using its
-- own exact signature via pg_get_function_identity_arguments — safe to
-- re-run, and catches functions beyond what fit in the truncated report.
-- `public, pg_temp` (not empty) is used so existing unqualified references
-- inside these function bodies keep resolving against public.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid,
           n.nspname AS schema_name,
           p.proname AS func_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_temp',
        r.schema_name, r.func_name, r.args
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped %.%(%): %', r.schema_name, r.func_name, r.args, SQLERRM;
    END;
  END LOOP;
END $$;

-- Verification: should return zero rows once Part 4 has run
SELECT n.nspname AS schema, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
    WHERE cfg LIKE 'search_path=%'
  )
ORDER BY function_name;

DO $$
BEGIN
  RAISE NOTICE '✅ Linter security fixes applied — re-run the Supabase database linter to confirm all findings are cleared.';
END $$;
