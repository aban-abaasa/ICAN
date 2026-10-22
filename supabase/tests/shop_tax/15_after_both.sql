\set ON_ERROR_STOP on
SET client_min_messages = info;
-- tax-included AND the sale fees (in whichever order they were run): the customer pays the shelf price, the store pays the 1%.
DO $t$
DECLARE s JSONB;
BEGIN
  s := t.shop(30, t.cart(t.u(201), 3), TRUE, 6.0);
  PERFORM t.check('F1 a customer holding exactly the shelf price (6 ICAN) pays it: total UGX 30,000, nothing added for tax or for ICANera',
    (s ->> 'ok')::BOOLEAN AND (s -> 'res' ->> 'total_ugx')::NUMERIC = 30000 AND (s ->> 'debit')::NUMERIC = 6.0, s::TEXT);
  PERFORM t.check('F2 the receipt still carries the tax inside the price', (s -> 'receipt' ->> 'tax_amount')::NUMERIC = 4576.27 AND (s -> 'items' ->> 'tax')::NUMERIC = 4576.27, s::TEXT);
  PERFORM t.check('F3 the fee comes out of the store: 5.94 to the store, 0.06 to ICANera',
    EXISTS (SELECT 1 FROM public.ican_coin_transactions WHERE sender_user_id = t.u(1030) AND receiver_user_id = t.u(101) AND ican_amount = 5.94)
    AND EXISTS (SELECT 1 FROM public.platform_fee_log WHERE amount_ican = 0.06 AND reference LIKE 'checkout-platform-fee:SCO\_%'));
END $t$;
