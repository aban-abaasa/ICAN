\set ON_ERROR_STOP on
-- One shop sale and every row it wrote, so a test can check that the total, the tax, the receipt, the transaction and the line
-- items all say the same thing. Products: t.u(201) UGX 10,000 with 18% tax, t.u(202) UGX 10,000 with no tax.
--   p_lines  [{"product_id": ..., "quantity": ...}]
--   p_ican   TRUE = paid from the IcanEra wallet (then 'debit' is what left it, in ICAN)
CREATE FUNCTION t.shop(p_n INT, p_lines JSONB, p_ican BOOLEAN DEFAULT FALSE, p_fund NUMERIC DEFAULT 1000) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_res JSONB; v_tx public.transactions; v_rc public.receipts; v_items JSONB;
BEGIN
  INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (t.u(1000 + p_n), p_fund)
    ON CONFLICT (user_id) DO UPDATE SET ican_balance = EXCLUDED.ican_balance, total_spent = 0;
  PERFORM t.login(1000 + p_n);
  BEGIN
    v_res := public.customer_self_checkout(p_lines, CASE WHEN p_ican THEN 'ican' ELSE 'cash' END, p_ican, 'Main');
    SELECT * INTO v_tx FROM public.transactions WHERE id = (v_res ->> 'transaction_id')::UUID;
    SELECT * INTO v_rc FROM public.receipts WHERE id = (v_res ->> 'receipt_id')::UUID;
    SELECT jsonb_build_object('lines', count(*), 'line_total', sum(line_total), 'tax', sum(tax_amount))
      INTO v_items FROM public.sales_transaction_items WHERE transaction_id = v_tx.id;
    RETURN jsonb_build_object('ok', true, 'res', v_res, 'tx', to_jsonb(v_tx), 'receipt', to_jsonb(v_rc), 'items', v_items,
                              'debit', p_fund - t.userbal(t.u(1000 + p_n)));
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;
END $$;
GRANT EXECUTE ON FUNCTION t.shop(INT, JSONB, BOOLEAN, NUMERIC) TO PUBLIC;
CREATE FUNCTION t.cart(p_a UUID, p_qa INT, p_b UUID DEFAULT NULL, p_qb INT DEFAULT NULL) RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('product_id', p_a, 'quantity', p_qa))
         || CASE WHEN p_b IS NULL THEN '[]'::JSONB ELSE jsonb_build_array(jsonb_build_object('product_id', p_b, 'quantity', p_qb)) END $$;
GRANT EXECUTE ON FUNCTION t.cart(UUID, INT, UUID, INT) TO PUBLIC;
