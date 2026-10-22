import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SALE_FEES, BIG_FEE_PERCENT, percentToRate, rateToPercent, describeFee, describeChange } from '../src/utils/saleFees.js';

test('the two fees are dropship (2%) and the Digital City Era store sale (1%), the same defaults the database falls back to', () => {
  assert.deepEqual(SALE_FEES.map((f) => [f.key, f.defaultRate]), [['dropship_sale', 0.02], ['store_sale', 0.01]]);
});

test('a percentage becomes the fraction the server stores', () => {
  assert.deepEqual(percentToRate('2'), { ok: true, percent: 2, rate: 0.02 });
  assert.equal(percentToRate('1.25').rate, 0.0125);
  assert.equal(percentToRate(' 2% ').rate, 0.02);
  assert.equal(percentToRate('0').rate, 0);
  assert.equal(percentToRate('2.5').rate, 0.025);
  assert.equal(percentToRate('99.9999').rate, 0.999999);
});

test('float noise never leaks into the rate: every percent with up to four decimals gives an exact six-decimal fraction', () => {
  for (const p of ['0.07', '0.0001', '1.1', '2.675', '33.3333', '0.3', '4.35', '12.3456']) {
    const { rate } = percentToRate(p);
    assert.equal(rate, Number((Number(p) / 100).toFixed(6)), p);
    assert.ok(String(rate).length <= 10, `${p} -> ${rate}`);
  }
});

test('anything that is not a sane percentage is refused with a reason, never silently turned into a rate', () => {
  for (const bad of ['', '   ', 'abc', '-1', '1,5', '2 5', '100', '100.5', '1000', '1.23456', '.', '%', '2%%', 'Infinity', '1e2', null, undefined]) {
    const r = percentToRate(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} should be refused`);
    assert.ok(r.error && r.error.length > 5, `${JSON.stringify(bad)} needs an error message`);
  }
});

test('a rate goes back to the text in the box and the label', () => {
  assert.equal(rateToPercent(0.02), '2');
  assert.equal(rateToPercent(0.0125), '1.25');
  assert.equal(rateToPercent(0), '0');
  assert.equal(rateToPercent('0.025000'), '2.5');
  assert.equal(rateToPercent(0.07), '7');
  assert.equal(rateToPercent(null), ''); // no rate is not 0%
  assert.equal(rateToPercent(undefined), '');
  assert.equal(rateToPercent(''), '');
  assert.equal(rateToPercent(-1), '');
  assert.equal(describeFee(0.02), '2%');
  assert.equal(describeFee(0.0125), '1.25%');
  assert.equal(describeFee(0), '0%');
  assert.equal(describeFee('x'), '—');
  assert.equal(describeFee(null), '—');
});

test('what is typed and what is shown round-trip', () => {
  for (const p of ['0', '1', '2', '2.5', '1.25', '0.0001', '10', '99.9999']) {
    assert.equal(rateToPercent(percentToRate(p).rate), p);
  }
});

test('the confirmation says what changes, who pays and that the customer pays the same', () => {
  const dropship = SALE_FEES[0];
  const c = describeChange(dropship, 0.02, 0.03);
  assert.equal(c.changed, true);
  assert.equal(c.big, false);
  assert.equal(c.off, false);
  assert.match(c.message, /Dropship sales/);
  assert.match(c.message, /from 2% to 3%/);
  assert.match(c.message, /paid by the reseller/i);
  assert.match(c.message, /customer pays the same/);
  assert.match(c.message, /next sale/);
});

test('switching a fee off, or setting a big one, gets a pointed second line', () => {
  const store = SALE_FEES[1];
  const off = describeChange(store, 0.01, 0);
  assert.equal(off.off, true);
  assert.match(off.message, /switches the fee OFF/);
  const big = describeChange(store, 0.01, 0.2); // 20 typed where 2 was meant
  assert.equal(big.big, true);
  assert.match(big.message, new RegExp(`more than ${BIG_FEE_PERCENT}%`));
  assert.equal(describeChange(store, 0.01, 0.1).big, false); // exactly 10% is allowed without the extra question
  assert.equal(describeChange(store, 0.01, 0.1001).big, true);
});

test('saving the rate that is already there is not a change', () => {
  assert.equal(describeChange(SALE_FEES[0], 0.02, 0.02).changed, false);
  assert.equal(describeChange(SALE_FEES[0], 0.02, percentToRate('2').rate).changed, false);
  assert.equal(describeChange(SALE_FEES[0], 0, 0).off, false);
});

// The fee tab changes what ICANera takes. A support-console link hands its visitor the dev token, so the tab must never be one a link
// can be given (the database refuses them too: the change needs the signed-in operator account). This reads the panel's source because
// the panel is a React file these plain-node tests cannot render.
test('the dev panel has the Sale fees tab and never offers it to a support link', () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/components/ICANDevPanel.jsx'), 'utf8');
  assert.match(src, /\{ id: 'fees',\s+label: 'Sale fees'/);
  assert.match(src, /tab==='fees' && <ICANFeesDevTab devToken=\{DEV_TOKEN\}\/>/);
  const shareable = src.split('\n').find((l) => l.includes('const shareableTabs = TABS.filter'));
  assert.ok(shareable, 'shareableTabs filter not found');
  assert.match(shareable, /t\.id !== 'fees'/);
});
