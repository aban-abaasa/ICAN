-- =============================================
-- ICAN CAPITAL ENGINE - FINANCIAL TABLES
-- Privacy-First Design with Blockchain Integration
-- All sensitive data is encrypted at rest
-- =============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 🔐 ENCRYPTION KEY MANAGEMENT
-- Store user encryption keys (encrypted with master key)
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_encryption_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    
    -- Encrypted key (encrypted with Supabase vault or master key)
    encrypted_key_hash TEXT NOT NULL,
    key_version INTEGER DEFAULT 1,
    algorithm TEXT DEFAULT 'AES-256-GCM',
    
    -- Key rotation
    rotated_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Blockchain backup of key hash
    blockchain_key_hash TEXT,
    blockchain_verified BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.ican_encryption_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own encryption keys"
    ON public.ican_encryption_keys FOR ALL
    USING (auth.uid() = user_id);

-- =============================================
-- 💰 FINANCIAL TRANSACTIONS (Privacy-Enhanced)
-- Core transaction storage with encryption
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_financial_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Transaction Type: 'income', 'expense', 'loan', 'transfer', 'tithe', 'investment'
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense', 'loan', 'transfer', 'tithe', 'investment', 'loan_payment')),
    
    -- Amount (stored as encrypted for sensitive transactions)
    amount DECIMAL(18, 4) NOT NULL,
    amount_encrypted TEXT, -- Optional: encrypted amount for extra privacy
    currency TEXT DEFAULT 'UGX',
    
    -- Category & Classification
    category TEXT NOT NULL,
    sub_category TEXT,
    
    -- Description (can be encrypted)
    description TEXT,
    description_encrypted TEXT,
    is_sensitive BOOLEAN DEFAULT FALSE,
    
    -- Source tracking
    source TEXT, -- 'manual', 'voice', 'import', 'recurring', 'ai_detected'
    source_reference TEXT, -- external reference ID
    
    -- Date/Time
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    transaction_time TIME,
    
    -- Status
    status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled', 'failed', 'recurring')),
    
    -- Recurring transaction support
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_pattern TEXT, -- 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'
    recurrence_end_date DATE,
    parent_transaction_id UUID REFERENCES public.ican_financial_transactions(id),
    
    -- Location (optional, encrypted for privacy)
    location_encrypted TEXT,
    
    -- Tags for custom categorization
    tags TEXT[] DEFAULT '{}',
    
    -- AI/NLP metadata
    ai_categorized BOOLEAN DEFAULT FALSE,
    ai_confidence DECIMAL(5, 4),
    original_input TEXT, -- Original voice/text input
    
    -- 🔗 BLOCKCHAIN INTEGRATION
    blockchain_status TEXT DEFAULT 'local' CHECK (blockchain_status IN ('local', 'pending', 'synced', 'verified', 'failed')),
    blockchain_tx_hash TEXT,
    blockchain_block_number BIGINT,
    blockchain_network TEXT DEFAULT 'polygon', -- 'ethereum', 'polygon', 'solana'
    blockchain_timestamp TIMESTAMP WITH TIME ZONE,
    data_hash TEXT, -- SHA-256 hash of transaction data for integrity
    merkle_proof TEXT, -- Proof for batch verification
    
    -- Privacy flags
    exclude_from_reports BOOLEAN DEFAULT FALSE,
    anonymize_in_analytics BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE -- Soft delete for audit trail
);

ALTER TABLE public.ican_financial_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own transactions"
    ON public.ican_financial_transactions FOR SELECT
    USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users can insert their own transactions"
    ON public.ican_financial_transactions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions"
    ON public.ican_financial_transactions FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can soft delete their own transactions"
    ON public.ican_financial_transactions FOR DELETE
    USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ican_ft_user_date ON public.ican_financial_transactions(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_ican_ft_type ON public.ican_financial_transactions(user_id, transaction_type);
CREATE INDEX IF NOT EXISTS idx_ican_ft_category ON public.ican_financial_transactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_ican_ft_blockchain ON public.ican_financial_transactions(blockchain_status);
CREATE INDEX IF NOT EXISTS idx_ican_ft_recurring ON public.ican_financial_transactions(user_id, is_recurring) WHERE is_recurring = TRUE;


-- =============================================
-- 💳 LOANS & CREDIT TRACKING
-- Comprehensive loan management with privacy
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Loan Details
    loan_type TEXT NOT NULL CHECK (loan_type IN ('personal', 'business', 'mortgage', 'vehicle', 'education', 'emergency', 'microfinance', 'sacco')),
    loan_name TEXT,
    
    -- Amounts (encrypted for sensitive loans)
    principal_amount DECIMAL(18, 4) NOT NULL,
    principal_encrypted TEXT,
    interest_rate DECIMAL(8, 4) NOT NULL,
    total_interest DECIMAL(18, 4),
    total_amount_due DECIMAL(18, 4),
    amount_paid DECIMAL(18, 4) DEFAULT 0,
    remaining_balance DECIMAL(18, 4),
    currency TEXT DEFAULT 'UGX',
    
    -- Terms
    term_months INTEGER NOT NULL,
    monthly_payment DECIMAL(18, 4),
    payment_frequency TEXT DEFAULT 'monthly',
    start_date DATE NOT NULL,
    end_date DATE,
    next_payment_date DATE,
    
    -- Lender info (encrypted for privacy)
    lender_name_encrypted TEXT,
    lender_type TEXT, -- 'bank', 'microfinance', 'sacco', 'individual', 'fintech'
    lender_contact_encrypted TEXT,
    account_number_encrypted TEXT,
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'paid_off', 'defaulted', 'restructured', 'cancelled')),
    
    -- Collateral (encrypted)
    has_collateral BOOLEAN DEFAULT FALSE,
    collateral_description_encrypted TEXT,
    collateral_value DECIMAL(18, 4),
    
    -- 🔗 BLOCKCHAIN
    blockchain_status TEXT DEFAULT 'local',
    blockchain_tx_hash TEXT,
    smart_contract_address TEXT, -- If loan is on-chain
    data_hash TEXT,
    
    -- Privacy
    is_sensitive BOOLEAN DEFAULT TRUE,
    exclude_from_reports BOOLEAN DEFAULT FALSE,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.ican_loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own loans"
    ON public.ican_loans FOR ALL
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ican_loans_user ON public.ican_loans(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_loans_status ON public.ican_loans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ican_loans_next_payment ON public.ican_loans(next_payment_date) WHERE status = 'active';


-- =============================================
-- 🎯 FINANCIAL GOALS
-- Privacy-preserving goal tracking
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_financial_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Goal Details
    goal_type TEXT NOT NULL CHECK (goal_type IN ('savings', 'debt_payoff', 'investment', 'emergency_fund', 'purchase', 'retirement', 'education', 'business', 'tithe', 'custom')),
    goal_name TEXT NOT NULL,
    description TEXT,
    
    -- Target & Progress
    target_amount DECIMAL(18, 4) NOT NULL,
    current_amount DECIMAL(18, 4) DEFAULT 0,
    currency TEXT DEFAULT 'UGX',
    progress_percentage DECIMAL(5, 2) GENERATED ALWAYS AS (
        CASE WHEN target_amount > 0 THEN LEAST((current_amount / target_amount) * 100, 100) ELSE 0 END
    ) STORED,
    
    -- Timeline
    start_date DATE DEFAULT CURRENT_DATE,
    target_date DATE,
    completed_date DATE,
    
    -- Strategy
    monthly_contribution DECIMAL(18, 4),
    auto_contribute BOOLEAN DEFAULT FALSE,
    contribution_source TEXT, -- Account or method
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled', 'failed')),
    priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
    
    -- ICAN Journey Stage Link
    journey_stage INTEGER CHECK (journey_stage >= 1 AND journey_stage <= 4),
    
    -- 🔗 BLOCKCHAIN
    blockchain_status TEXT DEFAULT 'local',
    blockchain_tx_hash TEXT,
    milestone_hashes TEXT[], -- Hash of each milestone achieved
    
    -- Notifications
    reminder_enabled BOOLEAN DEFAULT TRUE,
    reminder_frequency TEXT DEFAULT 'weekly',
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.ican_financial_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own goals"
    ON public.ican_financial_goals FOR ALL
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ican_goals_user ON public.ican_financial_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_goals_status ON public.ican_financial_goals(user_id, status);


-- =============================================
-- ⛪ TITHE & GIVING TRACKER
-- Religious giving with privacy protection
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_tithe_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    transaction_id UUID REFERENCES public.ican_financial_transactions(id),
    
    -- Tithe Details
    giving_type TEXT NOT NULL CHECK (giving_type IN ('tithe', 'offering', 'charity', 'mission', 'building_fund', 'special_offering', 'alms', 'zakat', 'sadaqah', 'other')),
    amount DECIMAL(18, 4) NOT NULL,
    currency TEXT DEFAULT 'UGX',
    
    -- Income Reference (for tithe calculation)
    income_reference_amount DECIMAL(18, 4),
    tithe_percentage DECIMAL(5, 2) DEFAULT 10.00,
    
    -- Recipient (encrypted for privacy)
    recipient_name_encrypted TEXT,
    recipient_type TEXT, -- 'church', 'mosque', 'charity', 'individual', 'organization'
    
    -- Date
    giving_date DATE NOT NULL DEFAULT CURRENT_DATE,
    income_period_start DATE,
    income_period_end DATE,
    
    -- Verification
    receipt_reference TEXT,
    verified BOOLEAN DEFAULT FALSE,
    
    -- 🔗 BLOCKCHAIN (for permanent giving record)
    blockchain_status TEXT DEFAULT 'local',
    blockchain_tx_hash TEXT,
    giving_certificate_hash TEXT, -- Immutable proof of giving
    
    -- Privacy
    is_anonymous BOOLEAN DEFAULT FALSE,
    exclude_from_reports BOOLEAN DEFAULT FALSE,
    
    notes_encrypted TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.ican_tithe_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own tithe records"
    ON public.ican_tithe_records FOR ALL
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ican_tithe_user ON public.ican_tithe_records(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_tithe_date ON public.ican_tithe_records(user_id, giving_date DESC);


-- =============================================
-- 📊 BUDGETS
-- Monthly/Category budgets with privacy
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Budget Details
    budget_name TEXT NOT NULL,
    budget_type TEXT DEFAULT 'category' CHECK (budget_type IN ('category', 'overall', 'goal_linked', 'project')),
    category TEXT,
    sub_category TEXT,
    
    -- Amounts
    budget_amount DECIMAL(18, 4) NOT NULL,
    spent_amount DECIMAL(18, 4) DEFAULT 0,
    remaining_amount DECIMAL(18, 4) GENERATED ALWAYS AS (budget_amount - spent_amount) STORED,
    currency TEXT DEFAULT 'UGX',
    
    -- Period
    period_type TEXT DEFAULT 'monthly' CHECK (period_type IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    
    -- Rollover
    allow_rollover BOOLEAN DEFAULT FALSE,
    rollover_amount DECIMAL(18, 4) DEFAULT 0,
    
    -- Alerts
    alert_threshold_percent DECIMAL(5, 2) DEFAULT 80.00,
    alert_sent BOOLEAN DEFAULT FALSE,
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'exceeded', 'cancelled')),
    
    -- 🔗 BLOCKCHAIN
    blockchain_status TEXT DEFAULT 'local',
    commitment_hash TEXT, -- Hash of budget commitment for accountability
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.ican_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own budgets"
    ON public.ican_budgets FOR ALL
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ican_budgets_user ON public.ican_budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_budgets_active ON public.ican_budgets(user_id, status) WHERE status = 'active';


-- =============================================
-- 🏢 BUSINESS METRICS (for Business Owners)
-- Business-specific financial tracking
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_business_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Business Info
    business_name_encrypted TEXT,
    business_type TEXT,
    industry TEXT,
    
    -- Period
    metric_period DATE NOT NULL, -- First day of month
    period_type TEXT DEFAULT 'monthly',
    
    -- Revenue Metrics
    gross_revenue DECIMAL(18, 4) DEFAULT 0,
    net_revenue DECIMAL(18, 4) DEFAULT 0,
    recurring_revenue DECIMAL(18, 4) DEFAULT 0,
    
    -- Expense Metrics
    total_expenses DECIMAL(18, 4) DEFAULT 0,
    operating_expenses DECIMAL(18, 4) DEFAULT 0,
    payroll_expenses DECIMAL(18, 4) DEFAULT 0,
    
    -- Profitability
    gross_profit DECIMAL(18, 4) DEFAULT 0,
    net_profit DECIMAL(18, 4) DEFAULT 0,
    profit_margin DECIMAL(8, 4),
    
    -- Cash Flow
    cash_inflow DECIMAL(18, 4) DEFAULT 0,
    cash_outflow DECIMAL(18, 4) DEFAULT 0,
    net_cash_flow DECIMAL(18, 4) DEFAULT 0,
    
    -- Receivables/Payables
    accounts_receivable DECIMAL(18, 4) DEFAULT 0,
    accounts_payable DECIMAL(18, 4) DEFAULT 0,
    
    -- Inventory (if applicable)
    inventory_value DECIMAL(18, 4) DEFAULT 0,
    
    -- KPIs
    customer_count INTEGER DEFAULT 0,
    average_transaction_value DECIMAL(18, 4),
    
    currency TEXT DEFAULT 'UGX',
    
    -- 🔗 BLOCKCHAIN
    blockchain_status TEXT DEFAULT 'local',
    metrics_hash TEXT, -- Hash for verification
    blockchain_tx_hash TEXT,
    
    -- Privacy
    is_verified BOOLEAN DEFAULT FALSE,
    auditor_signature_encrypted TEXT,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, metric_period, period_type)
);

ALTER TABLE public.ican_business_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own business metrics"
    ON public.ican_business_metrics FOR ALL
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ican_biz_user ON public.ican_business_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_biz_period ON public.ican_business_metrics(user_id, metric_period DESC);


-- =============================================
-- 🔗 BLOCKCHAIN VERIFICATION LOG
-- Immutable audit trail on blockchain
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_blockchain_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Record Reference
    record_type TEXT NOT NULL, -- 'transaction', 'loan', 'goal', 'tithe', 'budget', 'metrics'
    record_id UUID NOT NULL,
    record_table TEXT NOT NULL,
    
    -- Data Integrity
    data_hash TEXT NOT NULL, -- SHA-256 of record data
    previous_hash TEXT, -- For chain linking
    
    -- Blockchain Details
    blockchain_network TEXT DEFAULT 'polygon',
    tx_hash TEXT NOT NULL,
    block_number BIGINT,
    block_timestamp TIMESTAMP WITH TIME ZONE,
    gas_used BIGINT,
    
    -- Verification Status
    status TEXT DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'failed')),
    confirmations INTEGER DEFAULT 0,
    
    -- Smart Contract (if applicable)
    contract_address TEXT,
    contract_method TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    verified_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.ican_blockchain_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own blockchain verifications"
    ON public.ican_blockchain_verifications FOR SELECT
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ican_bc_user ON public.ican_blockchain_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_bc_record ON public.ican_blockchain_verifications(record_table, record_id);
CREATE INDEX IF NOT EXISTS idx_ican_bc_tx ON public.ican_blockchain_verifications(tx_hash);


-- =============================================
-- 📱 USER PRIVACY SETTINGS
-- Granular privacy controls
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_privacy_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
    
    -- Data Encryption Preferences
    encrypt_amounts BOOLEAN DEFAULT FALSE,
    encrypt_descriptions BOOLEAN DEFAULT FALSE,
    encrypt_locations BOOLEAN DEFAULT TRUE,
    encrypt_lender_info BOOLEAN DEFAULT TRUE,
    
    -- Analytics Preferences
    allow_anonymous_analytics BOOLEAN DEFAULT TRUE,
    share_anonymized_insights BOOLEAN DEFAULT FALSE,
    
    -- Blockchain Preferences
    auto_sync_to_blockchain BOOLEAN DEFAULT FALSE,
    blockchain_network_preference TEXT DEFAULT 'polygon',
    require_verification_for_large_tx BOOLEAN DEFAULT TRUE,
    large_tx_threshold DECIMAL(18, 4) DEFAULT 1000000, -- 1M UGX default
    
    -- Report Preferences
    exclude_sensitive_from_reports BOOLEAN DEFAULT TRUE,
    anonymize_reports BOOLEAN DEFAULT FALSE,
    
    -- Data Retention
    auto_delete_after_months INTEGER, -- NULL = never
    export_before_delete BOOLEAN DEFAULT TRUE,
    
    -- Two-Factor for Sensitive Operations
    require_2fa_for_delete BOOLEAN DEFAULT TRUE,
    require_2fa_for_export BOOLEAN DEFAULT TRUE,
    require_biometric_for_sensitive BOOLEAN DEFAULT FALSE,
    
    -- Sharing
    allow_family_sharing BOOLEAN DEFAULT FALSE,
    allow_accountant_access BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.ican_privacy_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own privacy settings"
    ON public.ican_privacy_settings FOR ALL
    USING (auth.uid() = user_id);


-- =============================================
-- 📝 AUDIT LOG (Privacy-Compliant)
-- Track all sensitive operations
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Action Details
    action_type TEXT NOT NULL, -- 'create', 'read', 'update', 'delete', 'export', 'share', 'encrypt', 'decrypt'
    resource_type TEXT NOT NULL,
    resource_id UUID,
    
    -- Change Tracking (encrypted for sensitive data)
    old_value_hash TEXT, -- Hash of old value
    new_value_hash TEXT, -- Hash of new value
    changes_summary TEXT, -- Non-sensitive summary
    
    -- Context
    ip_address_hash TEXT, -- Hashed for privacy
    user_agent_hash TEXT,
    session_id TEXT,
    
    -- Verification
    biometric_verified BOOLEAN DEFAULT FALSE,
    two_factor_verified BOOLEAN DEFAULT FALSE,
    
    -- Blockchain Backup
    blockchain_logged BOOLEAN DEFAULT FALSE,
    blockchain_tx_hash TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.ican_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own audit logs"
    ON public.ican_audit_log FOR SELECT
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ican_audit_user ON public.ican_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_audit_action ON public.ican_audit_log(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ican_audit_resource ON public.ican_audit_log(resource_type, resource_id);


-- =============================================
-- 🔄 HELPER FUNCTIONS
-- =============================================

-- Function to generate data hash for blockchain verification
CREATE OR REPLACE FUNCTION generate_data_hash(data JSONB)
RETURNS TEXT AS $$
BEGIN
    RETURN encode(digest(data::text, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply timestamp triggers
CREATE TRIGGER update_ican_ft_updated_at BEFORE UPDATE ON public.ican_financial_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_ican_loans_updated_at BEFORE UPDATE ON public.ican_loans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_ican_goals_updated_at BEFORE UPDATE ON public.ican_financial_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_ican_budgets_updated_at BEFORE UPDATE ON public.ican_budgets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_ican_biz_updated_at BEFORE UPDATE ON public.ican_business_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_ican_privacy_updated_at BEFORE UPDATE ON public.ican_privacy_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- Function to initialize user privacy settings on signup
CREATE OR REPLACE FUNCTION init_ican_privacy_settings()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.ican_privacy_settings (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_user_created_init_privacy
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION init_ican_privacy_settings();


-- Function to create audit log entry
CREATE OR REPLACE FUNCTION create_audit_log(
    p_user_id UUID,
    p_action_type TEXT,
    p_resource_type TEXT,
    p_resource_id UUID DEFAULT NULL,
    p_changes_summary TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_audit_id UUID;
BEGIN
    INSERT INTO public.ican_audit_log (
        user_id, action_type, resource_type, resource_id, changes_summary
    ) VALUES (
        p_user_id, p_action_type, p_resource_type, p_resource_id, p_changes_summary
    ) RETURNING id INTO v_audit_id;
    
    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Function to get user's financial summary (privacy-aware)
CREATE OR REPLACE FUNCTION get_ican_financial_summary(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'totalIncome', COALESCE(SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END), 0),
        'totalExpenses', COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0),
        'totalTithe', COALESCE(SUM(CASE WHEN transaction_type = 'tithe' THEN amount ELSE 0 END), 0),
        'transactionCount', COUNT(*),
        'netCashFlow', COALESCE(SUM(CASE 
            WHEN transaction_type = 'income' THEN amount 
            WHEN transaction_type IN ('expense', 'tithe', 'loan_payment') THEN -amount 
            ELSE 0 
        END), 0),
        'lastUpdated', MAX(created_at)
    ) INTO result
    FROM public.ican_financial_transactions
    WHERE user_id = p_user_id 
    AND deleted_at IS NULL
    AND exclude_from_reports = FALSE;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================
-- 🔐 GRANT PERMISSIONS
-- =============================================

-- Grant access to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ican_financial_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ican_loans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ican_financial_goals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ican_tithe_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ican_budgets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ican_business_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ican_privacy_settings TO authenticated;
GRANT SELECT ON public.ican_audit_log TO authenticated;
GRANT SELECT ON public.ican_blockchain_verifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ican_encryption_keys TO authenticated;

-- Grant usage on sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

