-- 📝 Create ICAN Coin Blockchain Transactions Table
-- This table records all ICAN coin purchases, sales, and transfers

CREATE TABLE IF NOT EXISTS ican_coin_blockchain_txs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tx_hash VARCHAR(255),
  tx_type VARCHAR(50) NOT NULL CHECK (tx_type IN ('purchase', 'sale', 'transfer', 'reward')),
  ican_amount DECIMAL(20, 8) NOT NULL,
  price_per_coin DECIMAL(20, 2) NOT NULL DEFAULT 5000,
  total_value_ugx DECIMAL(20, 2) NOT NULL,
  contract_address VARCHAR(255),
  from_address VARCHAR(255),
  to_address VARCHAR(255),
  gas_used DECIMAL(20, 8),
  block_number BIGINT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  
  -- Indexes for fast queries
  CONSTRAINT idx_user_id UNIQUE (user_id, timestamp)
);

-- Create indexes
CREATE INDEX idx_ican_tx_user ON ican_coin_blockchain_txs(user_id);
CREATE INDEX idx_ican_tx_type ON ican_coin_blockchain_txs(tx_type);
CREATE INDEX idx_ican_tx_timestamp ON ican_coin_blockchain_txs(timestamp DESC);

-- Enable RLS
ALTER TABLE ican_coin_blockchain_txs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own transactions
CREATE POLICY "Users can view own transactions"
  ON ican_coin_blockchain_txs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON ican_coin_blockchain_txs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Grant permissions
GRANT SELECT, INSERT ON ican_coin_blockchain_txs TO authenticated;

SELECT '✅ TABLE CREATED: ican_coin_blockchain_txs';
SELECT 'This table now records all ICAN coin transactions' as info;
