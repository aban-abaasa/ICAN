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
