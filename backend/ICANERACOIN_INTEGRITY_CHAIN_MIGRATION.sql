-- ============================================================
-- ICANERACOIN INTEGRITY CHAIN MIGRATION
-- Run once in Supabase SQL editor
--
-- Tamper-evident hash chain over the icaneracoin ledger, computed
-- entirely inside Postgres — no external blockchain, no wallet key.
-- icaneracoin has no real Ethereum keypair behind it (see
-- frontend/src/services/pitchinShareBlockchainService.js), so there is
-- nothing to sign an on-chain transaction with. This gives the same
-- tamper-evidence guarantee a real blockchain would: every tracked
-- event's hash incorporates the hash of the event before it, so any row
-- edited directly in the database after the fact breaks the chain from
-- that point forward, detectable via fn_verify_icaneracoin_chain().
--
-- This is about ledger INTEGRITY, not price control — icaneracoin's
-- price/inflation mechanism (World Bank refresh cron in backend/server.js)
-- is untouched by this migration.
--
-- Scope (Phase 1 — see backend/ICANERACOIN_INTEGRITY_CHAIN_MIGRATION.sql
-- companion plan for what's deliberately deferred to Phase 2):
--   Core coin ledger:      ican_user_profiles, ican_user_wallets,
--                          ican_coin_transactions
--   Business/app entities: business_profiles, cmms_inventory_items,
--                          marketplace_listings, purchase_orders
-- The last two live in sibling repos (FARM-AGENT, digital-city-era) but
-- share this same Supabase database — their trigger attachment is
-- wrapped in an existence check so this file is safe to run whether or
-- not those tables exist yet in this environment.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── 1. Chain table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS icaneracoin_integrity_chain (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq            BIGSERIAL UNIQUE,
  source_table   TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  event_type     TEXT NOT NULL CHECK (event_type IN ('INSERT', 'UPDATE')),
  row_snapshot   JSONB NOT NULL,
  previous_hash  TEXT NOT NULL,
  chain_hash     TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_icaneracoin_chain_source
  ON icaneracoin_integrity_chain(source_table, source_id);

ALTER TABLE icaneracoin_integrity_chain ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_chain" ON icaneracoin_integrity_chain;
CREATE POLICY "read_chain" ON icaneracoin_integrity_chain
  FOR SELECT USING (auth.role() = 'authenticated');

-- Append-only: no policy permits UPDATE/DELETE for any client role, and
-- fn_icaneracoin_chain_append() below is SECURITY DEFINER so it can still
-- insert regardless. Explicit `false` policies (matching cmms_audit_log's
-- pattern in CMMS_BLOCKCHAIN_SECURITY.sql) rather than just omitting them,
-- so the append-only intent is self-documenting.
DROP POLICY IF EXISTS "no_update_chain" ON icaneracoin_integrity_chain;
CREATE POLICY "no_update_chain" ON icaneracoin_integrity_chain
  FOR UPDATE USING (FALSE);

DROP POLICY IF EXISTS "no_delete_chain" ON icaneracoin_integrity_chain;
CREATE POLICY "no_delete_chain" ON icaneracoin_integrity_chain
  FOR DELETE USING (FALSE);

-- ─── 2. Append trigger function ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_icaneracoin_chain_append()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_prev_hash    TEXT;
  v_source_id    TEXT;
  v_row_snapshot JSONB;
  v_chain_hash   TEXT;
BEGIN
  SELECT chain_hash INTO v_prev_hash
  FROM icaneracoin_integrity_chain
  ORDER BY seq DESC
  LIMIT 1;

  IF v_prev_hash IS NULL THEN
    v_prev_hash := 'GENESIS';
  END IF;

  v_row_snapshot := to_jsonb(NEW);
  v_source_id    := (v_row_snapshot->>'id');

  v_chain_hash := encode(
    digest(
      TG_TABLE_NAME || '|' || TG_OP || '|' || COALESCE(v_source_id, '') ||
      '|' || v_row_snapshot::TEXT || '|' || v_prev_hash,
      'sha256'
    ),
    'hex'
  );

  INSERT INTO icaneracoin_integrity_chain (
    source_table, source_id, event_type, row_snapshot, previous_hash, chain_hash
  ) VALUES (
    TG_TABLE_NAME, COALESCE(v_source_id, 'unknown'), TG_OP, v_row_snapshot, v_prev_hash, v_chain_hash
  );

  RETURN NEW;
END;
$$;

-- ─── 3. Verify function ──────────────────────────────────────────────────────
-- Recomputes each link from stored data and compares against the stored
-- chain_hash — a row is only "broken" if the CHAIN TABLE itself (previous_hash
-- / chain_hash / row_snapshot) was altered after the fact. This does not
-- check whether the SOURCE table's current live data still matches
-- row_snapshot (that's a separate, optional check — ask if you want it).

CREATE OR REPLACE FUNCTION fn_verify_icaneracoin_chain()
RETURNS TABLE (
  seq              BIGINT,
  source_table     TEXT,
  source_id        TEXT,
  expected_prev    TEXT,
  actual_prev      TEXT,
  recomputed_hash  TEXT,
  stored_hash      TEXT
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH chain AS (
    SELECT
      c.seq, c.source_table, c.source_id, c.event_type, c.row_snapshot,
      c.previous_hash, c.chain_hash,
      COALESCE(LAG(c.chain_hash) OVER (ORDER BY c.seq), 'GENESIS') AS actual_prev_hash
    FROM icaneracoin_integrity_chain c
  ),
  checked AS (
    SELECT
      chain.*,
      encode(
        digest(
          chain.source_table || '|' || chain.event_type || '|' || COALESCE(chain.source_id, '') ||
          '|' || chain.row_snapshot::TEXT || '|' || chain.previous_hash,
          'sha256'
        ),
        'hex'
      ) AS recomputed_chain_hash
    FROM chain
  )
  SELECT
    checked.seq,
    checked.source_table,
    checked.source_id,
    checked.previous_hash AS expected_prev,
    checked.actual_prev_hash AS actual_prev,
    checked.recomputed_chain_hash AS recomputed_hash,
    checked.chain_hash AS stored_hash
  FROM checked
  WHERE checked.previous_hash <> checked.actual_prev_hash
     OR checked.chain_hash <> checked.recomputed_chain_hash
  ORDER BY checked.seq;
$$;

GRANT EXECUTE ON FUNCTION fn_verify_icaneracoin_chain() TO authenticated;

-- ─── 4. Attach triggers — core coin ledger (schema confirmed live) ──────────

DROP TRIGGER IF EXISTS trg_icaneracoin_chain_profiles ON ican_user_profiles;
CREATE TRIGGER trg_icaneracoin_chain_profiles
  AFTER INSERT ON ican_user_profiles
  FOR EACH ROW EXECUTE FUNCTION fn_icaneracoin_chain_append();

DROP TRIGGER IF EXISTS trg_icaneracoin_chain_wallets ON ican_user_wallets;
CREATE TRIGGER trg_icaneracoin_chain_wallets
  AFTER INSERT OR UPDATE ON ican_user_wallets
  FOR EACH ROW EXECUTE FUNCTION fn_icaneracoin_chain_append();

DROP TRIGGER IF EXISTS trg_icaneracoin_chain_coin_tx ON ican_coin_transactions;
CREATE TRIGGER trg_icaneracoin_chain_coin_tx
  AFTER INSERT OR UPDATE ON ican_coin_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_icaneracoin_chain_append();

-- ─── 5. Attach triggers — business/app entities ─────────────────────────────
-- business_profiles and cmms_inventory_items live in this same repo/DB, so
-- they're attached directly. marketplace_listings (FARM-AGENT) and
-- purchase_orders (digital-city-era) live in sibling repos against the same
-- physical Supabase database — guarded with an existence check so this file
-- runs cleanly whether or not those tables exist yet in this environment.

DROP TRIGGER IF EXISTS trg_icaneracoin_chain_business_profiles ON business_profiles;
CREATE TRIGGER trg_icaneracoin_chain_business_profiles
  AFTER INSERT OR UPDATE ON business_profiles
  FOR EACH ROW EXECUTE FUNCTION fn_icaneracoin_chain_append();

DROP TRIGGER IF EXISTS trg_icaneracoin_chain_cmms_inventory ON cmms_inventory_items;
CREATE TRIGGER trg_icaneracoin_chain_cmms_inventory
  AFTER INSERT OR UPDATE ON cmms_inventory_items
  FOR EACH ROW EXECUTE FUNCTION fn_icaneracoin_chain_append();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'marketplace_listings'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_icaneracoin_chain_marketplace_listings ON public.marketplace_listings';
    EXECUTE 'CREATE TRIGGER trg_icaneracoin_chain_marketplace_listings
             AFTER INSERT OR UPDATE ON public.marketplace_listings
             FOR EACH ROW EXECUTE FUNCTION fn_icaneracoin_chain_append()';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'purchase_orders'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_icaneracoin_chain_purchase_orders ON public.purchase_orders';
    EXECUTE 'CREATE TRIGGER trg_icaneracoin_chain_purchase_orders
             AFTER INSERT OR UPDATE ON public.purchase_orders
             FOR EACH ROW EXECUTE FUNCTION fn_icaneracoin_chain_append()';
  END IF;
END $$;

SELECT 'icaneracoin integrity chain installed — run SELECT * FROM fn_verify_icaneracoin_chain(); to check for breaks.' AS status;
