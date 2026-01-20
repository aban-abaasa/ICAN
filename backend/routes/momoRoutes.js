/**
 * 📱 MTN MOMO API Routes
 * Backend endpoints for handling MOMO transactions
 * 
 * Endpoints:
 * - POST /api/momo/request-payment (Collections - charge customer)
 * - POST /api/momo/send-payment (Disbursement - pay customer)
 * - GET /api/momo/transaction-status/:referenceId (Check status)
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import mtnMomoService from '../services/mtnMomoService.js';

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
 * POST /api/momo/request-payment
 * Request money FROM a customer (Collections)
 * 
 * This charges a customer's phone balance
 */
router.post('/request-payment', async (req, res) => {
  try {
    const { amount, phoneNumber, currency = 'UGX', description, userId } = req.body;

    console.log(`\n💰 Request Payment API Called:`);
    console.log(`   Amount: ${amount} ${currency}`);
    console.log(`   Phone: ${phoneNumber}`);
    console.log(`   User: ${userId}`);

    // Validate required fields
    if (!amount || !phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: amount, phoneNumber'
      });
    }

    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive number'
      });
    }

    // Format phone number to E.164
    const formattedPhone = mtnMomoService.constructor.formatPhoneNumber(phoneNumber);
    
    if (!mtnMomoService.constructor.validatePhoneNumber(formattedPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Use E.164 format (e.g., 256701234567)'
      });
    }

    // Call MOMO service
    const result = await mtnMomoService.receiveMoney({
      amount: parseFloat(amount),
      phoneNumber: formattedPhone,
      currency,
      description: description || 'ICAN Wallet Top-Up'
    });

    if (result.success) {
      // Save transaction to database
      try {
        const { data, error: dbError } = await supabase
          .from('wallet_transactions')
          .insert({
            user_id: userId,
            type: 'collection',
            amount: parseFloat(amount),
            currency,
            phone_number: formattedPhone,
            reference_id: result.referenceId,
            transaction_id: result.transactionId,
            status: 'pending',
            provider: 'mtn_momo',
            description: description || 'ICAN Wallet Top-Up',
            created_at: new Date().toISOString()
          });

        if (dbError) {
          console.error('Database error:', dbError);
          // Still return success to MOMO, but log the DB error
        }
      } catch (dbErr) {
        console.error('Failed to save transaction:', dbErr);
      }

      return res.status(200).json({
        success: true,
        message: 'Collection request sent successfully',
        transactionId: result.transactionId,
        referenceId: result.referenceId,
        amount: result.amount,
        currency: result.currency,
        phoneNumber: result.phoneNumber,
        status: result.status,
        timestamp: result.timestamp
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
        details: result.details
      });
    }

  } catch (error) {
    console.error('❌ Request Payment Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/momo/send-payment
 * Send money TO a customer (Disbursement)
 * 
 * This sends funds to a customer's phone balance
 */
router.post('/send-payment', async (req, res) => {
  try {
    const { amount, phoneNumber, currency = 'UGX', description, userId } = req.body;

    console.log(`\n📤 Send Payment API Called:`);
    console.log(`   Amount: ${amount} ${currency}`);
    console.log(`   Phone: ${phoneNumber}`);
    console.log(`   User: ${userId}`);

    // Validate required fields
    if (!amount || !phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: amount, phoneNumber'
      });
    }

    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive number'
      });
    }

    // Format phone number to E.164
    const formattedPhone = mtnMomoService.constructor.formatPhoneNumber(phoneNumber);
    
    if (!mtnMomoService.constructor.validatePhoneNumber(formattedPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Use E.164 format (e.g., 256701234567)'
      });
    }

    // Call MOMO service
    const result = await mtnMomoService.sendMoney({
      amount: parseFloat(amount),
      phoneNumber: formattedPhone,
      currency,
      description: description || 'Payment from ICAN'
    });

    if (result.success) {
      // Save transaction to database
      try {
        const { data, error: dbError } = await supabase
          .from('wallet_transactions')
          .insert({
            user_id: userId,
            type: 'disbursement',
            amount: parseFloat(amount),
            currency,
            phone_number: formattedPhone,
            reference_id: result.referenceId,
            transaction_id: result.transactionId,
            status: 'completed',
            provider: 'mtn_momo',
            description: description || 'Payment from ICAN',
            created_at: new Date().toISOString()
          });

        if (dbError) {
          console.error('Database error:', dbError);
        }
      } catch (dbErr) {
        console.error('Failed to save transaction:', dbErr);
      }

      return res.status(200).json({
        success: true,
        message: 'Payment sent successfully',
        transactionId: result.transactionId,
        referenceId: result.referenceId,
        amount: result.amount,
        currency: result.currency,
        phoneNumber: result.phoneNumber,
        status: result.status,
        timestamp: result.timestamp
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
        details: result.details
      });
    }

  } catch (error) {
    console.error('❌ Send Payment Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/momo/transaction-status/:referenceId
 * Check the status of a transaction
 */
router.get('/transaction-status/:referenceId', async (req, res) => {
  try {
    const { referenceId } = req.params;
    const { type = 'collection' } = req.query;

    if (!referenceId) {
      return res.status(400).json({
        success: false,
        error: 'referenceId is required'
      });
    }

    console.log(`🔍 Checking status for: ${referenceId}`);

    const result = await mtnMomoService.getTransactionStatus(referenceId, type);

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }

  } catch (error) {
    console.error('❌ Status Check Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/momo/webhook
 * Handle MOMO payment notifications/callbacks
 * 
 * Called by MTN MOMO when payment status changes
 */
router.post('/webhook', async (req, res) => {
  try {
    const { referenceId, status, transactionId, amount } = req.body;

    console.log(`📨 MOMO Webhook Received:`, {
      referenceId,
      status,
      transactionId,
      amount
    });

    // Verify webhook signature (implement based on MTN docs)
    // const isValid = verifyWebhookSignature(req);
    // if (!isValid) return res.status(401).json({ error: 'Unauthorized' });

    // Update transaction status in database
    try {
      const { data, error } = await supabase
        .from('wallet_transactions')
        .update({
          status: status,
          updated_at: new Date().toISOString()
        })
        .eq('reference_id', referenceId);

      if (error) {
        console.error('Failed to update transaction:', error);
      }
    } catch (dbErr) {
      console.error('Database error:', dbErr);
    }

    // Return 200 OK to acknowledge receipt
    res.status(200).json({
      success: true,
      message: 'Webhook processed'
    });

  } catch (error) {
    console.error('❌ Webhook Error:', error);
    // Still return 200 to prevent MTN from retrying
    res.status(200).json({
      success: false,
      message: 'Webhook processed with error'
    });
  }
});

export default router;
