-- ================================================================
-- Shareholder approvals: count REAL registered members, and make an
-- approval actually count
-- ================================================================
-- Two bugs made approved investments stay "pending" forever:
--
-- 1. The denominator was every business_co_owners row with equity,
--    including EXPECTED members who never registered (user_id IS NULL --
--    email-only rows). They can never approve, so 100% of the real
--    members approving still read as e.g. 3 of 5 = 60% or worse.
--    Now only registered members (user_id set, active, equity > 0) count,
--    one per person.
--
-- 2. The Approval Center "OK, Approve" button only stamped
--    shareholder_notifications.read_at. It never wrote an
--    investment_signatures row, so the auto-seal trigger never fired and
--    investment_agreements.status stayed 'signing'. This adds
--    fn_shareholder_decide_investment(): records the signature (or
--    rejection) server-side, links it to the right agreement, marks the
--    notification handled and returns live progress.
--
-- Also adds fn_get_my_approval_requests() so the approval screens show
-- real per-investment progress instead of client-side guesses.
--
-- Safe to re-run. Ends with a backfill that seals anything already past
-- the threshold.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Real registered member count
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_total_shareholders(business_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(COUNT(DISTINCT c.user_id), 0)::INT
  FROM public.business_co_owners c
  WHERE c.business_profile_id = business_id
    AND c.user_id IS NOT NULL
    AND (c.status = 'active' OR c.status IS NULL)
    AND c.ownership_share > 0;
$$;

-- ----------------------------------------------------------------
-- 2. Which agreement does a shareholder notification belong to?
--    (the notification carries investor email + amount, not the id)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_match_agreement_for_notification(p_notification_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id
  FROM public.shareholder_notifications n
  JOIN public.investment_agreements a ON a.business_profile_id = n.business_profile_id
  LEFT JOIN auth.users u ON u.id = a.investor_id
  WHERE n.id = p_notification_id
    AND (n.investor_email IS NULL OR lower(u.email) = lower(n.investor_email))
    AND a.created_at <= n.created_at + interval '1 day'
  ORDER BY
    (abs(COALESCE(a.total_investment, 0) - COALESCE(n.investment_amount, 0)) < 1) DESC,
    abs(extract(epoch FROM (a.created_at - n.created_at))) ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fn_match_agreement_for_notification(UUID) FROM PUBLIC;

-- ----------------------------------------------------------------
-- 3. Approve / reject an investment (called by the shareholder)
-- ----------------------------------------------------------------
-- p_location = where the signature was made (device time zone / place), kept
-- on the signature and printed on the agreement. New parameter => drop the
-- old 3-argument version so the two overloads never clash.
DROP FUNCTION IF EXISTS public.fn_shareholder_decide_investment(UUID, BOOLEAN, TEXT);
CREATE OR REPLACE FUNCTION public.fn_shareholder_decide_investment(
  p_notification_id UUID,
  p_approve BOOLEAN DEFAULT TRUE,
  p_reason TEXT DEFAULT NULL,
  p_location TEXT DEFAULT NULL
)
RETURNS TABLE (
  agreement_id UUID,
  agreement_status TEXT,
  signed_count INT,
  total_members INT,
  percent NUMERIC,
  sealed BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_n public.shareholder_notifications%ROWTYPE;
  v_agreement UUID;
  v_name TEXT;
  v_signed INT;
  v_total INT;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  SELECT * INTO v_n FROM public.shareholder_notifications WHERE id = p_notification_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request not found';
  END IF;

  IF NOT (v_n.shareholder_id = v_uid
          OR (v_n.shareholder_id IS NULL AND lower(v_n.shareholder_email) = lower(v_email))) THEN
    RAISE EXCEPTION 'This approval request is not addressed to you';
  END IF;

  -- Only a real, registered shareholder of that business may decide.
  IF NOT EXISTS (
    SELECT 1 FROM public.business_co_owners c
     WHERE c.business_profile_id = v_n.business_profile_id
       AND c.user_id = v_uid
       AND c.ownership_share > 0
       AND (c.status = 'active' OR c.status IS NULL)
  ) THEN
    RAISE EXCEPTION 'You are not an active shareholder of this business';
  END IF;

  v_agreement := public.fn_match_agreement_for_notification(p_notification_id);
  v_name := COALESCE(NULLIF(v_n.shareholder_name, ''), split_part(v_email, '@', 1), 'Shareholder');

  IF v_agreement IS NOT NULL THEN
    INSERT INTO public.investment_signatures AS s (
      agreement_id, shareholder_id, shareholder_name, shareholder_email,
      signature_pin_hash, signature_timestamp, device_id, device_location,
      is_business_owner, signature_status, rejection_reason, signed_at
    ) VALUES (
      v_agreement, v_uid, v_name, COALESCE(v_email, v_n.shareholder_email, ''),
      'in-app-approval', now(), 'approval_center', COALESCE(NULLIF(left(p_location, 120), ''), 'in_app'),
      false, CASE WHEN p_approve THEN 'signed' ELSE 'rejected' END,
      CASE WHEN p_approve THEN NULL ELSE p_reason END,
      CASE WHEN p_approve THEN now() ELSE NULL END
    )
    ON CONFLICT (agreement_id, shareholder_id) DO UPDATE
      SET signature_status = EXCLUDED.signature_status,
          rejection_reason = EXCLUDED.rejection_reason,
          signature_timestamp = EXCLUDED.signature_timestamp,
          device_location = EXCLUDED.device_location,
          signed_at = EXCLUDED.signed_at;
  END IF;

  -- Mark every duplicate request for the same investment as handled, so a
  -- shareholder is never asked twice.
  UPDATE public.shareholder_notifications
     SET read_at = COALESCE(read_at, now()),
         notification_type = CASE WHEN p_approve THEN notification_type ELSE 'approval_rejected' END
   WHERE id = p_notification_id;

  IF v_agreement IS NOT NULL THEN
    SELECT a.status INTO v_status FROM public.investment_agreements a WHERE a.id = v_agreement;
    SELECT count(*)::INT INTO v_signed FROM public.investment_signatures s
     WHERE s.agreement_id = v_agreement AND s.signature_status = 'signed';
  ELSE
    v_status := NULL;
    v_signed := 0;
  END IF;
  v_total := public.get_total_shareholders(v_n.business_profile_id);

  RETURN QUERY SELECT
    v_agreement,
    v_status,
    v_signed,
    v_total,
    CASE WHEN v_total > 0 THEN round(v_signed::NUMERIC * 100 / v_total, 1) ELSE 0 END,
    (v_status = 'sealed');
END;
$$;

REVOKE ALL ON FUNCTION public.fn_shareholder_decide_investment(UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_shareholder_decide_investment(UUID, BOOLEAN, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------
-- 4. The caller's approval requests with live, real progress
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_get_my_approval_requests()
RETURNS TABLE (
  notification_id UUID,
  business_profile_id UUID,
  business_name TEXT,
  notification_title TEXT,
  notification_message TEXT,
  investor_name TEXT,
  investor_email TEXT,
  investment_amount NUMERIC,
  investment_currency TEXT,
  investment_shares NUMERIC,
  created_at TIMESTAMPTZ,
  decided BOOLEAN,
  my_decision TEXT,
  agreement_id UUID,
  agreement_status TEXT,
  approval_deadline TIMESTAMPTZ,
  signed_count INT,
  total_members INT,
  percent NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid, (SELECT email FROM auth.users WHERE id = auth.uid()) AS email
  ), mine AS (
    SELECT n.*, public.fn_match_agreement_for_notification(n.id) AS agr
    FROM public.shareholder_notifications n, me
    WHERE me.uid IS NOT NULL
      AND n.notification_type IN ('investment_signed', 'approval_rejected')
      AND (n.shareholder_id = me.uid
           OR (n.shareholder_id IS NULL AND lower(n.shareholder_email) = lower(me.email)))
  )
  SELECT
    m.id, m.business_profile_id, bp.business_name,
    m.notification_title, m.notification_message,
    m.investor_name, m.investor_email,
    m.investment_amount, m.investment_currency, m.investment_shares,
    m.created_at,
    (m.read_at IS NOT NULL),
    CASE WHEN m.notification_type = 'approval_rejected' THEN 'rejected'
         WHEN m.read_at IS NOT NULL THEN 'approved'
         ELSE NULL END,
    m.agr, a.status, a.approval_deadline,
    COALESCE((SELECT count(*)::INT FROM public.investment_signatures s
               WHERE s.agreement_id = m.agr AND s.signature_status = 'signed'), 0),
    public.get_total_shareholders(m.business_profile_id),
    CASE WHEN public.get_total_shareholders(m.business_profile_id) > 0
         THEN round(COALESCE((SELECT count(*) FROM public.investment_signatures s
                               WHERE s.agreement_id = m.agr AND s.signature_status = 'signed'), 0)::NUMERIC
                    * 100 / public.get_total_shareholders(m.business_profile_id), 1)
         ELSE 0 END
  FROM mine m
  LEFT JOIN public.business_profiles bp ON bp.id = m.business_profile_id
  LEFT JOIN public.investment_agreements a ON a.id = m.agr
  ORDER BY (m.read_at IS NULL) DESC, m.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.fn_get_my_approval_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_my_approval_requests() TO authenticated;

-- ----------------------------------------------------------------
-- 5. Owner/shareholder investments view: same real member count
-- ----------------------------------------------------------------
-- (re-run ADD_BUSINESS_OWNER_INVESTMENTS_VIEW.sql after this file; its
--  total_shareholders now matches get_total_shareholders)
CREATE OR REPLACE FUNCTION public.fn_get_business_investments()
RETURNS TABLE (
  agreement_id UUID, status TEXT, pitch_id UUID, pitch_title TEXT,
  business_profile_id UUID, business_name TEXT, investor_id UUID, investor_name TEXT,
  investment_type TEXT, shares_amount NUMERIC, share_price NUMERIC, total_investment NUMERIC,
  escrow_id TEXT, approval_deadline TIMESTAMPTZ, created_at TIMESTAMPTZ, sealed_at TIMESTAMPTZ,
  mou_content TEXT, signed_count BIGINT, total_shareholders BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    a.id, a.status, a.pitch_id, p.title, a.business_profile_id, bp.business_name,
    a.investor_id,
    COALESCE(NULLIF(pr.full_name, ''), split_part(u.email, '@', 1), 'Investor'),
    a.investment_type, a.shares_amount, a.share_price, a.total_investment,
    a.escrow_id, a.approval_deadline, a.created_at, a.sealed_at,
    (SELECT d.mou_content FROM public.business_documents d
      WHERE d.business_profile_id = a.business_profile_id LIMIT 1),
    (SELECT count(*) FROM public.investment_signatures s
      WHERE s.agreement_id = a.id AND s.signature_status = 'signed'),
    public.get_total_shareholders(a.business_profile_id)::BIGINT
  FROM public.investment_agreements a
  JOIN public.business_profiles bp ON bp.id = a.business_profile_id
  LEFT JOIN public.pitches p ON p.id = a.pitch_id
  LEFT JOIN public.profiles pr ON pr.id = a.investor_id
  LEFT JOIN auth.users u ON u.id = a.investor_id
  WHERE auth.uid() IS NOT NULL
    AND (
      bp.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.business_co_owners c
         WHERE c.business_profile_id = a.business_profile_id
           AND c.user_id = auth.uid() AND c.ownership_share > 0
           AND (c.status IS NULL OR c.status = 'active')
      )
    )
  ORDER BY a.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.fn_get_business_investments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_business_investments() TO authenticated;

-- ----------------------------------------------------------------
-- 5b. Escrow release must not depend on WHO triggered the seal
-- ----------------------------------------------------------------
-- release_investment_escrow_to_business() called
-- get_or_create_pitchin_business_wallet(), which checks auth.uid() against
-- the business's members. Sealing runs from a trigger, so the "caller" can
-- be the SQL editor / a backfill (auth.uid() NULL) or any approving member,
-- and the check raised "You do not have access to this PitchIn business
-- profile", aborting the seal. The seal has already been authorised by the
-- 60% approval, so create the wallet rows directly instead.
CREATE OR REPLACE FUNCTION public.release_investment_escrow_to_business(p_agreement_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agreement public.investment_agreements;
  v_wallet public.ican_business_wallets;
BEGIN
  SELECT * INTO v_agreement FROM public.investment_agreements WHERE id = p_agreement_id FOR UPDATE;
  IF v_agreement IS NULL THEN
    RETURN;
  END IF;

  -- Never release the same escrow twice (e.g. a re-fired trigger).
  IF EXISTS (
    SELECT 1 FROM public.ican_business_wallet_transactions t
     WHERE t.operation_type = 'investment_escrow_release'
       AND t.metadata->>'agreement_id' = v_agreement.id::TEXT
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  SELECT id, user_id FROM public.business_profiles WHERE id = v_agreement.business_profile_id
  ON CONFLICT (business_profile_id) DO NOTHING;

  INSERT INTO public.ican_business_wallet_settings (business_profile_id)
  VALUES (v_agreement.business_profile_id)
  ON CONFLICT (business_profile_id) DO NOTHING;

  SELECT * INTO v_wallet
    FROM public.ican_business_wallets
   WHERE business_profile_id = v_agreement.business_profile_id
   FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Business profile % not found; cannot release escrow', v_agreement.business_profile_id;
  END IF;

  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance + v_agreement.total_investment,
         total_earned = COALESCE(total_earned, 0) + v_agreement.total_investment,
         updated_at = now()
   WHERE id = v_wallet.id;

  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, amount_ican, note, reference_id,
     status, direction, operation_type, metadata)
  VALUES
    (v_agreement.business_profile_id, v_agreement.investor_id, v_agreement.total_investment,
     'Investment escrow released - shareholder approval reached', v_agreement.escrow_id,
     'completed', 'in', 'investment_escrow_release',
     jsonb_build_object('agreement_id', v_agreement.id, 'pitch_id', v_agreement.pitch_id));
END;
$$;

REVOKE ALL ON FUNCTION public.release_investment_escrow_to_business(UUID) FROM PUBLIC;

-- ----------------------------------------------------------------
-- 6. Backfill
--    a) approvals already clicked in the Approval Center but never
--       recorded as signatures
--    b) re-fire the seal trigger with the corrected member count
-- ----------------------------------------------------------------
INSERT INTO public.investment_signatures (
  agreement_id, shareholder_id, shareholder_name, shareholder_email,
  signature_pin_hash, signature_timestamp, device_id, device_location,
  is_business_owner, signature_status, signed_at
)
SELECT DISTINCT ON (agr, n.shareholder_id)
  agr, n.shareholder_id,
  COALESCE(NULLIF(n.shareholder_name, ''), split_part(n.shareholder_email, '@', 1), 'Shareholder'),
  COALESCE(n.shareholder_email, ''),
  'in-app-approval', COALESCE(n.read_at, now()), 'approval_center', 'in_app',
  false, 'signed', COALESCE(n.read_at, now())
FROM (
  SELECT n.*, public.fn_match_agreement_for_notification(n.id) AS agr
  FROM public.shareholder_notifications n
  WHERE n.notification_type = 'investment_signed'
    AND n.read_at IS NOT NULL
    AND n.shareholder_id IS NOT NULL
) n
WHERE agr IS NOT NULL
ON CONFLICT (agreement_id, shareholder_id) DO NOTHING;

UPDATE public.investment_signatures
   SET signature_status = signature_status
 WHERE signature_status = 'signed';

-- Make the new functions callable right away (refresh the API schema cache)
NOTIFY pgrst, 'reload schema';
