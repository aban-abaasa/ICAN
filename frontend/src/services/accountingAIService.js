/**
 * Accounting AI Service - Uses OpenAI to provide real accounting analysis
 * Categorizes transactions using proper accounting principles
 * Handles: Investments, Expenses, Revenue, Cash Flow, Assets, Liabilities
 */

// Get API key from environment variables (Vite uses import.meta.env)
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || '';
const OPENAI_API_URL = import.meta.env.VITE_OPENAI_API_URL || 'https://api.openai.com/v1';

const ACCOUNTING_PROMPT = `You are a professional accountant specializing in business and personal wealth management.
Analyze this transaction CAREFULLY and classify it using proper accounting principles:

KEY RULES:
1. BUSINESS PURCHASES: Any vehicle, equipment, property purchased by a business is a FIXED ASSET (not expense!)
   - "bought van" = Fixed Asset (capitalize over 5 years)
   - "bought equipment" = Fixed Asset (capitalize over 3 years)
   - "bought property" = Fixed Asset (capitalize over 50 years)

2. PERSONAL PURCHASES: Groceries, clothes, meals are EXPENSES (not assets!)
   - "bought food" = Expense
   - "bought shirt" = Expense

3. INCOME: Any money received is REVENUE
   - "earned", "received", "sold", "got paid" = Revenue/Income

4. LOANS: Money borrowed creates a LIABILITY
   - "borrowed" = Liability/Loan
   - "got loan" = Liability

Transaction: {transaction}

RESPOND ONLY IN THIS JSON FORMAT - NO OTHER TEXT:
{
  "classification": "Asset|Liability|Equity|Revenue|Expense|Investment",
  "account": "specific account name from chart of accounts",
  "shouldCapitalize": true|false,
  "depreciation": {
    "isDepreciable": true|false,
    "yearsUsefulLife": 0,
    "monthlyDepreciation": 0
  },
  "businessVsPersonal": "BUSINESS|PERSONAL|MIXED",
  "justification": "WHY this classification",
  "displayType": "Asset|Expense|Income|Liability",
  "displaySign": "+|-|neutral",
  "displayFormat": "how to show in UI"
}`;


/**
 * Analyze transaction using OpenAI's accounting expertise
 */
export const analyzeTransactionWithAI = async (transaction) => {
  try {
    if (!OPENAI_API_KEY) {
      console.warn('⚠️ OpenAI API key not configured. Using fallback categorization.');
      return fallbackCategorization(transaction);
    }

    const prompt = ACCOUNTING_PROMPT.replace(
      '{transaction}',
      `${transaction.description} - ${transaction.amount} in ${transaction.type}`
    );

    const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a professional accountant. Provide accounting analysis in valid JSON format.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallbackCategorization(transaction);
    }

    const analysis = JSON.parse(jsonMatch[0]);
    
    // Determine display formatting based on classification
    let displayIcon = '📊';
    let displaySign = 'neutral';
    let displayColor = 'gray';
    
    if (analysis.classification === 'Asset') {
      displayIcon = analysis.account.includes('Vehicle') ? '🚗' : 
                   analysis.account.includes('Real Estate') ? '🏠' : '📦';
      displaySign = '+';
      displayColor = 'blue';
    } else if (analysis.classification === 'Expense') {
      displayIcon = '💸';
      displaySign = '-';
      displayColor = 'red';
    } else if (analysis.classification === 'Revenue') {
      displayIcon = '💰';
      displaySign = '+';
      displayColor = 'green';
    } else if (analysis.classification === 'Liability') {
      displayIcon = '⚠️';
      displaySign = '-';
      displayColor = 'orange';
    }
    
    return {
      ...transaction,
      accountingAnalysis: {
        classification: analysis.classification,
        account: analysis.account,
        shouldCapitalize: analysis.shouldCapitalize,
        depreciation: analysis.depreciation || {},
        businessVsPersonal: analysis.businessVsPersonal,
        justification: analysis.justification,
        displayType: analysis.displayType || analysis.classification,
        displayIcon: displayIcon,
        displaySign: displaySign,
        displayColor: displayColor,
        aiPowered: true,
        confidence: 0.95
      },
      // Override amount sign based on classification
      displayAmount: displaySign === '+' ? 
        `+UGX ${transaction.amount?.toLocaleString() || '0'}` :
        displaySign === '-' ? 
        `-UGX ${transaction.amount?.toLocaleString() || '0'}` :
        `UGX ${transaction.amount?.toLocaleString() || '0'}`,
      amountSign: displaySign
    };
  } catch (error) {
    console.error('❌ AI Analysis failed:', error);
    return fallbackCategorization(transaction);
  }
};

/**
 * Fallback categorization based on keywords (when AI is not available)
 */
const fallbackCategorization = (transaction) => {
  const text = transaction.description.toLowerCase();
  let classification = 'Expense';
  let account = 'General Expense';
  let shouldCapitalize = false;
  let displayIcon = '💸';
  let displaySign = '-';
  let displayColor = 'red';

  // Investment detection - fixed assets
  if (text.includes('van') || text.includes('vehicle') || text.includes('car') || text.includes('truck')) {
    classification = 'Asset';
    account = 'Property, Plant & Equipment - Vehicles';
    shouldCapitalize = true;
    displayIcon = '🚗';
    displaySign = '+';
    displayColor = 'blue';
  } else if (text.includes('equipment') || text.includes('machinery') || text.includes('computer')) {
    classification = 'Asset';
    account = 'Property, Plant & Equipment';
    shouldCapitalize = true;
    displayIcon = '🏭';
    displaySign = '+';
    displayColor = 'blue';
  } else if (text.includes('property') || text.includes('land') || text.includes('building')) {
    classification = 'Asset';
    account = 'Property, Plant & Equipment - Real Estate';
    shouldCapitalize = true;
    displayIcon = '🏠';
    displaySign = '+';
    displayColor = 'blue';
  } else if (text.includes('invested') || text.includes('investment')) {
    classification = 'Investment';
    account = 'Investments';
    shouldCapitalize = true;
    displayIcon = '📦';
    displaySign = '+';
    displayColor = 'blue';
  } else if (text.includes('salary') || text.includes('wage')) {
    classification = 'Expense';
    account = 'Salaries & Wages';
    shouldCapitalize = false;
    displayIcon = '💸';
    displaySign = '-';
    displayColor = 'red';
  } else if (text.includes('rent')) {
    classification = 'Expense';
    account = 'Rent Expense';
    shouldCapitalize = false;
    displayIcon = '💸';
    displaySign = '-';
    displayColor = 'red';
  } else if (text.includes('utility') || text.includes('electric') || text.includes('water')) {
    classification = 'Expense';
    account = 'Utilities';
    shouldCapitalize = false;
    displayIcon = '💸';
    displaySign = '-';
    displayColor = 'red';
  } else if (text.includes('sale') || text.includes('revenue') || text.includes('income') || text.includes('earned')) {
    classification = 'Revenue';
    account = 'Sales Revenue';
    shouldCapitalize = false;
    displayIcon = '💰';
    displaySign = '+';
    displayColor = 'green';
  }

  return {
    ...transaction,
    accountingAnalysis: {
      classification,
      account,
      shouldCapitalize,
      justification: 'Categorized based on transaction keywords',
      displayIcon: displayIcon,
      displaySign: displaySign,
      displayColor: displayColor,
      aiPowered: false,
      confidence: 0.70
    },
    // Override amount sign based on classification
    displayAmount: displaySign === '+' ? 
      `+UGX ${transaction.amount?.toLocaleString() || '0'}` :
      displaySign === '-' ? 
      `-UGX ${transaction.amount?.toLocaleString() || '0'}` :
      `UGX ${transaction.amount?.toLocaleString() || '0'}`,
    amountSign: displaySign
  };
};

/**
 * Generate accounting summary for business insights
 */
export const generateAccountingSummary = (transactions) => {
  const categories = {
    assets: [],
    liabilities: [],
    revenue: [],
    expenses: [],
    investments: []
  };

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalRevenue = 0;
  let totalExpenses = 0;
  let totalInvestments = 0;

  transactions.forEach(tx => {
    const amount = tx.amount || 0;
    const analysis = tx.accountingAnalysis;

    if (!analysis) return;

    switch (analysis.classification) {
      case 'Asset':
        categories.assets.push({ ...tx, account: analysis.account });
        totalAssets += amount;
        break;
      case 'Liability':
        categories.liabilities.push({ ...tx, account: analysis.account });
        totalLiabilities += amount;
        break;
      case 'Revenue':
        categories.revenue.push({ ...tx, account: analysis.account });
        totalRevenue += amount;
        break;
      case 'Expense':
        categories.expenses.push({ ...tx, account: analysis.account });
        totalExpenses += amount;
        break;
      case 'Investment':
        categories.investments.push({ ...tx, account: analysis.account });
        totalInvestments += amount;
        break;
      default:
        break;
    }
  });

  const netIncome = totalRevenue - totalExpenses;
  const totalEquity = totalAssets - totalLiabilities;

  return {
    categories,
    summary: {
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalRevenue,
      totalExpenses,
      netIncome,
      profitMargin: totalRevenue > 0 ? ((netIncome / totalRevenue) * 100).toFixed(2) : 0,
      investmentTotal: totalInvestments
    },
    insights: generateInsights(categories, { totalRevenue, totalExpenses, netIncome, totalAssets, totalInvestments })
  };
};

/**
 * Generate intelligent accounting insights
 */
const generateInsights = (categories, financials) => {
  const insights = [];

  // Revenue insights
  if (financials.totalRevenue > 0) {
    insights.push({
      type: 'revenue',
      title: '📈 Revenue Performance',
      message: `Total revenue of ${financials.totalRevenue.toLocaleString()} recorded`,
      emoji: '💰'
    });
  }

  // Expense insights
  if (financials.totalExpenses > 0) {
    const expenseRatio = financials.totalRevenue > 0 
      ? ((financials.totalExpenses / financials.totalRevenue) * 100).toFixed(1)
      : 'N/A';
    
    insights.push({
      type: 'expenses',
      title: '💸 Operating Expenses',
      message: `${financials.totalExpenses.toLocaleString()} in expenses${expenseRatio !== 'N/A' ? ` (${expenseRatio}% of revenue)` : ''}`,
      emoji: '📉'
    });
  }

  // Profitability insights
  if (financials.netIncome > 0) {
    insights.push({
      type: 'profit',
      title: '✅ Profitable',
      message: `Net income of ${financials.netIncome.toLocaleString()} - Good profitability!`,
      emoji: '🎯'
    });
  } else if (financials.netIncome < 0) {
    insights.push({
      type: 'loss',
      title: '⚠️ Operating Loss',
      message: `Net loss of ${Math.abs(financials.netIncome).toLocaleString()} - Review expenses`,
      emoji: '🚨'
    });
  }

  // Asset insights
  if (financials.totalAssets > 0) {
    insights.push({
      type: 'assets',
      title: '🏢 Fixed Assets',
      message: `${financials.totalAssets.toLocaleString()} in assets recorded`,
      emoji: '🏭'
    });
  }

  // Investment insights
  if (financials.totalInvestments > 0) {
    insights.push({
      type: 'investments',
      title: '💎 Capital Investments',
      message: `${financials.totalInvestments.toLocaleString()} invested in fixed assets`,
      emoji: '📊'
    });
  }

  return insights;
};

export default {
  analyzeTransactionWithAI,
  generateAccountingSummary
};
