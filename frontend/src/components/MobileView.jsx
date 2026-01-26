import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MoreVertical,
  Building,
  BarChart3,
  Zap,
  Brain,
  MessageCircle,
  Wallet,
  User,
  User2,
  Briefcase,
  Lock,
  Settings,
  Home,
  TrendingUp,
  DollarSign,
  Heart,
  PieChart,
  ChevronLeft,
  ChevronRight,
  Dot,
  Shield,
  CheckCircle,
  Zap as Zap2,
  Eye,
  Badge,
  Mail,
  Phone,
  Edit2,
  Save,
  X,
  Calendar,
  ChevronDown,
  Crown,
  Rocket
} from 'lucide-react';
import SmartTransactionEntry from './SmartTransactionEntry';
import { ProfilePage } from './auth/ProfilePage';
import Pitchin from './Pitchin';
import ICANWallet from './ICANWallet';
import TrustSystem from './TrustSystem';
import CMMSModule from './CMSSModule';
import { VelocityEngine } from '../utils/velocityEngine';
import { supabase } from '../lib/supabase/client';

const MobileView = ({ userProfile }) => {
  const [activeSlide, setActiveSlide] = useState(0);
  const [currentBalance, setCurrentBalance] = useState('156,002');
  const [activeBottomTab, setActiveBottomTab] = useState('wallet');
  const [showTransactionEntry, setShowTransactionEntry] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [showMenuDropdown, setShowMenuDropdown] = useState(false);
  const [activeMenuTab, setActiveMenuTab] = useState('security');
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [treasurySubTab, setTreasurySubTab] = useState('account');
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [showPitchinPanel, setShowPitchinPanel] = useState(false);
  const [showWalletPanel, setShowWalletPanel] = useState(false);
  const [mobileError, setMobileError] = useState(null);

  // Error handling for mobile view
  useEffect(() => {
    const handleMobileError = (error) => {
      console.error('🔴 Mobile View Error:', error);
      setMobileError(error.message || 'Something went wrong');
    };

    window.addEventListener('error', handleMobileError);
    return () => window.removeEventListener('error', handleMobileError);
  }, []);

  if (mobileError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Error Loading Mobile View</h1>
          <p className="text-gray-400 mb-4">{mobileError}</p>
          <button
            onClick={() => {
              setMobileError(null);
              window.location.reload();
            }}
            className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg font-medium"
          >
            Reload App
          </button>
        </div>
      </div>
    );
  }
  const [showTrustPanel, setShowTrustPanel] = useState(false);
  const [showCmmsPanel, setShowCmmsPanel] = useState(false);
  
  // Account Edit State
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileFormData, setProfileFormData] = useState({
    name: userProfile?.name || 'GANTA ELON',
    email: userProfile?.email || 'gantaelon@gmail.com',
    phone: userProfile?.phone || '',
    incomeLevel: userProfile?.incomeLevel || '',
    financialGoal: userProfile?.financialGoal || '',
    riskTolerance: userProfile?.riskTolerance || 'moderate'
  });

  // Privacy Settings State
  const [privacySettings, setPrivacySettings] = useState({
    profileVisibility: 'public',
    transactionPrivacy: 'private',
    dataSharing: false,
    marketingComms: true
  });

  // Verification State
  const [verificationStatus, setVerificationStatus] = useState({
    emailVerified: true,
    phoneVerified: false,
    twoFactorEnabled: true,
    biometricEnabled: true
  });

  // Contract Verification State
  const [contractText, setContractText] = useState('');
  const [contractAnalysis, setContractAnalysis] = useState(null);
  const [isAnalyzingContract, setIsAnalyzingContract] = useState(false);
  const [contractError, setContractError] = useState('');
  const [contractVerificationDates, setContractVerificationDates] = useState({
    emailVerified: 'Jan 15, 2026',
    phoneVerified: 'Jan 10, 2026',
    identityVerified: 'Pending'
  });


  const carouselRef = useRef(null);
  const [velocityMetrics, setVelocityMetrics] = useState(null);
  
  // Time Period Selector State - Each can collapse independently
  const [expandedPeriods, setExpandedPeriods] = useState({
    daily: false,
    weekly: false,
    monthly: false,
    yearly: false
  });

  // Metric Dropdowns State - for each metric
  const [metricDropdowns, setMetricDropdowns] = useState({
    income: false,
    expense: false,
    netProfit: false,
    transactions: false,
    savingsRate: false,
    netWorth: false,
    roi: false
  });

  // Metric Period Data - stores daily/weekly/monthly/yearly data
  const [metricPeriodData, setMetricPeriodData] = useState({
    income: { daily: 0, weekly: 0, monthly: 0, yearly: 0, loading: false },
    expense: { daily: 0, weekly: 0, monthly: 0, yearly: 0, loading: false },
    netProfit: { daily: 0, weekly: 0, monthly: 0, yearly: 0, loading: false },
    transactions: { daily: 0, weekly: 0, monthly: 0, yearly: 0, loading: false },
    savingsRate: { daily: '0%', weekly: '0%', monthly: '0%', yearly: '0%', loading: false },
    netWorth: { daily: 0, weekly: 0, monthly: 0, yearly: 0, loading: false },
    roi: { daily: '0%', weekly: '0%', monthly: '0%', yearly: '0%', loading: false }
  });

  // Modal State Variables (7 action button modals)
  const [showJourneyDetails, setShowJourneyDetails] = useState(false);
  const [showFinancialAnalytics, setShowFinancialAnalytics] = useState(false);
  const [showBusinessLoanCalculator, setShowBusinessLoanCalculator] = useState(false);
  const [showWalletAccounts, setShowWalletAccounts] = useState(false);
  const [showTithingCalculator, setShowTithingCalculator] = useState(false);
  const [showReportingSystem, setShowReportingSystem] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);

  // AI Chat state
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInputMessage, setAiInputMessage] = useState('');
  const [aiIsThinking, setAiIsThinking] = useState(false);

  // Business Loan Calculator state
  const [loanAmount, setLoanAmount] = useState('10000000');
  const [interestRate, setInterestRate] = useState('18');
  const [loanTerm, setLoanTerm] = useState('3');
  const [loanPurpose, setLoanPurpose] = useState('business-expansion');
  const [monthlyRevenue, setMonthlyRevenue] = useState('5000000');
  const [operatingExpenses, setOperatingExpenses] = useState('500000');
  const [employeeSalaries, setEmployeeSalaries] = useState('800000');
  const [rentUtilities, setRentUtilities] = useState('300000');
  const [marketingCosts, setMarketingCosts] = useState('200000');
  const [inventoryCosts, setInventoryCosts] = useState('1500000');
  const [businessType, setBusinessType] = useState('retail');
  const [currentTaxRate, setCurrentTaxRate] = useState('30');
  const [vatRate, setVatRate] = useState('18');
  const [payeDeductions, setPayeDeductions] = useState('100000');
  const [existingDebts, setExistingDebts] = useState('400000');
  const [tithePercentage, setTithePercentage] = useState('10');

  // Tithing Calculator state
  const [businessTithingRate, setBusinessTithingRate] = useState(10);
  const [personalTithingRate, setPersonalTithingRate] = useState(10);
  const [selectedTithingTab, setSelectedTithingTab] = useState('quick');

  // Advanced Reporting System state
  const [selectedReportType, setSelectedReportType] = useState('financial-summary');
  const [dateRange, setDateRange] = useState('current-month');
  const [exportFormat, setExportFormat] = useState('pdf');
  const [reportTitle, setReportTitle] = useState('ICAN Financial Report');

  // Calculate Tithing Metrics
  const calculateTithingMetrics = () => {
    const totalIncome = parseFloat(monthlyRevenue) || 0;
    const personalIncome = velocityMetrics?.income30Days || 0;
    const businessProfit = (totalIncome - (parseFloat(operatingExpenses) || 0 + parseFloat(inventoryCosts) || 0));
    
    const requiredTithe = (totalIncome * tithePercentage) / 100;
    const personalTithe = (personalIncome * personalTithingRate) / 100;
    const businessTithe = (Math.max(0, businessProfit) * businessTithingRate) / 100;
    
    return {
      totalIncome,
      businessProfit: Math.max(0, businessProfit),
      personalIncome,
      requiredTithe,
      personalTithe,
      businessTithe,
      combinedTithe: personalTithe + businessTithe
    };
  };

  const tithingMetrics = calculateTithingMetrics();

  // Report types configuration
  const reportTypes = {
    'financial-summary': { name: '📊 Financial Summary', icon: '📊', desc: 'Complete overview with KPIs' },
    'income-analysis': { name: '💰 Income Report', icon: '💰', desc: 'Income analysis with projections' },
    'expense-breakdown': { name: '💸 Expense Analytics', icon: '💸', desc: 'Spending patterns & optimization' },
    'cash-flow': { name: '🔄 Cash Flow', icon: '🔄', desc: 'Monthly cash flow analysis' },
    'tithe-report': { name: '⛪ Tithe Report', icon: '⛪', desc: 'Giving & stewardship tracking' },
    'loan-analysis': { name: '🏦 Loan Portfolio', icon: '🏦', desc: 'Debt analysis & optimization' },
    'business-performance': { name: '📈 Business Intel', icon: '📈', desc: 'Business KPIs & metrics' },
    'tax-preparation': { name: '🧾 Tax Statements', icon: '🧾', desc: 'Tax-ready statements' },
    'wealth-journey': { name: '🚀 Wealth Journey', icon: '🚀', desc: 'Milestone tracking' },
    'investment-analysis': { name: '💼 Investment', icon: '💼', desc: 'ROI & performance' },
    'real-estate': { name: '🏠 Real Estate', icon: '🏠', desc: 'Property portfolio' },
    'custom-analysis': { name: '🔧 Custom', icon: '🔧', desc: 'Personalized insights' }
  };

  // Generate report summary
  const generateReportSummary = () => {
    const type = reportTypes[selectedReportType];
    const income = velocityMetrics?.income30Days || 0;
    const expenses = velocityMetrics?.expenses30Days || 0;
    const profit = income - expenses;
    const savingsRate = income > 0 ? ((profit / income) * 100) : 0;
    
    return {
      type: selectedReportType,
      title: reportTitle,
      dateRange,
      exportFormat,
      metrics: {
        totalIncome: income,
        totalExpenses: expenses,
        netProfit: profit,
        savingsRate: savingsRate,
        netWorth: velocityMetrics?.netWorth || 0,
        velocity: velocityMetrics?.velocity30Days || 0
      },
      reportName: type.name,
      generated: new Date().toLocaleDateString()
    };
  };

  const reportSummary = generateReportSummary();

  // Initialize AI chat with welcome message
  useEffect(() => {
    if (showAIChat && aiMessages.length === 0) {
      const welcomeMessage = {
        id: Date.now(),
        type: 'ai',
        content: `🤖 Hello, friend! I'm your ICAN AI companion, here to support your financial journey with God's wisdom.

I can see you're in the **Survival Stage** - what a blessing! God is building something beautiful in your life.

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
      setAiMessages([welcomeMessage]);
    }
  }, [showAIChat]);

  // Load VelocityEngine data on component mount
  useEffect(() => {
    const loadFinancialMetrics = async () => {
      try {
        if (userProfile?.id) {
          const engine = new VelocityEngine(userProfile.id);
          await engine.loadTransactions();
          const metrics = engine.calculateMetrics();
          console.log('📊 VelocityEngine Metrics:', metrics);
          setVelocityMetrics(metrics);
        }
      } catch (error) {
        console.error('Error loading financial metrics:', error);
      }
    };

    loadFinancialMetrics();
  }, [userProfile?.id]);

  // Process AI messages
  const processAIMessage = async (message) => {
    if (!message.trim()) return;

    const userMsg = {
      id: Date.now(),
      type: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };
    
    setAiMessages(prev => [...prev, userMsg]);
    setAiInputMessage('');
    setAiIsThinking(true);

    // Generate contextual AI response
    setTimeout(() => {
      const response = generateAIResponse(message);
      setAiMessages(prev => [...prev, response]);
      setAiIsThinking(false);
    }, 1000);
  };

  // Generate intelligent AI responses
  const generateAIResponse = (userMessage) => {
    const message = userMessage.toLowerCase();
    let response = '';
    let mood = 'helpful';

    if (message.includes('spend') || message.includes('buy') || message.includes('purchase')) {
      response = `🛒 **Let's think about this together!**\n\nI can see you're considering a purchase. That's wise to pause and ask for guidance!\n\n🙏 **God's perspective:** "The plans of the diligent lead to profit as surely as haste leads to poverty." - Proverbs 21:5\n\n✨ **Simple questions to ask yourself:**\n1. Is this a genuine NEED or just a WANT?\n2. Will this bring me closer to my goals or further away?\n3. Can I afford this without stress or worry?\n\n💪 **Remember:** You're doing great by even asking these questions! This shows wisdom.`;
      mood = 'advisory';
    } else if (message.includes('save') || message.includes('invest') || message.includes('money')) {
      response = `🚀 **Wealth Building Strategy!**\n\nAmazing that you're thinking about saving! Every UGX you save is a seed for your future.\n\n💡 **Optimal Strategy for Your Stage:**\n• Target: 50% needs, 30% wants, 20% savings\n• Build emergency fund first (3 months expenses)\n• Then focus on growing passive income\n\n🎯 **Quick Challenge:** Can you save an extra UGX 5,000 this week? That's UGX 260,000 per year!`;
      mood = 'encouraging';
    } else if (message.includes('goal') || message.includes('target') || message.includes('dream')) {
      response = `🎯 **Goal Achievement Protocol!**\n\nYour dreams matter! God wants you to prosper and live fully.\n\n🚀 **Action Steps:**\n1. Track your daily spending - awareness is power\n2. Eliminate one unnecessary expense this week\n3. Create an additional income stream\n4. Celebrate small wins - progress builds momentum\n\n💡 **Mindset Shift:** Think like an investor, not a consumer.`;
      mood = 'motivational';
    } else if (message.includes('help') || message.includes('advice') || message.includes('struggling')) {
      response = `💙 **I've got your back!**\n\nYou're not alone in this journey. Many people face these challenges.\n\n🙏 **Here's what I want you to know:**\n✨ Every setback is a setup for a comeback\n💪 Small progress is still progress\n🌟 You're stronger than you think\n❤️ This is all temporary - better days are coming\n\n**Daily Habit for Peace of Mind:**\n1. Track one transaction\n2. Celebrate one small win\n3. Pray/reflect on your progress`;
      mood = 'supportive';
    } else {
      response = `🤖 **Thinking about your situation...**\n\nI appreciate your question! Here's my insight for someone at your stage:\n\n💡 **Key Principle:** Every UGX saved is a seed that grows into financial freedom.\n\n✨ **Remember:** Progress over perfection. Small consistent actions lead to big results.\n\nWhat would you like to explore more?`;
      mood = 'conversational';
    }

    return {
      id: Date.now() + 1,
      type: 'ai',
      content: response,
      timestamp: new Date().toISOString(),
      mood: mood
    };
  };

  const getMoodColor = (mood) => {
    const colors = {
      advisory: 'text-yellow-300',
      encouraging: 'text-green-300',
      motivational: 'text-pink-300',
      supportive: 'text-blue-300',
      conversational: 'text-gray-300',
      helpful: 'text-purple-300'
    };
    return colors[mood] || 'text-white';
  };

  // Calculate Loan Metrics
  const calculateLoanMetrics = () => {
    const principal = parseFloat(loanAmount) || 0;
    const rate = (parseFloat(interestRate) || 0) / 100 / 12;
    const payments = (parseFloat(loanTerm) || 0) * 12;
    
    const grossMonthlyRevenue = parseFloat(monthlyRevenue) || 0;
    const monthlyOperating = parseFloat(operatingExpenses) || 0;
    const monthlySalaries = parseFloat(employeeSalaries) || 0;
    const monthlyRentUtilities = parseFloat(rentUtilities) || 0;
    const monthlyMarketing = parseFloat(marketingCosts) || 0;
    const monthlyInventory = parseFloat(inventoryCosts) || 0;
    const monthlyExistingDebts = parseFloat(existingDebts) || 0;
    
    const corporateTaxRate = parseFloat(currentTaxRate) || 30;
    const vatRateValue = parseFloat(vatRate) || 18;
    const payeMonthly = parseFloat(payeDeductions) || 0;
    const titheRate = parseFloat(tithePercentage) || 10;

    if (principal === 0 || rate === 0 || payments === 0) {
      return {
        monthlyPayment: 0,
        totalPayment: 0,
        totalInterest: 0,
        riskLevel: 'unknown',
        businessMetrics: {}
      };
    }

    // Loan Payment Calculation (using amortization formula)
    const loanMonthlyPayment = (principal * rate * Math.pow(1 + rate, payments)) / (Math.pow(1 + rate, payments) - 1);
    const totalPayment = loanMonthlyPayment * payments;
    const totalInterest = totalPayment - principal;

    // Business Analysis
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
    
    const breakEvenRevenue = totalMonthlyExpenses + totalTaxes + titheAmount;
    const profitMargin = grossMonthlyRevenue > 0 ? (finalNetProfit / grossMonthlyRevenue) * 100 : 0;
    const debtServiceRatio = grossMonthlyRevenue > 0 ? (loanMonthlyPayment / grossMonthlyRevenue) * 100 : 100;
    
    // Risk Assessment
    let riskLevel = 'low';
    if (parseFloat(interestRate) > 25 || debtServiceRatio > 40 || finalNetProfit < 0) riskLevel = 'high';
    else if (parseFloat(interestRate) > 18 || debtServiceRatio > 25 || profitMargin < 5) riskLevel = 'medium';

    return {
      monthlyPayment: loanMonthlyPayment,
      totalPayment,
      totalInterest,
      riskLevel,
      businessMetrics: {
        grossMonthlyRevenue,
        totalMonthlyExpenses,
        grossProfit,
        netProfitBeforeTax,
        netProfitAfterTax,
        finalNetProfit,
        totalTaxes,
        titheAmount,
        breakEvenRevenue,
        profitMargin,
        debtServiceRatio,
        vatOnSales,
        corporateTax
      }
    };
  };

  const loanMetrics = calculateLoanMetrics();

  // Get loan advice
  const getLoanAdvice = () => {
    if (!loanAmount || !interestRate || !loanTerm || !monthlyRevenue) {
      return {
        decision: 'INCOMPLETE ANALYSIS',
        message: 'Please provide loan details and business financials',
        color: 'text-gray-300'
      };
    }

    const businessMetrics = loanMetrics.businessMetrics || {};
    const cashFlow = businessMetrics.finalNetProfit || 0;
    const debtRatio = businessMetrics.debtServiceRatio || 0;
    const profitMargin = businessMetrics.profitMargin || 0;

    if (cashFlow < 0) {
      return {
        decision: '🚨 CRITICAL RISK',
        message: 'Negative cash flow - loan will worsen finances',
        color: 'text-red-300'
      };
    }

    if (debtRatio > 40) {
      return {
        decision: '⛔ EXCESSIVE DEBT',
        message: `Debt ratio ${debtRatio.toFixed(1)}% is too high`,
        color: 'text-red-300'
      };
    }

    if (parseFloat(interestRate) > 25) {
      return {
        decision: '💸 HIGH RATE',
        message: 'Interest rate above 25% will drain resources',
        color: 'text-red-300'
      };
    }

    if (profitMargin < 5 || debtRatio > 25) {
      return {
        decision: '⚠️ CAUTION',
        message: `Profit margin ${profitMargin.toFixed(1)}% requires monitoring`,
        color: 'text-yellow-300'
      };
    }

    if (cashFlow > loanMetrics.monthlyPayment * 2 && debtRatio < 20 && profitMargin > 10) {
      return {
        decision: '✅ EXCELLENT',
        message: 'Strong financials support this loan',
        color: 'text-green-300'
      };
    }

    return {
      decision: '👍 RECOMMENDED',
      message: 'Adequate cash flow and manageable debt',
      color: 'text-green-300'
    };
  };

  const loanAdvice = getLoanAdvice();

  // Fetch metric data by period from Supabase
  const fetchMetricDataByPeriod = async (metricType, days) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('ican_transactions')
        .select('amount, type')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('created_at', startDate.toISOString());

      if (error) {
        console.error('Error fetching metric data:', error);
        return null;
      }

      // Calculate metric based on type
      let result = 0;
      if (metricType === 'income') {
        result = data.filter(t => t.type === 'income').reduce((sum, t) => sum + (t.amount || 0), 0);
      } else if (metricType === 'expense') {
        result = data.filter(t => t.type === 'expense').reduce((sum, t) => sum + (t.amount || 0), 0);
      } else if (metricType === 'transactions') {
        result = data.length;
      }

      return result;
    } catch (error) {
      console.error('Error calculating metric:', error);
      return null;
    }
  };

  // Handle metric dropdown click - fetch data
  const handleMetricClick = async (metricKey) => {
    // Toggle dropdown
    setMetricDropdowns({...metricDropdowns, [metricKey]: !metricDropdowns[metricKey]});

    // Fetch data if not already loaded
    if (!metricDropdowns[metricKey] && !metricPeriodData[metricKey].daily) {
      setMetricPeriodData(prev => ({
        ...prev,
        [metricKey]: {...prev[metricKey], loading: true}
      }));

      // Fetch data for each period
      const dailyData = await fetchMetricDataByPeriod(metricKey, 1);
      const weeklyData = await fetchMetricDataByPeriod(metricKey, 7);
      const monthlyData = await fetchMetricDataByPeriod(metricKey, 30);
      const yearlyData = await fetchMetricDataByPeriod(metricKey, 365);

      setMetricPeriodData(prev => ({
        ...prev,
        [metricKey]: {
          daily: dailyData || 0,
          weekly: weeklyData || 0,
          monthly: monthlyData || 0,
          yearly: yearlyData || 0,
          loading: false
        }
      }));
    }
  };

  // Contract Analysis Function
  const analyzeContract = async () => {
    setContractError('');
    
    if (!contractText.trim()) {
      setContractError('Please paste contract or terms & conditions text');
      return;
    }

    if (contractText.trim().length < 50) {
      setContractError('Contract text must be at least 50 characters');
      return;
    }

    setIsAnalyzingContract(true);

    try {
      // Simulate Treasury Guardian analysis
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mock analysis results
      const analysis = {
        success: true,
        safetyScore: 7.2,
        riskLevel: 'MEDIUM',
        criticalRisks: [
          'Unlimited liability clause in section 4.2',
          'Automatic renewal with 30-day notice period'
        ],
        recommendations: [
          'Negotiate liability cap to 12 months fees',
          'Extend termination notice to 90 days',
          'Add mutual indemnification clause'
        ],
        keyTerms: {
          liabilityCap: 'Unlimited',
          paymentTerms: 'Monthly advance',
          terminationNotice: '30 days',
          jurisdiction: 'Uganda'
        },
        executiveSummary: 'Medium-risk contract with negotiable protective clauses. Requires discussion of liability limitations before signing.'
      };

      setContractAnalysis(analysis);
      console.log('✅ Contract analysis complete:', analysis);
    } catch (error) {
      setContractError('Failed to analyze contract. Please try again.');
      console.error('Contract analysis error:', error);
    } finally {
      setIsAnalyzingContract(false);
    }
  };

  // Financial metrics data
  const formatCurrency = (value) => {
    if (!value) return '0';
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toFixed(0);
  };

  const formatSavingsRate = (income, expenses) => {
    if (income === 0) return '0%';
    return `${((((income - expenses) / income) * 100).toFixed(1))}%`;
  };

  const financialMetrics = [
    { label: 'Income', value: formatCurrency(velocityMetrics?.income30Days || 0), icon: TrendingUp, color: 'from-green-500 to-emerald-600' },
    { label: 'Expense', value: formatCurrency(velocityMetrics?.expenses30Days || 0), icon: DollarSign, color: 'from-red-500 to-orange-600' },
    { label: 'Net Profit', value: formatCurrency(velocityMetrics?.velocity30Days || 0), icon: Heart, color: 'from-pink-500 to-red-600' }
  ];

  const secondMetrics = [
    { label: 'Transactions', value: velocityMetrics?.transactionCount || '0', icon: Briefcase, color: 'from-blue-500 to-cyan-600' },
    { label: 'Savings Rate', value: formatSavingsRate(velocityMetrics?.income30Days || 0, velocityMetrics?.expenses30Days || 0), icon: PieChart, color: 'from-purple-500 to-pink-600' },
    { label: 'Net Worth', value: formatCurrency(velocityMetrics?.netWorth || 0), icon: TrendingUp, color: 'from-yellow-500 to-orange-600' }
  ];

  const walletTabs = [
    { name: 'Ican Wallet', icon: Wallet },
    { name: 'Personal', icon: User2 },
    { name: 'Agent', icon: Settings },
    { name: 'Business', icon: Briefcase },
    { name: 'Trust', icon: Lock }
  ];

  // Menu Dropdown Data
  const menuOptions = {
    security: {
      label: 'Security',
      icon: Shield,
      items: ['Account', 'Privacy', 'Verification']
    },
    readiness: {
      label: 'Readiness',
      icon: CheckCircle,
      items: ['KYC Status', 'Documents', 'Compliance']
    },
    growth: {
      label: 'Growth',
      icon: TrendingUp,
      items: ['Investments', 'Analytics', 'Opportunities']
    }
  };

  const actionChips = [
    { label: 'Progress', icon: Building, color: 'bg-gradient-to-br from-blue-500 to-blue-600' },
    { label: 'Analytics', icon: BarChart3, color: 'bg-gradient-to-br from-orange-500 to-orange-600' },
    { label: 'Loans', icon: Briefcase, color: 'bg-gradient-to-br from-purple-500 to-purple-600' },
    { label: 'Wallet', icon: DollarSign, color: 'bg-gradient-to-br from-teal-500 to-teal-600' },
    { label: 'Tith', icon: Heart, color: 'bg-gradient-to-br from-yellow-500 to-yellow-600' },
    { label: 'Reports', icon: PieChart, color: 'bg-gradient-to-br from-rose-500 to-rose-600' },
    { label: 'ICAN AI', icon: Brain, color: 'bg-gradient-to-br from-violet-500 to-violet-600' }
  ];

  // Carousel content
  const carouselCards = [
    {
      title: 'Pitchin',
      description: 'Share your vision and connect with investors',
      color: 'from-purple-600 to-pink-600',
      icon: Briefcase,
      features: ['Business pitches', 'Investor connections', 'Growth opportunities']
    },
    {
      title: 'Wallet',
      description: 'Manage your digital assets',
      color: 'from-green-600 to-emerald-600',
      icon: Wallet,
      features: ['Multi-currency', 'Instant transfers', 'Security verified']
    }
  ];

  const handleCarouselScroll = (direction) => {
    if (carouselRef.current) {
      const scrollAmount = carouselRef.current.clientWidth;
      if (direction === 'next') {
        carouselRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        setActiveSlide((prev) => (prev + 1) % carouselCards.length);
      } else {
        carouselRef.current.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
        setActiveSlide((prev) => (prev - 1 + carouselCards.length) % carouselCards.length);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 text-white pb-28 overflow-x-hidden">
      {/* ====== HEADER ====== */}
      <div className="sticky top-0 z-40 bg-gradient-to-b from-slate-950/95 to-purple-950/80 backdrop-blur-md border-b border-purple-500/20">
        <div className="px-4 py-3">
          {/* Header Row - Recording Input, Branding & Settings */}
          <div className="flex items-center gap-3 w-full">
            {/* Recording Input Badge - CLICKABLE */}
            <button
              onClick={() => setShowTransactionEntry(true)}
              className="flex items-center gap-2 bg-purple-900/40 border border-purple-500/30 rounded-full px-3 py-2 hover:bg-purple-900/60 hover:border-purple-400/50 transition-all active:scale-95"
            >
              <Mic className="w-4 h-4 text-purple-400 flex-shrink-0" />
              <span className="text-xs text-gray-300 whitespace-nowrap">Record</span>
              <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse flex-shrink-0"></div>
            </button>

            {/* Spacer */}
            <div className="flex-1"></div>

            {/* IcanEra Branding */}
            <h1 className="text-sm font-black bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent whitespace-nowrap">
              IcanEra
            </h1>

            {/* Settings Menu - Relative positioned for dropdown */}
            <div className="relative">
              <button 
                onClick={() => setShowMenuDropdown(!showMenuDropdown)}
                className="p-1.5 hover:bg-purple-500/20 rounded-lg transition flex-shrink-0"
              >
                <MoreVertical className="w-5 h-5 text-purple-400" />
              </button>

              {/* Dropdown Menu */}
              {showMenuDropdown && (
                <div className="absolute right-0 top-full mt-2 bg-slate-900 border border-purple-500/30 rounded-lg shadow-2xl z-50 w-72 overflow-hidden">
                  {/* Tab Navigation */}
                  <div className="flex border-b border-purple-500/20">
                    {Object.entries(menuOptions).map(([key, option]) => {
                      const IconComponent = option.icon;
                      return (
                        <button
                          key={key}
                          onClick={() => setActiveMenuTab(key)}
                          className={`flex-1 px-3 py-3 text-sm font-medium transition flex items-center justify-center gap-2 ${
                            activeMenuTab === key
                              ? 'bg-purple-500/30 text-purple-300 border-b-2 border-purple-400'
                              : 'text-gray-400 hover:text-gray-300'
                          }`}
                        >
                          <IconComponent className="w-4 h-4" />
                          <span className="hidden sm:inline">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Menu Items - Collapsed, Click to View Full Page */}
                  <div className="p-2">
                    {menuOptions[activeMenuTab].items.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setSelectedDetail({ tab: activeMenuTab, item });
                          setShowMenuDropdown(false);
                        }}
                        className="w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-purple-500/20 hover:text-purple-300 rounded transition flex items-center justify-between"
                      >
                        <span>🔒 {item}</span>
                        <span className="text-xs">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ====== DETAIL PAGE - FULL WIDTH ====== */}
      {selectedDetail && (
        <div className="fixed inset-0 bg-black/60 z-40 flex items-end">
          <div className="bg-gradient-to-br from-slate-900 to-purple-900 w-full rounded-t-2xl p-6 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-purple-500/20">
              <div>
                <h2 className="text-2xl font-bold text-purple-300">
                  {selectedDetail.tab === 'security' && '🔒'} 
                  {selectedDetail.tab === 'readiness' && '📋'} 
                  {selectedDetail.tab === 'growth' && '🚀'} 
                  {' '}{selectedDetail.item}
                </h2>
                {selectedDetail.tab === 'security' && selectedDetail.item === 'Account' && (
                  <p className="text-xs text-gray-400 mt-1">Treasury Guardian • Account security & privacy controls</p>
                )}
              </div>
              <button
                onClick={() => setSelectedDetail(null)}
                className="text-2xl text-gray-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            {/* Treasury Guardian Tabs */}
            {selectedDetail.tab === 'security' && selectedDetail.item === 'Account' && (
              <div className="flex gap-2 mb-6 border-b border-purple-500/20">
                <button
                  onClick={() => setTreasurySubTab('account')}
                  className={`px-4 py-2 font-medium text-sm transition ${
                    treasurySubTab === 'account'
                      ? 'text-purple-300 border-b-2 border-purple-400'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Account
                </button>
                <button
                  onClick={() => setTreasurySubTab('privacy')}
                  className={`px-4 py-2 font-medium text-sm transition ${
                    treasurySubTab === 'privacy'
                      ? 'text-purple-300 border-b-2 border-purple-400'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Privacy
                </button>
                <button
                  onClick={() => setTreasurySubTab('verification')}
                  className={`px-4 py-2 font-medium text-sm transition ${
                    treasurySubTab === 'verification'
                      ? 'text-purple-300 border-b-2 border-purple-400'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Verification
                </button>
              </div>
            )}

            {/* Content - Single Column */}
            <div className="space-y-4">
              {/* SECURITY - ACCOUNT - ACCOUNT TAB */}
              {selectedDetail.tab === 'security' && selectedDetail.item === 'Account' && treasurySubTab === 'account' && (
                <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                  {/* Render ProfilePage Component */}
                  <div className="bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
                    <ProfilePage 
                      onClose={() => setSelectedDetail(null)}
                      onLogout={() => {
                        console.log('✅ User logged out');
                        setSelectedDetail(null);
                      }}
                    />
                  </div>
                </div>
              )}

              {/* SECURITY - ACCOUNT - PRIVACY TAB */}
              {selectedDetail.tab === 'security' && selectedDetail.item === 'Account' && treasurySubTab === 'privacy' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Profile Visibility</p>
                        <p className="text-xs text-gray-400 mt-1">Control who can see your profile</p>
                      </div>
                      <select
                        value={privacySettings.profileVisibility}
                        onChange={(e) => setPrivacySettings({...privacySettings, profileVisibility: e.target.value})}
                        className="px-3 py-1 bg-purple-500/20 text-purple-300 border border-purple-400 rounded text-xs font-medium cursor-pointer"
                      >
                        <option value="public">Public</option>
                        <option value="friends">Friends Only</option>
                        <option value="private">Private</option>
                      </select>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Transaction Privacy</p>
                        <p className="text-xs text-gray-400 mt-1">Only you can see transaction details</p>
                      </div>
                      <select
                        value={privacySettings.transactionPrivacy}
                        onChange={(e) => setPrivacySettings({...privacySettings, transactionPrivacy: e.target.value})}
                        className="px-3 py-1 bg-blue-500/20 text-blue-300 border border-blue-400 rounded text-xs font-medium cursor-pointer"
                      >
                        <option value="private">Private</option>
                        <option value="shared">Shared</option>
                      </select>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Data Sharing</p>
                        <p className="text-xs text-gray-400 mt-1">Share data with trusted partners</p>
                      </div>
                      <button
                        onClick={() => setPrivacySettings({...privacySettings, dataSharing: !privacySettings.dataSharing})}
                        className={`px-4 py-2 rounded-lg transition font-medium ${
                          privacySettings.dataSharing
                            ? 'bg-green-500/20 text-green-300'
                            : 'bg-red-500/20 text-red-300'
                        }`}
                      >
                        {privacySettings.dataSharing ? '✓ Enabled' : '✗ Disabled'}
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Marketing Communications</p>
                        <p className="text-xs text-gray-400 mt-1">Receive updates and offers</p>
                      </div>
                      <button
                        onClick={() => setPrivacySettings({...privacySettings, marketingComms: !privacySettings.marketingComms})}
                        className={`px-4 py-2 rounded-lg transition font-medium ${
                          privacySettings.marketingComms
                            ? 'bg-yellow-500/20 text-yellow-300'
                            : 'bg-gray-500/20 text-gray-300'
                        }`}
                      >
                        {privacySettings.marketingComms ? '✓ Enabled' : '✗ Disabled'}
                      </button>
                    </div>
                  </div>

                  {/* Save Button */}
                  <button
                    onClick={() => {
                      console.log('✅ Privacy settings saved:', privacySettings);
                    }}
                    className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg transition font-medium"
                  >
                    Save Privacy Settings
                  </button>
                </div>
              )}

              {/* SECURITY - ACCOUNT - VERIFICATION TAB */}
              {selectedDetail.tab === 'security' && selectedDetail.item === 'Account' && treasurySubTab === 'verification' && (
                <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                  {/* CONTRACT VERIFICATION SECTION */}
                  <div className="bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border border-indigo-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Shield className="w-5 h-5 text-indigo-300" />
                      <h3 className="text-sm font-bold text-white">Contract Verification</h3>
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-gray-300 block mb-2">
                          Paste contract or terms & conditions here...
                        </label>
                        <textarea
                          value={contractText}
                          onChange={(e) => setContractText(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-800/50 border border-slate-600/50 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400 resize-none"
                          placeholder="Paste your contract or terms & conditions text here for secure analysis..."
                          rows="4"
                        />
                      </div>

                      {contractError && (
                        <div className="p-2 bg-red-500/20 border border-red-500/30 rounded text-xs text-red-300">
                          {contractError}
                        </div>
                      )}

                      <button
                        onClick={analyzeContract}
                        disabled={isAnalyzingContract}
                        className="w-full px-3 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 text-white rounded text-sm font-medium transition"
                      >
                        {isAnalyzingContract ? '⏳ Analyzing...' : '🔍 Analyze Contract (Secure)'}
                      </button>

                      {contractAnalysis && (
                        <div className="p-3 bg-indigo-500/20 border border-indigo-400/30 rounded text-xs space-y-2">
                          <p className="font-bold text-indigo-200">✅ Analysis Complete</p>
                          <p className="text-gray-300">{contractAnalysis}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* VERIFICATION STATUS SECTION */}
                  <div className="bg-gradient-to-br from-emerald-900/40 to-teal-900/40 border border-emerald-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <CheckCircle className="w-5 h-5 text-emerald-300" />
                      <h3 className="text-sm font-bold text-white">Verification Status</h3>
                    </div>

                    {/* Email Verified */}
                    <div className="space-y-3">
                      <div className="bg-slate-900/50 border border-emerald-500/20 rounded p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-white">✅ Email Verified</span>
                          <span className="px-2 py-1 bg-green-500/20 text-green-300 rounded text-xs font-medium">Verified</span>
                        </div>
                        <p className="text-xs text-gray-400">Verified on {contractVerificationDates.emailVerified}</p>
                      </div>

                      {/* Phone Verified */}
                      <div className="bg-slate-900/50 border border-emerald-500/20 rounded p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-white">✅ Phone Verified</span>
                          <span className="px-2 py-1 bg-green-500/20 text-green-300 rounded text-xs font-medium">Verified</span>
                        </div>
                        <p className="text-xs text-gray-400">Verified on {contractVerificationDates.phoneVerified}</p>
                      </div>

                      {/* Identity Verification */}
                      <div className="bg-slate-900/50 border border-yellow-500/20 rounded p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-white">Identity Verification</span>
                          <span className="px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded text-xs font-medium">Pending</span>
                        </div>
                        <p className="text-xs text-gray-400">Status: {contractVerificationDates.identityVerified}</p>
                        <button className="mt-2 text-xs text-yellow-300 hover:text-yellow-200 font-medium transition">
                          ▶ Complete Identity Verification
                        </button>
                      </div>

                      {/* Two-Factor Authentication */}
                      <div className="bg-slate-900/50 border border-indigo-500/20 rounded p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-white">Two-Factor Authentication</span>
                          <button
                            onClick={() => setVerificationStatus({...verificationStatus, twoFactorEnabled: !verificationStatus.twoFactorEnabled})}
                            className={`px-2 py-1 rounded text-xs font-medium transition ${
                              verificationStatus.twoFactorEnabled
                                ? 'bg-green-500/20 text-green-300'
                                : 'bg-gray-500/20 text-gray-300'
                            }`}
                          >
                            {verificationStatus.twoFactorEnabled ? '✅ Enabled' : '✗ Disabled'}
                          </button>
                        </div>
                        <p className="text-xs text-gray-400">Extra security layer for your account</p>
                      </div>

                      {/* Biometric Lock */}
                      <div className="bg-slate-900/50 border border-purple-500/20 rounded p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-white">Biometric Lock</span>
                          <button
                            onClick={() => setVerificationStatus({...verificationStatus, biometricEnabled: !verificationStatus.biometricEnabled})}
                            className={`px-2 py-1 rounded text-xs font-medium transition ${
                              verificationStatus.biometricEnabled
                                ? 'bg-green-500/20 text-green-300'
                                : 'bg-gray-500/20 text-gray-300'
                            }`}
                          >
                            {verificationStatus.biometricEnabled ? '✅ Active' : '✗ Inactive'}
                          </button>
                        </div>
                        <p className="text-xs text-gray-400">Fingerprint or face authentication</p>
                      </div>
                    </div>
                  </div>

                  {/* Save Button */}
                  <button
                    onClick={() => {
                      console.log('✅ Verification settings saved:', verificationStatus);
                      console.log('✅ Contract analysis:', contractAnalysis);
                    }}
                    className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg transition font-medium"
                  >
                    Save Verification Settings
                  </button>
                </div>
              )}

              {/* SECURITY - VERIFICATION (Old - kept for other items) */}
              {selectedDetail.tab === 'security' && selectedDetail.item === 'Verification' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Email Verification</p>
                        <p className="text-xs text-gray-400 mt-1">Email address confirmed</p>
                      </div>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">✅ Verified</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Phone Verification</p>
                        <p className="text-xs text-gray-400 mt-1">Confirm your phone number</p>
                      </div>
                      <span className="px-3 py-1 bg-yellow-500/20 text-yellow-300 rounded-full text-xs font-medium">⏳ Pending</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Two-Factor Authentication</p>
                        <p className="text-xs text-gray-400 mt-1">Extra security layer enabled</p>
                      </div>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">✅ Enabled</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Biometric Lock</p>
                        <p className="text-xs text-gray-400 mt-1">Fingerprint or face authentication</p>
                      </div>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">✅ Active</span>
                    </div>
                  </div>
                </div>
              )}

              {/* READINESS - KYC STATUS */}
              {selectedDetail.tab === 'readiness' && selectedDetail.item === 'KYC Status' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <p className="text-xs text-blue-300 font-bold mb-2">VERIFICATION LEVEL</p>
                    <p className="text-lg font-bold text-white">Standard</p>
                    <p className="text-xs text-gray-400 mt-1">Verified Identity</p>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <p className="text-xs text-blue-300 font-bold mb-2">TRANSACTION LIMIT</p>
                    <p className="text-lg font-bold text-white">500,000</p>
                    <p className="text-xs text-gray-400 mt-1">Per Month</p>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">STATUS</p>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">✅ APPROVED</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <p className="text-xs text-blue-300 font-bold mb-2">VERIFIED ON</p>
                    <p className="text-sm text-gray-300">January 15, 2026</p>
                  </div>
                </div>
              )}

              {/* READINESS - DOCUMENTS */}
              {selectedDetail.tab === 'readiness' && selectedDetail.item === 'Documents' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Government ID</p>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">✅ Valid</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Address Proof</p>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">✅ Verified</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Business Registration</p>
                      <span className="px-3 py-1 bg-yellow-500/20 text-yellow-300 rounded-full text-xs font-medium">⏳ Pending</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Tax Certificate</p>
                      <span className="px-3 py-1 bg-gray-500/20 text-gray-300 rounded-full text-xs font-medium">⊘ Not Needed</span>
                    </div>
                  </div>
                </div>
              )}

              {/* READINESS - COMPLIANCE */}
              {selectedDetail.tab === 'readiness' && selectedDetail.item === 'Compliance' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Anti-Money Laundering</p>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">✅ Passed</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Know Your Customer</p>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">✅ Passed</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Risk Assessment</p>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">✅ Low</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Compliance Status</p>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">✅ Compliant</span>
                    </div>
                  </div>
                </div>
              )}

              {/* GROWTH - INVESTMENTS */}
              {selectedDetail.tab === 'growth' && selectedDetail.item === 'Investments' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <p className="text-xs text-green-300 font-bold mb-2">TOTAL PORTFOLIO</p>
                    <p className="text-2xl font-bold text-white">{currentBalance}</p>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <p className="text-sm font-bold text-white mb-3">ALLOCATION</p>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-300">Stocks</span>
                          <span className="text-gray-300">45%</span>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div className="bg-blue-500 h-2 rounded-full" style={{width: '45%'}}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-300">Crypto</span>
                          <span className="text-gray-300">25%</span>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div className="bg-orange-500 h-2 rounded-full" style={{width: '25%'}}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-300">Cash</span>
                          <span className="text-gray-300">30%</span>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div className="bg-green-500 h-2 rounded-full" style={{width: '30%'}}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* GROWTH - ANALYTICS */}
              {selectedDetail.tab === 'growth' && selectedDetail.item === 'Analytics' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <p className="text-xs text-green-300 font-bold mb-2">GROWTH RATE</p>
                    <p className="text-3xl font-bold text-green-400">+12.5%</p>
                    <p className="text-xs text-gray-400 mt-1">This Month</p>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <p className="text-xs text-green-300 font-bold mb-2">TOTAL TRANSACTIONS</p>
                    <p className="text-2xl font-bold text-white">{transactions.length}</p>
                    <p className="text-xs text-gray-400 mt-1">Recorded in System</p>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <p className="text-xs text-green-300 font-bold mb-2">DAILY AVERAGE</p>
                    <p className="text-2xl font-bold text-green-400">+2.3%</p>
                    <p className="text-xs text-gray-400 mt-1">Consistent Growth</p>
                  </div>
                </div>
              )}

              {/* GROWTH - OPPORTUNITIES */}
              {selectedDetail.tab === 'growth' && selectedDetail.item === 'Opportunities' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <p className="text-xs text-green-300 font-bold mb-2">AVAILABLE OPPORTUNITIES</p>
                    <p className="text-3xl font-bold text-white">8</p>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <p className="text-xs text-green-300 font-bold mb-2">HIGH YIELD OPTIONS</p>
                    <p className="text-2xl font-bold text-green-400">3</p>
                    <p className="text-xs text-gray-400 mt-1">ROI: 15-25%</p>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <p className="text-xs text-green-300 font-bold mb-2">NEW TODAY</p>
                    <p className="text-2xl font-bold text-white">2</p>
                    <p className="text-xs text-gray-400 mt-1">Just Added</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====== FINANCIAL METRICS - TINY CLICKABLE WITH DROPDOWNS ====== */}
      <div className="px-4 py-3">
        {/* First Row - Income, Expense, Net Profit */}
        <div className="grid grid-cols-3 gap-1.5 mb-1.5">
          {financialMetrics.map((metric, idx) => {
            const metricKey = ['income', 'expense', 'netProfit'][idx];
            const periodData = metricPeriodData[metricKey];
            return (
              <div key={idx} className="relative">
                <button
                  onClick={() => handleMetricClick(metricKey)}
                  className={`w-full bg-gradient-to-br ${metric.color} rounded-lg p-1.5 text-center shadow-sm hover:shadow-md hover:scale-110 transition-all transform cursor-pointer`}
                  title={metric.label}
                >
                  <metric.icon className="w-3.5 h-3.5 mx-auto text-white/80" />
                  <p className="text-xs text-white/70 leading-tight">{metric.label}</p>
                  <p className="text-xs font-bold text-white">{metric.value}</p>
                </button>
                
                {/* Dropdown Menu */}
                {metricDropdowns[metricKey] && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-slate-950 border border-purple-500/50 rounded-lg shadow-xl z-50 text-xs">
                    <div className="p-2 space-y-1">
                      {periodData.loading ? (
                        <div className="px-2 py-2 text-center text-gray-400">Loading...</div>
                      ) : (
                        <>
                          <button className="w-full px-2 py-1 text-left text-purple-300 hover:bg-purple-500/20 rounded transition">📅 Daily: {periodData.daily.toLocaleString()}</button>
                          <button className="w-full px-2 py-1 text-left text-purple-300 hover:bg-purple-500/20 rounded transition">📊 Weekly: {periodData.weekly.toLocaleString()}</button>
                          <button className="w-full px-2 py-1 text-left text-purple-300 hover:bg-purple-500/20 rounded transition">📈 Monthly: {periodData.monthly.toLocaleString()}</button>
                          <button className="w-full px-2 py-1 text-left text-purple-300 hover:bg-purple-500/20 rounded transition">📉 Yearly: {periodData.yearly.toLocaleString()}</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Second Row - Transactions, Savings, Net Worth */}
        <div className="grid grid-cols-3 gap-1.5">
          {secondMetrics.map((metric, idx) => {
            const metricKey = ['transactions', 'savingsRate', 'netWorth'][idx];
            const periodData = metricPeriodData[metricKey];
            return (
              <div key={idx} className="relative">
                <button
                  onClick={() => handleMetricClick(metricKey)}
                  className={`w-full bg-gradient-to-br ${metric.color} rounded-lg p-1.5 text-center shadow-sm hover:shadow-md hover:scale-110 transition-all transform cursor-pointer`}
                  title={metric.label}
                >
                  <metric.icon className="w-3.5 h-3.5 mx-auto text-white/80" />
                  <p className="text-xs text-white/70 leading-tight">{metric.label}</p>
                  <p className="text-xs font-bold text-white">{metric.value}</p>
                </button>
                
                {/* Dropdown Menu */}
                {metricDropdowns[metricKey] && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-slate-950 border border-blue-500/50 rounded-lg shadow-xl z-50 text-xs">
                    <div className="p-2 space-y-1">
                      {periodData.loading ? (
                        <div className="px-2 py-2 text-center text-gray-400">Loading...</div>
                      ) : (
                        <>
                          <button className="w-full px-2 py-1 text-left text-blue-300 hover:bg-blue-500/20 rounded transition">📅 Daily: {periodData.daily}</button>
                          <button className="w-full px-2 py-1 text-left text-blue-300 hover:bg-blue-500/20 rounded transition">📊 Weekly: {periodData.weekly}</button>
                          <button className="w-full px-2 py-1 text-left text-blue-300 hover:bg-blue-500/20 rounded transition">📈 Monthly: {periodData.monthly}</button>
                          <button className="w-full px-2 py-1 text-left text-blue-300 hover:bg-blue-500/20 rounded transition">📉 Yearly: {periodData.yearly}</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ROI - Tiny Clickable Circle */}
        <div className="flex justify-center mt-2">
          <div className="relative">
            <button
              onClick={() => handleMetricClick('roi')}
              className="w-16 h-16 rounded-full bg-gradient-to-br from-yellow-500 to-orange-600 flex items-center justify-center shadow-sm hover:shadow-md hover:scale-110 transition-all transform cursor-pointer"
              title="ROI"
            >
              <div className="text-center">
                <p className="text-xs text-white/70">ROI</p>
                <p className="text-sm font-bold text-white">24%</p>
              </div>
            </button>
            
            {/* ROI Dropdown */}
            {metricDropdowns.roi && (
              <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-slate-950 border border-yellow-500/50 rounded-lg shadow-xl z-50 text-xs whitespace-nowrap">
                <div className="p-2 space-y-1">
                  {metricPeriodData.roi.loading ? (
                    <div className="px-2 py-2 text-center text-gray-400">Loading...</div>
                  ) : (
                    <>
                      <button className="px-2 py-1 text-left text-yellow-300 hover:bg-yellow-500/20 rounded transition block">📅 Daily: {metricPeriodData.roi.daily}</button>
                      <button className="px-2 py-1 text-left text-yellow-300 hover:bg-yellow-500/20 rounded transition block">📊 Weekly: {metricPeriodData.roi.weekly}</button>
                      <button className="px-2 py-1 text-left text-yellow-300 hover:bg-yellow-500/20 rounded transition block">📈 Monthly: {metricPeriodData.roi.monthly}</button>
                      <button className="px-2 py-1 text-left text-yellow-300 hover:bg-yellow-500/20 rounded transition block">📉 Yearly: {metricPeriodData.roi.yearly}</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TIME PERIOD SELECTOR - COLLAPSIBLE (COMMENTED OUT) 
      
      <div className="px-4 py-4 space-y-2">
        <p className="text-xs text-gray-400 font-bold mb-3">ANALYTICS PERIOD</p>
        
        Daily Section Removed
        
        Weekly Section Removed
        
        Monthly Section Removed
        
        Yearly Section Removed
      </div>
      
      */}

      {/* ====== ACTION CHIPS ====== */}
      <div className="px-4 py-4">
        <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
          {actionChips.map((chip, idx) => {
            // Map each action chip to its modal state
            let handleClick;
            if (idx === 0) handleClick = () => setShowJourneyDetails(!showJourneyDetails);           // Progress
            else if (idx === 1) handleClick = () => setShowFinancialAnalytics(!showFinancialAnalytics); // Analytics
            else if (idx === 2) handleClick = () => setShowBusinessLoanCalculator(!showBusinessLoanCalculator); // Loans
            else if (idx === 3) handleClick = () => setShowWalletAccounts(!showWalletAccounts);     // Wallet
            else if (idx === 4) handleClick = () => setShowTithingCalculator(!showTithingCalculator); // Goals (Tithing)
            else if (idx === 5) handleClick = () => setShowReportingSystem(!showReportingSystem);   // Reports (Advanced Reporting)
            else if (idx === 6) handleClick = () => setShowAIChat(!showAIChat);                     // ICAN AI

            return (
              <button
                key={idx}
                onClick={handleClick}
                className={`${chip.color} rounded-lg px-4 py-3 text-white shadow-lg hover:shadow-xl transition flex flex-col items-center gap-1.5 whitespace-nowrap flex-shrink-0 hover:scale-105 transform`}
                title={chip.label}
              >
                <chip.icon className="w-5 h-5" />
                <span className="text-xs font-semibold">{chip.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ====== MODAL PANELS (appear below action chips) ====== */}
      <div className="px-4 py-4 space-y-4">
        {/* 1. Journey Details Panel */}
        {showJourneyDetails && (
          <div className="glass-card p-4 border-l-4 border-blue-500 animate-in fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Building className="w-5 h-5 text-blue-400" />
                Progress Journey
              </h3>
              <button onClick={() => setShowJourneyDetails(false)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>

            {/* Current Stage - Stage 1 (Survival) */}
            <div className="p-4 rounded-lg bg-red-500/20 border border-red-500/30 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-500/30 rounded-full flex items-center justify-center">
                    <Zap className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <div className="font-semibold text-red-400">Stage 1: Survival Stage</div>
                    <div className="text-gray-300 text-sm">Establishing Velocity</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-white font-bold">{formatCurrency(velocityMetrics?.netWorth || 0)}</div>
                  <div className="text-gray-400 text-xs">0% Complete</div>
                </div>
              </div>
              
              {/* Progress Bar */}
              <div className="w-full bg-gray-700 rounded-full h-2 mb-3">
                <div className="h-2 rounded-full bg-red-500 transition-all" style={{ width: '0%' }}></div>
              </div>
              
              <p className="text-gray-300 text-sm">Cash flow is minute, volatile, and impossible to track reliably. No savings, only daily survival.</p>
            </div>

            {/* Stage Timeline - All 4 Stages */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              <div className="p-2 rounded-lg border bg-red-500/20 border-red-500/30 text-center">
                <Zap className="w-4 h-4 mx-auto mb-1 text-red-400" />
                <div className="text-xs font-medium text-red-400">Stage 1</div>
              </div>
              <div className="p-2 rounded-lg border bg-yellow-500/20 border-yellow-500/30 text-center">
                <Building className="w-4 h-4 mx-auto mb-1 text-yellow-400" />
                <div className="text-xs font-medium text-yellow-400">Stage 2</div>
              </div>
              <div className="p-2 rounded-lg border bg-blue-500/20 border-blue-500/30 text-center">
                <Crown className="w-4 h-4 mx-auto mb-1 text-blue-400" />
                <div className="text-xs font-medium text-blue-400">Stage 3</div>
              </div>
              <div className="p-2 rounded-lg border bg-green-500/20 border-green-500/30 text-center">
                <Rocket className="w-4 h-4 mx-auto mb-1 text-green-400" />
                <div className="text-xs font-medium text-green-400">Stage 4</div>
              </div>
            </div>

            {/* Journey Insights */}
            <div className="space-y-3">
              <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-400/30">
                <div className="text-blue-300 font-medium text-sm mb-2">🎯 Next Milestone:</div>
                <div className="text-white text-sm">Stabilize into steady income stream (UGX 20,000+)</div>
                <div className="text-gray-300 text-xs mt-1">Estimated time: Focus on positive cash flow first</div>
              </div>

              <div className="p-3 bg-green-500/10 rounded-lg border border-green-400/30">
                <div className="text-green-300 font-medium text-sm mb-2">💪 Current Strengths:</div>
                <div className="text-gray-300 text-sm">Building momentum • Establishing habits</div>
              </div>

              <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-400/30">
                <div className="text-yellow-300 font-medium text-sm mb-2">⚠️ Focus Areas:</div>
                <div className="text-gray-300 text-sm space-y-1">
                  <div>• Establish basic income tracking</div>
                  <div>• Build transaction recording habits</div>
                  <div>• Achieve daily cash flow visibility</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. Financial Analytics Panel */}
        {showFinancialAnalytics && (
          <div className="glass-card p-4 border-l-4 border-orange-500 animate-in fade-in space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-orange-400" />
                Financial Analytics
              </h3>
              <button onClick={() => setShowFinancialAnalytics(false)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-green-900/30 border border-green-500/30 rounded p-2">
                <p className="text-xs text-gray-400 mb-0.5">Income (30 days)</p>
                <p className="text-sm font-bold text-green-300">{formatCurrency(velocityMetrics?.income30Days || 0)}</p>
              </div>
              <div className="bg-red-900/30 border border-red-500/30 rounded p-2">
                <p className="text-xs text-gray-400 mb-0.5">Expenses (30 days)</p>
                <p className="text-sm font-bold text-red-300">{formatCurrency(velocityMetrics?.expenses30Days || 0)}</p>
              </div>
              <div className="bg-blue-900/30 border border-blue-500/30 rounded p-2">
                <p className="text-xs text-gray-400 mb-0.5">Net Profit</p>
                <p className="text-sm font-bold text-blue-300">{formatCurrency(velocityMetrics?.velocity30Days || 0)}</p>
              </div>
              <div className="bg-purple-900/30 border border-purple-500/30 rounded p-2">
                <p className="text-xs text-gray-400 mb-0.5">Savings Rate</p>
                <p className="text-sm font-bold text-purple-300">{formatSavingsRate(velocityMetrics?.income30Days || 0, velocityMetrics?.expenses30Days || 0)}</p>
              </div>
            </div>

            <div className="bg-orange-900/30 border border-orange-500/30 rounded p-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Net Worth</span>
                <span className="font-bold text-orange-300">{formatCurrency(velocityMetrics?.netWorth || 0)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">30-Day Velocity</span>
                <span className={`font-bold ${(velocityMetrics?.velocity30Days || 0) > 0 ? 'text-green-300' : 'text-red-300'}`}>
                  {formatCurrency(velocityMetrics?.velocity30Days || 0)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 3. Business Loan Calculator Panel */}
        {showBusinessLoanCalculator && (
          <div className="mt-4 bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-6 border border-blue-200 shadow-lg">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">💼 Business Loan Calculator</h2>
                <p className="text-gray-600 mt-1">Smart financing decisions for your business growth</p>
              </div>
              <button onClick={() => setShowBusinessLoanCalculator(false)} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Loan Details */}
              <div className="bg-white rounded-xl p-6 shadow-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">💳 Loan Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Loan Amount</label>
                    <input type="number" value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="5,000,000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Interest Rate (%)</label>
                    <input type="number" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="20" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Loan Term (Years)</label>
                    <input type="number" value={loanTerm} onChange={(e) => setLoanTerm(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="3" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Loan Purpose</label>
                    <select value={loanPurpose} onChange={(e) => setLoanPurpose(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">
                      <option value="business-expansion">Business Expansion</option>
                      <option value="equipment">Equipment</option>
                      <option value="inventory">Inventory</option>
                      <option value="working-capital">Working Capital</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Business Financials */}
              <div className="bg-white rounded-xl p-6 shadow-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">📊 Monthly Financials</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Revenue</label>
                    <input type="number" value={monthlyRevenue} onChange={(e) => setMonthlyRevenue(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="3,000,000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Operating Expenses</label>
                    <input type="number" value={operatingExpenses} onChange={(e) => setOperatingExpenses(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="500,000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Salaries</label>
                    <input type="number" value={employeeSalaries} onChange={(e) => setEmployeeSalaries(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="800,000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Rent & Utilities</label>
                    <input type="number" value={rentUtilities} onChange={(e) => setRentUtilities(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="300,000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Marketing</label>
                    <input type="number" value={marketingCosts} onChange={(e) => setMarketingCosts(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="200,000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Inventory</label>
                    <input type="number" value={inventoryCosts} onChange={(e) => setInventoryCosts(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="600,000" />
                  </div>
                </div>
              </div>

              {/* Tax & Tithe */}
              <div className="bg-white rounded-xl p-6 shadow-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">🏛️ Taxes & Tithes</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Corporate Tax Rate (%)</label>
                    <input type="number" value={currentTaxRate} onChange={(e) => setCurrentTaxRate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="30" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">VAT Rate (%)</label>
                    <input type="number" value={vatRate} onChange={(e) => setVatRate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="18" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">PAYE Deductions</label>
                    <input type="number" value={payeDeductions} onChange={(e) => setPayeDeductions(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="100,000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tithe Percentage (%)</label>
                    <input type="number" value={tithePercentage} onChange={(e) => setTithePercentage(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="10" />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Existing Monthly Debt</label>
                  <input type="number" value={existingDebts} onChange={(e) => setExistingDebts(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" placeholder="400,000" />
                </div>
              </div>

              {/* Analysis Results */}
              <div className="space-y-3">
                {/* Loan Analysis */}
                <div className="bg-white rounded-xl p-4 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">💰 Loan Analysis</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-gray-600">Monthly Payment:</span><span className="font-semibold">UGX {(loanMetrics.monthlyPayment || 0).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Total Interest:</span><span className="font-semibold text-red-600">UGX {(loanMetrics.totalInterest || 0).toLocaleString()}</span></div>
                  </div>
                </div>

                {/* Business Cash Flow */}
                <div className="bg-white rounded-xl p-4 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">💵 Business Cash Flow</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-gray-600">Gross Revenue:</span><span className="font-semibold text-green-600">UGX {((loanMetrics.businessMetrics?.grossMonthlyRevenue) || 0).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Total Expenses:</span><span className="font-semibold text-red-600">UGX {((loanMetrics.businessMetrics?.totalMonthlyExpenses) || 0).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Gross Profit:</span><span className="font-semibold">UGX {((loanMetrics.businessMetrics?.grossProfit) || 0).toLocaleString()}</span></div>
                    <div className="flex justify-between border-t pt-1"><span className="text-gray-600">Net Cash Flow:</span><span className={`font-bold ${((loanMetrics.businessMetrics?.monthlyNetCashFlow) || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>UGX {((loanMetrics.businessMetrics?.monthlyNetCashFlow) || 0).toLocaleString()}</span></div>
                  </div>
                </div>

                {/* Risk Analysis */}
                <div className="bg-white rounded-xl p-4 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">⚡ Risk Analysis</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-gray-600">Debt Service Ratio:</span><span className={`font-semibold ${((loanMetrics.businessMetrics?.debtServiceRatio) || 0) > 30 ? 'text-red-600' : 'text-green-600'}`}>{((loanMetrics.businessMetrics?.debtServiceRatio) || 0).toFixed(1)}%</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Profit Margin:</span><span className={`font-semibold ${((loanMetrics.businessMetrics?.profitMargin) || 0) < 5 ? 'text-red-600' : 'text-green-600'}`}>{((loanMetrics.businessMetrics?.profitMargin) || 0).toFixed(1)}%</span></div>
                    <div className="flex justify-between border-t pt-1"><span className="text-gray-600">Risk Level:</span><span className={`font-bold ${loanMetrics.riskLevel === 'low' ? 'text-green-600' : loanMetrics.riskLevel === 'medium' ? 'text-yellow-600' : 'text-red-600'}`}>{loanMetrics.riskLevel?.toUpperCase()}</span></div>
                  </div>
                </div>

                {/* Advice */}
                <div className={`p-4 rounded-xl border-2 ${
                  loanAdvice.color === 'green' ? 'bg-green-50 border-green-200' :
                  loanAdvice.color === 'yellow' ? 'bg-yellow-50 border-yellow-200' :
                  loanAdvice.color === 'red' ? 'bg-red-50 border-red-200' :
                  'bg-gray-50 border-gray-200'
                }`}>
                  <div className={`text-lg font-bold mb-1 ${
                    loanAdvice.color === 'green' ? 'text-green-800' :
                    loanAdvice.color === 'yellow' ? 'text-yellow-800' :
                    loanAdvice.color === 'red' ? 'text-red-800' :
                    'text-gray-800'
                  }`}>
                    {loanAdvice.decision}
                  </div>
                  <p className="text-sm">{loanAdvice.message}</p>
                  {loanAdvice.advice && <p className="text-sm font-medium mt-2">{loanAdvice.advice}</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. Tithing Calculator Panel */}
        {showTithingCalculator && (
          <div className="mt-4 bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-6 border border-blue-200 shadow-lg">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">🙏 Business Tithing Manager</h2>
                <p className="text-gray-600 mt-1">Separate business and personal tithing - Honor God in both spheres</p>
              </div>
              <button onClick={() => setShowTithingCalculator(false)} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Business vs Personal Tabs */}
              <div className="mb-6">
                <div className="flex bg-gray-100 rounded-xl p-1">
                  <button
                    onClick={() => setSelectedTithingTab('business')}
                    className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-colors ${selectedTithingTab === 'business' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-600 hover:text-gray-800'}`}
                  >
                    💼 Business Tithing
                  </button>
                  <button
                    onClick={() => setSelectedTithingTab('personal')}
                    className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-colors ${selectedTithingTab === 'personal' ? 'bg-green-600 text-white shadow-lg' : 'text-gray-600 hover:text-gray-800'}`}
                  >
                    👤 Personal Tithing
                  </button>
                </div>
              </div>

              {/* Business Tithing Tab */}
              {selectedTithingTab === 'business' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-xl p-4 shadow-lg border-l-4 border-blue-500">
                      <h3 className="text-sm font-semibold text-gray-800 mb-2">📊 Business Revenue</h3>
                      <p className="text-lg font-bold text-blue-600">UGX {(tithingMetrics.businessProfit || 0).toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-1">Gross income</p>
                    </div>

                    <div className="bg-white rounded-xl p-4 shadow-lg border-l-4 border-red-500">
                      <h3 className="text-sm font-semibold text-gray-800 mb-2">📉 Expenses</h3>
                      <p className="text-lg font-bold text-red-600">UGX {(tithingMetrics.businessProfit || 0).toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-1">Operating costs</p>
                    </div>

                    <div className="bg-white rounded-xl p-4 shadow-lg border-l-4 border-green-500">
                      <h3 className="text-sm font-semibold text-gray-800 mb-2">💰 Business Profit</h3>
                      <p className="text-lg font-bold text-green-600">UGX {(tithingMetrics.businessProfit || 0).toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-1">Net income</p>
                    </div>

                    <div className="bg-white rounded-xl p-4 shadow-lg border-l-4 border-purple-500">
                      <h3 className="text-sm font-semibold text-gray-800 mb-2">🙏 Tithe Due</h3>
                      <p className="text-lg font-bold text-purple-600">UGX {(tithingMetrics.businessTithe || 0).toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-1">{businessTithingRate}% of profits</p>
                    </div>
                  </div>

                  {/* Faithfulness Score */}
                  <div className="bg-white rounded-xl p-4 shadow-lg">
                    <h3 className="text-lg font-semibold text-gray-800 mb-3">💼 Faithfulness Score</h3>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="flex-1 bg-gray-200 rounded-full h-3">
                        <div className="h-3 rounded-full bg-gradient-to-r from-green-400 to-green-600" style={{ width: '75%' }}></div>
                      </div>
                      <span className="text-2xl font-bold text-gray-800">75%</span>
                    </div>
                    <div className="text-center text-sm text-gray-600">
                      <p className="font-medium">UGX {(tithingMetrics.businessTithe || 0).toLocaleString()} Already Tithed</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Personal Tithing Tab */}
              {selectedTithingTab === 'personal' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-xl p-4 shadow-lg border-l-4 border-green-500">
                      <h3 className="text-sm font-semibold text-gray-800 mb-2">💰 Personal Income</h3>
                      <p className="text-lg font-bold text-green-600">UGX {(tithingMetrics.personalIncome || 0).toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-1">Salary & income</p>
                    </div>

                    <div className="bg-white rounded-xl p-4 shadow-lg border-l-4 border-blue-500">
                      <h3 className="text-sm font-semibold text-gray-800 mb-2">🙏 Tithe Due</h3>
                      <p className="text-lg font-bold text-blue-600">UGX {(tithingMetrics.personalTithe || 0).toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-1">{personalTithingRate}% of income</p>
                    </div>

                    <div className="bg-white rounded-xl p-4 shadow-lg border-l-4 border-purple-500 col-span-2">
                      <h3 className="text-sm font-semibold text-gray-800 mb-2">🎁 Personal Given</h3>
                      <p className="text-lg font-bold text-purple-600">UGX {(tithingMetrics.personalTithe || 0).toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-1">Amount given</p>
                    </div>
                  </div>

                  {/* Faithfulness Score */}
                  <div className="bg-white rounded-xl p-4 shadow-lg">
                    <h3 className="text-lg font-semibold text-gray-800 mb-3">👤 Faithfulness Score</h3>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="flex-1 bg-gray-200 rounded-full h-3">
                        <div className="h-3 rounded-full bg-gradient-to-r from-blue-400 to-blue-600" style={{ width: '85%' }}></div>
                      </div>
                      <span className="text-2xl font-bold text-gray-800">85%</span>
                    </div>
                    <div className="text-center text-sm text-gray-600">
                      <p className="font-medium">UGX {(tithingMetrics.personalTithe || 0).toLocaleString()} Already Tithed</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Settings */}
              <div className="pt-4 border-t border-gray-300">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">⚙️ Tithing Settings</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Business Rate</label>
                    <select value={businessTithingRate} onChange={(e) => setBusinessTithingRate(Number(e.target.value))} className="w-full border rounded-lg px-2 py-1 text-xs">
                      <option value={5}>5% Conservative</option>
                      <option value={10}>10% Standard</option>
                      <option value={15}>15% Generous</option>
                      <option value={20}>20% Abundant</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Personal Rate</label>
                    <select value={personalTithingRate} onChange={(e) => setPersonalTithingRate(Number(e.target.value))} className="w-full border rounded-lg px-2 py-1 text-xs">
                      <option value={5}>5% Growing</option>
                      <option value={10}>10% Standard</option>
                      <option value={15}>15% Generous</option>
                      <option value={20}>20% Abundant</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 5. Reporting System Panel - Advanced Reporting */}
        {showReportingSystem && (
          <div className="glass-card p-4 border-l-4 border-rose-500 animate-in fade-in space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <PieChart className="w-5 h-5 text-rose-400" />
                📊 Advanced Reporting System
              </h3>
              <button onClick={() => setShowReportingSystem(false)} className="text-gray-500 hover:text-gray-700 text-xl">×</button>
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Configuration Panel */}
              <div className="bg-white rounded-xl p-6 shadow-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">📋 Report Configuration</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Report Title</label>
                    <input
                      type="text"
                      value={reportTitle}
                      onChange={(e) => setReportTitle(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                      placeholder="My Financial Report"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Report Type</label>
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
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

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
                      <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        <option value="current-month">Current Month</option>
                        <option value="30-days">Last 30 Days</option>
                        <option value="quarter">Quarter</option>
                        <option value="year">Year</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Export Format</label>
                      <select
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        <option value="pdf">📄 PDF</option>
                        <option value="excel">📊 Excel</option>
                        <option value="csv">📋 CSV</option>
                      </select>
                    </div>
                  </div>

                  {dateRange === 'custom' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                        <input
                          type="date"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                        <input
                          type="date"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Generate Button */}
              <div className="bg-white rounded-xl p-6 shadow-lg">
                <button
                  className="w-full py-3 bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 text-white rounded-lg transition-all font-semibold text-lg shadow-lg"
                >
                  <span className="flex items-center justify-center gap-2">
                    {exportFormat === 'pdf' && '📄'}
                    {exportFormat === 'excel' && '📊'}
                    {exportFormat === 'csv' && '📋'}
                    Generate {exportFormat.toUpperCase()}
                  </span>
                </button>
              </div>

              {/* Comprehensive Preview Panel */}
              <div className="bg-white rounded-xl p-4 shadow-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  👁️ Live Report Preview
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                    {exportFormat.toUpperCase()}
                  </span>
                </h3>
                
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Type:</span>
                    <span className="font-medium">{reportTypes[selectedReportType]?.name}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-gray-600">Period:</span>
                    <span className="font-medium">{dateRange}</span>
                  </div>
                </div>

                {/* Dynamic Report Preview */}
                <div className="space-y-3">
                  {(() => {
                    const report = generateReportSummary();
                    
                    switch(selectedReportType) {
                      case 'financial-summary':
                        return (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-green-50 p-2 rounded text-xs">
                                <div className="text-green-600 font-medium">Total Income</div>
                                <div className="text-sm font-bold text-green-800">UGX {(report.metrics.totalIncome || 0).toLocaleString()}</div>
                              </div>
                              <div className="bg-red-50 p-2 rounded text-xs">
                                <div className="text-red-600 font-medium">Total Expenses</div>
                                <div className="text-sm font-bold text-red-800">UGX {(report.metrics.totalExpenses || 0).toLocaleString()}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-blue-50 p-2 rounded text-xs">
                                <div className="text-blue-600 font-medium">Net Cash Flow</div>
                                <div className={`text-sm font-bold ${(report.metrics.netProfit || 0) >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                                  UGX {(report.metrics.netProfit || 0).toLocaleString()}
                                </div>
                              </div>
                              <div className="bg-purple-50 p-2 rounded text-xs">
                                <div className="text-purple-600 font-medium">Savings Rate</div>
                                <div className="text-sm font-bold text-purple-800">{(report.metrics.savingsRate || 0).toFixed(1)}%</div>
                              </div>
                            </div>
                          </div>
                        );
                        
                      case 'income-analysis':
                        return (
                          <div className="space-y-2">
                            <div className="text-center border-b pb-2 mb-2">
                              <div className="text-2xl font-bold text-green-600">UGX {(report.metrics.totalIncome || 0).toLocaleString()}</div>
                              <div className="text-xs text-gray-500">Total Income</div>
                            </div>
                            <div>
                              <h6 className="text-xs font-medium text-gray-600 mb-2">Income Sources</h6>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span>Primary Income</span>
                                  <span className="font-medium">45%</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Secondary Income</span>
                                  <span className="font-medium">35%</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Other Income</span>
                                  <span className="font-medium">20%</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                        
                      case 'expense-breakdown':
                        return (
                          <div className="space-y-2">
                            <div className="text-center border-b pb-2 mb-2">
                              <div className="text-2xl font-bold text-red-600">UGX {(report.metrics.totalExpenses || 0).toLocaleString()}</div>
                              <div className="text-xs text-gray-500">Total Expenses</div>
                            </div>
                            <div>
                              <h6 className="text-xs font-medium text-gray-600 mb-2">Top Expense Categories</h6>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span>Operations</span>
                                  <span className="font-medium">40%</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Salaries</span>
                                  <span className="font-medium">35%</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Utilities</span>
                                  <span className="font-medium">25%</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                        
                      case 'cash-flow':
                        return (
                          <div className="grid grid-cols-3 gap-2 text-xs text-center">
                            <div className="bg-blue-50 p-2 rounded">
                              <div className="text-blue-600 font-medium">Inflow</div>
                              <div className="text-sm font-bold text-blue-800">UGX {(report.metrics.totalIncome || 0).toLocaleString()}</div>
                            </div>
                            <div className="bg-red-50 p-2 rounded">
                              <div className="text-red-600 font-medium">Outflow</div>
                              <div className="text-sm font-bold text-red-800">UGX {(report.metrics.totalExpenses || 0).toLocaleString()}</div>
                            </div>
                            <div className="bg-green-50 p-2 rounded">
                              <div className="text-green-600 font-medium">Net Flow</div>
                              <div className="text-sm font-bold text-green-800">UGX {(report.metrics.netProfit || 0).toLocaleString()}</div>
                            </div>
                          </div>
                        );
                        
                      default:
                        return (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-blue-50 p-2 rounded text-xs">
                              <div className="text-blue-600 font-medium">Income</div>
                              <div className="font-bold text-blue-800">UGX {(report.metrics.totalIncome || 0).toLocaleString()}</div>
                            </div>
                            <div className="bg-red-50 p-2 rounded text-xs">
                              <div className="text-red-600 font-medium">Expenses</div>
                              <div className="font-bold text-red-800">UGX {(report.metrics.totalExpenses || 0).toLocaleString()}</div>
                            </div>
                            <div className="bg-purple-50 p-2 rounded text-xs col-span-2 text-center">
                              <div className="text-purple-600 font-medium">Net Profit</div>
                              <div className="font-bold text-purple-800">UGX {(report.metrics.netProfit || 0).toLocaleString()}</div>
                            </div>
                          </div>
                        );
                    }
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 6. AI Chat Panel */}
        {showAIChat && (
          <div className="glass-card p-4 border-l-4 border-violet-500 animate-in fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Brain className="w-5 h-5 text-violet-400" />
                ICAN AI Assistant
              </h3>
              <button onClick={() => setShowAIChat(false)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="space-y-3">
              {/* Message History */}
              <div className="bg-violet-900/20 border border-violet-500/30 rounded p-3 max-h-56 overflow-y-auto space-y-3">
                {aiMessages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs px-3 py-2 rounded text-xs whitespace-pre-wrap ${
                      msg.type === 'user' 
                        ? 'bg-violet-600/40 border border-violet-400/30 text-white' 
                        : `bg-violet-900/40 border border-violet-500/30 ${getMoodColor(msg.mood || 'helpful')}`
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {aiIsThinking && (
                  <div className="flex justify-start">
                    <div className="bg-violet-900/40 border border-violet-500/30 rounded p-2 text-violet-300 text-xs animate-pulse">
                      🤖 Thinking...
                    </div>
                  </div>
                )}
              </div>
              {/* Input Area */}
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={aiInputMessage}
                  onChange={(e) => setAiInputMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && processAIMessage(aiInputMessage)}
                  placeholder="Ask about finances, goals, savings..." 
                  className="flex-1 px-3 py-2 bg-slate-800/50 border border-slate-600/50 rounded text-xs text-white placeholder-gray-500 focus:outline-none focus:border-violet-400" 
                />
                <button 
                  onClick={() => processAIMessage(aiInputMessage)}
                  disabled={aiIsThinking || !aiInputMessage.trim()}
                  className="px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-600/50 text-white rounded text-xs font-medium transition"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 7. Wallet Accounts Panel */}
        {showWalletAccounts && (
          <div className="glass-card p-4 border-l-4 border-teal-500 animate-in fade-in space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-teal-400" />
                Wallet Accounts
              </h3>
              <button onClick={() => setShowWalletAccounts(false)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>

            <div className="space-y-2">
              <div className="bg-teal-900/30 border border-teal-500/30 rounded p-2">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-gray-400">Available Balance</span>
                  <span className="text-sm font-bold text-teal-300">{formatCurrency(velocityMetrics?.netWorth || 0)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">30-Day Velocity</span>
                  <span className={`font-bold ${(velocityMetrics?.velocity30Days || 0) > 0 ? 'text-green-300' : 'text-red-300'}`}>
                    {formatCurrency(velocityMetrics?.velocity30Days || 0)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-gray-400 font-semibold">💳 ACCOUNT TYPES</p>
                <div className="grid grid-cols-2 gap-2">
                  <button className="py-2 px-2 bg-teal-600/30 hover:bg-teal-600/50 border border-teal-500/30 text-white rounded text-xs font-medium transition">Main Wallet</button>
                  <button className="py-2 px-2 bg-teal-600/30 hover:bg-teal-600/50 border border-teal-500/30 text-white rounded text-xs font-medium transition">Savings</button>
                  <button className="py-2 px-2 bg-teal-600/30 hover:bg-teal-600/50 border border-teal-500/30 text-white rounded text-xs font-medium transition">Investments</button>
                  <button className="py-2 px-2 bg-teal-600/30 hover:bg-teal-600/50 border border-teal-500/30 text-white rounded text-xs font-medium transition">Tithe</button>
                </div>
              </div>

              <div className="bg-teal-900/40 rounded p-2 border border-teal-500/30">
                <p className="text-xs font-semibold text-teal-300 mb-1">🔒 Account Security</p>
                <p className="text-xs text-gray-300">All transactions are encrypted and verified on blockchain</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ====== WALLET RIBBON ====== */}
      <div className="px-4 py-4 bg-purple-900/20 border-y border-purple-500/20">
        <div className="mb-3">
          <p className="text-xs text-gray-400 mb-2">WALLET ACCOUNTS</p>
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            {walletTabs.map((tab, idx) => (
              <button
                key={idx}
                className="px-3 py-2 rounded-full border border-purple-500/40 bg-purple-900/30 hover:bg-purple-900/50 text-xs font-medium text-purple-300 whitespace-nowrap transition flex items-center gap-1"
              >
                <tab.icon className="w-4 h-4" />
                {tab.name}
              </button>
            ))}
          </div>
        </div>

        {/* Current Balance Display */}
        <div className="bg-gradient-to-r from-green-600/20 to-emerald-600/20 border border-green-500/30 rounded-lg p-4">
          <p className="text-xs text-gray-300 mb-1">Current Balance</p>
          <p className="text-2xl font-bold text-green-400">${currentBalance}</p>
          <p className="text-xs text-gray-400 mt-1">+2.5% this month</p>
        </div>
      </div>

      {/* ====== SWIPEABLE CAROUSEL ====== */}
      <div className="px-4 py-6">
        <div className="relative">
          {/* Carousel Container */}
          <div
            ref={carouselRef}
            className="flex gap-4 overflow-x-auto scroll-smooth no-scrollbar"
          >
            {carouselCards.map((card, idx) => (
              <div
                key={idx}
                className="flex-shrink-0 w-full bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl overflow-hidden shadow-2xl"
              >
                {/* Card Header */}
                <div className={`bg-gradient-to-r ${card.color} p-6 text-white`}>
                  <div className="flex items-center gap-3 mb-4">
                    <card.icon className="w-8 h-8" />
                    <h3 className="text-2xl font-bold">{card.title}</h3>
                  </div>
                  <p className="text-sm text-white/80">{card.description}</p>
                </div>

                {/* Card Body */}
                <div className="p-6">
                  <div className="space-y-3 mb-6">
                    {card.features.map((feature, fIdx) => (
                      <div key={fIdx} className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                        <span className="text-sm text-gray-300">{feature}</span>
                      </div>
                    ))}
                  </div>

                  {/* Navigation Dots */}
                  <div className="flex justify-center gap-2">
                    {carouselCards.map((_, dotIdx) => (
                      <button
                        key={dotIdx}
                        onClick={() => {
                          if (carouselRef.current) {
                            carouselRef.current.scrollTo({
                              left: dotIdx * carouselRef.current.clientWidth,
                              behavior: 'smooth'
                            });
                            setActiveSlide(dotIdx);
                          }
                        }}
                        className={`w-2 h-2 rounded-full transition ${
                          dotIdx === activeSlide
                            ? 'bg-gradient-to-r from-purple-500 to-pink-500 w-6'
                            : 'bg-gray-600 hover:bg-gray-500'
                        }`}
                      ></button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Carousel Navigation Buttons */}
          <button
            onClick={() => handleCarouselScroll('prev')}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-6 z-20 bg-purple-600 hover:bg-purple-500 rounded-full p-2 transition shadow-lg"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => handleCarouselScroll('next')}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-6 z-20 bg-purple-600 hover:bg-purple-500 rounded-full p-2 transition shadow-lg"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ====== CMMS SECTION ====== */}
      <div className="px-4 py-6">
        <h3 className="text-lg font-bold mb-4">Management System</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gradient-to-br from-blue-900/30 to-blue-800/30 border border-blue-500/30 rounded-lg p-4 hover:border-blue-500/50 transition cursor-pointer">
            <Settings className="w-6 h-6 text-blue-400 mb-2" />
            <p className="text-sm font-semibold text-white">Operations</p>
            <p className="text-xs text-gray-400 mt-1">Manage tasks</p>
          </div>
          <div className="bg-gradient-to-br from-green-900/30 to-green-800/30 border border-green-500/30 rounded-lg p-4 hover:border-green-500/50 transition cursor-pointer">
            <TrendingUp className="w-6 h-6 text-green-400 mb-2" />
            <p className="text-sm font-semibold text-white">Analytics</p>
            <p className="text-xs text-gray-400 mt-1">View reports</p>
          </div>
        </div>
      </div>

      {/* ====== BOTTOM TAB PANELS ====== */}
      
      {/* Pitchin Panel - Full Screen Video */}
      {showPitchinPanel && (
        <div className="fixed inset-0 z-30 bg-black overflow-hidden">
          <Pitchin />
        </div>
      )}

      {/* Trust Panel - Full Web Trust System UI */}
      {showTrustPanel && (
        <div className="fixed inset-0 z-30 bg-gradient-to-b from-slate-950 to-black overflow-y-auto pb-32">
          <div>
            <TrustSystem currentUser={userProfile} />
          </div>
        </div>
      )}

      {/* Wallet Panel - Full Web Wallet UI */}
      {showWalletPanel && (
        <div className="fixed inset-0 z-30 bg-gradient-to-b from-slate-950 to-black overflow-y-auto pb-32">
          <div>
            <ICANWallet />
          </div>
        </div>
      )}

      {/* CMMS Panel - Full Web CMMS UI */}
      {showCmmsPanel && (
        <div className="fixed inset-0 z-30 bg-gradient-to-b from-slate-950 to-black overflow-y-auto pb-32">
          <div>
            <CMMSModule user={userProfile} />
          </div>
        </div>
      )}

      {/* CMMS Panel */}
      {showCmmsPanel && (
        <div className="mb-32 px-4 py-6">
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-6 border border-amber-200 shadow-lg">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">⚙️ CMMS - Management System</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-lg p-4 shadow hover:shadow-lg cursor-pointer transition">
                  <p className="text-2xl mb-1">📋</p>
                  <p className="text-sm font-semibold text-gray-800">Tasks</p>
                  <p className="text-xs text-gray-600">Manage tasks</p>
                </div>
                <div className="bg-white rounded-lg p-4 shadow hover:shadow-lg cursor-pointer transition">
                  <p className="text-2xl mb-1">📊</p>
                  <p className="text-sm font-semibold text-gray-800">Analytics</p>
                  <p className="text-xs text-gray-600">View reports</p>
                </div>
                <div className="bg-white rounded-lg p-4 shadow hover:shadow-lg cursor-pointer transition">
                  <p className="text-2xl mb-1">👥</p>
                  <p className="text-sm font-semibold text-gray-800">Team</p>
                  <p className="text-xs text-gray-600">Manage team</p>
                </div>
                <div className="bg-white rounded-lg p-4 shadow hover:shadow-lg cursor-pointer transition">
                  <p className="text-2xl mb-1">⚙️</p>
                  <p className="text-sm font-semibold text-gray-800">Settings</p>
                  <p className="text-xs text-gray-600">System settings</p>
                </div>
              </div>
              <button onClick={() => setShowCmmsPanel(false)} className="w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== FIXED BOTTOM NAVIGATION - ALWAYS ON TOP ====== */}
      <div className={`fixed bottom-0 left-0 right-0 z-50 backdrop-blur-md border-t border-purple-500/20 transition-all ${
        showPitchinPanel 
          ? 'bg-transparent' 
          : 'bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent'
      }`}>
        <div className="flex items-center justify-between px-2 py-3">
          {/* Profile */}
          <button
            onClick={() => { 
              setShowProfilePanel(false); 
              setShowPitchinPanel(false);
              setShowWalletPanel(false);
              setShowTrustPanel(false);
              setShowCmmsPanel(false);
              setActiveBottomTab('profile'); 
            }}
            className={`flex-1 flex flex-col items-center gap-1 py-2 px-2 rounded-lg transition ${
              activeBottomTab === 'profile'
                ? 'bg-purple-600/30'
                : showPitchinPanel ? 'hover:bg-white/10' : 'hover:bg-purple-600/10'
            } ${showPitchinPanel ? 'opacity-40' : 'opacity-100'}`}
          >
            <User className={`w-6 h-6 ${showPitchinPanel ? 'text-gray-400/60' : 'text-purple-400'}`} />
            <span className={`text-xs font-medium ${showPitchinPanel ? 'text-gray-400/60' : 'text-gray-300'}`}>Profile</span>
          </button>

          {/* Pitchin */}
          <button
            onClick={() => { setShowPitchinPanel(!showPitchinPanel); setActiveBottomTab('pitchin'); }}
            className={`flex-1 flex flex-col items-center gap-1 py-2 px-2 rounded-lg transition ${
              activeBottomTab === 'pitchin'
                ? 'bg-purple-600/30'
                : showPitchinPanel ? 'hover:bg-white/10' : 'hover:bg-purple-600/10'
            } ${showPitchinPanel ? 'opacity-80' : 'opacity-100'}`}
          >
            <Briefcase className={`w-6 h-6 ${showPitchinPanel ? 'text-purple-400/80' : 'text-purple-400'}`} />
            <span className={`text-xs font-medium ${showPitchinPanel ? 'text-purple-300/80' : 'text-gray-300'}`}>Pitchin</span>
          </button>

          {/* Wallet */}
          <button
            onClick={() => { setShowWalletPanel(!showWalletPanel); setActiveBottomTab('wallet'); }}
            className={`flex-1 flex flex-col items-center gap-1 py-2 px-2 rounded-lg transition ${
              activeBottomTab === 'wallet'
                ? 'bg-purple-600/30'
                : showPitchinPanel ? 'hover:bg-white/10' : 'hover:bg-purple-600/10'
            } ${showPitchinPanel ? 'opacity-40' : 'opacity-100'}`}
          >
            <Wallet className={`w-6 h-6 ${showPitchinPanel ? 'text-gray-400/60' : 'text-purple-400'}`} />
            <span className={`text-xs font-medium ${showPitchinPanel ? 'text-gray-400/60' : 'text-gray-300'}`}>Wallet</span>
          </button>

          {/* Trust */}
          <button
            onClick={() => { setShowTrustPanel(!showTrustPanel); setActiveBottomTab('trust'); }}
            className={`flex-1 flex flex-col items-center gap-1 py-2 px-2 rounded-lg transition ${
              activeBottomTab === 'trust'
                ? 'bg-purple-600/30'
                : showPitchinPanel ? 'hover:bg-white/10' : 'hover:bg-purple-600/10'
            } ${showPitchinPanel ? 'opacity-40' : 'opacity-100'}`}
          >
            <Lock className={`w-6 h-6 ${showPitchinPanel ? 'text-gray-400/60' : 'text-purple-400'}`} />
            <span className={`text-xs font-medium ${showPitchinPanel ? 'text-gray-400/60' : 'text-gray-300'}`}>Trust</span>
          </button>

          {/* CMMS */}
          <button
            onClick={() => { setShowCmmsPanel(!showCmmsPanel); setActiveBottomTab('cmms'); }}
            className={`flex-1 flex flex-col items-center gap-1 py-2 px-2 rounded-lg transition ${
              activeBottomTab === 'cmms'
                ? 'bg-purple-600/30'
                : showPitchinPanel ? 'hover:bg-white/10' : 'hover:bg-purple-600/10'
            } ${showPitchinPanel ? 'opacity-40' : 'opacity-100'}`}
          >
            <Settings className={`w-6 h-6 ${showPitchinPanel ? 'text-gray-400/60' : 'text-purple-400'}`} />
            <span className={`text-xs font-medium ${showPitchinPanel ? 'text-gray-400/60' : 'text-gray-300'}`}>CMMS</span>
          </button>
        </div>
      </div>

      {/* Smart Transaction Entry Modal */}
      <SmartTransactionEntry
        isOpen={showTransactionEntry}
        onClose={() => setShowTransactionEntry(false)}
        onSubmit={(transaction) => {
          // Add timestamp if not present
          if (!transaction.timestamp) {
            transaction.timestamp = new Date().toISOString();
          }

          // Store transaction
          setTransactions(prev => [transaction, ...prev]);

          // Update balance if valid amount
          if (transaction.amount) {
            if (transaction.isIncome) {
              setCurrentBalance(prev => {
                const num = parseInt(prev.replace(/,/g, '')) + transaction.amount;
                return num.toLocaleString();
              });
            } else {
              setCurrentBalance(prev => {
                const num = parseInt(prev.replace(/,/g, '')) - transaction.amount;
                return num.toLocaleString();
              });
            }
          }

          console.log('✅ Transaction recorded:', transaction);
        }}
      />
    </div>
  );
};


export default MobileView;
