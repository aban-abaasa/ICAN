# Sign in with fingerprint or face: deploy notes

People can now open IcanEra with **just their fingerprint or face** - no email, password or PIN typed. It is the device's own
unlock (Android fingerprint / face unlock, iPhone Face ID / Touch ID, Mac Touch ID, Windows Hello), used through the browser's built-in
**passkey** support (WebAuthn). There is **no third-party face or biometric service, no camera access and no stored biometric**.

| | |
|---|---|
| Sign-in screen | a **Sign in with fingerprint or face** button. On a phone/laptop that is already set up it is the first thing on the card |
| Turn it on | My Profile, Security, **Sign in with fingerprint or face**, Turn on for this device |
| Devices | the same card lists every device that can sign in, with Remove |
| Face vs fingerprint | the device decides which it asks for; one button covers both |

## Why this and not a camera face matcher

A face-matching model running in the page can be fooled by a photo or a video, needs a heavy download, has to *store* a face
template somewhere, and cannot prove to the server who is signing in. A passkey is the opposite on every point: the **phone's own secure
hardware** does the check (with liveness, which a website cannot do), keeps the private key to itself, and signs a one-time challenge.
The server only ever holds a **public key**. Nothing biometric leaves the device.

## Turn it on (two steps)

Merging the code is safe on its own. Until both steps are done the Security card says fingerprint and face sign-in is "not switched on
for this server yet", the sign-in button simply reports the same if tapped, and nothing else changes.
**Nothing here has been applied to your Supabase project by Claude.**

1. **Database** - Supabase, SQL editor, paste **`BIOMETRIC_SIGNIN_PASTE_INTO_SUPABASE.sql`**, Run.
   (Same file as `supabase/migrations/20261115100000_biometric_signin.sql`. Safe to run twice. It only adds two new tables and touches
   nothing that exists.)
   * `user_passkeys` - one row per device: its **public** key, a counter, a label. A signed-in person can list and remove only their own rows
     (and only the harmless columns); only the Edge Function can create or update them.
   * `passkey_challenges` - the one-time challenges. Service role only.
2. **Edge Function** - deploy `backend/components/supabase/functions/passkey-auth` the same way as `wallet-login`
   (`supabase functions deploy passkey-auth --no-verify-jwt`). Deploy it with "Verify JWT" **off**, like `wallet-login`: signing in happens
   before there is any session, and the function does its own checks (enrolling needs the signed-in person's token and their password;
   signing in needs a valid signature from a registered device). It needs no new secret: it uses the `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` every function already has.

Optional: set **`PASSKEY_ALLOWED_ORIGINS`** (comma separated, e.g. `https://app.icanera.com`) to restrict which web addresses may ask.
Unset, any https address (and `localhost`) may - a passkey still only ever works on the exact address it was made on.

## How it works

```
 turn on   (signed in, password re-checked)      sign in   (signed out, nothing typed)
 ───────────────────────────────────────────     ───────────────────────────────────────────
 register-options  -> one-time challenge          login-options  -> one-time challenge
 device: fingerprint/face -> new key pair          device: fingerprint/face -> signs the challenge
 register-verify   -> stores the PUBLIC key        login-verify   -> checks the signature with the stored public key
                                                                   -> returns a magic-link token (like wallet-login)
                                                   app redeems it with verifyOtp -> a normal Supabase session
```

What the server checks on every sign-in: the challenge is its own, unused and under 3 minutes old; the request came from the
site the key was made for (a look-alike phishing page gets nothing usable); the device verified a **person** (fingerprint, face or device
PIN, not just a tap); the signature matches the stored public key; and the counter has not gone backwards (a copied credential).

## What people should know

* **Password accounts must type their password once to turn it on.** A new way into an account that outlives the current session is only
  added by someone who knows the password - a stolen session alone cannot do it. Google-only accounts have no password to ask for.
* **Two-step (authenticator app) accounts are still asked for their code** after a fingerprint/face sign-in, like every other method.
* **Sign out of all devices** now also turns fingerprint/face sign-in off everywhere, so a lost phone has no way back in.
  Removing one device in the Security card removes only that one. Ordinary Sign out leaves it on.
* A passkey belongs to one web address. If the app is reachable at both `example.com` and `www.example.com`, each needs turning on once.
* Phones sync passkeys through their own keychain (iCloud Keychain / Google Password Manager), so a new phone of the same owner may offer it
  automatically; it appears in the list as **Synced**.
* Needs a recent browser: Chrome/Edge 85+, Safari 16.4+, Firefox 119+, over https (or `localhost`). Otherwise the button is hidden.
* A device with no fingerprint or face unlock set up cannot make a passkey; the card says so.

## Tests

* `frontend/tests/webauthn.test.js` - 22 checks on the verifier (`backend/components/supabase/functions/_shared/webauthn.js`), using a
  software "phone" that generates real ES256 and RS256 keys and signs like an authenticator: good sign-ins pass; a wrong key, tampered data,
  an old challenge, another site, a phishing origin, a missing biometric check, a copied credential and garbage signatures are all refused.
* `frontend/tests/webauthnBrowser.test.js` - 8 checks on the browser-side helpers (encoding, option conversion, plain-English errors).
* Also checked once, outside the repo (not committed):
  * the real `passkey-auth` function and `passkeyService.js` against an in-memory Supabase and a simulated phone: enrol, sign in, replay,
    wrong site, wrong user, the 10-device limit, removal;
  * the real sign-in screen and Security card in Chromium with a **virtual platform authenticator**: password check, enrolment, signing in
    with nothing typed, signing in again, and a failed fingerprint/face check (nobody gets in);
  * the migration on a throwaway Postgres 16 with Supabase-style roles: runs twice, a signed-in user sees and deletes only their own rows and
    cannot read the public key, anonymous callers get nothing, deleting an account removes its devices, and the rollback leaves nothing.

  It was **not** run against your live Supabase project or on a physical phone - do a real enrol and sign-in once after deploying (below).

## Check it worked

1. Signed in on a phone: My Profile, Security, **Turn on for this device**, confirm your password, then the fingerprint/face prompt.
2. Sign out. On the sign-in screen the fingerprint/face button is now first. Tap it, scan: you are in.
3. `select label, rp_id, sign_count, last_used_at from public.user_passkeys;` shows the device.

## Undo

`supabase/rollback/20261115_rollback_biometric_signin.sql` drops both tables; delete the `passkey-auth` function. Everyone simply uses their
password (or Google / wallet PIN) again; no account is touched.
