CREATE OR REPLACE FUNCTION public.fn_cmms_update_branch(
  p_company_id UUID, p_branch_name TEXT DEFAULT NULL, p_branch_code TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL, p_currency TEXT DEFAULT NULL, p_timezone TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group UUID;
BEGIN
  SELECT group_id INTO v_group FROM public.cmms_company_profiles WHERE id = p_company_id;
  IF NOT (public._cmms_is_company_admin(p_company_id) OR public._cmms_is_group_hq_admin(v_group)) THEN
    RAISE EXCEPTION 'You do not have permission to edit this branch';
  END IF;
  UPDATE public.cmms_company_profiles SET
    branch_name = COALESCE(NULLIF(btrim(p_branch_name), ''), branch_name),
    branch_code = COALESCE(NULLIF(btrim(p_branch_code), ''), branch_code),
    country     = COALESCE(NULLIF(btrim(p_country), ''), country),
    currency    = COALESCE(NULLIF(upper(btrim(p_currency)), ''), currency),
    timezone    = COALESCE(NULLIF(btrim(p_timezone), ''), timezone),
    updated_at = NOW()
  WHERE id = p_company_id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_cmms_unlink_company_from_group(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group UUID; v_hq BOOLEAN;
BEGIN
  SELECT group_id, is_headquarters INTO v_group, v_hq FROM public.cmms_company_profiles WHERE id = p_company_id;
  IF v_group IS NULL THEN RETURN jsonb_build_object('ok', TRUE); END IF;
  IF NOT public._cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only that branch''s administrator can remove it from the group';
  END IF;
  IF v_hq AND EXISTS (SELECT 1 FROM public.cmms_company_profiles WHERE group_id = v_group AND id <> p_company_id) THEN
    RAISE EXCEPTION 'Remove the other branches before the head office leaves the group';
  END IF;
  UPDATE public.cmms_company_profiles SET group_id = NULL, is_headquarters = FALSE, updated_at = NOW() WHERE id = p_company_id;
  IF v_hq THEN DELETE FROM public.cmms_business_groups WHERE id = v_group; END IF;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
