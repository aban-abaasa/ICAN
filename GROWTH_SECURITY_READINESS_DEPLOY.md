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
again by a database constraint. By default no Google login, OAuth client or API key is
involved: people paste links to things they have already shared. A link pasted inside other
text (a WhatsApp share, an email line) is picked out automatically, and the Paste button reads
the copied link in one tap.

### Optional: browse Google Drive from the app (phone and computer)

Adds a **Browse my Google Drive** button to Readiness, Forms & documents. People pick files
from My Drive or Shared with me, or use the Upload tab to send a file from the phone or computer
to Drive, and the link is saved for them. Several files can be picked at once.

Set these in Vercel (Project, Settings, Environment Variables) and redeploy. They are public
browser values; there is no client secret.

| Variable | Value |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | OAuth client ID, type "Web application" |
| `VITE_GOOGLE_API_KEY` | Browser API key, restricted to the Picker API and your site |
| `VITE_GOOGLE_APP_ID` | Optional: the Google Cloud project number |

In the Google Cloud console: enable the **Google Picker API**; create the OAuth client with
your site (for example `https://icanera.space`) under Authorised JavaScript origins; create the
API key. The only scope requested is `drive.file`, so the app sees nothing but the files a
person picks. The access token stays in the browser tab and is never sent to our server; only the
link is saved. Without the variables the button is replaced by Open Google Drive and Paste.

A picked file is private until its owner shares it, so others will see a blank preview until
the owner sets sharing in Drive.

## 6. Build from a conversation (Resume and Pitchin profile)

Resume, Profile tab has **Start from a conversation**, and the Pitchin business form has
**Fill this in from your idea**. A person types, speaks, pastes a chat or uploads a WhatsApp
export (.txt), reviews what the AI found, and ticks what to keep.

- Needs the same AI keys the app already uses (`OPENAI_API_KEY` and/or `GEMINI_API_KEY` in Vercel).
- No migration. It is served by `api/ai-analysis.js` (task `profile-from-conversation`), so it
  adds no new Vercel function. The handler lives in `api/_lib/profileFromConversationHandler.js`.
- Signed-in users only, limited to 8 reads per 10 minutes each. The text is sent once to the AI
  provider and is not stored or logged.
- Existing details are never overwritten unless the person ticks that row. Experience entries
  are saved when confirmed; profile details only fill the form until Save is pressed.
