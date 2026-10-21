# Business website addresses: `icanera.space/<business-name>`

A business's public website used to be `icanera.space/notices/<long-id>`. It is now
`icanera.space/<business-name>`, for example:

    https://icanera.space/godmindera-organisation-u-ltd

The old `/notices/<id>` links keep working, and move the address bar to the new address once they open.

## Turn it on (one step)

1. Supabase → SQL editor → paste **`BUSINESS_SITE_SLUGS_PASTE_INTO_SUPABASE.sql`** → Run.
   (Same file as `supabase/migrations/20261105100000_business_site_slugs.sql`. Safe to run twice.)

The website code is deployed as usual. **Until the SQL has run, nothing breaks**: every link simply stays `icanera.space/notices/<id>`.

Check it worked:

```sql
select company_name, site_slug from public.cmms_company_profiles order by company_name;
```

## How an address is decided

| Rule | Why |
|---|---|
| Made from the business name: `Café & Bar (U) Ltd` → `cafe-and-bar-u-ltd`. 3 to 60 characters, `a-z 0-9` and single hyphens. | Readable, safe in any link |
| **One business per address.** Same name twice → the oldest keeps `kampala-mart`, the next is `kampala-mart-2`, then `-3`. | Today 43 companies share 32 names (e.g. 5 × "God is Good Supermarket"), so this matters |
| GODMINDERA ORGANISATION (U) LTD (the platform fee business) always gets the plain name. | The "A product of GODMINDERA…" credit links to it |
| Never an app page (`/pricing`, `/shop`, `/notices`, `/pay`, …) or a brand name (`icanera`, `godmindera`, `supermartkera`, `bodagoera`). | A business can't hide a page of the app or pose as IcanEra |
| Made **once**; renaming the business does not change it. | Links already printed on receipts and QR codes stay true |
| A company admin can choose another one (Company Profile → *Your website address* → Change). The old address keeps opening the same site and, for search engines, redirects to the new one. | No printed link ever dies |

## Where the new address shows up

Receipt QR codes, the standing pay QR (`?pay=1`), shared notices / jobs / opportunities / pitches, the landing-page business directory,
the "use my notice board as website" link, the website's own canonical address, link previews (WhatsApp etc.), search-engine
structured data and `sitemap.xml`.

The footer credit **"A product of GODMINDERA ORGANISATION (U) LTD"** (landing page, business websites, reports, portfolios, emails,
printable pages) now links to `icanera.space/godmindera-organisation-u-ltd`.

## One thing to decide: the company called "ICANERA"

`icanera` is a brand name, so customers can't take it. The existing company named **ICANERA** therefore gets `icanera-business`.
To give it `icanera.space/icanera` instead, run this once as the platform operator (the SQL editor has no signed-in user, which is what
allows a brand name):

```sql
update public.cmms_company_profiles set site_slug = 'icanera' where company_name = 'ICANERA';
```

## Undo

`supabase/rollback/20261105_rollback_business_site_slugs.sql` removes the feature and leaves every company untouched
(addresses a business chose for itself are lost; links fall back to `/notices/<id>`).

## Tests

* `supabase/tests/business_site_slugs/run.sh` — builds a throwaway Postgres, runs the real migration, 60+ checks
  (duplicates, reserved words, renames, retired addresses, access, idempotence, rollback).
* `cd frontend && npm test` — `businessSiteUrl.test.js` (also checks the reserved list matches the database and `vercel.json`, and that
  every page `main.jsx` / `App.jsx` serves is reserved) and `sharePreviewSite.test.js` (the server page for a business address).
