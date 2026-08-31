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
            // Tag to a PitchIn business when provided — feeds live share valuation
            business_profile_id: transactionData.business_profile_id || null,
            metadata: {
              category: transactionData.category,
              source: transactionData.source,
              originalDate: transactionData.date,
              record_category: transactionData.record_category || 'personal',
              accounting_type: transactionData.accounting_type || null,
              reporting_bucket: transactionData.reporting_bucket || null,
              product_name: transactionData.product_name || null,
              product_action: transactionData.product_action || null,
              ledger_side: transactionData.ledger_side || null,
              raw_entry_text: transactionData.raw_entry_text || null,
              entry_mode: transactionData.entry_mode || null
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

  // Load transactions visible to this user: their own (personal + business),
  // plus any entry tagged to a business they own or co-own — so an owner or
  // shareholder sees what team members/co-owners recorded too, not just what
  // they personally typed in. See UNIFIED_BUSINESS_TRANSACTIONS_FEED.sql.
  // Falls back to the old "own rows only" query if that RPC isn't deployed yet.
  async loadTransactions() {
    try {
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      console.log(`🔍 VelocityEngine: Loading transactions for user ${this.userId}`);
      let { data, error } = await this.supabase.rpc('fn_get_visible_ican_transactions');

      if (error) {
        console.warn('VelocityEngine: fn_get_visible_ican_transactions unavailable, falling back to own-rows-only:', error.message);
        ({ data, error } = await this.supabase
          .from('ican_transactions')
          .select('*')
          .eq('user_id', this.userId)
          .order('created_at', { ascending: false }));
      }

      if (error) {
        console.error('VelocityEngine: Error loading transactions from Supabase:', error);
        return { success: false, error };
      }

      console.log(`📊 VelocityEngine: Found ${data?.length || 0} transactions visible to user ${this.userId}`);
      this.transactions = data || [];
      this.notifyListeners();
      return { success: true, data: this.transactions };
    } catch (error) {
      console.error('VelocityEngine: Error loading transactions:', error);
      return { success: false, error };
    }
  }

  /**
   * Load ALL transactions across every app for this user.
   * Merges ican_transactions (manual entries) with ican_coin_transactions
   * (MyBodaGuy earnings, FarmAgent sales, SupermartKera cashbacks, ICAN wallet moves).
   * This gives "Record Every Transaction" a complete cross-app financial picture.
   */
  async loadAllTransactions() {
    try {
      if (!this.supabase) throw new Error('Supabase client not initialized');

      let manualRes = await this.supabase.rpc('fn_get_visible_ican_transactions');
      if (manualRes.error) {
        console.warn('VelocityEngine: fn_get_visible_ican_transactions unavailable, falling back to own-rows-only:', manualRes.error.message);
        manualRes = await this.supabase
          .from('ican_transactions')
          .select('*')
          .eq('user_id', this.userId)
          .order('created_at', { ascending: false });
      }

      // Uses a security-definer feed so the report receives both personal
      // wallet rows and authorised business-wallet ledger rows. The latter
      // intentionally have no recipient_user_id to prevent a business
      // payment from appearing in an owner's personal trading account.
      const coinRes = await this.supabase
        .rpc('get_ican_record_every_transaction_feed');

      if (manualRes.error) {
        console.error('VelocityEngine: Error loading manual transactions:', manualRes.error);
      }
      if (coinRes.error) {
        console.error('VelocityEngine: Error loading coin transactions:', coinRes.error);
      }

      const manualTxs = manualRes.data || [];

      // Normalise ican_coin_transactions into the same shape as ican_transactions
      // so calculateMetrics() and buildFinancialDataFromTransactions() work on both
      const coinTxs = (coinRes.data || []).map(tx => {
        const isIncoming = tx.recipient_user_id === this.userId;
        // Business receipts have no recipient_user_id by design: their value
        // belongs to the business wallet, rather than an owner's personal
        // trading wallet. Keep those rows in the business financial record.
        const isBusinessReceipt = tx.transaction_type === 'transfer_in' &&
          Boolean(tx.business_profile_id) && !tx.recipient_user_id;
        // transfer_in and transfer_out are mirror rows for one payment. Keep
        // only the row representing this user's side in the report.
        if ((tx.transaction_type === 'transfer_out' && isIncoming) ||
            (tx.transaction_type === 'transfer_in' && !isIncoming && !isBusinessReceipt)) return null;
        // The shared wallet schema stores the local-currency value as
        // local_amount. Older rows may expose ugx_equivalent, so keep both
        // fallbacks and finally derive UGX from the ICAN amount.
        const ugxAmount = parseFloat(
          tx.local_amount ?? tx.ugx_equivalent ?? ((tx.ican_amount || 0) * 5000)
        ) || 0;
        const sourceLabels = {
          'mybodaguy':     'MyBodaGuy delivery',
          'farm-agent':    'AgriBone sale',
          'digital-city-era': 'SupermartKera cashback',
          'ican':          'IcanEra wallet'
        };

        const classification = isBusinessReceipt ? 'business_income' : tx.expense_classification ||
          (tx.source_app === 'digital-city-era' || /store|supermarket|purchase/i.test(tx.note || '')
            ? 'business_expense' : 'person_transfer');
        const isPersonTransfer = classification === 'person_transfer';
        const isIncome = ['earn', 'cashback', 'sale', 'refund'].includes(tx.transaction_type) ||
          (tx.transaction_type === 'transfer_in' && !isPersonTransfer);
        const isExpense = tx.transaction_type === 'tithe' || tx.transaction_type === 'purchase' ||
          (tx.transaction_type === 'transfer_out' && classification === 'business_expense');
        const reportingBucket = tx.transaction_type === 'tithe' ? 'tithe_payment' :
          tx.transaction_type === 'purchase' ? 'bought_stock' :
          isExpense ? 'operating_expense' : isIncome ? 'sold_income' : null;

        return {
          id:               `coin_${tx.id}`,
          user_id:          this.userId,
          amount:           ugxAmount,
          transaction_type: isPersonTransfer ? 'transfer' : isIncome ? 'income' : isExpense ? 'expense' : 'transfer',
          description:      tx.merchant_name || tx.note || `${sourceLabels[tx.source_app] || tx.source_app} — ${tx.transaction_type}`,
          currency:         tx.local_currency || 'UGX',
          status:           'completed',
          created_at:       tx.created_at,
          business_profile_id: tx.business_profile_id || null,
          _source:          'coin',
          metadata: {
            category:          tx.source_app === 'digital-city-era' ? 'SupermartKera' : (tx.source_app || 'other'),
            source:            tx.source_app,
            source_app:        tx.source_app,
            record_category:   classification.startsWith('business_') ? 'business' : 'personal',
            reporting_bucket:  reportingBucket,
            accounting_type:   isIncome ? 'revenue' : isExpense ? 'expense' : 'transfer',
            expense_classification: classification,
            counterparty_type: tx.counterparty_type || 'unknown',
            merchant_name:     tx.merchant_name || null,
            ican_amount:       tx.ican_amount,
            ugx_equivalent:    ugxAmount,
            coin_tx_type:      tx.transaction_type,
            reference_id:      tx.reference_id,
            business_profile_id: tx.business_profile_id || null
          }
        };
      });

      // Merge: manual entries first, then coin transactions; deduplicate by id
      const seen = new Set(manualTxs.map(t => t.id));
      const merged = [
        ...manualTxs.filter(t => t.status !== 'failed' && Number(t.amount || 0) !== 0),
        ...coinTxs.filter(Boolean).filter(t => !seen.has(t.id))
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      this.transactions = merged;
      this.notifyListeners();

      console.log(`📊 VelocityEngine: ${manualTxs.length} manual + ${coinTxs.length} coin = ${merged.length} total transactions`);
      return { success: true, data: merged };
    } catch (error) {
      console.error('VelocityEngine: Error loading all transactions:', error);
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

  // Determine whether a transaction belongs to the given personal/business
  // scope, using the same record_category / business_profile_id fields the
  // Transactions and Reports sections already key off of.
  matchesScope(tx, scope, businessId) {
    if (!scope || scope === 'all') return true;
    const category = tx.record_category || tx.metadata?.record_category || 'personal';
    if (scope === 'personal') return category !== 'business';
    if (scope === 'business') {
      if (category !== 'business') return false;
      if (businessId) return tx.business_profile_id === businessId;
      return true;
    }
    return true;
  }

  // Personal/business/all-scoped view of this.transactions. Scope is applied
  // once here so calculateMetrics/getCategoryBreakdown/calculateTrends stay
  // simple pass-throughs over whichever list they're given.
  getScopedTransactions(scope = 'all', businessId = null) {
    if (!scope || scope === 'all') return this.transactions;
    return this.transactions.filter(t => this.matchesScope(t, scope, businessId));
  }

  // Calculate financial metrics. scope/businessId narrow the calculation to
  // personal-only or a specific business's transactions; defaults preserve
  // the previous "everything" behavior for existing callers.
  calculateMetrics(scope = 'all', businessId = null) {
    const transactions = this.getScopedTransactions(scope, businessId);
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // Basic calculations
    const totalIncome = transactions
      .filter(t => t.transaction_type === 'income')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const totalExpenses = transactions
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
      const periodTransactions = transactions.filter(t => new Date(t.created_at) > config.cutoff);
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

    // 🔧 FIXED June 8: Separate personal and business income for tithe calculation
    // Personal income: salary, wages, bonuses from employment (category='salary' or metadata.record_category='personal')
    // Business income: sales, revenue from business (metadata.record_category='business' or metadata.reporting_bucket='sold_income')
    const last30Days = transactions.filter(t => new Date(t.created_at) > thirtyDaysAgo);
    
    const personalIncome30Days = last30Days
      .filter(t => t.transaction_type === 'income' && 
        (
          (t.metadata?.category === 'salary') ||
          (t.metadata?.record_category === 'personal') ||
          (t.metadata?.entry_mode === 'salary')
        )
      )
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    const businessIncome30Days = last30Days
      .filter(t => t.transaction_type === 'income' &&
        (
          (t.metadata?.record_category === 'business') ||
          (t.metadata?.reporting_bucket === 'sold_income') ||
          (t.metadata?.category === 'business')
        )
      )
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    const businessExpenses30Days = last30Days
      .filter(t => t.transaction_type === 'expense' &&
        (
          (t.metadata?.record_category === 'business') ||
          (t.metadata?.reporting_bucket === 'bought_stock') ||
          (t.metadata?.category === 'business')
        )
      )
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    // Category breakdown
    const categoryBreakdown = this.getCategoryBreakdown(transactions);

    // Cash flow trends
    const trends = this.calculateTrends(transactions);

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
      // 🔧 FIXED June 8: Separated personal and business metrics
      personalIncome30Days,
      businessIncome30Days,
      businessExpenses30Days,
      // New detailed period metrics
      periodMetrics,
      // Overall ROI and savings rate
      roi: Math.round(overallROI * 10) / 10,
      savingsRate: Math.round(overallSavingsRate * 10) / 10,
      categoryBreakdown,
      trends,
      transactionCount: transactions.length,
      lastTransaction: transactions[0] || null
    };
  }

  // Get a real, zero-filled daily income/expense/net series for the last N
  // days, scoped to personal/business/all — feeds the Daily Tracking chart.
  getDailySeries(days = 30, scope = 'all', businessId = null) {
    const transactions = this.getScopedTransactions(scope, businessId);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const byDay = {};

    transactions
      .filter(t => new Date(t.created_at) > cutoff)
      .forEach(t => {
        const day = new Date(t.created_at).toISOString().split('T')[0];
        if (!byDay[day]) byDay[day] = { income: 0, expense: 0 };
        if (t.transaction_type === 'income') byDay[day].income += t.amount || 0;
        else if (t.transaction_type === 'expense') byDay[day].expense += t.amount || 0;
      });

    // Fill every day in range, including zero-activity days, so the chart
    // shows a continuous real timeline instead of only days with activity.
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const bucket = byDay[key] || { income: 0, expense: 0 };
      series.push({ date: key, income: bucket.income, expense: bucket.expense, net: bucket.income - bucket.expense });
    }
    return series;
  }

  // --- Smart multi-granularity series: years of history, drillable ---
  //
  // Rather than one fixed "last 30 days" window, callers hand this a
  // [start, end] span (or a named preset) and it auto-picks the coarsest
  // bucket size that still keeps the chart readable — daily for a month or
  // less, weekly out to about a year, monthly out to a few years, yearly
  // beyond that. Drilling into one bucket just re-runs this over that
  // bucket's own [start, end], which naturally lands on a finer granularity
  // since the span shrank — no separate "zoom" data path needed.

  // Coarsest granularity that keeps a [start, end] span readable.
  pickGranularity(start, end) {
    const days = Math.max(1, (end - start) / (24 * 60 * 60 * 1000));
    if (days <= 45) return 'daily';       // up to ~6 weeks: every day
    if (days <= 400) return 'weekly';     // up to ~1 year: every week (~52 points)
    if (days <= 2200) return 'monthly';   // up to ~6 years: every month (~72 points)
    return 'yearly';                      // beyond that: every year
  }

  // Normalize a date down to the start of its bucket for a granularity.
  bucketStart(date, granularity) {
    const d = new Date(date);
    if (granularity === 'weekly') {
      d.setHours(0, 0, 0, 0);
      const dow = (d.getDay() + 6) % 7; // Monday = 0
      d.setDate(d.getDate() - dow);
      return d;
    }
    if (granularity === 'monthly') return new Date(d.getFullYear(), d.getMonth(), 1);
    if (granularity === 'yearly') return new Date(d.getFullYear(), 0, 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // Step a bucket-start date forward by one bucket of the given granularity.
  nextBucket(date, granularity) {
    const d = new Date(date);
    if (granularity === 'weekly') d.setDate(d.getDate() + 7);
    else if (granularity === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (granularity === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else d.setDate(d.getDate() + 1);
    return d;
  }

  bucketKey(date, granularity) {
    const d = this.bucketStart(date, granularity);
    if (granularity === 'yearly') return String(d.getFullYear());
    if (granularity === 'monthly') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return d.toISOString().split('T')[0];
  }

  // Named presets → concrete [start, end] windows. 'all' reaches back to the
  // user's first-ever transaction so multi-year history is always available.
  getPresetRange(preset, scope = 'all', businessId = null) {
    const end = new Date();
    const start = new Date(end);
    switch (preset) {
      case '7d': start.setDate(start.getDate() - 7); break;
      case '1m': start.setMonth(start.getMonth() - 1); break;
      case '3m': start.setMonth(start.getMonth() - 3); break;
      case '1y': start.setFullYear(start.getFullYear() - 1); break;
      case '5y': start.setFullYear(start.getFullYear() - 5); break;
      case 'all': {
        const earliest = this.getEarliestTransactionDate(scope, businessId);
        if (earliest) return { start: earliest, end };
        start.setFullYear(start.getFullYear() - 1);
        break;
      }
      default: start.setMonth(start.getMonth() - 1);
    }
    return { start, end };
  }

  getEarliestTransactionDate(scope = 'all', businessId = null) {
    const transactions = this.getScopedTransactions(scope, businessId);
    if (transactions.length === 0) return null;
    return transactions.reduce(
      (min, t) => { const d = new Date(t.created_at); return d < min ? d : min; },
      new Date(transactions[0].created_at)
    );
  }

  // Real, zero-filled income/expense/net series across [start, end], bucketed
  // at whichever granularity keeps that span readable. Feeds the Financial
  // Trends chart at every zoom level, from a week to a multi-year "All" view.
  getRangeSeries(scope = 'all', businessId = null, { start, end, granularity } = {}) {
    end = end || new Date();
    start = start || (() => { const d = new Date(end); d.setMonth(d.getMonth() - 1); return d; })();
    const gran = granularity || this.pickGranularity(start, end);

    const transactions = this.getScopedTransactions(scope, businessId);
    const rangeStart = this.bucketStart(start, gran);
    const byBucket = {};
    transactions.forEach((t) => {
      const created = new Date(t.created_at);
      if (created < rangeStart || created > end) return;
      const key = this.bucketKey(created, gran);
      if (!byBucket[key]) byBucket[key] = { income: 0, expense: 0 };
      if (t.transaction_type === 'income') byBucket[key].income += t.amount || 0;
      else if (t.transaction_type === 'expense') byBucket[key].expense += t.amount || 0;
    });

    const series = [];
    let cursor = rangeStart;
    const last = this.bucketStart(end, gran);
    let guard = 0;
    while (cursor <= last && guard < 5000) {
      const key = this.bucketKey(cursor, gran);
      const bucket = byBucket[key] || { income: 0, expense: 0 };
      series.push({
        date: key,
        bucketStart: new Date(cursor).toISOString(),
        income: bucket.income,
        expense: bucket.expense,
        net: bucket.income - bucket.expense
      });
      cursor = this.nextBucket(cursor, gran);
      guard++;
    }

    return { data: series, granularity: gran, start: rangeStart, end: last };
  }

  // The [start, end] window one clicked bucket spans — used to "drill into"
  // a point on the chart and zoom to it (a year click zooms to that year, a
  // month click zooms to that month, and so on down to daily).
  getBucketRange(bucketStartIso, granularity) {
    const start = new Date(bucketStartIso);
    const end = this.nextBucket(start, granularity);
    end.setMilliseconds(end.getMilliseconds() - 1);
    return { start, end };
  }

  // Category breakdown analysis
  getCategoryBreakdown(transactions = this.transactions) {
    const breakdown = {};

    transactions.forEach(transaction => {
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
  calculateTrends(transactions = this.transactions) {
    if (transactions.length < 2) return { direction: 'stable', confidence: 0 };

    const now = new Date();
    const periods = [7, 14, 30].map(days => {
      const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const periodTransactions = transactions.filter(t => new Date(t.created_at) > periodStart);
      
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

  // Get specific period metric (helper for UI components). scope/businessId
  // narrow the underlying calculation to personal-only or one business.
  getPeriodMetric(metricType, period, scope = 'all', businessId = null) {
    const metrics = this.calculateMetrics(scope, businessId);
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
