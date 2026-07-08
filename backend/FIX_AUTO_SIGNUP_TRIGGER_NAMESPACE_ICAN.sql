-- ============================================================================
-- FIX: New signups failing with "Database error saving new user" (500)
-- ============================================================================
-- ROOT CAUSE: auth.users is a single shared table across 4 apps (ICAN,
-- digital-city-era, FARM-AGENT, mybodaguy) on one Supabase project. ICAN,
-- digital-city-era, and FARM-AGENT all installed a trigger under the SAME
-- generic name (on_auth_user_created -> public.handle_new_user()). Each
-- app's migration does `DROP TRIGGER IF EXISTS on_auth_user_created` then
-- recreates it — so whichever app's SQL was run most recently in the
-- Supabase SQL editor silently overwrites the other two apps' signup logic.
-- If that surviving function's INSERT throws for any reason (a NOT NULL
-- column, a bad cast, whatever), the exception propagates all the way up
-- and aborts the whole auth.users insert, which is exactly what "Database
-- error saving new user" is.
--
-- FIX: give ICAN's own trigger a unique name so it can never collide with
-- or be overwritten by another app's migration again — the same pattern
-- mybodaguy already correctly uses (on_auth_user_created_mbg). Also wraps
-- the body in an exception handler so a future bug here can never block
-- account creation for ICAN or any other app sharing this table.
--
-- Run this in ICAN's Supabase SQL editor. Also run the matching
-- FIX_AUTO_SIGNUP_TRIGGER_NAMESPACE_DCE.sql (digital-city-era) and
-- FIX_AUTO_SIGNUP_TRIGGER_NAMESPACE_FARMAGENT.sql (FARM-AGENT) so all
-- three end up as independent, non-colliding triggers.
-- ============================================================================

-- ON CONFLICT (user_id) below requires a real unique constraint on that
-- column. AUTO_CREATE_USER_ACCOUNTS.sql was supposed to have added one
-- (user_id_unique) but evidently never actually ran against this project —
-- that's very likely also *why* ICAN's on_auth_user_created never existed
-- and a different app's trigger has been the only one firing here. Dedupe
-- first (keep the oldest row per user_id) since the constraint can't be
-- added while duplicates exist, then add it if missing.
DELETE FROM public.user_accounts ua1
WHERE EXISTS (
  SELECT 1 FROM public.user_accounts ua2
  WHERE ua1.user_id = ua2.user_id
    AND ua1.id != ua2.id
    AND (ua2.created_at < ua1.created_at
         OR (ua2.created_at = ua1.created_at AND ua2.id < ua1.id))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_id_unique'
  ) THEN
    ALTER TABLE public.user_accounts ADD CONSTRAINT user_id_unique UNIQUE (user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user_ican()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_accounts (
    user_id,
    email,
    account_number,
    country_code,
    status,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    'ICAN-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || SUBSTRING(NEW.id::text, 1, 8),
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

DROP TRIGGER IF EXISTS on_auth_user_created_ican ON auth.users;
CREATE TRIGGER on_auth_user_created_ican
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_ican();

-- Backfill any users who signed up while the generic trigger belonged to a
-- different app and therefore never got a user_accounts row.
INSERT INTO public.user_accounts (user_id, email, account_number, country_code, status, created_at, updated_at)
SELECT
  u.id,
  u.email,
  'ICAN-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || SUBSTRING(u.id::text, 1, 8),
  NULL,
  'active',
  NOW(),
  NOW()
FROM auth.users u
LEFT JOIN public.user_accounts ua ON u.id = ua.user_id
WHERE ua.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE '✅ ICAN signup trigger renamed to on_auth_user_created_ican — can no longer be overwritten by another app''s migration, and can no longer block signup on its own error.';
END $$;
