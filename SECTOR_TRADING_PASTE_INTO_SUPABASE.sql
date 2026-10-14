-- ============================================================================
-- SECTOR MARKETS (ten business-sector coins, on the wallet and the public /icaneracoin page)
-- Paste this WHOLE file into the Supabase SQL editor and press Run. Once.
--
-- It is the 4 migrations in the right order:
--   1. 20261019100000_sector_trading_core.sql
--        the isolated schema, settings, the ten sectors, consent wording, the vault ledger
--   2. 20261019110000_sector_trading_telemetry.sql
--        the revenue hook (anonymous totals) and the consent gate
--   3. 20261019120000_sector_trading_index.sql
--        the index engine, candles, the public feed, the 5-second fold
--   4. 20261019130000_sector_trading_execute.sql
--        buying and selling, the vault, risk limits, operator tools
--
-- Safe to run twice: every part keeps any setting an administrator changed. It only ADDS its own schema and functions;
-- it never edits an existing table's data. Needs the icaneracoin tables that are already deployed (wallets, rates, the dev secret).
-- To undo: supabase/rollback/20261019_rollback_sector_trading.sql   (read the note at the top of it first)
-- Guide:   SECTOR_TRADING_DEPLOY.md
--
-- After it runs: trading is OFF. Nothing changes for businesses until they accept the data clause.
-- Turn trading on only after the checklist in SECTOR_TRADING_DEPLOY.md ("Before you turn trading on"):
--   dev panel > Sector Markets > Turn ON.
-- ============================================================================

-- ################################ PART 1 of 4: 20261019100000_sector_trading_core.sql ################################
-- ============================================================================
-- IcanEra Sector Markets, part 1 of 4: the isolated trading schema.
--
-- WHAT THIS IS
--   Users spend icaneracoin (ICEC) on ten "sector index" coins (iAGRI, iTRNS, ...).
--   Each index is built from AGGREGATE business revenue per sector, and the
--   platform vault is the counterparty. This file only creates the storage and the
--   switches; no data flows yet and nothing in the existing app changes.
--
-- HOW IT STAYS OUT OF THE WAY OF THE BUSINESS TOOLS
--   * Everything lives in its own schema, icanera_trading. No table in it is
--     readable or writable by anon / authenticated / PUBLIC. The only doors are the
--     SECURITY DEFINER functions added in the later files (ican_sector_*).
--   * Business data goes IN through an insert-only outbox (telemetry_events,
--     file 2). There is no path from the trading side back to business tables.
--   * The write paths are append-only (outbox, vault entries, fills), so a burst of
--     sales or trades never queues behind one shared row. This is the same lesson as
--     20261018100000_icaneracoin_burst_safe_feed.sql: no hot row on the money path.
--   * Contributors are stored only as a keyed hash (contributor_key), never as a
--     business id.
--
-- SAFETY DEFAULTS
--   Trading is OFF (sector_settings.trading_enabled = FALSE) until an administrator
--   turns it on. Re-running this file keeps every setting an administrator changed.
--
-- Safe to run more than once. Rollback: supabase/rollback/20261019_rollback_sector_trading.sql
-- Requires: ican_user_wallets, wallet_accounts, ican_currency_rates (already deployed).
-- ============================================================================


CREATE SCHEMA IF NOT EXISTS icanera_trading;
REVOKE ALL ON SCHEMA icanera_trading FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA icanera_trading REVOKE ALL ON TABLES    FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA icanera_trading REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA icanera_trading REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;


-- 1. Switches an administrator can change from the SQL editor (one row).
CREATE TABLE IF NOT EXISTS icanera_trading.sector_settings (
  id                      BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  trading_enabled         BOOLEAN NOT NULL DEFAULT FALSE,          -- FALSE pauses every buy and sell at once
  fee_bps                 INT     NOT NULL DEFAULT 50   CHECK (fee_bps BETWEEN 0 AND 1000),   -- charged on each side, paid to the vault
  max_trades_per_minute   INT     NOT NULL DEFAULT 30   CHECK (max_trades_per_minute > 0),
  max_trade_icec          NUMERIC NOT NULL DEFAULT 100  CHECK (max_trade_icec > 0),           -- ceiling per trade, in ICEC
  max_position_icec       NUMERIC NOT NULL DEFAULT 1000 CHECK (max_position_icec > 0),        -- ceiling per user per sector (cost basis), in ICEC
  stress_pct              NUMERIC NOT NULL DEFAULT 50   CHECK (stress_pct >= 0),              -- a buy needs vault >= exposure * (1 + stress_pct/100)
  -- index maths
  k_min                   INT     NOT NULL DEFAULT 10   CHECK (k_min >= 3),                   -- fewest contributors before a sector may trade
  window_hours            INT     NOT NULL DEFAULT 24   CHECK (window_hours BETWEEN 1 AND 168),
  contributor_cap_multiple NUMERIC NOT NULL DEFAULT 3   CHECK (contributor_cap_multiple >= 1),-- one business counts at most N x the sector median
  ema_minutes             NUMERIC NOT NULL DEFAULT 30   CHECK (ema_minutes > 0),             -- smoothing time constant: an old value is 63% forgotten after this long
  max_move_pct_per_hour   NUMERIC NOT NULL DEFAULT 10   CHECK (max_move_pct_per_hour > 0 AND max_move_pct_per_hour <= 200), -- circuit breaker: the level may not move faster than this (compounded) per hour
  stale_s                 INT     NOT NULL DEFAULT 120  CHECK (stale_s > 0),                  -- the index must be this fresh to trade
  -- consent
  current_terms_version   INT     NOT NULL DEFAULT 1    CHECK (current_terms_version >= 1)    -- businesses must have accepted this version to contribute
);
INSERT INTO icanera_trading.sector_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;


-- 2. The ten sectors. Data, not code: changing the list is an UPDATE.
--    iAGRI / iTRNS / iRETL / iSOCL were specified; the other six are proposals.
CREATE TABLE IF NOT EXISTS icanera_trading.sector_catalog (
  ticker      TEXT PRIMARY KEY CHECK (ticker ~ '^i[A-Z]{3,6}$'),
  name        TEXT    NOT NULL,
  description TEXT,
  sort_order  INT     NOT NULL DEFAULT 100,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,     -- FALSE = hidden, takes no revenue, not tradable
  admin_halted BOOLEAN NOT NULL DEFAULT FALSE    -- TRUE = still shown, but nobody can trade it
);
INSERT INTO icanera_trading.sector_catalog (ticker, name, description, sort_order) VALUES
  ('iAGRI', 'Agriculture',            'Farms, produce, inputs and agro-processing',                 10),
  ('iTRNS', 'Transport & Logistics',  'Boda, taxi, freight, delivery and courier businesses',       20),
  ('iRETL', 'Retail & Wholesale',     'Shops, wholesalers, suppliers and manufacturers',            30),
  ('iSOCL', 'Social & Community',     'Churches, associations, NGOs and community groups',          40),
  ('iHLTH', 'Health',                 'Clinics, pharmacies and care providers',                     50),
  ('iEDUC', 'Education',              'Schools, training and tutoring',                             60),
  ('iFINC', 'Finance & Insurance',    'Saccos, lenders, insurers and agents',                       70),
  ('iCNST', 'Construction & Property','Builders, materials and real estate',                        80),
  ('iHOSP', 'Hospitality & Food',     'Restaurants, hotels, catering and events',                   90),
  ('iTECH', 'Technology & Services',  'Software, media, professional and repair services',         100)
ON CONFLICT (ticker) DO NOTHING;

-- Which business category feeds which sector. The key is the business's category
-- (business_profiles.metadata->>'category_key', falling back to business_type, exactly
-- as CMMS reads it), matched in lower case. A business whose category is not listed here
-- contributes nothing. File 2 seeds it; an administrator can edit it at any time.
CREATE TABLE IF NOT EXISTS icanera_trading.sector_industry_map (
  industry_value TEXT PRIMARY KEY CHECK (industry_value = lower(btrim(industry_value)) AND industry_value <> ''),
  ticker         TEXT NOT NULL REFERENCES icanera_trading.sector_catalog(ticker) ON UPDATE CASCADE ON DELETE CASCADE
);


-- 3. Consent. A business contributes only after someone who runs it has accepted the
--    current version of the data clause in the Terms & Conditions.
CREATE TABLE IF NOT EXISTS icanera_trading.data_terms_acceptance (
  business_id   UUID        NOT NULL,
  terms_version INT         NOT NULL CHECK (terms_version >= 1),
  accepted_by   UUID        NOT NULL,
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, terms_version)
);


-- The wording shown at sign-up and in the Terms & Conditions, one row per version.
-- Bumping sector_settings.current_terms_version after adding a row makes every business
-- accept the new wording before it contributes again.
CREATE TABLE IF NOT EXISTS icanera_trading.data_terms_text (
  version    INT PRIMARY KEY CHECK (version >= 1),
  title      TEXT        NOT NULL,
  body       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 4. The pseudonym key. One secret, readable only by the functions below. A business
--    shows up in the trading data only as contributor_key(business_id).
CREATE TABLE IF NOT EXISTS icanera_trading.contributor_secret (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  secret     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO icanera_trading.contributor_secret (id, secret)
VALUES (TRUE, replace(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', ''))
ON CONFLICT (id) DO NOTHING;

-- (A plain function, not SECURITY DEFINER: it is only ever called from the definer functions of file 2, API roles cannot
-- execute it, and being plain lets the planner inline it. Every name in it is schema-qualified.)
CREATE OR REPLACE FUNCTION icanera_trading.contributor_key(p_business_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(s.secret || ':' || p_business_id::TEXT, 'UTF8')), 'hex')
    FROM icanera_trading.contributor_secret s WHERE s.id
$$;


-- 5. The outbox: what the business side drops off. Insert-only from the capture
--    triggers (file 2); read only by the index folder (file 3). Negative amounts are
--    refunds ("void"), never edits.
CREATE TABLE IF NOT EXISTS icanera_trading.telemetry_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_time      TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  source          TEXT          NOT NULL,                    -- which business-side record type
  source_ref      TEXT          NOT NULL,                    -- its id; with source, makes capture exactly-once
  kind            TEXT          NOT NULL DEFAULT 'sale' CHECK (kind IN ('sale', 'void')),
  sector          TEXT          NOT NULL,
  contributor_key TEXT          NOT NULL,
  amount_ugx      NUMERIC(24,4) NOT NULL CHECK (amount_ugx <> 0),
  folded_at       TIMESTAMPTZ,                               -- set by the index folder; NULL = not yet counted
  UNIQUE (source, source_ref, kind)
);
-- The folder takes whatever is committed and not yet counted. Marking rows (instead of remembering "the last id
-- I saw") is what makes a transaction that committed late harmless: identity values are handed out in order but
-- committed in any order, and a high-water mark would skip such a row forever.
CREATE INDEX IF NOT EXISTS telemetry_events_unfolded ON icanera_trading.telemetry_events (id) WHERE folded_at IS NULL;

-- Rolled up by the folder: revenue per contributor per 5-minute bucket, so a window sum
-- never rescans raw events.
CREATE TABLE IF NOT EXISTS icanera_trading.contributor_buckets (
  sector          TEXT          NOT NULL,
  contributor_key TEXT          NOT NULL,
  bucket_start    TIMESTAMPTZ   NOT NULL,
  amount_ugx      NUMERIC(24,4) NOT NULL,
  PRIMARY KEY (sector, contributor_key, bucket_start)
);
CREATE INDEX IF NOT EXISTS contributor_buckets_time ON icanera_trading.contributor_buckets (bucket_start);

-- When the folder last ran, which 5-minute bucket it had reached, and the version of the public feed
-- (bumped whenever anything a viewer can see changes).
CREATE TABLE IF NOT EXISTS icanera_trading.fold_state (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  folded_at    TIMESTAMPTZ,
  last_bucket  TIMESTAMPTZ,
  feed_version BIGINT NOT NULL DEFAULT 1,
  ledger_txid  xid8  NOT NULL DEFAULT '0'::xid8     -- every vault entry / fill from a transaction older than this is already in the caches
);
INSERT INTO icanera_trading.fold_state (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;


-- 6. The clearing vault: an insert-only ledger. The balance is the sum of the entries
--    (cached, with the unfolded tail added on read), never one row everybody updates.
--    amount > 0 adds to the vault, amount < 0 pays out of it.
CREATE TABLE IF NOT EXISTS icanera_trading.vault_entries (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  kind       TEXT          NOT NULL CHECK (kind IN ('funding', 'collateral', 'payout', 'fee', 'adjustment')),
  amount     NUMERIC(28,8) NOT NULL CHECK (amount <> 0),
  sector     TEXT,
  user_id    UUID,
  fill_id    UUID,
  memo       TEXT,
  txid       xid8          NOT NULL DEFAULT pg_current_xact_id()    -- which transaction wrote it (see the note below)
);
CREATE INDEX IF NOT EXISTS vault_entries_fill ON icanera_trading.vault_entries (fill_id);
CREATE INDEX IF NOT EXISTS vault_entries_txid ON icanera_trading.vault_entries (txid);

-- The cached balance covers every entry written by a transaction older than fold_state.ledger_txid. A reader adds the
-- entries from that point on, so the balance it sees is exact. (Remembering "the highest id I added" would silently
-- skip an entry whose transaction committed after a later one; a transaction-id boundary cannot, because every
-- transaction older than the boundary has already finished.)
CREATE TABLE IF NOT EXISTS icanera_trading.vault_cache (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  balance      NUMERIC(28,8) NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);
INSERT INTO icanera_trading.vault_cache (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;


-- 7. What users hold, and every fill that got them there.
CREATE TABLE IF NOT EXISTS icanera_trading.sector_holdings (
  user_id    UUID          NOT NULL,
  sector     TEXT          NOT NULL,
  units      NUMERIC(28,8) NOT NULL DEFAULT 0 CHECK (units >= 0),
  cost_icec  NUMERIC(28,8) NOT NULL DEFAULT 0 CHECK (cost_icec >= 0),   -- cost basis of the units still held
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sector)
);

CREATE TABLE IF NOT EXISTS icanera_trading.sector_fills (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              BIGINT        GENERATED ALWAYS AS IDENTITY UNIQUE,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  user_id          UUID          NOT NULL,
  sector           TEXT          NOT NULL,
  side             TEXT          NOT NULL CHECK (side IN ('buy', 'sell')),
  units            NUMERIC(28,8) NOT NULL CHECK (units > 0),
  price_icec       NUMERIC(18,6) NOT NULL CHECK (price_icec > 0),     -- index level / 100
  gross_icec       NUMERIC(28,8) NOT NULL,                            -- buy: what the user paid; sell: units x price
  fee_icec         NUMERIC(28,8) NOT NULL CHECK (fee_icec >= 0),
  net_icec         NUMERIC(28,8) NOT NULL,                            -- buy: collateral held; sell: what the user received
  cost_basis_icec  NUMERIC(28,8) NOT NULL,                            -- buy: cost added; sell: cost released
  pay_currency     TEXT          NOT NULL DEFAULT 'ICEC',
  pay_amount       NUMERIC(28,8),                                     -- the cash amount when paid or paid out in a currency
  fx_rate_to_ugx   NUMERIC,
  icec_price_ugx   NUMERIC,
  index_version    BIGINT,
  request_id       TEXT          NOT NULL,
  txid             xid8          NOT NULL DEFAULT pg_current_xact_id()
);
CREATE INDEX IF NOT EXISTS sector_fills_user ON icanera_trading.sector_fills (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sector_fills_sector ON icanera_trading.sector_fills (sector, seq);
CREATE INDEX IF NOT EXISTS sector_fills_txid ON icanera_trading.sector_fills (txid);

-- Units the vault owes users, per sector (bought minus sold), cached the same way as the vault balance.
CREATE TABLE IF NOT EXISTS icanera_trading.sector_exposure (
  sector    TEXT PRIMARY KEY,
  net_units NUMERIC(28,8) NOT NULL DEFAULT 0
);

-- One row per executed request: what makes a retry harmless.
CREATE TABLE IF NOT EXISTS icanera_trading.trade_requests (
  user_id    UUID        NOT NULL,
  request_id TEXT        NOT NULL CHECK (char_length(request_id) BETWEEN 8 AND 100),
  side       TEXT        NOT NULL CHECK (side IN ('buy', 'sell')),
  result     JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS trade_requests_recent ON icanera_trading.trade_requests (user_id, created_at DESC);


-- 8. Ledgers that must never be edited. TRUNCATE is not blocked (it is how tests reset).
CREATE OR REPLACE FUNCTION icanera_trading.forbid_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows are never changed or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
END; $$;

DROP TRIGGER IF EXISTS trg_vault_entries_immutable ON icanera_trading.vault_entries;
CREATE TRIGGER trg_vault_entries_immutable
  BEFORE UPDATE OR DELETE ON icanera_trading.vault_entries
  FOR EACH ROW EXECUTE FUNCTION icanera_trading.forbid_change();

DROP TRIGGER IF EXISTS trg_sector_fills_immutable ON icanera_trading.sector_fills;
CREATE TRIGGER trg_sector_fills_immutable
  BEFORE UPDATE OR DELETE ON icanera_trading.sector_fills
  FOR EACH ROW EXECUTE FUNCTION icanera_trading.forbid_change();


-- 8b. The few one-row tables that every trade reads (and the folder rewrites every few seconds) must never be
--     allowed to bloat or go without statistics: a stale estimate of "665 rows" on a one-row table made the
--     planner cost a trivial query at 50 million and JIT-compile it for ~900 ms, in a load test. Vacuum and analyse
--     them after a couple of dozen changes instead of after the default 20 % of their size.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fold_state', 'vault_cache', 'sector_exposure', 'sector_settings', 'sector_catalog'] LOOP
    EXECUTE format('ALTER TABLE icanera_trading.%I SET (autovacuum_vacuum_threshold = 20, autovacuum_vacuum_scale_factor = 0, '
                   'autovacuum_analyze_threshold = 20, autovacuum_analyze_scale_factor = 0)', t);
  END LOOP;
END $$;


-- 9. Nobody reaches these over the API. Row Level Security on with no policy, and every
--    grant removed, so a mistake in one layer is caught by the other.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'icanera_trading' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE icanera_trading.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON icanera_trading.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA icanera_trading FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA icanera_trading FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ################################ PART 2 of 4: 20261019110000_sector_trading_telemetry.sql ################################
-- ============================================================================
-- IcanEra Sector Markets, part 2 of 4: consent and the revenue feed.
--
-- WHERE REVENUE COMES FROM
--   Every customer sale that lands in a business wallet goes through
--   ican_settle_business_wallet_income() and leaves exactly one row in
--   ican_business_wallet_settlements (UNIQUE source_app + source_reference).
--   Card-QR sales, drop-ship sales and installment sales all end there with
--   settlement_type = 'pos_sale'. That one table is the choke point, so one trigger
--   covers them all. (The wallet movement log, ican_business_wallet_transactions, is
--   NOT used: it also holds transfers between a business's own branches, platform
--   fees and investments, none of which are revenue.) Investments, refunds and other
--   income are not counted.
--
-- WHAT THE TRIGGER DOES, AND WHAT IT NEVER DOES
--   * It runs after the settlement row exists and drops one small row into the
--     trading outbox. It can never fail or slow a sale: every error is swallowed.
--   * It only records a business that has accepted the current data clause of the
--     Terms & Conditions. Everyone else is skipped.
--   * It stores the sector, an amount in UGX, and a keyed hash of the business. Not the
--     business id, not the customer, not the payment reference's meaning.
--   * Nothing here reads anything back for the business: there is no path from
--     trading to business data.
--
-- CONSENT
--   Accepting is part of creating a business account (the sign-up form requires the
--   tick and calls ican_sector_accept_data_terms). Existing businesses are asked on
--   their next sign-in (ican_sector_data_consent_status). The wording is data
--   (icanera_trading.data_terms_text) and versioned. THE v1 WORDING BELOW IS A DRAFT
--   AND MUST BE REVIEWED BY A LAWYER BEFORE TRADING IS TURNED ON.
--
-- Known limit: the settlement row does not say who paid, so a purchase by the
-- business's own owner cannot be excluded here. The per-business cap in the index
-- (file 3) and the minimum cohort limit what any one business can do to a sector.
--
-- Safe to run more than once. Run 20261019100000_sector_trading_core.sql first.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_trading.telemetry_events') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261019100000_sector_trading_core.sql first.';
  END IF;
END $$;


-- 1. Which business category belongs to which sector. Keys are the category keys the
--    business-profile flow stores (see BusinessCategorySelector / cmms_business_type_architecture).
--    government, other and mining-type businesses are deliberately unmapped.
INSERT INTO icanera_trading.sector_industry_map (industry_value, ticker) VALUES
  ('farm', 'iAGRI'), ('agriculture', 'iAGRI'), ('agribusiness', 'iAGRI'),
  ('transport', 'iTRNS'), ('transportation', 'iTRNS'), ('logistics', 'iTRNS'), ('fleet', 'iTRNS'), ('delivery', 'iTRNS'),
  ('retail', 'iRETL'), ('wholesale', 'iRETL'), ('shop', 'iRETL'), ('supermarket', 'iRETL'), ('hardware', 'iRETL'),
  ('supplier', 'iRETL'), ('factory', 'iRETL'), ('manufacturing', 'iRETL'), ('industrial', 'iRETL'),
  ('pharmacy', 'iHLTH'), ('hospital', 'iHLTH'), ('clinic', 'iHLTH'), ('healthcare', 'iHLTH'),
  ('school', 'iEDUC'), ('education', 'iEDUC'), ('college', 'iEDUC'), ('university', 'iEDUC'),
  ('insurance', 'iFINC'), ('sacco', 'iFINC'), ('microfinance', 'iFINC'), ('bank', 'iFINC'), ('finance', 'iFINC'),
  ('construction', 'iCNST'), ('real_estate', 'iCNST'),
  ('restaurant', 'iHOSP'), ('restaurant_cafe', 'iHOSP'), ('cafe', 'iHOSP'), ('hotel', 'iHOSP'), ('hospitality', 'iHOSP'),
  ('professional_services', 'iTECH'), ('law_firm', 'iTECH'), ('audit_firm', 'iTECH'), ('project_management', 'iTECH'),
  ('telecommunications', 'iTECH'), ('technology', 'iTECH')
ON CONFLICT (industry_value) DO NOTHING;
-- Churches are recognised by the same rule the tithe feature uses (fn_business_is_church),
-- not by category, and go to iSOCL; see sector_for_business below.


-- 2. The data clause, v1. DRAFT: needs legal review before launch.
INSERT INTO icanera_trading.data_terms_text (version, title, body) VALUES (
  1,
  'Anonymous sector statistics',
  'When your business receives sales payments through ICAN, the amount is added to an anonymous total for your business sector (for example Retail, Transport or Health). '
  || 'Only combined sector figures are ever published, and only when enough businesses contribute that no single business can be identified. '
  || 'We never share your business name, your customers, who paid you, or any individual transaction. '
  || 'These sector figures are used to calculate the sector index values that users can trade on IcanEra Sector Markets. '
  || 'Agreeing to this is part of the Terms & Conditions for creating a business account.'
) ON CONFLICT (version) DO NOTHING;


-- 3. Who may act for a business: the same rule CMMS uses to decide who administers it.
CREATE OR REPLACE FUNCTION icanera_trading.is_business_admin(p_business_id UUID, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  IF p_business_id IS NULL OR p_uid IS NULL THEN RETURN FALSE; END IF;
  SELECT EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business_id AND bp.user_id = p_uid) INTO v_ok;
  IF v_ok THEN RETURN TRUE; END IF;
  IF to_regclass('public.business_co_owners') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.business_co_owners co
         WHERE co.business_profile_id = $1 AND co.user_id = $2
           AND lower(coalesce(co.status, 'active')) IN ('active', 'approved', 'verified')
           AND (co.ownership_share > 0
                OR lower(coalesce(co.role, '')) IN ('owner', 'co-owner', 'shareholder', 'ceo', 'administrator')))
    $q$ INTO v_ok USING p_business_id, p_uid;
  END IF;
  RETURN COALESCE(v_ok, FALSE);
END; $$;


-- 4. Has this business accepted the CURRENT wording?
-- (Plain, inlinable SQL: this and the next two helpers run on every sale, and are only reachable through the
-- definer trigger below. API roles cannot execute them, and every name in them is schema-qualified.)
CREATE OR REPLACE FUNCTION icanera_trading.business_has_consented(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM icanera_trading.data_terms_acceptance a
      JOIN icanera_trading.sector_settings s ON s.id
     WHERE a.business_id = p_business_id AND a.terms_version = s.current_terms_version)
$$;


-- 5. A business's sector (NULL = does not contribute).
CREATE OR REPLACE FUNCTION icanera_trading.sector_for_business(p_business_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  bp     RECORD;
  v_key  TEXT;
  v_tick TEXT;
BEGIN
  SELECT b.business_type::TEXT AS business_type, b.business_name::TEXT AS business_name, b.metadata AS metadata
    INTO bp
    FROM public.business_profiles b
   WHERE b.id = p_business_id
     AND lower(coalesce(b.status, 'active')) NOT IN ('inactive', 'suspended', 'rejected', 'deleted');
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF to_regprocedure('public.fn_business_is_church(text,text,jsonb)') IS NOT NULL
     AND public.fn_business_is_church(bp.business_type, bp.business_name, bp.metadata) THEN
    v_tick := 'iSOCL';
  ELSE
    -- category_key first; business_type can be a legal form ("Sole Proprietorship"), so it is only a fallback.
    v_key := lower(btrim(coalesce(NULLIF(bp.metadata ->> 'category_key', ''), bp.business_type, '')));
    SELECT m.ticker INTO v_tick FROM icanera_trading.sector_industry_map m WHERE m.industry_value = v_key;
  END IF;

  IF v_tick IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM icanera_trading.sector_catalog c WHERE c.ticker = v_tick AND c.enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_tick;
END; $$;


-- 6. Drop one revenue event in the outbox. Returns nothing and NEVER raises: whatever
--    goes wrong here must not reach the business's sale.
--      kind 'sale' : p_amount_ugx > 0
--      kind 'void' : reverses an earlier 'sale' with the same source + reference (no amount needed)
CREATE OR REPLACE FUNCTION icanera_trading.capture_revenue(
  p_source      TEXT,
  p_source_ref  TEXT,
  p_business_id UUID,
  p_amount_ugx  NUMERIC DEFAULT NULL,
  p_kind        TEXT    DEFAULT 'sale'
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_sector TEXT;
  v_amount NUMERIC;
BEGIN
  IF p_business_id IS NULL OR p_source IS NULL OR p_source_ref IS NULL THEN RETURN; END IF;
  IF NOT icanera_trading.business_has_consented(p_business_id) THEN RETURN; END IF;
  v_sector := icanera_trading.sector_for_business(p_business_id);
  IF v_sector IS NULL THEN RETURN; END IF;

  IF p_kind = 'void' THEN
    SELECT -e.amount_ugx INTO v_amount FROM icanera_trading.telemetry_events e
     WHERE e.source = p_source AND e.source_ref = p_source_ref AND e.kind = 'sale';
    IF v_amount IS NULL THEN RETURN; END IF;           -- never captured, nothing to reverse
  ELSIF p_kind = 'sale' THEN
    IF p_amount_ugx IS NULL OR p_amount_ugx <= 0 OR p_amount_ugx = 'NaN'::NUMERIC THEN RETURN; END IF;
    v_amount := round(p_amount_ugx, 4);
    IF v_amount = 0 THEN RETURN; END IF;
  ELSE
    RETURN;
  END IF;

  INSERT INTO icanera_trading.telemetry_events (source, source_ref, kind, sector, contributor_key, amount_ugx)
  VALUES (p_source, p_source_ref, p_kind, v_sector, icanera_trading.contributor_key(p_business_id), v_amount)
  ON CONFLICT (source, source_ref, kind) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  NULL;
END; $$;


-- 7. The hook on the settlement choke point.
CREATE OR REPLACE FUNCTION icanera_trading.trg_capture_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
DECLARE v_price NUMERIC;
BEGIN
  IF NEW.settlement_type = 'pos_sale' THEN
    SELECT c.price_ugx INTO v_price FROM public.ican_price_cache c WHERE c.id;   -- the cached price: no flush, no wait
    IF v_price IS NOT NULL AND v_price > 0 THEN
      PERFORM icanera_trading.capture_revenue('settlement', NEW.id::TEXT, NEW.business_profile_id,
                                              NEW.amount_ican * v_price, 'sale');
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;                                      -- a sale is never held up by this
END; $$;

DO $$
BEGIN
  IF to_regclass('public.ican_business_wallet_settlements') IS NULL THEN
    RAISE NOTICE 'sector trading: ican_business_wallet_settlements does not exist yet, so no revenue hook was installed. Re-run this file after UNIFIED_BUSINESS_WALLET_OPERATIONS.sql.';
  ELSE
    DROP TRIGGER IF EXISTS trg_icanera_capture_settlement ON public.ican_business_wallet_settlements;
    CREATE TRIGGER trg_icanera_capture_settlement
      AFTER INSERT ON public.ican_business_wallet_settlements
      FOR EACH ROW WHEN (NEW.settlement_type = 'pos_sale')
      EXECUTE FUNCTION icanera_trading.trg_capture_settlement();
  END IF;
END $$;


-- 8. The doors the app uses for consent.

-- The wording to show (sign-up form and Terms page). Readable by signed-out visitors.
CREATE OR REPLACE FUNCTION public.ican_sector_data_terms()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_trading, public AS $$
  SELECT jsonb_build_object('version', t.version, 'title', t.title, 'body', t.body)
    FROM icanera_trading.data_terms_text t JOIN icanera_trading.sector_settings s ON s.id
   WHERE t.version = s.current_terms_version
$$;
REVOKE ALL ON FUNCTION public.ican_sector_data_terms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_sector_data_terms() TO anon, authenticated;

-- Has this business accepted the current wording? (Drives the prompt for existing businesses.)
CREATE OR REPLACE FUNCTION public.ican_sector_data_consent_status(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cur INT;
  v_at  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  IF NOT icanera_trading.is_business_admin(p_business_id, v_uid) THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_allowed', 'error', 'You do not manage this business.');
  END IF;
  SELECT s.current_terms_version INTO v_cur FROM icanera_trading.sector_settings s WHERE s.id;
  SELECT a.accepted_at INTO v_at FROM icanera_trading.data_terms_acceptance a
   WHERE a.business_id = p_business_id AND a.terms_version = v_cur;
  RETURN jsonb_build_object('success', true, 'accepted', v_at IS NOT NULL, 'current_version', v_cur, 'accepted_at', v_at);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_data_consent_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_data_consent_status(UUID) TO authenticated;

-- Accept the current wording for a business. Only someone who manages the business can.
-- Idempotent: accepting twice is fine.
CREATE OR REPLACE FUNCTION public.ican_sector_accept_data_terms(p_business_id UUID, p_version INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cur INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  IF NOT icanera_trading.is_business_admin(p_business_id, v_uid) THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_allowed', 'error', 'You do not manage this business.');
  END IF;
  SELECT s.current_terms_version INTO v_cur FROM icanera_trading.sector_settings s WHERE s.id;
  IF p_version IS DISTINCT FROM v_cur THEN
    RETURN jsonb_build_object('success', false, 'code', 'terms_version_outdated', 'current_version', v_cur,
                              'error', 'The terms have changed. Please read and accept the latest version.');
  END IF;
  INSERT INTO icanera_trading.data_terms_acceptance (business_id, terms_version, accepted_by)
  VALUES (p_business_id, v_cur, v_uid)
  ON CONFLICT (business_id, terms_version) DO NOTHING;
  RETURN jsonb_build_object('success', true, 'accepted', true, 'version', v_cur);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_accept_data_terms(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_accept_data_terms(UUID, INT) TO authenticated;


-- 9. Internal helpers stay closed to the API roles.
REVOKE ALL ON FUNCTION icanera_trading.is_business_admin(UUID, UUID)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION icanera_trading.business_has_consented(UUID)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION icanera_trading.sector_for_business(UUID)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION icanera_trading.capture_revenue(TEXT, TEXT, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION icanera_trading.trg_capture_settlement()             FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ################################ PART 3 of 4: 20261019120000_sector_trading_index.sql ################################
-- ============================================================================
-- IcanEra Sector Markets, part 3 of 4: the sector indices.
--
-- THE INDEX
--   For each sector, over a trailing window (24 h by default):
--     1. each contributing business's revenue is summed (UGX);
--     2. each business counts at most `contributor_cap_multiple` x the sector MEDIAN, so no single
--        business, honest or not, can move the sector by itself;
--     3. V = the mean of those capped figures = "revenue per active company", the hardened form of
--        Aggregate Sector Revenue / Active Sector Companies;
--     4. V is smoothed (a time-based EMA, so the result does not depend on how often this runs) and
--        expressed as a level, 100 on the day the sector first has enough contributors:
--        level = 100 x EMA(V) / V_base. A circuit breaker limits how fast the level may move per hour.
--   The price of one index unit is level / 100 ICEC. Buying at level 100 and selling at level 130 pays
--   1.30 ICEC per ICEC put in: a bet on a sector's growth, in ICEC, whatever ICEC does against the shilling.
--
--   A sector is `warming_up` until at least k_min businesses contribute (nothing is published and
--   nobody can trade), `live` after, and `halted` when an administrator says so.
--
-- HOW IT STAYS FAST
--   Same shape as the icaneracoin chart (20261018100000_icaneracoin_burst_safe_feed.sql): the money path
--   only appends to the outbox; ONE single-flight worker folds the outbox into 5-minute buckets,
--   recomputes the indices, and writes a small cache plus candles. However many callers ask, at most
--   one does the work per 2 seconds, and a viewer never waits behind it. Viewers read the cache.
--
-- Safe to run more than once. Run 20261019100000 and 20261019110000 first.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_trading.fold_state') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261019100000_sector_trading_core.sql first.';
  END IF;
END $$;


-- 1. Storage: one cache row per sector, and candles.
CREATE TABLE IF NOT EXISTS icanera_trading.sector_index_cache (
  ticker       TEXT PRIMARY KEY,
  status       TEXT          NOT NULL DEFAULT 'warming_up' CHECK (status IN ('warming_up', 'live', 'halted')),
  contributors INT           NOT NULL DEFAULT 0,
  v_raw        NUMERIC,                      -- capped mean revenue per contributor in the window, UGX
  v_ema        NUMERIC,
  ema_at       TIMESTAMPTZ,                  -- when v_ema was last advanced
  v_base       NUMERIC,                      -- fixed the first time the sector has k_min contributors
  level        NUMERIC(18,6),                -- 100 at launch; NULL until then
  price_icec   NUMERIC(18,6),                -- level / 100
  version      BIGINT        NOT NULL DEFAULT 1,
  computed_at  TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  changed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS icanera_trading.sector_index_candles (
  ticker      TEXT          NOT NULL,
  timeframe   TEXT          NOT NULL DEFAULT '5m',
  open_time   TIMESTAMPTZ   NOT NULL,
  open_level  NUMERIC(18,6) NOT NULL,
  high_level  NUMERIC(18,6) NOT NULL,
  low_level   NUMERIC(18,6) NOT NULL,
  close_level NUMERIC(18,6) NOT NULL,
  PRIMARY KEY (ticker, timeframe, open_time)
);

ALTER TABLE icanera_trading.sector_index_cache   ENABLE ROW LEVEL SECURITY;
ALTER TABLE icanera_trading.sector_index_candles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON icanera_trading.sector_index_cache   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON icanera_trading.sector_index_candles FROM PUBLIC, anon, authenticated;


-- 2. Optional push: tell open screens "something changed" (a version number only, never levels).
CREATE OR REPLACE FUNCTION icanera_trading.notify_sector_change(p_version BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    EXECUTE 'SELECT realtime.send($1, $2, $3, $4)'
      USING jsonb_build_object('v', p_version), 'tick', 'icanera:sectors', FALSE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;                                              -- a missing Realtime must never affect an index
END; $$;
REVOKE ALL ON FUNCTION icanera_trading.notify_sector_change(BIGINT) FROM PUBLIC, anon, authenticated;


-- 2b. The ledger caches. The vault balance and the units owed per sector are sums over insert-only ledgers
--     (vault_entries, sector_fills). A trade must read them exactly and cheaply, so they are kept as a cached
--     total plus a short tail: the cache covers every entry written by a transaction older than
--     fold_state.ledger_txid, and a reader adds the entries from that boundary on, in the same statement.
--     The boundary is the oldest still-running transaction (pg_snapshot_xmin), so no entry can ever be skipped
--     because it committed after a newer one. Run by the folder below; single-flight like everything else here.
CREATE OR REPLACE FUNCTION icanera_trading.fold_ledgers()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
DECLARE
  v_bound xid8 := pg_snapshot_xmin(pg_current_snapshot());
  v_last  xid8;
BEGIN
  SELECT f.ledger_txid INTO v_last FROM icanera_trading.fold_state f WHERE f.id FOR UPDATE;
  IF v_bound <= v_last THEN RETURN; END IF;           -- nothing older has finished since last time

  UPDATE icanera_trading.vault_cache
     SET balance = balance + COALESCE((SELECT SUM(e.amount) FROM icanera_trading.vault_entries e
                                        WHERE e.txid >= v_last AND e.txid < v_bound), 0),
         refreshed_at = clock_timestamp()
   WHERE id;

  INSERT INTO icanera_trading.sector_exposure (sector, net_units)
  SELECT fl.sector, SUM(CASE fl.side WHEN 'buy' THEN fl.units ELSE -fl.units END)
    FROM icanera_trading.sector_fills fl
   WHERE fl.txid >= v_last AND fl.txid < v_bound
   GROUP BY fl.sector
  ON CONFLICT (sector) DO UPDATE SET net_units = icanera_trading.sector_exposure.net_units + EXCLUDED.net_units;

  UPDATE icanera_trading.fold_state SET ledger_txid = v_bound WHERE id;
END; $$;
REVOKE ALL ON FUNCTION icanera_trading.fold_ledgers() FROM PUBLIC, anon, authenticated;

-- What is in the vault right now, exactly. (Written as scalar subqueries on purpose: joining the one-row tables made
-- the planner multiply row estimates and JIT-compile a trivial query. JIT is off for everything on the trade path.)
CREATE OR REPLACE FUNCTION icanera_trading.vault_balance()
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
  SELECT (SELECT c.balance FROM icanera_trading.vault_cache c WHERE c.id)
       + COALESCE((SELECT SUM(e.amount) FROM icanera_trading.vault_entries e
                    WHERE e.txid >= (SELECT f.ledger_txid FROM icanera_trading.fold_state f WHERE f.id)), 0)
$$;
REVOKE ALL ON FUNCTION icanera_trading.vault_balance() FROM PUBLIC, anon, authenticated;

-- Units of one sector that users hold (what the vault owes them, in index units).
CREATE OR REPLACE FUNCTION icanera_trading.sector_exposure_units(p_ticker TEXT)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
  SELECT COALESCE((SELECT x.net_units FROM icanera_trading.sector_exposure x WHERE x.sector = p_ticker), 0)
       + COALESCE((SELECT SUM(CASE fl.side WHEN 'buy' THEN fl.units ELSE -fl.units END)
                     FROM icanera_trading.sector_fills fl
                    WHERE fl.sector = p_ticker
                      AND fl.txid >= (SELECT f.ledger_txid FROM icanera_trading.fold_state f WHERE f.id)), 0)
$$;
REVOKE ALL ON FUNCTION icanera_trading.sector_exposure_units(TEXT) FROM PUBLIC, anon, authenticated;

-- What the vault owes users across all sectors, in ICEC, at today's index prices. One pass over the tail,
-- not one query per sector: a buy reads this on every trade.
CREATE OR REPLACE FUNCTION icanera_trading.exposure_icec()
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(x.net_units, 0) + COALESCE(t.tail, 0), 0) * c.price_icec), 0)
    FROM icanera_trading.sector_index_cache c
    LEFT JOIN icanera_trading.sector_exposure x ON x.sector = c.ticker
    LEFT JOIN (SELECT fl.sector, SUM(CASE fl.side WHEN 'buy' THEN fl.units ELSE -fl.units END) AS tail
                 FROM icanera_trading.sector_fills fl
                WHERE fl.txid >= (SELECT f.ledger_txid FROM icanera_trading.fold_state f WHERE f.id)
                GROUP BY fl.sector) t ON t.sector = c.ticker
   WHERE c.price_icec IS NOT NULL
$$;
REVOKE ALL ON FUNCTION icanera_trading.exposure_icec() FROM PUBLIC, anon, authenticated;


-- 3. The folder. Returns TRUE when THIS call did the work.
--    p_force : recompute even if it ran a moment ago (tests, settings changes).
--    p_wait  : if another call is already folding, wait for it instead of skipping.
CREATE OR REPLACE FUNCTION icanera_trading.fold_sector_indices(p_force BOOLEAN DEFAULT FALSE, p_wait BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
DECLARE
  v_fresh   CONSTANT INTERVAL := INTERVAL '2 seconds';
  v_lock    CONSTANT BIGINT   := hashtextextended('icanera_fold_sector_indices', 0);
  v_bucket  CONSTANT TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / 300) * 300);
  st        icanera_trading.fold_state;
  s         icanera_trading.sector_settings;
  prev      icanera_trading.sector_index_cache;
  c         RECORD;
  v_picked  BIGINT := 0;
  v_n       INT;
  v_raw     NUMERIC;
  v_base    NUMERIC;
  v_ema     NUMERIC;
  v_level   NUMERIC;
  v_target  NUMERIC;
  v_dt      NUMERIC;
  v_alpha   NUMERIC;
  v_f       NUMERIC;
  v_ema_at  TIMESTAMPTZ;
  v_status  TEXT;
  v_changed BOOLEAN;
  v_any     BOOLEAN := FALSE;
  v_version BIGINT;
BEGIN
  SELECT * INTO st FROM icanera_trading.fold_state WHERE id;
  IF NOT p_force AND st.folded_at IS NOT NULL AND clock_timestamp() - st.folded_at < v_fresh THEN
    RETURN FALSE;                                    -- somebody did this a moment ago
  END IF;

  IF p_wait THEN
    PERFORM pg_advisory_xact_lock(v_lock);
  ELSIF NOT pg_try_advisory_xact_lock(v_lock) THEN
    RETURN FALSE;                                    -- somebody is doing it right now
  END IF;

  SELECT * INTO st FROM icanera_trading.fold_state WHERE id;
  IF NOT p_force AND st.folded_at IS NOT NULL AND clock_timestamp() - st.folded_at < v_fresh THEN
    RETURN FALSE;                                    -- the one we waited for just finished
  END IF;
  SELECT * INTO s FROM icanera_trading.sector_settings WHERE id;

  -- (a) Count every committed, not-yet-counted event into its contributor's 5-minute bucket.
  --     A row whose transaction has not committed is invisible here and is taken by the next fold.
  WITH picked AS (
    UPDATE icanera_trading.telemetry_events e SET folded_at = clock_timestamp()
     WHERE e.id IN (SELECT x.id FROM icanera_trading.telemetry_events x
                     WHERE x.folded_at IS NULL ORDER BY x.id LIMIT 50000 FOR UPDATE SKIP LOCKED)
    RETURNING e.sector, e.contributor_key, e.event_time, e.amount_ugx
  ), agg AS (
    SELECT p.sector, p.contributor_key,
           to_timestamp(floor(extract(epoch FROM p.event_time) / 300) * 300) AS b,
           SUM(p.amount_ugx) AS a
      FROM picked p GROUP BY 1, 2, 3
  ), ins AS (
    INSERT INTO icanera_trading.contributor_buckets (sector, contributor_key, bucket_start, amount_ugx)
    SELECT sector, contributor_key, b, a FROM agg
    ON CONFLICT (sector, contributor_key, bucket_start) DO UPDATE
      SET amount_ugx = icanera_trading.contributor_buckets.amount_ugx + EXCLUDED.amount_ugx
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_picked FROM picked;

  DELETE FROM icanera_trading.contributor_buckets
   WHERE bucket_start < v_bucket - make_interval(hours => s.window_hours + 1);

  PERFORM icanera_trading.fold_ledgers();             -- vault balance and units owed, kept exact and cheap to read

  -- (b) Nothing new and the window has not slid: the indices cannot have changed.
  IF NOT p_force AND v_picked = 0 AND st.last_bucket IS NOT DISTINCT FROM v_bucket
     AND NOT EXISTS (SELECT 1 FROM icanera_trading.sector_catalog k WHERE k.enabled
                      AND NOT EXISTS (SELECT 1 FROM icanera_trading.sector_index_cache x WHERE x.ticker = k.ticker)) THEN
    UPDATE icanera_trading.sector_index_cache SET computed_at = clock_timestamp();
    UPDATE icanera_trading.fold_state SET folded_at = clock_timestamp() WHERE id;
    RETURN TRUE;
  END IF;

  -- (c) Recompute each sector.
  FOR c IN SELECT k.ticker, k.admin_halted FROM icanera_trading.sector_catalog k WHERE k.enabled ORDER BY k.ticker LOOP
    SELECT * INTO prev FROM icanera_trading.sector_index_cache WHERE ticker = c.ticker;

    WITH r AS (
      SELECT b.contributor_key, SUM(b.amount_ugx) AS rev
        FROM icanera_trading.contributor_buckets b
       WHERE b.sector = c.ticker AND b.bucket_start >= v_bucket - make_interval(hours => s.window_hours)
       GROUP BY b.contributor_key
      HAVING SUM(b.amount_ugx) > 0
    ), m AS (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY rev) AS med FROM r
    )
    SELECT COUNT(*), AVG(LEAST(r.rev, m.med * s.contributor_cap_multiple))
      INTO v_n, v_raw
      FROM r CROSS JOIN m;

    v_base := prev.v_base; v_ema := prev.v_ema; v_level := prev.level; v_ema_at := prev.ema_at;
    IF v_n >= s.k_min AND v_raw IS NOT NULL AND v_raw > 0 THEN
      IF v_base IS NULL THEN                         -- the sector's first day: it is 100 from here on
        v_base := v_raw; v_ema := v_raw; v_level := 100;
      ELSE
        -- Time-based: the same elapsed time gives the same result however many folds it was split into.
        -- (Capped at 6 hours so a long gap cannot unlock an unbounded jump.)
        v_dt     := LEAST(GREATEST(EXTRACT(EPOCH FROM clock_timestamp() - COALESCE(v_ema_at, clock_timestamp())), 0), 21600);
        v_alpha  := 1 - exp(-v_dt / (s.ema_minutes * 60));
        v_f      := power(1 + s.max_move_pct_per_hour / 100, v_dt / 3600);
        v_ema    := v_alpha * v_raw + (1 - v_alpha) * v_ema;
        v_target := 100 * v_ema / v_base;
        v_level  := LEAST(GREATEST(v_target, v_level / v_f), v_level * v_f);
      END IF;
      v_ema_at := clock_timestamp();
      v_level := GREATEST(v_level, 0.01);            -- an index never reaches zero: a price of 0 cannot be traded
      v_status := CASE WHEN c.admin_halted THEN 'halted' ELSE 'live' END;
    ELSE
      v_status := CASE WHEN c.admin_halted THEN 'halted' ELSE 'warming_up' END;
      -- too few contributors: whatever was published stays frozen, nothing is recomputed from a thin sample
    END IF;
    v_level := round(v_level, 6);

    v_changed := prev.ticker IS NULL OR prev.status IS DISTINCT FROM v_status
              OR prev.level IS DISTINCT FROM v_level OR prev.contributors IS DISTINCT FROM v_n;

    INSERT INTO icanera_trading.sector_index_cache
      (ticker, status, contributors, v_raw, v_ema, ema_at, v_base, level, price_icec, version, computed_at, changed_at)
    VALUES
      (c.ticker, v_status, v_n, v_raw, v_ema, v_ema_at, v_base, v_level, round(v_level / 100, 6), 1, clock_timestamp(), clock_timestamp())
    ON CONFLICT (ticker) DO UPDATE SET
      status = EXCLUDED.status, contributors = EXCLUDED.contributors, v_raw = EXCLUDED.v_raw, v_ema = EXCLUDED.v_ema,
      ema_at = EXCLUDED.ema_at, v_base = EXCLUDED.v_base, level = EXCLUDED.level, price_icec = EXCLUDED.price_icec, computed_at = EXCLUDED.computed_at,
      version    = icanera_trading.sector_index_cache.version + CASE WHEN v_changed THEN 1 ELSE 0 END,
      changed_at = CASE WHEN v_changed THEN EXCLUDED.changed_at ELSE icanera_trading.sector_index_cache.changed_at END;

    IF v_level IS NOT NULL THEN
      INSERT INTO icanera_trading.sector_index_candles (ticker, timeframe, open_time, open_level, high_level, low_level, close_level)
      VALUES (c.ticker, '5m', v_bucket, COALESCE(prev.level, v_level), GREATEST(COALESCE(prev.level, v_level), v_level),
              LEAST(COALESCE(prev.level, v_level), v_level), v_level)
      ON CONFLICT (ticker, timeframe, open_time) DO UPDATE SET
        high_level  = GREATEST(icanera_trading.sector_index_candles.high_level, EXCLUDED.close_level),
        low_level   = LEAST(icanera_trading.sector_index_candles.low_level, EXCLUDED.close_level),
        close_level = EXCLUDED.close_level;
    END IF;

    IF v_changed THEN v_any := TRUE; END IF;
  END LOOP;

  UPDATE icanera_trading.fold_state
     SET folded_at = clock_timestamp(), last_bucket = v_bucket,
         feed_version = feed_version + CASE WHEN v_any THEN 1 ELSE 0 END
   WHERE id RETURNING feed_version INTO v_version;
  IF v_any THEN PERFORM icanera_trading.notify_sector_change(v_version); END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION icanera_trading.fold_sector_indices(BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;


-- 4. The public feed: every sector's level and status in one round trip, and a sector's candles on request.
--    Only aggregates are ever returned: no business, no contributor key, and the number of contributors
--    only while a sector is still warming up (it has no published level then).
--    p_since_version : the version the caller already holds; if nothing changed, only {unchanged:true} comes back.
--    p_sector        : also return this sector's candles (newest first). p_after: only candles from 15 minutes
--                      before that time onward.
CREATE OR REPLACE FUNCTION public.ican_get_sector_feed(
  p_since_version BIGINT      DEFAULT NULL,
  p_sector        TEXT        DEFAULT NULL,
  p_after         TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
DECLARE
  v_version BIGINT;
  s         icanera_trading.sector_settings;
  v_sectors JSONB;
  v_candles JSONB := NULL;
  v_tick    TEXT := NULLIF(btrim(p_sector), '');
BEGIN
  PERFORM icanera_trading.fold_sector_indices(FALSE, FALSE);
  SELECT f.feed_version INTO v_version FROM icanera_trading.fold_state f WHERE f.id;
  SELECT * INTO s FROM icanera_trading.sector_settings WHERE id;

  IF p_since_version IS NOT NULL AND p_since_version = v_version THEN
    RETURN jsonb_build_object('server_time', clock_timestamp(), 'version', v_version, 'unchanged', TRUE,
                              'trading_enabled', s.trading_enabled);
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::JSONB ORDER BY x.sort_order), '[]'::JSONB) INTO v_sectors
    FROM (
      SELECT k.ticker, k.name, k.description, k.sort_order,
             COALESCE(c.status, 'warming_up') AS status,
             c.level, c.price_icec,
             CASE WHEN COALESCE(c.status, 'warming_up') = 'warming_up' THEN COALESCE(c.contributors, 0) END AS contributors,
             s.k_min AS contributors_needed,
             (SELECT ROUND((c.level / NULLIF(o.close_level, 0) - 1) * 100, 2)
                FROM icanera_trading.sector_index_candles o
               WHERE o.ticker = k.ticker AND o.timeframe = '5m' AND o.open_time <= clock_timestamp() - INTERVAL '24 hours'
               ORDER BY o.open_time DESC LIMIT 1) AS change_24h_pct,
             c.computed_at AS updated_at,
             COALESCE(s.trading_enabled AND NOT k.admin_halted AND c.status = 'live'
                AND c.computed_at > clock_timestamp() - make_interval(secs => s.stale_s), FALSE) AS tradable
        FROM icanera_trading.sector_catalog k
        LEFT JOIN icanera_trading.sector_index_cache c ON c.ticker = k.ticker
       WHERE k.enabled
    ) x;

  IF v_tick IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('t', y.open_time, 'o', y.open_level, 'h', y.high_level,
                                                 'l', y.low_level, 'c', y.close_level) ORDER BY y.open_time DESC), '[]'::JSONB)
      INTO v_candles
      FROM (
        SELECT o.* FROM icanera_trading.sector_index_candles o
         WHERE o.ticker = v_tick AND o.timeframe = '5m'
           AND (p_after IS NULL OR o.open_time >= p_after - INTERVAL '15 minutes')
         ORDER BY o.open_time DESC LIMIT 288
      ) y;
  END IF;

  RETURN jsonb_build_object(
    'server_time',     clock_timestamp(),
    'version',         v_version,
    'trading_enabled', s.trading_enabled,
    'fee_bps',         s.fee_bps,
    'max_trade_icec',  s.max_trade_icec,
    'sectors',         v_sectors,
    'candles_for',     v_tick,
    'candles',         v_candles
  );
END; $$;
REVOKE ALL ON FUNCTION public.ican_get_sector_feed(BIGINT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_get_sector_feed(BIGINT, TEXT, TIMESTAMPTZ) TO anon, authenticated;


-- 5. Keep the indices current with nobody watching: fold every 5 seconds (pg_cron >= 1.5), and tidy nightly.
--    Skipped quietly if pg_cron is absent: viewers and trades fold on demand.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('icanera-sector-fold', '5 seconds', 'SELECT icanera_trading.fold_sector_indices()');
    PERFORM cron.schedule('icanera-sector-prune', '23 3 * * *',
      $job$DELETE FROM icanera_trading.telemetry_events WHERE folded_at IS NOT NULL AND folded_at < now() - INTERVAL '45 days'$job$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'sector trading: could not schedule the background fold (%): indices will refresh when viewers or trades ask.', SQLERRM;
END $$;


-- 6. Fill the cache right now.
SELECT icanera_trading.fold_sector_indices(TRUE, TRUE);

NOTIFY pgrst, 'reload schema';

-- ################################ PART 4 of 4: 20261019130000_sector_trading_execute.sql ################################
-- ============================================================================
-- IcanEra Sector Markets, part 4 of 4: buying and selling.
--
-- public.ican_sector_trade(...) is ONE atomic, idempotent, server-priced step, built the same way as
-- ican_trade_execute (20261018110000_icaneracoin_atomic_trade.sql), because it solves the same problems:
--   * who you are comes from the session (auth.uid()), never from an argument;
--   * the price is the sector's cached index price, never older than `stale_s`; the browser only says
--     what price it showed and how much movement it will accept (slippage);
--   * the user's wallet rows are locked in a fixed order before anything is checked, so one user's
--     concurrent trades queue behind each other and different users never wait on each other;
--   * every check happens before the first write, and the writes (wallet, holdings, fill, vault, idempotency
--     record) are one transaction: all of it or none;
--   * p_request_id makes a retry harmless; a per-user rate limit, per-trade and per-position ceilings and a
--     kill switch (sector_settings.trading_enabled, OFF until an administrator turns it on) protect the market.
--
-- WHAT A TRADE IS
--   BUY  : spend `p_amount` in ICEC (or in any currency the user has a wallet in, converted at the server's
--          price and FX). A fee (fee_bps) goes to the vault; the rest becomes units = net / index price.
--   SELL : give back `p_amount` units. They are worth units x index price; the fee stays in the vault; the
--          rest is paid to the user in ICEC or in a currency they hold.
--   The vault is the counterparty. It never holds a mutable balance row: it is an insert-only ledger
--   (vault_entries), so trades by different users never queue on a shared row.
--
-- RISK
--   * A BUY is refused unless the vault would still cover everything users hold even if every index rose by
--     `stress_pct` (default 50 %): vault >= exposure x (1 + stress_pct/100).
--   * A SELL is refused (vault_insufficient) if the vault cannot pay it. There are no IOUs.
--   * Two buys by different users can pass the stress check at the same instant; the over-admission is bounded
--     by (concurrent trades x max_trade_icec), which is what the stress margin is for.
--
-- WHAT THIS DOES NOT TOUCH
--   Sector trades are NOT written to ican_coin_transactions. The ICEC price engine counts every completed row
--   there as usage, so booking sector trades there would let someone move the coin's price by churning
--   them. Sector activity has its own immutable ledger (sector_fills) and the vault ledger.
--
-- Safe to run more than once. Rollback: supabase/rollback/20261019_rollback_sector_trading.sql
-- Requires: 20261019100000 .. 20261019120000, and ican_user_wallets, wallet_accounts, ican_currency_rates,
--           ican_current_price_ugx (20261018100000), ican_dev_secret (20261009100000).
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_trading.sector_index_cache') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261019120000_sector_trading_index.sql (and the files before it) first.';
  END IF;
END $$;


-- 1. The trade.
--    p_sector             'iAGRI' ...
--    p_side               'buy' | 'sell'
--    p_amount             buy: money to spend, in p_pay_currency.  sell: index units to sell.
--    p_pay_currency       'ICEC' (default) or the ISO code of a wallet the user holds (paid from / into that wallet)
--    p_request_id         unique per user ACTION; reuse it only to retry that same action
--    p_expected_price_icec the index price the screen showed (optional)
--    p_max_slippage_pct   how much WORSE than that the user accepts (default 1 %); better is always fine
-- Returns { success, ... }. On failure: { success:false, code, error } with nothing changed.
CREATE OR REPLACE FUNCTION public.ican_sector_trade(
  p_sector              TEXT,
  p_side                TEXT,
  p_amount              NUMERIC,
  p_pay_currency        TEXT    DEFAULT 'ICEC',
  p_request_id          TEXT    DEFAULT NULL,
  p_expected_price_icec NUMERIC DEFAULT NULL,
  p_max_slippage_pct    NUMERIC DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
DECLARE
  v_uid     UUID    := auth.uid();
  v_side    TEXT    := lower(btrim(COALESCE(p_side, '')));
  v_tick    TEXT    := btrim(COALESCE(p_sector, ''));
  v_cur     TEXT    := upper(btrim(COALESCE(p_pay_currency, 'ICEC')));
  v_slip    NUMERIC := COALESCE(p_max_slippage_pct, 1);
  s         icanera_trading.sector_settings;
  k         icanera_trading.sector_catalog;
  c         icanera_trading.sector_index_cache;
  h         icanera_trading.sector_holdings;
  v_prior   JSONB;
  v_recent  INT;
  v_price   NUMERIC;                 -- index price, ICEC per unit
  v_icec_ugx NUMERIC;                -- ICEC price in UGX (only for a money wallet)
  v_rate    NUMERIC;                 -- UGX per 1 of the money currency
  v_ugx     NUMERIC;
  v_pay     NUMERIC;                 -- buy: ICEC the user pays (gross, including the fee)
  v_gross   NUMERIC;                 -- sell: units x price
  v_fee     NUMERIC;
  v_net     NUMERIC;                 -- buy: collateral held; sell: ICEC the user is paid
  v_units   NUMERIC;
  v_local   NUMERIC;                 -- the money amount, when a money wallet is used
  v_cost    NUMERIC;                 -- cost basis added (buy) or released (sell)
  v_ican_bal NUMERIC;
  v_cash_bal NUMERIC;
  v_new_ican NUMERIC;
  v_new_cash NUMERIC;
  v_new_units NUMERIC;
  v_vault   NUMERIC;
  v_expo    NUMERIC;
  v_fill    UUID;
  v_result  JSONB;
  v_bad     BOOLEAN;
BEGIN
  -- ---- who and what ---------------------------------------------------------
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in to trade.');
  END IF;
  IF v_side NOT IN ('buy', 'sell') THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_side', 'error', 'Choose buy or sell.');
  END IF;
  IF p_amount IS NULL OR p_amount = 'NaN'::NUMERIC OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_amount', 'error', 'Enter a valid amount.');
  END IF;
  IF v_tick !~ '^i[A-Z]{3,6}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_sector', 'error', 'Unknown sector.');
  END IF;
  IF v_cur <> 'ICEC' AND v_cur !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'Unsupported currency.');
  END IF;
  IF p_request_id IS NULL OR char_length(p_request_id) NOT BETWEEN 8 AND 100 OR p_request_id !~ '^[A-Za-z0-9:_.-]+$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_request_id', 'error', 'Missing or invalid request id.');
  END IF;
  IF v_slip < 0 OR v_slip > 50 OR v_slip = 'NaN'::NUMERIC THEN v_slip := 1; END IF;

  SELECT * INTO s FROM icanera_trading.sector_settings WHERE id;
  IF NOT s.trading_enabled THEN
    RETURN jsonb_build_object('success', false, 'code', 'trading_paused', 'error', 'Sector trading is paused for a moment. Please try again shortly.');
  END IF;
  SELECT * INTO k FROM icanera_trading.sector_catalog WHERE ticker = v_tick AND enabled;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_sector', 'error', 'Unknown sector.');
  END IF;

  -- ---- one trade at a time per user, then lock their rows -----------------------
  -- Same order everywhere (coin wallet, then money wallet, then holdings), so two trades can never wait on each
  -- other in opposite directions. The coin wallet is created below, only once a trade is certain to go through.
  PERFORM pg_advisory_xact_lock(hashtextextended('ican_sector:' || v_uid::TEXT, 0));
  SELECT COALESCE(w.ican_balance, 0) INTO v_ican_bal
    FROM public.ican_user_wallets w WHERE w.user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN v_ican_bal := 0; END IF;
  IF v_cur <> 'ICEC' THEN
    SELECT a.balance INTO v_cash_bal
      FROM public.wallet_accounts a WHERE a.user_id = v_uid AND a.currency = v_cur AND a.status = 'active' FOR UPDATE;
  END IF;
  SELECT * INTO h FROM icanera_trading.sector_holdings WHERE user_id = v_uid AND sector = v_tick FOR UPDATE;

  -- ---- a retry of something that already happened: same answer, nothing moves
  SELECT r.result INTO v_prior FROM icanera_trading.trade_requests r WHERE r.user_id = v_uid AND r.request_id = p_request_id;
  IF FOUND THEN
    RETURN v_prior || jsonb_build_object('duplicate', true);
  END IF;

  -- ---- rate limit (retries above do not count) --------------------------------
  SELECT count(*) INTO v_recent FROM icanera_trading.trade_requests r
   WHERE r.user_id = v_uid AND r.created_at > now() - INTERVAL '1 minute';
  IF v_recent >= s.max_trades_per_minute THEN
    RETURN jsonb_build_object('success', false, 'code', 'rate_limited', 'error', 'Too many trades in a minute. Please wait a moment.');
  END IF;

  -- ---- the sector must be live and its index fresh ------------------------------
  PERFORM icanera_trading.fold_sector_indices(FALSE, FALSE);      -- cheap when fresh; skipped when another call is already doing it
  SELECT * INTO c FROM icanera_trading.sector_index_cache WHERE ticker = v_tick;
  IF NOT FOUND OR k.admin_halted OR c.status <> 'live' OR c.price_icec IS NULL OR c.price_icec <= 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'sector_not_live', 'sector', v_tick,
      'error', 'This sector is not open for trading yet.');
  END IF;
  IF c.computed_at < clock_timestamp() - make_interval(secs => s.stale_s) THEN
    RETURN jsonb_build_object('success', false, 'code', 'index_stale', 'sector', v_tick,
      'error', 'The index is updating. Please try again in a moment.');
  END IF;
  v_price := c.price_icec;

  IF p_expected_price_icec IS NOT NULL AND p_expected_price_icec > 0 THEN
    v_bad := CASE v_side
      WHEN 'buy'  THEN v_price > p_expected_price_icec * (1 + v_slip / 100)
      ELSE             v_price < p_expected_price_icec * (1 - v_slip / 100) END;
    IF v_bad THEN
      RETURN jsonb_build_object('success', false, 'code', 'price_moved', 'sector', v_tick, 'price_icec', v_price,
        'error', 'The price moved while you were trading. Review the new price and try again.');
    END IF;
  END IF;

  -- ---- money conversion is the server's, never the browser's -------------------
  IF v_cur <> 'ICEC' THEN
    v_icec_ugx := public.ican_current_price_ugx(3);
    SELECT r.rate_to_ugx INTO v_rate FROM public.ican_currency_rates r WHERE r.currency_code = v_cur;
    IF v_icec_ugx IS NULL OR v_icec_ugx <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'price_unavailable', 'error', 'The live coin price is unavailable right now. Please try again.');
    END IF;
    IF v_rate IS NULL OR v_rate <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'Unsupported currency.');
    END IF;
    IF v_cash_bal IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'no_cash_wallet', 'error', 'No wallet found for currency: ' || v_cur);
    END IF;
  END IF;

  -- ---- amounts ------------------------------------------------------------------
  IF v_side = 'buy' THEN
    IF v_cur = 'ICEC' THEN
      v_pay := trunc(p_amount, 8);
    ELSE
      v_local := trunc(p_amount, 2);
      v_ugx   := v_local * v_rate;
      v_pay   := trunc(v_ugx / v_icec_ugx, 8);
    END IF;
    v_fee   := trunc(v_pay * s.fee_bps / 10000, 8);
    v_net   := v_pay - v_fee;
    v_units := trunc(v_net / v_price, 8);
    v_cost  := v_pay;
    IF v_units <= 0 OR v_pay <= 0 OR (v_cur <> 'ICEC' AND v_local <= 0) THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small to trade.');
    END IF;
    IF v_pay > s.max_trade_icec THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_icec', s.max_trade_icec,
        'error', 'That is above the limit for a single trade.');
    END IF;
    IF COALESCE(h.cost_icec, 0) + v_pay > s.max_position_icec THEN
      RETURN jsonb_build_object('success', false, 'code', 'position_too_large', 'max_icec', s.max_position_icec,
        'error', 'That would take you above the limit for one sector.');
    END IF;
  ELSE
    v_units := trunc(p_amount, 8);
    IF v_units <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small to trade.');
    END IF;
    IF h.units IS NULL OR h.units < v_units THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_units',
        'error', format('You hold %s units of %s, need %s', COALESCE(h.units, 0), v_tick, v_units));
    END IF;
    v_gross := trunc(v_units * v_price, 8);
    v_fee   := trunc(v_gross * s.fee_bps / 10000, 8);
    v_net   := v_gross - v_fee;
    IF v_net <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small to trade.');
    END IF;
    IF v_gross > s.max_trade_icec THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_icec', s.max_trade_icec,
        'error', 'That is above the limit for a single trade. Sell in smaller parts.');
    END IF;
    IF v_cur <> 'ICEC' THEN
      v_local := trunc(v_net * v_icec_ugx / v_rate, 2);
      IF v_local <= 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small to trade.');
      END IF;
    END IF;
    v_cost := CASE WHEN v_units = h.units THEN h.cost_icec ELSE trunc(h.cost_icec * v_units / h.units, 8) END;
  END IF;

  -- ---- every check, before the first write -------------------------------------
  IF v_side = 'buy' THEN
    IF v_cur = 'ICEC' AND v_ican_bal < v_pay THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_funds',
        'error', format('Insufficient IcanEra balance. You have %s, need %s', v_ican_bal, v_pay));
    END IF;
    IF v_cur <> 'ICEC' AND v_cash_bal < v_local THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_funds',
        'error', format('Insufficient balance. You have %s %s, need %s', v_cash_bal, v_cur, v_local));
    END IF;
    -- would the vault still cover everyone if every index rose by stress_pct?
    v_vault := icanera_trading.vault_balance();
    v_expo  := icanera_trading.exposure_icec();
    IF v_vault + v_pay < (v_expo + v_units * v_price) * (1 + s.stress_pct / 100) THEN
      RETURN jsonb_build_object('success', false, 'code', 'capacity_reached', 'sector', v_tick,
        'error', 'Sector markets are at capacity right now. Please try again later or with a smaller amount.');
    END IF;
  ELSE
    v_vault := icanera_trading.vault_balance();
    IF v_vault < v_net THEN
      RETURN jsonb_build_object('success', false, 'code', 'vault_insufficient', 'sector', v_tick,
        'error', 'The market cannot pay this out right now. Nothing was sold; please try again later.');
    END IF;
    IF v_cur <> 'ICEC' AND v_cash_bal IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'no_cash_wallet', 'error', 'No wallet found for currency: ' || v_cur);
    END IF;
  END IF;

  -- ---- the trade: all of it, in this one transaction ----------------------------
  IF v_side = 'buy' THEN
    IF v_cur = 'ICEC' THEN
      UPDATE public.ican_user_wallets SET ican_balance = ican_balance - v_pay WHERE user_id = v_uid
      RETURNING ican_balance INTO v_new_ican;
    ELSE
      UPDATE public.wallet_accounts SET balance = balance - v_local, updated_at = now()
       WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    END IF;
    INSERT INTO icanera_trading.sector_holdings (user_id, sector, units, cost_icec)
    VALUES (v_uid, v_tick, v_units, v_cost)
    ON CONFLICT (user_id, sector) DO UPDATE
      SET units = icanera_trading.sector_holdings.units + EXCLUDED.units,
          cost_icec = icanera_trading.sector_holdings.cost_icec + EXCLUDED.cost_icec,
          updated_at = now()
    RETURNING units INTO v_new_units;
    v_gross := v_pay;
  ELSE
    IF v_cur = 'ICEC' THEN
      INSERT INTO public.ican_user_wallets (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
      UPDATE public.ican_user_wallets SET ican_balance = COALESCE(ican_balance, 0) + v_net WHERE user_id = v_uid
      RETURNING ican_balance INTO v_new_ican;
    ELSE
      UPDATE public.wallet_accounts SET balance = balance + v_local, updated_at = now()
       WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    END IF;
    UPDATE icanera_trading.sector_holdings
       SET units = units - v_units, cost_icec = cost_icec - v_cost, updated_at = now()
     WHERE user_id = v_uid AND sector = v_tick
    RETURNING units INTO v_new_units;
  END IF;

  INSERT INTO icanera_trading.sector_fills
    (user_id, sector, side, units, price_icec, gross_icec, fee_icec, net_icec, cost_basis_icec,
     pay_currency, pay_amount, fx_rate_to_ugx, icec_price_ugx, index_version, request_id)
  VALUES
    (v_uid, v_tick, v_side, v_units, v_price, v_gross, v_fee, v_net, v_cost,
     v_cur, v_local, v_rate, v_icec_ugx, c.version, p_request_id)
  RETURNING id INTO v_fill;

  IF v_side = 'buy' THEN
    INSERT INTO icanera_trading.vault_entries (kind, amount, sector, user_id, fill_id, memo)
    VALUES ('collateral', v_net, v_tick, v_uid, v_fill, 'buy');
  ELSE
    INSERT INTO icanera_trading.vault_entries (kind, amount, sector, user_id, fill_id, memo)
    VALUES ('payout', -v_gross, v_tick, v_uid, v_fill, 'sell');
  END IF;
  IF v_fee > 0 THEN
    INSERT INTO icanera_trading.vault_entries (kind, amount, sector, user_id, fill_id, memo)
    VALUES ('fee', v_fee, v_tick, v_uid, v_fill, v_side);
  END IF;

  v_result := jsonb_build_object(
    'success',           true,
    'side',              v_side,
    'sector',            v_tick,
    'units',             v_units,
    'price_icec',        v_price,
    'gross_icec',        v_gross,
    'fee_icec',          v_fee,
    'net_icec',          v_net,
    'pay_currency',      v_cur,
    'pay_amount',        v_local,
    'new_units',         v_new_units,
    'new_ican_balance',  v_new_ican,
    'new_local_balance', v_new_cash,
    'fill_id',           v_fill,
    'index_version',     c.version,
    'request_id',        p_request_id,
    'duplicate',         false
  );
  INSERT INTO icanera_trading.trade_requests (user_id, request_id, side, result)
  VALUES (v_uid, p_request_id, v_side, v_result);

  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_trade(TEXT, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_trade(TEXT, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;


-- 2. What a user sees of their own position. Only ever their own rows.
CREATE OR REPLACE FUNCTION public.ican_sector_my_holdings()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  RETURN jsonb_build_object('success', true, 'holdings', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'sector',     h.sector,
             'name',       k.name,
             'units',      h.units,
             'cost_icec',  h.cost_icec,
             'price_icec', c.price_icec,
             'value_icec', trunc(h.units * COALESCE(c.price_icec, 0), 8),
             'pnl_icec',   trunc(h.units * COALESCE(c.price_icec, 0), 8) - h.cost_icec,
             'pnl_pct',    CASE WHEN h.cost_icec > 0
                                THEN round(((trunc(h.units * COALESCE(c.price_icec, 0), 8) - h.cost_icec) / h.cost_icec) * 100, 2) END
           ) ORDER BY k.sort_order)
      FROM icanera_trading.sector_holdings h
      JOIN icanera_trading.sector_catalog k ON k.ticker = h.sector
      LEFT JOIN icanera_trading.sector_index_cache c ON c.ticker = h.sector
     WHERE h.user_id = v_uid AND h.units > 0), '[]'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_my_holdings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_my_holdings() TO authenticated;

CREATE OR REPLACE FUNCTION public.ican_sector_my_fills(p_limit INT DEFAULT 50, p_before TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE v_uid UUID := auth.uid(); v_n INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  RETURN jsonb_build_object('success', true, 'fills', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
      FROM (SELECT f.id, f.created_at, f.sector, f.side, f.units, f.price_icec, f.gross_icec, f.fee_icec, f.net_icec,
                   f.cost_basis_icec, f.pay_currency, f.pay_amount
              FROM icanera_trading.sector_fills f
             WHERE f.user_id = v_uid AND (p_before IS NULL OR f.created_at < p_before)
             ORDER BY f.created_at DESC LIMIT v_n) x), '[]'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_my_fills(INT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_my_fills(INT, TIMESTAMPTZ) TO authenticated;


-- 3. The developer panel: the same token check every ican_dev_* function uses.

-- Everything an operator needs to see at a glance.
CREATE OR REPLACE FUNCTION public.ican_sector_dev_overview(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  s       icanera_trading.sector_settings;
  v_vault NUMERIC;
  v_expo  NUMERIC;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  PERFORM icanera_trading.fold_sector_indices(FALSE, FALSE);
  SELECT * INTO s FROM icanera_trading.sector_settings WHERE id;
  v_vault := icanera_trading.vault_balance();
  v_expo  := icanera_trading.exposure_icec();
  RETURN jsonb_build_object(
    'settings', to_jsonb(s),
    'vault', jsonb_build_object(
      'balance_icec', v_vault, 'exposure_icec', v_expo,
      'cover_ratio', CASE WHEN v_expo > 0 THEN round(v_vault / v_expo, 4) END,
      'required_ratio', 1 + s.stress_pct / 100),
    'sectors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ticker', k.ticker, 'name', k.name, 'enabled', k.enabled, 'admin_halted', k.admin_halted,
               'status', COALESCE(c.status, 'warming_up'), 'contributors', COALESCE(c.contributors, 0),
               'level', c.level, 'price_icec', c.price_icec, 'computed_at', c.computed_at,
               'units_held', icanera_trading.sector_exposure_units(k.ticker)) ORDER BY k.sort_order)
        FROM icanera_trading.sector_catalog k LEFT JOIN icanera_trading.sector_index_cache c ON c.ticker = k.ticker), '[]'::JSONB),
    'industry_map', COALESCE((SELECT jsonb_agg(jsonb_build_object('industry', m.industry_value, 'ticker', m.ticker) ORDER BY m.ticker, m.industry_value)
                                FROM icanera_trading.sector_industry_map m), '[]'::JSONB),
    'outbox', jsonb_build_object(
      'unfolded', (SELECT count(*) FROM icanera_trading.telemetry_events WHERE folded_at IS NULL),
      'events_24h', (SELECT count(*) FROM icanera_trading.telemetry_events WHERE event_time > now() - INTERVAL '24 hours'),
      'businesses_accepted', (SELECT count(*) FROM icanera_trading.data_terms_acceptance a WHERE a.terms_version = s.current_terms_version)),
    'activity_24h', jsonb_build_object(
      'trades', (SELECT count(*) FROM icanera_trading.sector_fills WHERE created_at > now() - INTERVAL '24 hours'),
      'volume_icec', COALESCE((SELECT sum(gross_icec) FROM icanera_trading.sector_fills WHERE created_at > now() - INTERVAL '24 hours'), 0),
      'fees_icec', COALESCE((SELECT sum(fee_icec) FROM icanera_trading.sector_fills WHERE created_at > now() - INTERVAL '24 hours'), 0)),
    'folded_at', (SELECT folded_at FROM icanera_trading.fold_state WHERE id),
    'feed_version', (SELECT feed_version FROM icanera_trading.fold_state WHERE id)
  );
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_overview(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_overview(TEXT) TO authenticated;

-- Change settings. Only the keys listed here are accepted; every value is checked by the table's own constraints.
CREATE OR REPLACE FUNCTION public.ican_sector_dev_set_settings(dev_token TEXT, p_changes JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  v_allowed CONSTANT TEXT[] := ARRAY['trading_enabled','fee_bps','max_trades_per_minute','max_trade_icec','max_position_icec','stress_pct',
    'k_min','window_hours','contributor_cap_multiple','ema_minutes','max_move_pct_per_hour','stale_s','current_terms_version'];
  v_bad TEXT;
  s     icanera_trading.sector_settings;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN RAISE EXCEPTION 'p_changes must be an object' USING ERRCODE = '22023'; END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k WHERE k <> ALL (v_allowed) LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'unknown setting: %', v_bad USING ERRCODE = '22023'; END IF;
  IF p_changes ? 'current_terms_version'
     AND NOT EXISTS (SELECT 1 FROM icanera_trading.data_terms_text t WHERE t.version = (p_changes ->> 'current_terms_version')::INT) THEN
    RAISE EXCEPTION 'add the wording for that terms version to icanera_trading.data_terms_text first' USING ERRCODE = '22023';
  END IF;

  UPDATE icanera_trading.sector_settings SET
    trading_enabled          = COALESCE((p_changes ->> 'trading_enabled')::BOOLEAN,          trading_enabled),
    fee_bps                  = COALESCE((p_changes ->> 'fee_bps')::INT,                      fee_bps),
    max_trades_per_minute    = COALESCE((p_changes ->> 'max_trades_per_minute')::INT,        max_trades_per_minute),
    max_trade_icec           = COALESCE((p_changes ->> 'max_trade_icec')::NUMERIC,           max_trade_icec),
    max_position_icec        = COALESCE((p_changes ->> 'max_position_icec')::NUMERIC,        max_position_icec),
    stress_pct               = COALESCE((p_changes ->> 'stress_pct')::NUMERIC,               stress_pct),
    k_min                    = COALESCE((p_changes ->> 'k_min')::INT,                        k_min),
    window_hours             = COALESCE((p_changes ->> 'window_hours')::INT,                 window_hours),
    contributor_cap_multiple = COALESCE((p_changes ->> 'contributor_cap_multiple')::NUMERIC, contributor_cap_multiple),
    ema_minutes              = COALESCE((p_changes ->> 'ema_minutes')::NUMERIC,              ema_minutes),
    max_move_pct_per_hour    = COALESCE((p_changes ->> 'max_move_pct_per_hour')::NUMERIC,    max_move_pct_per_hour),
    stale_s                  = COALESCE((p_changes ->> 'stale_s')::INT,                      stale_s),
    current_terms_version    = COALESCE((p_changes ->> 'current_terms_version')::INT,        current_terms_version)
  WHERE id RETURNING * INTO s;

  -- viewers re-read the feed (trading_enabled and fee are part of it) and the indices pick the new maths up now
  UPDATE icanera_trading.fold_state SET feed_version = feed_version + 1 WHERE id;
  PERFORM icanera_trading.fold_sector_indices(TRUE, TRUE);
  RETURN to_jsonb(s);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_set_settings(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_set_settings(TEXT, JSONB) TO authenticated;

-- Show/hide or halt one sector.
CREATE OR REPLACE FUNCTION public.ican_sector_dev_set_sector(
  dev_token TEXT, p_ticker TEXT, p_enabled BOOLEAN DEFAULT NULL, p_halted BOOLEAN DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE k icanera_trading.sector_catalog;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE icanera_trading.sector_catalog
     SET enabled = COALESCE(p_enabled, enabled), admin_halted = COALESCE(p_halted, admin_halted)
   WHERE ticker = p_ticker RETURNING * INTO k;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown sector: %', p_ticker USING ERRCODE = '22023'; END IF;
  UPDATE icanera_trading.fold_state SET feed_version = feed_version + 1 WHERE id;
  PERFORM icanera_trading.fold_sector_indices(TRUE, TRUE);
  RETURN to_jsonb(k);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_set_sector(TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_set_sector(TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

-- Map a business category to a sector (p_ticker NULL removes the mapping).
CREATE OR REPLACE FUNCTION public.ican_sector_dev_map_industry(dev_token TEXT, p_industry TEXT, p_ticker TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE v_key TEXT := lower(btrim(COALESCE(p_industry, '')));
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF v_key = '' THEN RAISE EXCEPTION 'industry is required' USING ERRCODE = '22023'; END IF;
  IF p_ticker IS NULL THEN
    DELETE FROM icanera_trading.sector_industry_map WHERE industry_value = v_key;
  ELSE
    INSERT INTO icanera_trading.sector_industry_map (industry_value, ticker) VALUES (v_key, p_ticker)
    ON CONFLICT (industry_value) DO UPDATE SET ticker = EXCLUDED.ticker;
  END IF;
  RETURN jsonb_build_object('industry', v_key, 'ticker', p_ticker);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_map_industry(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_map_industry(TEXT, TEXT, TEXT) TO authenticated;

-- Put ICEC into the vault (positive) or take surplus out (negative). A withdrawal may never leave the vault
-- below what it needs to cover users under the stress margin. Every movement is a permanent ledger entry
-- with the reason given.
CREATE OR REPLACE FUNCTION public.ican_sector_dev_vault_adjust(dev_token TEXT, p_amount NUMERIC, p_memo TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  s       icanera_trading.sector_settings;
  v_vault NUMERIC;
  v_expo  NUMERIC;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_amount IS NULL OR p_amount = 0 OR p_amount = 'NaN'::NUMERIC OR abs(p_amount) > 1000000000000 THEN
    RAISE EXCEPTION 'amount must be a non-zero number' USING ERRCODE = '22023';
  END IF;
  IF p_memo IS NULL OR char_length(btrim(p_memo)) < 3 THEN RAISE EXCEPTION 'say why in the memo' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('icanera_vault_adjust', 0));    -- one adjustment at a time
  SELECT * INTO s FROM icanera_trading.sector_settings WHERE id;
  v_vault := icanera_trading.vault_balance();
  v_expo  := icanera_trading.exposure_icec();
  IF p_amount < 0 AND v_vault + p_amount < v_expo * (1 + s.stress_pct / 100) THEN
    RAISE EXCEPTION 'that would leave the vault (%) below what users hold (%) plus the % %% stress margin',
      v_vault + p_amount, v_expo, s.stress_pct USING ERRCODE = '22023';
  END IF;
  INSERT INTO icanera_trading.vault_entries (kind, amount, memo)
  VALUES (CASE WHEN p_amount > 0 THEN 'funding' ELSE 'adjustment' END, p_amount, left(btrim(p_memo), 300));
  RETURN jsonb_build_object('success', true, 'balance_icec', icanera_trading.vault_balance());
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_vault_adjust(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_vault_adjust(TEXT, NUMERIC, TEXT) TO authenticated;

-- The books must balance. Everything here is recomputed from the immutable ledgers and compared with the caches.
CREATE OR REPLACE FUNCTION public.ican_sector_dev_reconcile(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  v_cached NUMERIC; v_sum NUMERIC; v_bad JSONB; v_neg BIGINT; v_fills_bad BIGINT;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT icanera_trading.vault_balance(), COALESCE((SELECT SUM(amount) FROM icanera_trading.vault_entries), 0) INTO v_cached, v_sum;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('sector', x.sector, 'cached_units', x.cached, 'holdings_units', x.held)), '[]'::JSONB) INTO v_bad
    FROM (SELECT k.ticker AS sector, icanera_trading.sector_exposure_units(k.ticker) AS cached,
                 COALESCE((SELECT SUM(h.units) FROM icanera_trading.sector_holdings h WHERE h.sector = k.ticker), 0) AS held
            FROM icanera_trading.sector_catalog k) x
   WHERE x.cached <> x.held;
  SELECT count(*) INTO v_neg FROM icanera_trading.sector_holdings WHERE units < 0 OR cost_icec < 0;
  -- every fill has the vault entries it should: buys +net (+fee), sells -gross (+fee)
  SELECT count(*) INTO v_fills_bad
    FROM icanera_trading.sector_fills f
   WHERE (SELECT COALESCE(SUM(e.amount), 0) FROM icanera_trading.vault_entries e WHERE e.fill_id = f.id)
         <> CASE f.side WHEN 'buy' THEN f.net_icec + f.fee_icec ELSE -f.net_icec END;
  RETURN jsonb_build_object(
    'ok', v_cached = v_sum AND v_bad = '[]'::JSONB AND v_neg = 0 AND v_fills_bad = 0,
    'vault_balance', v_cached, 'vault_ledger_sum', v_sum, 'vault_matches', v_cached = v_sum,
    'units_mismatches', v_bad, 'negative_holdings', v_neg, 'fills_without_matching_vault_entries', v_fills_bad);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_reconcile(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_reconcile(TEXT) TO authenticated;


-- 4. Old idempotency records are only needed while a client might still retry.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('icanera-sector-prune-requests', '29 3 * * *',
      $job$DELETE FROM icanera_trading.trade_requests WHERE created_at < now() - INTERVAL '30 days'$job$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'sector trading: could not schedule the nightly prune (%): old trade requests will just stay.', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
