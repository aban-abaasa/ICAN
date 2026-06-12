# Tithe Payment Recording Guide
## Ensuring Every Tithe Payment is Recorded with Business/Personal Categorization

**Status**: ✅ READY FOR DEPLOYMENT  
**Date**: June 8, 2026  
**Purpose**: Ensure all tithe payments are properly recorded in transactions with metadata for reports

---

## 📋 Overview

When a user pays tithe (💼Business or 👤Personal), the payment must be recorded in `ican_transactions` with proper metadata so it appears correctly in reports. The system automatically clears the tithe balance after payment is recorded.

---

## 🔧 Implementation in Frontend

### Step 1: Update `handlePayTithe()` Function

In `MobileView.jsx`, update the tithe payment handler to include proper metadata:

```javascript
const handlePayTithe = async () => {
  try {
    setIsSubmittingTithe(true);
    setTithePaymentError('');
    setTithePaymentSuccess('');

    const amount = parseFloat(tithePaymentAmount);
    
    if (!amount || amount <= 0) {
      setTithePaymentError('Please enter a valid amount');
      return;
    }

    if (!tithePaymentType) {
      setTithePaymentError('Please select payment type (Personal, Business, or Combined)');
      return;
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    // Determine category based on payment type
    let paymentCategory = 'giving';
    let transactionDescription = '';
    
    switch(tithePaymentType) {
      case 'personal':
        transactionDescription = `Tithe Payment - Personal (👤)`;
        break;
      case 'business':
        transactionDescription = `Tithe Payment - Business (💼)`;
        break;
      case 'combined':
        transactionDescription = `Tithe Payment - Personal & Business (👤💼)`;
        break;
    }

    // Create metadata with proper structure for reports
    const metadata = {
      payment_type: tithePaymentType,        // personal | business | combined
      tithe_type: tithePaymentType,
      entry_mode: 'tithe-pay-in',
      recipient: tithePaymentRecipient || 'Church/Organization',
      notes: tithePaymentNotes || '',
      recorded_date: new Date().toISOString(),
      record_category: tithePaymentType
    };

    // Record tithe payment in transactions
    const { data, error } = await supabase
      .from('ican_transactions')
      .insert([
        {
          user_id: user.id,
          transaction_type: 'tithe',
          category: paymentCategory,
          amount: amount,
          status: 'completed',
          description: transactionDescription,
          metadata: metadata
        }
      ])
      .select();

    if (error) {
      console.error('Tithe payment error:', error);
      setTithePaymentError(`Payment failed: ${error.message}`);
      return;
    }

    // Success - the database trigger will automatically clear tithe amounts
    setTithePaymentSuccess(`✅ Tithe payment of ${amount} recorded successfully!`);
    
    // Reset form
    setTithePaymentAmount('');
    setTithePaymentType('');
    setTithePaymentRecipient('');
    setTithePaymentNotes('');
    
    // Refresh tithe data after 1 second
    setTimeout(() => {
      loadTitheData();
    }, 1000);

  } catch (error) {
    console.error('Tithe payment error:', error);
    setTithePaymentError(error.message);
  } finally {
    setIsSubmittingTithe(false);
  }
};
```

### Step 2: Update Tithe Payment Form UI

Ensure the form captures all necessary information:

```javascript
// In your tithe modal "Pay In" tab:

<div className="space-y-4">
  {/* Amount Input */}
  <div>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      Amount to Pay
    </label>
    <input
      type="number"
      value={tithePaymentAmount}
      onChange={(e) => setTithePaymentAmount(e.target.value)}
      placeholder="Enter amount"
      className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
    />
  </div>

  {/* Payment Type Selector */}
  <div>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      Payment Type
    </label>
    <select
      value={tithePaymentType}
      onChange={(e) => setTithePaymentType(e.target.value)}
      className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
    >
      <option value="">Select type...</option>
      <option value="personal">👤 Personal</option>
      <option value="business">💼 Business</option>
      <option value="combined">👤💼 Personal & Business</option>
    </select>
  </div>

  {/* Recipient */}
  <div>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      Recipient (Church/Organization)
    </label>
    <input
      type="text"
      value={tithePaymentRecipient}
      onChange={(e) => setTithePaymentRecipient(e.target.value)}
      placeholder="Enter recipient name"
      className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
    />
  </div>

  {/* Notes */}
  <div>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      Notes (Optional)
    </label>
    <textarea
      value={tithePaymentNotes}
      onChange={(e) => setTithePaymentNotes(e.target.value)}
      placeholder="Add any notes..."
      className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
      rows="3"
    />
  </div>

  {/* Error/Success Messages */}
  {tithePaymentError && (
    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
      {tithePaymentError}
    </div>
  )}
  
  {tithePaymentSuccess && (
    <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300 text-sm">
      {tithePaymentSuccess}
    </div>
  )}

  {/* Submit Button */}
  <button
    onClick={handlePayTithe}
    disabled={isSubmittingTithe}
    className="w-full px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50"
  >
    {isSubmittingTithe ? '⏳ Recording Payment...' : '💳 Record Payment'}
  </button>
</div>
```

---

## 🗄️ Database Trigger

The `CLEAR_TITHE_ON_PAYMENT.sql` file contains a PostgreSQL trigger that automatically:

1. **Validates** the transaction is a tithe payment (`transaction_type = 'tithe'` AND `status = 'completed'`)
2. **Ensures** metadata has proper structure with `payment_type`, `entry_mode`, `recorded_date`
3. **Updates** `user_tithe_tracking` to reset the appropriate tithe balance
4. **Records** `last_payment_date` for audit trail

**No additional backend action needed** - the trigger handles everything automatically when a transaction is inserted.

---

## 📊 How This Appears in Reports

### Transaction Recording Structure
```json
{
  "user_id": "uuid",
  "transaction_type": "tithe",
  "category": "giving",
  "amount": 250.00,
  "status": "completed",
  "description": "Tithe Payment - Personal (👤)",
  "metadata": {
    "payment_type": "personal",
    "tithe_type": "personal",
    "entry_mode": "tithe-pay-in",
    "recipient": "Church Name",
    "recorded_date": "2026-06-08T10:30:00Z",
    "record_category": "personal"
  }
}
```

### Report Filtering
Reports can now filter by:
- **`payment_type`**: `personal`, `business`, or `combined`
- **`entry_mode`**: `tithe-pay-in` to identify tithe payments
- **`record_category`**: `personal` or `business` for categorization

---

## ✅ Deployment Checklist

- [ ] **Database**: Deploy `CLEAR_TITHE_ON_PAYMENT.sql` to Supabase
  - Run Section 1: Create tithe tracking table
  - Run Section 2: Initialize existing users
  - Run Section 3: Create trigger function
  - Run Section 4: Enable RLS (safe to re-run - drops existing policies first)
  - Run Section 5: Verify setup
  - ✅ **Note**: Scripts now safely handle re-runs by dropping existing policies before creating new ones
  
- [ ] **Frontend**: Update `MobileView.jsx`
  - Update `handlePayTithe()` function with metadata
  - Update tithe payment form UI
  - Ensure state variables exist: `tithePaymentType`, `tithePaymentRecipient`, etc.
  
- [ ] **Testing**: Verify tithe payments
  - [ ] Personal tithe payment recorded with `payment_type: 'personal'`
  - [ ] Business tithe payment recorded with `payment_type: 'business'`
  - [ ] Combined tithe payment recorded with `payment_type: 'combined'`
  - [ ] Tithe balance clears automatically after payment
  - [ ] Transaction appears in user's transaction history
  - [ ] Reports show correct categorization

---

## 🧪 Testing Steps

### Test 1: Record Personal Tithe Payment
1. Open app as test user
2. Navigate to Tithe → Pay In tab
3. Enter amount: `250`
4. Select type: `👤 Personal`
5. Enter recipient: `Church Name`
6. Click "Record Payment"
7. Verify: 
   - ✅ Success message shows
   - ✅ Personal tithe balance becomes 0
   - ✅ Transaction appears in history with 👤 label

### Test 2: Record Business Tithe Payment
1. Navigate to Tithe → Pay In tab
2. Enter amount: `500`
3. Select type: `💼 Business`
4. Enter recipient: `Ministry Organization`
5. Click "Record Payment"
6. Verify:
   - ✅ Success message shows
   - ✅ Business tithe balance becomes 0
   - ✅ Transaction appears in history with 💼 label

### Test 3: Record Combined Tithe Payment
1. Navigate to Tithe → Pay In tab
2. Enter amount: `750`
3. Select type: `👤💼 Personal & Business`
4. Enter recipient: `Church`
5. Click "Record Payment"
6. Verify:
   - ✅ Success message shows
   - ✅ Both personal AND business balances become 0
   - ✅ Transaction appears with both 👤💼 labels

### Test 4: Verify in Reports
1. Navigate to Reports
2. Filter by: **Category** = "Giving"
3. Verify tithe payments appear with:
   - Correct amount
   - Correct date
   - 👤Personal or 💼Business label
   - Recipient name

---

## 🔍 Verify Database Setup

Run this query to verify tithe tracking is working:

```sql
-- Check tithe tracking for a user
SELECT 
  u.email,
  t.personal_tithe_accumulated,
  t.business_tithe_accumulated,
  t.combined_tithe_accumulated,
  t.last_payment_date
FROM user_tithe_tracking t
INNER JOIN auth.users u ON t.user_id = u.id
WHERE u.email = 'test@example.com';

-- Check recorded transactions for a user
SELECT 
  t.amount,
  t.description,
  t.metadata->>'payment_type' as type,
  t.metadata->>'recipient' as recipient,
  t.created_at
FROM ican_transactions t
INNER JOIN auth.users u ON t.user_id = u.id
WHERE u.email = 'test@example.com' 
  AND t.transaction_type = 'tithe'
ORDER BY t.created_at DESC;
```

---

## 📝 Notes

- **Automatic Clearing**: The database trigger automatically clears tithe amounts when payment is recorded. No manual reset needed.
- **Metadata Structure**: The `metadata` field is crucial for report filtering. Ensure all fields are populated.
- **Recipient Tracking**: Optional `recipient` field tracks where tithe was paid (church, ministry, etc.)
- **Audit Trail**: `recorded_date` field helps with reconciliation and audit purposes.
- **RLS Security**: Only users can see/modify their own tithe tracking data.

---

## 🚀 Summary

✅ Every tithe payment is now recorded in transactions  
✅ Payments are categorized as 👤Personal, 💼Business, or 👤💼Combined  
✅ Tithe balance automatically clears after payment  
✅ Payments appear in reports with proper labels  
✅ Full audit trail maintained with recipient tracking  

Ready for production! 🎯
