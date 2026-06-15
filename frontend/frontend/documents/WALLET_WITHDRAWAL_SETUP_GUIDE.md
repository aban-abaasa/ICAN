# 🚀 ICAN Wallet Withdrawal System - Setup Guide

## Quick Setup (5 minutes)

### Step 1: Create Database Tables in Supabase

1. **Go to Supabase Dashboard** → Your Project → SQL Editor
2. **Create Wallet Accounts Table:**
   - Copy the SQL from: `backend/db/create_wallet_accounts_table.sql`
   - Paste into Supabase SQL Editor
   - Click "Run" ✅

3. **Create Withdrawal History Table:**
   - Copy the SQL from: `CREATE_WITHDRAWAL_HISTORY_TABLE.sql`
   - Paste into Supabase SQL Editor
   - Click "Run" ✅

### Step 2: Ensure transactions Table Exists

If you haven't already, also run: `backend/db/create_wallet_transactions_table.sql`

### Step 3: Backend Is Ready

The backend routes are already implemented in:
- `backend/routes/withdrawalRoutes.js` ✅
- Registered in `backend/server.js` ✅

### Step 4: Frontend Is Ready

The withdraw modal is already integrated in:
- `frontend/src/components/ICANWallet.jsx` ✅

### Step 5: Start Everything

```bash
# Terminal 1: Backend
cd backend
node server.js

# Terminal 2: Frontend (in separate terminal)
cd frontend
npm run dev
```

Open browser: `http://localhost:5173`

---

## Testing Withdrawals

### Test Mobile Money Withdrawal

1. **Login to ICAN Wallet**
2. **Click "Withdraw" tab**
3. **Select Withdrawal Method**: Choose "MTN" (or Airtel/Vodafone)
4. **Enter Details:**
   - Phone: `256701234567` (or any valid format)
   - Amount: `70000`
5. **Click Withdraw**
6. **Expected Result:**
   - ✅ Wallet balance decreases
   - ✅ Transaction appears in history
   - ✅ Success message shown

### Test Bank Withdrawal

1. **Select Method**: Bank Transfer
2. **Enter Details:**
   - Account: `1234567890`
   - Bank: `Stanbic Bank`
   - Amount: `100000`
3. **Click Withdraw**
4. **Expected Result:**
   - ✅ Status shows "pending"
   - ✅ Estimated time: 24-48 hours

---

## Verification Checklist

✅ **Backend Server Running?**
```bash
curl http://localhost:5000/health
# Should return: {"status":"OK",...}
```

✅ **Withdrawal Routes Available?**
```bash
curl http://localhost:5000/api/withdrawals/balance/test-user-id
# Should work (may show 404 for missing wallet, that's OK)
```

✅ **Frontend Showing Withdraw Tab?**
- Open http://localhost:5173
- Look for "Withdraw" tab in wallet

✅ **Database Tables Created?**
- Supabase → Table Editor
- Look for: `wallet_accounts`, `withdrawal_history`, `transactions`

---

## Troubleshooting

### Issue: "table does not exist"
**Solution**: Run the SQL migrations in Supabase SQL Editor

### Issue: "Endpoint not found" (404)
**Solution**: Backend needs restart after code changes
```bash
# Stop: Ctrl+C
# Start: node server.js
```

### Issue: "Not authenticated"
**Solution**: Make sure you're logged in to ICAN Wallet first

### Issue: "Insufficient balance"
**Solution**: Add funds to wallet first (via Deposit tab)

---

## Architecture Summary

```
User Withdrawal Flow:
1. User fills withdraw form
2. Frontend calls /api/withdrawals/mobile-money (or /bank)
3. Backend validates balance
4. Deducts from wallet
5. Calls MTN MOMO Disbursement API (for mobile money)
6. Saves withdrawal record
7. Returns success/failure
8. Frontend updates wallet balance
9. Shows transaction in history
```

---

## File Structure

```
ICAN/
├── backend/
│   ├── routes/
│   │   └── withdrawalRoutes.js ✨ NEW
│   ├── db/
│   │   ├── create_wallet_accounts_table.sql ✨ NEW
│   │   └── create_wallet_transactions_table.sql
│   ├── services/
│   │   └── mtnMomoService.js (uses Disbursement API)
│   └── server.js (routes registered)
│
├── frontend/
│   └── src/
│       └── components/
│           └── ICANWallet.jsx (withdraw modal updated)
│
└── SQL/
    ├── CREATE_WITHDRAWAL_HISTORY_TABLE.sql ✨ NEW
    └── WALLET_WITHDRAWAL_SYSTEM_COMPLETE.md
```

---

## Key Features Implemented

✅ **Mobile Money Withdrawals**
- Real-time processing
- Multiple providers (MTN, Airtel, Vodafone)
- Auto fee calculation (1-2%)

✅ **Bank Withdrawals**
- Queue-based processing
- 24-48 hour timeframe
- Bank name tracking

✅ **Database Integration**
- Automatic wallet creation for new users
- Transaction history tracking
- Row-level security for user data

✅ **Balance Management**
- Pre-withdrawal validation
- Real-time balance updates
- Insufficient balance protection

✅ **Error Handling**
- Clear error messages
- Transaction rollback on failure
- Logging for debugging

---

## Next Steps (Optional Enhancements)

1. **Withdrawal Limits**
   - Set min/max daily limits
   - Add monthly caps

2. **Withdrawal Notifications**
   - Email confirmation
   - SMS alerts
   - Push notifications

3. **Admin Dashboard**
   - View all withdrawals
   - Approve pending bank transfers
   - Refund failed transactions

4. **Analytics**
   - Daily withdrawal reports
   - User withdrawal patterns
   - Fee revenue tracking

5. **Bank Integration**
   - Auto-process bank transfers
   - Real-time bank reconciliation
   - Multi-bank support

---

## Support

If you encounter issues:

1. **Check Backend Logs**: Look at terminal output for errors
2. **Check Browser Console**: F12 → Console tab for frontend errors
3. **Check Supabase Logs**: Supabase Dashboard → Logs
4. **Verify Environment Variables**: Check `backend/.env` has all required vars

---

## Summary

You now have a complete, production-ready withdrawal system where users can:

- 💰 Withdraw money from ICAN Wallet
- 📱 Send to mobile money instantly
- 🏦 Transfer to bank accounts (24-48 hours)
- 📊 Track withdrawal history
- 💡 See real-time balance updates

**Ready to power up ICAN Wallet!** 🚀
