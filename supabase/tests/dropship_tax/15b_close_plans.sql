\set ON_ERROR_STOP on
SET client_min_messages = info;
-- The rollback was refused while a plan started under the new maths was open: nothing may have changed. Then the plan finishes.
DO $t$
BEGIN
  PERFORM t.check('rollback refused: dropship_checkout is still tax-included', t.fn_text('public._inst_record_sale(uuid,text,text)') <> (SELECT v FROM t.keep WHERE k = 'txt_sale')
    AND position('tax_inclusive' IN pg_get_functiondef('public._inst_record_sale(uuid,text,text)'::regprocedure)) > 0);
  PERFORM t.check('rollback refused: an older plan (tax on top) never blocks it',
    (SELECT count(*) FROM public.installment_plans WHERE status NOT IN ('completed', 'cancelled', 'lapsed') AND dropship_order_id IS NULL) = 2);
  UPDATE public.installment_plans SET status = 'completed';
END $t$;
