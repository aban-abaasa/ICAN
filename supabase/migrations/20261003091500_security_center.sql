-- ============================================================================
-- Security Center (My Profile > Security): real devices, real sign-in history.
-- ============================================================================
-- Functions only: no new tables, and nothing is installed on Supabase's auth
-- tables (no triggers there, so sign-in can never be affected by this file).
--
--   ican_security_list_sessions()           the caller's live sessions (auth.sessions)
--   ican_security_revoke_session(uuid)      sign one of the caller's OTHER devices out
--   ican_security_activity(limit)           the caller's sign-in / security history
--                                           (auth.audit_log_entries), flagging first-time IPs
--   ican_security_password_changed_at()     when the caller's password was last set or changed
--
-- Every function is SECURITY DEFINER but scoped to auth.uid() in its WHERE clause,
-- so a signed-in user can only ever see or end their own sessions. Deleting a row
-- from auth.sessions cascades to its refresh tokens, which is how Supabase itself
-- ends a session, so a revoked device cannot silently refresh back in.
--
-- Password change, two-step verification (TOTP), "sign out other devices" and
-- "sign out everywhere" use Supabase Auth's own APIs from the client.
-- ============================================================================

-- Live sessions -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_security_list_sessions()
RETURNS TABLE (
  id             UUID,
  created_at     TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,
  user_agent     TEXT,
  ip             TEXT,
  aal            TEXT,
  is_current     BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT s.id,
         s.created_at,
         GREATEST(s.created_at, s.updated_at, (s.refreshed_at AT TIME ZONE 'utc')) AS last_active_at,
         s.user_agent,
         host(s.ip),
         s.aal::text,
         s.id::text = COALESCE(auth.jwt() ->> 'session_id', '') AS is_current
    FROM auth.sessions s
   WHERE s.user_id = auth.uid()
     AND (s.not_after IS NULL OR s.not_after > now())
   ORDER BY 3 DESC;
$$;

-- End another device's session -----------------------------------------------
-- The current session is refused on purpose: signing yourself out goes through
-- supabase.auth.signOut(), which also clears the browser's stored session.
CREATE OR REPLACE FUNCTION public.ican_security_revoke_session(p_session_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF auth.uid() IS NULL OR p_session_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF p_session_id::text = COALESCE(auth.jwt() ->> 'session_id', '') THEN
    RAISE EXCEPTION 'Use Sign out to end this device''s own session';
  END IF;

  DELETE FROM auth.sessions WHERE id = p_session_id AND user_id = auth.uid();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

-- Sign-in and security history ------------------------------------------------
-- Only events that mean something to a person: not the thousands of silent token
-- refreshes. Shows the last 180 days. A login from an IP this account has never
-- signed in from before (judged against the WHOLE history, not just the window, so
-- a long-used IP is never mislabelled) is flagged so it stands out.
-- Note: auth.audit_log_entries has no index on the actor, so each call reads the
-- table once whatever the window; that is fine at this size and is one read, not two.
CREATE OR REPLACE FUNCTION public.ican_security_activity(p_limit INTEGER DEFAULT 30)
RETURNS TABLE (
  id         TEXT,
  action     TEXT,
  created_at TIMESTAMPTZ,
  ip         TEXT,
  is_new_ip  BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH mine AS (
    SELECT e.id::text                AS id,
           e.payload ->> 'action'    AS action,
           e.created_at,
           NULLIF(btrim(e.ip_address), '') AS ip
      FROM auth.audit_log_entries e
     WHERE e.payload ->> 'actor_id' = auth.uid()::text
       AND e.payload ->> 'action' IN (
             'login', 'logout', 'user_signedup', 'user_updated_password', 'user_recovery_requested',
             'user_reauthenticate_requested', 'factor_in_progress', 'factor_unenrolled', 'factor_deleted',
             'verification_attempted', 'mfa_code_login')
  )
  SELECT m.id, m.action, m.created_at, m.ip,
         (m.action = 'login' AND m.ip IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM mine p
             WHERE p.action = 'login' AND p.ip = m.ip AND p.created_at < m.created_at)) AS is_new_ip
    FROM mine m
   WHERE m.created_at > now() - INTERVAL '180 days'
   ORDER BY m.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
$$;

-- When the password was last set or changed (all time, not just the 180-day window),
-- so "your password is over a year old" is judged on the real date.
CREATE OR REPLACE FUNCTION public.ican_security_password_changed_at()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT max(e.created_at)
    FROM auth.audit_log_entries e
   WHERE e.payload ->> 'actor_id' = auth.uid()::text
     AND e.payload ->> 'action' = 'user_updated_password';
$$;

REVOKE ALL ON FUNCTION public.ican_security_list_sessions()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_security_revoke_session(UUID)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_security_activity(INTEGER)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_security_password_changed_at()      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_security_list_sessions()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_security_revoke_session(UUID)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_security_activity(INTEGER)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_security_password_changed_at()   TO authenticated;

NOTIFY pgrst, 'reload schema';
