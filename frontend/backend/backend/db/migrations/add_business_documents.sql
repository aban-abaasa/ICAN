-- =============================================
-- BUSINESS DOCUMENTS TABLE
-- Document Management for Business Profiles
-- Supports optional file uploads or text content
-- =============================================

CREATE TABLE IF NOT EXISTS public.business_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
    
    -- Business Plan
    business_plan_content TEXT,
    business_plan_file_url VARCHAR(500),
    business_plan_uploaded_at TIMESTAMP WITH TIME ZONE,
    
    -- Financial Projection
    financial_projection_content TEXT,
    financial_projection_file_url VARCHAR(500),
    financial_projection_uploaded_at TIMESTAMP WITH TIME ZONE,
    
    -- Value Proposition (with Wants, Fears, Needs breakdown)
    value_proposition_content TEXT,
    value_proposition_wants TEXT,
    value_proposition_fears TEXT,
    value_proposition_needs TEXT,
    value_proposition_file_url VARCHAR(500),
    value_proposition_uploaded_at TIMESTAMP WITH TIME ZONE,
    
    -- Memorandum of Understanding (MoU)
    mou_content TEXT,
    mou_file_url VARCHAR(500),
    mou_uploaded_at TIMESTAMP WITH TIME ZONE,
    
    -- Share Allocation
    share_allocation_content TEXT,
    share_allocation_shares DECIMAL(15, 2),
    share_allocation_share_price DECIMAL(15, 2),
    share_allocation_total_amount DECIMAL(15, 2),
    share_allocation_file_url VARCHAR(500),
    share_allocation_uploaded_at TIMESTAMP WITH TIME ZONE,
    
    -- Privacy & Disclosure
    no_disclosure_enabled BOOLEAN DEFAULT FALSE,
    disclosure_notes TEXT,
    
    -- Completion Status
    business_plan_completed BOOLEAN DEFAULT FALSE,
    financial_projection_completed BOOLEAN DEFAULT FALSE,
    value_proposition_completed BOOLEAN DEFAULT FALSE,
    mou_completed BOOLEAN DEFAULT FALSE,
    share_allocation_completed BOOLEAN DEFAULT FALSE,
    all_documents_completed BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create index for quick lookup
CREATE INDEX IF NOT EXISTS idx_business_documents_profile 
ON public.business_documents(business_profile_id);

-- Enable RLS
ALTER TABLE public.business_documents ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their business documents" ON public.business_documents;
DROP POLICY IF EXISTS "Users can create business documents" ON public.business_documents;
DROP POLICY IF EXISTS "Users can update their business documents" ON public.business_documents;

-- RLS Policies
CREATE POLICY "Users can view their business documents"
    ON public.business_documents FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.business_profiles
            WHERE business_profiles.id = business_documents.business_profile_id
            AND business_profiles.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create business documents"
    ON public.business_documents FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.business_profiles
            WHERE business_profiles.id = business_documents.business_profile_id
            AND business_profiles.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their business documents"
    ON public.business_documents FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.business_profiles
            WHERE business_profiles.id = business_documents.business_profile_id
            AND business_profiles.user_id = auth.uid()
        )
    );

-- Add grant for authenticated users
GRANT SELECT, INSERT, UPDATE ON public.business_documents TO authenticated;
GRANT USAGE ON SEQUENCE IF EXISTS public.business_documents_id_seq TO authenticated;
