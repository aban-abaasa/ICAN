DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['branch_wallet_policies', 'branch_wallet_approvers', 'branch_approver_pins',
                           'branch_wallet_stage_approvals', 'branch_wallet_allowances', 'branch_wallet_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
