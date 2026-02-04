/**
 * 🔐 UNIVERSAL TRANSACTION PIN SYSTEM - IMPLEMENTATION GUIDE
 * 
 * This guide shows how to integrate the universal PIN approval system
 * into any component handling financial transactions
 */

// ============================================
// 1️⃣ IMPORT THE UNIVERSAL SERVICE AND MODAL
// ============================================
import UnifiedApprovalModal from '../components/UnifiedApprovalModal';
import universalTransactionService from '../services/universalTransactionService';

// ============================================
// 2️⃣ ADD STATE TO YOUR COMPONENT
// ============================================
const [showApprovalModal, setShowApprovalModal] = useState(false);
const [pendingTransaction, setPendingTransaction] = useState(null);
const [approvalError, setApprovalError] = useState(null);
const [isApproving, setIsApproving] = useState(false);

// ============================================
// 3️⃣ CREATE TRANSACTION REQUEST (BEFORE MODAL OPENS)
// ============================================

// Example 1: Send Money
const handleSendMoney = async (recipientId, amount) => {
  try {
    // Create pending transaction
    setPendingTransaction({
      type: 'send',
      recipientId,
      amount,
      currency: 'UGX',
      description: `Send to ${recipientName}`,
      userId: currentUser.id
    });
    
    setShowApprovalModal(true);
  } catch (error) {
    setApprovalError(error.message);
  }
};

// Example 2: Withdraw via Agent
const handleWithdraw = async (amount, agent) => {
  try {
    setPendingTransaction({
      type: 'withdraw',
      amount,
      currency: 'UGX',
      agentId: agent.id,
      description: `Withdraw from ${agent.name}`,
      userId: currentUser.id
    });
    
    setShowApprovalModal(true);
  } catch (error) {
    setApprovalError(error.message);
  }
};

// Example 3: Cash-Out with Commission
const handleCashOut = async (amount, agent, commissionRate = 2.5) => {
  try {
    setPendingTransaction({
      type: 'cashOut',
      amount,
      currency: 'UGX',
      agentId: agent.id,
      commissionRate,
      userId: currentUser.id
    });
    
    setShowApprovalModal(true);
  } catch (error) {
    setApprovalError(error.message);
  }
};

// Example 4: Top-Up
const handleTopUp = async (amount) => {
  try {
    setPendingTransaction({
      type: 'topup',
      amount,
      currency: 'UGX',
      userId: currentUser.id
    });
    
    setShowApprovalModal(true);
  } catch (error) {
    setApprovalError(error.message);
  }
};

// ============================================
// 4️⃣ HANDLE APPROVAL (CALLED FROM MODAL)
// ============================================

const handleTransactionApproval = async (pin, authMethod, result) => {
  setIsApproving(true);
  try {
    if (result && result.success) {
      // Transaction was already processed by the universal service
      // Update UI with new balances
      setUserBalance(result.userBalance);
      setAgentBalance(result.agentBalance);
      setRecipientBalance(result.recipientBalance);
      
      // Show success message
      showSuccessNotification(`✅ ${pendingTransaction.type} completed successfully!`);
      
      // Close modal and reset
      setShowApprovalModal(false);
      setPendingTransaction(null);
      setApprovalError(null);
      
      // Refresh transaction history
      await loadTransactionHistory();
    } else {
      setApprovalError(result?.message || 'Transaction failed');
    }
  } catch (error) {
    setApprovalError(error.message);
  } finally {
    setIsApproving(false);
  }
};

// ============================================
// 5️⃣ RENDER THE UNIFIED APPROVAL MODAL
// ============================================

return (
  <>
    {/* Your existing UI */}
    
    {/* Add this modal for all transactions requiring approval */}
    <UnifiedApprovalModal
      isOpen={showApprovalModal}
      transactionType={pendingTransaction?.type}
      amount={pendingTransaction?.amount}
      currency={pendingTransaction?.currency}
      recipient={pendingTransaction?.recipientName}
      description={pendingTransaction?.description}
      onApprove={handleTransactionApproval}
      onCancel={() => {
        setShowApprovalModal(false);
        setPendingTransaction(null);
        setApprovalError(null);
      }}
      isLoading={isApproving}
      error={approvalError}
      attemptsRemaining={3}
      supportsBiometric={true}
    />
  </>
);

// ============================================
// 6️⃣ CONVENIENCE METHODS (OPTIONAL)
// ============================================

// These are already built into universalTransactionService:

// Send money
const result = await universalTransactionService.sendMoney({
  userId: 'user-id',
  recipientId: 'recipient-id',
  currency: 'UGX',
  amount: 10000,
  pin: '1234',
  description: 'Payment for goods'
});

// Receive money
const result = await universalTransactionService.receiveMoney({
  userId: 'user-id',
  senderId: 'sender-id',
  currency: 'UGX',
  amount: 5000,
  pin: '1234'
});

// Withdraw
const result = await universalTransactionService.withdraw({
  userId: 'user-id',
  agentId: 'agent-id',
  currency: 'UGX',
  amount: 20000,
  pin: '1234'
});

// Deposit
const result = await universalTransactionService.deposit({
  userId: 'user-id',
  agentId: 'agent-id',
  currency: 'UGX',
  amount: 15000,
  pin: '1234'
});

// Cash-In
const result = await universalTransactionService.cashIn({
  userId: 'user-id',
  agentId: 'agent-id',
  currency: 'UGX',
  amount: 50000,
  pin: '1234'
});

// Cash-Out with commission
const result = await universalTransactionService.cashOut({
  userId: 'user-id',
  agentId: 'agent-id',
  currency: 'UGX',
  amount: 30000,
  pin: '1234',
  commissionRate: 2.5  // Optional, defaults to 2.5%
});

// Top-Up
const result = await universalTransactionService.topUp({
  userId: 'user-id',
  currency: 'UGX',
  amount: 25000,
  pin: '1234'
});

// ============================================
// 7️⃣ WORKFLOW DIAGRAM
// ============================================
/*
User clicks transaction button
    ↓
Component creates pendingTransaction object
    ↓
Show UnifiedApprovalModal
    ↓
User enters PIN or uses biometric
    ↓
Modal calls universalTransactionService.processTransaction()
    ↓
Backend calls process_transaction_with_pin() SQL function
    ↓
PIN is verified
    ↓
Transaction is processed (balances updated)
    ↓
Result returned to component
    ↓
Component updates UI and closes modal
*/

// ============================================
// 8️⃣ SUPPORTED TRANSACTION TYPES
// ============================================
/*
✅ send        - P2P money transfer
✅ receive     - P2P money received
✅ withdraw    - User withdraws via agent
✅ deposit     - Agent deposits to user
✅ cashIn      - User gives cash to agent
✅ cashOut     - Agent gives cash to user (with commission)
✅ topup       - User adds credit to wallet

All types support:
- PIN verification with 3-attempt lockout
- Biometric authentication (optional)
- Commission calculation (for cashOut)
- Transaction history tracking
- Balance updates in real-time
*/

// ============================================
// 9️⃣ ERROR HANDLING
// ============================================
/*
Possible error messages:
- "User account not found"
- "Account locked. Too many failed PIN attempts."
- "Invalid PIN. Attempts remaining: X"
- "Insufficient balance"
- "Unknown transaction type"
- "Error processing transaction: [details]"

All errors are returned from the backend SQL functions,
providing security and consistency.
*/

// ============================================
// 🔟 RETURN VALUE STRUCTURE
// ============================================
/*
{
  success: boolean,
  message: string,           // Success or error message
  transactionId: uuid,       // ID of completed transaction
  userBalance: numeric,      // New user wallet balance
  agentBalance: numeric,     // New agent float balance (if applicable)
  recipientBalance: numeric  // New recipient balance (if applicable)
}
*/
