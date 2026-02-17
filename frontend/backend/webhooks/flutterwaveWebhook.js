/**
 * 🪝 Flutterwave Webhook Handler
 * Receives async payment confirmations from Flutterwave
 * 
 * Setup: Add this URL to Flutterwave Dashboard > Settings > Webhooks
 * URL: https://your-api.com/api/payments/webhook
 */

import express from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

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

const FLUTTERWAVE_WEBHOOK_SECRET = process.env.FLUTTERWAVE_WEBHOOK_SECRET;

/**
 * Verify Flutterwave webhook signature
 * Ensures the webhook is actually from Flutterwave
 */
function verifyWebhookSignature(req) {
  try {
    const signature = req.headers['verif-hash'];
    
    if (!signature) {
      console.warn('⚠️ No signature in webhook');
      return false;
    }

    const hash = crypto
      .createHmac('sha256', FLUTTERWAVE_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');

    const isValid = hash === signature;
    
    if (!isValid) {
      console.error('❌ Invalid webhook signature');
    }
    
    return isValid;
  } catch (error) {
    console.error('❌ Signature verification error:', error);
    return false;
  }
}

/**
 * POST /api/payments/webhook
 * Receives webhook events from Flutterwave
 */
router.post('/webhook', async (req, res) => {
  try {
    console.log('📨 Received Flutterwave webhook');

    // Step 1: Verify webhook signature
    if (!verifyWebhookSignature(req)) {
      console.warn('⚠️ Webhook signature verification failed');
      return res.status(401).json({
        success: false,
        error: 'Invalid signature'
      });
    }

    const webhookData = req.body;
    console.log('📊 Webhook data:', {
      event: webhookData.event,
      txRef: webhookData.data?.tx_ref,
      transactionId: webhookData.data?.id,
      status: webhookData.data?.status
    });

    // Step 2: Process different webhook events
    if (webhookData.event === 'charge.completed') {
      const paymentData = webhookData.data;

      if (paymentData.status === 'successful') {
        console.log('✅ Payment confirmed via webhook');

        // Step 3: Update payment record in database
        const { error: updateError } = await supabase
          .from('payment_transactions')
          .update({
            status: 'COMPLETED',
            verification_status: 'VERIFIED_WEBHOOK',
            webhook_verified_at: new Date().toISOString(),
            raw_webhook: webhookData
          })
          .eq('flutterwave_transaction_id', paymentData.id)
          .or(`reference.eq.${paymentData.tx_ref}`);

        if (updateError) {
          console.error('❌ Failed to update payment:', updateError);
          return res.status(500).json({
            success: false,
            error: 'Failed to update payment'
          });
        }

        console.log('✅ Payment record updated via webhook');

        // Step 4: Trigger any post-payment actions
        // (e.g., send confirmation email, create user account, activate subscription)
        await handlePaymentSuccess(paymentData);

        return res.json({
          success: true,
          message: 'Webhook processed successfully'
        });
      } else {
        console.warn('⚠️ Payment not successful:', paymentData.status);

        // Update payment status to failed
        await supabase
          .from('payment_transactions')
          .update({
            status: 'FAILED',
            webhook_verified_at: new Date().toISOString()
          })
          .eq('flutterwave_transaction_id', paymentData.id);

        return res.json({
          success: true,
          message: 'Failed payment recorded'
        });
      }
    } else if (webhookData.event === 'charge.pending') {
      console.log('⏳ Payment pending');
      
      await supabase
        .from('payment_transactions')
        .update({
          status: 'PENDING',
          webhook_verified_at: new Date().toISOString()
        })
        .eq('flutterwave_transaction_id', webhookData.data.id);

      return res.json({
        success: true,
        message: 'Payment marked as pending'
      });
    } else {
      console.log('ℹ️ Unhandled webhook event:', webhookData.event);
      return res.json({
        success: true,
        message: 'Webhook acknowledged'
      });
    }
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Handle post-payment success actions
 * You can customize this based on your business logic
 */
async function handlePaymentSuccess(paymentData) {
  try {
    console.log('🎯 Processing post-payment actions for:', paymentData.customer_email);

    // Example actions:
    // 1. Send confirmation email
    // 2. Create user account if new customer
    // 3. Activate subscription
    // 4. Update user wallet balance
    // 5. Create order record

    // Find or create user profile
    if (paymentData.customer_email) {
      const { data: userProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', paymentData.customer_email)
        .single();

      if (!userProfile && !fetchError) {
        // Create new profile if doesn't exist
        await supabase
          .from('profiles')
          .insert([
            {
              email: paymentData.customer_email,
              full_name: paymentData.customer_name || 'Customer',
              phone: paymentData.customer_phone
            }
          ]);

        console.log('✅ New user profile created');
      }

      // Update wallet balance (if payment was for top-up)
      const transactionAmount = paymentData.amount_settled || paymentData.amount;
      
      await supabase.rpc('update_wallet_balance', {
        p_email: paymentData.customer_email,
        p_amount: transactionAmount,
        p_currency: paymentData.currency
      }).catch(err => {
        console.warn('⚠️ Could not update wallet balance:', err.message);
      });
    }

    console.log('✅ Post-payment actions completed');
  } catch (error) {
    console.error('❌ Post-payment action error:', error);
    // Don't throw - webhook already succeeded
  }
}

export default router;
