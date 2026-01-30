# 🔍 Debugging: Google Sign In with Mandatory Country Check

## Issues & Fixes Applied

### Problem: Users bypassing country selection
**Status:** ✅ FIXED

**Root Cause:** 
- CountryCheckMiddleware was imported but NOT being used in App.jsx
- Users could reach the app without setting country_code

**Solution Applied:**

1. **Added CountryCheckMiddleware to App.jsx**
   - Now wraps both Desktop (`ICANCapitalEngine`) and Mobile (`MobileView`)
   - Middleware runs BEFORE showing any app content

2. **Made CountrySetup Modal Mandatory**
   - Added `isMandatory={true}` prop
   - Escape key is blocked (prevented)
   - Clicking outside modal is blocked
   - User MUST select country to proceed

3. **Added Strict Country Verification**
   - Checks that `country_code` is NOT NULL
   - Checks that `country_code` is NOT empty
   - Checks that `country_code` has trim() length > 0

4. **Enhanced Logging**
   - Console logs show exact check flow
   - Visible in browser DevTools → Console tab
   - Helps identify where/why users are passing or blocking

## How to Test

### Test 1: New Google Sign In (No Country Set)
```
1. Open app
2. Click "Sign in with Google"
3. Authenticate with Google
4. Should see: "Set Your Base Currency" modal
5. Modal CANNOT be closed (try Escape, clicking outside)
6. Select a country
7. App should reload and show main dashboard
```

**Expected Console Logs:**
```
🔍 Checking country for user: <user-id>
📊 Query result: { data: { country_code: null, ... }, error: null }
🌍 User has NO country set - BLOCKING - showing CountrySetup modal
```

### Test 2: Existing User (Country Already Set)
```
1. User has country_code already in user_accounts
2. Sign in with Google
3. Should NOT see modal
4. Should go straight to app
```

**Expected Console Logs:**
```
🔍 Checking country for user: <user-id>
📊 Query result: { data: { country_code: "UG", ... }, error: null }
✅ User country is SET: UG - ALLOWING app access
```

### Test 3: Verify Data in Database
```sql
-- Check if country was saved
SELECT user_id, country_code, ican_coin_balance 
FROM user_accounts 
WHERE user_id = 'your-user-id';

-- Should show:
-- user_id: <uuid>
-- country_code: "UG" (or other country code)
-- ican_coin_balance: 0
```

## Browser Console Debugging

### Open DevTools
```
Windows/Linux: F12 or Ctrl+Shift+I
Mac: Cmd+Option+I
```

### Go to Console Tab
- Should see logs like:
  ```
  📱 Device Info: {...}
  🔐 No user authenticated yet
  🔍 Checking country for user: ...
  📊 Query result: {...}
  🌍 User has NO country set - BLOCKING - showing CountrySetup modal
  ```

### Watch for these messages:
| Message | Meaning |
|---------|---------|
| 🔍 Checking country for user | Middleware is running ✅ |
| 📊 Query result | Database query completed |
| 🌍 User has NO country set | Modal will appear ✅ |
| ✅ User country is SET | App will load ✅ |
| ❌ Error checking country | Something failed ❌ |
| 🔒 Escape key blocked | Mandatory modal is working ✅ |
| 🔒 Backdrop click blocked | Mandatory modal is working ✅ |

## Common Issues & Solutions

### Issue 1: Modal not appearing
**Solution:**
1. Check console for errors
2. Verify CountryCheckMiddleware is imported in App.jsx
3. Verify middleware wraps the right components
4. Check that country_code is actually NULL in database

**Diagnostic Query:**
```sql
SELECT country_code FROM user_accounts 
WHERE user_id = 'your-user-id';
-- Should show: NULL (or empty)
```

### Issue 2: User can close modal
**Solution:**
1. Check that `isMandatory={true}` is passed to CountrySetup
2. Verify keyboard event listeners are added
3. Check browser console for blocked event messages

**Debug:**
```javascript
// In browser console, try:
document.querySelector('.country-setup-container');
// Should exist when modal is showing
```

### Issue 3: App loads even without country
**Solution:**
1. Verify migration was run: `ican_wallet_user_accounts.sql`
2. Verify country_code column exists on user_accounts
3. Check that `isMandatory={true}` is being passed
4. Look at console logs - middleware should block it

**Migration Check:**
```sql
-- Check if column exists
SELECT column_name FROM information_schema.columns
WHERE table_name = 'user_accounts'
AND column_name = 'country_code';
-- Should return: country_code
```

### Issue 4: CountryCheckMiddleware shows infinite loading
**Solution:**
1. Check that auth is properly initialized
2. Look for network errors in DevTools Network tab
3. Verify Supabase credentials in .env
4. Check that `getSupabaseClient()` is working

**Debug:**
```javascript
// In browser console:
const { getSupabaseClient } = await import('./services/supabaseClient');
const supabase = getSupabaseClient();
console.log('Supabase:', supabase ? 'Initialized' : 'NOT initialized');
```

## File Changes Made

| File | Change | Status |
|------|--------|--------|
| App.jsx | Added CountryCheckMiddleware import + wrapping | ✅ |
| CountryCheckMiddleware.jsx | Strict country check + better logging | ✅ |
| CountrySetup.jsx | Added isMandatory prop + keyboard blocking | ✅ |
| AuthContext.jsx | Added checkUserCountry helper | ✅ |
| SignIn.jsx | Added comment about auto country check | ✅ |

## Next Steps

1. ✅ Code changes deployed
2. Run migration on Supabase: `ican_wallet_user_accounts.sql`
3. Test with Google Sign In
4. Watch browser console for logs
5. Verify country_code is saved in database
6. Confirm ICAN features accessible after country set

## Quick Start Testing

```bash
# 1. Open app in browser
# 2. Go to Console (F12)
# 3. Click "Sign in with Google"
# 4. Watch console logs appear
# 5. Should see: "User has NO country set - BLOCKING"
# 6. Modal should appear
# 7. Select country
# 8. Page reloads
# 9. App loads normally
# 10. Check database - country_code should be saved ✅
```

## Still Having Issues?

1. **Check migration was run** - Does user_accounts have country_code column?
2. **Check browser console** - What errors are shown?
3. **Check database** - Does user_accounts record exist for the user?
4. **Check logs** - Are the right console messages appearing?
5. **Try incognito window** - Clear cache and test fresh login

