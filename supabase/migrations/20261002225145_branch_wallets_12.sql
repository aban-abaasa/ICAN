CREATE OR REPLACE FUNCTION public.fn_bwp_pending_for_me()
RETURNS TABLE (
  transaction_id UUID, business_id UUID, business_name TEXT, wallet_label TEXT, amount_ican NUMERIC, note TEXT,
  operation_type TEXT, recipient_name TEXT, created_at TIMESTAMPTZ, my_level TEXT, already_decided BOOLEAN, stage JSONB
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.business_profile_id, bp.business_name::TEXT, pol.wallet_label, t.amount_ican, t.note,
         COALESCE(to_jsonb(t)->>'operation_type', 'transfer'),
         COALESCE(rb.business_name, ru.email)::TEXT, t.created_at,
         (SELECT a.level FROM public.branch_wallet_approvers a
           WHERE a.business_profile_id = t.business_profile_id AND a.user_id = auth.uid() AND a.active
             AND (a.max_amount_ican IS NULL OR a.max_amount_ican >= t.amount_ican)
           ORDER BY a.level DESC LIMIT 1),
         EXISTS (SELECT 1 FROM public.branch_wallet_stage_approvals s WHERE s.transaction_id = t.id AND s.approver_id = auth.uid()),
         public._bwp_stage_status(t.id)
  FROM public.ican_business_wallet_transactions t
  JOIN public.branch_wallet_policies pol ON pol.business_profile_id = t.business_profile_id AND pol.enabled
  JOIN public.business_profiles bp ON bp.id = t.business_profile_id
  LEFT JOIN public.business_profiles rb ON rb.id = t.recipient_business_profile_id
  LEFT JOIN auth.users ru ON ru.id = t.recipient_user_id
  WHERE t.status = 'pending_approval' AND t.initiated_by <> auth.uid()
    AND EXISTS (SELECT 1 FROM public.branch_wallet_approvers a
                 WHERE a.business_profile_id = t.business_profile_id AND a.user_id = auth.uid() AND a.active
                   AND (a.max_amount_ican IS NULL OR a.max_amount_ican >= t.amount_ican))
  ORDER BY t.created_at;
$$;
