-- ============================================================================
-- ICEC-S, the stable form of icaneracoin, INSIDE IcanEra: no blockchain, no gas, no wallet to connect.
--
-- WHAT ONE ICEC-S IS WORTH (the same live data icaneracoin already uses)
--   1 ICEC-S = 1 US dollar, priced from public.ican_currency_rates, the table the hourly currency feed keeps current
--   (ican_feed_request('fx'/'gsheet') -> ican_fx_apply()). Like the coin, it has an INFLATION FLOOR:
--
--       unit value (UGX) = GREATEST( live USD rate ,  start value x (1 + Uganda inflation) ^ years since the anchor )
--
--   The start value and anchor are the table's own (initial_rate_to_ugx, stability_anchor_at), and the inflation is the
--   World Bank figure it already stores. So an ICEC-S never buys less than it did at the anchor, and rises with the
--   dollar when the shilling weakens. Nobody can promise more than that, and the screen says so.
--   Every other currency's price is the UGX value divided by that currency's live rate, so there is no arbitrage
--   between wallets.
--
-- HOW YOU GET AND SPEND IT
--   BUY  : pay from any wallet you hold (UGX, USD, KES, ...). The fee comes off, the rest becomes ICEC-S units.
--   SELL : give units back, get the value (less the fee) into any wallet you hold.
--   The platform is the counterparty through a VAULT: an insert-only ledger in UGX that an administrator funds. A buy is
--   refused unless the vault would still cover every ICEC-S in circulation after the stress margin (default +25 %), so
--   the dollar promise is backed, not hoped for. Sells are paid from the vault; there are no IOUs.
--   Refused, with nothing changed, whenever the rates are older than rates_max_age_s: the feed has to be live to trade.
--
-- Nothing here is written to ican_coin_transactions (the coin's price engine counts those rows as usage).
-- Ships with trading OFF; an administrator funds the vault and turns it on (dev panel -> ICEC-S).
-- Safe to run more than once. Requires ican_currency_rates, wallet_accounts, ican_dev_secret().
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('public.ican_currency_rates') IS NULL OR to_regclass('public.wallet_accounts') IS NULL THEN
    RAISE EXCEPTION 'ican_currency_rates and wallet_accounts must exist first.';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS icanera_stable;
REVOKE ALL ON SCHEMA icanera_stable FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA icanera_stable REVOKE ALL ON TABLES    FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA icanera_stable REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- 1. Settings (one row). Trading starts OFF.
CREATE TABLE IF NOT EXISTS icanera_stable.settings (
  id                    BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  trading_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  fee_bps               INT     NOT NULL DEFAULT 50   CHECK (fee_bps BETWEEN 0 AND 1000),
  stress_pct            NUMERIC NOT NULL DEFAULT 25   CHECK (stress_pct >= 0 AND stress_pct <= 500),
  max_trade_ugx         NUMERIC NOT NULL DEFAULT 5000000   CHECK (max_trade_ugx > 0),
  max_position_ugx      NUMERIC NOT NULL DEFAULT 20000000  CHECK (max_position_ugx > 0),
  max_trades_per_minute INT     NOT NULL DEFAULT 20   CHECK (max_trades_per_minute > 0),
  rates_max_age_s       INT     NOT NULL DEFAULT 10800 CHECK (rates_max_age_s >= 300),   -- feed runs hourly; 3 h of slack
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO icanera_stable.settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- 2. What people hold, every swap (never edited), the vault ledger (insert-only), retry records, hourly value history.
CREATE TABLE IF NOT EXISTS icanera_stable.holdings (
  user_id    UUID PRIMARY KEY,
  units      NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (units >= 0),
  cost_ugx   NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (cost_ugx >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS icanera_stable.fills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  units         NUMERIC(24,8) NOT NULL CHECK (units > 0),
  unit_ugx      NUMERIC(24,8) NOT NULL CHECK (unit_ugx > 0),
  gross_ugx     NUMERIC(24,8) NOT NULL,
  fee_ugx       NUMERIC(24,8) NOT NULL,
  net_ugx       NUMERIC(24,8) NOT NULL,
  cost_basis_ugx NUMERIC(24,8) NOT NULL,
  pay_currency  TEXT NOT NULL,
  pay_amount    NUMERIC(24,8) NOT NULL,
  fx_rate_to_ugx NUMERIC(24,8) NOT NULL,
  fx_updated_at TIMESTAMPTZ,
  request_id    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS stable_fills_user ON icanera_stable.fills (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS icanera_stable.vault_entries (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('funding', 'adjustment', 'collateral', 'payout', 'fee')),
  amount_ugx NUMERIC(24,8) NOT NULL,
  user_id    UUID,
  fill_id    UUID,
  memo       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stable_vault_fill ON icanera_stable.vault_entries (fill_id);
CREATE TABLE IF NOT EXISTS icanera_stable.requests (
  user_id    UUID NOT NULL,
  request_id TEXT NOT NULL,
  side       TEXT NOT NULL,
  result     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
CREATE TABLE IF NOT EXISTS icanera_stable.price_history (
  taken_at   TIMESTAMPTZ PRIMARY KEY,
  unit_ugx   NUMERIC(24,8) NOT NULL,
  fx_ugx     NUMERIC(24,8) NOT NULL,
  floor_ugx  NUMERIC(24,8) NOT NULL
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings','holdings','fills','vault_entries','requests','price_history'] LOOP
    EXECUTE format('ALTER TABLE icanera_stable.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON icanera_stable.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- fills and the vault ledger are never edited or deleted
CREATE OR REPLACE FUNCTION icanera_stable.forbid_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% rows are never edited or deleted', TG_TABLE_NAME USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_stable_fills_immutable ON icanera_stable.fills;
CREATE TRIGGER trg_stable_fills_immutable BEFORE UPDATE OR DELETE ON icanera_stable.fills FOR EACH ROW EXECUTE FUNCTION icanera_stable.forbid_change();
DROP TRIGGER IF EXISTS trg_stable_vault_immutable ON icanera_stable.vault_entries;
CREATE TRIGGER trg_stable_vault_immutable BEFORE UPDATE OR DELETE ON icanera_stable.vault_entries FOR EACH ROW EXECUTE FUNCTION icanera_stable.forbid_change();


-- 3. The value of one ICEC-S in UGX: the live dollar rate, never below the inflation-adjusted start value.
--    Returns a row; NULL columns when the table has no usable USD row.
CREATE OR REPLACE FUNCTION icanera_stable.unit_value()
RETURNS TABLE (unit_ugx NUMERIC, fx_ugx NUMERIC, floor_ugx NUMERIC, protected BOOLEAN, inflation_pct NUMERIC,
               anchor_at TIMESTAMPTZ, rates_updated_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE
  u  RECORD;
  g  RECORD;
  v_years NUMERIC;
  v_fx NUMERIC; v_floor NUMERIC;
BEGIN
  SELECT r.rate_to_ugx, r.initial_rate_to_ugx, r.updated_at INTO u FROM public.ican_currency_rates r WHERE r.currency_code = 'USD';
  SELECT r.local_inflation_pct, r.stability_anchor_at INTO g FROM public.ican_currency_rates r WHERE r.currency_code = 'UGX';
  IF u.rate_to_ugx IS NULL OR u.rate_to_ugx <= 0 THEN RETURN; END IF;
  v_fx := u.rate_to_ugx;
  v_years := GREATEST(EXTRACT(EPOCH FROM (now() - COALESCE(g.stability_anchor_at, now()))) / (365.25 * 86400), 0);
  v_floor := COALESCE(u.initial_rate_to_ugx, u.rate_to_ugx)
             * POWER((1 + COALESCE(g.local_inflation_pct, 0) / 100.0)::FLOAT8, v_years::FLOAT8)::NUMERIC;
  unit_ugx := ROUND(GREATEST(v_fx, v_floor), 6);
  fx_ugx := ROUND(v_fx, 6);
  floor_ugx := ROUND(v_floor, 6);
  protected := v_floor > v_fx;
  inflation_pct := COALESCE(g.local_inflation_pct, 0);
  anchor_at := g.stability_anchor_at;
  rates_updated_at := u.updated_at;
  RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION icanera_stable.unit_value() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION icanera_stable.vault_balance() RETURNS NUMERIC
LANGUAGE sql STABLE AS $$ SELECT COALESCE(SUM(amount_ugx), 0) FROM icanera_stable.vault_entries $$;
CREATE OR REPLACE FUNCTION icanera_stable.units_outstanding() RETURNS NUMERIC
LANGUAGE sql STABLE AS $$ SELECT COALESCE(SUM(units), 0) FROM icanera_stable.holdings $$;
REVOKE ALL ON FUNCTION icanera_stable.vault_balance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION icanera_stable.units_outstanding() FROM PUBLIC, anon, authenticated;

-- One point of history per call, at most one an hour (the hourly job below, or a viewer if it is missing).
CREATE OR REPLACE FUNCTION icanera_stable.snapshot_price() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE v RECORD;
BEGIN
  SELECT * INTO v FROM icanera_stable.unit_value();
  IF v.unit_ugx IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM icanera_stable.price_history h WHERE h.taken_at > now() - INTERVAL '55 minutes') THEN RETURN; END IF;
  INSERT INTO icanera_stable.price_history (taken_at, unit_ugx, fx_ugx, floor_ugx)
  VALUES (date_trunc('hour', now()), v.unit_ugx, v.fx_ugx, v.floor_ugx) ON CONFLICT (taken_at) DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END; $$;
REVOKE ALL ON FUNCTION icanera_stable.snapshot_price() FROM PUBLIC, anon, authenticated;


-- 4. What anyone may see: the value of one ICEC-S, how it is made, and how healthy the backing is (aggregate only).
--    `currencies`: the unit's price in each wallet currency, from the live rates.
CREATE OR REPLACE FUNCTION public.ican_stable_quote()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE
  v  RECORD;
  s  icanera_stable.settings;
  v_vault NUMERIC; v_out NUMERIC; v_stale BOOLEAN;
BEGIN
  PERFORM icanera_stable.snapshot_price();
  SELECT * INTO v FROM icanera_stable.unit_value();
  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  IF v.unit_ugx IS NULL THEN
    RETURN jsonb_build_object('available', false);
  END IF;
  v_stale := v.rates_updated_at < now() - make_interval(secs => s.rates_max_age_s);
  v_vault := icanera_stable.vault_balance();
  v_out := icanera_stable.units_outstanding();
  RETURN jsonb_build_object(
    'available', true,
    'unit_ugx', v.unit_ugx, 'fx_ugx', v.fx_ugx, 'floor_ugx', v.floor_ugx, 'protected', v.protected,
    'inflation_pct', v.inflation_pct, 'anchor_at', v.anchor_at,
    'rates_updated_at', v.rates_updated_at, 'rates_stale', v_stale,
    'trading_enabled', s.trading_enabled AND NOT v_stale, 'fee_bps', s.fee_bps,
    'max_trade_ugx', s.max_trade_ugx,
    -- is there room to buy? (the same test a buy has to pass, for a tiny buy)
    'has_capacity', v_vault >= (v_out * v.unit_ugx) * (1 + s.stress_pct / 100),
    'cover_pct', CASE WHEN v_out > 0 THEN round(v_vault / (v_out * v.unit_ugx) * 100, 1) END,
    'currencies', COALESCE((
      SELECT jsonb_object_agg(r.currency_code, round(v.unit_ugx / r.rate_to_ugx, 6))
        FROM public.ican_currency_rates r WHERE r.rate_to_ugx > 0 AND r.currency_code ~ '^[A-Z]{3}$'), '{}'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_quote() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_stable_quote() TO anon, authenticated;

-- The hourly value of one ICEC-S in UGX (newest first), for the chart.
CREATE OR REPLACE FUNCTION public.ican_stable_history(p_limit INT DEFAULT 500)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
BEGIN
  PERFORM icanera_stable.snapshot_price();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('t', h.taken_at, 'v', h.unit_ugx, 'fx', h.fx_ugx, 'floor', h.floor_ugx) ORDER BY h.taken_at DESC)
      FROM (SELECT * FROM icanera_stable.price_history ORDER BY taken_at DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 2000))) h), '[]'::JSONB);
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_history(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_stable_history(INT) TO anon, authenticated;


-- 5. The swap. ONE atomic, idempotent, server-priced step, built like ican_sector_trade: who you are comes from the session,
--    the price and the exchange rate are the server's, the user's rows are locked in a fixed order, every check happens
--    before the first write, and a retry with the same request id moves nothing.
CREATE OR REPLACE FUNCTION public.ican_stable_swap(
  p_side                TEXT,
  p_amount              NUMERIC,      -- buy: money to spend in p_pay_currency.  sell: ICEC-S units to sell
  p_pay_currency        TEXT    DEFAULT 'UGX',
  p_request_id          TEXT    DEFAULT NULL,
  p_expected_price_ugx  NUMERIC DEFAULT NULL,
  p_max_slippage_pct    NUMERIC DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public SET jit = off AS $$
DECLARE
  v_uid   UUID    := auth.uid();
  v_side  TEXT    := lower(btrim(COALESCE(p_side, '')));
  v_cur   TEXT    := upper(btrim(COALESCE(p_pay_currency, 'UGX')));
  v_slip  NUMERIC := COALESCE(p_max_slippage_pct, 1);
  s       icanera_stable.settings;
  v       RECORD;
  h       icanera_stable.holdings;
  v_prior JSONB; v_recent INT;
  v_rate  NUMERIC; v_rate_at TIMESTAMPTZ;
  v_cash  NUMERIC;
  v_price NUMERIC;
  v_local NUMERIC; v_gross NUMERIC; v_fee NUMERIC; v_net NUMERIC; v_units NUMERIC; v_cost NUMERIC;
  v_new_units NUMERIC; v_new_cash NUMERIC;
  v_vault NUMERIC; v_out NUMERIC;
  v_fill UUID; v_result JSONB; v_bad BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  IF v_side NOT IN ('buy', 'sell') THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_side', 'error', 'Choose buy or sell.');
  END IF;
  IF p_amount IS NULL OR p_amount = 'NaN'::NUMERIC OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_amount', 'error', 'Enter a valid amount.');
  END IF;
  IF v_cur !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'Unsupported currency.');
  END IF;
  IF p_request_id IS NULL OR char_length(p_request_id) NOT BETWEEN 8 AND 100 OR p_request_id !~ '^[A-Za-z0-9:_.-]+$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_request_id', 'error', 'Missing or invalid request id.');
  END IF;
  IF v_slip < 0 OR v_slip > 50 OR v_slip = 'NaN'::NUMERIC THEN v_slip := 1; END IF;

  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  IF NOT s.trading_enabled THEN
    RETURN jsonb_build_object('success', false, 'code', 'trading_paused', 'error', 'ICEC-S is not open for swaps yet.');
  END IF;

  -- one swap at a time per user, then their rows in a fixed order (money wallet, then holdings)
  PERFORM pg_advisory_xact_lock(hashtextextended('ican_stable:' || v_uid::TEXT, 0));
  SELECT a.balance INTO v_cash FROM public.wallet_accounts a
   WHERE a.user_id = v_uid AND a.currency = v_cur AND a.status = 'active' FOR UPDATE;
  SELECT * INTO h FROM icanera_stable.holdings WHERE user_id = v_uid FOR UPDATE;

  SELECT r.result INTO v_prior FROM icanera_stable.requests r WHERE r.user_id = v_uid AND r.request_id = p_request_id;
  IF FOUND THEN RETURN v_prior || jsonb_build_object('duplicate', true); END IF;

  SELECT count(*) INTO v_recent FROM icanera_stable.requests r WHERE r.user_id = v_uid AND r.created_at > now() - INTERVAL '1 minute';
  IF v_recent >= s.max_trades_per_minute THEN
    RETURN jsonb_build_object('success', false, 'code', 'rate_limited', 'error', 'Too many swaps in a minute. Please wait a moment.');
  END IF;

  -- the live price and rate, and they must be fresh: a stale feed trades nothing
  SELECT * INTO v FROM icanera_stable.unit_value();
  IF v.unit_ugx IS NULL OR v.rates_updated_at < now() - make_interval(secs => s.rates_max_age_s) THEN
    RETURN jsonb_build_object('success', false, 'code', 'rates_stale',
      'error', 'The live exchange rates are updating. Please try again in a few minutes.');
  END IF;
  v_price := v.unit_ugx;
  IF v_cur = 'UGX' THEN v_rate := 1; v_rate_at := v.rates_updated_at;
  ELSE SELECT r.rate_to_ugx, r.updated_at INTO v_rate, v_rate_at FROM public.ican_currency_rates r WHERE r.currency_code = v_cur; END IF;
  IF v_rate IS NULL OR v_rate <= 0 OR v_rate_at < now() - make_interval(secs => s.rates_max_age_s) THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'That currency is not available right now.');
  END IF;
  IF v_cash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'no_cash_wallet', 'error', 'You do not have a wallet in ' || v_cur || '.');
  END IF;

  IF p_expected_price_ugx IS NOT NULL AND p_expected_price_ugx > 0 THEN
    v_bad := CASE v_side WHEN 'buy' THEN v_price > p_expected_price_ugx * (1 + v_slip / 100)
                         ELSE v_price < p_expected_price_ugx * (1 - v_slip / 100) END;
    IF v_bad THEN
      RETURN jsonb_build_object('success', false, 'code', 'price_moved', 'unit_ugx', v_price,
        'error', 'The price moved while you were swapping. Review the new price and try again.');
    END IF;
  END IF;

  -- amounts (rounded down, in the house's favour, exactly as previewed)
  IF v_side = 'buy' THEN
    v_local := trunc(p_amount, 2);
    v_gross := trunc(v_local * v_rate, 8);
    v_fee   := trunc(v_gross * s.fee_bps / 10000, 8);
    v_net   := v_gross - v_fee;
    v_units := trunc(v_net / v_price, 8);
    v_cost  := v_gross;
    IF v_local <= 0 OR v_units <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small.');
    END IF;
    IF v_gross > s.max_trade_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_ugx', s.max_trade_ugx,
        'error', 'That is above the limit for a single swap.');
    END IF;
    IF COALESCE(h.cost_ugx, 0) + v_gross > s.max_position_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'position_too_large', 'max_ugx', s.max_position_ugx,
        'error', 'That would take you above the holding limit.');
    END IF;
    IF v_cash < v_local THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_funds',
        'error', format('Insufficient balance. You have %s %s, need %s', v_cash, v_cur, v_local));
    END IF;
    -- would the vault still cover every ICEC-S in circulation, with the stress margin?
    v_vault := icanera_stable.vault_balance();
    v_out   := icanera_stable.units_outstanding();
    IF v_vault + v_gross < (v_out + v_units) * v_price * (1 + s.stress_pct / 100) THEN
      RETURN jsonb_build_object('success', false, 'code', 'capacity_reached',
        'error', 'ICEC-S is at capacity right now. Please try again later or with a smaller amount.');
    END IF;
  ELSE
    v_units := trunc(p_amount, 8);
    IF h.units IS NULL OR h.units < v_units THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_units',
        'error', format('You hold %s ICEC-S, need %s', COALESCE(h.units, 0), v_units));
    END IF;
    v_gross := trunc(v_units * v_price, 8);
    v_fee   := trunc(v_gross * s.fee_bps / 10000, 8);
    v_net   := v_gross - v_fee;
    v_local := trunc(v_net / v_rate, 2);
    IF v_units <= 0 OR v_local <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small.');
    END IF;
    IF v_gross > s.max_trade_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_ugx', s.max_trade_ugx,
        'error', 'That is above the limit for a single swap. Sell in smaller parts.');
    END IF;
    IF icanera_stable.vault_balance() < v_net THEN
      RETURN jsonb_build_object('success', false, 'code', 'vault_insufficient',
        'error', 'ICEC-S cannot pay this out right now. Nothing was sold; please try again later.');
    END IF;
    v_cost := CASE WHEN v_units = h.units THEN h.cost_ugx ELSE trunc(h.cost_ugx * v_units / h.units, 8) END;
  END IF;

  -- the swap: all of it, in this one transaction
  IF v_side = 'buy' THEN
    UPDATE public.wallet_accounts SET balance = balance - v_local, updated_at = now()
     WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    INSERT INTO icanera_stable.holdings (user_id, units, cost_ugx) VALUES (v_uid, v_units, v_cost)
    ON CONFLICT (user_id) DO UPDATE SET units = icanera_stable.holdings.units + EXCLUDED.units,
      cost_ugx = icanera_stable.holdings.cost_ugx + EXCLUDED.cost_ugx, updated_at = now()
    RETURNING units INTO v_new_units;
  ELSE
    UPDATE public.wallet_accounts SET balance = balance + v_local, updated_at = now()
     WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    UPDATE icanera_stable.holdings SET units = units - v_units, cost_ugx = cost_ugx - v_cost, updated_at = now()
     WHERE user_id = v_uid RETURNING units INTO v_new_units;
  END IF;

  INSERT INTO icanera_stable.fills (user_id, side, units, unit_ugx, gross_ugx, fee_ugx, net_ugx, cost_basis_ugx,
                                    pay_currency, pay_amount, fx_rate_to_ugx, fx_updated_at, request_id)
  VALUES (v_uid, v_side, v_units, v_price, v_gross, v_fee, v_net, v_cost, v_cur, v_local, v_rate, v_rate_at, p_request_id)
  RETURNING id INTO v_fill;

  IF v_side = 'buy' THEN
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, user_id, fill_id, memo) VALUES ('collateral', v_net, v_uid, v_fill, 'buy');
  ELSE
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, user_id, fill_id, memo) VALUES ('payout', -v_gross, v_uid, v_fill, 'sell');
  END IF;
  IF v_fee > 0 THEN
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, user_id, fill_id, memo) VALUES ('fee', v_fee, v_uid, v_fill, v_side);
  END IF;

  v_result := jsonb_build_object(
    'success', true, 'side', v_side, 'units', v_units, 'unit_ugx', v_price,
    'gross_ugx', v_gross, 'fee_ugx', v_fee, 'net_ugx', v_net,
    'pay_currency', v_cur, 'pay_amount', v_local, 'new_units', v_new_units, 'new_local_balance', v_new_cash,
    'fill_id', v_fill, 'request_id', p_request_id, 'duplicate', false);
  INSERT INTO icanera_stable.requests (user_id, request_id, side, result) VALUES (v_uid, p_request_id, v_side, v_result);
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_swap(TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_swap(TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;


-- 6. A user's own position and swaps. Only ever their own rows.
CREATE OR REPLACE FUNCTION public.ican_stable_my_position()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE h icanera_stable.holdings; v RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_signed_in'); END IF;
  SELECT * INTO h FROM icanera_stable.holdings WHERE user_id = auth.uid();
  SELECT * INTO v FROM icanera_stable.unit_value();
  RETURN jsonb_build_object('success', true, 'units', COALESCE(h.units, 0), 'cost_ugx', COALESCE(h.cost_ugx, 0),
    'value_ugx', CASE WHEN v.unit_ugx IS NULL THEN NULL ELSE trunc(COALESCE(h.units, 0) * v.unit_ugx, 2) END);
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_my_position() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_my_position() TO authenticated;

CREATE OR REPLACE FUNCTION public.ican_stable_my_fills(p_limit INT DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_stable, public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::JSONB; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', f.id, 'side', f.side, 'units', f.units, 'unit_ugx', f.unit_ugx, 'pay_currency', f.pay_currency,
                                         'pay_amount', f.pay_amount, 'fee_ugx', f.fee_ugx, 'created_at', f.created_at) ORDER BY f.created_at DESC)
      FROM (SELECT * FROM icanera_stable.fills WHERE user_id = auth.uid() ORDER BY created_at DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))) f), '[]'::JSONB);
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_my_fills(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_my_fills(INT) TO authenticated;


-- 7. Operators (the developer panel's dev token, like Sector Markets).
CREATE OR REPLACE FUNCTION public.ican_stable_dev_overview(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE s icanera_stable.settings; v RECORD; v_vault NUMERIC; v_out NUMERIC;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  SELECT * INTO v FROM icanera_stable.unit_value();
  v_vault := icanera_stable.vault_balance();
  v_out := icanera_stable.units_outstanding();
  RETURN jsonb_build_object(
    'settings', to_jsonb(s),
    'value', to_jsonb(v),
    'vault', jsonb_build_object('balance_ugx', v_vault, 'units_outstanding', v_out,
      'owed_ugx', CASE WHEN v.unit_ugx IS NULL THEN NULL ELSE round(v_out * v.unit_ugx, 2) END,
      'cover_ratio', CASE WHEN v_out > 0 AND v.unit_ugx IS NOT NULL THEN round(v_vault / (v_out * v.unit_ugx), 4) END,
      'required_ratio', 1 + s.stress_pct / 100),
    'activity_24h', jsonb_build_object(
      'swaps', (SELECT count(*) FROM icanera_stable.fills WHERE created_at > now() - INTERVAL '24 hours'),
      'volume_ugx', COALESCE((SELECT sum(gross_ugx) FROM icanera_stable.fills WHERE created_at > now() - INTERVAL '24 hours'), 0),
      'fees_ugx', COALESCE((SELECT sum(fee_ugx) FROM icanera_stable.fills WHERE created_at > now() - INTERVAL '24 hours'), 0)),
    'holders', (SELECT count(*) FROM icanera_stable.holdings WHERE units > 0));
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_dev_overview(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_dev_overview(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ican_stable_dev_set_settings(dev_token TEXT, p_changes JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE
  v_allowed CONSTANT TEXT[] := ARRAY['trading_enabled','fee_bps','stress_pct','max_trade_ugx','max_position_ugx','max_trades_per_minute','rates_max_age_s'];
  v_bad TEXT; s icanera_stable.settings;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN RAISE EXCEPTION 'p_changes must be an object' USING ERRCODE = '22023'; END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k WHERE k <> ALL (v_allowed) LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'unknown setting: %', v_bad USING ERRCODE = '22023'; END IF;
  UPDATE icanera_stable.settings SET
    trading_enabled       = COALESCE((p_changes ->> 'trading_enabled')::BOOLEAN, trading_enabled),
    fee_bps               = COALESCE((p_changes ->> 'fee_bps')::INT, fee_bps),
    stress_pct            = COALESCE((p_changes ->> 'stress_pct')::NUMERIC, stress_pct),
    max_trade_ugx         = COALESCE((p_changes ->> 'max_trade_ugx')::NUMERIC, max_trade_ugx),
    max_position_ugx      = COALESCE((p_changes ->> 'max_position_ugx')::NUMERIC, max_position_ugx),
    max_trades_per_minute = COALESCE((p_changes ->> 'max_trades_per_minute')::INT, max_trades_per_minute),
    rates_max_age_s       = COALESCE((p_changes ->> 'rates_max_age_s')::INT, rates_max_age_s),
    updated_at = now()
  WHERE id RETURNING * INTO s;
  RETURN to_jsonb(s);
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_dev_set_settings(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_dev_set_settings(TEXT, JSONB) TO authenticated;

-- Fund (positive) or take out (negative) UGX. Taking out is refused if it would leave the vault short of what users hold
-- plus the stress margin.
CREATE OR REPLACE FUNCTION public.ican_stable_dev_vault_adjust(dev_token TEXT, p_amount NUMERIC, p_memo TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE s icanera_stable.settings; v RECORD; v_vault NUMERIC; v_owed NUMERIC;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_amount IS NULL OR p_amount = 0 OR p_amount = 'NaN'::NUMERIC OR abs(p_amount) > 1000000000000 THEN
    RAISE EXCEPTION 'amount must be a non-zero number' USING ERRCODE = '22023';
  END IF;
  IF p_memo IS NULL OR char_length(btrim(p_memo)) < 3 THEN RAISE EXCEPTION 'say why in the memo' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('icanera_stable_vault_adjust', 0));
  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  SELECT * INTO v FROM icanera_stable.unit_value();
  v_vault := icanera_stable.vault_balance();
  v_owed := icanera_stable.units_outstanding() * COALESCE(v.unit_ugx, 0);
  IF p_amount < 0 AND v_vault + p_amount < v_owed * (1 + s.stress_pct / 100) THEN
    RAISE EXCEPTION 'that would leave the vault (%) below what ICEC-S holders are owed (%) plus the % %% margin', v_vault + p_amount, v_owed, s.stress_pct
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, memo) VALUES (CASE WHEN p_amount > 0 THEN 'funding' ELSE 'adjustment' END, p_amount, left(btrim(p_memo), 300));
  RETURN jsonb_build_object('success', true, 'balance_ugx', icanera_stable.vault_balance());
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_dev_vault_adjust(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_dev_vault_adjust(TEXT, NUMERIC, TEXT) TO authenticated;

-- The books must balance: recomputed from the immutable ledgers.
CREATE OR REPLACE FUNCTION public.ican_stable_dev_reconcile(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE v_bought NUMERIC; v_sold NUMERIC; v_held NUMERIC; v_neg BIGINT; v_bad BIGINT;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(SUM(units) FILTER (WHERE side = 'buy'), 0), COALESCE(SUM(units) FILTER (WHERE side = 'sell'), 0) INTO v_bought, v_sold FROM icanera_stable.fills;
  v_held := icanera_stable.units_outstanding();
  SELECT count(*) INTO v_neg FROM icanera_stable.holdings WHERE units < 0 OR cost_ugx < 0;
  SELECT count(*) INTO v_bad FROM icanera_stable.fills f
   WHERE (SELECT COALESCE(SUM(e.amount_ugx), 0) FROM icanera_stable.vault_entries e WHERE e.fill_id = f.id)
         <> CASE f.side WHEN 'buy' THEN f.net_ugx + f.fee_ugx ELSE -f.net_ugx END;
  RETURN jsonb_build_object('ok', v_bought - v_sold = v_held AND v_neg = 0 AND v_bad = 0,
    'units_bought', v_bought, 'units_sold', v_sold, 'units_held', v_held, 'units_match', v_bought - v_sold = v_held,
    'negative_holdings', v_neg, 'fills_without_matching_vault_entries', v_bad, 'vault_balance_ugx', icanera_stable.vault_balance());
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_dev_reconcile(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_dev_reconcile(TEXT) TO authenticated;


-- 8. History: one point an hour, right after the hourly rates are applied (minute 3). Skipped quietly without pg_cron:
--    the screen's own calls then take the point.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('icec-stable-snapshot', '6 * * * *', 'SELECT icanera_stable.snapshot_price()');
    PERFORM cron.schedule('icec-stable-prune-requests', '33 3 * * *',
      $job$DELETE FROM icanera_stable.requests WHERE created_at < now() - INTERVAL '30 days'$job$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'icec-stable: could not schedule the hourly history (%): the screen will record it instead.', SQLERRM;
END $$;

SELECT icanera_stable.snapshot_price();
NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- ICEC-S, automatic and user to user: nobody has to fund a vault or press a switch.
--
-- Swaps are ON from the start. What buyers pay in becomes the POOL (the vault ledger, unchanged), and what sellers take out
-- comes from it. Everything is priced so the pool can always pay what it owes, with no operator in the loop:
--
--     price of one ICEC-S = the smaller of  (a) one dollar's worth (live rate, inflation floor)   and
--                                           (b) the pool's share per ICEC-S  (pool / ICEC-S in circulation)
--
--   * While the pool holds at least a dollar per ICEC-S (the normal case: every buy is collateralised at the dollar value,
--     and fees stay in the pool), the price is the dollar value.
--   * If the shilling falls so sharply that the pool holds less than a dollar per ICEC-S, everyone holds the same smaller
--     share until the rate recovers: buyers then get more ICEC-S per shilling, sellers get the pool's share. Nobody can be
--     paid out ahead of anybody else, and no purchase can dilute a holder.
--   So an ICEC-S is a dollar as long as the pool covers it, and it says so on the screen when it does not. This is the cost
--   of having no reserve behind it; an administrator can still top the pool up (it only ever helps holders).
--
-- Replaces the capacity check and the operator switch of 20261024100000 (run that file first). Safe to run more than once.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_stable.settings') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261024100000_icec_stable_in_system.sql first.';
  END IF;
END $$;

-- On by default, with no stress margin to fund. A deliberate choice already made on a live pool (any swap done) is left alone.
ALTER TABLE icanera_stable.settings ALTER COLUMN trading_enabled SET DEFAULT TRUE;
ALTER TABLE icanera_stable.settings ALTER COLUMN stress_pct SET DEFAULT 0;
UPDATE icanera_stable.settings SET trading_enabled = TRUE, stress_pct = 0, updated_at = now()
 WHERE id AND NOT EXISTS (SELECT 1 FROM icanera_stable.fills);

-- The price a swap uses (and the pool's own numbers). (Dropped first: a later file widens its columns.)
DROP FUNCTION IF EXISTS icanera_stable.pool_value();
CREATE OR REPLACE FUNCTION icanera_stable.pool_value()
RETURNS TABLE (price_ugx NUMERIC, dollar_ugx NUMERIC, nav_ugx NUMERIC, pool_short BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE v RECORD; v_out NUMERIC; v_nav NUMERIC;
BEGIN
  SELECT * INTO v FROM icanera_stable.unit_value();
  IF v.unit_ugx IS NULL THEN RETURN; END IF;
  v_out := icanera_stable.units_outstanding();
  IF v_out > 0 THEN v_nav := icanera_stable.vault_balance() / v_out; END IF;
  dollar_ugx := v.unit_ugx;
  nav_ugx := trunc(v_nav, 6);
  -- rounded DOWN, so units x price can never exceed what the pool holds
  price_ugx := trunc(CASE WHEN v_nav IS NULL THEN v.unit_ugx ELSE LEAST(v.unit_ugx, v_nav) END, 6);
  pool_short := v_nav IS NOT NULL AND v_nav < v.unit_ugx;
  RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION icanera_stable.pool_value() FROM PUBLIC, anon, authenticated;

-- History records the price a swap would have used.
CREATE OR REPLACE FUNCTION icanera_stable.snapshot_price() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE v RECORD; p RECORD;
BEGIN
  SELECT * INTO v FROM icanera_stable.unit_value();
  IF v.unit_ugx IS NULL THEN RETURN; END IF;
  SELECT * INTO p FROM icanera_stable.pool_value();
  IF EXISTS (SELECT 1 FROM icanera_stable.price_history h WHERE h.taken_at > now() - INTERVAL '55 minutes') THEN RETURN; END IF;
  INSERT INTO icanera_stable.price_history (taken_at, unit_ugx, fx_ugx, floor_ugx)
  VALUES (date_trunc('hour', now()), p.price_ugx, v.fx_ugx, v.floor_ugx) ON CONFLICT (taken_at) DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END; $$;
REVOKE ALL ON FUNCTION icanera_stable.snapshot_price() FROM PUBLIC, anon, authenticated;

-- What anyone may see. `unit_ugx` is the price a swap uses right now; `dollar_ugx` is a full dollar's worth.
CREATE OR REPLACE FUNCTION public.ican_stable_quote()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE
  v RECORD; p RECORD;
  s icanera_stable.settings;
  v_out NUMERIC; v_stale BOOLEAN;
BEGIN
  PERFORM icanera_stable.snapshot_price();
  SELECT * INTO v FROM icanera_stable.unit_value();
  SELECT * INTO p FROM icanera_stable.pool_value();
  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  IF v.unit_ugx IS NULL THEN RETURN jsonb_build_object('available', false); END IF;
  v_stale := v.rates_updated_at < now() - make_interval(secs => s.rates_max_age_s);
  v_out := icanera_stable.units_outstanding();
  RETURN jsonb_build_object(
    'available', true,
    'unit_ugx', p.price_ugx, 'dollar_ugx', p.dollar_ugx, 'fx_ugx', v.fx_ugx, 'floor_ugx', v.floor_ugx, 'protected', v.protected,
    'pool_short', p.pool_short, 'pool_per_unit_ugx', p.nav_ugx,
    'cover_pct', CASE WHEN v_out > 0 THEN round(icanera_stable.vault_balance() / (v_out * p.dollar_ugx) * 100, 1) END,
    'inflation_pct', v.inflation_pct, 'anchor_at', v.anchor_at,
    'rates_updated_at', v.rates_updated_at, 'rates_stale', v_stale,
    'trading_enabled', s.trading_enabled AND NOT v_stale, 'fee_bps', s.fee_bps,
    'max_trade_ugx', s.max_trade_ugx, 'has_capacity', true,
    'currencies', COALESCE((
      SELECT jsonb_object_agg(r.currency_code, round(p.price_ugx / r.rate_to_ugx, 6))
        FROM public.ican_currency_rates r WHERE r.rate_to_ugx > 0 AND r.currency_code ~ '^[A-Z]{3}$'), '{}'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_quote() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_stable_quote() TO anon, authenticated;

-- The swap, now at the pool-aware price and with nothing to fund first.
CREATE OR REPLACE FUNCTION public.ican_stable_swap(
  p_side                TEXT,
  p_amount              NUMERIC,      -- buy: money to spend in p_pay_currency.  sell: ICEC-S units to sell
  p_pay_currency        TEXT    DEFAULT 'UGX',
  p_request_id          TEXT    DEFAULT NULL,
  p_expected_price_ugx  NUMERIC DEFAULT NULL,
  p_max_slippage_pct    NUMERIC DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public SET jit = off AS $$
DECLARE
  v_uid   UUID    := auth.uid();
  v_side  TEXT    := lower(btrim(COALESCE(p_side, '')));
  v_cur   TEXT    := upper(btrim(COALESCE(p_pay_currency, 'UGX')));
  v_slip  NUMERIC := COALESCE(p_max_slippage_pct, 1);
  s       icanera_stable.settings;
  v       RECORD;
  pv      RECORD;
  h       icanera_stable.holdings;
  v_prior JSONB; v_recent INT;
  v_rate  NUMERIC; v_rate_at TIMESTAMPTZ;
  v_cash  NUMERIC;
  v_price NUMERIC;
  v_local NUMERIC; v_gross NUMERIC; v_fee NUMERIC; v_net NUMERIC; v_units NUMERIC; v_cost NUMERIC;
  v_new_units NUMERIC; v_new_cash NUMERIC;
  v_vault NUMERIC; v_out NUMERIC;
  v_fill UUID; v_result JSONB; v_bad BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  IF v_side NOT IN ('buy', 'sell') THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_side', 'error', 'Choose buy or sell.');
  END IF;
  IF p_amount IS NULL OR p_amount = 'NaN'::NUMERIC OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_amount', 'error', 'Enter a valid amount.');
  END IF;
  IF v_cur !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'Unsupported currency.');
  END IF;
  IF p_request_id IS NULL OR char_length(p_request_id) NOT BETWEEN 8 AND 100 OR p_request_id !~ '^[A-Za-z0-9:_.-]+$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_request_id', 'error', 'Missing or invalid request id.');
  END IF;
  IF v_slip < 0 OR v_slip > 50 OR v_slip = 'NaN'::NUMERIC THEN v_slip := 1; END IF;

  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  IF NOT s.trading_enabled THEN
    RETURN jsonb_build_object('success', false, 'code', 'trading_paused', 'error', 'ICEC-S is not open for swaps yet.');
  END IF;

  -- one swap at a time per user, then their rows in a fixed order (money wallet, then holdings)
  PERFORM pg_advisory_xact_lock(hashtextextended('ican_stable:' || v_uid::TEXT, 0));
  SELECT a.balance INTO v_cash FROM public.wallet_accounts a
   WHERE a.user_id = v_uid AND a.currency = v_cur AND a.status = 'active' FOR UPDATE;
  SELECT * INTO h FROM icanera_stable.holdings WHERE user_id = v_uid FOR UPDATE;

  SELECT r.result INTO v_prior FROM icanera_stable.requests r WHERE r.user_id = v_uid AND r.request_id = p_request_id;
  IF FOUND THEN RETURN v_prior || jsonb_build_object('duplicate', true); END IF;

  SELECT count(*) INTO v_recent FROM icanera_stable.requests r WHERE r.user_id = v_uid AND r.created_at > now() - INTERVAL '1 minute';
  IF v_recent >= s.max_trades_per_minute THEN
    RETURN jsonb_build_object('success', false, 'code', 'rate_limited', 'error', 'Too many swaps in a minute. Please wait a moment.');
  END IF;

  -- the live price and rate, and they must be fresh: a stale feed trades nothing
  SELECT * INTO v FROM icanera_stable.unit_value();
  IF v.unit_ugx IS NULL OR v.rates_updated_at < now() - make_interval(secs => s.rates_max_age_s) THEN
    RETURN jsonb_build_object('success', false, 'code', 'rates_stale',
      'error', 'The live exchange rates are updating. Please try again in a few minutes.');
  END IF;
  -- the price a swap uses: one dollar's worth, or the pool's share per ICEC-S if the pool holds less than that
  SELECT * INTO pv FROM icanera_stable.pool_value();
  v_price := pv.price_ugx;
  IF v_cur = 'UGX' THEN v_rate := 1; v_rate_at := v.rates_updated_at;
  ELSE SELECT r.rate_to_ugx, r.updated_at INTO v_rate, v_rate_at FROM public.ican_currency_rates r WHERE r.currency_code = v_cur; END IF;
  IF v_rate IS NULL OR v_rate <= 0 OR v_rate_at < now() - make_interval(secs => s.rates_max_age_s) THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'That currency is not available right now.');
  END IF;
  IF v_cash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'no_cash_wallet', 'error', 'You do not have a wallet in ' || v_cur || '.');
  END IF;

  IF p_expected_price_ugx IS NOT NULL AND p_expected_price_ugx > 0 THEN
    v_bad := CASE v_side WHEN 'buy' THEN v_price > p_expected_price_ugx * (1 + v_slip / 100)
                         ELSE v_price < p_expected_price_ugx * (1 - v_slip / 100) END;
    IF v_bad THEN
      RETURN jsonb_build_object('success', false, 'code', 'price_moved', 'unit_ugx', v_price,
        'error', 'The price moved while you were swapping. Review the new price and try again.');
    END IF;
  END IF;

  -- amounts (rounded down, in the house's favour, exactly as previewed)
  IF v_side = 'buy' THEN
    v_local := trunc(p_amount, 2);
    v_gross := trunc(v_local * v_rate, 8);
    v_fee   := trunc(v_gross * s.fee_bps / 10000, 8);
    v_net   := v_gross - v_fee;
    v_units := trunc(v_net / v_price, 8);
    v_cost  := v_gross;
    IF v_local <= 0 OR v_units <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small.');
    END IF;
    IF v_gross > s.max_trade_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_ugx', s.max_trade_ugx,
        'error', 'That is above the limit for a single swap.');
    END IF;
    IF COALESCE(h.cost_ugx, 0) + v_gross > s.max_position_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'position_too_large', 'max_ugx', s.max_position_ugx,
        'error', 'That would take you above the holding limit.');
    END IF;
    IF v_cash < v_local THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_funds',
        'error', format('Insufficient balance. You have %s %s, need %s', v_cash, v_cur, v_local));
    END IF;
  ELSE
    v_units := trunc(p_amount, 8);
    IF h.units IS NULL OR h.units < v_units THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_units',
        'error', format('You hold %s ICEC-S, need %s', COALESCE(h.units, 0), v_units));
    END IF;
    v_gross := trunc(v_units * v_price, 8);
    v_fee   := trunc(v_gross * s.fee_bps / 10000, 8);
    v_net   := v_gross - v_fee;
    v_local := trunc(v_net / v_rate, 2);
    IF v_units <= 0 OR v_local <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small.');
    END IF;
    IF v_gross > s.max_trade_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_ugx', s.max_trade_ugx,
        'error', 'That is above the limit for a single swap. Sell in smaller parts.');
    END IF;
    IF icanera_stable.vault_balance() < v_net THEN
      RETURN jsonb_build_object('success', false, 'code', 'vault_insufficient',
        'error', 'ICEC-S cannot pay this out right now. Nothing was sold; please try again later.');
    END IF;
    v_cost := CASE WHEN v_units = h.units THEN h.cost_ugx ELSE trunc(h.cost_ugx * v_units / h.units, 8) END;
  END IF;

  -- the swap: all of it, in this one transaction
  IF v_side = 'buy' THEN
    UPDATE public.wallet_accounts SET balance = balance - v_local, updated_at = now()
     WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    INSERT INTO icanera_stable.holdings (user_id, units, cost_ugx) VALUES (v_uid, v_units, v_cost)
    ON CONFLICT (user_id) DO UPDATE SET units = icanera_stable.holdings.units + EXCLUDED.units,
      cost_ugx = icanera_stable.holdings.cost_ugx + EXCLUDED.cost_ugx, updated_at = now()
    RETURNING units INTO v_new_units;
  ELSE
    UPDATE public.wallet_accounts SET balance = balance + v_local, updated_at = now()
     WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    UPDATE icanera_stable.holdings SET units = units - v_units, cost_ugx = cost_ugx - v_cost, updated_at = now()
     WHERE user_id = v_uid RETURNING units INTO v_new_units;
  END IF;

  INSERT INTO icanera_stable.fills (user_id, side, units, unit_ugx, gross_ugx, fee_ugx, net_ugx, cost_basis_ugx,
                                    pay_currency, pay_amount, fx_rate_to_ugx, fx_updated_at, request_id)
  VALUES (v_uid, v_side, v_units, v_price, v_gross, v_fee, v_net, v_cost, v_cur, v_local, v_rate, v_rate_at, p_request_id)
  RETURNING id INTO v_fill;

  IF v_side = 'buy' THEN
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, user_id, fill_id, memo) VALUES ('collateral', v_net, v_uid, v_fill, 'buy');
  ELSE
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, user_id, fill_id, memo) VALUES ('payout', -v_gross, v_uid, v_fill, 'sell');
  END IF;
  IF v_fee > 0 THEN
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, user_id, fill_id, memo) VALUES ('fee', v_fee, v_uid, v_fill, v_side);
  END IF;

  v_result := jsonb_build_object(
    'success', true, 'side', v_side, 'units', v_units, 'unit_ugx', v_price, 'dollar_ugx', pv.dollar_ugx,
    'gross_ugx', v_gross, 'fee_ugx', v_fee, 'net_ugx', v_net,
    'pay_currency', v_cur, 'pay_amount', v_local, 'new_units', v_new_units, 'new_local_balance', v_new_cash,
    'fill_id', v_fill, 'request_id', p_request_id, 'duplicate', false);
  INSERT INTO icanera_stable.requests (user_id, request_id, side, result) VALUES (v_uid, p_request_id, v_side, v_result);
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_swap(TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_swap(TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.ican_stable_my_position()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE h icanera_stable.holdings; p RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_signed_in'); END IF;
  SELECT * INTO h FROM icanera_stable.holdings WHERE user_id = auth.uid();
  SELECT * INTO p FROM icanera_stable.pool_value();
  RETURN jsonb_build_object('success', true, 'units', COALESCE(h.units, 0), 'cost_ugx', COALESCE(h.cost_ugx, 0),
    'value_ugx', CASE WHEN p.price_ugx IS NULL THEN NULL ELSE trunc(COALESCE(h.units, 0) * p.price_ugx, 2) END);
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_my_position() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_my_position() TO authenticated;

-- Operators: the pool's numbers, and an optional top-up. Taking money OUT is refused while anyone holds ICEC-S (it is
-- the holders' pool).
CREATE OR REPLACE FUNCTION public.ican_stable_dev_overview(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE s icanera_stable.settings; v RECORD; p RECORD; v_vault NUMERIC; v_out NUMERIC;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  SELECT * INTO v FROM icanera_stable.unit_value();
  SELECT * INTO p FROM icanera_stable.pool_value();
  v_vault := icanera_stable.vault_balance();
  v_out := icanera_stable.units_outstanding();
  RETURN jsonb_build_object(
    'settings', to_jsonb(s),
    'value', to_jsonb(v),
    'vault', jsonb_build_object('balance_ugx', v_vault, 'units_outstanding', v_out,
      'owed_ugx', CASE WHEN v.unit_ugx IS NULL THEN NULL ELSE round(v_out * v.unit_ugx, 2) END,
      'cover_ratio', CASE WHEN v_out > 0 AND v.unit_ugx IS NOT NULL THEN round(v_vault / (v_out * v.unit_ugx), 4) END,
      'required_ratio', 1,
      'price_ugx', p.price_ugx, 'pool_per_unit_ugx', p.nav_ugx, 'pool_short', COALESCE(p.pool_short, false)),
    'activity_24h', jsonb_build_object(
      'swaps', (SELECT count(*) FROM icanera_stable.fills WHERE created_at > now() - INTERVAL '24 hours'),
      'volume_ugx', COALESCE((SELECT sum(gross_ugx) FROM icanera_stable.fills WHERE created_at > now() - INTERVAL '24 hours'), 0),
      'fees_ugx', COALESCE((SELECT sum(fee_ugx) FROM icanera_stable.fills WHERE created_at > now() - INTERVAL '24 hours'), 0)),
    'holders', (SELECT count(*) FROM icanera_stable.holdings WHERE units > 0));
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_dev_overview(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_dev_overview(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ican_stable_dev_vault_adjust(dev_token TEXT, p_amount NUMERIC, p_memo TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_amount IS NULL OR p_amount = 0 OR p_amount = 'NaN'::NUMERIC OR abs(p_amount) > 1000000000000 THEN
    RAISE EXCEPTION 'amount must be a non-zero number' USING ERRCODE = '22023';
  END IF;
  IF p_memo IS NULL OR char_length(btrim(p_memo)) < 3 THEN RAISE EXCEPTION 'say why in the memo' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('icanera_stable_vault_adjust', 0));
  IF p_amount < 0 AND icanera_stable.units_outstanding() > 0 THEN
    RAISE EXCEPTION 'the pool belongs to the people who hold ICEC-S; nothing can be taken out while anyone holds it' USING ERRCODE = '22023';
  END IF;
  IF p_amount < 0 AND icanera_stable.vault_balance() + p_amount < 0 THEN
    RAISE EXCEPTION 'that is more than the pool holds' USING ERRCODE = '22023';
  END IF;
  INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, memo) VALUES (CASE WHEN p_amount > 0 THEN 'funding' ELSE 'adjustment' END, p_amount, left(btrim(p_memo), 300));
  RETURN jsonb_build_object('success', true, 'balance_ugx', icanera_stable.vault_balance());
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_dev_vault_adjust(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_dev_vault_adjust(TEXT, NUMERIC, TEXT) TO authenticated;

SELECT icanera_stable.snapshot_price();
NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- ICEC-S: the pool is HELD IN DOLLARS, so a falling shilling cannot shrink it.
--
-- Until now the pool was counted in shillings. That left one real risk: if the shilling fell, what holders are owed (a dollar
-- each, so more shillings) grew while the pool stayed the same number of shillings. This file removes that risk without any
-- operator and without leaving IcanEra:
--
--   * Whatever a buyer pays, in any wallet currency, is converted at the live rate (the same table icaneracoin is priced from)
--     and HELD IN THE POOL AS US DOLLARS. A sell takes dollars out and pays them into the wallet at the live rate.
--   * One ICEC-S is owed one dollar (or a little more when the inflation floor is above the dollar rate), so the pool and what
--     it owes are in the SAME unit: a shilling that falls or rises changes neither. The pool per ICEC-S moves only with fees,
--     which stay in the pool and only ever raise it.
--   * The price is still the smaller of what an ICEC-S is worth and the pool's share per ICEC-S, so the pool can always pay.
--     The one case where the pool can hold less than the full value is the inflation floor sitting above a plain dollar.
--
-- Run after 20261025100000_icec_stable_automatic.sql. Safe to run more than once. Rows from before this file (counted in
-- shillings, if any) are valued at the live rate.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_stable.vault_entries') IS NULL OR to_regprocedure('icanera_stable.pool_value()') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261024100000_icec_stable_in_system.sql and 20261025100000_icec_stable_automatic.sql first.';
  END IF;
END $$;

-- 1. Dollars next to the shilling figures (the old columns stay; they record the shilling value at the time).
ALTER TABLE icanera_stable.vault_entries ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(24,8);
ALTER TABLE icanera_stable.fills ADD COLUMN IF NOT EXISTS unit_usd  NUMERIC(24,8);
ALTER TABLE icanera_stable.fills ADD COLUMN IF NOT EXISTS gross_usd NUMERIC(24,8);
ALTER TABLE icanera_stable.fills ADD COLUMN IF NOT EXISTS fee_usd   NUMERIC(24,8);
ALTER TABLE icanera_stable.fills ADD COLUMN IF NOT EXISTS net_usd   NUMERIC(24,8);

-- The pool, in US dollars. `p_fx` (UGX per dollar) values any older shilling-only entry.
CREATE OR REPLACE FUNCTION icanera_stable.vault_usd(p_fx NUMERIC)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(CASE WHEN amount_usd IS NOT NULL THEN amount_usd ELSE amount_ugx / NULLIF(p_fx, 0) END), 0)
    FROM icanera_stable.vault_entries $$;
REVOKE ALL ON FUNCTION icanera_stable.vault_usd(NUMERIC) FROM PUBLIC, anon, authenticated;

-- 2. The price a swap uses, in dollars and in shillings.
--    unit_usd  = what one ICEC-S is worth in dollars: 1, or more if the inflation floor is above the dollar rate
--    nav_usd   = the pool's dollars per ICEC-S
--    price_usd = the smaller of the two (rounded DOWN, so units x price never exceeds the pool)
DROP FUNCTION IF EXISTS icanera_stable.pool_value();
CREATE OR REPLACE FUNCTION icanera_stable.pool_value()
RETURNS TABLE (price_ugx NUMERIC, dollar_ugx NUMERIC, nav_ugx NUMERIC, pool_short BOOLEAN,
               price_usd NUMERIC, unit_usd NUMERIC, nav_usd NUMERIC, pool_usd NUMERIC, fx_ugx NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE v RECORD; v_out NUMERIC; v_pool NUMERIC; v_nav NUMERIC; v_unit NUMERIC;
BEGIN
  SELECT * INTO v FROM icanera_stable.unit_value();
  IF v.unit_ugx IS NULL THEN RETURN; END IF;
  v_out := icanera_stable.units_outstanding();
  v_pool := icanera_stable.vault_usd(v.fx_ugx);
  v_unit := v.unit_ugx / v.fx_ugx;
  IF v_out > 0 THEN v_nav := v_pool / v_out; END IF;
  fx_ugx := v.fx_ugx;
  unit_usd := trunc(v_unit, 8);
  nav_usd := trunc(v_nav, 8);
  pool_usd := v_pool;
  price_usd := trunc(CASE WHEN v_nav IS NULL THEN v_unit ELSE LEAST(v_unit, v_nav) END, 8);
  price_ugx := trunc(price_usd * v.fx_ugx, 6);
  dollar_ugx := v.unit_ugx;
  nav_ugx := trunc(v_nav * v.fx_ugx, 6);
  pool_short := v_nav IS NOT NULL AND v_nav < v_unit;
  RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION icanera_stable.pool_value() FROM PUBLIC, anon, authenticated;

-- 3. What anyone may see.
CREATE OR REPLACE FUNCTION public.ican_stable_quote()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE
  v RECORD; p RECORD;
  s icanera_stable.settings;
  v_out NUMERIC; v_stale BOOLEAN;
BEGIN
  PERFORM icanera_stable.snapshot_price();
  SELECT * INTO v FROM icanera_stable.unit_value();
  SELECT * INTO p FROM icanera_stable.pool_value();
  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  IF v.unit_ugx IS NULL THEN RETURN jsonb_build_object('available', false); END IF;
  v_stale := v.rates_updated_at < now() - make_interval(secs => s.rates_max_age_s);
  v_out := icanera_stable.units_outstanding();
  RETURN jsonb_build_object(
    'available', true,
    'unit_ugx', p.price_ugx, 'dollar_ugx', p.dollar_ugx, 'fx_ugx', v.fx_ugx, 'floor_ugx', v.floor_ugx, 'protected', v.protected,
    'pool_short', p.pool_short, 'pool_per_unit_ugx', p.nav_ugx, 'pool_usd', p.pool_usd, 'pool_per_unit_usd', p.nav_usd,
    'cover_pct', CASE WHEN v_out > 0 THEN round(p.pool_usd / (v_out * p.unit_usd) * 100, 1) END,
    'inflation_pct', v.inflation_pct, 'anchor_at', v.anchor_at,
    'rates_updated_at', v.rates_updated_at, 'rates_stale', v_stale,
    'trading_enabled', s.trading_enabled AND NOT v_stale, 'fee_bps', s.fee_bps,
    'max_trade_ugx', s.max_trade_ugx, 'has_capacity', true,
    'currencies', COALESCE((
      SELECT jsonb_object_agg(r.currency_code, round(p.price_ugx / r.rate_to_ugx, 6))
        FROM public.ican_currency_rates r WHERE r.rate_to_ugx > 0 AND r.currency_code ~ '^[A-Z]{3}$'), '{}'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_quote() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_stable_quote() TO anon, authenticated;

-- 4. The swap. Money in any wallet currency -> dollars -> ICEC-S at the price above; and back.
CREATE OR REPLACE FUNCTION public.ican_stable_swap(
  p_side                TEXT,
  p_amount              NUMERIC,      -- buy: money to spend in p_pay_currency.  sell: ICEC-S units to sell
  p_pay_currency        TEXT    DEFAULT 'UGX',
  p_request_id          TEXT    DEFAULT NULL,
  p_expected_price_ugx  NUMERIC DEFAULT NULL,
  p_max_slippage_pct    NUMERIC DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public SET jit = off AS $$
DECLARE
  v_uid   UUID    := auth.uid();
  v_side  TEXT    := lower(btrim(COALESCE(p_side, '')));
  v_cur   TEXT    := upper(btrim(COALESCE(p_pay_currency, 'UGX')));
  v_slip  NUMERIC := COALESCE(p_max_slippage_pct, 1);
  s       icanera_stable.settings;
  v       RECORD;
  pv      RECORD;
  h       icanera_stable.holdings;
  v_prior JSONB; v_recent INT;
  v_rate  NUMERIC; v_rate_at TIMESTAMPTZ;       -- UGX per 1 of the wallet currency
  v_cash  NUMERIC;
  v_price NUMERIC;                              -- UGX per ICEC-S (what the screen shows)
  v_pusd  NUMERIC;                              -- dollars per ICEC-S
  v_local NUMERIC; v_gross NUMERIC; v_fee NUMERIC; v_net NUMERIC;          -- shillings (the old columns)
  v_gusd  NUMERIC; v_fusd NUMERIC; v_nusd NUMERIC;                          -- dollars (what the pool holds)
  v_units NUMERIC; v_cost NUMERIC; v_cost_usd NUMERIC;
  v_new_units NUMERIC; v_new_cash NUMERIC;
  v_fill UUID; v_result JSONB; v_bad BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  IF v_side NOT IN ('buy', 'sell') THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_side', 'error', 'Choose buy or sell.');
  END IF;
  IF p_amount IS NULL OR p_amount = 'NaN'::NUMERIC OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_amount', 'error', 'Enter a valid amount.');
  END IF;
  IF v_cur !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'Unsupported currency.');
  END IF;
  IF p_request_id IS NULL OR char_length(p_request_id) NOT BETWEEN 8 AND 100 OR p_request_id !~ '^[A-Za-z0-9:_.-]+$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_request_id', 'error', 'Missing or invalid request id.');
  END IF;
  IF v_slip < 0 OR v_slip > 50 OR v_slip = 'NaN'::NUMERIC THEN v_slip := 1; END IF;

  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  IF NOT s.trading_enabled THEN
    RETURN jsonb_build_object('success', false, 'code', 'trading_paused', 'error', 'ICEC-S is paused for a moment. Please try again shortly.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ican_stable:' || v_uid::TEXT, 0));
  SELECT a.balance INTO v_cash FROM public.wallet_accounts a
   WHERE a.user_id = v_uid AND a.currency = v_cur AND a.status = 'active' FOR UPDATE;
  SELECT * INTO h FROM icanera_stable.holdings WHERE user_id = v_uid FOR UPDATE;

  SELECT r.result INTO v_prior FROM icanera_stable.requests r WHERE r.user_id = v_uid AND r.request_id = p_request_id;
  IF FOUND THEN RETURN v_prior || jsonb_build_object('duplicate', true); END IF;

  SELECT count(*) INTO v_recent FROM icanera_stable.requests r WHERE r.user_id = v_uid AND r.created_at > now() - INTERVAL '1 minute';
  IF v_recent >= s.max_trades_per_minute THEN
    RETURN jsonb_build_object('success', false, 'code', 'rate_limited', 'error', 'Too many swaps in a minute. Please wait a moment.');
  END IF;

  SELECT * INTO v FROM icanera_stable.unit_value();
  IF v.unit_ugx IS NULL OR v.rates_updated_at < now() - make_interval(secs => s.rates_max_age_s) THEN
    RETURN jsonb_build_object('success', false, 'code', 'rates_stale',
      'error', 'The live exchange rates are updating. Please try again in a few minutes.');
  END IF;
  SELECT * INTO pv FROM icanera_stable.pool_value();
  v_price := pv.price_ugx;
  v_pusd  := pv.price_usd;
  IF v_cur = 'UGX' THEN v_rate := 1; v_rate_at := v.rates_updated_at;
  ELSE SELECT r.rate_to_ugx, r.updated_at INTO v_rate, v_rate_at FROM public.ican_currency_rates r WHERE r.currency_code = v_cur; END IF;
  IF v_rate IS NULL OR v_rate <= 0 OR v_rate_at < now() - make_interval(secs => s.rates_max_age_s) THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'That currency is not available right now.');
  END IF;
  IF v_cash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'no_cash_wallet', 'error', 'You do not have a wallet in ' || v_cur || '.');
  END IF;

  IF p_expected_price_ugx IS NOT NULL AND p_expected_price_ugx > 0 THEN
    v_bad := CASE v_side WHEN 'buy' THEN v_price > p_expected_price_ugx * (1 + v_slip / 100)
                         ELSE v_price < p_expected_price_ugx * (1 - v_slip / 100) END;
    IF v_bad THEN
      RETURN jsonb_build_object('success', false, 'code', 'price_moved', 'unit_ugx', v_price,
        'error', 'The price moved while you were swapping. Review the new price and try again.');
    END IF;
  END IF;

  IF v_side = 'buy' THEN
    v_local := trunc(p_amount, 2);
    v_gross := trunc(v_local * v_rate, 8);                       -- shillings
    v_gusd  := trunc(v_gross / pv.fx_ugx, 8);                    -- the same money, in dollars
    v_fusd  := trunc(v_gusd * s.fee_bps / 10000, 8);
    v_nusd  := v_gusd - v_fusd;
    v_fee   := trunc(v_gross * s.fee_bps / 10000, 8);
    v_net   := v_gross - v_fee;
    v_units := trunc(v_nusd / v_pusd, 8);
    v_cost  := v_gross; v_cost_usd := v_gusd;
    IF v_local <= 0 OR v_units <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small.');
    END IF;
    IF v_gross > s.max_trade_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_ugx', s.max_trade_ugx,
        'error', 'That is above the limit for a single swap.');
    END IF;
    IF COALESCE(h.cost_ugx, 0) + v_gross > s.max_position_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'position_too_large', 'max_ugx', s.max_position_ugx,
        'error', 'That would take you above the holding limit.');
    END IF;
    IF v_cash < v_local THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_funds',
        'error', format('Insufficient balance. You have %s %s, need %s', v_cash, v_cur, v_local));
    END IF;
  ELSE
    v_units := trunc(p_amount, 8);
    IF h.units IS NULL OR h.units < v_units THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_units',
        'error', format('You hold %s ICEC-S, need %s', COALESCE(h.units, 0), v_units));
    END IF;
    v_gusd  := trunc(v_units * v_pusd, 8);
    v_fusd  := trunc(v_gusd * s.fee_bps / 10000, 8);
    v_nusd  := v_gusd - v_fusd;
    v_gross := trunc(v_gusd * pv.fx_ugx, 8);
    v_fee   := trunc(v_fusd * pv.fx_ugx, 8);
    v_net   := trunc(v_nusd * pv.fx_ugx, 8);
    v_local := trunc(v_net / v_rate, 2);
    IF v_units <= 0 OR v_local <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small.');
    END IF;
    IF v_gross > s.max_trade_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_ugx', s.max_trade_ugx,
        'error', 'That is above the limit for a single swap. Sell in smaller parts.');
    END IF;
    IF pv.pool_usd < v_nusd THEN
      RETURN jsonb_build_object('success', false, 'code', 'vault_insufficient',
        'error', 'ICEC-S cannot pay this out right now. Nothing was sold; please try again later.');
    END IF;
    v_cost := CASE WHEN v_units = h.units THEN h.cost_ugx ELSE trunc(h.cost_ugx * v_units / h.units, 8) END;
    v_cost_usd := 0;
  END IF;

  IF v_side = 'buy' THEN
    UPDATE public.wallet_accounts SET balance = balance - v_local, updated_at = now()
     WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    INSERT INTO icanera_stable.holdings (user_id, units, cost_ugx) VALUES (v_uid, v_units, v_cost)
    ON CONFLICT (user_id) DO UPDATE SET units = icanera_stable.holdings.units + EXCLUDED.units,
      cost_ugx = icanera_stable.holdings.cost_ugx + EXCLUDED.cost_ugx, updated_at = now()
    RETURNING units INTO v_new_units;
  ELSE
    UPDATE public.wallet_accounts SET balance = balance + v_local, updated_at = now()
     WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    UPDATE icanera_stable.holdings SET units = units - v_units, cost_ugx = cost_ugx - v_cost, updated_at = now()
     WHERE user_id = v_uid RETURNING units INTO v_new_units;
  END IF;

  INSERT INTO icanera_stable.fills (user_id, side, units, unit_ugx, gross_ugx, fee_ugx, net_ugx, cost_basis_ugx,
                                    pay_currency, pay_amount, fx_rate_to_ugx, fx_updated_at, request_id,
                                    unit_usd, gross_usd, fee_usd, net_usd)
  VALUES (v_uid, v_side, v_units, v_price, v_gross, v_fee, v_net, v_cost, v_cur, v_local, v_rate, v_rate_at, p_request_id,
          v_pusd, v_gusd, v_fusd, v_nusd)
  RETURNING id INTO v_fill;

  -- the pool moves in dollars (the shilling figure is recorded beside it)
  IF v_side = 'buy' THEN
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, amount_usd, user_id, fill_id, memo) VALUES ('collateral', v_net, v_nusd, v_uid, v_fill, 'buy');
  ELSE
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, amount_usd, user_id, fill_id, memo) VALUES ('payout', -v_gross, -v_gusd, v_uid, v_fill, 'sell');
  END IF;
  IF v_fusd > 0 THEN
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, amount_usd, user_id, fill_id, memo) VALUES ('fee', v_fee, v_fusd, v_uid, v_fill, v_side);
  END IF;

  v_result := jsonb_build_object(
    'success', true, 'side', v_side, 'units', v_units, 'unit_ugx', v_price, 'dollar_ugx', pv.dollar_ugx,
    'gross_ugx', v_gross, 'fee_ugx', v_fee, 'net_ugx', v_net,
    'pay_currency', v_cur, 'pay_amount', v_local, 'new_units', v_new_units, 'new_local_balance', v_new_cash,
    'fill_id', v_fill, 'request_id', p_request_id, 'duplicate', false);
  INSERT INTO icanera_stable.requests (user_id, request_id, side, result) VALUES (v_uid, p_request_id, v_side, v_result);
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_swap(TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_swap(TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;

-- 5. Operators: the pool in dollars, an optional top-up (in UGX, converted at the live rate), the books.
CREATE OR REPLACE FUNCTION public.ican_stable_dev_overview(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE s icanera_stable.settings; v RECORD; p RECORD; v_out NUMERIC;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  SELECT * INTO v FROM icanera_stable.unit_value();
  SELECT * INTO p FROM icanera_stable.pool_value();
  v_out := icanera_stable.units_outstanding();
  RETURN jsonb_build_object(
    'settings', to_jsonb(s),
    'value', to_jsonb(v),
    'vault', jsonb_build_object('balance_ugx', round(COALESCE(p.pool_usd * p.fx_ugx, 0), 2), 'balance_usd', p.pool_usd, 'units_outstanding', v_out,
      'owed_ugx', CASE WHEN p.unit_usd IS NULL THEN NULL ELSE round(v_out * p.unit_usd * p.fx_ugx, 2) END,
      'cover_ratio', CASE WHEN v_out > 0 AND p.unit_usd IS NOT NULL THEN round(p.pool_usd / (v_out * p.unit_usd), 4) END,
      'required_ratio', 1,
      'price_ugx', p.price_ugx, 'pool_per_unit_ugx', p.nav_ugx, 'pool_per_unit_usd', p.nav_usd, 'pool_short', COALESCE(p.pool_short, false)),
    'activity_24h', jsonb_build_object(
      'swaps', (SELECT count(*) FROM icanera_stable.fills WHERE created_at > now() - INTERVAL '24 hours'),
      'volume_ugx', COALESCE((SELECT sum(gross_ugx) FROM icanera_stable.fills WHERE created_at > now() - INTERVAL '24 hours'), 0),
      'fees_ugx', COALESCE((SELECT sum(fee_ugx) FROM icanera_stable.fills WHERE created_at > now() - INTERVAL '24 hours'), 0)),
    'holders', (SELECT count(*) FROM icanera_stable.holdings WHERE units > 0));
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_dev_overview(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_dev_overview(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ican_stable_dev_vault_adjust(dev_token TEXT, p_amount NUMERIC, p_memo TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE v RECORD; v_usd NUMERIC;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_amount IS NULL OR p_amount = 0 OR p_amount = 'NaN'::NUMERIC OR abs(p_amount) > 1000000000000 THEN
    RAISE EXCEPTION 'amount must be a non-zero number' USING ERRCODE = '22023';
  END IF;
  IF p_memo IS NULL OR char_length(btrim(p_memo)) < 3 THEN RAISE EXCEPTION 'say why in the memo' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('icanera_stable_vault_adjust', 0));
  IF p_amount < 0 AND icanera_stable.units_outstanding() > 0 THEN
    RAISE EXCEPTION 'the pool belongs to the people who hold ICEC-S; nothing can be taken out while anyone holds it' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM icanera_stable.unit_value();
  IF v.fx_ugx IS NULL THEN RAISE EXCEPTION 'the live exchange rate is not available' USING ERRCODE = '22023'; END IF;
  v_usd := trunc(p_amount / v.fx_ugx, 8);
  IF p_amount < 0 AND icanera_stable.vault_usd(v.fx_ugx) + v_usd < 0 THEN
    RAISE EXCEPTION 'that is more than the pool holds' USING ERRCODE = '22023';
  END IF;
  INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, amount_usd, memo)
  VALUES (CASE WHEN p_amount > 0 THEN 'funding' ELSE 'adjustment' END, p_amount, v_usd, left(btrim(p_memo), 300));
  RETURN jsonb_build_object('success', true, 'balance_usd', icanera_stable.vault_usd(v.fx_ugx));
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_dev_vault_adjust(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_dev_vault_adjust(TEXT, NUMERIC, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ican_stable_dev_reconcile(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE v_bought NUMERIC; v_sold NUMERIC; v_held NUMERIC; v_neg BIGINT; v_bad BIGINT; v_fx NUMERIC;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(SUM(units) FILTER (WHERE side = 'buy'), 0), COALESCE(SUM(units) FILTER (WHERE side = 'sell'), 0) INTO v_bought, v_sold FROM icanera_stable.fills;
  v_held := icanera_stable.units_outstanding();
  SELECT fx_ugx INTO v_fx FROM icanera_stable.unit_value();
  SELECT count(*) INTO v_neg FROM icanera_stable.holdings WHERE units < 0 OR cost_ugx < 0;
  -- every swap has exactly the pool entries it should, in dollars: a buy puts in its dollars, a sell takes out what the seller was paid
  SELECT count(*) INTO v_bad FROM icanera_stable.fills f
   WHERE (SELECT COALESCE(SUM(e.amount_usd), 0) FROM icanera_stable.vault_entries e WHERE e.fill_id = f.id)
         <> CASE f.side WHEN 'buy' THEN COALESCE(f.net_usd, 0) + COALESCE(f.fee_usd, 0) ELSE -COALESCE(f.net_usd, 0) END
     AND f.net_usd IS NOT NULL;
  RETURN jsonb_build_object('ok', v_bought - v_sold = v_held AND v_neg = 0 AND v_bad = 0,
    'units_bought', v_bought, 'units_sold', v_sold, 'units_held', v_held, 'units_match', v_bought - v_sold = v_held,
    'negative_holdings', v_neg, 'fills_without_matching_pool_entries', v_bad, 'pool_usd', icanera_stable.vault_usd(v_fx));
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_dev_reconcile(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_dev_reconcile(TEXT) TO authenticated;

SELECT icanera_stable.snapshot_price();
NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- ICEC-S for the whole world: every country's currency, with the right number of decimals.
--
-- The live rate table (public.ican_currency_rates, fed hourly) already covers ~120 currencies and
-- public.ican_country_currency_map says which currency each country uses (the country a person picks at sign-up), so the
-- PRICE of an ICEC-S in pounds, yen, euros, rupees ... was already correct. Two things were not:
--   1. A person whose country's currency has no wallet row yet (a new UK or Japan user has UGX/KES/USD rows only) could not
--      sell into it. They now get an empty wallet in that currency the first time they sell into it (any currency the live
--      rates know; a BUY still needs money that is really there).
--   2. Money was always cut to 2 decimals. Yen, won, dong, rupiah and the CFA francs have none; dinars have 3. Amounts are now
--      cut to what the currency really has (UGX stays at 2, as the wallets already hold it).
--
-- Run after 20261026100000_icec_stable_dollar_pool.sql. Safe to run more than once.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_stable.fills') IS NULL OR to_regprocedure('icanera_stable.pool_value()') IS NULL THEN
    RAISE EXCEPTION 'Apply the earlier ICEC-S migrations first.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION icanera_stable.currency_decimals(p_currency TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN upper(p_currency) IN ('JPY','KRW','VND','IDR','CLP','PYG','ISK','XAF','XOF','XPF','RWF','BIF','DJF','GNF','KMF','VUV') THEN 0
    WHEN upper(p_currency) IN ('KWD','BHD','OMR','JOD','TND','IQD','LYD') THEN 3
    ELSE 2 END $$;
REVOKE ALL ON FUNCTION icanera_stable.currency_decimals(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ican_stable_swap(
  p_side                TEXT,
  p_amount              NUMERIC,      -- buy: money to spend in p_pay_currency.  sell: ICEC-S units to sell
  p_pay_currency        TEXT    DEFAULT 'UGX',
  p_request_id          TEXT    DEFAULT NULL,
  p_expected_price_ugx  NUMERIC DEFAULT NULL,
  p_max_slippage_pct    NUMERIC DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public SET jit = off AS $$
DECLARE
  v_uid   UUID    := auth.uid();
  v_side  TEXT    := lower(btrim(COALESCE(p_side, '')));
  v_cur   TEXT    := upper(btrim(COALESCE(p_pay_currency, 'UGX')));
  v_slip  NUMERIC := COALESCE(p_max_slippage_pct, 1);
  s       icanera_stable.settings;
  v       RECORD;
  pv      RECORD;
  h       icanera_stable.holdings;
  v_prior JSONB; v_recent INT;
  v_rate  NUMERIC; v_rate_at TIMESTAMPTZ;       -- UGX per 1 of the wallet currency
  v_cash  NUMERIC;
  v_price NUMERIC;                              -- UGX per ICEC-S (what the screen shows)
  v_pusd  NUMERIC;                              -- dollars per ICEC-S
  v_local NUMERIC; v_gross NUMERIC; v_fee NUMERIC; v_net NUMERIC;          -- shillings (the old columns)
  v_gusd  NUMERIC; v_fusd NUMERIC; v_nusd NUMERIC;                          -- dollars (what the pool holds)
  v_units NUMERIC; v_cost NUMERIC; v_cost_usd NUMERIC;
  v_new_units NUMERIC; v_new_cash NUMERIC;
  v_dec   INT;                                  -- decimal places the wallet currency really has (0 for yen, 3 for dinars)
  v_fill UUID; v_result JSONB; v_bad BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  IF v_side NOT IN ('buy', 'sell') THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_side', 'error', 'Choose buy or sell.');
  END IF;
  IF p_amount IS NULL OR p_amount = 'NaN'::NUMERIC OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_amount', 'error', 'Enter a valid amount.');
  END IF;
  IF v_cur !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'Unsupported currency.');
  END IF;
  IF p_request_id IS NULL OR char_length(p_request_id) NOT BETWEEN 8 AND 100 OR p_request_id !~ '^[A-Za-z0-9:_.-]+$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_request_id', 'error', 'Missing or invalid request id.');
  END IF;
  IF v_slip < 0 OR v_slip > 50 OR v_slip = 'NaN'::NUMERIC THEN v_slip := 1; END IF;

  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  IF NOT s.trading_enabled THEN
    RETURN jsonb_build_object('success', false, 'code', 'trading_paused', 'error', 'ICEC-S is paused for a moment. Please try again shortly.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ican_stable:' || v_uid::TEXT, 0));
  v_dec := icanera_stable.currency_decimals(v_cur);
  SELECT a.balance INTO v_cash FROM public.wallet_accounts a
   WHERE a.user_id = v_uid AND a.currency = v_cur AND a.status = 'active' FOR UPDATE;
  -- A person whose country's currency has no wallet yet (pound, yen, ...) gets an empty one the first time they sell into it.
  -- Only for a currency the live rates know; a buy still needs money that is really there.
  IF v_cash IS NULL AND v_side = 'sell'
     AND EXISTS (SELECT 1 FROM public.ican_currency_rates r WHERE r.currency_code = v_cur AND r.rate_to_ugx > 0)
     AND NOT EXISTS (SELECT 1 FROM public.wallet_accounts a WHERE a.user_id = v_uid AND a.currency = v_cur) THEN
    INSERT INTO public.wallet_accounts (user_id, currency, balance, status) VALUES (v_uid, v_cur, 0, 'active');
    SELECT a.balance INTO v_cash FROM public.wallet_accounts a WHERE a.user_id = v_uid AND a.currency = v_cur AND a.status = 'active' FOR UPDATE;
  END IF;
  SELECT * INTO h FROM icanera_stable.holdings WHERE user_id = v_uid FOR UPDATE;

  SELECT r.result INTO v_prior FROM icanera_stable.requests r WHERE r.user_id = v_uid AND r.request_id = p_request_id;
  IF FOUND THEN RETURN v_prior || jsonb_build_object('duplicate', true); END IF;

  SELECT count(*) INTO v_recent FROM icanera_stable.requests r WHERE r.user_id = v_uid AND r.created_at > now() - INTERVAL '1 minute';
  IF v_recent >= s.max_trades_per_minute THEN
    RETURN jsonb_build_object('success', false, 'code', 'rate_limited', 'error', 'Too many swaps in a minute. Please wait a moment.');
  END IF;

  SELECT * INTO v FROM icanera_stable.unit_value();
  IF v.unit_ugx IS NULL OR v.rates_updated_at < now() - make_interval(secs => s.rates_max_age_s) THEN
    RETURN jsonb_build_object('success', false, 'code', 'rates_stale',
      'error', 'The live exchange rates are updating. Please try again in a few minutes.');
  END IF;
  SELECT * INTO pv FROM icanera_stable.pool_value();
  v_price := pv.price_ugx;
  v_pusd  := pv.price_usd;
  IF v_cur = 'UGX' THEN v_rate := 1; v_rate_at := v.rates_updated_at;
  ELSE SELECT r.rate_to_ugx, r.updated_at INTO v_rate, v_rate_at FROM public.ican_currency_rates r WHERE r.currency_code = v_cur; END IF;
  IF v_rate IS NULL OR v_rate <= 0 OR v_rate_at < now() - make_interval(secs => s.rates_max_age_s) THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'That currency is not available right now.');
  END IF;
  IF v_cash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'no_cash_wallet', 'error', 'You do not have a wallet in ' || v_cur || '.');
  END IF;

  IF p_expected_price_ugx IS NOT NULL AND p_expected_price_ugx > 0 THEN
    v_bad := CASE v_side WHEN 'buy' THEN v_price > p_expected_price_ugx * (1 + v_slip / 100)
                         ELSE v_price < p_expected_price_ugx * (1 - v_slip / 100) END;
    IF v_bad THEN
      RETURN jsonb_build_object('success', false, 'code', 'price_moved', 'unit_ugx', v_price,
        'error', 'The price moved while you were swapping. Review the new price and try again.');
    END IF;
  END IF;

  IF v_side = 'buy' THEN
    v_local := trunc(p_amount, v_dec);
    v_gross := trunc(v_local * v_rate, 8);                       -- shillings
    v_gusd  := trunc(v_gross / pv.fx_ugx, 8);                    -- the same money, in dollars
    v_fusd  := trunc(v_gusd * s.fee_bps / 10000, 8);
    v_nusd  := v_gusd - v_fusd;
    v_fee   := trunc(v_gross * s.fee_bps / 10000, 8);
    v_net   := v_gross - v_fee;
    v_units := trunc(v_nusd / v_pusd, 8);
    v_cost  := v_gross; v_cost_usd := v_gusd;
    IF v_local <= 0 OR v_units <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small.');
    END IF;
    IF v_gross > s.max_trade_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_ugx', s.max_trade_ugx,
        'error', 'That is above the limit for a single swap.');
    END IF;
    IF COALESCE(h.cost_ugx, 0) + v_gross > s.max_position_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'position_too_large', 'max_ugx', s.max_position_ugx,
        'error', 'That would take you above the holding limit.');
    END IF;
    IF v_cash < v_local THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_funds',
        'error', format('Insufficient balance. You have %s %s, need %s', v_cash, v_cur, v_local));
    END IF;
  ELSE
    v_units := trunc(p_amount, 8);
    IF h.units IS NULL OR h.units < v_units THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_units',
        'error', format('You hold %s ICEC-S, need %s', COALESCE(h.units, 0), v_units));
    END IF;
    v_gusd  := trunc(v_units * v_pusd, 8);
    v_fusd  := trunc(v_gusd * s.fee_bps / 10000, 8);
    v_nusd  := v_gusd - v_fusd;
    v_gross := trunc(v_gusd * pv.fx_ugx, 8);
    v_fee   := trunc(v_fusd * pv.fx_ugx, 8);
    v_net   := trunc(v_nusd * pv.fx_ugx, 8);
    v_local := trunc(v_net / v_rate, v_dec);
    IF v_units <= 0 OR v_local <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small.');
    END IF;
    IF v_gross > s.max_trade_ugx THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_ugx', s.max_trade_ugx,
        'error', 'That is above the limit for a single swap. Sell in smaller parts.');
    END IF;
    IF pv.pool_usd < v_nusd THEN
      RETURN jsonb_build_object('success', false, 'code', 'vault_insufficient',
        'error', 'ICEC-S cannot pay this out right now. Nothing was sold; please try again later.');
    END IF;
    v_cost := CASE WHEN v_units = h.units THEN h.cost_ugx ELSE trunc(h.cost_ugx * v_units / h.units, 8) END;
    v_cost_usd := 0;
  END IF;

  IF v_side = 'buy' THEN
    UPDATE public.wallet_accounts SET balance = balance - v_local, updated_at = now()
     WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    INSERT INTO icanera_stable.holdings (user_id, units, cost_ugx) VALUES (v_uid, v_units, v_cost)
    ON CONFLICT (user_id) DO UPDATE SET units = icanera_stable.holdings.units + EXCLUDED.units,
      cost_ugx = icanera_stable.holdings.cost_ugx + EXCLUDED.cost_ugx, updated_at = now()
    RETURNING units INTO v_new_units;
  ELSE
    UPDATE public.wallet_accounts SET balance = balance + v_local, updated_at = now()
     WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    UPDATE icanera_stable.holdings SET units = units - v_units, cost_ugx = cost_ugx - v_cost, updated_at = now()
     WHERE user_id = v_uid RETURNING units INTO v_new_units;
  END IF;

  INSERT INTO icanera_stable.fills (user_id, side, units, unit_ugx, gross_ugx, fee_ugx, net_ugx, cost_basis_ugx,
                                    pay_currency, pay_amount, fx_rate_to_ugx, fx_updated_at, request_id,
                                    unit_usd, gross_usd, fee_usd, net_usd)
  VALUES (v_uid, v_side, v_units, v_price, v_gross, v_fee, v_net, v_cost, v_cur, v_local, v_rate, v_rate_at, p_request_id,
          v_pusd, v_gusd, v_fusd, v_nusd)
  RETURNING id INTO v_fill;

  -- the pool moves in dollars (the shilling figure is recorded beside it)
  IF v_side = 'buy' THEN
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, amount_usd, user_id, fill_id, memo) VALUES ('collateral', v_net, v_nusd, v_uid, v_fill, 'buy');
  ELSE
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, amount_usd, user_id, fill_id, memo) VALUES ('payout', -v_gross, -v_gusd, v_uid, v_fill, 'sell');
  END IF;
  IF v_fusd > 0 THEN
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, amount_usd, user_id, fill_id, memo) VALUES ('fee', v_fee, v_fusd, v_uid, v_fill, v_side);
  END IF;

  v_result := jsonb_build_object(
    'success', true, 'side', v_side, 'units', v_units, 'unit_ugx', v_price, 'dollar_ugx', pv.dollar_ugx,
    'gross_ugx', v_gross, 'fee_ugx', v_fee, 'net_ugx', v_net,
    'pay_currency', v_cur, 'pay_amount', v_local, 'new_units', v_new_units, 'new_local_balance', v_new_cash,
    'fill_id', v_fill, 'request_id', p_request_id, 'duplicate', false);
  INSERT INTO icanera_stable.requests (user_id, request_id, side, result) VALUES (v_uid, p_request_id, v_side, v_result);
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_swap(TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_swap(TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
