/**
 * PitchIn Live Share Valuation Service
 *
 * Aggregates real transaction data from all 4 apps (same Supabase instance)
 * to produce a live share price for a PitchIn business, with each snapshot
 * SHA-256 hashed for tamper evidence.
 *
 * Formula:
 *   Assets         = ican_transactions(capital_asset) + CMMS inventory + icaneracoin holdings × market_price
 *   Revenue        = ican_transactions(sold_income) + farm sales + boda fleet earnings + supermarket volume
 *   COGS           = ican_transactions(bought_stock)
 *   Expenses       = ican_transactions(operating + salary + tax)
 *   Net Profit     = Revenue - COGS - Expenses
 *   Business Value = Assets + (Net Profit × 3)
 *   Share Price    = Business Value ÷ total_shares
 */

import { supabase } from '../lib/supabase/client';
import {
  hashSnapshotData,
  saveSnapshotToDb,
  getLatestSnapshot,
  getSharePriceHistory
} from './pitchinShareBlockchainService';

const EARNINGS_MULTIPLE = 3; // Standard SME valuation multiple

// ─── Linked sources ───────────────────────────────────────────────────────────

async function getDataLinks(businessProfileId) {
  const { data, error } = await supabase
    .from('pitchin_business_data_links')
    .select('source_app, source_entity_id, source_entity_name')
    .eq('business_profile_id', businessProfileId)
    .eq('is_active', true);
  if (error) throw error;
  return Object.fromEntries((data || []).map(r => [r.source_app, r]));
}

// ─── Source: ICAN "Record Every Transaction" ──────────────────────────────────

async function getIcanFinancials(businessProfileId) {
  const { data, error } = await supabase.rpc('fn_get_business_ican_financials', {
    p_business_profile_id: businessProfileId
  });
  if (error) throw error;
  return data || {};
}

// ─── Source: CMMS inventory value ─────────────────────────────────────────────

async function getCmmsInventoryValue(cmmsCompanyId) {
  if (!cmmsCompanyId) return { valueUgx: 0, itemCount: 0 };
  // A direct table select is blocked by RLS unless the viewer is in that CMMS
  // company's cmms_users table — a PitchIn business owner viewing their own
  // valuation usually isn't. fn_get_company_inventory is the same
  // SECURITY DEFINER RPC CMSSModule.jsx itself uses to read inventory
  // (see backend/FIX_INVENTORY_FETCH_RLS.sql), so this returns the same
  // items/value the CMMS dashboard shows instead of silently coming back empty.
  const { data, error } = await supabase.rpc('fn_get_company_inventory', {
    p_company_id: cmmsCompanyId
  });
  if (error) {
    console.warn('[Valuation] CMMS inventory read failed:', error.message);
    return { valueUgx: 0, itemCount: 0 };
  }
  const valueUgx = (data || []).reduce((sum, item) =>
    sum + (parseFloat(item.unit_price) || 0) * (parseFloat(item.quantity_in_stock) || 0), 0);
  return { valueUgx, itemCount: (data || []).length };
}

// ─── Source: Manual business ledger entries (ican_transactions) ──────────────
// Populated by the "Record Transaction" quick-add form (MobileView) when the
// user tags an entry to this business via business_profile_id.

async function getManualTransactionsDetail(businessProfileId) {
  if (!businessProfileId) return { count: 0 };
  // Plain table query is RLS-scoped to rows this caller personally recorded —
  // it would silently undercount once a team member/co-owner contributes
  // entries. The RPC is SECURITY DEFINER (re-checks business ownership itself)
  // so it counts every entry tagged to the business regardless of who logged it.
  const { data, error } = await supabase.rpc('fn_get_business_manual_transaction_count', {
    p_business_profile_id: businessProfileId
  });
  if (error) {
    console.warn('[Valuation] Manual transaction count read failed:', error.message);
    return { count: 0 };
  }
  return { count: data || 0 };
}

// ─── Per-contributor breakdown of manual ledger entries ──────────────────────
// Lets the business owner see which team member/co-owner recorded what,
// not just the aggregate totals. See BUSINESS_TRANSACTIONS_BY_CONTRIBUTOR.sql.

const INCOME_BUCKETS = new Set(['sold_income', 'loan_inflow']);
const EXPENSE_BUCKETS = new Set(['bought_stock', 'operating_expense', 'salary_expense', 'tax_expense', 'dividend_payout']);

// Returns { contributors, error }. `error` is surfaced (not swallowed) so the
// UI can tell "genuinely zero entries" apart from "the RPC failed" — e.g. the
// caller isn't the owner/a shareholder, or BUSINESS_TRANSACTIONS_BY_CONTRIBUTOR.sql
// hasn't been deployed yet (both would otherwise silently look like "no data").
export async function getBusinessTransactionsByContributor(businessProfileId) {
  if (!businessProfileId) return { contributors: [], error: null };
  const { data, error } = await supabase.rpc('fn_get_business_transactions_by_contributor', {
    p_business_profile_id: businessProfileId
  });
  if (error) {
    console.warn('[Valuation] Per-contributor transaction read failed:', error.message);
    return { contributors: [], error: error.message };
  }

  const byContributor = new Map();
  for (const row of data || []) {
    const key = row.contributor_user_id || 'unknown';
    if (!byContributor.has(key)) {
      byContributor.set(key, {
        userId: row.contributor_user_id,
        name: row.contributor_name || row.contributor_email || 'Unknown',
        email: row.contributor_email,
        count: 0,
        netUgx: 0,
        lastEntryAt: row.created_at,
        entries: []
      });
    }
    const bucket = byContributor.get(key);
    const amount = parseFloat(row.amount) || 0;
    const sign = INCOME_BUCKETS.has(row.reporting_bucket) ? 1
      : EXPENSE_BUCKETS.has(row.reporting_bucket) ? -1
      : 0;
    bucket.count += 1;
    bucket.netUgx += sign * amount;
    bucket.entries.push(row);
    if (new Date(row.created_at) > new Date(bucket.lastEntryAt)) bucket.lastEntryAt = row.created_at;
  }

  const contributors = Array.from(byContributor.values()).sort((a, b) => b.count - a.count);
  return { contributors, error: null };
}

// ─── Source: Cross-app icaneracoin wallet transactions ───────────────────────
// ican_coin_transactions real schema (ICAN_CROSS_APP_WALLET_MIGRATION.sql):
//   ican_amount, ugx_floor_value (generated = ican_amount * 5000),
//   transaction_type ('earn','transfer_in','transfer_out','tithe','cashback',
//   'purchase','sale','refund'), source_app ('ican','digital-city-era',
//   'farm-agent','mybodaguy'). No `type` or `price_per_coin` columns exist —
//   an earlier version of this query used those and silently returned 0.

const INCOMING_WALLET_TYPES = new Set(['transfer_in', 'earn', 'cashback', 'sale', 'refund']);

async function getWalletTransactionsDetail(ownerUserId) {
  const empty = { totalUgx: 0, count: 0, bySourceApp: {} };
  if (!ownerUserId) return empty;
  const { data, error } = await supabase
    .from('ican_coin_transactions')
    .select('ican_amount, ugx_floor_value, transaction_type, source_app')
    .eq('recipient_user_id', ownerUserId)
    .eq('status', 'completed');
  if (error) {
    console.warn('[Valuation] Wallet transactions read failed:', error.message);
    return empty;
  }

  const bySourceApp = {};
  let totalUgx = 0;
  let count = 0;

  for (const tx of data || []) {
    if (!INCOMING_WALLET_TYPES.has(tx.transaction_type)) continue; // skip transfer_out/purchase/tithe
    const ugx = tx.ugx_floor_value != null
      ? parseFloat(tx.ugx_floor_value)
      : (parseFloat(tx.ican_amount) || 0) * 5000;
    const app = tx.source_app || 'ican';

    if (!bySourceApp[app]) bySourceApp[app] = { count: 0, valueUgx: 0 };
    bySourceApp[app].count    += 1;
    bySourceApp[app].valueUgx += ugx;

    totalUgx += ugx;
    count    += 1;
  }

  return { totalUgx, count, bySourceApp };
}

// ─── Source: SupermarketEra purchase orders ───────────────────────────────────

async function getSupermarketRevenue(ownerUserId) {
  if (!ownerUserId) return { valueUgx: 0, orderCount: 0 };
  // purchase_orders tracks B2B sales; supplier_id links to the supplier entity.
  // We use total_amount_ugx which is the UGX-denominated order value.
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('total_amount')
    .eq('status', 'completed');
  if (error) {
    console.warn('[Valuation] SupermarketEra orders read failed:', error.message);
    return { valueUgx: 0, orderCount: 0 };
  }
  // Sum all completed orders visible to this user (RLS scopes to their supplier)
  const valueUgx = (data || []).reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
  return { valueUgx, orderCount: (data || []).length };
}

// ─── Source: icaneracoin holdings at live market price ───────────────────────

async function getIcanHoldingsValue(businessOwnerUserId) {
  if (!businessOwnerUserId) return { valueUgx: 0, icanBalance: 0, marketPriceUgx: 5000 };

  const [walletRes, priceRes] = await Promise.all([
    supabase
      .from('ican_user_wallets')
      .select('ican_balance')
      .eq('user_id', businessOwnerUserId)
      .maybeSingle(),
    supabase
      .from('ican_coin_market_prices')
      .select('price_ugx')
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const icanBalance = parseFloat(walletRes.data?.ican_balance || 0);
  // Floor price 5000 UGX; market price can be higher
  const marketPriceUgx = Math.max(5000, parseFloat(priceRes.data?.price_ugx || 5000));

  return {
    valueUgx: icanBalance * marketPriceUgx,
    icanBalance,
    marketPriceUgx
  };
}

// ─── Share configuration: owner-set total share count ─────────────────────────
// Lives on business_profiles (ADD_BUSINESS_SHARE_CONFIG.sql) rather than the
// heavier investment_agreements MOU/signature table — total share count is
// business configuration, not a signed legal agreement.

async function getShareConfig(businessProfileId) {
  const { data, error } = await supabase
    .from('business_profiles')
    .select('total_shares, declared_share_price_ugx')
    .eq('id', businessProfileId)
    .maybeSingle();
  if (error || !data?.total_shares) return { totalShares: null, declaredPriceUgx: null };
  return {
    totalShares: parseInt(data.total_shares),
    declaredPriceUgx: data.declared_share_price_ugx != null ? parseFloat(data.declared_share_price_ugx) : null
  };
}

/**
 * Owner sets/changes how many total shares their business has. Resets the
 * declared-price baseline to the current share price — changing share count
 * is a split, not real business growth/decline, so % change shouldn't jump
 * just because the share count changed.
 */
export async function setBusinessTotalShares(businessProfileId, totalShares, businessOwnerUserId) {
  const shares = parseInt(totalShares);
  if (!Number.isFinite(shares) || shares <= 0) throw new Error('Total shares must be a positive number');

  // Compute the price this new share count implies right now, so the
  // baseline is meaningful from the moment it's set (not stale/zero).
  const valuation = await calculateLiveShareValue(businessProfileId, businessOwnerUserId, {
    saveSnapshot: false,
    _shareOverride: shares
  });

  const { error } = await supabase
    .from('business_profiles')
    .update({ total_shares: shares, declared_share_price_ugx: valuation.sharePriceUgx })
    .eq('id', businessProfileId);
  if (error) throw error;

  return valuation.sharePriceUgx;
}

// ─── Main valuation function ──────────────────────────────────────────────────

/**
 * Calculate the live share price for a PitchIn business.
 *
 * @param {string} businessProfileId - UUID of the business_profiles row
 * @param {string} businessOwnerUserId - auth.uid() of the business owner
 * @param {object} options
 * @param {boolean} options.saveSnapshot - Whether to save today's snapshot (default: true)
 * @returns {Promise<ValuationResult>}
 */
export async function calculateLiveShareValue(businessProfileId, businessOwnerUserId, options = {}) {
  const { saveSnapshot = true, _shareOverride = null } = options;

  // 1. Get owner-configured share count (business_profiles.total_shares).
  // _shareOverride lets setBusinessTotalShares() preview the price a new
  // share count implies before committing it.
  const shareConfig = await getShareConfig(businessProfileId);
  const totalShares = _shareOverride || shareConfig.totalShares;

  // 2. Get linked app sources
  const links = await getDataLinks(businessProfileId);

  // 3. Gather all financial data in parallel
  const [
    icanFinancials,
    manualDetail,
    cmmsDetail,
    walletDetail,
    supermarketDetail,
    icanHoldings
  ] = await Promise.all([
    getIcanFinancials(businessProfileId),
    getManualTransactionsDetail(businessProfileId),
    getCmmsInventoryValue(links['cmms']?.source_entity_id),
    getWalletTransactionsDetail(businessOwnerUserId),
    getSupermarketRevenue(businessOwnerUserId),
    getIcanHoldingsValue(businessOwnerUserId)
  ]);

  // 4. Apply the formula
  const soldIncome      = parseFloat(icanFinancials.sold_income      || 0);
  const boughtStock     = parseFloat(icanFinancials.bought_stock     || 0);
  const capitalAssets   = parseFloat(icanFinancials.capital_assets   || 0);
  const operatingExp    = parseFloat(icanFinancials.operating_expense || 0);
  const salaryExp       = parseFloat(icanFinancials.salary_expense   || 0);
  const taxExp          = parseFloat(icanFinancials.tax_expense      || 0);

  // Wallet earnings split by the app that actually issued them. Only the
  // native 'ican' wallet is always counted — FarmAgent, MyBodaGuy and
  // SupermarketEra earnings only count once the owner explicitly links that
  // source below, so Link/Unlink visibly changes the share price.
  const isSourceLinked  = (sourceApp) => Boolean(links[sourceApp]);
  const farmWalletUgx   = isSourceLinked('farm-agent')       ? (walletDetail.bySourceApp['farm-agent']?.valueUgx || 0) : 0;
  const bodaWalletUgx   = isSourceLinked('mybodaguy')        ? (walletDetail.bySourceApp['mybodaguy']?.valueUgx || 0) : 0;
  const dceWalletUgx    = isSourceLinked('digital-city-era') ? (walletDetail.bySourceApp['digital-city-era']?.valueUgx || 0) : 0;
  const nativeWalletUgx = walletDetail.bySourceApp['ican']?.valueUgx || 0;
  const supermarketOrdersUgx = isSourceLinked('digital-city-era') ? supermarketDetail.valueUgx : 0;
  const supermarketRevenue   = supermarketOrdersUgx + dceWalletUgx;

  const totalRevenue  = soldIncome + farmWalletUgx + bodaWalletUgx + nativeWalletUgx + supermarketRevenue;
  const totalCogs     = boughtStock;
  const totalExpenses = operatingExp + salaryExp + taxExp;
  const netProfit     = totalRevenue - totalCogs - totalExpenses;

  const totalAssets     = capitalAssets + cmmsDetail.valueUgx + icanHoldings.valueUgx;
  const businessValue   = totalAssets + (netProfit * EARNINGS_MULTIPLE);

  // No share count configured yet — don't compute a misleading "per share"
  // number by dividing the whole business value by a hardcoded 1 share.
  const needsShareSetup = !totalShares;
  const sharePriceUgx   = needsShareSetup ? null : businessValue / totalShares;

  let declaredPriceUgx = shareConfig.declaredPriceUgx;
  // Bootstrap the baseline the first time a share count exists but no
  // declared price has been captured yet (e.g. right after setup).
  if (!needsShareSetup && !_shareOverride && declaredPriceUgx == null && sharePriceUgx != null) {
    declaredPriceUgx = sharePriceUgx;
    supabase.from('business_profiles')
      .update({ declared_share_price_ugx: sharePriceUgx })
      .eq('id', businessProfileId)
      .then(({ error }) => { if (error) console.warn('[Valuation] Failed to bootstrap declared price:', error.message); });
  }

  const priceChangePercent = (!needsShareSetup && declaredPriceUgx > 0)
    ? ((sharePriceUgx - declaredPriceUgx) / declaredPriceUgx) * 100
    : 0;

  const breakdown = {
    ican_sold_income:     soldIncome,
    ican_capital_assets:  capitalAssets,
    ican_bought_stock:    boughtStock,
    ican_operating_exp:   operatingExp,
    ican_salary_exp:      salaryExp,
    ican_tax_exp:         taxExp,
    farm_revenue:         farmWalletUgx,
    boda_revenue:         bodaWalletUgx,
    supermarket_revenue:  supermarketRevenue,
    ican_wallet_revenue:  nativeWalletUgx,
    cmms_inventory_value: cmmsDetail.valueUgx,
    ican_holdings_ican:   icanHoldings.icanBalance,
    ican_market_price:    icanHoldings.marketPriceUgx,
    ican_holdings_ugx:    icanHoldings.valueUgx,
    earnings_multiple:    EARNINGS_MULTIPLE
  };

  // Real, per-source record counts + values — powers the "where did this come
  // from" view in the Link Data Sources panel (manual ledger vs wallet vs CMMS).
  // `counted` tells the UI whether this app's earnings are actually included
  // in the share price right now (i.e. whether it's linked) — the real data
  // is still shown either way so linking/unlinking is visibly explained.
  const ALWAYS_COUNTED_SOURCE_APPS = new Set(['ican']);
  const walletBySourceApp = Object.fromEntries(
    Object.entries(walletDetail.bySourceApp).map(([app, v]) => [
      app,
      { ...v, counted: ALWAYS_COUNTED_SOURCE_APPS.has(app) || isSourceLinked(app) }
    ])
  );

  const sourceStats = {
    manual: {
      count:   manualDetail.count,
      valueUgx: soldIncome + capitalAssets
    },
    wallet: {
      count:    walletDetail.count,
      valueUgx: nativeWalletUgx + farmWalletUgx + bodaWalletUgx + dceWalletUgx,
      totalRealUgx: walletDetail.totalUgx, // includes unlinked apps' earnings, for transparency
      bySourceApp: walletBySourceApp
    },
    cmms: {
      itemCount: cmmsDetail.itemCount,
      valueUgx:  cmmsDetail.valueUgx,
      linked:    isSourceLinked('cmms')
    },
    supermarket: {
      orderCount: supermarketDetail.orderCount,
      valueUgx:   supermarketDetail.valueUgx,
      linked:     isSourceLinked('digital-city-era')
    }
  };

  const result = {
    businessProfileId,
    sharePriceUgx,
    originalPriceUgx: declaredPriceUgx,
    priceChangePercent,
    needsShareSetup,
    businessValueUgx: businessValue,
    totalRevenueUgx:  totalRevenue,
    totalAssetsUgx:   totalAssets,
    icanHoldingsValue: icanHoldings.valueUgx,
    netProfitUgx:     netProfit,
    totalShares,
    breakdown,
    sourceStats,
    computedAt:       new Date().toISOString(),
    blockchainVerified: false,
    blockchainTxHash: null
  };

  // 5. Save snapshot — skip until shares are configured, there's nothing
  // meaningful to snapshot yet.
  if (saveSnapshot && !needsShareSetup) {
    const snapshotDate = new Date().toISOString().split('T')[0];
    const snapshotPayload = {
      businessProfileId,
      snapshotDate,
      sharePriceUgx,
      businessValueUgx: businessValue,
      totalShares,
      netProfitUgx: netProfit,
      totalRevenueUgx: totalRevenue,
      totalAssetsUgx: totalAssets,
      icanHoldingsValue: icanHoldings.valueUgx,
      breakdown
    };

    const dataHash = await hashSnapshotData(snapshotPayload);
    result.dataHash = dataHash;

    try {
      await saveSnapshotToDb({
        businessProfileId,
        snapshotDate,
        sharePriceUgx,
        originalPriceUgx: declaredPriceUgx,
        businessValueUgx: businessValue,
        totalRevenueUgx: totalRevenue,
        totalAssetsUgx: totalAssets,
        icanHoldingsValue: icanHoldings.valueUgx,
        netProfitUgx: netProfit,
        totalShares,
        breakdown,
        dataHash
      });
    } catch (dbErr) {
      console.warn('[Valuation] Snapshot DB save failed (non-critical):', dbErr.message);
    }
  }

  return result;
}

// ─── Business data links CRUD ─────────────────────────────────────────────────

export async function saveDataLink(businessProfileId, sourceApp, sourceEntityId, sourceEntityName) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('pitchin_business_data_links')
    .upsert({
      business_profile_id: businessProfileId,
      source_app: sourceApp,
      source_entity_id: sourceEntityId,
      source_entity_name: sourceEntityName,
      linked_by: user?.id,
      is_active: true
    }, { onConflict: 'business_profile_id,source_app' });
  if (error) throw error;
}

export async function removeDataLink(businessProfileId, sourceApp) {
  const { error } = await supabase
    .from('pitchin_business_data_links')
    .update({ is_active: false })
    .eq('business_profile_id', businessProfileId)
    .eq('source_app', sourceApp);
  if (error) throw error;
}

export async function getBusinessDataLinks(businessProfileId) {
  const { data, error } = await supabase
    .from('pitchin_business_data_links')
    .select('*')
    .eq('business_profile_id', businessProfileId)
    .eq('is_active', true);
  if (error) throw error;
  return data || [];
}

// ─── Re-exports for convenience ───────────────────────────────────────────────

export { getSharePriceHistory, getLatestSnapshot };
