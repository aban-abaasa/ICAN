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
