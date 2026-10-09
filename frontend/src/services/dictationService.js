/**
 * Dictation service — one shared microphone session for the whole app.
 *
 * It lives outside React on purpose: the session keeps running when the person switches to
 * another tab or screen inside the app, and every finished phrase is handed to the `onText`
 * callback they started with (the notebook saves it straight into the note), so nothing
 * depends on the screen that started it still being mounted. It runs until the person stops it.
 *
 * What it does to keep going: the browser ends a speech session after a pause, so it restarts
 * itself; it holds a screen wake lock so the phone does not sleep mid-meeting; and it resumes
 * when the page becomes visible again. What no web page can do: record while the browser is
 * fully backgrounded or the phone is locked. The UI says so.
 */
import { bestAlternative, endsWithStopCommand, stripStopCommand } from '../utils/dictationText.js';

const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

const MAX_QUICK_ENDS = 6; // sessions that die within a second, in a row, before we give up
const state = { supported: !!Recognition, listening: false, starting: false, interim: '', error: '', label: '', title: '', words: 0 };
let snapshot = { ...state };
const listeners = new Set();

let recognition = null;
let target = null; // { onText, label, lang }
let wanted = false; // the person has asked for dictation and has not stopped it
let restartTimer = null;
let startedAt = 0;
let quickEnds = 0;
let networkRetries = 0;
let wakeLock = null;

function publish(patch) {
  Object.assign(state, patch);
  snapshot = { ...state };
  listeners.forEach((fn) => fn());
}

async function holdScreenAwake() {
  try {
    if (wanted && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {
    wakeLock = null; // not allowed or not supported; dictation still works
  }
}

function releaseScreen() {
  try { wakeLock?.release(); } catch { /* already released */ }
  wakeLock = null;
}

function deliver(heardText) {
  if (!target) return;
  let text = heardText;
  const stop = endsWithStopCommand(text);
  if (stop) text = stripStopCommand(text);
  if (text.trim()) {
    target.onText(text.trim());
    publish({ words: state.words + text.trim().split(/\s+/).length });
  }
  if (stop) stopDictation();
}

function begin() {
  if (!wanted || !Recognition || !target) return;
  clearTimeout(restartTimer);
  const rec = new Recognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  rec.lang = target.lang || navigator.language || 'en-US';

  rec.onstart = () => {
    startedAt = Date.now();
    publish({ listening: true, starting: false, error: '' });
  };

  rec.onresult = (event) => {
    networkRetries = 0;
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) {
        const heard = bestAlternative(result);
        if (heard) deliver(heard);
      } else {
        interim += result[0].transcript;
      }
    }
    publish({ interim: interim.trim() });
  };

  rec.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      wanted = false;
      publish({ error: 'Microphone access was blocked. Allow it in your browser settings, then try again.' });
    } else if (event.error === 'audio-capture') {
      wanted = false;
      publish({ error: 'No microphone was found.' });
    } else if (event.error === 'network') {
      networkRetries += 1;
      if (networkRetries > 4) {
        wanted = false;
        publish({ error: 'Voice typing needs an internet connection and could not reach the speech service.' });
      }
    }
    // 'no-speech' and 'aborted' are normal pauses: onend restarts the session.
  };

  rec.onend = () => {
    recognition = null;
    publish({ interim: '' });
    if (!wanted) {
      target = null; // kept until now so the last phrase, delivered just after stop(), is not lost
      publish({ listening: false, starting: false });
      releaseScreen();
      return;
    }
    quickEnds = Date.now() - startedAt < 1000 ? quickEnds + 1 : 0;
    if (quickEnds >= MAX_QUICK_ENDS) {
      wanted = false;
      publish({ listening: false, starting: false, error: 'Voice typing keeps stopping on this device. You can keep typing.' });
      releaseScreen();
      return;
    }
    // Restart fast after a normal pause (a short gap loses less speech); back off if sessions keep dying.
    restartTimer = setTimeout(begin, quickEnds === 0 ? 120 : Math.min(250 * quickEnds, 1500));
  };

  recognition = rec;
  try {
    rec.start();
  } catch {
    recognition = null; // already starting; onend will retry
  }
}

/**
 * Starts listening. A second call replaces the first (one microphone at a time).
 * @param {{ onText: (phrase: string) => void, label?: string, title?: string, lang?: string }} options
 * `label` identifies the field (buttons compare it); `title` is what the recording pill shows.
 */
export function startDictation({ onText, label = '', title = '', lang }) {
  if (!Recognition) {
    publish({ error: 'Voice typing is not supported in this browser. Use Chrome or Edge.' });
    return false;
  }
  abandonSession();
  target = { onText, label, lang };
  wanted = true;
  quickEnds = 0;
  networkRetries = 0;
  publish({ starting: true, error: '', label, title: title || label, words: 0, interim: '' });
  holdScreenAwake();
  begin();
  return true;
}

/** Drops the current session without delivering anything more from it (used when replacing it). */
function abandonSession() {
  wanted = false;
  clearTimeout(restartTimer);
  if (recognition) {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.abort(); } catch { /* not running */ }
    recognition = null;
  }
  target = null;
  releaseScreen();
}

export function stopDictation() {
  wanted = false;
  clearTimeout(restartTimer);
  if (recognition) {
    try { recognition.stop(); } catch { /* not running */ }
    return; // onend finishes the job once the last phrase has been delivered
  }
  target = null;
  publish({ listening: false, starting: false, interim: '' });
  releaseScreen();
}

export function subscribeDictation(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getDictationSnapshot() {
  return snapshot;
}

if (typeof document !== 'undefined') {
  // Coming back to the app: the browser may have paused the session; pick it up again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !wanted) return;
    holdScreenAwake();
    if (!recognition) begin();
  });
}
