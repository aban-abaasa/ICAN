/**
 * On-chain tokens service: the only place the app talks to the bridge database functions and builds contract handles.
 *
 *  - getChainConfig / getFxRate     public: where the contracts are, and the USD -> local display rate
 *  - getChainOverview               the signed-in user's linked addresses, withdrawals and burns
 *  - requestLinkChallenge / submitLink   step 1 and 2 of proving you control a wallet address
 *  - requestWithdrawal / cancelWithdrawal / unlinkAddress    ledger ICEC <-> ICEC-C
 *  - contract handles               ICEC-S (the stable form's vault and token) and ICEC-C, from the addresses in the database
 *
 * Self-custody: nothing here ever sees a private key. Every on-chain action is signed in the user's own wallet; the app
 * builds the request and the wallet asks them. Every function reports "the database part is not installed yet" as
 * { missing: true } instead of throwing, so a screen can hide itself until the SQL migrations have been run.
 */

import { ethers } from 'ethers';
import { supabase } from '../lib/supabase/client';
import { isMissingFunction } from '../utils/feedPolling';
import { newRequestId, isTransientNetworkError } from '../utils/tradeResult';

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (isMissingFunction(error)) return { missing: true };
    throw error;
  }
  return { data };
};

// ---- reading ---------------------------------------------------------------------------------------------------------------

export const getChainConfig = async () => {
  const res = await rpc('ican_chain_public_config', {});
  if (res.missing || !res.data) return { missing: true };
  return res.data;
};

export const getFxRate = async (pair = 'USD/UGX') => {
  const res = await rpc('ican_fx_rate', { p_pair: pair });
  if (res.missing || !res.data) return { available: false };
  return res.data;
};

export const getChainOverview = async () => {
  const res = await rpc('ican_chain_my_overview', {});
  if (res.missing) return { missing: true };
  return res.data?.success ? res.data : { success: false, error: res.data?.error || 'Could not load your on-chain position.' };
};

// ---- linking a wallet ------------------------------------------------------------------------------------------------------

export const requestLinkChallenge = async (address) => {
  const res = await rpc('ican_chain_link_challenge', { p_address: address });
  if (res.missing) return { success: false, error: 'On-chain features are not available yet.' };
  return res.data || { success: false, error: 'No answer from the server.' };
};

/** Sends the wallet's signature to the relayer endpoint, which checks it and asks the database to record the link. */
export const submitLink = async ({ challengeId, signature }) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { success: false, code: 'not_signed_in', error: 'Please sign in.' };
  const res = await fetch('/api/chain-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ challengeId, signature }),
  });
  const body = await res.json().catch(() => null);
  if (body?.success) return body;
  return { success: false, code: body?.code, error: LINK_MESSAGES[body?.code] || body?.error || 'Could not link that wallet. Please try again.' };
};

const LINK_MESSAGES = {
  challenge_expired: 'That took too long. Start again.',
  challenge_used: 'That request was already used. Start again.',
  signature_mismatch: 'The signature did not come from that address. Make sure the right account is selected in your wallet.',
  address_taken: 'That address is already linked to another account.',
  too_many_addresses: 'You have linked the most addresses allowed. Remove one first.',
  unknown_challenge: 'That request was not found. Start again.',
};

export const unlinkAddress = async (address) => {
  const res = await rpc('ican_chain_unlink_address', { p_address: address });
  return res.missing ? { success: false, error: 'Not available yet.' } : res.data;
};

// ---- the bridge ------------------------------------------------------------------------------------------------------------

const WITHDRAW_MESSAGES = {
  bridge_paused: 'Moving ICEC on-chain is paused for a moment. Please try again later.',
  not_configured: 'On-chain features are not set up yet.',
  address_not_linked: 'Link this wallet address to your account first.',
  daily_limit: 'That would take you over the daily limit for moving ICEC on-chain.',
  rate_limited: 'Too many withdrawals in an hour. Please wait a while.',
};

/** One withdrawal. A dropped connection is retried with the SAME request id; a server answer is never retried. */
export const requestWithdrawal = async ({ amount, address, requestId }) => {
  const id = requestId || newRequestId('bridge');
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300 * attempt * attempt));
    const { data, error } = await supabase.rpc('ican_bridge_request_withdrawal', { p_amount: amount, p_address: address, p_request_id: id });
    if (!error) return data?.success ? data : { success: false, code: data?.code, error: data?.error || WITHDRAW_MESSAGES[data?.code] || 'Could not start that withdrawal.' };
    if (isMissingFunction(error)) return { success: false, code: 'unavailable', error: 'On-chain features are not available yet.' };
    if (!isTransientNetworkError(error)) return { success: false, error: error.message || 'Could not start that withdrawal.' };
    lastError = error;
  }
  return { success: false, code: 'network', error: `Could not reach the server (${lastError?.message || 'network error'}). Check your withdrawals before trying again: if it is listed, it went through.` };
};

export const cancelWithdrawal = async (withdrawalId) => {
  const res = await rpc('ican_bridge_cancel_withdrawal', { p_withdrawal_id: withdrawalId });
  return res.missing ? { success: false, error: 'Not available yet.' } : res.data;
};

// ---- contracts (read from the addresses the database holds) -----------------------------------------------------------------

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function totalSupply() view returns (uint256)',
];
const VAULT_ABI = [
  'function deposit(uint256 amount) returns (uint256)',
  'function redeem(uint256 amount) returns (uint256)',
  'function collateralization() view returns (uint256 reserveBalance, uint256 supply)',
  'function depositsPaused() view returns (bool)',
  'function reserve() view returns (address)',
  'function token() view returns (address)',
];
const ICEC_C_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function burnForCredit(uint256 amount, bytes32 creditId)',
  'function mintPaused() view returns (bool)',
];

// The ICEC-S token and the reserve coin are read from the vault itself, on the chain, so they are right even when the database's
// copy has not been filled in yet (the relayer fills it in) or is stale. Remembered per chain + vault: they cannot change.
const vaultFacts = new Map();
export const resolveStableContracts = async (provider, cfg) => {
  const key = `${cfg.chain_id}:${String(cfg.stable_vault_address).toLowerCase()}`;
  if (!vaultFacts.has(key)) {
    const vault = new ethers.Contract(cfg.stable_vault_address, VAULT_ABI, provider);
    const pending = Promise.all([vault.token(), vault.reserve()]).then(([token, reserve]) => ({ token, reserve }));
    vaultFacts.set(key, pending);
    pending.catch(() => vaultFacts.delete(key));       // a failed read is retried next time
  }
  return vaultFacts.get(key);
};

/** The three contracts, as `{ vault, token, reserve }`. Pass the addresses from resolveStableContracts. */
// Read-only access for a visitor with no wallet: a public node for the network the contracts are on. VITE_CHAIN_RPC_URL wins; otherwise
// the well-known free endpoint of the common test networks. null when there is none (the screen then says so instead of guessing).
const PUBLIC_RPC = {
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com', 17000: 'https://ethereum-holesky-rpc.publicnode.com',
  84532: 'https://sepolia.base.org', 421614: 'https://sepolia-rollup.arbitrum.io/rpc', 11155420: 'https://sepolia.optimism.io',
  80002: 'https://rpc-amoy.polygon.technology',
};
export const publicProvider = (cfg) => {
  const chainId = Number(cfg?.chain_id);
  const url = (import.meta.env?.VITE_CHAIN_RPC_URL || '').trim() || PUBLIC_RPC[chainId];
  if (!url || !chainId) return null;
  return new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true });
};

export const stableContracts = (runner, cfg, resolved) => ({
  reserve: new ethers.Contract(resolved.reserve, ERC20_ABI, runner),
  token: new ethers.Contract(resolved.token, ERC20_ABI, runner),
  vault: new ethers.Contract(cfg.stable_vault_address, VAULT_ABI, runner),
});
export const communityContract = (runner, cfg) => new ethers.Contract(cfg.icec_community_address, ICEC_C_ABI, runner);

/** A reference the holder chooses for a burn so the credit can be matched to it. */
export const newCreditId = () => ethers.hexlify(ethers.randomBytes(32));

// ---- operators (developer panel) -------------------------------------------------------------------------------------------

export const devChain = {
  overview: (token) => rpc('ican_chain_dev_overview', { dev_token: token }),
  setSettings: (token, changes) => rpc('ican_chain_dev_set_settings', { dev_token: token, p_changes: changes }),
  setContracts: (token, changes) => rpc('ican_chain_dev_set_contracts', { dev_token: token, p_changes: changes }),
  reconcile: (token) => rpc('ican_chain_dev_reconcile', { dev_token: token }),
  resolveAnomaly: (token, id, note) => rpc('ican_chain_dev_resolve_anomaly', { dev_token: token, p_id: id, p_note: note }),
  requeue: (token, id, memo) => rpc('ican_chain_dev_requeue', { dev_token: token, p_withdrawal_id: id, p_memo: memo }),
  fxOverview: (token) => rpc('ican_chain_dev_fx_overview', { dev_token: token }),
};

export default { getChainConfig, getFxRate, getChainOverview, requestLinkChallenge, submitLink, unlinkAddress, requestWithdrawal, cancelWithdrawal, stableContracts, resolveStableContracts, publicProvider, communityContract, newCreditId, devChain };
