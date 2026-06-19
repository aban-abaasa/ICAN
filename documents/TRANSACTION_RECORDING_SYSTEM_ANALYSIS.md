# 📊 ICAN Transaction Recording System - Current Implementation

## 🎯 How Transaction Recording Works Today

### 1️⃣ **ENTRY POINTS** (Where Transactions Start)

#### **Financial Transactions** (Generic Income/Expenses)
```javascript
// Frontend: src/services/databaseService.js
createTransaction({
  transactionType,      // 'income', 'expense', 'loan', 'transfer', 'tithe', 'investment', 'loan_payment'
  amount,
  category,
  subCategory,
  description,
  transactionDate,      // Date of transaction
  source,               // 'manual', 'voice', 'import', 'recurring', 'ai_detected'
  currency,
  isRecurring,
  recurrencePattern,
  isSensitive,
  aiCategorized,        // AI-powered classification
  aiConfidence,
  metadata
})
```

#### **Wallet Transactions** (Send/Receive/TopUp)
```javascript
// Frontend: src/services/walletTransactionService.js
walletService.saveSend({
  amount,
  currency,
  recipientPhone,
  paymentMethod,        // 'MOMO', 'CARD', 'USSD', 'BANK_TRANSFER'
  transactionId,
  description
})

walletService.saveReceive({
  amount,
  currency,
  description
})

walletService.saveTopUp({
  amount,
  currency,
  paymentMethod,
  phoneNumber,
  transactionId
})
```

#### **Card Transactions**
```javascript
// Frontend: src/services/cardTransactionService.js
cardService.saveCardPayment({
  amount,
  cardNumber,
  cardType,             // 'visa', 'mastercard', etc
  merchantName,
  description
})
```

---

### 2️⃣ **DATABASE STORAGE** (Where Data Lives)

#### **Primary Tables**

**`ican_financial_transactions`** - Main transaction ledger
```sql
id UUID PRIMARY KEY
user_id UUID (References auth.users)
transaction_type TEXT CHECK (income|expense|loan|transfer|tithe|investment|loan_payment)
amount DECIMAL(18, 4)
currency TEXT DEFAULT 'UGX'
category TEXT                    -- Required
sub_category TEXT               -- Optional
description TEXT                -- User-friendly description
source TEXT                      -- 'manual', 'voice', 'import', 'recurring', 'ai_detected'
source_reference TEXT            -- External reference ID
transaction_date DATE
transaction_time TIME
status TEXT                      -- pending, completed, cancelled, failed, recurring
is_recurring BOOLEAN
recurrence_pattern TEXT          -- daily, weekly, biweekly, monthly, quarterly, yearly
is_sensitive BOOLEAN             -- For sensitive financial data
original_input TEXT              -- Raw user input (for voice/AI)
ai_categorized BOOLEAN           -- Was AI used to categorize?
ai_confidence DECIMAL(5,2)       -- AI confidence score
data_hash TEXT                   -- SHA-256 hash for blockchain verification
tags TEXT[]                      -- Tags for filtering
metadata JSONB                   -- Extended data storage
amount_encrypted TEXT            -- Optional encryption
description_encrypted TEXT       -- Optional encryption
created_at TIMESTAMP
updated_at TIMESTAMP
```

**`wallet_transactions`** - Wallet-specific transactions
```sql
id UUID PRIMARY KEY
user_id UUID
transaction_type TEXT            -- top_up, send, receive
amount DECIMAL
currency TEXT
payment_method TEXT              -- MOMO, CARD, USSD, etc
transaction_id TEXT              -- External transaction ID
description TEXT
status TEXT
metadata JSONB
created_at TIMESTAMP
```

**`ican_card_transactions`** - Card payment records
```sql
id UUID PRIMARY KEY
user_id UUID
card_id UUID
amount DECIMAL
merchant_name TEXT
merchant_category TEXT
status TEXT
metadata JSONB
created_at TIMESTAMP
```

---

### 3️⃣ **TRANSACTION FLOW** (Complete Journey)

```
USER ACTION
    ↓
Frontend Component (e.g., WalletFunctions.jsx, MobileView.jsx)
    ↓
Service Layer (walletTransactionService.js, databaseService.js, cardTransactionService.js)
    ↓
Data Validation & Enrichment
    ├─ Validate amounts
    ├─ Verify currency
    ├─ Auto-categorize (if AI enabled)
    ├─ Generate data hash
    └─ Add metadata
    ↓
Supabase RPC Function or Direct Insert
    ├─ For sensitive: use RPC with SECURITY DEFINER
    ├─ For standard: direct insert with RLS
    └─ Generate ID & timestamps
    ↓
Database Storage
    ├─ ican_financial_transactions
    ├─ wallet_transactions
    └─ ican_card_transactions
    ↓
Return Response
    ├─ success: true/false
    ├─ transactionId
    ├─ data
    └─ error message
    ↓
Frontend UI Update (Show confirmation)
```

---

### 4️⃣ **DATA ENRICHMENT LAYERS**

#### **Automatic Categorization (AI)**
```javascript
// Python backend: backend/ican_nlp_processor.py
Parses natural language input → Structured transaction:
{
  amount_ugx: 4000,
  type: "EXPENSE",
  category: "Groceries",
  description: "Bought vegetables at market"
}
```

#### **Accounting Intelligence**
```javascript
// Enhanced transaction with accounting metadata
transaction = {
  // Original fields
  id: 1,
  amount: 4000000,
  
  // NEW: Accounting classification
  accounting: {
    classification: "ASSET",           // ASSET, LIABILITY, EQUITY, INCOME, EXPENSE
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
    taxTreatment: "...",
    confidence: 0.95
  }
}
```

#### **Metadata Storage**
```javascript
// ican_financial_transactions.metadata JSONB field stores:
{
  phoneNumber: "256701234567",
  paymentMethod: "MOMO",
  momoTransactionId: "TXN123456",
  activeKey: "PRIMARY",
  mode: "LIVE",
  timestamp: "2026-05-08T10:30:00Z",
  reporting_bucket: "SALES",           // For financial reports
  product_name: "Phone Case",
  product_action: "SOLD",
  ledger_side: "CREDIT",
  raw_entry_text: "sold 5 phone cases",
  entry_mode: "SMART_ENTRY"
}
```

---

### 5️⃣ **KEY FEATURES**

✅ **Multiple Transaction Types**
- income, expense, loan, transfer, tithe, investment, loan_payment
- top_up, send, receive (for wallet)

✅ **Data Privacy & Security**
- Optional encryption for sensitive amounts/descriptions
- SECURITY DEFINER for RPC functions
- Row-level security policies
- SHA-256 hashing for blockchain verification

✅ **Smart Categorization**
- Manual selection
- AI-powered auto-categorization
- Sub-categories for granularity
- Custom tags

✅ **Source Tracking**
- manual, voice, import, recurring, ai_detected
- External reference IDs
- Original input preservation

✅ **Recurring Transactions**
- Pattern support (daily, weekly, biweekly, monthly, quarterly, yearly)
- End date configuration
- Parent transaction linking

✅ **Multi-Currency Support**
- UGX, KES, USD, GHS, etc.
- Transaction-level currency specification
- Conversion handling in metadata

✅ **Accounting Intelligence**
- AI-powered classification
- Depreciation tracking
- Journal entry generation
- Tax treatment recommendations
- Confidence scoring

---

### 6️⃣ **CURRENT LIMITATIONS**

❌ **NOT YET IMPLEMENTED**
1. **Local-First Offline**: Transactions don't record locally first
2. **Auto-Sync Queue**: No queuing for failed syncs
3. **Conflict Resolution**: No handling for offline edits
4. **24-Hour Offline**: Limited to online operation
5. **Background Sync**: No sync when app reopens
6. **Transaction Batching**: No bulk queue for batch syncing
7. **Error Recovery**: Limited retry logic for failed transactions
8. **Real-Time Validation**: No offline validation before sync

---

### 7️⃣ **WHAT WE NEED TO ADD** (For Full PWA)

🔧 **To Enable Full Offline + 24-Hour Sync**:

1. **IndexedDB Transaction Queue** - Store pending transactions locally
2. **Service Worker Sync** - Background sync when online
3. **Conflict Resolution** - Handle simultaneous offline edits
4. **Validation Engine** - Pre-sync validation with offline rules
5. **Batch Processing** - Queue & sync multiple transactions
6. **Error Recovery** - Retry logic with exponential backoff
7. **Sync Notifications** - UI feedback during sync process
8. **Data Encryption** - Local encryption at rest in IndexedDB

---

## 📌 Summary

**Current State**: ICAN has a **robust transaction recording system** with:
- ✅ Multiple transaction types (wallet, card, financial)
- ✅ Automatic AI categorization
- ✅ Accounting intelligence
- ✅ Encryption & security
- ✅ Rich metadata storage
- ✅ Multi-currency support

**Missing for Full PWA**: 
- ❌ Offline-first recording
- ❌ Local-first indexedDB persistence
- ❌ Auto-sync queue
- ❌ 24-hour offline capability
- ❌ Service worker background sync

**Next Step**: Build the **Offline-First Layer** on top of existing transaction system while preserving all current features.
