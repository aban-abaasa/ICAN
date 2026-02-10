# 📱 Contribution Modal - Country & Currency Display Guide

## What You Should See (Contribution Modal)

### **1. Country Detection Working** ✅

When you open the Contribution Modal, you should see:

```
┌─────────────────────────────────────────────────────────────┐
│                  CONTRIBUTION MODAL                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │       📊 Group   │  │  🔐 Registered Currency          │ │
│  │                  │  │                                  │ │
│  │    hfgd           │  │  🌍 Uganda  (or your country)   │ │
│  │                  │  │                                  │ │
│  │ Monthly Target:  │  │  UGX USh                         │ │
│  │ USh100           │  │                                  │ │
│  │                  │  │ Your account country: UG          │ │
│  └──────────────────┘  └──────────────────────────────────┘ │
│                                                              │
│  🔐 Registered Currency Shows:                              │
│  ├─ Country Name (e.g., "Uganda")                           │
│  ├─ Currency Code (e.g., "UGX")                             │
│  ├─ Currency Symbol (e.g., "USh")                           │
│  └─ Country Code (e.g., "UG")                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### **2. Amount Input - Currency Shows User's Country**

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  Contribution Amount (UGX)                                  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ USh │                                              │   │ │
│  └────────────────────────────────────────────────────────┘ │
│                    ↑                                         │
│              Currency symbol from                            │
│              user's country (UG)                             │
│                                                              │
│  Quick Amounts (all in your currency):                       │
│  ┌──────┐ ┌──────┐ ┌──┐ ┌──┐                               │
│  │USh50 │ │USh100│ │..│ │..│                               │
│  └──────┘ └──────┘ └──┘ └──┘                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### **3. Financial Summary - All in User's Currency**

```
┌─────────────────────────────────────────────────────────────┐
│                   YOUR CONTRIBUTION DETAILS                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  💰 Your Contribution                    USh 100.00          │
│                                                              │
│  📈 Annual Interest (10%)                USh 10.00          │
│                                                              │
│  📊 Daily Growth                          USh 0.03/day      │
│                                                              │
│  All amounts shown in: UGX (USh)                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## **Examples: Different Countries**

### **User from Uganda (UG)**
```
Country Card shows:
  🌍 Uganda
  UGX USh
  Your account country: UG

Amount Input shows:
  Contribution Amount (UGX)
  Prefix: USh
  
Quick Buttons:
  [USh50] [USh100] [USh250] [USh500]

Summary shows:
  💰 USh 100.00
  📈 USh 10.00
  📊 USh 0.03/day
```

### **User from Kenya (KE)**
```
Country Card shows:
  🌍 Kenya
  KES KSh
  Your account country: KE

Amount Input shows:
  Contribution Amount (KES)
  Prefix: KSh
  
Quick Buttons:
  [KSh50] [KSh100] [KSh250] [KSh500]

Summary shows:
  💰 KSh 100.00
  📈 KSh 10.00
  📊 KSh 0.03/day
```

### **User from USA (US)**
```
Country Card shows:
  🌍 United States
  USD $
  Your account country: US

Amount Input shows:
  Contribution Amount (USD)
  Prefix: $
  
Quick Buttons:
  [$50] [$100] [$250] [$500]

Summary shows:
  💰 $100.00
  📈 $10.00
  📊 $0.03/day
```

---

## **Verification Checklist**

When you open the Contribution Modal, verify these are showing:

### **Country Card Section:**
- [ ] Country name displays (e.g., "Uganda", not "🔄 Detecting...")
- [ ] Currency code is shown (e.g., "UGX", "KES", "USD")
- [ ] Currency symbol is shown (e.g., "USh", "KSh", "$")
- [ ] Country code is shown (e.g., "UG", "KE", "US")

### **Amount Input Section:**
- [ ] Label shows your currency (e.g., "Contribution Amount (UGX)")
- [ ] Currency symbol appears in input prefix (e.g., "USh")
- [ ] Quick buttons show amounts in your currency (e.g., "USh50", not "$50")

### **Financial Summary:**
- [ ] All amounts show your currency symbol
- [ ] Your Contribution: Shows symbol + amount (e.g., "USh 100.00")
- [ ] Annual Interest: Shows symbol + amount (e.g., "USh 10.00")
- [ ] Daily Growth: Shows symbol + amount (e.g., "USh 0.03/day")

---

## **What Should NOT Happen**

### ❌ **Problem #1: Currency not detected (showing loading)**
```
Wrong:
  🌍 🔄 Detecting...
  
Correct:
  🌍 Uganda
  UGX USh
```
**Solution:** Log out and back in, or check database for country_code

### ❌ **Problem #2: Wrong currency showing**
```
Wrong:
  You're from Uganda but seeing: $ (USD)
  Button showing: [$50]
  
Correct:
  🌍 Uganda
  UGX USh
  Button showing: [USh50]
```
**Solution:** Update `user_accounts` table to set country_code = 'UG'

### ❌ **Problem #3: Amounts showing multiple currencies**
```
Wrong:
  💰 Your Contribution: $ 100.00
  📈 Annual Interest: 😕 10.00 (no symbol)
  
Correct:
  💰 Your Contribution: USh 100.00
  📈 Annual Interest: USh 10.00
```
**Solution:** Clear browser cache, hard refresh (Ctrl+Shift+R)

---

## **How the System Works (Behind the Scenes)**

### **Step 1: Detect Country**
```javascript
// Try 3 methods in order:
1. Check user.user_metadata.country (fastest - in memory)
   └─ Returns: "UG"
   
2. If not found, query database via icanCoinService.getUserCountry(userId)
   └─ Queries: SELECT country_code FROM user_accounts WHERE user_id = ?
   └─ Returns: "UG"
   
3. If still not found, use default: "US"
   └─ Returns: "US"
```

### **Step 2: Map Country to Currency**
```javascript
userCountryCode = "UG"  // From step 1

// Get currency info from CountryService
userCurrency = CountryService.getCurrencyCode("UG")      // Returns: "UGX"
currencySymbol = CountryService.getCurrencySymbol("UG")  // Returns: "USh"

// Result:
// userCountryCode = "UG"
// userCurrency = "UGX"
// currencySymbol = "USh"
```

### **Step 3: Display in UI**
```javascript
// All amounts now show user's currency:
<label>Contribution Amount ({userCurrency})</label>     // "Contribution Amount (UGX)"
<span>{currencySymbol}</span>                           // Shows: "USh"
<button>{currencySymbol}{amount}</button>              // Shows: "USh100"

// Summary also uses userCurrency:
<span>{currencySymbol}{(amount).toFixed(2)}</span>     // "USh 100.00"
```

---

## **Currency is LOCKED to Country**

### **Key Point: One Country = One Currency (No Choice)**

This is by design:
- ✅ User in Uganda (UG) → **ALWAYS** sees UGX (USh)
- ✅ User in Kenya (KE) → **ALWAYS** sees KES (KSh)
- ✅ User in USA (US) → **ALWAYS** sees USD ($)

**You cannot pick a different currency than your country.**

Why? Because:
1. Simpler for users (no currency selection confusion)
2. Ensures legal/regulatory compliance per country
3. Matches SACCO contribution rules (contributions in local currency)
4. Matches your ICAN wallet currency (which is also tied to your country)

---

## **Browser Console Messages**

When the Contribution Modal loads, check browser console (F12 > Console):

### **Success Message:**
```
✅ Contribution Modal - Country: UG, Currency: UGX, Symbol: USh
```
✅ This means everything is working correctly!

### **Error Message:**
```
Could not detect country, using default USD
```
⚠️ This means:
- Country not in metadata
- Database query failed
- Using fallback: US

**Solution:** Make sure your country_code is set in user_accounts table

---

## **Quick Test**

To verify your country/currency is correct:

1. **Open Contribution Modal**
   - Click any group
   - Click "Make Contribution" button

2. **Look at Country Card**
   - Should show your country name (not "🔄...")
   - Should show your currency code (not blank)
   - Should show your currency symbol (not blank)

3. **Look at Amount Input**
   - Label should say your currency (e.g., "(UGX)")
   - Prefix should show symbol (e.g., "USh")

4. **Look at Quick Buttons**
   - All amounts should show YOUR symbol (e.g., "USh50", not "$50")

5. **Check Console (F12 > Console)**
   - Should see: ✅ Contribution Modal - Country: UG, Currency: UGX, Symbol: USh

If all 5 checks pass: ✅ Your system is working correctly!

If any check fails: ⚠️ You need to update your country_code in database

---

## **Troubleshooting Summary**

| Problem | Fix |
|---------|-----|
| Shows "🔄 Detecting..." | Wait 2-3 seconds, or refresh page |
| Shows wrong country | Update user_accounts table: `UPDATE user_accounts SET country_code = 'UG' WHERE user_id = 'YOUR_ID'` |
| Shows USD but not from USA | Check country_code in database (might be NULL) |
| Amounts show no symbol | Clear browser cache and hard refresh (Ctrl+Shift+R) |
| Console shows error | Check if user_accounts table exists and has country_code column |

---

## **Technical Reference**

**File:** `frontend/src/components/ContributionModal.jsx`

**Key Lines:**
- Line 41-70: Country detection (3-tier fallback)
- Line 55-65: Currency mapping from country code
- Line 160-180: Country info card UI
- Line 260-280: Amount input with currency symbol
- Line 290-310: Quick amount buttons showing currency
- Line 320-340: Financial summary using currencySymbol

**Services Used:**
- `icanCoinService.getUserCountry(userId)` - Gets country from database
- `CountryService.getCountry(code)` - Gets country name/info
- `CountryService.getCurrencyCode(code)` - Gets currency code (UGX, KES, etc.)
- `CountryService.getCurrencySymbol(code)` - Gets symbol (USh, KSh, etc.)

**State Variables:**
- `userCountryCode` - ISO code (UG, KE, US, etc.)
- `userCountry` - Full name (Uganda, Kenya, United States, etc.)
- `userCurrency` - Currency code (UGX, KES, USD, etc.)
- `currencySymbol` - Display symbol (USh, KSh, $, etc.)
