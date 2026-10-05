/**
 * CMMS assets, transaction ledger, business group / branches and supermarket link.
 *
 * Backed by backend/CMMS_ASSETS_BRANCHES_LEDGER.sql. Every function resolves to
 * { data, error } like the rest of the CMMS services and never throws.
 *
 * A BRANCH is a CMMS company: it keeps running its own CMMS. A business GROUP
 * links those companies, with a head office, per-branch country / currency and
 * group FX rates, so one owner can read the whole business.
 */

import { supabase } from '../lib/supabase/client';

const call = async (fn, args) => {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error(`❌ ${fn} failed:`, error?.message || error);
    return { data: null, error };
  }
};

// ============================================================
// ASSETS vs CONSUMABLES
// ============================================================

export const ITEM_KINDS = {
  asset: {
    label: 'Assets',
    singular: 'Asset',
    blurb: 'Durable equipment you own and depreciate: machines, vehicles, tools, IT.',
    categories: ['Equipment', 'Machinery', 'Vehicles', 'Tools', 'IT Equipment', 'Furniture', 'Buildings']
  },
  consumable: {
    label: 'Consumables',
    singular: 'Consumable',
    blurb: 'Stock that is used up or resold: spare parts, materials, oils, retail goods.',
    categories: ['Spare Parts', 'Materials', 'Consumables', 'Fuel & Lubricants', 'Retail Stock']
  }
};

// Mirrors public._cmms_kind_from_category so the UI can classify before the DB does.
const ASSET_CATEGORY_KEYS = new Set([
  'equipment', 'tools', 'machinery', 'plant & machinery', 'vehicles', 'vehicle', 'it equipment',
  'furniture', 'furniture & fittings', 'buildings', 'building', 'land', 'fixed asset', 'fixed assets',
  'asset', 'assets'
]);

export const kindFromCategory = (category) =>
  ASSET_CATEGORY_KEYS.has(String(category || '').trim().toLowerCase()) ? 'asset' : 'consumable';

export const itemKindOf = (item) => item?.item_kind || kindFromCategory(item?.category);

export const DEPRECIATION_METHODS = [
  { value: 'straight_line', label: 'Straight line' },
  { value: 'declining_balance', label: 'Declining balance' },
  { value: 'none', label: 'None (e.g. land)' }
];

export const ASSET_CONDITIONS = ['excellent', 'good', 'fair', 'poor'];
export const ASSET_STATUSES = [
  { value: 'in_service', label: 'In service' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'idle', label: 'Idle' }
];

/**
 * Accumulated depreciation PER UNIT at the end of `asOfYear`. Same maths and
 * convention as public.fn_cmms_accum_depreciation (a full year is charged in
 * the year of acquisition), so the form preview matches what the database
 * will report.
 */
export const accumulatedDepreciation = ({ cost, salvage = 0, lifeYears, method = 'straight_line', acquisitionYear }, asOfYear = new Date().getFullYear()) => {
  const c = Number(cost) || 0;
  const s = Number(salvage) || 0;
  const life = Number(lifeYears) || 0;
  const acq = Number(acquisitionYear) || 0;
  if (!method || method === 'none' || life <= 0 || !acq || asOfYear < acq || c <= 0) return 0;
  const years = asOfYear - acq + 1;
  const depreciable = Math.max(0, c - s);
  let acc;
  if (method === 'declining_balance') {
    const rate = Math.min(2 / life, 1);
    acc = c - c * Math.pow(1 - rate, Math.min(years, life));
  } else {
    acc = (depreciable / life) * years;
  }
  return Math.max(0, Math.round(Math.min(depreciable, acc) * 100) / 100);
};

export const netBookValue = (asset, asOfYear) => {
  const cost = Number(asset?.acquisition_cost ?? asset?.unit_price ?? asset?.unit_cost) || 0;
  const qty = Number(asset?.quantity_in_stock ?? asset?.quantity) || 0;
  const acc = accumulatedDepreciation({
    cost,
    salvage: asset?.salvage_value,
    lifeYears: asset?.useful_life_years,
    method: asset?.depreciation_method,
    acquisitionYear: asset?.acquisition_year
  }, asOfYear);
  return Math.round((cost - acc) * qty * 100) / 100;
};

export const getAssetRegister = (companyId, asOfYear = null) =>
  call('fn_cmms_get_asset_register', { p_company_id: companyId, p_as_of_year: asOfYear });

export const postAssetDepreciation = (companyId, year = null) =>
  call('fn_cmms_post_asset_depreciation', { p_company_id: companyId, p_year: year });

export const disposeAsset = (itemId, { quantity = null, proceeds = 0, reason = null } = {}) =>
  call('fn_cmms_dispose_asset', { p_item_id: itemId, p_quantity: quantity, p_proceeds: proceeds, p_reason: reason });

// ============================================================
// TRANSACTION LEDGER (single source of truth for business reports)
// ============================================================

export const TXN_TYPES = {
  opening:      { label: 'Opening balance', tone: 'neutral' },
  purchase:     { label: 'Purchase',        tone: 'in' },
  restock:      { label: 'Restock',         tone: 'in' },
  issue:        { label: 'Issued / used',   tone: 'out' },
  adjustment:   { label: 'Adjustment',      tone: 'neutral' },
  write_off:    { label: 'Write-off',       tone: 'out' },
  transfer_out: { label: 'To shop floor',   tone: 'out' },
  transfer_in:  { label: 'From shop floor', tone: 'in' },
  depreciation: { label: 'Depreciation',    tone: 'out' },
  disposal:     { label: 'Disposal',        tone: 'out' }
};

/**
 * Read ledger rows (RLS limits them to branches the caller may see).
 * filters: { kind, type, year, companyIds[], itemId, limit, offset }
 */
export const getInventoryTransactions = async (companyId, filters = {}) => {
  try {
    const { kind, type, year, companyIds, itemId, limit = 100, offset = 0 } = filters;
    let query = supabase
      .from('cmms_inventory_transactions')
      .select('*', { count: 'exact' })
      .order('txn_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (companyIds?.length) query = query.in('cmms_company_id', companyIds);
    else if (companyId) query = query.eq('cmms_company_id', companyId);
    if (kind) query = query.eq('item_kind', kind);
    if (type) query = query.eq('txn_type', type);
    if (year) query = query.eq('fiscal_year', year);
    if (itemId) query = query.eq('item_id', itemId);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data || [], count: count ?? (data || []).length, error: null };
  } catch (error) {
    console.error('❌ getInventoryTransactions failed:', error?.message || error);
    return { data: [], count: 0, error };
  }
};

/**
 * Completeness of the money feed: ledger rows that are money transactions but
 * are missing from the business transaction record. Empty = everything booked.
 */
export const getUnpostedMoneyEntries = (companyId) =>
  call('fn_cmms_unposted_money_entries', { p_company_id: companyId });

/** Book anything unposted (idempotent). Resolves { posted, still_unposted }. */
export const postMissingMoneyEntries = (companyId) =>
  call('fn_cmms_post_missing_money_entries', { p_company_id: companyId });

/** Business report: scope 'branch' or 'group' (head-office admins only). */
export const getInventoryReport = (companyId, year = null, scope = 'branch') =>
  call('fn_cmms_inventory_report', { p_company_id: companyId, p_year: year, p_scope: scope });

/** Items whose shelf quantity disagrees with the ledger. Empty = books agree. */
export const getInventoryReconciliation = (companyId) =>
  call('fn_cmms_inventory_reconciliation', { p_company_id: companyId });

// ============================================================
// BUSINESS GROUP / BRANCHES
// ============================================================

export const getMyBusinessGroup = (companyId) =>
  call('fn_cmms_get_my_business_group', { p_company_id: companyId });

export const createBusinessGroup = (companyId, name, baseCurrency = null) =>
  call('fn_cmms_create_business_group', { p_company_id: companyId, p_name: name, p_base_currency: baseCurrency });

export const linkCompanyToGroup = (groupId, companyId, { branchName, branchCode, country, currency, timezone } = {}) =>
  call('fn_cmms_link_company_to_group', {
    p_group_id: groupId,
    p_company_id: companyId,
    p_branch_name: branchName || null,
    p_branch_code: branchCode || null,
    p_country: country || null,
    p_currency: currency || null,
    p_timezone: timezone || null
  });

export const updateBranch = (companyId, { branchName, branchCode, country, currency, timezone } = {}) =>
  call('fn_cmms_update_branch', {
    p_company_id: companyId,
    p_branch_name: branchName || null,
    p_branch_code: branchCode || null,
    p_country: country || null,
    p_currency: currency || null,
    p_timezone: timezone || null
  });

export const unlinkCompanyFromGroup = (companyId) =>
  call('fn_cmms_unlink_company_from_group', { p_company_id: companyId });

export const setGroupFxRate = (groupId, currency, rateToBase, effectiveFrom = null) =>
  call('fn_cmms_set_group_fx_rate', {
    p_group_id: groupId,
    p_currency: currency,
    p_rate_to_base: rateToBase,
    p_effective_from: effectiveFrom
  });

// ============================================================
// SUPERMARKET LINK (supermartkera.icanera.space)
// ============================================================

export const SUPERMARKET_URL = 'https://supermartkera.icanera.space';

export const listMySupermarkets = () => call('fn_cmms_list_my_supermarkets', {});
export const getLinkedSupermarket = (companyId) => call('fn_cmms_get_linked_supermarket', { p_company_id: companyId });
export const linkSupermarket = (companyId, supermarketId) =>
  call('fn_cmms_link_supermarket', { p_company_id: companyId, p_supermarket_id: supermarketId });
export const unlinkSupermarket = (companyId) => call('fn_cmms_unlink_supermarket', { p_company_id: companyId });
export const searchSupermarketProducts = (companyId, query = '') =>
  call('fn_cmms_search_supermarket_products', { p_company_id: companyId, p_query: query || null });
export const linkItemToProduct = (itemId, productId) =>
  call('fn_cmms_link_item_to_product', { p_item_id: itemId, p_product_id: productId });
export const getSupermarketStockLink = (companyId) =>
  call('fn_cmms_get_supermarket_stock_link', { p_company_id: companyId });
export const transferStockToSupermarket = (itemId, quantity, direction = 'to_shop', note = null) =>
  call('fn_cmms_transfer_stock_supermarket', { p_item_id: itemId, p_quantity: quantity, p_direction: direction, p_note: note });

// ============================================================
// FORMATTING
// ============================================================

export const formatMoney = (value, currency = 'UGX') => {
  const n = Number(value) || 0;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${Math.round(n).toLocaleString()}`;
  }
};

export default {
  ITEM_KINDS, kindFromCategory, itemKindOf, accumulatedDepreciation, netBookValue,
  getAssetRegister, postAssetDepreciation, disposeAsset,
  getInventoryTransactions, getInventoryReport, getInventoryReconciliation, getUnpostedMoneyEntries, postMissingMoneyEntries,
  getMyBusinessGroup, createBusinessGroup, linkCompanyToGroup, updateBranch, unlinkCompanyFromGroup, setGroupFxRate,
  listMySupermarkets, getLinkedSupermarket, linkSupermarket, unlinkSupermarket,
  searchSupermarketProducts, linkItemToProduct, getSupermarketStockLink, transferStockToSupermarket
};
