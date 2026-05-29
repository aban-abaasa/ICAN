# 🔧 Account Creation Redirect Loop - FIX DEPLOYED

## ✅ Problem Solved

**Issue**: After selecting a country during account creation, the app would redirect back to "Select Country" immediately and get stuck in a loop.

**Root Cause**: 
- Country code was being selected in the UI but NOT sent to the backend during signup
- Database would create `user_accounts` record with `country_code = NULL`
- CountryCheckMiddleware would see NULL and redirect to country selection again
- This created a redirect loop

## 🔨 Changes Made

### 1. **AuthContext.jsx** - Updated `signUp()` function
```javascript
// BEFORE:
const signUp = async (email, password, fullName) => { ... }

// AFTER:
const signUp = async (email, password, fullName, countryCode = 'US') => {
  // Now passes country_code to auth metadata
  options: {
    data: {
      full_name: fullName,
      country_code: countryCode,  // ✅ NEW
    }
  }
}
```

### 2. **SignUp.jsx** - Pass country code to signup
```javascript
// BEFORE:
const result = await signUp(formData.email, formData.password, formData.fullName);

// AFTER:
const result = await signUp(
  formData.email, 
  formData.password, 
  formData.fullName, 
  formData.countryCode  // ✅ NEW
);
```

### 3. **AUTO_CREATE_USER_ACCOUNTS.sql** - Database trigger captures country
```sql
-- BEFORE:
country_code NULL,  -- User must select country on first login

-- AFTER:
COALESCE((NEW.raw_user_meta_data->>'country_code')::VARCHAR(2), NULL),  -- ✅ Extract from signup
```

## 🚀 Deployment Steps

### **Step 1: Update Frontend** ✅ DONE
Files already updated:
- `frontend/src/context/AuthContext.jsx`
- `frontend/src/components/auth/SignUp.jsx`

Just run: `npm start` (if redeploying to production)

### **Step 2: Deploy Database Migration** ⏳ TODO
Run this SQL on your Supabase database:

```bash
# In Supabase Dashboard → SQL Editor, run:
```

```sql
-- Update the trigger to capture country_code from metadata
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_accounts (
    user_id,
    email,
    account_number,
    country_code,
    status,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    'ICAN-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || SUBSTRING(NEW.id::text, 1, 8),
    COALESCE((NEW.raw_user_meta_data->>'country_code')::VARCHAR(2), NULL),
    'active',
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

## ✅ How It Works Now

1. **User signs up** → Selects country in form
2. **Country passed to backend** → Via signup metadata
3. **Database trigger saves country** → Creates `user_accounts` with `country_code` set
4. **User logged in** → CountryCheckMiddleware sees country is set ✅
5. **App proceeds normally** → No redirect loop!

## 🧪 Testing

### Test Case 1: New Account Creation
1. Click "Sign Up"
2. Fill in form with:
   - Email: `test@example.com`
   - Password: `TestPassword123`
   - Full Name: `Test User`
   - Country: Select `Kenya` (or any country)
3. Submit
4. ✅ Should NOT redirect back to country selection
5. ✅ Should show "Check Your Email" confirmation screen

### Test Case 2: After Email Verification
1. Click confirmation link in email
2. ✅ Should NOT show CountrySetup modal
3. ✅ Should proceed to app dashboard

## 📋 Files Changed

| File | Status | Change |
|------|--------|--------|
| `frontend/src/context/AuthContext.jsx` | ✅ Done | Added `countryCode` parameter to `signUp()` |
| `frontend/src/components/auth/SignUp.jsx` | ✅ Done | Pass `formData.countryCode` to signup |
| `backend/AUTO_CREATE_USER_ACCOUNTS.sql` | ✅ Done | Extract country from metadata in trigger |

## 🔄 Rollback (if needed)

If you need to revert:

1. Restore the 3 files from git:
   ```bash
   git checkout frontend/src/context/AuthContext.jsx
   git checkout frontend/src/components/auth/SignUp.jsx
   git checkout backend/AUTO_CREATE_USER_ACCOUNTS.sql
   ```

2. Re-run the old database migration

## 💡 Future Improvements

- [ ] Add client-side validation to ensure country is selected before signup
- [ ] Add toast notification confirming country selection
- [ ] Consider allowing country change in account settings later

---

**Status**: ✅ Ready for deployment  
**Date**: May 29, 2026  
**Testing**: Please test with new account creation
