-- Undo 20261115100000_biometric_signin.sql: removes fingerprint / face sign-in for everyone.
-- People simply sign in with their password (or Google / wallet PIN) again; no account is touched.
DROP TABLE IF EXISTS public.passkey_challenges;
DROP TABLE IF EXISTS public.user_passkeys;
