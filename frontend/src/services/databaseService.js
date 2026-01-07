/**
 * ICAN Database Service
 * Privacy-First Financial Data Management with Blockchain Integration
 */

import { supabase } from '../lib/supabase/client';

// =============================================
// 🔐 ENCRYPTION UTILITIES
// =============================================

/**
 * Generates SHA-256 hash for blockchain verification
 */
export const generateDataHash = async (data) => {
  const msgBuffer = new TextEncoder().encode(JSON.stringify(data));
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// =============================================
// 💰 TRANSACTION OPERATIONS
// =============================================

/**
 * Create a new financial transaction
 */
export const createTransaction = async ({
  transactionType,
  amount,
  category,
  subCategory = null,
  description = '',
  transactionDate = new Date().toISOString().split('T')[0],
  source = 'manual',
  currency = 'UGX',
  isRecurring = false,
  recurrencePattern = null,
  tags = [],
  isSensitive = false,
  originalInput = null,
  aiCategorized = false,
  aiConfidence = null,
  metadata = {}
}) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Generate data hash for blockchain verification
    const dataForHash = { transactionType, amount, category, transactionDate, timestamp: Date.now() };
    const dataHash = await generateDataHash(dataForHash);

    const { data, error } = await supabase
      .from('ican_financial_transactions')
      .insert({
        user_id: user.id,
        transaction_type: transactionType,
        amount,
        category,
        sub_category: subCategory,
        description,
        transaction_date: transactionDate,
        source,
        currency,
        is_recurring: isRecurring,
        recurrence_pattern: recurrencePattern,
        tags,
        is_sensitive: isSensitive,
        original_input: originalInput,
        ai_categorized: aiCategorized,
        ai_confidence: aiConfidence,
        data_hash: dataHash,
        metadata
      })
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error creating transaction:', error);
    return { data: null, error };
  }
};

/**
 * Get transactions with filters
 */
export const getTransactions = async ({
  startDate = null,
  endDate = null,
  transactionType = null,
  category = null,
  limit = 100,
  offset = 0,
  includeSensitive = false
} = {}) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    let query = supabase
      .from('ican_financial_transactions')
      .select('*')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('transaction_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (startDate) query = query.gte('transaction_date', startDate);
    if (endDate) query = query.lte('transaction_date', endDate);
    if (transactionType) query = query.eq('transaction_type', transactionType);
    if (category) query = query.eq('category', category);
    if (!includeSensitive) query = query.eq('exclude_from_reports', false);

    const { data, error } = await query;
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return { data: null, error };
  }
};

/**
 * Get financial summary
 */
export const getFinancialSummary = async (startDate = null, endDate = null) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase.rpc('get_ican_financial_summary', {
      p_user_id: user.id
    });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching summary:', error);
    return { data: null, error };
  }
};

/**
 * Update transaction
 */
export const updateTransaction = async (transactionId, updates) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('ican_financial_transactions')
      .update(updates)
      .eq('id', transactionId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error updating transaction:', error);
    return { data: null, error };
  }
};

/**
 * Soft delete transaction (privacy-compliant)
 */
export const deleteTransaction = async (transactionId) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('ican_financial_transactions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', transactionId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return { data: null, error };
  }
};

// =============================================
// 💳 LOAN OPERATIONS
// =============================================

/**
 * Create a new loan
 */
export const createLoan = async ({
  loanType,
  loanName,
  principalAmount,
  interestRate,
  termMonths,
  startDate,
  lenderType = null,
  paymentFrequency = 'monthly',
  hasCollateral = false,
  currency = 'UGX',
  metadata = {}
}) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Calculate loan details
    const monthlyRate = interestRate / 100 / 12;
    const totalInterest = principalAmount * (interestRate / 100) * (termMonths / 12);
    const totalAmountDue = principalAmount + totalInterest;
    const monthlyPayment = totalAmountDue / termMonths;

    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + termMonths);

    const nextPaymentDate = new Date(startDate);
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

    const dataHash = await generateDataHash({ loanType, principalAmount, startDate, timestamp: Date.now() });

    const { data, error } = await supabase
      .from('ican_loans')
      .insert({
        user_id: user.id,
        loan_type: loanType,
        loan_name: loanName,
        principal_amount: principalAmount,
        interest_rate: interestRate,
        total_interest: totalInterest,
        total_amount_due: totalAmountDue,
        remaining_balance: totalAmountDue,
        monthly_payment: monthlyPayment,
        term_months: termMonths,
        payment_frequency: paymentFrequency,
        start_date: startDate,
        end_date: endDate.toISOString().split('T')[0],
        next_payment_date: nextPaymentDate.toISOString().split('T')[0],
        lender_type: lenderType,
        has_collateral: hasCollateral,
        currency,
        data_hash: dataHash,
        metadata
      })
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error creating loan:', error);
    return { data: null, error };
  }
};

/**
 * Get all loans
 */
export const getLoans = async (status = null) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    let query = supabase
      .from('ican_loans')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching loans:', error);
    return { data: null, error };
  }
};

/**
 * Record loan payment
 */
export const recordLoanPayment = async (loanId, paymentAmount, paymentDate = new Date().toISOString().split('T')[0]) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Get current loan
    const { data: loan, error: loanError } = await supabase
      .from('ican_loans')
      .select('*')
      .eq('id', loanId)
      .eq('user_id', user.id)
      .single();

    if (loanError) throw loanError;

    const newAmountPaid = (loan.amount_paid || 0) + paymentAmount;
    const newRemainingBalance = loan.total_amount_due - newAmountPaid;
    const newStatus = newRemainingBalance <= 0 ? 'paid_off' : 'active';

    // Calculate next payment date
    const nextPayment = new Date(loan.next_payment_date || paymentDate);
    nextPayment.setMonth(nextPayment.getMonth() + 1);

    // Update loan
    const { data: updatedLoan, error: updateError } = await supabase
      .from('ican_loans')
      .update({
        amount_paid: newAmountPaid,
        remaining_balance: Math.max(0, newRemainingBalance),
        status: newStatus,
        next_payment_date: newStatus === 'paid_off' ? null : nextPayment.toISOString().split('T')[0]
      })
      .eq('id', loanId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Create transaction for the payment
    await createTransaction({
      transactionType: 'loan_payment',
      amount: paymentAmount,
      category: 'loan_payment',
      subCategory: loan.loan_type,
      description: `Payment for ${loan.loan_name || loan.loan_type}`,
      transactionDate: paymentDate,
      metadata: { loan_id: loanId }
    });

    return { data: updatedLoan, error: null };
  } catch (error) {
    console.error('Error recording loan payment:', error);
    return { data: null, error };
  }
};

// =============================================
// 🎯 GOAL OPERATIONS
// =============================================

/**
 * Create a financial goal
 */
export const createGoal = async ({
  goalType,
  goalName,
  targetAmount,
  targetDate = null,
  monthlyContribution = null,
  autoContribute = false,
  priority = 5,
  journeyStage = null,
  description = '',
  currency = 'UGX'
}) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('ican_financial_goals')
      .insert({
        user_id: user.id,
        goal_type: goalType,
        goal_name: goalName,
        description,
        target_amount: targetAmount,
        target_date: targetDate,
        monthly_contribution: monthlyContribution,
        auto_contribute: autoContribute,
        priority,
        journey_stage: journeyStage,
        currency
      })
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error creating goal:', error);
    return { data: null, error };
  }
};

/**
 * Get all goals
 */
export const getGoals = async (status = null) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    let query = supabase
      .from('ican_financial_goals')
      .select('*')
      .eq('user_id', user.id)
      .order('priority', { ascending: true });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching goals:', error);
    return { data: null, error };
  }
};

/**
 * Update goal progress
 */
export const updateGoalProgress = async (goalId, contributionAmount) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Get current goal
    const { data: goal, error: goalError } = await supabase
      .from('ican_financial_goals')
      .select('*')
      .eq('id', goalId)
      .eq('user_id', user.id)
      .single();

    if (goalError) throw goalError;

    const newAmount = (goal.current_amount || 0) + contributionAmount;
    const newStatus = newAmount >= goal.target_amount ? 'completed' : 'active';

    const { data, error } = await supabase
      .from('ican_financial_goals')
      .update({
        current_amount: newAmount,
        status: newStatus,
        completed_date: newStatus === 'completed' ? new Date().toISOString() : null
      })
      .eq('id', goalId)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error updating goal:', error);
    return { data: null, error };
  }
};

// =============================================
// ⛪ TITHE/GIVING OPERATIONS
// =============================================

/**
 * Record tithe/giving
 */
export const recordTithe = async ({
  givingType,
  amount,
  incomeReferenceAmount = null,
  tithePercentage = 10,
  recipientType = null,
  givingDate = new Date().toISOString().split('T')[0],
  isAnonymous = false,
  currency = 'UGX'
}) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Create transaction first
    const { data: transaction, error: txError } = await createTransaction({
      transactionType: 'tithe',
      amount,
      category: 'religious',
      subCategory: givingType,
      description: `${givingType} - ${givingDate}`,
      transactionDate: givingDate,
      isSensitive: isAnonymous
    });

    if (txError) throw txError;

    // Generate hash for blockchain certificate
    const givingHash = await generateDataHash({ givingType, amount, givingDate, timestamp: Date.now() });

    const { data, error } = await supabase
      .from('ican_tithe_records')
      .insert({
        user_id: user.id,
        transaction_id: transaction?.id,
        giving_type: givingType,
        amount,
        income_reference_amount: incomeReferenceAmount,
        tithe_percentage: tithePercentage,
        recipient_type: recipientType,
        giving_date: givingDate,
        is_anonymous: isAnonymous,
        giving_certificate_hash: givingHash,
        currency
      })
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error recording tithe:', error);
    return { data: null, error };
  }
};

/**
 * Get tithe records
 */
export const getTitheRecords = async (startDate = null, endDate = null) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    let query = supabase
      .from('ican_tithe_records')
      .select('*')
      .eq('user_id', user.id)
      .order('giving_date', { ascending: false });

    if (startDate) query = query.gte('giving_date', startDate);
    if (endDate) query = query.lte('giving_date', endDate);

    const { data, error } = await query;
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching tithe records:', error);
    return { data: null, error };
  }
};

// =============================================
// 📊 BUDGET OPERATIONS
// =============================================

/**
 * Create a budget
 */
export const createBudget = async ({
  budgetName,
  budgetType = 'category',
  category = null,
  budgetAmount,
  periodType = 'monthly',
  startDate,
  endDate,
  alertThreshold = 80,
  allowRollover = false,
  currency = 'UGX'
}) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const commitmentHash = await generateDataHash({ budgetName, budgetAmount, startDate, timestamp: Date.now() });

    const { data, error } = await supabase
      .from('ican_budgets')
      .insert({
        user_id: user.id,
        budget_name: budgetName,
        budget_type: budgetType,
        category,
        budget_amount: budgetAmount,
        period_type: periodType,
        start_date: startDate,
        end_date: endDate,
        alert_threshold_percent: alertThreshold,
        allow_rollover: allowRollover,
        commitment_hash: commitmentHash,
        currency
      })
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error creating budget:', error);
    return { data: null, error };
  }
};

/**
 * Get budgets
 */
export const getBudgets = async (status = 'active') => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    let query = supabase
      .from('ican_budgets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching budgets:', error);
    return { data: null, error };
  }
};

// =============================================
// 🔐 PRIVACY SETTINGS
// =============================================

/**
 * Get user privacy settings
 */
export const getPrivacySettings = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('ican_privacy_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error && error.code === 'PGRST116') {
      // No settings found, create default
      const { data: newSettings, error: createError } = await supabase
        .from('ican_privacy_settings')
        .insert({ user_id: user.id })
        .select()
        .single();

      if (createError) throw createError;
      return { data: newSettings, error: null };
    }

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching privacy settings:', error);
    return { data: null, error };
  }
};

/**
 * Update privacy settings
 */
export const updatePrivacySettings = async (settings) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('ican_privacy_settings')
      .upsert({
        user_id: user.id,
        ...settings
      })
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error updating privacy settings:', error);
    return { data: null, error };
  }
};

// =============================================
// 🔗 BLOCKCHAIN OPERATIONS
// =============================================

/**
 * Queue transaction for blockchain sync
 */
export const queueForBlockchain = async (recordType, recordId) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Get the table name based on record type
    const tableMap = {
      transaction: 'ican_financial_transactions',
      loan: 'ican_loans',
      goal: 'ican_financial_goals',
      tithe: 'ican_tithe_records',
      budget: 'ican_budgets'
    };

    const tableName = tableMap[recordType];
    if (!tableName) throw new Error('Invalid record type');

    // Update the record's blockchain status
    const { error } = await supabase
      .from(tableName)
      .update({ blockchain_status: 'pending' })
      .eq('id', recordId)
      .eq('user_id', user.id);

    if (error) throw error;
    return { success: true, error: null };
  } catch (error) {
    console.error('Error queuing for blockchain:', error);
    return { success: false, error };
  }
};

/**
 * Verify blockchain record
 */
export const verifyBlockchainRecord = async (txHash) => {
  try {
    const { data, error } = await supabase
      .from('ican_blockchain_verifications')
      .select('*')
      .eq('tx_hash', txHash)
      .single();

    if (error) throw error;
    return { data, verified: data?.status === 'confirmed', error: null };
  } catch (error) {
    console.error('Error verifying blockchain record:', error);
    return { data: null, verified: false, error };
  }
};

// =============================================
// 📊 ANALYTICS & REPORTS
// =============================================

/**
 * Get monthly trends
 */
export const getMonthlyTrends = async (months = 12) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const { data, error } = await supabase
      .from('ican_financial_transactions')
      .select('transaction_type, amount, transaction_date')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .gte('transaction_date', startDate.toISOString().split('T')[0])
      .order('transaction_date', { ascending: true });

    if (error) throw error;

    // Group by month
    const monthlyData = {};
    data?.forEach(tx => {
      const month = tx.transaction_date.substring(0, 7); // YYYY-MM
      if (!monthlyData[month]) {
        monthlyData[month] = { month, income: 0, expenses: 0, net: 0 };
      }
      if (tx.transaction_type === 'income') {
        monthlyData[month].income += parseFloat(tx.amount);
      } else if (['expense', 'tithe', 'loan_payment'].includes(tx.transaction_type)) {
        monthlyData[month].expenses += parseFloat(tx.amount);
      }
      monthlyData[month].net = monthlyData[month].income - monthlyData[month].expenses;
    });

    return { data: Object.values(monthlyData), error: null };
  } catch (error) {
    console.error('Error fetching monthly trends:', error);
    return { data: null, error };
  }
};

/**
 * Export data for privacy compliance (GDPR/data portability)
 */
export const exportUserData = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const [transactions, loans, goals, tithe, budgets, privacy] = await Promise.all([
      getTransactions({ limit: 10000, includeSensitive: true }),
      getLoans(),
      getGoals(),
      getTitheRecords(),
      getBudgets(null),
      getPrivacySettings()
    ]);

    return {
      data: {
        exportDate: new Date().toISOString(),
        userId: user.id,
        email: user.email,
        transactions: transactions.data,
        loans: loans.data,
        goals: goals.data,
        titheRecords: tithe.data,
        budgets: budgets.data,
        privacySettings: privacy.data
      },
      error: null
    };
  } catch (error) {
    console.error('Error exporting user data:', error);
    return { data: null, error };
  }
};

export default {
  // Transactions
  createTransaction,
  getTransactions,
  getFinancialSummary,
  updateTransaction,
  deleteTransaction,
  
  // Loans
  createLoan,
  getLoans,
  recordLoanPayment,
  
  // Goals
  createGoal,
  getGoals,
  updateGoalProgress,
  
  // Tithe
  recordTithe,
  getTitheRecords,
  
  // Budgets
  createBudget,
  getBudgets,
  
  // Privacy
  getPrivacySettings,
  updatePrivacySettings,
  
  // Blockchain
  queueForBlockchain,
  verifyBlockchainRecord,
  
  // Analytics
  getMonthlyTrends,
  exportUserData,
  
  // Utils
  generateDataHash
};
