# 🌍 User Country & Currency Binding System

## How the System Works

### 1. **Country Detection (3-Tier Fallback)**

The system checks for user's country in this order:

```
┌─────────────────────────────────────────────────────────────┐
│                    DETECT USER'S COUNTRY                     │
└─────────────────────────────────────────────────────────────┘

METHOD 1: Check user.user_metadata (Fastest)
  └─ Location: Supabase Auth Metadata
  └─ Field: user_metadata.country
  └─ Example: user_metadata.country = "UG"
  └─ Speed: ⚡ Instant (no database call)

        ↓ (If not found)

METHOD 2: Query icanCoinService (Database Lookup)
  └─ Location: user_accounts table
  └─ Query: SELECT country_code FROM user_accounts WHERE user_id = ?
  └─ Function: icanCoinService.getUserCountry(userId)
  └─ Speed: 🔄 1-2 seconds (database query)

        ↓ (If still not found)

METHOD 3: Use Default Fallback
  └─ Default Country: "US" (United States)
  └─ Default Currency: USD ($)
```

### 2. **Currency Binding to Country (ONE COUNTRY = ONE CURRENCY)**

Once country is detected, currency is **automatically determined**:

```javascript
// Country Code → Currency Code → Currency Symbol
const userCountryCode = "UG";  // or "KE", "US", etc.

// Get currency for this country (one-to-one mapping)
const currencyCode = CountryService.getCurrencyCode("UG");    // Returns: "UGX"
const currencySymbol = CountryService.getCurrencySymbol("UG"); // Returns: "USh"

// Result: User sees all amounts in UGX with USh symbol
// Example: USh 50,000
```

---

## **Where User Country is Stored**

### Primary Storage Location: `user_accounts` Table

```sql
┌─ Table: user_accounts
├─ Column: country_code (VARCHAR(2))
├─ Example Data:
│  ├─ User 1: country_code = "UG" → Currency = UGX (USh)
│  ├─ User 2: country_code = "KE" → Currency = KES (KSh)
│  ├─ User 3: country_code = "US" → Currency = USD ($)
│  └─ User 4: country_code = NULL → Uses default: US
└─
```

### Check Your Country in Database

```sql
-- Query to check a specific user's country
SELECT 
  user_id,
  country_code,
  ican_coin_balance,
  ican_updated_at
FROM user_accounts
WHERE user_id = 'YOUR_USER_ID';

-- Result example:
-- user_id          | country_code | ican_coin_balance | ican_updated_at
-- ─────────────────┼──────────────┼───────────────────┼──────────────────
-- abc123xyz        | UG           | 5000              | 2024-01-15
```

---

## **Supported Countries & Their Currencies**

| Country | Code | Currency | Symbol |
|---------|------|----------|---------|
| Uganda | UG | UGX (Ugandan Shilling) | USh |
| Kenya | KE | KES (Kenyan Shilling) | KSh |
| Tanzania | TZ | TZS (Tanzanian Shilling) | TSh |
| Rwanda | RW | RWF (Rwandan Franc) | FRw |
| Egypt | EG | EGP (Egyptian Pound) | £ |
| Nigeria | NG | NGN (Nigerian Naira) | ₦ |
| South Africa | ZA | ZAR (South African Rand) | R |
| Ghana | GH | GHS (Ghanaian Cedi) | ₵ |
| Botswana | BW | BWP (Botswana Pula) | P |
| USA | US | USD (US Dollar) | $ |
| Canada | CA | CAD (Canadian Dollar) | C$ |
| UK | GB | GBP (British Pound) | £ |
| Australia | AU | AUD (Australian Dollar) | A$ |
| India | IN | INR (Indian Rupee) | ₹ |
| And 190+ more countries... | | | |

---

## **How Contribution Modal Uses This System**

### Example: User from Uganda

```
Step 1: User logs in
        └─ user.id = "abc123xyz"
        └─ user.user_metadata.country = "UG" (or not set)

Step 2: ContributionModal loads
        └─ Calls: icanCoinService.getUserCountry(userId)
        └─ Queries: user_accounts table
        └─ Result: country_code = "UG"

Step 3: Currency is automatically set
        └─ userCountryCode = "UG"
        └─ userCurrency = "UGX"
        └─ currencySymbol = "USh"

Step 4: UI displays dynamically
        ├─ Label: "Contribution Amount (UGX)"
        ├─ Input prefix: USh
        ├─ Amounts show as: USh 50, USh 100, USh 250, USh 500
        ├─ Your Contribution: USh 100.00
        ├─ Annual Interest (10%): USh 10.00
        └─ Daily Growth: USh 0.03/day
```

---

## **Code Implementation (ContributionModal.jsx)**

### Three-Tier Country Detection

```jsx
useEffect(() => {
  const loadUserCountry = async () => {
    try {
      // METHOD 1: Try user metadata first (fastest)
      let userCountryCodeValue = user?.user_metadata?.country;
      
      // METHOD 2: If not in metadata, query database
      if (!userCountryCodeValue && user?.id) {
        const countryData = await icanCoinService.getUserCountry(user.id);
        userCountryCodeValue = countryData || 'US';
      }

      // METHOD 3: Default fallback
      if (!userCountryCodeValue) {
        userCountryCodeValue = 'US';
      }

      // Get all country info
      const countryInfo = CountryService.getCountry(userCountryCodeValue);
      const currencyCode = CountryService.getCurrencyCode(userCountryCodeValue);
      const currencySymbol = CountryService.getCurrencySymbol(userCountryCodeValue);
      
      // Set state
      setUserCountryCode(userCountryCodeValue);
      setUserCountry(countryInfo?.name || 'United States');
      setUserCurrency(currencyCode || 'USD');
      setCurrencySymbol(currencySymbol || '$');
      
      // Confirmation log
      console.log(`✅ User Country: ${userCountryCodeValue}, Currency: ${currencyCode}, Symbol: ${currencySymbol}`);
    } catch (error) {
      // Error fallback
      setUserCountryCode('US');
      setUserCountry('United States');
      setUserCurrency('USD');
      setCurrencySymbol('$');
    }
  };

  if (user?.id) {
    loadUserCountry();
  }
}, [user?.id]);
```

### UI Display (All amounts in user's country currency)

```jsx
{/* Group & Country Info Cards */}
<div className="grid grid-cols-2 gap-4">
  {/* Group Card */}
  <div className="bg-gradient-to-br from-amber-600/20 border border-amber-500/30 rounded-xl p-4">
    <p className="text-xs text-amber-300 uppercase">📊 Group</p>
    <h3 className="text-xl font-bold text-white">{group?.name}</h3>
    <p className="text-sm text-amber-200/70">
      Monthly Target: {currencySymbol}{group?.monthly_contribution}
    </p>
  </div>

  {/* Country Card - Currency is FIXED with Country */}
  <div className="bg-gradient-to-br from-cyan-600/20 border border-cyan-500/30 rounded-xl p-4">
    <p className="text-xs text-cyan-300 uppercase">🔐 Registered Currency</p>
    <h3 className="text-xl font-bold text-white">
      <Globe className="w-5 h-5 text-cyan-400" />
      {userCountry}  {/* e.g., "Uganda" */}
    </h3>
    <p className="text-sm text-cyan-200/70">
      <span className="text-cyan-300 font-semibold">{userCurrency}</span> {currencySymbol}
    </p>
    <p className="text-xs text-cyan-200/50 mt-2">
      Your account country: {userCountryCode}
    </p>
  </div>
</div>

{/* Contribution Amount - Shows currency dynamically */}
<label className="text-sm font-bold text-gray-300 mb-3">
  Contribution Amount ({userCurrency})
</label>
<div className="relative mb-4">
  <span className="absolute left-4 top-1/2 transform -translate-y-1/2">
    {currencySymbol}
  </span>
  <input 
    type="number" 
    placeholder="0.00" 
    value={amount}
    onChange={(e) => setAmount(e.target.value)}
  />
</div>

{/* Quick Amount Buttons - All in user's currency */}
<div className="grid grid-cols-4 gap-2">
  {[50, 100, 250, 500].map((amt) => (
    <button key={amt} onClick={() => setAmount(amt)}>
      {currencySymbol}{amt}  {/* Shows: USh50, KSh100, $250, etc. */}
    </button>
  ))}
</div>

{/* Financial Summary - All in user's currency */}
<div className="text-sm space-y-2">
  <div className="flex justify-between">
    <span>💰 Your Contribution</span>
    <span className="font-bold">{currencySymbol}{parseFloat(amount).toFixed(2)}</span>
  </div>
  <div className="flex justify-between">
    <span>📈 Annual Interest (10%)</span>
    <span className="font-bold">{currencySymbol}{(parseFloat(amount) * 0.1).toFixed(2)}</span>
  </div>
  <div className="flex justify-between">
    <span>📊 Daily Growth</span>
    <span className="font-bold">{currencySymbol}{(parseFloat(amount) * 0.1 / 365).toFixed(2)}/day</span>
  </div>
</div>
```

---

## **How to Verify It's Working**

### Method 1: Check Browser Console

1. Open your browser's Developer Tools (F12)
2. Go to **Console** tab
3. Log in to the app
4. Open the Contribution Modal
5. Look for log message:
   ```
   ✅ User Country: UG, Currency: UGX, Symbol: USh
   ```

### Method 2: Check Database Directly

```sql
-- Find your user ID (from Supabase dashboard)
-- Then run:
SELECT 
  user_id,
  country_code,
  preferred_currency,
  ican_coin_balance
FROM user_accounts
WHERE user_id = 'YOUR_USER_ID';
```

**Expected Result:**
```
user_id     | country_code | preferred_currency | ican_coin_balance
────────────┼──────────────┼────────────────────┼──────────────────
abc123xyz   | UG           | UGX                | 5000
```

### Method 3: Open Contribution Modal

1. Open the app
2. Navigate to a group
3. Click "Make Contribution"
4. Verify the modal shows:
   - ✅ Your country name (e.g., "Uganda")
   - ✅ Your currency code (e.g., "UGX")
   - ✅ Your currency symbol (e.g., "USh")
   - ✅ All amounts in your currency
   - ✅ Quick buttons show your currency (e.g., "USh 50", not "$50")

### Method 4: Check Mobile Responsiveness

1. Open contribution modal on mobile device
2. Verify currency displays correctly
3. Check currency symbol appears on all amounts
4. Verify country info card shows properly

---

## **Troubleshooting**

### Issue: Currency showing USD but I'm not in USA

**Problem:** `userCountryCode = 'US'` (default), currency not detected correctly

**Solution:**
1. Check if `country_code` is NULL in `user_accounts` table
2. Update your country:
   ```sql
   UPDATE user_accounts 
   SET country_code = 'UG' 
   WHERE user_id = 'YOUR_USER_ID';
   ```
3. Log out and back in
4. Verify in console: `✅ User Country: UG, Currency: UGX, Symbol: USh`

### Issue: Country shows but currency doesn't update

**Problem:** Country detected but currency state not set

**Solution:**
1. Check browser console for errors
2. Verify `icanCoinService.getUserCountry()` returns country code
3. Check `CountryService` has mapping for your country code
4. Hard refresh page (Ctrl+Shift+R)

### Issue: Modal shows "🔄 Detecting..." forever

**Problem:** Country detection stuck in loading state

**Solution:**
1. Check if you're authenticated (`user?.id` exists)
2. Check database connection (verify `user_accounts` table exists)
3. Check browser console for network errors
4. Check Supabase credentials in environment variables

---

## **Fast Reference: Your User's Currency**

To quickly check what currency you should see:

```
Your Country Code: ________
Your Currency: ________
Your Symbol: ________

To find:
1. Go to Supabase dashboard
2. Navigate to user_accounts table
3. Find your user_id row
4. Look at country_code column
5. That's your country code!
```

**Then use this to find your currency:**

| Code | Country | Currency | Symbol |
|------|---------|----------|---------|
| UG | Uganda | UGX | USh |
| KE | Kenya | KES | KSh |
| US | USA | USD | $ |
| (others in supported list above) | | | |

---

## **Summary**

✅ **System ENSURES:**
- User's country is detected from 3 sources (metadata → database → default)
- One country code = One currency code
- Currency is NOT independent - it's BOUND to country
- All amounts display in user's country currency
- Mobile and desktop both show same currency

✅ **Data Flow:**
```
User Logs In
    ↓
System Reads Country (metadata/database/default)
    ↓
System Maps Country to Currency
    ↓
All UI shows that currency
    ↓
Contribution amounts in that currency only
```

✅ **Result:**
- **Uganda (UG) user** → Always sees UGX/USh
- **Kenya (KE) user** → Always sees KES/KSh  
- **USA (US) user** → Always sees USD/$
- **Any country user** → Sees their country's currency

No option to change currency. It's fixed to the country. One country = One currency. ✅
