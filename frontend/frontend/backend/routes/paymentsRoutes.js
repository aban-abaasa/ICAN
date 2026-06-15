/**
 * 🔐 Flutterwave Payment Verification Routes
 * Backend verification to prevent fraudulent payments
 * 
 * Security: ALWAYS verify on server, never trust frontend!
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const router = express.Router();

// Initialize Supabase with service role key (admin access)
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

// Flutterwave API credentials
const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const FLUTTERWAVE_API_URL = 'https://api.flutterwave.com/v3';

/**
 * POST /api/payments/verify
 * Verify Flutterwave transaction
 * 
 * This is the CRITICAL security check. Never process a payment
 * without verifying it on your server first!
 */
router.get('/verify', async (req, res) => {
  try {
    const { transaction_id, reference } = req.query;
    const userId = req.user?.id; // From auth middleware

    if (!transaction_id) {
      return res.status(400).json({
        success: false,
        error: 'transaction_id is required'
      });
    }

    console.log(`🔍 Verifying Flutterwave payment: ${transaction_id}`);

    // Step 1: Call Flutterwave API to verify the transaction
    const verifyResponse = await axios.get(
      `${FLUTTERWAVE_API_URL}/transactions/${transaction_id}/verify`,
      {
        headers: {
          Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`
        }
      }
    );

    const paymentData = verifyResponse.data.data;

    console.log('📊 Flutterwave Response:', {
      status: paymentData.status,
      amount: paymentData.amount,
      currency: paymentData.currency,
      customer_email: paymentData.customer?.email
    });

    // Step 2: Validate the payment
    const isValid = 
      paymentData.status === 'successful' &&
      paymentData.amount_settled > 0;

    if (!isValid) {
      console.error('❌ Payment verification failed:', paymentData.status);
      
      // Log failed verification
      await supabase
        .from('payment_transactions')
        .insert([
          {
            flutterwave_transaction_id: transaction_id,
            reference: reference,
            user_id: userId,
            amount: paymentData.amount,
            currency: paymentData.currency,
            payment_method: paymentData.payment_type,
            status: 'FAILED',
            verification_status: 'INVALID',
            raw_response: paymentData,
            verified_at: new Date().toISOString()
          }
        ]);

      return res.redirect(
        `${process.env.FRONTEND_URL}/payment-failed?reason=verification_failed&reference=${reference}`
      );
    }

    // Step 3: Save successful payment to database
    const { data: paymentRecord, error: dbError } = await supabase
      .from('payment_transactions')
      .insert([
        {
          flutterwave_transaction_id: transaction_id,
          reference: reference,
          user_id: userId,
          amount: paymentData.amount_settled || paymentData.amount,
          currency: paymentData.currency,
          payment_method: paymentData.payment_type, // 'card', 'ussd', 'bank_transfer', etc
          customer_name: paymentData.customer?.name,
          customer_email: paymentData.customer?.email,
          customer_phone: paymentData.customer?.phone_number,
          status: 'COMPLETED',
          verification_status: 'VERIFIED',
          raw_response: paymentData,
          verified_at: new Date().toISOString()
        }
      ])
      .select();

    if (dbError) {
      console.error('❌ Database error:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Failed to save payment record'
      });
    }

    console.log('✅ Payment verified and saved:', paymentRecord[0]);

    // Step 4: Redirect to success page with order details
    const successUrl = `${process.env.FRONTEND_URL}/payment-success?reference=${reference}&amount=${paymentData.amount}&currency=${paymentData.currency}`;
    
    return res.redirect(successUrl);

  } catch (error) {
    console.error('❌ Verification error:', error.message);

    // Log verification error
    if (req.user?.id) {
      await supabase
        .from('payment_transactions')
        .insert([
          {
            reference: req.query.reference,
            user_id: req.user.id,
            status: 'FAILED',
            verification_status: 'ERROR',
            error_message: error.message,
            verified_at: new Date().toISOString()
          }
        ])
        .catch(err => console.error('Failed to log error:', err));
    }

    return res.redirect(
      `${process.env.FRONTEND_URL}/payment-failed?reason=verification_error`
    );
  }
});

/**
 * GET /api/payments/status/:reference
 * Check payment status
 */
router.get('/status/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user?.id;

    const { data, error } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('reference', reference)
      .eq('user_id', userId)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        error: 'Payment record not found'
      });
    }

    return res.json({
      success: true,
      data: {
        reference: data.reference,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        verified: data.verification_status === 'VERIFIED',
        timestamp: data.verified_at
      }
    });
  } catch (error) {
    console.error('❌ Status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
