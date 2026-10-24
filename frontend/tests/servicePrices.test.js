import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICES, parsePriceIc, describePrice, describeServiceChange } from '../src/utils/servicePrices.js';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(path.join(repo, 'supabase', 'migrations', '20261119100000_video_product_badges.sql'), 'utf8');

test('the price box accepts coin amounts and nothing else', () => {
  assert.deepEqual(parsePriceIc('5'), { ok: true, price: 5 });
  assert.deepEqual(parsePriceIc(' 2.5 '), { ok: true, price: 2.5 });
  assert.deepEqual(parsePriceIc('0'), { ok: true, price: 0 });
  assert.deepEqual(parsePriceIc('0.00000001'), { ok: true, price: 0.00000001 });
  for (const bad of ['', 'abc', '-1', '1.123456789', '1,5', '1e3', '.5', '1000001', null, undefined]) assert.equal(parsePriceIc(bad).ok, false, String(bad));
  assert.equal(parsePriceIc('1000000').ok, true);
});

test('Free reads as Free and Charged shows the price', () => {
  assert.equal(describePrice(false, 5), 'Free');
  assert.equal(describePrice(true, 5), '5 IC');
  assert.equal(describePrice(true, 0), 'Free', 'a charge of nothing is free, never "0 IC"');
  assert.equal(describePrice(true, '2.5'), '2.5 IC');
});

test('the confirmation says exactly what will happen, and asks twice before a charge starts', () => {
  const service = SERVICES[0];
  const free = { charged: false, price_ic: 0 };
  const on = describeServiceChange(service, free, { charged: true, price: 5 });
  assert.equal(on.changed, true); assert.equal(on.big, true); assert.equal(on.was, 'Free'); assert.equal(on.will, '5 IC');
  assert.match(on.message, /Charge 5 IC per badge, per 30 days/); assert.match(on.message, /already running are not charged again/);
  const off = describeServiceChange(service, { charged: true, price_ic: 5 }, { charged: false, price: 5 });
  assert.equal(off.changed, true); assert.equal(off.big, false); assert.match(off.message, /FREE/); assert.match(off.message, /5 IC\) is remembered/);
  const same = describeServiceChange(service, { charged: true, price_ic: 5 }, { charged: true, price: 5 });
  assert.equal(same.changed, false);
  const small = describeServiceChange(service, { charged: true, price_ic: 5 }, { charged: true, price: 8 });
  assert.equal(small.changed, true); assert.equal(small.big, false);
  const jump = describeServiceChange(service, { charged: true, price_ic: 5 }, { charged: true, price: 11 });
  assert.equal(jump.big, true, 'more than double needs a second confirmation');
  const remembered = describeServiceChange(service, { charged: false, price_ic: 5 }, { charged: false, price: 9 });
  assert.equal(remembered.changed, true); assert.equal(remembered.big, false, 'changing the remembered price of a free service charges nobody');
});

test('the panel only lists services the database can price', () => {
  assert.ok(SERVICES.length >= 1);
  for (const { key } of SERVICES) assert.match(migration, new RegExp(`p_key NOT IN \\([^)]*'${key}'`), `${key} is not accepted by ican_dev_set_service_price`);
  for (const { key } of SERVICES) assert.match(migration, new RegExp(`\\('${key}',\\s+0, FALSE,`), `${key} starts free`);
  assert.deepEqual(SERVICES.map((x) => x.key), ['pitch_product_badge', 'status_product_badge']);
});
