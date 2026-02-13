/**
 * 💰 Enhanced Trust Service with Smart Currency Conversion
 * Implements exchange rate locking and smooth coin-to-currency conversion
 */

import { supabase } from '../lib/supabase/client';
import { CountryService } from './countryService';
import icanCoinBlockchainService from './icanCoinBlockchainService';

export class EnhancedTrustService {
  /**
   * Lock exchange rate at moment of transaction
   * Used for Trust contributions, Investments, CMMS purchases
   */
  async lockExchangeRate(fromCurrency, toCurrency, txId, txType) {
    try {
      // Get current market price from blockchain
      const marketData = await icanCoinBlockchainService.getCurrentPrice();
      const marketPrice = marketData.priceUGX;

      // Lock the rate
      const lockedRateRecord = {
        tx_id: txId,
        tx_type: txType, // 'trust_contribution', 'investment', 'cmms_payment'
        from_currency: fromCurrency,
        to_currency: toCurrency,
        locked_rate: marketPrice,
        locked_at: new Date().toISOString(),
        locked_by: 'system',
        status: 'active',
        valid_duration_minutes: 30, // Rate valid for 30 minutes
        expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
        is_blockchain_verified: true,
        blockchain_source: marketData.source || 'coingecko'
      };

      // Record locked rate in database for audit trail
      const { data, error } = await supabase
        .from('exchange_rate_locks')
        .insert([lockedRateRecord])
        .select();

      if (error) {
        console.error('❌ Failed to lock exchange rate:', error);
        throw error;
      }

      console.log('✅ Exchange rate locked at:', marketPrice);
      return {
        success: true,
        lockedRate: marketPrice,
        recordId: data[0].id,
        expiresAt: lockedRateRecord.expires_at
      };
    } catch (error) {
      console.error('❌ Exchange rate lock failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Calculate conversion with locked rate
   * Ensures user sees exact amounts
   */
  calculateConversion(icanAmount, lockedRate, countryCode, txType = 'trust_contribution') {
    try {
      // Convert ICAN to local currency using locked rate
      const localAmount = CountryService.icanToLocal(
        icanAmount,
        countryCode,
        lockedRate
      );

      // Calculate fees based on transaction type
      const feeBreakdown = this.calculateFees(icanAmount, txType);

      // Net amount after fees
      const netIcan = icanAmount - feeBreakdown.total_ican;
      const netLocal = CountryService.icanToLocal(
        netIcan,
        countryCode,
        lockedRate
      );

      return {
        success: true,
        breakdown: {
          // Input
          input_ican: icanAmount,
          input_usd: localAmount / CountryService.getExchangeRate('USD'),

          // Fees
          platform_fee_ican: feeBreakdown.platform_ican,
          blockchain_fee_ican: feeBreakdown.blockchain_ican,
          smart_contract_fee_ican: feeBreakdown.smart_contract_ican || 0,
          total_fee_ican: feeBreakdown.total_ican,
          total_fee_percentage: ((feeBreakdown.total_ican / icanAmount) * 100).toFixed(2),

          // Output
          net_ican: netIcan,
          net_local: netLocal,
          net_usd: netLocal / CountryService.getExchangeRate('USD'),

          // Exchange info
          exchange_rate: lockedRate,
          currency_code: CountryService.getCurrencyCode(countryCode),
          currency_symbol: CountryService.getCurrencySymbol(countryCode),

          // Timestamp
          calculated_at: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('❌ Conversion calculation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Calculate fees for different transaction types
   */
  calculateFees(icanAmount, txType = 'trust_contribution') {
    const baseFeePercent = 0.02; // 2% base
    const baseFeeIcan = icanAmount * baseFeePercent;

    const feeStructure = {
      trust_contribution: {
        platform_ican: baseFeeIcan,
        blockchain_ican: baseFeeIcan * 0.2, // 0.4% blockchain
        smart_contract_ican: 0,
        total_ican: baseFeeIcan * 1.2
      },
      investment: {
        platform_ican: baseFeeIcan,
        blockchain_ican: baseFeeIcan * 0.2,
        smart_contract_ican: baseFeeIcan * 0.3, // 0.6% smart contract
        total_ican: baseFeeIcan * 1.5
      },
      cmms_payment: {
        platform_ican: baseFeeIcan,
        blockchain_ican: baseFeeIcan * 0.25, // 0.5% blockchain
        smart_contract_ican: baseFeeIcan * 0.1, // 0.2% audit
        total_ican: baseFeeIcan * 1.35
      }
    };

    return feeStructure[txType] || feeStructure.trust_contribution;
  }

  /**
   * Record trust contribution with conversion details
   */
  async recordTrustContributionWithConversion(contribution) {
    try {
      const supabase = this.initSupabase();
      if (!supabase) throw new Error('Supabase not available');

      const {
        groupId,
        fromUserId,
        toUserId,
        icanAmount,
        lockedRate,
        countryCode,
        exchangeRateLockId
      } = contribution;

      // Calculate conversion
      const conversion = this.calculateConversion(
        icanAmount,
        lockedRate,
        countryCode,
        'trust_contribution'
      );

      if (!conversion.success) throw new Error(conversion.error);

      const { breakdown } = conversion;

      // Insert transaction with all conversion details
      const { data, error } = await supabase
        .from('trust_transactions')
        .insert([
          {
            group_id: groupId,
            from_user_id: fromUserId,
            to_user_id: toUserId,
            
            // ICAN amounts
            ican_amount_sent: icanAmount,
            platform_fee_ican: breakdown.platform_fee_ican,
            blockchain_fee_ican: breakdown.blockchain_fee_ican,
            total_fee_ican: breakdown.total_fee_ican,
            net_ican_received: breakdown.net_ican,
            
            // Local currency amounts
            exchange_rate_locked: lockedRate,
            local_amount_received: breakdown.net_local,
            local_currency: breakdown.currency_code,
            fee_percentage: parseFloat(breakdown.total_fee_percentage),
            
            // Timestamps
            conversion_locked_at: new Date().toISOString(),
            exchange_rate_lock_id: exchangeRateLockId,
            
            // Blockchain
            status: 'pending_blockchain_recording',
            type: 'contribution',
            description: `Contribution of ${icanAmount} ICAN to trust group`
          }
        ])
        .select();

      if (error) throw error;

      // Record on blockchain
      const blockchainResult = await this.recordOnBlockchain({
        txId: data[0].id,
        txType: 'trust_contribution',
        from: fromUserId,
        to: groupId,
        amount: breakdown.net_local,
        currency: breakdown.currency_code,
        exchangeRate: lockedRate
      });

      if (blockchainResult.success) {
        // Update transaction with blockchain hash
        await supabase
          .from('trust_transactions')
          .update({
            blockchain_hash: blockchainResult.hash,
            blockchain_recorded_at: new Date().toISOString(),
            status: 'completed'
          })
          .eq('id', data[0].id);
      }

      console.log('✅ Trust contribution recorded:', {
        icanSent: icanAmount,
        localReceived: breakdown.net_local,
        feeTaken: breakdown.total_fee_ican,
        blockchainHash: blockchainResult.hash
      });

      return {
        success: true,
        transaction: data[0],
        blockchainHash: blockchainResult.hash,
        breakdown: breakdown
      };
    } catch (error) {
      console.error('❌ Failed to record trust contribution:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Record transaction on blockchain
   */
  async recordOnBlockchain(txData) {
    try {
      return await icanCoinBlockchainService.recordTransaction({
        txId: txData.txId,
        txType: txData.txType,
        from: txData.from,
        to: txData.to,
        amount: txData.amount,
        currency: txData.currency,
        exchangeRate: txData.exchangeRate,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Blockchain recording failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get transaction history with conversion details
   */
  async getTransactionHistoryWithRates(userId, limit = 50) {
    try {
      const supabase = this.initSupabase();
      if (!supabase) throw new Error('Supabase not available');

      const { data, error } = await supabase
        .from('trust_transactions')
        .select(`
          id,
          ican_amount_sent,
          total_fee_ican,
          net_ican_received,
          exchange_rate_locked,
          local_amount_received,
          local_currency,
          fee_percentage,
          conversion_locked_at,
          blockchain_hash,
          blockchain_recorded_at,
          status,
          created_at
        `)
        .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return {
        success: true,
        transactions: data || [],
        count: data?.length || 0
      };
    } catch (error) {
      console.error('❌ Failed to fetch transaction history:', error);
      return {
        success: false,
        error: error.message,
        transactions: []
      };
    }
  }

  /**
   * Initialize Supabase client
   */
  initSupabase() {
    return supabase;
  }
}

export default new EnhancedTrustService();
