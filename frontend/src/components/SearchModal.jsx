import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Search,
  Zap,
  Wallet,
  TrendingUp,
  Brain,
  PieChart,
  Users,
  Briefcase,
  FileText,
  Settings,
  Clock,
  Send,
  Bot,
  AlertCircle
} from 'lucide-react';

/**
 * 🔍 Universal Search Modal with AI Integration
 * Searches across all ICAN features and tools
 */
const SearchModal = ({ isOpen, onClose, user, transactions, wallets }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [aiMessages, setAIMessages] = useState([]);
  const [aiInput, setAIInput] = useState('');
  const [isAIThinking, setIsAIThinking] = useState(false);
  const searchInputRef = useRef(null);
  const aiMessagesRef = useRef(null);

  // All searchable features/tools
  const applicationTools = [
    {
      id: 'transactions',
      name: 'Transactions',
      icon: TrendingUp,
      color: 'from-blue-600 to-blue-400',
      description: 'View and manage all your financial transactions',
      keywords: ['transaction', 'money', 'payment', 'income', 'expense', 'cash flow']
    },
    {
      id: 'wallets',
      name: 'Wallets',
      icon: Wallet,
      color: 'from-green-600 to-green-400',
      description: 'Manage your personal, business, agent, and trust wallets',
      keywords: ['wallet', 'account', 'balance', 'fund', 'money store']
    },
    {
      id: 'ican-coin',
      name: 'ICAN Coin',
      icon: Zap,
      color: 'from-yellow-600 to-yellow-400',
      description: 'Buy, sell, and trade ICAN Coins across borders',
      keywords: ['ican', 'coin', 'crypto', 'trading', 'cross-border', 'exchange']
    },
    {
      id: 'pitching',
      name: 'ICAN Pitchin',
      icon: Briefcase,
      color: 'from-purple-600 to-purple-400',
      description: 'Create and manage business pitches for investment',
      keywords: ['pitch', 'investment', 'business', 'startup', 'funding']
    },
    {
      id: 'trust',
      name: 'Trust System',
      icon: Users,
      color: 'from-indigo-600 to-indigo-400',
      description: 'Build trust groups and manage collaborative finances',
      keywords: ['trust', 'group', 'friends', 'family', 'collaboration', 'members']
    },
    {
      id: 'cmms',
      name: 'CMMS Module',
      icon: Briefcase,
      color: 'from-cyan-600 to-cyan-400',
      description: 'Manage inventory, equipment, and maintenance',
      keywords: ['cmms', 'inventory', 'equipment', 'maintenance', 'assets', 'stock']
    },
    {
      id: 'reports',
      name: 'Reports',
      icon: PieChart,
      color: 'from-pink-600 to-pink-400',
      description: 'Generate financial reports and analytics',
      keywords: ['report', 'analysis', 'analytics', 'chart', 'insights', 'data']
    },
    {
      id: 'profile',
      name: 'Profile',
      icon: Settings,
      color: 'from-slate-600 to-slate-400',
      description: 'Manage your account settings and preferences',
      keywords: ['profile', 'settings', 'account', 'preferences', 'configuration']
    },
    {
      id: 'ai-assistant',
      name: 'AI Assistant',
      icon: Brain,
      color: 'from-teal-600 to-teal-400',
      description: 'Get AI-powered financial advice and insights',
      keywords: ['ai', 'assistant', 'advice', 'help', 'suggestion', 'recommendation']
    }
  ];

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Auto-scroll AI messages
  useEffect(() => {
    aiMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  // Search through features
  const handleSearch = (query) => {
    setSearchQuery(query);
    setIsSearching(true);

    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const queryLower = query.toLowerCase();
    const filtered = applicationTools.filter(tool =>
      tool.name.toLowerCase().includes(queryLower) ||
      tool.description.toLowerCase().includes(queryLower) ||
      tool.keywords.some(k => k.includes(queryLower))
    );

    // Also search transactions if query matches
    let transactionResults = [];
    if (transactions && transactions.length > 0) {
      transactionResults = transactions
        .filter(t =>
          (t.description?.toLowerCase().includes(queryLower)) ||
          (t.category?.toLowerCase().includes(queryLower)) ||
          (t.transaction_type?.toLowerCase().includes(queryLower))
        )
        .slice(0, 5)
        .map(t => ({
          type: 'transaction',
          data: t,
          title: t.description || 'Transaction',
          subtitle: `${t.transaction_type} - UGX ${t.amount?.toLocaleString()}`
        }));
    }

    setTimeout(() => {
      setResults([
        ...filtered.map(tool => ({ type: 'tool', data: tool })),
        ...transactionResults
      ]);
      setIsSearching(false);
    }, 300);
  };

  // Initialize AI chat
  const initializeAIChat = () => {
    setShowAIChat(true);
    if (aiMessages.length === 0) {
      setAIMessages([{
        id: 1,
        type: 'ai',
        content: '🤖 **ICAN AI Assistant**\n\nHello! I can help you with:\n📊 Financial advice\n💰 Transaction analysis\n🎯 Savings goals\n📈 Investment guidance\n🔍 Feature navigation\n\nWhat would you like to know?',
        timestamp: new Date()
      }]);
    }
  };

  // Send message to AI
  const handleAISend = async () => {
    if (!aiInput.trim()) return;

    const userMsg = {
      id: Date.now(),
      type: 'user',
      content: aiInput,
      timestamp: new Date()
    };

    setAIMessages(prev => [...prev, userMsg]);
    setAIInput('');
    setIsAIThinking(true);

    try {
      // Simulate AI response (in production, call OpenAI service)
      setTimeout(() => {
        const response = generateAIResponse(aiInput);
        setAIMessages(prev => [...prev, {
          id: Date.now() + 1,
          type: 'ai',
          content: response,
          timestamp: new Date()
        }]);
        setIsAIThinking(false);
      }, 800);
    } catch (error) {
      console.error('AI error:', error);
      setIsAIThinking(false);
    }
  };

  // Generate contextual AI responses
  const generateAIResponse = (query) => {
    const q = query.toLowerCase();

    if (q.includes('transaction')) {
      return `📊 **Your Transactions**\n\nYou have ${transactions?.length || 0} transactions tracked.\n\n💡 **Tips:**\n• Categorize transactions for better insights\n• Track spending patterns weekly\n• Set budget alerts for each category`;
    }

    if (q.includes('wallet') || q.includes('balance')) {
      return `💰 **Wallet Information**\n\nYour wallets:\n• Personal: Ready to manage\n• Business: Available\n• Trust: Set up groups\n• Agent: For cash in/out\n\n📈 Keep growing! 🚀`;
    }

    if (q.includes('ican') || q.includes('coin')) {
      return `⚡ **ICAN Coin Trading**\n\n🌍 Buy & sell ICAN Coins at market price\n🚀 Send coins globally - no restrictions!\n💹 Current market provides best rates\n\n💡 **Next step:** Open ICAN Coin to start trading`;
    }

    if (q.includes('advice') || q.includes('help')) {
      return `🤖 **Financial Advice**\n\nI can help with:\n✅ Spending analysis\n✅ Savings strategies  \n✅ Budget planning\n✅ Investment guidance\n✅ Goal setting\n\nTell me more about your situation!`;
    }

    if (q.includes('goal') || q.includes('target')) {
      return `🎯 **Goal Setting**\n\nSet your net worth target and I'll help track progress:\n• Define your financial goal\n• Create action steps\n• Monitor milestones\n• Celebrate wins!\n\n💪 You got this!`;
    }

    return `🤖 **ICAN AI Assistant**\n\n✨ I understood: "${query}"\n\n💡 **I can help with:**\n• Feature navigation\n• Financial questions\n• Transaction insights\n• Budget advice\n• Savings strategies\n\n👉 Ask me anything about money!`;
  };

  // Handle feature click
  const handleFeatureClick = (tool) => {
    onClose();
    // Feature navigation would be handled by parent component
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 w-full sm:max-w-2xl sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <div className="flex items-center gap-3 flex-1">
            <Search className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-bold text-white">Search & AI Assistant</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Search/AI Content */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {!showAIChat ? (
            <>
              {/* Search Input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search tools, transactions, features..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* AI Assistant Quick Access */}
              <button
                onClick={initializeAIChat}
                className="w-full flex items-center gap-3 p-4 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 rounded-lg transition"
              >
                <Brain className="w-5 h-5 text-white" />
                <div className="text-left">
                  <div className="font-semibold text-white">Ask ICAN AI</div>
                  <div className="text-xs text-teal-100">Get instant financial advice</div>
                </div>
                <Send className="w-5 h-5 text-white ml-auto" />
              </button>

              {/* Search Results */}
              {searchQuery && (
                <div className="space-y-3">
                  {isSearching ? (
                    <div className="text-center py-8">
                      <div className="inline-flex items-center gap-2 text-gray-400">
                        <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"></div>
                        <span className="text-sm">Searching...</span>
                      </div>
                    </div>
                  ) : results.length > 0 ? (
                    <>
                      <div className="text-xs text-gray-400 font-semibold uppercase">Results ({results.length})</div>
                      {results.map((result, idx) => {
                        if (result.type === 'tool') {
                          const tool = result.data;
                          const Icon = tool.icon;
                          return (
                            <button
                              key={idx}
                              onClick={() => handleFeatureClick(tool)}
                              className="w-full p-4 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg border border-slate-700 transition flex items-start gap-4"
                            >
                              <div className={`p-3 bg-gradient-to-br ${tool.color} rounded-lg flex-shrink-0`}>
                                <Icon className="w-5 h-5 text-white" />
                              </div>
                              <div className="text-left flex-1">
                                <div className="font-semibold text-white">{tool.name}</div>
                                <div className="text-xs text-gray-400 mt-1">{tool.description}</div>
                              </div>
                              <ChevronRight className="w-5 h-5 text-gray-500 flex-shrink-0 mt-1" />
                            </button>
                          );
                        }

                        if (result.type === 'transaction') {
                          return (
                            <div key={idx} className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                              <div className="font-semibold text-white">{result.title}</div>
                              <div className="text-xs text-gray-400 mt-1">{result.subtitle}</div>
                            </div>
                          );
                        }

                        return null;
                      })}
                    </>
                  ) : (
                    <div className="text-center py-8 text-gray-400">
                      <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No results found for "{searchQuery}"</p>
                      <p className="text-xs text-gray-500 mt-2">Try searching for a tool or transaction</p>
                    </div>
                  )}
                </div>
              )}

              {/* Quick Links - When no search */}
              {!searchQuery && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400 font-semibold uppercase">Popular Tools</div>
                  <div className="grid grid-cols-2 gap-2">
                    {applicationTools.slice(0, 6).map((tool) => {
                      const Icon = tool.icon;
                      return (
                        <button
                          key={tool.id}
                          onClick={() => handleFeatureClick(tool)}
                          className={`p-3 bg-gradient-to-br ${tool.color} rounded-lg flex flex-col items-center gap-2 hover:shadow-lg transition`}
                        >
                          <Icon className="w-5 h-5 text-white" />
                          <span className="text-xs font-semibold text-white text-center">{tool.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* AI Chat Messages */}
              <div className="space-y-4 h-64 overflow-y-auto">
                {aiMessages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs p-3 rounded-lg ${
                      msg.type === 'user'
                        ? 'bg-purple-600 text-white rounded-br-none'
                        : 'bg-slate-700 text-gray-100 rounded-bl-none'
                    }`}>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}
                {isAIThinking && (
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-teal-600/20 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-teal-400 animate-pulse" />
                    </div>
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-teal-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                )}
                <div ref={aiMessagesRef} />
              </div>
            </>
          )}
        </div>

        {/* Footer - AI Chat Input (when showing AI) */}
        {showAIChat && (
          <div className="px-6 py-4 border-t border-slate-700/50">
            <div className="flex items-end gap-2">
              <input
                type="text"
                placeholder="Ask AI anything..."
                value={aiInput}
                onChange={(e) => setAIInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAISend()}
                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
              />
              <button
                onClick={handleAISend}
                disabled={isAIThinking || !aiInput.trim()}
                className="p-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg transition"
              >
                <Send className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Missing imports add to file
const ChevronRight = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

export default SearchModal;
