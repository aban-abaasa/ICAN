import test from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for the browser's speech engine that the test drives by hand.
const sessions = [];
class FakeRecognition {
  constructor() { this.aborted = false; sessions.push(this); }
  start() { queueMicrotask(() => this.onstart?.()); }
  stop() { this.stopped = true; queueMicrotask(() => this.onend?.()); }
  abort() { this.aborted = true; }
  say(transcript, isFinal = true, confidence = 0.9) {
    const result = [{ transcript, confidence }];
    result.isFinal = isFinal;
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
}
globalThis.window = { SpeechRecognition: FakeRecognition };
globalThis.document = { visibilityState: 'visible', addEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true });

const { startDictation, stopDictation, getDictationSnapshot } = await import('../src/services/dictationService.js');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('a finished phrase reaches the callback and interim text is shown meanwhile', async () => {
  const heard = [];
  startDictation({ label: 'a', onText: (t) => heard.push(t) });
  await tick();
  const s = sessions.at(-1);
  assert.equal(getDictationSnapshot().listening, true);
  s.say('the pump is', false);
  assert.equal(getDictationSnapshot().interim, 'the pump is');
  s.say('the pump is leaking', true);
  assert.deepEqual(heard, ['the pump is leaking']);
  assert.equal(getDictationSnapshot().interim, '');
  stopDictation();
  await tick();
});

test('the engine restarts itself after the browser ends the session, until stopped', async () => {
  const heard = [];
  const before = sessions.length;
  startDictation({ label: 'b', onText: (t) => heard.push(t) });
  await tick();
  const first = sessions.at(-1);
  first.onend(); // browser closed the session after a pause
  await tick(400);
  assert.equal(sessions.length, before + 2, 'a new session was started');
  const second = sessions.at(-1);
  await tick();
  second.say('still listening', true);
  assert.deepEqual(heard, ['still listening']);
  stopDictation();
  await tick();
  assert.equal(getDictationSnapshot().listening, false);
  await tick(400);
  assert.equal(sessions.length, before + 2, 'no restart after the person stopped');
});

test('the last phrase delivered just after stop() is not lost', async () => {
  const heard = [];
  startDictation({ label: 'c', onText: (t) => heard.push(t) });
  await tick();
  const s = sessions.at(-1);
  stopDictation();
  s.say('final words', true); // engines flush a last result after stop()
  assert.deepEqual(heard, ['final words']);
  await tick();
});

test('"stop dictation" ends the session and is not typed into the note', async () => {
  const heard = [];
  startDictation({ label: 'd', onText: (t) => heard.push(t) });
  await tick();
  sessions.at(-1).say('that is all stop dictation', true);
  await tick();
  assert.deepEqual(heard, ['that is all']);
  assert.equal(getDictationSnapshot().listening, false);
});

test('starting a second field replaces the first and the old one hears nothing more', async () => {
  const first = [];
  const second = [];
  startDictation({ label: 'e1', onText: (t) => first.push(t) });
  await tick();
  const s1 = sessions.at(-1);
  startDictation({ label: 'e2', onText: (t) => second.push(t) });
  await tick();
  assert.equal(s1.aborted, true);
  s1.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'late', confidence: 1 }], { isFinal: true })] });
  sessions.at(-1).say('hello', true);
  assert.deepEqual(first, []);
  assert.deepEqual(second, ['hello']);
  stopDictation();
  await tick();
});

test('a blocked microphone stops the session with a message', async () => {
  startDictation({ label: 'f', onText: () => {} });
  await tick();
  const s = sessions.at(-1);
  s.onerror({ error: 'not-allowed' });
  s.onend();
  await tick();
  const snap = getDictationSnapshot();
  assert.equal(snap.listening, false);
  assert.match(snap.error, /Microphone access was blocked/);
});
