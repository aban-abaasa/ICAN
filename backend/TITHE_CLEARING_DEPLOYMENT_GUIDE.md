# Tithe Payment Clearing System - Deployment Guide

## Overview
This guide explains how to set up and use the automatic tithe clearing system when users make tithe payments.

## Files Involved
- **CLEAR_TITHE_ON_PAYMENT.sql** - Database schema and triggers
- **MobileView.jsx** - Updated with `handlePayTithe()` function that records payments

## How It Works

### Flow:
1. User opens tithe modal and clicks "Pay In" tab
2. User enters payment amount, type (personal/business/combined), recipient name
3. User clicks "Record Tithe Payment"
4. `handlePayTithe()` function:
   - Validates inputs
   - Records transaction to `ican_transactions` table
   - Deducts amount from `user_wallets.balance`
   - Updates `user_profiles.net_worth`
   - Resets tithe rates to 10% (defaults)
   - Closes modal after 2 seconds
5. SQL Trigger (automatic):
   - Fires after transaction is inserted
   - Clears tithe amounts in `user_tithe_tracking` table
   - Sets `last_payment_date` to NOW()

## Step 1: Deploy the Database Schema

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Open `CLEAR_TITHE_ON_PAYMENT.sql`
3. Copy **Section 1** (CREATE TABLE) and execute it:

```sql
CREATE TABLE IF NOT EXISTS user_tithe_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  personal_tithe_accumulated DECIMAL(15,2) DEFAULT 0,
  business_tithe_accumulated DECIMAL(15,2) DEFAULT 0,
  combined_tithe_accumulated DECIMAL(15,2) DEFAULT 0,
  last_payment_date TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);
```

✅ This creates the tracking table with initial zero values.

## Step 2: Deploy the Trigger Function

Copy **Section 4** (TRIGGER FUNCTION) and execute it:

```sql
CREATE OR REPLACE FUNCTION clear_tithe_after_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transaction_type = 'tithe' AND NEW.status = 'completed' THEN
    UPDATE user_tithe_tracking
    SET 
      personal_tithe_accumulated = CASE 
        WHEN (NEW.metadata->>'payment_type' = 'personal' OR NEW.metadata->>'payment_type' = 'combined')
        THEN 0 
        ELSE personal_tithe_accumulated 
      END,
      business_tithe_accumulated = CASE 
        WHEN (NEW.metadata->>'payment_type' = 'business' OR NEW.metadata->>'payment_type' = 'combined')
        THEN 0 
        ELSE business_tithe_accumulated 
      END,
      combined_tithe_accumulated = CASE 
        WHEN NEW.metadata->>'payment_type' = 'combined'
        THEN 0 
        ELSE combined_tithe_accumulated 
      END,
      last_payment_date = NEW.created_at,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_clear_tithe_after_payment ON ican_transactions;

CREATE TRIGGER trigger_clear_tithe_after_payment
AFTER INSERT ON ican_transactions
FOR EACH ROW
EXECUTE FUNCTION clear_tithe_after_payment();
```

✅ This creates the automatic trigger that clears tithe on payment.

## Step 3: Enable RLS (Row Level Security)

Copy **Section 7** and execute it:

```sql
ALTER TABLE user_tithe_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tithe tracking" ON user_tithe_tracking
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own tithe tracking" ON user_tithe_tracking
  FOR UPDATE USING (auth.uid() = user_id);
```

✅ This ensures users can only see/modify their own tithe data.

## Step 4: Initialize User Tithe Records

For existing users, initialize their tithe tracking (sets to zero):

```sql
-- For a specific user (get UUID from auth.users first)
INSERT INTO user_tithe_tracking (user_id, personal_tithe_accumulated, business_tithe_accumulated, combined_tithe_accumulated)
SELECT id, 0, 0, 0 FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
```

Or use the query in Section 0 to get a user's UUID:
```sql
SELECT id, email FROM auth.users WHERE email = 'user@example.com';
```

## Testing the System

### Test 1: Verify Table Creation
```sql
SELECT * FROM user_tithe_tracking LIMIT 5;
```

Expected: Empty table or user records with 0 amounts.

### Test 2: Check a User's Tithe Status (use Section 5)
```sql
-- Get a real user UUID first
SELECT id FROM auth.users LIMIT 1;

-- Then use in this query (replace UUID):
SELECT 
  u.id,
  u.email,
  t.personal_tithe_accumulated,
  t.business_tithe_accumulated,
  t.combined_tithe_accumulated,
  t.last_payment_date
FROM user_tithe_tracking t
INNER JOIN auth.users u ON t.user_id = u.id
WHERE u.id = 'PASTE_REAL_UUID_HERE'::uuid;
```

### Test 3: Verify Trigger Fires
1. Open app and make a tithe payment
2. Check Supabase transaction log to confirm `ican_transactions` record created
3. Run query from Test 2 to verify tithe amounts are now 0

### Test 4: Check All Users with Pending Tithe (use Section 6)
```sql
SELECT 
  u.id,
  u.email,
  t.personal_tithe_accumulated,
  t.business_tithe_accumulated,
  t.combined_tithe_accumulated,
  (t.personal_tithe_accumulated + t.business_tithe_accumulated + t.combined_tithe_accumulated) as total_tithe_owed,
  t.last_payment_date
FROM user_tithe_tracking t
INNER JOIN auth.users u ON t.user_id = u.id
WHERE (t.personal_tithe_accumulated > 0 OR t.business_tithe_accumulated > 0 OR t.combined_tithe_accumulated > 0)
ORDER BY total_tithe_owed DESC;
```

Expected: Shows users who haven't paid their tithe yet.

## Frontend Changes (Already Done)

The `MobileView.jsx` file has been updated with:

1. **handlePayTithe() function** (line ~1432)
   - Validates payment amount
   - Records transaction to Supabase
   - Deducts from wallet balance
   - Updates net_worth
   - Resets tithe rates to 10%
   - Closes modal after 2 seconds

2. **Pay In tab UI** (line ~6130)
   - Amount input with "Use full tithe due" button
   - Payment type selector (Personal/Business/Combined)
   - Recipient name field
   - Optional notes field
   - Success/error messages

## Common Issues & Fixes

### Error: "invalid input syntax for type uuid: 'USER_ID_HERE'"
**Fix:** Don't use the placeholder. Get a real user UUID:
```sql
SELECT id FROM auth.users LIMIT 1;
```
Then copy the UUID and replace the placeholder.

### Trigger not firing
Check that the trigger exists:
```sql
SELECT * FROM information_schema.triggers 
WHERE trigger_name = 'trigger_clear_tithe_after_payment';
```

If missing, re-execute Section 4.

### RLS blocking updates
Verify RLS policies exist:
```sql
SELECT * FROM pg_policies WHERE tablename = 'user_tithe_tracking';
```

If policies are missing, re-execute Section 7.

## Monitoring & Verification

### View all tithe transactions:
```sql
SELECT * FROM ican_transactions 
WHERE transaction_type = 'tithe' 
ORDER BY created_at DESC LIMIT 20;
```

### Check trigger logs:
```sql
SELECT 
  id,
  user_id,
  transaction_type,
  amount,
  status,
  created_at,
  metadata->>'payment_type' as payment_type
FROM ican_transactions
WHERE transaction_type = 'tithe'
ORDER BY created_at DESC
LIMIT 10;
```

### Verify wallet deductions:
```sql
SELECT user_id, wallet_type, balance 
FROM user_wallets 
WHERE wallet_type = 'personal'
ORDER BY updated_at DESC
LIMIT 10;
```

## Summary

✅ **Tithe Payment Flow:**
1. User records payment in app
2. Transaction created in Supabase
3. Wallet deducted automatically
4. Trigger fires and resets tithe amounts to zero
5. User sees success message
6. Modal closes, ready for next tithe cycle

🎯 **Key Points:**
- Tithe amounts ALWAYS reset to zero after payment
- Transaction history preserved for reporting
- Wallet balance reflects payments immediately
- RLS policies protect user data
- Trigger runs automatically on all tithe transactions
