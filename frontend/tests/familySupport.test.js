import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { APPS, LINKS, TOPICS, PLATFORM_SLUG } from '../api/_lib/familyKnowledge.js';
import {
  APP_IDS, buildPlatformPrompt, isPlatformSite, liveDataLine, parseFocusApp, platformFallback, resolveLinks,
  sanitizePlatformOutput, selectTopics, topicText,
} from '../api/_lib/familySupport.js';
import { answerVisitor, buildSystemPrompt, parseRequest, sanitizeAiOutput } from '../api/_lib/businessChat.js';
import { FAMILY_APPS, parseAskParam } from '../src/constants/familyApps.js';
import { PRODUCT_OWNER_SLUG } from '../src/constants/brand.js';

// The "Ask us" assistant on the GODMINDERA website: front desk for every IcanEra app. These tests guard the knowledge (what it may
// say), the retrieval (which knowledge a question reaches), the model's output (it can only name vetted links) and the whole path
// through answerVisitor with Supabase and the AI provider stubbed.

const msgs = (...texts) => texts.map((text, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text }));
const topTopics = (text, focusApp = null, n = 3) => selectTopics({ messages: msgs(text), focusApp }).slice(0, n).map((e) => e.topic.id);

// ---------------------------------------------------------------------------------------------
// The knowledge itself
// ---------------------------------------------------------------------------------------------

describe('knowledge', () => {
  test('apps and links are well formed and the client names the same apps as the server', () => {
    assert.deepEqual(FAMILY_APPS.map((a) => a.id), APP_IDS);
    assert.deepEqual(FAMILY_APPS.map((a) => a.name), APPS.map((a) => a.name));
    for (const app of APPS) assert.ok(app.url === null || /^https:\/\/[a-z0-9.-]+$/.test(app.url), `${app.id} url`);
    const urls = Object.values(LINKS).map((l) => l.url);
    assert.equal(new Set(urls).size, urls.length, 'duplicate link url');
    for (const [id, link] of Object.entries(LINKS)) {
      assert.match(link.url, /^https:\/\/(icanera\.space|supermartkera\.icanera\.space|bodagoera\.icanera\.space)(\/[A-Za-z0-9/_-]*)?$/, id);
      assert.ok(link.label.length > 3 && link.label.length <= 30, `${id} label`);
    }
    assert.equal(PLATFORM_SLUG, PRODUCT_OWNER_SLUG, 'the server and the app must recognise the same GODMINDERA address');
  });

  test('every topic is complete, short enough to be useful, and points only at vetted links', () => {
    const ids = new Set();
    for (const t of TOPICS) {
      assert.ok(!ids.has(t.id), `duplicate topic ${t.id}`);
      ids.add(t.id);
      assert.ok(t.app === null || APP_IDS.includes(t.app), `${t.id}: unknown app`);
      assert.ok(t.title && t.answer.length >= 40 && t.answer.length <= 1000, `${t.id}: answer length ${t.answer?.length}`);
      assert.ok(Array.isArray(t.keywords) && t.keywords.length >= 3, `${t.id}: needs keywords`);
      for (const k of t.keywords) assert.ok(k === k.toLowerCase() && k.trim().length >= 3, `${t.id}: bad keyword "${k}"`);
      for (const l of t.links || []) assert.ok(LINKS[l], `${t.id}: unknown link ${l}`);
      assert.ok((t.followUps || []).length <= 3 && (t.followUps || []).every((f) => f.length <= 40), `${t.id}: follow-ups`);
    }
    assert.ok(TOPICS.length >= 60, 'the knowledge base shrank');
    for (const app of APPS) assert.ok(TOPICS.some((t) => t.app === app.id && t.core), `${app.id} has no core topic`);
  });

  test('the always-on core stays small, so the prompt stays cheap', () => {
    const core = TOPICS.filter((t) => t.core).reduce((n, t) => n + topicText(t).length, 0);
    assert.ok(core <= 6000, `core is ${core} characters`);
  });

  test('nothing in the knowledge is a contact detail, a placeholder or a number the platform can change', () => {
    const all = TOPICS.map((t) => `${t.title} ${t.answer} ${t.facts || ''} ${t.followUps?.join(' ') || ''}`).join('\n');
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(all), 'an email address: contact details come from the live company facts');
    assert.ok(!/\+?256[\s-]?\d{2,3}[\s-]?\d{3}/.test(all) && !/\b0\d{9}\b/.test(all), 'a phone number');
    assert.ok(!/700 ?123 ?456|xxx|example\.com|yoursupermarket|\.ug\b/i.test(all), 'a placeholder contact detail');
    assert.ok(!/\b(8|7)\s?%\s+(platform|charge|convenience)/i.test(all) && !/platform charge[^.]*\b\d+(\.\d+)?\s?%/i.test(all), 'a hard-coded platform charge: it is read live');
    // Features the apps do not really have (or that are unfinished) must not be promised.
    assert.ok(!/\bstak(e|ing)\b/i.test(all), 'staking');
    assert.ok(!/cashback/i.test(all), 'cashback (removed from shop payments)');
    assert.ok(!/wishlist/i.test(all), 'wishlist');
    assert.ok(!/pay\.ican\.io/i.test(all), 'placeholder pay link');
  });

  test('the 3% fee on selling or cashing out coin is stated, and the stale "no hidden fees" is not repeated', () => {
    const fees = TOPICS.find((t) => t.id === 'icanera-fees');
    assert.match(fees.answer, /3%/);
    assert.match(TOPICS.find((t) => t.id === 'icanera-coin').answer, /3%/);
    assert.ok(!TOPICS.some((t) => /no hidden fees/i.test(t.answer)), 'the Sell screen wording must not be repeated');
  });
});

// ---------------------------------------------------------------------------------------------
// Retrieval: which knowledge a question reaches
// ---------------------------------------------------------------------------------------------

describe('retrieval', () => {
  const cases = [
    ['I forgot my PIN and my wallet is locked', 'icanera-pin-reset'],
    ['how do I set my wallet pin', 'icanera-pin-set'],
    ['What are the fees when I sell ican coin?', 'icanera-fees'],
    ['how do I top up my wallet with mtn mobile money', 'icanera-add-money'],
    ['I want to send money to a bank account', 'icanera-send'],
    ['can I pay in instalments', 'icanera-instalments'],
    ['how do I get a receipt for my payment', 'icanera-receipts'],
    ['what is my business website address', 'site-address'],
    ['how do my staff check in with a qr code', 'cmms-attendance'],
    ['how do I book a boda ride', 'boda-book'],
    ['how much does a ride cost', 'boda-fare'],
    ['how do I become a rider', 'boda-become-rider'],
    ['can I book a flight and get an air ticket', 'boda-journeys'],
    ['is there an sos button for emergencies', 'boda-track-safety'],
    ['how does a cashier take payment at the till', 'smk-till-pay'],
    ['how do I add a cashier to my supermarket', 'smk-cashier-access'],
    ['how do barcodes and expiry dates work in stock', 'smk-inventory'],
    ['can I order from two stores in one cart', 'smk-shop'],
    ['how do I tell suppliers what crops I have', 'agri-produce-offers'],
    ['I am a farmer how do I register my farm', 'agri-farmer'],
    ['how do I become a supplier on agribone', 'agri-supplier-specialist'],
    ['someone asked for my pin is this a scam', 'stay-safe'],
    ['I want to talk to a real person', 'getting-help'],
    ['which app should I use', 'which-app'],
    ['what is the agribone website link', 'agribone-address'],
  ];
  for (const [question, expected] of cases) {
    test(`"${question}" reaches ${expected}`, () => {
      const top = topTopics(question, null, 3);
      assert.ok(top.includes(expected), `top 3 were ${top.join(', ')}`);
    });
  }

  test('naming an app, or opening the chat from one, steers the knowledge to that app', () => {
    const named = selectTopics({ messages: msgs('how do I pay?'), focusApp: 'bodagoera' }).slice(0, 3).map((e) => e.topic.app);
    assert.ok(named.includes('bodagoera'), named.join());
    const byName = selectTopics({ messages: msgs('how do I pay in SupermartKera?') }).slice(0, 3).map((e) => e.topic.app);
    assert.ok(byName.includes('supermartkera'), byName.join());
  });

  test('a question nothing matches still gets the essentials of every app', () => {
    const picked = selectTopics({ messages: msgs('Nkozesa ntya yange?') });
    const apps = new Set(picked.map((e) => e.topic.app));
    for (const id of APP_IDS) assert.ok(apps.has(id), `${id} missing from the essentials`);
  });

  test('the knowledge shown stays within its budget, however much matches', () => {
    const picked = selectTopics({ messages: msgs('pin wallet fee pay send ride shop farmer supplier receipt qr business website') });
    const chars = picked.reduce((n, e) => n + topicText(e.topic).length, 0);
    assert.ok(chars <= 7500, `${chars} characters`);
  });

  test('only the last three visitor messages count', () => {
    const old = [{ role: 'user', text: 'how do I reset my pin' }, { role: 'assistant', text: 'ok' }, { role: 'user', text: 'thanks' }, { role: 'assistant', text: 'ok' }, { role: 'user', text: 'and also' }, { role: 'assistant', text: 'ok' }, { role: 'user', text: 'tell me about boda rides' }];
    assert.ok(!selectTopics({ messages: old }).slice(0, 3).some((e) => e.topic.id === 'icanera-pin-reset'));
  });
});

// ---------------------------------------------------------------------------------------------
// The model's output can only name vetted links and known apps
// ---------------------------------------------------------------------------------------------

describe('output validation', () => {
  test('link ids become vetted URLs; unknown ids, repeats and extras vanish', () => {
    const out = resolveLinks(['bodagoera', 'https://evil.example', 'bodagoera', 'coin', 'shop']);
    assert.deepEqual(out.map((l) => l.id), ['bodagoera', 'coin']);
    assert.ok(out.every((l) => /^https:\/\/(icanera\.space|bodagoera\.icanera\.space)/.test(l.url)));
    assert.deepEqual(resolveLinks('bodagoera'), []);
    assert.deepEqual(resolveLinks(null), []);
  });

  test('the app tag is one of the known apps or nothing', () => {
    const content = JSON.stringify({ reply: 'Open the Ride tab.', app: 'bodagoera', needs_human: false, links: ['bodagoera', 'nope'] });
    const parsed = JSON.parse(content);
    const base = sanitizeAiOutput(content, ['home']);
    const ok = sanitizePlatformOutput(base, parsed);
    assert.equal(ok.app, 'bodagoera');
    assert.deepEqual(ok.links.map((l) => l.url), ['https://bodagoera.icanera.space']);
    assert.equal(sanitizePlatformOutput(base, { ...parsed, app: 'hacker' }).app, null);
    assert.equal(sanitizePlatformOutput(null, parsed), null);
  });

  test('the request hint is checked against the known apps', () => {
    assert.equal(parseFocusApp('BodaGoEra'), 'bodagoera');
    assert.equal(parseFocusApp('<script>'), null);
    assert.equal(parseFocusApp(undefined), null);
    const body = { companyId: '7a61ac98-f8c6-49b5-b75d-da194669d471', messages: [{ role: 'user', text: 'hi' }] };
    assert.equal(parseRequest({ ...body, app: 'agribone' }).focusApp, 'agribone');
    assert.equal(parseRequest({ ...body, app: 'x' }).focusApp, null);
    assert.equal(parseRequest(body).focusApp, null);
  });

  test('?ask on the GODMINDERA site opens the chat, ?ask=<app> opens it about that app', () => {
    assert.deepEqual(parseAskParam('?ask=bodagoera'), { open: true, app: 'bodagoera' });
    assert.deepEqual(parseAskParam('?ask'), { open: true, app: null });
    assert.deepEqual(parseAskParam('?ask=nonsense'), { open: true, app: null });
    assert.equal(parseAskParam('?tab=shop'), null);
    assert.equal(parseAskParam(''), null);
  });
});

// ---------------------------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------------------------

describe('prompt', () => {
  const live = { priceUgx: 5819.63, priceUsd: 1.383295, rideChargePct: 8 };
  const prompt = (text = 'I forgot my PIN', focusApp = null) => buildPlatformPrompt({
    businessFacts: 'Business name: GODMINDERA ORGANISATION (U) LTD', topics: selectTopics({ messages: msgs(text), focusApp }), live, tabs: ['home', 'pay'], focusApp,
  });

  test('carries the safety rules, the app directory, the allowed links and the live data', () => {
    const p = prompt();
    assert.match(p, /never ask for, accept or repeat a PIN/i);
    assert.match(p, /No investment, legal or medical advice/);
    for (const app of APPS) assert.ok(p.includes(app.name), app.name);
    for (const id of Object.keys(LINKS)) assert.ok(p.includes(`- ${id}:`), `link ${id} missing`);
    assert.match(p, /LIVE DATA[^\n]*UGX 5,819\.63/);
    assert.match(p, /platform charge is currently 8%/);
    assert.match(p, /COMPANY FACTS/);
    assert.match(p, /icanera-pin-reset|Forgot PIN or wallet locked/);
  });

  test('says which app the chat was opened from', () => {
    assert.match(prompt('how do I pay', 'bodagoera'), /opened this chat from the BodaGoEra app/);
    assert.ok(!/opened this chat from/.test(prompt()));
  });

  test('stays a sensible size', () => {
    const p = prompt('pin wallet fee pay send ride shop farmer supplier receipt qr business website');
    assert.ok(p.length < 16000, `${p.length} characters`);
  });

  test('live data lines only say what could be read', () => {
    assert.equal(liveDataLine(null), '');
    assert.match(liveDataLine({ priceUgx: 6000 }), /UGX 6,000/);
    assert.ok(!/platform charge/.test(liveDataLine({ priceUgx: 6000, rideChargePct: null })));
    assert.match(liveDataLine({ priceUgx: null, rideChargePct: 0 }), /currently 0%/);
  });

  test('the ordinary assistant prompt is untouched', () => {
    const ordinary = buildSystemPrompt({ company: { company_name: 'Kampala Mart' }, jobs: [], news: [], products: [], payOnline: false }, ['home', 'pay']);
    assert.ok(!/IcanEra family|BodaGoEra/.test(ordinary));
    assert.match(ordinary, /Answer ONLY from the BUSINESS FACTS/);
  });
});

// ---------------------------------------------------------------------------------------------
// The rule-based fallback (no AI key, or the provider is down)
// ---------------------------------------------------------------------------------------------

describe('fallback', () => {
  const ask = (text, focusApp = null, live = { priceUgx: 5819.63, priceUsd: 1.383295, rideChargePct: 8 }) =>
    platformFallback({ messages: msgs(text), focusApp, live, businessFacts: '', tabs: ['home', 'pay'] });

  test('answers a real question from the knowledge, with the app and a vetted link', () => {
    const r = ask('how do I book a boda ride');
    assert.equal(r.app, 'bodagoera');
    assert.match(r.reply, /Find Available Riders|Book a Ride/);
    assert.ok(r.links.every((l) => /^https:\/\//.test(l.url)));
  });

  test('quotes the live coin price without predicting it', () => {
    const r = ask('what is the icaneracoin price today?');
    assert.match(r.reply, /UGX 5,819\.63/);
    assert.match(r.reply, /can't predict/);
    assert.equal(r.app, 'icanera');
    assert.deepEqual(r.links.map((l) => l.id), ['coin']);
  });

  test('a locked wallet gets the safe steps and the team, never a request for the PIN', () => {
    const r = ask('my wallet is locked and I forgot my pin');
    assert.match(r.reply, /Forgot your PIN/);
    assert.equal(r.needsHuman, true);
    assert.ok(!/(please )?(send|share|give|provide) (me |us )?your pin/i.test(r.reply.replace(/never (send|share|give|provide)[^.]*/gi, '')), 'it must never ask for the PIN');
  });

  test('account-specific trouble goes to a person', () => {
    for (const q of ['my money is missing', 'I was charged twice', 'I want to talk to a human', 'someone hacked my account']) {
      assert.equal(ask(q).needsHuman, true, q);
    }
  });

  test('a question it cannot place asks which app, offering the family', () => {
    const r = ask('zzzz qqqq');
    assert.match(r.reply, /Which one is your question about/);
    assert.ok(r.suggestions.length > 0);
    for (const app of APPS) assert.ok(r.reply.includes(app.name));
  });

  test('AgriBone has no public address to give: it says so and offers the team', () => {
    const r = ask('what is the agribone website link');
    assert.match(r.reply, /do not have AgriBone/i);
    assert.equal(r.needsHuman, true);
    assert.deepEqual(r.links, []);
  });
});

// ---------------------------------------------------------------------------------------------
// Through answerVisitor: Supabase and the AI provider stubbed
// ---------------------------------------------------------------------------------------------

describe('the whole path', () => {
  const GODMINDERA = '7a61ac98-f8c6-49b5-b75d-da194669d471';
  const IMPOSTOR = '11111111-2222-3333-4444-555555555555';
  const SUPABASE = { url: 'https://stub.supabase.test', anonKey: 'anon-stub' };
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  let realFetch;
  let realKey;
  let providerCalls;
  let providerReply;
  let slugFor;
  let failSlugRpc;

  const header = (id) => [{ id, company_name: 'GODMINDERA ORGANISATION (U) LTD', tagline: 'Science is a mind of GOD', phone: '+256000000000', email: 'team@example.test', about: 'The company behind IcanEra.' }];

  before(() => {
    realFetch = globalThis.fetch;
    realKey = process.env.OPENAI_API_KEY;
    globalThis.fetch = async (input, init = {}) => {
      const target = String(input);
      const body = init.body ? JSON.parse(init.body) : {};
      if (target === 'https://api.openai.com/v1/chat/completions') {
        providerCalls.push(body);
        if (providerReply === 'DOWN') return json({ error: { message: 'outage' } }, 500);
        return json({ choices: [{ message: { content: providerReply } }] });
      }
      if (target.endsWith('/rpc/fn_get_public_cmms_company_header')) return json(header(body.p_company_id));
      if (target.endsWith('/rpc/fn_get_public_cmms_notices')) return json([]);
      if (target.endsWith('/rpc/get_cmms_site_products')) return json({ store_products: [] });
      if (target.endsWith('/rpc/public_tx_paycode_info_by_business')) return json({ found: false });
      if (target.endsWith('/rpc/fn_get_public_site_slugs')) {
        if (failSlugRpc) return json(null, 404);
        const slug = slugFor[body.p_company_ids[0]];
        return json(slug ? [{ company_id: body.p_company_ids[0], site_slug: slug }] : []);
      }
      if (target.endsWith('/rpc/ican_get_market_snapshot')) return json([{ price_ugx: '5819.63', price_usd: '1.383295' }]);
      if (target.includes('/rest/v1/mbg_platform_settings')) return json([{ value: '8.0' }]);
      return json(null, 404);
    };
    process.env.OPENAI_API_KEY = 'sk-test';
  });
  after(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = realKey;
  });

  const setup = (reply) => {
    providerCalls = [];
    providerReply = reply;
    failSlugRpc = false;
    slugFor = { [GODMINDERA]: PLATFORM_SLUG, [IMPOSTOR]: `${PLATFORM_SLUG}-2` };
  };
  // each company id is cached for a minute by loadKnowledge, so every test uses its own question and fresh ids where it matters
  const run = (companyId, text, focusApp = null) => answerVisitor({ supabase: SUPABASE, companyId, messages: msgs(text), focusApp });

  test('on the GODMINDERA site the AI gets the family knowledge and live data, and its answer is mapped to vetted links', async () => {
    setup(JSON.stringify({ reply: 'Open the Ride tab and choose a rider.', app: 'bodagoera', needs_human: false, suggestions: ['What does it cost?'], links: ['bodagoera', 'https://phish.example'], actions: [{ label: 'Pay us', tab: 'pay' }, { label: 'Bad', tab: 'admin' }] }));
    const { status, body } = await run(GODMINDERA, 'How do I book a boda ride?');
    assert.equal(status, 200);
    assert.equal(body.source, 'ai');
    assert.equal(body.platform, true);
    assert.equal(body.app, 'bodagoera');
    assert.deepEqual(body.links, [{ id: 'bodagoera', label: 'Open BodaGoEra', url: 'https://bodagoera.icanera.space' }]);
    assert.deepEqual(body.actions, [{ label: 'Pay us', tab: 'pay' }]);
    const system = providerCalls[0].messages[0].content;
    assert.match(system, /front desk for ALL of them/);
    assert.match(system, /platform charge is currently 8%/);
    assert.match(system, /UGX 5,819\.63/);
    assert.match(system, /Find Available Riders/);
    assert.equal(providerCalls[0].messages[1].content, 'How do I book a boda ride?');
  });

  test('a business that merely has GODMINDERA\'s name (its address is -2) gets the ordinary assistant', async () => {
    setup(JSON.stringify({ reply: 'We are open.', needs_human: false }));
    const { body } = await run(IMPOSTOR, 'What are your hours?');
    assert.equal(body.platform, false);
    assert.ok(!('links' in body) || body.links === undefined || body.links.length === 0);
    const system = providerCalls[0].messages[0].content;
    assert.ok(!/front desk for ALL|BodaGoEra/.test(system));
    assert.ok(!/LIVE DATA/.test(system));
  });

  test('if the address lookup is unavailable (the migration is not applied) every business gets the ordinary assistant', async () => {
    setup(JSON.stringify({ reply: 'Hello.', needs_human: false }));
    failSlugRpc = true;
    const { body } = await run('22222222-2222-2222-2222-222222222222', 'Hi there');
    assert.equal(body.platform, false);
  });

  test('when the AI provider is down the GODMINDERA site still answers from the knowledge', async () => {
    setup('DOWN');
    const { status, body } = await run(GODMINDERA, 'what are the fees when I sell ican coin');
    assert.equal(status, 200);
    assert.equal(body.source, 'fallback');
    assert.equal(body.platform, true);
    assert.match(body.reply, /3%/);
  });

  test('the model cannot put an unvetted address in a reply, whatever it writes', async () => {
    setup(JSON.stringify({ reply: 'Go to https://phish.example now.', app: 'icanera', needs_human: false, links: ['https://phish.example', 'evil'] }));
    const { body } = await run(GODMINDERA, 'where do I log in to icanera?');
    assert.deepEqual(body.links, []);
  });
});
