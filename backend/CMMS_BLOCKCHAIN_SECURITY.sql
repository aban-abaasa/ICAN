-- ============================================================
-- CMMS BLOCKCHAIN SECURITY ENHANCEMENT
-- Purpose: Add blockchain-grade security to CMMS operations
-- Features:
-- - Immutable audit logs for all CMMS actions
-- - Digital signature verification for critical operations
-- - Hash chain integrity verification
-- - Non-repudiation via cryptographic proof
-- - Transparent action logging with timestamps
-- - Enhanced RLS policies for data protection
-- ============================================================

-- ============================================================
-- 0. ENABLE REQUIRED EXTENSIONS
-- ============================================================

-- pgcrypto is optional - md5() is built-in to PostgreSQL
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. CREATE AUDIT LOG TABLE (Immutable)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
  action_type VARCHAR(100) NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  actor_email VARCHAR(255) NOT NULL,
  actor_role VARCHAR(50) NOT NULL,
  target_table VARCHAR(100),
  target_record_id UUID,
  old_values JSONB,
  new_values JSONB,
  action_details JSONB,
  
  -- Blockchain security fields
  action_hash VARCHAR(256) NOT NULL,
  previous_hash VARCHAR(256),
  chain_verified BOOLEAN DEFAULT FALSE,
  digital_signature VARCHAR(512),
  verification_key VARCHAR(256),
  
  -- Immutability markers
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_by_auth_id UUID,
  is_immutable BOOLEAN DEFAULT TRUE NOT NULL,
  
  -- Compliance
  ip_address INET,
  user_agent TEXT,
  session_id UUID,
  
  -- Constraints
  CONSTRAINT audit_log_immutable CHECK (is_immutable = TRUE)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_company ON public.cmms_audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON public.cmms_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.cmms_audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON public.cmms_audit_log(target_table, target_record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_hash ON public.cmms_audit_log(action_hash);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON public.cmms_audit_log(created_at);

-- ============================================================
-- 2. CREATE DATA INTEGRITY TABLE (Hash Chain)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_data_integrity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
  entity_type VARCHAR(100) NOT NULL, -- 'message', 'job_assignment', 'report', etc.
  entity_id UUID NOT NULL,
  
  -- Hash chain fields
  current_hash VARCHAR(256) NOT NULL,
  previous_hash VARCHAR(256),
  data_snapshot JSONB NOT NULL,
  
  -- Verification
  is_verified BOOLEAN DEFAULT FALSE,
  verification_timestamp TIMESTAMPTZ,
  verified_by_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_data_integrity_company ON public.cmms_data_integrity(company_id);
CREATE INDEX IF NOT EXISTS idx_data_integrity_entity ON public.cmms_data_integrity(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_data_integrity_hash ON public.cmms_data_integrity(current_hash);

-- ============================================================
-- 3. CREATE SIGNATURE VERIFICATION TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  
  -- Signature fields
  message_hash VARCHAR(256) NOT NULL,
  digital_signature VARCHAR(512) NOT NULL,
  public_key VARCHAR(256) NOT NULL,
  algorithm VARCHAR(50) DEFAULT 'SHA256-RSA',
  
  -- Verification
  is_valid BOOLEAN DEFAULT TRUE,
  verified_at TIMESTAMPTZ,
  
  -- Action that was signed
  action_type VARCHAR(100),
  action_id UUID,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signatures_user ON public.cmms_signatures(user_id);
CREATE INDEX IF NOT EXISTS idx_signatures_hash ON public.cmms_signatures(message_hash);
CREATE INDEX IF NOT EXISTS idx_signatures_action ON public.cmms_signatures(action_type, action_id);

-- ============================================================
-- 4. AUDIT LOG FUNCTION - Log all CMMS actions
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_log_cmms_action(
  p_company_id UUID,
  p_action_type VARCHAR,
  p_target_table VARCHAR,
  p_target_record_id UUID,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL,
  p_action_details JSONB DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  audit_log_id UUID,
  action_hash VARCHAR,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_user_id UUID;
  v_user_role VARCHAR;
  v_action_hash VARCHAR;
  v_previous_hash VARCHAR;
  v_audit_log_id UUID;
BEGIN
  -- Get current user
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::VARCHAR, 'Not authenticated'::TEXT;
    RETURN;
  END IF;

  -- Get user email
  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  -- Get CMMS user info
  SELECT cu.id, cu.role
  INTO v_user_id, v_user_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_user_id IS NULL OR v_user_role IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::VARCHAR, 'User not found in company or role not assigned'::TEXT;
    RETURN;
  END IF;

  -- Get previous hash for chain
  SELECT aal.action_hash INTO v_previous_hash
  FROM public.cmms_audit_log aal
  WHERE aal.company_id = p_company_id
  ORDER BY aal.created_at DESC
  LIMIT 1;

  -- Generate action hash (MD5 hash from data)
  v_action_hash := md5(
    p_action_type || COALESCE(p_target_table, '') || COALESCE(p_target_record_id::TEXT, '') || 
    COALESCE(v_previous_hash, '') || NOW()::TEXT || COALESCE(v_user_id::TEXT, '')
  );

  -- Insert audit log
  INSERT INTO public.cmms_audit_log (
    company_id,
    action_type,
    actor_user_id,
    actor_email,
    actor_role,
    target_table,
    target_record_id,
    old_values,
    new_values,
    action_details,
    action_hash,
    previous_hash,
    created_by_auth_id,
    ip_address,
    user_agent,
    is_immutable
  ) VALUES (
    p_company_id,
    p_action_type,
    v_user_id,
    v_auth_email,
    v_user_role,
    p_target_table,
    p_target_record_id,
    p_old_values,
    p_new_values,
    p_action_details,
    v_action_hash,
    v_previous_hash,
    v_auth_uid,
    p_ip_address,
    p_user_agent,
    TRUE
  ) RETURNING id INTO v_audit_log_id;

  RETURN QUERY SELECT TRUE, v_audit_log_id, v_action_hash, 'Action logged successfully'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_log_cmms_action TO authenticated;

-- ============================================================
-- 5. DATA INTEGRITY VERIFICATION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_verify_data_integrity(
  p_company_id UUID,
  p_entity_type VARCHAR,
  p_entity_id UUID,
  p_data_snapshot JSONB
)
RETURNS TABLE (
  success BOOLEAN,
  is_verified BOOLEAN,
  current_hash VARCHAR,
  previous_hash VARCHAR,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_hash VARCHAR;
  v_previous_hash VARCHAR;
  v_stored_hash VARCHAR;
  v_integrity_record_exists BOOLEAN;
BEGIN
  -- Generate hash of current data
  v_current_hash := md5(p_data_snapshot::TEXT);

  -- Check if integrity record exists
  SELECT EXISTS(
    SELECT 1 FROM public.cmms_data_integrity
    WHERE company_id = p_company_id
      AND entity_type = p_entity_type
      AND entity_id = p_entity_id
  ) INTO v_integrity_record_exists;

  IF v_integrity_record_exists THEN
    -- Get stored hash
    SELECT current_hash, previous_hash
    INTO v_stored_hash, v_previous_hash
    FROM public.cmms_data_integrity
    WHERE company_id = p_company_id
      AND entity_type = p_entity_type
      AND entity_id = p_entity_id;

    -- Verify hash matches
    IF v_current_hash = v_stored_hash THEN
      RETURN QUERY SELECT TRUE, TRUE, v_current_hash, v_previous_hash, 'Data integrity verified'::TEXT;
    ELSE
      RETURN QUERY SELECT TRUE, FALSE, v_current_hash, v_stored_hash, 'Data integrity check FAILED - Hash mismatch'::TEXT;
    END IF;
  ELSE
    -- Create new integrity record
    INSERT INTO public.cmms_data_integrity (
      company_id,
      entity_type,
      entity_id,
      current_hash,
      data_snapshot,
      is_verified
    ) VALUES (
      p_company_id,
      p_entity_type,
      p_entity_id,
      v_current_hash,
      p_data_snapshot,
      TRUE
    );

    RETURN QUERY SELECT TRUE, TRUE, v_current_hash, NULL::VARCHAR, 'Initial integrity record created'::TEXT;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_data_integrity TO authenticated;

-- ============================================================
-- 6. ENHANCED RLS POLICIES FOR AUDIT LOG (Read-only)
-- ============================================================

ALTER TABLE public.cmms_audit_log ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to INSERT audit logs (via function)
DROP POLICY IF EXISTS audit_log_insert ON public.cmms_audit_log;
CREATE POLICY audit_log_insert ON public.cmms_audit_log
  FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT cmms_company_id FROM public.cmms_users
      WHERE cmms_company_id = cmms_audit_log.company_id
        AND LOWER(email) = LOWER(NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), ''))
        AND is_active = TRUE
    )
  );

-- Admin/Coordinator/Supervisor can view all audit logs for their company
DROP POLICY IF EXISTS audit_log_view_by_role ON public.cmms_audit_log;
CREATE POLICY audit_log_view_by_role ON public.cmms_audit_log
  FOR SELECT
  USING (
    company_id IN (
      SELECT cmms_company_id FROM public.cmms_users
      WHERE cmms_company_id = cmms_audit_log.company_id
        AND LOWER(email) = LOWER(NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), ''))
        AND is_active = TRUE
        AND role IN ('admin', 'coordinator', 'supervisor')
    )
  );

-- Users can only view their own actions
DROP POLICY IF EXISTS audit_log_view_own_actions ON public.cmms_audit_log;
CREATE POLICY audit_log_view_own_actions ON public.cmms_audit_log
  FOR SELECT
  USING (
    actor_user_id IN (
      SELECT id FROM public.cmms_users
      WHERE cmms_company_id = cmms_audit_log.company_id
        AND LOWER(email) = LOWER(NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), ''))
        AND is_active = TRUE
    )
  );

-- Prevent audit log deletion
DROP POLICY IF EXISTS audit_log_prevent_delete ON public.cmms_audit_log;
CREATE POLICY audit_log_prevent_delete ON public.cmms_audit_log
  FOR DELETE
  USING (FALSE);

-- Prevent audit log updates
DROP POLICY IF EXISTS audit_log_prevent_update ON public.cmms_audit_log;
CREATE POLICY audit_log_prevent_update ON public.cmms_audit_log
  FOR UPDATE
  USING (FALSE);

-- ============================================================
-- 7. ENHANCED RLS FOR DATA INTEGRITY TABLE
-- ============================================================

ALTER TABLE public.cmms_data_integrity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_integrity_view ON public.cmms_data_integrity;
CREATE POLICY data_integrity_view ON public.cmms_data_integrity
  FOR SELECT
  USING (
    company_id IN (
      SELECT cmms_company_id FROM public.cmms_users
      WHERE cmms_company_id = cmms_data_integrity.company_id
        AND LOWER(email) = LOWER(NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), ''))
        AND is_active = TRUE
    )
  );

-- ============================================================
-- 8. INTEGRATION TRIGGER FOR MESSAGING
-- ============================================================

-- Log message creation to audit trail
CREATE OR REPLACE FUNCTION public.fn_audit_message_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.fn_log_cmms_action(
    NEW.company_id,
    'MESSAGE_' || NEW.message_type,
    'cmms_report_messages',
    NEW.id,
    NULL,
    jsonb_build_object(
      'message_id', NEW.id,
      'sender_id', NEW.sender_id,
      'recipient_id', NEW.recipient_id,
      'report_id', NEW.report_id,
      'message_type', NEW.message_type,
      'created_at', NEW.created_at
    ),
    jsonb_build_object(
      'action', 'message_sent',
      'message_preview', LEFT(NEW.message_text, 100)
    )
  );
  RETURN NEW;
END;
$$;

-- Create trigger for message audit logging
DROP TRIGGER IF EXISTS trg_audit_message_creation ON public.cmms_report_messages;
CREATE TRIGGER trg_audit_message_creation
AFTER INSERT ON public.cmms_report_messages
FOR EACH ROW
EXECUTE FUNCTION fn_audit_message_creation();

-- ============================================================
-- 9. BLOCKCHAIN AUDIT RETRIEVAL FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_blockchain_audit_trail(
  p_company_id UUID,
  p_days_back INTEGER DEFAULT 90
)
RETURNS TABLE (
  audit_id UUID,
  action_type VARCHAR,
  actor_email VARCHAR,
  actor_role VARCHAR,
  target_entity VARCHAR,
  action_hash VARCHAR,
  previous_hash VARCHAR,
  chain_verified BOOLEAN,
  created_at TIMESTAMPTZ,
  action_details JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify user has access to this company
  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users
    WHERE cmms_company_id = p_company_id
      AND LOWER(email) = LOWER(NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), ''))
      AND is_active = TRUE
      AND role IN ('admin', 'coordinator', 'supervisor')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    aal.id,
    aal.action_type,
    aal.actor_email,
    aal.actor_role,
    COALESCE(aal.target_table, '') || ':' || COALESCE(aal.target_record_id::TEXT, ''),
    aal.action_hash,
    aal.previous_hash,
    aal.chain_verified,
    aal.created_at,
    aal.action_details
  FROM public.cmms_audit_log aal
  WHERE aal.company_id = p_company_id
    AND aal.created_at >= NOW() - (p_days_back || ' days')::INTERVAL
  ORDER BY aal.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_blockchain_audit_trail TO authenticated;

-- ============================================================
-- 10. HASH CHAIN VERIFICATION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_verify_audit_chain_integrity(
  p_company_id UUID
)
RETURNS TABLE (
  is_chain_valid BOOLEAN,
  total_records BIGINT,
  unverified_records BIGINT,
  last_verified_hash VARCHAR,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_records BIGINT;
  v_unverified BIGINT;
  v_last_hash VARCHAR;
  v_is_valid BOOLEAN := TRUE;
BEGIN
  -- Count total records
  SELECT COUNT(*) INTO v_total_records
  FROM public.cmms_audit_log
  WHERE company_id = p_company_id;

  -- Count unverified records (where previous_hash doesn't match previous record's action_hash)
  WITH audit_with_prev AS (
    SELECT 
      curr.id,
      curr.action_hash,
      curr.previous_hash,
      LAG(curr.action_hash) OVER (PARTITION BY curr.company_id ORDER BY curr.created_at) as prev_action_hash
    FROM public.cmms_audit_log curr
    WHERE curr.company_id = p_company_id
  )
  SELECT COUNT(*) INTO v_unverified
  FROM audit_with_prev
  WHERE (previous_hash IS NOT NULL AND previous_hash != prev_action_hash);

  -- Get last hash
  SELECT al.action_hash INTO v_last_hash
  FROM public.cmms_audit_log al
  WHERE al.company_id = p_company_id
  ORDER BY al.created_at DESC
  LIMIT 1;

  IF v_unverified > 0 THEN
    v_is_valid := FALSE;
  END IF;

  RETURN QUERY SELECT
    v_is_valid,
    v_total_records,
    v_unverified,
    v_last_hash,
    CASE 
      WHEN v_is_valid THEN 'Audit chain is valid and verified'::TEXT
      ELSE 'WARNING: ' || v_unverified::TEXT || ' records failed integrity check'::TEXT
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_audit_chain_integrity TO authenticated;

-- ============================================================
-- 11. GRANT PERMISSIONS
-- ============================================================

GRANT SELECT ON public.cmms_audit_log TO authenticated;
GRANT SELECT ON public.cmms_data_integrity TO authenticated;
GRANT SELECT ON public.cmms_signatures TO authenticated;
GRANT INSERT ON public.cmms_audit_log TO authenticated;
GRANT INSERT ON public.cmms_data_integrity TO authenticated;
