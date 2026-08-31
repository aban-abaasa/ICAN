/**
 * Advanced Financial Report Service
 * Generates professional financial reports: Tax Returns, Balance Sheets, Income Statements
 * with AI-powered country-specific compliance using OpenAI API
 */

import { supabase as supabaseClient } from '../lib/supabase/client';
import { COUNTRIES } from '../constants/countries';

// Vite exposes browser environment variables through import.meta.env.
// Do not reference process.env: process is not defined in the browser bundle.
const OPENAI_API_KEY = import.meta.env?.VITE_OPENAI_API_KEY || '';

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

/**
 * Fetch a country's tax rules from the worldwide tax engine
 * (GET /api/tax-rules/:countryCode — backend/routes/taxRulesRoutes.js).
 *
 * Backed by public.country_tax_rules: a small hand-verified core (seeded via
 * ADD_COUNTRY_TAX_RULES.sql) plus AI-generated-and-cached rows for every
 * other country, since ICAN users can pick any country at signup. Throws on
 * failure rather than silently falling back to made-up numbers.
 */
export const fetchCountryTaxRules = async (countryCode) => {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!code) throw new Error('A country code is required to fetch tax rules');

  const response = await fetch(`/api/tax-rules/${code}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Could not load tax rules for ${code}`);
  }
  return response.json();
};

/**
 * Marginal tax over progressive brackets, e.g.
 * [{ upTo: 235000, rate: 0 }, { upTo: 335000, rate: 0.10 }, { upTo: null, rate: 0.40 }]
 * When the country's brackets are monthly (typical for PAYE-style regimes),
 * the annual taxable amount is converted to a monthly-equivalent, taxed
 * band-by-band, then annualized back — the standard approximation for
 * applying monthly PAYE bands to an annual figure.
 */
const calculateProgressiveTax = (taxableAmount, brackets = [], period = 'annual') => {
  if (!Array.isArray(brackets) || brackets.length === 0 || taxableAmount <= 0) return 0;

  const divisor = period === 'monthly' ? 12 : 1;
  const baseAmount = taxableAmount / divisor;

  let tax = 0;
  let lowerBound = 0;
  for (const band of brackets) {
    const upTo = band.upTo === null || band.upTo === undefined ? Infinity : Number(band.upTo);
    const rate = Number(band.rate) || 0;
    if (baseAmount <= lowerBound) break;
    const taxableInBand = Math.min(baseAmount, upTo) - lowerBound;
    if (taxableInBand > 0) tax += taxableInBand * rate;
    lowerBound = upTo;
    if (baseAmount <= upTo) break;
  }
  return tax * divisor;
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

    // Get Supabase session token for authentication
    let authHeaders = { 'Content-Type': 'application/json' };
    
    try {
      const { getSupabaseClient } = await import('../lib/supabase/client.js');
      const supabase = getSupabaseClient();
      
      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          authHeaders['Authorization'] = `Bearer ${session.access_token}`;
        }
      }
    } catch (err) {
      console.warn('⚠️ Could not retrieve Supabase session:', err.message);
    }

    // Prefer server-side proxy route to keep secrets out of the browser.
    const response = await fetch('/api/ai-analysis', {
      method: 'POST',
      headers: authHeaders,
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

  // Use real reporting_bucket values from SmartTransactionEntry and VelocityEngine.
  // Falls back to generic income/expense classification only when bucket is absent.
  const buckets = {
    sold_income:       0,
    bought_stock:      0,
    capital_asset:     0,
    operating_expense: 0,
    salary_expense:    0,
    tax_expense:       0,
    loan_inflow:       0,
    loan_repayment:    0,
    owner_equity:      0,
    dividend_income:   0,
    dividend_payout:   0,
    tithe_payment:     0,
    other_income:      0,
    other_expense:     0
  };

  const deductions = [];

  filtered.forEach((tx) => {
    const amount = Math.abs(toNumber(tx?.amount));
    const bucket = tx?.metadata?.reporting_bucket || tx?.reporting_bucket;

    if (bucket && Object.prototype.hasOwnProperty.call(buckets, bucket)) {
      buckets[bucket] += amount;
    } else {
      // Fallback: classify by transaction_type / generic kind
      const kind = getTransactionKind(tx);
      if (kind === 'income') buckets.other_income += amount;
      else if (kind === 'expense') buckets.other_expense += amount;
      else if (kind === 'investment') buckets.capital_asset += amount;
    }

    if (
      tx?.transaction_type === 'expense' ||
      ['bought_stock','operating_expense','salary_expense','tax_expense','loan_repayment','dividend_payout'].includes(bucket)
    ) {
      deductions.push({
        category: bucket || tx?.metadata?.category || tx?.transaction_type || 'business_expenses',
        amount,
        description: tx?.description || tx?.note || ''
      });
    }
  });

  const totalRevenue   = buckets.sold_income + buckets.dividend_income + buckets.loan_inflow + buckets.other_income;
  const totalCogs      = buckets.bought_stock;
  const totalOpex      = buckets.operating_expense + buckets.salary_expense + buckets.other_expense;
  const totalTax       = buckets.tax_expense;
  const totalExpenses  = totalCogs + totalOpex + totalTax;
  const totalAssets    = buckets.capital_asset + buckets.owner_equity;
  const netProfit      = totalRevenue - totalExpenses;

  return {
    // Income statement
    totalIncome:      totalRevenue,
    totalExpenses:    totalExpenses,
    businessIncome:   buckets.sold_income,
    investmentIncome: buckets.dividend_income,
    capitalGains:     0,
    taxPaid:          buckets.tax_expense,
    revenue:          buckets.sold_income,
    costOfGoodsSold:  buckets.bought_stock,
    operatingExpenses: buckets.operating_expense + buckets.salary_expense,
    otherIncome:      buckets.other_income,
    otherExpenses:    buckets.other_expense,
    taxExpense:       buckets.tax_expense,
    netProfit,
    // Balance sheet
    netWorth: totalAssets - (buckets.loan_inflow - buckets.loan_repayment),
    assets: {
      cash:        Math.max(0, netProfit),
      investments: buckets.dividend_income,
      equipment:   buckets.capital_asset,
      property:    0,
      other:       buckets.owner_equity
    },
    liabilities: {
      loans:       Math.max(0, buckets.loan_inflow - buckets.loan_repayment),
      creditCards: 0,
      payables:    0,
      other:       0
    },
    // Raw buckets for custom report sections
    buckets,
    deductions,
    reportPeriod,
    transactionCount: filtered.length,
    periodStart: start ? start.toISOString() : null,
    periodEnd:   end ? end.toISOString() : null
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
  const regulations = await fetchCountryTaxRules(countryCode);

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
  const incomeTax = calculateProgressiveTax(taxableIncome, regulations.personal_tax_brackets, regulations.personal_tax_period);
  const capitalGainsTax = capitalGains * (regulations.capital_gains_rate || 0);
  const totalTaxLiability = incomeTax + capitalGainsTax;
  const taxPayable = Math.max(0, totalTaxLiability - taxPaid);

  // Call OpenAI for tax optimization recommendations
  const aiAnalysis = await callOpenAIForAnalysis(
    `Analyze this tax return for ${regulations.country_name}:
    - Total Income: ${totalIncome}
    - Taxable Income: ${taxableIncome}
    - Tax Liability: ${totalTaxLiability}
    - Deductions: ${deductibleAmount}

    Provide 3 key tax optimization strategies specific to ${regulations.country_name}, considering ${regulations.regulatory_body} requirements.
    Focus on: maximizing deductions, timing strategies, and compliance.`,
    { country: regulations.country_name, year: filingPeriod, reportType: 'Tax Return' }
  );

  const taxReturn = {
    id: `TAX_${userId}_${filingPeriod}_${Date.now()}`,
    type: 'tax-return',
    country: countryCode,
    countryName: regulations.country_name,
    filingPeriod,
    filingDeadline: regulations.filing_date,
    currency: regulations.currency,
    taxRegulator: regulations.regulatory_body,
    dataSource: regulations.source,
    sourceCitation: regulations.source_citation,
    lastVerifiedAt: regulations.last_verified_at,

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
        .filter(d => (regulations.deductible_expenses || []).includes(d.category))
        .map(d => ({
          category: d.category,
          amount: d.amount,
          description: d.description || '',
          compliant: true
        })),
      totalDeductions: deductibleAmount,
      nonDeductible: deductions
        .filter(d => !(regulations.deductible_expenses || []).includes(d.category))
        .reduce((sum, d) => sum + (d.amount || 0), 0),
      description: `Deductions compliant with ${regulations.regulatory_body} requirements`
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
      incomeTaxRate: taxableIncome > 0 ? `${((incomeTax / taxableIncome) * 100).toFixed(1)}% (effective, progressive)` : '0.0%',
      personalTaxBrackets: regulations.personal_tax_brackets,
      incomeTax,
      capitalGainsTaxRate: ((regulations.capital_gains_rate || 0) * 100).toFixed(1) + '%',
      capitalGainsTax,
      otherTaxes: 0,
      totalTaxLiability,
      taxPaid,
      taxPayable: Math.max(0, taxPayable),
      description: `Tax calculated at applicable ${regulations.country_name} progressive rates`
    },

    // Compliance Requirements
    complianceRequirements: {
      requiredDocuments: regulations.requirements,
      filingStatus: taxPayable > 0 ? 'TAX PAYABLE' : taxPayable < 0 ? 'TAX REFUNDABLE' : 'ZERO LIABILITY',
      dueDate: regulations.filing_date,
      penalties: {
        lateFiling: 'Penalty of 10-20% of unpaid tax per month',
        missingDocumentation: 'Penalty of 5,000-50,000 ' + regulations.currency,
        inaccuracies: 'Penalty of 20-100% of understated tax'
      },
      description: `Full compliance with ${regulations.regulatory_body} requirements`
    },

    // AI-Powered Tax Optimization
    taxOptimization: {
      aiRecommendations: aiAnalysis || 'Tax optimization analysis pending',
      estimatedSavings: Math.round(totalTaxLiability * 0.15), // Estimated 15% savings from optimization
      strategies: [
        {
          strategy: 'Expense Maximization',
          impact: `Identify and document all ${(regulations.deductible_expenses || []).join(', ')}`,
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
      { item: `Verify ${regulations.country_name} tax regulations`, completed: false },
      { item: 'Consult with tax professional', completed: false },
      { item: `File with ${regulations.regulatory_body} by ${regulations.filing_date}`, completed: false },
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
  const regulations = await fetchCountryTaxRules(countryCode);

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
    
    Provide insights on financial health, solvency, and recommendations for improvement in ${regulations.country_name}.`,
    { country: regulations.country_name, reportType: 'Balance Sheet' }
  );

  const balanceSheet = {
    id: `BS_${userId}_${Date.now()}`,
    type: 'balance-sheet',
    reportDate,
    country: regulations.country_name,
    countryCode,
    currency: regulations.currency,
    dataSource: regulations.source,
    sourceCitation: regulations.source_citation,
    lastVerifiedAt: regulations.last_verified_at,

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
  const regulations = await fetchCountryTaxRules(countryCode);

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
    
    Provide insights on profitability, expense management, and growth opportunities in ${regulations.country_name}.`,
    { country: regulations.country_name, period: reportPeriod, reportType: 'Income Statement' }
  );

  const incomeStatement = {
    id: `IS_${userId}_${Date.now()}`,
    type: 'income-statement',
    reportPeriod,
    country: regulations.country_name,
    countryCode,
    currency: regulations.currency,
    dataSource: regulations.source,
    sourceCitation: regulations.source_citation,
    lastVerifiedAt: regulations.last_verified_at,

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
  const regulations = await fetchCountryTaxRules(countryCode);

  // Call OpenAI for country-specific compliance analysis
  const complianceAnalysis = await callOpenAIForAnalysis(
    `As a tax expert for ${regulations.country_name}, analyze these financials and provide a compliance checklist:
    - Regulatory Body: ${regulations.regulatory_body}
    - Filing Deadline: ${regulations.filing_date}
    - Required Documents: ${(regulations.requirements || []).join(', ')}

    What are the top 5 compliance priorities and how to ensure full adherence to ${regulations.country_name} tax laws?`,
    { country: regulations.country_name, reportType: 'Compliance Report' }
  );

  return {
    country: regulations.country_name,
    countryCode,
    regulatoryBody: regulations.regulatory_body,
    currency: regulations.currency,
    taxRates: {
      personalTaxBrackets: regulations.personal_tax_brackets,
      corporate: regulations.corporate_tax_rate,
      vat: regulations.vat_rate,
      capitalGains: regulations.capital_gains_rate
    },
    filingDeadline: regulations.filing_date,
    complianceAnalysis: complianceAnalysis || 'Compliance analysis pending',
    requiredDocuments: regulations.requirements,
    deductibleExpenses: regulations.deductible_expenses,
    dataSource: regulations.source,
    sourceCitation: regulations.source_citation,
    lastVerifiedAt: regulations.last_verified_at,
    generatedDate: new Date().toISOString()
  };
};

/**
 * List of world countries for the report country picker. Any country can be
 * selected — a hand-verified core has real tax rules seeded in the
 * country_tax_rules table, and every other country gets an AI-generated
 * (and cached) entry on first use via fetchCountryTaxRules/GET
 * /api/tax-rules/:countryCode. This no longer reads from a fixed local list.
 */
export const getSupportedCountries = () => COUNTRIES.map((c) => ({ code: c.code, name: c.name }));

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
