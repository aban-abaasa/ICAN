-- =============================================
-- INVESTMENT SIGNATURES TABLE & SETUP
-- Stores shareholder signature records with PIN verification
-- =============================================
-- 🔧 RUN THIS IN SUPABASE SQL EDITOR

-- ===== STEP 1: Drop existing objects if needed =====
DROP VIEW IF EXISTS public.investment_details_for_shareholders CASCADE;
DROP TABLE IF EXISTS public.investment_signatures CASCADE;

-- ===== STEP 2: Create investment signatures table =====
CREATE TABLE public.investment_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investment_transaction_id UUID NOT NULL,
    shareholder_id UUID NOT NULL,
    shareholder_email TEXT NOT NULL,
    signature_method TEXT DEFAULT 'pin',
    signature_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    pin_masked TEXT,
    machine_id TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ===== STEP 3: Add foreign key to ican_transactions =====
ALTER TABLE public.investment_signatures
ADD CONSTRAINT fk_investment_transaction_id 
FOREIGN KEY (investment_transaction_id) 
REFERENCES public.ican_transactions(id) 
ON DELETE CASCADE;

-- ===== STEP 4: Add foreign keys to profiles =====
ALTER TABLE public.investment_signatures
ADD CONSTRAINT fk_shareholder_id 
FOREIGN KEY (shareholder_id) 
REFERENCES public.profiles(id) 
ON DELETE CASCADE;

-- ===== STEP 5: Create indexes =====
CREATE INDEX idx_investment_signatures_transaction_id 
ON public.investment_signatures(investment_transaction_id);

CREATE INDEX idx_investment_signatures_shareholder_id 
ON public.investment_signatures(shareholder_id);

CREATE INDEX idx_investment_signatures_shareholder_email 
ON public.investment_signatures(shareholder_email);

CREATE INDEX idx_investment_signatures_status 
ON public.investment_signatures(status);

CREATE INDEX idx_investment_signatures_created_at 
ON public.investment_signatures(created_at DESC);

-- ===== STEP 6: Enable Row Level Security =====
ALTER TABLE public.investment_signatures ENABLE ROW LEVEL SECURITY;

-- ===== STEP 7: Drop existing RLS policies if needed =====
DROP POLICY IF EXISTS "Shareholders can view their own signatures" ON public.investment_signatures;
DROP POLICY IF EXISTS "Shareholders can insert signatures" ON public.investment_signatures;
DROP POLICY IF EXISTS "Investors can view signatures on their investments" ON public.investment_signatures;

-- ===== STEP 8: Create RLS policies =====
-- Shareholders can view their own signatures
CREATE POLICY "Shareholders can view their own signatures"
ON public.investment_signatures FOR SELECT
USING (shareholder_id = auth.uid());

-- Shareholders can insert their own signatures
CREATE POLICY "Shareholders can insert signatures"
ON public.investment_signatures FOR INSERT
WITH CHECK (shareholder_id = auth.uid());

-- Investors can view signatures on their investments
CREATE POLICY "Investors can view signatures on their investments"
ON public.investment_signatures FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.ican_transactions
        WHERE id = investment_signatures.investment_transaction_id
        AND user_id = auth.uid()
    )
);

-- ===== STEP 9: Grant permissions to authenticated users =====
GRANT SELECT, INSERT, UPDATE ON public.investment_signatures TO authenticated;

-- ===== STEP 10: Create view for fetching investment details =====
CREATE VIEW public.investment_details_for_shareholders AS
SELECT
    it.id as investment_id,
    it.user_id as investor_id,
    pr.email as investor_email,
    COALESCE(pr.full_name, pr.email) as investor_name,
    COALESCE(p.title, 'Investment Opportunity') as pitch_title,
    COALESCE(bp.business_name, 'Unknown Business') as business_name,
    it.amount,
    it.currency,
    it.transaction_type as investment_type,
    COALESCE(it.metadata->>'shares', '0') as shares,
    it.created_at as investment_date,
    (it.created_at + INTERVAL '24 hours') as signature_deadline,
    CASE 
        WHEN (it.created_at + INTERVAL '24 hours') < NOW() THEN 'expired'
        WHEN (it.created_at + INTERVAL '24 hours') < (NOW() + INTERVAL '1 hour') THEN 'urgent'
        ELSE 'active'
    END as deadline_status,
    EXTRACT(HOUR FROM (it.created_at + INTERVAL '24 hours' - NOW()))::integer as hours_remaining,
    COALESCE(
        (SELECT COUNT(*) FROM public.investment_signatures 
         WHERE investment_transaction_id = it.id 
         AND status = 'approved'),
        0
    )::integer as signatures_received,
    COALESCE((it.metadata->>'signatures_required')::integer, 1) as signatures_required,
    it.status as investment_status,
    it.metadata
FROM
    public.ican_transactions it
    LEFT JOIN public.ican_user_profiles pr ON it.user_id = pr.id
    LEFT JOIN public.pitches p ON (it.metadata->>'pitch_id')::uuid = p.id
    LEFT JOIN public.business_profiles bp ON p.business_profile_id = bp.id
WHERE
    it.transaction_type IN ('equity', 'partnership', 'support')
    AND it.status NOT IN ('cancelled', 'rejected');

-- ===== STEP 11: Grant permissions on view =====
GRANT SELECT ON public.investment_details_for_shareholders TO authenticated;

-- ===== VERIFICATION QUERIES (check if successful) =====
-- Run these to verify the setup worked:
-- SELECT * FROM information_schema.tables WHERE table_name = 'investment_signatures';
-- SELECT * FROM information_schema.columns WHERE table_name = 'investment_signatures' ORDER BY ordinal_position;
-- SELECT * FROM pg_indexes WHERE tablename = 'investment_signatures';
-- SELECT * FROM pg_policies WHERE tablename = 'investment_signatures';

COMMIT;
