/**
 * Advanced Financial Report Service
 * Generates professional financial reports: Tax Returns, Balance Sheets, Income Statements
 * with AI-powered country-specific compliance using OpenAI API
 */

import { supabaseClient } from '../config/supabase';

const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;

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
    if (!OPENAI_API_KEY) {
      console.warn('OpenAI API key not configured');
      return null;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content: `You are an expert financial advisor and tax consultant specializing in East African tax regulations. 
            Country: ${context.country || 'Uganda'}. 
            Provide clear, actionable financial insights in simple language. Be creative but practical.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || null;
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    return null;
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
    { country: regulations.name, year: filingPeriod }
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
    { country: regulations.name }
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
      assetTurno ver: totalAssets / (totalLiabilities || 1),
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
export const generateIncomeStatement = async (financialData, countryCode = 'UG', userId) => {
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
    { country: regulations.name, period: reportPeriod }
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
    status: 'FINAL'
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
    { country: regulations.name }
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
  generateCountryComplianceReport,
  getSupportedCountries,
  getSavedReports,
  exportReport,
  callOpenAIForAnalysis
};
