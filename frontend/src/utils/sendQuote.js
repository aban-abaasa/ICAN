/**
 * The plain-words line(s) shown under the Send amount while someone types: what will
 * be converted, at what price, and whether it can be paid — computed from the same
 * planners the send itself uses, so the quote and the result never disagree.
 * Pure; no network (tests/sendQuote.test.js).
 */

import {
  COIN_PAYOUT_FEE_RATE,
  coinsForCurrency,
  coinsToSellFor,
  currencyForCoins,
  planCoinPayment,
  planCurrencyPayment,
  simulateSell,
} from './walletRouting.js';

const money = (currency, n) => `${currency} ${Math.round(Number(n) || 0).toLocaleString()}`;
const coin = (n) => Number(n).toFixed(4);

/**
 * @param {object} p
 * @param {'coin'|'money'} p.tile what the recipient receives: coin (IcanEra Coin) or normal currency (IcanEra Account)
 * @param {'coin'|'currency'} p.unit what the amount is typed in (only meaningful for the coin tile)
 * @param {string|number} p.amount
 * @param {number} p.price live price of one coin in `currency`
 * @param {string} p.currency
 * @param {number} p.coinBalance the person's own coin balance
 * @param {number} p.walletBalance the money in their wallet
 * @param {{name: string, coins: number}|null} [p.business] set when a business wallet is paying
 * @returns {{lines: Array<{text: string, tone: 'info'|'warn'|'error'}>, ok: boolean}}
 */
export function describeSendQuote({ tile, unit = 'coin', amount, price, currency, coinBalance = 0, walletBalance = 0, business = null }) {
  const a = parseFloat(amount);
  const lines = [];
  const add = (text, tone = 'info') => lines.push({ text, tone });
  if (!(a > 0)) return { lines, ok: true };
  if (!(Number(price) > 0)) {
    add('The live coin price is not available right now, so conversions are paused.', 'warn');
    return { lines, ok: true };
  }
  const feePct = `${COIN_PAYOUT_FEE_RATE * 100}%`;

  if (tile === 'coin') {
    const typedMoney = unit === 'currency';
    const coins = typedMoney ? coinsForCurrency(a, price) : a;
    if (typedMoney) add(`≈ ${coin(coins)} IcanEra at ${money(currency, price)} per coin — the recipient receives IcanEra.`);
    else add(`≈ ${money(currency, currencyForCoins(a, price))} at ${money(currency, price)} per coin.`);

    if (business) {
      if (coins > business.coins + 1e-9) {
        add(`${business.name} has only ${coin(business.coins)} IcanEra.`, 'error');
        return { lines, ok: false };
      }
      return { lines, ok: true };
    }
    if (typedMoney) {
      const plan = planCoinPayment({ coinsNeeded: coins, walletBalance, price, mode: 'currency_only', currency });
      if (!plan.ok) { add(plan.error, 'error'); return { lines, ok: false }; }
      add(`Paid from your wallet (${money(currency, walletBalance)} available) — no fee.`);
    } else if (coins > coinBalance + 1e-9) {
      const plan = planCoinPayment({ coinsNeeded: coins, coinBalance, walletBalance, price, mode: 'coins_first', currency });
      if (!plan.ok) { add(plan.error, 'error'); return { lines, ok: false }; }
      add(`You have ${coin(coinBalance)} IcanEra — the other ${coin(plan.buyCoins)} is converted from your wallet (${money(currency, plan.cost)}, no fee).`, 'warn');
    }
    return { lines, ok: true };
  }

  // The recipient receives normal currency.
  if (business) {
    const sell = coinsToSellFor(a, price);
    const fee = simulateSell(sell, price).fee;
    if (sell > business.coins + 1e-9) {
      add(`${business.name} has ${coin(business.coins)} IcanEra — paying ${money(currency, a)} needs ${coin(sell)} (it includes the ${feePct} conversion fee).`, 'error');
      return { lines, ok: false };
    }
    add(`${business.name} pays in IcanEra: ${coin(sell)} IcanEra, converted to ${money(currency, a)} (${feePct} fee: ${money(currency, fee)}). The recipient receives normal currency.`, 'warn');
    return { lines, ok: true };
  }
  if (a <= walletBalance + 1e-9) return { lines, ok: true };
  const plan = planCurrencyPayment({ amount: a, walletBalance, coinBalance, price, currency });
  if (!plan.ok) { add(plan.error, 'error'); return { lines, ok: false }; }
  add(`Your wallet has ${money(currency, walletBalance)} — ${coin(plan.sellCoins)} IcanEra is converted for the rest (${feePct} fee: ${money(currency, plan.fee)}).`, 'warn');
  return { lines, ok: true };
}
