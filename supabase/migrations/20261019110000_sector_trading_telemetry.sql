-- ============================================================================
-- IcanEra Sector Markets, part 2 of 4: consent and the revenue feed.
--
-- WHERE REVENUE COMES FROM
--   Every customer sale that lands in a business wallet goes through
--   ican_settle_business_wallet_income() and leaves exactly one row in
--   ican_business_wallet_settlements (UNIQUE source_app + source_reference).
--   Card-QR sales, drop-ship sales and installment sales all end there with
--   settlement_type = 'pos_sale'. That one table is the choke point, so one trigger
--   covers them all. (The wallet movement log, ican_business_wallet_transactions, is
--   NOT used: it also holds transfers between a business's own branches, platform
--   fees and investments, none of which are revenue.) Investments, refunds and other
--   income are not counted.
--
-- WHAT THE TRIGGER DOES, AND WHAT IT NEVER DOES
--   * It runs after the settlement row exists and drops one small row into the
--     trading outbox. It can never fail or slow a sale: every error is swallowed.
--   * It only records a business that has accepted the current data clause of the
--     Terms & Conditions. Everyone else is skipped.
--   * It stores the sector, an amount in UGX, and a keyed hash of the business. Not the
--     business id, not the customer, not the payment reference's meaning.
--   * Nothing here reads anything back for the business: there is no path from
--     trading to business data.
--
-- CONSENT
--   Accepting is part of creating a business account (the sign-up form requires the
--   tick and calls ican_sector_accept_data_terms). Existing businesses are asked on
--   their next sign-in (ican_sector_data_consent_status). The wording is data
--   (icanera_trading.data_terms_text) and versioned. THE v1 WORDING BELOW IS A DRAFT
--   AND MUST BE REVIEWED BY A LAWYER BEFORE TRADING IS TURNED ON.
--
-- Known limit: the settlement row does not say who paid, so a purchase by the
-- business's own owner cannot be excluded here. The per-business cap in the index
-- (file 3) and the minimum cohort limit what any one business can do to a sector.
--
-- Safe to run more than once. Run 20261019100000_sector_trading_core.sql first.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_trading.telemetry_events') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261019100000_sector_trading_core.sql first.';
  END IF;
END $$;


-- 1. Which business category belongs to which sector. Keys are the category keys the
--    business-profile flow stores (see BusinessCategorySelector / cmms_business_type_architecture).
--    government, other and mining-type businesses are deliberately unmapped.
INSERT INTO icanera_trading.sector_industry_map (industry_value, ticker) VALUES
  ('farm', 'iAGRI'), ('agriculture', 'iAGRI'), ('agribusiness', 'iAGRI'),
  ('transport', 'iTRNS'), ('transportation', 'iTRNS'), ('logistics', 'iTRNS'), ('fleet', 'iTRNS'), ('delivery', 'iTRNS'),
  ('retail', 'iRETL'), ('wholesale', 'iRETL'), ('shop', 'iRETL'), ('supermarket', 'iRETL'), ('hardware', 'iRETL'),
  ('supplier', 'iRETL'), ('factory', 'iRETL'), ('manufacturing', 'iRETL'), ('industrial', 'iRETL'),
  ('pharmacy', 'iHLTH'), ('hospital', 'iHLTH'), ('clinic', 'iHLTH'), ('healthcare', 'iHLTH'),
  ('school', 'iEDUC'), ('education', 'iEDUC'), ('college', 'iEDUC'), ('university', 'iEDUC'),
  ('insurance', 'iFINC'), ('sacco', 'iFINC'), ('microfinance', 'iFINC'), ('bank', 'iFINC'), ('finance', 'iFINC'),
  ('construction', 'iCNST'), ('real_estate', 'iCNST'),
  ('restaurant', 'iHOSP'), ('restaurant_cafe', 'iHOSP'), ('cafe', 'iHOSP'), ('hotel', 'iHOSP'), ('hospitality', 'iHOSP'),
  ('professional_services', 'iTECH'), ('law_firm', 'iTECH'), ('audit_firm', 'iTECH'), ('project_management', 'iTECH'),
  ('telecommunications', 'iTECH'), ('technology', 'iTECH')
ON CONFLICT (industry_value) DO NOTHING;
-- Churches are recognised by the same rule the tithe feature uses (fn_business_is_church),
-- not by category, and go to iSOCL; see sector_for_business below.


-- 2. The data clause, v1. DRAFT: needs legal review before launch.
INSERT INTO icanera_trading.data_terms_text (version, title, body) VALUES (
  1,
  'Anonymous sector statistics',
  'When your business receives sales payments through ICAN, the amount is added to an anonymous total for your business sector (for example Retail, Transport or Health). '
  || 'Only combined sector figures are ever published, and only when enough businesses contribute that no single business can be identified. '
  || 'We never share your business name, your customers, who paid you, or any individual transaction. '
  || 'These sector figures are used to calculate the sector index values that users can trade on IcanEra Sector Markets. '
  || 'Agreeing to this is part of the Terms & Conditions for creating a business account.'
) ON CONFLICT (version) DO NOTHING;


-- 3. Who may act for a business: the same rule CMMS uses to decide who administers it.
CREATE OR REPLACE FUNCTION icanera_trading.is_business_admin(p_business_id UUID, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  IF p_business_id IS NULL OR p_uid IS NULL THEN RETURN FALSE; END IF;
  SELECT EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business_id AND bp.user_id = p_uid) INTO v_ok;
  IF v_ok THEN RETURN TRUE; END IF;
  IF to_regclass('public.business_co_owners') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.business_co_owners co
         WHERE co.business_profile_id = $1 AND co.user_id = $2
           AND lower(coalesce(co.status, 'active')) IN ('active', 'approved', 'verified')
           AND (co.ownership_share > 0
                OR lower(coalesce(co.role, '')) IN ('owner', 'co-owner', 'shareholder', 'ceo', 'administrator')))
    $q$ INTO v_ok USING p_business_id, p_uid;
  END IF;
  RETURN COALESCE(v_ok, FALSE);
END; $$;


-- 4. Has this business accepted the CURRENT wording?
-- (Plain, inlinable SQL: this and the next two helpers run on every sale, and are only reachable through the
-- definer trigger below. API roles cannot execute them, and every name in them is schema-qualified.)
CREATE OR REPLACE FUNCTION icanera_trading.business_has_consented(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM icanera_trading.data_terms_acceptance a
      JOIN icanera_trading.sector_settings s ON s.id
     WHERE a.business_id = p_business_id AND a.terms_version = s.current_terms_version)
$$;


-- 5. A business's sector (NULL = does not contribute).
CREATE OR REPLACE FUNCTION icanera_trading.sector_for_business(p_business_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  bp     RECORD;
  v_key  TEXT;
  v_tick TEXT;
BEGIN
  SELECT b.business_type::TEXT AS business_type, b.business_name::TEXT AS business_name, b.metadata AS metadata
    INTO bp
    FROM public.business_profiles b
   WHERE b.id = p_business_id
     AND lower(coalesce(b.status, 'active')) NOT IN ('inactive', 'suspended', 'rejected', 'deleted');
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF to_regprocedure('public.fn_business_is_church(text,text,jsonb)') IS NOT NULL
     AND public.fn_business_is_church(bp.business_type, bp.business_name, bp.metadata) THEN
    v_tick := 'iSOCL';
  ELSE
    -- category_key first; business_type can be a legal form ("Sole Proprietorship"), so it is only a fallback.
    v_key := lower(btrim(coalesce(NULLIF(bp.metadata ->> 'category_key', ''), bp.business_type, '')));
    SELECT m.ticker INTO v_tick FROM icanera_trading.sector_industry_map m WHERE m.industry_value = v_key;
  END IF;

  IF v_tick IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM icanera_trading.sector_catalog c WHERE c.ticker = v_tick AND c.enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_tick;
END; $$;


-- 6. Drop one revenue event in the outbox. Returns nothing and NEVER raises: whatever
--    goes wrong here must not reach the business's sale.
--      kind 'sale' : p_amount_ugx > 0
--      kind 'void' : reverses an earlier 'sale' with the same source + reference (no amount needed)
CREATE OR REPLACE FUNCTION icanera_trading.capture_revenue(
  p_source      TEXT,
  p_source_ref  TEXT,
  p_business_id UUID,
  p_amount_ugx  NUMERIC DEFAULT NULL,
  p_kind        TEXT    DEFAULT 'sale'
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_sector TEXT;
  v_amount NUMERIC;
BEGIN
  IF p_business_id IS NULL OR p_source IS NULL OR p_source_ref IS NULL THEN RETURN; END IF;
  IF NOT icanera_trading.business_has_consented(p_business_id) THEN RETURN; END IF;
  v_sector := icanera_trading.sector_for_business(p_business_id);
  IF v_sector IS NULL THEN RETURN; END IF;

  IF p_kind = 'void' THEN
    SELECT -e.amount_ugx INTO v_amount FROM icanera_trading.telemetry_events e
     WHERE e.source = p_source AND e.source_ref = p_source_ref AND e.kind = 'sale';
    IF v_amount IS NULL THEN RETURN; END IF;           -- never captured, nothing to reverse
  ELSIF p_kind = 'sale' THEN
    IF p_amount_ugx IS NULL OR p_amount_ugx <= 0 OR p_amount_ugx = 'NaN'::NUMERIC THEN RETURN; END IF;
    v_amount := round(p_amount_ugx, 4);
    IF v_amount = 0 THEN RETURN; END IF;
  ELSE
    RETURN;
  END IF;

  INSERT INTO icanera_trading.telemetry_events (source, source_ref, kind, sector, contributor_key, amount_ugx)
  VALUES (p_source, p_source_ref, p_kind, v_sector, icanera_trading.contributor_key(p_business_id), v_amount)
  ON CONFLICT (source, source_ref, kind) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  NULL;
END; $$;


-- 7. The hook on the settlement choke point.
CREATE OR REPLACE FUNCTION icanera_trading.trg_capture_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
DECLARE v_price NUMERIC;
BEGIN
  IF NEW.settlement_type = 'pos_sale' THEN
    SELECT c.price_ugx INTO v_price FROM public.ican_price_cache c WHERE c.id;   -- the cached price: no flush, no wait
    IF v_price IS NOT NULL AND v_price > 0 THEN
      PERFORM icanera_trading.capture_revenue('settlement', NEW.id::TEXT, NEW.business_profile_id,
                                              NEW.amount_ican * v_price, 'sale');
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;                                      -- a sale is never held up by this
END; $$;

DO $$
BEGIN
  IF to_regclass('public.ican_business_wallet_settlements') IS NULL THEN
    RAISE NOTICE 'sector trading: ican_business_wallet_settlements does not exist yet, so no revenue hook was installed. Re-run this file after UNIFIED_BUSINESS_WALLET_OPERATIONS.sql.';
  ELSE
    DROP TRIGGER IF EXISTS trg_icanera_capture_settlement ON public.ican_business_wallet_settlements;
    CREATE TRIGGER trg_icanera_capture_settlement
      AFTER INSERT ON public.ican_business_wallet_settlements
      FOR EACH ROW WHEN (NEW.settlement_type = 'pos_sale')
      EXECUTE FUNCTION icanera_trading.trg_capture_settlement();
  END IF;
END $$;


-- 8. The doors the app uses for consent.

-- The wording to show (sign-up form and Terms page). Readable by signed-out visitors.
CREATE OR REPLACE FUNCTION public.ican_sector_data_terms()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_trading, public AS $$
  SELECT jsonb_build_object('version', t.version, 'title', t.title, 'body', t.body)
    FROM icanera_trading.data_terms_text t JOIN icanera_trading.sector_settings s ON s.id
   WHERE t.version = s.current_terms_version
$$;
REVOKE ALL ON FUNCTION public.ican_sector_data_terms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_sector_data_terms() TO anon, authenticated;

-- Has this business accepted the current wording? (Drives the prompt for existing businesses.)
CREATE OR REPLACE FUNCTION public.ican_sector_data_consent_status(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cur INT;
  v_at  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  IF NOT icanera_trading.is_business_admin(p_business_id, v_uid) THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_allowed', 'error', 'You do not manage this business.');
  END IF;
  SELECT s.current_terms_version INTO v_cur FROM icanera_trading.sector_settings s WHERE s.id;
  SELECT a.accepted_at INTO v_at FROM icanera_trading.data_terms_acceptance a
   WHERE a.business_id = p_business_id AND a.terms_version = v_cur;
  RETURN jsonb_build_object('success', true, 'accepted', v_at IS NOT NULL, 'current_version', v_cur, 'accepted_at', v_at);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_data_consent_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_data_consent_status(UUID) TO authenticated;

-- Accept the current wording for a business. Only someone who manages the business can.
-- Idempotent: accepting twice is fine.
CREATE OR REPLACE FUNCTION public.ican_sector_accept_data_terms(p_business_id UUID, p_version INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cur INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in.');
  END IF;
  IF NOT icanera_trading.is_business_admin(p_business_id, v_uid) THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_allowed', 'error', 'You do not manage this business.');
  END IF;
  SELECT s.current_terms_version INTO v_cur FROM icanera_trading.sector_settings s WHERE s.id;
  IF p_version IS DISTINCT FROM v_cur THEN
    RETURN jsonb_build_object('success', false, 'code', 'terms_version_outdated', 'current_version', v_cur,
                              'error', 'The terms have changed. Please read and accept the latest version.');
  END IF;
  INSERT INTO icanera_trading.data_terms_acceptance (business_id, terms_version, accepted_by)
  VALUES (p_business_id, v_cur, v_uid)
  ON CONFLICT (business_id, terms_version) DO NOTHING;
  RETURN jsonb_build_object('success', true, 'accepted', true, 'version', v_cur);
END; $$;
REVOKE ALL ON FUNCTION public.ican_sector_accept_data_terms(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_sector_accept_data_terms(UUID, INT) TO authenticated;


-- 9. Internal helpers stay closed to the API roles.
REVOKE ALL ON FUNCTION icanera_trading.is_business_admin(UUID, UUID)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION icanera_trading.business_has_consented(UUID)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION icanera_trading.sector_for_business(UUID)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION icanera_trading.capture_revenue(TEXT, TEXT, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION icanera_trading.trg_capture_settlement()             FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
