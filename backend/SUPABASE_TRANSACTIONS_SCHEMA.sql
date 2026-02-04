-- ============================================
-- ICAN Capital Engine - Personal Finance Schema
-- Transactions Table for Daily Income & Expenditure
-- ============================================

-- Drop existing table if it has incorrect structure (OPTIONAL - use with caution)
-- DROP TABLE IF EXISTS transactions CASCADE;

-- ============================================
-- ALTER EXISTING TABLE - Add missing columns if needed
-- ============================================
-- If table exists, run these ALTERs to add missing columns:

-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS location VARCHAR(255);
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS time_context VARCHAR(50);
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS loan_details JSONB;
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ai_insights JSONB;
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS original_text TEXT;
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tags TEXT[];
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reporting_data JSONB;
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

-- ============================================
-- IF TABLE DOESN'T EXIST, CREATE IT
-- ============================================
-- CREATE TABLE transactions (
--   id BIGSERIAL PRIMARY KEY,
--   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
--   
--   -- Core transaction fields for PERSONAL DAILY TRACKING
--   amount BIGINT NOT NULL,  -- Support for massive numbers
--   type VARCHAR(50) NOT NULL,  -- 'income', 'expense', 'loan'
--   category VARCHAR(100),  -- Expense categories: food, transport, utilities, etc.
--   sub_category VARCHAR(100),  -- More specific categorization
--   description TEXT,  -- Full transaction description
--   
--   -- Context fields
--   location VARCHAR(255),  -- Where transaction occurred
--   payment_method VARCHAR(50),  -- 'cash', 'card', 'mobile_money'
--   time_context VARCHAR(50),  -- 'morning', 'afternoon', 'evening'
--   
--   -- Loan-specific fields
--   is_loan BOOLEAN DEFAULT FALSE,
--   loan_details JSONB,
--   
--   -- AI Analysis
--   confidence INTEGER DEFAULT 0,
--   ai_insights JSONB,
--   
--   -- Metadata
--   original_text TEXT,
--   tags TEXT[],
--   reporting_data JSONB,
--   
--   -- Timestamps
--   transaction_date TIMESTAMP NOT NULL DEFAULT NOW(),
--   created_at TIMESTAMP NOT NULL DEFAULT NOW(),
--   updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
--   
--   CONSTRAINT amount_range CHECK (amount >= 0)
-- );

-- ============================================
-- DISCOVERY: Check Actual Table Structure
-- ============================================
-- Run this query to see what columns exist:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'transactions' ORDER BY ordinal_position;

-- ============================================
-- PERSONAL DAILY EXPENDITURE VIEW
-- ============================================
CREATE OR REPLACE VIEW personal_daily_expenditure AS
SELECT 
  DATE(created_at) as expenditure_date,
  COUNT(*) as transaction_count,
  user_id
FROM transactions
WHERE type = 'expense'
GROUP BY DATE(created_at), user_id
ORDER BY expenditure_date DESC, transaction_count DESC;

-- ============================================
-- PERSONAL DAILY INCOME VIEW
-- ============================================
CREATE OR REPLACE VIEW personal_daily_income AS
SELECT 
  DATE(created_at) as income_date,
  COUNT(*) as income_transactions,
  user_id
FROM transactions
WHERE type = 'income'
GROUP BY DATE(created_at), user_id
ORDER BY income_date DESC, income_transactions DESC;

-- ============================================
-- DAILY BALANCE VIEW (Count by Type)
-- ============================================
CREATE OR REPLACE VIEW daily_balance_summary AS
SELECT 
  DATE(created_at) as transaction_date,
  user_id,
  COUNT(CASE WHEN type = 'income' THEN 1 END) as income_count,
  COUNT(CASE WHEN type = 'expense' THEN 1 END) as expense_count,
  COUNT(*) as total_transactions
FROM transactions
GROUP BY DATE(created_at), user_id
ORDER BY transaction_date DESC;

-- ============================================
-- WEEKLY SUMMARY REPORT
-- ============================================
CREATE OR REPLACE VIEW weekly_summary_report AS
SELECT 
  DATE_TRUNC('week', created_at)::DATE as week_start,
  user_id,
  COUNT(CASE WHEN type = 'income' THEN 1 END) as weekly_income_count,
  COUNT(CASE WHEN type = 'expense' THEN 1 END) as weekly_expense_count,
  COUNT(*) as transactions_this_week,
  COUNT(DISTINCT DATE(created_at)) as days_with_transactions
FROM transactions
GROUP BY DATE_TRUNC('week', created_at), user_id
ORDER BY week_start DESC;

-- ============================================
-- MONTHLY SUMMARY REPORT
-- ============================================
CREATE OR REPLACE VIEW monthly_summary_report AS
SELECT 
  DATE_TRUNC('month', created_at)::DATE as month_start,
  EXTRACT(MONTH FROM created_at)::INT as month,
  EXTRACT(YEAR FROM created_at)::INT as year,
  user_id,
  COUNT(CASE WHEN type = 'income' THEN 1 END) as monthly_income_count,
  COUNT(CASE WHEN type = 'expense' THEN 1 END) as monthly_expense_count,
  COUNT(*) as monthly_transactions,
  COUNT(DISTINCT DATE(created_at)) as days_active
FROM transactions
GROUP BY DATE_TRUNC('month', created_at), 
         EXTRACT(MONTH FROM created_at),
         EXTRACT(YEAR FROM created_at),
         user_id
ORDER BY year DESC, month DESC;

-- ============================================
-- SPENDING BREAKDOWN BY TYPE (COUNT ONLY)
-- ============================================
CREATE OR REPLACE VIEW spending_breakdown AS
SELECT 
  user_id,
  COUNT(*) as total_transaction_count,
  COUNT(CASE WHEN type = 'income' THEN 1 END) as total_income_transactions,
  COUNT(CASE WHEN type = 'expense' THEN 1 END) as total_expense_transactions,
  COUNT(CASE WHEN type = 'loan' THEN 1 END) as total_loan_transactions
FROM transactions
GROUP BY user_id
ORDER BY user_id;

-- ============================================
-- PERSONAL NET WORTH TRACKING (by transaction count)
-- ============================================
CREATE OR REPLACE VIEW net_worth_tracking AS
SELECT 
  DATE(created_at)::DATE as tracking_date,
  user_id,
  COUNT(CASE WHEN type = 'income' THEN 1 END) as daily_income_count,
  COUNT(CASE WHEN type = 'expense' THEN 1 END) as daily_expense_count,
  COUNT(*) as transactions_today
FROM transactions
GROUP BY DATE(created_at), user_id
ORDER BY user_id, tracking_date DESC;

-- ============================================
-- SPENDING TRENDS (30-day moving average by count)
-- ============================================
CREATE OR REPLACE VIEW spending_trends AS
SELECT 
  DATE(created_at)::DATE as trend_date,
  user_id,
  COUNT(CASE WHEN type = 'expense' THEN 1 END) as daily_expense_count,
  AVG(COUNT(CASE WHEN type = 'expense' THEN 1 END)) 
    OVER (PARTITION BY user_id ORDER BY DATE(created_at) 
          ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) as moving_avg_expense_30day,
  COUNT(CASE WHEN type = 'income' THEN 1 END) as daily_income_count,
  AVG(COUNT(CASE WHEN type = 'income' THEN 1 END)) 
    OVER (PARTITION BY user_id ORDER BY DATE(created_at) 
          ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) as income_moving_avg_30day
FROM transactions
GROUP BY DATE(created_at), user_id
ORDER BY user_id, trend_date DESC;

-- ============================================
-- CREATE INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_amount ON transactions(amount);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON transactions(user_id, type);

-- ============================================
-- FUNCTION TO GENERATE DAILY REPORT
-- ============================================
CREATE OR REPLACE FUNCTION get_daily_report(p_user_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  report_date DATE,
  total_income BIGINT,
  total_expenses BIGINT,
  daily_balance BIGINT,
  income_transactions INT,
  expense_transactions INT,
  top_expense_amount BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p_date,
    SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END)::BIGINT,
    SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)::BIGINT,
    (SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - 
     SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END))::BIGINT,
    COUNT(CASE WHEN type = 'income' THEN 1 END)::INT,
    COUNT(CASE WHEN type = 'expense' THEN 1 END)::INT,
    (SELECT MAX(amount)::BIGINT FROM transactions 
     WHERE user_id = p_user_id 
     AND DATE(created_at) = p_date 
     AND type = 'expense')
  FROM transactions
  WHERE user_id = p_user_id
  AND DATE(created_at) = p_date;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION TO GET MONTHLY SUMMARY
-- ============================================
CREATE OR REPLACE FUNCTION get_monthly_summary(p_user_id UUID, p_year INT DEFAULT EXTRACT(YEAR FROM NOW())::INT, p_month INT DEFAULT EXTRACT(MONTH FROM NOW())::INT)
RETURNS TABLE (
  summary_month VARCHAR,
  total_income BIGINT,
  total_expenses BIGINT,
  monthly_balance BIGINT,
  expense_percentage NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    TO_CHAR(DATE_TRUNC('month', created_at), 'Month YYYY'),
    SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END)::BIGINT,
    SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)::BIGINT,
    (SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - 
     SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END))::BIGINT,
    ROUND((SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)::NUMERIC / 
           NULLIF(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END)::NUMERIC, 0)) * 100, 2)
  FROM transactions
  WHERE user_id = p_user_id
  AND EXTRACT(YEAR FROM created_at) = p_year
  AND EXTRACT(MONTH FROM created_at) = p_month
  GROUP BY DATE_TRUNC('month', created_at);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Enable Row Level Security (RLS)
-- ============================================
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies (if they don't exist)
-- ============================================
-- DROP POLICY IF EXISTS "Users can only view their own transactions" ON transactions;
-- CREATE POLICY "Users can only view their own transactions"
--   ON transactions FOR SELECT
--   USING (auth.uid() = user_id);

-- DROP POLICY IF EXISTS "Users can only insert their own transactions" ON transactions;
-- CREATE POLICY "Users can only insert their own transactions"
--   ON transactions FOR INSERT
--   WITH CHECK (auth.uid() = user_id);

-- DROP POLICY IF EXISTS "Users can only update their own transactions" ON transactions;
-- CREATE POLICY "Users can only update their own transactions"
--   ON transactions FOR UPDATE
--   USING (auth.uid() = user_id)
--   WITH CHECK (auth.uid() = user_id);

-- DROP POLICY IF EXISTS "Users can only delete their own transactions" ON transactions;
-- CREATE POLICY "Users can only delete their own transactions"
--   ON transactions FOR DELETE
--   USING (auth.uid() = user_id);

-- ============================================
-- TRIGGER FOR UPDATED_AT (if not exists)
-- ============================================
-- CREATE OR REPLACE FUNCTION update_updated_at_column()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     NEW.updated_at = NOW();
--     RETURN NEW;
-- END;
-- $$ language 'plpgsql';

-- DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
-- CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
--     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SETUP NOTES
-- ============================================
-- 1. Table already exists in Supabase
-- 2. Use ALTER TABLE statements above to add missing columns if needed
-- 3. All views are created for reporting (no data loss)
-- 4. Views support daily, weekly, and monthly reporting
-- 5. Functions provide quick daily and monthly summaries
-- 6. Indexes optimize query performance
-- 7. RLS ensures data privacy
-- 8. Run get_daily_report() for daily summary
-- 9. Run get_monthly_summary() for monthly analysis

