-- ============================================================================
-- IcanEra Sector Markets, part 4 of 4: buying and selling.
--
-- public.ican_sector_trade(...) is ONE atomic, idempotent, server-priced step, built the same way as
-- ican_trade_execute (20261018110000_icaneracoin_atomic_trade.sql), because it solves the same problems:
--   * who you are comes from the session (auth.uid()), never from an argument;
--   * the price is the sector's cached index price, never older than `stale_s`; the browser only says
--     what price it showed and how much movement it will accept (slippage);
--   * the user's wallet rows are locked in a fixed order before anything is checked, so one user's
--     concurrent trades queue behind each other and different users never wait on each other;
--   * every check happens before the first write, and the writes (wallet, holdings, fill, vault, idempotency
--     record) are one transaction: all of it or none;
--   * p_request_id makes a retry harmless; a per-user rate limit, per-trade and per-position ceilings and a
--     kill switch (sector_settings.trading_enabled, OFF until an administrator turns it on) protect the market.
--
-- WHAT A TRADE IS
--   BUY  : spend `p_amount` in ICEC (or in any currency the user has a wallet in, converted at the server's
--          price and FX). A fee (fee_bps) goes to the vault; the rest becomes units = net / index price.
--   SELL : give back `p_amount` units. They are worth units x index price; the fee stays in the vault; the
--          rest is paid to the user in ICEC or in a currency they hold.
--   The vault is the counterparty. It never holds a mutable balance row: it is an insert-only ledger
--   (vault_entries), so trades by different users never queue on a shared row.
--
-- RISK
--   * A BUY is refused unless the vault would still cover everything users hold even if every index rose by
--     `stress_pct` (default 50 %): vault >= exposure x (1 + stress_pct/100).
--   * A SELL is refused (vault_insufficient) if the vault cannot pay it. There are no IOUs.
--   * Two buys by different users can pass the stress check at the same instant; the over-admission is bounded
--     by (concurrent trades x max_trade_icec), which is what the stress margin is for.
--
-- WHAT THIS DOES NOT TOUCH
--   Sector trades are NOT written to ican_coin_transactions. The ICEC price engine counts every completed row
--   there as usage, so booking sector trades there would let someone move the coin's price by churning
--   them. Sector activity has its own immutable ledger (sector_fills) and the vault ledger.
--
-- Safe to run more than once. Rollback: supabase/rollback/20261019_rollback_sector_trading.sql
-- Requires: 20261019100000 .. 20261019120000, and ican_user_wallets, wallet_accounts, ican_currency_rates,
--           ican_current_price_ugx (20261018100000), ican_dev_secret (20261009100000).
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_trading.sector_index_cache') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261019120000_sector_trading_index.sql (and the files before it) first.';
  END IF;
END $$;


-- 1. The trade.
--    p_sector             'iAGRI' ...
--    p_side               'buy' | 'sell'
--    p_amount             buy: money to spend, in p_pay_currency.  sell: index units to sell.
--    p_pay_currency       'ICEC' (default) or the ISO code of a wallet the user holds (paid from / into that wallet)
--    p_request_id         unique per user ACTION; reuse it only to retry that same action
--    p_expected_price_icec the index price the screen showed (optional)
--    p_max_slippage_pct   how much WORSE than that the user accepts (default 1 %); better is always fine
-- Returns { success, ... }. On failure: { success:false, code, error } with nothing changed.
CREATE OR REPLACE FUNCTION public.ican_sector_trade(
  p_sector              TEXT,
  p_side                TEXT,
  p_amount              NUMERIC,
  p_pay_currency        TEXT    DEFAULT 'ICEC',
  p_request_id          TEXT    DEFAULT NULL,
  p_expected_price_icec NUMERIC DEFAULT NULL,
  p_max_slippage_pct    NUMERIC DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
DECLARE
  v_uid     UUID    := auth.uid();
  v_side    TEXT    := lower(btrim(COALESCE(p_side, '')));
  v_tick    TEXT    := btrim(COALESCE(p_sector, ''));
  v_cur     TEXT    := upper(btrim(COALESCE(p_pay_currency, 'ICEC')));
  v_slip    NUMERIC := COALESCE(p_max_slippage_pct, 1);
  s         icanera_trading.sector_settings;
  k         icanera_trading.sector_catalog;
  c         icanera_trading.sector_index_cache;
  h         icanera_trading.sector_holdings;
  v_prior   JSONB;
  v_recent  INT;
  v_price   NUMERIC;                 -- index price, ICEC per unit
  v_icec_ugx NUMERIC;                -- ICEC price in UGX (only for a money wallet)
  v_rate    NUMERIC;                 -- UGX per 1 of the money currency
  v_ugx     NUMERIC;
  v_pay     NUMERIC;                 -- buy: ICEC the user pays (gross, including the fee)
  v_gross   NUMERIC;                 -- sell: units x price
  v_fee     NUMERIC;
  v_net     NUMERIC;                 -- buy: collateral held; sell: ICEC the user is paid
  v_units   NUMERIC;
  v_local   NUMERIC;                 -- the money amount, when a money wallet is used
  v_cost    NUMERIC;                 -- cost basis added (buy) or released (sell)
  v_ican_bal NUMERIC;
  v_cash_bal NUMERIC;
  v_new_ican NUMERIC;
  v_new_cash NUMERIC;
  v_new_units NUMERIC;
  v_vault   NUMERIC;
  v_expo    NUMERIC;
  v_fill    UUID;
  v_result  JSONB;
  v_bad     BOOLEAN;
BEGIN
  -- ---- who and what ---------------------------------------------------------
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in to trade.');
  END IF;
  IF v_side NOT IN ('buy', 'sell') THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_side', 'error', 'Choose buy or sell.');
  END IF;
  IF p_amount IS NULL OR p_amount = 'NaN'::NUMERIC OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_amount', 'error', 'Enter a valid amount.');
  END IF;
  IF v_tick !~ '^i[A-Z]{3,6}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_sector', 'error', 'Unknown sector.');
  END IF;
  IF v_cur <> 'ICEC' AND v_cur !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'Unsupported currency.');
  END IF;
  IF p_request_id IS NULL OR char_length(p_request_id) NOT BETWEEN 8 AND 100 OR p_request_id !~ '^[A-Za-z0-9:_.-]+$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_request_id', 'error', 'Missing or invalid request id.');
  END IF;
  IF v_slip < 0 OR v_slip > 50 OR v_slip = 'NaN'::NUMERIC THEN v_slip := 1; END IF;

  SELECT * INTO s FROM icanera_trading.sector_settings WHERE id;
  IF NOT s.trading_enabled THEN
    RETURN jsonb_build_object('success', false, 'code', 'trading_paused', 'error', 'Sector trading is paused for a moment. Please try again shortly.');
  END IF;
  SELECT * INTO k FROM icanera_trading.sector_catalog WHERE ticker = v_tick AND enabled;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_sector', 'error', 'Unknown sector.');
  END IF;

  -- ---- one trade at a time per user, then lock their rows -----------------------
  -- Same order everywhere (coin wallet, then money wallet, then holdings), so two trades can never wait on each
  -- other in opposite directions. The coin wallet is created below, only once a trade is certain to go through.
  PERFORM pg_advisory_xact_lock(hashtextextended('ican_sector:' || v_uid::TEXT, 0));
  SELECT COALESCE(w.ican_balance, 0) INTO v_ican_bal
    FROM public.ican_user_wallets w WHERE w.user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN v_ican_bal := 0; END IF;
  IF v_cur <> 'ICEC' THEN
    SELECT a.balance INTO v_cash_bal
      FROM public.wallet_accounts a WHERE a.user_id = v_uid AND a.currency = v_cur AND a.status = 'active' FOR UPDATE;
  END IF;
  SELECT * INTO h FROM icanera_trading.sector_holdings WHERE user_id = v_uid AND sector = v_tick FOR UPDATE;

  -- ---- a retry of something that already happened: same answer, nothing moves
  SELECT r.result INTO v_prior FROM icanera_trading.trade_requests r WHERE r.user_id = v_uid AND r.request_id = p_request_id;
  IF FOUND THEN
    RETURN v_prior || jsonb_build_object('duplicate', true);
  END IF;

  -- ---- rate limit (retries above do not count) --------------------------------
  SELECT count(*) INTO v_recent FROM icanera_trading.trade_requests r
   WHERE r.user_id = v_uid AND r.created_at > now() - INTERVAL '1 minute';
  IF v_recent >= s.max_trades_per_minute THEN
    RETURN jsonb_build_object('success', false, 'code', 'rate_limited', 'error', 'Too many trades in a minute. Please wait a moment.');
  END IF;

  -- ---- the sector must be live and its index fresh ------------------------------
  PERFORM icanera_trading.fold_sector_indices(FALSE, FALSE);      -- cheap when fresh; skipped when another call is already doing it
  SELECT * INTO c FROM icanera_trading.sector_index_cache WHERE ticker = v_tick;
  IF NOT FOUND OR k.admin_halted OR c.status <> 'live' OR c.price_icec IS NULL OR c.price_icec <= 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'sector_not_live', 'sector', v_tick,
      'error', 'This sector is not open for trading yet.');
  END IF;
  IF c.computed_at < clock_timestamp() - make_interval(secs => s.stale_s) THEN
    RETURN jsonb_build_object('success', false, 'code', 'index_stale', 'sector', v_tick,
      'error', 'The index is updating. Please try again in a moment.');
  END IF;
  v_price := c.price_icec;

  IF p_expected_price_icec IS NOT NULL AND p_expected_price_icec > 0 THEN
    v_bad := CASE v_side
      WHEN 'buy'  THEN v_price > p_expected_price_icec * (1 + v_slip / 100)
      ELSE             v_price < p_expected_price_icec * (1 - v_slip / 100) END;
    IF v_bad THEN
      RETURN jsonb_build_object('success', false, 'code', 'price_moved', 'sector', v_tick, 'price_icec', v_price,
        'error', 'The price moved while you were trading. Review the new price and try again.');
    END IF;
  END IF;

  -- ---- money conversion is the server's, never the browser's -------------------
  IF v_cur <> 'ICEC' THEN
    v_icec_ugx := public.ican_current_price_ugx(3);
    SELECT r.rate_to_ugx INTO v_rate FROM public.ican_currency_rates r WHERE r.currency_code = v_cur;
    IF v_icec_ugx IS NULL OR v_icec_ugx <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'price_unavailable', 'error', 'The live coin price is unavailable right now. Please try again.');
    END IF;
    IF v_rate IS NULL OR v_rate <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'Unsupported currency.');
    END IF;
    IF v_cash_bal IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'no_cash_wallet', 'error', 'No wallet found for currency: ' || v_cur);
    END IF;
  END IF;

  -- ---- amounts ------------------------------------------------------------------
  IF v_side = 'buy' THEN
    IF v_cur = 'ICEC' THEN
      v_pay := trunc(p_amount, 8);
    ELSE
      v_local := trunc(p_amount, 2);
      v_ugx   := v_local * v_rate;
      v_pay   := trunc(v_ugx / v_icec_ugx, 8);
    END IF;
    v_fee   := trunc(v_pay * s.fee_bps / 10000, 8);
    v_net   := v_pay - v_fee;
    v_units := trunc(v_net / v_price, 8);
    v_cost  := v_pay;
    IF v_units <= 0 OR v_pay <= 0 OR (v_cur <> 'ICEC' AND v_local <= 0) THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small to trade.');
    END IF;
    IF v_pay > s.max_trade_icec THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_icec', s.max_trade_icec,
        'error', 'That is above the limit for a single trade.');
    END IF;
    IF COALESCE(h.cost_icec, 0) + v_pay > s.max_position_icec THEN
      RETURN jsonb_build_object('success', false, 'code', 'position_too_large', 'max_icec', s.max_position_icec,
        'error', 'That would take you above the limit for one sector.');
    END IF;
  ELSE
    v_units := trunc(p_amount, 8);
    IF v_units <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small to trade.');
    END IF;
    IF h.units IS NULL OR h.units < v_units THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_units',
        'error', format('You hold %s units of %s, need %s', COALESCE(h.units, 0), v_tick, v_units));
    END IF;
    v_gross := trunc(v_units * v_price, 8);
    v_fee   := trunc(v_gross * s.fee_bps / 10000, 8);
    v_net   := v_gross - v_fee;
    IF v_net <= 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small to trade.');
    END IF;
    IF v_gross > s.max_trade_icec THEN
      RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'max_icec', s.max_trade_icec,
        'error', 'That is above the limit for a single trade. Sell in smaller parts.');
    END IF;
    IF v_cur <> 'ICEC' THEN
      v_local := trunc(v_net * v_icec_ugx / v_rate, 2);
      IF v_local <= 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small to trade.');
      END IF;
    END IF;
    v_cost := CASE WHEN v_units = h.units THEN h.cost_icec ELSE trunc(h.cost_icec * v_units / h.units, 8) END;
  END IF;

  -- ---- every check, before the first write -------------------------------------
  IF v_side = 'buy' THEN
    IF v_cur = 'ICEC' AND v_ican_bal < v_pay THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_funds',
        'error', format('Insufficient IcanEra balance. You have %s, need %s', v_ican_bal, v_pay));
    END IF;
    IF v_cur <> 'ICEC' AND v_cash_bal < v_local THEN
      RETURN jsonb_build_object('success', false, 'code', 'insufficient_funds',
        'error', format('Insufficient balance. You have %s %s, need %s', v_cash_bal, v_cur, v_local));
    END IF;
    -- would the vault still cover everyone if every index rose by stress_pct?
    v_vault := icanera_trading.vault_balance();
    v_expo  := icanera_trading.exposure_icec();
    IF v_vault + v_pay < (v_expo + v_units * v_price) * (1 + s.stress_pct / 100) THEN
      RETURN jsonb_build_object('success', false, 'code', 'capacity_reached', 'sector', v_tick,
        'error', 'Sector markets are at capacity right now. Please try again later or with a smaller amount.');
    END IF;
  ELSE
    v_vault := icanera_trading.vault_balance();
    IF v_vault < v_net THEN
      RETURN jsonb_build_object('success', false, 'code', 'vault_insufficient', 'sector', v_tick,
        'error', 'The market cannot pay this out right now. Nothing was sold; please try again later.');
    END IF;
    IF v_cur <> 'ICEC' AND v_cash_bal IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'no_cash_wallet', 'error', 'No wallet found for currency: ' || v_cur);
    END IF;
  END IF;

  -- ---- the trade: all of it, in this one transaction ----------------------------
  IF v_side = 'buy' THEN
    IF v_cur = 'ICEC' THEN
      UPDATE public.ican_user_wallets SET ican_balance = ican_balance - v_pay WHERE user_id = v_uid
      RETURNING ican_balance INTO v_new_ican;
    ELSE
      UPDATE public.wallet_accounts SET balance = balance - v_local, updated_at = now()
       WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    END IF;
    INSERT INTO icanera_trading.sector_holdings (user_id, sector, units, cost_icec)
    VALUES (v_uid, v_tick, v_units, v_cost)
    ON CONFLICT (user_id, sector) DO UPDATE
      SET units = icanera_trading.sector_holdings.units + EXCLUDED.units,
          cost_icec = icanera_trading.sector_holdings.cost_icec + EXCLUDED.cost_icec,
          updated_at = now()
    RETURNING units INTO v_new_units;
    v_gross := v_pay;
  ELSE
    IF v_cur = 'ICEC' THEN
      INSERT INTO public.ican_user_wallets (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
      UPDATE public.ican_user_wallets SET ican_balance = COALESCE(ican_balance, 0) + v_net WHERE user_id = v_uid
      RETURNING ican_balance INTO v_new_ican;
    ELSE
      UPDATE public.wallet_accounts SET balance = balance + v_local, updated_at = now()
       WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    END IF;
    UPDATE icanera_trading.sector_holdings
       SET units = units - v_units, cost_icec = cost_icec - v_cost, updated_at = now()
     WHERE user_id = v_uid AND sector = v_tick
    RETURNING units INTO v_new_units;
  END IF;

  INSERT INTO icanera_trading.sector_fills
    (user_id, sector, side, units, price_icec, gross_icec, fee_icec, net_icec, cost_basis_icec,
     pay_currency, pay_amount, fx_rate_to_ugx, icec_price_ugx, index_version, request_id)
  VALUES
    (v_uid, v_tick, v_side, v_units, v_price, v_gross, v_fee, v_net, v_cost,
     v_cur, v_local, v_rate, v_icec_ugx, c.version, p_request_id)
  RETURNING id INTO v_fill;

  IF v_side = 'buy' THEN
    INSERT INTO icanera_trading.vault_entries (kind, amount, sector, user_id, fill_id, memo)
    VALUES ('collateral', v_net, v_tick, v_uid, v_fill, 'buy');
  ELSE
    INSERT INTO icanera_trading.vault_entries (kind, amount, sector, user_id, fill_id, memo)
    VALUES ('payout', -v_gross, v_tick, v_uid, v_fill, 'sell');
  END IF;
  IF v_fee > 0 THEN
    INSERT INTO icanera_trading.vault_entries (kind, amount, sector, user_id, fill_id, memo)
    VALUES ('fee', v_fee, v_tick, v_uid, v_fill, v_side);
  END IF;

  v_result := jsonb_build_object(
    'success',           true,
    'side',              v_side,
    'sector',            v_tick,
    'units',             v_units,
    'price_icec',        v_price,
    'gross_icec',        v_gross,
    'fee_icec',          v_fee,
    'net_icec',          v_net,
    'pay_currency',      v_cur,
    'pay_amount',        v_local,
    'new_units',         v_new_units,
    'new_ican_balance',  v_new_ican,
    'new_local_balance', v_new_cash,
    'fill_id',           v_fill,
    'index_version',     c.version,
    'request_id',        p_request_id,
    'duplicate',         false
  );
  INSERT INTO icanera_trading.trade_requests (user_id, request_id, side, result)
  VALUES (v_uid, p_request_id, v_side, v_result);

  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_trade(TEXT, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_trade(TEXT, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;


-- 2. What a user sees of their own position. Only ever their own rows.
CREATE OR REPLACE FUNCTION public.ican_sector_my_holdings()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  RETURN jsonb_build_object('success', true, 'holdings', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'sector',     h.sector,
             'name',       k.name,
             'units',      h.units,
             'cost_icec',  h.cost_icec,
             'price_icec', c.price_icec,
             'value_icec', trunc(h.units * COALESCE(c.price_icec, 0), 8),
             'pnl_icec',   trunc(h.units * COALESCE(c.price_icec, 0), 8) - h.cost_icec,
             'pnl_pct',    CASE WHEN h.cost_icec > 0
                                THEN round(((trunc(h.units * COALESCE(c.price_icec, 0), 8) - h.cost_icec) / h.cost_icec) * 100, 2) END
           ) ORDER BY k.sort_order)
      FROM icanera_trading.sector_holdings h
      JOIN icanera_trading.sector_catalog k ON k.ticker = h.sector
      LEFT JOIN icanera_trading.sector_index_cache c ON c.ticker = h.sector
     WHERE h.user_id = v_uid AND h.units > 0), '[]'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_my_holdings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_my_holdings() TO authenticated;

CREATE OR REPLACE FUNCTION public.ican_sector_my_fills(p_limit INT DEFAULT 50, p_before TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE v_uid UUID := auth.uid(); v_n INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  RETURN jsonb_build_object('success', true, 'fills', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
      FROM (SELECT f.id, f.created_at, f.sector, f.side, f.units, f.price_icec, f.gross_icec, f.fee_icec, f.net_icec,
                   f.cost_basis_icec, f.pay_currency, f.pay_amount
              FROM icanera_trading.sector_fills f
             WHERE f.user_id = v_uid AND (p_before IS NULL OR f.created_at < p_before)
             ORDER BY f.created_at DESC LIMIT v_n) x), '[]'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_my_fills(INT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_my_fills(INT, TIMESTAMPTZ) TO authenticated;


-- 3. The developer panel: the same token check every ican_dev_* function uses.

-- Everything an operator needs to see at a glance.
CREATE OR REPLACE FUNCTION public.ican_sector_dev_overview(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  s       icanera_trading.sector_settings;
  v_vault NUMERIC;
  v_expo  NUMERIC;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  PERFORM icanera_trading.fold_sector_indices(FALSE, FALSE);
  SELECT * INTO s FROM icanera_trading.sector_settings WHERE id;
  v_vault := icanera_trading.vault_balance();
  v_expo  := icanera_trading.exposure_icec();
  RETURN jsonb_build_object(
    'settings', to_jsonb(s),
    'vault', jsonb_build_object(
      'balance_icec', v_vault, 'exposure_icec', v_expo,
      'cover_ratio', CASE WHEN v_expo > 0 THEN round(v_vault / v_expo, 4) END,
      'required_ratio', 1 + s.stress_pct / 100),
    'sectors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ticker', k.ticker, 'name', k.name, 'enabled', k.enabled, 'admin_halted', k.admin_halted,
               'status', COALESCE(c.status, 'warming_up'), 'contributors', COALESCE(c.contributors, 0),
               'level', c.level, 'price_icec', c.price_icec, 'computed_at', c.computed_at,
               'units_held', icanera_trading.sector_exposure_units(k.ticker)) ORDER BY k.sort_order)
        FROM icanera_trading.sector_catalog k LEFT JOIN icanera_trading.sector_index_cache c ON c.ticker = k.ticker), '[]'::JSONB),
    'industry_map', COALESCE((SELECT jsonb_agg(jsonb_build_object('industry', m.industry_value, 'ticker', m.ticker) ORDER BY m.ticker, m.industry_value)
                                FROM icanera_trading.sector_industry_map m), '[]'::JSONB),
    'outbox', jsonb_build_object(
      'unfolded', (SELECT count(*) FROM icanera_trading.telemetry_events WHERE folded_at IS NULL),
      'events_24h', (SELECT count(*) FROM icanera_trading.telemetry_events WHERE event_time > now() - INTERVAL '24 hours'),
      'businesses_accepted', (SELECT count(*) FROM icanera_trading.data_terms_acceptance a WHERE a.terms_version = s.current_terms_version)),
    'activity_24h', jsonb_build_object(
      'trades', (SELECT count(*) FROM icanera_trading.sector_fills WHERE created_at > now() - INTERVAL '24 hours'),
      'volume_icec', COALESCE((SELECT sum(gross_icec) FROM icanera_trading.sector_fills WHERE created_at > now() - INTERVAL '24 hours'), 0),
      'fees_icec', COALESCE((SELECT sum(fee_icec) FROM icanera_trading.sector_fills WHERE created_at > now() - INTERVAL '24 hours'), 0)),
    'folded_at', (SELECT folded_at FROM icanera_trading.fold_state WHERE id),
    'feed_version', (SELECT feed_version FROM icanera_trading.fold_state WHERE id)
  );
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_overview(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_overview(TEXT) TO authenticated;

-- Change settings. Only the keys listed here are accepted; every value is checked by the table's own constraints.
CREATE OR REPLACE FUNCTION public.ican_sector_dev_set_settings(dev_token TEXT, p_changes JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  v_allowed CONSTANT TEXT[] := ARRAY['trading_enabled','fee_bps','max_trades_per_minute','max_trade_icec','max_position_icec','stress_pct',
    'k_min','window_hours','contributor_cap_multiple','ema_minutes','max_move_pct_per_hour','stale_s','current_terms_version'];
  v_bad TEXT;
  s     icanera_trading.sector_settings;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN RAISE EXCEPTION 'p_changes must be an object' USING ERRCODE = '22023'; END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k WHERE k <> ALL (v_allowed) LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'unknown setting: %', v_bad USING ERRCODE = '22023'; END IF;
  IF p_changes ? 'current_terms_version'
     AND NOT EXISTS (SELECT 1 FROM icanera_trading.data_terms_text t WHERE t.version = (p_changes ->> 'current_terms_version')::INT) THEN
    RAISE EXCEPTION 'add the wording for that terms version to icanera_trading.data_terms_text first' USING ERRCODE = '22023';
  END IF;

  UPDATE icanera_trading.sector_settings SET
    trading_enabled          = COALESCE((p_changes ->> 'trading_enabled')::BOOLEAN,          trading_enabled),
    fee_bps                  = COALESCE((p_changes ->> 'fee_bps')::INT,                      fee_bps),
    max_trades_per_minute    = COALESCE((p_changes ->> 'max_trades_per_minute')::INT,        max_trades_per_minute),
    max_trade_icec           = COALESCE((p_changes ->> 'max_trade_icec')::NUMERIC,           max_trade_icec),
    max_position_icec        = COALESCE((p_changes ->> 'max_position_icec')::NUMERIC,        max_position_icec),
    stress_pct               = COALESCE((p_changes ->> 'stress_pct')::NUMERIC,               stress_pct),
    k_min                    = COALESCE((p_changes ->> 'k_min')::INT,                        k_min),
    window_hours             = COALESCE((p_changes ->> 'window_hours')::INT,                 window_hours),
    contributor_cap_multiple = COALESCE((p_changes ->> 'contributor_cap_multiple')::NUMERIC, contributor_cap_multiple),
    ema_minutes              = COALESCE((p_changes ->> 'ema_minutes')::NUMERIC,              ema_minutes),
    max_move_pct_per_hour    = COALESCE((p_changes ->> 'max_move_pct_per_hour')::NUMERIC,    max_move_pct_per_hour),
    stale_s                  = COALESCE((p_changes ->> 'stale_s')::INT,                      stale_s),
    current_terms_version    = COALESCE((p_changes ->> 'current_terms_version')::INT,        current_terms_version)
  WHERE id RETURNING * INTO s;

  -- viewers re-read the feed (trading_enabled and fee are part of it) and the indices pick the new maths up now
  UPDATE icanera_trading.fold_state SET feed_version = feed_version + 1 WHERE id;
  PERFORM icanera_trading.fold_sector_indices(TRUE, TRUE);
  RETURN to_jsonb(s);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_set_settings(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_set_settings(TEXT, JSONB) TO authenticated;

-- Show/hide or halt one sector.
CREATE OR REPLACE FUNCTION public.ican_sector_dev_set_sector(
  dev_token TEXT, p_ticker TEXT, p_enabled BOOLEAN DEFAULT NULL, p_halted BOOLEAN DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE k icanera_trading.sector_catalog;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE icanera_trading.sector_catalog
     SET enabled = COALESCE(p_enabled, enabled), admin_halted = COALESCE(p_halted, admin_halted)
   WHERE ticker = p_ticker RETURNING * INTO k;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown sector: %', p_ticker USING ERRCODE = '22023'; END IF;
  UPDATE icanera_trading.fold_state SET feed_version = feed_version + 1 WHERE id;
  PERFORM icanera_trading.fold_sector_indices(TRUE, TRUE);
  RETURN to_jsonb(k);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_set_sector(TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_set_sector(TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

-- Map a business category to a sector (p_ticker NULL removes the mapping).
CREATE OR REPLACE FUNCTION public.ican_sector_dev_map_industry(dev_token TEXT, p_industry TEXT, p_ticker TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE v_key TEXT := lower(btrim(COALESCE(p_industry, '')));
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF v_key = '' THEN RAISE EXCEPTION 'industry is required' USING ERRCODE = '22023'; END IF;
  IF p_ticker IS NULL THEN
    DELETE FROM icanera_trading.sector_industry_map WHERE industry_value = v_key;
  ELSE
    INSERT INTO icanera_trading.sector_industry_map (industry_value, ticker) VALUES (v_key, p_ticker)
    ON CONFLICT (industry_value) DO UPDATE SET ticker = EXCLUDED.ticker;
  END IF;
  RETURN jsonb_build_object('industry', v_key, 'ticker', p_ticker);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_map_industry(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_map_industry(TEXT, TEXT, TEXT) TO authenticated;

-- Put ICEC into the vault (positive) or take surplus out (negative). A withdrawal may never leave the vault
-- below what it needs to cover users under the stress margin. Every movement is a permanent ledger entry
-- with the reason given.
CREATE OR REPLACE FUNCTION public.ican_sector_dev_vault_adjust(dev_token TEXT, p_amount NUMERIC, p_memo TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  s       icanera_trading.sector_settings;
  v_vault NUMERIC;
  v_expo  NUMERIC;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_amount IS NULL OR p_amount = 0 OR p_amount = 'NaN'::NUMERIC OR abs(p_amount) > 1000000000000 THEN
    RAISE EXCEPTION 'amount must be a non-zero number' USING ERRCODE = '22023';
  END IF;
  IF p_memo IS NULL OR char_length(btrim(p_memo)) < 3 THEN RAISE EXCEPTION 'say why in the memo' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('icanera_vault_adjust', 0));    -- one adjustment at a time
  SELECT * INTO s FROM icanera_trading.sector_settings WHERE id;
  v_vault := icanera_trading.vault_balance();
  v_expo  := icanera_trading.exposure_icec();
  IF p_amount < 0 AND v_vault + p_amount < v_expo * (1 + s.stress_pct / 100) THEN
    RAISE EXCEPTION 'that would leave the vault (%) below what users hold (%) plus the % %% stress margin',
      v_vault + p_amount, v_expo, s.stress_pct USING ERRCODE = '22023';
  END IF;
  INSERT INTO icanera_trading.vault_entries (kind, amount, memo)
  VALUES (CASE WHEN p_amount > 0 THEN 'funding' ELSE 'adjustment' END, p_amount, left(btrim(p_memo), 300));
  RETURN jsonb_build_object('success', true, 'balance_icec', icanera_trading.vault_balance());
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_vault_adjust(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_vault_adjust(TEXT, NUMERIC, TEXT) TO authenticated;

-- The books must balance. Everything here is recomputed from the immutable ledgers and compared with the caches.
CREATE OR REPLACE FUNCTION public.ican_sector_dev_reconcile(dev_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  v_cached NUMERIC; v_sum NUMERIC; v_bad JSONB; v_neg BIGINT; v_fills_bad BIGINT;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT icanera_trading.vault_balance(), COALESCE((SELECT SUM(amount) FROM icanera_trading.vault_entries), 0) INTO v_cached, v_sum;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('sector', x.sector, 'cached_units', x.cached, 'holdings_units', x.held)), '[]'::JSONB) INTO v_bad
    FROM (SELECT k.ticker AS sector, icanera_trading.sector_exposure_units(k.ticker) AS cached,
                 COALESCE((SELECT SUM(h.units) FROM icanera_trading.sector_holdings h WHERE h.sector = k.ticker), 0) AS held
            FROM icanera_trading.sector_catalog k) x
   WHERE x.cached <> x.held;
  SELECT count(*) INTO v_neg FROM icanera_trading.sector_holdings WHERE units < 0 OR cost_icec < 0;
  -- every fill has the vault entries it should: buys +net (+fee), sells -gross (+fee)
  SELECT count(*) INTO v_fills_bad
    FROM icanera_trading.sector_fills f
   WHERE (SELECT COALESCE(SUM(e.amount), 0) FROM icanera_trading.vault_entries e WHERE e.fill_id = f.id)
         <> CASE f.side WHEN 'buy' THEN f.net_icec + f.fee_icec ELSE -f.net_icec END;
  RETURN jsonb_build_object(
    'ok', v_cached = v_sum AND v_bad = '[]'::JSONB AND v_neg = 0 AND v_fills_bad = 0,
    'vault_balance', v_cached, 'vault_ledger_sum', v_sum, 'vault_matches', v_cached = v_sum,
    'units_mismatches', v_bad, 'negative_holdings', v_neg, 'fills_without_matching_vault_entries', v_fills_bad);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_dev_reconcile(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_dev_reconcile(TEXT) TO authenticated;


-- 4. Old idempotency records are only needed while a client might still retry.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('icanera-sector-prune-requests', '29 3 * * *',
      $job$DELETE FROM icanera_trading.trade_requests WHERE created_at < now() - INTERVAL '30 days'$job$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'sector trading: could not schedule the nightly prune (%): old trade requests will just stay.', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
