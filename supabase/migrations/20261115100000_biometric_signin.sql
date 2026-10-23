-- ============================================================================
-- Fingerprint / face sign-in (passkeys): the tables behind the passkey-auth Edge Function.
-- ============================================================================
-- The phone or laptop checks the fingerprint / face itself and signs a one-time challenge with a private key that never
-- leaves its secure hardware. All the database ever holds is the matching PUBLIC key - no fingerprint, no face, no image.
--
--   user_passkeys        one row per fingerprint/face-enabled device (public key + counter). A signed-in person can LIST
--                        and REMOVE their own; rows are created and updated only by the Edge Function (service role),
--                        after it has verified the device's proof.
--   passkey_challenges   the one-time challenges the Edge Function hands out. Single use, minutes-long life. Nobody but
--                        the service role can touch it (RLS on, no policies).
--
-- Safe to run twice. Nothing here touches Supabase's auth tables, so ordinary sign-in can never be affected by this file.
-- ============================================================================

-- Devices ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_passkeys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,                       -- base64url; the device's id for this key (not a secret)
  public_key    TEXT NOT NULL,                              -- base64url SubjectPublicKeyInfo
  alg           INTEGER NOT NULL CHECK (alg IN (-7, -257)), -- COSE: -7 ES256, -257 RS256
  rp_id         TEXT NOT NULL,                              -- the site the key is bound to (e.g. app.example.com)
  sign_count    BIGINT NOT NULL DEFAULT 0,                  -- replay / clone guard; stays 0 on synced passkeys
  transports    TEXT[] NOT NULL DEFAULT '{}',
  backed_up     BOOLEAN NOT NULL DEFAULT false,             -- synced to the person's cloud keychain
  label         TEXT NOT NULL DEFAULT 'This device',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_passkeys_user_id_idx ON public.user_passkeys (user_id);

ALTER TABLE public.user_passkeys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_passkeys_select_own ON public.user_passkeys;
CREATE POLICY user_passkeys_select_own ON public.user_passkeys
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_passkeys_delete_own ON public.user_passkeys;
CREATE POLICY user_passkeys_delete_own ON public.user_passkeys
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Own rows, and only the columns the settings screen shows: the public key and counter stay server-side.
REVOKE ALL ON TABLE public.user_passkeys FROM anon, authenticated;
GRANT SELECT (id, user_id, credential_id, label, transports, backed_up, created_at, last_used_at) ON public.user_passkeys TO authenticated;
GRANT DELETE ON public.user_passkeys TO authenticated;
GRANT ALL ON public.user_passkeys TO service_role;

-- One-time challenges ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.passkey_challenges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge  TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- set for 'register'; sign-in does not know who yet
  origin     TEXT NOT NULL,                                     -- the page the challenge was issued to
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS passkey_challenges_expires_at_idx ON public.passkey_challenges (expires_at);

ALTER TABLE public.passkey_challenges ENABLE ROW LEVEL SECURITY;   -- no policies: service role only
REVOKE ALL ON TABLE public.passkey_challenges FROM anon, authenticated;
GRANT ALL ON public.passkey_challenges TO service_role;

COMMENT ON TABLE public.user_passkeys IS 'Fingerprint / face sign-in: one public key per enabled device. Written only by the passkey-auth Edge Function.';
COMMENT ON TABLE public.passkey_challenges IS 'One-time challenges for passkey-auth. Service role only.';
