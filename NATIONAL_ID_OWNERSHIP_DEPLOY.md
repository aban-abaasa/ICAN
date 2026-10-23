# National ID: an ID belongs to the person who can prove it

**The problem.** Saving a national ID only checked that it was well formed and not used yet. So anyone could type a stranger's ID
first, wear that person's identity on their wallet, and lock the real owner out ("already linked to another wallet").

**The fix.** A saved ID is now only a *claim* until a reviewer has confirmed it is the holder's.

| Who | What they can do |
|---|---|
| The holder of a saved ID | **Verify** it: full name exactly as printed + photo of the ID + selfie holding it. A reviewer approves. |
| The real owner of an ID someone else saved first | **"This is my ID — ask for it"**: the same proof. If a reviewer approves, the ID moves to them and the first holder is left with no ID. |
| A sender | Sees **✓ ID verified** (or **⚠ ID not verified**) under the recipient's name before paying. |
| A verified person | Cannot rename their wallet to a name that does not fit the name on their ID. |
| A reviewer | Dev console → **ID checks**: sees the photos, the name, who holds the ID now, and approves or rejects. |

Nothing is blocked until you switch it on (below). Receiving money is never blocked.

## Deploy (in this order)

1. Supabase SQL editor: run **`backend/NATIONAL_ID_PER_COUNTRY.sql`** again (it was updated; safe to repeat, keeps your IDs and rates).
2. Make sure **`supabase/migrations/20261009100000_secure_dev_access.sql`** has been run (the reviewer functions use its dev secret).
3. Run **`backend/NATIONAL_ID_OWNERSHIP.sql`**. Safe to repeat. It refuses to run if step 1 or 2 is missing.
4. Deploy the website.

The website works before step 3 (the new screens simply do not appear) and the SQL works before step 4.

**No new upload route, folder or serverless function.** The photos go through the existing `/api/storage/presign-upload` to the
existing `cmms-employment-documents` R2 folder (the same one CMMS employee ID documents use). `tests/apiFunctionCount.test.js`
still passes, and `tests/nationalId.test.js` checks the folder is one the upload route accepts.

## Rolling it out

The two switches live in `public.national_id_enforcement`. Both start **off**.

```sql
-- 1. every wallet must have an ID on file before money leaves it (already existed)
UPDATE public.national_id_enforcement SET enforced = true, enforced_from = now();

-- 2. stricter: that ID must also be VERIFIED. Switch on only when the Dev console "Waiting" list is short.
UPDATE public.national_id_enforcement SET require_verified = true;
```

Suggested order: deploy → let people verify for a while (their card is in wallet **Settings**) → clear the queue → switch on
`require_verified`. When it is on, anyone with an unverified ID is told to verify when they try to send, and gets a reminder banner.

Accounts that must move money with no person behind them (treasury, fee accounts) go in `public.national_id_exemptions`, as before.

## What reviewers should do

Open the Dev console → **ID checks**. For each request:

- Compare the photo of the ID, the selfie, the **name typed**, and the **last four characters** shown. The full ID number is never
  readable by anyone (only a one-way hash is kept), so check the last four against the photo.
- **Approve** is disabled while the typed name does not fit the wallet name (the person has to fix one or the other first).
- A **claim** shows who holds the ID now and whether that holder is verified. Approving moves the ID and leaves the earlier holder
  with none. If the holder is **verified**, you must tick the override box: that overrides someone already proven, so be sure.
- **Reject** needs a reason; the person sees it and can send a new request (three a day at most).

## What this does *not* do — please read

- It is **not a lookup against the issuing authority** (e.g. NIRA in Uganda). A person decides, from photos. A convincing forgery can
  still pass; the selfie, the name match and the review are what make that hard, not impossible. Wire a real lookup into
  `ican_id_dev_review` later if you get access.
- **Photo privacy.** Reviewers' photo links come from the existing public preview route (`presign-get-batch`), which does not check who
  is asking and relies on unguessable keys. The keys are never given to the API, only to a reviewer with the dev token, but a link a
  reviewer shares is usable by anyone for up to 6 days. The existing delete route also lets a person delete their own uploaded file,
  so a photo can disappear before it is reviewed (reject it). There is no automatic deletion of old photos: decide how long to keep
  them and clear that folder accordingly. If you want stricter handling, that means changing the shared storage route, which is a
  separate decision.
- It does not touch `user_accounts.kyc_verified`.
- Existing wallets are not verified automatically; they stay "ID not verified" until the person goes through review.
- A wallet name that no longer fits a verified ID can only be fixed by support (database), by design.

## Tests

```bash
supabase/tests/national_id_ownership/run.sh     # database: ~100 checks on a throwaway Postgres (installs both files, twice)
cd frontend && npm test                          # includes tests/nationalId.test.js
```

Database checks include: the API cannot read photos or hashes; signed-out callers cannot call anything; a stranger cannot be
approved by guessing the token; the squatter loses a claimed ID and their own pending request is closed; a verified holder cannot be
displaced without the override; the name lock; strict-mode blocking of sends but not receives; the daily request limit and the hourly
guess limit; re-running the installers keeps all data.
