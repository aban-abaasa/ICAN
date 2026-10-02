SELECT cron.schedule('branch-wallet-allowances', '7 * * * *', $$SELECT public.fn_bwp_run_due_allowances()$$);
