-- ============================================================
-- Every store website can take payments (its Pay tab)
-- ============================================================
-- A business website's Pay tab -- and so "tap a product on the Market tab to pay for it" -- only
-- exists when the business has an active public_tx_paycodes row, which until now an owner had to
-- create by hand. Stores got a website automatically (20261013110000) but no pay code, so their
-- Market products could not be paid for on the site.
--
-- fn_ensure_store_website now also makes sure the store's business has a pay code: one per business
-- (the table's unique index), owned by the business's own user, with the table's defaults
-- (active, owner approval required, up to UGX 5,000,000 at once). An existing pay code is left
-- exactly as the owner set it, including switched off. Runs for every existing store below, and
-- from the supermarkets trigger for new ones. Safe to run more than once.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_ensure_store_website(p_supermarket_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID;
  v_store_name  TEXT;
  v_company_id  UUID;
  v_owner_id    UUID;
BEGIN
  SELECT s.name,
         COALESCE(s.pichin_business_profile_id,
                  (SELECT bp.id FROM public.business_profiles bp WHERE bp.supermarket_id = s.id LIMIT 1))
    INTO v_store_name, v_business_id
  FROM public.supermarkets s
  WHERE s.id = p_supermarket_id;

  IF v_business_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- The business already has a website: that is the store's website.
  SELECT cp.id INTO v_company_id
  FROM public.cmms_company_profiles cp
  WHERE cp.business_profile_id = v_business_id
  ORDER BY cp.updated_at DESC NULLS LAST
  LIMIT 1;

  v_store_name := COALESCE(
    NULLIF(btrim(v_store_name), ''),
    (SELECT NULLIF(btrim(bp.business_name), '') FROM public.business_profiles bp WHERE bp.id = v_business_id),
    'Store');

  IF v_company_id IS NULL THEN
    INSERT INTO public.cmms_company_profiles
      (company_name, company_registration, business_profile_id, supermarket_id, site_products_source)
    VALUES
      (v_store_name, 'STORE-' || substr(p_supermarket_id::text, 1, 8), v_business_id, p_supermarket_id, 'both')
    RETURNING id INTO v_company_id;
  END IF;

  -- The Pay tab: one pay code per business, created only when there is none (never re-activates one an owner switched off).
  SELECT bp.user_id INTO v_owner_id FROM public.business_profiles bp WHERE bp.id = v_business_id;
  IF v_owner_id IS NOT NULL THEN
    INSERT INTO public.public_tx_paycodes (user_id, business_profile_id, title)
    VALUES (v_owner_id, v_business_id, left(v_store_name, 80))
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ensure_store_website(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ensure_store_website(UUID) TO service_role;

-- Backfill: every existing store (website and pay code if missing).
SELECT public.fn_ensure_store_website(s.id)
FROM public.supermarkets s
WHERE COALESCE(s.is_active, TRUE);

NOTIFY pgrst, 'reload schema';

SELECT 'Every store website now has a Pay tab' AS status;
