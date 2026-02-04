-- ============================================
-- ICAN Capital Engine - NPV/IRR & Aggregates Schema
-- Firebase for AI, Supabase for Transaction Tables
-- ============================================

-- ============================================
-- 1. TRANSACTIONS TABLE (Core)
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Core transaction fields
  amount BIGINT NOT NULL,  -- Support for massive numbers
  type VARCHAR(50) NOT NULL,  -- 'income', 'expense', 'loan', 'investment'
  category VARCHAR(100),  -- Business, Personal, Investment, etc.
  description TEXT,  -- Full transaction description
  
  -- Context fields
  location VARCHAR(255),
  payment_method VARCHAR(50),  -- 'cash', 'card', 'mobile_money'
  
  -- Project/Opportunity context
  project_name VARCHAR(255),  -- If linked to opportunity
  project_term_months INT,  -- Duration if investment/loan
  expected_return_percent DECIMAL(5,2),  -- Expected ROI if investment
  
  -- AI Analysis (from Firebase)
  confidence INTEGER DEFAULT 0,
  ai_insights JSONB,  -- Firebase AI analysis stored here
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Indexing for performance
  UNIQUE(id, user_id)
);

CREATE INDEX idx_transactions_user_created ON transactions(user_id, created_at DESC);
CREATE INDEX idx_transactions_type ON transactions(user_id, type, created_at DESC);
CREATE INDEX idx_transactions_project ON transactions(user_id, project_name) WHERE project_name IS NOT NULL;

-- ============================================
-- 2. VITAL AGGREGATES VIEW
-- ============================================
CREATE OR REPLACE VIEW vital_aggregates AS
SELECT
  user_id,
  -- Monthly summaries
  DATE_TRUNC('month', created_at)::DATE AS month,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS monthly_income,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS monthly_expense,
  SUM(CASE WHEN type = 'income' THEN amount WHEN type = 'expense' THEN -amount ELSE 0 END) AS monthly_net,
  
  -- Savings metrics
  ROUND(
    CASE 
      WHEN SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) > 0
      THEN (SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)) * 100.0 / SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END)
      ELSE 0
    END, 2
  ) AS savings_rate_percent,
  
  -- Transaction counts
  COUNT(*) AS total_transactions,
  COUNT(CASE WHEN type = 'income' THEN 1 END) AS income_count,
  COUNT(CASE WHEN type = 'expense' THEN 1 END) AS expense_count,
  COUNT(CASE WHEN type = 'loan' THEN 1 END) AS loan_count,
  COUNT(CASE WHEN type = 'investment' THEN 1 END) AS investment_count,
  
  -- Largest transactions
  MAX(CASE WHEN type = 'income' THEN amount END) AS largest_income,
  MAX(CASE WHEN type = 'expense' THEN amount END) AS largest_expense,
  MAX(CASE WHEN type = 'loan' THEN amount END) AS largest_loan,
  MAX(CASE WHEN type = 'investment' THEN amount END) AS largest_investment
FROM transactions
GROUP BY user_id, DATE_TRUNC('month', created_at);

-- ============================================
-- 3. NET WORTH TRACKING WITH CUMULATIVE
-- ============================================
CREATE OR REPLACE VIEW cumulative_net_worth AS
SELECT
  user_id,
  created_at::DATE AS transaction_date,
  amount,
  type,
  SUM(
    CASE 
      WHEN type = 'income' OR type = 'investment' THEN amount
      WHEN type = 'expense' OR type = 'loan' THEN -amount
      ELSE 0
    END
  ) OVER (PARTITION BY user_id ORDER BY created_at) AS cumulative_balance,
  
  -- Running daily balance
  SUM(
    CASE 
      WHEN type = 'income' OR type = 'investment' THEN amount
      WHEN type = 'expense' OR type = 'loan' THEN -amount
      ELSE 0
    END
  ) OVER (PARTITION BY user_id ORDER BY created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS net_worth
FROM transactions
ORDER BY user_id, created_at;

-- ============================================
-- 4. PROJECT-SPECIFIC CASH FLOW
-- ============================================
CREATE OR REPLACE VIEW project_cash_flows AS
SELECT
  user_id,
  project_name,
  type,
  SUM(amount) AS total_amount,
  COUNT(*) AS transaction_count,
  MAX(created_at) AS last_transaction,
  AVG(expected_return_percent) AS avg_expected_return,
  MAX(project_term_months) AS project_term_months,
  
  -- Cash flow timeline
  ARRAY_AGG(
    JSON_BUILD_OBJECT(
      'date', created_at::DATE,
      'amount', amount,
      'type', type,
      'return_pct', expected_return_percent
    ) ORDER BY created_at
  ) AS cash_flows
FROM transactions
WHERE project_name IS NOT NULL
GROUP BY user_id, project_name, type
ORDER BY user_id, project_name;

-- ============================================
-- 5. INVESTMENT OPPORTUNITY SCORING
-- ============================================
CREATE OR REPLACE VIEW investment_opportunities AS
SELECT
  user_id,
  project_name,
  type,
  COUNT(*) AS transactions,
  SUM(amount) AS total_invested,
  AVG(expected_return_percent) AS projected_return_percent,
  MAX(project_term_months) AS investment_term,
  
  -- Opportunity score (0-100)
  ROUND(
    LEAST(100, 
      (CASE WHEN AVG(expected_return_percent) IS NOT NULL THEN AVG(expected_return_percent) ELSE 0 END) +
      (CASE WHEN MAX(project_term_months) IS NOT NULL THEN LEAST(50, MAX(project_term_months) / 2) ELSE 0 END)
    )
  ) AS opportunity_score,
  
  MIN(created_at) AS first_transaction,
  MAX(created_at) AS last_transaction
FROM transactions
WHERE type IN ('investment', 'loan') AND project_name IS NOT NULL
GROUP BY user_id, project_name, type;

-- ============================================
-- 6. SPENDING PATTERNS & INSIGHTS
-- ============================================
CREATE OR REPLACE VIEW spending_patterns AS
SELECT
  user_id,
  EXTRACT(MONTH FROM created_at) AS month,
  EXTRACT(DOW FROM created_at) AS day_of_week,
  type,
  category,
  COUNT(*) AS frequency,
  AVG(amount) AS avg_transaction,
  SUM(amount) AS total_amount,
  
  -- Moving average (30 days)
  AVG(amount) OVER (
    PARTITION BY user_id, type, category 
    ORDER BY created_at 
    ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
  ) AS moving_avg_30d
FROM transactions
GROUP BY user_id, month, day_of_week, type, category, created_at
ORDER BY user_id, created_at DESC;

-- ============================================
-- 7. NPV CALCULATION FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION calculate_npv(
  p_user_id UUID,
  p_project_name VARCHAR,
  p_discount_rate DECIMAL DEFAULT 0.10
) RETURNS DECIMAL AS $$
DECLARE
  v_npv DECIMAL := 0;
  v_cash_flow RECORD;
  v_initial_investment DECIMAL := 0;
  v_periods_count INT := 0;
BEGIN
  -- Get all cash flows for this project
  FOR v_cash_flow IN
    SELECT 
      created_at::DATE,
      amount,
      type,
      EXTRACT(YEAR FROM AGE(created_at, (
        SELECT MIN(created_at) FROM transactions 
        WHERE user_id = p_user_id AND project_name = p_project_name
      ))) * 12 + EXTRACT(MONTH FROM AGE(created_at, (
        SELECT MIN(created_at) FROM transactions 
        WHERE user_id = p_user_id AND project_name = p_project_name
      ))) AS months_from_start
    FROM transactions
    WHERE user_id = p_user_id 
      AND project_name = p_project_name
    ORDER BY created_at ASC
  LOOP
    -- Treat first investment as time 0
    IF v_periods_count = 0 THEN
      v_initial_investment := v_cash_flow.amount;
      v_npv := -v_initial_investment;
    ELSE
      -- PV = Cash Flow / (1 + rate)^periods
      v_npv := v_npv + (v_cash_flow.amount / POWER(1 + p_discount_rate, v_cash_flow.months_from_start::DECIMAL / 12));
    END IF;
    
    v_periods_count := v_periods_count + 1;
  END LOOP;
  
  RETURN ROUND(v_npv::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 8. IRR ESTIMATION FUNCTION (Newton-Raphson)
-- ============================================
CREATE OR REPLACE FUNCTION calculate_irr(
  p_user_id UUID,
  p_project_name VARCHAR
) RETURNS DECIMAL AS $$
DECLARE
  v_irr DECIMAL := 0.10;  -- Initial guess: 10%
  v_npv DECIMAL;
  v_npv_derivative DECIMAL;
  v_iteration INT := 0;
  v_max_iterations INT := 100;
  v_tolerance DECIMAL := 0.0001;
  v_prev_irr DECIMAL;
  v_rate_adj DECIMAL;
BEGIN
  -- Newton-Raphson iteration to find IRR
  WHILE v_iteration < v_max_iterations LOOP
    -- Calculate NPV at current rate
    SELECT calculate_npv(p_user_id, p_project_name, v_irr) INTO v_npv;
    
    -- Calculate NPV at slightly higher rate for derivative approximation
    SELECT calculate_npv(p_user_id, p_project_name, v_irr + 0.0001) INTO v_npv_derivative;
    v_npv_derivative := (v_npv_derivative - v_npv) / 0.0001;
    
    v_prev_irr := v_irr;
    
    -- Newton-Raphson: x_new = x - f(x) / f'(x)
    IF ABS(v_npv_derivative) > 0.01 THEN
      v_irr := v_irr - (v_npv / v_npv_derivative);
    END IF;
    
    -- Clamp to reasonable range (-0.5 to 5.0 or -50% to 500%)
    v_irr := GREATEST(-0.5, LEAST(5.0, v_irr));
    
    -- Check convergence
    IF ABS(v_irr - v_prev_irr) < v_tolerance THEN
      EXIT;
    END IF;
    
    v_iteration := v_iteration + 1;
  END LOOP;
  
  -- Return as percentage (convert decimal to percentage)
  RETURN ROUND((v_irr * 100)::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. OPPORTUNITY RATING FUNCTION
-- Integrates all metrics for Smart Transaction Entry
-- ============================================
CREATE OR REPLACE FUNCTION get_opportunity_rating(p_user_id UUID)
RETURNS TABLE(
  metric_name VARCHAR,
  metric_value DECIMAL,
  metric_category VARCHAR,
  insight TEXT,
  urgency VARCHAR
) AS $$
BEGIN
  -- Monthly savings rate
  RETURN QUERY
  SELECT 
    'Savings Rate'::VARCHAR,
    COALESCE((
      SELECT savings_rate_percent FROM vital_aggregates 
      WHERE user_id = p_user_id 
      ORDER BY month DESC LIMIT 1
    ), 0)::DECIMAL,
    'Financial Health'::VARCHAR,
    CASE 
      WHEN COALESCE((SELECT savings_rate_percent FROM vital_aggregates WHERE user_id = p_user_id ORDER BY month DESC LIMIT 1), 0) > 30
        THEN 'Excellent savings discipline'
      WHEN COALESCE((SELECT savings_rate_percent FROM vital_aggregates WHERE user_id = p_user_id ORDER BY month DESC LIMIT 1), 0) > 20
        THEN 'Good savings rate for investments'
      ELSE 'Focus on increasing savings'
    END,
    CASE 
      WHEN COALESCE((SELECT savings_rate_percent FROM vital_aggregates WHERE user_id = p_user_id ORDER BY month DESC LIMIT 1), 0) < 10
        THEN 'CRITICAL'
      WHEN COALESCE((SELECT savings_rate_percent FROM vital_aggregates WHERE user_id = p_user_id ORDER BY month DESC LIMIT 1), 0) < 20
        THEN 'HIGH'
      ELSE 'LOW'
    END;
  
  -- Monthly net income
  RETURN QUERY
  SELECT 
    'Monthly Net'::VARCHAR,
    COALESCE((
      SELECT monthly_net FROM vital_aggregates 
      WHERE user_id = p_user_id 
      ORDER BY month DESC LIMIT 1
    ), 0)::DECIMAL,
    'Cash Flow'::VARCHAR,
    'Net income = Income - Expenses',
    'INFO'::VARCHAR;
  
  -- Net worth trajectory
  RETURN QUERY
  SELECT 
    'Current Net Worth'::VARCHAR,
    COALESCE((
      SELECT net_worth FROM cumulative_net_worth 
      WHERE user_id = p_user_id 
      ORDER BY transaction_date DESC LIMIT 1
    ), 0)::DECIMAL,
    'Wealth'::VARCHAR,
    'Cumulative net position from all transactions',
    'INFO'::VARCHAR;
  
  -- Average transaction value trend
  RETURN QUERY
  SELECT 
    'Avg Transaction Size'::VARCHAR,
    COALESCE((
      SELECT AVG(amount) FROM transactions 
      WHERE user_id = p_user_id
    ), 0)::DECIMAL,
    'Scale'::VARCHAR,
    'Transaction size indicates capacity',
    'INFO'::VARCHAR;
  
  -- Active projects/investments
  RETURN QUERY
  SELECT 
    'Active Opportunities'::VARCHAR,
    (SELECT COUNT(*) FROM investment_opportunities WHERE user_id = p_user_id)::DECIMAL,
    'Opportunities'::VARCHAR,
    'Number of tracked investment/loan projects',
    'INFO'::VARCHAR;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 10. SMART TRANSACTION INSIGHTS
-- Triggered by Smart Transaction Entry
-- ============================================
CREATE OR REPLACE FUNCTION analyze_transaction_opportunity(
  p_user_id UUID,
  p_amount BIGINT,
  p_type VARCHAR,
  p_project_name VARCHAR DEFAULT NULL,
  p_expected_return DECIMAL DEFAULT NULL,
  p_term_months INT DEFAULT NULL
)
RETURNS TABLE(
  npv DECIMAL,
  irr DECIMAL,
  recommendation VARCHAR,
  confidence_score INT,
  financial_impact TEXT,
  next_steps TEXT[]
) AS $$
DECLARE
  v_current_savings_rate DECIMAL;
  v_monthly_net DECIMAL;
  v_npv DECIMAL;
  v_irr DECIMAL;
  v_confidence INT := 50;
  v_recommendation VARCHAR;
  v_impact TEXT;
  v_steps TEXT[];
BEGIN
  -- Get current financial health
  SELECT savings_rate_percent, monthly_net INTO v_current_savings_rate, v_monthly_net
  FROM vital_aggregates
  WHERE user_id = p_user_id
  ORDER BY month DESC LIMIT 1;
  
  v_current_savings_rate := COALESCE(v_current_savings_rate, 0);
  v_monthly_net := COALESCE(v_monthly_net, 0);
  
  -- For loans/investments, calculate NPV and IRR
  IF p_project_name IS NOT NULL AND p_type IN ('investment', 'loan') THEN
    SELECT calculate_npv(p_user_id, p_project_name, 0.10) INTO v_npv;
    SELECT calculate_irr(p_user_id, p_project_name) INTO v_irr;
    
    -- Confidence based on savings rate and NPV
    v_confidence := LEAST(100, 
      GREATEST(20,
        (CASE WHEN v_current_savings_rate > 20 THEN 30 ELSE 15 END) +
        (CASE WHEN v_npv > 0 THEN 50 ELSE 20 END) +
        (CASE WHEN p_expected_return > 15 THEN 20 ELSE 10 END)
      )
    );
  ELSE
    v_npv := 0;
    v_irr := 0;
  END IF;
  
  -- Generate recommendation
  IF p_type = 'investment' THEN
    IF v_npv > 0 AND v_current_savings_rate > 20 THEN
      v_recommendation := 'STRONG BUY - Positive NPV and healthy savings rate';
      v_confidence := LEAST(100, v_confidence + 20);
    ELSIF v_npv > 0 THEN
      v_recommendation := 'CONSIDER - Positive NPV but build savings first';
      v_confidence := GREATEST(40, v_confidence);
    ELSE
      v_recommendation := 'HOLD - Negative NPV, seek better opportunities';
      v_confidence := LEAST(50, v_confidence);
    END IF;
    
    v_impact := 'Investment of ' || p_amount || ' UGX with expected return ' || COALESCE(p_expected_return, 0) || '% over ' || COALESCE(p_term_months, 12) || ' months';
    v_steps := ARRAY[
      'Allocate ' || (p_amount / 1000000) || 'M from savings',
      'Track monthly returns in Smart Transaction Entry',
      'Compare actual vs expected returns at midpoint',
      'Rebalance if returns underperform'
    ];
  
  ELSIF p_type = 'loan' THEN
    v_recommendation := 'Loan of ' || p_amount || ' UGX - Repay at ' || (p_amount / NULLIF(p_term_months, 0))::BIGINT || ' UGX/month';
    v_impact := 'Debt obligation: ' || (p_amount / NULLIF(p_term_months, 0))::BIGINT || ' UGX monthly for ' || p_term_months || ' months';
    v_steps := ARRAY[
      'Set up automatic payments of ' || (p_amount / NULLIF(p_term_months, 0))::BIGINT || ' UGX',
      'Schedule in human capital optimization',
      'Monitor cash flow impact'
    ];
  
  ELSIF p_type = 'income' THEN
    v_confidence := LEAST(100, v_confidence + 20);
    v_recommendation := 'Income recorded - Allocate ' || LEAST(p_amount / 3, v_monthly_net / 2) || ' UGX to savings goal';
    v_impact := 'Positive cash inflow adds to investable capital';
    v_steps := ARRAY[
      'Confirm income amount: ' || p_amount || ' UGX',
      'Update monthly net worth tracking',
      'Calculate new opportunity capacity'
    ];
  
  ELSIF p_type = 'expense' THEN
    v_recommendation := 'Expense of ' || p_amount || ' UGX recorded - Evaluate necessity for savings goals';
    v_impact := 'Reduces net cash available for investments';
    v_steps := ARRAY[
      'Categorize: ' || p_project_name || '',
      'Check if aligns with budget',
      'Consider if can be deferred'
    ];
  END IF;
  
  RETURN QUERY
  SELECT 
    v_npv,
    v_irr,
    v_recommendation,
    v_confidence,
    v_impact,
    v_steps;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 11. INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_vital_agg_user_month ON transactions(user_id, DATE_TRUNC('month', created_at));
CREATE INDEX IF NOT EXISTS idx_cumulative_user_date ON transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_flows ON transactions(user_id, project_name, created_at);

-- ============================================
-- USAGE EXAMPLES
-- ============================================
/*
-- Get vital aggregates for a user
SELECT * FROM vital_aggregates WHERE user_id = 'user-uuid' ORDER BY month DESC;

-- Calculate NPV for a project at 10% discount rate
SELECT calculate_npv('user-uuid', 'Business Expansion', 0.10) AS npv;

-- Calculate IRR for a project
SELECT calculate_irr('user-uuid', 'Business Expansion') AS irr_percent;

-- Get opportunity rating
SELECT * FROM get_opportunity_rating('user-uuid');

-- Analyze a new transaction opportunity
SELECT * FROM analyze_transaction_opportunity(
  'user-uuid',
  5000000,  -- 5M UGX
  'investment',
  'Smart Property Investment',
  20.0,  -- 20% expected return
  36  -- 3 years
);

-- Get investment opportunities
SELECT * FROM investment_opportunities WHERE user_id = 'user-uuid';

-- Track spending patterns
SELECT * FROM spending_patterns WHERE user_id = 'user-uuid' LIMIT 30;
*/
