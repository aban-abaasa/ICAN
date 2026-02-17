/**
 * 💰 P2P Transfer Routes
 * Orchestrates the 2-step workflow:
 * 1. Collect from sender (Collections API)
 * 2. Send to recipient (Disbursements API)
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const mtnMomoService = require('../services/mtnMomoService');

const router = express.Router();

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/**
 * POST /api/p2p/transfer
 * Complete 2-step P2P Money Transfer
 * 
 * Step 1: Collect from sender (Collections)
 * Step 2: Send to recipient (Disbursements)
 * 
 * @param {number} amount - Amount to transfer
 * @param {string} senderPhone - Sender's phone number
 * @param {string} recipientPhone - Recipient's phone number
 * @param {string} currency - Currency (default: UGX)
 * @param {number} platformFeePercent - Platform fee % (default: 2.5)
 * @param {string} description - Transaction description
 */
router.post('/transfer', async (req, res) => {
  try {
    const {
      amount,
      senderPhone,
      recipientPhone,
      currency = 'EUR',
      platformFeePercent = 2.5,
      description = 'P2P Transfer via ICAN'
    } = req.body;

    console.log(`\n💸 P2P TRANSFER (2-STEP WORKFLOW):`);
    console.log(`   Sender: ${senderPhone}`);
    console.log(`   Recipient: ${recipientPhone}`);
    console.log(`   Amount: ${amount} ${currency}`);
    console.log(`   Platform Fee: ${platformFeePercent}%`);

    // Validate required fields
    if (!amount || !senderPhone || !recipientPhone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: amount, senderPhone, recipientPhone'
      });
    }

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive number'
      });
    }

    // Calculate fees
    const platformFee = (amount * platformFeePercent) / 100;
    const recipientAmount = amount - platformFee;

    console.log(`   💰 Breakdown:`);
    console.log(`      Sender pays: ${amount} ${currency}`);
    console.log(`      Platform fee: ${platformFee} ${currency}`);
    console.log(`      Recipient gets: ${recipientAmount} ${currency}`);

    // =====================================
    // STEP 1: COLLECT FROM SENDER
    // =====================================
    console.log(`\n📥 STEP 1: Collecting from sender...`);

    let collectionResult;
    try {
      collectionResult = await mtnMomoService.receiveMoney({
        amount: amount,
        phoneNumber: senderPhone,
        currency: currency,
        externalId: `P2P-COLLECT-${Date.now()}`,
        description: `${description} - Collection from sender`
      });

      if (!collectionResult.success) {
        throw new Error(`Collection failed: ${collectionResult.message}`);
      }

      console.log(`✅ Collection initiated successfully`);
      console.log(`   Reference ID: ${collectionResult.referenceId}`);
      console.log(`   Transaction ID: ${collectionResult.transactionId}`);
    } catch (error) {
      console.error(`❌ Collection Step Failed:`, error.message);
      return res.status(400).json({
        success: false,
        step: 'collection',
        error: `Failed to collect from sender: ${error.message}`,
        details: error.response?.data || error.message
      });
    }

    // =====================================
    // STEP 2: SEND TO RECIPIENT
    // =====================================
    console.log(`\n📤 STEP 2: Sending to recipient...`);

    let disbursementResult;
    try {
      disbursementResult = await mtnMomoService.sendMoney({
        amount: recipientAmount,
        phoneNumber: recipientPhone,
        currency: currency,
        externalId: `P2P-DISBURSE-${Date.now()}`,
        description: `${description} - Disbursement to recipient`
      });

      if (!disbursementResult.success) {
        throw new Error(`Disbursement failed: ${disbursementResult.message}`);
      }

      console.log(`✅ Disbursement initiated successfully`);
      console.log(`   Reference ID: ${disbursementResult.referenceId}`);
      console.log(`   Transaction ID: ${disbursementResult.transactionId}`);
    } catch (error) {
      console.error(`⚠️ Disbursement Step Failed:`, error.message);
      // Log this as a partial failure - collection succeeded but disbursement failed
      console.log(`⚠️ WARNING: Sender was charged but recipient didn't receive funds`);
      console.log(`   Need manual intervention to refund sender!`);

      return res.status(400).json({
        success: false,
        step: 'disbursement',
        error: `Failed to send to recipient: ${error.message}`,
        details: error.response?.data || error.message,
        warning: 'Sender was charged but recipient did not receive funds. Manual intervention required.',
        collectionSuccess: true,
        collectionReference: collectionResult.referenceId
      });
    }

    // =====================================
    // BOTH STEPS SUCCESSFUL
    // =====================================
    console.log(`\n🎉 P2P TRANSFER COMPLETE!`);

    // Log complete transaction to database
    try {
      await supabase.from('p2p_transfers').insert({
        sender_phone: senderPhone,
        recipient_phone: recipientPhone,
        original_amount: amount,
        platform_fee: platformFee,
        recipient_amount: recipientAmount,
        currency: currency,
        collection_reference: collectionResult.referenceId,
        collection_transaction_id: collectionResult.transactionId,
        disbursement_reference: disbursementResult.referenceId,
        disbursement_transaction_id: disbursementResult.transactionId,
        status: 'completed',
        created_at: new Date().toISOString()
      });
    } catch (dbError) {
      console.warn(`⚠️ Failed to log P2P transfer:`, dbError.message);
    }

    return res.status(200).json({
      success: true,
      message: 'P2P transfer completed successfully',
      step1_collection: {
        status: 'success',
        referenceId: collectionResult.referenceId,
        transactionId: collectionResult.transactionId,
        amount: amount,
        currency: currency
      },
      step2_disbursement: {
        status: 'success',
        referenceId: disbursementResult.referenceId,
        transactionId: disbursementResult.transactionId,
        amount: recipientAmount,
        currency: currency
      },
      fees: {
        platformFee: platformFee,
        platformFeePercent: platformFeePercent
      },
      summary: {
        senderPhone: senderPhone,
        recipientPhone: recipientPhone,
        senderPaid: amount,
        recipientReceived: recipientAmount,
        platformEarned: platformFee,
        currency: currency
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ P2P Transfer Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;
