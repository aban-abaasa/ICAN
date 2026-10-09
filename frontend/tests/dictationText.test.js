import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendDictation, applySpokenCommands, fixVocabulary, endsWithStopCommand, stripStopCommand, bestAlternative, wordCount,
} from '../src/utils/dictationText.js';

test('spoken punctuation becomes symbols with correct spacing', () => {
  assert.equal(applySpokenCommands('the pump failed comma we replaced it full stop'), 'the pump failed, we replaced it.');
  assert.equal(applySpokenCommands('is it fixed question mark'), 'is it fixed?');
  assert.equal(applySpokenCommands('attendees colon Aban and Grace'), 'attendees: Aban and Grace');
});

test('"period" is only punctuation at the very end', () => {
  assert.equal(applySpokenCommands('a period of leave'), 'a period of leave');
  assert.equal(applySpokenCommands('that is all period'), 'that is all.');
});

test('new line and new paragraph insert breaks', () => {
  assert.equal(applySpokenCommands('first point new line second point'), 'first point\nsecond point');
  assert.equal(applySpokenCommands('done new paragraph next topic'), 'done\n\nnext topic');
  assert.equal(applySpokenCommands('actions bullet point call supplier'), 'actions\n- call supplier');
});

test('vocabulary and the pronoun I are corrected', () => {
  assert.equal(fixVocabulary('i opened the c m m s report in ugx'), 'I opened the CMMS report in UGX');
  assert.equal(fixVocabulary("i'm using ican era"), "I'm using IcanEra");
  assert.equal(fixVocabulary('I can do it'), 'I can do it');
  assert.equal(fixVocabulary('i.e. this one'), 'i.e. this one');
});

test('appending capitalises sentence starts and joins punctuation without a gap', () => {
  let text = '';
  text = appendDictation(text, 'the generator was serviced');
  assert.equal(text, 'The generator was serviced');
  text = appendDictation(text, 'full stop');
  assert.equal(text, 'The generator was serviced.');
  text = appendDictation(text, 'next service is in march comma please confirm');
  assert.equal(text, 'The generator was serviced. Next service is in march, please confirm');
});

test('appending after a line break starts a capitalised line', () => {
  const text = appendDictation('Agenda:\n', 'budget review');
  assert.equal(text, 'Agenda:\nBudget review');
});

test('an immediate exact repeat of a long chunk is dropped, short repeats are kept', () => {
  const once = appendDictation('', 'we agreed to buy two new pumps');
  assert.equal(appendDictation(once, 'we agreed to buy two new pumps'), once);
  assert.equal(appendDictation('No', 'no'), 'No no');
});

test('empty input leaves the text alone', () => {
  assert.equal(appendDictation('Hello', '   '), 'Hello');
});

test('stop commands are detected and removed', () => {
  assert.equal(endsWithStopCommand('that is everything stop dictation'), true);
  assert.equal(endsWithStopCommand('please do not stop'), false);
  assert.equal(stripStopCommand('that is everything stop dictation'), 'that is everything');
});

test('best alternative picks the highest confidence', () => {
  const result = [{ transcript: ' wrong ', confidence: 0.4 }, { transcript: ' right ', confidence: 0.9 }];
  result.length = 2;
  assert.equal(bestAlternative(result), 'right');
});

test('wordCount', () => {
  assert.equal(wordCount('  one two  three '), 3);
  assert.equal(wordCount(''), 0);
});
