# Growth, Security Center and Readiness: deploy notes

Merging the code is safe on its own. Until the migrations below are applied, each page
shows a plain notice ("not switched on for this server yet") instead of failing, and
everything that does not need the database keeps working.

## 1. Apply the migrations (Supabase SQL editor, in this order)

| File | What it adds |
| --- | --- |
| `supabase/migrations/20261003090000_growth_scheduler.sql` | Growth tables, reminder dispatcher, per-minute `pg_cron` job, test-alert RPC |
| `supabase/migrations/20261003091500_security_center.sql` | Four functions that read the caller's own sessions and sign-in history |
| `supabase/migrations/20261003092000_readiness_tracker.sql` | Readiness settings, progress and Google links tables |

Each has a matching rollback in `supabase/rollback/`. All three are additive and safe to run
twice. None installs anything on Supabase's `auth` tables.

Needs `pg_cron` (Growth reminders). Phone pushes also need `ican_push_relay` from
`backend/ICAN_APP_PUSH_REGISTRATION.sql`; without it reminders still reach the in-app inbox.

## 2. Redeploy the `wallet-push` Edge Function

`backend/supabase/functions/wallet-push/index.ts` gained a `growth` source (ICAN devices only)
so a tapped reminder opens Growth. Reminders are delivered without it, but tapping one lands on
the wallet page until it is redeployed.

## 3. Check authenticator-app verification is enabled

Supabase dashboard, Authentication, Multi-factor: TOTP must be on. If it is off, "Set up
authenticator app" says so in plain words.

Once a user turns it on, sign-in asks for a code. Supabase TOTP has no recovery codes, so
the setup screen tells people to keep the setup key. A user who loses both needs an admin to
delete their factor (Authentication, Users).

## 4. Sign-in change worth knowing about

`AuthContext.signIn` used to fall back to the device's cached session on any online failure,
including a wrong password. It now falls back only when the network itself failed. The
"Quick Login (Offline Sessions)" one-tap list still works. It signs in without a password by
design, for up to 7 days, on the device that cached the session.

## 5. Google features

Readiness reads a public Google Sheet as CSV, frames Google Forms and Drive previews, and
embeds Google Maps. All Google addresses are checked for an exact host match before use and
again by a database constraint. No Google login, OAuth client or API key is involved:
people paste links to things they have already shared.
