# Product badges on PitchIn videos and status updates: deploy notes

A business can advertise its products **inside a video**: at the seconds it chooses, a small badge slides in with the product's photo,
name and price, and tapping it opens the business's Market. It works on **PitchIn pitch videos** and on **status updates** (the status feed).
It is a paid service that **starts free**; a developer switches it to Charged from the developer panel whenever they like.

## 1. Apply the database layer (Supabase SQL editor, once)

Paste **`VIDEO_PRODUCT_BADGES_PASTE_INTO_SUPABASE.sql`** (a byte-for-byte copy of
`supabase/migrations/20261119100000_video_product_badges.sql`) and press Run. Safe to run twice; it never overwrites a price a developer has set.
Rollback: `supabase/rollback/20261119_rollback_video_product_badges.sql` (deletes every badge and the record of what they cost; coin already
paid is not refunded; pitches, statuses, wallets and stores are untouched).

Needs, already installed: PitchIn (`pitches`), the status feed (`backend/CREATE_STATUS_FEATURES.sql`, i.e. `ican_statuses`) and the developer
allowlist (`20261009100000_secure_dev_access.sql`). **Charging** also needs `ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql` (where the fee is credited); while
a service is free that is never called. Until this is applied nothing shows anywhere and no screen changes.
**Nothing here has been applied to your Supabase project by Claude.**

## 2. Who can do what

| Where | Who | Notes |
| --- | --- | --- |
| **PitchIn**: "Product badges" on a pitch you own | the business owner | |
| **CMMS > Announcements > Video badges** | staff who may edit the company's public board | needs the company linked to its business (Board profile tab). They can prepare drafts and publish while the service is free; **only the owner can pay**. |
| **Your own status**: tag button in the status viewer | the person who posted it, for a business they own | up to 3 badges, all from one business |

A badge can be linked to one of the business's **store products** (name, photo, price and stock are read live, so the price is never stale and the
badge hides itself when the product sells out or is switched off) or typed by hand (name + price). The database checks that a linked product really
belongs to the business. **Spread them across the video** places a pitch's badges evenly; every time stays editable. A photo or text status has no
timeline, so its badges stay on screen the whole time.

## 3. The price (developer panel > Fees & services > Services)

| Service | What it buys | Default |
| --- | --- | --- |
| `pitch_product_badge` | one badge on a pitch video for **30 days** (renewable in its last 7 days) | **Free** |
| `status_product_badge` | one badge on a status for as long as the status lasts (**24 hours**) | **Free** |

Each has a price in IcanEra coin (IC) and a **Free / Charged** switch that remembers the price, so it can be alternated at any time. Switching to Free
and back never loses the price. A change applies to the next publish or renewal; badges already running keep running and are not charged again.
Charged badges are taken from the **business wallet** and credited to the platform-fee business in one step: if either side fails, nothing is taken and
the badge does not go live. Every change is logged with who made it. Only the allowlisted developer account can change a price (the panel token alone is
not enough).

## 4. Deploy the website

Merge the ICAN branch. The viewers ask the database for badges only when a video is on screen and show nothing if the SQL is not installed, so the site
and the SQL can go out in either order.

## 5. Checks run

- `supabase/tests/pitch_badges/run.sh`: 98 database checks against a throwaway Postgres (price switch and logging, who may manage, live product data,
  sold-out hiding, private pitches and statuses, ended statuses, the money path including a failed platform credit that undoes the whole payment,
  renewals, idempotent re-run keeping the developer's price, paste file equals the migration, rollback). The platform credit
  (`fn_credit_platform_fee_to_business`) is a **stand-in** in that test, so the payment logic is proven against its documented behaviour, not the live function.
- `frontend/tests/pitchBadges.test.js`, `servicePrices.test.js`: timing, auto-placement, wording, form checks, and that the screens only call functions the migration defines.
- The real overlay and manager components were also run in headless Chromium against a stubbed backend (timing on a fake video clock, stacking, taps, forms,
  free/charged wording, refusals, the status screens). That used a minimal stylesheet, not the app's Tailwind build, so **how it looks has not been seen**.

## Known behaviour to be aware of

- The fullscreen status viewer moves to the next update after 5 seconds (existing behaviour), so a video status badge is only on screen while that status is.
  A new status badge defaults to 6 seconds; start it at 0 for short statuses. The public share viewer follows the video's real length.
- Only the owner pays; CMMS staff cannot add badges to a status (statuses are personal posts).
