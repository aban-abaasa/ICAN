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
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id;
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
  SELECT * INTO s FROM icanera_chain.chain_settings WHERE id;
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
