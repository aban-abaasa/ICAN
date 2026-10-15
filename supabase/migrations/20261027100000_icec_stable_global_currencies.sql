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
