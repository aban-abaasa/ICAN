# Era API: deploy notes

One public, key-based, **read-only** API for the whole ICANERA family (ICANERA, BodaGoEra, SupermarketEra,
FarmAgentEra), plus one page for outside developers. All four apps share one Supabase project, so one key, one
registry and one set of limits serve all of them. This adds:

- **`/developers`**, a single self-contained page: a live sandbox playground (no sign-up), an instant key, three
  working recipes, and reference docs generated from the live registry
  (`frontend/public/developers/index.html`)
- **`/api/v1/*`**, the API itself, served by a thin Vercel function in every app (`frontend/api/v1/[...path].js`)
- an **API tab** in all four developer panels: approve developers, see usage, switch endpoints off
  (`frontend/public/developers/admin.js`, mounted by a small wrapper in each app)
- the database layer behind all of it (`supabase/migrations/20261005100000_era_api.sql` and
  `..100100_era_api_endpoints.sql`)

Merging the code is safe on its own. Until the migrations are applied the developer page shows its built-in
reference with a banner saying the API is "not switched on yet", `/api/v1/ping` says `not_installed`, the dev panel
tab says the same, and nothing else changes. **Nothing has been applied to your Supabase project yet.**

## 1. Apply the database layer (Supabase SQL editor, once)

Run these two files, in this order. Both are additive and safe to run twice.

1. `supabase/migrations/20261005100000_era_api.sql`: tables, key handling, limits, sandbox, the sign-up flow, the admin functions
2. `supabase/migrations/20261005100100_era_api_endpoints.sql`: the 20 endpoint handlers and their registry rows

Re-running the second file refreshes descriptions but keeps any endpoint switch or cache time an administrator set.
Rollback: `supabase/rollback/20261005_rollback_era_api.sql` (deletes every registered app, key and the call log; to
pause without losing anything use the master switch in the API tab).

## 2. Who can administer it

Nobody new needs adding if you already have a platform developer or a franchise admin: both count as API admins
automatically. Anyone else is added once, in the SQL editor:

```sql
INSERT INTO public.era_api_admins (user_id, note)
SELECT id, 'founder' FROM auth.users WHERE lower(email) = lower('YOUR-EMAIL');
```

Like the franchise tab, the API tab needs a **real signed-in account**, not the developer panel PIN (the PIN ships in
the public app). It shows a sign-in box if the browser has none. The tab is hidden from scoped support links, and in
BodaGoEra and Supermartkera it is for main developers only.

## 3. Environment (each of the four Vercel projects)

The gateway needs `SUPABASE_URL` (or the `VITE_SUPABASE_URL` you already have) and **one** of
`SUPABASE_SERVICE_ROLE_KEY` (preferred) or `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY`. If the app already builds
on Vercel it almost certainly has these. Optional: `ERA_API_IP_SALT` (any long random string) to make the daily
caller hash unguessable.

## 4. Check it

```bash
curl https://icanera.space/api/v1/ping            # {"ok":true,"state":"ready",...}
curl https://icanera.space/api/v1/whoami -H "Authorization: Bearer era_test_9a8d0e2b7f4c1a63d5e8b0f2c47a91d3e6b85f0c"
```

Then open `/developers/`, press Send, and watch the planets light up. (In `vite dev` use `/developers/` with the
trailing slash.)

## How a developer gets access

1. **Register** on the page (no account): app name, email, which apps. They instantly get a **sandbox key**
   (fixture data, 30 requests a minute, 1000 a day) and a **ticket**, both shown once.
2. **You review** it in the API tab, **Requests**: tick the apps to approve, set limits (default 60 a minute,
   5000 a day), approve or reject.
3. The developer returns to the page, pastes their ticket, and reveals a **live key** once, scoped to exactly the apps you
   approved. They can rotate either key themselves; the old one dies at once.

Keys are stored only as SHA-256 hashes. The ticket is the developer's only credential, so it travels in a request body and
never a URL. A live key can be revoked, an app suspended, an endpoint switched off, or the whole API paused, all from the tab.

## What the API exposes, and what it never will

Read-only (`GET` only). Everything below is either already public in the apps or an aggregate.

| App | Endpoints |
|---|---|
| Platform | `/whoami`, `/pulse` (a snapshot across every app the key is approved for) |
| ICANERA | `/icanera/coin/price`, `/coin/candles`, `/fx/rates`, `/countries`, `/tax/{country}`, `/businesses` (the public directory) |
| BodaGoEra | `/bodagoera/stages`, `/districts`, `/ports`, `/fare/estimate`, `/riders/verify` |
| SupermarketEra | `/supermarketera/stores`, `/catalog`, `/barcode/{code}`, `/categories` |
| FarmAgentEra | `/farmagentera/listings`, `/price-board`, `/crops` |

Never exposed, and covered by automated tests: wallets, balances, transactions, messages; phone numbers, emails,
addresses or owners of stores, sellers and riders (the rider check returns no phone, licence or fee data); supplier cost prices,
stock levels and supplier identities; the franchise and fee data; anything that moves money.

## Things to check or decide

1. **Which data you are comfortable publishing.** The supplier **catalogue** shows wholesale prices
   (`price_per_unit`), and **stores** and **listings** are public. Each endpoint has its own switch in the API tab,
   Endpoints. Switch off anything you would rather not publish yet; it disappears from the docs and answers 503.
2. **Live limits.** Defaults are 60 a minute and 5000 a day per approved app. Change them when approving.
3. **The published playground key** (`era_test_9a8d...f0c`) is in the page on purpose. It only ever returns fixtures and is limited
   per visitor (20 a minute). If it is ever abused, switch the sandbox off in the API tab, or replace the key by updating
   `key_hash` of the `Public playground` row.
4. **The public database functions can be called directly with the anon key**, so a determined person could skip the gateway
   and supply a fake caller hash to dodge the per-caller limits (per-email and global limits still apply). If you set
   `SUPABASE_SERVICE_ROLE_KEY` in all four Vercel projects you can close that, because everything then goes through the gateway:

   ```sql
   REVOKE EXECUTE ON FUNCTION
     public.era_api_request_access(text, text, text, text, text, text[], text, text),
     public.era_api_ticket_status(text),
     public.era_api_issue_key(text, text),
     public.era_api_call(text, text, text, jsonb, text)
   FROM anon, authenticated;
   ```

   (To undo it, re-run `20261005100000_era_api.sql`.) The catalogue and ping stay public either way.
5. **No CAPTCHA** on registration. It is validated, has a hidden spam trap and is limited (3 per email a day, 8 per caller a day,
   100 an hour overall), but a determined person could use up the hourly 100. Add a CAPTCHA or an edge rate limit if that happens.
6. **Browser caching.** Answers are cacheable for the endpoint's cache time and vary by key, so an approved developer's browser may serve a
   cached answer for up to that long after you revoke or switch something off.
7. **Not built yet, on purpose:** write endpoints, webhooks, per-endpoint key scopes, usage billing, an email on approval (developers
   check back with their ticket). The service workers in all four apps were told to leave `/api/v1/*` and `/developers/*` alone.

## Tests

```bash
supabase/tests/era_api/run.sh            # 139 database checks against a throwaway Postgres (see the script header)
npm test --prefix frontend               # in ICAN, includes the 25 gateway tests
npm run test:era-api --prefix frontend   # in the other three repos
node scripts/sync-era-api.mjs --check    # the shared files are identical in all four repos
```

The database tests apply both migrations twice, then cover keys (hashed, shown once, rotated, revoked), sandbox vs live, scopes,
per-minute and daily limits, the sign-up flow and its abuse limits, every admin action, sealed tables and grants, injection
attempts, every endpoint against realistic rows, **what must never leak**, a smoke call of every documented example in both modes,
a registry-vs-page snapshot check, and that the rollback leaves nothing behind.

## Keeping the four apps in sync

ICAN is the source of truth for the shared files (page, console, gateway, tests, catalogue snapshot). After changing one,
run `node scripts/sync-era-api.mjs` to copy it to the sibling repos (`--check` verifies). The dev-panel wiring and `vercel.json`
differ per app and are not synced.

## Adding an endpoint

1. In a new migration, write `public.era_h_<app>_<name>(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB` (return fixtures when
   `p_sandbox`; raise `22023` for bad input, `P0002` for not found) and add a row to `era_api_endpoints`. Copy any
   existing handler; they show the helpers for paging, numbers and safe `LIKE`.
2. Add a privacy assertion for it to `supabase/tests/era_api/02_endpoints.sql`.
3. Run `UPDATE_CATALOG=1 supabase/tests/era_api/run.sh`, then `node scripts/sync-era-api.mjs`.
