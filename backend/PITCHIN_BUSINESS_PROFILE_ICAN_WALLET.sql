-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- PitchIn business-profile iCanEra wallet integration
--
-- A PitchIn business profile uses the owner's shared iCanEra wallet. This
-- keeps one balance per authenticated person while giving PitchIn a safe,
-- business-profile-scoped way to resolve that wallet and its ledger entries.
-- Run after ICAN_CROSS_APP_WALLET_MIGRATION.sql and
-- ICAN_TRANSACTION_CONTEXT_MIGRATION.sql.
-- ============================================================================

ALTER TABLE public.ican_coin_transactions
  ADD COLUMN IF NOT EXISTS business_profile_id UUID;

CREATE INDEX IF NOT EXISTS idx_ican_tx_business_profile
  ON public.ican_coin_transactions(business_profile_id, created_at DESC);

-- ============================================================================
-- Dedicated business-wallet governance
--
-- This section supersedes the owner-wallet wrapper above. It is intentionally
-- kept in this migration so installations that already ran an earlier draft
-- are upgraded safely.
-- ============================================================================

DROP TRIGGER IF EXISTS business_profile_ican_wallet ON public.business_profiles;
DROP FUNCTION IF EXISTS public.get_pitchin_business_wallet_transactions(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.get_or_create_pitchin_business_wallet(UUID);

CREATE TABLE IF NOT EXISTS public.ican_business_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL UNIQUE REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL UNIQUE DEFAULT 'BIZ-' || upper(substr(md5(gen_random_uuid()::text), 1, 16)),
  ican_balance NUMERIC(18,8) NOT NULL DEFAULT 0 CHECK (ican_balance >= 0),
  total_earned NUMERIC(18,8) NOT NULL DEFAULT 0,
  total_spent NUMERIC(18,8) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'frozen')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ican_business_wallet_settings (
  business_profile_id UUID PRIMARY KEY REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  large_transaction_threshold_ican NUMERIC(18,8) NOT NULL DEFAULT 1000 CHECK (large_transaction_threshold_ican > 0),
  approval_percentage NUMERIC(5,2) NOT NULL DEFAULT 60 CHECK (approval_percentage >= 60 AND approval_percentage <= 100),
  pin_hash TEXT,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  pin_set_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ican_business_wallet_settings
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.ican_business_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  initiated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount_ican NUMERIC(18,8) NOT NULL CHECK (amount_ican > 0),
  note TEXT NOT NULL DEFAULT '',
  reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending_approval', 'completed', 'rejected', 'cancelled')),
  required_approval_percentage NUMERIC(5,2) NOT NULL DEFAULT 60,
  approved_ownership_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.ican_business_wallet_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.ican_business_wallet_transactions(id) ON DELETE CASCADE,
  shareholder_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shareholder_email TEXT,
  ownership_percentage NUMERIC(5,2) NOT NULL CHECK (ownership_percentage >= 0 AND ownership_percentage <= 100),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, shareholder_user_id)
);

CREATE TABLE IF NOT EXISTS public.ican_business_wallet_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.ican_business_wallet_transactions(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  shareholder_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL DEFAULT 'large_transaction',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, shareholder_user_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_ican_business_wallet_tx_profile
  ON public.ican_business_wallet_transactions(business_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ican_business_wallet_approvals_tx
  ON public.ican_business_wallet_approvals(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ican_business_wallet_notifications_user
  ON public.ican_business_wallet_notifications(shareholder_user_id, read_at);

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
  );
$$;

CREATE OR REPLACE FUNCTION public.pitchin_business_wallet_operator(p_business_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH coowner_totals AS (
    SELECT COALESCE(SUM(CASE WHEN lower(co.status) IN ('active', 'approved')
                             THEN co.ownership_share ELSE 0 END), 0) AS total
      FROM public.business_co_owners co
     WHERE co.business_profile_id = p_business_profile_id
  ), shareholders AS (
    SELECT bp.user_id AS user_id, NULL::TEXT AS email,
           GREATEST(0, 100 - ct.total)::NUMERIC AS ownership, true AS is_owner
      FROM public.business_profiles bp CROSS JOIN coowner_totals ct
     WHERE bp.id = p_business_profile_id
    UNION ALL
    SELECT co.user_id, co.owner_email, co.ownership_share, false
      FROM public.business_co_owners co
     WHERE co.business_profile_id = p_business_profile_id
       AND co.user_id IS NOT NULL
       AND lower(co.status) IN ('active', 'approved')
  ), operator_row AS (
    SELECT * FROM shareholders
     ORDER BY ownership DESC, is_owner DESC
     LIMIT 1
  )
  SELECT EXISTS (
    SELECT 1 FROM operator_row
     WHERE user_id = auth.uid()
        OR lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_pitchin_business_wallet(p_business_profile_id UUID)
RETURNS public.ican_business_wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet public.ican_business_wallets;
  v_owner UUID;
BEGIN
  IF NOT public.pitchin_business_shareholder_access(p_business_profile_id) THEN
    RAISE EXCEPTION 'You do not have access to this PitchIn business profile';
  END IF;

  SELECT user_id INTO v_owner FROM public.business_profiles WHERE id = p_business_profile_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'PitchIn business profile not found'; END IF;

  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  VALUES (p_business_profile_id, v_owner)
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

CREATE OR REPLACE FUNCTION public.register_pitchin_business_wallet(p_business_profile_id UUID)
RETURNS public.ican_business_wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet public.ican_business_wallets;
BEGIN
  v_wallet := public.get_or_create_pitchin_business_wallet(p_business_profile_id);
  RETURN v_wallet;
END;
$$;

REVOKE ALL ON FUNCTION public.register_pitchin_business_wallet(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_pitchin_business_wallet(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_pitchin_business_wallet_transactions(
  p_business_profile_id UUID, p_limit INTEGER DEFAULT 100
)
RETURNS SETOF public.ican_business_wallet_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_wallet public.ican_business_wallets;
BEGIN
  v_wallet := public.get_or_create_pitchin_business_wallet(p_business_profile_id);
  RETURN QUERY SELECT * FROM public.ican_business_wallet_transactions
    WHERE business_profile_id = p_business_profile_id
    ORDER BY created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END;
$$;

REVOKE ALL ON FUNCTION public.get_pitchin_business_wallet_transactions(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pitchin_business_wallet_transactions(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_pitchin_business_wallet_pin(
  p_business_profile_id UUID,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.pitchin_business_wallet_operator(p_business_profile_id) THEN
    RAISE EXCEPTION 'Only the highest-ownership shareholder may set the business-wallet PIN';
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'Business-wallet PIN must contain 4 to 6 digits';
  END IF;

  PERFORM public.get_or_create_pitchin_business_wallet(p_business_profile_id);
  UPDATE public.ican_business_wallet_settings
     SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
         pin_failed_attempts = 0,
         pin_locked_until = NULL,
         pin_set_at = now(),
         updated_by = auth.uid(),
         updated_at = now()
   WHERE business_profile_id = p_business_profile_id;

  RETURN jsonb_build_object('success', true, 'pin_configured', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_pitchin_business_wallet_pin(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_pitchin_business_wallet_pin(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.pitchin_execute_business_wallet_transfer(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tx public.ican_business_wallet_transactions;
  v_wallet public.ican_business_wallets;
  v_recipient public.ican_user_wallets;
BEGIN
  SELECT * INTO v_tx FROM public.ican_business_wallet_transactions
   WHERE id = p_transaction_id FOR UPDATE;
  IF v_tx.id IS NULL THEN RAISE EXCEPTION 'Business-wallet transaction not found'; END IF;
  IF v_tx.status = 'completed' THEN RETURN jsonb_build_object('success', true, 'transaction_id', v_tx.id); END IF;
  IF v_tx.status <> 'pending_approval' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction is not executable');
  END IF;
  IF v_tx.approved_ownership_percentage < v_tx.required_approval_percentage THEN
    RETURN jsonb_build_object('success', false, 'error', '60% shareholder approval has not been reached');
  END IF;

  SELECT * INTO v_wallet FROM public.ican_business_wallets
   WHERE business_profile_id = v_tx.business_profile_id FOR UPDATE;
  IF v_wallet.ican_balance < v_tx.amount_ican THEN
    UPDATE public.ican_business_wallet_transactions SET status = 'rejected' WHERE id = v_tx.id;
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient business-wallet balance');
  END IF;

  IF v_tx.recipient_user_id IS NOT NULL THEN
    PERFORM public.get_or_create_ican_wallet(v_tx.recipient_user_id);
    UPDATE public.ican_user_wallets
       SET ican_balance = ican_balance + v_tx.amount_ican,
           total_earned = total_earned + v_tx.amount_ican
     WHERE user_id = v_tx.recipient_user_id;
  END IF;

  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance - v_tx.amount_ican,
         total_spent = total_spent + v_tx.amount_ican,
         updated_at = now()
   WHERE id = v_wallet.id;
  UPDATE public.ican_business_wallet_transactions
     SET status = 'completed', executed_at = now()
   WHERE id = v_tx.id;

  INSERT INTO public.ican_coin_transactions
    (sender_user_id, recipient_user_id, ican_amount, transaction_type, source_app,
     reference_id, note, business_profile_id)
  VALUES (v_tx.initiated_by, v_tx.recipient_user_id, v_tx.amount_ican,
          'transfer_out', 'ican', v_tx.reference_id, v_tx.note, v_tx.business_profile_id);

  RETURN jsonb_build_object('success', true, 'transaction_id', v_tx.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.pitchin_business_wallet_transfer(
  p_business_profile_id UUID, p_recipient_user_id UUID, p_amount_ican NUMERIC,
  p_note TEXT DEFAULT '', p_reference_id TEXT DEFAULT NULL, p_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_threshold NUMERIC;
  v_required NUMERIC;
  v_tx UUID;
  v_pin_hash TEXT;
  v_failed_attempts INTEGER;
  v_locked_until TIMESTAMPTZ;
BEGIN
  IF NOT public.pitchin_business_wallet_operator(p_business_profile_id) THEN
    RAISE EXCEPTION 'Only the highest-ownership shareholder may manage routine business-wallet transactions';
  END IF;
  IF p_amount_ican IS NULL OR p_amount_ican <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  PERFORM public.get_or_create_pitchin_business_wallet(p_business_profile_id);

  SELECT pin_hash, pin_failed_attempts, pin_locked_until
    INTO v_pin_hash, v_failed_attempts, v_locked_until
    FROM public.ican_business_wallet_settings
   WHERE business_profile_id = p_business_profile_id
   FOR UPDATE;
  IF v_pin_hash IS NULL THEN
    RAISE EXCEPTION 'Set the business-wallet PIN before making transactions';
  END IF;
  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    RAISE EXCEPTION 'Business-wallet PIN is temporarily locked';
  END IF;
  IF p_pin IS NULL OR extensions.crypt(p_pin, v_pin_hash) <> v_pin_hash THEN
    v_failed_attempts := COALESCE(v_failed_attempts, 0) + 1;
    UPDATE public.ican_business_wallet_settings
       SET pin_failed_attempts = v_failed_attempts,
           pin_locked_until = CASE WHEN v_failed_attempts >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
           updated_at = now()
     WHERE business_profile_id = p_business_profile_id;
    RAISE EXCEPTION 'Invalid business-wallet PIN';
  END IF;
  UPDATE public.ican_business_wallet_settings
     SET pin_failed_attempts = 0, pin_locked_until = NULL, updated_at = now()
   WHERE business_profile_id = p_business_profile_id;

  SELECT large_transaction_threshold_ican, approval_percentage
    INTO v_threshold, v_required
    FROM public.ican_business_wallet_settings
   WHERE business_profile_id = p_business_profile_id;

  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, recipient_user_id, amount_ican, note,
     reference_id, status, required_approval_percentage)
  VALUES (p_business_profile_id, auth.uid(), p_recipient_user_id, p_amount_ican,
          COALESCE(p_note, ''), p_reference_id,
          'pending_approval',
          CASE WHEN p_amount_ican >= v_threshold THEN v_required ELSE 0 END)
  RETURNING id INTO v_tx;

  IF p_amount_ican >= v_threshold THEN
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
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'transaction_id', v_tx);
  END IF;

  RETURN public.pitchin_execute_business_wallet_transfer(v_tx);
END;
$$;

DROP FUNCTION IF EXISTS public.pitchin_business_wallet_transfer(UUID, UUID, NUMERIC, TEXT, TEXT);
REVOKE ALL ON FUNCTION public.pitchin_business_wallet_transfer(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pitchin_business_wallet_transfer(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_pitchin_business_wallet_transaction(
  p_transaction_id UUID, p_decision TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tx public.ican_business_wallet_transactions;
  v_share NUMERIC;
  v_email TEXT := auth.jwt() ->> 'email';
  v_total NUMERIC;
BEGIN
  SELECT * INTO v_tx FROM public.ican_business_wallet_transactions WHERE id = p_transaction_id;
  IF v_tx.id IS NULL THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF NOT public.pitchin_business_shareholder_access(v_tx.business_profile_id) THEN RAISE EXCEPTION 'Shareholder access required'; END IF;
  IF lower(COALESCE(p_decision, '')) NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Decision must be approved or rejected'; END IF;

  SELECT CASE WHEN bp.user_id = auth.uid() THEN
           GREATEST(0, 100 - COALESCE((SELECT SUM(ownership_share) FROM public.business_co_owners
             WHERE business_profile_id = bp.id AND lower(status) IN ('active', 'approved')), 0))
         ELSE co.ownership_share END
    INTO v_share
    FROM public.business_profiles bp
    LEFT JOIN public.business_co_owners co ON co.business_profile_id = bp.id
      AND (co.user_id = auth.uid() OR lower(co.owner_email) = lower(v_email))
    WHERE bp.id = v_tx.business_profile_id
      AND (bp.user_id = auth.uid() OR co.id IS NOT NULL);
  IF v_share IS NULL THEN RAISE EXCEPTION 'Verified shareholder account required'; END IF;

  INSERT INTO public.ican_business_wallet_approvals
    (transaction_id, shareholder_user_id, shareholder_email, ownership_percentage, decision)
  VALUES (p_transaction_id, auth.uid(), v_email, v_share, lower(p_decision))
  ON CONFLICT (transaction_id, shareholder_user_id) DO UPDATE
    SET ownership_percentage = EXCLUDED.ownership_percentage,
        decision = EXCLUDED.decision, decided_at = now();

  SELECT COALESCE(SUM(ownership_percentage) FILTER (WHERE decision = 'approved'), 0)
    INTO v_total FROM public.ican_business_wallet_approvals WHERE transaction_id = p_transaction_id;
  UPDATE public.ican_business_wallet_transactions SET approved_ownership_percentage = v_total
   WHERE id = p_transaction_id;
  IF lower(p_decision) = 'rejected' THEN
    UPDATE public.ican_business_wallet_transactions SET status = 'rejected' WHERE id = p_transaction_id;
    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;
  IF v_total >= v_tx.required_approval_percentage THEN
    RETURN public.pitchin_execute_business_wallet_transfer(p_transaction_id);
  END IF;
  RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'approved_percentage', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pitchin_business_wallet_transaction(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_pitchin_business_wallet_transaction(UUID, TEXT) TO authenticated;

ALTER TABLE public.ican_business_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_business_wallet_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_business_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_business_wallet_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_business_wallet_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_wallet_shareholder_read ON public.ican_business_wallets;
CREATE POLICY business_wallet_shareholder_read ON public.ican_business_wallets
  FOR SELECT TO authenticated USING (public.pitchin_business_shareholder_access(business_profile_id));
DROP POLICY IF EXISTS business_wallet_settings_read ON public.ican_business_wallet_settings;
CREATE POLICY business_wallet_settings_read ON public.ican_business_wallet_settings
  FOR SELECT TO authenticated USING (public.pitchin_business_shareholder_access(business_profile_id));
DROP POLICY IF EXISTS business_wallet_transaction_shareholder_read ON public.ican_business_wallet_transactions;
CREATE POLICY business_wallet_transaction_shareholder_read ON public.ican_business_wallet_transactions
  FOR SELECT TO authenticated USING (public.pitchin_business_shareholder_access(business_profile_id));
DROP POLICY IF EXISTS business_wallet_approval_shareholder_read ON public.ican_business_wallet_approvals;
CREATE POLICY business_wallet_approval_shareholder_read ON public.ican_business_wallet_approvals
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.ican_business_wallet_transactions tx
     WHERE tx.id = transaction_id AND public.pitchin_business_shareholder_access(tx.business_profile_id)
  ));
DROP POLICY IF EXISTS business_wallet_notification_shareholder_read ON public.ican_business_wallet_notifications;
CREATE POLICY business_wallet_notification_shareholder_read ON public.ican_business_wallet_notifications
  FOR SELECT TO authenticated USING (shareholder_user_id = auth.uid()
    AND public.pitchin_business_shareholder_access(business_profile_id));

-- A new profile gets a dedicated business wallet, never a personal-wallet row.
CREATE OR REPLACE FUNCTION public.ensure_pitchin_business_wallet_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  VALUES (NEW.id, NEW.user_id) ON CONFLICT (business_profile_id) DO NOTHING;
  INSERT INTO public.ican_business_wallet_settings (business_profile_id)
  VALUES (NEW.id) ON CONFLICT (business_profile_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER business_profile_ican_wallet
  AFTER INSERT ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_pitchin_business_wallet_on_insert();
