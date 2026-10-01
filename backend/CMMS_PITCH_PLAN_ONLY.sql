-- ============================================================
-- CMMS "Investor pitch" -- publish with just a business plan (no video, no deck)
-- ============================================================
-- A pitch can now be published from a short written plan alone. The plan is
-- stored on the pitch as JSON (problem / solution / market / use of funds /
-- ask) and shown on the public board's Pitches tab, so anyone on the website
-- can read it.
--
-- Run after: CMMS_PITCH_PUBLICITY_TAB.sql. Safe to run more than once.
-- ============================================================

ALTER TABLE public.pitches
  ADD COLUMN IF NOT EXISTS plan_content JSONB;

-- Replace the 9-argument create function with one that also takes the plan.
-- The old signature must go first so PostgREST never has two overloads to pick from.
DROP FUNCTION IF EXISTS public.fn_cmms_create_managed_pitch(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.fn_cmms_create_managed_pitch(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.fn_cmms_create_managed_pitch(
  p_business_profile_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_category TEXT,
  p_pitch_type TEXT,
  p_target_funding NUMERIC,
  p_equity_offering NUMERIC,
  p_has_ip BOOLEAN,
  p_ip_details TEXT,
  p_plan_content JSONB DEFAULT NULL
)
RETURNS SETOF public.pitches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;

  IF NOT public.fn_business_owns_or_manages(p_business_profile_id) THEN
    RAISE EXCEPTION 'You can only create a pitch for a business you own or manage';
  END IF;

  RETURN QUERY
  INSERT INTO public.pitches (
    business_profile_id, title, description, category, pitch_type,
    target_funding, raised_amount, equity_offering, has_ip, ip_details,
    plan_content, status, likes_count, comments_count, shares_count, views_count
  ) VALUES (
    p_business_profile_id,
    COALESCE(NULLIF(TRIM(p_title), ''), 'Untitled Pitch'),
    COALESCE(p_description, ''),
    COALESCE(NULLIF(TRIM(p_category), ''), 'Technology'),
    COALESCE(NULLIF(TRIM(p_pitch_type), ''), 'Equity'),
    COALESCE(p_target_funding, 0),
    0,
    COALESCE(p_equity_offering, 0),
    COALESCE(p_has_ip, FALSE),
    p_ip_details,
    p_plan_content,
    'published',
    0, 0, 0, 0
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cmms_create_managed_pitch(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cmms_create_managed_pitch(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Pitches can now be published with a written plan only (pitches.plan_content)' AS status;
