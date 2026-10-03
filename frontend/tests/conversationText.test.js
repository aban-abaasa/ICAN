import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanConversation, limitConversation } from '../src/utils/conversationText.js';

test('plain text is kept, with spacing tidied', () => {
  const r = cleanConversation('I worked at  Nile Breweries.\r\n\r\n\r\n\r\nI studied accounting.');
  assert.equal(r.isChat, false);
  assert.deepEqual(r.speakers, []);
  assert.equal(r.text, 'I worked at Nile Breweries.\n\nI studied accounting.');
});

test('Android WhatsApp export: timestamps and system lines are removed, speakers counted', () => {
  const raw = [
    '12/03/2025, 10:14 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.',
    '12/03/2025, 10:15 - Aban: I studied accounting at Makerere',
    'and graduated in 2018',
    '12/03/2025, 10:16 - Grace: Nice! Where do you work now?',
    '12/03/2025, 10:17 - Aban: <Media omitted>',
    '12/03/2025, 10:18 - Aban: Stock controller at Nile Breweries since 2019',
    '12/03/2025, 10:19 - Aban created group "Farmers"',
  ].join('\n');
  const r = cleanConversation(raw);
  assert.equal(r.isChat, true);
  assert.equal(r.text, [
    'Aban: I studied accounting at Makerere\nand graduated in 2018',
    'Grace: Nice! Where do you work now?',
    'Aban: Stock controller at Nile Breweries since 2019',
  ].join('\n'));
  assert.deepEqual(r.speakers, [{ name: 'Aban', count: 2 }, { name: 'Grace', count: 1 }]);
});

test('iPhone export with seconds and AM/PM (narrow no-break space) is understood', () => {
  const raw = '[3/12/25, 10:14:22 PM] Aban: We sell dried maize\n[3/12/25, 10:15:01 PM] Grace: How much per tonne?';
  const r = cleanConversation(raw);
  assert.equal(r.isChat, true);
  assert.equal(r.text, 'Aban: We sell dried maize\nGrace: How much per tonne?');
});

test('a real message that mentions leaving or groups is not dropped', () => {
  const raw = '12/03/2025, 10:15 - Aban: I left Stanbic in 2021 and created group savings for farmers\n12/03/2025, 10:16 - Grace: ok';
  assert.match(cleanConversation(raw).text, /I left Stanbic in 2021 and created group savings/);
});

test('control and direction characters are stripped', () => {
  assert.equal(cleanConversation('he\u0000llo‮ world').text, 'hello world');
});

test('limitConversation cuts at a line break', () => {
  const text = `${'a'.repeat(90)}\n${'b'.repeat(90)}`;
  const r = limitConversation(text, 100);
  assert.equal(r.truncated, true);
  assert.equal(r.text, 'a'.repeat(90));
  assert.equal(limitConversation('short', 100).truncated, false);
});
