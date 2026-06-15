# 🌍 Country Selection & Protection Guide

## Overview
Country selection is now **mandatory** for ICAN Wallet users. This ensures all transactions and valuations are in the correct currency.

## Implementation Guide

### 1. **SignUp - Country Selection**

The `SignUp.jsx` component already includes country selection:

```jsx
// In SignUp.jsx - Country is now required
const validateForm = () => {
  // ... other validations
  if (!formData.email || !formData.password || !formData.fullName || !formData.countryCode) {
    setError('Please fill in all required fields including country selection');
    return false;
  }
  // ...
};
```

**Features:**
- 6 regions to filter countries (East Africa, West Africa, etc.)
- 13 countries with flags and ICAN rates
- Visual selection grid
- Shows selected country info

### 2. **useCountry Hook** - Check Country Status

Use this hook in any component to check/manage country:

```jsx
import useCountry from '../hooks/useCountry';

function MyComponent() {
  const { country, loading, error, hasCountry, updateCountry } = useCountry();

  if (loading) return <div>Loading...</div>;
  
  // Check if country is set
  if (!hasCountry()) {
    return <p>Please set your country in settings</p>;
  }

  return <div>{country}</div>;
}
```

**Hook Methods:**
- `country` - Current country code (e.g., 'US', 'UG', 'KE')
- `loading` - Whether data is being fetched
- `error` - Any error loading country
- `hasCountry()` - Returns true if country is set (not default 'US')
- `updateCountry(countryCode)` - Updates user's country

### 3. **CountrySetup Component** - Force Country Selection

Use this component to require country selection:

```jsx
import CountrySetup from '../components/auth/CountrySetup';

// As a full-screen component
<CountrySetup 
  onCountrySet={(country) => console.log('Country set:', country)}
/>

// As a modal overlay
<CountrySetup 
  isModal={true}
  onCountrySet={(country) => window.location.reload()}
/>
```

**Features:**
- Beautiful UI with region/country selection
- Success screen after selection
- Automatic database update
- Optional modal mode for overlays

### 4. **ProtectedIcanRoute** - Guard Protected Features

Wrap ICAN components to prevent access without country:

```jsx
import ProtectedIcanRoute from '../components/ican/ProtectedIcanRoute';
import BuyIcan from '../components/ican/BuyIcan';

// In your router
<Route 
  path="/buy-ican" 
  element={
    <ProtectedIcanRoute>
      <BuyIcan />
    </ProtectedIcanRoute>
  }
/>

// Or in component
function Dashboard() {
  return (
    <ProtectedIcanRoute>
      <div className="dashboard-content">
        {/* Protected content here */}
      </div>
    </ProtectedIcanRoute>
  );
}
```

## 5. **Flow Diagram**

```
User Signs Up
    ↓
Country Selection (Required)
    ↓
Account Created
    ↓
First Login
    ↓
useCountry Hook checks hasCountry()
    ↓
hasCountry() returns true?
    ├─ YES → Access ICAN features
    └─ NO → Show CountrySetup modal → After selection → Reload
```

## 6. **Integration Checklist**

- [x] SignUp includes country selection (already done)
- [ ] Add routes for ICAN features wrapped in `ProtectedIcanRoute`
- [ ] Integrate `useCountry` hook in dashboard
- [ ] Add country selection to user settings (edit country)
- [ ] Update user profile page to show current country

## 7. **Example: Protecting Buy ICAN Page**

```jsx
// routes/IcanRoutes.jsx
import ProtectedIcanRoute from '../components/ican/ProtectedIcanRoute';
import BuyIcan from '../components/ican/BuyIcan';
import SellIcan from '../components/ican/SellIcan';
import IcanPortfolio from '../components/ican/IcanPortfolio';

export const icanRoutes = [
  {
    path: '/buy-ican',
    element: (
      <ProtectedIcanRoute>
        <BuyIcan />
      </ProtectedIcanRoute>
    )
  },
  {
    path: '/sell-ican',
    element: (
      <ProtectedIcanRoute>
        <SellIcan />
      </ProtectedIcanRoute>
    )
  },
  {
    path: '/portfolio',
    element: (
      <ProtectedIcanRoute>
        <IcanPortfolio />
      </ProtectedIcanRoute>
    )
  }
];
```

## 8. **Database Schema**

User's country is stored in `user_profiles` table:

```sql
ALTER TABLE user_profiles ADD COLUMN country_code VARCHAR(2) DEFAULT 'US';

-- Example data
-- User ID: abc123
-- country_code: 'UG' (Uganda)
```

## 9. **Supported Countries**

```
East Africa:
- Uganda (UG)
- Kenya (KE)
- Tanzania (TZ)
- Rwanda (RW)

Southern Africa:
- Botswana (BW)
- South Africa (ZA)

West Africa:
- Nigeria (NG)
- Ghana (GH)

North America:
- USA (US)
- Canada (CA)

Europe:
- UK (GB)

South Asia:
- India (IN)

Oceania:
- Australia (AU)
```

Each country has:
- Flag emoji
- Currency code
- ICAN coin rate at 5000 UGX base

## 10. **Testing**

**Test Case 1: New User Signup**
```
1. Go to signup page
2. Fill form
3. Select country (required)
4. Account created
5. Country saved to database
```

**Test Case 2: User Without Country**
```
1. User with NULL country tries to access /buy-ican
2. ProtectedIcanRoute detects no country
3. CountrySetup modal appears
4. User selects country
5. Page reloads with country set
6. BuyIcan component loads
```

**Test Case 3: Existing User with Country**
```
1. User logs in
2. Country already set
3. Direct access to /buy-ican works
4. No setup modal appears
```

## 11. **Configuration**

**Default Country:** 'US' (fallback, user should set their actual country)

**Database Field:** `user_profiles.country_code`

**Validation:** 
- Must be one of the 13 supported country codes
- Required for ICAN features
- Can be changed anytime in settings

## Next Steps

1. Add ICAN routes to main router with `ProtectedIcanRoute`
2. Create settings page to change country
3. Add country badge to user profile
4. Display country in dashboard header
5. Show currency symbol in all wallet operations
