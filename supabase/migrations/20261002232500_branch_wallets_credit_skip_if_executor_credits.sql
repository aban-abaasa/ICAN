CREATE OR REPLACE FUNCTION public._bwp_credit_branch_recipient()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- If the deployed executor already credits recipient businesses (ICAN_BUSINESS_WALLET_TRANSFERS.sql),
  -- do nothing: crediting here as well would pay the branch twice.
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname = 'pitchin_execute_business_wallet_transfer'
               AND p.prosrc LIKE '%recipient_business_profile_id%') THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.recipient_business_profile_id IS NOT NULL
     AND COALESCE(to_jsonb(NEW)->>'operation_type', '') IN ('branch_funding', 'branch_sweep') THEN
    INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
    SELECT bp.id, bp.user_id FROM public.business_profiles bp WHERE bp.id = NEW.recipient_business_profile_id
    ON CONFLICT (business_profile_id) DO NOTHING;
    UPDATE public.ican_business_wallets
       SET ican_balance = ican_balance + NEW.amount_ican,
           total_earned = COALESCE(total_earned, 0) + NEW.amount_ican,
           updated_at = NOW()
     WHERE business_profile_id = NEW.recipient_business_profile_id;
    PERFORM public._bwp_log(NEW.business_profile_id, 'branch_transfer_credited',
      jsonb_build_object('transaction_id', NEW.id, 'recipient', NEW.recipient_business_profile_id,
                         'amount_ican', NEW.amount_ican, 'kind', to_jsonb(NEW)->>'operation_type'));
  END IF;
  RETURN NULL;
END;
$$;
