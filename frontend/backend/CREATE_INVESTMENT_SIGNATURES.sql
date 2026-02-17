-- =============================================
-- CREATE INVESTMENT SIGNATURES TABLE
-- =============================================
-- Stores all shareholder signatures for investments
-- Tracks when each shareholder signed and approved

-- Drop existing table if it exists (for fresh setup)
-- DROP TABLE IF EXISTS public.investment_signatures CASCADE;

-- Create the table
CREATE TABLE IF NOT EXISTS public.investment_signatures (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  investment_transaction_id uuid NOT NULL,
  shareholder_id uuid NOT NULL,
  shareholder_email text NOT NULL,
  signature_method text NOT NULL DEFAULT 'shareholder_pin',
  signature_timestamp timestamp with time zone NOT NULL,
  pin_masked text,
  machine_id text,
  status text NOT NULL DEFAULT 'approved',
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Add foreign key constraint
ALTER TABLE public.investment_signatures
ADD CONSTRAINT IF NOT EXISTS fk_investment_transaction_id 
FOREIGN KEY (investment_transaction_id) 
REFERENCES public.ican_transactions(id) 
ON DELETE CASCADE;

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_investment_signatures_transaction_id 
ON public.investment_signatures(investment_transaction_id);

CREATE INDEX IF NOT EXISTS idx_investment_signatures_shareholder_id 
ON public.investment_signatures(shareholder_id);

CREATE INDEX IF NOT EXISTS idx_investment_signatures_shareholder_email 
ON public.investment_signatures(shareholder_email);

-- Enable RLS
ALTER TABLE public.investment_signatures ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Shareholders can view their own signatures" ON public.investment_signatures;
DROP POLICY IF EXISTS "Shareholders can sign investments" ON public.investment_signatures;

-- RLS Policies using auth.uid()
CREATE POLICY "Shareholders can view their own signatures"
ON public.investment_signatures
FOR SELECT
USING (shareholder_id = auth.uid());

CREATE POLICY "Shareholders can sign investments"
ON public.investment_signatures
FOR INSERT
WITH CHECK (shareholder_id = auth.uid());

-- =============================================
-- UPDATE ICAN_TRANSACTIONS TABLE (Optional)
-- =============================================
-- Add fields to track investment signatures if not present
-- Note: signatures are stored in investment_signatures table instead

-- These are optional - signatures are tracked in separate table
ALTER TABLE public.ican_transactions
ADD COLUMN IF NOT EXISTS signature_required boolean DEFAULT true;

ALTER TABLE public.ican_transactions
ADD COLUMN IF NOT EXISTS signature_deadline timestamp with time zone;

-- Metadata field should already exist for storing shares, etc
-- If not, uncomment:
-- ALTER TABLE public.ican_transactions
-- ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- =============================================
-- CREATE INVESTMENT DETAILS VIEW
-- =============================================
-- Helps fetch full investment details for shareholders
-- Safely handles missing metadata/joins

DROP VIEW IF EXISTS public.investment_details_for_shareholders CASCADE;

CREATE VIEW public.investment_details_for_shareholders AS
SELECT
  it.id as investment_id,
  it.id as transaction_id,
  it.user_id as investor_id,
  u.email as investor_email,
  COALESCE(p.title, 'Unknown Pitch') as pitch_title,
  COALESCE(bp.business_name, 'Unknown Business') as business_name,
  it.amount,
  it.currency,
  COALESCE(it.metadata->>'shares', 'N/A') as shares,
  it.transaction_type as investment_type,
  it.created_at as investment_date,
  (it.created_at + INTERVAL '24 hours') as signature_deadline,
  COALESCE((it.metadata->>'signature_required')::boolean, true) as signature_required,
  (SELECT COUNT(*) FROM public.investment_signatures 
   WHERE investment_transaction_id = it.id AND status = 'approved') as signatures_received,
  COALESCE((it.metadata->>'signatures_required')::integer, 1) as signatures_required,
  EXTRACT(HOUR FROM (it.created_at + INTERVAL '24 hours' - now()))::integer as hours_remaining
FROM
  public.ican_transactions it
  LEFT JOIN public.profiles u ON it.user_id = u.id
  LEFT JOIN public.pitches p ON (it.metadata->>'pitch_id')::uuid = p.id
  LEFT JOIN public.business_profiles bp ON p.business_profile_id = bp.id
WHERE
  it.transaction_type IN ('equity', 'partnership', 'support')
  AND it.status NOT IN ('cancelled', 'rejected');

-- =============================================
-- GRANT PERMISSIONS
-- =============================================

GRANT SELECT ON public.investment_signatures TO authenticated;
GRANT INSERT ON public.investment_signatures TO authenticated;
GRANT SELECT ON public.investment_details_for_shareholders TO authenticated;
