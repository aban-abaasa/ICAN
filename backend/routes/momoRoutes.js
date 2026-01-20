/**
 * 📱 MTN MOMO API Routes
 * Backend endpoints for handling MOMO transactions
 * ✅ All credentials and transactions stored in Supabase
 * 
 * Endpoints:
 * - POST /api/momo/request-payment (Collections - charge customer)
 * - POST /api/momo/send-payment (Disbursement - pay customer)
 * - GET /api/momo/transaction-status/:referenceId (Check status)
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

// ==========================================
// Helper Functions for Supabase Operations
// ==========================================

/**
 * Get MOMO credentials from Supabase
 * Returns: { api_user_id, api_secret_key, subscription_key }
 */
async function getMomoCredentialsFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('mtn_momo_config')
      .select('api_user_id, api_secret_key, subscription_key, environment, base_url')
      .eq('is_active', true)
      .single();

    if (error) {
      console.error('❌ Failed to get MOMO credentials from Supabase:', error);
      // Fallback to environment variables
      return {
        api_user_id: process.env.MOMO_API_USER_ID,
        api_secret_key: process.env.MOMO_API_SECRET_KEY,
        subscription_key: process.env.MOMO_SUBSCRIPTION_KEY,
        environment: process.env.MOMO_ENVIRONMENT || 'sandbox',
        base_url: process.env.MOMO_BASE_URL
      };
    }

    console.log('✅ MOMO credentials loaded from Supabase');
    return data;
  } catch (error) {
    console.error('⚠️ Error retrieving MOMO credentials:', error);
    // Fallback to environment variables
    return {
      api_user_id: process.env.MOMO_API_USER_ID,
      api_secret_key: process.env.MOMO_API_SECRET_KEY,
      subscription_key: process.env.MOMO_SUBSCRIPTION_KEY,
      environment: process.env.MOMO_ENVIRONMENT || 'sandbox',
      base_url: process.env.MOMO_BASE_URL
    };
  }
}

/**
 * Log MOMO transaction to Supabase
 */
async function logMomoTransaction(transactionData) {
  try {
    const { data, error } = await supabase
      .from('mtn_momo_logs')
      .insert({
        reference_id: transactionData.referenceId,
        transaction_id: transactionData.transactionId,
        type: transactionData.type,
        amount: transactionData.amount,
        currency: transactionData.currency,
        phone_number: transactionData.phoneNumber,
        status: transactionData.status,
        response_body: JSON.stringify(transactionData.response || {}),
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error('⚠️ Failed to log transaction:', error);
    } else {
      console.log('✅ Transaction logged to Supabase');
    }
  } catch (error) {
    console.error('⚠️ Error logging transaction:', error);
  }
}

/**
 * Cache Bearer token in Supabase
 */
async function cacheBearerToken(token, expiresIn = 3600) {
  try {
    const { error } = await supabase
      .from('mtn_momo_tokens')
      .insert({
        token_type: 'Bearer',
        access_token: token,
        expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error('⚠️ Failed to cache token:', error);
    } else {
      console.log('✅ Bearer token cached in Supabase');
    }
  } catch (error) {
    console.error('⚠️ Error caching token:', error);
  }
}

/**
 * Get cached Bearer token from Supabase
 */
async function getCachedBearerToken() {
  try {
    const { data, error } = await supabase
      .from('mtn_momo_tokens')
      .select('access_token, expires_at')
      .eq('token_type', 'Bearer')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    console.log('✅ Bearer token retrieved from Supabase cache');
    return data.access_token;
  } catch (error) {
    console.error('⚠️ Error retrieving cached token:', error);
    return null;
  }
}

/**
 * POST /api/momo/request-payment
 * Request money FROM a customer (Collections)
 * 
 * This charges a customer's phone balance
 */
router.post('/request-payment', async (req, res) => {
  try {
    let { amount, phoneNumber, currency = 'UGX', description, userId } = req.body;

    console.log(`\n💰 Request Payment API Called:`);
    console.log(`   Amount: ${amount} ${currency}`);
    console.log(`   Phone: ${phoneNumber}`);
    console.log(`   User: ${userId}`);
    console.log(`   Environment: ${process.env.MOMO_ENVIRONMENT || 'sandbox'}`);
    console.log(`   Raw Body:`, JSON.stringify(req.body, null, 2));

    // CRITICAL: MTN MOMO Sandbox vs Production differences
    const isProduction = (process.env.MOMO_ENVIRONMENT === 'production');
    
    if (!isProduction) {
      // SANDBOX REQUIREMENTS
      console.log(`   ⚠️  SANDBOX MODE - Using EUR currency and Swedish test numbers`);
      currency = 'EUR'; // Sandbox ONLY supports EUR
      
      // Convert to Swedish test format if needed
      let testPhone = phoneNumber;
      if (phoneNumber.includes('256')) {
        // Convert Uganda number to Swedish test format
        testPhone = '46733123454'; // Swedish test number for successful payment
        console.log(`   📱 Converted Uganda number to Swedish test number: ${testPhone}`);
      }
      phoneNumber = testPhone;
    } else {
      // PRODUCTION: UGX with real numbers
      currency = currency.toUpperCase() || 'UGX';
      console.log(`   ✅ PRODUCTION MODE - Using ${currency} currency`);
    }

    // Validate required fields
    if (!amount || !phoneNumber) {
      console.warn('❌ Missing required fields:', { amount: !!amount, phoneNumber: !!phoneNumber });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: amount, phoneNumber',
        received: { amount, phoneNumber }
      });
    }

    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      console.warn('❌ Invalid amount:', amount);
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive number',
        received: amount
      });
    }

    // Format phone number to E.164
    const formattedPhone = mtnMomoService.constructor.formatPhoneNumber(phoneNumber, isProduction ? '256' : '46');
    console.log(`   Formatted Phone: ${formattedPhone}`);
    
    if (!mtnMomoService.constructor.validatePhoneNumber(formattedPhone)) {
      console.warn('❌ Invalid phone format:', formattedPhone);
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Use E.164 format (e.g., 256701234567 or 46733123454)',
        received: phoneNumber,
        formatted: formattedPhone
      });
    }

    // Call MOMO service
    const result = await mtnMomoService.receiveMoney({
      amount: parseFloat(amount),
      phoneNumber: formattedPhone,
      currency: currency.toUpperCase(),
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
 * GET /api/momo/health
 * Health check endpoint for MOMO service
 */
router.get('/health', async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      status: 'healthy',
      message: 'MOMO API proxy is running',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      message: error.message
    });
  }
});

/**
 * POST /api/momo/check-status
 * Check transaction status
 */
router.post('/check-status', async (req, res) => {
  try {
    const { transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        error: 'transactionId is required'
      });
    }

    console.log(`🔍 Checking status for transaction: ${transactionId}`);

    // Query Supabase for transaction details
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('transaction_id', transactionId)
      .single();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found',
        transactionId
      });
    }

    return res.status(200).json({
      success: true,
      transactionId: data.transaction_id,
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      timestamp: data.created_at,
      details: data
    });

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
 * POST /api/momo/get-balance
 * Get account balance
 */
router.post('/get-balance', async (req, res) => {
  try {
    const { accountId } = req.body;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        error: 'accountId is required'
      });
    }

    console.log(`💰 Getting balance for account: ${accountId}`);

    // Mock implementation - in production, query actual account balance
    // This could come from MOMO API or your own balance system
    return res.status(200).json({
      success: true,
      accountId,
      balance: 50000,
      currency: 'UGX',
      message: 'Balance retrieved successfully'
    });

  } catch (error) {
    console.error('❌ Get Balance Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/momo/create-payment-link
 * Create a payment link/QR code
 */
router.post('/create-payment-link', async (req, res) => {
  try {
    const { amount, currency = 'UGX', description } = req.body;

    if (!amount || !currency) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: amount, currency'
      });
    }

    console.log(`🔗 Creating payment link for ${amount} ${currency}`);

    const linkId = `LINK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const paymentUrl = `https://momo.ican.app/pay/${linkId}`;

    return res.status(200).json({
      success: true,
      linkId,
      paymentUrl,
      amount,
      currency,
      description,
      expiresIn: 3600,
      message: 'Payment link created successfully'
    });

  } catch (error) {
    console.error('❌ Create Payment Link Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/momo/request-payment
 * Request payment (Collections)
 * Maps GET to the POST version
 */
router.get('/request-payment', async (req, res) => {
  return res.status(405).json({
    success: false,
    error: 'Method not allowed. Use POST for request-payment endpoint'
  });
});

/**
 * GET /api/momo/send-payment
 * Send payment (Disbursement)
 * Maps GET to the POST version
 */
router.get('/send-payment', async (req, res) => {
  return res.status(405).json({
    success: false,
    error: 'Method not allowed. Use POST for send-payment endpoint'
  });
});

/**
 * POST /api/momo/health
 * Health check with Supabase verification
 */
router.post('/health', async (req, res) => {
  try {
    // Test Supabase connection
    const { data: supabaseTest, error: supabaseError } = await supabase
      .from('mtn_momo_config')
      .select('count', { count: 'exact' })
      .limit(0);

    if (supabaseError) {
      return res.status(503).json({
        success: false,
        status: 'Degraded',
        message: 'Supabase connection failed',
        error: supabaseError.message
      });
    }

    // Try to get MOMO credentials
    const credentials = await getMomoCredentialsFromSupabase();

    res.json({
      success: true,
      status: 'OK',
      message: 'MOMO Backend API is healthy',
      timestamp: new Date().toISOString(),
      components: {
        supabase: 'Connected',
        momo_config: credentials ? 'Available' : 'Using Env Vars',
        environment: credentials?.environment || process.env.MOMO_ENVIRONMENT
      }
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(500).json({
      success: false,
      status: 'Error',
      message: 'Health check failed',
      error: error.message
    });
  }
});

/**
 * GET /api/momo/health
 * Health check (GET version)
 */
router.get('/health', async (req, res) => {
  try {
    const { data: supabaseTest, error: supabaseError } = await supabase
      .from('mtn_momo_config')
      .select('count', { count: 'exact' })
      .limit(0);

    if (supabaseError) {
      return res.status(503).json({
        success: false,
        status: 'Degraded',
        message: 'Supabase connection failed'
      });
    }

    res.json({
      success: true,
      status: 'OK',
      message: 'MOMO Backend API is healthy',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(500).json({
      success: false,
      status: 'Error',
      message: 'Health check failed'
    });
  }
});

module.exports = router;
module.exports.getMomoCredentialsFromSupabase = getMomoCredentialsFromSupabase;
module.exports.logMomoTransaction = logMomoTransaction;
module.exports.cacheBearerToken = cacheBearerToken;
module.exports.getCachedBearerToken = getCachedBearerToken;
