-- Rolls back 20261109100000_sale_fees_dev_panel.sql
--
-- The dev panel can no longer change the sale fees (the SQL editor still can). The rates themselves stay exactly as they are,
-- and the record of who changed what is KEPT (it is the only history of those changes). Safe to run twice.

DROP FUNCTION IF EXISTS public.ican_dev_set_sale_fee(TEXT, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.ican_dev_get_sale_fees(TEXT);

NOTIFY pgrst, 'reload schema';
