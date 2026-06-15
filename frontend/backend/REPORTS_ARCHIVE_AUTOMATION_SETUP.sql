-- =============================================================
-- ICAN Reports + Daily Archive + Automation Support
-- Safe to paste in Supabase SQL Editor (idempotent).
-- =============================================================

BEGIN;

-- 1) Ensure core table exists (minimal compatible shape)
CREATE TABLE IF NOT EXISTS public.financial_reports (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL,
    country VARCHAR(10) NOT NULL DEFAULT 'UG',
    filing_period INTEGER,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(50) DEFAULT 'DRAFT',
    ai_analysis_used BOOLEAN DEFAULT FALSE,
    compliance_verified BOOLEAN DEFAULT FALSE,
    exported_formats TEXT[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    filed_at TIMESTAMPTZ
);

-- 2) Ensure required columns exist
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS country VARCHAR(10) DEFAULT 'UG';
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS filing_period INTEGER;
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'DRAFT';
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS ai_analysis_used BOOLEAN DEFAULT FALSE;
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS compliance_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS exported_formats TEXT[] DEFAULT '{}';
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS filed_at TIMESTAMPTZ;

-- 3) Enforce compatible constraints (includes ARCHIVED status)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'valid_report_type'
          AND conrelid = 'public.financial_reports'::regclass
    ) THEN
        ALTER TABLE public.financial_reports DROP CONSTRAINT valid_report_type;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'valid_status'
          AND conrelid = 'public.financial_reports'::regclass
    ) THEN
        ALTER TABLE public.financial_reports DROP CONSTRAINT valid_status;
    END IF;
END $$;

ALTER TABLE public.financial_reports
    ADD CONSTRAINT valid_report_type
    CHECK (report_type IN ('tax-return', 'balance-sheet', 'income-statement', 'compliance-report'));

ALTER TABLE public.financial_reports
    ADD CONSTRAINT valid_status
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'FILED', 'ARCHIVED'));

-- 4) Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_financial_reports_updated_at ON public.financial_reports;
CREATE TRIGGER update_financial_reports_updated_at
BEFORE UPDATE ON public.financial_reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Performance indexes for app + automation queries
CREATE INDEX IF NOT EXISTS idx_financial_reports_user_id ON public.financial_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_financial_reports_report_type ON public.financial_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_financial_reports_status ON public.financial_reports(status);
CREATE INDEX IF NOT EXISTS idx_financial_reports_created_at ON public.financial_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_reports_user_created ON public.financial_reports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_reports_user_type_status_created
    ON public.financial_reports(user_id, report_type, status, created_at DESC);

-- Tags are queried with contains() in app logic (daily-archive, weekly, monthly)
CREATE INDEX IF NOT EXISTS idx_financial_reports_tags_gin
    ON public.financial_reports USING GIN (tags);

-- JSON metadata lookups (dayKey, archive payload)
CREATE INDEX IF NOT EXISTS idx_financial_reports_data_gin
    ON public.financial_reports USING GIN (data jsonb_path_ops);

-- Optional focused index for daily archive lookup by dayKey from metadata
CREATE INDEX IF NOT EXISTS idx_financial_reports_daily_archive_daykey
    ON public.financial_reports ((data #>> '{metadata,dayKey}'))
    WHERE report_type = 'income-statement';

-- 6) RLS policies
ALTER TABLE public.financial_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own financial reports" ON public.financial_reports;
DROP POLICY IF EXISTS "Users can create financial reports" ON public.financial_reports;
DROP POLICY IF EXISTS "Users can update their own financial reports" ON public.financial_reports;
DROP POLICY IF EXISTS "Users can delete their own financial reports" ON public.financial_reports;

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

-- 7) Read-only helper view for daily archived reports
CREATE OR REPLACE VIEW public.v_financial_report_daily_archives AS
SELECT
    fr.id,
    fr.user_id,
    fr.country,
    fr.status,
    fr.tags,
    fr.created_at,
    fr.updated_at,
    fr.data #>> '{metadata,dayKey}' AS day_key,
    COALESCE((fr.data #>> '{metadata,transactionCount}')::INT, 0) AS transaction_count,
    fr.data #> '{metadata,dailyTransactionItems}' AS daily_transaction_items,
    fr.data
FROM public.financial_reports fr
WHERE fr.report_type = 'income-statement'
  AND fr.tags @> ARRAY['daily-archive']::TEXT[];

COMMENT ON VIEW public.v_financial_report_daily_archives IS
'Daily archived transaction reports (stored in financial_reports as income-statement + daily-archive tag).';

-- 8) RPC helper for current user daily archives
CREATE OR REPLACE FUNCTION public.get_my_daily_archived_reports(p_limit INT DEFAULT 31)
RETURNS TABLE (
    id BIGINT,
    created_at TIMESTAMPTZ,
    day_key TEXT,
    transaction_count INT,
    country VARCHAR,
    status VARCHAR,
    tags TEXT[],
    daily_transaction_items JSONB,
    report_data JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        fr.id,
        fr.created_at,
        fr.data #>> '{metadata,dayKey}' AS day_key,
        COALESCE((fr.data #>> '{metadata,transactionCount}')::INT, 0) AS transaction_count,
        fr.country,
        fr.status,
        fr.tags,
        fr.data #> '{metadata,dailyTransactionItems}' AS daily_transaction_items,
        fr.data AS report_data
    FROM public.financial_reports fr
    WHERE fr.user_id = auth.uid()
      AND fr.report_type = 'income-statement'
      AND fr.tags @> ARRAY['daily-archive']::TEXT[]
    ORDER BY fr.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 31), 1);
$$;

COMMENT ON FUNCTION public.get_my_daily_archived_reports(INT) IS
'Returns the current authenticated user daily archived report rows with day key and transaction item list.';

COMMIT;
