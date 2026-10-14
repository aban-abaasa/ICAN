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
