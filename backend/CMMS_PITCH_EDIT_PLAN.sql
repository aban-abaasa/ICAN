-- ============================================================
-- CMMS "Investor pitch" -- edit a published written plan
-- ============================================================
-- Lets the owner / co-owner / manager of a business change the title,
-- description, share terms and written plan of a pitch they already published,
-- without deleting it (likes, comments, views and the shared link are kept).
--
-- Run after: CMMS_PITCH_PLAN_ONLY.sql. Safe to run more than once.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_cmms_edit_managed_pitch_plan(UUID, TEXT, TEXT, NUMERIC, NUMERIC, JSONB);
CREATE OR REPLACE FUNCTION public.fn_cmms_edit_managed_pitch_plan(
  p_pitch_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_target_funding NUMERIC,
  p_equity_offering NUMERIC,
  p_plan_content JSONB
)
RETURNS SETOF public.pitches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_profile_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;

  SELECT business_profile_id INTO v_business_profile_id
  FROM public.pitches WHERE id = p_pitch_id;

  IF v_business_profile_id IS NULL THEN
    RAISE EXCEPTION 'Pitch not found';
  END IF;

  IF NOT public.fn_business_owns_or_manages(v_business_profile_id) THEN
    RAISE EXCEPTION 'You can only edit a pitch for a business you own or manage';
  END IF;

  RETURN QUERY
  UPDATE public.pitches SET
    title = COALESCE(NULLIF(TRIM(p_title), ''), title),
    description = COALESCE(p_description, description),
    target_funding = COALESCE(p_target_funding, target_funding),
    equity_offering = COALESCE(p_equity_offering, equity_offering),
    plan_content = COALESCE(p_plan_content, plan_content),
    updated_at = NOW()
  WHERE id = p_pitch_id
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cmms_edit_managed_pitch_plan(UUID, TEXT, TEXT, NUMERIC, NUMERIC, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cmms_edit_managed_pitch_plan(UUID, TEXT, TEXT, NUMERIC, NUMERIC, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Published pitch plans can now be edited (fn_cmms_edit_managed_pitch_plan)' AS status;
