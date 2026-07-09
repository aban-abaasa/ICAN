-- ============================================================
-- DEV PANEL: grant float directly to an agent
-- Run once in Supabase SQL editor (safe to re-run)
--
-- Lets a developer credit an agent's cash float for a given currency
-- straight from the dev panel, bypassing the MOMO top-up request flow
-- (agentService.js's processFloatTopUp/confirmFloatTopUp) — useful for
-- onboarding a new agent or covering a shortfall without waiting on a
-- real MOMO payment.
--
-- Targets agent_floats.current_balance — the real column. A separate
-- dev-panel function (ican_dev_get_agents) once referenced a column
-- named float_balance that never existed on this table; that name only
-- ever existed as an *output alias* summing current_balance across
-- currencies. See AGENT_SYSTEM_SCHEMA.sql / FIX_AGENT_TRANSACTIONS_TABLE.sql
-- for the authoritative CREATE TABLE (UNIQUE(agent_id, currency)).
-- ============================================================

DROP FUNCTION IF EXISTS public.ican_dev_grant_float(text, uuid, text, numeric, text);

CREATE OR REPLACE FUNCTION public.ican_dev_grant_float(
  dev_token TEXT,
  p_agent_id UUID,
  p_currency TEXT,
  p_amount NUMERIC,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE (success boolean, message text, new_balance numeric)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT false, 'Amount must be greater than zero'::text, NULL::numeric;
    RETURN;
  END IF;

  IF p_currency IS NULL OR p_currency = '' THEN
    RETURN QUERY SELECT false, 'Currency is required'::text, NULL::numeric;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE id = p_agent_id) THEN
    RETURN QUERY SELECT false, 'Agent not found'::text, NULL::numeric;
    RETURN;
  END IF;

  INSERT INTO public.agent_floats (agent_id, currency, current_balance, total_deposited, updated_at)
  VALUES (p_agent_id, p_currency, p_amount, p_amount, now())
  ON CONFLICT (agent_id, currency) DO UPDATE
    SET current_balance = public.agent_floats.current_balance + EXCLUDED.current_balance,
        total_deposited = COALESCE(public.agent_floats.total_deposited, 0) + EXCLUDED.current_balance,
        updated_at = now()
  RETURNING current_balance INTO v_new_balance;

  -- Best-effort audit trail — agent_transactions may have constraints this
  -- function doesn't know about (e.g. a transaction_type CHECK), so a
  -- failure here must not undo the float grant itself.
  BEGIN
    INSERT INTO public.agent_transactions (agent_id, transaction_type, amount, currency, reference_number, status, metadata)
    VALUES (
      p_agent_id, 'dev_float_grant', p_amount, p_currency,
      'DEVGRANT-' || extract(epoch FROM now())::bigint,
      'completed',
      jsonb_build_object('granted_by', 'dev_panel', 'note', p_note)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN QUERY SELECT true, 'Float granted'::text, v_new_balance;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error: ' || SQLERRM, NULL::numeric;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ican_dev_grant_float(TEXT, UUID, TEXT, NUMERIC, TEXT) TO anon, authenticated;

SELECT 'ican_dev_grant_float installed — developers can now credit agent float directly from the dev panel.' AS status;
