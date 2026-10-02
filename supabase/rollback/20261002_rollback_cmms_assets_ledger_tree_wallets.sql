-- Rollback for: CMMS assets/ledger + ownership tree + branch wallets (migrations
-- cmms_assets_ledger_01..32, business_ownership_tree_01..15, branch_wallets_01..17).
-- Restores the pre-migration schema. DESTRUCTIVE: drops the new tables and every row in them
-- (stock ledger, ownership links, branch wallet policies/approvers/PINs/events) and the new
-- inventory columns. Take a backup first if any of that data matters.
--
-- NOT undone (data written to existing tables while the feature was live):
--   * ican_transactions rows written by the ledger (metadata->>'source_app' = 'cmms')
--   * cmms_inventory_items rows/values edited through the new forms
-- To remove the money rows too, uncomment the DELETE at the bottom after reviewing them.

BEGIN;

-- 1. Triggers on existing tables
DROP TRIGGER IF EXISTS trg_cmms_item_defaults       ON public.cmms_inventory_items;
DROP TRIGGER IF EXISTS trg_cmms_item_ledger_insert  ON public.cmms_inventory_items;
DROP TRIGGER IF EXISTS trg_cmms_item_ledger_update  ON public.cmms_inventory_items;
DROP TRIGGER IF EXISTS trg_bol_after_company_link   ON public.cmms_company_profiles;
DROP TRIGGER IF EXISTS trg_bwp_tx_guard_insert      ON public.ican_business_wallet_transactions;
DROP TRIGGER IF EXISTS trg_bwp_tx_guard_update      ON public.ican_business_wallet_transactions;

-- 2. Tables created by the migrations (children first; CASCADE drops their triggers/policies)
DROP TABLE IF EXISTS public.branch_wallet_stage_approvals CASCADE;
DROP TABLE IF EXISTS public.branch_approver_pins          CASCADE;
DROP TABLE IF EXISTS public.branch_wallet_approvers       CASCADE;
DROP TABLE IF EXISTS public.branch_wallet_allowances      CASCADE;
DROP TABLE IF EXISTS public.branch_wallet_events          CASCADE;
DROP TABLE IF EXISTS public.branch_wallet_policies        CASCADE;
DROP TABLE IF EXISTS public.business_ownership_events     CASCADE;
DROP TABLE IF EXISTS public.business_ownership_links      CASCADE;

-- 3. Stock ledger and group tables (created by the migration)
DROP TABLE IF EXISTS public.cmms_inventory_transactions CASCADE;
DROP TABLE IF EXISTS public.cmms_group_fx_rates         CASCADE;
DROP TABLE IF EXISTS public.cmms_business_groups        CASCADE;

-- 4. Columns added to existing tables (after the tables: their policies referenced group_id)
ALTER TABLE public.cmms_inventory_items
  DROP CONSTRAINT IF EXISTS chk_cmms_item_asset_status,
  DROP CONSTRAINT IF EXISTS chk_cmms_item_dep_method,
  DROP CONSTRAINT IF EXISTS chk_cmms_item_kind,
  DROP CONSTRAINT IF EXISTS chk_cmms_item_years,
  DROP COLUMN IF EXISTS item_kind,
  DROP COLUMN IF EXISTS asset_tag,
  DROP COLUMN IF EXISTS serial_number,
  DROP COLUMN IF EXISTS manufacturer,
  DROP COLUMN IF EXISTS model,
  DROP COLUMN IF EXISTS manufacture_year,
  DROP COLUMN IF EXISTS acquisition_year,
  DROP COLUMN IF EXISTS acquisition_date,
  DROP COLUMN IF EXISTS acquisition_cost,
  DROP COLUMN IF EXISTS useful_life_years,
  DROP COLUMN IF EXISTS salvage_value,
  DROP COLUMN IF EXISTS depreciation_method,
  DROP COLUMN IF EXISTS asset_condition,
  DROP COLUMN IF EXISTS asset_status,
  DROP COLUMN IF EXISTS warranty_expiry,
  DROP COLUMN IF EXISTS disposed_at,
  DROP COLUMN IF EXISTS linked_supermarket_id,
  DROP COLUMN IF EXISTS linked_product_id;
  -- assigned_storeman_id pre-dates this work and is kept.

ALTER TABLE public.cmms_company_profiles
  DROP COLUMN IF EXISTS group_id,
  DROP COLUMN IF EXISTS branch_name,
  DROP COLUMN IF EXISTS branch_code,
  DROP COLUMN IF EXISTS is_headquarters,
  DROP COLUMN IF EXISTS country,
  DROP COLUMN IF EXISTS currency,
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS supermarket_id;

-- 5. Functions (every overload). fn_get_company_inventory was never changed and is not touched.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
    '_boe_append_only',
    '_bol_access_rank',
    '_bol_after_company_link',
    '_bol_after_link_change',
    '_bol_ancestors',
    '_bol_cmms_company_of',
    '_bol_is_business_admin',
    '_bol_log',
    '_bol_root_of',
    '_bol_wallet_rank',
    '_bol_would_cycle',
    '_bwe_append_only',
    '_bwp_can_govern',
    '_bwp_governed_by_ancestor',
    '_bwp_log',
    '_bwp_rank_over',
    '_bwp_stage_status',
    '_bwp_tx_guard_insert',
    '_bwp_tx_guard_update',
    '_bwp_user_is_owner',
    '_cmms_access_level',
    '_cmms_caller_email',
    '_cmms_can_manage_inventory',
    '_cmms_can_view_company',
    '_cmms_feed_money',
    '_cmms_fx_rate',
    '_cmms_guc',
    '_cmms_is_company_admin',
    '_cmms_is_group_hq_admin',
    '_cmms_item_defaults',
    '_cmms_item_ledger_insert',
    '_cmms_item_ledger_update',
    '_cmms_itx_immutable',
    '_cmms_kind_from_category',
    '_cmms_member_user_id',
    '_cmms_money_spec',
    '_cmms_sync_tree_group',
    '_cmms_write_inventory_txn',
    'fn_business_branch_tree',
    'fn_business_end_branch_link',
    'fn_business_my_branch_requests',
    'fn_business_my_unlinked_businesses',
    'fn_business_ownership_chain',
    'fn_business_ownership_history',
    'fn_business_propose_branch',
    'fn_business_respond_branch_link',
    'fn_business_search_for_branch',
    'fn_business_update_branch_link',
    'fn_bwp_assign_approver',
    'fn_bwp_decide',
    'fn_bwp_events',
    'fn_bwp_list_approvers',
    'fn_bwp_my_pin_status',
    'fn_bwp_pending_for_me',
    'fn_bwp_propose_transfer',
    'fn_bwp_remove_approver',
    'fn_bwp_run_due_allowances',
    'fn_bwp_set_allowance',
    'fn_bwp_set_my_pin',
    'fn_bwp_set_policy',
    'fn_bwp_set_wallet_status',
    'fn_bwp_wallet_overview',
    'fn_cmms_accum_depreciation',
    'fn_cmms_create_business_group',
    'fn_cmms_create_item',
    'fn_cmms_dispose_asset',
    'fn_cmms_get_company_inventory',
    'fn_cmms_get_asset_register',
    'fn_cmms_get_linked_supermarket',
    'fn_cmms_get_my_business_group',
    'fn_cmms_get_supermarket_stock_link',
    'fn_cmms_inventory_reconciliation',
    'fn_cmms_inventory_report',
    'fn_cmms_link_company_to_group',
    'fn_cmms_link_item_to_product',
    'fn_cmms_link_supermarket',
    'fn_cmms_list_my_supermarkets',
    'fn_cmms_post_asset_depreciation',
    'fn_cmms_post_missing_money_entries',
    'fn_cmms_search_supermarket_products',
    'fn_cmms_set_group_fx_rate',
    'fn_cmms_set_item_details',
    'fn_cmms_set_item_quantity',
    'fn_cmms_transfer_stock_supermarket',
    'fn_cmms_unlink_company_from_group',
    'fn_cmms_unlink_supermarket',
    'fn_cmms_unposted_money_entries',
    'fn_cmms_update_branch'
    ])
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

COMMIT;

-- Optional, review first: money rows the ledger wrote into the business transaction record
-- DELETE FROM public.ican_transactions WHERE metadata->>'source_app' = 'cmms' AND metadata ? 'cmms_txn_id';
