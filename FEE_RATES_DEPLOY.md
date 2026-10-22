# Fees: what the wallet charges, and how a developer changes it

| What | Fee | Taken |
|---|---|---|
| Send to another **IcanEra account** | **free** | — |
| Send **IcanEra coin** | **free** | — |
| Send wallet money to a **mobile-money number** | **3%** | out of the amount |
| Send wallet money to a **bank account** | **3%** | out of the amount |
| **Withdraw** wallet money to your own mobile money | **3%** | out of the amount |
| **Withdraw** IcanEra coin to mobile money / bank (and every coin → money conversion) | **3%** | out of the amount |

"Out of the amount": send UGX 10,000 at 3% and your wallet is debited **10,000**; the recipient receives **9,700**. If a transfer
fails, the whole 10,000 is refunded.

## Change a rate (one line, no redeploy)

In the Supabase SQL editor:

```sql
UPDATE public.ican_fee_rates SET rate = 0.02 WHERE key = 'send_mobile_money';   -- 2%
UPDATE public.ican_fee_rates SET rate = 0    WHERE key = 'send_bank';           -- free
UPDATE public.ican_fee_rates SET rate = 0.0125 WHERE key = 'coin_cash_out';     -- 1.25%
```

| key | applies to |
|---|---|
| `send_mobile_money` | wallet money → someone else's mobile-money number |
| `send_bank` | wallet money → a bank account (anyone's — a bank account can't be proven to be yours, so your own is the same rate) |
| `withdraw_wallet` | wallet money → **your own registered** mobile-money number |
| `coin_cash_out` | IcanEra coin sold for money: cash-out, payouts, and the conversion when a wallet is short |

A rate is a fraction from 0 up to (not including) 1; the table refuses anything else. The server charges the new rate on the next
request; the app shows it within a minute. The server decides which rate applies from what it can verify (bank / your own number /
someone else's number) — never from what the app claims — so nobody can ask for the cheaper rate on an ordinary send.

## Deploy (in this order)

1. Run **`FEE_RATES_PASTE_INTO_SUPABASE.sql`** (same file as `supabase/migrations/20261106100000_fee_rates.sql`) in the SQL editor.
   Safe to run twice; it never overwrites a rate you have changed. If it prints a `WARNING ... left exactly as it was`, that function
   keeps its fixed 3% until changed by hand — nothing breaks.
2. `supabase functions deploy flutterwave-momo-send` (from `backend/components`, the way you deployed it before). It now also ships
   `_shared/fees.js`.
3. Deploy the website.

Until step 2 nothing is charged on sends or withdrawals. If the website goes out before step 1, it shows no fee on wallet-money
sends (the table doesn't exist yet), which matches what the server charges.

Roll back with `supabase/rollback/20261106_rollback_fee_rates.sql`.

## ⚠ Security fix included in the SQL — read this

The functions that move money for a given user (`request_fiat_momo_send`, `request_fiat_bank_send`, `resolve_fiat_momo_send`,
`mark_fiat_momo_send_processing`, `request_ican_payout`, `resolve_ican_payout`) were **callable by anyone holding the public anon key**,
and take the user to debit as a parameter. Their SQL files say "restricted to service_role", but `REVOKE … FROM PUBLIC` does not remove
the direct grants Supabase gives `anon` and `authenticated`; a check of the live database showed both roles could execute all six.
Only the Edge Functions (service-role key) ever call them, so the SQL revokes the two roles by name. Nothing in the website or the
other apps uses them directly.

Worth a look, since this could have been used before: any request stuck in `pending` with no Flutterwave transfer id.

```sql
select id, sender_user_id, amount, status, created_at from public.ican_fiat_send_requests
 where status = 'pending' and flutterwave_transfer_id is null and created_at < now() - interval '1 hour';
select id, user_id, status, created_at from public.ican_payout_requests
 where status = 'pending' and flutterwave_transfer_id is null and created_at < now() - interval '1 hour';
```

Other functions that take a `p_user_id` and are meant to be called by the signed-in user themselves (sell/buy/transfer coin) should
check `auth.uid()` inside — worth auditing the same way.

## Tests

`supabase/tests/fee_rates/run.sh` (a throwaway Postgres; 40+ checks on the rates, the fee maths, refunds, the lock-down and the
migration/rollback round trip) and `frontend/tests/feeRates.test.js` (the website and the server compute the same fee).
