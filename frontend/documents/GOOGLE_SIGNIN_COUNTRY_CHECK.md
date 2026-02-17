# 🌍 Google Sign In with Automatic Country Check

## Overview

When users sign in with Google (both new and existing accounts), the system automatically checks if they have a `country_code` set in the `user_accounts` table. **If not set, they MUST set it before proceeding to the app.**

## Flow Diagram

```
User clicks "Sign in with Google"
           ↓
OAuth Redirect to Google
           ↓
Google authenticates user
           ↓
Redirect back to app with auth token
           ↓
AuthContext updates (user is now authenticated)
           ↓
CountryCheckMiddleware runs
           ↓
Check user_accounts.country_code
           ├─ country_code IS SET → Show App ✅
           └─ country_code IS NULL → Show CountrySetup Modal 🌍
                                     (Modal is MANDATORY - cannot close)
                                     ↓
                               User selects country
                                     ↓
                               Save to user_accounts.country_code
                                     ↓
                               Reload app with country set → Show App ✅
```

## Code Changes

### 1. AuthContext.jsx
**What changed:**
- Updated `signInWithGoogle()` with comment explaining the flow
- Added `checkUserCountry()` helper function to verify country_code exists
- Exported `checkUserCountry` in context value

**How it works:**
```jsx
const signInWithGoogle = async () => {
  // OAuth redirect happens
  // After redirect, user is authenticated
  // CountryCheckMiddleware automatically checks country_code
};

const checkUserCountry = async (userId) => {
  // Returns true if user_accounts.country_code is NOT null
  // Returns false if country_code is null or missing
};
```

### 2. CountryCheckMiddleware.jsx
**What changed:**
- Updated to query `user_accounts` table instead of `user_profiles`
- Changed column check from `user_profiles.id` to `user_accounts.user_id`
- Now checks `country_code` column only (not checking defaults)

**How it works:**
```jsx
// After user authenticates, middleware:
1. Gets user ID from AuthContext
2. Queries user_accounts table
3. Checks if country_code is NOT NULL
4. If NULL → Shows CountrySetup modal (mandatory)
5. If SET → Shows app normally
```

### 3. SignIn.jsx (UI Component)
**What changed:**
- Added comment to Google Sign In button explaining the automatic flow

**User sees:**
- "Sign in with Google" button
- Clicks it → redirected to Google OAuth
- Returns → CountrySetup modal appears if no country set
- **Cannot close the modal** without selecting country
- After selecting → App loads

## User Scenarios

### Scenario 1: New User via Google Sign In
```
1. User clicks "Sign in with Google"
2. Creates account on first OAuth
3. user_accounts.country_code = NULL (not set yet)
4. CountrySetup modal appears (mandatory)
5. User selects country (e.g., "UG" for Uganda)
6. Saves: user_accounts.country_code = "UG"
7. App reloads and loads normally ✅
```

### Scenario 2: Existing User via Google Sign In (No Country)
```
1. User has existing account from email signup
2. user_accounts.country_code = NULL (never set)
3. User now signs in with Google
4. CountrySetup modal appears (mandatory)
5. User selects country
6. Saves to user_accounts
7. App loads ✅
```

### Scenario 3: Existing User with Country Already Set
```
1. User signs in with Google
2. user_accounts.country_code = "KE" (already set)
3. CountryCheckMiddleware sees country_code is not NULL
4. App loads normally, no modal ✅
```

## Database Queries

### Check if user has country
```sql
SELECT country_code FROM user_accounts 
WHERE user_id = 'user-uuid'
LIMIT 1;

-- Returns:
-- country_code = 'UG' → Country is SET ✅
-- country_code = NULL → Country NOT SET 🌍
```

### Update user country (after selection)
```sql
UPDATE user_accounts
SET country_code = 'UG'
WHERE user_id = 'user-uuid';
```

## Related Components

### CountrySetup.jsx
- Modal component for country selection
- Called by CountryCheckMiddleware when needed
- Has `isMandatory` prop (set to true when force-required)
- Updates `user_accounts.country_code` on selection
- Triggers app reload to apply changes

### useCountry Hook
- Helper hook to get/set country
- Returns `country_code`, `isCountrySet` boolean
- Used by components that need country info

### ProtectedIcanRoute.jsx
- Guards ICAN features (/buy-ican, /sell-ican, etc.)
- Shows CountrySetup if country not set
- Shows loading if checking

## Key Points

✅ **Works for all users:**
- New users signing up with Google
- Existing users signing in with Google
- Users switching from email to Google OAuth

✅ **Mandatory country selection:**
- Cannot close the modal without selecting country
- Cannot access app without country_code in user_accounts
- Ensures ICAN operations have required country info

✅ **Uses correct database table:**
- Queries `user_accounts` (where ICAN wallet data lives)
- Uses `user_id` foreign key (not `id`)
- Stores country in `country_code` column

✅ **Seamless experience:**
- No error messages if done right
- Automatic modal appearance
- One-click country selection
- App reloads and works

## Testing Checklist

- [ ] Sign in with Google for new account → CountrySetup appears
- [ ] Select country → App loads
- [ ] Sign in with same account again → No modal (country saved)
- [ ] Sign in with email, then later with Google → CountrySetup appears if country not set
- [ ] Check user_accounts table shows country_code after setup
- [ ] Verify ICAN features work after country is set

## Troubleshooting

### Problem: "Column country_code does not exist"
**Solution:** Run the migration `ican_wallet_user_accounts.sql` in Supabase

### Problem: CountrySetup appears every login
**Solution:** Check that `user_accounts.country_code` is actually being saved (query the table directly)

### Problem: "Relation user_accounts does not exist"
**Solution:** Verify table name is `user_accounts`, not `user_profiles`

### Problem: Country not showing after selection
**Solution:** Check that `window.location.reload()` is called in CountrySetup.jsx after save

## Code Files Modified

| File | Change |
|------|--------|
| `frontend/src/context/AuthContext.jsx` | Updated signInWithGoogle + added checkUserCountry helper |
| `frontend/src/components/auth/CountryCheckMiddleware.jsx` | Changed user_profiles → user_accounts |
| `frontend/src/components/auth/SignIn.jsx` | Added comment explaining auto country check |

## Next Steps

1. ✅ Run migration: `ican_wallet_user_accounts.sql`
2. ✅ Code changes deployed
3. Test the flow with Google Sign In
4. Verify country_code is saved in user_accounts
5. Confirm ICAN features are accessible after country set
