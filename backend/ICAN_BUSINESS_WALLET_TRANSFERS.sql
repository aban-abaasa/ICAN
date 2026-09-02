-- Resolve and fund dedicated PitchIn/ICAN business wallets.
-- Run after PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql,
-- SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql, and CMMS_PICHIN_ADMIN_AUTHORITY.sql
-- when CMMS business-wallet approvals are enabled.

ALTER TABLE public.ican_coin_transactions
  ADD COLUMN IF NOT EXISTS business_profile_id UUID
    REFERENCES public.business_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.ican_business_wallet_transactions
  ADD COLUMN IF NOT EXISTS recipient_business_profile_id UUID
    REFERENCES public.business_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ican_business_wallet_tx_recipient_business
  ON public.ican_business_wallet_transactions(recipient_business_profile_id)
  WHERE recipient_business_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ican_coin_transactions_business_profile
  ON public.ican_coin_transactions(business_profile_id, created_at DESC);

-- The financial-record feed must include both personal wallet activity and
-- ledger entries belonging to business wallets the signed-in user may manage.
-- Business receipt rows deliberately have no recipient_user_id, so a direct
-- table query by personal wallet ids would otherwise omit them.
--
-- p_scope lets the caller choose which side of that to see:
--   'personal' - only rows that moved the signed-in user's OWN wallet
--                 (sender or recipient), even when the row also carries a
--                 business_profile_id for provenance (e.g. a salary payment
--                 received from a business still shows on the employee's
--                 personal transactions).
--   'business' - only rows tied to a business wallet the signed-in user is
--                 a shareholder/admin/finance-authorized manager of,
--                 regardless of whether they personally are the sender or
--                 recipient (e.g. a business-to-business receipt, which has
--                 no personal recipient_user_id at all).
--   'all' (default) - the original unfiltered union of both, unchanged.
DROP FUNCTION IF EXISTS public.get_ican_record_every_transaction_feed();
CREATE OR REPLACE FUNCTION public.get_ican_record_every_transaction_feed(p_scope TEXT DEFAULT 'all')
RETURNS SETOF public.ican_coin_transactions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tx.*
    FROM public.ican_coin_transactions tx
   WHERE CASE lower(COALESCE(p_scope, 'all'))
     WHEN 'personal' THEN
       tx.sender_user_id = auth.uid() OR tx.recipient_user_id = auth.uid()
     WHEN 'business' THEN
       tx.business_profile_id IS NOT NULL
       AND public.pitchin_business_shareholder_access(tx.business_profile_id)
     ELSE
       tx.sender_user_id = auth.uid()
        OR tx.recipient_user_id = auth.uid()
        OR (
          tx.business_profile_id IS NOT NULL
          AND public.pitchin_business_shareholder_access(tx.business_profile_id)
        )
     END
   ORDER BY tx.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_ican_record_every_transaction_feed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ican_record_every_transaction_feed(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_ican_business_wallet(p_wallet_address TEXT)
RETURNS TABLE (
  business_profile_id UUID,
  wallet_address TEXT,
  business_name TEXT,
  ican_balance NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bw.business_profile_id,
         bw.wallet_address,
         bp.business_name,
         bw.ican_balance
    FROM public.ican_business_wallets bw
    JOIN public.business_profiles bp ON bp.id = bw.business_profile_id
   WHERE upper(trim(bw.wallet_address)) = upper(trim(p_wallet_address))
     AND bw.status = 'active'
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_ican_business_wallet(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_ican_business_wallet(TEXT) TO authenticated;

DROP FUNCTION IF EXISTS public.transfer_ican_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.transfer_ican_to_business(
  p_from_user UUID,
  p_business_profile_id UUID,
  p_amount NUMERIC,
  p_note TEXT DEFAULT '',
  p_source_app TEXT DEFAULT 'ican',
  p_reference_id TEXT DEFAULT NULL,
  p_pin_attempt TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_balance NUMERIC;
  v_coin_price NUMERIC;
  v_local_currency TEXT;
  v_tithe NUMERIC;
  v_net NUMERIC;
  v_wallet public.ican_business_wallets;
  v_out_tx UUID;
  v_in_tx UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_from_user THEN
    RAISE EXCEPTION 'Only the authenticated sender can initiate this transfer';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_source_app NOT IN ('ican', 'digital-city-era', 'farm-agent', 'mybodaguy') THEN
    RAISE EXCEPTION 'Invalid source_app';
  END IF;

  -- Value this ledger entry in the receiving business's operating currency,
  -- using the current global ICAN rate, not a fixed UGX conversion.
  SELECT p.currency_code, p.price_local
    INTO v_local_currency, v_coin_price
    FROM public.business_profiles bp
    LEFT JOIN public.user_accounts ua ON ua.user_id = bp.user_id
    CROSS JOIN LATERAL public.ican_get_price_by_country(
      COALESCE(NULLIF(TRIM(ua.country_code), ''), 'US')
    ) p
   WHERE bp.id = p_business_profile_id
   LIMIT 1;
  IF v_coin_price IS NULL OR v_coin_price <= 0 THEN
    RAISE EXCEPTION 'Current ICAN price unavailable';
  END IF;

  -- Agent BIZ transfers require the authenticated agent's wallet PIN.
  IF p_source_app = 'farm-agent' THEN
    IF p_pin_attempt IS NULL OR NOT EXISTS (
      SELECT 1
        FROM public.user_accounts ua
       WHERE ua.user_id = auth.uid()
         AND ua.pin_hash = p_pin_attempt
         AND COALESCE(ua.status, 'active') = 'active'
    ) THEN
      RAISE EXCEPTION 'Invalid agent wallet PIN';
    END IF;
  END IF;

  SELECT * INTO v_wallet
    FROM public.ican_business_wallets
   WHERE business_profile_id = p_business_profile_id
     AND status = 'active'
   FOR UPDATE;
  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Business wallet not found or inactive';
  END IF;

  SELECT ican_balance INTO v_sender_balance
    FROM public.ican_user_wallets
   WHERE user_id = p_from_user
   FOR UPDATE;
  IF v_sender_balance IS NULL THEN
    RAISE EXCEPTION 'Sender wallet not found';
  END IF;
  IF v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient ICAN balance';
  END IF;

  v_tithe := round(p_amount * 0.10, 8);
  v_net := p_amount - v_tithe;

  UPDATE public.ican_user_wallets
     SET ican_balance = ican_balance - p_amount,
         total_spent = total_spent + p_amount
   WHERE user_id = p_from_user;

  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance + v_net,
         total_earned = total_earned + v_net,
         updated_at = now()
   WHERE business_profile_id = p_business_profile_id;

  INSERT INTO public.ican_coin_transactions
    (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
     source_app, reference_id, note, business_profile_id)
  VALUES
    (p_from_user, p_amount, 'transfer_out', 'transfer_out', 'completed', round(p_amount * v_coin_price, 2), v_local_currency, p_source_app,
     p_reference_id, coalesce(p_note, ''), p_business_profile_id)
  RETURNING id INTO v_out_tx;

  -- This is a business-wallet receipt, not a credit to the owner's personal
  -- ICAN wallet/trading account.
  INSERT INTO public.ican_coin_transactions
    (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
     source_app, reference_id, note, business_profile_id)
  VALUES
    (NULL, v_net, 'transfer_in', 'transfer_in', 'completed', round(v_net * v_coin_price, 2), v_local_currency, p_source_app,
     p_reference_id, coalesce(p_note, '') || ' (net after 10% tithe)', p_business_profile_id)
  RETURNING id INTO v_in_tx;

  RETURN jsonb_build_object(
    'success', true,
    'out_tx_id', v_out_tx,
    'in_tx_id', v_in_tx,
    'amount_sent', p_amount,
    'tithe_deducted', v_tithe,
    'business_received', v_net,
    'business_profile_id', p_business_profile_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_ican_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_ican_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Agent cash-out to a BIZ address: debit the agent's fiat float and credit
-- the PitchIn business wallet in ICAN. The agent does not need ICAN coins.
CREATE OR REPLACE FUNCTION public.transfer_agent_fiat_to_business(
  p_agent_id UUID,
  p_business_profile_id UUID,
  p_amount_local NUMERIC,
  p_currency TEXT DEFAULT 'UGX',
  p_pin_attempt TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_note TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent public.agents;
  v_float public.agent_floats;
  v_wallet public.ican_business_wallets;
  v_coin_price NUMERIC;
  v_ican_amount NUMERIC;
  v_tithe NUMERIC;
  v_net NUMERIC;
  v_tx UUID;
BEGIN
  SELECT * INTO v_agent
    FROM public.agents
   WHERE id = p_agent_id
     AND user_id = auth.uid()
     AND status = 'active'
   FOR UPDATE;
  IF v_agent.id IS NULL THEN RAISE EXCEPTION 'Agent not found or inactive'; END IF;
  IF p_amount_local IS NULL OR p_amount_local <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF upper(trim(COALESCE(p_currency, ''))) !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Unsupported agent currency: %', p_currency;
  END IF;
  IF p_pin_attempt IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_accounts ua
     WHERE ua.user_id = auth.uid()
       AND ua.pin_hash = p_pin_attempt
       AND COALESCE(ua.status, 'active') = 'active'
  ) THEN RAISE EXCEPTION 'Invalid agent wallet PIN'; END IF;

  SELECT * INTO v_wallet
    FROM public.ican_business_wallets
   WHERE business_profile_id = p_business_profile_id
     AND status = 'active'
     AND (p_wallet_address IS NULL OR upper(trim(wallet_address)) = upper(trim(p_wallet_address)))
   FOR UPDATE;
  IF v_wallet.id IS NULL THEN RAISE EXCEPTION 'Business wallet not found or inactive'; END IF;

  SELECT * INTO v_float
    FROM public.agent_floats
   WHERE agent_id = p_agent_id
     AND upper(currency) = upper(trim(p_currency))
     AND NOT is_frozen
   FOR UPDATE;
  IF v_float.id IS NULL THEN RAISE EXCEPTION '% agent float not found or frozen', upper(p_currency); END IF;
  IF v_float.current_balance < p_amount_local THEN
    RAISE EXCEPTION 'Insufficient % float', upper(p_currency);
  END IF;

  SELECT price_local INTO v_coin_price
    FROM public.ican_get_price_in_currency(upper(trim(p_currency)))
   LIMIT 1;
  IF v_coin_price IS NULL OR v_coin_price <= 0 THEN RAISE EXCEPTION 'Current ICAN price unavailable'; END IF;

  v_ican_amount := round(p_amount_local / v_coin_price, 8);
  v_tithe := round(v_ican_amount * 0.10, 8);
  v_net := v_ican_amount - v_tithe;

  UPDATE public.agent_floats
     SET current_balance = current_balance - p_amount_local,
         total_withdrawn = COALESCE(total_withdrawn, 0) + p_amount_local,
         updated_at = now()
   WHERE id = v_float.id;
  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance + v_net,
         total_earned = total_earned + v_net,
         updated_at = now()
   WHERE id = v_wallet.id;

  INSERT INTO public.ican_coin_transactions
    (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
     source_app, note, business_profile_id)
  VALUES
     (auth.uid(), v_ican_amount, 'transfer_out', 'transfer_out', 'completed', p_amount_local,
     upper(trim(p_currency)), 'farm-agent',
     COALESCE(p_note, '') || ' (' || upper(p_currency) || ' agent float; net after 10% tithe)',
     p_business_profile_id);

  INSERT INTO public.agent_transactions
    (agent_id, user_id, transaction_type, amount, currency, commission_amount,
     net_amount, user_account_id, reference_number, status, completed_at, metadata)
  VALUES
     (p_agent_id, NULL, 'cash_out', p_amount_local, upper(p_currency), 0, p_amount_local,
     COALESCE(p_wallet_address, v_wallet.wallet_address), 'BIZ-ICAN-' || gen_random_uuid(),
     'completed', now(), jsonb_build_object('business_profile_id', p_business_profile_id,
       'ican_amount', v_ican_amount, 'coin_price', v_coin_price,
       'currency', upper(p_currency), 'tithe', v_tithe));

  RETURN jsonb_build_object('success', true, 'amount_local', p_amount_local,
    'currency', upper(p_currency), 'coin_price', v_coin_price, 'ican_amount', v_ican_amount,
    'tithe_deducted', v_tithe, 'business_received', v_net,
    'business_profile_id', p_business_profile_id);
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_agent_fiat_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_agent_fiat_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Business owners, delegated business administrators, and linked CMMS
-- administrators may see and approve pending wallet transactions.
CREATE OR REPLACE FUNCTION public.ican_business_wallet_approval_admin(p_business_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    -- The business owner remains an authorized administrator for every
    -- business type.
    EXISTS (
      SELECT 1
        FROM public.business_profiles bp
       WHERE bp.id = p_business_profile_id
          AND bp.user_id = auth.uid()
    )
    OR (
      -- Delegated PitchIn/business administrators may approve any linked
      -- business wallet, including a sole proprietorship, with its PIN.
      public.ican_business_admin(p_business_profile_id)
    )
    OR EXISTS (
      -- A CMMS administrator may approve a linked business wallet with its PIN.
      SELECT 1
        FROM public.business_profiles bp
        JOIN public.cmms_company_profiles cp
          ON cp.pichin_business_profile_id = bp.id
        JOIN public.cmms_users cu
          ON cu.cmms_company_id = cp.id
        JOIN public.cmms_user_roles ur
          ON ur.cmms_user_id = cu.id
        JOIN public.cmms_roles r
          ON r.id = ur.cmms_role_id
        JOIN auth.users au
          ON lower(au.email) = lower(cu.email)
       WHERE bp.id = p_business_profile_id
          AND au.id = auth.uid()
         AND cu.is_active = TRUE
         AND ur.is_active = TRUE
         AND r.is_active = TRUE
         AND lower(COALESCE(r.role_name, '')) IN
             ('admin', 'administrator', 'cmms_admin', 'business_admin', 'wallet_admin', 'finance_admin')
    )
  );
$$;

REVOKE ALL ON FUNCTION public.ican_business_wallet_approval_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_business_wallet_approval_admin(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.pitchin_business_shareholder_access(p_business_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.business_profiles bp
       WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.business_co_owners co
       WHERE co.business_profile_id = p_business_profile_id
         AND (co.user_id = auth.uid()
              OR lower(co.owner_email) = lower(auth.jwt() ->> 'email'))
         AND lower(co.status) IN ('active', 'approved')
    )
    OR public.ican_business_wallet_approval_admin(p_business_profile_id)
  );
$$;

-- Notify all eligible business approvers, including CMMS admins whose company
-- is linked to this Pichin business profile. Notifications are only created
-- for transactions that genuinely require approval.
CREATE OR REPLACE FUNCTION public.notify_ican_business_wallet_approvers()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NEW.status <> 'pending_approval' OR COALESCE(NEW.required_approval_percentage, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.ican_business_wallet_notifications
    (transaction_id, business_profile_id, shareholder_user_id, notification_type)
  SELECT DISTINCT NEW.id, NEW.business_profile_id, recipients.user_id, 'wallet_approval_required'
    FROM (
      SELECT bp.user_id
        FROM public.business_profiles bp
       WHERE bp.id = NEW.business_profile_id
      UNION
      SELECT co.user_id
        FROM public.business_co_owners co
       WHERE co.business_profile_id = NEW.business_profile_id
         AND co.user_id IS NOT NULL
         AND lower(co.status) IN ('active', 'approved')
      UNION
      SELECT bm.auth_user_id
        FROM public.business_account_members bm
       WHERE bm.business_profile_id = NEW.business_profile_id
         AND bm.auth_user_id IS NOT NULL
         AND bm.employment_status = 'active'
         AND COALESCE((bm.permissions ->> 'manage_business')::BOOLEAN, FALSE)
      UNION
      SELECT au.id
        FROM public.cmms_company_profiles cp
        JOIN public.cmms_users cu ON cu.cmms_company_id = cp.id
        JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id
        JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
        JOIN auth.users au ON lower(au.email) = lower(cu.email)
       WHERE cp.pichin_business_profile_id = NEW.business_profile_id
         AND cu.is_active = TRUE
         AND ur.is_active = TRUE
         AND r.is_active = TRUE
         AND lower(COALESCE(r.role_name, '')) IN
             ('admin', 'administrator', 'cmms_admin', 'business_admin', 'wallet_admin', 'finance_admin')
    ) recipients
   WHERE recipients.user_id IS NOT NULL
  ON CONFLICT (transaction_id, shareholder_user_id, notification_type) DO NOTHING;

  -- Mirror the approval alert into the CMMS admin portal notification bell.
  -- The business-wallet notification remains the source of truth for approval;
  -- this row only makes the pending request visible in CMMS in real time.
  IF to_regclass('public.cmms_notifications') IS NOT NULL THEN
    INSERT INTO public.cmms_notifications
      (cmms_user_id, cmms_company_id, notification_type, title, message,
       icon, action_link, action_label, action_tab)
    SELECT DISTINCT cu.id,
           cp.id,
           'business_wallet_approval',
           'Business-wallet approval required',
           format('Approve the pending ICAN wallet request of %s ICAN%s.',
                  NEW.amount_ican,
                  CASE WHEN NULLIF(TRIM(COALESCE(NEW.note, '')), '') IS NULL
                       THEN '' ELSE ' — ' || NEW.note END),
           '🔐',
           NEW.id::TEXT,
           'Review approval',
           'wallet_approval'
      FROM public.cmms_company_profiles cp
      JOIN public.cmms_users cu
        ON cu.cmms_company_id = cp.id
      JOIN auth.users au
        ON lower(au.email) = lower(cu.email)
     WHERE cp.pichin_business_profile_id = NEW.business_profile_id
       AND cu.is_active = TRUE
       AND (
         au.id = (SELECT bp.user_id
                    FROM public.business_profiles bp
                   WHERE bp.id = NEW.business_profile_id)
         OR lower(COALESCE(cu.role, '')) IN
            ('admin', 'administrator', 'cmms_admin', 'business_admin', 'wallet_admin', 'finance_admin')
         OR EXISTS (
           SELECT 1
             FROM public.cmms_user_roles ur
             JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
            WHERE ur.cmms_user_id = cu.id
              AND ur.is_active = TRUE
              AND r.is_active = TRUE
              AND lower(COALESCE(r.role_name, '')) IN
                  ('admin', 'administrator', 'cmms_admin', 'business_admin', 'wallet_admin', 'finance_admin')
         )
       );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ican_business_wallet_approval_notifications
  ON public.ican_business_wallet_transactions;
CREATE TRIGGER ican_business_wallet_approval_notifications
AFTER INSERT ON public.ican_business_wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.notify_ican_business_wallet_approvers();

-- Three-argument RPC used by the wallet UI. A delegated business/CMMS admin
-- approval reaches the configured threshold in one approval; limited-company
-- shareholders retain the normal ownership-percentage approval behavior.
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
  v_share NUMERIC;
  v_total NUMERIC;
  v_email TEXT := auth.jwt() ->> 'email';
  v_is_admin BOOLEAN;
  v_pin_hash TEXT;
BEGIN
  SELECT * INTO v_tx
    FROM public.ican_business_wallet_transactions
   WHERE id = p_transaction_id
   FOR UPDATE;
  IF v_tx.id IS NULL THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF lower(COALESCE(p_decision, '')) NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected';
  END IF;
  IF NOT public.pitchin_business_shareholder_access(v_tx.business_profile_id) THEN
    RAISE EXCEPTION 'Business approval access required';
  END IF;

  v_is_admin := public.ican_business_wallet_approval_admin(v_tx.business_profile_id);
  IF v_is_admin AND NULLIF(TRIM(p_pin), '') IS NULL THEN
    RAISE EXCEPTION 'Business-wallet PIN is required for administrator approval';
  END IF;
  IF v_is_admin THEN
    SELECT pin_hash INTO v_pin_hash
      FROM public.ican_business_wallet_settings
     WHERE business_profile_id = v_tx.business_profile_id;
    IF v_pin_hash IS NULL OR extensions.crypt(p_pin, v_pin_hash) <> v_pin_hash THEN
      RAISE EXCEPTION 'Invalid business-wallet PIN';
    END IF;
  END IF;

  IF v_is_admin THEN
    v_share := v_tx.required_approval_percentage;
  ELSE
    SELECT CASE WHEN bp.user_id = auth.uid() THEN
             GREATEST(0, 100 - COALESCE((SELECT SUM(ownership_share)
               FROM public.business_co_owners
              WHERE business_profile_id = bp.id
                AND lower(status) IN ('active', 'approved')), 0))
           ELSE co.ownership_share END
      INTO v_share
      FROM public.business_profiles bp
      LEFT JOIN public.business_co_owners co
        ON co.business_profile_id = bp.id
       AND (co.user_id = auth.uid() OR lower(co.owner_email) = lower(v_email))
     WHERE bp.id = v_tx.business_profile_id
       AND (bp.user_id = auth.uid() OR co.id IS NOT NULL);
    IF v_share IS NULL THEN RAISE EXCEPTION 'Verified shareholder account required'; END IF;
  END IF;

  INSERT INTO public.ican_business_wallet_approvals
    (transaction_id, shareholder_user_id, shareholder_email, ownership_percentage, decision)
  VALUES (v_tx.id, auth.uid(), v_email, v_share, lower(p_decision))
  ON CONFLICT (transaction_id, shareholder_user_id) DO UPDATE
    SET ownership_percentage = EXCLUDED.ownership_percentage,
        decision = EXCLUDED.decision,
        decided_at = now();

  SELECT COALESCE(SUM(ownership_percentage) FILTER (WHERE decision = 'approved'), 0)
    INTO v_total
    FROM public.ican_business_wallet_approvals
   WHERE transaction_id = v_tx.id;
  UPDATE public.ican_business_wallet_transactions
     SET approved_ownership_percentage = v_total
   WHERE id = v_tx.id;

  IF lower(p_decision) = 'rejected' THEN
    UPDATE public.ican_business_wallet_transactions SET status = 'rejected' WHERE id = v_tx.id;
    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;
  IF v_total >= v_tx.required_approval_percentage THEN
    RETURN public.pitchin_execute_business_wallet_transfer(v_tx.id);
  END IF;
  RETURN jsonb_build_object('success', true, 'status', 'pending_approval',
                            'approved_percentage', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pitchin_business_wallet_transaction(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_pitchin_business_wallet_transaction(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_ican_business_wallet_notifications(p_unread_only BOOLEAN DEFAULT TRUE)
RETURNS TABLE (
  notification_id UUID,
  transaction_id UUID,
  business_profile_id UUID,
  notification_type TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  amount_ican NUMERIC,
  note TEXT,
  reference_id TEXT,
  status TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT n.id, n.transaction_id, n.business_profile_id, n.notification_type,
         n.read_at, n.created_at, tx.amount_ican, tx.note, tx.reference_id, tx.status
    FROM public.ican_business_wallet_notifications n
    JOIN public.ican_business_wallet_transactions tx ON tx.id = n.transaction_id
   WHERE n.shareholder_user_id = auth.uid()
     AND public.pitchin_business_shareholder_access(n.business_profile_id)
     AND (NOT COALESCE(p_unread_only, TRUE) OR n.read_at IS NULL)
   ORDER BY n.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_ican_business_wallet_notifications(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ican_business_wallet_notifications(BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_ican_business_wallet_notification_read(p_notification_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.ican_business_wallet_notifications
     SET read_at = COALESCE(read_at, now())
   WHERE id = p_notification_id
     AND shareholder_user_id = auth.uid()
  RETURNING TRUE;
$$;

REVOKE ALL ON FUNCTION public.mark_ican_business_wallet_notification_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_ican_business_wallet_notification_read(UUID) TO authenticated;

-- Execute a business-wallet transaction and support a business-wallet recipient.
-- The original PitchIn executor only credited recipient_user_id, which sent
-- supplier payments to a personal wallet.
CREATE OR REPLACE FUNCTION public.pitchin_execute_business_wallet_transfer(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tx public.ican_business_wallet_transactions;
  v_source_wallet public.ican_business_wallets;
  v_recipient_wallet public.ican_business_wallets;
  v_coin_price NUMERIC;
  v_local_currency TEXT;
  v_recipient_coin_price NUMERIC;
  v_recipient_local_currency TEXT;
  v_recipient_owner_user_id UUID;
  v_source_ledger_tx UUID;
  v_recipient_ledger_tx UUID;
BEGIN
  SELECT * INTO v_tx
    FROM public.ican_business_wallet_transactions
   WHERE id = p_transaction_id
   FOR UPDATE;
  IF v_tx.id IS NULL THEN RAISE EXCEPTION 'Business-wallet transaction not found'; END IF;
  IF v_tx.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'status', 'completed', 'transaction_id', v_tx.id);
  END IF;
  IF v_tx.status <> 'pending_approval' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', v_tx.status,
      'transaction_id', v_tx.id,
      'error', CASE v_tx.status
        WHEN 'rejected' THEN 'Payment request was rejected, usually because the store business wallet has insufficient ICAN balance.'
        ELSE 'Payment request is not pending approval.'
      END
    );
  END IF;
  IF v_tx.approved_ownership_percentage < v_tx.required_approval_percentage THEN
    RETURN jsonb_build_object('success', false, 'error', 'Approval threshold has not been reached');
  END IF;

  -- The source business determines the accounting currency. Look up the
  -- current live ICAN price for that country's configured currency.
  SELECT p.currency_code, p.price_local
    INTO v_local_currency, v_coin_price
    FROM public.business_profiles bp
    LEFT JOIN public.user_accounts ua ON ua.user_id = bp.user_id
    CROSS JOIN LATERAL public.ican_get_price_by_country(
      COALESCE(NULLIF(TRIM(ua.country_code), ''), 'US')
    ) p
   WHERE bp.id = v_tx.business_profile_id
   LIMIT 1;
  IF v_coin_price IS NULL OR v_coin_price <= 0 THEN
    RAISE EXCEPTION 'Current ICAN price unavailable';
  END IF;

  SELECT * INTO v_source_wallet
    FROM public.ican_business_wallets
   WHERE business_profile_id = v_tx.business_profile_id
   FOR UPDATE;
  IF v_source_wallet.id IS NULL THEN RAISE EXCEPTION 'Source business wallet not found'; END IF;
  IF v_source_wallet.ican_balance < v_tx.amount_ican THEN
    UPDATE public.ican_business_wallet_transactions SET status = 'rejected' WHERE id = v_tx.id;
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient business-wallet balance');
  END IF;

  IF v_tx.recipient_business_profile_id IS NOT NULL THEN
    IF v_tx.recipient_business_profile_id = v_tx.business_profile_id THEN
      RAISE EXCEPTION 'Source and recipient business wallets must be different';
    END IF;
    INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
    SELECT id, user_id FROM public.business_profiles
     WHERE id = v_tx.recipient_business_profile_id
    ON CONFLICT (business_profile_id) DO NOTHING;
    SELECT * INTO v_recipient_wallet
      FROM public.ican_business_wallets
     WHERE business_profile_id = v_tx.recipient_business_profile_id
       AND status = 'active'
     FOR UPDATE;
    IF v_recipient_wallet.id IS NULL THEN RAISE EXCEPTION 'Recipient business wallet not found or inactive'; END IF;

    -- Record the supplier/business receipt in its own accounting currency so
    -- that both businesses' transaction reports reconcile independently.
    SELECT bp.user_id, p.currency_code, p.price_local
      INTO v_recipient_owner_user_id, v_recipient_local_currency, v_recipient_coin_price
      FROM public.business_profiles bp
      LEFT JOIN public.user_accounts ua ON ua.user_id = bp.user_id
      CROSS JOIN LATERAL public.ican_get_price_by_country(
        COALESCE(NULLIF(TRIM(ua.country_code), ''), 'US')
      ) p
     WHERE bp.id = v_tx.recipient_business_profile_id
     LIMIT 1;
    IF v_recipient_owner_user_id IS NULL
       OR v_recipient_coin_price IS NULL
       OR v_recipient_coin_price <= 0 THEN
      RAISE EXCEPTION 'Recipient business live ICAN price unavailable';
    END IF;

    UPDATE public.ican_business_wallets
       SET ican_balance = ican_balance + v_tx.amount_ican,
           total_earned = total_earned + v_tx.amount_ican,
           updated_at = now()
     WHERE id = v_recipient_wallet.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recipient business wallet credit failed';
    END IF;
  ELSIF v_tx.recipient_user_id IS NOT NULL THEN
    PERFORM public.get_or_create_ican_wallet(v_tx.recipient_user_id);
    UPDATE public.ican_user_wallets
       SET ican_balance = ican_balance + v_tx.amount_ican,
           total_earned = total_earned + v_tx.amount_ican
     WHERE user_id = v_tx.recipient_user_id;
  ELSE
    RAISE EXCEPTION 'A recipient wallet is required';
  END IF;

  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance - v_tx.amount_ican,
         total_spent = total_spent + v_tx.amount_ican,
         updated_at = now()
   WHERE id = v_source_wallet.id
     AND ican_balance >= v_tx.amount_ican;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source business wallet debit failed';
  END IF;
  UPDATE public.ican_business_wallet_transactions
     SET status = 'completed', executed_at = now()
   WHERE id = v_tx.id;

  -- local_amount and local_currency are required by the ICAN transaction
  -- ledger. Convert at the current ICAN price in the business's currency.
  INSERT INTO public.ican_coin_transactions
    (sender_user_id, recipient_user_id, ican_amount, type, transaction_type, status,
     local_amount, local_currency, source_app, reference_id, note, business_profile_id)
  VALUES
    (v_tx.initiated_by, v_tx.recipient_user_id, v_tx.amount_ican,
     'transfer_out', 'transfer_out', 'completed', round(v_tx.amount_ican * v_coin_price, 2), v_local_currency,
     'digital-city-era',
     v_tx.reference_id, v_tx.note, v_tx.business_profile_id)
  RETURNING id INTO v_source_ledger_tx;
  IF v_source_ledger_tx IS NULL THEN
    RAISE EXCEPTION 'Source business transaction ledger write failed';
  END IF;

  IF v_tx.recipient_business_profile_id IS NOT NULL THEN
    -- Do not set recipient_user_id here: this is credited to the supplier's
    -- business wallet, never to the owner's personal ICAN trading account.
    INSERT INTO public.ican_coin_transactions
      (ican_amount, type, transaction_type, status,
       local_amount, local_currency, source_app, reference_id, note, business_profile_id)
    VALUES
      (v_tx.amount_ican, 'transfer_in', 'transfer_in', 'completed',
       round(v_tx.amount_ican * v_recipient_coin_price, 2), v_recipient_local_currency,
       'digital-city-era', v_tx.reference_id,
       COALESCE(v_tx.note, '') || ' (business wallet receipt)',
       v_tx.recipient_business_profile_id)
    RETURNING id INTO v_recipient_ledger_tx;
    IF v_recipient_ledger_tx IS NULL THEN
      RAISE EXCEPTION 'Recipient business transaction ledger write failed';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'completed',
    'transaction_id', v_tx.id,
    'amount_ican', v_tx.amount_ican,
    'source_business_profile_id', v_tx.business_profile_id,
    'recipient_business_profile_id', v_tx.recipient_business_profile_id,
    'recipient_user_id', v_tx.recipient_user_id,
    'source_ledger_transaction_id', v_source_ledger_tx,
    'recipient_ledger_transaction_id', v_recipient_ledger_tx
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pitchin_execute_business_wallet_transfer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pitchin_execute_business_wallet_transfer(UUID) TO authenticated;

-- Manager/supermarket pays a supplier's dedicated PitchIn business wallet.
CREATE OR REPLACE FUNCTION public.pitchin_business_wallet_transfer_to_business(
  p_business_profile_id UUID,
  p_recipient_business_profile_id UUID,
  p_amount_ican NUMERIC,
  p_note TEXT DEFAULT '',
  p_reference_id TEXT DEFAULT NULL,
  p_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_required NUMERIC;
  v_tx UUID;
BEGIN
  -- Store workers may submit a payment request. They do not receive wallet
  -- approval authority; the configured business/CMMS administrator approves
  -- it later with the business-wallet PIN.
  IF NOT EXISTS (
    SELECT 1
      FROM public.business_account_members bam
     WHERE bam.business_profile_id = p_business_profile_id
       AND bam.auth_user_id = auth.uid()
       AND bam.employment_status = 'active'
   ) AND NOT EXISTS (
    SELECT 1
      FROM public.cmms_company_profiles cp
      JOIN public.cmms_users cu ON cu.cmms_company_id = cp.id
      JOIN auth.users au ON lower(au.email) = lower(cu.email)
     WHERE cp.pichin_business_profile_id = p_business_profile_id
       AND cu.is_active = TRUE
       AND au.id = auth.uid()
  ) AND NOT EXISTS (
    -- Supermarkera purchase-order managers may submit the payment request even
    -- when their CMMS-to-Pichin membership row has not been synchronized yet.
    SELECT 1
      FROM public.purchase_orders po
      JOIN public.users pu ON pu.id = po.manager_id
     WHERE po.id::TEXT = p_reference_id
       AND (pu.auth_id = auth.uid() OR pu.id = auth.uid())
  ) AND NOT public.pitchin_business_wallet_operator(p_business_profile_id) THEN
    RAISE EXCEPTION 'An active store or CMMS user is required to submit this payment request';
  END IF;
  IF p_recipient_business_profile_id IS NULL
     OR p_recipient_business_profile_id = p_business_profile_id THEN
    RAISE EXCEPTION 'A different recipient business wallet is required';
  END IF;
  IF p_amount_ican IS NULL OR p_amount_ican <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_profiles WHERE id = p_recipient_business_profile_id) THEN
    RAISE EXCEPTION 'Recipient business profile not found';
  END IF;

  PERFORM public.get_or_create_pitchin_business_wallet(p_business_profile_id);
  SELECT approval_percentage
    INTO v_required
    FROM public.ican_business_wallet_settings
   WHERE business_profile_id = p_business_profile_id;
  v_required := GREATEST(COALESCE(v_required, 100), 1);

  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, amount_ican, note, reference_id,
     status, required_approval_percentage, recipient_business_profile_id)
  VALUES
    (p_business_profile_id, auth.uid(), p_amount_ican, COALESCE(p_note, ''), p_reference_id,
     'pending_approval', v_required,
     p_recipient_business_profile_id)
   RETURNING id INTO v_tx;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'pending_approval',
    'transaction_id', v_tx,
    'message', 'Payment request submitted. An authorized wallet administrator must approve it with the business-wallet PIN.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pitchin_business_wallet_transfer_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pitchin_business_wallet_transfer_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
