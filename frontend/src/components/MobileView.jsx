import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MicOff,
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
  TrendingDown,
  DollarSign,
  Heart,
  PieChart,
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
  Rocket,
  AlertTriangle,
  Activity,
  Upload,
  Search,
  Play,
  Bell,
  Check,
  CheckCheck,
  Plus,
  Globe,
  Target,
  Clock,
  Percent
} from 'lucide-react';
import SmartTransactionEntry from './SmartTransactionEntry';
import { ProfilePage } from './auth/ProfilePage';
import Pitchin from './Pitchin';
import ICANWallet from './ICANWallet';
import TrustSystem from './TrustSystem';
import CMMSModule from './CMSSModule';
import { StatusPage } from './StatusPage';
import { StatusUploader } from './status/StatusUploader';
import SearchModal from './SearchModal';
import { BusinessLoanCalculator } from './BusinessLoanCalculator';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import {
  generateTaxReturn,
  generateBalanceSheet,
  generateIncomeStatement,
  generateCountryComplianceReport,
} from '../services/advancedReportService';
import { VelocityEngine } from '../utils/velocityEngine';
import { supabase } from '../lib/supabase/client';
import { walletAccountService } from '../services/walletAccountService';
import { walletService } from '../services/walletService';
import {
  getUserNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  subscribeToUserNotifications,
  getNotificationIcon,
  getNotificationColor,
  formatTimeAgo
} from '../services/investmentNotificationsService';
import { getUserTrustGroups } from '../services/trustService';
import { getUserStatuses, getActiveStatuses } from '../services/statusService';
import { CountryService } from '../services/countryService';

const PROFILE_CONFIG_STORAGE_PREFIX = 'ican_profile_configuration';
const DEFAULT_PROFILE_LEGAL_DISCLAIMER = 'NOT LEGAL OR FINANCIAL ADVICE: The ICAN Capital Engine is a risk assessment and organizational tool. All analysis, recommendations, and scores are for informational purposes only. Consult qualified professionals before making legal, financial, or business decisions.';

const buildProfileConfigStorageKey = (userId, email) =>
  `${PROFILE_CONFIG_STORAGE_PREFIX}_${userId || email || 'guest'}`;

const normalizeTargetNetWorthValue = (value) => {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  return digits || '0';
};

const formatTargetNetWorth = (value) => {
  const normalized = normalizeTargetNetWorthValue(value);
  const numericValue = Number(normalized);
  return Number.isFinite(numericValue) ? numericValue.toLocaleString() : '0';
};

const parseStoredProfileConfig = (rawValue) => {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const getWalletTabKey = (tabName = '') => {
  const normalized = String(tabName).toLowerCase().trim();
  if (normalized.includes('ican')) return 'ican';
  if (normalized === 'personal') return 'personal';
  if (normalized === 'agent') return 'agent';
  if (normalized === 'business') return 'business';
  if (normalized === 'trust') return 'trust';
  return normalized.replace(/\s+/g, '');
};

const getWalletTabLabel = (tabName = '') => {
  const key = getWalletTabKey(tabName);
  if (key === 'ican') return 'ICAN';
  return tabName;
};

// Recent Transactions Collapsible Component
const RecentTransactionsCollapsible = ({ transactions, formatCurrency }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Get summary data
  const recentCount = Math.min(transactions.length, 10);
  const totalIncome = transactions
    .filter(t => t.transaction_type === 'income')
    .slice(0, 5)
    .reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalExpense = transactions
    .filter(t => t.transaction_type !== 'income')
    .slice(0, 5)
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  // Business vs Personal split (all loaded transactions)
  const businessTx = transactions.filter(t =>
    (t.record_category || t.metadata?.record_category) === 'business'
  );
  const personalTx = transactions.filter(t =>
    (t.record_category || t.metadata?.record_category) !== 'business'
  );
  const businessTotal = businessTx.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
  const personalTotal = personalTx.reduce((s, t) => s + Math.abs(t.amount || 0), 0);

  // Collapsed Badge View
  if (!isExpanded) {
    return (
      <div className="px-4 pb-4">
        <div 
          className="glass-card p-3 cursor-pointer hover:bg-white hover:bg-opacity-5 transition-all"
          onClick={() => setIsExpanded(true)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-400" />
              <span className="text-white font-medium">Recent Transactions</span>
              <span className="text-xs text-gray-400">({recentCount})</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-xs">
                <div className="text-green-400">+{formatCurrency(totalIncome)}</div>
                <div className="text-red-400">-{formatCurrency(totalExpense)}</div>
              </div>
              <span className="text-gray-400 text-xs"></span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Expanded Full View
  return (
    <div className="px-4 pb-4">
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" />
            Recent Transactions
          </h3>
          <button
            onClick={() => setIsExpanded(false)}
            className="text-gray-400 hover:text-white text-xs"
          >
            
          </button>
        </div>
        {/* Business / Personal split bar */}
        {transactions.length > 0 && (
          <div className="mb-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/30 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Record Breakdown</p>
            <div className="flex gap-3">
              <div className="flex-1 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-center">
                <p className="text-xs text-blue-300 font-medium">Business</p>
                <p className="text-sm font-bold text-blue-200">{businessTx.length} records</p>
                <p className="text-xs text-blue-400/80">{formatCurrency(businessTotal)}</p>
              </div>
              <div className="flex-1 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2 text-center">
                <p className="text-xs text-green-300 font-medium">Personal</p>
                <p className="text-sm font-bold text-green-200">{personalTx.length} records</p>
                <p className="text-xs text-green-400/80">{formatCurrency(personalTotal)}</p>
              </div>
            </div>
            {/* Split progress bar */}
            {(businessTotal + personalTotal) > 0 && (
              <div className="w-full h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all"
                  style={{ width: `${Math.round((businessTotal / (businessTotal + personalTotal)) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 max-h-60 overflow-y-auto">
          {transactions.slice(0, 10).map((transaction) => {
            const recCat = transaction.record_category || transaction.metadata?.record_category || 'personal';
            const isBusiness = recCat === 'business';
            return (
              <div key={transaction.id} className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg border border-slate-700/30">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    transaction.transaction_type === 'income'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {transaction.transaction_type === 'income' ? '+' : '-'}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white truncate max-w-32">
                      {transaction.description || 'Transaction'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-xs text-gray-400">
                        {new Date(transaction.created_at).toLocaleDateString()}
                      </p>
                      {/* Business / Personal badge */}
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                        isBusiness
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          : 'bg-green-500/20 text-green-300 border border-green-500/30'
                      }`}>
                        {isBusiness ? 'Biz' : 'Personal'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${
                    transaction.transaction_type === 'income' ? 'text-green-300' : 'text-red-300'
                  }`}>
                    {transaction.transaction_type === 'income' ? '+' : '-'}{formatCurrency(Math.abs(transaction.amount || 0))}
                  </p>
                  <p className="text-xs text-gray-400 capitalize">
                    {transaction.metadata?.category || 'general'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Feature Card Component with Image Slideshow
const FeatureCardWithSlideshow = ({
  card,
  onExplore,
  immersiveMobile = false,
  forcePitchinLayout = false
}) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [failedImages, setFailedImages] = useState({});

  const availableImages = (card.images || [])
    .map((src, index) => ({ src, index }))
    .filter((image) => !failedImages[image.index]);
  const shouldShowMedia = availableImages.length > 0;
  const quickTags = (card.features || []).slice(0, 3);
  const slideWords =
    card.slideWords && card.slideWords.length > 0
      ? card.slideWords
      : [card.subtitle || card.title];
  const activeSlideWord = slideWords[currentImageIndex % slideWords.length];
  const usePitchinLikeLayout = forcePitchinLayout || card.title === 'Pitchin';

  useEffect(() => {
    setCurrentImageIndex(0);
    setFailedImages({});
  }, [card.title]);

  useEffect(() => {
    if (!shouldShowMedia || availableImages.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % availableImages.length);
    }, 3200);

    return () => clearInterval(interval);
  }, [availableImages.length, shouldShowMedia]);

  useEffect(() => {
    if (availableImages.length > 0 && currentImageIndex >= availableImages.length) {
      setCurrentImageIndex(0);
    }
  }, [availableImages.length, currentImageIndex]);

  if (immersiveMobile) {
    return (
      <article className="w-full rounded-3xl overflow-hidden border border-slate-700/70 shadow-2xl">
        <div className="relative h-[calc(100svh-12.5rem)] min-h-[560px] bg-slate-950 overflow-hidden">
          {availableImages.map((image, imgIdx) => (
            <img
              key={image.index}
              src={image.src}
              alt=""
              onError={() => setFailedImages((prev) => ({ ...prev, [image.index]: true }))}
              className={`absolute inset-0 w-full h-full object-cover transition-all duration-700 ease-out ${
                imgIdx === currentImageIndex ? 'opacity-100 scale-100' : 'opacity-0 scale-105'
              }`}
            />
          ))}

          <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/20 to-black/85 pointer-events-none" />

          <div className="absolute inset-x-0 top-0 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className={`inline-flex items-center gap-2.5 rounded-2xl bg-gradient-to-r ${card.color} px-3 py-2.5 shadow-xl`}>
                <card.icon className="w-5 h-5 text-white" />
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white leading-tight">{card.title}</h3>
                  {card.subtitle && (
                    <p className="text-[11px] text-white/85 uppercase tracking-[0.08em]">{card.subtitle}</p>
                  )}
                </div>
              </div>

            </div>

            {card.title === 'Pitchin' && card.actions && (
              <div className="mt-3 flex items-center gap-2">
                {card.actions.map((action, idx) => (
                  <button
                    key={idx}
                    onClick={() => onExplore && onExplore(card.title, action.type)}
                    className="flex items-center gap-1 bg-white/20 hover:bg-white/30 backdrop-blur-sm px-3 py-1.5 rounded-full transition-all active:scale-95"
                    title={action.label}
                  >
                    <action.icon className="w-4 h-4 text-white" />
                    <span className="text-xs font-medium text-white">{action.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {card.title === 'Pitchin' && onExplore && (
            <button
              onClick={() => onExplore(card.title, 'launch')}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-purple-600/90 hover:bg-purple-500 backdrop-blur-md px-6 py-3 rounded-full flex items-center gap-2 transition-all active:scale-95 shadow-2xl shadow-purple-500/50"
            >
              <Play className="w-5 h-5 text-white" />
              <span className="text-white font-bold text-sm">Launch Pitchin</span>
            </button>
          )}

          <div className="absolute inset-x-0 bottom-5 px-4 space-y-3">
            <div
              key={`${card.title}-${currentImageIndex}`}
              className="inline-flex items-center rounded-full border border-white/35 bg-black/45 backdrop-blur-md px-4 py-2 animate-fadeIn"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white">
                {activeSlideWord}
              </span>
            </div>

            {quickTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {quickTags.map((feature, fIdx) => (
                  <span
                    key={fIdx}
                    className="inline-flex items-center px-2.5 py-1 rounded-full bg-black/45 border border-white/25 text-[11px] text-slate-100 backdrop-blur-sm"
                  >
                    {feature}
                  </span>
                ))}
              </div>
            )}

            {onExplore && (
              <button
                onClick={() => onExplore(card.title, 'explore')}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white py-3 rounded-xl font-semibold text-sm transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Rocket className="w-4 h-4" />
                Explore {card.title}
              </button>
            )}
          </div>

        </div>
      </article>
    );
  }

  return (
    <article className="w-full bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl">
      {/* Card Header */}
      <div className={`bg-gradient-to-r ${card.color} p-4 text-white`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <card.icon className="w-5 h-5 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-lg md:text-xl font-bold truncate">{card.title}</h3>
              {card.subtitle && (
                <p className="text-[11px] text-white/75 font-medium truncate">{card.subtitle}</p>
              )}
            </div>
          </div>

          {/* Action buttons for Pitchin card */}
          {card.title === 'Pitchin' && card.actions && (
            <div className="flex items-center gap-2">
              {card.actions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={() => onExplore && onExplore(card.title, action.type)}
                  className="flex items-center gap-1 bg-white/20 hover:bg-white/30 backdrop-blur-sm px-3 py-1.5 rounded-full transition-all hover:scale-105 active:scale-95"
                  title={action.label}
                >
                  <action.icon className="w-4 h-4" />
                  <span className="text-xs font-medium">{action.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Image Slideshow */}
      {shouldShowMedia && (
        <div className={`relative w-full ${usePitchinLikeLayout ? 'h-[52vh] md:h-[58vh]' : 'h-56 md:h-64'} bg-slate-950 overflow-hidden`}>
          {availableImages.map((image, imgIdx) => (
            <img
              key={image.index}
              src={image.src}
              alt=""
              onError={() => setFailedImages((prev) => ({ ...prev, [image.index]: true }))}
              className={`absolute inset-0 w-full h-full object-cover transition-all duration-700 ease-out ${
                imgIdx === currentImageIndex ? 'opacity-100 scale-100' : 'opacity-0 scale-105'
              }`}
            />
          ))}

          {/* Gradient overlay for text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/20 pointer-events-none" />

          {/* Slide word badge that updates with each image */}
          <div className="absolute inset-x-0 bottom-4 px-4 md:px-5">
            <div
              key={`${card.title}-${currentImageIndex}`}
              className="inline-flex items-center rounded-full border border-white/35 bg-black/45 backdrop-blur-md px-4 py-2 animate-fadeIn"
            >
              <span className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.08em] text-white">
                {activeSlideWord}
              </span>
            </div>
          </div>

          {/* Quick action overlay for Pitchin */}
          {card.title === 'Pitchin' && onExplore && (
            <button
              onClick={() => onExplore(card.title, 'launch')}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-purple-600/90 hover:bg-purple-500 backdrop-blur-md px-6 py-3 rounded-full flex items-center gap-2 transition-all hover:scale-105 active:scale-95 shadow-2xl shadow-purple-500/50"
            >
              <Play className="w-5 h-5 text-white" />
              <span className="text-white font-bold text-sm">Launch Pitchin</span>
            </button>
          )}

          {/* Image indicators - Bottom center */}
          {availableImages.length > 1 && (
            <div className="absolute bottom-4 right-4 flex gap-1.5">
              {availableImages.map((_, dotIdx) => (
                <button
                  key={dotIdx}
                  type="button"
                  onClick={() => setCurrentImageIndex(dotIdx)}
                  className={`rounded-full transition-all duration-300 ${
                    dotIdx === currentImageIndex ? 'bg-white w-6 h-2' : 'bg-white/45 w-2 h-2 hover:bg-white/70'
                  }`}
                  aria-label={`Show image ${dotIdx + 1}`}
                />
              ))}
            </div>
          )}

          {/* Image counter */}
          <div className="absolute top-3 right-3 bg-black/55 backdrop-blur-sm px-2.5 py-1 rounded-full text-white text-[11px] font-medium">
            {Math.min(currentImageIndex + 1, availableImages.length)} / {availableImages.length}
          </div>
        </div>
      )}

      {/* Card Footer */}
      <div className="p-4 space-y-3">
        {quickTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {quickTags.map((feature, fIdx) => (
              <span
                key={fIdx}
                className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-700/65 border border-slate-600/70 text-[11px] text-slate-200"
              >
                {feature}
              </span>
            ))}
          </div>
        )}

        {/* Explore button for all cards */}
        {onExplore && (
          <button
            onClick={() => onExplore(card.title, 'explore')}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white py-2.5 rounded-lg font-semibold text-sm transition-all hover:scale-[1.01] active:scale-95 flex items-center justify-center gap-2"
          >
            <Rocket className="w-4 h-4" />
            Explore {card.title}
          </button>
        )}
      </div>
    </article>
  );
};

const MobileView = ({ userProfile, isWebDashboard = false }) => {
  const [authUser, setAuthUser] = useState(null);
  
  // Get the actual Supabase auth user
  useEffect(() => {
    const fetchAuthUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setAuthUser(user);
        }
      } catch (error) {
        console.error('Error fetching auth user:', error);
      }
    };
    
    fetchAuthUser();
  }, []);
  const [currentBalance, setCurrentBalance] = useState('156,002');
  const [activeBottomTab, setActiveBottomTab] = useState('home');
  const [showTransactionEntry, setShowTransactionEntry] = useState(false);
  const [transactionType, setTransactionType] = useState(null); // 'business' or 'personal'
  const [showRecordTypeModal, setShowRecordTypeModal] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [showMenuDropdown, setShowMenuDropdown] = useState(false);
  const [activeMenuTab, setActiveMenuTab] = useState('profile');
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [treasurySubTab, setTreasurySubTab] = useState('account');
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [showPitchinPanel, setShowPitchinPanel] = useState(false);
  const [showWalletPanel, setShowWalletPanel] = useState(false);
  const [mobileError, setMobileError] = useState(null);

  // Error handling for mobile view
  useEffect(() => {
    const handleMobileError = (error) => {
      console.error(' Mobile View Error:', error);
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
  const [showRecordPanel, setShowRecordPanel] = useState(false);
  const [showExpenseIncomePanel, setShowExpenseIncomePanel] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);

  // ====== VOICE RECOGNITION STATE ======
  const [isListening, setIsListening] = useState(false);
  const [voiceInterim, setVoiceInterim] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voicePrefill, setVoicePrefill] = useState('');
  const [recordInputText, setRecordInputText] = useState('');
  const [voiceSupported] = useState(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  const recognitionRef = useRef(null);
  const voiceTranscriptRef = useRef('');

  // Collapsed Sections State
  const [expandedSections, setExpandedSections] = useState({
    progress: false,
    analytics: false,
    recentTransactions: false,
    walletAccounts: false,
    exploreStatus: false
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };
  
  // Notifications State
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  
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


  const [velocityMetrics, setVelocityMetrics] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [complianceData, setComplianceData] = useState(null);
  const [scheduleData, setScheduleData] = useState(null);
  const [mode, setMode] = useState('SE');
  const [operatingCountry, setOperatingCountry] = useState('Uganda');
  
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

  // Wallet Accounts State
  const [walletAccounts, setWalletAccounts] = useState({
    ican: { balance: 0, currency: 'USD', loading: true, exists: false },
    personal: { balance: 0, currency: 'UGX', loading: true, exists: false },
    agent: { balance: 0, currency: 'USD', loading: true, exists: false },
    business: { balance: 0, currency: 'UGX', loading: true, exists: false },
    trust: { balance: 0, currency: 'ICAN', loading: true, exists: false, localCurrency: 'UGX', localSymbol: 'Sh', localValue: 0, groupCount: 0, memberCount: 0, scope: 'personal' }
  });
  const [activeWalletTab, setActiveWalletTab] = useState('ican');
  const [walletAccountsLoading, setWalletAccountsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [availableWalletTabs, setAvailableWalletTabs] = useState([]);

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

  // ========== MY PROFILE STATE FROM ProfilePage ==========
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [profileSuccess, setProfileSuccess] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [showStatusPage, setShowStatusPage] = useState(false);
  const [showStatusUploader, setShowStatusUploader] = useState(false);
  const [userStatuses, setUserStatuses] = useState([]);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showAvatarView, setShowAvatarView] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [showApprovalsModal, setShowApprovalsModal] = useState(false);
  const fileInputRef = useRef(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('');
  const [deleteAccountError, setDeleteAccountError] = useState('');
  const [deleteAccountSuccess, setDeleteAccountSuccess] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [profileConfigFormData, setProfileConfigFormData] = useState({
    fullName: userProfile?.full_name || userProfile?.name || 'GANTA ELON',
    email: userProfile?.email || 'gantaelon@gmail.com',
    targetNetWorth: '1000000',
    timelineYears: '5',
    legalDisclaimer: DEFAULT_PROFILE_LEGAL_DISCLAIMER
  });
  const [isSavingProfileConfig, setIsSavingProfileConfig] = useState(false);
  const [profileConfigError, setProfileConfigError] = useState('');
  const [profileConfigSuccess, setProfileConfigSuccess] = useState('');

  // Advanced Reporting System state
  const [selectedReportType, setSelectedReportType] = useState('financial-summary');
  const [selectedCountry, setSelectedCountry] = useState('UG');
  const [dateRange] = useState('current-month');
  const [exportFormat, setExportFormat] = useState('pdf');
  const [reportTitle, setReportTitle] = useState('ICAN Financial Report');
  const [includeAIAnalysis, setIncludeAIAnalysis] = useState(true);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [generatedReportData, setGeneratedReportData] = useState(null);

  // Report date filter: 'today' | 'week' | 'month' | 'year' | 'custom'
  const [reportDateFilter, setReportDateFilter] = useState('month');
  const [reportCustomStart, setReportCustomStart] = useState('');
  const [reportCustomEnd,   setReportCustomEnd]   = useState('');
  const [reportFilteredMetrics, setReportFilteredMetrics] = useState(null);
  const [isLoadingReportMetrics, setIsLoadingReportMetrics] = useState(false);

  // Compute ISO start/end for the chosen filter
  const getReportDateRange = (filter = reportDateFilter, customStart = reportCustomStart, customEnd = reportCustomEnd) => {
    const now = new Date();
    let start, end;
    if (filter === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (filter === 'week') {
      const day = now.getDay();
      start = new Date(now); start.setDate(now.getDate() - day); start.setHours(0,0,0,0);
      end   = new Date(now); end.setDate(now.getDate() + (6 - day)); end.setHours(23,59,59,999);
    } else if (filter === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
      end   = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else if (filter === 'custom') {
      start = customStart ? new Date(customStart) : new Date(now.getFullYear(), now.getMonth(), 1);
      end   = customEnd   ? new Date(new Date(customEnd).setHours(23,59,59,999)) : new Date();
    } else {
      // month (default)
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }
    return { start: start.toISOString(), end: end.toISOString() };
  };

  // Fetch real income/expense totals from Supabase for the chosen period
  const fetchReportMetrics = async (filter = reportDateFilter, customStart = reportCustomStart, customEnd = reportCustomEnd) => {
    setIsLoadingReportMetrics(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsLoadingReportMetrics(false); return; }
      const { start, end } = getReportDateRange(filter, customStart, customEnd);
      const { data, error } = await supabase
        .from('ican_transactions')
        .select('amount, transaction_type, description, created_at, metadata')
        .eq('user_id', user.id)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });
      if (error) { console.error('Report fetch error:', error); }
      const rows = data || [];
      const income   = rows.filter(t => t.transaction_type === 'income').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
      const expenses = rows.filter(t => t.transaction_type !== 'income').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
      // Category breakdown — category lives in metadata
      const catMap = {};
      rows.forEach(t => {
        const cat = t.metadata?.category || t.metadata?.record_category || 'Uncategorized';
        if (!catMap[cat]) catMap[cat] = { income: 0, expense: 0, count: 0 };
        if (t.transaction_type === 'income') catMap[cat].income += parseFloat(t.amount) || 0;
        else catMap[cat].expense += parseFloat(t.amount) || 0;
        catMap[cat].count++;
      });
      setReportFilteredMetrics({ income, expenses, netProfit: income - expenses, count: rows.length, categories: catMap, transactions: rows, start, end });
    } catch (e) {
      console.error('fetchReportMetrics error:', e);
      setReportFilteredMetrics({ income: 0, expenses: 0, netProfit: 0, count: 0, categories: {}, transactions: [], start: '', end: '' });
    } finally {
      setIsLoadingReportMetrics(false);
    }
  };
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
    'financial-summary': { name: ' Financial Summary', icon: '', desc: 'Complete financial overview with KPIs', advanced: true },
    'tax-filing': { name: ' Tax Filing', icon: '', desc: 'Country-compliant tax return with deductions & compliance', advanced: true, requiresCountry: true },
    'balance-sheet': { name: ' Balance Sheet', icon: '', desc: 'Assets, liabilities & equity analysis with ratios', advanced: true, requiresCountry: true },
    'income-statement': { name: ' Income Statement', icon: '', desc: 'Revenue, expenses & profitability metrics', advanced: true, requiresCountry: true },
    'cash-flow': { name: ' Cash Flow Statement', icon: '', desc: 'Operating, investing & financing cash flows' },
    'income-analysis': { name: ' Sales Report', icon: '', desc: 'Sales analysis with revenue breakdown & trends' },
    'expense-breakdown': { name: ' Expense Report', icon: '', desc: 'Categorized expenses with optimization insights' },
    'tithe-report': { name: ' Giving Report', icon: '', desc: 'Charitable giving & stewardship tracking' },
    'loan-analysis': { name: ' Debt Analysis', icon: '', desc: 'Loan portfolio & debt optimization' },
    'business-performance': { name: ' Performance Report', icon: '', desc: 'Business KPIs & growth metrics' },
    'wealth-journey': { name: ' Wealth Report', icon: '', desc: 'Net worth & wealth growth tracking' },
    'investment-analysis': { name: ' Investment Report', icon: '', desc: 'Investment performance & ROI analysis' },
    'real-estate': { name: ' Property Report', icon: '', desc: 'Real estate portfolio & valuation' },
    'custom-analysis': { name: ' Custom Report', icon: '', desc: 'Personalized financial analysis' }
  };

  // Supported countries for tax compliance
  const countries = [
    { code: 'UG', name: 'Uganda', flag: '', tax: '30%', authority: 'URA' },
    { code: 'KE', name: 'Kenya', flag: '', tax: '30%', authority: 'KRA' },
    { code: 'TZ', name: 'Tanzania', flag: '', tax: '30%', authority: 'TRA' },
    { code: 'RW', name: 'Rwanda', flag: '', tax: '30%', authority: 'RRA' },
    { code: 'US', name: 'United States', flag: '', tax: '37%', authority: 'IRS' }
  ];

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

  // Auto-load Supabase metrics when Reports modal opens or date filter changes
  useEffect(() => {
    if (showReportingSystem) {
      fetchReportMetrics(reportDateFilter, reportCustomStart, reportCustomEnd);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReportingSystem]);

  // Initialize AI chat with welcome message
  useEffect(() => {
    if (showAIChat && aiMessages.length === 0) {
      const welcomeMessage = {
        id: Date.now(),
        type: 'ai',
        content: ` Hello, friend! I'm your ICAN AI companion, here to support your financial journey with God's wisdom.

I can see you're in the **Survival Stage** - what a blessing! God is building something beautiful in your life.

 I'm here to help you with:
- Making wise spending choices
- Understanding God's principles for money
- Celebrating your progress and victories
- Finding encouragement when things are tough
- Planning your next steps with confidence

 What's on your heart today? I'm here to listen and help! `,
        timestamp: new Date().toISOString(),
        mood: 'encouraging'
      };
      setAiMessages([welcomeMessage]);
    }
  }, [showAIChat]);

  // Load notifications when notifications detail opens
  useEffect(() => {
    const loadNotifications = async () => {
      if (selectedDetail?.tab === 'security' && selectedDetail?.item === 'Notifications' && userProfile?.id) {
        setLoadingNotifications(true);
        try {
          const { data } = await getUserNotifications(userProfile.id, { limit: 50 });
          setNotifications(data || []);

          const { count } = await getUnreadNotificationCount(userProfile.id);
          setUnreadCount(count || 0);
        } catch (error) {
          console.error('Error loading notifications:', error);
        } finally {
          setLoadingNotifications(false);
        }
      }
    };

    loadNotifications();
  }, [selectedDetail, userProfile?.id]);

  // Reset danger-zone inputs when the panel is opened
  useEffect(() => {
    if (selectedDetail?.tab === 'settings' && selectedDetail?.item === 'Danger Zone') {
      setDeleteAccountPassword('');
      setDeleteAccountError('');
      setDeleteAccountSuccess('');
    }
  }, [selectedDetail]);

  // Load/sync profile configuration form data (Supabase + local storage)
  useEffect(() => {
    let isMounted = true;

    const loadProfileConfiguration = async () => {
      const fallbackName =
        userProfile?.full_name ||
        userProfile?.name ||
        authUser?.user_metadata?.full_name ||
        'GANTA ELON';
      const fallbackEmail = userProfile?.email || authUser?.email || 'gantaelon@gmail.com';
      const effectiveUserId = authUser?.id || userProfile?.id;

      const baseState = {
        fullName: fallbackName,
        email: fallbackEmail,
        targetNetWorth: normalizeTargetNetWorthValue(authUser?.user_metadata?.target_net_worth || '1000000'),
        timelineYears: String(authUser?.user_metadata?.target_timeline_years || '5'),
        legalDisclaimer: authUser?.user_metadata?.legal_disclaimer || DEFAULT_PROFILE_LEGAL_DISCLAIMER
      };

      const storageKey = buildProfileConfigStorageKey(effectiveUserId, fallbackEmail);
      const storedConfig =
        typeof window !== 'undefined'
          ? parseStoredProfileConfig(window.localStorage.getItem(storageKey))
          : null;

      const mergedFromStorage = storedConfig
        ? {
            ...baseState,
            ...storedConfig,
            targetNetWorth: normalizeTargetNetWorthValue(storedConfig.targetNetWorth ?? baseState.targetNetWorth),
            timelineYears: String(storedConfig.timelineYears ?? baseState.timelineYears),
            legalDisclaimer: storedConfig.legalDisclaimer || baseState.legalDisclaimer
          }
        : baseState;

      let nextState = mergedFromStorage;

      if (effectiveUserId && supabase) {
        const { data, error } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', effectiveUserId)
          .maybeSingle();

        if (!error && data) {
          nextState = {
            ...nextState,
            fullName: data.full_name || nextState.fullName,
            email: data.email || nextState.email
          };
        }
      }

      if (isMounted) {
        setProfileConfigFormData((prev) => ({
          ...prev,
          ...nextState
        }));
      }
    };

    loadProfileConfiguration();

    return () => {
      isMounted = false;
    };
  }, [
    authUser?.id,
    authUser?.email,
    authUser?.user_metadata?.full_name,
    authUser?.user_metadata?.target_net_worth,
    authUser?.user_metadata?.target_timeline_years,
    authUser?.user_metadata?.legal_disclaimer,
    userProfile?.id,
    userProfile?.full_name,
    userProfile?.name,
    userProfile?.email
  ]);

  // Reset profile configuration feedback when profile settings panel opens
  useEffect(() => {
    if (selectedDetail?.tab === 'settings' && (selectedDetail?.item === 'Profile Configuration' || selectedDetail?.item === 'Target Net Worth')) {
      setProfileConfigError('');
      setProfileConfigSuccess('');
    }
  }, [selectedDetail]);

  // Real-time notifications subscription
  useEffect(() => {
    if (!userProfile?.id) return;

    const unsubscribe = subscribeToUserNotifications(userProfile.id, (newNotification) => {
      // Add new notification to top of list
      setNotifications(prev => [newNotification, ...prev]);
      setUnreadCount(prev => prev + 1);

      // Show browser notification if permitted
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(newNotification.title, {
          body: newNotification.message,
          icon: '/ican-logo.png',
          badge: '/ican-logo.png',
          tag: `notification-${newNotification.id}`,
          requireInteraction: newNotification.priority === 'urgent'
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [userProfile?.id]);

  // Load VelocityEngine data on component mount
  useEffect(() => {
    const loadFinancialMetrics = async () => {
      try {
        // Get user ID from Supabase auth (same as web view)
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id || userProfile?.id || 'demo-user';
        
        if (userId) {
          const engine = new VelocityEngine(userId);
          const loadResult = await engine.loadTransactions();
          
          if (loadResult.success) {
            // Update local transactions state
            setTransactions(loadResult.data || []);
            console.log(` Mobile: Loaded ${loadResult.data?.length || 0} transactions for user ${userId}`);
          } else {
            console.warn(' Mobile: VelocityEngine load failed:', loadResult.error);
          }
          
          const metrics = engine.calculateMetrics();
          console.log(' Mobile VelocityEngine Metrics:', metrics);
          setVelocityMetrics(metrics);
        }
      } catch (error) {
        console.error('Error loading financial metrics:', error);
      }
    };

    loadFinancialMetrics();
  }, [userProfile?.id]);

  // Load all available statuses/updates for Updates section
  useEffect(() => {
    const loadStatuses = async () => {
      try {
        setLoadingStatuses(true);
        
        // Get all active statuses from all users
        const { statuses: allStats } = await getActiveStatuses();
        
        // Sort with user's own statuses first (if available), then others'
        const userOwnStatuses = allStats?.filter(s => s.user_id === userProfile?.id) || [];
        const otherStatuses = allStats?.filter(s => s.user_id !== userProfile?.id) || [];
        const combinedStatuses = [...userOwnStatuses, ...otherStatuses];
        
        setUserStatuses(combinedStatuses || []);
      } catch (error) {
        console.error('Error loading statuses:', error);
        setUserStatuses([]);
      } finally {
        setLoadingStatuses(false);
      }
    };

    loadStatuses();
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
      response = ` **Let's think about this together!**\n\nI can see you're considering a purchase. That's wise to pause and ask for guidance!\n\n **God's perspective:** "The plans of the diligent lead to profit as surely as haste leads to poverty." - Proverbs 21:5\n\n **Simple questions to ask yourself:**\n1. Is this a genuine NEED or just a WANT?\n2. Will this bring me closer to my goals or further away?\n3. Can I afford this without stress or worry?\n\n **Remember:** You're doing great by even asking these questions! This shows wisdom.`;
      mood = 'advisory';
    } else if (message.includes('save') || message.includes('invest') || message.includes('money')) {
      response = ` **Wealth Building Strategy!**\n\nAmazing that you're thinking about saving! Every UGX you save is a seed for your future.\n\n **Optimal Strategy for Your Stage:**\n Target: 50% needs, 30% wants, 20% savings\n Build emergency fund first (3 months expenses)\n Then focus on growing passive income\n\n **Quick Challenge:** Can you save an extra UGX 5,000 this week? That's UGX 260,000 per year!`;
      mood = 'encouraging';
    } else if (message.includes('goal') || message.includes('target') || message.includes('dream')) {
      response = ` **Goal Achievement Protocol!**\n\nYour dreams matter! God wants you to prosper and live fully.\n\n **Action Steps:**\n1. Track your daily spending - awareness is power\n2. Eliminate one unnecessary expense this week\n3. Create an additional income stream\n4. Celebrate small wins - progress builds momentum\n\n **Mindset Shift:** Think like an investor, not a consumer.`;
      mood = 'motivational';
    } else if (message.includes('help') || message.includes('advice') || message.includes('struggling')) {
      response = ` **I've got your back!**\n\nYou're not alone in this journey. Many people face these challenges.\n\n **Here's what I want you to know:**\n Every setback is a setup for a comeback\n Small progress is still progress\n You're stronger than you think\n This is all temporary - better days are coming\n\n**Daily Habit for Peace of Mind:**\n1. Track one transaction\n2. Celebrate one small win\n3. Pray/reflect on your progress`;
      mood = 'supportive';
    } else {
      response = ` **Thinking about your situation...**\n\nI appreciate your question! Here's my insight for someone at your stage:\n\n **Key Principle:** Every UGX saved is a seed that grows into financial freedom.\n\n **Remember:** Progress over perfection. Small consistent actions lead to big results.\n\nWhat would you like to explore more?`;
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
        decision: ' CRITICAL RISK',
        message: 'Negative cash flow - loan will worsen finances',
        color: 'text-red-300'
      };
    }

    if (debtRatio > 40) {
      return {
        decision: ' EXCESSIVE DEBT',
        message: `Debt ratio ${debtRatio.toFixed(1)}% is too high`,
        color: 'text-red-300'
      };
    }

    if (parseFloat(interestRate) > 25) {
      return {
        decision: ' HIGH RATE',
        message: 'Interest rate above 25% will drain resources',
        color: 'text-red-300'
      };
    }

    if (profitMargin < 5 || debtRatio > 25) {
      return {
        decision: ' CAUTION',
        message: `Profit margin ${profitMargin.toFixed(1)}% requires monitoring`,
        color: 'text-yellow-300'
      };
    }

    if (cashFlow > loanMetrics.monthlyPayment * 2 && debtRatio < 20 && profitMargin > 10) {
      return {
        decision: ' EXCELLENT',
        message: 'Strong financials support this loan',
        color: 'text-green-300'
      };
    }

    return {
      decision: ' RECOMMENDED',
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
        .from('transactions')
        .select('amount, transaction_type')
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
        result = data.filter(t => t.transaction_type === 'income').reduce((sum, t) => sum + (t.amount || 0), 0);
      } else if (metricType === 'expense') {
        result = data.filter(t => t.transaction_type === 'expense').reduce((sum, t) => sum + (t.amount || 0), 0);
      } else if (metricType === 'transactions') {
        result = data.length;
      }

      return result;
    } catch (error) {
      console.error('Error calculating metric:', error);
      return null;
    }
  };

  // Handle metric dropdown click - fetch data using VelocityEngine
  const handleMetricClick = async (metricKey) => {
    // Toggle dropdown
    setMetricDropdowns({...metricDropdowns, [metricKey]: !metricDropdowns[metricKey]});

    // Fetch data if not already loaded
    if (!metricDropdowns[metricKey] && !metricPeriodData[metricKey].daily) {
      setMetricPeriodData(prev => ({
        ...prev,
        [metricKey]: {...prev[metricKey], loading: true}
      }));

      try {
        // Use VelocityEngine for consistent calculations
        const engine = new VelocityEngine(userProfile?.id || 'demo-user');
        await engine.loadTransactions(); // Ensure data is loaded

        // Get period data using velocityEngine
        const dailyData = engine.getPeriodMetric(metricKey, 'daily');
        const weeklyData = engine.getPeriodMetric(metricKey, 'weekly');
        const monthlyData = engine.getPeriodMetric(metricKey, 'monthly');  
        const yearlyData = engine.getPeriodMetric(metricKey, 'yearly');

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
      } catch (error) {
        console.error('Error loading period metrics:', error);
        // Fallback to direct Supabase query
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
      console.log(' Contract analysis complete:', analysis);
    } catch (error) {
      setContractError('Failed to analyze contract. Please try again.');
      console.error('Contract analysis error:', error);
    } finally {
      setIsAnalyzingContract(false);
    }
  };

  // Global Navigator - Compliance Check Function
  const performComplianceCheck = async () => {
    setIsLoading(true);
    try {
      // Simulate API call with realistic data
      const compliance = {
        compliancePercentage: 85,
        checklist: [
          { item: 'Business License', status: 'completed', required: true },
          { item: 'Tax Clearance Certificate', status: 'completed', required: true },
          { item: 'Professional Certification', status: 'pending', required: false },
          { item: 'Regulatory Registration', status: 'completed', required: true }
        ]
      };
      setComplianceData(compliance);
      console.log(' Compliance check complete:', compliance);
    } catch (error) {
      console.error('Compliance check failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Prosperity Architect - Schedule Optimization Function
  const optimizeSchedule = async () => {
    setIsLoading(true);
    try {
      // Simulate API call with realistic recommendations
      const schedule = {
        optimizationScore: 82,
        recommendations: [
          'Block 9-11 AM for High-Value Work',
          'Schedule Spiritual Alignment: 6-7 AM daily',
          'Physical Alignment: 5-6 PM, 3x weekly',
          'Networking blocks: Tuesday/Thursday 2-4 PM',
          'Review and planning: Friday 3-4 PM'
        ],
        nextActions: ['Book gym membership', 'Set up morning routine', 'Block calendar for HVW']
      };
      setScheduleData(schedule);
      console.log(' Schedule optimization complete:', schedule);
    } catch (error) {
      console.error('Schedule optimization failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileConfigFieldChange = (field, value) => {
    setProfileConfigFormData((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSaveProfileConfiguration = async (saveMode = 'full') => {
    setProfileConfigError('');
    setProfileConfigSuccess('');

    const fullName = profileConfigFormData.fullName.trim();
    const email = profileConfigFormData.email.trim();
    const targetNetWorth = normalizeTargetNetWorthValue(profileConfigFormData.targetNetWorth);
    const timelineYears = String(profileConfigFormData.timelineYears || '5').replace(/[^\d]/g, '') || '5';
    const legalDisclaimer = (profileConfigFormData.legalDisclaimer || '').trim() || DEFAULT_PROFILE_LEGAL_DISCLAIMER;

    if (!fullName) {
      setProfileConfigError('Full name is required.');
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailPattern.test(email)) {
      setProfileConfigError('Please enter a valid email address.');
      return;
    }

    if (Number(targetNetWorth) <= 0) {
      setProfileConfigError('Target net worth must be greater than zero.');
      return;
    }

    setIsSavingProfileConfig(true);

    try {
      let activeAuthUser = authUser;

      if (!activeAuthUser && supabase) {
        const { data: { user: fetchedUser } } = await supabase.auth.getUser();
        if (fetchedUser) {
          activeAuthUser = fetchedUser;
          setAuthUser(fetchedUser);
        }
      }

      const effectiveUserId = activeAuthUser?.id || userProfile?.id;
      if (!effectiveUserId) {
        throw new Error('No active user found. Please sign in again.');
      }

      const nextConfig = {
        fullName,
        email,
        targetNetWorth,
        timelineYears,
        legalDisclaimer
      };

      if (supabase) {
        const { error: profileSaveError } = await supabase
          .from('profiles')
          .upsert(
            {
              id: effectiveUserId,
              full_name: nextConfig.fullName,
              email: nextConfig.email,
              updated_at: new Date().toISOString()
            },
            { onConflict: 'id' }
          );

        if (profileSaveError) {
          throw new Error(profileSaveError.message || 'Unable to save profile details.');
        }

        const { error: metadataError } = await supabase.auth.updateUser({
          data: {
            full_name: nextConfig.fullName,
            target_net_worth: Number(nextConfig.targetNetWorth),
            target_timeline_years: Number(nextConfig.timelineYears),
            legal_disclaimer: nextConfig.legalDisclaimer
          }
        });

        if (metadataError) {
          console.warn('Profile metadata update warning:', metadataError);
        }
      }

      if (typeof window !== 'undefined') {
        const storageKey = buildProfileConfigStorageKey(effectiveUserId, nextConfig.email);
        window.localStorage.setItem(storageKey, JSON.stringify(nextConfig));
      }

      setProfileConfigFormData(nextConfig);
      setProfileConfigSuccess(saveMode === 'target' ? 'Target net worth saved successfully.' : 'Profile configuration saved successfully.');
    } catch (error) {
      console.error('Profile configuration save error:', error);
      setProfileConfigError(error.message || 'Unable to save profile configuration right now.');
    } finally {
      setIsSavingProfileConfig(false);
    }
  };

  // Danger Zone - Delete account with password confirmation
  const handleDeleteAccount = async () => {
    setDeleteAccountError('');
    setDeleteAccountSuccess('');

    const password = deleteAccountPassword.trim();
    if (!password) {
      setDeleteAccountError('Please enter your Gmail password to confirm account deletion.');
      return;
    }

    setIsDeletingAccount(true);

    try {
      if (!supabase) {
        throw new Error('Supabase client is not ready. Please reload and try again.');
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        throw new Error('No active user found. Please sign in again.');
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Session verification failed. Please sign in again.');
      }

      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: { password }
      });

      if (error) {
        let message = error.message || 'Failed to delete account.';
        const context = error.context;

        if (context) {
          try {
            if (typeof context.json === 'function') {
              const details = await context.json();
              if (details?.message) {
                message = details.message;
              }
            } else if (typeof context.text === 'function') {
              const rawText = await context.text();
              try {
                const parsed = JSON.parse(rawText);
                if (parsed?.message) {
                  message = parsed.message;
                } else if (rawText) {
                  message = rawText;
                }
              } catch {
                if (rawText) {
                  message = rawText;
                }
              }
            } else if (typeof context === 'string') {
              message = context;
            } else if (typeof context === 'object' && context.message) {
              message = context.message;
            }
          } catch (parseError) {
            console.warn('Could not parse delete-account function error:', parseError);
          }
        }

        if (message.includes('Failed to send a request to the Edge Function')) {
          message = 'Delete-account function is unreachable. Deploy it with --no-verify-jwt, then try again.';
        }
        throw new Error(message);
      }

      if (!data?.success) {
        throw new Error(data?.message || 'Failed to delete account.');
      }

      setDeleteAccountSuccess('Account deleted successfully. Signing you out...');
      setDeleteAccountPassword('');

      await supabase.auth.signOut();
      setSelectedDetail(null);
      window.location.reload();
    } catch (error) {
      console.error('Delete account error:', error);
      setDeleteAccountError(error.message || 'Unable to delete account right now.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  // Load Wallet Accounts Data
  const loadWalletAccounts = async (userId) => {
    try {
      setWalletAccountsLoading(true);
      
      // Get wallet balances from database (wallet_accounts table only has: user_id, currency, balance, status)
      const { data: walletData, error } = await supabase
        .from('wallet_accounts')
        .select('currency, balance')
        .eq('user_id', userId);
      
      if (error) {
        console.error('Error loading wallet accounts:', error);
        return;
      }

      // Initialize wallet accounts
      const accounts = {
        ican: { balance: 0, currency: 'ICAN', loading: false, exists: false },
        personal: { balance: 0, currency: 'UGX', loading: false, exists: false },
        agent: { balance: 0, currency: 'USD', loading: false, exists: false },
        business: { balance: 0, currency: 'UGX', loading: false, exists: false },
        trust: { balance: 0, currency: 'ICAN', loading: false, exists: false, localCurrency: 'UGX', localSymbol: 'Sh', localValue: 0, groupCount: 0, memberCount: 0, scope: 'personal' }
      };

      const localCountryCode =
        authUser?.user_metadata?.country ||
        userProfile?.country ||
        userProfile?.country_code ||
        'UG';
      accounts.trust.localCurrency = CountryService.getCurrencyCode(localCountryCode);
      accounts.trust.localSymbol = CountryService.getCurrencySymbol(localCountryCode);

      // Check if user has agent account - Table doesn't exist yet, commenting out
      // const { data: agentData, error: agentError } = await supabase
      //   .from('agent_accounts')
      //   .select('id')
      //   .eq('user_id', userId)
      //   .single();

      // if (!agentError && agentData) {
      //   accounts.agent.exists = true;
      // }

      const normalizedEmail = (authUser?.email || userProfile?.email || '').trim().toLowerCase();

      // Check if user has owned/co-owned business profiles
      const [
        ownedBusinessByUserIdResult,
        coOwnedByUserIdResult,
        coOwnedByOwnerIdResult
      ] = await Promise.all([
        // Only query by user_id (owner_email doesn't exist in business_profiles)
        supabase.from('business_profiles').select('id').eq('user_id', userId).limit(1),
        supabase.from('business_co_owners').select('business_profile_id').eq('user_id', userId).limit(1),
        supabase.from('business_co_owners').select('business_profile_id').eq('owner_id', userId).limit(1)
      ]);

      const hasOwnedBusinessByUserId = !ownedBusinessByUserIdResult.error && (ownedBusinessByUserIdResult.data?.length || 0) > 0;
      const hasCoOwnedBusinessByUserId = !coOwnedByUserIdResult.error && (coOwnedByUserIdResult.data?.length || 0) > 0;
      const hasCoOwnedBusinessByOwnerId = !coOwnedByOwnerIdResult.error && (coOwnedByOwnerIdResult.data?.length || 0) > 0;
      accounts.business.exists = (
        hasOwnedBusinessByUserId ||
        hasCoOwnedBusinessByUserId ||
        hasCoOwnedBusinessByOwnerId
      );

      // Trust account only appears when user is in at least one trust group
      let hasTrustGroup = false;
      let userTrustGroups = [];
      try {
        userTrustGroups = await getUserTrustGroups(userId);
        hasTrustGroup = Array.isArray(userTrustGroups) && userTrustGroups.length > 0;
      } catch (trustGroupError) {
        console.warn('Could not verify trust group membership:', trustGroupError);
      }
      accounts.trust.exists = hasTrustGroup;
      accounts.trust.groupCount = hasTrustGroup ? userTrustGroups.length : 0;

      if (hasTrustGroup) {
        try {
          const trustGroupIds = new Set((userTrustGroups || []).map((group) => group.id).filter(Boolean));
          const { data: trustMemberRows, error: trustMemberError } = await supabase
            .from('trust_group_members')
            .select('group_id, total_contributed, is_active, role')
            .eq('user_id', userId);

          if (trustMemberError) {
            throw trustMemberError;
          }

          const activeMemberRows = (trustMemberRows || []).filter((row) => {
            const isActive = row?.is_active !== false;
            const belongsToKnownTrustGroup = trustGroupIds.size === 0 || trustGroupIds.has(row?.group_id);
            return isActive && belongsToKnownTrustGroup;
          });

          const adminGroupIds = new Set();
          (userTrustGroups || []).forEach((group) => {
            if (group?.id && group?.creator_id === userId) {
              adminGroupIds.add(group.id);
            }
          });
          activeMemberRows.forEach((row) => {
            const normalizedRole = String(row?.role || '').toLowerCase();
            if ((normalizedRole === 'creator' || normalizedRole === 'admin') && row?.group_id) {
              adminGroupIds.add(row.group_id);
            }
          });

          if (adminGroupIds.size > 0) {
            const { data: adminGroupMembers, error: adminGroupMembersError } = await supabase
              .from('trust_group_members')
              .select('group_id, total_contributed, is_active')
              .in('group_id', Array.from(adminGroupIds));

            if (adminGroupMembersError) {
              throw adminGroupMembersError;
            }

            const activeAdminGroupMembers = (adminGroupMembers || []).filter((row) => row?.is_active !== false);
            accounts.trust.balance = activeAdminGroupMembers.reduce(
              (sum, row) => sum + (parseFloat(row?.total_contributed) || 0),
              0
            );
            accounts.trust.memberCount = activeAdminGroupMembers.length;
            accounts.trust.groupCount = adminGroupIds.size;
            accounts.trust.scope = 'admin';
          } else {
            accounts.trust.balance = activeMemberRows.reduce(
              (sum, row) => sum + (parseFloat(row?.total_contributed) || 0),
              0
            );
            accounts.trust.memberCount = activeMemberRows.length;
            accounts.trust.scope = 'personal';
          }
        } catch (trustBalanceError) {
          console.warn('Could not load trust contribution balances:', trustBalanceError);
          accounts.trust.balance = 0;
          accounts.trust.memberCount = 0;
          accounts.trust.scope = 'personal';
        }
      }
      accounts.trust.localValue = CountryService.icanToLocal(accounts.trust.balance, localCountryCode);

      // Personal account exists for all users
      accounts.personal.exists = true;

      // Map wallet data to accounts by currency
      if (walletData && walletData.length > 0) {
        walletData.forEach(account => {
          const currency = account.currency;
          const balance = parseFloat(account.balance) || 0;
          
          // Map currencies to account types
          // UGX can be personal or business
          // USD can be agent or trust
          if (currency === 'UGX') {
            accounts.personal.balance = balance;
            accounts.personal.currency = currency;
            accounts.personal.exists = true;
          } else if (currency === 'USD') {
            // Keep USD wallet mapped to agent balance (if/when agent account is enabled)
            accounts.agent.balance = balance;
            accounts.agent.currency = currency;
          }
        });
      }

      // Get ICAN token balance
      try {
        const { data: icanBalance, error: icanError } = await supabase
          .from('ican_transactions')
          .select('amount, transaction_type')
          .eq('user_id', userId)
          .eq('currency', 'ICAN');

        if (!icanError && icanBalance && icanBalance.length > 0) {
          const totalIcan = icanBalance.reduce((sum, tx) => {
            return sum + (tx.transaction_type === 'purchase' ? tx.amount : -tx.amount);
          }, 0);
          accounts.ican.balance = totalIcan;
          accounts.ican.exists = totalIcan > 0; // Only show if user has ICAN tokens
        }
      } catch (icanError) {
        console.warn('Could not load ICAN balance:', icanError);
      }

      setWalletAccounts(accounts);
      
      // Filter available wallet tabs based on existing accounts
      const availableTabs = walletTabs.filter(tab => {
        const tabKey = getWalletTabKey(tab.name);
        return accounts[tabKey]?.exists;
      });
      
      setAvailableWalletTabs(availableTabs);
      
      // Set active tab to first available account
      if (availableTabs.length > 0) {
        const firstAvailable = getWalletTabKey(availableTabs[0].name);
        setActiveWalletTab(firstAvailable);
      }
      
      console.log(' Wallet accounts loaded:', accounts);
      console.log(' Available wallet tabs:', availableTabs.map(t => t.name));
      
    } catch (error) {
      console.error('Error loading wallet accounts:', error);
    } finally {
      setWalletAccountsLoading(false);
    }
  };

  // Initialize wallet data on component mount
  useEffect(() => {
    const initializeWalletData = async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error || !user) {
          console.warn(' User not authenticated for wallet data');
          return;
        }

        setCurrentUserId(user.id);
        
        // Ensure wallet accounts exist
        await walletAccountService.ensureWalletAccountsExist(user.id);
        
        // Load wallet data
        await loadWalletAccounts(user.id);
        
      } catch (error) {
        console.error(' Error initializing wallet data:', error);
        setWalletAccountsLoading(false);
      }
    };

    initializeWalletData();
  }, []);

  // Financial metrics data
  const formatCurrency = (value) => {
    if (!value) return '0';
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toFixed(0);
  };

  const formatExactIcanBalance = (value) =>
    (Number(value) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 8
    });

  const formatWalletBalanceByTab = (tabKey, value) => {
    if (tabKey === 'trust') {
      return formatExactIcanBalance(value);
    }
    return (Number(value) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
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
    { label: 'Savings Rate', value: `${velocityMetrics?.savingsRate || 0}%`, icon: PieChart, color: 'from-purple-500 to-pink-600' },
    { label: 'Net Worth', value: formatCurrency(velocityMetrics?.netWorth || 0), icon: TrendingUp, color: 'from-yellow-500 to-orange-600' }
  ];

  const walletTabs = [
    { name: 'Ican Wallet', icon: Wallet },
    { name: 'Personal', icon: User2 },
    { name: 'Agent', icon: Settings },
    { name: 'Business', icon: Briefcase },
    { name: 'Trust', icon: Lock }
  ];

  // Menu Dropdown Data - UPDATED WITH NEW SECTIONS
  const menuOptions = {
    profile: {
      label: ' My Profile',
      icon: User,
      items: ['Profile Info', 'Financial Goals', 'Risk Profile', 'Account Security']
    },
    security: {
      label: ' Security',
      icon: Shield,
      items: ['Treasury Guardian', 'Contract Analysis', 'Privacy Settings', '2FA Verification']
    },
    readiness: {
      label: ' Readiness',
      icon: CheckCircle,
      items: ['Global Navigator', 'Regulatory Gap', 'Compliance Check', 'Documentation']
    },
    growth: {
      label: ' Growth',
      icon: TrendingUp,
      items: ['Prosperity Architect', 'Schedule Optimization', 'Investments', 'Opportunities']
    },
    settings: {
      label: ' Settings',
      icon: Settings,
      items: ['Readiness Pillars', 'Profile Configuration', 'Target Net Worth', 'Preferences']
    }
  };

  const formattedTargetNetWorth = formatTargetNetWorth(profileConfigFormData.targetNetWorth);

  const actionChips = [
    { label: 'Progress', icon: Building, color: 'bg-gradient-to-br from-blue-500 to-blue-600' },
    { label: 'Analytics', icon: BarChart3, color: 'bg-gradient-to-br from-orange-500 to-orange-600' },
    { label: 'Loans', icon: Briefcase, color: 'bg-gradient-to-br from-purple-500 to-purple-600' },
    { label: 'Wallet', icon: DollarSign, color: 'bg-gradient-to-br from-teal-500 to-teal-600' },
    { label: 'Tith', icon: Heart, color: 'bg-gradient-to-br from-yellow-500 to-yellow-600' },
    { label: 'Reports', icon: PieChart, color: 'bg-gradient-to-br from-rose-500 to-rose-600' },
    { label: 'ICAN AI', icon: Brain, color: 'bg-gradient-to-br from-violet-500 to-violet-600' }
  ];

  // Carousel content with images
  const carouselCards = [
    {
      title: 'Pitchin',
      subtitle: 'Part 3: Invest in Businesses',
      color: 'from-purple-600 to-pink-600',
      icon: Briefcase,
      features: ['Invest in ventures', 'Raise side-business capital', 'Earn returns'],
      slideWords: ['Invest in Businesses', 'Grow Side Ventures'],
      images: ['/images/ICANera pitchin.png', '/images/ICANera pitchin 8.png'],
      actions: [
        { label: 'Create', icon: Upload, type: 'create' },
        { label: 'Explore', icon: Search, type: 'explore' }
      ]
    },
    {
      title: 'Wallet',
      subtitle: 'Part 8: Instant Money Movement',
      color: 'from-green-600 to-emerald-600',
      icon: Wallet,
      features: ['Instant transfers', 'Multi-wallet control', 'Global movement'],
      slideWords: ['Move Money Instantly', 'One Wallet, Full Control'],
      images: ['/images/icanera wallet.png', '/images/ICANwallet.png']
    },
    {
      title: 'Trust',
      subtitle: 'Part 2: Smart Savings Groups',
      color: 'from-blue-600 to-cyan-600',
      icon: Lock,
      features: ['Save as a group', 'Earn on contributions', 'Borrow at fair rates'],
      slideWords: ['Smart Savings Groups', 'Save, Earn, Borrow', 'Democratic Control'],
      images: ['/images/ICANera trust.png', '/images/ICANera trust 2.png', '/images/trust.png']
    },
    {
      title: 'CMMS',
      subtitle: 'Part 5: Business Management',
      color: 'from-indigo-600 to-purple-600',
      icon: Settings,
      features: ['Track assets & supplies', 'Manage workers & tasks', 'Know true profit'],
      slideWords: ['Run Your Side Business', 'Track Operations Clearly', 'Make Better Decisions'],
      images: ['/images/ICANera CMMS.png', '/images/ICANera CMMS1.png', '/images/cmms.png']
    },
    {
      title: 'Expense & Income',
      subtitle: 'Part 1: Records',
      color: 'from-orange-600 to-red-600',
      icon: TrendingUp,
      features: ['Track every dollar', 'See monthly balance', 'Control spending'],
      slideWords: ['Track Every Dollar', 'Know Where Money Goes'],
      images: ['/images/ICANera expense.png', '/images/dairy expense and inacome.png']
    },
    {
      title: 'Trade',
      subtitle: 'Part 9: ICAN Coins',
      color: 'from-yellow-600 to-orange-600',
      icon: BarChart3,
      features: ['Own digital assets', 'Build long-term wealth', 'Protect buying power'],
      slideWords: ['Own ICAN Coins', 'Grow Over Time', 'Future of Money'],
      images: ['/images/incaera share.png', '/images/ICAN era sacco.png', '/images/sacco.png']
    },
    {
      title: 'Tithe',
      subtitle: 'Part 6: Giving Back',
      color: 'from-pink-600 to-rose-600',
      icon: Heart,
      features: ['Automatic giving', 'Track yearly impact', 'Keep giving records'],
      slideWords: ['Give Consistently', 'Track Your Impact'],
      images: ['/images/ICANera tithe.png', '/images/ICANera tith2.png']
    }
  ];

  const handleFeatureExplore = (title, action) => {
    console.log(`Exploring ${title} - Action: ${action}`);

    if (title === 'Pitchin') {
      setShowPitchinPanel(true);
      setActiveBottomTab('pitchin');
    } else if (title === 'Wallet') {
      setShowWalletPanel(true);
      setActiveBottomTab('wallet');
    } else if (title === 'Trust') {
      setShowTrustPanel(true);
      setActiveBottomTab('trust');
    } else if (title === 'CMMS') {
      setShowCmmsPanel(true);
      setActiveBottomTab('cmms');
    } else if (title === 'Expense & Income') {
      setShowExpenseIncomePanel(true);
      setShowTransactionEntry(true);
      setTransactionType('personal');
      setActiveBottomTab('expenses');
    } else if (title === 'Trade') {
      setShowWalletPanel(true);
      setActiveBottomTab('wallet');
    } else if (title === 'Tithe') {
      setShowTithingCalculator(true);
    } else if (title === 'Reports') {
      setShowReportingSystem(true);
    }
  };

  const isOverlayPanelOpen =
    showPitchinPanel ||
    showWalletPanel ||
    showTrustPanel ||
    showCmmsPanel;

  const showDashboardHeader = !isWebDashboard || !isOverlayPanelOpen;
  const headerNavTabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'readiness', label: 'Readiness', icon: Globe },
    { id: 'growth', label: 'Growth', icon: TrendingUp },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  const activeHeaderTab =
    showPitchinPanel ? 'pitchin' :
    showWalletPanel ? 'wallet' :
    showTrustPanel ? 'trust' :
    showCmmsPanel ? 'cmms' :
    selectedDetail?.tab === 'security' ? 'security' :
    selectedDetail?.tab === 'readiness' ? 'readiness' :
    selectedDetail?.tab === 'growth' ? 'growth' :
    selectedDetail?.tab === 'settings' ? 'settings' :
    'dashboard';
  const overlayPanelBottomInset = 'calc(5.5rem + env(safe-area-inset-bottom))';

  const closeHeaderPanels = () => {
    setShowProfilePanel(false);
    setShowPitchinPanel(false);
    setShowWalletPanel(false);
    setShowTrustPanel(false);
    setShowCmmsPanel(false);
  };

  const openHeaderPanel = (panelId) => {
    setShowPitchinPanel(panelId === 'pitchin');
    setShowWalletPanel(panelId === 'wallet');
    setShowTrustPanel(panelId === 'trust');
    setShowCmmsPanel(panelId === 'cmms');
    setActiveBottomTab(panelId);
  };

  const handleHeaderTabClick = (tabId) => {
    setShowMenuDropdown(false);

    if (tabId === 'dashboard') {
      closeHeaderPanels();
      setSelectedDetail(null);
      setActiveBottomTab('home');
      return;
    }

    if (tabId === 'pitchin' || tabId === 'wallet' || tabId === 'trust' || tabId === 'cmms') {
      setSelectedDetail(null);
      setShowProfilePanel(false);
      openHeaderPanel(tabId);
      return;
    }

    closeHeaderPanels();

    if (tabId === 'security') {
      setSelectedDetail({ tab: 'security', item: 'Security' });
      return;
    }

    if (tabId === 'readiness') {
      setSelectedDetail({ tab: 'readiness', item: 'Readiness' });
      return;
    }

    if (tabId === 'growth') {
      setSelectedDetail({ tab: 'growth', item: 'Growth' });
      return;
    }

    if (tabId === 'settings') {
      setSelectedDetail({ tab: 'settings', item: 'Readiness Pillars' });
    }
  };

  // ====== LOAN / RECORD HELPERS ======
  // Wide net — catches natural speech and typing
  const detectLoanInText = (text) =>
    /\b(loan|loans|borrow|borrowed|borrowing|lend|lent|lending|credit|overdraft|mortgage|financing|finance|advance|salary advance|cash advance|debt|repay|repayment|owe|owed|bank loan|microfinance|money request|need money|get money|take money)\b/i.test(text);

  const extractLoanAmount = (text) => {
    const m = text.match(/(\d[\d,]*\.?\d*)\s*(million|m\b|k\b|thousand)?/i);
    if (!m) return '';
    let val = parseFloat(m[1].replace(/,/g, ''));
    const suffix = (m[2] || '').toLowerCase();
    if (suffix.startsWith('m') || suffix === 'million') val *= 1_000_000;
    else if (suffix === 'k' || suffix === 'thousand') val *= 1_000;
    return val > 0 ? String(Math.round(val)) : '';
  };

  // Central submit for both typed and voice input
  const handleRecordSubmit = (text) => {
    if (!text || !text.trim()) return;
    setRecordInputText('');
    if (detectLoanInText(text)) {
      const amount = extractLoanAmount(text);
      if (amount) setLoanAmount(amount);
      setShowBusinessLoanCalculator(true);
    } else {
      setVoicePrefill(text.trim());
      setShowRecordTypeModal(true);
    }
  };

  // ====== VOICE RECOGNITION FUNCTIONS ======
  const startVoiceRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    // Stop any existing recognition
    recognitionRef.current?.abort();

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognitionRef.current = recognition;
    voiceTranscriptRef.current = '';
    setVoiceTranscript('');
    setVoiceInterim('');

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalChunk += t;
        } else {
          interim += t;
        }
      }
      setVoiceInterim(interim);
      if (finalChunk) {
        voiceTranscriptRef.current = (voiceTranscriptRef.current + ' ' + finalChunk).trim();
        setVoiceTranscript(voiceTranscriptRef.current);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setVoiceInterim('');
      const finalText = voiceTranscriptRef.current.trim();
      voiceTranscriptRef.current = '';
      setVoiceTranscript('');
      if (finalText) {
        // Route: loan phrases → loan calculator; everything else → transaction entry
        handleRecordSubmit(finalText);
      }
    };

    recognition.onerror = (event) => {
      console.warn('Voice recognition error:', event.error);
      setIsListening(false);
      setVoiceInterim('');
      setVoiceTranscript('');
      voiceTranscriptRef.current = '';
    };

    recognition.start();
  };

  const stopVoiceRecognition = () => {
    recognitionRef.current?.stop();
  };

  return (
    <div className={`min-h-screen text-white overflow-x-hidden ${
      isWebDashboard
        ? `bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950 pb-32 ${showDashboardHeader ? 'pt-36 md:pt-40' : ''}`
        : 'bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 pb-28'
    }`}>
      {/* ====== HEADER ====== */}
      {showDashboardHeader && (
      <div className={`${isWebDashboard ? 'fixed top-0 left-0 right-0 z-[70]' : 'sticky top-0 z-40'} border-b ${
        isWebDashboard
          ? 'bg-gradient-to-r from-slate-950/95 via-purple-900/80 to-slate-950/95 backdrop-blur-xl border-purple-400/30 shadow-[0_12px_30px_rgba(8,6,24,0.45)]'
          : 'bg-gradient-to-b from-slate-950/95 to-purple-950/80 backdrop-blur-md border-purple-500/20'
      }`}>
        <div className={`px-3 py-2.5 sm:px-4 sm:py-3 relative ${isWebDashboard ? 'max-w-7xl mx-auto' : ''}`}>
          <div className={isWebDashboard ? 'rounded-2xl border border-purple-400/25 bg-slate-900/55 px-3 py-2 shadow-[0_10px_28px_rgba(16,10,34,0.4)]' : ''}>
          {/* Header Row - IcanEra, Search, Menu */}
          <div className={`flex items-center w-full gap-3 ${isWebDashboard ? 'min-h-[54px]' : ''}`}>
            {/* IcanEra Branding - Left aligned */}
            <h1 className={`${isWebDashboard ? 'text-3xl md:text-4xl' : 'text-2xl sm:text-3xl'} font-serif font-bold text-transparent bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 bg-clip-text tracking-wide sm:tracking-wider leading-tight`}>
              IcanEra
            </h1>

            {/* Search Icon */}
            <button
              onClick={() => setShowSearchModal(true)}
              className="p-1.5 sm:p-2 hover:bg-purple-500/20 rounded-lg transition active:scale-95 flex-shrink-0"
              title="Search and AI Assistant"
            >
              <Search className="w-5 sm:w-6 h-5 sm:h-6 text-gray-300 hover:text-white" />
            </button>

            {/* Spacer */}
            <div className="flex-1"></div>

            {/* Header Menu Actions - RIGHT */}
            {isWebDashboard ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedDetail({ tab: 'profile', item: 'My Profile' })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-cyan-300/40 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-100 text-xs font-semibold transition"
                  title="Open my profile"
                >
                  <User className="w-4 h-4" />
                  Profile
                </button>
                <button
                  onClick={() => setShowStatusPage(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-purple-300/40 bg-purple-500/20 hover:bg-purple-500/30 text-purple-100 text-xs font-semibold transition"
                  title="Open status viewer"
                >
                  <Eye className="w-4 h-4" />
                  Status
                </button>
                <button
                  onClick={() => setShowStatusUploader(true)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-indigo-300/40 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-100 transition"
                  title="Add status"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
              <div className="relative">
              <button 
                onClick={() => setShowMenuDropdown(!showMenuDropdown)}
                className="p-1.5 sm:p-2 hover:bg-purple-500/20 rounded-lg transition active:scale-95"
              >
                <MoreVertical className="w-5 sm:w-6 h-5 sm:h-6 text-purple-400" />
              </button>

              {/* Dropdown Menu - Exact Image Layout */}
              {showMenuDropdown && (
                <div className="absolute right-0 top-full mt-2 bg-slate-900 border border-purple-500/30 rounded-lg shadow-2xl z-50 w-56 overflow-hidden">
                  <div className="p-2">
                    {/* My profile */}
                    <button
                      onClick={() => {
                        setSelectedDetail({ tab: 'profile', item: 'My Profile' });
                        setShowMenuDropdown(false);
                      }}
                      className="w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-purple-500/20 hover:text-purple-300 rounded transition"
                    >
                       My profile
                    </button>

                    {/* Security */}
                    <button
                      onClick={() => {
                        setSelectedDetail({ tab: 'security', item: 'Security' });
                        setShowMenuDropdown(false);
                      }}
                      className="w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-purple-500/20 hover:text-purple-300 rounded transition"
                    >
                       Security
                    </button>

                    {/* Readiness */}
                    <button
                      onClick={() => {
                        setSelectedDetail({ tab: 'readiness', item: 'Readiness' });
                        setShowMenuDropdown(false);
                      }}
                      className="w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-purple-500/20 hover:text-purple-300 rounded transition"
                    >
                       Readiness
                    </button>

                    {/* Growth */}
                    <button
                      onClick={() => {
                        setSelectedDetail({ tab: 'growth', item: 'Growth' });
                        setShowMenuDropdown(false);
                      }}
                      className="w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-purple-500/20 hover:text-purple-300 rounded transition"
                    >
                       Growth
                    </button>

                    {/* Reports */}
                    <button
                      onClick={() => {
                        setShowReportingSystem(true);
                        setShowMenuDropdown(false);
                      }}
                      className="w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-rose-500/20 hover:text-rose-300 rounded transition flex items-center gap-2"
                    >
                      <span>📊</span> Reports
                    </button>

                    {/* Tithe */}
                    <button
                      onClick={() => {
                        setShowTithingCalculator(true);
                        setShowMenuDropdown(false);
                      }}
                      className="w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-yellow-500/20 hover:text-yellow-300 rounded transition flex items-center gap-2"
                    >
                      <span>🙏</span> Tithe
                    </button>

                    {/* Loan Calculator */}
                    <button
                      onClick={() => {
                        setShowBusinessLoanCalculator(true);
                        setShowMenuDropdown(false);
                      }}
                      className="w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-amber-500/20 hover:text-amber-300 rounded transition flex items-center gap-2"
                    >
                      <span>🏦</span> Loan Calculator
                    </button>

                    {/* Settings - Expandable */}
                    <div className="space-y-1">
                      <button
                        onClick={() => setActiveMenuTab(activeMenuTab === 'settings' ? null : 'settings')}
                        className="w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-purple-500/20 hover:text-purple-300 rounded transition flex items-center justify-between"
                      >
                        <span> Settings</span>
                        <span className={`text-xs transition ${activeMenuTab === 'settings' ? 'rotate-90' : ''}`}></span>
                      </button>

                      {/* Settings Submenu */}
                      {activeMenuTab === 'settings' && (
                        <div className="pl-4 space-y-1">
                          <button
                            onClick={() => {
                              setSelectedDetail({ tab: 'settings', item: 'Readiness Pillars' });
                              setShowMenuDropdown(false);
                            }}
                            className="w-full px-4 py-2 text-left text-xs text-gray-400 hover:bg-purple-500/10 hover:text-purple-200 rounded transition"
                          >
                             Readiness Pillars
                          </button>

                          <button
                            onClick={() => {
                              setSelectedDetail({ tab: 'settings', item: 'Profile Configuration' });
                              setShowMenuDropdown(false);
                            }}
                            className="w-full px-4 py-2 text-left text-xs text-gray-400 hover:bg-purple-500/10 hover:text-purple-200 rounded transition"
                          >
                             Profile Configuration
                          </button>

                          <button
                            onClick={() => {
                              setSelectedDetail({ tab: 'settings', item: 'Danger Zone' });
                              setShowMenuDropdown(false);
                            }}
                            className="w-full px-4 py-2 text-left text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded transition"
                          >
                             Danger Zone
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              </div>
            </div>
            )}
          </div>

          {isWebDashboard && (
            <div className="mt-2">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {headerNavTabs.map((tab) => {
                  const isActive = activeHeaderTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleHeaderTabClick(tab.id)}
                      className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition ${
                        isActive
                          ? 'bg-purple-500/30 text-white border-purple-300/60 shadow-[0_0_12px_rgba(168,85,247,0.35)]'
                          : 'bg-slate-900/50 text-gray-300 border-slate-700 hover:text-white hover:border-purple-400/50'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
      )}

      {/* ====== RECORD EVERY TRANSACTION SECTION ====== */}
      <div className="px-4 py-4">
        <h2 className="text-lg font-bold text-white mb-3">Record Every Transaction</h2>

        {/* ── Quick shortcut chips ── */}
        <div className="flex gap-2 mb-3 flex-wrap">
          {/* Business record shortcut */}
          <button
            onClick={() => { setTransactionType('business'); setShowTransactionEntry(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/20 border border-blue-400/50 hover:bg-blue-500/30 active:scale-95 transition-all text-blue-200 text-xs font-semibold"
          >
            <span>💼</span> Business
          </button>
          {/* Personal record shortcut */}
          <button
            onClick={() => { setTransactionType('personal'); setShowTransactionEntry(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/20 border border-green-400/50 hover:bg-green-500/30 active:scale-95 transition-all text-green-200 text-xs font-semibold"
          >
            <span>👤</span> Personal
          </button>
        </div>

        {/* Main input strip — turns amber when loan detected */}
        {(() => {
          const loanDetected = !isListening && detectLoanInText(recordInputText);
          return (
            <div
              onClick={() => {
                // If loan is detected and user taps the strip body, open calculator directly
                if (loanDetected && recordInputText.trim()) {
                  handleRecordSubmit(recordInputText.trim());
                }
              }}
              className={`w-full flex items-center gap-3 rounded-full px-4 py-3 sm:py-4 shadow-lg transition-all ${
                isListening
                  ? 'bg-gradient-to-r from-red-700 to-red-600 border border-red-400/60 shadow-red-600/40'
                  : loanDetected
                    ? 'bg-gradient-to-r from-amber-700 to-amber-600 border-2 border-amber-400/80 shadow-amber-600/50 cursor-pointer'
                    : 'bg-gradient-to-r from-purple-700 to-purple-600 border border-purple-500/50 shadow-purple-600/40'
              }`}
            >
              {/* Loan detected icon */}
              {loanDetected && (
                <span className="text-lg flex-shrink-0">🏦</span>
              )}

              {/* Editable text input */}
              <input
                type="text"
                value={isListening ? (voiceInterim || voiceTranscript || '') : recordInputText}
                onChange={(e) => { if (!isListening) setRecordInputText(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isListening && recordInputText.trim()) {
                    handleRecordSubmit(recordInputText.trim());
                  }
                }}
                placeholder={
                  isListening
                    ? 'Listening... speak now 🎙'
                    : 'Type or speak — loan, income, expense...'
                }
                readOnly={isListening}
                onClick={(e) => e.stopPropagation()} // don't double-fire strip click
                className="flex-1 bg-transparent text-white placeholder-gray-300 outline-none text-sm sm:text-base min-w-0"
              />

              {/* Submit button */}
              {!isListening && recordInputText.trim() && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleRecordSubmit(recordInputText.trim()); }}
                  className={`flex-shrink-0 p-1.5 rounded-full transition-all active:scale-90 ${
                    loanDetected ? 'bg-white/30 hover:bg-white/40' : 'bg-white/20 hover:bg-white/30'
                  }`}
                  title={loanDetected ? 'Open Loan Calculator' : 'Submit'}
                >
                  {loanDetected
                    ? <span className="text-base leading-none">🏦</span>
                    : <Check className="w-4 h-4 text-white" />}
                </button>
              )}

              {/* Mic button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isListening) stopVoiceRecognition();
                  else startVoiceRecognition();
                }}
                className={`flex-shrink-0 p-1.5 rounded-full transition-all active:scale-90 ${
                  isListening ? 'bg-white/20 animate-pulse' : 'hover:bg-white/10'
                }`}
                title={isListening ? 'Tap to stop recording' : 'Tap to speak'}
              >
                {isListening
                  ? <MicOff className="w-5 sm:w-6 h-5 sm:h-6 text-red-200" />
                  : <Mic className="w-5 sm:w-6 h-5 sm:h-6 text-white" />}
              </button>
            </div>
          );
        })()}

        {/* Context hints */}
        {isListening ? (
          <p className="text-center text-xs text-red-300 mt-2 animate-pulse">
            🎙 Listening... tap the mic to stop
          </p>
        ) : recordInputText.trim() && detectLoanInText(recordInputText) ? (
          <p className="text-center text-xs text-amber-300 mt-2 font-medium animate-pulse">
            🏦 Loan detected — tap strip or ✓ to open Loan Calculator
          </p>
        ) : null}
      </div>

      {/* ====== DETAIL PAGE - SETTINGS ONLY ====== */}
      {selectedDetail && (
        <div className="fixed inset-0 bg-black/60 z-40 flex items-end">
          <div className="bg-gradient-to-br from-slate-900 to-purple-900 w-full rounded-t-2xl pl-6 pr-8 pt-6 pb-[calc(7rem+env(safe-area-inset-bottom))] max-h-[90vh] overflow-y-auto">
            {/* Header - Settings Only */}
            {!(selectedDetail.tab === 'profile' && selectedDetail.item === 'My Profile') && (
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-purple-500/20">
              <div>
                <h2 className="text-2xl font-bold text-purple-300">
                   {selectedDetail.item}
                </h2>
              </div>
              <button
                onClick={() => setSelectedDetail(null)}
                className="text-2xl text-gray-400 hover:text-white transition"
              >
                
              </button>
              </div>
            )}

            {/* Content - Single Column */}
            <div className="space-y-4">
              {/* MY PROFILE */}
              {selectedDetail.tab === 'profile' && selectedDetail.item === 'My Profile' && (
                <div className="overflow-hidden rounded-lg">
                  <ProfilePage
                    onClose={() => setSelectedDetail(null)}
                    onLogout={() => {
                      setSelectedDetail(null);
                    }}
                  />
                </div>
              )}
              {false && selectedDetail.tab === 'profile' && selectedDetail.item === 'My Profile' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-purple-500/30 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-white mb-4"> Profile Information</h3>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-gray-400">Name</p>
                        <p className="text-white font-semibold">GANTA ELON</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Email</p>
                        <p className="text-white font-semibold">gantaelon@gmail.com</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Member Since</p>
                        <p className="text-white font-semibold">January 1, 2026</p>
                      </div>
                      <button className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium text-sm mt-3">
                         Edit Profile
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SECURITY - TREASURY GUARDIAN */}
              {selectedDetail.tab === 'security' && selectedDetail.item === 'Security' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-blue-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-4">
                      <Shield className="w-6 h-6 text-blue-400" />
                      <h2 className="text-lg font-semibold text-white">Treasury Guardian</h2>
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="block text-white font-medium mb-2">Contract Text</label>
                        <textarea
                          value={contractText}
                          onChange={(e) => setContractText(e.target.value)}
                          placeholder="Paste contract or terms & conditions here..."
                          className="w-full h-32 px-4 py-3 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none text-sm"
                        />
                      </div>
                      
                      {contractError && (
                        <div className="text-red-400 text-xs bg-red-500/20 border border-red-500/30 rounded-lg p-3">
                          {contractError}
                        </div>
                      )}
                      
                      <button
                        onClick={analyzeContract}
                        disabled={!contractText.trim() || isAnalyzingContract}
                        className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 text-white rounded-lg transition-colors font-medium"
                      >
                        {isAnalyzingContract ? 'Analyzing Contract...' : 'Analyze Contract (Secure)'}
                      </button>
                    </div>

                    {contractAnalysis && (
                      <div className="mt-6 space-y-4">
                        <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4">
                          <h3 className="text-green-400 font-semibold mb-2">Financial Safety Score</h3>
                          <div className="text-2xl font-bold text-white">
                            {contractAnalysis.safetyScore?.toFixed(1) || '0'}/10.0
                          </div>
                        </div>

                        {contractAnalysis.criticalRisks && contractAnalysis.criticalRisks.length > 0 && (
                          <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-4">
                            <h3 className="text-yellow-400 font-semibold mb-2">Critical Liability Flags</h3>
                            <ul className="space-y-1">
                              {contractAnalysis.criticalRisks.map((flag, index) => (
                                <li key={index} className="text-white flex items-start gap-2 text-sm">
                                  <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                                  {flag}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-4">
                          <h3 className="text-blue-400 font-semibold mb-2">Recommendation</h3>
                          <p className="text-white text-sm">{contractAnalysis.executiveSummary || contractAnalysis.recommendation}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* READINESS - GLOBAL NAVIGATOR */}
              {selectedDetail.tab === 'readiness' && selectedDetail.item === 'Readiness' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-green-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-4">
                      <Globe className="w-6 h-6 text-green-400" />
                      <h2 className="text-lg font-semibold text-white">Global Navigator</h2>
                    </div>

                    <div className="mb-4">
                      <div className="flex flex-col gap-4 mb-4">
                        <div>
                          <label className="block text-white font-medium mb-2">Operating Mode</label>
                          <select
                            value={mode}
                            onChange={(e) => setMode(e.target.value)}
                            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-green-400"
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
                            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-green-400"
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
                        <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4">
                          <h3 className="text-green-400 font-semibold mb-2">Compliance Status</h3>
                          <div className="text-2xl font-bold text-white">
                            {Math.round(complianceData.compliancePercentage)}% Complete
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h3 className="text-white font-semibold text-sm">Compliance Checklist</h3>
                          {complianceData.checklist.map((item, index) => (
                            <div key={index} className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
                              item.status === 'completed' ? 'bg-green-500/20 border border-green-500/30' :
                              item.status === 'pending' ? 'bg-yellow-500/20 border border-yellow-500/30' :
                              'bg-red-500/20 border border-red-500/30'
                            }`}>
                              {item.status === 'completed' ? 
                                <CheckCircle className="w-5 h-5 text-green-400" /> :
                                <AlertTriangle className="w-5 h-5 text-yellow-400" />
                              }
                              <div className="flex-1">
                                <span className="text-white font-medium">{item.item}</span>
                                {item.required && <span className="text-red-400 ml-2">*Required</span>}
                              </div>
                              <span className={`text-xs px-2 py-1 rounded ${
                                item.status === 'completed' ? 'bg-green-600 text-white' :
                                item.status === 'pending' ? 'bg-yellow-600 text-white' :
                                'bg-red-600 text-white'
                              }`}>
                                {item.status.replace(/-/g, ' ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* GROWTH - PROSPERITY ARCHITECT */}
              {selectedDetail.tab === 'growth' && selectedDetail.item === 'Growth' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-purple-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-4">
                      <Rocket className="w-6 h-6 text-purple-400" />
                      <h2 className="text-lg font-semibold text-white">Prosperity Architect</h2>
                    </div>

                    <div className="mb-4">
                      <p className="text-gray-300 mb-4 text-sm">
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
                        <div className="bg-purple-500/20 border border-purple-500/30 rounded-lg p-4">
                          <h3 className="text-purple-400 font-semibold mb-2">Optimization Score</h3>
                          <div className="text-2xl font-bold text-white">
                            {Math.round(scheduleData.optimizationScore)}%
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h3 className="text-white font-semibold text-sm">Schedule Recommendations</h3>
                          {scheduleData.recommendations.map((rec, index) => (
                            <div key={index} className="flex items-start gap-3 p-3 bg-white/5 rounded-lg">
                              <Clock className="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" />
                              <span className="text-white text-sm">{rec}</span>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-3">
                          <h3 className="text-white font-semibold text-sm">Next Actions</h3>
                          {scheduleData.nextActions.map((action, index) => (
                            <div key={index} className="flex items-center gap-3 p-3 bg-blue-500/20 border border-blue-500/30 rounded-lg">
                              <Target className="w-5 h-5 text-blue-400" />
                              <span className="text-white text-sm">{action}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* DANGER ZONE - DELETE ACCOUNT */}
              {selectedDetail.tab === 'settings' && selectedDetail.item === 'Danger Zone' && (
                <div className="space-y-4">
                  <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-red-300 mb-4">Danger Zone - Delete Your Account</h3>
                    <p className="text-xs text-gray-300 mb-4">This action cannot be undone. All your data will be permanently deleted.</p>

                    <div className="mb-4">
                      <label className="block text-xs text-gray-300 mb-2">Confirm with your Gmail password</label>
                      <input
                        type="password"
                        value={deleteAccountPassword}
                        onChange={(e) => setDeleteAccountPassword(e.target.value)}
                        placeholder="Enter your Gmail password"
                        autoComplete="current-password"
                        className="w-full px-3 py-2 bg-slate-800/70 border border-red-500/30 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                      />
                    </div>

                    {deleteAccountError && (
                      <div className="mb-3 p-2 bg-red-500/20 border border-red-500/40 rounded text-xs text-red-200">
                        {deleteAccountError}
                      </div>
                    )}

                    {deleteAccountSuccess && (
                      <div className="mb-3 p-2 bg-green-500/20 border border-green-500/40 rounded text-xs text-green-200">
                        {deleteAccountSuccess}
                      </div>
                    )}

                    <button
                      onClick={handleDeleteAccount}
                      disabled={isDeletingAccount}
                      className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-800/60 text-white rounded-lg transition font-medium mb-2"
                    >
                      {isDeletingAccount ? 'Deleting Account...' : 'Delete Account'}
                    </button>
                    <button 
                      onClick={() => setSelectedDetail(null)}
                      className="w-full px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* SETTINGS - READINESS PILLARS */}
              {selectedDetail.item === 'Readiness Pillars' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-purple-500/30 rounded-lg p-4">
                    <div className="space-y-3">
                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-white">Financial Capital</span>
                          <span className="text-xs font-bold text-blue-300">100%</span>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">Transform volatility into secured wealth</p>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div className="bg-blue-500 h-2 rounded-full" style={{width: '100%'}}></div>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-white">Legal Resilience</span>
                          <span className="text-xs font-bold text-amber-300">75%</span>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">Treasury Guardian protecting your assets</p>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div className="bg-amber-500 h-2 rounded-full" style={{width: '75%'}}></div>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-white">Regulatory Compliance</span>
                          <span className="text-xs font-bold text-green-300">85%</span>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">Global Navigator ensuring eligibility</p>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div className="bg-green-500 h-2 rounded-full" style={{width: '85%'}}></div>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-white">Human Capital</span>
                          <span className="text-xs font-bold text-purple-300">70%</span>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">Prosperity Architect maximizing your time</p>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div className="bg-purple-500 h-2 rounded-full" style={{width: '70%'}}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SETTINGS - PROFILE CONFIGURATION */}
              {selectedDetail.tab === 'settings' && selectedDetail.item === 'Profile Configuration' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-purple-500/30 rounded-lg p-4">
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-gray-300 block mb-2">Full Name</label>
                        <input
                          type="text"
                          value={profileConfigFormData.fullName}
                          onChange={(e) => handleProfileConfigFieldChange('fullName', e.target.value)}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-300 block mb-2">Email</label>
                        <input
                          type="email"
                          value={profileConfigFormData.email}
                          onChange={(e) => handleProfileConfigFieldChange('email', e.target.value)}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                        />
                      </div>
                      <button
                        onClick={() => handleSaveProfileConfiguration('full')}
                        disabled={isSavingProfileConfig}
                        className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-60 text-white rounded-lg transition font-medium text-sm"
                      >
                         Save Changes
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SETTINGS - TARGET NET WORTH */}
              {selectedDetail.tab === 'settings' && selectedDetail.item === 'Target Net Worth' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-purple-500/30 rounded-lg p-4">
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-gray-300 block mb-2">Target Net Worth (UGX)</label>
                        <input
                          type="text"
                          value={profileConfigFormData.targetNetWorth}
                          onChange={(e) => handleProfileConfigFieldChange('targetNetWorth', normalizeTargetNetWorthValue(e.target.value))}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-300 block mb-2">Timeline (Years)</label>
                        <input
                          type="text"
                          value={profileConfigFormData.timelineYears}
                          onChange={(e) => handleProfileConfigFieldChange('timelineYears', e.target.value.replace(/[^\d]/g, ''))}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                        />
                      </div>
                      <button
                        onClick={() => handleSaveProfileConfiguration('target')}
                        disabled={isSavingProfileConfig}
                        className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-60 text-white rounded-lg transition font-medium text-sm"
                      >
                         Save Target
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SETTINGS - PREFERENCES */}
              {selectedDetail.item === 'Preferences' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-purple-500/30 rounded-lg p-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-2">
                        <span className="text-sm text-gray-300">Dark Mode</span>
                        <button className="px-3 py-1 bg-green-500/20 text-green-300 rounded text-xs font-medium"> Enabled</button>
                      </div>
                      <div className="flex items-center justify-between p-2">
                        <span className="text-sm text-gray-300">Notifications</span>
                        <button className="px-3 py-1 bg-green-500/20 text-green-300 rounded text-xs font-medium"> Enabled</button>
                      </div>
                      <div className="flex items-center justify-between p-2">
                        <span className="text-sm text-gray-300">Two-Factor Auth</span>
                        <button className="px-3 py-1 bg-green-500/20 text-green-300 rounded text-xs font-medium"> Enabled</button>
                      </div>
                      <button className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg transition font-medium text-sm mt-3">
                         Save Preferences
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              {/* SECURITY - NOTIFICATIONS */}
              {selectedDetail.tab === 'security' && selectedDetail.item === 'Notifications' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">Notifications</h3>
                  {unreadCount > 0 && (
                    <button
                      onClick={async () => {
                        const result = await markAllNotificationsAsRead(userProfile?.id);
                        if (result.success) {
                          setUnreadCount(0);
                          setNotifications(prev =>
                            prev.map(n => ({
                              ...n,
                              is_read: true,
                              read_at: new Date().toISOString()
                            }))
                          );
                        }
                      }}
                      className="text-purple-400 hover:text-purple-300 text-xs flex items-center gap-1 transition-colors"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>Mark all read</span>
                    </button>
                  )}
                </div>

                {/* Notifications List */}
                {loadingNotifications ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-3">
                      <Bell className="w-8 h-8 text-white/30" />
                    </div>
                    <p className="text-white/50 text-sm">No notifications yet</p>
                    <p className="text-white/30 text-xs mt-1">
                      You'll see investment updates here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        onClick={async () => {
                          // Mark as read
                          if (!notification.is_read) {
                            await markNotificationAsRead(notification.id);
                            setUnreadCount(prev => Math.max(0, prev - 1));
                            setNotifications(prev =>
                              prev.map(n =>
                                n.id === notification.id
                                  ? { ...n, is_read: true, read_at: new Date().toISOString() }
                                  : n
                              )
                            );
                          }
                          // Navigate if has action
                          if (notification.action_url) {
                            // Handle navigation
                            console.log('Navigate to:', notification.action_url);
                          }
                        }}
                        className={`
                          bg-slate-900/50 border rounded-lg p-4 cursor-pointer transition-all duration-200
                          hover:bg-slate-800/50 hover:border-purple-500/50
                          ${!notification.is_read 
                            ? 'border-purple-500/30 bg-purple-500/5' 
                            : 'border-slate-700/50'}
                        `}
                      >
                        <div className="flex items-start gap-3">
                          {/* Icon */}
                          <div
                            className={`
                              flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center
                              ${getNotificationColor(notification.priority)}
                              border
                            `}
                          >
                            <span className="text-lg">
                              {getNotificationIcon(notification.notification_type)}
                            </span>
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className={`
                                text-sm font-medium
                                ${!notification.is_read ? 'text-white' : 'text-white/70'}
                              `}>
                                {notification.title}
                              </h4>
                              {!notification.is_read && (
                                <div className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-1" />
                              )}
                            </div>

                            <p className="text-white/50 text-xs mt-1">
                              {notification.message}
                            </p>

                            <div className="flex items-center justify-between mt-2">
                              <span className="text-white/30 text-[10px]">
                                {formatTimeAgo(notification.created_at)}
                              </span>

                              {notification.action_label && (
                                <span className="text-purple-400 text-[10px] font-medium">
                                  {notification.action_label} 
                                </span>
                              )}
                            </div>

                            {/* Priority Badge */}
                            {notification.priority === 'urgent' && (
                              <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/20 border border-red-500/30 rounded-full">
                                <span className="text-red-400 text-[10px] font-semibold">
                                  URGENT
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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
              {/* SECURITY - ACCOUNT - ACCOUNT TAB */}
              {selectedDetail.tab === 'security' && selectedDetail.item === 'Account' && treasurySubTab === 'account' && (
                <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                  {/* Render ProfilePage Component */}
                  <div className="bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
                    <ProfilePage 
                      onClose={() => setSelectedDetail(null)}
                      onLogout={() => {
                        console.log(' User logged out');
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
                        {privacySettings.dataSharing ? ' Enabled' : ' Disabled'}
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
                        {privacySettings.marketingComms ? ' Enabled' : ' Disabled'}
                      </button>
                    </div>
                  </div>

                  {/* Save Button */}
                  <button
                    onClick={() => {
                      console.log(' Privacy settings saved:', privacySettings);
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
                        {isAnalyzingContract ? ' Analyzing...' : ' Analyze Contract (Secure)'}
                      </button>

                      {contractAnalysis && (
                        <div className="p-3 bg-indigo-500/20 border border-indigo-400/30 rounded text-xs space-y-2">
                          <p className="font-bold text-indigo-200"> Analysis Complete</p>
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
                          <span className="text-sm font-bold text-white"> Email Verified</span>
                          <span className="px-2 py-1 bg-green-500/20 text-green-300 rounded text-xs font-medium">Verified</span>
                        </div>
                        <p className="text-xs text-gray-400">Verified on {contractVerificationDates.emailVerified}</p>
                      </div>

                      {/* Phone Verified */}
                      <div className="bg-slate-900/50 border border-emerald-500/20 rounded p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-white"> Phone Verified</span>
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
                           Complete Identity Verification
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
                            {verificationStatus.twoFactorEnabled ? ' Enabled' : ' Disabled'}
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
                            {verificationStatus.biometricEnabled ? ' Active' : ' Inactive'}
                          </button>
                        </div>
                        <p className="text-xs text-gray-400">Fingerprint or face authentication</p>
                      </div>
                    </div>
                  </div>

                  {/* Save Button */}
                  <button
                    onClick={() => {
                      console.log(' Verification settings saved:', verificationStatus);
                      console.log(' Contract analysis:', contractAnalysis);
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
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium"> Verified</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Phone Verification</p>
                        <p className="text-xs text-gray-400 mt-1">Confirm your phone number</p>
                      </div>
                      <span className="px-3 py-1 bg-yellow-500/20 text-yellow-300 rounded-full text-xs font-medium"> Pending</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Two-Factor Authentication</p>
                        <p className="text-xs text-gray-400 mt-1">Extra security layer enabled</p>
                      </div>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium"> Enabled</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Biometric Lock</p>
                        <p className="text-xs text-gray-400 mt-1">Fingerprint or face authentication</p>
                      </div>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium"> Active</span>
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
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium"> APPROVED</span>
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
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium"> Valid</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Address Proof</p>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium"> Verified</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Business Registration</p>
                      <span className="px-3 py-1 bg-yellow-500/20 text-yellow-300 rounded-full text-xs font-medium"> Pending</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Tax Certificate</p>
                      <span className="px-3 py-1 bg-gray-500/20 text-gray-300 rounded-full text-xs font-medium"> Not Needed</span>
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
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium"> Passed</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Know Your Customer</p>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium"> Passed</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Risk Assessment</p>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium"> Low</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Compliance Status</p>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium"> Compliant</span>
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

              {/* ==========================================
                  MY PROFILE SECTION
              ========================================== */}
              {selectedDetail.tab === 'profile' && selectedDetail.item === 'Profile Info' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 border border-blue-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-4">
                      <User className="w-5 h-5 text-blue-300" />
                      <h3 className="text-sm font-bold text-white">My Profile</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Full Name</p>
                        <p className="text-white font-semibold">GANTA ELON</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Email</p>
                        <p className="text-white font-semibold break-all">gantaelon@gmail.com</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Member Since</p>
                        <p className="text-white font-semibold">January 1, 2026</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Account ID</p>
                        <p className="text-white font-semibold text-xs break-all">4c25b54b-d6e7-4fd2-b784-66021c41a5d4</p>
                      </div>
                      <button className="w-full px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg transition font-medium text-sm mt-4">
                         Edit Profile
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {selectedDetail.tab === 'profile' && selectedDetail.item === 'Financial Goals' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-amber-900/40 to-orange-900/40 border border-amber-500/30 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-white mb-4">Financial Goals</h3>
                    <div className="space-y-3">
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Primary Goal</p>
                        <p className="text-white font-semibold">Wealth Growth & Stability</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Income Level</p>
                        <p className="text-white font-semibold">Not provided</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Investment Horizon</p>
                        <p className="text-white font-semibold">Long-term (5+ years)</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectedDetail.tab === 'profile' && selectedDetail.item === 'Risk Profile' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-rose-900/40 to-red-900/40 border border-rose-500/30 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-white mb-4">Risk Tolerance</h3>
                    <div className="space-y-3">
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Risk Level</p>
                        <p className="text-white font-semibold">Moderate</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Portfolio Type</p>
                        <p className="text-white font-semibold">Balanced</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Approved by</p>
                        <p className="text-white font-semibold"> Approved</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectedDetail.tab === 'profile' && selectedDetail.item === 'Account Security' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-emerald-900/40 to-green-900/40 border border-emerald-500/30 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-white mb-4">Sign Out</h3>
                    <p className="text-xs text-gray-400 mb-4">Are you sure you want to sign out? You'll need to log back in to access your account.</p>
                    <button className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-medium">
                       Sign Out
                    </button>
                  </div>
                </div>
              )}

              {/* ==========================================
                  SECURITY - TREASURY GUARDIAN
              ========================================== */}
              {selectedDetail.tab === 'security' && selectedDetail.item === 'Treasury Guardian' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border border-indigo-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Shield className="w-5 h-5 text-indigo-300" />
                      <h3 className="text-sm font-bold text-white">Treasury Guardian</h3>
                    </div>
                    <p className="text-xs text-gray-400 mb-4">Contract text & Paste contract or terms & conditions here...</p>
                    <textarea
                      className="w-full px-3 py-2 bg-slate-800/50 border border-slate-600/50 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400 resize-none"
                      placeholder="Paste contract or terms & conditions here..."
                      rows="4"
                    />
                    <button className="w-full px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg transition font-medium text-sm mt-3">
                       Analyze Contract (Secure)
                    </button>
                  </div>
                </div>
              )}

              {selectedDetail.tab === 'security' && selectedDetail.item === 'Contract Analysis' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-indigo-900/40 to-blue-900/40 border border-indigo-500/30 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-white mb-4">Contract Analysis Results</h3>
                    <div className="space-y-2 text-xs text-gray-300">
                      <p> Contract verified</p>
                      <p> All terms reviewed</p>
                      <p> Risk assessment completed</p>
                      <p className="text-indigo-300 mt-3">Status: Ready for signing</p>
                    </div>
                  </div>
                </div>
              )}

              {/* ==========================================
                  READINESS - GLOBAL NAVIGATOR
              ========================================== */}
              {selectedDetail.tab === 'readiness' && selectedDetail.item === 'Global Navigator' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-teal-900/40 to-green-900/40 border border-teal-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <CheckCircle className="w-5 h-5 text-teal-300" />
                      <h3 className="text-sm font-bold text-white">Global Navigator</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Operating Mode</p>
                        <p className="text-white font-semibold">SE - Salaried Employee</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Country</p>
                        <p className="text-white font-semibold">Uganda</p>
                      </div>
                      <button className="w-full px-4 py-2 bg-gradient-to-r from-teal-600 to-green-600 hover:from-teal-700 hover:to-green-700 text-white rounded-lg transition font-medium text-sm mt-3">
                         Perform Regulatory Gap Analysis
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {selectedDetail.tab === 'readiness' && selectedDetail.item === 'Regulatory Gap' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-yellow-900/40 to-amber-900/40 border border-yellow-500/30 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-white mb-4">Regulatory Gap Analysis</h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-2 bg-slate-900/50 rounded">
                        <span className="text-sm text-gray-300">Compliance Status</span>
                        <span className="text-xs font-semibold text-yellow-300">Check required</span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-slate-900/50 rounded">
                        <span className="text-sm text-gray-300">Documentation</span>
                        <span className="text-xs font-semibold text-green-300"> Complete</span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-slate-900/50 rounded">
                        <span className="text-sm text-gray-300">Eligibility</span>
                        <span className="text-xs font-semibold text-green-300"> Verified</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ==========================================
                  GROWTH - PROSPERITY ARCHITECT
              ========================================== */}
              {selectedDetail.tab === 'growth' && selectedDetail.item === 'Prosperity Architect' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-amber-900/40 to-yellow-900/40 border border-amber-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Rocket className="w-5 h-5 text-amber-300" />
                      <h3 className="text-sm font-bold text-white">Prosperity Architect</h3>
                    </div>
                    <p className="text-xs text-gray-400 mb-4">Optimize your schedule for maximum value creation while maintaining spiritual and physical alignment.</p>
                    <button className="w-full px-4 py-2 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-700 hover:to-yellow-700 text-white rounded-lg transition font-medium text-sm">
                       Optimize Daily Schedule
                    </button>
                  </div>
                </div>
              )}

              {selectedDetail.tab === 'growth' && selectedDetail.item === 'Schedule Optimization' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-violet-900/40 to-purple-900/40 border border-violet-500/30 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-white mb-4">Schedule Optimization</h3>
                    <div className="space-y-3 text-sm">
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Peak Productivity</p>
                        <p className="text-white font-semibold">9 AM - 12 PM</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Focus Time</p>
                        <p className="text-white font-semibold">2 PM - 5 PM</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Recovery Time</p>
                        <p className="text-white font-semibold">After 5 PM</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ==========================================
                  SETTINGS - READINESS PILLARS
              ========================================== */}
              {selectedDetail.tab === 'settings' && selectedDetail.item === 'Readiness Pillars' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-purple-500/30 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-white mb-4"> Readiness Pillars</h3>
                    
                    <div className="space-y-3">
                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-white">Financial Capital</span>
                          <span className="text-xs font-bold text-blue-300">100%</span>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">Transform volatility into secured wealth</p>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div className="bg-blue-500 h-2 rounded-full" style={{width: '100%'}}></div>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-white">Legal Resilience</span>
                          <span className="text-xs font-bold text-amber-300">50%</span>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">Treasury Guardian protecting your assets</p>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div className="bg-amber-500 h-2 rounded-full" style={{width: '50%'}}></div>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-white">Regulatory Compliance</span>
                          <span className="text-xs font-bold text-green-300">50%</span>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">Global Navigator ensuring eligibility</p>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div className="bg-green-500 h-2 rounded-full" style={{width: '50%'}}></div>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 p-3 rounded">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-white">Human Capital</span>
                          <span className="text-xs font-bold text-purple-300">50%</span>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">Prosperity Architect maximizing your time</p>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div className="bg-purple-500 h-2 rounded-full" style={{width: '50%'}}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectedDetail.tab === 'settings' && selectedDetail.item === 'Profile Configuration' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-purple-500/30 rounded-lg p-4">
                    <h3 className="text-sm font-bold text-white mb-4">Profile Configuration</h3>
                    <div className="space-y-3">
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Target Net Worth (UGX)</p>
                        <input
                          type="text"
                          value={profileConfigFormData.targetNetWorth}
                          onChange={(e) => handleProfileConfigFieldChange('targetNetWorth', normalizeTargetNetWorthValue(e.target.value))}
                          className="mt-2 w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                        />
                        <p className="text-xs text-purple-300 mt-2">UGX {formattedTargetNetWorth}</p>
                        <button
                          onClick={() => handleSaveProfileConfiguration('target')}
                          disabled={isSavingProfileConfig}
                          className="mt-3 w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-60 text-white rounded-lg transition font-medium text-sm"
                        >
                          {isSavingProfileConfig ? 'Saving Target...' : 'Save Target Net Worth'}
                        </button>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded">
                        <p className="text-xs text-gray-400">Legal Disclaimer</p>
                        <p className="text-xs text-gray-300 mt-2">{profileConfigFormData.legalDisclaimer}</p>
                      </div>
                      {profileConfigError && (
                        <div className="p-2 bg-red-500/20 border border-red-500/40 rounded text-xs text-red-200">
                          {profileConfigError}
                        </div>
                      )}
                      {profileConfigSuccess && (
                        <div className="p-2 bg-green-500/20 border border-green-500/40 rounded text-xs text-green-200">
                          {profileConfigSuccess}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====== PROGRESS & ANALYTICS ROW ====== */}
      <div className="px-4 py-4 grid grid-cols-2 gap-4">
        {/* PROGRESS BUTTON */}
        <button
          onClick={() => toggleSection('progress')}
          className={`p-3 rounded-lg border flex items-center justify-between transition-all ${
            expandedSections.progress
              ? 'bg-blue-600/30 border-blue-500/60'
              : 'bg-blue-600/10 border-blue-500/30 hover:bg-blue-600/15'
          }`}
        >
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-blue-400" />
            <span className="font-semibold text-white text-sm">Progress</span>
          </div>
          <ChevronDown className={`w-4 h-4 text-blue-400 transition-transform ${expandedSections.progress ? 'rotate-180' : ''}`} />
        </button>

        {/* ANALYTICS BUTTON */}
        <button
          onClick={() => toggleSection('analytics')}
          className={`p-3 rounded-lg border flex items-center justify-between transition-all ${
            expandedSections.analytics
              ? 'bg-purple-600/30 border-purple-500/60'
              : 'bg-purple-600/10 border-purple-500/30 hover:bg-purple-600/15'
          }`}
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-purple-400" />
            <span className="font-semibold text-white text-sm">Analytics</span>
          </div>
          <ChevronDown className={`w-4 h-4 text-purple-400 transition-transform ${expandedSections.analytics ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* ====== PROGRESS MODAL ====== */}
      {expandedSections.progress && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end">
          <div className="w-full bg-gradient-to-br from-slate-900 to-slate-950 rounded-t-4xl p-5 max-h-[85vh] overflow-y-auto">
            {/* Header with Stage Title */}
            <div className="flex items-center justify-between mb-5">
              <h1 className="text-xl font-bold text-white">Our Inkal Stage</h1>
              <button
                onClick={() => toggleSection('progress')}
                className="w-9 h-9 flex items-center justify-center bg-red-500/20 hover:bg-red-500/30 rounded-full transition"
              >
                <X className="w-5 h-5 text-red-400" />
              </button>
            </div>

            {/* Main Stage Card - Compact */}
            <div className="bg-gradient-to-br from-red-900/60 to-red-900/40 border border-red-500/60 rounded-3xl p-5 mb-5 overflow-hidden relative">
              {/* Completion Badge */}
              <div className="absolute top-4 right-4 bg-red-500/30 backdrop-blur-sm px-3 py-1 rounded-full border border-red-500/50">
                <span className="text-xs font-bold text-red-300">Complete</span>
              </div>

              <div className="pr-16">
                {/* Stage Title */}
                <h2 className="text-2xl font-bold text-white mb-1">Stage 1</h2>
                <p className="text-red-100/80 text-sm font-medium mb-3">Establishing Velocity</p>
                
                {/* Progress Bar */}
                <div className="w-full bg-gray-700/50 rounded-full h-2.5 mb-4">
                  <div className="h-2.5 rounded-full bg-gradient-to-r from-red-500 to-red-400 transition-all" style={{ width: '0%' }}></div>
                </div>
                
                {/* Description */}
                <p className="text-gray-300 text-xs leading-relaxed">
                  Cash flow is minute, volatile, and impossible to track reliably. No savings, only daily survival.
                </p>
              </div>
            </div>

            {/* All Stages - Compact Buttons */}
            <div className="flex gap-2.5 mb-6 justify-between">
              {/* Stage 1 */}
              <button className="flex-1 py-3 px-2 rounded-2xl border bg-gradient-to-br from-red-600/50 to-red-700/40 border-red-500/60 text-center hover:from-red-600/70 hover:to-red-700/60 transition active:scale-95">
                <Zap className="w-5 h-5 mx-auto mb-1.5 text-red-400" />
                <div className="text-xs font-bold text-red-300">Stage 1</div>
              </button>

              {/* Stage 2 */}
              <button className="flex-1 py-3 px-2 rounded-2xl border bg-gradient-to-br from-yellow-600/40 to-yellow-700/30 border-yellow-500/40 text-center hover:from-yellow-600/60 hover:to-yellow-700/50 transition active:scale-95">
                <Building className="w-5 h-5 mx-auto mb-1.5 text-yellow-400" />
                <div className="text-xs font-bold text-yellow-300">Stage 2</div>
              </button>

              {/* Stage 3 */}
              <button className="flex-1 py-3 px-2 rounded-2xl border bg-gradient-to-br from-blue-600/40 to-blue-700/30 border-blue-500/40 text-center hover:from-blue-600/60 hover:to-blue-700/50 transition active:scale-95">
                <Crown className="w-5 h-5 mx-auto mb-1.5 text-blue-400" />
                <div className="text-xs font-bold text-blue-300">Stage 3</div>
              </button>

              {/* Stage 4 */}
              <button className="flex-1 py-3 px-2 rounded-2xl border bg-gradient-to-br from-green-600/40 to-green-700/30 border-green-500/40 text-center hover:from-green-600/60 hover:to-green-700/50 transition active:scale-95">
                <Rocket className="w-5 h-5 mx-auto mb-1.5 text-green-400" />
                <div className="text-xs font-bold text-green-300">Stage 4</div>
              </button>
            </div>

            {/* Next Milestone - Compact */}
            <div className="bg-gradient-to-br from-blue-900/50 to-blue-800/40 border border-blue-500/50 rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-bold text-blue-300 uppercase tracking-wide">Next Milestone</h3>
              
              <div>
                <p className="text-white font-semibold text-sm leading-snug mb-2">
                  Stabilize into steady income stream (UGX 20,000+)
                </p>
                <p className="text-gray-400 text-xs leading-relaxed">
                  Estimated time: Focus on positive cash flow first
                </p>
              </div>

              {/* Stage Focus Guidance */}
              <div className="pt-3 border-t border-blue-500/30">
                <p className="text-xs text-blue-100/70 leading-relaxed">
                  <span className="font-semibold text-blue-300">Stage 1 Focus:</span> Build consistent daily income and establish basic financial tracking.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====== ANALYTICS MODAL ====== */}
      {expandedSections.analytics && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end">
          <div className="w-full bg-gradient-to-br from-slate-900 to-slate-950 rounded-t-3xl p-6 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <BarChart3 className="w-6 h-6 text-purple-400" />
                <h2 className="text-2xl font-bold text-white">Analytics</h2>
              </div>
              <button
                onClick={() => toggleSection('analytics')}
                className="w-10 h-10 flex items-center justify-center bg-red-500/20 hover:bg-red-500/30 rounded-full transition"
              >
                <X className="w-6 h-6 text-red-400" />
              </button>
            </div>

            {/* Period Tabs */}
            <div className="flex gap-2 mb-6 pb-4 border-b border-slate-700/50">
              {['weekly', 'monthly', 'yearly'].map((period) => (
                <button
                  key={period}
                  onClick={async () => {
                    setExpandedPeriods({...expandedPeriods, [period]: !expandedPeriods[period]});
                    // Pre-load data for all metrics in this period
                    if (!expandedPeriods[period]) {
                      ['income', 'expense', 'netProfit', 'transactions', 'savingsRate', 'netWorth', 'roi'].forEach(metric => {
                        handleMetricClick(metric);
                      });
                    }
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                    expandedPeriods[period]
                      ? 'bg-purple-500/30 text-purple-300 border border-purple-400/50'
                      : 'bg-slate-700/30 text-gray-400 hover:text-gray-300'
                  }`}
                >
                  {period.charAt(0).toUpperCase() + period.slice(1)}
                </button>
              ))}
            </div>

            {/* Pre-load Monthly Data on Modal Open */}
            {expandedSections.analytics && Object.keys(metricPeriodData).some(key => !metricPeriodData[key].monthly) && (
              <div className="absolute inset-0 opacity-0 pointer-events-none">
                {['income', 'expense', 'netProfit', 'transactions', 'savingsRate', 'netWorth', 'roi'].map(metric => (
                  <div key={`preload-${metric}`} onClick={() => handleMetricClick(metric)} className="hidden" />
                ))}
              </div>
            )}

            {/* Metrics Grid - 3x2 Layout */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {/* Income */}
              <button
                onClick={() => handleMetricClick('income')}
                className="bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl p-4 text-center hover:shadow-lg transition active:scale-95"
                title="Click to load all periods"
              >
                <div className="text-white font-bold text-lg">
                  {metricPeriodData.income.monthly 
                    ? formatCurrency(metricPeriodData.income.monthly)
                    : formatCurrency(velocityMetrics?.income30Days || 0)}
                </div>
                <div className="text-white/80 text-xs font-semibold mt-1">Income</div>
              </button>

              {/* Expense */}
              <button
                onClick={() => handleMetricClick('expense')}
                className="bg-gradient-to-br from-red-500 to-orange-600 rounded-2xl p-4 text-center hover:shadow-lg transition active:scale-95"
                title="Click to load all periods"
              >
                <div className="text-white font-bold text-lg">
                  {metricPeriodData.expense.monthly 
                    ? formatCurrency(metricPeriodData.expense.monthly)
                    : formatCurrency(velocityMetrics?.expenses30Days || 0)}
                </div>
                <div className="text-white/80 text-xs font-semibold mt-1">Expense</div>
              </button>

              {/* Net Profit */}
              <button
                onClick={() => handleMetricClick('netProfit')}
                className="bg-gradient-to-br from-pink-500 to-red-500 rounded-2xl p-4 text-center hover:shadow-lg transition active:scale-95"
                title="Click to load all periods"
              >
                <div className="text-white font-bold text-lg">
                  {metricPeriodData.netProfit.monthly 
                    ? formatCurrency(metricPeriodData.netProfit.monthly)
                    : formatCurrency(velocityMetrics?.velocity30Days || 0)}
                </div>
                <div className="text-white/80 text-xs font-semibold mt-1">Net Profit</div>
              </button>

              {/* Transactions */}
              <button
                onClick={() => handleMetricClick('transactions')}
                className="bg-gradient-to-br from-blue-500 to-cyan-600 rounded-2xl p-4 text-center hover:shadow-lg transition active:scale-95"
                title="Click to load all periods"
              >
                <div className="text-white font-bold text-lg">
                  {metricPeriodData.transactions.monthly || velocityMetrics?.transactionCount || 0}
                </div>
                <div className="text-white/80 text-xs font-semibold mt-1">Transactions</div>
              </button>

              {/* Savings Rate */}
              <button
                onClick={() => handleMetricClick('savingsRate')}
                className="bg-gradient-to-br from-purple-500 to-pink-600 rounded-2xl p-4 text-center hover:shadow-lg transition active:scale-95"
                title="Click to load all periods"
              >
                <div className="text-white font-bold text-lg">
                  {metricPeriodData.savingsRate.monthly 
                    ? (typeof metricPeriodData.savingsRate.monthly === 'string' 
                      ? metricPeriodData.savingsRate.monthly 
                      : `${(metricPeriodData.savingsRate.monthly).toFixed(1)}%`)
                    : `${velocityMetrics?.savingsRate || 0}%`}
                </div>
                <div className="text-white/80 text-xs font-semibold mt-1">Savings Rate</div>
              </button>

              {/* Net Worth */}
              <button
                onClick={() => handleMetricClick('netWorth')}
                className="bg-gradient-to-br from-yellow-500 to-orange-600 rounded-2xl p-4 text-center hover:shadow-lg transition active:scale-95"
                title="Click to load all periods"
              >
                <div className="text-white font-bold text-lg">
                  {metricPeriodData.netWorth.monthly 
                    ? formatCurrency(metricPeriodData.netWorth.monthly)
                    : formatCurrency(velocityMetrics?.netWorth || 0)}
                </div>
                <div className="text-white/80 text-xs font-semibold mt-1">Net Worth</div>
              </button>
            </div>

            {/* ROI Circular Badge */}
            <div className="flex justify-center mb-6">
              <button
                onClick={() => handleMetricClick('roi')}
                className="w-24 h-24 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex flex-col items-center justify-center hover:shadow-2xl transition active:scale-95 text-white font-bold"
                title="Click to load all periods"
              >
                <span className="text-xs font-semibold">ROI</span>
                <span className="text-3xl font-bold">
                  {metricPeriodData.roi.monthly 
                    ? (typeof metricPeriodData.roi.monthly === 'string'
                      ? metricPeriodData.roi.monthly.replace('%', '')
                      : `${(metricPeriodData.roi.monthly).toFixed(1)}`)
                    : velocityMetrics?.roi || 0}%
                </span>
              </button>
            </div>

            {/* Period Data Detail (if clicked) */}
            {(expandedPeriods.weekly || expandedPeriods.monthly || expandedPeriods.yearly) && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4 space-y-3">
                {expandedPeriods.weekly && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-purple-400">WEEKLY DATA</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-700/30 p-2 rounded">Income: {metricPeriodData.income.weekly || 0}</div>
                      <div className="bg-slate-700/30 p-2 rounded">Expense: {metricPeriodData.expense.weekly || 0}</div>
                    </div>
                  </div>
                )}
                {expandedPeriods.monthly && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-purple-400">MONTHLY DATA</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-700/30 p-2 rounded">Income: {metricPeriodData.income.monthly || 0}</div>
                      <div className="bg-slate-700/30 p-2 rounded">Expense: {metricPeriodData.expense.monthly || 0}</div>
                      <div className="bg-slate-700/30 p-2 rounded">Profit: {metricPeriodData.netProfit.monthly || 0}</div>
                      <div className="bg-slate-700/30 p-2 rounded">Savings: {metricPeriodData.savingsRate.monthly || 0}%</div>
                    </div>
                  </div>
                )}
                {expandedPeriods.yearly && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-purple-400">YEARLY DATA</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-700/30 p-2 rounded">Income: {metricPeriodData.income.yearly || 0}</div>
                      <div className="bg-slate-700/30 p-2 rounded">Expense: {metricPeriodData.expense.yearly || 0}</div>
                      <div className="bg-slate-700/30 p-2 rounded">Net Profit: {metricPeriodData.netProfit.yearly || 0}</div>
                      <div className="bg-slate-700/30 p-2 rounded">Net Worth: {metricPeriodData.netWorth.yearly || 0}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====== RECENT TRANSACTIONS SECTION - COLLAPSIBLE ====== */}
      <div className="px-4 py-4">
        <button
          onClick={() => toggleSection('recentTransactions')}
          className={`w-full p-3 rounded-lg border flex items-center justify-between transition-all ${
            expandedSections.recentTransactions
              ? 'bg-cyan-600/20 border-cyan-500/50'
              : 'bg-cyan-600/10 border-cyan-500/30 hover:bg-cyan-600/15'
          }`}
        >
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            <span className="font-semibold text-white">Recent Transactions</span>
            {transactions.length > 0 && <span className="text-xs bg-cyan-500/30 text-cyan-300 px-2 py-1 rounded">{transactions.length}</span>}
          </div>
          <ChevronDown className={`w-5 h-5 text-cyan-400 transition-transform ${expandedSections.recentTransactions ? 'rotate-180' : ''}`} />
        </button>

        {/* Expanded Content */}
        {expandedSections.recentTransactions && (
          <div className="mt-3">
            {transactions.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {transactions.slice(0, 5).map((transaction) => (
                  <div key={transaction.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-slate-700/30 hover:border-slate-600/50 transition">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        transaction.transaction_type === 'income' 
                          ? 'bg-green-500/20 text-green-400' 
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {transaction.transaction_type === 'income' ? <TrendingUp className="w-5 h-5" /> : <DollarSign className="w-5 h-5" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white truncate max-w-32">
                          {transaction.description || 'Transaction'}
                        </p>
                        <p className="text-xs text-gray-400">
                          {new Date(transaction.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${
                        transaction.transaction_type === 'income' ? 'text-green-300' : 'text-red-300'
                      }`}>
                        {transaction.transaction_type === 'income' ? '+' : '-'}{formatCurrency(Math.abs(transaction.amount || 0))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <Activity className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">No transactions yet</p>
                <button 
                  onClick={() => setShowRecordTypeModal(true)}
                  className="mt-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition"
                >
                  Record One
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ====== WALLET ACCOUNTS SECTION - COLLAPSIBLE ====== */}
      <div className="px-4 py-4">
        <button
          onClick={() => toggleSection('walletAccounts')}
          className={`w-full p-3 rounded-lg border flex items-center justify-between transition-all ${
            expandedSections.walletAccounts
              ? 'bg-purple-600/20 border-purple-500/50'
              : 'bg-purple-600/10 border-purple-500/30 hover:bg-purple-600/15'
          }`}
        >
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-purple-400" />
            <span className="font-semibold text-white">Wallet Accounts</span>
          </div>
          <ChevronDown className={`w-5 h-5 text-purple-400 transition-transform ${expandedSections.walletAccounts ? 'rotate-180' : ''}`} />
        </button>

        {/* Expanded Content - Beautiful Card Layout */}
        {expandedSections.walletAccounts && (
          <div className="mt-4">
            <div className="grid grid-cols-2 gap-4">
              {walletTabs.map((tab, idx) => {
                const tabKey = getWalletTabKey(tab.name);
                const account = walletAccounts[tabKey];
                
                if (!account?.exists) return null;

                // Wallet colors
                const walletColors = {
                  personal: 'from-purple-600 to-purple-500',
                  business: 'from-blue-600 to-blue-500',
                  trust: 'from-indigo-600 to-indigo-500',
                  agent: 'from-pink-600 to-pink-500',
                  ican: 'from-yellow-600 to-yellow-500'
                };

                const selectedColor = walletColors[tabKey] || walletColors.personal;
                
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setActiveWalletTab(tabKey);
                      setShowWalletAccounts(true);
                    }}
                    className={`p-6 rounded-3xl bg-gradient-to-br ${selectedColor} border border-white/20 hover:border-white/40 transition-all hover:shadow-xl hover:scale-105 flex flex-col items-center text-center`}
                  >
                    {/* Icon Circle */}
                    <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-3 border border-white/30">
                      <tab.icon className="w-6 h-6 text-white" />
                    </div>

                    {/* Wallet Name */}
                    <p className="text-white font-bold text-sm capitalize mb-2">{tab.name}</p>

                    {/* Amount */}
                    <p className="text-white font-bold text-lg mb-1">
                      {account?.loading ? '...' : formatWalletBalanceByTab(tabKey, account?.balance || 0)}
                    </p>

                    {/* Currency */}
                    <p className="text-white/80 text-xs font-medium">
                      {tabKey === 'ican' ? 'ICAN' : account?.currency || 'UGX'}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Recent Transactions Section - Keep for backup */}
      {transactions.length > 0 && false && <RecentTransactionsCollapsible transactions={transactions} formatCurrency={formatCurrency} />}

      {/* ====== UPDATES SECTION - HORIZONTAL SCROLLING ====== */}
      <div className="px-4 py-6">
        {/* Section Header */}
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Eye className="w-6 h-6 text-indigo-400" />
          Updates
        </h2>

        {loadingStatuses ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500"></div>
          </div>
        ) : userStatuses.length > 0 ? (
          <>
            {/* Horizontal Scrolling Updates */}
            <div className="overflow-x-auto pb-4 -mr-4 pr-4 scrollbar-hide">
              <div className="flex gap-3 min-w-min">
                {userStatuses.map(status => (
                  <div
                    key={status.id}
                    onClick={() => setShowStatusPage(true)}
                    className="group relative rounded-2xl overflow-hidden cursor-pointer w-56 h-32 bg-black flex-shrink-0 hover:scale-105 transition-transform duration-300 border border-white/10"
                  >
                    {/* Update Content */}
                    {status.media_type === 'image' ? (
                      <img
                        src={status.media_url}
                        alt="Update"
                        className="w-full h-full object-cover group-hover:brightness-75 transition-all"
                      />
                    ) : status.media_type === 'video' ? (
                      <>
                        <video
                          src={status.media_url}
                          className="w-full h-full object-cover group-hover:brightness-75 transition-all"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <Play className="w-6 h-6 text-white/80" />
                        </div>
                      </>
                    ) : (
                      <div
                        style={{ backgroundColor: status.background_color || '#6366f1' }}
                        className="w-full h-full flex items-center justify-center p-4"
                      >
                        <p className="text-white text-center text-sm font-medium line-clamp-4">
                          {status.caption}
                        </p>
                      </div>
                    )}

                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                      <Eye className="w-5 h-5 text-white" />
                    </div>

                    {/* Duration Badge */}
                    <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-1 rounded-full text-xs text-white font-medium">
                      {Math.ceil((new Date(status.expires_at) - new Date()) / (1000 * 60 * 60))}h
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* View All Updates Button */}
            <button
              onClick={() => setShowStatusPage(true)}
              className="w-full bg-gradient-to-r from-indigo-600/30 to-indigo-700/20 border-2 border-indigo-500/50 hover:border-indigo-400/80 rounded-2xl py-3 flex items-center justify-center gap-2 transition-all hover:from-indigo-600/50 hover:to-indigo-700/40 group mt-4"
            >
              <span className="text-sm font-medium text-indigo-300 group-hover:text-indigo-200">View All Updates ({userStatuses.length})</span>
              <ChevronRight className="w-4 h-4 text-indigo-400" />
            </button>
          </>
        ) : (
          /* No Updates State */
          <button
            onClick={() => setShowStatusUploader(true)}
            className="w-full bg-gradient-to-br from-indigo-600/30 to-indigo-700/20 border-2 border-indigo-500/50 hover:border-indigo-400/80 rounded-2xl p-6 flex flex-col items-center gap-4 transition-all hover:from-indigo-600/50 hover:to-indigo-700/40 group"
          >
            <div className="w-16 h-16 bg-indigo-500/30 rounded-full flex items-center justify-center group-hover:bg-indigo-500/50 transition">
              <Plus className="w-8 h-8 text-indigo-400 group-hover:text-indigo-300 transition" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-white group-hover:text-indigo-100 transition">Create Your First Status</h3>
              <p className="text-sm text-gray-400 group-hover:text-gray-300 transition mt-1">Share a moment with your community</p>
            </div>
            <div className="flex items-center gap-2 text-indigo-400 group-hover:text-indigo-300 transition">
              <span className="text-sm font-medium">Start Now</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        )}
      </div>

      {/* ====== COMMENTED OUT - ALL SECTIONS BELOW REMOVED FOR CLEANUP ====== */}

      {/* ====== FIXED BOTTOM NAVIGATION - ALWAYS ON TOP ====== */}
      <div className={`fixed bottom-0 left-0 right-0 z-50 transition-all ${
        showPitchinPanel 
          ? 'bg-transparent' 
          : 'bg-transparent'
      }`}>
        <div className={isWebDashboard
          ? 'flex items-center justify-between py-3 px-4 sm:px-6 max-w-3xl mx-auto mb-4 rounded-2xl border border-green-400/30 bg-slate-900/75 backdrop-blur-xl shadow-[0_12px_35px_rgba(36,18,58,0.45)]'
          : 'flex items-center justify-between px-2 py-3'
        }>
          {/* Home */}
          <button
            onClick={() => { 
              setShowProfilePanel(false); 
              setShowPitchinPanel(false);
              setShowWalletPanel(false);
              setShowTrustPanel(false);
              setShowCmmsPanel(false);
              setActiveBottomTab('home'); 
            }}
            className={`flex-1 flex flex-col items-center gap-1 py-2 px-2 transition ${
              showPitchinPanel ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <Home className={`w-6 h-6 ${showPitchinPanel ? 'text-gray-400/60' : 'text-green-400'}`} />
            <span className={`text-xs font-medium ${showPitchinPanel ? 'text-gray-400/60' : 'text-gray-300'}`}>Home</span>
          </button>

          {/* Pitchin */}
          <button
            onClick={() => { setShowPitchinPanel(!showPitchinPanel); setActiveBottomTab('pitchin'); }}
            className={`flex-1 flex flex-col items-center gap-1 py-2 px-2 transition ${
              showPitchinPanel ? 'opacity-80' : 'opacity-100'
            }`}
          >
            <Briefcase className={`w-6 h-6 ${showPitchinPanel ? 'text-green-400/80' : 'text-green-400'}`} />
            <span className={`text-xs font-medium ${showPitchinPanel ? 'text-green-300/80' : 'text-gray-300'}`}>Pitchin</span>
          </button>

          {/* Wallet */}
          <button
            onClick={() => { setShowWalletPanel(!showWalletPanel); setActiveBottomTab('wallet'); }}
            className={`flex-1 flex flex-col items-center gap-1 py-2 px-2 transition ${
              showPitchinPanel ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <Wallet className={`w-6 h-6 ${showPitchinPanel ? 'text-gray-400/60' : 'text-green-400'}`} />
            <span className={`text-xs font-medium ${showPitchinPanel ? 'text-gray-400/60' : 'text-gray-300'}`}>Wallet</span>
          </button>

          {/* Trust */}
          <button
            onClick={() => { setShowTrustPanel(!showTrustPanel); setActiveBottomTab('trust'); }}
            className={`flex-1 flex flex-col items-center gap-1 py-2 px-2 transition ${
              showPitchinPanel ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <Lock className={`w-6 h-6 ${showPitchinPanel ? 'text-gray-400/60' : 'text-green-400'}`} />
            <span className={`text-xs font-medium ${showPitchinPanel ? 'text-gray-400/60' : 'text-gray-300'}`}>Trust</span>
          </button>

          {/* CMMS */}
          <button
            onClick={() => { setShowCmmsPanel(!showCmmsPanel); setActiveBottomTab('cmms'); }}
            className={`flex-1 flex flex-col items-center gap-1 py-2 px-2 transition ${
              showPitchinPanel ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <Settings className={`w-6 h-6 ${showPitchinPanel ? 'text-gray-400/60' : 'text-green-400'}`} />
            <span className={`text-xs font-medium ${showPitchinPanel ? 'text-gray-400/60' : 'text-gray-300'}`}>CMMS</span>
          </button>
        </div>
      </div>

      {/* Pitchin Panel - Full Screen Video */}
      {showPitchinPanel && (
        <div
          className="fixed inset-x-0 top-0 z-30 bg-black overflow-hidden"
          style={{ bottom: overlayPanelBottomInset }}
        >
          <Pitchin />
        </div>
      )}

      {/* Trust Panel - Full Web Trust System UI */}
      {showTrustPanel && (
        <div
          className="fixed inset-x-0 top-0 z-30 bg-gradient-to-b from-slate-950 to-black overflow-y-auto"
          style={{ bottom: overlayPanelBottomInset }}
        >
          <div className="pt-2 px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <TrustSystem currentUser={authUser || userProfile} />
          </div>
        </div>
      )}

      {/* Wallet Panel - Full Web Wallet UI */}
      {showWalletPanel && (
        <div
          className="fixed inset-x-0 top-0 z-30 bg-gradient-to-b from-slate-950 to-black overflow-y-auto"
          style={{ bottom: overlayPanelBottomInset }}
        >
          <div className="pt-2 px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <ICANWallet />
          </div>
        </div>
      )}

      {/* CMMS Panel - Full Web CMMS UI */}
      {showCmmsPanel && (
        <div
          className="fixed inset-x-0 top-0 z-30 bg-gradient-to-b from-slate-950 to-black overflow-y-auto"
          style={{ bottom: overlayPanelBottomInset }}
        >
          <div className="pt-2 px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <CMMSModule user={userProfile} />
          </div>
        </div>
      )}

      {/* Status Feed Page */}
      {showStatusPage && (
        <div className="fixed inset-0 z-[130]" onClick={() => setShowStatusPage(false)}>
          <div className="fixed inset-0 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <StatusPage onGoBack={() => setShowStatusPage(false)} />
          </div>
        </div>
      )}

      {/* Search Modal with AI Copilot */}
      <SearchModal
        isOpen={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        user={authUser}
        transactions={transactions}
        wallets={walletAccounts}
        onNavigate={(featureId) => {
          setShowSearchModal(false);
          if (featureId === 'wallets' || featureId === 'ican-coin') setShowWalletPanel(true);
          else if (featureId === 'pitching') setShowPitchinPanel(true);
          else if (featureId === 'trust') setShowTrustPanel(true);
          else if (featureId === 'cmms') setShowCmmsPanel(true);
          else if (featureId === 'profile') setShowProfilePanel(true);
          else if (featureId === 'reports') setShowReportingSystem(true);
          // 'transactions' and 'ai-copilot' stay on home screen
        }}
      />

      {/* Record Type Selection Modal */}
      {showRecordTypeModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-purple-500/30 rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-600 to-purple-500 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Record Transaction</h2>
              <button
                onClick={() => setShowRecordTypeModal(false)}
                className="text-white/80 hover:text-white transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <p className="text-gray-300 text-center mb-6">Select transaction type to proceed</p>

              {/* Business Option */}
              <button
                onClick={() => {
                  setTransactionType('business');
                  setShowRecordTypeModal(false);
                  setShowTransactionEntry(true);
                }}
                className="w-full bg-gradient-to-br from-blue-600/20 to-blue-700/20 border-2 border-blue-500/50 hover:border-blue-400/80 rounded-xl p-4 flex flex-col items-center gap-3 transition-all hover:bg-blue-600/30 group"
              >
                <Briefcase className="w-8 h-8 text-blue-400 group-hover:text-blue-300 transition" />
                <div className="text-center">
                  <h3 className="text-lg font-bold text-white group-hover:text-blue-100 transition">Business</h3>
                  <p className="text-xs text-gray-400">Company transactions & operations</p>
                </div>
              </button>

              {/* Personal Option */}
              <button
                onClick={() => {
                  setTransactionType('personal');
                  setShowRecordTypeModal(false);
                  setShowTransactionEntry(true);
                }}
                className="w-full bg-gradient-to-br from-green-600/20 to-green-700/20 border-2 border-green-500/50 hover:border-green-400/80 rounded-xl p-4 flex flex-col items-center gap-3 transition-all hover:bg-green-600/30 group"
              >
                <User className="w-8 h-8 text-green-400 group-hover:text-green-300 transition" />
                <div className="text-center">
                  <h3 className="text-lg font-bold text-white group-hover:text-green-100 transition">Personal</h3>
                  <p className="text-xs text-gray-400">Personal income & expenses</p>
                </div>
              </button>

              {/* Info Footer */}
              <div className="mt-6 pt-4 border-t border-purple-500/20">
                <p className="text-xs text-gray-500 text-center">
                   Tip: Transactions are recorded with AI-powered categorization for precise accounting
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tithe Calculator Modal ─────────────────────────────────── */}
      {showTithingCalculator && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center p-3 overflow-y-auto">
          <div className="bg-gradient-to-br from-yellow-50 to-amber-50 rounded-2xl w-full max-w-2xl shadow-2xl my-4">
            {/* Header */}
            <div className="bg-gradient-to-r from-yellow-600 to-amber-500 rounded-t-2xl px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">🙏 Tithe Calculator</h2>
                <p className="text-yellow-100 text-xs mt-0.5">Steward faithfully — Uganda giving tracker</p>
              </div>
              <button onClick={() => setShowTithingCalculator(false)} className="text-white/70 hover:text-white p-1"><X className="w-6 h-6" /></button>
            </div>

            <div className="p-4 space-y-4">
              {/* Tab switcher */}
              <div className="flex gap-2 bg-amber-100 rounded-xl p-1">
                {['quick', 'business', 'personal'].map(tab => (
                  <button key={tab} onClick={() => setSelectedTithingTab(tab)}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold capitalize transition ${selectedTithingTab === tab ? 'bg-white text-amber-700 shadow' : 'text-amber-600 hover:text-amber-800'}`}>
                    {tab === 'quick' ? '⚡ Quick' : tab === 'business' ? '💼 Business' : '👤 Personal'}
                  </button>
                ))}
              </div>

              {selectedTithingTab === 'quick' && (
                <div className="space-y-3">
                  <div className="bg-white rounded-xl p-4 shadow-sm">
                    <p className="text-xs text-gray-500 mb-1">Based on your last 30 days income</p>
                    <div className="text-3xl font-bold text-amber-600">UGX {(tithingMetrics.combinedTithe || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                    <p className="text-xs text-gray-500 mt-1">Combined tithe due this month</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                      <div className="text-sm text-gray-500">Personal Tithe</div>
                      <div className="text-xl font-bold text-green-600">UGX {(tithingMetrics.personalTithe || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                      <div className="text-xs text-gray-400">{personalTithingRate}% of income</div>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                      <div className="text-sm text-gray-500">Business Tithe</div>
                      <div className="text-xl font-bold text-blue-600">UGX {(tithingMetrics.businessTithe || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                      <div className="text-xs text-gray-400">{businessTithingRate}% of profit</div>
                    </div>
                  </div>
                  <div className="bg-amber-100 rounded-xl p-3 text-xs text-amber-800 border border-amber-200">
                    📖 <strong>Malachi 3:10</strong> — "Bring the whole tithe into the storehouse... and see if I will not open the floodgates of heaven."
                  </div>
                </div>
              )}

              {selectedTithingTab === 'business' && (
                <div className="space-y-3">
                  <div className="bg-white rounded-xl p-4 shadow-sm">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Business Tithe Rate (%)</label>
                    <input type="range" min="5" max="20" value={businessTithingRate}
                      onChange={e => setBusinessTithingRate(Number(e.target.value))}
                      className="w-full accent-amber-500" />
                    <div className="flex justify-between text-xs text-gray-400 mt-1"><span>5%</span><span className="font-bold text-amber-600">{businessTithingRate}%</span><span>20%</span></div>
                  </div>
                  <div className="bg-white rounded-xl p-4 shadow-sm">
                    <div className="flex justify-between text-sm mb-2"><span className="text-gray-500">Business Profit</span><span className="font-semibold">UGX {(tithingMetrics.businessProfit || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-500">Tithe Due</span><span className="font-bold text-amber-600 text-lg">UGX {(tithingMetrics.businessTithe || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</span></div>
                  </div>
                </div>
              )}

              {selectedTithingTab === 'personal' && (
                <div className="space-y-3">
                  <div className="bg-white rounded-xl p-4 shadow-sm">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Personal Tithe Rate (%)</label>
                    <input type="range" min="5" max="20" value={personalTithingRate}
                      onChange={e => setPersonalTithingRate(Number(e.target.value))}
                      className="w-full accent-amber-500" />
                    <div className="flex justify-between text-xs text-gray-400 mt-1"><span>5%</span><span className="font-bold text-amber-600">{personalTithingRate}%</span><span>20%</span></div>
                  </div>
                  <div className="bg-white rounded-xl p-4 shadow-sm">
                    <div className="flex justify-between text-sm mb-2"><span className="text-gray-500">Personal Income (30d)</span><span className="font-semibold">UGX {(tithingMetrics.personalIncome || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-500">Tithe Due</span><span className="font-bold text-green-600 text-lg">UGX {(tithingMetrics.personalTithe || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</span></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Reports Modal ──────────────────────────────────────────────── */}
      {showReportingSystem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center p-3 overflow-y-auto">
          <div className="bg-gradient-to-br from-slate-900 to-indigo-950 rounded-2xl w-full max-w-3xl shadow-2xl my-4 border border-purple-500/30">
            {/* Header */}
            <div className="bg-gradient-to-r from-rose-700 to-pink-600 rounded-t-2xl px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">📊 Financial Reports</h2>
                <p className="text-rose-100 text-xs mt-0.5">AI-powered reports — Uganda compliant</p>
              </div>
              <button onClick={() => { setShowReportingSystem(false); setReportFilteredMetrics(null); setGeneratedReportData(null); }} className="text-white/70 hover:text-white p-1"><X className="w-6 h-6" /></button>
            </div>

            <div className="p-4 space-y-4">
              {/* Report type dropdown */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Report Type</label>
                <select
                  value={selectedReportType}
                  onChange={e => setSelectedReportType(e.target.value)}
                  className="w-full bg-white text-gray-900 border-2 border-purple-400 rounded-xl px-4 py-3 text-sm font-semibold focus:ring-2 focus:ring-purple-500 focus:border-purple-500 cursor-pointer shadow-sm"
                >
                  {Object.entries(reportTypes).map(([key, cfg]) => (
                    <option key={key} value={key}>
                      {cfg.icon || '📄'} {cfg.name.trim()}
                    </option>
                  ))}
                </select>
              </div>

              {/* ── DATE FILTER ── */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">📅 Period</p>
                <div className="grid grid-cols-4 gap-2">
                  {[{ id:'today', label:'Today' }, { id:'week', label:'Week' }, { id:'month', label:'Month' }, { id:'year', label:'Year' }].map(f => (
                    <button
                      key={f.id}
                      onClick={() => {
                        setReportDateFilter(f.id);
                        setReportFilteredMetrics(null);
                        fetchReportMetrics(f.id, reportCustomStart, reportCustomEnd);
                      }}
                      className={`py-2 rounded-lg text-xs font-bold transition ${
                        reportDateFilter === f.id
                          ? 'bg-purple-600 text-white shadow'
                          : 'bg-white/10 text-gray-300 hover:bg-white/20'
                      }`}
                    >{f.label}</button>
                  ))}
                </div>
                {/* Custom range */}
                <div>
                  <button
                    onClick={() => {
                      setReportDateFilter('custom');
                      setReportFilteredMetrics(null);
                    }}
                    className={`text-xs font-semibold transition ${
                      reportDateFilter === 'custom' ? 'text-purple-300' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >🗓️ Custom range {reportDateFilter === 'custom' ? '▲' : '▼'}</button>
                  {reportDateFilter === 'custom' && (
                    <div className="flex gap-2 mt-2">
                      <input type="date" value={reportCustomStart} onChange={e => setReportCustomStart(e.target.value)}
                        className="flex-1 bg-white/10 text-white text-xs rounded-lg px-2 py-1.5 border border-white/20 focus:outline-none focus:border-purple-400" />
                      <span className="text-gray-400 self-center text-xs">to</span>
                      <input type="date" value={reportCustomEnd} onChange={e => setReportCustomEnd(e.target.value)}
                        className="flex-1 bg-white/10 text-white text-xs rounded-lg px-2 py-1.5 border border-white/20 focus:outline-none focus:border-purple-400" />
                      <button
                        onClick={() => fetchReportMetrics('custom', reportCustomStart, reportCustomEnd)}
                        className="px-3 py-1.5 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-500 transition"
                      >Go</button>
                    </div>
                  )}
                </div>
                {/* Live metrics for the period */}
                {isLoadingReportMetrics && (
                  <div className="flex items-center gap-2 text-xs text-purple-300">
                    <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Loading period data...
                  </div>
                )}
                {reportFilteredMetrics && !isLoadingReportMetrics && (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div className="bg-green-900/30 border border-green-500/30 rounded-lg p-2 text-center">
                      <p className="text-green-400 font-bold text-xs">{reportFilteredMetrics.income.toLocaleString(undefined, {maximumFractionDigits:0})}</p>
                      <p className="text-gray-500 text-xs">Income</p>
                    </div>
                    <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-2 text-center">
                      <p className="text-red-400 font-bold text-xs">{reportFilteredMetrics.expenses.toLocaleString(undefined, {maximumFractionDigits:0})}</p>
                      <p className="text-gray-500 text-xs">Expenses</p>
                    </div>
                    <div className={`border rounded-lg p-2 text-center ${
                      reportFilteredMetrics.netProfit >= 0
                        ? 'bg-blue-900/30 border-blue-500/30'
                        : 'bg-orange-900/30 border-orange-500/30'
                    }`}>
                      <p className={`font-bold text-xs ${
                        reportFilteredMetrics.netProfit >= 0 ? 'text-blue-300' : 'text-orange-400'
                      }`}>{reportFilteredMetrics.netProfit.toLocaleString(undefined, {maximumFractionDigits:0})}</p>
                      <p className="text-gray-500 text-xs">Net</p>
                    </div>
                  </div>
                )}
                {reportFilteredMetrics && !isLoadingReportMetrics && (
                  <p className="text-gray-600 text-xs">{reportFilteredMetrics.count} transactions in period</p>
                )}
              </div>

              {/* Report summary panel */}
              <div className="space-y-3">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">{reportTypes[selectedReportType]?.icon || '📄'}</span>
                    <div>
                      <h3 className="text-white font-bold text-sm">{reportTypes[selectedReportType]?.name?.trim()}</h3>
                      <p className="text-gray-400 text-xs">{reportTypes[selectedReportType]?.desc}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {/* Use filtered metrics when available, else fall back to velocityMetrics */}
                    {(() => {
                      const fm = reportFilteredMetrics;
                      const inc  = fm ? fm.income    : (velocityMetrics?.income30Days  || 0);
                      const exp  = fm ? fm.expenses  : (velocityMetrics?.expenses30Days || 0);
                      const net  = fm ? fm.netProfit : (inc - exp);
                      const rate = inc > 0 ? ((net / inc) * 100) : 0;
                      // Always derive label from the chosen filter — never hardcode '30d'
                      const periodLabels = { today:'Today', week:'This Week', month:'This Month', year:'This Year', custom:'Custom Period' };
                      const label = periodLabels[reportDateFilter] || 'Period';
                      return (
                        <>
                          <div className="flex justify-between text-sm"><span className="text-gray-400">Income ({label})</span><span className="text-green-400 font-semibold">UGX {inc.toLocaleString(undefined, {maximumFractionDigits: 0})}</span></div>
                          <div className="flex justify-between text-sm"><span className="text-gray-400">Expenses ({label})</span><span className="text-red-400 font-semibold">UGX {exp.toLocaleString(undefined, {maximumFractionDigits: 0})}</span></div>
                          <div className="flex justify-between text-sm border-t border-white/10 pt-2"><span className="text-gray-300 font-medium">Net Profit</span><span className={`font-bold ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>UGX {net.toLocaleString(undefined, {maximumFractionDigits: 0})}</span></div>
                          <div className="flex justify-between text-sm"><span className="text-gray-400">Margin</span><span className="text-purple-400 font-semibold">{rate.toFixed(1)}%</span></div>
                          <div className="flex justify-between text-sm"><span className="text-gray-400">Net Worth</span><span className="text-yellow-400 font-semibold">UGX {(velocityMetrics?.netWorth || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</span></div>
                          {fm && !isLoadingReportMetrics && <div className="text-gray-600 text-xs pt-1">{fm.count} transaction{fm.count !== 1 ? 's' : ''} in period</div>}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Country selector for tax reports */}
                {reportTypes[selectedReportType]?.requiresCountry && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-xs font-semibold text-gray-400 mb-2">🌍 Tax Jurisdiction</p>
                    <div className="flex gap-2 flex-wrap">
                      {countries.map(c => (
                        <button key={c.code} onClick={() => setSelectedCountry(c.code)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${selectedCountry === c.code ? 'bg-purple-600 border-purple-400 text-white' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'}`}>
                          {c.flag} {c.name} ({c.tax})
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Export format selector */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 mb-1">Export As</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      {id:'csv',   label:'📊 CSV'},
                      {id:'excel', label:'🟢 Excel'},
                      {id:'json',  label:'🗂 JSON'},
                      {id:'pdf',   label:'📄 PDF'},
                      {id:'email', label:'✉️ Email'},
                    ].map(fmt => (
                      <button key={fmt.id} onClick={() => setExportFormat(fmt.id)}
                        className={`flex-1 min-w-[60px] py-2 rounded-lg text-xs font-bold border transition ${
                          exportFormat === fmt.id
                            ? 'bg-purple-600 border-purple-400 text-white'
                            : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                        }`}>{fmt.label}</button>
                    ))}
                  </div>
                </div>

                {/* Generate button */}
                <button
                  onClick={async () => {
                    setIsGeneratingReport(true);
                    setGeneratedReportData(null);
                    try {
                      // Use real Supabase-filtered data when available
                      const fm       = reportFilteredMetrics;
                      const income   = fm ? fm.income   : (velocityMetrics?.income30Days   || 0);
                      const expenses = fm ? fm.expenses : (velocityMetrics?.expenses30Days || 0);
                      const netWorth = velocityMetrics?.netWorth || 0;
                      const userId   = userProfile?.id;
                      const { start: periodStart, end: periodEnd } = getReportDateRange();
                      const fd = {
                        revenue: income,
                        costOfGoodsSold: expenses * 0.4,
                        operatingExpenses: expenses * 0.6,
                        otherIncome: 0,
                        otherExpenses: 0,
                        taxExpense: Math.max(0, (income - expenses) * 0.30),
                        assets: { cash: netWorth * 0.3, investments: netWorth * 0.4, equipment: netWorth * 0.2, property: 0, other: netWorth * 0.1 },
                        liabilities: { loans: expenses * 2, creditCards: 0, payables: expenses * 0.5, other: 0 },
                        equity: netWorth,
                        income, expenses, netProfit: income - expenses,
                        savingsRate: income > 0 ? ((income - expenses) / income * 100) : 0,
                        netWorth,
                        periodFilter: reportDateFilter,
                        periodStart,
                        periodEnd,
                        transactionCount: fm?.count || 0,
                        categoryBreakdown: fm?.categories || {},
                      };
                      let result;
                      if (selectedReportType === 'tax-filing') {
                        result = await generateTaxReturn(fd, selectedCountry, userId);
                      } else if (selectedReportType === 'balance-sheet') {
                        result = await generateBalanceSheet(fd, selectedCountry, userId);
                      } else if (selectedReportType === 'income-statement') {
                        result = await generateIncomeStatement(fd, selectedCountry, userId);
                      } else if (selectedReportType === 'custom-analysis') {
                        result = await generateCountryComplianceReport(fd, selectedCountry, userId);
                      } else {
                        // Generic — save to Supabase financial_reports
                        result = { ...fd, type: selectedReportType, country: selectedCountry, generated: new Date().toLocaleDateString() };
                        if (userId) {
                          await supabase.from('financial_reports').insert([{
                            user_id: userId,
                            report_type: selectedReportType,
                            country: selectedCountry,
                            data: result,
                            created_at: new Date().toISOString()
                          }]).then(({ error }) => { if(error) console.error('Save report:', error); });
                        }
                      }
                      setGeneratedReportData({ ...result, reportName: reportTypes[selectedReportType]?.name, generated: new Date().toLocaleDateString() });
                    } catch(e) {
                      console.error('Report generation error:', e);
                      setGeneratedReportData({ error: true, reportName: reportTypes[selectedReportType]?.name, generated: new Date().toLocaleDateString() });
                    } finally {
                      setIsGeneratingReport(false);
                    }
                  }}
                  disabled={isGeneratingReport}
                  className="w-full py-3 rounded-xl font-bold text-white text-sm transition active:scale-95 disabled:opacity-60"
                  style={{background: 'linear-gradient(135deg, #e11d48, #9333ea)'}}
                >
                  {isGeneratingReport ? '⏳ Generating & Saving...' : '🚀 Generate Report'}
                </button>

                {generatedReportData && !isGeneratingReport && (
                  <div className="space-y-2">
                    {generatedReportData.error ? (
                      <div className="bg-red-900/30 border border-red-500/40 rounded-xl p-3">
                        <p className="text-red-400 font-semibold text-xs">⚠️ Generation failed — check connection</p>
                      </div>
                    ) : (
                      <div className="bg-green-900/30 border border-green-500/40 rounded-xl p-3 space-y-2">
                        <p className="text-green-400 font-semibold text-xs">✅ Saved to Supabase — {generatedReportData.generated}</p>
                        <p className="text-gray-400 text-xs">{generatedReportData.reportName?.trim()} · {countries.find(c => c.code === selectedCountry)?.name || 'Uganda'}</p>
                        {/* Export action buttons */}
                        <div className="flex flex-wrap gap-2 pt-1">
                          {/* CSV */}
                          <button
                            onClick={() => {
                              const rows = [];
                              const flatten = (obj, prefix='') => {
                                Object.entries(obj).forEach(([k,v]) => {
                                  const key = prefix ? `${prefix}.${k}` : k;
                                  if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key);
                                  else rows.push(`"${key}","${String(v ?? '')}"`);
                                });
                              };
                              flatten(generatedReportData);
                              const csv = ['Field,Value', ...rows].join('\n');
                              const blob = new Blob([csv], {type:'text/csv'});
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a'); a.href=url;
                              a.download = `ICAN_${selectedReportType}_${Date.now()}.csv`;
                              a.click(); URL.revokeObjectURL(url);
                            }}
                            className={`flex-1 min-w-[60px] py-2 rounded-lg text-xs font-bold transition active:scale-95 ${
                              exportFormat==='csv' ? 'bg-emerald-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                            }`}
                          >📊 CSV</button>

                          {/* Excel */}
                          <button
                            onClick={() => {
                              const rows = [];
                              const flatten = (obj, prefix='') => {
                                Object.entries(obj).forEach(([k,v]) => {
                                  const key = prefix ? `${prefix}.${k}` : k;
                                  if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key);
                                  else rows.push({ Field: key, Value: v });
                                });
                              };
                              flatten(generatedReportData);
                              const ws = XLSX.utils.json_to_sheet(rows);
                              ws['!cols'] = [{wch:40},{wch:30}];
                              const wb = XLSX.utils.book_new();
                              XLSX.utils.book_append_sheet(wb, ws, 'Report');
                              XLSX.writeFile(wb, `ICAN_${selectedReportType}_${Date.now()}.xlsx`);
                            }}
                            className={`flex-1 min-w-[60px] py-2 rounded-lg text-xs font-bold transition active:scale-95 ${
                              exportFormat==='excel' ? 'bg-green-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                            }`}
                          >🟢 Excel</button>

                          {/* JSON */}
                          <button
                            onClick={() => {
                              const json = JSON.stringify(generatedReportData, null, 2);
                              const blob = new Blob([json], {type:'application/json'});
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a'); a.href=url;
                              a.download = `ICAN_${selectedReportType}_${Date.now()}.json`;
                              a.click(); URL.revokeObjectURL(url);
                            }}
                            className={`flex-1 min-w-[60px] py-2 rounded-lg text-xs font-bold transition active:scale-95 ${
                              exportFormat==='json' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                            }`}
                          >🗂 JSON</button>

                          {/* PDF */}
                          <button
                            onClick={() => {
                              const doc = new jsPDF({ unit: 'mm', format: 'a4' });
                              const rpt = generatedReportData;
                              const countryName = countries?.find(c => c.code === selectedCountry)?.name || selectedCountry || 'Uganda';
                              const title = rpt.reportName || selectedReportType.replace(/-/g,' ').toUpperCase();
                              // Header band
                              doc.setFillColor(147, 51, 234);
                              doc.rect(0, 0, 210, 28, 'F');
                              doc.setTextColor(255, 255, 255);
                              doc.setFontSize(16); doc.setFont('helvetica','bold');
                              doc.text('ICAN Financial Report', 14, 12);
                              doc.setFontSize(10); doc.setFont('helvetica','normal');
                              doc.text(`${title} · ${countryName}`, 14, 20);
                              doc.text(`Generated: ${rpt.generated || new Date().toLocaleDateString()}`, 150, 20);
                              // Body
                              doc.setTextColor(30, 30, 30);
                              let y = 36;
                              const addSection = (heading, obj) => {
                                if (!obj || typeof obj !== 'object') return;
                                doc.setFontSize(11); doc.setFont('helvetica','bold');
                                doc.setTextColor(147, 51, 234);
                                doc.text(heading, 14, y); y += 5;
                                doc.setDrawColor(200, 180, 240);
                                doc.line(14, y, 196, y); y += 4;
                                doc.setFontSize(9); doc.setFont('helvetica','normal');
                                doc.setTextColor(50, 50, 50);
                                Object.entries(obj).forEach(([k, v]) => {
                                  if (typeof v === 'object' && v !== null) return;
                                  const label = k.replace(/([A-Z])/g,' $1').replace(/_/g,' ');
                                  const val = typeof v === 'number' ? v.toLocaleString() : String(v ?? '');
                                  doc.text(`${label}:`, 16, y);
                                  doc.text(val, 110, y);
                                  y += 5;
                                  if (y > 270) { doc.addPage(); y = 20; }
                                });
                                y += 3;
                              };
                              // Top-level primitives
                              addSection('Summary', Object.fromEntries(
                                Object.entries(rpt).filter(([,v]) => typeof v !== 'object')
                              ));
                              // Nested objects
                              Object.entries(rpt).forEach(([k,v]) => {
                                if (v && typeof v === 'object' && !Array.isArray(v)) {
                                  addSection(k.replace(/([A-Z])/g,' $1').replace(/_/g,' ').toUpperCase(), v);
                                }
                              });
                              // Footer
                              const pages = doc.internal.getNumberOfPages();
                              for (let i = 1; i <= pages; i++) {
                                doc.setPage(i);
                                doc.setFontSize(8); doc.setTextColor(160,160,160);
                                doc.text(`ICAN · Confidential · Page ${i} of ${pages}`, 14, 290);
                              }
                              doc.save(`ICAN_${selectedReportType}_${Date.now()}.pdf`);
                            }}
                            className={`flex-1 min-w-[60px] py-2 rounded-lg text-xs font-bold transition active:scale-95 ${
                              exportFormat==='pdf' ? 'bg-rose-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                            }`}
                          >📄 PDF</button>

                          {/* Email */}
                          <button
                            onClick={() => {
                              const rpt = generatedReportData;
                              const countryName = countries?.find(c => c.code === selectedCountry)?.name || 'Uganda';
                              const subject = encodeURIComponent(`ICAN Financial Report — ${rpt.reportName || selectedReportType} (${countryName})`);
                              const lines = [];
                              const flatten = (obj, prefix='') => {
                                Object.entries(obj).forEach(([k,v]) => {
                                  const key = prefix ? `${prefix}.${k}` : k;
                                  if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key);
                                  else lines.push(`${key}: ${v}`);
                                });
                              };
                              flatten(rpt);
                              const body = encodeURIComponent(
                                `ICAN Financial Report\n` +
                                `Type: ${rpt.reportName || selectedReportType}\n` +
                                `Country: ${countryName}\n` +
                                `Generated: ${rpt.generated || new Date().toLocaleDateString()}\n\n` +
                                `--- Report Data ---\n` +
                                lines.join('\n')
                              );
                              window.location.href = `mailto:?subject=${subject}&body=${body}`;
                            }}
                            className={`flex-1 min-w-[60px] py-2 rounded-lg text-xs font-bold transition active:scale-95 ${
                              exportFormat==='email' ? 'bg-amber-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                            }`}
                          >✉️ Email</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Business Loan Calculator — real extracted component */}
      {showBusinessLoanCalculator && (
        <BusinessLoanCalculator
          isOpen={showBusinessLoanCalculator}
          onClose={() => setShowBusinessLoanCalculator(false)}
          preFilledAmount={loanAmount}
          onAddLoan={(loan) => {
            const formattedLoan = {
              id: `loan_${Date.now()}`,
              amount: loan.amount,
              transaction_type: 'expense',
              description: `Business Loan — ${loan.purpose || 'business-expansion'}`,
              created_at: new Date().toISOString(),
              user_id: userProfile?.id,
              currency: 'UGX',
              status: 'completed',
              record_category: 'business',
              metadata: {
                category: 'cashflow',
                source: 'loan_calculator',
                record_category: 'business',
                accounting_type: 'liability',
                monthly_payment: loan.monthlyPayment,
                interest_rate: loan.interestRate,
                term_years: loan.term,
              }
            };
            setTransactions(prev => [formattedLoan, ...prev]);
            setShowBusinessLoanCalculator(false);
          }}
        />
      )}

      {/* Smart Transaction Entry Modal */}
      <SmartTransactionEntry
        isOpen={showTransactionEntry}
        transactionType={transactionType}
        prefillText={voicePrefill}
        onClose={() => {
          setShowTransactionEntry(false);
          setShowRecordPanel(false);
          setTransactionType(null);
          setVoicePrefill('');
        }}
        onSubmit={(transaction) => {
          // Add timestamp if not present
          if (!transaction.timestamp) {
            transaction.timestamp = new Date().toISOString();
          }

          // Resolve business-or-personal from the submitted transaction
          const resolvedCategory = transaction.accountingType || transactionType || 'personal';

          // Store transaction locally with proper format
          const formattedTransaction = {
            id: transaction.id || `temp_${Date.now()}`,
            amount: transaction.amount || 0,
            transaction_type: transaction.isIncome ? 'income' : 'expense',
            description: transaction.description || 'Transaction',
            created_at: transaction.timestamp || new Date().toISOString(),
            user_id: userProfile?.id,
            currency: 'UGX',
            status: 'completed',
            record_category: resolvedCategory,
            metadata: {
              category: transaction.category || 'other',
              source: 'smart_entry',
              record_category: resolvedCategory,
              accounting_type: transaction.businessAccountingType || null
            }
          };
          setTransactions(prev => [formattedTransaction, ...prev]);

          // Persist transaction to Supabase via VelocityEngine
          const saveAndRefresh = async () => {
            try {
              // Get user ID from Supabase auth (same as web view)
              const { data: { user } } = await supabase.auth.getUser();
              const userId = user?.id || userProfile?.id || 'demo-user';
              
              if (userId) {
                // Save transaction using VelocityEngine
                const engine = new VelocityEngine(userId);
                const result = await engine.addTransaction({
                  amount: transaction.amount || 0,
                  type: transaction.isIncome ? 'income' : 'expense',
                  description: transaction.description || 'Transaction',
                  category: transaction.category || 'other',
                  date: transaction.timestamp || new Date().toISOString(),
                  source: 'smart_entry',
                  currency: 'UGX',
                  record_category: resolvedCategory,
                  accounting_type: transaction.businessAccountingType || null
                });

                if (result.success) {
                  console.log(` Mobile: Saved transaction for user ${userId}`, result.transaction);
                  // Update with real transaction data
                  setTransactions(prev => [
                    result.transaction,
                    ...prev.filter(t => t.id !== formattedTransaction.id)
                  ]);
                  
                  // Reload metrics from VelocityEngine
                  const loadResult = await engine.loadTransactions();
                  if (loadResult.success) {
                    const metrics = engine.calculateMetrics();
                    console.log(' Updated VelocityEngine Metrics:', metrics);
                    setVelocityMetrics(metrics);
                  }
                } else {
                  console.error('Failed to save transaction:', result.error);
                  // Remove failed transaction
                  setTransactions(prev => prev.filter(t => t.id !== formattedTransaction.id));
                }
              }
            } catch (error) {
              console.error('Error saving transaction to database:', error);
              // Remove failed transaction
              setTransactions(prev => prev.filter(t => t.id !== formattedTransaction.id));
            }
          };
          saveAndRefresh();

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

          console.log(' Transaction recorded:', transaction);
        }}
      />
    </div>
  );
};


export default MobileView;
