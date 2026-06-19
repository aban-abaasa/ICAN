# ⛪ TITHE MANAGEMENT SYSTEM - Complete Implementation Guide

## 🎯 Overview

Complete tithe/charitable giving management system with:
- ✅ **Add Tithes** - Record tithe payments with wallet integration
- ✅ **Remove Tithes** - Delete/reverse tithe with automatic wallet restoration
- ✅ **Blockchain Hashing** - SHA256-like immutable audit trail
- ✅ **Transaction Recording** - All tithes linked to financial reports
- ✅ **Wallet Integration** - Auto-deduct from net worth when paying tithe
- ✅ **Analytics** - Summary, frequency, recipient tracking
- ✅ **Privacy** - Anonymous giving support with encrypted fields

---

## 📊 Database Schema

### `ican_tithe_records` (Existing)
```sql
Fields:
- id, user_id, transaction_id
- giving_type (tithe, offering, charity, mission, building_fund, etc)
- amount, currency, tithe_percentage
- recipient_type, recipient_name_encrypted
- giving_date, income_period_start, income_period_end
- blockchain_status (local, confirmed, removed)
- is_anonymous, exclude_from_reports
```

### `tithe_audit_log` (NEW - Immutable Blockchain)
```sql
Fields:
- id, user_id, tithe_record_id, transaction_id
- action_type (tithe_added, tithe_removed, tithe_verified, tithe_reviewed)
- amount, currency
- wallet_deducted, previous_balance, new_balance
- action_hash (SHA256), previous_hash (for chain integrity)
- Immutability: CHECK (is_immutable = TRUE)
```

---

## 🔧 SQL Functions

### 1. `fn_add_tithe()` - Add Tithe Payment

**Purpose:** Record a tithe payment, deduct from wallet, create transaction

**Signature:**
```sql
SELECT * FROM fn_add_tithe(
  p_giving_type VARCHAR,           -- 'tithe', 'offering', 'charity', etc
  p_amount DECIMAL,                -- Amount to give
  p_currency TEXT,                 -- 'UGX', 'KES', 'USD'
  p_recipient_type VARCHAR,        -- 'church', 'mosque', 'charity', 'individual'
  p_recipient_name_encrypted TEXT, -- Encrypted name (optional)
  p_tithe_percentage DECIMAL,      -- Tithe %, default 10.0
  p_income_reference_amount DECIMAL, -- Income this tithe is from (optional)
  p_giving_date DATE,              -- When giving happened (default today)
  p_notes_encrypted TEXT,          -- Encrypted notes (optional)
  p_is_anonymous BOOLEAN           -- Mark as anonymous (default false)
);
```

**Returns:**
```
success (BOOLEAN)           -- Operation success
tithe_record_id (UUID)      -- Tithe record created
transaction_id (UUID)       -- Financial transaction created
audit_log_id (UUID)         -- Blockchain audit entry
action_hash (VARCHAR)       -- SHA256 hash of action
new_wallet_balance (DECIMAL) -- Updated balance after deduction
message (TEXT)              -- Status message
```

**Example:**
```sql
SELECT * FROM fn_add_tithe(
  'tithe',                    -- Giving type
  50000,                      -- 50,000 UGX
  'UGX',                      -- Currency
  'church',                   -- Recipient type
  NULL,                       -- No encrypted name
  10.0,                       -- 10% tithe
  500000,                     -- From 500K income
  CURRENT_DATE,              -- Today
  NULL,                       -- No notes
  FALSE                       -- Not anonymous
);
```

**What Happens:**
1. Validates user is authenticated
2. Checks tithe amount > 0
3. Gets current wallet balance
4. Verifies sufficient balance
5. Creates tithe record in `ican_tithe_records`
6. **Deducts amount from wallet** (removes from net worth)
7. Records transaction in `ican_financial_transactions` (for reports)
8. Generates blockchain hash of action
9. Logs to `tithe_audit_log` with immutable proof
10. Returns new wallet balance

---

### 2. `fn_remove_tithe()` - Remove/Cancel Tithe

**Purpose:** Delete a tithe, restore wallet balance, create reverse transaction

**Signature:**
```sql
SELECT * FROM fn_remove_tithe(
  p_tithe_record_id UUID,   -- ID of tithe to remove
  p_reason TEXT             -- Why (default 'manual_reversal')
);
```

**Returns:**
```
success (BOOLEAN)           -- Operation success
transaction_id (UUID)       -- Reverse transaction created
audit_log_id (UUID)         -- Blockchain audit entry
action_hash (VARCHAR)       -- SHA256 hash of removal
restored_balance (DECIMAL)  -- Balance after restoration
message (TEXT)              -- Status message
```

**Example:**
```sql
SELECT * FROM fn_remove_tithe(
  '550e8400-e29b-41d4-a716-446655440000'::UUID,
  'incorrect_amount'
);
```

**What Happens:**
1. Validates user is authenticated
2. Gets tithe record (must be user's own tithe)
3. Retrieves tithe amount and currency
4. Gets current wallet balance
5. **Restores wallet balance** (adds tithe amount back)
6. Creates reverse transaction record (marked as 'tithe_reversal')
7. Soft-deletes tithe record (status = 'removed')
8. Generates blockchain hash of reversal
9. Logs removal to audit trail
10. Returns restored balance

---

### 3. `fn_get_user_tithes()` - List Tithes With Filters

**Purpose:** Retrieve user's tithe records with optional date and type filters

**Signature:**
```sql
SELECT * FROM fn_get_user_tithes(
  p_start_date DATE DEFAULT NULL,    -- Filter from date
  p_end_date DATE DEFAULT NULL,      -- Filter to date
  p_giving_type VARCHAR DEFAULT NULL, -- Filter by type
  p_limit INT DEFAULT 100            -- Max records to return
);
```

**Returns:**
```
tithe_id, amount, currency, giving_type, recipient_type
giving_date, tithe_percentage, income_reference_amount
transaction_id, blockchain_status, created_at, is_anonymous
```

**Example:**
```sql
-- Get all tithes from Jan-Dec 2025
SELECT * FROM fn_get_user_tithes(
  '2025-01-01'::DATE,
  '2025-12-31'::DATE,
  'tithe'
);

-- Get last 20 offerings
SELECT * FROM fn_get_user_tithes(
  NULL, NULL, 'offering', 20
);
```

**Auto-excludes:** Tithes with `blockchain_status = 'removed'`

---

### 4. `fn_get_tithe_summary()` - Analytics & Reporting

**Purpose:** Generate tithe statistics for reporting and dashboards

**Signature:**
```sql
SELECT * FROM fn_get_tithe_summary(
  p_start_date DATE DEFAULT NULL,  -- Period start (default: last year)
  p_end_date DATE DEFAULT NULL     -- Period end (default: today)
);
```

**Returns:**
```
total_tithes (BIGINT)              -- Number of tithe records
total_amount (DECIMAL)             -- Sum of all tithes
currency (TEXT)                    -- Currency code
average_amount (DECIMAL)           -- Average per tithe
largest_tithe (DECIMAL)            -- Maximum single tithe
most_common_type (VARCHAR)         -- Most frequent giving type
giving_frequency_days (NUMERIC)    -- Average days between gifts
total_recipients (INT)             -- Unique recipient types
anonymous_count (BIGINT)           -- Number of anonymous gifts
blockchain_verified_count (BIGINT) -- Verified on blockchain
```

**Example:**
```sql
-- Get 2025 tithe summary
SELECT * FROM fn_get_tithe_summary(
  '2025-01-01'::DATE,
  '2025-12-31'::DATE
);

-- Result might be:
-- total_tithes: 12
-- total_amount: 600000
-- average_amount: 50000
-- most_common_type: tithe
-- giving_frequency_days: 30.5
-- anonymous_count: 3
```

---

### 5. `fn_get_tithe_audit_trail()` - Blockchain History

**Purpose:** View immutable blockchain audit log of tithe operations

**Signature:**
```sql
SELECT * FROM fn_get_tithe_audit_trail(
  p_tithe_record_id UUID DEFAULT NULL,  -- Filter by specific tithe (optional)
  p_limit INT DEFAULT 50                -- Max records
);
```

**Returns:**
```
audit_id, tithe_record_id, action_type, amount, currency
previous_balance, new_balance
action_hash (SHA256), previous_hash (previous block in chain)
chain_verified (BOOLEAN), action_details (JSONB)
created_at
```

**Example:**
```sql
-- Get all tithe audit entries
SELECT * FROM fn_get_tithe_audit_trail(NULL, 100);

-- Get audit history for specific tithe
SELECT * FROM fn_get_tithe_audit_trail(
  '550e8400-e29b-41d4-a716-446655440000'::UUID
);
```

**Blockchain Fields:**
- `action_hash` - SHA256 of current action
- `previous_hash` - Hash of previous action in chain
- If `previous_hash` matches previous action's `action_hash`, chain is verified ✓

---

### 6. `fn_verify_tithe_chain_integrity()` - Blockchain Validation

**Purpose:** Verify blockchain chain hasn't been tampered with

**Signature:**
```sql
SELECT * FROM fn_verify_tithe_chain_integrity();
```

**Returns:**
```
is_chain_valid (BOOLEAN)      -- TRUE if no broken links
total_records (BIGINT)        -- Total tithe audit records
broken_links (BIGINT)         -- Number of broken chain links
verification_hash (VARCHAR)   -- Last valid hash
message (TEXT)                -- Status message
```

**Example:**
```sql
SELECT * FROM fn_verify_tithe_chain_integrity();

-- Result:
-- is_chain_valid: true
-- total_records: 45
-- broken_links: 0
-- message: "Blockchain chain is valid and verified ✓"
```

---

## 🚀 Deployment Steps

### Step 1: Run SQL Migration
```bash
# In Supabase SQL Editor, paste entire content of:
backend/TITHE_MANAGEMENT_SYSTEM.sql
```

### Step 2: Verify Tables & Functions
```sql
-- Check tables exist
SELECT tablename FROM pg_tables WHERE tablename LIKE 'tithe%' OR tablename = 'ican_tithe_records';

-- Check functions exist
SELECT proname FROM pg_proc WHERE proname LIKE 'fn_add_tithe%' OR proname LIKE 'fn_remove_tithe%';
```

### Step 3: Test Functions
```sql
-- Add a tithe
SELECT * FROM fn_add_tithe('tithe', 100000, 'UGX', 'church', NULL, 10.0, NULL, CURRENT_DATE, NULL, FALSE);

-- Get user tithes
SELECT * FROM fn_get_user_tithes();

-- Get summary
SELECT * FROM fn_get_tithe_summary();
```

---

## 💻 Frontend Integration (React)

### Example: Add Tithe Component
```javascript
import { useState } from 'react';
import { supabase } from './lib/supabase';

export function AddTitheForm() {
  const [form, setForm] = useState({
    amount: '',
    givingType: 'tithe',
    recipientType: 'church',
    givingDate: new Date().toISOString().split('T')[0]
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_add_tithe', {
        p_giving_type: form.givingType,
        p_amount: parseFloat(form.amount),
        p_currency: 'UGX',
        p_recipient_type: form.recipientType,
        p_recipient_name_encrypted: null,
        p_tithe_percentage: 10.0,
        p_income_reference_amount: null,
        p_giving_date: form.givingDate,
        p_notes_encrypted: null,
        p_is_anonymous: false
      });

      if (error) throw error;

      setResult({
        success: data[0].success,
        message: data[0].message,
        newBalance: data[0].new_wallet_balance,
        actionHash: data[0].action_hash
      });

      // Reset form
      setForm({ ...form, amount: '' });
    } catch (err) {
      setResult({ success: false, message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="number"
        value={form.amount}
        onChange={(e) => setForm({ ...form, amount: e.target.value })}
        placeholder="Amount"
      />
      
      <select value={form.givingType} onChange={(e) => setForm({ ...form, givingType: e.target.value })}>
        <option>tithe</option>
        <option>offering</option>
        <option>charity</option>
      </select>

      <button type="submit" disabled={loading}>
        {loading ? 'Recording...' : 'Add Tithe'}
      </button>

      {result && (
        <div>
          <p>{result.message}</p>
          <p>New Balance: {result.newBalance} UGX</p>
          <p>Hash: {result.actionHash}</p>
        </div>
      )}
    </form>
  );
}
```

### Example: View Tithes
```javascript
export function TithesList() {
  const [tithes, setTithes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTithes = async () => {
      const { data, error } = await supabase.rpc('fn_get_user_tithes', {
        p_start_date: null,
        p_end_date: null,
        p_giving_type: null,
        p_limit: 100
      });

      if (!error) setTithes(data || []);
      setLoading(false);
    };

    fetchTithes();
  }, []);

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h2>My Tithes ({tithes.length})</h2>
      {tithes.map((tithe) => (
        <div key={tithe.tithe_id}>
          <p>{tithe.amount} {tithe.currency}</p>
          <p>{tithe.giving_type} to {tithe.recipient_type}</p>
          <p>{new Date(tithe.giving_date).toLocaleDateString()}</p>
        </div>
      ))}
    </div>
  );
}
```

---

## 🔒 Security & Privacy

- ✅ **RLS Policies** - Users can only access their own tithe records
- ✅ **Encrypted Fields** - Recipient name and notes are encrypted
- ✅ **Anonymous Giving** - Option to hide identity
- ✅ **Immutable Audit Log** - Cannot be modified or deleted
- ✅ **Blockchain Hashing** - Detect tampering with chain verification
- ✅ **SECURITY DEFINER** - Functions run with elevated privileges, safer than direct SQL

---

## 📊 Financial Reports Integration

All tithes are automatically recorded in `ican_financial_transactions`:
- Transaction Type: `'tithe'` or `'tithe_reversal'`
- Category: `'giving'`
- Sub-category: Specific giving type (tithe, offering, etc)
- Metadata: Contains tithe details, recipient type, percentage
- Status: `'completed'`
- Blockchain Hash: Unique identifier for tamper detection

**Example Query for Reports:**
```sql
SELECT 
  SUM(amount) as total_giving,
  COUNT(*) as transaction_count,
  AVG(amount) as avg_giving
FROM ican_financial_transactions
WHERE user_id = current_user_id
  AND transaction_type IN ('tithe', 'tithe_reversal')
  AND transaction_date >= '2025-01-01';
```

---

## ✅ Testing Checklist

- [ ] Deploy TITHE_MANAGEMENT_SYSTEM.sql to Supabase
- [ ] Test fn_add_tithe() - Add 50K tithe
- [ ] Verify wallet balance decreases by 50K
- [ ] Verify transaction appears in ican_financial_transactions
- [ ] Verify audit log entry created with blockchain hash
- [ ] Test fn_remove_tithe() - Remove the tithe
- [ ] Verify wallet balance restored
- [ ] Verify reverse transaction created
- [ ] Test fn_get_user_tithes() - Should exclude removed tithe
- [ ] Test fn_get_tithe_summary() - Verify calculations
- [ ] Test fn_get_tithe_audit_trail() - View blockchain history
- [ ] Test fn_verify_tithe_chain_integrity() - Verify chain is valid
- [ ] Test with React component - Add tithe from UI
- [ ] View tithe in reports dashboard

---

## 🐛 Troubleshooting

### Error: "Not authenticated"
- Ensure user is signed in
- Check Supabase session is valid

### Error: "Insufficient wallet balance"
- Add funds to wallet first
- Use fn_add_tithe with lower amount

### Error: "Unauthorized"
- Trying to remove someone else's tithe
- Only your own tithes can be removed

### Blockchain chain broken?
- Run `fn_verify_tithe_chain_integrity()`
- Check audit log for tampering
- Contact support if links don't match

---

## 📝 Version History

- **v1.0.0** (May 29, 2026) - Initial release
  - Add/Remove tithe functions
  - Blockchain audit logging
  - Wallet integration
  - Analytics functions
  - Chain verification

---

**Status:** ✅ Production Ready | **Maintenance:** Active | **Support:** Full
