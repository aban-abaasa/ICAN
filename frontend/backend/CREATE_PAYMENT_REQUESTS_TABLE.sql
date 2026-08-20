-- Create payment_requests table for storing payment requests with QR codes
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS public.payment_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_code VARCHAR(50) UNIQUE NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, completed, expired
  payer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  transaction_id BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('UTC'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('UTC'::text, NOW()),
  completed_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT valid_amount CHECK (amount > 0),
  CONSTRAINT valid_currency CHECK (currency IN ('USD', 'UGX', 'KES', 'TZS', 'RWF'))
);

-- Cash requests use the exact same QR lifecycle as wallet requests, but they
-- never debit or credit an ICAN wallet. The payer records receipt proof only.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(10) NOT NULL DEFAULT 'ican';
ALTER TABLE public.payment_requests
  DROP CONSTRAINT IF EXISTS payment_requests_payment_method_check;
ALTER TABLE public.payment_requests
  ADD CONSTRAINT payment_requests_payment_method_check
  CHECK (payment_method IN ('ican', 'cash'));

CREATE TABLE IF NOT EXISTS public.cash_payment_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id BIGINT NOT NULL UNIQUE REFERENCES public.payment_requests(id) ON DELETE RESTRICT,
  payer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(10) NOT NULL,
  expense_classification TEXT NOT NULL DEFAULT 'personal_expense'
    CHECK (expense_classification IN ('personal_expense', 'business_expense')),
  business_profile_id UUID,
  receipt_number TEXT NOT NULL UNIQUE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_payment_receipts
  ADD COLUMN IF NOT EXISTS expense_classification TEXT NOT NULL DEFAULT 'personal_expense',
  ADD COLUMN IF NOT EXISTS business_profile_id UUID;
ALTER TABLE public.cash_payment_receipts
  DROP CONSTRAINT IF EXISTS cash_payment_receipts_expense_classification_check;
ALTER TABLE public.cash_payment_receipts
  ADD CONSTRAINT cash_payment_receipts_expense_classification_check
  CHECK (expense_classification IN ('personal_expense', 'business_expense'));

CREATE INDEX IF NOT EXISTS idx_cash_payment_receipts_payer ON public.cash_payment_receipts(payer_user_id, recorded_at DESC);
GRANT SELECT ON public.cash_payment_receipts TO authenticated;
ALTER TABLE public.cash_payment_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Cash receipt parties can view receipt" ON public.cash_payment_receipts;
CREATE POLICY "Cash receipt parties can view receipt" ON public.cash_payment_receipts
  FOR SELECT USING (auth.uid() IN (payer_user_id, recipient_user_id));

DROP FUNCTION IF EXISTS public.record_cash_payment_request(TEXT);
CREATE OR REPLACE FUNCTION public.record_cash_payment_request(
  p_payment_code TEXT,
  p_expense_classification TEXT DEFAULT 'personal_expense',
  p_business_profile_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_request public.payment_requests;
  v_receipt public.cash_payment_receipts;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in is required to record a cash payment'; END IF;
  SELECT * INTO v_request FROM public.payment_requests
   WHERE payment_code = trim(p_payment_code) AND status = 'pending'
     AND expires_at > now() AND payment_method = 'cash'
   FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Cash payment request not found, expired, or already completed'; END IF;
  IF v_request.user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot record your own cash request as payer'; END IF;
  IF lower(trim(COALESCE(p_expense_classification, ''))) NOT IN ('personal_expense', 'business_expense') THEN
    RAISE EXCEPTION 'Invalid payment classification';
  END IF;
  INSERT INTO public.cash_payment_receipts
    (payment_request_id, payer_user_id, recipient_user_id, amount, currency, expense_classification, business_profile_id, receipt_number)
  VALUES
    (v_request.id, auth.uid(), v_request.user_id, v_request.amount, v_request.currency,
     lower(trim(p_expense_classification)), p_business_profile_id,
     'CASH-RCP-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
  RETURNING * INTO v_receipt;
  UPDATE public.payment_requests
     SET status = 'completed', payer_user_id = auth.uid(), completed_at = now(), updated_at = now()
   WHERE id = v_request.id;

  -- Mirror the completed cash event into the normal ICAN transaction ledger,
  -- so both payer and receiver activity and Reports stay in sync.
  INSERT INTO public.ican_transactions
    (user_id, transaction_type, amount, currency, description, status, metadata, created_at)
  VALUES
    (auth.uid(), 'cash_payment', v_request.amount, v_request.currency,
     COALESCE(v_request.description, 'Cash payment'), 'completed',
     jsonb_build_object('payment_method', 'cash', 'cash_receipt_id', v_receipt.id,
       'receipt_number', v_receipt.receipt_number, 'expense_classification', v_receipt.expense_classification,
       'business_profile_id', v_receipt.business_profile_id, 'counterparty_user_id', v_request.user_id), now()),
    (v_request.user_id, 'cash_received', v_request.amount, v_request.currency,
     COALESCE(v_request.description, 'Cash received'), 'completed',
     jsonb_build_object('payment_method', 'cash', 'cash_receipt_id', v_receipt.id,
       'receipt_number', v_receipt.receipt_number, 'counterparty_user_id', auth.uid()), now());
  RETURN jsonb_build_object('success', true, 'receipt_number', v_receipt.receipt_number,
    'cash_transaction_id', v_receipt.id, 'recorded_at', v_receipt.recorded_at);
END;
$$;
REVOKE ALL ON FUNCTION public.record_cash_payment_request(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_cash_payment_request(TEXT, TEXT, UUID) TO authenticated;

-- Ensure REST roles can access the table (RLS still applies).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_requests TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.payment_requests_id_seq TO anon, authenticated, service_role;

-- Create indexes for better query performance.
CREATE INDEX IF NOT EXISTS idx_payment_requests_user_id ON public.payment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_payment_code ON public.payment_requests(payment_code);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON public.payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_expires_at ON public.payment_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_requests_payer_user_id ON public.payment_requests(payer_user_id);

-- Enable Row Level Security (RLS).
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- Recreate policies so script can be rerun safely.
DROP POLICY IF EXISTS "Users can view their own payment requests" ON public.payment_requests;
DROP POLICY IF EXISTS "Users can create payment requests" ON public.payment_requests;
DROP POLICY IF EXISTS "Users can update their own payment requests" ON public.payment_requests;
DROP POLICY IF EXISTS "Users can delete their own payment requests" ON public.payment_requests;
DROP POLICY IF EXISTS "Anyone can view valid payment requests by code" ON public.payment_requests;

-- Users can view their own payment requests.
CREATE POLICY "Users can view their own payment requests"
  ON public.payment_requests
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create payment requests for themselves.
CREATE POLICY "Users can create payment requests"
  ON public.payment_requests
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own payment requests.
CREATE POLICY "Users can update their own payment requests"
  ON public.payment_requests
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own pending payment requests.
CREATE POLICY "Users can delete their own payment requests"
  ON public.payment_requests
  FOR DELETE
  USING (auth.uid() = user_id AND status = 'pending');

-- Anyone can view valid pending payment requests by code.
CREATE POLICY "Anyone can view valid payment requests by code"
  ON public.payment_requests
  FOR SELECT
  USING (
    status = 'pending'
    AND expires_at > NOW()
    AND payment_code IS NOT NULL
  );

-- Function to mark expired requests.
CREATE OR REPLACE FUNCTION public.mark_expired_payment_requests()
RETURNS void AS $$
BEGIN
  UPDATE public.payment_requests
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'pending'
  AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Trigger function to keep updated_at fresh.
CREATE OR REPLACE FUNCTION public.update_payment_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_requests_updated_at_trigger ON public.payment_requests;
CREATE TRIGGER payment_requests_updated_at_trigger
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_payment_requests_updated_at();

-- Force PostgREST to reload schema so /rest/v1/payment_requests becomes available immediately.
NOTIFY pgrst, 'reload schema';
