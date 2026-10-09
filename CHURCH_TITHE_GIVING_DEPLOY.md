# Give tithe to a registered church

Tithe now has a **⛪ Give to Church** tab: search churches registered on IcanEra, then give by
**IcanEra wallet (PIN required)**, **mobile money / card (Flutterwave)** or **cash**. Every
IcanEra-wallet tithe payment elsewhere in the app (Add Tithe, Pay Tithe, Calculator, mobile
view) now asks for the wallet PIN too; cash only records a gift, so it does not.

## Deploy (in this order)
1. Run `supabase/migrations/20261014100000_church_tithe_giving.sql` (safe to re-run).
2. Set the secret and deploy the function that settles Flutterwave payments:
   `supabase secrets set FLUTTERWAVE_SECRET_KEY=...` then
   `supabase functions deploy verify-tithe-payment`
   (`backend/supabase/functions/verify-tithe-payment`). Without it, only wallet and cash giving work.

## How it behaves
- **Who shows up:** every active registered business is searchable; churches (type/name says church, ministry, parish, mosque, etc., or the owner ticked **Accept tithe**) are listed first and a **Churches only** filter narrows the list. Nothing is fetched until the giver searches or taps *Browse*.
- **Wallet:** PIN check, then giver’s UGX wallet → church owner’s UGX wallet in one transaction.
- **Flutterwave:** the browser never decides a payment worked; the Edge Function re-checks the charge
  with Flutterwave (status, UGX, amount, tx_ref) and calls a service-role-only SQL function. The same
  tx_ref can never settle twice.
- **Cash:** recorded for the giver; the church owner taps *Confirm cash received*.
- **Anonymous:** the church sees the gift and message, not the name.

## Known limits
- The wallet PIN is verified in the app (as everywhere else in IcanEra), not by the database.
- Flutterwave fees are not deducted: the church is credited what the giver was charged.
