-- ============================================================================
-- Growth -> Prosperity Architect: saved preferences, a personal schedule, and
-- reminders that reach the user in-app (realtime) and on their phone (push).
-- ============================================================================
-- Additive only: three new tables, three new functions, one cron job.
-- Does not touch any existing table, policy, trigger or function.
--
--   ican_growth_profiles         one row per user: optimiser preferences + last result
--   ican_growth_schedule_items   the user's time blocks (once / weekly) + reminder settings
--   ican_growth_notifications    in-app reminder inbox (realtime; also read by the bell)
--
-- Reminders: pg_cron runs ican_growth_dispatch_due_reminders() every minute. For
-- each block whose reminder time has arrived it writes one inbox row (deduped per
-- block + occurrence) and, when the shared push relay exists (ican_push_relay, from
-- ICAN_APP_PUSH_REGISTRATION.sql), pushes it to the user's registered phones with
-- source 'growth'. The wallet-push Edge Function needs the 'growth' source entry
-- from backend/supabase/functions/wallet-push/index.ts to open the right screen.
-- ============================================================================

-- 1. Profiles (preferences + last optimisation) -------------------------------
CREATE TABLE IF NOT EXISTS public.ican_growth_profiles (
  user_id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_optimization  JSONB,
  optimization_score NUMERIC(5,2),
  optimized_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Schedule items ----------------------------------------------------------
-- A weekly block repeats on days_of_week (0 = Sunday ... 6 = Saturday) at the
-- local start_time in tz; "daily" is simply all seven days. A one-off block uses
-- on_date. next_start_at is the next occurrence that has not been reminded yet;
-- it is maintained by the trigger below and by the dispatcher, never by clients.
CREATE TABLE IF NOT EXISTS public.ican_growth_schedule_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title                 TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  category              TEXT        NOT NULL DEFAULT 'custom'
                          CHECK (category IN ('spiritual','physical','high_value_work','networking',
                                              'learning','family','review','rest','custom')),
  notes                 TEXT        CHECK (notes IS NULL OR char_length(notes) <= 1000),
  start_time            TIME        NOT NULL,
  duration_minutes      INTEGER     NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 720),
  recurrence            TEXT        NOT NULL DEFAULT 'weekly' CHECK (recurrence IN ('once','weekly')),
  on_date               DATE,
  days_of_week          SMALLINT[]  NOT NULL DEFAULT '{}',
  tz                    TEXT        NOT NULL DEFAULT 'UTC',
  remind_before_minutes INTEGER     NOT NULL DEFAULT 10 CHECK (remind_before_minutes BETWEEN 0 AND 1440),
  reminders_enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
  source                TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','optimizer')),
  next_start_at         TIMESTAMPTZ,
  last_notified_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT growth_item_when CHECK (
    (recurrence = 'once'   AND on_date IS NOT NULL)
    OR
    (recurrence = 'weekly' AND cardinality(days_of_week) BETWEEN 1 AND 7
                           AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
  )
);

CREATE INDEX IF NOT EXISTS idx_growth_items_user ON public.ican_growth_schedule_items (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_growth_items_due  ON public.ican_growth_schedule_items (next_start_at)
  WHERE is_active AND reminders_enabled AND next_start_at IS NOT NULL;

-- 3. In-app reminder inbox ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_growth_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id       UUID        REFERENCES public.ican_growth_schedule_items(id) ON DELETE SET NULL,
  occurrence_at TIMESTAMPTZ,
  title         TEXT        NOT NULL,
  message       TEXT        NOT NULL,
  category      TEXT,
  priority      TEXT        NOT NULL DEFAULT 'normal',
  is_read       BOOLEAN     NOT NULL DEFAULT FALSE,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One reminder per block per occurrence, however many times the dispatcher runs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_notifications_occurrence
  ON public.ican_growth_notifications (item_id, occurrence_at) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_growth_notifications_user
  ON public.ican_growth_notifications (user_id, created_at DESC);

-- 4. Next-occurrence maths ---------------------------------------------------
-- Earliest start >= p_after for the given rule, or NULL when there is none
-- (a one-off whose time has passed). Computed in the user's own time zone so a
-- 6:00 AM block stays at 6:00 AM across daylight-saving changes.
CREATE OR REPLACE FUNCTION public.ican_growth_next_start(
  p_recurrence TEXT,
  p_on_date    DATE,
  p_start_time TIME,
  p_days       SMALLINT[],
  p_tz         TEXT,
  p_after      TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_day  DATE;
  v_cand TIMESTAMPTZ;
  i      INTEGER;
BEGIN
  IF p_recurrence = 'once' THEN
    IF p_on_date IS NULL THEN RETURN NULL; END IF;
    v_cand := (p_on_date + p_start_time) AT TIME ZONE p_tz;
    RETURN CASE WHEN v_cand >= p_after THEN v_cand ELSE NULL END;
  END IF;

  v_day := (p_after AT TIME ZONE p_tz)::date;
  FOR i IN 0..7 LOOP
    IF EXTRACT(DOW FROM (v_day + i))::int = ANY (p_days) THEN
      v_cand := ((v_day + i) + p_start_time) AT TIME ZONE p_tz;
      IF v_cand >= p_after THEN RETURN v_cand; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- Keeps title/tz tidy, stamps updated_at, and recomputes next_start_at whenever
-- the schedule itself changes (or a block is paused / resumed).
CREATE OR REPLACE FUNCTION public.ican_growth_items_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.title := btrim(NEW.title);
  IF NEW.tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.tz) THEN
    NEW.tz := 'UTC';
  END IF;
  NEW.updated_at := now();

  IF TG_OP = 'INSERT' OR
     (NEW.recurrence, NEW.on_date, NEW.start_time, NEW.days_of_week, NEW.tz, NEW.is_active,
      NEW.reminders_enabled, NEW.remind_before_minutes)
     IS DISTINCT FROM
     (OLD.recurrence, OLD.on_date, OLD.start_time, OLD.days_of_week, OLD.tz, OLD.is_active,
      OLD.reminders_enabled, OLD.remind_before_minutes)
  THEN
    IF NEW.is_active AND NEW.reminders_enabled THEN
      NEW.next_start_at := public.ican_growth_next_start(
        NEW.recurrence, NEW.on_date, NEW.start_time, NEW.days_of_week, NEW.tz, now());
    ELSE
      NEW.next_start_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_growth_items_before_write ON public.ican_growth_schedule_items;
CREATE TRIGGER trg_growth_items_before_write
  BEFORE INSERT OR UPDATE ON public.ican_growth_schedule_items
  FOR EACH ROW EXECUTE FUNCTION public.ican_growth_items_before_write();

CREATE OR REPLACE FUNCTION public.ican_growth_profiles_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_growth_profiles_touch ON public.ican_growth_profiles;
CREATE TRIGGER trg_growth_profiles_touch
  BEFORE UPDATE ON public.ican_growth_profiles
  FOR EACH ROW EXECUTE FUNCTION public.ican_growth_profiles_touch();

-- 5. Row level security ------------------------------------------------------
ALTER TABLE public.ican_growth_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_growth_schedule_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_growth_notifications  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS growth_profiles_own ON public.ican_growth_profiles;
CREATE POLICY growth_profiles_own ON public.ican_growth_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS growth_items_own ON public.ican_growth_schedule_items;
CREATE POLICY growth_items_own ON public.ican_growth_schedule_items
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Inbox rows are written only by the dispatcher / test function (SECURITY
-- DEFINER); a user may read, mark read, and delete their own.
DROP POLICY IF EXISTS growth_notifications_select ON public.ican_growth_notifications;
CREATE POLICY growth_notifications_select ON public.ican_growth_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS growth_notifications_update ON public.ican_growth_notifications;
CREATE POLICY growth_notifications_update ON public.ican_growth_notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS growth_notifications_delete ON public.ican_growth_notifications;
CREATE POLICY growth_notifications_delete ON public.ican_growth_notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Column-level grants: clients may not forge the scheduler's own bookkeeping
-- (next_start_at, last_notified_at) or rewrite an inbox message.
REVOKE ALL ON public.ican_growth_profiles       FROM anon, authenticated;
REVOKE ALL ON public.ican_growth_schedule_items FROM anon, authenticated;
REVOKE ALL ON public.ican_growth_notifications  FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.ican_growth_profiles TO authenticated;

GRANT SELECT, DELETE ON public.ican_growth_schedule_items TO authenticated;
GRANT INSERT (user_id, title, category, notes, start_time, duration_minutes, recurrence, on_date,
              days_of_week, tz, remind_before_minutes, reminders_enabled, is_active, source)
  ON public.ican_growth_schedule_items TO authenticated;
GRANT UPDATE (title, category, notes, start_time, duration_minutes, recurrence, on_date,
              days_of_week, tz, remind_before_minutes, reminders_enabled, is_active)
  ON public.ican_growth_schedule_items TO authenticated;

GRANT SELECT, DELETE ON public.ican_growth_notifications TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.ican_growth_notifications TO authenticated;

-- 6. Dispatcher --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_growth_dispatch_due_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r         RECORD;
  v_count   INTEGER := 0;
  v_notif   UUID;
  v_mins    INTEGER;
  v_clock   TEXT;
  v_message TEXT;
  v_relay   BOOLEAN;
BEGIN
  v_relay := EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'ican_push_relay');

  FOR r IN
    SELECT * FROM public.ican_growth_schedule_items
     WHERE is_active AND reminders_enabled AND next_start_at IS NOT NULL
       AND next_start_at - make_interval(mins => remind_before_minutes) <= now()
     ORDER BY next_start_at
     LIMIT 500
     FOR UPDATE SKIP LOCKED
  LOOP
    -- A reminder for something that began more than half an hour ago (cron was
    -- down, say) is noise, so it is skipped and the block simply moves on.
    IF r.next_start_at >= now() - INTERVAL '30 minutes' THEN
      v_notif := NULL;
      v_mins  := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (r.next_start_at - now())) / 60)::int);
      v_clock := to_char(r.next_start_at AT TIME ZONE r.tz, 'FMHH12:MI AM');
      v_message := CASE
        WHEN v_mins = 0 THEN format('Starting now (%s).', v_clock)
        WHEN v_mins < 60 THEN format('Starts at %s, in %s min.', v_clock, v_mins)
        ELSE format('Starts at %s.', v_clock)
      END;

      INSERT INTO public.ican_growth_notifications
        (user_id, item_id, occurrence_at, title, message, category)
      VALUES
        (r.user_id, r.id, r.next_start_at, r.title, v_message, r.category)
      ON CONFLICT (item_id, occurrence_at) WHERE item_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_notif;

      IF v_notif IS NOT NULL THEN
        v_count := v_count + 1;
        IF v_relay THEN
          PERFORM public.ican_push_relay(jsonb_build_object(
            'id', v_notif,
            'recipient_user_id', r.user_id,
            'source', 'growth',
            'title', r.title,
            'message', v_message,
            'tag', 'growth-' || r.id::text,
            'action_tab', 'growth'
          ));
        END IF;
      END IF;
    END IF;

    UPDATE public.ican_growth_schedule_items
       SET last_notified_at = now(),
           next_start_at = public.ican_growth_next_start(
             r.recurrence, r.on_date, r.start_time, r.days_of_week, r.tz,
             GREATEST(r.next_start_at + INTERVAL '1 minute', now()))
     WHERE id = r.id;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ican_growth_dispatch_due_reminders() FROM PUBLIC, anon, authenticated;

-- "Send me a test alert": proves in-app + phone delivery without waiting for a block.
CREATE OR REPLACE FUNCTION public.ican_growth_send_test_reminder()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to send a test alert';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ican_growth_notifications
              WHERE user_id = auth.uid() AND item_id IS NULL AND created_at > now() - INTERVAL '20 seconds') THEN
    RAISE EXCEPTION 'A test alert was just sent. Give it a few seconds.';
  END IF;

  INSERT INTO public.ican_growth_notifications (user_id, title, message, category)
  VALUES (auth.uid(), 'Prosperity Architect', 'Test alert: your schedule reminders are working.', 'custom')
  RETURNING id INTO v_id;

  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'ican_push_relay') THEN
    PERFORM public.ican_push_relay(jsonb_build_object(
      'id', v_id,
      'recipient_user_id', auth.uid(),
      'source', 'growth',
      'title', 'Prosperity Architect',
      'message', 'Test alert: your schedule reminders are working.',
      'tag', 'growth-test',
      'action_tab', 'growth'
    ));
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ican_growth_send_test_reminder() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_growth_send_test_reminder() TO authenticated;

-- 7. Realtime + cron ---------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                        AND tablename = 'ican_growth_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ican_growth_notifications;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('ican-growth-reminders', '* * * * *',
                          $job$SELECT public.ican_growth_dispatch_due_reminders()$job$);
  ELSE
    RAISE NOTICE 'pg_cron is not enabled: enable it, then schedule ican_growth_dispatch_due_reminders() every minute.';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
