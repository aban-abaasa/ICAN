/**
 * PitchIn Share Value Blockchain Anchoring Service
 *
 * Every daily share price snapshot is hashed with SHA-256 using Web Crypto API
 * and recorded on Ethereum Sepolia via the existing ICAN smart contract.
 * This makes the price history tamper-proof: investors can verify any historical
 * share price by recomputing the hash and checking it against the on-chain record.
 *
 * Uses the same BLOCKCHAIN_CONFIG and ethers.js pattern as blockchainService.js.
 */

import { supabase } from '../lib/supabase/client';

const BLOCKCHAIN_CONFIG = {
  rpcUrl: import.meta.env.VITE_BLOCKCHAIN_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo',
  chainId: parseInt(import.meta.env.VITE_BLOCKCHAIN_CHAIN_ID || '11155111'),
  contractAddress: import.meta.env.VITE_STATUS_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000',
  contractAbi: [
    'function registerStatusHash(bytes32 fileHash, string memory mediaUrl, uint256 timestamp) public returns (bytes32)',
    'function verifyStatus(bytes32 statusHash) public view returns (bool)',
    'function getStatusOwner(bytes32 statusHash) public view returns (address)',
    'event StatusRegistered(bytes32 indexed statusHash, address indexed owner, uint256 timestamp)'
  ]
};

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

// ─── Blockchain recording ─────────────────────────────────────────────────────

/**
 * Record the snapshot hash on Ethereum Sepolia.
 * Uses registerStatusHash — the mediaUrl field carries the business profile ID
 * so the on-chain record is traceable back to the specific PitchIn business.
 *
 * Returns { success, txHash, blockNumber } or { success: false, error }.
 * If no wallet private key is configured, returns success:false without throwing
 * so the valuation still works — blockchain anchoring is enhancement, not blocker.
 */
export async function anchorSnapshotOnChain(dataHash, businessProfileId, timestamp) {
  const walletKey = import.meta.env.VITE_BLOCKCHAIN_WALLET_KEY;
  if (!walletKey) {
    console.warn('[ShareBlockchain] No wallet key — snapshot saved to Supabase only');
    return { success: false, reason: 'no_wallet_key' };
  }

  try {
    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(BLOCKCHAIN_CONFIG.rpcUrl);
    const signer = new ethers.Wallet(walletKey, provider);
    const contract = new ethers.Contract(
      BLOCKCHAIN_CONFIG.contractAddress,
      BLOCKCHAIN_CONFIG.contractAbi,
      signer
    );

    // bytes32 requires exactly 32 bytes — pad/truncate the hash
    const bytes32Hash = ethers.zeroPadValue(dataHash, 32);
    const mediaUrl = `pitchin:${businessProfileId}`;
    const ts = Math.floor(timestamp / 1000);

    console.log('[ShareBlockchain] Anchoring share price snapshot on-chain...');
    const tx = await contract.registerStatusHash(bytes32Hash, mediaUrl, ts);
    const receipt = await tx.wait(1);

    console.log(`[ShareBlockchain] Anchored — block ${receipt.blockNumber}, tx ${tx.hash}`);
    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber
    };
  } catch (err) {
    console.error('[ShareBlockchain] On-chain anchoring failed (non-critical):', err.message);
    return { success: false, error: err.message };
  }
}

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verify a historical snapshot: recompute the hash from stored data and confirm
 * it matches what is recorded on-chain via verifyStatus().
 */
export async function verifySnapshotOnChain(snapshotPayload, storedHash) {
  try {
    const recomputedHash = await hashSnapshotData(snapshotPayload);
    const hashesMatch = recomputedHash === storedHash;

    const walletKey = import.meta.env.VITE_BLOCKCHAIN_WALLET_KEY;
    if (!walletKey || !snapshotPayload.blockchainTxHash) {
      return { verified: hashesMatch, source: 'hash_only' };
    }

    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(BLOCKCHAIN_CONFIG.rpcUrl);
    const contract = new ethers.Contract(
      BLOCKCHAIN_CONFIG.contractAddress,
      BLOCKCHAIN_CONFIG.contractAbi,
      provider
    );

    const bytes32Hash = ethers.zeroPadValue(storedHash, 32);
    const onChainVerified = await contract.verifyStatus(bytes32Hash);

    return {
      verified: hashesMatch && onChainVerified,
      hashMatch: hashesMatch,
      onChainVerified,
      source: 'blockchain'
    };
  } catch (err) {
    console.error('[ShareBlockchain] Verification failed:', err.message);
    return { verified: false, error: err.message };
  }
}

// ─── Supabase snapshot persistence ───────────────────────────────────────────

/**
 * Save a share value snapshot to Supabase with its blockchain proof.
 * Called after the valuation is computed and (optionally) anchored on-chain.
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
