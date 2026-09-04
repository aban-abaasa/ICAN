-- Temporary diagnostic: lists every RLS policy currently installed on
-- landing_messages, so we can see what's actually live instead of guessing.
-- The reply-branch fix (CMMS_FIX_LANDING_MESSAGES_REPLY_RLS.sql) was applied
-- but replies still 403 -- that only makes sense if some OTHER policy (e.g.
-- a RESTRICTIVE one, which ANDs against every permissive policy) is also in
-- play and wasn't touched by that fix, since it only replaced the policy
-- named "landing_messages_insert".
--
-- Read-only, no data exposure beyond policy definitions (not message
-- content). Drop it again afterward with:
--   DROP FUNCTION IF EXISTS public.diag_landing_messages_policies();

CREATE OR REPLACE FUNCTION public.diag_landing_messages_policies()
RETURNS TABLE(
  policyname TEXT,
  permissive TEXT,
  roles TEXT,
  cmd TEXT,
  qual TEXT,
  with_check TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT policyname, permissive, roles::text, cmd, qual, with_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'landing_messages';
$$;

GRANT EXECUTE ON FUNCTION public.diag_landing_messages_policies() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Diagnostic RPC ready -- call diag_landing_messages_policies() next' AS status;
