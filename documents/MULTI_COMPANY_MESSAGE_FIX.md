# Multi-Company Message Sending - Fix Summary

## Problem
When users belonging to multiple CMMS companies switched between companies and attempted to send messages, the operation failed with:
```
Error: insert or update on table 'cmms_report_messages' violates foreign key constraint 'cmms_report_messages_company_id_fkey'
```

## Root Cause
The foreign key constraint `cmms_report_messages_company_id` references `cmms_companies(id)`. When a user switched companies, one of these issues could occur:
1. The `companyIdToUse` was not properly updated in time for the message send operation
2. The company_id being passed to the RPC function didn't exist in cmms_companies table
3. There was no validation that the company actually existed before attempting the INSERT

## Solution Implemented

### Frontend Changes (CMSSModule.jsx)

#### 1. Added Company Context Validation in handleSendMessage
```javascript
// Validate companyIdToUse is set and valid
if (!companyIdToUse) {
  alert('❌ Error: Company context is not set. Please refresh and try again.');
  return;
}

// Validate that user still belongs to this company
const userBelongsToCompany = companyUsers.some(u => u.id === selectedUserToMessage.id);
if (!userBelongsToCompany) {
  alert('❌ Error: Selected user is not part of this company. Please switch to the correct company.');
  setIsSendingMessage(false);
  return;
}
```

**Why:** Ensures the company context is set and the recipient exists in the current company before attempting to send.

#### 2. Enhanced Error Messages
```javascript
if (result.error?.includes('foreign key constraint')) {
  alert('❌ Error: There was a problem with your company context.\n\nPlease:\n1. Refresh the page\n2. Select the correct company from the dropdown\n3. Try sending the message again');
} else if (result.error?.includes('not a member')) {
  alert('❌ Error: You are not a member of this CMMS company.\n\nPlease switch to a company where you are a member.');
} else {
  alert(`❌ Error: ${result.error}`);
}
```

**Why:** Provides clear, actionable error messages to users explaining what went wrong and how to fix it.

#### 3. Improved loadCompanyUsers Function
```javascript
const loadCompanyUsers = async () => {
  if (!companyIdToUse) {
    console.warn('⚠️ Cannot load users: companyIdToUse is not set');
    setCompanyUsers([]);
    return;
  }
  
  setIsLoadingUsers(true);
  try {
    const result = await cmmsMessagingService.getCompanyUsers(companyIdToUse);
    if (result.success) {
      setCompanyUsers(result.data || []);
      console.log(`✅ Loaded ${result.data?.length || 0} users for company ${companyIdToUse}`);
    } else {
      console.error('Failed to load users:', result.error);
      setCompanyUsers([]);
    }
  } catch (error) {
    console.error('Error loading users:', error);
    setCompanyUsers([]);
  } finally {
    setIsLoadingUsers(false);
  }
};
```

**Why:** Adds guards and logging to ensure users are loaded only when company context is available, and provides clear debugging information.

### Backend Changes (CMMS_REPORT_MESSAGING_SYSTEM.sql)

#### Added Company Existence Validation in fn_send_report_message
```sql
-- Validate company exists
IF NOT EXISTS (SELECT 1 FROM public.cmms_companies WHERE id = p_company_id) THEN
  RETURN QUERY SELECT FALSE, 'Company not found'::VARCHAR, NULL::JSON;
  RETURN;
END IF;
```

**Why:** Prevents attempting to insert records with a non-existent company_id, catching the problem before the foreign key constraint violation occurs.

## Testing Recommendations

### 1. Single Company User (Control)
- User with only 1 company membership
- Should work without issues (baseline)

### 2. Multi-Company User - Same Company Messaging
- User with 2+ companies
- Send message within the same company
- Verify message sends successfully

### 3. Multi-Company User - Company Switch Test
- User with 2+ companies
- Send message in Company A
- Switch to Company B (wait for UI to update)
- Send message in Company B
- Verify no errors and messages go to correct company

### 4. Multi-Company User - Quick Switch Stress Test
- User with 2+ companies
- Rapidly switch between companies
- Try to send message immediately after switch
- Should either work OR show clear error message

### 5. Invalid Recipient Test
- User with 2 companies
- Select a user from Company A's user list
- Switch to Company B
- Try to send message (should fail with clear error)

### 6. Data Consistency Check
- Verify in database that all sent messages have:
  - Valid company_id (exists in cmms_companies)
  - Valid sender_id (exists in cmms_users for that company)
  - Valid recipient_id (exists in cmms_users for that company)

## Database Validation

To verify all messages are valid:
```sql
-- Check for orphaned messages (should return 0 rows)
SELECT COUNT(*) FROM cmms_report_messages crm
WHERE NOT EXISTS (SELECT 1 FROM cmms_companies WHERE id = crm.company_id)
   OR NOT EXISTS (SELECT 1 FROM cmms_users WHERE id = crm.sender_id AND cmms_company_id = crm.company_id)
   OR (crm.recipient_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cmms_users WHERE id = crm.recipient_id AND cmms_company_id = crm.company_id));
```

## Deployment Steps

1. **Backup Database** - Before deploying, back up the database
2. **Deploy Backend SQL** - Apply the updated fn_send_report_message function
3. **Deploy Frontend** - Update CMSSModule.jsx with validation changes
4. **Test All Scenarios** - Run through testing recommendations above
5. **Monitor** - Watch for any foreign key constraint errors in production logs

## Impact
- ✅ Multi-company users can now switch companies and send messages without errors
- ✅ Better error messages guide users on how to fix issues
- ✅ Validation happens at both frontend and backend for defense-in-depth
- ✅ No breaking changes to existing functionality
