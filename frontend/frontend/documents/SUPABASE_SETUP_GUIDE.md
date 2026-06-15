# 🔌 Supabase Setup Guide for ICAN Capital Engine

## Overview
The ICAN Capital Engine now loads transaction data directly from **Supabase** instead of just localStorage. This enables:
- ✅ Real-time data sync across devices
- ✅ NPV/IRR analytics calculations
- ✅ Vital aggregates (monthly income, expense, savings rate)
- ✅ Cloud backup and persistence
- ✅ Firebase → Supabase bridge for seamless integration

---

## Step 1: Create a Supabase Project

1. Go to **https://app.supabase.com**
2. Click **New Project**
3. Choose your organization and region (closest to Uganda recommended)
4. Create password for database
5. Wait for project to initialize (2-3 minutes)

---

## Step 2: Get Your API Keys

1. In Supabase dashboard, go to **Settings → API**
2. Copy these values:
   - **Project URL** (looks like `https://your-project.supabase.co`)
   - **Anon Key** (public key for browser)

---

## Step 3: Configure Environment Variables

1. Open `/frontend/.env.local`
2. Replace placeholders with your Supabase keys:

```env
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGc... (your anon key)
```

3. Save the file

---

## Step 4: Create the Database Schema

Run this SQL in Supabase **SQL Editor**:

1. Go to **Supabase Dashboard → SQL Editor**
2. Click **New Query**
3. Paste the contents of `SUPABASE_FIREBASE_BRIDGE.sql`
4. Click **Run**

This creates:
- `firebase_transactions_sync` table
- `vital_aggregates` view (monthly metrics)
- `cumulative_net_worth` view (running balance)
- `calculate_npv()` function
- `calculate_irr()` function
- `sync_firebase_transaction()` RPC function

---

## Step 5: Enable Row Level Security (Optional but Recommended)

```sql
-- Enable RLS on transactions table
ALTER TABLE firebase_transactions_sync ENABLE ROW LEVEL SECURITY;

-- Allow users to read only their own transactions
CREATE POLICY "Users can view own transactions"
  ON firebase_transactions_sync
  FOR SELECT
  USING (auth.uid()::text = user_id);

-- Allow users to insert their own transactions
CREATE POLICY "Users can insert own transactions"
  ON firebase_transactions_sync
  FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);
```

---

## Step 6: Test the Connection

1. Start the dev server:
```bash
cd frontend
npm run dev
```

2. Open browser console (F12)
3. Look for:
   - ✅ `"Supabase initialized successfully"` — Good!
   - ⚠️ `"Supabase initialization failed"` — Check your keys
   - ✅ `"Loading transactions from Supabase..."` — App is fetching
   - ✅ `"Loaded X transactions from Supabase"` — Success!

---

## Step 7: Sync Your Transactions

When you add a transaction in ICAN:

1. **Saved to localStorage** immediately (offline-first)
2. **Synced to Supabase** in background

Monitor in console:
```
✅ Transactions synced to Supabase
```

---

## How Data Flows

```
Firebase (optional, for AI)
    ↓
React App (ICAN_Capital_Engine.jsx)
    ↓
Supabase (analytics & NPV/IRR)
    ↓
Dashboard (vital aggregates, reports)
```

---

## Using Supabase Analytics

### View Your Transactions
```sql
SELECT * FROM firebase_transactions_sync 
WHERE user_id = 'your-user-id'
ORDER BY firebase_created_at DESC;
```

### Get Monthly Aggregates
```sql
SELECT * FROM vital_aggregates
WHERE user_id = 'your-user-id'
ORDER BY month DESC;
```

### Calculate NPV (10% discount rate)
```sql
SELECT calculate_npv('your-user-id', 0.10) AS npv;
```

### Calculate IRR
```sql
SELECT calculate_irr('your-user-id') AS irr_percent;
```

---

## Troubleshooting

### ❌ "Cannot read properties of null (reading 'from')"
- **Cause**: Supabase not initialized
- **Fix**: Check your `.env.local` has correct URL and Anon Key

### ❌ "Permission denied"
- **Cause**: RLS policy blocking access
- **Fix**: Run the RLS setup SQL above with your actual user ID

### ❌ "Table does not exist"
- **Cause**: Schema not created
- **Fix**: Run the entire `SUPABASE_FIREBASE_BRIDGE.sql` script

### ⚠️ Supabase loading but no data
- **Cause**: No transactions synced yet
- **Fix**: Add a transaction in ICAN, check console for sync messages

---

## What's Next?

1. **Add more transactions** to build up your analytics
2. **View vital aggregates** in the Financial Reports icon
3. **Analyze NPV/IRR** for your opportunities
4. **Enable Firebase AI** for advanced recommendations (optional)

---

## Security Notes

- **Anon Key** is safe to use in browser (has limited permissions)
- **Use RLS** to ensure users only see their own data
- **Never expose** your service role key in frontend code
- **Test with demo data** before using real financial data

---

## Support

For Supabase docs: https://supabase.com/docs
For ICAN features: Check the README.md in root directory
