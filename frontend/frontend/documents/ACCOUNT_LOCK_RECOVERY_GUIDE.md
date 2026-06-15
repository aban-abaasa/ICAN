# 🔐 ACCOUNT LOCKED - RECOVERY GUIDE

## What Happens When Account Gets Locked?

When a user enters an incorrect PIN **3 times**, their account is automatically locked for security reasons:
- ❌ User cannot log in
- ❌ User cannot perform transactions
- 🔒 Status: `Account locked. Too many failed PIN attempts. Contact support.`

---

## How to Unlock Account - 3 Methods

### **Method 1: PIN Reset (User Self-Service)** ✅ RECOMMENDED
User can reset their own PIN without admin help:

**Steps:**
1. User clicks "Forgot PIN?" on login screen
2. System sends unlock link to their registered email
3. Link is valid for **24 hours**
4. User clicks link → enters new 4-digit PIN
5. Account automatically unlocked + PIN reset

**Backend Call:**
```javascript
// Step 1: Request PIN reset
const { data, error } = await supabase
  .rpc('request_account_unlock', {
    p_user_id: userId,
    p_request_type: 'pin_reset',
    p_reason: 'User forgot PIN'
  });

const { request_id, unlock_token } = data[0];

// Step 2: After user clicks email link, reset PIN
const { data: resetResult, error: resetError } = await supabase
  .rpc('reset_pin_with_token', {
    p_request_id: request_id,
    p_unlock_token: unlock_token,
    p_new_pin_hash: hashPin(newPin)  // Frontend hashes
  });
```

---

### **Method 2: Account Unlock Request** ⏳ REQUIRES APPROVAL
User submits request, admin approves:

**Steps:**
1. User fills form: "My account is locked"
2. System creates unlock request (pending approval)
3. Admin reviews requests in dashboard
4. Admin clicks "Approve" or "Reject"
5. If approved: account unlocked immediately

**Backend Call:**
```javascript
// Step 1: User requests unlock
const { data, error } = await supabase
  .rpc('request_account_unlock', {
    p_user_id: userId,
    p_request_type: 'account_unlock',
    p_reason: 'Account locked due to failed PIN attempts'
  });

const { request_id } = data[0];

// Step 2: Check status
const { data: status, error } = await supabase
  .rpc('get_unlock_request_status', {
    p_request_id: request_id
  });
// Returns: { status: 'pending', message: '⏳ Your request is pending approval' }

// Step 3: Admin approves (admin only)
const { data: approved, error } = await supabase
  .rpc('admin_unlock_account', {
    p_user_id: userId,
    p_admin_id: adminUserId,
    p_reason: 'Approved unlock request'
  });
```

---

### **Method 3: Direct Admin Unlock** 🛠️ EMERGENCY ONLY
Admin can immediately unlock any account:

**Steps:**
1. Admin opens admin dashboard
2. Searches for user account
3. Clicks "Unlock Account" button
4. Confirms action
5. Account unlocked immediately

**Backend Call:**
```javascript
// Admin action - no approval needed
const { data, error } = await supabase
  .rpc('admin_unlock_account', {
    p_user_id: userId,
    p_admin_id: adminUserId,
    p_reason: 'Manual admin unlock - customer support request'
  });
```

---

## Frontend: What Users See

### **Before Unlock (Locked Account Screen)**
```
🔒 ACCOUNT LOCKED

Your account has been locked due to too many failed PIN attempts.

This is a security measure to protect your account.

What you can do:

1️⃣ RESET PIN (Self-Service - Fastest)
   - Forgot your PIN?
   - Click "Reset PIN" → we'll send unlock link to your email
   - Create new PIN in 24 hours
   [RESET PIN] button

2️⃣ REQUEST UNLOCK
   - Contact us for approval
   - We'll review and unlock your account
   [REQUEST UNLOCK] button

3️⃣ CONTACT SUPPORT
   - Phone: +256 700 123 456
   - Email: support@ican.ug
   - WhatsApp: available 24/7
   [CONTACT SUPPORT] button

Need help? Chat with us at: support@ican.ug
```

### **After Clicking "Reset PIN"**
```
📧 PIN RESET LINK SENT

We've sent an unlock link to your email: user@example.com

The link will expire in 24 hours.

Check your email and click the link to reset your PIN.

[RESEND EMAIL] [GO BACK]
```

### **After Clicking Email Link**
```
🔐 CREATE NEW PIN

Enter your new 4-digit transaction PIN:

[____] [____] [____] [____]

This PIN must be different from your old PIN.

[CONFIRM] button
```

### **After Successful Reset**
```
✅ PIN RESET SUCCESSFUL

Your account has been unlocked!
Your new PIN is now active.

You can now log in and use your account normally.

[LOGIN NOW] button
```

---

## Database Structure

### **account_unlock_requests Table**
```sql
- id (uuid) - Unique request ID
- user_id (uuid) - User requesting unlock
- request_type (text) - 'pin_reset' or 'account_unlock'
- reason (text) - Why they need unlock
- status (text) - 'pending', 'approved', 'rejected', 'completed'
- unlock_token (text) - 32-byte hex token for email link
- token_expires_at (timestamp) - Token expires in 24h
- approved_by (uuid) - Admin who approved
- approved_at (timestamp) - When approved
- completed_at (timestamp) - When completed
- created_at, updated_at (timestamp)
```

### **user_accounts (Updated)**
```sql
- failed_pin_attempts - Resets to 0 when unlocked
- pin_hash - Updated when PIN reset
```

---

## Security Considerations

✅ **What's Secure:**
- Unlock token is 256-bit random (32 bytes)
- Token expires after 24 hours
- Token can only be used once
- Email verification required for PIN reset
- All actions logged in audit trail
- Admin actions tracked with admin_id

⚠️ **What You Should Add:**
- Email verification (currently optional)
- 2FA before PIN reset
- Support ticket system integration
- Rate limiting on unlock requests
- Daily summary email to admins of locked accounts
- SMS backup unlock method

---

## Implementation Checklist

- [ ] Run PIN_RECOVERY_AND_ACCOUNT_UNLOCK.sql in Supabase
- [ ] Create "Forgot PIN?" page component
- [ ] Create "Account Locked" modal
- [ ] Add email sending function (Resend.io or SendGrid)
- [ ] Create admin unlock dashboard
- [ ] Add unlock request approval UI
- [ ] Set up email template with unlock link
- [ ] Add logging/audit trail
- [ ] Test PIN reset flow end-to-end
- [ ] Test admin unlock flow
- [ ] Test request approval flow
- [ ] Add support contact info to help pages

---

## Support Contact Template

Add this to help pages when account is locked:

```
📞 NEED IMMEDIATE HELP?

🕐 Response Time: 5-30 minutes

📧 Email: support@ican.ug
💬 WhatsApp: +256 700 123 456
📱 Phone: +256 700 987 654
🌐 Live Chat: Monday-Friday 8am-6pm EAT

Provide us:
- Your account number (ICAN-XXXXXXXXX)
- The transaction you were trying to make
- When your account locked

We'll unlock your account within 30 minutes during business hours.
```

---

## Error Messages to Display

```javascript
// When account is locked (instead of just generic message)
IF v_pin_attempts > 3 THEN
  RETURN SELECT false, 
    '🔒 Account locked. Too many failed PIN attempts. Contact support. ' ||
    'Options: ' ||
    '1️⃣ Reset PIN (email link) ' ||
    '2️⃣ Contact Support (support@ican.ug) ' ||
    '3️⃣ Call +256 700 123 456'::text
END IF;

// When PIN reset successful
RETURN SELECT true,
  '✅ PIN Reset Successful! ' ||
  'Your account is now unlocked. ' ||
  'Use your new PIN to log in.'::text
END;

// When unlock pending approval
RETURN SELECT true,
  '⏳ Your unlock request is pending approval. ' ||
  'We usually respond within 30 minutes. ' ||
  'You can check status at: [STATUS LINK]'::text
END;
```

---

## Next Steps

1. ✅ Run the SQL file to create functions & table
2. ✅ Build PIN reset UI (forgot password flow)
3. ✅ Build admin unlock dashboard
4. ✅ Integrate email sending
5. ✅ Test all 3 unlock methods
6. ✅ Add support contact info to UI
7. ✅ Monitor unlock requests for patterns
