-- 💎 ICAN Coin System Database Schema

-- Add ICAN Coin fields to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT 'US',
ADD COLUMN IF NOT EXISTS ican_coin_balance DECIMAL(18, 8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS ican_coin_total_purchased DECIMAL(18, 8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS ican_coin_total_sold DECIMAL(18, 8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS created_country_code VARCHAR(2); -- Track initial country choice

-- Create ICAN Coin Transactions Table
CREATE TABLE IF NOT EXISTS ican_coin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  type VARCHAR(50) NOT NULL, -- 'purchase', 'sale', 'transfer_out', 'transfer_in'
  ican_amount DECIMAL(18, 8) NOT NULL,
  local_amount DECIMAL(18, 2),
  
  country_code VARCHAR(2),
  from_country VARCHAR(2),
  to_country VARCHAR(2),
  currency VARCHAR(3),
  exchange_rate DECIMAL(15, 8),
  
  payment_method VARCHAR(50), -- 'card', 'bank', 'momo', 'transfer'
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'cancelled'
  
  notes TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_ican_transactions_user_id ON ican_coin_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_sender_id ON ican_coin_transactions(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_recipient_id ON ican_coin_transactions(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_type ON ican_coin_transactions(type);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_status ON ican_coin_transactions(status);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_timestamp ON ican_coin_transactions(timestamp DESC);

-- Create ICAN Coin Portfolio Summary View
CREATE OR REPLACE VIEW ican_coin_portfolio AS
SELECT 
  up.id as user_id,
  up.email,
  up.full_name,
  up.country_code,
  up.ican_coin_balance,
  up.ican_coin_total_purchased,
  up.ican_coin_total_sold,
  (SELECT COUNT(*) FROM ican_coin_transactions WHERE user_id = up.id) as transaction_count,
  (SELECT MAX(timestamp) FROM ican_coin_transactions WHERE user_id = up.id) as last_transaction_at,
  CASE 
    WHEN up.country_code = 'US' THEN up.ican_coin_balance * 1
    WHEN up.country_code = 'UG' THEN up.ican_coin_balance * 2750
    WHEN up.country_code = 'KE' THEN up.ican_coin_balance * 130
    WHEN up.country_code = 'TZ' THEN up.ican_coin_balance * 2550
    WHEN up.country_code = 'RW' THEN up.ican_coin_balance * 1300
    WHEN up.country_code = 'NG' THEN up.ican_coin_balance * 1530
    WHEN up.country_code = 'GH' THEN up.ican_coin_balance * 15.2
    ELSE up.ican_coin_balance * 1
  END as local_currency_value
FROM user_profiles up;

-- Create RLS (Row Level Security) policies for ICAN transactions
ALTER TABLE ican_coin_transactions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own transactions
CREATE POLICY "Users can view their own ICAN transactions" ON ican_coin_transactions
  FOR SELECT USING (
    auth.uid() = user_id 
    OR auth.uid() = sender_user_id 
    OR auth.uid() = recipient_user_id
  );

-- Users can insert their own transactions
CREATE POLICY "Users can create ICAN transactions" ON ican_coin_transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own transactions (for status updates)
CREATE POLICY "Users can update their own ICAN transactions" ON ican_coin_transactions
  FOR UPDATE USING (auth.uid() = user_id);

-- Function to update ICAN balance
CREATE OR REPLACE FUNCTION update_ican_balance(
  p_user_id UUID,
  p_amount DECIMAL,
  p_operation VARCHAR
)
RETURNS DECIMAL AS $$
DECLARE
  v_new_balance DECIMAL;
BEGIN
  IF p_operation = 'add' THEN
    UPDATE user_profiles 
    SET ican_coin_balance = ican_coin_balance + p_amount,
        ican_coin_total_purchased = ican_coin_total_purchased + p_amount
    WHERE id = p_user_id
    RETURNING ican_coin_balance INTO v_new_balance;
  ELSIF p_operation = 'subtract' THEN
    UPDATE user_profiles 
    SET ican_coin_balance = GREATEST(0, ican_coin_balance - p_amount),
        ican_coin_total_sold = ican_coin_total_sold + p_amount
    WHERE id = p_user_id
    RETURNING ican_coin_balance INTO v_new_balance;
  END IF;
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;
