\set ON_ERROR_STOP on
SET client_min_messages = info;
-- AFTER the migration: the panel's two functions, who may call them, and that a change reaches the checkouts.
SELECT public.ican_dev_secret() AS tok \gset
INSERT INTO t.keep VALUES ('token', :'tok');

DO $t$
DECLARE tok TEXT := (SELECT v FROM t.keep WHERE k = 'token'); g JSONB; r JSONB; d JSONB; s JSONB; n INT;
BEGIN
  -- ── 1. what the panel shows ──────────────────────────────────────────────────────
  PERFORM t.as_email('icaneraera@gmail.com');
  g := public.ican_dev_get_sale_fees(tok);
  PERFORM t.check('1.1 the panel lists exactly the two sale fees, dropship first, at their defaults',
    jsonb_array_length(g -> 'fees') = 2 AND g -> 'fees' -> 0 ->> 'key' = 'dropship_sale' AND (g -> 'fees' -> 0 ->> 'rate')::NUMERIC = 0.02
    AND g -> 'fees' -> 1 ->> 'key' = 'store_sale' AND (g -> 'fees' -> 1 ->> 'rate')::NUMERIC = 0.01 AND (g -> 'fees' -> 0 ->> 'default_rate')::NUMERIC = 0.02, g::TEXT);
  PERFORM t.check('1.2 the wallet fees are not offered here', NOT (g::TEXT LIKE '%send_bank%' OR g::TEXT LIKE '%coin_cash_out%'));
  PERFORM t.check('1.3 nothing changed yet', g -> 'changes' = '[]'::JSONB);

  -- ── 2. change the dropship fee to 2.5% ────────────────────────────────────────────
  r := public.ican_dev_set_sale_fee(tok, 'dropship_sale', 0.025);
  PERFORM t.check('2.1 the change is accepted and says what it replaced', (r ->> 'success')::BOOLEAN AND (r ->> 'changed')::BOOLEAN
    AND (r ->> 'old_rate')::NUMERIC = 0.02 AND (r ->> 'rate')::NUMERIC = 0.025, r::TEXT);
  PERFORM t.as_admin();
  PERFORM t.check('2.2 it is the rate in the table the checkouts read', public.ican_fee_rate('dropship_sale') = 0.025);
  d := t.dropship(1, 12500);
  PERFORM t.check('2.3 the NEXT dropship sale is charged at 2.5%: ICANera 737.50, reseller 4,262.50, customer still 7.1 ICAN',
    (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 737.50 AND (d -> 'order' ->> 'reseller_margin_amount')::NUMERIC = 4262.50 AND (d ->> 'debit')::NUMERIC = 7.1, d::TEXT);

  -- ── 3. change the store fee to 1.25% (a rate with a fraction of a percent) ───────
  PERFORM t.as_email('icaneraera@gmail.com');
  r := public.ican_dev_set_sale_fee(tok, 'store_sale', 0.0125);
  PERFORM t.check('3.1 1.25% is kept exactly', (r ->> 'success')::BOOLEAN AND (r ->> 'rate')::NUMERIC = 0.0125, r::TEXT);
  PERFORM t.as_admin();
  s := t.store_sale(2);
  PERFORM t.check('3.2 the NEXT shop sale is charged at 1.25%: ICANera 0.075 of 6 ICAN, the store gets 5.925, the customer still pays 6',
    (s ->> 'platform_got')::NUMERIC = 0.075 AND (s ->> 'store_got')::NUMERIC = 5.925 AND (s ->> 'debit')::NUMERIC = 6, s::TEXT);

  -- ── 4. the record ────────────────────────────────────────────────────────────────
  PERFORM t.as_email('icaneraera@gmail.com');
  g := public.ican_dev_get_sale_fees(tok);
  PERFORM t.check('4.1 both changes are on the record, newest first, with who made them',
    jsonb_array_length(g -> 'changes') = 2 AND g -> 'changes' -> 0 ->> 'key' = 'store_sale' AND (g -> 'changes' -> 0 ->> 'old_rate')::NUMERIC = 0.01
    AND (g -> 'changes' -> 0 ->> 'new_rate')::NUMERIC = 0.0125 AND g -> 'changes' -> 1 ->> 'key' = 'dropship_sale'
    AND g -> 'changes' -> 1 ->> 'changed_by' = 'icaneraera@gmail.com', (g -> 'changes')::TEXT);
  r := public.ican_dev_set_sale_fee(tok, 'dropship_sale', 0.025);
  PERFORM t.check('4.2 saving the same rate again changes nothing and adds nothing to the record',
    (r ->> 'success')::BOOLEAN AND NOT (r ->> 'changed')::BOOLEAN AND jsonb_array_length(public.ican_dev_get_sale_fees(tok) -> 'changes') = 2, r::TEXT);
  r := public.ican_dev_set_sale_fee(tok, 'dropship_sale', 0);
  PERFORM t.as_admin();
  d := t.dropship(3, 12500);
  PERFORM t.check('4.3 0% switches the dropship fee off: no fee leg, the reseller keeps the full 1.0 ICAN',
    (r ->> 'success')::BOOLEAN AND t.legs_for(d -> 'legs', t.u(130)) = 0 AND t.legs_total(d -> 'legs', t.u(120)) = 1.0, d::TEXT);

  -- ── 5. what is refused ───────────────────────────────────────────────────────────
  PERFORM t.as_admin();
  n := (SELECT count(*) FROM public.ican_fee_rate_changes);   -- 3 real changes so far (the API roles cannot read this table)
  PERFORM t.as_email('icaneraera@gmail.com');
  PERFORM t.check('5.1 100%, more than 100%, a negative rate and no rate are refused with a message',
    NOT (public.ican_dev_set_sale_fee(tok, 'dropship_sale', 1) ->> 'success')::BOOLEAN
    AND NOT (public.ican_dev_set_sale_fee(tok, 'dropship_sale', 1.5) ->> 'success')::BOOLEAN
    AND NOT (public.ican_dev_set_sale_fee(tok, 'dropship_sale', -0.01) ->> 'success')::BOOLEAN
    AND NOT (public.ican_dev_set_sale_fee(tok, 'dropship_sale', NULL) ->> 'success')::BOOLEAN
    AND public.ican_dev_set_sale_fee(tok, 'dropship_sale', 1) ->> 'error' LIKE 'A fee is a share%');
  PERFORM t.check('5.2 the wallet fees cannot be changed from here, nor a made-up one',
    NOT (public.ican_dev_set_sale_fee(tok, 'send_bank', 0) ->> 'success')::BOOLEAN
    AND NOT (public.ican_dev_set_sale_fee(tok, 'coin_cash_out', 0) ->> 'success')::BOOLEAN
    AND NOT (public.ican_dev_set_sale_fee(tok, 'whatever', 0.5) ->> 'success')::BOOLEAN);
  PERFORM t.as_admin();
  PERFORM t.check('5.3 and none of those touched a rate or the record',
    (SELECT rate FROM public.ican_fee_rates WHERE key = 'dropship_sale') = 0 AND (SELECT rate FROM public.ican_fee_rates WHERE key = 'send_bank') = 0.03
    AND (SELECT count(*) FROM public.ican_fee_rate_changes) = n AND n = 3);

  -- ── 6. a deleted row comes back ──────────────────────────────────────────────────
  DELETE FROM public.ican_fee_rates WHERE key = 'store_sale';
  PERFORM t.as_email('icaneraera@gmail.com');
  g := public.ican_dev_get_sale_fees(tok);
  PERFORM t.check('6.1 a deleted row shows as missing but with the default the checkouts fall back to (1%)',
    NOT (g -> 'fees' -> 1 ->> 'in_table')::BOOLEAN AND (g -> 'fees' -> 1 ->> 'rate')::NUMERIC = 0.01, (g -> 'fees')::TEXT);
  r := public.ican_dev_set_sale_fee(tok, 'store_sale', 0.02);
  PERFORM t.as_admin();
  PERFORM t.check('6.2 setting it puts the row back', (r ->> 'success')::BOOLEAN AND (SELECT rate FROM public.ican_fee_rates WHERE key = 'store_sale') = 0.02, r::TEXT);
  UPDATE public.ican_fee_rates SET rate = 0.02 WHERE key = 'dropship_sale';
END $t$;

-- ── 7. who may call ─────────────────────────────────────────────────────────────────
DO $t$
DECLARE tok TEXT := (SELECT v FROM t.keep WHERE k = 'token'); before_rates TEXT; before_n BIGINT; r JSONB;
BEGIN
  SELECT string_agg(key || '=' || rate, ',' ORDER BY key) INTO before_rates FROM public.ican_fee_rates;
  SELECT count(*) INTO before_n FROM public.ican_fee_rate_changes;

  PERFORM t.as_email('icaneraera@gmail.com');
  PERFORM t.check('7.1 the operator with a WRONG token is refused (read and change)',
    t.raises($q$ SELECT public.ican_dev_get_sale_fees('wrong') $q$) AND t.raises($q$ SELECT public.ican_dev_set_sale_fee('wrong', 'store_sale', 0) $q$)
    AND t.raises($q$ SELECT public.ican_dev_set_sale_fee(NULL, 'store_sale', 0) $q$));

  -- a support-console link visitor: signed in, holds the right dev token, but is not on the allowlist
  PERFORM t.as_email('support.visitor@example.com');
  PERFORM t.check('7.2 someone holding the RIGHT token but not on the operator allowlist (a support-link visitor) is refused, read and change',
    t.raises(format($q$ SELECT public.ican_dev_get_sale_fees(%L) $q$, tok)) AND t.raises(format($q$ SELECT public.ican_dev_set_sale_fee(%L, 'store_sale', 0) $q$, tok)));
  PERFORM t.as_email(NULL);
  PERFORM t.check('7.3 a signed-in session with no email is refused', t.raises(format($q$ SELECT public.ican_dev_set_sale_fee(%L, 'store_sale', 0) $q$, tok)));

  PERFORM t.as_anon();
  PERFORM t.check('7.4 a signed-out caller cannot even call them',
    t.raises(format($q$ SELECT public.ican_dev_get_sale_fees(%L) $q$, tok)) AND t.raises(format($q$ SELECT public.ican_dev_set_sale_fee(%L, 'store_sale', 0) $q$, tok)));

  PERFORM t.as_email('support.visitor@example.com');
  PERFORM t.check('7.5 nobody on the API can read the record or write a rate directly',
    t.raises($q$ SELECT * FROM public.ican_fee_rate_changes $q$) AND t.raises($q$ INSERT INTO public.ican_fee_rate_changes (key, old_rate, new_rate) VALUES ('x', 0, 0) $q$)
    AND t.raises($q$ UPDATE public.ican_fee_rates SET rate = 0 $q$) AND t.raises($q$ DELETE FROM public.ican_fee_rates $q$));
  PERFORM t.as_admin();
  PERFORM t.check('7.6 every refused attempt left every rate and the record exactly as they were',
    (SELECT string_agg(key || '=' || rate, ',' ORDER BY key) FROM public.ican_fee_rates) = before_rates
    AND (SELECT count(*) FROM public.ican_fee_rate_changes) = before_n, before_rates);

  PERFORM t.as_email('ICANERAERA@Gmail.com');
  r := public.ican_dev_set_sale_fee(tok, 'store_sale', 0.03);
  PERFORM t.as_admin();
  PERFORM t.check('7.7 the allowlist match ignores letter case, like the rest of the panel: a real change goes through and is recorded once',
    (r ->> 'success')::BOOLEAN AND (r ->> 'changed')::BOOLEAN AND public.ican_fee_rate('store_sale') = 0.03
    AND (SELECT count(*) FROM public.ican_fee_rate_changes) = before_n + 1, r::TEXT);
  UPDATE public.ican_fee_rates SET rate = 0.02 WHERE key = 'store_sale';
  DELETE FROM t.keep WHERE k = 'baseline_changes';
  INSERT INTO t.keep VALUES ('baseline_changes', (SELECT count(*) FROM public.ican_fee_rate_changes)::TEXT);
END $t$;
