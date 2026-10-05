CREATE OR REPLACE FUNCTION public.fn_bwp_set_my_pin(p_pin TEXT, p_current_pin TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_row public.branch_approver_pins;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF p_pin !~ '^[0-9]{4,8}$' THEN RAISE EXCEPTION 'The approval PIN must be 4 to 8 digits'; END IF;
  SELECT * INTO v_row FROM public.branch_approver_pins WHERE user_id = auth.uid();
  IF FOUND THEN
    IF v_row.locked_until IS NOT NULL AND v_row.locked_until > NOW() THEN RAISE EXCEPTION 'Too many wrong attempts. Try again later.'; END IF;
    IF p_current_pin IS NULL OR crypt(p_current_pin, v_row.pin_hash) <> v_row.pin_hash THEN
      RAISE EXCEPTION 'Your current approval PIN is required to change it';
    END IF;
  END IF;
  INSERT INTO public.branch_approver_pins (user_id, pin_hash) VALUES (auth.uid(), crypt(p_pin, gen_salt('bf')))
  ON CONFLICT (user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed_count = 0, locked_until = NULL, set_at = NOW();
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_bwp_my_pin_status()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('has_pin', EXISTS (SELECT 1 FROM public.branch_approver_pins WHERE user_id = auth.uid()),
                            'locked_until', (SELECT locked_until FROM public.branch_approver_pins WHERE user_id = auth.uid()));
$$;
