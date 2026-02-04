# 📋 ICAN Wallet Withdrawal - Quick Reference

## ⚡ 60-Second Setup

### Step 1: Supabase (1 minute)
```
1. Open: https://app.supabase.com
2. Go to: SQL Editor
3. Copy entire: SUPABASE_WITHDRAWAL_SETUP.sql
4. Paste into Supabase
5. Click: Run ✅
```

### Step 2: Backend (Already Done! ✅)
```
Routes:     backend/routes/withdrawalRoutes.js ✅
Server:     backend/server.js (already updated) ✅
Services:   Uses mtnMomoService (already integrated) ✅
```

### Step 3: Frontend (Already Done! ✅)
```
Withdraw Modal: ICANWallet.jsx (already updated) ✅
Real API Calls: (now making actual requests) ✅
Balance Updates: (real-time) ✅
```

### Step 4: Start Everything
```bash
# Terminal 1: Backend
cd backend && node server.js

# Terminal 2: Frontend
cd frontend && npm run dev

# Open: http://localhost:5173
```

---

## 🎯 What Users Can Do

| Feature | Mobile Money | Bank |
|---------|--------------|------|
| Speed | Instant ⚡ | 24-48h ⏱️ |
| Providers | MTN, Airtel, Vodafone | Any bank |
| Fee | 1-2% | 2.5% |
| Status | Completed | Pending |

---

## 📱 Test Withdrawal

1. **Login** to wallet
2. **Click**: Withdraw tab
3. **Select**: MTN (or any provider)
4. **Enter**: Phone (256701234567) + Amount (70000)
5. **Click**: Withdraw 💸
6. **See**: Success message ✅
7. **Check**: Balance decreased 👍
8. **View**: In transaction history 📊

---

## 🔍 Verify Setup

```bash
# Check backend running
curl http://localhost:5000/health
# Response: {"status":"OK",...}

# Check withdrawal route
curl http://localhost:5000/api/withdrawals/balance/test
# Response: {"success":true,...} or shows missing wallet
```

---

## 📊 View Withdrawal Data

### In Supabase
```sql
-- All withdrawals
SELECT * FROM public.withdrawal_history 
ORDER BY created_at DESC;

-- User's withdrawals
SELECT * FROM public.withdrawal_history 
WHERE user_id = 'your-user-id'
ORDER BY created_at DESC;

-- Daily stats
SELECT * FROM public.withdrawal_daily_summary;

-- User stats
SELECT * FROM public.user_withdrawal_summary;
```

---

## 🛠️ Troubleshooting

| Problem | Solution |
|---------|----------|
| 404 Not Found | Restart backend: Ctrl+C then node server.js |
| "table does not exist" | Run SUPABASE_WITHDRAWAL_SETUP.sql in Supabase |
| "Not authenticated" | Login to wallet first |
| "Insufficient balance" | Use Deposit tab to add funds |
| "Phone not found" | Check: is transactions table created? |

---

## 📂 All Created Files

```
✨ NEW:
├── backend/routes/withdrawalRoutes.js
├── backend/db/create_wallet_accounts_table.sql
├── CREATE_WITHDRAWAL_HISTORY_TABLE.sql
├── SUPABASE_WITHDRAWAL_SETUP.sql
├── WALLET_WITHDRAWAL_SYSTEM_COMPLETE.md
├── WALLET_WITHDRAWAL_SETUP_GUIDE.md
├── WALLET_WITHDRAWAL_IMPLEMENTATION_SUMMARY.md
└── WALLET_WITHDRAWAL_QUICK_REFERENCE.md (this file!)

✏️ UPDATED:
├── backend/server.js (added withdrawal routes)
└── frontend/src/components/ICANWallet.jsx (withdraw modal)
```

---

## 💰 Withdrawal Flow

```
User Form
   ↓
Frontend Call
   ↓
Backend Validation
   ├─ Auth? ✓
   ├─ Balance? ✓
   ├─ Amount > 0? ✓
   └─ Phone valid? ✓
   ↓
Deduct from Wallet
   ↓
Call MOMO API (mobile) OR Queue (bank)
   ↓
Save Record
   ↓
Return Success
   ↓
Update Frontend
   ├─ Show message ✅
   ├─ Update balance 💰
   └─ Add to history 📊
```

---

## ✅ Feature Checklist

- ✅ Mobile money withdrawals (real-time)
- ✅ Bank withdrawals (24-48h)
- ✅ Balance validation
- ✅ Fee calculation
- ✅ Transaction history
- ✅ Database tracking
- ✅ RLS security
- ✅ Error handling
- ✅ Real-time UI updates
- ✅ Multiple providers

---

## 🎊 You're Done!

Your ICAN Wallet users can now withdraw money. That's it! 🚀

**Questions?** Check the detailed guides:
- Setup: `WALLET_WITHDRAWAL_SETUP_GUIDE.md`
- API: `WALLET_WITHDRAWAL_SYSTEM_COMPLETE.md`
- Summary: `WALLET_WITHDRAWAL_IMPLEMENTATION_SUMMARY.md`

---

## 📞 Support Checklist

- ✅ Backend running on localhost:5000?
- ✅ Frontend running on localhost:5173?
- ✅ Logged into ICAN Wallet?
- ✅ Supabase tables created?
- ✅ Wallet balance > 0?
- ✅ Phone number valid format?

If everything checks ✅ → **Try withdrawal!**

---

**Status**: 🟢 Ready to Use
**Last Updated**: Jan 21, 2026
**System**: ICAN Wallet Withdrawal v1.0
