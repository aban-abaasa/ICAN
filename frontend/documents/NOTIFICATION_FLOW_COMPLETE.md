# 📧 COMPLETE NOTIFICATION FLOW SYSTEM

## Overview
All business members (business owner + all active shareholders) receive notifications when:
1. **A new investment is received** (investor signs)
2. **Shareholder approval is needed** (during signature window)
3. **Investment is finalized** (60% approval threshold met)

---

## 1️⃣ STAGE 1: INVESTOR SIGNS → NOTIFY ALL MEMBERS

### Timeline
```
Investor enters PIN → PIN verified → Wallet transfer → ADD PENDING MEMBER → NOTIFY ALL MEMBERS
```

### What Happens
```javascript
// STEP 9: Notify ALL MEMBERS (Business Owner + All Shareholders)
1. Fetch all ACTIVE members from business_profile_members
   - status = 'active'
   - business_profile_id = businessProfile.id

2. Send notification to BUSINESS OWNER
   - Priority: HIGH
   - Title: "💰 New [Investment Type] Received"
   - Message: "[Investor] has signed and transferred [amount] for [pitch]"
   - Action: "Review Investment"

3. Send notification to ALL OTHER SHAREHOLDERS
   - Priority: HIGH (if can_sign=true) or NORMAL (if can_sign=false)
   - Title: "💰 New [Investment Type]: [pitch name]"
   - Message: "[Investor] has signed... You will need to approve..."
   - Action: "May Need Your Approval" or "View Details"
   - Includes: role, can_sign flag, ownership_share
```

### Example: Gantaelon's Business

**Members before investment:**
```
business_profile_members table:
├─ Gantaelon (50%, active, can_sign=true)
└─ Abana Baasa (50%, active, can_sign=true)
```

**Investor John signs:**
```
Notifications sent:
├─ TO: Gantaelon
│  ├─ Title: "💰 New Equity Investment Received"
│  ├─ Message: "John has signed and transferred ICAN 10,000..."
│  ├─ Priority: HIGH
│  └─ Action: "Review Investment"
│
├─ TO: Abana Baasa
│  ├─ Title: "💰 New Equity Investment: TechStartup Pitch"
│  ├─ Message: "John has signed and transferred ICAN 10,000... You will need to approve..."
│  ├─ Priority: HIGH
│  └─ Action: "May Need Your Approval"
│
└─ John added to business_profile_members
   ├─ Role: Investor
   ├─ Status: PENDING (awaiting approval)
   ├─ can_sign: false
   └─ can_receive_notifications: true
```

---

## 2️⃣ STAGE 2: TRIGGER SHAREHOLDER SIGNATURES (24-Hour Window)

### Timeline
```
After notifications sent → Trigger shareholder signatures (only members with can_sign=true)
```

### What Happens
```javascript
// triggerShareholderNotifications()
1. Get shareholders (members with can_sign=true AND status=active)
2. For each eligible shareholder:
   - Send PIN signature request
   - 24-hour deadline
   - Document available for review
   - Notification tracked in investment_signatures table
```

### Example Timeline

**T=0: Investor signs**
```
✅ John (investor) signs and transfers money
   └─ Notifications sent to: Gantaelon, Abana Baasa
```

**T=0+5min: Shareholder signature phase begins**
```
📬 Signature requests sent to:
   ├─ Gantaelon (50% owner, can_sign=true)
   │  └─ "Please sign to approve John's investment"
   │  └─ Deadline: 24 hours
   └─ Abana Baasa (50% owner, can_sign=true)
      └─ "Please sign to approve John's investment"
      └─ Deadline: 24 hours
```

**T=0+2hrs: Gantaelon signs (100% approval)**
```
✅ Gantaelon signs with PIN
   └─ Approval % = (1/2) × 100% = 50% (below 60% threshold)
   └─ System waits for more signatures
```

**T=0+3hrs: Abana signs (200% approval ≥ 60%)**
```
✅ Abana signs with PIN
   └─ Approval % = (2/2) × 100% = 100% (≥ 60% threshold MET!)
   └─ THRESHOLD MET → Move to finalization
```

---

## 3️⃣ STAGE 3: INVESTMENT FINALIZED (60% Approval Met)

### What Happens
```javascript
// When approval % >= 60% and stage === 7:
1. Record investor shares in investor_shares table
   - status = 'approved'
   - locked_until_threshold = false

2. PROMOTE investor from PENDING → SHAREHOLDER
   - Call: confirm_investor_as_shareholder_after_approval()
   - Update business_profile_members:
     ├─ Role: Investor → Shareholder
     ├─ Status: pending → active
     ├─ can_sign: false → true ✅ NOW CAN VOTE
     └─ ownership_share: calculated

3. Generate QR code seal and finalize documents

4. Send finalization notifications (optional future enhancement)
   - TO: Investor (investment approved)
   - TO: Business owner (investment confirmed)
   - TO: Shareholders (new shareholder joined)
```

### Example: John Promoted to Shareholder

**Before: John as PENDING investor**
```
business_profile_members:
├─ Gantaelon (Co-Founder, 50%, active, can_sign=true)
├─ Abana Baasa (Co-Founder, 50%, active, can_sign=true)
└─ John (Investor, 0%, PENDING, can_sign=false) ← WAITING
```

**After: 60% approval threshold met**
```
business_profile_members:
├─ Gantaelon (Co-Founder, 50%, active, can_sign=true)
├─ Abana Baasa (Co-Founder, 50%, active, can_sign=true)
└─ John (Shareholder, 20%, ACTIVE, can_sign=true) ✅ PROMOTED!
   
investor_shares:
└─ John: 100 shares, status='approved', locked_until_threshold=false
```

---

## 4️⃣ NOTIFICATION TYPES & RECIPIENTS

### Types of Notifications

| Notification Type | Recipient | Priority | Trigger |
|---|---|---|---|
| `new_investment_received` | Business Owner | HIGH | Investor signs (immediate) |
| `new_investment_received` | Shareholders | HIGH/NORMAL | Investor signs (immediate) |
| `approval_request` | Shareholders with can_sign=true | HIGH | After notifications sent (24hr window) |
| `investment_finalized` | All parties | NORMAL | 60% threshold met (future) |
| `shareholder_promoted` | New shareholder + others | NORMAL | John promoted to shareholder (future) |

### Recipients by Member Type

**Business Owner (user_id of business_profile)**
- ✅ Gets notifications immediately when investor signs
- ✅ Can view all member activity
- ✅ Receives all investment-related notifications

**Active Shareholders (status='active', can_sign=true)**
- ✅ Get notified when investor signs
- ✅ Get approval request notifications (24-hour window)
- ✅ Can vote on new investments
- ✅ Can view investment details

**Pending Investors (status='pending', can_sign=false)**
- ✅ Get notifications about their status
- ❌ Cannot vote yet
- ✅ Can view notifications but cannot act

**Inactive Members (status='inactive' or 'removed')**
- ❌ Get no notifications
- ❌ Cannot vote
- ❌ Cannot view investment details

---

## 5️⃣ CURRENT NOTIFICATION FLOW (AFTER UPDATE)

### Step-by-Step Execution

```
┌─────────────────────────────────────────┐
│ INVESTOR SIGNS (ShareSigningFlow.jsx)   │
└─────────────────────────────────────────┘
            │
            │ PIN verified + wallet transfer
            ▼
┌─────────────────────────────────────────┐
│ STEP 8: Add investor as PENDING member  │
│ (add_investor_as_pending_member RPC)    │
└─────────────────────────────────────────┘
            │
            │ Investor now in business_profile_members
            │ with status='pending', can_sign=false
            ▼
┌─────────────────────────────────────────┐
│ STEP 9: NOTIFY ALL ACTIVE MEMBERS ⭐ NEW│
│                                         │
│ 1. Fetch business_profile_members       │
│    WHERE status='active'                │
│                                         │
│ 2. Notify BUSINESS OWNER                │
│    └─ Investment received notification  │
│                                         │
│ 3. Notify ALL SHAREHOLDERS              │
│    └─ For each member (not owner):      │
│        ├─ Check can_sign flag           │
│        ├─ Set priority (HIGH or NORMAL) │
│        ├─ Send tailored message         │
│        └─ Log: [Role] ([name]) notified │
│                                         │
│ 4. Return: (notified_count, failed_count)
└─────────────────────────────────────────┘
            │
            │ All members notified
            ▼
┌─────────────────────────────────────────┐
│ STEP 10: Trigger shareholder signatures │
│ (triggerShareholderNotifications)       │
│                                         │
│ Get members with can_sign=true          │
│ Send 24-hour PIN signature requests     │
└─────────────────────────────────────────┘
            │
            │ Waiting for signatures
            ▼
┌─────────────────────────────────────────┐
│ useEffect: checkAndRecordInvestor()     │
│ (Lines 658-730)                         │
│                                         │
│ Monitor approval_percentage             │
│   = (signatures.length / shareholders)  │
│     × 100                               │
│                                         │
│ If approval_percentage >= 60%:          │
│   ├─ Record investor_shares (approved)  │
│   └─ Promote investor to Shareholder    │
│      (confirm_investor_as_shareholder..)│
└─────────────────────────────────────────┘
            │
            │ Investment FINALIZED ✅
            ▼
┌─────────────────────────────────────────┐
│ COMPLETE                                │
│ John is now a Shareholder               │
│ Can vote on future investments          │
│ Receives all future notifications       │
└─────────────────────────────────────────┘
```

---

## 6️⃣ DATABASE CHANGES REQUIRED

### No new tables needed - uses existing:

**business_profile_members** (already created)
```sql
SELECT * FROM business_profile_members
WHERE business_profile_id = 'uuid'
AND status = 'active'
-- Returns: All active members to notify
```

**investment_notifications** (already exists)
```sql
INSERT INTO investment_notifications (
  recipient_id,          -- Who gets the notification
  sender_id,             -- Who sent it (investor)
  notification_type,     -- 'new_investment_received'
  title,                 -- "💰 New Investment Received"
  message,               -- Full message
  priority,              -- 'high' or 'normal'
  metadata               -- Rich data (role, can_sign, etc)
) VALUES (...)
```

---

## 7️⃣ CODE LOCATION REFERENCE

**File:** [ShareSigningFlow.jsx](frontend/src/components/ShareSigningFlow.jsx)

**Location:** Lines 1054-1145 (STEP 9: Notify All Members)

**Key Variables:**
- `businessProfile.id` - Which business
- `businessProfile.user_id` - Business owner
- `allMembers` - All active members from DB
- `investmentTypeLabel` - "Equity Investment" / "Partnership" / "Support"
- `investorName` - Investor's full name or email
- `totalInvestment` - Amount transferred
- `sharesAmount` - Number of shares (if equity)

**Notification Count:**
```javascript
notifiedCount = total members who received notification
failedCount = members who failed to receive
console.log(`✅ NOTIFICATION SUMMARY:`)
console.log(`   → Total notified: ${notifiedCount}`)
console.log(`   → Failed: ${failedCount}`)
```

---

## 8️⃣ EXAMPLE: FULL NOTIFICATION SEQUENCE

### Setup
```
Business: Gantaelon's Tech Company
Members:
  • Gantaelon (50%, Co-Founder, can_sign=true)
  • Abana Baasa (50%, Co-Founder, can_sign=true)

Investor: John (wants to invest 10,000 ICAN for 100 shares)
```

### Timeline

**T=0:00 - INVESTOR SIGNS**
```
Console Output:
✅ WALLET TRANSFER COMPLETED SUCCESSFULLY
   → Investment ID: [uuid]
   → Investor: john@example.com
   → Amount: ICAN 10,000.00
   → Shares: 100

👤 ADDING INVESTOR AS PENDING MEMBER (awaiting approval)...
✅ Investor added as PENDING member (awaiting shareholder approval)
   → Status: Pending approval
   → Will become shareholder when ≥60% shareholders approve
   → Can_sign: No (will become Yes after approval)

📧 NOTIFYING ALL BUSINESS MEMBERS OF NEW INVESTMENT...
Fetching members from business_profile_members...

✅ Business owner notified: [gantae...]
   ✅ Co-Founder (Gantaelon) notified
   ✅ Co-Founder (Abana Baasa) notified

✅ NOTIFICATION SUMMARY:
   → Total notified: 3 (1 owner + 2 shareholders)
   → Failed: 0
   → Investment announced to all business members
```

**T=0:05 - TRIGGER SHAREHOLDER SIGNATURES**
```
Console Output:
📬 TRIGGERING SHAREHOLDER NOTIFICATIONS...
Getting shareholders for investment...

📋 Found 2 shareholders eligible to sign:
   1. Gantaelon (gantaelon@gmail.com) - 50%
   2. Abana Baasa (abanabaasa2@gmail.com) - 50%

📧 Sending PIN signature requests...
✅ SIGN Notification sent to: Gantaelon
   → Type: Sign Request
   → Deadline: [24-hour timestamp]
   
✅ SIGN Notification sent to: Abana Baasa
   → Type: Sign Request
   → Deadline: [24-hour timestamp]

✅ Total notifications sent: 2/2
✅ Signatures required: 2 (100% for 60% threshold approval)
```

**T=0:30 - GANTAELON SIGNS (50% approval)**
```
Console Output:
✅ Shareholder PIN verified: Gantaelon
✅ Signature recorded for: Gantaelon
   → Signatures so far: 1/2 (50%)
   → 60% threshold: NOT MET (need 1.2 more)
   → Status: Waiting for more signatures...
```

**T=0:35 - ABANA SIGNS (100% approval ≥ 60%)**
```
Console Output:
✅ Shareholder PIN verified: Abana Baasa
✅ Signature recorded for: Abana Baasa
   → Signatures so far: 2/2 (100%)
   → 60% threshold: ✅ MET!

🎯 60% APPROVAL THRESHOLD MET - Recording investor as shareholder...

✅ INVESTOR RECORDED AS SHAREHOLDER:
   → Status: APPROVED (60% threshold met)
   → Shares owned: 100
   → Share price: ICAN 100.00
   → Total value: ICAN 10,000.00

📝 Confirming investor as shareholder member (after approval)...
✅ Investor confirmed as shareholder in business_profile_members
   → Role: Shareholder (confirmed)
   → Status: Active
   → Can receive notifications: Yes
```

**Final State in Database:**
```sql
-- business_profile_members
Gantaelon       → Co-Founder, 50%, active, can_sign=true
Abana Baasa     → Co-Founder, 50%, active, can_sign=true
John            → Shareholder, 100 shares, active, can_sign=true ✅ NEW!

-- investment_notifications
6 records created:
1. Owner notified: new_investment_received
2. Gantaelon notified: new_investment_received  
3. Abana notified: new_investment_received
4. Gantaelon notified: approval_request (sign request)
5. Abana notified: approval_request (sign request)
6. Gantaelon notified: signature_recorded (confirmation)
7. Abana notified: signature_recorded (confirmation)
```

---

## 9️⃣ VERIFICATION QUERIES

### Check all notifications sent to a member
```sql
SELECT 
  notification_type,
  title,
  message,
  created_at,
  is_read
FROM investment_notifications
WHERE recipient_id = '[gantaelon_uuid]'
ORDER BY created_at DESC
LIMIT 10;
```

### Check all members of a business
```sql
SELECT 
  user_name,
  role,
  ownership_share,
  status,
  can_sign,
  can_receive_notifications,
  created_at
FROM business_profile_members
WHERE business_profile_id = '[business_uuid]'
ORDER BY ownership_share DESC;
```

### Count notifications per member
```sql
SELECT 
  recipient_id,
  COUNT(*) as notification_count,
  COUNT(CASE WHEN is_read = false THEN 1 END) as unread_count
FROM investment_notifications
GROUP BY recipient_id
ORDER BY notification_count DESC;
```

---

## 🔟 SUMMARY

✅ **What's new:**
- ALL active members get notified immediately when investor signs
- Business owner gets notified
- All shareholders get notified with tailored messages
- Pending investors are added to the member list (status='pending')
- Shareholders then approve/disapprove with PIN signatures
- After 60% approval, investor is promoted to shareholder status

✅ **Benefits:**
- No member is left out
- Transparent communication
- Clear approval workflow
- Proper investor onboarding (pending → approved)
- Audit trail in investment_notifications table

✅ **Files Modified:**
- [ShareSigningFlow.jsx](frontend/src/components/ShareSigningFlow.jsx) - Lines 1054-1145
- [BUSINESS_PROFILE_MEMBERS_SETUP.sql](backend/BUSINESS_PROFILE_MEMBERS_SETUP.sql) - Already created

---

**Status: ✅ IMPLEMENTATION COMPLETE**

Ready to execute the SQL schema and test the full flow!
