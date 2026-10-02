-- ============================================================================
-- CMMS: ASSETS vs CONSUMABLES, TRANSACTION LEDGER, BUSINESS GROUP / BRANCHES,
--       SUPERMARKET (supermartkera.icanera.space) LINK
-- ============================================================================
-- Safe to run more than once. Run AFTER CMMS_COMPLETE_SCHEMA.sql and the
-- inventory fixes (FIX_INVENTORY_*.sql). The supermarket link additionally
-- needs MULTI_TENANT_PLATFORM.sql (public.supermarkets / supermarket_staff)
-- and DCE_CUSTOMER_SELFCHECKOUT.sql (public.products / public.inventory);
-- those functions raise a clear error at call time if the tables are absent,
-- the rest of this migration does not depend on them.
--
-- WHAT THIS ADDS
--   1. Business group + branches. A BRANCH is a CMMS company (it keeps running
--      its own CMMS: own staff, departments, stock, requisitions). A business
--      GROUP links those companies as one business, with a headquarters,
--      per-branch country / currency / timezone and group FX rates, so the
--      owner can read one consolidated picture across countries.
--   2. Assets vs consumables on cmms_inventory_items (item_kind), with the
--      fixed-asset fields: acquisition year/date, manufacture year, cost,
--      useful life, salvage value, depreciation method, serial/tag,
--      condition, status, warranty.
--   3. cmms_inventory_transactions: an append-only ledger. Every stock
--      movement (purchase, restock, issue, adjustment, transfer, disposal,
--      yearly depreciation ...) is written by DATABASE TRIGGERS, so it is
--      recorded no matter which screen or RPC caused it, and it cannot be
--      edited or deleted afterwards. This is the single source of truth
--      the business reports read from.
--   4. Asset register / depreciation / disposal / reconciliation / report
--      functions on top of that ledger.
--   4b. THE MONEY FEED. The same database function that writes every stock-
--      ledger row also writes the matching row in ican_transactions (the
--      business transaction record all reports read), so no screen, RPC or
--      future code path can move stock or book depreciation without it being
--      recorded as a transaction. Rules (see _cmms_money_spec):
--        purchase / paid restock  -> expense  (asset | cogs | plain expense)
--        yearly depreciation      -> expense, flagged non_cash
--        disposal with proceeds   -> income
--        issue, custody, transfer, count correction, opening balance -> no
--        money moves, so no money row.
--      fn_cmms_unposted_money_entries / fn_cmms_post_missing_money_entries
--      prove (and repair) completeness.
--   5. Supermarket link: tie a branch to its supermarket, map consumable
--      items to supermarket products, and move stock store-room <-> shop
--      floor with a signed ledger entry on the CMMS side.
--
-- IDENTITY NOTE: cmms_users.id is NOT auth.uid() in this schema (users are
-- matched by e-mail, see FIX_INVENTORY_UPDATE_RLS.sql). Every function below
-- therefore resolves the caller from auth.jwt()->>'email' and does its own
-- authorisation, like the custody functions in CMMS_STAFF_ITEM_CUSTODY_LOG.sql.
-- ============================================================================

SET check_function_bodies = off;

-- ============================================================================
-- 0. CALLER / ACCESS HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public._cmms_caller_email()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT lower(NULLIF(auth.jwt()->>'email', ''));
$$;

-- cmms_users.id of the signed-in person inside one company (NULL = not a member)
CREATE OR REPLACE FUNCTION public._cmms_member_user_id(p_company_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id
  FROM public.cmms_users u
  WHERE u.cmms_company_id = p_company_id
    AND u.is_active = TRUE
    AND public._cmms_caller_email() IS NOT NULL
    AND lower(u.email) = public._cmms_caller_email()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._cmms_is_company_admin(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cmms_users u
    WHERE u.id = public._cmms_member_user_id(p_company_id)
      AND (
        u.is_creator = TRUE
        OR lower(COALESCE(u.role, '')) = 'admin'
        OR EXISTS (
          SELECT 1
          FROM public.cmms_user_roles ur
          JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
          WHERE ur.cmms_user_id = u.id AND ur.is_active
            AND lower(r.role_name) = 'admin'
        )
      )
  );
$$;

-- Admin / creator / storeman / anyone whose role may edit inventory
CREATE OR REPLACE FUNCTION public._cmms_can_manage_inventory(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cmms_is_company_admin(p_company_id)
      OR EXISTS (
        SELECT 1
        FROM public.cmms_users u
        WHERE u.id = public._cmms_member_user_id(p_company_id)
          AND (
            lower(COALESCE(u.role, '')) = 'storeman'
            OR EXISTS (
              SELECT 1
              FROM public.cmms_user_roles ur
              JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
              WHERE ur.cmms_user_id = u.id AND ur.is_active
                AND (lower(r.role_name) = 'storeman' OR r.can_edit_inventory = TRUE)
            )
          )
      );
$$;

-- ============================================================================
-- 1. BUSINESS GROUP + BRANCH COLUMNS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cmms_business_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  base_currency VARCHAR(3)   NOT NULL DEFAULT 'UGX',
  created_by    UUID,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS group_id        UUID REFERENCES public.cmms_business_groups(id) ON DELETE SET NULL;
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS branch_name     VARCHAR(255);
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS branch_code     VARCHAR(30);
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS country         VARCHAR(100);
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS currency        VARCHAR(3) NOT NULL DEFAULT 'UGX';
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS timezone        VARCHAR(60);
-- The supermarket (public.supermarkets.id) this branch is wired to. No FK on
-- purpose: that table lives in the shared supermarket schema.
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS supermarket_id  UUID;

CREATE INDEX IF NOT EXISTS idx_cmms_company_group ON public.cmms_company_profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_cmms_company_supermarket ON public.cmms_company_profiles(supermarket_id);
-- One headquarters per group
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_one_hq_per_group
  ON public.cmms_company_profiles(group_id) WHERE is_headquarters AND group_id IS NOT NULL;

-- Group FX: how many BASE-currency units one unit of `currency` is worth
CREATE TABLE IF NOT EXISTS public.cmms_group_fx_rates (
  group_id       UUID NOT NULL REFERENCES public.cmms_business_groups(id) ON DELETE CASCADE,
  currency       VARCHAR(3) NOT NULL,
  rate_to_base   NUMERIC(20, 8) NOT NULL CHECK (rate_to_base > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, currency, effective_from)
);

-- Can the caller see this company's books? A member of the company, or an
-- admin of the group's headquarters (head office sees every branch).
CREATE OR REPLACE FUNCTION public._cmms_can_view_company(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cmms_member_user_id(p_company_id) IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.cmms_company_profiles c
        JOIN public.cmms_company_profiles hq ON hq.group_id = c.group_id AND hq.is_headquarters
        WHERE c.id = p_company_id AND c.group_id IS NOT NULL
          AND public._cmms_is_company_admin(hq.id)
      );
$$;

-- Group-wide reads: only admins of the group's headquarters
CREATE OR REPLACE FUNCTION public._cmms_is_group_hq_admin(p_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_group_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cmms_company_profiles hq
    WHERE hq.group_id = p_group_id AND hq.is_headquarters
      AND public._cmms_is_company_admin(hq.id)
  );
$$;

ALTER TABLE public.cmms_business_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmms_group_select ON public.cmms_business_groups;
CREATE POLICY cmms_group_select ON public.cmms_business_groups FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.cmms_company_profiles c
          WHERE c.group_id = cmms_business_groups.id AND public._cmms_can_view_company(c.id))
);

ALTER TABLE public.cmms_group_fx_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmms_fx_select ON public.cmms_group_fx_rates;
CREATE POLICY cmms_fx_select ON public.cmms_group_fx_rates FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.cmms_company_profiles c
          WHERE c.group_id = cmms_group_fx_rates.group_id AND public._cmms_can_view_company(c.id))
);

-- ============================================================================
-- 2. ASSETS vs CONSUMABLES  (columns on cmms_inventory_items)
-- ============================================================================

ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS assigned_storeman_id UUID;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS item_kind           VARCHAR(20);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS asset_tag           VARCHAR(100);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS serial_number       VARCHAR(150);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS manufacturer        VARCHAR(150);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS model               VARCHAR(150);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS manufacture_year    INTEGER;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS acquisition_date    DATE;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS acquisition_year    INTEGER;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS acquisition_cost    NUMERIC(16, 2);   -- per unit
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS useful_life_years   INTEGER;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS salvage_value       NUMERIC(16, 2) DEFAULT 0; -- per unit
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS depreciation_method VARCHAR(20);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS asset_condition     VARCHAR(20);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS asset_status        VARCHAR(20);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS warranty_expiry     DATE;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS disposed_at         TIMESTAMPTZ;
-- Supermarket product this consumable is the back-store stock of
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS linked_supermarket_id UUID;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS linked_product_id     UUID;

-- Which categories are fixed assets (durable, depreciated) rather than
-- consumables (used up / resold). Extend the list here if you add categories.
CREATE OR REPLACE FUNCTION public._cmms_kind_from_category(p_category TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(btrim(COALESCE(p_category, ''))) IN (
    'equipment', 'tools', 'machinery', 'plant & machinery', 'vehicles', 'vehicle',
    'it equipment', 'furniture', 'furniture & fittings', 'buildings', 'building',
    'land', 'fixed asset', 'fixed assets', 'asset', 'assets'
  ) THEN 'asset' ELSE 'consumable' END;
$$;

-- One-time backfill of existing rows, then lock the column down. Done inside a
-- guard so re-running the migration never re-classifies rows people corrected.
DO $$
BEGIN
  UPDATE public.cmms_inventory_items
  SET item_kind = public._cmms_kind_from_category(category)
  WHERE item_kind IS NULL;

  UPDATE public.cmms_inventory_items
  SET acquisition_year     = COALESCE(acquisition_year, EXTRACT(YEAR FROM COALESCE(acquisition_date, created_at, NOW()))::INT),
      acquisition_cost     = COALESCE(acquisition_cost, unit_price),
      useful_life_years    = COALESCE(useful_life_years, 5),
      depreciation_method  = COALESCE(depreciation_method, 'straight_line'),
      asset_condition      = COALESCE(asset_condition, 'good'),
      asset_status         = COALESCE(asset_status, 'in_service')
  WHERE item_kind = 'asset';
END $$;

ALTER TABLE public.cmms_inventory_items ALTER COLUMN item_kind SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cmms_item_kind') THEN
    ALTER TABLE public.cmms_inventory_items ADD CONSTRAINT chk_cmms_item_kind CHECK (item_kind IN ('asset', 'consumable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cmms_item_dep_method') THEN
    ALTER TABLE public.cmms_inventory_items ADD CONSTRAINT chk_cmms_item_dep_method
      CHECK (depreciation_method IS NULL OR depreciation_method IN ('straight_line', 'declining_balance', 'none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cmms_item_asset_status') THEN
    ALTER TABLE public.cmms_inventory_items ADD CONSTRAINT chk_cmms_item_asset_status
      CHECK (asset_status IS NULL OR asset_status IN ('in_service', 'in_repair', 'idle', 'disposed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cmms_item_years') THEN
    ALTER TABLE public.cmms_inventory_items ADD CONSTRAINT chk_cmms_item_years
      CHECK ((acquisition_year  IS NULL OR acquisition_year  BETWEEN 1900 AND 2200)
         AND (manufacture_year  IS NULL OR manufacture_year  BETWEEN 1800 AND 2200)
         AND (useful_life_years IS NULL OR useful_life_years BETWEEN 1 AND 100));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cmms_inventory_kind ON public.cmms_inventory_items(cmms_company_id, item_kind) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_linked_product ON public.cmms_inventory_items(linked_product_id) WHERE linked_product_id IS NOT NULL;

-- Defaults for new rows. The kind comes from the category unless the caller
-- set it, so the existing create RPC (which knows nothing about kinds) still
-- lands assets as assets.
CREATE OR REPLACE FUNCTION public._cmms_item_defaults()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_kind IS NULL THEN
    NEW.item_kind := public._cmms_kind_from_category(NEW.category);
  END IF;

  IF NEW.item_kind = 'asset' THEN
    NEW.acquisition_cost    := COALESCE(NEW.acquisition_cost, NEW.unit_price);
    NEW.acquisition_year    := COALESCE(NEW.acquisition_year,
                                        EXTRACT(YEAR FROM COALESCE(NEW.acquisition_date, NOW()))::INT);
    NEW.useful_life_years   := COALESCE(NEW.useful_life_years, 5);
    NEW.depreciation_method := COALESCE(NEW.depreciation_method, 'straight_line');
    NEW.asset_condition     := COALESCE(NEW.asset_condition, 'good');
    NEW.asset_status        := COALESCE(NEW.asset_status, 'in_service');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_item_defaults ON public.cmms_inventory_items;
CREATE TRIGGER trg_cmms_item_defaults
  BEFORE INSERT OR UPDATE OF item_kind, category ON public.cmms_inventory_items
  FOR EACH ROW EXECUTE FUNCTION public._cmms_item_defaults();

-- ----------------------------------------------------------------------------
-- Depreciation maths (pure). Convention: a full year of depreciation is taken
-- in the year of acquisition. Returns ACCUMULATED depreciation PER UNIT at the
-- end of p_as_of_year, never beyond cost - salvage.
-- ----------------------------------------------------------------------------
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

-- ============================================================================
-- 3. THE TRANSACTION LEDGER (append-only, trigger-fed)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cmms_inventory_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id       UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  group_id              UUID,
  -- The item may later be deleted; the ledger keeps its own snapshot.
  item_id               UUID REFERENCES public.cmms_inventory_items(id) ON DELETE SET NULL,
  item_code             VARCHAR(100),
  item_name             VARCHAR(255),
  item_kind             VARCHAR(20) NOT NULL CHECK (item_kind IN ('asset', 'consumable')),
  item_category         VARCHAR(100),
  txn_type              VARCHAR(30) NOT NULL CHECK (txn_type IN (
    'opening', 'purchase', 'restock', 'issue', 'adjustment', 'write_off',
    'transfer_out', 'transfer_in', 'depreciation', 'disposal'
  )),
  -- Signed: + stock in, - stock out, 0 for pure value entries (depreciation)
  quantity              NUMERIC(14, 2) NOT NULL DEFAULT 0,
  balance_after         NUMERIC(14, 2),
  unit_cost             NUMERIC(16, 2),
  -- Always the positive money value of the movement, in the branch currency
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
CREATE INDEX IF NOT EXISTS idx_cmms_itx_group_year   ON public.cmms_inventory_transactions(group_id, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_cmms_itx_item         ON public.cmms_inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_cmms_itx_type         ON public.cmms_inventory_transactions(cmms_company_id, txn_type, fiscal_year);
-- Depreciation can be posted for an item/year exactly once
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_itx_depreciation_once
  ON public.cmms_inventory_transactions(item_id, fiscal_year) WHERE txn_type = 'depreciation';

-- Immutability. A row can only gain its ican_transaction_id link, once. Nothing
-- else about it can ever change.
CREATE OR REPLACE FUNCTION public._cmms_itx_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A direct DELETE runs this trigger at depth 1. Deleting a whole company
    -- cascades from an FK trigger (depth 2) and is allowed.
    IF pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'cmms_inventory_transactions is append-only: rows cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.ican_transaction_id IS NULL
     AND (to_jsonb(NEW) - 'ican_transaction_id') = (to_jsonb(OLD) - 'ican_transaction_id') THEN
    RETURN NEW;   -- only the money-ledger link was added
  END IF;

  -- Hard-deleting an item nulls item_id here through the FK (depth 2). The
  -- row keeps its own item_code / item_name / item_kind snapshot.
  IF pg_trigger_depth() > 1 AND NEW.item_id IS NULL
     AND (to_jsonb(NEW) - 'item_id') = (to_jsonb(OLD) - 'item_id') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'cmms_inventory_transactions is append-only: rows cannot be edited';
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_itx_immutable ON public.cmms_inventory_transactions;
CREATE TRIGGER trg_cmms_itx_immutable
  BEFORE UPDATE OR DELETE ON public.cmms_inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public._cmms_itx_immutable();

ALTER TABLE public.cmms_inventory_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmms_itx_select ON public.cmms_inventory_transactions;
CREATE POLICY cmms_itx_select ON public.cmms_inventory_transactions
  FOR SELECT USING (public._cmms_can_view_company(cmms_company_id));
-- No INSERT/UPDATE/DELETE policy: only the SECURITY DEFINER functions below write.
REVOKE INSERT, UPDATE, DELETE ON public.cmms_inventory_transactions FROM anon, authenticated;
GRANT SELECT ON public.cmms_inventory_transactions TO authenticated;

-- Statement-scoped hints a calling function can set with set_config(.., true)
-- so the trigger records a precise type instead of guessing from the sign.
CREATE OR REPLACE FUNCTION public._cmms_guc(p_name TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting(p_name, TRUE), '');
$$;

CREATE OR REPLACE FUNCTION public._cmms_fx_rate(p_company_id UUID, p_on DATE, OUT rate NUMERIC, OUT source TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group UUID; v_cur TEXT; v_base TEXT;
BEGIN
  SELECT c.group_id, c.currency, g.base_currency INTO v_group, v_cur, v_base
  FROM public.cmms_company_profiles c
  LEFT JOIN public.cmms_business_groups g ON g.id = c.group_id
  WHERE c.id = p_company_id;

  IF v_group IS NULL OR v_base IS NULL OR v_cur IS NOT DISTINCT FROM v_base THEN
    rate := 1; source := 'identity'; RETURN;
  END IF;

  SELECT f.rate_to_base INTO rate
  FROM public.cmms_group_fx_rates f
  WHERE f.group_id = v_group AND f.currency = v_cur AND f.effective_from <= p_on
  ORDER BY f.effective_from DESC LIMIT 1;

  IF rate IS NULL THEN rate := 1; source := 'missing'; ELSE source := 'table'; END IF;
END;
$$;

-- The one place a ledger row is written.
CREATE OR REPLACE FUNCTION public._cmms_write_inventory_txn(
  p_item public.cmms_inventory_items,
  p_type TEXT,
  p_qty NUMERIC,
  p_unit_cost NUMERIC,
  p_amount NUMERIC,
  p_date TIMESTAMPTZ DEFAULT NOW(),
  p_ref_type TEXT DEFAULT NULL,
  p_ref_no TEXT DEFAULT NULL,
  p_counterparty TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_meta JSONB DEFAULT '{}'::JSONB,
  p_supermarket_id UUID DEFAULT NULL,
  p_product_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co RECORD; v_fx RECORD; v_id UUID; v_amt NUMERIC := ROUND(ABS(COALESCE(p_amount, 0)), 2);
BEGIN
  SELECT c.id, c.group_id, c.currency, c.branch_name, c.company_name, c.country
    INTO v_co FROM public.cmms_company_profiles c WHERE c.id = p_item.cmms_company_id;
  SELECT * INTO v_fx FROM public._cmms_fx_rate(p_item.cmms_company_id, p_date::DATE);

  INSERT INTO public.cmms_inventory_transactions (
    cmms_company_id, group_id, item_id, item_code, item_name, item_kind, item_category, txn_type,
    quantity, balance_after, unit_cost, amount, currency, fx_rate_to_base, fx_rate_source, amount_base,
    txn_date, fiscal_year, department_id, branch_name, branch_country,
    reference_type, reference_no, counterparty, supermarket_id, supermarket_product_id,
    actor_auth_id, actor_email, notes, metadata
  ) VALUES (
    p_item.cmms_company_id, v_co.group_id, p_item.id, p_item.item_code, p_item.item_name, p_item.item_kind, p_item.category, p_type,
    COALESCE(p_qty, 0), p_item.quantity_in_stock, p_unit_cost, v_amt,
    COALESCE(v_co.currency, 'UGX'), v_fx.rate, v_fx.source, ROUND(v_amt * v_fx.rate, 2),
    p_date, EXTRACT(YEAR FROM p_date)::INT, p_item.department_id,
    COALESCE(v_co.branch_name, v_co.company_name), v_co.country,
    p_ref_type, p_ref_no, p_counterparty, p_supermarket_id, p_product_id,
    auth.uid(), public._cmms_caller_email(), p_notes, COALESCE(p_meta, '{}'::JSONB)
  ) RETURNING id INTO v_id;

  -- Same statement, same transaction: the money row follows the stock row.
  PERFORM public._cmms_feed_money(v_id);

  RETURN v_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- THE MONEY FEED: which stock-ledger rows are money transactions, and how they
-- are booked in ican_transactions (what the business reports read).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cmms_money_spec(t public.cmms_inventory_transactions)
RETURNS TABLE (m_feed BOOLEAN, m_direction TEXT, m_amount NUMERIC, m_accounting_type TEXT, m_label TEXT)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_cat TEXT := lower(btrim(COALESCE(t.item_category, '')));
  v_proceeds NUMERIC;
BEGIN
  m_feed := FALSE; m_direction := NULL; m_amount := 0; m_accounting_type := NULL; m_label := NULL;

  IF t.txn_type = 'purchase' OR (t.txn_type = 'restock' AND t.reference_type = 'purchase') THEN
    -- Money went out to buy it. Assets are capital purchases; stock-in-trade is
    -- cost of goods; everything else (oils, consumables...) a plain expense.
    m_feed := t.amount > 0; m_direction := 'expense'; m_amount := t.amount; m_label := t.txn_type;
    m_accounting_type := CASE
      WHEN t.item_kind = 'asset' THEN 'asset'
      WHEN v_cat IN ('retail stock', 'materials', 'spare parts', 'raw materials') THEN 'cogs'
      ELSE NULL END;
  ELSIF t.txn_type = 'depreciation' THEN
    -- A real expense in the profit and loss, but no cash leaves: flagged non_cash.
    m_feed := t.amount > 0; m_direction := 'expense'; m_amount := t.amount;
    m_accounting_type := 'depreciation'; m_label := 'depreciation ' || t.fiscal_year;
  ELSIF t.txn_type = 'disposal' THEN
    v_proceeds := COALESCE(NULLIF(t.metadata->>'proceeds', '')::NUMERIC, 0);
    m_feed := v_proceeds > 0; m_direction := 'income'; m_amount := v_proceeds;
    m_accounting_type := 'revenue'; m_label := 'asset disposal proceeds';
  END IF;
  -- issue, transfers, opening balance, count adjustments: stock moves, money does not.
  RETURN NEXT;
END;
$$;

-- Book one ledger row in ican_transactions and link it. Never raises: a failure
-- to book must not block a stock movement, and it stays visible (and repairable)
-- through fn_cmms_unposted_money_entries.
CREATE OR REPLACE FUNCTION public._cmms_feed_money(p_txn_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.cmms_inventory_transactions;
  spec RECORD; v_co JSONB; v_business UUID; v_user UUID; v_money UUID;
BEGIN
  IF to_regclass('public.ican_transactions') IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.cmms_inventory_transactions WHERE id = p_txn_id;
  IF NOT FOUND OR t.ican_transaction_id IS NOT NULL THEN RETURN t.ican_transaction_id; END IF;

  SELECT * INTO spec FROM public._cmms_money_spec(t);
  IF NOT spec.m_feed THEN RETURN NULL; END IF;

  SELECT to_jsonb(c) INTO v_co FROM public.cmms_company_profiles c WHERE c.id = t.cmms_company_id;
  v_business := NULLIF(v_co->>'pichin_business_profile_id', '')::UUID;
  v_user := t.actor_auth_id;
  IF v_user IS NULL AND v_business IS NOT NULL AND to_regclass('public.business_profiles') IS NOT NULL THEN
    EXECUTE 'SELECT user_id FROM public.business_profiles WHERE id = $1' INTO v_user USING v_business;
  END IF;
  IF v_user IS NULL THEN RETURN NULL; END IF;     -- nobody to book it to; reported as unposted

  INSERT INTO public.ican_transactions (
    user_id, transaction_type, amount, currency, description, status, business_profile_id, metadata, created_at
  ) VALUES (
    v_user, spec.m_direction, spec.m_amount, t.currency,
    format('%s%s — CMMS %s', COALESCE(t.item_name, 'Inventory item'),
           CASE WHEN t.item_category IS NULL THEN '' ELSE ' (' || t.item_category || ')' END, spec.m_label),
    'completed', v_business,
    jsonb_strip_nulls(jsonb_build_object(
      'category', 'cmms_inventory', 'source_app', 'cmms', 'record_category', 'business',
      'accounting_type', spec.m_accounting_type,
      'product_name', t.item_name,
      'cmms_company_id', t.cmms_company_id, 'cmms_item_id', t.item_id, 'cmms_txn_id', t.id,
      'cmms_item_kind', t.item_kind, 'cmms_txn_type', t.txn_type,
      'branch_name', t.branch_name, 'non_cash', CASE WHEN t.txn_type = 'depreciation' THEN TRUE END)),
    t.txn_date
  ) RETURNING id INTO v_money;

  UPDATE public.cmms_inventory_transactions SET ican_transaction_id = v_money WHERE id = t.id;
  RETURN v_money;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'CMMS money feed failed for ledger row %: %', p_txn_id, SQLERRM;
  RETURN NULL;
END;
$$;

-- Every NEW item is a purchase; an asset registered with a PAST acquisition
-- year is already owned, so it opens the books in that year and no money moves.
CREATE OR REPLACE FUNCTION public._cmms_item_ledger_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_unit NUMERIC := COALESCE(CASE WHEN NEW.item_kind = 'asset' THEN NEW.acquisition_cost END, NEW.unit_price, 0);
  v_legacy BOOLEAN := NEW.item_kind = 'asset' AND (
    (NEW.acquisition_date IS NOT NULL AND NEW.acquisition_date < date_trunc('year', NOW())::DATE)
    OR (NEW.acquisition_date IS NULL AND NEW.acquisition_year < EXTRACT(YEAR FROM NOW())::INT));
  v_when TIMESTAMPTZ := CASE
    WHEN NEW.acquisition_date IS NOT NULL THEN NEW.acquisition_date::TIMESTAMPTZ
    WHEN v_legacy THEN make_date(NEW.acquisition_year, 12, 31)::TIMESTAMPTZ
    ELSE NOW() END;
BEGIN
  IF COALESCE(NEW.quantity_in_stock, 0) > 0 THEN
    PERFORM public._cmms_write_inventory_txn(
      NEW, COALESCE(public._cmms_guc('cmms.txn_type'), CASE WHEN v_legacy THEN 'opening' ELSE 'purchase' END),
      NEW.quantity_in_stock, v_unit, NEW.quantity_in_stock * v_unit, v_when,
      COALESCE(public._cmms_guc('cmms.txn_reference_type'), CASE WHEN v_legacy THEN 'legacy_asset' ELSE 'manual' END),
      public._cmms_guc('cmms.txn_reference_no'), NEW.supplier_name,
      COALESCE(public._cmms_guc('cmms.txn_notes'),
               CASE WHEN v_legacy THEN 'Asset already owned, brought into the register' ELSE 'Item added to stock records' END),
      '{}'::JSONB
    );
  END IF;
  RETURN NULL;
END;
$$;

-- Every quantity change is a movement
CREATE OR REPLACE FUNCTION public._cmms_item_ledger_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_delta NUMERIC := COALESCE(NEW.quantity_in_stock, 0) - COALESCE(OLD.quantity_in_stock, 0);
  v_unit  NUMERIC := COALESCE(NULLIF(public._cmms_guc('cmms.txn_unit_cost'), '')::NUMERIC,
                              CASE WHEN NEW.item_kind = 'asset' THEN NEW.acquisition_cost END,
                              NEW.unit_price, 0);
  v_type  TEXT;
BEGIN
  IF v_delta = 0 THEN RETURN NULL; END IF;
  v_type := COALESCE(public._cmms_guc('cmms.txn_type'), CASE WHEN v_delta > 0 THEN 'restock' ELSE 'issue' END);

  PERFORM public._cmms_write_inventory_txn(
    NEW, v_type, v_delta, v_unit, ABS(v_delta) * v_unit, NOW(),
    public._cmms_guc('cmms.txn_reference_type'), public._cmms_guc('cmms.txn_reference_no'),
    public._cmms_guc('cmms.txn_counterparty'), public._cmms_guc('cmms.txn_notes'),
    COALESCE(public._cmms_guc('cmms.txn_meta')::JSONB, '{}'::JSONB),
    public._cmms_guc('cmms.txn_supermarket_id')::UUID, public._cmms_guc('cmms.txn_product_id')::UUID
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_item_ledger_insert ON public.cmms_inventory_items;
CREATE TRIGGER trg_cmms_item_ledger_insert
  AFTER INSERT ON public.cmms_inventory_items
  FOR EACH ROW EXECUTE FUNCTION public._cmms_item_ledger_insert();

DROP TRIGGER IF EXISTS trg_cmms_item_ledger_update ON public.cmms_inventory_items;
CREATE TRIGGER trg_cmms_item_ledger_update
  AFTER UPDATE OF quantity_in_stock ON public.cmms_inventory_items
  FOR EACH ROW WHEN (OLD.quantity_in_stock IS DISTINCT FROM NEW.quantity_in_stock)
  EXECUTE FUNCTION public._cmms_item_ledger_update();

-- Opening balances for everything that already exists, so the ledger
-- reconciles with current stock from day one.
INSERT INTO public.cmms_inventory_transactions (
  cmms_company_id, group_id, item_id, item_code, item_name, item_kind, item_category, txn_type,
  quantity, balance_after, unit_cost, amount, currency, fx_rate_to_base, fx_rate_source, amount_base,
  txn_date, fiscal_year, department_id, branch_name, branch_country, reference_type, notes, metadata
)
SELECT
  i.cmms_company_id, c.group_id, i.id, i.item_code, i.item_name, i.item_kind, i.category, 'opening',
  i.quantity_in_stock, i.quantity_in_stock,
  COALESCE(CASE WHEN i.item_kind = 'asset' THEN i.acquisition_cost END, i.unit_price, 0),
  ROUND(i.quantity_in_stock * COALESCE(CASE WHEN i.item_kind = 'asset' THEN i.acquisition_cost END, i.unit_price, 0), 2),
  COALESCE(c.currency, 'UGX'), 1, 'identity',
  ROUND(i.quantity_in_stock * COALESCE(CASE WHEN i.item_kind = 'asset' THEN i.acquisition_cost END, i.unit_price, 0), 2),
  NOW(), EXTRACT(YEAR FROM NOW())::INT, i.department_id,
  COALESCE(c.branch_name, c.company_name), c.country, 'opening_balance',
  'Opening balance when the transaction ledger was switched on',
  jsonb_build_object('recorded_before_ledger', TRUE)
FROM public.cmms_inventory_items i
JOIN public.cmms_company_profiles c ON c.id = i.cmms_company_id
WHERE i.is_active = TRUE
  AND COALESCE(i.quantity_in_stock, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.cmms_inventory_transactions t WHERE t.item_id = i.id);

-- The existing functions change stock without saying why. Tag them (function-
-- level SET, no body edits) so the ledger records the real reason. Matched by
-- name so a signature difference in your database cannot break the migration.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('fn_checkout_inventory_item', 'fn_return_inventory_item', 'fn_update_inventory_item')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET cmms.txn_type = %L', r.sig,
      CASE r.proname WHEN 'fn_checkout_inventory_item' THEN 'issue'
                     WHEN 'fn_return_inventory_item'   THEN 'restock'
                     ELSE 'adjustment' END);
    EXECUTE format('ALTER FUNCTION %s SET cmms.txn_reference_type = %L', r.sig,
      CASE r.proname WHEN 'fn_update_inventory_item' THEN 'manual_edit' ELSE 'staff_custody' END);
  END LOOP;
END $$;

-- ============================================================================
-- 4. WRITE FUNCTIONS: item details, linking to the money ledger, depreciation,
--    disposal
-- ============================================================================

-- Return all columns (old and new) so the client can always map an item
DROP FUNCTION IF EXISTS public.fn_get_company_inventory(uuid) CASCADE;
CREATE FUNCTION public.fn_get_company_inventory(p_company_id uuid)
RETURNS SETOF public.cmms_inventory_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Company ID is required';
  END IF;
  RETURN QUERY
  SELECT i.* FROM public.cmms_inventory_items i
  WHERE i.cmms_company_id = p_company_id AND i.is_active = TRUE
  ORDER BY i.item_code ASC;
END;
$$;
ALTER FUNCTION public.fn_get_company_inventory(uuid) SET row_security = OFF;
GRANT EXECUTE ON FUNCTION public.fn_get_company_inventory(uuid) TO authenticated;

-- Set / change asset (or classification) details on an item.
CREATE OR REPLACE FUNCTION public.fn_cmms_set_item_details(p_item_id UUID, p_details JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.cmms_inventory_items%ROWTYPE;
  v_new  public.cmms_inventory_items%ROWTYPE;
  v_year INT := EXTRACT(YEAR FROM NOW())::INT;
BEGIN
  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF NOT public._cmms_can_manage_inventory(v_item.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to change this item';
  END IF;

  IF p_details ? 'item_kind' AND p_details->>'item_kind' NOT IN ('asset', 'consumable') THEN
    RAISE EXCEPTION 'item_kind must be asset or consumable';
  END IF;
  IF p_details ? 'depreciation_method' AND NULLIF(p_details->>'depreciation_method', '') IS NOT NULL
     AND p_details->>'depreciation_method' NOT IN ('straight_line', 'declining_balance', 'none') THEN
    RAISE EXCEPTION 'Unknown depreciation method';
  END IF;
  IF p_details ? 'acquisition_year' AND NULLIF(p_details->>'acquisition_year', '') IS NOT NULL
     AND (p_details->>'acquisition_year')::INT > v_year + 1 THEN
    RAISE EXCEPTION 'Acquisition year cannot be in the future';
  END IF;

  UPDATE public.cmms_inventory_items SET
    item_kind           = COALESCE(NULLIF(p_details->>'item_kind', ''), item_kind),
    asset_tag           = CASE WHEN p_details ? 'asset_tag'           THEN NULLIF(p_details->>'asset_tag', '')           ELSE asset_tag END,
    serial_number       = CASE WHEN p_details ? 'serial_number'       THEN NULLIF(p_details->>'serial_number', '')       ELSE serial_number END,
    manufacturer        = CASE WHEN p_details ? 'manufacturer'        THEN NULLIF(p_details->>'manufacturer', '')        ELSE manufacturer END,
    model               = CASE WHEN p_details ? 'model'               THEN NULLIF(p_details->>'model', '')               ELSE model END,
    manufacture_year    = CASE WHEN p_details ? 'manufacture_year'    THEN NULLIF(p_details->>'manufacture_year', '')::INT    ELSE manufacture_year END,
    acquisition_date    = CASE WHEN p_details ? 'acquisition_date'    THEN NULLIF(p_details->>'acquisition_date', '')::DATE   ELSE acquisition_date END,
    acquisition_year    = CASE WHEN p_details ? 'acquisition_year'    THEN NULLIF(p_details->>'acquisition_year', '')::INT    ELSE acquisition_year END,
    acquisition_cost    = CASE WHEN p_details ? 'acquisition_cost'    THEN NULLIF(p_details->>'acquisition_cost', '')::NUMERIC ELSE acquisition_cost END,
    useful_life_years   = CASE WHEN p_details ? 'useful_life_years'   THEN NULLIF(p_details->>'useful_life_years', '')::INT   ELSE useful_life_years END,
    salvage_value       = CASE WHEN p_details ? 'salvage_value'       THEN COALESCE(NULLIF(p_details->>'salvage_value', '')::NUMERIC, 0) ELSE salvage_value END,
    depreciation_method = CASE WHEN p_details ? 'depreciation_method' THEN NULLIF(p_details->>'depreciation_method', '') ELSE depreciation_method END,
    asset_condition     = CASE WHEN p_details ? 'asset_condition'     THEN NULLIF(p_details->>'asset_condition', '')     ELSE asset_condition END,
    asset_status        = CASE WHEN p_details ? 'asset_status'        THEN NULLIF(p_details->>'asset_status', '')        ELSE asset_status END,
    warranty_expiry     = CASE WHEN p_details ? 'warranty_expiry'     THEN NULLIF(p_details->>'warranty_expiry', '')::DATE    ELSE warranty_expiry END,
    updated_at          = NOW()
  WHERE id = p_item_id;

  -- Legacy reports read unit_price; for an asset that IS its acquisition cost.
  UPDATE public.cmms_inventory_items
  SET unit_price = acquisition_cost
  WHERE id = p_item_id AND item_kind = 'asset' AND acquisition_cost IS NOT NULL
        AND (p_details ? 'acquisition_cost');

  SELECT * INTO v_new FROM public.cmms_inventory_items WHERE id = p_item_id;

  RETURN to_jsonb(v_new);
END;
$$;

-- Create an item in ONE step with everything known up front (kind, asset
-- details, year acquired). The ledger trigger then sees the complete row, so a
-- machine bought in 2019 opens the books in 2019 and an item bought today is
-- booked as today's purchase, in the money record as well.
CREATE OR REPLACE FUNCTION public.fn_cmms_create_item(p_company_id UUID, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name TEXT := NULLIF(btrim(p_payload->>'item_name'), '');
  v_dept UUID := NULLIF(p_payload->>'department_id', '')::UUID;
  v_code TEXT; v_row public.cmms_inventory_items; v_user UUID; v_try INT := 0;
BEGIN
  IF NOT public._cmms_can_manage_inventory(p_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to add inventory items';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Item name is required'; END IF;
  IF v_dept IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.cmms_departments WHERE id = v_dept AND cmms_company_id = p_company_id) THEN
    RAISE EXCEPTION 'Department not found in this company';
  END IF;
  IF COALESCE(NULLIF(p_payload->>'quantity_in_stock', '')::NUMERIC, 0) < 0
     OR COALESCE(NULLIF(COALESCE(p_payload->>'unit_price', p_payload->>'unit_cost'), '')::NUMERIC, 0) < 0 THEN
    RAISE EXCEPTION 'Quantity and cost cannot be negative';
  END IF;

  v_user := public._cmms_member_user_id(p_company_id);
  v_code := COALESCE(NULLIF(btrim(p_payload->>'item_code'), ''), substr(v_name, 1, 10) || '-' || to_char(NOW(), 'MMDD'));
  WHILE EXISTS (SELECT 1 FROM public.cmms_inventory_items
                WHERE cmms_company_id = p_company_id AND item_code = v_code
                  AND department_id IS NOT DISTINCT FROM v_dept) AND v_try < 20 LOOP
    v_try := v_try + 1;
    v_code := COALESCE(NULLIF(btrim(p_payload->>'item_code'), ''), substr(v_name, 1, 10) || '-' || to_char(NOW(), 'MMDD'))
              || '-' || substr(md5(random()::TEXT), 1, 3);
  END LOOP;

  INSERT INTO public.cmms_inventory_items (
    cmms_company_id, department_id, item_name, item_code, description, category,
    quantity_in_stock, reorder_level, unit_price, supplier_name, storage_location, bin_number,
    unit_of_measure, lead_time_days, assigned_storeman_id, is_active, created_by, last_updated_by, last_stock_check,
    item_kind, asset_tag, serial_number, manufacturer, model, manufacture_year, acquisition_date, acquisition_year,
    acquisition_cost, useful_life_years, salvage_value, depreciation_method, asset_condition, asset_status, warranty_expiry
  ) VALUES (
    p_company_id, v_dept, v_name, v_code, p_payload->>'description',
    COALESCE(NULLIF(p_payload->>'category', ''), 'Spare Parts'),
    COALESCE(NULLIF(p_payload->>'quantity_in_stock', '')::NUMERIC, 0),
    COALESCE(NULLIF(COALESCE(p_payload->>'reorder_level', p_payload->>'minimum_stock_level'), '')::NUMERIC, 0),
    COALESCE(NULLIF(COALESCE(p_payload->>'unit_price', p_payload->>'unit_cost'), '')::NUMERIC, 0),
    p_payload->>'supplier_name', p_payload->>'storage_location', p_payload->>'bin_number',
    COALESCE(NULLIF(p_payload->>'unit_of_measure', ''), 'units'),
    COALESCE(NULLIF(p_payload->>'lead_time_days', '')::INT, 0),
    NULLIF(p_payload->>'assigned_storeman_id', '')::UUID, TRUE, v_user, v_user, NOW(),
    NULLIF(p_payload->>'item_kind', ''),
    NULLIF(p_payload->>'asset_tag', ''), NULLIF(p_payload->>'serial_number', ''),
    NULLIF(p_payload->>'manufacturer', ''), NULLIF(p_payload->>'model', ''),
    NULLIF(p_payload->>'manufacture_year', '')::INT, NULLIF(p_payload->>'acquisition_date', '')::DATE,
    NULLIF(p_payload->>'acquisition_year', '')::INT, NULLIF(p_payload->>'acquisition_cost', '')::NUMERIC,
    NULLIF(p_payload->>'useful_life_years', '')::INT, COALESCE(NULLIF(p_payload->>'salvage_value', '')::NUMERIC, 0),
    NULLIF(p_payload->>'depreciation_method', ''), NULLIF(p_payload->>'asset_condition', ''),
    NULLIF(p_payload->>'asset_status', ''), NULLIF(p_payload->>'warranty_expiry', '')::DATE
  ) RETURNING * INTO v_row;

  -- An asset's unit_price IS its acquisition cost (legacy reports read unit_price).
  IF v_row.item_kind = 'asset' AND v_row.acquisition_cost IS NOT NULL AND v_row.unit_price IS DISTINCT FROM v_row.acquisition_cost THEN
    UPDATE public.cmms_inventory_items SET unit_price = acquisition_cost WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- Set an item's quantity. An increase marked as a purchase is a restock the
-- business paid for (it lands in the money record); anything else is a count
-- correction (stock ledger only).
CREATE OR REPLACE FUNCTION public.fn_cmms_set_item_quantity(
  p_item_id UUID, p_new_quantity NUMERIC, p_reason TEXT DEFAULT NULL, p_is_purchase BOOLEAN DEFAULT TRUE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item public.cmms_inventory_items%ROWTYPE; v_purchase BOOLEAN; v_row public.cmms_inventory_items;
BEGIN
  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF NOT public._cmms_can_manage_inventory(v_item.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to change this stock';
  END IF;
  IF p_new_quantity IS NULL OR p_new_quantity < 0 THEN RAISE EXCEPTION 'Quantity cannot be negative'; END IF;

  v_purchase := COALESCE(p_is_purchase, TRUE) AND p_new_quantity > v_item.quantity_in_stock;
  PERFORM set_config('cmms.txn_type', CASE WHEN v_purchase THEN 'restock' ELSE 'adjustment' END, TRUE);
  PERFORM set_config('cmms.txn_reference_type', CASE WHEN v_purchase THEN 'purchase' ELSE 'manual_count' END, TRUE);
  PERFORM set_config('cmms.txn_notes', COALESCE(p_reason, ''), TRUE);

  UPDATE public.cmms_inventory_items
  SET quantity_in_stock = p_new_quantity, last_stock_check = NOW(), updated_at = NOW()
  WHERE id = p_item_id RETURNING * INTO v_row;

  PERFORM set_config('cmms.txn_type', '', TRUE);
  PERFORM set_config('cmms.txn_reference_type', '', TRUE);
  PERFORM set_config('cmms.txn_notes', '', TRUE);
  RETURN to_jsonb(v_row);
END;
$$;

-- Proof of completeness: ledger rows that ARE money transactions but have no row
-- in ican_transactions (booking failed, nobody to book it to, or the money row
-- was deleted). Empty = every transaction is in the business record.
CREATE OR REPLACE FUNCTION public.fn_cmms_unposted_money_entries(p_company_id UUID)
RETURNS TABLE (txn_id UUID, txn_date TIMESTAMPTZ, txn_type VARCHAR, item_name VARCHAR, amount NUMERIC, currency VARCHAR, reason TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN RAISE EXCEPTION 'You do not have access to this branch'; END IF;
  RETURN QUERY
  SELECT t.id, t.txn_date, t.txn_type, t.item_name, s.m_amount, t.currency,
         CASE WHEN t.ican_transaction_id IS NULL THEN 'not booked yet'
              ELSE 'booked row no longer exists' END
  FROM public.cmms_inventory_transactions t
  CROSS JOIN LATERAL public._cmms_money_spec(t) s
  WHERE t.cmms_company_id = p_company_id AND s.m_feed
    AND (t.ican_transaction_id IS NULL
         OR (to_regclass('public.ican_transactions') IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.ican_transactions x WHERE x.id = t.ican_transaction_id)))
  ORDER BY t.txn_date;
END;
$$;

-- Book anything unposted. Safe to run repeatedly (a linked row is never booked twice).
CREATE OR REPLACE FUNCTION public.fn_cmms_post_missing_money_entries(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_ok INT := 0; v_left INT := 0; v_money UUID;
BEGIN
  IF NOT public._cmms_can_manage_inventory(p_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to post transactions';
  END IF;
  FOR r IN
    SELECT t.id FROM public.cmms_inventory_transactions t
    CROSS JOIN LATERAL public._cmms_money_spec(t) s
    WHERE t.cmms_company_id = p_company_id AND s.m_feed AND t.ican_transaction_id IS NULL
    ORDER BY t.txn_date
  LOOP
    -- the booking user is whoever is posting now when the original actor is unknown
    v_money := public._cmms_feed_money(r.id);
    IF v_money IS NULL THEN v_left := v_left + 1; ELSE v_ok := v_ok + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('posted', v_ok, 'still_unposted', v_left);
END;
$$;

-- Post one year of depreciation for every asset in the branch. Idempotent:
-- running it twice for the same year adds nothing.
CREATE OR REPLACE FUNCTION public.fn_cmms_post_asset_depreciation(p_company_id UUID, p_year INT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM NOW())::INT);
  v_item public.cmms_inventory_items%ROWTYPE;
  v_dep NUMERIC; v_posted INT := 0; v_total NUMERIC := 0; v_id UUID;
BEGIN
  IF NOT public._cmms_can_manage_inventory(p_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to post depreciation';
  END IF;
  IF v_year > EXTRACT(YEAR FROM NOW())::INT THEN
    RAISE EXCEPTION 'Cannot post depreciation for a future year';
  END IF;

  FOR v_item IN
    SELECT * FROM public.cmms_inventory_items
    WHERE cmms_company_id = p_company_id AND is_active AND item_kind = 'asset'
      AND COALESCE(asset_status, 'in_service') <> 'disposed'
      AND COALESCE(quantity_in_stock, 0) > 0
      AND COALESCE(depreciation_method, 'straight_line') <> 'none'
      AND acquisition_year IS NOT NULL AND acquisition_year <= v_year
  LOOP
    v_dep := ROUND(
      (public.fn_cmms_accum_depreciation(v_item.acquisition_cost, v_item.salvage_value, v_item.useful_life_years,
                                         v_item.depreciation_method, v_item.acquisition_year, v_year)
     - public.fn_cmms_accum_depreciation(v_item.acquisition_cost, v_item.salvage_value, v_item.useful_life_years,
                                         v_item.depreciation_method, v_item.acquisition_year, v_year - 1))
      * v_item.quantity_in_stock, 2);
    CONTINUE WHEN v_dep <= 0;

    BEGIN
      v_id := public._cmms_write_inventory_txn(
        v_item, 'depreciation', 0, v_item.acquisition_cost, v_dep,
        make_date(v_year, 12, 31)::TIMESTAMPTZ, 'depreciation_run', v_year::TEXT, NULL,
        format('Depreciation %s (%s)', v_year, v_item.depreciation_method),
        jsonb_build_object('method', v_item.depreciation_method, 'life_years', v_item.useful_life_years,
                           'acquisition_year', v_item.acquisition_year)
      );
      v_posted := v_posted + 1; v_total := v_total + v_dep;
    EXCEPTION WHEN unique_violation THEN
      NULL;   -- already posted for this item and year
    END;
  END LOOP;

  RETURN jsonb_build_object('year', v_year, 'items_posted', v_posted, 'total_depreciation', v_total);
END;
$$;

-- Dispose of (sell / scrap / write off) some or all units of an asset.
CREATE OR REPLACE FUNCTION public.fn_cmms_dispose_asset(
  p_item_id UUID, p_quantity NUMERIC DEFAULT NULL, p_proceeds NUMERIC DEFAULT 0, p_reason TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.cmms_inventory_items%ROWTYPE;
  v_qty NUMERIC; v_nbv_unit NUMERIC; v_year INT := EXTRACT(YEAR FROM NOW())::INT;
BEGIN
  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.item_kind <> 'asset' THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF NOT public._cmms_can_manage_inventory(v_item.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to dispose of assets';
  END IF;

  v_qty := COALESCE(p_quantity, v_item.quantity_in_stock);
  IF v_qty <= 0 OR v_qty > v_item.quantity_in_stock THEN
    RAISE EXCEPTION 'Quantity must be between 1 and % ', v_item.quantity_in_stock;
  END IF;

  v_nbv_unit := GREATEST(0, COALESCE(v_item.acquisition_cost, v_item.unit_price, 0)
    - public.fn_cmms_accum_depreciation(v_item.acquisition_cost, v_item.salvage_value, v_item.useful_life_years,
                                        v_item.depreciation_method, v_item.acquisition_year, v_year));

  -- The stock trigger writes the ledger row; these hints make it a disposal
  -- valued at net book value, with the proceeds and gain/loss on the record.
  PERFORM set_config('cmms.txn_type', 'disposal', TRUE);
  PERFORM set_config('cmms.txn_unit_cost', v_nbv_unit::TEXT, TRUE);
  PERFORM set_config('cmms.txn_reference_type', 'asset_disposal', TRUE);
  PERFORM set_config('cmms.txn_notes', COALESCE(p_reason, 'Asset disposed'), TRUE);
  PERFORM set_config('cmms.txn_meta', jsonb_build_object(
    'proceeds', COALESCE(p_proceeds, 0), 'nbv_removed', ROUND(v_nbv_unit * v_qty, 2),
    'gain_loss', ROUND(COALESCE(p_proceeds, 0) - v_nbv_unit * v_qty, 2))::TEXT, TRUE);

  UPDATE public.cmms_inventory_items
  SET quantity_in_stock = quantity_in_stock - v_qty,
      asset_status = CASE WHEN quantity_in_stock - v_qty <= 0 THEN 'disposed' ELSE asset_status END,
      disposed_at  = CASE WHEN quantity_in_stock - v_qty <= 0 THEN NOW() ELSE disposed_at END,
      updated_at = NOW()
  WHERE id = p_item_id;

  PERFORM set_config('cmms.txn_type', '', TRUE);
  PERFORM set_config('cmms.txn_unit_cost', '', TRUE);
  PERFORM set_config('cmms.txn_reference_type', '', TRUE);
  PERFORM set_config('cmms.txn_notes', '', TRUE);
  PERFORM set_config('cmms.txn_meta', '', TRUE);

  RETURN jsonb_build_object('quantity_disposed', v_qty, 'nbv_removed', ROUND(v_nbv_unit * v_qty, 2),
                            'proceeds', COALESCE(p_proceeds, 0),
                            'gain_loss', ROUND(COALESCE(p_proceeds, 0) - v_nbv_unit * v_qty, 2));
END;
$$;

-- ============================================================================
-- 5. READ FUNCTIONS: asset register, reconciliation, reports
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cmms_get_asset_register(p_company_id UUID, p_as_of_year INT DEFAULT NULL)
RETURNS TABLE (
  id UUID, item_code VARCHAR, item_name VARCHAR, category VARCHAR, department_id UUID,
  quantity NUMERIC, unit_cost NUMERIC, total_cost NUMERIC, salvage_value NUMERIC,
  acquisition_year INT, acquisition_date DATE, manufacture_year INT, age_years INT,
  useful_life_years INT, depreciation_method VARCHAR,
  accumulated_depreciation NUMERIC, net_book_value NUMERIC, depreciation_this_year NUMERIC,
  fully_depreciated BOOLEAN, asset_tag VARCHAR, serial_number VARCHAR, manufacturer VARCHAR, model VARCHAR,
  asset_condition VARCHAR, asset_status VARCHAR, warranty_expiry DATE, storage_location VARCHAR,
  supplier_name VARCHAR, currency VARCHAR
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_year INT := COALESCE(p_as_of_year, EXTRACT(YEAR FROM NOW())::INT);
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN
    RAISE EXCEPTION 'You do not have access to this branch';
  END IF;
  RETURN QUERY
  SELECT i.id, i.item_code, i.item_name, i.category, i.department_id,
    i.quantity_in_stock,
    COALESCE(i.acquisition_cost, i.unit_price, 0),
    ROUND(COALESCE(i.acquisition_cost, i.unit_price, 0) * i.quantity_in_stock, 2),
    COALESCE(i.salvage_value, 0),
    i.acquisition_year, i.acquisition_date, i.manufacture_year,
    CASE WHEN i.acquisition_year IS NULL THEN NULL ELSE GREATEST(0, v_year - i.acquisition_year) END,
    i.useful_life_years, i.depreciation_method,
    ROUND(a.acc * i.quantity_in_stock, 2),
    ROUND((COALESCE(i.acquisition_cost, i.unit_price, 0) - a.acc) * i.quantity_in_stock, 2),
    ROUND((a.acc - a.acc_prev) * i.quantity_in_stock, 2),
    (COALESCE(i.acquisition_cost, i.unit_price, 0) - a.acc) <= COALESCE(i.salvage_value, 0) AND a.acc > 0,
    i.asset_tag, i.serial_number, i.manufacturer, i.model,
    i.asset_condition, i.asset_status, i.warranty_expiry, i.storage_location, i.supplier_name,
    c.currency
  FROM public.cmms_inventory_items i
  JOIN public.cmms_company_profiles c ON c.id = i.cmms_company_id
  CROSS JOIN LATERAL (SELECT
      public.fn_cmms_accum_depreciation(COALESCE(i.acquisition_cost, i.unit_price), i.salvage_value, i.useful_life_years,
                                        i.depreciation_method, i.acquisition_year, v_year) AS acc,
      public.fn_cmms_accum_depreciation(COALESCE(i.acquisition_cost, i.unit_price), i.salvage_value, i.useful_life_years,
                                        i.depreciation_method, i.acquisition_year, v_year - 1) AS acc_prev) a
  WHERE i.cmms_company_id = p_company_id AND i.is_active AND i.item_kind = 'asset'
    AND COALESCE(i.asset_status, 'in_service') <> 'disposed'
  ORDER BY i.acquisition_year NULLS LAST, i.item_name;
END;
$$;

-- Does the ledger agree with the shelf? One row per item that does not.
CREATE OR REPLACE FUNCTION public.fn_cmms_inventory_reconciliation(p_company_id UUID)
RETURNS TABLE (item_id UUID, item_code VARCHAR, item_name VARCHAR, item_kind VARCHAR,
               stock_quantity NUMERIC, ledger_quantity NUMERIC, variance NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN
    RAISE EXCEPTION 'You do not have access to this branch';
  END IF;
  RETURN QUERY
  SELECT i.id, i.item_code, i.item_name, i.item_kind, i.quantity_in_stock,
         COALESCE(SUM(t.quantity), 0), i.quantity_in_stock - COALESCE(SUM(t.quantity), 0)
  FROM public.cmms_inventory_items i
  LEFT JOIN public.cmms_inventory_transactions t ON t.item_id = i.id
  WHERE i.cmms_company_id = p_company_id AND i.is_active
  GROUP BY i.id
  HAVING i.quantity_in_stock - COALESCE(SUM(t.quantity), 0) <> 0
  ORDER BY ABS(i.quantity_in_stock - COALESCE(SUM(t.quantity), 0)) DESC;
END;
$$;

-- The business report. p_scope 'branch' = this company only; 'group' = every
-- branch of the business (head-office admins only), consolidated into the
-- group base currency using the stored FX rates.
CREATE OR REPLACE FUNCTION public.fn_cmms_inventory_report(
  p_company_id UUID, p_year INT DEFAULT NULL, p_scope TEXT DEFAULT 'branch'
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM NOW())::INT);
  v_group UUID; v_base TEXT; v_branches JSONB := '[]'::JSONB; v_totals JSONB;
  v_ids UUID[];
BEGIN
  SELECT c.group_id INTO v_group FROM public.cmms_company_profiles c WHERE c.id = p_company_id;
  SELECT g.base_currency INTO v_base FROM public.cmms_business_groups g WHERE g.id = v_group;

  IF p_scope = 'group' AND v_group IS NOT NULL THEN
    IF NOT public._cmms_is_group_hq_admin(v_group) THEN
      RAISE EXCEPTION 'Only the head office can read the whole business';
    END IF;
    SELECT array_agg(c.id) INTO v_ids FROM public.cmms_company_profiles c WHERE c.group_id = v_group;
  ELSE
    IF NOT public._cmms_can_view_company(p_company_id) THEN
      RAISE EXCEPTION 'You do not have access to this branch';
    END IF;
    v_ids := ARRAY[p_company_id];
  END IF;

  SELECT COALESCE(jsonb_agg(b ORDER BY (b->>'is_headquarters')::BOOLEAN DESC, b->>'branch_name'), '[]'::JSONB)
  INTO v_branches
  FROM (
    SELECT jsonb_build_object(
      'company_id', c.id,
      'branch_name', COALESCE(c.branch_name, c.company_name),
      'branch_code', c.branch_code, 'country', c.country, 'currency', c.currency,
      'is_headquarters', c.is_headquarters,
      'fx_rate_to_base', (SELECT rate FROM public._cmms_fx_rate(c.id, make_date(v_year, 12, 31))),
      'fx_source', (SELECT source FROM public._cmms_fx_rate(c.id, make_date(v_year, 12, 31))),
      'assets', (
        SELECT jsonb_build_object(
          'count', COALESCE(SUM(i.quantity_in_stock), 0),
          'cost', COALESCE(ROUND(SUM(COALESCE(i.acquisition_cost, i.unit_price, 0) * i.quantity_in_stock), 2), 0),
          'accumulated_depreciation', COALESCE(ROUND(SUM(a.acc * i.quantity_in_stock), 2), 0),
          'net_book_value', COALESCE(ROUND(SUM((COALESCE(i.acquisition_cost, i.unit_price, 0) - a.acc) * i.quantity_in_stock), 2), 0))
        FROM public.cmms_inventory_items i
        CROSS JOIN LATERAL (SELECT public.fn_cmms_accum_depreciation(COALESCE(i.acquisition_cost, i.unit_price),
              i.salvage_value, i.useful_life_years, i.depreciation_method, i.acquisition_year, v_year) AS acc) a
        WHERE i.cmms_company_id = c.id AND i.is_active AND i.item_kind = 'asset'
          AND COALESCE(i.asset_status, 'in_service') <> 'disposed'),
      'consumables', (
        SELECT jsonb_build_object(
          'items', COUNT(*),
          'value', COALESCE(ROUND(SUM(i.quantity_in_stock * COALESCE(i.unit_price, 0)), 2), 0),
          'low_stock', COUNT(*) FILTER (WHERE i.quantity_in_stock <= COALESCE(i.reorder_level, 0)))
        FROM public.cmms_inventory_items i
        WHERE i.cmms_company_id = c.id AND i.is_active AND i.item_kind = 'consumable'),
      'movement', (
        SELECT COALESCE(jsonb_object_agg(m.txn_type, jsonb_build_object('amount', m.amt, 'amount_base', m.amt_base, 'count', m.n)), '{}'::JSONB)
        FROM (
          -- Base value: the rate stamped when the row was written, unless the row
          -- predates the branch joining the group (identity rate on a foreign
          -- currency), in which case it is restated at the rate for its date.
          SELECT t.txn_type, ROUND(SUM(t.amount), 2) AS amt,
                 ROUND(SUM(CASE WHEN t.fx_rate_source = 'table' OR t.currency = v_base THEN t.amount_base
                                ELSE t.amount * (SELECT r.rate FROM public._cmms_fx_rate(c.id, t.txn_date::DATE) r) END), 2) AS amt_base,
                 COUNT(*) AS n
          FROM public.cmms_inventory_transactions t
          WHERE t.cmms_company_id = c.id AND t.fiscal_year = v_year
          GROUP BY t.txn_type) m)
    ) AS b
    FROM public.cmms_company_profiles c
    WHERE c.id = ANY (v_ids)
  ) x;

  -- Consolidated totals in the base currency
  SELECT jsonb_build_object(
    'assets_cost_base',    COALESCE(ROUND(SUM((b->'assets'->>'cost')::NUMERIC * (b->>'fx_rate_to_base')::NUMERIC), 2), 0),
    'assets_nbv_base',     COALESCE(ROUND(SUM((b->'assets'->>'net_book_value')::NUMERIC * (b->>'fx_rate_to_base')::NUMERIC), 2), 0),
    'consumables_value_base', COALESCE(ROUND(SUM((b->'consumables'->>'value')::NUMERIC * (b->>'fx_rate_to_base')::NUMERIC), 2), 0),
    'purchases_base',      COALESCE(ROUND(SUM(COALESCE((b->'movement'->'purchase'->>'amount_base')::NUMERIC, 0)), 2), 0),
    'depreciation_base',   COALESCE(ROUND(SUM(COALESCE((b->'movement'->'depreciation'->>'amount_base')::NUMERIC, 0)), 2), 0)
  ) INTO v_totals
  FROM jsonb_array_elements(v_branches) AS b;

  RETURN jsonb_build_object(
    'year', v_year, 'scope', CASE WHEN p_scope = 'group' AND v_group IS NOT NULL THEN 'group' ELSE 'branch' END,
    'base_currency', COALESCE(v_base, (SELECT currency FROM public.cmms_company_profiles WHERE id = p_company_id)),
    'branches', v_branches, 'totals', v_totals);
END;
$$;

-- ============================================================================
-- 6. BUSINESS GROUP / BRANCH MANAGEMENT
-- ============================================================================

-- Start a business group with THIS company as headquarters
CREATE OR REPLACE FUNCTION public.fn_cmms_create_business_group(
  p_company_id UUID, p_name TEXT, p_base_currency TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group UUID; v_cur TEXT;
BEGIN
  IF NOT public._cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only the company administrator can start a business group';
  END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'Give the business a name'; END IF;
  IF EXISTS (SELECT 1 FROM public.cmms_company_profiles WHERE id = p_company_id AND group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This company already belongs to a business group';
  END IF;

  SELECT COALESCE(NULLIF(upper(p_base_currency), ''), currency, 'UGX') INTO v_cur
  FROM public.cmms_company_profiles WHERE id = p_company_id;

  INSERT INTO public.cmms_business_groups (name, base_currency, created_by)
  VALUES (btrim(p_name), v_cur, auth.uid()) RETURNING id INTO v_group;

  UPDATE public.cmms_company_profiles
  SET group_id = v_group, is_headquarters = TRUE,
      branch_name = COALESCE(branch_name, 'Head office'), updated_at = NOW()
  WHERE id = p_company_id;

  RETURN jsonb_build_object('group_id', v_group, 'base_currency', v_cur);
END;
$$;

-- Bring another company you administer into the group as a branch. You must
-- be admin of the group's head office AND of the company you are adding.
CREATE OR REPLACE FUNCTION public.fn_cmms_link_company_to_group(
  p_group_id UUID, p_company_id UUID, p_branch_name TEXT DEFAULT NULL, p_branch_code TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL, p_currency TEXT DEFAULT NULL, p_timezone TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_is_group_hq_admin(p_group_id) THEN
    RAISE EXCEPTION 'Only the head-office administrator can add branches';
  END IF;
  IF NOT public._cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'You must also administer the company you are adding';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cmms_company_profiles WHERE id = p_company_id AND group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'That company already belongs to a business group';
  END IF;

  UPDATE public.cmms_company_profiles SET
    group_id = p_group_id, is_headquarters = FALSE,
    branch_name = COALESCE(NULLIF(btrim(p_branch_name), ''), branch_name, company_name),
    branch_code = NULLIF(btrim(p_branch_code), ''),
    country = COALESCE(NULLIF(btrim(p_country), ''), country),
    currency = COALESCE(NULLIF(upper(btrim(p_currency)), ''), currency),
    timezone = COALESCE(NULLIF(btrim(p_timezone), ''), timezone),
    updated_at = NOW()
  WHERE id = p_company_id;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cmms_update_branch(
  p_company_id UUID, p_branch_name TEXT DEFAULT NULL, p_branch_code TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL, p_currency TEXT DEFAULT NULL, p_timezone TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group UUID;
BEGIN
  SELECT group_id INTO v_group FROM public.cmms_company_profiles WHERE id = p_company_id;
  IF NOT (public._cmms_is_company_admin(p_company_id) OR public._cmms_is_group_hq_admin(v_group)) THEN
    RAISE EXCEPTION 'You do not have permission to edit this branch';
  END IF;
  UPDATE public.cmms_company_profiles SET
    branch_name = COALESCE(NULLIF(btrim(p_branch_name), ''), branch_name),
    branch_code = COALESCE(NULLIF(btrim(p_branch_code), ''), branch_code),
    country     = COALESCE(NULLIF(btrim(p_country), ''), country),
    currency    = COALESCE(NULLIF(upper(btrim(p_currency)), ''), currency),
    timezone    = COALESCE(NULLIF(btrim(p_timezone), ''), timezone),
    updated_at = NOW()
  WHERE id = p_company_id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cmms_unlink_company_from_group(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group UUID; v_hq BOOLEAN;
BEGIN
  SELECT group_id, is_headquarters INTO v_group, v_hq FROM public.cmms_company_profiles WHERE id = p_company_id;
  IF v_group IS NULL THEN RETURN jsonb_build_object('ok', TRUE); END IF;
  IF NOT public._cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only that branch''s administrator can remove it from the group';
  END IF;
  IF v_hq AND EXISTS (SELECT 1 FROM public.cmms_company_profiles WHERE group_id = v_group AND id <> p_company_id) THEN
    RAISE EXCEPTION 'Remove the other branches before the head office leaves the group';
  END IF;
  UPDATE public.cmms_company_profiles SET group_id = NULL, is_headquarters = FALSE, updated_at = NOW() WHERE id = p_company_id;
  IF v_hq THEN DELETE FROM public.cmms_business_groups WHERE id = v_group; END IF;
  -- Past ledger rows keep the group they were written under; the branch's own
  -- history stays readable by the branch.
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cmms_set_group_fx_rate(
  p_group_id UUID, p_currency TEXT, p_rate_to_base NUMERIC, p_effective_from DATE DEFAULT CURRENT_DATE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_is_group_hq_admin(p_group_id) THEN
    RAISE EXCEPTION 'Only the head-office administrator can set exchange rates';
  END IF;
  IF p_rate_to_base IS NULL OR p_rate_to_base <= 0 THEN RAISE EXCEPTION 'Rate must be greater than zero'; END IF;
  INSERT INTO public.cmms_group_fx_rates (group_id, currency, rate_to_base, effective_from, created_by)
  VALUES (p_group_id, upper(btrim(p_currency)), p_rate_to_base, COALESCE(p_effective_from, CURRENT_DATE), auth.uid())
  ON CONFLICT (group_id, currency, effective_from) DO UPDATE SET rate_to_base = EXCLUDED.rate_to_base;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- The caller's view of the business: group, every branch they may see
CREATE OR REPLACE FUNCTION public.fn_cmms_get_my_business_group(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group UUID; v_is_hq BOOLEAN; v_out JSONB;
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN
    RAISE EXCEPTION 'You do not have access to this branch';
  END IF;
  SELECT group_id INTO v_group FROM public.cmms_company_profiles WHERE id = p_company_id;
  IF v_group IS NULL THEN
    RETURN jsonb_build_object('group', NULL, 'branches', '[]'::JSONB, 'fx_rates', '[]'::JSONB, 'is_hq_admin', FALSE);
  END IF;
  v_is_hq := public._cmms_is_group_hq_admin(v_group);

  SELECT jsonb_build_object(
    'group', (SELECT to_jsonb(g) FROM public.cmms_business_groups g WHERE g.id = v_group),
    'is_hq_admin', v_is_hq,
    'branches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', c.id, 'company_name', c.company_name,
        'branch_name', COALESCE(c.branch_name, c.company_name), 'branch_code', c.branch_code,
        'country', c.country, 'currency', c.currency, 'timezone', c.timezone,
        'is_headquarters', c.is_headquarters, 'supermarket_id', c.supermarket_id,
        'is_current', c.id = p_company_id)
        ORDER BY c.is_headquarters DESC, COALESCE(c.branch_name, c.company_name))
      FROM public.cmms_company_profiles c
      WHERE c.group_id = v_group AND (v_is_hq OR c.id = p_company_id)), '[]'::JSONB),
    'fx_rates', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.currency, f.effective_from DESC)
      FROM public.cmms_group_fx_rates f WHERE f.group_id = v_group AND v_is_hq), '[]'::JSONB)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ============================================================================
-- 7. SUPERMARKET LINK  (supermartkera.icanera.space)
-- ============================================================================

-- Supermarkets the caller owns or actively manages (to pick one to link)
CREATE OR REPLACE FUNCTION public.fn_cmms_list_my_supermarkets()
RETURNS TABLE (id UUID, name TEXT, city TEXT, country TEXT, status TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regclass('public.supermarkets') IS NULL THEN RETURN; END IF;
  RETURN QUERY EXECUTE $q$
    SELECT s.id, s.name::TEXT, s.city::TEXT, s.country::TEXT, s.status::TEXT
    FROM public.supermarkets s
    WHERE s.owner_user_id = auth.uid()
       OR EXISTS (SELECT 1 FROM public.supermarket_staff m
                  WHERE m.supermarket_id = s.id AND m.user_id = auth.uid()
                    AND m.role = 'manager' AND m.status = 'active')
    ORDER BY s.name
  $q$;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cmms_link_supermarket(p_company_id UUID, p_supermarket_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok BOOLEAN;
BEGIN
  IF NOT public._cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only the branch administrator can link a supermarket';
  END IF;
  IF to_regclass('public.supermarkets') IS NULL THEN
    RAISE EXCEPTION 'The supermarket platform is not installed in this database';
  END IF;
  EXECUTE $q$
    SELECT EXISTS (SELECT 1 FROM public.supermarkets s WHERE s.id = $1 AND (
      s.owner_user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.supermarket_staff m WHERE m.supermarket_id = s.id
                 AND m.user_id = auth.uid() AND m.role = 'manager' AND m.status = 'active')))
  $q$ INTO v_ok USING p_supermarket_id;
  IF NOT v_ok THEN RAISE EXCEPTION 'You are not an owner or manager of that supermarket'; END IF;

  UPDATE public.cmms_company_profiles SET supermarket_id = p_supermarket_id, updated_at = NOW() WHERE id = p_company_id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cmms_unlink_supermarket(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only the branch administrator can unlink the supermarket';
  END IF;
  UPDATE public.cmms_company_profiles SET supermarket_id = NULL, updated_at = NOW() WHERE id = p_company_id;
  UPDATE public.cmms_inventory_items SET linked_supermarket_id = NULL, linked_product_id = NULL
  WHERE cmms_company_id = p_company_id AND linked_product_id IS NOT NULL;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cmms_get_linked_supermarket(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sm UUID; v_out JSONB;
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN RAISE EXCEPTION 'You do not have access to this branch'; END IF;
  SELECT supermarket_id INTO v_sm FROM public.cmms_company_profiles WHERE id = p_company_id;
  IF v_sm IS NULL OR to_regclass('public.supermarkets') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$
    SELECT jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'country', s.country,
                              'status', s.status, 'slug', s.slug)
    FROM public.supermarkets s WHERE s.id = $1
  $q$ INTO v_out USING v_sm;
  RETURN v_out;
END;
$$;

-- Find products in the linked supermarket (to map a CMMS item to one)
CREATE OR REPLACE FUNCTION public.fn_cmms_search_supermarket_products(p_company_id UUID, p_query TEXT DEFAULT NULL)
RETURNS TABLE (product_id UUID, name TEXT, sku TEXT, barcode TEXT, selling_price NUMERIC, current_stock NUMERIC, available_stock NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sm UUID;
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN RAISE EXCEPTION 'You do not have access to this branch'; END IF;
  SELECT supermarket_id INTO v_sm FROM public.cmms_company_profiles WHERE id = p_company_id;
  IF v_sm IS NULL THEN RAISE EXCEPTION 'Link a supermarket to this branch first'; END IF;
  RETURN QUERY EXECUTE $q$
    SELECT p.id, p.name::TEXT, p.sku::TEXT, p.barcode::TEXT, p.selling_price::NUMERIC,
           COALESCE(inv.current_stock, 0)::NUMERIC,
           GREATEST(COALESCE(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0), 0)::NUMERIC
    FROM public.products p
    LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = p.supermarket_id
    WHERE p.supermarket_id = $1 AND (p.is_active IS NULL OR p.is_active = TRUE)
      AND ($2 IS NULL OR $2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.sku ILIKE '%' || $2 || '%' OR p.barcode = $2)
    ORDER BY p.name LIMIT 50
  $q$ USING v_sm, p_query;
END;
$$;

-- Map (or unmap, with NULL) a CMMS consumable to a supermarket product
CREATE OR REPLACE FUNCTION public.fn_cmms_link_item_to_product(p_item_id UUID, p_product_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item public.cmms_inventory_items%ROWTYPE; v_sm UUID; v_ok BOOLEAN;
BEGIN
  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF NOT public._cmms_can_manage_inventory(v_item.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to change this item';
  END IF;
  IF v_item.item_kind <> 'consumable' THEN RAISE EXCEPTION 'Only consumables can be linked to shop stock'; END IF;

  IF p_product_id IS NULL THEN
    UPDATE public.cmms_inventory_items SET linked_supermarket_id = NULL, linked_product_id = NULL, updated_at = NOW() WHERE id = p_item_id;
    RETURN jsonb_build_object('ok', TRUE);
  END IF;

  SELECT supermarket_id INTO v_sm FROM public.cmms_company_profiles WHERE id = v_item.cmms_company_id;
  IF v_sm IS NULL THEN RAISE EXCEPTION 'Link a supermarket to this branch first'; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.products p WHERE p.id = $1 AND p.supermarket_id = $2)'
    INTO v_ok USING p_product_id, v_sm;
  IF NOT v_ok THEN RAISE EXCEPTION 'That product does not belong to the linked supermarket'; END IF;

  UPDATE public.cmms_inventory_items SET linked_supermarket_id = v_sm, linked_product_id = p_product_id, updated_at = NOW()
  WHERE id = p_item_id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- Store room vs shop floor for every linked item of the branch
CREATE OR REPLACE FUNCTION public.fn_cmms_get_supermarket_stock_link(p_company_id UUID)
RETURNS TABLE (item_id UUID, item_code VARCHAR, item_name VARCHAR, store_quantity NUMERIC,
               product_id UUID, product_name TEXT, shop_quantity NUMERIC, shop_available NUMERIC, shop_price NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN RAISE EXCEPTION 'You do not have access to this branch'; END IF;
  RETURN QUERY EXECUTE $q$
    SELECT i.id, i.item_code, i.item_name, i.quantity_in_stock,
           p.id, p.name::TEXT, COALESCE(inv.current_stock, 0)::NUMERIC,
           GREATEST(COALESCE(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0), 0)::NUMERIC,
           p.selling_price::NUMERIC
    FROM public.cmms_inventory_items i
    JOIN public.products p ON p.id = i.linked_product_id
    LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = p.supermarket_id
    WHERE i.cmms_company_id = $1 AND i.is_active AND i.linked_product_id IS NOT NULL
    ORDER BY i.item_name
  $q$ USING p_company_id;
END;
$$;

-- Move stock between the CMMS store room and the supermarket shop floor.
-- p_direction 'to_shop': store -1, shop +1.  'to_store': shop -1, store +1.
-- Both sides move in ONE transaction; the CMMS side lands in the ledger as
-- transfer_out / transfer_in with the supermarket and product on the record.
CREATE OR REPLACE FUNCTION public.fn_cmms_transfer_stock_supermarket(
  p_item_id UUID, p_quantity NUMERIC, p_direction TEXT DEFAULT 'to_shop', p_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.cmms_inventory_items%ROWTYPE; v_sm UUID; v_rows INT; v_avail NUMERIC;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF p_direction NOT IN ('to_shop', 'to_store') THEN RAISE EXCEPTION 'Direction must be to_shop or to_store'; END IF;

  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF NOT public._cmms_can_manage_inventory(v_item.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to move this stock';
  END IF;
  IF v_item.linked_product_id IS NULL THEN RAISE EXCEPTION 'Link this item to a supermarket product first'; END IF;

  SELECT supermarket_id INTO v_sm FROM public.cmms_company_profiles WHERE id = v_item.cmms_company_id;
  IF v_sm IS DISTINCT FROM v_item.linked_supermarket_id THEN
    RAISE EXCEPTION 'The branch is no longer linked to this item''s supermarket';
  END IF;

  IF p_direction = 'to_shop' THEN
    IF p_quantity > v_item.quantity_in_stock THEN
      RAISE EXCEPTION 'Only % in the store room', v_item.quantity_in_stock;
    END IF;
    EXECUTE 'UPDATE public.inventory SET current_stock = COALESCE(current_stock, 0) + $1, updated_at = now()
             WHERE product_id = $2 AND supermarket_id = $3' USING p_quantity, v_item.linked_product_id, v_sm;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION 'That product has no stock record in the supermarket yet'; END IF;
  ELSE
    EXECUTE 'SELECT GREATEST(COALESCE(current_stock - COALESCE(reserved_stock, 0), 0), 0)
             FROM public.inventory WHERE product_id = $1 AND supermarket_id = $2 FOR UPDATE'
      INTO v_avail USING v_item.linked_product_id, v_sm;
    IF v_avail IS NULL THEN RAISE EXCEPTION 'That product has no stock record in the supermarket yet'; END IF;
    IF p_quantity > v_avail THEN RAISE EXCEPTION 'Only % available on the shop floor', v_avail; END IF;
    EXECUTE 'UPDATE public.inventory SET current_stock = current_stock - $1, updated_at = now()
             WHERE product_id = $2 AND supermarket_id = $3' USING p_quantity, v_item.linked_product_id, v_sm;
  END IF;

  PERFORM set_config('cmms.txn_type', CASE WHEN p_direction = 'to_shop' THEN 'transfer_out' ELSE 'transfer_in' END, TRUE);
  PERFORM set_config('cmms.txn_reference_type', 'supermarket_transfer', TRUE);
  PERFORM set_config('cmms.txn_supermarket_id', v_sm::TEXT, TRUE);
  PERFORM set_config('cmms.txn_product_id', v_item.linked_product_id::TEXT, TRUE);
  PERFORM set_config('cmms.txn_counterparty', 'Supermarket shop floor', TRUE);
  PERFORM set_config('cmms.txn_notes', COALESCE(p_note, CASE WHEN p_direction = 'to_shop'
        THEN 'Stock sent to the shop floor' ELSE 'Stock returned to the store room' END), TRUE);

  UPDATE public.cmms_inventory_items
  SET quantity_in_stock = quantity_in_stock + CASE WHEN p_direction = 'to_shop' THEN -p_quantity ELSE p_quantity END,
      updated_at = NOW()
  WHERE id = p_item_id;

  PERFORM set_config('cmms.txn_type', '', TRUE);
  PERFORM set_config('cmms.txn_reference_type', '', TRUE);
  PERFORM set_config('cmms.txn_supermarket_id', '', TRUE);
  PERFORM set_config('cmms.txn_product_id', '', TRUE);
  PERFORM set_config('cmms.txn_counterparty', '', TRUE);
  PERFORM set_config('cmms.txn_notes', '', TRUE);

  RETURN jsonb_build_object('ok', TRUE, 'direction', p_direction, 'quantity', p_quantity);
END;
$$;

-- ============================================================================
-- 8. GRANTS
-- ============================================================================
-- Reads of the group tables go through RLS (policies above); writes only ever
-- happen inside the SECURITY DEFINER functions.
GRANT SELECT ON public.cmms_business_groups, public.cmms_group_fx_rates TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.fn_cmms_accum_depreciation(NUMERIC, NUMERIC, INT, TEXT, INT, INT),
  public.fn_cmms_set_item_details(UUID, JSONB),
  public.fn_cmms_create_item(UUID, JSONB),
  public.fn_cmms_set_item_quantity(UUID, NUMERIC, TEXT, BOOLEAN),
  public.fn_cmms_unposted_money_entries(UUID),
  public.fn_cmms_post_missing_money_entries(UUID),
  public.fn_cmms_post_asset_depreciation(UUID, INT),
  public.fn_cmms_dispose_asset(UUID, NUMERIC, NUMERIC, TEXT),
  public.fn_cmms_get_asset_register(UUID, INT),
  public.fn_cmms_inventory_reconciliation(UUID),
  public.fn_cmms_inventory_report(UUID, INT, TEXT),
  public.fn_cmms_create_business_group(UUID, TEXT, TEXT),
  public.fn_cmms_link_company_to_group(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT),
  public.fn_cmms_update_branch(UUID, TEXT, TEXT, TEXT, TEXT, TEXT),
  public.fn_cmms_unlink_company_from_group(UUID),
  public.fn_cmms_set_group_fx_rate(UUID, TEXT, NUMERIC, DATE),
  public.fn_cmms_get_my_business_group(UUID),
  public.fn_cmms_list_my_supermarkets(),
  public.fn_cmms_link_supermarket(UUID, UUID),
  public.fn_cmms_unlink_supermarket(UUID),
  public.fn_cmms_get_linked_supermarket(UUID),
  public.fn_cmms_search_supermarket_products(UUID, TEXT),
  public.fn_cmms_link_item_to_product(UUID, UUID),
  public.fn_cmms_get_supermarket_stock_link(UUID),
  public.fn_cmms_transfer_stock_supermarket(UUID, NUMERIC, TEXT, TEXT)
TO authenticated;

SELECT 'CMMS assets, ledger, branches and supermarket link installed' AS status;
