/**
 * Whole-app translation. The dictionaries (./translations) hold hand-checked wording for the
 * strings that were wired to t(); this layer covers EVERYTHING else on screen so every page
 * follows the user's language without touching hundreds of components:
 *
 *   1. It reads the visible text (and placeholder / title / aria-label / alt) of the page and keeps
 *      watching for changes (screens opening, data loading, React re-rendering).
 *   2. Each English string is looked up in the dictionary phrase table first (instant, hand-checked),
 *      then in this device's cache of earlier translations, and only then sent - in small batches,
 *      once per string - to POST /api/translate. English stays on screen until the answer arrives.
 *   3. The original text is remembered per node, so switching language (or back to English)
 *      restores the page exactly, and text React changes later is treated as new English.
 *
 * Adjacent text nodes (React renders "You have {n} alerts" as three) are translated as ONE sentence,
 * and numbers are swapped for {0}, {1}... so each sentence is translated once whatever the figures.
 * Plain text nodes only are rewritten (never innerHTML), so it cannot inject markup, and React keeps
 * working: when it updates a node it overwrites our text, which we then see and translate afresh.
 * Mark anything that must never be translated (a person's name, a transaction note) with
 * translate="no" or class="notranslate".
 */
import {
  abstractNumbers, buildKnownTarget, buildPhraseTable, chunk, createCache, lookupPhrase, restoreNumbers,
  shouldTranslate, splitEdges, tokensMatch,
} from './pageTranslatorCore.js';

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = 'script,style,noscript,code,pre,kbd,samp,textarea,[translate="no"],.notranslate,[contenteditable=""],[contenteditable="true"]';
const BATCH = 40;
const SCAN_DELAY_MS = 60;
const FETCH_DELAY_MS = 150;
const MAX_FAILURES = 4;

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {(language: string, texts: string[]) => Promise<string[]>} deps.fetchTranslations
 *        rejects with an Error carrying `.status` (HTTP code) when the call fails
 * @param {Storage} [deps.storage]
 * @param {Record<string, Record<string,string>>} deps.dictionaries  every language's dictionary
 * @param {(status: 'idle'|'translating'|'unavailable') => void} [deps.onStatus]
 */
export const createPageTranslator = ({ doc, fetchTranslations, storage, dictionaries, onStatus = () => {} }) => {
  const english = dictionaries.en;
  const View = doc.defaultView;

  const textRecs = new WeakMap(); // Text -> { orig, shown }
  const attrRecs = new WeakMap(); // Element -> Map(attr -> { orig, shown })

  let active = false;
  let language = null;
  let phrases = null;
  let known = null;
  let cache = null;
  let observer = null;
  let scanTimer = null;
  let fetchTimer = null;
  let failures = 0;
  let unavailable = false;
  const missing = new Set(); // English strings still waiting for a translation
  const rejected = new Set(); // strings whose translation came back unusable: not asked again this session
  const dirty = new Set(); // changed nodes waiting to be (re)scanned
  let fullScanWanted = false;
  let inflight = 0;

  const setStatus = () => {
    if (unavailable) onStatus('unavailable');
    else onStatus(inflight > 0 || missing.size > 0 ? 'translating' : 'idle');
  };

  // ---- translating one string -------------------------------------------------------------
  const translateCore = (core) => {
    const phrase = lookupPhrase(phrases, core);
    if (phrase !== undefined) return phrase;
    if (known.has(core.replace(/\s+/g, ' ').trim())) return undefined; // already in the target language
    if (!shouldTranslate(core)) return undefined;
    const { key, values } = abstractNumbers(core);
    const cached = cache.get(key);
    if (cached !== undefined) return restoreNumbers(cached, values);
    if (!unavailable && !rejected.has(key)) missing.add(key);
    return undefined;
  };

  // A run is a stretch of adjacent text nodes: one sentence as far as the reader is concerned.
  // The whole translation goes into the first node and the rest are emptied; each node keeps its own
  // English original, so when the app changes any one of them the sentence is rebuilt from the parts.
  const processRun = (nodes) => {
    const originals = nodes.map((node) => {
      const current = node.nodeValue;
      let rec = textRecs.get(node);
      if (!rec || current !== rec.shown) { rec = { orig: current, shown: current }; textRecs.set(node, rec); }
      return rec.orig;
    });
    const { lead, core, trail } = splitEdges(originals.join(''));
    let desired = originals; // default: English on screen
    if (core) {
      const out = translateCore(core);
      if (out !== undefined && out !== core) desired = [lead + out + trail, ...nodes.slice(1).map(() => '')];
    }
    nodes.forEach((node, i) => {
      if (node.nodeValue !== desired[i]) node.nodeValue = desired[i];
      textRecs.get(node).shown = desired[i];
    });
  };

  const processAttrs = (el) => {
    for (const attr of ATTRS) {
      const current = el.getAttribute(attr);
      if (current == null) continue;
      let byAttr = attrRecs.get(el);
      if (!byAttr) { byAttr = new Map(); attrRecs.set(el, byAttr); }
      let rec = byAttr.get(attr);
      if (!rec || current !== rec.shown) { rec = { orig: current, shown: current }; byAttr.set(attr, rec); }
      const { lead, core, trail } = splitEdges(rec.orig);
      if (!core) continue;
      const out = translateCore(core);
      if (out === undefined || out === core) continue;
      const next = lead + out + trail;
      if (current !== next) el.setAttribute(attr, next);
      rec.shown = next;
    }
  };

  // ---- walking the page --------------------------------------------------------------------
  const runFrom = (first) => {
    const run = [];
    for (let n = first; n && n.nodeType === 3; n = n.nextSibling) run.push(n);
    return run;
  };

  const walk = (start, visitRun, visitElement) => {
    if (start.nodeType === 3) {
      if (start.parentElement && start.parentElement.closest(SKIP)) return;
      let first = start;
      while (first.previousSibling && first.previousSibling.nodeType === 3) first = first.previousSibling;
      visitRun(runFrom(first));
      return;
    }
    if (start.nodeType !== 1 && start.nodeType !== 9 && start.nodeType !== 11) return;
    if (start.nodeType === 1) {
      if (start.closest(SKIP)) return;
      visitElement(start);
    }
    const walker = doc.createTreeWalker(start, 1 /* ELEMENT */ | 4 /* TEXT */, {
      acceptNode(n) {
        if (n.nodeType === 3) {
          // Only the first node of a run starts it; the others are visited as part of that run.
          if (!(n.previousSibling && n.previousSibling.nodeType === 3)) visitRun(runFrom(n));
          return 2; /* REJECT: no children anyway */
        }
        if (n.matches(SKIP)) return 2;
        visitElement(n);
        return 3; /* SKIP: do not return it, but descend */
      },
    });
    while (walker.nextNode()) { /* acceptNode does the work */ }
  };

  const restoreText = (node) => {
    const rec = textRecs.get(node);
    if (rec && rec.shown !== rec.orig && node.nodeValue === rec.shown) node.nodeValue = rec.orig;
    textRecs.delete(node);
  };
  const restoreAttrs = (el) => {
    const byAttr = attrRecs.get(el);
    if (!byAttr) return;
    for (const [attr, rec] of byAttr) {
      if (rec.shown !== rec.orig && el.getAttribute(attr) === rec.shown) el.setAttribute(attr, rec.orig);
    }
    attrRecs.delete(el);
  };

  // ---- scanning ----------------------------------------------------------------------------
  const enqueue = (record) => {
    if (record.type === 'childList') record.addedNodes.forEach((n) => dirty.add(n));
    else dirty.add(record.target);
  };

  const scan = () => {
    scanTimer = null;
    if (!active) return;
    observer.takeRecords().forEach(enqueue);
    if (fullScanWanted) { fullScanWanted = false; dirty.clear(); walk(doc.body, processRun, processAttrs); }
    else {
      const nodes = [...dirty];
      dirty.clear();
      for (const n of nodes) if (n.isConnected) walk(n, processRun, processAttrs);
    }
    observer.takeRecords(); // our own edits are not changes to react to
    setStatus();
    if (missing.size > 0) scheduleFetch();
  };

  const scheduleScan = (full = false) => {
    if (full) fullScanWanted = true;
    if (!scanTimer && active) scanTimer = View.setTimeout(scan, SCAN_DELAY_MS);
  };

  // ---- fetching translations ---------------------------------------------------------------
  const scheduleFetch = (delay = FETCH_DELAY_MS) => {
    if (fetchTimer || !active || unavailable) return;
    fetchTimer = View.setTimeout(runFetch, delay);
  };

  const runFetch = async () => {
    fetchTimer = null;
    if (!active || unavailable || missing.size === 0) return;
    const texts = [...missing].filter((t) => !cache.has(t));
    missing.clear();
    const lang = language;
    let retryDelay = 0;
    inflight += 1;
    setStatus();
    for (const batch of chunk(texts, BATCH)) {
      try {
        const out = await fetchTranslations(lang, batch);
        if (!active || lang !== language) { inflight -= 1; return; }
        batch.forEach((text, i) => {
          // Keep only translations that preserved the {n} number tokens; anything else stays English.
          if (typeof out[i] === 'string' && out[i] && tokensMatch(text, out[i])) cache.set(text, out[i]);
          else rejected.add(text);
        });
        failures = 0;
      } catch (err) {
        if (!active || lang !== language) { inflight -= 1; return; }
        failures += 1;
        // 400/503: not configured or not accepted - stop asking this session, stay English.
        if (err.status === 503 || err.status === 400 || failures >= MAX_FAILURES) { unavailable = true; break; }
        batch.forEach((t) => missing.add(t));
        retryDelay = Math.min(60_000, 2000 * 2 ** failures * (err.status === 429 ? 3 : 1));
      }
    }
    inflight -= 1;
    scheduleScan(true);
    if (retryDelay && missing.size > 0) scheduleFetch(retryDelay);
    setStatus();
  };

  // ---- public ------------------------------------------------------------------------------
  const stop = () => {
    if (!active) return;
    active = false;
    observer.disconnect();
    View.clearTimeout(scanTimer); scanTimer = null;
    View.clearTimeout(fetchTimer); fetchTimer = null;
    missing.clear(); dirty.clear(); rejected.clear();
    walk(doc.body, (run) => run.forEach(restoreText), restoreAttrs);
    cache.flush();
    inflight = 0;
    onStatus('idle');
  };

  const start = (nextLanguage) => {
    stop();
    const target = dictionaries[nextLanguage];
    if (!target || nextLanguage === 'en') return;
    language = nextLanguage;
    phrases = buildPhraseTable(english, target);
    known = buildKnownTarget(target);
    cache = createCache(storage, language);
    failures = 0;
    unavailable = false;
    active = true;
    observer = new View.MutationObserver((records) => {
      records.forEach(enqueue);
      scheduleScan();
    });
    observer.observe(doc.body, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS,
    });
    scheduleScan(true);
  };

  return { start, stop, get active() { return active; }, get language() { return language; } };
};
