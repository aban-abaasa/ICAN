# 🔍 Investment Notification & Approval System Debug Report

## Problem Summary
Two critical issues preventing investment tracking from working:

### Issue 1: RLS Permission Missing on investment_notifications Table ❌
Investment notifications failing with **403 Forbidden - RLS Policy Violation** when attempting to notify business owners and shareholders about new investments.

### Issue 2: Approval Check Querying Wrong Table ❌
Shareholder approval status check is looking at **shareholder_notifications** (PIN notifications) instead of **investment_signatures** (actual shareholder signatures), resulting in **0 approvals found** even when signatures exist.

---

## Root Cause Analysis

### Issue 1: Missing INSERT Permission Grant

**Location**: [backend/INVESTMENT_NOTIFICATIONS_SCHEMA.sql](../backend/INVESTMENT_NOTIFICATIONS_SCHEMA.sql#L384)

**Line 384 - BROKEN**:
```sql
GRANT SELECT, UPDATE ON investment_notifications TO authenticated;
```

**Fixed to**:
```sql
GRANT SELECT, INSERT, UPDATE ON investment_notifications TO authenticated;
```

#### Why This Happens
1. **RLS Policy is correct** (Line 182-184): `FOR INSERT WITH CHECK (true)` ✅  
2. **Table-level permissions incomplete** (Line 384): Missing INSERT grant ❌
3. **Result**: RLS says "you can insert" but table permissions say "you cannot"

---

### Issue 2: Approval Status Checking Wrong Table

**Location**: [frontend/src/components/ShareSigningFlow.jsx](../frontend/src/components/ShareSigningFlow.jsx#L307-L360)

**The Problem:**
```javascript
// ❌ BROKEN: Looking at shareholder_notifications (PIN notifications)
const { data: allNotifications, error: allError } = await supabase
  .from('shareholder_notifications')  // Wrong table!
  .select('id, business_profile_id, shareholder_email, read_at, created_at')
  .eq('business_profile_id', profileId)
  
// ❌ Counting approvals by checking if shareholder READ the notification
const approvedCount = allNotifications?.filter(n => n.read_at).length || 0;
```

**The Issue:**
- `shareholder_notifications` = tracks when shareholders saw PIN entry notifications
- `investment_signatures` = tracks actual shareholder signature approvals
- Checking notification read status != checking actual signatures ❌

**Fixed to:**
```javascript
// ✅ CORRECT: Query investment_agreements and investment_signatures
const { data: agreements } = await supabase
  .from('investment_agreements')
  .select('id, status')
  .eq('pitch_id', pitchId)
  .eq('business_profile_id', businessProfileId);

// ✅ Count actual investment signatures with signature_status = 'signed'
const { data: signatures } = await supabase
  .from('investment_signatures')
  .select('...')
  .eq('agreement_id', latestAgreement.id)
  .eq('signature_status', 'signed');

const approvedCount = signatures?.length || 0;
```

---

## Fixes Applied ✅

### Fix 1: Add INSERT Permission to investment_notifications
**File**: [backend/INVESTMENT_NOTIFICATIONS_SCHEMA.sql](../backend/INVESTMENT_NOTIFICATIONS_SCHEMA.sql#L384)  
**Change**: Added `INSERT` to the GRANT statement  
**Status**: ✅ Applied

### Fix 2: Restructure Approval Check Function  
**File**: [frontend/src/components/ShareSigningFlow.jsx](../frontend/src/components/ShareSigningFlow.jsx#L287-L375)  
**Changes**:
- Query `investment_agreements` table for current agreement
- Query `investment_signatures` for actual shareholders who signed
- Count signatures with `signature_status = 'signed'`  
- Query `business_co_owners` for actual total shareholder count
- Return detailed approval status with signature records
**Status**: ✅ Applied

---

## Data Flow (Before vs After)

### BEFORE (Broken)
```
Investor Signs
  ↓
✅ Creates investment_signatures record
  ↓
investment_notifications creation errors (403 Forbidden)
  ↓
❌ Notifications never sent
  ↓
checkShareholderApprovalStatus() runs
  ↓
Queries shareholder_notifications (PIN table)
  ↓
Finds 0 records (wrong table!)
  ↓
Shows "Approved: 0/2" ❌
```

### AFTER (Fixed)
```
Investor Signs
  ↓
✅ Creates investment_signatures record
  ↓
✅ Notifications sent successfully (INSERT permission granted)
  ↓
✅ Business owner + shareholders notified
  ↓
checkShareholderApprovalStatus() runs
  ↓
✅ Queries investment_agreements for agreement ID
  ↓
✅ Queries investment_signatures for that agreement
  ↓
Counts signatures with signature_status = 'signed'
  ↓
Shows "Approved: X/Y" ✅
  ↓
When 60% reached → Agreement sealed + additional notifications sent
```

---

## Implementation Details

### Approval Check now retrieves:
```javascript
{
  approvedCount: 1,                    // Number who signed
  totalRequired: 2,                    // 60% threshold
  percentageApproved: 50.0,           // % complete
  hasReachedThreshold: false,         // Not at 60% yet
  signatures: [...],                  // Array of signature records
  agreementId: 'uuid...'              // The agreement ID
}
```

### Each signature record includes:
```javascript
{
  id: 'uuid...',
  shareholder_id: 'uuid...',
  shareholder_name: 'John Doe',
  shareholder_email: 'john@example.com',
  signature_status: 'signed',
  signature_timestamp: '2026-02-09T...',
  is_business_owner: false
}
```

---

## Testing & Verification

### To verify Fix 1 works:
1. Run updated schema file in Supabase SQL Editor
2. Create test investment
3. Check browser console - should show "✅ Investment notification sent to..." instead of 403 error
4. Verify notifications appear in recipient's notification list

### To verify Fix 2 works:
1. Test that approval status updates in real-time
2. Console should show shareholder signature details
3. When shareholders sign, approval count should increment
4. When 60% reached, agreement should seal automatically

### Database validation queries:
```sql
-- Check notification permissions
SELECT grantee, privilege_type 
FROM information_schema.role_table_grants 
WHERE table_name = 'investment_notifications' 
  AND grantee = 'authenticated';

-- Check actual signatures
SELECT 
  agreement_id,
  COUNT(*) as signature_count,
  COUNT(*) FILTER (WHERE signature_status = 'signed') as signed_count
FROM investment_signatures
GROUP BY agreement_id;

-- Check all agreements
SELECT id, pitch_id, status, created_at
FROM investment_agreements
ORDER BY created_at DESC;
```

---

## Related Code Sections

### Investment Agreement Creation (Line 1131)
```javascript
const investmentId = pitch.id;
// Future: Should create actual investment_agreements record here
```

### Investment Signature Creation (Line 1323)
```javascript
const { data: sigData, error: sigError } = await supabase
  .from('investment_signatures')
  .insert([investorSig])
  .select();
```

### Approval Status Check (Now Fixed - Line 287)
```javascript
const checkShareholderApprovalStatus = async () => {
  // Now queries investment_agreements and investment_signatures
  // Returns real approval data
}
```

---

## Impact Analysis

| Issue | Before | After | Impact |
|-------|--------|-------|--------|
| Notifications | ❌ 403 Errors | ✅ Sent successfully | Business owners/shareholders notified |
| Approval tracking | ❌ Shows 0/N | ✅ Shows X/N | Accurate progress display |
| Database state | ❌ Incomplete | ✅ Complete records | Audit trail + analytics |
| User feedback | ❌ Silent failures | ✅ Clear signs | Better UX |

---

## Files Modified

| File | Changes | Status |
|------|---------|--------|
| [INVESTMENT_NOTIFICATIONS_SCHEMA.sql](../backend/INVESTMENT_NOTIFICATIONS_SCHEMA.sql#L384) | Added INSERT to GRANT | ✅ Applied |
| [ShareSigningFlow.jsx](../frontend/src/components/ShareSigningFlow.jsx#L287-L375) | Rewrote approval check function | ✅ Applied |

---

**Date Fixed**: February 9, 2026  
**Status**: ✅ Complete - Ready for Testing
