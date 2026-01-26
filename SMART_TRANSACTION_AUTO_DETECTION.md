# Smart Transaction Entry - Auto Detection & Recording

## 🎯 How It Works

### **Primary Mode: ⚡ TYPE (Smart Auto-Detection)**
Users tap the record button and start typing naturally:

#### **Smart Parsing Examples:**

| Input | Detection | Amount | Type | Result |
|-------|-----------|--------|------|--------|
| `Lunch 8k` | Expense keyword detected | 8,000 | 💸 Expense | Orange card |
| `Salary 500k` | Income keyword detected | 500,000 | 💰 Income | Green card |
| `Transport 15k` | Expense keyword detected | 15,000 | 💸 Expense | Orange card |
| `Bonus received 100k` | Income keywords detected | 100,000 | 💰 Income | Green card |
| `Shopping 50k` | Expense keyword detected | 50,000 | 💸 Expense | Orange card |
| `Interest payment 5k` | Income keywords detected | 5,000 | 💰 Income | Green card |

### **Smart Detection Features:**

#### **Income Keywords:** 
- salary, earned, received, income, bonus, interest, dividend, payment, refund, returned, paid

#### **Expense Keywords:**
- bought, lunch, dinner, breakfast, transport, taxi, shopping, fuel, bills, paid for, spent, expense

#### **Amount Parsing:**
Supports multiple formats:
- `8k` → 8,000
- `500k` → 500,000
- `1m` → 1,000,000
- `50000` → 50,000
- `1.5m` → 1,500,000

### **Live Feedback:**

As user types, the card shows in real-time:
```
💬 Type expense or income
┌─────────────────────────────┐
│ [Type here...]              │
└─────────────────────────────┘

✨ Real-time detection shows:
┌─────────────────────────────┐
│ 💰 Income                   │
│ Salary                      │
│         + 500,000  ✓        │
└─────────────────────────────┘
```

### **Three Input Modes:**

1. **⚡ Type (DEFAULT)** - Smart natural language entry
   - Auto-detects expense vs income
   - Extracts amount automatically
   - One-tap submission
   
2. **🎯 Quick Templates** - 6 preset buttons
   - Salary 💰, Lunch 🍽️, Transport 🚕
   - Loan 💼, Shopping 🛍️, Utilities 📱
   - Click to instantly record
   
3. **🎤 Voice Recording** - Audio capture
   - Record natural speech
   - Playback preview
   - Manual amount override

### **Auto-Recording to Reports:**

When user taps **Save**, the transaction is recorded with:

```javascript
{
  type: 'smart_entry',
  amount: 500000,
  description: 'Salary',
  entryType: 'income',        // ← Determines report category
  isIncome: true,             // ← Expense/Income flag
  timestamp: '2026-01-26T...',
  rawInput: 'Salary 500k'
}
```

### **Report Integration:**
The `entryType` field automatically sorts entries into:
- **Income Report** - All entries with `entryType: 'income'`
- **Expense Report** - All entries with `entryType: 'expense'`
- **Net Analysis** - Income minus expenses

## 🎨 UI Flow

```
┌─────────────────────────────┐
│  Record Button Tapped       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  📝 Quick Entry Modal       │
│  ┌───────────────────────┐  │
│  │ ⚡ Type | 🎯 Quick | 🎤 Voice │
│  └───────────────────────┘  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 💬 Type expense or income   │
│ ┌─────────────────────────┐ │
│ │ [Lunch 8k           ]   │ │
│ └─────────────────────────┘ │
│                             │
│ ┌─────────────────────────┐ │
│ │ 💸 Expense              │ │
│ │ Lunch                   │ │
│ │        - 8,000  ✓       │ │
│ └─────────────────────────┘ │
│                             │
│ [Cancel]  [✅ Save]         │
└──────────────┬──────────────┘
               │
               ▼
       Recorded to Reports
       (Expense: 8,000)
```

## ✨ Key Features

✅ **Zero-click categorization** - System knows if it's income or expense
✅ **Natural language entry** - "Salary 500k" not "Amount: 500000, Type: income"
✅ **Real-time validation** - Green checkmark appears when valid
✅ **Smart amount extraction** - Handles k, m, commas, decimals
✅ **Auto-report filing** - Goes straight to expense/income reports
✅ **Three fallback modes** - Templates, voice, manual if needed
✅ **Mobile-optimized** - Smooth modal from bottom sheet
✅ **Instant feedback** - Color-coded (green=income, orange=expense)

## 🚀 Example Transactions

```
User Types                 →  Recorded As
─────────────────────────────────────────────
"Lunch 8k"                →  Expense: 8,000
"Salary 500k"             →  Income: 500,000
"Transport 15k"           →  Expense: 15,000
"Bonus received 100k"     →  Income: 100,000
"Shopping 50k"            →  Expense: 50,000
"Utilities 25k"           →  Expense: 25,000
"Interest earned 5k"      →  Income: 5,000
"Bought groceries 30k"    →  Expense: 30,000
```

All entries auto-sorted into Income/Expense reports with amounts, timestamps, and descriptions! 🎉
