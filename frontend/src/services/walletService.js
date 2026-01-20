/**
 * 💰 ICAN Wallet Service
 * Core wallet functions: Send, Receive, Top Up
 * Handles multi-currency transactions with payment method routing
 */

import momoService from './momoService';
import airtelMoneyService from './airtelMoneyService';
import flutterwaveService from './flutterwaveService';
import { walletTransactionService } from './walletTransactionService';
import { cardTransactionService } from './cardTransactionService';

class WalletService {
  constructor() {
    this.currentUser = null;
    this.balances = {};
    this.transactionHistory = [];
  }

  /**
   * Initialize wallet service with user context
   * @param {Object} user - Current user object
   * @returns {Promise<void>}
   */
  async initialize(user) {
    this.currentUser = user;
    await walletTransactionService.initialize();
    console.log('✅ Wallet Service initialized for user:', user?.id);
  }

  /**
   * ✉️ SEND MONEY - Transfer funds to another user/phone
   * @param {Object} params - Send parameters
   * @param {string} params.amount - Amount to send
   * @param {string} params.currency - Currency code (USD, KES, UGX, etc)
   * @param {string} params.recipientPhone - Recipient phone number
   * @param {string} params.description - Optional transfer description
   * @param {string} params.paymentMethod - Payment method (MOMO, Airtel, etc)
   * @returns {Promise<Object>} Transaction result
   */
  async send({ amount, currency, recipientPhone, description, paymentMethod = 'MOMO' }) {
    try {
      // Validate inputs
      if (!amount || !currency || !recipientPhone) {
        return {
          success: false,
          error: 'Missing required fields: amount, currency, recipientPhone'
        };
      }

      if (parseFloat(amount) <= 0) {
        return {
          success: false,
          error: 'Amount must be greater than 0'
        };
      }

      // Determine payment method and route accordingly
      let result;

      if (paymentMethod === 'MOMO' || paymentMethod === 'MTN' || paymentMethod === 'Vodafone') {
        // Route to MOMO service (MTN/Vodafone)
        result = await momoService.processTransfer({
          amount,
          currency,
          recipientPhone,
          description: description || `Send to ${recipientPhone}`
        });
      } else if (paymentMethod === 'Airtel') {
        // Route to Airtel Money service
        result = await airtelMoneyService.sendMoney({
          amount,
          currency,
          recipientPhone,
          description: description || `Send to ${recipientPhone}`
        });
      } else {
        return {
          success: false,
          error: `Unsupported payment method: ${paymentMethod}`
        };
      }

      // Save transaction if successful
      if (result.success) {
        await walletTransactionService.saveSend({
          amount,
          currency,
          recipientPhone,
          paymentMethod,
          transactionId: result.transactionId,
          memoKey: result.activeKey,
          mode: result.mode,
          description
        });

        console.log('✅ Send transaction completed:', {
          recipient: recipientPhone,
          amount,
          currency,
          transactionId: result.transactionId
        });
      }

      return result;
    } catch (error) {
      console.error('❌ Send error:', error);
      return {
        success: false,
        error: error.message,
        statusCode: 'SEND_ERROR'
      };
    }
  }

  /**
   * 📥 RECEIVE MONEY - Request/Accept payment from another user
   * @param {Object} params - Receive parameters
   * @param {string} params.amount - Amount to receive
   * @param {string} params.currency - Currency code (USD, KES, UGX, etc)
   * @param {string} params.senderPhone - Optional: Sender phone if known
   * @param {string} params.description - Optional description
   * @param {string} params.paymentMethod - Payment method (MOMO, Airtel, etc)
   * @returns {Promise<Object>} Payment link and reference
   */
  async receive({ amount, currency, senderPhone = 'pending', description, paymentMethod = 'MOMO' }) {
    try {
      // Validate inputs
      if (!amount || !currency) {
        return {
          success: false,
          error: 'Missing required fields: amount, currency'
        };
      }

      if (parseFloat(amount) <= 0) {
        return {
          success: false,
          error: 'Amount must be greater than 0'
        };
      }

      // Generate payment reference and link
      const paymentRef = `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      const paymentLink = `pay.ican.io/${paymentRef}`;

      // Save receive request to database
      const saveResult = await walletTransactionService.saveReceive({
        amount,
        currency,
        senderPhone,
        paymentMethod,
        transactionId: paymentRef,
        mode: 'LIVE',
        description: description || `Receive request for ${amount} ${currency}`
      });

      console.log('✅ Receive request created:', {
        amount,
        currency,
        paymentRef,
        paymentLink
      });

      return {
        success: true,
        amount,
        currency,
        paymentRef,
        paymentLink,
        description: description || `Receive request for ${amount} ${currency}`,
        message: `✅ Payment link ready! Share this with the sender: ${paymentLink}`,
        saved: saveResult.success
      };
    } catch (error) {
      console.error('❌ Receive error:', error);
      return {
        success: false,
        error: error.message,
        statusCode: 'RECEIVE_ERROR'
      };
    }
  }

  /**
   * 💳 TOP UP - Add funds to wallet via various payment methods
   * @param {Object} params - Top-up parameters
   * @param {string} params.amount - Amount to add
   * @param {string} params.currency - Currency code (USD, KES, UGX, etc)
   * @param {string} params.paymentInput - Payment input (phone, card number, etc)
   * @param {string} params.paymentMethod - Detected payment method
   * @param {Object} params.paymentDetails - Additional payment details
   * @returns {Promise<Object>} Transaction result
   */
  async topUp({ amount, currency, paymentInput, paymentMethod, paymentDetails = {} }) {
    try {
      // Validate inputs
      if (!amount || !currency || !paymentInput) {
        return {
          success: false,
          error: 'Missing required fields: amount, currency, paymentInput'
        };
      }

      if (parseFloat(amount) <= 0) {
        return {
          success: false,
          error: 'Amount must be greater than 0'
        };
      }

      let result;
      let transactionType = 'unknown';

      // Route to appropriate service based on payment method
      if (paymentMethod === 'mtn' || paymentMethod === 'vodafone') {
        // MTN/Vodafone → MOMO Service
        transactionType = 'momo';
        result = await momoService.processTopUp({
          amount,
          currency,
          phoneNumber: paymentInput,
          description: `ICAN Wallet Top-Up via ${paymentMethod.toUpperCase()}`
        });
      } else if (paymentMethod === 'airtel') {
        // Airtel Money
        transactionType = 'airtel';
        result = await airtelMoneyService.sendMoney({
          amount,
          currency,
          recipientPhone: paymentInput,
          description: `ICAN Wallet Top-Up via Airtel Money`
        });
      } else if (['visa', 'mastercard', 'verve'].includes(paymentMethod)) {
        // Credit/Debit Card → Flutterwave
        transactionType = 'card';
        await flutterwaveService.constructor.initializeSDK();
        result = await flutterwaveService.processCardPayment({
          amount,
          currency,
          customerEmail: paymentDetails.email || 'user@ican.io',
          customerName: paymentDetails.name || 'ICAN Customer',
          customerPhone: paymentDetails.phone || '',
          description: `ICAN Wallet Top-Up via ${paymentMethod.toUpperCase()}`
        });
      } else if (paymentMethod === 'ussd' || paymentMethod === 'bank') {
        // USSD / Bank Transfer → Flutterwave
        transactionType = 'flutterwave';
        result = await flutterwaveService.processCardPayment({
          amount,
          currency,
          customerEmail: paymentDetails.email || 'user@ican.io',
          customerName: paymentDetails.name || 'ICAN Customer',
          customerPhone: paymentDetails.phone || '',
          description: `ICAN Wallet Top-Up via ${paymentMethod === 'ussd' ? 'USSD' : 'Bank Transfer'}`
        });
      } else {
        return {
          success: false,
          error: `Unsupported payment method: ${paymentMethod}`
        };
      }

      // Save transaction if successful
      if (result.success) {
        if (transactionType === 'card') {
          // Card payment
          await cardTransactionService.initialize();
          await cardTransactionService.saveCardPayment({
            amount,
            currency,
            paymentMethod,
            customerEmail: paymentDetails.email || 'user@ican.io',
            customerName: paymentDetails.name || 'ICAN Customer',
            status: 'COMPLETED',
            verificationStatus: 'VERIFIED'
          });
        } else {
          // Mobile money payment
          await walletTransactionService.saveTopUp({
            amount,
            currency,
            phoneNumber: paymentInput,
            paymentMethod,
            transactionId: result.transactionId,
            memoKey: result.activeKey || 'PRIMARY',
            mode: result.mode || 'LIVE'
          });
        }

        console.log('✅ Top-up transaction completed:', {
          amount,
          currency,
          method: paymentMethod,
          transactionId: result.transactionId
        });
      }

      return result;
    } catch (error) {
      console.error('❌ Top-up error:', error);
      return {
        success: false,
        error: error.message,
        statusCode: 'TOPUP_ERROR'
      };
    }
  }

  /**
   * 💱 Get current balance for currency
   * @param {string} currency - Currency code
   * @returns {Promise<number>} Current balance
   */
  async getBalance(currency) {
    try {
      // In real implementation, fetch from Supabase
      const transactions = await walletTransactionService.getTransactions({ currency });
      
      let balance = 0;
      transactions.forEach(tx => {
        balance += parseFloat(tx.amount);
      });

      return balance;
    } catch (error) {
      console.error('❌ Error fetching balance:', error);
      return 0;
    }
  }

  /**
   * 📊 Get transaction history
   * @param {Object} options - Query options
   * @param {string} options.currency - Filter by currency
   * @param {string} options.type - Filter by type (send, receive, topup)
   * @param {number} options.limit - Number of records (default: 50)
   * @param {number} options.offset - Pagination offset (default: 0)
   * @returns {Promise<Array>} Transaction list
   */
  async getTransactionHistory(options = {}) {
    try {
      const transactions = await walletTransactionService.getTransactions(options);
      return transactions;
    } catch (error) {
      console.error('❌ Error fetching transaction history:', error);
      return [];
    }
  }

  /**
   * 🔍 Get transaction details
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Object>} Transaction details
   */
  async getTransaction(transactionId) {
    try {
      const transactions = await walletTransactionService.getTransactions({});
      const transaction = transactions.find(tx => tx.id === transactionId);
      
      if (!transaction) {
        return {
          success: false,
          error: 'Transaction not found'
        };
      }

      return {
        success: true,
        data: transaction
      };
    } catch (error) {
      console.error('❌ Error fetching transaction:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * ⚠️ Validate phone number format
   * @param {string} phone - Phone number to validate
   * @returns {boolean} Is valid
   */
  validatePhone(phone) {
    // Basic validation - at least 10 digits
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10;
  }

  /**
   * ⚠️ Validate amount
   * @param {number} amount - Amount to validate
   * @param {number} min - Minimum allowed (default: 0.01)
   * @param {number} max - Maximum allowed (default: 999999.99)
   * @returns {boolean} Is valid
   */
  validateAmount(amount, min = 0.01, max = 999999.99) {
    const num = parseFloat(amount);
    return !isNaN(num) && num >= min && num <= max;
  }

  /**
   * 📋 Format transaction for display
   * @param {Object} transaction - Transaction object
   * @returns {Object} Formatted transaction
   */
  formatTransaction(transaction) {
    const type = transaction.metadata?.transactionType || transaction.transaction_type;
    const isOutgoing = transaction.amount < 0;

    return {
      id: transaction.id,
      type,
      amount: Math.abs(parseFloat(transaction.amount)),
      currency: transaction.currency,
      date: new Date(transaction.created_at).toLocaleDateString(),
      time: new Date(transaction.created_at).toLocaleTimeString(),
      status: transaction.status?.toUpperCase() || 'COMPLETED',
      icon: type === 'send' ? '📤' : type === 'receive' ? '📥' : '💳',
      direction: isOutgoing ? 'Sent' : 'Received',
      description: transaction.description,
      ...transaction.metadata
    };
  }
}

// Export as singleton
export const walletService = new WalletService();
export default walletService;
