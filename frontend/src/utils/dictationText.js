// Turns what the speech engine hears into clean written text. Pure functions, no browser APIs,
// so they can be tested in Node.

// Spoken punctuation. Longest phrases first so "new paragraph" wins over "new line".
const SPOKEN = [
  [/\s*\b(?:new paragraph|next paragraph)\b[\s,.]*/gi, '\n\n'],
  [/\s*\b(?:new line|next line)\b[\s,.]*/gi, '\n'],
  [/\s*\b(?:question mark)\b/gi, '?'],
  [/\s*\b(?:exclamation mark|exclamation point)\b/gi, '!'],
  [/\s*\b(?:full stop)\b/gi, '.'],
  [/\s*\b(?:semicolon|semi colon)\b/gi, ';'],
  [/\s*\b(?:colon)\b/gi, ':'],
  [/\s*\b(?:comma)\b/gi, ','],
  [/\b(?:open bracket|open parenthesis)\s*/gi, '('],
  [/\s*\b(?:close bracket|close parenthesis)\b/gi, ')'],
  [/\s*\b(?:bullet point|new bullet)\b[\s,.]*/gi, '\n- '],
];

// Words speech engines routinely get wrong for this app. Only unambiguous ones: "I can" is
// ordinary English, so it is left alone.
const VOCABULARY = [
  [/\bc\.?\s?m\.?\s?m\.?\s?s\b\.?/gi, 'CMMS'],
  [/\bcmss\b/gi, 'CMMS'],
  [/\bu\.?\s?g\.?\s?x\b\.?/gi, 'UGX'],
  [/\bican\s?era\b/gi, 'IcanEra'],
  [/\bican\b/gi, 'ICAN'],
  [/\bpitch\s?in\b/gi, 'Pitchin'],
];

const STOP_PHRASE = /[\s,.]*\b(?:stop|end)\s+(?:dictation|dictating|recording|listening|minutes)\s*[.!]?\s*$/i;

/** True when the chunk ends with a spoken "stop dictation" style command. */
export function endsWithStopCommand(text) {
  return STOP_PHRASE.test(String(text || ''));
}

/** Removes a trailing "stop dictation" command and returns the rest. */
export function stripStopCommand(text) {
  return String(text || '').replace(STOP_PHRASE, '');
}

/** "period" is a real word ("a period of leave"), so it only counts as punctuation at the very end. */
function trailingPeriod(text) {
  return text.replace(/\s*\bperiod\s*$/i, '.');
}

export function applySpokenCommands(text) {
  let out = trailingPeriod(String(text || '').trim());
  for (const [pattern, replacement] of SPOKEN) out = out.replace(pattern, replacement);
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

export function fixVocabulary(text) {
  let out = String(text || '');
  for (const [pattern, replacement] of VOCABULARY) out = out.replace(pattern, replacement);
  // standalone "i" -> "I", which also fixes i'm, i've, i'll; leaves "i.e." alone
  return out.replace(/\bi\b(?!\.)/g, 'I');
}

const SENTENCE_END = /[.!?]["')\]]*$/;

function capitaliseFirst(text) {
  return text.replace(/^(\s*(?:[-(]\s*)?)(\p{Ll})/u, (_, lead, ch) => lead + ch.toUpperCase());
}

/** Capitalises after . ! ? and after line breaks inside a single chunk. */
function capitaliseSentences(text) {
  return text.replace(/([.!?]["')\]]*\s+|\n+(?:-\s)?)(\p{Ll})/gu, (_, lead, ch) => lead + ch.toUpperCase());
}

/**
 * Appends a heard chunk to existing text: runs spoken commands and vocabulary fixes, puts the
 * spacing right around punctuation and line breaks, starts sentences with a capital, and drops
 * an exact repeat of what was just added (some Android browsers deliver a result twice).
 */
export function appendDictation(existing, heard) {
  const base = String(existing || '');
  let chunk = fixVocabulary(applySpokenCommands(heard));
  if (!chunk) return base;

  const tail = base.trimEnd().toLowerCase();
  const probe = chunk.toLowerCase();
  if (probe.length >= 12 && tail.endsWith(probe)) return base;

  chunk = capitaliseSentences(chunk);

  const trimmed = base.replace(/[ \t]+$/, '');
  const atStart = trimmed === '' || /\n\s*(?:-\s)?$/.test(trimmed) || SENTENCE_END.test(trimmed.trimEnd());
  if (atStart) chunk = capitaliseFirst(chunk);

  if (trimmed === '') return chunk;
  if (/^[,.;:!?)]/.test(chunk)) return trimmed.replace(/[,;:]$/, '') + chunk;
  if (/\n$/.test(trimmed) || /^\n/.test(chunk) || /[(]$/.test(trimmed)) return trimmed + chunk;
  return `${trimmed} ${chunk}`;
}

/** Picks the most confident of the engine's alternatives for one result. */
export function bestAlternative(result) {
  let best = null;
  for (let i = 0; i < result.length; i += 1) {
    const alt = result[i];
    if (!best || (alt.confidence || 0) > (best.confidence || 0)) best = alt;
  }
  return (best?.transcript || '').trim();
}

export function wordCount(text) {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}
