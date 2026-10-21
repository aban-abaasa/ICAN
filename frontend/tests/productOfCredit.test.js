import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PRODUCT_OWNER, PRODUCT_OWNER_URL, PRODUCT_OF_TEXT, PRODUCT_OF_HTML } from '../src/constants/brand.js';
import { drawProductOf } from '../src/utils/pdfCredit.js';

// "A product of GODMINDERA ORGANISATION (U) LTD" links to the owner's site on IcanEra, icanera.space/<business-name>, wherever it shows.

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('the credit names the owner and carries its address in every form', () => {
  assert.ok(PRODUCT_OF_TEXT.includes(PRODUCT_OWNER) && PRODUCT_OF_TEXT.includes(PRODUCT_OWNER_URL));
  assert.match(PRODUCT_OF_HTML, new RegExp(`<a href="${PRODUCT_OWNER_URL}"[^>]*>${PRODUCT_OWNER.replace(/[()]/g, '\\$&')}</a>`));
});

// A doc that records what is drawn, with a width of 2 units per character.
const fakeDoc = () => {
  const calls = [];
  return {
    calls,
    getTextWidth: (text) => text.length * 2,
    getFontSize: () => 8,
    getTextColor: () => '#787878',
    setDrawColor: (c) => calls.push(['draw', c]),
    text: (t, x, y) => calls.push(['text', t, x, y]),
    textWithLink: (t, x, y, o) => calls.push(['link', t, x, y, o.url]),
    line: (x1, y1, x2, y2) => calls.push(['line', x1, y1, x2, y2]),
  };
};

test('a PDF credit draws the lead-in, then the company name as a link with an underline', () => {
  const doc = fakeDoc();
  const lead = 'Printed today · Powered by IcanEra · ';
  const width = drawProductOf(doc, 14, 287, { lead });
  const prefix = `${lead}A product of `;
  assert.deepEqual(doc.calls.find((c) => c[0] === 'text'), ['text', prefix, 14, 287]);
  assert.deepEqual(doc.calls.find((c) => c[0] === 'link'), ['link', PRODUCT_OWNER, 14 + prefix.length * 2, 287, PRODUCT_OWNER_URL]);
  const [, x1, y1, x2, y2] = doc.calls.find((c) => c[0] === 'line');
  assert.equal(y1, y2);
  assert.ok(y1 > 287);
  assert.equal(x1, 14 + prefix.length * 2);
  assert.equal(x2, 14 + width);
  assert.equal(x2 - x1, PRODUCT_OWNER.length * 2, 'the underline is as wide as the name');
});

test('a centred or right-aligned PDF credit is aligned as a whole line, name included', () => {
  const doc = fakeDoc();
  const width = drawProductOf(doc, 105, 235, { align: 'center' });
  assert.equal(doc.calls.find((c) => c[0] === 'text')[2], 105 - width / 2);
  const right = fakeDoc();
  drawProductOf(right, 200, 235, { align: 'right' });
  assert.equal(right.calls.find((c) => c[0] === 'link')[2] + PRODUCT_OWNER.length * 2, 200);
});

test('in a real PDF the company name is a clickable link annotation', () => {
  // A child process, because tests/run.mjs runs every test file in ONE process and other files leave a fake `window` behind,
  // which jsPDF's Node build then mistakes for a browser. Here it loads exactly as it does when the app builds a PDF.
  const helper = pathToFileURL(path.join(src, 'utils', 'pdfCredit.js')).href;
  const script = `
    import { jsPDF } from 'jspdf';
    import { drawProductOf } from ${JSON.stringify(helper)};
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setFontSize(8); doc.setTextColor(140);
    drawProductOf(doc, 105, 235, { align: 'center' });
    process.stdout.write(doc.output());
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: path.join(src, '..'), encoding: 'latin1', maxBuffer: 20 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(`/URI (${PRODUCT_OWNER_URL})`), 'no link annotation to the owner site in the PDF');
  assert.ok(run.stdout.includes('/Subtype /Link'));
});

test('no credit is left as plain text anywhere in the app: each one links', () => {
  const offenders = [];
  const walk = (dir) => readdirSync(dir).forEach((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return walk(file);
    if (!/\.(jsx?|tsx?)$/.test(name)) return;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/A product of GODMINDERA/.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line)) offenders.push(`${path.relative(src, file)}:${i + 1}`);
    });
  });
  walk(src);
  assert.deepEqual(offenders, [], 'plain-text credit: use <ProductOfLink />, PRODUCT_OF_HTML / PRODUCT_OF_TEXT or drawProductOf()');
});
