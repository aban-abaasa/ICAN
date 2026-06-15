-- ============================================
-- ICAN BRIDGE: Firebase (Transactions) → Supabase (Analytics)
-- ============================================
-- This syncs Firebase transactions to Supabase for NPV/IRR analysis
-- without modifying your existing Firebase data

-- ============================================
-- 1. SYNC TABLE - Mirrors Firebase transactions
-- ============================================
CREATE TABLE IF NOT EXISTS firebase_transactions_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_id TEXT UNIQUE NOT NULL,  -- References Firestore doc ID
  user_id TEXT NOT NULL,  -- Firebase userId
  
  -- Transaction data (mirrored from Firebase)
  amount BIGINT NOT NULL,
  type VARCHAR(50) NOT NULL,  -- 'income', 'expense', 'loan', 'investment'
  description TEXT,
  category VARCHAR(100),
  
  -- Project context
  project_name VARCHAR(255),
  project_term_months INT,
  expected_return_percent DECIMAL(5,2),
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  firebase_created_at TIMESTAMP,
  synced_at TIMESTAMP DEFAULT NOW(),
  
  -- Tracking
  confidence INTEGER DEFAULT 0,
  ai_insights JSONB
);

CREATE INDEX idx_firebase_sync_user ON firebase_transactions_sync(user_id);
CREATE INDEX idx_firebase_sync_created ON firebase_transactions_sync(user_id, created_at DESC);
CREATE INDEX idx_firebase_sync_type ON firebase_transactions_sync(user_id, type);

-- ============================================
-- 2. VITAL AGGREGATES VIEW
-- ============================================
CREATE OR REPLACE VIEW vital_aggregates AS
SELECT
  user_id,
  DATE_TRUNC('month', firebase_created_at)::DATE AS month,
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
  COUNT(CASE WHEN type = 'expense' THEN 1 END) AS expense_count,
  COUNT(CASE WHEN type = 'loan' THEN 1 END) AS loan_count,
  COUNT(CASE WHEN type = 'investment' THEN 1 END) AS investment_count,
  
  MAX(CASE WHEN type = 'income' THEN amount END) AS largest_income,
  MAX(CASE WHEN type = 'expense' THEN amount END) AS largest_expense
FROM firebase_transactions_sync
GROUP BY user_id, DATE_TRUNC('month', firebase_created_at);

-- ============================================
-- 3. CUMULATIVE NET WORTH VIEW
-- ============================================
CREATE OR REPLACE VIEW cumulative_net_worth AS
SELECT
  user_id,
  firebase_created_at::DATE AS transaction_date,
  amount,
  type,
  SUM(
    CASE 
      WHEN type = 'income' OR type = 'investment' THEN amount
      WHEN type = 'expense' OR type = 'loan' THEN -amount
      ELSE 0
    END
  ) OVER (PARTITION BY user_id ORDER BY firebase_created_at) AS cumulative_balance,
  
  SUM(
    CASE 
      WHEN type = 'income' OR type = 'investment' THEN amount
      WHEN type = 'expense' OR type = 'loan' THEN -amount
      ELSE 0
    END
  ) OVER (PARTITION BY user_id ORDER BY firebase_created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS net_worth
FROM firebase_transactions_sync
ORDER BY user_id, firebase_created_at;

-- ============================================
-- 4. PROJECT CASH FLOWS
-- ============================================
CREATE OR REPLACE VIEW project_cash_flows AS
SELECT
  user_id,
  project_name,
  type,
  SUM(amount) AS total_amount,
  COUNT(*) AS transaction_count,
  MAX(firebase_created_at) AS last_transaction,
  AVG(expected_return_percent) AS avg_expected_return,
  MAX(project_term_months) AS project_term_months
FROM firebase_transactions_sync
WHERE project_name IS NOT NULL
GROUP BY user_id, project_name, type;

-- ============================================
-- 5. NPV CALCULATION FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION calculate_npv(
  p_user_id TEXT,
  p_discount_rate DECIMAL DEFAULT 0.10
) RETURNS DECIMAL AS $$
DECLARE
  v_npv DECIMAL := 0;
  v_record RECORD;
BEGIN
  -- Income transactions (positive cash flow)
  FOR v_record IN
    SELECT 
      amount,
      firebase_created_at,
      EXTRACT(YEAR FROM AGE(firebase_created_at, NOW())) * 12 + 
      EXTRACT(MONTH FROM AGE(firebase_created_at, NOW())) AS months_ago
    FROM firebase_transactions_sync
    WHERE user_id = p_user_id AND type = 'income'
    ORDER BY firebase_created_at ASC
  LOOP
    v_npv := v_npv + (v_record.amount / POWER(1 + p_discount_rate, ABS(v_record.months_ago)::DECIMAL / 12));
  END LOOP;
  
  -- Expense transactions (negative cash flow)
  FOR v_record IN
    SELECT 
      amount,
      firebase_created_at,
      EXTRACT(YEAR FROM AGE(firebase_created_at, NOW())) * 12 + 
      EXTRACT(MONTH FROM AGE(firebase_created_at, NOW())) AS months_ago
    FROM firebase_transactions_sync
    WHERE user_id = p_user_id AND type = 'expense'
    ORDER BY firebase_created_at ASC
  LOOP
    v_npv := v_npv - (v_record.amount / POWER(1 + p_discount_rate, ABS(v_record.months_ago)::DECIMAL / 12));
  END LOOP;
  
  RETURN ROUND(v_npv::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. IRR CALCULATION FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION calculate_irr(
  p_user_id TEXT
) RETURNS DECIMAL AS $$
DECLARE
  v_irr DECIMAL := 0.10;
  v_npv DECIMAL;
  v_npv_derivative DECIMAL;
  v_iteration INT := 0;
  v_max_iterations INT := 100;
  v_tolerance DECIMAL := 0.0001;
  v_prev_irr DECIMAL;
BEGIN
  WHILE v_iteration < v_max_iterations LOOP
    SELECT calculate_npv(p_user_id, v_irr) INTO v_npv;
    SELECT calculate_npv(p_user_id, v_irr + 0.0001) INTO v_npv_derivative;
    v_npv_derivative := (v_npv_derivative - v_npv) / 0.0001;
    
    v_prev_irr := v_irr;
    
    IF ABS(v_npv_derivative) > 0.01 THEN
      v_irr := v_irr - (v_npv / v_npv_derivative);
    END IF;
    
    v_irr := GREATEST(-0.5, LEAST(5.0, v_irr));
    
    IF ABS(v_irr - v_prev_irr) < v_tolerance THEN
      EXIT;
    END IF;
    
    v_iteration := v_iteration + 1;
  END LOOP;
  
  RETURN ROUND((v_irr * 100)::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. QUICK STATS VIEW
-- ============================================
CREATE OR REPLACE VIEW quick_stats AS
SELECT
  user_id,
  COUNT(*) AS total_transactions,
  COUNT(CASE WHEN type = 'income' THEN 1 END) AS income_count,
  COUNT(CASE WHEN type = 'expense' THEN 1 END) AS expense_count,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS total_income,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS total_expense,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - 
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS net_total,
  MAX(firebase_created_at) AS last_transaction,
  MIN(firebase_created_at) AS first_transaction
FROM firebase_transactions_sync
GROUP BY user_id;

-- ============================================
-- 8. FUNCTION: Sync Firebase Transaction to Supabase
-- ============================================
-- Call this from your React app to sync a transaction
CREATE OR REPLACE FUNCTION sync_firebase_transaction(
  p_firebase_id TEXT,
  p_user_id TEXT,
  p_amount BIGINT,
  p_type VARCHAR,
  p_description TEXT DEFAULT NULL,
  p_category VARCHAR DEFAULT NULL,
  p_project_name VARCHAR DEFAULT NULL,
  p_term_months INT DEFAULT NULL,
  p_expected_return DECIMAL DEFAULT NULL,
  p_confidence INT DEFAULT 0,
  p_firebase_created_at TIMESTAMP DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO firebase_transactions_sync (
    firebase_id, user_id, amount, type, description, category,
    project_name, project_term_months, expected_return_percent,
    confidence, firebase_created_at, synced_at
  ) VALUES (
    p_firebase_id, p_user_id, p_amount, p_type, p_description, p_category,
    p_project_name, p_term_months, p_expected_return,
    p_confidence, COALESCE(p_firebase_created_at, NOW()), NOW()
  )
  ON CONFLICT(firebase_id) DO UPDATE SET
    synced_at = NOW(),
    confidence = EXCLUDED.confidence
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. USAGE EXAMPLES
-- ============================================
/*
-- View vital aggregates
SELECT * FROM vital_aggregates WHERE user_id = 'your_firebase_user_id' ORDER BY month DESC;

-- Calculate NPV
SELECT calculate_npv('your_firebase_user_id', 0.10) AS npv_at_10_percent;

-- Calculate IRR
SELECT calculate_irr('your_firebase_user_id') AS irr_percent;

-- Get quick stats
SELECT * FROM quick_stats WHERE user_id = 'your_firebase_user_id';

-- Sync a transaction from Firebase to Supabase
SELECT sync_firebase_transaction(
  'firebase_doc_id',
  'firebase_user_id',
  5000000,
  'investment',
  'Business expansion',
  'Business',
  'Coffee Shop',
  36,
  20.0,
  85,
  NOW()
);
*/

-- ============================================
-- HOW TO INTEGRATE
-- ============================================
-- In your React code, after saving to Firebase:
-- 
-- // 1. Save to Firebase (existing code)
-- const result = await addTransaction(userId, transactionData);
-- 
-- // 2. Also sync to Supabase for analytics
-- const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
-- await supabase.rpc('sync_firebase_transaction', {
--   p_firebase_id: result.id,
--   p_user_id: userId,
--   p_amount: transactionData.amount,
--   p_type: transactionData.type,
--   p_description: transactionData.description,
--   p_category: transactionData.category,
--   p_project_name: transactionData.projectName,
--   p_term_months: transactionData.termMonths,
--   p_expected_return: transactionData.expectedReturn,
--   p_confidence: transactionData.confidence,
--   p_firebase_created_at: transactionData.createdAt
-- });
