/**
 * ⛓️ ICAN Coin Blockchain & Market Price Service
 * Tracks real-time market price and blockchain transactions
 * Integrates with smart contract for decentralized price discovery
 */

import { supabase } from '../lib/supabase/client';

export class IcanCoinBlockchainService {
  constructor() {
    this.supabase = supabase;
    this.marketPrice = 5000; // Default: 5000 UGX
    this.priceHistory = [];
    this.lastUpdate = null;
  }

  /**
   * Initialize Supabase client
   */
  initSupabase() {
    return this.supabase;
  }

  /**
   * 📊 Get current ICAN Coin market price (UGX)
   * Live — computed on read by the same USD-anchored fair-price engine
   * (ican_get_market_snapshot → ican_compute_fair_price) that powers
   * PitchinLiveShareValue's "IcanEra — Live Market" ticker, so buy/sell/
   * portfolio/transfer all move the moment usage or FX rates change instead
   * of waiting on a dev to click "Apply Price". Falls back to the last
   * cached snapshot if the live engine RPC isn't reachable.
   */
  async getCurrentPrice() {
    try {
      const supabase = this.initSupabase();

      const { data: liveData, error: liveError } = await supabase.rpc('ican_get_market_snapshot');

      if (!liveError && liveData?.[0]) {
        //🔧 SANITY CHECK: Ensure price_ugx is reasonable (minimum 1000 UGX)
        let priceUGX = liveData[0].price_ugx;
        if (priceUGX < 1000) {
          console.warn(`⚠️ PRICE CORRECTION: Live engine returned price_ugx=${priceUGX} (too low!), using safe default 5000`);
          priceUGX = 5000;
        }

        this.marketPrice = priceUGX;
        this.lastUpdate = new Date();

        return {
          priceUGX,
          percentageChange24h: liveData[0].appreciation_pct || 0,
          marketCap: null,
          source: 'live_engine'
        };
      }

      if (liveError) {
        console.warn('Live price engine unavailable, falling back to cached snapshot:', liveError.message);
      }

      // Fallback: last snapshot written to ican_coin_market_prices
      // (e.g. by ican_apply_computed_price via the Dev Panel)
      const { data, error } = await supabase
        .from('ican_coin_market_prices')
        .select('price_ugx, percentage_change_24h, market_cap')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        console.warn('Using default price, blockchain not available:', error.message);
        return {
          priceUGX: 5000,
          percentageChange24h: 0,
          marketCap: null,
          source: 'default'
        };
      }

      //🔧 SANITY CHECK: Ensure price_ugx is reasonable (minimum 1000 UGX)
      // If price is abnormally low (< 1000), it's likely a data entry error
      let priceUGX = data.price_ugx;
      if (priceUGX < 1000) {
        console.warn(`⚠️ PRICE CORRECTION: Database had price_ugx=${priceUGX} (too low!), using safe default 5000`);
        priceUGX = 5000;
      }

      this.marketPrice = priceUGX;
      this.lastUpdate = new Date();

      return {
        priceUGX: priceUGX,
        percentageChange24h: data.percentage_change_24h || 0,
        marketCap: data.market_cap,
        source: 'blockchain'
      };
    } catch (error) {
      console.error('❌ Failed to get current price:', error);
      return {
        priceUGX: 5000,
        percentageChange24h: 0,
        source: 'default'
      };
    }
  }

  /**
   * 💰 Calculate real ICAN Coin value with market price
   */
  async calculateIcanValue(icanAmount) {
    const priceData = await this.getCurrentPrice();
    return {
      icanAmount,
      pricePerCoin: priceData.priceUGX,
      totalValueUGX: icanAmount * priceData.priceUGX,
      percentageChange24h: priceData.percentageChange24h,
      source: priceData.source
    };
  }

  /**
   * 📈 Get price history for chart
   */
  async getPriceHistory(period = '7d') { // '1h', '24h', '7d', '30d'
    try {
      const supabase = this.initSupabase();

      const periodMap = {
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000
      };

      const startTime = new Date(Date.now() - periodMap[period]).toISOString();

      const { data, error } = await supabase
        .from('ican_coin_market_prices')
        .select('timestamp, price_ugx, volume, market_cap')
        .gte('timestamp', startTime)
        .order('timestamp', { ascending: true });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('❌ Failed to get price history:', error);
      return [];
    }
  }

  /**
   * 📝 Record blockchain transaction (buy/sell/transfer)
   */
  async recordBlockchainTransaction(txData) {
    try {
      const supabase = this.initSupabase();

      const { data, error } = await supabase
        .from('ican_coin_blockchain_txs')
        .insert([
          {
            user_id: txData.userId,
            tx_hash: txData.txHash, // Blockchain tx hash
            tx_type: txData.type, // 'buy', 'sell', 'transfer', 'staking'
            ican_amount: txData.icanAmount,
            price_per_coin: txData.pricePerCoin,
            total_value_ugx: txData.totalValueUGX,
            contract_address: txData.contractAddress,
            from_address: txData.fromAddress,
            to_address: txData.toAddress,
            gas_used: txData.gasUsed,
            block_number: txData.blockNumber,
            timestamp: new Date().toISOString()
          }
        ]);

      if (error) throw error;
      return { success: true, transaction: data[0] };
    } catch (error) {
      console.error('❌ Failed to record blockchain transaction:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 🔗 Connect wallet to ICAN Coin system
   */
  async connectWallet(userId, walletAddress, walletType = 'ethereum') {
    try {
      const supabase = this.initSupabase();

      const { data, error } = await supabase
        .from('user_profiles')
        .update({
          blockchain_wallet_address: walletAddress,
          blockchain_wallet_type: walletType, // 'ethereum', 'solana', 'polygon', etc.
          blockchain_connected: true
        })
        .eq('id', userId)
        .select();

      if (error) throw error;
      return { success: true, wallet: data[0] };
    } catch (error) {
      console.error('❌ Failed to connect wallet:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 💎 Stake ICAN Coins for yield
   */
  async stakeIcanCoins(userId, icanAmount, stakingPeriod = '30days') {
    try {
      const supabase = this.initSupabase();
      const priceData = await this.getCurrentPrice();

      const { data, error } = await supabase
        .from('ican_coin_staking')
        .insert([
          {
            user_id: userId,
            ican_amount: icanAmount,
            value_ugx_at_stake: icanAmount * priceData.priceUGX,
            staking_period: stakingPeriod,
            apy: this.calculateAPY(stakingPeriod), // Annual Percentage Yield
            status: 'active',
            started_at: new Date().toISOString(),
            claimed: false
          }
        ]);

      if (error) throw error;

      // Deduct from balance
      await this.deductBalance(userId, icanAmount);

      return { success: true, stake: data[0] };
    } catch (error) {
      console.error('❌ Failed to stake ICAN Coins:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 📊 Calculate APY based on staking period
   */
  calculateAPY(period) {
    const apyMap = {
      '7days': 12, // 12% APY for 7 days
      '30days': 24, // 24% APY for 30 days
      '90days': 48, // 48% APY for 90 days
      '365days': 120 // 120% APY for 1 year
    };
    return apyMap[period] || 24;
  }

  /**
   * 🎁 Claim staking rewards
   */
  async claimStakingRewards(userId, stakeId) {
    try {
      const supabase = this.initSupabase();

      // Get stake details
      const { data: stake, error: fetchError } = await supabase
        .from('ican_coin_staking')
        .select('*')
        .eq('id', stakeId)
        .eq('user_id', userId)
        .single();

      if (fetchError) throw fetchError;
      if (stake.claimed) throw new Error('Rewards already claimed');

      // Calculate rewards
      const periodDays = this.getDaysDifference(stake.started_at);
      const dailyRate = stake.apy / 365;
      const rewards = stake.ican_amount * (dailyRate / 100) * periodDays;

      // Update stake as claimed
      await supabase
        .from('ican_coin_staking')
        .update({ claimed: true, claimed_at: new Date().toISOString() })
        .eq('id', stakeId);

      // Add rewards to balance
      await this.addBalance(userId, stake.ican_amount + rewards);

      return {
        success: true,
        originalAmount: stake.ican_amount,
        rewards,
        total: stake.ican_amount + rewards
      };
    } catch (error) {
      console.error('❌ Failed to claim rewards:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 📋 Get user's staking portfolio
   */
  async getStakingPortfolio(userId) {
    try {
      const supabase = this.initSupabase();

      const { data, error } = await supabase
        .from('ican_coin_staking')
        .select('*')
        .eq('user_id', userId)
        .order('started_at', { ascending: false });

      if (error) throw error;

      let totalStaked = 0;
      let totalRewards = 0;

      data.forEach(stake => {
        totalStaked += stake.ican_amount;
        if (!stake.claimed) {
          const periodDays = this.getDaysDifference(stake.started_at);
          const dailyRate = stake.apy / 365;
          totalRewards += stake.ican_amount * (dailyRate / 100) * periodDays;
        }
      });

      return {
        stakes: data,
        totalStaked,
        totalRewards,
        totalValue: totalStaked + totalRewards
      };
    } catch (error) {
      console.error('❌ Failed to get staking portfolio:', error);
      return { stakes: [], totalStaked: 0, totalRewards: 0 };
    }
  }

  /**
   * Helper: Deduct from balance
   */
  async deductBalance(userId, amount) {
    const supabase = this.initSupabase();
    const { data } = await supabase
      .from('user_profiles')
      .select('ican_coin_balance')
      .eq('id', userId)
      .single();

    await supabase
      .from('user_profiles')
      .update({ ican_coin_balance: data.ican_coin_balance - amount })
      .eq('id', userId);
  }

  /**
   * Helper: Add to balance
   */
  async addBalance(userId, amount) {
    const supabase = this.initSupabase();
    const { data } = await supabase
      .from('user_profiles')
      .select('ican_coin_balance')
      .eq('id', userId)
      .single();

    await supabase
      .from('user_profiles')
      .update({ ican_coin_balance: data.ican_coin_balance + amount })
      .eq('id', userId);
  }

  /**
   * Helper: Calculate days difference
   */
  getDaysDifference(startDate) {
    const start = new Date(startDate);
    const now = new Date();
    return Math.floor((now - start) / (1000 * 60 * 60 * 24));
  }
}

export default new IcanCoinBlockchainService();
