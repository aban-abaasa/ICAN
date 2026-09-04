/**
 * Vercel Serverless Function — AI proxy for accounting AI analysis
 *
 * Keeps API keys server-side (OPENAI_API_KEY / GEMINI_API_KEY env vars in
 * the Vercel dashboard). The browser never sees either key and CORS is
 * never an issue. When both are configured, callAI() races them and uses
 * whichever responds first — see api/_lib/aiProvider.js.
 *
 * Route: POST /api/ai-analysis
 */

import { callAI } from './_lib/aiProvider.js';

const FINANCE_TUTOR_PACK = {
  pillars: [
    'Corporate finance',
    'Investments',
    'International finance',
    'Financial institutions'
  ],
  corporateFinance: {
    coreDecisions: [
      'Capital budgeting',
      'Capital structure',
      'Working capital management'
    ],
    formsOfBusinessOrganization: [
      'Sole proprietorship',
      'Partnership',
      'Corporation'
    ],
    goalOfFinancialManagement: 'Maximize long-term firm value and shareholder wealth.',
    agencyProblem: [
      'Principal-agent conflicts',
      'Incentive alignment',
      'Board oversight',
      'Market for corporate control'
    ]
  },
  analysisToolkit: {
    methods: [
      'Horizontal (trend) analysis',
      'Vertical (common-size) analysis',
      'Ratio analysis',
      'Cost-volume-profit and break-even analysis'
    ],
    decisionModels: [
      'Big bet decisions',
      'Cross-cutting decisions',
      'Delegated decisions',
      'Rapid decision systems (clear decision rights, reversible decisions, 70% rule)'
    ]
  },
  businessTermsDeepDive: {
    accountingAndStatements: [
      'Income statement',
      'Balance sheet',
      'Cash flow statement',
      'Accrual vs cash basis'
    ],
    valuationAndInvestmentDecisions: [
      'NPV',
      'IRR',
      'WACC',
      'Discounted cash flow (DCF)',
      'Risk-return tradeoff'
    ],
    operatingAndGrowthMetrics: [
      'Gross margin, operating margin, net margin',
      'Unit economics (CAC, LTV, churn)',
      'Burn rate and runway',
      'Cash conversion cycle (CCC)'
    ],
    strategyAndGovernance: [
      'SWOT analysis',
      "Porter\'s Five Forces",
      'Corporate governance',
      'Compliance and internal controls',
      'Enterprise risk management (ERM)'
    ]
  },
  moneyPrinciples: [
    'Live below your means',
    'Build emergency fund',
    'Repay high-interest debt quickly',
    'Invest in human capital'
  ]
};

const buildFinanceTutorSystemPrompt = () => {
  const knowledge = JSON.stringify(FINANCE_TUTOR_PACK, null, 2);
  return `You are ICAN Copilot. Always apply this finance tutor knowledge to reasoning, explanations, and recommendations.

FINANCE TUTOR PACK
${knowledge}

Behavior rules:
- Be concise and practical.
- Use bullets for clarity.
- For concept questions, define clearly and offer one next learning step.
- For business term questions, provide: definition, formula/framework (if relevant), practical example, and one decision use-case.
- For financial advice, prioritize risk-adjusted value creation, cash flow discipline, and compliance awareness.`;
};

const normalizeMessages = (messages = []) => {
  const normalized = Array.isArray(messages) ? messages.filter((m) => m && m.role && m.content) : [];
  return [
    { role: 'system', content: buildFinanceTutorSystemPrompt() },
    ...normalized
  ];
};

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const incoming = req.body || {};
    const messages = normalizeMessages(incoming.messages);
    const temperature = typeof incoming.temperature === 'number' ? incoming.temperature : 0.5;
    const maxTokens = incoming.max_tokens || 900;

    let result;
    try {
      result = await callAI({ messages, temperature, maxTokens });
    } catch (aiError) {
      // No provider configured, or both failed → tell client to use fallback
      return res.status(503).json({ error: 'AI service not configured', detail: aiError.message });
    }

    // Keep the response OpenAI-shaped (choices[0].message.content) regardless
    // of which provider actually served it — the frontend always reads
    // data.choices[0]?.message?.content.
    return res.status(200).json({
      choices: [{ message: { role: 'assistant', content: result.content } }],
      provider: result.provider
    });
  } catch (err) {
    console.error('AI proxy error:', err);
    return res.status(502).json({ error: 'AI proxy failed', detail: err.message });
  }
}
