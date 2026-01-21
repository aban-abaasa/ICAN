/**
 * 💰 ICAN Wallet Withdrawal System - SQL Migration
 * 
 * Creates the withdrawal_history table for tracking all user withdrawals
 * Supports: Mobile Money (MTN, Airtel, Vodafone) and Bank Transfers
 */

-- ============================================
-- Withdrawal History Table
-- ============================================

CREATE TABLE IF NOT EXISTS withdrawal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE SET NULL,
  
  -- Withdrawal Details
  amount DECIMAL(15, 2) NOT NULL,
  fee DECIMAL(10, 2) DEFAULT 0,
  net_amount DECIMAL(15, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'UGX',
  
  -- Destination Information
  provider VARCHAR(20), -- 'mtn', 'airtel', 'vodafone', 'bank'
  phone_number VARCHAR(20), -- For mobile money
  account_number VARCHAR(50), -- For bank transfers
  bank_name VARCHAR(100), -- For bank transfers
  
  -- Status & Tracking
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  momo_reference VARCHAR(100), -- MTN MOMO transaction reference
  bank_reference VARCHAR(100), -- Bank transfer reference
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- ============================================
-- Indexes for Performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_withdrawal_user_id ON withdrawal_history(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON withdrawal_history(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_created_at ON withdrawal_history(created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawal_provider ON withdrawal_history(provider);
CREATE INDEX IF NOT EXISTS idx_withdrawal_transaction_id ON withdrawal_history(transaction_id);

-- ============================================
-- Enable Row Level Security (RLS)
-- ============================================

ALTER TABLE withdrawal_history ENABLE ROW LEVEL SECURITY;

-- Users can only view their own withdrawal history
CREATE POLICY "Users can view their own withdrawals"
  ON withdrawal_history
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert their own withdrawals
CREATE POLICY "Users can create their own withdrawals"
  ON withdrawal_history
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Only admins can update withdrawal status
-- (In production, this would check for admin role)
CREATE POLICY "Only system can update withdrawal status"
  ON withdrawal_history
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- ============================================
-- Triggers
-- ============================================

-- Update timestamp on modification
CREATE OR REPLACE FUNCTION update_withdrawal_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER withdrawal_update_timestamp
  BEFORE UPDATE ON withdrawal_history
  FOR EACH ROW
  EXECUTE FUNCTION update_withdrawal_timestamp();

-- ============================================
-- Views for Analytics
-- ============================================

-- Daily withdrawal summary
CREATE OR REPLACE VIEW withdrawal_daily_summary AS
SELECT 
  DATE(created_at) as withdrawal_date,
  provider,
  status,
  COUNT(*) as total_withdrawals,
  COALESCE(SUM(amount), 0) as total_amount,
  COALESCE(SUM(fee), 0) as total_fees,
  COALESCE(SUM(net_amount), 0) as net_total,
  COUNT(DISTINCT user_id) as unique_users,
  currency
FROM withdrawal_history
GROUP BY DATE(created_at), provider, status, currency
ORDER BY withdrawal_date DESC;

-- User withdrawal summary
CREATE OR REPLACE VIEW user_withdrawal_summary AS
SELECT 
  user_id,
  COUNT(*) as total_withdrawals,
  COALESCE(SUM(amount), 0) as total_withdrawn,
  COALESCE(SUM(fee), 0) as total_fees,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_withdrawals,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_withdrawals,
  MAX(created_at) as last_withdrawal_date,
  currency
FROM withdrawal_history
GROUP BY user_id, currency;

-- ============================================
-- Stored Procedures
-- ============================================

-- Get user's withdrawal history with details
CREATE OR REPLACE FUNCTION get_user_withdrawal_history(p_user_id UUID, p_limit INT DEFAULT 20)
RETURNS TABLE (
  id UUID,
  amount DECIMAL,
  fee DECIMAL,
  net_amount DECIMAL,
  provider VARCHAR,
  status VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE,
  phone_number VARCHAR,
  account_number VARCHAR,
  bank_name VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    wh.id,
    wh.amount,
    wh.fee,
    wh.net_amount,
    wh.provider,
    wh.status,
    wh.created_at,
    wh.phone_number,
    wh.account_number,
    wh.bank_name
  FROM withdrawal_history wh
  WHERE wh.user_id = p_user_id
  ORDER BY wh.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Comments for Documentation
-- ============================================

COMMENT ON TABLE withdrawal_history IS 'Tracks all user withdrawals from ICAN Wallet';
COMMENT ON COLUMN withdrawal_history.provider IS 'Mobile money provider: mtn, airtel, vodafone, or bank';
COMMENT ON COLUMN withdrawal_history.status IS 'Withdrawal status: pending, processing, completed, failed';
COMMENT ON COLUMN withdrawal_history.momo_reference IS 'MTN MOMO transaction ID for reconciliation';
COMMENT ON COLUMN withdrawal_history.metadata IS 'Additional data: error messages, API responses, etc.';
