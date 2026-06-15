# Shareholder Signature System - Database Schema Fix

## Issue
SQL Error: `ERROR: 42703: column "investment_id" does not exist`

## Root Cause
The `investment_signatures` table was referencing a non-existent `investment_id` column in the `ican_transactions` table. The actual primary key in `ican_transactions` is `id`, not `investment_id`.

## Solution Applied

### 1. Fixed Foreign Key Reference
**Before**:
```sql
CONSTRAINT fk_investment_id FOREIGN KEY (investment_id) REFERENCES public.ican_transactions(id)
```

**After**:
```sql
CONSTRAINT fk_investment_transaction_id FOREIGN KEY (investment_transaction_id) REFERENCES public.ican_transactions(id)
```

### 2. Updated Column Names
- Changed `investment_id` → `investment_transaction_id` in:
  - Table schema
  - Index names
  - View queries

### 3. Fixed View to Match Actual Table Structure
**ican_transactions actual columns:**
- `id` (UUID) - Primary key
- `user_id` - Investor UUID
- `amount` - Investment amount
- `currency` - Currency code
- `transaction_type` - Type: 'equity', 'partnership', 'support'
- `metadata` (JSONB) - Additional data (shares, pitch_id, etc.)
- `created_at` - Investment timestamp
- `status` - Status: 'pending', 'completed', 'failed'

**Updated VIEW to extract data from metadata:**
```sql
it.metadata->>'shares' as shares
it.metadata->>'pitch_id'::uuid = p.id
it.metadata->>'signature_required'::boolean
it.metadata->>'signatures_required'::integer
```

### 4. Removed Non-Existent Columns
Removed ALTER statements for columns that don't exist:
- `signatures_received`
- `signatures_required`
- `all_signatures_received`

Instead, signatures are tracked in the `investment_signatures` table with proper counts via view.

## Database Structure

### investment_signatures Table
```sql
id                      uuid (PK)
investment_transaction_id  uuid (FK to ican_transactions.id)
shareholder_id          uuid
shareholder_email       text
signature_method        text ('shareholder_pin')
signature_timestamp     timestamp with time zone
pin_masked              text (masked, e.g., '1***9')
machine_id              text
status                  text ('approved', 'pending', 'rejected')
created_at              timestamp with time zone (auto)
updated_at              timestamp with time zone (auto)
```

### Indexes
- `idx_investment_signatures_transaction_id` - Fast transaction lookups
- `idx_investment_signatures_shareholder_id` - Fast shareholder lookups
- `idx_investment_signatures_shareholder_email` - Email-based lookups

### RLS Policies
- Shareholders can view their own signatures
- Shareholders can insert their own signatures (sign agreements)

### View: investment_details_for_shareholders
Returns investment details with signature tracking:
```sql
SELECT
  it.id as investment_id,
  investor_email,
  pitch_title,
  business_name,
  amount,
  currency,
  shares,
  investment_type,
  signature_deadline,
  hours_remaining,
  signatures_received (counted from investment_signatures table),
  signatures_required
FROM ican_transactions...
```

## Code Updates

### ShareholderSignatureModal.jsx
Fixed column reference in insert:
```javascript
// Before:
investment_id: investmentId

// After:
investment_transaction_id: investmentId
```

### ShareSigningFlow.jsx
Already uses correct naming in notification logic:
- `investmentId` - the transaction UUID
- `shareholder.id` - the shareholder UUID
- Correctly passed to modal and database

## Testing

### SQL to Test Installation
```sql
-- Check table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_name = 'investment_signatures'
);

-- Check foreign key works
SELECT * FROM pg_constraints 
WHERE constraint_name = 'fk_investment_transaction_id';

-- Check view works
SELECT * FROM public.investment_details_for_shareholders LIMIT 1;

-- Insert test signature
INSERT INTO public.investment_signatures (
  investment_transaction_id,
  shareholder_id,
  shareholder_email,
  signature_method,
  signature_timestamp,
  status
) VALUES (
  'transaction-uuid-here',
  'shareholder-uuid-here',
  'shareholder@example.com',
  'shareholder_pin',
  now(),
  'approved'
);
```

### Expected Flow
1. ✅ Investor initiates investment (creates ican_transaction)
2. ✅ Notifications sent to shareholders with 24-hour deadline
3. ✅ Shareholder signs agreement via modal (enters PIN)
4. ✅ Signature recorded in investment_signatures table
5. ✅ Investor notified of shareholder approval
6. ✅ Signature count tracked via view

## Next Steps
1. Run the CREATE_INVESTMENT_SIGNATURES.sql file against your Supabase database
2. Verify table was created successfully
3. Test shareholder signature flow end-to-end
4. Monitor logs for any additional schema mismatches

## Reference
- Created: `backend/CREATE_INVESTMENT_SIGNATURES.sql`
- Updated: `frontend/src/components/ShareholderSignatureModal.jsx`
- Updated: `frontend/src/components/ShareSigningFlow.jsx`
- Documentation: `SHAREHOLDER_SIGNATURE_24HR_GUIDE.md`
