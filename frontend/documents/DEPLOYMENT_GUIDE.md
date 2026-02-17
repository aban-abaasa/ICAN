# Membership Application & Voting System Deployment Guide

## Problem
Admins cannot approve applications, and admins are seeing applications as if they submitted them.

## Root Causes
1. **Missing Database Tables**: The `membership_applications` and `membership_votes` tables haven't been deployed to Supabase yet
2. **Missing RLS Policies**: Row-Level Security policies for admins to update applications aren't in place
3. **Admin Filtering Issue**: The frontend doesn't properly filter applications to show only those for admin's groups

## Solution

### Step 1: Deploy Database Schema to Supabase (CRITICAL)

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Click **SQL Editor** (left sidebar)
4. Click **New query**
5. Copy and paste the entire contents of: `backend/db/membership_approval_schema.sql`
6. Click **Run**
7. Verify no errors appear

**What gets created:**
- `membership_applications` table (with 6 status types)
- `membership_votes` table (yes/no voting)
- 6 performance indexes
- Row-Level Security (RLS) policies for:
  - Users can view own applications
  - Admins can view & update applications for their groups
  - Members can view votes and vote on applications
  - Admins can insert approved members
- Helper functions for vote calculations

### Step 2: Enable Row-Level Security (RLS)

1. In Supabase, go to **SQL Editor**
2. Run this query to enable RLS on the new tables:

```sql
-- Enable RLS on membership_applications
ALTER TABLE membership_applications ENABLE ROW LEVEL SECURITY;

-- Enable RLS on membership_votes
ALTER TABLE membership_votes ENABLE ROW LEVEL SECURITY;
```

3. Verify in **Authentication** → **Policies** that policies appear for both tables

### Step 3: Verify Frontend Code

The following files should already have the correct code:

#### File: `frontend/src/services/trustService.js`
- ✅ Function `adminApproveApplication` (line 1180) - Updated with admin verification
- ✅ Function `adminRejectApplication` (line 1220) - Updated with admin verification
- ✅ Function `getPendingApplicationsForAdmin` - Fetches pending apps for group
- ✅ Function `getVotingApplicationsForMember` - Fetches voting apps for admin

#### File: `frontend/src/components/Slot.jsx`
- ✅ Admin dashboard showing only creator's groups
- ✅ Filters: `createdGroups = groups.filter(g => g.creator_id === user.id)`
- ✅ Shows statistics: pending, voting, approved, rejected

#### File: `frontend/src/components/AdminApplicationPanel.jsx`
- ✅ Two tabs: "Pending Review" and "In Voting"
- ✅ Loads data: pending apps, voting apps, group stats
- ✅ Approve button: calls `adminApproveApplication`
- ✅ Reject button: calls `adminRejectApplication`
- ✅ Real-time voting progress with 60% threshold indicator

#### File: `frontend/src/components/SACCOHub.jsx`
- ✅ Filters Explore tab: `groups.filter(g => g.creator_id !== user?.id)`
- ✅ Filters My Groups tab: `myGroups.filter(g => g.creator_id !== user?.id)`
- ✅ Shows application form modal
- ✅ Tracks application status: Awaiting Review → Admin Approved → Member Vote → Approved

### Step 4: Test the Complete Workflow

#### Test 1: User Applies to Join
1. Log in as **User A**
2. Go to **Explore tab** in SACCOHub
3. Click **Apply to Join** on a group (created by User B)
4. Fill in application text
5. Click **Submit**
6. Go to **My Applications tab**
7. **Verify**: Application shows with status "Awaiting Review"

#### Test 2: Admin Approves Application
1. Log in as **User B** (group creator/admin)
2. You should see **Admin Dashboard** (not SACCOHub)
3. Click on the group
4. See the **Pending Review** tab
5. Find User A's application
6. Click **Approve & Start Voting**
7. **Verify**: 
   - Application status changes to "In Voting"
   - Application moves to "In Voting" tab

#### Test 3: Members Vote on Application
1. Log in as **User C, D, E, F** (group members)
2. Go to **Voting** tab in their respective components
3. See User A's application
4. Each member votes "Approve" or "Reject"
5. **Verify**: Voting progress updates in AdminApplicationPanel

#### Test 4: Auto-Approval at 60%
1. With 5 group members total:
   - 3 members vote "Approve" = 60%
2. **Verify in AdminApplicationPanel**:
   - Auto-approval message appears
   - Application moves to approved status
3. **Verify User A can now**:
   - See the group in "My Groups" tab
   - Participate as full member

#### Test 5: Admin/User Separation
1. Log in as **Group Creator**
   - Should see **Admin Dashboard** (Slot.jsx)
   - Should NOT see SACCOHub
   - Can only manage groups they created
2. Log in as **Regular Member**
   - Should see **SACCOHub**
   - Should NOT see Admin Dashboard
   - Cannot see groups they created
   - Can apply to other groups

### Step 6: Troubleshooting

If admins still can't approve:

**Check 1: Verify RLS Policy Exists**
```sql
SELECT * FROM pg_policies 
WHERE tablename = 'membership_applications' 
AND policyname LIKE '%approve%';
```

**Check 2: Check Application Permissions**
```sql
-- As admin user, try to update an application
UPDATE membership_applications 
SET status = 'voting_in_progress' 
WHERE id = 'application-id' 
RETURNING *;
```

**Check 3: Check Browser Console**
1. Open Developer Tools (F12)
2. Go to **Console** tab
3. When admin clicks "Approve", look for error messages
4. Screenshot the error and check against database logs

**Check 4: Verify Admin User ID**
```javascript
// In AdminApplicationPanel.jsx, add this to console:
console.log('Admin ID:', user?.id);
console.log('Group ID:', groupId);
console.log('Group Creator ID:', stats?.creator_id);
```

**Check 5: Verify Database Connection**
```javascript
// In trustService.js, add this:
const sb = getSupabase();
console.log('Supabase client:', sb ? 'Connected' : 'NOT Connected');
```

### Step 7: Common Issues & Fixes

**Issue**: "You do not have permission to manage this group"
- **Fix**: Verify the group's `creator_id` matches the logged-in admin's `user.id`

**Issue**: "Application not found or already processed"
- **Fix**: Ensure `group_id` filter in update query matches the application's group

**Issue**: Admin sees applications as if they submitted them
- **Fix**: Ensure AdminApplicationPanel uses `adminId` not `userId` in filtering

**Issue**: RLS policy preventing updates
- **Fix**: Run the SQL deployment again, ensure no errors

**Issue**: Members can't vote
- **Fix**: Ensure they are active members (`is_active = true`) in the group

### Deployment Checklist

- [ ] Deployed `membership_approval_schema.sql` to Supabase
- [ ] Enabled RLS on `membership_applications` table
- [ ] Enabled RLS on `membership_votes` table
- [ ] Verified RLS policies exist in Supabase
- [ ] Tested User Apply workflow
- [ ] Tested Admin Approve workflow
- [ ] Tested Member Voting workflow
- [ ] Tested Auto-Approval at 60%
- [ ] Verified Admin/User separation
- [ ] Verified no RLS errors in browser console

### File References

- Schema: `ICAN/backend/db/membership_approval_schema.sql`
- Service: `ICAN/frontend/src/services/trustService.js` (lines 1180-1250)
- Admin Dashboard: `ICAN/frontend/src/components/Slot.jsx`
- Admin Panel: `ICAN/frontend/src/components/AdminApplicationPanel.jsx`
- User Hub: `ICAN/frontend/src/components/SACCOHub.jsx`
- Voting: `ICAN/frontend/src/components/VotingInterface.jsx`
