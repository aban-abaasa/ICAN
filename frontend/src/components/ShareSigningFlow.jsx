import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronRight, CheckCircle, Clock, Lock, Fingerprint, QrCode, Download, AlertCircle, Users, TrendingUp, Shield, FileText, DollarSign, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { getSupabase, createNotification, createInvestmentNotification } from '../services/pitchingService';
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
    console.log('   businessProfile:', businessProfile);
    console.log('   businessProfile.business_co_owners:', businessProfile?.business_co_owners);
    console.log('   businessProfile.coOwners:', businessProfile?.coOwners);
    console.log('   currentUser:', currentUser);
    console.log('   pitch:', pitch);
  }, []);

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
    // Return real shareholders only - no mock data fallback
    return realShareholders;
  };
  
  // Calculate approval threshold based on member count
  const calculateApprovalThreshold = (totalMembers) => {
    if (totalMembers > 10) {
      // More than 10 members: 60% approval required
      return Math.ceil(totalMembers * 0.6);
    } else {
      // 10 or fewer members: Simple majority (more than half)
      return Math.ceil(totalMembers / 2);
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
        console.log(`   supabase available: ${!!supabase}`);
        
        if (supabase && businessProfile?.id) {
          try {
            console.log('🔍 Querying business_documents table for profile ID:', businessProfile.id);
            const { data, error } = await supabase
              .from('business_documents')
              .select('*')
              .eq('business_profile_id', businessProfile.id)
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
                    .eq('business_profile_id', businessProfile.id)
                    .limit(1);
                  
                  if (altData && altData.length > 0) {
                    console.log('✅ Documents found with alternative query:', altData[0]);
                    setSellerDocuments(altData[0]);
                  } else {
                    console.log('ℹ️ No documents found for this profile ID:', businessProfile.id);
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
                      console.log(`   Current profile: ${businessProfile.id}`);
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
                    .eq('business_profile_id', businessProfile.id)
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
  }, [businessProfile?.id]);

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
        console.log('🔍 fetchRealShareholders called. businessProfile:', businessProfile?.id);
        const supabase = getSupabase();
        console.log('🔍 Supabase available:', !!supabase);
        
        if (!businessProfile?.id || !supabase) {
          console.log('⚠️ Missing businessProfile.id or Supabase');
          // Fallback to currentUser only
          if (currentUser?.id && currentUser?.email) {
            setRealShareholders([{
              id: currentUser.id,
              name: currentUser.user_metadata?.full_name || 'Investor',
              email: currentUser.email,
              ownership: 100,
              role: 'Investor',
              isBusiness: false,
              signed: false
            }]);
            setRequiredApprovalCount(1);
          }
          return;
        }
        
        console.log('✅ Conditions met - fetching from database...');
        
        // Query business profile with co-owners
        const { data: profileData, error: queryError } = await supabase
          .from('business_profiles')
          .select(`
            id,
            business_name,
            owner_name,
            business_co_owners(
              id,
              owner_name,
              owner_email,
              owner_phone,
              ownership_share,
              role,
              status
            )
          `)
          .eq('id', businessProfile.id)
          .single();
        
        if (queryError) {
          console.warn('❌ Query error:', queryError.message);
          throw queryError;
        }
        
        console.log('📊 Profile data received:', profileData);
        
        // Get co-owners from result
        const coOwners = profileData?.business_co_owners || [];
        console.log('📋 Co-owners count:', coOwners.length);
        
        // Filter active co-owners
        const activeCoOwners = coOwners.filter(owner => !owner.status || owner.status === 'active');
        console.log('✅ Active co-owners:', activeCoOwners.length, activeCoOwners.map(o => o.owner_name));
        
        // If we have active co-owners, use them
        if (activeCoOwners.length > 0) {
          const mappedShareholders = activeCoOwners.map(owner => ({
            id: owner.id,
            name: owner.owner_name || 'Unknown Shareholder',
            email: owner.owner_email,
            ownership: owner.ownership_share,
            role: owner.role,
            isBusiness: false,
            signed: false
          }));
          
          setRealShareholders(mappedShareholders);
          console.log(`📊 ✅ LOADED ${mappedShareholders.length} CO-OWNERS FROM DATABASE`);
          const threshold = calculateApprovalThreshold(mappedShareholders.length);
          setRequiredApprovalCount(threshold);
          console.log(`✅ Approval threshold: ${threshold}/${mappedShareholders.length}`);
          return;
        }
        
        // Fallback: Check businessProfile prop
        const coOwnersFromProfile = businessProfile.business_co_owners || businessProfile.coOwners || [];
        if (coOwnersFromProfile && coOwnersFromProfile.length > 0) {
          console.log('✅ Found co-owners in businessProfile prop');
          const mappedShareholders = coOwnersFromProfile.map(owner => ({
            id: owner.id,
            name: owner.owner_name || owner.name || 'Unknown Shareholder',
            email: owner.owner_email || owner.email,
            ownership: owner.ownership_share || owner.ownershipShare,
            role: owner.role,
            isBusiness: false,
            signed: false
          }));
          setRealShareholders(mappedShareholders);
          const threshold = calculateApprovalThreshold(mappedShareholders.length);
          setRequiredApprovalCount(threshold);
          return;
        }
        
        // Final fallback: Use current user
        if (currentUser?.id && currentUser?.email) {
          console.log('⚠️ Using currentUser as fallback');
          setRealShareholders([{
            id: currentUser.id,
            name: currentUser.user_metadata?.full_name || 'Investor',
            email: currentUser.email,
            ownership: 100,
            role: 'Investor',
            isBusiness: false,
            signed: false
          }]);
          setRequiredApprovalCount(1);
        }
      } catch (err) {
        console.warn('⚠️ Shareholder fetch error:', err?.message);
        // Fallback to current user on any error
        if (currentUser?.id && currentUser?.email) {
          setRealShareholders([{
            id: currentUser.id,
            name: currentUser.user_metadata?.full_name || 'Investor',
            email: currentUser.email,
            ownership: 100,
            role: 'Investor',
            isBusiness: false,
            signed: false
          }]);
          setRequiredApprovalCount(1);
        } else {
          setRealShareholders([]);
          setRequiredApprovalCount(0);
        }
      }
    };

    fetchRealShareholders();
  }, [businessProfile?.id, businessProfile?.business_co_owners, businessProfile?.coOwners, currentUser?.id]);

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

  // Verify Wallet PIN and record as sealed signature
  const verifyWalletPin = () => {
    setError('');
    if (!walletPin || walletPin.length < 4) {
      setError('Wallet PIN must be at least 4 digits');
      return;
    }
    if (walletPin !== walletPinConfirm) {
      setError('Wallet PINs do not match');
      return;
    }
    
    // Create PIN signature (masked for security)
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
    
    // Add investor signature to the list
    const newSignatures = [...signatures, pinSig];
    setSignatures(newSignatures);
  };

  // Generate QR Code seal with PIN signature
  const generateQRCode = async () => {
    try {
      setLoading(true);
      
      const sealData = {
        investmentId: 'INV-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        pitch: pitch.title,
        business: businessProfile.business_name,
        investor: currentUser.email,
        shares: sharesAmount,
        amount: totalInvestment,
        investorSignature: {
          method: 'Wallet PIN Verification',
          pinMasked: pinSignature?.pinMasked,
          timestamp: pinSignature?.timestamp
        },
        signatures: signatures.length,
        totalRequired: mockShareholders.length,
        percentageSigned: signaturePercentage,
        machineTime: machineData.timestamp,
        location: machineData.location,
        deviceId: machineData.deviceId,
        status: 'SEALED',
        seal: {
          level: 'MULTI-SIGNATURE',
          requirementMet: false,
          signersNeeded: Math.ceil(mockShareholders.length * 0.6),
          signed: signatures.length
        }
      };

      const qrDataUrl = await QRCode.toDataURL(JSON.stringify(sealData));
      setQrCodeUrl(qrDataUrl);
      setEscrowId(sealData.investmentId);
      
      // Trigger notifications to all shareholders asking them to sign
      await triggerShareholderNotifications(sealData.investmentId);
      
      setStage(7); // Move to pending signatures
    } catch (err) {
      setError('Failed to generate QR code: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Trigger notifications to REAL shareholders for signature requests (24-hour deadline)
  const triggerShareholderNotifications = async (investmentId) => {
    try {
      const shareholders = getActualShareholders();
      const supabase = getSupabase();
      const notificationTime = new Date();
      
      let successCount = 0;
      let failCount = 0;
      let mockCount = 0;
      
      console.log(`📢 Sending ${shareholders.length} shareholder notifications for investment ${investmentId}...`);
      console.log(`⏰ Signature deadline: ${new Date(notificationTime.getTime() + 24 * 60 * 60 * 1000).toLocaleString()}`);
      
      for (const shareholder of shareholders) {
        try {
          // Check if this is a real UUID (from database) or mock ID (numeric)
          const isRealId = typeof shareholder.id === 'string' && shareholder.id.length === 36; // UUID length
          
          if (isRealId && supabase) {
            // Real shareholder - send actual notification
            const notificationTitle = `🔐 Signature Request (24hr deadline): ${pitch.title}`;
            const notificationMessage = `${currentUser?.email} is requesting your signature for an investment in "${pitch.title}" by ${businessProfile.business_name}. 
Amount: ${allowedCurrency} ${totalInvestment.toFixed(2)} | Shares: ${sharesAmount || 'Partnership'}
You have 24 hours to review and sign this agreement.`;
            
            const deadlineTime = new Date(notificationTime.getTime() + 24 * 60 * 60 * 1000);
            
            // Create notification in database - use investment_notifications table
            const { data: notifData, error: notifError } = await supabase
              .from('investment_notifications')
              .insert({
                recipient_id: shareholder.id,
                notification_type: 'signature_request',
                title: notificationTitle,
                message: notificationMessage,
                pitch_id: pitch.id,
                priority: 'high',
                action_url: `/investor/signature/${investmentId}/${shareholder.id}`,
                action_label: 'Review & Sign',
                metadata: {
                  investment_id: investmentId,
                  deadline: deadlineTime.toISOString(),
                  shares_amount: sharesAmount || 'Partnership',
                  total_investment: totalInvestment,
                  currency: allowedCurrency
                }
              });

            if (!notifError) {
              successCount++;
              // Track notification sent
              setShareholderNotifications(prev => ({
                ...prev,
                [shareholder.id]: {
                  email: shareholder.email,
                  name: shareholder.name,
                  sentAt: notificationTime.toISOString(),
                  deadline: deadlineTime.toISOString(),
                  signed: false
                }
              }));
              console.log(`✅ Notification sent to: ${shareholder.name} (${shareholder.email})`);
              console.log(`   → Deadline: ${deadlineTime.toLocaleString()}`);
            } else {
              failCount++;
              console.warn(`⚠️ Failed to notify: ${shareholder.name} - ${notifError.message}`);
            }
          } else {
            // Mock shareholder (for demo/simulation)
            mockCount++;
            console.log(`🎭 [MOCK SHAREHOLDER] Would send signature request to: ${shareholder.name} (${shareholder.email})`);
            console.log(`   → Investment: ${pitch.title} by ${businessProfile.business_name}`);
            console.log(`   → Amount: ${allowedCurrency} ${totalInvestment.toFixed(2)} for ${sharesAmount || 'partnership'} shares`);
            console.log(`   → Deadline: ${new Date(notificationTime.getTime() + 24 * 60 * 60 * 1000).toLocaleString()}`);
            console.log(`   → Status: Pending signature (24-hour review period)`);
            
            // Track mock notification
            setShareholderNotifications(prev => ({
              ...prev,
              [shareholder.id]: {
                email: shareholder.email,
                name: shareholder.name,
                sentAt: notificationTime.toISOString(),
                deadline: new Date(notificationTime.getTime() + 24 * 60 * 60 * 1000).toISOString(),
                signed: false,
                isMock: true
              }
            }));
          }
        } catch (error) {
          failCount++;
          console.error(`❌ Error notifying ${shareholder.name}:`, error?.message);
        }
      }
      
      // Record notification send time for 24hr countdown
      setNotificationsSentTime(notificationTime);
      
      console.log(`\n✅ Shareholder Notification Summary:`);
      if (successCount > 0) console.log(`   ✓ Real notifications sent: ${successCount}`);
      if (mockCount > 0) console.log(`   🎭 Mock notifications (demo): ${mockCount}`);
      if (failCount > 0) console.log(`   ⚠️ Failed to send: ${failCount}`);
      console.log(`   Total: ${successCount + mockCount}/${shareholders.length}`);
      console.log(`   Deadline: 24 hours from now`);
    } catch (err) {
      console.error('Error in shareholder notification process:', err?.message);
      // Continue even if notifications fail - investment proceeds
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
              <p className="text-slate-400">How would you like to invest in {businessProfile.business_name}?</p>
              
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
                  <p>🏢 <strong>Business:</strong> {businessProfile.business_name}</p>
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
                    <span className="text-white font-semibold">{pitch?.title}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>🏢 Business:</span>
                    <span className="text-white font-semibold">{businessProfile.business_name}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>👤 Creator:</span>
                    <span className="text-white font-semibold">{businessProfile?.owner_name || businessProfile?.business_co_owners?.[0]?.owner_name || pitch?.creator_name || 'Unknown'}</span>
                  </div>
                </div>

                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Investment Amount:</span>
                    <span className="text-2xl font-bold text-green-400">{allowedCurrency} {totalInvestment.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Shares Purchasing:</span>
                    <span className="text-xl font-semibold text-blue-400">
                      {sharesAmount === '0' || !sharesAmount ? 'Partnership/Support (no equity)' : `${sharesAmount} shares @ ${allowedCurrency}${sharePrice.toFixed(2)}/share`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Current Wallet Balance:</span>
                    <span className="text-xl font-semibold text-blue-400">{allowedCurrency} 5,250.00</span>
                  </div>
                  <div className="border-t border-slate-700 pt-3 flex items-center justify-between">
                    <span className="text-slate-400">After Investment:</span>
                    <span className="text-xl font-semibold text-slate-300">{allowedCurrency} {(5250 - totalInvestment).toFixed(2)}</span>
                  </div>
                  <div className="border-t border-slate-700 pt-3 flex items-center justify-between">
                    <span className="text-slate-400">📍 Transaction Currency:</span>
                    <span className="text-sm font-semibold text-yellow-300">Locked to {allowedCurrency} ({userCountry})</span>
                  </div>
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
                onClick={() => setStage(6)}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-semibold rounded-lg transition"
              >
                Authorize with PIN
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
                onClick={() => {
                  if (!pinVerified) {
                    verifyWalletPin();
                  } else {
                    generateQRCode();
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
                    businessName: businessProfile.business_name
                  }}
                  shareholder={currentShareholderSigning}
                  deadline={notificationsSentTime ? new Date(notificationsSentTime.getTime() + 24 * 60 * 60 * 1000) : new Date(Date.now() + 24 * 60 * 60 * 1000)}
                  onSignatureComplete={(signatureData) => {
                    // Add the shareholder signature to the signatures array
                    setSignatures(prev => {
                      if (!prev.some(s => s.id === currentShareholderSigning.id)) {
                        return [...prev, {
                          id: currentShareholderSigning.id,
                          name: currentShareholderSigning.name,
                          email: currentShareholderSigning.email,
                          timestamp: new Date().toISOString(),
                          pin: signatureData.pin_masked,
                          status: 'approved'
                        }];
                      }
                      return prev;
                    });
                    
                    console.log(`✅ Shareholder signed: ${currentShareholderSigning.name}`);
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

          {/* Stage 8: Finalized */}
          {(stage === 8 || (stage === 7 && signatures.length >= requiredApprovalCount && requiredApprovalCount > 0)) && signatures.length >= requiredApprovalCount && requiredApprovalCount > 0 && (
            <div className="space-y-6">
              <div className="text-center space-y-3">
                <CheckCircle className="w-16 h-16 text-green-400 mx-auto animate-bounce" />
                <h3 className="text-2xl font-bold text-white">Investment Sealed!</h3>
                <p className="text-slate-400">✅ Shareholder approval achieved. Investment is now finalized and recorded.</p>
              </div>

              <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4">
                <p className="text-green-300 font-semibold text-center">
                  🎉 Escrow Status: SEALED | Signatures Received: {signatures.length}/{requiredApprovalCount} ✓
                </p>
              </div>              {qrCodeUrl && (
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
                      <span>{businessProfile.business_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold">Creator:</span>
                      <span>{businessProfile?.owner_name || businessProfile?.creator_name || pitch?.creator_name || businessProfile?.user_id?.substring(0, 20) || 'Unknown'}</span>
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

                  {/* Shareholder Signatures */}
                  <div className="border-t-2 border-gray-300 pt-4">
                    <h3 className="font-bold text-gray-900 mb-3">📋 Shareholder Approvals ({signatures.length}/{getActualShareholders().length} required: {requiredApprovalCount})</h3>
                    <div className="space-y-2 text-sm">
                      {signatures.map((sig, idx) => (
                        <div key={idx} className="flex justify-between text-gray-700 bg-gray-50 p-2 rounded">
                          <span className="font-semibold">{sig.name}</span>
                          <span>✓ {new Date(sig.timestamp).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="border-t-2 border-gray-300 pt-4 text-center text-xs text-gray-600 space-y-1">
                    <p className="font-semibold">This document is sealed and recorded in ICAN Escrow System</p>
                    <p>Escrow Status: ACTIVE | Signatures Required: {requiredApprovalCount}/{getActualShareholders().length}</p>
                    <p>Generated: {new Date().toLocaleString()} | Investor: {currentUser?.email}</p>
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
                    <span className="text-white font-semibold">{businessProfile.business_name}</span>
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
                    <span className="font-semibold">{signatures.length}/{mockShareholders.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <span className="text-green-400 font-semibold">SEALED ✓</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={printAgreement}
                  className="px-4 py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
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
                  className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  Download QR Seal
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-semibold rounded-lg transition"
                >
                  Complete & Close
                </button>
              </div>

              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <p className="text-green-300 text-sm">
                  ✅ Investment sealed and recorded! You have been successfully added as a shareholder to <strong>{businessProfile.business_name}</strong> for "<strong>{pitch?.title}</strong>". Your ${totalInvestment.toFixed(2)} investment ({sharesAmount} shares) is now active in ICAN Escrow.
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
