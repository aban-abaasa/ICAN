-- ============================================================
-- FIX: User Search for CMMS "Add User" workflow
-- Problem: searchICANUsers cannot find auth users who don't
--          have rows in all_users / ican_user_profiles / profiles
-- Solution: Create list_auth_users RPC (SECURITY DEFINER)
--           that searches auth.users directly
-- ============================================================

-- 1. RPC to search auth.users (the only guaranteed source of truth)
DROP FUNCTION IF EXISTS public.list_auth_users(TEXT, INT);

CREATE OR REPLACE FUNCTION public.list_auth_users(
  p_search TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  phone TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
    SELECT
      au.id,
      au.email::TEXT,
      COALESCE(
        au.raw_user_meta_data->>'full_name',
        au.raw_user_meta_data->>'name',
        au.email::TEXT
      ) AS full_name,
      COALESCE(au.raw_user_meta_data->>'phone', au.phone::TEXT) AS phone
    FROM auth.users au
    WHERE
      au.email ILIKE '%' || p_search || '%'
      OR (au.raw_user_meta_data->>'full_name') ILIKE '%' || p_search || '%'
      OR (au.raw_user_meta_data->>'name') ILIKE '%' || p_search || '%'
    ORDER BY au.created_at DESC
    LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_auth_users TO authenticated;

-- 2. Auto-sync trigger: whenever a new user signs up in auth.users,
--    automatically insert them into all_users so search always works
CREATE OR REPLACE FUNCTION public.fn_sync_auth_user_to_all_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.all_users (user_id, email, full_name, user_type, source_table)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    'auth_user',
    'auth.users'
  )
  ON CONFLICT (email) DO UPDATE SET
    user_id = COALESCE(all_users.user_id, EXCLUDED.user_id),
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), all_users.full_name),
    updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_sync_auth_user ON auth.users;
CREATE TRIGGER trg_sync_auth_user
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_auth_user_to_all_users();

-- 3. Backfill: sync any missing auth users into all_users right now
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'all_users') THEN
    INSERT INTO public.all_users (user_id, email, full_name, user_type, source_table)
    SELECT
      au.id,
      au.email,
      COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', ''),
      'auth_user',
      'auth.users'
    FROM auth.users au
    WHERE au.email IS NOT NULL
      AND au.email NOT IN (SELECT email FROM public.all_users WHERE email IS NOT NULL)
    ON CONFLICT (email) DO UPDATE SET
      user_id = COALESCE(all_users.user_id, EXCLUDED.user_id),
      full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), all_users.full_name),
      updated_at = NOW();

    RAISE NOTICE 'Backfilled missing auth users into all_users';
  END IF;
END $$;

-- 4. Fix RLS on all_users so authenticated users can read it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'all_users') THEN
    ALTER TABLE public.all_users ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "all_users_select_policy" ON public.all_users;
    CREATE POLICY "all_users_select_policy" ON public.all_users
    FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- 5. Fix RLS on ican_user_profiles if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ican_user_profiles') THEN
    ALTER TABLE public.ican_user_profiles ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "ican_profiles_select_policy" ON public.ican_user_profiles;
    CREATE POLICY "ican_profiles_select_policy" ON public.ican_user_profiles
    FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- 6. Fix RLS on profiles if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
    CREATE POLICY "profiles_select_policy" ON public.profiles
    FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

SELECT 'User search fix applied! list_auth_users RPC + auto-sync trigger created.' AS status;
