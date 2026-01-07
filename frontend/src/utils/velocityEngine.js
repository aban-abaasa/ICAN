// Velocity Engine - Pillar I: Financial Capital
// Transform volatile cash flow into structured wealth metrics

import { addTransaction, getUserTransactions, subscribeToTransactions } from '../config/firebase.js';

export class VelocityEngine {
  constructor(userId) {
    this.userId = userId;
    this.transactions = [];
    this.listeners = [];
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

  // Add transaction to Firestore
  async addTransaction(transactionData) {
    try {
      const result = await addTransaction(this.userId, transactionData);
      if (result.success) {
        // Update local cache
        this.transactions.unshift({ ...transactionData, id: result.id });
        this.notifyListeners();
        return { success: true, transaction: { ...transactionData, id: result.id } };
      }
      return result;
    } catch (error) {
      console.error('Error adding transaction:', error);
      return { success: false, error };
    }
  }

  // Load user transactions
  async loadTransactions() {
    try {
      const result = await getUserTransactions(this.userId);
      if (result.success) {
        this.transactions = result.data;
        this.notifyListeners();
        return result;
      }
      return result;
    } catch (error) {
      console.error('Error loading transactions:', error);
      return { success: false, error };
    }
  }

  // Subscribe to real-time transaction updates
  subscribeToUpdates(callback) {
    const unsubscribe = subscribeToTransactions(this.userId, (transactions) => {
      this.transactions = transactions;
      this.notifyListeners();
      callback(transactions);
    });

    this.listeners.push(unsubscribe);
    return unsubscribe;
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
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Basic calculations
    const totalIncome = this.transactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const totalExpenses = this.transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const netWorth = totalIncome - totalExpenses;

    // 30-day velocity
    const recent30Days = this.transactions.filter(t => new Date(t.date) > thirtyDaysAgo);
    const income30Days = recent30Days
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const expenses30Days = recent30Days
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const velocity30Days = income30Days - expenses30Days;

    // 7-day velocity
    const recent7Days = this.transactions.filter(t => new Date(t.date) > sevenDaysAgo);
    const income7Days = recent7Days
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const expenses7Days = recent7Days
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const velocity7Days = income7Days - expenses7Days;

    // Category breakdown
    const categoryBreakdown = this.getCategoryBreakdown();

    // Cash flow trends
    const trends = this.calculateTrends();

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
      const category = transaction.category || 'other';
      if (!breakdown[category]) {
        breakdown[category] = {
          income: 0,
          expense: 0,
          net: 0,
          count: 0
        };
      }
      
      breakdown[category].count++;
      if (transaction.type === 'income') {
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
      const periodTransactions = this.transactions.filter(t => new Date(t.date) > periodStart);
      
      const income = periodTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      const expenses = periodTransactions
        .filter(t => t.type === 'expense')
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
      .filter(t => new Date(t.date) > last30Days)
      .forEach(t => {
        const day = new Date(t.date).toISOString().split('T')[0];
        if (!dailyTotals[day]) dailyTotals[day] = 0;
        dailyTotals[day] += t.type === 'income' ? t.amount : -t.amount;
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