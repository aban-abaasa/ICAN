# Co-Owner Persistence - Debugging & Verification Guide

## Issue Summary
**Problem**: After fixing the form UI (empty co-owners list), profiles still weren't saving co-owners to the database.

**Root Cause**: The service layer had NO function to persist co-owners to the `business_co_owners` table.

**Solution**: Added `saveBusinessCoOwners()` function to save co-owners after profile creation.

---

## Verification Steps

### Step 1: Check Browser Console
When you create a profile with co-owners, open DevTools (F12) and look for:

**Success Flow**:
```
✨ Creating new profile
👥 Saving co-owners...
✅ Saved 2 co-owners successfully
✅ Profile and co-owners created successfully
```

**Failure Cases**:
```
"Error saving co-owners: [error message]"
"Profile created but failed to save co-owners: [error message]"
```

### Step 2: Check Database
1. Go to Supabase Dashboard → SQL Editor
2. Run this query:

```sql
-- Check if business_co_owners were created
SELECT 
  bp.business_name,
  COUNT(bco.id) as co_owner_count,
  SUM(bco.ownership_share) as total_ownership
FROM business_profiles bp
LEFT JOIN business_co_owners bco ON bp.id = bco.business_profile_id
WHERE bp.business_name = 'Your Business Name'
GROUP BY bp.business_name;
```

Expected result:
```
business_name    | co_owner_count | total_ownership
─────────────────┼────────────────┼─────────────────
Tech Co          | 2              | 100.00
```

### Step 3: View Co-Owner Details
```sql
-- See all co-owners for a specific business
SELECT 
  owner_name,
  owner_email,
  ownership_share,
  role,
  status,
  verification_status,
  created_at
FROM business_co_owners
WHERE business_profile_id = 'PROFILE_ID_HERE'
ORDER BY created_at DESC;
```

Expected result:
```
owner_name | owner_email      | ownership_share | role        | status
───────────┼──────────────────┼─────────────────┼─────────────┼────────
Alice      | alice@ican.com   | 60.00           | Co-Founder  | active
Bob        | bob@ican.com     | 40.00           | Co-Founder  | active
```

---

## Common Issues & Solutions

### Issue 1: Co-owners Not Appearing After Save

**Symptoms**:
- Profile saves successfully
- But co-owners count shows 0
- Supabase co-owners table is empty

**Debugging Steps**:
1. Check browser console for errors
2. Look for: `"Failed to save co-owners: ..."` message
3. Check if `business_co_owners` table exists in database
4. Verify user has permission to insert into `business_co_owners`

**Solutions**:
```sql
-- Check if table exists
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'business_co_owners';

-- Check table structure
\d public.business_co_owners

-- Check RLS policies
SELECT * FROM pg_policies 
WHERE tablename = 'business_co_owners';
```

### Issue 2: RLS Policy Prevents Insert

**Symptoms**:
- Profile saves but co-owners insert fails
- Console shows: `"Policy violation..."` error

**Solution**:
Ensure RLS policies allow co-owner inserts. The profile owner should be able to add co-owners:

```sql
-- Verify RLS policies exist
SELECT policyname, cmd FROM pg_policies 
WHERE tablename = 'business_co_owners';

-- Ensure at least one INSERT policy exists
CREATE POLICY "Users can add co-owners to their profiles" 
ON business_co_owners FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM business_profiles 
    WHERE business_profiles.id = business_co_owners.business_profile_id 
    AND business_profiles.user_id = auth.uid()
  )
);
```

### Issue 3: Co-owners Delete When Profile Updates

**Symptoms**:
- Create profile with co-owners ✓
- Edit profile later
- Co-owners disappeared

**Explanation**:
This is intentional! When you edit a profile and re-save co-owners, the function deletes old ones and inserts new ones. This is the update flow:

```javascript
// Delete old co-owners
await sb.from('business_co_owners').delete()
  .eq('business_profile_id', businessProfileId);

// Insert new co-owners
await sb.from('business_co_owners').insert(coOwnersData);
```

**This is correct behavior** - ensures the database reflects exactly what's in the form.

### Issue 4: Ownership % Not 100

**Symptoms**:
- Co-owners show with ownership shares
- But sum doesn't equal 100%
- Save button still disabled

**Debugging**:
Check form logic first:
```javascript
const totalShare = coOwners.reduce((sum, owner) => sum + (owner.ownershipShare || 0), 0);

// Should equal 100 before save
if (totalShare !== 100) {
  alert('Ownership shares must total exactly 100%');
  return;
}
```

**Solution**:
1. Verify all co-owners have ownership shares
2. Check that percentages add up to 100
3. Ensure no empty co-owner slots

---

## Testing Checklist

### Create New Profile Test
- [ ] Fill business info
- [ ] Click "Next: Add Co-Owners"
- [ ] Add first co-owner with 60% ownership
- [ ] Add second co-owner with 40% ownership
- [ ] Total shows 100%
- [ ] Click "Review Profile"
- [ ] All co-owners visible with percentages
- [ ] Click "Create Business Profile"
- [ ] Success alert appears
- [ ] Browser console shows "✅ Saved X co-owners successfully"
- [ ] Check Supabase → business_co_owners table
- [ ] Should see 2 new records with ownership_share values

### Edit Profile Test
- [ ] Open existing profile for editing
- [ ] Change co-owner percentages
- [ ] Remove one co-owner, add another
- [ ] Save profile
- [ ] Check Supabase
- [ ] Old co-owners removed, new ones added
- [ ] Ownership percentages updated

### Refresh Test
- [ ] Create profile with co-owners
- [ ] Press F5 to refresh page
- [ ] Navigate to profile
- [ ] Verify co-owners still appear
- [ ] Verify ownership percentages unchanged

---

## Database Inspection Queries

### Check All Profiles with Co-Owners
```sql
SELECT 
  bp.id,
  bp.business_name,
  COUNT(bco.id) as co_owner_count,
  STRING_AGG(bco.owner_name || ' (' || bco.ownership_share || '%)', ', ') as co_owners,
  SUM(bco.ownership_share) as total_ownership
FROM business_profiles bp
LEFT JOIN business_co_owners bco ON bp.id = bco.business_profile_id
GROUP BY bp.id, bp.business_name
ORDER BY bp.created_at DESC
LIMIT 10;
```

### Check Profile Missing Co-Owners
```sql
-- Find profiles without any co-owners (might be a problem)
SELECT bp.id, bp.business_name, bp.created_at
FROM business_profiles bp
LEFT JOIN business_co_owners bco ON bp.id = bco.business_profile_id
WHERE bco.id IS NULL
ORDER BY bp.created_at DESC;
```

### Check Invalid Ownership (not 100%)
```sql
-- Find profiles where co-owner ownership doesn't sum to 100%
SELECT 
  bp.business_name,
  SUM(bco.ownership_share) as total_ownership,
  bp.created_at
FROM business_profiles bp
LEFT JOIN business_co_owners bco ON bp.id = bco.business_profile_id
GROUP BY bp.id, bp.business_name, bp.created_at
HAVING SUM(bco.ownership_share) != 100 OR SUM(bco.ownership_share) IS NULL
ORDER BY total_ownership;
```

---

## Console Debugging

### Enable Detailed Logging
The code includes console.log statements. Check DevTools Console for:

**Normal Creation Flow**:
```
🔍 Checking mode - editingProfile: false ID: undefined
✨ Creating new profile
👥 Saving co-owners...
✅ Saved 2 co-owners successfully
✅ Profile and co-owners created successfully
```

**Update Flow**:
```
🔍 Checking mode - editingProfile: true ID: uuid-here
📝 Updating profile: uuid-here
👥 Saving co-owners...
✅ Saved 2 co-owners successfully
✅ Profile and co-owners update complete
```

### Check Network Requests
Open DevTools → Network tab, filter for:

**POST requests** - Creating/updating:
```
POST /rest/v1/business_profiles
POST /rest/v1/business_co_owners
```

**DELETE requests** - Cleaning old records:
```
DELETE /rest/v1/business_co_owners?business_profile_id=eq.uuid-here
```

Expected sequence:
1. POST business_profiles (201 Created)
2. DELETE business_co_owners (200 OK)
3. POST business_co_owners (201 Created)

---

## Error Messages Reference

| Error Message | Meaning | Solution |
|---|---|---|
| "Supabase not configured" | No database connection | Check Supabase client setup |
| "Policy violation" | RLS denied the request | Check RLS policies on table |
| "relation does not exist" | Table missing | Run database migrations |
| "Failed to save co-owners" | Insert operation failed | Check error details in console |
| "Ownership shares must total 100%" | Sum != 100 | Verify form math |

---

## Performance Notes

**Database Impact**:
- Creates 1 business_profiles record
- Creates N business_co_owners records (N = number of co-owners)
- Deletes old records when updating (to avoid duplicates)
- Each operation is a separate network request

**Optimization Tip**:
The delete + insert approach ensures clean state. If you had 5 co-owners and update to 2:
- Delete all 5 old records
- Insert 2 new records
- Result: exactly 2 records in DB (no orphaned data)

---

## Success Indicators

✅ **Form Level**:
- Co-owners list starts empty (no placeholder)
- Can add multiple co-owners
- Ownership % updates in real-time
- Save button disabled until 100%

✅ **Database Level**:
- business_co_owners table has records
- Records linked to business_profile_id
- ownership_share sums to 100
- All fields populated correctly

✅ **User Experience**:
- Clear console feedback
- Success alert message
- Co-owners persist after refresh
- Can edit and update co-owners

---

## Need More Help?

Check these files for the implementation:
- `frontend/src/components/BusinessProfileForm.jsx` - Form logic
- `frontend/src/services/pitchingService.js` - Database service
- `backend/db/schemas/04_business_profiles_blockchain.sql` - Database schema
