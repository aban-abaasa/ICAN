CREATE OR REPLACE FUNCTION public.fn_business_end_branch_link(p_link_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.business_ownership_links;
BEGIN
  SELECT * INTO v_link FROM public.business_ownership_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.status NOT IN ('pending', 'active') THEN RAISE EXCEPTION 'That link is already closed'; END IF;
  IF NOT (public.unified_business_admin(v_link.parent_business_profile_id)
          OR public.unified_business_admin(v_link.child_business_profile_id)) THEN
    RAISE EXCEPTION 'You do not administer either business';
  END IF;
  UPDATE public.business_ownership_links
  SET status = 'ended', ended_at = NOW(), ended_by = auth.uid(), updated_at = NOW(),
      notes = CASE WHEN p_reason IS NULL THEN notes ELSE COALESCE(notes || E'\n', '') || 'Ended: ' || p_reason END
  WHERE id = p_link_id RETURNING * INTO v_link;
  PERFORM public._bol_log(v_link, 'ended', jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('status', 'ended');
END;
$$;
