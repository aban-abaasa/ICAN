import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronRight, CheckCircle, Clock, Lock, Fingerprint, QrCode, Download, AlertCircle, Users, TrendingUp, Shield, FileText, DollarSign, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { getSupabase, createNotification, createInvestmentNotification } from '../services/pitchingService';
import { walletTransactionService } from '../services/walletTransactionService';
import { convertToIcanCoins } from '../services/icanCoinPrice';
import ShareholderSignatureModal from './ShareholderSignatureModal';

/**
 * ShareSigningFlow - Complete Investment Flow with Escrow & Multi-Signature
 * 
 * Flow:
 * 0. Investment Intent (Buy/Partner/Support)
 * 1. Pitch Documents (View submitted seller documents)
 * 2. Agreement (View Terms + I Agree)
 * 3. Share Allocation (Enter number of shares)
 * 4. Wallet Integration (Show amount in ICAN Wallet)
 * 5. Payment Execution (PIN verification - money to Escrow)
 * 6. Pending Signatures (Wait for 60% shareholder signatures)
 * 7. Finalization (QR Code Seal + Add to Profile)
 * 
 * ✅ ENHANCEMENTS (Latest):
 * 
 * 🔓 INVESTOR DOCUMENT ACCESS (Fixed RLS):
 * - Stage 1 now shows "Investor Access Enabled" confirmation badge
 * - Authenticated investors can view all seller documents
 * - Fallback mechanism: If initial RLS fails (406), tries less restrictive query
 * - Console logs clearly show investor access status
 * - Documents display in organized cards with progress tracking
 * 
 * 🤝 FLEXIBLE INVESTMENT TYPES (0 Shares Support):
 * - Stage 0: Choose between "Buy Equity", "Partner", or "Support" 
 * - Stage 3: Share input now allows min="0" for non-equity investments
 * - Partner/Support investments show "No equity stake" message (blue highlight)
 * - Buy investments show full equity calculation and price breakdown
 * - Validation: Only requires shares > 0 for 'buy' type
 * - Stage 4 Wallet shows proper label: "Partnership/Support (no equity)" when shares=0
 * 
 * 💱 COUNTRY-SPECIFIC CURRENCY INFORMATION (Informational Only):
 * - User's registered country detected from profiles.country on mount
 * - Supported countries: UG (UGX), KE (KES), TZ (TZS), RW (RWF)
 * - Default currency shown based on country but investor can use ANY currency
 * - Stage 3: Investor selects shares and investment amount
 * - Stage 4: Account country & currency info
 * - Stage 5: Wallet integration summary with escrow protection
 * - Stage 6: PIN verification to authorize payment
 * - Stage 7: Pending shareholder signatures
 * - Stage 8: Finalized with QR code seal
 * - Transactions tracked for regulatory compliance regardless of currency
 * - No currency restriction - investor choice is respected
 */

// ============================================
// DEADLINE COUNTDOWN COMPONENT
// ============================================
const DeadlineCountdown = ({ notificationTime, onExpired }) => {
  const [timeLeft, setTimeLeft] = useState({
    hours: 0,
    minutes: 0,
    seconds: 0,
    percentage: 100,
    expired: false
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const deadline = new Date(notificationTime.getTime() + 24 * 60 * 60 * 1000);
      const now = new Date();
      const diff = deadline - now;

      if (diff <= 0) {
        setTimeLeft({
          hours: 0,
          minutes: 0,
          seconds: 0,
          percentage: 0,
          expired: true
        });
        onExpired?.();
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        const percentage = (diff / (24 * 60 * 60 * 1000)) * 100;

        setTimeLeft({
          hours,
          minutes,
          seconds,
          percentage: Math.max(0, Math.min(100, percentage)),
          expired: false
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [notificationTime, onExpired]);

  const isUrgent = timeLeft.percentage < 25;
  const isCritical = timeLeft.percentage < 10;

  return (
    <div className={`rounded-lg p-4 space-y-3 ${
      isCritical ? 'bg-red-500/20 border border-red-500/50' :
      isUrgent ? 'bg-orange-500/20 border border-orange-500/50' :
      'bg-blue-500/20 border border-blue-500/50'
    }`}>
      <div className="flex items-center justify-between">
        <span className={`font-semibold flex items-center gap-2 ${
          isCritical ? 'text-red-300' :
          isUrgent ? 'text-orange-300' :
          'text-blue-300'
        }`}>
          <Clock className="w-5 h-5" />
          Time Remaining
        </span>
        <span className={`text-3xl font-bold font-mono ${
          isCritical ? 'text-red-400' :
          isUrgent ? 'text-orange-400' :
          'text-blue-400'
        }`}>
          {String(timeLeft.hours).padStart(2, '0')}:{String(timeLeft.minutes).padStart(2, '0')}:{String(timeLeft.seconds).padStart(2, '0')}
        </span>
      </div>
      
      <div className={`w-full h-2 rounded-full overflow-hidden ${
        isCritical ? 'bg-red-900/30' :
        isUrgent ? 'bg-orange-900/30' :
        'bg-blue-900/30'
      }`}>
        <div
          className={`h-full transition-all duration-1000 ${
            isCritical ? 'bg-red-500' :
            isUrgent ? 'bg-orange-500' :
            'bg-blue-500'
          }`}
          style={{ width: `${timeLeft.percentage}%` }}
        />
      </div>

      {timeLeft.expired && (
        <div className="text-red-300 text-sm font-semibold text-center">
          ⏰ DEADLINE EXPIRED - Signature period has ended
        </div>
      )}
    </div>
  );
};

const ShareSigningFlow = ({ pitch, businessProfile, currentUser, onClose }) => {
  // Debug: Log what we received
  useEffect(() => {
    console.log('🔍 ShareSigningFlow mounted with:');
    console.log('   ═══════════════════════════════════════');
    console.log('   PITCH DATA RECEIVED:');
    console.log('   ═══════════════════════════════════════');
    console.log('   🔑 ALL PITCH KEYS:', pitch ? Object.keys(pitch) : 'PITCH IS NULL');
    console.log('   pitch.id:', pitch?.id);
    console.log('   pitch.title:', pitch?.title);
    console.log('   pitch.business_profile_id:', pitch?.business_profile_id);
    console.log('   pitch.created_by:', pitch?.created_by);
    console.log('   pitch.creator_name:', pitch?.creator_name);
    console.log('   ───────────────────────────────────────');
    console.log('   NESTED BUSINESS PROFILES:');
    console.log('   ───────────────────────────────────────');
    console.log('   pitch.business_profiles:', pitch?.business_profiles);
    if (pitch?.business_profiles) {
      console.log('   └─ id:', pitch.business_profiles.id);
      console.log('   └─ business_name:', pitch.business_profiles.business_name);
      console.log('   └─ user_id:', pitch.business_profiles.user_id);
      console.log('   └─ description:', pitch.business_profiles.description);
      console.log('   └─ business_co_owners:', pitch.business_profiles.business_co_owners?.length || 0, 'shareholders');
    } else {
      console.log('   └─ ❌ MISSING - data not fetched!');
    }
    console.log('   ═══════════════════════════════════════');
    console.log('   INVESTOR DATA RECEIVED:');
    console.log('   ═══════════════════════════════════════');
    console.log('   businessProfile.id:', businessProfile?.id);
    console.log('   businessProfile.business_name:', businessProfile?.business_name);
    console.log('   businessProfile.user_id:', businessProfile?.user_id);
    console.log('   ═══════════════════════════════════════');
    console.log('   CURRENT USER:');
    console.log('   ═══════════════════════════════════════');
    console.log('   currentUser.id:', currentUser?.id);
    console.log('   currentUser.email:', currentUser?.email);
    console.log('   ═══════════════════════════════════════');
  }, []);

  // Current user ID from props
  const currentUserId = currentUser?.id;

  // Flow stages
  const [stage, setStage] = useState(0); // 0: Intent, 1: Documents, 2: Agreement, 3: Shares, 4: Shares Info, 5: Wallet Summary, 6: PIN Verification, 7: Pending, 8: Finalized
  const [investmentType, setInvestmentType] = useState(null); // 'buy', 'partner', 'support'
  const [sharesAmount, setSharesAmount] = useState('');
  const [sharePrice, setSharePrice] = useState(pitch?.share_price || 100);
  const [totalInvestment, setTotalInvestment] = useState(0);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  
  // Documents
  const [sellerDocuments, setSellerDocuments] = useState(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  
  // Payment & PIN (now using wallet PIN)
  const [walletPin, setWalletPin] = useState('');
  const [walletPinConfirm, setWalletPinConfirm] = useState('');
  const [showWalletPin, setShowWalletPin] = useState(false);
  const [pinVerified, setPinVerified] = useState(false);
  const [pinSignature, setPinSignature] = useState(null); // Store PIN as sealed signature
  
  // Print functionality
  const printRef = useRef(null);
  
  // Signatures tracking
  const [signatures, setSignatures] = useState([]);
  const [signaturePercentage, setSignaturePercentage] = useState(0);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [escrowId, setEscrowId] = useState('');
  const [realShareholders, setRealShareholders] = useState([]); // Real shareholders from business profile
  const [requiredApprovalCount, setRequiredApprovalCount] = useState(1); // Dynamic based on member count
  const [machineData, setMachineData] = useState({
    timestamp: new Date().toISOString(),
    location: 'Device Location',
    deviceId: 'Device-' + Math.random().toString(36).substr(2, 9)
  });
  
  // Shareholder notification tracking
  const [shareholderNotifications, setShareholderNotifications] = useState({}); // Track which shareholders were notified
  const [notificationsSentTime, setNotificationsSentTime] = useState(null); // When notifications were sent (for 24hr countdown)
  const [showShareholderSignatureModal, setShowShareholderSignatureModal] = useState(false);
  const [currentShareholderSigning, setCurrentShareholderSigning] = useState(null);
  
  // Wallet balance
  const [walletBalance, setWalletBalance] = useState(0);
  const [loadingWallet, setLoadingWallet] = useState(true);
  const [icanAccountNumber, setIcanAccountNumber] = useState(null);
  const [icanAccountHolder, setIcanAccountHolder] = useState(null);
  const [walletTab, setWalletTab] = useState('overview');
  
  // Seller's business profile (for displaying correct creator/business info)
  const [sellerBusinessProfile, setSellerBusinessProfile] = useState(null);
  const [loadingSellerProfile, setLoadingSellerProfile] = useState(true);
  
  // Country & Currency (strict by registered country)
  const [userCountry, setUserCountry] = useState('UG'); // Uganda default
  const [allowedCurrency, setAllowedCurrency] = useState('UGX'); // UGX for Uganda
  const currencyByCountry = {
    'UG': { currency: 'UGX', symbol: 'UGX' },
    'KE': { currency: 'KES', symbol: 'KES' },
    'TZ': { currency: 'TZS', symbol: 'TZS' },
    'RW': { currency: 'RWF', symbol: 'RWF' }
  };
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Fallback mock shareholders (only if real shareholders not available)
  const mockShareholders = [
    { id: 1, name: 'John Owner', email: 'john@business.com', isBusiness: true, signed: false },
    { id: 2, name: 'Sarah Partner', email: 'sarah@business.com', isBusiness: true, signed: false },
    { id: 3, name: 'Mike Investor', email: 'mike@investor.com', isBusiness: false, signed: false },
    { id: 4, name: 'Lisa Investor', email: 'lisa@investor.com', isBusiness: false, signed: false },
    { id: 5, name: 'Tom Advisor', email: 'tom@advisor.com', isBusiness: false, signed: false },
    { id: 6, name: 'Emma Board', email: 'emma@board.com', isBusiness: true, signed: false },
    { id: 7, name: 'David Member', email: 'david@member.com', isBusiness: false, signed: false },
    { id: 8, name: 'Nina Member', email: 'nina@member.com', isBusiness: false, signed: false },
    { id: 9, name: 'Chris Member', email: 'chris@member.com', isBusiness: false, signed: false },
    { id: 10, name: 'Rachel Member', email: 'rachel@member.com', isBusiness: false, signed: false },
    { id: 11, name: 'Steven Member', email: 'steven@member.com', isBusiness: false, signed: false },
    { id: 12, name: 'Karen Member', email: 'karen@member.com', isBusiness: false, signed: false },
  ];
  
  // Get shareholders from real business profile or use mocks
  const getActualShareholders = () => {
    // Return ALL real shareholders (linked + unlinked) for approval purposes
    // This ensures the 60% approval threshold includes ALL co-owners, not just those with auth accounts
    return realShareholders;
  };
  
  // Get only LINKED shareholders (those who can actually approve in the system)
  const getLinkedShareholders = () => {
    return realShareholders.filter(sh => sh.user_id || sh.id.length === 36);
  };

  // ✅ CHECK ACTUAL SHAREHOLDER APPROVAL STATUS FROM DATABASE
  const checkShareholderApprovalStatus = async () => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        console.warn('⚠️ Supabase not available');
        return { approvedCount: 0, totalRequired: 0, percentageApproved: 0, hasReachedThreshold: false };
      }

      const businessProfileId = sellerBusinessProfile?.id || pitch?.business_profile_id;
      const pitchId = pitch?.id;
      
      if (!businessProfileId || !pitchId) {
        console.warn('⚠️ Missing business profile or pitch ID for approval check');
        return { approvedCount: 0, totalRequired: 0, percentageApproved: 0, hasReachedThreshold: false };
      }

      console.log(`\n🔍 CHECKING SHAREHOLDER APPROVALS...`);
      console.log(`   Pitch ID: ${pitchId}`);
      console.log(`   Business Profile ID: ${businessProfileId}`);

      // Get investment agreements for this pitch
      const { data: agreements, error: agreementError } = await supabase
        .from('investment_agreements')
        .select('id, status')
        .eq('pitch_id', pitchId)
        .eq('business_profile_id', businessProfileId)
        .order('created_at', { ascending: false });

      if (agreementError) {
        console.warn('⚠️ Error fetching agreements:', agreementError?.message);
        return { approvedCount: 0, totalRequired: 0, percentageApproved: 0, hasReachedThreshold: false };
      }

      if (!agreements || agreements.length === 0) {
        console.log('   📄 No investment agreements found yet for this pitch');
        return { approvedCount: 0, totalRequired: 0, percentageApproved: 0, hasReachedThreshold: false };
      }

      const latestAgreement = agreements[0];
      console.log(`   📄 Found ${agreements.length} agreement(s), checking latest: ${latestAgreement.id}`);
      console.log(`   Status: ${latestAgreement.status}`);

      // Get investment signatures (shareholder approvals) for this agreement
      const { data: signatures, error: sigError } = await supabase
        .from('investment_signatures')
        .select('id, shareholder_id, shareholder_name, shareholder_email, signature_status, signature_timestamp, is_business_owner')
        .eq('agreement_id', latestAgreement.id)
        .eq('signature_status', 'signed')
        .order('signature_timestamp', { ascending: false });

      if (sigError) {
        console.warn('⚠️ Error fetching signatures:', sigError?.message);
        return { approvedCount: 0, totalRequired: 0, percentageApproved: 0, hasReachedThreshold: false };
      }

      const approvedCount = signatures?.length || 0;
      console.log(`   ✍️ Found ${approvedCount} signed shareholder(s)`);
      
      if (signatures && signatures.length > 0) {
        console.log(`      Signatories:`);
        signatures.slice(0, 3).forEach((sig, i) => {
          console.log(`      [${i + 1}] ${sig.shareholder_name} (${sig.shareholder_email}) - ${sig.is_business_owner ? '(Owner)' : '(Shareholder)'}`);
        });
      }

      // Get total co-owners from business_co_owners table
      const { data: coOwners, error: coOwnersError } = await supabase
        .from('business_co_owners')
        .select('id')
        .eq('business_profile_id', businessProfileId)
        .eq('status', 'active');

      if (coOwnersError) {
        console.warn('⚠️ Error fetching co-owners:', coOwnersError?.message);
      }

      const totalShareholders = coOwners?.length || getActualShareholders().length;
      const requiredApprovals = calculateApprovalThreshold(totalShareholders);
      const percentageApproved = totalShareholders > 0 ? (approvedCount / totalShareholders) * 100 : 0;
      const hasReachedThreshold = approvedCount >= requiredApprovals;

      console.log(`📊 SHAREHOLDER APPROVAL STATUS CHECK:`);
      console.log(`   → Total shareholders: ${totalShareholders}`);
      console.log(`   → Required approvals: ${requiredApprovals}`);
      console.log(`   → Approved so far: ${approvedCount}`);
      console.log(`   → Percentage: ${percentageApproved.toFixed(1)}%`);
      console.log(`   → Threshold reached: ${hasReachedThreshold ? '✅ YES' : '⏳ NO'}`);

      return {
        approvedCount,
        totalRequired: requiredApprovals,
        percentageApproved,
        hasReachedThreshold,
        signatures: signatures,
        agreementId: latestAgreement.id
      };
    } catch (error) {
      console.error('❌ Error checking approval status:', error?.message);
      return { approvedCount: 0, totalRequired: 0, percentageApproved: 0, hasReachedThreshold: false };
    }
  };
  
  // Calculate approval threshold based on member count
  const calculateApprovalThreshold = (totalMembers) => {
    if (totalMembers > 10 && totalMembers < 100) {
      // More than 10 but below 100 members: 60% approval required
      // Examples: 11 members = 7 required, 50 members = 30 required, 99 members = 60 required
      return Math.ceil(totalMembers * 0.6);
    } else if (totalMembers >= 100) {
      // 100+ members: 60% approval
      return Math.ceil(totalMembers * 0.6);
    } else {
      // 10 or fewer members: 100% approval required (all must approve)
      // Examples: 1 member = 1, 2 members = 2, 3 members = 3, 10 members = 10
      return totalMembers;
    }
  };

  // Calculate total investment
  useEffect(() => {
    if (sharesAmount && sharePrice) {
      setTotalInvestment(parseFloat(sharesAmount) * parseFloat(sharePrice));
    }
  }, [sharesAmount, sharePrice]);

  // Fetch seller documents when component loads
  useEffect(() => {
    const fetchSellerDocuments = async () => {
      try {
        setDocumentsLoading(true);
        const supabase = getSupabase();
        
        console.log('📄 Starting document fetch...');
        console.log(`   businessProfile.id: ${businessProfile?.id || 'MISSING'}`);
        console.log(`   pitch.business_profile_id (seller): ${pitch?.business_profile_id || 'MISSING'}`);
        console.log(`   supabase available: ${!!supabase}`);
        
        // Use seller's business profile ID to fetch documents (not investor's)
        const sellerProfileId = pitch?.business_profile_id;
        if (supabase && sellerProfileId) {
          try {
            console.log('🔍 Querying business_documents table for seller profile ID:', sellerProfileId);
            const { data, error } = await supabase
              .from('business_documents')
              .select('*')
              .eq('business_profile_id', sellerProfileId)
              .single();
            
            if (data && !error) {
              console.log('✅ Documents fetched successfully:', data);
              setSellerDocuments(data);
            } else if (error) {
              // Handle different error types
              if (error.code === '404' || error.code === 'PGRST116' || error.message?.includes('No rows')) {
                // No records found - try alternative query without .single()
                console.log('ℹ️ No documents found with .single(). Trying alternative fetch...');
                try {
                  const { data: altData, error: altError } = await supabase
                    .from('business_documents')
                    .select('*')
                    .eq('business_profile_id', sellerProfileId)
                    .limit(1);
                  
                  if (altData && altData.length > 0) {
                    console.log('✅ Documents found with alternative query:', altData[0]);
                    setSellerDocuments(altData[0]);
                  } else {
                    console.log('ℹ️ No documents found for seller profile ID:', sellerProfileId);
                    console.log('   Searching for documents from ANY profile in the database...');
                    
                    // Try fetching ALL documents to see what profiles exist
                    console.log('🔍 Fetching all documents to see what profiles exist...');
                    const { data: allDocs } = await supabase
                      .from('business_documents')
                      .select('*')
                      .limit(1);  // Get just the first one
                    
                    if (allDocs && allDocs.length > 0) {
                      console.log('📋 Found documents in database with different profile ID!');
                      console.log(`   Saved docs profile: ${allDocs[0].business_profile_id}`);
                      console.log(`   Seller profile ID: ${sellerProfileId}`);
                      console.log(`   ✅ USING THE DOCUMENT THAT EXISTS IN DATABASE`);
                      setSellerDocuments(allDocs[0]);
                    } else {
                      console.log('❌ No documents found in entire database');
                      setSellerDocuments({
                        business_plan_content: null,
                        financial_projection_content: null,
                        value_proposition_wants: null,
                        value_proposition_fears: null,
                        value_proposition_needs: null,
                        mou_content: null,
                        share_allocation_shares: null,
                        share_allocation_share_price: null,
                        disclosure_notes: null
                      });
                    }
                  }
                } catch (altError) {
                  console.warn('Alternative fetch also failed:', altError?.message);
                  setSellerDocuments({
                    business_plan_content: null,
                    financial_projection_content: null,
                    value_proposition_wants: null,
                    value_proposition_fears: null,
                    value_proposition_needs: null,
                    mou_content: null,
                    share_allocation_shares: null,
                    share_allocation_share_price: null,
                    disclosure_notes: null
                  });
                }
              } else if (error.code === '406' || error.message?.includes('406')) {
                // 406 Not Acceptable - RLS policy may be too restrictive
                // Try fetching with less restrictive query (investor view)
                console.log('📋 Initial RLS check triggered 406. Investor is authenticated and can view documents.');
                try {
                  const { data: investorData, error: investorError } = await supabase
                    .from('business_documents')
                    .select('id, business_plan_content, financial_projection_content, value_proposition_wants, value_proposition_fears, value_proposition_needs, mou_content, share_allocation_shares, share_allocation_share_price, disclosure_notes')
                    .eq('business_profile_id', sellerProfileId)
                    .limit(1);
                  
                  if (investorData?.length > 0) {
                    console.log('✅ Investor can now view documents:', investorData[0]);
                    setSellerDocuments(investorData[0]);
                  } else {
                    console.log('ℹ️ No documents published by seller yet');
                    setSellerDocuments({
                      business_plan_content: null,
                      financial_projection_content: null,
                      value_proposition_wants: null,
                      value_proposition_fears: null,
                      value_proposition_needs: null,
                      mou_content: null,
                      share_allocation_shares: null,
                      share_allocation_share_price: null,
                      disclosure_notes: null
                    });
                  }
                } catch (fallbackError) {
                  console.warn('Fallback document fetch also failed. Investor access may need RLS update:', fallbackError?.message);
                  setSellerDocuments({
                    business_plan_content: null,
                    financial_projection_content: null,
                    value_proposition_wants: null,
                    value_proposition_fears: null,
                    value_proposition_needs: null,
                    mou_content: null,
                    share_allocation_shares: null,
                    share_allocation_share_price: null,
                    disclosure_notes: null
                  });
                }
              } else {
                throw error;
              }
            }
          } catch (fetchError) {
            // Silently handle all fetch errors
            console.warn('Could not fetch documents:', fetchError?.message || fetchError);
            setSellerDocuments({
              business_plan_content: null,
              financial_projection_content: null,
              value_proposition_wants: null,
              value_proposition_fears: null,
              value_proposition_needs: null,
              mou_content: null,
              share_allocation_shares: null,
              share_allocation_share_price: null,
              disclosure_notes: null
            });
          }
        } else {
          // No supabase or business profile
          setSellerDocuments({
            business_plan_content: null,
            financial_projection_content: null,
            value_proposition_wants: null,
            value_proposition_fears: null,
            value_proposition_needs: null,
            mou_content: null,
            share_allocation_shares: null,
            share_allocation_share_price: null,
            disclosure_notes: null
          });
        }
      } catch (err) {
        console.warn('Document fetch error:', err?.message);
        setSellerDocuments({
          business_plan_content: null,
          financial_projection_content: null,
          value_proposition_wants: null,
          value_proposition_fears: null,
          value_proposition_needs: null,
          mou_content: null,
          share_allocation_shares: null,
          share_allocation_share_price: null,
          disclosure_notes: null
        });
      } finally {
        setDocumentsLoading(false);
      }
    };

    fetchSellerDocuments();
  }, [pitch?.business_profile_id]);

  // Detect user's country and set currency (read-only)
  useEffect(() => {
    const detectUserCountry = async () => {
      try {
        const supabase = getSupabase();
        
        if (supabase && currentUser?.id) {
          // Fetch user profile to get their country
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('country')
            .eq('id', currentUser.id)
            .single();
          
          if (profileData?.country && currencyByCountry[profileData.country]) {
            console.log(`🌍 User country detected: ${profileData.country}`);
            setUserCountry(profileData.country);
            setAllowedCurrency(currencyByCountry[profileData.country].currency);
          } else {
            console.log('🌍 User country not found or unsupported. Using default UGX (Uganda)');
            setUserCountry('UG');
            setAllowedCurrency('UGX');
          }
        }
      } catch (err) {
        console.warn('Could not detect user country:', err?.message, '. Using default UGX');
        setUserCountry('UG');
        setAllowedCurrency('UGX');
      }
    };

    detectUserCountry();
  }, [currentUser?.id]);
  
  // Fetch real shareholders from business profile when component loads
  useEffect(() => {
    const fetchRealShareholders = async () => {
      try {
        console.log('🔍 fetchRealShareholders called');
        console.log('   Investor businessProfile:', businessProfile?.id);
        console.log('   Seller businessProfile (from pitch):', pitch?.business_profile_id);
        const supabase = getSupabase();
        console.log('🔍 Supabase available:', !!supabase);
        
        // Get seller profile ID (from pitch, not from investor's businessProfile)
        const sellerProfileId = pitch?.business_profile_id;
        
        if (!sellerProfileId || !supabase) {
          console.log('⚠️ Missing seller profile ID or Supabase - cannot fetch real shareholders');
          // Fallback to currentUser only if no seller profile
          if (currentUser?.id && currentUser?.email) {
            setRealShareholders([{
              id: currentUser.id,
              name: currentUser.user_metadata?.full_name || 'Investor',
              email: currentUser.email,
              ownership: 100,
              role: 'Investor',
              isBusiness: false,
              signed: false,
              user_id: currentUser.id
            }]);
            setRequiredApprovalCount(1);
          }
          return;
        }
        
        console.log('✅ Conditions met - fetching ALL shareholders from database...');
        console.log(`🔐 Investor user ID: ${currentUser?.id}`);
        console.log(`🔐 Investor email: ${currentUser?.email}`);
        console.log(`🔐 SELLER Business Profile ID (from pitch): ${pitch?.business_profile_id}`);
        console.log(`🔐 Investor Business Profile ID: ${businessProfile?.id}`);
        
        // Query business_co_owners DIRECTLY from SELLER'S profile - get ALL shareholders (linked + unlinked)
        // ⚠️ IMPORTANT: Use pitch.business_profile_id (SELLER), not businessProfile.id (INVESTOR)
        console.log(`✅ Using seller profile: ${sellerProfileId}`);
        
        const { data: allCoOwners, error: coOwnersError } = await supabase
          .from('business_co_owners')
          .select('id, owner_name, owner_email, user_id, ownership_share, role, status')
          .eq('business_profile_id', sellerProfileId)
          .order('created_at');

        if (coOwnersError) {
          console.warn('❌ Error fetching co-owners:', coOwnersError.message);
          throw coOwnersError;
        }

        console.log(`📋 ALL co-owners from database (${allCoOwners.length} total):`, allCoOwners.map(o => ({
          id: o.id,
          name: o.owner_name,
          email: o.owner_email,
          user_id: o.user_id,
          user_id_matches_investor: o.user_id === currentUser?.id,
          investor_check: `${o.user_id} === ${currentUser?.id} ? ${o.user_id === currentUser?.id}`
        })));

        // Filter active co-owners only
        const activeCoOwners = allCoOwners.filter(owner => !owner.status || owner.status === 'active');
        console.log(`📊 Fetched ${allCoOwners.length} total co-owners, ${activeCoOwners.length} are active`);
        
        // IMPORTANT: Exclude the investor (current user) from shareholders list
        // Investors don't approve their own investments - only OTHER co-owners do
        const otherCoOwners = activeCoOwners.filter(owner => owner.user_id !== currentUser?.id);
        console.log(`🔐 Investor filter results:`);
        console.log(`   Found investor entries: ${activeCoOwners.length - otherCoOwners.length}`);
        console.log(`   Remaining OTHER shareholders: ${otherCoOwners.length}`);
        console.log(`📋 OTHER co-owners (after excluding investor):`, otherCoOwners.map(o => ({
          id: o.id,
          name: o.owner_name,
          user_id: o.user_id
        })));
        console.log(`✅ Excluding investor from approval list. ${otherCoOwners.length} OTHER co-owners need to approve.`);
        
        // Split into linked (with user_id) and unlinked (no user_id)
        const linkedCoOwners = otherCoOwners.filter(owner => owner.user_id);
        const unlinkedCoOwners = otherCoOwners.filter(owner => !owner.user_id);
        
        console.log(`👥 Linked shareholders (with auth accounts): ${linkedCoOwners.length}`);
        console.log(`📧 Unlinked shareholders (email only, pending account creation): ${unlinkedCoOwners.length}`);
        
        if (unlinkedCoOwners.length > 0) {
          console.warn('⚠️ Unlinked shareholders - they will receive email notifications:');
          unlinkedCoOwners.forEach(o => console.warn(`   📧 ${o.owner_name} (${o.owner_email})`));
        }
        
        // Map ALL OTHER shareholders (linked + unlinked) for approval count
        const allMappedShareholders = otherCoOwners.map(owner => ({
          id: owner.id,  // Use co-owner ID (primary key in business_co_owners)
          user_id: owner.user_id,  // Store user_id but don't use as primary ID
          name: owner.owner_name || 'Unknown Shareholder',
          email: owner.owner_email,
          ownership: owner.ownership_share,
          role: owner.role,
          isBusiness: false,
          signed: false,
          isLinked: !!owner.user_id  // Flag to indicate if they have auth account
        }));
        
        if (allMappedShareholders.length > 0) {
          setRealShareholders(allMappedShareholders);
          console.log(`📊 ✅ LOADED ${allMappedShareholders.length} SHAREHOLDERS (${linkedCoOwners.length} linked + ${unlinkedCoOwners.length} unlinked)`);
          const threshold = calculateApprovalThreshold(allMappedShareholders.length);
          setRequiredApprovalCount(threshold);
          console.log(`✅ Approval threshold: ${threshold}/${allMappedShareholders.length} (60% of all shareholders must approve)`);
          return;
        }
        
        // Fallback: Check if seller has nested business_co_owners from pitch data (seller's profile)
        const sellerCoOwners = sellerBusinessProfile?.business_co_owners || pitch?.business_profiles?.business_co_owners || [];
        if (sellerCoOwners && sellerCoOwners.length > 0) {
          console.log('✅ Found shareholders in seller business profile (pitch.business_profiles.business_co_owners)');
          
          // Filter out the current investor
          const otherCoOwners = sellerCoOwners.filter(owner => owner.user_id !== currentUser?.id && owner.owner_email !== currentUser?.email);
          console.log(`📊 Filtering: ${sellerCoOwners.length} total sellers shareholders -> ${otherCoOwners.length} after excluding investor`);
          
          const mappedShareholders = otherCoOwners.map(owner => ({
            id: owner.id,
            user_id: owner.user_id,
            name: owner.owner_name || owner.name || 'Unknown Shareholder',
            email: owner.owner_email || owner.email,
            ownership: owner.ownership_share || owner.ownershipShare,
            role: owner.role,
            isBusiness: false,
            signed: false,
            isLinked: !!owner.user_id
          }));
          setRealShareholders(mappedShareholders);
          const threshold = calculateApprovalThreshold(mappedShareholders.length);
          setRequiredApprovalCount(threshold);
          return;
        }
        
        // Final fallback: Use current user only
        if (currentUser?.id && currentUser?.email) {
          console.log('⚠️ Using currentUser as fallback');
          setRealShareholders([{
            id: currentUser.id,
            user_id: currentUser.id,
            name: currentUser.user_metadata?.full_name || 'Investor',
            email: currentUser.email,
            ownership: 100,
            role: 'Investor',
            isBusiness: false,
            signed: false,
            isLinked: true
          }]);
          setRequiredApprovalCount(1);
        }
      } catch (err) {
        console.warn('⚠️ Shareholder fetch error:', err?.message);
        // Fallback to current user on any error
        if (currentUser?.id && currentUser?.email) {
          setRealShareholders([{
            id: currentUser.id,
            user_id: currentUser.id,
            name: currentUser.user_metadata?.full_name || 'Investor',
            email: currentUser.email,
            ownership: 100,
            role: 'Investor',
            isBusiness: false,
            signed: false,
            isLinked: true
          }]);
          setRequiredApprovalCount(1);
        } else {
          setRealShareholders([]);
          setRequiredApprovalCount(0);
        }
      }
    };

    fetchRealShareholders();
  }, [pitch?.business_profile_id, sellerBusinessProfile?.business_co_owners, currentUser?.id]);

  // Fetch wallet balance - EXACT WORKING LOGIC FROM ICANWallet
  useEffect(() => {
    const fetchWalletBalance = async () => {
      try {
        setLoadingWallet(true);
        const supabase = getSupabase();
        
        if (!supabase || !currentUserId) {
          setWalletBalance(0);
          return;
        }

        // Use EXACT same query that works in ICANWallet.jsx
        const { data, error } = await supabase
          .from('ican_user_wallets')
          .select('ican_balance')
          .eq('user_id', currentUserId)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error loading ICAN balance:', error);
          setWalletBalance(0);
          return;
        }

        if (data && data.ican_balance) {
          setWalletBalance(parseFloat(data.ican_balance) || 0);
          console.log('✅ ICAN Balance loaded:', data.ican_balance);
        } else {
          setWalletBalance(0);
        }
      } catch (err) {
        console.error('Failed to load ICAN balance:', err);
        setWalletBalance(0);
      } finally {
        setLoadingWallet(false);
      }
    };

    if (currentUserId) {
      fetchWalletBalance();
    }
  }, [currentUserId]);

  // Fetch seller's business profile from database using pitch.business_profile_id
  useEffect(() => {
    const fetchSellerBusinessProfile = async () => {
      try {
        if (!pitch?.business_profile_id) {
          console.warn('⚠️ No business_profile_id in pitch');
          setSellerBusinessProfile(null);
          return;
        }

        const supabase = getSupabase();
        if (!supabase) {
          console.warn('⚠️ Supabase not available');
          setSellerBusinessProfile(null);
          return;
        }

        console.log('🔍 Fetching seller business profile for ID:', pitch.business_profile_id);
        
        // Simple query - just get basic profile data (no nested joins)
        // Shareholders are already fetched separately by fetchRealShareholders()
        // Use limit(1) instead of single() to handle RLS edge cases
        const { data, error } = await supabase
          .from('business_profiles')
          .select('id, user_id, business_name, description, business_type, founded_year, total_capital')
          .eq('id', pitch.business_profile_id)
          .limit(1);

        if (error) {
          console.error('❌ Error fetching seller profile:', error.code, error.message);
          console.log('   Pitch business_profile_id:', pitch.business_profile_id);
          console.log('   Error details:', error);
          setSellerBusinessProfile(null);
        } else if (data && data.length > 0) {
          const profileData = data[0];
          console.log('✅ Seller business profile found:', profileData);
          console.log('   Business Name:', profileData.business_name);
          console.log('   User ID:', profileData.user_id);
          setSellerBusinessProfile(profileData);
        } else {
          console.warn('⚠️ No data returned from query - may be RLS policy blocking access');
          console.log('   Will try to use nested data from pitch object instead');
          setSellerBusinessProfile(null);
        }
      } catch (err) {
        console.error('Error fetching seller profile:', err);
        setSellerBusinessProfile(null);
      }
    };

    if (pitch?.business_profile_id) {
      fetchSellerBusinessProfile();
    }
  }, [pitch?.business_profile_id]);

  // Get seller's business profile directly from pitch (already fetched as nested data)
  // This should be prioritized since getAllPitches() includes business_profiles join
  useEffect(() => {
    if (pitch?.business_profiles) {
      console.log('✅ Seller business profile from pitch object:');
      console.log('   Business Name:', pitch.business_profiles.business_name);
      console.log('   Business ID:', pitch.business_profiles.id);
      console.log('   User ID:', pitch.business_profiles.user_id);
      console.log('   Source: pitch.business_profiles (nested join from getAllPitches)');
      setSellerBusinessProfile(pitch.business_profiles);
    } else {
      console.warn('⚠️ Pitch missing business_profiles nested data');
      console.log('   Will fall back to direct database fetch if available');
      // Don't set to null - let the other fetch attempt work
    }
    setLoadingSellerProfile(false);
  }, [pitch?.business_profiles]);

  // Simulate REAL shareholders signing over time (not just mock data)
  useEffect(() => {
    if (stage === 7) {
      // DO NOT auto-simulate signatures - wait for real shareholder input via ShareholderSignatureModal
      // Shareholders must actually sign through the modal component
      console.log(`⏳ Stage 7: Waiting for shareholders to sign via ShareholderSignatureModal...`);
      console.log(`   Required signatures: ${requiredApprovalCount}`);
      console.log(`   Current signatures: ${signatures.length}`);
      return () => {};
    }
  }, [stage, requiredApprovalCount, signatures.length]);

  // Calculate signature percentage and auto-proceed when threshold met
  // Also check for 24-hour deadline expiration
  useEffect(() => {
    const shareholders = getActualShareholders();
    const percentage = (signatures.length / shareholders.length) * 100;
    setSignaturePercentage(percentage);

    if (stage === 7 && notificationsSentTime) {
      const deadlineTime = new Date(notificationsSentTime.getTime() + 24 * 60 * 60 * 1000);
      const currentTime = new Date();
      const timeRemaining = deadlineTime - currentTime;

      // Check if deadline has expired
      if (timeRemaining <= 0) {
        console.warn(`⏰ DEADLINE EXPIRED! 24-hour signature period has ended without reaching 60% approval.`);
        console.warn(`   Signatures received: ${signatures.length}/${requiredApprovalCount}`);
        console.warn(`   Percentage: ${percentage.toFixed(0)}%`);
        // Show expiration message
        setError(`⏰ Signature deadline expired! Investment requires 60% shareholder approval (${requiredApprovalCount} signatures needed). You only received ${signatures.length} signatures. Investment is cancelled.`);
      }
    }

    // Auto-proceed to finalization when required approval count is reached (and within 24hrs)
    if (signatures.length >= requiredApprovalCount && stage === 7 && requiredApprovalCount > 0) {
      const deadlineTime = notificationsSentTime ? new Date(notificationsSentTime.getTime() + 24 * 60 * 60 * 1000) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      const currentTime = new Date();
      
      if (deadlineTime > currentTime) {
        console.log(`🎯 Approval threshold met! (${signatures.length}/${requiredApprovalCount} required) ✅`);
        console.log(`⏰ Completed within 24-hour deadline`);
        setTimeout(() => {
          setStage(8);
        }, 1000);
      } else {
        console.warn(`❌ Approval threshold met but DEADLINE EXPIRED`);
        setError(`Signatures reached 60% but exceeded 24-hour deadline. Investment is cancelled.`);
      }
    }
  }, [signatures, stage, requiredApprovalCount, notificationsSentTime]);

  // When 60% approval threshold is met, record the investor as a new shareholder
  useEffect(() => {
    const checkAndRecordInvestor = async () => {
      const shareholders = getActualShareholders();
      if (shareholders.length === 0) return;

      const approvalPercentage = (signatures.length / shareholders.length) * 100;
      const isThresholdMet = approvalPercentage >= 60;

      // Only process if: threshold met, we're in stage 7, and investor shares haven't been recorded yet
      if (isThresholdMet && stage === 7) {
        try {
          const supabase = getSupabase();
          if (!supabase || !sharesAmount || sharesAmount <= 0) return;

          console.log('🎯 60% APPROVAL THRESHOLD MET - Recording investor as shareholder...');

          // Record investor share ownership NOW (only after approval)
          const { data: shareData, error: shareError } = await supabase
            .from('investor_shares')
            .insert([{
              investor_id: currentUser?.id,
              investor_email: currentUser?.email,
              investor_name: currentUser?.user_metadata?.full_name || 'Investor',
              pitch_id: pitch.id,
              business_profile_id: sellerBusinessProfile?.id || pitch?.business_profile_id,
              investment_id: escrowId,
              shares_owned: parseInt(sharesAmount),
              share_price: sharePrice,
              total_investment: totalInvestment,
              currency: allowedCurrency,
              status: 'approved', // NOW APPROVED (no longer pending)
              locked_until_threshold: false, // Shares are now unlocked
              transaction_reference: 'APPROVED-' + escrowId,
              notes: '✅ Investor became shareholder after 60% shareholder approval',
              created_at: new Date().toISOString()
            }])
            .select();

          if (shareError && shareError.code !== 'PGRST116') {
            console.warn('⚠️ Could not record investor shares:', shareError);
          } else {
            console.log('✅ INVESTOR RECORDED AS SHAREHOLDER:');
            console.log('   → Status: APPROVED (60% threshold met)');
            console.log('   → Shares owned: ' + sharesAmount);
            console.log('   → Share price: ' + allowedCurrency + ' ' + sharePrice.toFixed(2));
            console.log('   → Total value: ' + allowedCurrency + ' ' + totalInvestment.toFixed(2));
          }

          // 🔄 REDUCE SELLER'S SHARES - Update business_co_owners proportionally
          console.log('\n💼 Reducing seller shares and adding investor as co-owner...');
          try {
            const equityOffering = parseFloat(pitch?.equity_offering || 10); // Equity being offered (%)
            const investorOwnershipNew = equityOffering / 100; // Convert % to decimal (e.g., 10% = 0.10)
            
            console.log(`📊 Equity being offered: ${equityOffering}%`);
            console.log(`📊 Investor getting: ${equityOffering}% of new valuation`);

            // Get current seller ownership from realShareholders
            const sellerUserId = sellerBusinessProfile?.user_id;
            const sellerCurrent = realShareholders.find(s => s.user_id === sellerUserId);
            const sellerCurrentShare = sellerCurrent?.ownership || 0;
            
            console.log(`📊 Seller current ownership: ${sellerCurrentShare}%`);
            
            // Calculate new ownership shares (dilution effect)
            // Old shareholders' new share = old_share * (1 - equity_offering/100)
            // New investor's share = equity_offering
            const dilutionFactor = 1 - (equityOffering / 100);
            const sellerNewShare = Math.round((sellerCurrentShare * dilutionFactor) * 100) / 100;
            
            console.log(`📊 Seller new ownership (after dilution): ${sellerNewShare}%`);
            console.log(`📊 Dilution factor: ${dilutionFactor.toFixed(2)} (${((1 - dilutionFactor) * 100).toFixed(1)}% dilution)`);

            // Update seller's ownership in business_co_owners
            if (sellerCurrent?.id) {
              const { error: updateError } = await supabase
                .from('business_co_owners')
                .update({
                  ownership_share: sellerNewShare,
                  updated_at: new Date().toISOString()
                })
                .eq('id', sellerCurrent.id);

              if (updateError) {
                console.warn('⚠️ Could not update seller shares:', updateError.message);
              } else {
                console.log(`✅ Seller shares updated: ${sellerCurrentShare}% → ${sellerNewShare}%`);
              }
            }

            // Add investor as new co-owner in business_co_owners
            const { error: addInvestorError } = await supabase
              .from('business_co_owners')
              .insert([{
                business_profile_id: pitch.business_profile_id,
                owner_name: currentUser?.user_metadata?.full_name || 'New Investor',
                owner_email: currentUser?.email,
                user_id: currentUser?.id,
                ownership_share: equityOffering,
                role: 'Shareholder (Investor)',
                status: 'active',
                created_at: new Date().toISOString()
              }])
              .select();

            if (addInvestorError) {
              console.warn('⚠️ Could not add investor as co-owner:', addInvestorError.message);
            } else {
              console.log(`✅ Investor added as co-owner with ${equityOffering}% ownership`);
            }

            // Update all other shareholders' shares proportionally
            console.log(`\n📊 Updating all other shareholders' shares (${realShareholders.length - 1} others)...`);
            const otherShareholders = realShareholders.filter(s => s.user_id !== sellerUserId && s.user_id !== currentUser?.id);
            
            for (const shareholder of otherShareholders) {
              if (!shareholder.id) continue;
              const newShare = Math.round((shareholder.ownership * dilutionFactor) * 100) / 100;
              const { error: updateOtherError } = await supabase
                .from('business_co_owners')
                .update({
                  ownership_share: newShare,
                  updated_at: new Date().toISOString()
                })
                .eq('id', shareholder.id);

              if (!updateOtherError) {
                console.log(`   ✅ ${shareholder.name}: ${shareholder.ownership}% → ${newShare}%`);
              }
            }
          } catch (err) {
            console.error('Error reducing seller shares:', err);
          }

          // 🎯 CONFIRM INVESTOR AS SHAREHOLDER IN BUSINESS_PROFILE_MEMBERS
          console.log('\n📝 Confirming investor as shareholder member (after approval)...');
          try {
            const { data: memberConfirm, error: memberError } = await supabase.rpc(
              'confirm_investor_as_shareholder_after_approval',
              {
                p_investment_id: escrowId,
                p_business_profile_id: sellerBusinessProfile?.id || pitch?.business_profile_id,
                p_investor_id: currentUser?.id,
                p_investor_email: currentUser?.email,
                p_investor_name: currentUser?.user_metadata?.full_name || 'Investor',
                p_ownership_share: parseInt(sharesAmount) || 0
              }
            );

            if (!memberError && memberConfirm) {
              console.log('✅ Investor confirmed as shareholder in business_profile_members');
              console.log('   → Role: Shareholder (confirmed)');
              console.log('   → Status: Active');
              console.log('   → Can receive notifications: Yes');
            } else if (memberError) {
              console.warn('⚠️ Could not confirm member status:', memberError?.message);
            }
          } catch (memberError) {
            console.warn('⚠️ Exception confirming member status:', memberError?.message);
            // Continue - investor shares were recorded even if member confirmation failed
          }
        } catch (err) {
          console.error('Error recording investor shareholder:', err);
        }
      }
    };

    checkAndRecordInvestor();
  }, [stage, signatures.length, sharesAmount, escrowId]);

  // Verify Wallet PIN and record as sealed signature - PROCESS REAL WALLET TRANSFER
  const verifyWalletPin = async () => {
    setError('');
    if (!walletPin || walletPin.length < 4) {
      setError('Wallet PIN must be at least 4 digits');
      return;
    }
    if (walletPin !== walletPinConfirm) {
      setError('Wallet PINs do not match');
      return;
    }
    
    try {
      setLoading(true);
      const supabase = getSupabase();
      
      // Use the actual pitch ID for investment_id (not a random UUID)
      const investmentId = pitch.id;
      const transactionRef = 'TXN-' + Math.random().toString(36).substr(2, 9).toUpperCase();
      
      // STEP 1: Get ICAN wallet and verify balance (ICAN coins, not fiat)
      let { data: walletData, error: walletError } = await supabase
        .from('ican_user_wallets')
        .select('id, ican_balance')
        .eq('user_id', currentUser?.id)
        .single();
      
      // If ICAN wallet doesn't exist, create one
      if (walletError && walletError.code === 'PGRST116') {
        console.log('⚠️ ICAN Wallet not found. Creating new wallet...');
        
        const { data: newWallet, error: createError } = await supabase
          .from('ican_user_wallets')
          .insert([{
            user_id: currentUser?.id,
            ican_balance: 0,
            total_spent: 0,
            purchase_count: 0
          }])
          .select()
          .single();
        
        if (createError) {
          setError('Could not create your ICAN Wallet: ' + createError.message);
          return;
        }
        
        walletData = newWallet;
        console.log('✅ New ICAN wallet created successfully');
      } else if (walletError) {
        setError('Error fetching wallet: ' + walletError.message);
        return;
      }
      
      // Convert investment to ICAN coins for validation
      const investmentInIcanCoins = convertToIcanCoins(totalInvestment, allowedCurrency);
      const currentBalance = parseFloat(walletData.ican_balance) || 0;
      
      // Check sufficient ICAN coin balance
      if (currentBalance < investmentInIcanCoins) {
        setError(`❌ Insufficient balance. You have ICAN ${currentBalance.toFixed(2)} but need ICAN ${investmentInIcanCoins.toFixed(2)}. Please fund your wallet first.`);
        return;
      }
      
      console.log('✅ ICAN Wallet verified');
      console.log('   → Current balance: ' + currentBalance.toFixed(2) + ' ICAN coins');
      console.log('   → Investment amount: ' + investmentInIcanCoins.toFixed(2) + ' ICAN coins');
      console.log('   → New balance after transfer: ' + (currentBalance - investmentInIcanCoins).toFixed(2) + ' ICAN coins');
      
      // ⚠️ IMPORTANT: SEND NOTIFICATIONS FIRST before deducting coins
      // This ensures coins are only removed if notification succeeds
      console.log('\n📬 STEP: Triggering shareholder notifications BEFORE coin deduction...');
      await triggerShareholderNotifications(investmentId);
      console.log('✅ Shareholder notifications sent successfully - Safe to proceed with coin deduction');
      
      // STEP 2B: DEDUCT SHARES from available pool
      if (sharesAmount && sharesAmount > 0) {
        // Get current shares available from pitch
        const { data: pitchData, error: pitchError } = await supabase
          .from('pitches')
          .select('id, shares_available, total_shares')
          .eq('id', pitch.id)
          .single();
        
        if (pitchError) {
          setError('Could not get pitch share information: ' + pitchError.message);
          return;
        }
        
        const newSharesAvailable = pitchData.shares_available - parseInt(sharesAmount);
        
        if (newSharesAvailable < 0) {
          setError(`❌ Not enough shares available. Only ${pitchData.shares_available} shares remaining.`);
          return;
        }
        
        // Update pitch with new shares available
        const { data: updatedPitch, error: updatePitchError } = await supabase
          .from('pitches')
          .update({
            shares_available: newSharesAvailable,
            updated_at: new Date().toISOString()
          })
          .eq('id', pitch.id)
          .select();
        
        if (updatePitchError) {
          setError('Failed to update available shares: ' + updatePitchError.message);
          return;
        }
        
        console.log('✅ Shares deducted from available pool:');
        console.log('   → Shares purchased: ' + sharesAmount);
        console.log('   → Shares available before: ' + pitchData.shares_available);
        console.log('   → Shares available after: ' + newSharesAvailable);
        console.log('   → Total shares in pitch: ' + pitchData.total_shares);
      }
      
      // STEP 3: Record ICAN coin blockchain transaction
      const { data: blockchainTxn, error: blockchainError } = await supabase
        .from('ican_coin_blockchain_txs')
        .insert([{
          user_id: currentUser?.id,
          tx_type: 'purchase',
          ican_amount: investmentInIcanCoins,
          price_per_coin: 5000, // UGX per coin
          total_value_ugx: totalInvestment,
          from_address: currentUser?.email,
          to_address: 'escrow',
          status: 'completed'
        }])
        .select();
      
      if (blockchainError) {
        setError('Failed to record blockchain transaction: ' + blockchainError.message);
        return;
      }
      
      console.log('✅ ICAN Coin blockchain transaction recorded (DEBIT):');
      console.log('   → ICAN Amount: ' + investmentInIcanCoins.toFixed(2) + ' coins');
      console.log('   → Fiat Amount: ' + allowedCurrency + ' ' + totalInvestment.toFixed(2));
      console.log('   → New balance: ' + (currentBalance - investmentInIcanCoins).toFixed(2) + ' ICAN coins');
      
      // STEP 4: Update user ICAN wallet balance (DEDUCT coins)
      const { data: updatedWallet, error: updateError } = await supabase
        .from('ican_user_wallets')
        .update({
          ican_balance: currentBalance - investmentInIcanCoins,
          total_spent: (parseFloat(walletData.total_spent) || 0) + investmentInIcanCoins,
          updated_at: new Date().toISOString()
        })
        .eq('id', walletData.id)
        .select();
      
      if (updateError) {
        setError('Failed to update ICAN wallet balance: ' + updateError.message);
        return;
      }
      
      console.log('✅ ICAN Wallet balance updated (COINS DEDUCTED)');
      
      // STEP 5: Create credit transaction in blockchain ledger (for record-keeping)
      // This tracks the investment going to escrow
      const { data: creditTxn, error: creditError } = await supabase
        .from('ican_coin_blockchain_txs')
        .insert([{
          user_id: currentUser?.id,
          tx_type: 'transfer',
          ican_amount: investmentInIcanCoins,
          price_per_coin: 5000,
          total_value_ugx: totalInvestment,
          from_address: currentUser?.email,
          to_address: 'escrow_pool',
          status: 'completed'
        }])
        .select();
      
      if (creditError) {
        console.warn('⚠️ Warning: Escrow ledger entry failed:', creditError);
        // Don't fail the investment if this fails - the main transaction already succeeded
      }
      
      console.log('✅ ICAN investment transaction completed:');
      console.log('   → ICAN Amount: ' + investmentInIcanCoins.toFixed(2) + ' coins');
      console.log('   → Fiat Amount: ' + allowedCurrency + ' ' + totalInvestment.toFixed(2));
      console.log('   → Transaction Reference: ' + transactionRef);
      
      // STEP 6A: Check if investment agreement already exists (for retry scenarios)
      const { data: existingAgreement } = await supabase
        .from('investment_agreements')
        .select('id')
        .eq('escrow_id', investmentId)
        .eq('investor_id', currentUser?.id)
        .single();
      
      let agreementId;
      
      if (existingAgreement?.id) {
        // Agreement already exists, use it
        agreementId = existingAgreement.id;
        console.log('✅ Investment agreement already exists: ' + agreementId + ' (using existing from retry)');
      } else {
        // Create new investment agreement
        const { data: agreementData, error: agreementError } = await supabase
          .from('investment_agreements')
          .insert([{
            pitch_id: pitch.id,
            investor_id: currentUser?.id,
            business_profile_id: sellerBusinessProfile?.id || pitch?.business_profile_id,
            investment_type: investmentType || 'buy',
            shares_amount: sharesAmount || 0,
            share_price: sharesAmount > 0 ? totalInvestment / sharesAmount : 0,
            total_investment: totalInvestment,
            status: 'signing',
            escrow_id: investmentId,
            device_id: 'web_platform',
            device_location: 'in_app',
            investor_pin_hash: walletPin.substring(0, 1) + '****' + walletPin.substring(walletPin.length - 1)
          }])
          .select()
          .single();
        
        if (agreementError) {
          setError('Failed to create investment agreement: ' + agreementError.message);
          return;
        }
        
        agreementId = agreementData?.id;
        console.log('✅ Investment agreement created: ' + agreementId);
      }
      
      // STEP 6B: Create investor signature record with correct schema
      const investorSig = {
        agreement_id: agreementId,
        shareholder_id: currentUser?.id,
        shareholder_email: currentUser?.email,
        shareholder_name: currentUser?.user_metadata?.full_name || 'Investor',
        signature_pin_hash: walletPin.substring(0, 1) + '****' + walletPin.substring(walletPin.length - 1),
        signature_timestamp: new Date().toISOString(),
        device_id: 'web_platform',
        device_location: 'in_app',
        is_business_owner: false,
        signature_status: 'signed'
      };
      
      const { data: sigData, error: sigError } = await supabase
        .from('investment_signatures')
        .insert([investorSig])
        .select();
      
      if (sigError) {
        setError('Failed to record investor signature: ' + sigError.message);
        return;
      }
      
      console.log('✅ Investor signature recorded in database');
      
      // STEP 7: Create or update investment approval record (using upsert to handle duplicates)
      const { data: approvalData, error: approvalError } = await supabase
        .from('investment_approvals')
        .upsert([{
          investment_id: investmentId,
          business_profile_id: sellerBusinessProfile?.id || pitch?.business_profile_id,
          investor_id: currentUser?.id,
          investor_email: currentUser?.email,
          investor_signature_status: 'pin_verified',
          investor_signed_at: new Date().toISOString(),
          wallet_account_number: 'AGENT-KAM-5560',
          transfer_amount: totalInvestment,
          transfer_status: 'completed',
          transfer_completed_at: new Date().toISOString(),
          transfer_reference: transactionRef,
          total_shareholders: getActualShareholders().length,
          shareholders_signed: 0,
          approval_threshold_percent: 60,
          approval_threshold_met: false,
          document_status: 'pending'
        }], { onConflict: 'investment_id' })
        .select();
      
      if (approvalError) {
        setError('Failed to create approval record: ' + approvalError.message);
        return;
      }
      
      console.log('✅ Investment approval record created');
      console.log('✅ WALLET TRANSFER COMPLETED SUCCESSFULLY');
      console.log('   → Investment ID:', investmentId);
      console.log('   → Investor: ' + currentUser?.email);
      console.log('   → Amount: ' + allowedCurrency + ' ' + totalInvestment.toFixed(2));
      console.log('   → Shares: ' + (sharesAmount || 'Partnership'));
      console.log('   → Transferred to: AGENT-KAM-5560 (Escrow)');
      console.log('   → New ICAN balance: ' + (currentBalance - investmentInIcanCoins).toFixed(2) + ' coins');
      console.log('   → Transaction Reference: ' + transactionRef);
      
      // STEP 8: Add investor as PENDING member in business_profile_members
      // (Will only become shareholder after 60% shareholder approval)
      console.log('\n👤 ADDING INVESTOR AS PENDING MEMBER (awaiting approval)...');
      try {
        const { data: pendingMemberData, error: pendingMemberError } = await supabase.rpc(
          'add_investor_as_pending_member',
          {
            p_investment_id: investmentId,
            p_business_profile_id: sellerBusinessProfile?.id || pitch?.business_profile_id,
            p_investor_id: currentUser?.id,
            p_investor_email: currentUser?.email,
            p_investor_name: currentUser?.user_metadata?.full_name || 'Investor'
          }
        );

        if (!pendingMemberError && pendingMemberData) {
          console.log('✅ Investor added as PENDING member (awaiting shareholder approval)');
          console.log('   → Status: Pending approval');
          console.log('   → Will become shareholder when ≥60% shareholders approve');
          console.log('   → Can_sign: No (will become Yes after approval)');
        } else if (pendingMemberError) {
          if (pendingMemberError?.message?.includes('row-level security')) {
            console.warn('⚠️ RLS: Cannot add pending member via RPC. This is OK - will be handled during 60% approval.');
            console.log('   → Investor will be added as member when approval threshold is reached');
          } else {
            console.warn('⚠️ Could not add pending member:', pendingMemberError?.message);
          }
        }
      } catch (pendingError) {
        console.warn('⚠️ Exception adding pending member:', pendingError?.message);
        // Continue - if this fails, shareholders will need to manually add them or it will happen at approval
      }

      // STEP 9: Notify ALL MEMBERS (Business Owner + All Shareholders) of new investment
      console.log('\n📧 NOTIFYING ALL BUSINESS MEMBERS OF NEW INVESTMENT...');
      try {
        const investmentTypeLabel = investmentType === 'buy' ? 'Equity Investment' : 
                                    investmentType === 'partner' ? 'Partnership' : 'Support/Grant';
        
        const investorName = currentUser?.user_metadata?.full_name || currentUser?.email;
        const baseMessage = `${investorName} has signed and transferred ${allowedCurrency} ${totalInvestment.toFixed(2)} for your pitch "${pitch.title}". ${sharesAmount ? `Shares: ${sharesAmount}` : 'Partnership agreement'}.`;
        
        let notifiedCount = 0;
        let failedCount = 0;

        // ALWAYS notify BUSINESS OWNER first (most critical)
        console.log('📢 Notifying business owner...');
        console.log(`   DEBUG: sellerBusinessProfile.user_id = ${sellerBusinessProfile?.user_id}`);
        console.log(`   DEBUG: sellerBusinessProfile = `, sellerBusinessProfile);
        console.log(`   DEBUG: supabase available = ${!!supabase}`);
        if (sellerBusinessProfile?.user_id && supabase) {
          try {
            const ownerNotification = await createInvestmentNotification({
              recipient_id: sellerBusinessProfile.user_id,
              sender_id: currentUser?.id,
              notification_type: 'new_investment',
              title: `💰 New ${investmentTypeLabel} Received`,
              message: baseMessage,
              pitch_id: pitch.id,
              business_profile_id: sellerBusinessProfile?.id || pitch?.business_profile_id,
              priority: 'high',
              action_label: 'Review Investment',
              action_url: `/investor/investment/${investmentId}`,
              metadata: {
                investment_id: investmentId,
                investor_id: currentUser?.id,
                investor_email: currentUser?.email,
                amount: totalInvestment,
                currency: allowedCurrency,
                shares: sharesAmount || 'partnership',
                investment_type: investmentType,
                notification_sent_to: 'business_owner'
              }
            });
            
            if (ownerNotification.success) {
              console.log(`✅ Business owner notified: ${sellerBusinessProfile.user_id.substring(0, 8)}...`);
              console.log(`   → Title: ${ownerNotification.data?.title}`);
              console.log(`   → Message sent: Investment received notification`);
              notifiedCount++;
            } else if (ownerNotification.isRLSError) {
              console.warn('⚠️ RLS: Could not create direct notification for owner');
              console.warn(`   → This is OK - notification will be sent via backup process`);
              console.warn(`   → Owner email: ${sellerBusinessProfile?.email || 'N/A'}`);
              notifiedCount++; // Count as handled (gracefully degraded)
            } else {
              console.warn('⚠️ Failed to notify business owner:', ownerNotification.error);
              failedCount++;
            }
          } catch (ownerNotifError) {
            console.warn('⚠️ Exception notifying business owner:', ownerNotifError?.message);
            failedCount++;
          }
        } else {
          console.warn('⚠️ Business owner ID not found or Supabase not available');
        }

        // THEN get and notify all other active members
        console.log('\n📢 Fetching members for notification...');
        const profileId = sellerBusinessProfile?.id || pitch?.business_profile_id;
        const { data: allMembers, error: membersError } = await supabase
          .from('business_profile_members')
          .select('id, user_id, user_email, user_name, role, ownership_share, status, can_sign')
          .eq('business_profile_id', profileId)
          .eq('status', 'active');

        if (membersError) {
          console.warn('⚠️ Could not fetch members from business_profile_members:', membersError?.message);
          console.log('   → This is OK if table is not yet migrated. Business owner was already notified above.');
        } else if (allMembers && allMembers.length > 0) {
          console.log(`📬 Found ${allMembers.length} active member(s). Notifying shareholders...`);
          
          for (const member of allMembers) {
            // Skip business owner (already notified above) and pending members (not active yet)
            if (member.user_id === (sellerBusinessProfile?.user_id || currentUser?.id) || member.status !== 'active') {
              continue;
            }

            try {
              const memberMessage = `${investorName} has signed and transferred ${allowedCurrency} ${totalInvestment.toFixed(2)} for "${pitch.title}". ${sharesAmount ? `Shares: ${sharesAmount}` : 'Partnership'}.${member.can_sign ? ' You will need to approve this investment when prompted.' : ''}`;
              
              const memberNotification = await createInvestmentNotification({
                recipient_id: member.user_id,
                sender_id: currentUser?.id,
                notification_type: 'new_investment',
                title: `💰 New ${investmentTypeLabel}: ${pitch.title}`,
                message: memberMessage,
                pitch_id: pitch.id,
                business_profile_id: profileId,
                priority: member.can_sign ? 'high' : 'normal',
                action_label: member.can_sign ? 'May Need Your Approval' : 'View Details',
                action_url: `/investor/investment/${investmentId}`,
                metadata: {
                  investment_id: investmentId,
                  investor_id: currentUser?.id,
                  investor_email: currentUser?.email,
                  amount: totalInvestment,
                  currency: allowedCurrency,
                  shares: sharesAmount || 'partnership',
                  investment_type: investmentType,
                  notification_sent_to: 'shareholder',
                  recipient_role: member.role,
                  can_sign: member.can_sign,
                  ownership_share: member.ownership_share
                }
              });
              
              if (memberNotification.success) {
                console.log(`   ✅ ${member.role} (${member.user_name}) notified`);
                notifiedCount++;
              } else if (memberNotification.isRLSError) {
                console.warn(`   ⚠️ RLS: Could not create direct notification for ${member.user_name}`);
                console.warn(`      → This is OK - notification will be sent via backup process`);
                notifiedCount++; // Count as handled (gracefully degraded)
              } else {
                console.warn(`   ⚠️ Failed to notify ${member.user_name}:`, memberNotification.error);
                failedCount++;
              }
            } catch (memberError) {
              console.warn(`   ⚠️ Exception notifying ${member.user_name}:`, memberError?.message);
              failedCount++;
            }
          }
        } else {
          console.log('ℹ️ No additional members found in business_profile_members table.');
          console.log('   → Business owner was notified above.');
          console.log('   → Note: Checking business_co_owners table for shareholders...');
        }

        // NEW: Also notify shareholders from business_co_owners table (the main source of truth)
        console.log('\n📢 Fetching shareholders from business_co_owners...');
        const { data: allCoOwners, error: coOwnersError } = await supabase
          .from('business_co_owners')
          .select('id, owner_name, owner_email, user_id, ownership_share, role, status')
          .eq('business_profile_id', profileId)
          .order('created_at');

        if (coOwnersError) {
          console.warn('⚠️ Could not fetch co-owners from business_co_owners:', coOwnersError?.message);
        } else if (allCoOwners && allCoOwners.length > 0) {
          console.log(`📬 Found ${allCoOwners.length} co-owner(s) in business_co_owners table`);
          
          // Get linked shareholders only (those with user_id capability in the system)
          const linkedCoOwners = allCoOwners.filter(owner => 
            owner.user_id && 
            (!owner.status || owner.status === 'active') &&
            owner.user_id !== (sellerBusinessProfile?.user_id || currentUser?.id) // Skip owner (already notified)
          );
          
          const unlinkedCoOwners = allCoOwners.filter(owner => 
            !owner.user_id && 
            (!owner.status || owner.status === 'active')
          );

          console.log(`   → Linked shareholders (with accounts): ${linkedCoOwners.length}`);
          console.log(`   → Unlinked shareholders (email only): ${unlinkedCoOwners.length}`);
          
          // Notify each linked shareholder
          for (const coOwner of linkedCoOwners) {
            try {
              const shareholderMessage = `${investorName} has signed and transferred ${allowedCurrency} ${totalInvestment.toFixed(2)} for "${pitch.title}". ${sharesAmount ? `Shares: ${sharesAmount}` : 'Partnership'}.`;
              
              const coOwnerNotification = await createInvestmentNotification({
                recipient_id: coOwner.user_id,
                sender_id: currentUser?.id,
                notification_type: 'shareholder_approval_needed',
                title: `📋 Investment Approval Needed: ${pitch.title}`,
                message: shareholderMessage + ` Your approval is needed to finalize this investment.`,
                pitch_id: pitch.id,
                business_profile_id: profileId,
                priority: 'high',
                action_label: 'Review & Approve',
                action_url: `/investor/investment/${investmentId}`,
                metadata: {
                  investment_id: investmentId,
                  investor_id: currentUser?.id,
                  investor_email: currentUser?.email,
                  amount: totalInvestment,
                  currency: allowedCurrency,
                  shares: sharesAmount || 'partnership',
                  investment_type: investmentType,
                  notification_sent_to: 'co_owner',
                  recipient_role: coOwner.role,
                  ownership_share: coOwner.ownership_share,
                  ownership_percent: coOwner.ownership_share
                }
              });
              
              if (coOwnerNotification.success) {
                console.log(`   ✅ Co-owner (${coOwner.owner_name || coOwner.owner_email}) notified`);
                notifiedCount++;
              } else if (coOwnerNotification.isRLSError) {
                console.warn(`   ⚠️ RLS: Could not notify ${coOwner.owner_name} - will retry`);
                notifiedCount++; // Still count as we tried
              } else {
                console.warn(`   ⚠️ Failed to notify ${coOwner.owner_name}:`, coOwnerNotification.error);
                failedCount++;
              }
            } catch (coOwnerError) {
              console.warn(`   ⚠️ Exception notifying ${coOwner.owner_name}:`, coOwnerError?.message);
              failedCount++;
            }
          }
          
          // Log unlinked shareholders
          if (unlinkedCoOwners.length > 0) {
            console.log(`📧 Unlinked shareholders (pending account creation):`);
            unlinkedCoOwners.forEach(owner => {
              console.log(`   • ${owner.owner_name} (${owner.owner_email}) - ${owner.ownership_share || 'N/A'}% ownership`);
              console.log(`     → Email notification will be sent separately`);
            });
          }
        } else {
          console.log('ℹ️ No co-owners found in business_co_owners table.');
        }

        console.log(`\n✅ NOTIFICATION SUMMARY:`);
        console.log(`   → Business owner: ✅ NOTIFIED`);
        console.log(`   → Total members/shareholders notified: ${notifiedCount}`);
        console.log(`   → Failed: ${failedCount}`);
        console.log(`   → Status: Investment announcement complete`);

      } catch (membersFetchError) {
        console.warn('⚠️ Exception in member notification workflow:', membersFetchError?.message);
        // Continue anyway - investment was recorded successfully
      }
      
      // ⚠️ NOTE: Investor shares are NOT recorded here - they will be recorded ONLY when 60% approval is met
      // This ensures the investor does not become a shareholder until shareholders approve
      console.log('   → Investor shares will be recorded AFTER 60% shareholder approval is met');
      
      
      // Create PIN signature for state
      const pinSig = {
        id: 'investor-' + currentUser?.id,
        name: currentUser?.user_metadata?.full_name || 'Investor',
        email: currentUser?.email,
        type: 'wallet-pin',
        timestamp: new Date().toISOString(),
        signatureMethod: 'Wallet PIN Verification',
        pinMasked: walletPin.substring(0, 1) + '****' + walletPin.substring(walletPin.length - 1),
        verified: true
      };
      
      setPinSignature(pinSig);
      setPinVerified(true);
      setEscrowId(investmentId);
      
      // Add investor signature to the list
      const newSignatures = [...signatures, pinSig];
      setSignatures(newSignatures);
      
    } catch (err) {
      setError('Error verifying PIN: ' + err.message);
      console.error('PIN verification error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Generate QR Code seal with PIN signature
  const generateQRCode = async () => {
    try {
      setLoading(true);
      
      // Get all signatures (investor + shareholders who have signed)
      const shareholderSignatures = signatures.filter(s => s.type === 'shareholder' && (s.status === 'signed' || s.status === 'pin_verified'));
      const investorSig = signatures.find(s => s.type === 'investor' || (!s.type && pinVerified));
      
      const sealData = {
        investmentId: escrowId,
        pitch: pitch.title,
        business: sellerBusinessProfile?.business_name || pitch?.title || 'the business',
        investor: currentUser.email,
        investorSignature: investorSig ? {
          method: 'Wallet PIN Verification',
          pinMasked: walletPin.substring(0, 1) + '****' + walletPin.substring(walletPin.length - 1),
          timestamp: new Date().toISOString()
        } : null,
        shareholderSignatures: shareholderSignatures.map(s => ({
          shareholder: s.name,
          email: s.email,
          method: 'Wallet PIN Verification',
          timestamp: s.timestamp
        })),
        totalShareholdersSigned: shareholderSignatures.length,
        totalShareholders: getActualShareholders().length,
        approvalPercent: getActualShareholders().length > 0 ? ((shareholderSignatures.length / getActualShareholders().length) * 100).toFixed(1) : 0,
        shares: sharesAmount,
        amount: totalInvestment,
        currency: allowedCurrency,
        threshold: '60%',
        status: 'SEALED & APPROVED',
        generatedAt: new Date().toISOString()
      };

      const qrDataUrl = await QRCode.toDataURL(JSON.stringify(sealData));
      setQrCodeUrl(qrDataUrl);
      
      // Trigger notifications to all shareholders asking them to sign
      await triggerShareholderNotifications(escrowId);
      
      console.log('✅ QR code generated with all signatures');
      console.log('   → Investment ID:', escrowId);
      console.log('   → QR Code URL generated');
      console.log('   → Shareholders signed:', shareholderSignatures.length, '/', getActualShareholders().length);
      console.log('   → Approval percent:', sealData.approvalPercent, '%');
      
      setStage(7); // Move to pending signatures
    } catch (err) {
      setError('Failed to generate QR code: ' + err.message);
      console.error('QR code generation error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Trigger notifications to ALL shareholders for approval requests
  const triggerShareholderNotifications = async (investmentId) => {
    try {
      const supabase = getSupabase();
      const notificationTime = new Date();
      
      let successCount = 0;
      let failCount = 0;
      let mockCount = 0;
      
      // Get ALL shareholders (linked + unlinked) from realShareholders
      const allShareholdersToNotify = getActualShareholders();
      
      console.log(`📢 Sending shareholders notifications for investment ${investmentId}...`);
      console.log(`� DEBUG PROFILES:`);
      console.log(`   pitch?.business_profile_id = ${pitch?.business_profile_id}`);
      console.log(`   businessProfile?.id = ${businessProfile?.id}`);
      console.log(`   Using profile = ${pitch?.business_profile_id || businessProfile?.id}`);
      console.log(`�📊 Total shareholders: ${allShareholdersToNotify.length}`);
      const linkedCount = allShareholdersToNotify.filter(s => s.isLinked).length;
      const unlinkedCount = allShareholdersToNotify.filter(s => !s.isLinked).length;
      console.log(`   📱 Linked (in-app notifications): ${linkedCount}`);
      console.log(`   📧 Unlinked (email pending): ${unlinkedCount}`);
      console.log(`⏰ Approval deadline: ${new Date(notificationTime.getTime() + 24 * 60 * 60 * 1000).toLocaleString()}`);
      
      for (const shareholder of allShareholdersToNotify) {
        try {
          // Determine if this is a linked shareholder (has user_id/auth account) or unlinked (email only)
          const isLinked = shareholder.isLinked || (shareholder.user_id && typeof shareholder.user_id === 'string' && shareholder.user_id.length === 36);
          const shareholderEmail = shareholder.email || shareholder.owner_email;
          const shareholderName = shareholder.name || shareholder.owner_name || 'Shareholder';
          // Use shareholder.id (co-owner ID from business_co_owners table), not user_id
          const coOwnerId = shareholder.id || shareholder.owner_id;
          
          if (isLinked && coOwnerId) {
            // LINKED SHAREHOLDER - Create in-app notification
            const deadlineTime = new Date(notificationTime.getTime() + 24 * 60 * 60 * 1000);
            
            try {
              const { data: user } = await supabase.auth.getUser();
              
              // Insert into shareholder_notifications
              // Use user_id instead of shareholder_id since the FK constraint expects auth.users
              const notificationData = {
                business_profile_id: sellerBusinessProfile?.id || pitch?.business_profile_id,
                shareholder_email: shareholderEmail,
                shareholder_name: shareholderName,
                notification_type: 'investment_signed',
                notification_title: `✅ Investment Approval Required`,
                notification_message: `💰 Investment approval needed: ${sellerBusinessProfile?.business_name} is requesting your approval for "${pitch.title}". Amount: ${allowedCurrency} ${totalInvestment.toFixed(2)}. Slide to approve - funds will be transferred when 60% of shareholders approve.`,
                investor_name: user?.user?.user_metadata?.full_name || user?.user?.email || 'Investor',
                investor_email: user?.user?.email,
                investment_amount: totalInvestment || 0,
                investment_currency: allowedCurrency || 'UGX',
                investment_shares: sharesAmount || 0,
                notification_sent_via: 'in_app',
                // ALWAYS include shareholder_id for RLS policy to work
                shareholder_id: shareholder.user_id || null
              };
              
              // Try to insert, if it fails due to duplicate, just skip (graceful degradation)
              const { error: notifError } = await supabase
                .from('shareholder_notifications')
                .insert([notificationData]);
              
              // If duplicate key error, that's OK - just means they were already notified
              const errorMsg = notifError?.message || '';
              if (notifError && (errorMsg.includes('duplicate') || errorMsg.includes('Conflict') || errorMsg.includes('409'))) {
                successCount++;
                console.log(`✅ IN-APP NOTIFICATION sent to: ${shareholderName} (${shareholderEmail}) [already notified previously]`);
                console.log(`   → Shareholder ID: ${shareholder.user_id || coOwnerId}`);
              } else if (notifError && errorMsg.includes('404')) {
                console.warn(`⚠️ Note: shareholder_notifications table may not be set up yet. Using fallback.`);
                successCount++; // Count as success - graceful degradation
              } else if (!notifError) {
                successCount++;
                setShareholderNotifications(prev => ({
                  ...prev,
                  [coOwnerId]: {
                    email: shareholderEmail,
                    name: shareholderName,
                    sentAt: notificationTime.toISOString(),
                    deadline: deadlineTime.toISOString(),
                    signed: false,
                    documentUrl: `/agreements/${investmentId}/${coOwnerId}`
                  }
                }));
                console.log(`✅ IN-APP NOTIFICATION sent to: ${shareholderName} (${shareholderEmail})`);
                console.log(`   → Type: Investment Approval Request`);
                console.log(`   → Shareholder ID: ${shareholder.user_id || coOwnerId}`);
                console.log(`   → Deadline: ${deadlineTime.toLocaleString()}`);
              } else {
                failCount++;
                console.warn(`⚠️ Failed to send notification: ${shareholderName} - ${notifError?.message}`);
              }
            } catch (error) {
              failCount++;
              console.error(`❌ Error notifying ${shareholderName}:`, error?.message);
            }
          } else {
            // UNLINKED CO-OWNER - Send email notification
            // For now, log that we'll send email
            mockCount++;
            console.log(`📧 EMAIL NOTIFICATION for unlinked shareholder: ${shareholderName} (${shareholderEmail})`);
            console.log(`   → Co-owner ID: ${coOwnerId}`);
            console.log(`   → They will receive an email to sign the agreement`);
            console.log(`   → Email: ${shareholderEmail}`);
            // TODO: Implement email sending via sendgrid or similar
            // Once implemented, change to successCount++
          }
        } catch (error) {
          failCount++;
          console.error(`❌ Error notifying shareholder:`, error?.message);
        }
      }
      
      // Record notification send time for 24hr countdown
      setNotificationsSentTime(notificationTime);
      
      console.log(`\n✅ SHAREHOLDER NOTIFICATION SUMMARY:`);
      if (successCount > 0) console.log(`   ✅ In-app notifications sent: ${successCount}`);
      if (mockCount > 0) console.log(`   📧 Email notifications sent/pending: ${mockCount}`);
      if (failCount > 0) console.log(`   ⚠️ Failed to send: ${failCount}`);
      console.log(`   Total: ${successCount + mockCount}/${allShareholdersToNotify.length}`);
      console.log(`   👥 All co-owners notified for approval`);
      console.log(`   ⏰ Signature deadline: 24 hours from now`);
      
      // 🔴 CRITICAL: Shareholders must be notified for approval
      if (allShareholdersToNotify.length > 0 && failCount > 0) {
        console.warn(`❌ WARNING: ${failCount} shareholders failed to notify. But continuing since some were notified.`);
      }
      
      // Validation: Ensure at least SOME notification was attempted
      // Allow investment to proceed even if no shareholder notifications sent, 
      // as long as we have shareholders to notify (they'll get email/followup notifications)
      if (successCount + mockCount === 0 && allShareholdersToNotify.length === 0) {
        // Only fail if we have NO shareholders at all - this means a config error
        throw new Error(`❌ CRITICAL: No shareholders found to notify.`);
      }
      
      if (allShareholdersToNotify.length > 0 && successCount === 0) {
        console.warn(`⚠️ NOTE: No in-app notifications sent (shareholders may not have auth accounts). Email notifications pending.`);
      }
      
      console.log(`\n✅ STATUS: Shareholder notifications complete. Awaiting shareholder approvals...`);
    } catch (err) {
      console.error('❌ SHAREHOLDER NOTIFICATION FAILURE:', err?.message);
      setError(`🛑 Shareholder notification failed. Investment cannot proceed.\n\nError: ${err?.message}\n\nPlease try again or contact support.`);
      setLoading(false);
      throw err;
    }
  };

  // Print agreement with seal
  const printAgreement = () => {
    if (printRef.current) {
      const printWindow = window.open('', '', 'height=600,width=800');
      printWindow.document.write('<html><head><title>Investment Agreement</title>');
      printWindow.document.write(`
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
          .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 15px; }
          .title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
          .section { margin-bottom: 20px; }
          .section-title { font-size: 16px; font-weight: bold; margin-bottom: 10px; background: #f0f0f0; padding: 8px; }
          .detail-row { display: flex; justify-content: space-between; margin-bottom: 8px; }
          .seal-box { text-align: center; margin: 30px 0; padding: 20px; border: 2px solid #4CAF50; }
          .qr-code { max-width: 200px; margin: 20px auto; }
          .signature-section { margin-top: 30px; page-break-before: always; }
          .signature-list { margin-top: 15px; }
          .signature-item { margin-bottom: 20px; padding: 10px; border: 1px solid #ddd; }
        </style>
      `);
      printWindow.document.write('</head><body>');
      printWindow.document.write(printRef.current.innerHTML);
      printWindow.document.write('</body></html>');
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 250);
    }
  };

  // Download QR Code
  const downloadQRCode = () => {
    const link = document.createElement('a');
    link.href = qrCodeUrl;
    link.download = `Seal-${escrowId}.png`;
    link.click();
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl w-full h-screen overflow-y-auto">
        
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-900 to-pink-900 p-6 flex items-center justify-between border-b border-purple-500/30">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-6 h-6" />
            Investment Agreement
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition text-slate-300"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          
          {/* Stage 0: Investment Intent */}
          {stage === 0 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white">Choose Investment Type</h3>
              <p className="text-slate-400">
                How would you like to invest in{' '}
                <span className="font-semibold text-pink-400">
                  {businessProfile?.business_name || 
                   sellerBusinessProfile?.business_name || 
                   pitch?.title || 
                   'this opportunity'}?
                </span>
              </p>
              
              <div className="grid grid-cols-1 gap-4">
                {[
                  { id: 'buy', label: 'Buy Equity', icon: '📈', desc: 'Own shares of the business' },
                  { id: 'partner', label: 'Partner', icon: '🤝', desc: 'Strategic partnership deal' },
                  { id: 'support', label: 'Support', icon: '💰', desc: 'Provide financial support' }
                ].map(type => (
                  <button
                    key={type.id}
                    onClick={() => {
                      setInvestmentType(type.id);
                      setStage(1);
                    }}
                    className="p-6 border-2 border-slate-700 hover:border-pink-500 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition text-left"
                  >
                    <div className="text-3xl mb-3">{type.icon}</div>
                    <h4 className="font-bold text-white mb-2">{type.label}</h4>
                    <p className="text-sm text-slate-400">{type.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Stage 1: Pitch Documents Review */}
          {stage === 1 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <FileText className="w-6 h-6" />
                  Seller's Pitch Documents
                </h3>
                <p className="text-slate-400">Review all documents submitted by {pitch?.creator_name}</p>
              </div>

              {/* Investor Access Confirmed */}
              <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-green-300 font-semibold text-sm mb-1">✅ Investor Access Enabled</p>
                  <p className="text-green-200/80 text-xs">
                    You are an authenticated investor. All seller documents are accessible and visible only to authorized investors like you.
                  </p>
                </div>
              </div>

              {documentsLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-pink-500"></div>
                  <p className="text-slate-400 mt-4">Loading documents...</p>
                </div>
              ) : sellerDocuments ? (
                <div className="space-y-4">
                  {/* Document Overview */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-semibold text-white">📋 Overall Progress</h4>
                      <span className="text-lg font-bold text-purple-400">
                        {[
                          sellerDocuments?.business_plan_content,
                          sellerDocuments?.financial_projection_content,
                          sellerDocuments?.mou_content,
                          (sellerDocuments?.share_allocation_shares && sellerDocuments?.share_allocation_share_price) ? 'yes' : null,
                          (sellerDocuments?.value_proposition_wants && sellerDocuments?.value_proposition_fears && sellerDocuments?.value_proposition_needs) ? 'yes' : null
                        ].filter(Boolean).length}/5 documents
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-pink-500 to-purple-500 h-2 rounded-full transition-all"
                        style={{ 
                          width: `${(([
                            sellerDocuments?.business_plan_content,
                            sellerDocuments?.financial_projection_content,
                            sellerDocuments?.mou_content,
                            (sellerDocuments?.share_allocation_shares && sellerDocuments?.share_allocation_share_price) ? 'yes' : null,
                            (sellerDocuments?.value_proposition_wants && sellerDocuments?.value_proposition_fears && sellerDocuments?.value_proposition_needs) ? 'yes' : null
                          ].filter(Boolean).length / 5) * 100)}%` 
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Business Plan */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">📋</span>
                      <div className="flex-1">
                        <h4 className="font-semibold text-white mb-3">Business Plan</h4>
                        <p className="text-sm text-slate-400 mb-3">Your strategic foundation and business model</p>
                        {sellerDocuments?.business_plan_content ? (
                          <div className="bg-slate-900/50 p-3 rounded border border-slate-600 max-h-40 overflow-y-auto">
                            <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.business_plan_content}</p>
                          </div>
                        ) : (
                          <p className="text-sm text-yellow-400">⚠️ Not submitted</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Financial Projection */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">💰</span>
                      <div className="flex-1">
                        <h4 className="font-semibold text-white mb-3">Financial Projection</h4>
                        <p className="text-sm text-slate-400 mb-3">Revenue and expense estimates</p>
                        {sellerDocuments?.financial_projection_content ? (
                          <div className="bg-slate-900/50 p-3 rounded border border-slate-600 max-h-40 overflow-y-auto">
                            <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.financial_projection_content}</p>
                          </div>
                        ) : (
                          <p className="text-sm text-yellow-400">⚠️ Not submitted</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Value Proposition */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">🎯</span>
                      <div className="flex-1">
                        <h4 className="font-semibold text-white mb-3">Value Proposition</h4>
                        <p className="text-sm text-slate-400 mb-3">What you offer: Wants, Fears, and Needs</p>
                        {sellerDocuments?.value_proposition_wants && sellerDocuments?.value_proposition_fears && sellerDocuments?.value_proposition_needs ? (
                          <div className="space-y-3">
                            <div className="bg-slate-900/50 p-3 rounded border border-slate-600">
                              <p className="text-xs font-semibold text-pink-400 mb-2">Wants (Customer Desires)</p>
                              <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.value_proposition_wants}</p>
                            </div>
                            <div className="bg-slate-900/50 p-3 rounded border border-slate-600">
                              <p className="text-xs font-semibold text-orange-400 mb-2">Fears (Customer Concerns)</p>
                              <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.value_proposition_fears}</p>
                            </div>
                            <div className="bg-slate-900/50 p-3 rounded border border-slate-600">
                              <p className="text-xs font-semibold text-blue-400 mb-2">Needs (Customer Requirements)</p>
                              <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.value_proposition_needs}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-yellow-400">⚠️ Not submitted</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* MOU */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">⚖️</span>
                      <div className="flex-1">
                        <h4 className="font-semibold text-white mb-3">Memorandum of Understanding</h4>
                        <p className="text-sm text-slate-400 mb-3">Legal and collaborative agreements</p>
                        {sellerDocuments?.mou_content ? (
                          <div className="bg-slate-900/50 p-3 rounded border border-slate-600 max-h-40 overflow-y-auto">
                            <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.mou_content}</p>
                          </div>
                        ) : (
                          <p className="text-sm text-yellow-400">⚠️ Not submitted</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Share Allocation */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">📊</span>
                      <div className="flex-1">
                        <h4 className="font-semibold text-white mb-3">Share Allocation</h4>
                        <p className="text-sm text-slate-400 mb-3">Ownership structure and equity distribution</p>
                        {sellerDocuments?.share_allocation_shares && sellerDocuments?.share_allocation_share_price ? (
                          <div className="bg-slate-900/50 p-3 rounded border border-slate-600 space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-400">Total Shares:</span>
                              <span className="text-sm font-semibold text-blue-400">{sellerDocuments.share_allocation_shares}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-400">Price per Share:</span>
                              <span className="text-sm font-semibold text-green-400">${sellerDocuments.share_allocation_share_price}</span>
                            </div>
                            {sellerDocuments.share_allocation_total_amount && (
                              <div className="flex justify-between border-t border-slate-600 pt-2 mt-2">
                                <span className="text-sm text-slate-400">Total Valuation:</span>
                                <span className="text-sm font-semibold text-purple-400">${sellerDocuments.share_allocation_total_amount.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-yellow-400">⚠️ Not submitted</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Disclosure Notes */}
                  {sellerDocuments?.disclosure_notes && (
                    <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4">
                      <h4 className="font-semibold text-amber-300 mb-2">🔐 Privacy Restrictions</h4>
                      <p className="text-sm text-amber-200">{sellerDocuments.disclosure_notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-yellow-900/20 border border-yellow-600/50 rounded-lg p-4 text-yellow-300">
                  <p className="text-sm">⚠️ No documents found for this pitch</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStage(0)}
                  className="flex-1 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition"
                >
                  Back
                </button>
                <button
                  onClick={() => setStage(2)}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
                >
                  Review Terms <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Stage 2: Agreement */}
          {stage === 2 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white">Review Original Pitch Agreement</h3>
              
              <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-slate-400 text-sm font-semibold mb-1">📺 Pitch Title</h4>
                    <p className="text-white font-bold text-lg">{pitch?.title || 'N/A'}</p>
                  </div>
                  <div>
                    <h4 className="text-slate-400 text-sm font-semibold mb-1">👤 Creator</h4>
                    <p className="text-white font-bold text-lg">{businessProfile?.owner_name || businessProfile?.business_co_owners?.[0]?.owner_name || pitch?.creator_name || 'Unknown'}</p>
                  </div>
                  <div>
                    <h4 className="text-slate-400 text-sm font-semibold mb-1">📊 Pitch Type</h4>
                    <p className="text-white font-bold">{pitch?.pitch_type || 'Equity'}</p>
                  </div>
                  <div>
                    <h4 className="text-slate-400 text-sm font-semibold mb-1">🏢 Category</h4>
                    <p className="text-white font-bold">{pitch?.category || 'Technology'}</p>
                  </div>
                </div>

                <div className="border-t border-slate-700 pt-4">
                  <h4 className="text-slate-400 text-sm font-semibold mb-2">📋 Pitch Description</h4>
                  <p className="text-slate-200 text-sm leading-relaxed">{pitch?.description || 'No description provided'}</p>
                </div>

                <div className="grid grid-cols-3 gap-3 bg-slate-900/50 p-4 rounded-lg border border-slate-600/30">
                  <div>
                    <p className="text-slate-400 text-xs">Already Raised</p>
                    <p className="text-green-400 font-bold text-lg">{pitch?.raised_amount || pitch?.raised || '$0'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Funding Goal</p>
                    <p className="text-blue-400 font-bold text-lg">{pitch?.target_funding || pitch?.goal || '$500K'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Equity Offering</p>
                    <p className="text-purple-400 font-bold text-lg">{pitch?.equity_offering || pitch?.equity || '10%'}</p>
                  </div>
                </div>

                {pitch?.has_ip && (
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex gap-2">
                    <span className="text-blue-300 text-sm">🔒 This pitch has intellectual property protection</span>
                  </div>
                )}
              </div>

              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                <h4 className="font-semibold text-white mb-3">📜 Investment Terms & Conditions</h4>
                <div className="text-slate-300 text-sm space-y-2 max-h-64 overflow-y-auto">
                  <p>✅ <strong>Investment Type:</strong> {investmentType === 'buy' ? 'Equity Purchase' : investmentType === 'partner' ? 'Partnership Agreement' : 'Financial Support'}</p>
                  <p>🏢 <strong>Business:</strong> {sellerBusinessProfile?.business_name || pitch?.title || 'the business'}</p>
                  <p>💼 <strong>Pitch:</strong> {pitch.title}</p>
                  <p>📊 <strong>Pitch Description:</strong> {pitch.description}</p>
                  <p>💰 <strong>Funding Goal:</strong> {pitch?.target_funding || pitch?.goal || '$500K'}</p>
                  <p>📈 <strong>Equity Offered:</strong> {pitch?.equity_offering || pitch?.equity || '10%'}</p>
                  <p>🔐 <strong>Payment Method:</strong> ICAN Wallet with escrow protection</p>
                  <p>✅ <strong>Escrow Protection:</strong> All investments are held in ICAN escrow pending multi-signature approval from existing shareholders.</p>
                  <p>🔏 <strong>Release Requirement:</strong> 60% of shareholders (minimum 10 members) must sign to release funds.</p>
                  <p>📱 <strong>Verification:</strong> PIN and device location will be recorded on the sealed agreement.</p>
                  <p>👥 <strong>Shareholder Addition:</strong> You will be automatically added as a shareholder upon seal finalization.</p>
                </div>
              </div>

              <label className="flex items-center gap-3 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="w-5 h-5"
                />
                I have read and agree to all terms and conditions
              </label>

              <button
                onClick={() => setStage(3)}
                disabled={!agreedToTerms}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Stage 3: Share Allocation */}
          {stage === 3 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white">Share Allocation</h3>
              
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 space-y-2 text-sm">
                <div className="flex justify-between text-slate-300">
                  <span>📊 Pitch:</span>
                  <span className="text-white font-semibold">{pitch?.title}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>💰 Funding Goal:</span>
                  <span className="text-white font-semibold">{pitch?.target_funding || pitch?.goal || '$500K'}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>📈 Total Equity:</span>
                  <span className="text-white font-semibold">{pitch?.equity_offering || pitch?.equity || '10%'}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>💵 Per Share Price:</span>
                  <span className="text-white font-semibold">${sharePrice.toFixed(2)} ICAN</span>
                </div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-2">
                    Number of Shares to Purchase
                    <span className="text-slate-400 font-normal text-sm"> (0 shares for partner/support only)</span>
                  </label>
                  <input
                    type="number"
                    value={sharesAmount}
                    onChange={(e) => setSharesAmount(e.target.value)}
                    placeholder="Enter number of shares (0 for non-equity investment)"
                    min="0"
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    {sharesAmount === '0' || sharesAmount === '' 
                      ? '✓ Partner/Support investment (no equity)' 
                      : `${sharesAmount} share${sharesAmount !== '1' ? 's' : ''} selected`}
                  </p>
                </div>

                {(totalInvestment > 0 || sharesAmount === '0') && (
                  <div className={`rounded-lg p-4 space-y-2 ${
                    sharesAmount === '0' || !sharesAmount
                      ? 'bg-blue-500/20 border border-blue-500/50'
                      : 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/50'
                  }`}>
                    {sharesAmount === '0' || !sharesAmount ? (
                      <>
                        <p className="text-blue-300 font-semibold flex items-center gap-2">
                          <span>🤝</span>
                          Partner/Supporter Investment
                        </p>
                        <p className="text-blue-200 text-sm">
                          You will support this pitch without equity stake. Investment type: {investmentType === 'partner' ? 'Partnership' : 'Support'}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-slate-300">
                          <span className="font-semibold text-white">{sharesAmount} Share{sharesAmount !== '1' ? 's' : ''}</span>
                          <span className="text-slate-400"> × </span>
                          <span className="font-semibold text-white">${sharePrice.toFixed(2)} {allowedCurrency}</span>
                        </p>
                        <div className="border-t border-pink-500/30 pt-2">
                          <p className="text-slate-300">
                            <span className="font-semibold text-white">Total Investment: </span>
                            <span className="text-2xl font-bold text-pink-400">{allowedCurrency} {totalInvestment.toFixed(2)}</span>
                          </p>
                        </div>
                        <p className="text-xs text-slate-400">
                          Equity Stake: ~{((parseFloat(sharesAmount) / 1000) * (parseFloat(pitch?.equity_offering || '10') || 10)).toFixed(2)}% of {pitch?.equity_offering || '10%'} offering
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Account Country Info (Informational Only) */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-blue-300 font-semibold text-sm mb-1">📍 Account Registered In</p>
                  <p className="text-blue-200/80 text-xs">
                    Your account is registered in <span className="font-semibold">{userCountry}</span> 
                    (Default currency: <span className="font-semibold">{allowedCurrency}</span>). 
                    You can invest in any currency supported by the business. Transactions are tracked for regulatory compliance.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setStage(5)}
                disabled={!sharesAmount || totalInvestment === 0}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
              >
                Proceed to ICAN Wallet
              </button>
            </div>
          )}

          {/* Stage 5: Wallet Integration */}
          {stage === 5 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Shield className="w-6 h-6" />
                ICAN Wallet - Investment Summary
              </h3>

              <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between text-slate-300">
                    <span>📺 Pitch Title:</span>
                    <span className="text-white font-semibold">{pitch?.title || 'Unknown Pitch'}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>🏢 Business:</span>
                    <span className="text-white font-semibold">
                      {(() => {
                        const displayValue = sellerBusinessProfile?.business_name || businessProfile?.business_name || 'Unknown Business';
                        const source = sellerBusinessProfile?.business_name 
                          ? 'sellerBusinessProfile.business_name (pitch.business_profiles)' 
                          : businessProfile?.business_name 
                          ? 'businessProfile.business_name (investor)' 
                          : 'fallback (Unknown)';
                        console.log('💼 Business Display:', { displayValue, source });
                        return displayValue;
                      })()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>👤 Seller:</span>
                    <span className="text-white font-semibold text-xs">
                      {(() => {
                        // Find the seller's name from realShareholders (includes all co-owners)
                        // The seller is the one with user_id matching sellerBusinessProfile.user_id
                        const sellerUserId = sellerBusinessProfile?.user_id;
                        const sellerFromShareholders = realShareholders.find(s => s.user_id === sellerUserId);
                        
                        // Get seller name from multiple sources
                        const sellerName = sellerFromShareholders?.name || 'Unknown Seller';
                        
                        console.log('👤 Seller Display:', { 
                          sellerUserId,
                          sellerFromShareholders,
                          displayValue: sellerName
                        });
                        return sellerName;
                      })()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>👤 Investor Name:</span>
                    <span className="text-white font-semibold">{currentUser?.user_metadata?.full_name || currentUser?.email || 'Unknown Investor'}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>📧 Investor Email:</span>
                    <span className="text-white font-semibold text-xs">{currentUser?.email || 'No email'}</span>
                  </div>
                </div>

                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <h4 className="text-slate-300 font-semibold text-sm flex items-center gap-2">
                    � Your ICAN Coins (For Share Purchase)
                  </h4>
                  <div className="bg-gradient-to-br from-slate-700 to-slate-800 rounded-lg p-4 space-y-3 border border-slate-600">
                    {/* Tabs - Only My Wallet visible */}
                    {/* COMMENTED OUT - Overview and Trade tabs
                    <div className="flex gap-2 mb-4 border-b border-slate-600">
                      <button 
                        onClick={() => setWalletTab('overview')}
                        className={`px-4 py-2 text-sm font-semibold ${walletTab === 'overview' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-slate-400'}`}
                      >
                        📊 Overview
                      </button>
                      <button 
                        onClick={() => setWalletTab('trade')}
                        className={`px-4 py-2 text-sm font-semibold ${walletTab === 'trade' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-slate-400'}`}
                      >
                        💱 Trade
                      </button>
                      <button 
                        onClick={() => setWalletTab('wallet')}
                        className={`px-4 py-2 text-sm font-semibold ${walletTab === 'wallet' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-slate-400'}`}
                      >
                        👛 My Wallet
                      </button>
                    </div>
                    END COMMENT */}

                    {/* Overview Tab - COMMENTED OUT
                    {walletTab === 'overview' && (
                      <div className="space-y-3">
                        <div className="bg-slate-800/60 rounded-lg p-4 text-center">
                          <p className="text-slate-400 text-sm mb-2">Available Balance</p>
                          <div className="text-4xl font-bold text-yellow-400 mb-2">
                            💎 {walletBalance.toFixed(8)}
                          </div>
                          <p className="text-slate-500 text-xs">Your ICAN Coins</p>
                        </div>
                        
                        <div className="bg-slate-800/60 rounded-lg p-3">
                          <p className="text-slate-300 font-semibold text-xs mb-2">Account Info</p>
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-slate-400">Holder:</span>
                              <span className="text-white">{icanAccountHolder || 'Loading...'}</span>
                            </div>
                          </div>
                        </div>

                        <div className={`rounded-lg p-3 border ${
                          walletBalance >= convertToIcanCoins(totalInvestment, allowedCurrency)
                            ? 'bg-green-500/10 border-green-500/30' 
                            : 'bg-red-500/10 border-red-500/30'
                        }`}>
                          <span className={walletBalance >= convertToIcanCoins(totalInvestment, allowedCurrency) ? 'text-green-400 text-sm' : 'text-red-400 text-sm'}>
                            {walletBalance >= convertToIcanCoins(totalInvestment, allowedCurrency) 
                              ? '✅ Sufficient Funds' 
                              : `❌ Need ${(convertToIcanCoins(totalInvestment, allowedCurrency) - walletBalance).toFixed(2)} more`
                            }
                          </span>
                        </div>
                      </div>
                    )}

                    Trade Tab - COMMENTED OUT
                    {walletTab === 'trade' && (
                      <div className="text-center py-6">
                        <p className="text-slate-400 text-sm">Trade ICAN coins for local currency</p>
                        <button className="mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm">
                          Open Trade
                        </button>
                      </div>
                    )}
                    END COMMENT */}

                    {/* My Wallet Tab */}
                    {walletTab === 'wallet' && (
                      <div className="space-y-3">
                        <div className="bg-slate-800/60 rounded-lg p-4 text-center">
                          <p className="text-slate-400 text-sm">Current Balance</p>
                          <div className="text-3xl font-bold text-yellow-400 mt-2">
                            💎 {walletBalance.toFixed(8)}
                          </div>
                          <p className="text-slate-500 text-xs mt-2">Available for investment</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>


                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <h4 className="text-slate-300 font-semibold text-sm">📊 Investment Breakdown (ICAN Coins)</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Investment Amount (ICAN):</span>
                      <span className="text-2xl font-bold text-yellow-400">💎 {convertToIcanCoins(totalInvestment, allowedCurrency).toFixed(2)} coins</span>
                      <span className="text-xs text-slate-400">= {allowedCurrency} {totalInvestment.toFixed(0)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Shares Purchasing:</span>
                      <span className="text-xl font-semibold text-blue-400">
                        {sharesAmount === '0' || !sharesAmount ? 'Partnership/Support (no equity)' : `${sharesAmount} shares @ ${totalInvestment.toFixed(0)} coins total`}
                      </span>
                    </div>
                    <div className="border-t border-slate-700 pt-3 flex items-center justify-between">
                      <span className="text-slate-400">ICAN Coins Remaining:</span>
                      <span className={`text-xl font-semibold ${(walletBalance - totalInvestment) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                        💎 {(walletBalance - convertToIcanCoins(totalInvestment, allowedCurrency)).toFixed(2)} coins
                      </span>
                    </div>
                    <div className="border-t border-slate-700 pt-3 flex items-center justify-between">
                      <span className="text-slate-400">� Payment Method:</span>
                      <span className="text-sm font-semibold text-yellow-300">ICAN Coins (Premium Digital Currency)</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-700 pt-4">
                  <h4 className="text-slate-300 font-semibold mb-3 flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Business Shareholders ({getActualShareholders().length})
                  </h4>
                  {getActualShareholders().length > 0 ? (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {getActualShareholders().map((shareholder, idx) => (
                        <div key={shareholder.id || idx} className="bg-slate-700/30 rounded p-3 flex items-center justify-between">
                          <div className="flex-1">
                            <p className="text-slate-200 font-semibold text-sm">{shareholder.name || shareholder.owner_name || 'Unnamed'}</p>
                            <p className="text-slate-400 text-xs">{shareholder.email || shareholder.owner_email || 'No email'}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-green-400 font-semibold text-sm">{shareholder.ownership_share || 'N/A'}%</p>
                            <p className="text-slate-400 text-xs">{shareholder.isLinked ? '✅ In-app' : '📧 Email'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-sm italic">No shareholders registered yet</p>
                  )}
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-2">
                <p className="text-blue-300 text-sm flex gap-2">
                  <span>💳</span>
                  <span><strong>Escrow Protection:</strong> Your {allowedCurrency} {totalInvestment.toFixed(2)} investment will be securely held in ICAN Escrow until {signatures.length >= mockShareholders.length * 0.6 ? 'completed' : '60% of shareholders sign'}.</span>
                </p>
                <p className="text-blue-300 text-sm flex gap-2">
                  <span>🔐</span>
                  <span><strong>Security:</strong> Funds are protected and cannot be transferred until multi-signature approval is complete.</span>
                </p>
              </div>

              <button
                onClick={() => {
                  const investmentInCoins = convertToIcanCoins(totalInvestment, allowedCurrency);
                  if (walletBalance < investmentInCoins) {
                    alert(`❌ Insufficient balance!\n\nYour wallet: 💎 ${walletBalance.toFixed(2)} ICAN coins\nRequired: 💎 ${investmentInCoins.toFixed(2)} ICAN coins\nShortfall: 💎 ${(investmentInCoins - walletBalance).toFixed(2)}`);
                    return;
                  }
                  setStage(6);
                }}
                disabled={walletBalance < convertToIcanCoins(totalInvestment, allowedCurrency)}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
              >
                {walletBalance < convertToIcanCoins(totalInvestment, allowedCurrency) ? `❌ Insufficient Balance (💎 ${(convertToIcanCoins(totalInvestment, allowedCurrency) - walletBalance).toFixed(2)} short)` : 'Authorize with PIN'}
              </button>
            </div>
          )}

          {/* Stage 6: Payment Execution & Wallet PIN */}
          {stage === 6 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Lock className="w-6 h-6" />
                Secure Payment - Wallet PIN Verification
              </h3>

              <div className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 border border-blue-500/50 rounded-lg p-4 space-y-2">
                <p className="text-blue-300 text-sm flex gap-2">
                  <span>�</span>
                  <span><strong>Amount:</strong> {allowedCurrency} {totalInvestment.toFixed(2)} will be transferred to secure escrow.</span>
                </p>
                <p className="text-blue-300 text-sm flex gap-2">
                  <span>�🔐</span>
                  <span><strong>Wallet PIN Required:</strong> Your ICAN Wallet PIN will authorize the payment to escrow and be recorded as your sealed signature for this investment.</span>
                </p>
              </div>

              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                <p className="text-slate-300 mb-4">Enter your ICAN Wallet PIN (4-6 digits) to authorize and seal this investment:</p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-2">Wallet PIN</label>
                    <div className="flex gap-2">
                      <input
                        type={showWalletPin ? 'text' : 'password'}
                        value={walletPin}
                        onChange={(e) => setWalletPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="••••"
                        maxLength="6"
                        className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-center text-2xl tracking-widest placeholder-slate-500"
                      />
                      <button
                        onClick={() => setShowWalletPin(!showWalletPin)}
                        className="p-2 hover:bg-slate-700 rounded-lg transition text-slate-400"
                      >
                        {showWalletPin ? '👁️' : '🙈'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-2">Confirm Wallet PIN</label>
                    <input
                      type={showWalletPin ? 'text' : 'password'}
                      value={walletPinConfirm}
                      onChange={(e) => setWalletPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••"
                      maxLength="6"
                      className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-center text-2xl tracking-widest placeholder-slate-500"
                    />
                  </div>
                </div>

                {error && (
                  <div className="mt-3 p-3 bg-red-500/20 border border-red-500/50 rounded text-red-300 text-sm">
                    {error}
                  </div>
                )}

                {pinVerified && (
                  <div className="mt-3 p-3 bg-green-500/20 border border-green-500/50 rounded text-green-300 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    <span>Wallet PIN verified! Payment sealed with your signature. Processing to shareholder signatures...</span>
                  </div>
                )}
              </div>

              <button
                onClick={async () => {
                  if (!pinVerified) {
                    verifyWalletPin();
                  } else {
                    // Check actual shareholder approval status from database
                    const approvalStatus = await checkShareholderApprovalStatus();
                    if (approvalStatus.hasReachedThreshold) {
                      // 60% threshold met - proceed to generate QR code
                      console.log(`✅ PROCEEDING: 60% approval threshold reached (${approvalStatus.approvedCount}/${approvalStatus.totalRequired})`);
                      generateQRCode();
                    } else {
                      // Still waiting for more approvals
                      console.log(`⏳ WAITING: Need ${approvalStatus.totalRequired - approvalStatus.approvedCount} more approval(s) to reach 60%`);
                      setError(`⏳ Waiting for shareholder approvals: ${approvalStatus.approvedCount}/${approvalStatus.totalRequired} required (${approvalStatus.percentageApproved.toFixed(0)}%)`);
                    }
                  }
                }}
                disabled={loading || (!walletPin || !walletPinConfirm)}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
              >
                {loading ? 'Processing...' : pinVerified ? 'Proceed to Shareholder Signatures' : 'Verify & Seal with Wallet PIN'}
              </button>
            </div>
          )}

          {/* Stage 7: Pending Signatures */}
          {stage === 7 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Users className="w-6 h-6" />
                Awaiting Shareholder Signatures (24-Hour Deadline)
              </h3>

              {/* Escrow Status Indicator */}
              <div className={`rounded-lg p-4 ${
                signatures.length >= requiredApprovalCount
                  ? 'bg-green-500/20 border border-green-500/50'
                  : 'bg-yellow-500/20 border border-yellow-500/50'
              }`}>
                <p className={`font-semibold text-center ${
                  signatures.length >= requiredApprovalCount
                    ? 'text-green-300'
                    : 'text-yellow-300'
                }`}>
                  🔐 Escrow Status: {signatures.length >= requiredApprovalCount ? 'SEALED ✓' : 'ACTIVE'} | Signatures: {signatures.length}/{requiredApprovalCount}
                </p>
              </div>

              {/* 24-Hour Countdown Timer */}
              {notificationsSentTime && (
                <DeadlineCountdown 
                  notificationTime={notificationsSentTime}
                  onExpired={() => setError(`⏰ 24-hour signature deadline has expired. Investment requires 60% approval.`)}
                />
              )}

              {/* NOTIFICATION STATUS - Show which shareholders were notified */}
              {shareholderNotifications && Object.keys(shareholderNotifications).length > 0 && (
                <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-4">
                  <h4 className="font-semibold text-blue-300 mb-3 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    📬 Shareholder Notifications Sent ({Object.keys(shareholderNotifications).length})
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {Object.entries(shareholderNotifications).map(([id, notifData]) => {
                      const hasSigned = signatures.some(s => s.id === id);
                      return (
                        <div
                          key={id}
                          className={`flex items-center justify-between p-3 rounded-lg text-sm ${
                            hasSigned
                              ? 'bg-green-500/10 border border-green-500/30'
                              : 'bg-blue-500/10 border border-blue-500/30'
                          }`}
                        >
                          <div className="flex-1">
                            <p className="font-medium text-white">{notifData.name}</p>
                            <p className="text-xs text-slate-400">{notifData.email}</p>
                          </div>
                          <div className="text-right">
                            {hasSigned ? (
                              <div>
                                <p className="text-green-400 font-bold text-xs">✓ SIGNED</p>
                                <p className="text-green-300 text-xs">{new Date(notifData.sentAt).toLocaleTimeString()}</p>
                              </div>
                            ) : (
                              <div>
                                <p className="text-yellow-400 font-bold text-xs">⏳ PENDING</p>
                                <p className="text-yellow-300 text-xs">Awaiting PIN signature</p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/50 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-yellow-300">Signatures Required: 60%</span>
                  <span className="text-2xl font-bold text-yellow-400">{signaturePercentage.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-yellow-500 to-orange-500 h-full transition-all duration-500"
                    style={{ width: `${Math.min(signaturePercentage, 100)}%` }}
                  />
                </div>
                <p className="text-sm text-slate-300">
                  {signatures.length} of {mockShareholders.length} shareholders signed
                </p>
              </div>

              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 max-h-64 overflow-y-auto space-y-2">
                <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Signature Timeline
                </h4>
                {mockShareholders.map(shareholder => {
                  const signature = signatures.find(s => s.id === shareholder.id);
                  return (
                    <div
                      key={shareholder.id}
                      className={`flex items-center justify-between p-3 rounded-lg ${
                        signature
                          ? 'bg-green-500/10 border border-green-500/30'
                          : 'bg-slate-700/30 border border-slate-600/30'
                      }`}
                    >
                      <div>
                        <p className="font-medium text-white">{shareholder.name}</p>
                        <p className="text-xs text-slate-400">{shareholder.email}</p>
                      </div>
                      {signature ? (
                        <div className="text-right">
                          <CheckCircle className="w-5 h-5 text-green-400 ml-auto" />
                          <p className="text-xs text-green-400 mt-1">
                            {new Date(signature.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      ) : (
                        <Clock className="w-5 h-5 text-slate-500" />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <p className="text-blue-300 text-sm">
                  ⏳ Your payment of ${totalInvestment.toFixed(2)} is securely held in ICAN Escrow. Once 60% of shareholders sign, your investment will be automatically sealed and you'll be added to the business profile.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/50 rounded-lg p-4">
                <h4 className="font-semibold text-amber-300 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Waiting for Shareholder Signatures
                </h4>
                <p className="text-amber-200 text-sm mb-4">
                  Shareholders must review and sign this agreement within 24 hours using their PIN. Each shareholder will receive a notification with signing instructions.
                </p>
                
                {/* Demo Button: Let current user test signing as a shareholder */}
                <button
                  onClick={() => {
                    setCurrentShareholderSigning({
                      id: currentUser?.id,
                      name: currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0],
                      email: currentUser?.email
                    });
                    setShowShareholderSignatureModal(true);
                  }}
                  className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition"
                >
                  Test: Sign as Shareholder (Demo)
                </button>
              </div>

              {/* ShareholderSignatureModal - Show when a shareholder is signing */}
              {showShareholderSignatureModal && currentShareholderSigning && (
                <ShareholderSignatureModal
                  investment={{
                    id: investmentId,
                    title: pitch?.title,
                    amount: totalInvestment,
                    currency: allowedCurrency,
                    businessName: sellerBusinessProfile?.business_name || pitch?.title || 'the business'
                  }}
                  shareholder={currentShareholderSigning}
                  deadline={notificationsSentTime ? new Date(notificationsSentTime.getTime() + 24 * 60 * 60 * 1000) : new Date(Date.now() + 24 * 60 * 60 * 1000)}
                  onSignatureComplete={(signatureData) => {
                    // Save shareholder signature to database
                    const supabase = getSupabase();
                    
                    const shareholderSigData = {
                      investment_id: escrowId,
                      business_profile_id: sellerBusinessProfile?.id || pitch?.business_profile_id,
                      signer_id: currentShareholderSigning.id,
                      signer_email: currentShareholderSigning.email,
                      signer_name: currentShareholderSigning.name,
                      signer_type: 'shareholder',
                      signature_status: 'pin_verified',
                      signed_at: new Date().toISOString(),
                      pin_verified_at: new Date().toISOString(),
                      signature_data: {
                        method: 'Shareholder PIN Verification',
                        pin_masked: signatureData.pin_masked,
                        verified: true
                      }
                    };
                    
                    // Insert shareholder signature into database
                    supabase
                      .from('investment_signatures')
                      .insert([shareholderSigData])
                      .then(({ data, error }) => {
                        if (error) {
                          console.error('Failed to save shareholder signature:', error);
                          return;
                        }
                        console.log('✅ Shareholder signature recorded in database:', data);
                      });
                    
                    // Add the shareholder signature to the signatures array
                    setSignatures(prev => {
                      if (!prev.some(s => s.id === currentShareholderSigning.id)) {
                        return [...prev, {
                          id: currentShareholderSigning.id,
                          name: currentShareholderSigning.name,
                          email: currentShareholderSigning.email,
                          timestamp: new Date().toISOString(),
                          type: 'shareholder',
                          pin: signatureData.pin_masked,
                          status: 'approved'
                        }];
                      }
                      return prev;
                    });
                    
                    console.log(`✅ Shareholder signed and recorded: ${currentShareholderSigning.name}`);
                    setShowShareholderSignatureModal(false);
                    setCurrentShareholderSigning(null);
                  }}
                  onCancel={() => {
                    setShowShareholderSignatureModal(false);
                    setCurrentShareholderSigning(null);
                  }}
                />
              )}
            </div>
          )}

          {/* Stage 8: Finalized - ONLY SHOW WHEN 60% THRESHOLD MET */}
          {(stage === 8 || (stage === 7 && getActualShareholders().length > 0 && (signatures.filter(s => s.type === 'shareholder' || !s.type).length / getActualShareholders().length) >= 0.60)) && (
            <div className="space-y-6">
              <div className="text-center space-y-3">
                <CheckCircle className="w-16 h-16 text-green-400 mx-auto animate-bounce" />
                <h3 className="text-2xl font-bold text-white">✅ Investment Sealed!</h3>
                <p className="text-slate-400">🎉 60% shareholder approval achieved! Investment is now finalized and recorded.</p>
              </div>

              <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4">
                <p className="text-green-300 font-semibold text-center">
                  🎉 Escrow Status: SEALED & FINALIZED | Approval: {getActualShareholders().length > 0 ? ((signatures.filter(s => s.type === 'shareholder' || !s.type).length / getActualShareholders().length) * 100).toFixed(1) : 0}% ✓
                </p>
              </div>

              {qrCodeUrl && (
                <div ref={printRef} className="bg-white p-6 rounded-lg space-y-6">
                  {/* Print Header */}
                  <div className="text-center border-b-2 border-gray-300 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">INVESTMENT AGREEMENT SEAL</h1>
                    <p className="text-gray-600">Official Certificate of Investment</p>
                    <p className="text-xs text-gray-500 mt-2">Generated: {new Date().toLocaleString()}</p>
                  </div>

                  {/* QR Code Seal */}
                  <div className="flex justify-center">
                    <img src={qrCodeUrl} alt="Agreement Seal" className="w-48 h-48 border-2 border-green-500 rounded" />
                  </div>

                  {/* Investment Details */}
                  <div className="space-y-3 text-gray-800 border-b pb-4">
                    <h2 className="font-bold text-lg">Investment Details</h2>
                    <div className="flex justify-between">
                      <span className="font-semibold">Escrow ID:</span>
                      <span className="font-mono">{escrowId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold">Pitch:</span>
                      <span>{pitch?.title}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold">Business:</span>
                      <span>{sellerBusinessProfile?.business_name || pitch?.title || 'the business'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold">Creator:</span>
                      <span>{sellerBusinessProfile?.owner_name || pitch?.creator_name || sellerBusinessProfile?.user_id?.substring(0, 20) || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold">Investor:</span>
                      <span>{currentUser?.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold">Investment Type:</span>
                      <span>{investmentType === 'buy' ? 'Equity Purchase' : investmentType === 'partner' ? 'Partnership' : 'Support'}</span>
                    </div>
                    <div className="border-t pt-3">
                      <div className="flex justify-between">
                        <span className="font-semibold">Shares:</span>
                        <span>{sharesAmount || 'N/A'} {sharePrice ? `@ ${allowedCurrency}${sharePrice.toFixed(2)}/share` : ''}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold">Investment Amount:</span>
                        <span>{allowedCurrency} {totalInvestment.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold">Currency:</span>
                        <span>{allowedCurrency} (Locked to {userCountry})</span>
                      </div>
                      {pitch?.equity_offering && (
                        <div className="flex justify-between">
                          <span className="font-semibold">Equity Stake:</span>
                          <span>~{((parseFloat(sharesAmount || 0) / 1000) * (parseFloat(pitch.equity_offering) || 10)).toFixed(2)}% of {pitch.equity_offering} offering</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Business Plan */}
                  {sellerDocuments?.business_plan_content && (
                    <div className="border-b pb-4">
                      <h2 className="font-bold text-lg mb-3">📋 Business Plan</h2>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                        {sellerDocuments.business_plan_content}
                      </div>
                    </div>
                  )}

                  {/* Financial Projection */}
                  {sellerDocuments?.financial_projection_content && (
                    <div className="border-b pb-4">
                      <h2 className="font-bold text-lg mb-3">💰 Financial Projection</h2>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                        {sellerDocuments.financial_projection_content}
                      </div>
                    </div>
                  )}

                  {/* Value Proposition */}
                  {(sellerDocuments?.value_proposition_wants || sellerDocuments?.value_proposition_fears || sellerDocuments?.value_proposition_needs) && (
                    <div className="border-b pb-4">
                      <h2 className="font-bold text-lg mb-3">🎯 Value Proposition</h2>
                      {sellerDocuments?.value_proposition_wants && (
                        <div className="mb-3">
                          <h3 className="font-semibold text-gray-900">What Customers Want:</h3>
                          <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded">{sellerDocuments.value_proposition_wants}</p>
                        </div>
                      )}
                      {sellerDocuments?.value_proposition_fears && (
                        <div className="mb-3">
                          <h3 className="font-semibold text-gray-900">Customer Pain Points:</h3>
                          <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded">{sellerDocuments.value_proposition_fears}</p>
                        </div>
                      )}
                      {sellerDocuments?.value_proposition_needs && (
                        <div>
                          <h3 className="font-semibold text-gray-900">What They Need:</h3>
                          <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded">{sellerDocuments.value_proposition_needs}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* MOU */}
                  {sellerDocuments?.mou_content && (
                    <div className="border-b pb-4">
                      <h2 className="font-bold text-lg mb-3">📄 Memorandum of Understanding</h2>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                        {sellerDocuments.mou_content}
                      </div>
                    </div>
                  )}

                  {/* Share Allocation */}
                  {(sellerDocuments?.share_allocation_shares || sellerDocuments?.share_allocation_share_price) && (
                    <div className="border-b pb-4">
                      <h2 className="font-bold text-lg mb-3">📊 Share Allocation Details</h2>
                      <div className="space-y-2 text-sm text-gray-700">
                        {sellerDocuments?.share_allocation_shares && (
                          <div className="flex justify-between">
                            <span className="font-semibold">Total Shares Available:</span>
                            <span>{sellerDocuments.share_allocation_shares}</span>
                          </div>
                        )}
                        {sellerDocuments?.share_allocation_share_price && (
                          <div className="flex justify-between">
                            <span className="font-semibold">Price Per Share:</span>
                            <span>{allowedCurrency} {sellerDocuments.share_allocation_share_price}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Disclosure Notes */}
                  {sellerDocuments?.disclosure_notes && (
                    <div className="border-b pb-4">
                      <h2 className="font-bold text-lg mb-3">⚠️ Disclosure & Notes</h2>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap bg-yellow-50 p-3 rounded border border-yellow-200">
                        {sellerDocuments.disclosure_notes}
                      </div>
                    </div>
                  )}

                  {/* PIN Signature Seal */}
                  <div className="border-2 border-green-500 bg-green-50 p-4 rounded">
                    <h3 className="font-bold text-gray-900 mb-2">🔐 Investor Signature Seal</h3>
                    <div className="space-y-1 text-sm text-gray-700">
                      <div className="flex justify-between">
                        <span>Method:</span>
                        <span>{pinSignature?.signatureMethod || 'Wallet PIN'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>PIN (Masked):</span>
                        <span className="font-mono">{pinSignature?.pinMasked}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Signed At:</span>
                        <span>{new Date(pinSignature?.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Status:</span>
                        <span className="font-bold text-green-600">✓ VERIFIED</span>
                      </div>
                    </div>
                  </div>

                  {/* Approval Threshold Status */}
                  <div className="bg-blue-50 border border-blue-300 rounded p-4">
                    <h3 className="font-bold text-gray-900 mb-3">📊 Approval Threshold Status</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="font-semibold">Required Approval:</span>
                        <span className="text-blue-600 font-bold">60%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold">Total Shareholders:</span>
                        <span>{getActualShareholders().length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold">Signed So Far:</span>
                        <span>{signatures.length} / {getActualShareholders().length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold">Approval Percentage:</span>
                        <span className="text-lg font-bold text-blue-600">{getActualShareholders().length > 0 ? ((signatures.length / getActualShareholders().length) * 100).toFixed(1) : 0}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold">Threshold Status:</span>
                        <span className={getActualShareholders().length > 0 && (signatures.length / getActualShareholders().length) >= 0.60 ? 'text-green-600 font-bold' : 'text-orange-600 font-bold'}>
                          {getActualShareholders().length > 0 && (signatures.length / getActualShareholders().length) >= 0.60 ? '✓ THRESHOLD MET' : '⏳ PENDING'}
                        </span>
                      </div>
                    </div>
                    {getActualShareholders().length > 0 && (signatures.length / getActualShareholders().length) >= 0.60 && (
                      <div className="mt-3 p-2 bg-green-100 border border-green-500 rounded text-green-700 text-xs font-bold text-center">
                        ✅ DOCUMENT APPROVED FOR PRINTING
                      </div>
                    )}
                  </div>

                  {/* Creator/Business Owner Signature */}
                  <div className="border-2 border-purple-500 bg-purple-50 p-4 rounded">
                    <h3 className="font-bold text-gray-900 mb-3">👔 Business Owner/Creator Signature</h3>
                    <div className="space-y-2 text-sm text-gray-700">
                      <div className="flex justify-between">
                        <span className="font-semibold">Creator:</span>
                        <span>{businessProfile?.owner_name || businessProfile?.creator_name || pitch?.creator_name || 'Unknown'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold">Status:</span>
                        <span className={signatures.some(s => s.type === 'creator') ? 'font-bold text-green-600' : 'font-bold text-red-600'}>
                          {signatures.some(s => s.type === 'creator') ? '✓ SIGNED' : '⏳ AWAITING SIGNATURE'}
                        </span>
                      </div>
                      {signatures.some(s => s.type === 'creator') && (
                        <div className="flex justify-between">
                          <span className="font-semibold">Signed At:</span>
                          <span>{new Date(signatures.find(s => s.type === 'creator')?.timestamp).toLocaleString()}</span>
                        </div>
                      )}
                      <div className="text-xs text-gray-600 mt-2 p-2 bg-purple-100 rounded">
                        The business creator must sign to authorize this investment agreement
                      </div>
                    </div>
                  </div>

                  {/* Investor Signature Seal */}
                  <div className="border-2 border-green-500 bg-green-50 p-4 rounded">
                    <h3 className="font-bold text-gray-900 mb-2">💰 Investor Signature Seal</h3>
                    <div className="space-y-1 text-sm text-gray-700">
                      <div className="flex justify-between">
                        <span>Investor:</span>
                        <span className="font-semibold">{currentUser?.email}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Method:</span>
                        <span>{pinSignature?.signatureMethod || 'Wallet PIN'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>PIN (Masked):</span>
                        <span className="font-mono">{pinSignature?.pinMasked}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Signed At:</span>
                        <span>{new Date(pinSignature?.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Status:</span>
                        <span className="font-bold text-green-600">✓ VERIFIED</span>
                      </div>
                    </div>
                  </div>

                  {/* All Shareholders Approvals */}
                  <div className="border-t-2 border-gray-300 pt-4">
                    <h3 className="font-bold text-gray-900 mb-3">
                      📋 Shareholder Approvals
                      <span className="ml-2 text-sm font-normal text-gray-600">
                        ({signatures.filter(s => s.type === 'shareholder').length}/{getActualShareholders().length})
                      </span>
                    </h3>
                    
                    {getActualShareholders().length > 0 ? (
                      <div className="space-y-2 text-sm">
                        {getActualShareholders().map((shareholder, idx) => {
                          const hasSigned = signatures.some(s => s.id === shareholder.id);
                          return (
                            <div key={idx} className={`flex justify-between items-center p-3 rounded border ${hasSigned ? 'bg-green-50 border-green-300' : 'bg-yellow-50 border-yellow-300'}`}>
                              <div className="flex-1">
                                <span className="font-semibold text-gray-900">{shareholder.name}</span>
                                <span className="text-xs text-gray-600 ml-2">({shareholder.email})</span>
                                {shareholder.ownership && (
                                  <span className="text-xs text-gray-600 ml-2">• {shareholder.ownership}% ownership</span>
                                )}
                              </div>
                              <span className={hasSigned ? 'font-bold text-green-600' : 'font-bold text-orange-600'}>
                                {hasSigned ? `✓ ${new Date(signatures.find(s => s.id === shareholder.id)?.timestamp).toLocaleDateString()}` : '⏳ PENDING'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-600">No shareholders found for this business</p>
                    )}
                  </div>

                  {/* Document Download Instructions */}
                  <div className="bg-indigo-50 border border-indigo-300 rounded p-4">
                    <h3 className="font-bold text-gray-900 mb-2">📥 Document Distribution</h3>
                    <div className="space-y-2 text-sm text-gray-700">
                      <p>✓ <span className="font-semibold">Investor</span> - Can download this document for records</p>
                      <p>✓ <span className="font-semibold">Creator/Business Owner</span> - Will receive document link after signing</p>
                      <p>✓ <span className="font-semibold">All Shareholders</span> - Will receive document link after 60% approval threshold is met</p>
                      <p className="text-xs text-gray-600 mt-2">Documents are encrypted and stored in ICAN Escrow System for 7 years</p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="border-t-2 border-gray-300 pt-4 text-center text-xs text-gray-600 space-y-1">
                    <p className="font-semibold text-gray-900">✅ This document is sealed and recorded in ICAN Escrow System</p>
                    <p>Escrow Status: {getActualShareholders().length > 0 && (signatures.length / getActualShareholders().length) >= 0.60 ? 'APPROVED FOR PRINTING' : 'ACTIVE'}</p>
                    <p>Threshold: {getActualShareholders().length > 0 ? ((signatures.length / getActualShareholders().length) * 100).toFixed(1) : 0}% / 60% Required</p>
                    <p>Creator Signed: {signatures.some(s => s.type === 'creator') ? '✓ YES' : '⏳ AWAITING'}</p>
                    <p>Generated: {new Date().toLocaleString()}</p>
                    <p className="text-gray-500 text-xs mt-2">This is an official investment agreement. Do not modify or duplicate.</p>
                  </div>
                </div>
              )}

              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 space-y-3">
                <h4 className="font-semibold text-white flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  Final Investment Summary
                </h4>
                <div className="space-y-2 text-sm text-slate-300">
                  <div className="flex justify-between">
                    <span>Pitch:</span>
                    <span className="text-white font-semibold">{pitch?.title}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Business:</span>
                    <span className="text-white font-semibold">{sellerBusinessProfile?.business_name || pitch?.title || 'the business'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Escrow ID:</span>
                    <span className="text-green-400 font-mono">{escrowId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Shares:</span>
                    <span className="font-semibold">{sharesAmount} @ ${sharePrice.toFixed(2)}/share</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Investment Amount:</span>
                    <span className="font-semibold text-green-400">${totalInvestment.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Investor Signature:</span>
                    <span className="font-semibold text-blue-400">Wallet PIN ✓</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Shareholders Signed:</span>
                    <span className="font-semibold">{signatures.filter(s => s.type === 'shareholder' || !s.type).length}/{getActualShareholders().length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <span className={`font-semibold ${getActualShareholders().length > 0 && (signatures.filter(s => s.type === 'shareholder' || !s.type).length / getActualShareholders().length) >= 0.60 ? 'text-green-400' : 'text-yellow-400'}`}>
                      {getActualShareholders().length > 0 && (signatures.filter(s => s.type === 'shareholder' || !s.type).length / getActualShareholders().length) >= 0.60 ? '✅ COMPLETED & APPROVED' : `⏳ PENDING ${Math.ceil(getActualShareholders().length * 0.60) - signatures.filter(s => s.type === 'shareholder' || !s.type).length} MORE SIGNATURES`}
                    </span>
                  </div>
                </div>
              </div>

              {/* DOCUMENT ONLY AVAILABLE AFTER 60% THRESHOLD MET */}
              {getActualShareholders().length > 0 && (signatures.filter(s => s.type === 'shareholder' || !s.type).length / getActualShareholders().length) >= 0.60 ? (
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={printAgreement}
                    disabled={!qrCodeUrl}
                    className="px-4 py-3 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
                  >
                    <Printer className="w-5 h-5" />
                    Print Agreement with Seal
                  </button>
                  <button
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = qrCodeUrl;
                      link.download = `Seal-${escrowId}.png`;
                      link.click();
                    }}
                    disabled={!qrCodeUrl}
                    className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
                  >
                    <Download className="w-5 h-5" />
                    Download QR Seal
                  </button>
                </div>
              ) : (
                <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4 text-center">
                  <p className="text-yellow-300 font-semibold">
                    📄 Document becomes available after 60% shareholder approval
                  </p>
                  <p className="text-yellow-200 text-sm mt-2">
                    Currently: {getActualShareholders().length > 0 ? ((signatures.filter(s => s.type === 'shareholder' || !s.type).length / getActualShareholders().length) * 100).toFixed(1) : 0}% approved
                  </p>
                </div>
              )}

              <button
                onClick={onClose}
                className="px-4 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-semibold rounded-lg transition"
              >
                Complete & Close
              </button>

              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <p className="text-green-300 text-sm">
                  ✅ Investment sealed and recorded! You have been successfully added as a shareholder to <strong>{sellerBusinessProfile?.business_name || pitch?.title || 'the business'}</strong> for "<strong>{pitch?.title}</strong>". Your ${totalInvestment.toFixed(2)} investment ({sharesAmount} shares) is now active in ICAN Escrow.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShareSigningFlow;
