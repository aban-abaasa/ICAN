-- ================================================================
-- Investment agreement: real signatures, seal and public QR verification
-- ================================================================
-- The printed agreement shows WHO actually signed (from
-- investment_signatures, the same rows that drive the 60% seal), a SEALED
-- stamp, and a QR code. Scanning the QR opens /verify-agreement, which
-- calls fn_verify_investment_agreement() (no login) and shows the live
-- record: status, signers and time, and whether the printed copy still
-- matches the record.
--
-- Two codes per agreement:
--   * lookup key   -- fixed per agreement, in the QR so only someone who
--                     holds the printed copy can look the record up.
--   * seal code    -- fingerprint of the signed content (amount, sealed
--                     time, every signer + signing time). Printed on the
--                     document and shown on the verify page; if the record
--                     changes after printing the codes stop matching.
--
-- Read-only helpers. Safe to re-run. Needs
-- FIX_SHAREHOLDER_APPROVAL_REAL_MEMBERS.sql first (get_total_shareholders).
-- ================================================================

-- Fixed lookup key (not secret-bearing: derived from ids + creation time)
CREATE OR REPLACE FUNCTION public.fn_agreement_lookup_key(p_agreement_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT upper(substr(encode(sha256(convert_to(
           'lookup|' || a.id::text || '|' || a.investor_id::text || '|' || a.created_at::text,
           'UTF8')), 'hex'), 1, 12))
  FROM public.investment_agreements a WHERE a.id = p_agreement_id;
$$;

-- Fingerprint of the signed content, formatted XXXX-XXXX-XXXX-XXXX
CREATE OR REPLACE FUNCTION public.fn_agreement_seal_code(p_agreement_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH h AS (
    SELECT upper(substr(encode(sha256(convert_to(
             a.id::text || '|' || a.total_investment::text || '|' || COALESCE(a.sealed_at::text, '') || '|' ||
             COALESCE((SELECT string_agg(s.shareholder_id::text || '@' ||
                                         COALESCE(s.signed_at, s.signature_timestamp)::text,
                                         ',' ORDER BY s.shareholder_id)
                         FROM public.investment_signatures s
                        WHERE s.agreement_id = a.id AND s.signature_status = 'signed'), ''),
             'UTF8')), 'hex'), 1, 16)) AS c
    FROM public.investment_agreements a WHERE a.id = p_agreement_id
  )
  SELECT substr(c,1,4) || '-' || substr(c,5,4) || '-' || substr(c,9,4) || '-' || substr(c,13,4) FROM h;
$$;

REVOKE ALL ON FUNCTION public.fn_agreement_lookup_key(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_agreement_seal_code(UUID) FROM PUBLIC;

-- Shared signer list (no emails, no PIN data)
CREATE OR REPLACE FUNCTION public.fn_agreement_signers_json(p_agreement_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- bio / city / country are read through to_jsonb() so this works whether
  -- or not the profiles table has those columns. Location is where the
  -- signature was made (device time zone captured at signing), falling back
  -- to the signer's profile place. No emails, phones or PIN data.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name', COALESCE(NULLIF(s.shareholder_name, ''), NULLIF(to_jsonb(pr)->>'full_name', ''), 'Shareholder'),
           'role', CASE WHEN s.shareholder_id = a.investor_id THEN 'Investor (buyer)' ELSE 'Shareholder' END,
           'signed_at', COALESCE(s.signed_at, s.signature_timestamp),
           'location', COALESCE(
              NULLIF(NULLIF(s.device_location, 'in_app'), ''),
              NULLIF(concat_ws(', ', NULLIF(to_jsonb(pr)->>'city', ''), NULLIF(to_jsonb(pr)->>'country', '')), '')),
           'bio', left(NULLIF(to_jsonb(pr)->>'bio', ''), 280)
         ) ORDER BY COALESCE(s.signed_at, s.signature_timestamp)), '[]'::jsonb)
  FROM public.investment_agreements a
  JOIN public.investment_signatures s ON s.agreement_id = a.id AND s.signature_status = 'signed'
  LEFT JOIN public.profiles pr ON pr.id = s.shareholder_id
  WHERE a.id = p_agreement_id;
$$;

REVOKE ALL ON FUNCTION public.fn_agreement_signers_json(UUID) FROM PUBLIC;

-- For the PDF: signers + codes, only for the investor, the business owner
-- or an active shareholder of that business.
CREATE OR REPLACE FUNCTION public.fn_get_agreement_seal(p_agreement_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_a public.investment_agreements;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  SELECT * INTO v_a FROM public.investment_agreements WHERE id = p_agreement_id;
  IF v_a.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT (
    v_a.investor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.business_profiles bp
                WHERE bp.id = v_a.business_profile_id AND bp.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.business_co_owners c
                WHERE c.business_profile_id = v_a.business_profile_id
                  AND c.user_id = auth.uid() AND c.ownership_share > 0
                  AND (c.status IS NULL OR c.status = 'active'))
  ) THEN
    RAISE EXCEPTION 'No access to this agreement';
  END IF;

  RETURN jsonb_build_object(
    'agreement_id', v_a.id,
    'status', v_a.status,
    'lookup_key', public.fn_agreement_lookup_key(v_a.id),
    'seal_code', public.fn_agreement_seal_code(v_a.id),
    'signers', public.fn_agreement_signers_json(v_a.id),
    'signed_count', (SELECT count(*) FROM public.investment_signatures s
                      WHERE s.agreement_id = v_a.id AND s.signature_status = 'signed'
                        AND s.shareholder_id <> v_a.investor_id),
    'total_members', public.get_total_shareholders(v_a.business_profile_id),
    'sealed_at', v_a.sealed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_agreement_seal(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_agreement_seal(UUID) TO authenticated;

-- Public "scan the seal" endpoint. Narrow output; needs the lookup key
-- that only the printed QR carries.
CREATE OR REPLACE FUNCTION public.fn_verify_investment_agreement(
  p_agreement_id UUID,
  p_key TEXT,
  p_seal TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_a public.investment_agreements;
  v_name TEXT;
  v_investor TEXT;
  v_current TEXT;
BEGIN
  SELECT * INTO v_a FROM public.investment_agreements WHERE id = p_agreement_id;
  IF v_a.id IS NULL OR p_key IS NULL
     OR upper(p_key) <> public.fn_agreement_lookup_key(v_a.id) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT business_name INTO v_name FROM public.business_profiles WHERE id = v_a.business_profile_id;
  SELECT COALESCE(NULLIF(pr.full_name, ''), 'Investor') INTO v_investor
    FROM public.profiles pr WHERE pr.id = v_a.investor_id;
  v_current := public.fn_agreement_seal_code(v_a.id);

  RETURN jsonb_build_object(
    'found', true,
    'status', v_a.status,
    'business_name', v_name,
    'investor_name', COALESCE(v_investor, 'Investor'),
    'investment_type', v_a.investment_type,
    'shares_amount', v_a.shares_amount,
    'total_investment', v_a.total_investment,
    'created_at', v_a.created_at,
    'sealed_at', v_a.sealed_at,
    'signed_count', (SELECT count(*) FROM public.investment_signatures s
                      WHERE s.agreement_id = v_a.id AND s.signature_status = 'signed'
                        AND s.shareholder_id <> v_a.investor_id),
    'total_members', public.get_total_shareholders(v_a.business_profile_id),
    'signers', public.fn_agreement_signers_json(v_a.id),
    'seal_code', v_current,
    'copy_matches', (p_seal IS NOT NULL AND upper(p_seal) = v_current)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_verify_investment_agreement(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_verify_investment_agreement(UUID, TEXT, TEXT) TO anon, authenticated;

-- Make the new functions callable right away (refresh the API schema cache)
NOTIFY pgrst, 'reload schema';
