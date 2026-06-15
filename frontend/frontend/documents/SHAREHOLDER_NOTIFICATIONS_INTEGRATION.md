# Shareholder Notification System - Integration Guide

## What Was Created

This implementation adds a complete shareholder notification system to the ICAN platform:

### 1. **Frontend Components**

#### BusinessProfileForm.jsx - New Notifications Tab
- Added `Bell` icon import from lucide-react
- New notification preferences state
- 5th step in the profile creation wizard: "Notifications"
- Configurable notification events:
  - Share purchases
  - Partner investments
  - Support contributions
  - Investment agreements signed
- Multiple notification channels:
  - Email notifications
  - Push notifications
  - In-app notifications
- Flexible shareholder targeting:
  - All shareholders
  - Majority shareholders (5%+ ownership)
  - Founders & co-owners only

#### ShareholderNotificationCenter.jsx
- Complete UI for displaying notifications
- Real-time updates using Supabase subscriptions
- Filter by notification type
- Mark as read functionality
- Delete notifications
- Unread count indicator

### 2. **Backend Services**

#### shareholderNotificationService.js
Service methods for:
- `notifySharePurchase()` - Send share purchase notifications
- `notifyPartnerInvestment()` - Send partner notifications
- `notifySupport()` - Send support contribution notifications
- `getShareholderNotifications()` - Fetch shareholder notifications
- `getUnreadCount()` - Get unread notification count
- `markAsRead()` - Mark notification as read
- `subscribeToNotifications()` - Real-time notification subscription
- `getBusinessNotifications()` - Business owner view of notifications
- `getNotificationStats()` - Notification statistics

### 3. **Database Schema**

#### Business Profiles Enhancements
New columns added to store notification preferences:
```sql
notify_on_share_purchase BOOLEAN DEFAULT true
notify_on_partner_investment BOOLEAN DEFAULT true
notify_on_support BOOLEAN DEFAULT true
notify_on_investment_signed BOOLEAN DEFAULT true
notify_via_email BOOLEAN DEFAULT true
notify_via_push_notification BOOLEAN DEFAULT true
notify_via_in_app BOOLEAN DEFAULT true
shareholder_notification_level TEXT DEFAULT 'all'
```

#### New shareholder_notifications Table
Tracks all sent notifications with:
- Notification type and content
- Recipient information
- Investment/event details
- Read status
- Delivery channels

### 4. **Database Functions**

#### notify_shareholders_on_share_purchase()
Triggers shareholder notifications when:
- New investor purchases company shares
- Respects business notification settings
- Filters shareholders based on notification level

#### notify_shareholders_on_partner_investment()
Notifies shareholders when:
- Someone becomes a business partner
- Partner equity stake is announced
- Optional announcement text included

#### notify_shareholders_on_support()
Alerts shareholders when:
- Financial support is received
- Support amount and currency tracked

#### get_shareholder_notifications()
Retrieves all notifications for a shareholder in one query

---

## How to Use

### Step 1: Deploy Database Schema

```bash
# From the backend directory
psql -U <username> -d <database> -f SHAREHOLDER_NOTIFICATIONS_SCHEMA.sql
```

### Step 2: Configure Notifications in Business Profile

When creating a business profile:
1. Navigate through: Business Info → Co-Owners → Documents → Wallet → **Notifications** → Review
2. In the Notifications tab:
   - Enable/disable each event type via checkboxes
   - Select notification channels (Email, Push, In-app)
   - Choose shareholder audience (All, Majority 5%+, Founders only)
3. Click "Review & Create" to save profile with notification settings

### Step 3: Send Notifications from Investment Module

```javascript
import { shareholderNotificationService } from '../services/shareholderNotificationService';

// When investor purchases shares
await shareholderNotificationService.notifySharePurchase(
  businessId,
  investorId,
  'John Investor',
  'john@example.com',
  50000,      // amount
  'UGX',      // currency
  500         // shares
);

// When partner joins
await shareholderNotificationService.notifyPartnerInvestment(
  businessId,
  partnerId,
  'Jane Partner',
  'jane@example.com',
  15,         // equity %
  'Brings expertise in African markets'
);

// When support received
await shareholderNotificationService.notifySupport(
  businessId,
  supporterId,
  'Mike Supporter',
  'mike@example.com',
  100000,     // amount
  'UGX'       // currency
);
```

### Step 4: Display Notifications in Dashboard

```jsx
import ShareholderNotificationCenter from '../components/ShareholderNotificationCenter';

function ShareholderDashboard() {
  const shareholderId = auth.user().id;
  
  return (
    <div>
      {/* Other dashboard content */}
      <ShareholderNotificationCenter shareholderId={shareholderId} />
    </div>
  );
}
```

### Step 5: Subscribe to Real-Time Updates

```javascript
import { shareholderNotificationService } from '../services/shareholderNotificationService';

// In component
useEffect(() => {
  const unsubscribe = shareholderNotificationService.subscribeToNotifications(
    shareholderId,
    (newNotification) => {
      console.log('New notification:', newNotification);
      // Update UI with new notification
    }
  );

  return () => unsubscribe();
}, [shareholderId]);
```

---

## Configuration Examples

### Example 1: Transparent Company
```javascript
notificationSettings = {
  notifyOnSharePurchase: true,
  notifyOnPartnerInvestment: true,
  notifyOnSupport: true,
  notifyOnInvestmentSigned: true,
  notifyViaEmail: true,
  notifyViaPushNotification: true,
  notifyViaInApp: true,
  shareholderNotificationLevel: 'all' // All shareholders
};
```

### Example 2: Conservative Notifications
```javascript
notificationSettings = {
  notifyOnSharePurchase: true,
  notifyOnPartnerInvestment: false,
  notifyOnSupport: false,
  notifyOnInvestmentSigned: true,
  notifyViaEmail: true,
  notifyViaPushNotification: false,
  notifyViaInApp: true,
  shareholderNotificationLevel: 'only_founders' // Founders only
};
```

### Example 3: Major Milestone Focus
```javascript
notificationSettings = {
  notifyOnSharePurchase: true,    // All investments
  notifyOnPartnerInvestment: true, // Strategic partnerships
  notifyOnSupport: false,
  notifyOnInvestmentSigned: true,
  notifyViaEmail: true,
  notifyViaPushNotification: true,
  notifyViaInApp: false,
  shareholderNotificationLevel: 'majority' // 5%+ owners
};
```

---

## Testing

### Test Share Purchase Notification
```sql
SELECT * FROM notify_shareholders_on_share_purchase(
  '<business_id>',
  '<investor_id>',
  'Test Investor',
  'test@example.com',
  50000,
  'UGX',
  500
);
```

### Verify Notifications Created
```sql
SELECT notification_type, notification_title, investor_name, created_at
FROM shareholder_notifications
WHERE business_profile_id = '<business_id>'
ORDER BY created_at DESC
LIMIT 10;
```

### Get Shareholder Notifications
```javascript
const notifications = await shareholderNotificationService.getShareholderNotifications(shareholderId);
console.log(notifications);
```

---

## Features

✅ **Automatic Notifications** - Shareholders notified immediately when triggers occur  
✅ **Multi-Channel Delivery** - Email, push, and in-app notifications  
✅ **Flexible Targeting** - Control who gets notified based on ownership  
✅ **Real-Time Updates** - Live notification feed using WebSockets  
✅ **Read Status Tracking** - See which shareholders have read notifications  
✅ **Business Analytics** - Statistics on notification delivery and engagement  
✅ **Notification History** - Complete audit trail of all notifications  
✅ **Opt-Out Capability** - Shareholders can disable notifications  

---

## API Reference

### shareholderNotificationService

#### notifySharePurchase(businessProfileId, investorId, investorName, investorEmail, investmentAmount, investmentCurrency, investmentShares)
Sends notifications when investor purchases shares

**Returns:** `{ success: boolean, notificationsCount: number, data: Array }`

#### notifyPartnerInvestment(businessProfileId, partnerId, partnerName, partnerEmail, equityStake, announcementText)
Sends notifications when someone becomes a partner

**Returns:** `{ success: boolean, notificationsCount: number, data: Array }`

#### notifySupport(businessProfileId, supporterId, supporterName, supporterEmail, supportAmount, supportCurrency)
Sends notifications when support is received

**Returns:** `{ success: boolean, notificationsCount: number, data: Array }`

#### getShareholderNotifications(shareholderId)
Fetches all notifications for a shareholder

**Returns:** `Array<Notification>`

#### getUnreadCount(shareholderId)
Gets count of unread notifications

**Returns:** `number`

#### markAsRead(notificationId)
Marks a notification as read

**Returns:** `{ success: boolean, data: Array }`

#### subscribeToNotifications(shareholderId, onNotification)
Subscribes to real-time notification updates

**Returns:** `function` (unsubscribe function)

#### getBusinessNotifications(businessProfileId, limit)
Gets all notifications sent by a business

**Returns:** `Array<Notification>`

#### getNotificationStats(businessProfileId)
Gets notification statistics for a business

**Returns:** `{ total: number, read: number, unread: number, byType: Object }`

---

## Troubleshooting

### Notifications Not Being Sent

1. Verify notification settings are enabled in business profile
2. Check that business profile has at least one shareholder
3. Verify shareholders have `can_receive_notifications = true`
4. Check notification level matches shareholder criteria

### Real-Time Updates Not Working

- Ensure Supabase is configured correctly
- Check browser console for connection errors
- Verify RLS policies are set up correctly

### Missing Notification Data

- Check if investment_amount, investment_currency fields are being set
- Verify investor email is not null
- Ensure shareholder emails are valid and verified

---

## Future Enhancements

🔜 SMS notifications for critical updates  
🔜 Shareholder preference customization  
🔜 Notification templates and customization  
🔜 Slack/Teams integration  
🔜 Digest emails (weekly/monthly summaries)  
🔜 Notification scheduling  
🔜 Multi-language support
