-- =====================================================
-- CMMS MESSAGING FUNCTIONS - MESSAGE UPDATE/DELETE FIX
-- =====================================================
-- Fixes for marking messages as read and deleting messages
-- All operations use SECURITY DEFINER for proper authorization
-- =====================================================

-- =====================================================
-- FUNCTION: Mark Message as Read
-- =====================================================

DROP FUNCTION IF EXISTS public.fn_mark_message_as_read(UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.fn_mark_message_as_read(
    p_message_id UUID
)
RETURNS TABLE (
    success BOOLEAN,
    message VARCHAR,
    data JSON
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auth_uid UUID;
    v_auth_email TEXT;
    v_auth_user_id UUID;
    v_company_id UUID;
    v_sender_id UUID;
    v_recipient_id UUID;
    v_updated_count INT;
    v_data JSON;
BEGIN
    -- Authenticate
    v_auth_uid := auth.uid();
    IF v_auth_uid IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Not authenticated'::VARCHAR, NULL::JSON;
        RETURN;
    END IF;

    -- Get auth email
    v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
    IF v_auth_email IS NULL THEN
        SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
    END IF;

    -- Find CMMS user for this auth account
    SELECT cu.id, cu.cmms_company_id
    INTO v_auth_user_id, v_company_id
    FROM public.cmms_users cu
    WHERE LOWER(cu.email) = LOWER(v_auth_email)
      AND cu.is_active = TRUE
    LIMIT 1;

    IF v_auth_user_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Not a CMMS member'::VARCHAR, NULL::JSON;
        RETURN;
    END IF;

    -- Get message sender and recipient
    SELECT crm.sender_id, crm.recipient_id
    INTO v_sender_id, v_recipient_id
    FROM public.cmms_report_messages crm
    WHERE crm.id = p_message_id
      AND crm.company_id = v_company_id;

    IF v_sender_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Message not found or unauthorized'::VARCHAR, NULL::JSON;
        RETURN;
    END IF;

    -- Authorization: Can only mark own messages as read
    IF v_auth_user_id != v_sender_id AND v_auth_user_id != v_recipient_id THEN
        RETURN QUERY SELECT FALSE, 'Unauthorized to mark this message as read'::VARCHAR, NULL::JSON;
        RETURN;
    END IF;

    -- Update message
    UPDATE public.cmms_report_messages
    SET is_read = TRUE
    WHERE id = p_message_id
      AND company_id = v_company_id;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
        RETURN QUERY SELECT FALSE, 'Failed to mark message as read'::VARCHAR, NULL::JSON;
        RETURN;
    END IF;

    -- Fetch updated record
    SELECT row_to_json(crm.*)
    INTO v_data
    FROM public.cmms_report_messages crm
    WHERE crm.id = p_message_id;

    RETURN QUERY SELECT TRUE, 'Message marked as read'::VARCHAR, v_data;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_mark_message_as_read(UUID) TO authenticated;

-- =====================================================
-- FUNCTION: Delete Message
-- =====================================================

DROP FUNCTION IF EXISTS public.fn_delete_message(UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.fn_delete_message(
    p_message_id UUID
)
RETURNS TABLE (
    success BOOLEAN,
    message VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auth_uid UUID;
    v_auth_email TEXT;
    v_auth_user_id UUID;
    v_company_id UUID;
    v_sender_id UUID;
    v_deleted_count INT;
BEGIN
    -- Authenticate
    v_auth_uid := auth.uid();
    IF v_auth_uid IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Not authenticated'::VARCHAR;
        RETURN;
    END IF;

    -- Get auth email
    v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
    IF v_auth_email IS NULL THEN
        SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
    END IF;

    -- Find CMMS user for this auth account
    SELECT cu.id, cu.cmms_company_id
    INTO v_auth_user_id, v_company_id
    FROM public.cmms_users cu
    WHERE LOWER(cu.email) = LOWER(v_auth_email)
      AND cu.is_active = TRUE
    LIMIT 1;

    IF v_auth_user_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Not a CMMS member'::VARCHAR;
        RETURN;
    END IF;

    -- Get message sender
    SELECT crm.sender_id
    INTO v_sender_id
    FROM public.cmms_report_messages crm
    WHERE crm.id = p_message_id
      AND crm.company_id = v_company_id;

    IF v_sender_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Message not found or unauthorized'::VARCHAR;
        RETURN;
    END IF;

    -- Authorization: Only sender can delete their own message
    IF v_auth_user_id != v_sender_id THEN
        RETURN QUERY SELECT FALSE, 'Unauthorized to delete this message'::VARCHAR;
        RETURN;
    END IF;

    -- Delete message
    DELETE FROM public.cmms_report_messages
    WHERE id = p_message_id
      AND company_id = v_company_id
      AND sender_id = v_auth_user_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    IF v_deleted_count = 0 THEN
        RETURN QUERY SELECT FALSE, 'Failed to delete message'::VARCHAR;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, 'Message deleted successfully'::VARCHAR;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_delete_message(UUID) TO authenticated;

-- =====================================================
-- VERIFICATION
-- =====================================================

-- Verify functions exist
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'fn_mark_message_as_read',
    'fn_delete_message',
    'fn_send_report_message',
    'fn_get_report_messages'
  )
ORDER BY routine_name;

-- Expected output: 4 functions should exist
