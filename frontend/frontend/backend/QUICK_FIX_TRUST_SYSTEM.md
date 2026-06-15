# 🔧 QUICK FIX CHECKLIST: Trust System 404 Error

## The Problem
```
GET https://hswxazpxcgtqbxeqcxxw.supabase.co/rest/v1/trust_transactions 404
Error: relation "public.trust_transactions" does not exist
```

**Root Cause:** The `trust_transactions` table wasn't created in your Supabase database.

---

## ✅ QUICK FIX (5 minutes)

### Option A: Supabase SQL Editor (EASIEST)
```
1. Open: https://app.supabase.com/project/YOUR_PROJECT_ID/sql/new
2. Copy entire contents of: backend/db/DEPLOY_TRUST_SYSTEM.sql
3. Paste into SQL editor
4. Click "Run"
5. See success message ✓
6. Refresh browser (Ctrl+F5)
7. Test Trust Management feature
```

### Option B: Using psql (Command Line)
```bash
cd C:\Users\Aban\Desktop\ICAN

# Windows:
backend\deploy-trust-system.bat

# Mac/Linux:
bash backend/deploy-trust-system.sh
```

### Option C: Manual psql
```bash
psql -h hswxazpxcgtqbxeqcxxw.supabase.co \
     -U postgres \
     -d postgres \
     -f backend/db/DEPLOY_TRUST_SYSTEM.sql
```
*(You'll be prompted for password)*

---

## 📋 What Gets Fixed

This deployment creates 5 missing tables:

| Table | Purpose |
|-------|---------|
| `trust_groups` | Savings group definitions |
| `trust_group_members` | Membership tracking |
| **`trust_transactions`** | ← **THE MISSING TABLE** |
| `trust_cycles` | Contribution cycles |
| `trust_disputes` | Dispute tracking |

Plus:
- Indexes for performance
- Row Level Security (RLS) policies
- Helper functions

---

## ✓ Verify It Worked

### In Browser
1. Open DevTools (F12)
2. Go to Console tab
3. Should NOT see "trust_transactions does not exist" errors
4. Navigate to Trust Management / SACCOHub
5. Data should load ✓

### In Supabase Dashboard
1. Go to Database → Tables
2. Should see all 5 tables listed
3. Click on `trust_transactions`
4. Should show columns: id, group_id, amount, transaction_type, etc.

---

## 🐛 If It Still Doesn't Work

### Check 1: Did the script actually run?
```sql
-- Copy this into Supabase SQL Editor:
SELECT COUNT(*) as table_count 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE 'trust_%';

-- Should return: 5
```

### Check 2: Is RLS blocking access?
```sql
-- Verify your user is logged in with:
SELECT auth.uid();
-- Should return your user ID (not NULL)
```

### Check 3: Browser cache
- **Windows:** Ctrl + Shift + Delete (clear cache)
- **Mac:** Cmd + Shift + Delete
- Reload page

### Check 4: Wrong project?
- Verify in `frontend/.env` or `frontend/.env.local`:
  ```
  VITE_SUPABASE_URL=https://hswxazpxcgtqbxeqcxxw.supabase.co
  VITE_SUPABASE_ANON_KEY=...
  ```

---

## 📁 Files Related to This Fix

```
backend/
├── db/
│   ├── DEPLOY_TRUST_SYSTEM.sql          ← RUN THIS
│   ├── trust_system_schema.sql           (reference)
│   └── membership_approval_schema.sql    (related)
├── TRUST_SYSTEM_DEPLOYMENT_GUIDE.md     (detailed guide)
├── deploy-trust-system.sh                (Linux/Mac)
└── deploy-trust-system.bat               (Windows)

frontend/
├── src/
│   ├── services/
│   │   └── trustService.js               (now handles missing table gracefully)
│   └── components/
│       ├── TrustSystem.jsx
│       ├── SACCOHub.jsx
│       └── sacco/MySACCOs.jsx            (improved mobile UI)
```

---

## 🚀 Next: Test the Features

After fixing:

1. **View My Trusts**
   - Navigate to SACCOHub
   - Click "My Trusts"
   - Should see your groups

2. **View Details**
   - Click "View Details" on a trust
   - Should show transactions
   - Should show statistics

3. **Create Transaction**
   - Click "Contribute"
   - Enter amount
   - Submit
   - Should create record with blockchain hash

---

## 📞 Still Having Issues?

1. **Check error details in console (F12)**
   - Copy the full error message
   
2. **Verify database connection:**
   - Check `.env` file has correct SUPABASE_URL
   
3. **Look for related files:**
   - `TRUST_SYSTEM_DEPLOYMENT_GUIDE.md` (comprehensive)
   - `trustService.js` error handling

4. **Manual verification:**
   - Open Supabase SQL Editor
   - Run: `SELECT * FROM trust_transactions LIMIT 1;`
   - Should not show "does not exist" error

---

## ⚡ TL;DR (Super Quick)

1. Go to: https://app.supabase.com/project/YOUR-PROJECT/sql/new
2. Copy: `backend/db/DEPLOY_TRUST_SYSTEM.sql`
3. Paste → Run
4. Refresh browser
5. Done ✓

---

**Created:** February 10, 2026  
**Status:** Ready to deploy  
**Estimated Time:** 5 minutes  
