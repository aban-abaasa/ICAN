// A small stand-in for Supabase's HTTP layer, for the end-to-end test ONLY. It maps the few REST and auth calls the app makes onto a
// real Postgres that has the real migrations applied, with PostgREST's semantics where they matter:
//   POST /rest/v1/rpc/<fn>   runs public.<fn>(named args) as the role the bearer token carries (anon / authenticated with
//                            request.jwt.claim.sub / service_role), inside one transaction, exactly like PostgREST
//   GET  /rest/v1/<table>    a few tables, simple eq filters, read as the database owner (the test seeds only what it needs)
//   GET  /auth/v1/user       the user a seeded session token names
//   POST /api/chain-link     the real serverless handler (frontend/api/chain-link.js), called with a minimal req/res
// Tokens are unsigned and trusted: this is a test double, never to be pointed at anything real.

import http from 'node:http';
import os from 'node:os';
import pg from 'pg';

const CORS = {
  'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*',
};

const decode = (token) => {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
};

export const makeToken = (sub) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'none', typ: 'JWT' })}.${b({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`;
};

export const startShim = async ({ database, port = 54321, serviceKey, anonKey, chainLinkHandler }) => {
  // the local socket as the current OS user, like psql does (a bare connection string would try TCP with no user name)
  const pool = new pg.Pool({ database, user: process.env.PGUSER || os.userInfo().username, host: process.env.PGHOST || '/var/run/postgresql', port: Number(process.env.PGPORT) || 5432, max: 8 });

  const roleOf = (authHeader) => {
    const token = /^Bearer\s+(.+)$/i.exec(authHeader || '')?.[1];
    if (!token || token === anonKey) return { role: 'anon', sub: '' };
    if (token === serviceKey) return { role: 'service_role', sub: '' };
    const c = decode(token);
    return c.sub ? { role: 'authenticated', sub: c.sub } : { role: 'anon', sub: '' };
  };

  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...CORS, ...extra });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');

    try {
      // ---- the real serverless function, for wallet linking
      if (url.pathname === '/api/chain-link') {
        const fakeRes = {
          code: 200, status(c) { this.code = c; return this; },
          json(b) { send(res, this.code, b); return this; },
        };
        return chainLinkHandler({ method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : {} }, fakeRes);
      }

      // ---- auth
      if (url.pathname === '/auth/v1/user') {
        const { sub } = roleOf(req.headers.authorization);
        if (!sub) return send(res, 401, { message: 'invalid token' });
        return send(res, 200, { id: sub, aud: 'authenticated', role: 'authenticated', email: 'e2e@test.dev', app_metadata: {}, user_metadata: { full_name: 'E2E Visitor' } });
      }
      if (url.pathname.startsWith('/auth/v1')) return send(res, 200, { user: null, session: null });

      // ---- rpc
      const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
      if (rpc && req.method === 'POST') {
        const fn = rpc[1];
        const args = raw ? JSON.parse(raw) : {};
        const { role, sub } = roleOf(req.headers.authorization);
        const names = Object.keys(args);
        const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
        const values = names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n] === null ? null : String(args[n])));
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [sub, role]);
          await client.query(`SET LOCAL ROLE ${role}`);
          const r = await client.query(`SELECT ${call} AS r`, values);
          await client.query('COMMIT');
          const out = r.rows[0]?.r;
          return send(res, 200, out === '' || out === undefined ? null : out);
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          if (e.code === '42883') return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}`, details: e.message });
          if (e.code === '42501') return send(res, 403, { code: e.code, message: e.message });
          return send(res, 400, { code: e.code, message: e.message });
        } finally { client.release(); }
      }

      // ---- a few tables
      const table = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(url.pathname);
      if (table && req.method === 'GET') {
        const t = table[1];
        if (!['ican_user_wallets', 'wallet_accounts'].includes(t)) return send(res, 200, []);
        const where = [];
        const vals = [];
        for (const [k, v] of url.searchParams) {
          const m = /^eq\.(.*)$/.exec(v);
          if (m && /^[a-z_]+$/.test(k)) { vals.push(m[1]); where.push(`${k}::text = $${vals.length}`); }
        }
        const r = await pool.query(`SELECT * FROM public.${t}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} LIMIT 50`, vals);
        if (/vnd\.pgrst\.object/.test(String(req.headers.accept))) {
          return r.rows.length === 1 ? send(res, 200, r.rows[0]) : send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${r.rows.length} rows` });
        }
        return send(res, 200, r.rows);
      }
      return send(res, 200, []);          // anything else the app asks for: an empty answer
    } catch (e) {
      return send(res, 500, { message: String(e?.message || e) });
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { close: () => new Promise((resolve) => { server.close(resolve); pool.end(); }), pool };
};
