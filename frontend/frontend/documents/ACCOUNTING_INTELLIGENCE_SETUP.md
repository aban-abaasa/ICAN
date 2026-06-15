# 🧮 PROFESSIONAL ACCOUNTING INTELLIGENCE SYSTEM
## OpenAI-Powered Transaction Classification

### 📋 Overview
This system uses **OpenAI GPT-4 API** to intelligently classify transactions like a professional accountant would. It understands:

- **Business Investments** (Assets) vs **Personal Expenses**
- **Capital Assets** (fixed assets like vehicles, property, equipment)
- **Depreciation** calculations for long-term assets
- **Journal Entries** for proper accounting records
- **Tax Implications** based on transaction type
- **Financial Statement Impact** on balance sheet and income statement

---

## 🚀 SETUP INSTRUCTIONS

### Step 1: Get OpenAI API Key

1. Go to **https://platform.openai.com/api-keys**
2. Sign in with your OpenAI account (create one if needed)
3. Click **"Create new secret key"**
4. Copy the API key (you'll only see it once!)

### Step 2: Add API Key to Environment

**Option A: Using .env file (Recommended)**
```bash
# Create file: .env.local in project root
REACT_APP_OPENAI_API_KEY=sk_test_your_actual_key_here
```

**Option B: Using .env.accounting**
```bash
# File: .env.accounting (already created)
REACT_APP_OPENAI_API_KEY=sk_test_your_actual_key_here
REACT_APP_ACCOUNTING_CURRENCY=UGX
REACT_APP_BUSINESS_TAX_JURISDICTION=UGANDA
```

**Option C: Environment Variables (Production)**
```bash
export REACT_APP_OPENAI_API_KEY="sk_test_..."
```

### Step 3: Verify Installation
```bash
# Check that the service file exists
ls -la frontend/src/services/accountingIntelligenceService.js

# Check that ICAN_Capital_Engine imports it
grep "accountingIntelligenceService" frontend/src/components/ICAN_Capital_Engine.jsx
```

---

## 💡 HOW IT WORKS

### Example 1: Business Vehicle Purchase
```
User Input: "bought van 4m"
Amount: 4,000,000 UGX

OpenAI Analysis:
✅ Classification: ASSET (not expense!)
✅ Type: Fixed Asset - Vehicle
✅ Business/Personal: BUSINESS
✅ Depreciation: 5 years, straight-line method
✅ Monthly Depreciation: 66,667 UGX
✅ Journal Entry:
   - Debit: Fixed Assets - Vehicles: 4,000,000
   - Credit: Cash/Bank: 4,000,000

Tax Impact: Depreciation expense reduces taxable income
Display: "📦 Capital Investment - UGX 4,000,000" (not a negative expense)
```

### Example 2: Personal Food Expense
```
User Input: "bought lunch at restaurant 150k"
Amount: 150,000 UGX

OpenAI Analysis:
✅ Classification: EXPENSE
✅ Type: Operational Expense - Meals
✅ Business/Personal: PERSONAL
✅ No Depreciation
✅ Journal Entry:
   - Debit: Meals & Entertainment: 150,000
   - Credit: Cash/Bank: 150,000

Tax Impact: Limited deductibility (50% in most jurisdictions)
Display: "💸 Expense - UGX 150,000" (shown as negative on income statement)
```

### Example 3: Business Equipment
```
User Input: "invested in restaurant kitchen equipment for business 8m"
Amount: 8,000,000 UGX

OpenAI Analysis:
✅ Classification: ASSET
✅ Type: Fixed Asset - Equipment
✅ Business/Personal: BUSINESS
✅ Depreciation: 3 years (equipment typically depreciates faster)
✅ Monthly Depreciation: 222,222 UGX
✅ Journal Entry shows equipment capitalization

Tax Impact: Equipment depreciation is fully deductible
Display: "🏭 Capital Investment - UGX 8,000,000"
```

---

## 🔧 API RESPONSE FORMAT

OpenAI returns a JSON structure:

```json
{
  "classification": "ASSET|EXPENSE|INCOME|LIABILITY|MIXED",
  "accountingType": "operational_expense|capital_investment|fixed_asset|depreciation|inventory",
  "businessVsPersonal": "BUSINESS|PERSONAL|MIXED",
  "assetCategory": "vehicle|property|equipment|inventory|intangible",
  "depreciableAsset": true,
  "estimatedUsefulLife": 5,
  "depreciationMethod": "straight_line|declining_balance",
  "accountingTreatment": "Record as Fixed Asset (Vehicles/Transport)...",
  "journal_entries": [
    { "account": "Fixed Assets - Vehicles", "debit": 4000000, "credit": null },
    { "account": "Cash/Bank", "debit": null, "credit": 4000000 }
  ],
  "tax_implications": "Depreciation is tax-deductible",
  "confidence": 0.95,
  "reasoning": "Business vehicle purchase is a capital investment"
}
```

---

## 📊 FINANCIAL STATEMENT IMPACT

### When Transaction = Asset (Vehicle/Equipment/Property)
- **Balance Sheet**: 
  - Assets ↑ (Fixed Assets increase)
  - Equity → (no immediate change)
- **Income Statement**: 
  - No immediate impact
  - Monthly depreciation expense

### When Transaction = Expense (Personal/Operational)
- **Balance Sheet**:
  - Assets ↓ (Cash decreases)
  - Equity ↓ (Retained earnings decrease)
- **Income Statement**:
  - Expense ↑ (reduces net income)

---

## 🎯 TRANSACTION CLASSIFICATION RULES

### 🚗 VEHICLES (Auto-detected)
- **Business van/truck**: Fixed Asset (5-year depreciation)
- **Personal car**: Depreciable asset (6-year depreciation)
- Keywords: van, car, vehicle, truck, motorbike, bus, transport

### 🏠 REAL ESTATE
- **Land/Property purchase**: Fixed Asset (50-year depreciation on buildings)
- **Rental property**: Investment asset
- Keywords: land, property, house, building, plot, apartment

### 🏭 EQUIPMENT & MACHINERY
- **Business equipment**: Fixed Asset (3-year depreciation)
- **Software/IT systems**: Intangible asset or expense (depends on cost)
- Keywords: equipment, machinery, tools, computer, system, software

### 💰 EXPENSES
- **Meals**: Operational expense (50% deductible)
- **Clothing**: Personal expense (not deductible)
- **Utilities**: Business operational expense
- Keywords: food, meal, lunch, spent, paid, cost

### 📈 INCOME
- **Salary/Wages**: Revenue income
- **Business profit**: Revenue
- **Asset sale**: Capital gain (may be taxable)
- Keywords: earned, received, income, salary, profit

---

## 💾 STORING ACCOUNTING DATA

Transactions are enriched with accounting information:

```javascript
transaction = {
  // Original data
  id: 1,
  amount: 4000000,
  description: "bought van 4m",
  date: "2026-02-01",
  
  // NEW: Accounting classification
  accounting: {
    classification: "ASSET",
    accountingType: "fixed_asset",
    businessVsPersonal: "BUSINESS",
    assetCategory: "vehicle",
    depreciation: {
      isDepreciable: true,
      usefulLife: 5,
      method: "straight_line",
      monthlyDepreciation: 66667
    },
    journalEntries: [...],
    taxTreatment: "Depreciation is tax-deductible...",
    confidence: 0.95
  },
  
  // NEW: Display formatting
  displayAmount: "+UGX 4,000,000",
  displaySign: "+",
  displayType: "Capital Investment",
  displayColor: "blue",
  icon: "🚗"
}
```

---

## 🔐 SECURITY CONSIDERATIONS

### ✅ Safe Practices
- API key stored in environment variables only
- Never commit `.env` files to Git
- API calls happen server-side (Node) when possible
- Supabase auth prevents unauthorized access

### ⚠️ API Rate Limits
- OpenAI API: ~3,500 requests/min for most accounts
- Consider caching analysis results
- Implement request batching for bulk transactions

### 💡 Cost Optimization
- Use `gpt-4o-mini` (cheaper than gpt-4)
- Estimated cost: $0.0002 per transaction
- Cache results for identical descriptions
- Batch analyze similar transactions

---

## 🐛 TROUBLESHOOTING

### Issue: "OpenAI API key not configured"
**Solution**: 
```bash
# Check environment variable
echo $REACT_APP_OPENAI_API_KEY

# Add to .env.local
REACT_APP_OPENAI_API_KEY=sk_test_...
```

### Issue: "Could not parse accounting analysis response"
**Solution**: OpenAI returned invalid JSON
```bash
# Check API status at: https://status.openai.com/
# Verify account has API access
# Try with fallback analysis (works offline)
```

### Issue: "Transaction analysed but amount still negative"
**Solution**: Check that transaction is set as ASSET, not EXPENSE
```javascript
if (transaction.accounting.classification === 'ASSET') {
  // Should display as: +UGX 4,000,000
} else if (transaction.accounting.classification === 'EXPENSE') {
  // Should display as: -UGX 150,000
}
```

---

## 📈 REPORTING & ANALYTICS

### Generate Accounting Reports
```javascript
// Get all fixed assets
const fixedAssets = transactions.filter(t => 
  t.accounting?.assetCategory
).reduce((sum, t) => sum + t.amount, 0);

// Calculate total depreciation
const totalDepreciation = transactions
  .filter(t => t.accounting?.depreciation?.isDepreciable)
  .reduce((sum, t) => sum + t.accounting.depreciation.monthlyDepreciation, 0) * 12;

// Business vs Personal breakdown
const byType = transactions.groupBy(t => t.accounting?.businessVsPersonal);
```

---

## 🎓 ACCOUNTING PRINCIPLES REFERENCE

### Double-Entry Accounting
Every transaction affects two accounts:
- **Debit** = increase in assets/expenses or decrease in liabilities/income
- **Credit** = increase in liabilities/income or decrease in assets/expenses

### Asset Depreciation
- **Straight-Line**: Equal amount each period
  - Formula: (Cost - Salvage Value) / Useful Life
  - Example: 4M van over 5 years = 800K/year depreciation
  
- **Declining Balance**: Faster depreciation early on
  - Applied to vehicles with higher mileage early in life

### Financial Statement Impact
- **Balance Sheet**: Shows asset values, book depreciation
- **Income Statement**: Shows depreciation expense monthly
- **Cash Flow**: Shows actual payment when asset purchased

---

## 📞 SUPPORT & RESOURCES

- **OpenAI API Docs**: https://platform.openai.com/docs/api-reference
- **Accounting Standards**: IFRS, GAAP principles
- **Uganda Tax Authority**: https://www.ura.go.ug/
- **Project Issues**: Report in Git repository

---

## ✅ IMPLEMENTATION CHECKLIST

- [ ] OpenAI API key obtained and added to .env
- [ ] `accountingIntelligenceService.js` created
- [ ] ICAN_Capital_Engine.jsx imports accounting service
- [ ] `handleAddTransaction` uses accounting analysis
- [ ] Test with sample transactions:
  - [ ] "bought van 4m" → Classified as ASSET
  - [ ] "bought lunch 150k" → Classified as EXPENSE
  - [ ] "earned 5m income" → Classified as INCOME
- [ ] Display formatting shows correct sign/icon
- [ ] Depreciation calculations working
- [ ] Tax implications displayed
- [ ] Journal entries generated

---

**Last Updated**: February 2026
**Version**: 1.0 - Professional Accounting Intelligence System
