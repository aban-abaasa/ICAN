# Transaction Data Cleanup Guide

## Overview

This guide covers how to implement data cleanup functionality in the ICAN app reports. Users can safely delete transaction data in several ways:

- Delete all transactions
- Delete old data (>90 days)
- Delete by type (expense, income, transfer, loan)
- Delete by date range
- Delete by category
- Delete offline-synced test data
- Delete low-confidence AI transactions

## Components & Services

### 1. **Frontend Services**

#### `transactionCleanupService.js`
Main service providing all cleanup operations:

```javascript
import {
  getCleanupStats,
  deleteAllTransactions,
  deleteOldTransactions,
  deleteTransactionsByType,
  deleteTransactionsByDateRange,
  deleteLowConfidenceTransactions,
  deleteOfflineSyncTransactions,
  deleteTransactionsByCategory
} from '../services/transactionCleanupService';
```

**Available Functions:**

```javascript
// Get statistics before cleanup
const stats = await getCleanupStats();
// Returns: { total, byType: {...}, byAge: {last7Days, last30Days, last90Days, olderThan90Days} }

// Delete all transactions
const result = await deleteAllTransactions();
// Returns: { success: true, deletedCount: 42 }

// Delete transactions older than 90 days
const result = await deleteOldTransactions(90);

// Delete specific type
const result = await deleteTransactionsByType('expense');

// Delete by date range
const result = await deleteTransactionsByDateRange('2025-01-01', '2025-03-31');

// Delete low confidence
const result = await deleteLowConfidenceTransactions(0.5); // < 50% confidence

// Delete offline sync data
const result = await deleteOfflineSyncTransactions();

// Delete by category
const result = await deleteTransactionsByCategory('food');
```

#### `reportCleanupService.js`
High-level cleanup integration for reports:

```javascript
import {
  checkPreReportCleanup,
  executeCleanup,
  generateCleanupReport,
  getCleanupSummary
} from '../services/reportCleanupService';

// Check for cleanup opportunities before generating report
const cleanup = await checkPreReportCleanup();
// Returns: { stats, opportunities: [...] }

// Execute cleanup with confirmation
const result = await executeCleanup('old', { days: 90 });

// Generate before/after cleanup report
const report = await generateCleanupReport('all');
```

### 2. **UI Component**

#### `DataCleanupModal.jsx`
React modal component for user-friendly cleanup:

```javascript
import DataCleanupModal from '../components/DataCleanupModal';

// In your report component:
const [showCleanup, setShowCleanup] = useState(false);

<DataCleanupModal 
  isOpen={showCleanup}
  onClose={() => setShowCleanup(false)}
  onCleanupComplete={(result) => {
    console.log(`Deleted ${result.deletedCount} transactions`);
    // Refresh report data
  }}
/>

// Trigger modal with button
<button onClick={() => setShowCleanup(true)}>
  🗑️ Clean Data
</button>
```

### 3. **Backend SQL**

#### `backend/TRANSACTION_CLEANUP_QUERIES.sql`
SQL queries for:
- Direct database cleanup (Supabase SQL editor)
- Manual deletion operations
- Cleanup function for scheduled jobs
- Audit log tracking

**Example SQL Query:**

```sql
-- Delete all transactions for user
DELETE FROM ican_transactions
WHERE user_id = auth.uid();

-- Delete old transactions
DELETE FROM ican_transactions
WHERE user_id = auth.uid()
  AND created_at < NOW() - INTERVAL '90 days';

-- Delete by type
DELETE FROM ican_transactions
WHERE user_id = auth.uid()
  AND transaction_type = 'expense';
```

## Integration Examples

### Example 1: Add Cleanup Button to Reports

```javascript
import { useState } from 'react';
import DataCleanupModal from '../components/DataCleanupModal';

export const MyReport = () => {
  const [showCleanup, setShowCleanup] = useState(false);
  const [transactions, setTransactions] = useState([]);

  const handleCleanupComplete = async (result) => {
    console.log(`✅ Cleanup completed: ${result.deletedCount} deleted`);
    setShowCleanup(false);
    // Reload transactions
    loadTransactions();
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button 
          onClick={() => setShowCleanup(true)}
          className="bg-red-500 text-white px-4 py-2 rounded"
        >
          🗑️ Clean Data
        </button>
      </div>

      <DataCleanupModal 
        isOpen={showCleanup}
        onClose={() => setShowCleanup(false)}
        onCleanupComplete={handleCleanupComplete}
      />

      {/* Report content */}
    </div>
  );
};
```

### Example 2: Pre-Report Cleanup Check

```javascript
import { checkPreReportCleanup } from '../services/reportCleanupService';

export const AdvancedReport = () => {
  const [cleanupOpportunities, setCleanupOpportunities] = useState([]);

  useEffect(() => {
    const checkCleanup = async () => {
      const cleanup = await checkPreReportCleanup();
      if (cleanup?.opportunities.length > 0) {
        setCleanupOpportunities(cleanup.opportunities);
        // Show notification to user
      }
    };
    checkCleanup();
  }, []);

  return (
    <div>
      {cleanupOpportunities.length > 0 && (
        <div className="bg-yellow-100 border border-yellow-400 p-4 rounded mb-4">
          <p className="font-semibold">💡 Cleanup Suggestions:</p>
          {cleanupOpportunities.map(opp => (
            <button 
              key={opp.id}
              onClick={() => opp.action()}
              className="block text-blue-600 hover:underline"
            >
              {opp.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
```

### Example 3: Manual Cleanup in Reports

```javascript
import { deleteOldTransactions, getCleanupStats } from '../services/transactionCleanupService';

const handleCleanupClick = async () => {
  try {
    // Show stats first
    const stats = await getCleanupStats();
    console.log('Current transactions:', stats.total);
    console.log('Older than 90 days:', stats.byAge.olderThan90Days);

    // Confirm with user
    if (confirm(`Delete ${stats.byAge.olderThan90Days} old transactions?`)) {
      const result = await deleteOldTransactions(90);
      alert(`✅ Deleted ${result.deletedCount} transactions`);
      
      // Refresh data
      reloadReport();
    }
  } catch (error) {
    alert(`❌ Error: ${error.message}`);
  }
};
```

### Example 4: Cleanup in Advanced Reports

```javascript
// In your advanced report component
import DataCleanupModal from '../components/DataCleanupModal';

export const TaxReturnReport = () => {
  const [showCleanup, setShowCleanup] = useState(false);

  const generateReport = async () => {
    // Optional: Check if cleanup needed first
    const cleanup = await checkPreReportCleanup();
    
    if (cleanup?.opportunities.length > 0) {
      // Show user: "Clean data first?"
      if (confirm('Do you want to clean data before generating?')) {
        setShowCleanup(true);
        return;
      }
    }

    // Generate report
    // ...
  };

  return (
    <div>
      <button onClick={generateReport}>📋 Generate Tax Return</button>
      
      <DataCleanupModal 
        isOpen={showCleanup}
        onClose={() => setShowCleanup(false)}
        onCleanupComplete={() => {
          setShowCleanup(false);
          generateReport(); // Generate after cleanup
        }}
      />
    </div>
  );
};
```

## Security & Safety Features

### ✅ Built-in Protections

1. **RLS Enforcement**: All queries use `auth.uid()` - users can only delete their own data
2. **Confirmation Dialogs**: Users must confirm before deletion
3. **Offline Queue Cleanup**: Prevents re-syncing of deleted transactions
4. **Error Handling**: Comprehensive try-catch blocks
5. **Logging**: All operations logged for audit trail

### ⚠️ Important Notes

- **Permanent Deletion**: Data cannot be recovered after deletion
- **No Rollback**: Each deletion is immediate in Supabase
- **Backup First**: Recommend users export data before cleanup
- **Consider Soft Deletes**: Use `deleted_at` timestamp instead of hard delete for recovery
- **Batch Operations**: Large deletions may take time - show progress

## Cleanup Workflow

```
1. User clicks "Clean Data" button
   ↓
2. Modal loads transaction statistics
   ↓
3. User selects cleanup option
   ↓
4. Confirmation dialog appears
   ↓
5. Service removes from offline queue
   ↓
6. Service deletes from Supabase (respects RLS)
   ↓
7. Stats reload showing new totals
   ↓
8. Success notification shown
   ↓
9. Report data refreshes automatically
```

## File Structure

```
frontend/
├── src/
│   ├── services/
│   │   ├── transactionCleanupService.js      ← Core cleanup logic
│   │   └── reportCleanupService.js           ← Report integration
│   └── components/
│       └── DataCleanupModal.jsx              ← UI component
└── [Your Report Components]
    └── Use DataCleanupModal & services

backend/
└── TRANSACTION_CLEANUP_QUERIES.sql           ← SQL queries & functions
```

## Testing Cleanup

```javascript
// Test cleanup service (browser console)
import { getCleanupStats, deleteOldTransactions } from './services/transactionCleanupService';

// Check stats
const stats = await getCleanupStats();
console.log('Stats:', stats);

// Delete old transactions (test)
const result = await deleteOldTransactions(90);
console.log('Deleted:', result.deletedCount);

// Verify deletion
const statsAfter = await getCleanupStats();
console.log('Stats after:', statsAfter);
```

## Troubleshooting

### Issue: Cleanup button not working
- Check browser console for errors
- Verify user is authenticated
- Check Supabase connection

### Issue: Transactions reappear after cleanup
- Offline queue wasn't cleared (now fixed by removeActionsByTransactionId)
- Sync manager re-inserted queued transactions
- Solution: Always use `offlineAuthManager.removeActionsByTransactionId()` before delete

### Issue: Permission denied
- Supabase RLS policy blocking deletion
- Verify `user_id = auth.uid()` in WHERE clause
- Check that current user_id matches transaction owner

### Issue: Slow deletion on large datasets
- Too many transactions to delete at once
- Solution: Implement pagination or batch deletion
- Consider archiving old data instead of deletion

## Future Enhancements

- [ ] Batch deletion with progress bar
- [ ] Export to CSV before deletion
- [ ] Scheduled cleanup jobs
- [ ] Undo/restore from soft delete
- [ ] Cleanup templates (e.g., "Monthly cleanup")
- [ ] Cleanup analytics dashboard
- [ ] Email confirmation for bulk deletes
- [ ] Data export before cleanup

---

**Last Updated:** May 2026  
**Maintenance:** Keep SQL queries and services in sync  
**Questions?** Check console logs for detailed error messages
