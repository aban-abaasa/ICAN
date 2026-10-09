-- Rollback for 20261007200000_franchise_code_delivery.sql
--
-- Stops partner codes being sent to the Support chat, removes the three admin/internal functions and the
-- automatic trigger, and drops the "code sent" columns. Messages already posted in Support chat and
-- inbox notifications already created stay where they are (they are the partner's own history).
--
-- Left in place on purpose, because other features may rely on them: chat_conversations.kind and the
-- widened wallet-inbox constraint (it now also allows franchise_* rows, which is harmless).
--
-- Run this BEFORE 20261004_rollback_franchise_layer.sql if you are removing the whole franchise layer.

DROP TRIGGER IF EXISTS trg_ican_franchise_auto_send_code ON public.ican_franchise_partners;

DROP FUNCTION IF EXISTS public.ican_franchise_admin_message_partner(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_send_pending_codes();
DROP FUNCTION IF EXISTS public.ican_franchise_admin_send_code(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_auto_send_code();
DROP FUNCTION IF EXISTS public._franchise_deliver_code(UUID, TEXT, TEXT);
DO $$
BEGIN
  IF to_regclass('public.ican_franchise_partners') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS public._franchise_post_to_partner(public.ican_franchise_partners, TEXT, TEXT, TEXT, TEXT, JSONB);
    DROP FUNCTION IF EXISTS public._franchise_code_message(public.ican_franchise_partners, TEXT);
    ALTER TABLE public.ican_franchise_partners
      DROP COLUMN IF EXISTS code_sent_at,
      DROP COLUMN IF EXISTS code_sent_mode,
      DROP COLUMN IF EXISTS code_sent_status,
      DROP COLUMN IF EXISTS code_sent_count,
      DROP COLUMN IF EXISTS follow_up_code;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public._franchise_make_follow_up_code();

NOTIFY pgrst, 'reload schema';
