\set ON_ERROR_STOP on
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('re-running the installers keeps the verified IDs', (SELECT count(*) FROM public.user_national_ids WHERE verified) = 2);
  PERFORM t.check('...and the requests, with their reasons', (SELECT count(*) FROM public.national_id_checks WHERE status = 'rejected' AND review_note IS NOT NULL) >= 4);
  PERFORM t.check('...and the switches stay off', (SELECT NOT enforced AND NOT require_verified FROM public.national_id_enforcement));
  PERFORM t.check('...and the name lock is still there',
    t.err($q$UPDATE public.user_accounts SET account_holder_name = 'Somebody Else' WHERE user_id = t.u(7)$q$) ILIKE '%NATIONAL_ID_NAME_LOCKED%');
  PERFORM t.check('...and a single trigger of each kind on user_accounts',
    (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.user_accounts'::regclass AND tgname IN ('trg_national_id_enforce', 'trg_national_id_lock_name') AND NOT tgisinternal) = 2);
END $$;
