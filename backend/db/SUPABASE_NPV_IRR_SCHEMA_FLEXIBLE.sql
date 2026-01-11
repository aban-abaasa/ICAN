-- ============================================
-- SIMPLIFIED NPV/IRR SCHEMA - Works with Existing Tables
-- Firebase for AI, Supabase for Transaction Tables
-- ============================================

-- This version assumes you have a basic transactions table
-- and adds views/functions without modifying your existing data

-- ============================================
-- STEP 1: Identify your actual table structure
-- ============================================
-- First, run the SUPABASE_DIAGNOSTIC.sql to see what columns you have
-- Then uncomment the appropriate version below:

-- OPTION A: If your table has these columns:
--   id, user_id, amount, type, created_at
-- Then use NPV_IRR_SCHEMA_V1 below

-- OPTION B: If your table doesn't have user_id, use Firebase auth
--   id, amount, type, created_at
-- Then use NPV_IRR_SCHEMA_V2 below

-- OPTION C: If you have completely different columns
-- Run the diagnostic and share results

-- ============================================
-- VERSION 1: Works with user_id column
-- ============================================
-- Uncomment this block if your table HAS user_id

/*
CREATE OR REPLACE VIEW vital_aggregates_v1 AS
SELECT
  user_id,
  DATE_TRUNC('month', created_at)::DATE AS month,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS monthly_income,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS monthly_expense,
  SUM(CASE WHEN type = 'income' THEN amount WHEN type = 'expense' THEN -amount ELSE 0 END) AS monthly_net,
  ROUND(
    CASE 
      WHEN SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) > 0
      THEN (SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)) * 100.0 / SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END)
      ELSE 0
    END, 2
  ) AS savings_rate_percent,
  COUNT(*) AS total_transactions
FROM transactions
GROUP BY user_id, DATE_TRUNC('month', created_at);

CREATE OR REPLACE FUNCTION calculate_npv_v1(
  p_user_id UUID,
  p_type VARCHAR,
  p_discount_rate DECIMAL DEFAULT 0.10
) RETURNS DECIMAL AS $$
DECLARE
  v_npv DECIMAL := 0;
BEGIN
  SELECT COALESCE(SUM(
    amount / POWER(1.10, EXTRACT(EPOCH FROM (created_at - NOW())) / (86400 * 365))
  ), 0) INTO v_npv
  FROM transactions
  WHERE user_id = p_user_id AND type = p_type;
  
  RETURN ROUND(v_npv::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql;
*/

-- ============================================
-- VERSION 2: Works WITHOUT user_id (use Firebase auth)
-- ============================================
-- Uncomment this block if your table DOESN'T have user_id

/*
CREATE OR REPLACE VIEW vital_aggregates_v2 AS
SELECT
  DATE_TRUNC('month', created_at)::DATE AS month,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS monthly_income,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS monthly_expense,
  SUM(CASE WHEN type = 'income' THEN amount WHEN type = 'expense' THEN -amount ELSE 0 END) AS monthly_net,
  ROUND(
    CASE 
      WHEN SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) > 0
      THEN (SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)) * 100.0 / SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END)
      ELSE 0
    END, 2
  ) AS savings_rate_percent,
  COUNT(*) AS total_transactions,
  COUNT(CASE WHEN type = 'income' THEN 1 END) AS income_count,
  COUNT(CASE WHEN type = 'expense' THEN 1 END) AS expense_count
FROM transactions
GROUP BY DATE_TRUNC('month', created_at);

CREATE OR REPLACE VIEW cumulative_net_worth_v2 AS
SELECT
  created_at::DATE AS transaction_date,
  amount,
  type,
  SUM(
    CASE 
      WHEN type = 'income' THEN amount
      WHEN type = 'expense' THEN -amount
      ELSE 0
    END
  ) OVER (ORDER BY created_at) AS cumulative_balance,
  SUM(
    CASE 
      WHEN type = 'income' THEN amount
      WHEN type = 'expense' THEN -amount
      ELSE 0
    END
  ) OVER (ORDER BY created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS net_worth
FROM transactions
ORDER BY created_at;
*/

-- ============================================
-- UNIVERSAL NPV CALCULATION (Works anywhere)
-- ============================================
-- This function works regardless of table structure
-- Just needs: amount, created_at columns

CREATE OR REPLACE FUNCTION calculate_npv_universal(
  p_discount_rate DECIMAL DEFAULT 0.10
) RETURNS DECIMAL AS $$
DECLARE
  v_npv DECIMAL := 0;
  v_record RECORD;
BEGIN
  -- Calculate NPV for all income transactions
  FOR v_record IN
    SELECT 
      amount,
      created_at,
      EXTRACT(YEAR FROM AGE(created_at, NOW())) * 12 + 
      EXTRACT(MONTH FROM AGE(created_at, NOW())) AS months_ago
    FROM transactions
    WHERE type = 'income'
    ORDER BY created_at ASC
  LOOP
    v_npv := v_npv + (v_record.amount / POWER(1 + p_discount_rate, v_record.months_ago::DECIMAL / 12));
  END LOOP;
  
  -- Subtract expenses
  FOR v_record IN
    SELECT 
      amount,
      created_at,
      EXTRACT(YEAR FROM AGE(created_at, NOW())) * 12 + 
      EXTRACT(MONTH FROM AGE(created_at, NOW())) AS months_ago
    FROM transactions
    WHERE type = 'expense'
    ORDER BY created_at ASC
  LOOP
    v_npv := v_npv - (v_record.amount / POWER(1 + p_discount_rate, v_record.months_ago::DECIMAL / 12));
  END LOOP;
  
  RETURN ROUND(v_npv::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- QUICK STATS VIEW (Universal - works with any table)
-- ============================================
CREATE OR REPLACE VIEW quick_stats AS
SELECT
  COUNT(*) AS total_transactions,
  COUNT(CASE WHEN type = 'income' THEN 1 END) AS income_count,
  COUNT(CASE WHEN type = 'expense' THEN 1 END) AS expense_count,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS total_income,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS total_expense,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - 
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS net_total,
  MAX(created_at) AS last_transaction,
  MIN(created_at) AS first_transaction
FROM transactions;

-- ============================================
-- Test the views
-- ============================================
-- SELECT * FROM quick_stats;
-- SELECT calculate_npv_universal(0.10) AS npv_at_10_percent;

