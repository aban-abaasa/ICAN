# Investment Notifications - Fix Implementation Guide

## Problem Fixed
Notifications were being created but not appearing in the UI. Root causes:
1. ❌ **Wrong table**: `createNotification()` was writing to `notifications` table, but NotificationBell reads from `investment_notifications`
2. ❌ **Recipient limitation**: `createNotification()` only allowed notifications for current user (RLS bypass)
3. ❌ **Schema mismatch**: Field names weren't matching the database schema

## Solution Implemented

### 1. **New Function: `createInvestmentNotification()`** 
   - **File**: `frontend/src/services/pitchingService.js`
   - **Writes to**: `investment_notifications` table (correct table)
   - **Supports**: Any recipient (not just current user)
   - **Auto-populated fields**:
     - `sender_id`: Current user's ID
     - `recipient_id`: Target shareholder (REQUIRED)
     - `notification_type`: Type of notification (REQUIRED)
     - `title`, `message`: Notification content
     - `pitch_id`, `agreement_id`, `business_profile_id`: Related entities
     - `priority`: 'low', 'normal', 'high', 'urgent'
     - `action_url`, `action_label`: Deep linking
     - `metadata`: JSON for flexible data
   - **Returns**: `{ success: true/false, data: notification, error: message }`

### 2. **Updated ShareSigningFlow Component**
   - **File**: `frontend/src/components/ShareSigningFlow.jsx`
   - **Import changed**: Added `createInvestmentNotification` to imports
   - **Function**: `triggerShareholderNotifications()` now:
     - Uses `createInvestmentNotification()` instead of `createNotification()`
     - Differentiates real (UUID) vs mock (numeric) shareholder IDs
     - Sends real notifications to real shareholders
     - Logs mock notifications to console for demo mode
     - Tracks success/failure counts

### 3. **NotificationBell Component** 
   - **File**: `frontend/src/components/notifications/NotificationBell.jsx`
   - **Status**: ✅ Already correctly uses `investmentNotificationsService`
   - **Operations**:
     - Reads from `investment_notifications` table
     - Subscribes to real-time INSERT events
     - Displays notifications with proper metadata
     - Marks notifications as read

### 4. **Investment Notifications Service**
   - **File**: `frontend/src/services/investmentNotificationsService.js`
   - **Status**: ✅ Already has complete implementation
   - **Functions**:
     - `createInvestmentNotification()`: Create notifications
     - `getUserNotifications()`: Fetch user's notifications
     - `getUnreadNotificationCount()`: Get unread count
     - `markNotificationAsRead()`: Mark single as read
     - `subscribeToUserNotifications()`: Real-time subscription

## Database Schema

### `investment_notifications` Table (Correct Table)
```sql
Column                  Type              Required
id                      UUID              ✓
recipient_id            UUID              ✓ (shareholder ID)
sender_id               UUID              (current user)
notification_type       TEXT              ✓ (signature_request, etc.)
title                   VARCHAR(255)      ✓
message                 TEXT              ✓
agreement_id            UUID              (investment agreement)
pitch_id                UUID              (related pitch)
business_profile_id     UUID              (related business)
is_read                 BOOLEAN           (default: false)
read_at                 TIMESTAMP         (when marked read)
priority                TEXT              (low/normal/high/urgent)
action_url              TEXT              (deep link)
action_label            TEXT              (button text)
metadata                JSONB             (flexible data)
created_at              TIMESTAMP         (auto)
expires_at              TIMESTAMP         (optional)
```

### `notifications` Table (Legacy, different schema)
- Used by general system notifications
- References `public.profiles` instead of `auth.users`
- **Not used** for investment notifications

### `cmms_notifications` Table
- Used for CMMS operations notifications
- Separate from investment notifications

## How Notifications Flow

### Real Shareholders (with UUIDs)
1. **Investment Agreement Created** → ShareSigningFlow activated
2. **Generate QR Code** → Triggers `triggerShareholderNotifications()`
3. **Fetch Real Shareholders** → Queries `business_profile_members`
4. **Send Notifications** → `createInvestmentNotification()` writes to `investment_notifications` table
5. **Real-time Subscription** → NotificationBell subscribes to INSERT events
6. **Display Notifications** → Shareholders see notification in UI
7. **Mark as Read** → `markNotificationAsRead()` updates record

### Mock Shareholders (demo mode)
1. **No UUID** → Numeric ID detected (1, 2, 3...)
2. **Cannot insert** → UUID validation prevents insertion
3. **Console logging** → Logged as 🎭 [MOCK] for demo tracking
4. **Expected behavior** → No UI notifications (demo mode)

## Console Logs to Verify

When creating an investment agreement, you should see:
```
📢 Sending N notifications for investment INV-XXXXXX...
✅ Investment notification sent to xxxxxxxx-... - Signature Request: [Pitch Title]
✅ Investment notification sent to xxxxxxxx-... - Signature Request: [Pitch Title]
🎭 [MOCK] Notification would be sent to: Mock Name (mock@example.com)
✅ Notification Summary:
   ✓ Real notifications sent: 2
   🎭 Mock notifications (demo): 1
   Total: 3/3
```

If you see only 🎭 [MOCK] entries, check:
1. Are you testing with real shareholders?
2. Do shareholders have UUID IDs?
3. Check Supabase RLS permissions on `business_profile_members`

## Testing Checklist

- [ ] Create investment agreement with multiple shareholders
- [ ] Check console for notification logs (look for ✅ and 🎭)
- [ ] Open NotificationBell component
- [ ] Verify notifications appear in the dropdown
- [ ] Click notification to mark as read
- [ ] Verify notification disappears from unread count
- [ ] Check shareholder receives real-time notification (if subscribed)

## RLS Permissions Required

For notifications to work, Supabase needs:

1. **investment_notifications table**:
   - SELECT: Users can see their own notifications (recipient_id = current_user)
   - INSERT: Service role can insert for any recipient
   - UPDATE: Users can mark own notifications as read

2. **business_profile_members table**:
   - SELECT: Can query shareholders (may be restricted)
   - If restricted: Falls back to mock shareholders (demo mode)

## If Notifications Still Don't Appear

1. **Check Supabase RLS**:
   ```sql
   -- See who can insert notifications
   SELECT * FROM pg_policies 
   WHERE tablename = 'investment_notifications';
   ```

2. **Check Shareholder Data**:
   ```sql
   -- Verify shareholders have valid UUIDs
   SELECT id, email, name FROM business_profile_members 
   WHERE business_profile_id = 'XXX';
   ```

3. **Check Notification Records**:
   ```sql
   -- See if notifications are actually being created
   SELECT id, recipient_id, notification_type, created_at 
   FROM investment_notifications 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```

4. **Enable Verbose Logging**:
   - Add `debuglevel=true` to env
   - Check browser console for detailed logs
   - Look for any 406 RLS errors

5. **Test Real-time Subscription**:
   - Open browser dev tools
   - Watch for real-time channel messages
   - Check if new notifications trigger callbacks

## Files Modified

1. ✅ `frontend/src/services/pitchingService.js`
   - Added `createInvestmentNotification()` function
   - Kept legacy `createNotification()` for compatibility

2. ✅ `frontend/src/components/ShareSigningFlow.jsx`
   - Import: Added `createInvestmentNotification`
   - Function: `triggerShareholderNotifications()` uses new function

3. ✅ `frontend/src/components/notifications/NotificationBell.jsx`
   - No changes needed (already correct)

4. ✅ `frontend/src/services/investmentNotificationsService.js`
   - No changes needed (already correct)

## Summary

**Before**: Notifications written to wrong table, filtered to current user only, schema mismatch
**After**: Notifications written to `investment_notifications` table, sent to all shareholders, correct schema

This ensures:
- ✅ Notifications actually persist in database
- ✅ Shareholders can receive notifications
- ✅ Real-time updates work via Supabase subscriptions
- ✅ UI displays notifications correctly
- ✅ Demo mode gracefully handles mock data
