# Franchise program: deploy notes

Registered companies in any country can become IcanEra partners and share the platform fees from
IcanEra, SupermarketEra and BodaGoEra. This adds:

- a **Franchise** tab on the landing page, where anyone can request a franchise (no account needed)
- a **Franchise** tab in the developer panel: requests, partners, company verification, countries and rates, payouts
- a **Franchise** entry in the app menu: the partner console, and "my agency" for any business owner
- the database layer behind all three (`supabase/migrations/20261004100000_franchise_layer.sql`)

Merging the code is safe on its own. Until the migration is applied, the landing page says "Franchise requests
open soon", the developer tab says "not switched on for this server yet", and nothing else changes.

## 1. Apply the migration (Supabase SQL editor)

`supabase/migrations/20261004100000_franchise_layer.sql`

Additive and safe to run twice. It needs `ican_business_wallet_settlements`, which
`backend/ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql` already creates. If that table is missing the migration
says so and skips the one trigger; apply it, then run this file again.

Rollback: `supabase/rollback/20261004_rollback_franchise_layer.sql`. It deletes the franchise tables, so export
anything owed first. To pause the program without losing anything, switch it off in Countries & rates.

Optional: with `pg_cron` enabled the migration schedules a daily agency-tier refresh. Without it, use the
"Recalculate agency tiers now" button now and then.

## 2. Add yourself as the first franchise admin

The developer panel's own login is a PIN that ships inside the public app, so it cannot guard approvals or
payouts. Franchise administration needs a real signed-in account that is a platform developer
(`mbg_users.role_type = 'developer'`) or is on the franchise admin list. Add the first one once, in the SQL editor:

```sql
INSERT INTO public.ican_franchise_admins (user_id, note)
SELECT id, 'founder' FROM auth.users WHERE lower(email) = lower('YOUR-EMAIL');
```

Then open the developer panel, Franchise tab, and sign in with that account. More admins can be added from
Countries & rates, Franchise admins.

## 3. First look

- **Countries & rates:** every country the app supports at sign-up is open from day one. Nothing needs opening;
  configure a country only to set a tier, reserve it for a signed partner, pause it, or add a note.
- **Rate card:** seeded with 40/20/40 (agency under a master, silver), 40/15/45 (gold), 40/10/50 (platinum),
  40/60 (master direct), 60/40 to 50/50 (agency under HQ), 80/20 (referral), 30/70 (BodaGoEra operator), 30/20/50
  (SupermarketEra marketplace). Edit anything; each row must add up to 100.
- **Health, "Share missed fees":** picks up fees credited before the migration was applied.

## How the money works

- HQ is paid exactly as today. Every platform fee still lands in the HQ platform-fee wallet in full.
- Partner shares are recorded as amounts owed. Nothing here moves wallet money.
- Payouts: **Payouts, Create statements**, approve, send the money yourself (wallet or bank), then **Mark as paid**
  with the transfer reference. A reference can be used once. Automated wallet disbursement is deliberately not
  built yet; it should be added only after it has been tested against your real wallet tables.
- A fee that is reversed (for example a failed payout) is cancelled for partners too. If the partner was already
  paid, a deduction appears on their next statement.
- **Wallet and asset fees (selling ICAN, payouts) are never shared.** That is the regulated side. Sharing them takes
  both a rule and the switch in Program settings, and should wait for legal advice.

## Rules the system enforces

- Partners must be **registered companies**: legal name, registration number and country, checked by HQ. A
  partner cannot go live until the company registration and the owners (KYC) are both verified.
- One live seat per registered company, per type, per country.
- A partner earns only on the products it is licensed for, and only while Active.
- Customers choose their own agency (by code or link) and can leave at any time. If a partner is terminated, its
  customers are moved to a successor or fall back to the country master / HQ.

## Things to check or decide

1. **Rides are attributed by profile country.** BodaGoEra fees find their country from the rider's or customer's
   `mbg_user_profiles.country`. That column defaults to `Uganda`, so accounts created before country was captured
   at sign-up count as Uganda. Worth a look before a non-Ugandan operator goes live.
2. **Public headline.** The landing page says agencies earn "up to X%". X is the highest agency share in the live
   rate card, so it follows your edits. To stop publishing a number, remove that sentence in
   `frontend/src/components/landing/FranchiseSection.jsx`.
3. **Referral partners must also be registered companies.** The rule applies to all three partner types.
4. **The request form is open to the public.** It is validated and rate limited (3 per email per day, 100 per hour
   overall, plus a hidden spam trap), but a determined person could still use up the hourly limit. Add a CAPTCHA or
   an edge rate limit if that happens.
5. **Not automated yet:** charging the upfront fee, enforcing the minimum annual royalty (it is tracked and shown),
   and wallet payouts.
6. **Existing security finding, not changed here:** the developer panel PIN (`dev_ICAN_Pr0_KV25`) is committed in
   the repo and in the public app, and several older dev functions accept it from anyone. Worth rotating and
   moving those functions to a real signed-in check, as the franchise functions do.

## Tests

```bash
npm test --prefix frontend                  # unit tests, including a guard that keeps the database country list
                                            # identical to frontend/src/constants/countries.js
supabase/tests/franchise/run.sh             # database tests against a throwaway Postgres (see the script header)
```

The database tests load your real fee functions from `backend/`, apply the migration twice, run split math,
reversals, statements, row-level security, grants and abuse cases, then prove the rollback leaves nothing behind
and fees still credit afterwards.
