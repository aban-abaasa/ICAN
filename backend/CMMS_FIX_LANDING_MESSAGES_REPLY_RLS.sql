-- Fix: Community chat replies fail with 403 / "new row violates row-level
-- security policy for table landing_messages" (code 42501), while top-level
-- posts work fine, for BOTH guests and logged-in users.
--
-- landing_messages is the shared cross-app board (ICAN, digital-city-era,
-- FARM-AGENT, mybodaguy), created by CREATE_LANDING_MESSAGES_BOARD.sql and
-- extended with threaded replies by ADD_LANDING_MESSAGE_REPLIES.sql (both
-- in digital-city-era/backend/database/seeds/).
--
-- Root cause, confirmed by reading the live policy back via pg_policies
-- (see CMMS_DIAG_LANDING_MESSAGES_POLICIES.sql): the reply branch of
-- ADD_LANDING_MESSAGE_REPLIES.sql's own "landing_messages_insert" policy
-- has a column-scoping bug that was live from the day that migration was
-- first run (not something a sibling app changed). Its EXISTS subquery is
--   SELECT 1 FROM landing_messages pm WHERE pm.id = parent_id AND ...
-- and inside a correlated subquery that also does FROM landing_messages
-- pm, an *unqualified* parent_id binds to the subquery's own pm.parent_id
-- (nearer scope wins) instead of the row being inserted. Combined with the
-- subquery's own `pm.parent_id IS NULL`, that collapses to `pm.id IS NULL`
-- -- never true -- so the EXISTS always failed and no reply, from any
-- identity, could ever pass. This script fixes it by qualifying that
-- reference as `landing_messages.parent_id`.
--
-- DROP POLICY IF EXISTS + CREATE POLICY is idempotent, so this is safe to
-- run more than once.

DROP POLICY IF EXISTS "landing_messages_insert" ON public.landing_messages;
CREATE POLICY "landing_messages_insert" ON public.landing_messages
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    sender_role <> 'dev'
    AND (
      (
        parent_id IS NULL
        AND (
          (user_id IS NULL AND is_public = true)
          OR (
            user_id = auth.uid()
            AND (
              is_public = true
              OR EXISTS (
                SELECT 1 FROM public.ican_user_wallets w
                WHERE w.user_id = auth.uid() AND w.status = 'active'
              )
            )
          )
        )
      )
      OR (
        parent_id IS NOT NULL
        AND is_public = true
        AND (user_id IS NULL OR user_id = auth.uid())
        -- parent_id here MUST be qualified with the table name: inside this
        -- correlated subquery (also FROM landing_messages, aliased pm), an
        -- unqualified `parent_id` binds to pm.parent_id (the nearer scope),
        -- not to the row being inserted -- silently turning this into
        -- `pm.id = pm.parent_id AND pm.parent_id IS NULL`, i.e. `pm.id IS
        -- NULL`, which can never be true. That was the actual bug: it made
        -- every reply fail regardless of who posted it.
        AND EXISTS (
          SELECT 1 FROM public.landing_messages pm
          WHERE pm.id = landing_messages.parent_id AND pm.parent_id IS NULL AND pm.is_public = true
        )
      )
    )
  );

NOTIFY pgrst, 'reload schema';

SELECT 'landing_messages_insert policy re-applied with the reply branch -- replies should work now' AS status;
