# Give tithe to a registered church

Tithe now has a **⛪ Give to Church** tab: search churches registered on IcanEra, then give by
**IcanEra wallet (PIN required)**, **mobile money / card (Flutterwave)** or **cash**. Every
IcanEra-wallet tithe payment elsewhere in the app (Add Tithe, Pay Tithe, Calculator, mobile
view) now asks for the wallet PIN too; cash only records a gift, so it does not.

## Deploy (in this order)
1. Run `supabase/migrations/20261014100000_church_tithe_giving.sql`, then `20261014110000_church_tithe_business_wallet.sql`, then `20261014120000_church_tithe_business_payer.sql` (all safe to re-run, in that order).
2. Set the secret and deploy the function that settles Flutterwave payments:
   `supabase secrets set FLUTTERWAVE_SECRET_KEY=...` then
   `supabase functions deploy verify-tithe-payment`
   (`backend/supabase/functions/verify-tithe-payment`). Without it, only wallet and cash giving work.

## How it behaves
- **Who shows up:** every active registered business is searchable; churches (type/name says church, ministry, parish, mosque, etc., or the owner ticked **Accept tithe**) are listed first and a **Churches only** filter narrows the list. Nothing is fetched until the giver searches or taps *Browse*.
- **Wallet:** PIN check, then giver’s UGX wallet → the business’s own wallet account (`user_accounts`, account_type `business`) in one transaction. A business with no wallet account yet is credited to its owner’s wallet instead, and the giver is told.
- **Business tithe:** when a tithe is for a business and paid from a wallet, the giver picks which of their own businesses pays; the money leaves that business’s wallet account and its own wallet PIN is asked. A business can’t pay itself, and a business without a wallet account can’t be chosen.
- **Flutterwave:** the browser never decides a payment worked; the Edge Function re-checks the charge
  with Flutterwave (status, UGX, amount, tx_ref) and calls a service-role-only SQL function. The same
  tx_ref can never settle twice.
- **Cash:** recorded for the giver; the church owner taps *Confirm cash received*.
- **Anonymous:** the church sees the gift and message, not the name.

## Known limits
- The wallet PIN is verified in the app (as everywhere else in IcanEra), not by the database.
- Flutterwave fees are not deducted: the church is credited what the giver was charged.
