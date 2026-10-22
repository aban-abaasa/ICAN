\set ON_ERROR_STOP on
-- auth.jwt() the way Supabase has it: the claims of the current request. The allowlist + secret code that follows is the REAL one
-- (cut out of 20261009100000_secure_dev_access.sql by run.sh); only the way a test pretends to be someone is a stand-in.
CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS
  $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::JSONB $$;

-- be a signed-in user with this email (NULL = a session with no email at all)
CREATE FUNCTION t.as_email(p_email TEXT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', t.u(9000)::TEXT, false);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_email IS NULL THEN '{}' ELSE jsonb_build_object('email', p_email)::TEXT END, false);
  EXECUTE 'SET ROLE authenticated'; END $$;
GRANT EXECUTE ON FUNCTION t.as_email(TEXT) TO PUBLIC;
