/**
 * ICAN Wallet Service — IcanEra Wallet (ICAN Capital Engine)
 * Connects to the shared cross-app ican_user_wallets / ican_coin_transactions
 * tables (see ICAN_CROSS_APP_WALLET_MIGRATION.sql) — the same balance used by
 * digital-city-era, FARM-AGENT, and mybodaguy. This file intentionally
 * mirrors those three apps' icanWalletService so buy / sell / send-out work
 * identically everywhere. Distinct from the older icanCoinService.js, which
 * is a separate legacy wallet system used elsewhere in this app.
 * 1 ICAN = 5,000 UGX floor price. The wallet takes no tithe — tithe lives only in
 * the Tithe tab (church giving).
 */

import { supabase } from '../lib/supabase/client';
import { describeFunctionFailure, icanEraFallbackError, ICANERA_WALLET_URL, ICANERA_FALLBACK_HINT } from '../utils/functionErrors';

export { icanEraFallbackError, ICANERA_WALLET_URL, ICANERA_FALLBACK_HINT };

export const ICAN_TO_UGX = 5000;
export const SOURCE_APP = 'ican';

// Money that leaves the app (mobile money, bank): the error also says whether the server ANSWERED. An answer is a final
// refusal, so the IcanEra recommendation is added; no answer (connection lost, timeout) means the transfer may still have been
// carried out, and suggesting another send then could pay twice - so nothing is recommended. See utils/functionErrors.js.
async function sendOutError(error, fallback) {
  const failure = await describeFunctionFailure(error, fallback);
  const base = failure.answered ? icanEraFallbackError(failure.message) : new Error(failure.message);
  return Object.assign(base, { answered: failure.answered });
}
const answeredError = (message) => Object.assign(icanEraFallbackError(message), { answered: true });

const BUSINESS_PAYMENT_HINTS = /\b(store|shop|market|supermarket|restaurant|cafe|business|supplier|vendor|school|hospital|hotel|fuel station)\b/i;

function inferTransferContext(note, merchantName, counterpartyType, expenseClassification) {
  const text = String(note || '').trim();
  const inferredBusiness = !merchantName && BUSINESS_PAYMENT_HINTS.test(text);
  return {
    merchantName: merchantName || (inferredBusiness ? text : null),
    counterpartyType: counterpartyType || (inferredBusiness ? 'business' : 'person'),
    expenseClassification: expenseClassification || (inferredBusiness ? 'business_expense' : 'person_transfer'),
  };
}

// ─── Wallet ─────────────────────────────────────────────────────────────────

export async function getOrCreateWallet(userId) {
  const { data, error } = await supabase.rpc('get_or_create_ican_wallet', {
    p_user_id: userId,
  });
  if (error) throw error;
  return data;
}

/** Resolve the dedicated iCanEra business wallet used by a PitchIn profile. */
export async function getOrCreateBusinessWallet(businessProfileId) {
  const { data, error } = await supabase.rpc('get_or_create_pitchin_business_wallet', {
    p_business_profile_id: businessProfileId,
  });
  if (error) throw error;
  return data;
}

export async function registerBusinessWallet(businessProfileId) {
  const { data, error } = await supabase.rpc('register_pitchin_business_wallet', {
    p_business_profile_id: businessProfileId,
  });
  if (error) throw error;
  return data;
}

export async function getBusinessWalletTransactions(businessProfileId, limit = 100) {
  const { data, error } = await supabase.rpc('get_pitchin_business_wallet_transactions', {
    p_business_profile_id: businessProfileId,
    p_limit: limit,
  });
  if (error) throw error;
  return data ?? [];
}

export async function transferFromBusinessWallet({ businessProfileId, recipientUserId, recipientBusinessProfileId = null, amount, note = '', referenceId = null, pin }) {
  const rpcName = recipientBusinessProfileId
    ? 'pitchin_business_wallet_transfer_to_business'
    : 'pitchin_business_wallet_transfer';
  const rpcArgs = recipientBusinessProfileId
    ? {
        p_business_profile_id: businessProfileId,
        p_recipient_business_profile_id: recipientBusinessProfileId,
        p_amount_ican: amount,
        p_note: note,
        p_reference_id: referenceId,
        p_pin: pin,
      }
    : {
        p_business_profile_id: businessProfileId,
        p_recipient_user_id: recipientUserId,
        p_amount_ican: amount,
        p_note: note,
        p_reference_id: referenceId,
        p_pin: pin,
      };
  const { data, error } = await supabase.rpc(rpcName, rpcArgs);
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Business-wallet transfer failed');
  return data;
}

/**
 * Is the signed-in user an administrator of this business (owner, a qualifying
 * co-owner or a manager)? Only administrators can approve a business-wallet
 * payment. The database is the authority; if it can't be asked we fall back to
 * "is this the profile's owner", which is the common case and never over-grants
 * (the server re-checks every approval anyway).
 */
export async function isBusinessWalletAdmin(businessProfileId, { ownerUserId = null, currentUserId = null } = {}) {
  try {
    const { data, error } = await supabase.rpc('ican_business_admin', {
      p_business_profile_id: businessProfileId,
    });
    if (!error && typeof data === 'boolean') return data;
  } catch {
    // fall through to the owner check
  }
  return Boolean(ownerUserId && currentUserId && ownerUserId === currentUserId);
}

/**
 * Pay IcanEra coin OUT of a business wallet, to a person or to another
 * business. The database queues every business-wallet payment for
 * administrator approval with the business-wallet PIN. When the signed-in user
 * is that administrator we submit and approve in one step (one PIN), so an
 * owner pays straight away; anyone else — e.g. an assigned finance user —
 * just submits the request and the administrator approves it later.
 *
 * If the request was created but the approval step fails (wrong PIN, not
 * enough balance, …) the server leaves it pending or rejects it, depending on
 * why; either way the thrown error carries `requestId` so the caller can point
 * the person at the request instead of implying nothing happened.
 *
 * @returns {Promise<{status: 'completed'|'pending_approval', transactionId: string, message?: string}>}
 */
export async function sendFromBusinessWallet({
  businessProfileId, recipientUserId = null, recipientBusinessProfileId = null,
  amount, note = '', referenceId = null, pin, isAdmin = false,
}) {
  if (!recipientUserId && !recipientBusinessProfileId) throw new Error('Choose who to pay.');

  const request = await transferFromBusinessWallet({
    businessProfileId, recipientUserId, recipientBusinessProfileId,
    amount, note, referenceId, pin,
  });
  const transactionId = request.transaction_id;

  if (!isAdmin) {
    return {
      status: 'pending_approval',
      transactionId,
      message: request.message || 'Payment request submitted. The business administrator must approve it with the business-wallet PIN.',
    };
  }

  try {
    const approved = await approveBusinessWalletTransaction(transactionId, 'approved', pin);
    return { status: approved.status === 'completed' ? 'completed' : 'pending_approval', transactionId };
  } catch (error) {
    error.requestId = transactionId;
    throw error;
  }
}

export async function setBusinessWalletPin(businessProfileId, pin) {
  const { data, error } = await supabase.rpc('set_pitchin_business_wallet_pin', {
    p_business_profile_id: businessProfileId,
    p_pin: pin,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Could not set business-wallet PIN');
  return data;
}

export async function approveBusinessWalletTransaction(transactionId, decision = 'approved', pin = null) {
  const { data, error } = await supabase.rpc('approve_pitchin_business_wallet_transaction', {
    p_transaction_id: transactionId,
    p_decision: decision,
    p_pin: pin,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Business-wallet approval failed');
  return data;
}

export async function getBusinessWalletNotifications(unreadOnly = true) {
  const { data, error } = await supabase.rpc('get_ican_business_wallet_notifications', {
    p_unread_only: unreadOnly,
  });
  if (error) throw error;
  return data ?? [];
}

export async function markBusinessWalletNotificationRead(notificationId) {
  const { data, error } = await supabase.rpc('mark_ican_business_wallet_notification_read', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
  return Boolean(data);
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
  };
}

// ─── Transactions ───────────────────────────────────────────────────────────

export async function getTransactions(userId, limit = 50, scope = 'all') {
  // The database checks auth.uid() and business ownership/delegated access.
  // This also returns receipts in a managed business wallet, which deliberately
  // have no recipient_user_id and were missing from the old personal-only feed.
  // scope: 'all' | 'personal' (only the caller's own wallet activity) |
  // 'business' (only rows tied to a business wallet the caller manages).
  const { data, error } = await supabase.rpc('get_ican_record_every_transaction_feed', { p_scope: scope });
  if (error) throw error;
  return (data ?? []).slice(0, limit).map((tx) => ({
    ...tx,
    localAmount: Number(tx.local_amount ?? tx.ugx_floor_value ?? tx.ican_amount * ICAN_TO_UGX),
    localCurrency: tx.local_currency || 'UGX',
    direction: tx.recipient_user_id === userId ? 'in' : 'out',
  }));
}

// ─── Transfer ───────────────────────────────────────────────────────────────

export async function sendICAN({
  fromUserId, toUserId, amount, note = '', referenceId = null,
  localAmount = null, localCurrency = 'UGX', merchantName = null,
  counterpartyType = null, expenseClassification = null,
  businessProfileId = null,
}) {
  const context = inferTransferContext(note, merchantName, counterpartyType, expenseClassification);
  const { data, error } = await supabase.rpc('transfer_ican', {
    p_from_user: fromUserId,
    p_to_user: toUserId,
    p_amount: amount,
    p_note: note,
    p_source_app: SOURCE_APP,
    p_reference_id: referenceId,
    p_local_amount: localAmount,
    p_local_currency: localCurrency,
    p_merchant_name: context.merchantName,
    p_counterparty_type: context.counterpartyType,
    p_expense_classification: context.expenseClassification,
    p_business_profile_id: businessProfileId,
  });
  if (error) throw error;
  if (!data.success) throw new Error(data.error);
  return data;
}

export async function sendICANToBusiness({
  fromUserId, businessProfileId, amount, note = '', referenceId = null,
  sourceApp = SOURCE_APP, pinAttempt = null,
}) {
  const { data, error } = await supabase.rpc('transfer_ican_to_business', {
    p_from_user: fromUserId,
    p_business_profile_id: businessProfileId,
    p_amount: amount,
    p_note: note,
    p_source_app: sourceApp,
    p_reference_id: referenceId,
    p_pin_attempt: pinAttempt,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Business-wallet transfer failed');
  return data;
}

export async function sendAgentFiatToBusiness({
  agentId, businessProfileId, amountLocal, currency = 'UGX', pinAttempt,
  walletAddress, note = '',
}) {
  const { data, error } = await supabase.rpc('transfer_agent_fiat_to_business', {
    p_agent_id: agentId,
    p_business_profile_id: businessProfileId,
    p_amount_local: amountLocal,
    p_currency: currency,
    p_pin_attempt: pinAttempt,
    p_wallet_address: walletAddress,
    p_note: note,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Business-wallet transfer failed');
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

// ─── Convert between the wallet's money and IcanEra coin ────────────────────

/**
 * The live coin price in the caller's OWN currency, and the money they hold in
 * it (get_my_ican_trading_info). Every conversion below is priced from this.
 * @returns {Promise<{currency: string, price: number, walletBalance: number}>}
 */
export async function getTradingInfo() {
  const { data, error } = await supabase.rpc('get_my_ican_trading_info');
  const price = Number(data?.price_per_ican);
  if (error || !data?.currency || !(price > 0)) {
    throw new Error('The live coin price is unavailable right now. Please try again in a moment.');
  }
  return { currency: String(data.currency).toUpperCase(), price, walletBalance: Number(data.wallet_balance) || 0 };
}

/** Live UGX price of one coin — what a cash-out (flutterwave-payout) pays at. Falls back to the 5,000 floor. */
export async function getLiveUgxPrice() {
  try {
    const { data, error } = await supabase.rpc('ican_live_ugx_price');
    const price = Number(data);
    if (!error && price > 0) return price;
  } catch {
    // fall through to the floor
  }
  return ICAN_TO_UGX;
}

/**
 * Money → coin: takes the money for `icanAmount` coins out of the caller's wallet at
 * the live price (no fee) and credits the coins to their IcanEra balance, in one
 * database transaction.
 */
export async function buyCoinsFromWallet({ userId, icanAmount, sourceApp = SOURCE_APP, reference = null }) {
  const { data, error } = await supabase.rpc('buy_ican_coins_from_wallet', {
    p_user_id: userId,
    p_ican_amount: icanAmount,
    p_source_app: sourceApp,
    p_reference: reference,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Could not convert money to IcanEra');
  return data;
}

/**
 * Coin → money: sells `icanAmount` coins at the live price (3% fee) and credits the
 * proceeds to the caller's wallet in their own currency. Returns { payout, gross,
 * currency, price_per_ican, … }.
 */
export async function sellCoinsToWallet({ userId, icanAmount, sourceApp = SOURCE_APP, reference = null }) {
  const { data, error } = await supabase.rpc('sell_ican_coins_to_wallet', {
    p_user_id: userId,
    p_ican_amount: icanAmount,
    p_source_app: sourceApp,
    p_reference: reference,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Could not convert IcanEra to money');
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
  if (error) throw await sendOutError(error, 'Payout failed');
  if (!data?.success) throw answeredError(data?.error ?? 'Payout failed');
  return data;
}

// ─── Send Out — fiat send to another person's mobile money ────────────────

/**
 * Send money from the caller's IcanEra fiat wallet balance (wallet_accounts —
 * distinct from the ICAN coin balance) directly to someone else's mobile
 * money account, via the Flutterwave Transfers API. Debits the wallet
 * atomically server-side; the transfer itself settles asynchronously and is
 * refunded automatically if Flutterwave rejects or fails it (see
 * ICAN_FIAT_MOBILE_MONEY_SEND_MIGRATION.sql). Flutterwave has no
 * pre-transfer name-verification for Uganda mobile money, so the caller
 * should have the sender explicitly confirm the phone number + network
 * before calling this — Flutterwave's own accept/reject plus the
 * webhook-confirmed final outcome is the real verification available.
 */
export async function sendFiatToMobileMoney({
  amount,
  currency = 'UGX',
  recipientPhone,
  network, // 'MTN' | 'AIRTEL'
  note = '',
  purpose = 'send', // 'withdraw' = cashing out to the sender's own number, which a plain send refuses
}) {
  const { data, error } = await supabase.functions.invoke('flutterwave-momo-send', {
    body: {
      amount,
      currency,
      recipient_phone: recipientPhone,
      recipient_network: network,
      note,
      purpose,
    },
  });
  if (error) throw await sendOutError(error, 'Transfer failed');
  if (!data?.success) throw answeredError(data?.error ?? 'Transfer failed');
  return data;
}

/**
 * Send money from the caller's IcanEra fiat wallet to a BANK account via the
 * same flutterwave-momo-send function (channel: 'bank'). Debited atomically
 * server-side and refunded automatically if Flutterwave rejects or fails it.
 * Flutterwave cannot verify a Ugandan bank account name in advance, so the
 * caller must have the sender double-check the number and name.
 */
export async function sendFiatToBank({
  amount,
  currency = 'UGX',
  accountNumber,
  bankCode,
  beneficiaryName,
  note = '',
}) {
  const { data, error } = await supabase.functions.invoke('flutterwave-momo-send', {
    body: {
      channel: 'bank',
      amount,
      currency,
      account_number: accountNumber,
      bank_code: bankCode,
      beneficiary_name: beneficiaryName,
      note,
    },
  });
  if (error) throw await sendOutError(error, 'Transfer failed');
  if (!data?.success) throw answeredError(data?.error ?? 'Transfer failed');
  return data;
}

// Uganda mobile number prefixes, so the sender doesn't have to manually pick
// MTN vs Airtel every time (mirrors what Flutterwave itself uses to route
// mobilemoneyuganda transfers) — see
// https://en.wikipedia.org/wiki/Telephone_numbers_in_Uganda. Deliberately
// narrow: an unrecognized prefix (071/072/073/other) returns null rather
// than guessing, since a wrong network just fails the transfer at
// Flutterwave (refunded automatically) rather than silently misrouting it,
// but there's no reason to guess when we can just ask.
const UGANDA_NETWORK_PREFIXES = {
  MTN: ['77', '78', '76', '39'],
  AIRTEL: ['70', '74', '75', '20'],
};

export function detectUgandaMobileNetwork(phoneNumber) {
  const digits = String(phoneNumber || '').replace(/[^\d]/g, '');
  let national;
  if (digits.startsWith('256')) national = digits.slice(3);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;

  const prefix = national.slice(0, 2);
  for (const [network, prefixes] of Object.entries(UGANDA_NETWORK_PREFIXES)) {
    if (prefixes.includes(prefix)) return network;
  }
  return null;
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
  getOrCreateBusinessWallet,
  registerBusinessWallet,
  getBusinessWalletTransactions,
  getBusinessWalletNotifications,
  markBusinessWalletNotificationRead,
  transferFromBusinessWallet,
  sendFromBusinessWallet,
  isBusinessWalletAdmin,
  approveBusinessWalletTransaction,
  setBusinessWalletPin,
  getWallet,
  getBalance,
  getTradingInfo,
  getLiveUgxPrice,
  buyCoinsFromWallet,
  sellCoinsToWallet,
  getTransactions,
  sendICAN,
  buyICAN,
  sellICAN,
  requestIcanPayout,
  sendFiatToMobileMoney,
  sendFiatToBank,
  detectUgandaMobileNetwork,
  icanEraFallbackError,
  ugxToICAN,
  icanToUGX,
  formatICAN,
  ICAN_TO_UGX,
  SOURCE_APP,
};
