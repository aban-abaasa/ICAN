# Agent Withdraw & Deposit Integration Guide

## Overview
The withdraw and deposit functionality has been successfully connected to the agent system. When users perform withdrawals or deposits, the system now:

1. **Checks if user is an agent** using `agentService.isUserAgent()`
2. **Routes to appropriate handler**:
   - **Agents**: Use `agentService.processCashOut()` and `agentService.processCashIn()`
   - **Non-agents**: Use regular wallet operations
3. **Displays appropriate success messages** with commission info for agents

## Implementation Details

### New Handler Functions Added to ICANWallet.jsx

#### 1. `handleAgentWithdraw()` (Lines 544-616)
**Purpose**: Process withdrawals with agent-aware routing

**Flow**:
```
User submits withdrawal form
    ↓
Check if user is agent (isUserAgent())
    ↓
    ├─ YES → Call agentService.processCashOut()
    │        - Deduct from agent float
    │        - Earn 2.5% commission
    │        - Get updated float balance
    │        - Show commission earned message
    │
    └─ NO → Show regular withdrawal message
             (funds will be sent within 24-48 hours)
```

**Key Features**:
- Validates all required fields (method, phoneAccount, amount)
- Calculates commission automatically (amount × 0.025)
- Updates agent float balance in real-time
- Shows transaction ID for tracking
- Auto-closes modal after 3 seconds
- Displays commission, amount, and new float balance for agents

**Success Response for Agents**:
```
✅ Cash-Out Successful!
💰 Amount: USD 500
💵 Commission Earned (2.5%): USD 12.50
🏦 New Float Balance: USD 4,487.50
```

#### 2. `handleAgentDeposit()` (Lines 619-641)
**Purpose**: Route to appropriate modal based on user type

**Flow**:
```
User clicks a deposit method button
    ↓
Call handleAgentDeposit(method)
    ↓
Check if user is agent
    ↓
    ├─ YES → Set isAgent = true
    │        (Agents will see agent-specific UI)
    │
    └─ NO → Set isAgent = false
             (Regular users see normal deposit form)
```

**Supported Methods**:
- `mobileMoneyDeposit` - MTN, Airtel, Vodafone
- `cardDeposit` - Visa, Mastercard
- `bankDeposit` - Direct bank transfer

#### 3. `handleProcessAgentCashIn()` (Lines 644-707)
**Purpose**: Process deposits (cash-in) with agent float management

**Flow**:
```
User submits deposit amount and method
    ↓
Check if user is agent
    ↓
    ├─ YES → Call agentService.processCashIn()
    │        - Deduct from agent float
    │        - Add to user wallet
    │        - Get updated float balance
    │        - Show float update message
    │
    └─ NO → Call handleTopUp()
             (Regular wallet top-up)
```

**Success Response for Agents**:
```
✅ Deposit Successful!
💰 Amount: USD 500
🏦 Float updated | New balance: USD 4,987.50
```

### Modified Components

#### Withdraw Modal (Lines 1560-1668)
**Changes**:
- Form submission now calls `handleAgentWithdraw()` instead of inline handler
- Enhanced success message display shows agent-specific details:
  - Commission earned (2.5%)
  - New float balance
  - Transaction ID

**UI Features**:
- Dark background dropdown (slate-700 to slate-800)
- Orange border with custom arrow icon
- Method-specific help text (phone for mobile, account for bank)
- Real-time validation

#### Deposit Tab (Lines 1054-1093)
**Changes**:
- All three buttons now call `handleAgentDeposit()` with method parameter
- Previously all buttons opened generic 'topup' modal
- Now system checks agent status and shows appropriate interface

**Button Methods**:
1. Mobile Money → `handleAgentDeposit('mobileMoneyDeposit')`
2. Card → `handleAgentDeposit('cardDeposit')`
3. Bank → `handleAgentDeposit('bankDeposit')`

## Agent Flow vs Regular User Flow

### For Agents:
```
WITHDRAW:
1. Agent clicks "Withdraw" tab
2. Enters method, phone/account, amount
3. System calls agentService.processCashOut()
4. Float decreases, commission added to earnings
5. Shows: Amount + Commission + New Balance
6. Transaction recorded in agent_transactions

DEPOSIT:
1. Agent clicks deposit method (Mobile Money/Card/Bank)
2. System identifies agent and shows agent deposit UI
3. Agent enters amount
4. System calls agentService.processCashIn()
5. Float decreases, user receives funds
6. Shows: Amount + New Float Balance
7. Transaction recorded in agent_transactions
```

### For Regular Users:
```
WITHDRAW:
1. User clicks "Withdraw" tab
2. Enters method, phone/account, amount
3. System processes regular wallet withdrawal
4. Shows: Standard withdrawal success message
5. Funds sent within 24-48 hours
6. Transaction recorded in regular wallet

DEPOSIT:
1. User clicks deposit method
2. System shows regular top-up modal
3. User enters amount and payment details
4. System processes payment through provider
5. Shows: Standard deposit success message
6. Funds added to wallet immediately
```

## State Management

### New State Variables Used
- `withdrawForm`: `{ method: '', phoneAccount: '', amount: '' }`
- `transactionInProgress`: `boolean`
- `transactionResult`: Object with transaction details
- `selectedCurrency`: 'USD' or 'UGX'
- `isAgent`: `boolean`

### State Transitions
```
Form Input
    ↓
[withdrawForm state updates]
    ↓
User clicks Submit
    ↓
[transactionInProgress = true]
    ↓
Process with agentService
    ↓
[transactionResult populated]
    ↓
[transactionInProgress = false]
    ↓
Display Success/Error
    ↓
Auto-close after 3 seconds
```

## Error Handling

### Validation Errors
- Empty fields check → Shows "Please fill in all fields" alert
- Method not selected → Cannot submit form
- Invalid amount → Input validation

### Runtime Errors
- Agent service failure → Shows error message with details
- Agent check failure → Falls back to regular operation
- Transaction processing error → Shows error and allows retry

### Error Display Format
```
❌ [Error Message]
Details if available
```

## Commission Calculation

### For Cash-Out (Withdrawal)
```
Commission = Amount × 0.025
Example: 500 × 0.025 = 12.50

Breakdown:
- Amount withdrawn: 500
- Commission earned: 12.50 (2.5%)
- Total impact on float: -500 (cash leaves agent)
- Earnings recorded: +12.50
```

### For Cash-In (Deposit)
```
No commission on deposits
Only float balance update

Breakdown:
- Amount deposited: 500
- User receives: 500
- Float deduction: -500
- Commission: 0
```

## Float Balance Management

### Before Transaction
```
Agent Float Balance (USD): 5,000.00
Agent Float Balance (UGX): 15,000,000.00
```

### After Cash-Out of $500
```
Float Balance (USD): 4,500.00
Earnings added: $12.50 (commission)
Total impact: -$487.50 net
```

### After Cash-In of $500
```
Float Balance (USD): 4,000.00
User receives: $500.00
Total impact: -$500.00
```

## Transaction Recording

### Agent Transactions Table Entry
```sql
INSERT INTO agent_transactions (
  agent_id,
  transaction_type,  -- 'cash_out' or 'cash_in'
  amount,
  currency,
  method,
  commission,
  new_float_balance,
  status,
  created_at
)
```

### Regular Wallet Transaction
```sql
INSERT INTO wallet_transactions (
  user_id,
  transaction_type,  -- 'withdrawal' or 'deposit'
  amount,
  currency,
  method,
  status,
  created_at
)
```

## Testing Checklist

- [ ] Agent can withdraw and see commission in success message
- [ ] Agent float balance updates correctly after withdrawal
- [ ] Non-agent withdrawal shows standard message without commission
- [ ] Agent can deposit and see float balance update
- [ ] Non-agent deposit shows standard top-up form
- [ ] Transaction IDs are generated and displayed
- [ ] Error messages show correctly for invalid inputs
- [ ] Modal closes automatically after 3 seconds
- [ ] All three payment methods are routable
- [ ] Both USD and UGX currencies work correctly

## API Integration Points

### agentService Methods Called
1. **isUserAgent()** - Check if user has agent account
2. **processCashOut()** - Handle agent withdrawal with commission
3. **processCashIn()** - Handle agent deposit from float
4. **getFloatBalances()** - Fetch updated USD/UGX balances

### Parameters Passed
```javascript
// Cash-Out
agentService.processCashOut({
  amount: 500,
  currency: 'USD',
  withdrawalMethod: 'mtn',
  phoneNumber: '+256701234567',
  description: 'Cash-out via mtn'
})

// Cash-In
agentService.processCashIn({
  amount: 500,
  currency: 'USD',
  depositMethod: 'mobileMoney',
  description: 'Cash-in to float via Mobile Money'
})
```

## Success Flow Diagram

```
AGENT WITHDRAWAL:
┌─────────────────────┐
│ Agent enters amount │
└──────────┬──────────┘
           ↓
    ┌──────────────┐
    │ isUserAgent? │
    └─┬────────┬───┘
      │        │
      YES     NO
      │        │
      ↓        ↓
   ProcessCashOut    ShowRegularMsg
      │                  │
      ↓                  ↓
  ✅ Show Commission  ✅ Show Standard Msg
  ✅ Update Balance   ✅ Close Modal
  ✅ Show TransID     ✅ Close Modal
```

## UI/UX Improvements

### For Agents
- Withdrawal success shows earned commission prominently
- Float balance displayed in real-time
- Transaction ID provided for tracking
- Clear color coding: yellow for commission, blue for balance

### For Regular Users
- Standard success messages
- No confusion with agent-specific metrics
- Normal withdrawal/deposit flow unchanged

### Visual Indicators
- ✅ Success (green)
- ❌ Error (red)
- 💰 Amount (yellow)
- 💵 Commission (yellow)
- 🏦 Float Balance (blue)
- 📋 Transaction ID (gray)

## Future Enhancements

1. **Settlement Summaries**: Show daily/weekly earnings by type
2. **Float Warnings**: Alert when float below threshold
3. **Commission Analytics**: Graph showing commission trends
4. **Batch Transactions**: Process multiple cash-ins/outs at once
5. **Approval Workflow**: Admin approval for large transactions
6. **Auto Top-Up**: Automatically replenish float when low
7. **Rate Cards**: Display current rates for different methods
8. **Receipt Generation**: Download transaction receipts as PDF

## Troubleshooting

### Issue: Agent status not detected
**Solution**: Wait 2 seconds, agent check includes database lookup latency

### Issue: Float balance not updating
**Solution**: Ensure agentService.getFloatBalances() completes successfully

### Issue: Commission not showing
**Solution**: Check if user is actually an agent (not just registered, must have verified agent account)

### Issue: Modal not closing
**Solution**: Ensure all state cleanup happens in finally block

## Files Modified

1. **ICANWallet.jsx** (Main changes)
   - Added `handleAgentWithdraw()` function
   - Added `handleAgentDeposit()` function
   - Added `handleProcessAgentCashIn()` function
   - Updated withdraw modal form submission
   - Updated deposit tab buttons
   - Enhanced transaction result display

## Code Statistics

- **New Lines Added**: ~165
- **Functions Added**: 3
- **State Variables**: 5 (already existed)
- **API Calls**: 4 types (isUserAgent, processCashOut, processCashIn, getFloatBalances)
- **UI Components Modified**: 2 (Withdraw modal, Deposit tab)

## Dependencies

- **Frontend**: React 18 with Hooks
- **UI**: Lucide React Icons
- **Styling**: Tailwind CSS
- **Backend**: agentService.js
- **Database**: Supabase PostgreSQL

## Notes

- All operations are asynchronous and properly handled with async/await
- Error handling includes try-catch blocks and user-friendly messages
- Commission calculated as 2.5% of withdrawal amount
- Float balances fetched fresh after each transaction
- Transactions auto-close modals after 3 seconds for smooth UX
