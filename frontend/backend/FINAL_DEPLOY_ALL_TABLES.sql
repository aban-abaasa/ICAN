-- =============================================
-- EMERGENCY FIX: Complete ICAN Wallet Setup
-- Run this ENTIRE script in Supabase SQL Editor
-- =============================================

-- Step 1: DROP old broken table
DROP TABLE IF EXISTS public.ican_user_wallets CASCADE;

-- Step 2: CREATE fresh table with CORRECT constraint for upsert
CREATE TABLE public.ican_user_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    wallet_address TEXT NOT NULL UNIQUE,
    ican_balance DECIMAL(18, 8) DEFAULT 0,
    total_spent DECIMAL(18, 8) DEFAULT 0,
    total_earned DECIMAL(18, 8) DEFAULT 0,
    purchase_count INTEGER DEFAULT 0,
    sale_count INTEGER DEFAULT 0,
    private_key_encrypted TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 3: Create indexes
CREATE INDEX IF NOT EXISTS idx_ican_user_wallets_user_id ON public.ican_user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_user_wallets_wallet_address ON public.ican_user_wallets(wallet_address);

-- Step 4: Enable RLS
ALTER TABLE public.ican_user_wallets ENABLE ROW LEVEL SECURITY;

-- Step 5: Create RLS policies (ALL needed policies)
DROP POLICY IF EXISTS "Users can view their own wallets" ON public.ican_user_wallets;
DROP POLICY IF EXISTS "Users can insert their own wallets" ON public.ican_user_wallets;
DROP POLICY IF EXISTS "Users can update their own wallets" ON public.ican_user_wallets;

CREATE POLICY "Users can view their own wallets" 
    ON public.ican_user_wallets FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own wallets"
    ON public.ican_user_wallets FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own wallets"
    ON public.ican_user_wallets FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Step 6: Grant permissions
GRANT SELECT, INSERT, UPDATE ON public.ican_user_wallets TO authenticated;

-- Step 7: Verify table was created with correct constraints
SELECT '✅ ican_user_wallets TABLE CREATED' as status;
SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_name = 'ican_user_wallets';

-- =============================================
-- BLOCKCHAIN TABLE FIX
-- =============================================

DROP TABLE IF EXISTS public.ican_coin_blockchain_txs CASCADE;

CREATE TABLE public.ican_coin_blockchain_txs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tx_hash VARCHAR(255),
  tx_type VARCHAR(50) NOT NULL,
  ican_amount DECIMAL(20, 8) NOT NULL,
  price_per_coin DECIMAL(20, 2) NOT NULL DEFAULT 5000,
  total_value_ugx DECIMAL(20, 2) NOT NULL,
  contract_address VARCHAR(255),
  from_address VARCHAR(255),
  to_address VARCHAR(255),
  gas_used DECIMAL(20, 8),
  block_number BIGINT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'completed'
);

CREATE INDEX idx_ican_tx_user ON public.ican_coin_blockchain_txs(user_id);
CREATE INDEX idx_ican_tx_type ON public.ican_coin_blockchain_txs(tx_type);
CREATE INDEX idx_ican_tx_timestamp ON public.ican_coin_blockchain_txs(timestamp DESC);

ALTER TABLE public.ican_coin_blockchain_txs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transactions" ON public.ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can update own transactions" ON public.ican_coin_blockchain_txs;

CREATE POLICY "Users can view own transactions"
  ON public.ican_coin_blockchain_txs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON public.ican_coin_blockchain_txs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON public.ican_coin_blockchain_txs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.ican_coin_blockchain_txs TO authenticated;

SELECT '✅ ican_coin_blockchain_txs TABLE CREATED' as status;

-- =============================================
-- FINAL VERIFICATION
-- =============================================
SELECT '✅ ALL TABLES READY!' as final_status;
SELECT '✅ Coin purchases can now be saved' as message;
SELECT '✅ Blockchain transactions can be recorded' as message2;
