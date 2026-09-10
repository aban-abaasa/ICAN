-- Lets a user remove any document they submitted for verification —
-- including an already-approved one — from the Portfolio tab's Verification
-- card (CREATE_PORTFOLIO_RATINGS_VERIFICATION.sql gave them SELECT + INSERT
-- on document_verifications but no DELETE, so this was previously impossible
-- even though it's their own row).
--
-- Deleting an 'approved' row is the one case with a side effect: it's the
-- audit record behind their verified badge (ican_user_profiles.is_verified),
-- so the AFTER DELETE trigger below re-checks whether any other approved
-- document still exists for that user and, if not, flips is_verified back
-- to false — the badge never outlives every document that justified it.
--
-- Idempotent: safe to run more than once.

DROP POLICY IF EXISTS "document_verifications_owner_delete" ON public.document_verifications;
CREATE POLICY "document_verifications_owner_delete" ON public.document_verifications
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.sync_is_verified_after_document_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'approved' AND NOT EXISTS (
    SELECT 1 FROM public.document_verifications
    WHERE user_id = OLD.user_id AND status = 'approved'
  ) THEN
    UPDATE public.ican_user_profiles SET is_verified = false WHERE id = OLD.user_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_verifications_delete_sync_verified ON public.document_verifications;
CREATE TRIGGER trg_document_verifications_delete_sync_verified
  AFTER DELETE ON public.document_verifications
  FOR EACH ROW EXECUTE FUNCTION public.sync_is_verified_after_document_delete();

NOTIFY pgrst, 'reload schema';

SELECT 'document_verifications: owner can now delete any of their own submissions (approved included)' AS status;
