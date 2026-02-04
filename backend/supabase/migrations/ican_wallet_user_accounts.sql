/**
 * ✨ ICAN Wallet Integration - user_accounts Table
 * Adds ICAN coin support to existing user_accounts table
 * 
 * Key Columns Added:
 * - ican_coin_balance: Current ICAN holdings
 * - ican_coin_total_purchased: Total ICAN ever purchased
 * - ican_coin_total_sold: Total ICAN ever sold
 * - country_code: User's preferred country (2-letter ISO code)
 * - ican_updated_at: Last ICAN transaction timestamp
 */

-- ===================================
-- 1. Add ICAN wallet columns to user_accounts
-- ===================================
ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS ican_coin_balance DECIMAL(18,8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS ican_coin_total_purchased DECIMAL(18,8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS ican_coin_total_sold DECIMAL(18,8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ican_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- ===================================
-- 2. Create ican_coin_transactions table
-- ===================================
CREATE TABLE IF NOT EXISTS ican_coin_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Transaction type and amounts
  type TEXT NOT NULL CHECK (type IN ('purchase', 'sale', 'transfer_out', 'transfer_in', 'stake', 'unstake', 'interest')),
  ican_amount DECIMAL(18,8) NOT NULL,
  local_amount DECIMAL(16,2),
  
  -- Currency and pricing info
  country_code VARCHAR(2),
  currency TEXT,
  price_per_coin DECIMAL(16,2),
  exchange_rate DECIMAL(16,8),
  
  -- Transfer details (if applicable)
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  from_country VARCHAR(2),
  to_country VARCHAR(2),
  
  -- Payment and blockchain
  payment_method TEXT,
  blockchain_tx_hash VARCHAR(255),
  wallet_address VARCHAR(255),
  
  -- Status and timestamps
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Metadata
  description TEXT,
  metadata JSONB
);

-- ===================================
-- 3. Create indexes for performance
-- ===================================
CREATE INDEX IF NOT EXISTS idx_user_accounts_country_code 
ON user_accounts(country_code);

CREATE INDEX IF NOT EXISTS idx_user_accounts_ican_balance 
ON user_accounts(ican_coin_balance) 
WHERE ican_coin_balance > 0;

CREATE INDEX IF NOT EXISTS idx_ican_transactions_user_id 
ON ican_coin_transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_ican_transactions_timestamp 
ON ican_coin_transactions(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_ican_transactions_type 
ON ican_coin_transactions(type);

CREATE INDEX IF NOT EXISTS idx_ican_transactions_user_type 
ON ican_coin_transactions(user_id, type, timestamp DESC);

-- ===================================
-- 4. Create function: check_user_has_country
-- ===================================
CREATE OR REPLACE FUNCTION check_user_has_country()
RETURNS TRIGGER AS $$
BEGIN
  -- Verify user has country_code set before allowing ICAN transactions
  IF NOT EXISTS (
    SELECT 1 FROM user_accounts 
    WHERE user_id = NEW.user_id 
    AND country_code IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'User must set country_code before ICAN transactions (user_id: %)', NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===================================
-- 5. Create trigger: Enforce country before ICAN transactions
-- ===================================
DROP TRIGGER IF EXISTS ensure_country_for_ican_transactions ON ican_coin_transactions;
CREATE TRIGGER ensure_country_for_ican_transactions
BEFORE INSERT ON ican_coin_transactions
FOR EACH ROW
EXECUTE FUNCTION check_user_has_country();

-- ===================================
-- 6. Create function: Update user_accounts on transaction
-- ===================================
CREATE OR REPLACE FUNCTION update_ican_balance_on_transaction()
RETURNS TRIGGER AS $$
BEGIN
  -- Update timestamp
  UPDATE user_accounts 
  SET ican_updated_at = CURRENT_TIMESTAMP
  WHERE user_id = NEW.user_id;
  
  -- Update totals based on transaction type
  IF NEW.type = 'purchase' THEN
    UPDATE user_accounts
    SET ican_coin_total_purchased = ican_coin_total_purchased + NEW.ican_amount
    WHERE user_id = NEW.user_id;
  ELSIF NEW.type = 'sale' THEN
    UPDATE user_accounts
    SET ican_coin_total_sold = ican_coin_total_sold + NEW.ican_amount
    WHERE user_id = NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===================================
-- 7. Create trigger: Auto-update totals
-- ===================================
DROP TRIGGER IF EXISTS update_ican_totals ON ican_coin_transactions;
CREATE TRIGGER update_ican_totals
AFTER INSERT ON ican_coin_transactions
FOR EACH ROW
WHEN (NEW.status = 'completed')
EXECUTE FUNCTION update_ican_balance_on_transaction();

-- ===================================
-- 8. Enable Row Level Security (RLS)
-- ===================================
ALTER TABLE ican_coin_transactions ENABLE ROW LEVEL SECURITY;

-- ===================================
-- 9. Create RLS Policy: Users can view their own transactions
-- ===================================
CREATE POLICY "Users can view own ICAN transactions"
ON ican_coin_transactions FOR SELECT
USING (
  auth.uid() = user_id 
  OR auth.uid() = sender_user_id 
  OR auth.uid() = recipient_user_id
);

-- ===================================
-- 10. Create RLS Policy: Only system can insert transactions
-- ===================================
CREATE POLICY "System inserts ICAN transactions"
ON ican_coin_transactions FOR INSERT
WITH CHECK (true);

-- ===================================
-- 11. Create view: Users without country
-- ===================================
CREATE OR REPLACE VIEW users_without_country AS
SELECT 
  ua.id,
  ua.user_id,
  ua.account_number,
  ua.preferred_currency,
  ua.ican_coin_balance
FROM user_accounts ua
WHERE ua.country_code IS NULL;

-- ===================================
-- 12. Create function: Get user's country
-- ===================================
CREATE OR REPLACE FUNCTION get_user_country(p_user_id UUID)
RETURNS VARCHAR(2) AS $$
DECLARE
  v_country VARCHAR(2);
BEGIN
  SELECT country_code INTO v_country
  FROM user_accounts
  WHERE user_id = p_user_id
  LIMIT 1;
  
  RETURN COALESCE(v_country, 'US');
END;
$$ LANGUAGE plpgsql;

-- ===================================
-- 13. Create function: Has country set
-- ===================================
CREATE OR REPLACE FUNCTION has_country_set(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_accounts
    WHERE user_id = p_user_id
    AND country_code IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql;

-- ===================================
-- 14. Grant permissions
-- ===================================
GRANT SELECT ON user_accounts TO authenticated;
GRANT UPDATE (ican_coin_balance, country_code, ican_updated_at) ON user_accounts TO authenticated;
GRANT SELECT, INSERT ON ican_coin_transactions TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_country TO authenticated;
GRANT EXECUTE ON FUNCTION has_country_set TO authenticated;

-- ===================================
-- 15. Add comment explaining ICAN columns
-- ===================================
COMMENT ON COLUMN user_accounts.ican_coin_balance IS 'Current ICAN coin holdings (decimal with 8 places)';
COMMENT ON COLUMN user_accounts.ican_coin_total_purchased IS 'Cumulative ICAN purchased (for gain/loss tracking)';
COMMENT ON COLUMN user_accounts.ican_coin_total_sold IS 'Cumulative ICAN sold (for gain/loss tracking)';
COMMENT ON COLUMN user_accounts.country_code IS 'User''s preferred country (ISO 3166-1 alpha-2, REQUIRED for ICAN)';
COMMENT ON COLUMN user_accounts.ican_updated_at IS 'Timestamp of last ICAN transaction';

-- ===================================
-- 16. Create ican_coin_market_prices table
-- ===================================
CREATE TABLE IF NOT EXISTS ican_coin_market_prices (
  id BIGSERIAL PRIMARY KEY,
  price_usd DECIMAL(16,8) NOT NULL,
  price_ugx DECIMAL(18,2) NOT NULL,
  price_eur DECIMAL(16,8),
  price_gbp DECIMAL(16,8),
  price_jpy DECIMAL(16,8),
  
  -- Market data
  market_cap DECIMAL(20,2),
  trading_volume_24h DECIMAL(20,2),
  percentage_change_24h DECIMAL(10,2) DEFAULT 0,
  percentage_change_7d DECIMAL(10,2) DEFAULT 0,
  
  -- All time high/low
  all_time_high DECIMAL(16,8),
  all_time_low DECIMAL(16,8),
  
  -- Additional currencies
  currency_rates JSONB,
  
  -- Metadata
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  data_source TEXT DEFAULT 'blockchain'
);

-- ===================================
-- 17. Create indexes for market prices
-- ===================================
CREATE INDEX IF NOT EXISTS idx_ican_prices_timestamp 
ON ican_coin_market_prices(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_ican_prices_last_updated 
ON ican_coin_market_prices(last_updated DESC);

-- ===================================
-- 18. Grant permissions for market prices
-- ===================================
GRANT SELECT ON ican_coin_market_prices TO authenticated;

-- ===================================
-- 19. Add comment for market prices table
-- ===================================
COMMENT ON TABLE ican_coin_market_prices IS 'Real-time ICAN coin market prices in multiple currencies';
COMMENT ON COLUMN ican_coin_market_prices.price_usd IS 'Current ICAN price in USD';
COMMENT ON COLUMN ican_coin_market_prices.price_ugx IS 'Current ICAN price in UGX (Ugandan Shilling)';
COMMENT ON COLUMN ican_coin_market_prices.percentage_change_24h IS 'Price change percentage in last 24 hours';

-- ===================================
-- 20. Create ican_price_ohlc table for candlesticks
-- ===================================
CREATE TABLE IF NOT EXISTS ican_price_ohlc (
  id BIGSERIAL PRIMARY KEY,
  
  -- OHLC Data
  open_price DECIMAL(16,8) NOT NULL,
  high_price DECIMAL(16,8) NOT NULL,
  low_price DECIMAL(16,8) NOT NULL,
  close_price DECIMAL(16,8) NOT NULL,
  
  -- Volume data
  trading_volume DECIMAL(20,2),
  transaction_count INT DEFAULT 0,
  
  -- Time frame
  timeframe TEXT DEFAULT '7s' CHECK (timeframe IN ('7s', '1m', '5m', '15m', '1h', '1d')),
  
  -- Timestamps
  open_time TIMESTAMP WITH TIME ZONE NOT NULL,
  close_time TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ===================================
-- 21. Create indexes for OHLC data
-- ===================================
CREATE INDEX IF NOT EXISTS idx_ican_ohlc_open_time 
ON ican_price_ohlc(open_time DESC);

CREATE INDEX IF NOT EXISTS idx_ican_ohlc_timeframe 
ON ican_price_ohlc(timeframe, open_time DESC);

CREATE INDEX IF NOT EXISTS idx_ican_ohlc_close_time 
ON ican_price_ohlc(close_time DESC);

-- ===================================
-- 22. Grant permissions for OHLC data
-- ===================================
GRANT SELECT ON ican_price_ohlc TO authenticated;

-- ===================================
-- 23. Add comment for OHLC table
-- ===================================
COMMENT ON TABLE ican_price_ohlc IS 'OHLC (Open, High, Low, Close) candlestick data for ICAN price charting';
COMMENT ON COLUMN ican_price_ohlc.open_price IS 'Opening price for the candle period';
COMMENT ON COLUMN ican_price_ohlc.high_price IS 'Highest price during the candle period';
COMMENT ON COLUMN ican_price_ohlc.low_price IS 'Lowest price during the candle period';
COMMENT ON COLUMN ican_price_ohlc.close_price IS 'Closing price for the candle period';
COMMENT ON COLUMN ican_price_ohlc.timeframe IS 'Candlestick timeframe (7s for real-time trading)';

