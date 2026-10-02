DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname, p.proconfig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY[
    '_cmms_caller_email','_cmms_can_manage_inventory','_cmms_can_view_company','_cmms_feed_money','_cmms_fx_rate',
    '_cmms_guc','_cmms_is_company_admin','_cmms_is_group_hq_admin','_cmms_item_defaults','_cmms_item_ledger_insert',
    '_cmms_item_ledger_update','_cmms_itx_immutable','_cmms_kind_from_category','_cmms_member_user_id','_cmms_money_spec',
    '_cmms_write_inventory_txn','_cmms_access_level','_cmms_sync_tree_group',
    '_boe_append_only','_bol_access_rank','_bol_after_company_link','_bol_after_link_change','_bol_ancestors',
    '_bol_cmms_company_of','_bol_is_business_admin','_bol_log','_bol_root_of','_bol_wallet_rank','_bol_would_cycle',
    '_bwe_append_only','_bwp_can_govern','_bwp_governed_by_ancestor','_bwp_log','_bwp_rank_over','_bwp_stage_status',
    '_bwp_tx_guard_insert','_bwp_tx_guard_update','_bwp_user_is_owner',
    'fn_cmms_accum_depreciation','fn_cmms_create_business_group','fn_cmms_create_item','fn_cmms_dispose_asset',
    'fn_cmms_get_asset_register','fn_cmms_get_company_inventory','fn_cmms_get_linked_supermarket',
    'fn_cmms_get_my_business_group','fn_cmms_get_supermarket_stock_link','fn_cmms_inventory_reconciliation',
    'fn_cmms_inventory_report','fn_cmms_link_company_to_group','fn_cmms_link_item_to_product','fn_cmms_link_supermarket',
    'fn_cmms_list_my_supermarkets','fn_cmms_post_asset_depreciation','fn_cmms_post_missing_money_entries',
    'fn_cmms_search_supermarket_products','fn_cmms_set_group_fx_rate','fn_cmms_set_item_details',
    'fn_cmms_set_item_quantity','fn_cmms_transfer_stock_supermarket','fn_cmms_unlink_company_from_group',
    'fn_cmms_unlink_supermarket','fn_cmms_unposted_money_entries','fn_cmms_update_branch',
    'fn_business_branch_tree','fn_business_end_branch_link','fn_business_my_branch_requests',
    'fn_business_my_unlinked_businesses','fn_business_ownership_chain','fn_business_ownership_history',
    'fn_business_propose_branch','fn_business_respond_branch_link','fn_business_search_for_branch',
    'fn_business_update_branch_link',
    'fn_bwp_assign_approver','fn_bwp_decide','fn_bwp_events','fn_bwp_list_approvers','fn_bwp_my_pin_status',
    'fn_bwp_pending_for_me','fn_bwp_propose_transfer','fn_bwp_remove_approver','fn_bwp_run_due_allowances',
    'fn_bwp_set_allowance','fn_bwp_set_my_pin','fn_bwp_set_policy','fn_bwp_set_wallet_status','fn_bwp_wallet_overview'
    ])
  LOOP
    IF r.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%') THEN
      EXECUTE 'ALTER FUNCTION ' || r.sig || ' SET search_path = public';
    END IF;
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || r.sig || ' FROM PUBLIC, anon';
    IF left(r.proname, 1) = '_' AND r.proname <> ALL (ARRAY['_cmms_can_view_company', '_cmms_kind_from_category', '_cmms_caller_email', '_cmms_guc', '_cmms_money_spec', '_bol_access_rank', '_bol_wallet_rank']) THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || r.sig || ' FROM authenticated';
    ELSE
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.sig || ' TO authenticated';
    END IF;
  END LOOP;
END $$;
