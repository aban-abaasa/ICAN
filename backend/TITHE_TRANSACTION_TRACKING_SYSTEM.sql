-- ============================================================
-- TITHE TRANSACTION TRACKING SYSTEM
-- Complete fix for recurring tithe errors with proper transaction linking
-- ============================================================

-- ============================================================
-- SECTION 1: ENHANCED TITHE TRACKING TABLE
-- ============================================================
-- Tracks tithe accumulation with proper Business/Personal separation
-- and links to specific transactions

CREATE TABLE IF NOT EXISTS tithe_transaction_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Transaction Reference
  source_transaction_id UUID REFERENCES ican_transactions(id) ON DELETE SET NULL,
  
  -- Tithe Details
  tithe_type VARCHAR(20) NOT NULL CHECK (tithe_type IN ('personal', 'business', 'combined')),
  source_amount DECIMAL(15,2) NOT NULL, -- Original transaction amount
  tithe_calculated DECIMAL(15,2) NOT NULL, -- Calculated tithe from source
  tithe_percentage DECIMAL(5,2) NOT NULL DEFAULT 10.0,
  
  -- Tithe Payment Status
  tithe_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (tithe_status IN ('pending', 'paid', 'partially_paid', 'cancelled')),
  amount_paid DECIMAL(15,2) DEFAULT 0, -- How much was actually paid
  amount_remaining DECIMAL(15,2) GENERATED ALWAYS AS (tithe_calculated - COALESCE(amount_paid, 0)) STORED,
  
  -- Payment Tracking
  payment_transaction_id UUID REFERENCES ican_transactions(id) ON DELETE SET NULL, -- The tithe payment transaction
  paid_date TIMESTAMP,
  
  -- Metadata
  transaction_description TEXT, -- Description of source transaction
  transaction_source VARCHAR(50), -- 'income', 'sale', 'gift', 'investment_return', etc
  recipient_name VARCHAR(255),
  notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(user_id, source_transaction_id, tithe_type),
  CONSTRAINT tithe_amount_valid CHECK (tithe_calculated > 0),
  CONSTRAINT payment_not_exceeds_tithe CHECK (amount_paid <= tithe_calculated)
);

-- ============================================================
-- SECTION 2: IMPROVED USER TITHE SUMMARY TABLE
-- ============================================================
-- Real-time summary of what each user owes, organized by type

CREATE TABLE IF NOT EXISTS user_tithe_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Personal Tithe
  personal_tithe_total DECIMAL(15,2) DEFAULT 0, -- Total personal tithe owed
  personal_tithe_paid DECIMAL(15,2) DEFAULT 0, -- Total personal tithe paid
  personal_tithe_remaining DECIMAL(15,2) GENERATED ALWAYS AS (personal_tithe_total - COALESCE(personal_tithe_paid, 0)) STORED,
  personal_pending_count INT DEFAULT 0, -- Number of pending personal tithes
  
  -- Business Tithe
  business_tithe_total DECIMAL(15,2) DEFAULT 0, -- Total business tithe owed
  business_tithe_paid DECIMAL(15,2) DEFAULT 0, -- Total business tithe paid
  business_tithe_remaining DECIMAL(15,2) GENERATED ALWAYS AS (business_tithe_total - COALESCE(business_tithe_paid, 0)) STORED,
  business_pending_count INT DEFAULT 0, -- Number of pending business tithes
  
  -- Combined Summary
  combined_tithe_total DECIMAL(15,2) GENERATED ALWAYS AS (personal_tithe_total + business_tithe_total) STORED,
  combined_tithe_paid DECIMAL(15,2) GENERATED ALWAYS AS (COALESCE(personal_tithe_paid, 0) + COALESCE(business_tithe_paid, 0)) STORED,
  combined_tithe_remaining DECIMAL(15,2) GENERATED ALWAYS AS ((personal_tithe_total + business_tithe_total) - (COALESCE(personal_tithe_paid, 0) + COALESCE(business_tithe_paid, 0))) STORED,
  
  -- Payment Tracking
  last_personal_payment_date TIMESTAMP,
  last_business_payment_date TIMESTAMP,
  last_payment_date TIMESTAMP GENERATED ALWAYS AS (GREATEST(last_personal_payment_date, last_business_payment_date)) STORED,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- SECTION 3: FUNCTION - RECORD TITHE FROM TRANSACTION
-- ============================================================
-- Automatically calculates and records tithe when a transaction is recorded

CREATE OR REPLACE FUNCTION fn_record_tithe_from_transaction(
  p_transaction_id UUID,
  p_tithe_type VARCHAR DEFAULT 'personal',
  p_tithe_percentage DECIMAL DEFAULT 10.0,
  p_recipient_name VARCHAR DEFAULT 'Church'
)
RETURNS TABLE (
  success BOOLEAN,
  tithe_record_id UUID,
  message VARCHAR,
  tithe_calculated DECIMAL
) AS $$
DECLARE
  v_user_id UUID;
  v_amount DECIMAL;
  v_tithe_amount DECIMAL;
  v_record_id UUID;
  v_description TEXT;
  v_transaction_type VARCHAR;
BEGIN
  -- Get transaction details
  SELECT user_id, amount, description, transaction_type
  INTO v_user_id, v_amount, v_description, v_transaction_type
  FROM ican_transactions
  WHERE id = p_transaction_id;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Transaction not found'::VARCHAR, NULL::DECIMAL;
    RETURN;
  END IF;

  -- Skip if transaction is a tithe payment itself (avoid recursion)
  IF v_transaction_type = 'tithe' THEN
    RETURN QUERY SELECT TRUE, NULL::UUID, 'Skipped: Transaction is already a tithe payment'::VARCHAR, NULL::DECIMAL;
    RETURN;
  END IF;

  -- Calculate tithe
  v_tithe_amount := ROUND(v_amount * (p_tithe_percentage / 100), 2);

  -- Insert tithe record
  INSERT INTO tithe_transaction_records (
    user_id,
    source_transaction_id,
    tithe_type,
    source_amount,
    tithe_calculated,
    tithe_percentage,
    tithe_status,
    transaction_description,
    transaction_source,
    recipient_name,
    created_at,
    updated_at
  )
  VALUES (
    v_user_id,
    p_transaction_id,
    p_tithe_type,
    v_amount,
    v_tithe_amount,
    p_tithe_percentage,
    'pending',
    v_description,
    COALESCE((SELECT metadata->>'transaction_type' FROM ican_transactions WHERE id = p_transaction_id), 'income'),
    p_recipient_name,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id, source_transaction_id, tithe_type) DO UPDATE SET
    updated_at = NOW()
  RETURNING tithe_transaction_records.id INTO v_record_id;

  -- Update user summary
  PERFORM fn_update_tithe_summary(v_user_id);

  RETURN QUERY SELECT TRUE, v_record_id, 'Tithe recorded successfully'::VARCHAR, v_tithe_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SECTION 4: FUNCTION - UPDATE TITHE SUMMARY
-- ============================================================
-- Recalculates tithe totals from all transactions

CREATE OR REPLACE FUNCTION fn_update_tithe_summary(p_user_id UUID)
RETURNS TABLE (
  success BOOLEAN,
  personal_total DECIMAL,
  business_total DECIMAL,
  personal_remaining DECIMAL,
  business_remaining DECIMAL
) AS $$
DECLARE
  v_personal_total DECIMAL;
  v_business_total DECIMAL;
  v_personal_paid DECIMAL;
  v_business_paid DECIMAL;
  v_personal_count INT;
  v_business_count INT;
BEGIN
  -- Calculate personal tithe totals
  SELECT 
    COALESCE(SUM(tithe_calculated), 0),
    COALESCE(SUM(amount_paid), 0),
    COALESCE(COUNT(*), 0)
  INTO v_personal_total, v_personal_paid, v_personal_count
  FROM tithe_transaction_records
  WHERE user_id = p_user_id AND tithe_type = 'personal' AND tithe_status IN ('pending', 'partially_paid');

  -- Calculate business tithe totals
  SELECT 
    COALESCE(SUM(tithe_calculated), 0),
    COALESCE(SUM(amount_paid), 0),
    COALESCE(COUNT(*), 0)
  INTO v_business_total, v_business_paid, v_business_count
  FROM tithe_transaction_records
  WHERE user_id = p_user_id AND tithe_type = 'business' AND tithe_status IN ('pending', 'partially_paid');

  -- Upsert summary
  INSERT INTO user_tithe_summary (
    user_id,
    personal_tithe_total,
    personal_tithe_paid,
    personal_pending_count,
    business_tithe_total,
    business_tithe_paid,
    business_pending_count,
    updated_at
  )
  VALUES (
    p_user_id,
    v_personal_total,
    v_personal_paid,
    v_personal_count,
    v_business_total,
    v_business_paid,
    v_business_count,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    personal_tithe_total = v_personal_total,
    personal_tithe_paid = v_personal_paid,
    personal_pending_count = v_personal_count,
    business_tithe_total = v_business_total,
    business_tithe_paid = v_business_paid,
    business_pending_count = v_business_count,
    updated_at = NOW();

  RETURN QUERY SELECT TRUE::BOOLEAN, v_personal_total, v_business_total, 
    (v_personal_total - v_personal_paid), (v_business_total - v_business_paid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SECTION 5: FUNCTION - PROCESS TITHE PAYMENT
-- ============================================================
-- Records a tithe payment and links it to specific tithe records

CREATE OR REPLACE FUNCTION fn_process_tithe_payment(
  p_tithe_payment_transaction_id UUID,
  p_payment_amount DECIMAL,
  p_payment_type VARCHAR -- 'personal', 'business', 'combined'
)
RETURNS TABLE (
  success BOOLEAN,
  message VARCHAR,
  tithes_cleared INT,
  amount_applied DECIMAL,
  amount_remaining DECIMAL
) AS $$
DECLARE
  v_user_id UUID;
  v_remaining DECIMAL;
  v_tithes_cleared INT := 0;
  v_payment_type_to_process VARCHAR;
  v_tithe_record RECORD;
  v_amount_to_apply DECIMAL;
BEGIN
  -- Get user from payment transaction
  SELECT user_id INTO v_user_id
  FROM ican_transactions
  WHERE id = p_tithe_payment_transaction_id;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Payment transaction not found'::VARCHAR, 0, 0::DECIMAL, 0::DECIMAL;
    RETURN;
  END IF;

  v_remaining := p_payment_amount;

  -- Process tithes based on payment type
  IF p_payment_type IN ('personal', 'combined') THEN
    -- Apply payment to personal tithes (oldest first)
    FOR v_tithe_record IN 
      SELECT id, tithe_calculated, amount_paid, amount_remaining
      FROM tithe_transaction_records
      WHERE user_id = v_user_id 
        AND tithe_type = 'personal'
        AND tithe_status IN ('pending', 'partially_paid')
      ORDER BY created_at ASC
    LOOP
      IF v_remaining <= 0 THEN EXIT; END IF;
      
      v_amount_to_apply := LEAST(v_remaining, v_tithe_record.amount_remaining);
      
      UPDATE tithe_transaction_records
      SET 
        amount_paid = amount_paid + v_amount_to_apply,
        payment_transaction_id = p_tithe_payment_transaction_id,
        paid_date = NOW(),
        tithe_status = CASE 
          WHEN (amount_paid + v_amount_to_apply) >= tithe_calculated THEN 'paid'
          ELSE 'partially_paid'
        END,
        updated_at = NOW()
      WHERE id = v_tithe_record.id;
      
      v_remaining := v_remaining - v_amount_to_apply;
      v_tithes_cleared := v_tithes_cleared + 1;
    END LOOP;
  END IF;

  IF p_payment_type IN ('business', 'combined') THEN
    -- Apply payment to business tithes (oldest first)
    FOR v_tithe_record IN 
      SELECT id, tithe_calculated, amount_paid, amount_remaining
      FROM tithe_transaction_records
      WHERE user_id = v_user_id 
        AND tithe_type = 'business'
        AND tithe_status IN ('pending', 'partially_paid')
      ORDER BY created_at ASC
    LOOP
      IF v_remaining <= 0 THEN EXIT; END IF;
      
      v_amount_to_apply := LEAST(v_remaining, v_tithe_record.amount_remaining);
      
      UPDATE tithe_transaction_records
      SET 
        amount_paid = amount_paid + v_amount_to_apply,
        payment_transaction_id = p_tithe_payment_transaction_id,
        paid_date = NOW(),
        tithe_status = CASE 
          WHEN (amount_paid + v_amount_to_apply) >= tithe_calculated THEN 'paid'
          ELSE 'partially_paid'
        END,
        updated_at = NOW()
      WHERE id = v_tithe_record.id;
      
      v_remaining := v_remaining - v_amount_to_apply;
      v_tithes_cleared := v_tithes_cleared + 1;
    END LOOP;
  END IF;

  -- Update summary
  PERFORM fn_update_tithe_summary(v_user_id);

  RETURN QUERY SELECT 
    TRUE, 
    format('Successfully processed tithe payment: %s tithes cleared', v_tithes_cleared)::VARCHAR,
    v_tithes_cleared,
    (p_payment_amount - v_remaining),
    v_remaining;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SECTION 6: TRIGGER - RECORD TITHE ON TRANSACTION INSERT
-- ============================================================
-- Automatically records tithe when income/sale transactions are created

CREATE OR REPLACE FUNCTION trigger_record_tithe_on_transaction()
RETURNS TRIGGER AS $$
DECLARE
  v_tithe_type VARCHAR;
  v_should_tithe BOOLEAN;
BEGIN
  -- Only process non-tithe transactions
  IF NEW.transaction_type = 'tithe' THEN
    RETURN NEW;
  END IF;

  -- Determine if this transaction should be tithed
  -- Tithe income sources: income, salary, bonus, gift, investment_return, business_sale, etc
  v_should_tithe := NEW.transaction_type IN ('income', 'sale', 'gift', 'bonus', 'refund', 'return') 
    OR (NEW.metadata->>'transaction_type' IN ('income', 'salary', 'bonus', 'gift', 'investment_return', 'business_sale'));

  IF NOT v_should_tithe THEN
    RETURN NEW;
  END IF;

  -- Determine tithe type from metadata or transaction context
  v_tithe_type := COALESCE(
    NEW.metadata->>'tithe_type',
    NEW.metadata->>'income_type',
    NEW.metadata->>'payment_type',
    'personal'
  );

  -- Validate tithe type
  IF v_tithe_type NOT IN ('personal', 'business', 'combined') THEN
    v_tithe_type := 'personal';
  END IF;

  -- Record the tithe (async/queued for performance)
  -- In production, this should be queued to a job processor to avoid blocking
  PERFORM fn_record_tithe_from_transaction(
    NEW.id,
    v_tithe_type,
    10.0, -- Default 10% tithe
    'Church'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_auto_record_tithe ON ican_transactions;
CREATE TRIGGER trigger_auto_record_tithe
AFTER INSERT ON ican_transactions
FOR EACH ROW
WHEN (NEW.status = 'completed')
EXECUTE FUNCTION trigger_record_tithe_on_transaction();

-- ============================================================
-- SECTION 7: TRIGGER - PROCESS TITHE PAYMENT
-- ============================================================
-- Automatically processes tithe payments when a tithe transaction is recorded

CREATE OR REPLACE FUNCTION trigger_process_tithe_payment()
RETURNS TRIGGER AS $$
DECLARE
  v_payment_type VARCHAR;
BEGIN
  -- Only process tithe payments
  IF NEW.transaction_type != 'tithe' OR NEW.status != 'completed' THEN
    RETURN NEW;
  END IF;

  -- Get payment type from metadata
  v_payment_type := COALESCE(
    NEW.metadata->>'payment_type',
    NEW.metadata->>'tithe_type',
    'personal'
  );

  -- Process the payment
  PERFORM fn_process_tithe_payment(
    NEW.id,
    NEW.amount,
    v_payment_type
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_auto_process_tithe_payment ON ican_transactions;
CREATE TRIGGER trigger_auto_process_tithe_payment
AFTER INSERT ON ican_transactions
FOR EACH ROW
EXECUTE FUNCTION trigger_process_tithe_payment();

-- ============================================================
-- SECTION 8: VIEWS FOR REPORTS
-- ============================================================

-- View: All transactions with tithe status
CREATE OR REPLACE VIEW v_transactions_with_tithe AS
SELECT 
  t.id,
  t.user_id,
  u.email as user_email,
  t.created_at,
  t.amount,
  t.description,
  t.transaction_type,
  t.status,
  ttr.tithe_type,
  ttr.tithe_calculated,
  ttr.amount_paid as tithe_paid,
  ttr.amount_remaining as tithe_remaining,
  ttr.tithe_status,
  ttr.recipient_name,
  ttr.payment_transaction_id,
  CASE 
    WHEN ttr.tithe_status = 'paid' THEN '✅ Paid'
    WHEN ttr.tithe_status = 'partially_paid' THEN '⚠️ Partially Paid'
    WHEN ttr.tithe_status = 'pending' THEN '⏳ Pending'
    ELSE '❓ ' || ttr.tithe_status
  END as tithe_status_display
FROM ican_transactions t
LEFT JOIN auth.users u ON t.user_id = u.id
LEFT JOIN tithe_transaction_records ttr ON t.id = ttr.source_transaction_id
WHERE t.transaction_type IN ('income', 'sale', 'gift', 'bonus')
ORDER BY t.created_at DESC;

-- View: Personal tithe tracking
CREATE OR REPLACE VIEW v_personal_tithe_tracking AS
SELECT 
  u.id,
  u.email,
  ts.personal_tithe_total,
  ts.personal_tithe_paid,
  ts.personal_tithe_remaining,
  ts.personal_pending_count,
  ts.last_personal_payment_date,
  COUNT(CASE WHEN ttr.tithe_status = 'pending' THEN 1 END) as pending_transactions
FROM auth.users u
LEFT JOIN user_tithe_summary ts ON u.id = ts.user_id
LEFT JOIN tithe_transaction_records ttr ON u.id = ttr.user_id AND ttr.tithe_type = 'personal'
GROUP BY u.id, u.email, ts.personal_tithe_total, ts.personal_tithe_paid, ts.personal_tithe_remaining, ts.personal_pending_count, ts.last_personal_payment_date
ORDER BY ts.personal_tithe_remaining DESC NULLS LAST;

-- View: Business tithe tracking
CREATE OR REPLACE VIEW v_business_tithe_tracking AS
SELECT 
  u.id,
  u.email,
  ts.business_tithe_total,
  ts.business_tithe_paid,
  ts.business_tithe_remaining,
  ts.business_pending_count,
  ts.last_business_payment_date,
  COUNT(CASE WHEN ttr.tithe_status = 'pending' THEN 1 END) as pending_transactions
FROM auth.users u
LEFT JOIN user_tithe_summary ts ON u.id = ts.user_id
LEFT JOIN tithe_transaction_records ttr ON u.id = ttr.user_id AND ttr.tithe_type = 'business'
GROUP BY u.id, u.email, ts.business_tithe_total, ts.business_tithe_paid, ts.business_tithe_remaining, ts.business_pending_count, ts.last_business_payment_date
ORDER BY ts.business_tithe_remaining DESC NULLS LAST;

-- ============================================================
-- SECTION 9: INDEXES FOR PERFORMANCE
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_tithe_user_status ON tithe_transaction_records(user_id, tithe_status);
CREATE INDEX IF NOT EXISTS idx_tithe_source_transaction ON tithe_transaction_records(source_transaction_id);
CREATE INDEX IF NOT EXISTS idx_tithe_payment_transaction ON tithe_transaction_records(payment_transaction_id);
CREATE INDEX IF NOT EXISTS idx_tithe_type ON tithe_transaction_records(tithe_type, tithe_status);
CREATE INDEX IF NOT EXISTS idx_tithe_created ON tithe_transaction_records(created_at DESC);

-- ============================================================
-- SECTION 10: ENABLE ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE tithe_transaction_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tithe_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own tithe records" ON tithe_transaction_records;
DROP POLICY IF EXISTS "Users can view their own tithe summary" ON user_tithe_summary;

CREATE POLICY "Users can view their own tithe records" ON tithe_transaction_records
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own tithe summary" ON user_tithe_summary
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- SECTION 11: DATA VALIDATION QUERIES
-- ============================================================

-- Query 1: Check all tithes are properly recorded
SELECT 
  'TITHE_VALIDATION' as check_type,
  COUNT(*) as total_tithes,
  SUM(tithe_calculated) as total_tithe_amount,
  COUNT(CASE WHEN tithe_status = 'pending' THEN 1 END) as pending_count,
  COUNT(CASE WHEN tithe_status = 'paid' THEN 1 END) as paid_count,
  COUNT(CASE WHEN tithe_status = 'partially_paid' THEN 1 END) as partial_count
FROM tithe_transaction_records;

-- Query 2: Check for any orphaned transactions (transactions without tithe records)
SELECT 
  t.id,
  t.created_at,
  t.amount,
  t.description,
  t.transaction_type
FROM ican_transactions t
WHERE t.status = 'completed'
  AND t.transaction_type NOT IN ('tithe', 'expense', 'withdrawal')
  AND NOT EXISTS (SELECT 1 FROM tithe_transaction_records WHERE source_transaction_id = t.id)
ORDER BY t.created_at DESC
LIMIT 10;

-- Query 3: Check summary accuracy vs actual records
SELECT 
  u.email,
  ts.personal_tithe_total,
  (SELECT COALESCE(SUM(tithe_calculated), 0) FROM tithe_transaction_records 
   WHERE user_id = u.id AND tithe_type = 'personal' AND tithe_status IN ('pending', 'partially_paid')) as actual_personal,
  ts.business_tithe_total,
  (SELECT COALESCE(SUM(tithe_calculated), 0) FROM tithe_transaction_records 
   WHERE user_id = u.id AND tithe_type = 'business' AND tithe_status IN ('pending', 'partially_paid')) as actual_business
FROM user_tithe_summary ts
INNER JOIN auth.users u ON ts.user_id = u.id
WHERE ts.personal_tithe_total != (SELECT COALESCE(SUM(tithe_calculated), 0) FROM tithe_transaction_records 
   WHERE user_id = u.id AND tithe_type = 'personal' AND tithe_status IN ('pending', 'partially_paid'))
   OR ts.business_tithe_total != (SELECT COALESCE(SUM(tithe_calculated), 0) FROM tithe_transaction_records 
   WHERE user_id = u.id AND tithe_type = 'business' AND tithe_status IN ('pending', 'partially_paid'));
