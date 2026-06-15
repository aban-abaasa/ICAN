-- STEP 1: Create business_documents table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.business_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  
  -- Business Plan
  business_plan_content TEXT,
  business_plan_completed BOOLEAN DEFAULT FALSE,
  
  -- Financial Projection
  financial_projection_content TEXT,
  financial_projection_completed BOOLEAN DEFAULT FALSE,
  
  -- Value Proposition
  value_proposition_content TEXT,
  value_proposition_wants TEXT,
  value_proposition_fears TEXT,
  value_proposition_needs TEXT,
  value_proposition_completed BOOLEAN DEFAULT FALSE,
  
  -- Memorandum of Understanding
  mou_content TEXT,
  mou_completed BOOLEAN DEFAULT FALSE,
  
  -- Share Allocation
  share_allocation_content TEXT,
  share_allocation_shares NUMERIC(18, 2),
  share_allocation_share_price NUMERIC(18, 2),
  share_allocation_total_amount NUMERIC(18, 2),
  share_allocation_completed BOOLEAN DEFAULT FALSE,
  
  -- Disclosure/Privacy
  no_disclosure_enabled BOOLEAN DEFAULT FALSE,
  disclosure_notes TEXT,
  
  -- Overall Status
  all_documents_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint to ensure one documents record per business profile
  UNIQUE(business_profile_id)
);

-- STEP 2: Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_business_documents_profile_id 
ON public.business_documents(business_profile_id);

-- STEP 3: Add updated_at trigger
CREATE OR REPLACE FUNCTION update_business_documents_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_business_documents_updated_at ON public.business_documents;
CREATE TRIGGER trigger_business_documents_updated_at
BEFORE UPDATE ON public.business_documents
FOR EACH ROW
EXECUTE FUNCTION update_business_documents_timestamp();

-- STEP 4: Disable RLS temporarily to test
ALTER TABLE public.business_documents DISABLE ROW LEVEL SECURITY;

-- STEP 5: Grant permissions to authenticated users
GRANT ALL PRIVILEGES ON public.business_documents TO authenticated;
GRANT SELECT ON public.business_documents TO anon;

-- That's it! Now test in the app.
-- Once working, we'll add RLS policies for security.
