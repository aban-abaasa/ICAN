// Velocity Engine - Pillar I: Financial Capital
// Transform volatile cash flow into structured wealth metrics

import { getSupabaseClient } from '../lib/supabase/client.js';

export class VelocityEngine {
  constructor(userId) {
    this.userId = userId;
    this.transactions = [];
    this.listeners = [];
    this.supabase = getSupabaseClient();
  }

  // Natural Language Processing for transaction input
  async parseTransactionInput(input) {
    const text = input.toLowerCase().trim();
    
    // Extract amount using regex
    const amountMatch = text.match(/(\d{1,3}(?:,\d{3})*|\d+)/);
    const amount = amountMatch ? parseFloat(amountMatch[0].replace(/,/g, '')) : 0;

    // Determine transaction type
    const incomeKeywords = ['income', 'earn', 'earned', 'receive', 'received', 'paid', 'salary', 'fare', 'tip', 'bonus', 'profit'];
    const expenseKeywords = ['expense', 'spend', 'spent', 'cost', 'buy', 'bought', 'purchase', 'purchased', 'pay', 'bill'];
    
    let type = 'income'; // default
    if (incomeKeywords.some(keyword => text.includes(keyword))) {
      type = 'income';
    } else if (expenseKeywords.some(keyword => text.includes(keyword))) {
      type = 'expense';
    }

    // Extract category
    const category = this.extractCategory(text);
    
    // Extract description (clean up the input)
    const description = this.cleanDescription(input);

    return {
      id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      amount,
      type,
      description,
      category,
      date: new Date().toISOString(),
      source: 'manual_input',
      currency: 'UGX'
    };
  }

  // Category extraction based on keywords
  extractCategory(text) {
    const categories = {
      'transport': ['boda', 'taxi', 'fuel', 'transport', 'bus', 'matatu', 'uber', 'bolt'],
      'food': ['food', 'lunch', 'dinner', 'breakfast', 'eat', 'restaurant', 'coffee', 'snack'],
      'business': ['business', 'client', 'service', 'work', 'project', 'contract', 'meeting'],
      'utilities': ['electricity', 'water', 'rent', 'bill', 'internet', 'phone', 'airtime'],
      'health': ['hospital', 'clinic', 'medicine', 'doctor', 'pharmacy', 'medical'],
      'education': ['school', 'course', 'training', 'book', 'education', 'fees'],
      'entertainment': ['movie', 'music', 'game', 'party', 'club', 'fun'],
      'shopping': ['shop', 'clothes', 'shoes', 'market', 'grocery', 'supermarket'],
      'savings': ['save', 'bank', 'investment', 'deposit', 'account'],
      'family': ['family', 'children', 'spouse', 'parent', 'relative', 'support']
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return category;
      }
    }
    
    return 'other';
  }

  // Clean description for better readability
  cleanDescription(input) {
    return input
      .replace(/^\s*(income|expense)\s*/i, '') // Remove leading type indicators
      .replace(/\d{1,3}(?:,\d{3})*/, '') // Remove numbers
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      || 'Transaction'; // Fallback description
  }

  // Add transaction to Supabase
  async addTransaction(transactionData) {
    try {
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      const { data, error } = await this.supabase
        .from('ican_transactions')
        .insert([
          {
            user_id: this.userId,
            amount: transactionData.amount,
            transaction_type: transactionData.type,
            description: transactionData.description,
            currency: transactionData.currency || 'UGX',
            status: 'completed',
            metadata: {
              category: transactionData.category,
              source: transactionData.source,
              originalDate: transactionData.date
            }
          }
        ])
        .select()
        .single();

      if (error) {
        console.error('Error adding transaction to Supabase:', error);
        return { success: false, error };
      }

      // Update local cache
      this.transactions.unshift(data);
      this.notifyListeners();
      return { success: true, transaction: data };
    } catch (error) {
      console.error('Error adding transaction:', error);
      return { success: false, error };
    }
  }

  // Load user transactions from Supabase
  async loadTransactions() {
    try {
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      console.log(`🔍 VelocityEngine: Loading transactions for user ${this.userId}`);
      const { data, error } = await this.supabase
        .from('ican_transactions')
        .select('*')
        .eq('user_id', this.userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('VelocityEngine: Error loading transactions from Supabase:', error);
        return { success: false, error };
      }

      console.log(`📊 VelocityEngine: Found ${data?.length || 0} transactions for user ${this.userId}`);
      this.transactions = data || [];
      this.notifyListeners();
      return { success: true, data: this.transactions };
    } catch (error) {
      console.error('VelocityEngine: Error loading transactions:', error);
      return { success: false, error };
    }
  }

  // Subscribe to real-time transaction updates
  // Subscribe to real-time transaction updates
  subscribeToUpdates(callback) {
    if (!this.supabase) {
      console.error('Supabase client not initialized for subscriptions');
      return () => {}; // Return empty unsubscribe function
    }

    // Subscribe to real-time changes in the transactions table
    const subscription = this.supabase
      .channel(`transactions:${this.userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions',
          filter: `user_id=eq.${this.userId}`
        },
        (payload) => {
          console.log('📊 Transaction update received:', payload);
          if (payload.eventType === 'INSERT') {
            this.transactions.unshift(payload.new);
          } else if (payload.eventType === 'UPDATE') {
            const idx = this.transactions.findIndex(t => t.id === payload.new.id);
            if (idx !== -1) this.transactions[idx] = payload.new;
          } else if (payload.eventType === 'DELETE') {
            this.transactions = this.transactions.filter(t => t.id !== payload.old.id);
          }
          this.notifyListeners();
          callback(this.transactions);
        }
      )
      .subscribe();

    // Return unsubscribe function
    return () => {
      this.supabase.removeChannel(subscription);
    };
  }

  // Notify all listeners of data changes
  notifyListeners() {
    // Calculate metrics and notify
    const metrics = this.calculateMetrics();
    this.listeners.forEach(listener => {
      if (typeof listener === 'function') {
        listener(metrics);
      }
    });
  }

  // Calculate financial metrics
  calculateMetrics() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // Basic calculations
    const totalIncome = this.transactions
      .filter(t => t.transaction_type === 'income')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const totalExpenses = this.transactions
      .filter(t => t.transaction_type === 'expense')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const netWorth = totalIncome - totalExpenses;

    // Period-specific calculations
    const periods = {
      daily: { days: 1, cutoff: oneDayAgo },
      weekly: { days: 7, cutoff: sevenDaysAgo },
      monthly: { days: 30, cutoff: thirtyDaysAgo },
      yearly: { days: 365, cutoff: oneYearAgo }
    };

    const periodMetrics = {};
    Object.entries(periods).forEach(([periodName, config]) => {
      const periodTransactions = this.transactions.filter(t => new Date(t.created_at) > config.cutoff);
      const periodIncome = periodTransactions
        .filter(t => t.transaction_type === 'income')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      const periodExpenses = periodTransactions
        .filter(t => t.transaction_type === 'expense')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      
      // Calculate ROI: (Net Profit / Investment) * 100
      // We'll use expenses as "investment" and income as "return"
      const periodROI = periodExpenses > 0 ? ((periodIncome - periodExpenses) / periodExpenses) * 100 : 0;
      const periodSavingsRate = periodIncome > 0 ? ((periodIncome - periodExpenses) / periodIncome) * 100 : 0;
      
      periodMetrics[periodName] = {
        income: periodIncome,
        expenses: periodExpenses,
        netProfit: periodIncome - periodExpenses,
        transactions: periodTransactions.length,
        roi: Math.round(periodROI * 10) / 10, // Round to 1 decimal place
        savingsRate: Math.round(periodSavingsRate * 10) / 10
      };
    });

    // Legacy compatibility (for backward compatibility)
    const velocity30Days = periodMetrics.monthly.netProfit;
    const velocity7Days = periodMetrics.weekly.netProfit;
    const income30Days = periodMetrics.monthly.income;
    const expenses30Days = periodMetrics.monthly.expenses;
    const income7Days = periodMetrics.weekly.income;
    const expenses7Days = periodMetrics.weekly.expenses;

    // Category breakdown
    const categoryBreakdown = this.getCategoryBreakdown();

    // Cash flow trends
    const trends = this.calculateTrends();

    // Calculate overall ROI and savings rate
    const overallROI = totalExpenses > 0 ? ((totalIncome - totalExpenses) / totalExpenses) * 100 : 0;
    const overallSavingsRate = totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0;

    return {
      netWorth,
      totalIncome,
      totalExpenses,
      velocity30Days,
      velocity7Days,
      income30Days,
      expenses30Days,
      income7Days,
      expenses7Days,
      // New detailed period metrics
      periodMetrics,
      // Overall ROI and savings rate
      roi: Math.round(overallROI * 10) / 10,
      savingsRate: Math.round(overallSavingsRate * 10) / 10,
      categoryBreakdown,
      trends,
      transactionCount: this.transactions.length,
      lastTransaction: this.transactions[0] || null
    };
  }

  // Category breakdown analysis
  getCategoryBreakdown() {
    const breakdown = {};
    
    this.transactions.forEach(transaction => {
      const category = (transaction.metadata && transaction.metadata.category) || 'other';
      if (!breakdown[category]) {
        breakdown[category] = {
          income: 0,
          expense: 0,
          net: 0,
          count: 0
        };
      }
      
      breakdown[category].count++;
      if (transaction.transaction_type === 'income') {
        breakdown[category].income += transaction.amount || 0;
      } else {
        breakdown[category].expense += transaction.amount || 0;
      }
      breakdown[category].net = breakdown[category].income - breakdown[category].expense;
    });

    return breakdown;
  }

  // Calculate financial trends
  calculateTrends() {
    if (this.transactions.length < 2) return { direction: 'stable', confidence: 0 };

    const now = new Date();
    const periods = [7, 14, 30].map(days => {
      const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const periodTransactions = this.transactions.filter(t => new Date(t.created_at) > periodStart);
      
      const income = periodTransactions
        .filter(t => t.transaction_type === 'income')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      const expenses = periodTransactions
        .filter(t => t.transaction_type === 'expense')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      
      return {
        days,
        income: income / days, // daily average
        expenses: expenses / days,
        net: (income - expenses) / days
      };
    });

    // Analyze trend direction
    const netTrends = periods.map(p => p.net);
    const isIncreasing = netTrends[0] > netTrends[1] && netTrends[1] > netTrends[2];
    const isDecreasing = netTrends[0] < netTrends[1] && netTrends[1] < netTrends[2];
    
    return {
      direction: isIncreasing ? 'improving' : isDecreasing ? 'declining' : 'stable',
      periods,
      confidence: Math.abs(netTrends[0] - netTrends[2]) / Math.abs(netTrends[2] || 1)
    };
  }

  // Get specific period metric (helper for UI components)
  getPeriodMetric(metricType, period) {
    const metrics = this.calculateMetrics();
    if (!metrics.periodMetrics || !metrics.periodMetrics[period]) {
      return metricType === 'roi' || metricType === 'savingsRate' ? '0%' : 0;
    }
    
    const periodData = metrics.periodMetrics[period];
    switch (metricType) {
      case 'income':
        return periodData.income;
      case 'expense':
        return periodData.expenses;
      case 'netProfit':
        return periodData.netProfit;
      case 'transactions':
        return periodData.transactions;
      case 'roi':
        return `${periodData.roi}%`;
      case 'savingsRate':
        return `${periodData.savingsRate}%`;
      default:
        return 0;
    }
  }

  // Voice input processing (placeholder for Web Speech API integration)
  startVoiceInput(callback) {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      callback({ success: false, error: 'Speech recognition not supported' });
      return null;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      callback({ success: true, transcript });
    };

    recognition.onerror = (event) => {
      callback({ success: false, error: event.error });
    };

    recognition.start();
    return recognition;
  }

  // Financial health scoring
  calculateFinancialHealthScore(targetNetWorth = 1000000) {
    const metrics = this.calculateMetrics();
    
    // Score components (0-100 each)
    const netWorthScore = Math.min(100, Math.max(0, (metrics.netWorth / targetNetWorth) * 100));
    const velocityScore = Math.min(100, Math.max(0, (metrics.velocity30Days / (targetNetWorth * 0.01)) * 100));
    const consistencyScore = this.calculateConsistencyScore();
    const diversificationScore = this.calculateDiversificationScore();
    
    // Weighted average
    const healthScore = (
      netWorthScore * 0.4 +
      velocityScore * 0.3 +
      consistencyScore * 0.2 +
      diversificationScore * 0.1
    );

    return {
      overall: Math.round(healthScore),
      components: {
        netWorth: Math.round(netWorthScore),
        velocity: Math.round(velocityScore),
        consistency: Math.round(consistencyScore),
        diversification: Math.round(diversificationScore)
      },
      recommendations: this.generateRecommendations(healthScore, metrics)
    };
  }

  calculateConsistencyScore() {
    if (this.transactions.length < 7) return 50; // Not enough data

    const dailyTotals = {};
    const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    // Group transactions by day
    this.transactions
      .filter(t => new Date(t.created_at) > last30Days)
      .forEach(t => {
        const day = new Date(t.created_at).toISOString().split('T')[0];
        if (!dailyTotals[day]) dailyTotals[day] = 0;
        dailyTotals[day] += t.transaction_type === 'income' ? t.amount : -t.amount;
      });

    const values = Object.values(dailyTotals);
    if (values.length === 0) return 0;

    // Calculate coefficient of variation (lower is more consistent)
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / Math.abs(mean || 1);

    // Convert to 0-100 score (lower CV = higher score)
    return Math.max(0, 100 - (coefficientOfVariation * 50));
  }

  calculateDiversificationScore() {
    const breakdown = this.getCategoryBreakdown();
    const categories = Object.keys(breakdown);
    
    if (categories.length <= 1) return 0;
    if (categories.length >= 5) return 100;
    
    // Score based on number of categories and distribution
    return (categories.length / 5) * 100;
  }

  generateRecommendations(score, metrics) {
    const recommendations = [];
    
    if (score < 30) {
      recommendations.push('Focus on increasing income streams');
      recommendations.push('Reduce unnecessary expenses');
      recommendations.push('Set up emergency fund');
    } else if (score < 60) {
      recommendations.push('Diversify income sources');
      recommendations.push('Track spending more consistently');
      recommendations.push('Consider investment opportunities');
    } else if (score < 80) {
      recommendations.push('Optimize high-value work blocks');
      recommendations.push('Automate savings and investments');
      recommendations.push('Explore passive income streams');
    } else {
      recommendations.push('Maintain current financial discipline');
      recommendations.push('Explore advanced investment strategies');
      recommendations.push('Consider expansion opportunities');
    }

    return recommendations;
  }

  // Cleanup
  destroy() {
    this.listeners.forEach(listener => {
      if (typeof listener === 'function') {
        listener(); // Call unsubscribe functions
      }
    });
    this.listeners = [];
  }
}

// Factory function to create VelocityEngine instance
export const createVelocityEngine = (userId) => {
  return new VelocityEngine(userId);
};

export default VelocityEngine;