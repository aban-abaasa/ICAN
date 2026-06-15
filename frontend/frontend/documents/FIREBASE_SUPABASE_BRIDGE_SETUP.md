# 🔗 Firebase ↔ Supabase Bridge Setup

## The Issue

You're using:
- **Firebase** for AI processing & transaction storage ✅
- **Supabase** for NPV/IRR analytics ❌ (but no bridge)

The error "column user_id does not exist" happened because Supabase doesn't have a transactions table yet.

## The Solution

**Create a sync table in Supabase that mirrors Firebase transactions**, then calculate NPV/IRR on the synced data.

---

## Step 1: Setup Supabase Schema (One-time)

### In Supabase SQL Editor, run:
```sql
-- Copy entire contents of SUPABASE_FIREBASE_BRIDGE.sql
-- This creates:
-- - firebase_transactions_sync table
-- - 5 analytics views
-- - NPV/IRR calculation functions
-- - Sync function
```

**No errors** should appear now because we're not referencing columns that don't exist.

---

## Step 2: Sync Firebase Transactions to Supabase

### When user adds transaction in React:

**Before** (current code):
```javascript
const handleAddTransaction = async (transactionData) => {
  // Save to Firebase only
  const result = await addTransaction(userId, transactionData);
  return result;
};
```

**After** (with Supabase sync):
```javascript
const handleAddTransaction = async (transactionData) => {
  // 1. Save to Firebase (existing)
  const firebaseResult = await addTransaction(userId, transactionData);
  
  // 2. Also sync to Supabase for NPV/IRR
  const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_KEY);
  
  const syncResult = await supabase.rpc('sync_firebase_transaction', {
    p_firebase_id: firebaseResult.id,
    p_user_id: userId,
    p_amount: transactionData.amount,
    p_type: transactionData.type,
    p_description: transactionData.description || '',
    p_category: transactionData.category || '',
    p_project_name: transactionData.projectName || null,
    p_term_months: transactionData.termMonths || null,
    p_expected_return: transactionData.expectedReturn || null,
    p_confidence: transactionData.confidence || 0,
    p_firebase_created_at: new Date(transactionData.createdAt).toISOString()
  });
  
  if (syncResult.error) {
    console.error('Sync error:', syncResult.error);
    // Don't break UI, logging only
  }
  
  return firebaseResult;
};
```

---

## Step 3: Query Vital Aggregates from Supabase

### In your dashboard component:

```javascript
// Get monthly metrics
const getVitalAggregates = async (userId) => {
  const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_KEY);
  
  const { data, error } = await supabase
    .from('vital_aggregates')
    .select('*')
    .eq('user_id', userId)
    .order('month', { ascending: false })
    .limit(1);
  
  if (error) console.error(error);
  return data?.[0] || null;
};

// Calculate NPV
const getNPV = async (userId) => {
  const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_KEY);
  
  const { data, error } = await supabase
    .rpc('calculate_npv', {
      p_user_id: userId,
      p_discount_rate: 0.10
    });
  
  if (error) console.error(error);
  return data || 0;
};

// Calculate IRR
const getIRR = async (userId) => {
  const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_KEY);
  
  const { data, error } = await supabase
    .rpc('calculate_irr', {
      p_user_id: userId
    });
  
  if (error) console.error(error);
  return data || 0;
};
```

### Use in component:

```javascript
useEffect(() => {
  const loadMetrics = async () => {
    const aggregates = await getVitalAggregates(userId);
    const npv = await getNPV(userId);
    const irr = await getIRR(userId);
    
    setMonthlyIncome(aggregates?.monthly_income || 0);
    setMonthlyExpense(aggregates?.monthly_expense || 0);
    setSavingsRate(aggregates?.savings_rate_percent || 0);
    setNPV(npv);
    setIRR(irr);
  };
  
  loadMetrics();
}, [userId, transactionCount]); // Refresh when transactions change
```

---

## Data Flow

```
User Input
  ↓
Smart Transaction Entry
  ↓
NLP Parser (Firebase AI)
  ↓
Structured transaction object:
{
  id: "firebase_doc_123",
  amount: 5000000,
  type: "investment",
  projectName: "Coffee Shop",
  expectedReturn: 20,
  termMonths: 36,
  confidence: 85
}
  ↓
1. Save to Firebase ✅
  ↓
2. Sync to Supabase via RPC ✅
  ↓
Supabase:
  - Stores in firebase_transactions_sync table
  - Views auto-calculate aggregates
  - Functions ready for NPV/IRR queries
  ↓
React dashboard queries Supabase for:
  - Monthly income/expense
  - Savings rate
  - NPV & IRR
  - Creative insights
  ↓
Display to user ✅
```

---

## File Locations

- **Supabase Schema**: `SUPABASE_FIREBASE_BRIDGE.sql`
- **React Integration**: Update `ICAN_Capital_Engine.jsx` `handleAddTransaction()` function
- **Helpers**: Add sync utilities to `firebase.js`

---

## What Gets Synced

Only essential fields:
- `firebase_id` - Links to original Firestore doc
- `user_id` - Firebase user ID
- `amount` - Transaction amount
- `type` - income/expense/loan/investment
- `description` - What the transaction is for
- `category` - How to categorize it
- `project_name` - If for a specific project
- `project_term_months` - Duration
- `expected_return_percent` - Expected ROI
- `confidence` - AI confidence score
- `firebase_created_at` - When it happened

---

## Benefits

1. ✅ **Dual Storage**: Live in Firebase (original), analytics in Supabase
2. ✅ **Fast Analytics**: Pre-calculated views instead of real-time queries
3. ✅ **No Data Loss**: If sync fails, transaction still in Firebase
4. ✅ **Scalable**: Views handle millions of transactions efficiently
5. ✅ **Separation**: Firebase for transactional, Supabase for analytical

---

## Testing

### Test 1: Check schema created
```sql
-- In Supabase SQL
SELECT * FROM information_schema.tables 
WHERE table_name = 'firebase_transactions_sync';
-- Should show the table
```

### Test 2: Manually sync a transaction
```sql
SELECT sync_firebase_transaction(
  'test-doc-123',
  'user-firebase-id',
  5000000,
  'investment',
  'Test investment',
  'Business',
  'Test Project',
  36,
  20.0,
  85,
  NOW()
);
```

### Test 3: Check vital aggregates
```sql
SELECT * FROM vital_aggregates 
WHERE user_id = 'user-firebase-id';
```

### Test 4: Calculate NPV
```sql
SELECT calculate_npv('user-firebase-id', 0.10) AS npv;
```

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "function sync_firebase_transaction not found" | Schema not created | Run SUPABASE_FIREBASE_BRIDGE.sql |
| Empty vital_aggregates | No synced transactions | Sync a transaction first |
| NPV always 0 | No income/expense transactions | Add test transactions |
| Column "user_id" doesn't exist | Wrong table | Check firebase_transactions_sync exists |

---

## Quick Integration Checklist

- [ ] Run `SUPABASE_FIREBASE_BRIDGE.sql` in Supabase SQL Editor
- [ ] Test schema with manual sync query
- [ ] Create `supabase.js` helper file with RPC functions
- [ ] Update `handleAddTransaction()` to call sync function
- [ ] Add Supabase client to React environment
- [ ] Query vital_aggregates in dashboard component
- [ ] Display NPV/IRR metrics to user
- [ ] Test with real transaction input

---

## Migration Path

If you have existing Firebase transactions, run this to backfill:

```javascript
// In console or backend job
const getAllTransactions = async (userId) => {
  const result = await getUserTransactions(userId);
  
  for (const tx of result.data) {
    await supabase.rpc('sync_firebase_transaction', {
      p_firebase_id: tx.id,
      p_user_id: tx.userId,
      p_amount: tx.amount,
      p_type: tx.type,
      p_description: tx.description || '',
      p_category: tx.category || '',
      p_project_name: tx.projectName || null,
      p_term_months: tx.termMonths || null,
      p_expected_return: tx.expectedReturn || null,
      p_confidence: tx.confidence || 0,
      p_firebase_created_at: tx.createdAt
    });
  }
};
```

---

## Done! 🎉

You now have:
- ✅ Dual-database architecture (Firebase + Supabase)
- ✅ Synced transaction data
- ✅ NPV/IRR calculation functions
- ✅ Vital aggregates views
- ✅ Ready for creative insights

Users will see their financial metrics instantly, with no data loss and perfect sync between systems.
