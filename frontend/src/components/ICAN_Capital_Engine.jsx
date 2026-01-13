import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { createClient } from '@supabase/supabase-js';
import { ProfileIcon, ProfilePage } from './auth';
import { Header } from './Header';
import { StatusPage } from './StatusPage';
import { StatusUploader } from './status/StatusUploader';
import { StatusCarousel } from './status/StatusCarousel';
import { StatusViewerUI } from './status/StatusViewerUI';
import MainNavigation from './MainNavigation';
import SACCOHub from './SACCOHub';
import SHAREHub from './SHAREHub';
import CMMSModule from './CMSSModule';
import ICANWallet from './ICANWallet';
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
  Briefcase,
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
  WifiOff,
  Plus,
  Edit2
} from 'lucide-react';

// ============================================
// SUPABASE INITIALIZATION
// ============================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;

// Initialize Supabase safely
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('✅ Supabase initialized successfully');
  } catch (error) {
    console.error('❌ Supabase initialization failed:', error);
    supabase = null;
  }
} else {
  console.warn('⚠️ Missing Supabase environment variables: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

// AI Spending Advice Modal
const AIAdviceModal = ({ isOpen, advice, transaction, onConfirm, onCancel }) => {
  if (!isOpen || !advice) return null;
  
  // Ensure advice has all required properties with defaults
  const safeAdvice = {
    message: '',
    riskLevel: 'unknown',
    urgency: 'low',
    godlyWisdom: null,
    practicalReason: null,
    encouragement: null,
    stageGuidance: null,
    suggestions: [],
    ...advice
  };

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
          <div className="text-4xl mb-3">{getUrgencyIcon(safeAdvice.urgency)}</div>
          <h2 className="text-xl font-bold text-white mb-2">
            AI Spending Advisor
          </h2>
          <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getRiskColor(safeAdvice.riskLevel)} bg-opacity-20`}>
            <span className={`w-2 h-2 rounded-full ${getRiskColor(safeAdvice.riskLevel)} mr-2`}></span>
            Risk: {safeAdvice.riskLevel ? (safeAdvice.riskLevel.charAt(0).toUpperCase() + safeAdvice.riskLevel.slice(1)) : 'Unknown'}
          </div>
        </div>

        {transaction && (
          <div className="mb-4 p-3 bg-white bg-opacity-10 rounded-lg">
            <div className="text-white font-medium">Proposed Transaction:</div>
            <div className="text-gray-300 text-sm">
              {transaction.type === 'expense' ? '💸' : '💰'} UGX {transaction.amount?.toLocaleString() || '0'} - {transaction.description || 'Unknown transaction'}
            </div>
          </div>
        )}

        <div className="mb-4">
          <div className="text-white font-medium mb-3">💬 Your AI Financial Friend Says:</div>
          <p className="text-gray-300 text-sm mb-4 leading-relaxed">{safeAdvice.message || 'No message available'}</p>
          
          {/* God's Wisdom */}
          {safeAdvice.godlyWisdom && (
            <div className="p-4 bg-yellow-500 bg-opacity-20 rounded-lg border border-yellow-400 border-opacity-40 mb-4">
              <div className="text-yellow-300 font-medium text-sm mb-2">🙏 God's Wisdom:</div>
              <p className="text-gray-200 text-sm italic leading-relaxed">"{safeAdvice.godlyWisdom}"</p>
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
          {safeAdvice.encouragement && (
            <div className="p-3 bg-green-500 bg-opacity-20 rounded-lg border border-green-400 border-opacity-30 mb-3">
              <div className="text-green-300 font-medium text-sm mb-1">💪 Encouragement:</div>
              <p className="text-gray-300 text-sm">{safeAdvice.encouragement}</p>
            </div>
          )}

          {/* Journey Stage Guidance */}
          {safeAdvice.stageGuidance && (
            <div className="p-3 bg-purple-500 bg-opacity-20 rounded-lg border border-purple-400 border-opacity-30 mb-3">
              <div className="text-purple-300 font-medium text-sm mb-1">🎯 Journey Guidance:</div>
              <p className="text-gray-300 text-sm">{safeAdvice.stageGuidance}</p>
            </div>
          )}
          
          {/* Simple Suggestions */}
          {safeAdvice.suggestions && safeAdvice.suggestions.length > 0 && (
            <div className="space-y-2">
              <div className="text-white font-medium text-sm">💡 Helpful Suggestions:</div>
              {safeAdvice.suggestions.map((suggestion, index) => (
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
    <div className="glass-card p-3 md:p-4">
      {/* Header - Mobile optimized */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Brain className="w-4 md:w-5 h-4 md:h-5 text-purple-400 flex-shrink-0" />
          <span className="text-white font-medium text-sm md:text-base truncate">AI Multimedia</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          <span className="text-xs text-green-400">Active</span>
        </div>
      </div>

      {/* Tab Navigation - Mobile scrollable */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {[
          { id: 'voice', label: 'Voice', icon: Headphones },
          { id: 'video', label: 'Video', icon: Video },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs md:text-sm transition-colors whitespace-nowrap flex-shrink-0 ${
              activeTab === tab.id 
                ? 'bg-blue-500 text-white' 
                : 'bg-white bg-opacity-10 text-gray-300 hover:text-white'
            }`}
          >
            <tab.icon className="w-3 h-3 md:w-4 md:h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Voice Tab - Mobile optimized */}
      {activeTab === 'voice' && (
        <div className="space-y-2 md:space-y-3">
          {/* Record Button */}
          <div className="flex items-center gap-3 p-3 md:p-4 bg-white bg-opacity-5 rounded-lg">
            <button
              onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
              className={`p-2 md:p-3 rounded-full transition-all flex-shrink-0 ${
                isRecording 
                  ? 'bg-red-500 animate-pulse' 
                  : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              {isRecording ? <MicOff className="w-4 h-4 md:w-5 md:h-5 text-white" /> : <Mic className="w-4 h-4 md:w-5 md:h-5 text-white" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-white text-xs md:text-sm font-medium truncate">
                {isRecording ? '🎙️ Recording...' : '🎤 Record thoughts'}
              </div>
              <div className="text-gray-400 text-xs truncate">
                {isRecording ? 'Share your finances' : 'Start journaling'}
              </div>
            </div>
          </div>

          {/* Voice Recordings - Mobile scrollable */}
          <div className="max-h-64 md:max-h-96 overflow-y-auto space-y-2 md:space-y-3">
            {recordings.filter(r => r.type === 'voice').length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-xs md:text-sm">
                No recordings yet. Start recording to begin! 🎤
              </div>
            ) : (
              recordings.filter(r => r.type === 'voice').map((recording) => (
                <div key={recording.id} className="p-2 md:p-3 bg-white bg-opacity-5 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Volume2 className="w-3 h-3 md:w-4 md:h-4 text-blue-400 flex-shrink-0" />
                    <span className="text-white text-xs md:text-sm truncate flex-1">{recording.timestamp.toLocaleString()}</span>
                    {recording.analyzed && <Star className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                  </div>
                  
                  <audio controls className="w-full mb-2 text-xs md:text-sm" src={recording.url}></audio>
                  
                  {recording.insights && (
                    <div className="mt-2 p-2 bg-green-500 bg-opacity-20 rounded">
                      <div className="text-green-300 text-xs font-medium mb-1">🤖 Insights:</div>
                      <div className="text-gray-300 text-xs">Mood: {recording.insights.mood}</div>
                      <div className="text-gray-300 text-xs truncate">{recording.insights.confidence}</div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Video Tab - Mobile optimized */}
      {activeTab === 'video' && (
        <div className="space-y-2 md:space-y-3">
          {/* Record Button */}
          <div className="flex items-center gap-3 p-3 md:p-4 bg-white bg-opacity-5 rounded-lg">
            <button
              onClick={isVideoRecording ? stopVideoRecording : startVideoRecording}
              className={`p-2 md:p-3 rounded-full transition-all flex-shrink-0 ${
                isVideoRecording 
                  ? 'bg-red-500 animate-pulse' 
                  : 'bg-purple-500 hover:bg-purple-600'
              }`}
            >
              {isVideoRecording ? <VideoOff className="w-4 h-4 md:w-5 md:h-5 text-white" /> : <Video className="w-4 h-4 md:w-5 md:h-5 text-white" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-white text-xs md:text-sm font-medium truncate">
                {isVideoRecording ? '🎬 Recording...' : '📹 Record video'}
              </div>
              <div className="text-gray-400 text-xs truncate">
                {isVideoRecording ? 'Share your journey' : 'Document progress'}
              </div>
            </div>
          </div>

          {/* Video Recordings - Mobile responsive */}
          <div className="max-h-64 md:max-h-96 overflow-y-auto space-y-2 md:space-y-3">
            {recordings.filter(r => r.type === 'video').length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-xs md:text-sm">
                No videos yet. Start recording to begin! 📹
              </div>
            ) : (
              recordings.filter(r => r.type === 'video').map((recording) => (
                <div key={recording.id} className="p-2 md:p-3 bg-white bg-opacity-5 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Film className="w-3 h-3 md:w-4 md:h-4 text-purple-400 flex-shrink-0" />
                    <span className="text-white text-xs md:text-sm truncate flex-1">{recording.timestamp.toLocaleString()}</span>
                    {recording.analyzed && <Star className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                  </div>
                  
                  <video controls className="w-full mb-2 text-xs md:text-sm rounded" src={recording.url}></video>
                  
                  {recording.insights && (
                    <div className="mt-2 p-2 bg-purple-500 bg-opacity-20 rounded">
                      <div className="text-purple-300 text-xs font-medium mb-1">🎬 Analysis:</div>
                      <div className="text-gray-300 text-xs">Engagement: {recording.insights.engagement}%</div>
                      <div className="text-gray-300 text-xs truncate">{recording.insights.blessing}</div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Analytics Tab - Mobile optimized */}
      {activeTab === 'analytics' && (
        <div className="space-y-2 md:space-y-3">
          <button
            onClick={generateAdvancedAnalytics}
            className="w-full py-2 md:py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg text-xs md:text-sm font-medium hover:from-blue-600 hover:to-purple-600 transition-all"
            disabled={isProcessing}
          >
            {isProcessing ? '🧠 Analyzing...' : '🚀 AI Analytics'}
          </button>

          {analysisResults.map((result, index) => (
            <div key={index} className="space-y-2 md:space-y-3">
              {/* Data Health - Mobile card */}
              <div className="p-2 md:p-3 bg-white bg-opacity-5 rounded-lg">
                <div className="text-white text-xs md:text-sm font-medium mb-2">📊 Data Health</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-gray-300">Completeness: <span className="text-green-400">{result.dataHealth.completeness}%</span></div>
                  <div className="text-gray-300">Accuracy: <span className="text-green-400">{result.dataHealth.accuracy}%</span></div>
                </div>
                <div className="text-green-300 text-xs mt-2 leading-relaxed break-words">{result.dataHealth.godlyWisdom}</div>
              </div>

              {/* Predictions - Mobile scrollable */}
              <div className="p-2 md:p-3 bg-blue-500 bg-opacity-20 rounded-lg">
                <div className="text-blue-300 text-xs md:text-sm font-medium mb-2">🔮 Predictions</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {result.predictiveInsights.map((insight, i) => (
                    <div key={i} className="text-gray-300 text-xs leading-relaxed break-words">{insight}</div>
                  ))}
                </div>
              </div>

              {/* Spiritual Alignment - Mobile optimized */}
              <div className="p-2 md:p-3 bg-yellow-500 bg-opacity-20 rounded-lg">
                <div className="text-yellow-300 text-xs md:text-sm font-medium mb-2">👑 Spiritual</div>
                <div className="text-white text-xs mb-2">Score: <span className="text-yellow-300 font-semibold">{result.spiritualAlignment.score}%</span></div>
                <div className="text-gray-300 text-xs leading-relaxed break-words">{result.spiritualAlignment.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isProcessing && (
        <div className="text-center py-4">
          <div className="animate-spin w-5 h-5 md:w-6 md:h-6 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-2"></div>
          <div className="text-gray-400 text-xs md:text-sm">AI analyzing...</div>
        </div>
      )}
    </div>
  );
};

// Journey Progress Tracker Component
const JourneyProgressTracker = ({ journeyStages, currentStage, stageProgress, journeyInsights, netWorth }) => {
  const currentStageData = journeyStages[currentStage];
  const StageIcon = currentStageData.icon;
  const [showDetails, setShowDetails] = React.useState(false);

  // Compact collapsed view
  if (!showDetails) {
    return (
      <div className="inline-flex items-center gap-2 p-2 bg-gradient-to-r from-blue-500 to-purple-500 bg-opacity-20 rounded-full border border-blue-400 border-opacity-40 hover:border-opacity-60 cursor-pointer transition-all hover:bg-opacity-30" onClick={() => setShowDetails(true)} title={`Stage ${currentStage}: ${currentStageData.name}`}>
        <div className={`w-7 h-7 ${currentStageData.bgColor} bg-opacity-30 rounded-full flex items-center justify-center flex-shrink-0`}>
          <StageIcon className={`w-4 h-4 ${currentStageData.color}`} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-white">Stage {currentStage}</span>
          <div className="w-8 h-1 bg-gray-600 rounded-full overflow-hidden">
            <div className={`h-full ${currentStageData.bgColor} transition-all`} style={{ width: `${stageProgress}%` }}></div>
          </div>
          <span className="text-xs text-gray-300">{Math.round(stageProgress)}%</span>
        </div>
      </div>
    );
  }

  // Expanded details view
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-blue-400" />
          <span className="text-white font-medium">ICAN Journey Progress</span>
        </div>
        <button onClick={() => setShowDetails(false)} className="text-gray-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
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

// Advanced Smart Transaction Entry Component
const TransactionInput = ({ 
  onAddTransaction, 
  isListening, 
  onToggleListening, 
  typingFeedback,
  onInputChange,
  isVoiceSupported,
  netWorth = 0,
  netWorthTrend = 'stable',
  intelligentRecommendations = [],
  transactions = [],
  analyzeOpportunity
}) => {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [realTimeAnalysis, setRealTimeAnalysis] = useState('');
  const [smartSuggestions, setSmartSuggestions] = useState([]);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [detectedTransaction, setDetectedTransaction] = useState(null);
  const [showVoiceTips, setShowVoiceTips] = useState(false);

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);
    onInputChange(value);
    
    // Real-time intelligent analysis
    if (value.length > 5) {
      const analysis = analyzeInputRealTime(value);
      setRealTimeAnalysis(analysis.feedback);
      setDetectedTransaction(analysis.transaction);
      
      // Generate smart suggestions
      const suggestions = generateSmartSuggestions(value);
      setSmartSuggestions(suggestions);
    } else {
      setRealTimeAnalysis('');
      setDetectedTransaction(null);
      setSmartSuggestions([]);
    }
    
    // Show typing indicator for active analysis
    if (value.length > 0 && value.length <= 5) {
      setRealTimeAnalysis('🔄 AI analyzing input...');
    }
  };

  const analyzeInputRealTime = (text) => {
    const analysis = intelligentNLPParser(text);
    
    let feedback = '';
    let confidence = 0;
    
    // Confidence calculation
    if (analysis.amount > 0) confidence += 30;  // Amount found
    if (analysis.type !== 'unknown') confidence += 40;  // Type detected
    if (analysis.category !== 'other') confidence += 30; // Category detected
    if (analysis.subCategory) confidence += 10;
    if (analysis.isLoan) confidence += 10;
    
    if (confidence >= 80) {
      feedback = `✅ ${analysis.type.toUpperCase()}: UGX ${analysis.amount?.toLocaleString()} → ${analysis.category}`;
    } else if (confidence >= 50) {
      feedback = `🔄 Processing... Detected: ${analysis.type} (${confidence}% confidence)`;
    } else {
      const missing = [];
      if (analysis.amount === 0) missing.push('amount');
      if (analysis.type === 'unknown') missing.push('type (income/expense/loan)');
      if (analysis.category === 'other') missing.push('category');
      feedback = `📝 Need: ${missing.join(', ')}`;
    }
    
    return {
      feedback,
      transaction: confidence >= 50 ? analysis : null,
      confidence
    };
  };

  const intelligentNLPParser = (text) => {
    const originalText = text;
    const lowerText = text.toLowerCase();
    
    // 🎯 ADVANCED NATURAL LANGUAGE UNDERSTANDING
    
    // Step 1: 💰 ULTRA-FLEXIBLE AMOUNT RECOGNITION - Handle ANY Amount Size!
    const ultraFlexibleAmountPatterns = [
      // 🚀 EXTREME LARGE NUMBERS - Trillions, Quadrillions, etc.
      /(?:ugx\s*)?(\d+(?:\.\d+)?)\s*(?:q|quad|quadrillion)/i,        // 5q, 2.5quad, 1quadrillion
      /(?:ugx\s*)?(\d+(?:\.\d+)?)\s*(?:t|tril|trillion)/i,           // 3t, 1.5tril, 2trillion  
      /(?:ugx\s*)?(\d+(?:\.\d+)?)\s*(?:b|bil|billion)/i,             // 1b, 2.5bil, 5billion
      /(?:ugx\s*)?(\d+(?:\.\d+)?)\s*(?:m|mil|million)/i,             // 2m, 1.5mil, 800million
      /(?:ugx\s*)?(\d+(?:\.\d+)?)\s*(?:k|th|thousand)/i,             // 20k, 50th, 100thousand
      
      // 💸 CREATIVE CASUAL PATTERNS
      /income\s+(\d+)/i,                                             // "income 500000000000"
      /salary\s*(?:of\s*)?(\d+)/i,                                   // "salary 30000000000", "salary of 40000"
      /pay\s*(?:of\s*)?(\d+)/i,                                      // "pay 25000000", "pay of 60000"
      /loan\s*(?:of\s*)?(\d+)/i,                                     // "loan 200000000", "loan of 5000000"
      /borrowed\s+(\d+)/i,                                           // "borrowed 15000000"
      /earned\s+(\d+)/i,                                             // "earned 8000000"
      /received\s+(\d+)/i,                                           // "received 12000000"
      /made\s+(\d+)/i,                                               // "made 3000000"
      /got\s+(\d+)/i,                                                // "got 7000000"
      /spend\s+(\d+)/i,                                              // "spend 45000000"
      /spent\s+(\d+)/i,                                              // "spent 2000000"
      /bought?\s+(?:.*?\s+)?(?:at\s+|for\s+)?(\d+)/i,               // "bought shirt at 900000000", "buy car for 50000000"
      /sold\s+(?:.*?\s+)?(?:at\s+|for\s+)?(\d+)/i,                  // "sold land at 100000000", "sold car for 25000000"
      /cost\s*(?:of\s*)?(\d+)/i,                                     // "cost 18000000", "cost of 32000000"
      /worth\s+(\d+)/i,                                              // "worth 85000000"
      /price\s*(?:of\s*)?(\d+)/i,                                    // "price 22000000", "price of 16000000"
      /amount\s*(?:of\s*)?(\d+)/i,                                   // "amount 95000000", "amount of 71000000"
      /total\s*(?:of\s*)?(\d+)/i,                                    // "total 66000000", "total of 43000000"
      /value\s*(?:of\s*)?(\d+)/i,                                    // "value 77000000", "value of 29000000"
      
      // 🎯 CONTEXTUAL PATTERNS with flexible positioning
      /(?:at|for|of|worth|cost|price)\s+(\d+)/i,                     // "at 15000", "for 25000", "of 35000"
      /(\d+)\s+(?:shillings?|ugx|cash|money)/i,                      // "5000000 shillings", "8000000 ugx"
      
      // 📊 STANDARD UGX FORMATS - Enhanced to handle massive numbers
      /(?:ugx\s*)?(\d{1,15}(?:[,\s]\d{3})*(?:\.\d{1,2})?)\s*(?:ugx|shillings?)?/i,  // Up to quadrillions
      
      // 🌟 ULTRA FALLBACK - Catch ANY number sequence (up to 15 digits!)
      /(\d{1,15}(?:\.\d{1,2})?)/                                     // Any number up to 15 digits
    ];
    
    let amount = 0;
    let detectedMultiplier = '';
    
    // 🔍 INTELLIGENT AMOUNT DETECTION with Ultra-Flexible Parsing
    for (const pattern of ultraFlexibleAmountPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let rawValue = match[1].replace(/[,\s]/g, '');
        let numericValue = parseFloat(rawValue);
        
        // 🚀 HANDLE MASSIVE MULTIPLIERS - Check for multiplier keywords RIGHT AFTER the number
        // Extract the portion of text after the matched number to look for multipliers
        const matchIndex = text.indexOf(match[1]);
        const textAfterNumber = text.substring(matchIndex + match[1].length).toLowerCase();
        
        if (textAfterNumber.match(/^\s*(?:q|quad|quadrillion)/)) {
          amount = numericValue * 1000000000000000; // Quadrillion
          detectedMultiplier = 'quadrillion';
        } else if (textAfterNumber.match(/^\s*(?:t|tril|trillion)/)) {
          amount = numericValue * 1000000000000; // Trillion
          detectedMultiplier = 'trillion';
        } else if (textAfterNumber.match(/^\s*(?:b|bil|billion)/)) {
          amount = numericValue * 1000000000; // Billion
          detectedMultiplier = 'billion';
        } else if (textAfterNumber.match(/^\s*(?:m|mil|million)/)) {
          amount = numericValue * 1000000; // Million
          detectedMultiplier = 'million';
        } else if (textAfterNumber.match(/^\s*(?:k|th|thousand)/)) {
          amount = numericValue * 1000; // Thousand
          detectedMultiplier = 'thousand';
        } else {
          amount = numericValue; // Raw amount - no multiplier found after the number
          detectedMultiplier = 'units';
        }
        
        // 🎯 LOG SUCCESSFUL DETECTION for user feedback
        console.log(`💰 Amount Detected: ${numericValue.toLocaleString()} ${detectedMultiplier} = UGX ${amount.toLocaleString()}`);
        break;
      }
    }
    
    // 💡 SMART AMOUNT VALIDATION & AUTO-CORRECTION
    if (amount > 0) {
      // Handle ridiculously large amounts (over quadrillion) - likely input error
      if (amount > 1000000000000000) {
        console.log(`⚠️ Extremely large amount detected: ${amount.toLocaleString()}. Keeping as-is for flexibility.`);
      }
      
      // Auto-detect likely missing multiplier for very large raw numbers
      if (amount >= 1000000000 && detectedMultiplier === 'units' && !lowerText.match(/billion|million|thousand/)) {
        console.log(`🔍 Large raw number detected: ${amount}. Consider if this should be in millions/billions.`);
      }
    }

    // Step 2: 🧠 ADVANCED HUMAN LANGUAGE UNDERSTANDING - Creative & Contextual Analysis
    const advancedLanguageAnalysis = {
      income: {
        patterns: [
          // 💰 ULTRA-FLEXIBLE INCOME PATTERNS - Any amount, any format!
          /(?:income|salary|wage|pay|earned|made|got|received|profit|bonus|commission|dividend|revenue|sales?|sold)/i,
          
          // 🚀 SIMPLE INCOME KEYWORDS - Ultra casual patterns
          /^income\s+\d+/i,                    // "income 500000000000"  
          /^salary\s+\d+/i,                    // "salary 30000000000"
          /^pay\s+\d+/i,                       // "pay 25000000"
          /^earned\s+\d+/i,                    // "earned 800000000"
          /^made\s+\d+/i,                      // "made 1200000000"
          /^got\s+\d+/i,                       // "got 450000000"
          /^received\s+\d+/i,                  // "received 750000000"
          /^profit\s+\d+/i,                    // "profit 920000000"
          /^revenue\s+\d+/i,                   // "revenue 3500000000"
          /^sales?\s+\d+/i,                    // "sales 1800000000", "sale 950000000"
          
          // 💼 FLEXIBLE BUSINESS & PROFESSIONAL INCOME
          /(?:salary|wage|pay).*(?:monthly|weekly|daily|annual)/i,
          /(?:freelance|consulting|service|project|contract|gig|work|job|business|professional)/i,
          /(?:client|customer).*(?:paid|pay|payment)/i,
          /(?:bonus|commission|dividend|refund|cashback|tip|gift|allowance)/i,
          
          // 🏠 MEGA ASSET SALES - Any property/asset at any price
          /(?:sold|disposing|selling).*(?:land|plot|property|house|building|apartment|condo|office|warehouse|farm|acre|estate)/i,
          /(?:sold|selling).*(?:car|vehicle|motorbike|motorcycle|truck|bus|van|bicycle|boat|plane)/i,
          /(?:sold|selling).*(?:phone|laptop|computer|tv|furniture|jewelry|gold|watch|artwork|painting)/i,
          /(?:sold|selling).*(?:business|company|shares|stocks|investment|asset)/i,
          
          // 🌾 AGRICULTURAL & COMMODITY SALES - Massive scale farming
          /(?:sold|harvested).*(?:crops|harvest|produce|coffee|maize|beans|rice|cotton|tea|sugar|cassava|potatoes)/i,
          /(?:sold|extracted).*(?:timber|wood|minerals|sand|stones|bricks|clay|oil|gas)/i,
          /(?:sold.*livestock|sold.*cattle|sold.*goats|sold.*chicken|sold.*pigs|sold.*fish)/i,
          
          // 🎨 CREATIVE & DIGITAL INCOME - Modern economy
          /(?:sold|completed).*(?:artwork|design|website|app|software|course|training|tutorial|content)/i,
          /(?:performed|rendered).*(?:service|consultation|therapy|teaching|coaching|photography|videography)/i,
          /(?:streaming|youtube|social\s+media|influencer|creator|digital|online).*(?:income|revenue|earnings)/i,
          
          // 🎯 ULTRA-CASUAL CONVERSATIONAL - Natural human language
          /(?:got\s+paid|received\s+money|made\s+money|earned\s+some|someone\s+paid\s+me|money\s+came\s+in)/i,
          /(?:cash\s+came\s+in|money\s+came\s+through|payment\s+arrived|funds\s+received|payday|windfall)/i,
          /(?:inheritance|lottery|jackpot|prize|reward|settlement|compensation)/i,
          
          // 💎 INVESTMENT & HIGH-VALUE TRANSACTIONS
          /(?:investment|stock|crypto|bitcoin|forex|trading).*(?:profit|gain|return)/i,
          /(?:real\s+estate|property).*(?:rental|rent|lease).*(?:income|payment)/i,
          /(?:business|company|enterprise).*(?:profit|revenue|income|earnings)/i,
          
          // 🔥 MEGA TRANSACTION INDICATORS - For billion+ amounts
          /(?:major|huge|massive|enormous|gigantic).*(?:sale|deal|transaction|income|profit)/i,
          /(?:billion|trillion|quadrillion).*(?:deal|sale|income|profit|revenue)/i
        ],
        confidence: 0
      },
      expense: {
        patterns: [
          // � ULTRA-FLEXIBLE EXPENSE PATTERNS - Any purchase, any amount!  
          /(?:bought|purchased|paid|spend|spent|cost|costs|bill|fee|charge|expense|buy|purchase)/i,
          
          // 🛒 SIMPLE PURCHASE KEYWORDS - Ultra casual patterns
          /^bought?\s+/i,                      // "bought shirt at 900000000"
          /^purchased?\s+/i,                   // "purchased car for 5000000000"  
          /^spend?\s+/i,                       // "spend 150000000"
          /^spent\s+/i,                        // "spent 320000000"
          /^paid?\s+/i,                        // "paid 75000000"
          /^cost\s+/i,                         // "cost 180000000"
          
          // 🏬 FLEXIBLE PURCHASE CONTEXTS with ultra-liberal matching
          /(?:bought|buy|purchase|get|acquire).*(?:a|an|the|some)?\s*(?:shirt|dress|clothes|shoes|bag|watch|phone|car|house)/i,
          /(?:bought|buy|purchase).*(?:at|from|in|for)/i,          // "bought ... at ..."
          /(?:at|from|in|for|cost|price|worth)\s*\d+/i,           // "at 900000000", "cost 500000000"
          
          // 🛍️ SHOPPING & RETAIL - Any item, any price
          /(?:shirt|dress|clothes|shoes|bag|watch|phone|laptop|car|house|furniture|jewelry).*(?:at|for|cost|price)/i,
          /(?:shopping|retail|store|mall|market|supermarket|online)/i,
          /(?:amazon|jumia|aliexpress|ebay|facebook|instagram).*(?:order|buy|purchase)/i,
          
          // � MEGA PROPERTY & CONSTRUCTION - Billion-dollar builds
          /(?:built|constructed|renovated|repaired|bought).*(?:house|building|mansion|villa|apartment|condo|office|warehouse)/i,
          /(?:installed|fixed|replaced|bought).*(?:plumbing|electricity|tiles|windows|doors|security|solar|swimming\s+pool)/i,
          /(?:materials|cement|iron\s+sheets|bricks|marble|granite|luxury\s+finishes)/i,
          
          // 🚗 VEHICLE & LUXURY PURCHASES - Any price range
          /(?:bought|purchased).*(?:car|vehicle|truck|bus|van|motorcycle|bicycle|boat|yacht|plane|jet)/i,
          /(?:luxury|premium|expensive|high-end|top-of-the-line|custom|limited\s+edition)/i,
          /(?:ferrari|lamborghini|rolls\s+royce|bentley|mercedes|bmw|audi|tesla|porsche)/i,
          
          // 🎓 EDUCATION & DEVELOPMENT - Any scale
          /(?:school|university|college|course|training|workshop|seminary|education).*(?:fees|tuition|cost)/i,
          /(?:harvard|mit|oxford|cambridge|international\s+school|private\s+school)/i,
          /(?:books|stationery|uniform|laptop|equipment).*(?:school|studies|education)/i,
          
          // 🍽️ FOOD & LIFESTYLE - From snacks to luxury dining
          /(?:food|meal|lunch|dinner|breakfast|restaurant|cafe|hotel|resort)/i,
          /(?:ate|dined|ordered|treated).*(?:at|from|in)/i,
          /(?:michelin|five\s+star|luxury|expensive|fine\s+dining|gourmet)/i,
          
          // 🚗 TRANSPORT & TRAVEL - Local to luxury
          /(?:boda|taxi|uber|bus|train|flight|travel|trip|vacation|holiday)/i,
          /(?:first\s+class|business\s+class|private\s+jet|luxury\s+travel)/i,
          
          // 💄 PERSONAL & LUXURY SERVICES
          /(?:salon|spa|massage|therapy|cosmetic|plastic\s+surgery|medical)/i,
          /(?:designer|brand|luxury|expensive|premium|exclusive)/i,
          
          // 🎯 ULTRA-CASUAL SPENDING - Natural human language  
          /(?:spent\s+money|used\s+money|paid\s+out|cash\s+went\s+out|money\s+left)/i,
          /(?:splurged|treated\s+myself|indulged|went\s+shopping|shopping\s+spree)/i,
          /(?:investment|business\s+expense|professional|work-related)/i,
          
          // ⛪ GIVING & DONATIONS - Any amount of stewardship
          /(?:tithe|offering|donation|charity|church|temple|mosque|giving|stewardship)/i,
          /(?:biblical|spiritual|religious|faith|worship|blessing)/i,
          
          // 🔥 MEGA EXPENSE INDICATORS - For massive purchases
          /(?:luxury|premium|expensive|high-end|exclusive|custom|bespoke|designer)/i,
          /(?:million|billion|trillion).*(?:purchase|buy|cost|expense|investment)/i,
          /(?:mega|huge|massive|enormous|expensive|costly|pricey)/i
        ],
        confidence: 0
      },
      loan: {
        patterns: [
          // 🏦 Standard loan patterns
          /(?:loan|borrow|borrowed|lent|lending|credit|debt|mortgage|installment|emi|advance|overdraft|microfinance|sacco)/i,
          /(?:bank\s+loan|personal\s+loan|business\s+loan|student\s+loan|car\s+loan|home\s+loan|vehicle\s+loan)/i,
          /(?:working\s+capital|commercial\s+loan|equipment\s+loan|expansion\s+loan|inventory\s+financing)/i,
          /(?:quick\s+loan|emergency\s+loan|payday\s+loan|instant\s+loan|cash\s+advance)/i,
          /(?:took|received|got|applied|need|want|require).*(?:loan|credit|financing)/i,
          /(?:financing|funded|capital|investment).*(?:business|equipment|expansion)/i,
          
          // 🏠 PROPERTY LOANS - Uganda mortgage context
          /(?:mortgage|home\s+loan|property\s+financing)\s+(?:for|to\s+buy|to\s+purchase)\s+(?:house|land|property)/i,
          /(?:borrowed|took\s+loan)\s+(?:to\s+build|for\s+construction|for\s+renovation)/i,
          
          // 🚗 VEHICLE FINANCING - Local vehicle loans
          /(?:car\s+loan|vehicle\s+financing|auto\s+loan)\s+(?:for|to\s+buy)\s+(?:car|vehicle|motorbike|boda)/i,
          
          // 📚 EDUCATION LOANS - Uganda education context
          /(?:student\s+loan|education\s+loan|study\s+loan)\s+(?:for|to\s+pay)\s+(?:fees|tuition|school)/i,
          
          // 💼 BUSINESS FINANCING - Creative Uganda business patterns
          /(?:borrowed|took\s+loan)\s+(?:to\s+start|for\s+starting|to\s+expand)\s+(?:business|company|enterprise)/i,
          /(?:working\s+capital|cash\s+flow)\s+(?:loan|financing|support)/i,
          /(?:sacco\s+loan|microfinance|village\s+savings|group\s+lending)/i,
          
          // 🎯 HUMAN CONVERSATIONAL PATTERNS - Natural borrowing language
          /(?:borrowed\s+money|got\s+a\s+loan|took\s+credit|someone\s+lent\s+me)/i,
          /(?:need\s+to\s+borrow|looking\s+for\s+loan|applying\s+for\s+credit)/i
        ],
        confidence: 0
      }
    };

    // 🎯 ADVANCED CONFIDENCE SCORING with contextual understanding
    Object.keys(advancedLanguageAnalysis).forEach(type => {
      advancedLanguageAnalysis[type].patterns.forEach(pattern => {
        if (pattern.test(lowerText)) {
          advancedLanguageAnalysis[type].confidence += 1;
          
          // 🚀 BONUS CONFIDENCE for sophisticated human language patterns
          if (pattern.toString().includes('sold|disposing') && type === 'income') {
            advancedLanguageAnalysis[type].confidence += 2; // High confidence for property/asset sales
          }
          if (pattern.toString().includes('property|land|house') && (type === 'income' || type === 'loan')) {
            advancedLanguageAnalysis[type].confidence += 1.5; // Property transactions are significant
          }
          if (pattern.toString().includes('business|company|enterprise') && type === 'income') {
            advancedLanguageAnalysis[type].confidence += 1.3; // Business income is important
          }
        }
      });
    });

    // Determine transaction type with enhanced confidence scoring
    let type = 'unknown';
    let isLoan = false;
    let maxConfidence = 0;
    
    Object.entries(advancedLanguageAnalysis).forEach(([transType, analysis]) => {
      if (analysis.confidence > maxConfidence) {
        maxConfidence = analysis.confidence;
        type = transType;
        if (transType === 'loan') isLoan = true;
      }
    });

    // 🧠 CONTEXTUAL INTELLIGENCE - Advanced human language inference
    if (type === 'unknown' && amount > 0) {
      // 💡 Smart contextual inference based on amount and keywords
      
      // 🏠 Large amounts (>10M UGX) with property keywords likely = INCOME (land sales)
      if (amount > 10000000 && /land|property|house|building|plot|acre|farm/i.test(lowerText)) {
        type = 'income';
        console.log('🏠 Detected large property sale:', amount);
      }
      // 🚗 Medium-large amounts (1M-10M) with vehicle/asset keywords = INCOME (asset sales)
      else if (amount > 1000000 && /car|vehicle|motorbike|motorcycle|truck|phone|laptop|jewelry|gold/i.test(lowerText)) {
        type = 'income';
        console.log('🚗 Detected asset sale:', amount);
      }
      // 💼 Business context with substantial amounts = INCOME
      else if (amount > 100000 && /business|company|enterprise|client|customer|contract|project|service/i.test(lowerText)) {
        type = 'income';
        console.log('💼 Detected business income:', amount);
      }
      // 🏦 Loan indicators even without explicit "loan" word
      else if (/borrowed|financing|capital|mortgage|installment|monthly\s+payment|sacco|microfinance/i.test(lowerText)) {
        type = 'loan';
        isLoan = true;
        console.log('🏦 Detected loan transaction:', amount);
      }
      // 🍽️ Personal/lifestyle keywords typically = EXPENSE
      else if (/personal|bought|shopping|meal|transport|medical|education|groceries|clothes/i.test(lowerText)) {
        type = 'expense';
        console.log('🛒 Detected personal expense:', amount);
      }
      // 🎯 Default to expense for unclear smaller amounts
      else {
        type = 'expense';
        console.log('💳 Default expense classification:', amount);
      }
    }

    // Step 3: 🎯 ENHANCED CATEGORY DETECTION with human language understanding
    const enhancedCategoryMap = {
      // 🏠 REAL ESTATE & PROPERTY - For "sold a land at 100000000" type transactions
      'real_estate': {
        keywords: /land|plot|property|house|building|apartment|condo|office|warehouse|farm|acre|estate|residence|commercial\s+property|residential|industrial|title|deed|surveying|valuation/i,
        type: 'mixed', // Can be income (selling) or expense (buying)
        subcategories: ['land_sale', 'house_sale', 'property_purchase', 'construction', 'renovation', 'property_investment'],
        aliases: ['property', 'real_estate', 'land_deals', 'property_transactions']
      },
      
      // 🚗 VEHICLES & TRANSPORT ASSETS - For vehicle sales/purchases
      'vehicle_assets': {
        keywords: /car|vehicle|motorbike|motorcycle|truck|bus|van|bicycle|boat|plane|helicopter|scooter|tractor|lorry|boda\s+boda|pickup|coaster|noah|wish|premio|mark x|harrier|prado|rav4|honda|toyota|nissan|mercedes|bmw/i,
        type: 'mixed', // Can be income (selling) or expense (buying)
        subcategories: ['car_sale', 'vehicle_purchase', 'motorbike_sale', 'commercial_vehicles', 'vehicle_investment'],
        aliases: ['automotive', 'transport_assets', 'vehicle_deals']
      },
      
      // 🎨 VALUABLES & ASSETS - For high-value item transactions
      'valuables_assets': {
        keywords: /jewelry|gold|silver|diamond|watch|artwork|antique|collectible|painting|sculpture|furniture|electronics|expensive\s+phone|macbook|laptop|computer|tv|rolex|chains|rings|necklace|bracelet|earrings/i,
        type: 'mixed', // Can be income (selling) or expense (buying)
        subcategories: ['jewelry_sale', 'electronics_sale', 'artwork', 'collectibles', 'luxury_items'],
        aliases: ['assets', 'valuables', 'personal_property', 'luxury_goods']
      },
      
      // 🌾 AGRICULTURAL & COMMODITIES - Uganda farming context
      'agriculture_commodities': {
        keywords: /crops|harvest|produce|coffee|maize|beans|rice|cotton|tea|sugar|cassava|sweet\s+potatoes|livestock|cattle|goats|chicken|pigs|fish|timber|wood|minerals|sand|stones|bricks|clay|farming|agriculture/i,
        type: 'mixed', // Can be income (selling) or expense (buying inputs)
        subcategories: ['crop_sales', 'livestock_sales', 'timber_sales', 'minerals', 'agricultural_products', 'farming_inputs'],
        aliases: ['farming', 'natural_resources', 'commodities', 'agricultural_business']
      },
      
      // 💼 BUSINESS & INVESTMENTS - For business transactions
      'business_investments': {
        keywords: /business|company|enterprise|firm|corporation|partnership|shares|stocks|investment|dividend|profit|contract|project|service|consultation|equipment|machinery|tools|capital|funding|franchise|startup/i,
        type: 'mixed', // Can be income (business revenue) or expense (business costs)
        subcategories: ['business_revenue', 'equipment_purchase', 'investment_income', 'business_expenses', 'capital_investment'],
        aliases: ['business_transactions', 'commercial', 'investments', 'corporate']
      },
      
      // 👕 CLOTHING & FASHION
      'clothing': {
        keywords: /shirt|t-shirt|blouse|dress|skirt|pants|trousers|jeans|shorts|jacket|coat|sweater|hoodie|underwear|bra|panties|boxers|socks|stockings|shoes|boots|sandals|sneakers|heels|slippers|belt|tie|scarf|hat|cap|watch|jewelry|necklace|earrings|ring|bracelet|sunglasses|bag|purse|wallet|backpack/i,
        type: 'expense',
        subcategories: ['clothing', 'footwear', 'accessories', 'jewelry'],
        aliases: ['fashion', 'apparel', 'wear']
      },
      
      // 🍔 FOOD & DINING - Enhanced with specific items
      'food_dining': {
        keywords: /food|meal|lunch|dinner|breakfast|snack|pizza|burger|rice|beans|posho|matooke|chicken|beef|fish|bread|milk|eggs|sugar|salt|oil|onions|tomatoes|potatoes|fruits|vegetables|restaurant|cafe|takeaway|groceries|market|supermarket|cooking|drink|soda|juice|beer|wine|water|coffee|tea/i,
        type: 'expense',
        subcategories: ['groceries', 'dining_out', 'takeaway', 'beverages', 'ingredients'],
        aliases: ['dining', 'eating', 'grocery']
      },
      
      // 🚗 TRANSPORT - Enhanced with specific modes
      'transport': {
        keywords: /boda|taxi|uber|bolt|bus|matatu|car|motorcycle|bicycle|fuel|petrol|diesel|gas|transport|travel|trip|journey|flight|train|boat|parking|toll|mechanic|repair|service|maintenance|tire|battery|oil change/i,
        type: 'expense',
        subcategories: ['public_transport', 'fuel', 'maintenance', 'parking', 'rideshare'],
        aliases: ['transportation', 'mobility', 'travel']
      },
      
      // 📱 ELECTRONICS & GADGETS
      'electronics': {
        keywords: /phone|smartphone|iphone|android|laptop|computer|tablet|ipad|tv|television|radio|speaker|headphones|earphones|charger|cable|mouse|keyboard|camera|gaming|playstation|xbox|nintendo|gadget|electronic|tech|software|app|subscription|netflix|spotify|amazon prime/i,
        type: 'expense',
        subcategories: ['mobile_devices', 'computers', 'entertainment_devices', 'accessories', 'subscriptions'],
        aliases: ['technology', 'gadgets', 'devices']
      },
      
      // 🏠 HOME & HOUSEHOLD
      'household': {
        keywords: /home|house|rent|furniture|table|chair|bed|mattress|pillow|blanket|curtains|carpet|decoration|cleaning|detergent|soap|shampoo|toothpaste|toilet paper|kitchen|utensils|plates|cups|spoons|forks|knives|cooking pot|pan|refrigerator|microwave|washing machine|iron|bulb|paint/i,
        type: 'expense',
        subcategories: ['furniture', 'appliances', 'cleaning_supplies', 'decorations', 'utilities'],
        aliases: ['household_items', 'home_goods']
      },
      
      // 🏥 HEALTH & MEDICAL
      'healthcare': {
        keywords: /medical|doctor|hospital|clinic|pharmacy|medicine|drugs|pills|tablets|injection|vaccine|checkup|consultation|treatment|surgery|dental|dentist|optical|glasses|contacts|insurance|health|fitness|gym|exercise|vitamins|supplements/i,
        type: 'expense',
        subcategories: ['medical_consultation', 'medication', 'insurance', 'dental', 'optical', 'fitness'],
        aliases: ['medical', 'health']
      },
      
      // 🎓 EDUCATION & LEARNING
      'education': {
        keywords: /school|tuition|fees|books|notebook|pen|pencil|stationery|course|training|workshop|certification|university|college|student|learning|education|class|lesson|tutorial|exam|test/i,
        type: 'expense',
        subcategories: ['tuition', 'books', 'supplies', 'courses', 'training'],
        aliases: ['learning', 'academic']
      },
      
      // 💼 BUSINESS & WORK
      'business': {
        keywords: /business|office|work|meeting|conference|client|service|consultation|freelance|contract|project|equipment|tools|software|license|permit|registration|marketing|advertising|website|domain|hosting/i,
        type: 'mixed', // Can be income or expense
        subcategories: ['equipment', 'services', 'marketing', 'software', 'consulting'],
        aliases: ['professional', 'work_related']
      },
      
      // ⛪ RELIGIOUS & GIVING
      'religious': {
        keywords: /tithe|offering|church|mosque|temple|synagogue|donation|charity|religious|spiritual|pastor|priest|imam|rabbi|bible|quran|torah|prayer|worship|service|fellowship/i,
        type: 'expense',
        subcategories: ['tithe', 'offering', 'charity', 'religious_events'],
        aliases: ['giving', 'spiritual', 'faith']
      },
      
      // 🎉 ENTERTAINMENT & SOCIAL
      'entertainment': {
        keywords: /movie|cinema|film|theater|concert|music|party|club|bar|pub|entertainment|fun|game|gaming|sport|football|basketball|volleyball|swimming|dancing|karaoke|birthday|wedding|celebration|event|festival/i,
        type: 'expense',
        subcategories: ['movies', 'sports', 'parties', 'gaming', 'events', 'celebrations'],
        aliases: ['fun', 'social', 'recreation']
      },
      
      // 💰 INCOME CATEGORIES
      'salary': {
        keywords: /salary|wage|payroll|monthly pay|basic pay|overtime|bonus|allowance/i,
        type: 'income',
        subcategories: ['basic_salary', 'overtime', 'bonus', 'commission'],
        aliases: ['wages', 'employment_income']
      },
      
      'business_income': {
        keywords: /business income|revenue|profit|sales|client payment|service payment|consulting fee|freelance|project payment/i,
        type: 'income',
        subcategories: ['consulting', 'sales', 'services', 'products'],
        aliases: ['revenue', 'business_revenue']
      },
      
      // 💳 LOAN CATEGORIES
      'business_loan': {
        keywords: /business loan|commercial loan|working capital|equipment loan|trade finance|business credit|commercial credit|expansion loan|inventory loan|business financing/i,
        type: 'loan',
        subcategories: ['working_capital', 'equipment', 'expansion', 'inventory', 'commercial'],
        aliases: ['commercial_loan', 'business_financing']
      },
      
      'personal_loan': {
        keywords: /personal loan|quick loan|emergency loan|payday loan|microfinance|sacco loan|instant loan|cash advance|personal credit/i,
        type: 'loan', 
        subcategories: ['emergency', 'personal', 'microfinance', 'payday', 'instant'],
        aliases: ['quick_loan', 'emergency_loan']
      },
      
      'mortgage_loan': {
        keywords: /mortgage|home loan|property loan|real estate loan|housing loan|house financing|property financing|land loan/i,
        type: 'loan',
        subcategories: ['home_purchase', 'construction', 'refinance', 'property'],
        aliases: ['home_loan', 'property_loan']
      },
      
      'vehicle_loan': {
        keywords: /car loan|vehicle loan|auto loan|motorcycle loan|truck loan|vehicle financing|auto financing/i,
        type: 'loan',
        subcategories: ['car', 'motorcycle', 'truck', 'vehicle'],
        aliases: ['auto_loan', 'vehicle_financing']
      }
    };

    // Step 4: Advanced category matching with context awareness
    let category = 'other';
    let subCategory = null;
    let matchedKeywords = [];
    let categoryConfidence = 0;
    
    // First pass: Direct keyword matching
    for (const [cat, config] of Object.entries(enhancedCategoryMap)) {
      if (config.keywords.test(lowerText)) {
        category = cat;
        
        // Calculate match confidence
        const matches = lowerText.match(config.keywords);
        categoryConfidence = matches ? matches.length : 1;
        
        // Override transaction type if category has specific type preference
        if (config.type !== 'mixed' && type === 'unknown') {
          type = config.type;
        }
        
        // Find specific subcategory
        for (const sub of config.subcategories) {
          const subKeywords = new RegExp(sub.replace(/_/g, '[\\s-]'), 'i');
          if (subKeywords.test(lowerText)) {
            subCategory = sub;
            break;
          }
        }
        
        matchedKeywords = matches || [];
        break;
      }
    }
    
    // Step 5: Context-aware refinements
    const contextualRefinements = {
      // Time-based context
      timeContext: null,
      locationContext: null,
      purposeContext: null,
      recipientContext: null
    };
    
    // Extract time context
    const timeMatch = lowerText.match(/(morning|afternoon|evening|night|today|yesterday|tomorrow|last week|this month)/i);
    if (timeMatch) contextualRefinements.timeContext = timeMatch[1];
    
    // Extract location context  
    const locationMatch = text.match(/(?:at|from|to|in)\s+([A-Za-z\s]+?)(?:\s|$|,|\.|for|of)/i);
    if (locationMatch) contextualRefinements.locationContext = locationMatch[1].trim();
    
    // Extract purpose/reason
    const purposeMatch = text.match(/(?:for|because|since|as)\s+([^,.\n]+)/i);
    if (purposeMatch) contextualRefinements.purposeContext = purposeMatch[1].trim();
    
    // Extract recipient/source
    const recipientMatch = text.match(/(?:to|from)\s+([A-Za-z\s]+?)(?:\s|$|,|\.|for|of)/i);
    if (recipientMatch) contextualRefinements.recipientContext = recipientMatch[1].trim();
    
    // Step 6: Payment method detection
    const paymentMethodMatch = lowerText.match(/(cash|card|credit card|debit card|mobile money|mtn|airtel money|bank transfer|cheque|check)/i);
    
    // Step 7: Confidence scoring and validation
    let overallConfidence = 0;
    if (amount > 0) overallConfidence += 30;
    if (type !== 'unknown') overallConfidence += 25;
    if (category !== 'other') overallConfidence += 20;
    if (categoryConfidence > 0) overallConfidence += Math.min(15, categoryConfidence * 5);
    if (subCategory) overallConfidence += 10;
    
    // Step 8: Generate enriched description
    let enrichedDescription = originalText;
    if (category !== 'other' && subCategory) {
      enrichedDescription += ` [${category.replace(/_/g, ' ')} - ${subCategory.replace(/_/g, ' ')}]`;
    } else if (category !== 'other') {
      enrichedDescription += ` [${category.replace(/_/g, ' ')}]`;
    }

    // Return comprehensive analysis result
    return {
      amount: amount,  // 🎯 Keep extracted amount if found, user can edit it
      type,
      isLoan,
      category,
      subCategory,
      description: enrichedDescription,
      originalText: originalText,
      location: contextualRefinements.locationContext,
      timeContext: contextualRefinements.timeContext,
      purposeContext: contextualRefinements.purposeContext,
      recipientContext: contextualRefinements.recipientContext,
      paymentMethod: paymentMethodMatch ? paymentMethodMatch[1] : null,
      matchedKeywords,
      confidence: overallConfidence,
      categoryConfidence,
      aiInsights: {
        transactionPattern: type,
        spendingCategory: category,
        contextualClues: Object.values(contextualRefinements).filter(Boolean),
        smartTags: [
          ...(category !== 'other' ? [category.replace(/_/g, ' ')] : []),
          ...(subCategory ? [subCategory.replace(/_/g, ' ')] : []),
          ...(type !== 'unknown' ? [type] : [])
        ]
      },
      reportingData: {
        primaryCategory: category,
        secondaryCategory: subCategory,
        transactionType: type,
        amount: amount,
        confidence: overallConfidence,
        enrichedDescription: enrichedDescription
      }
    };
  };

  const generateSmartSuggestions = (text) => {
    const suggestions = [];
    const analysis = intelligentNLPParser(text);
    
    // Context-aware suggestions based on time, patterns, etc.
    const hour = new Date().getHours();
    const day = new Date().getDay();
    
    if (hour >= 7 && hour <= 10 && !analysis.category.includes('food')) {
      suggestions.push('🍳 Breakfast expense?');
    }
    if (hour >= 12 && hour <= 14 && !analysis.category.includes('food')) {
      suggestions.push('🍽️ Lunch expense?');
    }
    if (hour >= 18 && hour <= 21 && !analysis.category.includes('food')) {
      suggestions.push('🍽️ Dinner expense?');
    }
    
    if (day === 1 && analysis.type === 'income') {
      suggestions.push('💰 Monday salary/income?');
    }
    
    if (analysis.amount > 0 && analysis.type === 'unknown') {
      suggestions.push('📊 Specify: income, expense, or loan');
    }
    
    return suggestions.slice(0, 3);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    setIsProcessing(true);
    try {
      const transaction = await parseAdvancedTransaction(input);
      onAddTransaction(transaction);
      setInput('');
      setRealTimeAnalysis('');
      setDetectedTransaction(null);
      setSmartSuggestions([]);
    } catch (error) {
      console.error('Error processing transaction:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const parseAdvancedTransaction = async (text) => {
    const analysis = intelligentNLPParser(text);
    
    return {
      id: transactions.length, // Sequential ID starting from 0
      amount: analysis.amount,
      type: analysis.type,
      category: analysis.category,
      subCategory: analysis.subCategory,
      description: analysis.description,
      location: analysis.location,
      paymentMethod: analysis.paymentMethod,
      timeContext: analysis.timeContext,
      isLoan: analysis.isLoan,
      confidence: analysis.confidence,
      date: new Date().toISOString(),
      timestamp: new Date().getTime(),
      tags: analysis.matchedKeywords,
      
      // Enhanced loan details if applicable
      ...(analysis.isLoan && {
        loanDetails: {
          loanType: analysis.category,
          purpose: analysis.subCategory,
          status: 'active',
          dueDate: null,
          interestRate: null
        }
      })
    };
  };

  // 🧠 INTELLIGENT QUICK ACTIONS based on Financial Intelligence
  const getIntelligentQuickActions = () => {
    return [
      { emoji: '💰', text: 'Income 50000 salary', label: 'Salary' },
      { emoji: '🍽️', text: 'Expense 8000 lunch', label: 'Lunch' },
      { emoji: '🏍️', text: 'Expense 3000 boda transport', label: 'Transport' },
      { emoji: '💡', text: 'Expense 15000 electricity bill', label: 'Utilities' },
      { emoji: '⛪', text: 'Expense 25000 tithe offering', label: 'Tithe' },
      { emoji: '🏪', text: 'Income 150000 business sales', label: 'Business' }
    ];
  };

  /* COMMENTED OUT DUE TO UNICODE CORRUPTION
  const getIntelligentQuickActions_DISABLED = () => {
    const baseActions = [
      { emoji: '💰', text: 'Income 50000 salary', label: 'Salary' },
      { emoji: '🍽️', text: 'Expense 8000 lunch', label: 'Lunch' },
      { emoji: '🏍️', text: 'Expense 3000 boda transport', label: 'Transport' },
      { emoji: '💡', text: 'Expense 15000 electricity bill', label: 'Utilities' },
      { emoji: '⛪', text: 'Expense 25000 tithe offering', label: 'Tithe' },
      { emoji: '🏪', text: 'Income 150000 business sales', label: 'Business' }
    ];
    
    // Add intelligent loan recommendations based on current financial state
    if (netWorthTrend === 'growing' && netWorth > 1000000) {
      baseActions.push({
        emoji: '🚀', 
        text: `Loan ${Math.min(netWorth * 0.2, 3000000)} growth capital`, 
        label: 'Growth Loan',
        intelligent: true,
        tooltip: 'AI-suggested based on your growing net worth'
      });
    } else if (netWorthTrend === 'declining' && netWorth > 500000) {
      baseActions.push({
()        emoji: '�️', 
        text: `Loan ${Math.min(netWorth * 0.1, 800000)} stabilization`, 
        label: 'Stability',
        intelligent: true,
        tooltip: 'AI-suggested for financial stabilization'
      });
    } else {
      baseActions.push({
        emoji: '�💼', 
        text: 'Loan 2000000 business expansion', 
        label: 'Bus. Loan'
      });
    }
    
    // Add smart financial actions based on trends
    if (intelligentRecommendations.length > 0) {
      const topRec = intelligentRecommendations[0];
      if (topRec.type === 'investment') {
        baseActions.push({
          emoji: '📈',
          text: 'Income 500000 investment return',
          label: 'Invest',
          intelligent: true,
          tooltip: 'AI-suggested investment opportunity'
        });
      }
    }
    
    return baseActions;
  };
  END OF CORRUPTED FUNCTION COMMENT */
  
  const quickActionTemplates = getIntelligentQuickActions();

  const handleQuickAction = (template) => {
    setInput(template.text);
    const analysis = analyzeInputRealTime(template.text);
    setRealTimeAnalysis(analysis.feedback);
    setDetectedTransaction(analysis.transaction);
  };

  return (
    <div className="glass-card p-4 md:p-6 border border-green-500 border-opacity-30 bg-gradient-to-br from-green-500 from-opacity-5 to-blue-500 to-opacity-5 shadow-lg shadow-green-500/10">
      {/* Header - Mobile optimized */}
      <div className="flex flex-col gap-3 md:gap-0 mb-4 md:mb-6">
        {/* Title and Status */}
        <div className="flex items-start gap-2 md:gap-3">
          <div className="relative flex-shrink-0">
            <div className="absolute -top-1 -right-1 w-2 md:w-3 h-2 md:h-3 bg-green-400 rounded-full animate-pulse"></div>
            <div className="w-8 md:w-10 h-8 md:h-10 bg-gradient-to-br from-green-500 to-blue-500 bg-opacity-30 rounded-full flex items-center justify-center border border-green-400 border-opacity-40">
              <DollarSign className="w-4 md:w-6 h-4 md:h-6 text-green-400" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-white font-bold text-base md:text-lg block truncate">Smart Transaction Entry</span>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs bg-gradient-to-r from-green-500 to-emerald-500 bg-opacity-40 text-green-300 px-2 py-0.5 rounded-full border border-green-400 border-opacity-40 font-medium flex items-center gap-1 whitespace-nowrap">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
                ACTIVE
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons - Mobile responsive */}
        <div className="flex items-center gap-2 self-start md:self-auto md:ml-auto">
          <button 
            onClick={() => setShowQuickActions(!showQuickActions)}
            className="text-xs md:text-sm bg-gradient-to-r from-blue-500 to-purple-500 bg-opacity-30 text-blue-300 px-3 py-1.5 md:px-4 md:py-2 rounded-lg hover:bg-opacity-40 active:scale-95 transition-all border border-blue-400 border-opacity-30 font-medium min-w-max"
          >
            ⚡ Quick
          </button>
          <button
            onClick={() => {
              // Demo function - auto-fill with a sample transaction covering 0 to infinity scale
              const sampleTransactions = [
                // Expenses
                'Expense pen from shop',
                'Expense small sweet',
                'Expense tissue packet',
                'Expense salt sachet',
                'Expense sugar cube',
                'Expense matchbox',
                'Expense soap bar',
                'Expense bread loaf',
                'Expense airtime top-up',
                'Expense water bottle',
                'Expense energy drink',
                'Expense phone credit',
                'Expense snack at cafe',
                'Expense parking fee',
                'Expense coffee cup',
                'Expense banana bunch',
                'Expense small meal',
                'Expense lunch at restaurant',
                'Expense transport boda',
                'Expense shirt purchase',
                'Expense shoes pair',
                'Expense phone accessories',
                'Expense hair salon',
                'Expense grocery shopping',
                'Expense tithe offering',
                'Expense electric bill',
                'Expense water bill',
                'Expense internet bill',
                'Expense doctor visit',
                'Expense car maintenance',
                'Expense month rent',
                'Expense laptop purchase',
                'Expense furniture set',
                'Expense wedding expenses',
                'Expense office equipment',
                'Expense home renovation',
                'Expense medical treatment',
                'Expense school tuition',
                'Expense insurance premium',
                
                // Income
                'Income freelance gig',
                'Income freelance task',
                'Income business sales',
                'Income consulting work',
                'Income project payment',
                'Income monthly salary',
                'Income business revenue',
                'Income contract work',
                'Income property rental',
                'Income business profit',
                'Income land lease',
                'Income real estate income',
                'Income investment returns',
                'Income company dividend',
                'Income business acquisition',
                'Income major asset sale',
                'Income portfolio gains',
                'Income workshop payment',
                'Income service fees',
                
                // Loans
                'Loan emergency fund',
                'Loan personal loan',
                'Loan business startup',
                'Loan car loan',
                'Loan business expansion',
                'Loan motorcycle loan',
                'Loan car purchase',
                'Loan commercial loan',
                'Loan housing mortgage',
                'Loan agricultural project',
                'Loan real estate mortgage',
                'Loan farming enterprise',
                'Loan commercial venture',
                'Loan infrastructure project',
                'Loan expansion capital',
                'Loan national project',
                'Loan mega development',
                'Loan working capital',
                'Loan equipment financing'
              ];
              const randomSample = sampleTransactions[Math.floor(Math.random() * sampleTransactions.length)];
              setInput(randomSample);
              const analysis = analyzeInputRealTime(randomSample);
              setRealTimeAnalysis(analysis.feedback);
              setDetectedTransaction(analysis.transaction);
            }}
            className="text-xs flex-1 sm:flex-none bg-gradient-to-r from-green-500 to-emerald-500 bg-opacity-30 text-green-300 px-3 py-1.5 rounded-lg hover:bg-opacity-40 active:scale-95 transition-all border border-green-400 border-opacity-40 font-medium"
            title="Try a demo transaction"
          >
            🎯 DEMO
          </button>
          <div className="flex items-center gap-1 ml-auto sm:ml-0">
            {isVoiceSupported && (
              <span className="text-xs text-green-400 bg-green-500 bg-opacity-10 px-2 py-1 rounded-full border border-green-400 border-opacity-30">🎤</span>
            )}
            <span className="text-xs text-blue-400 bg-blue-500 bg-opacity-10 px-2 py-1 rounded-full border border-blue-400 border-opacity-30 flex items-center gap-1">🧠 <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></div></span>
          </div>
        </div>
      </div>

      {/* Quick Actions - Mobile Optimized */}
      {showQuickActions && (
        <div className="mb-3 p-3 bg-gray-800 bg-opacity-30 rounded-lg">
          <div className="text-xs text-gray-300 mb-2.5">Quick Actions (Tap to fill):</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {quickActionTemplates.map((template, idx) => (
              <button
                key={idx}
                onClick={() => handleQuickAction(template)}
                className={`flex flex-col items-center p-2.5 sm:p-2 rounded-lg hover:bg-opacity-20 active:scale-95 transition-all text-xs relative ${
                  template.intelligent 
                    ? 'bg-gradient-to-r from-purple-500 to-blue-500 bg-opacity-30 border border-purple-400 border-opacity-50 shadow-lg' 
                    : 'bg-white bg-opacity-10'
                }`}
                title={template.tooltip || template.text}
              >
                {template.intelligent && (
                  <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-400 rounded-full animate-pulse"></div>
                )}
                <span className="text-lg sm:text-base mb-1">{template.emoji}</span>
                <span className={`text-center line-clamp-2 ${template.intelligent ? 'text-white font-medium' : 'text-gray-300'}`}>
                  {template.label}
                </span>
                {template.intelligent && (
                  <div className="text-xs text-purple-200 mt-0.5">AI</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Smart Suggestions - Mobile Optimized */}
      {smartSuggestions.length > 0 && (
        <div className="mb-3 p-2.5 sm:p-2 bg-purple-500 bg-opacity-20 rounded-lg border border-purple-400 border-opacity-30">
          <div className="text-purple-300 text-xs font-semibold mb-1.5">💡 AI Suggestions (Tap to use):</div>
          <div className="flex flex-wrap gap-1.5 sm:gap-1">
            {smartSuggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setInput(suggestion);
                  const analysis = analyzeInputRealTime(suggestion);
                  setRealTimeAnalysis(analysis.feedback);
                  setDetectedTransaction(analysis.transaction);
                }}
                className="text-xs sm:text-xs bg-purple-400 bg-opacity-30 hover:bg-opacity-40 px-2.5 sm:px-2 py-1.5 sm:py-1 rounded-full text-purple-200 transition-all active:scale-95 border border-purple-300 border-opacity-20"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Enhanced Input with Voice Support - Mobile Optimized */}
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Voice Recording Indicator - Mobile Prominent Display */}
        {isListening && (
          <div className="bg-red-900 bg-opacity-40 border-l-4 border-red-500 px-4 py-3 rounded-r-lg animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-red-300">🎤 Voice Recording Active</div>
                <div className="text-xs text-red-200 mt-1">Speak naturally: "Income 500k" or "Lunch 10k"</div>
              </div>
            </div>
          </div>
        )}

        {/* Input Field - Mobile Optimized */}
        <div className="relative">
          <input
            ref={input => {
              if (input && onInputChange) {
                window.transactionInputRef = input;
              }
            }}
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder={isListening
              ? "🎤 Listening..."
              : isVoiceSupported 
              ? "💬 'Salary 500k', 'Lunch 8k', 'Loan 2M business'..." 
              : "Type: 'Income 50000' or 'Expense 8000' or 'Loan 2M'"
            }
            className="w-full px-4 py-3.5 sm:py-3 pr-16 sm:pr-20 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400 text-base sm:text-sm transition-all"
            disabled={isProcessing}
          />
          
          {/* Mobile-Friendly Button Group */}
          <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-1.5 sm:gap-1">
            {isVoiceSupported && (
              <button
                type="button"
                onClick={onToggleListening}
                className={`p-2 sm:p-1.5 rounded-full transition-all duration-300 flex-shrink-0 ${
                  isListening 
                    ? 'text-red-300 bg-red-500 bg-opacity-30 animate-pulse shadow-lg shadow-red-500/50' 
                    : 'text-gray-400 hover:text-white hover:bg-white hover:bg-opacity-10'
                }`}
                title={isListening ? 'Stop voice input (Tap to stop)' : 'Start voice input (Tap to record)'}
              >
                {isListening ? <MicOff className="w-5 h-5 sm:w-4 sm:h-4" /> : <Mic className="w-5 h-5 sm:w-4 sm:h-4" />}
              </button>
            )}
            
            {/* Confidence Indicator */}
            {detectedTransaction && (
              <div className="flex items-center px-1.5 sm:px-1">
                <span className={`text-xs sm:text-xs font-medium ${
                  detectedTransaction.confidence > 80 ? 'text-green-400' : 
                  detectedTransaction.confidence > 50 ? 'text-yellow-400' : 
                  'text-orange-400'
                }`}>
                  {detectedTransaction.confidence > 80 ? '✅' : detectedTransaction.confidence > 50 ? '🔄' : '⚠️'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Voice Guidance for Mobile - Collapsible Icon */}
        {isVoiceSupported && !isListening && input.length === 0 && (
          <div className="relative">
            {/* Collapsible Voice Tips Icon */}
            <button
              type="button"
              onClick={() => setShowVoiceTips(!showVoiceTips)}
              className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 bg-opacity-30 border border-blue-400 border-opacity-50 hover:bg-opacity-50 transition-all text-blue-300 text-xs font-bold"
              title={showVoiceTips ? "Hide voice tips" : "Show voice tips"}
            >
              🎤
            </button>

            {/* Expandable Voice Tips Tooltip */}
            {showVoiceTips && (
              <div className="absolute left-0 top-8 mt-1 w-72 bg-blue-900 bg-opacity-40 border border-blue-500 border-opacity-50 rounded-lg p-2.5 text-xs text-blue-200 z-50 shadow-lg">
                <div className="font-semibold mb-1.5 text-blue-300">Voice Examples:</div>
                <div className="space-y-1 text-blue-100 text-xs">
                  <div className="flex items-start gap-1">
                    <span className="text-blue-400 font-bold">•</span>
                    <span>"Income five hundred k" → ✅ UGX 500,000</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="text-blue-400 font-bold">•</span>
                    <span>"Lunch ten thousand" → ✅ UGX 10,000</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="text-blue-400 font-bold">•</span>
                    <span>"Loan two million business" → ✅ UGX 2M</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Enhanced Real-time Analysis - Mobile Optimized */}
        {realTimeAnalysis && (
          <div className={`p-3 sm:p-3 rounded-lg border transition-all ${
            realTimeAnalysis.includes('✅') 
              ? 'bg-green-500 bg-opacity-20 border-green-400 border-opacity-30' 
              : realTimeAnalysis.includes('🔄')
              ? 'bg-yellow-500 bg-opacity-20 border-yellow-400 border-opacity-30'
              : 'bg-blue-500 bg-opacity-20 border-blue-400 border-opacity-30'
          }`}>
            <p className={`text-sm sm:text-xs font-medium ${
              realTimeAnalysis.includes('✅') ? 'text-green-300' : 
              realTimeAnalysis.includes('🔄') ? 'text-yellow-300' : 'text-blue-300'
            }`}>
              {realTimeAnalysis}
            </p>
            
            {/* Transaction Preview & Opportunity Analysis - Mobile Responsive */}
            {detectedTransaction && detectedTransaction.confidence > 60 && (
              <div className="mt-3 space-y-2">
                {/* Transaction Details */}
                <div className="p-2.5 sm:p-2 bg-black bg-opacity-20 rounded text-xs sm:text-xs border border-white border-opacity-10">
                  <div className="text-gray-200 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-white">{detectedTransaction.type.toUpperCase()}</span>
                      {detectedTransaction.amount > 0 && (
                        <span className="text-green-300">UGX {detectedTransaction.amount.toLocaleString()}</span>
                      )}
                    </div>
                    {detectedTransaction.category !== 'other' && (
                      <div className="text-gray-300">📁 {detectedTransaction.category.replace(/_/g, ' ')}</div>
                    )}
                    {detectedTransaction.subCategory && (
                      <div className="text-gray-400">└─ {detectedTransaction.subCategory.replace(/_/g, ' ')}</div>
                    )}
                  </div>
                </div>

                {/* NPV/IRR Analysis for Investment/Loan Transactions */}
                {(detectedTransaction.type === 'investment' || detectedTransaction.type === 'loan') && (() => {
                  const opportunity = analyzeOpportunity({
                    type: detectedTransaction.type,
                    amount: detectedTransaction.amount,
                    projectName: detectedTransaction.category,
                    expectedReturn: detectedTransaction.expectedReturn || 15,
                    termMonths: detectedTransaction.termMonths || 12
                  });
                  
                  return opportunity ? (
                    <div className={`p-2.5 sm:p-2 rounded border text-xs sm:text-xs space-y-1 ${
                      opportunity.confidence > 70 
                        ? 'bg-green-900 bg-opacity-30 border-green-500 border-opacity-30' 
                        : opportunity.confidence > 50
                        ? 'bg-yellow-900 bg-opacity-30 border-yellow-500 border-opacity-30'
                        : 'bg-red-900 bg-opacity-30 border-red-500 border-opacity-30'
                    }`}>
                      <div className="font-medium text-gray-200">
                        🎯 Analysis ({opportunity.confidence}%)
                      </div>
                      {opportunity.npv !== 0 && (
                        <div className="text-gray-300 space-y-0.5">
                          <div className={opportunity.npv > 0 ? 'text-green-300' : 'text-red-300'}>
                            NPV: {opportunity.npv > 0 ? '+' : ''}{(opportunity.npv / 1000000).toFixed(1)}M UGX
                          </div>
                          {opportunity.irr !== 0 && (
                            <div className="text-purple-300">IRR: {opportunity.irr > 0 ? '+' : ''}{opportunity.irr.toFixed(1)}%</div>
                          )}
                        </div>
                      )}
                      <div className="text-gray-300">{opportunity.recommendation}</div>
                      {opportunity.savingsRate && (
                        <div className="text-gray-400 text-xs">
                          📊 Savings: {opportunity.savingsRate}%
                        </div>
                      )}
                    </div>
                  ) : null;
                })()}

                {/* Income/Expense Quick Insights */}
                {(detectedTransaction.type === 'income' || detectedTransaction.type === 'expense') && (() => {
                  const opportunity = analyzeOpportunity({
                    type: detectedTransaction.type,
                    amount: detectedTransaction.amount,
                    projectName: detectedTransaction.category
                  });
                  
                  return opportunity ? (
                    <div className="p-2.5 sm:p-2 rounded border bg-blue-900 bg-opacity-30 border-blue-500 border-opacity-30 text-xs sm:text-xs text-gray-300">
                      <div className="font-medium text-gray-200">💡 Impact</div>
                      <div className="mt-1">{opportunity.recommendation}</div>
                    </div>
                  ) : null;
                })()}
              </div>
            )}
          </div>
        )}

        {/* Example formats help - HIDDEN */}
        {false && input.length < 5 && (
          <div className="text-xs text-gray-400 space-y-1">
            <div>💡 <strong>Examples:</strong></div>
            <div>• "Salary 800000 monthly pay" → Income: UGX 800,000</div>
            <div>• "Lunch 12k at cafe java" → Expense: UGX 12,000</div>
            <div>• "Loan 5M business expansion" → Loan: UGX 5,000,000</div>
            <div>• "Tithe 50000 monthly offering" → Expense: UGX 50,000</div>
          </div>
        )}
        
        {/* Mobile-Optimized Submit Button */}
        <button
          type="submit"
          disabled={!input.trim() || isProcessing}
          className={`w-full py-3.5 sm:py-2.5 px-4 text-white rounded-lg transition-all font-medium shadow-lg disabled:shadow-none text-base sm:text-sm ${
            isProcessing 
              ? 'bg-gradient-to-r from-purple-500 to-blue-500 animate-pulse'
              : detectedTransaction && detectedTransaction.confidence > 80
              ? 'bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 shadow-green-500/25 active:scale-95'
              : input.trim()
              ? 'bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 shadow-blue-500/25 active:scale-95'
              : 'bg-gradient-to-r from-gray-600 to-gray-600'
          }`}
        >
          {isProcessing ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span className="hidden sm:inline">🧠 AI Processing...</span>
              <span className="sm:hidden">Processing...</span>
            </span>
          ) : detectedTransaction && detectedTransaction.confidence > 80 ? (
            <span className="flex items-center justify-center gap-2 flex-wrap">
              ✅ Add {detectedTransaction.type ? (detectedTransaction.type.charAt(0).toUpperCase() + detectedTransaction.type.slice(1)) : 'Transaction'}
              <div className="w-2 h-2 bg-white rounded-full animate-bounce"></div>
            </span>
          ) : input.trim() ? (
            <span className="flex items-center justify-center gap-2 flex-wrap">
              ⚡ Smart Add Transaction
              <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            </span>
          ) : (
            '💭 Enter or say transaction details...'
          )}
        </button>

        {/* Mobile Voice Recording Duration Timer */}
        {isListening && (
          <div className="text-center text-xs text-gray-400 py-2">
            🎤 Recording... (Tap mic button to stop)
          </div>
        )}
      </form>
    </div>
  );
};

// 🧠 AI FINANCIAL INTELLIGENCE DASHBOARD
const AIFinancialIntelligenceDashboard = ({ intelligence, recommendations, loanOpportunities, netWorth, trend }) => {
  if (!intelligence) return null;

  const getTrendIcon = (trend) => {
    switch(trend) {
      case 'growing': return '📈';
      case 'declining': return '📉';
      default: return '➡️';
    }
  };

  const getTrendColor = (trend) => {
    switch(trend) {
      case 'growing': return 'text-green-400';
      case 'declining': return 'text-red-400';
      default: return 'text-yellow-400';
    }
  };

  return (
    <div className="glass-card p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
          <span className="text-white font-medium">🧠 AI Financial Intelligence</span>
        </div>
        <div className={`flex items-center gap-1 ${getTrendColor(trend)}`}>
          <span>{getTrendIcon(trend)}</span>
          <span className="text-xs">{trend}</span>
        </div>
      </div>

      {/* Net Worth Intelligence */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-gray-800 bg-opacity-30 rounded-lg p-3">
          <div className="text-xs text-gray-400">Net Worth Trend</div>
          <div className={`text-sm font-bold ${getTrendColor(trend)}`}>
            {trend.toUpperCase()} {intelligence.growthRate > 0 ? '+' : ''}{intelligence.growthRate.toFixed(1)}%
          </div>
        </div>
        <div className="bg-gray-800 bg-opacity-30 rounded-lg p-3">
          <div className="text-xs text-gray-400">Monthly Net Flow</div>
          <div className={`text-sm font-bold ${intelligence.monthlyNetFlow >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {intelligence.monthlyNetFlow >= 0 ? '+' : ''}UGX {intelligence.monthlyNetFlow.toLocaleString()}
          </div>
        </div>
        <div className="bg-gray-800 bg-opacity-30 rounded-lg p-3">
          <div className="text-xs text-gray-400">Business Income %</div>
          <div className="text-sm font-bold text-blue-400">
            {intelligence.businessIncomeRatio.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Intelligent Recommendations */}
      {recommendations.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-gray-400 mb-2">💡 AI Recommendations</div>
          {recommendations.slice(0, 2).map((rec, idx) => (
            <div key={idx} className={`p-2 rounded-lg border border-opacity-30 mb-2 ${
              rec.color === 'green' ? 'bg-green-500 bg-opacity-20 border-green-400' :
              rec.color === 'red' ? 'bg-red-500 bg-opacity-20 border-red-400' :
              rec.color === 'orange' ? 'bg-orange-500 bg-opacity-20 border-orange-400' :
              'bg-blue-500 bg-opacity-20 border-blue-400'
            }`}>
              <div className="flex items-start gap-2">
                <div className={`w-2 h-2 rounded-full mt-1 ${
                  rec.priority === 'critical' ? 'bg-red-400' :
                  rec.priority === 'high' ? 'bg-orange-400' : 'bg-blue-400'
                }`}></div>
                <div className="flex-1">
                  <div className="text-xs font-medium text-white">{rec.title}</div>
                  <div className="text-xs text-gray-300 mt-1">{rec.message}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Smart Loan Opportunities */}
      {loanOpportunities.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-2">🎯 Smart Loan Opportunities</div>
          {loanOpportunities.slice(0, 2).map((loan, idx) => (
            <div key={idx} className="bg-gradient-to-r from-purple-500 to-blue-500 bg-opacity-20 p-2 rounded-lg mb-2 border border-purple-400 border-opacity-30">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="text-xs font-medium text-white">{loan.title}</div>
                  <div className="text-xs text-gray-300 mt-1">{loan.description}</div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-green-400">UGX {loan.suggestedAmount?.toLocaleString()}</span>
                    <span className="text-xs text-blue-400">ROI: {loan.expectedROI}</span>
                    <span className={`text-xs px-1 rounded ${
                      loan.riskLevel === 'low' ? 'bg-green-400 bg-opacity-20 text-green-400' :
                      loan.riskLevel === 'medium' ? 'bg-yellow-400 bg-opacity-20 text-yellow-400' :
                      'bg-red-400 bg-opacity-20 text-red-400'
                    }`}>{loan.riskLevel} risk</span>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    // Auto-fill Smart Transaction Entry with this loan
                    const loanText = `Loan ${loan.suggestedAmount} ${loan.purpose}`;
                    // This would integrate with Smart Transaction Entry
                  }}
                  className="px-2 py-1 text-xs bg-white bg-opacity-10 hover:bg-opacity-20 rounded transition-all"
                >
                  Apply
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
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
    <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 mt-6 max-w-full">
      {/* Header - Mobile optimized */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <h3 className="text-lg md:text-xl font-bold text-gray-800 flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <span className="truncate">Smart Data Manager</span>
        </h3>
        
        {/* Action Buttons - Stacked on mobile */}
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          <button
            onClick={() => setCreativeMode(!creativeMode)}
            className={`flex-1 sm:flex-none px-3 md:px-4 py-2 rounded-lg font-medium transition-colors text-sm md:text-base min-w-max ${
              creativeMode 
                ? 'bg-purple-100 text-purple-700 border border-purple-300'
                : 'bg-gray-100 text-gray-700 border border-gray-300'
            }`}
          >
            <Sparkles className="w-4 h-4 inline mr-1" />
            Creative
          </button>
          
          <button
            onClick={createSmartBackup}
            className="flex-1 sm:flex-none px-3 md:px-4 py-2 bg-blue-100 text-blue-700 rounded-lg border border-blue-300 font-medium hover:bg-blue-200 transition-colors text-sm md:text-base min-w-max"
          >
            <Cloud className="w-4 h-4 inline mr-1" />
            Backup
          </button>
        </div>
      </div>

      {/* Data Status Dashboard - Mobile responsive cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-6">
        {/* Data Security Card */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 md:p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-green-600 flex-shrink-0" />
            <span className="font-medium text-green-800 text-sm md:text-base">Security</span>
          </div>
          <div className="space-y-1">
            <p className="text-xs md:text-sm text-green-700 truncate">
              ✅ Local: {dataBackup.local ? 'Protected' : 'Pending'}
            </p>
            <p className="text-xs md:text-sm text-green-700 truncate">
              ☁️ Cloud: {dataBackup.cloud ? 'Synced' : 'Offline'}
            </p>
          </div>
        </div>

        {/* Data Stats Card */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 md:p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span className="font-medium text-blue-800 text-sm md:text-base">Stats</span>
          </div>
          <div className="space-y-1">
            <p className="text-xs md:text-sm text-blue-700">
              📊 Transactions: <span className="font-semibold">{transactions.length}</span>
            </p>
            <p className="text-xs md:text-sm text-blue-700">
              🎥 Media: <span className="font-semibold">{multimediaData.recordings?.length || 0}</span>
            </p>
          </div>
        </div>

        {/* Stewardship Card */}
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 md:p-4 hover:shadow-md transition-shadow sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-4 h-4 text-purple-600 flex-shrink-0" />
            <span className="font-medium text-purple-800 text-sm md:text-base">Stewardship</span>
          </div>
          <div className="space-y-1">
            <p className="text-xs md:text-sm text-purple-700">
              ⭐ Score: <span className="font-semibold">{calculateStewardshipScore()}%</span>
            </p>
            <p className="text-xs md:text-sm text-purple-700 truncate">
              🙏 {journeyStages[currentJourneyStage]?.name || 'Growing'}
            </p>
          </div>
        </div>
      </div>

      {/* Creative AI Features - Mobile optimized */}
      {creativeMode && (
        <div className="space-y-3 md:space-y-4">
          {/* Financial Journey Story */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4 md:p-6 overflow-hidden">
            <div className="flex items-center gap-2 mb-3 md:mb-4">
              <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <h4 className="font-bold text-blue-800 text-sm md:text-base">Financial Journey</h4>
            </div>
            <div className="whitespace-pre-line text-gray-700 leading-relaxed text-xs md:text-sm max-h-48 md:max-h-none overflow-y-auto md:overflow-visible">
              {storyData.financialJourney}
            </div>
          </div>

          {/* Goal Visualization */}
          <div className="bg-gradient-to-r from-green-50 to-yellow-50 border border-green-200 rounded-lg p-4 md:p-6 overflow-hidden">
            <div className="flex items-center gap-2 mb-3 md:mb-4">
              <Target className="w-5 h-5 text-green-600 flex-shrink-0" />
              <h4 className="font-bold text-green-800 text-sm md:text-base">Goal Visualization</h4>
            </div>
            <div className="whitespace-pre-line text-gray-700 leading-relaxed text-xs md:text-sm max-h-48 md:max-h-none overflow-y-auto md:overflow-visible">
              {storyData.goalVisualization}
            </div>
          </div>

          {/* Celebrations - Mobile scrollable */}
          {storyData.celebrations.length > 0 && (
            <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-4 md:p-6">
              <div className="flex items-center gap-2 mb-3 md:mb-4">
                <Star className="w-5 h-5 text-yellow-600 flex-shrink-0" />
                <h4 className="font-bold text-yellow-800 text-sm md:text-base">Celebrations</h4>
              </div>
              <div className="grid gap-2 md:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-1">
                {storyData.celebrations.map((celebration, index) => (
                  <div key={index} className="flex items-start gap-3 bg-white bg-opacity-50 rounded-lg p-3 hover:bg-opacity-70 transition-all">
                    <span className="text-xl md:text-2xl flex-shrink-0">{celebration.icon}</span>
                    <div className="min-w-0">
                      <h5 className="font-semibold text-gray-800 text-xs md:text-sm truncate">{celebration.title}</h5>
                      <p className="text-gray-600 text-xs md:text-sm break-words">{celebration.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Creative Insights */}
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-4 md:p-6">
            <div className="flex items-center gap-2 mb-3 md:mb-4">
              <TrendingUp className="w-5 h-5 text-purple-600 flex-shrink-0" />
              <h4 className="font-bold text-purple-800 text-sm md:text-base">AI Insights</h4>
            </div>
            <div className="grid gap-2 md:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-1">
              {generateCreativeInsights().map((insight, index) => (
                <div key={index} className="flex items-start gap-3 bg-white bg-opacity-50 rounded-lg p-3 hover:bg-opacity-70 transition-all">
                  <span className="text-lg md:text-xl flex-shrink-0">{insight.icon}</span>
                  <div className="min-w-0">
                    <h5 className="font-semibold text-gray-800 text-xs md:text-sm truncate">{insight.title}</h5>
                    <p className="text-gray-600 text-xs md:text-sm break-words">{insight.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Spiritual Encouragement */}
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg p-4 md:p-6 text-center">
            <Star className="w-6 md:w-8 h-6 md:h-8 text-indigo-600 mx-auto mb-2 md:mb-3" />
            <h4 className="font-bold text-indigo-800 mb-2 text-sm md:text-base">Today's Encouragement</h4>
            <p className="text-indigo-700 italic text-xs md:text-sm mb-2">
              "And my God will meet all your needs according to the riches of his glory in Christ Jesus." - Philippians 4:19
            </p>
            <p className="text-gray-600 text-xs md:text-sm">
              Remember: You are stewarding God's blessings. He sees your heart! 💝
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
  const { profile } = useAuth();
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
  const [showTithingCalculator, setShowTithingCalculator] = useState(false);
  const [showBusinessLoanCalculator, setShowBusinessLoanCalculator] = useState(false);
  const [loanTransactionData, setLoanTransactionData] = useState(null);
  const [financialIntelligence, setFinancialIntelligence] = useState(null);
  const [netWorthTrend, setNetWorthTrend] = useState('stable');
  const [intelligentRecommendations, setIntelligentRecommendations] = useState([]);
  const [smartLoanOpportunities, setSmartLoanOpportunities] = useState([]);
  const [businessLoans, setBusinessLoans] = useState([]);
  const [pendingTransaction, setPendingTransaction] = useState(null);
  const [spendingInsights, setSpendingInsights] = useState(null);
  const [showReportingSystem, setShowReportingSystem] = useState(false);
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
  const [cmmsData, setCmmsData] = useState({
    companyProfile: null,
    users: [],
    inventory: [],
    workOrders: [],
    serviceProviders: []
  });
  const [showProfilePage, setShowProfilePage] = useState(false);
  const [showStatusPage, setShowStatusPage] = useState(false);
  const [showStatusUploader, setShowStatusUploader] = useState(false);
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [showTRUST, setShowTRUST] = useState(false);
  const [showSHARE, setShowSHARE] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [showJourneyDetails, setShowJourneyDetails] = useState(false);
  const [showAIInsights, setShowAIInsights] = useState(false);
  const [showFinancialAnalytics, setShowFinancialAnalytics] = useState(false);

  // Refs for voice/media handling
  const recognitionRef = useRef(null);
  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const videoStreamRef = useRef(null);
  const canvasRef = useRef(null);

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
    
    // Listen for status feed navigation event from Header
    const handleNavigateStatusFeed = () => {
      setShowStatusPage(true);
    };
    
    window.addEventListener('navigate-status-feed', handleNavigateStatusFeed);
    return () => window.removeEventListener('navigate-status-feed', handleNavigateStatusFeed);
  }, []);

  // Calculate net worth and velocity
  useEffect(() => {
    calculateFinancials();
    // Run AI Financial Intelligence analysis when transactions change
    if (transactions.length > 0) {
      analyzeFinancialIntelligence();
    }
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
  // 🛡️ SAFE ADVICE STANDARDIZATION - Ensure all advice objects have required properties
  const standardizeAdvice = (advice) => {
    return {
      title: advice.title || 'Financial Insight',
      message: advice.message || advice.encouragement || 'Processing your transaction...',
      recommendation: advice.recommendation || advice.reasoning || 'Continue with your transaction.',
      urgency: advice.urgency || 'low',
      color: advice.color || 'blue',
      shouldProceed: advice.shouldProceed !== undefined ? advice.shouldProceed : true,
      suggestions: advice.suggestions || advice.actionPlan || [],
      confidence: advice.confidence || 75,
      ...advice // Keep any additional properties
    };
  };

  const analyzeSpendingWithAI = async (transaction) => {
    const isIncome = transaction.type === 'income' || transaction.amount > 0;
    
    let result;
    if (isIncome) {
      result = await analyzeIncomeDecision(transaction);
    } else {
      result = await analyzeSpendingDecision(transaction);
    }
    
    return standardizeAdvice(result);
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
    const categories = transactions.reduce((acc, t) => {
      const category = t.category || 'other';
      acc[category] = (acc[category] || 0) + Math.abs(t.amount);
      return acc;
    }, {});
    
    return Object.entries(categories)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
  };

  // � BUSINESS LOAN CALCULATOR & ANALYSIS
  const BusinessLoanCalculator = ({ isOpen, onClose, onAddLoan, preFilledData = null }) => {
    const [loanAmount, setLoanAmount] = useState('');
    const [interestRate, setInterestRate] = useState('');
    const [loanTerm, setLoanTerm] = useState('');
    const [loanPurpose, setLoanPurpose] = useState('business-expansion');
    const [expectedROI, setExpectedROI] = useState('');
    const [collateral, setCollateral] = useState('');
    
    // Comprehensive Business Financials
    const [monthlyRevenue, setMonthlyRevenue] = useState('');
    const [operatingExpenses, setOperatingExpenses] = useState('');
    const [employeeSalaries, setEmployeeSalaries] = useState('');
    const [rentUtilities, setRentUtilities] = useState('');
    const [marketingCosts, setMarketingCosts] = useState('');
    const [inventoryCosts, setInventoryCosts] = useState('');
    const [businessType, setBusinessType] = useState('retail');
    const [currentTaxRate, setCurrentTaxRate] = useState('30'); // Uganda corporate tax
    const [vatRate, setVatRate] = useState('18'); // Uganda VAT
    const [payeDeductions, setPayeDeductions] = useState('');
    const [existingDebts, setExistingDebts] = useState('');
    const [tithePercentage, setTithePercentage] = useState('10');

    // 🧠 INTELLIGENT PRE-FILL with Smart Transaction Entry data
    useEffect(() => {
      if (preFilledData && isOpen) {
        console.log('💼 Business Loan Calculator: Pre-filling with smart data', preFilledData);
        
        // � USE SMART PRE-FILL DATA if available (from Smart Transaction Entry)
        const smartData = preFilledData.smartPreFill;
        if (smartData) {
          console.log('🚀 Using intelligent smart pre-fill data:', smartData);
          
          // 🎯 PRIMARY LOAN DETAILS with AI-detected values
          setLoanAmount(smartData.amount?.toString() || '');
          setLoanPurpose(smartData.loanType || 'business-expansion');
          setInterestRate(smartData.interestRate || '22');
          setLoanTerm(smartData.loanTerm || '2');
          setExpectedROI(smartData.expectedROI || '20');
          
          // 📊 INTELLIGENT BUSINESS METRICS estimation
          if (smartData.monthlyRevenue) {
            setMonthlyRevenue(smartData.monthlyRevenue.toString());
          }
          if (smartData.operatingExpenses) {
            setOperatingExpenses(smartData.operatingExpenses.toString());
          }
          if (smartData.businessType) {
            setBusinessType(smartData.businessType);
          }
          
          console.log('✅ Business Loan Calculator auto-populated with intelligent defaults');
        } else {
          // 🔄 FALLBACK: Use basic preFilledData if no smart pre-fill available
          setLoanAmount(preFilledData.amount?.toString() || '');
          setLoanPurpose(preFilledData.loanType || 'business-expansion');
          
          // Set reasonable defaults based on transaction amount
          if (preFilledData.amount > 1000000) {
            setInterestRate('20'); // Lower rate for larger loans
            setLoanTerm('3'); // 3 years for substantial business loans
          } else {
            setInterestRate('24'); // Higher rate for smaller loans
            setLoanTerm('2'); // 2 years
          }
          
          console.log('💼 Business Loan Calculator pre-filled with basic defaults');
        }
      }
    }, [preFilledData, isOpen]);

    const calculateLoanMetrics = () => {
      const principal = parseFloat(loanAmount) || 0;
      const rate = (parseFloat(interestRate) || 0) / 100 / 12;
      const payments = (parseFloat(loanTerm) || 0) * 12;
      
      // Business Financial Calculations
      const grossMonthlyRevenue = parseFloat(monthlyRevenue) || 0;
      const monthlyOperating = parseFloat(operatingExpenses) || 0;
      const monthlySalaries = parseFloat(employeeSalaries) || 0;
      const monthlyRentUtilities = parseFloat(rentUtilities) || 0;
      const monthlyMarketing = parseFloat(marketingCosts) || 0;
      const monthlyInventory = parseFloat(inventoryCosts) || 0;
      const monthlyExistingDebts = parseFloat(existingDebts) || 0;
      
      // Tax Calculations
      const corporateTaxRate = parseFloat(currentTaxRate) || 30;
      const vatRateValue = parseFloat(vatRate) || 18;
      const payeMonthly = parseFloat(payeDeductions) || 0;
      const titheRate = parseFloat(tithePercentage) || 10;

      if (principal === 0 || rate === 0 || payments === 0) {
        return {
          monthlyPayment: 0,
          totalPayment: 0,
          totalInterest: 0,
          isWorthwhile: false,
          riskLevel: 'unknown',
          businessMetrics: {}
        };
      }

      // Loan Payment Calculation
      const loanMonthlyPayment = (principal * rate * Math.pow(1 + rate, payments)) / (Math.pow(1 + rate, payments) - 1);
      const totalPayment = loanMonthlyPayment * payments;
      const totalInterest = totalPayment - principal;

      // Comprehensive Business Analysis
      const totalMonthlyExpenses = monthlyOperating + monthlySalaries + monthlyRentUtilities + 
                                   monthlyMarketing + monthlyInventory + monthlyExistingDebts + loanMonthlyPayment;
      
      const grossProfit = grossMonthlyRevenue - (monthlyOperating + monthlyInventory);
      const netProfitBeforeTax = grossProfit - monthlySalaries - monthlyRentUtilities - monthlyMarketing - monthlyExistingDebts - loanMonthlyPayment;
      
      // Tax Calculations
      const vatOnSales = grossMonthlyRevenue * (vatRateValue / 100);
      const corporateTax = Math.max(0, netProfitBeforeTax * (corporateTaxRate / 100));
      const totalTaxes = vatOnSales + corporateTax + payeMonthly;
      
      const netProfitAfterTax = netProfitBeforeTax - corporateTax;
      const titheAmount = Math.max(0, netProfitAfterTax * (titheRate / 100));
      const finalNetProfit = netProfitAfterTax - titheAmount;
      
      // Cash Flow Analysis
      const monthlyNetCashFlow = finalNetProfit;
      const breakEvenRevenue = totalMonthlyExpenses + totalTaxes + titheAmount;
      const profitMargin = grossMonthlyRevenue > 0 ? (finalNetProfit / grossMonthlyRevenue) * 100 : 0;
      
      // Risk Assessment
      let riskLevel = 'low';
      const debtServiceRatio = grossMonthlyRevenue > 0 ? (loanMonthlyPayment / grossMonthlyRevenue) * 100 : 100;
      
      if (parseFloat(interestRate) > 25 || debtServiceRatio > 40 || monthlyNetCashFlow < 0) riskLevel = 'high';
      else if (parseFloat(interestRate) > 18 || debtServiceRatio > 25 || profitMargin < 5) riskLevel = 'medium';
      
      const isWorthwhile = monthlyNetCashFlow > 0 && debtServiceRatio < 30;
      const annualROI = finalNetProfit * 12;

      return {
        monthlyPayment: loanMonthlyPayment,
        totalPayment,
        totalInterest,
        isWorthwhile,
        riskLevel,
        annualROI,
        netBenefit: annualROI - totalInterest,
        businessMetrics: {
          grossMonthlyRevenue,
          totalMonthlyExpenses,
          grossProfit,
          netProfitBeforeTax,
          netProfitAfterTax,
          finalNetProfit,
          totalTaxes,
          titheAmount,
          monthlyNetCashFlow,
          breakEvenRevenue,
          profitMargin,
          debtServiceRatio,
          vatOnSales,
          corporateTax
        }
      };
    };

    const metrics = calculateLoanMetrics();

    const getLoanAdvice = () => {
      if (!loanAmount || !interestRate || !loanTerm || !monthlyRevenue) {
        return {
          decision: 'INCOMPLETE ANALYSIS',
          message: 'Please provide loan details and business financials for comprehensive analysis',
          color: 'gray',
          advice: 'Fill in revenue, expenses, and tax information for accurate assessment'
        };
      }

      const businessMetrics = metrics.businessMetrics || {};
      const cashFlow = businessMetrics.monthlyNetCashFlow || 0;
      const debtRatio = businessMetrics.debtServiceRatio || 0;
      const profitMargin = businessMetrics.profitMargin || 0;

      // Critical risk factors
      if (cashFlow < 0) {
        return {
          decision: '🚨 CRITICAL RISK',
          message: 'Business shows negative cash flow - loan will worsen financial position',
          advice: 'Focus on improving profitability before taking on debt. Consider restructuring operations.',
          color: 'red'
        };
      }

      if (debtRatio > 40) {
        return {
          decision: '⛔ EXCESSIVE DEBT BURDEN',
          message: `Debt service ratio ${debtRatio.toFixed(1)}% is dangerously high`,
          advice: 'Reduce loan amount or extend repayment period. Consider alternative funding sources.',
          color: 'red'
        };
      }

      if (parseFloat(interestRate) > 25) {
        return {
          decision: '💸 PREDATORY LENDING',
          message: 'Interest rate above 25% will drain your business resources',
          advice: 'Negotiate better terms or seek microfinance institutions with lower rates.',
          color: 'red'
        };
      }

      // Moderate risks
      if (profitMargin < 5 || debtRatio > 25) {
        return {
          decision: '⚠️ PROCEED WITH CAUTION',
          message: `Thin profit margins (${profitMargin.toFixed(1)}%) or high debt ratio require careful monitoring`,
          advice: 'Ensure you have 3-6 months of loan payments in reserve. Monitor cash flow weekly.',
          color: 'yellow'
        };
      }

      if (parseFloat(interestRate) > 18) {
        return {
          decision: '🟡 MODERATE RISK',
          message: 'Interest rate is above market average for Uganda businesses',
          advice: 'Shop around with other financial institutions. Consider improving credit score.',
          color: 'yellow'
        };
      }

      // Good loan conditions
      if (cashFlow > metrics.monthlyPayment * 2 && debtRatio < 20 && profitMargin > 10) {
        return {
          decision: '✅ EXCELLENT OPPORTUNITY',
          message: 'Strong cash flow and healthy margins support this loan decision',
          advice: `Monthly tithe: UGX ${(businessMetrics.titheAmount || 0).toLocaleString()}. Ensure faithful stewardship.`,
          color: 'green'
        };
      }

      if (cashFlow > metrics.monthlyPayment * 1.5 && debtRatio < 25) {
        return {
          decision: '👍 RECOMMENDED',
          message: 'Adequate cash flow coverage and manageable debt levels',
          advice: 'Maintain current profit levels and have contingency plans for seasonal variations.',
          color: 'green'
        };
      }

      return {
        decision: '🤔 NEEDS IMPROVEMENT',
        message: 'Business fundamentals need strengthening before taking on additional debt',
        advice: 'Focus on increasing revenue or reducing expenses first. Review in 3-6 months.',
        color: 'yellow'
      };
    };

    const advice = getLoanAdvice();

    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
                  💼 Business Loan Calculator
                  {preFilledData && (
                    <span className="text-sm bg-gradient-to-r from-blue-500 to-purple-500 text-white px-3 py-1 rounded-full animate-pulse">
                      🧠 AI Auto-Filled
                    </span>
                  )}
                </h2>
                <p className="text-gray-600 mt-1">
                  {preFilledData 
                    ? `🎯 Smart Analysis: ${preFilledData.description || 'Business loan transaction'} ${preFilledData.smartPreFill ? '(AI-optimized defaults applied)' : ''}`
                    : 'Smart business financing decisions'
                  }
                </p>
              </div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
            </div>

            {/* 🎯 SMART INTEGRATION NOTIFICATION */}
            {preFilledData && preFilledData.smartPreFill && (
              <div className="bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-xl p-4 mb-6">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">🎯</div>
                  <div className="flex-1">
                    <h4 className="text-lg font-semibold text-green-800 mb-1">
                      Smart Integration Active!
                    </h4>
                    <p className="text-green-700 text-sm mb-2">
                      Your loan transaction from Smart Transaction Entry has been automatically analyzed and pre-filled with intelligent defaults:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                      <div className="bg-white/60 rounded px-3 py-1">
                        <strong>Type:</strong> {preFilledData.smartPreFill.loanType?.replace('-', ' ').toUpperCase()}
                      </div>
                      <div className="bg-white/60 rounded px-3 py-1">
                        <strong>Rate:</strong> {preFilledData.smartPreFill.interestRate}%
                      </div>
                      <div className="bg-white/60 rounded px-3 py-1">
                        <strong>Term:</strong> {preFilledData.smartPreFill.loanTerm} years
                      </div>
                    </div>
                    <p className="text-xs text-green-600 mt-2">
                      ✅ All values can be adjusted below. Review and modify as needed for your specific situation.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Comprehensive Business Input */}
              <div className="lg:col-span-2 space-y-6">
                {/* Loan Details */}
                <div className="bg-white rounded-xl p-6 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                    💳 Loan Details
                  </h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Loan Amount (UGX)</label>
                      <input
                        type="number"
                        value={loanAmount}
                        onChange={(e) => setLoanAmount(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="10,000,000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Interest Rate (% p.a.)</label>
                      <input
                        type="number"
                        value={interestRate}
                        onChange={(e) => setInterestRate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="18"
                        step="0.1"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Loan Term (Years)</label>
                      <input
                        type="number"
                        value={loanTerm}
                        onChange={(e) => setLoanTerm(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="3"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Loan Purpose</label>
                      <select
                        value={loanPurpose}
                        onChange={(e) => setLoanPurpose(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="business-expansion">Business Expansion</option>
                        <option value="equipment">Equipment Purchase</option>
                        <option value="inventory">Inventory Financing</option>
                        <option value="working-capital">Working Capital</option>
                        <option value="real-estate">Real Estate Investment</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Business Revenue & Expenses */}
                <div className="bg-white rounded-xl p-6 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                    📊 Business Financials (Monthly)
                  </h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-4">
                      <h4 className="font-medium text-green-700 flex items-center gap-1">💰 Revenue</h4>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Gross Monthly Revenue (UGX)</label>
                        <input
                          type="number"
                          value={monthlyRevenue}
                          onChange={(e) => setMonthlyRevenue(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          placeholder="5,000,000"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Business Type</label>
                        <select
                          value={businessType}
                          onChange={(e) => setBusinessType(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="retail">Retail Business</option>
                          <option value="manufacturing">Manufacturing</option>
                          <option value="services">Service Business</option>
                          <option value="technology">Technology/IT</option>
                          <option value="agriculture">Agriculture</option>
                          <option value="hospitality">Hospitality</option>
                          <option value="construction">Construction</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-medium text-red-700 flex items-center gap-1">💸 Operating Expenses</h4>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">General Operating Expenses</label>
                        <input
                          type="number"
                          value={operatingExpenses}
                          onChange={(e) => setOperatingExpenses(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          placeholder="500,000"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Employee Salaries</label>
                        <input
                          type="number"
                          value={employeeSalaries}
                          onChange={(e) => setEmployeeSalaries(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          placeholder="800,000"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Rent & Utilities</label>
                        <input
                          type="number"
                          value={rentUtilities}
                          onChange={(e) => setRentUtilities(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          placeholder="300,000"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Marketing & Advertising</label>
                      <input
                        type="number"
                        value={marketingCosts}
                        onChange={(e) => setMarketingCosts(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="200,000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Inventory/Raw Materials</label>
                      <input
                        type="number"
                        value={inventoryCosts}
                        onChange={(e) => setInventoryCosts(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="1,500,000"
                      />
                    </div>
                  </div>
                </div>

                {/* Tax & Tithe Section */}
                <div className="bg-white rounded-xl p-6 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                    🏛️ Taxes & Tithes
                  </h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Corporate Tax Rate (%)</label>
                      <input
                        type="number"
                        value={currentTaxRate}
                        onChange={(e) => setCurrentTaxRate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="30"
                        step="0.1"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">VAT Rate (%)</label>
                      <input
                        type="number"
                        value={vatRate}
                        onChange={(e) => setVatRate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="18"
                        step="0.1"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">PAYE Deductions (Monthly)</label>
                      <input
                        type="number"
                        value={payeDeductions}
                        onChange={(e) => setPayeDeductions(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="100,000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Tithe Percentage (%)</label>
                      <input
                        type="number"
                        value={tithePercentage}
                        onChange={(e) => setTithePercentage(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="10"
                        step="0.1"
                      />
                    </div>
                  </div>
                  
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Existing Monthly Debt Payments</label>
                    <input
                      type="number"
                      value={existingDebts}
                      onChange={(e) => setExistingDebts(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="400,000"
                    />
                  </div>
                </div>
              </div>

              {/* Comprehensive Analysis */}
              <div className="space-y-4">
                {/* Loan Analysis */}
                <div className="bg-white rounded-xl p-4 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    � Loan Analysis
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Monthly Payment:</span>
                      <span className="font-semibold">UGX {(metrics.monthlyPayment || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Interest:</span>
                      <span className="font-semibold text-red-600">UGX {(metrics.totalInterest || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* Business Cash Flow */}
                <div className="bg-white rounded-xl p-4 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    💰 Business Cash Flow
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Gross Revenue:</span>
                      <span className="font-semibold text-green-600">UGX {((metrics.businessMetrics?.grossMonthlyRevenue) || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Expenses:</span>
                      <span className="font-semibold text-red-600">UGX {((metrics.businessMetrics?.totalMonthlyExpenses) || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Gross Profit:</span>
                      <span className="font-semibold">UGX {((metrics.businessMetrics?.grossProfit) || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between border-t pt-1">
                      <span className="text-gray-600">Net Cash Flow:</span>
                      <span className={`font-bold ${((metrics.businessMetrics?.monthlyNetCashFlow) || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        UGX {((metrics.businessMetrics?.monthlyNetCashFlow) || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tax & Tithe Breakdown */}
                <div className="bg-white rounded-xl p-4 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    🏛️ Tax & Tithe
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">VAT on Sales:</span>
                      <span className="font-semibold text-orange-600">UGX {((metrics.businessMetrics?.vatOnSales) || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Corporate Tax:</span>
                      <span className="font-semibold text-orange-600">UGX {((metrics.businessMetrics?.corporateTax) || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Taxes:</span>
                      <span className="font-semibold text-orange-600">UGX {((metrics.businessMetrics?.totalTaxes) || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between border-t pt-1">
                      <span className="text-gray-600">Monthly Tithe:</span>
                      <span className="font-bold text-purple-600">UGX {((metrics.businessMetrics?.titheAmount) || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* Risk Metrics */}
                <div className="bg-white rounded-xl p-4 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    ⚡ Risk Analysis
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Debt Service Ratio:</span>
                      <span className={`font-semibold ${((metrics.businessMetrics?.debtServiceRatio) || 0) > 30 ? 'text-red-600' : 'text-green-600'}`}>
                        {((metrics.businessMetrics?.debtServiceRatio) || 0).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Profit Margin:</span>
                      <span className={`font-semibold ${((metrics.businessMetrics?.profitMargin) || 0) < 5 ? 'text-red-600' : 'text-green-600'}`}>
                        {((metrics.businessMetrics?.profitMargin) || 0).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between border-t pt-1">
                      <span className="text-gray-600">Break-even Revenue:</span>
                      <span className="font-semibold">UGX {((metrics.businessMetrics?.breakEvenRevenue) || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className={`p-6 rounded-xl border-2 ${
                  advice.color === 'green' ? 'bg-green-50 border-green-200' :
                  advice.color === 'yellow' ? 'bg-yellow-50 border-yellow-200' :
                  advice.color === 'red' ? 'bg-red-50 border-red-200' :
                  'bg-gray-50 border-gray-200'
                }`}>
                  <div className={`text-xl font-bold mb-2 ${
                    advice.color === 'green' ? 'text-green-800' :
                    advice.color === 'yellow' ? 'text-yellow-800' :
                    advice.color === 'red' ? 'text-red-800' :
                    'text-gray-800'
                  }`}>
                    {advice.decision}
                  </div>
                  <p className="text-sm mb-2">{advice.message}</p>
                  {advice.advice && <p className="text-sm font-medium">{advice.advice}</p>}
                </div>

                {metrics.isWorthwhile && advice.color === 'green' && (
                  <button
                    onClick={() => {
                      onAddLoan({
                        amount: parseFloat(loanAmount),
                        interestRate: parseFloat(interestRate),
                        term: parseFloat(loanTerm),
                        purpose: loanPurpose,
                        monthlyPayment: metrics.monthlyPayment,
                        date: new Date().toISOString().split('T')[0]
                      });
                      onClose();
                    }}
                    className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                  >
                    💼 Add This Loan to Portfolio
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // � BUSINESS TITHING CALCULATOR (Separate Business & Personal)
  const BusinessTithingCalculator = ({ transactions, isOpen, onClose, onAddTithingTransaction }) => {
    const [businessTithingRate, setBusinessTithingRate] = useState(10); // Business tithe %
    const [personalTithingRate, setPersonalTithingRate] = useState(10); // Personal tithe %
    const [showBiblicalContext, setShowBiblicalContext] = useState(true);
    const [activeTab, setActiveTab] = useState('business'); // 'business' or 'personal'
    const [businessExpenseCategories] = useState([
      'rent', 'utilities', 'inventory', 'marketing', 'equipment', 'supplies', 
      'insurance', 'professional-services', 'travel', 'maintenance', 'licenses'
    ]);

    // Calculate separate business and personal tithing metrics
    const calculateBusinessTithingMetrics = () => {
      // Safe handling of transactions array
      const safeTransactions = transactions || [];
      
      // BUSINESS TRANSACTIONS
      const businessRevenue = safeTransactions.filter(t => 
        (t.type === 'income' || t.amount > 0) && 
        (t.category === 'business' || t.category === 'sales' || t.category === 'revenue' || t.category === 'business-income')
      );
      
      const businessExpenses = safeTransactions.filter(t => 
        (t.type === 'expense' || t.amount < 0) && 
        (businessExpenseCategories.includes(t.category) || t.category === 'business' || t.category === 'business-expense')
      );
      
      // PERSONAL TRANSACTIONS  
      const personalIncome = safeTransactions.filter(t => 
        (t.type === 'income' || t.amount > 0) && 
        !['business', 'sales', 'revenue', 'business-income'].includes(t.category) &&
        (t.category === 'salary' || t.category === 'investment' || t.category === 'other-income')
      );

      // BUSINESS CALCULATIONS
      const totalBusinessRevenue = businessRevenue.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
      const totalBusinessExpenses = businessExpenses.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
      const businessProfit = Math.max(0, totalBusinessRevenue - totalBusinessExpenses); // Only positive profits
      
      // PERSONAL CALCULATIONS
      const totalPersonalIncome = personalIncome.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
      
      // SEPARATE TITHING CALCULATIONS
      const businessTithingTransactions = safeTransactions.filter(t => 
        (t.description || '').toLowerCase().includes('business tithe') || 
        (t.description || '').toLowerCase().includes('business offering') ||
        (t.category || '').toLowerCase().includes('business-giving')
      );
      
      const personalTithingTransactions = safeTransactions.filter(t => 
        ((t.description || '').toLowerCase().includes('tithe') || 
        (t.description || '').toLowerCase().includes('offering') ||
        (t.description || '').toLowerCase().includes('church') ||
        (t.category || '').toLowerCase().includes('giving')) &&
        !(t.description || '').toLowerCase().includes('business')
      );
      
      const totalBusinessTithed = businessTithingTransactions.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
      const totalPersonalTithed = personalTithingTransactions.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
      
      const requiredBusinessTithe = (businessProfit * businessTithingRate) / 100;
      const requiredPersonalTithe = (totalPersonalIncome * personalTithingRate) / 100;
      
      const businessTithingRate_actual = businessProfit > 0 ? (totalBusinessTithed / businessProfit) * 100 : 0;
      const personalTithingRate_actual = totalPersonalIncome > 0 ? (totalPersonalTithed / totalPersonalIncome) * 100 : 0;      return {
        // Business Metrics
        business: {
          totalRevenue: totalBusinessRevenue,
          totalExpenses: totalBusinessExpenses,
          profit: businessProfit,
          profitMargin: totalBusinessRevenue > 0 ? (businessProfit / totalBusinessRevenue) * 100 : 0,
          tithed: totalBusinessTithed,
          requiredTithe: requiredBusinessTithe,
          tithingRate: businessTithingRate_actual,
          shortage: Math.max(0, requiredBusinessTithe - totalBusinessTithed),
          surplus: Math.max(0, totalBusinessTithed - requiredBusinessTithe),
          faithfulnessScore: Math.min(100, (businessTithingRate_actual / businessTithingRate) * 100),
          recentTransactions: businessRevenue.slice(-3)
        },
        // Personal Metrics
        personal: {
          totalIncome: totalPersonalIncome,
          tithed: totalPersonalTithed,
          requiredTithe: requiredPersonalTithe,
          tithingRate: personalTithingRate_actual,
          shortage: Math.max(0, requiredPersonalTithe - totalPersonalTithed),
          surplus: Math.max(0, totalPersonalTithed - requiredPersonalTithe),
          faithfulnessScore: Math.min(100, (personalTithingRate_actual / personalTithingRate) * 100),
          recentTransactions: personalIncome.slice(-3)
        },
        // Combined Metrics
        combined: {
          totalTithed: totalBusinessTithed + totalPersonalTithed,
          totalRequired: requiredBusinessTithe + requiredPersonalTithe,
          overallFaithfulness: ((totalBusinessTithed + totalPersonalTithed) / (requiredBusinessTithe + requiredPersonalTithe)) * 100 || 0
        }
      };
    };

    const metrics = calculateBusinessTithingMetrics();



    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
          <div className="p-6">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
                  � Business Tithing Manager
                </h2>
                <p className="text-gray-600 mt-1">
                  Separate business and personal tithing - Honor God in both spheres
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            {/* Business vs Personal Tabs */}
            <div className="mb-6">
              <div className="flex bg-gray-100 rounded-xl p-1">
                <button
                  onClick={() => setActiveTab('business')}
                  className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-colors ${
                    activeTab === 'business'
                      ? 'bg-indigo-600 text-white shadow-lg'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  💼 Business Tithing
                </button>
                <button
                  onClick={() => setActiveTab('personal')}
                  className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-colors ${
                    activeTab === 'personal'
                      ? 'bg-green-600 text-white shadow-lg'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  👤 Personal Tithing
                </button>
              </div>
            </div>

            {/* Business Tithing Tab */}
            {activeTab === 'business' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="bg-white rounded-xl p-6 shadow-lg border-l-4 border-blue-500">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">📊 Business Revenue</h3>
                    <p className="text-2xl font-bold text-blue-600">
                      UGX {metrics.business.totalRevenue.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Gross business income</p>
                  </div>

                  <div className="bg-white rounded-xl p-6 shadow-lg border-l-4 border-red-500">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">📉 Business Expenses</h3>
                    <p className="text-2xl font-bold text-red-600">
                      UGX {metrics.business.totalExpenses.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Operating costs</p>
                  </div>

                  <div className="bg-white rounded-xl p-6 shadow-lg border-l-4 border-green-500">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">� Business Profit</h3>
                    <p className="text-2xl font-bold text-green-600">
                      UGX {metrics.business.profit.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      {(metrics.business.profitMargin || 0).toFixed(1)}% margin
                    </p>
                  </div>

                  <div className="bg-white rounded-xl p-6 shadow-lg border-l-4 border-purple-500">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">🙏 Business Tithe Due</h3>
                    <p className="text-2xl font-bold text-purple-600">
                      UGX {metrics.business.requiredTithe.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">{businessTithingRate}% of profits</p>
                  </div>
                </div>

                {/* Business Tithing Progress */}
                <div className="bg-white rounded-xl p-6 shadow-lg">
                  <h3 className="text-xl font-semibold text-gray-800 mb-4">💼 Business Faithfulness Score</h3>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex-1 bg-gray-200 rounded-full h-6">
                      <div 
                        className={`h-6 rounded-full ${
                          metrics.business.faithfulnessScore >= 100 ? 'bg-gradient-to-r from-green-400 to-green-600' :
                          metrics.business.faithfulnessScore >= 80 ? 'bg-gradient-to-r from-blue-400 to-blue-600' :
                          metrics.business.faithfulnessScore >= 50 ? 'bg-gradient-to-r from-yellow-400 to-yellow-600' :
                          'bg-gradient-to-r from-red-400 to-red-600'
                        }`}
                        style={{ width: `${Math.min(100, metrics.business.faithfulnessScore)}%` }}
                      ></div>
                    </div>
                    <span className="text-3xl font-bold text-gray-800">{(metrics.business.faithfulnessScore || 0).toFixed(0)}%</span>
                  </div>
                  
                  <div className="grid md:grid-cols-3 gap-4 mt-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-green-600">UGX {metrics.business.tithed.toLocaleString()}</p>
                      <p className="text-sm text-gray-500">Already Tithed</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-blue-600">UGX {metrics.business.requiredTithe.toLocaleString()}</p>
                      <p className="text-sm text-gray-500">Required (Business)</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-2xl font-bold ${metrics.business.shortage > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                        UGX {Math.max(metrics.business.shortage, metrics.business.surplus).toLocaleString()}
                      </p>
                      <p className="text-sm text-gray-500">{metrics.business.shortage > 0 ? 'Remaining' : 'Surplus'}</p>
                    </div>
                  </div>

                  {metrics.business.shortage > 0 && (
                    <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-yellow-800 font-semibold mb-2">💡 Business Tithing Opportunity</p>
                      <p className="text-yellow-700 mb-3">
                        Consider tithing UGX {metrics.business.shortage.toLocaleString()} from your business profits to honor God in your business.
                      </p>
                      <button 
                        onClick={() => onAddTithingTransaction({
                          type: 'business',
                          amount: metrics.business.shortage,
                          description: 'Business Tithe - 10% of Profits'
                        })}
                        className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors"
                      >
                        💼 Pay Business Tithe Now
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Personal Tithing Tab */}
            {activeTab === 'personal' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white rounded-xl p-6 shadow-lg border-l-4 border-green-500">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">💰 Personal Income</h3>
                    <p className="text-2xl font-bold text-green-600">
                      UGX {metrics.personal.totalIncome.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Salary & other income</p>
                  </div>

                  <div className="bg-white rounded-xl p-6 shadow-lg border-l-4 border-blue-500">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">🙏 Personal Tithe Due</h3>
                    <p className="text-2xl font-bold text-blue-600">
                      UGX {metrics.personal.requiredTithe.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">{personalTithingRate}% of income</p>
                  </div>

                  <div className="bg-white rounded-xl p-6 shadow-lg border-l-4 border-purple-500">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">🎁 Personal Given</h3>
                    <p className="text-2xl font-bold text-purple-600">
                      UGX {metrics.personal.tithed.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">{(metrics.personal.tithingRate || 0).toFixed(1)}% rate</p>
                  </div>
                </div>

                {/* Personal Tithing Progress */}
                <div className="bg-white rounded-xl p-6 shadow-lg">
                  <h3 className="text-xl font-semibold text-gray-800 mb-4">👤 Personal Faithfulness Score</h3>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex-1 bg-gray-200 rounded-full h-6">
                      <div 
                        className={`h-6 rounded-full ${
                          metrics.personal.faithfulnessScore >= 100 ? 'bg-gradient-to-r from-green-400 to-green-600' :
                          metrics.personal.faithfulnessScore >= 80 ? 'bg-gradient-to-r from-blue-400 to-blue-600' :
                          metrics.personal.faithfulnessScore >= 50 ? 'bg-gradient-to-r from-yellow-400 to-yellow-600' :
                          'bg-gradient-to-r from-red-400 to-red-600'
                        }`}
                        style={{ width: `${Math.min(100, metrics.personal.faithfulnessScore)}%` }}
                      ></div>
                    </div>
                    <span className="text-3xl font-bold text-gray-800">{(metrics.personal.faithfulnessScore || 0).toFixed(0)}%</span>
                  </div>

                  {metrics.personal.shortage > 0 && (
                    <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-blue-800 font-semibold mb-2">💝 Personal Tithing Opportunity</p>
                      <p className="text-blue-700 mb-3">
                        Consider tithing UGX {metrics.personal.shortage.toLocaleString()} from your personal income.
                      </p>
                      <button 
                        onClick={() => onAddTithingTransaction({
                          type: 'personal',
                          amount: metrics.personal.shortage,
                          description: 'Personal Tithe - 10% of Income'
                        })}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        👤 Pay Personal Tithe Now
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}



            {/* Settings */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">⚙️ Tithing Settings</h3>
              
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Business Tithing Rate</label>
                  <select 
                    value={businessTithingRate} 
                    onChange={(e) => setBusinessTithingRate(Number(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value={5}>5% (Conservative Business)</option>
                    <option value={10}>10% (Biblical Standard)</option>
                    <option value={15}>15% (Generous Business)</option>
                    <option value={20}>20% (Abundant Blessing)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Percentage of business profits</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Personal Tithing Rate</label>
                  <select 
                    value={personalTithingRate} 
                    onChange={(e) => setPersonalTithingRate(Number(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value={5}>5% (Growing in Faith)</option>
                    <option value={10}>10% (Biblical Standard)</option>
                    <option value={15}>15% (Generous Giver)</option>
                    <option value={20}>20% (Abundant Blessing)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Percentage of personal income</p>
                </div>
              </div>

              <div className="flex justify-between items-center mt-4">
                <div className="text-sm text-gray-600">
                  💡 <strong>Business Tip:</strong> Tithing on profits (not gross revenue) is biblically sound and business smart
                </div>
                
                <button
                  onClick={() => setShowBiblicalContext(!showBiblicalContext)}
                  className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
                >
                  {showBiblicalContext ? '📖 Hide' : '📖 Show'} Biblical Context
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // 📊 COMPREHENSIVE REPORTING SYSTEM
  // 📊 ADVANCED REPORTING SYSTEM with Real-time Data & Gmail Integration
  const AdvancedReportingSystem = ({ transactions, isOpen, onClose, netWorth }) => {
    const [selectedReportType, setSelectedReportType] = useState('financial-summary');
    const [dateRange, setDateRange] = useState('current-month');
    const [exportFormat, setExportFormat] = useState('pdf');
    const [customDateStart, setCustomDateStart] = useState('');
    const [customDateEnd, setCustomDateEnd] = useState('');
    const [includeCategories, setIncludeCategories] = useState([]);
    const [reportTitle, setReportTitle] = useState('ICAN Financial Report');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedReport, setGeneratedReport] = useState(null);
    
    // 📧 GMAIL INTEGRATION STATE
    const [emailSettings, setEmailSettings] = useState({
      recipient: '',
      subject: 'ICAN Financial Report',
      message: 'Please find attached your comprehensive financial report generated by ICAN Capital Engine.',
      schedule: 'manual', // manual, daily, weekly, monthly
      autoSend: false
    });
    const [showEmailModal, setShowEmailModal] = useState(false);
    const [emailStatus, setEmailStatus] = useState('');
    
    // 🔄 REAL-TIME DATA STATE
    const [realTimeData, setRealTimeData] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [cachedReportData, setCachedReportData] = useState(null);

    // 📋 COMPREHENSIVE REPORT TYPES with Real-time Analytics
    const reportTypes = {
      'financial-summary': {
        name: '📊 Executive Financial Summary',
        description: 'Complete overview with KPIs, trends, and executive insights',
        icon: '📊',
        features: ['Real-time net worth', 'Trend analysis', 'Performance metrics', 'Executive dashboard']
      },
      'income-analysis': {
        name: '💰 Income Intelligence Report',
        description: 'AI-powered income analysis with growth projections',
        icon: '💰',
        features: ['Income streams', 'Growth trends', 'Seasonality analysis', 'Forecasting']
      },
      'expense-breakdown': {
        name: '💸 Smart Expense Analytics',
        description: 'Categorized expenses with spending optimization insights',
        icon: '💸',
        features: ['Category breakdowns', 'Spending patterns', 'Budget variance', 'Cost optimization']
      },
      'cash-flow': {
        name: '🔄 Advanced Cash Flow Statement',
        description: 'Professional cash flow with liquidity and working capital analysis',
        icon: '🔄',
        features: ['Monthly cash flows', 'Liquidity ratios', 'Working capital', 'Cash conversion cycle']
      },
      'tithe-report': {
        name: '⛪ Stewardship & Giving Report',
        description: 'Biblical giving analysis with stewardship insights',
        icon: '⛪',
        features: ['Tithe tracking', 'Giving percentage', 'Biblical compliance', 'Blessing analysis']
      },
      'loan-analysis': {
        name: '🏦 Comprehensive Loan Portfolio',
        description: 'Debt analysis with risk assessment and optimization strategies',
        icon: '🏦',
        features: ['Loan portfolio', 'Debt-to-income ratios', 'Payment schedules', 'Risk analysis']
      },
      'business-performance': {
        name: '📈 Business Intelligence Report',
        description: 'Enterprise-grade business analytics with profitability analysis',
        icon: '📈',
        features: ['Revenue analysis', 'Profit margins', 'Business KPIs', 'Growth metrics']
      },
      'tax-preparation': {
        name: '🧾 Tax-Ready Financial Statements',
        description: 'URA-compliant financial statements with tax optimization',
        icon: '🧾',
        features: ['Tax categories', 'Deductions', 'URA compliance', 'Tax optimization']
      },
      'wealth-journey': {
        name: '🚀 ICAN Wealth Journey Analytics',
        description: 'Personalized wealth-building progress with milestone tracking',
        icon: '🚀',
        features: ['Wealth milestones', 'Progress tracking', 'Goal analysis', 'Journey insights']
      },
      'investment-analysis': {
        name: '📊 Investment Portfolio Report',
        description: 'Investment performance with ROI analysis and recommendations',
        icon: '📊',
        features: ['Portfolio performance', 'ROI analysis', 'Asset allocation', 'Investment insights']
      },
      'real-estate': {
        name: '🏠 Real Estate Portfolio',
        description: 'Property investments with valuation and rental income analysis',
        icon: '🏠',
        features: ['Property portfolio', 'Rental income', 'Property values', 'Real estate ROI']
      },
      'custom-analysis': {
        name: '🔧 AI-Powered Custom Analysis',
        description: 'Personalized insights with AI recommendations and custom metrics',
        icon: '🔧',
        features: ['Custom KPIs', 'AI insights', 'Personal recommendations', 'Flexible metrics']
      }
    };

    // 📤 ENHANCED EXPORT FORMATS with Professional Features
    const exportFormats = {
      'pdf': { 
        name: 'Executive PDF Report', 
        icon: '📄', 
        description: 'Professional PDF with charts, graphs, and executive summary',
        features: ['Charts & graphs', 'Executive summary', 'Professional layout', 'Print-ready']
      },
      'excel': { 
        name: 'Interactive Excel Workbook', 
        icon: '📊', 
        description: 'Multi-sheet workbook with formulas, pivot tables, and charts',
        features: ['Multiple worksheets', 'Formulas & calculations', 'Pivot tables', 'Interactive charts']
      },
      'powerpoint': {
        name: 'PowerPoint Presentation',
        icon: '🎯',
        description: 'Executive presentation with key insights and visual analytics',
        features: ['Executive slides', 'Visual charts', 'Key insights', 'Presentation-ready']
      },
      'csv': { 
        name: 'CSV Data Export', 
        icon: '📋', 
        description: 'Raw transaction data for external analysis tools',
        features: ['Raw data', 'Import-friendly', 'Analysis tools compatible', 'Lightweight']
      },
      'json': { 
        name: 'JSON API Format', 
        icon: '💾', 
        description: 'Structured data for integration with other systems',
        features: ['API integration', 'Structured format', 'Developer-friendly', 'System integration']
      },
      'html': { 
        name: 'Interactive Web Report', 
        icon: '🌐', 
        description: 'Web-based report with interactive charts and drill-down capabilities',
        features: ['Interactive charts', 'Drill-down data', 'Web sharing', 'Mobile responsive']
      },
      'email-pdf': {
        name: 'Email PDF Report',
        icon: '📧',
        description: 'PDF report automatically sent via Gmail with personalized message',
        features: ['Auto email delivery', 'Gmail integration', 'Personalized message', 'Schedule options']
      }
    };

    const dateRanges = {
      'current-month': 'Current Month',
      'last-month': 'Last Month',
      'last-3-months': 'Last 3 Months',
      'last-6-months': 'Last 6 Months',
      'current-year': 'Current Year',
      'last-year': 'Last Year',
      'all-time': 'All Time',
      'custom': 'Custom Date Range'
    };

    const getFilteredTransactions = () => {
      let filtered = [...transactions];
      
      // Apply date filter
      if (dateRange !== 'all-time') {
        const now = new Date();
        let startDate, endDate;
        
        switch (dateRange) {
          case 'current-month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            break;
          case 'last-month':
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), 0);
            break;
          case 'last-3-months':
            startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            endDate = now;
            break;
          case 'last-6-months':
            startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
            endDate = now;
            break;
          case 'current-year':
            startDate = new Date(now.getFullYear(), 0, 1);
            endDate = now;
            break;
          case 'last-year':
            startDate = new Date(now.getFullYear() - 1, 0, 1);
            endDate = new Date(now.getFullYear() - 1, 11, 31);
            break;
          case 'custom':
            if (customDateStart && customDateEnd) {
              startDate = new Date(customDateStart);
              endDate = new Date(customDateEnd);
            }
            break;
        }
        
        if (startDate && endDate) {
          filtered = filtered.filter(t => {
            const transactionDate = new Date(t.date);
            return transactionDate >= startDate && transactionDate <= endDate;
          });
        }
      }
      
      // Apply category filter
      if (includeCategories.length > 0) {
        filtered = filtered.filter(t => includeCategories.includes(t.category));
      }
      
      return filtered;
    };

    // 💰 LOAN PAYMENT ESTIMATION UTILITY
    const estimateMonthlyLoanPayments = (loans) => {
      if (!loans || loans.length === 0) return 0;
      
      return loans.reduce((total, loan) => {
        // Standard estimation: 2-5% of loan amount per month depending on terms
        const estimatedRate = 0.03; // 3% monthly as reasonable default
        const monthlyPayment = Math.abs(loan.amount) * estimatedRate;
        return total + monthlyPayment;
      }, 0);
    };

    // 📊 FINANCIAL HEALTH SCORE CALCULATOR
    const calculateFinancialHealthScore = (income, expenses, loans, netWorth) => {
      let score = 50; // Base score
      
      // Income stability (30 points max)
      if (income > 0) score += 20;
      if (income > expenses) score += 10;
      
      // Expense management (25 points max)  
      const expenseRatio = income > 0 ? (expenses / income) : 1;
      if (expenseRatio < 0.5) score += 25;
      else if (expenseRatio < 0.7) score += 15;
      else if (expenseRatio < 0.9) score += 5;
      
      // Debt management (25 points max)
      const debtRatio = income > 0 ? (Math.abs(loans) / income) : 0;
      if (debtRatio === 0) score += 25;
      else if (debtRatio < 0.2) score += 20;
      else if (debtRatio < 0.4) score += 10;
      else if (debtRatio < 0.6) score += 5;
      
      // Net worth (20 points max)
      if (netWorth > 0) score += 10;
      if (netWorth > income * 2) score += 10;
      
      return Math.min(100, Math.max(0, score));
    };

    // 💼 BUSINESS METRICS CALCULATOR
    const calculateBusinessMetrics = (transactions) => {
      const businessTransactions = transactions.filter(t => 
        t.category?.includes('business') || 
        t.description?.toLowerCase().includes('business')
      );
      
      const businessIncome = businessTransactions.filter(t => t.type === 'income');
      const businessExpenses = businessTransactions.filter(t => t.type === 'expense');
      
      const revenue = businessIncome.reduce((sum, t) => sum + t.amount, 0);
      const costs = businessExpenses.reduce((sum, t) => sum + t.amount, 0);
      const profit = revenue - costs;
      const margin = revenue > 0 ? (profit / revenue * 100) : 0;
      
      return {
        revenue,
        costs,
        profit,
        margin,
        roi: costs > 0 ? (profit / costs * 100) : 0,
        transactionCount: businessTransactions.length
      };
    };

    // 🔮 FORECAST GENERATOR
    const generateForecasts = (monthlyData, months = 6) => {
      const monthKeys = Object.keys(monthlyData).sort();
      if (monthKeys.length < 3) {
        return {
          income: Array(months).fill(0),
          expenses: Array(months).fill(0),
          netFlow: Array(months).fill(0)
        };
      }
      
      const recentMonths = monthKeys.slice(-3);
      const avgIncome = recentMonths.reduce((sum, month) => sum + monthlyData[month].income, 0) / 3;
      const avgExpenses = recentMonths.reduce((sum, month) => sum + monthlyData[month].expenses, 0) / 3;
      
      return {
        income: Array(months).fill(avgIncome),
        expenses: Array(months).fill(avgExpenses),
        netFlow: Array(months).fill(avgIncome - avgExpenses)
      };
    };

    // 📈 GROWTH TREND CALCULATOR
    const calculateGrowthTrend = (monthlyData, type) => {
      const months = Object.keys(monthlyData).sort();
      if (months.length < 2) return { trend: 'insufficient_data', rate: 0 };
      
      const recent = monthlyData[months[months.length - 1]][type] || 0;
      const previous = monthlyData[months[months.length - 2]][type] || 0;
      
      if (previous === 0) return { trend: 'new', rate: 0 };
      
      const growthRate = ((recent - previous) / previous) * 100;
      let trend = 'stable';
      
      if (growthRate > 10) trend = 'strong_growth';
      else if (growthRate > 2) trend = 'growth';
      else if (growthRate < -10) trend = 'decline';
      else if (growthRate < -2) trend = 'weak_decline';
      
      return { trend, rate: growthRate };
    };

    // 🧠 REAL-TIME DATA ANALYSIS with Advanced Analytics
    const generateRealTimeReportData = () => {
      const filteredTransactions = getFilteredTransactions();
      const now = new Date();
      
      // Simplified intelligence analysis (inline to avoid scope issues)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentTransactions = filteredTransactions.filter(t => new Date(t.date) > thirtyDaysAgo);
      const monthlyIncome = recentTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
      const monthlyExpenses = recentTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
      const monthlyNetFlow = monthlyIncome - monthlyExpenses;
      
      const intelligence = {
        netWorthTrend: monthlyNetFlow > 0 ? 'positive' : 'negative',
        financialHealth: monthlyNetFlow > monthlyExpenses * 0.2 ? 'excellent' : 'moderate',
        riskLevel: monthlyExpenses > monthlyIncome ? 'high' : 'low'
      };
      
      // 📊 BASIC TRANSACTION ANALYSIS
      const income = filteredTransactions.filter(t => t.type === 'income');
      const expenses = filteredTransactions.filter(t => t.type === 'expense');
      const loans = filteredTransactions.filter(t => t.type === 'loan');
      
      const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);
      const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);
      const totalLoans = loans.reduce((sum, t) => sum + t.amount, 0);
      
      // 📈 ADVANCED CATEGORY ANALYSIS
      const incomeByCategory = {};
      const expensesByCategory = {};
      const monthlyTrends = {};
      
      income.forEach(t => {
        incomeByCategory[t.category] = (incomeByCategory[t.category] || 0) + t.amount;
      });
      
      expenses.forEach(t => {
        expensesByCategory[t.category] = (expensesByCategory[t.category] || 0) + t.amount;
      });
      
      // 📊 ENHANCED MONTHLY TREND ANALYSIS
      filteredTransactions.forEach(t => {
        const monthKey = new Date(t.date).toISOString().slice(0, 7);
        if (!monthlyTrends[monthKey]) {
          monthlyTrends[monthKey] = { 
            income: 0, 
            expenses: 0, 
            loans: 0, 
            netFlow: 0,
            transactionCount: 0 
          };
        }
        monthlyTrends[monthKey][t.type === 'loan' ? 'loans' : t.type === 'income' ? 'income' : 'expenses'] += t.amount;
        monthlyTrends[monthKey].transactionCount++;
      });
      
      // Calculate net flow for each month
      Object.keys(monthlyTrends).forEach(month => {
        monthlyTrends[month].netFlow = monthlyTrends[month].income - monthlyTrends[month].expenses;
      });
      
      // ⛪ ENHANCED TITHE & STEWARDSHIP ANALYSIS
      const titheTransactions = expenses.filter(t => 
        t.category === 'religious' || 
        t.description?.toLowerCase().includes('tithe') || 
        t.description?.toLowerCase().includes('offering') ||
        t.description?.toLowerCase().includes('church') ||
        t.description?.toLowerCase().includes('donation')
      );
      const totalTithe = titheTransactions.reduce((sum, t) => sum + t.amount, 0);
      const titheRate = totalIncome > 0 ? (totalTithe / totalIncome) * 100 : 0;
      const biblicalTarget = totalIncome * 0.10;
      const titheCompliance = titheRate >= 10;
      
      // 💡 ADVANCED FINANCIAL INSIGHTS & KPIs
      const financialKPIs = {
        savingsRate: totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome * 100) : 0,
        expenseRatio: totalIncome > 0 ? (totalExpenses / totalIncome * 100) : 0,
        debtToIncomeRatio: totalIncome > 0 ? (totalLoans / totalIncome * 100) : 0,
        wealthGrowthRate: intelligence.growthRate || 0,
        liquidityRatio: netWorth > 0 ? ((totalIncome - totalExpenses) / netWorth * 100) : 0,
        financialHealthScore: calculateFinancialHealthScore(totalIncome, totalExpenses, totalLoans, netWorth)
      };
      
      // 🎯 BUSINESS PERFORMANCE METRICS (if applicable)
      const businessMetrics = calculateBusinessMetrics(filteredTransactions);
      
      // 🔮 FORECASTING & PROJECTIONS
      const forecasts = generateForecasts(monthlyTrends, 6); // 6-month projection
      
      return {
        // 📊 EXECUTIVE SUMMARY with real-time intelligence
        summary: {
          totalIncome,
          totalExpenses,
          totalLoans,
          netCashFlow: totalIncome - totalExpenses,
          netWorth: (netWorth || (totalIncome - totalExpenses)),
          transactionCount: filteredTransactions.length,
          reportPeriod: dateRange,
          generatedAt: now.toISOString(),
          lastUpdated: lastUpdated.toISOString(),
          intelligence: {
            netWorthTrend: intelligence.netWorthTrend,
            monthlyNetFlow: intelligence.monthlyNetFlow,
            growthRate: intelligence.growthRate,
            financialHealthScore: financialKPIs.financialHealthScore
          }
        },
        
        // 💰 ENHANCED INCOME ANALYSIS
        income: {
          total: totalIncome,
          byCategory: incomeByCategory,
          transactions: income,
          averageMonthly: totalIncome / Math.max(Object.keys(monthlyTrends).length, 1),
          largestSource: Object.entries(incomeByCategory).sort((a, b) => b[1] - a[1])[0],
          growthTrend: calculateGrowthTrend(monthlyTrends, 'income')
        },
        
        // 💸 ENHANCED EXPENSE ANALYSIS
        expenses: {
          total: totalExpenses,
          byCategory: expensesByCategory,
          transactions: expenses,
          averageMonthly: totalExpenses / Math.max(Object.keys(monthlyTrends).length, 1),
          largestExpense: Object.entries(expensesByCategory).sort((a, b) => b[1] - a[1])[0],
          spendingTrend: calculateGrowthTrend(monthlyTrends, 'expenses')
        },
        
        // 🏦 LOAN PORTFOLIO ANALYSIS
        loans: {
          total: totalLoans,
          transactions: loans,
          count: loans.length,
          averageLoanSize: loans.length > 0 ? totalLoans / loans.length : 0,
          monthlyPaymentEstimate: estimateMonthlyLoanPayments(loans)
        },
        
        // ⛪ COMPREHENSIVE TITHE & STEWARDSHIP
        tithe: {
          total: totalTithe,
          rate: titheRate,
          transactions: titheTransactions,
          biblicalTarget,
          compliance: titheCompliance,
          surplus: titheCompliance ? totalTithe - biblicalTarget : 0,
          deficit: !titheCompliance ? biblicalTarget - totalTithe : 0,
          blessingMultiplier: calculateBlessingMultiplier(titheRate)
        },
        
        // 📈 ADVANCED TREND ANALYSIS
        trends: {
          monthly: monthlyTrends,
          quarterly: aggregateQuarterly(monthlyTrends),
          yearOverYear: calculateYearOverYear(monthlyTrends),
          seasonality: analyzeSeasonality(monthlyTrends)
        },
        
        // 💡 FINANCIAL KPIs & HEALTH METRICS
        kpis: financialKPIs,
        
        // 📊 BUSINESS ANALYTICS (if applicable)
        business: businessMetrics,
        
        // 🔮 FORECASTS & PROJECTIONS
        forecasts: forecasts,
        
        // 📋 METADATA & CONFIGURATION
        metadata: {
          reportType: selectedReportType,
          title: reportTitle,
          dateRange,
          customDates: dateRange === 'custom' ? { start: customDateStart, end: customDateEnd } : null,
          generationTime: (Date.now() - now.getTime()) + 'ms',
          dataFreshness: 'real-time',
          version: '2.0'
        }
      };
    };
    
    // 📊 QUARTERLY AGGREGATION from monthly data
    const aggregateQuarterly = (monthlyData) => {
      if (!monthlyData || !Array.isArray(monthlyData) || monthlyData.length === 0) return [];
      const quarters = {};
      monthlyData.forEach(month => {
        if (!month) return;
        const q = Math.ceil((new Date(month.month + '-01').getMonth() + 1) / 3);
        const year = month.month?.split('-')[0] || new Date().getFullYear();
        const key = `${year}-Q${q}`;
        if (!quarters[key]) {
          quarters[key] = { quarter: key, income: 0, expenses: 0, net: 0, months: 0 };
        }
        quarters[key].income += month.income || 0;
        quarters[key].expenses += month.expenses || 0;
        quarters[key].net += month.net || 0;
        quarters[key].months += 1;
      });
      return Object.values(quarters);
    };

    // 📈 YEAR OVER YEAR COMPARISON
    const calculateYearOverYear = (monthlyData) => {
      if (!monthlyData || !Array.isArray(monthlyData) || monthlyData.length < 12) {
        return { growth: 0, comparison: 'insufficient_data' };
      }
      const currentYear = monthlyData.slice(-12).reduce((sum, m) => sum + (m?.net || 0), 0);
      const previousYear = monthlyData.slice(-24, -12).reduce((sum, m) => sum + (m?.net || 0), 0);
      const growth = previousYear !== 0 ? ((currentYear - previousYear) / Math.abs(previousYear)) * 100 : 0;
      return { growth: growth.toFixed(2), comparison: growth > 0 ? 'improving' : growth < 0 ? 'declining' : 'stable' };
    };

    // 🌊 SEASONALITY ANALYSIS
    const analyzeSeasonality = (monthlyData) => {
      if (!monthlyData || !Array.isArray(monthlyData) || monthlyData.length === 0) {
        return { pattern: 'unknown', peaks: [], troughs: [] };
      }
      const byMonth = {};
      monthlyData.forEach(m => {
        if (!m) return;
        const monthNum = new Date(m.month + '-01').getMonth();
        if (!byMonth[monthNum]) byMonth[monthNum] = [];
        byMonth[monthNum].push(m.net || 0);
      });
      const avgByMonth = Object.entries(byMonth).map(([month, values]) => ({
        month: parseInt(month),
        avg: values.reduce((a, b) => a + b, 0) / values.length
      }));
      const sorted = [...avgByMonth].sort((a, b) => b.avg - a.avg);
      return {
        pattern: 'analyzed',
        peaks: sorted.slice(0, 3).map(m => m.month),
        troughs: sorted.slice(-3).map(m => m.month)
      };
    };

    // ⛪ TITHE BLESSING CALCULATOR
    const calculateBlessingMultiplier = (titheRate) => {
      // Biblical principle: faithful stewardship brings blessings
      if (titheRate >= 10) return 'faithful_steward';
      if (titheRate >= 5) return 'growing_steward';
      if (titheRate > 0) return 'beginning_steward';
      return 'opportunity_for_growth';
    };
    
    // 📥 REAL FILE DOWNLOAD UTILITY
    const downloadFile = (content, filename, mimeType) => {
      const blob = new Blob([content], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    };

    // 📊 CSV CONVERTER for Excel data
    const generateCSVFromExcel = (excelData) => {
      let csvContent = '';
      Object.keys(excelData.worksheets).forEach(sheetName => {
        csvContent += `\n=== ${sheetName} ===\n`;
        excelData.worksheets[sheetName].data.forEach(row => {
          csvContent += row.join(',') + '\n';
        });
      });
      return csvContent;
    };

    // Generate report data via useEffect to prevent setState in render
    React.useEffect(() => {
      try {
        const reportData = generateRealTimeReportData();
        setCachedReportData(reportData);
      } catch (error) {
        console.warn('Report generation error:', error);
        setCachedReportData({
          summary: { 
            totalIncome: 0, 
            totalExpenses: 0, 
            totalLoans: 0,
            netCashFlow: 0,
            netWorth: 0,
            transactionCount: 0,
            reportPeriod: dateRange,
            generatedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            intelligence: {
              netWorthTrend: 'neutral',
              monthlyNetFlow: 0,
              growthRate: 0,
              financialHealthScore: 0
            }
          },
          income: {
            total: 0,
            byCategory: {},
            transactions: [],
            averageMonthly: 0,
            largestSource: null,
            growthTrend: { trend: 'stable', rate: 0 }
          },
          expenses: {
            total: 0,
            byCategory: {},
            transactions: [],
            averageMonthly: 0,
            largestExpense: null,
            spendingTrend: { trend: 'stable', rate: 0 }
          },
          loans: { 
            total: 0,
            transactions: [],
            count: 0,
            averageLoanSize: 0,
            monthlyPaymentEstimate: 0 
          },
          tithe: {
            total: 0,
            rate: 0,
            transactions: [],
            biblicalTarget: 0,
            compliance: false,
            surplus: 0,
            deficit: 0
          },
          analysis: { 
            intelligence: { netWorthTrend: 'neutral' },
            kpis: {
              savingsRate: 0,
              expenseRatio: 0,
              debtToIncomeRatio: 0,
              financialHealthScore: 0
            },
            monthlyTrends: {},
            forecasts: {
              income: [0, 0, 0, 0, 0, 0],
              expenses: [0, 0, 0, 0, 0, 0],
              netFlow: [0, 0, 0, 0, 0, 0]
            }
          },
          metadata: {
            reportType: selectedReportType,
            title: reportTitle,
            generated: new Date().toISOString(),
            version: '1.0',
            filters: {
              dateRange,
              categories: includeCategories
            }
          }
        });
      }
    }, [transactions, selectedReportType, dateRange, customDateStart, customDateEnd, includeCategories]);
    
    // Getter function for report data with comprehensive fallback
    const getReportData = () => {
      return cachedReportData || {
        summary: { 
          totalIncome: 0, 
          totalExpenses: 0, 
          totalLoans: 0,
          netCashFlow: 0,
          netWorth: 0,
          transactionCount: 0,
          reportPeriod: dateRange,
          generatedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          intelligence: {
            netWorthTrend: 'neutral',
            monthlyNetFlow: 0,
            growthRate: 0,
            financialHealthScore: 0
          }
        },
        income: {
          total: 0,
          byCategory: {},
          transactions: [],
          averageMonthly: 0,
          largestSource: null,
          growthTrend: { trend: 'stable', rate: 0 }
        },
        expenses: {
          total: 0,
          byCategory: {},
          transactions: [],
          averageMonthly: 0,
          largestExpense: null,
          spendingTrend: { trend: 'stable', rate: 0 }
        },
        loans: { 
          total: 0,
          transactions: [],
          count: 0,
          averageLoanSize: 0,
          monthlyPaymentEstimate: 0 
        },
        tithe: {
          total: 0,
          rate: 0,
          transactions: [],
          biblicalTarget: 0,
          compliance: false,
          surplus: 0,
          deficit: 0
        },
        analysis: { 
          intelligence: { netWorthTrend: 'neutral' },
          kpis: {
            savingsRate: 0,
            expenseRatio: 0,
            debtToIncomeRatio: 0,
            financialHealthScore: 0
          },
          monthlyTrends: {},
          forecasts: {
            income: [0, 0, 0, 0, 0, 0],
            expenses: [0, 0, 0, 0, 0, 0],
            netFlow: [0, 0, 0, 0, 0, 0]
          }
        },
        metadata: {
          reportType: selectedReportType,
          title: reportTitle,
          generated: new Date().toISOString(),
          version: '1.0',
          filters: {
            dateRange,
            categories: includeCategories
          }
        }
      };
    };
    
    const generateReportData = getReportData();

    const generatePDFReport = async (data) => {
      // Real PDF generation with downloadable HTML content
      const reportContent = {
        title: data.metadata?.title || reportTitle,
        generated: new Date().toLocaleString(),
        summary: data.summary,
        details: data
      };
      
      // Create downloadable HTML that can be saved as PDF by browser
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>${reportContent.title}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
            .section { margin: 20px 0; }
            .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
            .summary-card { background: #f5f5f5; padding: 15px; border-radius: 8px; }
            .amount { font-size: 1.2em; font-weight: bold; color: #2563eb; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #f2f2f2; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${reportContent.title}</h1>
            <p>Generated: ${reportContent.generated}</p>
            <p>Period: ${data.metadata.dateRange}</p>
          </div>
          
          <div class="section">
            <h2>Financial Summary</h2>
            <div class="summary-grid">
              <div class="summary-card">
                <h3>💰 Total Income</h3>
                <p class="amount">UGX ${data.summary.totalIncome.toLocaleString()}</p>
              </div>
              <div class="summary-card">
                <h3>💸 Total Expenses</h3>
                <p class="amount">UGX ${data.summary.totalExpenses.toLocaleString()}</p>
              </div>
              <div class="summary-card">
                <h3>💵 Net Cash Flow</h3>
                <p class="amount">UGX ${data.summary.netCashFlow.toLocaleString()}</p>
              </div>
            </div>
          </div>
          
          <div class="section">
            <h2>Income by Category</h2>
            <table>
              <tr><th>Category</th><th>Amount</th><th>Percentage</th></tr>
              ${Object.entries(data.income.byCategory).map(([category, amount]) => `
                <tr>
                  <td>${category.replace(/_/g, ' ').toUpperCase()}</td>
                  <td>UGX ${amount.toLocaleString()}</td>
                  <td>${((amount / data.income.total) * 100).toFixed(1)}%</td>
                </tr>
              `).join('')}
            </table>
          </div>
          
          <div class="section">
            <h2>Expenses by Category</h2>
            <table>
              <tr><th>Category</th><th>Amount</th><th>Percentage</th></tr>
              ${Object.entries(data.expenses.byCategory).map(([category, amount]) => `
                <tr>
                  <td>${category.replace(/_/g, ' ').toUpperCase()}</td>
                  <td>UGX ${amount.toLocaleString()}</td>
                  <td>${((amount / data.expenses.total) * 100).toFixed(1)}%</td>
                </tr>
              `).join('')}
            </table>
          </div>
          
          <div class="section">
            <h2>⛪ Tithe & Giving Analysis</h2>
            <p><strong>Total Given:</strong> UGX ${data.tithe.total.toLocaleString()}</p>
            <p><strong>Giving Rate:</strong> ${data.tithe.rate.toFixed(1)}% of income</p>
            <p><strong>Biblical Target:</strong> 10% (UGX ${(data.income.total * 0.1).toLocaleString()})</p>
          </div>
        </body>
        </html>
      `;
      
      return htmlContent;
    };
    
    // 📧 GMAIL INTEGRATION & EMAIL AUTOMATION
    const sendEmailReport = async (reportData, format = 'pdf') => {
      setEmailStatus('preparing');
      
      try {
        // Generate the report content
        let reportContent;
        let attachmentName;
        let mimeType;
        
        switch (format) {
          case 'pdf':
            reportContent = await generatePDFReport(reportData);
            attachmentName = `ICAN_Financial_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
            mimeType = 'application/pdf';
            break;
          case 'excel':
            reportContent = generateExcelData(reportData);
            attachmentName = `ICAN_Financial_Data_${new Date().toISOString().slice(0, 10)}.xlsx`;
            mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            break;
          case 'html':
            reportContent = await generatePDFReport(reportData); // Use HTML version
            attachmentName = `ICAN_Financial_Report_${new Date().toISOString().slice(0, 10)}.html`;
            mimeType = 'text/html';
            break;
          default:
            throw new Error('Unsupported email format');
        }
        
        // Prepare email data
        const emailData = {
          to: emailSettings.recipient,
          subject: emailSettings.subject,
          body: generateEmailBody(reportData),
          attachment: {
            name: attachmentName,
            content: reportContent,
            mimeType: mimeType
          }
        };
        
        // 🚀 SEND EMAIL using Gmail API (simulated - in production, integrate with Gmail API)
        setEmailStatus('sending');
        await simulateEmailSend(emailData);
        
        setEmailStatus('sent');
        return { success: true, message: 'Report sent successfully!' };
        
      } catch (error) {
        console.error('Email sending failed:', error);
        setEmailStatus('error');
        return { success: false, message: error.message };
      }
    };
    
    const simulateEmailSend = async (emailData) => {
      // Simulate API call to Gmail
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // In production, this would be:
      // const response = await fetch('/api/send-email', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(emailData)
      // });
      
      console.log('📧 Email Report Sent:', {
        to: emailData.to,
        subject: emailData.subject,
        attachment: emailData.attachment.name,
        timestamp: new Date().toISOString()
      });
      
      return true;
    };
    
    const generateEmailBody = (reportData) => {
      const { summary, kpis } = reportData;
      
      return `
Dear ICAN Capital Engine User,

🎯 Your comprehensive financial report is ready! Here's a quick executive summary:

📊 FINANCIAL OVERVIEW:
• Net Worth: UGX ${summary.netWorth.toLocaleString()}
• Total Income: UGX ${summary.totalIncome.toLocaleString()}  
• Total Expenses: UGX ${summary.totalExpenses.toLocaleString()}
• Net Cash Flow: UGX ${summary.netCashFlow.toLocaleString()}

💡 KEY INSIGHTS:
• Financial Health Score: ${kpis.financialHealthScore}/100
• Savings Rate: ${kpis.savingsRate.toFixed(1)}%
• Net Worth Trend: ${summary.intelligence.netWorthTrend.toUpperCase()}

⛪ STEWARDSHIP:
• Tithe Rate: ${reportData.tithe.rate.toFixed(1)}%
• Biblical Compliance: ${reportData.tithe.compliance ? '✅ Faithful' : '📈 Growing'}

📈 NEXT STEPS:
${generateRecommendations(reportData)}

The complete detailed analysis is attached as ${reportData.metadata.reportType.replace('-', ' ').toUpperCase()}.

Best regards,
ICAN Capital Engine - Your AI Financial Intelligence System

---
Generated automatically on ${new Date().toLocaleString()}
Report Period: ${reportData.metadata.dateRange}
Data Freshness: ${reportData.metadata.dataFreshness}
      `.trim();
    };
    
    const generateRecommendations = (data) => {
      const recommendations = [];
      
      if (data.kpis.savingsRate < 10) {
        recommendations.push('• 💰 Focus on increasing your savings rate to at least 10%');
      }
      
      if (data.tithe.rate < 10) {
        recommendations.push('• ⛪ Consider increasing your tithe to achieve biblical stewardship');
      }
      
      if (data.kpis.debtToIncomeRatio > 30) {
        recommendations.push('• 🏦 Work on reducing debt-to-income ratio for better financial health');
      }
      
      if (data.summary.intelligence.netWorthTrend === 'declining') {
        recommendations.push('• 📈 Review expenses and focus on income generation strategies');
      }
      
      if (recommendations.length === 0) {
        recommendations.push('• 🎉 Excellent financial management! Keep up the great work!');
      }
      
      return recommendations.join('\n');
    };
    
    // 🔄 AUTOMATED SCHEDULING
    const scheduleReports = (frequency) => {
      // In production, this would set up automated report generation
      console.log(`📅 Scheduling ${frequency} reports for ${emailSettings.recipient}`);
      
      const scheduleConfig = {
        daily: { interval: 24 * 60 * 60 * 1000, description: 'Daily at 8 AM' },
        weekly: { interval: 7 * 24 * 60 * 60 * 1000, description: 'Weekly on Mondays' },
        monthly: { interval: 30 * 24 * 60 * 60 * 1000, description: 'Monthly on 1st day' }
      };
      
      return scheduleConfig[frequency] || null;
    };

    const generateExcelData = (data) => {
      // Simulated Excel data structure
      return {
        worksheets: {
          'Summary': {
            data: [
              ['Financial Summary', '', ''],
              ['Total Income', `UGX ${data.summary.totalIncome.toLocaleString()}`, ''],
              ['Total Expenses', `UGX ${data.summary.totalExpenses.toLocaleString()}`, ''],
              ['Net Cash Flow', `UGX ${data.summary.netCashFlow.toLocaleString()}`, ''],
              ['Net Worth', `UGX ${data.summary.netWorth.toLocaleString()}`, ''],
            ]
          },
          'Income': {
            data: [
              ['Category', 'Amount', 'Percentage'],
              ...Object.entries(data.income.byCategory).map(([category, amount]) => [
                category.replace(/_/g, ' ').toUpperCase(),
                amount,
                ((amount / data.income.total) * 100).toFixed(1) + '%'
              ])
            ]
          },
          'Expenses': {
            data: [
              ['Category', 'Amount', 'Percentage'],
              ...Object.entries(data.expenses.byCategory).map(([category, amount]) => [
                category.replace(/_/g, ' ').toUpperCase(),
                amount,
                ((amount / data.expenses.total) * 100).toFixed(1) + '%'
              ])
            ]
          },
          'Transactions': {
            data: [
              ['Date', 'Type', 'Category', 'Description', 'Amount'],
              ...getFilteredTransactions().map(t => [
                new Date(t.date).toLocaleDateString(),
                t.type.toUpperCase(),
                t.category.replace(/_/g, ' ').toUpperCase(),
                t.description,
                t.amount
              ])
            ]
          }
        }
      };
    };

    const generateCSVData = (data) => {
      const transactions = getFilteredTransactions();
      const csvContent = [
        ['Date', 'Type', 'Category', 'Subcategory', 'Description', 'Amount', 'Payment Method', 'Location'].join(','),
        ...transactions.map(t => [
          new Date(t.date).toLocaleDateString(),
          t.type,
          t.category || '',
          t.subCategory || '',
          `"${t.description || ''}"`,
          t.amount,
          t.paymentMethod || '',
          t.location || ''
        ].join(','))
      ].join('\n');
      
      return csvContent;
    };

    const generateJSONData = (data) => {
      return {
        metadata: data.metadata,
        summary: data.summary,
        income: data.income,
        expenses: data.expenses,
        loans: data.loans,
        tithe: data.tithe,
        trends: data.trends,
        kpis: data.kpis,
        forecasts: data.forecasts,
        transactions: getFilteredTransactions()
      };
    };
    
    // 🎯 POWERPOINT PRESENTATION GENERATOR
    const generatePowerPointData = (data) => {
      return {
        title: data.metadata.title,
        slides: [
          {
            title: "📊 Executive Summary",
            content: {
              netWorth: data.summary.netWorth,
              totalIncome: data.summary.totalIncome,
              totalExpenses: data.summary.totalExpenses,
              netCashFlow: data.summary.netCashFlow,
              healthScore: data.kpis.financialHealthScore,
              trend: data.summary.intelligence.netWorthTrend
            }
          },
          {
            title: "💰 Income Analysis",
            content: {
              total: data.income.total,
              byCategory: data.income.byCategory,
              growth: data.income.growthTrend,
              monthlyAverage: data.income.averageMonthly
            }
          },
          {
            title: "💸 Expense Breakdown",
            content: {
              total: data.expenses.total,
              byCategory: data.expenses.byCategory,
              trend: data.expenses.spendingTrend,
              monthlyAverage: data.expenses.averageMonthly
            }
          },
          {
            title: "⛪ Stewardship Report",
            content: {
              titheRate: data.tithe.rate,
              totalGiven: data.tithe.total,
              biblicalTarget: data.tithe.biblicalTarget,
              compliance: data.tithe.compliance,
              blessingStatus: data.tithe.blessingMultiplier
            }
          },
          {
            title: "📈 Key Performance Indicators",
            content: {
              savingsRate: data.kpis.savingsRate,
              expenseRatio: data.kpis.expenseRatio,
              debtToIncomeRatio: data.kpis.debtToIncomeRatio,
              financialHealthScore: data.kpis.financialHealthScore
            }
          },
          {
            title: "🔮 Forecasts & Recommendations",
            content: {
              projections: data.forecasts?.projections || [],
              recommendations: generateRecommendations(data)
            }
          }
        ],
        metadata: {
          generatedAt: new Date().toISOString(),
          reportPeriod: data.metadata.dateRange,
          slideCount: 6
        }
      };
    };

    // 🚀 ENHANCED REPORT GENERATION with Email Integration
    const handleGenerateReport = async () => {
      setIsGenerating(true);
      setLastUpdated(new Date());
      
      try {
        // 📊 Use memoized report data
        const reportData = generateReportData;
        setRealTimeData(reportData);
        
        let generatedContent;
        let filename = `${reportTitle.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`;
        
        // 📤 Generate content and trigger real downloads
        switch (exportFormat) {
          case 'pdf':
            generatedContent = await generatePDFReport(reportData);
            filename += '.html'; // HTML that can be printed/saved as PDF
            downloadFile(generatedContent, filename, 'text/html');
            break;
          case 'excel':
            const excelData = generateExcelData(reportData);
            generatedContent = generateCSVFromExcel(excelData);
            filename += '.csv';
            downloadFile(generatedContent, filename, 'text/csv');
            break;
          case 'powerpoint':
            generatedContent = generatePowerPointData(reportData);
            filename += '.txt'; // Export as structured text
            downloadFile(JSON.stringify(generatedContent, null, 2), filename, 'text/plain');
            break;
          case 'csv':
            generatedContent = generateCSVData(reportData);
            filename += '.csv';
            downloadFile(generatedContent, filename, 'text/csv');
            break;
          case 'json':
            generatedContent = generateJSONData(reportData);
            filename += '.json';
            downloadFile(generatedContent, filename, 'application/json');
            break;
          case 'html':
            generatedContent = await generatePDFReport(reportData);
            filename += '.html';
            downloadFile(generatedContent, filename, 'text/html');
            break;
          case 'email-pdf':
            // 📧 Generate PDF and prepare for email
            generatedContent = await generatePDFReport(reportData);
            filename += '.pdf';
            
            // Auto-send email if configured
            if (emailSettings.recipient && emailSettings.autoSend) {
              await sendEmailReport(reportData, 'pdf');
            } else {
              setShowEmailModal(true);
            }
            break;
          default:
            generatedContent = reportData;
        }
        
        const reportResult = {
          data: reportData,
          content: generatedContent,
          format: exportFormat,
          filename: filename,
          timestamp: new Date().toISOString(),
          kpis: {
            healthScore: reportData.kpis.financialHealthScore,
            netWorthTrend: reportData.summary.intelligence.netWorthTrend,
            savingsRate: reportData.kpis.savingsRate
          }
        };
        
        setGeneratedReport(reportResult);
        
        // 🎯 Show success message with key insights
        console.log('📊 Advanced Report Generated Successfully:', {
          type: selectedReportType,
          format: exportFormat,
          healthScore: reportData.kpis.financialHealthScore,
          transactions: reportData.summary.transactionCount,
          netWorth: reportData.summary.netWorth
        });
        
      } catch (error) {
        console.error('❌ Error generating advanced report:', error);
        setGeneratedReport(null);
      } finally {
        setIsGenerating(false);
      }
    };
    
    // 📧 EMAIL MODAL HANDLER
    const handleEmailReport = async () => {
      if (!generatedReport || !emailSettings.recipient) {
        alert('Please enter a recipient email address');
        return;
      }
      
      const result = await sendEmailReport(generatedReport.data, generatedReport.format);
      
      if (result.success) {
        alert('✅ Report sent successfully!');
        setShowEmailModal(false);
      } else {
        alert(`❌ Failed to send report: ${result.message}`);
      }
    };

    const downloadReport = () => {
      if (!generatedReport) return;
      
      let content = generatedReport.content;
      let mimeType;
      
      switch (generatedReport.format) {
        case 'pdf':
        case 'html':
          mimeType = 'text/html';
          break;
        case 'csv':
          mimeType = 'text/csv';
          break;
        case 'json':
          content = JSON.stringify(content, null, 2);
          mimeType = 'application/json';
          break;
        case 'excel':
          // Convert to CSV for download (Excel would need library like xlsx)
          content = 'Excel format would require xlsx library\n\n' + JSON.stringify(content, null, 2);
          mimeType = 'text/plain';
          break;
        default:
          mimeType = 'text/plain';
      }
      
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = generatedReport.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    const availableCategories = [...new Set(transactions.map(t => t.category))].filter(Boolean);

    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
                  📊 Advanced Reporting System
                </h2>
                <p className="text-gray-600 mt-1">Generate comprehensive financial reports in multiple formats</p>
              </div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              {/* Configuration Panel */}
              <div className="lg:col-span-2 space-y-6">
                {/* Report Type Selection */}
                <div className="bg-white rounded-xl p-6 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">📋 Report Configuration</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Report Title</label>
                      <input
                        type="text"
                        value={reportTitle}
                        onChange={(e) => setReportTitle(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="My Financial Report"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Report Type</label>
                      <div className="grid md:grid-cols-2 gap-2">
                        {Object.entries(reportTypes).map(([key, report]) => (
                          <button
                            key={key}
                            onClick={() => setSelectedReportType(key)}
                            className={`p-3 rounded-lg border-2 text-left transition-all ${
                              selectedReportType === key
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 hover:border-blue-300'
                            }`}
                          >
                            <div className="font-medium flex items-center gap-2">
                              <span>{report.icon}</span>
                              <span className="text-sm">{report.name}</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">{report.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
                        <select
                          value={dateRange}
                          onChange={(e) => setDateRange(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          {Object.entries(dateRanges).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Export Format</label>
                        <select
                          value={exportFormat}
                          onChange={(e) => setExportFormat(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          {Object.entries(exportFormats).map(([key, format]) => (
                            <option key={key} value={key}>{format.icon} {format.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {dateRange === 'custom' && (
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                          <input
                            type="date"
                            value={customDateStart}
                            onChange={(e) => setCustomDateStart(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                          <input
                            type="date"
                            value={customDateEnd}
                            onChange={(e) => setCustomDateEnd(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    )}

                    {availableCategories.length > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Categories to Include (leave empty for all)
                        </label>
                        <div className="max-h-32 overflow-y-auto border border-gray-300 rounded-lg p-2">
                          {availableCategories.map(category => (
                            <label key={category} className="flex items-center gap-2 py-1">
                              <input
                                type="checkbox"
                                checked={includeCategories.includes(category)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setIncludeCategories([...includeCategories, category]);
                                  } else {
                                    setIncludeCategories(includeCategories.filter(c => c !== category));
                                  }
                                }}
                                className="rounded border-gray-300"
                              />
                              <span className="text-sm capitalize">{category.replace(/_/g, ' ')}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Generate Button */}
                <div className="bg-white rounded-xl p-6 shadow-lg">
                  <button
                    onClick={handleGenerateReport}
                    disabled={isGenerating}
                    className="w-full py-3 bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 disabled:from-gray-400 disabled:to-gray-400 text-white rounded-lg transition-all font-semibold text-lg shadow-lg"
                  >
                    {isGenerating ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Generating Report...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        {exportFormats[exportFormat].icon} Generate {exportFormats[exportFormat].name}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Comprehensive Preview Panel */}
              <div className="space-y-4 max-h-[80vh] overflow-y-auto">
                {/* Preview Header */}
                <div className="bg-white rounded-xl p-4 shadow-lg sticky top-0 z-10">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    👁️ Live Report Preview
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                      {exportFormats[exportFormat].name}
                    </span>
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Type:</span>
                      <span className="font-medium">{reportTypes[selectedReportType]?.icon} {reportTypes[selectedReportType]?.name.split(' ').slice(1).join(' ')}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-600">Period:</span>
                      <span className="font-medium">{dateRanges[dateRange]}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-600">Records:</span>
                      <span className="font-medium">{getFilteredTransactions().length} transactions</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-600">Format:</span>
                      <span className="font-medium">{exportFormats[exportFormat].icon} {exportFormat.toUpperCase()}</span>
                    </div>
                  </div>
                </div>

                {/* Dynamic Report Preview Based on Type */}
                <div className="bg-white rounded-xl p-4 shadow-lg">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="font-semibold text-gray-800 flex items-center gap-2">
                      {reportTypes[selectedReportType]?.icon} Report Preview
                    </h4>
                    <span className="text-xs text-gray-500">Live Preview</span>
                  </div>
                  
                  {(() => {
                    const reportData = generateReportData;
                    const filtered = getFilteredTransactions();
                    
                    switch(selectedReportType) {
                      case 'financial-summary':
                        return (
                          <div className="space-y-4">
                            <div className="border-b pb-3">
                              <h5 className="font-medium text-gray-700 mb-2">Executive Summary</h5>
                              <div className="grid grid-cols-2 gap-3 text-xs">
                                <div className="bg-green-50 p-2 rounded">
                                  <div className="text-green-600 font-medium">Total Income</div>
                                  <div className="text-lg font-bold text-green-800">UGX {reportData.summary.totalIncome.toLocaleString()}</div>
                                </div>
                                <div className="bg-red-50 p-2 rounded">
                                  <div className="text-red-600 font-medium">Total Expenses</div>
                                  <div className="text-lg font-bold text-red-800">UGX {reportData.summary.totalExpenses.toLocaleString()}</div>
                                </div>
                                <div className="bg-blue-50 p-2 rounded">
                                  <div className="text-blue-600 font-medium">Net Cash Flow</div>
                                  <div className={`text-lg font-bold ${reportData.summary.netCashFlow >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                                    UGX {reportData.summary.netCashFlow.toLocaleString()}
                                  </div>
                                </div>
                                <div className="bg-purple-50 p-2 rounded">
                                  <div className="text-purple-600 font-medium">Net Worth</div>
                                  <div className="text-lg font-bold text-purple-800">UGX {reportData.summary.netWorth.toLocaleString()}</div>
                                </div>
                              </div>
                            </div>
                            <div>
                              <h6 className="text-xs font-medium text-gray-600 mb-2">Income Breakdown</h6>
                              <div className="space-y-1">
                                {Object.entries(reportData.income.byCategory).slice(0, 3).map(([cat, amount]) => (
                                  <div key={cat} className="flex justify-between text-xs">
                                    <span className="capitalize">{cat.replace(/_/g, ' ')}</span>
                                    <span className="font-medium">UGX {amount.toLocaleString()}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                        
                      case 'income-analysis':
                        return (
                          <div className="space-y-3">
                            <div className="text-center border-b pb-2">
                              <div className="text-2xl font-bold text-green-600">UGX {reportData.income.total.toLocaleString()}</div>
                              <div className="text-xs text-gray-500">Total Income</div>
                            </div>
                            <div>
                              <h6 className="text-xs font-medium text-gray-600 mb-2">Income Sources</h6>
                              {Object.entries(reportData.income.byCategory).map(([cat, amount]) => (
                                <div key={cat} className="flex justify-between items-center text-xs mb-1">
                                  <span className="capitalize">{cat.replace(/_/g, ' ')}</span>
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 bg-gray-200 rounded-full h-2">
                                      <div 
                                        className="bg-green-500 h-2 rounded-full"
                                        style={{ width: `${(amount / reportData.income.total) * 100}%` }}
                                      ></div>
                                    </div>
                                    <span className="font-medium w-12 text-right">
                                      {((amount / reportData.income.total) * 100).toFixed(0)}%
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                        
                      case 'expense-breakdown':
                        return (
                          <div className="space-y-3">
                            <div className="text-center border-b pb-2">
                              <div className="text-2xl font-bold text-red-600">UGX {reportData.expenses.total.toLocaleString()}</div>
                              <div className="text-xs text-gray-500">Total Expenses</div>
                            </div>
                            <div>
                              <h6 className="text-xs font-medium text-gray-600 mb-2">Top Expense Categories</h6>
                              {Object.entries(reportData.expenses.byCategory)
                                .sort(([,a], [,b]) => b - a)
                                .slice(0, 5)
                                .map(([cat, amount]) => (
                                  <div key={cat} className="flex justify-between items-center text-xs mb-1">
                                    <span className="capitalize">{cat.replace(/_/g, ' ')}</span>
                                    <div className="flex items-center gap-2">
                                      <div className="w-16 bg-gray-200 rounded-full h-2">
                                        <div 
                                          className="bg-red-500 h-2 rounded-full"
                                          style={{ width: `${(amount / reportData.expenses.total) * 100}%` }}
                                        ></div>
                                      </div>
                                      <span className="font-medium w-20 text-right">UGX {amount.toLocaleString()}</span>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        );
                        
                      case 'tithe-report':
                        const titheRate = reportData.tithe.rate;
                        const biblicalTarget = reportData.income.total * 0.1;
                        return (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-purple-50 p-2 rounded text-center">
                                <div className="text-purple-600 text-xs">Given</div>
                                <div className="text-lg font-bold text-purple-800">UGX {reportData.tithe.total.toLocaleString()}</div>
                              </div>
                              <div className="bg-blue-50 p-2 rounded text-center">
                                <div className="text-blue-600 text-xs">Rate</div>
                                <div className="text-lg font-bold text-blue-800">{titheRate.toFixed(1)}%</div>
                              </div>
                            </div>
                            <div className="border border-gray-200 rounded p-2">
                              <div className="flex justify-between text-xs mb-1">
                                <span>Biblical Target (10%)</span>
                                <span>UGX {biblicalTarget.toLocaleString()}</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div 
                                  className={`h-2 rounded-full ${titheRate >= 10 ? 'bg-green-500' : 'bg-yellow-500'}`}
                                  style={{ width: `${Math.min(100, (titheRate / 10) * 100)}%` }}
                                ></div>
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                {titheRate >= 10 ? '✅ Meeting biblical standard' : `${(10 - titheRate).toFixed(1)}% below target`}
                              </div>
                            </div>
                          </div>
                        );
                        
                      case 'cash-flow':
                        return (
                          <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-1 text-xs">
                              <div className="text-center">
                                <div className="text-green-600 font-medium">Income</div>
                                <div className="text-sm font-bold">UGX {reportData.income.total.toLocaleString()}</div>
                              </div>
                              <div className="text-center">
                                <div className="text-red-600 font-medium">Expenses</div>
                                <div className="text-sm font-bold">UGX {reportData.expenses.total.toLocaleString()}</div>
                              </div>
                              <div className="text-center">
                                <div className="text-blue-600 font-medium">Net Flow</div>
                                <div className={`text-sm font-bold ${reportData.summary.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  UGX {reportData.summary.netCashFlow.toLocaleString()}
                                </div>
                              </div>
                            </div>
                            <div>
                              <h6 className="text-xs font-medium text-gray-600 mb-2">Monthly Trend</h6>
                              <div className="space-y-1">
                                {Object.entries(reportData.trends.monthly).slice(-3).map(([month, data]) => (
                                  <div key={month} className="flex justify-between text-xs">
                                    <span>{new Date(month).toLocaleDateString('en', {month: 'short', year: 'numeric'})}</span>
                                    <span className={`font-medium ${data.income - data.expenses >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      UGX {(data.income - data.expenses).toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                        
                      case 'loan-analysis':
                        const loans = filtered.filter(t => t.type === 'loan' || t.isLoan);
                        return (
                          <div className="space-y-3">
                            <div className="text-center border-b pb-2">
                              <div className="text-xl font-bold text-orange-600">UGX {reportData.loans.total.toLocaleString()}</div>
                              <div className="text-xs text-gray-500">{loans.length} Active Loans</div>
                            </div>
                            <div>
                              <h6 className="text-xs font-medium text-gray-600 mb-2">Recent Loan Activity</h6>
                              {loans.slice(-3).map((loan, idx) => (
                                <div key={idx} className="flex justify-between text-xs mb-1 p-1 bg-gray-50 rounded">
                                  <span className="truncate">{loan.description}</span>
                                  <span className="font-medium">UGX {loan.amount.toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                        
                      case 'business-performance':
                        const businessTransactions = filtered.filter(t => 
                          t.category?.includes('business') || 
                          t.description?.toLowerCase().includes('business') ||
                          t.description?.toLowerCase().includes('client')
                        );
                        const businessRevenue = businessTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
                        const businessExpenses = businessTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
                        
                        return (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-green-50 p-2 rounded text-center">
                                <div className="text-green-600 text-xs">Revenue</div>
                                <div className="text-sm font-bold text-green-800">UGX {businessRevenue.toLocaleString()}</div>
                              </div>
                              <div className="bg-red-50 p-2 rounded text-center">
                                <div className="text-red-600 text-xs">Expenses</div>
                                <div className="text-sm font-bold text-red-800">UGX {businessExpenses.toLocaleString()}</div>
                              </div>
                            </div>
                            <div className="text-center p-2 bg-blue-50 rounded">
                              <div className="text-blue-600 text-xs">Net Profit</div>
                              <div className={`text-lg font-bold ${businessRevenue - businessExpenses >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                UGX {(businessRevenue - businessExpenses).toLocaleString()}
                              </div>
                              <div className="text-xs text-gray-500">
                                Margin: {businessRevenue > 0 ? ((businessRevenue - businessExpenses) / businessRevenue * 100).toFixed(1) : 0}%
                              </div>
                            </div>
                          </div>
                        );
                        
                      default:
                        return (
                          <div className="text-center py-8 text-gray-500">
                            <div className="text-4xl mb-2">📊</div>
                            <div className="text-sm">Preview will appear here</div>
                            <div className="text-xs">Select report type and configure filters</div>
                          </div>
                        );
                    }
                  })()}
                </div>

                {/* Format-Specific Preview */}
                <div className="bg-white rounded-xl p-4 shadow-lg">
                  <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    {exportFormats[exportFormat].icon} {exportFormat.toUpperCase()} Preview
                  </h4>
                  
                  {(() => {
                    switch(exportFormat) {
                      case 'pdf':
                        return (
                          <div className="text-xs space-y-2 bg-gray-50 p-3 rounded border-l-4 border-red-400">
                            <div className="font-bold">📄 PDF Document Structure:</div>
                            <div>• Header: {reportTitle} - Generated {new Date().toLocaleDateString()}</div>
                            <div>• Executive Summary with key metrics</div>
                            <div>• Detailed tables with income/expense breakdowns</div>
                            <div>• Category analysis with percentages</div>
                            <div>• Charts and visual representations</div>
                            <div>• Footer with total {getFilteredTransactions().length} transactions</div>
                          </div>
                        );
                        
                      case 'excel':
                        return (
                          <div className="text-xs space-y-2 bg-gray-50 p-3 rounded border-l-4 border-green-400">
                            <div className="font-bold">📊 Excel Workbook Structure:</div>
                            <div>• Summary Sheet: Financial overview & KPIs</div>
                            <div>• Income Sheet: Revenue sources & trends</div>
                            <div>• Expenses Sheet: Category breakdowns</div>
                            <div>• Transactions Sheet: Raw data ({getFilteredTransactions().length} rows)</div>
                            <div>• Charts Sheet: Visual analytics</div>
                            <div>• Formulas included for dynamic calculations</div>
                          </div>
                        );
                        
                      case 'csv':
                        const sampleRows = getFilteredTransactions().slice(0, 3);
                        return (
                          <div className="text-xs space-y-2 bg-gray-50 p-3 rounded border-l-4 border-blue-400">
                            <div className="font-bold">📋 CSV Data Preview:</div>
                            <div className="bg-white p-2 rounded font-mono text-xs">
                              Date,Type,Category,Description,Amount<br/>
                              {sampleRows.map(t => 
                                `${new Date(t.date).toLocaleDateString()},${t.type},${t.category},"${t.description}",${t.amount}`
                              ).join('\n')}
                              <br/>...and {getFilteredTransactions().length - 3} more rows
                            </div>
                          </div>
                        );
                        
                      case 'json':
                        return (
                          <div className="text-xs space-y-2 bg-gray-50 p-3 rounded border-l-4 border-purple-400">
                            <div className="font-bold">💾 JSON Structure Preview:</div>
                            <div className="bg-white p-2 rounded font-mono text-xs">
                              {`{
  "metadata": { "reportType": "${selectedReportType}", "generated": "..." },
  "summary": { "totalIncome": ${generateReportData.summary.totalIncome}, "totalExpenses": ${generateReportData.summary.totalExpenses} },
  "transactions": [ ${getFilteredTransactions().length} records ],
  "analysis": { ... }
}`}
                            </div>
                          </div>
                        );
                        
                      default:
                        return (
                          <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded">
                            Select an export format to see preview details
                          </div>
                        );
                    }
                  })()}
                </div>

                {/* Generated Report Actions */}
                {generatedReport && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <h4 className="font-semibold text-green-800 mb-2 flex items-center gap-2">
                      ✅ Report Generated Successfully
                    </h4>
                    <p className="text-sm text-green-700 mb-3">
                      Your {exportFormats[generatedReport.format].name} report is ready for download.
                    </p>
                    <button
                      onClick={downloadReport}
                      className="w-full bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                    >
                      📥 Download {generatedReport.filename}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
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

  const loadUserData = async () => {
    try {
      // Use demo-user for now (hooks can't be called in regular functions)
      const userId = 'demo-user';

      // Try loading from Supabase first
      if (supabase) {
        console.log('📊 Loading transactions from Supabase...');
        const { data, error } = await supabase
          .from('firebase_transactions_sync')
          .select('*')
          .eq('user_id', userId)
          .order('firebase_created_at', { ascending: false });

        if (error) {
          console.warn('⚠️ Supabase fetch error:', error);
        } else if (data && data.length > 0) {
          console.log(`✅ Loaded ${data.length} transactions from Supabase`);
          // Convert Supabase data format to app format
          const convertedTransactions = data.map(t => ({
            id: t.firebase_id,
            amount: t.amount,
            type: t.type,
            description: t.description,
            category: t.category,
            date: t.firebase_created_at,
            projectName: t.project_name,
            termMonths: t.project_term_months,
            expectedReturn: t.expected_return_percent,
            confidence: t.confidence
          }));
          setTransactions(convertedTransactions);
          return;
        }
      }

      // Fallback to localStorage if Supabase unavailable
      console.log('💾 Falling back to localStorage...');
      const savedTransactions = localStorage.getItem('ican_transactions');
      const savedMode = localStorage.getItem('ican_mode');
      const savedCountry = localStorage.getItem('ican_country');
      const savedGoals = localStorage.getItem('ican_goals');

      if (savedTransactions) setTransactions(JSON.parse(savedTransactions));
      if (savedMode) setMode(savedMode);
      if (savedCountry) setOperatingCountry(savedCountry);
      if (savedGoals) setGoals(JSON.parse(savedGoals));
    } catch (error) {
      console.error('❌ Error loading user data:', error);
      // Fallback to localStorage
      const savedTransactions = localStorage.getItem('ican_transactions');
      if (savedTransactions) setTransactions(JSON.parse(savedTransactions));
    }
  };

  const saveUserData = async () => {
    // Always save to localStorage
    localStorage.setItem('ican_transactions', JSON.stringify(transactions));
    localStorage.setItem('ican_mode', mode);
    localStorage.setItem('ican_country', operatingCountry);
    localStorage.setItem('ican_goals', JSON.stringify(goals));

    // Also sync to Supabase if available
    if (supabase && transactions.length > 0) {
      try {
        const { user } = useAuth();
        const userId = user?.uid || 'demo-user';

        for (const transaction of transactions) {
          const { error } = await supabase.rpc('sync_firebase_transaction', {
            p_firebase_id: transaction.id,
            p_user_id: userId,
            p_amount: transaction.amount,
            p_type: transaction.type,
            p_description: transaction.description,
            p_category: transaction.category,
            p_project_name: transaction.projectName,
            p_term_months: transaction.termMonths,
            p_expected_return: transaction.expectedReturn,
            p_confidence: transaction.confidence || 0,
            p_firebase_created_at: transaction.date
          });

          if (error) {
            console.warn(`⚠️ Failed to sync transaction ${transaction.id}:`, error);
          }
        }
        console.log('✅ Transactions synced to Supabase');
      } catch (error) {
        console.warn('⚠️ Supabase sync error:', error);
      }
    }
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

  // 🧠 COMPREHENSIVE AI FINANCIAL INTELLIGENCE SYSTEM
  const analyzeFinancialIntelligence = () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    const recentTransactions = transactions.filter(t => new Date(t.date) > thirtyDaysAgo);
    const quarterlyTransactions = transactions.filter(t => new Date(t.date) > ninetyDaysAgo);
    
    // Net Worth Trend Analysis
    const monthlyIncome = recentTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const monthlyExpenses = recentTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const monthlyNetFlow = monthlyIncome - monthlyExpenses;
    
    const quarterlyIncome = quarterlyTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const quarterlyExpenses = quarterlyTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const quarterlyAvgMonthly = (quarterlyIncome - quarterlyExpenses) / 3;
    
    // Determine trend
    let trend = 'stable';
    if (monthlyNetFlow > quarterlyAvgMonthly * 1.15) trend = 'growing';
    else if (monthlyNetFlow < quarterlyAvgMonthly * 0.85) trend = 'declining';
    
    setNetWorthTrend(trend);
    
    // Spending Pattern Analysis
    const categorySpending = {};
    recentTransactions.filter(t => t.type === 'expense').forEach(t => {
      categorySpending[t.category] = (categorySpending[t.category] || 0) + t.amount;
    });
    
    const topExpenseCategories = Object.entries(categorySpending)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3);
    
    // AI Recommendations Engine
    const recommendations = [];
    const loanOpportunities = [];
    
    // Net Worth Based Recommendations
    if (trend === 'growing' && netWorth > 1000000) {
      recommendations.push({
        type: 'investment',
        priority: 'high',
        title: '🚀 Wealth Acceleration Opportunity',
        message: `Your net worth is growing (+${((monthlyNetFlow/quarterlyAvgMonthly - 1) * 100).toFixed(1)}%). Consider strategic investments.`,
        action: 'explore_investments',
        color: 'green'
      });
      
      loanOpportunities.push({
        type: 'leverage_loan',
        title: '💎 Strategic Leverage Opportunity',
        description: 'Use low-interest business loan to amplify your growth trajectory',
        suggestedAmount: Math.min(netWorth * 0.3, 5000000),
        expectedROI: '15-25%',
        riskLevel: 'medium',
        purpose: 'wealth_acceleration'
      });
    }
    
    if (trend === 'declining' && netWorth < goals.targetNetWorth * 0.5) {
      recommendations.push({
        type: 'emergency',
        priority: 'critical',
        title: '🚨 Financial Recovery Plan Needed',
        message: `Net worth declining. Immediate action required to prevent further loss.`,
        action: 'emergency_plan',
        color: 'red'
      });
      
      // Conservative loan options for recovery
      loanOpportunities.push({
        type: 'recovery_loan',
        title: '🛡️ Financial Stability Loan',
        description: 'Short-term loan to stabilize cash flow and prevent asset liquidation',
        suggestedAmount: Math.min(monthlyExpenses * 3, 500000),
        expectedROI: 'Stability',
        riskLevel: 'low',
        purpose: 'cash_flow_stability'
      });
    }
    
    // Spending Intelligence Recommendations
    if (topExpenseCategories.length > 0) {
      const [topCategory, topAmount] = topExpenseCategories[0];
      const categoryPercentage = (topAmount / monthlyExpenses) * 100;
      
      if (categoryPercentage > 40) {
        recommendations.push({
          type: 'spending_optimization',
          priority: 'medium',
          title: '📊 Spending Concentration Alert',
          message: `${categoryPercentage.toFixed(1)}% of expenses in ${topCategory}. Consider diversification.`,
          action: 'optimize_category',
          category: topCategory,
          color: 'orange'
        });
      }
    }
    
    // Business Growth Loan Opportunities
    const businessIncome = recentTransactions.filter(t => 
      t.type === 'income' && (t.category?.includes('business') || t.description?.toLowerCase().includes('business'))
    ).reduce((sum, t) => sum + t.amount, 0);
    
    if (businessIncome > monthlyIncome * 0.3 && trend === 'growing') {
      loanOpportunities.push({
        type: 'growth_loan',
        title: '📈 Business Expansion Capital',
        description: 'Scale your growing business with strategic growth financing',
        suggestedAmount: businessIncome * 3,
        expectedROI: '20-40%',
        riskLevel: 'medium',
        purpose: 'business_expansion'
      });
    }
    
    // Smart Loan Opportunity: Debt Consolidation
    const loanTransactions = transactions.filter(t => t.isLoan && t.loanDetails);
    if (loanTransactions.length >= 2) {
      const totalLoanPayments = loanTransactions.reduce((sum, t) => sum + (t.loanDetails?.monthlyPayment || 0), 0);
      
      loanOpportunities.push({
        type: 'consolidation_loan',
        title: '🔄 Smart Debt Consolidation',
        description: 'Consolidate multiple loans into one lower-interest payment',
        suggestedAmount: loanTransactions.reduce((sum, t) => sum + t.amount, 0),
        currentPayments: totalLoanPayments,
        potentialSavings: totalLoanPayments * 0.2,
        riskLevel: 'low',
        purpose: 'debt_optimization'
      });
    }
    
    // Update intelligence state
    const intelligence = {
      netWorthTrend: trend,
      monthlyNetFlow,
      quarterlyAvgMonthly,
      growthRate: ((monthlyNetFlow / Math.abs(quarterlyAvgMonthly)) - 1) * 100,
      topExpenseCategories,
      businessIncomeRatio: (businessIncome / monthlyIncome) * 100,
      recommendations,
      loanOpportunities,
      lastAnalyzed: new Date().toISOString()
    };
    
    setFinancialIntelligence(intelligence);
    setIntelligentRecommendations(recommendations);
    setSmartLoanOpportunities(loanOpportunities);
    
    return intelligence;
  };

  const handleAddTransaction = async (transaction) => {
    // 🧠 RUN AI FINANCIAL INTELLIGENCE ANALYSIS FIRST
    const intelligence = analyzeFinancialIntelligence();
    
    // 💼 ENHANCED LOAN TRANSACTION DETECTION & INTELLIGENT RECOMMENDATIONS
    if (transaction.isLoan || transaction.category?.includes('loan') || 
        transaction.description?.toLowerCase().match(/loan|borrow|borrowed|credit|debt|mortgage/)) {
      
      // Check if it's a business loan specifically
      const isBusinessLoan = transaction.description?.toLowerCase().match(/business|commercial|working capital|equipment|expansion|inventory/) ||
                             transaction.category?.includes('business_loan');
      
      // INTELLIGENT LOAN ANALYSIS based on net worth and trends
      let loanAdvice = {
        shouldProceed: true,
        urgency: 'low',
        color: 'blue'
      };
      
      // Net Worth Impact Assessment
      if (intelligence.netWorthTrend === 'declining' && transaction.amount > netWorth * 0.1) {
        loanAdvice = {
          shouldProceed: false,
          urgency: 'high',
          title: '🚨 High Risk Loan Warning',
          message: `Your net worth is declining. This ${transaction.amount.toLocaleString()} loan could worsen your financial position.`,
          recommendation: 'Consider smaller amount or focus on income generation first.',
          color: 'red'
        };
      } else if (intelligence.netWorthTrend === 'growing' && transaction.amount <= netWorth * 0.2) {
        loanAdvice = {
          shouldProceed: true,
          urgency: 'low',
          title: '🚀 Strategic Loan Opportunity',
          message: `With your growing net worth trend (+${intelligence.growthRate.toFixed(1)}%), this loan could accelerate your progress.`,
          recommendation: 'Consider leveraging your positive momentum.',
          color: 'green'
        };
      }
      
      if (isBusinessLoan || transaction.amount > 500000) { // Large loans likely business-related
        
        // 🎯 INTELLIGENT LOAN TYPE DETECTION based on description and amount
        let detectedLoanType = 'business-expansion';
        let detectedInterestRate = '22'; // Default Uganda business loan rate
        let detectedTerm = '2'; // Default 2 years
        
        const description = transaction.description.toLowerCase();
        
        // 🏠 PROPERTY & CONSTRUCTION LOANS
        if (description.match(/land|property|house|building|construction|real estate|mortgage/)) {
          detectedLoanType = 'real-estate';
          detectedInterestRate = '18'; // Lower rate for secured property loans
          detectedTerm = '5'; // Longer term for property
        }
        // 🚗 VEHICLE & EQUIPMENT FINANCING
        else if (description.match(/car|vehicle|truck|equipment|machinery|motorbike|van|bus/)) {
          detectedLoanType = 'equipment-purchase';
          detectedInterestRate = '20'; // Medium rate for asset-backed loans
          detectedTerm = '3'; // 3 years for vehicles/equipment
        }
        // 💰 WORKING CAPITAL & INVENTORY
        else if (description.match(/working capital|inventory|stock|supplies|cash flow|operations/)) {
          detectedLoanType = 'working-capital';
          detectedInterestRate = '24'; // Higher rate for unsecured working capital
          detectedTerm = '1'; // Shorter term for working capital
        }
        // 📈 BUSINESS EXPANSION & GROWTH
        else if (description.match(/expansion|grow|scale|new branch|franchise|investment/)) {
          detectedLoanType = 'business-expansion';
          detectedInterestRate = '21'; // Standard expansion loan rate
          detectedTerm = '3'; // Medium term for expansion
        }
        
        // 💡 SMART LOAN AMOUNT OPTIMIZATION based on AI analysis
        if (transaction.amount > 10000000) {
          detectedInterestRate = (parseFloat(detectedInterestRate) - 2).toString(); // Better rates for large loans
          detectedTerm = '4'; // Longer term for large amounts
        } else if (transaction.amount < 1000000) {
          detectedInterestRate = (parseFloat(detectedInterestRate) + 3).toString(); // Higher rates for small loans
        }
        
        // Store enhanced loan transaction data with intelligent defaults
        setLoanTransactionData({
          description: transaction.description,
          amount: transaction.amount,
          category: transaction.category,
          loanType: detectedLoanType,
          source: 'smart_entry',
          // 🧠 SMART PRE-FILL DATA for Business Loan Calculator
          smartPreFill: {
            amount: transaction.amount,
            loanType: detectedLoanType,
            interestRate: detectedInterestRate,
            loanTerm: detectedTerm,
            // 📊 Estimate business metrics based on loan amount
            monthlyRevenue: Math.round(transaction.amount / 12 * 2.5), // Assume 2.5x coverage
            operatingExpenses: Math.round(transaction.amount / 12 * 1.5), // Assume 60% of revenue
            expectedROI: detectedLoanType === 'working-capital' ? '15' : '25',
            businessType: detectedLoanType === 'real-estate' ? 'real-estate' : 'retail'
          },
          intelligence: {
            netWorthTrend: intelligence.netWorthTrend,
            netWorthRatio: transaction.amount / netWorth,
            monthlyNetFlow: intelligence.monthlyNetFlow,
            riskAssessment: loanAdvice
          }
        });
        
        // 🚀 AUTO-OPEN Business Loan Calculator with intelligent pre-fill
        setShowBusinessLoanCalculator(true);
        
        // Show enhanced integration message with loan details
        setAiAdvice(standardizeAdvice({
          title: loanAdvice.title || "💼 Smart Loan Analysis Complete",
          message: loanAdvice.message || `Detected ${detectedLoanType.replace('-', ' ').toUpperCase()} loan of UGX ${transaction.amount.toLocaleString()}. Pre-filling calculator with intelligent defaults.`,
          recommendation: loanAdvice.recommendation || `✅ Estimated ${detectedInterestRate}% rate, ${detectedTerm} year term. Review calculations in Business Loan Calculator.`,
          shouldProceed: loanAdvice.shouldProceed,
          urgency: loanAdvice.urgency,
          color: loanAdvice.color,
          extraData: {
            netWorthTrend: intelligence.netWorthTrend,
            monthlyFlow: intelligence.monthlyNetFlow,
            loanToNetWorthRatio: ((transaction.amount / netWorth) * 100).toFixed(1),
            detectedType: detectedLoanType,
            estimatedRate: detectedInterestRate + '%'
          }
        }));
        
        setTimeout(() => setAiAdvice(null), 10000); // Show longer for loan analysis
        return; // Don't add to transactions yet - wait for calculator completion
      }
    }
    
    // 🧠 INTELLIGENT SPENDING ANALYSIS for all transactions
    if (transaction.type === 'expense') {
      // Check against spending patterns and net worth trends
      let spendingAdvice = await analyzeSpendingWithAI(transaction);
      
      // Enhance with financial intelligence
      if (intelligence.netWorthTrend === 'declining' && transaction.amount > intelligence.monthlyNetFlow * 0.1) {
        spendingAdvice = {
          ...spendingAdvice,
          urgency: 'high',
          message: `🚨 Your net worth is declining (-${Math.abs(intelligence.growthRate).toFixed(1)}%). This ${transaction.amount.toLocaleString()} expense needs careful consideration.`,
          recommendation: `Focus on essential purchases only. Your monthly net flow is only ${intelligence.monthlyNetFlow.toLocaleString()}.`,
          shouldProceed: transaction.amount < 50000, // Only allow small expenses
          color: 'red'
        };
      } else if (intelligence.netWorthTrend === 'growing' && transaction.category === 'business') {
        spendingAdvice = {
          ...spendingAdvice,
          urgency: 'low',
          message: `📈 Business investment during growth phase (+${intelligence.growthRate.toFixed(1)}% trend). Good timing!`,
          recommendation: 'Strategic business expenses can accelerate your positive momentum.',
          shouldProceed: true,
          color: 'green'
        };
      }
      
      // Show enhanced advice with intelligence
      if (!spendingAdvice.shouldProceed || spendingAdvice.urgency === 'high') {
        setAiAdvice(spendingAdvice);
        setPendingTransaction(transaction);
        setShowAdviceModal(true);
        return;
      } else if (spendingAdvice.urgency === 'medium' || spendingAdvice.message) {
        setAiAdvice(spendingAdvice);
        setTimeout(() => setAiAdvice(null), 8000);
      }
    }
    
    // 📈 INCOME INTELLIGENCE: Smart recommendations for income
    if (transaction.type === 'income') {
      const incomeInsights = {
        title: '💰 Income Received',
        message: `Great! UGX ${transaction.amount.toLocaleString()} added to your wealth.`,
        color: 'green'
      };
      
      // Add intelligent recommendations based on net worth trend
      if (intelligence.netWorthTrend === 'growing') {
        incomeInsights.message += ` Your wealth is growing (+${intelligence.growthRate.toFixed(1)}%).`;
        incomeInsights.recommendation = 'Consider investing a portion for wealth acceleration.';
      } else if (intelligence.netWorthTrend === 'declining') {
        incomeInsights.message += ' Perfect timing to stabilize your finances.';
        incomeInsights.recommendation = 'Focus on essential expenses and debt reduction.';
      }
      
      // Check for smart loan opportunities
      const relevantLoanOpp = smartLoanOpportunities.find(opp => 
        (transaction.category?.includes('business') && opp.type === 'growth_loan') ||
        (intelligence.netWorthTrend === 'growing' && opp.type === 'leverage_loan')
      );
      
      if (relevantLoanOpp) {
        incomeInsights.recommendation += ` 💡 Smart Loan Opportunity: ${relevantLoanOpp.title} available.`;
        incomeInsights.extraData = { loanOpportunity: relevantLoanOpp };
      }
      
      setAiAdvice(standardizeAdvice(incomeInsights));
      setTimeout(() => setAiAdvice(null), 6000);
    }
    
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
      
      // 🙏 AUTO-TITHING SUGGESTION FOR INCOME
      if (pendingTransaction.type === 'income' || pendingTransaction.amount > 0) {
        const incomeAmount = Math.abs(pendingTransaction.amount);
        const suggestedTithe = incomeAmount * 0.1; // 10%
        
        setTimeout(() => {
          const tithingNotification = {
            title: "🙏 TITHING REMINDER",
            message: `God has blessed you with UGX ${incomeAmount.toLocaleString()}! Consider honoring Him with a tithe of UGX ${suggestedTithe.toLocaleString()} (10%).`,
            verse: "Honor the Lord with your wealth, with the firstfruits of all your crops. - Proverbs 3:9",
            action: () => setShowTithingCalculator(true)
          };
          
          // You could show a toast notification here or add to a notification system
          if (confirm(`${tithingNotification.title}\n\n${tithingNotification.message}\n\n"${tithingNotification.verse}"\n\nWould you like to open the Tithing Calculator?`)) {
            setShowTithingCalculator(true);
          }
        }, 1000);
      }
      
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

  // ============================================
  // NPV & IRR CALCULATION FUNCTIONS
  // ============================================
  
  const calculateNPV = (cashFlows, discountRate = 0.10) => {
    /**
     * NPV Formula: NPV = Σ [CF_t / (1 + r)^t]
     * Where:
     *   CF_t = Cash flow at time t
     *   r = Discount rate (default 10%)
     *   t = Time period (in months, converted to years)
     */
    if (!cashFlows || cashFlows.length === 0) return 0;
    
    let npv = 0;
    const firstDate = new Date(cashFlows[0].date);
    
    cashFlows.forEach((flow) => {
      const flowDate = new Date(flow.date);
      const monthsFromStart = (flowDate - firstDate) / (1000 * 60 * 60 * 24 * 30);
      const yearsFromStart = monthsFromStart / 12;
      
      // PV = Cash Flow / (1 + discount_rate)^years
      const presentValue = flow.amount / Math.pow(1 + discountRate, yearsFromStart);
      npv += presentValue;
    });
    
    return npv;
  };

  const calculateIRR = (cashFlows) => {
    /**
     * IRR (Internal Rate of Return) using Newton-Raphson method
     * Find the rate where NPV = 0
     */
    if (!cashFlows || cashFlows.length < 2) return 0;
    
    let irr = 0.10; // Initial guess: 10%
    const maxIterations = 100;
    const tolerance = 0.0001;
    
    for (let i = 0; i < maxIterations; i++) {
      const npv = calculateNPV(cashFlows, irr);
      const npvDerivative = (calculateNPV(cashFlows, irr + 0.0001) - npv) / 0.0001;
      
      if (Math.abs(npvDerivative) < 0.01) break;
      
      const irrNew = irr - (npv / npvDerivative);
      const irrClamped = Math.max(-0.5, Math.min(5.0, irrNew)); // Clamp between -50% and 500%
      
      if (Math.abs(irrClamped - irr) < tolerance) {
        irr = irrClamped;
        break;
      }
      
      irr = irrClamped;
    }
    
    return Math.round(irr * 100 * 100) / 100; // Convert to percentage
  };

  const analyzeOpportunity = (transactionData) => {
    /**
     * Analyze transaction opportunity using NPV/IRR and financial health
     * Returns: { npv, irr, recommendation, confidence, impact, nextSteps }
     */
    if (!transactionData.type) return null;
    
    // Get current financial metrics
    const monthlyIncome = transactions
      .filter(t => t.type === 'income' && isThisMonth(new Date(t.date || t.createdAt)))
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    const monthlyExpense = transactions
      .filter(t => t.type === 'expense' && isThisMonth(new Date(t.date || t.createdAt)))
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    const monthlyNet = monthlyIncome - monthlyExpense;
    const savingsRate = monthlyIncome > 0 ? (monthlyNet / monthlyIncome) * 100 : 0;
    
    let npv = 0;
    let irr = 0;
    let recommendation = '';
    let confidence = 50;
    let impact = '';
    let nextSteps = [];
    
    // Analyze based on transaction type
    if (transactionData.type === 'investment' && transactionData.projectName) {
      // Build cash flow projection
      const cashFlows = [
        { date: new Date(), amount: -transactionData.amount } // Initial investment
      ];
      
      // Project returns based on expected return %
      const expectedReturn = transactionData.expectedReturn || 15;
      const term = transactionData.termMonths || 12;
      
      for (let m = 1; m <= term; m++) {
        const returnMonth = new Date();
        returnMonth.setMonth(returnMonth.getMonth() + m);
        cashFlows.push({
          date: returnMonth,
          amount: (transactionData.amount * (expectedReturn / 100)) / term
        });
      }
      
      // Final principal return
      const finalDate = new Date();
      finalDate.setMonth(finalDate.getMonth() + term);
      cashFlows[cashFlows.length - 1].amount += transactionData.amount;
      
      npv = calculateNPV(cashFlows);
      irr = calculateIRR(cashFlows);
      
      // Generate recommendation
      if (npv > 0 && savingsRate > 20) {
        recommendation = `STRONG BUY - Positive NPV (${npv.toLocaleString()} UGX) & Healthy Savings (${savingsRate.toFixed(1)}%)`;
        confidence = Math.min(100, 75 + (npv / transactionData.amount) * 10);
      } else if (npv > 0) {
        recommendation = `CONSIDER - Positive NPV but build savings to ${transactionData.amount} first`;
        confidence = 60;
      } else {
        recommendation = `HOLD - Negative NPV, seek better opportunities`;
        confidence = 35;
      }
      
      impact = `Investment of ${(transactionData.amount / 1000000).toFixed(1)}M UGX @ ${expectedReturn}% expected return over ${term} months = ${(transactionData.amount * expectedReturn / 100 / term / 1000000).toFixed(1)}M monthly returns`;
      nextSteps = [
        `Allocate ${(transactionData.amount / monthlyNet).toFixed(1)} months of savings`,
        `Set ${term}-month review calendar reminder`,
        `Track actual vs expected returns monthly`,
        `Rebalance portfolio if underperforming`
      ];
    } 
    else if (transactionData.type === 'loan' && transactionData.projectName) {
      const monthlyPayment = transactionData.amount / (transactionData.termMonths || 12);
      
      recommendation = `LOAN: Repay ${(monthlyPayment / 1000000).toFixed(1)}M UGX/month for ${transactionData.termMonths || 12} months`;
      impact = `Debt obligation of ${(monthlyPayment / 1000000).toFixed(1)}M monthly affects net cash flow`;
      confidence = savingsRate > 30 ? 80 : savingsRate > 15 ? 60 : 40;
      
      nextSteps = [
        `Set up automatic ${(monthlyPayment / 1000000).toFixed(1)}M monthly payments`,
        `Add to human capital schedule for accountability`,
        `Calculate true cost with interest rates`
      ];
    }
    else if (transactionData.type === 'income') {
      confidence = 95;
      recommendation = `Income recorded - Allocate ${(transactionData.amount * 0.30 / 1000000).toFixed(1)}M to savings`;
      impact = `Positive ${(transactionData.amount / 1000000).toFixed(1)}M inflow improves investable capital`;
      nextSteps = [
        `Update monthly net worth tracking`,
        `Calculate new opportunity capacity`,
        `Review highest-return opportunities`
      ];
    }
    else if (transactionData.type === 'expense') {
      confidence = 60;
      recommendation = `Expense recorded - Verify necessity for savings goals`;
      impact = `${(transactionData.amount / 1000000).toFixed(1)}M reduces cash available for growth`;
      nextSteps = [
        `Categorize in spending patterns`,
        `Compare to budget baseline`,
        `Identify if can be optimized`
      ];
    }
    
    return {
      npv: Math.round(npv),
      irr: irr,
      recommendation,
      confidence: Math.round(confidence),
      impact,
      nextSteps,
      monthlyNet,
      savingsRate: savingsRate.toFixed(1)
    };
  };

  const isThisMonth = (date) => {
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
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

    // Calculate vital aggregates
    const thisMonth = new Date();
    const monthlyTransactions = transactions.filter(t => {
      const tDate = new Date(t.date || t.createdAt); // Try date first, fallback to createdAt
      return tDate.getMonth() === thisMonth.getMonth() && tDate.getFullYear() === thisMonth.getFullYear();
    });

    const monthlyIncome = monthlyTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const monthlyExpense = monthlyTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const monthlyNet = monthlyIncome - monthlyExpense;
    const savingsRate = monthlyIncome > 0 ? (monthlyNet / monthlyIncome) * 100 : 0;

    return (
      <div className="space-y-6">
        {/* Header with IOR */}
        <div className="glass-card p-4 md:p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-0 mb-4">
            <div className="text-center md:text-left flex-1">
              <h1 className="text-xl md:text-2xl font-bold text-white">ICAN Opportunity Rating</h1>
              <p className="text-sm md:text-base text-gray-300">Your readiness for global opportunities</p>
            </div>
            <div className="flex-shrink-0">
              <IORGauge score={iorScore} size={140} />
            </div>
          </div>
          
          <div className="bg-red-500 bg-opacity-20 border border-red-500 border-opacity-30 rounded-lg p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400" />
              <span className="text-red-400 font-medium text-sm md:text-base">Gap Analysis</span>
            </div>
            <p className="text-white text-sm md:text-base">
              Your IOR is {iorScore}%. Your biggest obstacle: {lowestPillar.name} ({lowestPillar.score}%)
            </p>
          </div>

          {/* Vital Aggregates - Monthly Metrics */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 text-xs md:text-sm">
            <div className="bg-green-900 bg-opacity-30 border border-green-500 border-opacity-30 rounded-lg p-2 md:p-3">
              <div className="text-gray-400 font-medium truncate">Monthly Income</div>
              <div className="text-lg md:text-xl font-bold text-green-300">{(monthlyIncome / 1000000).toFixed(1)}M</div>
            </div>
            <div className="bg-red-900 bg-opacity-30 border border-red-500 border-opacity-30 rounded-lg p-2 md:p-3">
              <div className="text-gray-400 font-medium truncate">Monthly Expense</div>
              <div className="text-lg md:text-xl font-bold text-red-300">{(monthlyExpense / 1000000).toFixed(1)}M</div>
            </div>
            <div className={`rounded-lg p-2 md:p-3 border ${monthlyNet > 0 ? 'bg-blue-900 bg-opacity-30 border-blue-500 border-opacity-30' : 'bg-orange-900 bg-opacity-30 border-orange-500 border-opacity-30'}`}>
              <div className="text-gray-400 font-medium truncate">Monthly Net</div>
              <div className={`text-lg md:text-xl font-bold ${monthlyNet > 0 ? 'text-blue-300' : 'text-orange-300'}`}>
                {monthlyNet > 0 ? '+' : ''}{(monthlyNet / 1000000).toFixed(1)}M
              </div>
            </div>
            <div className={`rounded-lg p-2 md:p-3 border ${savingsRate > 30 ? 'bg-emerald-900 bg-opacity-30 border-emerald-500 border-opacity-30' : savingsRate > 15 ? 'bg-yellow-900 bg-opacity-30 border-yellow-500 border-opacity-30' : 'bg-gray-700 bg-opacity-30 border-gray-500 border-opacity-30'}`}>
              <div className="text-gray-400 font-medium truncate">Savings Rate</div>
              <div className={`text-lg md:text-xl font-bold ${savingsRate > 30 ? 'text-emerald-300' : savingsRate > 15 ? 'text-yellow-300' : 'text-gray-300'}`}>
                {savingsRate.toFixed(1)}%
              </div>
            </div>
            <div className="bg-purple-900 bg-opacity-30 border border-purple-500 border-opacity-30 rounded-lg p-2 md:p-3">
              <div className="text-gray-400 font-medium truncate">Transactions</div>
              <div className="text-lg md:text-xl font-bold text-purple-300">{monthlyTransactions.length}</div>
            </div>
          </div>
        </div>

        {/* Icon Command Bar: 7 Icons in Single Horizontal Row */}
        <div className="flex gap-3 items-center overflow-x-auto pb-2">
          {/* Icon 1: Journey Progress */}
          <button
            onClick={() => setShowJourneyDetails(!showJourneyDetails)}
            className="flex-shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg shadow-blue-500/30 cursor-pointer group relative"
            title="Journey Progress"
          >
            <Building className="w-7 h-7 text-white" />
            <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              Stage {currentJourneyStage}
            </div>
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
          </button>

          {/* Icon 2: Financial Reports */}
          <button
            onClick={() => setShowFinancialAnalytics(!showFinancialAnalytics)}
            className="flex-shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center hover:from-orange-600 hover:to-red-700 transition-all shadow-lg shadow-orange-500/30 cursor-pointer group relative"
            title="Financial Reports"
          >
            <BarChart3 className="w-7 h-7 text-white" />
            <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              Reports
            </div>
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-orange-400 rounded-full animate-pulse"></div>
          </button>

          {/* Icon 3: Loan & Tithe */}
          <button
            onClick={() => setShowBusinessLoanCalculator(!showBusinessLoanCalculator)}
            className="flex-shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center hover:from-purple-600 hover:to-indigo-700 transition-all shadow-lg shadow-purple-500/30 cursor-pointer group relative"
            title="Loan & Tithe Tools"
          >
            <Briefcase className="w-7 h-7 text-white" />
            <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              Loan & Tithe
            </div>
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-purple-400 rounded-full animate-pulse"></div>
          </button>

          {/* Icon 4: Business Loan Calculator */}
          <button
            onClick={() => setShowBusinessLoanCalculator(!showBusinessLoanCalculator)}
            className="flex-shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center hover:from-teal-600 hover:to-cyan-700 transition-all shadow-lg shadow-teal-500/30 cursor-pointer group relative"
            title="Business Loan Calculator"
          >
            <DollarSign className="w-7 h-7 text-white" />
            <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              Loan Calc
            </div>
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-cyan-400 rounded-full animate-pulse"></div>
          </button>

          {/* Icon 5: Tithing Manager */}
          <button
            onClick={() => setShowTithingCalculator(!showTithingCalculator)}
            className="flex-shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 flex items-center justify-center hover:from-yellow-600 hover:to-amber-700 transition-all shadow-lg shadow-yellow-500/30 cursor-pointer group relative"
            title="Tithing Manager"
          >
            <Heart className="w-7 h-7 text-white" />
            <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              Tithe
            </div>
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-yellow-400 rounded-full animate-pulse"></div>
          </button>

          {/* Icon 6: Advanced Reporting System */}
          <button
            onClick={() => setShowReportingSystem(!showReportingSystem)}
            className="flex-shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center hover:from-red-600 hover:to-pink-700 transition-all shadow-lg shadow-red-500/30 cursor-pointer group relative"
            title="Advanced Reporting"
          >
            <PieChart className="w-7 h-7 text-white" />
            <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              Reports Adv
            </div>
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-red-400 rounded-full animate-pulse"></div>
          </button>

          {/* Icon 7: ICAN AI Assistant */}
          <button
            onClick={() => setShowAIChat(!showAIChat)}
            className="flex-shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center hover:from-violet-600 hover:to-purple-700 transition-all shadow-lg shadow-violet-500/30 cursor-pointer group relative"
            title="ICAN AI Assistant"
          >
            <Brain className="w-7 h-7 text-white" />
            <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              AI Advisor
            </div>
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-violet-400 rounded-full animate-pulse"></div>
          </button>
        </div>

        {/* Expanded Content Areas (appear below icons) */}
        <div className="space-y-4">
          {/* Journey Details Panel */}
          {showJourneyDetails && (
            <div className="glass-card p-6 border-l-4 border-blue-500">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Building className="w-5 h-5 text-blue-400" />
                  Journey Progress
                </h3>
                <button onClick={() => setShowJourneyDetails(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <JourneyProgressTracker 
                journeyStages={journeyStages}
                currentStage={currentJourneyStage}
                stageProgress={stageProgress}
                journeyInsights={journeyInsights}
                netWorth={netWorth}
              />
            </div>
          )}

          {/* Financial Analytics Panel */}
          {showFinancialAnalytics && (
            <div className="glass-card p-6 border-l-4 border-orange-500">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-orange-400" />
                  Financial Reports & Analytics
                </h3>
                <button onClick={() => setShowFinancialAnalytics(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-blue-900 bg-opacity-30 border border-blue-500 border-opacity-30 rounded-lg p-4">
                  <div className="text-blue-400 font-semibold mb-3">Monthly Summary</div>
                  <div className="space-y-2 text-sm text-gray-300">
                    <div>Income: <span className="text-green-400 font-bold">{(monthlyIncome / 1000000).toFixed(1)}M</span></div>
                    <div>Expense: <span className="text-red-400 font-bold">{(monthlyExpense / 1000000).toFixed(1)}M</span></div>
                    <div>Net: <span className={`${monthlyNet > 0 ? 'text-green-400' : 'text-red-400'} font-bold`}>{(monthlyNet / 1000000).toFixed(1)}M</span></div>
                    <div>Savings Rate: <span className="text-yellow-400 font-bold">{savingsRate.toFixed(1)}%</span></div>
                  </div>
                </div>
                <div className="bg-purple-900 bg-opacity-30 border border-purple-500 border-opacity-30 rounded-lg p-4">
                  <div className="text-purple-400 font-semibold mb-3">Financial Health</div>
                  <div className="space-y-2 text-sm text-gray-300">
                    <div>Net Worth: <span className="text-green-400 font-bold">{(netWorth / 1000000).toFixed(1)}M</span></div>
                    <div>30-Day Velocity: <span className={`${netWorthVelocity > 0 ? 'text-green-400' : 'text-red-400'} font-bold`}>{(netWorthVelocity / 1000000).toFixed(1)}M</span></div>
                    <div>Transactions: <span className="text-blue-400 font-bold">{monthlyTransactions.length}</span></div>
                    <div>Goal Progress: <span className="text-purple-400 font-bold">{((netWorth / goals.targetNetWorth) * 100).toFixed(0)}%</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Loan & Tithe Tools Panel */}
          {showBusinessLoanCalculator && (
            <div className="glass-card p-6 border-l-4 border-purple-500">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-purple-400" />
                  Loan & Tithe Calculator
                </h3>
                <button onClick={() => setShowBusinessLoanCalculator(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <button
                  onClick={() => setShowTithingCalculator(true)}
                  className="p-4 bg-yellow-900 bg-opacity-30 border border-yellow-500 border-opacity-30 rounded-lg hover:bg-opacity-50 transition-all text-left"
                >
                  <div className="text-lg mb-2">🙏 Tithe Calculator</div>
                  <div className="text-sm text-gray-300">Calculate your tithe percentage</div>
                </button>
                <button
                  onClick={() => setShowBusinessLoanCalculator(true)}
                  className="p-4 bg-indigo-900 bg-opacity-30 border border-indigo-500 border-opacity-30 rounded-lg hover:bg-opacity-50 transition-all text-left"
                >
                  <div className="text-lg mb-2">💼 Loan Calculator</div>
                  <div className="text-sm text-gray-300">Calculate loan payments & interest</div>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Smart Transaction Entry */}
        <TransactionInput 
          onAddTransaction={handleAddTransaction}
          isListening={isListening}
          onToggleListening={handleToggleListening}
          typingFeedback={typingFeedback}
          onInputChange={handleTypingFeedback}
          isVoiceSupported={isVoiceSupported}
          netWorth={netWorth}
          netWorthTrend={netWorthTrend}
          intelligentRecommendations={intelligentRecommendations}
          transactions={transactions}
          analyzeOpportunity={analyzeOpportunity}
        />

        {/* Net Worth Velocity & Tithing Status */}
        <div className="grid md:grid-cols-3 gap-4">
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

          {/* Tithing Status Card */}
          <div className="glass-card p-4 cursor-pointer hover:bg-opacity-20 transition-all" onClick={() => setShowTithingCalculator(true)}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🙏</span>
              <span className="text-white font-medium">Faithfulness</span>
            </div>
            {(() => {
              // Safe handling of transactions array
              const safeTransactions = transactions || [];
              
              const incomeTotal = safeTransactions.filter(t => t.type === 'income' || t.amount > 0)
                .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
              const tithingTotal = safeTransactions.filter(t => 
                (t.description || '').toLowerCase().includes('tithe') || 
                (t.description || '').toLowerCase().includes('offering') ||
                (t.description || '').toLowerCase().includes('church') ||
                (t.category || '').toLowerCase().includes('giving')
              ).reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
              const tithingRate = incomeTotal > 0 ? (tithingTotal / incomeTotal) * 100 : 0;
              const faithfulnessScore = Math.min(100, (tithingRate / 10) * 100);
              
              return (
                <>
                  <div className={`text-2xl font-bold ${
                    faithfulnessScore >= 100 ? 'text-green-400' :
                    faithfulnessScore >= 80 ? 'text-blue-400' :
                    faithfulnessScore >= 50 ? 'text-yellow-400' : 'text-orange-400'
                  }`}>
                    {faithfulnessScore.toFixed(0)}%
                  </div>
                  <div className="text-sm text-gray-300">
                    {tithingRate.toFixed(1)}% given • Click to tithe
                  </div>
                </>
              );
            })()}
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

        {/* AI Wealth Advisor & Multimedia Manager - Same Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
          <div className="glass-card p-4">
            <AIMultimediaManager
              transactions={transactions}
              netWorth={netWorth}
              currentJourneyStage={currentJourneyStage}
              onDataUpdate={(data) => setMultimediaData(prev => ({ ...prev, ...data }))}
            />
          </div>
        </div>

        {/* Smart Data Management & Creative AI */}
        <SmartDataManager
          transactions={transactions}
          multimediaData={multimediaData}
          netWorth={netWorth}
          currentJourneyStage={currentJourneyStage}
          journeyStages={journeyStages}
        />

        {/* CMMS (Computerized Maintenance Management System) */}
        <CMMSModule
          onDataUpdate={(data) => setCmmsData(prev => ({ ...prev, ...data }))}
          netWorth={netWorth}
          currentJourneyStage={currentJourneyStage}
        />

        {/* AI Financial Intelligence Dashboard */}
        <AIFinancialIntelligenceDashboard
          intelligence={financialIntelligence}
          recommendations={intelligentRecommendations}
          loanOpportunities={smartLoanOpportunities}
          netWorth={netWorth}
          trend={netWorthTrend}
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
                {(aiAdvice.suggestions || []).slice(0, 2).map((suggestion, index) => (
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

        {/* Pillars Status - MOVED TO SETTINGS */}
        {/* COMMENTED OUT - View in Settings Tab
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
        */}
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

  const renderSettings = () => {
    const scores = getPillarScores();
    
    return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Settings className="w-6 h-6 text-gray-400" />
          <h2 className="text-xl font-semibold text-white">Settings</h2>
        </div>

        <div className="space-y-6">
          {/* Readiness Pillars - Moved from Dashboard */}
          <div className="bg-blue-500 bg-opacity-20 border border-blue-500 border-opacity-30 rounded-lg p-4">
            <h3 className="text-blue-400 font-semibold mb-4">📊 Readiness Pillars</h3>
            
            <div className="space-y-3">
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
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900">
      {/* Main Navigation & Header */}
      <MainNavigation 
        onTrustClick={() => setShowTRUST(true)} 
        onShareClick={() => setShowSHARE(true)}
        onWalletClick={() => setShowWallet(true)}
      />

      {/* TRUST Section - Show when TRUST is activated */}
      {showTRUST && (
        <div className="fixed inset-0 z-[1000] bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 overflow-y-auto">
          <button
            onClick={() => setShowTRUST(false)}
            className="fixed top-4 right-4 z-[1001] px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg"
          >
            Close TRUST
          </button>
          <SACCOHub />
        </div>
      )}

      {/* SHARE Section - Show when SHARE is activated */}
      {showSHARE && (
        <div className="fixed inset-0 z-[1000] overflow-y-auto">
          <SHAREHub onClose={() => setShowSHARE(false)} />
        </div>
      )}

      {/* Wallet Section - Show when Wallet is activated */}
      {showWallet && (
        <div className="fixed inset-0 z-[1000] overflow-y-auto">
          <button
            onClick={() => setShowWallet(false)}
            className="fixed top-4 right-4 z-[1001] px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg"
          >
            Close Wallet
          </button>
          <ICANWallet />
        </div>
      )}

      {/* Navigation */}
      <nav className="glass-card mx-4 mt-4 p-4 overflow-visible" style={{ overflow: 'visible' }}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold gradient-text">ICAN Capital Engine - Dashboard</h1>
              <p className="text-xs text-gray-300">From Volatility to Global Capital</p>
            </div>
          </div>

          {/* Status Carousel in Top-Right (WhatsApp style) */}
          <div className="hidden md:flex gap-2 items-center flex-nowrap min-w-0">
            <StatusCarousel />
            {/* Profile Picture with Edit & Status Buttons */}
            <div className="relative group flex-shrink-0">
              {/* Avatar */}
              <div
                onClick={() => {}}
                className="relative w-10 h-10 rounded-full overflow-hidden ring-2 ring-white ring-opacity-30 cursor-pointer hover:ring-opacity-50 transition-all flex-shrink-0"
              >
                <img
                  src={profile?.avatar_url}
                  alt={profile?.full_name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.src = `https://ui-avatars.com/api/?name=${profile?.full_name || 'User'}`;
                  }}
                />
              </div>

              {/* Add Status Button - Bottom Right of Avatar */}
              <button
                onClick={() => setShowStatusUploader(true)}
                className="absolute -bottom-1 -right-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-full p-1 shadow-lg transition-all"
                title="Add status"
              >
                <Plus className="w-2.5 h-2.5 text-white" />
              </button>

              {/* Edit Profile Button - Top Right of Avatar */}
              <button
                onClick={() => setShowProfilePage(true)}
                className="absolute -top-1 -right-1 bg-blue-500 hover:bg-blue-600 rounded-full p-1 shadow-lg transition-all hidden group-hover:flex"
                title="Edit profile"
              >
                <Edit2 className="w-2.5 h-2.5 text-white" />
              </button>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
            { id: 'security', label: 'Security', icon: Shield },
            { id: 'readiness', label: 'Readiness', icon: Globe },
            { id: 'growth', label: 'Growth', icon: TrendingUp },
            { id: 'trust', label: 'Trust', icon: Heart },
            { id: 'share', label: 'Share', icon: Send },
            { id: 'wallet', label: 'Wallet', icon: DollarSign },
            { id: 'settings', label: 'Settings', icon: Settings }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === 'trust') setShowTRUST(true);
                else if (tab.id === 'share') setShowSHARE(true);
                else if (tab.id === 'wallet') setShowWallet(true);
                else setActiveTab(tab.id);
              }}
              className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded-lg transition-colors whitespace-nowrap text-sm md:text-base ${
                activeTab === tab.id 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-white bg-opacity-10 text-gray-300 hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4 flex-shrink-0" />
              <span className="hidden md:inline">{tab.label}</span>
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

      {/* Business Loan Calculator Modal */}
      <BusinessLoanCalculator
        isOpen={showBusinessLoanCalculator}
        onClose={() => {
          setShowBusinessLoanCalculator(false);
          setLoanTransactionData(null); // Clear pre-filled data
        }}
        preFilledData={loanTransactionData}
        onAddLoan={(loan) => {
          setBusinessLoans([...businessLoans, { ...loan, id: Date.now() }]);
          
          // Create comprehensive loan transaction
          const loanTransaction = {
            id: transactions.length,
            amount: loan.amount,
            description: loanTransactionData?.description || `Business Loan - ${loan.purpose}`,
            category: 'business_loan',
            subCategory: loan.purpose,
            type: 'loan',
            date: new Date().toISOString().split('T')[0],
            timestamp: new Date().getTime(),
            isLoan: true,
            loanDetails: {
              loanType: 'business_loan',
              purpose: loan.purpose,
              monthlyPayment: loan.monthlyPayment,
              interestRate: loan.interestRate,
              term: loan.term,
              totalPayment: loan.totalPayment,
              totalInterest: loan.totalInterest,
              riskLevel: loan.riskLevel,
              isWorthwhile: loan.isWorthwhile,
              calculatedAt: new Date().toISOString(),
              businessMetrics: loan.businessMetrics
            },
            source: loanTransactionData?.source || 'business_calculator'
          };
          
          setTransactions([...transactions, loanTransaction]);
          
          // Show success message
          setAiAdvice(standardizeAdvice({
            title: "✅ Business Loan Analyzed",
            message: `Loan of UGX ${loan.amount.toLocaleString()} successfully analyzed and added. Monthly payment: UGX ${loan.monthlyPayment.toLocaleString()}.`,
            recommendation: `Risk Level: ${loan.riskLevel}. ${loan.isWorthwhile ? 'This loan appears beneficial for your business.' : 'Consider reviewing terms or exploring alternatives.'}`,
            urgency: 'low',
            color: loan.isWorthwhile ? 'green' : 'orange'
          }));
          
          setTimeout(() => setAiAdvice(null), 8000);
        }}
      />

      {/* Business Tithing Calculator Modal */}
      <BusinessTithingCalculator
        transactions={transactions}
        isOpen={showTithingCalculator}
        onClose={() => setShowTithingCalculator(false)}
        onAddTithingTransaction={(tithingData) => {
          const tithingTransaction = {
            id: transactions.length,
            amount: -Math.abs(tithingData.amount), // Negative for expense
            description: tithingData.description,
            category: tithingData.type === 'business' ? 'business-giving' : 'giving',
            type: 'expense',
            date: new Date().toISOString().split('T')[0],
            isTithe: true
          };
          setTransactions([...transactions, tithingTransaction]);
          setShowTithingCalculator(false);
        }}
      />

      {/* Advanced Reporting System Modal */}
      <AdvancedReportingSystem
        transactions={transactions}
        isOpen={showReportingSystem}
        onClose={() => setShowReportingSystem(false)}
        netWorth={netWorth}
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

      {/* Floating Action Buttons - COMMENTED OUT: Using horizontal icon bar instead */}
      {/* 
      <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-4">
        {/* Business Loan Calculator Button */}
        {/*
        <button
          onClick={() => setShowBusinessLoanCalculator(true)}
          className="group relative w-14 h-14 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 flex items-center justify-center"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full blur opacity-70 group-hover:opacity-100 transition-opacity"></div>
          <span className="relative text-white text-xl">💼</span>
          
          {/* Tooltip */}
        {/*
          <div className="absolute bottom-16 right-0 bg-gray-900 text-white text-xs py-2 px-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Business Loan Calculator - Smart financing decisions
            <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
          </div>
        </button>

        {/* Tithing Calculator Button */}
        {/*
        <button
          onClick={() => setShowTithingCalculator(true)}
          className="group relative w-14 h-14 bg-gradient-to-r from-green-500 to-emerald-600 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 flex items-center justify-center"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full blur opacity-70 group-hover:opacity-100 transition-opacity"></div>
          <span className="relative text-white text-xl">🙏</span>
          
          {/* Tooltip */}
        {/*
          <div className="absolute bottom-16 right-0 bg-gray-900 text-white text-xs py-2 px-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Business Tithing Manager - Separate business & personal giving
            <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
          </div>
        </button>

        {/* Advanced Reporting System Button */}
        {/*
        <button
          onClick={() => setShowReportingSystem(true)}
          className="group relative w-14 h-14 bg-gradient-to-r from-orange-500 to-red-600 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 flex items-center justify-center"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-red-500 rounded-full blur opacity-70 group-hover:opacity-100 transition-opacity"></div>
          <span className="relative text-white text-xl">📊</span>
          
          {/* Tooltip */}
        {/*
          <div className="absolute bottom-16 right-0 bg-gray-900 text-white text-xs py-2 px-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Advanced Reports - PDF, Excel, CSV exports
            <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
          </div>
        </button>

        {/* AI Chat Button */}
        {/*
        <button
          onClick={() => setShowAIChat(true)}
          className="group relative w-14 h-14 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 flex items-center justify-center"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full blur opacity-70 group-hover:opacity-100 transition-opacity"></div>
          <Bot className="relative w-6 h-6 text-white" />
          
          {/* Pulsing notification dot */}
        {/*
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-pulse flex items-center justify-center">
            <div className="w-2 h-2 bg-white rounded-full"></div>
          </div>
          
          {/* Tooltip */}
        {/*
          <div className="absolute bottom-16 right-0 bg-gray-900 text-white text-xs py-2 px-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            💬 Chat with ICAN AI
            <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
          </div>
        </button>
      </div>
      */}

      {/* Profile Page Modal */}
      {showProfilePage && (
        <div className="fixed inset-0 bg-black/40 z-[1000]" onClick={() => setShowProfilePage(false)}>
          <div className="fixed inset-0 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <ProfilePage 
              onClose={() => setShowProfilePage(false)}
              onLogout={() => {
                setShowProfilePage(false);
                // Logout will be handled by AuthContext and redirect will happen
              }}
            />
          </div>
        </div>
      )}

      {/* Status Feed Page */}
      {showStatusPage && (
        <div className="fixed inset-0 z-[999]" onClick={() => setShowStatusPage(false)}>
          <div className="fixed inset-0 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <StatusPage 
              onGoBack={() => setShowStatusPage(false)}
            />
          </div>
        </div>
      )}

      {/* Status Uploader Modal */}
      {showStatusUploader && (
        <StatusUploader
          onClose={() => setShowStatusUploader(false)}
          onStatusCreated={() => {
            setShowStatusUploader(false);
            // Trigger status refresh in StatusViewerUI
            setStatusRefresh(prev => prev + 1);
          }}
        />
      )}

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