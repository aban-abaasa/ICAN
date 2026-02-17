# 🔐 RLS Bypass: Wallet Creation via Backend Function

## Problem
RLS (Row Level Security) policies only allow users to create their **own** wallets. This blocks:
- Recipients from receiving wallets in different currencies
- New users from having initial wallets created during account setup

## Solution
Created **`ensure_recipient_wallet_exists`** backend function with `SECURITY DEFINER` clause to bypass RLS policies.

---

## Implementation

### 1. Backend Function (CREATE_RECIPIENT_WALLET_FUNCTION.sql)
```sql
CREATE OR REPLACE FUNCTION public.ensure_recipient_wallet_exists(
  recipient_user_id uuid,
  currency text
)
RETURNS TABLE (id uuid, balance numeric, currency text) AS $$
-- Creates wallet if it doesn't exist, returns existing wallet if it does
-- Uses SECURITY DEFINER to bypass RLS policies
```

**Key Features:**
- ✅ Checks if wallet already exists
- ✅ Creates wallet with SECURITY DEFINER (bypasses RLS)
- ✅ Returns wallet details (id, balance, currency)
- ✅ Granted to authenticated users

---

### 2. Frontend Updates

#### ICANWallet.jsx - Send Money to ICAN User
**Location:** [frontend/src/components/ICANWallet.jsx](frontend/src/components/ICANWallet.jsx#L459-L476)

```javascript
// If recipient doesn't have wallet in this currency, create it using backend function
if (!finalRecipientWallet && !recipientWalletError) {
  const { data: newWallet, error: createError } = await supabase
    .rpc('ensure_recipient_wallet_exists', {
      recipient_user_id: recipientUser.user_id,
      currency: selectedCurrency
    })
    .single();
  
  if (createError) {
    throw new Error(`Failed to create recipient wallet: ${createError.message}`);
  }
  finalRecipientWallet = newWallet;
}
```

#### WalletAccountService - User Account Creation
**Location:** [frontend/src/services/walletAccountService.js](frontend/src/services/walletAccountService.js#L189-L207)

```javascript
// Create wallet entries for each supported currency using backend function
// This bypasses RLS policies which block direct INSERT
const currencies = ['USD', 'UGX', 'KES'];

for (const currency of currencies) {
  const { data: walletData, error: walletError } = await supabase
    .rpc('ensure_recipient_wallet_exists', {
      recipient_user_id: userId,
      currency: currency
    })
    .single();
  
  if (walletError) {
    console.warn(`⚠️ Warning: Could not create wallet for ${currency}:`, walletError);
  }
}
```

---

## How It Works

### Flow Diagram
```
User Creates Account / Sends Money to Recipient
        ↓
Frontend calls .rpc('ensure_recipient_wallet_exists', {...})
        ↓
Backend function executes with SECURITY DEFINER
        ↓
Function bypasses RLS policies (elevated privileges)
        ↓
Check if wallet exists
├─ Yes → Return existing wallet
└─ No → Create new wallet (bypasses RLS) → Return new wallet
        ↓
Frontend gets wallet ID and proceeds with transaction
```

---

## Security Considerations

✅ **Safe** because:
1. Function uses `SECURITY DEFINER` only for wallet creation (necessary)
2. RLS policies still protect data access for normal queries
3. Function is explicitly granted to `authenticated` users only
4. Function validates inputs and returns wallet details safely
5. Prevents unauthorized wallet access through RLS

✅ **Prevents**:
- Users accessing wallets they don't own (still blocked by RLS)
- Direct INSERT bypasses (must use function)
- Unauthorized transactions (still require proper authentication)

---

## Testing Checklist

- [ ] User can create account → wallets created in USD, UGX, KES
- [ ] User can send money to another ICAN user without existing wallet → wallet auto-created
- [ ] Recipient receives money in correct currency
- [ ] No RLS policy violations in browser console
- [ ] Both users' balances updated correctly
- [ ] Transactions recorded properly

---

## Files Modified

| File | Changes | Purpose |
|------|---------|---------|
| [CREATE_RECIPIENT_WALLET_FUNCTION.sql](CREATE_RECIPIENT_WALLET_FUNCTION.sql) | Created new function | Backend RLS bypass |
| [ICANWallet.jsx](frontend/src/components/ICANWallet.jsx#L459-L476) | Updated send handler | Use RPC instead of direct INSERT |
| [walletAccountService.js](frontend/src/services/walletAccountService.js#L189-L207) | Updated wallet creation | Use RPC for all wallets |

---

## Deployment Steps

1. **Run the SQL function** (must be executed by database admin):
   ```bash
   psql -h <host> -U <user> -d <database> -f CREATE_RECIPIENT_WALLET_FUNCTION.sql
   ```

2. **No frontend changes needed** - RPC calls are already implemented

3. **Test the flow**:
   - Create a new account → verify wallets in DB
   - Send money between accounts → verify auto-wallet creation

---

## Troubleshooting

### Issue: "User does not have permission to execute function"
**Solution:** Ensure function is granted to `authenticated`:
```sql
GRANT EXECUTE ON FUNCTION public.ensure_recipient_wallet_exists(uuid, text) TO authenticated;
```

### Issue: "Wallet already exists" error
**Solution:** Function returns existing wallet, not an error. Check for `walletError` in code.

### Issue: RLS policy violation still occurs
**Solution:** Direct INSERTs are no longer used. All wallet creation goes through the RPC function.

---

## Next Steps

- Monitor wallet creation performance
- Consider caching frequently created wallets
- Add analytics to track wallet creation patterns
- Document for team on RLS + SECURITY DEFINER pattern usage
