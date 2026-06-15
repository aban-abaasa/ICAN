# Shareholder Signature & 24-Hour Review Period - Implementation Guide

## Overview
This system enables shareholders/co-owners to review and sign investment agreements within a 24-hour window after an investor initiates an investment.

## Architecture

### Components

#### 1. ShareSigningFlow (Updated)
**File**: `frontend/src/components/ShareSigningFlow.jsx`

**New Features**:
- Tracks shareholder notifications with timestamps
- Sends notifications with 24-hour deadline when investor signs
- Stores notification send time for countdown tracking
- Integrates ShareholderSignatureModal for shareholder approvals

**New State Variables**:
```javascript
const [shareholderNotifications, setShareholderNotifications] = useState({});
const [notificationsSentTime, setNotificationsSentTime] = useState(null);
const [showShareholderSignatureModal, setShowShareholderSignatureModal] = useState(false);
const [currentShareholderSigning, setCurrentShareholderSigning] = useState(null);
```

#### 2. ShareholderSignatureModal (New)
**File**: `frontend/src/components/ShareholderSignatureModal.jsx`

**Stages**:
- **Stage 0**: Review investment details & documents
- **Stage 1**: Enter PIN for signature
- **Stage 2**: Confirmation of signed agreement

**Features**:
- ✅ 24-hour countdown timer with visual progress
- ✅ Investment details display
- ✅ Document preview
- ✅ PIN-based signature (masked and secured)
- ✅ Automatic investor notification when shareholder signs
- ✅ Time-based expiration (reverts to Stage 0 if deadline passes)

### Database Schema

#### New Table: investment_signatures
```sql
CREATE TABLE public.investment_signatures (
  id uuid PRIMARY KEY,
  investment_id uuid NOT NULL,
  shareholder_id uuid NOT NULL,
  shareholder_email text NOT NULL,
  signature_method text NOT NULL, -- 'shareholder_pin', 'biometric', etc
  signature_timestamp timestamp,
  pin_masked text,                 -- Masked PIN
  machine_id text,                 -- Device ID
  status text,                      -- 'approved', 'pending', 'rejected'
  created_at timestamp,
  updated_at timestamp
);
```

**Indexes**:
- `idx_investment_signatures_investment_id` - Fast investment lookups
- `idx_investment_signatures_shareholder_id` - Fast shareholder lookups
- `idx_investment_signatures_shareholder_email` - Email-based lookups

**RLS Policies**:
- Shareholders can view their own signatures
- Shareholders can sign investments

#### Updated: ican_transactions Table
New columns to track signatures:
```sql
signature_required boolean             -- Whether signatures needed
signature_deadline timestamp           -- 24-hour deadline
signatures_received integer            -- Count of signatures received
signatures_required integer            -- How many needed
all_signatures_received boolean        -- All requirements met
```

#### New View: investment_details_for_shareholders
Provides shareholders with complete investment information including:
- Investor email
- Pitch details
- Business information
- Investment amount and currency
- Remaining hours for review period
- Signature requirements

## Workflow

### Step 1: Investor Initiates Investment (Stage 6)
```
Investor flow:
↓
Stage 6: PIN Verification
↓
PIN Verified ✓
↓
Generate QR Code + Escrow ID
↓
Trigger shareholder notifications (24-hour deadline)
↓
Move to Stage 7: Pending Shareholder Signatures
```

### Step 2: Shareholders Receive Notification
Shareholders receive notification containing:
- Investment details
- 24-hour deadline
- Signature link: `/investor/signature/{investmentId}/{shareholderId}`

**Notification Fields**:
```javascript
{
  user_id: shareholder.id,
  notification_type: 'shareholder_signature_request',
  title: '🔐 Signature Request (24hr deadline): Pitch Title',
  message: 'Investor email is requesting signature...',
  related_id: investmentId,
  action_url: `/investor/signature/${investmentId}/${shareholderId}`,
  deadline: ISO 8601 timestamp (24 hours from now),
  read: false
}
```

### Step 3: Shareholder Reviews & Signs (Modal)
**Stage 0 - Review**:
- View investment details (pitch, business, amount, shares)
- View investment documents (if provided)
- 24-hour countdown timer with progress bar
- Expiration warning if time runs out

**Stage 1 - PIN Entry**:
- Enter PIN (minimum 4 digits)
- Confirm PIN matches
- Real-time validation feedback

**Stage 2 - Confirmation**:
- Signature recorded and verified
- Investor is notified
- Modal auto-closes after 3 seconds

### Step 4: Signature Recorded in Database
```sql
INSERT INTO investment_signatures (
  investment_id,
  shareholder_id,
  shareholder_email,
  signature_method,
  signature_timestamp,
  pin_masked,
  status
) VALUES (...)
```

### Step 5: Investor Notified
Investor receives notification:
```javascript
{
  user_id: investor.id,
  notification_type: 'shareholder_signed',
  title: `Shareholder Approval - Pitch Title`,
  message: `shareholder@email.com has signed and approved the investment agreement`
}
```

### Step 6: Threshold Check (Stage 7 → Stage 8)
When required number of signatures received:
- Update `all_signatures_received = true` in ican_transactions
- Move to Stage 8: Investment Finalized
- Generate final QR code seal
- Print/download agreement

## 24-Hour Review Period

### Countdown Timer
- Starts when investor signs (stage 6 → 7)
- Shows: Hours : Minutes : Seconds
- Visual progress bar (100% → 0%)
- Color changes: Blue → Orange → Red as deadline approaches
- Expires after 24 hours (cannot sign after deadline)

### Deadline Enforcement
```javascript
const deadline = investmentTime + (24 * 60 * 60 * 1000);
const remaining = deadline - now;

if (remaining <= 0) {
  setTimeRemaining({ expired: true });
  // Disable signing, show expiration message
}
```

## API Integration

### Supabase Tables to Create/Update
Run this SQL:
```bash
psql -U postgres -h localhost -d ican_db < backend/CREATE_INVESTMENT_SIGNATURES.sql
```

### Notification Flow
1. `triggerShareholderNotifications()` in ShareSigningFlow
   - Gets all real shareholders
   - Creates notification for each in database
   - Tracks notification send time

2. Shareholder clicks notification link
   - Opens ShareholderSignatureModal
   - Initializes 24-hour countdown
   - Shows investment details

3. Shareholder enters PIN and confirms
   - Records signature in `investment_signatures` table
   - Notifies investor in real-time
   - Updates investment signature count

## Configuration

### Timeline
- **Investor Action**: Signs agreement with PIN (Stage 6)
- **Notification Sent**: Immediately to all shareholders
- **Review Period**: 24 hours from notification
- **Signature Deadline**: Auto-calculated as `created_at + 24 hours`
- **Expiration**: After 24 hours, shareholders cannot sign
- **Finalization**: When 60% (or required %) shareholders signed

### PIN Requirements
- Minimum: 4 digits
- Maximum: 10 digits
- Stored masked: `1***9` format
- Not stored in plain text
- Used only for verification

### Currency Support
- Investment currency locked to user's registered country
- Amounts displayed with proper formatting
- Multi-currency support for different shareholders

## Testing Scenarios

### Scenario 1: Real Shareholders (Database)
1. Create business profile with 3 co-owners (real user IDs)
2. Investor initiates investment
3. All 3 shareholders receive real notifications
4. Each shareholder signs within 24 hours
5. Investment finalizes after 60% approve

### Scenario 2: Mock Shareholders (Demo)
1. Business profile with mock shareholder IDs
2. Investor initiates investment
3. Console logs show mock notifications
4. Can simulate signatures in Stage 7
5. Investment shows "pending" status

### Scenario 3: Deadline Expiration
1. Create investment
2. Wait 24 hours (or simulate time skip)
3. Try to sign - should show "Deadline expired" message
4. Cannot sign after deadline
5. Investment remains "pending_signatures"

## Error Handling

### Shareholder Signature Failures
```javascript
try {
  // Validate PIN
  // Insert signature record
  // Notify investor
} catch (err) {
  setError(err.message);
  // User can retry
}
```

### Notification Failures
- If shareholder notification fails: Log warning, continue
- Investment proceeds even if notification delivery fails
- Shareholder can access signature page via direct link
- Investor can resend notification manually (future feature)

### Deadline Expiration
- Modal shows "Deadline expired" message
- Signature button disabled
- Time remaining shows "0h 0m 0s"
- Expired status recorded for audit trail

## Security

### PIN Protection
- Minimum 4 digits required
- Masked in database (1***9 format)
- Not transmitted in plain text
- Unique per shareholder per investment
- Device/machine ID tracked for audit

### RLS Policies
- Shareholders can only see their own signatures
- Can only sign investments they're co-owners of
- Investors can view signatures for their investments
- System can access for audit/reporting

### Audit Trail
- All signatures recorded with timestamp
- Device/machine ID for location tracking
- Shareholder email and ID stored
- Status change history
- Automatically created_at/updated_at

## Logging & Debugging

### Console Output Examples
```
📢 Sending 3 shareholder notifications for investment ABC123...
⏰ Signature deadline: Feb 4, 2026, 2:00 PM
✅ Notification sent to: John Doe (john@example.com)
   → Deadline: Feb 4, 2026, 2:00 PM
🎭 [MOCK SHAREHOLDER] Would send signature request to: Jane Smith (jane@example.com)
   → Amount: UGX 5,000,000 for 10 shares
   → Status: Pending signature (24-hour review period)

✅ Shareholder Notification Summary:
   ✓ Real notifications sent: 2
   🎭 Mock notifications (demo): 1
   Total: 3/3
   Deadline: 24 hours from now
```

### Shareholder Signature Logs
```
✅ Shareholder signature recorded: John Doe
   Investment: INV-ABC123
   Timestamp: Feb 3, 2026, 2:15 PM
   Status: approved
✅ Investor notified of shareholder signature
```

## Future Enhancements

1. **Biometric Signatures**: Replace PIN with fingerprint/face ID
2. **Email Reminders**: Auto-send reminders at 12h, 6h, 1h before deadline
3. **Signature Templates**: Pre-filled agreements based on investment type
4. **Multi-language Support**: Notifications in shareholder's preferred language
5. **Document Attachments**: Include full agreement PDF in notification
6. **Signature Rejection**: Allow shareholders to reject with reason
7. **Signature History**: Audit trail of all past signatures
8. **Bulk Signature Dashboard**: Shareholders see all pending signatures in one place
9. **Electronic Signatures**: Integration with DocuSign or similar services
10. **Signature Analytics**: Track average signature time, rejection rates, etc.

## Troubleshooting

### Shareholder not receiving notification
1. Check `notifications` table for record
2. Verify shareholder user_id is correct
3. Check RLS policies allow user access
4. Verify email in `business_co_owners` matches profile email
5. Check notification service/email provider status

### Countdown timer not working
1. Verify `notificationsSentTime` is set
2. Check browser console for JavaScript errors
3. Ensure investment has `created_at` timestamp
4. Verify system clock is correct

### Signature not recording
1. Check `investment_signatures` table has required permissions
2. Verify shareholder_id matches authenticated user
3. Check RLS policies allow INSERT
4. Verify investmentId is valid UUID
5. Check PIN requirements (4+ digits)

### Investor not notified of signature
1. Check investor user_id in investment record
2. Verify `notifications` table accessible
3. Check if notification was created (SELECT count from notifications)
4. Verify investor has permission to read notifications

## Reference Links

- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [ICAN Investment Flow Documentation](./NOTIFICATION_FIX_GUIDE.md)
