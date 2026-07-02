-- ============================================================
-- PITCHIN LIVE SHARE VALUE MIGRATION
-- Run once in Supabase SQL editor
-- Depends on: ICAN_CROSS_APP_WALLET_MIGRATION.sql (already run)
-- ============================================================

-- ─── 1. Add business_profile_id to ican_transactions ────────────────────────

ALTER TABLE ican_transactions
  ADD COLUMN IF NOT EXISTS business_profile_id UUID
    REFERENCES business_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ican_tx_business_profile
  ON ican_transactions(business_profile_id)
  WHERE business_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ican_tx_user_bucket
  ON ican_transactions(user_id, (metadata->>'reporting_bucket'));

-- ─── 2. pitchin_business_data_links ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pitchin_business_data_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  source_app          TEXT NOT NULL CHECK (source_app IN ('cmms','farm-agent','mybodaguy','digital-city-era')),
  source_entity_id    TEXT NOT NULL,
  source_entity_name  TEXT,
  linked_by           TEXT,
  linked_at           TIMESTAMPTZ DEFAULT now(),
  is_active           BOOLEAN DEFAULT TRUE,
  UNIQUE (business_profile_id, source_app)
);

CREATE INDEX IF NOT EXISTS idx_pitchin_links_profile
  ON pitchin_business_data_links(business_profile_id)
  WHERE is_active = TRUE;

ALTER TABLE pitchin_business_data_links ENABLE ROW LEVEL SECURITY;

-- Cast both sides to TEXT so comparison works regardless of whether
-- user_id is UUID or VARCHAR in business_profiles / business_co_owners.
CREATE POLICY "owner_manage_links" ON pitchin_business_data_links
  FOR ALL
  USING (
    business_profile_id IN (
      SELECT id FROM business_profiles WHERE user_id::TEXT = auth.uid()::TEXT
      UNION
      SELECT business_profile_id FROM business_co_owners WHERE user_id::TEXT = auth.uid()::TEXT
    )
  );

CREATE POLICY "investor_read_links" ON pitchin_business_data_links
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- ─── 3. pitchin_share_value_snapshots ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS pitchin_share_value_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id   UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  snapshot_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  share_price_ugx       NUMERIC(18,4) NOT NULL DEFAULT 0,
  original_price_ugx    NUMERIC(18,4) DEFAULT 0,
  price_change_pct      NUMERIC(8,4) DEFAULT 0,
  business_value_ugx    NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_revenue_ugx     NUMERIC(18,4) DEFAULT 0,
  total_assets_ugx      NUMERIC(18,4) DEFAULT 0,
  ican_holdings_value   NUMERIC(18,4) DEFAULT 0,
  net_profit_ugx        NUMERIC(18,4) DEFAULT 0,
  total_shares          INTEGER DEFAULT 0,
  breakdown             JSONB DEFAULT '{}',
  data_hash             TEXT,
  blockchain_tx_hash    TEXT,
  blockchain_block      INTEGER,
  blockchain_verified   BOOLEAN DEFAULT FALSE,
  computed_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (business_profile_id, snapshot_date)
);

ALTER TABLE pitchin_share_value_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_snapshots" ON pitchin_share_value_snapshots
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "owner_write_snapshots" ON pitchin_share_value_snapshots
  FOR ALL USING (
    business_profile_id IN (
      SELECT id FROM business_profiles WHERE user_id::TEXT = auth.uid()::TEXT
      UNION
      SELECT business_profile_id FROM business_co_owners WHERE user_id::TEXT = auth.uid()::TEXT
    )
  );

-- ─── 4. CMMS Supplier ↔ SupermarketEra Supplier cross-access ─────────────────

CREATE OR REPLACE FUNCTION fn_is_dce_supplier()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- users.id is VARCHAR; auth.uid() is UUID — cast both to TEXT
  RETURN EXISTS (
    SELECT 1 FROM users
    WHERE id::TEXT = auth.uid()::TEXT
      AND role = 'supplier'
  );
END;
$$;

DROP POLICY IF EXISTS "dce_supplier_read_own_inventory" ON cmms_inventory_items;

-- supplier_id may be UUID or VARCHAR — cast both sides to TEXT to be safe
CREATE POLICY "dce_supplier_read_own_inventory" ON cmms_inventory_items
  FOR SELECT
  USING (
    supplier_id::TEXT = auth.uid()::TEXT
    AND fn_is_dce_supplier()
  );

GRANT EXECUTE ON FUNCTION fn_is_dce_supplier() TO authenticated;

-- ─── 5. fn_get_business_ican_financials ──────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_get_business_ican_financials(p_business_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sold_income     NUMERIC := 0;
  v_bought_stock    NUMERIC := 0;
  v_capital_assets  NUMERIC := 0;
  v_operating_exp   NUMERIC := 0;
  v_salary_exp      NUMERIC := 0;
  v_tax_exp         NUMERIC := 0;
  v_loan_inflow     NUMERIC := 0;
  v_dividend_out    NUMERIC := 0;
  v_owner_equity    NUMERIC := 0;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN metadata->>'reporting_bucket' = 'sold_income'       THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN metadata->>'reporting_bucket' = 'bought_stock'      THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN metadata->>'reporting_bucket' = 'capital_asset'     THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN metadata->>'reporting_bucket' = 'operating_expense' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN metadata->>'reporting_bucket' = 'salary_expense'    THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN metadata->>'reporting_bucket' = 'tax_expense'       THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN metadata->>'reporting_bucket' = 'loan_inflow'       THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN metadata->>'reporting_bucket' = 'dividend_payout'   THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN metadata->>'reporting_bucket' = 'owner_equity'      THEN amount ELSE 0 END), 0)
  INTO
    v_sold_income, v_bought_stock, v_capital_assets,
    v_operating_exp, v_salary_exp, v_tax_exp,
    v_loan_inflow, v_dividend_out, v_owner_equity
  FROM ican_transactions
  WHERE business_profile_id = p_business_profile_id
    AND status = 'completed';

  RETURN jsonb_build_object(
    'sold_income',       v_sold_income,
    'bought_stock',      v_bought_stock,
    'capital_assets',    v_capital_assets,
    'operating_expense', v_operating_exp,
    'salary_expense',    v_salary_exp,
    'tax_expense',       v_tax_exp,
    'loan_inflow',       v_loan_inflow,
    'dividend_payout',   v_dividend_out,
    'owner_equity',      v_owner_equity,
    'net_revenue',       v_sold_income - v_bought_stock,
    'total_expenses',    v_operating_exp + v_salary_exp + v_tax_exp,
    'net_profit',        v_sold_income - v_bought_stock - v_operating_exp - v_salary_exp - v_tax_exp
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_get_business_ican_financials(UUID) TO authenticated;

-- ─── 6. fn_save_share_value_snapshot ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_save_share_value_snapshot(
  p_business_profile_id UUID,
  p_share_price_ugx     NUMERIC,
  p_original_price      NUMERIC,
  p_business_value      NUMERIC,
  p_total_revenue       NUMERIC,
  p_total_assets        NUMERIC,
  p_ican_holdings_value NUMERIC,
  p_net_profit          NUMERIC,
  p_total_shares        INTEGER,
  p_breakdown           JSONB,
  p_data_hash           TEXT,
  p_blockchain_tx_hash  TEXT DEFAULT NULL,
  p_blockchain_block    INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_change_pct NUMERIC := 0;
BEGIN
  IF p_original_price > 0 THEN
    v_change_pct := ((p_share_price_ugx - p_original_price) / p_original_price) * 100;
  END IF;

  INSERT INTO pitchin_share_value_snapshots (
    business_profile_id, snapshot_date,
    share_price_ugx, original_price_ugx, price_change_pct,
    business_value_ugx, total_revenue_ugx, total_assets_ugx,
    ican_holdings_value, net_profit_ugx, total_shares,
    breakdown, data_hash, blockchain_tx_hash, blockchain_block,
    blockchain_verified, computed_at
  ) VALUES (
    p_business_profile_id, CURRENT_DATE,
    p_share_price_ugx, p_original_price, v_change_pct,
    p_business_value, p_total_revenue, p_total_assets,
    p_ican_holdings_value, p_net_profit, p_total_shares,
    p_breakdown, p_data_hash,
    p_blockchain_tx_hash, p_blockchain_block,
    (p_blockchain_tx_hash IS NOT NULL), now()
  )
  ON CONFLICT (business_profile_id, snapshot_date)
  DO UPDATE SET
    share_price_ugx       = EXCLUDED.share_price_ugx,
    price_change_pct      = EXCLUDED.price_change_pct,
    business_value_ugx    = EXCLUDED.business_value_ugx,
    total_revenue_ugx     = EXCLUDED.total_revenue_ugx,
    total_assets_ugx      = EXCLUDED.total_assets_ugx,
    ican_holdings_value   = EXCLUDED.ican_holdings_value,
    net_profit_ugx        = EXCLUDED.net_profit_ugx,
    breakdown             = EXCLUDED.breakdown,
    data_hash             = EXCLUDED.data_hash,
    blockchain_tx_hash    = COALESCE(EXCLUDED.blockchain_tx_hash, pitchin_share_value_snapshots.blockchain_tx_hash),
    blockchain_block      = COALESCE(EXCLUDED.blockchain_block, pitchin_share_value_snapshots.blockchain_block),
    blockchain_verified   = COALESCE(EXCLUDED.blockchain_tx_hash IS NOT NULL, pitchin_share_value_snapshots.blockchain_verified),
    computed_at           = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_save_share_value_snapshot(UUID,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,INTEGER,JSONB,TEXT,TEXT,INTEGER) TO authenticated;
