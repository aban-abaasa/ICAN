# 🔴 404 Error - Table Not Found

## Error Explanation

```
404 (Not Found)
POST https://hswxazpxcgtqbxeqcxxw.supabase.co/rest/v1/ican_transactions
```

**Problem**: The `ican_transactions` table doesn't exist in your Supabase database.

---

## Why This Happened

- ✅ Table schema exists in `/backend/db/schemas/01_ican_tables.sql`
- ❌ But table was **never created** in your actual Supabase database
- ❌ Frontend tries to insert transaction data
- ❌ Supabase returns 404: "Table not found"

---

## ✅ How to Fix

### Step 1: Open Supabase SQL Editor

1. Go to **https://app.supabase.com/**
2. Select your project: `ICAN` (or your project name)
3. Go to **SQL Editor** (left sidebar)
4. Click **New Query**

### Step 2: Copy & Run the SQL

1. Open file: `CREATE_ICAN_TRANSACTIONS_TABLE.sql` (in your workspace)
2. Copy **ALL** the SQL code
3. Paste into Supabase SQL Editor
4. Click **Run** button (or Ctrl+Enter)

**Expected Result**:
```
✅ CREATE TABLE
✅ ALTER TABLE
✅ CREATE POLICY (3x)
✅ CREATE INDEX (3x)
✅ Query returned successfully
```

### Step 3: Verify Table Creation

Run this in SQL Editor:
```sql
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'ican_transactions';
```

**Expected Output**:
```
| tablename              |
|------------------------|
| ican_transactions      |
```

---

## 📋 What Gets Created

| Item | Purpose |
|------|---------|
| **Table** `ican_transactions` | Stores all wallet transactions |
| **Columns** | user_id, transaction_type, amount, currency, status, etc. |
| **RLS Policies** | Secure - users only see their own transactions |
| **Indexes** | Fast queries by user_id, status, created_at |

---

## 🚀 After Creation

Once the table is created:

1. ✅ Frontend can insert transactions
2. ✅ Data saves to Supabase
3. ✅ No more 404 errors
4. ✅ Send/Receive/TopUp fully functional
5. ✅ Transaction history available

---

## ⚡ Quick Checklist

- [ ] Opened Supabase SQL Editor
- [ ] Copied `CREATE_ICAN_TRANSACTIONS_TABLE.sql` contents
- [ ] Pasted into SQL Editor
- [ ] Ran the query
- [ ] Verified table exists (SELECT query returned results)
- [ ] Closed the query tab
- [ ] Tried Send Money again

---

## 🔐 Security Note

The SQL automatically creates RLS (Row Level Security) policies:
- Users can only see **their own** transactions
- Users can only insert **their own** transactions
- No user can access other user's transactions
- **This is secure by default** ✅

---

## 📞 If You Get Errors

### Error: "relation 'public.profiles' does not exist"
**Fix**: Create `profiles` table first using similar approach

### Error: "permission denied"
**Fix**: You need admin access or use Supabase UI (dashboard) to create tables

### Error: "already exists"
**Fix**: Table already created - just proceed to testing

---

## ✅ Test After Table Creation

1. Open your app
2. Click **Send Money** button
3. Enter recipient phone: `256701234567`
4. Enter amount: `100`
5. Click **Send**

**Expected**:
- ✅ No 404 error
- ✅ MOMO processes payment
- ✅ Transaction shows success/error
- ✅ Data saved to `ican_transactions` table

---

**👉 Now run the SQL script and test again!**
