CREATE OR REPLACE FUNCTION public.fn_cmms_create_business_group(
  p_company_id UUID, p_name TEXT, p_base_currency TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group UUID; v_cur TEXT;
BEGIN
  IF NOT public._cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only the company administrator can start a business group';
  END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'Give the business a name'; END IF;
  IF EXISTS (SELECT 1 FROM public.cmms_company_profiles WHERE id = p_company_id AND group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This company already belongs to a business group';
  END IF;
  SELECT COALESCE(NULLIF(upper(p_base_currency), ''), currency, 'UGX') INTO v_cur
  FROM public.cmms_company_profiles WHERE id = p_company_id;
  INSERT INTO public.cmms_business_groups (name, base_currency, created_by)
  VALUES (btrim(p_name), v_cur, auth.uid()) RETURNING id INTO v_group;
  UPDATE public.cmms_company_profiles
  SET group_id = v_group, is_headquarters = TRUE,
      branch_name = COALESCE(branch_name, 'Head office'), updated_at = NOW()
  WHERE id = p_company_id;
  RETURN jsonb_build_object('group_id', v_group, 'base_currency', v_cur);
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_cmms_link_company_to_group(
  p_group_id UUID, p_company_id UUID, p_branch_name TEXT DEFAULT NULL, p_branch_code TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL, p_currency TEXT DEFAULT NULL, p_timezone TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_is_group_hq_admin(p_group_id) THEN
    RAISE EXCEPTION 'Only the head-office administrator can add branches';
  END IF;
  IF NOT public._cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'You must also administer the company you are adding';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cmms_company_profiles WHERE id = p_company_id AND group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'That company already belongs to a business group';
  END IF;
  UPDATE public.cmms_company_profiles SET
    group_id = p_group_id, is_headquarters = FALSE,
    branch_name = COALESCE(NULLIF(btrim(p_branch_name), ''), branch_name, company_name),
    branch_code = NULLIF(btrim(p_branch_code), ''),
    country = COALESCE(NULLIF(btrim(p_country), ''), country),
    currency = COALESCE(NULLIF(upper(btrim(p_currency)), ''), currency),
    timezone = COALESCE(NULLIF(btrim(p_timezone), ''), timezone),
    updated_at = NOW()
  WHERE id = p_company_id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
