/**
 * 💰 Wallet Withdrawal Routes
 * 
 * Handles user withdrawals from ICAN Wallet to:
 * - Mobile Money (MTN, Airtel, Vodafone)
 * - Bank Accounts
 * 
 * Uses MTN MOMO Disbursement API for mobile money withdrawals
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
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
 * POST /api/withdrawals/mobile-money
 * Withdraw to Mobile Money (MTN, Airtel, Vodafone)
 * 
 * Uses MTN MOMO Disbursements API to send money to customer
 */
router.post('/mobile-money', async (req, res) => {
  try {
    const { userId, amount, phoneNumber, provider, currency } = req.body;

    console.log('\n💸 Mobile Money Withdrawal Initiated:');
    console.log(`   User: ${userId}`);
    console.log(`   Amount: ${amount} ${currency}`);
    console.log(`   Provider: ${provider}`);
    console.log(`   Phone: ${phoneNumber}`);

    // Validate required fields
    if (!userId || !amount || !phoneNumber || !provider) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, amount, phoneNumber, provider'
      });
    }

    // Validate amount
    if (isNaN(amount) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive number'
      });
    }

    // Create transaction record BEFORE processing
    const transactionId = uuidv4();

    // Check user balance first
    const { data: userWallet, error: walletError } = await supabase
      .from('wallet_accounts')
      .select('balance, currency')
      .eq('user_id', userId)
      .single();

    if (walletError) {
      console.error('❌ Wallet fetch error:', walletError);
      return res.status(404).json({
        success: false,
        error: 'User wallet not found'
      });
    }

    const userBalance = parseFloat(userWallet.balance);
    const withdrawAmount = parseFloat(amount);

    if (withdrawAmount > userBalance) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. Available: ${userBalance} ${userWallet.currency}, Requested: ${withdrawAmount}`
      });
    }

    // Calculate withdrawal fees (1-2% depending on provider)
    const feePercentage = provider === 'bank' ? 2 : 1.5;
    const fee = (withdrawAmount * feePercentage) / 100;
    const netAmount = withdrawAmount - fee;

    console.log(`   💰 Fee Calculation:`);
    console.log(`   - Gross: ${withdrawAmount}`);
    console.log(`   - Fee (${feePercentage}%): ${fee}`);
    console.log(`   - Net to recipient: ${netAmount}`);

    // Create transaction record
    const { data: transaction, error: insertError } = await supabase
      .from('transactions')
      .insert({
        id: transactionId,
        user_id: userId,
        transaction_type: 'withdrawal',
        amount: withdrawAmount,
        currency: currency,
        status: 'processing',
        description: `Withdrawal to ${provider.toUpperCase()} - ${phoneNumber}`,
        metadata: {
          initiator: 'user',
          method: 'mobile_money',
          provider_name: provider.toUpperCase(),
          phone_number: phoneNumber,
          fee: fee,
          net_amount: netAmount
        }
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Transaction insert error:', insertError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create transaction record'
      });
    }

    console.log(`✅ Transaction created: ${transactionId}`);

    try {
      // Call MTN MOMO Disbursement API
      console.log(`\n🔄 Processing through MTN MOMO Disbursement API...`);
      
      const momoResponse = await mtnMomoService.sendMoney({
        amount: netAmount,
        phoneNumber: phoneNumber,
        currency: currency,
        description: `ICAN Wallet Withdrawal - ${provider.toUpperCase()}`,
        externalId: transactionId
      });

      console.log(`✅ MOMO API Response:`, momoResponse);

      // Update transaction to completed
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          status: 'completed',
          metadata: {
            ...transaction.metadata,
            momo_ref_id: momoResponse.transactionId,
            api_response: {
              status: 'success',
              timestamp: new Date().toISOString()
            }
          }
        })
        .eq('id', transactionId);

      if (updateError) {
        console.error('❌ Status update error:', updateError);
      }

      // Update user wallet balance
      const newBalance = userBalance - withdrawAmount;
      const { error: balanceError } = await supabase
        .from('wallet_accounts')
        .update({ balance: newBalance })
        .eq('user_id', userId);

      if (balanceError) {
        console.error('⚠️  Balance update error:', balanceError);
      }

      // Log withdrawal to withdrawal_history for tracking
      await supabase
        .from('withdrawal_history')
        .insert({
          id: uuidv4(),
          user_id: userId,
          transaction_id: transactionId,
          amount: withdrawAmount,
          fee: fee,
          net_amount: netAmount,
          provider: provider,
          phone_number: phoneNumber,
          status: 'completed',
          momo_reference: momoResponse.transactionId,
          created_at: new Date().toISOString()
        });

      return res.json({
        success: true,
        message: `✅ Withdrawal successful! ${netAmount} ${currency} sent to ${phoneNumber}`,
        transaction: {
          id: transactionId,
          amount: withdrawAmount,
          fee: fee,
          netAmount: netAmount,
          status: 'completed',
          momoTransactionId: momoResponse.transactionId,
          provider: provider,
          phoneNumber: phoneNumber,
          currency: currency
        }
      });

    } catch (momoError) {
      console.error('❌ MOMO API Error:', momoError);

      // Update transaction to failed
      await supabase
        .from('transactions')
        .update({
          status: 'failed',
          metadata: {
            ...transaction.metadata,
            error: momoError.message,
            error_time: new Date().toISOString()
          }
        })
        .eq('id', transactionId);

      return res.status(400).json({
        success: false,
        error: `Withdrawal failed: ${momoError.message}`,
        transactionId: transactionId,
        details: momoError.details
      });
    }

  } catch (error) {
    console.error('❌ Withdrawal Processing Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Withdrawal processing failed: ' + error.message
    });
  }
});

/**
 * POST /api/withdrawals/bank
 * Withdraw to Bank Account
 * (For demonstration - would integrate with bank APIs in production)
 */
router.post('/bank', async (req, res) => {
  try {
    const { userId, amount, accountNumber, bankName, currency } = req.body;

    console.log('\n🏦 Bank Withdrawal Initiated:');
    console.log(`   User: ${userId}`);
    console.log(`   Amount: ${amount} ${currency}`);
    console.log(`   Bank: ${bankName}`);
    console.log(`   Account: ${accountNumber}`);

    // Validate required fields
    if (!userId || !amount || !accountNumber || !bankName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const transactionId = uuidv4();

    // Check balance
    const { data: userWallet, error: walletError } = await supabase
      .from('wallet_accounts')
      .select('balance, currency')
      .eq('user_id', userId)
      .single();

    if (walletError) {
      return res.status(404).json({
        success: false,
        error: 'User wallet not found'
      });
    }

    const userBalance = parseFloat(userWallet.balance);
    const withdrawAmount = parseFloat(amount);

    if (withdrawAmount > userBalance) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance`
      });
    }

    // Calculate bank withdrawal fees (typically 2-3%)
    const feePercentage = 2.5;
    const fee = (withdrawAmount * feePercentage) / 100;
    const netAmount = withdrawAmount - fee;

    // Create transaction record
    const { data: transaction, error: insertError } = await supabase
      .from('transactions')
      .insert({
        id: transactionId,
        user_id: userId,
        type: 'withdrawal',
        amount: withdrawAmount,
        currency: currency,
        fee: fee,
        net_amount: netAmount,
        provider: 'bank',
        account_number: accountNumber,
        bank_name: bankName,
        status: 'processing',
        metadata: {
          initiator: 'user',
          method: 'bank_transfer'
        },
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Transaction insert error:', insertError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create transaction record'
      });
    }

    // Update to pending (would be processed by bank integration)
    await supabase
      .from('transactions')
      .update({ status: 'pending' })
      .eq('id', transactionId);

    // Update user balance
    await supabase
      .from('wallet_accounts')
      .update({ balance: (userBalance - withdrawAmount).toString() })
      .eq('user_id', userId);

    // Log to withdrawal history
    await supabase
      .from('withdrawal_history')
      .insert({
        id: uuidv4(),
        user_id: userId,
        transaction_id: transactionId,
        amount: withdrawAmount,
        fee: fee,
        net_amount: netAmount,
        provider: 'bank',
        account_number: accountNumber,
        bank_name: bankName,
        status: 'pending',
        created_at: new Date().toISOString()
      });

    return res.json({
      success: true,
      message: `✅ Bank withdrawal request submitted! Your request is being processed.`,
      transaction: {
        id: transactionId,
        amount: withdrawAmount,
        fee: fee,
        netAmount: netAmount,
        status: 'pending',
        provider: 'bank',
        bankName: bankName,
        accountNumber: accountNumber,
        currency: currency,
        estimatedTime: '24-48 hours'
      }
    });

  } catch (error) {
    console.error('❌ Bank Withdrawal Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Bank withdrawal failed: ' + error.message
    });
  }
});

/**
 * GET /api/withdrawals/history/:userId
 * Get user's withdrawal history
 */
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: withdrawals, error } = await supabase
      .from('withdrawal_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('❌ Withdrawal history fetch error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch withdrawal history'
      });
    }

    return res.json({
      success: true,
      count: withdrawals.length,
      withdrawals: withdrawals
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve withdrawal history'
    });
  }
});

/**
 * GET /api/withdrawals/balance/:userId
 * Get user's current balance and withdrawal limits
 */
router.get('/balance/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: wallet, error } = await supabase
      .from('wallet_accounts')
      .select('balance, currency, user_id')
      .eq('user_id', userId)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        error: 'Wallet not found'
      });
    }

    return res.json({
      success: true,
      balance: parseFloat(wallet.balance),
      currency: wallet.currency,
      limits: {
        minWithdrawal: 100,
        maxWithdrawal: 500000,
        dailyLimit: 1000000,
        monthlyLimit: 10000000
      }
    });

  } catch (error) {
    console.error('❌ Balance fetch error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve balance'
    });
  }
});

module.exports = router;
