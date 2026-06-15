# Business Profile Members Setup Guide

## Overview

The **Business Profile Members** system ensures that all shareholders and co-owners of a business are properly registered in the system, enabling them to:
- ✅ Receive notifications when investments are made
- ✅ Sign investment agreements
- ✅ Track their shareholding status
- ✅ Access investment documents

## What Was Changed

### 1. **New Database Table: `business_profile_members`**

This table houses all members (co-owners, shareholders, founders) of each business profile.

```sql
CREATE TABLE business_profile_members (
  id UUID PRIMARY KEY,
  business_profile_id UUID REFERENCES business_profiles(id),
  user_id UUID REFERENCES auth.users(id),
  user_email TEXT NOT NULL,
  user_name TEXT NOT NULL,
  role TEXT (Owner, Co-Owner, Shareholder, etc.),
  ownership_share DECIMAL(5,2),
  status TEXT (active, inactive),
  can_sign BOOLEAN,
  can_receive_notifications BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### 2. **Key Features**

#### Notification Routing
- When an investor signs → Business owner + all shareholders get notified
- Notifications include investment details (amount, currency, shares)
- Each person can opt-in/out of notifications

#### Shareholder Signing
- Only members with `can_sign=true` are asked to sign
- 24-hour deadline for signature
- Minimum 60% approval threshold before investment is finalized

#### Membership Management
- Add/remove members from business profile
- Track ownership percentages
- Manage roles (Owner, Shareholder, CTO, CFO, etc.)
- Track member status (active, pending, removed)

## Setup Instructions

### Option 1: Windows (PowerShell)

```powershell
# Navigate to backend directory
cd C:\Users\Aban\Desktop\ICAN\backend

# Run setup script
.\setup-business-members.ps1

# Follow on-screen instructions
```

### Option 2: Linux/Mac (Bash)

```bash
# Navigate to backend directory
cd ~/ICAN/backend

# Run setup script
bash setup-business-members.sh

# Follow on-screen instructions
```

### Option 3: Manual Setup

1. **Create the tables in Supabase:**
   - Go to Supabase Dashboard → SQL Editor
   - Copy entire contents of `BUSINESS_PROFILE_MEMBERS_SETUP.sql`
   - Paste and execute

2. **Set environment variables:**
   - Open `.env` file in backend directory
   - Ensure these variables are set:
     ```
     ENABLE_BUSINESS_OWNER_NOTIFICATIONS=true
     ENABLE_SHAREHOLDER_NOTIFICATIONS=true
     SHAREHOLDER_SIGNATURE_DEADLINE_HOURS=24
     SHAREHOLDER_APPROVAL_THRESHOLD_PERCENT=60
     ```

## Environment Variables

### Required
```
SUPABASE_URL=https://hswxazpxcgtqbxeqcxxw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### Notifications (Recommended)
```
# Enable/disable notifications
ENABLE_BUSINESS_OWNER_NOTIFICATIONS=true
ENABLE_SHAREHOLDER_NOTIFICATIONS=true

# Timeouts and limits
NOTIFICATION_TIMEOUT_MS=5000
SHAREHOLDER_SIGNATURE_DEADLINE_HOURS=24
SHAREHOLDER_APPROVAL_THRESHOLD_PERCENT=60

# Debug features
ALLOW_TEST_NOTIFICATIONS=true
LOG_NOTIFICATIONS=true
```

## Migration from Co-Owners

If you already have co-owners in the `business_co_owners` table, migrate them:

```javascript
// Run in Node.js
const { getSupabase } = require('./services/supabaseService');

const supabase = getSupabase();
const { data, error } = await supabase.rpc('migrate_co_owners_to_members');

if (error) {
  console.error('Migration failed:', error);
} else {
  console.log(`✓ Migrated ${data[0].processed} co-owners`);
  if (data[0].errors > 0) {
    console.warn(`⚠️ ${data[0].errors} errors during migration`);
  }
}
```

## How It Works

### When an Investor Signs:

1. **Investor transfers money to escrow**
   ```
   Wallet: UGX 1,000,000 → Escrow AGENT-KAM-5560
   ```

2. **Business owner is notified immediately**
   ```
   📧 Notification sent to: business_owner@example.com
   Title: "💰 New Equity Investment Received"
   Message: "investor@example.com has transferred UGX 1,000,000 for your pitch..."
   ```

3. **All shareholders are notified to sign** 
   ```
   📧 Notification sent to: shareholder1@example.com
   📧 Notification sent to: shareholder2@example.com
   Title: "✍️ New Signature Request"
   Message: "investor@example.com is requesting your signature... 24-hour deadline"
   ```

4. **Shareholders review and sign with PIN**
   - Each shareholder has 24 hours
   - Minimum 60% must approve
   - Investment is finalized when threshold reached

5. **Final notifications sent**
   ```
   📧 All parties notified of completion
   📥 Documents available for download
   ✅ Investment sealed with QR code
   ```

## Notification Flow Diagram

```
Investor Signs (PIN verified)
         ↓
    ✓ Money to Escrow
         ↓
    📧 Business Owner Notified
         ↓
    📧 Shareholders Notified (24hr deadline)
         ↓
    ✍️ Shareholders Review & Sign
         ↓
    ≥60% Approval?
         ├─ YES → 📧 Final notifications → ✅ Investment Sealed
         └─ NO  → ⏳ Waiting... (24hr window)
```

## Database Schema Visualization

```
business_profiles (1)
         ↓
   1 --------- N
         ↓
business_profile_members
    ├─ Co-Owners (can_sign=true)
    ├─ Shareholders (can_sign=true)
    └─ Investors (can_sign=false, can_receive_notifications=true)

investment_notifications
         ↓
    recipient_id ← user_id from business_profile_members
```

## Verification Commands

### Check if members table exists:
```sql
SELECT COUNT(*) FROM business_profile_members;
```

### View all members of a business:
```sql
SELECT user_name, role, ownership_share, can_sign
FROM business_profile_members
WHERE business_profile_id = 'your-business-id'
ORDER BY ownership_share DESC;
```

### Count signers per business:
```sql
SELECT bp.business_name, COUNT(bpm.id) as member_count
FROM business_profiles bp
LEFT JOIN business_profile_members bpm ON bp.id = bpm.business_profile_id
WHERE bpm.can_sign = true
GROUP BY bp.id;
```

### Check notification eligibility:
```sql
SELECT 
  bpm.user_email,
  bpm.role,
  bpm.can_receive_notifications,
  CASE 
    WHEN bpm.can_sign AND bpm.can_receive_notifications THEN 'Can receive signature requests'
    WHEN bpm.can_receive_notifications THEN 'Can receive updates'
    ELSE 'Notifications disabled'
  END as notification_status
FROM business_profile_members bpm
WHERE bpm.business_profile_id = 'your-business-id';
```

## Troubleshooting

### Issue: "Members not receiving notifications"

**Check 1: Members exist in table**
```sql
SELECT COUNT(*) FROM business_profile_members 
WHERE business_profile_id = 'your-id';
```

**Check 2: Members have notifications enabled**
```sql
SELECT user_email, can_receive_notifications 
FROM business_profile_members
WHERE business_profile_id = 'your-id';
```

**Check 3: Environment variables set**
```javascript
console.log('Notifications enabled:', process.env.ENABLE_SHAREHOLDER_NOTIFICATIONS);
```

### Issue: "Co-owners not migrated"

Run migration function:
```javascript
const supabase = getSupabase();
await supabase.rpc('migrate_co_owners_to_members');
```

Check results:
```javascript
const { data, error } = await supabase
  .from('business_profile_members')
  .select('*')
  .eq('business_profile_id', 'your-id');
  
console.log('Members:', data.length, 'Errors:', error?.message);
```

### Issue: "RLS policy denying access"

Ensure authenticated user is a member:
```sql
SELECT * FROM business_profile_members 
WHERE user_id = auth.uid();
```

If empty, add them as a member.

## Functions Available

### `migrate_co_owners_to_members()`
Migrates existing co-owners from `business_co_owners` table.
```sql
SELECT * FROM migrate_co_owners_to_members();
```

### `add_investment_shareholders_as_members(investment_id, business_profile_id)`
Adds investor as a shareholder member after investment.
```sql
SELECT add_investment_shareholders_as_members(
  '123e4567-e89b-12d3-a456-426614174000'::uuid,
  '223e4567-e89b-12d3-a456-426614174000'::uuid
);
```

### `get_shareholders_for_investment(business_profile_id)`
Gets all signing members of a business.
```sql
SELECT * FROM get_shareholders_for_investment(
  '223e4567-e89b-12d3-a456-426614174000'::uuid
);
```

## Frontend Integration

### In ShareSigningFlow.jsx:

The component already fetches shareholders via:
```javascript
// Gets members with can_sign=true
const shareholders = await getActualShareholders();
```

This function automatically queries `business_profile_members` with proper RLS filtering.

### Sending notifications:

```javascript
// Already integrated in ShareSigningFlow.jsx
await createInvestmentNotification({
  recipient_id: businessOwnerId,  // From business_profile.user_id
  notification_type: 'new_investment_received',
  title: '💰 New Investment Received',
  message: 'Investor transferred amount...',
  priority: 'high'
});
```

## Testing

### Manual test in Supabase:

```sql
-- Check if setup worked
SELECT * FROM business_profile_members LIMIT 5;

-- Test RLS
SELECT * FROM business_profile_members 
WHERE user_id = auth.uid();
```

### Test notifications:

1. Create a business profile with co-owners
2. Create an investment as an investor
3. Sign with PIN
4. Check notifications table:
   ```sql
   SELECT * FROM investment_notifications
   WHERE notification_type = 'new_investment_received'
   ORDER BY created_at DESC LIMIT 10;
   ```

## Best Practices

✅ **DO:**
- Verify all co-owners exist in auth.users before adding to members
- Set `can_receive_notifications=true` for business owners
- Update `updated_at` timestamp when ownership changes
- Use RLS policies to enforce access control
- Log notification sends for debugging

❌ **DON'T:**
- Manually insert into `business_profile_members` without user verification
- Set `can_sign=true` for non-shareholder roles
- Allow multiple members with same role without clear distinction
- Disable notifications entirely without user consent

## Support

For issues:
1. Check troubleshooting section above
2. Review database logs: `SELECT * FROM investment_notifications WHERE error IS NOT NULL`
3. Enable `LOG_NOTIFICATIONS=true` in .env for detailed logs
4. Check ShareSigningFlow.jsx console logs for signature flow details

---

**Version:** 2.0 (Feb 5, 2026)
**Status:** ✅ Ready for Production
