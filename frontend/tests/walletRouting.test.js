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
