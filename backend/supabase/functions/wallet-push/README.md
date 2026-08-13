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
