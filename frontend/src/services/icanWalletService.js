/**
 * ICAN Wallet Service — IcanEra Wallet (ICAN Capital Engine)
 * Connects to the shared cross-app ican_user_wallets / ican_coin_transactions
 * tables (see ICAN_CROSS_APP_WALLET_MIGRATION.sql) — the same balance used by
 * digital-city-era, FARM-AGENT, and mybodaguy. This file intentionally
 * mirrors those three apps' icanWalletService so buy / sell / send-out work
 * identically everywhere. Distinct from the older icanCoinService.js, which
 * is a separate legacy wallet system used elsewhere in this app.
 * 1 ICAN = 5,000 UGX floor price. 10% tithe is auto-deducted on all earnings.
 */

import { supabase } from '../lib/supabase/client';

export const ICAN_TO_UGX = 5000;
export const SOURCE_APP = 'ican';

// ─── Wallet ─────────────────────────────────────────────────────────────────

export async function getOrCreateWallet(userId) {
  const { data, error } = await supabase.rpc('get_or_create_ican_wallet', {
    p_user_id: userId,
  });
  if (error) throw error;
  return data;
}

export async function getWallet(userId) {
  const { data, error } = await supabase
    .from('ican_user_wallets')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function getBalance(userId) {
  const wallet = await getWallet(userId);
  return {
    ican: wallet?.ican_balance ?? 0,
    ugx: (wallet?.ican_balance ?? 0) * ICAN_TO_UGX,
    address: wallet?.wallet_address ?? null,
    totalEarned: wallet?.total_earned ?? 0,
    totalSpent: wallet?.total_spent ?? 0,
    totalTithe: wallet?.total_tithe_paid ?? 0,
  };
}

// ─── Transactions ───────────────────────────────────────────────────────────

export async function getTransactions(userId, limit = 50) {
  const { data, error } = await supabase
    .from('ican_coin_transactions')
    .select('*')
    .or(`sender_user_id.eq.${userId},recipient_user_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((tx) => ({
    ...tx,
    direction: tx.recipient_user_id === userId ? 'in' : 'out',
  }));
}

// ─── Transfer ───────────────────────────────────────────────────────────────

export async function sendICAN({ fromUserId, toUserId, amount, note = '', referenceId = null }) {
  const { data, error } = await supabase.rpc('transfer_ican', {
    p_from_user: fromUserId,
    p_to_user: toUserId,
    p_amount: amount,
    p_note: note,
    p_source_app: SOURCE_APP,
    p_reference_id: referenceId,
  });
  if (error) throw error;
  if (!data.success) throw new Error(data.error);
  return data;
}

// ─── Buy / Sell ─────────────────────────────────────────────────────────────

/**
 * Buy ICAN coins — user pays UGX (recorded notionally, e.g. via
 * verify-flutterwave-payment for a real Flutterwave charge), ICAN is
 * credited to their wallet. No tithe on purchases.
 */
export async function buyICAN({ userId, icanAmount, paymentRef = null }) {
  const { data, error } = await supabase.rpc('buy_ican_coins', {
    p_user_id: userId,
    p_ican_amount: icanAmount,
    p_source_app: SOURCE_APP,
    p_payment_ref: paymentRef,
  });
  if (error) throw error;
  if (!data.success) throw new Error(data.error ?? 'Buy failed');
  return data;
}

/**
 * Sell ICAN coins — ICAN debited, UGX payout handled offline by cashier/admin.
 * For an automatic payout to mobile money or bank, use requestIcanPayout()
 * instead.
 */
export async function sellICAN({ userId, icanAmount, reference = null }) {
  const { data, error } = await supabase.rpc('sell_ican_coins', {
    p_user_id: userId,
    p_ican_amount: icanAmount,
    p_source_app: SOURCE_APP,
    p_reference: reference,
  });
  if (error) throw error;
  if (!data.success) throw new Error(data.error ?? 'Sell failed');
  return data;
}

// ─── Send Out (cash out via Flutterwave) ────────────────────────────────────

/**
 * Sell ICAN and disburse the UGX directly to mobile money or a bank account
 * via Flutterwave, instead of an offline cashier payout. Debits the wallet
 * immediately; the transfer itself settles asynchronously and is refunded
 * automatically if Flutterwave rejects or fails it.
 */
export async function requestIcanPayout({
  icanAmount,
  channel, // 'mobilemoneyuganda' | 'bank'
  phoneNumber,
  network, // 'MTN' | 'AIRTEL' — required for mobilemoneyuganda
  accountNumber,
  bankCode,
  beneficiaryName,
}) {
  const { data, error } = await supabase.functions.invoke('flutterwave-payout', {
    body: {
      ican_amount: icanAmount,
      channel,
      phone_number: phoneNumber,
      network,
      account_number: accountNumber,
      bank_code: bankCode,
      beneficiary_name: beneficiaryName,
      source_app: SOURCE_APP,
    },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error ?? 'Payout failed');
  return data;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function ugxToICAN(ugx) {
  return Math.floor((ugx / ICAN_TO_UGX) * 1e8) / 1e8;
}

export function icanToUGX(ican) {
  return ican * ICAN_TO_UGX;
}

export function formatICAN(amount) {
  return Number(amount).toFixed(4);
}

export default {
  getOrCreateWallet,
  getWallet,
  getBalance,
  getTransactions,
  sendICAN,
  buyICAN,
  sellICAN,
  requestIcanPayout,
  ugxToICAN,
  icanToUGX,
  formatICAN,
  ICAN_TO_UGX,
  SOURCE_APP,
};
