# CMMS: assets vs consumables, transaction ledger, branches and ownership tree

## Deploy order (run the SQL BEFORE deploying the frontend)

1. `backend/CMMS_ASSETS_BRANCHES_LEDGER.sql`
2. `backend/BUSINESS_OWNERSHIP_TREE_CMMS_FEED.sql` (needs `CMMS_ASSET_INVENTORY_FOUNDATION.sql`,
   `SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql` and `UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql`
   for `unified_business_admin`)
3. `backend/BRANCH_WALLETS_APPROVERS.sql` (needs the business-wallet files:
   `PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql`, `PITCHIN_BUSINESS_WALLET_CMMS_FINANCE_APPROVAL.sql`,
   `UNIFIED_BUSINESS_WALLET_OPERATIONS.sql`, `ICAN_BUSINESS_WALLET_TRANSFERS.sql`)

All three are idempotent and end with a hardening block. The supermarket functions also need `MULTI_TENANT_PLATFORM.sql` and
`DCE_CUSTOMER_SELFCHECKOUT.sql`; without them only those functions raise a clear error.
Copies live in `frontend/backend/` like the other SQL files.

The new frontend calls `fn_cmms_create_item` and `fn_cmms_set_item_quantity`, so it will not add
items or restock until step 1 has run.

## What it does

**Assets vs consumables.** `cmms_inventory_items.item_kind`. Equipment, Tools, Machinery, Vehicles, IT,
Furniture, Buildings and Land are assets (backfilled from category); everything else is a consumable.
Assets carry acquisition year/date, manufacture year, cost, useful life, salvage, depreciation method
(straight line / declining balance / none), serial, tag, condition, status and warranty. Net book value
uses a full year of depreciation in the year of acquisition.

**One transaction record.** Every stock movement is written by database triggers to the append-only
`cmms_inventory_transactions` (cannot be edited or deleted), and the same function writes the matching
money row to `ican_transactions`, which the business reports read:

| Movement | Stock ledger | Money record |
|---|---|---|
| New item (bought now) | purchase | expense: `asset` / `cogs` (spare parts, materials, retail stock, raw materials) / plain expense |
| Asset already owned (past acquisition year) | opening, dated in that year | none (no money moves today) |
| Paid restock | restock | expense |
| Issue, custody sign-out/in, supermarket transfer, count correction | yes | none |
| Yearly depreciation | depreciation | expense, `non_cash: true`, dated 31 Dec |
| Disposal with proceeds | disposal at net book value | income (`revenue`) |

`fn_cmms_unposted_money_entries` lists any money transaction missing from the record;
`fn_cmms_post_missing_money_entries` books them. The ledger panel shows both checks.

**Branches and ownership tree (Pitchin business profile → Business Administration → Branches & ownership).**
`business_ownership_links` is the tree: parent → child, relationship, ownership %, CMMS sharing level
(`none` / `summary` / `full`), pending → active → ended, full history in `business_ownership_events`.
The parent proposes, the child's administrator accepts (automatic when one person administers both).
Only the child can raise the sharing level. Linked CMMS companies are mirrored into a CMMS business group
automatically; a parent's access to a branch is the weakest level along the path. `summary` = branch totals in
the consolidated report; `full` = also the asset register and ledger rows.

**Supermarket.** Link a branch to a supermarket you own or manage, map consumables to its products, and move
stock store room ⇄ shop floor in one transaction with a signed ledger entry on the CMMS side.

**Branch wallets and approvers (Business Administration → Branch wallets).** Every business profile already
owns a business wallet, so each branch has its own wallet account; this layer ties them to the mother account.
Money still moves only through the existing business-wallet request/execute flow.

* *Wallet control* on each ownership link (`none` / `view` / `govern`), same consent rule as CMMS sharing: the
  branch can lower it, only the branch can raise it. A franchise or joint venture can simply stay `view` or `none`.
* *Approval ladder* per wallet, with assigned approvers who sign with their OWN approval PIN (the business-wallet
  PIN is never shared): up to the branch limit → N branch approvers; above it → also M mother approvers (owners of
  a business that governs the branch); above it with no mother → the owners, through the existing approval + PIN.
  The person who raised a request can never approve it; any rejection stops it; 5 wrong PINs lock for 15 minutes.
* *Hard limits* per payment and per day, and a *freeze* kill-switch, enforced by database triggers on every
  request whatever screen creates it. Either side can freeze; only the governor unfreezes.
* *Mother operations*: fund a branch, sweep surplus back, and scheduled *allowances* (top up to a float, sweep
  above a ceiling). Allowances only ever create pending requests.
* Everything is written to an append-only event log.

## Assumptions to confirm

* "Year of dif" was read as the year the asset was acquired (and optionally manufactured), driving depreciation.
* Money rows are rule-based (table above); the AI classifier is no longer used for CMMS stock.
* Parent admins read branch data through the consolidated view; they are not added as staff in the branch's CMMS.
* Proceeds of a disposal are recorded in the transaction record, not added to a wallet.
* The new inventory list function `fn_cmms_get_company_inventory` has no caller check, like the original
  `fn_get_company_inventory`, which is left untouched for the pitch-plan and valuation screens.
* Wallet amounts are ICAN coin, as in the existing business wallet. Intra-group funding is tagged
  `branch_funding` / `branch_sweep` so it can be eliminated from consolidated reports.
* The balance move itself is the existing `pitchin_execute_business_wallet_transfer`. That function debits the paying
  wallet and credits only `recipient_user_id`; it never credits a recipient business. So a trigger
  (`trg_bwp_credit_recipient`) credits the recipient wallet when a `branch_funding` / `branch_sweep` completes, in the
  same transaction. Tested end to end in production inside a rolled-back transaction (ladder sweep, standard funding,
  repeat execution does not credit twice, a plain business payment is untouched).
* Allowances run when a mother-account administrator opens Branch wallets, or from the hourly pg_cron job `branch-wallet-allowances`
  (minute 7), which calls `fn_bwp_run_due_allowances()`; it only ever creates pending requests.

## Production rollout (done)

Applied to the Supabase project as 64 small tracked migrations plus one hardening migration; the same
files are in `supabase/migrations/` (do not re-run them against that database). Order was assets and ledger
(32 steps), ownership tree (15), branch wallets (17), then `cmms_ledger_tree_wallets_hardening`.

* The original `fn_get_company_inventory` was **left untouched**; the CMMS list now calls the new
  `fn_cmms_get_company_inventory` (the app falls back to the old one if the database is not upgraded).
* Custody sign-out/in and manual edits are labelled by the ledger trigger from the call stack, because
  `ALTER FUNCTION ... SET cmms.*` needs superuser on Supabase.
* Hardening: only the screens' `fn_*` functions are callable by signed-in users and none by `anon`; internal
  helpers (`_bol_*`, `_bwp_*`, `_cmms_*`) are closed, except the few the row-level policies and triggers call.
* `supabase/rollback/20261002_rollback_cmms_assets_ledger_tree_wallets.sql` removes all of it (destructive:
  drops the ledger, tree and wallet-policy data). Tested against a copy of the schema.
* Existing items were classified (assets from category) and each got an `opening` ledger row; no money rows
  were created for them.

**Existing behaviour worth a look (not changed here).** The business-wallet executor deployed in production
is the older one from `PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql`: it credits `recipient_user_id` only. The newer
`ICAN_BUSINESS_WALLET_TRANSFERS.sql` version also credits a recipient business and writes both ledger entries. An
August payment to a business was credited, so the newer one was live at some point. Until it is redeployed, an
ordinary business-to-business payment approved today debits the sender without crediting the recipient (2 are
pending). The branch-credit trigger switches itself off once the deployed executor mentions
`recipient_business_profile_id`, so redeploying that file will not double-pay branch transfers.
