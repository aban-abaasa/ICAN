/**
 * MOMO Integration - Real Usage Examples
 * How to use the MOmoIntegrationService with Supabase
 */

const MomoService = require('./momoIntegrationService');

// Initialize
const momo = new MomoService();

/**
 * EXAMPLE 1: Request Money from Customer
 * This receives money - Collections
 */
async function example_requestMoney() {
  try {
    console.log('\n=== EXAMPLE 1: Request Money (Collections) ===\n');

    const result = await momo.requestMoney(
      '256701234567',        // Phone number
      50000,                 // Amount in UGX
      'ORD-2026-001',        // External ID
      'Payment for investment' // Description
    );

    console.log('\nResult:', result);
    return result;
  } catch (error) {
    console.error('Error:', error.message);
  }
}

/**
 * EXAMPLE 2: Check Transaction Status
 */
async function example_checkStatus() {
  try {
    console.log('\n=== EXAMPLE 2: Check Transaction Status ===\n');

    const status = await momo.checkTransactionStatus('REC-1705763456789');
    console.log('\nStatus Result:', status);
    return status;
  } catch (error) {
    console.error('Error:', error.message);
  }
}

/**
 * EXAMPLE 3: Send Money to Customer
 * This sends money - Disbursement
 */
async function example_sendMoney() {
  try {
    console.log('\n=== EXAMPLE 3: Send Money (Disbursement) ===\n');

    const result = await momo.sendMoney(
      '256701234567',        // Phone number
      25000,                 // Amount in UGX
      'PAY-2026-001',        // External ID
      'Dividend payout'      // Description
    );

    console.log('\nResult:', result);
    return result;
  } catch (error) {
    console.error('Error:', error.message);
  }
}

/**
 * EXAMPLE 4: Get Transaction History from Supabase
 */
async function example_getHistory() {
  try {
    console.log('\n=== EXAMPLE 4: Get Transaction History ===\n');

    const history = await momo.getTransactionHistory(10);
    
    console.log('\nRecent Transactions:');
    history.forEach((tx, index) => {
      console.log(`\n${index + 1}. ${tx.reference_id}`);
      console.log(`   Type: ${tx.product_type}`);
      console.log(`   Status: ${tx.status}`);
      console.log(`   Amount: ${tx.amount} ${tx.currency}`);
      console.log(`   Phone: ${tx.phone_number}`);
      console.log(`   Date: ${new Date(tx.created_at).toLocaleString()}`);
    });
    
    return history;
  } catch (error) {
    console.error('Error:', error.message);
  }
}

/**
 * EXAMPLE 5: Validate Credentials
 */
async function example_validateCredentials() {
  try {
    console.log('\n=== EXAMPLE 5: Validate Credentials ===\n');

    const isValid = await momo.validateCredentials();
    console.log(`\nCredentials Valid: ${isValid}`);
    return isValid;
  } catch (error) {
    console.error('Error:', error.message);
  }
}

/**
 * EXAMPLE 6: Complete Workflow
 * Validate -> Request Money -> Check Status -> Get History
 */
async function example_completeWorkflow() {
  try {
    console.log('\n=== EXAMPLE 6: Complete Workflow ===\n');

    // Step 1: Validate
    console.log('Step 1: Validating credentials...');
    const isValid = await momo.validateCredentials();
    if (!isValid) {
      console.error('❌ Credentials invalid - stopping');
      return;
    }

    // Step 2: Request Money
    console.log('\nStep 2: Requesting money...');
    const transactionResult = await momo.requestMoney(
      '256701234567',
      100000,
      `TXN-${Date.now()}`,
      'Investment payment'
    );

    if (!transactionResult.success) {
      console.error('❌ Request failed - stopping');
      return;
    }

    const referenceId = transactionResult.referenceId;
    console.log(`✅ Transaction created: ${referenceId}`);

    // Step 3: Wait and check status
    console.log('\nStep 3: Waiting 3 seconds before checking status...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('Checking transaction status...');
    const statusResult = await momo.checkTransactionStatus(referenceId);
    console.log(`✅ Transaction Status: ${statusResult.status}`);

    // Step 4: Get history
    console.log('\nStep 4: Getting transaction history...');
    const history = await momo.getTransactionHistory(5);
    console.log(`✅ Retrieved ${history.length} transactions`);

    return {
      transaction: transactionResult,
      status: statusResult,
      historyCount: history.length
    };
  } catch (error) {
    console.error('❌ Workflow Error:', error.message);
  }
}

/**
 * EXAMPLE 7: Integration with Express/API
 */
async function example_expressIntegration() {
  // This would be in your Express route handler
  
  const router = require('express').Router();

  // POST /api/momo/request-payment
  router.post('/api/momo/request-payment', async (req, res) => {
    try {
      const { phoneNumber, amount, description, externalId } = req.body;

      // Validate input
      if (!phoneNumber || !amount) {
        return res.status(400).json({
          success: false,
          error: 'Phone number and amount required'
        });
      }

      // Request money
      const result = await momo.requestMoney(
        phoneNumber,
        amount,
        externalId || `REQ-${Date.now()}`,
        description
      );

      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // GET /api/momo/status/:referenceId
  router.get('/api/momo/status/:referenceId', async (req, res) => {
    try {
      const { referenceId } = req.params;

      const status = await momo.checkTransactionStatus(referenceId);

      return res.json({
        success: true,
        status: status.status,
        data: status
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // GET /api/momo/history
  router.get('/api/momo/history', async (req, res) => {
    try {
      const { limit } = req.query;
      const history = await momo.getTransactionHistory(parseInt(limit) || 20);

      return res.json({
        success: true,
        count: history.length,
        transactions: history
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // GET /api/momo/validate
  router.get('/api/momo/validate', async (req, res) => {
    try {
      const isValid = await momo.validateCredentials();

      return res.json({
        success: true,
        credentialsValid: isValid
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}

// Run examples if executed directly
if (require.main === module) {
  (async () => {
    // Uncomment the example you want to run:
    
    // await example_validateCredentials();
    // await example_requestMoney();
    // await example_checkStatus();
    // await example_sendMoney();
    // await example_getHistory();
    await example_completeWorkflow();
  })();
}

module.exports = {
  example_requestMoney,
  example_checkStatus,
  example_sendMoney,
  example_getHistory,
  example_validateCredentials,
  example_completeWorkflow,
  example_expressIntegration
};
