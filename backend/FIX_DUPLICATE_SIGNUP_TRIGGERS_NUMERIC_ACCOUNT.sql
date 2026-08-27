-- ================================================================
-- Consolidate ICAN's auth.users signup trigger to exactly ONE, under the
-- collision-safe namespaced name, generating pure-numeric account numbers.
--
-- Root cause of new signups still getting 'ICAN-<timestamp>-<uuid>' account
-- numbers after ACCOUNT_NUMBER_AND_PIN_RESET_SCOPING.sql was run: that file's
-- Part 1 recreated the trigger under the GENERIC name (on_auth_user_created /
-- handle_new_user()) — the exact name FIX_AUTO_SIGNUP_TRIGGER_NAMESPACE_ICAN.sql
-- had deliberately moved away from, because auth.users is a single table
-- shared by 4 apps (ICAN, digital-city-era, FARM-AGENT, mybodaguy) on one
-- Supabase project, and each app's migration does
-- `DROP TRIGGER IF EXISTS on_auth_user_created ... CREATE TRIGGER ...` under
-- that same generic name — so whichever app's SQL ran most recently in the
-- Supabase SQL editor owns it. Meanwhile the OLD namespaced trigger
-- (on_auth_user_created_ican / handle_new_user_ican(), still producing the
-- 'ICAN-' prefixed format) was never dropped, so it kept firing.
--
-- This file drops BOTH known ICAN trigger names unconditionally and
-- recreates exactly one, back under the namespaced name so another app's
-- migration can never silently reclaim it again, with the pure-numeric
-- account_number format and the never-block-signup exception guard.
--
-- Run once in the Supabase SQL Editor. Safe to run more than once.
-- After running this, run MIGRATE_EXISTING_ACCOUNT_NUMBERS_TO_NUMERIC.sql to
-- fix any accounts (like the one just created) that already got the old
-- 'ICAN-...' format before this ran.
-- ================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_created_ican ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_ican();

CREATE OR REPLACE FUNCTION public.handle_new_user_ican()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_accounts (
    user_id,
    email,
    account_number,
    account_type,
    country_code,
    status,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    -- Matches walletAccountService.js's generateAccountNumber(): 16 raw
    -- digits, leading digit 1 = personal (this trigger only ever creates
    -- the personal account on signup, so it's always '1').
    '1' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') ||
      (ABS(('x' || SUBSTRING(MD5(NEW.id::text), 1, 8))::bit(32)::int) % 10)::text,
    'personal',
    COALESCE((NEW.raw_user_meta_data->>'country_code')::VARCHAR(2), NULL),
    'active',
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never let a bug here block the user's account creation (or any other
    -- app's signup trigger firing on the same auth.users insert).
    RAISE LOG 'handle_new_user_ican error for %: %', NEW.email, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created_ican
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_ican();

DO $$
BEGIN
  RAISE NOTICE '✅ Exactly one ICAN signup trigger now installed (on_auth_user_created_ican), producing numeric-only account numbers.';
END $$;
