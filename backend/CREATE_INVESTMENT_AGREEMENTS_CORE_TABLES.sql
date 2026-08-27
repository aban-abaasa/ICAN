-- ================================================================
-- Create the investment_agreements / investment_signatures /
-- investment_approvals tables actually used by the live frontend
-- (ShareSigningFlow.jsx).
--
-- Root cause found: `SELECT to_regclass('public.investment_agreements')`
-- returned NULL on the live Supabase project -- none of these three
-- tables exist yet. Every prior "fix" migration for this area
-- (SHAREHOLDER_APPROVAL_AND_GUARANTEE_STRUCTURE_FIX.sql included)
-- defensively no-ops when the table is missing, so none of them ever
-- actually created it. That's the real reason every investment attempt
-- has been failing (404 Not Found from PostgREST, not a constraint
-- violation).
--
-- Uses CREATE TABLE IF NOT EXISTS (not DROP+CREATE, unlike the older
-- INVESTMENT_APPROVAL_SYSTEM.sql this schema is drawn from) so this is
-- safe to run even if the tables turn out to already exist with data.
--
-- Run this BEFORE (or in the same session as, order doesn't matter --
-- both are idempotent) SHAREHOLDER_APPROVAL_AND_GUARANTEE_STRUCTURE_FIX.sql,
-- since that file's constraint/function/view updates only take effect
-- once these tables exist.
-- ================================================================

-- ----------------------------------------------------------------
-- investment_agreements
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.investment_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL REFERENCES public.pitches(id) ON DELETE CASCADE,
  investor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,

  investment_type TEXT NOT NULL CHECK (investment_type IN ('buy', 'partner', 'support', 'guarantor')),
  shares_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  share_price DECIMAL(15, 2) NOT NULL,
  total_investment DECIMAL(15, 2) NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signing', 'sealed', 'cancelled')),
  escrow_id TEXT UNIQUE,
  escrow_recipient_wallet TEXT,

  device_id TEXT,
  device_location TEXT,
  investor_pin_hash TEXT,
  qr_code_url TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sealed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_investment CHECK (total_investment > 0),
  CONSTRAINT valid_shares CHECK (shares_amount >= 0),
  CONSTRAINT valid_price CHECK (share_price > 0 OR investment_type != 'buy')
);

CREATE INDEX IF NOT EXISTS idx_agreements_pitch ON public.investment_agreements(pitch_id);
CREATE INDEX IF NOT EXISTS idx_agreements_investor ON public.investment_agreements(investor_id);
CREATE INDEX IF NOT EXISTS idx_agreements_business ON public.investment_agreements(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_agreements_status ON public.investment_agreements(status);
CREATE INDEX IF NOT EXISTS idx_agreements_escrow ON public.investment_agreements(escrow_id);
CREATE INDEX IF NOT EXISTS idx_agreements_created ON public.investment_agreements(created_at DESC);

ALTER TABLE public.investment_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investors_view_own_agreements" ON public.investment_agreements;
CREATE POLICY "investors_view_own_agreements" ON public.investment_agreements
  FOR SELECT USING (auth.uid() = investor_id);

DROP POLICY IF EXISTS "investors_create_agreements" ON public.investment_agreements;
CREATE POLICY "investors_create_agreements" ON public.investment_agreements
  FOR INSERT WITH CHECK (auth.uid() = investor_id);

DROP POLICY IF EXISTS "investors_update_agreements" ON public.investment_agreements;
CREATE POLICY "investors_update_agreements" ON public.investment_agreements
  FOR UPDATE USING (auth.uid() = investor_id);

GRANT SELECT, INSERT, UPDATE ON public.investment_agreements TO authenticated;

-- ----------------------------------------------------------------
-- investment_signatures
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.investment_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES public.investment_agreements(id) ON DELETE CASCADE,
  shareholder_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shareholder_name TEXT NOT NULL,
  shareholder_email TEXT NOT NULL,

  signature_pin_hash TEXT NOT NULL,
  signature_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  device_id TEXT,
  device_location TEXT,

  is_business_owner BOOLEAN DEFAULT false,
  signature_status TEXT NOT NULL DEFAULT 'pending' CHECK (signature_status IN ('signed', 'pending', 'rejected')),
  rejection_reason TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  signed_at TIMESTAMP WITH TIME ZONE,

  UNIQUE(agreement_id, shareholder_id)
);

CREATE INDEX IF NOT EXISTS idx_signatures_agreement ON public.investment_signatures(agreement_id);
CREATE INDEX IF NOT EXISTS idx_signatures_shareholder ON public.investment_signatures(shareholder_id);
CREATE INDEX IF NOT EXISTS idx_signatures_status ON public.investment_signatures(signature_status);
CREATE INDEX IF NOT EXISTS idx_signatures_timestamp ON public.investment_signatures(signature_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_signatures_agreement_status ON public.investment_signatures(agreement_id, signature_status);

ALTER TABLE public.investment_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shareholders_view_own_signatures" ON public.investment_signatures;
CREATE POLICY "shareholders_view_own_signatures" ON public.investment_signatures
  FOR SELECT USING (auth.uid() = shareholder_id);

DROP POLICY IF EXISTS "shareholders_sign_agreements" ON public.investment_signatures;
CREATE POLICY "shareholders_sign_agreements" ON public.investment_signatures
  FOR INSERT WITH CHECK (auth.uid() = shareholder_id);

DROP POLICY IF EXISTS "shareholders_update_own_signatures" ON public.investment_signatures;
CREATE POLICY "shareholders_update_own_signatures" ON public.investment_signatures
  FOR UPDATE USING (auth.uid() = shareholder_id);

GRANT SELECT, INSERT, UPDATE ON public.investment_signatures TO authenticated;

-- ----------------------------------------------------------------
-- investment_approvals
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.investment_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id UUID NOT NULL UNIQUE,
  agreement_id UUID REFERENCES public.investment_agreements(id) ON DELETE SET NULL,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,

  investor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  investor_email TEXT NOT NULL,
  investor_signature_status TEXT DEFAULT 'pending' CHECK (investor_signature_status IN ('signed', 'pin_verified', 'pending')),
  investor_signed_at TIMESTAMP WITH TIME ZONE,

  wallet_account_number TEXT,
  transfer_amount DECIMAL(15, 2) NOT NULL,
  transfer_status TEXT DEFAULT 'pending' CHECK (transfer_status IN ('completed', 'pending', 'failed', 'reversed')),
  transfer_completed_at TIMESTAMP WITH TIME ZONE,
  transfer_reference TEXT UNIQUE,

  total_shareholders INTEGER DEFAULT 0,
  shareholders_signed INTEGER DEFAULT 0,
  approval_threshold_percent DECIMAL(5, 2) DEFAULT 60.0,
  approval_threshold_met BOOLEAN DEFAULT false,
  auto_sealed_at TIMESTAMP WITH TIME ZONE,

  document_status TEXT DEFAULT 'pending' CHECK (document_status IN ('pending', 'signed', 'finalized', 'cancelled')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  approval_deadline TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_approvals_investor ON public.investment_approvals(investor_id);
CREATE INDEX IF NOT EXISTS idx_approvals_business ON public.investment_approvals(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_approvals_agreement ON public.investment_approvals(agreement_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON public.investment_approvals(approval_threshold_met);
CREATE INDEX IF NOT EXISTS idx_approvals_transfer_ref ON public.investment_approvals(transfer_reference);
CREATE INDEX IF NOT EXISTS idx_approvals_created ON public.investment_approvals(created_at DESC);

ALTER TABLE public.investment_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investors_view_own_approvals" ON public.investment_approvals;
CREATE POLICY "investors_view_own_approvals" ON public.investment_approvals
  FOR SELECT USING (auth.uid() = investor_id);

DROP POLICY IF EXISTS "investors_create_approvals" ON public.investment_approvals;
CREATE POLICY "investors_create_approvals" ON public.investment_approvals
  FOR INSERT WITH CHECK (auth.uid() = investor_id);

DROP POLICY IF EXISTS "investors_update_approvals" ON public.investment_approvals;
CREATE POLICY "investors_update_approvals" ON public.investment_approvals
  FOR UPDATE USING (auth.uid() = investor_id);

GRANT SELECT, INSERT, UPDATE ON public.investment_approvals TO authenticated;

-- ----------------------------------------------------------------
-- Auto-update updated_at on both tables
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_agreements_updated_at ON public.investment_agreements;
CREATE TRIGGER update_agreements_updated_at
  BEFORE UPDATE ON public.investment_agreements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_approvals_updated_at ON public.investment_approvals;
CREATE TRIGGER update_approvals_updated_at
  BEFORE UPDATE ON public.investment_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  RAISE NOTICE 'investment_agreements / investment_signatures / investment_approvals created (or already existed).';
END $$;
