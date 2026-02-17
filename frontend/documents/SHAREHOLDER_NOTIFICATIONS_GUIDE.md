# Shareholder Notifications System

## Overview

The Shareholder Notifications System enables businesses to automatically notify all shareholders when significant business events occur, including:

✅ **Share Purchases** - When new investors buy company shares  
✅ **Partner Investments** - When someone becomes a business partner with equity  
✅ **Support Contributions** - When someone provides financial support  
✅ **Investment Agreements Signed** - When investment deals are finalized

## Features

### 1. **Customizable Notification Events**

Businesses can enable/disable notifications for specific events:
- Investor purchases shares
- Someone becomes a partner
- Financial support is received
- Investment agreements are signed

### 2. **Multiple Notification Channels**

Notifications can be delivered via:
- 📧 **Email** - To all registered shareholder emails
- 📱 **Push Notifications** - To mobile devices (if app installed)
- 🔔 **In-App Notifications** - Visible in the dashboard

### 3. **Flexible Shareholder Targeting**

Control who receives notifications based on ownership:
- **All Shareholders** - Every shareholder gets notified regardless of share percentage
- **Majority Shareholders (5%+)** - Only shareholders with 5% or more ownership
- **Founders & Co-Owners Only** - Only primary founders and equity holders

### 4. **Comprehensive Tracking**

Track all notifications sent:
- Who received the notification
- What type of event triggered it
- Investment details (amount, currency, shares)
- When each shareholder read the notification

## Setup Instructions

### Step 1: Database Schema Setup

Run the SQL migration to add notification tables and functions:

```bash
# PowerShell
cd C:\Users\Aban\Desktop\ICAN\backend
psql -U <username> -d <database> -f SHAREHOLDER_NOTIFICATIONS_SCHEMA.sql
```

### Step 2: Configure in Business Profile

When creating or editing a business profile:

1. **Go to the Notifications Tab**
   - Select notification events to enable
   - Choose notification channels
   - Set the shareholder notification level

2. **Save Configuration**
   - Proceed to Review & Create
   - Your notification settings are saved with the profile

### Step 3: API Integration

#### Send Share Purchase Notification

```javascript
// In your investment module
const { data, error } = await supabase
  .rpc('notify_shareholders_on_share_purchase', {
    p_business_profile_id: businessId,
    p_investor_id: investorId,
    p_investor_name: 'John Investor',
    p_investor_email: 'john@example.com',
    p_investment_amount: 50000,
    p_investment_currency: 'UGX',
    p_investment_shares: 500
  });

if (!error) {
  console.log('✅ Notifications sent to', data.length, 'shareholders');
}
```

#### Send Partner Investment Notification

```javascript
const { data, error } = await supabase
  .rpc('notify_shareholders_on_partner_investment', {
    p_business_profile_id: businessId,
    p_partner_id: partnerId,
    p_partner_name: 'Jane Partner',
    p_partner_email: 'jane@example.com',
    p_equity_stake: 15,
    p_announcement_text: 'Jane brings expertise in African markets'
  });
```

#### Send Support Contribution Notification

```javascript
const { data, error } = await supabase
  .rpc('notify_shareholders_on_support', {
    p_business_profile_id: businessId,
    p_supporter_id: supporterId,
    p_supporter_name: 'Mike Supporter',
    p_supporter_email: 'mike@example.com',
    p_support_amount: 100000,
    p_support_currency: 'UGX'
  });
```

### Step 4: Retrieve Shareholder Notifications

Get all notifications for a shareholder:

```javascript
const { data: notifications, error } = await supabase
  .rpc('get_shareholder_notifications', {
    p_shareholder_id: shareholderId
  });

/* Returns:
[
  {
    notification_id: UUID,
    business_name: 'TechStartup Inc',
    notification_type: 'share_purchase',
    notification_title: 'New Share Purchase - TechStartup Inc',
    notification_message: 'John Investor has purchased 500 shares for 50000 UGX',
    investor_name: 'John Investor',
    investment_amount: 50000,
    investment_currency: 'UGX',
    created_at: '2025-02-06T10:30:00Z',
    is_read: false
  },
  ...
]
*/
```

## Database Schema

### Business Profiles Notification Columns

```sql
ALTER TABLE business_profiles ADD COLUMN notify_on_share_purchase BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN notify_on_partner_investment BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN notify_on_support BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN notify_on_investment_signed BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN notify_via_email BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN notify_via_push_notification BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN notify_via_in_app BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN shareholder_notification_level TEXT DEFAULT 'all';
```

### Shareholder Notifications Table

```sql
CREATE TABLE shareholder_notifications (
  id UUID PRIMARY KEY,
  business_profile_id UUID REFERENCES business_profiles(id),
  shareholder_id UUID REFERENCES auth.users(id),
  shareholder_email TEXT,
  notification_type TEXT (share_purchase, partner_investment, support_contribution, investment_signed),
  notification_title TEXT,
  notification_message TEXT,
  investor_name TEXT,
  investor_email TEXT,
  investment_amount DECIMAL,
  investment_currency TEXT,
  investment_shares DECIMAL,
  read_at TIMESTAMP,
  notification_sent_via TEXT (email, push, in_app, all),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

## Frontend Implementation

### Notification Settings Tab (in BusinessProfileForm.jsx)

The new Notifications tab includes:

1. **Notification Events Section**
   - Checkboxes for each event type
   - Descriptions of what triggers each notification

2. **Notification Channels Section**
   - Email, Push, and In-App notification toggles
   - Selected channels are used for delivery

3. **Shareholder Targeting Section**
   - Radio buttons to select notification audience
   - Different options for different notification needs

4. **Configuration Summary**
   - Shows which events are enabled
   - Displays the selected shareholder level

### Example: Display Notifications on Shareholder Dashboard

```jsx
import { useEffect, useState } from 'react';
import { getShareholderNotifications } from '../services/notificationService';

export const NotificationCenter = ({ shareholderId }) => {
  const [notifications, setNotifications] = useState([]);
  
  useEffect(() => {
    const loadNotifications = async () => {
      const data = await getShareholderNotifications(shareholderId);
      setNotifications(data);
    };
    
    loadNotifications();
    // Set up real-time subscription
    const subscription = supabase
      .from('shareholder_notifications')
      .on('INSERT', payload => {
        setNotifications(prev => [payload.new, ...prev]);
      })
      .subscribe();
      
    return () => subscription.unsubscribe();
  }, [shareholderId]);
  
  return (
    <div className="notifications">
      {notifications.map(notif => (
        <div key={notif.notification_id} className="notification-card">
          <h4>{notif.notification_title}</h4>
          <p>{notif.notification_message}</p>
          <small>{new Date(notif.created_at).toLocaleDateString()}</small>
        </div>
      ))}
    </div>
  );
};
```

## Configuration Examples

### Example 1: Conservative Notifications
- **Events**: Share purchases, Investment signed
- **Channels**: Email only
- **Recipients**: Founders & co-owners only
- **Use Case**: Small teams, low transaction volume

### Example 2: Transparent Governance
- **Events**: All events enabled
- **Channels**: Email + In-App
- **Recipients**: All shareholders
- **Use Case**: Investor relations, transparency focused

### Example 3: Milestone Based
- **Events**: Share purchases (>10,000 UGX), Partner investments
- **Channels**: Email + Push
- **Recipients**: Shareholders with 5%+
- **Use Case**: Medium-sized businesses, key stakeholder updates

## Security & Privacy

✅ **Row-Level Security (RLS)** - Shareholders only see their own notifications  
✅ **Access Control** - Business owners can view all shareholder notifications  
✅ **Email Verification** - Notifications only sent to verified shareholder emails  
✅ **Opt-Out** - Shareholders can disable notifications via `can_receive_notifications` flag

## Monitoring & Analytics

Track notification effectiveness:

```sql
-- Get notification statistics by type
SELECT 
  notification_type,
  COUNT(*) as total_sent,
  SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) as read_count,
  ROUND(100.0 * SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) as read_rate
FROM shareholder_notifications
WHERE business_profile_id = '<business_id>'
GROUP BY notification_type;

-- Get detailed notification log
SELECT 
  sn.notification_title,
  sn.investor_name,
  sn.investment_amount,
  COUNT(DISTINCT sn.shareholder_id) as shareholders_notified,
  sn.created_at
FROM shareholder_notifications sn
WHERE sn.business_profile_id = '<business_id>'
GROUP BY sn.notification_title, sn.investor_name, sn.investment_amount, sn.created_at
ORDER BY sn.created_at DESC;
```

## Testing

### Test Notification Flow

```sql
-- Test 1: Send share purchase notification
SELECT notify_shareholders_on_share_purchase(
  '<business_id>',
  '<investor_id>',
  'Test Investor',
  'test@example.com',
  50000,
  'UGX',
  500
);

-- Test 2: Verify notifications were created
SELECT COUNT(*) FROM shareholder_notifications 
WHERE business_profile_id = '<business_id>';

-- Test 3: Check notification content
SELECT notification_type, notification_title, investor_name, created_at
FROM shareholder_notifications
WHERE business_profile_id = '<business_id>'
ORDER BY created_at DESC;
```

## Troubleshooting

### Notifications Not Being Sent

1. **Check notification settings are enabled**
   ```sql
   SELECT notify_on_share_purchase, notify_on_partner_investment, notify_on_support
   FROM business_profiles
   WHERE id = '<business_id>';
   ```

2. **Verify shareholders are active and have notifications enabled**
   ```sql
   SELECT user_email, status, can_receive_notifications
   FROM business_profile_members
   WHERE business_profile_id = '<business_id>';
   ```

3. **Check shareholder notification level filtering**
   ```sql
   SELECT shareholder_notification_level FROM business_profiles WHERE id = '<business_id>';
   ```

### Email Delivery Issues

- Ensure shareholder emails are verified and unique
- Check email service configuration in backend
- Verify notification channels include `email` option

## Future Enhancements

🔜 **SMS Notifications** - Send notifications via SMS to mobile phones  
🔜 **Notification Preferences** - Let shareholders customize their own notification settings  
🔜 **Digest Emails** - Weekly/monthly summaries instead of individual emails  
🔜 **Slack Integration** - Send notifications to Slack workspace  
🔜 **Notification Templates** - Customizable message templates per business
