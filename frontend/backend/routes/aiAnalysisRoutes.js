/**
 * AI Analysis Routes
 * 
 * Proxy for OpenAI API calls for transaction analysis
 * - Keeps OPENAI_API_KEY server-side (not exposed in browser)
 * - Handles Supabase authentication
 * - Provides fallback if API key is not configured
 * 
 * Routes:
 * POST /api/ai-analysis - Analyze transactions with AI
 */

const express = require('express');
const router = express.Router();

const buildFinanceTutorSystemPrompt = () => {
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
        "Porter's Five Forces",
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

/**
 * POST /api/ai-analysis
 * Analyze transactions or financial questions using OpenAI
 * 
 * Request body:
 * {
 *   model: 'gpt-3.5-turbo',
 *   messages: [
 *     { role: 'user', content: 'Analyze this transaction...' }
 *   ],
 *   temperature: 0.3,
 *   max_tokens: 500
 * }
 * 
 * Response:
 * {
 *   choices: [
 *     { message: { role: 'assistant', content: '...' } }
 *   ]
 * }
 */
router.post('/', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    // If no API key configured, return 503 (service unavailable)
    if (!apiKey) {
      console.warn('⚠️ OPENAI_API_KEY not configured in environment');
      return res.status(503).json({
        error: 'AI service not configured',
        message: 'OpenAI API key is not set. Please configure OPENAI_API_KEY in environment variables.',
        statusCode: 503
      });
    }

    // Extract and validate request body
    const incoming = req.body || {};
    
    if (!incoming.messages || !Array.isArray(incoming.messages)) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'messages field is required and must be an array',
        statusCode: 400
      });
    }

    // Build payload for OpenAI
    const upstreamPayload = {
      ...incoming,
      model: incoming.model || 'gpt-3.5-turbo',
      temperature: typeof incoming.temperature === 'number' ? incoming.temperature : 0.5,
      max_tokens: incoming.max_tokens || 900,
      messages: normalizeMessages(incoming.messages)
    };

    console.log(`🤖 Calling OpenAI API with model: ${upstreamPayload.model}`);

    // Call OpenAI API
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(upstreamPayload)
    });

    // Read response
    const data = await upstream.json();

    // If OpenAI returned an error, pass it through
    if (!upstream.ok) {
      console.error('❌ OpenAI API error:', data);
      return res.status(upstream.status).json(data);
    }

    console.log('✅ OpenAI response received successfully');
    return res.status(200).json(data);
  } catch (err) {
    console.error('❌ AI proxy error:', err);
    return res.status(502).json({
      error: 'AI proxy failed',
      message: err.message,
      statusCode: 502
    });
  }
});

module.exports = router;
