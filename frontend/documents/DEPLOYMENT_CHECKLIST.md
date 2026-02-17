# ✅ DEPLOYMENT CHECKLIST

## Pre-Deployment

- [ ] Read QUICK_REFERENCE.md to understand the system
- [ ] Read NOTIFICATION_FLOW_COMPLETE.md for detailed flow
- [ ] Have Supabase credentials ready
- [ ] Have database access
- [ ] Time available for testing (≈2 hours)

---

## Step 1: Execute SQL (10 minutes)

### 1.1 Copy SQL File
- [ ] Open [BUSINESS_PROFILE_MEMBERS_SETUP.sql](backend/BUSINESS_PROFILE_MEMBERS_SETUP.sql)
- [ ] Copy entire file (391 lines)

### 1.2 Paste into Supabase
- [ ] Go to Supabase Dashboard
- [ ] Navigate to SQL Editor
- [ ] Click "New Query"
- [ ] Paste the entire SQL
- [ ] Click "Run" button

### 1.3 Check Results
- [ ] No errors appear
- [ ] See "Executed successfully" message
- [ ] Note: May see "DROP TABLE" notices (expected)

### 1.4 Verify Tables Created
```sql
-- Run this query to confirm
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'business_profile_members';
```
- [ ] Returns 1 row (business_profile_members exists)

### 1.5 Verify Functions Created
```sql
-- Check if functions exist
SELECT p.proname FROM pg_proc p
WHERE p.proname IN (
  'migrate_co_owners_to_members',
  'add_investor_as_pending_member',
  'confirm_investor_as_shareholder_after_approval',
  'get_shareholders_for_investment',
  'get_pending_investors'
);
```
- [ ] Returns 5 rows (all functions exist)

---

## Step 2: Optional - Migrate Legacy Data (5 minutes)

### 2.1 Check Existing Co-Owners
```sql
SELECT COUNT(*) FROM business_co_owners;
```
- [ ] Note the count

### 2.2 Run Migration
```sql
SELECT * FROM migrate_co_owners_to_members();
```
- [ ] Check returned (processed, errors) values
- [ ] processed should equal co-owner count (or close)
- [ ] errors should be 0 or low

### 2.3 Verify Migration
```sql
SELECT COUNT(*) FROM business_profile_members;
```
- [ ] Should have migrated co-owners
- [ ] Can still keep business_co_owners (no harm)

---

## Step 3: Code Verification (5 minutes)

### 3.1 Check Frontend Changes
- [ ] Open [ShareSigningFlow.jsx](frontend/src/components/ShareSigningFlow.jsx)
- [ ] Search for "STEP 9: Notify ALL MEMBERS"
- [ ] Confirm code is there (lines ~1054-1145)
- [ ] Check for:
  - [ ] `const { data: allMembers }` - fetches members
  - [ ] Loop through members
  - [ ] createInvestmentNotification calls
  - [ ] Console logs for notifications

### 3.2 Check useEffect for Approval
- [ ] Search for "checkAndRecordInvestor"
- [ ] Should be around line 658-730
- [ ] Confirm it calls:
  - [ ] `confirm_investor_as_shareholder_after_approval()`
  - [ ] Updates investor status to shareholder

---

## Step 4: Environment Configuration (2 minutes)

### 4.1 Check .env File
- [ ] Open `.env` in project root
- [ ] Verify these variables exist:
  - [ ] `ENABLE_BUSINESS_OWNER_NOTIFICATIONS=true`
  - [ ] `ENABLE_SHAREHOLDER_NOTIFICATIONS=true`
  - [ ] `SHAREHOLDER_SIGNATURE_DEADLINE_HOURS=24`
  - [ ] `SHAREHOLDER_APPROVAL_THRESHOLD_PERCENT=60`

### 4.2 Add Missing Variables (if needed)
```env
ENABLE_BUSINESS_OWNER_NOTIFICATIONS=true
ENABLE_SHAREHOLDER_NOTIFICATIONS=true
SHAREHOLDER_SIGNATURE_DEADLINE_HOURS=24
SHAREHOLDER_APPROVAL_THRESHOLD_PERCENT=60
ALLOW_TEST_NOTIFICATIONS=true
LOG_NOTIFICATIONS=true
```
- [ ] Add any missing variables

---

## Step 5: Build & Deploy Frontend (10 minutes)

### 5.1 Install Dependencies
```bash
cd frontend
npm install
```
- [ ] No errors
- [ ] All packages installed

### 5.2 Build Project
```bash
npm run build
```
- [ ] No compilation errors
- [ ] Build succeeds
- [ ] Build output generated

### 5.3 Deploy to Production
```bash
npm run deploy
```
(or your deployment command)
- [ ] Deploy succeeds
- [ ] No errors reported

---

## Step 6: Testing Phase (45 minutes)

### 6.1 Setup Test Environment
- [ ] Have 2-3 test accounts ready
- [ ] One account as business owner
- [ ] One account as co-owner
- [ ] One account as investor
- [ ] Each account has test ICAN balance

### 6.2 Test Scenario Part 1: Investor Signs
```
Steps:
1. Log in as investor
2. Find a business with 2+ co-owners
3. Click "Invest" / "Sign"
4. Go through all stages
5. Reach PIN verification
6. Enter PIN and confirm
7. Click submit
```

Verification:
- [ ] Payment goes to escrow (AGENT-KAM-5560)
- [ ] Investor appears in business_profile_members with status='pending'
- [ ] Check console for "NOTIFYING ALL BUSINESS MEMBERS" logs
- [ ] Notification count shows 3+ (owner + members)
- [ ] "No failures" message appears

```sql
-- Verify in database
SELECT * FROM business_profile_members 
WHERE business_profile_id = '[test-business-uuid]'
ORDER BY created_at DESC;
-- Should see investor with status='pending'
```

- [ ] Investor shows as pending
- [ ] All co-owners show as active

```sql
-- Check notifications
SELECT recipient_id, notification_type, title, created_at
FROM investment_notifications
WHERE business_profile_id = '[test-business-uuid]'
ORDER BY created_at DESC
LIMIT 5;
-- Should see 3+ records with type='new_investment_received'
```

- [ ] 3+ notifications created
- [ ] All with type='new_investment_received'

### 6.3 Test Scenario Part 2: Shareholders Sign (24-hour window)
```
Steps:
1. Log in as first co-owner (Gantaelon)
2. Find the pending investment notification
3. Click on it
4. Go to shareholder signature screen
5. Enter PIN
6. Sign
```

Verification:
- [ ] First signature recorded
- [ ] Approval % shows 50% (if 2 shareholders total)
- [ ] Console shows "Waiting for more signatures"
- [ ] Investor is still PENDING in database

```
Steps (continued):
1. Log in as second co-owner (Abana)
2. Find notification about investment approval
3. Click signature area
4. Enter PIN
5. Sign
```

Verification:
- [ ] Second signature recorded
- [ ] Approval % shows 100%
- [ ] Console shows "60% THRESHOLD MET!"
- [ ] Investor promoted to SHAREHOLDER
- [ ] Investor status changed to 'active'
- [ ] Investor can_sign changed to true

```sql
-- Verify final state
SELECT user_name, role, status, can_sign
FROM business_profile_members
WHERE business_profile_id = '[test-business-uuid]'
ORDER BY created_at DESC;
-- John should be: Shareholder, active, can_sign=true
```

- [ ] Investor is now Shareholder
- [ ] Status is 'active'
- [ ] can_sign is true

### 6.4 Test Scenario Part 3: Investor Can Vote
```
Steps:
1. Log in as new investor (John)
2. Have another investor submit an investment
3. Check if John gets shareholder notification
4. Check if John can vote/sign
```

Verification:
- [ ] John receives notification
- [ ] John can vote on next investment
- [ ] John's approval counts toward 60% threshold

---

## Step 7: Monitoring (15 minutes)

### 7.1 Check Console Logs
- [ ] Browser console shows all expected logs
- [ ] No JavaScript errors
- [ ] No RLS errors (403/401)
- [ ] No network failures

### 7.2 Check Database Logs
```sql
-- Check for notification errors
SELECT * FROM investment_notifications 
WHERE error IS NOT NULL;
```
- [ ] Should be empty (no errors)

### 7.3 Check Member Status
```sql
-- View all members and their status
SELECT 
  business_profile_id,
  user_name,
  role,
  status,
  can_sign,
  created_at
FROM business_profile_members
ORDER BY created_at DESC
LIMIT 20;
```
- [ ] Shows correct statuses
- [ ] Investors appear as pending, then promoted

### 7.4 Check Notifications Distribution
```sql
-- See notifications by recipient
SELECT 
  recipient_id,
  COUNT(*) as notification_count,
  MIN(created_at) as first_notif,
  MAX(created_at) as last_notif
FROM investment_notifications
GROUP BY recipient_id
ORDER BY notification_count DESC;
```
- [ ] All members appear
- [ ] Notification counts look reasonable

---

## Step 8: Edge Case Testing (20 minutes)

### 8.1 Test: Single Member Business
```
Setup: Business with only 1 owner, no co-owners
Steps:
1. Investor signs
2. Check notifications (should just be owner)
3. Owner signs
4. Should reach 100% (>= 60%)
5. Investor promoted
```
- [ ] Works correctly with single member

### 8.2 Test: Non-Signing Members
```
Setup: Business with 1 owner, 2 co-owners
- Owner: can_sign = true
- CoOwner1: can_sign = true
- CoOwner2: can_sign = false

Steps:
1. Investor signs
2. All 3 get notified
3. Only owner + CoOwner1 get signature requests
4. They vote
5. Investor approved
```
- [ ] Non-signing members don't get signature requests
- [ ] They still get notifications
- [ ] Approval only counts signing members

### 8.3 Test: Failed Notifications
```
Simulate: One member's notification fails
Steps:
1. Investor signs
2. Should still show "2 notified, 1 failed"
3. Investment continues anyway
4. Other members still got notified
```
- [ ] System continues on failure
- [ ] Doesn't block investment

### 8.4 Test: Partnership Investment (0 shares)
```
Steps:
1. Select "Partnership" investment type
2. Set shares to 0
3. Go through flow
4. Sign with PIN
5. Check database
```
- [ ] Works with 0 shares
- [ ] Notifications still sent
- [ ] Investor still pending/promoted
- [ ] Status shows "Partnership" not "Equity"

---

## Step 9: Performance Testing (10 minutes)

### 9.1 Test with 10+ Members
```
Setup: Business with 10 active members
Steps:
1. Investor signs
2. Time how long notifications take
3. Check browser console for timing
```
- [ ] Completes in < 5 seconds
- [ ] No timeout errors
- [ ] All 10 get notified

### 9.2 Check Database Performance
```sql
-- Test query speed
EXPLAIN ANALYZE
SELECT * FROM business_profile_members
WHERE business_profile_id = '[uuid]'
AND status = 'active';
```
- [ ] Uses index efficiently
- [ ] No sequential scans

---

## Step 10: Post-Testing Checklist

### 10.1 Code Review
- [ ] No console errors in production
- [ ] All logs are informative
- [ ] Error messages are clear
- [ ] No sensitive data in logs

### 10.2 Database State
```sql
-- Final verification
SELECT 
  (SELECT COUNT(*) FROM business_profile_members) as members,
  (SELECT COUNT(*) FROM investment_notifications) as notifications,
  (SELECT COUNT(*) FROM investment_signatures) as signatures;
```
- [ ] Numbers look reasonable
- [ ] No orphaned records

### 10.3 Documentation
- [ ] All documentation files exist:
  - [ ] QUICK_REFERENCE.md
  - [ ] NOTIFICATION_FLOW_COMPLETE.md
  - [ ] ALL_MEMBERS_NOTIFICATION_SYSTEM.md
  - [ ] EXPECTED_CONSOLE_OUTPUT.md
  - [ ] SYSTEM_IMPLEMENTATION_COMPLETE.md
  - [ ] BUSINESS_PROFILE_MEMBERS_SETUP.md

### 10.4 Cleanup
- [ ] Remove test data (optional)
- [ ] Reset test notifications
- [ ] Document any issues found

---

## Troubleshooting

### Issue: SQL Execution Fails
**Solution:**
- [ ] Check RLS is enabled
- [ ] Check table references exist
- [ ] Run one statement at a time
- [ ] Check Supabase logs

### Issue: Notifications Not Showing
**Solution:**
- [ ] Check RLS policies on investment_notifications
- [ ] Verify recipient_id is correct UUID
- [ ] Check browser console for JS errors
- [ ] Verify ENABLE_SHAREHOLDER_NOTIFICATIONS=true

### Issue: Investor Not Promoted
**Solution:**
- [ ] Check approval % is >= 60%
- [ ] Verify checkAndRecordInvestor useEffect is running
- [ ] Check browser console for RPC call errors
- [ ] Query database to check investor status

### Issue: Members Not Fetched
**Solution:**
- [ ] Check business_profile_members table exists
- [ ] Verify RLS allows authenticated read
- [ ] Check businessProfile.id is correct UUID
- [ ] Look for RLS policy denials in Supabase logs

---

## Rollback Plan

If issues occur:

### 1. Rollback Database
```sql
-- Disable the table
DROP TABLE IF EXISTS business_profile_members CASCADE;
-- Notifications will still work with legacy investor_shares
```

### 2. Rollback Code
- [ ] Revert ShareSigningFlow.jsx to previous version
- [ ] Redeploy frontend
- [ ] System uses old notification logic (owner only)

### 3. Reapply After Fixing
- [ ] Fix the issue
- [ ] Rerun SQL
- [ ] Redeploy code
- [ ] Test again

---

## Success Criteria

✅ All tests pass
✅ No console errors
✅ All members get notified
✅ Investor promoted after 60% approval
✅ Database shows correct statuses
✅ Notifications appear in investment_notifications table
✅ 24-hour signature window works
✅ Investor can vote on next investment
✅ Performance is acceptable (< 5 seconds)
✅ Documentation is complete

---

## Sign-Off

- [ ] All checklist items complete
- [ ] Testing successful
- [ ] No critical issues
- [ ] Ready for production

**Deployment Date:** _____________
**Tested By:** _________________
**Approved By:** ________________

---

**Version:** 1.0
**Last Updated:** Feb 5, 2026
