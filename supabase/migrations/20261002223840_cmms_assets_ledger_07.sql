CREATE OR REPLACE FUNCTION public.fn_cmms_accum_depreciation(
  p_cost NUMERIC, p_salvage NUMERIC, p_life INT, p_method TEXT, p_acq_year INT, p_as_of_year INT
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_method IS NULL OR p_method = 'none'
      OR p_life IS NULL OR p_life <= 0
      OR p_acq_year IS NULL OR p_as_of_year IS NULL OR p_as_of_year < p_acq_year
      OR COALESCE(p_cost, 0) <= 0 THEN 0
    WHEN p_method = 'declining_balance' THEN
      GREATEST(0, ROUND(LEAST(
        p_cost - COALESCE(p_salvage, 0),
        p_cost - p_cost * power(1 - LEAST(2.0 / p_life, 1.0),
                                LEAST(p_as_of_year - p_acq_year + 1, p_life))
      ), 2))
    ELSE
      GREATEST(0, ROUND(LEAST(
        p_cost - COALESCE(p_salvage, 0),
        (p_cost - COALESCE(p_salvage, 0)) / p_life * (p_as_of_year - p_acq_year + 1)
      ), 2))
  END;
$$;
CREATE TABLE IF NOT EXISTS public.cmms_inventory_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id       UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  group_id              UUID,
  item_id               UUID REFERENCES public.cmms_inventory_items(id) ON DELETE SET NULL,
  item_code             VARCHAR(100),
  item_name             VARCHAR(255),
  item_kind             VARCHAR(20) NOT NULL CHECK (item_kind IN ('asset', 'consumable')),
  item_category         VARCHAR(100),
  txn_type              VARCHAR(30) NOT NULL CHECK (txn_type IN (
    'opening', 'purchase', 'restock', 'issue', 'adjustment', 'write_off',
    'transfer_out', 'transfer_in', 'depreciation', 'disposal'
  )),
  quantity              NUMERIC(14, 2) NOT NULL DEFAULT 0,
  balance_after         NUMERIC(14, 2),
  unit_cost             NUMERIC(16, 2),
  amount                NUMERIC(18, 2) NOT NULL DEFAULT 0,
  currency              VARCHAR(3) NOT NULL DEFAULT 'UGX',
  fx_rate_to_base       NUMERIC(20, 8) NOT NULL DEFAULT 1,
  fx_rate_source        VARCHAR(10) NOT NULL DEFAULT 'identity',   -- identity | table | missing
  amount_base           NUMERIC(18, 2) NOT NULL DEFAULT 0,
  txn_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fiscal_year           INTEGER NOT NULL,
  department_id         UUID,
  branch_name           VARCHAR(255),
  branch_country        VARCHAR(100),
  reference_type        VARCHAR(40),
  reference_no          VARCHAR(100),
  counterparty          VARCHAR(255),
  supermarket_id        UUID,
  supermarket_product_id UUID,
  ican_transaction_id   UUID,                       -- the matching ican_transactions money row, when there is one
  actor_auth_id         UUID,
  actor_email           VARCHAR(255),
  notes                 TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cmms_itx_company_date ON public.cmms_inventory_transactions(cmms_company_id, txn_date DESC);
