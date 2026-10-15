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
