// Prepares a pasted or uploaded conversation before it is read: removes chat-app noise
// (timestamps, "<Media omitted>", encryption notices), works out who is talking, and keeps the
// text within what the reader accepts. Pure functions, no network.

export const MAX_CONVERSATION_CHARS = 20000;

// "12/03/2025, 10:14 - " (Android), "[12/03/2025, 10:14:22] " (iPhone), 12 or 24 hour clocks.
// WhatsApp puts a narrow no-break space (U+202F) before AM/PM, so \s is used for the gap.
const STAMP = /^‎?\[?(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}),?\s+\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?\]?\s*(?:[-–]\s*)?(.*)$/;
const SPEAKER = /^([^:\n]{1,40}):\s+(.*)$/;
// Whole-message placeholders only. Phrases that a person could really write ("I left", "I created
// a group") are deliberately not filtered: WhatsApp's own system lines have no "Name:" and are
// already dropped for that reason.
const NOISE = /^(<media omitted>|(image|video|audio|sticker|gif|document) omitted|\(file attached\)|this message was deleted|you deleted this message|null|missed (voice|video) call)\.?$/i;

/**
 * @returns {{ text: string, speakers: { name: string, count: number }[], isChat: boolean }}
 * `text` keeps "Name: message" lines for chat exports, or the cleaned paragraph text otherwise.
 * `speakers` lists the people who sent messages, busiest first (empty for plain text).
 */
export function cleanConversation(input) {
  const raw = String(input || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​‎‏‪-‮]/g, '');
  const lines = raw.split('\n');
  const stamped = lines.filter((line) => STAMP.test(line)).length;

  if (stamped < 2) {
    const plain = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return { text: plain, speakers: [], isChat: false };
  }

  const messages = [];
  for (const line of lines) {
    const m = line.match(STAMP);
    if (m) {
      const body = m[2].trim();
      const s = body.match(SPEAKER);
      if (s) {
        messages.push({ name: s[1].trim(), text: s[2].trim() });
      } else {
        messages.push({ name: '', text: body }); // system line, filtered below
      }
    } else if (messages.length && line.trim()) {
      messages[messages.length - 1].text += `\n${line.trim()}`; // a message that continues on the next line
    }
  }

  const kept = messages.filter((msg) => msg.name && msg.text && !NOISE.test(msg.text));
  const counts = new Map();
  for (const msg of kept) counts.set(msg.name, (counts.get(msg.name) || 0) + 1); // real messages only
  const speakers = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return { text: kept.map((msg) => `${msg.name}: ${msg.text}`).join('\n'), speakers, isChat: true };
}

/** Cut to the reader's limit at a line break where possible. */
export function limitConversation(text, max = MAX_CONVERSATION_CHARS) {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf('\n');
  return { text: lastBreak > max * 0.8 ? cut.slice(0, lastBreak) : cut, truncated: true };
}
