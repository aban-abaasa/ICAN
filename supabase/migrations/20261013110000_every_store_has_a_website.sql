-- ============================================================
-- Every store has a business website, automatically
-- ============================================================
-- A store's public website is its cmms_company_profiles row (icanera.space/notices/<id>).
-- Only stores whose owner had set one up through CMMS had a row, so the others told
-- customers "this store doesn't have a website yet". This gives every store with a
-- business a minimal website row:
--
--   * fn_ensure_store_website(store)   creates it if missing (idempotent), returns its id
--   * a backfill below                 runs it for every existing store
--   * a trigger on supermarkets        runs it for each new store / newly linked business
--
-- The row is minimal on purpose: name, the business it belongs to, the store, and the
-- Market tab loading the store's own products ('both'). created_by_user_id is left empty:
-- it is a unique reference to a CMMS user, which a store website does not have. The owner can edit everything
-- else from CMMS afterwards. A business that already has a website row is never given
-- a second one. A store with no business profile cannot be given a website (the row
-- must belong to a business) and is skipped. Safe to run more than once.
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
  IF v_company_id IS NOT NULL THEN
    RETURN v_company_id;
  END IF;

  v_store_name := COALESCE(
    NULLIF(btrim(v_store_name), ''),
    (SELECT NULLIF(btrim(bp.business_name), '') FROM public.business_profiles bp WHERE bp.id = v_business_id),
    'Store');

  INSERT INTO public.cmms_company_profiles
    (company_name, company_registration, business_profile_id, supermarket_id, site_products_source)
  VALUES
    (v_store_name, 'STORE-' || substr(p_supermarket_id::text, 1, 8), v_business_id, p_supermarket_id, 'both')
  RETURNING id INTO v_company_id;

  RETURN v_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ensure_store_website(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ensure_store_website(UUID) TO service_role;

-- New stores, and stores that get a business linked later, get their website. A failure here must never
-- block creating or editing a store, so it is swallowed.
CREATE OR REPLACE FUNCTION public.trg_supermarket_ensure_website()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.fn_ensure_store_website(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_ensure_store_website(%) failed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS supermarket_ensure_website ON public.supermarkets;
CREATE TRIGGER supermarket_ensure_website
  AFTER INSERT OR UPDATE OF pichin_business_profile_id ON public.supermarkets
  FOR EACH ROW EXECUTE FUNCTION public.trg_supermarket_ensure_website();

-- Backfill: every existing store that has a business but no website row yet.
SELECT public.fn_ensure_store_website(s.id)
FROM public.supermarkets s
WHERE COALESCE(s.is_active, TRUE);

NOTIFY pgrst, 'reload schema';

SELECT 'Every store with a business now has a website' AS status;
