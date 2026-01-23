-- =============================================
-- BUSINESS PROFILE TABLES
-- Pitchin Platform - Business Account Management
-- For legitimate account creation and co-ownership
-- =============================================

-- =============================================
-- BUSINESS PROFILES TABLE
-- Main business entity information
-- =============================================
CREATE TABLE IF NOT EXISTS public.business_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Business Information
    business_name VARCHAR(255) NOT NULL,
    business_type VARCHAR(100) NOT NULL, -- 'LLC', 'Corporation', 'Partnership', 'Sole Proprietorship', 'Non-profit'
    registration_number VARCHAR(255),
    tax_id VARCHAR(255),
    business_address TEXT,
    website VARCHAR(255),
    description TEXT,
    founded_year INTEGER,
    total_capital DECIMAL(15, 2),
    
    -- Status
    status VARCHAR(50) DEFAULT 'active', -- 'active', 'inactive', 'suspended', 'verified'
    verification_status VARCHAR(50) DEFAULT 'unverified', -- 'unverified', 'pending', 'verified', 'rejected'
    
    -- Blockchain
    blockchain_contract_address VARCHAR(255),
    blockchain_network TEXT DEFAULT 'ethereum',
    blockchain_deployed BOOLEAN DEFAULT FALSE,
    blockchain_smart_contract_id UUID,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    verified_at TIMESTAMP WITH TIME ZONE
);

-- Drop old unique constraint and index if they exist
ALTER TABLE public.business_profiles DROP CONSTRAINT IF EXISTS unique_tax_id;
DROP INDEX IF EXISTS public.idx_unique_tax_id;

-- Enable RLS
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean state
DROP POLICY IF EXISTS "Users can view their own business profiles" ON public.business_profiles;
DROP POLICY IF EXISTS "Users can create business profiles" ON public.business_profiles;
DROP POLICY IF EXISTS "Users can update their own profiles" ON public.business_profiles;

-- RLS Policies
CREATE POLICY "Users can view their own business profiles" 
    ON public.business_profiles FOR SELECT 
    USING (auth.uid() = user_id OR status = 'verified');

CREATE POLICY "Users can create business profiles" 
    ON public.business_profiles FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profiles" 
    ON public.business_profiles FOR UPDATE 
    USING (auth.uid() = user_id);

-- =============================================
-- CO-OWNERS TABLE
-- Business co-owners and ownership structure
-- =============================================
CREATE TABLE IF NOT EXISTS public.business_co_owners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
    
    -- Owner Information
    owner_name VARCHAR(255) NOT NULL,
    owner_email VARCHAR(255) NOT NULL,
    owner_phone VARCHAR(20),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    
    -- Ownership Details
    ownership_share DECIMAL(5, 2) NOT NULL, -- 0-100%
    role VARCHAR(100) NOT NULL, -- 'Founder', 'Co-Founder', 'CTO', 'CFO', 'CEO', 'Partner', 'Investor'
    
    -- Status & Verification
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'active', 'inactive', 'removed'
    verification_status VARCHAR(50) DEFAULT 'unverified', -- 'unverified', 'pending', 'verified', 'rejected'
    invitation_sent BOOLEAN DEFAULT FALSE,
    invitation_accepted BOOLEAN DEFAULT FALSE,
    
    -- Blockchain
    wallet_address VARCHAR(255),
    blockchain_verified BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    verified_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for business_co_owners table
CREATE INDEX IF NOT EXISTS idx_co_owners_business_profile_id ON public.business_co_owners(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_co_owners_user_id ON public.business_co_owners(user_id);
CREATE INDEX IF NOT EXISTS idx_co_owners_owner_email ON public.business_co_owners(owner_email);

-- Enable RLS
ALTER TABLE public.business_co_owners ENABLE ROW LEVEL SECURITY;

-- Drop existing co-owner policies to ensure clean state
DROP POLICY IF EXISTS "Co-owners visible to profile members" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can add co-owners to their profiles" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can update co-owners of their profiles" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can delete co-owners from their profiles" ON public.business_co_owners;
DROP POLICY IF EXISTS "Co-owners can view co-owner records" ON public.business_co_owners;
DROP POLICY IF EXISTS "Authenticated users can add co-owners" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can update co-owners" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can delete co-owners" ON public.business_co_owners;

-- RLS Policies for Co-Owners
-- Simplified to avoid recursive policy checks

-- SELECT policy - Users can see co-owners they're listed as
CREATE POLICY "Co-owners can view co-owner records" 
    ON public.business_co_owners FOR SELECT 
    USING (
        auth.uid() = user_id 
        OR owner_email = auth.jwt()->>'email'
    );

-- INSERT policy - Allow authenticated users to add co-owners
-- Allow if user owns the business profile
CREATE POLICY "Authenticated users can add co-owners"
    ON public.business_co_owners FOR INSERT
    WITH CHECK (
        auth.uid() IS NOT NULL 
        AND EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = business_profile_id
            AND bp.user_id = auth.uid()
        )
    );

-- UPDATE policy - Users can update co-owners
CREATE POLICY "Users can update co-owners"
    ON public.business_co_owners FOR UPDATE
    USING (
        auth.uid() = user_id 
        OR owner_email = auth.jwt()->>'email'
    )
    WITH CHECK (auth.uid() IS NOT NULL);

-- DELETE policy - Users can remove co-owners
CREATE POLICY "Users can delete co-owners"
    ON public.business_co_owners FOR DELETE
    USING (
        auth.uid() = user_id 
        OR owner_email = auth.jwt()->>'email'
    );

-- =============================================
-- PITCHES TABLE
-- Pitch information linked to business profiles
-- =============================================
CREATE TABLE IF NOT EXISTS public.pitches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
    
    -- Pitch Details
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    pitch_type VARCHAR(100), -- 'Equity', 'Debt', 'Partnership', 'Grant'
    
    -- Funding
    target_funding DECIMAL(15, 2),
    raised_amount DECIMAL(15, 2) DEFAULT 0,
    equity_offering DECIMAL(5, 2),
    
    -- Video
    video_url TEXT,
    video_duration_seconds INTEGER,
    thumbnail_url TEXT,
    
    -- Intellectual Property
    has_ip BOOLEAN DEFAULT FALSE,
    ip_details TEXT,
    
    -- Status & Visibility
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'published', 'active', 'closed', 'funded'
    visibility VARCHAR(50) DEFAULT 'public', -- 'public', 'private', 'investor_only'
    
    -- Engagement
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    shares_count INTEGER DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    
    -- Blockchain
    blockchain_pitch_id UUID,
    blockchain_ipfs_hash VARCHAR(255),
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    published_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for pitches table
CREATE INDEX IF NOT EXISTS idx_pitches_business_profile_id ON public.pitches(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_pitches_status ON public.pitches(status);
CREATE INDEX IF NOT EXISTS idx_pitches_created_at ON public.pitches(created_at);

-- Enable RLS
ALTER TABLE public.pitches ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean state
DROP POLICY IF EXISTS "Anyone can view published pitches" ON public.pitches;
DROP POLICY IF EXISTS "Profile owners can view their own pitches" ON public.pitches;

-- RLS Policies
CREATE POLICY "Anyone can view published pitches" 
    ON public.pitches FOR SELECT 
    USING (status = 'published' OR status = 'active');

CREATE POLICY "Profile owners can view their own pitches" 
    ON public.pitches FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = pitches.business_profile_id
            AND bp.user_id = auth.uid()
        )
    );

-- =============================================
-- SMART CONTRACTS TABLE
-- Share purchase agreements and MOUs
-- =============================================
CREATE TABLE IF NOT EXISTS public.smart_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pitch_id UUID NOT NULL REFERENCES public.pitches(id) ON DELETE CASCADE,
    
    -- Contract Details
    contract_type VARCHAR(100), -- 'MOU', 'Share Purchase', 'Partnership', 'Grant'
    contract_title VARCHAR(255),
    contract_description TEXT,
    
    -- Parties
    seller_profile_id UUID NOT NULL REFERENCES public.business_profiles(id),
    buyer_id UUID REFERENCES public.profiles(id),
    buyer_business_profile_id UUID REFERENCES public.business_profiles(id),
    
    -- Share Purchase Details
    shares_offered DECIMAL(10, 2),
    shares_purchased DECIMAL(10, 2),
    total_investment DECIMAL(15, 2),
    share_price DECIMAL(15, 8),
    
    -- Contract Status
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'pending_approval', 'active', 'signed', 'completed', 'cancelled'
    approval_threshold DECIMAL(5, 2) DEFAULT 60, -- 60% signature requirement
    
    -- Document
    mou_content TEXT,
    mou_hash VARCHAR(255),
    mou_ipfs_hash VARCHAR(255),
    
    -- Blockchain
    blockchain_contract_address VARCHAR(255),
    blockchain_network TEXT DEFAULT 'ethereum',
    blockchain_deployed BOOLEAN DEFAULT FALSE,
    blockchain_transaction_hash VARCHAR(255),
    blockchain_block_number BIGINT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    signed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for smart_contracts table
CREATE INDEX IF NOT EXISTS idx_smart_contracts_pitch_id ON public.smart_contracts(pitch_id);
CREATE INDEX IF NOT EXISTS idx_smart_contracts_seller_profile_id ON public.smart_contracts(seller_profile_id);
CREATE INDEX IF NOT EXISTS idx_smart_contracts_buyer_id ON public.smart_contracts(buyer_id);
CREATE INDEX IF NOT EXISTS idx_smart_contracts_status ON public.smart_contracts(status);

-- Enable RLS
ALTER TABLE public.smart_contracts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean state
DROP POLICY IF EXISTS "Parties can view their contracts" ON public.smart_contracts;

-- RLS Policies
CREATE POLICY "Parties can view their contracts" 
    ON public.smart_contracts FOR SELECT 
    USING (
        auth.uid() IN (
            SELECT user_id FROM public.business_profiles WHERE id = seller_profile_id
            UNION
            SELECT buyer_id FROM public.smart_contracts sc WHERE sc.id = smart_contracts.id
        )
    );

-- =============================================
-- DIGITAL SIGNATURES TABLE
-- Track all digital signatures on contracts
-- =============================================
CREATE TABLE IF NOT EXISTS public.digital_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    smart_contract_id UUID NOT NULL REFERENCES public.smart_contracts(id) ON DELETE CASCADE,
    signer_id UUID NOT NULL REFERENCES public.profiles(id),
    signer_business_id UUID REFERENCES public.business_profiles(id),
    
    -- Signature Details
    signer_name VARCHAR(255) NOT NULL,
    signer_email VARCHAR(255) NOT NULL,
    signer_role VARCHAR(100),
    
    -- Authentication Method
    auth_method VARCHAR(50), -- 'pin', 'fingerprint', 'signature', 'email'
    auth_verified BOOLEAN DEFAULT FALSE,
    pin_hash VARCHAR(255),
    
    -- Location & Timestamp
    signature_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    signature_location_latitude DECIMAL(10, 8),
    signature_location_longitude DECIMAL(11, 8),
    signature_location_name VARCHAR(255),
    device_info VARCHAR(255),
    ip_address VARCHAR(45),
    
    -- QR Code & Verification
    qr_code_hash VARCHAR(255),
    qr_code_data TEXT,
    verification_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'verified', 'rejected'
    
    -- Blockchain
    blockchain_signature_id UUID,
    blockchain_verified BOOLEAN DEFAULT FALSE,
    blockchain_block_number BIGINT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    verified_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for digital_signatures table
CREATE INDEX IF NOT EXISTS idx_digital_signatures_smart_contract_id ON public.digital_signatures(smart_contract_id);
CREATE INDEX IF NOT EXISTS idx_digital_signatures_signer_id ON public.digital_signatures(signer_id);
CREATE INDEX IF NOT EXISTS idx_digital_signatures_signature_timestamp ON public.digital_signatures(signature_timestamp);

-- Enable RLS
ALTER TABLE public.digital_signatures ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean state
DROP POLICY IF EXISTS "Signers can view their own signatures" ON public.digital_signatures;

-- RLS Policies
CREATE POLICY "Signers can view their own signatures" 
    ON public.digital_signatures FOR SELECT 
    USING (auth.uid() = signer_id);

-- =============================================
-- BLOCKCHAIN RECORDS TABLE
-- Track all blockchain interactions
-- =============================================
CREATE TABLE IF NOT EXISTS public.blockchain_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Reference
    entity_type VARCHAR(100), -- 'business_profile', 'smart_contract', 'signature', 'transaction'
    entity_id UUID NOT NULL,
    
    -- Blockchain Details
    blockchain_network TEXT NOT NULL, -- 'ethereum', 'polygon', 'solana', etc.
    blockchain_address VARCHAR(255),
    contract_address VARCHAR(255),
    transaction_hash VARCHAR(255) UNIQUE,
    block_number BIGINT,
    gas_used DECIMAL(18, 8),
    gas_price DECIMAL(18, 8),
    
    -- Operation
    operation_type VARCHAR(100), -- 'deploy', 'sign', 'verify', 'transfer'
    operation_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'confirmed', 'failed'
    
    -- Smart Contract Data
    smart_contract_abi JSONB,
    smart_contract_bytecode TEXT,
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    verification_timestamp TIMESTAMP WITH TIME ZONE,
    verification_data JSONB DEFAULT '{}',
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    confirmed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for blockchain_records table
CREATE INDEX IF NOT EXISTS idx_blockchain_records_entity_type_id ON public.blockchain_records(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_records_transaction_hash ON public.blockchain_records(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_blockchain_records_blockchain_network ON public.blockchain_records(blockchain_network);
CREATE INDEX IF NOT EXISTS idx_blockchain_records_operation_status ON public.blockchain_records(operation_status);

-- =============================================
-- QR CODE VERIFICATION TABLE
-- Store QR codes for signatures
-- =============================================
CREATE TABLE IF NOT EXISTS public.qr_code_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    digital_signature_id UUID NOT NULL REFERENCES public.digital_signatures(id) ON DELETE CASCADE,
    
    -- QR Code Data
    qr_code_string VARCHAR(255) UNIQUE NOT NULL,
    qr_code_image_url TEXT,
    qr_code_generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Verification
    verified_count INTEGER DEFAULT 0,
    last_verified_at TIMESTAMP WITH TIME ZONE,
    verification_ips VARCHAR(255)[], -- Array of IPs that verified
    
    -- Blockchain
    blockchain_qr_hash VARCHAR(255),
    blockchain_verified BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for qr_code_verifications table
CREATE INDEX IF NOT EXISTS idx_qr_code_verifications_digital_signature_id ON public.qr_code_verifications(digital_signature_id);
CREATE INDEX IF NOT EXISTS idx_qr_code_verifications_qr_code_string ON public.qr_code_verifications(qr_code_string);

-- =============================================
-- NOTIFICATIONS TABLE
-- Track signature notifications
-- =============================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Notification Details
    notification_type VARCHAR(100), -- 'signature', 'contract', 'pitch', 'investment'
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    action_url TEXT,
    
    -- Related Entities
    smart_contract_id UUID REFERENCES public.smart_contracts(id),
    digital_signature_id UUID REFERENCES public.digital_signatures(id),
    pitch_id UUID REFERENCES public.pitches(id),
    
    -- Status
    status VARCHAR(50) DEFAULT 'unread', -- 'unread', 'read', 'archived'
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean state
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;

-- RLS Policies
CREATE POLICY "Users can view their own notifications" 
    ON public.notifications FOR SELECT 
    USING (auth.uid() = recipient_id);

-- =============================================
-- SHARE TRANSACTIONS TABLE
-- Track share purchases and transfers
-- =============================================
CREATE TABLE IF NOT EXISTS public.share_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    smart_contract_id UUID NOT NULL REFERENCES public.smart_contracts(id),
    
    -- Transaction Details
    transaction_type VARCHAR(50), -- 'purchase', 'transfer', 'dividend'
    buyer_id UUID NOT NULL REFERENCES public.profiles(id),
    seller_id UUID REFERENCES public.profiles(id),
    
    -- Share Details
    shares_amount DECIMAL(10, 2) NOT NULL,
    price_per_share DECIMAL(15, 8) NOT NULL,
    total_amount DECIMAL(15, 2) NOT NULL,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'cancelled'
    
    -- Blockchain
    blockchain_transaction_hash VARCHAR(255) UNIQUE,
    blockchain_network TEXT DEFAULT 'ethereum',
    blockchain_block_number BIGINT,
    
    -- Payment
    payment_method VARCHAR(100), -- 'credit_card', 'bank_transfer', 'crypto'
    payment_proof TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.share_transactions ENABLE ROW LEVEL SECURITY;

-- =============================================
-- CREATE INDEXES FOR PERFORMANCE
-- =============================================
CREATE INDEX IF NOT EXISTS idx_business_profiles_user ON public.business_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_business_profiles_status ON public.business_profiles(status);
-- Indexes already created after table definitions:
-- idx_co_owners_business_profile_id, idx_co_owners_user_id, idx_co_owners_owner_email
-- idx_pitches_business_profile_id, idx_pitches_status, idx_pitches_created_at
-- idx_smart_contracts_pitch_id, idx_smart_contracts_seller_profile_id, idx_smart_contracts_buyer_id, idx_smart_contracts_status
-- idx_digital_signatures_smart_contract_id, idx_digital_signatures_signer_id, idx_digital_signatures_signature_timestamp
-- idx_blockchain_records_entity_type_id, idx_blockchain_records_transaction_hash, idx_blockchain_records_blockchain_network, idx_blockchain_records_operation_status
-- idx_qr_code_verifications_digital_signature_id, idx_qr_code_verifications_qr_code_string
-- Notifications and share_transactions indexes added below:
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON public.notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_share_transactions_smart_contract_id ON public.share_transactions(smart_contract_id);
CREATE INDEX IF NOT EXISTS idx_share_transactions_buyer_id ON public.share_transactions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_share_transactions_status ON public.share_transactions(status);

-- =============================================
-- ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- =============================================
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_co_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blockchain_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_code_verifications ENABLE ROW LEVEL SECURITY;

-- =============================================
-- GRANT PERMISSIONS
-- =============================================
GRANT SELECT, INSERT, UPDATE ON public.business_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.business_co_owners TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pitches TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.smart_contracts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.digital_signatures TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.blockchain_records TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.share_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.qr_code_verifications TO authenticated;

-- =============================================
-- BLOCKCHAIN INTEGRATION TRIGGERS
-- =============================================

-- Drop existing triggers and functions to ensure clean state
DROP TRIGGER IF EXISTS trigger_record_signature_blockchain ON public.digital_signatures;
DROP FUNCTION IF EXISTS public.record_signature_blockchain();

DROP TRIGGER IF EXISTS trigger_business_profiles_timestamp ON public.business_profiles;
DROP TRIGGER IF EXISTS trigger_smart_contracts_timestamp ON public.smart_contracts;
DROP FUNCTION IF EXISTS public.update_timestamp();

-- Auto-update blockchain_records when signatures are created
CREATE OR REPLACE FUNCTION public.record_signature_blockchain()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.blockchain_records (
        entity_type,
        entity_id,
        blockchain_network,
        operation_type,
        operation_status,
        metadata,
        created_at
    ) VALUES (
        'signature',
        NEW.id,
        'ethereum',
        'sign',
        'pending',
        jsonb_build_object(
            'signer', NEW.signer_name,
            'timestamp', NEW.signature_timestamp,
            'location', jsonb_build_object(
                'latitude', NEW.signature_location_latitude,
                'longitude', NEW.signature_location_longitude
            )
        ),
        NOW()
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_record_signature_blockchain
AFTER INSERT ON public.digital_signatures
FOR EACH ROW
EXECUTE FUNCTION public.record_signature_blockchain();

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION public.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_business_profiles_timestamp
BEFORE UPDATE ON public.business_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_timestamp();

CREATE TRIGGER trigger_smart_contracts_timestamp
BEFORE UPDATE ON public.smart_contracts
FOR EACH ROW
EXECUTE FUNCTION public.update_timestamp();

-- =============================================
-- TABLE CREATION COMPLETE
-- Ready for blockchain integration
-- =============================================
