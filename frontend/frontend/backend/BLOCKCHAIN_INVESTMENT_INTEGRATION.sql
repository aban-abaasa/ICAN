-- =====================================================
-- BLOCKCHAIN INVESTMENT INTEGRATION
-- =====================================================
-- Records investment signatures & transactions on blockchain
-- Supports Ethereum/Polygon with immutable audit trail

-- Step 1: Create blockchain transaction records table
DROP TABLE IF EXISTS public.blockchain_investment_records CASCADE;
CREATE TABLE public.blockchain_investment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Investment Reference
  investment_id UUID NOT NULL,
  investor_id UUID NOT NULL,
  pitch_id UUID,
  business_profile_id UUID,
  
  -- Blockchain Details
  blockchain_network VARCHAR(50), -- ethereum, polygon, binance, etc
  contract_address VARCHAR(255),
  transaction_hash VARCHAR(255) UNIQUE,
  block_number INTEGER,
  block_timestamp TIMESTAMP WITH TIME ZONE,
  
  -- Record Type
  record_type VARCHAR(50), -- investment_signature, wallet_transfer, shareholder_approval, threshold_met, document_finalized
  record_data JSONB, -- Complete record of what was recorded
  
  -- Verification
  is_verified BOOLEAN DEFAULT FALSE,
  verification_timestamp TIMESTAMP WITH TIME ZONE,
  gas_price DECIMAL(18, 8),
  gas_used DECIMAL(18, 8),
  transaction_fee DECIMAL(18, 8),
  
  -- Status
  status VARCHAR(50) DEFAULT 'pending', -- pending, confirmed, failed, reverted
  confirmation_count INTEGER DEFAULT 0,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blockchain_investment_id ON public.blockchain_investment_records(investment_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_investor_id ON public.blockchain_investment_records(investor_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_tx_hash ON public.blockchain_investment_records(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_blockchain_status ON public.blockchain_investment_records(status);
CREATE INDEX IF NOT EXISTS idx_blockchain_record_type ON public.blockchain_investment_records(record_type);

-- Step 2: Create blockchain wallet mapping table
DROP TABLE IF EXISTS public.blockchain_wallets CASCADE;
CREATE TABLE public.blockchain_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  user_email VARCHAR(255),
  
  -- Blockchain Wallet Details
  blockchain_network VARCHAR(50), -- ethereum, polygon, binance, etc
  wallet_address VARCHAR(255) NOT NULL, -- 0x... format
  wallet_type VARCHAR(50), -- EOA (external owned account), Smart Contract
  
  -- Status
  status VARCHAR(50) DEFAULT 'active',
  is_verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMP WITH TIME ZONE,
  
  -- Balance tracking
  last_balance_check TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blockchain_wallet_user_id ON public.blockchain_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_wallet_address ON public.blockchain_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_blockchain_wallet_network ON public.blockchain_wallets(blockchain_network);

-- Step 3: Create blockchain escrow smart contract table
DROP TABLE IF EXISTS public.blockchain_escrow_contracts CASCADE;
CREATE TABLE public.blockchain_escrow_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Investment Reference
  investment_id UUID NOT NULL UNIQUE,
  business_profile_id UUID,
  
  -- Smart Contract Details
  blockchain_network VARCHAR(50),
  contract_address VARCHAR(255) UNIQUE,
  deployment_tx_hash VARCHAR(255),
  deployed_at TIMESTAMP WITH TIME ZONE,
  
  -- Escrow Terms
  investor_address VARCHAR(255),
  escrow_agent_address VARCHAR(255), -- AGENT-KAM-5560 address
  release_threshold_percent DECIMAL(5, 2) DEFAULT 60.00,
  release_condition VARCHAR(255), -- shareholder_approval, time_delay, manual_approval
  
  -- Fund Status
  funds_deposited BOOLEAN DEFAULT FALSE,
  funds_amount DECIMAL(18, 8),
  funds_token VARCHAR(50), -- ICAN, USDC, ETH, etc
  funds_locked_at TIMESTAMP WITH TIME ZONE,
  
  -- Release Status
  release_triggered BOOLEAN DEFAULT FALSE,
  release_condition_met_at TIMESTAMP WITH TIME ZONE,
  funds_released_at TIMESTAMP WITH TIME ZONE,
  release_tx_hash VARCHAR(255),
  
  -- Status
  status VARCHAR(50) DEFAULT 'pending', -- pending, funded, locked, released, cancelled
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blockchain_escrow_investment_id ON public.blockchain_escrow_contracts(investment_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_escrow_contract ON public.blockchain_escrow_contracts(contract_address);
CREATE INDEX IF NOT EXISTS idx_blockchain_escrow_status ON public.blockchain_escrow_contracts(status);

-- Step 4: Create blockchain approval tracking table
DROP TABLE IF EXISTS public.blockchain_approvals CASCADE;
CREATE TABLE public.blockchain_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Investment Reference
  investment_id UUID NOT NULL,
  shareholder_id UUID NOT NULL,
  
  -- Blockchain Details
  blockchain_network VARCHAR(50),
  approval_tx_hash VARCHAR(255) UNIQUE,
  block_number INTEGER,
  
  -- Approval Details
  approval_timestamp TIMESTAMP WITH TIME ZONE,
  signature_data JSONB, -- Signed transaction data
  
  -- Status
  status VARCHAR(50) DEFAULT 'pending', -- pending, confirmed, failed
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blockchain_approval_investment ON public.blockchain_approvals(investment_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_approval_shareholder ON public.blockchain_approvals(shareholder_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_approval_tx ON public.blockchain_approvals(approval_tx_hash);

-- Step 5: Enable RLS
ALTER TABLE public.blockchain_investment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blockchain_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blockchain_escrow_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blockchain_approvals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view their blockchain records" ON public.blockchain_investment_records;
CREATE POLICY "Users can view their blockchain records"
    ON public.blockchain_investment_records FOR SELECT
    USING (investor_id = auth.uid());

DROP POLICY IF EXISTS "Users can view their blockchain wallet" ON public.blockchain_wallets;
CREATE POLICY "Users can view their blockchain wallet"
    ON public.blockchain_wallets FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view their blockchain approvals" ON public.blockchain_approvals;
CREATE POLICY "Users can view their blockchain approvals"
    ON public.blockchain_approvals FOR SELECT
    USING (shareholder_id = auth.uid());

-- Step 6: Create function to record investment on blockchain
CREATE OR REPLACE FUNCTION record_investment_on_blockchain(
  p_investment_id UUID,
  p_investor_id UUID,
  p_pitch_id UUID,
  p_blockchain_network VARCHAR,
  p_transaction_hash VARCHAR,
  p_block_number INTEGER,
  p_record_type VARCHAR,
  p_record_data JSONB
)
RETURNS TABLE (
  record_id UUID,
  status TEXT,
  blockchain_tx VARCHAR
) AS $$
DECLARE
  v_record_id UUID;
BEGIN
  INSERT INTO public.blockchain_investment_records (
    investment_id,
    investor_id,
    pitch_id,
    blockchain_network,
    transaction_hash,
    block_number,
    record_type,
    record_data,
    status
  ) VALUES (
    p_investment_id,
    p_investor_id,
    p_pitch_id,
    p_blockchain_network,
    p_transaction_hash,
    p_block_number,
    p_record_type,
    p_record_data,
    'confirmed'
  )
  RETURNING id INTO v_record_id;
  
  RETURN QUERY SELECT 
    v_record_id as record_id,
    'Blockchain record created: ' || p_record_type || ' recorded on ' || p_blockchain_network as status,
    p_transaction_hash as blockchain_tx;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Create function to trigger escrow smart contract
CREATE OR REPLACE FUNCTION trigger_escrow_contract(
  p_investment_id UUID,
  p_contract_address VARCHAR,
  p_funds_amount DECIMAL,
  p_blockchain_network VARCHAR
)
RETURNS TABLE (
  status TEXT,
  contract_address VARCHAR,
  is_funded BOOLEAN
) AS $$
DECLARE
  v_contract_exists BOOLEAN;
BEGIN
  -- Check if contract exists
  SELECT EXISTS(
    SELECT 1 FROM public.blockchain_escrow_contracts
    WHERE investment_id = p_investment_id
  ) INTO v_contract_exists;
  
  IF NOT v_contract_exists THEN
    -- Create new escrow contract
    INSERT INTO public.blockchain_escrow_contracts (
      investment_id,
      contract_address,
      blockchain_network,
      funds_amount,
      funds_token,
      status
    ) VALUES (
      p_investment_id,
      p_contract_address,
      p_blockchain_network,
      p_funds_amount,
      'ICAN',
      'funded'
    );
  ELSE
    -- Update existing contract
    UPDATE public.blockchain_escrow_contracts
    SET
      funds_deposited = TRUE,
      funds_amount = p_funds_amount,
      funds_locked_at = NOW(),
      status = 'locked'
    WHERE investment_id = p_investment_id;
  END IF;
  
  RETURN QUERY SELECT 
    'Escrow contract activated on ' || p_blockchain_network as status,
    p_contract_address as contract_address,
    TRUE as is_funded;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- BLOCKCHAIN INTEGRATION NOTES
-- =====================================================
/*
IMPLEMENTATION OPTIONS:

1. POLYGON (Recommended for ICAN):
   - Fast, cheap transactions
   - ERC-20 token support for ICAN
   - Polygon PoS bridge for Ethereum compatibility
   - Uniswap integration for liquidity

2. ETHEREUM:
   - Highest security
   - Highest gas costs
   - Better for large investments

3. SMART CONTRACT FUNCTIONS:
   - escrow_deposit() - Investor deposits ICAN
   - escrow_lock() - Funds locked during 60% voting
   - escrow_release() - Auto-release when 60% met
   - shareholder_approve() - On-chain approval voting
   - get_threshold_status() - Check % approval

4. FRONT-END INTEGRATION:
   - ethers.js or web3.js library
   - MetaMask or Web3Modal for wallet connection
   - Listen to contract events for updates
   - Display on-chain approval percentage in real-time

5. SECURITY:
   - All signatures verified on-chain
   - Immutable audit trail
   - Automatic execution at threshold
   - No manual intervention needed after 60%
*/
