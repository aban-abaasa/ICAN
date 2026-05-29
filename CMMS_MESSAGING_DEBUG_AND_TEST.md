# CMMS Messaging System - Debug & Test Guide

## Overview
The messaging system was fixed to properly display messages after they're sent. This guide helps verify the fix is working correctly.

## What Was Fixed

### 1. **Message State Management** 
- **Before**: Messages treated as flat array, but UI expected object keyed by userId
- **After**: `loadUserMessages()` now converts flat array to proper object structure

### 2. **Message Refresh After Send**
- **Before**: Message sent to Supabase but UI never refreshed to display it
- **After**: Message optimistically added to UI, then verified from Supabase after 500ms

### 3. **User Selection** 
- **Before**: Switching between users didn't reload their message history
- **After**: useEffect triggers automatic message reload when selectedUserToMessage changes

---

## Browser Console Debugging

When testing messaging, open **Chrome DevTools** (F12 → Console tab) to see debug logs:

### Expected Console Output When Sending Message:

```javascript
// 1. When starting to send
"User selected, loading messages"
"Loading messages for company: [company-uuid]"

// 2. When user types and hits Send
"Sending message to: [recipient-uuid]"
"Company: [company-uuid]"
"Message: Hello!"

// 3. On success
"Message sent successfully:" 
{ id: "...", sender_id: "...", recipient_id: "...", message_text: "Hello!", created_at: "...", is_read: false, ... }
"Message added to UI"

// 4. After 500ms refresh
"Loading messages for company: [company-uuid]"
"Organized messages:" 
{ [recipient-uuid]: [ /* array of messages */ ] }
```

### Error Console Output (If Something Fails):

```javascript
"Error sending message: [error details]"
// or
"Error loading messages: [error details]"
```

---

## Step-by-Step Testing Procedure

### **Test 1: Basic Message Send & Display**

1. **Setup**: 
   - Login to CMMS
   - Navigate to Messaging section
   - Select a user from the company users list
   - Open Chrome DevTools (F12 → Console)

2. **Action**:
   - Type "Hello, testing!" in message input
   - Press Enter or click Send button
   - Watch the console for logs

3. **Expected Results**:
   - ✅ Input field clears immediately
   - ✅ Send button shows "..." while sending
   - ✅ Message appears in chat area (blue, right-aligned, "You" sender)
   - ✅ Console shows: `"Message sent successfully"`
   - ✅ Console shows: `"Organized messages:"` with your message in the list

4. **Verify Success**:
   - Refresh the page (F5)
   - Select the same user again
   - ✅ Your message should still appear (confirming it persisted to Supabase)

---

### **Test 2: Switch Between Users**

1. **Setup**:
   - Have at least 2 other users in the company
   - Send a message to User A: "Message for A"
   - Keep console open

2. **Action**:
   - Click on User B in the users list
   - Watch console

3. **Expected Results**:
   - ✅ Console shows: `"User selected, loading messages"`
   - ✅ Chat area clears (or shows User B's existing messages if any)
   - ✅ Message input clears

4. **Action**:
   - Send a message to User B: "Message for B"

5. **Action**:
   - Click back to User A

6. **Expected Results**:
   - ✅ Message history switches back
   - ✅ "Message for A" appears (but NOT "Message for B")
   - ✅ Console shows: `"Organized messages:"` with only messages from User A

---

### **Test 3: Real-Time Message Reception**

1. **Setup**:
   - Open ICAN app in TWO DIFFERENT BROWSER TABS/WINDOWS
   - Login as User A in Tab 1
   - Login as User B in Tab 2

2. **Action (Tab 1)**:
   - Go to Messaging
   - Select User B from the list
   - Type and send: "Hi from User A!"

3. **Check (Tab 1)**:
   - ✅ Message appears blue (your message)

4. **Check (Tab 2)**:
   - Open Chrome DevTools (F12 → Console)
   - You have two options:
     - **Option A** (Manual Refresh): Hit F5 or manually click on User A to refresh messages
     - **Option B** (Auto-Refresh): Wait 500ms for automatic refresh
   - ✅ "Hi from User A!" should appear gray (their message)

5. **Action (Tab 2)**:
   - Reply: "Hi from User B!"

6. **Check (Tab 1)**:
   - Either refresh or wait 500ms
   - ✅ "Hi from User B!" should appear

---

### **Test 4: Message Persistence Across Sessions**

1. **Setup**:
   - Send a message to a user
   - Verify it displays

2. **Action**:
   - Close the browser completely
   - Close the app
   - Reopen browser and ICAN app
   - Login again

3. **Check**:
   - Go to Messaging section
   - Select the same user
   - ✅ All previous messages should still be there (including the one you sent)

---

### **Test 5: Error Handling**

1. **Setup**:
   - Open DevTools (F12 → Network tab)

2. **Action**:
   - Throttle network to "Slow 3G" or "Offline"
   - Try to send a message

3. **Expected Results**:
   - ✅ Console shows error message
   - ✅ Alert popup shows: "Error: [error details]"
   - ✅ Send button remains disabled until you clear the error
   - ✅ Input field is NOT cleared (so user can retry)

4. **Restoration**:
   - Return network to "No throttling"
   - Click Send again
   - ✅ Message should send successfully

---

## Common Issues & Solutions

### Issue 1: Message Sends But Doesn't Appear
**Symptoms**: 
- Console shows `"Message sent successfully"` 
- But message doesn't appear in chat area

**Solutions**:
1. Open DevTools Console and check for errors after the "Message sent successfully" log
2. Click on a different user, then click back on the original user
3. If still not appearing, refresh the page (F5)
4. Check Supabase SQL Editor:
   ```sql
   SELECT * FROM public.cmms_report_messages 
   WHERE sender_id = 'YOUR_USER_ID' 
   ORDER BY created_at DESC LIMIT 5;
   ```
   - If messages appear in DB but not in UI, the frontend rendering has an issue

### Issue 2: "User not a member of this CMMS company" Error
**Cause**: User logged in is not added to cmms_users table for this company
**Solution**: 
- Ask an admin to add the user to the company in CMMS
- Or check database directly:
  ```sql
  SELECT * FROM public.cmms_users 
  WHERE cmms_company_id = 'YOUR_COMPANY_ID' 
  AND email = 'YOUR_EMAIL';
  ```

### Issue 3: Can't See Other Users to Message
**Symptoms**: User list is empty or doesn't show all users
**Solutions**:
1. Check browser console for errors in `loadCompanyUsers()`
2. Verify all users are marked as `is_active = TRUE` in cmms_users table:
   ```sql
   SELECT id, email, is_active FROM public.cmms_users 
   WHERE cmms_company_id = 'YOUR_COMPANY_ID';
   ```

### Issue 4: Message Shows But Disappears After Refresh
**Symptoms**: Message displays, but after page refresh it's gone
**Cause**: Message not actually saved to Supabase (likely a backend function error)
**Solution**:
1. Check Supabase logs for errors in `fn_send_report_message()`
2. Run manual check:
   ```sql
   SELECT * FROM public.cmms_report_messages 
   WHERE company_id = 'YOUR_COMPANY_ID' 
   ORDER BY created_at DESC LIMIT 10;
   ```

---

## Console Log Reference

### loadUserMessages() Logs
```javascript
'Loading messages for company: {companyId}'
'Organized messages: {messagesObject}'
'Error loading messages: {error}'
```

### handleSendMessage() Logs  
```javascript
'Sending message to: {recipientId}'
'Company: {companyId}'
'Message: {messageText}'
'Message sent successfully: {messageData}'
'Message added to UI'
'Error sending message: {error}'
```

### useEffect[selectedUserToMessage] Logs
```javascript
'User selected, loading messages'
```

---

## Database Verification Queries

Run these in Supabase SQL Editor to verify data:

### Check Messages Were Saved
```sql
SELECT id, sender_id, recipient_id, message_text, created_at, is_read
FROM public.cmms_report_messages
WHERE company_id = '[YOUR_COMPANY_ID]'
ORDER BY created_at DESC
LIMIT 20;
```

### Check User Membership
```sql
SELECT id, email, name, is_active
FROM public.cmms_users
WHERE cmms_company_id = '[YOUR_COMPANY_ID]'
ORDER BY name;
```

### Check Message Functions Exist
```sql
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN (
  'fn_send_report_message',
  'fn_get_user_messages',
  'fn_mark_message_as_read',
  'fn_delete_message'
);
```

### Check RLS Policies
```sql
SELECT schemaname, tablename, policyname, permissive, roles, qual, with_check
FROM pg_policies
WHERE tablename IN ('cmms_report_messages', 'cmms_job_assignments')
ORDER BY tablename, policyname;
```

---

## Deployment Checklist

If you haven't deployed the backend functions yet, you need to:

1. **Deploy Backend SQL** (if not already done):
   - File: `FIX_CMMS_MESSAGING_FUNCTIONS.sql`
   - Deploy in Supabase SQL Editor
   - Verify all 4 functions exist (see "Check Message Functions Exist" query above)

2. **Frontend is Already Updated**:
   - `CMSSModule.jsx` has new logic
   - No additional frontend deployment needed

3. **Test the Deployment**:
   - Follow Test Procedures 1-5 above
   - Check console logs match expected output

---

## Performance Tips

- Messages load optimistically (instant UI update)
- Automatic refresh after 500ms confirms with Supabase
- For 50+ messages, consider pagination (not implemented yet)
- Consider real-time subscriptions for live updates (TODO future enhancement)

---

## Next Steps (Future Enhancements)

- [ ] Real-time message subscriptions (WebSocket)
- [ ] Message reactions/emoji support
- [ ] File/image attachments
- [ ] Message editing/deleting
- [ ] Message search
- [ ] Read receipts (✓ single check, ✓✓ double check)
- [ ] Typing indicators
- [ ] Group conversations
- [ ] Message pagination for long conversations
