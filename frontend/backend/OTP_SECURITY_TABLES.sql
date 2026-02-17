-- ====================================
-- OTP & Security Tables Setup
-- ====================================

-- Create OTP codes table
CREATE TABLE IF NOT EXISTS public.otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code VARCHAR(6) NOT NULL,
  type VARCHAR(50) DEFAULT 'pin_change', -- pin_change, email_verify, phone_verify
  phone_number VARCHAR(20),
  email VARCHAR(255),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for fast OTP lookup
CREATE INDEX IF NOT EXISTS idx_otp_codes_user_id ON public.otp_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires_at ON public.otp_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_codes_type ON public.otp_codes(type);

-- Create security logs table for audit trail
CREATE TABLE IF NOT EXISTS public.security_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL, -- pin_changed, pin_verification_failed, etc
  ip_address VARCHAR(45), -- Support both IPv4 and IPv6
  user_agent TEXT,
  details JSONB DEFAULT '{}',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for security logs
CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON public.security_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_timestamp ON public.security_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_security_logs_action ON public.security_logs(action);

-- Add PIN hash column to user_accounts if it doesn't exist
ALTER TABLE public.user_accounts
ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(64);

-- Create index on pin_hash for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_accounts_pin_hash ON public.user_accounts(pin_hash) WHERE pin_hash IS NOT NULL;

-- Set up RLS policies for otp_codes
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

-- Users can view their own OTP codes
CREATE POLICY "Users can view own OTP codes" ON public.otp_codes
  FOR SELECT USING (user_id = auth.uid());

-- Service role can manage OTP codes (for backend operations)
CREATE POLICY "Service role can manage OTP codes" ON public.otp_codes
  FOR ALL USING (auth.role() = 'service_role');

-- Set up RLS policies for security_logs
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own security logs
CREATE POLICY "Users can view own security logs" ON public.security_logs
  FOR SELECT USING (user_id = auth.uid());

-- Service role can manage security logs
CREATE POLICY "Service role can manage security logs" ON public.security_logs
  FOR ALL USING (auth.role() = 'service_role');

-- Clean up expired OTP codes (run this periodically)
-- DELETE FROM public.otp_codes WHERE expires_at < NOW() AND used = FALSE;

-- Query to check OTP codes for a user
-- SELECT id, code, type, expires_at, used, created_at FROM public.otp_codes 
-- WHERE user_id = '...' AND type = 'pin_change' AND used = FALSE
-- ORDER BY created_at DESC LIMIT 1;
