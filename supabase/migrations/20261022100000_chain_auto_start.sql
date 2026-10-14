-- ============================================================================
-- On-chain tokens, part 5: "Turn ON" no longer has to be timed by hand.
--
-- WHY
--   Pressing Turn ON before the relayer had detected the chain was refused with
--     "save the ICEC-C contract address first, and wait for the relayer's next run to detect the chain (a minute or two),
--      before turning the bridge on"
--   which made an administrator do the sequencing: save the address, wait, come back, press again.
--
-- WHAT CHANGES
--   * Turn ON always works. When the bridge is not ready yet (no chain detected, or no ICEC-C contract saved) the press is
--     recorded as a REQUEST (bridge_start_requested) and the answer says so: nothing is refused, nothing is lost.
--   * The relayer, on the first run where everything is true, starts the bridge by itself:
--         the chain is detected and matches the endpoint, the contract at the ICEC-C address really is ICEC-C,
--         its signing key is the contract's operator, and no anomaly is open.
--     It does this through ican_chain_operator_auto_start(), granted to the service role alone.
--   * The administrator's click is still the consent (the panel's launch-gate confirmation comes first). Nothing here turns
--     the bridge on by itself without that click.
--   * A halt (any anomaly, from the relayer or the database) cancels a waiting request, so a bridge that halted itself never
--     starts again behind anyone's back. Turn OFF cancels it too.
--
-- Safe to run more than once. Needs 20261020100000 .. 20261021100000.
-- ============================================================================

DO $$ BEGIN
  IF to_regprocedure('public.ican_chain_operator_adopt_chain(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261021100000_chain_auto_contracts.sql (and the files before it) first.';
  END IF;
END $$;

ALTER TABLE icanera_chain.chain_settings
  ADD COLUMN IF NOT EXISTS bridge_start_requested    BOOLEAN NOT NULL DEFAULT FALSE,   -- an administrator pressed Turn ON; the relayer starts the bridge as soon as it is ready
  ADD COLUMN IF NOT EXISTS bridge_start_requested_at TIMESTAMPTZ;


-- A halt cancels a waiting request: a bridge that stopped itself must not start again until a person asks.
CREATE OR REPLACE FUNCTION icanera_chain.raise_anomaly(p_kind TEXT, p_details JSONB, p_halt BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO icanera_chain.anomalies (kind, details) VALUES (p_kind, COALESCE(p_details, '{}'::JSONB));
  IF p_halt THEN
    UPDATE icanera_chain.chain_settings
       SET bridge_enabled = FALSE, bridge_start_requested = FALSE, bridge_start_requested_at = NULL
     WHERE id = TRUE;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION icanera_chain.raise_anomaly(TEXT, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- Administrators: same function as before, except that Turn ON is queued instead of refused when the bridge is not ready.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_chain_dev_set_settings(dev_token TEXT, p_changes JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE
  s        icanera_chain.chain_settings;
  k        TEXT;
  c        JSONB := COALESCE(p_changes, '{}'::JSONB);
  v_want   BOOLEAN := (c ->> 'bridge_enabled')::BOOLEAN;      -- NULL when the call does not touch the switch
  v_ready  BOOLEAN;
  v_queued BOOLEAN := FALSE;
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

  v_ready := s.chain_id IS NOT NULL AND s.icec_community_address IS NOT NULL;
  IF v_want IS TRUE AND NOT v_ready THEN
    -- Not an error: remember the request, and the relayer starts the bridge when the chain has been detected.
    v_queued := TRUE;
    UPDATE icanera_chain.chain_settings
       SET bridge_start_requested = TRUE, bridge_start_requested_at = COALESCE(bridge_start_requested_at, now())
     WHERE id = TRUE;
  ELSIF v_want IS FALSE THEN
    UPDATE icanera_chain.chain_settings SET bridge_start_requested = FALSE, bridge_start_requested_at = NULL WHERE id = TRUE;
  ELSIF v_want IS TRUE THEN
    UPDATE icanera_chain.chain_settings SET bridge_start_requested = FALSE, bridge_start_requested_at = NULL WHERE id = TRUE;
  END IF;

  UPDATE icanera_chain.chain_settings SET
    bridge_enabled            = CASE WHEN v_queued THEN bridge_enabled ELSE COALESCE(v_want, bridge_enabled) END,
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
  RETURN jsonb_build_object('success', true, 'queued', v_queued,
                            'settings', (SELECT to_jsonb(x) FROM icanera_chain.chain_settings x WHERE x.id));
END; $$;
-- (CREATE OR REPLACE keeps the grants from 20261020110000: authenticated only, guarded by the dev token.)


-- ----------------------------------------------------------------------------
-- The relayer: start the bridge for an administrator who asked, once everything the relayer can verify is true.
-- The relayer calls this only after it has checked the chain, the contract and its own operator role; this function checks
-- what only the database knows (a request is waiting, a chain and contract are saved, no anomaly is open).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_chain_operator_auto_start()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_chain, public AS $$
DECLARE s icanera_chain.chain_settings;
BEGIN
  PERFORM icanera_chain.require_operator();
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id = TRUE FOR UPDATE;
  IF s.bridge_enabled THEN
    -- already on: a leftover request has nothing to wait for
    IF s.bridge_start_requested THEN UPDATE icanera_chain.chain_settings SET bridge_start_requested = FALSE, bridge_start_requested_at = NULL WHERE id = TRUE; END IF;
    RETURN jsonb_build_object('started', false, 'reason', 'already_on');
  END IF;
  IF NOT s.bridge_start_requested THEN RETURN jsonb_build_object('started', false, 'reason', 'not_requested'); END IF;
  IF s.chain_id IS NULL OR s.icec_community_address IS NULL THEN RETURN jsonb_build_object('started', false, 'reason', 'not_configured'); END IF;
  IF EXISTS (SELECT 1 FROM icanera_chain.anomalies WHERE resolved_at IS NULL) THEN RETURN jsonb_build_object('started', false, 'reason', 'open_anomaly'); END IF;
  UPDATE icanera_chain.chain_settings
     SET bridge_enabled = TRUE, bridge_start_requested = FALSE, bridge_start_requested_at = NULL,
         contracts_note = 'bridge started automatically after the relayer verified the chain and the ICEC-C contract'
   WHERE id = TRUE;
  RETURN jsonb_build_object('started', true);
END; $$;
REVOKE ALL ON FUNCTION public.ican_chain_operator_auto_start() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ican_chain_operator_auto_start() TO service_role;

NOTIFY pgrst, 'reload schema';
