/**
 * PitchIn Share Value Snapshot Hashing Service
 *
 * Every daily share price snapshot is hashed with SHA-256 using Web Crypto API
 * and stored in Supabase alongside the snapshot. This makes tampering
 * detectable: investors can recompute the hash from the stored data and
 * confirm it matches what was recorded at snapshot time.
 *
 * There is no real on-chain anchoring — icaneracoin is an internal
 * Supabase-ledger currency with no real Ethereum keypair behind it, so there
 * is no wallet to sign a Sepolia transaction with. Anchoring is intentionally
 * a no-op rather than something waiting on a wallet key to be configured.
 */

import { supabase } from '../lib/supabase/client';

// ─── Hashing ─────────────────────────────────────────────────────────────────

/**
 * Hash a share value snapshot using Web Crypto SHA-256.
 * Produces a deterministic bytes32-compatible hex string.
 * Anyone can verify: same input data → same hash.
 */
export async function hashSnapshotData(snapshotPayload) {
  const canonical = JSON.stringify({
    business_profile_id: snapshotPayload.businessProfileId,
    snapshot_date:       snapshotPayload.snapshotDate,
    share_price_ugx:     snapshotPayload.sharePriceUgx,
    business_value_ugx:  snapshotPayload.businessValueUgx,
    total_shares:        snapshotPayload.totalShares,
    net_profit_ugx:      snapshotPayload.netProfitUgx,
    total_revenue_ugx:   snapshotPayload.totalRevenueUgx,
    total_assets_ugx:    snapshotPayload.totalAssetsUgx,
    ican_holdings_value: snapshotPayload.icanHoldingsValue,
    breakdown_hash:      JSON.stringify(snapshotPayload.breakdown || {})
  });

  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verify a historical snapshot by recomputing its hash from the stored data
 * and confirming it matches what was saved at snapshot time.
 */
export async function verifySnapshotHash(snapshotPayload, storedHash) {
  const recomputedHash = await hashSnapshotData(snapshotPayload);
  return { verified: recomputedHash === storedHash, source: 'hash_only' };
}

// ─── Supabase snapshot persistence ───────────────────────────────────────────

/**
 * Save a share value snapshot to Supabase with its tamper-evident hash.
 * Called after the valuation is computed.
 */
export async function saveSnapshotToDb(params) {
  const {
    businessProfileId,
    snapshotDate,
    sharePriceUgx,
    originalPriceUgx,
    businessValueUgx,
    totalRevenueUgx,
    totalAssetsUgx,
    icanHoldingsValue,
    netProfitUgx,
    totalShares,
    breakdown,
    dataHash,
    blockchainTxHash = null,
    blockchainBlock = null
  } = params;

  const { data, error } = await supabase.rpc('fn_save_share_value_snapshot', {
    p_business_profile_id: businessProfileId,
    p_share_price_ugx:     sharePriceUgx,
    p_original_price:      originalPriceUgx,
    p_business_value:      businessValueUgx,
    p_total_revenue:       totalRevenueUgx,
    p_total_assets:        totalAssetsUgx,
    p_ican_holdings_value: icanHoldingsValue,
    p_net_profit:          netProfitUgx,
    p_total_shares:        totalShares,
    p_breakdown:           breakdown,
    p_data_hash:           dataHash,
    p_blockchain_tx_hash:  blockchainTxHash,
    p_blockchain_block:    blockchainBlock
  });

  if (error) throw error;
  return data;
}

/**
 * Get share price history for a business (for the chart).
 * Returns snapshots sorted oldest → newest with blockchain_verified flag.
 */
export async function getSharePriceHistory(businessProfileId, days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('pitchin_share_value_snapshots')
    .select('snapshot_date, share_price_ugx, price_change_pct, business_value_ugx, blockchain_verified, data_hash, blockchain_tx_hash')
    .eq('business_profile_id', businessProfileId)
    .gte('snapshot_date', since.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get the latest verified snapshot for a business.
 */
export async function getLatestSnapshot(businessProfileId) {
  const { data, error } = await supabase
    .from('pitchin_share_value_snapshots')
    .select('*')
    .eq('business_profile_id', businessProfileId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
