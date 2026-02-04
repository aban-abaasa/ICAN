/**
 * 🔧 Create Missing Tables
 * Run this in Supabase SQL Editor to create ican_coin_market_prices and ican_price_ohlc tables
 */

-- ===================================
-- Create ican_coin_market_prices table
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
  volume DECIMAL(20,2),
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
-- Create indexes for market prices
-- ===================================
CREATE INDEX IF NOT EXISTS idx_ican_prices_timestamp 
ON ican_coin_market_prices(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_ican_prices_last_updated 
ON ican_coin_market_prices(last_updated DESC);

-- ===================================
-- Grant permissions for market prices
-- ===================================
GRANT SELECT ON ican_coin_market_prices TO authenticated;

-- ===================================
-- Enable RLS for market prices
-- ===================================
ALTER TABLE ican_coin_market_prices ENABLE ROW LEVEL SECURITY;

-- ===================================
-- Drop old policies if they exist
-- ===================================
DROP POLICY IF EXISTS "Authenticated users can view market prices" ON ican_coin_market_prices;

-- Allow all authenticated users to read market prices
CREATE POLICY "read_market_prices"
  ON ican_coin_market_prices
  FOR SELECT
  USING (true);

-- ===================================
-- Add comment for market prices table
-- ===================================
COMMENT ON TABLE ican_coin_market_prices IS 'Real-time ICAN coin market prices in multiple currencies';
COMMENT ON COLUMN ican_coin_market_prices.price_usd IS 'Current ICAN price in USD';
COMMENT ON COLUMN ican_coin_market_prices.price_ugx IS 'Current ICAN price in UGX (Ugandan Shilling)';
COMMENT ON COLUMN ican_coin_market_prices.percentage_change_24h IS 'Price change percentage in last 24 hours';

-- ===================================
-- Add volume column if it doesn't exist
-- ===================================
ALTER TABLE IF EXISTS ican_coin_market_prices
ADD COLUMN IF NOT EXISTS volume DECIMAL(20,2);

-- ===================================
-- Create ican_price_ohlc table for candlesticks
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
-- Create indexes for OHLC data
-- ===================================
CREATE INDEX IF NOT EXISTS idx_ican_ohlc_open_time 
ON ican_price_ohlc(open_time DESC);

CREATE INDEX IF NOT EXISTS idx_ican_ohlc_timeframe 
ON ican_price_ohlc(timeframe, open_time DESC);

CREATE INDEX IF NOT EXISTS idx_ican_ohlc_close_time 
ON ican_price_ohlc(close_time DESC);

-- ===================================
-- Grant permissions for OHLC data
-- ===================================
GRANT SELECT ON ican_price_ohlc TO authenticated;

-- ===================================
-- Enable RLS for OHLC data
-- ===================================
ALTER TABLE ican_price_ohlc ENABLE ROW LEVEL SECURITY;

-- ===================================
-- Drop old policies if they exist
-- ===================================
DROP POLICY IF EXISTS "Authenticated users can view OHLC data" ON ican_price_ohlc;

-- Allow all authenticated users to read OHLC data
CREATE POLICY "read_ohlc_data"
  ON ican_price_ohlc
  FOR SELECT
  USING (true);

-- ===================================
-- Add comment for OHLC table
-- ===================================
COMMENT ON TABLE ican_price_ohlc IS 'OHLC (Open, High, Low, Close) candlestick data for ICAN price charting';
COMMENT ON COLUMN ican_price_ohlc.open_price IS 'Opening price for the candle period';
COMMENT ON COLUMN ican_price_ohlc.high_price IS 'Highest price during the candle period';
COMMENT ON COLUMN ican_price_ohlc.low_price IS 'Lowest price during the candle period';
COMMENT ON COLUMN ican_price_ohlc.close_price IS 'Closing price for the candle period';
COMMENT ON COLUMN ican_price_ohlc.timeframe IS 'Candlestick timeframe (7s for real-time trading)';

-- ===================================
-- Insert sample market price data
-- ===================================
INSERT INTO ican_coin_market_prices (
  price_usd, price_ugx, price_eur, price_gbp, price_jpy,
  market_cap, volume, trading_volume_24h, percentage_change_24h, percentage_change_7d,
  all_time_high, all_time_low, data_source
) VALUES (
  0.00036, 1.35, 0.00034, 0.00029, 0.054,
  1000000, 50000, 50000, 2.5, 5.2,
  0.00050, 0.00010, 'blockchain'
)
ON CONFLICT DO NOTHING;

-- ===================================
-- Insert sample OHLC candlestick data
-- ===================================
INSERT INTO ican_price_ohlc (
  open_price, high_price, low_price, close_price,
  trading_volume, transaction_count, timeframe,
  open_time, close_time
) VALUES 
  (0.00036, 0.00037, 0.00035, 0.00036, 1250.50, 45, '7s', NOW() - INTERVAL '70 seconds', NOW() - INTERVAL '63 seconds'),
  (0.00036, 0.00038, 0.00035, 0.00037, 1500.75, 52, '7s', NOW() - INTERVAL '63 seconds', NOW() - INTERVAL '56 seconds'),
  (0.00037, 0.00039, 0.00036, 0.00038, 1800.25, 61, '7s', NOW() - INTERVAL '56 seconds', NOW() - INTERVAL '49 seconds'),
  (0.00038, 0.00040, 0.00037, 0.00039, 2100.50, 68, '7s', NOW() - INTERVAL '49 seconds', NOW() - INTERVAL '42 seconds'),
  (0.00039, 0.00041, 0.00038, 0.00040, 2400.75, 75, '7s', NOW() - INTERVAL '42 seconds', NOW() - INTERVAL '35 seconds'),
  (0.00040, 0.00042, 0.00039, 0.00041, 2700.25, 82, '7s', NOW() - INTERVAL '35 seconds', NOW() - INTERVAL '28 seconds'),
  (0.00041, 0.00043, 0.00040, 0.00042, 3000.50, 89, '7s', NOW() - INTERVAL '28 seconds', NOW() - INTERVAL '21 seconds'),
  (0.00042, 0.00044, 0.00041, 0.00043, 3300.75, 96, '7s', NOW() - INTERVAL '21 seconds', NOW() - INTERVAL '14 seconds'),
  (0.00043, 0.00045, 0.00042, 0.00044, 3600.25, 103, '7s', NOW() - INTERVAL '14 seconds', NOW() - INTERVAL '7 seconds'),
  (0.00044, 0.00046, 0.00043, 0.00045, 3900.50, 110, '7s', NOW() - INTERVAL '7 seconds', NOW())
ON CONFLICT DO NOTHING;
-- ===================================
-- Create ican_user_wallets table
-- ===================================
CREATE TABLE IF NOT EXISTS ican_user_wallets (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  ican_balance DECIMAL(20,8) DEFAULT 0,
  total_spent DECIMAL(20,2) DEFAULT 0,
  total_earned DECIMAL(20,2) DEFAULT 0,
  purchase_count INT DEFAULT 0,
  sale_count INT DEFAULT 0,
  first_purchase_date TIMESTAMP WITH TIME ZONE,
  last_transaction_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- ===================================
-- Create indexes for user wallets
-- ===================================
CREATE INDEX IF NOT EXISTS idx_ican_wallets_user_id 
ON ican_user_wallets(user_id);

CREATE INDEX IF NOT EXISTS idx_ican_wallets_updated_at 
ON ican_user_wallets(updated_at DESC);

-- ===================================
-- Grant permissions for user wallets
-- ===================================
GRANT SELECT, INSERT, UPDATE ON ican_user_wallets TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE ican_user_wallets_id_seq TO authenticated;

-- ===================================
-- Enable RLS for user wallets
-- ===================================
ALTER TABLE ican_user_wallets ENABLE ROW LEVEL SECURITY;

-- ===================================
-- Drop old RLS Policies if they exist
-- ===================================
DROP POLICY IF EXISTS "Users can select their own wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can insert their own wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can update their own wallet" ON ican_user_wallets;

-- ===================================
-- Create RLS Policies for user wallets
-- ===================================
-- Allow users to select their own wallet
CREATE POLICY "select_own_wallet"
  ON ican_user_wallets
  FOR SELECT
  USING (auth.uid() = user_id);

-- Allow users to insert their own wallet
CREATE POLICY "insert_own_wallet"
  ON ican_user_wallets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own wallet
CREATE POLICY "update_own_wallet"
  ON ican_user_wallets
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ===================================
-- Add comment for user wallets table
-- ===================================
COMMENT ON TABLE ican_user_wallets IS 'User ICAN coin wallets - tracks balance and transaction history';
COMMENT ON COLUMN ican_user_wallets.ican_balance IS 'Current ICAN coins balance';
COMMENT ON COLUMN ican_user_wallets.total_spent IS 'Total amount spent to buy ICAN coins';
COMMENT ON COLUMN ican_user_wallets.total_earned IS 'Total amount earned from selling ICAN coins';