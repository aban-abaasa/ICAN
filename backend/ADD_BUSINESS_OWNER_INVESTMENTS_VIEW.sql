-- ================================================================
-- Business owner / shareholder view of investments received
-- ================================================================
-- investment_agreements RLS only lets the INVESTOR read a row, so a business
-- owner could never see or download the agreement for money invested in their
-- own business. This adds one SECURITY DEFINER read RPC that returns every
-- agreement against businesses the caller owns or holds shares in, with the
-- investor's name, the pitch/business names, the MOU text and live approval
-- counts -- nothing else (no PIN hash, no wallet details).
--
-- Read-only. Safe to re-run. No table or policy changes.
-- ================================================================

CREATE OR REPLACE FUNCTION public.fn_get_business_investments()
RETURNS TABLE (
  agreement_id UUID,
  status TEXT,
  pitch_id UUID,
  pitch_title TEXT,
  business_profile_id UUID,
  business_name TEXT,
  investor_id UUID,
  investor_name TEXT,
  investment_type TEXT,
  shares_amount NUMERIC,
  share_price NUMERIC,
  total_investment NUMERIC,
  escrow_id TEXT,
  approval_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  sealed_at TIMESTAMPTZ,
  mou_content TEXT,
  signed_count BIGINT,
  total_shareholders BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    a.id, a.status, a.pitch_id, p.title, a.business_profile_id, bp.business_name,
    a.investor_id,
    COALESCE(NULLIF(pr.full_name, ''), split_part(u.email, '@', 1), 'Investor'),
    a.investment_type, a.shares_amount, a.share_price, a.total_investment,
    a.escrow_id, a.approval_deadline, a.created_at, a.sealed_at,
    bd.mou_content,
    (SELECT count(*) FROM public.investment_signatures s
      WHERE s.agreement_id = a.id AND s.signature_status = 'signed'),
    (SELECT count(*) FROM public.business_co_owners c
      WHERE c.business_profile_id = a.business_profile_id
        AND c.ownership_share > 0 AND (c.status IS NULL OR c.status = 'active'))
  FROM public.investment_agreements a
  JOIN public.business_profiles bp ON bp.id = a.business_profile_id
  LEFT JOIN public.pitches p ON p.id = a.pitch_id
  LEFT JOIN public.profiles pr ON pr.id = a.investor_id
  LEFT JOIN auth.users u ON u.id = a.investor_id
  LEFT JOIN public.business_documents bd ON bd.business_profile_id = a.business_profile_id
  WHERE auth.uid() IS NOT NULL
    AND (
      bp.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.business_co_owners c
         WHERE c.business_profile_id = a.business_profile_id
           AND c.user_id = auth.uid() AND c.ownership_share > 0
      )
    )
  ORDER BY a.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.fn_get_business_investments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_business_investments() TO authenticated;
