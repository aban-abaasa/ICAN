# ICANera Wallet push relay

Deploy this Edge Function with JWT verification disabled because Supabase
Database Webhooks do not carry a user JWT:

```sh
supabase functions deploy wallet-push --no-verify-jwt
supabase secrets set VAPID_PUBLIC_KEY=<the frontend VITE_WEB_PUSH_VAPID_PUBLIC_KEY>
supabase secrets set VAPID_PRIVATE_KEY=<matching private key> VAPID_SUBJECT=mailto:security@icanera.com
supabase secrets set ICAN_WALLET_PUSH_WEBHOOK_SECRET=<long-random-secret>
```

In Supabase Dashboard, create a **Database Webhook** for `INSERT` events on
`public.ican_wallet_inbox_notifications` pointing at this function. Add the
header `x-ican-wallet-webhook-secret` with the same secret. This keeps the
VAPID private key off every browser and delivers the one shared wallet inbox
notification to all of the recipient's registered devices.

The VAPID public key is committed in `frontend/.env.example`; it must be set
as `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` in every deployed ecosystem app.

## Cross-app alerts (SupermartKera + BodaGoEra)

Every app in the shared Supabase project registers its own devices with the same
relay - a push subscription belongs to the origin it was created on, so a phone
that turned on alerts inside SupermartKera or BodaGoEra needs its own row, tagged
with `application_id` (`digital-city-era`, `mybodaguy`, ...).

Sources this relay handles:

| `source`            | Sent to                                   | Raised by |
|---------------------|-------------------------------------------|-----------|
| `wallet`            | every device of the recipient             | `ican_wallet_inbox_notifications` trigger (includes supplier-payment approvals) |
| `cmms`              | every device of the recipient             | `cmms_notifications` trigger |
| `community_live`    | every device except the broadcaster's     | `ican_notify_community_live()` |
| `bodagoera_ride`    | the recipient's BodaGoEra (`mybodaguy`) devices | `mbg_rides` trigger - new request, accepted, started, completed, cancelled |
| `bodagoera_message` | BodaGoEra devices                         | `mbg_ride_messages` trigger |
| `bodagoera_call`    | BodaGoEra devices, high urgency, 45 s TTL | `mbg_notify_incoming_call()` RPC, called by the caller's app |

Set up, in this order:

1. Run `ICAN/backend/ICAN_APP_PUSH_REGISTRATION.sql` (adds `application_id`, the
   `ican_register_app_push_subscription` RPC and the private `ican_push_relay`
   helper; it copies the existing relay URL/secret from the wallet trigger).
2. Run `mybodaguy/backend/database/ADD_BODAGOERA_PUSH_NOTIFICATIONS.sql`.
3. Redeploy this function: `supabase functions deploy wallet-push --no-verify-jwt`.
4. Set `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` (same value as ICAN) in the hosting env of
   SupermartKera (digital-city-era) and BodaGoEra (mybodaguy), then redeploy both.
