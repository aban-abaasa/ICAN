-- ============================================================================
-- ICEC-S fees: none when you buy; a cash-out fee when you sell, paid to the platform fee business.
--
-- The platform's fee policy (ICAN_FEE_STRUCTURE_UPDATE.sql): 0% on buying and sending, ONE uniform 3% fee on cashing out. Every other
-- platform fee already goes to the business named in public.ican_platform_fee_recipient (read through fn_get_platform_fee_business_id),
-- which is GODMINDERA ORGANISATION (U) LTD (formerly IWOS). ICEC-S now follows the same rule:
--
--   * BUY  : no fee. Everything paid goes into the pool.
--   * SELL : fee_bps (default 300 = 3%) is taken from what the seller would get and paid to that business, in ICEC at the live coin
--            price, through fn_credit_platform_fee_to_business (idempotent: one credit per swap, referenced by the swap's id).
--   * If the credit cannot be made for ANY reason (no recipient configured, no live coin price, an error) the fee STAYS IN THE POOL:
--     it is never lost, never paid twice, and the seller is charged the same either way.
--
-- Run after 20261027100000_icec_stable_global_currencies.sql. Safe to run more than once.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_stable.fills') IS NULL OR to_regprocedure('icanera_stable.currency_decimals(text)') IS NULL THEN
    RAISE EXCEPTION 'Apply the earlier ICEC-S migrations first.';
  END IF;
END $$;

ALTER TABLE icanera_stable.fills ADD COLUMN IF NOT EXISTS fee_released_usd NUMERIC(24,8);

-- 3% on cashing out. Only the old unchanged default (0.5%) is raised; anything an administrator chose stays.
ALTER TABLE icanera_stable.settings ALTER COLUMN fee_bps SET DEFAULT 300;
UPDATE icanera_stable.settings SET fee_bps = 300, updated_at = now() WHERE id AND fee_bps = 50;

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
  v_icec_ugx NUMERIC; v_fee_icec NUMERIC; v_credit JSONB; v_released NUMERIC := 0;   -- the cash-out fee, paid to the platform fee business
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
    v_fusd  := 0;                       -- no fee for buying: all of it goes into the pool
    v_nusd  := v_gusd;
    v_fee   := 0;
    v_net   := v_gross;
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

  v_fill := gen_random_uuid();

  -- The cash-out fee goes to the platform fee business (GODMINDERA ORGANISATION (U) LTD; the same recipient every other platform fee
  -- uses), in ICEC at the live coin price, once per swap (the reference is the fill). If anything about that fails, the fee stays in
  -- the pool: it is never lost and never charged to the seller twice.
  IF v_side = 'sell' AND v_fusd > 0 THEN
    BEGIN
      IF to_regprocedure('public.fn_credit_platform_fee_to_business(numeric,text,text,text,uuid,text,jsonb)') IS NOT NULL THEN
        v_icec_ugx := public.ican_current_price_ugx(3);
        IF v_icec_ugx IS NOT NULL AND v_icec_ugx > 0 THEN
          v_fee_icec := trunc(v_fee / v_icec_ugx, 8);
          IF v_fee_icec > 0 THEN
            v_credit := public.fn_credit_platform_fee_to_business(v_fee_icec, 'icanera-icec-s', 'icec-s-fee:' || v_fill::TEXT, 'icec_s_cash_out',
                          v_uid, 'ICEC-S cash-out fee', jsonb_build_object('fill_id', v_fill, 'fee_ugx', v_fee, 'fee_usd', v_fusd, 'units', v_units));
            IF COALESCE((v_credit ->> 'success')::BOOLEAN, FALSE) AND COALESCE((v_credit ->> 'credited')::BOOLEAN, FALSE) THEN v_released := v_fusd; END IF;
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_released := 0;
    END;
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
                                    unit_usd, gross_usd, fee_usd, net_usd, id, fee_released_usd)
  VALUES (v_uid, v_side, v_units, v_price, v_gross, v_fee, v_net, v_cost, v_cur, v_local, v_rate, v_rate_at, p_request_id,
          v_pusd, v_gusd, v_fusd, v_nusd, v_fill, v_released);

  -- the pool moves in dollars (the shilling figure is recorded beside it)
  IF v_side = 'buy' THEN
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, amount_usd, user_id, fill_id, memo) VALUES ('collateral', v_net, v_nusd, v_uid, v_fill, 'buy');
  ELSE
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, amount_usd, user_id, fill_id, memo) VALUES ('payout', -v_gross, -v_gusd, v_uid, v_fill, 'sell');
  END IF;
  IF v_fusd - v_released > 0 THEN
    INSERT INTO icanera_stable.vault_entries (kind, amount_ugx, amount_usd, user_id, fill_id, memo)
    VALUES ('fee', trunc((v_fusd - v_released) * pv.fx_ugx, 8), v_fusd - v_released, v_uid, v_fill, v_side || ' (fee kept in the pool)');
  END IF;

  v_result := jsonb_build_object(
    'success', true, 'side', v_side, 'units', v_units, 'unit_ugx', v_price, 'dollar_ugx', pv.dollar_ugx,
    'gross_ugx', v_gross, 'fee_ugx', v_fee, 'net_ugx', v_net, 'fee_paid_to_organisation', v_released > 0,
    'pay_currency', v_cur, 'pay_amount', v_local, 'new_units', v_new_units, 'new_local_balance', v_new_cash,
    'fill_id', v_fill, 'request_id', p_request_id, 'duplicate', false);
  INSERT INTO icanera_stable.requests (user_id, request_id, side, result) VALUES (v_uid, p_request_id, v_side, v_result);
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_swap(TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_swap(TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;

-- The quote now says plainly what the fee is, and who gets it (public: the organisation's name is on its own public notice board).
CREATE OR REPLACE FUNCTION public.ican_stable_quote()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE
  v RECORD; p RECORD;
  s icanera_stable.settings;
  v_out NUMERIC; v_stale BOOLEAN; v_recipient TEXT;
BEGIN
  PERFORM icanera_stable.snapshot_price();
  SELECT * INTO v FROM icanera_stable.unit_value();
  SELECT * INTO p FROM icanera_stable.pool_value();
  SELECT * INTO s FROM icanera_stable.settings WHERE id;
  IF v.unit_ugx IS NULL THEN RETURN jsonb_build_object('available', false); END IF;
  v_stale := v.rates_updated_at < now() - make_interval(secs => s.rates_max_age_s);
  v_out := icanera_stable.units_outstanding();
  BEGIN
    SELECT bp.business_name INTO v_recipient FROM public.business_profiles bp WHERE bp.id = public.fn_get_platform_fee_business_id();
  EXCEPTION WHEN OTHERS THEN v_recipient := NULL;
  END;
  RETURN jsonb_build_object(
    'available', true,
    'unit_ugx', p.price_ugx, 'dollar_ugx', p.dollar_ugx, 'fx_ugx', v.fx_ugx, 'floor_ugx', v.floor_ugx, 'protected', v.protected,
    'pool_short', p.pool_short, 'pool_per_unit_ugx', p.nav_ugx, 'pool_usd', p.pool_usd, 'pool_per_unit_usd', p.nav_usd,
    'cover_pct', CASE WHEN v_out > 0 THEN round(p.pool_usd / (v_out * p.unit_usd) * 100, 1) END,
    'inflation_pct', v.inflation_pct, 'anchor_at', v.anchor_at,
    'rates_updated_at', v.rates_updated_at, 'rates_stale', v_stale,
    'trading_enabled', s.trading_enabled AND NOT v_stale,
    'fee_bps', s.fee_bps, 'buy_fee_bps', 0, 'sell_fee_bps', s.fee_bps, 'fee_recipient', v_recipient,
    'max_trade_ugx', s.max_trade_ugx, 'has_capacity', true,
    'currencies', COALESCE((
      SELECT jsonb_object_agg(r.currency_code, round(p.price_ugx / r.rate_to_ugx, 6))
        FROM public.ican_currency_rates r WHERE r.rate_to_ugx > 0 AND r.currency_code ~ '^[A-Z]{3}$'), '{}'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_quote() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_stable_quote() TO anon, authenticated;

-- The books: a buy puts in all it paid; a sell takes out what the seller was paid PLUS any fee released to the organisation.
CREATE OR REPLACE FUNCTION public.ican_stable_dev_reconcile(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE v_bought NUMERIC; v_sold NUMERIC; v_held NUMERIC; v_neg BIGINT; v_bad BIGINT; v_fx NUMERIC; v_fees NUMERIC; v_credits NUMERIC := NULL;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(SUM(units) FILTER (WHERE side = 'buy'), 0), COALESCE(SUM(units) FILTER (WHERE side = 'sell'), 0) INTO v_bought, v_sold FROM icanera_stable.fills;
  v_held := icanera_stable.units_outstanding();
  SELECT fx_ugx INTO v_fx FROM icanera_stable.unit_value();
  SELECT count(*) INTO v_neg FROM icanera_stable.holdings WHERE units < 0 OR cost_ugx < 0;
  SELECT count(*) INTO v_bad FROM icanera_stable.fills f
   WHERE f.net_usd IS NOT NULL
     AND (SELECT COALESCE(SUM(e.amount_usd), 0) FROM icanera_stable.vault_entries e WHERE e.fill_id = f.id)
         <> CASE f.side WHEN 'buy' THEN f.net_usd + COALESCE(f.fee_usd, 0)
                        ELSE -(f.net_usd + COALESCE(f.fee_released_usd, 0)) END;
  SELECT COALESCE(SUM(fee_released_usd), 0) INTO v_fees FROM icanera_stable.fills WHERE side = 'sell';
  RETURN jsonb_build_object('ok', v_bought - v_sold = v_held AND v_neg = 0 AND v_bad = 0,
    'units_bought', v_bought, 'units_sold', v_sold, 'units_held', v_held, 'units_match', v_bought - v_sold = v_held,
    'negative_holdings', v_neg, 'fills_without_matching_pool_entries', v_bad, 'pool_usd', icanera_stable.vault_usd(v_fx),
    'fees_paid_to_organisation_usd', v_fees);
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_dev_reconcile(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_stable_dev_reconcile(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
