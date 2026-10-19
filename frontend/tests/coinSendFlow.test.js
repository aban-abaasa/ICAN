import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecipientWallet, runCoinSend, describeSendError } from '../src/services/coinSendFlow.js';

// A minimal stand-in for the Supabase client: user_accounts rows filterable with
// eq / in, and the resolve_ican_business_wallet rpc.
function fakeSupabase({ accounts = [], wallets = {} } = {}) {
  return {
    from() {
      let rows = accounts;
      const q = {
        select: () => q,
        eq: (col, val) => { rows = rows.filter((r) => r[col] === val); return q; },
        in: (col, vals) => { rows = rows.filter((r) => vals.includes(r[col])); return q; },
        limit: async () => ({ data: rows, error: null }),
      };
      return q;
    },
    async rpc(name, args) {
      if (name === 'resolve_ican_business_wallet') {
        const w = wallets[args.p_wallet_address];
        return { data: w ? [w] : [], error: null };
      }
      return { data: null, error: null };
    },
  };
}

const ANN = { user_id: 'ann', account_holder_name: 'Ann', account_number: '1000000000000001', account_type: 'personal', phone_number: '+256701234567', email: 'ann@x.com' };
const ANN_BIZ = { user_id: 'ann', account_holder_name: 'Ann Traders', account_number: '2000000000000002', account_type: 'business', business_id: 'biz-ann', phone_number: '+256701234567', email: 'ann@x.com' };
const BOB = { user_id: 'bob', account_holder_name: 'Bob', account_number: '1000000000000003', account_type: 'personal', phone_number: '+256772000000', email: 'bob@x.com' };
const SHOP_WALLET = { business_profile_id: 'biz-shop', business_name: 'Corner Shop', wallet_address: '3000000000000004' };

const ME = 'me';
const MY_BIZ = { id: 'biz-me', business_name: 'My Co', user_id: ME, ican_wallet: { ican_balance: '50' } };

// Everything a send touches, recorded so each test can assert what did and didn't happen.
function harness({ accounts = [ANN, ANN_BIZ, BOB], wallets = { [SHOP_WALLET.wallet_address]: SHOP_WALLET }, pin = '1234', confirmAnswer = true, userPinOk = true, bizPinOk = true, admin = true, businessStatus = 'completed' } = {}) {
  const log = { pins: [], confirms: [], api: [], verified: [] };
  const base = {
    supabase: fakeSupabase({ accounts, wallets }),
    currentUserId: ME,
    askPin: async (req) => { log.pins.push(req.title); return pin; },
    confirm: (m) => { log.confirms.push(m); return confirmAnswer; },
    verifyUserPIN: async () => { log.verified.push('user'); return userPinOk ? { success: true } : { success: false, error: 'Incorrect transaction PIN' }; },
    verifyBusinessWalletPin: async () => { log.verified.push('business'); return bizPinOk ? { success: true } : { success: false, error: 'Incorrect business-wallet PIN' }; },
    api: {
      sendIcaneracoin: async (a) => { log.api.push(['sendIcaneracoin', a]); return { tx_id: 'tx-user' }; },
      sendICANToBusiness: async (a) => { log.api.push(['sendICANToBusiness', a]); return { out_tx_id: 'tx-tobiz' }; },
      sendFromBusinessWallet: async (a) => { log.api.push(['sendFromBusinessWallet', a]); return { status: businessStatus, transactionId: 'tx-frombiz' }; },
      isBusinessWalletAdmin: async () => { log.api.push(['isBusinessWalletAdmin']); return admin; },
    },
  };
  return { log, base };
}
const send = (h, over) => runCoinSend({ ...h.base, amount: '5', recipientIdentifier: BOB.account_number, ...over });
const moved = (api) => api.filter(([n]) => n !== 'isBusinessWalletAdmin');

// ─── recipient lookup ──────────────────────────────────────────────────────

test('a phone shared by a personal and a business account resolves to the personal one (it used to fail)', async () => {
  const r = await resolveRecipientWallet(fakeSupabase({ accounts: [ANN_BIZ, ANN] }), '+256701234567');
  assert.equal(r.userId, 'ann');
  assert.equal(r.accountType, 'personal');
  assert.equal(r.businessProfileId, null);
});

test('a business account number resolves to that business, not to its owner', async () => {
  const r = await resolveRecipientWallet(fakeSupabase({ accounts: [ANN, ANN_BIZ] }), ANN_BIZ.account_number);
  assert.equal(r.accountType, 'business');
  assert.equal(r.businessProfileId, 'biz-ann');
  assert.equal(r.name, 'Ann Traders');
});

test('a business wallet number (leading 3) resolves through resolve_ican_business_wallet', async () => {
  const r = await resolveRecipientWallet(fakeSupabase({ wallets: { [SHOP_WALLET.wallet_address]: SHOP_WALLET } }), '3000 0000 0000 0004');
  assert.equal(r.businessProfileId, 'biz-shop');
  assert.equal(r.userId, null);
});

test('a 0-prefixed phone finds a +256-stored number when the country is known, and not otherwise', async () => {
  const db = fakeSupabase({ accounts: [BOB] });
  assert.equal((await resolveRecipientWallet(db, '0772000000', { countryCallingCode: '256' })).userId, 'bob');
  assert.match((await resolveRecipientWallet(db, '0772000000')).error, /not found/i);
});

test('an unknown email, wallet number or empty input is a clear error', async () => {
  const db = fakeSupabase({ accounts: [BOB] });
  assert.match((await resolveRecipientWallet(db, 'nobody@x.com')).error, /Recipient not found/);
  assert.match((await resolveRecipientWallet(db, '3999999999999999')).error, /Business account not found/);
  assert.match((await resolveRecipientWallet(db, '  ')).error, /Enter who to send to/);
});

// ─── all four directions ───────────────────────────────────────────────────

test('personal → personal: wallet PIN, transfer_ican', async () => {
  const h = harness();
  const r = await send(h);
  assert.equal(r.success, true);
  assert.deepEqual(h.log.pins, ['Confirm transfer']);
  assert.deepEqual(h.log.verified, ['user']);
  assert.deepEqual(moved(h.log.api), [['sendIcaneracoin', { fromUserId: ME, toUserId: 'bob', amount: 5, note: 'Transfer to Bob' }]]);
  assert.equal(r.touchesBusiness, false);
});

test("personal → someone's business account number: paid into the business wallet, not the owner's", async () => {
  const h = harness();
  const r = await send(h, { recipientIdentifier: ANN_BIZ.account_number });
  assert.equal(r.success, true);
  assert.deepEqual(moved(h.log.api), [['sendICANToBusiness', { fromUserId: ME, businessProfileId: 'biz-ann', amount: 5, note: 'Transfer to Ann Traders' }]]);
  assert.equal(r.touchesBusiness, true);
  assert.match(h.log.confirms[0], /business account/);
});

test('personal → business wallet number (leading 3)', async () => {
  const h = harness();
  const r = await send(h, { recipientIdentifier: SHOP_WALLET.wallet_address });
  assert.equal(r.success, true);
  assert.equal(moved(h.log.api)[0][0], 'sendICANToBusiness');
  assert.equal(moved(h.log.api)[0][1].businessProfileId, 'biz-shop');
});

test('personal → own business is allowed (funding your business)', async () => {
  const h = harness({ accounts: [{ ...ANN_BIZ, user_id: ME, business_id: 'biz-me' }] });
  const r = await send(h, { recipientIdentifier: ANN_BIZ.account_number });
  assert.equal(r.success, true);
  assert.equal(moved(h.log.api)[0][1].businessProfileId, 'biz-me');
});

test('business admin → personal: business PIN checked first, then submitted AND approved in one step', async () => {
  const h = harness({ admin: true });
  const r = await send(h, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: true });
  assert.equal(r.success, true);
  assert.equal(r.pendingApproval, false);
  assert.deepEqual(h.log.pins, ['Business wallet PIN']);
  assert.deepEqual(h.log.verified, ['business']);
  const [name, args] = moved(h.log.api)[0];
  assert.equal(name, 'sendFromBusinessWallet');
  assert.deepEqual(args, { businessProfileId: 'biz-me', recipientUserId: 'bob', recipientBusinessProfileId: null, amount: 5, note: 'Transfer to Bob', pin: '1234', isAdmin: true });
  assert.match(r.message, /from My Co to Bob/);
});

test('business admin → another business', async () => {
  const h = harness();
  const r = await send(h, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: true, recipientIdentifier: SHOP_WALLET.wallet_address });
  assert.equal(r.success, true);
  const args = moved(h.log.api)[0][1];
  assert.equal(args.recipientBusinessProfileId, 'biz-shop');
  assert.equal(args.recipientUserId, null);
});

test('business → its owner personal wallet is allowed (taking money out of the business)', async () => {
  const h = harness({ accounts: [{ ...ANN, user_id: ME }] });
  const r = await send(h, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: true, recipientIdentifier: ANN.account_number });
  assert.equal(r.success, true);
  assert.equal(moved(h.log.api)[0][1].recipientUserId, ME);
});

test('business non-admin: no PIN asked, sent as a request, says it is awaiting approval', async () => {
  const h = harness({ admin: false, businessStatus: 'pending_approval' });
  const r = await send(h, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: false });
  assert.equal(r.success, true);
  assert.equal(r.pendingApproval, true);
  assert.deepEqual(h.log.pins, []);
  assert.deepEqual(h.log.verified, []);
  assert.equal(moved(h.log.api)[0][1].isAdmin, false);
  assert.match(h.log.confirms[0], /administrator as a request/);
  assert.match(r.message, /must approve it/);
});

test('admin status unknown on the form: it is looked up before deciding which PIN to ask', async () => {
  const h = harness({ admin: false, businessStatus: 'pending_approval' });
  const r = await send(h, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: null });
  assert.equal(h.log.api[0][0], 'isBusinessWalletAdmin');
  assert.equal(r.pendingApproval, true);
  assert.deepEqual(h.log.pins, []);
});

// ─── guards: nothing moves ─────────────────────────────────────────────────

test('sending to yourself is refused before any PIN', async () => {
  const h = harness({ accounts: [{ ...BOB, user_id: ME }] });
  const r = await send(h);
  assert.equal(r.success, false);
  assert.match(r.message, /yourself/);
  assert.deepEqual(h.log.pins, []);
  assert.deepEqual(moved(h.log.api), []);
});

test('a business cannot send to its own wallet', async () => {
  const h = harness({ wallets: { '3000000000000009': { business_profile_id: 'biz-me', business_name: 'My Co' } } });
  const r = await send(h, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: true, recipientIdentifier: '3000000000000009' });
  assert.equal(r.success, false);
  assert.match(r.message, /own wallet/);
  assert.deepEqual(moved(h.log.api), []);
});

test('a business cannot send more than it holds — refused before any request is created', async () => {
  const h = harness();
  const r = await send(h, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: true, amount: '75' });
  assert.equal(r.success, false);
  assert.match(r.message, /has only 50\.0000 IcanEra/);
  assert.deepEqual(h.log.pins, []);
  assert.deepEqual(moved(h.log.api), []);
});

test('bad amounts are refused', async () => {
  for (const amount of ['', '0', '-3', 'abc']) {
    const h = harness();
    const r = await send(h, { amount });
    assert.equal(r.success, false, `amount "${amount}"`);
    assert.deepEqual(moved(h.log.api), []);
  }
});

test('cancelling the confirm, or the PIN, moves nothing', async () => {
  const noConfirm = harness({ confirmAnswer: false });
  assert.deepEqual(await send(noConfirm), { cancelled: true });
  assert.deepEqual(noConfirm.log.pins, []);
  assert.deepEqual(moved(noConfirm.log.api), []);

  const noPin = harness({ pin: null });
  assert.deepEqual(await send(noPin), { cancelled: true });
  assert.deepEqual(moved(noPin.log.api), []);

  const noBizPin = harness({ pin: null });
  assert.deepEqual(await send(noBizPin, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: true }), { cancelled: true });
  assert.deepEqual(moved(noBizPin.log.api), []);
});

test('a wrong PIN stops the send: wallet PIN for a personal sender, business PIN for a business admin', async () => {
  const personal = harness({ userPinOk: false });
  const r1 = await send(personal);
  assert.equal(r1.success, false);
  assert.match(r1.message, /Incorrect transaction PIN/);
  assert.deepEqual(moved(personal.log.api), []);

  const business = harness({ bizPinOk: false });
  const r2 = await send(business, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: true });
  assert.equal(r2.success, false);
  assert.match(r2.message, /business-wallet PIN/);
  assert.deepEqual(moved(business.log.api), []);
});

test('recipient not found stops before any prompt', async () => {
  const h = harness();
  const r = await send(h, { recipientIdentifier: 'ghost@x.com' });
  assert.equal(r.success, false);
  assert.deepEqual(h.log.confirms, []);
});

// ─── errors ────────────────────────────────────────────────────────────────

test('describeSendError speaks plainly about an inactive business wallet and points at a created request', () => {
  assert.match(describeSendError(new Error('Business wallet not found or inactive')), /hasn't activated its IcanEra wallet/);
  const withRequest = Object.assign(new Error('Valid business-wallet PIN is required'), { requestId: 'req-9' });
  assert.match(describeSendError(withRequest), /req-9/);
  assert.equal(describeSendError(new Error('Insufficient ICAN balance')), 'Insufficient ICAN balance');
  assert.equal(describeSendError(null), 'Icaneracoin transfer failed');
});

test('describeSendError turns the national-ID block into a clear instruction instead of a database message', () => {
  const blocked = new Error('NATIONAL_ID_REQUIRED: add your national ID to your wallet before you send or withdraw money .');
  const message = describeSendError(blocked);
  assert.match(message, /Add your national ID to your wallet/);
  assert.doesNotMatch(message, /NATIONAL_ID_REQUIRED/);
});

// ─── balance is checked before any prompt ─────────────────────────────────

test('a personal sender without enough coin is told so before any confirm or PIN (a UGX figure read as coins used to ask for a PIN, then fail)', async () => {
  const h = harness();
  const r = await send(h, { amount: '20000', getPersonalBalance: async () => 3.5 });
  assert.equal(r.success, false);
  assert.match(r.message, /You have 3\.5000 IcanEra, not enough to send 20000\.0000/);
  assert.deepEqual(h.log.confirms, []);
  assert.deepEqual(h.log.pins, []);
  assert.deepEqual(moved(h.log.api), []);
});

test('with enough coin the send proceeds; an unreadable balance does not block it (the database still enforces it)', async () => {
  const enough = harness();
  assert.equal((await send(enough, { getPersonalBalance: async () => 10 })).success, true);

  const unreadable = harness();
  const r = await send(unreadable, { getPersonalBalance: async () => { throw new Error('offline'); } });
  assert.equal(r.success, true);
  assert.equal(moved(unreadable.log.api)[0][0], 'sendIcaneracoin');
});

test('a business sender is checked against the business wallet, not the personal balance', async () => {
  const h = harness();
  const r = await send(h, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: true, amount: '5', getPersonalBalance: async () => 0 });
  assert.equal(r.success, true);
});

// ─── automatic conversion: money → coin ────────────────────────────────────

const TRADING = { currency: 'UGX', price: 5000, walletBalance: 100000 };
function converting(over = {}) {
  const h = harness(over);
  const { trading = TRADING, buyFails = false, transferFails = false, tradingFails = false } = over;
  h.base.getTradingInfo = async () => { if (tradingFails) throw new Error('The live coin price is unavailable right now.'); return trading; };
  h.base.api.buyCoinsFromWallet = async (a) => {
    h.log.api.push(['buyCoinsFromWallet', a]);
    if (buyFails) throw new Error('Not enough money in your IcanEra Wallet.');
    return { success: true };
  };
  if (transferFails) {
    const fail = async () => { throw new Error('Transfer exploded'); };
    h.base.api.sendICANToBusiness = fail;
    h.base.api.sendIcaneracoin = fail;
  }
  return h;
}

test('UGX 20,000 to a business wallet: converted to 4 coins at the live price, bought from the wallet, then sent — one PIN', async () => {
  const h = converting();
  const r = await send(h, { recipientIdentifier: SHOP_WALLET.wallet_address, amount: '20000', amountUnit: 'currency' });
  assert.equal(r.success, true);
  assert.deepEqual(h.log.api.map(([n]) => n), ['buyCoinsFromWallet', 'sendICANToBusiness']);
  assert.equal(h.log.api[0][1].icanAmount, 4);
  assert.equal(h.log.api[1][1].amount, 4);
  assert.equal(h.log.api[1][1].businessProfileId, 'biz-shop');
  assert.deepEqual(h.log.pins, ['Confirm transfer']);
  assert.match(h.log.confirms[0], /UGX 20,000 becomes 4\.0000 IcanEra at UGX 5,000 per coin/);
  assert.match(h.log.confirms[0], /First UGX 20,000 from your wallet is converted into 4\.0000 IcanEra \(no fee\)/);
  assert.match(r.message, /Sent 4\.0000 IcanEra/);
  assert.match(r.message, /Converted UGX 20,000/);
  assert.deepEqual(r.converted, { currency: 'UGX', cost: 20000, coins: 4 });
});

test('money typed leaves the coin balance alone, even when the coins on hand would cover it', async () => {
  const h = converting();
  const r = await send(h, { recipientIdentifier: SHOP_WALLET.wallet_address, amount: '20000', amountUnit: 'currency', getPersonalBalance: async () => 50 });
  assert.equal(r.success, true);
  assert.equal(h.log.api[0][0], 'buyCoinsFromWallet');
});

test('money typed but the wallet cannot cover it: refused before any confirm, PIN or conversion', async () => {
  const h = converting({ trading: { ...TRADING, walletBalance: 5000 } });
  const r = await send(h, { recipientIdentifier: SHOP_WALLET.wallet_address, amount: '20000', amountUnit: 'currency' });
  assert.equal(r.success, false);
  assert.match(r.message, /Not enough money in your wallet/);
  assert.deepEqual(h.log.confirms, []);
  assert.deepEqual(h.log.pins, []);
  assert.deepEqual(h.log.api, []);
});

test('an unavailable live price stops a conversion before anything moves', async () => {
  const h = converting({ tradingFails: true });
  const r = await send(h, { recipientIdentifier: SHOP_WALLET.wallet_address, amount: '20000', amountUnit: 'currency' });
  assert.equal(r.success, false);
  assert.match(r.message, /live coin price is unavailable/);
  assert.deepEqual(h.log.api, []);
});

test('an amount too small to buy any coin is refused', async () => {
  const r = await send(converting(), { amount: '0.0001', amountUnit: 'currency' });
  assert.equal(r.success, false);
  assert.match(r.message, /too small/);
});

test('coins typed but short: only the shortfall is converted from wallet money, coins on hand are spent first', async () => {
  const h = converting();
  const r = await send(h, { amount: '4', getPersonalBalance: async () => 1.5 });
  assert.equal(r.success, true);
  assert.deepEqual(h.log.api.map(([n]) => n), ['buyCoinsFromWallet', 'sendIcaneracoin']);
  assert.equal(h.log.api[0][1].icanAmount, 2.5);
  assert.equal(h.log.api[1][1].amount, 4);
  assert.match(h.log.confirms[0], /First UGX 12,500 from your wallet is converted into 2\.5000 IcanEra/);
  assert.deepEqual(r.converted, { currency: 'UGX', cost: 12500, coins: 2.5 });
});

test('coins typed and held: no conversion happens', async () => {
  const h = converting();
  const r = await send(h, { amount: '1', getPersonalBalance: async () => 3.5 });
  assert.equal(r.success, true);
  assert.deepEqual(h.log.api.map(([n]) => n), ['sendIcaneracoin']);
  assert.equal(r.converted, null);
});

test('coins typed, short, and the wallet cannot cover the rest: refused before any prompt', async () => {
  const h = converting({ trading: { ...TRADING, walletBalance: 1000 } });
  const r = await send(h, { amount: '4', getPersonalBalance: async () => 1.5 });
  assert.equal(r.success, false);
  assert.match(r.message, /You have 1\.5000 IcanEra/);
  assert.deepEqual(h.log.pins, []);
  assert.deepEqual(h.log.api, []);
});

test('cancelling the confirm, or a wrong PIN, converts nothing', async () => {
  const noConfirm = converting({ confirmAnswer: false });
  assert.deepEqual(await send(noConfirm, { amount: '20000', amountUnit: 'currency' }), { cancelled: true });
  assert.deepEqual(noConfirm.log.api, []);

  const wrongPin = converting({ userPinOk: false });
  const r = await send(wrongPin, { amount: '20000', amountUnit: 'currency' });
  assert.equal(r.success, false);
  assert.deepEqual(wrongPin.log.api, []);
});

test('if the conversion itself fails, nothing is sent', async () => {
  const h = converting({ buyFails: true });
  await assert.rejects(send(h, { amount: '20000', amountUnit: 'currency' }), /Not enough money in your IcanEra Wallet/);
  assert.deepEqual(h.log.api.map(([n]) => n), ['buyCoinsFromWallet']);
});

test('if the transfer fails AFTER the conversion, the error says the coins are safe in the balance', async () => {
  const h = converting({ transferFails: true });
  let caught;
  try { await send(h, { amount: '20000', amountUnit: 'currency' }); } catch (e) { caught = e; }
  assert.ok(caught, 'should throw');
  assert.deepEqual(caught.converted, { currency: 'UGX', cost: 20000, coins: 4 });
  const text = describeSendError(caught);
  assert.match(text, /Transfer exploded/);
  assert.match(text, /UGX 20,000 was already converted to 4\.0000 IcanEra — it is safe in your IcanEra balance/);
});

test('a business sender typing money just sends the coin equivalent — no conversion, business PIN', async () => {
  const h = converting();
  const r = await send(h, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: true, amount: '20000', amountUnit: 'currency' });
  assert.equal(r.success, true);
  assert.deepEqual(h.log.api.map(([n]) => n), ['sendFromBusinessWallet']);
  assert.equal(h.log.api[0][1].amount, 4);
  assert.deepEqual(h.log.pins, ['Business wallet PIN']);
  assert.equal(r.converted, null);
  assert.match(r.message, /UGX 20,000 at UGX 5,000 per coin/);
});

test('a business cannot send more than it holds, in either unit', async () => {
  const h = converting();
  const r = await send(h, { sendFromBusiness: MY_BIZ, sendFromIsAdmin: true, amount: '1000000', amountUnit: 'currency' });
  assert.equal(r.success, false);
  assert.match(r.message, /has only 50\.0000 IcanEra/);
});

test('a USD wallet: money typed is converted at the USD price and the confirm and message say USD', async () => {
  const h = converting({ trading: { currency: 'USD', price: 1.3, walletBalance: 100 } });
  const r = await send(h, { recipientIdentifier: SHOP_WALLET.wallet_address, amount: '20', amountUnit: 'currency' });
  assert.equal(r.success, true);
  assert.equal(h.log.api[0][0], 'buyCoinsFromWallet');
  assert.equal(h.log.api[0][1].icanAmount, 15.38461538);
  assert.match(h.log.confirms[0], /USD 20\.00 becomes 15\.3846 IcanEra at USD 1\.30 per coin/);
  assert.deepEqual(r.converted, { currency: 'USD', cost: 20, coins: 15.38461538 });
  assert.match(r.message, /Converted USD 20\.00/);
});
