# CMMS: assets vs consumables, transaction ledger, branches and ownership tree

## Deploy order (run the SQL BEFORE deploying the frontend)

1. `backend/CMMS_ASSETS_BRANCHES_LEDGER.sql`
2. `backend/BUSINESS_OWNERSHIP_TREE_CMMS_FEED.sql` (needs `CMMS_ASSET_INVENTORY_FOUNDATION.sql`,
   `SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql` and `UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql`
   for `unified_business_admin`)

Both are idempotent. The supermarket functions also need `MULTI_TENANT_PLATFORM.sql` and
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

## Assumptions to confirm

* "Year of dif" was read as the year the asset was acquired (and optionally manufactured), driving depreciation.
* Money rows are rule-based (table above); the AI classifier is no longer used for CMMS stock.
* Parent admins read branch data through the consolidated view; they are not added as staff in the branch's CMMS.
* Proceeds of a disposal are recorded in the transaction record, not added to a wallet.
* `fn_get_company_inventory` still has no caller check (unchanged from before).
