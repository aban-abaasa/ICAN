# Ratings, subscriptions and smart product ranking: deploy notes

Customers can now **rate** a business (1-5 stars, optional comment) and **subscribe** to it from its website
(`icanera.space/notices/<company>`, on the Home and Market tabs). Those two signals decide which store's products are shown
first in all three apps that share this Supabase project: **IcanEra**, **SupermarketEra** (`digital-city-era`) and **BodaGoEra**
(`mybodaguy`).

## 1. Apply the database layer (Supabase SQL editor, once)

Paste **`BUSINESS_RATINGS_RANKING_PASTE_INTO_SUPABASE.sql`** (a byte-for-byte copy of
`supabase/migrations/20261118100000_business_ratings_subscriptions_ranking.sql`) and press Run. Safe to run twice.
It only **adds** two tables and some functions. It never touches wallets, payments, orders or stock.
Rollback: `supabase/rollback/20261118_rollback_business_ratings_subscriptions_ranking.sql` (deletes every rating and
subscription; products and stores are untouched, and the apps go back to "newest first" on their own).

Until it is applied nothing changes anywhere: the rating card stays hidden on the website and both apps keep listing newest first.
**Nothing here has been applied to your Supabase project by Claude.**

## 2. What customers see

- **Business website**: a card with the average stars, number of ratings and followers, a **Subscribe** button, a star picker with an
  optional comment, and recent written reviews (reviewers are not named). Rating or subscribing asks for a free IcanEra account
  (Google in one tap). A customer has one rating and one subscription per business; editing replaces it, and "Remove" withdraws it.
  Owners can see their numbers but cannot rate or subscribe to their own business.
- **SupermarketEra / BodaGoEra shop**: the product grid is ordered by the ranking below. Each product shows the store's
  `★ 4.8 (20)` and a **Following** tag when the signed-in customer subscribes to it. The landing-page product preview in
  SupermarketEra is ranked the same way.

## 3. How the ranking works (`fn_ranked_products_page`)

| Part | Rule |
| --- | --- |
| **quality** | Bayesian average of the stars, pulled toward the platform-wide average until a business has about 3 ratings. One 5-star review does not beat 200 reviews averaging 4.6; a business with no ratings starts neutral, not last. |
| **popularity** | `ln(1 + subscribers)` relative to the most-followed business. Log-scaled so a giant cannot bury every small shop. |
| **score** | `0.65 × quality + 0.35 × popularity` (0 to 1). |
| **layout** | Each store's products are numbered 1, 2, 3 … (in stock first, newest first) and sorted by `position / (0.5 + 1.5 × score)`. A top store gets its Nth product onto the page about twice as early as a neutral one, but **every store still appears on the first screens**, so a store with 1,000 products cannot push everyone else off. |
| **stock** | Out-of-stock products always come after in-stock ones. |
| **my shops** | For a signed-in customer, products from stores they **subscribed to** come first, ahead of the score ordering. Everyone else sees the score ordering. |

The weights are plain numbers at the top of `_store_rank_scores` and in the `ORDER BY` of `fn_ranked_products_page`; change them there.

Same filters the shop already had (search, category, one store, excluded stores, active stores only), so nothing about browsing changes
apart from the order.

## 4. Deploy the apps

Merge the three branches (ICAN, digital-city-era, mybodaguy). Each app calls the database function and, if it is not installed or
fails, falls back to the old query, so the apps and the SQL can go out in either order.

## 5. Checks run

- `supabase/tests/business_ratings_ranking/run.sh`: 54 database checks against a throwaway Postgres (rating rules, owners blocked,
  tables unreadable directly, Bayesian ordering, fairness across stores, out-of-stock last, subscriber-first, pagination without gaps or
  repeats, search/category/exclusion parity, idempotent re-run, paste file equals migration, rollback).
- `frontend/tests/businessEngagement.test.js` (ICAN): website number handling, and that the site only calls functions the migration defines.
- `npm run test:ranked-products` (SupermarketEra and BodaGoEra): the shop's page loader keeps the database's order, reads the store numbers,
  asks for the right page and filters, and falls back cleanly.

Not done: the React screens were syntax-checked but not rendered in a browser (no dependencies are installed in the build sandbox).
