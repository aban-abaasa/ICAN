import test from 'node:test';
import assert from 'node:assert/strict';
import { runCurrencySend, planPersonalCurrencyPayment } from '../src/services/currencyPayFlow.js';

// A minimal Supabase stand-in: user_accounts rows (eq / in) and the business-wallet rpc.
function fakeSupabase(accounts, wallets = {}) {
  return {
    from() {
      let rows = accounts;
      const q = {
        select: () => q,
        eq: (c, v) => { rows = rows.filter((r) => r[c] === v); return q; },
        in: (c, vs) => { rows = rows.filter((r) => vs.includes(r[c])); return q; },
        limit: async () => ({ data: rows, error: null }),
      };
      return q;
    },
    async rpc(name, args) {
      const w = name === 'resolve_ican_business_wallet' ? wallets[args.p_wallet_address] : null;
      return { data: w ? [w] : [], error: null };
    },
  };
}

const ME = 'me';
const BOB = { user_id: 'bob', account_holder_name: 'Bob Okello', account_number: '1000000000000003', account_type: 'personal', phone_number: '+256772000000' };
const ME_ACCT = { user_id: ME, account_holder_name: 'Me', account_number: '1000000000000009', account_type: 'personal', phone_number: '+256700000001' };
const SHOP = { business_profile_id: 'biz-shop', business_name: 'Corner Shop' };
const MY_BIZ = { id: 'biz-me', business_name: 'My Co', user_id: ME, ican_wallet: { ican_balance: '50' } };

// One scripted world: balances move as the steps run, and every call is logged in order.
function world({
  wallet = 1500, coin = 12, price = 5000, pin = '1234', admin = true, confirmAnswer = true,
  userPinOk = true, bizPinOk = true, moveStatus = 'completed', moveFails = false, sellFails = false, sendFails = false,
  sellPayoutOverride = null,
} = {}) {
  const log = { steps: [], pins: [], confirms: [] };
  const state = { wallet, coin };
  const base = {
    supabase: fakeSupabase([BOB, ME_ACCT], { 3000000000000004: SHOP }),
    currentUserId: ME,
    askPin: async (req) => { log.pins.push(req.title); return pin; },
    confirm: (m) => { log.confirms.push(m); return confirmAnswer; },
    verifyUserPIN: async () => { log.steps.push('verifyUserPIN'); return userPinOk ? { success: true } : { success: false, error: 'Incorrect transaction PIN' }; },
    verifyBusinessWalletPin: async () => { log.steps.push('verifyBusinessWalletPin'); return bizPinOk ? { success: true } : { success: false, error: 'Incorrect business-wallet PIN' }; },
    getTradingInfo: async () => ({ currency: 'UGX', price, walletBalance: state.wallet }),
    getPersonalBalance: async () => state.coin,
    api: {
      isBusinessWalletAdmin: async () => admin,
      sendFromBusinessWallet: async (a) => {
        log.steps.push(['sendFromBusinessWallet', a]);
        if (moveFails) throw Object.assign(new Error('Insufficient business-wallet balance'), {});
        if (moveStatus === 'completed') state.coin += a.amount;
        return { status: moveStatus, transactionId: 'tx-move' };
      },
      sellCoinsToWallet: async (a) => {
        log.steps.push(['sellCoinsToWallet', a]);
        if (sellFails) throw new Error('Could not convert IcanEra to money');
        const gross = Math.round(a.icanAmount * price * 100) / 100;
        const net = Math.round((gross - Math.round(gross * 0.03 * 100) / 100) * 100) / 100;
        state.coin -= a.icanAmount;
        state.wallet += sellPayoutOverride ?? net;
        return { success: true, payout: sellPayoutOverride ?? net, wallet_balance: state.wallet };
      },
      sendFiat: async (a) => {
        log.steps.push(['sendFiat', a]);
        if (sendFails) return { success: false, message: 'Recipient wallet unavailable' };
        state.wallet -= a.amount;
        return { success: true };
      },
    },
  };
  return { log, state, base };
}
const run = (w, over) => runCurrencySend({ ...w.base, recipientIdentifier: BOB.account_number, amount: '50000', ...over });
const names = (log) => log.steps.map((s) => (Array.isArray(s) ? s[0] : s));

// ─── personal wallet short of money ────────────────────────────────────────

test('wallet already covers it: nothing to convert, the normal send is used', async () => {
  const w = world({ wallet: 80000 });
  assert.deepEqual(await run(w), { direct: true });
  assert.deepEqual(w.log.steps, []);
  assert.deepEqual(w.log.pins, []);
});

test('wallet short: only the shortfall is sold from coin, then the payment is made — one PIN', async () => {
  const w = world({ wallet: 1500, coin: 12 });
  const r = await run(w);
  assert.equal(r.success, true);
  assert.deepEqual(names(w.log), ['verifyUserPIN', 'sellCoinsToWallet', 'sendFiat']);
  assert.equal(w.log.steps[1][1].icanAmount, 10); // 48,500 short ÷ (5,000 × 97%)
  const sent = w.log.steps[2][1];
  assert.deepEqual([sent.recipientId, sent.amount, sent.currency, sent.pin], ['bob', 50000, 'UGX', '1234']);
  assert.deepEqual(w.log.pins, ['Confirm payment']);
  assert.match(w.log.confirms[0], /Your wallet is short, so 10\.0000 IcanEra is converted to UGX 48,500/);
  assert.match(w.log.confirms[0], /The recipient receives normal currency/);
  assert.equal(w.state.wallet, 0); // 1,500 + 48,500 − 50,000
  assert.match(r.message, /Paid UGX 50,000 to Bob Okello/);
});

test('wallet plus coin cannot reach the amount: refused before any prompt', async () => {
  const w = world({ wallet: 1500, coin: 2 });
  const r = await run(w);
  assert.equal(r.success, false);
  assert.match(r.message, /Not enough/);
  assert.deepEqual(w.log.pins, []);
  assert.deepEqual(w.log.steps, []);
});

test('cancelling the confirm or the PIN, or a wrong PIN, converts nothing', async () => {
  const a = world({ confirmAnswer: false });
  assert.deepEqual(await run(a), { cancelled: true });
  assert.deepEqual(a.log.steps, []);

  const b = world({ pin: null });
  assert.deepEqual(await run(b), { cancelled: true });
  assert.deepEqual(names(b.log), []);

  const c = world({ userPinOk: false });
  const r = await run(c);
  assert.equal(r.success, false);
  assert.deepEqual(names(c.log), ['verifyUserPIN']);
});

test('a PIN longer than 4 digits is refused BEFORE any coin is sold (the wallet send needs 4)', async () => {
  const w = world({ pin: '123456' });
  const r = await run(w);
  assert.equal(r.success, false);
  assert.match(r.message, /4-digit PIN\. Nothing was moved/);
  assert.deepEqual(names(w.log), ['verifyUserPIN']);
});

test('conversion fails: nothing paid, and it says so', async () => {
  const w = world({ sellFails: true });
  const r = await run(w);
  assert.equal(r.success, false);
  assert.equal(r.touched, false);
  assert.match(r.message, /Nothing was paid/);
  assert.deepEqual(names(w.log), ['verifyUserPIN', 'sellCoinsToWallet']);
});

test('payment fails AFTER the conversion: the money is in the wallet, and the message says so', async () => {
  const w = world({ sendFails: true });
  const r = await run(w);
  assert.equal(r.success, false);
  assert.equal(r.touched, true);
  assert.match(r.message, /converted to UGX 48,500, but paying Bob Okello failed: Recipient wallet unavailable/);
  assert.match(r.message, /safe in your wallet/);
});

test('if the conversion pays less than planned and the wallet is short, it stops before the send', async () => {
  const w = world({ sellPayoutOverride: 40000 });
  const r = await run(w);
  assert.equal(r.success, false);
  assert.match(r.message, /your wallet has UGX 41,500/);
  assert.deepEqual(names(w.log), ['verifyUserPIN', 'sellCoinsToWallet']);
});

test('sending to yourself, an unknown person or a business wallet number is refused', async () => {
  assert.match((await run(world(), { recipientIdentifier: ME_ACCT.account_number })).message, /yourself/);
  assert.match((await run(world(), { recipientIdentifier: 'ghost@x.com' })).message, /Recipient not found/);
  const toWallet = await run(world(), { recipientIdentifier: '3000000000000004' });
  assert.equal(toWallet.success, false);
  assert.match(toWallet.message, /receives IcanEra coin, not money/);
  assert.equal((await run(world(), { amount: '0' })).success, false);
});

// ─── a business administrator pays a person in money ──────────────────────

const bizRun = (w, over) => run(w, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: true, ...over });

test('business admin → person: both PINs first, then move coin → sell → pay, in that order', async () => {
  const w = world({ wallet: 0, coin: 0 });
  const r = await bizRun(w);
  assert.equal(r.success, true);
  assert.deepEqual(w.log.pins, ['Business wallet PIN', 'Confirm payment']);
  assert.deepEqual(names(w.log), ['verifyBusinessWalletPin', 'verifyUserPIN', 'sendFromBusinessWallet', 'sellCoinsToWallet', 'sendFiat']);
  const move = w.log.steps[2][1];
  assert.deepEqual([move.businessProfileId, move.recipientUserId, move.amount, move.isAdmin, move.pin], ['biz-me', ME, 10.30927836, true, '1234']);
  assert.equal(w.log.steps[3][1].icanAmount, 10.30927836);
  assert.equal(w.log.steps[4][1].amount, 50000);
  assert.match(w.log.confirms[0], /My Co pays in IcanEra: 10\.3093 IcanEra is moved into your wallet/);
  assert.equal(r.touchesBusiness, true);
  assert.ok(w.state.wallet >= 0, 'the wallet was never overdrawn');
});

test('business admin takes money out of the business for themself: moved and converted, nothing sent', async () => {
  const w = world({ wallet: 0, coin: 0 });
  const r = await bizRun(w, { recipientIdentifier: ME_ACCT.account_number, amount: '20000' });
  assert.equal(r.success, true);
  assert.deepEqual(names(w.log), ['verifyBusinessWalletPin', 'verifyUserPIN', 'sendFromBusinessWallet', 'sellCoinsToWallet']);
  assert.match(r.message, /is now UGX .* in your wallet/);
});

test('business non-admin cannot pay money out of a business wallet', async () => {
  const w = world({ admin: false });
  const r = await bizRun(w, { sendFromIsAdmin: false });
  assert.equal(r.success, false);
  assert.match(r.message, /Only the business administrator/);
  assert.deepEqual(w.log.steps, []);
});

test('business holding too little coin for the payment plus fee is refused up front', async () => {
  const w = world();
  const r = await bizRun(w, { amount: '300000' });
  assert.equal(r.success, false);
  assert.match(r.message, /has 50\.0000 IcanEra — paying UGX 300,000 needs 61\.8557/);
  assert.deepEqual(w.log.pins, []);
});

test('business: a wrong or cancelled PIN of either kind moves nothing', async () => {
  const badBiz = world({ bizPinOk: false });
  assert.equal((await bizRun(badBiz)).success, false);
  assert.deepEqual(names(badBiz.log), ['verifyBusinessWalletPin']);

  const badUser = world({ userPinOk: false });
  assert.equal((await bizRun(badUser)).success, false);
  assert.deepEqual(names(badUser.log), ['verifyBusinessWalletPin', 'verifyUserPIN']);

  const cancelled = world({ pin: null });
  assert.deepEqual(await bizRun(cancelled), { cancelled: true });
  assert.deepEqual(cancelled.log.steps, []);
});

test('business: the first step failing leaves everything untouched', async () => {
  const w = world({ moveFails: true });
  const r = await bizRun(w);
  assert.equal(r.success, false);
  assert.match(r.message, /Insufficient business-wallet balance\. Nothing was converted or paid/);
  assert.deepEqual(names(w.log), ['verifyBusinessWalletPin', 'verifyUserPIN', 'sendFromBusinessWallet']);
});

test('business: a payment that is only queued for approval stops there', async () => {
  const w = world({ moveStatus: 'pending_approval' });
  const r = await bizRun(w);
  assert.equal(r.success, false);
  assert.match(r.message, /waiting for approval/);
  assert.deepEqual(names(w.log), ['verifyBusinessWalletPin', 'verifyUserPIN', 'sendFromBusinessWallet']);
});

test('business: if converting fails after the coin was moved, the coin is reported safe in the personal balance', async () => {
  const w = world({ sellFails: true });
  const r = await bizRun(w);
  assert.equal(r.success, false);
  assert.equal(r.touched, true);
  assert.match(r.message, /left My Co for your wallet, but converting it to money failed/);
  assert.match(r.message, /safe in your IcanEra balance/);
});

test('business: if the final payment fails, the converted money is reported safe in the wallet', async () => {
  const w = world({ sendFails: true });
  const r = await bizRun(w);
  assert.equal(r.success, false);
  assert.match(r.message, /paying Bob Okello failed/);
  assert.match(r.message, /safe in your wallet/);
});

// ─── the live quote ────────────────────────────────────────────────────────

test('planPersonalCurrencyPayment reports whether a conversion is needed, for the live quote', async () => {
  const w = world({ wallet: 1500, coin: 12 });
  const quote = await planPersonalCurrencyPayment({ amount: 50000, getTradingInfo: w.base.getTradingInfo, getPersonalBalance: w.base.getPersonalBalance });
  assert.equal(quote.ok, true);
  assert.equal(quote.convert, true);
  assert.equal(quote.sellCoins, 10);
  assert.equal(quote.currency, 'UGX');

  const enough = await planPersonalCurrencyPayment({ amount: 1000, getTradingInfo: w.base.getTradingInfo, getPersonalBalance: w.base.getPersonalBalance });
  assert.deepEqual([enough.ok, enough.convert], [true, false]);

  const down = await planPersonalCurrencyPayment({ amount: 1000, getTradingInfo: async () => { throw new Error('price unavailable'); }, getPersonalBalance: async () => 1 });
  assert.deepEqual(down, { ok: false, error: 'price unavailable' });
});

test('a USD wallet: the shortfall is sold in USD, the payment is made in USD, and the wallet is never a cent short', async () => {
  const w = world({ wallet: 0.5, coin: 12, price: 1.3 });
  w.base.getTradingInfo = async () => ({ currency: 'USD', price: 1.3, walletBalance: w.state.wallet });
  const r = await run(w, { amount: '10' });
  assert.equal(r.success, true);
  assert.equal(w.log.steps[2][0], 'sendFiat');
  assert.deepEqual([w.log.steps[2][1].currency, w.log.steps[2][1].amount], ['USD', 10]);
  assert.match(w.log.confirms[0], /converted to USD 9\.\d\d at USD 1\.30 per coin/);
  assert.ok(w.state.wallet >= 0, 'never overdrawn');
});
