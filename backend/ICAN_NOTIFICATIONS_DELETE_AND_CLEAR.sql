-- ============================================================================
-- Notifications: let a user delete one notification, or clean up (clear) all
-- of their existing notifications, across every notification source in ICAN.
-- ============================================================================
-- Run in the Supabase SQL editor. Additive only -- does not touch existing
-- tables, columns, triggers or RLS policies.
--
-- Covers the five tables the frontend already reads from:
--   - public.investment_notifications   (universalNotificationsService.js)
--   - public.shareholder_notifications  (universalNotificationsService.js)
--   - public.cmms_notifications         (universalNotificationsService.js)
--   - public.notifications              (universalNotificationsService.js, "legacy")
--   - public.ican_wallet_inbox_notifications (ICANWalletInbox.jsx)
--
-- Both functions are SECURITY DEFINER but scope every DELETE to auth.uid()
-- in the WHERE clause, so a signed-in user can only ever remove their own
-- rows -- this is the same "definer function, but still self-scoped" shape
-- as the existing ican_mark_wallet_inbox_read().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ican_delete_notification(p_source TEXT, p_source_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_deleted BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR p_source_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF p_source = 'investment_notifications' THEN
    DELETE FROM public.investment_notifications
     WHERE id = p_source_id AND recipient_id = auth.uid();
    v_deleted := FOUND;

  ELSIF p_source = 'shareholder_notifications' THEN
    DELETE FROM public.shareholder_notifications
     WHERE id = p_source_id AND shareholder_id = auth.uid();
    v_deleted := FOUND;

  ELSIF p_source = 'cmms_notifications' THEN
    DELETE FROM public.cmms_notifications
     WHERE id = p_source_id
       AND cmms_user_id IN (SELECT id FROM public.cmms_users WHERE email = auth.jwt() ->> 'email');
    v_deleted := FOUND;

  ELSIF p_source = 'notifications' THEN
    DELETE FROM public.notifications
     WHERE id = p_source_id AND user_id = auth.uid();
    v_deleted := FOUND;

  ELSIF p_source = 'ican_wallet_inbox_notifications' THEN
    DELETE FROM public.ican_wallet_inbox_notifications
     WHERE id = p_source_id AND recipient_user_id = auth.uid();
    v_deleted := FOUND;
  END IF;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.ican_delete_notification(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_delete_notification(TEXT, UUID) TO authenticated;

-- "Clean" action: wipe every existing notification for the signed-in user,
-- or just the already-read ones, across all five sources in one call.
CREATE OR REPLACE FUNCTION public.ican_clear_notifications(p_read_only BOOLEAN DEFAULT FALSE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count INTEGER := 0;
  v_rows INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.investment_notifications
   WHERE recipient_id = auth.uid()
     AND (NOT COALESCE(p_read_only, FALSE) OR is_read = TRUE);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_count := v_count + v_rows;

  DELETE FROM public.shareholder_notifications
   WHERE shareholder_id = auth.uid()
     AND (NOT COALESCE(p_read_only, FALSE) OR read_at IS NOT NULL);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_count := v_count + v_rows;

  DELETE FROM public.cmms_notifications
   WHERE cmms_user_id IN (SELECT id FROM public.cmms_users WHERE email = auth.jwt() ->> 'email')
     AND (NOT COALESCE(p_read_only, FALSE) OR is_read = TRUE);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_count := v_count + v_rows;

  DELETE FROM public.notifications
   WHERE user_id = auth.uid()
     AND (NOT COALESCE(p_read_only, FALSE) OR status = 'read' OR read_at IS NOT NULL);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_count := v_count + v_rows;

  DELETE FROM public.ican_wallet_inbox_notifications
   WHERE recipient_user_id = auth.uid()
     AND (NOT COALESCE(p_read_only, FALSE) OR read_at IS NOT NULL);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_count := v_count + v_rows;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ican_clear_notifications(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_clear_notifications(BOOLEAN) TO authenticated;

-- Delete-own-row RPCs for the shared ICANera Wallet inbox specifically,
-- mirroring ican_get_wallet_inbox() / ican_mark_wallet_inbox_read() so
-- ICANWalletInbox.jsx does not need to know about the generic source names.
CREATE OR REPLACE FUNCTION public.ican_delete_wallet_inbox_notification(p_notification_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  DELETE FROM public.ican_wallet_inbox_notifications
   WHERE id = p_notification_id AND recipient_user_id = auth.uid()
  RETURNING TRUE;
$$;

CREATE OR REPLACE FUNCTION public.ican_clear_wallet_inbox(p_read_only BOOLEAN DEFAULT FALSE)
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM public.ican_wallet_inbox_notifications
     WHERE recipient_user_id = auth.uid()
       AND (NOT COALESCE(p_read_only, FALSE) OR read_at IS NOT NULL)
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;

REVOKE ALL ON FUNCTION public.ican_delete_wallet_inbox_notification(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ican_clear_wallet_inbox(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_delete_wallet_inbox_notification(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_clear_wallet_inbox(BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Notification delete/clear RPCs are ready' AS status;
