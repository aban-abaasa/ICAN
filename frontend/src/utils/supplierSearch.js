// Product search across every supplier's catalogue, plus distance helpers.
// Runs in the browser over the catalogue the panel has already loaded, so
// results appear as the user types with no round trip.

export const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value) => normalizeText(value).split(' ').filter(Boolean);

// Levenshtein distance, giving up early once it exceeds `max`.
const editDistance = (a, b, max) => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
};

// Typos tolerated per word: none for very short words (too many false hits).
const allowedTypos = (word) => (word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0);

// How well one query word matches one word of the product (0 = not at all).
const wordScore = (queryWord, productWord) => {
  if (queryWord === productWord) return 3;
  if (productWord.startsWith(queryWord)) return 2.5;
  if (queryWord.length >= 3 && productWord.includes(queryWord)) return 2;
  const typos = allowedTypos(queryWord);
  if (typos > 0 && editDistance(queryWord, productWord, typos) <= typos) return 1.5;
  // "nail" should still find "nails", "cemnt" -> "cement" via a prefix typo.
  if (typos > 0 && productWord.length > queryWord.length
      && editDistance(queryWord, productWord.slice(0, queryWord.length), typos) <= typos) return 1.2;
  return 0;
};

const bestWordScore = (queryWord, words) =>
  words.reduce((best, word) => Math.max(best, wordScore(queryWord, word)), 0);

const searchableWords = (item) => ({
  name: tokenize(item.item_name),
  other: tokenize(`${item.category || ''} ${item.supplier_business_name || ''}`)
});

// Scores one product for a query. With `requireAll` every query word must
// match (a normal search); without it a partial match still counts (used to
// suggest the closest products when nothing matches exactly).
const scoreItem = (item, queryWords, requireAll) => {
  const { name, other } = searchableWords(item);
  let total = 0;
  let matched = 0;
  for (const word of queryWords) {
    const inName = bestWordScore(word, name);
    const inOther = bestWordScore(word, other) * 0.6;
    const best = Math.max(inName, inOther);
    if (best > 0) { total += best; matched += 1; } else if (requireAll) return 0;
  }
  if (matched === 0) return 0;
  const phrase = queryWords.join(' ');
  if (normalizeText(item.item_name).includes(phrase)) total += 2;
  return total * (matched / queryWords.length);
};

/**
 * @returns {{ results: Array<{item, score}>, exact: boolean }}
 * `exact` is false when nothing matched every word and the results are the
 * closest partial matches instead.
 */
export const searchCatalog = (items, query) => {
  const queryWords = tokenize(query);
  if (queryWords.length === 0) return { results: items.map((item) => ({ item, score: 0 })), exact: true };

  const strict = items
    .map((item) => ({ item, score: scoreItem(item, queryWords, true) }))
    .filter((row) => row.score > 0);
  if (strict.length > 0) return { results: strict, exact: true };

  const loose = items
    .map((item) => ({ item, score: scoreItem(item, queryWords, false) }))
    .filter((row) => row.score > 0);
  return { results: loose, exact: false };
};

/** "cemnt bags" -> "cement bags", from the words that really exist in the catalogue. */
export const suggestCorrection = (items, query) => {
  const queryWords = tokenize(query);
  if (queryWords.length === 0) return null;
  const vocabulary = new Set();
  items.forEach((item) => tokenize(item.item_name).forEach((word) => vocabulary.add(word)));

  let changed = false;
  const corrected = queryWords.map((word) => {
    if (vocabulary.has(word)) return word;
    const typos = Math.max(allowedTypos(word), word.length >= 3 ? 1 : 0);
    let best = null;
    let bestDistance = typos + 1;
    vocabulary.forEach((candidate) => {
      const distance = editDistance(word, candidate, typos);
      if (distance < bestDistance) { best = candidate; bestDistance = distance; }
    });
    if (best) { changed = true; return best; }
    return word;
  });
  return changed ? corrected.join(' ') : null;
};

// Same product sold by several suppliers ("Cement 50kg" / "cement 50 kg").
export const productKey = (item) => normalizeText(item.item_name).replace(/\s/g, '');

export const haversineKm = (lat1, lng1, lat2, lng2) => {
  const values = [lat1, lng1, lat2, lng2].map(Number);
  if (values.some((v) => !Number.isFinite(v))) return null;
  const [a1, o1, a2, o2] = values;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(a2 - a1);
  const dLng = toRad(o2 - o1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

export const formatKm = (km) => {
  if (km == null) return null;
  return km < 1 ? `${Math.max(50, Math.round(km * 10) * 100)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
};
