/**
 * 🧮 PROFESSIONAL ACCOUNTING INTELLIGENCE SERVICE
 * Uses OpenAI to classify transactions like a real accountant
 * Understands: Personal vs Business, Expenses vs Assets, Depreciation, etc.
 */

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

/**
 * 🎯 MAIN FUNCTION: Intelligent transaction classification
 * Acts like a real accountant analyzing business vs personal transactions
 */
export const analyzeTransactionAsAccountant = async (transactionInput) => {
  if (!OPENAI_API_KEY) {
    console.warn('⚠️ OpenAI API key not configured. Using fallback classification.');
    return fallbackAccountingClassification(transactionInput);
  }

  try {
    const accountingPrompt = `
You are a professional accountant with expertise in business and personal wealth management. 
Analyze the following transaction input and provide professional accounting classification.

TRANSACTION INPUT: "${transactionInput.description || transactionInput.text}"
AMOUNT: UGX ${transactionInput.amount?.toLocaleString() || 'Not specified'}
CONTEXT: User is ${transactionInput.userType || 'individual'} (business owner/freelancer/employed/other)

ANALYZE AND RESPOND WITH JSON containing:
{
  "classification": "EXPENSE|ASSET|LIABILITY|INCOME|MIXED",
  "accountingType": "operational_expense|capital_investment|fixed_asset|current_asset|depreciation|inventory|loan|revenue",
  "businessVsPersonal": "BUSINESS|PERSONAL|MIXED",
  "assetCategory": "vehicle|property|equipment|inventory|intangible|other" (if applicable),
  "depreciableAsset": true|false,
  "estimatedUsefulLife": "number in years" (if depreciable),
  "depreciationMethod": "straight_line|declining_balance|units_of_production" (if depreciable),
  "accountingTreatment": "Brief explanation of how this should be recorded",
  "journal_entries": [
    { "account": "Account Name", "debit": amount or null, "credit": amount or null }
  ],
  "tax_implications": "How this affects taxes",
  "confidence": 0.95,
  "reasoning": "Explain your classification"
}

RULES FOR CLASSIFICATION:
1. BUSINESS PURCHASES (van, equipment, property): Treat as CAPITAL INVESTMENT (asset), not expense
2. PERSONAL PURCHASES (clothing, food): Treat as EXPENSE
3. Mixed transactions: Break down appropriately
4. Large amounts (>1M UGX): Likely business investment - verify with language analysis
5. Keywords indicating assets: "bought", "purchased", "acquired", "invested in"
6. Keywords indicating expenses: "spent", "paid for", "cost", "bill"
7. Vehicle context: If business-related, it's a fixed asset; if personal, it's depreciated
    `;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3, // Low temperature for consistent accounting analysis
        messages: [
          {
            role: 'system',
            content: 'You are a professional accountant. Provide JSON responses only.'
          },
          {
            role: 'user',
            content: accountingPrompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse accounting analysis response');
    }

    const analysis = JSON.parse(jsonMatch[0]);
    
    console.log('💼 Accounting Classification:', analysis);
    return analysis;

  } catch (error) {
    console.error('❌ OpenAI accounting analysis failed:', error);
    return fallbackAccountingClassification(transactionInput);
  }
};

/**
 * 🔄 FALLBACK: Local accounting classification when OpenAI unavailable
 */
const fallbackAccountingClassification = (transactionInput) => {
  const description = (transactionInput.description || transactionInput.text || '').toLowerCase();
  const amount = transactionInput.amount || 0;

  // 🚗 VEHICLE ANALYSIS
  if (description.match(/van|car|vehicle|truck|motorbike|motorcycle|bus|transport/i)) {
    if (description.match(/business|commercial|work|fleet|company/i)) {
      return {
        classification: 'ASSET',
        accountingType: 'fixed_asset',
        businessVsPersonal: 'BUSINESS',
        assetCategory: 'vehicle',
        depreciableAsset: true,
        estimatedUsefulLife: 5,
        depreciationMethod: 'straight_line',
        accountingTreatment: 'Record as Fixed Asset (Vehicles/Transport). Monthly depreciation expense: UGX ' + Math.round(amount / 60).toLocaleString(),
        journal_entries: [
          { account: 'Fixed Assets - Vehicles', debit: amount, credit: null },
          { account: 'Cash/Bank', debit: null, credit: amount }
        ],
        tax_implications: 'Depreciation is tax-deductible. Track for CIP (Capital Investment Program).',
        confidence: 0.95,
        reasoning: 'Business vehicle purchase is a capital investment (fixed asset), not an expense.'
      };
    } else {
      // Personal vehicle
      return {
        classification: 'ASSET',
        accountingType: 'fixed_asset',
        businessVsPersonal: 'PERSONAL',
        assetCategory: 'vehicle',
        depreciableAsset: true,
        estimatedUsefulLife: 6,
        depreciationMethod: 'declining_balance',
        accountingTreatment: 'Personal asset - Record in Personal Assets. Not tax-deductible.',
        journal_entries: [
          { account: 'Personal Assets - Motor Vehicle', debit: amount, credit: null },
          { account: 'Cash/Bank', debit: null, credit: amount }
        ],
        tax_implications: 'Personal asset purchases are not tax-deductible. Depreciation applies for net worth tracking.',
        confidence: 0.90,
        reasoning: 'Personal vehicle is a depreciable asset.'
      };
    }
  }

  // 🏠 PROPERTY/REAL ESTATE
  if (description.match(/land|property|house|building|plot|real estate|apartment/i)) {
    return {
      classification: 'ASSET',
      accountingType: 'fixed_asset',
      businessVsPersonal: 'BUSINESS',
      assetCategory: 'property',
      depreciableAsset: description.match(/building|house|apartment/i) ? true : false,
      estimatedUsefulLife: 50,
      depreciationMethod: 'straight_line',
      accountingTreatment: 'Record as Fixed Asset (Land & Buildings)',
      journal_entries: [
        { account: 'Fixed Assets - Land', debit: amount * 0.2, credit: null },
        { account: 'Fixed Assets - Buildings', debit: amount * 0.8, credit: null },
        { account: 'Cash/Bank', debit: null, credit: amount }
      ],
      tax_implications: 'Land appreciation may be subject to capital gains tax. Depreciation on buildings is tax-deductible.',
      confidence: 0.95,
      reasoning: 'Property purchase is a major capital investment.'
    };
  }

  // 🏭 EQUIPMENT/MACHINERY
  if (description.match(/equipment|machinery|tools|computer|laptop|software|system/i)) {
    return {
      classification: 'ASSET',
      accountingType: 'fixed_asset',
      businessVsPersonal: 'BUSINESS',
      assetCategory: 'equipment',
      depreciableAsset: true,
      estimatedUsefulLife: 3,
      depreciationMethod: 'straight_line',
      accountingTreatment: 'Record as Fixed Asset - Equipment & Machinery',
      journal_entries: [
        { account: 'Fixed Assets - Equipment', debit: amount, credit: null },
        { account: 'Cash/Bank', debit: null, credit: amount }
      ],
      tax_implications: 'Depreciation expense reduces taxable income. May qualify for accelerated depreciation.',
      confidence: 0.93,
      reasoning: 'Business equipment is a capital asset.'
    };
  }

  // 💰 EXPENSE ANALYSIS
  if (description.match(/food|meal|lunch|dinner|breakfast|eat|drink|restaurant|cafe/i)) {
    return {
      classification: 'EXPENSE',
      accountingType: 'operational_expense',
      businessVsPersonal: 'PERSONAL',
      assetCategory: null,
      depreciableAsset: false,
      accountingTreatment: 'Expense - Meals & Entertainment',
      journal_entries: [
        { account: 'Meals & Entertainment Expense', debit: amount, credit: null },
        { account: 'Cash/Bank', debit: null, credit: amount }
      ],
      tax_implications: 'Meal expenses may have limited tax deductibility (50% in many jurisdictions).',
      confidence: 0.98,
      reasoning: 'Food purchases are consumable expenses.'
    };
  }

  // 👕 CLOTHING & PERSONAL ITEMS
  if (description.match(/clothes|shirt|dress|shoes|accessories|jewelry|bag|watch/i)) {
    return {
      classification: 'EXPENSE',
      accountingType: 'operational_expense',
      businessVsPersonal: 'PERSONAL',
      assetCategory: null,
      depreciableAsset: false,
      accountingTreatment: 'Expense - Personal Purchases',
      journal_entries: [
        { account: 'Personal Expense', debit: amount, credit: null },
        { account: 'Cash/Bank', debit: null, credit: amount }
      ],
      tax_implications: 'Personal clothing is not tax-deductible.',
      confidence: 0.98,
      reasoning: 'Personal apparel is an expense.'
    };
  }

  // DEFAULT: MIXED/UNKNOWN - Classify based on context
  const isLikelyBusiness = description.match(/business|work|office|commercial|trading|investment|capital/i);
  const amount_millions = amount / 1000000;
  const isLargeAmount = amount > 1000000;

  return {
    classification: isLargeAmount ? 'ASSET' : 'EXPENSE',
    accountingType: isLargeAmount ? 'capital_investment' : 'operational_expense',
    businessVsPersonal: isLikelyBusiness ? 'BUSINESS' : 'MIXED',
    assetCategory: isLargeAmount ? 'other' : null,
    depreciableAsset: isLargeAmount,
    estimatedUsefulLife: isLargeAmount ? 4 : null,
    depreciationMethod: isLargeAmount ? 'straight_line' : null,
    accountingTreatment: isLargeAmount 
      ? `Large transaction (UGX ${amount_millions.toFixed(1)}M) classified as asset. Review for specific asset type.`
      : 'Classified as operational expense. Review context for proper categorization.',
    journal_entries: isLargeAmount
      ? [
          { account: 'Fixed Assets - Other', debit: amount, credit: null },
          { account: 'Cash/Bank', debit: null, credit: amount }
        ]
      : [
          { account: 'Operating Expenses', debit: amount, credit: null },
          { account: 'Cash/Bank', debit: null, credit: amount }
        ],
    tax_implications: 'Consult accountant for tax treatment.',
    confidence: 0.70,
    reasoning: 'Unable to determine specific category. Amount and keywords suggest ' + (isLargeAmount ? 'asset' : 'expense') + '.'
  };
};

/**
 * 💾 Format transaction for accounting records
 */
export const formatTransactionForAccounting = (transaction, accountingAnalysis) => {
  return {
    // Original transaction data
    ...transaction,
    
    // Accounting classification
    accounting: {
      classification: accountingAnalysis.classification,
      accountingType: accountingAnalysis.accountingType,
      businessVsPersonal: accountingAnalysis.businessVsPersonal,
      assetCategory: accountingAnalysis.assetCategory,
      
      // Depreciation details (if applicable)
      depreciation: accountingAnalysis.depreciableAsset ? {
        isDepreciable: true,
        usefulLife: accountingAnalysis.estimatedUsefulLife,
        method: accountingAnalysis.depreciationMethod,
        monthlyDepreciation: Math.round(transaction.amount / (accountingAnalysis.estimatedUsefulLife * 12))
      } : {
        isDepreciable: false
      },
      
      // Journal entries
      journalEntries: accountingAnalysis.journal_entries,
      
      // Tax information
      taxTreatment: accountingAnalysis.tax_implications,
      
      // Professional note
      accountingTreatment: accountingAnalysis.accountingTreatment,
      confidence: accountingAnalysis.confidence,
      reasoning: accountingAnalysis.reasoning
    },
    
    // UI metadata
    displayAmount: transaction.amount,
    displaySign: accountingAnalysis.classification === 'EXPENSE' ? '-' : '+',
    displayType: accountingAnalysis.accountingType
  };
};

/**
 * 📊 Generate financial statement impact
 */
export const calculateFinancialImpact = (transaction, accountingAnalysis) => {
  const amount = transaction.amount;
  
  if (accountingAnalysis.classification === 'ASSET') {
    return {
      assetsChange: +amount,
      liabilitiesChange: 0,
      equityChange: 0,
      incomeChange: 0,
      expenseChange: 0,
      balanceSheetImpact: true,
      incomeStatementImpact: false,
      monthlyDepreciation: accountingAnalysis.depreciableAsset 
        ? Math.round(amount / (accountingAnalysis.estimatedUsefulLife * 12))
        : 0
    };
  } else if (accountingAnalysis.classification === 'EXPENSE') {
    return {
      assetsChange: -amount,
      liabilitiesChange: 0,
      equityChange: -amount,
      incomeChange: 0,
      expenseChange: +amount,
      balanceSheetImpact: true,
      incomeStatementImpact: true
    };
  } else if (accountingAnalysis.classification === 'INCOME') {
    return {
      assetsChange: +amount,
      liabilitiesChange: 0,
      equityChange: +amount,
      incomeChange: +amount,
      expenseChange: 0,
      balanceSheetImpact: true,
      incomeStatementImpact: true
    };
  }
  
  return {};
};

/**
 * 🎯 Smart transaction display formatter
 */
export const formatTransactionDisplay = (transaction, accountingAnalysis) => {
  const impact = calculateFinancialImpact(transaction, accountingAnalysis);
  
  return {
    icon: getTransactionIcon(accountingAnalysis),
    label: getTransactionLabel(accountingAnalysis),
    amount: transaction.amount,
    displayAmount: accountingAnalysis.classification === 'EXPENSE' 
      ? `-UGX ${transaction.amount.toLocaleString()}`
      : `+UGX ${transaction.amount.toLocaleString()}`,
    color: getTransactionColor(accountingAnalysis),
    category: accountingAnalysis.accountingType,
    tags: [accountingAnalysis.businessVsPersonal, accountingAnalysis.assetCategory].filter(Boolean),
    impact: impact
  };
};

/**
 * 🎨 Get icon based on transaction type
 */
const getTransactionIcon = (analysis) => {
  switch (analysis.accountingType) {
    case 'fixed_asset':
      return analysis.assetCategory === 'vehicle' ? '🚗' : 
             analysis.assetCategory === 'property' ? '🏠' :
             analysis.assetCategory === 'equipment' ? '🏭' : '📦';
    case 'operational_expense':
      return '💸';
    case 'revenue':
      return '💰';
    default:
      return '📊';
  }
};

/**
 * 📝 Get label based on transaction type
 */
const getTransactionLabel = (analysis) => {
  switch (analysis.accountingType) {
    case 'fixed_asset':
      return 'Capital Investment';
    case 'operational_expense':
      return 'Expense';
    case 'revenue':
      return 'Income';
    default:
      return analysis.classification;
  }
};

/**
 * 🎨 Get color based on classification
 */
const getTransactionColor = (analysis) => {
  switch (analysis.classification) {
    case 'ASSET':
      return 'blue'; // Assets are investments
    case 'EXPENSE':
      return 'red';
    case 'INCOME':
      return 'green';
    case 'LIABILITY':
      return 'orange';
    default:
      return 'gray';
  }
};

export default {
  analyzeTransactionAsAccountant,
  formatTransactionForAccounting,
  calculateFinancialImpact,
  formatTransactionDisplay
};
