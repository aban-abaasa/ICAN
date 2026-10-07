-- ============================================================================
-- SECURE DEV / SUPPORT PANEL ACCESS: the Dev Console is opened by a real
-- Supabase account on a server-side allowlist, not by credentials and a token
-- that ship inside the public JavaScript bundle.
--
-- Before: the sign-in page compared an email and password written in the
-- frontend code, and every ican_dev_* function checked a fixed token that was
-- also written in the frontend code (and is committed in git history). Anyone
-- who read the bundle could call those functions straight over the public API.
--
-- After:
--   1. public.ican_dev_operators      allowlist of emails (no grants, RLS on).
--   2. public.ican_is_dev_operator()  true only for a signed-in session whose
--                                     email is on that list.
--   3. public.ican_get_dev_token()    hands the panel its token, but ONLY to
--                                     an allowlisted session.
--   4. public.ican_dev_secret()       the token itself: random, stored in the
--                                     database, never granted to anon or
--                                     authenticated, rotatable.
--   5. Every existing function that compared against the old fixed token is
--      rewritten in place to compare against ican_dev_secret() instead, using
--      IS DISTINCT FROM so a NULL token can no longer slip through the check.
--      The old token stops working the moment this runs. Support-console links
--      keep working: they now receive the new secret when a visitor verifies.
--
-- Before you run it, create the account: sign up in IcanEra with the email
-- below (use a NEW strong password, the old one is in git history), confirm
-- the email, then run this file. Add more operators with the INSERT in section 1.
-- Safe to run twice. Running it again does NOT rotate the secret; call
-- select public.ican_rotate_dev_secret(); as an operator for that.
--
-- Not covered here: other apps' own dev panels (digital-city-era, farm-agentera,
-- mybodaguy) share landing_messages_is_dev(); this file swaps the old ICAN
-- token inside it for the new secret, so the old one is dead there too.
-- ============================================================================


-- 1. Allowlist ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_dev_operators (
  email    TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.ican_dev_operators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ican_dev_operators FROM PUBLIC, anon, authenticated;

INSERT INTO public.ican_dev_operators (email) VALUES
  ('icaneraera@gmail.com')
ON CONFLICT (email) DO NOTHING;


-- 2. The secret (one row, only readable through ican_dev_secret()) ------------
CREATE TABLE IF NOT EXISTS public.ican_dev_secret_store (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  secret     TEXT NOT NULL,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.ican_dev_secret_store ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ican_dev_secret_store FROM PUBLIC, anon, authenticated;

INSERT INTO public.ican_dev_secret_store (id, secret)
VALUES (TRUE, 'dev_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (id) DO NOTHING;

-- Called by the SECURITY DEFINER dev functions as their owner. Nobody who talks
-- to the API (anon or authenticated) may call it, or the secret would leak.
CREATE OR REPLACE FUNCTION public.ican_dev_secret()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT secret FROM public.ican_dev_secret_store WHERE id $$;
REVOKE ALL ON FUNCTION public.ican_dev_secret() FROM PUBLIC, anon, authenticated;


-- 3. Who is allowed -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_is_dev_operator()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND COALESCE(auth.jwt() ->> 'email', '') <> ''
     AND EXISTS (SELECT 1 FROM public.ican_dev_operators o WHERE lower(o.email) = lower(auth.jwt() ->> 'email'));
$$;
REVOKE ALL ON FUNCTION public.ican_is_dev_operator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_is_dev_operator() TO authenticated;

CREATE OR REPLACE FUNCTION public.ican_get_dev_token()
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.ican_is_dev_operator() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN public.ican_dev_secret();
END;
$$;
REVOKE ALL ON FUNCTION public.ican_get_dev_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_get_dev_token() TO authenticated;

-- Rotating signs out every open dev panel and every support link visitor until
-- they re-verify. Use it if an operator leaves or you suspect the secret leaked.
CREATE OR REPLACE FUNCTION public.ican_rotate_dev_secret()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.ican_is_dev_operator() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  UPDATE public.ican_dev_secret_store
     SET secret = 'dev_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         rotated_at = NOW()
   WHERE id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.ican_rotate_dev_secret() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_rotate_dev_secret() TO authenticated;


-- 4. Rewrite every function that still checks the old fixed token ------------
-- Works on what is actually deployed (not on the repo files), keeps each
-- function's owner, grants, SECURITY DEFINER and search_path, and does nothing
-- once no function contains the old token.
DO $$
DECLARE
  r       RECORD;
  v_def   TEXT;
  v_new   TEXT;
  v_old   CONSTANT TEXT := 'dev_ICAN_Pr0_KV25';
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc LIKE '%' || v_old || '%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    -- "x != token" is NULL (so the guard is skipped) when x is NULL; make it a hard test.
    v_new := regexp_replace(v_def, '(\m\w*dev_token)\s*(!=|<>)\s*''' || v_old || '''',
                            '\1 IS DISTINCT FROM public.ican_dev_secret()', 'g');
    v_new := replace(v_new, '''' || v_old || '''', 'public.ican_dev_secret()');
    IF v_new LIKE '%' || v_old || '%' THEN
      RAISE WARNING 'ican secure dev access: % still mentions the old token in a form this file does not rewrite, fix it by hand', r.proname;
    END IF;
    IF v_new <> v_def THEN
      EXECUTE v_new;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'ican secure dev access: rewrote % function(s) to use ican_dev_secret()', v_count;
END $$;

-- Scheduled jobs that carried the old token in their command text.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE cron.job
         SET command = replace(command, '''dev_ICAN_Pr0_KV25''', 'public.ican_dev_secret()')
       WHERE command LIKE '%dev_ICAN_Pr0_KV25%'
    $q$;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'ican secure dev access: could not update cron.job, edit any job that mentions the old token by hand';
END $$;
