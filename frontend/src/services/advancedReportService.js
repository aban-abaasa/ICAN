/**
 * Advanced Financial Report Service
 * Generates professional financial reports: Tax Returns, Balance Sheets, Income Statements
 * with AI-powered country-specific compliance using OpenAI API
 */

import { supabase as supabaseClient } from '../lib/supabase/client';

const OPENAI_API_KEY = import.meta.env?.VITE_OPENAI_API_KEY || process.env?.REACT_APP_OPENAI_API_KEY;

const FINANCE_KNOWLEDGE_BRAIN = {
  pillars: [
    'Corporate finance',
    'Investments',
    'International finance',
    'Financial institutions'
  ],
  corporateFinance: {
    financialManagementDecisions: [
      'Capital budgeting',
      'Capital structure',
      'Working capital management'
    ],
    formsOfOrganization: [
      'Sole proprietorship',
      'Partnership',
      'Corporation'
    ],
    goalOfFinancialManagement: 'Maximize current value per share and long-term firm value using risk-adjusted cash flow decisions.',
    agencyProblemAndControls: [
      'Manager-owner incentive conflicts',
      'Performance-based compensation',
      'Board oversight and governance',
      'Market for corporate control'
    ]
  },
  analysisToolkit: {
    methods: [
      'Trend (horizontal) analysis',
      'Vertical (common-size) analysis',
      'Ratio analysis',
      'Cost-volume-profit and break-even analysis'
    ],
    decisionCategories: [
      'Big bet decisions',
      'Cross-cutting decisions',
      'Delegated decisions'
    ],
    rapidDecisionPrinciples: [
      'Clarify decision rights',
      'Use reversible decision logic where possible',
      'Use concise pre-reads',
      'Apply 70% information rule for reversible decisions',
      'Disagree and commit during execution'
    ]
  },
  personalFinancePrinciples: [
    'Live below your means',
    'Build and protect an emergency fund',
    'Repay high-interest debt quickly',
    'Invest in human capital'
  ],
  learningModules: [
    'Why study finance',
    'Financial analysis for firms',
    'Student money management principles',
    'Investment risk-return tradeoff'
  ],
  businessTermsDeepDive: {
    accountingAndReporting: [
      'Income statement',
      'Balance sheet',
      'Cash flow statement',
      'Accrual vs cash accounting'
    ],
    valuationAndCapitalAllocation: [
      'NPV',
      'IRR',
      'WACC',
      'DCF',
      'Payback period',
      'Risk-adjusted return'
    ],
    performanceAndUnitEconomics: [
      'Gross margin',
      'Operating margin',
      'Net margin',
      'CAC/LTV/churn',
      'Burn rate and runway',
      'Cash conversion cycle'
    ],
    strategyAndGovernance: [
      'SWOT',
      "Porter\'s Five Forces",
      'Pricing strategy and elasticity',
      'Corporate governance',
      'Risk management and compliance controls'
    ]
  }
};

const buildFinanceBrainInstruction = (context = {}) => {
  const financeBrain = JSON.stringify(FINANCE_KNOWLEDGE_BRAIN, null, 2);
  return `You are an expert financial advisor and tax consultant specializing in East African tax regulations.
Country: ${context.country || 'Uganda'}.
Report Type: ${context.reportType || 'General Financial Analysis'}.
Use the finance brain knowledge below as your reasoning framework and tie insights to practical actions.

FINANCE BRAIN
${financeBrain}

Output style:
- Keep recommendations specific, measurable, and compliance-aware.
- Prioritize cash flow discipline, risk management, and value creation.
- Use financial analysis methods where relevant: trend, common-size, ratio, or CVP.
- For business term requests, include: concise definition, formula or framework, interpretation, and practical next action.
- For reports, include key ratio interpretation and next best actions.`;
};

// Country Tax Regulations Configuration
const COUNTRY_REGULATIONS = {
  'UG': {
    name: 'Uganda',
    currency: 'UGX',
    taxRates: {
      corporate: 0.30,
      personal: 0.30,
      vat: 0.18,
      capitalGains: 0.20
    },
    deductibleExpenses: [
      'business_expenses',
      'depreciation',
      'employee_salaries',
      'utilities',
      'office_equipment',
      'professional_fees',
      'advertising'
    ],
    filingDate: 'June 30',
    regulatoryBody: 'Uganda Revenue Authority (URA)',
    requirements: [
      'Itemized expense records',
      'Income source documentation',
      'Investment proof',
      'Business registration'
    ]
  },
  'KE': {
    name: 'Kenya',
    currency: 'KES',
    taxRates: {
      corporate: 0.30,
      personal: 0.30,
      vat: 0.16,
      capitalGains: 0.15
    },
    deductibleExpenses: [
      'business_expenses',
      'depreciation',
      'employee_salaries',
      'utilities',
      'office_rent',
      'insurance'
    ],
    filingDate: 'June 30',
    regulatoryBody: 'Kenya Revenue Authority (KRA)',
    requirements: [
      'PIN (Personal Identification Number)',
      'Monthly ITR filing',
      'Expense receipts',
      'Bank statements'
    ]
  },
  'TZ': {
    name: 'Tanzania',
    currency: 'TZS',
    taxRates: {
      corporate: 0.30,
      personal: 0.30,
      vat: 0.18,
      capitalGains: 0.20
    },
    deductibleExpenses: [
      'business_expenses',
      'employee_compensation',
      'utilities',
      'office_supplies',
      'professional_services'
    ],
    filingDate: 'June 30',
    regulatoryBody: 'Tanzania Revenue Authority (TRA)',
    requirements: [
      'TIN (Tax Identification Number)',
      'Expense documentation',
      'Income records',
      'Annual reconciliation'
    ]
  },
  'RW': {
    name: 'Rwanda',
    currency: 'RWF',
    taxRates: {
      corporate: 0.30,
      personal: 0.30,
      vat: 0.18,
      capitalGains: 0.20
    },
    deductibleExpenses: [
      'business_operating_expenses',
      'employee_salaries',
      'utilities',
      'insurance',
      'depreciation'
    ],
    filingDate: 'March 31',
    regulatoryBody: 'Rwanda Revenue Authority (RRA)',
    requirements: [
      'TIN registration',
      'Monthly VAT returns',
      'Quarterly tax payments',
      'Detailed transaction logs'
    ]
  },
  'US': {
    name: 'United States',
    currency: 'USD',
    taxRates: {
      corporate: 0.21,
      personal: 0.37,
      vat: 0,
      capitalGains: 0.20
    },
    deductibleExpenses: [
      'business_expenses',
      'home_office',
      'vehicle_expenses',
      'education',
      'medical_insurance',
      'retirement_contributions'
    ],
    filingDate: 'April 15',
    regulatoryBody: 'Internal Revenue Service (IRS)',
    requirements: [
      'EIN or SSN',
      'Form 1099s',
      'Schedule C (Self-employed)',
      'Qualified business expense documentation'
    ]
  }
};

/**
 * Call OpenAI API for financial analysis and compliance recommendations
 */
export const callOpenAIForAnalysis = async (prompt, context = {}) => {
  try {
    const payload = {
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: buildFinanceBrainInstruction(context)
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.5,
      max_tokens: 1000
    };

    // Prefer server-side proxy route to keep secrets out of the browser.
    const response = await fetch('/api/ai-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      if (!OPENAI_API_KEY) {
        console.warn('OpenAI proxy unavailable and no direct OpenAI key configured');
        return null;
      }

      // Fallback for local/dev environments where API route may not be mounted.
      const directResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify(payload)
      });

      if (!directResponse.ok) {
        throw new Error(`OpenAI API error: ${directResponse.statusText}`);
      }

      const fallbackData = await directResponse.json();
      return fallbackData.choices[0]?.message?.content || null;
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || null;
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    return null;
  }
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getTransactionKind = (transaction) => {
  const candidates = [
    transaction?.type,
    transaction?.transaction_type,
    transaction?.category,
    transaction?.metadata?.reporting_bucket
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());

  const joined = candidates.join(' ');
  if (/income|credit|sale|sold|deposit|receive|topup|top_up|cash_in|dividend/.test(joined)) return 'income';
  if (/expense|debit|purchase|buy|bought|withdraw|cashout|cash_out|fee|cost/.test(joined)) return 'expense';
  if (/invest|investment|portfolio|share|stock|bond/.test(joined)) return 'investment';
  return 'other';
};

export const buildFinancialDataFromTransactions = (transactions = [], options = {}) => {
  const {
    startDate,
    endDate,
    reportPeriod = 'Monthly'
  } = options;

  const start = toDate(startDate);
  const end = toDate(endDate);

  const filtered = (Array.isArray(transactions) ? transactions : []).filter((tx) => {
    const txDate = toDate(tx?.created_at || tx?.date || tx?.timestamp || tx?.transaction_date);
    if (!txDate) return !start && !end;
    if (start && txDate < start) return false;
    if (end && txDate > end) return false;
    return true;
  });

  const totals = filtered.reduce((acc, tx) => {
    const amount = Math.abs(toNumber(tx?.amount));
    const kind = getTransactionKind(tx);

    if (kind === 'income') acc.income += amount;
    else if (kind === 'expense') acc.expenses += amount;
    else if (kind === 'investment') acc.investments += amount;

    return acc;
  }, { income: 0, expenses: 0, investments: 0 });

  return {
    totalIncome: totals.income,
    totalExpenses: totals.expenses,
    businessIncome: totals.income * 0.6,
    investmentIncome: totals.investments,
    capitalGains: Math.max(0, totals.income - totals.expenses) * 0.1,
    taxPaid: totals.income * 0.1,
    deductions: filtered
      .filter((tx) => getTransactionKind(tx) === 'expense')
      .map((tx) => ({
        category: tx.category || tx.transaction_type || 'business_expenses',
        amount: Math.abs(toNumber(tx.amount)),
        description: tx.description || tx.note || ''
      })),
    netWorth: totals.income - totals.expenses,
    assets: {
      cash: totals.income - totals.expenses,
      investments: totals.investments,
      equipment: 0,
      property: 0,
      other: 0
    },
    liabilities: {
      loans: 0,
      creditCards: 0,
      payables: totals.expenses * 0.2,
      other: 0
    },
    revenue: totals.income,
    costOfGoodsSold: totals.expenses * 0.4,
    operatingExpenses: totals.expenses * 0.4,
    otherIncome: 0,
    otherExpenses: 0,
    taxExpense: totals.income * 0.1,
    reportPeriod,
    transactionCount: filtered.length,
    periodStart: start ? start.toISOString() : null,
    periodEnd: end ? end.toISOString() : null
  };
};

const getWeekKey = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

const getPeriodRange = (periodType, anchorDate = new Date()) => {
  const end = new Date(anchorDate);
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  if (periodType === 'weekly') {
    start.setDate(end.getDate() - 6);
  } else {
    start.setDate(1);
  }
  start.setHours(0, 0, 0, 0);

  const key = periodType === 'weekly'
    ? getWeekKey(end)
    : `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;

  return { start, end, key };
};

const getDayKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getDayRange = (anchorDate = new Date()) => {
  const start = new Date(anchorDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(anchorDate);
  end.setHours(23, 59, 59, 999);
  return { start, end, key: getDayKey(anchorDate) };
};

const hasAutomatedReportForPeriod = async (userId, periodType, periodKey) => {
  const { data, error } = await supabaseClient
    .from('financial_reports')
    .select('id')
    .eq('user_id', userId)
    .eq('report_type', 'income-statement')
    .contains('tags', ['auto', periodType, periodKey])
    .limit(1);

  if (error) {
    console.error('Error checking automated report status:', error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
};

export const runAutomatedReportingCycle = async ({
  userId,
  transactions = [],
  countryCode = 'UG',
  periods = ['weekly', 'monthly']
}) => {
  if (!userId) return [];

  const normalizedPeriods = periods.filter((period) => period === 'weekly' || period === 'monthly');
  const outputs = [];

  for (const periodType of normalizedPeriods) {
    const { start, end, key } = getPeriodRange(periodType);
    const alreadyGenerated = await hasAutomatedReportForPeriod(userId, periodType, key);
    if (alreadyGenerated) {
      outputs.push({ periodType, periodKey: key, status: 'skipped-existing' });
      continue;
    }

    const financialData = buildFinancialDataFromTransactions(transactions, {
      startDate: start,
      endDate: end,
      reportPeriod: periodType === 'weekly' ? 'Weekly' : 'Monthly'
    });

    if (!financialData.transactionCount) {
      outputs.push({ periodType, periodKey: key, status: 'skipped-no-transactions' });
      continue;
    }

    const report = await generateIncomeStatement(financialData, countryCode, userId, {
      tags: ['auto', periodType, key],
      status: 'DRAFT',
      metadata: {
        automation: true,
        generatedFor: periodType,
        periodKey: key,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        transactionCount: financialData.transactionCount,
        financeBrainPillars: FINANCE_KNOWLEDGE_BRAIN.pillars
      }
    });

    outputs.push({ periodType, periodKey: key, status: 'generated', reportId: report.id });
  }

  return outputs;
};

const hasDailyArchiveForKey = async (userId, dayKey) => {
  const { data, error } = await supabaseClient
    .from('financial_reports')
    .select('id')
    .eq('user_id', userId)
    .eq('report_type', 'income-statement')
    .contains('tags', ['auto', 'daily-archive', dayKey])
    .limit(1);

  if (error) {
    console.error('Error checking daily archive status:', error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
};

export const runTransactionArchivingCycle = async ({
  userId,
  transactions = [],
  countryCode = 'UG',
  lookbackDays = 30
}) => {
  if (!userId || !Array.isArray(transactions) || transactions.length === 0) return [];

  const now = new Date();
  const todayKey = getDayKey(now);
  const groupedByDay = transactions.reduce((acc, tx) => {
    const txDate = toDate(tx?.created_at || tx?.date || tx?.timestamp || tx?.transaction_date);
    if (!txDate) return acc;

    const dayKey = getDayKey(txDate);
    if (!acc[dayKey]) acc[dayKey] = [];
    acc[dayKey].push(tx);
    return acc;
  }, {});

  const earliestAllowed = new Date(now);
  earliestAllowed.setDate(now.getDate() - Math.max(1, lookbackDays));
  const earliestKey = getDayKey(earliestAllowed);

  const archiveKeys = Object.keys(groupedByDay)
    .filter((dayKey) => dayKey < todayKey && dayKey >= earliestKey)
    .sort();

  const outputs = [];

  for (const dayKey of archiveKeys) {
    const alreadyArchived = await hasDailyArchiveForKey(userId, dayKey);
    if (alreadyArchived) {
      outputs.push({ dayKey, status: 'skipped-existing' });
      continue;
    }

    const dayTransactions = groupedByDay[dayKey] || [];
    const { start, end } = getDayRange(new Date(`${dayKey}T12:00:00`));
    const financialData = buildFinancialDataFromTransactions(dayTransactions, {
      startDate: start,
      endDate: end,
      reportPeriod: 'Daily'
    });

    if (!financialData.transactionCount) {
      outputs.push({ dayKey, status: 'skipped-no-transactions' });
      continue;
    }

    const archiveItems = dayTransactions.map((tx) => ({
      id: tx.id || null,
      created_at: tx.created_at || tx.date || tx.timestamp || null,
      transaction_type: tx.transaction_type || tx.type || 'unknown',
      amount: toNumber(tx.amount),
      currency: tx.currency || 'UGX',
      description: tx.description || tx.note || '',
      category: tx.category || tx.metadata?.category || null,
      metadata: tx.metadata || {}
    }));

    const report = await generateIncomeStatement(financialData, countryCode, userId, {
      tags: ['auto', 'daily-archive', dayKey],
      status: 'ARCHIVED',
      metadata: {
        archiveType: 'daily-transactions',
        dayKey,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        transactionCount: financialData.transactionCount,
        dailyTransactionItems: archiveItems,
        financeBrainPillars: FINANCE_KNOWLEDGE_BRAIN.pillars
      }
    });

    outputs.push({ dayKey, status: 'archived', reportId: report.id });
  }

  return outputs;
};

export const getDailyArchiveReports = async (userId, limit = 31) => {
  try {
    const { data, error } = await supabaseClient
      .from('financial_reports')
      .select('*')
      .eq('user_id', userId)
      .eq('report_type', 'income-statement')
      .contains('tags', ['daily-archive'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching daily archive reports:', error);
    return [];
  }
};

/**
 * Generate comprehensive tax return with country regulations
 */
export const generateTaxReturn = async (financialData, countryCode = 'UG', userId) => {
  const regulations = COUNTRY_REGULATIONS[countryCode];
  if (!regulations) {
    throw new Error(`Country code ${countryCode} not supported`);
  }

  const {
    totalIncome = 0,
    totalExpenses = 0,
    businessIncome = 0,
    investmentIncome = 0,
    capitalGains = 0,
    taxPaid = 0,
    deductions = [],
    filingPeriod = new Date().getFullYear()
  } = financialData;

  // Calculate taxable income
  const deductibleAmount = deductions
    .reduce((sum, d) => sum + (d.amount || 0), 0);
  const taxableIncome = Math.max(0, totalIncome - deductibleAmount);
  const incomeTax = taxableIncome * regulations.taxRates.personal;
  const capitalGainsTax = capitalGains * regulations.taxRates.capitalGains;
  const totalTaxLiability = incomeTax + capitalGainsTax;
  const taxPayable = Math.max(0, totalTaxLiability - taxPaid);

  // Call OpenAI for tax optimization recommendations
  const aiAnalysis = await callOpenAIForAnalysis(
    `Analyze this tax return for ${regulations.name}: 
    - Total Income: ${totalIncome}
    - Taxable Income: ${taxableIncome}
    - Tax Liability: ${totalTaxLiability}
    - Deductions: ${deductibleAmount}
    
    Provide 3 key tax optimization strategies specific to ${regulations.name}, considering ${regulations.regulatoryBody} requirements.
    Focus on: maximizing deductions, timing strategies, and compliance.`,
    { country: regulations.name, year: filingPeriod, reportType: 'Tax Return' }
  );

  const taxReturn = {
    id: `TAX_${userId}_${filingPeriod}_${Date.now()}`,
    type: 'tax-return',
    country: countryCode,
    countryName: regulations.name,
    filingPeriod,
    filingDeadline: regulations.filingDate,
    currency: regulations.currency,
    taxRegulator: regulations.regulatoryBody,
    
    // Income Section
    incomeSection: {
      businessIncome,
      investmentIncome,
      employmentIncome: totalIncome - businessIncome - investmentIncome,
      otherIncome: 0,
      totalGrossIncome: totalIncome,
      description: 'Gross income from all sources including business, investments, and employment'
    },

    // Deductions Section (Country-specific)
    deductionsSection: {
      personalDeductions: deductions
        .filter(d => regulations.deductibleExpenses.includes(d.category))
        .map(d => ({
          category: d.category,
          amount: d.amount,
          description: d.description || '',
          compliant: true
        })),
      totalDeductions: deductibleAmount,
      nonDeductible: deductions
        .filter(d => !regulations.deductibleExpenses.includes(d.category))
        .reduce((sum, d) => sum + (d.amount || 0), 0),
      description: `Deductions compliant with ${regulations.regulatoryBody} requirements`
    },

    // Taxable Income
    taxableIncomeSection: {
      grossIncome: totalIncome,
      totalDeductions: deductibleAmount,
      taxableIncome,
      description: 'Calculated as: Gross Income - Allowable Deductions'
    },

    // Tax Calculation (Country-specific rates)
    taxCalculation: {
      incomeTaxRate: (regulations.taxRates.personal * 100).toFixed(1) + '%',
      incomeTax,
      capitalGainsTaxRate: (regulations.taxRates.capitalGains * 100).toFixed(1) + '%',
      capitalGainsTax,
      otherTaxes: 0,
      totalTaxLiability,
      taxPaid,
      taxPayable: Math.max(0, taxPayable),
      description: `Tax calculated at applicable ${regulations.name} rates`
    },

    // Compliance Requirements
    complianceRequirements: {
      requiredDocuments: regulations.requirements,
      filingStatus: taxPayable > 0 ? 'TAX PAYABLE' : taxPayable < 0 ? 'TAX REFUNDABLE' : 'ZERO LIABILITY',
      dueDate: regulations.filingDate,
      penalties: {
        lateFiling: 'Penalty of 10-20% of unpaid tax per month',
        missingDocumentation: 'Penalty of 5,000-50,000 ' + regulations.currency,
        inaccuracies: 'Penalty of 20-100% of understated tax'
      },
      description: `Full compliance with ${regulations.regulatoryBody} requirements`
    },

    // AI-Powered Tax Optimization
    taxOptimization: {
      aiRecommendations: aiAnalysis || 'Tax optimization analysis pending',
      estimatedSavings: Math.round(totalTaxLiability * 0.15), // Estimated 15% savings from optimization
      strategies: [
        {
          strategy: 'Expense Maximization',
          impact: `Identify and document all ${regulations.deductibleExpenses.join(', ')}`,
          potentialSavings: Math.round(totalIncome * 0.10)
        },
        {
          strategy: 'Income Timing',
          impact: 'Defer income to next tax year where applicable',
          potentialSavings: Math.round(totalIncome * 0.05)
        },
        {
          strategy: 'Asset Protection',
          impact: 'Structure investments to minimize capital gains tax',
          potentialSavings: Math.round(capitalGains * 0.10)
        }
      ]
    },

    // Summary
    summary: {
      totalIncome,
      totalExpenses,
      netIncome: totalIncome - totalExpenses,
      taxableIncome,
      totalTaxLiability,
      taxPayable,
      generatedDate: new Date().toISOString(),
      status: 'DRAFT - Ready for Filing'
    },

    // Compliance Checklist
    complianceChecklist: [
      { item: 'Gather all income documentation', completed: false },
      { item: 'Organize expense receipts by category', completed: false },
      { item: `Verify ${regulations.name} tax regulations`, completed: false },
      { item: 'Consult with tax professional', completed: false },
      { item: `File with ${regulations.regulatoryBody} by ${regulations.filingDate}`, completed: false },
      { item: 'Pay tax liability if due', completed: false }
    ]
  };

  // Save to Supabase
  if (userId) {
    try {
      await supabaseClient
        .from('financial_reports')
        .insert([{
          user_id: userId,
          report_type: 'tax-return',
          country: countryCode,
          filing_period: filingPeriod,
          data: taxReturn,
          created_at: new Date().toISOString()
        }]);
    } catch (error) {
      console.error('Error saving tax return to Supabase:', error);
    }
  }

  return taxReturn;
};

/**
 * Generate Professional Balance Sheet
 */
export const generateBalanceSheet = async (financialData, countryCode = 'UG', userId) => {
  const regulations = COUNTRY_REGULATIONS[countryCode];

  const {
    assets = { cash: 0, investments: 0, equipment: 0, property: 0, other: 0 },
    liabilities = { loans: 0, creditCards: 0, payables: 0, other: 0 },
    equity = 0,
    reportDate = new Date()
  } = financialData;

  const totalAssets = Object.values(assets).reduce((a, b) => a + (b || 0), 0);
  const totalLiabilities = Object.values(liabilities).reduce((a, b) => a + (b || 0), 0);
  const totalEquity = totalAssets - totalLiabilities;

  // AI analysis for balance sheet health
  const aiAnalysis = await callOpenAIForAnalysis(
    `Analyze this balance sheet:
    - Total Assets: ${totalAssets}
    - Total Liabilities: ${totalLiabilities}
    - Total Equity: ${totalEquity}
    - Current Ratio: ${assets.cash / (totalLiabilities || 1)}
    
    Provide insights on financial health, solvency, and recommendations for improvement in ${regulations.name}.`,
    { country: regulations.name, reportType: 'Balance Sheet' }
  );

  const balanceSheet = {
    id: `BS_${userId}_${Date.now()}`,
    type: 'balance-sheet',
    reportDate,
    country: regulations.name,
    currency: regulations.currency,

    // Assets Section
    assets: {
      current: {
        cash: assets.cash || 0,
        investments: assets.investments || 0,
        receivables: 0,
        subtotal: (assets.cash || 0) + (assets.investments || 0)
      },
      nonCurrent: {
        equipment: assets.equipment || 0,
        property: assets.property || 0,
        otherAssets: assets.other || 0,
        subtotal: (assets.equipment || 0) + (assets.property || 0) + (assets.other || 0)
      },
      totalAssets
    },

    // Liabilities Section
    liabilities: {
      current: {
        creditCards: liabilities.creditCards || 0,
        payables: liabilities.payables || 0,
        subtotal: (liabilities.creditCards || 0) + (liabilities.payables || 0)
      },
      nonCurrent: {
        loans: liabilities.loans || 0,
        otherLiabilities: liabilities.other || 0,
        subtotal: (liabilities.loans || 0) + (liabilities.other || 0)
      },
      totalLiabilities
    },

    // Equity Section
    equity: {
      capital: equity || totalEquity,
      retained: totalEquity - (equity || totalEquity),
      totalEquity
    },

    // Financial Ratios
    ratios: {
      currentRatio: (assets.cash || 0) / (totalLiabilities || 1),
      debtToEquity: totalLiabilities / (totalEquity || 1),
      assetTurnover: totalAssets / (totalLiabilities || 1),
      equityRatio: totalEquity / totalAssets
    },

    // Balance Sheet Equation Verification
    verification: {
      assetsTotal: totalAssets,
      liabilitiesEquityTotal: totalLiabilities + totalEquity,
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1,
      equation: `Assets (${totalAssets}) = Liabilities (${totalLiabilities}) + Equity (${totalEquity})`
    },

    // AI Analysis
    healthAnalysis: {
      aiInsights: aiAnalysis || 'Financial health analysis pending',
      strengths: [],
      concerns: totalLiabilities > totalAssets * 0.5 ? ['High debt ratio'] : [],
      recommendations: [
        'Build emergency cash reserves',
        'Review and optimize debt structure',
        'Diversify asset allocation'
      ]
    },

    generatedDate: new Date().toISOString()
  };

  // Save to Supabase
  if (userId) {
    try {
      await supabaseClient
        .from('financial_reports')
        .insert([{
          user_id: userId,
          report_type: 'balance-sheet',
          country: countryCode,
          data: balanceSheet,
          created_at: new Date().toISOString()
        }]);
    } catch (error) {
      console.error('Error saving balance sheet to Supabase:', error);
    }
  }

  return balanceSheet;
};

/**
 * Generate Professional Income Statement
 */
export const generateIncomeStatement = async (financialData, countryCode = 'UG', userId, options = {}) => {
  const regulations = COUNTRY_REGULATIONS[countryCode];

  const {
    revenue = 0,
    costOfGoodsSold = 0,
    operatingExpenses = 0,
    otherIncome = 0,
    otherExpenses = 0,
    taxExpense = 0,
    reportPeriod = 'Monthly'
  } = financialData;

  const grossProfit = revenue - costOfGoodsSold;
  const operatingIncome = grossProfit - operatingExpenses;
  const incomeBeforeTax = operatingIncome + otherIncome - otherExpenses;
  const netIncome = incomeBeforeTax - taxExpense;
  const netProfitMargin = (netIncome / revenue * 100).toFixed(2);

  // AI analysis for profitability
  const aiAnalysis = await callOpenAIForAnalysis(
    `Analyze this income statement for ${reportPeriod}:
    - Revenue: ${revenue}
    - Gross Profit: ${grossProfit}
    - Operating Income: ${operatingIncome}
    - Net Income: ${netIncome}
    - Net Profit Margin: ${netProfitMargin}%
    
    Provide insights on profitability, expense management, and growth opportunities in ${regulations.name}.`,
    { country: regulations.name, period: reportPeriod, reportType: 'Income Statement' }
  );

  const incomeStatement = {
    id: `IS_${userId}_${Date.now()}`,
    type: 'income-statement',
    reportPeriod,
    country: regulations.name,
    currency: regulations.currency,

    // Revenue Section
    revenue: {
      mainRevenue: revenue,
      otherRevenue: otherIncome,
      totalRevenue: revenue + otherIncome
    },

    // Cost of Goods Sold
    costOfRevenue: {
      costOfGoodsSold,
      grossProfit,
      grossProfitMargin: ((grossProfit / (revenue + otherIncome) * 100) || 0).toFixed(2) + '%'
    },

    // Operating Expenses
    operatingExpenses: {
      salaries: 0,
      utilities: 0,
      marketing: 0,
      rent: 0,
      depreciation: 0,
      other: operatingExpenses,
      totalOperatingExpenses: operatingExpenses
    },

    // Operating Income
    operatingIncome: {
      amount: operatingIncome,
      margin: ((operatingIncome / (revenue + otherIncome) * 100) || 0).toFixed(2) + '%'
    },

    // Other Items
    otherItems: {
      otherIncome,
      otherExpenses,
      netOtherItems: otherIncome - otherExpenses
    },

    // Taxes
    taxes: {
      incomeBeforeTax,
      taxExpense,
      effectiveTaxRate: incomeBeforeTax > 0 ? (taxExpense / incomeBeforeTax * 100).toFixed(2) + '%' : '0%'
    },

    // Net Income
    netIncome: {
      amount: netIncome,
      margin: netProfitMargin + '%'
    },

    // Key Metrics
    metrics: {
      revenueGrowth: 0,
      profitGrowth: 0,
      operatingMargin: ((operatingIncome / (revenue + otherIncome) * 100) || 0).toFixed(2) + '%',
      netProfitMargin,
      expenseRatio: ((operatingExpenses / (revenue + otherIncome) * 100) || 0).toFixed(2) + '%'
    },

    // AI Profitability Analysis
    profitabilityAnalysis: {
      aiInsights: aiAnalysis || 'Profitability analysis pending',
      strengths: netProfitMargin > 15 ? ['Strong profit margins'] : [],
      concerns: operatingExpenses > revenue * 0.5 ? ['High operating expenses'] : [],
      recommendations: [
        'Review and optimize operating expenses',
        'Explore revenue growth opportunities',
        'Improve cost structure efficiency'
      ]
    },

    generatedDate: new Date().toISOString(),
    status: options.status || 'FINAL',
    metadata: {
      ...(options.metadata || {}),
      financeBrain: FINANCE_KNOWLEDGE_BRAIN
    }
  };

  // Save to Supabase
  if (userId) {
    try {
      await supabaseClient
        .from('financial_reports')
        .insert([{
          user_id: userId,
          report_type: 'income-statement',
          country: countryCode,
          status: options.status || 'DRAFT',
          tags: options.tags || [],
          data: incomeStatement,
          created_at: new Date().toISOString()
        }]);
    } catch (error) {
      console.error('Error saving income statement to Supabase:', error);
    }
  }

  return incomeStatement;
};

/**
 * Generate Country-Compliant Financial Report Summary
 */
export const generateCountryComplianceReport = async (financialData, countryCode = 'UG', userId) => {
  const regulations = COUNTRY_REGULATIONS[countryCode];
  if (!regulations) {
    throw new Error(`Country code ${countryCode} not supported`);
  }

  // Call OpenAI for country-specific compliance analysis
  const complianceAnalysis = await callOpenAIForAnalysis(
    `As a tax expert for ${regulations.name}, analyze these financials and provide a compliance checklist:
    - Regulatory Body: ${regulations.regulatoryBody}
    - Filing Deadline: ${regulations.filingDate}
    - Required Documents: ${regulations.requirements.join(', ')}
    
    What are the top 5 compliance priorities and how to ensure full adherence to ${regulations.name} tax laws?`,
    { country: regulations.name, reportType: 'Compliance Report' }
  );

  return {
    country: regulations.name,
    countryCode,
    regulatoryBody: regulations.regulatoryBody,
    currency: regulations.currency,
    taxRates: regulations.taxRates,
    filingDeadline: regulations.filingDate,
    complianceAnalysis: complianceAnalysis || 'Compliance analysis pending',
    requiredDocuments: regulations.requirements,
    deductibleExpenses: regulations.deductibleExpenses,
    generatedDate: new Date().toISOString()
  };
};

/**
 * Get all supported countries
 */
export const getSupportedCountries = () => {
  return Object.entries(COUNTRY_REGULATIONS).map(([code, data]) => ({
    code,
    name: data.name,
    currency: data.currency,
    regulatoryBody: data.regulatoryBody
  }));
};

/**
 * Fetch saved reports from Supabase
 */
export const getSavedReports = async (userId) => {
  try {
    const { data, error } = await supabaseClient
      .from('financial_reports')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching saved reports:', error);
    return [];
  }
};

/**
 * Export report as PDF, Excel, or JSON
 */
export const exportReport = (report, format = 'pdf') => {
  switch (format) {
    case 'json':
      return downloadJSON(report);
    case 'csv':
      return downloadCSV(report);
    case 'pdf':
      return downloadPDF(report);
    default:
      return downloadJSON(report);
  }
};

const downloadJSON = (report) => {
  const element = document.createElement('a');
  element.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  element.download = `${report.type}_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(element);
  element.click();
};

const downloadCSV = (report) => {
  // Simplified CSV export
  let csv = 'Report Type,Country,Date\n';
  csv += `${report.type},${report.country},${report.generatedDate}\n\n`;
  
  const element = document.createElement('a');
  element.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  element.download = `${report.type}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(element);
  element.click();
};

const downloadPDF = async (report) => {
  try {
    // Note: Requires html2pdf library
    const html2pdf = window.html2pdf;
    if (html2pdf) {
      html2pdf()
        .set({ margin: 10, filename: `${report.type}_${new Date().toISOString().slice(0, 10)}.pdf` })
        .fromHtml(`<div>${JSON.stringify(report)}</div>`)
        .save();
    } else {
      console.warn('html2pdf library not available');
      downloadJSON(report);
    }
  } catch (error) {
    console.error('Error exporting PDF:', error);
    downloadJSON(report);
  }
};

export default {
  generateTaxReturn,
  generateBalanceSheet,
  generateIncomeStatement,
  buildFinancialDataFromTransactions,
  runAutomatedReportingCycle,
  runTransactionArchivingCycle,
  generateCountryComplianceReport,
  getSupportedCountries,
  getSavedReports,
  getDailyArchiveReports,
  exportReport,
  callOpenAIForAnalysis
};
