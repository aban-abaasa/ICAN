/**
 * 📈 Candlestick Service
 * Manages OHLC data collection and candlestick generation
 */

import { supabase } from '../lib/supabase/client';

class CandlestickService {
  constructor() {
    this.supabase = supabase;
    this.priceBuffer = []; // Buffer to collect prices
    this.currentCandle = null;
    this.lastCandleTime = null;
  }

  /**
   * Initialize and start collecting price data
   */
  initSupabase() {
    return this.supabase;
  }

  /**
   * 📊 Get historical candlestick data
   */
  async getCandleData(timeframe = '7s', limit = 100) {
    try {
      const supabase = this.initSupabase();

      const { data, error } = await supabase
        .from('ican_price_ohlc')
        .select('*')
        .eq('timeframe', timeframe)
        .order('open_time', { ascending: false })
        .limit(limit);

      if (error) throw error;
      
      console.log(`✅ Fetched ${data?.length || 0} candlesticks`);
      return data || [];
    } catch (error) {
      console.error('❌ Failed to fetch candle data:', error);
      return [];
    }
  }

  /**
   * 💾 Add a new candlestick to database
   */
  async createCandle(openPrice, highPrice, lowPrice, closePrice, volume = 0, transactionCount = 0) {
    try {
      const supabase = this.initSupabase();
      const now = new Date();
      const openTime = new Date(now.getTime() - 7000); // 7 seconds ago

      const { data, error } = await supabase
        .from('ican_price_ohlc')
        .insert([
          {
            open_price: openPrice,
            high_price: highPrice,
            low_price: lowPrice,
            close_price: closePrice,
            trading_volume: volume,
            transaction_count: transactionCount,
            timeframe: '7s',
            open_time: openTime.toISOString(),
            close_time: now.toISOString(),
            created_at: now.toISOString()
          }
        ])
        .select();

      if (error) throw error;
      
      console.log(`✅ Candlestick created: O:${openPrice} H:${highPrice} L:${lowPrice} C:${closePrice}`);
      return data ? data[0] : null;
    } catch (error) {
      console.error('❌ Failed to create candle:', error);
      return null;
    }
  }

  /**
   * 📈 Generate candle from price buffer (for real-time data)
   */
  async generateCandleFromPrices(prices) {
    if (!prices || prices.length === 0) return null;

    const sortedPrices = prices.map(p => parseFloat(p)).sort((a, b) => a - b);
    
    const candle = {
      open: prices[0],
      high: sortedPrices[sortedPrices.length - 1],
      low: sortedPrices[0],
      close: prices[prices.length - 1],
      volume: prices.length
    };

    return candle;
  }

  /**
   * 🔄 Update price buffer with new price
   */
  addPriceToBuffer(price) {
    this.priceBuffer.push(price);
    
    // Keep buffer from getting too large
    if (this.priceBuffer.length > 1000) {
      this.priceBuffer.shift();
    }

    return this.priceBuffer;
  }

  /**
   * 🎯 Get latest candle data for display
   */
  async getLatestCandles(limit = 50) {
    try {
      const supabase = this.initSupabase();
      
      const { data, error } = await supabase
        .from('ican_price_ohlc')
        .select('*')
        .eq('timeframe', '7s')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      
      return (data || []).reverse(); // Reverse to get chronological order
    } catch (error) {
      console.error('❌ Failed to get latest candles:', error);
      return [];
    }
  }

  /**
   * 📊 Aggregate candles for different timeframes
   */
  async aggregateCandles(sourceTimeframe = '7s', targetTimeframe = '1m') {
    try {
      const supabase = this.initSupabase();

      // Get source candles
      const { data: candles, error } = await supabase
        .from('ican_price_ohlc')
        .select('*')
        .eq('timeframe', sourceTimeframe)
        .order('open_time', { ascending: true })
        .limit(10); // Get 10 of 7s candles = ~70s of data

      if (error) throw error;

      if (!candles || candles.length === 0) return null;

      // Aggregate to target timeframe
      const aggregated = {
        open_price: parseFloat(candles[0].open_price),
        high_price: Math.max(...candles.map(c => parseFloat(c.high_price))),
        low_price: Math.min(...candles.map(c => parseFloat(c.low_price))),
        close_price: parseFloat(candles[candles.length - 1].close_price),
        trading_volume: candles.reduce((sum, c) => sum + (parseFloat(c.trading_volume) || 0), 0),
        transaction_count: candles.reduce((sum, c) => sum + (c.transaction_count || 0), 0),
        timeframe: targetTimeframe,
        open_time: candles[0].open_time,
        close_time: candles[candles.length - 1].close_time
      };

      return aggregated;
    } catch (error) {
      console.error('❌ Failed to aggregate candles:', error);
      return null;
    }
  }

  /**
   * 🔍 Get candle stats for analysis
   */
  async getCandleStats(limit = 50) {
    try {
      const candles = await this.getLatestCandles(limit);
      
      if (candles.length === 0) return null;

      const closes = candles.map(c => parseFloat(c.close_price));
      const opens = candles.map(c => parseFloat(c.open_price));
      const highs = candles.map(c => parseFloat(c.high_price));
      const lows = candles.map(c => parseFloat(c.low_price));

      const avgClose = closes.reduce((a, b) => a + b, 0) / closes.length;
      const avgVolume = candles.reduce((sum, c) => sum + (parseFloat(c.trading_volume) || 0), 0) / candles.length;

      const upCandles = candles.filter(c => parseFloat(c.close_price) > parseFloat(c.open_price)).length;
      const downCandles = candles.filter(c => parseFloat(c.close_price) < parseFloat(c.open_price)).length;

      return {
        avgClose,
        avgVolume,
        highPrice: Math.max(...highs),
        lowPrice: Math.min(...lows),
        upCandles,
        downCandles,
        totalCandles: candles.length,
        volatility: (Math.max(...highs) - Math.min(...lows)) / avgClose,
        priceChange: closes[closes.length - 1] - closes[0],
        priceChangePercent: ((closes[closes.length - 1] - closes[0]) / closes[0] * 100)
      };
    } catch (error) {
      console.error('❌ Failed to calculate stats:', error);
      return null;
    }
  }

  /**
   * 🧹 Clean old candlestick data (keep last 1000)
   */
  async cleanOldData() {
    try {
      const supabase = this.initSupabase();
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      const { error } = await supabase
        .from('ican_price_ohlc')
        .delete()
        .lt('created_at', thirtyMinutesAgo)
        .eq('timeframe', '7s');

      if (error) throw error;
      console.log('🧹 Old candlestick data cleaned');
    } catch (error) {
      console.error('❌ Failed to clean old data:', error);
    }
  }
}

export default new CandlestickService();
