import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ThumbsUp, MessageCircle, Share2, Clock, Users, FileText, Zap, AlertCircle, Building2, Loader, Plus, Trash2, Lock, Unlock, X, Send, Copy, Check, Play, Home, BookMarked, Heart, Briefcase, Bell, Search, ShoppingBag, Download, Gem } from 'lucide-react';
import DiamondLoader from './DiamondLoader';
import PitchVideoRecorder from './PitchVideoRecorder';
import SmartContractGenerator from './SmartContractGenerator';
import PrivatePitchInviteModal from './PrivatePitchInviteModal';
import ShareSigningFlow from './ShareSigningFlow';
import InvestmentProgressView from './InvestmentProgressView';
import BusinessProfileForm from './BusinessProfileForm';
import BusinessProfileSelector from './BusinessProfileSelector';
import BusinessCategorySelector from './BusinessCategorySelector';
import BusinessProfileCard from './BusinessProfileCard';
import SHAREHub from './SHAREHub';
import PitchinLiveShareValue from './PitchinLiveShareValue';
import BusinessWalletModal from './BusinessWalletModal';
import { 
  getAllPitches, 
  getUserPitches, 
  getUserBusinessProfiles,
  getAllAccessibleBusinessProfiles,
  checkBusinessProfileEditPermission,
  likePitch,
  sharePitch,
  createPitch,
  updatePitch,
  deletePitch,
  uploadVideo,
  deleteBusinessProfile as deleteProfileService,
  createNotification,
  getSupabase
} from '../services/pitchingService';
import {
  likePitchDb,
  unlikePitchDb,
  getPitchComments,
  addPitchComment,
  deleteComment,
  hasUserLikedPitch,
  getUserLikedPitches,
  getUserInvestedPitches,
  recordShare,
  recordInvestmentInterest,
  hasUserInvestedInterest,
  subscribeToAllPitchesMetrics,
  getPitchMetrics
} from '../services/pitchInteractionsService';
import { getUserNotifications } from '../services/investmentNotificationsService';
import { getLiveShareOffer } from '../services/pitchinValuationService';
import { resolveMediaValue, resolveDownloadUrl } from '../services/r2StorageService';
import { getBusinessStorefronts } from '../services/dropshipService';

// Why an Invest tap can't open the signing flow. Each case is a missing piece
// of live data — the flow never falls back to the listed pitch price, so the
// investor is told what's missing instead of being shown a stale number.
export const LIVE_OFFER_BLOCKED_MESSAGE = {
  'no-business-profile': 'This pitch is not linked to a business profile yet, so it has no live share value to invest against.',
  'shares-not-configured': 'The owner has not set how many shares this business has yet. Investing opens once they do.',
  'no-live-price': 'This business has no live share value yet — its recorded transactions do not add up to a positive value.',
  'issued-shares-unreadable': 'Could not confirm how many shares are still unsold. Please try again in a moment.',
  default: 'Live share value is unavailable for this business right now. Please try again in a moment.'
};

// The premium "gallery vitrine" treatment shown while pitches load or when
// the feed is empty — an atelier/auction-house feel (obsidian ground, hairline
// gold framing, one gem under a spotlight) replacing the old neon-blob +
// floating-emoji loading screen. Shared by both the desktop feed frame and
// the mobile full-screen feed so the two stay visually identical.
const PITCHIN_LOADING_CAPTIONS = [
  'Curating pitches for you',
  'Vetting founders',
  'Polishing the stage',
  'Loading today’s opportunities',
];
const PITCHIN_CAPTION_LOOP_SECONDS = 9.6;

let pitchinStageStylesInjected = false;
const injectPitchinStageStyles = () => {
  if (pitchinStageStylesInjected || typeof document === 'undefined') return;
  pitchinStageStylesInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-pitchin-stage', 'true');
  style.textContent = `
    @keyframes pitchin-stage-caption {
      0%, 4% { opacity: 0; transform: translateY(4px); }
      10%, 84% { opacity: 1; transform: translateY(0); }
      90%, 100% { opacity: 0; transform: translateY(-4px); }
    }
    .pitchin-stage-caption {
      animation-name: pitchin-stage-caption;
      animation-timing-function: ease-in-out;
      animation-iteration-count: infinite;
    }
    @keyframes pitchin-stage-halo {
      0%, 100% { opacity: 0.5; transform: scale(0.92); }
      50% { opacity: 1; transform: scale(1.08); }
    }
    .pitchin-stage-halo {
      animation: pitchin-stage-halo 3.2s ease-in-out infinite;
    }
    @keyframes pitchin-stage-bar {
      0% { transform: translateX(-120%); }
      100% { transform: translateX(220%); }
    }
    .pitchin-stage-bar {
      animation: pitchin-stage-bar 2.4s ease-in-out infinite;
    }
    @keyframes pitchin-stage-rise {
      0% { opacity: 0; transform: translateY(10px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    .pitchin-stage-rise {
      animation: pitchin-stage-rise 0.9s ease-out both;
    }
  `;
  document.head.appendChild(style);
};

const Pitchin = ({ showPitchCreator, onClosePitchCreator, onOpenCreate, openBusinessProfile = false, onBusinessProfileRequestConsumed = null, navRef = null, onTabChange = null }) => {
  const [pitches, setPitches] = useState([]);
  const [filteredPitches, setFilteredPitches] = useState([]);
  // business_profile_id -> business_name, only for pitchers who currently have
  // a live dropship storefront -- gates the "Buy Now" tag on each pitch.
  const [storefrontsByBusiness, setStorefrontsByBusiness] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [supabaseReady, setSupabaseReady] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [minFunding, setMinFunding] = useState('0');
  const [maxFunding, setMaxFunding] = useState('10000000');
  const [minEquity, setMinEquity] = useState('0');
  const [maxEquity, setMaxEquity] = useState('100');
  const [hasIPOnly, setHasIPOnly] = useState(false);
  const [sortBy, setSortBy] = useState('relevance');
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  const [showRecorder, setShowRecorder] = useState(false);
  const [currentPitch, setCurrentPitch] = useState(null);
  const [activeTab, _setActiveTab] = useState('feed');
  // onTabChange must not run inside the functional updater below — React
  // invokes it during this component's render phase, so calling another
  // component's setState from there triggers "Cannot update a component
  // while rendering a different component". Defer it to a useEffect instead.
  const pendingTabChangeRef = useRef(null);
  const setActiveTab = (newTab) => { _setActiveTab(prev => { pendingTabChangeRef.current = prev; return newTab; }); };
  useEffect(() => {
    if (pendingTabChangeRef.current !== null) {
      const prev = pendingTabChangeRef.current;
      pendingTabChangeRef.current = null;
      onTabChange?.(prev);
    }
  }, [activeTab]);
  useEffect(() => { if (navRef) navRef.current = _setActiveTab; return () => { if (navRef) navRef.current = null; }; }, [navRef]);
  const [selectedForContract, setSelectedForContract] = useState(null);
  const [selectedForInvestment, setSelectedForInvestment] = useState(null); // For ShareSigningFlow
  const [selectedForProgress, setSelectedForProgress] = useState(null); // { pitch, agreement } - for InvestmentProgressView
  // My existing investment agreement (if any) against the business profile
  // currently being viewed via viewingPitcher -- drives the "View My
  // Investment Progress" button in the viewing-pitcher banner below.
  const [viewingPitcherOwnAgreement, setViewingPitcherOwnAgreement] = useState(null);
  const [videoErrors, setVideoErrors] = useState({});
  const [bufferingPitches, setBufferingPitches] = useState(new Set()); // pitch ids whose video is currently buffering
  const [downloadingPitchId, setDownloadingPitchId] = useState(null);
  const [businessProfiles, setBusinessProfiles] = useState([]);
  const [currentBusinessProfile, setCurrentBusinessProfile] = useState(null);
  const [showBusinessForm, setShowBusinessForm] = useState(false);
  const [showBusinessCategorySelector, setShowBusinessCategorySelector] = useState(false);
  const [selectedBusinessCategory, setSelectedBusinessCategory] = useState(null);
  const [showProfileSelector, setShowProfileSelector] = useState(false);
  const [showProfileDetails, setShowProfileDetails] = useState(false);
  const [showShareValuePanel, setShowShareValuePanel] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);
  const [likedPitches, setLikedPitches] = useState(new Set());
  const [investedPitches, setInvestedPitches] = useState(new Set()); // track pitches user showed interest in
  const [viewingPitcher, setViewingPitcher] = useState(null); // { name, business_profile_id, user_id } | null
  const [businessDetailsPitch, setBusinessDetailsPitch] = useState(null); // pitch whose business details modal is open (Pitcher icon tap)
  const [businessOwnerProfile, setBusinessOwnerProfile] = useState(null); // { full_name, avatar_url } for businessDetailsPitch's owner
  const [businessLiveOffer, setBusinessLiveOffer] = useState(null); // live getLiveShareOffer() result for businessDetailsPitch
  const [invitePitch, setInvitePitch] = useState(null); // pitch whose "Invite investor" modal (PrivatePitchInviteModal) is open
  const [businessLiveOfferLoading, setBusinessLiveOfferLoading] = useState(false);
  const [showComments, setShowComments] = useState(null); // pitch id for comments modal
  const [comments, setComments] = useState({});
  const [newComment, setNewComment] = useState('');
  const [copiedPitchId, setCopiedPitchId] = useState(null);
  const [expandedPitchInfo, setExpandedPitchInfo] = useState(null); // pitch id for info tooltip
  const [videoOrientations, setVideoOrientations] = useState({}); // track video orientations (portrait/landscape)
  const [showMobilePitchDetail, setShowMobilePitchDetail] = useState(false); // mobile pitch detail modal
  const [selectedMobilePitch, setSelectedMobilePitch] = useState(null); // selected pitch for mobile detail
  const [showSHAREHub, setShowSHAREHub] = useState(false); // show SHAREHub modal on mobile
  const [videoPlayerPitch, setVideoPlayerPitch] = useState(null); // pitch for fullscreen video player
  const [isDesktopView, setIsDesktopView] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false
  );
  const [mutedVideos, setMutedVideos] = useState(new Set()); // track which videos are unmuted (all start muted)
  const [currentVisiblePitch, setCurrentVisiblePitch] = useState(null); // track currently visible pitch for web bottom nav
  const [desktopActivePitchId, setDesktopActivePitchId] = useState(null); // which pitch plays in the desktop "theater" player
  const isRestoringPitchinHistoryRef = useRef(false);
  const hasHydratedPitchinHistoryRef = useRef(false);
  const videoRefs = useRef({}); // refs to video elements for controlling sound
  const videoScrollRef = useRef(null);
  const metricsUnsubscribeRef = useRef(null); // ref to store real-time unsubscribe function
  const desktopSidebarRef = useRef(null); // scroll container for the "More Pitches" sidebar — IntersectionObserver root
  const sideVideoObservers = useRef({}); // pitchId -> IntersectionObserver, so sidebar thumbnails only autoplay while actually scrolled into view
  const sideVideoRefCallbacks = useRef({}); // pitchId -> stable ref callback, so re-renders (e.g. live like counts) don't thrash the observer

  useEffect(() => {
    return () => {
      Object.values(sideVideoObservers.current).forEach(observer => observer.disconnect());
    };
  }, []);

  useEffect(() => {
    if (openBusinessProfile) {
      setEditingProfile(null);
      setSelectedBusinessCategory(null);
      setShowBusinessCategorySelector(true);
      onBusinessProfileRequestConsumed?.();
    }
  }, [openBusinessProfile, onBusinessProfileRequestConsumed]);

  const openNewBusinessProfile = () => {
    setShowProfileSelector(false);
    setEditingProfile(null);
    setSelectedBusinessCategory(null);
    setShowBusinessCategorySelector(true);
  };

  const handleBusinessCategorySelected = (category) => {
    setSelectedBusinessCategory(category);
    setShowBusinessCategorySelector(false);
    setShowBusinessForm(true);
  };

  const VALID_PITCHIN_TABS = ['feed', 'myPitches', 'interested', 'search'];

  useEffect(() => {
    const pitchinState = {
      activeTab,
      showRecorder,
      showBusinessForm,
      showProfileSelector,
      showProfileDetails,
      showComments,
      showMobilePitchDetail,
      selectedMobilePitchId: selectedMobilePitch?.id || null,
      viewingPitcherBusinessProfileId: viewingPitcher?.business_profile_id || null,
      selectedForContractId: selectedForContract?.id || null,
      selectedForInvestmentId: selectedForInvestment?.id || null,
    };

    const payload = {
      ...(window.history.state || {}),
      __icanPitchin: pitchinState,
    };

    if (isRestoringPitchinHistoryRef.current) {
      window.history.replaceState(payload, '', window.location.href);
      return;
    }

    const current = window.history.state?.__icanPitchin;
    const sameState =
      current &&
      current.activeTab === pitchinState.activeTab &&
      Boolean(current.showRecorder) === pitchinState.showRecorder &&
      Boolean(current.showBusinessForm) === pitchinState.showBusinessForm &&
      Boolean(current.showProfileSelector) === pitchinState.showProfileSelector &&
      Boolean(current.showProfileDetails) === pitchinState.showProfileDetails &&
      (current.showComments || null) === (pitchinState.showComments || null) &&
      Boolean(current.showMobilePitchDetail) === pitchinState.showMobilePitchDetail &&
      (current.selectedMobilePitchId || null) === pitchinState.selectedMobilePitchId &&
      (current.viewingPitcherBusinessProfileId || null) === pitchinState.viewingPitcherBusinessProfileId &&
      (current.selectedForContractId || null) === pitchinState.selectedForContractId &&
      (current.selectedForInvestmentId || null) === pitchinState.selectedForInvestmentId;

    if (!hasHydratedPitchinHistoryRef.current) {
      window.history.replaceState(payload, '', window.location.href);
      hasHydratedPitchinHistoryRef.current = true;
      return;
    }

    if (!sameState) {
      window.history.pushState(payload, '', window.location.href);
    }
  }, [
    activeTab,
    showRecorder,
    showBusinessForm,
    showProfileSelector,
    showProfileDetails,
    showComments,
    showMobilePitchDetail,
    selectedMobilePitch,
    viewingPitcher,
    selectedForContract,
    selectedForInvestment,
  ]);

  useEffect(() => {
    const handlePopState = (event) => {
      const historyState = event.state?.__icanPitchin;
      if (!historyState) return;

      const getPitchById = (pitchId) => {
        if (!pitchId) return null;
        return pitches.find((pitch) => pitch.id === pitchId) || null;
      };

      const getPitcherByBusinessProfileId = (businessProfileId) => {
        if (!businessProfileId) return null;
        const matchingPitch = pitches.find((pitch) => pitch.business_profile_id === businessProfileId);
        if (!matchingPitch) return null;
        return {
          name: matchingPitch.business_profiles?.business_name || 'Pitcher',
          business_profile_id: businessProfileId,
          user_id: matchingPitch.business_profiles?.user_id || null,
        };
      };

      isRestoringPitchinHistoryRef.current = true;
      hasHydratedPitchinHistoryRef.current = true;

      setActiveTab(VALID_PITCHIN_TABS.includes(historyState.activeTab) ? historyState.activeTab : 'feed');
      setShowRecorder(Boolean(historyState.showRecorder));
      setShowBusinessForm(Boolean(historyState.showBusinessForm));
      setShowProfileSelector(Boolean(historyState.showProfileSelector));
      setShowProfileDetails(Boolean(historyState.showProfileDetails));
      setShowComments(historyState.showComments || null);
      setShowMobilePitchDetail(Boolean(historyState.showMobilePitchDetail));
      setSelectedMobilePitch(getPitchById(historyState.selectedMobilePitchId));
      setViewingPitcher(getPitcherByBusinessProfileId(historyState.viewingPitcherBusinessProfileId));
      setSelectedForContract(getPitchById(historyState.selectedForContractId));
      setSelectedForInvestment(getPitchById(historyState.selectedForInvestmentId));

      window.setTimeout(() => {
        isRestoringPitchinHistoryRef.current = false;
      }, 0);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [pitches]);

  // Initialize and load data
  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true);
        
        // Check if Supabase is configured
        const sb = getSupabase();
        console.log('Supabase client initialized:', !!sb);
        setSupabaseReady(!!sb);

        if (sb) {
          try {
            // Get current user with error handling
            console.log('Fetching current user...');
            const { data: { user }, error: userError } = await sb.auth.getUser();
            
            if (userError) {
              console.warn('Auth error getting user:', userError.message);
              // Continue without user - demo mode will work
            } else {
              setCurrentUser(user);

              // Load user's business profiles if logged in (owned + co-owned)
              if (user) {
                try {
                  // Get all accessible profiles (owned + co-owned)
                  const profiles = await getAllAccessibleBusinessProfiles(user.id, user.email);
                  setBusinessProfiles(profiles);
                  if (profiles.length > 0) {
                    setCurrentBusinessProfile(profiles[0]);
                  }
                  
                  // Load user's liked pitches
                  const likedIds = await getUserLikedPitches(user.id);
                  if (likedIds.length > 0) {
                    setLikedPitches(new Set(likedIds));
                    console.log('✅ Loaded', likedIds.length, 'liked pitches for user');
                  }
                  
                  // Load user's invested pitches
                  const investedIds = await getUserInvestedPitches(user.id);
                  if (investedIds.length > 0) {
                    setInvestedPitches(new Set(investedIds));
                    console.log('✅ Loaded', investedIds.length, 'invested pitches for user');
                  }
                } catch (profileError) {
                  console.warn('Error loading profiles:', profileError.message);
                }
              }
            }
          } catch (authError) {
            console.warn('Auth initialization error:', authError.message);
            // Continue without auth - fallback to demo mode
          }
        }

        // Load pitches (works in demo mode)
        const allPitches = await getAllPitches();
        setPitches(allPitches);
        setFilteredPitches(allPitches);
      } catch (error) {
        console.error('Error initializing Pitchin:', error);
        // Still show demo content even if there's an error
        const demoData = await getAllPitches();
        setPitches(demoData);
        setFilteredPitches(demoData);
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, []);

  // Which pitchers currently have a live dropship storefront -- re-resolved
  // whenever the visible pitch list changes (new load, like/comment updates
  // still keep the same business_profile_ids so this stays cheap).
  useEffect(() => {
    const businessIds = [...new Set(pitches.map((p) => p.business_profile_id).filter(Boolean))];
    if (businessIds.length === 0) {
      setStorefrontsByBusiness(new Map());
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const { data } = await getBusinessStorefronts(businessIds);
      if (cancelled) return;
      const map = new Map();
      (data || []).forEach((row) => map.set(row.business_profile_id, row.business_name));
      setStorefrontsByBusiness(map);
    })();
    return () => { cancelled = true; };
  }, [pitches]);

  // Keep desktop/mobile layout in sync with viewport width
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const handleViewportChange = (event) => setIsDesktopView(event.matches);

    setIsDesktopView(mediaQuery.matches);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleViewportChange);
      return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  // Handle tab changes and smart search with relevance scoring
  useEffect(() => {
    let filtered = [];

    // If viewing a specific pitcher's videos, filter by their business_profile_id
    if (viewingPitcher) {
      filtered = pitches.filter(p => p.business_profile_id === viewingPitcher.business_profile_id);
      setFilteredPitches(filtered);
      return;
    }
    
    if (activeTab === 'feed') {
      // Show ALL published pitches in feed - free to view for everyone
      filtered = pitches;
    } else if (activeTab === 'myPitches' && currentUser) {
      // Show only user's actual pitches (must have user_id that matches)
      filtered = pitches.filter(p => p.business_profiles?.user_id === currentUser.id);
    } else if (activeTab === 'interested') {
      // Show pitches user has liked or invested in
      filtered = pitches.filter(p => likedPitches.has(p.id) || investedPitches.has(p.id));
      if (filtered.length === 0) filtered = []; // Show empty if none
    } else if (activeTab === 'search') {
      // Smart search with relevance scoring and advanced filters
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const minFund = parseInt(minFunding) || 0;
        const maxFund = parseInt(maxFunding) || 10000000;
        const minEq = parseInt(minEquity) || 0;
        const maxEq = parseInt(maxEquity) || 100;
        
        // Calculate relevance score for each pitch
        const scoredPitches = pitches.map(p => {
          const title = p.title?.toLowerCase() || '';
          const description = p.description?.toLowerCase() || '';
          const category = p.category?.toLowerCase() || '';
          const businessName = p.business_profiles?.business_name?.toLowerCase() || '';
          const funding = p.target_funding || 0;
          const equity = p.equity_offering || 0;
          
          let score = 0;
          
          // Text relevance scoring
          if (title.includes(query)) score += 100;
          if (title.startsWith(query)) score += 50;
          if (category.includes(query)) score += 50;
          if (businessName.includes(query)) score += 25;
          if (description.includes(query)) score += 10;
          
          // Engagement scoring (likes, comments, shares)
          score += (p.likes_count || 0) * 0.5;
          score += (p.comments_count || 0) * 0.3;
          
          return { 
            pitch: p, 
            score,
            funding,
            equity
          };
        });
        
        // Apply all filters together
        filtered = scoredPitches
          .filter(item => item.score > 0) // Must match search
          .filter(item => selectedCategory === 'all' || item.pitch.category === selectedCategory) // Category
          .filter(item => item.funding >= minFund && item.funding <= maxFund) // Funding range
          .filter(item => item.equity >= minEq && item.equity <= maxEq) // Equity range
          .filter(item => !hasIPOnly || item.pitch.has_ip) // IP filter
          .sort((a, b) => {
            // Sort by selected criteria
            if (sortBy === 'relevance') return b.score - a.score;
            if (sortBy === 'funding-high') return b.funding - a.funding;
            if (sortBy === 'funding-low') return a.funding - b.funding;
            if (sortBy === 'equity-high') return b.equity - a.equity;
            if (sortBy === 'equity-low') return a.equity - b.equity;
            if (sortBy === 'trending') return (b.pitch.likes_count || 0) - (a.pitch.likes_count || 0);
            return b.score - a.score;
          })
          .map(item => item.pitch);
      } else {
        filtered = []; // Empty search query shows no results
      }
    }
    
    setFilteredPitches(filtered);
  }, [activeTab, pitches, currentUser, likedPitches, investedPitches, searchQuery, selectedCategory, minFunding, maxFunding, minEquity, maxEquity, hasIPOnly, sortBy, viewingPitcher]);

  // Set up real-time metrics subscription
  useEffect(() => {
    // Subscribe to real-time updates for all pitches metrics
    const unsubscribe = subscribeToAllPitchesMetrics((update) => {
      console.log('📊 Real-time metric update:', update);
      
      setPitches(prev => prev.map(pitch => {
        if (pitch.id === update.pitchId) {
          switch (update.type) {
            case 'likes':
              return { ...pitch, likes_count: update.count };
            case 'comments':
              return { ...pitch, comments_count: update.count };
            case 'shares':
              return { ...pitch, shares_count: update.count };
            case 'invests':
              return { ...pitch, invests_count: update.count };
            default:
              return pitch;
          }
        }
        return pitch;
      }));
      
      // Also update filtered pitches
      setFilteredPitches(prev => prev.map(pitch => {
        if (pitch.id === update.pitchId) {
          switch (update.type) {
            case 'likes':
              return { ...pitch, likes_count: update.count };
            case 'comments':
              return { ...pitch, comments_count: update.count };
            case 'shares':
              return { ...pitch, shares_count: update.count };
            case 'invests':
              return { ...pitch, invests_count: update.count };
            default:
              return pitch;
          }
        }
        return pitch;
      }));
      
      // Also update videoPlayerPitch if it's open and matches
      setVideoPlayerPitch(prev => {
        if (prev && prev.id === update.pitchId) {
          switch (update.type) {
            case 'likes':
              return { ...prev, likes_count: update.count };
            case 'comments':
              return { ...prev, comments_count: update.count };
            case 'shares':
              return { ...prev, shares_count: update.count };
            case 'invests':
              return { ...prev, invests_count: update.count };
            default:
              return prev;
          }
        }
        return prev;
      });
    });

    metricsUnsubscribeRef.current = unsubscribe;

    // Cleanup on unmount
    return () => {
      if (metricsUnsubscribeRef.current) {
        metricsUnsubscribeRef.current();
      }
    };
  }, []);
  // Handle external showPitchCreator trigger from parent
  useEffect(() => {
    console.log('Pitchin: showPitchCreator changed to:', showPitchCreator);
    if (showPitchCreator) {
      console.log('Pitchin: Setting showRecorder to true');
      setShowRecorder(true);
    }
  }, [showPitchCreator]);

  // Track currently visible pitch for web bottom navigation
  useEffect(() => {
    const handleScroll = () => {
      if (!videoScrollRef.current || filteredPitches.length === 0) return;
      
      const scrollContainer = videoScrollRef.current;
      const containerTop = scrollContainer.scrollTop;
      const containerHeight = scrollContainer.clientHeight;
      const centerY = containerTop + containerHeight / 2;
      
      // Find which pitch is closest to center
      let closestPitch = null;
      let closestDistance = Infinity;
      
      filteredPitches.forEach((pitch, index) => {
        const pitchTop = index * containerHeight;
        const pitchCenter = pitchTop + containerHeight / 2;
        const distance = Math.abs(centerY - pitchCenter);
        
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPitch = pitch;
        }
      });
      
      if (closestPitch && closestPitch.id !== currentVisiblePitch?.id) {
        setCurrentVisiblePitch(closestPitch);
      }
    };
    
    const scrollContainer = videoScrollRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      // Set initial pitch
      if (filteredPitches.length > 0 && !currentVisiblePitch) {
        setCurrentVisiblePitch(filteredPitches[0]);
      }
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, [filteredPitches, currentVisiblePitch]);

  // Keep the desktop theater player pointed at a pitch that's still in the
  // current (possibly filtered/searched) list, defaulting to the first one.
  useEffect(() => {
    if (filteredPitches.length === 0) {
      if (desktopActivePitchId !== null) setDesktopActivePitchId(null);
      return;
    }
    if (!filteredPitches.some(p => p.id === desktopActivePitchId)) {
      setDesktopActivePitchId(filteredPitches[0].id);
    }
  }, [filteredPitches, desktopActivePitchId]);

  const handleCreatePitch = async (pitchData) => {
    try {
      if (!currentUser) {
        alert('Please login to create a pitch');
        return;
      }

      if (!currentBusinessProfile) {
        alert('Please select or create a business profile first');
        return;
      }

      // Check if business profile documents are complete AND saved to database
      try {
        const sb = getSupabase();
        if (sb) {
          try {
            const { data: docs, error } = await sb
              .from('business_documents')
              .select('*')
              .eq('business_profile_id', currentBusinessProfile.id)
              .single();

            if (!error && docs) {
              // Check if all required fields are filled AND saved
              const allDocumentsComplete = 
                docs.business_plan_content?.trim() &&
                docs.financial_projection_content?.trim() &&
                docs.value_proposition_wants?.trim() &&
                docs.value_proposition_fears?.trim() &&
                docs.value_proposition_needs?.trim() &&
                docs.mou_content?.trim() &&
                docs.share_allocation_shares &&
                docs.share_allocation_share_price;

              // Also check that documents are marked as completed
              const allMarkedComplete = 
                docs.business_plan_completed &&
                docs.financial_projection_completed &&
                docs.value_proposition_completed &&
                docs.mou_completed &&
                docs.share_allocation_completed &&
                docs.all_documents_completed === true;

              if (!allDocumentsComplete) {
                alert('❌ All pitch documents must be filled in before publishing.\n\nPlease complete:\n• Business Plan\n• Financial Projection\n• Value Proposition (Wants, Fears, Needs)\n• Memorandum of Understanding\n• Share Allocation\n\nThen click "Save Documents" to save your changes.');
                return;
              }

              if (!allMarkedComplete) {
                alert('❌ All documents must be saved and marked as complete.\n\nPlease:\n1. Fill in all document fields\n2. Click "Save Documents" button\n3. Try publishing again');
                return;
              }
            } else if (error) {
              // Handle different error codes
              if (error.code === '404' || error.code === 'PGRST116' || error.message?.includes('No rows')) {
                console.warn('No documents saved for this business profile');
                alert('❌ Pitch documents have not been saved yet.\n\nPlease:\n1. Go to Business Profile → Documents\n2. Fill in all required fields\n3. Click "Save Documents"\n4. Then publish your pitch');
                return;
              } else if (error.code === '406' || error.message?.includes('406')) {
                // 406 error - server issue with RLS or connection
                console.warn('Server error (406) checking documents');
                alert('❌ Unable to verify documents due to a server issue.\n\nPlease ensure you have:\n1. Saved all documents to your Business Profile\n2. Marked them as complete\n3. Try again in a moment');
                return;
              } else {
                throw error;
              }
            }
          } catch (docError) {
            console.warn('Document check error:', docError?.message || docError);
            alert('❌ Please complete and save all pitch documents in your business profile before publishing.');
            return;
          }
        }
      } catch (docError) {
        console.warn('Document verification error:', docError?.message);
        // Continue in demo mode
      }

      // Map form data to database schema
      // Parse currency values (e.g., "$500K" -> 500000)
      const parseAmount = (str) => {
        if (typeof str !== 'string') return 0;
        const match = str.match(/[\d.]+/);
        if (!match) return 0;
        let num = parseFloat(match[0]);
        if (str.includes('K')) num *= 1000;
        if (str.includes('M')) num *= 1000000;
        return num;
      };

      // Parse percentage (e.g., "10%" -> 10)
      const parsePercent = (str) => {
        if (typeof str !== 'string') return 0;
        const match = str.match(/[\d.]+/);
        return match ? parseFloat(match[0]) : 0;
      };

      let videoUrl = null;

      // Upload video if provided
      if (pitchData.videoBlob) {
        console.log('Uploading video:', pitchData.videoBlob.size, 'bytes');
        try {
          // We need to create pitch first to get the ID for the upload path
          // So we'll upload video after creating pitch
        } catch (error) {
          console.error('Error preparing video upload:', error);
          // Continue without video
        }
      }

      // Map form fields to database schema
      const newPitch = {
        business_profile_id: currentBusinessProfile.id,
        title: pitchData.title || 'Untitled Pitch',
        description: pitchData.description || '',
        category: pitchData.category || 'Technology',
        pitch_type: pitchData.pitchType || 'Equity',
        target_funding: parseAmount(pitchData.goal),
        raised_amount: parseAmount(pitchData.raised),
        equity_offering: parsePercent(pitchData.equity),
        video_url: videoUrl,
        has_ip: pitchData.hasIP || false,
        status: 'published',
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        views_count: 0
      };

      console.log('Creating pitch with mapped data:', newPitch);

      // Save pitch to database
      const result = await createPitch(newPitch);
      if (!result.success) {
        throw new Error(result.error || 'Failed to create pitch');
      }

      // Get the newly created pitch
      const newPitchData = result.data;
      console.log('Pitch created successfully:', newPitchData);

      // Upload video after pitch creation if provided
      if (pitchData.videoBlob && newPitchData?.id) {
        console.log('📤 Uploading video for pitch:', newPitchData.id);
        console.log('   Video blob size:', pitchData.videoBlob.size, 'bytes');
        console.log('   Video blob type:', pitchData.videoBlob.type);
        try {
          const uploadResult = await uploadVideo(pitchData.videoBlob, newPitchData.id);
          console.log('📤 Upload result:', JSON.stringify(uploadResult, null, 2));
          
          if (uploadResult.success && uploadResult.url) {
            console.log('✅ Video uploaded successfully:', uploadResult.url);
            // Update pitch with video URL
            const updateResult = await updatePitch(newPitchData.id, { video_url: uploadResult.url });
            console.log('📝 Pitch update result:', JSON.stringify(updateResult, null, 2));
            
            if (!updateResult.success) {
              console.error('❌ Failed to update pitch with video URL:', updateResult.error);
              alert('Warning: Video uploaded but failed to link to pitch. Please try refreshing.');
            } else {
              console.log('✅ Pitch successfully updated with video URL');
            }
          } else {
            // Upload failed - show error and delete the pitch
            console.error('❌ Video upload failed:', uploadResult.error);
            console.error('   Deleting pitch because video is required');
            // Delete the pitch since it has no video
            await deletePitch(newPitchData.id);
            setShowRecorder(false);
            alert(`❌ Video upload failed: ${uploadResult.error}\n\nThe pitch has been deleted. Please try again after fixing the video upload issue.`);
            return;
          }
        } catch (error) {
          console.error('❌ Unexpected error uploading video:', error);
          console.error('   Deleting pitch because video upload failed');
          // Delete the pitch since video upload failed
          await deletePitch(newPitchData.id);
          setShowRecorder(false);
          alert(`❌ Video upload failed: ${error.message}\n\nThe pitch has been deleted. Please try again.`);
          return;
        }
      } else if (pitchData.videoBlob && !newPitchData?.id) {
        console.error('❌ Pitch created but no ID returned - cannot upload video');
        alert('❌ Error creating pitch - please try again');
        return;
      } else {
        console.log('⚠️ No video blob provided - pitch created without video');
      }

      // Reload pitches
      const allPitches = await getAllPitches();
      setPitches(allPitches);
      setFilteredPitches(allPitches);
      setShowRecorder(false);

      // Automatically open SmartContractGenerator for the creator to set up agreement
      // Wait a moment for state to update, then open the contract generator
      setTimeout(() => {
        setSelectedForContract(newPitchData || {
          id: newPitchData?.id,
          title: newPitchData?.title,
          pitch_type: newPitchData?.pitch_type,
          description: newPitchData?.description
        });
      }, 500);
    } catch (error) {
      console.error('Error creating pitch:', error);
      alert('Failed to create pitch: ' + error.message);
    }
  };

  const handleLike = async (pitchId) => {
    try {
      if (!currentUser) {
        alert('Please sign in to like pitches');
        return;
      }

      const alreadyLiked = likedPitches.has(pitchId);
      const pitch = pitches.find(p => p.id === pitchId);
      
      if (!pitch) return;
      
      if (alreadyLiked) {
        // Unlike
        const result = await unlikePitchDb(pitchId, currentUser.id);
        if (result.success) {
          const newLiked = new Set(likedPitches);
          newLiked.delete(pitchId);
          setLikedPitches(newLiked);
          
          const newLikesCount = result.data?.likes_count ?? Math.max(0, (pitch.likes_count || 1) - 1);
          const updatedPitches = pitches.map(p =>
            p.id === pitchId ? { ...p, likes_count: newLikesCount } : p
          );
          setPitches(updatedPitches);
          setFilteredPitches(updatedPitches);
        }
      } else {
        // Like
        const result = await likePitchDb(pitchId, currentUser.id, currentUser.email);
        if (result.success) {
          const newLiked = new Set(likedPitches);
          newLiked.add(pitchId);
          setLikedPitches(newLiked);
          
          const newLikesCount = result.data?.likes_count ?? (pitch.likes_count || 0) + 1;
          const updatedPitches = pitches.map(p =>
            p.id === pitchId ? { ...p, likes_count: newLikesCount } : p
          );
          setPitches(updatedPitches);
          setFilteredPitches(updatedPitches);
        } else {
          // Fallback: manually increment if no result
          const newLiked = new Set(likedPitches);
          newLiked.add(pitchId);
          setLikedPitches(newLiked);
          const updatedPitches = pitches.map(p =>
            p.id === pitchId ? { ...p, likes_count: (p.likes_count || 0) + 1 } : p
          );
          setPitches(updatedPitches);
          setFilteredPitches(updatedPitches);
        }
      }
    } catch (error) {
      console.error('Error liking pitch:', error);
    }
  };

  const handleShare = async (pitchId) => {
    try {
      const pitch = pitches.find(p => p.id === pitchId);
      // The canonical domain, not window.location.origin -- a link opened
      // from a dev/preview origin would be dead for whoever receives it.
      // main.jsx resolves this exact path to PublicPitchViewer, which opens
      // the video directly with no login required to just watch it.
      const shareUrl = `https://icanera.space/pitchin/${pitchId}`;
      const shareData = {
        title: pitch?.title || 'Check out this pitch!',
        text: pitch?.description || 'Discover this amazing investment opportunity on IcanEra',
        url: shareUrl
      };

      let platform = 'link';
      
      // Try native share first (mobile)
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        platform = 'native';
      } else {
        // Fallback: Copy to clipboard
        await navigator.clipboard.writeText(shareUrl);
        setCopiedPitchId(pitchId);
        setTimeout(() => setCopiedPitchId(null), 2000);
        platform = 'clipboard';
      }
      
      // Record share in database with user tracking
      const result = await recordShare(pitchId, currentUser?.id || null, platform);
      const newSharesCount = result.success && result.data ? result.data.shares_count : (pitch?.shares_count || 0) + 1;
      const updatedPitches = pitches.map(p =>
        p.id === pitchId ? { ...p, shares_count: newSharesCount } : p
      );
      setPitches(updatedPitches);
      setFilteredPitches(updatedPitches);
    } catch (error) {
      console.error('Error sharing pitch:', error);
    }
  };

  const handleOpenComments = async (pitchId) => {
    setShowComments(pitchId);
    // Load comments from database
    if (!comments[pitchId]) {
      try {
        const pitchComments = await getPitchComments(pitchId);
        setComments(prev => ({ ...prev, [pitchId]: pitchComments }));
      } catch (error) {
        console.error('Error loading comments:', error);
        setComments(prev => ({ ...prev, [pitchId]: [] }));
      }
    }
  };

  const handleAddComment = async (pitchId) => {
    if (!newComment.trim()) return;
    if (!currentUser) {
      alert('Please sign in to comment');
      return;
    }

    try {
      const userName = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Anonymous';
      const result = await addPitchComment(pitchId, currentUser.id, userName, newComment.trim());

      if (result.success) {
        // Add to local state. avatar_url isn't returned by the insert (it lives
        // on `profiles`, not `pitch_comments`) -- fill it in from the auth
        // metadata now for an immediate photo, same as getPitchComments does
        // from the `profiles` table on the next real fetch.
        const newCommentObj = {
          ...result.data,
          avatar_url: currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || null,
        };
        setComments(prev => ({
          ...prev,
          [pitchId]: [newCommentObj, ...(prev[pitchId] || [])]
        }));

        // Update comment count
        const updatedPitches = pitches.map(p =>
          p.id === pitchId ? { ...p, comments_count: (p.comments_count || 0) + 1 } : p
        );
        setPitches(updatedPitches);
        setFilteredPitches(updatedPitches);

        setNewComment('');
      }
    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Failed to add comment');
    }
  };

  const handleDeletePitch = async (pitch) => {
    if (!confirm(`Delete pitch "${pitch.title}"? This cannot be undone.`)) {
      return;
    }

    try {
      const result = await deletePitch(pitch.id);
      if (result.success) {
        // Remove from pitches list
        const updatedPitches = pitches.filter(p => p.id !== pitch.id);
        setPitches(updatedPitches);
        setFilteredPitches(updatedPitches);
        console.log('✅ Pitch deleted successfully');
      } else {
        alert('Error deleting pitch: ' + result.error);
      }
    } catch (error) {
      console.error('Error deleting pitch:', error);
      alert('Error deleting pitch');
    }
  };

  // Toggle video sound on/off
  const toggleVideoSound = (pitchId) => {
    const videoEl = videoRefs.current[pitchId];
    if (videoEl) {
      const isCurrentlyMuted = videoEl.muted;
      
      // Mute all other videos first
      Object.keys(videoRefs.current).forEach(id => {
        if (id !== pitchId && videoRefs.current[id]) {
          videoRefs.current[id].muted = true;
        }
      });
      
      // Toggle the clicked video
      videoEl.muted = !isCurrentlyMuted;
      
      // Update state for UI
      setMutedVideos(prev => {
        const newSet = new Set();
        if (!isCurrentlyMuted) {
          // Video is now muted, remove from unmuted set
          return newSet;
        } else {
          // Video is now unmuted, add to set
          newSet.add(pitchId);
          return newSet;
        }
      });
    }
  };

  // "More Pitches" sidebar thumbnails autoplay (muted) only while actually
  // scrolled into view within the sidebar itself — not the whole page — so a
  // long list doesn't try to stream every video at once. One IntersectionObserver
  // per thumbnail, torn down when the element unmounts (ref called with null).
  // The returned callback is cached per pitchId so unrelated re-renders (live
  // like counts, etc.) don't tear down and recreate the observer each time.
  const attachSidebarVideoObserver = (pitchId) => {
    if (sideVideoRefCallbacks.current[pitchId]) return sideVideoRefCallbacks.current[pitchId];
    const key = `side-${pitchId}`;
    const callback = (el) => {
      if (el) {
        videoRefs.current[key] = el;
        if (!sideVideoObservers.current[key]) {
          const observer = new IntersectionObserver(
            ([entry]) => {
              if (entry.isIntersecting) {
                el.play().catch(() => {});
              } else {
                el.pause();
              }
            },
            { root: desktopSidebarRef.current, threshold: 0.6 }
          );
          observer.observe(el);
          sideVideoObservers.current[key] = observer;
        }
      } else if (sideVideoObservers.current[key]) {
        sideVideoObservers.current[key].disconnect();
        delete sideVideoObservers.current[key];
        delete videoRefs.current[key];
      }
    };
    sideVideoRefCallbacks.current[pitchId] = callback;
    return callback;
  };

  // A video entering a stall (start of load, seek, or a mid-playback rebuffer)
  // shows the diamond loader over it; leaving one clears it. Used as the
  // onLoadStart/onWaiting vs onCanPlay/onPlaying pair on every pitch <video>.
  const markVideoBuffering = (pitchId) => {
    setBufferingPitches(prev => (prev.has(pitchId) ? prev : new Set(prev).add(pitchId)));
  };
  const clearVideoBuffering = (pitchId) => {
    setBufferingPitches(prev => {
      if (!prev.has(pitchId)) return prev;
      const next = new Set(prev);
      next.delete(pitchId);
      return next;
    });
  };

  // Downloads carry the same burned-in IcanEra mark as playback, since the
  // watermark is baked into the video's pixels at upload time (see
  // PitchVideoRecorder + utils/videoWatermark) rather than overlaid live.
  const handleDownloadVideo = async (pitch) => {
    if (!pitch?.video_url || downloadingPitchId === pitch.id) return;
    setDownloadingPitchId(pitch.id);
    try {
      const safeTitle = (pitch.title || 'IcanEra-Pitch').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'IcanEra-Pitch';
      const downloadUrl = await resolveDownloadUrl(pitch.video_url, `${safeTitle}.webm`);
      if (!downloadUrl) {
        alert('Could not prepare this video for download right now. Please try again.');
        return;
      }
      window.open(downloadUrl, '_blank', 'noopener');
    } catch (error) {
      console.error('Error downloading video:', error);
      alert('Could not download this video right now. Please try again.');
    } finally {
      setDownloadingPitchId(null);
    }
  };

  const handleVideoError = (pitchId, event) => {
    clearVideoBuffering(pitchId);
    console.error(`❌ Video failed to load for pitch ${pitchId}`);
    const errorCode = event?.target?.error?.code;
    const errorMessage = event?.target?.error?.message || 'Unknown error';
    
    console.error('   Error code:', errorCode);
    console.error('   Error message:', errorMessage);
    console.error('');
    
    // Handle QUIC protocol errors (ERR_QUIC_PROTOCOL_ERROR)
    if (errorMessage?.includes('QUIC') || errorCode === 4) {
      console.error('   🌐 QUIC PROTOCOL ERROR DETECTED');
      console.error('   Attempting HTTP/1.1 fallback...');
      
      // Retry with HTTP/1.1 by fetching a fresh signed URL
      const retryWithHTTP11 = async () => {
        try {
          const { getSupabase } = await import('../services/pitchingService');
          const sb = getSupabase();
          if (!sb) return;
          
          // Try to reload the video element or notify user
          console.log('   Retrying video load with HTTP/1.1 protocol...');
          // Reload the same URL (browser may auto-upgrade to HTTP/1.1)
          event.target.load();
        } catch (err) {
          console.error('   Failed to retry:', err);
          setVideoErrors(prev => ({
            ...prev,
            [pitchId]: true
          }));
        }
      };
      
      // Retry after brief delay
      setTimeout(retryWithHTTP11, 500);
      return;
    }
    
    console.error('   📊 VIDEO ERROR DIAGNOSTICS:');
    console.error('   1️⃣  RLS Policy Issue (most likely):');
    console.error('      → Go to Supabase Dashboard');
    console.error('      → Storage → pitches bucket → Policies tab');
    console.error('      → Ensure "Anyone can view pitch videos" policy is ENABLED (green checkmark)');
    console.error('   2️⃣  WebM Format Issue:');
    console.error('      → Some browsers don\'t support WebM');
    console.error('      → Try converting videos to MP4 format');
    console.error('   3️⃣  CORS Issue:');
    console.error('      → Check browser Network tab for 403/CORS errors');
    console.error('      → Supabase CORS may need configuration');
    console.error('   4️⃣  Invalid URL:');
    console.error('      → Video URL:', event?.target?.src);
    
    setVideoErrors({
      ...videoErrors,
      [pitchId]: true
    });
  };

  const handleVideoLoadedMetadata = (pitchId, event) => {
    // Detect video orientation based on dimensions
    const video = event.target;
    const width = video.videoWidth;
    const height = video.videoHeight;
    const isPortrait = height > width;
    
    setVideoOrientations(prev => ({
      ...prev,
      [pitchId]: isPortrait ? 'portrait' : 'landscape'
    }));
    
    console.log(`📹 Video loaded - ${pitchId}: ${width}x${height} (${isPortrait ? 'PORTRAIT' : 'LANDSCAPE'})`);
  };

  const handleCreatePitchClick = () => {
    if (!currentUser) {
      alert('Please login to create a pitch');
      return;
    }
    if (!currentBusinessProfile) {
      if (businessProfiles.length > 0) {
        setShowProfileSelector(true);
      } else {
        openNewBusinessProfile();
      }
      return;
    }
    setShowRecorder(true);
  };

  // When opening a business profile's pitches (viewingPitcher), check whether
  // the current user already has an investment agreement against it, so the
  // banner below can offer a direct "View My Investment Progress" link --
  // previously the only way to reach InvestmentProgressView was re-clicking
  // Invest, which silently redirected instead of being a real entry point.
  useEffect(() => {
    let cancelled = false;
    const checkOwnAgreement = async () => {
      if (!viewingPitcher?.business_profile_id || !currentUser?.id) {
        setViewingPitcherOwnAgreement(null);
        return;
      }
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from('investment_agreements')
          .select('id, status, pitch_id, business_profile_id, total_investment, shares_amount, approval_deadline')
          .eq('business_profile_id', viewingPitcher.business_profile_id)
          .eq('investor_id', currentUser.id)
          .order('created_at', { ascending: false })
          .limit(1);
        if (!cancelled) setViewingPitcherOwnAgreement(data?.[0] || null);
      } catch (err) {
        console.warn('[Pitchin] Could not check for an existing agreement on this business profile:', err?.message);
        if (!cancelled) setViewingPitcherOwnAgreement(null);
      }
    };
    checkOwnAgreement();
    return () => { cancelled = true; };
  }, [viewingPitcher?.business_profile_id, currentUser?.id]);

  // When the Business Details modal opens (Pitcher icon tap), fetch the
  // business owner's real profile photo/name from `profiles` -- getAllPitches
  // already embeds owner_avatar_url/owner_full_name on business_profiles, so
  // this only runs as a fallback when that enrichment didn't happen (e.g. a
  // pitch that came from a fetch path other than getAllPitches).
  useEffect(() => {
    let cancelled = false;
    const biz = businessDetailsPitch?.business_profiles;
    if (biz && (biz.owner_avatar_url || biz.owner_full_name)) {
      setBusinessOwnerProfile({ avatar_url: biz.owner_avatar_url, full_name: biz.owner_full_name });
      return;
    }
    const ownerId = biz?.user_id || businessDetailsPitch?.user_id;
    if (!ownerId) {
      setBusinessOwnerProfile(null);
      return;
    }
    const loadOwnerProfile = async () => {
      try {
        const supabase = getSupabase();
        // profiles RLS is "auth.uid() = id" -- a plain select only returns the
        // caller's own row, so a non-owner viewer would get nothing back here.
        // fn_get_public_profile_info is SECURITY DEFINER and exposes only
        // id/full_name/avatar_url (backend/PITCHIN_PUBLIC_PROFILE_INFO_RPC.sql).
        const { data } = await supabase
          .rpc('fn_get_public_profile_info', { p_user_ids: [ownerId] });
        const owner = data?.[0] || null;
        // avatar_url can be an r2:// key that needs a live presigned URL.
        if (owner?.avatar_url) owner.avatar_url = await resolveMediaValue(owner.avatar_url);
        if (!cancelled) setBusinessOwnerProfile(owner);
      } catch (err) {
        console.warn('[Pitchin] Could not load business owner profile:', err?.message);
        if (!cancelled) setBusinessOwnerProfile(null);
      }
    };
    loadOwnerProfile();
    return () => { cancelled = true; };
  }, [businessDetailsPitch?.business_profiles?.user_id, businessDetailsPitch?.user_id]);

  // Live shares/value for the Business Details modal -- same getLiveShareOffer
  // the Invest flow prices against, so the modal never shows a stale listed
  // number. `available: false` cases are surfaced via LIVE_OFFER_BLOCKED_MESSAGE
  // instead of silently falling back to pitch.target_funding/equity_offering.
  useEffect(() => {
    let cancelled = false;
    const businessProfileId = businessDetailsPitch?.business_profile_id || businessDetailsPitch?.business_profiles?.id;
    const businessOwnerUserId = businessDetailsPitch?.business_profiles?.user_id || businessDetailsPitch?.user_id;
    if (!businessProfileId) {
      setBusinessLiveOffer(null);
      setBusinessLiveOfferLoading(false);
      return;
    }
    setBusinessLiveOfferLoading(true);
    setBusinessLiveOffer(null);
    getLiveShareOffer(businessProfileId, businessOwnerUserId)
      .then((offer) => { if (!cancelled) setBusinessLiveOffer(offer); })
      .catch((err) => {
        console.warn('[Pitchin] Live share offer failed for business details modal:', err?.message);
        if (!cancelled) setBusinessLiveOffer({ available: false, reason: 'default' });
      })
      .finally(() => { if (!cancelled) setBusinessLiveOfferLoading(false); });
    return () => { cancelled = true; };
  }, [businessDetailsPitch?.business_profile_id, businessDetailsPitch?.business_profiles?.id, businessDetailsPitch?.business_profiles?.user_id, businessDetailsPitch?.user_id]);

  const handleSmartContractClick = async (pitch) => {
    if (!currentUser) {
      alert('Please login to invest');
      return;
    }

    // Smart routing: if this investor already submitted an investment for
    // this pitch that's still awaiting shareholder approval (or just got
    // sealed), don't reopen the full multi-stage signing flow -- show their
    // approval progress instead.
    try {
      const supabase = getSupabase();
      const { data: existingAgreements } = await supabase
        .from('investment_agreements')
        .select('id, status, business_profile_id, total_investment, shares_amount')
        .eq('pitch_id', pitch.id)
        .eq('investor_id', currentUser.id)
        .in('status', ['signing', 'sealed'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (existingAgreements && existingAgreements.length > 0) {
        setSelectedForProgress({ pitch, agreement: existingAgreements[0] });
        return;
      }
    } catch (checkError) {
      console.warn('[Pitchin] Could not check for an existing investment agreement, proceeding to new investment flow:', checkError?.message);
    }

    // 📝 NOTE: Removed business profile requirement for investors
    // Investors can now invest without having a business profile

    // Record investment interest in database
    try {
      const result = await recordInvestmentInterest(pitch.id, currentUser.id);
      if (result.success) {
        // Update local state to track interest
        const newInvested = new Set(investedPitches);
        newInvested.add(pitch.id);
        setInvestedPitches(newInvested);
        
        // Update invests count in pitches
        const newInvestsCount = result.data?.invests_count || (pitch.invests_count || 0) + 1;
        const updatedPitches = pitches.map(p =>
          p.id === pitch.id ? { ...p, invests_count: newInvestsCount } : p
        );
        setPitches(updatedPitches);
        setFilteredPitches(updatedPitches);
      }
    } catch (error) {
      console.error('Error recording investment interest:', error);
    }
    
    // Price and size the investment from the live ICAN valuation only. The
    // pitches.share_price / shares_available columns are seeded once and never
    // recomputed, so they are deliberately NOT used as a fallback — without a
    // live price and a live share count the pitch simply isn't investable yet.
    const businessProfileId = pitch.business_profile_id || pitch.business_profiles?.id;
    const businessOwnerUserId = pitch.business_profiles?.user_id || pitch.user_id;

    let offer;
    try {
      offer = await getLiveShareOffer(businessProfileId, businessOwnerUserId);
    } catch (valuationError) {
      console.warn('[Pitchin] Live share valuation failed:', valuationError.message);
      alert('Live share value is unavailable for this business right now. Please try again in a moment.');
      return;
    }

    if (!offer.available) {
      alert(LIVE_OFFER_BLOCKED_MESSAGE[offer.reason] || LIVE_OFFER_BLOCKED_MESSAGE.default);
      return;
    }
    if (offer.sharesAvailable <= 0) {
      alert(`All ${offer.totalShares.toLocaleString()} shares in this business are already taken. There are no shares left to buy.`);
      return;
    }

    const investmentPitch = {
      ...pitch,
      live_share_price_ugx: offer.sharePriceUgx,
      live_total_shares: offer.totalShares,
      live_shares_issued: offer.sharesIssued,
      live_shares_available: offer.sharesAvailable,
      live_business_value_ugx: offer.businessValueUgx,
      live_ican_market_price_ugx: offer.icanMarketPriceUgx,
      live_computed_at: offer.computedAt
    };

    // Use ShareSigningFlow for investment (businessProfile can be null for investors)
    console.log('🔍 INVEST BUTTON CLICKED - Pitch data being passed to ShareSigningFlow:');
    console.log('   User has business profile:', currentBusinessProfile ? 'YES' : 'NO');
    console.log('   pitch object keys:', Object.keys(pitch));
    console.log('   pitch.business_profile_id:', pitch.business_profile_id);
    console.log('   pitch.business_profiles (nested):', pitch.business_profiles);
    console.log('   Full pitch object:', pitch);
    setSelectedForInvestment(investmentPitch);
  };

  const handleBusinessProfileCreated = async (profile) => {
    try {
      const newProfile = {
        ...profile,
        user_id: currentUser.id
      };
      
      // First, set the profile immediately with any co-owners it has
      console.log('📌 Profile created/updated with business_co_owners:', profile?.business_co_owners?.length || 0);
      
      // Reload profiles from database (owned + co-owned) with a small delay to ensure DB is updated
      if (currentUser) {
        // Wait 500ms for database to fully commit the changes
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const updatedProfiles = await getAllAccessibleBusinessProfiles(currentUser.id, currentUser.email);
        setBusinessProfiles(updatedProfiles);
        
        // Find the profile we just created/updated and use it as current
        const currentProfileId = profile?.id;
        const refreshedProfile = updatedProfiles.find(p => p.id === currentProfileId);
        
        if (refreshedProfile) {
          console.log('🔄 Refreshed profile from DB with', refreshedProfile?.business_co_owners?.length || 0, 'co-owners');
          setCurrentBusinessProfile(refreshedProfile);
        } else if (updatedProfiles.length > 0) {
          console.log('⚠️ Could not find refreshed profile by ID, using first profile');
          setCurrentBusinessProfile(updatedProfiles[0]);
        }
      }
      
      // Clear editing state and close form
      setEditingProfile(null);
      setShowBusinessForm(false);
      
      // Create notification
      await createNotification({
        recipient_id: currentUser.id,
        notification_type: 'profile_created',
        title: 'Business Profile Updated',
        message: `Your business profile has been saved successfully.`
      });
    } catch (error) {
      console.error('Error saving business profile:', error);
    }
  };

  const handleSelectBusinessProfile = (profile) => {
    setCurrentBusinessProfile(profile);
    setShowProfileSelector(false);
  };

  const handleDeleteBusinessProfile = async (profileId) => {
    try {
      await deleteProfileService(profileId);
      if (currentBusinessProfile?.id === profileId) {
        setCurrentBusinessProfile(null);
      }
      setBusinessProfiles(businessProfiles.filter(p => p.id !== profileId));
    } catch (error) {
      console.error('Error deleting business profile:', error);
    }
  };

  const formatCurrency = (amount) => {
    if (!amount) return '$0';
    return `$${(amount / 1000).toFixed(0)}K`;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'recently';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  // Full-screen "vitrine" shown while the feed loads — one gem under a
  // spotlight instead of a wall of bouncing icons. See injectPitchinStageStyles.
  const renderPitchinLoadingStage = (fixed = false) => {
    injectPitchinStageStyles();
    return (
      <div className={`${fixed ? 'fixed' : 'absolute'} inset-0 z-[60] bg-[#07060b] flex items-center justify-center overflow-hidden`}>
        {/* Ground: obsidian with a soft warm spotlight from above, a faint
            violet undertone at the base — no cartoon gradient blobs. */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_32%,rgba(212,175,120,0.14),transparent_70%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_70%_at_50%_130%,rgba(88,28,135,0.22),transparent_60%)]" />
        </div>

        {/* Hairline vitrine corners, like a fine jewelry case */}
        <div className="absolute inset-8 sm:inset-12 pointer-events-none">
          <span className="absolute top-0 left-0 w-6 h-6 border-t border-l border-amber-200/25" />
          <span className="absolute top-0 right-0 w-6 h-6 border-t border-r border-amber-200/25" />
          <span className="absolute bottom-0 left-0 w-6 h-6 border-b border-l border-amber-200/25" />
          <span className="absolute bottom-0 right-0 w-6 h-6 border-b border-r border-amber-200/25" />
        </div>

        <div className="pitchin-stage-rise relative z-10 flex flex-col items-center px-6 text-center">
          <p className="text-[11px] tracking-[0.5em] text-amber-200/70 uppercase mb-2">IcanEra</p>
          <div className="w-10 h-px bg-gradient-to-r from-transparent via-amber-200/50 to-transparent mb-8" />

          <div className="relative inline-block">
            <div className="pitchin-stage-halo absolute -inset-6 rounded-full bg-purple-400/20 blur-2xl -z-10" />
            <DiamondLoader size={132} />
          </div>

          <div className="mt-8 h-5 relative w-72 max-w-[80vw] overflow-hidden">
            {PITCHIN_LOADING_CAPTIONS.map((caption, i) => (
              <span
                key={caption}
                className="pitchin-stage-caption absolute inset-0 text-sm text-white/60 font-light tracking-wide"
                style={{
                  animationDuration: `${PITCHIN_CAPTION_LOOP_SECONDS}s`,
                  animationDelay: `${i * (PITCHIN_CAPTION_LOOP_SECONDS / PITCHIN_LOADING_CAPTIONS.length)}s`,
                }}
              >
                {caption}
              </span>
            ))}
          </div>

          <div className="mt-6 w-40 h-px bg-white/10 overflow-hidden rounded-full relative">
            <div className="pitchin-stage-bar absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-amber-200/80 to-transparent" />
          </div>
        </div>
      </div>
    );
  };

  // Empty feed — a quiet, intentional moment rather than a bare "no data"
  // notice, in the same gallery language as the loading stage above.
  const renderPitchinEmptyStage = () => (
    <div className="relative w-full h-full min-h-[420px] flex flex-col items-center justify-center text-center px-8 py-16">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_38%,rgba(212,175,120,0.08),transparent_70%)] pointer-events-none" />
      <div className="relative w-16 h-16 mb-6 rounded-full border border-amber-200/25 flex items-center justify-center">
        <Gem className="w-6 h-6 text-amber-200/70" />
      </div>
      <p className="text-white/80 text-base font-light tracking-wide mb-1.5">The stage is quiet, for now</p>
      <p className="text-white/40 text-sm max-w-xs mb-6">No pitches to show yet. Be the first to bring an idea to the floor.</p>
      <button
        onClick={handleCreatePitchClick}
        className="icon-btn-transparent px-5 py-2 rounded-full border border-amber-200/40 text-amber-100 text-sm tracking-wide hover:bg-amber-200/10 transition-colors"
      >
        Record Your Pitch
      </button>
    </div>
  );

  // Desktop "theater" layout — a large player with a channel/action row and
  // description underneath, plus a clickable "More Pitches" sidebar, the way
  // YouTube works on a computer. The old approach reused the mobile
  // full-bleed-vertical-video-with-floating-icons treatment at desktop sizes,
  // which produced a very tall card whose overlaid icon column spread out
  // across mostly-empty letterboxing instead of sitting near the video.
  // Only ever used for the desktop view — mobile keeps its own dedicated
  // TikTok-style snap-scroll feed below.
  const renderDesktopPitchFeed = () => {
    const activePitch = filteredPitches.find(p => p.id === desktopActivePitchId) || filteredPitches[0] || null;

    const pillButtonClass = 'icon-btn-transparent flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors';

    return (
      <div className="h-[calc(100vh-10.5rem)] w-full px-4 sm:px-6 lg:px-8 pb-6">
        {loading ? (
          <div className="relative h-full w-full rounded-2xl overflow-hidden">
            {renderPitchinLoadingStage(false)}
          </div>
        ) : filteredPitches.length === 0 || !activePitch ? (
          renderPitchinEmptyStage()
        ) : (
          <div className="h-full w-full flex gap-6">
            {/* Theater column — a wide player that actually fills the available
                width (cropped to fill via object-cover, not letterboxed in a
                narrow portrait box), with the channel/action/description panel
                underneath it. */}
            <div className="flex-1 min-w-0 h-full overflow-y-auto pr-1">
              <div
                className="relative w-full bg-black rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.45)] border border-white/10"
                style={{ height: 'min(70vh, 760px)' }}
              >
                {!activePitch.video_url || videoErrors[activePitch.id] ? (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-600 to-pink-600">
                      <AlertCircle className="w-12 h-12 text-white/70" />
                    </div>
                  ) : (
                    <video
                      key={activePitch.id}
                      ref={el => { if (el) videoRefs.current[activePitch.id] = el; }}
                      src={activePitch.video_url}
                      className="w-full h-full object-cover bg-black"
                      crossOrigin="anonymous"
                      autoPlay
                      muted
                      loop
                      playsInline
                      onError={(event) => handleVideoError(activePitch.id, event)}
                      onLoadedMetadata={(event) => handleVideoLoadedMetadata(activePitch.id, event)}
                      onLoadStart={() => markVideoBuffering(activePitch.id)}
                      onWaiting={() => markVideoBuffering(activePitch.id)}
                      onPlaying={() => clearVideoBuffering(activePitch.id)}
                      onCanPlay={() => clearVideoBuffering(activePitch.id)}
                    />
                  )}
                  {bufferingPitches.has(activePitch.id) && !videoErrors[activePitch.id] && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none bg-black/20">
                      <DiamondLoader size={56} />
                    </div>
                  )}
                  <button
                    onClick={() => toggleVideoSound(activePitch.id)}
                    className="icon-btn-transparent group absolute inset-0 flex items-center justify-center"
                  >
                    <div className="px-4 py-2 rounded-full bg-black/40 backdrop-blur-sm flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {mutedVideos.has(activePitch.id) ? (
                        <>
                          <span className="text-lg">🔊</span>
                          <span className="text-white text-sm font-semibold">Sound ON</span>
                        </>
                      ) : (
                        <>
                          <span className="text-lg">🔇</span>
                          <span className="text-white text-sm font-semibold">Tap for sound</span>
                        </>
                      )}
                    </div>
                  </button>
                </div>

                <div className="mt-4">
                  <h2 className="text-white text-xl font-bold leading-snug">{activePitch.title}</h2>
                  <p className="text-slate-500 text-xs mt-1">
                    {activePitch.category || 'Pitch'} · {formatDate(activePitch.created_at)}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <button
                      onClick={() => setBusinessDetailsPitch(activePitch)}
                      className="icon-btn-transparent flex items-center gap-3 group"
                      title="View business details"
                    >
                      {(activePitch.business_profiles?.avatar_url || activePitch.business_profiles?.owner_avatar_url) ? (
                        <img
                          src={activePitch.business_profiles.avatar_url || activePitch.business_profiles.owner_avatar_url}
                          alt={activePitch.business_profiles?.business_name || 'Pitcher'}
                          className="w-10 h-10 rounded-full object-cover border border-white/20"
                          onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                        />
                      ) : null}
                      <div
                        className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-orange-400 items-center justify-center text-white font-bold text-sm border border-white/20"
                        style={{ display: (activePitch.business_profiles?.avatar_url || activePitch.business_profiles?.owner_avatar_url) ? 'none' : 'flex' }}
                      >
                        {(activePitch.business_profiles?.business_name || activePitch.business_profiles?.name || 'P').charAt(0).toUpperCase()}
                      </div>
                      <div className="text-left">
                        <p className="text-white text-sm font-semibold group-hover:text-pink-400 transition-colors">
                          {activePitch.business_profiles?.business_name || 'Business'}
                        </p>
                        <p className="text-slate-500 text-xs">View business</p>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => handleLike(activePitch.id)} className={pillButtonClass} title="Like">
                        <Heart className={`w-4 h-4 ${likedPitches.has(activePitch.id) ? 'text-red-500 fill-red-500' : 'text-white'}`} />
                        <span className="text-white text-xs font-semibold">{activePitch.likes_count || 0}</span>
                      </button>
                      <button onClick={() => handleOpenComments(activePitch.id)} className={pillButtonClass} title="Comment">
                        <MessageCircle className="w-4 h-4 text-white" />
                        <span className="text-white text-xs font-semibold">{activePitch.comments_count || 0}</span>
                      </button>
                      <button onClick={() => handleShare(activePitch.id)} className={pillButtonClass} title="Share">
                        {copiedPitchId === activePitch.id ? (
                          <>
                            <Check className="w-4 h-4 text-green-400" />
                            <span className="text-green-300 text-xs font-semibold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Share2 className="w-4 h-4 text-white" />
                            <span className="text-white text-xs font-semibold">{activePitch.shares_count || 0}</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleDownloadVideo(activePitch)}
                        disabled={downloadingPitchId === activePitch.id}
                        className={pillButtonClass}
                        title="Download"
                      >
                        {downloadingPitchId === activePitch.id ? (
                          <DiamondLoader size={16} />
                        ) : (
                          <Download className="w-4 h-4 text-white" />
                        )}
                      </button>
                      {storefrontsByBusiness.has(activePitch.business_profile_id) && (
                        <button
                          onClick={() => { window.location.href = `/store/${activePitch.business_profile_id}`; }}
                          className="icon-btn-transparent flex items-center gap-1.5 px-3 py-2 rounded-full bg-emerald-500/90 hover:bg-emerald-500 transition-colors"
                          title="Buy Now"
                        >
                          <ShoppingBag className="w-4 h-4 text-white" />
                          <span className="text-white text-xs font-semibold">Buy Now</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleSmartContractClick(activePitch)}
                        className="icon-btn-transparent flex items-center gap-1.5 px-4 py-2 rounded-full bg-pink-500 hover:bg-pink-600 transition-colors"
                        title="Invest"
                      >
                        <Briefcase className={`w-4 h-4 ${investedPitches.has(activePitch.id) ? 'text-green-300' : 'text-white'}`} />
                        <span className="text-white text-xs font-semibold">Invest · {activePitch.invests_count || 0}</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-white/10">
                      <div className="text-center">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">Raised</p>
                        <p className="text-sm font-bold text-white">{formatCurrency(activePitch.raised_amount)}</p>
                      </div>
                      <div className="text-center border-x border-white/10">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">Goal</p>
                        <p className="text-sm font-bold text-white">{formatCurrency(activePitch.target_funding)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">Equity</p>
                        <p className="text-sm font-bold text-white">{activePitch.equity_offering || 0}%</p>
                      </div>
                    </div>
                    <p className="text-slate-300 text-sm whitespace-pre-wrap">
                      {activePitch.description || 'No description provided.'}
                    </p>
                  </div>
                </div>
            </div>

            {/* "More Pitches" sidebar — click to switch the theater player.
                Thumbnails autoplay muted, but only the ones actually scrolled
                into view (see attachSidebarVideoObserver), so a long list
                doesn't try to stream every pitch's video at once. */}
            <div ref={desktopSidebarRef} className="hidden xl:flex flex-col w-[340px] flex-shrink-0 h-full overflow-y-auto">
              <p className="text-white/50 text-xs font-semibold tracking-widest uppercase mb-3 px-1">More Pitches</p>
              <div className="flex flex-col gap-1.5">
                {filteredPitches.map((pitch) => {
                  const isActive = pitch.id === activePitch.id;
                  const sideKey = `side-${pitch.id}`;
                  const canPreview = !isActive && pitch.video_url && !videoErrors[sideKey];
                  return (
                    <button
                      key={pitch.id}
                      onClick={() => setDesktopActivePitchId(pitch.id)}
                      className={`icon-btn-transparent flex items-center gap-3 p-2 rounded-xl text-left transition-colors ${
                        isActive ? 'bg-white/10 ring-1 ring-pink-500/60' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="relative w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-purple-600 to-pink-600">
                        {canPreview ? (
                          <video
                            ref={attachSidebarVideoObserver(pitch.id)}
                            src={pitch.video_url}
                            className="absolute inset-0 w-full h-full object-cover"
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            onError={(event) => handleVideoError(sideKey, event)}
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Play className="w-5 h-5 text-white/70" />
                          </div>
                        )}
                        {isActive && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                            <span className="text-[9px] text-pink-300 font-bold uppercase tracking-wide">Now Playing</span>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium line-clamp-2">{pitch.title}</p>
                        <p className="text-slate-500 text-xs mt-0.5 truncate">{pitch.business_profiles?.business_name || 'Business'}</p>
                        <p className="text-slate-600 text-[11px] mt-0.5">{pitch.likes_count || 0} likes</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
      {/* Demo Mode Banner */}
      {!supabaseReady && (
        <div className="bg-amber-500/20 border-b border-amber-500/50 text-amber-200 px-6 py-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">
              <strong>Demo Mode:</strong> Supabase not configured. Using sample data. 
              <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="underline ml-2">
                Configure Supabase →
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Show Recording Page OR Feed */}
      {showRecorder ? (
        // Recording Page - No header, full focus on recording.
        // Portaled straight to document.body: Pitchin can be mounted deep inside
        // other layouts (e.g. MobileView's panel, which is deliberately shorter
        // than 100vh and clips overflow), and this div's own `overflow-hidden`
        // ancestor above would otherwise clip the recorder's bottom control bar
        // (Back/Upload/⋮/Next) — which is exactly what was hiding the upload icon.
        createPortal(
          <div className="fixed inset-0 z-[9999] w-screen h-screen bg-gradient-to-br from-slate-900 via-purple-900/30 to-slate-900 overflow-hidden">
            <PitchVideoRecorder
              onPitchCreated={handleCreatePitch}
              onClose={() => {
                setShowRecorder(false);
                setCurrentPitch(null);
                if (onClosePitchCreator) onClosePitchCreator();
              }}
              currentBusinessProfile={currentBusinessProfile}
              businessProfiles={businessProfiles}
              onSelectProfile={(profile) => {
                setCurrentBusinessProfile(profile);
                setShowProfileSelector(false);
              }}
              onShowProfileSelector={() => setShowProfileSelector(true)}
            />
          </div>,
          document.body
        )
      ) : (
        // Feed Page - With header and navigation
        <>
      {/* Single-row Header */}
      <div className="sticky top-0 z-40 bg-transparent">
        <div className="px-4 py-3 flex items-center gap-3">

          {/* Left - "For You" tab (replaces Pitchin branding) */}
          <button
            onClick={() => { setActiveTab('feed'); setSelectedCategory('all'); }}
            className={`icon-btn-transparent text-sm font-bold whitespace-nowrap transition-colors ${
              activeTab === 'feed'
                ? 'text-white border-b-2 border-pink-500 pb-0.5'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            For You
          </button>

          {/* Center - Search */}
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <div className="hidden md:block flex-1 relative">
              <input
                type="text"
                placeholder="Search by title, category, or business..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value.trim()) setActiveTab('search');
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim()) setActiveTab('search');
                }}
                className="w-full px-0 py-1 bg-transparent border-0 border-b border-gray-600 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-gray-400 focus:ring-0"
              />
              <Search className="absolute right-0 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>

            <div className="md:hidden w-full">
              {showMobileSearch ? (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (e.target.value.trim()) setActiveTab('search');
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && searchQuery.trim()) setActiveTab('search');
                    }}
                    className="w-full pr-8 px-0 py-1 bg-transparent border-0 border-b border-gray-600 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-gray-400 focus:ring-0"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMobileSearch(false)}
                    className="icon-btn-transparent absolute right-0 top-1/2 transform -translate-y-1/2 text-slate-400"
                    aria-label="Close search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowMobileSearch(true)}
                    className="icon-btn-transparent p-1 text-slate-300 hover:text-white transition-colors"
                    aria-label="Open search"
                  >
                    <Search className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>

            {/* Category + sort filters — only when searching */}
            {searchQuery.trim() && (
              <>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="px-1 py-1 bg-transparent border-0 border-b border-gray-600 text-sm text-white focus:outline-none focus:border-gray-400 focus:ring-0 appearance-none cursor-pointer"
                  style={{ backgroundColor: 'transparent', backgroundImage: 'none', color: 'white' }}
                >
                  <option value="all" style={{ backgroundColor: '#1e293b', color: 'white' }}>All</option>
                  <option value="Technology" style={{ backgroundColor: '#1e293b', color: 'white' }}>Technology</option>
                  <option value="Finance" style={{ backgroundColor: '#1e293b', color: 'white' }}>Finance</option>
                  <option value="Healthcare" style={{ backgroundColor: '#1e293b', color: 'white' }}>Healthcare</option>
                  <option value="E-commerce" style={{ backgroundColor: '#1e293b', color: 'white' }}>E-commerce</option>
                  <option value="Education" style={{ backgroundColor: '#1e293b', color: 'white' }}>Education</option>
                  <option value="Real Estate" style={{ backgroundColor: '#1e293b', color: 'white' }}>Real Estate</option>
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-1 py-1 bg-transparent border-0 border-b border-gray-600 text-sm text-white focus:outline-none focus:border-gray-400 focus:ring-0 appearance-none cursor-pointer"
                  style={{ backgroundColor: 'transparent', backgroundImage: 'none', color: 'white' }}
                >
                  <option value="relevance" style={{ backgroundColor: '#1e293b', color: 'white' }}>Relevance</option>
                  <option value="trending" style={{ backgroundColor: '#1e293b', color: 'white' }}>Trending</option>
                  <option value="funding-high" style={{ backgroundColor: '#1e293b', color: 'white' }}>Funding ↓</option>
                  <option value="funding-low" style={{ backgroundColor: '#1e293b', color: 'white' }}>Funding ↑</option>
                  <option value="equity-high" style={{ backgroundColor: '#1e293b', color: 'white' }}>Equity ↓</option>
                  <option value="equity-low" style={{ backgroundColor: '#1e293b', color: 'white' }}>Equity ↑</option>
                </select>
              </>
            )}
          </div>

          {/* Right - My Pitches + Profile */}
          <div className="flex items-center gap-4 min-w-max">
            <button
              onClick={() => { setActiveTab('myPitches'); setSelectedCategory('all'); }}
              className={`icon-btn-transparent text-sm font-semibold whitespace-nowrap transition-colors ${
                activeTab === 'myPitches'
                  ? 'text-white border-b-2 border-purple-500 pb-0.5'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              My Pitches
            </button>

            {/* Current User avatar — shows logged-in user's initials */}
            <button
              onClick={() => setShowProfileSelector(true)}
              title="My Profile / Switch Business"
              className="icon-btn-transparent flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              {currentUser ? (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {(currentUser.user_metadata?.full_name || currentUser.email || 'U').charAt(0).toUpperCase()}
                </div>
              ) : (
                <Building2 className="w-5 h-5 text-gray-400" />
              )}
            </button>
          </div>
        </div>

        {/* Advanced Filters Row - Funding & Equity Range */}
        {searchQuery.trim() && activeTab === 'search' && (
          <div className="px-4 py-2 flex items-center gap-4 border-t border-gray-700/30 text-sm">
            <span className="text-slate-500 text-xs">Filters:</span>
            
            {/* Funding Range */}
            <div className="flex items-center gap-2">
              <label className="text-slate-400 text-xs whitespace-nowrap">Funding:</label>
              <input
                type="number"
                min="0"
                max="10000000"
                value={minFunding}
                onChange={(e) => setMinFunding(e.target.value)}
                placeholder="Min"
                className="w-16 px-1 py-0.5 bg-transparent border-0 border-b border-gray-600 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-gray-400"
              />
              <span className="text-slate-500">-</span>
              <input
                type="number"
                min="0"
                max="10000000"
                value={maxFunding}
                onChange={(e) => setMaxFunding(e.target.value)}
                placeholder="Max"
                className="w-16 px-1 py-0.5 bg-transparent border-0 border-b border-gray-600 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-gray-400"
              />
            </div>

            {/* Equity Range */}
            <div className="flex items-center gap-2">
              <label className="text-slate-400 text-xs whitespace-nowrap">Equity:</label>
              <input
                type="number"
                min="0"
                max="100"
                value={minEquity}
                onChange={(e) => setMinEquity(e.target.value)}
                placeholder="Min"
                className="w-12 px-1 py-0.5 bg-transparent border-0 border-b border-gray-600 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-gray-400"
              />
              <span className="text-slate-500">-</span>
              <input
                type="number"
                min="0"
                max="100"
                value={maxEquity}
                onChange={(e) => setMaxEquity(e.target.value)}
                placeholder="Max"
                className="w-12 px-1 py-0.5 bg-transparent border-0 border-b border-gray-600 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-gray-400"
              />
              <span className="text-slate-400 text-xs">%</span>
            </div>

            {/* Reset Filters */}
            <button
              onClick={() => {
                setMinFunding('0');
                setMaxFunding('10000000');
                setMinEquity('0');
                setMaxEquity('100');
                setHasIPOnly(false);
                setSortBy('relevance');
              }}
              className="ml-auto text-slate-500 hover:text-slate-300 text-xs underline"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {/* Viewing Pitcher Banner — shown when user tapped a pitcher's avatar */}
      {viewingPitcher && (
        <div className="sticky top-0 z-39 flex items-center gap-3 px-4 py-2 bg-black/60 backdrop-blur-sm border-b border-white/10">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-500 to-orange-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {(viewingPitcher.name || 'P').charAt(0).toUpperCase()}
          </div>
          <span className="text-white text-xs font-semibold flex-1 truncate">{viewingPitcher.name}'s Pitches</span>
          {viewingPitcherOwnAgreement && (
            <button
              onClick={() => {
                const matchingPitch = pitches.find((p) => p.id === viewingPitcherOwnAgreement.pitch_id);
                setSelectedForProgress({ pitch: matchingPitch || { id: viewingPitcherOwnAgreement.pitch_id }, agreement: viewingPitcherOwnAgreement });
              }}
              className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/20 border border-blue-400/40 text-blue-200 hover:bg-blue-500/30 transition-colors flex-shrink-0"
            >
              📊 My Investment
            </button>
          )}
          <button
            onClick={() => setViewingPitcher(null)}
            className="text-slate-400 hover:text-white text-xs font-medium transition-colors flex items-center gap-1"
          >
            ← Back to Feed
          </button>
        </div>
      )}

      {/* Business Profile Section - Minimal Collapsed View - HIDDEN */}
      {/* Now accessible via overlay icon in video feed */}
      {/* 
      {currentUser && currentBusinessProfile && (
        <div className="border-t border-slate-700 bg-slate-900/50">
          <div className="max-w-7xl mx-auto px-4 py-3">
            {!showProfileDetails ? (
              // Ultra-compact view - just company name
              <button
                onClick={() => setShowProfileDetails(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800 transition"
              >
                <Building2 className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-white truncate">
                  {currentBusinessProfile.name}
                </span>
              </button>
            ) : (
              // Expanded view - show full details
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-blue-400" />
                    Business Profile
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={openNewBusinessProfile}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition"
                    >
                      <Plus className="w-4 h-4" />
                      New Profile
                    </button>
                    <button
                      onClick={() => setShowProfileDetails(false)}
                      className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg font-medium transition"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                
                {currentBusinessProfile ? (
                  <div className="grid grid-cols-1 gap-4">
                     <BusinessProfileCard
                       profile={currentBusinessProfile}
                      onEdit={() => setShowProfileSelector(true)}
                      onSelect={() => {}}
                       onShareValue={(profile) => {
                        setCurrentBusinessProfile(profile);
                         setShowShareValuePanel(true);
                       }}
                       onWalletClick={(profile) => {
                         setCurrentBusinessProfile(profile);
                         setShowWallet(true);
                       }}
                      isMember={true}
                      currentUserId={currentUser?.id}
                      currentUserEmail={currentUser?.email}
                      onNotification={() => console.log('Member notification clicked')}
                    />
                    {businessProfiles.length > 1 && (
                      <button
                        onClick={() => setShowProfileSelector(true)}
                        className="bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-blue-500 rounded-xl p-5 transition flex items-center justify-center text-slate-300 hover:text-blue-400"
                      >
                        <div className="text-center">
                          <p className="font-semibold mb-1">Switch Profile</p>
                          <p className="text-sm">{businessProfiles.length - 1} more profile{businessProfiles.length - 1 !== 1 ? 's' : ''}</p>
                        </div>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="bg-slate-800 border border-dashed border-slate-600 rounded-xl p-8 text-center">
                    <Building2 className="w-12 h-12 text-slate-500 mx-auto mb-3 opacity-50" />
                    <p className="text-slate-400 mb-4">No business profile yet</p>
                    <button
                      onClick={() => setShowBusinessForm(true)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition"
                    >
                      Create First Profile
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      */}

      {/* Main Content — Feed Page (the recorder branch is handled above via portal) */}
      {!showRecorder && (
        <div className={isDesktopView ? "w-full" : "fixed inset-0 w-screen h-screen bg-gradient-to-br from-slate-900 via-purple-900/30 to-slate-900 overflow-hidden"}>
            {isDesktopView ? renderDesktopPitchFeed() : (
              <>
                {/* Pitch Feed - Full-Screen TikTok-Style with Snap Scroll */}
                <div className="h-full w-full flex items-center justify-center">
                  <div className="relative w-full h-full overflow-y-auto snap-y snap-mandatory scroll-smooth" ref={videoScrollRef}>
              {loading ? (
                renderPitchinLoadingStage(true)
              ) : filteredPitches.length === 0 ? (
                renderPitchinEmptyStage()
              ) : (
                filteredPitches.map((pitch) => (
                  <div
                    key={pitch.id}
                    className="relative w-full h-full min-h-screen snap-start bg-black"
                  >
                    {/* Full-Screen Video Background */}
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-purple-600 to-pink-600">
                      {!pitch.video_url || videoErrors[pitch.id] ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <AlertCircle className="w-12 h-12 text-slate-500" />
                        </div>
                      ) : (
                        <video
                          ref={el => { if (el) videoRefs.current[pitch.id] = el; }}
                          src={pitch.video_url}
                          className="w-full h-full object-cover"
                          crossOrigin="anonymous"
                          autoPlay
                          muted
                          loop
                          playsInline
                          onError={(event) => handleVideoError(pitch.id, event)}
                          onLoadedMetadata={(event) => handleVideoLoadedMetadata(pitch.id, event)}
                          onLoadStart={() => markVideoBuffering(pitch.id)}
                          onWaiting={() => markVideoBuffering(pitch.id)}
                          onPlaying={() => clearVideoBuffering(pitch.id)}
                          onCanPlay={() => clearVideoBuffering(pitch.id)}
                        />
                      )}
                      {bufferingPitches.has(pitch.id) && !videoErrors[pitch.id] && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none bg-black/20">
                          <DiamondLoader size={52} />
                        </div>
                      )}
                    </div>

                    {/* Overlay Container - All UI on top of video */}
                    <div className="absolute inset-0 z-20 pointer-events-none">
                      {/* Tap to toggle sound - center - Transparent */}
                      <button
                        onClick={() => toggleVideoSound(pitch.id)}
                        className="icon-btn-transparent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                      >
                        <div className="px-4 py-2 rounded-full bg-transparent flex items-center gap-2 transition-all">
                          {mutedVideos.has(pitch.id) ? (
                            <>
                              <span className="text-2xl drop-shadow-lg">🔊</span>
                              <span className="text-white text-sm font-semibold drop-shadow-lg">Sound ON</span>
                            </>
                          ) : (
                            <>
                              <span className="text-2xl drop-shadow-lg">🔇</span>
                              <span className="text-white text-sm font-semibold drop-shadow-lg">Tap for sound</span>
                            </>
                          )}
                        </div>
                      </button>

                      {/* Action Buttons - Vertical on right */}
                      <div className="absolute right-2 bottom-20 flex flex-col gap-2 pointer-events-auto">
                        {/* Like Button */}
                        <button
                          onClick={() => handleLike(pitch.id)}
                          className="icon-btn-transparent flex flex-col items-center gap-0.5"
                          title="Like"
                        >
                          <div className="w-9 h-9 flex items-center justify-center transition-all">
                            <Heart className={`w-4 h-4 drop-shadow-lg ${likedPitches.has(pitch.id) ? 'text-red-500 fill-red-500' : 'text-white'}`} />
                          </div>
                          <span className="text-white text-[9px] font-bold drop-shadow-lg">{pitch.likes_count || 0}</span>
                        </button>

                        {/* Comment Button */}
                        <button
                          onClick={() => handleOpenComments(pitch.id)}
                          className="icon-btn-transparent flex flex-col items-center gap-0.5"
                          title="Comment"
                        >
                          <div className="w-9 h-9 flex items-center justify-center transition-all">
                            <MessageCircle className="w-4 h-4 text-white drop-shadow-lg" />
                          </div>
                          <span className="text-white text-[9px] font-bold drop-shadow-lg">{pitch.comments_count || 0}</span>
                        </button>

                        {/* Share Button */}
                        <button
                          onClick={() => handleShare(pitch.id)}
                          className="icon-btn-transparent flex flex-col items-center gap-0.5"
                          title="Share"
                        >
                          <div className="w-9 h-9 flex items-center justify-center transition-all">
                            <Share2 className="w-4 h-4 text-white drop-shadow-lg" />
                          </div>
                          <span className="text-white text-[9px] font-bold drop-shadow-lg">{pitch.shares_count || 0}</span>
                        </button>

                        {/* Download Button — the file already carries the burned-in IcanEra mark */}
                        <button
                          onClick={() => handleDownloadVideo(pitch)}
                          disabled={downloadingPitchId === pitch.id}
                          className="icon-btn-transparent flex flex-col items-center gap-0.5"
                          title="Download"
                        >
                          <div className="w-9 h-9 flex items-center justify-center transition-all">
                            {downloadingPitchId === pitch.id ? (
                              <DiamondLoader size={18} />
                            ) : (
                              <Download className="w-4 h-4 text-white drop-shadow-lg" />
                            )}
                          </div>
                        </button>

                        {/* Invest Button */}
                        <button
                          onClick={() => handleSmartContractClick(pitch)}
                          className="icon-btn-transparent flex flex-col items-center gap-0.5"
                          title="Invest"
                        >
                          <div className="w-9 h-9 flex items-center justify-center transition-all">
                            <Briefcase className={`w-4 h-4 drop-shadow-lg ${
                              investedPitches.has(pitch.id) ? 'text-green-400' : 'text-white'
                            }`} />
                          </div>
                          <span className={`text-[9px] font-bold drop-shadow-lg ${
                            investedPitches.has(pitch.id) ? 'text-green-300' : 'text-white'
                          }`}>
                            {pitch.invests_count || 0}
                          </span>
                          <span className="text-white text-[7px] font-medium drop-shadow-lg">Invest</span>
                        </button>

                        {/* Create Button */}
                        <button
                          onClick={handleCreatePitchClick}
                          className="icon-btn-transparent flex flex-col items-center gap-0.5"
                          title="Create"
                        >
                          <div className="w-9 h-9 flex items-center justify-center transition-all">
                            <Plus className="w-4 h-4 text-pink-400 drop-shadow-lg" />
                          </div>
                          <span className="text-pink-300 text-[9px] font-bold drop-shadow-lg">Create</span>
                        </button>

                        {/* Pitcher Avatar — tap to view this business's details */}
                        <button
                          onClick={() => setBusinessDetailsPitch(pitch)}
                          className="icon-btn-transparent flex flex-col items-center gap-0.5"
                          title="View business details"
                        >
                          {(pitch.business_profiles?.avatar_url || pitch.business_profiles?.owner_avatar_url) ? (
                            <img
                              src={pitch.business_profiles.avatar_url || pitch.business_profiles.owner_avatar_url}
                              alt={pitch.business_profiles?.business_name || 'Pitcher'}
                              className="w-9 h-9 rounded-full object-cover border border-white/30 transition-all hover:scale-110"
                              onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                            />
                          ) : null}
                          <div
                            className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-orange-400 items-center justify-center text-white font-bold text-sm border border-white/30 transition-all hover:scale-110"
                            style={{ display: (pitch.business_profiles?.avatar_url || pitch.business_profiles?.owner_avatar_url) ? 'none' : 'flex' }}
                          >
                            {(pitch.business_profiles?.business_name || pitch.business_profiles?.name || 'P').charAt(0).toUpperCase()}
                          </div>
                          <span className="text-pink-300 text-[9px] font-bold drop-shadow-lg">Pitcher</span>
                        </button>
                      </div>

                      {/* Bottom Info - Removed to declutter video overlay */}
                    </div>
                  </div>
                ))
              )}
                  </div>
                </div>
              </>
            )}
        </div>
      )}

      {/* Bottom Action Bar - Web View Only - Hidden on Mobile */}
      {!showRecorder && !isDesktopView && filteredPitches.length > 0 && (currentVisiblePitch || filteredPitches[0]) && (
        <div className="hidden sm:block max-w-7xl mx-auto px-6 py-3">
            <div className="flex items-center justify-between">
              {/* Left - Pitch Info */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-white font-semibold text-sm truncate">
                    {(currentVisiblePitch || filteredPitches[0]).title}
                  </h3>
                  <p className="text-gray-400 text-xs truncate">
                    {(currentVisiblePitch || filteredPitches[0]).business_profiles?.business_name || 'Business'}
                  </p>
                </div>
              </div>

              {/* Center - Action Icons */}
              <div className="flex items-center gap-4 mx-6">
                {/* Like */}
                <button
                  onClick={() => handleLike((currentVisiblePitch || filteredPitches[0]).id)}
                  className="icon-btn-transparent flex flex-col items-center gap-1 group"
                  title="Like"
                >
                  <div className="w-12 h-12 flex items-center justify-center transition-all group-hover:scale-105">
                    <Heart className={`w-5 h-5 drop-shadow-lg ${
                      likedPitches.has((currentVisiblePitch || filteredPitches[0]).id)
                        ? 'text-red-500 fill-red-500'
                        : 'text-white'
                    }`} />
                  </div>
                  <span className="text-white text-xs font-semibold drop-shadow-lg">{(currentVisiblePitch || filteredPitches[0]).likes_count || 0}</span>
                </button>

                {/* Comment */}
                <button
                  onClick={() => handleOpenComments((currentVisiblePitch || filteredPitches[0]).id)}
                  className="icon-btn-transparent flex flex-col items-center gap-1 group"
                  title="Comment"
                >
                  <div className="w-12 h-12 flex items-center justify-center transition-all group-hover:scale-105">
                    <MessageCircle className="w-5 h-5 text-white drop-shadow-lg" />
                  </div>
                  <span className="text-white text-xs font-semibold drop-shadow-lg">{(currentVisiblePitch || filteredPitches[0]).comments_count || 0}</span>
                </button>

                {/* Share */}
                <button
                  onClick={() => handleShare((currentVisiblePitch || filteredPitches[0]).id)}
                  className="icon-btn-transparent flex flex-col items-center gap-1 group"
                  title="Share"
                >
                  <div className="w-12 h-12 flex items-center justify-center transition-all group-hover:scale-105">
                    <Share2 className="w-5 h-5 text-white drop-shadow-lg" />
                  </div>
                  <span className="text-white text-xs font-semibold drop-shadow-lg">{(currentVisiblePitch || filteredPitches[0]).shares_count || 0}</span>
                </button>

                {/* Invest */}
                <button
                  onClick={() => handleSmartContractClick((currentVisiblePitch || filteredPitches[0]))}
                  className="icon-btn-transparent flex flex-col items-center gap-1 group"
                  title="Invest"
                >
                  <div className="w-12 h-12 flex items-center justify-center transition-all group-hover:scale-105">
                    <Briefcase className={`w-5 h-5 ${
                      investedPitches.has((currentVisiblePitch || filteredPitches[0]).id) ? 'text-green-400' : 'text-white'
                    }`} />
                  </div>
                  <span className={`text-xs font-semibold ${
                    investedPitches.has((currentVisiblePitch || filteredPitches[0]).id) ? 'text-green-300' : 'text-white'
                  }`}>
                    {(currentVisiblePitch || filteredPitches[0]).invests_count || 0}
                  </span>
                  <span className="text-white text-[10px] font-medium">Invest</span>
                </button>
              </div>

              {/* Right - Create & Profile */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={handleCreatePitchClick}
                  className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-lg font-semibold transition flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create</span>
                </button>
                <button
                  onClick={() => setShowProfileSelector(true)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-semibold transition flex items-center gap-2"
                >
                  <Building2 className="w-4 h-4" />
                  <span>Profile</span>
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Smart Contract Modal */}
      {selectedForContract && (
        <SmartContractGenerator
          pitch={selectedForContract}
          onClose={() => setSelectedForContract(null)}
          businessProfile={currentBusinessProfile}
          currentUser={currentUser}
        />
      )}

      {/* Share Signing & Investment Flow Modal */}
      {selectedForInvestment && (
        <ShareSigningFlow
          pitch={selectedForInvestment}
          onClose={() => setSelectedForInvestment(null)}
          onInvestmentSubmitted={(payload) => {
            setSelectedForInvestment(null);
            setSelectedForProgress(payload);
          }}
          businessProfile={currentBusinessProfile}
          currentUser={currentUser}
        />
      )}

      {/* Investment Progress Modal - shown instead of ShareSigningFlow when
          the investor already has a submitted agreement for this pitch */}
      {selectedForProgress && (
        <InvestmentProgressView
          pitch={selectedForProgress.pitch}
          agreement={selectedForProgress.agreement}
          currentUser={currentUser}
          onClose={() => setSelectedForProgress(null)}
        />
      )}

      {/* Business Profile Form Modal */}
      {showBusinessForm && (
        <BusinessProfileForm
          onProfileCreated={handleBusinessProfileCreated}
          onCancel={() => {
            setShowBusinessForm(false);
            setEditingProfile(null);
          }}
          userId={currentUser?.id}
          editingProfile={editingProfile}
          initialBusinessCategory={selectedBusinessCategory}
        />
      )}

      {showBusinessCategorySelector && (
        <BusinessCategorySelector
          onSelect={handleBusinessCategorySelected}
          onCancel={() => setShowBusinessCategorySelector(false)}
        />
      )}

      {/* Business Profile Selector Modal */}
      {showProfileSelector && (
        <BusinessProfileSelector
          profiles={businessProfiles}
          currentProfile={currentBusinessProfile}
          currentUserId={currentUser?.id}
          currentUserEmail={currentUser?.email}
          onSelectProfile={handleSelectBusinessProfile}
          onCreateNew={openNewBusinessProfile}
          onEdit={async (profile) => {
            const permission = await checkBusinessProfileEditPermission(
              profile.id, 
              currentUser?.id, 
              currentUser?.email
            );
            
            if (!permission.canEdit) {
              alert(`⚠️ Cannot edit: ${permission.reason}`);
              return;
            }
            
            setEditingProfile(profile);
            setShowProfileSelector(false);
            setShowBusinessForm(true);
          }}
          onDelete={handleDeleteBusinessProfile}
           onWalletClick={(profile) => {
             setShowProfileSelector(false);
             const selectedProfile = businessProfiles.find(item => item.id === profile?.profileId) || profile;
             setCurrentBusinessProfile(selectedProfile);
             setShowWallet(true);
           }}
        />
      )}

      {/* Comments Modal */}
      {showComments && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-blue-400" />
                Comments
              </h3>
              <button
                onClick={() => setShowComments(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {(!comments[showComments] || comments[showComments]?.length === 0) ? (
                <div className="text-center py-8">
                  <MessageCircle className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">No comments yet</p>
                  <p className="text-slate-500 text-sm">Be the first to comment!</p>
                </div>
              ) : (
                (comments[showComments] || []).map((comment) => (
                  <div key={comment.id} className="bg-slate-700/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      {comment.avatar_url ? (
                        <img
                          src={comment.avatar_url}
                          alt={comment.user_name || comment.user?.name || 'Commenter'}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                        />
                      ) : null}
                      <div
                        className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ display: comment.avatar_url ? 'none' : 'flex' }}
                      >
                        {(comment.user_name || comment.user?.name || 'U')[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="text-white font-medium text-sm">{comment.user_name || comment.user?.name || 'Anonymous'}</p>
                        <p className="text-slate-500 text-xs">
                          {new Date(comment.created_at || comment.timestamp).toLocaleDateString()} at{' '}
                          {new Date(comment.created_at || comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <p className="text-slate-300 text-sm pl-10">{comment.comment_text || comment.text}</p>
                  </div>
                ))
              )}
            </div>

            {/* Comment Input */}
            <div className="p-4 border-t border-slate-700">
              {currentUser ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddComment(showComments)}
                    placeholder="Write a comment..."
                    className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-slate-400"
                  />
                  <button
                    onClick={() => handleAddComment(showComments)}
                    disabled={!newComment.trim()}
                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white p-2 rounded-lg transition"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <p className="text-center text-slate-400 text-sm">
                  Please sign in to comment
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Pitch Detail Modal - Shows SHAREHub-style UI */}
      {showMobilePitchDetail && selectedMobilePitch && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 bg-slate-900/95 border-b border-slate-700">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-2xl">🎥</span>
              Pitch Details
            </h2>
            <button
              onClick={() => {
                setShowMobilePitchDetail(false);
                setSelectedMobilePitch(null);
              }}
              className="p-1 rounded-lg hover:bg-slate-800 transition text-slate-400 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content - Full screen scroll */}
          <div className="flex-1 overflow-y-auto">
            {/* Pitch Content Goes Here */}
          </div>
        </div>
      )}

      {/* Smart Contract Modal */}
      {selectedForContract && (
        <SmartContractGenerator
          pitch={selectedForContract}
          onClose={() => setSelectedForContract(null)}
          businessProfile={currentBusinessProfile}
          currentUser={currentUser}
        />
      )}

      {/* Share Signing & Investment Flow Modal */}
      {selectedForInvestment && (
        <ShareSigningFlow
          pitch={selectedForInvestment}
          onClose={() => setSelectedForInvestment(null)}
          onInvestmentSubmitted={(payload) => {
            setSelectedForInvestment(null);
            setSelectedForProgress(payload);
          }}
          businessProfile={currentBusinessProfile}
          currentUser={currentUser}
        />
      )}

      {/* Investment Progress Modal - shown instead of ShareSigningFlow when
          the investor already has a submitted agreement for this pitch */}
      {selectedForProgress && (
        <InvestmentProgressView
          pitch={selectedForProgress.pitch}
          agreement={selectedForProgress.agreement}
          currentUser={currentUser}
          onClose={() => setSelectedForProgress(null)}
        />
      )}

      {/* Business Profile Form Modal */}
      {showBusinessForm && (
        <BusinessProfileForm
          onProfileCreated={handleBusinessProfileCreated}
          onCancel={() => {
            setShowBusinessForm(false);
            setEditingProfile(null);
          }}
          userId={currentUser?.id}
          editingProfile={editingProfile}
          initialBusinessCategory={selectedBusinessCategory}
        />
      )}

      {showBusinessCategorySelector && (
        <BusinessCategorySelector
          onSelect={handleBusinessCategorySelected}
          onCancel={() => setShowBusinessCategorySelector(false)}
        />
      )}

      {/* Business Profile Selector Modal */}
      {showProfileSelector && (
        <BusinessProfileSelector
          profiles={businessProfiles}
          currentProfile={currentBusinessProfile}
          currentUserId={currentUser?.id}
          currentUserEmail={currentUser?.email}
          onSelectProfile={handleSelectBusinessProfile}
          onCreateNew={openNewBusinessProfile}
          onEdit={async (profile) => {
            const permission = await checkBusinessProfileEditPermission(
              profile.id,
              currentUser?.id,
              currentUser?.email
            );
            if (!permission.canEdit) {
              alert(`⚠️ Cannot edit: ${permission.reason}`);
              return;
            }
            setEditingProfile(profile);
            setShowProfileSelector(false);
            setShowBusinessForm(true);
          }}
          onDelete={handleDeleteBusinessProfile}
           onWalletClick={(profile) => {
             setShowProfileSelector(false);
             const selectedProfile = businessProfiles.find(item => item.id === profile?.profileId) || profile;
             setCurrentBusinessProfile(selectedProfile);
             setShowWallet(true);
           }}
          onShareValueClick={(profile) => {
            setCurrentBusinessProfile(profile);
            setShowProfileSelector(false);
            setShowShareValuePanel(true);
          }}
        />
      )}

      {/* Live Share Value Panel — only shown to business owners, only in PitchIn */}
      {showWallet && currentBusinessProfile && (
        <BusinessWalletModal
          profile={currentBusinessProfile}
          onClose={() => setShowWallet(false)}
        />
      )}

      {/* Live Share Value Panel — only shown to business owners, only in PitchIn */}
      {showShareValuePanel && currentBusinessProfile && currentUser && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-6 lg:p-10">
          <div className="w-full sm:w-[92vw] sm:max-w-lg md:max-w-2xl lg:max-w-4xl xl:max-w-6xl 2xl:max-w-[1600px] max-h-[92vh] sm:max-h-[90vh] lg:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-slate-950 border border-slate-700/60 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-4 sm:px-6 sm:py-4 border-b border-slate-700/40 sticky top-0 bg-slate-950 z-10">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white">{currentBusinessProfile.name}</h2>
                <p className="text-xs sm:text-sm text-slate-400">Live share valuation · tamper-evident hash</p>
              </div>
              <button
                onClick={() => setShowShareValuePanel(false)}
                className="p-2.5 -m-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Live share value widget */}
            <div className="p-4 sm:p-6">
              <PitchinLiveShareValue
                businessProfile={currentBusinessProfile}
                ownerUserId={currentBusinessProfile.user_id || currentUser.id}
                readOnly={currentBusinessProfile.user_id !== currentUser.id}
              />
            </div>
          </div>
        </div>
      )}

      {/* Comments Modal */}
      {showComments && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-blue-400" />
                Comments
              </h3>
              <button
                onClick={() => setShowComments(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {(!comments[showComments] || comments[showComments]?.length === 0) ? (
                <div className="text-center py-8">
                  <MessageCircle className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">No comments yet</p>
                  <p className="text-slate-500 text-sm">Be the first to comment!</p>
                </div>
              ) : (
                (comments[showComments] || []).map((comment) => (
                  <div key={comment.id} className="bg-slate-700/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      {comment.avatar_url ? (
                        <img
                          src={comment.avatar_url}
                          alt={comment.user_name || comment.user?.name || 'Commenter'}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                        />
                      ) : null}
                      <div
                        className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ display: comment.avatar_url ? 'none' : 'flex' }}
                      >
                        {(comment.user_name || comment.user?.name || 'U')[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="text-white font-medium text-sm">{comment.user_name || comment.user?.name || 'Anonymous'}</p>
                        <p className="text-slate-500 text-xs">
                          {new Date(comment.created_at || comment.timestamp).toLocaleDateString()} at{' '}
                          {new Date(comment.created_at || comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <p className="text-slate-300 text-sm pl-10">{comment.comment_text || comment.text}</p>
                  </div>
                ))
              )}
            </div>

            {/* Comment Input */}
            <div className="p-4 border-t border-slate-700">
              {currentUser ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddComment(showComments)}
                    placeholder="Write a comment..."
                    className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-slate-400"
                  />
                  <button
                    onClick={() => handleAddComment(showComments)}
                    disabled={!newComment.trim()}
                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white p-2 rounded-lg transition"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <p className="text-center text-slate-400 text-sm">
                  Please sign in to comment
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Pitch Detail Modal - Shows Full Web Pitchin UI */}
      {showMobilePitchDetail && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex flex-col">
          {/* Header with Close Button */}
          <div className="sticky top-0 z-30 bg-gradient-to-r from-purple-900/95 to-pink-900/95 p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Share2 className="w-6 h-6 text-pink-400" />
                <span className="text-xl font-bold text-white">Pitchin</span>
              </div>
              <p className="text-xs text-purple-200">Share your vision, connect with investors</p>
            </div>
            <button
              onClick={() => {
                setShowMobilePitchDetail(false);
                setSelectedMobilePitch(null);
              }}
              className="p-2 rounded-lg hover:bg-slate-800 transition text-slate-400 hover:text-white flex-shrink-0"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Tab Filters - Sticky */}
          <div className="sticky top-[72px] z-10 bg-slate-900/50 border-b border-slate-700 px-4 py-3 flex gap-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab('feed')}
              className={`flex-shrink-0 px-4 py-2 rounded-full font-semibold transition whitespace-nowrap ${
                activeTab === 'feed'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              🎥 Available
            </button>
            <button
              onClick={() => setActiveTab('myPitches')}
              className={`flex-shrink-0 px-4 py-2 rounded-full font-semibold transition whitespace-nowrap ${
                activeTab === 'myPitches'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              🎬 My Pitches
            </button>
            <button
              onClick={() => setActiveTab('interested')}
              className={`flex-shrink-0 px-4 py-2 rounded-full font-semibold transition whitespace-nowrap ${
                activeTab === 'interested'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              🗳️ Pending Votes
            </button>
          </div>

          {/* Content - Pitch Grid */}
          <div className="flex-1 overflow-y-auto p-4 pb-20 sm:pb-12">
            <div className="grid grid-cols-1 gap-4">
              {loading ? (
                <>
                  {[...Array(3)].map((_, idx) => (
                    <div key={idx} className="bg-slate-800/60 rounded-lg overflow-hidden animate-pulse">
                      <div className="aspect-video bg-gradient-to-r from-slate-700 to-slate-800"></div>
                      <div className="p-4 space-y-2">
                        <div className="h-4 bg-gradient-to-r from-slate-700 to-slate-800 rounded w-3/4"></div>
                        <div className="h-3 bg-gradient-to-r from-slate-700 to-slate-800 rounded w-1/2"></div>
                      </div>
                    </div>
                  ))}
                </>
              ) : filteredPitches.length === 0 ? (
                <div className="col-span-full text-center py-8">
                  <Zap className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                  <p className="text-slate-400">No pitches available</p>
                </div>
              ) : (
                filteredPitches.map((pitch) => (
                  <div
                    key={pitch.id}
                    className="bg-slate-800/60 backdrop-blur border border-slate-700 hover:border-pink-500/50 rounded-lg overflow-hidden hover:shadow-2xl hover:shadow-purple-500/30 transition-all group"
                  >
                    {/* Thumbnail - Auto-playing Preview */}
                    <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
                      {!pitch.video_url || videoErrors[pitch.id] ? (
                        <AlertCircle className="w-8 h-8 text-slate-500" />
                      ) : (
                        <>
                          <video
                            ref={el => { if (el) videoRefs.current[`grid-${pitch.id}`] = el; }}
                            src={pitch.video_url}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            crossOrigin="anonymous"
                            autoPlay
                            muted
                            loop
                            playsInline
                            onError={(event) => handleVideoError(pitch.id, event)}
                          />
                          {/* Tap to toggle sound button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const videoEl = videoRefs.current[`grid-${pitch.id}`];
                              if (videoEl) {
                                // Mute all other grid videos first
                                Object.keys(videoRefs.current).forEach(id => {
                                  if (id !== `grid-${pitch.id}` && videoRefs.current[id]) {
                                    videoRefs.current[id].muted = true;
                                  }
                                });
                                videoEl.muted = !videoEl.muted;
                                setMutedVideos(prev => {
                                  const newSet = new Set(prev);
                                  if (videoEl.muted) {
                                    newSet.delete(`grid-${pitch.id}`);
                                  } else {
                                    newSet.add(`grid-${pitch.id}`);
                                  }
                                  return newSet;
                                });
                              }
                            }}
                            className="absolute inset-0 flex items-center justify-center"
                          >
                            {/* Sound indicator badge */}
                            <div className={`absolute top-2 left-2 px-2 py-1 rounded-full backdrop-blur-sm flex items-center gap-1 transition-all ${
                              mutedVideos.has(`grid-${pitch.id}`) 
                                ? 'bg-green-500/80' 
                                : 'bg-black/60'
                            }`}>
                              <span className="text-white text-xs">
                                {mutedVideos.has(`grid-${pitch.id}`) ? '🔊' : '🔇'}
                              </span>
                            </div>
                            {/* Center tap hint - only show when muted */}
                            {!mutedVideos.has(`grid-${pitch.id}`) && (
                              <div className="px-3 py-2 rounded-full bg-black/70 backdrop-blur-sm flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                                <span className="text-lg">🔊</span>
                                <span className="text-white text-xs font-medium">Tap for sound</span>
                              </div>
                            )}
                          </button>
                        </>
                      )}
                      {pitch.has_ip && (
                        <div className="absolute top-2 right-2 bg-blue-500/30 text-blue-300 px-2 py-1 rounded text-xs font-semibold">
                          IP ✓
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-4">
                      <h3 className="text-base font-bold text-white mb-1 line-clamp-2 group-hover:text-pink-400 transition">
                        {pitch.title}
                      </h3>
                      
                      {/* Status Indicator for Mobile */}
                      <div className="mb-2">
                        {pitch.status === 'published' ? (
                          <span className="bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full text-xs font-semibold border border-green-400/30">
                            ✓ Published
                          </span>
                        ) : pitch.status === 'draft' ? (
                          <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full text-xs font-semibold border border-orange-400/30">
                            📝 Draft
                          </span>
                        ) : pitch.status === 'pending' ? (
                          <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full text-xs font-semibold border border-blue-400/30">
                            ⏳ Pending
                          </span>
                        ) : (
                          <span className="bg-gray-500/20 text-gray-300 px-2 py-0.5 rounded-full text-xs font-semibold border border-gray-400/30">
                            📹 Uploaded
                          </span>
                        )}
                      </div>
                      
                      <p className="text-sm text-gray-400 mb-3">
                        {pitch.business_profiles?.business_name || 'Unknown'}
                      </p>
                      <p className="text-xs text-slate-400 mb-3 line-clamp-2">
                        {pitch.description}
                      </p>

                      {/* Funding Info */}
                      <div className="grid grid-cols-3 gap-2 bg-white/5 p-2 rounded mb-3">
                        <div className="text-center">
                          <p className="text-xs text-slate-400">Raised</p>
                          <p className="text-xs font-bold text-white">{formatCurrency(pitch.raised_amount)}</p>
                        </div>
                        <div className="text-center border-x border-white/10">
                          <p className="text-xs text-slate-400">Goal</p>
                          <p className="text-xs font-bold text-white">{formatCurrency(pitch.target_funding)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-slate-400">Equity</p>
                          <p className="text-xs font-bold text-white">{pitch.equity_offering || 0}%</p>
                        </div>
                      </div>

                      {/* Action Buttons with Icons and Live Counts */}
                      <div className="flex gap-2">
                        {/* Like Button */}
                        <button
                          onClick={() => handleLike(pitch.id)}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                            likedPitches.has(pitch.id)
                              ? 'bg-red-500/40 hover:bg-red-500/50 text-red-300'
                              : 'bg-slate-700/50 hover:bg-red-500/30 text-slate-300'
                          }`}
                          title="Like"
                        >
                          <Heart className={`w-4 h-4 ${likedPitches.has(pitch.id) ? 'fill-current' : ''}`} />
                          <span>{pitch.likes_count || 0}</span>
                        </button>

                        {/* Comment Button */}
                        <button
                          onClick={() => handleOpenComments(pitch.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 bg-slate-700/50 hover:bg-blue-500/30 text-slate-300 rounded-lg text-xs font-medium transition-all"
                          title="Comment"
                        >
                          <MessageCircle className="w-4 h-4" />
                          <span>{pitch.comments_count || 0}</span>
                        </button>

                        {/* Share Button */}
                        <button
                          onClick={() => handleShare(pitch.id)}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                            copiedPitchId === pitch.id
                              ? 'bg-green-500/40 text-green-300'
                              : 'bg-slate-700/50 hover:bg-purple-500/30 text-slate-300'
                          }`}
                          title="Share"
                        >
                          {copiedPitchId === pitch.id ? (
                            <>
                              <Check className="w-4 h-4" />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <Share2 className="w-4 h-4" />
                              <span>{pitch.shares_count || 0}</span>
                            </>
                          )}
                        </button>

                        {/* Invest Button */}
                        <button
                          onClick={() => handleSmartContractClick(pitch)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-all"
                          title="Invest"
                        >
                          <Zap className={`w-4 h-4 ${investedPitches.has(pitch.id) ? 'text-green-400 fill-current' : 'text-white'}`} />
                          <span className={investedPitches.has(pitch.id) ? 'text-green-300' : 'text-white'}>{pitch.invests_count || 0}</span>
                        </button>
                      </div>

                      {/* Invite investor — a private, PIN-locked, time-limited
                          link for one named investor, separate from this
                          pitch's public engagement above. */}
                      <button
                        onClick={() => setInvitePitch(pitch)}
                        className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 transition-all"
                        title="Create a private invite for one investor"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        Invite investor privately
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {invitePitch && (
        <PrivatePitchInviteModal pitch={invitePitch} onClose={() => setInvitePitch(null)} />
      )}

      {/* Business Details Modal — opened by tapping a pitch's Pitcher icon */}
      {businessDetailsPitch && (() => {
        const biz = businessDetailsPitch.business_profiles || {};
        const displayName = biz.business_name || biz.name || 'Business';
        const ownerName = businessOwnerProfile?.full_name;
        // The business's own logo (set in BusinessProfileForm) takes priority
        // over the owner's personal photo, which is only a fallback.
        const ownerPhoto = biz.avatar_url || businessOwnerProfile?.avatar_url;
        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-slate-700">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-pink-400" />
                  Business Details
                </h3>
                <button
                  onClick={() => setBusinessDetailsPitch(null)}
                  className="icon-btn-transparent text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="flex items-center gap-3">
                  {ownerPhoto ? (
                    <img
                      src={ownerPhoto}
                      alt={ownerName || displayName}
                      className="w-14 h-14 rounded-full object-cover flex-shrink-0 border border-white/20"
                      onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                    />
                  ) : null}
                  <div
                    className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500 to-orange-400 items-center justify-center text-white font-bold text-xl flex-shrink-0 border border-white/20"
                    style={{ display: ownerPhoto ? 'none' : 'flex' }}
                  >
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-bold text-base truncate">{displayName}</p>
                    {ownerName && (
                      <p className="text-slate-400 text-xs truncate">Pitched by {ownerName}</p>
                    )}
                  </div>
                </div>

                {biz.description && (
                  <p className="text-slate-300 text-sm">{biz.description}</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {biz.business_type && (
                    <div className="bg-white/5 rounded-lg p-2">
                      <p className="text-slate-500 text-xs">Type</p>
                      <p className="text-white text-sm font-semibold truncate">{biz.business_type}</p>
                    </div>
                  )}
                  {biz.business_structure && (
                    <div className="bg-white/5 rounded-lg p-2">
                      <p className="text-slate-500 text-xs">Structure</p>
                      <p className="text-white text-sm font-semibold truncate">{biz.business_structure}</p>
                    </div>
                  )}
                  {biz.founded_year && (
                    <div className="bg-white/5 rounded-lg p-2">
                      <p className="text-slate-500 text-xs">Founded</p>
                      <p className="text-white text-sm font-semibold">{biz.founded_year}</p>
                    </div>
                  )}
                  {typeof biz.total_capital === 'number' && (
                    <div className="bg-white/5 rounded-lg p-2">
                      <p className="text-slate-500 text-xs">Total Capital</p>
                      <p className="text-white text-sm font-semibold">{formatCurrency(biz.total_capital)}</p>
                    </div>
                  )}
                </div>

                {/* Live shares & value -- the same getLiveShareOffer() the Invest
                    flow prices against, not the static target_funding/raised_amount
                    columns (those are seeded once and never recomputed). */}
                {businessLiveOfferLoading ? (
                  <div className="bg-white/5 p-3 rounded-lg flex items-center gap-2 text-slate-400 text-sm">
                    <Loader className="w-4 h-4 animate-spin" />
                    Loading live share value...
                  </div>
                ) : businessLiveOffer?.available ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/5 rounded-lg p-2">
                      <p className="text-slate-500 text-xs">Live Business Value</p>
                      <p className="text-white text-sm font-bold">UGX {Math.round(businessLiveOffer.businessValueUgx).toLocaleString()}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2">
                      <p className="text-slate-500 text-xs">Live Share Price</p>
                      <p className="text-white text-sm font-bold">UGX {Math.round(businessLiveOffer.sharePriceUgx).toLocaleString()}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2">
                      <p className="text-slate-500 text-xs">Shares Available</p>
                      <p className="text-white text-sm font-bold">
                        {businessLiveOffer.sharesAvailable.toLocaleString()} of {businessLiveOffer.totalShares.toLocaleString()}
                      </p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2">
                      <p className="text-slate-500 text-xs">Equity Offering</p>
                      <p className="text-white text-sm font-bold">{businessDetailsPitch.equity_offering || 0}%</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-3">
                    <p className="text-amber-200 text-sm">
                      {LIVE_OFFER_BLOCKED_MESSAGE[businessLiveOffer?.reason] || LIVE_OFFER_BLOCKED_MESSAGE.default}
                    </p>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-slate-700 flex gap-2">
                <button
                  onClick={() => {
                    setViewingPitcher({
                      name: displayName,
                      business_profile_id: businessDetailsPitch.business_profile_id,
                      user_id: businessDetailsPitch.user_id,
                    });
                    setBusinessDetailsPitch(null);
                  }}
                  className="flex-1 bg-pink-500 hover:bg-pink-600 text-white rounded-lg font-semibold py-2 text-sm transition"
                >
                  See all pitches from this business
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Fullscreen Video Player Modal */}
      {videoPlayerPitch && (
        <div className="fixed inset-0 bg-black z-[60] w-screen h-screen overflow-hidden">
          {/* Close Button */}
          <button
            onClick={() => setVideoPlayerPitch(null)}
            className="icon-btn-transparent absolute top-4 right-4 z-30 p-2 text-white drop-shadow-lg hover:scale-110 transition-all"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Video Container - True Fullscreen, No Flex */}
          <div className="absolute inset-0 w-screen h-screen bg-black">
            {!videoPlayerPitch.video_url || videoErrors[videoPlayerPitch.id] ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                <AlertCircle className="w-16 h-16 text-slate-500" />
                <p className="text-slate-400 text-lg">Video unavailable</p>
              </div>
            ) : (
              <video
                ref={el => { if (el) videoRefs.current[`player-${videoPlayerPitch.id}`] = el; }}
                src={videoPlayerPitch.video_url}
                className={isDesktopView ? 'w-full h-full object-contain bg-black' : 'w-full h-full object-cover'}
                controls
                autoPlay
                crossOrigin="anonymous"
                preload="auto"
                onError={(event) => handleVideoError(videoPlayerPitch.id, event)}
                controlsList="nodownload"
                onLoadStart={() => markVideoBuffering(videoPlayerPitch.id)}
                onWaiting={() => markVideoBuffering(videoPlayerPitch.id)}
                onPlaying={() => clearVideoBuffering(videoPlayerPitch.id)}
                onCanPlay={() => clearVideoBuffering(videoPlayerPitch.id)}
              />
            )}
            {bufferingPitches.has(videoPlayerPitch.id) && !videoErrors[videoPlayerPitch.id] && (
              <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none bg-black/20">
                <DiamondLoader size={64} />
              </div>
            )}
          </div>

          {/* Right Side Action Buttons - TikTok Style */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-5 z-30">
            {/* Like Button */}
            <button
              onClick={() => handleLike(videoPlayerPitch.id)}
              className="icon-btn-transparent flex flex-col items-center gap-1"
              title="Like"
            >
              <div className="w-14 h-14 flex items-center justify-center transition-all hover:scale-110">
                <Heart className={`w-7 h-7 drop-shadow-lg ${likedPitches.has(videoPlayerPitch.id) ? 'text-red-500 fill-red-500' : 'text-white'}`} />
              </div>
              <span className="text-white text-sm font-bold drop-shadow-lg">{videoPlayerPitch.likes_count || 0}</span>
            </button>

            {/* Comment Button */}
            <button
              onClick={() => handleOpenComments(videoPlayerPitch.id)}
              className="icon-btn-transparent flex flex-col items-center gap-1"
              title="Comment"
            >
              <div className="w-14 h-14 flex items-center justify-center transition-all hover:scale-110">
                <MessageCircle className="w-7 h-7 text-white drop-shadow-lg" />
              </div>
              <span className="text-white text-sm font-bold drop-shadow-lg">{videoPlayerPitch.comments_count || 0}</span>
            </button>

            {/* Share Button */}
            <button
              onClick={() => handleShare(videoPlayerPitch.id)}
              className="icon-btn-transparent flex flex-col items-center gap-1"
              title="Share"
            >
              <div className="w-14 h-14 flex items-center justify-center transition-all hover:scale-110">
                {copiedPitchId === videoPlayerPitch.id ? (
                  <Check className="w-7 h-7 text-green-400 drop-shadow-lg" />
                ) : (
                  <Share2 className="w-7 h-7 text-white drop-shadow-lg" />
                )}
              </div>
              <span className="text-white text-sm font-bold drop-shadow-lg">
                {copiedPitchId === videoPlayerPitch.id ? 'Copied!' : (videoPlayerPitch.shares_count || 0)}
              </span>
            </button>

            {/* Download Button — the file already carries the burned-in IcanEra mark */}
            <button
              onClick={() => handleDownloadVideo(videoPlayerPitch)}
              disabled={downloadingPitchId === videoPlayerPitch.id}
              className="icon-btn-transparent flex flex-col items-center gap-1"
              title="Download"
            >
              <div className="w-14 h-14 flex items-center justify-center transition-all hover:scale-110">
                {downloadingPitchId === videoPlayerPitch.id ? (
                  <DiamondLoader size={28} />
                ) : (
                  <Download className="w-7 h-7 text-white drop-shadow-lg" />
                )}
              </div>
            </button>

            {/* Invest Button */}
            <button
              onClick={() => handleSmartContractClick(videoPlayerPitch)}
              className="icon-btn-transparent flex flex-col items-center gap-1"
              title="Invest"
            >
              <div className="w-14 h-14 flex items-center justify-center transition-all hover:scale-110">
                <Zap className={`w-7 h-7 fill-current drop-shadow-lg ${
                  investedPitches.has(videoPlayerPitch.id) ? 'text-green-400' : 'text-white'
                }`} />
              </div>
              <span className={`text-sm font-bold drop-shadow-lg ${
                investedPitches.has(videoPlayerPitch.id) ? 'text-green-300' : 'text-white'
              }`}>
                {videoPlayerPitch.invests_count || 0}
              </span>
            </button>
          </div>

          {/* Pitch Info Bottom Bar - Removed to streamline video view */}
        </div>
      )}

      {/* Shimmer Animation CSS */}
      <style>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
        </>
      )}
    </div>
  );
};

export default Pitchin;
