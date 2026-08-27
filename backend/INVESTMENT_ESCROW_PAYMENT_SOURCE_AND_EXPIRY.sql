-- ================================================================
-- Investment escrow: choice of payment source + real 3-day expiry/refund
-- ================================================================
-- Today (see ShareSigningFlow.jsx verifyWalletPin()): the investor's
-- personal ican_user_wallets balance is debited directly from the client
-- with no atomicity, always from the personal wallet (no choice), and the
-- money is only ever recorded against a fictional 'escrow_pool' ledger
-- address -- it never actually reaches the target business's real
-- ican_business_wallets balance, even once shareholders approve.
-- investment_agreements also has no deadline, so an unapproved investment
-- sits forever with the investor's money already gone.
--
-- This migration:
-- 1. Adds payment_source_type / payment_source_business_profile_id /
--    approval_deadline to investment_agreements, and 'expired' to its
--    status CHECK constraint (found and replaced by inspection, same
--    approach as SHAREHOLDER_APPROVAL_AND_GUARANTEE_STRUCTURE_FIX.sql,
--    since its exact name has drifted across earlier migrations).
-- 2. create_investment_escrow(...): SECURITY DEFINER replacement for the
--    client-side debit+insert. Debits either the personal wallet or a
--    business wallet the investor operates (pitchin_business_wallet_operator),
--    atomically (row-locked), and sets approval_deadline = now() + 3 days.
-- 3. Extends check_and_seal_investment_agreement() (from
--    AUTO_SEAL_INVESTMENT_AGREEMENTS.sql) so sealing an agreement also
--    calls release_investment_escrow_to_business(), which is the part
--    that actually credits the target business's ican_business_wallets
--    balance -- the gap described above.
-- 4. refund_expired_investment_agreements(): service_role-only sweep
--    (called by the api/investment-expiry-sweep.js Vercel cron) that
--    refunds any 'signing' agreement past its approval_deadline back to
--    whichever account it was originally paid from, and marks it 'expired'.
--
-- Idempotent / safe to re-run.
-- ================================================================

DO $$
BEGIN
  IF to_regclass('public.investment_agreements') IS NULL THEN
    RAISE EXCEPTION 'investment_agreements must exist first -- run CREATE_INVESTMENT_AGREEMENTS_CORE_TABLES.sql';
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 1. New columns + status CHECK constraint
-- ----------------------------------------------------------------
ALTER TABLE public.investment_agreements
  ADD COLUMN IF NOT EXISTS payment_source_type TEXT CHECK (payment_source_type IN ('personal', 'business')),
  ADD COLUMN IF NOT EXISTS payment_source_business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_deadline TIMESTAMPTZ;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.investment_agreements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) ILIKE '%pending%'
  LOOP
    EXECUTE format('ALTER TABLE public.investment_agreements DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.investment_agreements
    ADD CONSTRAINT investment_agreements_status_check
    CHECK (status IN ('pending', 'signing', 'sealed', 'cancelled', 'expired'));
END $$;

CREATE INDEX IF NOT EXISTS idx_agreements_approval_deadline
  ON public.investment_agreements(approval_deadline)
  WHERE status = 'signing';

-- ----------------------------------------------------------------
-- 2. create_investment_escrow(): atomic debit + agreement creation
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_investment_escrow(
  p_pitch_id UUID,
  p_business_profile_id UUID,
  p_investment_type TEXT,
  p_shares_amount NUMERIC,
  p_share_price NUMERIC,
  p_total_investment NUMERIC,
  p_escrow_id TEXT,
  p_device_id TEXT,
  p_device_location TEXT,
  p_investor_pin_hash TEXT,
  p_source_type TEXT,
  p_source_business_profile_id UUID DEFAULT NULL
)
RETURNS public.investment_agreements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_investor UUID := auth.uid();
  v_agreement public.investment_agreements;
  v_personal_wallet public.ican_user_wallets;
  v_business_wallet public.ican_business_wallets;
BEGIN
  IF v_investor IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to invest';
  END IF;
  IF p_total_investment IS NULL OR p_total_investment <= 0 THEN
    RAISE EXCEPTION 'Investment amount must be positive';
  END IF;
  IF p_source_type NOT IN ('personal', 'business') THEN
    RAISE EXCEPTION 'Invalid payment source type';
  END IF;

  IF p_source_type = 'personal' THEN
    SELECT * INTO v_personal_wallet
      FROM public.ican_user_wallets
     WHERE user_id = v_investor
     FOR UPDATE;

    IF v_personal_wallet IS NULL THEN
      RAISE EXCEPTION 'Personal wallet not found';
    END IF;
    IF v_personal_wallet.ican_balance < p_total_investment THEN
      RAISE EXCEPTION 'Insufficient personal wallet balance';
    END IF;

    UPDATE public.ican_user_wallets
       SET ican_balance = ican_balance - p_total_investment,
           total_spent = COALESCE(total_spent, 0) + p_total_investment,
           updated_at = now()
     WHERE id = v_personal_wallet.id;

    INSERT INTO public.ican_coin_blockchain_txs
      (user_id, tx_hash, tx_type, ican_amount, from_address, to_address, status, timestamp)
    VALUES
      (v_investor, 'escrow-hold-' || p_escrow_id, 'transfer', p_total_investment,
       v_personal_wallet.wallet_address, 'escrow_pool', 'completed', clock_timestamp());
  ELSE
    IF p_source_business_profile_id IS NULL THEN
      RAISE EXCEPTION 'A source business profile is required for a business payment source';
    END IF;
    IF NOT public.pitchin_business_wallet_operator(p_source_business_profile_id) THEN
      RAISE EXCEPTION 'You are not authorized to spend from this business wallet';
    END IF;

    PERFORM public.get_or_create_pitchin_business_wallet(p_source_business_profile_id);

    SELECT * INTO v_business_wallet
      FROM public.ican_business_wallets
     WHERE business_profile_id = p_source_business_profile_id
     FOR UPDATE;

    IF v_business_wallet IS NULL THEN
      RAISE EXCEPTION 'Business wallet not found';
    END IF;
    IF v_business_wallet.ican_balance < p_total_investment THEN
      RAISE EXCEPTION 'Insufficient business wallet balance';
    END IF;

    UPDATE public.ican_business_wallets
       SET ican_balance = ican_balance - p_total_investment,
           total_spent = COALESCE(total_spent, 0) + p_total_investment,
           updated_at = now()
     WHERE id = v_business_wallet.id;

    INSERT INTO public.ican_business_wallet_transactions
      (business_profile_id, initiated_by, amount_ican, note, reference_id,
       status, direction, operation_type, metadata)
    VALUES
      (p_source_business_profile_id, v_investor, p_total_investment,
       'Investment escrow hold for pitch ' || p_pitch_id::text, p_escrow_id,
       'completed', 'out', 'investment_escrow_hold',
       jsonb_build_object('pitch_id', p_pitch_id, 'escrow_id', p_escrow_id));
  END IF;

  INSERT INTO public.investment_agreements (
    pitch_id, investor_id, business_profile_id, investment_type,
    shares_amount, share_price, total_investment, status, escrow_id,
    device_id, device_location, investor_pin_hash,
    payment_source_type, payment_source_business_profile_id, approval_deadline
  ) VALUES (
    p_pitch_id, v_investor, p_business_profile_id, p_investment_type,
    p_shares_amount, p_share_price, p_total_investment, 'signing', p_escrow_id,
    p_device_id, p_device_location, p_investor_pin_hash,
    p_source_type, p_source_business_profile_id, now() + interval '3 days'
  )
  RETURNING * INTO v_agreement;

  RETURN v_agreement;
END;
$$;

REVOKE ALL ON FUNCTION public.create_investment_escrow(UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_investment_escrow(UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ----------------------------------------------------------------
-- 3. release_investment_escrow_to_business(): credit the target business
--    when its agreement seals, and wire it into the existing seal trigger
-- ----------------------------------------------------------------
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

  PERFORM public.get_or_create_pitchin_business_wallet(v_agreement.business_profile_id);

  SELECT * INTO v_wallet
    FROM public.ican_business_wallets
   WHERE business_profile_id = v_agreement.business_profile_id
   FOR UPDATE;

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

-- Redefine the existing seal trigger function (from
-- AUTO_SEAL_INVESTMENT_AGREEMENTS.sql) to also release the held funds.
CREATE OR REPLACE FUNCTION public.check_and_seal_investment_agreement()
RETURNS TRIGGER AS $$
DECLARE
  v_agreement RECORD;
  v_total_shareholders INT;
  v_signed_count INT;
BEGIN
  SELECT * INTO v_agreement
  FROM public.investment_agreements
  WHERE id = NEW.agreement_id;

  IF v_agreement IS NULL OR v_agreement.status <> 'signing' THEN
    RETURN NEW;
  END IF;

  v_total_shareholders := public.get_total_shareholders(v_agreement.business_profile_id);
  IF v_total_shareholders = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_signed_count
  FROM public.investment_signatures
  WHERE agreement_id = v_agreement.id
    AND signature_status = 'signed';

  IF (v_signed_count::DECIMAL / v_total_shareholders) >= 0.6 THEN
    UPDATE public.investment_agreements
    SET status = 'sealed',
        sealed_at = COALESCE(sealed_at, CURRENT_TIMESTAMP)
    WHERE id = v_agreement.id;

    PERFORM public.release_investment_escrow_to_business(v_agreement.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------
-- 4. refund_expired_investment_agreements(): the cron sweep target
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_expired_investment_agreements()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agreement RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_agreement IN
    SELECT * FROM public.investment_agreements
     WHERE status = 'signing'
       AND approval_deadline IS NOT NULL
       AND approval_deadline < now()
     FOR UPDATE SKIP LOCKED
  LOOP
    IF v_agreement.payment_source_type = 'business' AND v_agreement.payment_source_business_profile_id IS NOT NULL THEN
      UPDATE public.ican_business_wallets
         SET ican_balance = ican_balance + v_agreement.total_investment,
             total_spent = GREATEST(0, COALESCE(total_spent, 0) - v_agreement.total_investment),
             updated_at = now()
       WHERE business_profile_id = v_agreement.payment_source_business_profile_id;

      INSERT INTO public.ican_business_wallet_transactions
        (business_profile_id, initiated_by, amount_ican, note, reference_id,
         status, direction, operation_type, metadata)
      VALUES
        (v_agreement.payment_source_business_profile_id, v_agreement.investor_id, v_agreement.total_investment,
         'Investment refunded - shareholder approval window expired', v_agreement.escrow_id,
         'completed', 'in', 'investment_escrow_refund_expired',
         jsonb_build_object('agreement_id', v_agreement.id, 'pitch_id', v_agreement.pitch_id));
    ELSE
      UPDATE public.ican_user_wallets
         SET ican_balance = ican_balance + v_agreement.total_investment,
             total_spent = GREATEST(0, COALESCE(total_spent, 0) - v_agreement.total_investment),
             updated_at = now()
       WHERE user_id = v_agreement.investor_id;

      INSERT INTO public.ican_coin_blockchain_txs
        (user_id, tx_hash, tx_type, ican_amount, from_address, to_address, status, timestamp)
      VALUES
        (v_agreement.investor_id, 'escrow-refund-' || v_agreement.escrow_id, 'transfer',
         v_agreement.total_investment, 'escrow_pool', 'personal_wallet', 'completed', clock_timestamp());
    END IF;

    UPDATE public.investment_agreements
       SET status = 'expired',
           updated_at = now()
     WHERE id = v_agreement.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_expired_investment_agreements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_expired_investment_agreements() TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'Investment escrow payment-source + expiry migration applied successfully.';
END $$;
