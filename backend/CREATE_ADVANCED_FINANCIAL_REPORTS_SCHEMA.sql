-- Create financial_reports table for storing generated reports
-- Supports Tax Returns, Balance Sheets, Income Statements with AI analysis

CREATE TABLE IF NOT EXISTS public.financial_reports (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL,
    -- report_type values: 'tax-return', 'balance-sheet', 'income-statement', 'compliance-report'
    
    country VARCHAR(10) NOT NULL,
    -- country codes: 'UG', 'KE', 'TZ', 'RW', 'US', etc.
    
    filing_period INTEGER,
    -- For tax returns: the year filed
    
    data JSONB NOT NULL,
    -- Full report data including calculations, analysis, recommendations
    
    status VARCHAR(50) DEFAULT 'DRAFT',
    -- DRAFT, SUBMITTED, FILED, ARCHIVED
    
    ai_analysis_used BOOLEAN DEFAULT FALSE,
    -- Whether OpenAI API was used for this report
    
    compliance_verified BOOLEAN DEFAULT FALSE,
    -- Whether report has been compliance-checked
    
    exported_formats TEXT[] DEFAULT '{}',
    -- Array of export formats used: PDF, Excel, JSON
    
    tags TEXT[] DEFAULT '{}',
    -- For easy searching and organization
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    filed_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT valid_report_type CHECK (report_type IN ('tax-return', 'balance-sheet', 'income-statement', 'compliance-report')),
    CONSTRAINT valid_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'FILED', 'ARCHIVED'))
);

-- Create indexes for performance
CREATE INDEX idx_financial_reports_user_id ON public.financial_reports(user_id);
CREATE INDEX idx_financial_reports_report_type ON public.financial_reports(report_type);
CREATE INDEX idx_financial_reports_country ON public.financial_reports(country);
CREATE INDEX idx_financial_reports_filing_period ON public.financial_reports(filing_period);
CREATE INDEX idx_financial_reports_status ON public.financial_reports(status);
CREATE INDEX idx_financial_reports_created_at ON public.financial_reports(created_at DESC);
CREATE INDEX idx_financial_reports_user_created ON public.financial_reports(user_id, created_at DESC);

-- Create tax_compliance_tracking table to track compliance requirements
CREATE TABLE IF NOT EXISTS public.tax_compliance_tracking (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    report_id BIGINT NOT NULL REFERENCES public.financial_reports(id) ON DELETE CASCADE,
    country VARCHAR(10) NOT NULL,
    
    compliance_item VARCHAR(255) NOT NULL,
    description TEXT,
    required BOOLEAN DEFAULT TRUE,
    completed BOOLEAN DEFAULT FALSE,
    
    due_date DATE,
    completion_date DATE,
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tax_compliance_user_id ON public.tax_compliance_tracking(user_id);
CREATE INDEX idx_tax_compliance_report_id ON public.tax_compliance_tracking(report_id);
CREATE INDEX idx_tax_compliance_completed ON public.tax_compliance_tracking(completed);
CREATE INDEX idx_tax_compliance_due_date ON public.tax_compliance_tracking(due_date);

-- Create tax_optimization_history table to track optimization suggestions
CREATE TABLE IF NOT EXISTS public.tax_optimization_history (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    report_id BIGINT NOT NULL REFERENCES public.financial_reports(id) ON DELETE CASCADE,
    
    strategy_name VARCHAR(255) NOT NULL,
    description TEXT,
    estimated_savings DECIMAL(15, 2),
    category VARCHAR(100),
    -- Categories: 'expense-maximization', 'income-timing', 'asset-protection', 'investment-optimization'
    
    implemented BOOLEAN DEFAULT FALSE,
    implementation_date DATE,
    actual_savings DECIMAL(15, 2),
    
    ai_recommended BOOLEAN DEFAULT FALSE,
    confidence_score DECIMAL(3, 2),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tax_optimization_user_id ON public.tax_optimization_history(user_id);
CREATE INDEX idx_tax_optimization_report_id ON public.tax_optimization_history(report_id);
CREATE INDEX idx_tax_optimization_implemented ON public.tax_optimization_history(implemented);
CREATE INDEX idx_tax_optimization_savings ON public.tax_optimization_history(estimated_savings DESC);

-- Create country_tax_settings table for user-specific country tax configurations
CREATE TABLE IF NOT EXISTS public.country_tax_settings (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    country VARCHAR(10) NOT NULL,
    
    tax_id VARCHAR(100),
    -- TIN, PIN, SSN, EIN, etc depending on country
    
    tax_id_type VARCHAR(50),
    business_name VARCHAR(255),
    business_type VARCHAR(100),
    fiscal_year_end DATE,
    
    enabled BOOLEAN DEFAULT TRUE,
    verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMP WITH TIME ZONE,
    
    settings JSONB DEFAULT '{}',
    -- Additional settings specific to country
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, country)
);

CREATE INDEX idx_country_tax_settings_user_id ON public.country_tax_settings(user_id);
CREATE INDEX idx_country_tax_settings_country ON public.country_tax_settings(country);

-- Create ai_analysis_log table to track OpenAI API usage
CREATE TABLE IF NOT EXISTS public.ai_analysis_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    report_id BIGINT REFERENCES public.financial_reports(id) ON DELETE SET NULL,
    
    analysis_type VARCHAR(100) NOT NULL,
    -- Types: 'tax-optimization', 'compliance-check', 'balance-sheet-analysis', 'income-analysis'
    
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    
    cost DECIMAL(10, 4),
    api_response_time_ms INTEGER,
    
    model VARCHAR(50) DEFAULT 'gpt-4-turbo-preview',
    status VARCHAR(50),
    -- SUCCESS, FAILED, RATE_LIMITED
    
    error_message TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ai_analysis_log_user_id ON public.ai_analysis_log(user_id);
CREATE INDEX idx_ai_analysis_log_report_id ON public.ai_analysis_log(report_id);
CREATE INDEX idx_ai_analysis_log_analysis_type ON public.ai_analysis_log(analysis_type);
CREATE INDEX idx_ai_analysis_log_created_at ON public.ai_analysis_log(created_at DESC);

-- Create trigger to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_financial_reports_updated_at BEFORE UPDATE ON public.financial_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tax_compliance_tracking_updated_at BEFORE UPDATE ON public.tax_compliance_tracking
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tax_optimization_history_updated_at BEFORE UPDATE ON public.tax_optimization_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_country_tax_settings_updated_at BEFORE UPDATE ON public.country_tax_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security Policies
ALTER TABLE public.financial_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_compliance_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_optimization_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_tax_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_analysis_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for financial_reports
CREATE POLICY "Users can view their own financial reports"
ON public.financial_reports FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create financial reports"
ON public.financial_reports FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own financial reports"
ON public.financial_reports FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own financial reports"
ON public.financial_reports FOR DELETE
USING (auth.uid() = user_id);

-- RLS Policies for tax_compliance_tracking
CREATE POLICY "Users can view their own compliance tracking"
ON public.tax_compliance_tracking FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own compliance tracking"
ON public.tax_compliance_tracking FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own compliance tracking"
ON public.tax_compliance_tracking FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- RLS Policies for tax_optimization_history
CREATE POLICY "Users can view their own tax optimization history"
ON public.tax_optimization_history FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create tax optimization records"
ON public.tax_optimization_history FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tax optimization records"
ON public.tax_optimization_history FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- RLS Policies for country_tax_settings
CREATE POLICY "Users can view their own tax settings"
ON public.country_tax_settings FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own tax settings"
ON public.country_tax_settings FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- RLS Policies for ai_analysis_log
CREATE POLICY "Users can view their own AI analysis logs"
ON public.ai_analysis_log FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create AI analysis logs"
ON public.ai_analysis_log FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Add comments for documentation
COMMENT ON TABLE public.financial_reports IS 'Stores generated financial reports (Tax Returns, Balance Sheets, Income Statements) with AI analysis and country compliance data';
COMMENT ON TABLE public.tax_compliance_tracking IS 'Tracks tax compliance requirements and completion status for users';
COMMENT ON TABLE public.tax_optimization_history IS 'Records tax optimization strategies and their implementation';
COMMENT ON TABLE public.country_tax_settings IS 'Stores user-specific country tax configurations and IDs';
COMMENT ON TABLE public.ai_analysis_log IS 'Logs of OpenAI API calls for cost tracking and analysis';
