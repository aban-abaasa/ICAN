-- ============================================================
-- CMMS User Search Scalability Hardening
-- Goal: support very high concurrent admin search traffic
-- ============================================================

-- 1) Extensions used by fast text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2) Helpful indexes (created only when table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'all_users'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_all_users_email_lower
      ON public.all_users (lower(email));
    CREATE INDEX IF NOT EXISTS idx_all_users_full_name_trgm
      ON public.all_users USING gin (full_name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_all_users_email_trgm
      ON public.all_users USING gin (email gin_trgm_ops);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ican_user_profiles'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_ican_profiles_email_lower
      ON public.ican_user_profiles (lower(email));
    CREATE INDEX IF NOT EXISTS idx_ican_profiles_full_name_trgm
      ON public.ican_user_profiles USING gin (full_name gin_trgm_ops);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_profiles_email_lower
      ON public.profiles (lower(email));
    CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm
      ON public.profiles USING gin (full_name gin_trgm_ops);
  END IF;
END $$;

-- 3) Single RPC endpoint for user lookup (RPC-first client path)
DROP FUNCTION IF EXISTS public.search_ican_users(TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.search_ican_users(
  p_search TEXT,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  source_table TEXT,
  rank_score DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search TEXT;
  v_limit INT;
  v_offset INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_search := trim(COALESCE(p_search, ''));
  IF length(v_search) < 2 THEN
    RETURN;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  RETURN QUERY
  WITH all_users_candidates AS (
    SELECT
      COALESCE(au.user_id, au.id) AS id,
      au.email::TEXT AS email,
      COALESCE(NULLIF(au.full_name, ''), au.email)::TEXT AS full_name,
      NULL::TEXT AS phone,
      COALESCE(au.source_table, 'all_users')::TEXT AS source_table,
      GREATEST(
        similarity(lower(COALESCE(au.email, '')), lower(v_search)),
        similarity(lower(COALESCE(au.full_name, '')), lower(v_search))
      ) AS rank_score
    FROM public.all_users au
    WHERE
      lower(COALESCE(au.email, '')) LIKE '%' || lower(v_search) || '%'
      OR lower(COALESCE(au.full_name, '')) LIKE '%' || lower(v_search) || '%'
  ),
  auth_candidates AS (
    SELECT
      u.id,
      u.email::TEXT AS email,
      COALESCE(
        u.raw_user_meta_data->>'full_name',
        u.raw_user_meta_data->>'name',
        u.email::TEXT
      )::TEXT AS full_name,
      COALESCE(u.raw_user_meta_data->>'phone', u.phone::TEXT)::TEXT AS phone,
      'auth.users'::TEXT AS source_table,
      GREATEST(
        similarity(lower(COALESCE(u.email::TEXT, '')), lower(v_search)),
        similarity(
          lower(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')),
          lower(v_search)
        )
      ) AS rank_score
    FROM auth.users u
    WHERE
      lower(COALESCE(u.email::TEXT, '')) LIKE '%' || lower(v_search) || '%'
      OR lower(COALESCE(u.raw_user_meta_data->>'full_name', '')) LIKE '%' || lower(v_search) || '%'
      OR lower(COALESCE(u.raw_user_meta_data->>'name', '')) LIKE '%' || lower(v_search) || '%'
  ),
  merged AS (
    SELECT * FROM all_users_candidates
    UNION ALL
    SELECT * FROM auth_candidates
  ),
  dedup AS (
    SELECT DISTINCT ON (lower(email))
      id, email, full_name, phone, source_table, rank_score
    FROM merged
    WHERE email IS NOT NULL
    ORDER BY lower(email), rank_score DESC, source_table ASC
  )
  SELECT
    d.id,
    d.email,
    d.full_name,
    d.phone,
    d.source_table,
    d.rank_score
  FROM dedup d
  ORDER BY
    (CASE WHEN lower(d.email) LIKE lower(v_search) || '%' THEN 1 ELSE 0 END) DESC,
    (CASE WHEN lower(d.full_name) LIKE lower(v_search) || '%' THEN 1 ELSE 0 END) DESC,
    d.rank_score DESC,
    d.email ASC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_ican_users(TEXT, INT, INT) TO authenticated;

SELECT 'CMMS user search scalability hardening applied.' AS status;
