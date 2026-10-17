/**
 * Paying a person's normal-currency account (a 1…/2… account number, phone or
 * email) when the money has to come from IcanEra coin:
 *
 *   personal wallet short of money   sell just enough of your coin → pay
 *   business wallet (coin only)      move coin to the administrator's wallet →
 *                                    sell it → pay   (administrator only)
 *
 * The recipient always receives money. Each step uses an existing server
 * function (a business-wallet payment, sell_ican_coins_to_wallet at the live
 * price with its flat 3% fee, the wallet's own send) — nothing here invents a
 * new way to move money, it just chains them with one confirmation and tells you
 * exactly where the money is if a later step fails.
 *
 * Like coinSendFlow.js it has no React or Supabase import: every dependency is
 * passed in so it can be unit tested (tests/currencyPayFlow.test.js).
 *
 * Both PINs (when a business pays) are collected and checked BEFORE anything
 * moves, so cancelling a prompt never leaves money half-way.
 */

import { coinsToSellFor, conversionMargin, formatMoney, planCurrencyPayment, simulateSell, COIN_PAYOUT_FEE_RATE } from '../utils/walletRouting.js';
import { resolveRecipientWallet } from './coinSendFlow.js';

const fmt4 = (n) => Number(n).toFixed(4);

/**
 * Plan a currency payment without moving anything, for the Send sheet's live
 * quote and for deciding whether the normal send (no conversion) can be used.
 * @returns {Promise<{ok: true, convert: false} | {ok: true, convert: true, sellCoins: number, proceeds: number, fee: number, currency: string, price: number} | {ok: false, error: string}>}
 */
export async function planPersonalCurrencyPayment({ amount, getTradingInfo, getPersonalBalance }) {
  let trading;
  try { trading = await getTradingInfo(); } catch (error) { return { ok: false, error: error.message }; }
  let coinBalance = 0;
  try { coinBalance = Number(await getPersonalBalance()) || 0; } catch { /* treat as none */ }
  const plan = planCurrencyPayment({ amount, walletBalance: trading.walletBalance, coinBalance, price: trading.price, currency: trading.currency });
  return plan.ok ? { ...plan, currency: trading.currency, price: trading.price } : plan;
}

/**
 * @param {object} p
 * @param {object} p.supabase
 * @param {string} p.currentUserId
 * @param {object|null} p.sendFromBusiness business profile (with .ican_wallet) paying, or null for the personal wallet
 * @param {boolean|null} p.sendFromIsAdmin
 * @param {string} p.recipientIdentifier
 * @param {string|number} p.amount normal currency, in the person's own currency
 * @param {string} [p.description]
 * @param {string|null} [p.countryCallingCode]
 * @param {Function} p.askPin
 * @param {(message: string) => boolean} p.confirm
 * @param {Function} p.verifyUserPIN
 * @param {Function} p.verifyBusinessWalletPin
 * @param {() => Promise<{currency: string, price: number, walletBalance: number}>} p.getTradingInfo
 * @param {() => Promise<number>} p.getPersonalBalance personal coin balance
 * @param {{sendFromBusinessWallet: Function, isBusinessWalletAdmin: Function, sellCoinsToWallet: Function, sendFiat: Function}} p.api
 * @returns {Promise<{direct: true} | {cancelled: true} | {success: false, message: string, touched?: boolean} | {success: true, message: string, touchesBusiness: boolean, touched: true}>}
 *   `{direct: true}` means no conversion is needed (the wallet already has the money) — the caller uses its normal send.
 */
export async function runCurrencySend({
  supabase, currentUserId, sendFromBusiness = null, sendFromIsAdmin = null,
  recipientIdentifier, amount, description = '', countryCallingCode = null,
  askPin, confirm, verifyUserPIN, verifyBusinessWalletPin, getTradingInfo, getPersonalBalance, api,
}) {
  const fail = (message, touched = false) => ({ success: false, message, touched });

  const amountNum = parseFloat(amount);
  if (!(amountNum > 0)) return fail('Enter a valid amount');

  const recipient = await resolveRecipientWallet(supabase, recipientIdentifier, { countryCallingCode });
  if (recipient.error) return fail(recipient.error);
  if (!recipient.userId) {
    return fail('A business wallet number receives IcanEra coin, not money. Choose IcanEra Coin to send to it.');
  }
  const toSelf = recipient.userId === currentUserId;
  if (toSelf && !sendFromBusiness) return fail('Cannot send money to yourself');

  let trading;
  try { trading = await getTradingInfo(); } catch (error) { return fail(error.message); }
  const { currency, price } = trading;
  const money = (n) => formatMoney(currency, n);

  const senderName = sendFromBusiness ? sendFromBusiness.business_name : 'your personal wallet';
  const recipientName = recipient.name || recipient.identifier;
  const recipientLabel = toSelf ? 'your own wallet' : `${recipientName} (${recipient.accountType} account)`;

  // ── plan ────────────────────────────────────────────────────────────────
  let sellCoins;
  if (sendFromBusiness) {
    const isAdmin = sendFromIsAdmin ?? await api.isBusinessWalletAdmin(sendFromBusiness.id, {
      ownerUserId: sendFromBusiness.user_id, currentUserId,
    });
    if (!isAdmin) {
      return fail("Only the business administrator can pay money from a business wallet. Send IcanEra coin instead, or ask the administrator.");
    }
    sellCoins = coinsToSellFor(amountNum, price, COIN_PAYOUT_FEE_RATE, conversionMargin(currency));
    const available = Number(sendFromBusiness.ican_wallet?.ican_balance || 0);
    if (sellCoins > available) {
      return fail(`${senderName} has ${fmt4(available)} IcanEra — paying ${money(amountNum)} needs ${fmt4(sellCoins)} (it includes the ${COIN_PAYOUT_FEE_RATE * 100}% conversion fee).`);
    }
  } else {
    let coinBalance = 0;
    try { coinBalance = Number(await getPersonalBalance()) || 0; } catch { /* treat as none */ }
    const plan = planCurrencyPayment({ amount: amountNum, walletBalance: trading.walletBalance, coinBalance, price, currency });
    if (!plan.ok) return fail(plan.error);
    if (!plan.convert) return { direct: true };
    sellCoins = plan.sellCoins;
  }
  const sale = simulateSell(sellCoins, price);

  // ── confirm ─────────────────────────────────────────────────────────────
  const how = sendFromBusiness
    ? `${senderName} pays in IcanEra: ${fmt4(sellCoins)} IcanEra is moved into your wallet and converted to ${money(sale.net)} at ${money(price)} per coin (${COIN_PAYOUT_FEE_RATE * 100}% fee: ${money(sale.fee)})${toSelf ? '.' : `, then ${money(amountNum)} is paid.`}`
    : `Your wallet is short, so ${fmt4(sellCoins)} IcanEra is converted to ${money(sale.net)} at ${money(price)} per coin (${COIN_PAYOUT_FEE_RATE * 100}% fee: ${money(sale.fee)}), then ${money(amountNum)} is paid.`;
  const confirmed = confirm(
    `${toSelf ? `Move ${money(amountNum)} from ${senderName} into your wallet` : `Pay ${money(amountNum)} from ${senderName} to ${recipientLabel}`}?\n\n${how}\n\n` +
    `${toSelf ? '' : 'The recipient receives normal currency.'}`.trim(),
  );
  if (!confirmed) return { cancelled: true };

  // ── authorise everything up front ───────────────────────────────────────
  let businessPin = null;
  if (sendFromBusiness) {
    businessPin = await askPin({
      title: 'Business wallet PIN',
      message: `Enter the business-wallet PIN to take ${fmt4(sellCoins)} IcanEra out of ${senderName}.`,
    });
    if (businessPin === null) return { cancelled: true };
    const check = await verifyBusinessWalletPin(sendFromBusiness.id, businessPin);
    if (!check?.success) return fail(check?.error || 'Incorrect business-wallet PIN. Nothing was moved.');
  }
  const pin = await askPin({
    title: 'Confirm payment',
    message: toSelf
      ? `Enter your transaction PIN to convert ${fmt4(sellCoins)} IcanEra into ${money(sale.net)}.`
      : `Enter your transaction PIN to pay ${money(amountNum)} to ${recipientName}.`,
  });
  if (pin === null) return { cancelled: true };
  const pinCheck = await verifyUserPIN(currentUserId, pin);
  if (!pinCheck?.success) return fail(pinCheck?.error || 'Incorrect transaction PIN. Nothing was moved.');
  // The wallet's send takes a 4-digit PIN. Find that out now, not after the coin is sold.
  if (!toSelf && pin.length !== 4) return fail('Sending money needs a 4-digit PIN. Nothing was moved.');

  // ── move the money, one step at a time ──────────────────────────────────
  const note = description || `Payment to ${recipientName}`;

  if (sendFromBusiness) {
    let moved;
    try {
      moved = await api.sendFromBusinessWallet({
        businessProfileId: sendFromBusiness.id, recipientUserId: currentUserId,
        amount: sellCoins, note: `Paying ${recipientName}`, pin: businessPin, isAdmin: true,
      });
    } catch (error) {
      return fail(`${error.message || 'The business payment failed'}. Nothing was converted or paid.`, Boolean(error.requestId));
    }
    if (moved.status !== 'completed') {
      return fail('The business payment is waiting for approval, so nothing was converted or paid yet.', true);
    }
  }

  let sold;
  try {
    sold = await api.sellCoinsToWallet({ userId: currentUserId, icanAmount: sellCoins });
  } catch (error) {
    return fail(
      sendFromBusiness
        ? `${fmt4(sellCoins)} IcanEra left ${senderName} for your wallet, but converting it to money failed: ${error.message}. The coin is safe in your IcanEra balance — you can convert or send it from there.`
        : `Converting IcanEra to money failed: ${error.message}. Nothing was paid.`,
      Boolean(sendFromBusiness),
    );
  }

  if (toSelf) {
    return {
      success: true, touched: true, touchesBusiness: true,
      message: `✅ ${fmt4(sellCoins)} IcanEra from ${senderName} is now ${money(sold.payout ?? sale.net)} in your wallet (${COIN_PAYOUT_FEE_RATE * 100}% conversion fee).`,
    };
  }

  // The wallet must really hold the money before the send — never trust the plan alone.
  let walletNow = Number(sold.wallet_balance);
  if (!Number.isFinite(walletNow)) {
    try { walletNow = (await getTradingInfo()).walletBalance; } catch { walletNow = NaN; }
  }
  if (Number.isFinite(walletNow) && walletNow + 1e-9 < amountNum) {
    return fail(
      `The conversion paid ${money(sold.payout ?? sale.net)}, so your wallet has ${money(walletNow)} — not enough for ${money(amountNum)}. Nothing was paid; the money is in your wallet.`,
      true,
    );
  }

  let sent;
  try {
    sent = await api.sendFiat({ userId: currentUserId, recipientId: recipient.userId, currency, amount: amountNum, pin, description: note });
  } catch (error) {
    sent = { success: false, message: error.message };
  }
  if (!sent?.success) {
    return fail(
      `${fmt4(sellCoins)} IcanEra was converted to ${money(sold.payout ?? sale.net)}, but paying ${recipientName} failed: ${sent?.message || 'unknown error'}. The money is safe in your wallet — you can send it again from there.`,
      true,
    );
  }

  return {
    success: true, touched: true, touchesBusiness: Boolean(sendFromBusiness),
    message: `✅ Paid ${money(amountNum)} to ${recipientName}. Converted ${fmt4(sellCoins)} IcanEra from ${senderName} (${COIN_PAYOUT_FEE_RATE * 100}% fee: ${money(sale.fee)}); they receive normal currency.`,
  };
}
