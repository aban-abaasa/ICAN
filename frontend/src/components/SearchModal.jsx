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

  const buildSystemPrompt = () => {
    const txCount  = transactions?.length || 0;
    const income   = (transactions || []).filter(t => t.transaction_type === 'income').reduce((s,t) => s+(t.amount||0), 0);
    const expenses = (transactions || []).filter(t => t.transaction_type === 'expense').reduce((s,t) => s+(t.amount||0), 0);
    const netWorth = income - expenses;
    const recentTx = (transactions || []).slice(0,10).map(t =>
      `${(t.transaction_type||'').toUpperCase()} UGX ${(t.amount||0).toLocaleString()} - ${t.description||'No description'} (${t.created_at?new Date(t.created_at).toLocaleDateString():'unknown'})`
    ).join('\n') || '(no transactions)';
    const walletSummary = (wallets||[]).map(w => `${w.wallet_type||w.name}: UGX ${(w.balance||0).toLocaleString()}`).join(', ') || 'No wallet data';
    return `You are ICAN Copilot, a financial AI assistant. Be SHORT and PRECISE — max 4 bullet points, no long paragraphs.

USER DATA: income UGX ${income.toLocaleString()}, expenses UGX ${expenses.toLocaleString()}, net UGX ${netWorth.toLocaleString()}, ${txCount} transactions. Wallets: ${walletSummary}.
Recent: ${recentTx}

Rules: Use UGX. Be direct. 2-5 lines max per response. No filler words.`;
  };

  /* Local fallback — always responds with real data */
  const localFallback = (query) => {
    const q = query.toLowerCase();
    const income   = (transactions||[]).filter(t=>t.transaction_type==='income').reduce((s,t)=>s+(t.amount||0),0);
    const expenses = (transactions||[]).filter(t=>t.transaction_type==='expense').reduce((s,t)=>s+(t.amount||0),0);
    const net      = income - expenses;
    const rate     = income > 0 ? ((net/income)*100).toFixed(0) : 0;
    const top3     = [...(transactions||[])].filter(t=>t.transaction_type==='expense').sort((a,b)=>(b.amount||0)-(a.amount||0)).slice(0,3);

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

    return `Income: UGX ${income.toLocaleString()} · Expenses: UGX ${expenses.toLocaleString()} · Net: UGX ${net.toLocaleString()}\n\nTry: "my spending", "how to save", "budget", "top expenses"`;
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    const userMsg = { id: Date.now(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setThinking(true);
    try {
      const history = messages.filter(m => m.id !== 'init').map(m => ({ role: m.role, content: m.content }));
      const payload = {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          ...history,
          { role: 'user', content: text }
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
      const fallback = localFallback(text);
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
