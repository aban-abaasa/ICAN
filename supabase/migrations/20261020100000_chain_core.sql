-- ============================================================================
-- IcanEra on-chain tokens, part 1 of 3: the isolated bridge schema.
--
-- WHAT THIS IS
--   icaneracoin exists in two on-chain forms (contracts in /blockchain):
--     ICEC-S  the stable form. Backed 1:1 by a USD stablecoin in a public vault. It lives ONLY on the chain, in the
--             user's own wallet. The database never holds, mints or moves it, so nothing here concerns it except the
--             addresses and display settings that tell the app where it is.
--     ICEC-C  the community form. A non-transferable on-chain RECEIPT for ledger icaneracoin. Its price is whatever
--             the platform engine says, exactly like the ledger coin. This schema is the bridge between the two:
--               withdraw : ledger ICEC is locked here, then the relayer mints the same amount on-chain, once;
--               deposit  : the holder burns ICEC-C, and the ledger is credited the same amount, once.
--   Self-custody only: users sign every on-chain action with their own wallet. Nothing in this schema ever holds a key.
--
-- WHAT KEEPS THE BOOKS TRUE
--   * locked_entries is an insert-only ledger: +amount when ledger ICEC is locked for a withdrawal, -amount when it
--     goes back (cancelled) or is credited to a user (a burn). Partial unique indexes make "locked once, cancelled at
--     most once, credited once per burn" a property of the table, not only of the functions.
--   * A burn is credited only to the account that PROVED it owns the burning address, and only up to what has been
--     bridged out to that account and not yet returned. Tokens minted to anyone else can never become ledger credit.
--   * A withdrawal can be cancelled (and refunded) only while it is still 'pending', i.e. before the relayer has signed
--     anything. After that the mint may exist on-chain, so the ledger never refunds it.
--   * The relayer's own claims are cross-checked: a mint for an unknown or different withdrawal, or on-chain supply
--     that disagrees with the ledger, raises an anomaly and halts new withdrawals.
--   * Bridge moves are NOT written to ican_coin_transactions. The ICEC price engine counts every completed row there
--     as usage, so booking bridge moves there would let someone move the coin's price by bridging back and forth.
--
-- HOW IT STAYS OUT OF THE WAY
--   Its own schema (icanera_chain). No table in it is readable or writable by anon / authenticated / PUBLIC. The only
--   doors are the SECURITY DEFINER ican_chain_* / ican_bridge_* functions (file 2), and the relayer's doors are granted
--   to service_role alone.
--
-- SAFETY DEFAULTS
--   The bridge is OFF (chain_settings.bridge_enabled = FALSE) until an administrator configures a chain and turns it on.
--   Re-running this file keeps every setting an administrator changed.
--
-- Safe to run more than once. Rollback: supabase/rollback/20261020_rollback_chain.sql
-- Requires: ican_user_wallets (already deployed).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS icanera_chain;
REVOKE ALL ON SCHEMA icanera_chain FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA icanera_chain REVOKE ALL ON TABLES    FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA icanera_chain REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA icanera_chain REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;


-- 1. Switches an administrator can change from the SQL editor (one row).
CREATE TABLE IF NOT EXISTS icanera_chain.chain_settings (
  id                         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  bridge_enabled             BOOLEAN NOT NULL DEFAULT FALSE,          -- FALSE stops NEW withdrawals (burn-backs are always credited)
  -- where the contracts are (set once per network by the administrator; lower-case 0x addresses)
  chain_id                   BIGINT  CHECK (chain_id IS NULL OR chain_id > 0),
  icec_community_address     TEXT    CHECK (icec_community_address IS NULL OR icec_community_address ~ '^0x[0-9a-f]{40}$'),
  stable_token_address       TEXT    CHECK (stable_token_address   IS NULL OR stable_token_address   ~ '^0x[0-9a-f]{40}$'),
  stable_vault_address       TEXT    CHECK (stable_vault_address   IS NULL OR stable_vault_address   ~ '^0x[0-9a-f]{40}$'),
  reserve_token_address      TEXT    CHECK (reserve_token_address  IS NULL OR reserve_token_address  ~ '^0x[0-9a-f]{40}$'),
  reserve_token_symbol       TEXT    NOT NULL DEFAULT 'USDC' CHECK (char_length(reserve_token_symbol) BETWEEN 2 AND 12),
  chain_name                 TEXT    CHECK (chain_name IS NULL OR char_length(chain_name) BETWEEN 2 AND 40),
  explorer_url               TEXT    CHECK (explorer_url IS NULL OR explorer_url ~ '^https://[^\s]+$'),
  is_testnet                 BOOLEAN NOT NULL DEFAULT TRUE,           -- shown to users; flip deliberately, never by accident
  -- bridge limits
  confirmations              INT     NOT NULL DEFAULT 12 CHECK (confirmations BETWEEN 1 AND 500),   -- blocks the relayer waits before it believes an event
  min_withdrawal_icec        NUMERIC NOT NULL DEFAULT 1    CHECK (min_withdrawal_icec > 0),
  max_withdrawal_icec        NUMERIC NOT NULL DEFAULT 1000 CHECK (max_withdrawal_icec > 0),
  max_daily_withdrawal_icec  NUMERIC NOT NULL DEFAULT 5000 CHECK (max_daily_withdrawal_icec > 0),    -- per user, trailing 24 h
  max_withdrawals_per_hour   INT     NOT NULL DEFAULT 10   CHECK (max_withdrawals_per_hour > 0),
  max_addresses_per_user     INT     NOT NULL DEFAULT 3    CHECK (max_addresses_per_user BETWEEN 1 AND 20),
  challenge_ttl_s            INT     NOT NULL DEFAULT 600  CHECK (challenge_ttl_s BETWEEN 60 AND 3600),
  -- informational FX (file 3): used only to turn a USD amount into a local-currency figure on screen
  fx_max_jump_pct            NUMERIC NOT NULL DEFAULT 5    CHECK (fx_max_jump_pct > 0 AND fx_max_jump_pct <= 100),
  fx_stale_s                 INT     NOT NULL DEFAULT 900  CHECK (fx_stale_s > 0),
  fx_twap_s                  INT     NOT NULL DEFAULT 60   CHECK (fx_twap_s BETWEEN 5 AND 3600),
  CHECK (max_withdrawal_icec >= min_withdrawal_icec),
  CHECK (max_daily_withdrawal_icec >= max_withdrawal_icec)
);
INSERT INTO icanera_chain.chain_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;


-- 2. Addresses users have PROVEN they control. The proof is a wallet signature over a one-time challenge; the relayer
--    checks the signature (a database cannot recover an Ethereum signer) and then asks for the link to be recorded.
--    A link is permanent for the credit side: a burn from this address always credits THIS account, even after the
--    address is revoked. That direction is safe by construction, because it can only ever return value to the account
--    that bridged it out, whoever holds the key now. Revoking only stops NEW withdrawals to the address.
CREATE TABLE IF NOT EXISTS icanera_chain.link_challenges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL,
  chain_id   BIGINT      NOT NULL,
  address    TEXT        NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  message    TEXT        NOT NULL,                  -- exactly what the wallet shows and signs
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS link_challenges_user ON icanera_chain.link_challenges (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS icanera_chain.user_addresses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL,
  chain_id     BIGINT      NOT NULL,
  address      TEXT        NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  challenge_id UUID        NOT NULL REFERENCES icanera_chain.link_challenges(id),
  signature    TEXT        NOT NULL,                -- kept as the audit trail of the proof
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  UNIQUE (chain_id, address)                        -- one account per address, ever
);
CREATE INDEX IF NOT EXISTS user_addresses_user ON icanera_chain.user_addresses (user_id);


-- 3. Withdrawals: ledger ICEC -> ICEC-C.
--    ref is the bytes32 the contract sees: sha256 of the withdrawal id as text. The contract mints each ref at most once.
CREATE TABLE IF NOT EXISTS icanera_chain.bridge_withdrawals (
  id             UUID PRIMARY KEY,
  ref            TEXT        NOT NULL UNIQUE CHECK (ref ~ '^0x[0-9a-f]{64}$'),
  user_id        UUID        NOT NULL,
  address_id     UUID        NOT NULL REFERENCES icanera_chain.user_addresses(id),
  chain_id       BIGINT      NOT NULL,
  to_address     TEXT        NOT NULL CHECK (to_address ~ '^0x[0-9a-f]{40}$'),
  amount         NUMERIC(28,8) NOT NULL CHECK (amount > 0 AND amount = trunc(amount, 8)),
  amount_units   NUMERIC(40,0) GENERATED ALWAYS AS (amount * 100000000) STORED,    -- the on-chain integer (8 decimals)
  request_id     TEXT        NOT NULL CHECK (char_length(request_id) BETWEEN 8 AND 100),
  status         TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'minted', 'cancelled')),
  tx_hash        TEXT        CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),   -- the signed mint transaction, recorded BEFORE it is broadcast
  submitted_at   TIMESTAMPTZ,
  attempts       INT         NOT NULL DEFAULT 0,
  last_error     TEXT,
  minted_tx_hash TEXT        CHECK (minted_tx_hash IS NULL OR minted_tx_hash ~ '^0x[0-9a-f]{64}$'),
  minted_block   BIGINT,
  minted_log_index INT,
  minted_at      TIMESTAMPTZ,
  cancelled_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id),
  CHECK ((status = 'minted') = (minted_block IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS bridge_withdrawals_user  ON icanera_chain.bridge_withdrawals (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bridge_withdrawals_queue ON icanera_chain.bridge_withdrawals (created_at) WHERE status IN ('pending', 'submitted');


-- 4. Deposits: ICEC-C burned -> ledger credit. One row per burn event; (chain, tx, log index) can never repeat.
CREATE TABLE IF NOT EXISTS icanera_chain.bridge_deposits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id     BIGINT      NOT NULL,
  tx_hash      TEXT        NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index    INT         NOT NULL CHECK (log_index >= 0),
  block_number BIGINT      NOT NULL CHECK (block_number >= 0),
  from_address TEXT        NOT NULL CHECK (from_address ~ '^0x[0-9a-f]{40}$'),
  amount       NUMERIC(28,8) NOT NULL CHECK (amount > 0),
  credit_id    TEXT,                                -- the reference the holder chose in burnForCredit
  status       TEXT        NOT NULL CHECK (status IN ('credited', 'unclaimed')),
  user_id      UUID,
  reason       TEXT,                                -- why a burn is unclaimed
  credited_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index),
  CHECK ((status = 'credited') = (credited_at IS NOT NULL AND user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS bridge_deposits_user    ON icanera_chain.bridge_deposits (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bridge_deposits_from    ON icanera_chain.bridge_deposits (from_address, created_at DESC);
CREATE INDEX IF NOT EXISTS bridge_deposits_unclaim ON icanera_chain.bridge_deposits (created_at) WHERE status = 'unclaimed';


-- 5. The locked ledger. Ledger ICEC that is locked here is exactly what ICEC-C on-chain (plus what is on its way, plus
--    unclaimed burns) stands for. Insert-only, no hot row.
CREATE TABLE IF NOT EXISTS icanera_chain.locked_entries (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT        NOT NULL CHECK (kind IN ('lock', 'cancel', 'credit')),
  amount        NUMERIC(28,8) NOT NULL,             -- + when locked, - when released
  user_id       UUID        NOT NULL,
  withdrawal_id UUID        REFERENCES icanera_chain.bridge_withdrawals(id),
  deposit_id    UUID        REFERENCES icanera_chain.bridge_deposits(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'lock'   AND amount > 0 AND withdrawal_id IS NOT NULL AND deposit_id IS NULL)
      OR (kind = 'cancel' AND amount < 0 AND withdrawal_id IS NOT NULL AND deposit_id IS NULL)
      OR (kind = 'credit' AND amount < 0 AND deposit_id IS NOT NULL AND withdrawal_id IS NULL))
);
-- Each withdrawal is locked once and released at most once; each burn is credited at most once.
CREATE UNIQUE INDEX IF NOT EXISTS locked_entries_once_per_withdrawal ON icanera_chain.locked_entries (withdrawal_id, kind) WHERE kind IN ('lock', 'cancel');
CREATE UNIQUE INDEX IF NOT EXISTS locked_entries_once_per_deposit    ON icanera_chain.locked_entries (deposit_id) WHERE kind = 'credit';


-- 6. Things that should never happen, and what the relayer checks against the chain.
CREATE TABLE IF NOT EXISTS icanera_chain.anomalies (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT        NOT NULL,                 -- unknown_mint | mint_mismatch | mint_after_cancel | supply_mismatch | wrong_chain | ...
  details     JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution  TEXT
);
CREATE INDEX IF NOT EXISTS anomalies_open ON icanera_chain.anomalies (created_at) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS icanera_chain.supply_checks (
  id                   BIGSERIAL PRIMARY KEY,
  chain_id             BIGINT      NOT NULL,
  block_number         BIGINT      NOT NULL,
  onchain_supply_units NUMERIC(40,0) NOT NULL,
  expected_supply_units NUMERIC(40,0) NOT NULL,
  ok                   BOOLEAN     NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The relayer's place in the chain, and a lease so two overlapping cron runs never sign the same nonce.
CREATE TABLE IF NOT EXISTS icanera_chain.sync_state (
  name         TEXT PRIMARY KEY,
  last_block   BIGINT      NOT NULL DEFAULT 0,
  lease_holder TEXT,
  lease_until  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 7. Guards. Money tables are not editable by accident or by a buggy function.
CREATE OR REPLACE FUNCTION icanera_chain.forbid_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows are never changed or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
END; $$;

DROP TRIGGER IF EXISTS trg_locked_entries_immutable ON icanera_chain.locked_entries;
CREATE TRIGGER trg_locked_entries_immutable BEFORE UPDATE OR DELETE ON icanera_chain.locked_entries
  FOR EACH ROW EXECUTE FUNCTION icanera_chain.forbid_change();
DROP TRIGGER IF EXISTS trg_supply_checks_immutable ON icanera_chain.supply_checks;
CREATE TRIGGER trg_supply_checks_immutable BEFORE UPDATE OR DELETE ON icanera_chain.supply_checks
  FOR EACH ROW EXECUTE FUNCTION icanera_chain.forbid_change();

-- A withdrawal's identity and amount never change; its status only moves along the legal paths:
--   pending -> submitted | cancelled | minted      submitted -> pending (a reverted attempt) | minted
--   minted and cancelled are final.
CREATE OR REPLACE FUNCTION icanera_chain.guard_withdrawal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bridge_withdrawals rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.ref, NEW.user_id, NEW.address_id, NEW.chain_id, NEW.to_address, NEW.amount, NEW.request_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.ref, OLD.user_id, OLD.address_id, OLD.chain_id, OLD.to_address, OLD.amount, OLD.request_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a withdrawal''s identity and amount cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (('pending', 'submitted'), ('pending', 'cancelled'), ('pending', 'minted'),
                                         ('submitted', 'pending'), ('submitted', 'minted'))) THEN
      RAISE EXCEPTION 'illegal withdrawal status change % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status IN ('minted', 'cancelled') THEN
    RAISE EXCEPTION 'a % withdrawal is final', OLD.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_withdrawal ON icanera_chain.bridge_withdrawals;
CREATE TRIGGER trg_guard_withdrawal BEFORE UPDATE OR DELETE ON icanera_chain.bridge_withdrawals
  FOR EACH ROW EXECUTE FUNCTION icanera_chain.guard_withdrawal();

-- A burn record never changes what happened on-chain; the only edit is unclaimed -> credited.
CREATE OR REPLACE FUNCTION icanera_chain.guard_deposit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bridge_deposits rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.chain_id, NEW.tx_hash, NEW.log_index, NEW.block_number, NEW.from_address, NEW.amount, NEW.credit_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.chain_id, OLD.tx_hash, OLD.log_index, OLD.block_number, OLD.from_address, OLD.amount, OLD.credit_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a recorded burn cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'credited' THEN
    RAISE EXCEPTION 'a credited burn is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_deposit ON icanera_chain.bridge_deposits;
CREATE TRIGGER trg_guard_deposit BEFORE UPDATE OR DELETE ON icanera_chain.bridge_deposits
  FOR EACH ROW EXECUTE FUNCTION icanera_chain.guard_deposit();

-- A proof of address ownership is never edited; the only change is revoking (and re-linking with a fresh proof).
CREATE OR REPLACE FUNCTION icanera_chain.guard_address()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'user_addresses rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.user_id, NEW.chain_id, NEW.address) IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.chain_id, OLD.address) THEN
    RAISE EXCEPTION 'a linked address cannot be moved to another account' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_address ON icanera_chain.user_addresses;
CREATE TRIGGER trg_guard_address BEFORE UPDATE OR DELETE ON icanera_chain.user_addresses
  FOR EACH ROW EXECUTE FUNCTION icanera_chain.guard_address();

-- A challenge can be used once.
CREATE OR REPLACE FUNCTION icanera_chain.guard_challenge()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF (NEW.id, NEW.user_id, NEW.chain_id, NEW.address, NEW.message, NEW.expires_at)
     IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.chain_id, OLD.address, OLD.message, OLD.expires_at) OR OLD.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'a signed challenge cannot be altered or reused' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_challenge ON icanera_chain.link_challenges;
CREATE TRIGGER trg_guard_challenge BEFORE UPDATE OR DELETE ON icanera_chain.link_challenges
  FOR EACH ROW EXECUTE FUNCTION icanera_chain.guard_challenge();


-- 8. Small, hot, one-row tables must keep fresh statistics (same lesson as the sector schema).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['chain_settings', 'sync_state'] LOOP
    EXECUTE format('ALTER TABLE icanera_chain.%I SET (autovacuum_vacuum_threshold = 20, autovacuum_vacuum_scale_factor = 0, '
                   'autovacuum_analyze_threshold = 20, autovacuum_analyze_scale_factor = 0)', t);
  END LOOP;
END $$;


-- 9. Helpers shared by the functions in file 2.
CREATE OR REPLACE FUNCTION icanera_chain.norm_address(p_addr TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p_addr ~ '^0x[0-9a-fA-F]{40}$' THEN lower(p_addr) END
$$;

-- 'sha256 of the withdrawal id as text', the bytes32 the contract records. The relayer recomputes it and refuses a mismatch.
CREATE OR REPLACE FUNCTION icanera_chain.withdrawal_ref(p_id UUID)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT '0x' || encode(sha256(convert_to(p_id::TEXT, 'UTF8')), 'hex')
$$;

-- The relayer's doors are for the service role only. (EXECUTE is also revoked from everyone else; this is the second lock.)
CREATE OR REPLACE FUNCTION icanera_chain.require_operator()
RETURNS VOID LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
END; $$;

-- ledger ICEC the bridge currently holds, recomputed from the ledger (reconcile and tests; never on the hot path)
CREATE OR REPLACE FUNCTION icanera_chain.locked_total()
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(amount), 0) FROM icanera_chain.locked_entries
$$;

-- What the chain should hold at a block: everything minted up to it, less everything burned up to it.
CREATE OR REPLACE FUNCTION icanera_chain.expected_supply_units(p_chain_id BIGINT, p_block BIGINT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT SUM(w.amount_units) FROM icanera_chain.bridge_withdrawals w
                    WHERE w.chain_id = p_chain_id AND w.status = 'minted' AND w.minted_block <= p_block), 0)
       - COALESCE((SELECT SUM(d.amount * 100000000) FROM icanera_chain.bridge_deposits d
                    WHERE d.chain_id = p_chain_id AND d.block_number <= p_block), 0)
$$;


-- 10. Nobody reaches these over the API. Row Level Security on with no policy, and every grant removed.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'icanera_chain' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE icanera_chain.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON icanera_chain.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA icanera_chain FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA icanera_chain FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
