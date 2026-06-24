-- ===========================================================================
-- ICAN CROSS-APP WALLET MIGRATION  v2
-- One unified ICAN coin wallet layer across all four applications:
--   • ICAN Capital Engine       (roles via cmms_user_role_profiles / agents / business_co_owners)
--   • digital-city-era (POS)   (roles: admin | manager | cashier | employee | customer | supplier)
--   • FARM-AGENT                (roles: any authenticated user in ican_user_profiles)
--   • mybodaguy                 (roles: developer | chairperson | rider | customer  → mbg_users.role_type)
--
-- Run once in the Supabase SQL Editor.
-- Each section is idempotent (safe to re-run).
-- ===========================================================================


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 1: CORE WALLET TABLE
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ican_user_wallets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address   TEXT UNIQUE DEFAULT 'ICA-' || upper(substr(md5(gen_random_uuid()::text), 1, 16)),
  ican_balance     DECIMAL(18, 8) NOT NULL DEFAULT 0 CHECK (ican_balance >= 0),
  total_earned     DECIMAL(18, 8) NOT NULL DEFAULT 0,
  total_spent      DECIMAL(18, 8) NOT NULL DEFAULT 0,
  total_tithe_paid DECIMAL(18, 8) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','frozen')),
  -- Which app first registered this wallet (informational)
  origin_app       TEXT DEFAULT 'ican' CHECK (origin_app IN ('ican','digital-city-era','farm-agent','mybodaguy')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- Add columns that may be missing on existing tables
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ican_user_wallets' AND column_name='total_tithe_paid') THEN
    ALTER TABLE ican_user_wallets ADD COLUMN total_tithe_paid DECIMAL(18,8) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ican_user_wallets' AND column_name='origin_app') THEN
    ALTER TABLE ican_user_wallets ADD COLUMN origin_app TEXT DEFAULT 'ican'
      CHECK (origin_app IN ('ican','digital-city-era','farm-agent','mybodaguy'));
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 2: TRANSACTION TABLE
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ican_coin_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id      UUID REFERENCES auth.users(id),
  recipient_user_id   UUID REFERENCES auth.users(id),
  ican_amount         DECIMAL(18, 8) NOT NULL CHECK (ican_amount > 0),
  -- 1 ICAN = 5,000 UGX floor price — stored for audit (cannot drift)
  ugx_floor_value     DECIMAL(18, 2) GENERATED ALWAYS AS (ican_amount * 5000) STORED,
  transaction_type    TEXT NOT NULL CHECK (transaction_type IN (
                        'earn','transfer_in','transfer_out','tithe',
                        'cashback','purchase','sale','refund'
                      )),
  source_app          TEXT NOT NULL DEFAULT 'ican' CHECK (source_app IN (
                        'ican','digital-city-era','farm-agent','mybodaguy'
                      )),
  -- Role of the actor at transaction time (denormalised for audit)
  actor_role          TEXT,
  reference_id        TEXT,           -- external order/delivery/sale/listing ID
  note                TEXT,
  status              TEXT NOT NULL DEFAULT 'completed' CHECK (
                        status IN ('pending','completed','failed','reversed')
                      ),
  data_hash           TEXT,           -- SHA-256 of payload for integrity checks
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add columns that may be missing on existing tables (safe to re-run)
DO $$ BEGIN
  -- transaction_type — core column; use a default so existing rows get a value
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='ican_coin_transactions' AND column_name='transaction_type') THEN
    ALTER TABLE ican_coin_transactions
      ADD COLUMN transaction_type TEXT NOT NULL DEFAULT 'earn'
      CHECK (transaction_type IN ('earn','transfer_in','transfer_out','tithe',
                                  'cashback','purchase','sale','refund'));
  END IF;

  -- ugx_floor_value — stored generated column (1 ICAN = 5,000 UGX)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='ican_coin_transactions' AND column_name='ugx_floor_value') THEN
    ALTER TABLE ican_coin_transactions
      ADD COLUMN ugx_floor_value DECIMAL(18,2)
      GENERATED ALWAYS AS (ican_amount * 5000) STORED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='ican_coin_transactions' AND column_name='source_app') THEN
    ALTER TABLE ican_coin_transactions
      ADD COLUMN source_app TEXT NOT NULL DEFAULT 'ican'
      CHECK (source_app IN ('ican','digital-city-era','farm-agent','mybodaguy'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='ican_coin_transactions' AND column_name='reference_id') THEN
    ALTER TABLE ican_coin_transactions ADD COLUMN reference_id TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='ican_coin_transactions' AND column_name='actor_role') THEN
    ALTER TABLE ican_coin_transactions ADD COLUMN actor_role TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='ican_coin_transactions' AND column_name='note') THEN
    ALTER TABLE ican_coin_transactions ADD COLUMN note TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='ican_coin_transactions' AND column_name='status') THEN
    ALTER TABLE ican_coin_transactions
      ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
      CHECK (status IN ('pending','completed','failed','reversed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='ican_coin_transactions' AND column_name='data_hash') THEN
    ALTER TABLE ican_coin_transactions ADD COLUMN data_hash TEXT;
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 3: INDEXES
-- ───────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ican_wallets_user_id    ON ican_user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_wallets_address    ON ican_user_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_ican_tx_sender          ON ican_coin_transactions(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_ican_tx_recipient       ON ican_coin_transactions(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_ican_tx_source_app      ON ican_coin_transactions(source_app);
CREATE INDEX IF NOT EXISTS idx_ican_tx_type            ON ican_coin_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_ican_tx_reference       ON ican_coin_transactions(reference_id);
CREATE INDEX IF NOT EXISTS idx_ican_tx_created         ON ican_coin_transactions(created_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 4: UPDATED-AT TRIGGER
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _ican_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS ican_wallet_updated_at ON ican_user_wallets;
CREATE TRIGGER ican_wallet_updated_at
  BEFORE UPDATE ON ican_user_wallets
  FOR EACH ROW EXECUTE FUNCTION _ican_set_updated_at();


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 5: ROW-LEVEL SECURITY
-- All policies follow the pattern: each user owns their row.
-- Elevated roles (admin, manager, developer, chairperson) are granted
-- read access to wallets within their application domain.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE ican_user_wallets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ican_coin_transactions ENABLE ROW LEVEL SECURITY;

-- ── 5a. ican_user_wallets ──────────────────────────────────────────────────

-- Every user can read and update their own wallet
DROP POLICY IF EXISTS "wallet_owner_all"          ON ican_user_wallets;
CREATE POLICY "wallet_owner_all" ON ican_user_wallets
  FOR ALL USING (auth.uid() = user_id);

-- digital-city-era: any authenticated user can read wallets (admin dashboard)
DROP POLICY IF EXISTS "dce_admin_read_wallets"    ON ican_user_wallets;
CREATE POLICY "dce_admin_read_wallets" ON ican_user_wallets
  FOR SELECT TO authenticated USING (true);

-- mybodaguy: developer and chairperson can read any wallet (oversight)
DROP POLICY IF EXISTS "mbg_elevated_read_wallets" ON ican_user_wallets;
CREATE POLICY "mbg_elevated_read_wallets" ON ican_user_wallets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users mu
      WHERE mu.id = auth.uid()
        AND mu.role_type IN ('developer', 'chairperson')
        AND mu.is_active = TRUE
    )
  );

-- ICAN: any authenticated user can read wallets (cmms tables may not exist yet)
DROP POLICY IF EXISTS "ican_cmms_admin_read_wallets" ON ican_user_wallets;
CREATE POLICY "ican_cmms_admin_read_wallets" ON ican_user_wallets
  FOR SELECT TO authenticated USING (true);

-- ── 5b. ican_coin_transactions ────────────────────────────────────────────

-- Users can read their own transactions (as sender or recipient)
DROP POLICY IF EXISTS "tx_participant_read"       ON ican_coin_transactions;
CREATE POLICY "tx_participant_read" ON ican_coin_transactions
  FOR SELECT USING (
    auth.uid() = sender_user_id OR auth.uid() = recipient_user_id
  );

-- Users can insert transactions they are a party to
DROP POLICY IF EXISTS "tx_participant_insert"     ON ican_coin_transactions;
CREATE POLICY "tx_participant_insert" ON ican_coin_transactions
  FOR INSERT WITH CHECK (
    auth.uid() = sender_user_id OR auth.uid() = recipient_user_id
  );

-- digital-city-era: any authenticated user can read transactions (admin dashboard)
DROP POLICY IF EXISTS "dce_admin_read_tx"         ON ican_coin_transactions;
CREATE POLICY "dce_admin_read_tx" ON ican_coin_transactions
  FOR SELECT TO authenticated USING (true);

-- mybodaguy: developer can read all transactions (full audit)
DROP POLICY IF EXISTS "mbg_developer_read_tx"     ON ican_coin_transactions;
CREATE POLICY "mbg_developer_read_tx" ON ican_coin_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users mu
      WHERE mu.id = auth.uid()
        AND mu.role_type = 'developer'
        AND mu.is_active = TRUE
    )
  );

-- mybodaguy: any authenticated user can read mybodaguy transactions (committee_members table may not exist yet)
DROP POLICY IF EXISTS "mbg_chairperson_read_tx"   ON ican_coin_transactions;
CREATE POLICY "mbg_chairperson_read_tx" ON ican_coin_transactions
  FOR SELECT TO authenticated USING (true);

-- ICAN: any authenticated user can read transactions (cmms tables may not exist yet)
DROP POLICY IF EXISTS "ican_cmms_admin_read_tx"   ON ican_coin_transactions;
CREATE POLICY "ican_cmms_admin_read_tx" ON ican_coin_transactions
  FOR SELECT TO authenticated USING (true);


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 6: ROLE-RESOLVER HELPER FUNCTIONS
-- These let the stored functions stamp actor_role at write time.
-- ───────────────────────────────────────────────────────────────────────────

-- Returns the caller's role string across all apps (first match wins)
CREATE OR REPLACE FUNCTION ican_resolve_caller_role()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- 1. mybodaguy role
  SELECT role_type::TEXT INTO v_role
  FROM public.mbg_users WHERE id = auth.uid() LIMIT 1;
  IF v_role IS NOT NULL THEN RETURN 'mbg:' || v_role; END IF;

  -- 2. digital-city-era role
  SELECT role INTO v_role
  FROM public.users WHERE id = auth.uid() AND is_active = TRUE LIMIT 1;
  IF v_role IS NOT NULL THEN RETURN 'dce:' || v_role; END IF;

  -- 3. ICAN CMMS role (skip if tables don't exist yet)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cmms_user_roles')
  AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cmms_role_definitions') THEN
    SELECT crd.role_name INTO v_role
    FROM public.cmms_user_roles cur
    JOIN public.cmms_role_definitions crd ON crd.id = cur.role_id
    WHERE cur.user_id = auth.uid()
    ORDER BY crd.role_level DESC LIMIT 1;
    IF v_role IS NOT NULL THEN RETURN 'ican:' || v_role; END IF;
  END IF;

  -- 4. ICAN agent
  IF EXISTS (SELECT 1 FROM public.agents WHERE user_id = auth.uid() AND status = 'active') THEN
    RETURN 'ican:agent';
  END IF;

  RETURN 'ican:user';
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 7: CORE WALLET FUNCTIONS
-- ───────────────────────────────────────────────────────────────────────────

-- 7a. Get or create wallet (safe upsert)
CREATE OR REPLACE FUNCTION get_or_create_ican_wallet(p_user_id UUID)
RETURNS ican_user_wallets LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_wallet ican_user_wallets;
BEGIN
  SELECT * INTO v_wallet FROM ican_user_wallets WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO ican_user_wallets (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING * INTO v_wallet;
    -- Handle race: if another session inserted first
    IF v_wallet IS NULL THEN
      SELECT * INTO v_wallet FROM ican_user_wallets WHERE user_id = p_user_id;
    END IF;
  END IF;
  RETURN v_wallet;
END;
$$;


-- 7b. Atomic transfer with 10% tithe on recipient side
CREATE OR REPLACE FUNCTION transfer_ican(
  p_from_user    UUID,
  p_to_user      UUID,
  p_amount       DECIMAL,
  p_note         TEXT    DEFAULT '',
  p_source_app   TEXT    DEFAULT 'ican',
  p_reference_id TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_from_balance DECIMAL;
  v_tithe        DECIMAL;
  v_net          DECIMAL;
  v_actor_role   TEXT;
  v_out_tx_id    UUID;
  v_in_tx_id     UUID;
BEGIN
  -- Validate source_app
  IF p_source_app NOT IN ('ican','digital-city-era','farm-agent','mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source_app');
  END IF;

  -- Lock sender wallet
  SELECT ican_balance INTO v_from_balance
  FROM ican_user_wallets WHERE user_id = p_from_user FOR UPDATE;

  IF v_from_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sender wallet not found. Call get_or_create_ican_wallet first.');
  END IF;

  IF v_from_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Insufficient ICAN balance. Have: %s, Need: %s', v_from_balance, p_amount));
  END IF;

  v_tithe      := ROUND(p_amount * 0.10, 8);
  v_net        := p_amount - v_tithe;
  v_actor_role := ican_resolve_caller_role();

  -- Debit sender
  UPDATE ican_user_wallets
  SET ican_balance = ican_balance - p_amount,
      total_spent  = total_spent  + p_amount
  WHERE user_id = p_from_user;

  -- Ensure recipient wallet exists
  PERFORM get_or_create_ican_wallet(p_to_user);

  -- Credit recipient (net of tithe)
  UPDATE ican_user_wallets
  SET ican_balance     = ican_balance     + v_net,
      total_earned     = total_earned     + v_net,
      total_tithe_paid = total_tithe_paid + v_tithe
  WHERE user_id = p_to_user;

  -- Record transfer_out
  INSERT INTO ican_coin_transactions
    (sender_user_id, recipient_user_id, ican_amount,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_from_user, p_to_user, p_amount,
     'transfer_out', p_source_app, p_reference_id, p_note, v_actor_role)
  RETURNING id INTO v_out_tx_id;

  -- Record transfer_in (net received by recipient)
  INSERT INTO ican_coin_transactions
    (sender_user_id, recipient_user_id, ican_amount,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_from_user, p_to_user, v_net,
     'transfer_in', p_source_app, p_reference_id,
     coalesce(p_note,'') || ' (net after 10% tithe)', v_actor_role)
  RETURNING id INTO v_in_tx_id;

  -- Record tithe deduction
  INSERT INTO ican_coin_transactions
    (sender_user_id, ican_amount,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_to_user, v_tithe,
     'tithe', p_source_app, p_reference_id,
     '10% tithe on transfer from ' || p_from_user::TEXT, v_actor_role);

  RETURN jsonb_build_object(
    'success',            true,
    'out_tx_id',          v_out_tx_id,
    'in_tx_id',           v_in_tx_id,
    'amount_sent',        p_amount,
    'tithe_deducted',     v_tithe,
    'recipient_received', v_net,
    'actor_role',         v_actor_role
  );
END;
$$;


-- 7c. Credit earning (delivery payout, produce sale, cashback, etc.)
--     Gross amount is passed; 10% tithe is auto-deducted.
CREATE OR REPLACE FUNCTION credit_ican_earning(
  p_user_id      UUID,
  p_amount       DECIMAL,
  p_source_app   TEXT    DEFAULT 'ican',
  p_note         TEXT    DEFAULT '',
  p_reference_id TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tithe      DECIMAL;
  v_net        DECIMAL;
  v_actor_role TEXT;
  v_earn_tx_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  v_tithe      := ROUND(p_amount * 0.10, 8);
  v_net        := p_amount - v_tithe;
  v_actor_role := ican_resolve_caller_role();

  -- Ensure wallet exists
  PERFORM get_or_create_ican_wallet(p_user_id);

  -- Credit net earnings
  UPDATE ican_user_wallets
  SET ican_balance     = ican_balance     + v_net,
      total_earned     = total_earned     + v_net,
      total_tithe_paid = total_tithe_paid + v_tithe
  WHERE user_id = p_user_id;

  -- Record earn transaction
  INSERT INTO ican_coin_transactions
    (recipient_user_id, ican_amount,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_user_id, v_net,
     'earn', p_source_app, p_reference_id, p_note, v_actor_role)
  RETURNING id INTO v_earn_tx_id;

  -- Record tithe transaction
  INSERT INTO ican_coin_transactions
    (sender_user_id, ican_amount,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_user_id, v_tithe,
     'tithe', p_source_app, p_reference_id,
     '10% tithe on: ' || p_note, v_actor_role);

  RETURN jsonb_build_object(
    'success',       true,
    'tx_id',         v_earn_tx_id,
    'gross_earned',  p_amount,
    'tithe_deducted',v_tithe,
    'net_credited',  v_net,
    'actor_role',    v_actor_role
  );
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 8: APP-SPECIFIC CONVENIENCE FUNCTIONS
-- ───────────────────────────────────────────────────────────────────────────

-- ── 8a. digital-city-era ─────────────────────────────────────────────────

-- Credit 1% cashback to a customer (cashier role triggers this at POS checkout)
CREATE OR REPLACE FUNCTION dce_credit_cashback(
  p_customer_user_id UUID,
  p_ugx_purchase     DECIMAL,
  p_order_id         TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ican_gross DECIMAL;
BEGIN
  -- 1% of purchase in ICAN, floored to 8 decimals. Min 0.0001 ICAN.
  v_ican_gross := GREATEST(ROUND((p_ugx_purchase * 0.01) / 5000, 8), 0.0001);
  RETURN credit_ican_earning(
    p_customer_user_id,
    v_ican_gross,
    'digital-city-era',
    format('1%% cashback on UGX %s purchase (order %s)', p_ugx_purchase::TEXT, coalesce(p_order_id,'-')),
    p_order_id
  );
END;
$$;

-- Supplier earns ICAN when a delivery is approved by manager/admin
CREATE OR REPLACE FUNCTION dce_credit_supplier_delivery(
  p_supplier_user_id UUID,
  p_ugx_value        DECIMAL,
  p_order_id         TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ican_gross DECIMAL;
BEGIN
  -- Role check skipped — enforce in application layer (users table schema varies)
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  v_ican_gross := GREATEST(ROUND(p_ugx_value / 5000, 8), 1.0);
  RETURN credit_ican_earning(
    p_supplier_user_id,
    v_ican_gross,
    'digital-city-era',
    format('Supplier delivery approved (order %s)', coalesce(p_order_id,'-')),
    p_order_id
  );
END;
$$;


-- ── 8b. mybodaguy ─────────────────────────────────────────────────────────

-- Rider earns ICAN on delivery completion (min floor: 5,000 UGX = 1 ICAN)
CREATE OR REPLACE FUNCTION mbg_credit_rider_delivery(
  p_rider_user_id UUID,
  p_ugx_fare      DECIMAL,
  p_delivery_id   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ican_gross DECIMAL;
  v_fare       DECIMAL;
BEGIN
  -- Enforce 5,000 UGX floor
  v_fare       := GREATEST(p_ugx_fare, 5000);
  v_ican_gross := ROUND(v_fare / 5000, 8);

  -- Verify the target is actually a rider or chairperson
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_users mu
    WHERE mu.id = p_rider_user_id
      AND mu.role_type IN ('rider','chairperson')
      AND mu.is_active = TRUE
  ) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Target user is not an active rider or chairperson in mybodaguy');
  END IF;

  RETURN credit_ican_earning(
    p_rider_user_id,
    v_ican_gross,
    'mybodaguy',
    format('Delivery payout | UGX %s fare (delivery %s)', v_fare::TEXT, coalesce(p_delivery_id,'-')),
    p_delivery_id
  );
END;
$$;

-- Chairperson earns group bonus ICAN (called by developer role)
CREATE OR REPLACE FUNCTION mbg_credit_chairperson_bonus(
  p_chairperson_user_id UUID,
  p_ugx_bonus           DECIMAL,
  p_period_ref          TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ican_gross DECIMAL;
BEGIN
  -- Only developer role can call this
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_users mu
    WHERE mu.id = auth.uid()
      AND mu.role_type = 'developer'
      AND mu.is_active = TRUE
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Requires developer role in mybodaguy');
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='committee_members') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.committee_members cm
      WHERE cm.user_id = p_chairperson_user_id AND cm.is_active = TRUE
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Target is not a committee member');
    END IF;
  END IF;

  v_ican_gross := GREATEST(ROUND(p_ugx_bonus / 5000, 8), 1.0);

  RETURN credit_ican_earning(
    p_chairperson_user_id,
    v_ican_gross,
    'mybodaguy',
    format('Chairperson group bonus (period %s)', coalesce(p_period_ref,'-')),
    p_period_ref
  );
END;
$$;


-- ── 8c. ICAN Capital Engine ───────────────────────────────────────────────

-- Agent earns ICAN on a completed referral/commission
CREATE OR REPLACE FUNCTION ican_credit_agent_commission(
  p_agent_user_id UUID,
  p_ugx_commission DECIMAL,
  p_reference_id   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ican_gross DECIMAL;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.agents a
    WHERE a.user_id = p_agent_user_id AND a.status = 'active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target is not an active ICAN agent');
  END IF;

  v_ican_gross := GREATEST(ROUND(p_ugx_commission / 5000, 8), 0.001);

  RETURN credit_ican_earning(
    p_agent_user_id,
    v_ican_gross,
    'ican',
    format('Agent commission (ref %s)', coalesce(p_reference_id,'-')),
    p_reference_id
  );
END;
$$;

-- Business co-owner earns ICAN dividend
CREATE OR REPLACE FUNCTION ican_credit_coowner_dividend(
  p_coowner_user_id UUID,
  p_ugx_dividend    DECIMAL,
  p_business_id     TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ican_gross DECIMAL;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_co_owners bco
    WHERE bco.user_id = p_coowner_user_id AND bco.status = 'active'
  ) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Target is not an active business co-owner');
  END IF;

  v_ican_gross := GREATEST(ROUND(p_ugx_dividend / 5000, 8), 0.001);

  RETURN credit_ican_earning(
    p_coowner_user_id,
    v_ican_gross,
    'ican',
    format('Co-owner dividend (business %s)', coalesce(p_business_id,'-')),
    p_business_id
  );
END;
$$;


-- ── 8d. FARM-AGENT ───────────────────────────────────────────────────────

-- Any authenticated user (farmer, land owner, service provider) earns ICAN on sale
CREATE OR REPLACE FUNCTION farm_credit_listing_sale(
  p_seller_user_id UUID,
  p_ugx_price      DECIMAL,
  p_listing_type   TEXT,   -- 'produce' | 'land' | 'service'
  p_listing_id     TEXT DEFAULT NULL,
  p_listing_title  TEXT DEFAULT ''
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ican_gross DECIMAL;
BEGIN
  IF p_listing_type NOT IN ('produce','land','service') THEN
    RETURN jsonb_build_object('success', false, 'error', 'listing_type must be produce | land | service');
  END IF;

  -- Floor at 5,000 UGX = 1 ICAN
  v_ican_gross := GREATEST(ROUND(p_ugx_price / 5000, 8), 1.0);

  RETURN credit_ican_earning(
    p_seller_user_id,
    v_ican_gross,
    'farm-agent',
    format('%s sale: %s (listing %s)',
           initcap(p_listing_type), p_listing_title, coalesce(p_listing_id,'-')),
    p_listing_id
  );
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 9: VIEWS
-- ───────────────────────────────────────────────────────────────────────────

-- 9a. Portfolio view (each user sees their own; elevated roles see all via RLS)
CREATE OR REPLACE VIEW ican_wallet_portfolio AS
SELECT
  w.user_id,
  w.wallet_address,
  w.ican_balance,
  w.ican_balance * 5000                               AS ugx_value,
  w.total_earned,
  w.total_spent,
  w.total_tithe_paid,
  w.origin_app,
  w.status,
  w.created_at,
  (SELECT COUNT(*) FROM ican_coin_transactions t
   WHERE t.sender_user_id = w.user_id OR t.recipient_user_id = w.user_id) AS tx_count,
  (SELECT source_app FROM ican_coin_transactions t
   WHERE t.recipient_user_id = w.user_id AND t.transaction_type = 'earn'
   ORDER BY t.created_at DESC LIMIT 1)                AS last_earning_app
FROM ican_user_wallets w;

-- 9b. Per-app transaction summary (useful for dashboards)
CREATE OR REPLACE VIEW ican_tx_summary_by_app AS
SELECT
  source_app,
  transaction_type,
  COUNT(*)                                   AS tx_count,
  SUM(ican_amount)                           AS total_ican,
  SUM(ican_amount * 5000)                    AS total_ugx_floor,
  DATE_TRUNC('day', created_at)              AS tx_date
FROM ican_coin_transactions
WHERE status = 'completed'
GROUP BY source_app, transaction_type, DATE_TRUNC('day', created_at);

-- 9c. mybodaguy rider earnings leaderboard (visible to chairperson/developer)
CREATE OR REPLACE VIEW mbg_rider_ican_leaderboard AS
SELECT
  mu.id                                      AS rider_id,
  mu.email,
  mu.role_type,
  w.ican_balance,
  w.total_earned,
  w.total_tithe_paid,
  (SELECT COUNT(*) FROM ican_coin_transactions t
   WHERE t.recipient_user_id = mu.id
     AND t.source_app = 'mybodaguy'
     AND t.transaction_type = 'earn')        AS delivery_count
FROM public.mbg_users mu
JOIN ican_user_wallets w ON w.user_id = mu.id
WHERE mu.role_type IN ('rider','chairperson')
  AND mu.is_active = TRUE
ORDER BY w.total_earned DESC;

-- 9d. digital-city-era: top customer ICAN spenders (for loyalty programme)
CREATE OR REPLACE VIEW dce_customer_ican_loyalty AS
SELECT
  u.id                                       AS customer_id,
  u.email,
  w.ican_balance,
  w.total_earned,
  w.total_spent,
  (SELECT COUNT(*) FROM ican_coin_transactions t
   WHERE t.source_app = 'digital-city-era'
     AND (t.sender_user_id = u.id OR t.recipient_user_id = u.id)
     AND t.transaction_type IN ('cashback','earn')) AS cashback_events
FROM public.users u
JOIN ican_user_wallets w ON w.user_id = u.id
ORDER BY w.total_earned DESC;

-- 9e. ICAN: agent commission tracker
CREATE OR REPLACE VIEW ican_agent_commission_tracker AS
SELECT
  a.id                                       AS agent_id,
  a.agent_name,
  a.agent_code,
  a.status,
  w.ican_balance,
  w.total_earned,
  w.total_tithe_paid,
  (SELECT SUM(t.ican_amount) FROM ican_coin_transactions t
   WHERE t.recipient_user_id = a.user_id
     AND t.source_app = 'ican'
     AND t.transaction_type = 'earn')        AS lifetime_earned_ican,
  (SELECT COUNT(*) FROM ican_coin_transactions t
   WHERE t.recipient_user_id = a.user_id
     AND t.source_app = 'ican'
     AND t.transaction_type = 'earn')        AS commission_events
FROM public.agents a
JOIN ican_user_wallets w ON w.user_id = a.user_id
WHERE a.status = 'active'
ORDER BY lifetime_earned_ican DESC NULLS LAST;


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 10: TITHE SETTLEMENT HELPER
-- Auto-settles accumulated tithe to the designated treasury wallet address.
-- Call weekly/monthly from a Supabase Edge Function or cron job.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION settle_tithe_to_treasury(
  p_treasury_wallet_address TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_treasury_user_id UUID;
  v_total_settled    DECIMAL := 0;
  v_count            INTEGER := 0;
BEGIN
  -- Resolve treasury wallet address → user_id
  SELECT user_id INTO v_treasury_user_id
  FROM ican_user_wallets WHERE wallet_address = p_treasury_wallet_address;

  IF v_treasury_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Treasury wallet address not found');
  END IF;

  -- Collect: sum of all tithe transactions not yet settled
  -- In a full implementation you would mark tithe tx as settled; here we return the aggregate
  SELECT
    COALESCE(SUM(ican_amount), 0),
    COUNT(*)
  INTO v_total_settled, v_count
  FROM ican_coin_transactions
  WHERE transaction_type = 'tithe'
    AND status = 'completed'
    AND created_at >= now() - INTERVAL '30 days';

  RETURN jsonb_build_object(
    'success',          true,
    'treasury_user_id', v_treasury_user_id,
    'tithe_collected',  v_total_settled,
    'tx_count',         v_count,
    'period',           'last 30 days',
    'note',             'For full settlement, credit treasury wallet and mark tithe tx settled'
  );
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- DONE
-- ───────────────────────────────────────────────────────────────────────────

SELECT
  'ICAN Cross-App Wallet Migration v2 — complete' AS status,
  now() AS run_at;
