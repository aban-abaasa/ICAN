-- Rollback for: Growth / Prosperity Architect scheduler (migration 20261003090000_growth_scheduler).
-- DESTRUCTIVE: drops the three growth tables and every row in them (saved preferences,
-- schedule blocks, reminder inbox). Take a backup first if any of that data matters.
-- Touches nothing outside the objects that migration created.

BEGIN;

-- 0. Reminder runner (pg_cron)
DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ican-growth-reminders';
  END IF;
END $$;

-- 1. Realtime publication membership (dropping the table also removes it; explicit for clarity)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                AND tablename = 'ican_growth_notifications') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.ican_growth_notifications;
  END IF;
END $$;

-- 2. Functions
DROP FUNCTION IF EXISTS public.ican_growth_send_test_reminder();
DROP FUNCTION IF EXISTS public.ican_growth_dispatch_due_reminders();

-- 3. Tables (inbox first: it references schedule items), then their trigger functions
DROP TABLE IF EXISTS public.ican_growth_notifications;
DROP TABLE IF EXISTS public.ican_growth_schedule_items;
DROP TABLE IF EXISTS public.ican_growth_profiles;

DROP FUNCTION IF EXISTS public.ican_growth_items_before_write();
DROP FUNCTION IF EXISTS public.ican_growth_profiles_touch();
DROP FUNCTION IF EXISTS public.ican_growth_next_start(TEXT, DATE, TIME, SMALLINT[], TEXT, TIMESTAMPTZ);

NOTIFY pgrst, 'reload schema';

COMMIT;
