-- =============================================
-- MTN MOMO CONFIGURATION TABLE
-- Stores API credentials and settings
-- =============================================

CREATE TABLE IF NOT EXISTS public.mtn_momo_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Configuration Name
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- MTN MOMO Credentials
    subscription_key VARCHAR(255) NOT NULL,
    api_user_id VARCHAR(255) NOT NULL,
    api_secret_key VARCHAR(255) NOT NULL,
    
    -- Environment
    environment VARCHAR(50) NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
    base_url VARCHAR(500) NOT NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_primary BOOLEAN DEFAULT false,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(subscription_key),
    UNIQUE(api_user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_mtn_config_active ON public.mtn_momo_config(is_active);
CREATE INDEX IF NOT EXISTS idx_mtn_config_primary ON public.mtn_momo_config(is_primary);
CREATE INDEX IF NOT EXISTS idx_mtn_config_environment ON public.mtn_momo_config(environment);

-- =============================================
-- MTN MOMO TRANSACTION LOGS
-- Detailed logs of all MOMO API calls
-- =============================================

CREATE TABLE IF NOT EXISTS public.mtn_momo_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Transaction Reference
    transaction_id VARCHAR(255) NOT NULL,
    reference_id VARCHAR(255),
    
    -- Request Details
    product_type VARCHAR(50) NOT NULL CHECK (product_type IN ('collection', 'disbursement')),
    endpoint VARCHAR(500),
    request_method VARCHAR(10) DEFAULT 'POST',
    
    -- Payload
    request_payload JSONB,
    response_payload JSONB,
    
    -- Status
    http_status_code INTEGER,
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'error')),
    error_message TEXT,
    
    -- User Info
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    phone_number VARCHAR(20),
    amount DECIMAL(15,2),
    currency VARCHAR(10),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Index for performance
    UNIQUE(transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_momo_logs_user_id ON public.mtn_momo_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_momo_logs_status ON public.mtn_momo_logs(status);
CREATE INDEX IF NOT EXISTS idx_momo_logs_product_type ON public.mtn_momo_logs(product_type);
CREATE INDEX IF NOT EXISTS idx_momo_logs_created_at ON public.mtn_momo_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_momo_logs_reference_id ON public.mtn_momo_logs(reference_id);

-- =============================================
-- MOMO ACCESS TOKEN CACHE
-- Cache tokens to avoid repeated authentication
-- =============================================

CREATE TABLE IF NOT EXISTS public.mtn_momo_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Configuration Reference
    config_id UUID NOT NULL REFERENCES public.mtn_momo_config(id) ON DELETE CASCADE,
    
    -- Token Details
    product_type VARCHAR(50) NOT NULL CHECK (product_type IN ('collection', 'disbursement')),
    access_token VARCHAR(2000) NOT NULL,
    token_type VARCHAR(50) DEFAULT 'Bearer',
    
    -- Expiry
    expires_at TIMESTAMPTZ NOT NULL,
    
    -- Status
    is_valid BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(config_id, product_type)
);

CREATE INDEX IF NOT EXISTS idx_momo_tokens_config ON public.mtn_momo_tokens(config_id);
CREATE INDEX IF NOT EXISTS idx_momo_tokens_product_type ON public.mtn_momo_tokens(product_type);
CREATE INDEX IF NOT EXISTS idx_momo_tokens_expires ON public.mtn_momo_tokens(expires_at);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Config table: Only admins can view
ALTER TABLE public.mtn_momo_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage MOMO config" ON public.mtn_momo_config;
CREATE POLICY "Service role can manage MOMO config" ON public.mtn_momo_config
  USING (auth.role() = 'service_role');

-- Logs table: Users can view their own logs, admins see all
ALTER TABLE public.mtn_momo_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own MOMO logs" ON public.mtn_momo_logs;
CREATE POLICY "Users can view own MOMO logs" ON public.mtn_momo_logs
  FOR SELECT USING (auth.uid() = user_id OR auth.role() = 'service_role');

-- Token table: Only service role
ALTER TABLE public.mtn_momo_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages tokens" ON public.mtn_momo_tokens;
CREATE POLICY "Service role manages tokens" ON public.mtn_momo_tokens
  USING (auth.role() = 'service_role');

-- =============================================
-- INSERT DEFAULT CREDENTIALS
-- ⚠️  IMPORTANT INSTRUCTIONS:
-- 
-- New Credentials (Updated):
-- Primary key (subscription_key): 8b59afc46b7a43b0a32856e709af1de3
-- Secondary key (api_secret_key): 7bd511260f764defa2bde723ad81939b
-- Collection Widget: Receive mobile money payments on your website through a USSD or QR code
-- =============================================

-- Primary Configuration (Insert or Update)
INSERT INTO public.mtn_momo_config (
    name,
    description,
    subscription_key,
    api_user_id,
    api_secret_key,
    environment,
    base_url,
    is_active,
    is_primary
) VALUES (
    'MTN MOMO Primary - ICAN Collection',
    'Primary MTN MOMO Collection Widget credential set - Receive mobile money payments on your website through a USSD or QR code',
    '8b59afc46b7a43b0a32856e709af1de3',      -- PRIMARY SUBSCRIPTION KEY (UPDATED)
    'ican-momo-' || gen_random_uuid()::text, -- UNIQUE API USER ID (Dynamic UUID)
    '7bd511260f764defa2bde723ad81939b',      -- SECONDARY API SECRET KEY (UPDATED)
    'sandbox',                                -- ENVIRONMENT
    'https://sandbox.momodeveloper.mtn.com', -- BASE URL
    true,                                     -- IS ACTIVE
    true                                      -- IS PRIMARY
) ON CONFLICT (subscription_key) DO UPDATE SET
    name = 'MTN MOMO Primary - ICAN Collection',
    description = 'Primary MTN MOMO Collection Widget credential set - Receive mobile money payments on your website through a USSD or QR code',
    api_secret_key = '7bd511260f764defa2bde723ad81939b',
    is_active = true,
    is_primary = true,
    updated_at = NOW();

-- =============================================
-- VERIFY INSERTED CONFIGURATION
-- =============================================

-- View the inserted configuration
-- SELECT id, name, subscription_key, api_user_id, api_secret_key, environment, base_url, is_active, is_primary
-- FROM public.mtn_momo_config 
-- WHERE is_primary = true;

-- =============================================
-- FUNCTIONS
-- =============================================

-- Function to get active MOMO config
CREATE OR REPLACE FUNCTION get_active_momo_config(p_environment VARCHAR DEFAULT 'sandbox')
RETURNS TABLE (
    id UUID,
    name VARCHAR,
    subscription_key VARCHAR,
    api_user_id VARCHAR,
    api_secret_key VARCHAR,
    base_url VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mtn_momo_config.id,
        mtn_momo_config.name,
        mtn_momo_config.subscription_key,
        mtn_momo_config.api_user_id,
        mtn_momo_config.api_secret_key,
        mtn_momo_config.base_url
    FROM public.mtn_momo_config
    WHERE is_active = true
        AND environment = p_environment
        AND is_primary = true
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to log MOMO transaction
CREATE OR REPLACE FUNCTION log_momo_transaction(
    p_transaction_id VARCHAR,
    p_reference_id VARCHAR,
    p_product_type VARCHAR,
    p_endpoint VARCHAR,
    p_request_payload JSONB,
    p_response_payload JSONB,
    p_http_status INTEGER,
    p_status VARCHAR,
    p_error_message TEXT,
    p_user_id UUID,
    p_phone_number VARCHAR,
    p_amount DECIMAL,
    p_currency VARCHAR
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO public.mtn_momo_logs (
        transaction_id,
        reference_id,
        product_type,
        endpoint,
        request_payload,
        response_payload,
        http_status_code,
        status,
        error_message,
        user_id,
        phone_number,
        amount,
        currency
    ) VALUES (
        p_transaction_id,
        p_reference_id,
        p_product_type,
        p_endpoint,
        p_request_payload,
        p_response_payload,
        p_http_status,
        p_status,
        p_error_message,
        p_user_id,
        p_phone_number,
        p_amount,
        p_currency
    ) RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- VIEWS
-- =============================================

-- View recent MOMO transactions
CREATE OR REPLACE VIEW public.recent_momo_transactions AS
SELECT 
    id,
    transaction_id,
    reference_id,
    product_type,
    status,
    http_status_code,
    amount,
    currency,
    phone_number,
    user_id,
    created_at,
    CASE 
        WHEN status = 'success' THEN '✅'
        WHEN status = 'failed' THEN '❌'
        WHEN status = 'pending' THEN '⏳'
        WHEN status = 'error' THEN '⚠️'
    END as status_icon
FROM public.mtn_momo_logs
ORDER BY created_at DESC
LIMIT 100;

-- View transaction statistics
CREATE OR REPLACE VIEW public.momo_transaction_stats AS
SELECT 
    DATE(created_at) as transaction_date,
    product_type,
    status,
    COUNT(*) as count,
    SUM(amount) as total_amount,
    AVG(amount) as avg_amount
FROM public.mtn_momo_logs
WHERE user_id IS NOT NULL
GROUP BY DATE(created_at), product_type, status
ORDER BY transaction_date DESC, product_type;

-- =============================================
-- SAMPLE QUERIES
-- =============================================

-- Get active MOMO configuration
-- SELECT * FROM get_active_momo_config('sandbox');

-- Get recent transactions for a user
-- SELECT * FROM public.mtn_momo_logs
-- WHERE user_id = 'user-uuid'
-- ORDER BY created_at DESC
-- LIMIT 20;

-- Get transaction by reference ID
-- SELECT * FROM public.mtn_momo_logs
-- WHERE reference_id = 'REC-1234567890';

-- Get today's transaction statistics
-- SELECT * FROM public.momo_transaction_stats
-- WHERE transaction_date = CURRENT_DATE;
