# Smart Transaction Entry - Enhanced with Source/Destination Tracking

## 🎯 New Feature: Automatic Source/Destination Detection

Users can now specify WHERE money is coming from or going TO, and the system automatically extracts and records it!

### **Smart Parsing Examples:**

| Input | Type | Amount | Action | Source | Report View |
|-------|------|--------|--------|--------|-------------|
| `Lunch at restaurant 8k` | Expense | 8,000 | at | restaurant | 🍽️ Lunch @ restaurant |
| `Salary from employer 500k` | Income | 500,000 | from | employer | 💰 Salary (from employer) |
| `Bought from supplier 50k` | Expense | 50,000 | bought | supplier | 🛍️ Expense (bought from supplier) |
| `Sold to customer 100k` | Income | 100,000 | sold | customer | 💵 Income (sold to customer) |
| `Transport at uber 15k` | Expense | 15,000 | at | uber | 🚕 Transport @ uber |
| `Shopping from mall 75k` | Expense | 75,000 | from | mall | 🛍️ Expense (from mall) |

---

## 📋 Transaction Fields Recorded

Each smart entry now captures:

```javascript
{
  type: 'smart_entry',
  amount: 8000,
  description: 'Lunch',
  entryType: 'expense',        // income or expense
  isIncome: false,
  source: 'restaurant',        // ← NEW: Where it's from/going to
  action: 'at',                // ← NEW: bought, sold, from, at
  timestamp: '2026-01-26T...',
  rawInput: 'Lunch at restaurant 8k'
}
```

---

## 🎨 UI Display

### **Input Stage:**
```
💬 Type expense or income
┌──────────────────────────────┐
│ Lunch at restaurant 8k       │
└──────────────────────────────┘
```

### **Auto-Detection Card:**
```
┌──────────────────────────────┐
│ 💸 Expense                   │
│ Lunch                        │
│        - 8,000  ✓            │
│                              │
│ 📍 At: restaurant            │
└──────────────────────────────┘
```

### **Report Integration:**
```
EXPENSES:
┌──────────────────────────────┐
│ 💸 Lunch @ restaurant        │
│    - 8,000                   │
│    Jan 26, 2026              │
└──────────────────────────────┘

┌──────────────────────────────┐
│ 🚕 Transport @ Uber          │
│    - 15,000                  │
│    Jan 26, 2026              │
└──────────────────────────────┘
```

---

## 🔍 Detection Keywords & Actions

### **Actions Detected:**

| Action | Triggers | Field |
|--------|----------|-------|
| **bought** | "bought", "purchased" | Where item was bought from |
| **sold** | "sold", "selling" | Who it was sold to |
| **from** | "from", "received from" | Origin/source of income |
| **at** | "at", "went to" | Location of expense |

### **Smart Extraction:**

| Pattern | Extraction |
|---------|-----------|
| `"Lunch at restaurant 8k"` | source = "restaurant", action = "at" |
| `"Bought from Amazon 50k"` | source = "Amazon", action = "bought" |
| `"Sold to client 100k"` | source = "client", action = "sold" |
| `"Salary from Google 500k"` | source = "Google", action = "from" |
| `"Shopping at mall 75k"` | source = "mall", action = "at" |

---

## 💾 Report Categories with Source

### **Income Report:**
```
💰 INCOME ENTRIES
├─ Salary from Google: +500,000
├─ Bonus from manager: +100,000
├─ Sold to customer: +150,000
└─ Interest payment: +5,000
   TOTAL: +755,000
```

### **Expense Report:**
```
💸 EXPENSE ENTRIES
├─ Lunch @ restaurant: -8,000
├─ Transport @ Uber: -15,000
├─ Bought from supplier: -50,000
├─ Shopping @ mall: -75,000
└─ Utilities payment: -25,000
   TOTAL: -173,000
```

### **Net Summary:**
```
📊 FINANCIAL SUMMARY
Income:    +755,000 💰
Expenses:  -173,000 💸
────────────────────
Net:       +582,000 ✅
```

---

## 🎤 Voice + Smart Features

Users can still:
- **Quick Templates** - Pre-set amounts (no source needed)
- **Voice Recording** - Capture audio entries
- **Manual Entry** - Type without auto-detection

But now with **Smart Type Mode (⚡)**, they get:
- ✅ Auto expense/income detection
- ✅ Automatic amount extraction (8k, 500k, 1m)
- ✅ **Source/destination auto-capture**
- ✅ Real-time validation
- ✅ One-tap save to reports

---

## 📱 Mobile Flow

```
┌────────────────┐
│ Tap Record     │
│ Button (🎤)    │
└────────┬───────┘
         │
         ▼
┌────────────────┐
│ Modal Opens    │
│ ⚡ Type (DEFAULT)
│ 🎯 Quick       │
│ 🎤 Voice       │
└────────┬───────┘
         │
         ▼
┌────────────────────────────┐
│ Type: "Lunch at restaurant 8k"  │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ 💸 Expense - Lunch          │
│ 📍 At: restaurant           │
│ - 8,000                     │
│ [Cancel] [✅ Save]          │
└────────┬───────────────────┘
         │
         ▼
Saved to EXPENSE REPORT ✅
(+ auto-linked to "restaurant")
```

---

## 🌟 Key Benefits

✅ **Complete Transaction Trail** - Know EXACTLY where money went
✅ **Better Analytics** - Filter expenses by vendor/source
✅ **Categorization** - Group by "restaurant", "supplier", "employer", etc.
✅ **Audit Trail** - Perfect for business/personal accounting
✅ **Smart Reports** - See total spent at each location/vendor
✅ **Natural Language** - No complex forms, just type naturally

---

## 📊 Example Transactions in Report

```
JANUARY 2026 EXPENSE REPORT

Food & Dining:
  - Lunch @ restaurant (8k)
  - Breakfast @ cafe (5k)
  - Dinner @ hotel (25k)
  SUBTOTAL: 38k

Transportation:
  - Uber @ city center (15k)
  - Taxi @ airport (10k)
  - Fuel @ shell (20k)
  SUBTOTAL: 45k

Shopping:
  - Bought from Amazon (50k)
  - Shopping @ mall (75k)
  - Purchased from supplier (100k)
  SUBTOTAL: 225k

TOTAL EXPENSES: 308k
```

---

## 🚀 Next Integration Points

The transaction data can now be:
1. **Filtered by source** - "Show all expenses at restaurants"
2. **Grouped by vendor** - "Total spent at Uber: 45k"
3. **Categorized automatically** - Restaurant, Store, Supplier, etc.
4. **Exported with details** - CSV includes source/destination
5. **Used for budgeting** - Track spending per vendor
6. **Analyzed for patterns** - Most frequent expense sources
