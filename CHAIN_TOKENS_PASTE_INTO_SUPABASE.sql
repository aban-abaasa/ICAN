-- ============================================================================
-- ON-CHAIN TOKENS (ICEC-S the stable form, ICEC-C the community form, the bridge, the exchange-rate feed)
-- Paste this WHOLE file into the Supabase SQL editor and press Run. Once.
--
-- It is the 4 migrations in the right order:
--   1. 20261020100000_chain_core.sql
--        the isolated schema: linked addresses, withdrawals, burns, the locked ledger, guards
--   2. 20261020110000_chain_bridge.sql
--        the bridge functions for users, the relayer and administrators
--   3. 20261020120000_chain_fx_oracle.sql
--        the informational USD -> local exchange rate (display only)
--   4. 20261021100000_chain_auto_contracts.sql
--        contract addresses and the chain id that fill themselves in from the chain
--
-- Safe to run twice: every part keeps any setting an administrator changed. It only ADDS its own schema and functions;
-- it never edits an existing table's data. Needs the icaneracoin tables that are already deployed (wallets, rates, the dev secret).
-- To undo: supabase/rollback/20261020_rollback_chain.sql   (read the note at the top of it first)
-- Guide:   CHAIN_TOKENS_DEPLOY.md
--
-- After it runs: the bridge is OFF and no contract is configured. Next (see CHAIN_TOKENS_DEPLOY.md):
--   1. deploy the contracts to a TEST network with your own key (blockchain/scripts/deploy.js), then
--   2. tell the database the TWO addresses it cannot work out for itself (paste an address or an explorer link):
--        SELECT public.ican_chain_dev_set_contracts('<dev token>', '{"icec_community_address": "0x...", "stable_vault_address": "0x..."}'::jsonb);
--      The chain id, the ICEC-S token, the reserve coin and its symbol are read from the chain by the relayer.
--   3. set the relayer's environment and schedule /api/chain-sync and /api/fx-oracle,
--   4. turn the bridge on in the dev panel (On-chain tab) only after the launch gates in CHAIN_TOKENS_DEPLOY.md are true.
-- ============================================================================

-- ################################ PART 1 of 4: 20261020100000_chain_core.sql ################################
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

-- ################################ PART 2 of 4: 20261020110000_chain_bridge.sql ################################
-- ============================================================================
-- IcanEra on-chain tokens, part 2 of 3: the bridge functions.
--
--   USERS (signed in)
--     ican_chain_public_config()           where the contracts are and what the limits are (also readable signed out)
--     ican_chain_link_challenge(address)   start proving you control a wallet address
--     ican_chain_unlink_address(address)   stop sending new withdrawals to an address
--     ican_bridge_request_withdrawal(...)  lock ledger ICEC and queue the mint of the same amount of ICEC-C
--     ican_bridge_cancel_withdrawal(id)    take it back, while nothing has been signed for it yet
--     ican_chain_my_overview()             addresses, withdrawals, burns, what is out on-chain
--
--   THE RELAYER (service_role only; it holds the one hot key and reads the chain)
--     ican_chain_operator_*                see section 3
--
--   ADMINISTRATORS (dev token, like the sector tools)
--     ican_chain_dev_*                     overview, settings, contract addresses, reconcile, anomalies
--
-- Every user function takes WHO from the session (auth.uid()), never from an argument; checks everything before its
-- first write; and takes locks in one fixed order everywhere: the per-user advisory lock, then the wallet row, then the
-- bridge rows. Different users never wait on each other.
--
-- Safe to run more than once. Rollback: supabase/rollback/20261020_rollback_chain.sql
-- Requires: 20261020100000_chain_core.sql, ican_user_wallets, ican_dev_secret (20261009100000).
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_chain.chain_settings') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261020100000_chain_core.sql first.';
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 0. Internal helpers (not callable from the API)
-- ----------------------------------------------------------------------------

-- Give a user ledger ICEC, creating their wallet row if they have none. The caller holds the user's lock.
CREATE OR REPLACE FUNCTION icanera_chain.credit_wallet(p_uid UUID, p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE v_bal NUMERIC;
BEGIN
  INSERT INTO public.ican_user_wallets (user_id) VALUES (p_uid) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.ican_user_wallets SET ican_balance = COALESCE(ican_balance, 0) + p_amount WHERE user_id = p_uid
  RETURNING ican_balance INTO v_bal;
  RETURN v_bal;
END; $$;

CREATE OR REPLACE FUNCTION icanera_chain.withdrawal_json(w icanera_chain.bridge_withdrawals)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', w.id, 'ref', w.ref, 'amount', w.amount, 'to_address', w.to_address, 'chain_id', w.chain_id,
    'status', w.status, 'tx_hash', w.tx_hash, 'minted_tx_hash', w.minted_tx_hash, 'created_at', w.created_at,
    'cancellable', (w.status = 'pending' AND w.attempts = 0))
$$;

-- Cancel one withdrawal and give the ledger ICEC back. ONLY while it is pending and nothing was ever signed for it
-- (attempts = 0): once the relayer has signed a transaction, the mint may exist on-chain, so refunding could create ICEC.
-- The caller holds the user's advisory lock and the wallet row. Returns the amount refunded (0 if it was not cancellable).
CREATE OR REPLACE FUNCTION icanera_chain.cancel_pending(p_withdrawal_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE w icanera_chain.bridge_withdrawals;
BEGIN
  SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND OR w.status <> 'pending' OR w.attempts <> 0 THEN RETURN 0; END IF;
  UPDATE icanera_chain.bridge_withdrawals SET status = 'cancelled', cancelled_at = now() WHERE id = w.id;
  INSERT INTO icanera_chain.locked_entries (kind, amount, user_id, withdrawal_id) VALUES ('cancel', -w.amount, w.user_id, w.id);
  PERFORM icanera_chain.credit_wallet(w.user_id, w.amount);
  RETURN w.amount;
END; $$;

-- Credit one recorded burn to the account that owns the burning address, if (and only if) that address was bridged at
-- least this much and has not already been paid back. Idempotent: a credited burn is never credited again.
-- Takes its own locks (user, then wallet, then the burn row), so callers must not hold any bridge row lock.
CREATE OR REPLACE FUNCTION icanera_chain.try_credit(p_deposit_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  d   icanera_chain.bridge_deposits;
  v_uid UUID;
  v_out NUMERIC;
BEGIN
  SELECT * INTO d FROM icanera_chain.bridge_deposits WHERE id = p_deposit_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('credited', false, 'reason', 'unknown_burn'); END IF;
  IF d.status = 'credited' THEN RETURN jsonb_build_object('credited', true, 'duplicate', true, 'user_id', d.user_id); END IF;

  SELECT a.user_id INTO v_uid FROM icanera_chain.user_addresses a WHERE a.chain_id = d.chain_id AND a.address = d.from_address;
  IF v_uid IS NULL THEN
    UPDATE icanera_chain.bridge_deposits SET reason = 'address_not_linked' WHERE id = d.id AND status = 'unclaimed';
    RETURN jsonb_build_object('credited', false, 'reason', 'address_not_linked');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ican_bridge:' || v_uid::TEXT, 0));
  PERFORM 1 FROM public.ican_user_wallets WHERE user_id = v_uid FOR UPDATE;
  SELECT * INTO d FROM icanera_chain.bridge_deposits WHERE id = p_deposit_id FOR UPDATE;
  IF d.status = 'credited' THEN RETURN jsonb_build_object('credited', true, 'duplicate', true, 'user_id', d.user_id); END IF;

  -- what was minted to THIS address and not yet paid back
  v_out := COALESCE((SELECT SUM(w.amount) FROM icanera_chain.bridge_withdrawals w
                      WHERE w.chain_id = d.chain_id AND w.to_address = d.from_address AND w.status = 'minted'), 0)
         - COALESCE((SELECT SUM(x.amount) FROM icanera_chain.bridge_deposits x
                      WHERE x.chain_id = d.chain_id AND x.from_address = d.from_address AND x.status = 'credited'), 0);
  IF d.amount > v_out THEN
    UPDATE icanera_chain.bridge_deposits SET reason = 'exceeds_outstanding', user_id = v_uid WHERE id = d.id;
    RETURN jsonb_build_object('credited', false, 'reason', 'exceeds_outstanding', 'outstanding', v_out);
  END IF;

  UPDATE icanera_chain.bridge_deposits SET status = 'credited', user_id = v_uid, credited_at = now(), reason = NULL WHERE id = d.id;
  INSERT INTO icanera_chain.locked_entries (kind, amount, user_id, deposit_id) VALUES ('credit', -d.amount, v_uid, d.id);
  PERFORM icanera_chain.credit_wallet(v_uid, d.amount);
  RETURN jsonb_build_object('credited', true, 'duplicate', false, 'user_id', v_uid, 'amount', d.amount);
END; $$;

CREATE OR REPLACE FUNCTION icanera_chain.raise_anomaly(p_kind TEXT, p_details JSONB, p_halt BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO icanera_chain.anomalies (kind, details) VALUES (p_kind, COALESCE(p_details, '{}'::JSONB));
  IF p_halt THEN UPDATE icanera_chain.chain_settings SET bridge_enabled = FALSE WHERE id = TRUE; END IF;
END; $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA icanera_chain FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 1. What anyone may read: where the contracts are. Nothing secret, nothing per-user.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_chain_public_config()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_chain, public AS $$
  SELECT jsonb_build_object(
    'installed',                 TRUE,
    'bridge_enabled',            s.bridge_enabled,
    'chain_id',                  s.chain_id,
    'chain_name',                s.chain_name,
    'is_testnet',                s.is_testnet,
    'explorer_url',              s.explorer_url,
    'icec_community_address',    s.icec_community_address,
    'stable_token_address',      s.stable_token_address,
    'stable_vault_address',      s.stable_vault_address,
    'reserve_token_address',     s.reserve_token_address,
    'reserve_token_symbol',      s.reserve_token_symbol,
    'confirmations',             s.confirmations,
    'min_withdrawal_icec',       s.min_withdrawal_icec,
    'max_withdrawal_icec',       s.max_withdrawal_icec,
    'max_daily_withdrawal_icec', s.max_daily_withdrawal_icec,
    'fx_stale_s',                s.fx_stale_s)
  FROM icanera_chain.chain_settings s WHERE s.id = TRUE
$$;
REVOKE ALL ON FUNCTION public.ican_chain_public_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_chain_public_config() TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. Users
-- ----------------------------------------------------------------------------

-- Step 1 of linking a wallet. Returns the exact text the wallet must sign. It moves nothing.
CREATE OR REPLACE FUNCTION public.ican_chain_link_challenge(p_address TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_addr TEXT := icanera_chain.norm_address(p_address);
  s      icanera_chain.chain_settings;
  v_have icanera_chain.user_addresses;
  v_n    INT;
  v_id   UUID := gen_random_uuid();
  v_exp  TIMESTAMPTZ;
  v_msg  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  IF v_addr IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_address', 'error', 'That is not a valid wallet address.');
  END IF;
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE;
  IF s.chain_id IS NULL OR s.icec_community_address IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_configured', 'error', 'On-chain features are not set up yet.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ican_chain_link:' || v_uid::TEXT, 0));
  SELECT * INTO v_have FROM icanera_chain.user_addresses WHERE chain_id = s.chain_id AND address = v_addr;
  IF FOUND THEN
    IF v_have.user_id <> v_uid THEN
      RETURN jsonb_build_object('success', false, 'code', 'address_taken', 'error', 'That address is already linked to another account.');
    END IF;
    IF v_have.revoked_at IS NULL THEN
      RETURN jsonb_build_object('success', true, 'already_linked', true, 'address', v_addr);
    END IF;
  END IF;
  SELECT count(*) INTO v_n FROM icanera_chain.user_addresses WHERE user_id = v_uid AND chain_id = s.chain_id AND revoked_at IS NULL;
  IF v_n >= s.max_addresses_per_user THEN
    RETURN jsonb_build_object('success', false, 'code', 'too_many_addresses',
      'error', format('You can link up to %s addresses. Remove one first.', s.max_addresses_per_user));
  END IF;
  SELECT count(*) INTO v_n FROM icanera_chain.link_challenges WHERE user_id = v_uid AND created_at > now() - INTERVAL '1 hour';
  IF v_n >= 10 THEN
    RETURN jsonb_build_object('success', false, 'code', 'rate_limited', 'error', 'Too many attempts. Please wait a while and try again.');
  END IF;

  v_exp := now() + make_interval(secs => s.challenge_ttl_s);
  v_msg := 'IcanEra wants you to link this wallet to your account.' || E'\n\n'
        || 'Address: ' || v_addr || E'\n'
        || 'Account: ' || v_uid::TEXT || E'\n'
        || 'Chain ID: ' || s.chain_id::TEXT || E'\n'
        || 'Nonce: ' || replace(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', '') || E'\n'
        || 'Expires: ' || to_char(v_exp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || E'\n\n'
        || 'Only sign this if you started linking in the IcanEra app. Signing does not move any funds.';
  INSERT INTO icanera_chain.link_challenges (id, user_id, chain_id, address, message, expires_at)
  VALUES (v_id, v_uid, s.chain_id, v_addr, v_msg, v_exp);
  RETURN jsonb_build_object('success', true, 'challenge_id', v_id, 'message', v_msg, 'address', v_addr, 'expires_at', v_exp);
END; $$;
REVOKE ALL ON FUNCTION public.ican_chain_link_challenge(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_chain_link_challenge(TEXT) TO authenticated;


-- Stop sending NEW withdrawals to an address. Withdrawals still waiting (and never picked up) are refunded.
-- Burns from the address are still credited, to this same account: that can only return value to where it came from.
CREATE OR REPLACE FUNCTION public.ican_chain_unlink_address(p_address TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_addr TEXT := icanera_chain.norm_address(p_address);
  a      icanera_chain.user_addresses;
  w      RECORD;
  v_n    INT := 0;
  v_sum  NUMERIC := 0;
  v_one  NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  IF v_addr IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_address', 'error', 'That is not a valid wallet address.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ican_bridge:' || v_uid::TEXT, 0));
  PERFORM 1 FROM public.ican_user_wallets WHERE user_id = v_uid FOR UPDATE;
  SELECT * INTO a FROM icanera_chain.user_addresses WHERE user_id = v_uid AND address = v_addr AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'address_not_found', 'error', 'That address is not linked to your account.');
  END IF;
  UPDATE icanera_chain.user_addresses SET revoked_at = now() WHERE id = a.id;
  FOR w IN SELECT id FROM icanera_chain.bridge_withdrawals WHERE address_id = a.id AND status = 'pending' AND attempts = 0 ORDER BY created_at LOOP
    v_one := icanera_chain.cancel_pending(w.id);
    IF v_one > 0 THEN v_n := v_n + 1; v_sum := v_sum + v_one; END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'address', v_addr, 'refunded_withdrawals', v_n, 'refunded_icec', v_sum);
END; $$;
REVOKE ALL ON FUNCTION public.ican_chain_unlink_address(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_chain_unlink_address(TEXT) TO authenticated;


-- Withdraw: lock `p_amount` of ledger ICEC and queue the same amount of ICEC-C for one of your linked addresses.
-- Atomic and idempotent: the same p_request_id never withdraws twice.
CREATE OR REPLACE FUNCTION public.ican_bridge_request_withdrawal(
  p_amount     NUMERIC,
  p_address    TEXT,
  p_request_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_addr TEXT := icanera_chain.norm_address(p_address);
  s      icanera_chain.chain_settings;
  a      icanera_chain.user_addresses;
  w      icanera_chain.bridge_withdrawals;
  v_bal  NUMERIC;
  v_n    INT;
  v_day  NUMERIC;
  v_id   UUID := gen_random_uuid();
  v_new  NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  IF p_amount IS NULL OR p_amount = 'NaN'::NUMERIC OR p_amount <= 0 OR p_amount > 1000000000000 OR p_amount <> trunc(p_amount, 8) THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_amount', 'error', 'Enter a valid amount (up to 8 decimal places).');
  END IF;
  IF v_addr IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_address', 'error', 'That is not a valid wallet address.');
  END IF;
  IF p_request_id IS NULL OR char_length(p_request_id) NOT BETWEEN 8 AND 100 OR p_request_id !~ '^[A-Za-z0-9:_.-]+$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_request_id', 'error', 'Missing or invalid request id.');
  END IF;

  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE;
  IF s.chain_id IS NULL OR s.icec_community_address IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_configured', 'error', 'On-chain features are not set up yet.');
  END IF;

  -- one bridge action at a time per user, then their wallet row (the same order as every other money function)
  PERFORM pg_advisory_xact_lock(hashtextextended('ican_bridge:' || v_uid::TEXT, 0));
  SELECT COALESCE(x.ican_balance, 0) INTO v_bal FROM public.ican_user_wallets x WHERE x.user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN v_bal := 0; END IF;

  -- a retry of something that already happened: same answer, nothing moves
  SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE user_id = v_uid AND request_id = p_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'withdrawal', icanera_chain.withdrawal_json(w));
  END IF;

  IF NOT s.bridge_enabled THEN
    RETURN jsonb_build_object('success', false, 'code', 'bridge_paused', 'error', 'Moving ICEC on-chain is paused for a moment. Please try again later.');
  END IF;
  IF p_amount < s.min_withdrawal_icec THEN
    RETURN jsonb_build_object('success', false, 'code', 'below_minimum', 'min_icec', s.min_withdrawal_icec,
      'error', format('The smallest amount is %s ICEC.', s.min_withdrawal_icec));
  END IF;
  IF p_amount > s.max_withdrawal_icec THEN
    RETURN jsonb_build_object('success', false, 'code', 'above_maximum', 'max_icec', s.max_withdrawal_icec,
      'error', format('The most you can move at once is %s ICEC.', s.max_withdrawal_icec));
  END IF;

  SELECT * INTO a FROM icanera_chain.user_addresses
   WHERE user_id = v_uid AND chain_id = s.chain_id AND address = v_addr AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'address_not_linked', 'error', 'Link this wallet address to your account first.');
  END IF;

  SELECT count(*) INTO v_n FROM icanera_chain.bridge_withdrawals WHERE user_id = v_uid AND created_at > now() - INTERVAL '1 hour';   -- cancelled ones count too
  SELECT COALESCE(SUM(amount), 0) INTO v_day FROM icanera_chain.bridge_withdrawals
   WHERE user_id = v_uid AND status <> 'cancelled' AND created_at > now() - INTERVAL '24 hours';
  IF v_n >= s.max_withdrawals_per_hour THEN
    RETURN jsonb_build_object('success', false, 'code', 'rate_limited', 'error', 'Too many withdrawals in an hour. Please wait a while.');
  END IF;
  IF v_day + p_amount > s.max_daily_withdrawal_icec THEN
    RETURN jsonb_build_object('success', false, 'code', 'daily_limit', 'max_icec', s.max_daily_withdrawal_icec,
      'error', 'That would take you over the daily limit for moving ICEC on-chain.');
  END IF;
  IF v_bal < p_amount THEN
    RETURN jsonb_build_object('success', false, 'code', 'insufficient_funds',
      'error', format('Insufficient IcanEra balance. You have %s, need %s', v_bal, p_amount));
  END IF;

  -- the withdrawal: all of it, in this one transaction
  UPDATE public.ican_user_wallets SET ican_balance = ican_balance - p_amount WHERE user_id = v_uid
  RETURNING ican_balance INTO v_new;
  INSERT INTO icanera_chain.bridge_withdrawals (id, ref, user_id, address_id, chain_id, to_address, amount, request_id)
  VALUES (v_id, icanera_chain.withdrawal_ref(v_id), v_uid, a.id, s.chain_id, v_addr, p_amount, p_request_id)
  RETURNING * INTO w;
  INSERT INTO icanera_chain.locked_entries (kind, amount, user_id, withdrawal_id) VALUES ('lock', p_amount, v_uid, v_id);

  RETURN jsonb_build_object('success', true, 'duplicate', false, 'new_ican_balance', v_new,
                            'withdrawal', icanera_chain.withdrawal_json(w));
END; $$;
REVOKE ALL ON FUNCTION public.ican_bridge_request_withdrawal(NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_bridge_request_withdrawal(NUMERIC, TEXT, TEXT) TO authenticated;


-- Take a withdrawal back, as long as the relayer has not signed anything for it.
CREATE OR REPLACE FUNCTION public.ican_bridge_cancel_withdrawal(p_withdrawal_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  v_uid UUID := auth.uid();
  w     icanera_chain.bridge_withdrawals;
  v_amt NUMERIC;
  v_bal NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ican_bridge:' || v_uid::TEXT, 0));
  PERFORM 1 FROM public.ican_user_wallets WHERE user_id = v_uid FOR UPDATE;
  SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE id = p_withdrawal_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found', 'error', 'No such withdrawal.');
  END IF;
  IF w.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'withdrawal', icanera_chain.withdrawal_json(w));
  END IF;
  v_amt := icanera_chain.cancel_pending(w.id);
  IF v_amt = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_cancellable',
      'error', 'This withdrawal is already on its way to the chain and can no longer be cancelled.');
  END IF;
  SELECT ican_balance INTO v_bal FROM public.ican_user_wallets WHERE user_id = v_uid;
  SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE id = p_withdrawal_id;
  RETURN jsonb_build_object('success', true, 'duplicate', false, 'refunded_icec', v_amt, 'new_ican_balance', v_bal,
                            'withdrawal', icanera_chain.withdrawal_json(w));
END; $$;
REVOKE ALL ON FUNCTION public.ican_bridge_cancel_withdrawal(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_bridge_cancel_withdrawal(UUID) TO authenticated;


-- Everything a user sees of their own on-chain position. Only ever their own rows.
CREATE OR REPLACE FUNCTION public.ican_chain_my_overview()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'config', public.ican_chain_public_config(),
    'addresses', COALESCE((SELECT jsonb_agg(jsonb_build_object('address', a.address, 'chain_id', a.chain_id,
                     'linked_at', a.linked_at, 'revoked', a.revoked_at IS NOT NULL) ORDER BY a.linked_at)
                  FROM icanera_chain.user_addresses a WHERE a.user_id = v_uid), '[]'::JSONB),
    'withdrawals', COALESCE((SELECT jsonb_agg(icanera_chain.withdrawal_json(x) ORDER BY x.created_at DESC)
                  FROM (SELECT * FROM icanera_chain.bridge_withdrawals WHERE user_id = v_uid ORDER BY created_at DESC LIMIT 20) x), '[]'::JSONB),
    'burns', COALESCE((SELECT jsonb_agg(jsonb_build_object('tx_hash', d.tx_hash, 'amount', d.amount, 'status', d.status,
                     'reason', d.reason, 'from_address', d.from_address, 'created_at', d.created_at) ORDER BY d.created_at DESC)
                  FROM (SELECT * FROM icanera_chain.bridge_deposits d
                         WHERE d.user_id = v_uid
                            OR d.from_address IN (SELECT a.address FROM icanera_chain.user_addresses a WHERE a.user_id = v_uid)
                         ORDER BY d.created_at DESC LIMIT 20) d), '[]'::JSONB),
    -- minted on-chain for this account and not yet burned back
    'onchain_icec', COALESCE((SELECT SUM(w.amount) FROM icanera_chain.bridge_withdrawals w WHERE w.user_id = v_uid AND w.status = 'minted'), 0)
                  - COALESCE((SELECT SUM(d.amount) FROM icanera_chain.bridge_deposits d WHERE d.user_id = v_uid AND d.status = 'credited'), 0),
    -- locked in the ledger and still on its way to the chain
    'in_flight_icec', COALESCE((SELECT SUM(w.amount) FROM icanera_chain.bridge_withdrawals w WHERE w.user_id = v_uid AND w.status IN ('pending', 'submitted')), 0));
END; $$;
REVOKE ALL ON FUNCTION public.ican_chain_my_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_chain_my_overview() TO authenticated;


-- ----------------------------------------------------------------------------
-- 3. The relayer (service_role only). It holds the single hot key and reads the chain; the database trusts it for
--    exactly these facts, and cross-checks them: what was minted must match a withdrawal it knows, and the on-chain
--    supply must match the ledger.
-- ----------------------------------------------------------------------------

-- A lease, so two overlapping cron runs never sign with the same key at the same time.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_lease(p_name TEXT, p_holder TEXT, p_ttl_s INT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE v_n INT;
BEGIN
  PERFORM icanera_chain.require_operator();
  IF p_name IS NULL OR p_holder IS NULL OR p_ttl_s IS NULL OR p_ttl_s NOT BETWEEN 5 AND 900 THEN
    RAISE EXCEPTION 'bad lease request' USING ERRCODE = '22023';
  END IF;
  INSERT INTO icanera_chain.sync_state (name, lease_holder, lease_until)
  VALUES (p_name, p_holder, now() + make_interval(secs => p_ttl_s))
  ON CONFLICT (name) DO UPDATE
     SET lease_holder = EXCLUDED.lease_holder, lease_until = EXCLUDED.lease_until, updated_at = now()
   WHERE icanera_chain.sync_state.lease_until IS NULL
      OR icanera_chain.sync_state.lease_until < now()
      OR icanera_chain.sync_state.lease_holder = EXCLUDED.lease_holder;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END; $$;

CREATE OR REPLACE FUNCTION public.ican_chain_operator_release(p_name TEXT, p_holder TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
BEGIN
  PERFORM icanera_chain.require_operator();
  UPDATE icanera_chain.sync_state SET lease_until = NULL, updated_at = now() WHERE name = p_name AND lease_holder = p_holder;
END; $$;

-- Where the event scan stopped. It only ever moves forward.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_cursor(p_name TEXT, p_set_block BIGINT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE v_block BIGINT;
BEGIN
  PERFORM icanera_chain.require_operator();
  IF p_set_block IS NOT NULL AND p_set_block >= 0 THEN
    INSERT INTO icanera_chain.sync_state (name, last_block) VALUES (p_name, p_set_block)
    ON CONFLICT (name) DO UPDATE SET last_block = GREATEST(icanera_chain.sync_state.last_block, EXCLUDED.last_block), updated_at = now();
  END IF;
  SELECT last_block INTO v_block FROM icanera_chain.sync_state WHERE name = p_name;
  RETURN COALESCE(v_block, 0);
END; $$;

-- The mints to send. Pending ones, plus ones submitted long ago that never showed up. Nothing while the bridge is halted.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_next_mints(p_limit INT DEFAULT 20, p_stale_s INT DEFAULT 180)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE s icanera_chain.chain_settings;
BEGIN
  PERFORM icanera_chain.require_operator();
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE;
  IF NOT s.bridge_enabled OR s.chain_id IS NULL THEN RETURN '[]'::JSONB; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', w.id, 'ref', w.ref, 'to', w.to_address, 'amount_units', w.amount_units::TEXT,
                                        'status', w.status, 'tx_hash', w.tx_hash, 'attempts', w.attempts) ORDER BY w.created_at)
      FROM (SELECT * FROM icanera_chain.bridge_withdrawals w
             WHERE w.chain_id = s.chain_id
               AND (w.status = 'pending' OR (w.status = 'submitted' AND w.submitted_at < now() - make_interval(secs => GREATEST(p_stale_s, 30))))
             ORDER BY w.created_at LIMIT GREATEST(1, LEAST(p_limit, 100))) w), '[]'::JSONB);
END; $$;

-- The relayer has SIGNED a mint transaction and is about to broadcast it: record its hash first. If the user cancelled in
-- the meantime, or the bridge was halted, this refuses and the relayer must not broadcast.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_mark_submitted(p_id UUID, p_tx_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  w icanera_chain.bridge_withdrawals;
  s icanera_chain.chain_settings;
  v_hash TEXT := lower(p_tx_hash);
BEGIN
  PERFORM icanera_chain.require_operator();
  IF v_hash IS NULL OR v_hash !~ '^0x[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_tx_hash');
  END IF;
  SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
  IF w.status = 'cancelled' THEN RETURN jsonb_build_object('success', false, 'code', 'cancelled'); END IF;
  IF w.status = 'minted'    THEN RETURN jsonb_build_object('success', false, 'code', 'already_minted'); END IF;
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE;
  IF NOT s.bridge_enabled THEN RETURN jsonb_build_object('success', false, 'code', 'halted'); END IF;
  UPDATE icanera_chain.bridge_withdrawals
     SET status = 'submitted', tx_hash = v_hash, submitted_at = now(), attempts = attempts + 1
   WHERE id = w.id;
  RETURN jsonb_build_object('success', true, 'attempts', w.attempts + 1);
END; $$;

-- A mint transaction was MINED and REVERTED (cap reached, contract paused, ...). It cannot have minted, so the withdrawal
-- goes back in the queue. It is never refunded from here: only the user's cancel, and only before the first attempt.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_requeue(p_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE w icanera_chain.bridge_withdrawals;
BEGIN
  PERFORM icanera_chain.require_operator();
  SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
  IF w.status <> 'submitted' THEN RETURN jsonb_build_object('success', false, 'code', 'not_submitted', 'status', w.status); END IF;
  UPDATE icanera_chain.bridge_withdrawals SET status = 'pending', last_error = left(COALESCE(p_reason, 'reverted'), 300) WHERE id = w.id;
  RETURN jsonb_build_object('success', true);
END; $$;

-- A mint event, seen on-chain at confirmation depth. This is what makes a withdrawal final.
-- The event must match a withdrawal the database already knows, to the address and the unit. Anything else is an anomaly
-- (a stolen operator key would look like this) and halts new withdrawals.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_record_mint(
  p_chain_id BIGINT, p_ref TEXT, p_tx_hash TEXT, p_log_index INT, p_block BIGINT, p_to TEXT, p_amount_units TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  s      icanera_chain.chain_settings;
  w      icanera_chain.bridge_withdrawals;
  v_ref  TEXT := lower(p_ref);
  v_tx   TEXT := lower(p_tx_hash);
  v_to   TEXT := icanera_chain.norm_address(p_to);
  v_u    NUMERIC;
  v_det  JSONB;
BEGIN
  PERFORM icanera_chain.require_operator();
  IF v_ref !~ '^0x[0-9a-f]{64}$' OR v_tx !~ '^0x[0-9a-f]{64}$' OR v_to IS NULL OR p_block IS NULL OR p_block < 0
     OR p_log_index IS NULL OR p_log_index < 0 OR p_amount_units !~ '^[0-9]{1,30}$' THEN
    RAISE EXCEPTION 'bad mint event' USING ERRCODE = '22023';
  END IF;
  v_u := p_amount_units::NUMERIC;
  v_det := jsonb_build_object('ref', v_ref, 'tx_hash', v_tx, 'log_index', p_log_index, 'block', p_block, 'to', v_to, 'amount_units', p_amount_units);
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE;
  IF s.chain_id IS DISTINCT FROM p_chain_id THEN
    PERFORM icanera_chain.raise_anomaly('wrong_chain', v_det || jsonb_build_object('chain_id', p_chain_id), TRUE);
    RETURN jsonb_build_object('success', false, 'code', 'wrong_chain');
  END IF;

  SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE ref = v_ref FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM icanera_chain.raise_anomaly('unknown_mint', v_det, TRUE);
    RETURN jsonb_build_object('success', false, 'code', 'unknown_ref');
  END IF;
  IF w.status = 'minted' THEN
    IF w.minted_tx_hash = v_tx AND w.minted_log_index = p_log_index THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;
    PERFORM icanera_chain.raise_anomaly('mint_mismatch', v_det || jsonb_build_object('withdrawal_id', w.id, 'note', 'a second mint for one withdrawal'), TRUE);
    RETURN jsonb_build_object('success', false, 'code', 'second_mint');
  END IF;
  IF w.to_address <> v_to OR w.amount_units <> v_u THEN
    PERFORM icanera_chain.raise_anomaly('mint_mismatch', v_det || jsonb_build_object('withdrawal_id', w.id,
      'expected_to', w.to_address, 'expected_units', w.amount_units::TEXT), TRUE);
    RETURN jsonb_build_object('success', false, 'code', 'mismatch');
  END IF;
  IF w.status = 'cancelled' THEN
    -- the user was refunded AND tokens exist: stop everything and look
    PERFORM icanera_chain.raise_anomaly('mint_after_cancel', v_det || jsonb_build_object('withdrawal_id', w.id), TRUE);
    RETURN jsonb_build_object('success', false, 'code', 'mint_after_cancel');
  END IF;
  UPDATE icanera_chain.bridge_withdrawals
     SET status = 'minted', minted_tx_hash = v_tx, minted_log_index = p_log_index, minted_block = p_block, minted_at = now()
   WHERE id = w.id;
  RETURN jsonb_build_object('success', true, 'duplicate', false, 'withdrawal_id', w.id);
END; $$;

-- A burn event, seen on-chain at confirmation depth. Exactly once per (chain, tx, log index); credited only as described
-- in try_credit, otherwise parked as 'unclaimed' with the reason. Never halts: a burn can only return value to its source.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_record_burn(
  p_chain_id BIGINT, p_tx_hash TEXT, p_log_index INT, p_block BIGINT, p_from TEXT, p_amount_units TEXT, p_credit_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  s     icanera_chain.chain_settings;
  v_tx  TEXT := lower(p_tx_hash);
  v_from TEXT := icanera_chain.norm_address(p_from);
  v_id  UUID;
  v_old icanera_chain.bridge_deposits;
  v_res JSONB;
BEGIN
  PERFORM icanera_chain.require_operator();
  IF v_tx !~ '^0x[0-9a-f]{64}$' OR v_from IS NULL OR p_block IS NULL OR p_block < 0 OR p_log_index IS NULL OR p_log_index < 0
     OR p_amount_units !~ '^[1-9][0-9]{0,26}$' THEN
    RAISE EXCEPTION 'bad burn event' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE;
  IF s.chain_id IS DISTINCT FROM p_chain_id THEN
    PERFORM icanera_chain.raise_anomaly('wrong_chain', jsonb_build_object('tx_hash', v_tx, 'chain_id', p_chain_id), TRUE);
    RETURN jsonb_build_object('success', false, 'code', 'wrong_chain');
  END IF;

  INSERT INTO icanera_chain.bridge_deposits (chain_id, tx_hash, log_index, block_number, from_address, amount, credit_id, status, reason)
  VALUES (p_chain_id, v_tx, p_log_index, p_block, v_from, p_amount_units::NUMERIC / 100000000, left(p_credit_id, 80), 'unclaimed', 'pending')
  ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT * INTO v_old FROM icanera_chain.bridge_deposits WHERE chain_id = p_chain_id AND tx_hash = v_tx AND log_index = p_log_index;
    IF v_old.status = 'unclaimed' THEN
      v_res := icanera_chain.try_credit(v_old.id);       -- a burn parked earlier may be creditable now
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'credited', COALESCE((v_res ->> 'credited')::BOOLEAN, false), 'reason', v_res ->> 'reason');
    END IF;
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'credited', true);
  END IF;

  v_res := icanera_chain.try_credit(v_id);
  RETURN jsonb_build_object('success', true, 'duplicate', false, 'deposit_id', v_id,
                            'credited', COALESCE((v_res ->> 'credited')::BOOLEAN, false), 'reason', v_res ->> 'reason');
END; $$;

-- Parked burns whose address has been linked (or whose mint has now been recorded) since: try them again.
-- One pass at a time: a pass holds several users' locks until it commits, so two passes could take them in opposite orders
-- and deadlock (a stress test found exactly that). A second caller is simply told it was skipped.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_retry_unclaimed(p_limit INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE r RECORD; v_res JSONB; v_ok INT := 0; v_try INT := 0;
BEGIN
  PERFORM icanera_chain.require_operator();
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ican_bridge_retry_pass', 0)) THEN
    RETURN jsonb_build_object('tried', 0, 'credited', 0, 'skipped', TRUE);
  END IF;
  FOR r IN SELECT id FROM icanera_chain.bridge_deposits WHERE status = 'unclaimed' ORDER BY created_at LIMIT GREATEST(1, LEAST(p_limit, 500)) LOOP
    v_try := v_try + 1;
    v_res := icanera_chain.try_credit(r.id);
    IF COALESCE((v_res ->> 'credited')::BOOLEAN, FALSE) THEN v_ok := v_ok + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('tried', v_try, 'credited', v_ok, 'skipped', FALSE);
END; $$;

-- The relayer reads totalSupply() at a block it has fully indexed and the database says what it should be.
-- A mismatch means ICEC-C exists that the ledger did not lock (or the reverse): it halts new withdrawals.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_check_supply(p_chain_id BIGINT, p_block BIGINT, p_supply_units TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  s      icanera_chain.chain_settings;
  v_exp  NUMERIC;
  v_got  NUMERIC;
  v_ok   BOOLEAN;
BEGIN
  PERFORM icanera_chain.require_operator();
  IF p_block IS NULL OR p_block < 0 OR p_supply_units !~ '^[0-9]{1,30}$' THEN
    RAISE EXCEPTION 'bad supply report' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE;
  IF s.chain_id IS DISTINCT FROM p_chain_id THEN
    PERFORM icanera_chain.raise_anomaly('wrong_chain', jsonb_build_object('chain_id', p_chain_id), TRUE);
    RETURN jsonb_build_object('success', false, 'code', 'wrong_chain');
  END IF;
  v_got := p_supply_units::NUMERIC;
  v_exp := icanera_chain.expected_supply_units(p_chain_id, p_block);
  v_ok  := v_got = v_exp;
  INSERT INTO icanera_chain.supply_checks (chain_id, block_number, onchain_supply_units, expected_supply_units, ok)
  VALUES (p_chain_id, p_block, v_got, v_exp, v_ok);
  IF NOT v_ok THEN
    PERFORM icanera_chain.raise_anomaly('supply_mismatch', jsonb_build_object('block', p_block,
      'onchain_units', v_got::TEXT, 'expected_units', v_exp::TEXT), TRUE);
  END IF;
  RETURN jsonb_build_object('success', true, 'ok', v_ok, 'onchain_units', v_got::TEXT, 'expected_units', v_exp::TEXT);
END; $$;

CREATE OR REPLACE FUNCTION public.ican_chain_operator_halt(p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
BEGIN
  PERFORM icanera_chain.require_operator();
  PERFORM icanera_chain.raise_anomaly('operator_halt', jsonb_build_object('reason', left(COALESCE(p_reason, ''), 300)), TRUE);
END; $$;

-- What the relayer needs to check a link signature: whose challenge it is, for which address, and the exact text that was signed.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_get_challenge(p_challenge_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE ch icanera_chain.link_challenges;
BEGIN
  PERFORM icanera_chain.require_operator();
  SELECT * INTO ch FROM icanera_chain.link_challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object('found', true, 'user_id', ch.user_id, 'chain_id', ch.chain_id, 'address', ch.address,
                            'message', ch.message, 'expires_at', ch.expires_at, 'used', ch.used_at IS NOT NULL,
                            'expired', ch.expires_at < now());
END; $$;

-- Step 2 of linking a wallet. The relayer has checked that the signature over the challenge's message was made by the
-- challenge's address; the database records the link and burns the challenge so it cannot be replayed.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_link(p_challenge_id UUID, p_signature TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  ch icanera_chain.link_challenges;
  s  icanera_chain.chain_settings;
  a  icanera_chain.user_addresses;
  v_n INT;
  v_id UUID;
  v_exists BOOLEAN;
BEGIN
  PERFORM icanera_chain.require_operator();
  IF p_signature IS NULL OR p_signature !~ '^0x[0-9a-fA-F]{130}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_signature');
  END IF;
  SELECT * INTO ch FROM icanera_chain.link_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'unknown_challenge'); END IF;
  IF ch.used_at IS NOT NULL THEN RETURN jsonb_build_object('success', false, 'code', 'challenge_used'); END IF;
  IF ch.expires_at < now() THEN RETURN jsonb_build_object('success', false, 'code', 'challenge_expired'); END IF;
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE;
  IF s.chain_id IS DISTINCT FROM ch.chain_id THEN RETURN jsonb_build_object('success', false, 'code', 'wrong_chain'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ican_chain_link:' || ch.user_id::TEXT, 0));
  SELECT * INTO a FROM icanera_chain.user_addresses WHERE chain_id = ch.chain_id AND address = ch.address FOR UPDATE;
  v_exists := FOUND;
  IF v_exists AND a.user_id <> ch.user_id THEN RETURN jsonb_build_object('success', false, 'code', 'address_taken'); END IF;
  IF v_exists AND a.revoked_at IS NULL THEN
    UPDATE icanera_chain.link_challenges SET used_at = now() WHERE id = ch.id;
    RETURN jsonb_build_object('success', true, 'already_linked', true, 'user_id', ch.user_id, 'address', ch.address, 'address_id', a.id);
  END IF;
  SELECT count(*) INTO v_n FROM icanera_chain.user_addresses WHERE user_id = ch.user_id AND chain_id = ch.chain_id AND revoked_at IS NULL;
  IF v_n >= s.max_addresses_per_user THEN RETURN jsonb_build_object('success', false, 'code', 'too_many_addresses'); END IF;

  IF v_exists THEN                                      -- a revoked address of the same account, proven again
    UPDATE icanera_chain.user_addresses SET revoked_at = NULL, challenge_id = ch.id, signature = p_signature, linked_at = now() WHERE id = a.id;
    v_id := a.id;
  ELSE
    INSERT INTO icanera_chain.user_addresses (user_id, chain_id, address, challenge_id, signature)
    VALUES (ch.user_id, ch.chain_id, ch.address, ch.id, p_signature) RETURNING id INTO v_id;
  END IF;
  UPDATE icanera_chain.link_challenges SET used_at = now() WHERE id = ch.id;
  RETURN jsonb_build_object('success', true, 'already_linked', false, 'user_id', ch.user_id, 'address', ch.address, 'address_id', v_id);
END; $$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'ican_chain_operator_lease(TEXT, TEXT, INT)', 'ican_chain_operator_release(TEXT, TEXT)',
    'ican_chain_operator_cursor(TEXT, BIGINT)', 'ican_chain_operator_next_mints(INT, INT)',
    'ican_chain_operator_mark_submitted(UUID, TEXT)', 'ican_chain_operator_requeue(UUID, TEXT)',
    'ican_chain_operator_record_mint(BIGINT, TEXT, TEXT, INT, BIGINT, TEXT, TEXT)',
    'ican_chain_operator_record_burn(BIGINT, TEXT, INT, BIGINT, TEXT, TEXT, TEXT)',
    'ican_chain_operator_retry_unclaimed(INT)', 'ican_chain_operator_check_supply(BIGINT, BIGINT, TEXT)',
    'ican_chain_operator_halt(TEXT)', 'ican_chain_operator_link(UUID, TEXT)', 'ican_chain_operator_get_challenge(UUID)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 4. Administrators (the dev token, exactly like the sector tools)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ican_chain_dev_overview(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN jsonb_build_object(
    'settings',  (SELECT to_jsonb(s) FROM icanera_chain.chain_settings s WHERE s.id),
    'withdrawals', COALESCE((SELECT jsonb_object_agg(status, jsonb_build_object('count', n, 'icec', total))
                     FROM (SELECT status, count(*) AS n, COALESCE(SUM(amount), 0) AS total FROM icanera_chain.bridge_withdrawals GROUP BY status) x), '{}'::JSONB),
    'oldest_pending_s', (SELECT EXTRACT(EPOCH FROM now() - MIN(created_at))::INT FROM icanera_chain.bridge_withdrawals WHERE status IN ('pending', 'submitted')),
    'unclaimed_burns', (SELECT jsonb_build_object('count', count(*), 'icec', COALESCE(SUM(amount), 0)) FROM icanera_chain.bridge_deposits WHERE status = 'unclaimed'),
    'locked_icec', icanera_chain.locked_total(),
    'linked_addresses', (SELECT count(*) FROM icanera_chain.user_addresses WHERE revoked_at IS NULL),
    'open_anomalies', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'details', details, 'created_at', created_at) ORDER BY id DESC)
                        FROM (SELECT * FROM icanera_chain.anomalies WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 20) a), '[]'::JSONB),
    'last_supply_check', (SELECT to_jsonb(c) FROM (SELECT block_number, onchain_supply_units::TEXT AS onchain_units,
                            expected_supply_units::TEXT AS expected_units, ok, created_at
                            FROM icanera_chain.supply_checks ORDER BY id DESC LIMIT 1) c),
    'sync', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'last_block', last_block, 'lease_until', lease_until, 'updated_at', updated_at)) FROM icanera_chain.sync_state), '[]'::JSONB));
END; $$;

-- Change settings. Only the listed keys; the table's own CHECKs reject nonsense. Turning the bridge on needs a configured chain.
CREATE OR REPLACE FUNCTION public.ican_chain_dev_set_settings(dev_token TEXT, p_changes JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  s icanera_chain.chain_settings;
  k TEXT;
  c JSONB := COALESCE(p_changes, '{}'::JSONB);
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  FOR k IN SELECT jsonb_object_keys(c) LOOP
    IF k NOT IN ('bridge_enabled', 'is_testnet', 'confirmations', 'min_withdrawal_icec', 'max_withdrawal_icec', 'max_daily_withdrawal_icec',
                 'max_withdrawals_per_hour', 'max_addresses_per_user', 'challenge_ttl_s', 'fx_max_jump_pct', 'fx_stale_s', 'fx_twap_s',
                 'reserve_token_symbol', 'chain_name', 'explorer_url') THEN
      RAISE EXCEPTION 'unknown setting: %', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE FOR UPDATE;
  IF COALESCE((c ->> 'bridge_enabled')::BOOLEAN, FALSE) AND (s.chain_id IS NULL OR s.icec_community_address IS NULL) THEN
    RAISE EXCEPTION 'save the ICEC-C contract address first, and wait for the relayer''s next run to detect the chain (a minute or two), before turning the bridge on' USING ERRCODE = '22023';
  END IF;
  UPDATE icanera_chain.chain_settings SET
    bridge_enabled            = COALESCE((c ->> 'bridge_enabled')::BOOLEAN, bridge_enabled),
    is_testnet                = COALESCE((c ->> 'is_testnet')::BOOLEAN, is_testnet),
    confirmations             = COALESCE((c ->> 'confirmations')::INT, confirmations),
    min_withdrawal_icec       = COALESCE((c ->> 'min_withdrawal_icec')::NUMERIC, min_withdrawal_icec),
    max_withdrawal_icec       = COALESCE((c ->> 'max_withdrawal_icec')::NUMERIC, max_withdrawal_icec),
    max_daily_withdrawal_icec = COALESCE((c ->> 'max_daily_withdrawal_icec')::NUMERIC, max_daily_withdrawal_icec),
    max_withdrawals_per_hour  = COALESCE((c ->> 'max_withdrawals_per_hour')::INT, max_withdrawals_per_hour),
    max_addresses_per_user    = COALESCE((c ->> 'max_addresses_per_user')::INT, max_addresses_per_user),
    challenge_ttl_s           = COALESCE((c ->> 'challenge_ttl_s')::INT, challenge_ttl_s),
    fx_max_jump_pct           = COALESCE((c ->> 'fx_max_jump_pct')::NUMERIC, fx_max_jump_pct),
    fx_stale_s                = COALESCE((c ->> 'fx_stale_s')::INT, fx_stale_s),
    fx_twap_s                 = COALESCE((c ->> 'fx_twap_s')::INT, fx_twap_s),
    reserve_token_symbol      = COALESCE(c ->> 'reserve_token_symbol', reserve_token_symbol),
    chain_name                = COALESCE(c ->> 'chain_name', chain_name),
    explorer_url              = COALESCE(c ->> 'explorer_url', explorer_url)
  WHERE id = TRUE;
  RETURN jsonb_build_object('success', true, 'settings', (SELECT to_jsonb(x) FROM icanera_chain.chain_settings x WHERE x.id));
END; $$;

-- Say where the contracts are. Refused once withdrawals exist for a different chain or ICEC-C contract: moving the bridge to
-- another contract is a migration, not a setting.
CREATE OR REPLACE FUNCTION public.ican_chain_dev_set_contracts(dev_token TEXT, p_changes JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  s      icanera_chain.chain_settings;
  c      JSONB := COALESCE(p_changes, '{}'::JSONB);
  k      TEXT;
  v_chain BIGINT;
  v_icec  TEXT;
  v_addr  TEXT;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  FOR k IN SELECT jsonb_object_keys(c) LOOP
    IF k NOT IN ('chain_id', 'icec_community_address', 'stable_token_address', 'stable_vault_address', 'reserve_token_address') THEN
      RAISE EXCEPTION 'unknown setting: %', k USING ERRCODE = '22023';
    END IF;
    IF k <> 'chain_id' AND c ->> k IS NOT NULL AND icanera_chain.norm_address(c ->> k) IS NULL THEN
      RAISE EXCEPTION '% is not a valid 0x address', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE FOR UPDATE;
  v_chain := COALESCE((c ->> 'chain_id')::BIGINT, s.chain_id);
  v_icec  := COALESCE(icanera_chain.norm_address(c ->> 'icec_community_address'), s.icec_community_address);
  IF EXISTS (SELECT 1 FROM icanera_chain.bridge_withdrawals)
     AND (v_chain IS DISTINCT FROM s.chain_id OR v_icec IS DISTINCT FROM s.icec_community_address) THEN
    RAISE EXCEPTION 'withdrawals already exist for the current chain and ICEC-C contract; moving the bridge needs a migration, not a setting'
      USING ERRCODE = '22023';
  END IF;
  UPDATE icanera_chain.chain_settings SET
    chain_id               = v_chain,
    icec_community_address = v_icec,
    stable_token_address   = COALESCE(icanera_chain.norm_address(c ->> 'stable_token_address'),  stable_token_address),
    stable_vault_address   = COALESCE(icanera_chain.norm_address(c ->> 'stable_vault_address'),  stable_vault_address),
    reserve_token_address  = COALESCE(icanera_chain.norm_address(c ->> 'reserve_token_address'), reserve_token_address)
  WHERE id = TRUE;
  RETURN jsonb_build_object('success', true, 'config', public.ican_chain_public_config());
END; $$;

-- The books must balance. Everything is recomputed from the immutable ledgers.
CREATE OR REPLACE FUNCTION public.ican_chain_dev_reconcile(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  v_locked   NUMERIC; v_expected NUMERIC;
  v_no_lock  BIGINT;  v_bad_cancel BIGINT; v_bad_credit BIGINT; v_over BIGINT; v_open BIGINT; v_neg BIGINT;
  v_last_ok  BOOLEAN;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  v_locked := icanera_chain.locked_total();
  -- locked = every withdrawal that was not cancelled, less everything credited back
  v_expected := COALESCE((SELECT SUM(amount) FROM icanera_chain.bridge_withdrawals WHERE status <> 'cancelled'), 0)
              - COALESCE((SELECT SUM(amount) FROM icanera_chain.bridge_deposits WHERE status = 'credited'), 0);
  SELECT count(*) INTO v_no_lock FROM icanera_chain.bridge_withdrawals w
   WHERE (SELECT count(*) FROM icanera_chain.locked_entries e WHERE e.withdrawal_id = w.id AND e.kind = 'lock' AND e.amount = w.amount) <> 1;
  SELECT count(*) INTO v_bad_cancel FROM icanera_chain.bridge_withdrawals w
   WHERE (SELECT count(*) FROM icanera_chain.locked_entries e WHERE e.withdrawal_id = w.id AND e.kind = 'cancel' AND e.amount = -w.amount)
         <> CASE WHEN w.status = 'cancelled' THEN 1 ELSE 0 END;
  SELECT count(*) INTO v_bad_credit FROM icanera_chain.bridge_deposits d
   WHERE (SELECT count(*) FROM icanera_chain.locked_entries e WHERE e.deposit_id = d.id AND e.kind = 'credit' AND e.amount = -d.amount)
         <> CASE WHEN d.status = 'credited' THEN 1 ELSE 0 END;
  -- no address was ever paid back more than was minted to it
  SELECT count(*) INTO v_over FROM (
    SELECT d.from_address FROM icanera_chain.bridge_deposits d WHERE d.status = 'credited' GROUP BY d.chain_id, d.from_address
    HAVING SUM(d.amount) > COALESCE((SELECT SUM(w.amount) FROM icanera_chain.bridge_withdrawals w
                                      WHERE w.chain_id = d.chain_id AND w.to_address = d.from_address AND w.status = 'minted'), 0)) x;
  SELECT count(*) INTO v_open FROM icanera_chain.anomalies WHERE resolved_at IS NULL;
  SELECT count(*) INTO v_neg FROM public.ican_user_wallets WHERE ican_balance < 0;
  SELECT ok INTO v_last_ok FROM icanera_chain.supply_checks ORDER BY id DESC LIMIT 1;
  RETURN jsonb_build_object(
    'ok', v_locked = v_expected AND v_no_lock = 0 AND v_bad_cancel = 0 AND v_bad_credit = 0 AND v_over = 0 AND v_open = 0 AND v_neg = 0
          AND COALESCE(v_last_ok, TRUE),
    'locked_icec', v_locked, 'expected_locked_icec', v_expected, 'locked_matches', v_locked = v_expected,
    'withdrawals_without_exactly_one_lock', v_no_lock, 'cancelled_mismatches', v_bad_cancel, 'credit_mismatches', v_bad_credit,
    'addresses_paid_back_more_than_minted', v_over, 'open_anomalies', v_open, 'negative_wallets', v_neg,
    'last_supply_check_ok', v_last_ok);
END; $$;

CREATE OR REPLACE FUNCTION public.ican_chain_dev_resolve_anomaly(dev_token TEXT, p_id BIGINT, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) < 10 THEN RAISE EXCEPTION 'say what you found and did, in the note' USING ERRCODE = '22023'; END IF;
  UPDATE icanera_chain.anomalies SET resolved_at = now(), resolution = left(btrim(p_note), 500) WHERE id = p_id AND resolved_at IS NULL;
  RETURN jsonb_build_object('success', FOUND);
END; $$;

-- A withdrawal stuck in 'submitted' with no mined transaction. ONLY after checking the chain by hand: that the contract's
-- processed(ref) is false AND that no transaction for it can still be mined (its nonce has been used by another transaction).
-- The memo is the proof you did.
CREATE OR REPLACE FUNCTION public.ican_chain_dev_requeue(dev_token TEXT, p_withdrawal_id UUID, p_memo TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE w icanera_chain.bridge_withdrawals;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_memo IS NULL OR char_length(btrim(p_memo)) < 15 THEN RAISE EXCEPTION 'record what you checked on-chain, in the memo' USING ERRCODE = '22023'; END IF;
  SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND OR w.status <> 'submitted' THEN RETURN jsonb_build_object('success', false, 'error', 'only a submitted withdrawal can be requeued'); END IF;
  UPDATE icanera_chain.bridge_withdrawals SET status = 'pending', last_error = left('admin requeue: ' || btrim(p_memo), 300) WHERE id = w.id;
  RETURN jsonb_build_object('success', true);
END; $$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'ican_chain_dev_overview(TEXT)', 'ican_chain_dev_set_settings(TEXT, JSONB)', 'ican_chain_dev_set_contracts(TEXT, JSONB)',
    'ican_chain_dev_reconcile(TEXT)', 'ican_chain_dev_resolve_anomaly(TEXT, BIGINT, TEXT)', 'ican_chain_dev_requeue(TEXT, UUID, TEXT)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ################################ PART 3 of 4: 20261020120000_chain_fx_oracle.sql ################################
-- ============================================================================
-- IcanEra on-chain tokens, part 3 of 3: the informational FX oracle.
--
-- WHAT IT IS FOR, AND WHAT IT IS NOT
--   ICEC-S is worth one US dollar by construction (it is backed 1:1 by a dollar stablecoin in a public vault). To show
--   that in a local currency on screen, the app needs a USD -> local rate. This file keeps that rate: insert-only
--   observations, a 1-minute time-weighted average, a guard against wild jumps, and a staleness flag.
--
--   It is DISPLAY-ONLY. No mint, redeem, deposit, withdrawal or trade reads it, so nobody can move any balance by
--   moving this number. (That is the whole point of not putting an oracle on the money path.) It does not write to
--   ican_currency_rates either.
--
-- HOW A BAD NUMBER IS KEPT OUT
--   * A new observation that jumps more than fx_max_jump_pct (default 5 %) from the last accepted one is stored but NOT
--     used, unless it is confirmed: three observations in a row that disagree with the old rate AND agree with each
--     other (within 1 %) are a genuine move (a devaluation), and the third is accepted.
--   * Observations older than a few minutes, from the future, or not newer than the last accepted one are stored and
--     ignored.
--   * If the newest accepted observation is older than fx_stale_s (default 15 min), readers are told it is stale.
--
-- Safe to run more than once. Rollback: supabase/rollback/20261020_rollback_chain.sql
-- Requires: 20261020100000_chain_core.sql, 20261020110000_chain_bridge.sql
-- ============================================================================

DO $$ BEGIN
  IF to_regprocedure('public.ican_chain_public_config()') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261020110000_chain_bridge.sql (and the file before it) first.';
  END IF;
END $$;


CREATE TABLE IF NOT EXISTS icanera_chain.fx_observations (
  id            BIGSERIAL PRIMARY KEY,
  pair          TEXT        NOT NULL CHECK (pair ~ '^[A-Z]{3}/[A-Z]{3}$'),
  rate          NUMERIC(24,8) NOT NULL CHECK (rate > 0),
  source        TEXT        NOT NULL CHECK (char_length(source) BETWEEN 2 AND 60),
  observed_at   TIMESTAMPTZ NOT NULL,                 -- when the provider says the rate was true
  accepted      BOOLEAN     NOT NULL,
  reject_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (accepted OR reject_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS fx_obs_accepted ON icanera_chain.fx_observations (pair, observed_at DESC) WHERE accepted;
CREATE INDEX IF NOT EXISTS fx_obs_latest   ON icanera_chain.fx_observations (pair, id DESC);

-- Observations are never edited, and never deleted in their first week (the nightly prune keeps 30 days).
CREATE OR REPLACE FUNCTION icanera_chain.guard_fx_observation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR OLD.created_at > now() - INTERVAL '7 days' THEN
    RAISE EXCEPTION 'fx_observations rows are not edited, and are kept for at least a week' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END; $$;
REVOKE ALL ON FUNCTION icanera_chain.guard_fx_observation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_fx_observations_immutable ON icanera_chain.fx_observations;
CREATE TRIGGER trg_fx_observations_immutable BEFORE UPDATE OR DELETE ON icanera_chain.fx_observations
  FOR EACH ROW EXECUTE FUNCTION icanera_chain.guard_fx_observation();

ALTER TABLE icanera_chain.fx_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON icanera_chain.fx_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE icanera_chain.fx_observations_id_seq FROM PUBLIC, anon, authenticated;


-- Time-weighted average over the trailing window. The last accepted observation at or before the window's start carries
-- into it, and the newest observation is held until now.
CREATE OR REPLACE FUNCTION icanera_chain.fx_twap(p_pair TEXT, p_window_s INT)
RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  WITH w AS (SELECT now() - make_interval(secs => p_window_s) AS t0, now() AS t1),
  pts AS (
    (SELECT o.observed_at, o.rate FROM icanera_chain.fx_observations o, w
      WHERE o.pair = p_pair AND o.accepted AND o.observed_at <= w.t0 ORDER BY o.observed_at DESC LIMIT 1)
    UNION ALL
    (SELECT o.observed_at, o.rate FROM icanera_chain.fx_observations o, w
      WHERE o.pair = p_pair AND o.accepted AND o.observed_at > w.t0 AND o.observed_at <= w.t1)
  ),
  seg AS (
    SELECT rate,
           GREATEST(observed_at, (SELECT t0 FROM w)) AS s,
           COALESCE(lead(observed_at) OVER (ORDER BY observed_at), (SELECT t1 FROM w)) AS e
      FROM pts
  ),
  dur AS (SELECT rate, EXTRACT(EPOCH FROM (e - s)) AS secs FROM seg)
  SELECT CASE WHEN SUM(secs) > 0 THEN SUM(rate * secs) / SUM(secs) END FROM dur
$$;
REVOKE ALL ON FUNCTION icanera_chain.fx_twap(TEXT, INT) FROM PUBLIC, anon, authenticated;


-- The relayer's door (service_role only): offer one observation. Returns whether it was accepted and why not.
CREATE OR REPLACE FUNCTION public.ican_chain_operator_fx_observe(p_pair TEXT, p_rate NUMERIC, p_source TEXT, p_observed_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  s       icanera_chain.chain_settings;
  v_pair  TEXT := upper(btrim(p_pair));
  v_last  icanera_chain.fx_observations;
  v_prev  NUMERIC[];
  v_jump  NUMERIC;
  v_why   TEXT;
  v_hi    NUMERIC;
  v_lo    NUMERIC;
BEGIN
  PERFORM icanera_chain.require_operator();
  IF v_pair IS NULL OR v_pair !~ '^[A-Z]{3}/[A-Z]{3}$' OR p_rate IS NULL OR p_rate = 'NaN'::NUMERIC OR p_rate <= 0
     OR p_rate >= 1e15 OR p_source IS NULL OR char_length(p_source) NOT BETWEEN 2 AND 60 OR p_observed_at IS NULL THEN
    RAISE EXCEPTION 'bad observation' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE;
  PERFORM pg_advisory_xact_lock(hashtextextended('ican_fx:' || v_pair, 0));

  SELECT * INTO v_last FROM icanera_chain.fx_observations WHERE pair = v_pair AND accepted ORDER BY observed_at DESC LIMIT 1;

  IF p_observed_at > now() + INTERVAL '30 seconds' THEN
    v_why := 'from_the_future';
  ELSIF p_observed_at < now() - make_interval(secs => GREATEST(s.fx_stale_s, 300)) THEN
    v_why := 'too_old';
  ELSIF v_last.id IS NOT NULL AND p_observed_at <= v_last.observed_at THEN
    v_why := 'not_newer';
  ELSIF v_last.id IS NOT NULL THEN
    v_jump := abs(p_rate - v_last.rate) / v_last.rate * 100;
    IF v_jump > s.fx_max_jump_pct THEN
      -- confirmed only by two earlier jump observations that agree with this one
      SELECT array_agg(rate ORDER BY id DESC) INTO v_prev FROM (
        SELECT rate, id FROM icanera_chain.fx_observations
         WHERE pair = v_pair AND NOT accepted AND reject_reason = 'jump' AND id > (SELECT id FROM icanera_chain.fx_observations WHERE pair = v_pair AND accepted ORDER BY id DESC LIMIT 1)
         ORDER BY id DESC LIMIT 2) q;
      IF v_prev IS NOT NULL AND array_length(v_prev, 1) = 2 THEN
        v_hi := GREATEST(p_rate, v_prev[1], v_prev[2]);
        v_lo := LEAST(p_rate, v_prev[1], v_prev[2]);
        IF (v_hi - v_lo) / v_lo * 100 <= 1 THEN v_why := NULL; ELSE v_why := 'jump'; END IF;
      ELSE
        v_why := 'jump';
      END IF;
    END IF;
  END IF;

  INSERT INTO icanera_chain.fx_observations (pair, rate, source, observed_at, accepted, reject_reason)
  VALUES (v_pair, p_rate, btrim(p_source), p_observed_at, v_why IS NULL, v_why);
  RETURN jsonb_build_object('success', true, 'accepted', v_why IS NULL, 'reason', v_why);
END; $$;
REVOKE ALL ON FUNCTION public.ican_chain_operator_fx_observe(TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ican_chain_operator_fx_observe(TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role;


-- What the app reads. The 1-minute average, the latest spot, and how fresh it is. Display only.
CREATE OR REPLACE FUNCTION public.ican_fx_rate(p_pair TEXT DEFAULT 'USD/UGX')
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  s      icanera_chain.chain_settings;
  v_pair TEXT := upper(btrim(p_pair));
  o      icanera_chain.fx_observations;
  v_twap NUMERIC;
  v_age  NUMERIC;
BEGIN
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE;
  SELECT * INTO o FROM icanera_chain.fx_observations WHERE pair = v_pair AND accepted ORDER BY observed_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', false, 'pair', v_pair);
  END IF;
  v_age  := EXTRACT(EPOCH FROM (now() - o.observed_at));
  v_twap := icanera_chain.fx_twap(v_pair, s.fx_twap_s);
  RETURN jsonb_build_object(
    'available',   true,
    'pair',        v_pair,
    'rate',        COALESCE(v_twap, o.rate),         -- the 1-minute time-weighted average (falls back to the latest)
    'spot',        o.rate,
    'window_s',    s.fx_twap_s,
    'observed_at', o.observed_at,
    'age_s',       round(v_age),
    'stale',       v_age > s.fx_stale_s,
    'source',      o.source);
END; $$;
REVOKE ALL ON FUNCTION public.ican_fx_rate(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_fx_rate(TEXT) TO anon, authenticated;


-- For the dev panel: how healthy the feed is.
CREATE OR REPLACE FUNCTION public.ican_chain_dev_fx_overview(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN jsonb_build_object(
    'pairs', COALESCE((SELECT jsonb_agg(public.ican_fx_rate(p.pair) ORDER BY p.pair)
                         FROM (SELECT DISTINCT pair FROM icanera_chain.fx_observations) p), '[]'::JSONB),
    'last_hour', COALESCE((SELECT jsonb_object_agg(k, n) FROM (
                    SELECT CASE WHEN accepted THEN 'accepted' ELSE reject_reason END AS k, count(*) AS n
                      FROM icanera_chain.fx_observations WHERE created_at > now() - INTERVAL '1 hour' GROUP BY 1) x), '{}'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public.ican_chain_dev_fx_overview(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_chain_dev_fx_overview(TEXT) TO authenticated;


-- Old observations are only needed for the average and for a short audit trail.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('icanera-chain-prune-fx', '41 3 * * *',
      $job$DELETE FROM icanera_chain.fx_observations WHERE created_at < now() - INTERVAL '30 days'$job$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'chain oracle: could not schedule the nightly prune (%): old observations will just stay.', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';

-- ################################ PART 4 of 4: 20261021100000_chain_auto_contracts.sql ################################
-- ============================================================================
-- On-chain tokens, part 4: contract addresses that fill themselves in.
--
-- WHY
--   Setting up the bridge asked an administrator to type FIVE contract addresses, and rejected the whole call
--   ("stable_token_address is not a valid 0x address") when any one was malformed. Two of those five are not facts the
--   administrator knows, they are facts the CHAIN knows:
--       the ICEC-S token   is created by the vault in its constructor            ->  vault.token()
--       the reserve coin   is fixed in the vault when it is deployed             ->  vault.reserve()
--   (and the reserve coin's symbol is the coin's own symbol()). A typed copy can only be wrong or out of date.
--
-- WHAT CHANGES
--   * You give the database the ICEC-C contract and the ICEC-S VAULT. Nothing else: the CHAIN ID is adopted from the network
--     the relayer is connected to (ican_chain_operator_adopt_chain), and typing it is optional. Once set, it can only be
--     changed by hand and never by the relayer, which halts the bridge if it ever finds itself on a different chain.
--   * The relayer reads the vault on-chain on every run and writes the token, the reserve coin and its symbol back here
--     (ican_chain_operator_sync_contracts), so they always match the chain. Change the vault and they change with it,
--     and the old ones are cleared at once rather than left pointing at the previous vault.
--   * The screens read the token and reserve straight from the vault on the chain, so they work even before the relayer
--     has run, and a stale or mistyped copy here can never reach a user.
--   * ican_chain_dev_set_contracts is forgiving: it takes an address pasted with spaces or quotes, without 0x, in capitals,
--     or even inside an explorer link; it ignores the two detected fields instead of failing on them; and when it does
--     refuse something it says which field, and what it expected. A transaction hash (64 digits) is never mistaken for
--     an address. A chain it knows (the common test networks) gets its name and explorer link filled in.
--
-- Safe to run more than once. Needs 20261020100000 .. 20261020120000.
-- ============================================================================

DO $$ BEGIN
  IF to_regprocedure('public.ican_chain_dev_set_contracts(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261020110000_chain_bridge.sql (and the files before it) first.';
  END IF;
END $$;

ALTER TABLE icanera_chain.chain_settings
  ADD COLUMN IF NOT EXISTS contracts_checked_at TIMESTAMPTZ,      -- when the relayer last confirmed the token and reserve against the vault
  ADD COLUMN IF NOT EXISTS contracts_note       TEXT;             -- what it last found or changed, in words


-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- The one wallet-style address inside a piece of text: "0xAbC...", " 0xabc... ", "'0xabc...'", an explorer link to it, or the
-- 40 digits with no 0x. NULL when there is none, or more than one DIFFERENT one (it will not guess), or when the only
-- candidate is part of something longer (a 64-digit transaction hash is not an address).
CREATE OR REPLACE FUNCTION icanera_chain.extract_address(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH prefixed AS (
    SELECT DISTINCT lower(g[1]) AS a
      FROM regexp_matches(COALESCE(p_text, ''), '(?<![0-9a-zA-Z])0[xX]([0-9a-fA-F]{40})(?![0-9a-zA-Z])', 'g') AS g
  ),
  bare AS (
    SELECT lower(m[1]) AS a
      FROM regexp_match(btrim(COALESCE(p_text, ''), E' \t\r\n"''`<>()[]'), '^([0-9a-fA-F]{40})$') AS m
  )
  SELECT CASE
           WHEN (SELECT count(*) FROM prefixed) = 1 THEN '0x' || (SELECT a FROM prefixed)
           WHEN (SELECT count(*) FROM prefixed) = 0 AND (SELECT count(*) FROM bare) = 1 THEN '0x' || (SELECT a FROM bare)
         END
$$;

-- What the common TEST networks are called and where their block explorers are, so an administrator need not type them.
-- (Main networks are deliberately absent: these contracts are unaudited and the deploy script refuses them.)
CREATE OR REPLACE FUNCTION icanera_chain.known_chain(p_id BIGINT)
RETURNS TABLE (name TEXT, explorer TEXT)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT v.name, v.explorer
    FROM (VALUES
      (31337::BIGINT,    'Local test chain',         NULL::TEXT),
      (11155111::BIGINT, 'Sepolia',                  'https://sepolia.etherscan.io'),
      (17000::BIGINT,    'Holesky',                  'https://holesky.etherscan.io'),
      (84532::BIGINT,    'Base Sepolia',             'https://sepolia.basescan.org'),
      (421614::BIGINT,   'Arbitrum Sepolia',         'https://sepolia.arbiscan.io'),
      (11155420::BIGINT, 'OP Sepolia',               'https://sepolia-optimism.etherscan.io'),
      (80002::BIGINT,    'Polygon Amoy',             'https://amoy.polygonscan.com'),
      (97::BIGINT,       'BNB Smart Chain Testnet',  'https://testnet.bscscan.com')
    ) AS v(id, name, explorer)
   WHERE v.id = p_id
$$;

REVOKE ALL ON FUNCTION icanera_chain.extract_address(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION icanera_chain.known_chain(BIGINT) FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- What anyone may read (adds when the token and reserve were last confirmed against the vault)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_chain_public_config()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_chain, public AS $$
  SELECT jsonb_build_object(
    'installed',                 TRUE,
    'bridge_enabled',            s.bridge_enabled,
    'chain_id',                  s.chain_id,
    'chain_name',                s.chain_name,
    'is_testnet',                s.is_testnet,
    'explorer_url',              s.explorer_url,
    'icec_community_address',    s.icec_community_address,
    'stable_token_address',      s.stable_token_address,
    'stable_vault_address',      s.stable_vault_address,
    'reserve_token_address',     s.reserve_token_address,
    'reserve_token_symbol',      s.reserve_token_symbol,
    'contracts_checked_at',      s.contracts_checked_at,
    'confirmations',             s.confirmations,
    'min_withdrawal_icec',       s.min_withdrawal_icec,
    'max_withdrawal_icec',       s.max_withdrawal_icec,
    'max_daily_withdrawal_icec', s.max_daily_withdrawal_icec,
    'fx_stale_s',                s.fx_stale_s)
  FROM icanera_chain.chain_settings s WHERE s.id = TRUE
$$;
REVOKE ALL ON FUNCTION public.ican_chain_public_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_chain_public_config() TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- Say where the contracts are: forgivingly, and only what the chain cannot tell us.
--   chain_id                 optional: adopted from the network the relayer is on if you leave it out (e.g. 11155111)
--   icec_community_address   the ICEC-C contract
--   stable_vault_address     the ICEC-S vault          (the token and the reserve coin are read from it, see above)
-- stable_token_address and reserve_token_address are still ACCEPTED, so an older caller keeps working, but they are ignored:
-- what the chain says wins. Refused once withdrawals exist for a different chain or ICEC-C contract: moving the bridge to
-- another contract is a migration, not a setting.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_chain_dev_set_contracts(dev_token TEXT, p_changes JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  s        icanera_chain.chain_settings;
  c        JSONB := COALESCE(p_changes, '{}'::JSONB);
  k        TEXT;
  raw      TEXT;
  v_chain  BIGINT;
  v_icec   TEXT;
  v_vault  TEXT;
  v_auto   TEXT[] := ARRAY[]::TEXT[];
  v_notes  TEXT[] := ARRAY[]::TEXT[];
  kc       RECORD;
  v_vault_changed BOOLEAN;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'send the settings as an object, e.g. {"chain_id": 11155111, "icec_community_address": "0x..."}' USING ERRCODE = '22023'; END IF;

  FOR k IN SELECT jsonb_object_keys(c) LOOP
    IF k NOT IN ('chain_id', 'icec_community_address', 'stable_vault_address', 'stable_token_address', 'reserve_token_address') THEN
      RAISE EXCEPTION 'unknown setting: % (the settings here are chain_id, icec_community_address and stable_vault_address)', k USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE FOR UPDATE;

  -- chain id: digits only
  v_chain := s.chain_id;
  raw := NULLIF(btrim(c ->> 'chain_id'), '');
  IF raw IS NOT NULL THEN
    IF raw !~ '^[0-9]{1,18}$' OR raw::BIGINT <= 0 THEN
      RAISE EXCEPTION 'chain_id must be a whole number such as 11155111 (got "%")', left(raw, 30) USING ERRCODE = '22023';
    END IF;
    v_chain := raw::BIGINT;
  END IF;

  -- the two addresses an administrator must supply: forgiving about FORM, strict about there being one
  v_icec := s.icec_community_address;
  raw := NULLIF(btrim(c ->> 'icec_community_address'), '');
  IF raw IS NOT NULL THEN
    v_icec := icanera_chain.extract_address(raw);
    IF v_icec IS NULL THEN
      RAISE EXCEPTION 'icec_community_address needs one contract address: 0x followed by 40 letters and digits (you can paste its explorer link). Got "%"', left(raw, 60) USING ERRCODE = '22023';
    END IF;
  END IF;
  v_vault := s.stable_vault_address;
  raw := NULLIF(btrim(c ->> 'stable_vault_address'), '');
  IF raw IS NOT NULL THEN
    v_vault := icanera_chain.extract_address(raw);
    IF v_vault IS NULL THEN
      RAISE EXCEPTION 'stable_vault_address needs one contract address: 0x followed by 40 letters and digits (you can paste its explorer link). Got "%"', left(raw, 60) USING ERRCODE = '22023';
    END IF;
  END IF;

  -- the two the chain already knows: never an error, never used
  FOREACH k IN ARRAY ARRAY['stable_token_address', 'reserve_token_address'] LOOP
    IF NULLIF(btrim(c ->> k), '') IS NOT NULL THEN v_auto := v_auto || k; END IF;
  END LOOP;
  IF array_length(v_auto, 1) > 0 THEN
    v_notes := array_append(v_notes, array_to_string(v_auto, ' and ') || ' are read from the vault on the chain, so what you sent was ignored.');
  END IF;

  IF EXISTS (SELECT 1 FROM icanera_chain.bridge_withdrawals)
     AND (v_chain IS DISTINCT FROM s.chain_id OR v_icec IS DISTINCT FROM s.icec_community_address) THEN
    RAISE EXCEPTION 'withdrawals already exist for the current chain and ICEC-C contract; moving the bridge needs a migration, not a setting'
      USING ERRCODE = '22023';
  END IF;

  v_vault_changed := v_vault IS DISTINCT FROM s.stable_vault_address;
  UPDATE icanera_chain.chain_settings SET
    chain_id               = v_chain,
    icec_community_address = v_icec,
    stable_vault_address   = v_vault,
    -- a new vault has its own token and reserve: drop the old ones now, the relayer fills the new ones in
    stable_token_address   = CASE WHEN v_vault_changed THEN NULL ELSE stable_token_address END,
    reserve_token_address  = CASE WHEN v_vault_changed THEN NULL ELSE reserve_token_address END,
    contracts_checked_at   = CASE WHEN v_vault_changed THEN NULL ELSE contracts_checked_at END,
    contracts_note         = CASE WHEN v_vault_changed AND v_vault IS NOT NULL THEN 'new vault: waiting for the relayer to read its token and reserve from the chain' ELSE contracts_note END
  WHERE id = TRUE;
  IF v_vault_changed AND v_vault IS NOT NULL THEN v_notes := array_append(v_notes, 'The ICEC-S token and reserve coin will be read from the vault on the relayer''s next run.'); END IF;

  -- a chain we know gets its name and explorer filled in (only where nothing is set yet)
  SELECT * INTO kc FROM icanera_chain.known_chain(v_chain);
  IF FOUND THEN
    UPDATE icanera_chain.chain_settings SET
      chain_name   = COALESCE(chain_name, kc.name),
      explorer_url = COALESCE(explorer_url, kc.explorer)
    WHERE id = TRUE AND (chain_name IS NULL OR (explorer_url IS NULL AND kc.explorer IS NOT NULL));
    IF s.chain_name IS NULL THEN v_notes := array_append(v_notes, format('Network recognised: %s.', kc.name)); END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'config', public.ican_chain_public_config(), 'auto_detected', to_jsonb(v_auto), 'notes', to_jsonb(v_notes));
END; $$;
REVOKE ALL ON FUNCTION public.ican_chain_dev_set_contracts(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_chain_dev_set_contracts(TEXT, JSONB) TO authenticated;


-- ----------------------------------------------------------------------------
-- The relayer writes down what the chain says about the vault (service role only).
-- Applies only while the vault in the database is still the vault the relayer read, so a change of vault in between is never
-- overwritten with the previous vault's facts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_chain_operator_sync_contracts(p_vault TEXT, p_stable_token TEXT, p_reserve_token TEXT, p_reserve_symbol TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  s       icanera_chain.chain_settings;
  v_vault TEXT := icanera_chain.norm_address(p_vault);
  v_tok   TEXT := icanera_chain.norm_address(p_stable_token);
  v_res   TEXT := icanera_chain.norm_address(p_reserve_token);
  v_sym   TEXT := btrim(p_reserve_symbol);
  v_changed BOOLEAN;
BEGIN
  PERFORM icanera_chain.require_operator();
  IF v_vault IS NULL OR v_tok IS NULL OR v_res IS NULL OR v_sym IS NULL OR v_sym !~ '^[A-Za-z0-9._+-]{2,12}$' THEN
    RAISE EXCEPTION 'bad contract detection' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE FOR UPDATE;
  IF s.stable_vault_address IS DISTINCT FROM v_vault THEN
    RETURN jsonb_build_object('success', false, 'code', 'vault_changed');
  END IF;
  v_changed := s.stable_token_address IS DISTINCT FROM v_tok OR s.reserve_token_address IS DISTINCT FROM v_res OR s.reserve_token_symbol IS DISTINCT FROM v_sym;
  UPDATE icanera_chain.chain_settings SET
    stable_token_address  = v_tok,
    reserve_token_address = v_res,
    reserve_token_symbol  = v_sym,
    contracts_checked_at  = now(),
    contracts_note        = CASE WHEN v_changed THEN format('read from the vault on the chain: token %s, reserve %s (%s)', v_tok, v_res, v_sym) ELSE contracts_note END
  WHERE id = TRUE;
  RETURN jsonb_build_object('success', true, 'changed', v_changed);
END; $$;
REVOKE ALL ON FUNCTION public.ican_chain_operator_sync_contracts(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ican_chain_operator_sync_contracts(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- The relayer reports which chain it is connected to; the database adopts it ONLY while no chain is set yet.
-- Once a chain is set it is never changed from here: a different answer is a mismatch (the relayer halts the bridge).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_chain_operator_adopt_chain(p_chain_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  s  icanera_chain.chain_settings;
  kc RECORD;
BEGIN
  PERFORM icanera_chain.require_operator();
  IF p_chain_id IS NULL OR p_chain_id <= 0 THEN RAISE EXCEPTION 'bad chain id' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE FOR UPDATE;
  IF s.chain_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', s.chain_id = p_chain_id, 'adopted', false, 'chain_id', s.chain_id,
                              'code', CASE WHEN s.chain_id = p_chain_id THEN NULL ELSE 'chain_mismatch' END);
  END IF;
  SELECT * INTO kc FROM icanera_chain.known_chain(p_chain_id);
  UPDATE icanera_chain.chain_settings SET
    chain_id       = p_chain_id,
    chain_name     = COALESCE(chain_name, kc.name),
    explorer_url   = COALESCE(explorer_url, kc.explorer),
    contracts_note = COALESCE(contracts_note, 'chain id read from the network the relayer is connected to')
  WHERE id = TRUE;
  RETURN jsonb_build_object('success', true, 'adopted', true, 'chain_id', p_chain_id);
END; $$;
REVOKE ALL ON FUNCTION public.ican_chain_operator_adopt_chain(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ican_chain_operator_adopt_chain(BIGINT) TO service_role;

NOTIFY pgrst, 'reload schema';
