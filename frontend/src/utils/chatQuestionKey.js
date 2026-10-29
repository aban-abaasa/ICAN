/**
 * The "Ask us" assistant remembers answers (see api/_lib/chatMemory.js). To notice that two visitors asked
 * "the same thing" in different words, every question is reduced to a KEY: lower-case content words only,
 * synonyms folded together ("what time do you open?" and "opening hours" are both `hours`), plurals trimmed,
 * duplicates dropped and the words sorted -- so word order, filler and small spelling differences don't matter.
 *
 * Shared by the server (matching and storing) and by the CMMS panel (when staff teach the assistant an answer),
 * so both sides always compute the same key. Pure and dependency-free.
 */

const STOP_WORDS = new Set((
  'a an the is are was were am be been do does did you your yours u ur i me my mine we our ours us can could would will shall should may might '
  + 'please pls plz hi hello hey hola there to of in on at for with about any have has had get got tell let know want wanna like need '
  + 'and or but so if then than as by from into just really very much many some what whats which who whom how why also kindly thanks thank thx ok okay '
  + 'yes no sure maybe good morning afternoon evening dear sir madam'
).split(/\s+/));

// Groups of words that mean the same thing to a visitor; each folds into its first word.
const SYNONYM_GROUPS = [
  ['hours', 'hour', 'open', 'opens', 'opened', 'opening', 'close', 'closes', 'closed', 'closing', 'time', 'times', 'schedule', 'when'],
  ['location', 'where', 'located', 'address', 'direction', 'directions', 'find', 'place', 'map', 'visit', 'situated'],
  ['price', 'prices', 'pricing', 'cost', 'costs', 'rate', 'rates', 'fee', 'fees', 'charge', 'charges', 'cheap', 'expensive', 'afford'],
  ['contact', 'phone', 'call', 'number', 'reach', 'whatsapp', 'email', 'mail'],
  ['jobs', 'job', 'vacancy', 'vacancies', 'career', 'careers', 'hiring', 'hire', 'recruit', 'recruiting', 'recruitment', 'employment', 'internship'],
  ['pay', 'paying', 'payment', 'payments', 'momo', 'card', 'invoice', 'receipt', 'checkout'],
  ['delivery', 'deliver', 'delivers', 'deliveries', 'ship', 'shipping', 'dispatch'],
  ['book', 'booking', 'bookings', 'appointment', 'appointments', 'reserve', 'reservation'],
  ['refund', 'refunds', 'return', 'returns', 'exchange'],
];
const SYNONYM = new Map(SYNONYM_GROUPS.flatMap(([head, ...rest]) => [[head, head], ...rest.map((w) => [w, head])]));

// Multi-word phrases that must be folded before splitting into words.
const PHRASES = [
  [/\bhow much\b/g, ' price '],
  [/\bwhat time\b/g, ' hours '],
  [/\b(?:working|business|opening|open|trading) hours?\b/g, ' hours '],
  [/\bmobile money\b/g, ' pay '],
  [/\bwho (?:are|is) you\b/g, ' about '],
];

const stem = (word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

const tokenize = (text) => String(text ?? '')
  .toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ');

export const questionKey = (text) => {
  let t = tokenize(text);
  PHRASES.forEach(([re, to]) => { t = t.replace(re, to); });
  const words = new Set();
  for (const raw of t.split(/\s+/)) {
    if (!raw) continue;
    if (STOP_WORDS.has(raw)) continue;
    // Numbers and amounts ("50000", "2pm") are kept as written: they change the question's meaning.
    const word = /\d/.test(raw) ? raw : (SYNONYM.get(raw) || SYNONYM.get(stem(raw)) || stem(raw));
    if (word.length > 1 || /\d/.test(word)) words.add(word);
  }
  return [...words].sort().join(' ').slice(0, 200);
};

const wordsOf = (key) => new Set(String(key || '').split(' ').filter(Boolean));

/**
 * Do two keys describe the same question? Word overlap (Jaccard) must be high, and any numbers must agree exactly:
 * "do you sell shoes" is not "do you sell shirts", and "price for 5 people" is not "price for 50 people".
 */
export const sameQuestion = (keyA, keyB, threshold = 0.6) => {
  const a = wordsOf(keyA);
  const b = wordsOf(keyB);
  if (a.size === 0 || b.size === 0) return false;
  const numbers = (set) => [...set].filter((w) => /\d/.test(w)).sort().join(',');
  if (numbers(a) !== numbers(b)) return false;
  let shared = 0;
  a.forEach((w) => { if (b.has(w)) shared += 1; });
  return shared / (a.size + b.size - shared) >= threshold;
};

// Questions that lean on something said earlier ("how much is it?", "and the second one?") can't be answered on
// their own, so their answers are never remembered or reused.
const FOLLOW_UP_WORDS = /\b(?:it|its|that|this|those|these|them|they|he|she|one|ones|another|other|same|more|else|again|previous|earlier|above|before|first|second|third|last)\b/i;
const FOLLOW_UP_START = /^\s*(?:and|but|so|then|what about|how about|why|ok|okay|yes|no)\b/i;
export const isFollowUp = (text) => FOLLOW_UP_WORDS.test(text) || FOLLOW_UP_START.test(text);

const PRIVATE_DETAIL = /@|https?:|www\.|(?:\d[\s-]?){7,}|\bmy (?:order|name|number|account|booking|payment|receipt|id|phone|email|card|balance|wallet|plan|reference|ref)\b|\bi (?:am|'m|paid|ordered|booked|applied|sent)\b/i;
const INJECTION = /\b(?:ignore (?:all |the |any )?(?:previous |above |prior |your )?(?:instructions|rules|prompt)|system prompt|you are now|jailbreak|pretend (?:to be|you)|act as|developer mode|reveal your)\b/i;

/** May this question's answer be remembered and shown to other visitors? Never if it is personal, odd or context-bound. */
export const isMemorableQuestion = (text) => {
  const q = String(text ?? '').trim();
  if (q.length < 3 || q.length > 200) return false;
  if (PRIVATE_DETAIL.test(q) || INJECTION.test(q) || isFollowUp(q)) return false;
  return questionKey(q).length >= 3;
};
