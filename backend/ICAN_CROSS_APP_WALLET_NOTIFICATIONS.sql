-- One private ICANera Wallet inbox for wallet activity from ICAN, Digital City
-- Era, Farm Agent, MyBodaGuy, CMMS, and future shared-wallet applications.
-- Run after ICAN_CROSS_APP_WALLET_MIGRATION.sql,
-- PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql,
-- ICAN_BUSINESS_WALLET_TRANSFERS.sql and
-- UNIFIED_BUSINESS_WALLET_OPERATIONS.sql.

CREATE TABLE IF NOT EXISTS public.ican_wallet_inbox_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_app TEXT NOT NULL DEFAULT 'ican',
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  amount_ican NUMERIC(18,8),
  coin_transaction_id UUID REFERENCES public.ican_coin_transactions(id) ON DELETE CASCADE,
  business_wallet_transaction_id UUID REFERENCES public.ican_business_wallet_transactions(id) ON DELETE CASCADE,
  business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  reference_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (coin_transaction_id IS NOT NULL OR business_wallet_transaction_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ican_wallet_inbox_one_coin_event
  ON public.ican_wallet_inbox_notifications(recipient_user_id, coin_transaction_id, notification_type)
  WHERE coin_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ican_wallet_inbox_one_business_event
  ON public.ican_wallet_inbox_notifications(recipient_user_id, business_wallet_transaction_id, notification_type)
  WHERE business_wallet_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ican_wallet_inbox_recipient
  ON public.ican_wallet_inbox_notifications(recipient_user_id, read_at, created_at DESC);

-- A server-side VAPID relay can LISTEN on this channel and deliver the
-- notification to registered installed devices without exposing endpoints.
CREATE OR REPLACE FUNCTION public.ican_publish_wallet_push_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM pg_notify('ican_wallet_push', json_build_object(
    'notification_id', NEW.id, 'recipient_user_id', NEW.recipient_user_id,
    'title', NEW.title, 'message', NEW.message, 'source_app', NEW.source_app
  )::TEXT);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ican_wallet_push_event ON public.ican_wallet_inbox_notifications;
CREATE TRIGGER ican_wallet_push_event
AFTER INSERT ON public.ican_wallet_inbox_notifications
FOR EACH ROW EXECUTE FUNCTION public.ican_publish_wallet_push_event();

ALTER TABLE public.ican_wallet_inbox_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ican_wallet_inbox_recipient_read ON public.ican_wallet_inbox_notifications;
CREATE POLICY ican_wallet_inbox_recipient_read ON public.ican_wallet_inbox_notifications
  FOR SELECT TO authenticated USING (recipient_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.ican_emit_coin_wallet_notification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ican_wallet_inbox_notifications
    (recipient_user_id, source_app, notification_type, title, message,
     amount_ican, coin_transaction_id, reference_id, metadata)
  SELECT recipient_id, COALESCE(NEW.source_app, 'ican'),
         CASE WHEN NEW.status = 'completed' THEN 'wallet_transaction_completed' ELSE 'wallet_transaction_status' END,
         CASE WHEN NEW.status = 'completed' THEN 'ICAN wallet activity' ELSE 'ICAN wallet status updated' END,
         COALESCE(NEW.note, 'A wallet transaction was recorded.'), NEW.ican_amount,
         NEW.id, NEW.reference_id,
         jsonb_build_object('status', NEW.status, 'transaction_type', NEW.transaction_type)
    FROM unnest(ARRAY[NEW.sender_user_id, NEW.recipient_user_id]) AS recipient_id
   WHERE recipient_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_emit_business_wallet_notification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- The source business is notified while approval is pending. A supplier or
  -- recipient business is notified only after an administrator has approved
  -- and the wallet transfer has completed.
  INSERT INTO public.ican_wallet_inbox_notifications
    (recipient_user_id, source_app, notification_type, title, message,
     amount_ican, business_wallet_transaction_id, business_profile_id,
     reference_id, metadata)
  SELECT DISTINCT recipients.user_id, COALESCE(NEW.source_app, 'ican'),
         CASE WHEN NEW.status = 'pending_approval' THEN 'wallet_approval_required'
              WHEN NEW.status = 'completed' THEN 'business_wallet_payment_completed'
              ELSE 'business_wallet_payment_status' END,
         CASE WHEN NEW.status = 'pending_approval' THEN 'Business-wallet approval required'
              WHEN NEW.status = 'completed' THEN 'Business-wallet payment completed'
              ELSE 'Business-wallet payment updated' END,
         COALESCE(NEW.note, 'Business-wallet activity requires your attention.'),
         NEW.amount_ican, NEW.id, NEW.business_profile_id, NEW.reference_id,
         jsonb_build_object('status', NEW.status, 'recipient_business_profile_id', NEW.recipient_business_profile_id)
    FROM (
      SELECT bp.user_id FROM public.business_profiles bp WHERE bp.id = NEW.business_profile_id
      UNION SELECT co.user_id FROM public.business_co_owners co WHERE co.business_profile_id = NEW.business_profile_id
        AND co.user_id IS NOT NULL AND lower(co.status) IN ('active', 'approved')
      UNION SELECT bam.auth_user_id FROM public.business_account_members bam WHERE bam.business_profile_id = NEW.business_profile_id
        AND bam.auth_user_id IS NOT NULL AND bam.employment_status = 'active'
        AND COALESCE((bam.permissions ->> 'manage_business')::BOOLEAN, FALSE)
      -- A CMMS administrator can be the authorized wallet approver without
      -- having a business_profiles or business_account_members row. Include
      -- that user in the shared ICANera Wallet inbox as well.
      UNION SELECT au.id
        FROM public.cmms_company_profiles cp
        JOIN public.cmms_users cu ON cu.cmms_company_id = cp.id
        JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id
        JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
        JOIN auth.users au ON lower(au.email) = lower(cu.email)
       WHERE cp.pichin_business_profile_id = NEW.business_profile_id
         AND cu.is_active = TRUE AND ur.is_active = TRUE AND r.is_active = TRUE
         AND lower(COALESCE(r.role_name, '')) IN
             ('admin', 'administrator', 'cmms_admin', 'business_admin', 'wallet_admin', 'finance_admin')
       UNION SELECT bp.user_id FROM public.business_profiles bp
         WHERE bp.id = NEW.recipient_business_profile_id
           AND NEW.status = 'completed'
       UNION SELECT co.user_id FROM public.business_co_owners co WHERE co.business_profile_id = NEW.recipient_business_profile_id
         AND co.user_id IS NOT NULL AND lower(co.status) IN ('active', 'approved')
         AND NEW.status = 'completed'
    ) recipients(user_id)
   WHERE recipients.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ican_coin_wallet_inbox_notification ON public.ican_coin_transactions;
CREATE TRIGGER ican_coin_wallet_inbox_notification
AFTER INSERT OR UPDATE OF status ON public.ican_coin_transactions
FOR EACH ROW EXECUTE FUNCTION public.ican_emit_coin_wallet_notification();

DROP TRIGGER IF EXISTS ican_business_wallet_inbox_notification ON public.ican_business_wallet_transactions;
CREATE TRIGGER ican_business_wallet_inbox_notification
AFTER INSERT OR UPDATE OF status ON public.ican_business_wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.ican_emit_business_wallet_notification();

-- Backfill the shared inbox for requests created before CMMS wallet admins
-- were included above. The unique inbox indexes make this idempotent.
UPDATE public.ican_business_wallet_transactions
   SET status = status
 WHERE status = 'pending_approval';

CREATE OR REPLACE FUNCTION public.ican_get_wallet_inbox(p_unread_only BOOLEAN DEFAULT FALSE)
RETURNS SETOF public.ican_wallet_inbox_notifications
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.ican_wallet_inbox_notifications
   WHERE recipient_user_id = auth.uid()
     AND (NOT COALESCE(p_unread_only, FALSE) OR read_at IS NULL)
   ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.ican_mark_wallet_inbox_read(p_notification_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.ican_wallet_inbox_notifications SET read_at = COALESCE(read_at, now())
   WHERE id = p_notification_id AND recipient_user_id = auth.uid()
  RETURNING TRUE;
$$;

REVOKE ALL ON FUNCTION public.ican_get_wallet_inbox(BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ican_mark_wallet_inbox_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_get_wallet_inbox(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_mark_wallet_inbox_read(UUID) TO authenticated;

-- Browser subscriptions are private device credentials. A trusted push relay
-- (configured with VAPID keys) reads these server-side after new inbox events.
CREATE TABLE IF NOT EXISTS public.ican_wallet_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  subscription JSONB NOT NULL,
  user_agent TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ican_wallet_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ican_register_wallet_push_subscription(p_subscription JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NULLIF(p_subscription ->> 'endpoint', '') IS NULL THEN
    RAISE EXCEPTION 'A signed-in user and a valid push subscription are required';
  END IF;
  INSERT INTO public.ican_wallet_push_subscriptions (user_id, endpoint, subscription, user_agent, is_active)
  VALUES (auth.uid(), p_subscription ->> 'endpoint', p_subscription,
          current_setting('request.headers', TRUE)::JSONB ->> 'user-agent', TRUE)
  ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id,
    subscription = EXCLUDED.subscription, is_active = TRUE, updated_at = now();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.ican_register_wallet_push_subscription(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_register_wallet_push_subscription(JSONB) TO authenticated;
NOTIFY pgrst, 'reload schema';
