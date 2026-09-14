-- ===========================================================================
-- ICAN SECURITY CANWE SHIELD
--
-- Durable, cross-request storage for the deception-based bot/attacker
-- detection layer (see backend/middleware/canweShield.js and
-- frontend/src/components/security/CanweFields.jsx). Deliberately named
-- something generic rather than a recognizable security term, so a reader
-- of the client bundle or this schema can't identify the mechanism by
-- keyword search. Two tables:
--
--   security_threat_events  — append-only audit log, one row per trigger.
--   security_flagged_ips    — current reputation state per IP, so a flag
--                             raised by one request is visible to the very
--                             next request (and to every serverless cold
--                             start) without needing an in-memory process.
--
-- Both are written ONLY through the SECURITY DEFINER functions below,
-- callable only by service_role — the Vercel function / Express process
-- holds the service key, callers never do. Same pattern as
-- ICAN_FIAT_MOBILE_MONEY_SEND_MIGRATION.sql's request/resolve functions.
--
-- Safe to run multiple times.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS security_threat_events (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address    TEXT NOT NULL,
  user_agent    TEXT,
  trigger_type  TEXT NOT NULL CHECK (trigger_type IN ('honeytoken_field', 'decoy_route', 'decoy_link')),
  route         TEXT,
  http_method   TEXT,
  payload       JSONB,
  app_name      TEXT NOT NULL DEFAULT 'ican'
);

CREATE INDEX IF NOT EXISTS idx_sec_threat_ip        ON security_threat_events(ip_address);
CREATE INDEX IF NOT EXISTS idx_sec_threat_occurred   ON security_threat_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_threat_app        ON security_threat_events(app_name);

CREATE TABLE IF NOT EXISTS security_flagged_ips (
  ip_address    TEXT NOT NULL,
  app_name      TEXT NOT NULL DEFAULT 'ican',
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count     INT NOT NULL DEFAULT 1,
  severity      TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  last_trigger  TEXT,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  PRIMARY KEY (ip_address, app_name)
);

CREATE INDEX IF NOT EXISTS idx_sec_flagged_expires ON security_flagged_ips(expires_at);

ALTER TABLE security_threat_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_flagged_ips   ENABLE ROW LEVEL SECURITY;

-- Read-only for developers via the dashboard (mbg_users is the shared
-- cross-app role table this Supabase project already uses — see
-- ICAN_FIAT_MOBILE_MONEY_SEND_MIGRATION.sql SECTION 2). No INSERT/UPDATE
-- policy for anyone — writes only ever happen through the functions below.
DROP POLICY IF EXISTS "sec_threat_events_developer_read" ON security_threat_events;
CREATE POLICY "sec_threat_events_developer_read" ON security_threat_events
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users mu
      WHERE mu.id = auth.uid() AND mu.role_type = 'developer' AND mu.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "sec_flagged_ips_developer_read" ON security_flagged_ips;
CREATE POLICY "sec_flagged_ips_developer_read" ON security_flagged_ips
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users mu
      WHERE mu.id = auth.uid() AND mu.role_type = 'developer' AND mu.is_active = TRUE
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
-- log_security_threat: records one trigger event and bumps that IP's
-- reputation row (insert-or-increment). Severity escalates automatically
-- with repeat hits regardless of what the caller passes, so a bot that
-- keeps probing after being flagged still climbs to 'critical'.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_security_threat(
  p_ip           TEXT,
  p_user_agent   TEXT,
  p_trigger_type TEXT,
  p_route        TEXT DEFAULT NULL,
  p_http_method  TEXT DEFAULT NULL,
  p_payload      JSONB DEFAULT NULL,
  p_app_name     TEXT DEFAULT 'ican',
  p_severity     TEXT DEFAULT 'medium'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hit_count INT;
  v_severity  TEXT;
BEGIN
  IF p_ip IS NULL OR length(trim(p_ip)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ip_address is required');
  END IF;

  INSERT INTO security_threat_events (ip_address, user_agent, trigger_type, route, http_method, payload, app_name)
  VALUES (trim(p_ip), p_user_agent, p_trigger_type, p_route, p_http_method, p_payload, p_app_name);

  INSERT INTO security_flagged_ips (ip_address, app_name, hit_count, severity, last_trigger, expires_at)
  VALUES (trim(p_ip), p_app_name, 1, p_severity, p_trigger_type, now() + interval '7 days')
  ON CONFLICT (ip_address, app_name) DO UPDATE SET
    hit_count    = security_flagged_ips.hit_count + 1,
    last_seen    = now(),
    last_trigger = EXCLUDED.last_trigger,
    severity     = CASE
                     WHEN security_flagged_ips.hit_count + 1 >= 5 THEN 'critical'
                     WHEN security_flagged_ips.hit_count + 1 >= 2 THEN 'high'
                     ELSE EXCLUDED.severity
                   END,
    expires_at   = now() + interval '7 days'
  RETURNING hit_count, severity INTO v_hit_count, v_severity;

  RETURN jsonb_build_object('success', true, 'hit_count', v_hit_count, 'severity', v_severity);
END;
$$;

REVOKE ALL ON FUNCTION log_security_threat FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_security_threat TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- check_ip_flagged: cheap reputation lookup. Expired flags (7-day TTL) are
-- treated as clean without needing a cleanup job.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_ip_flagged(
  p_ip       TEXT,
  p_app_name TEXT DEFAULT 'ican'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row security_flagged_ips;
BEGIN
  SELECT * INTO v_row
  FROM security_flagged_ips
  WHERE ip_address = trim(p_ip) AND app_name = p_app_name AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('flagged', false);
  END IF;

  RETURN jsonb_build_object('flagged', true, 'hit_count', v_row.hit_count, 'severity', v_row.severity);
END;
$$;

REVOKE ALL ON FUNCTION check_ip_flagged FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_ip_flagged TO service_role;

SELECT 'ICAN Security Canwe Shield — complete' AS status, now() AS run_at;
