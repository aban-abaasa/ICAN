-- Rolls back 20261111100000_zone_gate_from_card_page.sql
--
-- Drops the two functions that let the public rider-card page run the gate (mbg_my_gate_zones, mbg_zone_gate_peek). Nothing else
-- changes: the gate desk in ICAN CMMS keeps working, and the card page goes back to being a plain public check. No data is touched.
-- Safe to run twice.

DROP FUNCTION IF EXISTS public.mbg_my_gate_zones();
DROP FUNCTION IF EXISTS public.mbg_zone_gate_peek(UUID, TEXT);

NOTIFY pgrst, 'reload schema';
