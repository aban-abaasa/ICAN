CREATE OR REPLACE FUNCTION public._bwp_tx_guard_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pol public.branch_wallet_policies; v_status TEXT; v_today NUMERIC;
BEGIN
  IF COALESCE(to_jsonb(NEW)->>'direction', 'out') = 'in' THEN RETURN NEW; END IF;
  SELECT w.status INTO v_status FROM public.ican_business_wallets w WHERE w.business_profile_id = NEW.business_profile_id;
  IF v_status IS NOT NULL AND v_status <> 'active' THEN
    RAISE EXCEPTION 'This business wallet is % and cannot start new payments', v_status;
  END IF;
  SELECT * INTO v_pol FROM public.branch_wallet_policies WHERE business_profile_id = NEW.business_profile_id AND enabled;
  IF FOUND THEN
    IF v_pol.per_tx_limit_ican IS NOT NULL AND NEW.amount_ican > v_pol.per_tx_limit_ican THEN
      RAISE EXCEPTION 'This wallet allows at most % ICAN per payment', v_pol.per_tx_limit_ican;
    END IF;
    IF v_pol.daily_limit_ican IS NOT NULL THEN
      SELECT COALESCE(SUM(t.amount_ican), 0) INTO v_today
      FROM public.ican_business_wallet_transactions t
      WHERE t.business_profile_id = NEW.business_profile_id
        AND COALESCE(to_jsonb(t)->>'direction', 'out') = 'out'
        AND t.status IN ('pending_approval', 'completed')
        AND t.created_at >= date_trunc('day', NOW());
      IF v_today + NEW.amount_ican > v_pol.daily_limit_ican THEN
        RAISE EXCEPTION 'This wallet’s daily limit of % ICAN would be exceeded (% already requested today)',
          v_pol.daily_limit_ican, v_today;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public._bwp_tx_guard_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pol public.branch_wallet_policies; v_status TEXT;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
     AND COALESCE(to_jsonb(NEW)->>'direction', 'out') = 'out' THEN
    SELECT w.status INTO v_status FROM public.ican_business_wallets w WHERE w.business_profile_id = NEW.business_profile_id;
    IF v_status IS NOT NULL AND v_status <> 'active' THEN
      RAISE EXCEPTION 'This business wallet is % and cannot release payments', v_status;
    END IF;
    SELECT * INTO v_pol FROM public.branch_wallet_policies WHERE business_profile_id = NEW.business_profile_id AND enabled;
    IF FOUND AND NOT v_pol.allow_owner_override
       AND COALESCE(current_setting('bwp.engine', TRUE), '') <> 'on' THEN
      RAISE EXCEPTION 'This wallet releases payments only through its approval ladder';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_bwp_tx_guard_insert BEFORE INSERT ON public.ican_business_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public._bwp_tx_guard_insert();
CREATE TRIGGER trg_bwp_tx_guard_update BEFORE UPDATE OF status ON public.ican_business_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public._bwp_tx_guard_update();
