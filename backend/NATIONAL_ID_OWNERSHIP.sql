-- ============================================================
-- ICANERA WALLET — a national ID belongs to the person who can prove it
-- ============================================================
-- Why: saving an ID (NATIONAL_ID_PER_COUNTRY.sql) only checks that it is well formed
-- and unused. So whoever types a stranger's ID first holds it: they wear that person's
-- identity, and the real owner is told "already linked to another wallet".
--
-- What this adds:
--   1. PROOF.   request_my_id_verification(): the holder gives their name exactly as
--      printed on the ID, a photo of the ID and a selfie holding it. A reviewer (the
--      Dev console, "ID checks" tab) approves it and the ID becomes VERIFIED.
--   2. TAKE IT BACK.   claim_national_id(): the real owner of an ID that someone else
--      saved first gives the same proof. If a reviewer approves, the ID moves to them
--      and the squatter's wallet is left with no ID (so, once enforcement is on, it
--      cannot send money). Only a reviewer can approve this, never the app.
--      A VERIFIED holder cannot be displaced unless the reviewer says so explicitly.
--   3. NAME LOCK.   Once an ID is verified, the wallet's holder name may only be a
--      name that fits the name printed on the ID. Nobody can verify as Alice and then
--      rename the wallet to Bob.
--   4. TRUST SIGNAL.   get_id_trust(): lets the send screen show a sender "ID verified"
--      (and whether the wallet name fits the ID) before they pay. Only a yes/no.
--   5. STRICT MODE (off).   When national_id_enforcement.enforced is on, set
--         UPDATE public.national_id_enforcement SET require_verified = true;
--      to stop money LEAVING a wallet whose ID is saved but not verified. (Receiving is
--      never blocked.) Switch it on only after reviewers have worked through the queue.
--
-- Photos: the app uploads them through the EXISTING storage route to the EXISTING R2
-- folder 'cmms-employment-documents' (the same folder CMMS employee ID documents use),
-- so no new Vercel function and no new folder. This file stores the r2:// keys, accepts
-- only keys under the caller's own user id in that folder, and never grants them (or
-- the ID hash) to the API: the owner sees their request's status, reviewers see the keys.
-- Known limit: the existing presign-get route is not logged-in-only (it relies on keys
-- being unguessable), so keep the keys server-side as this file does.
--
-- Not a lookup against the issuing authority (e.g. NIRA in Uganda): a person decides.
-- That is why user_accounts.kyc_verified is NOT touched here.
--
-- Run order: NATIONAL_ID_PER_COUNTRY.sql, supabase/migrations/20261009100000_secure_dev_access.sql
-- (the reviewer functions use its dev secret), then this file. Safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Prerequisites
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.national_id_checks') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'national_id_enforcement' AND column_name = 'require_verified') THEN
    RAISE EXCEPTION 'Run the current NATIONAL_ID_PER_COUNTRY.sql first (it creates national_id_checks and the require_verified switch).';
  END IF;
  IF to_regprocedure('public.ican_dev_secret()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261009100000_secure_dev_access.sql first (the reviewer functions use its dev secret).';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1. Name helpers
-- ------------------------------------------------------------
-- The words of a name: lower-case letters only, no punctuation, no repeats.
CREATE OR REPLACE FUNCTION public.national_id_name_tokens(p_name TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT t), ARRAY[]::TEXT[])
    FROM unnest(regexp_split_to_array(
           lower(regexp_replace(COALESCE(p_name, ''), '[^[:alpha:][:space:]]', ' ', 'g')), '\s+')) AS t
   WHERE t <> '';
$$;

-- Does the wallet's holder name fit the name printed on the ID? Every word of the wallet name
-- must be a word on the ID (a single letter counts as an initial). "Aban Abaasa" fits
-- "ABAASA ABAN KATO"; "Bob" does not fit "ABAASA ABAN KATO". An empty wallet name never fits.
CREATE OR REPLACE FUNCTION public.national_id_name_matches(p_wallet_name TEXT, p_id_name TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  WITH w AS (SELECT unnest(public.national_id_name_tokens(p_wallet_name)) AS t),
       i AS (SELECT public.national_id_name_tokens(p_id_name) AS toks)
  SELECT EXISTS (SELECT 1 FROM w)
     AND NOT EXISTS (
       SELECT 1 FROM w, i
        WHERE NOT (CASE WHEN length(w.t) = 1
                        THEN EXISTS (SELECT 1 FROM unnest(i.toks) x WHERE left(x, 1) = w.t)
                        ELSE w.t = ANY (i.toks) END));
$$;

-- What is wrong with a submission (NULL = nothing). Shared by the two request functions.
CREATE OR REPLACE FUNCTION app_private.id_submission_problem(p_uid UUID, p_name TEXT, p_photo TEXT, p_selfie TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet_name TEXT;
  v_key_pattern TEXT := '^r2://cmms-employment-documents/' || p_uid::text || '/[A-Za-z0-9._-]{1,200}$';
BEGIN
  IF (SELECT count(*) FROM unnest(public.national_id_name_tokens(p_name)) t WHERE length(t) >= 2) < 2 THEN
    RETURN 'Enter your full name exactly as it is printed on your ID (at least two names).';
  END IF;
  IF p_photo IS NULL OR p_photo !~ v_key_pattern THEN RETURN 'Add a photo of your ID.'; END IF;
  IF p_selfie IS NULL OR p_selfie !~ v_key_pattern THEN RETURN 'Add a selfie of you holding your ID.'; END IF;
  IF p_photo = p_selfie THEN RETURN 'The photo of your ID and your selfie must be two different pictures.'; END IF;

  SELECT account_holder_name INTO v_wallet_name
    FROM public.user_accounts WHERE user_id = p_uid AND account_type = 'personal'
   ORDER BY created_at LIMIT 1;
  IF COALESCE(btrim(v_wallet_name), '') <> '' AND NOT public.national_id_name_matches(v_wallet_name, p_name) THEN
    RETURN format('The name on your wallet (%s) has to match the name on your ID. Change the wallet name in your account settings, or type the name exactly as printed on the ID.', v_wallet_name);
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app_private.id_submission_problem(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. The holder asks for their saved ID to be verified
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_my_id_verification(
  p_name_on_id TEXT, p_id_photo TEXT, p_selfie_photo TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_id      public.user_national_ids;
  v_problem TEXT;
  v_check   UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT * INTO v_id FROM public.user_national_ids WHERE user_id = v_uid;
  IF v_id.user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Add your national ID to your wallet first.');
  END IF;
  IF v_id.verified THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your national ID is already verified.');
  END IF;

  IF (SELECT count(*) FROM public.national_id_checks WHERE user_id = v_uid AND created_at > now() - interval '24 hours') >= 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many requests today. Please try again tomorrow.');
  END IF;

  v_problem := app_private.id_submission_problem(v_uid, p_name_on_id, p_id_photo, p_selfie_photo);
  IF v_problem IS NOT NULL THEN RETURN jsonb_build_object('success', false, 'error', v_problem); END IF;

  BEGIN
    INSERT INTO public.national_id_checks
      (user_id, kind, country_code, id_type, id_hash, id_last4, name_on_id, id_photo, selfie_photo, note)
    VALUES
      (v_uid, 'verify', v_id.country_code, v_id.id_type, v_id.id_hash, v_id.id_last4, btrim(p_name_on_id),
       p_id_photo, p_selfie_photo, left(NULLIF(btrim(COALESCE(p_note, '')), ''), 500))
    RETURNING id INTO v_check;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have a request waiting for review.');
  END;

  RETURN jsonb_build_object('success', true, 'checkId', v_check);
END; $$;

-- ------------------------------------------------------------
-- 3. The real owner asks for an ID that someone else saved first
-- ------------------------------------------------------------
-- Answers { success:false, code } for the cases the app handles: 'not_taken' (nobody holds it:
-- save it normally instead), 'already_yours'. Wrong guesses count towards the same hourly limit as
-- set_my_national_id, so this cannot be used to probe for other people's IDs.
CREATE OR REPLACE FUNCTION public.claim_national_id(
  p_country TEXT, p_id TEXT, p_name_on_id TEXT, p_id_photo TEXT, p_selfie_photo TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_country TEXT := upper(trim(COALESCE(p_country, '')));
  v_norm    TEXT := public.normalize_national_id(p_id);
  v_rule    RECORD;
  v_account_country TEXT;
  v_mine    public.user_national_ids;
  v_holder  public.user_national_ids;
  v_hash    TEXT;
  v_problem TEXT;
  v_check   UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  IF v_country !~ '^[A-Z]{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose the country of your ID first.');
  END IF;

  IF (SELECT count(*) FROM app_private.national_id_attempts
       WHERE user_id = v_uid AND NOT success AND attempted_at > now() - interval '1 hour') >= 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many attempts. Please try again in an hour.');
  END IF;

  SELECT * INTO v_mine FROM public.user_national_ids WHERE user_id = v_uid;
  IF v_mine.verified THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your wallet already has a verified national ID.');
  END IF;

  SELECT * INTO v_rule FROM public.get_national_id_rule(v_country);
  IF v_rule.pattern IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'National ID rules are not set up yet. Please try again later.');
  END IF;
  IF v_norm !~ v_rule.pattern THEN
    INSERT INTO app_private.national_id_attempts (user_id, success) VALUES (v_uid, false);
    RETURN jsonb_build_object('success', false,
      'error', format('That does not look like a valid %s%s.', v_rule.label,
                      CASE WHEN v_rule.hint IS NOT NULL THEN ' (' || v_rule.hint || ')' ELSE '' END));
  END IF;

  SELECT country_code INTO v_account_country
    FROM public.user_accounts WHERE user_id = v_uid AND account_type = 'personal'
   ORDER BY created_at LIMIT 1;
  IF v_account_country IS NOT NULL AND upper(v_account_country) <> v_country THEN
    RETURN jsonb_build_object('success', false,
      'error', format('Your wallet is registered in %s, so the ID must be from %s.', v_account_country, v_account_country));
  END IF;

  v_hash := app_private.national_id_hash(v_country, v_norm);
  SELECT * INTO v_holder FROM public.user_national_ids WHERE id_hash = v_hash;
  IF v_holder.user_id IS NULL THEN
    INSERT INTO app_private.national_id_attempts (user_id, success) VALUES (v_uid, false);
    RETURN jsonb_build_object('success', false, 'code', 'not_taken',
      'error', 'Nobody has saved this ID yet. Save it on your wallet first, then ask for it to be verified.');
  END IF;
  IF v_holder.user_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'code', 'already_yours',
      'error', 'This ID is already on your wallet. Ask for it to be verified instead.');
  END IF;

  IF (SELECT count(*) FROM public.national_id_checks WHERE user_id = v_uid AND created_at > now() - interval '24 hours') >= 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many requests today. Please try again tomorrow.');
  END IF;

  v_problem := app_private.id_submission_problem(v_uid, p_name_on_id, p_id_photo, p_selfie_photo);
  IF v_problem IS NOT NULL THEN
    -- Reaching this point already told the caller the ID is taken, so a half-filled attempt counts like a wrong guess.
    INSERT INTO app_private.national_id_attempts (user_id, success) VALUES (v_uid, false);
    RETURN jsonb_build_object('success', false, 'error', v_problem);
  END IF;

  BEGIN
    INSERT INTO public.national_id_checks
      (user_id, kind, country_code, id_type, id_hash, id_last4, name_on_id, id_photo, selfie_photo, note)
    VALUES
      (v_uid, 'claim', v_country, v_rule.id_type, v_hash, right(v_norm, 4), btrim(p_name_on_id),
       p_id_photo, p_selfie_photo, left(NULLIF(btrim(COALESCE(p_note, '')), ''), 500))
    RETURNING id INTO v_check;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have a request waiting for review.');
  END;

  RETURN jsonb_build_object('success', true, 'checkId', v_check);
END; $$;

-- ------------------------------------------------------------
-- 4. Trust signal for a sender: is the person behind this wallet ID-verified?
-- ------------------------------------------------------------
-- Only a yes/no per wallet (at most 20 per call): not the name, the ID or anything else.
-- name_matches is false when the wallet name does not fit the name on the verified ID.
CREATE OR REPLACE FUNCTION public.get_id_trust(p_user_ids UUID[])
RETURNS TABLE (user_id UUID, verified BOOLEAN, name_matches BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id,
         COALESCE(n.verified, false),
         COALESCE(n.verified AND public.national_id_name_matches(a.account_holder_name, n.name_on_id), false)
    FROM unnest(p_user_ids[1:20]) AS u(id)
    LEFT JOIN public.user_national_ids n ON n.user_id = u.id
    LEFT JOIN LATERAL (SELECT ua.account_holder_name FROM public.user_accounts ua
                        WHERE ua.user_id = u.id AND ua.account_type = 'personal'
                        ORDER BY ua.created_at LIMIT 1) a ON true
   WHERE auth.uid() IS NOT NULL;
$$;

-- ------------------------------------------------------------
-- 5. Name lock: a verified person's wallet keeps a name that fits their ID
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._national_id_lock_name()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id_name TEXT;
BEGIN
  IF NEW.account_type IS DISTINCT FROM 'personal' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.account_holder_name IS NOT DISTINCT FROM OLD.account_holder_name THEN RETURN NEW; END IF;

  SELECT name_on_id INTO v_id_name FROM public.user_national_ids
   WHERE user_id = NEW.user_id AND verified AND name_on_id IS NOT NULL;
  IF v_id_name IS NULL THEN RETURN NEW; END IF;

  IF NOT public.national_id_name_matches(NEW.account_holder_name, v_id_name) THEN
    RAISE EXCEPTION 'NATIONAL_ID_NAME_LOCKED: your wallet name is tied to your verified national ID and has to match the name printed on it. Contact support if it is wrong.'
      USING ERRCODE = 'P0001', HINT = 'national_id_name_locked';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._national_id_lock_name() FROM PUBLIC, anon, authenticated;

DO $attach$
BEGIN
  IF to_regclass('public.user_accounts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_national_id_lock_name ON public.user_accounts;
    CREATE TRIGGER trg_national_id_lock_name
      BEFORE INSERT OR UPDATE OF account_holder_name
      ON public.user_accounts FOR EACH ROW EXECUTE FUNCTION public._national_id_lock_name();
  END IF;
END
$attach$;

-- ------------------------------------------------------------
-- 6. Reviewer functions (the Dev console, "ID checks" tab; the panel's dev token like every other tab)
-- ------------------------------------------------------------
-- The queue, with what a reviewer needs to decide: who is asking, whether their wallet name fits,
-- and for a claim, who holds the ID now (and whether that holder is verified).
CREATE OR REPLACE FUNCTION public.ican_id_dev_list(dev_token TEXT, p_status TEXT DEFAULT 'pending')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT := lower(COALESCE(NULLIF(btrim(p_status), ''), 'pending'));
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF v_status NOT IN ('pending', 'approved', 'rejected', 'all') THEN v_status := 'pending'; END IF;

  RETURN jsonb_build_object(
    'policy', (SELECT jsonb_build_object('enforced', enforced, 'requireVerified', require_verified)
                 FROM public.national_id_enforcement LIMIT 1),
    'counts', jsonb_build_object(
      'pending',       (SELECT count(*) FROM public.national_id_checks WHERE status = 'pending'),
      'verifiedIds',   (SELECT count(*) FROM public.user_national_ids WHERE verified),
      'unverifiedIds', (SELECT count(*) FROM public.user_national_ids WHERE NOT verified)),
    'checks', COALESCE((
      SELECT jsonb_agg((row_to_json(q)::jsonb) - 'n' ORDER BY q.n)
        FROM (
          SELECT c.id, c.kind, c.status, c.created_at AS "createdAt", c.user_id AS "userId",
                 c.country_code AS "country", c.id_type AS "idType", c.id_last4 AS "last4",
                 c.name_on_id AS "nameOnId", c.note, c.id_photo AS "idPhoto", c.selfie_photo AS "selfie",
                 c.review_note AS "reviewNote", c.reviewed_by AS "reviewedBy", c.reviewed_at AS "reviewedAt",
                 w.account_holder_name AS "walletName", w.email, w.phone_number AS "phone",
                 w.country_code AS "accountCountry", w.created_at AS "walletCreatedAt",
                 (w.account_holder_name IS NOT NULL AND public.national_id_name_matches(w.account_holder_name, c.name_on_id)) AS "nameMatchesWallet",
                 (SELECT count(*) FROM public.national_id_checks o
                   WHERE o.id_hash = c.id_hash AND o.status = 'pending' AND o.id <> c.id) AS "competing",
                 CASE WHEN c.kind = 'claim' AND c.status = 'pending' THEN (
                   SELECT jsonb_build_object('userId', h.user_id, 'verified', h.verified, 'savedAt', h.created_at,
                                             'walletName', hw.account_holder_name, 'email', hw.email, 'phone', hw.phone_number)
                     FROM public.user_national_ids h
                     LEFT JOIN LATERAL (SELECT ua.account_holder_name, ua.email, ua.phone_number FROM public.user_accounts ua
                                         WHERE ua.user_id = h.user_id AND ua.account_type = 'personal'
                                         ORDER BY ua.created_at LIMIT 1) hw ON true
                    WHERE h.id_hash = c.id_hash AND h.user_id <> c.user_id) END AS "holder",
                 -- waiting requests first, oldest first; then what has been decided, newest first
                 row_number() OVER (ORDER BY (c.status <> 'pending'),
                                    CASE WHEN c.status = 'pending' THEN extract(epoch FROM c.created_at) ELSE -extract(epoch FROM c.created_at) END) AS n
            FROM public.national_id_checks c
            LEFT JOIN LATERAL (SELECT ua.account_holder_name, ua.email, ua.phone_number, ua.country_code, ua.created_at
                                 FROM public.user_accounts ua
                                WHERE ua.user_id = c.user_id AND ua.account_type = 'personal'
                                ORDER BY ua.created_at LIMIT 1) w ON true
           WHERE v_status = 'all' OR c.status = v_status
           ORDER BY n
           LIMIT 100
        ) q), '[]'::jsonb));
END; $$;

-- Approve or reject one request. Errors are raised (the Dev console shows the message).
--   verify  approve: the holder's saved ID becomes verified and records the name on it.
--   claim   approve: the ID moves to the claimant (verified). The old holder's row is removed and any
--                    other pending request on the same ID is closed. If the old holder is VERIFIED you
--                    must pass p_replace_verified = true: that overrides someone already proven.
--   reject  needs a reason the person will see.
CREATE OR REPLACE FUNCTION public.ican_id_dev_review(
  dev_token TEXT, p_check_id UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL, p_replace_verified BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_by      TEXT := COALESCE(NULLIF(auth.jwt() ->> 'email', ''), 'dev-token');
  v_note    TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_chk     public.national_id_checks;
  v_wallet  TEXT;
  v_holder  public.user_national_ids;
  v_mine    public.user_national_ids;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO v_chk FROM public.national_id_checks WHERE id = p_check_id FOR UPDATE;
  IF v_chk.id IS NULL THEN RAISE EXCEPTION 'That request does not exist.'; END IF;
  IF v_chk.status <> 'pending' THEN RAISE EXCEPTION 'That request has already been %.', v_chk.status; END IF;

  IF NOT p_approve THEN
    IF v_note IS NULL OR length(v_note) < 3 THEN RAISE EXCEPTION 'Give the person a reason for rejecting (they will see it).'; END IF;
    UPDATE public.national_id_checks
       SET status = 'rejected', review_note = left(v_note, 500), reviewed_by = v_by, reviewed_at = now()
     WHERE id = v_chk.id;
    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  -- The wallet name must still fit the name on the ID (the person may have changed it since asking).
  SELECT account_holder_name INTO v_wallet FROM public.user_accounts
   WHERE user_id = v_chk.user_id AND account_type = 'personal' ORDER BY created_at LIMIT 1;
  IF COALESCE(btrim(v_wallet), '') <> '' AND NOT public.national_id_name_matches(v_wallet, v_chk.name_on_id) THEN
    RAISE EXCEPTION 'The wallet name (%) no longer fits the name on the ID (%). Reject it and ask them to correct the wallet name.', v_wallet, v_chk.name_on_id;
  END IF;

  SELECT * INTO v_mine FROM public.user_national_ids WHERE user_id = v_chk.user_id FOR UPDATE;

  IF v_chk.kind = 'verify' THEN
    IF v_mine.user_id IS NULL OR v_mine.id_hash <> v_chk.id_hash THEN
      RAISE EXCEPTION 'The ID on that wallet is no longer the one this request was about. Reject it.';
    END IF;
    UPDATE public.user_national_ids
       SET verified = true, verified_at = now(), verified_by = v_by, name_on_id = v_chk.name_on_id, updated_at = now()
     WHERE user_id = v_chk.user_id;
    UPDATE public.national_id_checks
       SET status = 'approved', review_note = left(v_note, 500), reviewed_by = v_by, reviewed_at = now()
     WHERE id = v_chk.id;
    RETURN jsonb_build_object('success', true, 'status', 'approved');
  END IF;

  -- kind = 'claim'
  IF v_mine.verified THEN
    RAISE EXCEPTION 'That wallet has since had a different ID verified. Reject this request.';
  END IF;
  SELECT * INTO v_holder FROM public.user_national_ids WHERE id_hash = v_chk.id_hash FOR UPDATE;
  IF v_holder.user_id IS NOT NULL AND v_holder.user_id <> v_chk.user_id THEN
    IF v_holder.verified AND NOT COALESCE(p_replace_verified, false) THEN
      RAISE EXCEPTION 'This ID belongs to a wallet that is already VERIFIED. Only take it away if you are certain; confirm the override to continue.';
    END IF;
    DELETE FROM public.user_national_ids WHERE user_id = v_holder.user_id;
  END IF;
  -- Whatever the claimant had saved before (a mistyped or borrowed ID) makes way for the real one.
  DELETE FROM public.user_national_ids WHERE user_id = v_chk.user_id;
  INSERT INTO public.user_national_ids
    (user_id, country_code, id_type, id_hash, id_last4, verified, verified_at, verified_by, name_on_id)
  VALUES
    (v_chk.user_id, v_chk.country_code, v_chk.id_type, v_chk.id_hash, v_chk.id_last4, true, now(), v_by, v_chk.name_on_id);

  UPDATE public.national_id_checks
     SET status = 'approved', review_note = left(v_note, 500), reviewed_by = v_by, reviewed_at = now(),
         displaced_user_id = CASE WHEN v_holder.user_id <> v_chk.user_id THEN v_holder.user_id END
   WHERE id = v_chk.id;
  -- Everything else still waiting on this ID (the old holder's own request, other claimants) is settled.
  UPDATE public.national_id_checks
     SET status = 'rejected', review_note = 'This ID was given to its verified owner.', reviewed_by = v_by, reviewed_at = now()
   WHERE id_hash = v_chk.id_hash AND status = 'pending' AND id <> v_chk.id;

  RETURN jsonb_build_object('success', true, 'status', 'approved', 'displacedUserId', v_holder.user_id);
END; $$;

-- ------------------------------------------------------------
-- 7. Grants
-- ------------------------------------------------------------
-- Supabase grants new functions to anon/authenticated by default, so PUBLIC alone is not enough.
REVOKE ALL ON FUNCTION public.request_my_id_verification(TEXT, TEXT, TEXT, TEXT)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_national_id(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_id_trust(UUID[])                                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.national_id_name_tokens(TEXT)                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.national_id_name_matches(TEXT, TEXT)                        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_my_id_verification(TEXT, TEXT, TEXT, TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_national_id(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_id_trust(UUID[])                                     TO authenticated;
-- Reviewer functions: guarded by the dev token, which only an allowlisted operator session can obtain.
REVOKE ALL ON FUNCTION public.ican_id_dev_list(TEXT, TEXT)                                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ican_id_dev_review(TEXT, UUID, BOOLEAN, TEXT, BOOLEAN)     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_id_dev_list(TEXT, TEXT)                             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ican_id_dev_review(TEXT, UUID, BOOLEAN, TEXT, BOOLEAN)  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'National ID ownership installed. Reviewers: Dev console > ID checks. Strict mode (require_verified) is OFF.' AS status;
