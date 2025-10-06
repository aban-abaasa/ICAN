import React, { useState, useEffect, useRef } from 'react';
import { 
  Shield, 
  Globe, 
  TrendingUp, 
  Mic, 
  MicOff, 
  DollarSign,
  Target,
  AlertTriangle,
  CheckCircle,
  Settings,
  User,
  Calendar,
  FileText,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Activity,
  BarChart3,
  PieChart,
  Clock,
  X,
  Brain,
  TrendingDown,
  AlertCircle,
  Zap,
  Building,
  Crown,
  Rocket,
  MapPin,
  ChevronRight,
  Star,
  Award,
  MessageCircle,
  Send,
  Bot,
  Lightbulb,
  Heart,
  Sparkles,
  Coffee,
  TrendingUpIcon,
  Video,
  VideoOff,
  Camera,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Download,
  Upload,
  Database,
  Cloud,
  Headphones,
  Film,
  Image,
  Monitor,
  Smartphone,
  Wifi,
  WifiOff
} from 'lucide-react';

// AI Spending Advice Modal
const AIAdviceModal = ({ isOpen, advice, transaction, onConfirm, onCancel }) => {
  if (!isOpen || !advice) return null;

  const getRiskColor = (riskLevel) => {
    switch(riskLevel) {
      case 'financial-suicide': return 'border-red-600 bg-red-600';
      case 'wealth-destructive': return 'border-red-500 bg-red-500';
      case 'wealth-threatening': return 'border-red-400 bg-red-400';
      case 'addiction-pattern': return 'border-purple-500 bg-purple-500';
      case 'lifestyle-inflation': return 'border-orange-500 bg-orange-500';
      case 'poor-judgment': return 'border-pink-500 bg-pink-500';
      case 'critical': return 'border-red-500 bg-red-500';
      case 'high': return 'border-red-400 bg-red-400';
      case 'medium': return 'border-yellow-400 bg-yellow-400';
      case 'strategic-investment': return 'border-green-500 bg-green-500';
      default: return 'border-blue-400 bg-blue-400';
    }
  };

  const getUrgencyIcon = (urgency) => {
    switch(urgency) {
      case 'wisdom': return '�';
      case 'caution': return '🤔';
      case 'timing': return '⏰';
      case 'pattern': return '�';
      case 'positive': return '🌟';
      default: return '�';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">{getUrgencyIcon(advice.urgency)}</div>
          <h2 className="text-xl font-bold text-white mb-2">
            AI Spending Advisor
          </h2>
          <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getRiskColor(advice.riskLevel)} bg-opacity-20`}>
            <span className={`w-2 h-2 rounded-full ${getRiskColor(advice.riskLevel)} mr-2`}></span>
            Risk: {advice.riskLevel.charAt(0).toUpperCase() + advice.riskLevel.slice(1)}
          </div>
        </div>

        {transaction && (
          <div className="mb-4 p-3 bg-white bg-opacity-10 rounded-lg">
            <div className="text-white font-medium">Proposed Transaction:</div>
            <div className="text-gray-300 text-sm">
              {transaction.type === 'expense' ? '💸' : '💰'} UGX {transaction.amount.toLocaleString()} - {transaction.description}
            </div>
          </div>
        )}

        <div className="mb-4">
          <div className="text-white font-medium mb-3">💬 Your AI Financial Friend Says:</div>
          <p className="text-gray-300 text-sm mb-4 leading-relaxed">{advice.message}</p>
          
          {/* God's Wisdom */}
          {advice.godlyWisdom && (
            <div className="p-4 bg-yellow-500 bg-opacity-20 rounded-lg border border-yellow-400 border-opacity-40 mb-4">
              <div className="text-yellow-300 font-medium text-sm mb-2">🙏 God's Wisdom:</div>
              <p className="text-gray-200 text-sm italic leading-relaxed">"{advice.godlyWisdom}"</p>
            </div>
          )}

          {/* Practical Reason */}
          {advice.practicalReason && (
            <div className="p-3 bg-blue-500 bg-opacity-20 rounded-lg border border-blue-400 border-opacity-30 mb-3">
              <div className="text-blue-300 font-medium text-sm mb-1">🤔 Here's Why:</div>
              <p className="text-gray-300 text-sm">{advice.practicalReason}</p>
            </div>
          )}

          {/* Encouragement */}
          {advice.encouragement && (
            <div className="p-3 bg-green-500 bg-opacity-20 rounded-lg border border-green-400 border-opacity-30 mb-3">
              <div className="text-green-300 font-medium text-sm mb-1">💪 Encouragement:</div>
              <p className="text-gray-300 text-sm">{advice.encouragement}</p>
            </div>
          )}

          {/* Journey Stage Guidance */}
          {advice.stageGuidance && (
            <div className="p-3 bg-purple-500 bg-opacity-20 rounded-lg border border-purple-400 border-opacity-30 mb-3">
              <div className="text-purple-300 font-medium text-sm mb-1">🎯 Journey Guidance:</div>
              <p className="text-gray-300 text-sm">{advice.stageGuidance}</p>
            </div>
          )}
          
          {/* Simple Suggestions */}
          {advice.suggestions.length > 0 && (
            <div className="space-y-2">
              <div className="text-white font-medium text-sm">💡 Helpful Suggestions:</div>
              {advice.suggestions.map((suggestion, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="text-green-400 text-sm mt-0.5">•</span>
                  <span className="text-gray-300 text-sm leading-relaxed">{suggestion}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {advice.insights && (
          <div className="mb-6 p-3 bg-blue-500 bg-opacity-10 rounded-lg border border-blue-400 border-opacity-30">
            <div className="text-blue-300 font-medium text-sm mb-2">💡 Financial Insights:</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="text-gray-300">
                <span className="text-blue-300">Savings Rate:</span> {Math.round(advice.insights.savingsRate)}%
              </div>
              <div className="text-gray-300">
                <span className="text-blue-300">Affordability:</span> {advice.insights.affordabilityScore}
              </div>
              <div className="text-gray-300">
                <span className="text-blue-300">Days to Income:</span> {advice.insights.daysUntilNextIncome}
              </div>
              <div className="text-gray-300">
                <span className="text-blue-300">Top Category:</span> {advice.insights.topSpendingCategory}
              </div>
            </div>
          </div>
        )}

        {/* Wealth Building Challenge */}
        {!advice.shouldProceed && advice.wealthImpact && (
          <div className="mb-4 p-4 bg-gradient-to-r from-green-500 to-blue-500 bg-opacity-20 rounded-lg border border-green-400 border-opacity-30">
            <div className="text-green-300 font-bold text-center mb-2">💪 WEALTH BUILDING CHALLENGE</div>
            <div className="text-xs text-gray-200 text-center">
              Skip this expense and become UGX {Math.round((advice.wealthImpact.fiveYearLoss - transaction.amount)).toLocaleString()} richer in 5 years!
            </div>
            <div className="text-xs text-gray-300 text-center mt-1">
              That's enough to move up in your ICAN journey stages!
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors font-medium"
          >
            {advice.shouldProceed ? 'Let me reconsider' : '🙏 I\'ll wait and pray about it'}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2 text-white rounded-lg transition-colors font-medium ${
              advice.shouldProceed 
                ? 'bg-green-600 hover:bg-green-700' 
                : 'bg-orange-600 hover:bg-orange-700'
            }`}
          >
            {advice.shouldProceed ? '✅ Proceed with this decision' : '⚠️ I understand the risk, proceed'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Journey Stage Progression Modal
const JourneyStageModal = ({ isOpen, currentStage, journeyStages, onClose }) => {
  if (!isOpen || !currentStage) return null;

  const stage = journeyStages[currentStage];
  const StageIcon = stage.icon;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card p-8 max-w-lg w-full max-h-[80vh] overflow-y-auto">
        <div className="text-center mb-6">
          <div className="relative">
            <div className={`w-20 h-20 ${stage.bgColor} bg-opacity-20 rounded-full flex items-center justify-center mx-auto mb-4`}>
              <StageIcon className={`w-10 h-10 ${stage.color}`} />
            </div>
            <div className="absolute -top-2 -right-2 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
              <Star className="w-4 h-4 text-white" />
            </div>
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2">
            🎉 Stage Advancement!
          </h2>
          <div className={`inline-flex items-center px-4 py-2 rounded-full ${stage.bgColor} bg-opacity-20 border border-current ${stage.color}`}>
            <Award className="w-4 h-4 mr-2" />
            <span className="font-medium">{stage.name}: {stage.subtitle}</span>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <h3 className="text-white font-semibold mb-2">🚀 You've Unlocked:</h3>
            <p className="text-gray-300 text-sm leading-relaxed">
              {stage.improvement}
            </p>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-2">🎯 Focus Areas:</h3>
            <div className="space-y-2">
              {stage.focus.map((focus, index) => (
                <div key={index} className="flex items-start gap-2">
                  <ChevronRight className="w-4 h-4 text-blue-400 mt-0.5" />
                  <span className="text-gray-300 text-sm">{focus}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 bg-blue-500 bg-opacity-20 rounded-lg border border-blue-400 border-opacity-30">
            <h3 className="text-blue-300 font-semibold mb-2">🎯 Next Milestone:</h3>
            <p className="text-white text-sm">{stage.milestone}</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 text-white rounded-lg transition-all font-medium"
        >
          Continue Journey 🚀
        </button>
      </div>
    </div>
  );
};

// AI Chat Interface - Intelligent Conversation & Decision Support
const AIChat = ({ isOpen, onClose, user, transactions, currentJourneyStage, netWorth, journeyStages }) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef(null);

  // AI Personality and Context
  const aiPersonality = {
    name: "ICAN AI",
    emoji: "🤖",
    tone: "encouraging",
    expertise: ["wealth-building", "financial-planning", "behavioral-psychology", "journey-guidance"]
  };

  // Initialize with welcome message
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const welcomeMessage = generateWelcomeMessage();
      setMessages([welcomeMessage]);
    }
  }, [isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const generateWelcomeMessage = () => {
    const stage = journeyStages[currentJourneyStage];
    return {
      id: Date.now(),
      type: 'ai',
      content: `� Hello, friend! I'm your ICAN AI companion, here to support your financial journey with God's wisdom.

I can see you're in the **${stage?.name}** stage - what a blessing! God is building something beautiful in your life.

😊 I'm here to help you with:
- Making wise spending choices
- Understanding God's principles for money
- Celebrating your progress and victories
- Finding encouragement when things are tough
- Planning your next steps with confidence

💬 What's on your heart today? I'm here to listen and help! ✨`,
      timestamp: new Date().toISOString(),
      mood: 'encouraging'
    };
  };

  const processUserMessage = async (message) => {
    // Add user message
    const userMsg = {
      id: Date.now(),
      type: 'user', 
      content: message,
      timestamp: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setIsThinking(true);

    // Generate AI response based on context and message
    setTimeout(() => {
      const aiResponse = generateIntelligentResponse(message);
      setMessages(prev => [...prev, aiResponse]);
      setIsThinking(false);
    }, 1500);
  };

  const generateIntelligentResponse = (userMessage) => {
    const message = userMessage.toLowerCase();
    
    // Contextual analysis
    const context = analyzeUserContext();
    let response = "";
    let mood = "helpful";
    let actionItems = [];

    // Intent Recognition & Response Generation
    if (message.includes('spend') || message.includes('buy') || message.includes('purchase')) {
      response = generateSpendingAdvice(message, context);
      mood = "advisory";
    } else if (message.includes('save') || message.includes('money') || message.includes('invest')) {
      response = generateSavingAdvice(context);
      mood = "encouraging";
    } else if (message.includes('goal') || message.includes('target') || message.includes('rich')) {
      response = generateGoalAdvice(context);
      mood = "motivational";
    } else if (message.includes('stage') || message.includes('journey') || message.includes('progress')) {
      response = generateJourneyAdvice(context);
      mood = "insightful";
    } else if (message.includes('help') || message.includes('advice') || message.includes('what')) {
      response = generateGeneralAdvice(context);
      mood = "supportive";
    } else {
      response = generatePersonalizedResponse(message, context);
      mood = "conversational";
    }

    return {
      id: Date.now() + 1,
      type: 'ai',
      content: response,
      timestamp: new Date().toISOString(),
      mood: mood,
      actionItems: actionItems
    };
  };

  const analyzeUserContext = () => {
    const recentTransactions = transactions.slice(-10);
    const monthlySpending = recentTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const stage = journeyStages[currentJourneyStage];
    
    return {
      stage: stage,
      netWorth: netWorth,
      recentTransactions: recentTransactions,
      monthlySpending: monthlySpending,
      spendingPattern: analyzeSpendingPattern(recentTransactions),
      riskLevel: calculateRiskLevel()
    };
  };

  const generateSpendingAdvice = (message, context) => {
    return `� **Let's think about this together!**

I can see you're considering a purchase. That's wise to pause and ask for guidance! 

� **God's perspective:** "The plans of the diligent lead to profit as surely as haste leads to poverty." - Proverbs 21:5

� **Simple questions to ask yourself:**
1. Is this a genuine NEED or just a WANT?
2. Will this bring me closer to my goals or further away?
3. Can I afford this without stress or worry?

� **Remember:** You're doing great by even asking these questions! This shows wisdom and God loves wise stewardship.

What specific purchase are you considering? I'd love to help you think through it! 🌟`;
  };

  const generateSavingAdvice = (context) => {
    const savingsGoal = context.stage.threshold.max;
    const currentProgress = (context.netWorth / savingsGoal) * 100;

    return `🚀 **Wealth Building Accelerator!**

Amazing that you're thinking about saving! You're ${Math.round(currentProgress)}% to your next stage milestone.

💡 **Optimal Strategy for ${context.stage.name}:**
• Target: 50% needs, 30% wants, 20% savings
• Emergency fund: 3 months expenses first
• Then focus on: ${context.stage.focus[1] || 'wealth multiplication'}

🎯 **Next Target:** UGX ${savingsGoal.toLocaleString()}

💪 **Challenge:** Can you save an extra UGX 5,000 this week? That's UGX 260,000 per year!`;
  };

  const generateGoalAdvice = (context) => {
    const nextStageThreshold = context.stage.threshold.max;
    const gap = nextStageThreshold - context.netWorth;

    return `🎯 **Goal Achievement Protocol!**

Current Position: **${context.stage.name}** (UGX ${context.netWorth.toLocaleString()})
Next Milestone: UGX ${nextStageThreshold.toLocaleString()} 
Gap to Close: UGX ${gap.toLocaleString()}

🚀 **Acceleration Strategy:**
1. ${context.stage.focus[0]}
2. Eliminate unnecessary expenses (could save UGX 20,000+/month)
3. Create additional income streams

💡 **Timeline:** At current velocity, you could reach the next stage in ${Math.ceil(gap / 50000)} months with focused effort!

Ready to create a specific action plan?`;
  };

  const generateJourneyAdvice = (context) => {
    return `🗺️ **Journey Analysis: ${context.stage.name}**

**Current Status:** ${context.stage.subtitle}
**Key Challenge:** ${context.stage.problem}

🎯 **Your Path Forward:**
${context.stage.focus.map((focus, i) => `${i + 1}. ${focus}`).join('\n')}

💪 **Next Milestone:** ${context.stage.milestone}

**Progress Insight:** You've made it this far - that puts you ahead of 70% of people! The next stage will unlock even more powerful tools.

What specific area would you like to focus on first?`;
  };

  const generateGeneralAdvice = (context) => {
    const tips = [
      `💡 **Daily Habit:** Track every expense - awareness is the first step to wealth`,
      `🧠 **Money Mindset:** Think like an investor, not a consumer`,
      `⚡ **Quick Win:** Reduce one unnecessary expense this week`,
      `🎯 **Focus:** Every UGX saved is UGX that can work for you`,
      `💪 **Challenge:** Delay gratification - future you will thank you!`
    ];

    const randomTip = tips[Math.floor(Math.random() * tips.length)];

    return `🤖 **AI Insight for ${context.stage.name} Stage:**

${randomTip}

**Stage-Specific Advice:** ${context.stage.improvement}

**Your Strength:** You're ${Math.round((context.netWorth / context.stage.threshold.max) * 100)}% through this stage - keep the momentum!

What would you like to explore: spending patterns, saving strategies, or journey acceleration?`;
  };

  const generatePersonalizedResponse = (message, context) => {
    return `🤖 **Thinking about your situation...**

I understand you're asking about "${message}". As someone at the ${context.stage.name} stage, here's my perspective:

Your current net worth of UGX ${context.netWorth.toLocaleString()} shows you're making progress! The key is maintaining momentum while making smart decisions.

💡 **Personalized Insight:** Based on your recent transactions, I notice ${context.spendingPattern}. This gives us a great opportunity to optimize!

Would you like me to dive deeper into any specific area? I'm here to help you make the best financial decisions! 🚀`;
  };

  const analyzeSpendingPattern = (transactions) => {
    if (transactions.length < 3) return "you're just getting started with tracking";
    
    const expenses = transactions.filter(t => t.type === 'expense');
    const avgExpense = expenses.reduce((sum, t) => sum + t.amount, 0) / expenses.length;
    
    if (avgExpense > 25000) return "you tend to make larger purchases - let's ensure they align with your goals";
    if (avgExpense < 5000) return "you're great at controlling small expenses - now let's focus on growing income";
    return "you have a balanced spending pattern - good foundation to build on";
  };

  const calculateRiskLevel = () => {
    const recentExpenses = transactions.slice(-5).filter(t => t.type === 'expense');
    const totalRecent = recentExpenses.reduce((sum, t) => sum + t.amount, 0);
    
    if (totalRecent > netWorth * 0.3) return 'high';
    if (totalRecent > netWorth * 0.15) return 'medium';
    return 'low';
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    processUserMessage(inputMessage.trim());
  };

  const getMoodColor = (mood) => {
    const colors = {
      excited: 'text-green-400',
      helpful: 'text-blue-400', 
      advisory: 'text-yellow-400',
      encouraging: 'text-purple-400',
      motivational: 'text-pink-400',
      insightful: 'text-cyan-400',
      supportive: 'text-emerald-400',
      conversational: 'text-gray-300'
    };
    return colors[mood] || 'text-white';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card p-0 max-w-2xl w-full h-[80vh] flex flex-col">
        
        {/* Header */}
        <div className="p-4 border-b border-white border-opacity-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500 bg-opacity-20 rounded-full flex items-center justify-center">
              <Bot className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h3 className="text-white font-medium">ICAN AI Assistant</h3>
              <p className="text-gray-400 text-xs">Your Intelligent Wealth Advisor</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.type === 'ai' && (
                <div className="w-8 h-8 bg-blue-500 bg-opacity-20 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-blue-400" />
                </div>
              )}
              
              <div className={`max-w-[80%] p-3 rounded-lg ${
                message.type === 'user' 
                  ? 'bg-blue-600 bg-opacity-80 text-white' 
                  : 'bg-white bg-opacity-10 text-gray-100'
              }`}>
                <div className={`text-sm leading-relaxed whitespace-pre-line ${getMoodColor(message.mood)}`}>
                  {message.content}
                </div>
                <div className="text-xs text-gray-400 mt-2">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              </div>

              {message.type === 'user' && (
                <div className="w-8 h-8 bg-green-500 bg-opacity-20 rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-green-400" />
                </div>
              )}
            </div>
          ))}

          {isThinking && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 bg-blue-500 bg-opacity-20 rounded-full flex items-center justify-center">
                <Bot className="w-4 h-4 text-blue-400 animate-pulse" />
              </div>
              <div className="bg-white bg-opacity-10 text-gray-100 p-3 rounded-lg">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <span className="text-xs text-gray-400 ml-2">AI thinking...</span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSendMessage} className="p-4 border-t border-white border-opacity-20">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Ask about spending, saving, investments, or your journey..."
              className="flex-1 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-400"
              disabled={isThinking}
            />
            <button
              type="submit"
              disabled={isThinking || !inputMessage.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};

// Biometric Security Modal Component
const BiometricAuthModal = ({ isOpen, onClose, onAuthenticate, title = "Security Verification Required" }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [authComplete, setAuthComplete] = useState(false);

  const handleBiometricScan = () => {
    setIsScanning(true);
    // Simulate biometric scan
    setTimeout(() => {
      setIsScanning(false);
      setAuthComplete(true);
      setTimeout(() => {
        onAuthenticate();
        setAuthComplete(false);
        onClose();
      }, 1000);
    }, 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="glass-card p-8 max-w-md w-full mx-4">
        <div className="text-center">
          <div className="mb-6">
            <Shield className={`w-16 h-16 mx-auto ${isScanning ? 'animate-pulse text-blue-400' : authComplete ? 'text-green-400' : 'text-white'}`} />
          </div>
          
          <h3 className="text-xl font-semibold text-white mb-4">{title}</h3>
          
          {!authComplete ? (
            <>
              <p className="text-gray-300 mb-6">
                {isScanning ? 'Scanning biometric data...' : 'This action requires biometric verification for your security.'}
              </p>
              
              <button
                onClick={handleBiometricScan}
                disabled={isScanning}
                className={`w-full py-3 px-6 rounded-lg font-medium transition-all ${
                  isScanning 
                    ? 'bg-blue-600 cursor-not-allowed' 
                    : 'bg-blue-500 hover:bg-blue-600'
                } text-white`}
              >
                {isScanning ? 'Scanning...' : 'Authenticate'}
              </button>
            </>
          ) : (
            <div className="text-green-400">
              <CheckCircle className="w-8 h-8 mx-auto mb-2" />
              <p>Authentication Successful</p>
            </div>
          )}
          
          {!isScanning && !authComplete && (
            <button
              onClick={onClose}
              className="mt-4 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// IOR Gauge Component
const IORGauge = ({ score, size = 120 }) => {
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  const getScoreColor = (score) => {
    if (score >= 80) return '#10b981'; // Green
    if (score >= 60) return '#f59e0b'; // Yellow
    return '#ef4444'; // Red
  };

  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth="8"
          fill="transparent"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={getScoreColor(score)}
          strokeWidth="8"
          fill="transparent"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-white">{score}%</span>
        <span className="text-xs text-gray-300">IOR</span>
      </div>
    </div>
  );
};

// Smart Spending Insights Component
const SmartSpendingInsights = ({ transactions }) => {
  const getSpendingPatterns = () => {
    const recentTransactions = transactions.slice(-10);
    const expenses = recentTransactions.filter(t => t.type === 'expense');
    
    if (expenses.length === 0) return null;

    const totalSpent = expenses.reduce((sum, t) => sum + t.amount, 0);
    const avgExpense = totalSpent / expenses.length;
    
    // Categorize spending
    const categories = {};
    expenses.forEach(t => {
      categories[t.category] = (categories[t.category] || 0) + t.amount;
    });

    const topCategory = Object.entries(categories)
      .sort(([,a], [,b]) => b - a)[0];

    // Check for spending trends
    const last3Days = expenses.filter(t => 
      (new Date() - new Date(t.date)) / (1000 * 60 * 60 * 24) <= 3
    );

    const trends = [];
    
    if (last3Days.length >= 3) {
      const recentSpending = last3Days.reduce((sum, t) => sum + t.amount, 0);
      trends.push({
        type: 'warning',
        icon: '🚨',
        message: `High activity: ${last3Days.length} transactions in 3 days (UGX ${recentSpending.toLocaleString()})`
      });
    }

    if (avgExpense > 15000) {
      trends.push({
        type: 'info',
        icon: '💰',
        message: `Above average spending: UGX ${Math.round(avgExpense).toLocaleString()} per transaction`
      });
    }

    if (topCategory && topCategory[1] > totalSpent * 0.4) {
      trends.push({
        type: 'insight',
        icon: '📊',
        message: `${topCategory[0]} dominates spending (${Math.round((topCategory[1]/totalSpent) * 100)}%)`
      });
    }

    // Positive patterns
    const businessExpenses = expenses.filter(t => 
      t.category === 'business' || t.description.toLowerCase().includes('invest')
    );
    
    if (businessExpenses.length >= 2) {
      trends.push({
        type: 'positive',
        icon: '💚',
        message: `Great! ${businessExpenses.length} investment/business expenses detected`
      });
    }

    return { trends, totalSpent, avgExpense, topCategory };
  };

  const patterns = getSpendingPatterns();
  if (!patterns || patterns.trends.length === 0) {
    return (
      <div className="text-center py-4">
        <div className="text-gray-400 text-sm mb-2">🤖 Building AI insights...</div>
        <div className="text-gray-500 text-xs">Add more transactions to unlock personalized spending intelligence</div>
      </div>
    );
  }

  const getTrendColor = (type) => {
    switch(type) {
      case 'warning': return 'text-red-400';
      case 'positive': return 'text-green-400';
      case 'insight': return 'text-blue-400';
      default: return 'text-yellow-400';
    }
  };

  return (
    <div className="space-y-3">
      {patterns.trends.map((trend, index) => (
        <div key={index} className="flex items-start gap-3 p-2 bg-white bg-opacity-5 rounded-lg">
          <span className="text-lg">{trend.icon}</span>
          <div className="flex-1">
            <p className={`text-sm ${getTrendColor(trend.type)}`}>
              {trend.message}
            </p>
          </div>
        </div>
      ))}
      
      <div className="grid grid-cols-2 gap-4 mt-4 pt-3 border-t border-white border-opacity-20">
        <div className="text-center">
          <div className="text-white font-medium text-lg">
            UGX {Math.round(patterns.avgExpense).toLocaleString()}
          </div>
          <div className="text-gray-400 text-xs">Avg. Expense</div>
        </div>
        <div className="text-center">
          <div className="text-white font-medium text-lg">
            {patterns.topCategory ? patterns.topCategory[0] : 'N/A'}
          </div>
          <div className="text-gray-400 text-xs">Top Category</div>
        </div>
      </div>
    </div>
  );
};

// Proactive AI Suggestions - Simple & Encouraging
const ProactiveAISuggestions = ({ transactions, netWorth, currentJourneyStage, journeyStages, onOpenChat }) => {
  const [suggestions, setSuggestions] = useState([]);
  
  useEffect(() => {
    generateSimpleSuggestions();
  }, [transactions, netWorth, currentJourneyStage]);

  const generateSimpleSuggestions = () => {
    const suggestions = [];
    const stage = journeyStages[currentJourneyStage];
    const recentExpenses = transactions.filter(t => t.type === 'expense').slice(-3);
    
    // 1. ENCOURAGING STAGE PROGRESS
    const progress = (netWorth / stage.threshold.max) * 100;
    suggestions.push({
      id: 'progress',
      icon: '🌟',
      title: `You're doing great!`,
      message: `${Math.round(progress)}% through ${stage.name} stage. God is building something beautiful in your life!`,
      color: 'text-green-400',
      action: 'View Journey',
      mood: 'encouraging'
    });

    // 2. SIMPLE WISDOM TIP
    const wisdomTips = [
      { text: "Every small step of obedience leads to big breakthroughs!", verse: "Luke 16:10" },
      { text: "God's timing is perfect - trust His process in your finances!", verse: "Ecclesiastes 3:1" },
      { text: "Faithful stewardship today creates abundance tomorrow!", verse: "Matthew 25:23" },
      { text: "Your patience in building wealth shows wisdom and maturity!", verse: "Proverbs 21:5" }
    ];
    const randomTip = wisdomTips[Math.floor(Math.random() * wisdomTips.length)];
    
    suggestions.push({
      id: 'wisdom',
      icon: '💡',
      title: 'Daily Wisdom',
      message: randomTip.text,
      verse: randomTip.verse,
      color: 'text-yellow-400',
      action: 'Chat for More',
      mood: 'wise'
    });

    // 3. SPENDING ENCOURAGEMENT OR GENTLE GUIDANCE
    if (recentExpenses.length >= 2) {
      const totalRecent = recentExpenses.reduce((sum, t) => sum + t.amount, 0);
      if (totalRecent < netWorth * 0.1) {
        suggestions.push({
          id: 'spending-good',
          icon: '👏',
          title: 'Great spending control!',
          message: `You're keeping expenses reasonable. This kind of wisdom builds lasting wealth!`,
          color: 'text-green-400',
          action: 'Keep it up!',
          mood: 'celebrating'
        });
      } else {
        suggestions.push({
          id: 'spending-gentle',
          icon: '🤔',
          title: 'Gentle reminder',
          message: `Recent spending is a bit high. Remember, every wise choice brings you closer to your dreams!`,
          color: 'text-blue-400',
          action: 'Chat about it',
          mood: 'supportive'
        });
      }
    }

    setSuggestions(suggestions);
  };

  const handleSuggestionAction = (suggestion) => {
    if (suggestion.action === 'Chat for More' || suggestion.action === 'Chat about it') {
      onOpenChat();
    }
  };

  return (
    <div className="space-y-3">
      {suggestions.map((suggestion) => (
        <div
          key={suggestion.id}
          className="p-3 bg-white bg-opacity-5 rounded-lg border border-white border-opacity-10 hover:bg-opacity-10 transition-all"
        >
          <div className="flex items-start gap-3">
            <div className="text-lg">{suggestion.icon}</div>
            <div className="flex-1 min-w-0">
              <div className={`font-medium text-sm ${suggestion.color}`}>
                {suggestion.title}
              </div>
              <p className="text-gray-300 text-xs mt-1 leading-relaxed">
                {suggestion.message}
              </p>
              {suggestion.verse && (
                <p className="text-gray-400 text-xs mt-1 italic">
                  - {suggestion.verse}
                </p>
              )}
              {suggestion.action && (
                <button
                  onClick={() => handleSuggestionAction(suggestion)}
                  className="mt-2 px-2 py-1 bg-blue-500 bg-opacity-20 hover:bg-opacity-30 text-blue-300 text-xs rounded transition-colors"
                >
                  {suggestion.action}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      
      {/* Daily Encouragement */}
      <div className="p-3 bg-gradient-to-r from-purple-500 to-pink-500 bg-opacity-20 rounded-lg border border-purple-400 border-opacity-30">
        <div className="flex items-center gap-2 mb-2">
          <Heart className="w-4 h-4 text-pink-400" />
          <span className="text-pink-300 font-medium text-sm">Daily Encouragement</span>
        </div>
        <p className="text-gray-200 text-xs leading-relaxed">
          God sees your faithfulness in the small things. Keep making wise choices - 
          your financial breakthrough is coming! 🌈✨
        </p>
      </div>
    </div>
  );
};

// Advanced AI Multimedia Manager - Voice, Video & Analytics
const AIMultimediaManager = ({ transactions, netWorth, currentJourneyStage, onDataUpdate }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [recordings, setRecordings] = useState([]);
  const [analysisResults, setAnalysisResults] = useState([]);
  const [activeTab, setActiveTab] = useState('voice');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const videoStreamRef = useRef(null);
  const canvasRef = useRef(null);

  // Voice Recording Management
  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      const chunks = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        chunks.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(blob);
        const newRecording = {
          id: Date.now(),
          type: 'voice',
          url: audioUrl,
          timestamp: new Date(),
          analyzed: false,
          insights: null
        };
        setRecordings(prev => [...prev, newRecording]);
        analyzeVoiceRecording(newRecording);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Voice recording failed:', error);
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  // Video Recording Management
  const startVideoRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      
      videoStreamRef.current = stream;
      mediaRecorderRef.current = new MediaRecorder(stream);
      const chunks = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        chunks.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const videoUrl = URL.createObjectURL(blob);
        const newRecording = {
          id: Date.now(),
          type: 'video',
          url: videoUrl,
          timestamp: new Date(),
          analyzed: false,
          insights: null
        };
        setRecordings(prev => [...prev, newRecording]);
        analyzeVideoRecording(newRecording);
      };

      mediaRecorderRef.current.start();
      setIsVideoRecording(true);
    } catch (error) {
      console.error('Video recording failed:', error);
    }
  };

  const stopVideoRecording = () => {
    if (mediaRecorderRef.current && isVideoRecording) {
      mediaRecorderRef.current.stop();
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      setIsVideoRecording(false);
    }
  };

  // AI Analysis Functions
  const analyzeVoiceRecording = async (recording) => {
    setIsProcessing(true);
    
    // Simulate AI voice analysis
    setTimeout(() => {
      const insights = {
        mood: detectMoodFromVoice(),
        keywords: extractFinancialKeywords(),
        recommendations: generateVoiceRecommendations(),
        confidence: 'God is pleased with your faithful communication! 🙏'
      };
      
      setRecordings(prev => 
        prev.map(r => r.id === recording.id ? { ...r, analyzed: true, insights } : r)
      );
      setIsProcessing(false);
    }, 3000);
  };

  const analyzeVideoRecording = async (recording) => {
    setIsProcessing(true);
    
    // Simulate AI video analysis
    setTimeout(() => {
      const insights = {
        visualElements: detectFinancialVisuals(),
        engagement: measureEngagementLevel(),
        suggestions: generateVideoSuggestions(),
        blessing: 'Your dedication to visual learning shows wisdom! 📹✨'
      };
      
      setRecordings(prev => 
        prev.map(r => r.id === recording.id ? { ...r, analyzed: true, insights } : r)
      );
      setIsProcessing(false);
    }, 4000);
  };

  // AI Analysis Helper Functions
  const detectMoodFromVoice = () => {
    const moods = ['hopeful', 'determined', 'peaceful', 'excited', 'contemplative'];
    return moods[Math.floor(Math.random() * moods.length)];
  };

  const extractFinancialKeywords = () => {
    return ['savings', 'investment', 'goals', 'blessing', 'stewardship'];
  };

  const generateVoiceRecommendations = () => {
    return [
      'Your tone suggests readiness for financial growth! 🚀',
      'Consider recording weekly financial reflections',
      'Voice journaling can deepen your money mindset'
    ];
  };

  const detectFinancialVisuals = () => {
    return ['charts', 'goals board', 'budget sheets', 'vision board'];
  };

  const measureEngagementLevel = () => {
    return Math.floor(Math.random() * 30) + 70; // 70-100%
  };

  const generateVideoSuggestions = () => {
    return [
      'Create monthly financial progress videos! 🎬',
      'Record your journey milestones for motivation',
      'Share your testimony to inspire others'
    ];
  };

  // Advanced Analytics Engine
  const generateAdvancedAnalytics = () => {
    const analytics = {
      dataHealth: calculateDataHealth(),
      predictiveInsights: generatePredictions(),
      behavioralPatterns: analyzeBehaviorPatterns(),
      spiritualAlignment: assessSpiritualAlignment()
    };
    
    setAnalysisResults([analytics]);
  };

  const calculateDataHealth = () => {
    return {
      completeness: 85,
      accuracy: 92,
      freshness: 88,
      godlyWisdom: "Your diligent record-keeping honors God! 📊"
    };
  };

  const generatePredictions = () => {
    return [
      '🔮 Prediction: You\'ll reach next stage in 4-6 months with current trajectory',
      '📈 Trend: Your spending discipline is strengthening each month',
      '🎯 Opportunity: Investment readiness approaching in Q1 next year'
    ];
  };

  const analyzeBehaviorPatterns = () => {
    return [
      '✨ Pattern: You make wise decisions during morning hours',
      '🌙 Insight: Evening purchases tend to be more impulsive',
      '🙏 Strength: Prayer before major expenses shows wisdom'
    ];
  };

  const assessSpiritualAlignment = () => {
    return {
      score: 88,
      message: "Your finances reflect Kingdom principles! God is pleased with your stewardship. 👑",
      areas: ['Tithing consistently', 'Helping others', 'Wise planning']
    };
  };

  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-5 h-5 text-purple-400" />
        <span className="text-white font-medium">AI Multimedia Manager</span>
        <div className="ml-auto flex items-center gap-1">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          <span className="text-xs text-green-400">Active</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-4">
        {[
          { id: 'voice', label: 'Voice', icon: Headphones },
          { id: 'video', label: 'Video', icon: Video },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-colors ${
              activeTab === tab.id 
                ? 'bg-blue-500 text-white' 
                : 'bg-white bg-opacity-10 text-gray-300 hover:text-white'
            }`}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Voice Tab */}
      {activeTab === 'voice' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-white bg-opacity-5 rounded-lg">
            <button
              onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
              className={`p-2 rounded-full transition-all ${
                isRecording 
                  ? 'bg-red-500 animate-pulse' 
                  : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              {isRecording ? <MicOff className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4 text-white" />}
            </button>
            <div className="flex-1">
              <div className="text-white text-sm font-medium">
                {isRecording ? '🎙️ Recording voice insights...' : '🎤 Record financial thoughts'}
              </div>
              <div className="text-gray-400 text-xs">
                {isRecording ? 'Share your heart about your finances' : 'Click to start voice journaling'}
              </div>
            </div>
          </div>

          {/* Voice Recordings */}
          {recordings.filter(r => r.type === 'voice').map((recording) => (
            <div key={recording.id} className="p-3 bg-white bg-opacity-5 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Volume2 className="w-4 h-4 text-blue-400" />
                <span className="text-white text-sm">{recording.timestamp.toLocaleString()}</span>
                {recording.analyzed && <Star className="w-3 h-3 text-yellow-400" />}
              </div>
              
              <audio controls className="w-full mb-2" src={recording.url}></audio>
              
              {recording.insights && (
                <div className="mt-2 p-2 bg-green-500 bg-opacity-20 rounded">
                  <div className="text-green-300 text-xs font-medium mb-1">🤖 AI Insights:</div>
                  <div className="text-gray-300 text-xs">Mood: {recording.insights.mood}</div>
                  <div className="text-gray-300 text-xs">{recording.insights.confidence}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Video Tab */}
      {activeTab === 'video' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-white bg-opacity-5 rounded-lg">
            <button
              onClick={isVideoRecording ? stopVideoRecording : startVideoRecording}
              className={`p-2 rounded-full transition-all ${
                isVideoRecording 
                  ? 'bg-red-500 animate-pulse' 
                  : 'bg-purple-500 hover:bg-purple-600'
              }`}
            >
              {isVideoRecording ? <VideoOff className="w-4 h-4 text-white" /> : <Video className="w-4 h-4 text-white" />}
            </button>
            <div className="flex-1">
              <div className="text-white text-sm font-medium">
                {isVideoRecording ? '🎬 Recording video testimony...' : '📹 Record progress video'}
              </div>
              <div className="text-gray-400 text-xs">
                {isVideoRecording ? 'Share your financial journey visually' : 'Document your progress and goals'}
              </div>
            </div>
          </div>

          {/* Video Recordings */}
          {recordings.filter(r => r.type === 'video').map((recording) => (
            <div key={recording.id} className="p-3 bg-white bg-opacity-5 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Film className="w-4 h-4 text-purple-400" />
                <span className="text-white text-sm">{recording.timestamp.toLocaleString()}</span>
                {recording.analyzed && <Star className="w-3 h-3 text-yellow-400" />}
              </div>
              
              <video controls className="w-full mb-2" src={recording.url}></video>
              
              {recording.insights && (
                <div className="mt-2 p-2 bg-purple-500 bg-opacity-20 rounded">
                  <div className="text-purple-300 text-xs font-medium mb-1">🎬 Video Analysis:</div>
                  <div className="text-gray-300 text-xs">Engagement: {recording.insights.engagement}%</div>
                  <div className="text-gray-300 text-xs">{recording.insights.blessing}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-3">
          <button
            onClick={generateAdvancedAnalytics}
            className="w-full py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg text-sm font-medium hover:from-blue-600 hover:to-purple-600 transition-all"
            disabled={isProcessing}
          >
            {isProcessing ? '🧠 AI Analyzing...' : '🚀 Generate AI Analytics'}
          </button>

          {analysisResults.map((result, index) => (
            <div key={index} className="space-y-3">
              {/* Data Health */}
              <div className="p-3 bg-white bg-opacity-5 rounded-lg">
                <div className="text-white text-sm font-medium mb-2">📊 Data Health Score</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-gray-300">Completeness: {result.dataHealth.completeness}%</div>
                  <div className="text-gray-300">Accuracy: {result.dataHealth.accuracy}%</div>
                </div>
                <div className="text-green-300 text-xs mt-1">{result.dataHealth.godlyWisdom}</div>
              </div>

              {/* Predictions */}
              <div className="p-3 bg-blue-500 bg-opacity-20 rounded-lg">
                <div className="text-blue-300 text-sm font-medium mb-2">🔮 AI Predictions</div>
                {result.predictiveInsights.map((insight, i) => (
                  <div key={i} className="text-gray-300 text-xs mb-1">{insight}</div>
                ))}
              </div>

              {/* Spiritual Alignment */}
              <div className="p-3 bg-yellow-500 bg-opacity-20 rounded-lg">
                <div className="text-yellow-300 text-sm font-medium mb-2">👑 Spiritual Alignment</div>
                <div className="text-white text-xs mb-2">Score: {result.spiritualAlignment.score}%</div>
                <div className="text-gray-300 text-xs">{result.spiritualAlignment.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isProcessing && (
        <div className="text-center py-4">
          <div className="animate-spin w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-2"></div>
          <div className="text-gray-400 text-xs">AI is analyzing your content with godly wisdom...</div>
        </div>
      )}
    </div>
  );
};

// Journey Progress Tracker Component
const JourneyProgressTracker = ({ journeyStages, currentStage, stageProgress, journeyInsights, netWorth }) => {
  const currentStageData = journeyStages[currentStage];
  const StageIcon = currentStageData.icon;

  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-3 mb-4">
        <MapPin className="w-5 h-5 text-blue-400" />
        <span className="text-white font-medium">ICAN Journey Progress</span>
      </div>

      {/* Current Stage Display */}
      <div className={`p-4 rounded-lg border ${currentStageData.bgColor} bg-opacity-20 border-opacity-30 mb-4`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 ${currentStageData.bgColor} bg-opacity-30 rounded-full flex items-center justify-center`}>
              <StageIcon className={`w-5 h-5 ${currentStageData.color}`} />
            </div>
            <div>
              <div className={`font-semibold ${currentStageData.color}`}>
                Stage {currentStage}: {currentStageData.name}
              </div>
              <div className="text-gray-300 text-sm">{currentStageData.subtitle}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-white font-bold">UGX {netWorth.toLocaleString()}</div>
            <div className="text-gray-400 text-xs">{Math.round(stageProgress)}% Complete</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-gray-700 rounded-full h-2 mb-3">
          <div 
            className={`h-2 rounded-full ${currentStageData.bgColor} transition-all duration-500`}
            style={{ width: `${stageProgress}%` }}
          ></div>
        </div>

        <div className="text-gray-300 text-sm">
          {currentStageData.problem}
        </div>
      </div>

      {/* Stage Timeline */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {Object.entries(journeyStages).map(([stageNum, stage]) => {
          const StageIcon = stage.icon;
          const isCompleted = parseInt(stageNum) < currentStage;
          const isCurrent = parseInt(stageNum) === currentStage;
          
          return (
            <div 
              key={stageNum}
              className={`p-2 rounded-lg border text-center transition-all ${
                isCompleted 
                  ? 'bg-green-500 bg-opacity-20 border-green-500 border-opacity-30' 
                  : isCurrent 
                  ? `${stage.bgColor} bg-opacity-20 border-opacity-30 border-current`
                  : 'bg-gray-600 bg-opacity-20 border-gray-500 border-opacity-30'
              }`}
            >
              <StageIcon className={`w-4 h-4 mx-auto mb-1 ${
                isCompleted ? 'text-green-400' : isCurrent ? stage.color : 'text-gray-500'
              }`} />
              <div className={`text-xs font-medium ${
                isCompleted ? 'text-green-400' : isCurrent ? stage.color : 'text-gray-500'
              }`}>
                Stage {stageNum}
              </div>
            </div>
          );
        })}
      </div>

      {/* Journey Insights */}
      {journeyInsights && (
        <div className="space-y-3">
          <div className="p-3 bg-blue-500 bg-opacity-10 rounded-lg border border-blue-400 border-opacity-30">
            <div className="text-blue-300 font-medium text-sm mb-2">🎯 Next Milestone:</div>
            <div className="text-white text-sm">{journeyInsights.nextMilestone.description}</div>
            <div className="text-gray-300 text-xs mt-1">
              Estimated time: {journeyInsights.timeToNext}
            </div>
          </div>

          {journeyInsights.strengths.length > 0 && (
            <div className="p-3 bg-green-500 bg-opacity-10 rounded-lg border border-green-400 border-opacity-30">
              <div className="text-green-300 font-medium text-sm mb-2">💪 Current Strengths:</div>
              <div className="text-gray-300 text-sm">
                {journeyInsights.strengths.slice(0, 2).join(' • ')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Transaction Input Component
const TransactionInput = ({ 
  onAddTransaction, 
  isListening, 
  onToggleListening, 
  typingFeedback, 
  onInputChange, 
  isVoiceSupported 
}) => {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [realTimeAnalysis, setRealTimeAnalysis] = useState('');

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);
    onInputChange(value);
    
    // Real-time analysis of input
    if (value.length > 10) {
      const analysis = analyzeInputRealTime(value);
      setRealTimeAnalysis(analysis);
    } else {
      setRealTimeAnalysis('');
    }
  };

  const analyzeInputRealTime = (text) => {
    const hasAmount = /\d+(?:,\d+)?/.test(text);
    const hasType = /income|expense|earn|spend|cost|buy|purchase|pay|receive/i.test(text);
    const hasCategory = /food|transport|business|utilities|fuel|lunch|dinner/i.test(text);
    
    let hints = [];
    if (!hasAmount) hints.push('💰 Add amount');
    if (!hasType) hints.push('📊 Specify income/expense');  
    if (!hasCategory) hints.push('🏷️ Add category');
    
    if (hints.length === 0) return '✅ Ready to process!';
    return `📝 Suggestions: ${hints.join(', ')}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    setIsProcessing(true);
    try {
      // Process natural language input with enhanced parsing
      const transaction = await parseTransaction(input);
      onAddTransaction(transaction);
      setInput('');
      setRealTimeAnalysis('');
    } catch (error) {
      console.error('Error processing transaction:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const parseTransaction = async (text) => {
    // Simple NLP parsing for demo - in production, use more sophisticated parsing
    const amount = text.match(/\d+(?:,\d+)?/)?.[0]?.replace(',', '') || '0';
    const isIncome = /income|earn|receive|paid|salary|fare/i.test(text);
    const isExpense = /expense|spend|cost|buy|purchase|pay/i.test(text);
    
    return {
      id: Date.now(),
      amount: parseFloat(amount),
      type: isIncome ? 'income' : isExpense ? 'expense' : 'income',
      description: text,
      date: new Date().toISOString(),
      category: extractCategory(text)
    };
  };

  const extractCategory = (text) => {
    const categories = {
      'transport': /boda|taxi|fuel|transport/i,
      'food': /food|lunch|dinner|eat|restaurant/i,
      'business': /business|client|service|work/i,
      'utilities': /electricity|water|rent|bill/i,
      'other': /.*/
    };

    for (const [category, regex] of Object.entries(categories)) {
      if (regex.test(text)) return category;
    }
    return 'other';
  };

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-400" />
          <span className="text-white font-medium">Smart Transaction Entry</span>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {isVoiceSupported && (
            <span className="text-green-400">🎤 Voice Ready</span>
          )}
          <span className="text-blue-400">⚡ AI Powered</span>
        </div>
      </div>
      
      {/* Real-time feedback */}
      {typingFeedback && (
        <div className="mb-3 p-2 bg-blue-500 bg-opacity-20 rounded-lg border border-blue-400 border-opacity-30">
          <p className="text-blue-300 text-sm">{typingFeedback}</p>
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <input
            ref={input => {
              // Store ref for voice input access
              if (input && onInputChange) {
                window.transactionInputRef = input;
              }
            }}
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder={isVoiceSupported 
              ? "💬 Say: 'Income 20,000 Boda fare' or type here..." 
              : "Type: 'Income 20,000 Boda fare' or 'Expense 5,000 lunch'"
            }
            className="w-full px-4 py-3 pr-12 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400"
            disabled={isProcessing}
          />
          {isVoiceSupported && (
            <button
              type="button"
              onClick={onToggleListening}
              className={`absolute right-3 top-1/2 transform -translate-y-1/2 p-1.5 rounded-full transition-all ${
                isListening 
                  ? 'text-red-400 bg-red-400 bg-opacity-20 animate-pulse shadow-lg' 
                  : 'text-gray-400 hover:text-white hover:bg-white hover:bg-opacity-10'
              }`}
              title={isListening ? 'Stop voice input' : 'Start voice input'}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
        </div>
        
        {/* Real-time analysis */}
        {realTimeAnalysis && (
          <div className="p-2 bg-green-500 bg-opacity-20 rounded border border-green-400 border-opacity-30">
            <p className="text-green-300 text-sm">{realTimeAnalysis}</p>
          </div>
        )}
        
        <button
          type="submit"
          disabled={!input.trim() || isProcessing}
          className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-lg transition-all font-medium shadow-lg disabled:shadow-none"
        >
          {isProcessing ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Processing...
            </span>
          ) : (
            '⚡ Add Transaction'
          )}
        </button>
      </form>
    </div>
  );
};

// Pillar Status Component
const PillarStatus = ({ title, icon: Icon, score, status, description, onAction }) => {
  const getStatusColor = (score) => {
    if (score >= 80) return 'text-green-400 border-green-400';
    if (score >= 60) return 'text-yellow-400 border-yellow-400';
    return 'text-red-400 border-red-400';
  };

  return (
    <div className={`glass-card p-4 border-l-4 ${getStatusColor(score)}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Icon className={`w-6 h-6 ${getStatusColor(score).split(' ')[0]}`} />
          <div>
            <h3 className="text-white font-semibold">{title}</h3>
            <p className="text-gray-300 text-sm mt-1">{description}</p>
            <p className="text-xs text-gray-400 mt-2">{status}</p>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold ${getStatusColor(score).split(' ')[0]}`}>
            {score}%
          </div>
          {onAction && (
            <button
              onClick={onAction}
              className="text-xs text-blue-400 hover:text-blue-300 mt-1"
            >
              Improve
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Smart Data Manager Component - Creative AI & Data Management
const SmartDataManager = ({ 
  transactions, 
  multimediaData, 
  netWorth, 
  currentJourneyStage,
  journeyStages 
}) => {
  const [dataBackup, setDataBackup] = useState({
    local: null,
    cloud: null,
    lastSync: null
  });
  const [creativeMode, setCreativeMode] = useState(false);
  const [storyData, setStoryData] = useState({
    financialJourney: '',
    goalVisualization: '',
    celebrations: []
  });

  // Smart Data Backup System
  const createSmartBackup = () => {
    const backupData = {
      timestamp: new Date().toISOString(),
      transactions: transactions,
      multimedia: multimediaData,
      netWorth: netWorth,
      stage: currentJourneyStage,
      spiritual: {
        blessingsCount: Math.floor(netWorth / 1000),
        gratitudeMoments: transactions.filter(t => t.amount > 0).length,
        stewardshipScore: calculateStewardshipScore()
      }
    };
    
    // Local storage backup
    localStorage.setItem('ican_backup', JSON.stringify(backupData));
    
    // Simulated cloud backup (would connect to real service)
    setDataBackup({
      local: new Date(),
      cloud: new Date(),
      lastSync: new Date()
    });
    
    return backupData;
  };

  const calculateStewardshipScore = () => {
    const givingTransactions = transactions.filter(t => 
      t.description.toLowerCase().includes('tithe') || 
      t.description.toLowerCase().includes('offering') ||
      t.description.toLowerCase().includes('charity')
    );
    const totalGiving = givingTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const totalIncome = transactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    
    return totalIncome > 0 ? Math.round((totalGiving / totalIncome) * 100) : 0;
  };

  // Creative AI Story Generation
  const generateFinancialStory = () => {
    const stewardshipScore = calculateStewardshipScore();
    const totalTransactions = transactions.length;
    const positiveTransactions = transactions.filter(t => t.amount > 0).length;
    
    const storyTemplates = [
      `🌟 Your Financial Journey with God 🌟

Once upon a time, God blessed you with ${totalTransactions} financial opportunities to practice stewardship. Like a faithful steward in the parable of talents, you've been growing in wisdom and understanding.

💝 Blessings Received: ${positiveTransactions} times God provided for your needs
🎯 Current Stage: ${journeyStages[currentJourneyStage]?.name || 'Growing in Faith'}
⭐ Stewardship Score: ${stewardshipScore}% (Remember: "It is more blessed to give than to receive" - Acts 20:35)

${stewardshipScore >= 10 ? 
  "🙏 Amazing! You're showing the heart of a generous giver. God sees your faithful stewardship!" :
  "💪 Keep growing! Every small step of obedience matters to God. 'Whoever is faithful in very little is also faithful in much' - Luke 16:10"
}`,

      `📖 Chapter ${Math.floor(totalTransactions / 10) + 1}: Walking in Financial Wisdom 📖

In this chapter of your life, God is teaching you about His provision and your role as a steward. You've experienced ${totalTransactions} financial lessons, each one designed to draw you closer to Him.

🌱 Seeds of Faithfulness: ${stewardshipScore}% giving ratio
🏆 Victory Moments: ${positiveTransactions} times you experienced God's provision
🎪 Current Adventure: ${journeyStages[currentJourneyStage]?.name || 'Learning and Growing'}

"Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight." - Proverbs 3:5-6`
    ];

    return storyTemplates[Math.floor(Math.random() * storyTemplates.length)];
  };

  // Goal Visualization with Creative AI
  const generateGoalVisualization = () => {
    const nextStage = journeyStages[currentJourneyStage + 1];
    if (!nextStage) return "🎉 Congratulations! You've reached the highest level of financial stewardship!";

    return `🎯 Your Next Divine Assignment 🎯

God is preparing you for: ${nextStage.name}
Target: $${nextStage.netWorthTarget.toLocaleString()}

🌈 Vision Board:
${nextStage.netWorthTarget >= 100000 ? '🏰' : nextStage.netWorthTarget >= 50000 ? '🏠' : '🌱'} ${nextStage.description}

📊 Progress: ${Math.round((netWorth / nextStage.netWorthTarget) * 100)}%
💪 You're $${(nextStage.netWorthTarget - netWorth).toLocaleString()} away from your next breakthrough!

🙏 Prayer Focus: "God, help me to be faithful in this season so I can be trusted with more. Show me how to honor You with every financial decision."`;
  };

  // Celebration Tracker
  const generateCelebrations = () => {
    const celebrations = [];
    
    // Milestone celebrations
    if (netWorth >= 1000 && netWorth < 5000) {
      celebrations.push({
        icon: '🎉',
        title: 'First Thousand Blessing!',
        message: 'God has blessed you with your first $1,000! This is just the beginning of His faithfulness.'
      });
    }
    
    if (calculateStewardshipScore() >= 10) {
      celebrations.push({
        icon: '❤️',
        title: 'Generous Heart Award!',
        message: 'You\'re giving 10%+ back to God! Your generous heart brings Him joy.'
      });
    }
    
    if (transactions.filter(t => t.amount > 0).length >= 10) {
      celebrations.push({
        icon: '🌟',
        title: 'Faithful Receiver!',
        message: 'God has provided for you 10+ times! He truly is Jehovah Jireh - your provider!'
      });
    }
    
    return celebrations;
  };

  // Creative Data Insights
  const generateCreativeInsights = () => {
    const insights = [];
    
    // Spending pattern insights
    const topCategories = transactions
      .filter(t => t.amount < 0)
      .reduce((acc, t) => {
        const category = t.description.split(' ')[0];
        acc[category] = (acc[category] || 0) + Math.abs(t.amount);
        return acc;
      }, {});
    
    const topCategory = Object.entries(topCategories)
      .sort(([,a], [,b]) => b - a)[0];
    
    if (topCategory) {
      insights.push({
        type: 'spending',
        icon: '💡',
        title: 'Smart Spending Insight',
        message: `Your main spending focus is ${topCategory[0]}. Ask God: "Am I being a good steward in this area?"`
      });
    }
    
    // Income pattern insights
    const avgIncome = transactions
      .filter(t => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0) / Math.max(1, transactions.filter(t => t.amount > 0).length);
    
    if (avgIncome > 0) {
      insights.push({
        type: 'income',
        icon: '🎁',
        title: 'Blessing Pattern',
        message: `God blesses you with an average of $${avgIncome.toFixed(0)} per blessing. His provision is consistent!`
      });
    }
    
    return insights;
  };

  useEffect(() => {
    if (creativeMode) {
      setStoryData({
        financialJourney: generateFinancialStory(),
        goalVisualization: generateGoalVisualization(),
        celebrations: generateCelebrations()
      });
    }
  }, [creativeMode, transactions, netWorth, currentJourneyStage]);

  // Auto-backup every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      createSmartBackup();
    }, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [transactions, multimediaData, netWorth]);

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 mt-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-600" />
          Smart Data Manager
        </h3>
        
        <div className="flex gap-2">
          <button
            onClick={() => setCreativeMode(!creativeMode)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              creativeMode 
                ? 'bg-purple-100 text-purple-700 border border-purple-300'
                : 'bg-gray-100 text-gray-700 border border-gray-300'
            }`}
          >
            <Sparkles className="w-4 h-4 inline mr-1" />
            Creative Mode
          </button>
          
          <button
            onClick={createSmartBackup}
            className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg border border-blue-300 font-medium hover:bg-blue-200 transition-colors"
          >
            <Cloud className="w-4 h-4 inline mr-1" />
            Backup Now
          </button>
        </div>
      </div>

      {/* Data Status Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-green-600" />
            <span className="font-medium text-green-800">Data Security</span>
          </div>
          <p className="text-sm text-green-700">
            ✅ Local Backup: {dataBackup.local ? 'Protected' : 'Pending'}
          </p>
          <p className="text-sm text-green-700">
            ☁️ Cloud Sync: {dataBackup.cloud ? 'Synced' : 'Offline'}
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-blue-600" />
            <span className="font-medium text-blue-800">Data Stats</span>
          </div>
          <p className="text-sm text-blue-700">
            📊 Transactions: {transactions.length}
          </p>
          <p className="text-sm text-blue-700">
            🎥 Media Files: {multimediaData.recordings?.length || 0}
          </p>
        </div>

        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-4 h-4 text-purple-600" />
            <span className="font-medium text-purple-800">Stewardship</span>
          </div>
          <p className="text-sm text-purple-700">
            ⭐ Score: {calculateStewardshipScore()}%
          </p>
          <p className="text-sm text-purple-700">
            🙏 Stage: {journeyStages[currentJourneyStage]?.name || 'Growing'}
          </p>
        </div>
      </div>

      {/* Creative AI Features */}
      {creativeMode && (
        <div className="space-y-6">
          {/* Financial Journey Story */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-blue-600" />
              <h4 className="font-bold text-blue-800">Your Financial Journey Story</h4>
            </div>
            <div className="whitespace-pre-line text-gray-700 leading-relaxed">
              {storyData.financialJourney}
            </div>
          </div>

          {/* Goal Visualization */}
          <div className="bg-gradient-to-r from-green-50 to-yellow-50 border border-green-200 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Target className="w-5 h-5 text-green-600" />
              <h4 className="font-bold text-green-800">Goal Visualization</h4>
            </div>
            <div className="whitespace-pre-line text-gray-700 leading-relaxed">
              {storyData.goalVisualization}
            </div>
          </div>

          {/* Celebrations */}
          {storyData.celebrations.length > 0 && (
            <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-5 h-5 text-yellow-600" />
                <h4 className="font-bold text-yellow-800">Celebration Corner</h4>
              </div>
              <div className="grid gap-3">
                {storyData.celebrations.map((celebration, index) => (
                  <div key={index} className="flex items-start gap-3 bg-white bg-opacity-50 rounded-lg p-3">
                    <span className="text-2xl">{celebration.icon}</span>
                    <div>
                      <h5 className="font-semibold text-gray-800">{celebration.title}</h5>
                      <p className="text-gray-600 text-sm">{celebration.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Creative Insights */}
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-purple-600" />
              <h4 className="font-bold text-purple-800">Creative AI Insights</h4>
            </div>
            <div className="grid gap-3">
              {generateCreativeInsights().map((insight, index) => (
                <div key={index} className="flex items-start gap-3 bg-white bg-opacity-50 rounded-lg p-3">
                  <span className="text-xl">{insight.icon}</span>
                  <div>
                    <h5 className="font-semibold text-gray-800">{insight.title}</h5>
                    <p className="text-gray-600 text-sm">{insight.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Spiritual Encouragement */}
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg p-6 text-center">
            <Star className="w-8 h-8 text-indigo-600 mx-auto mb-3" />
            <h4 className="font-bold text-indigo-800 mb-2">Today's Encouragement</h4>
            <p className="text-indigo-700 italic">
              "And my God will meet all your needs according to the riches of his glory in Christ Jesus." - Philippians 4:19
            </p>
            <p className="text-gray-600 text-sm mt-2">
              Remember: You are not just managing money, you are stewarding God's blessings. He sees your heart and rewards faithfulness! 💝
            </p>
          </div>
        </div>
      )}

      {/* Last Updated */}
      <div className="text-center text-xs text-gray-500 mt-4 pt-4 border-t border-gray-200">
        Last backup: {dataBackup.lastSync ? dataBackup.lastSync.toLocaleString() : 'Never'} | 
        Auto-backup every 5 minutes | 
        All data encrypted with love 💝
      </div>
    </div>
  );
};

// Main ICAN Capital Engine Component
const ICANCapitalEngine = () => {
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState('SE'); // SE or BO
  const [operatingCountry, setOperatingCountry] = useState('Uganda');
  const [goals, setGoals] = useState({ targetNetWorth: 1000000 });
  const [transactions, setTransactions] = useState([]);
  const [netWorth, setNetWorth] = useState(0);
  const [netWorthVelocity, setNetWorthVelocity] = useState(0);
  const [iorScore, setIorScore] = useState(65);
  const [showBiometricModal, setShowBiometricModal] = useState(false);
  const [biometricAction, setBiometricAction] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [contractText, setContractText] = useState('');
  const [contractAnalysis, setContractAnalysis] = useState(null);
  const [complianceData, setComplianceData] = useState(null);
  const [scheduleData, setScheduleData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [isVoiceSupported, setIsVoiceSupported] = useState(false);
  const [typingFeedback, setTypingFeedback] = useState('');
  const [aiAdvice, setAiAdvice] = useState(null);
  const [showAdviceModal, setShowAdviceModal] = useState(false);
  const [pendingTransaction, setPendingTransaction] = useState(null);
  const [spendingInsights, setSpendingInsights] = useState(null);
  const [currentJourneyStage, setCurrentJourneyStage] = useState(1);
  const [stageProgress, setStageProgress] = useState(0);
  const [journeyInsights, setJourneyInsights] = useState(null);
  const [showStageModal, setShowStageModal] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [multimediaData, setMultimediaData] = useState({
    recordings: [],
    analytics: [],
    backups: []
  });
  
  // Refs for voice recognition
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);

  // ICAN Journey Framework - The Four Stages
  const journeyStages = {
    1: {
      name: "Survival Stage",
      subtitle: "Establishing Velocity",
      threshold: { min: 0, max: 20000 },
      icon: Zap,
      color: "text-red-400",
      bgColor: "bg-red-500",
      problem: "Cash flow is minute, volatile, and impossible to track reliably. No savings, only daily survival.",
      solution: "Transaction Input Module (Voice/Text) for immediate, simple inputs.",
      improvement: "Real-time Net Worth Velocity tracking replaces pen and paper estimation.",
      focus: ["Establish basic income tracking", "Build transaction recording habits", "Achieve daily cash flow visibility"],
      milestone: "Stabilize into steady income stream (UGX 20,000+)"
    },
    2: {
      name: "Structure Stage", 
      subtitle: "Time as Capital",
      threshold: { min: 20000, max: 500000 },
      icon: Building,
      color: "text-yellow-400", 
      bgColor: "bg-yellow-500",
      problem: "Income is stable but growth is capped because time is disorganized and low-value tasks dominate.",
      solution: "Holistic Optimizer (Daily Prosperity Schedule) with AI-forced discipline.",
      improvement: "Dynamic schedule integrating Prayer Time and Deep Work Blocks maximizes output.",
      focus: ["Optimize time allocation", "Establish spiritual foundation", "Create high-value work blocks"],
      milestone: "Achieve organized, productive lifestyle (UGX 500,000+)"
    },
    3: {
      name: "Security Stage",
      subtitle: "Protecting the Principle", 
      threshold: { min: 500000, max: 10000000 },
      icon: Crown,
      color: "text-blue-400",
      bgColor: "bg-blue-500", 
      problem: "Signing contracts that could erode wealth overnight. Legal mistakes can undo months of work.",
      solution: "Wealth Guard (Legal NLP Vetting) with Biometric Security Gate.",
      improvement: "AI legal auditor protects capital, enabling confident scaling operations.",
      focus: ["Legal contract protection", "Risk management systems", "Asset security protocols"],
      milestone: "Secure foundation for major ventures (UGX 10M+ contracts)"
    },
    4: {
      name: "Readiness Stage",
      subtitle: "Tender-Ready Entity",
      threshold: { min: 10000000, max: Infinity },
      icon: Rocket,
      color: "text-green-400",
      bgColor: "bg-green-500",
      problem: "Want to bid on government tenders or secure C-suite roles but missing specific requirements.",
      solution: "Global Navigator and ICAN Profile Analyzer for Gap Analysis.", 
      improvement: "AI shifts from defense to offense, ensuring 100% readiness for any opportunity.",
      focus: ["Global compliance", "Opportunity readiness", "Competitive positioning"],
      milestone: "Ready for premium global opportunities and major tenders"
    }
  };

  // Initialize user and load data
  useEffect(() => {
    initializeUser();
    loadUserData();
    initializeSpeechRecognition();
  }, []);

  // Calculate net worth and velocity
  useEffect(() => {
    calculateFinancials();
  }, [transactions]);

  // Calculate IOR score
  useEffect(() => {
    calculateIORScore();
  }, [netWorth, contractAnalysis, complianceData, scheduleData]);

  // Track journey progression
  useEffect(() => {
    detectJourneyStage();
    generateJourneyInsights();
  }, [netWorth, transactions, contractAnalysis, complianceData, scheduleData]);

  // Intelligent Journey Stage Detection
  const detectJourneyStage = () => {
    const currentStage = determineCurrentStage();
    const progress = calculateStageProgress(currentStage);
    
    if (currentStage !== currentJourneyStage) {
      // Stage advancement detected!
      setCurrentJourneyStage(currentStage);
      if (currentStage > 1) {
        setShowStageModal(true); // Celebrate progression
      }
    }
    
    setStageProgress(progress);
  };

  const determineCurrentStage = () => {
    // Stage 1: Survival (UGX 0 - 20,000)
    if (netWorth < 20000) return 1;
    
    // Stage 2: Structure (UGX 20,000 - 500,000)
    if (netWorth < 500000) return 2;
    
    // Stage 3: Security (UGX 500,000 - 10M)
    if (netWorth < 10000000) return 3;
    
    // Stage 4: Readiness (UGX 10M+)
    return 4;
  };

  const calculateStageProgress = (stage) => {
    const stageData = journeyStages[stage];
    const { min, max } = stageData.threshold;
    
    if (max === Infinity) {
      // For final stage, calculate based on pillar completeness
      const scores = getPillarScores();
      const avgScore = (scores.financialScore + scores.legalScore + 
                       scores.regulatoryScore + scores.humanScore) / 4;
      return Math.min(100, avgScore);
    }
    
    const progressRange = max - min;
    const currentProgress = Math.max(0, netWorth - min);
    return Math.min(100, (currentProgress / progressRange) * 100);
  };

  const generateJourneyInsights = () => {
    const stage = journeyStages[currentJourneyStage];
    const insights = {
      currentStage: stage,
      progress: stageProgress,
      nextMilestone: getNextMilestone(),
      recommendedActions: getStageSpecificActions(),
      timeToNext: estimateTimeToNextStage(),
      strengths: identifyStageStrengths(),
      gaps: identifyStageGaps()
    };
    
    setJourneyInsights(insights);
  };

  const getNextMilestone = () => {
    const currentStage = journeyStages[currentJourneyStage];
    const nextStage = journeyStages[currentJourneyStage + 1];
    
    if (stageProgress < 80) {
      return {
        type: 'stage_completion',
        description: currentStage.milestone,
        target: currentStage.threshold.max
      };
    } else if (nextStage) {
      return {
        type: 'stage_advancement', 
        description: nextStage.milestone,
        target: nextStage.threshold.min
      };
    }
    
    return {
      type: 'mastery',
      description: 'Global opportunity mastery',
      target: 'Excellence across all pillars'
    };
  };

  const getStageSpecificActions = () => {
    const stage = currentJourneyStage;
    const actions = [];
    
    switch(stage) {
      case 1: // Survival
        actions.push(
          'Record every transaction using voice or text input',
          'Track daily cash flow to identify patterns', 
          'Focus on increasing income stability',
          'Build the habit of monitoring Net Worth Velocity'
        );
        break;
        
      case 2: // Structure  
        actions.push(
          'Implement daily spiritual alignment blocks',
          'Create structured Deep Work time blocks',
          'Optimize schedule using AI recommendations',
          'Eliminate low-value time wasters',
          'Build consistent productive routines'
        );
        break;
        
      case 3: // Security
        actions.push(
          'Activate biometric security for all contracts',
          'Use AI legal vetting for every agreement',
          'Build comprehensive risk management systems',
          'Protect accumulated wealth through legal compliance',
          'Scale operations with security-first mindset'
        );
        break;
        
      case 4: // Readiness
        actions.push(
          'Complete comprehensive Gap Analysis across all pillars',
          'Achieve 95%+ ICAN Opportunity Rating',
          'Maintain global compliance standards',
          'Build competitive positioning for major opportunities',
          'Master the five-pillar readiness framework'
        );
        break;
    }
    
    return actions;
  };

  const estimateTimeToNextStage = () => {
    const currentVelocity = netWorthVelocity;
    const currentStage = journeyStages[currentJourneyStage];
    const remaining = currentStage.threshold.max - netWorth;
    
    if (currentVelocity <= 0) return 'Focus on positive cash flow first';
    
    const monthsToNext = Math.ceil(remaining / currentVelocity);
    
    if (monthsToNext < 1) return 'Less than 1 month';
    if (monthsToNext < 12) return `${monthsToNext} months`;
    return `${Math.floor(monthsToNext / 12)} years, ${monthsToNext % 12} months`;
  };

  const identifyStageStrengths = () => {
    const strengths = [];
    const scores = getPillarScores();
    
    if (transactions.length >= 10) strengths.push('Consistent transaction tracking');
    if (netWorthVelocity > 0) strengths.push('Positive wealth velocity');
    if (scores.financialScore > 70) strengths.push('Strong financial foundation');
    if (contractAnalysis) strengths.push('Active legal risk management');
    if (complianceData) strengths.push('Regulatory awareness');
    if (scheduleData) strengths.push('Optimized time management');
    
    return strengths.length > 0 ? strengths : ['Building momentum'];
  };

  const identifyStageGaps = () => {
    const gaps = [];
    const stage = currentJourneyStage;
    const scores = getPillarScores();
    
    // Stage-specific gap identification
    if (stage === 1 && transactions.length < 5) gaps.push('Need more transaction data');
    if (stage === 2 && !scheduleData) gaps.push('Schedule optimization required');
    if (stage === 3 && !contractAnalysis) gaps.push('Legal vetting system needed');
    if (stage === 4 && iorScore < 85) gaps.push('IOR score needs improvement');
    
    // Universal gaps
    if (scores.financialScore < 60) gaps.push('Financial pillar needs attention');
    if (scores.legalScore < 60) gaps.push('Legal resilience requires work');
    if (scores.regulatoryScore < 60) gaps.push('Regulatory compliance gaps');
    if (scores.humanScore < 60) gaps.push('Human capital optimization needed');
    
    return gaps;
  };

  const initializeUser = () => {
    // In production, this would use Firebase Auth
    const userId = localStorage.getItem('ican_user_id') || generateUserId();
    localStorage.setItem('ican_user_id', userId);
    setUser({ id: userId, email: 'user@example.com' });
  };

  const generateUserId = () => {
    return 'user_' + Math.random().toString(36).substr(2, 9);
  };

  // Initialize Speech Recognition
  const initializeSpeechRecognition = () => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';
      
      recognitionRef.current.onstart = () => {
        setTypingFeedback('🎤 Listening... Speak clearly');
      };
      
      recognitionRef.current.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }
        
        setVoiceTranscript(finalTranscript);
        
        if (finalTranscript) {
          // Auto-populate the input field through the window reference
          if (window.transactionInputRef) {
            window.transactionInputRef.value = finalTranscript;
            window.transactionInputRef.dispatchEvent(new Event('input', { bubbles: true }));
          }
          setTypingFeedback(`✅ Captured: "${finalTranscript.slice(0, 50)}${finalTranscript.length > 50 ? '...' : ''}"`); 
          
          // Auto-stop after capturing complete sentence
          if (finalTranscript.trim().length > 10) {
            setTimeout(() => {
              stopVoiceRecognition();
            }, 1000);
          }
        } else if (interimTranscript) {
          setTypingFeedback(`🎙️ Processing: "${interimTranscript.slice(0, 30)}..."`);  
        }
      };
      
      recognitionRef.current.onerror = (event) => {
        setTypingFeedback(`❌ Voice error: ${event.error}`);
        setIsListening(false);
      };
      
      recognitionRef.current.onend = () => {
        setIsListening(false);
        if (voiceTranscript) {
          setTypingFeedback('✅ Voice input complete. Review and submit.');
        } else {
          setTypingFeedback('📝 Ready for voice or text input');
        }
      };
      
      setIsVoiceSupported(true);
      setTypingFeedback('📝 Voice recognition ready. Click mic to speak.');
    } else {
      setIsVoiceSupported(false);
      setTypingFeedback('⌨️ Voice not supported. Text input available.');
    }
  };

  // Start voice recognition
  const startVoiceRecognition = () => {
    if (recognitionRef.current && !isListening) {
      setVoiceTranscript('');
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  // Stop voice recognition
  const stopVoiceRecognition = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  // POWERFUL AI INCOME DECISION ENGINE - Specific Yes/No/Wait/Soon Analysis
  const analyzeSpendingWithAI = async (transaction) => {
    const isIncome = transaction.type === 'income' || transaction.amount > 0;
    
    if (isIncome) {
      return await analyzeIncomeDecision(transaction);
    } else {
      return await analyzeSpendingDecision(transaction);
    }
  };

  // ADVANCED INCOME ANALYSIS ENGINE
  const analyzeIncomeDecision = async (transaction) => {
    const amount = Math.abs(transaction.amount);
    const recentIncome = transactions.filter(t => (t.type === 'income' || t.amount > 0) && isRecentTransaction(t.date, 60));
    const avgMonthlyIncome = calculateAverageIncome(recentIncome);
    const incomeGrowth = calculateIncomeGrowthRate(transactions);
    const incomeStability = calculateIncomeStability(transactions);
    const savingsRate = calculateSavingsRate();
    const givingRate = calculateGivingRate();
    const expenseRatio = calculateExpenseRatio();

    let decision, confidence, actionPlan, reasoning, encouragement, biblicalWisdom;

    // DECISION ENGINE - SPECIFIC RECOMMENDATIONS
    if (amount >= avgMonthlyIncome * 1.5 && incomeStability >= 0.8) {
      decision = "YES - MAJOR BLESSING RECEIVED";
      confidence = 98;
      actionPlan = [
        "✅ IMMEDIATE: Set aside 10% for tithe/offering",
        "💰 SAVE: Put 25% into savings/investment", 
        "🎯 GOALS: Accelerate major financial goals",
        "❤️ GIVE: Consider increasing charitable giving",
        "📈 PLAN: Update wealth-building strategy"
      ];
      reasoning = "Exceptional income increase with stable pattern indicates divine favor and expansion season.";
      encouragement = "🎉 INCREDIBLE! God is massively increasing your territory! This is a breakthrough moment!";
      biblicalWisdom = "The blessing of the Lord brings wealth, without painful toil for it. - Proverbs 10:22";
    }
    
    else if (amount >= avgMonthlyIncome * 1.2 && incomeGrowth > 0.1) {
      decision = "YES - EXCELLENT GROWTH";  
      confidence = 92;
      actionPlan = [
        "✅ TITHE: Maintain or increase giving percentage",
        "📊 SAVE: Increase savings rate by 5%", 
        "🎓 INVEST: Consider skill/business development",
        "🏆 CELEBRATE: Acknowledge God's faithfulness",
        "📋 REVIEW: Update financial goals upward"
      ];
      reasoning = "Strong income growth with positive trend shows God's blessing on faithful stewardship.";
      encouragement = "💪 OUTSTANDING! Consistent growth shows God is honoring your faithfulness!";
      biblicalWisdom = "Commit to the Lord whatever you do, and he will establish your plans. - Proverbs 16:3";
    }
    
    else if (amount >= avgMonthlyIncome * 0.9 && givingRate >= 0.1) {
      decision = "YES - FAITHFUL STEWARD"; 
      confidence = 88;
      actionPlan = [
        "✅ CONTINUE: Maintain current giving habits",
        "💝 GRATITUDE: Practice daily thanksgiving", 
        "📈 OPTIMIZE: Look for efficiency improvements",
        "🌱 GROW: Seek new opportunities for increase",
        "🙏 PRAY: Ask God for wisdom and direction"
      ];
      reasoning = "Good income level with generous giving shows heart alignment with God's principles.";
      encouragement = "🌟 BEAUTIFUL! Your generous heart positions you for greater blessings!";
      biblicalWisdom = "Give, and it will be given to you. Good measure, pressed down, shaken together, running over. - Luke 6:38";
    }
    
    else if (amount < avgMonthlyIncome * 0.7 && incomeStability < 0.6) {
      decision = "WAIT - STABILIZE FIRST";
      confidence = 94;
      actionPlan = [
        "🛡️ STABILITY: Focus on income stabilization",
        "✂️ EXPENSES: Cut non-essential spending by 20%", 
        "🔍 OPPORTUNITIES: Actively seek additional income",
        "💪 SKILLS: Invest in marketable abilities",
        "🙏 PRAYER: Seek divine direction and provision"
      ];
      reasoning = "Income volatility requires immediate attention and stabilization efforts.";
      encouragement = "💪 God sees your situation! This season is building your faith and resilience!";
      biblicalWisdom = "Be still before the Lord and wait patiently for him. - Psalm 37:7";
    }
    
    else if (amount >= avgMonthlyIncome * 0.8 && givingRate < 0.05) {
      decision = "SOON - ALIGN HEART FIRST";
      confidence = 87;
      actionPlan = [
        "❤️ GIVING: Gradually increase to 10% minimum",
        "📝 BUDGET: Reallocate priorities for generosity", 
        "🧠 MINDSET: Study biblical principles of money",
        "✨ EXPECT: Prepare for increased blessings",
        "🎯 COMMIT: Make giving non-negotiable"
      ];
      reasoning = "Decent income but low giving rate - need heart alignment before financial expansion.";
      encouragement = "💝 As you become more generous, God will entrust you with much more!";
      biblicalWisdom = "Honor the Lord with your wealth, with the firstfruits of all your crops. - Proverbs 3:9";
    }
    
    else if (expenseRatio > 0.85) {
      decision = "WAIT - CONTROL EXPENSES";
      confidence = 91;
      actionPlan = [
        "🔍 AUDIT: Complete expense review within 7 days",
        "✂️ CUT: Eliminate 15% of non-essential spending", 
        "💰 MARGIN: Create 15% financial breathing room",
        "📊 TRACK: Monitor daily spending for 30 days",
        "🎯 FOCUS: Income growth AND expense control"
      ];
      reasoning = "High expense ratio consuming income - need expense control before celebrating income gains.";
      encouragement = "🎯 Creating margin is POWERFUL! This discipline will multiply your future wealth!";
      biblicalWisdom = "The plans of the diligent lead to profit as surely as haste leads to poverty. - Proverbs 21:5";
    }
    
    else {
      decision = "YES - STEADY PROGRESS";
      confidence = 82;
      actionPlan = [
        "✅ STEADY: Maintain current financial habits",
        "📈 OPTIMIZE: Look for 10% improvement areas", 
        "🌱 GROWTH: Explore expansion opportunities",
        "💝 FAITHFUL: Continue generous giving",
        "🎯 PATIENCE: Trust God's perfect timing"
      ];
      reasoning = "Stable income pattern supports continued faithful financial management.";
      encouragement = "🌟 Faithfulness in little leads to much! Keep growing steadily!";
      biblicalWisdom = "Whoever is faithful in very little is also faithful in much. - Luke 16:10";
    }

    return {
      decision,
      specificDecision: decision,
      confidence,
      actionPlan,
      reasoning,
      encouragement, 
      biblicalWisdom,
      shouldProceed: !decision.includes("WAIT"),
      urgency: decision.includes("YES") ? "proceed" : decision.includes("SOON") ? "prepare" : "pause",
      message: `${decision} (${confidence}% confidence)`,
      incomeInsight: `Income Analysis: $${amount.toLocaleString()} vs avg $${avgMonthlyIncome.toLocaleString()}/month`,
      godlyWisdom: biblicalWisdom,
      practicalReason: reasoning
    };
  };

  // ADVANCED SPENDING DECISION ENGINE  
  const analyzeSpendingDecision = async (transaction) => {
    const amount = Math.abs(transaction.amount);
    const description = transaction.description || transaction.category || 'Purchase';
    const avgIncome = calculateAverageIncome();
    const currentBalance = calculateCurrentBalance();
    const isEssential = analyzeExpenseCategory(transaction);
    const affordabilityScore = calculateAffordabilityScore(amount, avgIncome, currentBalance);
    const timingScore = analyzeSpendingTiming(transaction, transactions);
    const impactScore = calculateFinancialImpact(amount, netWorth, currentJourneyStage);

    let decision, confidence, actionPlan, reasoning, encouragement, biblicalWisdom;

    // SPENDING DECISION ENGINE
    if (isEssential && affordabilityScore >= 0.8 && impactScore <= 0.1) {
      decision = "YES - ESSENTIAL NEED";
      confidence = 96;
      actionPlan = [
        "✅ PROCEED: This is a legitimate need",
        "💰 SHOP: Look for best value option", 
        "🙏 GRATITUDE: Thank God for provision",
        "📊 TRACK: Record expense for budgeting"
      ];
      reasoning = "Essential expense with strong affordability and minimal financial impact.";
      encouragement = "✅ God provides for your needs! Move forward with confidence and gratitude!";
      biblicalWisdom = "And my God will meet all your needs according to the riches of his glory in Christ Jesus. - Philippians 4:19";
    }
    
    else if (!isEssential && affordabilityScore >= 0.7 && impactScore <= 0.05 && timingScore >= 0.7) {
      decision = "YES - AFFORDABLE BLESSING";
      confidence = 84;
      actionPlan = [
        "✅ ENJOY: You can afford this responsibly",
        "🎯 ALIGN: Ensure it supports your goals", 
        "💝 GRATITUDE: Appreciate God's blessings",
        "⚖️ BALANCE: Maintain overall discipline"
      ];
      reasoning = "Non-essential but well within financial capacity with good timing.";
      encouragement = "🎁 God wants you to enjoy His blessings! You've earned this through good stewardship!";
      biblicalWisdom = "Every good and perfect gift is from above, coming down from the Father of lights. - James 1:17";
    }
    
    else if (affordabilityScore < 0.4 || impactScore > 0.25) {
      decision = "NO - TOO EXPENSIVE";
      confidence = 95;
      actionPlan = [
        "🛑 STOP: This would strain your finances",
        "🔍 ALTERNATIVES: Find cheaper options", 
        "💰 SAVE: Build up funds first",
        "🎯 PRIORITIES: Reassess true necessity",
        "⏰ PATIENCE: Wait for better opportunity"
      ];
      reasoning = "Purchase would significantly strain finances or derail financial goals.";
      encouragement = "🛡️ God is protecting your financial future! This 'no' leads to better opportunities!";
      biblicalWisdom = "The plans of the diligent lead to profit as surely as haste leads to poverty. - Proverbs 21:5";
    }
    
    else if (timingScore < 0.5) {
      decision = "WAIT - POOR TIMING";  
      confidence = 89;
      actionPlan = [
        "⏰ TIMING: Wait for better moment",
        "📅 SCHEDULE: Reassess in 2-4 weeks", 
        "💡 RESEARCH: Look for sales/discounts",
        "🎯 PATIENCE: Good timing saves money",
        "🙏 PRAY: Ask God for perfect timing"
      ];
      reasoning = "Timing analysis suggests waiting would provide better value or circumstances.";
      encouragement = "⏰ God's timing is perfect! Patience often leads to better deals and outcomes!";
      biblicalWisdom = "To every thing there is a season, and a time to every purpose under heaven. - Ecclesiastes 3:1";
    }
    
    else if (affordabilityScore >= 0.5 && impactScore <= 0.15) {
      decision = "SOON - PREPARE MORE";
      confidence = 78;
      actionPlan = [
        "💰 SAVE: Build up 10-20% more funds",
        "🔍 RESEARCH: Compare options thoroughly", 
        "🙏 PRAY: Seek God's wisdom and peace",
        "📅 TIMELINE: Reassess in 1-2 weeks",
        "🎯 PREPARE: Get everything ready first"
      ];
      reasoning = "Purchase is viable but would benefit from additional preparation and saving.";
      encouragement = "📋 Wise preparation honors God! A little more preparation makes this a great decision!";
      biblicalWisdom = "Suppose one of you wants to build a tower. Won't you first sit down and estimate the cost? - Luke 14:28";
    }
    
    else {
      decision = "WAIT - RECONSIDER NEED";
      confidence = 85;
      actionPlan = [
        "🤔 REFLECT: Is this truly necessary?",
        "⏰ PAUSE: Wait 24-48 hours minimum", 
        "💭 ALTERNATIVES: Explore other options",
        "🙏 SEEK: Ask God for wisdom",
        "🎯 FOCUS: Align with bigger goals"
      ];
      reasoning = "Multiple factors suggest this purchase should be reconsidered or delayed.";
      encouragement = "🧠 Taking time to think shows wisdom! Better decisions come from patient consideration!";
      biblicalWisdom = "In their hearts humans plan their course, but the Lord establishes their steps. - Proverbs 16:9";
    }

    return {
      decision,
      specificDecision: decision,
      confidence, 
      actionPlan,
      reasoning,
      encouragement,
      biblicalWisdom,
      shouldProceed: decision.startsWith("YES"),
      urgency: decision.includes("YES") ? "proceed" : decision.includes("SOON") ? "prepare" : "pause", 
      message: `${decision} (${confidence}% confidence)`,
      godlyWisdom: biblicalWisdom,
      practicalReason: reasoning,
      suggestions: actionPlan
    };
  };

  // HELPER FUNCTIONS FOR AI ANALYSIS

  const calculateAverageIncome = (incomeTransactions = null) => {
    const incomeData = incomeTransactions || transactions.filter(t => t.type === 'income' || t.amount > 0);
    if (incomeData.length === 0) return 50000; // Default assumption
    return incomeData.reduce((sum, t) => sum + Math.abs(t.amount), 0) / incomeData.length;
  };

  const calculateIncomeGrowthRate = (allTransactions) => {
    const incomeByMonth = {};
    allTransactions.filter(t => t.type === 'income' || t.amount > 0).forEach(t => {
      const month = new Date(t.date).toISOString().substring(0, 7);
      incomeByMonth[month] = (incomeByMonth[month] || 0) + Math.abs(t.amount);
    });
    
    const months = Object.keys(incomeByMonth).sort();
    if (months.length < 2) return 0;
    
    const firstMonth = incomeByMonth[months[0]];
    const lastMonth = incomeByMonth[months[months.length - 1]];
    return (lastMonth - firstMonth) / firstMonth;
  };

  const calculateIncomeStability = (allTransactions) => {
    const incomeAmounts = allTransactions
      .filter(t => t.type === 'income' || t.amount > 0)
      .map(t => Math.abs(t.amount));
    
    if (incomeAmounts.length < 3) return 0.5; // Default for insufficient data
    
    const mean = incomeAmounts.reduce((sum, amt) => sum + amt, 0) / incomeAmounts.length;
    const variance = incomeAmounts.reduce((sum, amt) => sum + Math.pow(amt - mean, 2), 0) / incomeAmounts.length;
    const coefficientOfVariation = Math.sqrt(variance) / mean;
    
    return Math.max(0, 1 - coefficientOfVariation); // Higher = more stable
  };

  const calculateSavingsRate = () => {
    const totalIncome = transactions.filter(t => t.type === 'income' || t.amount > 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const totalExpenses = transactions.filter(t => t.type === 'expense' || t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    return totalIncome > 0 ? Math.max(0, (totalIncome - totalExpenses) / totalIncome) : 0;
  };

  const calculateGivingRate = () => {
    const totalIncome = transactions.filter(t => t.type === 'income' || t.amount > 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const givingTransactions = transactions.filter(t => 
      (t.description || '').toLowerCase().includes('tithe') || 
      (t.description || '').toLowerCase().includes('offering') ||
      (t.description || '').toLowerCase().includes('charity') ||
      (t.description || '').toLowerCase().includes('donation')
    );
    const totalGiving = givingTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    return totalIncome > 0 ? totalGiving / totalIncome : 0;
  };

  const calculateExpenseRatio = () => {
    const totalIncome = transactions.filter(t => t.type === 'income' || t.amount > 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const totalExpenses = transactions.filter(t => t.type === 'expense' || t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    return totalIncome > 0 ? totalExpenses / totalIncome : 1;
  };

  const isRecentTransaction = (date, days) => {
    const transactionDate = new Date(date);
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - days);
    return transactionDate >= daysAgo;
  };

  const analyzeExpenseCategory = (transaction) => {
    const description = (transaction.description || transaction.category || '').toLowerCase();
    const essentialKeywords = ['food', 'rent', 'utilities', 'transport', 'medical', 'school', 'fuel', 'electricity', 'water', 'internet', 'phone'];
    return essentialKeywords.some(keyword => description.includes(keyword));
  };

  const calculateAffordabilityScore = (amount, avgIncome, currentBalance) => {
    const incomeRatio = avgIncome > 0 ? amount / avgIncome : 1;
    const balanceRatio = currentBalance > 0 ? amount / currentBalance : 1;
    
    // Higher score = more affordable
    let score = 1;
    if (incomeRatio > 0.3) score -= 0.4; // Significant portion of income
    if (incomeRatio > 0.5) score -= 0.3; // Large portion of income  
    if (balanceRatio > 0.4) score -= 0.2; // Significant portion of balance
    if (balanceRatio > 0.7) score -= 0.3; // Most of available balance
    
    return Math.max(0, score);
  };

  const analyzeSpendingTiming = (transaction, allTransactions) => {
    const currentHour = new Date().getHours();
    const isWeekend = [0, 6].includes(new Date().getDay());
    const recentSimilar = allTransactions.filter(t => 
      isRecentTransaction(t.date, 7) && 
      (t.category === transaction.category || 
       (t.description || '').toLowerCase().includes((transaction.description || '').toLowerCase().split(' ')[0]))
    );
    
    let score = 0.7; // Base score
    
    // Time of day analysis
    if (currentHour >= 9 && currentHour <= 17) score += 0.2; // Business hours
    if (currentHour <= 6 || currentHour >= 23) score -= 0.3; // Late night/early morning
    
    // Weekend analysis for non-essential
    if (isWeekend && !analyzeExpenseCategory(transaction)) score -= 0.1;
    
    // Frequency analysis
    if (recentSimilar.length >= 3) score -= 0.3; // Too frequent
    if (recentSimilar.length >= 5) score -= 0.2; // Very frequent
    
    return Math.max(0, Math.min(1, score));
  };

  const calculateFinancialImpact = (amount, currentNetWorth, stage) => {
    const netWorthRatio = currentNetWorth > 0 ? amount / currentNetWorth : amount / 10000;
    const stageTarget = journeyStages[stage]?.netWorthTarget || 100000;
    const progressImpact = amount / stageTarget;
    
    return Math.min(1, netWorthRatio + progressImpact * 0.5);
  };

  // Legacy helper functions (keeping for compatibility)
  const analyzeBasicNeed = (transaction) => {
    return analyzeExpenseCategory(transaction);
  };

  const checkRepeatedSpending = (transaction, recentTransactions) => {
    const similarTransactions = recentTransactions.filter(t =>
      t.category === transaction.category ||
      (t.description && transaction.description && 
       t.description.toLowerCase().includes(transaction.description.toLowerCase().split(' ')[0]))
    );
    return similarTransactions.length >= 2;
  };

  const getSimpleStageGuidance = (stage, amount, netWorth, stages) => {
    const currentStage = stages[stage];
    if (!currentStage) return { reason: "Continue growing steadily." };
    
    const progress = (netWorth / currentStage.netWorthTarget) * 100;
    return {
      reason: `You're ${progress.toFixed(0)}% towards ${currentStage.name}. ${
        progress >= 80 ? "Almost there!" : progress >= 50 ? "Great progress!" : "Keep building!"
      }`
    };
  };

  // AI INCOME DECISION ENGINE - Specific Yes/No/Wait/Soon Analysis
  const performIncomeDecisionAnalysis = (transaction) => {
    const amount = Math.abs(transaction.amount);
    const isIncome = transaction.type === 'income' || transaction.amount > 0;
    
    if (!isIncome) return null;
    
    const recentIncome = transactions.filter(t => 
      (t.type === 'income' || t.amount > 0) && 
      new Date(t.date) >= new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    );
    
    const avgIncome = recentIncome.length > 0 ? 
      recentIncome.reduce((sum, t) => sum + Math.abs(t.amount), 0) / recentIncome.length : 50000;
    
    const givingTransactions = transactions.filter(t => 
      (t.description || '').toLowerCase().includes('tithe') || 
      (t.description || '').toLowerCase().includes('offering') ||
      (t.description || '').toLowerCase().includes('charity')
    );
    const totalGiving = givingTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const totalIncome = transactions.filter(t => t.type === 'income' || t.amount > 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const givingRate = totalIncome > 0 ? totalGiving / totalIncome : 0;
    
    // SPECIFIC DECISION LOGIC
    let decision, confidence, reasoning, actionPlan, encouragement, biblicalWisdom;
    
    if (amount >= avgIncome * 1.5) {
      decision = "YES - MAJOR BLESSING";
      confidence = 95;
      reasoning = "Exceptional income increase - God is expanding your territory!";
      actionPlan = ["Set aside 10% for tithe", "Save 25% for goals", "Consider increasing giving"];
      encouragement = "🎉 AMAZING! God is massively increasing your capacity!";
      biblicalWisdom = "The blessing of the Lord brings wealth, without painful toil. - Proverbs 10:22";
    } else if (amount >= avgIncome * 1.2 && givingRate >= 0.1) {
      decision = "YES - FAITHFUL STEWARD";
      confidence = 90;
      reasoning = "Strong income growth with generous giving shows God's favor.";
      actionPlan = ["Maintain giving habits", "Increase savings by 5%", "Celebrate faithfulness"];
      encouragement = "💪 EXCELLENT! Your faithfulness positions you for more blessings!";
      biblicalWisdom = "Give, and it will be given to you. Good measure, pressed down. - Luke 6:38";
    } else if (amount >= avgIncome * 0.8 && givingRate < 0.05) {
      decision = "SOON - ALIGN HEART FIRST";
      confidence = 85;
      reasoning = "Good income but low giving - need heart alignment first.";
      actionPlan = ["Increase giving to 10%", "Reallocate priorities", "Study biblical money principles"];
      encouragement = "💝 As you become more generous, God will entrust you with more!";
      biblicalWisdom = "Honor the Lord with your wealth, with the firstfruits. - Proverbs 3:9";
    } else if (amount < avgIncome * 0.7) {
      decision = "WAIT - STABILIZE FIRST";
      confidence = 88;
      reasoning = "Income volatility requires stabilization efforts.";
      actionPlan = ["Focus on income stability", "Cut non-essential expenses", "Seek additional income"];
      encouragement = "💪 This season is building your faith and resilience!";
      biblicalWisdom = "Be still before the Lord and wait patiently for him. - Psalm 37:7";
    } else {
      decision = "YES - STEADY PROGRESS";
      confidence = 80;
      reasoning = "Stable income supports continued faithful management.";
      actionPlan = ["Maintain current habits", "Look for growth opportunities", "Stay faithful"];
      encouragement = "🌟 Faithfulness in little leads to much!";
      biblicalWisdom = "Whoever is faithful in very little is faithful in much. - Luke 16:10";
    }
    
    return {
      decision,
      confidence,
      reasoning,
      actionPlan,
      encouragement,
      biblicalWisdom,
      specificDecision: decision,
      shouldProceed: !decision.includes("WAIT"),
      message: `${decision} (${confidence}% confidence)`,
      godlyWisdom: biblicalWisdom,
      practicalReason: reasoning,
      suggestions: actionPlan
    };
  };

  const analyzeTransactionMetrics = (transactions) => {
        advice.shouldProceed = false;
        advice.urgency = 'timing';
        advice.message = `🌙 Late night purchase? Let's be extra careful...`;
        advice.godlyWisdom = `"In their hearts humans plan their course, but the Lord establishes their steps." - Proverbs 16:9`;
        advice.practicalReason = `Research shows we make poorer financial decisions when tired. It's ${timeOfDay}:00 - our judgment isn't at its best.`;
        advice.encouragement = `Smart of you to pause! Making decisions with a fresh mind tomorrow will serve you better. 😊`;
        advice.suggestions = [
          '� Sleep on it - revisit this decision in the morning',
          '🧠 Ask: "Am I buying this because of how I feel right now?"',
          '⭐ Remember: Patient decisions lead to better outcomes'
        ];
      }

  }

  // Clean AI Analysis Functions
  const analyzeTransactionCategories = () => {
    const categories = transactions.reduce((acc, t) => {
      const category = t.category || 'other';
      acc[category] = (acc[category] || 0) + Math.abs(t.amount);
      return acc;
    }, {});
    
    return Object.entries(categories)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
  };
      }

      // 2. WEALTH OPPORTUNITY COST CALCULATOR
      advice.wealthImpact = {
        opportunityCost: wealthImpact.oneYearValue,
        fiveYearLoss: wealthImpact.fiveYearValue,
        compoundingPower: wealthImpact.compoundingEffect,
        wealthVelocityImpact: wealthImpact.velocityReduction
      };



      // 4. INCOME RATIO INTELLIGENCE (Enhanced)
      if (transaction.amount > avgIncome * 0.15) {
        advice.urgency = 'critical';
        advice.riskLevel = 'wealth-destructive';
        advice.shouldProceed = false;
        advice.message = `� WEALTH DESTROYER ALERT: UGX ${transaction.amount.toLocaleString()} is ${Math.round(spendingRatio * 100)}% of your income! This single purchase could set back your wealth journey by months!`;
        advice.suggestions.push('🚨 STOP: This expense is disproportionate to your income');
        advice.suggestions.push('💡 RULE: Never spend more than 10-15% of income on wants');
        advice.suggestions.push('🎯 FOCUS: Rich people delay gratification to build wealth');
      }

      // 5. ADDICTION PATTERN DETECTION
      const similarExpenses = recentTransactions.filter(t => 
        t.type === 'expense' && 
        t.category === transaction.category && 
        isWithinDays(new Date(t.date), new Date(), 7)
      );

      if (similarExpenses.length >= 3) {
        advice.urgency = 'high';
        advice.riskLevel = 'addiction-pattern';
        const totalSimilar = similarExpenses.reduce((sum, t) => sum + t.amount, 0);
        advice.message = `� ADDICTION ALERT: UGX ${totalSimilar.toLocaleString()} spent on ${transaction.category} in 7 days! This is wealth-destroying behavior!`;
        advice.suggestions.push(`🔄 PATTERN: ${similarExpenses.length} similar purchases = possible addiction`);
        advice.suggestions.push('💪 CHALLENGE: Go 7 days without this category');
        advice.suggestions.push('🎯 REDIRECT: Find a free alternative or hobby');
        advice.shouldProceed = false;
        
        // Add wealth comparison
        advice.alternativeSolutions.push(`If you invested this UGX ${totalSimilar.toLocaleString()} weekly instead: UGX ${Math.round(totalSimilar * 52 * 1.15).toLocaleString()} per year!`);
      }

      // 6. LIFESTYLE INFLATION DETECTOR
      const luxuryCategories = ['entertainment', 'dining', 'shopping', 'other'];
      if (luxuryCategories.includes(transaction.category)) {
        const luxurySpending = monthlySpending.categories[transaction.category] || 0;
        const luxuryPercentage = (luxurySpending/avgIncome) * 100;
        
        if (luxurySpending > avgIncome * 0.1) {
          advice.urgency = 'high';
          advice.riskLevel = 'lifestyle-inflation';
          advice.message = `📈 LIFESTYLE INFLATION ALERT: ${Math.round(luxuryPercentage)}% of income on ${transaction.category}! Rich people keep luxuries under 10%!`;
          advice.suggestions.push('🚨 WEALTH RULE: Luxuries should be ≤10% of income');
          advice.suggestions.push('💡 MINDSET: Every luxury expense delays your financial freedom');
          advice.suggestions.push('🎯 GOAL: Redirect luxury spending to investments');
          advice.shouldProceed = false;

          // Show the wealth impact
          advice.alternativeSolutions.push(`Reduce luxury spending to 5%: Extra UGX ${Math.round(luxurySpending - (avgIncome * 0.05)).toLocaleString()}/month for wealth building`);
        }
      }

      // 7. PEER PRESSURE & SOCIAL SPENDING DETECTION
      if (behavioralContext.isEmotionalSpending && (new Date().getDay() === 5 || new Date().getDay() === 6)) {
        advice.behavioralTriggers.push('👥 SOCIAL PRESSURE: Weekend spending often involves peer pressure');
        advice.behavioralTriggers.push('💪 INDEPENDENCE: True wealth builders make independent decisions');
        advice.behavioralTriggers.push('🎯 ALTERNATIVE: Suggest free activities to friends instead');
      }

      // 8. TEMPORAL DECISION-MAKING ANALYSIS
      const transactionTime = new Date();
      const isWeekend = transactionTime.getDay() === 0 || transactionTime.getDay() === 6;
      const isEvening = transactionTime.getHours() >= 18;
      const isLateNight = transactionTime.getHours() >= 22 || transactionTime.getHours() <= 6;
      
      if (isLateNight && transaction.amount > 5000) {
        advice.urgency = 'high';
        advice.riskLevel = 'poor-judgment';
        advice.message = `🌙 LATE-NIGHT SPENDING ALERT: Research shows we make poor financial decisions when tired!`;
        advice.suggestions.push('💤 SLEEP RULE: Never make financial decisions after 10 PM');
        advice.suggestions.push('🧠 SCIENCE: Tired brains lack impulse control and long-term thinking');
        advice.suggestions.push('⏰ DELAY: Revisit this decision in the morning with fresh perspective');
        advice.shouldProceed = false;
      }

      // 9. ADVANCED CASH FLOW & LIQUIDITY ANALYSIS
      const currentBalance = calculateCurrentBalance();
      const projectedBalance = currentBalance - transaction.amount;
      const emergencyFundTarget = avgIncome * 3; // 3 months emergency fund
      
      if (projectedBalance < emergencyFundTarget * 0.5) {
        advice.urgency = 'critical';
        advice.riskLevel = 'financial-suicide';
        advice.shouldProceed = false;
        advice.message = `💀 FINANCIAL SUICIDE WARNING: You're about to spend below emergency fund safety level! UGX ${projectedBalance.toLocaleString()} remaining!`;
        advice.suggestions.push('🚨 EMERGENCY: You need minimum 3 months of expenses saved');
        advice.suggestions.push('💰 RULE: Never spend emergency funds on wants');
        advice.suggestions.push('🎯 PRIORITY: Build emergency fund before ANY luxury spending');
        
        advice.alternativeSolutions.push(`Emergency Fund Goal: UGX ${emergencyFundTarget.toLocaleString()} | Current Gap: UGX ${Math.max(0, emergencyFundTarget - currentBalance).toLocaleString()}`);
      }

      // 10. REVOLUTIONARY POSITIVE REINFORCEMENT FOR WEALTH-BUILDING
      if (transaction.category === 'business' || transaction.category === 'investment') {
        advice.message = `� WEALTH ACCELERATOR: This ${transaction.category} expense moves you closer to financial freedom!`;
        advice.suggestions.push('💡 COMPOUND POWER: This investment can multiply your wealth exponentially');
        advice.suggestions.push('🎯 MINDSET: You think like a rich person - investing before consuming');
        advice.suggestions.push('📈 PROJECTION: Track the ROI and watch your wealth velocity increase');
        advice.urgency = 'wealth-building';
    return { analysis: 'complete' };
  };

  // Simple Helper Functions for God-Centered AI
  const analyzeBasicNeed = (transaction) => {
    const description = transaction.description.toLowerCase();
    const category = transaction.category;
    
    // Essential categories
    const needCategories = ['food', 'transportation', 'health', 'utilities'];
    const needKeywords = ['rent', 'house', 'food', 'grocery', 'medicine', 'transport', 'fuel', 'electricity', 'water'];
    
    if (needCategories.includes(category)) return true;
    if (needKeywords.some(keyword => description.includes(keyword))) return true;
    
    return false;
  };

  const checkRepeatedSpending = (transaction, recentTransactions) => {
    return recentTransactions.filter(t => 
      t.category === transaction.category && t.type === 'expense'
    ).length >= 2;
  };

  const getSimpleStageGuidance = (transaction, stage) => {
    const stageData = journeyStages[stage];
    
    if (transaction.type === 'income') {
      return `🙏 ${stageData.name}: God is building your foundation step by step. Every blessing counts!`;
    }
    
    switch(stage) {
      case 1: // Survival Stage
        return `🌱 ${stageData.name}: Every UGX is precious now. God is teaching you to be faithful with little so He can trust you with much.`;
      case 2: // Structure Stage  
        return `🏗️ ${stageData.name}: You're building wisely! God is organizing your resources for greater purposes.`;
      case 3: // Security Stage
        return `🛡️ ${stageData.name}: God is making you a protector of resources. Use wisdom to guard what He's given you.`;
      case 4: // Readiness Stage
        return `🚀 ${stageData.name}: You're ready for God's big assignments! Every decision should reflect His glory.`;
      default:
        return `🎯 Trust God's process. He's developing you through each financial decision.`;
    }
  };

  // Stage-Specific Spending Guidance
  const getStageSpecificGuidance = (transaction, stage) => {
    const stageData = journeyStages[stage];
    
    switch(stage) {
      case 1: // Survival Stage
        if (transaction.type === 'expense' && transaction.amount > 5000) {
          return `🎯 SURVIVAL FOCUS: At Stage 1, every UGX matters for velocity building. This ${transaction.amount.toLocaleString()} expense needs careful consideration for your journey from survival to stability.`;
        }
        return `📊 VELOCITY BUILDING: You're in the critical Survival Stage. Focus on tracking every transaction to establish your Net Worth Velocity pattern.`;
        
      case 2: // Structure Stage  
        if (transaction.category === 'business' || transaction.category === 'investment') {
          return `⚡ STRUCTURE POWER: Perfect timing! Stage 2 is about converting time into capital. This ${transaction.category} investment aligns with your Time-as-Capital phase.`;
        }
        if (transaction.amount > 50000) {
          return `🏗️ STRUCTURE CHECK: You're building your foundation in Stage 2. Ensure this expense supports your organized, productive lifestyle goals.`;
        }
        return `⏰ TIME OPTIMIZATION: Stage 2 focus - Does this expense help optimize your time or build structured success patterns?`;
        
      case 3: // Security Stage
        if (transaction.amount > 100000) {
          return `🛡️ WEALTH PROTECTION: At Stage 3, you must guard your accumulated capital. Consider legal vetting for any commitment this large (UGX ${transaction.amount.toLocaleString()}).`;
        }
        return `🔒 SECURITY MINDSET: You're in the critical Wealth Protection phase. Every major expense should pass through your security protocols.`;
        
      case 4: // Readiness Stage
        return `🚀 GLOBAL READINESS: You've reached Stage 4! Every decision should align with maintaining your tender-ready status and global competitiveness.`;
        
      default:
        return `🎯 ICAN JOURNEY: Your spending decisions impact your progression through the four-stage journey to global capital readiness.`;
    }
  };

  // Calculate spending patterns
  const calculateMonthlySpending = () => {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    const monthlyExpenses = transactions.filter(t => {
      const tDate = new Date(t.date);
      return t.type === 'expense' && 
             tDate.getMonth() === currentMonth && 
             tDate.getFullYear() === currentYear;
    });

    const totalSpending = monthlyExpenses.reduce((sum, t) => sum + t.amount, 0);
    const categories = {};
    
    monthlyExpenses.forEach(t => {
      categories[t.category] = (categories[t.category] || 0) + t.amount;
    });

    return {
      total: totalSpending,
      categories,
      count: monthlyExpenses.length,
      trend: totalSpending > (netWorth * 0.7) ? 'high' : 'normal'
    };
  };

  const analyzeSpendingPatterns = () => {
    const expensesByCategory = {};
    transactions.filter(t => t.type === 'expense').forEach(t => {
      expensesByCategory[t.category] = (expensesByCategory[t.category] || 0) + t.amount;
    });

    const sortedCategories = Object.entries(expensesByCategory)
      .sort(([,a], [,b]) => b - a);

    return {
      top: sortedCategories[0]?.[0] || 'none',
      distribution: expensesByCategory
    };
  };

  const calculateAverageIncome = () => {
    const incomes = transactions.filter(t => t.type === 'income');
    const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);
    return incomes.length > 0 ? totalIncome / incomes.length : 50000; // Default estimate
  };

  // REVOLUTIONARY AI FUNCTIONS FOR WEALTH BUILDING

  // Advanced Need vs Want Analysis using AI logic
  const analyzeNeedVsWant = (transaction) => {
    const description = transaction.description.toLowerCase();
    const category = transaction.category.toLowerCase();
    
    // Essential categories and keywords
    const essentialKeywords = [
      'rent', 'house', 'food', 'grocery', 'medicine', 'health', 'medical', 'transport', 
      'fuel', 'electricity', 'water', 'internet', 'phone', 'school', 'education',
      'loan', 'debt', 'insurance', 'tax', 'government', 'license', 'permit'
    ];
    
    const wantKeywords = [
      'party', 'entertainment', 'movie', 'game', 'alcohol', 'cigarette', 'luxury',
      'designer', 'brand', 'fashion', 'jewelry', 'decoration', 'hobby', 'fun',
      'restaurant', 'bar', 'club', 'vacation', 'travel', 'gadget', 'upgrade'
    ];

    const businessKeywords = [
      'investment', 'business', 'equipment', 'tools', 'course', 'training',
      'skill', 'office', 'computer', 'software', 'marketing', 'advertising'
    ];

    // Calculate need score
    let needScore = 0;
    let wantScore = 0;
    let businessScore = 0;

    // Analyze description for keywords
    essentialKeywords.forEach(keyword => {
      if (description.includes(keyword)) needScore += 0.2;
    });

    wantKeywords.forEach(keyword => {
      if (description.includes(keyword)) wantScore += 0.3;
    });

    businessKeywords.forEach(keyword => {
      if (description.includes(keyword)) businessScore += 0.4;
    });

    // Category analysis
    if (['food', 'transportation', 'health', 'utilities', 'education'].includes(category)) {
      needScore += 0.4;
    } else if (['entertainment', 'dining', 'shopping', 'other'].includes(category)) {
      wantScore += 0.4;
    } else if (['business', 'investment'].includes(category)) {
      businessScore += 0.5;
    }

    // Amount analysis - luxury detection
    const avgIncome = calculateAverageIncome();
    if (transaction.amount > avgIncome * 0.1) {
      wantScore += 0.2; // Expensive items are usually wants
    }

    // Time analysis - weekend/evening purchases are often wants
    const now = new Date();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    const isEvening = now.getHours() >= 18;
    if (isWeekend || isEvening) {
      wantScore += 0.1;
    }

    // Normalize scores
    needScore = Math.min(needScore, 1);
    wantScore = Math.min(wantScore, 1);
    businessScore = Math.min(businessScore, 1);

    const isEssential = needScore > 0.5 || businessScore > 0.3;
    const wantLevel = wantScore;

    return {
      needScore,
      wantLevel,
      businessScore,
      isEssential,
      category: isEssential ? (businessScore > needScore ? 'investment' : 'need') : 'want'
    };
  };

  // Calculate true wealth impact with compound interest
  const calculateWealthImpact = (transaction) => {
    const amount = transaction.amount;
    
    // Assuming 15% annual growth if invested properly
    const annualGrowthRate = 0.15;
    const monthlyGrowthRate = annualGrowthRate / 12;

    // Calculate opportunity cost
    const oneYearValue = amount * Math.pow(1 + annualGrowthRate, 1);
    const fiveYearValue = amount * Math.pow(1 + annualGrowthRate, 5);
    const tenYearValue = amount * Math.pow(1 + annualGrowthRate, 10);

    // Calculate compounding effect
    const compoundingEffect = {
      year1: Math.round(oneYearValue - amount),
      year5: Math.round(fiveYearValue - amount),
      year10: Math.round(tenYearValue - amount)
    };

    // Velocity impact - how this affects wealth building speed
    const currentBalance = calculateCurrentBalance();
    const velocityReduction = (amount / currentBalance) * 100;

    return {
      oneYearValue: Math.round(oneYearValue),
      fiveYearValue: Math.round(fiveYearValue),
      tenYearValue: Math.round(tenYearValue),
      compoundingEffect,
      velocityReduction: Math.round(velocityReduction)
    };
  };

  // Advanced behavioral analysis
  const analyzeBehavioralContext = (transaction) => {
    const recentExpenses = transactions.filter(t => 
      t.type === 'expense' && 
      isWithinDays(new Date(t.date), new Date(), 7)
    );

    // Check for impulsive patterns
    const rapidPurchases = recentExpenses.filter(t => 
      isWithinDays(new Date(t.date), new Date(), 1)
    );

    const isImpulsive = rapidPurchases.length >= 3 || 
                      (transaction.amount > calculateAverageIncome() * 0.1 && 
                       new Date().getHours() >= 18); // Evening expensive purchases

    // Emotional spending detection
    const emotionalCategories = ['entertainment', 'dining', 'shopping'];
    const recentEmotionalSpending = recentExpenses.filter(t => 
      emotionalCategories.includes(t.category)
    );

    const isEmotionalSpending = recentEmotionalSpending.length >= 2;

    // Pattern disruption analysis
    const normalSpendingPattern = calculateNormalSpendingPattern();
    const isPatternDisruption = transaction.amount > normalSpendingPattern.average * 2;

    return {
      isImpulsive,
      isEmotionalSpending,
      isPatternDisruption,
      recentSpendingCount: recentExpenses.length,
      behavioralRiskScore: (isImpulsive ? 0.4 : 0) + 
                           (isEmotionalSpending ? 0.3 : 0) + 
                           (isPatternDisruption ? 0.3 : 0)
    };
  };

  // Calculate normal spending patterns for behavioral analysis
  const calculateNormalSpendingPattern = () => {
    const last30Days = transactions.filter(t => 
      t.type === 'expense' && 
      isWithinDays(new Date(t.date), new Date(), 30)
    );

    if (last30Days.length === 0) {
      return { average: 10000, median: 10000, standardDeviation: 5000 };
    }

    const amounts = last30Days.map(t => t.amount).sort((a, b) => a - b);
    const sum = amounts.reduce((a, b) => a + b, 0);
    const average = sum / amounts.length;
    const median = amounts[Math.floor(amounts.length / 2)];
    
    // Calculate standard deviation
    const squaredDiffs = amounts.map(amount => Math.pow(amount - average, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / amounts.length;
    const standardDeviation = Math.sqrt(avgSquaredDiff);

    return { average, median, standardDeviation };
  };

  const calculateCurrentBalance = () => {
    const totalIncome = transactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalExpenses = transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    return totalIncome - totalExpenses;
  };

  const calculateSavingsRate = () => {
    const balance = calculateCurrentBalance();
    const income = calculateAverageIncome();
    return income > 0 ? (balance / income) * 100 : 0;
  };

  const calculateDaysUntilIncome = () => {
    // Estimate based on last income transaction
    const lastIncome = transactions
      .filter(t => t.type === 'income')
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    
    if (!lastIncome) return 30;
    
    const daysSinceLastIncome = Math.floor(
      (new Date() - new Date(lastIncome.date)) / (1000 * 60 * 60 * 24)
    );
    
    return Math.max(0, 30 - daysSinceLastIncome); // Assume monthly income
  };

  const calculateAffordabilityScore = (amount) => {
    const balance = calculateCurrentBalance();
    const income = calculateAverageIncome();
    const ratio = amount / (balance + income);
    
    if (ratio > 0.5) return 'Poor';
    if (ratio > 0.3) return 'Fair';
    if (ratio > 0.1) return 'Good';
    return 'Excellent';
  };

  const isWithinDays = (date1, date2, days) => {
    const diffTime = Math.abs(date2 - date1);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= days;
  };

  // Enhanced typing feedback for better UX
  const handleTypingFeedback = (value) => {
    if (value.length > 100) {
      setTypingFeedback('📝 Great detail! Consider splitting into multiple entries.');
    } else if (value.length > 50) {
      setTypingFeedback('✍️ Good progress! Keep typing...');
    } else if (value.length > 20) {
      setTypingFeedback('💡 Looking good! Add more details if needed.');
    } else if (value.length > 0) {
      setTypingFeedback('⚡ Starting entry...');
    } else {
      setTypingFeedback(isVoiceSupported ? '📝 Type or click mic to speak' : '⌨️ Type your transaction');
    }
  };

  const loadUserData = () => {
    // Load from localStorage for demo - in production use Firestore
    const savedTransactions = localStorage.getItem('ican_transactions');
    const savedMode = localStorage.getItem('ican_mode');
    const savedCountry = localStorage.getItem('ican_country');
    const savedGoals = localStorage.getItem('ican_goals');

    if (savedTransactions) setTransactions(JSON.parse(savedTransactions));
    if (savedMode) setMode(savedMode);
    if (savedCountry) setOperatingCountry(savedCountry);
    if (savedGoals) setGoals(JSON.parse(savedGoals));
  };

  const saveUserData = () => {
    localStorage.setItem('ican_transactions', JSON.stringify(transactions));
    localStorage.setItem('ican_mode', mode);
    localStorage.setItem('ican_country', operatingCountry);
    localStorage.setItem('ican_goals', JSON.stringify(goals));
  };

  const calculateFinancials = () => {
    const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const currentNetWorth = totalIncome - totalExpenses;
    
    // Calculate 30-day velocity
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentTransactions = transactions.filter(t => new Date(t.date) > thirtyDaysAgo);
    const recentIncome = recentTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const recentExpenses = recentTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const velocity = recentIncome - recentExpenses;

    setNetWorth(currentNetWorth);
    setNetWorthVelocity(velocity);
  };

  const calculateIORScore = () => {
    // Calculate composite score from all pillars
    const financialScore = Math.min(100, Math.max(0, (netWorth / goals.targetNetWorth) * 100));
    const legalScore = contractAnalysis ? contractAnalysis.safetyScore * 10 : 50;
    const regulatoryScore = complianceData ? complianceData.compliancePercentage : 50;
    const humanScore = scheduleData ? scheduleData.optimizationScore : 50;
    const integrityScore = 85; // Base integrity score

    const compositeScore = (financialScore + legalScore + regulatoryScore + humanScore + integrityScore) / 5;
    setIorScore(Math.round(compositeScore));
  };

  const handleAddTransaction = async (transaction) => {
    // Get AI advice before processing the transaction
    if (transaction.type === 'expense' && transaction.amount > 1000) {
      const advice = await analyzeSpendingWithAI(transaction);
      
      if (!advice.shouldProceed || advice.urgency === 'high' || advice.riskLevel === 'high') {
        // Show advice modal for risky transactions
        setAiAdvice(advice);
        setPendingTransaction(transaction);
        setShowAdviceModal(true);
        return; // Don't process immediately
      } else if (advice.urgency === 'medium' || advice.message) {
        // Show quick advice notification for medium risk
        setAiAdvice(advice);
        setTimeout(() => setAiAdvice(null), 8000);
      }
    }
    
    // Process transaction immediately for low-risk or income
    const newTransactions = [...transactions, transaction];
    setTransactions(newTransactions);
    saveUserData();
  };

  const handleConfirmTransaction = () => {
    if (pendingTransaction) {
      const newTransactions = [...transactions, pendingTransaction];
      setTransactions(newTransactions);
      saveUserData();
      setPendingTransaction(null);
    }
    setShowAdviceModal(false);
    setAiAdvice(null);
  };

  const handleCancelTransaction = () => {
    setPendingTransaction(null);
    setShowAdviceModal(false);
    setAiAdvice(null);
  };

  const handleToggleListening = () => {
    if (isListening) {
      stopVoiceRecognition();
    } else {
      startVoiceRecognition();
    }
  };

  const handleSecureAction = (action, callback) => {
    setBiometricAction(() => callback);
    setShowBiometricModal(true);
  };

  const handleBiometricAuthentication = () => {
    if (biometricAction) {
      biometricAction();
      setBiometricAction(null);
    }
  };

  const analyzeContract = async () => {
    if (!contractText.trim()) return;
    
    setIsLoading(true);
    try {
      // Simulate API call - in production, call your backend
      const analysis = {
        safetyScore: Math.random() * 10,
        liabilityFlags: [
          'Unlimited liability clause detected',
          'Termination notice period: 30 days',
          'Intellectual property assignment required'
        ],
        recommendation: 'Review clauses 4.2 and 7.1 before signing'
      };
      setContractAnalysis(analysis);
    } catch (error) {
      console.error('Contract analysis failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const performComplianceCheck = async () => {
    setIsLoading(true);
    try {
      // Simulate API call
      const compliance = {
        compliancePercentage: Math.random() * 100,
        checklist: [
          { item: 'Business License', status: 'completed', required: true },
          { item: 'Tax Clearance Certificate', status: 'pending', required: true },
          { item: 'Professional Certification', status: 'not-started', required: false }
        ]
      };
      setComplianceData(compliance);
    } catch (error) {
      console.error('Compliance check failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const optimizeSchedule = async () => {
    setIsLoading(true);
    try {
      // Simulate API call
      const schedule = {
        optimizationScore: Math.random() * 100,
        recommendations: [
          'Block 9-11 AM for High-Value Work',
          'Schedule Spiritual Alignment: 6-7 AM daily',
          'Physical Alignment: 5-6 PM, 3x weekly',
          'Networking blocks: Tuesday/Thursday 2-4 PM'
        ],
        nextActions: ['Book gym membership', 'Set up morning routine', 'Block calendar for HVW']
      };
      setScheduleData(schedule);
    } catch (error) {
      console.error('Schedule optimization failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getPillarScores = () => {
    const financialScore = Math.min(100, Math.max(0, (netWorth / goals.targetNetWorth) * 100));
    const legalScore = contractAnalysis ? contractAnalysis.safetyScore * 10 : 50;
    const regulatoryScore = complianceData ? complianceData.compliancePercentage : 50;
    const humanScore = scheduleData ? scheduleData.optimizationScore : 50;

    return { financialScore, legalScore, regulatoryScore, humanScore };
  };

  const getLowestPillar = () => {
    const scores = getPillarScores();
    const pillarNames = {
      financialScore: 'Financial Capital',
      legalScore: 'Legal Resilience', 
      regulatoryScore: 'Regulatory Compliance',
      humanScore: 'Human Capital'
    };

    const lowestKey = Object.keys(scores).reduce((a, b) => scores[a] < scores[b] ? a : b);
    return {
      name: pillarNames[lowestKey],
      score: Math.round(scores[lowestKey])
    };
  };

  const renderDashboard = () => {
    const scores = getPillarScores();
    const lowestPillar = getLowestPillar();

    return (
      <div className="space-y-6">
        {/* Header with IOR */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-white">ICAN Opportunity Rating</h1>
              <p className="text-gray-300">Your readiness for global opportunities</p>
            </div>
            <IORGauge score={iorScore} />
          </div>
          
          <div className="bg-red-500 bg-opacity-20 border border-red-500 border-opacity-30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <span className="text-red-400 font-medium">Gap Analysis</span>
            </div>
            <p className="text-white">
              Your IOR is {iorScore}%. Your biggest obstacle: {lowestPillar.name} ({lowestPillar.score}%)
            </p>
          </div>
        </div>

        {/* Journey Progress Tracker */}
        <JourneyProgressTracker 
          journeyStages={journeyStages}
          currentStage={currentJourneyStage}
          stageProgress={stageProgress}
          journeyInsights={journeyInsights}
          netWorth={netWorth}
        />

        {/* Net Worth Velocity */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-green-400" />
              <span className="text-white font-medium">Net Worth</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {new Intl.NumberFormat().format(netWorth)} UGX
            </div>
            <div className="text-sm text-gray-300">
              Target: {new Intl.NumberFormat().format(goals.targetNetWorth)} UGX
            </div>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-5 h-5 text-blue-400" />
              <span className="text-white font-medium">30-Day Velocity</span>
            </div>
            <div className={`text-2xl font-bold ${netWorthVelocity >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {netWorthVelocity >= 0 ? '+' : ''}{new Intl.NumberFormat().format(netWorthVelocity)} UGX
            </div>
            <div className="text-sm text-gray-300">Monthly change</div>
          </div>
        </div>

        {/* Smart Spending Insights */}
        {transactions.length >= 3 && (
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-4">
              <Brain className="w-5 h-5 text-purple-400" />
              <span className="text-white font-medium">AI Spending Intelligence</span>
            </div>
            <SmartSpendingInsights transactions={transactions} />
          </div>
        )}

        {/* Proactive AI Suggestions */}
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-yellow-400" />
            <span className="text-white font-medium">AI Wealth Advisor</span>
            <div className="ml-auto flex items-center gap-1">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-xs text-green-400">Active</span>
            </div>
          </div>
          <ProactiveAISuggestions 
            transactions={transactions}
            netWorth={netWorth}
            currentJourneyStage={currentJourneyStage}
            journeyStages={journeyStages}
            onOpenChat={() => setShowAIChat(true)}
          />
        </div>

        {/* AI Multimedia Manager */}
        <AIMultimediaManager
          transactions={transactions}
          netWorth={netWorth}
          currentJourneyStage={currentJourneyStage}
          onDataUpdate={(data) => setMultimediaData(prev => ({ ...prev, ...data }))}
        />

        {/* Smart Data Management & Creative AI */}
        <SmartDataManager
          transactions={transactions}
          multimediaData={multimediaData}
          netWorth={netWorth}
          currentJourneyStage={currentJourneyStage}
          journeyStages={journeyStages}
        />

        {/* Transaction Input */}
        <TransactionInput 
          onAddTransaction={handleAddTransaction}
          isListening={isListening}
          onToggleListening={handleToggleListening}
          typingFeedback={typingFeedback}
          onInputChange={handleTypingFeedback}
          isVoiceSupported={isVoiceSupported}
        />

        {/* AI Advice Notification */}
        {aiAdvice && !showAdviceModal && (
          <div className={`glass-card p-4 border-l-4 animate-pulse-slow ${
            aiAdvice.urgency === 'positive' ? 'border-green-400 bg-green-500' :
            aiAdvice.urgency === 'medium' ? 'border-yellow-400 bg-yellow-500' :
            'border-blue-400 bg-blue-500'
          } bg-opacity-20`}>
            <div className="flex items-start gap-3">
              <div className="text-2xl">
                {aiAdvice.urgency === 'positive' ? '💚' : aiAdvice.urgency === 'medium' ? '⚠️' : '💡'}
              </div>
              <div className="flex-1">
                <div className="text-white font-medium text-sm mb-1">AI Spending Insight</div>
                <p className="text-gray-300 text-sm">{aiAdvice.message}</p>
                {aiAdvice.suggestions.slice(0, 2).map((suggestion, index) => (
                  <div key={index} className="flex items-start gap-2 mt-2">
                    <span className="text-blue-400 text-xs mt-1">▶</span>
                    <span className="text-gray-300 text-xs">{suggestion}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setAiAdvice(null)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Pillars Status */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Readiness Pillars</h2>
          
          <PillarStatus
            title="Financial Capital"
            icon={DollarSign}
            score={Math.round(scores.financialScore)}
            status="Velocity Engine Active"
            description="Transform volatility into secured wealth"
          />

          <PillarStatus
            title="Legal Resilience"
            icon={Shield}
            score={Math.round(scores.legalScore)}
            status={contractAnalysis ? "Contract analyzed" : "Awaiting contract review"}
            description="Treasury Guardian protecting your assets"
            onAction={() => setActiveTab('security')}
          />

          <PillarStatus
            title="Regulatory Compliance"
            icon={Globe}
            score={Math.round(scores.regulatoryScore)}
            status={complianceData ? "Compliance checked" : "Check required"}
            description="Global Navigator ensuring eligibility"
            onAction={() => setActiveTab('readiness')}
          />

          <PillarStatus
            title="Human Capital"
            icon={Clock}
            score={Math.round(scores.humanScore)}
            status={scheduleData ? "Schedule optimized" : "Optimization pending"}
            description="Prosperity Architect maximizing your time"
            onAction={() => setActiveTab('growth')}
          />
        </div>
      </div>
    );
  };

  const renderSecurityMandate = () => (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-semibold text-white">Treasury Guardian</h2>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-white font-medium mb-2">Contract Text</label>
            <textarea
              value={contractText}
              onChange={(e) => setContractText(e.target.value)}
              placeholder="Paste contract or terms & conditions here..."
              className="w-full h-40 px-4 py-3 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          
          <button
            onClick={() => handleSecureAction('Contract Analysis', analyzeContract)}
            disabled={!contractText.trim() || isLoading}
            className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 text-white rounded-lg transition-colors font-medium"
          >
            {isLoading ? 'Analyzing Contract...' : 'Analyze Contract (Secure)'}
          </button>
        </div>

        {contractAnalysis && (
          <div className="mt-6 space-y-4">
            <div className="bg-green-500 bg-opacity-20 border border-green-500 border-opacity-30 rounded-lg p-4">
              <h3 className="text-green-400 font-semibold mb-2">Financial Safety Score</h3>
              <div className="text-2xl font-bold text-white">
                {contractAnalysis.safetyScore.toFixed(1)}/10.0
              </div>
            </div>

            <div className="bg-yellow-500 bg-opacity-20 border border-yellow-500 border-opacity-30 rounded-lg p-4">
              <h3 className="text-yellow-400 font-semibold mb-2">Critical Liability Flags</h3>
              <ul className="space-y-1">
                {contractAnalysis.liabilityFlags.map((flag, index) => (
                  <li key={index} className="text-white flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                    {flag}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-blue-500 bg-opacity-20 border border-blue-500 border-opacity-30 rounded-lg p-4">
              <h3 className="text-blue-400 font-semibold mb-2">Recommendation</h3>
              <p className="text-white">{contractAnalysis.recommendation}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderReadinessMandate = () => (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Globe className="w-6 h-6 text-green-400" />
          <h2 className="text-xl font-semibold text-white">Global Navigator</h2>
        </div>

        <div className="mb-4">
          <div className="flex items-center gap-4 mb-4">
            <div>
              <label className="block text-white font-medium mb-2">Operating Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="px-4 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="SE">SE - Salaried Employee</option>
                <option value="BO">BO - Business Owner</option>
              </select>
            </div>
            
            <div>
              <label className="block text-white font-medium mb-2">Country</label>
              <select
                value={operatingCountry}
                onChange={(e) => setOperatingCountry(e.target.value)}
                className="px-4 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Uganda">Uganda</option>
                <option value="Kenya">Kenya</option>
                <option value="Tanzania">Tanzania</option>
                <option value="Rwanda">Rwanda</option>
              </select>
            </div>
          </div>

          <button
            onClick={performComplianceCheck}
            disabled={isLoading}
            className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-600 text-white rounded-lg transition-colors font-medium"
          >
            {isLoading ? 'Checking Compliance...' : 'Perform Regulatory Gap Analysis'}
          </button>
        </div>

        {complianceData && (
          <div className="space-y-4">
            <div className="bg-green-500 bg-opacity-20 border border-green-500 border-opacity-30 rounded-lg p-4">
              <h3 className="text-green-400 font-semibold mb-2">Compliance Status</h3>
              <div className="text-2xl font-bold text-white">
                {Math.round(complianceData.compliancePercentage)}% Complete
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-white font-semibold">Compliance Checklist</h3>
              {complianceData.checklist.map((item, index) => (
                <div key={index} className={`flex items-center gap-3 p-3 rounded-lg ${
                  item.status === 'completed' ? 'bg-green-500 bg-opacity-20 border border-green-500 border-opacity-30' :
                  item.status === 'pending' ? 'bg-yellow-500 bg-opacity-20 border border-yellow-500 border-opacity-30' :
                  'bg-red-500 bg-opacity-20 border border-red-500 border-opacity-30'
                }`}>
                  {item.status === 'completed' ? 
                    <CheckCircle className="w-5 h-5 text-green-400" /> :
                    <AlertTriangle className="w-5 h-5 text-yellow-400" />
                  }
                  <div className="flex-1">
                    <span className="text-white font-medium">{item.item}</span>
                    {item.required && <span className="text-red-400 ml-2">*Required</span>}
                  </div>
                  <span className={`text-sm px-2 py-1 rounded ${
                    item.status === 'completed' ? 'bg-green-600 text-white' :
                    item.status === 'pending' ? 'bg-yellow-600 text-white' :
                    'bg-red-600 text-white'
                  }`}>
                    {item.status.replace('-', ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderGrowthMandate = () => (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp className="w-6 h-6 text-purple-400" />
          <h2 className="text-xl font-semibold text-white">Prosperity Architect</h2>
        </div>

        <div className="mb-4">
          <p className="text-gray-300 mb-4">
            Optimize your schedule for maximum value creation while maintaining spiritual and physical alignment.
          </p>
          
          <button
            onClick={optimizeSchedule}
            disabled={isLoading}
            className="w-full py-3 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-600 text-white rounded-lg transition-colors font-medium"
          >
            {isLoading ? 'Optimizing Schedule...' : 'Optimize Daily Schedule'}
          </button>
        </div>

        {scheduleData && (
          <div className="space-y-4">
            <div className="bg-purple-500 bg-opacity-20 border border-purple-500 border-opacity-30 rounded-lg p-4">
              <h3 className="text-purple-400 font-semibold mb-2">Optimization Score</h3>
              <div className="text-2xl font-bold text-white">
                {Math.round(scheduleData.optimizationScore)}%
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-white font-semibold">Schedule Recommendations</h3>
              {scheduleData.recommendations.map((rec, index) => (
                <div key={index} className="flex items-start gap-3 p-3 bg-white bg-opacity-5 rounded-lg">
                  <Clock className="w-5 h-5 text-purple-400 mt-0.5" />
                  <span className="text-white">{rec}</span>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <h3 className="text-white font-semibold">Next Actions</h3>
              {scheduleData.nextActions.map((action, index) => (
                <div key={index} className="flex items-center gap-3 p-3 bg-blue-500 bg-opacity-20 border border-blue-500 border-opacity-30 rounded-lg">
                  <Target className="w-5 h-5 text-blue-400" />
                  <span className="text-white">{action}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Settings className="w-6 h-6 text-gray-400" />
          <h2 className="text-xl font-semibold text-white">Settings</h2>
        </div>

        <div className="space-y-6">
          {/* Profile Settings */}
          <div>
            <h3 className="text-white font-semibold mb-3">Profile Configuration</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-white font-medium mb-2">Target Net Worth (UGX)</label>
                <input
                  type="number"
                  value={goals.targetNetWorth}
                  onChange={(e) => setGoals({...goals, targetNetWorth: parseFloat(e.target.value)})}
                  className="w-full px-4 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Legal Disclaimer */}
          <div className="bg-yellow-500 bg-opacity-20 border border-yellow-500 border-opacity-30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5" />
              <div>
                <h3 className="text-yellow-400 font-semibold mb-2">Legal Disclaimer</h3>
                <p className="text-white text-sm leading-relaxed">
                  <strong>NOT LEGAL OR FINANCIAL ADVICE:</strong> The ICAN Capital Engine is a risk assessment and organizational tool. 
                  All analysis, recommendations, and scores are for informational purposes only. 
                  Consult qualified professionals before making legal, financial, or business decisions. 
                  The creators assume no liability for decisions made based on this tool's output.
                </p>
              </div>
            </div>
          </div>

          {/* Data Management */}
          <div>
            <h3 className="text-white font-semibold mb-3">Data Management</h3>
            <div className="flex gap-3">
              <button
                onClick={saveUserData}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
              >
                Save Data
              </button>
              <button
                onClick={() => {
                  if (confirm('Are you sure? This will clear all your data.')) {
                    localStorage.clear();
                    window.location.reload();
                  }
                }}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
              >
                Clear All Data
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900">
      {/* Navigation */}
      <nav className="glass-card mx-4 mt-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold gradient-text">ICAN Capital Engine</h1>
              <p className="text-xs text-gray-300">From Volatility to Global Capital</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-white text-sm">{mode} Mode | {operatingCountry}</span>
            <User className="w-6 h-6 text-gray-400" />
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mt-4 overflow-x-auto">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
            { id: 'security', label: 'Security', icon: Shield },
            { id: 'readiness', label: 'Readiness', icon: Globe },
            { id: 'growth', label: 'Growth', icon: TrendingUp },
            { id: 'settings', label: 'Settings', icon: Settings }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
                activeTab === tab.id 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-white bg-opacity-10 text-gray-300 hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="p-4">
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'security' && renderSecurityMandate()}
        {activeTab === 'readiness' && renderReadinessMandate()}
        {activeTab === 'growth' && renderGrowthMandate()}
        {activeTab === 'settings' && renderSettings()}
      </main>

      {/* Journey Stage Progression Modal */}
      <JourneyStageModal
        isOpen={showStageModal}
        currentStage={currentJourneyStage}
        journeyStages={journeyStages}
        onClose={() => setShowStageModal(false)}
      />

      {/* Journey Stage Progression Modal */}
      <JourneyStageModal
        isOpen={showStageModal}
        currentStage={currentJourneyStage}
        journeyStages={journeyStages}
        onClose={() => setShowStageModal(false)}
      />

      {/* AI Spending Advice Modal */}
      <AIAdviceModal
        isOpen={showAdviceModal}
        advice={aiAdvice}
        transaction={pendingTransaction}
        onConfirm={handleConfirmTransaction}
        onCancel={handleCancelTransaction}
      />

      {/* AI Chat Interface */}
      <AIChat
        isOpen={showAIChat}
        onClose={() => setShowAIChat(false)}
        user={user}
        transactions={transactions}
        currentJourneyStage={currentJourneyStage}
        netWorth={netWorth}
        journeyStages={journeyStages}
      />

      {/* Floating AI Chat Button */}
      <div className="fixed bottom-6 right-6 z-40">
        <button
          onClick={() => setShowAIChat(true)}
          className="group relative w-14 h-14 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 flex items-center justify-center"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full blur opacity-70 group-hover:opacity-100 transition-opacity"></div>
          <Bot className="relative w-6 h-6 text-white" />
          
          {/* Pulsing notification dot */}
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-pulse flex items-center justify-center">
            <div className="w-2 h-2 bg-white rounded-full"></div>
          </div>
          
          {/* Tooltip */}
          <div className="absolute bottom-16 right-0 bg-gray-900 text-white text-xs py-2 px-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            💬 Chat with ICAN AI
            <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
          </div>
        </button>
      </div>

      {/* Biometric Security Modal */}
      <BiometricAuthModal
        isOpen={showBiometricModal}
        onClose={() => setShowBiometricModal(false)}
        onAuthenticate={handleBiometricAuthentication}
      />
    </div>
  );
};

export default ICANCapitalEngine;