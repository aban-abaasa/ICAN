import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUnits, formatUnits, ledgerToUnits, unitsToLedger, proofOfReserve, localValue, networkStatus, shortAddress, sameAddress, explorerLink,
  checkDeposit, checkRedeem, checkBurn, checkWithdraw, friendlyChainError, withdrawalStatus, burnStatus, rateFreshness, extractAddress,
} from '../src/utils/chainMath.js';

// These hold the on-screen arithmetic to the contracts' integers: what a person types becomes the exact base-unit amount sent,
// with no floating point anywhere. The expected numbers match the contract tests in /blockchain/test and the database tests.

test('amounts parse to exact integers, and anything that is not a plain positive decimal in range is refused', () => {
  assert.equal(parseUnits('12.5', 6), 12500000n);
  assert.equal(parseUnits('0.000001', 6), 1n);
  assert.equal(parseUnits('.5', 6), 500000n);
  assert.equal(parseUnits('5.', 6), 5000000n);
  assert.equal(parseUnits('1234567.123456', 6), 1234567123456n);
  assert.equal(parseUnits('0.1', 8), 10000000n);                       // no 0.1 * 1e8 float noise
  assert.equal(parseUnits('9.9', 8), 990000000n);
  for (const bad of ['', ' ', '.', '0', '0.0', '-1', '1e3', '1,5', '1.2.3', 'abc', null, undefined, '0.0000001']) assert.equal(parseUnits(bad, 6), null, `[${bad}]`);
});

test('base units format back without noise, and rounding is always down', () => {
  assert.equal(formatUnits(12500000n, 6), '12.5');
  assert.equal(formatUnits(1n, 6), '0.000001');
  assert.equal(formatUnits(1234567123456n, 6, 2), '1,234,567.12');
  assert.equal(formatUnits(1999999n, 6, 2), '1.99', 'never rounds a digit up');
  assert.equal(formatUnits(0n, 6), '0');
  assert.equal(formatUnits(-1500000n, 6), '-1.5');
  assert.equal(formatUnits(null, 6), '—');
  assert.equal(formatUnits(100000000n, 8), '1');
});

test('the ledger\'s 8-decimal text and the contract\'s integer convert both ways exactly', () => {
  assert.equal(ledgerToUnits('30.12345678'), 3012345678n);   // the database test's amount_units
  assert.equal(unitsToLedger(3012345678n), '30.12345678');
  assert.equal(ledgerToUnits('100.00000000'), 10000000000n);
  assert.equal(ledgerToUnits('0.000000001'), null);
});

test('proof of reserve: backed means reserve >= supply, coverage is rounded down, and an empty vault is fully backed', () => {
  assert.deepEqual(proofOfReserve({ reserve: 1000n, supply: 1000n }), { backed: true, surplus: 0n, shortfall: 0n, coverageBps: 10000n });
  assert.deepEqual(proofOfReserve({ reserve: 1005n, supply: 1000n }), { backed: true, surplus: 5n, shortfall: 0n, coverageBps: 10050n });
  assert.deepEqual(proofOfReserve({ reserve: 999n, supply: 1000n }), { backed: false, surplus: 0n, shortfall: 1n, coverageBps: 9990n });
  assert.equal(proofOfReserve({ reserve: 0n, supply: 0n }).backed, true);
  assert.equal(proofOfReserve({ reserve: 9999999999999n, supply: 10000000000000n }).coverageBps, 9999n, '99.99 %, not 100 %');
  assert.equal(proofOfReserve({ reserve: null, supply: 1n }), null);
});

test('a dollar balance in shillings is units x the rate, and a missing or bad rate gives no figure rather than a wrong one', () => {
  assert.equal(localValue(100000000n, 6, 3700), 370000);          // 100 USD
  assert.equal(localValue(500000n, 6, 3700.5), 1850.25);          // 0.5 USD
  assert.equal(localValue(1n, 6, 3700) > 0, true);
  assert.equal(localValue(1000000n, 6, 0), null);
  assert.equal(localValue(1000000n, 6, NaN), null);
  assert.equal(localValue(null, 6, 3700), null);
  assert.ok(Math.abs(localValue(123456789123456n, 6, 3700) - 123456789.123456 * 3700) < 1, 'a large balance keeps its precision');
});

test('the network check says whether the wallet is where the contracts are', () => {
  assert.equal(networkStatus({ walletChainId: 11155111, expectedChainId: 11155111 }), 'ok');
  assert.equal(networkStatus({ walletChainId: 11155111, expectedChainId: '11155111' }), 'ok');
  assert.equal(networkStatus({ walletChainId: 1, expectedChainId: 11155111 }), 'wrong');
  assert.equal(networkStatus({ walletChainId: null, expectedChainId: 11155111 }), 'unknown');
  assert.equal(networkStatus({ walletChainId: 1, expectedChainId: null }), 'unconfigured');
});

test('addresses and explorer links', () => {
  const a = '0x00000000000000000000000000000000000000AB';
  assert.equal(shortAddress(a), '0x0000…00AB');
  assert.equal(shortAddress('nonsense'), 'nonsense');
  assert.equal(sameAddress(a, a.toLowerCase()), true);
  assert.equal(sameAddress(a, null), false);
  assert.equal(explorerLink('https://sepolia.etherscan.io/', 'tx', '0xabc'), 'https://sepolia.etherscan.io/tx/0xabc');
  assert.equal(explorerLink('https://sepolia.etherscan.io', 'address', a), `https://sepolia.etherscan.io/address/${a}`);
  assert.equal(explorerLink('http://insecure.example', 'tx', '0x1'), null);
  assert.equal(explorerLink(null, 'tx', '0x1'), null);
});

test('a deposit is checked before the wallet is asked: precision, balance, approval, and the pause', () => {
  const base = { decimals: 6, balance: 100000000n, allowance: 0n };
  assert.deepEqual(checkDeposit({ ...base, amount: '25.5' }), { ok: true, units: 25500000n, needsApproval: true });
  assert.deepEqual(checkDeposit({ ...base, amount: '25.5', allowance: 25500000n }), { ok: true, units: 25500000n, needsApproval: false });
  assert.deepEqual(checkDeposit({ ...base, amount: '25.5', allowance: 25499999n }).needsApproval, true);
  assert.equal(checkDeposit({ ...base, amount: '100.000001' }).ok, false);
  assert.match(checkDeposit({ ...base, amount: '100.000001' }).error, /more than you hold/);
  assert.match(checkDeposit({ ...base, amount: '1.0000001' }).error, /6 decimal/);
  assert.equal(checkDeposit({ ...base, amount: '' }).error, null, 'an empty box is not an error to shout about');
  assert.match(checkDeposit({ ...base, amount: '5', depositsPaused: true }).error, /paused/);
  assert.match(checkDeposit({ ...base, amount: '5', balance: null }).error, /Connect/);
});

test('redeeming and burning back are checked the same way', () => {
  assert.deepEqual(checkRedeem({ amount: '10', balance: 10000000n, decimals: 6 }), { ok: true, units: 10000000n });
  assert.equal(checkRedeem({ amount: '10.000001', balance: 10000000n, decimals: 6 }).ok, false);
  assert.deepEqual(checkBurn({ amount: '1.5', balance: 200000000n }), { ok: true, units: 150000000n });
  assert.equal(checkBurn({ amount: '2.00000001', balance: 200000000n }).ok, false);
  assert.match(checkBurn({ amount: '3', balance: 200000000n }).error, /on-chain/);
});

test('a withdrawal is checked against the linked address, the limits and the ledger balance (the database re-checks all of it)', () => {
  const ok = { amount: '30.12345678', ledgerBalance: 1000, min: 1, max: 100, addressLinked: true };
  assert.deepEqual(checkWithdraw(ok), { ok: true, units: 3012345678n });
  assert.match(checkWithdraw({ ...ok, addressLinked: false }).error, /Link a wallet/);
  assert.match(checkWithdraw({ ...ok, amount: '0.5' }).error, /smallest amount is 1/);
  assert.match(checkWithdraw({ ...ok, amount: '101' }).error, /most you can move/);
  assert.match(checkWithdraw({ ...ok, amount: '50', ledgerBalance: 49.99 }).error, /IcanEra balance/);
  assert.equal(checkWithdraw({ ...ok, amount: '1.123456789' }).ok, false);
});

test('wallet and node errors become plain sentences, and never leak a stack', () => {
  assert.match(friendlyChainError({ code: 4001, message: 'User rejected the request.' }), /cancelled that in your wallet/);
  assert.match(friendlyChainError({ code: 'ACTION_REJECTED' }), /cancelled/);
  assert.match(friendlyChainError({ code: -32002 }), /already has a request open/);
  assert.match(friendlyChainError({ shortMessage: 'insufficient funds for intrinsic transaction cost' }), /enough of the network/);
  assert.match(friendlyChainError({ message: 'execution reverted: DepositsArePaused()' }), /Deposits are paused/);
  assert.match(friendlyChainError({ message: 'reverted: NonTransferable()' }), /cannot be sent to another address/);
  assert.match(friendlyChainError(null), /transaction failed/);
  assert.ok(friendlyChainError({ message: 'x'.repeat(1000) }).length <= 160);
});

test('status words for withdrawals, burns and the rate', () => {
  assert.equal(withdrawalStatus({ status: 'pending' }).label, 'Queued');
  assert.equal(withdrawalStatus({ status: 'minted' }).tone, 'ok');
  assert.equal(withdrawalStatus({ status: 'weird' }).label, 'weird');
  assert.equal(burnStatus({ status: 'credited' }).label, 'Back in IcanEra');
  assert.match(burnStatus({ status: 'unclaimed', reason: 'address_not_linked' }).help, /not linked/);
  assert.deepEqual(rateFreshness({ available: true, age_s: 30, stale: false }), { text: 'Rate updated 30 s ago', warn: false });
  assert.deepEqual(rateFreshness({ available: true, age_s: 300, stale: false }), { text: 'Rate updated 5 min ago', warn: false });
  assert.deepEqual(rateFreshness({ available: true, age_s: 7200, stale: true }), { text: 'Rate updated 2 h ago', warn: true });
  assert.equal(rateFreshness({ available: false }).warn, true);
});

test('an address pasted any reasonable way is understood, and a guess is never made', () => {
  const a = 'ab'.repeat(20);
  const want = `0x${a}`;
  assert.equal(extractAddress(`0x${a}`), want);
  assert.equal(extractAddress(`  "0x${a.toUpperCase()}"  `), want, 'quotes, spaces and capitals');
  assert.equal(extractAddress(`0X${a}`), want);
  assert.equal(extractAddress(a), want, 'without 0x');
  assert.equal(extractAddress(`https://sepolia.etherscan.io/address/0x${a}#code`), want, 'an explorer link');
  assert.equal(extractAddress(`0x${a} and again 0x${a}`), want, 'the same address twice is still one address');
  assert.equal(extractAddress(`0x${a} 0x${'cd'.repeat(20)}`), null, 'two different addresses: it will not choose');
  assert.equal(extractAddress(`0x${'ab'.repeat(32)}`), null, 'a 64-digit transaction hash is not an address');
  assert.equal(extractAddress('0x1234'), null);
  assert.equal(extractAddress(''), null);
  assert.equal(extractAddress(null), null);
});
