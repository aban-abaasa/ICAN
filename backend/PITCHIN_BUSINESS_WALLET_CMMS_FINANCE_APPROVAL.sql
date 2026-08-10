-- PitchIn / CMMS finance control for business-wallet payments.
-- Run after PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql.
--
-- Finance assignees may initiate a request, but they cannot spend funds.
-- Every request remains pending until the business administrator approves it
-- with the dedicated business-wallet PIN.

-- Every business type, including Sole Proprietorship, gets a dedicated
-- business wallet. The owner's personal wallet is never used as a fallback.
INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
SELECT bp.id, bp.user_id
  FROM public.business_profiles bp
ON CONFLICT (business_profile_id) DO NOTHING;

INSERT INTO public.ican_business_wallet_settings (business_profile_id)
SELECT bp.id
  FROM public.business_profiles bp
ON CONFLICT (business_profile_id) DO NOTHING;

ALTER TABLE public.business_team_members
  ADD COLUMN IF NOT EXISTS business_wallet_role TEXT NOT NULL DEFAULT 'none'
    CHECK (business_wallet_role IN ('none', 'finance'));

COMMENT ON COLUMN public.business_team_members.business_wallet_role IS
  'Business-wallet capability assigned by the business administrator; finance can initiate requests only.';

CREATE OR REPLACE FUNCTION public.pitchin_business_wallet_finance_access(
  p_business_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1
        FROM public.business_account_members bm
       WHERE bm.business_profile_id = p_business_profile_id
         AND bm.auth_user_id = auth.uid()
         AND bm.employment_status = 'active'
         AND (
           COALESCE((bm.permissions ->> 'business_wallet_finance')::boolean, false)
           OR COALESCE((bm.permissions ->> 'finances')::boolean, false)
         )
    )
    OR EXISTS (
      SELECT 1
        FROM public.business_app_links bal
        JOIN public.cmms_company_profiles cp ON cp.id = bal.source_entity_id
        JOIN public.cmms_users cu ON cu.cmms_company_id = cp.id
        JOIN public.cmms_user_roles ur ON ur.cmms_company_id = cp.id AND ur.cmms_user_id = cu.id
        JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
       WHERE bal.business_profile_id = p_business_profile_id
         AND bal.app_key = 'cmms'
         AND bal.status = 'active'
         AND lower(cu.email) = lower(auth.jwt() ->> 'email')
         AND cu.is_active = true
         AND ur.is_active = true
         AND r.is_active = true
         AND public.cmms_normalize_role_key(r.role_name) = 'finance'
         AND (
           COALESCE(r.can_view_financials, false)
           OR COALESCE((r.tool_access ->> 'business_wallet')::boolean, false)
           OR COALESCE((r.tool_access ->> 'finances')::boolean, false)
         )
    )
    OR EXISTS (
      SELECT 1
        FROM public.supermarkets sm
        JOIN public.users su ON su.supermarket_id = sm.id
       WHERE sm.pichin_business_profile_id = p_business_profile_id
         AND lower(COALESCE(su.role, '')) = 'manager'
         AND (
           su.id = auth.uid()
           OR su.auth_id = auth.uid()
         )
    )
    OR EXISTS (
    SELECT 1
      FROM public.business_team_members tm
     WHERE tm.business_profile_id = p_business_profile_id
       AND tm.user_id = auth.uid()
       AND tm.status = 'active'
       AND tm.business_wallet_role = 'finance'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.pitchin_business_wallet_finance_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pitchin_business_wallet_finance_access(UUID) TO authenticated;

-- The original RPC only accepted direct shareholders. Store/CMMS admins and
-- assigned finance users are authorized by the canonical Pichin authority
-- functions, so preserve that authority when resolving the wallet too.
CREATE OR REPLACE FUNCTION public.get_or_create_pitchin_business_wallet(
  p_business_profile_id UUID
)
RETURNS public.ican_business_wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet public.ican_business_wallets;
BEGIN
  IF NOT (
    public.ican_business_admin(p_business_profile_id)
    OR public.ican_business_member(p_business_profile_id)
    OR public.pitchin_business_shareholder_access(p_business_profile_id)
    OR public.pitchin_business_wallet_finance_access(p_business_profile_id)
  ) THEN
    RAISE EXCEPTION 'You do not have access to this Pichin business profile';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_profiles WHERE id = p_business_profile_id
  ) THEN
    RAISE EXCEPTION 'Pichin business profile not found';
  END IF;

  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  SELECT id, user_id FROM public.business_profiles WHERE id = p_business_profile_id
  ON CONFLICT (business_profile_id) DO NOTHING;

  INSERT INTO public.ican_business_wallet_settings (business_profile_id)
  VALUES (p_business_profile_id)
  ON CONFLICT (business_profile_id) DO NOTHING;

  SELECT * INTO v_wallet
    FROM public.ican_business_wallets
   WHERE business_profile_id = p_business_profile_id;
  RETURN v_wallet;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_pitchin_business_wallet(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_pitchin_business_wallet(UUID) TO authenticated;

-- CMMS Finance administration calls this when the business admin assigns or
-- removes the Business Wallet tool from a finance user.
CREATE OR REPLACE FUNCTION public.set_pitchin_business_wallet_finance_access(
  p_business_profile_id UUID,
  p_user_id UUID,
  p_enabled BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.ican_business_admin(p_business_profile_id) THEN
    RAISE EXCEPTION 'Only the business administrator can assign Business Wallet finance access';
  END IF;

  UPDATE public.business_team_members
     SET business_wallet_role = CASE WHEN p_enabled THEN 'finance' ELSE 'none' END,
         updated_at = now()
   WHERE business_profile_id = p_business_profile_id
     AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user must first be added to the business team';
  END IF;
  RETURN jsonb_build_object('success', true, 'finance_access', p_enabled);
END;
$$;

REVOKE ALL ON FUNCTION public.set_pitchin_business_wallet_finance_access(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_pitchin_business_wallet_finance_access(UUID, UUID, BOOLEAN) TO authenticated;

-- Replace the old threshold-based transfer rule. A finance assignee can
-- create a request, but no request is executed at initiation time.
DROP FUNCTION IF EXISTS public.pitchin_business_wallet_transfer(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.pitchin_business_wallet_transfer(
  p_business_profile_id UUID,
  p_recipient_user_id UUID,
  p_amount_ican NUMERIC,
  p_note TEXT DEFAULT '',
  p_reference_id TEXT DEFAULT NULL,
  p_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tx UUID;
  v_is_admin BOOLEAN;
  v_is_finance BOOLEAN;
BEGIN
  v_is_admin := public.ican_business_admin(p_business_profile_id);
  v_is_finance := public.pitchin_business_wallet_finance_access(p_business_profile_id);

  IF NOT v_is_admin AND NOT v_is_finance THEN
    RAISE EXCEPTION 'Business administrator or assigned finance access required';
  END IF;
  IF p_amount_ican IS NULL OR p_amount_ican <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  PERFORM public.get_or_create_pitchin_business_wallet(p_business_profile_id);

  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, recipient_user_id, amount_ican, note,
     reference_id, status, required_approval_percentage)
  VALUES
    (p_business_profile_id, auth.uid(), p_recipient_user_id, p_amount_ican,
     COALESCE(p_note, ''), p_reference_id, 'pending_approval', 100)
  RETURNING id INTO v_tx;

  INSERT INTO public.ican_business_wallet_notifications
    (transaction_id, business_profile_id, shareholder_user_id)
  SELECT v_tx, p_business_profile_id, shareholder_user_id
    FROM (
      SELECT bp.user_id AS shareholder_user_id
        FROM public.business_profiles bp
       WHERE bp.id = p_business_profile_id
      UNION
      SELECT co.user_id
        FROM public.business_co_owners co
       WHERE co.business_profile_id = p_business_profile_id
         AND co.user_id IS NOT NULL
         AND lower(co.status) IN ('active', 'approved')
    ) shareholders
   WHERE shareholder_user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'pending_approval',
    'transaction_id', v_tx,
    'message', 'Request created. Business administrator approval and business-wallet PIN are required.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pitchin_business_wallet_transfer(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pitchin_business_wallet_transfer(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- Approval is deliberately administrator-only and PIN-protected.
DROP FUNCTION IF EXISTS public.approve_pitchin_business_wallet_transaction(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.approve_pitchin_business_wallet_transaction(
  p_transaction_id UUID,
  p_decision TEXT,
  p_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tx public.ican_business_wallet_transactions;
  v_profile public.business_profiles;
  v_wallet_settings public.ican_business_wallet_settings;
  v_share NUMERIC;
  v_pin_ok BOOLEAN;
BEGIN
  SELECT * INTO v_tx
    FROM public.ican_business_wallet_transactions
   WHERE id = p_transaction_id
   FOR UPDATE;
  IF v_tx.id IS NULL THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF lower(COALESCE(p_decision, '')) NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected';
  END IF;

  SELECT * INTO v_profile FROM public.business_profiles WHERE id = v_tx.business_profile_id;
  IF NOT public.ican_business_admin(v_tx.business_profile_id) THEN
    RAISE EXCEPTION 'Only the business administrator can approve business-wallet payments';
  END IF;

  IF lower(p_decision) = 'approved' THEN
    SELECT * INTO v_wallet_settings
      FROM public.ican_business_wallet_settings
     WHERE business_profile_id = v_tx.business_profile_id
     FOR UPDATE;
    v_pin_ok := v_wallet_settings.pin_hash IS NOT NULL
      AND p_pin IS NOT NULL
      AND extensions.crypt(p_pin, v_wallet_settings.pin_hash) = v_wallet_settings.pin_hash;
    IF NOT v_pin_ok THEN
      RAISE EXCEPTION 'Valid business-wallet PIN is required for administrator approval';
    END IF;
  END IF;

  SELECT CASE WHEN v_profile.user_id = auth.uid() THEN
           GREATEST(0, 100 - COALESCE((SELECT SUM(ownership_share)
             FROM public.business_co_owners
            WHERE business_profile_id = v_profile.id
              AND lower(status) IN ('active', 'approved')), 0))
         ELSE co.ownership_share END
    INTO v_share
    FROM public.business_profiles bp
    LEFT JOIN public.business_co_owners co
      ON co.business_profile_id = bp.id
     AND (co.user_id = auth.uid() OR lower(co.owner_email) = lower(auth.jwt() ->> 'email'))
   WHERE bp.id = v_profile.id;

  INSERT INTO public.ican_business_wallet_approvals
    (transaction_id, shareholder_user_id, shareholder_email, ownership_percentage, decision)
  VALUES (v_tx.id, auth.uid(), auth.jwt() ->> 'email', COALESCE(v_share, 100), lower(p_decision))
  ON CONFLICT (transaction_id, shareholder_user_id) DO UPDATE
    SET decision = EXCLUDED.decision, decided_at = now();

  IF lower(p_decision) = 'rejected' THEN
    UPDATE public.ican_business_wallet_transactions SET status = 'rejected' WHERE id = v_tx.id;
    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  UPDATE public.ican_business_wallet_transactions
     SET approved_ownership_percentage = 100
   WHERE id = v_tx.id;
  RETURN public.pitchin_execute_business_wallet_transfer(v_tx.id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pitchin_business_wallet_transaction(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_pitchin_business_wallet_transaction(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
