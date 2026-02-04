# 🌍 Country Selection System - Implementation Guide

## Overview
This system **automatically checks for country selection** on login. If a user hasn't set their country yet (even if they have an existing account), they are **forced to set it** before accessing the app.

## ✅ What's Included

### 1. **CountryCheckMiddleware** - App-Level Country Enforcement
Runs automatically on app load. Checks:
- Is user authenticated?
- Has user selected a country?
- If no country → Show CountrySetup modal (mandatory)
- If country set → Allow app access

### 2. **Updated CountrySetup Component**
- New header: "Set Your Base Currency" (when mandatory)
- Works for both new users (signup) and existing users (login)
- Shows success screen after country selection
- Beautiful UI with country grid and region filter

### 3. **Updated useCountry Hook**
- `isCountrySet` - Explicitly checks if country is set (not null)
- `hasCountry()` - Returns true only if country actually selected
- Works for both new and existing users

### 4. **Database Enforcement**
- SQL migration creates functions to check country status
- Trigger prevents ICAN operations without country
- View shows users who need to set country

## 🚀 Implementation Steps

### Step 1: Update Your Main App.jsx

Replace your current App.jsx with this structure:

```jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import CountryCheckMiddleware from './components/auth/CountryCheckMiddleware';

// Import your pages
import LoginPage from './pages/LoginPage';
import SignUpPage from './pages/SignUpPage';
import DashboardPage from './pages/DashboardPage';

function App() {
  return (
    <AuthProvider>
      <CountryCheckMiddleware>
        <Router>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            {/* All other protected routes */}
          </Routes>
        </Router>
      </CountryCheckMiddleware>
    </AuthProvider>
  );
}

export default App;
```

**Key Points:**
- `CountryCheckMiddleware` wraps everything (including Router)
- It runs AFTER AuthProvider so user context is available
- It intercepts navigation and shows country setup if needed

### Step 2: Run Database Migration

Go to Supabase Dashboard → SQL Editor and run:

```sql
-- See: supabase/migrations/enforce_country_selection.sql
-- Copy entire file content and run
```

This creates:
- `country_code` column (if missing)
- `has_country_set()` function - checks if user has country
- `check_user_has_country()` trigger - prevents ICAN ops without country
- `users_without_country` view - see who needs to set country

### Step 3: Update Sign-Up Flow

Your SignUp.jsx **already has** country selection! Just verify:

```jsx
// In SignUp.jsx validation
const validateForm = () => {
  if (!formData.countryCode) {
    setError('Please select your country');
    return false;
  }
  // ... other validations
};
```

### Step 4: Test Both Flows

**Test 1: New User Signup**
1. Go to /signup
2. Fill form
3. **Select country** (required field)
4. Create account
5. Login → App loads (country already set)

**Test 2: Existing User (No Country)**
1. Go to /login
2. Login with email/password
3. **CountrySetup modal appears** automatically
4. User **must** select country
5. Modal closes → App loads

**Test 3: Existing User (Has Country)**
1. Go to /login
2. Login with email/password
3. App loads **immediately** (no country setup)

## 📊 Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                  App Loads                              │
│              CountryCheckMiddleware Starts              │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ↓
        ┌──────────────────────────────┐
        │ Is User Authenticated?       │
        └──────────┬──────────┬────────┘
         NO        │          │ YES
                   ↓          ↓
            [Login/Signup]   ┌────────────────────────────────┐
                             │ Does User Have Country Set?    │
                             └──────────────┬─────────┬───────┘
                                        YES  │         │ NO
                                           ↓          ↓
                                        [App]   [CountrySetup Modal]
                                                       │
                                                       ↓
                                                [User Selects Country]
                                                       │
                                                       ↓
                                                [Reload App]
                                                       │
                                                       ↓
                                                    [App]
```

## 🔑 Key Features

### ✅ Automatic Country Check
- Runs on app initialization
- Checks after every login
- No manual setup needed

### ✅ Works for All User Types
- **New users**: Country selected during signup
- **Existing users without country**: Forced to select on login
- **Existing users with country**: Normal app flow

### ✅ Database Enforcement
- Country required to make ICAN transactions
- SQL trigger prevents invalid operations
- View to identify users needing country setup

### ✅ Beautiful UX
- Modal overlay with country selection
- Region filter to narrow choices
- Success screen after selection
- "Set Your Base Currency" messaging

## 🛠️ Customization

### Change the Text
Edit `CountrySetup.jsx`:

```jsx
<h1>{isMandatory ? 'Set Your Base Currency' : 'Choose Your Country'}</h1>
```

### Skip Country Check for Certain Routes
Edit `CountryCheckMiddleware.jsx`:

```jsx
// Add exceptions
const unprotectedRoutes = ['/login', '/signup', '/help'];
if (unprotectedRoutes.includes(location.pathname)) {
  return children;
}
```

### Pre-Select a Country
Edit `CountrySetup.jsx`:

```jsx
const [selectedCountry, setSelectedCountry] = useState('US');
```

## 🗄️ Database Queries

### Check if specific user has country
```sql
SELECT has_country_set('USER_ID'::UUID);
```

### See all users without country
```sql
SELECT * FROM users_without_country;
```

### Update user's country manually
```sql
UPDATE user_profiles SET country_code = 'UG' WHERE id = 'USER_ID'::UUID;
```

### Check all countries set
```sql
SELECT id, email, country_code FROM user_profiles WHERE country_code IS NOT NULL;
```

## 📋 Supported Countries

```
Code  | Country        | Flag | Currency
------|----------------|------|----------
UG    | Uganda         | 🇺🇬  | UGX
KE    | Kenya          | 🇰🇪  | KES
TZ    | Tanzania       | 🇹🇿  | TZS
RW    | Rwanda         | 🇷🇼  | RWF
BW    | Botswana       | 🇧🇼  | BWP
ZA    | South Africa   | 🇿🇦  | ZAR
NG    | Nigeria        | 🇳🇬  | NGN
GH    | Ghana          | 🇬🇭  | GHS
US    | United States  | 🇺🇸  | USD
GB    | United Kingdom | 🇬🇧  | GBP
CA    | Canada         | 🇨🇦  | CAD
AU    | Australia      | 🇦🇺  | AUD
IN    | India          | 🇮🇳  | INR
```

## ⚠️ Important Notes

1. **country_code is NOT NULL** - Users must explicitly set it
2. **Default 'US' removed** - Explicitly checking for null/empty
3. **On every login** - Country checked automatically
4. **Database trigger** - Prevents ICAN transactions without country
5. **Modal mandatory** - User cannot close without selecting

## 🐛 Troubleshooting

### User stuck on country setup?
```sql
-- Check their country status
SELECT id, email, country_code FROM user_profiles WHERE email = 'user@example.com';

-- If NULL, update it
UPDATE user_profiles SET country_code = 'UG' WHERE email = 'user@example.com';
```

### Country check not appearing?
- Verify `CountryCheckMiddleware` wraps Router in App.jsx
- Check browser console for errors
- Ensure user is actually authenticated (check AuthContext)

### Can't complete ICAN transaction?
- Make sure user's country_code is set in DB
- Check database trigger is active
- Verify user is making request

## 📚 Files Created

```
frontend/
├── src/
│   ├── components/
│   │   ├── auth/
│   │   │   ├── CountrySetup.jsx ← Updated (new isModal prop)
│   │   │   ├── CountrySetup.css
│   │   │   └── CountryCheckMiddleware.jsx ← NEW
│   │   └── ican/
│   │       └── ProtectedIcanRoute.jsx
│   ├── hooks/
│   │   └── useCountry.js ← Updated (isCountrySet added)
│   └── APP_INTEGRATION_EXAMPLE.jsx ← Reference
└── supabase/
    └── migrations/
        └── enforce_country_selection.sql ← NEW
```

## 🎯 Next Steps

1. Update App.jsx with CountryCheckMiddleware wrapper
2. Run database migration on Supabase
3. Test signup with country selection
4. Test login with existing user (no country)
5. Deploy to production
