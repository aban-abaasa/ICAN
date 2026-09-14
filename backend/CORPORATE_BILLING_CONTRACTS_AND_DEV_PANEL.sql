-- ============================================================================
-- CORPORATE_BILLING_CONTRACTS_AND_DEV_PANEL.sql
-- ============================================================================
-- Purpose:
--   1. Let a business owner read their own corporate subscription's billing
--      history (for a real "Billing" page — not just current status).
--   2. Let anyone (101+ employees, or just wanting a custom deal) submit a
--      "Request a contract" lead — a public form, no ICAN account required,
--      same shape as the landing page's contact form. This does NOT create
--      a subscription; it's a sales lead that the dev panel triages.
--   3. Widen ican_corporate_subscriptions.tier to allow 'contract', so a
--      dev, once a deal is negotiated, can provision that business a real
--      subscription row that flows through the exact same billing engine
--      (fn_run_corporate_billing_cycle) as self-serve Team/Business/Corporate
--      plans — no separate contract-billing system to maintain.
--   4. Give the dev panel (token-gated, same pattern as every other
--      ican_dev_* function — see PIN_RECOVERY_AND_ACCOUNT_UNLOCK.sql) the
--      ability to: see every corporate subscription and its wallet balance,
--      manually trigger the billing sweep, and triage/resolve contract
--      requests by provisioning a negotiated subscription.
--
-- Run after CORPORATE_SUBSCRIPTION_TRIAL_AND_ICAN_BILLING.sql.
-- Safe to re-run. Additive only.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Allow 'contract' as a real tier value
-- ------------------------------------------------------------
ALTER TABLE public.ican_corporate_subscriptions
  DROP CONSTRAINT IF EXISTS ican_corporate_subscriptions_tier_check;
ALTER TABLE public.ican_corporate_subscriptions
  ADD CONSTRAINT ican_corporate_subscriptions_tier_check
  CHECK (tier IN ('team', 'business', 'corporate', 'contract'));

-- ------------------------------------------------------------
-- 2. Billing history for the business's own Billing page
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_get_my_corporate_subscription_charges(
  p_business_profile_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS SETOF public.ican_corporate_subscription_charges
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.pitchin_business_shareholder_access(p_business_profile_id) THEN
    RAISE EXCEPTION 'You do not have access to this business profile';
  END IF;

  RETURN QUERY SELECT * FROM public.ican_corporate_subscription_charges
    WHERE business_profile_id = p_business_profile_id
    ORDER BY created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_my_corporate_subscription_charges(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_my_corporate_subscription_charges(UUID, INTEGER) TO authenticated;

-- ------------------------------------------------------------
-- 3. Public "Request a contract" lead form — no ICAN account required,
--    same trust level as the landing page's contact form
--    (createLandingMessage in landingMessagesService.js). This is a lead,
--    not a subscription: nothing is billed and no wallet is touched.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_corporate_contract_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  company_name        TEXT NOT NULL,
  contact_name        TEXT NOT NULL,
  contact_email       TEXT NOT NULL,
  contact_phone       TEXT,
  employee_count      INTEGER NOT NULL CHECK (employee_count > 0),
  message             TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'contacted', 'closed', 'declined')),
  notes               TEXT,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ican_contract_requests_status
  ON public.ican_corporate_contract_requests (status, created_at DESC);

ALTER TABLE public.ican_corporate_contract_requests ENABLE ROW LEVEL SECURITY;
-- No public SELECT policy: requests are write-only from the public form,
-- read back exclusively through the dev-panel functions below.

CREATE OR REPLACE FUNCTION public.fn_request_corporate_contract(
  p_company_name TEXT,
  p_contact_name TEXT,
  p_contact_email TEXT,
  p_contact_phone TEXT,
  p_employee_count INTEGER,
  p_message TEXT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, request_id UUID, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF COALESCE(TRIM(p_company_name), '') = '' OR COALESCE(TRIM(p_contact_name), '') = ''
     OR COALESCE(TRIM(p_contact_email), '') = '' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Company name, contact name and email are required'::TEXT;
    RETURN;
  END IF;

  IF p_employee_count IS NULL OR p_employee_count <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Employee count must be greater than 0'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.ican_corporate_contract_requests (
    company_name, contact_name, contact_email, contact_phone, employee_count, message
  ) VALUES (
    TRIM(p_company_name), TRIM(p_contact_name), TRIM(p_contact_email), NULLIF(TRIM(p_contact_phone), ''),
    p_employee_count, p_message
  ) RETURNING id INTO v_id;

  RETURN QUERY SELECT TRUE, v_id,
    'Request received. The IcanEra team will reach out to discuss pricing for your team.'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_request_corporate_contract(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_request_corporate_contract(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 4. Dev panel: see every corporate subscription + its wallet balance
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_dev_get_corporate_subscriptions(dev_token TEXT)
RETURNS TABLE (
  id UUID, business_profile_id UUID, business_name TEXT, tier TEXT,
  employee_count INTEGER, monthly_price_ic NUMERIC, storage_mb INTEGER,
  status TEXT, trial_ends_at TIMESTAMPTZ, next_billing_at TIMESTAMPTZ,
  past_due_since TIMESTAMPTZ, wallet_balance_ic NUMERIC, created_at TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  RETURN QUERY
  -- bp.business_name is VARCHAR(255) in business_profiles — cast to TEXT so
  -- it matches this function's declared RETURNS TABLE column type exactly
  -- (RETURN QUERY errors with "structure of query does not match function
  -- result type" otherwise, since varchar and text are distinct base types).
  SELECT s.id, s.business_profile_id, bp.business_name::TEXT, s.tier,
         s.employee_count, s.monthly_price_ic, s.storage_mb,
         s.status, s.trial_ends_at, s.next_billing_at,
         s.past_due_since, w.ican_balance, s.created_at
  FROM public.ican_corporate_subscriptions s
  LEFT JOIN public.business_profiles bp ON bp.id = s.business_profile_id
  LEFT JOIN public.ican_business_wallets w ON w.business_profile_id = s.business_profile_id
  ORDER BY s.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.ican_dev_get_corporate_subscriptions(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_corporate_subscriptions(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. Dev panel: manually trigger the billing sweep (also runnable on a
--    schedule — see fn_run_corporate_billing_cycle's own comment).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_dev_run_corporate_billing_cycle(dev_token TEXT)
RETURNS TABLE (business_profile_id UUID, outcome TEXT)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY SELECT * FROM public.fn_run_corporate_billing_cycle();
END;
$$;

REVOKE ALL ON FUNCTION public.ican_dev_run_corporate_billing_cycle(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_run_corporate_billing_cycle(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 6. Dev panel: triage contract requests
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_dev_list_contract_requests(dev_token TEXT)
RETURNS SETOF public.ican_corporate_contract_requests
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY SELECT * FROM public.ican_corporate_contract_requests ORDER BY
    CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.ican_dev_list_contract_requests(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_list_contract_requests(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.ican_dev_resolve_contract_request(
  dev_token TEXT, p_request_id UUID, p_status TEXT, p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, message TEXT)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_status NOT IN ('contacted', 'closed', 'declined') THEN
    RETURN QUERY SELECT FALSE, 'Invalid status'::TEXT;
    RETURN;
  END IF;

  UPDATE public.ican_corporate_contract_requests
     SET status = p_status,
         notes = COALESCE(p_notes, notes),
         resolved_at = CASE WHEN p_status IN ('closed', 'declined') THEN now() ELSE resolved_at END
   WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Request not found'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, 'Updated'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.ican_dev_resolve_contract_request(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_resolve_contract_request(TEXT, UUID, TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 7. Dev panel: provision the negotiated plan once a contract is closed.
--    Feeds straight into the same fn_run_corporate_billing_cycle() every
--    self-serve tier uses — a Contract-tier subscription is billed exactly
--    like a Team/Business/Corporate one, just with a custom price.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_dev_provision_contract_subscription(
  dev_token TEXT,
  p_business_profile_id UUID,
  p_monthly_price_ic NUMERIC,
  p_employee_count INTEGER,
  p_storage_mb INTEGER,
  p_contract_request_id UUID DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, subscription_id UUID, message TEXT)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_existing public.ican_corporate_subscriptions;
  v_new public.ican_corporate_subscriptions;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_monthly_price_ic IS NULL OR p_monthly_price_ic <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Negotiated price must be greater than 0'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM public.ican_corporate_subscriptions
  WHERE business_profile_id = p_business_profile_id;

  IF v_existing.id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, v_existing.id,
      ('This business already has a subscription (' || v_existing.status || ', ' || v_existing.tier ||
       '). Update it directly instead of provisioning a new one.')::TEXT;
    RETURN;
  END IF;

  -- Negotiated contracts skip the self-serve free trial — billing starts
  -- immediately since the price was already agreed with sales.
  INSERT INTO public.ican_corporate_subscriptions (
    business_profile_id, tier, employee_count, monthly_price_ic, storage_mb,
    status, trial_ends_at, next_billing_at
  ) VALUES (
    p_business_profile_id, 'contract', p_employee_count, p_monthly_price_ic, p_storage_mb,
    'active', now(), now() + INTERVAL '1 month'
  ) RETURNING * INTO v_new;

  IF p_contract_request_id IS NOT NULL THEN
    UPDATE public.ican_corporate_contract_requests
       SET status = 'closed', resolved_at = now(), business_profile_id = p_business_profile_id
     WHERE id = p_contract_request_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_new.id,
    ('Contract plan provisioned at ' || p_monthly_price_ic || ' IC/month. First charge due ' ||
     to_char(v_new.next_billing_at, 'DD Mon YYYY') || '.')::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.ican_dev_provision_contract_subscription(TEXT, UUID, NUMERIC, INTEGER, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_provision_contract_subscription(TEXT, UUID, NUMERIC, INTEGER, INTEGER, UUID) TO anon, authenticated;

-- ============================================================================
-- VERIFY
-- ============================================================================
-- SELECT * FROM public.ican_dev_get_corporate_subscriptions('dev_ICAN_Pr0_KV25');
-- SELECT * FROM public.ican_dev_list_contract_requests('dev_ICAN_Pr0_KV25');
-- SELECT * FROM public.fn_request_corporate_contract('Acme Ltd', 'Jane Doe', 'jane@acme.com', NULL, 250, 'Need 250 seats');
-- ============================================================================
-- END
-- ============================================================================
