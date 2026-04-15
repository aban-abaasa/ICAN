import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Search, Zap, Wallet, TrendingUp, Brain, PieChart,
  Users, Briefcase, Settings, Send, Bot, AlertCircle,
  Sparkles, ChevronRight, ArrowLeft, Clock, Hash,
  DollarSign, Activity, FileText
} from 'lucide-react';

/**
 * ICAN Search + Copilot Modal
 * Tab 1 — Instant search across features, transactions, wallets
 * Tab 2 — ICAN Copilot: real OpenAI proxy, full financial context
 */
const SearchModal = ({ isOpen, onClose, user, transactions = [], wallets = [], onNavigate }) => {
  const [tab, setTab] = useState('copilot');

  /* Search */
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults]         = useState([]);
  const searchRef = useRef(null);

  /* Copilot */
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  const tools = [
    { id:'transactions', name:'Transactions',  icon:TrendingUp, color:'from-blue-600 to-blue-400',    description:'View and manage all financial transactions', keywords:['transaction','money','payment','income','expense','cash'] },
    { id:'wallets',      name:'Wallets',        icon:Wallet,     color:'from-green-600 to-green-400',   description:'Manage personal, business, agent & trust wallets', keywords:['wallet','account','balance','fund'] },
    { id:'ican-coin',    name:'ICAN Coin',       icon:Zap,        color:'from-yellow-600 to-yellow-400', description:'Buy, sell and trade ICAN Coins across borders', keywords:['ican','coin','crypto','trading','exchange'] },
    { id:'pitching',     name:'ICAN Pitchin',    icon:Briefcase,  color:'from-purple-600 to-purple-400', description:'Create and manage business pitches for investment', keywords:['pitch','investment','business','funding'] },
    { id:'trust',        name:'Trust System',    icon:Users,      color:'from-indigo-600 to-indigo-400', description:'Build trust groups and manage collaborative finances', keywords:['trust','group','collaboration','members'] },
    { id:'cmms',         name:'CMMS Module',     icon:Activity,   color:'from-cyan-600 to-cyan-400',    description:'Manage inventory, equipment and maintenance', keywords:['cmms','inventory','equipment','maintenance','assets'] },
    { id:'reports',      name:'Reports',         icon:PieChart,   color:'from-pink-600 to-pink-400',    description:'Generate financial reports and analytics', keywords:['report','analysis','analytics','insights'] },
    { id:'profile',      name:'Profile',         icon:Settings,   color:'from-slate-500 to-slate-400',  description:'Manage account settings and preferences', keywords:['profile','settings','account','preferences'] },
    { id:'ai-copilot',   name:'AI Copilot',      icon:Brain,      color:'from-teal-600 to-teal-400',    description:'Get AI-powered financial advice and insights', keywords:['ai','copilot','advice','help','suggestion'] },
  ];

  useEffect(() => {
    if (isOpen) {
      if (tab === 'search') setTimeout(() => searchRef.current?.focus(), 80);
      if (tab === 'copilot') {
        setTimeout(() => inputRef.current?.focus(), 80);
        if (messages.length === 0) initCopilot();
      }
    }
  }, [isOpen, tab]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  /* ---- SEARCH ---- */
  const handleSearch = useCallback((q) => {
    setSearchQuery(q);
    if (!q.trim()) { setResults([]); return; }
    const ql = q.toLowerCase();
    const toolHits = tools
      .filter(t => t.name.toLowerCase().includes(ql) || t.description.toLowerCase().includes(ql) || t.keywords.some(k => k.includes(ql)))
      .map(t => ({ type: 'tool', data: t }));
    const txHits = (transactions || [])
      .filter(t => (t.description?.toLowerCase().includes(ql)) || (t.category?.toLowerCase().includes(ql)) || (t.transaction_type?.toLowerCase().includes(ql)))
      .slice(0, 6)
      .map(t => ({ type: 'transaction', data: t }));
    setResults([...toolHits, ...txHits]);
  }, [transactions]);

  const handleToolClick = (tool) => {
    onClose();
    if (onNavigate) onNavigate(tool.id);
  };

  /* ---- COPILOT ---- */
  const initCopilot = () => {
    setMessages([{
      id: 'init', role: 'assistant',
      content: `Hi${user?.name ? ` ${user.name.split(' ')[0]}` : ''}! I'm your ICAN Copilot. Ask me anything about your finances.`,
    }]);
  };

  const getInvestmentSnapshot = () => {
    const tx = transactions || [];
    const investSignal = (t) => {
      const type = (t.transaction_type || '').toLowerCase();
      const category = (t.category || '').toLowerCase();
      const description = (t.description || '').toLowerCase();
      const combined = `${category} ${description}`;
      return (
        ['investment', 'invest', 'capital', 'asset'].includes(type) ||
        /(invest|investment|share|stock|equity|bond|fund|portfolio|crypto|ican coin|pitch|stake)/.test(combined)
      );
    };

    const isReturn = (t) => {
      const type = (t.transaction_type || '').toLowerCase();
      const category = (t.category || '').toLowerCase();
      const description = (t.description || '').toLowerCase();
      const combined = `${category} ${description}`;
      return type === 'income' && /(dividend|interest|roi|return|profit|yield|capital gain)/.test(combined);
    };

    const investmentTx = tx.filter(investSignal);
    const returnTx = tx.filter(isReturn);
    const totalInvested = investmentTx.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalReturns = returnTx.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const netPosition = totalReturns - totalInvested;
    const topInvestments = [...investmentTx]
      .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
      .slice(0, 3);

    return {
      investmentTx,
      totalInvested,
      totalReturns,
      netPosition,
      topInvestments,
    };
  };

  const normalizeFinanceQuery = (query = '') => {
    let normalized = String(query || '').toLowerCase();

    const replacements = [
      [/\binvetments?\b/g, 'investments'],
      [/\binvetment\b/g, 'investment'],
      [/\bcoporate\b/g, 'corporate'],
      [/\bfinace\b/g, 'finance'],
      [/\bfuncial\b/g, 'financial'],
      [/\bquetions\b/g, 'questions'],
      [/\binstitution\s*finance\b/g, 'financial institutions'],
      [/\binstitutional\s*finance\b/g, 'financial institutions'],
      [/\bbreakeven\b/g, 'break even'],
      [/\bcost\s*volume\s*profit\b/g, 'cost-volume-profit']
    ];

    replacements.forEach(([pattern, replacement]) => {
      normalized = normalized.replace(pattern, replacement);
    });

    return normalized.replace(/\s+/g, ' ').trim();
  };

  const isFinanceQuestion = (normalizedQuery = '') => {
    return /(finance|financial|corporate|investment|investments|portfolio|asset|equity|stock|bond|roi|return|international|forex|exchange rate|institution|bank|insurance|budget|saving|debt|loan|cash flow|working capital|capital budgeting|capital structure|agency problem|ratio analysis|horizontal analysis|vertical analysis|trend analysis|cvp|break even|business organization|sole proprietorship|partnership|corporation|managerial finance|financial manager|profit|maximize value|shareholder wealth)/.test(normalizedQuery);
  };

  const getBusinessTermResponse = (normalizedQuery = '') => {
    const q = normalizedQuery;

    if (/(accounting|bookkeeping|journal entry|trial balance)/.test(q)) {
      return `Accounting basics:\n• Accounting records and reports financial events for decisions\n• Core statements: income statement, balance sheet, cash flow\n• Bookkeeping captures entries; accounting interprets and reports\n\nDo you want a quick walkthrough of the 3 statements?`;
    }

    if (/(income statement|profit and loss|p&l|balance sheet|cash flow statement|financial statements)/.test(q)) {
      return `Core financial statements:\n• Income statement: performance over a period (revenue, costs, profit)\n• Balance sheet: position at a point in time (assets, liabilities, equity)\n• Cash flow statement: operating, investing, financing cash movements\n\nWant me to map your latest transactions into these 3 views?`;
    }

    if (/(gross margin|operating margin|net margin|ebitda|ebit)/.test(q)) {
      return `Profitability terms:\n• Gross margin = (Revenue - COGS) / Revenue\n• Operating margin = Operating income / Revenue\n• Net margin = Net income / Revenue\n• EBITDA approximates operating cash earnings before non-cash and financing effects\n\nShare your revenue and costs, and I will compute each margin.`;
    }

    if (/(liquidity|solvency|leverage|current ratio|quick ratio|debt to equity|interest coverage)/.test(q)) {
      return `Financial health ratios:\n• Liquidity: ability to meet short-term obligations (current/quick ratio)\n• Solvency: long-term survival (debt ratios, coverage ratios)\n• Leverage: debt intensity in capital structure\n\nI can compute and interpret these from your report figures.`;
    }

    if (/(valuation|npv|irr|wacc|discount rate|capm|terminal value|dcf|present value)/.test(q)) {
      return `Valuation toolkit:\n• NPV: present value of inflows minus outflows (accept if NPV > 0)\n• IRR: discount rate where NPV = 0\n• WACC: blended required return used as discount rate\n• DCF: values a business from risk-adjusted future cash flows\n\nWant an example with your own project numbers?`;
    }

    if (/(working capital|inventory turnover|receivables|payables|cash conversion cycle|ccc)/.test(q)) {
      return `Working capital management:\n• Optimize receivables collection, inventory days, and payables timing\n• Cash Conversion Cycle = DIO + DSO - DPO\n• Lower CCC usually improves liquidity and reduces financing pressure\n\nShould I show a simple CCC improvement plan?`;
    }

    if (/(cost of capital|capital structure|debt financing|equity financing|dividend policy)/.test(q)) {
      return `Capital structure fundamentals:\n• Choose debt/equity mix that minimizes cost of capital at acceptable risk\n• Debt gives tax shield but adds default risk\n• Equity is flexible but dilutes ownership\n\nWant a debt-vs-equity decision checklist?`;
    }

    if (/(unit economics|cac|ltv|churn|runway|burn rate|contribution margin|break even|breakeven)/.test(q)) {
      return `Unit economics and startup metrics:\n• CAC: cost to acquire one customer\n• LTV: lifetime gross profit from one customer\n• Burn rate and runway measure survival time\n• Break-even occurs when total contribution covers fixed costs\n\nI can build these metrics from your monthly data.`;
    }

    if (/(pricing strategy|price elasticity|markup|markdown|value based pricing)/.test(q)) {
      return `Pricing strategy basics:\n• Cost-plus: price = cost + markup\n• Value-based: price by customer value perception\n• Elasticity helps estimate demand response to price changes\n\nWant a simple pricing model using your current margins?`;
    }

    if (/(swot|porter|five forces|competitive advantage|moat|market share|go to market|gtm)/.test(q)) {
      return `Business strategy terms:\n• SWOT: strengths, weaknesses, opportunities, threats\n• Porter's Five Forces: competition, entrants, substitutes, supplier power, buyer power\n• Competitive advantage comes from cost leadership, differentiation, or focus\n\nShould I turn this into a one-page strategy template?`;
    }

    if (/(governance|board of directors|audit|internal control|compliance|risk management|erm)/.test(q)) {
      return `Governance and risk controls:\n• Governance aligns management actions with owner interests\n• Internal controls and audits reduce fraud/error risk\n• Compliance and ERM protect legal and operational resilience\n\nWant a practical governance checklist for your business?`;
    }

    if (/(supply chain|procurement|logistics|inventory management|operations management)/.test(q)) {
      return `Operations and supply chain:\n• Procurement secures inputs at right cost/quality/time\n• Logistics moves goods efficiently across the chain\n• Inventory policies balance service level vs holding cost\n\nI can provide KPI targets (fill rate, stock turns, lead time) if you want.`;
    }

    if (/(marketing funnel|conversion rate|retention|customer lifetime value|segmentation)/.test(q)) {
      return `Marketing and growth metrics:\n• Funnel stages: awareness -> consideration -> conversion -> retention\n• Key KPIs: conversion rate, CAC, retention, LTV/CAC ratio\n• Sustainable growth needs strong retention, not just acquisition\n\nWant a KPI dashboard layout for this app?`;
    }

    return null;
  };

  const getFinanceTutorResponse = (query) => {
    const q = normalizeFinanceQuery(query);
    const investmentIntent = /(invest|investment|investments|invetment|invetments|portfolio|asset allocation)/.test(q);
    const conceptIntent = /(what is|define|meaning|explain|introduction|basics)/.test(q);
    const businessTermResponse = getBusinessTermResponse(q);

    if (businessTermResponse) return businessTermResponse;

    if (investmentIntent && conceptIntent) {
      return `Investments are assets bought today to generate future value or income.\n• Examples: stocks, bonds, funds, real estate, business equity\n• Core idea: balance expected return with risk and time horizon\n• Main tools: diversification, asset allocation, periodic review\n\nDo you want beginner, intermediate, or advanced investment guidance?`;
    }

    if (q.includes('basic areas of finance') || q.includes('core pillars') || q.includes('corporate finance') || q.includes('international finance') || q.includes('institution finance') || q.includes('financial institution')) {
      return `Core finance pillars:\n• Corporate finance: firm value, capital budgeting, capital structure, working capital\n• Investments: risk-return, portfolio allocation, valuation\n• International finance: FX rates, cross-border capital flows, country risk\n• Financial institutions: banks, insurers, funds as intermediaries\n\nPick one to start: Corporate, Investments, International, or Institutions.`;
    }

    if (q.includes('financial manager') || q.includes('financial management decisions') || q.includes('decision categories') || q.includes('capital budgeting') || q.includes('capital structure') || q.includes('working capital')) {
      return `Financial manager toolkit:\n• Capital budgeting: choose long-term projects (NPV, IRR, payback)\n• Capital structure: choose debt vs equity mix\n• Working capital: manage cash, receivables, inventory, payables\n\nDecision categories: Big bet, Cross-cutting, Delegated.`;
    }

    if (q.includes('forms of business organization') || q.includes('sole proprietorship') || q.includes('partnership') || q.includes('corporation')) {
      return `Forms of business organization:\n• Sole proprietorship: simple, but unlimited liability\n• Partnership: shared ownership and control, liability depends on type\n• Corporation: limited liability, easier capital raising, stronger governance\n\nWant a quick tax + liability comparison table?`;
    }

    if (q.includes('why study finance') || q.includes('goal of financial management') || q.includes('maximize') || q.includes('shareholder wealth')) {
      return `Why study finance:\n• Better business and personal decisions under uncertainty\n• Understand risk, timing, and opportunity cost\n• Improve capital allocation\n\nGoal of financial management: maximize firm value (current value per share), not just accounting profit.`;
    }

    if (q.includes('agency problem') || q.includes('managing managers') || q.includes('principal') || q.includes('agent')) {
      return `Agency problem:\n• Owners (principals) and managers (agents) may have different goals\n• Risks: perks, empire building, excessive risk-aversion\n• Controls: incentive pay, boards, audits, takeover discipline\n\nWant a real-world case and how incentives were redesigned?`;
    }

    if (q.includes('trend analysis') || q.includes('horizontal analysis') || q.includes('vertical analysis') || q.includes('ratio analysis') || q.includes('financial ratio') || q.includes('accounting ratio')) {
      return `Financial statement analysis:\n• Horizontal (trend): period-to-period growth/decline\n• Vertical (common-size): line items as % of base (sales/assets)\n• Ratio analysis: liquidity, profitability, leverage, efficiency\n\nI can compute these directly from your report data if you want.`;
    }

    if (q.includes('cost-volume-profit') || q.includes('cvp') || q.includes('break even') || q.includes('bep')) {
      return `CVP and break-even:\n• Contribution margin per unit = Price - Variable cost\n• Break-even units = Fixed costs / Contribution margin per unit\n• Target profit units = (Fixed costs + Target profit) / Contribution margin per unit\n\nShare your numbers and I will calculate instantly.`;
    }

    if (q.includes('big bet') || q.includes('cross-cutting') || q.includes('delegated decisions') || q.includes('rapid decision')) {
      return `Decision execution framework:\n• Big bet: high impact, irreversible, executive level\n• Cross-cutting: multi-team alignment and clear ownership\n• Delegated: frequent low-risk decisions near the front line\n\nSpeed aids: clarify decision rights, 70% information rule, disagree and commit.`;
    }

    if (q.includes('students') || q.includes('money management') || q.includes('live below your means') || q.includes('emergency fund') || q.includes('repay debt') || q.includes('human capital')) {
      return `Student money principles:\n• Live below your means and automate saving\n• Build emergency fund (start UGX 500k-1m target)\n• Repay high-interest debt quickly (avalanche first)\n• Invest in human capital: skills, internships, network\n\nWant a weekly student budget plan using your real transactions?`;
    }

    if (isFinanceQuestion(q)) {
      return `Finance quick guide:\n• Corporate finance: investment, funding, and cash management decisions\n• Investments: risk-return tradeoff, diversification, portfolio construction\n• International finance: exchange rates, country risk, cross-border flows\n• Financial institutions: banks, insurers, and funds that move capital\n\nWhich topic should I break down first?`;
    }

    return null;
  };

  const buildSystemPrompt = () => {
    const txCount  = transactions?.length || 0;
    const income   = (transactions || []).filter(t => t.transaction_type === 'income').reduce((s,t) => s+(t.amount||0), 0);
    const expenses = (transactions || []).filter(t => t.transaction_type === 'expense').reduce((s,t) => s+(t.amount||0), 0);
    const { investmentTx, totalInvested, totalReturns, netPosition } = getInvestmentSnapshot();
    const netWorth = income - expenses;
    const recentTx = (transactions || []).slice(0,10).map(t =>
      `${(t.transaction_type||'').toUpperCase()} UGX ${(t.amount||0).toLocaleString()} - ${t.description||'No description'} (${t.created_at?new Date(t.created_at).toLocaleDateString():'unknown'})`
    ).join('\n') || '(no transactions)';
    const walletSummary = (wallets||[]).map(w => `${w.wallet_type||w.name}: UGX ${(w.balance||0).toLocaleString()}`).join(', ') || 'No wallet data';
    return `You are ICAN Copilot, a financial AI assistant and finance tutor. Be SHORT and PRECISE - max 5 bullet points, no long paragraphs.

USER DATA: income UGX ${income.toLocaleString()}, expenses UGX ${expenses.toLocaleString()}, net UGX ${netWorth.toLocaleString()}, ${txCount} transactions.
INVESTMENTS: ${investmentTx.length} investment records, invested UGX ${totalInvested.toLocaleString()}, returns UGX ${totalReturns.toLocaleString()}, net investment position UGX ${netPosition.toLocaleString()}.
Wallets: ${walletSummary}.
Recent: ${recentTx}

  Knowledge scope you must handle clearly:
  - Basic areas: Corporate finance, Investments, International finance, Financial institutions
  - Business finance: role of financial manager, capital budgeting, capital structure, working capital
  - Business forms: sole proprietorship, partnership, corporation
  - Goal of financial management: maximize firm value (shareholder wealth)
  - Agency problem and manager control mechanisms
  - Financial analysis: horizontal, vertical, ratio analysis
  - CVP and break-even decision support
  - Decision design: big bet, cross-cutting, delegated, rapid decision methods
  - Student/personal finance principles

  Rules: Use UGX for money values. Be direct. 2-6 lines max per response. If asked about investments or portfolio, always include invested amount, returns, and net position. For concept questions, define briefly and end with one next-step question. No filler words.`;
  };

  /* Local fallback — always responds with real data */
  const localFallback = (query) => {
    const q = normalizeFinanceQuery(query);
    const isInvestmentIntent = /(invest|investment|investments|invetment|invetments|portfolio|asset allocation|return on investment|roi)/.test(q);
    const income   = (transactions||[]).filter(t=>t.transaction_type==='income').reduce((s,t)=>s+(t.amount||0),0);
    const expenses = (transactions||[]).filter(t=>t.transaction_type==='expense').reduce((s,t)=>s+(t.amount||0),0);
    const { investmentTx, totalInvested, totalReturns, netPosition, topInvestments } = getInvestmentSnapshot();
    const net      = income - expenses;
    const rate     = income > 0 ? ((net/income)*100).toFixed(0) : 0;
    const top3     = [...(transactions||[])].filter(t=>t.transaction_type==='expense').sort((a,b)=>(b.amount||0)-(a.amount||0)).slice(0,3);

    const tutorResponse = getFinanceTutorResponse(q);
    if (tutorResponse) return tutorResponse;

    if (isInvestmentIntent)
      return `Investment summary:\n• Total invested: UGX ${totalInvested.toLocaleString()}\n• Returns received: UGX ${totalReturns.toLocaleString()}\n• Net position: UGX ${netPosition.toLocaleString()}\n\nTop investments:\n${topInvestments.map(t=>`• UGX ${(t.amount||0).toLocaleString()} — ${t.description||t.category||'Investment'}`).join('\n')||'• No investment records yet'}`;

    if (q.includes('spend') || q.includes('expense'))
      return `Expenses: UGX ${expenses.toLocaleString()}\nIncome: UGX ${income.toLocaleString()}\nSavings rate: ${rate}%\n\nTop 3:\n${top3.map(t=>`• UGX ${(t.amount||0).toLocaleString()} — ${t.description||'Expense'}`).join('\n')||'• None yet'}`;

    if (q.includes('save') || q.includes('saving'))
      return `Savings target (20%): UGX ${(income*0.2).toLocaleString()}\nCurrent savings: UGX ${Math.max(0,net).toLocaleString()}\n\n• Pay yourself first\n• Reduce your top 3 expenses`;

    if (q.includes('health') || q.includes('status'))
      return `Financial health: ${net>0?(rate>20?'Excellent':rate>10?'Good':'Fair'):'Needs attention'}\n\n• Income: UGX ${income.toLocaleString()}\n• Expenses: UGX ${expenses.toLocaleString()}\n• Net: UGX ${net.toLocaleString()} (${rate}% savings rate)`;

    if (q.includes('budget'))
      return `50/30/20 budget on UGX ${income.toLocaleString()}:\n• Needs (50%): UGX ${(income*.5).toLocaleString()}\n• Wants (30%): UGX ${(income*.3).toLocaleString()}\n• Savings (20%): UGX ${(income*.2).toLocaleString()}`;

    if (q.includes('big') || q.includes('larg') || q.includes('top'))
      return `Top expenses:\n${top3.map(t=>`• UGX ${(t.amount||0).toLocaleString()} — ${t.description||'Expense'}`).join('\n')||'• None recorded'}`;

    if (q.includes('wallet') || q.includes('balance')) {
      const ws = (wallets||[]).map(w=>`• ${w.wallet_type||w.name}: UGX ${(w.balance||0).toLocaleString()}`).join('\n')||'• No wallets yet';
      return `Your wallets:\n${ws}`;
    }
    if (q.includes('report') || q.includes('tax'))
      return `Available reports:\n• Tax Filing (URA compliant)\n• Balance Sheet\n• Income Statement\n• Country Compliance\n\nOpen Reports from the ⋮ menu.`;

    return `Income: UGX ${income.toLocaleString()} · Expenses: UGX ${expenses.toLocaleString()} · Net: UGX ${net.toLocaleString()}\nInvested: UGX ${totalInvested.toLocaleString()} · Returns: UGX ${totalReturns.toLocaleString()}\n\nTry: "my investments", "my spending", "how to save", "budget", "top expenses"`;
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    const normalizedText = normalizeFinanceQuery(text);
    const userMsg = { id: Date.now(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    const directTutor = getFinanceTutorResponse(normalizedText);
    if (directTutor) {
      setMessages(prev => [...prev, { id: Date.now()+1, role: 'assistant', content: directTutor }]);
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    setThinking(true);
    try {
      const history = messages.filter(m => m.id !== 'init').map(m => ({ role: m.role, content: m.content }));
      const payload = {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          ...history,
          { role: 'user', content: `${text}\n\nNormalized finance query: ${normalizedText}` }
        ],
        max_tokens: 600,
        temperature: 0.7,
      };
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content;
      if (!reply) throw new Error('empty');
      setMessages(prev => [...prev, { id: Date.now()+1, role: 'assistant', content: reply }]);
    } catch (err) {
      console.warn('Copilot API unavailable, using local fallback:', err.message);
      // Always give a useful response from local financial data
      const fallback = localFallback(normalizedText);
      setMessages(prev => [...prev, { id: Date.now()+1, role: 'assistant', content: fallback }]);
    } finally {
      setThinking(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const renderContent = (text) => {
    return text.split('\n').map((line, i) => {
      const html = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (line.trim().startsWith('•') || line.trim().startsWith('-')) {
        return <li key={i} className="ml-3 list-none leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
      }
      return <p key={i} className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
    });
  };

  const suggestions = [
    'My investments',
    'Corporate finance basics',
    'Agency problem',
    'CVP break-even',
    'My spending',
    'How to save more?',
    'Financial health',
    'Top expenses',
    'Budget plan',
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 w-full sm:max-w-2xl sm:rounded-2xl rounded-t-3xl shadow-2xl flex flex-col overflow-hidden"
           style={{ maxHeight: '92vh' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-white/10 flex-shrink-0">
          <div className="flex gap-1 bg-white/5 rounded-xl p-1 flex-1">
            <button
              onClick={() => setTab('copilot')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition ${
                tab === 'copilot' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              Copilot
            </button>
            <button
              onClick={() => { setTab('search'); setTimeout(() => searchRef.current?.focus(), 80); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition ${
                tab === 'search' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Search className="w-4 h-4" />
              Search
            </button>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition flex-shrink-0">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* SEARCH TAB */}
        {tab === 'search' && (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search features, transactions, wallets..."
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                className="w-full pl-10 pr-10 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
              />
              {searchQuery && (
                <button onClick={() => handleSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
            </div>

            {searchQuery ? (
              results.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 uppercase font-semibold">{results.length} result{results.length !== 1 ? 's' : ''}</p>
                  {results.map((r, i) => {
                    if (r.type === 'tool') {
                      const Icon = r.data.icon;
                      return (
                        <button key={i} onClick={() => handleToolClick(r.data)}
                          className="w-full flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition text-left">
                          <div className={`w-10 h-10 bg-gradient-to-br ${r.data.color} rounded-xl flex items-center justify-center flex-shrink-0`}>
                            <Icon className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-white text-sm">{r.data.name}</p>
                            <p className="text-xs text-gray-400 truncate">{r.data.description}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        </button>
                      );
                    }
                    if (r.type === 'transaction') {
                      const t = r.data;
                      const isIncome = t.transaction_type === 'income';
                      return (
                        <div key={i} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isIncome ? 'bg-green-600/20' : 'bg-red-600/20'}`}>
                            <DollarSign className={`w-5 h-5 ${isIncome ? 'text-green-400' : 'text-red-400'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-white text-sm truncate">{t.description || 'Transaction'}</p>
                            <p className="text-xs text-gray-400">{t.transaction_type} · UGX {(t.amount||0).toLocaleString()}</p>
                          </div>
                          <span className={`text-xs font-bold ${isIncome ? 'text-green-400' : 'text-red-400'}`}>
                            {isIncome ? '+' : '-'}{(t.amount||0).toLocaleString()}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              ) : (
                <div className="text-center py-10 text-gray-500">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No results for "{searchQuery}"</p>
                  <button onClick={() => { setTab('copilot'); setInput(`Tell me about ${searchQuery}`); }}
                    className="mt-2 text-xs text-purple-400 hover:underline">Ask Copilot instead →</button>
                </div>
              )
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 uppercase font-semibold">All features</p>
                <div className="grid grid-cols-3 gap-2">
                  {tools.map(tool => {
                    const Icon = tool.icon;
                    return (
                      <button key={tool.id} onClick={() => handleToolClick(tool)}
                        className={`p-3 bg-gradient-to-br ${tool.color} rounded-xl flex flex-col items-center gap-2 hover:opacity-90 active:scale-95 transition`}>
                        <Icon className="w-5 h-5 text-white" />
                        <span className="text-xs font-semibold text-white text-center leading-tight">{tool.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* COPILOT TAB */}
        {tab === 'copilot' && (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map(msg => (
                <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-600 to-teal-500 flex items-center justify-center flex-shrink-0 mt-1">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className={`max-w-[80%] px-3 py-2.5 rounded-2xl text-sm space-y-1 ${
                    msg.role === 'user'
                      ? 'bg-purple-600 text-white rounded-br-sm'
                      : 'bg-white/8 border border-white/10 text-gray-100 rounded-bl-sm'
                  }`}>
                    {msg.role === 'assistant' ? renderContent(msg.content) : <p>{msg.content}</p>}
                  </div>
                </div>
              ))}

              {thinking && (
                <div className="flex gap-2 justify-start">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-600 to-teal-500 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-white animate-pulse" />
                  </div>
                  <div className="bg-white/8 border border-white/10 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{animationDelay:'0ms'}} />
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{animationDelay:'120ms'}} />
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{animationDelay:'240ms'}} />
                  </div>
                </div>
              )}

              {messages.length <= 1 && !thinking && (
                <div className="pt-1 flex flex-wrap gap-2">
                  {suggestions.map(s => (
                    <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                      className="px-3 py-1.5 bg-white/6 hover:bg-purple-600/30 border border-white/10 hover:border-purple-500/50 rounded-full text-xs text-gray-300 hover:text-white transition">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="flex items-center gap-2 px-4 py-3 border-t border-white/10 flex-shrink-0">
              <input
                ref={inputRef}
                type="text"
                placeholder="Ask ICAN Copilot anything..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                disabled={thinking}
                className="flex-1 min-w-0 px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={thinking || !input.trim()}
                className="w-10 h-10 flex-shrink-0 bg-gradient-to-br from-purple-600 to-teal-500 disabled:opacity-40 rounded-xl flex items-center justify-center transition active:scale-95"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SearchModal;
