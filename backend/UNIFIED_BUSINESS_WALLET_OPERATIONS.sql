-- ============================================================================
-- Unified business-wallet operations for ICAN, PitchIn, CMMS, POS and BodaGo
--
-- Run after PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql.
-- Partnerships, sole proprietorships, supermarkets and CMMS companies all
-- resolve to the same dedicated wallet through business_profile_id.
-- ============================================================================

ALTER TABLE public.ican_business_wallet_transactions
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'out'
    CHECK (direction IN ('in', 'out')),
  ADD COLUMN IF NOT EXISTS source_app TEXT NOT NULL DEFAULT 'ican',
  ADD COLUMN IF NOT EXISTS operation_type TEXT NOT NULL DEFAULT 'transfer',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS idx_ican_business_wallet_tx_operation
  ON public.ican_business_wallet_transactions(business_profile_id, source_app, direction, created_at DESC);

CREATE OR REPLACE FUNCTION public.ican_business_operation_access(
  p_business_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
    OR EXISTS (
      SELECT 1 FROM public.business_account_members bm
       WHERE bm.business_profile_id = p_business_profile_id
         AND bm.auth_user_id = auth.uid()
         AND lower(COALESCE(bm.employment_status, 'active')) = 'active'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.ican_business_operation_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_business_operation_access(UUID) TO authenticated;

-- Shared debit entry point for payroll, transport, inventory, supplier
-- payments, POS purchases and PitchIn operating expenses. The underlying RPC
-- enforces the business PIN and 60% shareholder approval threshold.
CREATE OR REPLACE FUNCTION public.ican_business_wallet_charge(
  p_business_profile_id UUID,
  p_recipient_user_id UUID,
  p_amount_ican NUMERIC,
  p_source_app TEXT,
  p_operation_type TEXT,
  p_note TEXT DEFAULT '',
  p_reference_id TEXT DEFAULT NULL,
  p_pin TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_tx UUID;
BEGIN
  IF NOT public.ican_business_operation_access(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business operation access required';
  END IF;

  v_result := public.pitchin_business_wallet_transfer(
    p_business_profile_id,
    p_recipient_user_id,
    p_amount_ican,
    p_note,
    p_reference_id,
    p_pin
  );
  v_tx := NULLIF(v_result ->> 'transaction_id', '')::UUID;

  IF v_tx IS NOT NULL THEN
    UPDATE public.ican_business_wallet_transactions
       SET direction = 'out',
           source_app = COALESCE(NULLIF(trim(p_source_app), ''), 'ican'),
           operation_type = COALESCE(NULLIF(trim(p_operation_type), ''), 'expense'),
           metadata = COALESCE(p_metadata, '{}'::JSONB)
     WHERE id = v_tx;
  END IF;

  RETURN v_result || jsonb_build_object(
    'direction', 'out',
    'source_app', COALESCE(NULLIF(trim(p_source_app), ''), 'ican'),
    'operation_type', COALESCE(NULLIF(trim(p_operation_type), ''), 'expense')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ican_business_wallet_charge(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_business_wallet_charge(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- Incoming POS sales and investment settlements must be credited by a trusted
-- server-side settlement process, never by a browser-callable RPC. The unique
-- source key prevents replaying a sale or investment deposit.
CREATE TABLE IF NOT EXISTS public.ican_business_wallet_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  source_app TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  amount_ican NUMERIC(18,8) NOT NULL CHECK (amount_ican > 0),
  settlement_type TEXT NOT NULL CHECK (settlement_type IN ('pos_sale', 'investment', 'refund', 'other_income')),
  note TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (source_app, source_reference)
);

CREATE INDEX IF NOT EXISTS idx_ican_business_wallet_settlements_business
  ON public.ican_business_wallet_settlements(business_profile_id, settled_at DESC);

ALTER TABLE public.ican_business_wallet_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_wallet_settlement_read ON public.ican_business_wallet_settlements;
CREATE POLICY business_wallet_settlement_read
  ON public.ican_business_wallet_settlements
  FOR SELECT TO authenticated
  USING (public.ican_business_operation_access(business_profile_id));

-- This function is intentionally callable only by service_role. POS and
-- investment backends should call it after their own atomic settlement is
-- verified, passing the originating order/agreement reference.
CREATE OR REPLACE FUNCTION public.ican_settle_business_wallet_income(
  p_business_profile_id UUID,
  p_amount_ican NUMERIC,
  p_source_app TEXT,
  p_source_reference TEXT,
  p_settlement_type TEXT,
  p_note TEXT DEFAULT '',
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.ican_business_wallets;
  v_settlement_id UUID;
BEGIN
  IF p_amount_ican IS NULL OR p_amount_ican <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_source_app IS NULL OR trim(p_source_app) = '' OR p_source_reference IS NULL OR trim(p_source_reference) = '' THEN
    RAISE EXCEPTION 'A source app and source reference are required';
  END IF;

  INSERT INTO public.ican_business_wallet_settlements
    (business_profile_id, source_app, source_reference, amount_ican,
     settlement_type, note, metadata, settled_by)
  VALUES
    (p_business_profile_id, trim(p_source_app), trim(p_source_reference),
     p_amount_ican, p_settlement_type, COALESCE(p_note, ''),
     COALESCE(p_metadata, '{}'::JSONB), auth.uid())
  ON CONFLICT (source_app, source_reference) DO NOTHING
  RETURNING id INTO v_settlement_id;

  IF v_settlement_id IS NULL THEN
    SELECT * INTO v_settlement_id
      FROM public.ican_business_wallet_settlements
     WHERE source_app = trim(p_source_app)
       AND source_reference = trim(p_source_reference);
    RETURN jsonb_build_object('success', true, 'status', 'already_settled', 'settlement_id', v_settlement_id);
  END IF;

  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  SELECT id, user_id FROM public.business_profiles WHERE id = p_business_profile_id
  ON CONFLICT (business_profile_id) DO NOTHING;

  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance + p_amount_ican,
         total_earned = total_earned + p_amount_ican,
         updated_at = now()
   WHERE business_profile_id = p_business_profile_id
   RETURNING * INTO v_wallet;

  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, amount_ican, note, reference_id,
     status, executed_at, direction, source_app, operation_type, metadata)
  VALUES
    (p_business_profile_id, auth.uid(), p_amount_ican, COALESCE(p_note, ''),
     p_source_reference, 'completed', now(), 'in', trim(p_source_app),
     p_settlement_type, COALESCE(p_metadata, '{}'::JSONB));

  RETURN jsonb_build_object('success', true, 'status', 'completed', 'settlement_id', v_settlement_id, 'balance', v_wallet.ican_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.ican_settle_business_wallet_income(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_settle_business_wallet_income(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
