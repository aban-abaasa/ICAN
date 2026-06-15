# 📊 EXPECTED CONSOLE OUTPUT

## When Investor Signs - Complete Console Output

```
✅ Escrow transaction created (CREDIT):
   → Amount: ICAN 10,000.00
   → Escrow account: AGENT-KAM-5560

✅ Investor signature recorded in database

✅ Investment approval record created

✅ WALLET TRANSFER COMPLETED SUCCESSFULLY
   → Investment ID: a1b2c3d4-e5f6-g7h8-i9j0
   → Investor: john@example.com
   → Amount: ICAN 10,000.00
   → Shares: 100
   → Transferred to: AGENT-KAM-5560 (Escrow)
   → New account balance: ICAN 5,000.00
   → Transaction Reference: TXN-ABC123DEF

👤 ADDING INVESTOR AS PENDING MEMBER (awaiting approval)...
✅ Investor added as PENDING member (awaiting shareholder approval)
   → Status: Pending approval
   → Will become shareholder when ≥60% shareholders approve
   → Can_sign: No (will become Yes after approval)

📧 NOTIFYING ALL BUSINESS MEMBERS OF NEW INVESTMENT...

✅ Business owner notified: a1b2c3d4e5f6...
   ✅ Co-Founder (Gantaelon) notified
   ✅ Co-Founder (Abana Baasa) notified

✅ NOTIFICATION SUMMARY:
   → Total notified: 3
   → Failed: 0
   → Investment announced to all business members

📬 TRIGGERING SHAREHOLDER NOTIFICATIONS...
Getting shareholders for investment...

📋 Found 2 shareholders eligible to sign:
   1. Gantaelon (gantaelon@gmail.com) - 50%
   2. Abana Baasa (abanabaasa2@gmail.com) - 50%

🕐 24-HOUR SIGNATURE DEADLINE: [Timestamp]

📧 Sending PIN signature requests...

✅ SIGN Notification sent to: Gantaelon
   → Type: Sign Request
   → Deadline: [24-hour timestamp]
   → Notification ID: notif-uuid-001
   → Document: Available for download in notification

✅ Investor notification: ✅ SIGN notification sent to Gantaelon
✅ SIGN Notification sent to: Abana Baasa
   → Type: Sign Request
   → Deadline: [24-hour timestamp]
   → Notification ID: notif-uuid-002
   → Document: Available for download in notification

✅ Investor notification: ✅ SIGN notification sent to Abana Baasa

✅ SIGNATURE REQUEST SUMMARY:
   → Total shareholders notified: 2
   → Failed: 0
   → Waiting for 60% approval (≥1 signature(s))
```

---

## When Shareholders Sign - Console Output

### Gantaelon Signs (50% approval)
```
✅ Shareholder PIN verified: Gantaelon

✅ Signature recorded for: Gantaelon
   → Signature ID: sig-uuid-001
   → Method: Wallet PIN Verification
   → Timestamp: 2026-02-05T14:30:00Z

📊 APPROVAL STATUS:
   → Signatures received: 1/2 (50%)
   → Threshold required: 60%
   → Status: ⏳ Waiting for more signatures...
   → Next: Need 1 more signature (Abana Baasa)
```

### Abana Signs (100% approval ≥ 60%)
```
✅ Shareholder PIN verified: Abana Baasa

✅ Signature recorded for: Abana Baasa
   → Signature ID: sig-uuid-002
   → Method: Wallet PIN Verification
   → Timestamp: 2026-02-05T14:45:00Z

📊 APPROVAL STATUS:
   → Signatures received: 2/2 (100%)
   → Threshold required: 60%
   → Status: ✅ 60% THRESHOLD MET!

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

🎊 INVESTMENT FINALIZED SUCCESSFULLY!
   → John is now a full shareholder
   → Can vote on future investments
   → Ownership share: 100 shares registered
```

---

## Database State After Each Step

### INITIAL STATE (Before Investment)
```
business_profile_members:
┌──────────────────────────────────────────┐
│ Gantaelon      │ Co-Founder │ 50% │ ✅ ACTIVE
│ Abana Baasa    │ Co-Founder │ 50% │ ✅ ACTIVE
└──────────────────────────────────────────┘

investment_notifications: (empty)

investor_shares: (empty)
```

### AFTER INVESTOR SIGNS
```
business_profile_members:
┌──────────────────────────────────────────┐
│ Gantaelon      │ Co-Founder │ 50% │ ✅ ACTIVE
│ Abana Baasa    │ Co-Founder │ 50% │ ✅ ACTIVE
│ John           │ Investor   │ 0%  │ ⏳ PENDING ← NEW
└──────────────────────────────────────────┘

investment_notifications: (6 records)
├─ 1. Gantaelon - new_investment_received (HIGH)
├─ 2. Abana Baasa - new_investment_received (HIGH)
├─ 3. Gantaelon - approval_request (HIGH)
├─ 4. Abana Baasa - approval_request (HIGH)
├─ 5. John (investor) - investor_signature_recorded
└─ 6. Shareholder tracking

investor_shares: (empty - waiting for approval)
```

### AFTER 60% APPROVAL
```
business_profile_members:
┌──────────────────────────────────────────────────┐
│ Gantaelon      │ Co-Founder  │ 50%  │ ✅ ACTIVE
│ Abana Baasa    │ Co-Founder  │ 50%  │ ✅ ACTIVE
│ John           │ Shareholder │ 100  │ ✅ ACTIVE ← PROMOTED!
└──────────────────────────────────────────────────┘

investment_notifications: (8+ records)
├─ ... (all previous)
├─ 7. Gantaelon - approval_threshold_met
├─ 8. Abana Baasa - approval_threshold_met
└─ 9. John - investment_approved

investor_shares: (1 record)
└─ John: 100 shares, status='approved', locked=false
```

---

## Notification Recipients by Role

### Business Owner (Gantaelon - user_id of business_profile)
```
Notifications:
├─ new_investment_received (IMMEDIATE after investor signs)
│  └─ "John has signed and transferred ICAN 10,000..."
│  └─ Priority: HIGH
│
├─ approval_request (During signature window)
│  └─ "Please sign to approve John's investment"
│  └─ Priority: HIGH (because can_sign=true)
│
└─ investment_finalized (After 60% approval)
   └─ "Investment approved! John is now a shareholder"
   └─ Priority: NORMAL
```

### Co-Owner/Shareholder (Abana Baasa)
```
Notifications:
├─ new_investment_received (IMMEDIATE after investor signs)
│  └─ "John has signed and transferred ICAN 10,000... You will need to approve..."
│  └─ Priority: HIGH
│
├─ approval_request (During signature window)
│  └─ "Please sign to approve John's investment"
│  └─ Priority: HIGH (because can_sign=true)
│
└─ investment_finalized (After 60% approval)
   └─ "Investment approved! John is now a shareholder"
   └─ Priority: NORMAL
```

### Investor (John)
```
Notifications:
├─ signature_notification_sent (After shareholders notified)
│  └─ "Notification sent to Gantaelon"
│  └─ Priority: NORMAL
│
├─ signature_notification_sent (After shareholders notified)
│  └─ "Notification sent to Abana Baasa"
│  └─ Priority: NORMAL
│
├─ signature_recorded (When shareholder signs)
│  └─ "Gantaelon has signed your investment agreement"
│  └─ Priority: NORMAL
│
├─ signature_recorded (When another shareholder signs)
│  └─ "Abana Baasa has signed your investment agreement"
│  └─ Priority: NORMAL
│
└─ investment_finalized (After 60% approval)
   └─ "Your investment is approved! You're now a shareholder!"
   └─ Priority: HIGH
```

---

## Notification Metadata Example

### For Business Owner
```json
{
  "recipient_id": "gantaelon-uuid",
  "notification_type": "new_investment_received",
  "title": "💰 New Equity Investment Received",
  "message": "John has signed and transferred ICAN 10,000.00 for your pitch...",
  "priority": "high",
  "metadata": {
    "investment_id": "a1b2c3d4-...",
    "investor_id": "john-uuid",
    "investor_email": "john@example.com",
    "amount": 10000,
    "currency": "ICAN",
    "shares": 100,
    "investment_type": "buy",
    "notification_sent_to": "business_owner"
  }
}
```

### For Shareholder
```json
{
  "recipient_id": "abana-uuid",
  "notification_type": "new_investment_received",
  "title": "💰 New Equity Investment: TechStartup Pitch",
  "message": "John has signed and transferred ICAN 10,000.00 for TechStartup Pitch. Shares: 100. You will need to approve this investment when prompted.",
  "priority": "high",
  "metadata": {
    "investment_id": "a1b2c3d4-...",
    "investor_id": "john-uuid",
    "investor_email": "john@example.com",
    "amount": 10000,
    "currency": "ICAN",
    "shares": 100,
    "investment_type": "buy",
    "notification_sent_to": "shareholder",
    "recipient_role": "Co-Founder",
    "can_sign": true,
    "ownership_share": 50
  }
}
```

---

## Summary Table

| Step | Action | Notifications | Recipients |
|------|--------|---|---|
| 1 | Investor signs | new_investment_received | Gantaelon, Abana, John (status only) |
| 2 | Add pending member | (internal only) | John added with status=pending |
| 3 | Trigger signatures | approval_request | Gantaelon, Abana (can_sign=true) |
| 4 | Gantaelon signs | signature_recorded | John, Gantaelon (internal) |
| 5 | Abana signs | signature_recorded | John, Abana (internal) |
| 6 | 60% threshold met | investment_finalized | John, Gantaelon, Abana |
| 7 | Promote investor | (internal only) | John status changed to active |

---

## Error Handling

### If Member Notification Fails
```
⚠️ Failed to notify Abana Baasa: [Error message]
```
- System continues (doesn't stop the investment)
- Error logged but investment still recorded
- User can retry notification manually

### If Pending Member Add Fails
```
⚠️ Could not add pending member: [Error message]
- System continues (shareholder can approve anyway)
- Investor just won't show as "pending" temporarily
```

### If Shareholder Fetch Fails
```
⚠️ Could not fetch members for notification: [Error message]
- Falls back to notifying business owner only
- Error is logged
- Investment still proceeds
```

---

## Verification Commands

### Check all notifications for a user
```javascript
const notifications = await supabase
  .from('investment_notifications')
  .select('*')
  .eq('recipient_id', userId)
  .order('created_at', { ascending: false });
```

### Check business members
```javascript
const members = await supabase
  .from('business_profile_members')
  .select('*')
  .eq('business_profile_id', businessId)
  .order('ownership_share', { ascending: false });
```

### Count unread notifications
```javascript
const unread = await supabase
  .from('investment_notifications')
  .select('*')
  .eq('recipient_id', userId)
  .eq('is_read', false);
```

---

**Status: ✅ DOCUMENTATION COMPLETE**

All console outputs, database states, and notification flows are documented above!
