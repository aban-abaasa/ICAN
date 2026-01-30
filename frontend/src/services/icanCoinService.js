/**
 * 💎 ICAN Coin Service
 * Manages ICAN Coin transactions, balances, and cross-border transfers
 * Now with blockchain integration and dynamic market pricing
 * Base Rate: 5000 UGX (fluctuates based on market)
 */

import { supabase } from '../lib/supabase/client';
import { CountryService } from './countryService';
import icanCoinBlockchainService from './icanCoinBlockchainService';

export class IcanCoinService {
  constructor() {
    this.supabase = supabase;
  }

  /**
   * Initialize Supabase client
   */
  initSupabase() {
    return this.supabase;
  }

  /**
   * 🪙 Buy ICAN Coins (convert local currency to ICAN with market price)
   * Also deducts real money from user's wallet_accounts
   */
  async buyIcanCoins(userId, amount, countryCode, paymentMethod = 'card') {
    try {
      const supabase = this.initSupabase();

      // Get current market price
      const marketData = await icanCoinBlockchainService.getCurrentPrice();
      const marketPrice = marketData.priceUGX;

      // Convert local currency to ICAN using market price
      const icanAmount = CountryService.localToIcan(amount, countryCode, marketPrice);
      const currencyCode = CountryService.getCurrencyCode(countryCode);

      // DEDUCT FROM USER'S REAL WALLET
      // Get current wallet balance
      const { data: currentWallet, error: getWalletError } = await supabase
        .from('wallet_accounts')
        .select('balance')
        .eq('user_id', userId)
        .eq('currency', currencyCode)
        .maybeSingle();

      if (getWalletError) throw getWalletError;
      
      if (!currentWallet) {
        throw new Error(`No wallet found for currency: ${currencyCode}`);
      }

      const currentBalance = parseFloat(currentWallet.balance) || 0;
      if (currentBalance < amount) {
        throw new Error(`Insufficient balance. You have ${currentBalance} ${currencyCode}, need ${amount}`);
      }

      const newWalletBalance = currentBalance - amount;

      // UPDATE WALLET BALANCE
      const { error: updateWalletError } = await supabase
        .from('wallet_accounts')
        .update({ balance: newWalletBalance })
        .eq('user_id', userId)
        .eq('currency', currencyCode);

      if (updateWalletError) throw updateWalletError;

      // Create transaction record
      const { data, error } = await supabase
        .from('ican_coin_transactions')
        .insert([
          {
            user_id: userId,
            type: 'purchase',
            ican_amount: icanAmount,
            local_amount: amount,
            country_code: countryCode,
            currency: currencyCode,
            price_per_coin: marketPrice, // Store market price at time of purchase
            exchange_rate: marketPrice,
            payment_method: paymentMethod,
            status: 'completed',
            timestamp: new Date().toISOString()
          }
        ])
        .select();

      if (error) throw error;

      // Update user's ICAN balance
      const newIcanBalance = await this.updateCoinBalance(userId, icanAmount, 'add');

      console.log(`✅ Purchase complete: ${amount} ${currencyCode} → ${icanAmount.toFixed(8)} ICAN`);
      console.log(`💳 Wallet updated: ${currentBalance} → ${newWalletBalance} ${currencyCode}`);

      return {
        success: true,
        icanAmount,
        localAmount: amount,
        pricePerCoin: marketPrice,
        totalValue: icanAmount * marketPrice,
        newIcanBalance: newIcanBalance,
        newWalletBalance: newWalletBalance,
        transaction: data ? data[0] : null
      };
    } catch (error) {
      console.error('❌ Failed to buy ICAN Coins:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 💰 Sell ICAN Coins (convert ICAN to local currency at current market price)
   * Also credits real money to user's wallet_accounts
   */
  async sellIcanCoins(userId, icanAmount, countryCode) {
    try {
      const supabase = this.initSupabase();

      // Get current market price
      const marketData = await icanCoinBlockchainService.getCurrentPrice();
      const marketPrice = marketData.priceUGX;

      // Convert ICAN to local currency using market price
      const localAmount = CountryService.icanToLocal(icanAmount, countryCode, marketPrice);
      const currencyCode = CountryService.getCurrencyCode(countryCode);

      // Verify user has enough ICAN balance
      const userBalance = await this.getIcanBalance(userId);
      if (userBalance < icanAmount) {
        throw new Error(`Insufficient ICAN balance. You have ${userBalance.toFixed(8)}, need ${icanAmount.toFixed(8)}`);
      }

      // CREDIT TO USER'S REAL WALLET
      // Get current wallet balance
      const { data: currentWallet, error: getWalletError } = await supabase
        .from('wallet_accounts')
        .select('balance')
        .eq('user_id', userId)
        .eq('currency', currencyCode)
        .maybeSingle();

      if (getWalletError) throw getWalletError;
      
      if (!currentWallet) {
        throw new Error(`No wallet found for currency: ${currencyCode}`);
      }

      const currentBalance = parseFloat(currentWallet.balance) || 0;
      const newWalletBalance = currentBalance + localAmount;

      // UPDATE WALLET BALANCE
      const { error: updateWalletError } = await supabase
        .from('wallet_accounts')
        .update({ balance: newWalletBalance })
        .eq('user_id', userId)
        .eq('currency', currencyCode);

      if (updateWalletError) throw updateWalletError;

      // Create transaction record
      const { data, error } = await supabase
        .from('ican_coin_transactions')
        .insert([
          {
            user_id: userId,
            type: 'sale',
            ican_amount: icanAmount,
            local_amount: localAmount,
            country_code: countryCode,
            currency: currencyCode,
            price_per_coin: marketPrice,
            exchange_rate: marketPrice,
            status: 'completed',
            timestamp: new Date().toISOString()
          }
        ])
        .select();

      if (error) throw error;

      // Deduct from user's ICAN balance
      const newIcanBalance = await this.updateCoinBalance(userId, icanAmount, 'subtract');

      console.log(`✅ Sale complete: ${icanAmount.toFixed(8)} ICAN → ${localAmount} ${currencyCode}`);
      console.log(`💳 Wallet updated: ${currentBalance} → ${newWalletBalance} ${currencyCode}`);

      return {
        success: true,
        icanAmount,
        localAmount,
        pricePerCoin: marketPrice,
        totalValue: icanAmount * marketPrice,
        newIcanBalance: newIcanBalance,
        newWalletBalance: newWalletBalance,
        transaction: data ? data[0] : null
      };
    } catch (error) {
      console.error('❌ Failed to sell ICAN Coins:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 🌍 Send ICAN Coins across borders (NO RESTRICTIONS!)
   * Uses current market price to show value in each country
   */
  async sendIcanCoinsCrossBorder(senderUserId, recipientUserId, icanAmount, recipientCountry) {
    try {
      const supabase = this.initSupabase();

      // Verify sender has enough balance
      const senderBalance = await this.getIcanBalance(senderUserId);
      if (senderBalance < icanAmount) {
        throw new Error('Insufficient ICAN Coin balance');
      }

      // Get market price
      const marketData = await icanCoinBlockchainService.getCurrentPrice();
      const marketPrice = marketData.priceUGX;

      // Get sender's country
      const senderCountry = await this.getUserCountry(senderUserId);

      // Create transfer transaction
      const { data, error } = await supabase
        .from('ican_coin_transactions')
        .insert([
          {
            user_id: senderUserId,
            type: 'transfer_out',
            recipient_user_id: recipientUserId,
            ican_amount: icanAmount,
            from_country: senderCountry,
            to_country: recipientCountry,
            price_per_coin: marketPrice,
            status: 'completed',
            timestamp: new Date().toISOString()
          }
        ])
        .select();

      if (error) throw error;

      // Deduct from sender
      const senderNewBalance = await this.updateCoinBalance(senderUserId, icanAmount, 'subtract');

      // Add to recipient
      const recipientNewBalance = await this.updateCoinBalance(recipientUserId, icanAmount, 'add');

      // Create corresponding receive transaction for recipient
      await supabase
        .from('ican_coin_transactions')
        .insert([
          {
            user_id: recipientUserId,
            type: 'transfer_in',
            sender_user_id: senderUserId,
            ican_amount: icanAmount,
            from_country: senderCountry,
            to_country: recipientCountry,
            price_per_coin: marketPrice,
            status: 'completed',
            timestamp: new Date().toISOString()
          }
        ])
        .select();

      return {
        success: true,
        icanAmount,
        pricePerCoin: marketPrice,
        senderCountry,
        recipientCountry,
        senderNewBalance,
        recipientNewBalance,
        transaction: data ? data[0] : null,
        message: `✅ Sent ${icanAmount} ICAN (${CountryService.formatCurrency(icanAmount * marketPrice, senderCountry)}) across borders!`
      };
    } catch (error) {
      console.error('❌ Cross-border transfer failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 👤 Get user's ICAN Coin balance
   */
  async getIcanBalance(userId) {
    try {
      const supabase = this.initSupabase();

      const { data, error } = await supabase
        .from('user_accounts')
        .select('ican_coin_balance')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data?.ican_coin_balance || 0;
    } catch (error) {
      console.error('❌ Failed to get ICAN balance:', error);
      return 0;
    }
  }

  /**
   * 🔄 Update ICAN Coin balance
   */
  async updateCoinBalance(userId, amount, operation = 'add') {
    try {
      const supabase = this.initSupabase();

      // Get current balance
      const currentBalance = await this.getIcanBalance(userId);
      const newBalance = operation === 'add' 
        ? currentBalance + amount 
        : Math.max(0, currentBalance - amount);

      // Update balance
      const { error } = await supabase
        .from('user_accounts')
        .update({ ican_coin_balance: newBalance })
        .eq('user_id', userId);

      if (error) throw error;
      return newBalance;
    } catch (error) {
      console.error('❌ Failed to update ICAN balance:', error);
      return null;
    }
  }

  /**
   * 📍 Get user's country (from preferred_currency field)
   */
  async getUserCountry(userId) {
    try {
      const supabase = this.initSupabase();

      const { data, error } = await supabase
        .from('user_accounts')
        .select('country_code, preferred_currency')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      
      // Use country_code if available, otherwise map preferred_currency to country
      return data?.country_code || data?.preferred_currency || 'US';
    } catch (error) {
      console.error('❌ Failed to get user country:', error);
      return 'US';
    }
  }

  /**
   * 💵 Get ICAN Coin value in all currencies with market price
   */
  async getIcanValueMultiCurrency(icanAmount, userId) {
    try {
      const marketData = await icanCoinBlockchainService.getCurrentPrice();
      const marketPrice = marketData.priceUGX;
      const userCountry = await this.getUserCountry(userId);

      const allCurrencyValues = CountryService.getIcanValueInAllCurrencies(icanAmount, marketPrice);

      return {
        icanAmount,
        marketPrice,
        userCountry,
        userCountryValue: allCurrencyValues[CountryService.getCurrencyCode(userCountry)],
        allCurrencies: allCurrencyValues,
        percentageChange24h: marketData.percentageChange24h,
        lastUpdate: new Date()
      };
    } catch (error) {
      console.error('❌ Failed to get ICAN values:', error);
      return null;
    }
  }

  /**
   * 📊 Get ICAN transaction history
   */
  async getTransactionHistory(userId, limit = 50) {
    try {
      const supabase = this.initSupabase();

      const { data, error } = await supabase
        .from('ican_coin_transactions')
        .select('*')
        .or(`user_id.eq.${userId},sender_user_id.eq.${userId},recipient_user_id.eq.${userId}`)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('❌ Failed to get transaction history:', error);
      return [];
    }
  }

  /**
   * 💎 Get comprehensive ICAN portfolio with market data
   */
  async getPortfolioSummary(userId) {
    try {
      const balance = await this.getIcanBalance(userId);
      const countryCode = await this.getUserCountry(userId);
      const marketData = await icanCoinBlockchainService.getCurrentPrice();
      const marketPrice = marketData.priceUGX;
      
      const localValue = CountryService.icanToLocal(balance, countryCode, marketPrice);
      const currencySymbol = CountryService.getCurrencySymbol(countryCode);
      const country = CountryService.getCountry(countryCode);
      
      // Get all currency values
      const allCurrencies = CountryService.getIcanValueInAllCurrencies(balance, marketPrice);

      return {
        icanBalance: balance,
        localValue,
        currencySymbol,
        countryCode,
        countryName: country?.name,
        marketPrice,
        percentageChange24h: marketData.percentageChange24h,
        allCurrencies,
        formatted: `${currencySymbol}${localValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      };
    } catch (error) {
      console.error('❌ Failed to get portfolio summary:', error);
      return null;
    }
  }
}

export default new IcanCoinService();
