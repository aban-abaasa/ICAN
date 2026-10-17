import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRecipient,
  phoneLookupVariants,
  pickRecipientAccount,
  planCoinTransfer,
  quoteWithdrawal,
  planWithdrawalSource,
  maskDestination,
  rememberDestination,
} from '../src/utils/walletRouting.js';

test('classifyRecipient reads the 16-digit leading digit: 3 = business coin wallet, 2 = business account, 1 = personal', () => {
  assert.deepEqual(classifyRecipient('3002345678901234'), { kind: 'business_wallet', value: '3002345678901234' });
  assert.deepEqual(classifyRecipient('2002345678901234'), { kind: 'account', value: '2002345678901234', accountType: 'business' });
  assert.deepEqual(classifyRecipient('1002345678901234'), { kind: 'account', value: '1002345678901234', accountType: 'personal' });
});

test('classifyRecipient ignores spaces and dashes in a pasted account number', () => {
  assert.equal(classifyRecipient('3002 3456 7890 1234').kind, 'business_wallet');
  assert.equal(classifyRecipient('1002-3456-7890-1234').value, '1002345678901234');
});

test('classifyRecipient tells email, phone and empty apart, and lowercases email', () => {
  assert.deepEqual(classifyRecipient('  Ann@Example.COM '), { kind: 'email', value: 'ann@example.com' });
  assert.equal(classifyRecipient('+256701234567').kind, 'phone');
  assert.equal(classifyRecipient('0701234567').kind, 'phone');
  assert.equal(classifyRecipient('   ').kind, 'empty');
  assert.equal(classifyRecipient(null).kind, 'empty');
});

test('a 15- or 17-digit number is a phone-ish string, never mistaken for an account', () => {
  assert.equal(classifyRecipient('300234567890123').kind, 'phone');
  assert.equal(classifyRecipient('30023456789012345').kind, 'phone');
});

test('phoneLookupVariants covers every stored form of a Ugandan number when told the country', () => {
  const want = ['0701234567', '701234567', '256701234567', '+256701234567'];
  for (const input of ['0701234567', '+256 701 234 567', '256701234567', '701234567']) {
    const got = phoneLookupVariants(input, { countryCallingCode: '256' });
    for (const w of want) assert.ok(got.includes(w), `${input} should also try ${w}`);
  }
});

test('phoneLookupVariants never guesses a country when none is given', () => {
  const got = phoneLookupVariants('0712345678');
  assert.ok(!got.some((v) => v.includes('256')));
  assert.ok(got.includes('0712345678'));
});

test('phoneLookupVariants returns nothing for junk', () => {
  assert.deepEqual(phoneLookupVariants(''), []);
  assert.deepEqual(phoneLookupVariants('abc'), []);
});

test('pickRecipientAccount resolves a phone shared by a personal and a business account', () => {
  const personal = { user_id: 'u1', account_type: 'personal', account_holder_name: 'Ann' };
  const business = { user_id: 'u1', account_type: 'business', business_id: 'b1', account_holder_name: 'Ann Ltd' };

  const byDefault = pickRecipientAccount([business, personal]);
  assert.equal(byDefault.account, personal);
  assert.equal(byDefault.accountType, 'personal');
  assert.deepEqual(byDefault.alternatives, [business]);

  assert.equal(pickRecipientAccount([personal, business], { prefer: 'business' }).account, business);
});

test('pickRecipientAccount falls back to whatever exists, and handles no match', () => {
  const only = { user_id: 'u2', account_type: 'business', business_id: 'b2' };
  assert.equal(pickRecipientAccount([only]).account, only);
  assert.equal(pickRecipientAccount([only], { prefer: 'personal' }).accountType, 'business');
  assert.equal(pickRecipientAccount([]).account, null);
  assert.equal(pickRecipientAccount(null).account, null);
});

test('planCoinTransfer covers all four personal/business directions', () => {
  const me = { type: 'personal', userId: 'me' };
  const other = { type: 'personal', userId: 'them' };
  const myBiz = { type: 'business', businessProfileId: 'b1' };
  const otherBiz = { type: 'business', businessProfileId: 'b2' };

  assert.equal(planCoinTransfer({ from: me, to: other }).route, 'user_to_user');
  assert.equal(planCoinTransfer({ from: me, to: otherBiz }).route, 'user_to_business');
  assert.equal(planCoinTransfer({ from: myBiz, to: other }).route, 'business_to_user');
  assert.equal(planCoinTransfer({ from: myBiz, to: otherBiz }).route, 'business_to_business');
});

test('planCoinTransfer lets an owner move money between themself and their business, but not to the same wallet', () => {
  const me = { type: 'personal', userId: 'me' };
  const myBiz = { type: 'business', businessProfileId: 'b1' };

  assert.equal(planCoinTransfer({ from: myBiz, to: me }).route, 'business_to_user'); // take money out
  assert.equal(planCoinTransfer({ from: me, to: myBiz }).route, 'user_to_business'); // fund the business

  const self = planCoinTransfer({ from: me, to: { type: 'personal', userId: 'me' } });
  assert.equal(self.route, null);
  assert.match(self.error, /yourself/);

  const sameBiz = planCoinTransfer({ from: myBiz, to: { type: 'business', businessProfileId: 'b1' } });
  assert.equal(sameBiz.route, null);
  assert.match(sameBiz.error, /own wallet/);
});

test('planCoinTransfer refuses incomplete input', () => {
  assert.equal(planCoinTransfer({ from: null, to: { type: 'personal', userId: 'x' } }).route, null);
});

test('quoteWithdrawal: wallet balance pays out in full, coin payout takes the flat 3%', () => {
  assert.deepEqual(quoteWithdrawal({ amountUgx: 50000, source: 'fiat', rate: 5000 }), { icanDebit: 0, gross: 50000, fee: 0, net: 50000 });
  assert.deepEqual(quoteWithdrawal({ amountUgx: 50000, source: 'coin', rate: 5000 }), { icanDebit: 10, gross: 50000, fee: 1500, net: 48500 });
});

test('quoteWithdrawal: coin payout rounds like the server (coins to 8dp, money to 2dp)', () => {
  const q = quoteWithdrawal({ amountUgx: 12345, source: 'coin', rate: 5000 });
  assert.equal(q.icanDebit, 2.469);
  assert.equal(q.gross, 12345);
  assert.equal(q.fee, 370.35);
  assert.equal(q.net, 11974.65);
});

test('quoteWithdrawal returns zeros for a non-positive amount', () => {
  assert.deepEqual(quoteWithdrawal({ amountUgx: 0, source: 'coin', rate: 5000 }), { icanDebit: 0, gross: 0, fee: 0, net: 0 });
  assert.deepEqual(quoteWithdrawal({ amountUgx: -5, source: 'fiat', rate: 5000 }), { icanDebit: 0, gross: 0, fee: 0, net: 0 });
});

test('planWithdrawalSource prefers the fee-free wallet balance, then coin, and never splits', () => {
  assert.equal(planWithdrawalSource({ amountUgx: 20000, fiatUgx: 30000, coinIcan: 100, rate: 5000 }).source, 'fiat');
  assert.equal(planWithdrawalSource({ amountUgx: 40000, fiatUgx: 30000, coinIcan: 10, rate: 5000 }).source, 'coin');

  const split = planWithdrawalSource({ amountUgx: 60000, fiatUgx: 30000, coinIcan: 6, rate: 5000 });
  assert.equal(split.source, null);
  assert.equal(split.shortfall, 30000); // biggest single balance is 30,000
  assert.match(split.reason, /split/);
});

test('planWithdrawalSource explains an empty wallet and a missing amount', () => {
  assert.match(planWithdrawalSource({ amountUgx: 1000, fiatUgx: 0, coinIcan: 0, rate: 5000 }).reason, /No balance/);
  assert.equal(planWithdrawalSource({ amountUgx: 0, fiatUgx: 10, coinIcan: 0, rate: 5000 }).reason, 'Enter an amount');
  assert.equal(planWithdrawalSource({ amountUgx: 1, fiatUgx: 10, coinIcan: 1, rate: 5000 }).maxUgx, 5000);
});

test('maskDestination keeps just enough to recognise a number', () => {
  assert.equal(maskDestination('256701234567'), '2567••••567');
  assert.equal(maskDestination('1234'), '1234');
});

test('rememberDestination keeps newest first, drops duplicates, and caps the list', () => {
  let list = [];
  list = rememberDestination(list, { channel: 'mobile', account: '256701234567' });
  list = rememberDestination(list, { channel: 'bank', account: '0012345678', bankCode: '044' });
  list = rememberDestination(list, { channel: 'mobile', account: '256 701 234 567' }); // same number again
  assert.equal(list.length, 2);
  assert.equal(list[0].channel, 'mobile');

  for (let i = 0; i < 10; i += 1) list = rememberDestination(list, { channel: 'mobile', account: `25670000000${i}` });
  assert.equal(list.length, 5);
  assert.equal(rememberDestination(list, { channel: 'mobile', account: '' }), list);
});

// ─── currency ⇄ coin conversion ────────────────────────────────────────────

import { coinsForCurrency, currencyForCoins, planCoinPayment, simulateSell, coinsToSellFor, planCurrencyPayment } from '../src/utils/walletRouting.js';

test('coinsForCurrency floors so the cost never exceeds what was typed; currencyForCoins is the 2dp value', () => {
  assert.equal(coinsForCurrency(20000, 5000), 4);
  assert.equal(coinsForCurrency(12345, 5000), 2.469);
  assert.ok(currencyForCoins(coinsForCurrency(20001, 5300), 5300) <= 20001);
  assert.equal(currencyForCoins(2.469, 5000), 12345);
  assert.equal(coinsForCurrency(0, 5000), 0);
  assert.equal(coinsForCurrency(100, 0), 0);
  assert.equal(currencyForCoins(-1, 5000), 0);
});

test('planCoinPayment (typed in coins): coins on hand first, only the shortfall is bought from the wallet', () => {
  const p = planCoinPayment({ coinsNeeded: 4, coinBalance: 1.5, walletBalance: 20000, price: 5000 });
  assert.deepEqual(p, { ok: true, fromCoins: 1.5, buyCoins: 2.5, cost: 12500, convert: true });
  const enough = planCoinPayment({ coinsNeeded: 1, coinBalance: 3.5, walletBalance: 0, price: 5000 });
  assert.deepEqual(enough, { ok: true, fromCoins: 1, buyCoins: 0, cost: 0, convert: false });
});

test('planCoinPayment (typed in money): buys the coins from the wallet and leaves the coin balance alone', () => {
  const p = planCoinPayment({ coinsNeeded: 4, coinBalance: 10, walletBalance: 25000, price: 5000, mode: 'currency_only' });
  assert.deepEqual(p, { ok: true, fromCoins: 0, buyCoins: 4, cost: 20000, convert: true });
});

test('planCoinPayment explains a shortfall that the wallet cannot cover, and a missing price', () => {
  const none = planCoinPayment({ coinsNeeded: 4, coinBalance: 0, walletBalance: 5000, price: 5000 });
  assert.equal(none.ok, false);
  assert.match(none.error, /Not enough money in your wallet/);
  const partial = planCoinPayment({ coinsNeeded: 4, coinBalance: 1, walletBalance: 5000, price: 5000 });
  assert.match(partial.error, /You have 1\.0000 IcanEra/);
  assert.match(planCoinPayment({ coinsNeeded: 1, price: 0 }).error, /live coin price/);
  assert.equal(planCoinPayment({ coinsNeeded: 0, price: 5000 }).error, 'Enter an amount');
});

test('simulateSell mirrors the server: gross and 3% fee each to 2dp', () => {
  assert.deepEqual(simulateSell(10, 5000), { gross: 50000, fee: 1500, net: 48500 });
  assert.deepEqual(simulateSell(2.469, 5000), { gross: 12345, fee: 370.35, net: 11974.65 });
});

test('coinsToSellFor sells just enough to net the wanted amount after the fee, never short', () => {
  for (const [needed, price] of [[48500, 5000], [10000, 5000], [12345.67, 5321.4], [1, 5000], [250000, 6123.55]]) {
    const coins = coinsToSellFor(needed, price);
    assert.ok(simulateSell(coins, price).net >= needed, `${needed} @ ${price}`);
    assert.ok(simulateSell(coins - 0.0001, price).net < needed + 1, 'and not wildly more than needed');
  }
  assert.equal(coinsToSellFor(48500, 5000), 10);
  assert.equal(coinsToSellFor(0, 5000), 0);
});

test('planCurrencyPayment: wallet money first, then just enough coin for the shortfall', () => {
  assert.deepEqual(planCurrencyPayment({ amount: 20000, walletBalance: 30000, coinBalance: 5, price: 5000 }), { ok: true, convert: false });
  const p = planCurrencyPayment({ amount: 50000, walletBalance: 1500, coinBalance: 12, price: 5000 });
  assert.equal(p.ok, true);
  assert.equal(p.convert, true);
  assert.equal(p.shortfall, 48500);
  assert.equal(p.sellCoins, 10);
  assert.equal(p.proceeds, 48500);
  assert.equal(p.fee, 1500);
});

test('planCurrencyPayment refuses when wallet plus coin (after the fee) still falls short', () => {
  const p = planCurrencyPayment({ amount: 100000, walletBalance: 10000, coinBalance: 2, price: 5000 });
  assert.equal(p.ok, false);
  assert.match(p.error, /Not enough/);
  assert.equal(planCurrencyPayment({ amount: 0 }).error, 'Enter an amount');
  assert.match(planCurrencyPayment({ amount: 5, walletBalance: 0, coinBalance: 1, price: 0 }).error, /live coin price/);
});

// ─── the person's OWN currency, not a fixed one ────────────────────────────

import { formatMoney, moneyDecimals, conversionMargin, quickMoneyAmounts } from '../src/utils/walletRouting.js';

test('money is shown in the currency\'s own precision: cents for USD/EUR/GBP, whole units otherwise', () => {
  assert.equal(formatMoney('UGX', 20000), 'UGX 20,000');
  assert.equal(formatMoney('KES', 1234.5), 'KES 1,235');
  assert.equal(formatMoney('USD', 1.3), 'USD 1.30');
  assert.equal(formatMoney('eur', 0), 'eur 0.00');
  assert.equal(formatMoney('', 5), '5');
  assert.deepEqual([moneyDecimals('GBP'), moneyDecimals('NGN'), moneyDecimals(undefined)], [2, 0, 0]);
});

test('a two-decimal currency gets a cent of headroom on coin sold for money, so a conversion never lands a cent short', () => {
  assert.equal(conversionMargin('USD'), 0.01);
  assert.equal(conversionMargin('UGX'), 0);
  for (const needed of [10, 9.5, 123.45, 0.5]) {
    const coins = coinsToSellFor(needed, 1.3, 0.03, conversionMargin('USD'));
    assert.ok(simulateSell(coins, 1.3).net >= needed + 0.01 - 1e-9, `USD ${needed}`);
  }
  const plan = planCurrencyPayment({ amount: 10, walletBalance: 0.5, coinBalance: 12, price: 1.3, currency: 'USD' });
  assert.equal(plan.ok, true);
  assert.ok(plan.proceeds >= 9.51);
});

test('planner messages carry the currency and its precision', () => {
  const buy = planCoinPayment({ coinsNeeded: 10, coinBalance: 0, walletBalance: 5, price: 1.3, mode: 'currency_only', currency: 'USD' });
  assert.equal(buy.ok, false);
  assert.match(buy.error, /costs USD 13\.00, you have USD 5\.00/);
  const sell = planCurrencyPayment({ amount: 100, walletBalance: 1, coinBalance: 2, price: 1.3, currency: 'USD' });
  assert.match(sell.error, /you have USD 1\.00 in your wallet/);
});

test('quick amounts scale with the coin price in each currency and stay friendly', () => {
  assert.deepEqual(quickMoneyAmounts(5000, 'UGX'), [5000, 10000, 20000, 50000]);
  assert.deepEqual(quickMoneyAmounts(6123.4, 'UGX'), [5000, 10000, 20000, 50000]);
  assert.deepEqual(quickMoneyAmounts(1.3, 'USD'), [1, 2.5, 5, 10]);
  assert.deepEqual(quickMoneyAmounts(160, 'KES'), [150, 300, 500, 1500]);
  assert.deepEqual(quickMoneyAmounts(0, 'UGX'), []);
  assert.ok(quickMoneyAmounts(0.4, 'KES').every((v) => v >= 1), 'a whole-unit currency never offers less than 1');
});

test('coin <-> money conversion works the same in a two-decimal currency', () => {
  const coins = coinsForCurrency(20, 1.3);
  assert.equal(coins, 15.38461538);
  assert.ok(currencyForCoins(coins, 1.3) <= 20);
  assert.equal(currencyForCoins(coins, 1.3), 20);
});
