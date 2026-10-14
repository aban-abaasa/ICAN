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
