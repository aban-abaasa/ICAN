import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.OPENAI_API_KEY = 'test-key';
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;

const { default: aiAnalysis } = await import('../api/ai-analysis.js');

const realFetch = globalThis.fetch;
let aiReply = '{}';
let aiCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) {
    const token = String(init.headers?.Authorization || '').replace('Bearer ', '');
    return token.startsWith('good-') ? new Response(JSON.stringify({ id: token }), { status: 200 }) : new Response('{}', { status: 401 });
  }
  if (u.includes('api.openai.com')) {
    aiCalls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: aiReply } }] }), { status: 200 });
  }
  throw new Error(`unexpected fetch ${u}`);
};
test.after(() => { globalThis.fetch = realFetch; });

const call = async ({ method = 'POST', token = 'good-user-1', body }) => {
  const res = { headers: {}, code: 0, payload: undefined };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.code = c; return res; };
  res.json = (p) => { res.payload = p; return res; };
  res.end = () => res;
  await aiAnalysis({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
  return res;
};

const text = 'I studied accounting at Makerere and graduated in 2018. Since 2019 I have been a stock controller at Nile Breweries.';

test('rejects requests without a valid session', async () => {
  assert.equal((await call({ token: null, body: { task: 'profile-from-conversation', target: 'resume', text } })).code, 401);
  assert.equal((await call({ token: 'bad', body: { task: 'profile-from-conversation', target: 'resume', text } })).code, 401);
});

test('validates target and text', async () => {
  assert.equal((await call({ body: { task: 'profile-from-conversation', target: 'cv', text } })).code, 400);
  assert.equal((await call({ body: { task: 'profile-from-conversation', target: 'resume', text: 'hi' } })).code, 400);
  assert.equal((await call({ body: { task: 'profile-from-conversation', target: 'resume', text: 'x'.repeat(50000) } })).code, 413);
});

test('returns a sanitised resume and keeps the conversation as data', async () => {
  aiCalls = [];
  aiReply = JSON.stringify({
    headline: 'Stock controller',
    summary: '<script>alert(1)</script> Careful and fast.',
    skills: ['Excel'],
    links: [{ label: 'x', url: 'javascript:alert(1)' }],
    items: [{ itemType: 'experience', title: 'Stock controller', orgName: 'Nile Breweries', startDate: '2019', endDate: '' }],
  });
  const res = await call({ body: { task: 'profile-from-conversation', target: 'resume', text, subject: 'Aban' } });
  assert.equal(res.code, 200);
  assert.equal(res.payload.target, 'resume');
  assert.deepEqual(res.payload.result.links, []);
  assert.equal(res.payload.result.items[0].startDate, '2019-01-01');
  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].response_format.type, 'json_object');
  assert.match(aiCalls[0].messages[1].content, /<conversation>/);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
});

test('reports an empty reading and an unusable reply plainly', async () => {
  aiReply = '{}';
  assert.equal((await call({ body: { task: 'profile-from-conversation', target: 'business', text } })).code, 422);
  aiReply = 'I cannot help with that';
  assert.equal((await call({ body: { task: 'profile-from-conversation', target: 'business', text } })).code, 502);
});

test('limits how often one person can read', async () => {
  aiReply = JSON.stringify({ headline: 'Stock controller' });
  let last;
  for (let i = 0; i < 9; i += 1) last = await call({ token: 'good-burst', body: { task: 'profile-from-conversation', target: 'resume', text } });
  assert.equal(last.code, 429);
  assert.equal((await call({ token: 'good-someone-else', body: { task: 'profile-from-conversation', target: 'resume', text } })).code, 200);
});

test('the chat proxy still works as before and answers preflight', async () => {
  aiReply = 'Hello';
  const chat = await call({ token: null, body: { messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(chat.code, 200);
  assert.equal(chat.payload.choices[0].message.content, 'Hello');
  const preflight = await call({ method: 'OPTIONS', token: null, body: undefined });
  assert.equal(preflight.code, 204);
  assert.equal((await call({ method: 'GET', token: null })).code, 405);
});
