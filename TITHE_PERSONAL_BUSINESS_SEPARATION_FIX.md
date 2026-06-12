# ⛪ Tithe Personal vs Business Income Separation - FIXED (June 8, 2026)

## Problem Identified
The tithe manager was treating all income (personal + business) as personal income, causing both personal and business income to be included in the personal tithe calculation. This was incorrect.

## Solution Implemented
Updated the tithe calculation to properly separate:
- **Personal Income** (Salary/Wages) → Personal Tithe only
- **Business Income** (Sales/Revenue) → Business Tithe only

## Changes Made

### 1. VelocityEngine.js (`frontend/src/utils/velocityEngine.js`)
Added three new metrics to the `calculateMetrics()` return object:

```javascript
// Separated personal and business income for tithe calculation
personalIncome30Days      // Salary/wages from employment
businessIncome30Days      // Business sales/revenue
businessExpenses30Days    // Business operating expenses
```

**How it filters:**
- **Personal Income** = Transactions where:
  - `metadata.category === 'salary'` OR
  - `metadata.record_category === 'personal'` OR
  - `metadata.entry_mode === 'salary'`

- **Business Income** = Transactions where:
  - `metadata.record_category === 'business'` OR
  - `metadata.reporting_bucket === 'sold_income'` OR
  - `metadata.category === 'business'`

- **Business Expenses** = Transactions where:
  - `metadata.record_category === 'business'` OR
  - `metadata.reporting_bucket === 'bought_stock'` OR
  - `metadata.category === 'business'`

### 2. MobileView.jsx (`frontend/src/components/MobileView.jsx`)
Updated `calculateTithingMetrics()` function to use the separated income:

**BEFORE (BROKEN):**
```javascript
const personalIncome = realIncome;  // ❌ Included ALL income
const businessProfit = Math.max(0, realNetProfit);
const personalTithe = (personalIncome * personalTithingRate) / 100;
const businessTithe = (businessProfit * businessTithingRate) / 100;
```

**AFTER (FIXED):**
```javascript
const personalIncome = velocityMetrics?.personalIncome30Days || 0;  // ✅ Salary only
const businessIncome = velocityMetrics?.businessIncome30Days || 0;
const businessExpenses = velocityMetrics?.businessExpenses30Days || 0;

const businessProfit = Math.max(0, businessIncome - businessExpenses);
const personalTithe = (personalIncome * personalTithingRate) / 100;      // On salary
const businessTithe = (businessProfit * businessTithingRate) / 100;      // On profit
```

## How It Works Now

### Example Scenario
**User's 30-day transactions:**
- Salary: 1,000,000 UGX (recorded with `category='salary'`)
- Business Sales: 2,000,000 UGX (recorded with `record_category='business'`)
- Business Expenses: 800,000 UGX (recorded with `record_category='business'`)

**Tithe Calculation (10% rate for both):**
- Personal Tithe = 1,000,000 × 10% = **100,000 UGX** (on salary only)
- Business Profit = 2,000,000 - 800,000 = 1,200,000 UGX
- Business Tithe = 1,200,000 × 10% = **120,000 UGX** (on net profit only)
- Combined Tithe = **220,000 UGX**

## Ensuring Proper Transaction Categorization

### For Frontend Transaction Recording
When adding income transactions, ensure metadata includes proper categorization:

```javascript
// Salary income
{
  amount: 1000000,
  type: 'income',
  category: 'salary',  // 🔧 KEY: Mark as salary
  metadata: {
    category: 'salary',
    record_category: 'personal',
    entry_mode: 'salary'
  }
}

// Business sales
{
  amount: 2000000,
  type: 'income',
  category: 'sales',
  metadata: {
    category: 'business',
    record_category: 'business',
    reporting_bucket: 'sold_income'
  }
}

// Business expenses
{
  amount: 800000,
  type: 'expense',
  category: 'business',
  metadata: {
    category: 'business',
    record_category: 'business',
    reporting_bucket: 'bought_stock'
  }
}
```

### For Manual Transaction Entry
When users manually record transactions in the app:
- **Salary/Wages** → Mark category as "Salary" or "Employment"
- **Business Income** → Mark category as "Business" or "Sales"
- **Business Expenses** → Mark category as "Business" or "COGS"

## Files Modified
1. `frontend/src/utils/velocityEngine.js` - Added income separation logic
2. `frontend/src/components/MobileView.jsx` - Updated tithe calculation

## Testing the Fix

### Test Case 1: Personal Income Only
1. Record 500,000 UGX salary income
2. Go to Tithe tab
3. Verify: Personal Tithe shows calculation, Business Tithe shows 0

### Test Case 2: Business Income Only
1. Record 1,000,000 UGX business sales
2. Record 400,000 UGX business expenses
3. Go to Tithe tab
4. Verify: Personal Tithe shows 0, Business Tithe shows (1M - 400K) × 10% = 60K

### Test Case 3: Combined (Both Personal + Business)
1. Record 500,000 UGX salary
2. Record 1,000,000 UGX business sales
3. Record 400,000 UGX business expenses
4. Go to Tithe tab
5. Verify:
   - Personal Tithe = 500K × 10% = 50K (from salary)
   - Business Tithe = (1M - 400K) × 10% = 60K (from profit)
   - Combined = 110K

## Benefits
✅ Salary income no longer inflates business tithe  
✅ Business profit is correctly calculated after expenses  
✅ Personal tithe only based on employment income  
✅ Business tithe only based on business profit  
✅ Accurate tax filing and financial reporting  

## Backward Compatibility
- Old transactions without proper categorization will default to 0 in their respective categories
- To migrate old transactions, add metadata categorization using database migration or UI update flow
- New transactions will be properly categorized if the income input form is updated

## Next Steps
1. ✅ Deploy VelocityEngine changes
2. ✅ Deploy MobileView changes
3. 📋 Update transaction input forms to ensure proper categorization
4. 📋 Optional: Run data migration to properly categorize existing transactions
5. 🧪 Test with actual user data
