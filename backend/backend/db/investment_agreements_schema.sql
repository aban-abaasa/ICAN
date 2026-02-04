-- =============================================
-- INVESTMENT AGREEMENTS SCHEMA
-- MOU/Agreement system for pitches
-- Supports: Partners, Investors, Shareholders, Grants
-- =============================================

-- =============================================
-- MAIN AGREEMENTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.investment_agreements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Link to pitch and business
    pitch_id UUID REFERENCES public.pitches(id) ON DELETE CASCADE,
    business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE CASCADE,
    
    -- Agreement details
    agreement_type VARCHAR(50) NOT NULL CHECK (agreement_type IN ('equity', 'partnership', 'grant', 'loan', 'convertible_note', 'revenue_share')),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Financial terms
    total_amount DECIMAL(15,2),
    currency VARCHAR(10) DEFAULT 'USD',
    equity_percentage DECIMAL(5,2),
    share_price DECIMAL(15,4),
    total_shares INTEGER,
    
    -- Terms and conditions
    terms_text TEXT,
    special_conditions TEXT,
    vesting_schedule JSONB,
    milestones JSONB,
    
    -- Status tracking
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'pending_signatures', 'partially_signed', 'fully_signed', 'active', 'completed', 'cancelled', 'expired')),
    
    -- Owner (pitch creator)
    owner_id UUID REFERENCES auth.users(id),
    owner_signed BOOLEAN DEFAULT FALSE,
    owner_signature_data JSONB,
    owner_signed_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    
    -- QR Code data (generated after all signatures)
    qr_code_data JSONB,
    qr_code_hash VARCHAR(255),
    
    -- Legal
    jurisdiction VARCHAR(100),
    governing_law VARCHAR(100),
    dispute_resolution TEXT
);

-- =============================================
-- AGREEMENT SIGNATORIES TABLE
-- All parties who need to sign
-- =============================================
CREATE TABLE IF NOT EXISTS public.agreement_signatories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agreement_id UUID NOT NULL REFERENCES public.investment_agreements(id) ON DELETE CASCADE,
    
    -- Signatory details
    user_id UUID REFERENCES auth.users(id),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role VARCHAR(50) NOT NULL CHECK (role IN ('investor', 'partner', 'shareholder', 'grantor', 'co_founder', 'witness', 'guarantor')),
    
    -- Investment details for this party
    investment_amount DECIMAL(15,2),
    equity_share DECIMAL(5,2),
    share_count INTEGER,
    
    -- Signature status
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'invited', 'viewed', 'signed', 'declined', 'expired')),
    
    -- Signature data (biometric/secure)
    signature_type VARCHAR(50), -- 'biometric', 'pin', 'password', 'otp'
    signature_data JSONB,
    signature_hash VARCHAR(255),
    signed_at TIMESTAMPTZ,
    
    -- Location at signing
    sign_location JSONB, -- { lat, lng, address, ip }
    device_info JSONB, -- { device, browser, os }
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    verification_method VARCHAR(50),
    verified_at TIMESTAMPTZ,
    
    -- Timestamps
    invited_at TIMESTAMPTZ,
    viewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(agreement_id, email)
);

-- =============================================
-- AGREEMENT TEMPLATES TABLE
-- Pre-defined MOU templates
-- =============================================
CREATE TABLE IF NOT EXISTS public.agreement_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    agreement_type VARCHAR(50) NOT NULL,
    template_text TEXT NOT NULL,
    variables JSONB, -- placeholders like {{investor_name}}, {{amount}}
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- AGREEMENT ACTIVITY LOG
-- Track all actions on agreements
-- =============================================
CREATE TABLE IF NOT EXISTS public.agreement_activity_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agreement_id UUID NOT NULL REFERENCES public.investment_agreements(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    action VARCHAR(100) NOT NULL,
    details JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_agreements_pitch ON public.investment_agreements(pitch_id);
CREATE INDEX IF NOT EXISTS idx_agreements_business ON public.investment_agreements(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_agreements_owner ON public.investment_agreements(owner_id);
CREATE INDEX IF NOT EXISTS idx_agreements_status ON public.investment_agreements(status);
CREATE INDEX IF NOT EXISTS idx_signatories_agreement ON public.agreement_signatories(agreement_id);
CREATE INDEX IF NOT EXISTS idx_signatories_user ON public.agreement_signatories(user_id);
CREATE INDEX IF NOT EXISTS idx_signatories_email ON public.agreement_signatories(email);
CREATE INDEX IF NOT EXISTS idx_activity_agreement ON public.agreement_activity_log(agreement_id);

-- =============================================
-- RLS POLICIES
-- =============================================
ALTER TABLE public.investment_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_signatories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_activity_log ENABLE ROW LEVEL SECURITY;

-- Investment Agreements Policies
DROP POLICY IF EXISTS "Owners can manage their agreements" ON public.investment_agreements;
DROP POLICY IF EXISTS "Signatories can view agreements they're part of" ON public.investment_agreements;
DROP POLICY IF EXISTS "Users can create agreements" ON public.investment_agreements;

CREATE POLICY "Owners can manage their agreements"
    ON public.investment_agreements FOR ALL
    USING (owner_id = auth.uid());

CREATE POLICY "Signatories can view agreements they're part of"
    ON public.investment_agreements FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.agreement_signatories s
            WHERE s.agreement_id = id
            AND (s.user_id = auth.uid() OR s.email = (
                SELECT email FROM public.profiles WHERE id = auth.uid()
            ))
        )
    );

CREATE POLICY "Users can create agreements"
    ON public.investment_agreements FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- Signatories Policies
DROP POLICY IF EXISTS "Users can view signatories of their agreements" ON public.agreement_signatories;
DROP POLICY IF EXISTS "Agreement owners can manage signatories" ON public.agreement_signatories;
DROP POLICY IF EXISTS "Signatories can update their own record" ON public.agreement_signatories;

CREATE POLICY "Users can view signatories of their agreements"
    ON public.agreement_signatories FOR SELECT
    USING (
        user_id = auth.uid()
        OR email = (SELECT email FROM public.profiles WHERE id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.investment_agreements a
            WHERE a.id = agreement_id AND a.owner_id = auth.uid()
        )
    );

CREATE POLICY "Agreement owners can manage signatories"
    ON public.agreement_signatories FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.investment_agreements a
            WHERE a.id = agreement_id AND a.owner_id = auth.uid()
        )
    );

CREATE POLICY "Signatories can update their own record"
    ON public.agreement_signatories FOR UPDATE
    USING (
        user_id = auth.uid()
        OR email = (SELECT email FROM public.profiles WHERE id = auth.uid())
    );

-- Templates Policies (public read)
DROP POLICY IF EXISTS "Anyone can view active templates" ON public.agreement_templates;
CREATE POLICY "Anyone can view active templates"
    ON public.agreement_templates FOR SELECT
    USING (is_active = true);

-- Activity Log Policies
DROP POLICY IF EXISTS "Users can view activity on their agreements" ON public.agreement_activity_log;
CREATE POLICY "Users can view activity on their agreements"
    ON public.agreement_activity_log FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.investment_agreements a
            WHERE a.id = agreement_id 
            AND (a.owner_id = auth.uid() OR EXISTS (
                SELECT 1 FROM public.agreement_signatories s
                WHERE s.agreement_id = a.id AND s.user_id = auth.uid()
            ))
        )
    );

-- =============================================
-- INSERT DEFAULT TEMPLATES
-- =============================================
INSERT INTO public.agreement_templates (name, agreement_type, template_text, variables, is_default) VALUES
(
    'Standard Equity Investment MOU',
    'equity',
    E'MEMORANDUM OF UNDERSTANDING\n\nThis Memorandum of Understanding ("MOU") is entered into as of {{date}} by and between:\n\n1. COMPANY: {{business_name}} ("Company")\n   Address: {{business_address}}\n   Represented by: {{owner_name}}\n\n2. INVESTOR: {{investor_name}} ("Investor")\n   Email: {{investor_email}}\n\nWHEREAS, the Company is seeking investment to {{pitch_description}};\n\nWHEREAS, the Investor wishes to invest in the Company;\n\nNOW, THEREFORE, the parties agree as follows:\n\n1. INVESTMENT\n   The Investor agrees to invest {{investment_amount}} {{currency}} in exchange for {{equity_percentage}}% equity in the Company.\n\n2. USE OF FUNDS\n   The investment shall be used for: {{use_of_funds}}\n\n3. REPRESENTATIONS\n   The Company represents that all information provided in the pitch is accurate and complete.\n\n4. CONFIDENTIALITY\n   Both parties agree to keep the terms of this agreement confidential.\n\n5. GOVERNING LAW\n   This MOU shall be governed by the laws of {{jurisdiction}}.\n\nSIGNATURES:\n\n___________________________\n{{owner_name}} (Company)\nDate: {{owner_sign_date}}\n\n___________________________\n{{investor_name}} (Investor)\nDate: {{investor_sign_date}}',
    '["date", "business_name", "business_address", "owner_name", "investor_name", "investor_email", "pitch_description", "investment_amount", "currency", "equity_percentage", "use_of_funds", "jurisdiction", "owner_sign_date", "investor_sign_date"]',
    true
),
(
    'Partnership Agreement',
    'partnership',
    E'PARTNERSHIP AGREEMENT\n\nThis Partnership Agreement is made on {{date}} between:\n\n1. {{owner_name}} ("First Partner")\n2. {{partner_name}} ("Second Partner")\n\nFor the purpose of: {{business_name}} - {{pitch_description}}\n\n1. PARTNERSHIP CONTRIBUTIONS\n   First Partner: {{owner_contribution}}\n   Second Partner: {{partner_contribution}}\n\n2. PROFIT/LOSS SHARING\n   First Partner: {{owner_share}}%\n   Second Partner: {{partner_share}}%\n\n3. MANAGEMENT\n   {{management_terms}}\n\n4. DURATION\n   This partnership shall commence on {{start_date}} and continue until terminated.\n\n5. TERMINATION\n   Either party may terminate with {{notice_period}} days written notice.\n\nSIGNED:\n\n___________________________\n{{owner_name}}\n\n___________________________\n{{partner_name}}',
    '["date", "owner_name", "partner_name", "business_name", "pitch_description", "owner_contribution", "partner_contribution", "owner_share", "partner_share", "management_terms", "start_date", "notice_period"]',
    true
),
(
    'Grant Agreement',
    'grant',
    E'GRANT AGREEMENT\n\nGrant Reference: {{grant_reference}}\nDate: {{date}}\n\nBETWEEN:\nGrantor: {{grantor_name}}\nGrantee: {{business_name}}\n\n1. GRANT AMOUNT: {{grant_amount}} {{currency}}\n\n2. PURPOSE: {{grant_purpose}}\n\n3. CONDITIONS:\n   {{grant_conditions}}\n\n4. REPORTING REQUIREMENTS:\n   {{reporting_requirements}}\n\n5. DURATION: {{grant_duration}}\n\nACCEPTED:\n\n___________________________\n{{grantor_name}} (Grantor)\n\n___________________________\n{{owner_name}} (Grantee)',
    '["grant_reference", "date", "grantor_name", "business_name", "grant_amount", "currency", "grant_purpose", "grant_conditions", "reporting_requirements", "grant_duration", "owner_name"]',
    true
)
ON CONFLICT DO NOTHING;

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to generate agreement hash for QR code
CREATE OR REPLACE FUNCTION public.generate_agreement_hash(agreement_id UUID)
RETURNS TEXT AS $$
DECLARE
    hash_input TEXT;
    result_hash TEXT;
BEGIN
    SELECT 
        a.id::TEXT || 
        a.created_at::TEXT || 
        COALESCE(a.owner_id::TEXT, '') ||
        STRING_AGG(s.signature_hash, '|' ORDER BY s.signed_at)
    INTO hash_input
    FROM public.investment_agreements a
    LEFT JOIN public.agreement_signatories s ON s.agreement_id = a.id AND s.status = 'signed'
    WHERE a.id = agreement_id
    GROUP BY a.id, a.created_at, a.owner_id;
    
    result_hash := encode(sha256(hash_input::bytea), 'hex');
    RETURN result_hash;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if agreement is fully signed
CREATE OR REPLACE FUNCTION public.check_agreement_fully_signed()
RETURNS TRIGGER AS $$
DECLARE
    unsigned_count INTEGER;
    agreement_record RECORD;
BEGIN
    -- Count unsigned signatories
    SELECT COUNT(*) INTO unsigned_count
    FROM public.agreement_signatories
    WHERE agreement_id = NEW.agreement_id
    AND status != 'signed';
    
    -- If all signed, update agreement status
    IF unsigned_count = 0 THEN
        -- Get agreement details for QR code
        SELECT * INTO agreement_record 
        FROM public.investment_agreements 
        WHERE id = NEW.agreement_id;
        
        IF agreement_record.owner_signed THEN
            UPDATE public.investment_agreements
            SET 
                status = 'fully_signed',
                qr_code_hash = public.generate_agreement_hash(NEW.agreement_id),
                updated_at = NOW()
            WHERE id = NEW.agreement_id;
        ELSE
            UPDATE public.investment_agreements
            SET status = 'partially_signed', updated_at = NOW()
            WHERE id = NEW.agreement_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for auto-updating agreement status
DROP TRIGGER IF EXISTS trigger_check_signatures ON public.agreement_signatories;
CREATE TRIGGER trigger_check_signatures
    AFTER UPDATE OF status ON public.agreement_signatories
    FOR EACH ROW
    WHEN (NEW.status = 'signed')
    EXECUTE FUNCTION public.check_agreement_fully_signed();

-- =============================================
-- VERIFY SETUP
-- =============================================
SELECT 'Investment Agreements Schema Created!' as status;
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%agreement%';
