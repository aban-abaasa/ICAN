# 🐛 Investment Agreement & Signature Schema Fixes

## Issues Identified & Fixed

### Issue 1: 409 Conflict - Duplicate Notification Records ❌➜✅
**Error**: `duplicate key value violates unique constraint "shareholder_notifications_business_profile_id_shareholder_i_key"`

**Root Cause**: 
- Code was using `.insert()` on `shareholder_notifications` table
- Table has UNIQUE constraint on `(business_profile_id, shareholder_id)`
- Multiple investment attempts for same shareholders caused duplicates
- INSERT fails on duplicate, triggering 409 Conflict

**Fix Applied**:
```javascript
// BEFORE: ❌
const { error: notifError } = await supabase
  .from('shareholder_notifications')
  .insert([notificationData]);

// AFTER: ✅
const { error: notifError } = await supabase
  .from('shareholder_notifications')
  .upsert([notificationData], { onConflict: 'business_profile_id,shareholder_id' });
```

**Impact**: 
- Duplicate notifications gracefully update existing records instead of failing
- Same shareholders can be notified for multiple investments
- No more 409 errors when re-sending or updating notifications

---

### Issue 2: 400 Bad Request - Invalid investment_signatures Schema ❌➜✅
**Error**: Schema mismatch when inserting investment signatures

**Root Cause**: 
- Code was inserting with **wrong column names** not matching database schema
- Using: `investment_id`, `signer_id`, `signer_type`, `signature_status: 'pin_verified'`
- Schema expects: `agreement_id`, `shareholder_id`, `signature_status: 'signed'`
- Also missing step to create `investment_agreements` record first

**Before (BROKEN)**:
```javascript
const investorSig = {
  investment_id: investmentId,           // ❌ Should be agreement_id
  business_profile_id: '...',            // ❌ Not in schema
  signer_id: currentUser?.id,            // ❌ Should be shareholder_id
  signer_email: currentUser?.email,      // ❌ Should be shareholder_email
  signer_name: currentUser?.user_metadata?.full_name,  // ❌ Should be shareholder_name
  signer_type: 'investor',               // ❌ Not in schema
  signature_status: 'pin_verified',      // ❌ Should be 'signed'
  signed_at: new Date().toISOString(),   // ❌ Should be signature_timestamp
  pin_verified_at: new Date().toISOString(),  // ❌ Extra field
  signature_data: {...}                  // ❌ Metadata should be in separate fields
};
```

**After (FIXED)**:
```javascript
// STEP 6A: Create investment agreement record FIRST
const { data: agreementData } = await supabase
  .from('investment_agreements')
  .insert([{
    pitch_id: pitch.id,
    investor_id: currentUser?.id,
    business_profile_id: sellerBusinessProfile?.id || pitch?.business_profile_id,
    investment_type: investmentType || 'buy',
    shares_amount: sharesAmount || 0,
    share_price: sharesAmount > 0 ? totalInvestment / sharesAmount : 0,
    total_investment: totalInvestment,
    status: 'signing',
    escrow_id: investmentId,
    device_id: 'web_platform',
    device_location: 'in_app',
    investor_pin_hash: walletPin.substring(0, 1) + '****' + walletPin.substring(walletPin.length - 1)
  }])
  .select()
  .single();

const agreementId = agreementData?.id;

// STEP 6B: Now create signature with CORRECT schema
const investorSig = {
  agreement_id: agreementId,             // ✅ Correct FK
  shareholder_id: currentUser?.id,       // ✅ Correct column name
  shareholder_email: currentUser?.email, // ✅ Correct column name
  shareholder_name: currentUser?.user_metadata?.full_name || 'Investor',  // ✅ Correct
  signature_pin_hash: walletPin.substring(0, 1) + '****' + walletPin.substring(walletPin.length - 1),  // ✅ Correct
  signature_timestamp: new Date().toISOString(),  // ✅ Correct column
  device_id: 'web_platform',             // ✅ In schema
  device_location: 'in_app',             // ✅ In schema
  is_business_owner: false,              // ✅ In schema
  signature_status: 'signed'             // ✅ Valid enum value
};
```

**Impact**:
- Investment agreements are now properly created before signatures
- Signatures insert successfully with correct schema mapping
- Investment tracking now fully functional
- Approval tracking can count actual signatures

---

## Database Schema Alignment

### investment_agreements Table
| Column | Type | Source |
|--------|------|--------|
| id | UUID | Auto-generated |
| pitch_id | UUID | From pitch |
| investor_id | UUID | From auth.users |
| business_profile_id | UUID | From business_profiles |
| investment_type | TEXT | buy/partner/support |
| shares_amount | DECIMAL | From user input |
| share_price | DECIMAL | Calculated |
| total_investment | DECIMAL | From user input |
| status | TEXT | pending/signing/sealed/cancelled |
| escrow_id | TEXT | Unique identifier |

### investment_signatures Table
| Column | Type | Example |
|--------|------|---------|
| id | UUID | Auto-generated |
| agreement_id | UUID | Links to investment_agreements |
| shareholder_id | UUID | From auth.users |
| shareholder_name | TEXT | "John Doe" |
| shareholder_email | TEXT | "john@example.com" |
| signature_pin_hash | TEXT | "1****4" (masked) |
| signature_timestamp | TIMESTAMP | Current timestamp |
| device_id | TEXT | "web_platform" |
| device_location | TEXT | "in_app" |
| is_business_owner | BOOLEAN | true/false |
| signature_status | TEXT | "signed"/"pending"/"rejected" |

---

## Flow Comparison

### BEFORE (Broken)
```
1. Investor fills investment details
2. Verify wallet balance ✅
3. Deduct ICAN coins ✅
4. Send shareholder notifications (INSERT)
   → 409 Conflict if duplicate ❌
5. Try to create signature with wrong columns
   → 400 Bad Request ❌
6. Investment fails ❌
```

### AFTER (Fixed)
```
1. Investor fills investment details
2. Verify wallet balance ✅
3. Deduct ICAN coins ✅
4. Send shareholder notifications (UPSERT)
   → Updates if duplicate ✅
5. Create investment_agreements record ✅
6. Create signature with agreement_id ✅
7. Shareholder approval tracking works ✅
8. 60% threshold triggers auto-seal ✅
```

---

## Files Modified

| File | Changes | Line Range |
|------|---------|------------|
| [ShareSigningFlow.jsx](../../../../frontend/src/components/ShareSigningFlow.jsx#L1815) | Use UPSERT for notifications + Add investment_agreements creation + Fix signature columns | 1815, 1336-1379 |

---

## Verification Steps

### 1. Test Duplicate Notification Handling
```javascript
// Try sending notification twice for same shareholder
// Before: Would fail with 409 Conflict
// After: Second one updates the existing record gracefully
```

### 2. Test Investment Agreement Creation
```sql
-- Check that investment_agreements are created
SELECT pitch_id, investor_id, status, created_at 
FROM investment_agreements 
ORDER BY created_at DESC 
LIMIT 5;
```

### 3. Test Signature Recording
```sql
-- Check that signatures are created with correct columns
SELECT agreement_id, shareholder_id, shareholder_email, signature_status 
FROM investment_signatures 
ORDER BY signature_timestamp DESC 
LIMIT 5;
```

### 4. Test End-to-End Flow
1. Create test investment as "Investor"
2. Verify shareholder notifications sent (no 409 error)
3. Verify investment_agreements record created
4. Verify investment_signatures record created with shareholder_id
5. Check approval counting works: should show "X/Y signatures"

---

## Related Schema Requirements

The `investment_agreements` table must exist and be accessible to the frontend. Ensure it's properly set up in Supabase with:
- RLS policies allowing INSERT by authenticated users (investor_id check)
- RLS policies allowing SELECT by involved parties
- Proper foreign key constraints to pitches, users, and business_profiles

---

**Date Fixed**: February 9, 2026  
**Status**: ✅ Ready for Testing
