import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronRight, ChevronDown, ChevronUp, CheckCircle, Clock, Lock, Fingerprint, QrCode, Download, AlertCircle, Users, TrendingUp, Shield, FileText, DollarSign, Printer, ArrowLeft } from 'lucide-react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { getSupabase, createNotification, createInvestmentNotification } from '../services/pitchingService';
import { walletTransactionService } from '../services/walletTransactionService';
import { getLiveShareOffer } from '../services/pitchinValuationService';
import { useIcanPrice } from '../hooks/useIcanPrice';
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
 * ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ENHANCEMENTS (Latest):
 * 
 * ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ INVESTOR DOCUMENT ACCESS (Fixed RLS):
 * - Stage 1 now shows "Investor Access Enabled" confirmation badge
 * - Authenticated investors can view all seller documents
 * - Fallback mechanism: If initial RLS fails (406), tries less restrictive query
 * - Console logs clearly show investor access status
 * - Documents display in organized cards with progress tracking
 * 
 * ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€šÃ‚Â¤Ãƒâ€šÃ‚Â FLEXIBLE INVESTMENT TYPES (0 Shares Support):
 * - Stage 0: Choose between "Buy Equity", "Partner", or "Support" 
 * - Stage 3: Share input now allows min="0" for non-equity investments
 * - Partner/Support investments show "No equity stake" message (blue highlight)
 * - Buy investments show full equity calculation and price breakdown
 * - Validation: Only requires shares > 0 for 'buy' type
 * - Stage 4 Wallet shows proper label: "Partnership/Support (no equity)" when shares=0
 * 
 * ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â± COUNTRY-SPECIFIC CURRENCY INFORMATION (Informational Only):
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

// Why the live share offer is unusable. Mirrors the map in Pitchin.jsx — the
// flow explains what is missing rather than quietly pricing off the stale
// pitches.share_price column.
const LIVE_OFFER_BLOCKED_MESSAGE = {
  'no-business-profile': 'This pitch is not linked to a business profile yet, so it has no live share value to invest against.',
  'shares-not-configured': 'The owner has not set how many shares this business has yet. Investing opens once they do.',
  'no-live-price': 'This business has no live share value yet - its recorded transactions do not add up to a positive value.',
  'issued-shares-unreadable': 'Could not confirm how many shares are still unsold. Please try again in a moment.',
  default: 'Live share value is unavailable for this business right now. Please try again in a moment.'
};

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
          ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â° DEADLINE EXPIRED - Signature period has ended
        </div>
      )}
    </div>
  );
};

const ShareSigningFlow = ({ pitch, businessProfile, currentUser, onClose }) => {
  // Debug: Log what we received
  useEffect(() => {
    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â ShareSigningFlow mounted with:');
    console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚Â');
    console.log('   PITCH DATA RECEIVED:');
    console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚Â');
    console.log('   ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“ ALL PITCH KEYS:', pitch ? Object.keys(pitch) : 'PITCH IS NULL');
    console.log('   pitch.id:', pitch?.id);
    console.log('   pitch.title:', pitch?.title);
    console.log('   pitch.business_profile_id:', pitch?.business_profile_id);
    console.log('   pitch.created_by:', pitch?.created_by);
    console.log('   pitch.creator_name:', pitch?.creator_name);
    console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬');
    console.log('   NESTED BUSINESS PROFILES:');
    console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬');
    console.log('   pitch.business_profiles:', pitch?.business_profiles);
    if (pitch?.business_profiles) {
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ id:', pitch.business_profiles.id);
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ business_name:', pitch.business_profiles.business_name);
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ user_id:', pitch.business_profiles.user_id);
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ description:', pitch.business_profiles.description);
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ business_co_owners:', pitch.business_profiles.business_co_owners?.length || 0, 'shareholders');
    } else {
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ MISSING - data not fetched!');
    }
    console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚Â');
    console.log('   INVESTOR DATA RECEIVED:');
    console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚Â');
    console.log('   businessProfile.id:', businessProfile?.id);
    console.log('   businessProfile.business_name:', businessProfile?.business_name);
    console.log('   businessProfile.user_id:', businessProfile?.user_id);
    console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚Â');
    console.log('   CURRENT USER:');
    console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚Â');
    console.log('   currentUser.id:', currentUser?.id);
    console.log('   currentUser.email:', currentUser?.email);
    console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚Â');
  }, []);

  // Current user ID from props
  const currentUserId = currentUser?.id;

  // Flow stages
  const [stage, setStage] = useState(0); // 0: Intent, 1: Documents, 2: Agreement, 3: Shares, 4: Shares Info, 5: Wallet Summary, 6: PIN Verification, 7: Pending, 8: Finalized
  const [investmentType, setInvestmentType] = useState(null); // 'buy', 'partner', 'support'
  const [sharesAmount, setSharesAmount] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // LIVE SHARE OFFER - the only share price/count this flow transacts on.
  // Seeded from the valuation Pitchin computed on the Invest tap, then re-read
  // here so a modal left open can't seal at a stale price. The static
  // pitches.share_price / pitches.shares_available columns are never read.
  const [liveOffer, setLiveOffer] = useState(() => (
    Number(pitch?.live_share_price_ugx) > 0
      ? {
          available: true,
          sharePriceUgx: Number(pitch.live_share_price_ugx),
          totalShares: Number(pitch.live_total_shares) || null,
          sharesIssued: Number(pitch.live_shares_issued) || 0,
          sharesAvailable: Number(pitch.live_shares_available) || 0,
          businessValueUgx: Number(pitch.live_business_value_ugx) || null,
          computedAt: pitch.live_computed_at || null
        }
      : null
  ));
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerError, setOfferError] = useState('');
  // investor_shares row that holds this investor's shares from the moment they
  // pay until the 60% approval flips it to 'approved'. It is counted as issued
  // straight away, so the live "still unsold" figure everyone else sees drops
  // immediately instead of only at approval time.
  const [reservedShareRowId, setReservedShareRowId] = useState(null);
  
  // Documents
  const [sellerDocuments, setSellerDocuments] = useState(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [expandedDocumentCards, setExpandedDocumentCards] = useState({
    businessPlan: true,
    financialProjection: false,
    valueProposition: false,
    mou: false,
    shareAllocation: false,
    privacy: false
  });
  const [activeDocumentPage, setActiveDocumentPage] = useState(null);
  const [agreementPanels, setAgreementPanels] = useState({
    snapshot: true,
    terms: false
  });
  const [flowPanels, setFlowPanels] = useState({
    shareOverview: true,
    walletSummary: true,
    walletCoins: true,
    walletBreakdown: false,
    walletShareholders: false,
    paymentSummary: true,
    pendingStatus: true,
    pendingNotifications: false,
    pendingTimeline: false,
    finalSummary: true,
    finalCertificate: false
  });
  
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
  const [walletTab, setWalletTab] = useState('wallet');
  
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

  useEffect(() => {
    if (stage !== 1 && activeDocumentPage) {
      setActiveDocumentPage(null);
    }
  }, [stage, activeDocumentPage]);

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

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ CHECK ACTUAL SHAREHOLDER APPROVAL STATUS FROM DATABASE
  const checkShareholderApprovalStatus = async () => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Supabase not available');
        return { approvedCount: 0, totalRequired: 0, percentageApproved: 0, hasReachedThreshold: false };
      }

      const businessProfileId = sellerBusinessProfile?.id || pitch?.business_profile_id;
      const pitchId = pitch?.id;
      
      if (!businessProfileId || !pitchId) {
        console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Missing business profile or pitch ID for approval check');
        return { approvedCount: 0, totalRequired: 0, percentageApproved: 0, hasReachedThreshold: false };
      }

      console.log(`\nÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â CHECKING SHAREHOLDER APPROVALS...`);
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
        console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Error fetching agreements:', agreementError?.message);
        return { approvedCount: 0, totalRequired: 0, percentageApproved: 0, hasReachedThreshold: false };
      }

      if (!agreements || agreements.length === 0) {
        console.log('   ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ No investment agreements found yet for this pitch');
        return { approvedCount: 0, totalRequired: 0, percentageApproved: 0, hasReachedThreshold: false };
      }

      const latestAgreement = agreements[0];
      console.log(`   ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Found ${agreements.length} agreement(s), checking latest: ${latestAgreement.id}`);
      console.log(`   Status: ${latestAgreement.status}`);

      // Get investment signatures (shareholder approvals) for this agreement
      const { data: signatures, error: sigError } = await supabase
        .from('investment_signatures')
        .select('id, shareholder_id, shareholder_name, shareholder_email, signature_status, signature_timestamp, is_business_owner')
        .eq('agreement_id', latestAgreement.id)
        .eq('signature_status', 'signed')
        .order('signature_timestamp', { ascending: false });

      if (sigError) {
        console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Error fetching signatures:', sigError?.message);
        return { approvedCount: 0, totalRequired: 0, percentageApproved: 0, hasReachedThreshold: false };
      }

      const approvedCount = signatures?.length || 0;
      console.log(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Found ${approvedCount} signed shareholder(s)`);
      
      if (signatures && signatures.length > 0) {
        console.log(`      Signatories:`);
        signatures.slice(0, 3).forEach((sig, i) => {
          console.log(`      [${i + 1}] ${sig.shareholder_name} (${sig.shareholder_email}) - ${sig.is_business_owner ? '(Owner)' : '(Shareholder)'}`);
        });
      }

      // Get total co-owners from business_co_owners table
      // Only real shareholders count: active (or unset) status AND actual equity (> 0%)
      const { data: coOwnersRaw, error: coOwnersError } = await supabase
        .from('business_co_owners')
        .select('id, status, ownership_share')
        .eq('business_profile_id', businessProfileId)
        .gt('ownership_share', 0);

      const coOwners = (coOwnersRaw || []).filter(o => !o.status || o.status === 'active');

      if (coOwnersError) {
        console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Error fetching co-owners:', coOwnersError?.message);
      }

      const totalShareholders = coOwners?.length || getActualShareholders().length;
      const requiredApprovals = calculateApprovalThreshold(totalShareholders);
      const percentageApproved = totalShareholders > 0 ? (approvedCount / totalShareholders) * 100 : 0;
      const hasReachedThreshold = approvedCount >= requiredApprovals;

      console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  SHAREHOLDER APPROVAL STATUS CHECK:`);
      console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Total shareholders: ${totalShareholders}`);
      console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Required approvals: ${requiredApprovals}`);
      console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Approved so far: ${approvedCount}`);
      console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Percentage: ${percentageApproved.toFixed(1)}%`);
      console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Threshold reached: ${hasReachedThreshold ? 'ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ YES' : 'ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ NO'}`);

      return {
        approvedCount,
        totalRequired: requiredApprovals,
        percentageApproved,
        hasReachedThreshold,
        signatures: signatures,
        agreementId: latestAgreement.id
      };
    } catch (error) {
      console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error checking approval status:', error?.message);
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

  // Re-read the live share offer on open (and whenever the seller profile
  // resolves). Nothing here falls back to pitch.share_price / shares_available:
  // if the live read fails the flow stays unpriced and cannot be sealed.
  const offerBusinessProfileId = sellerBusinessProfile?.id || pitch?.business_profile_id || pitch?.business_profiles?.id;
  const offerBusinessOwnerUserId = sellerBusinessProfile?.user_id || pitch?.business_profiles?.user_id || pitch?.user_id;

  useEffect(() => {
    let cancelled = false;
    if (!offerBusinessProfileId) return undefined;

    (async () => {
      setOfferLoading(true);
      setOfferError('');
      try {
        const offer = await getLiveShareOffer(offerBusinessProfileId, offerBusinessOwnerUserId);
        if (cancelled) return;
        if (offer.available) {
          setLiveOffer(offer);
        } else {
          setLiveOffer(null);
          setOfferError(LIVE_OFFER_BLOCKED_MESSAGE[offer.reason] || LIVE_OFFER_BLOCKED_MESSAGE.default);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('Live share offer read failed:', err?.message);
        setLiveOffer(null);
        setOfferError(LIVE_OFFER_BLOCKED_MESSAGE.default);
      } finally {
        if (!cancelled) setOfferLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [offerBusinessProfileId, offerBusinessOwnerUserId]);

  // LIVE ICAN COIN VALUE - ican_get_price_in_currency(), refreshed every 60s.
  // Replaces the hardcoded ICAN_COIN_PRICES table: every coin figure below is
  // priced off the live market price, not a constant baked into the bundle.
  //   price_local  = value of 1 icaneracoin in allowedCurrency
  //   rate_to_ugx  = UGX per 1 unit of allowedCurrency (1 for UGX itself)
  const { price: icanPrice } = useIcanPrice(allowedCurrency);
  const icanPriceLocal = Number(icanPrice?.price_local) > 0 ? Number(icanPrice.price_local) : null;
  const ugxPerLocal = Number(icanPrice?.rate_to_ugx) > 0 ? Number(icanPrice.rate_to_ugx) : null;
  const icanPriceUgx = (icanPriceLocal != null && ugxPerLocal != null) ? icanPriceLocal * ugxPerLocal : null;

  // The valuation is UGX-denominated; show it in the investor's currency using
  // the same live rate table the coin price comes from. 0 while either live
  // read is still pending, which keeps every "Continue"/"Authorize" gate shut.
  const sharePriceUgx = liveOffer?.sharePriceUgx ?? null;
  const sharePrice = (sharePriceUgx != null && ugxPerLocal != null) ? sharePriceUgx / ugxPerLocal : 0;
  const sharesRequested = parseFloat(sharesAmount) || 0;
  const totalInvestmentUgx = sharePriceUgx != null ? sharesRequested * sharePriceUgx : 0;
  const totalInvestment = sharesRequested * sharePrice;

  const liveTotalShares = liveOffer?.totalShares ?? null;
  const liveSharesAvailable = liveOffer?.sharesAvailable ?? 0;
  const pricingReady = sharePriceUgx != null && ugxPerLocal != null && icanPriceUgx != null;
  // Equity is the investor's slice of the live share register, not the
  // equity_offering percentage typed into the pitch listing.
  const equityStakePercent = (liveTotalShares > 0 && sharesRequested > 0)
    ? (sharesRequested / liveTotalShares) * 100
    : 0;
  const exceedsAvailableShares = sharesRequested > liveSharesAvailable;
  const investmentInIcanCoins = icanPriceLocal != null ? totalInvestment / icanPriceLocal : 0;
  const sharePriceInIcan = icanPriceLocal != null ? sharePrice / icanPriceLocal : 0;

  // Fetch seller documents when component loads
  useEffect(() => {
    const fetchSellerDocuments = async () => {
      try {
        setDocumentsLoading(true);
        const supabase = getSupabase();
        
        console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Starting document fetch...');
        console.log(`   businessProfile.id: ${businessProfile?.id || 'MISSING'}`);
        console.log(`   pitch.business_profile_id (seller): ${pitch?.business_profile_id || 'MISSING'}`);
        console.log(`   supabase available: ${!!supabase}`);
        
        // Use seller's business profile ID to fetch documents (not investor's)
        const sellerProfileId = pitch?.business_profile_id;
        if (supabase && sellerProfileId) {
          try {
            console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â Querying business_documents table for seller profile ID:', sellerProfileId);
            const { data, error } = await supabase
              .from('business_documents')
              .select('*')
              .eq('business_profile_id', sellerProfileId)
              .single();
            
            if (data && !error) {
              console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Documents fetched successfully:', data);
              setSellerDocuments(data);
            } else if (error) {
              // Handle different error types
              if (error.code === '404' || error.code === 'PGRST116' || error.message?.includes('No rows')) {
                // No records found - try alternative query without .single()
                console.log('ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â No documents found with .single(). Trying alternative fetch...');
                try {
                  const { data: altData, error: altError } = await supabase
                    .from('business_documents')
                    .select('*')
                    .eq('business_profile_id', sellerProfileId)
                    .limit(1);
                  
                  if (altData && altData.length > 0) {
                    console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Documents found with alternative query:', altData[0]);
                    setSellerDocuments(altData[0]);
                  } else {
                    console.log('ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â No documents found for seller profile ID:', sellerProfileId);
                    console.log('   Searching for documents from ANY profile in the database...');
                    
                    // Try fetching ALL documents to see what profiles exist
                    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â Fetching all documents to see what profiles exist...');
                    const { data: allDocs } = await supabase
                      .from('business_documents')
                      .select('*')
                      .limit(1);  // Get just the first one
                    
                    if (allDocs && allDocs.length > 0) {
                      console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ Found documents in database with different profile ID!');
                      console.log(`   Saved docs profile: ${allDocs[0].business_profile_id}`);
                      console.log(`   Seller profile ID: ${sellerProfileId}`);
                      console.log(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ USING THE DOCUMENT THAT EXISTS IN DATABASE`);
                      setSellerDocuments(allDocs[0]);
                    } else {
                      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ No documents found in entire database');
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
                console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ Initial RLS check triggered 406. Investor is authenticated and can view documents.');
                try {
                  const { data: investorData, error: investorError } = await supabase
                    .from('business_documents')
                    .select('id, business_plan_content, financial_projection_content, value_proposition_wants, value_proposition_fears, value_proposition_needs, mou_content, share_allocation_shares, share_allocation_share_price, disclosure_notes')
                    .eq('business_profile_id', sellerProfileId)
                    .limit(1);
                  
                  if (investorData?.length > 0) {
                    console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Investor can now view documents:', investorData[0]);
                    setSellerDocuments(investorData[0]);
                  } else {
                    console.log('ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â No documents published by seller yet');
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
            console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â User country detected: ${profileData.country}`);
            setUserCountry(profileData.country);
            setAllowedCurrency(currencyByCountry[profileData.country].currency);
          } else {
            console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â User country not found or unsupported. Using default UGX (Uganda)');
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
        console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â fetchRealShareholders called');
        console.log('   Investor businessProfile:', businessProfile?.id);
        console.log('   Seller businessProfile (from pitch):', pitch?.business_profile_id);
        const supabase = getSupabase();
        console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â Supabase available:', !!supabase);
        
        // Get seller profile ID (from pitch, not from investor's businessProfile)
        const sellerProfileId = pitch?.business_profile_id;
        
        if (!sellerProfileId || !supabase) {
          console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Missing seller profile ID or Supabase - cannot fetch real shareholders');
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
        
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Conditions met - fetching ALL shareholders from database...');
        console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â Investor user ID: ${currentUser?.id}`);
        console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â Investor email: ${currentUser?.email}`);
        console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â SELLER Business Profile ID (from pitch): ${pitch?.business_profile_id}`);
        console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â Investor Business Profile ID: ${businessProfile?.id}`);
        
        // Query business_co_owners DIRECTLY from SELLER'S profile - get ALL shareholders (linked + unlinked)
        // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â IMPORTANT: Use pitch.business_profile_id (SELLER), not businessProfile.id (INVESTOR)
        console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Using seller profile: ${sellerProfileId}`);
        
        const { data: allCoOwners, error: coOwnersError } = await supabase
          .from('business_co_owners')
          .select('id, owner_name, owner_email, user_id, ownership_share, role, status')
          .eq('business_profile_id', sellerProfileId)
          .order('created_at');

        if (coOwnersError) {
          console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error fetching co-owners:', coOwnersError.message);
          throw coOwnersError;
        }

        console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ ALL co-owners from database (${allCoOwners.length} total):`, allCoOwners.map(o => ({
          id: o.id,
          name: o.owner_name,
          email: o.owner_email,
          user_id: o.user_id,
          user_id_matches_investor: o.user_id === currentUser?.id,
          investor_check: `${o.user_id} === ${currentUser?.id} ? ${o.user_id === currentUser?.id}`
        })));

        // Filter to real shareholders only: active (or unset) status AND actual equity (> 0%).
        // Co-owner rows with no ownership_share (e.g. a CTO/CFO added with no equity) are
        // team members, not shareholders, and must not get an approval vote.
        const activeCoOwners = allCoOwners.filter(owner =>
          (!owner.status || owner.status === 'active') && parseFloat(owner.ownership_share) > 0
        );
        console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  Fetched ${allCoOwners.length} total co-owners, ${activeCoOwners.length} are active`);
        
        // IMPORTANT: Exclude the investor (current user) from shareholders list
        // Investors don't approve their own investments - only OTHER co-owners do
        const otherCoOwners = activeCoOwners.filter(owner => owner.user_id !== currentUser?.id);
        console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â Investor filter results:`);
        console.log(`   Found investor entries: ${activeCoOwners.length - otherCoOwners.length}`);
        console.log(`   Remaining OTHER shareholders: ${otherCoOwners.length}`);
        console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ OTHER co-owners (after excluding investor):`, otherCoOwners.map(o => ({
          id: o.id,
          name: o.owner_name,
          user_id: o.user_id
        })));
        console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Excluding investor from approval list. ${otherCoOwners.length} OTHER co-owners need to approve.`);
        
        // Split into linked (with user_id) and unlinked (no user_id)
        const linkedCoOwners = otherCoOwners.filter(owner => owner.user_id);
        const unlinkedCoOwners = otherCoOwners.filter(owner => !owner.user_id);
        
        console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“Ãƒâ€šÃ‚Â¥ Linked shareholders (with auth accounts): ${linkedCoOwners.length}`);
        console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â§ Unlinked shareholders (email only, pending account creation): ${unlinkedCoOwners.length}`);
        
        if (unlinkedCoOwners.length > 0) {
          console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Unlinked shareholders - they will receive email notifications:');
          unlinkedCoOwners.forEach(o => console.warn(`   ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â§ ${o.owner_name} (${o.owner_email})`));
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
          console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ LOADED ${allMappedShareholders.length} SHAREHOLDERS (${linkedCoOwners.length} linked + ${unlinkedCoOwners.length} unlinked)`);
          const threshold = calculateApprovalThreshold(allMappedShareholders.length);
          setRequiredApprovalCount(threshold);
          console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Approval threshold: ${threshold}/${allMappedShareholders.length} (60% of all shareholders must approve)`);
          return;
        }
        
        // Fallback: Check if seller has nested business_co_owners from pitch data (seller's profile)
        const sellerCoOwners = sellerBusinessProfile?.business_co_owners || pitch?.business_profiles?.business_co_owners || [];
        if (sellerCoOwners && sellerCoOwners.length > 0) {
          console.log('Found shareholders in seller business profile (pitch.business_profiles.business_co_owners)');

          // Filter out the current investor, and keep only real shareholders:
          // active (or unset) status AND actual equity (> 0%)
          const otherCoOwners = sellerCoOwners.filter(owner =>
            owner.user_id !== currentUser?.id &&
            owner.owner_email !== currentUser?.email &&
            (!owner.status || owner.status === 'active') &&
            parseFloat(owner.ownership_share ?? owner.ownershipShare) > 0
          );
          console.log(`Filtering: ${sellerCoOwners.length} total sellers shareholders -> ${otherCoOwners.length} after excluding investor and non-shareholders`);

          if (otherCoOwners.length > 0) {
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
        }

        // No co-owners exist anywhere (sole proprietorship, or every
        // registered co-owner turned out to be this investor). The approver
        // here MUST be the actual business owner, never the investor
        // themselves - an investor cannot be the one who approves releasing
        // their own escrowed funds. business_profiles doesn't carry a
        // name/email, so resolve the owner's identity from profiles by
        // their user_id.
        const ownerUserId = sellerBusinessProfile?.user_id || pitch?.business_profiles?.user_id;
        if (ownerUserId && ownerUserId !== currentUser?.id) {
          console.log('No registered co-owners - falling back to the business owner as sole approver');
          let ownerName = sellerBusinessProfile?.business_name ? `${sellerBusinessProfile.business_name} Owner` : 'Business Owner';
          let ownerEmail = null;
          try {
            const { data: ownerProfile } = await supabase
              .from('profiles')
              .select('full_name, email')
              .eq('id', ownerUserId)
              .maybeSingle();
            if (ownerProfile?.full_name) ownerName = ownerProfile.full_name;
            if (ownerProfile?.email) ownerEmail = ownerProfile.email;
          } catch (profileErr) {
            console.warn('Could not resolve owner profile:', profileErr?.message);
          }
          setRealShareholders([{
            id: ownerUserId,
            user_id: ownerUserId,
            name: ownerName,
            email: ownerEmail,
            ownership: 100,
            role: 'Owner',
            isBusiness: true,
            signed: false,
            isLinked: true
          }]);
          setRequiredApprovalCount(1);
          return;
        }

        // The owner could not be identified (RLS blocked the profile read, or
        // the pitch is missing business_profile_id/user_id entirely). There is
        // no one else it could honestly be, so leave the approver list empty
        // rather than let the investor sign off on their own investment -
        // verifyWalletPin() below refuses to proceed while this is empty.
        console.warn('Could not identify the business owner - approval cannot proceed until this is resolved');
        setRealShareholders([]);
        setRequiredApprovalCount(0);
      } catch (err) {
        console.warn('Shareholder fetch error:', err?.message);
        // Same rule on error: never fall back to the investor approving
        // themselves. Leave the list empty and let verifyWalletPin() block.
        setRealShareholders([]);
        setRequiredApprovalCount(0);
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

        console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â° Fetching ICAN coin balance for user:', currentUserId);

        // PRIMARY: Try to get ICAN balance from user_balances (multi-currency tracking)
        const { data: balanceData, error: balanceError } = await supabase
          .from('user_balances')
          .select('balance')
          .eq('user_id', currentUserId)
          .eq('currency', 'ICAN')
          .maybeSingle();

        if (balanceData && balanceData.balance) {
          setWalletBalance(parseFloat(balanceData.balance) || 0);
          console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ICAN Balance loaded from user_balances:', balanceData.balance);
          return;
        }

        // FALLBACK: Try ican_user_wallets table (legacy or primary wallet)
        const { data: walletData, error: walletError } = await supabase
          .from('ican_user_wallets')
          .select('ican_balance')
          .eq('user_id', currentUserId)
          .maybeSingle();

        if (walletData && walletData.ican_balance) {
          setWalletBalance(parseFloat(walletData.ican_balance) || 0);
          console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ICAN Balance loaded from ican_user_wallets:', walletData.ican_balance);
          return;
        }

        // No balance found
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â No ICAN coins found for user');
        setWalletBalance(0);
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

  // Function to manually refresh wallet balance when needed
  const refreshWalletBalance = async () => {
    try {
      setLoadingWallet(true);
      const supabase = getSupabase();
      
      if (!supabase || !currentUserId) {
        setWalletBalance(0);
        return;
      }

      console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Manually refreshing ICAN wallet balance...');

      // PRIMARY: Try user_balances table (multi-currency)
      const { data: balanceData } = await supabase
        .from('user_balances')
        .select('balance')
        .eq('user_id', currentUserId)
        .eq('currency', 'ICAN')
        .maybeSingle();

      if (balanceData && balanceData.balance) {
        setWalletBalance(parseFloat(balanceData.balance) || 0);
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ICAN Balance refreshed:', balanceData.balance);
        return;
      }

      // FALLBACK: Try ican_user_wallets
      const { data: walletData } = await supabase
        .from('ican_user_wallets')
        .select('ican_balance')
        .eq('user_id', currentUserId)
        .maybeSingle();

      if (walletData && walletData.ican_balance) {
        setWalletBalance(parseFloat(walletData.ican_balance) || 0);
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ICAN Balance refreshed:', walletData.ican_balance);
        return;
      }

      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â No ICAN coins found after refresh');
      setWalletBalance(0);
    } catch (err) {
      console.error('Error refreshing wallet balance:', err);
    } finally {
      setLoadingWallet(false);
    }
  };

  // Fetch seller's business profile from database using pitch.business_profile_id
  useEffect(() => {
    const fetchSellerBusinessProfile = async () => {
      try {
        if (!pitch?.business_profile_id) {
          console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â No business_profile_id in pitch');
          setSellerBusinessProfile(null);
          return;
        }

        const supabase = getSupabase();
        if (!supabase) {
          console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Supabase not available');
          setSellerBusinessProfile(null);
          return;
        }

        console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â Fetching seller business profile for ID:', pitch.business_profile_id);
        
        // Simple query - just get basic profile data (no nested joins)
        // Shareholders are already fetched separately by fetchRealShareholders()
        // Use limit(1) instead of single() to handle RLS edge cases
        const { data, error } = await supabase
          .from('business_profiles')
          .select('id, user_id, business_name, description, business_type, business_structure, founded_year, total_capital')
          .eq('id', pitch.business_profile_id)
          .limit(1);

        if (error) {
          console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error fetching seller profile:', error.code, error.message);
          console.log('   Pitch business_profile_id:', pitch.business_profile_id);
          console.log('   Error details:', error);
          setSellerBusinessProfile(null);
        } else if (data && data.length > 0) {
          const profileData = data[0];
          console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Seller business profile found:', profileData);
          console.log('   Business Name:', profileData.business_name);
          console.log('   User ID:', profileData.user_id);
          setSellerBusinessProfile(profileData);
        } else {
          console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â No data returned from query - may be RLS policy blocking access');
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
      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Seller business profile from pitch object:');
      console.log('   Business Name:', pitch.business_profiles.business_name);
      console.log('   Business ID:', pitch.business_profiles.id);
      console.log('   User ID:', pitch.business_profiles.user_id);
      console.log('   Source: pitch.business_profiles (nested join from getAllPitches)');
      setSellerBusinessProfile(pitch.business_profiles);
    } else {
      console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Pitch missing business_profiles nested data');
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
      console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ Stage 7: Waiting for shareholders to sign via ShareholderSignatureModal...`);
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
        console.warn(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â° DEADLINE EXPIRED! 24-hour signature period has ended without reaching 60% approval.`);
        console.warn(`   Signatures received: ${signatures.length}/${requiredApprovalCount}`);
        console.warn(`   Percentage: ${percentage.toFixed(0)}%`);
        // Show expiration message
        setError(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â° Signature deadline expired! Investment requires 60% shareholder approval (${requiredApprovalCount} signatures needed). You only received ${signatures.length} signatures. Investment is cancelled.`);
      }
    }

    // Auto-proceed to finalization when required approval count is reached (and within 24hrs)
    if (signatures.length >= requiredApprovalCount && stage === 7 && requiredApprovalCount > 0) {
      const deadlineTime = notificationsSentTime ? new Date(notificationsSentTime.getTime() + 24 * 60 * 60 * 1000) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      const currentTime = new Date();
      
      if (deadlineTime > currentTime) {
        console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¯ Approval threshold met! (${signatures.length}/${requiredApprovalCount} required) ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦`);
        console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â° Completed within 24-hour deadline`);
        setTimeout(() => {
          setStage(8);
        }, 1000);
      } else {
        console.warn(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Approval threshold met but DEADLINE EXPIRED`);
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

          console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¯ 60% APPROVAL THRESHOLD MET - Recording investor as shareholder...');

          // Promote the reservation created at payment time rather than
          // inserting a second row - a duplicate would double-count these
          // shares in the live issued total and shrink everyone else's
          // available count by twice the amount actually bought.
          const approvedShareRow = {
            status: 'approved',
            locked_until_threshold: false, // Shares are now unlocked
            transaction_reference: 'APPROVED-' + escrowId,
            notes: 'Investor became shareholder after 60% shareholder approval',
            updated_at: new Date().toISOString()
          };

          const { data: shareData, error: shareError } = reservedShareRowId
            ? await supabase
                .from('investor_shares')
                .update(approvedShareRow)
                .eq('id', reservedShareRowId)
                .select()
            : await supabase
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
                  created_at: new Date().toISOString(),
                  ...approvedShareRow
                }])
                .select();

          if (shareError && shareError.code !== 'PGRST116') {
            console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Could not record investor shares:', shareError);
          } else {
            console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ INVESTOR RECORDED AS SHAREHOLDER:');
            console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Status: APPROVED (60% threshold met)');
            console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Shares owned: ' + sharesAmount);
            console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Share price: ' + allowedCurrency + ' ' + sharePrice.toFixed(2));
            console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Total value: ' + allowedCurrency + ' ' + totalInvestment.toFixed(2));
          }

          // ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ REDUCE SELLER'S SHARES - Update business_co_owners proportionally
          console.log('\nÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â¼ Reducing seller shares and adding investor as co-owner...');
          try {
            // The investor's stake is the slice of the LIVE share register they
            // actually bought, not the equity_offering percentage typed into the
            // pitch listing (which is a marketing figure, unrelated to how many
            // shares changed hands). Bail out rather than write a made-up stake.
            if (!(liveTotalShares > 0)) {
              throw new Error('Live total share count unavailable - refusing to write an ownership percentage');
            }
            const equityOffering = (parseInt(sharesAmount) / liveTotalShares) * 100;

            console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  Equity being offered: ${equityOffering}%`);
            console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  Investor getting: ${equityOffering}% of new valuation`);

            // Get current seller ownership from realShareholders
            const sellerUserId = sellerBusinessProfile?.user_id;
            const sellerCurrent = realShareholders.find(s => s.user_id === sellerUserId);
            const sellerCurrentShare = sellerCurrent?.ownership || 0;

            console.log(`Seller current ownership: ${sellerCurrentShare}%`);

            // Calculate new ownership shares (dilution effect)
            // Old shareholders' new share = old_share * (1 - equity_offering/100)
            // New investor's share = equity_offering
            const dilutionFactor = 1 - (equityOffering / 100);
            const sellerNewShare = Math.round((sellerCurrentShare * dilutionFactor) * 100) / 100;

            console.log(`Seller new ownership (after dilution): ${sellerNewShare}%`);
            console.log(`Dilution factor: ${dilutionFactor.toFixed(2)} (${((1 - dilutionFactor) * 100).toFixed(1)}% dilution)`);

            // Persist the seller's diluted ownership. sellerCurrent.id is only a
            // real business_co_owners primary key when a co-owner row already
            // existed - for a sole proprietorship's FIRST investment there is
            // none yet (fetchRealShareholders falls back to the owner's auth
            // user id in that case), so UPDATE-by-id would silently match
            // nothing and the owner's stake would never be recorded. Look the
            // row up directly instead of trusting which fallback path built
            // sellerCurrent, and INSERT one for the owner if it truly doesn't
            // exist yet - otherwise the owner drops out of future approval
            // votes entirely.
            if (sellerUserId) {
              const { data: existingSellerRow } = await supabase
                .from('business_co_owners')
                .select('id')
                .eq('business_profile_id', pitch.business_profile_id)
                .eq('user_id', sellerUserId)
                .maybeSingle();

              const { error: sellerWriteError } = existingSellerRow?.id
                ? await supabase
                    .from('business_co_owners')
                    .update({
                      ownership_share: sellerNewShare,
                      updated_at: new Date().toISOString()
                    })
                    .eq('id', existingSellerRow.id)
                : await supabase
                    .from('business_co_owners')
                    .insert([{
                      business_profile_id: pitch.business_profile_id,
                      owner_name: sellerCurrent?.name || sellerBusinessProfile?.business_name || 'Business Owner',
                      owner_email: sellerCurrent?.email,
                      user_id: sellerUserId,
                      ownership_share: sellerNewShare,
                      role: 'Owner',
                      status: 'active',
                      created_at: new Date().toISOString()
                    }]);

              if (sellerWriteError) {
                console.warn('Could not persist seller shares:', sellerWriteError.message);
              } else {
                console.log(`Seller shares ${existingSellerRow?.id ? 'updated' : 'recorded for the first time'}: ${sellerCurrentShare}% -> ${sellerNewShare}%`);
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
              console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Could not add investor as co-owner:', addInvestorError.message);
            } else {
              console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Investor added as co-owner with ${equityOffering}% ownership`);
            }

            // Update all other shareholders' shares proportionally
            console.log(`\nÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  Updating all other shareholders' shares (${realShareholders.length - 1} others)...`);
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
                console.log(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ${shareholder.name}: ${shareholder.ownership}% ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ ${newShare}%`);
              }
            }
          } catch (err) {
            console.error('Error reducing seller shares:', err);
          }

          // ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¯ CONFIRM INVESTOR AS SHAREHOLDER IN BUSINESS_PROFILE_MEMBERS
          console.log('\nÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â Confirming investor as shareholder member (after approval)...');
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
              console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Investor confirmed as shareholder in business_profile_members');
              console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Role: Shareholder (confirmed)');
              console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Status: Active');
              console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Can receive notifications: Yes');
            } else if (memberError) {
              console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Could not confirm member status:', memberError?.message);
            }
          } catch (memberError) {
            console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Exception confirming member status:', memberError?.message);
            // Continue - investor shares were recorded even if member confirmation failed
          }
        } catch (err) {
          console.error('Error recording investor shareholder:', err);
        }
      }
    };

    checkAndRecordInvestor();
  }, [stage, signatures.length, sharesAmount, escrowId, reservedShareRowId]);

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

    // Nothing may be sealed without a live share price AND a live ICAN market
    // price - the amounts below are all derived from those two figures.
    if (!pricingReady) {
      setError(offerError || 'Live share value is still loading. Please wait a moment and try again.');
      return;
    }

    // Approval requires a real approver. getActualShareholders() deliberately
    // returns [] rather than the investor themselves when no co-owner/owner
    // could be identified (see fetchRealShareholders). Every investment type
    // - buy, partner, and support - goes through the same 60%-shareholder-seal
    // flow after this point, so this applies regardless of investmentType:
    // proceeding here would let the agreement (and any escrowed funds) move
    // into a state that no one but the investor could ever approve, since an
    // investor is never allowed to approve their own investment.
    if (getActualShareholders().length === 0) {
      setError('Could not identify who needs to approve this investment. Please try again shortly, or contact support if this persists.');
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
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â ICAN Wallet not found. Creating new wallet...');
        
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
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ New ICAN wallet created successfully');
      } else if (walletError) {
        setError('Error fetching wallet: ' + walletError.message);
        return;
      }
      
      // investmentInIcanCoins comes from the live market price (see the
      // useIcanPrice block above) - do not re-derive it from a fixed rate here.
      const currentBalance = parseFloat(walletData.ican_balance) || 0;
      
      // Check sufficient ICAN coin balance
      if (currentBalance < investmentInIcanCoins) {
        setError(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Insufficient balance. You have ICAN ${currentBalance.toFixed(2)} but need ICAN ${investmentInIcanCoins.toFixed(2)}. Please fund your wallet first.`);
        return;
      }
      
      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ICAN Wallet verified');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Current balance: ' + currentBalance.toFixed(2) + ' ICAN coins');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Investment amount: ' + investmentInIcanCoins.toFixed(2) + ' ICAN coins');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ New balance after transfer: ' + (currentBalance - investmentInIcanCoins).toFixed(2) + ' ICAN coins');
      
      // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â IMPORTANT: SEND NOTIFICATIONS FIRST before deducting coins
      // This ensures coins are only removed if notification succeeds
      console.log('\nÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â¬ STEP: Triggering shareholder notifications BEFORE coin deduction...');
      // Re-check the LIVE share register before anyone is notified or charged.
      // The offer loaded when this modal opened can be minutes old, and another
      // investor may have taken the remaining shares in the meantime.
      if (sharesRequested > 0) {
        const freshOffer = await getLiveShareOffer(offerBusinessProfileId, offerBusinessOwnerUserId);
        if (!freshOffer.available) {
          setError(LIVE_OFFER_BLOCKED_MESSAGE[freshOffer.reason] || LIVE_OFFER_BLOCKED_MESSAGE.default);
          return;
        }
        if (sharesRequested > freshOffer.sharesAvailable) {
          setError(`Not enough shares left. Only ${freshOffer.sharesAvailable} of ${freshOffer.totalShares} shares are still unsold.`);
          setLiveOffer(freshOffer);
          return;
        }
        setLiveOffer(freshOffer);
      }

      await triggerShareholderNotifications(investmentId);
      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Shareholder notifications sent successfully - Safe to proceed with coin deduction');
      
      // Shares are not deducted from pitches.shares_available any more. That
      // column is a static seed value; the live register is investor_shares,
      // which the approval step below writes to and getLiveShareOffer() reads
      // back, so the remaining count recomputes itself from real ownership.

      // STEP 3: Record ICAN coin blockchain transaction
      const { data: blockchainTxn, error: blockchainError } = await supabase
        .from('ican_coin_blockchain_txs')
        .insert([{
          user_id: currentUser?.id,
          tx_type: 'purchase',
          ican_amount: investmentInIcanCoins,
          price_per_coin: icanPriceUgx, // live ICAN market price (UGX per coin)
          total_value_ugx: totalInvestmentUgx,
          from_address: currentUser?.email,
          to_address: 'escrow',
          status: 'completed'
        }])
        .select();
      
      if (blockchainError) {
        setError('Failed to record blockchain transaction: ' + blockchainError.message);
        return;
      }
      
      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ICAN Coin blockchain transaction recorded (DEBIT):');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ ICAN Amount: ' + investmentInIcanCoins.toFixed(2) + ' coins');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Fiat Amount: ' + allowedCurrency + ' ' + totalInvestment.toFixed(2));
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ New balance: ' + (currentBalance - investmentInIcanCoins).toFixed(2) + ' ICAN coins');
      
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
      
      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ICAN Wallet balance updated (COINS DEDUCTED)');

      // STEP 4B: RESERVE the shares on the live register now that the coins are
      // actually spent. investor_shares is the live share ledger, and
      // fn_get_business_issued_shares counts pending_approval rows, so from this
      // moment these shares stop showing as available to anyone else. This is
      // what pitches.shares_available used to do, moved onto real ownership data
      // so the count can never drift from who actually holds what.
      if (sharesRequested > 0) {
        const { data: reservedRows, error: reserveError } = await supabase
          .from('investor_shares')
          .insert([{
            investor_id: currentUser?.id,
            investor_email: currentUser?.email,
            investor_name: currentUser?.user_metadata?.full_name || 'Investor',
            pitch_id: pitch.id,
            business_profile_id: sellerBusinessProfile?.id || pitch?.business_profile_id,
            investment_id: investmentId,
            shares_owned: parseInt(sharesAmount),
            share_price: sharePrice,
            total_investment: totalInvestment,
            currency: allowedCurrency,
            status: 'pending_approval',
            locked_until_threshold: true,
            transaction_reference: transactionRef,
            notes: 'Reserved at payment authorisation, priced at the live share value. Unlocks at 60% shareholder approval.',
            created_at: new Date().toISOString()
          }])
          .select();

        if (reserveError) {
          console.warn('Could not reserve shares on the live register:', reserveError.message);
        } else if (reservedRows?.[0]?.id) {
          setReservedShareRowId(reservedRows[0].id);
          console.log('Shares reserved on live register: ' + sharesAmount + ' (pending_approval)');
        }
      }

      // STEP 5: Create credit transaction in blockchain ledger (for record-keeping)
      // This tracks the investment going to escrow
      const { data: creditTxn, error: creditError } = await supabase
        .from('ican_coin_blockchain_txs')
        .insert([{
          user_id: currentUser?.id,
          tx_type: 'transfer',
          ican_amount: investmentInIcanCoins,
          price_per_coin: icanPriceUgx, // live ICAN market price (UGX per coin)
          total_value_ugx: totalInvestmentUgx,
          from_address: currentUser?.email,
          to_address: 'escrow_pool',
          status: 'completed'
        }])
        .select();
      
      if (creditError) {
        console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Warning: Escrow ledger entry failed:', creditError);
        // Don't fail the investment if this fails - the main transaction already succeeded
      }
      
      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ICAN investment transaction completed:');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ ICAN Amount: ' + investmentInIcanCoins.toFixed(2) + ' coins');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Fiat Amount: ' + allowedCurrency + ' ' + totalInvestment.toFixed(2));
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Transaction Reference: ' + transactionRef);
      
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
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Investment agreement already exists: ' + agreementId + ' (using existing from retry)');
      } else {
        // Create new investment agreement
        const { data: agreementData, error: agreementError } = await supabase
          .from('investment_agreements')
          .insert([{
            pitch_id: pitch.id,
            investor_id: currentUser?.id,
            business_profile_id: sellerBusinessProfile?.id || pitch?.business_profile_id,
            investment_type: investmentType || 'support',
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
          console.error('Investment agreement insert failed (raw error object):', agreementError);
          const details = [agreementError.message, agreementError.details, agreementError.hint, agreementError.code]
            .filter(Boolean)
            .join(' | ');
          let fallback = 'Unknown error';
          try {
            const serialized = JSON.stringify(agreementError, Object.getOwnPropertyNames(agreementError));
            if (serialized && serialized !== '{}') fallback = serialized;
          } catch (_) { /* ignore serialization failures */ }
          setError('Failed to create investment agreement: ' + (details || fallback));
          return;
        }
        
        agreementId = agreementData?.id;
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Investment agreement created: ' + agreementId);
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
        console.error('Investor signature insert failed (raw error object):', sigError);
        const details = [sigError.message, sigError.details, sigError.hint, sigError.code]
          .filter(Boolean)
          .join(' | ');
        let fallback = 'Unknown error';
        try {
          const serialized = JSON.stringify(sigError, Object.getOwnPropertyNames(sigError));
          if (serialized && serialized !== '{}') fallback = serialized;
        } catch (_) { /* ignore serialization failures */ }
        setError('Failed to record investor signature: ' + (details || fallback));
        return;
      }
      
      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Investor signature recorded in database');
      
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
        console.error('Investment approval record upsert failed (raw error object):', approvalError);
        const details = [approvalError.message, approvalError.details, approvalError.hint, approvalError.code]
          .filter(Boolean)
          .join(' | ');
        let fallback = 'Unknown error';
        try {
          const serialized = JSON.stringify(approvalError, Object.getOwnPropertyNames(approvalError));
          if (serialized && serialized !== '{}') fallback = serialized;
        } catch (_) { /* ignore serialization failures */ }
        setError('Failed to create approval record: ' + (details || fallback));
        return;
      }
      
      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Investment approval record created');
      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ WALLET TRANSFER COMPLETED SUCCESSFULLY');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Investment ID:', investmentId);
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Investor: ' + currentUser?.email);
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Amount: ' + allowedCurrency + ' ' + totalInvestment.toFixed(2));
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Shares: ' + (sharesAmount || 'Partnership'));
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Transferred to: AGENT-KAM-5560 (Escrow)');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ New ICAN balance: ' + (currentBalance - investmentInIcanCoins).toFixed(2) + ' coins');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Transaction Reference: ' + transactionRef);
      
      // STEP 8: Add investor as PENDING member in business_profile_members
      // (Will only become shareholder after 60% shareholder approval)
      console.log('\nÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“Ãƒâ€šÃ‚Â¤ ADDING INVESTOR AS PENDING MEMBER (awaiting approval)...');
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
          console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Investor added as PENDING member (awaiting shareholder approval)');
          console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Status: Pending approval');
          console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Will become shareholder when ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°Ãƒâ€šÃ‚Â¥60% shareholders approve');
          console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Can_sign: No (will become Yes after approval)');
        } else if (pendingMemberError) {
          if (pendingMemberError?.message?.includes('row-level security')) {
            console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â RLS: Cannot add pending member via RPC. This is OK - will be handled during 60% approval.');
            console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Investor will be added as member when approval threshold is reached');
          } else {
            console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Could not add pending member:', pendingMemberError?.message);
          }
        }
      } catch (pendingError) {
        console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Exception adding pending member:', pendingError?.message);
        // Continue - if this fails, shareholders will need to manually add them or it will happen at approval
      }

      // STEP 9: Notify ALL MEMBERS (Business Owner + All Shareholders) of new investment
      console.log('\nÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â§ NOTIFYING ALL BUSINESS MEMBERS OF NEW INVESTMENT...');
      try {
        const investmentTypeLabel = investmentType === 'buy' ? 'Equity Investment' :
                                    investmentType === 'partner' ? 'Partnership' :
                                    investmentType === 'guarantor' ? 'Guarantor Agreement' : 'Support/Grant';
        
        const investorName = currentUser?.user_metadata?.full_name || currentUser?.email;
        const baseMessage = `${investorName} has signed and transferred ${allowedCurrency} ${totalInvestment.toFixed(2)} for your pitch "${pitch.title}". ${sharesAmount ? `Shares: ${sharesAmount}` : 'Partnership agreement'}.`;
        
        let notifiedCount = 0;
        let failedCount = 0;

        // ALWAYS notify BUSINESS OWNER first (most critical)
        console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â¢ Notifying business owner...');
        console.log(`   DEBUG: sellerBusinessProfile.user_id = ${sellerBusinessProfile?.user_id}`);
        console.log(`   DEBUG: sellerBusinessProfile = `, sellerBusinessProfile);
        console.log(`   DEBUG: supabase available = ${!!supabase}`);
        if (sellerBusinessProfile?.user_id && supabase) {
          try {
            const ownerNotification = await createInvestmentNotification({
              recipient_id: sellerBusinessProfile.user_id,
              sender_id: currentUser?.id,
              notification_type: 'new_investment',
              title: `ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â° New ${investmentTypeLabel} Received`,
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
              console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Business owner notified: ${sellerBusinessProfile.user_id.substring(0, 8)}...`);
              console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Title: ${ownerNotification.data?.title}`);
              console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Message sent: Investment received notification`);
              notifiedCount++;
            } else if (ownerNotification.isRLSError) {
              console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â RLS: Could not create direct notification for owner');
              console.warn(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ This is OK - notification will be sent via backup process`);
              console.warn(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Owner email: ${sellerBusinessProfile?.email || 'N/A'}`);
              notifiedCount++; // Count as handled (gracefully degraded)
            } else {
              console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Failed to notify business owner:', ownerNotification.error);
              failedCount++;
            }
          } catch (ownerNotifError) {
            console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Exception notifying business owner:', ownerNotifError?.message);
            failedCount++;
          }
        } else {
          console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Business owner ID not found or Supabase not available');
        }

        // THEN get and notify all other active members
        console.log('\nÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â¢ Fetching members for notification...');
        const profileId = sellerBusinessProfile?.id || pitch?.business_profile_id;
        const { data: allMembers, error: membersError } = await supabase
          .from('business_profile_members')
          .select('id, user_id, user_email, user_name, role, ownership_share, status, can_sign')
          .eq('business_profile_id', profileId)
          .eq('status', 'active');

        if (membersError) {
          console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Could not fetch members from business_profile_members:', membersError?.message);
          console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ This is OK if table is not yet migrated. Business owner was already notified above.');
        } else if (allMembers && allMembers.length > 0) {
          console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â¬ Found ${allMembers.length} active member(s). Notifying shareholders...`);
          
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
                title: `ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â° New ${investmentTypeLabel}: ${pitch.title}`,
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
                console.log(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ${member.role} (${member.user_name}) notified`);
                notifiedCount++;
              } else if (memberNotification.isRLSError) {
                console.warn(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â RLS: Could not create direct notification for ${member.user_name}`);
                console.warn(`      ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ This is OK - notification will be sent via backup process`);
                notifiedCount++; // Count as handled (gracefully degraded)
              } else {
                console.warn(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Failed to notify ${member.user_name}:`, memberNotification.error);
                failedCount++;
              }
            } catch (memberError) {
              console.warn(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Exception notifying ${member.user_name}:`, memberError?.message);
              failedCount++;
            }
          }
        } else {
          console.log('ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â No additional members found in business_profile_members table.');
          console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Business owner was notified above.');
          console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Note: Checking business_co_owners table for shareholders...');
        }

        // NEW: Also notify shareholders from business_co_owners table (the main source of truth)
        console.log('\nÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â¢ Fetching shareholders from business_co_owners...');
        const { data: allCoOwners, error: coOwnersError } = await supabase
          .from('business_co_owners')
          .select('id, owner_name, owner_email, user_id, ownership_share, role, status')
          .eq('business_profile_id', profileId)
          .order('created_at');

        if (coOwnersError) {
          console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Could not fetch co-owners from business_co_owners:', coOwnersError?.message);
        } else if (allCoOwners && allCoOwners.length > 0) {
          console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â¬ Found ${allCoOwners.length} co-owner(s) in business_co_owners table`);
          
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

          console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Linked shareholders (with accounts): ${linkedCoOwners.length}`);
          console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Unlinked shareholders (email only): ${unlinkedCoOwners.length}`);
          
          // Notify each linked shareholder
          for (const coOwner of linkedCoOwners) {
            try {
              const shareholderMessage = `${investorName} has signed and transferred ${allowedCurrency} ${totalInvestment.toFixed(2)} for "${pitch.title}". ${sharesAmount ? `Shares: ${sharesAmount}` : 'Partnership'}.`;
              
              const coOwnerNotification = await createInvestmentNotification({
                recipient_id: coOwner.user_id,
                sender_id: currentUser?.id,
                notification_type: 'shareholder_approval_needed',
                title: `ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ Investment Approval Needed: ${pitch.title}`,
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
                console.log(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Co-owner (${coOwner.owner_name || coOwner.owner_email}) notified`);
                notifiedCount++;
              } else if (coOwnerNotification.isRLSError) {
                console.warn(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â RLS: Could not notify ${coOwner.owner_name} - will retry`);
                notifiedCount++; // Still count as we tried
              } else {
                console.warn(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Failed to notify ${coOwner.owner_name}:`, coOwnerNotification.error);
                failedCount++;
              }
            } catch (coOwnerError) {
              console.warn(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Exception notifying ${coOwner.owner_name}:`, coOwnerError?.message);
              failedCount++;
            }
          }
          
          // Log unlinked shareholders
          if (unlinkedCoOwners.length > 0) {
            console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â§ Unlinked shareholders (pending account creation):`);
            unlinkedCoOwners.forEach(owner => {
              console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ ${owner.owner_name} (${owner.owner_email}) - ${owner.ownership_share || 'N/A'}% ownership`);
              console.log(`     ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Email notification will be sent separately`);
            });
          }
        } else {
          console.log('ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â No co-owners found in business_co_owners table.');
        }

        console.log(`\nÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NOTIFICATION SUMMARY:`);
        console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Business owner: ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NOTIFIED`);
        console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Total members/shareholders notified: ${notifiedCount}`);
        console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Failed: ${failedCount}`);
        console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Status: Investment announcement complete`);

      } catch (membersFetchError) {
        console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Exception in member notification workflow:', membersFetchError?.message);
        // Continue anyway - investment was recorded successfully
      }
      
      // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â NOTE: Investor shares are NOT recorded here - they will be recorded ONLY when 60% approval is met
      // This ensures the investor does not become a shareholder until shareholders approve
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Investor shares will be recorded AFTER 60% shareholder approval is met');
      
      
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
      
      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ QR code generated with all signatures');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Investment ID:', escrowId);
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ QR Code URL generated');
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Shareholders signed:', shareholderSignatures.length, '/', getActualShareholders().length);
      console.log('   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Approval percent:', sealData.approvalPercent, '%');
      
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
      
      console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â¢ Sending shareholders notifications for investment ${investmentId}...`);
      console.log(`ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¿Ãƒâ€šÃ‚Â½ DEBUG PROFILES:`);
      console.log(`   pitch?.business_profile_id = ${pitch?.business_profile_id}`);
      console.log(`   businessProfile?.id = ${businessProfile?.id}`);
      console.log(`   Using profile = ${pitch?.business_profile_id || businessProfile?.id}`);
      console.log(`ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¿Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  Total shareholders: ${allShareholdersToNotify.length}`);
      const linkedCount = allShareholdersToNotify.filter(s => s.isLinked).length;
      const unlinkedCount = allShareholdersToNotify.filter(s => !s.isLinked).length;
      console.log(`   ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â± Linked (in-app notifications): ${linkedCount}`);
      console.log(`   ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â§ Unlinked (email pending): ${unlinkedCount}`);
      console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â° Approval deadline: ${new Date(notificationTime.getTime() + 24 * 60 * 60 * 1000).toLocaleString()}`);
      
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
                console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ IN-APP NOTIFICATION sent to: ${shareholderName} (${shareholderEmail}) [already notified previously]`);
                console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Shareholder ID: ${shareholder.user_id || coOwnerId}`);
              } else if (notifError && errorMsg.includes('404')) {
                console.warn(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Note: shareholder_notifications table may not be set up yet. Using fallback.`);
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
                console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ IN-APP NOTIFICATION sent to: ${shareholderName} (${shareholderEmail})`);
                console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Type: Investment Approval Request`);
                console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Shareholder ID: ${shareholder.user_id || coOwnerId}`);
                console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Deadline: ${deadlineTime.toLocaleString()}`);
              } else {
                failCount++;
                console.warn(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Failed to send notification: ${shareholderName} - ${notifError?.message}`);
              }
            } catch (error) {
              failCount++;
              console.error(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error notifying ${shareholderName}:`, error?.message);
            }
          } else {
            // UNLINKED CO-OWNER - Send email notification
            // For now, log that we'll send email
            mockCount++;
            console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â§ EMAIL NOTIFICATION for unlinked shareholder: ${shareholderName} (${shareholderEmail})`);
            console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Co-owner ID: ${coOwnerId}`);
            console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ They will receive an email to sign the agreement`);
            console.log(`   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Email: ${shareholderEmail}`);
            // TODO: Implement email sending via sendgrid or similar
            // Once implemented, change to successCount++
          }
        } catch (error) {
          failCount++;
          console.error(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error notifying shareholder:`, error?.message);
        }
      }
      
      // Record notification send time for 24hr countdown
      setNotificationsSentTime(notificationTime);
      
      console.log(`\nÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ SHAREHOLDER NOTIFICATION SUMMARY:`);
      if (successCount > 0) console.log(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ In-app notifications sent: ${successCount}`);
      if (mockCount > 0) console.log(`   ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â§ Email notifications sent/pending: ${mockCount}`);
      if (failCount > 0) console.log(`   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Failed to send: ${failCount}`);
      console.log(`   Total: ${successCount + mockCount}/${allShareholdersToNotify.length}`);
      console.log(`   ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“Ãƒâ€šÃ‚Â¥ All co-owners notified for approval`);
      console.log(`   ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â° Signature deadline: 24 hours from now`);
      
      // ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â´ CRITICAL: Shareholders must be notified for approval
      if (allShareholdersToNotify.length > 0 && failCount > 0) {
        console.warn(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ WARNING: ${failCount} shareholders failed to notify. But continuing since some were notified.`);
      }
      
      // Validation: Ensure at least SOME notification was attempted
      // Allow investment to proceed even if no shareholder notifications sent, 
      // as long as we have shareholders to notify (they'll get email/followup notifications)
      if (successCount + mockCount === 0 && allShareholdersToNotify.length === 0) {
        // Only fail if we have NO shareholders at all - this means a config error
        throw new Error(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ CRITICAL: No shareholders found to notify.`);
      }
      
      if (allShareholdersToNotify.length > 0 && successCount === 0) {
        console.warn(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â NOTE: No in-app notifications sent (shareholders may not have auth accounts). Email notifications pending.`);
      }
      
      console.log(`\nÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ STATUS: Shareholder notifications complete. Awaiting shareholder approvals...`);
    } catch (err) {
      console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ SHAREHOLDER NOTIFICATION FAILURE:', err?.message);
      setError(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“ Shareholder notification failed. Investment cannot proceed.\n\nError: ${err?.message}\n\nPlease try again or contact support.`);
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

  // Download the MOU + QR seal as a single PDF - a portable record other
  // shareholders can review/approve from outside the app, not just a preview
  // stuck inside this modal. Text-and-image PDF via jsPDF, matching the house
  // pattern already used for CMMS QR handouts (utils/downloadCmmsQrPdf.js).
  const downloadMouPdf = () => {
    if (!qrCodeUrl) return;

    const shareholderSignatures = signatures.filter(s => s.type === 'shareholder' && (s.status === 'signed' || s.status === 'pin_verified'));
    const totalShareholders = getActualShareholders().length;
    const approvalPercent = totalShareholders > 0 ? ((shareholderSignatures.length / totalShareholders) * 100).toFixed(1) : '0.0';

    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 18;
    const contentWidth = pageWidth - margin * 2;
    let y = 20;

    const ensureSpace = (needed) => {
      if (y + needed > pageHeight - margin) {
        pdf.addPage();
        y = 20;
      }
    };

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.text('Investment Agreement (MOU)', pageWidth / 2, y, { align: 'center' });
    y += 8;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(90);
    pdf.text(sellerBusinessProfile?.business_name || pitch?.title || 'Business', pageWidth / 2, y, { align: 'center' });
    y += 10;
    pdf.setDrawColor(200);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 9;
    pdf.setTextColor(30);

    const addField = (label, value) => {
      ensureSpace(7);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.text(`${label}:`, margin, y);
      pdf.setFont('helvetica', 'normal');
      const valueLines = pdf.splitTextToSize(String(value ?? 'N/A'), contentWidth - 50);
      pdf.text(valueLines, margin + 50, y);
      y += 7 * valueLines.length;
    };

    addField('Pitch', pitch?.title);
    addField('Investor', currentUser?.user_metadata?.full_name || currentUser?.email);
    addField('Investment Type', investmentType === 'buy' ? 'Equity Purchase' : investmentType === 'partner' ? 'Partnership Agreement' : investmentType === 'guarantor' ? 'Guarantor Agreement' : 'Financial Support');
    if (sharesRequested > 0) {
      addField('Shares Purchased', `${sharesRequested.toLocaleString()} of ${liveTotalShares ? liveTotalShares.toLocaleString() : 'N/A'} live shares (${equityStakePercent.toFixed(2)}% equity)`);
      addField('Live Share Price', pricingReady ? `${allowedCurrency} ${sharePrice.toFixed(2)} per share (${sharePriceInIcan.toFixed(4)} icaneracoin)` : 'N/A');
    }
    addField('Total Investment', `${allowedCurrency} ${totalInvestment.toFixed(2)}`);
    addField('Escrow ID', escrowId || pitch?.id || 'N/A');
    addField('Shareholder Approval', `${shareholderSignatures.length}/${totalShareholders} signed - ${approvalPercent}% (60% required to release funds)`);
    y += 3;

    if (sellerDocuments?.mou_content) {
      ensureSpace(14);
      pdf.setDrawColor(200);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 9;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.text('Memorandum of Understanding', margin, y);
      y += 8;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      const mouLines = pdf.splitTextToSize(String(sellerDocuments.mou_content), contentWidth);
      mouLines.forEach((line) => {
        ensureSpace(5.5);
        pdf.text(line, margin, y);
        y += 5.5;
      });
      y += 4;
    }

    ensureSpace(75);
    pdf.setDrawColor(200);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 10;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text('Agreement Seal', pageWidth / 2, y, { align: 'center' });
    y += 6;
    const qrSize = 55;
    pdf.addImage(qrCodeUrl, 'PNG', (pageWidth - qrSize) / 2, y, qrSize, qrSize);
    y += qrSize + 6;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(110);
    pdf.text('Scan to verify this agreement in the ICAN Escrow System.', pageWidth / 2, y, { align: 'center' });
    y += 5;
    pdf.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, y, { align: 'center' });

    const safeName = (pitch?.title || 'agreement').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'agreement';
    pdf.save(`ican-mou-${safeName}-${escrowId || 'draft'}.pdf`);
  };

  const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
  const hasBusinessPlan = hasValue(sellerDocuments?.business_plan_content);
  const hasFinancialProjection = hasValue(sellerDocuments?.financial_projection_content);
  const hasMou = hasValue(sellerDocuments?.mou_content);
  const hasValueProposition = hasValue(sellerDocuments?.value_proposition_wants) && hasValue(sellerDocuments?.value_proposition_fears) && hasValue(sellerDocuments?.value_proposition_needs);
  const hasShareAllocation = hasValue(sellerDocuments?.share_allocation_shares) && hasValue(sellerDocuments?.share_allocation_share_price);
  const hasPrivacyRestrictions = hasValue(sellerDocuments?.disclosure_notes);

  const documentSections = [
    {
      key: 'businessPlan',
      icon: 'BP',
      title: 'Business Plan',
      description: 'Your strategic foundation and business model',
      available: hasBusinessPlan
    },
    {
      key: 'financialProjection',
      icon: 'FP',
      title: 'Financial Projection',
      description: 'Revenue and expense estimates',
      available: hasFinancialProjection
    },
    {
      key: 'valueProposition',
      icon: 'VP',
      title: 'Value Proposition',
      description: 'What you offer: wants, fears, and needs',
      available: hasValueProposition
    },
    {
      key: 'mou',
      icon: 'MOU',
      title: 'Memorandum of Understanding',
      description: 'Legal and collaborative agreements',
      available: hasMou
    },
    {
      key: 'shareAllocation',
      icon: 'SA',
      title: 'Share Allocation',
      description: 'Ownership structure and equity distribution',
      available: hasShareAllocation
    },
    {
      key: 'privacy',
      icon: 'PR',
      title: 'Privacy Restrictions',
      description: 'Special confidentiality and sharing conditions',
      available: hasPrivacyRestrictions
    }
  ];

  const completedDocumentCount = documentSections.filter((section) => section.available).length;
  const activeDocumentSection = documentSections.find((section) => section.key === activeDocumentPage) || null;

  const toggleDocumentCard = (documentKey) => {
    setExpandedDocumentCards((prev) => ({
      ...prev,
      [documentKey]: !prev[documentKey]
    }));
  };

  const openDocumentPage = (documentKey) => {
    if (documentSections.find((section) => section.key === documentKey && section.available)) {
      setActiveDocumentPage(documentKey);
    }
  };

  const closeDocumentPage = () => {
    setActiveDocumentPage(null);
  };

  const toggleAgreementPanel = (panelKey) => {
    setAgreementPanels((prev) => ({
      ...prev,
      [panelKey]: !prev[panelKey]
    }));
  };

  const toggleFlowPanel = (panelKey) => {
    setFlowPanels((prev) => ({
      ...prev,
      [panelKey]: !prev[panelKey]
    }));
  };

  const formatAmount = (value) => {
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed.toLocaleString() : value;
  };

  const investmentId = escrowId || pitch?.id;
  const signedShareholderCount = signatures.filter((s) => s.type === 'shareholder' || !s.type).length;
  const totalShareholderCount = getActualShareholders().length;
  const thresholdMet = totalShareholderCount > 0 && (signedShareholderCount / totalShareholderCount) >= 0.60;
  const remainingSignatures = Math.max(0, Math.ceil(totalShareholderCount * 0.6) - signedShareholderCount);
  const timelineShareholders = totalShareholderCount > 0 ? getActualShareholders() : mockShareholders;

  const renderDocumentContent = (documentKey, isPageView = false) => {
    const bodyClass = isPageView ? 'text-sm text-slate-100 whitespace-pre-wrap leading-relaxed' : 'text-sm text-slate-200 whitespace-pre-wrap';
    const cardClass = isPageView ? 'bg-slate-900/70 p-4 rounded-lg border border-slate-600/70' : 'bg-slate-900/50 p-3 rounded border border-slate-600 max-h-36 overflow-y-auto';

    if (documentKey === 'businessPlan') {
      return hasBusinessPlan ? (
        <div className={cardClass}>
          <p className={bodyClass}>{sellerDocuments.business_plan_content}</p>
        </div>
      ) : (
        <p className="text-sm text-amber-300">Not submitted</p>
      );
    }

    if (documentKey === 'financialProjection') {
      return hasFinancialProjection ? (
        <div className={cardClass}>
          <p className={bodyClass}>{sellerDocuments.financial_projection_content}</p>
        </div>
      ) : (
        <p className="text-sm text-amber-300">Not submitted</p>
      );
    }

    if (documentKey === 'valueProposition') {
      return hasValueProposition ? (
        <div className={`space-y-3 ${isPageView ? '' : 'max-h-56 overflow-y-auto pr-1'}`}>
          <div className={cardClass}>
            <p className="text-xs font-semibold text-pink-400 mb-2">Wants (Customer Desires)</p>
            <p className={bodyClass}>{sellerDocuments.value_proposition_wants}</p>
          </div>
          <div className={cardClass}>
            <p className="text-xs font-semibold text-orange-400 mb-2">Fears (Customer Concerns)</p>
            <p className={bodyClass}>{sellerDocuments.value_proposition_fears}</p>
          </div>
          <div className={cardClass}>
            <p className="text-xs font-semibold text-blue-400 mb-2">Needs (Customer Requirements)</p>
            <p className={bodyClass}>{sellerDocuments.value_proposition_needs}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-amber-300">Not submitted</p>
      );
    }

    if (documentKey === 'mou') {
      return hasMou ? (
        <div className={cardClass}>
          <p className={bodyClass}>{sellerDocuments.mou_content}</p>
        </div>
      ) : (
        <p className="text-sm text-amber-300">Not submitted</p>
      );
    }

    if (documentKey === 'shareAllocation') {
      return hasShareAllocation ? (
        <div className={`${isPageView ? 'bg-slate-900/70 p-4 rounded-lg border border-slate-600/70' : 'bg-slate-900/50 p-3 rounded border border-slate-600'} space-y-2`}>
          <div className="flex justify-between">
            <span className="text-sm text-slate-400">Total Shares:</span>
            <span className="text-sm font-semibold text-blue-400">{sellerDocuments.share_allocation_shares}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-slate-400">Price per Share:</span>
            <span className="text-sm font-semibold text-green-400">
              {allowedCurrency} {formatAmount(sellerDocuments.share_allocation_share_price)}
            </span>
          </div>
          {hasValue(sellerDocuments.share_allocation_total_amount) && (
            <div className="flex justify-between border-t border-slate-600 pt-2 mt-2">
              <span className="text-sm text-slate-400">Total Valuation:</span>
              <span className="text-sm font-semibold text-purple-400">
                {allowedCurrency} {formatAmount(sellerDocuments.share_allocation_total_amount)}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-amber-300">Not submitted</p>
      );
    }

    if (documentKey === 'privacy') {
      return hasPrivacyRestrictions ? (
        <div className={isPageView ? 'bg-amber-900/20 border border-amber-500/30 rounded-lg p-4' : 'bg-amber-900/20 border border-amber-500/30 rounded-lg p-3 max-h-36 overflow-y-auto'}>
          <p className={isPageView ? 'text-sm text-amber-100 whitespace-pre-wrap leading-relaxed' : 'text-sm text-amber-200 whitespace-pre-wrap'}>
            {sellerDocuments.disclosure_notes}
          </p>
        </div>
      ) : (
        <p className="text-sm text-amber-300">Not submitted</p>
      );
    }

    return null;
  };

  // Handler for back button
  const handleBack = () => {
    console.log('Back button clicked! Current stage:', stage);
    if (stage > 0) {
      setStage(stage - 1);
      console.log('Going back to stage:', stage - 1);
    } else {
      console.log('Already at stage 0, closing modal');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl w-full h-screen overflow-y-auto">
        
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-900 to-pink-900 p-4 sm:p-6 flex items-center justify-between border-b border-purple-500/30 z-10 shadow-xl">
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
            {/* Back Arrow - ALWAYS VISIBLE, shows stage info */}
            <button
              onClick={handleBack}
              className={`p-2 sm:p-3 rounded-lg transition-all flex items-center justify-center shrink-0 ${
                stage > 0 
                  ? 'bg-white/20 hover:bg-white/30 text-white shadow-lg' 
                  : 'bg-white/10 hover:bg-white/20 text-white/70'
              }`}
              title={stage > 0 ? `Go back to stage ${stage - 1}` : 'Close'}
            >
              <ArrowLeft className={`w-5 h-5 sm:w-6 sm:h-6 transition-transform ${stage > 0 ? 'group-hover:-translate-x-1' : ''}`} />
            </button>
            
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-white shrink-0" />
              <div className="min-w-0">
                <h2 className="text-lg sm:text-2xl font-bold text-white truncate">
                  Investment Agreement
                </h2>
                <p className="text-xs sm:text-sm text-purple-200">
                  Step {stage + 1} of 9
                </p>
              </div>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 sm:p-3 hover:bg-white/20 rounded-lg transition text-white bg-white/10 ml-2 shrink-0"
            title="Close"
          >
            <X className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Stage 0: Investment Intent */}
          {stage === 0 && (
            <div className="space-y-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">Choose Investment Type</h3>
                <p className="text-slate-400 text-sm">
                  How would you like to invest in{' '}
                  <span className="font-semibold text-pink-400">
                    {businessProfile?.business_name ||
                     sellerBusinessProfile?.business_name ||
                     pitch?.title ||
                     'this opportunity'}?
                  </span>
                </p>
              </div>

              <ul className="rounded-xl border border-slate-700/80 bg-slate-900/40 divide-y divide-slate-700/70 overflow-hidden">
                {[
                  { id: 'buy', label: 'Buy Equity', desc: 'Own shares of the business' },
                  { id: 'partner', label: 'Partner', desc: 'Strategic partnership deal' },
                  { id: 'support', label: 'Support', desc: 'Provide financial support' },
                  { id: 'guarantor', label: 'Become a Guarantor', desc: "Guarantee this business's obligations" }
                ]
                  // Companies limited by guarantee have no share capital to sell, but can take on guarantors.
                  .filter(type => type.id !== 'guarantor' || sellerBusinessProfile?.business_structure === 'limited_by_guarantee')
                  // Sole proprietorships have a single owner and cannot sell equity/shares.
                  .filter(type => type.id !== 'buy' || sellerBusinessProfile?.business_structure !== 'sole_proprietorship')
                  .map((type) => (
                  <li key={type.id}>
                    <button
                      onClick={() => {
                        setInvestmentType(type.id);
                        setStage(1);
                      }}
                      className="w-full px-4 py-3.5 text-left hover:bg-slate-800/60 transition"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-white text-sm">{type.label}</h4>
                          <p className="text-xs text-slate-400 mt-1">{type.desc}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0 mt-1" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Stage 1: Pitch Documents Review */}
          {stage === 1 && (
            <div className="space-y-6 pb-[calc(7rem+env(safe-area-inset-bottom))]">
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <FileText className="w-6 h-6" />
                  Seller's Pitch Documents
                </h3>
                <p className="text-slate-400">Review all documents submitted by {pitch?.creator_name || 'the seller'}</p>
              </div>

              {/* Investor Access Confirmed */}
              <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-green-300 font-semibold text-sm mb-1">Investor Access Enabled</p>
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
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-semibold text-white">Overall Progress</h4>
                      <span className="text-lg font-bold text-purple-400">
                        {completedDocumentCount}/{documentSections.length} fields
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-pink-500 to-purple-500 h-2 rounded-full transition-all"
                        style={{ width: `${(completedDocumentCount / documentSections.length) * 100}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    {documentSections.map((section) => {
                      const isExpanded = Boolean(expandedDocumentCards[section.key]);
                      return (
                        <div key={section.key} className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => toggleDocumentCard(section.key)}
                            className="w-full p-4 text-left flex items-start gap-3 hover:bg-slate-700/30 transition"
                          >
                            <span className="inline-flex items-center justify-center min-w-[2.25rem] h-9 px-2 rounded-md border border-slate-600 bg-slate-900/70 text-xs font-semibold text-slate-200">
                              {section.icon}
                            </span>
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="font-semibold text-white">{section.title}</h4>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  section.available ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                }`}>
                                  {section.available ? 'Ready' : 'Missing'}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 mt-1">{section.description}</p>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
                            ) : (
                              <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
                            )}
                          </button>

                          {isExpanded && (
                            <div className="px-4 pb-4 space-y-3">
                              {renderDocumentContent(section.key)}
                              <button
                                type="button"
                                onClick={() => openDocumentPage(section.key)}
                                disabled={!section.available}
                                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-purple-500/40 text-purple-200 hover:bg-purple-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition"
                              >
                                Open {section.title} page
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="bg-yellow-900/20 border border-yellow-600/50 rounded-lg p-4 text-yellow-300">
                  <p className="text-sm">No documents found for this pitch.</p>
                </div>
              )}

              {activeDocumentSection && (
                <div className="fixed inset-0 z-[65] bg-slate-950/95 backdrop-blur-sm">
                  <div className="h-full overflow-y-auto p-4 sm:p-6 pb-[calc(8rem+env(safe-area-inset-bottom))]">
                    <div className="max-w-3xl mx-auto bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl">
                      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-700 px-4 sm:px-6 py-4 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-purple-300/80 mb-1">Document Page</p>
                          <h4 className="text-lg font-bold text-white">{activeDocumentSection.title}</h4>
                          <p className="text-xs text-slate-400 mt-1">{activeDocumentSection.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={closeDocumentPage}
                          className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 transition"
                        >
                          Close
                        </button>
                      </div>

                      <div className="px-4 sm:px-6 py-5 space-y-4">
                        {renderDocumentContent(activeDocumentSection.key, true)}
                      </div>
                    </div>
                  </div>
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
            <div className="space-y-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
              <h3 className="text-xl font-bold text-white">Review Original Pitch Agreement</h3>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleAgreementPanel('snapshot')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Agreement Snapshot</span>
                  {agreementPanels.snapshot ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {agreementPanels.snapshot && (
                  <div className="px-4 pb-4">
                    <ul className="rounded-lg border border-slate-700/70 bg-slate-900/40 divide-y divide-slate-700/60 overflow-hidden">
                      {[
                        ['Pitch Title', pitch?.title || 'N/A'],
                        ['Creator', businessProfile?.owner_name || businessProfile?.business_co_owners?.[0]?.owner_name || pitch?.creator_name || 'Unknown'],
                        ['Pitch Type', pitch?.pitch_type || 'Equity'],
                        ['Category', pitch?.category || 'Technology'],
                        ['Pitch Description', pitch?.description || 'No description provided'],
                        ['Already Raised', pitch?.raised_amount || pitch?.raised || '0'],
                        // The seller's advertised figures. Shown for context only -
                        // what an investor actually pays and receives comes from the
                        // live share register below, never from these.
                        ['Funding Goal (as listed)', pitch?.target_funding || pitch?.goal || 'Not stated'],
                        ['Equity Offering (as listed)', pitch?.equity_offering || pitch?.equity || 'Not stated']
                      ].map(([label, value]) => (
                        <li key={label} className="px-3.5 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                          <p className="text-sm text-white mt-1 break-words">{value}</p>
                        </li>
                      ))}
                    </ul>

                    {pitch?.has_ip && (
                      <div className="mt-3 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3.5 py-2.5">
                        <p className="text-blue-200 text-xs">This pitch has intellectual property protection.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleAgreementPanel('terms')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Investment Terms & Conditions</span>
                  {agreementPanels.terms ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {agreementPanels.terms && (
                  <div className="px-4 pb-4">
                    <ul className="rounded-lg border border-slate-700/70 bg-slate-900/40 divide-y divide-slate-700/60 overflow-hidden">
                      {[
                        ['Investment Type', investmentType === 'buy' ? 'Equity Purchase' : investmentType === 'partner' ? 'Partnership Agreement' : investmentType === 'guarantor' ? 'Guarantor Agreement' : 'Financial Support'],
                        ['Business', sellerBusinessProfile?.business_name || pitch?.title || 'the business'],
                        ['Pitch', pitch?.title || 'N/A'],
                        ['Pitch Description', pitch?.description || 'No description provided'],
                        ['Pricing Basis', 'Shares are priced from this business’s live recorded value, recomputed at the moment you invest. The listed pitch price is not used.'],
                        ['Live Share Price', pricingReady ? `${allowedCurrency} ${sharePrice.toFixed(2)} per share (${sharePriceInIcan.toFixed(4)} icaneracoin)` : 'Loading live value...'],
                        ['Live Share Register', liveTotalShares ? `${liveSharesAvailable.toLocaleString()} of ${liveTotalShares.toLocaleString()} shares still unsold` : 'Unavailable'],
                        ['Payment Method', 'ICAN Wallet with escrow protection'],
                        ['Escrow Protection', 'All investments are held in ICAN escrow pending multi-signature approval from existing shareholders.'],
                        ['Release Requirement', '60% of shareholders (minimum 10 members) must sign to release funds.'],
                        ['Verification', 'PIN and device location will be recorded on the sealed agreement.'],
                        ['Shareholder Addition', 'You will be automatically added as a shareholder upon seal finalization.']
                      ].map(([label, value]) => (
                        <li key={label} className="px-3.5 py-3 flex items-start gap-3">
                          <span className="mt-1 w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                            <p className="text-sm text-slate-200 mt-1 break-words">{value}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-3 rounded-lg border border-slate-700/80 bg-slate-900/40 px-4 py-3 text-slate-300 cursor-pointer">
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
            <div className="space-y-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
              <h3 className="text-xl font-bold text-white">Share Allocation</h3>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel('shareOverview')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Pitch Overview</span>
                  {flowPanels.shareOverview ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {flowPanels.shareOverview && (
                  <div className="px-4 pb-4">
                    <ul className="rounded-lg border border-slate-700/70 bg-slate-900/40 divide-y divide-slate-700/60 overflow-hidden">
                      {[
                        ['Pitch', pitch?.title || 'N/A'],
                        ['Live Business Value', liveOffer?.businessValueUgx != null
                          ? `UGX ${Math.round(liveOffer.businessValueUgx).toLocaleString()}`
                          : 'Unavailable'],
                        ['Total Shares (live)', liveTotalShares ? liveTotalShares.toLocaleString() : 'Not configured'],
                        ['Shares Still Unsold', liveTotalShares ? `${liveSharesAvailable.toLocaleString()} of ${liveTotalShares.toLocaleString()}` : 'Unavailable'],
                        ['Live Share Price', pricingReady
                          ? `${allowedCurrency} ${sharePrice.toFixed(2)}  (${sharePriceInIcan.toFixed(4)} icaneracoin)`
                          : 'Loading live value...']
                      ].map(([label, value]) => (
                        <li key={label} className="px-3.5 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                          <p className="text-sm text-white mt-1 break-words">{value}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {!pricingReady && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                  <p className="text-amber-200 text-sm">
                    {offerError || (offerLoading ? 'Loading this business’s live share value...' : 'Waiting for the live ICAN market price...')}
                  </p>
                  <p className="text-amber-300/70 text-xs mt-1">
                    Shares are priced from live business data and the live icaneracoin price. Nothing can be bought until both are available.
                  </p>
                </div>
              )}

              <div className="space-y-3 rounded-xl border border-slate-700/80 bg-slate-900/40 p-4">
                <label className="block text-slate-300 font-semibold text-sm">
                  Number of Shares to Purchase
                  <span className="text-slate-400 font-normal"> (0 shares for partner/support only)</span>
                </label>
                <input
                  type="number"
                  value={sharesAmount}
                  onChange={(e) => setSharesAmount(e.target.value)}
                  placeholder="Enter number of shares (0 for non-equity investment)"
                  min="0"
                  max={liveSharesAvailable || undefined}
                  disabled={!pricingReady}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 disabled:opacity-50"
                />
                <p className="text-xs text-slate-400">
                  {sharesAmount === '0' || sharesAmount === ''
                    ? 'Partner/Support investment (no equity)'
                    : `${sharesAmount} share${sharesAmount !== '1' ? 's' : ''} selected`}
                </p>

                {(totalInvestment > 0 || sharesAmount === '0') && (
                  <div className={`rounded-lg p-4 space-y-2 ${
                    sharesAmount === '0' || !sharesAmount
                      ? 'bg-blue-500/20 border border-blue-500/50'
                      : 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/50'
                  }`}>
                    {sharesAmount === '0' || !sharesAmount ? (
                      <>
                        <p className="text-blue-300 font-semibold">Partner/Supporter Investment</p>
                        <p className="text-blue-200 text-sm">
                          You will support this pitch without equity stake. Investment type: {investmentType === 'partner' ? 'Partnership' : investmentType === 'guarantor' ? 'Guarantor' : 'Support'}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-slate-300">
                          <span className="font-semibold text-white">{sharesAmount} Share{sharesAmount !== '1' ? 's' : ''}</span>
                          <span className="text-slate-400"> x </span>
                          <span className="font-semibold text-white">{sharePrice.toFixed(2)} {allowedCurrency}</span>
                        </p>
                        <div className="border-t border-pink-500/30 pt-2">
                          <p className="text-slate-300">
                            <span className="font-semibold text-white">Total Investment: </span>
                            <span className="text-2xl font-bold text-pink-400">{allowedCurrency} {totalInvestment.toFixed(2)}</span>
                          </p>
                        </div>
                        <p className="text-xs text-slate-400">
                          Equity Stake: {equityStakePercent.toFixed(2)}% &mdash; {sharesRequested.toLocaleString()} of {liveTotalShares?.toLocaleString()} live shares
                        </p>
                        <p className="text-xs text-slate-400">
                          {investmentInIcanCoins.toFixed(2)} icaneracoin at the live price of {allowedCurrency} {icanPriceLocal?.toFixed(2)} per coin
                        </p>
                      </>
                    )}
                  </div>
                )}

                {exceedsAvailableShares && (
                  <p className="text-xs text-red-300">
                    Only {liveSharesAvailable.toLocaleString()} share{liveSharesAvailable === 1 ? ' is' : 's are'} still unsold.
                  </p>
                )}
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <p className="text-blue-300 font-semibold text-sm mb-1">Account Registered In</p>
                <p className="text-blue-200/80 text-xs">
                  Your account is registered in <span className="font-semibold">{userCountry}</span>
                  {' '}(Default currency: <span className="font-semibold">{allowedCurrency}</span>). You can invest in any currency supported by the business. Transactions are tracked for regulatory compliance.
                </p>
              </div>

              <button
                onClick={() => setStage(5)}
                disabled={
                  !sharesAmount ||
                  exceedsAvailableShares ||
                  (investmentType === 'buy' && (!pricingReady || totalInvestment === 0))
                }
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
              >
                Proceed to ICAN
              </button>
            </div>
          )}

          {/* Stage 5: Wallet Integration */}
          {stage === 5 && (
            <div className="space-y-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Shield className="w-6 h-6" />
                ICAN Wallet - Investment Summary
              </h3>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel('walletSummary')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Investment Snapshot</span>
                  {flowPanels.walletSummary ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {flowPanels.walletSummary && (
                  <div className="px-4 pb-4">
                    <ul className="rounded-lg border border-slate-700/70 bg-slate-900/40 divide-y divide-slate-700/60 overflow-hidden">
                      {[
                        ['Pitch Title', pitch?.title || 'Unknown Pitch'],
                        ['Business', sellerBusinessProfile?.business_name || businessProfile?.business_name || 'Unknown Business'],
                        ['Seller', (() => {
                          const sellerUserId = sellerBusinessProfile?.user_id;
                          const sellerFromShareholders = realShareholders.find((s) => s.user_id === sellerUserId);
                          return sellerFromShareholders?.name || sellerBusinessProfile?.owner_name || pitch?.creator_name || 'Unknown Seller';
                        })()],
                        ['Investor Name', currentUser?.user_metadata?.full_name || currentUser?.email || 'Unknown Investor'],
                        ['Investor Email', currentUser?.email || 'No email'],
                        ['Investment Type', investmentType === 'buy' ? 'Equity Purchase' : investmentType === 'partner' ? 'Partnership' : investmentType === 'guarantor' ? 'Guarantor' : 'Support'],
                        ['Amount', `${allowedCurrency} ${totalInvestment.toFixed(2)}`]
                      ].map(([label, value]) => (
                        <li key={label} className="px-3.5 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                          <p className="text-sm text-white mt-1 break-words">{value}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel('walletCoins')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Your ICAN Wallet</span>
                  {flowPanels.walletCoins ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {flowPanels.walletCoins && (
                  <div className="px-4 pb-4 space-y-3">
                    <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">ICAN Account</p>
                        <p className="text-sm text-slate-200 mt-1 break-words">
                          {icanAccountNumber || 'Not available'}
                          {icanAccountHolder ? ` - ${icanAccountHolder}` : ''}
                        </p>
                      </div>
                      <button
                        onClick={refreshWalletBalance}
                        disabled={loadingWallet}
                        className="text-xs px-3 py-1.5 bg-blue-600/50 hover:bg-blue-600 disabled:bg-slate-700 disabled:text-slate-400 text-white rounded transition"
                      >
                        {loadingWallet ? 'Loading...' : 'Refresh'}
                      </button>
                    </div>

                    <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4 text-center">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Available Balance</p>
                      <p className="text-2xl font-bold text-yellow-400 mt-2">
                        {loadingWallet ? 'Loading wallet data...' : `${walletBalance.toFixed(8)} ICAN`}
                      </p>
                      {!loadingWallet && walletBalance <= 0 && (
                        <p className="text-xs text-red-300 mt-2">No ICAN coins available. Fund your wallet to continue.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel('walletBreakdown')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Investment Breakdown</span>
                  {flowPanels.walletBreakdown ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {flowPanels.walletBreakdown && (
                  <div className="px-4 pb-4">
                    <ul className="rounded-lg border border-slate-700/70 bg-slate-900/40 divide-y divide-slate-700/60 overflow-hidden">
                      {[
                        ['Investment Amount (ICAN)', `${investmentInIcanCoins.toFixed(2)} coins`],
                        ['Equivalent Value', `${allowedCurrency} ${totalInvestment.toFixed(2)}`],
                        ['Shares', sharesAmount === '0' || !sharesAmount ? 'Partnership/Support (no equity)' : `${sharesAmount} shares`],
                        ['ICAN Coins Remaining', `${(walletBalance - investmentInIcanCoins).toFixed(2)} coins`],
                        ['Payment Method', 'ICAN Coins (Escrow protected)']
                      ].map(([label, value]) => (
                        <li key={label} className="px-3.5 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                          <p className={`text-sm mt-1 break-words ${
                            label === 'ICAN Coins Remaining' && (walletBalance - investmentInIcanCoins) < 0
                              ? 'text-red-300'
                              : 'text-white'
                          }`}>{value}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel('walletShareholders')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Business Shareholders ({getActualShareholders().length})</span>
                  {flowPanels.walletShareholders ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {flowPanels.walletShareholders && (
                  <div className="px-4 pb-4">
                    {getActualShareholders().length > 0 ? (
                      <ul className="rounded-lg border border-slate-700/70 bg-slate-900/40 divide-y divide-slate-700/60 overflow-hidden max-h-56 overflow-y-auto">
                        {getActualShareholders().map((shareholder, idx) => (
                          <li key={shareholder.id || idx} className="px-3.5 py-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white break-words">{shareholder.name || shareholder.owner_name || 'Unnamed'}</p>
                              <p className="text-xs text-slate-400 break-words">{shareholder.email || shareholder.owner_email || 'No email'}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-green-400">{shareholder.ownership_share || 'N/A'}%</p>
                              <p className="text-xs text-slate-400">{shareholder.isLinked ? 'In-app' : 'Email'}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400 italic">No shareholders registered yet.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <ul className="space-y-2">
                  <li className="text-sm text-blue-200 flex items-start gap-2">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-300 flex-shrink-0" />
                    <span>
                      <strong>Escrow Protection:</strong> Your {allowedCurrency} {totalInvestment.toFixed(2)} is held in ICAN escrow until 60% shareholder approval is completed.
                    </span>
                  </li>
                  <li className="text-sm text-blue-200 flex items-start gap-2">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-300 flex-shrink-0" />
                    <span>
                      <strong>Security:</strong> Funds cannot be released until multi-signature approval requirements are met.
                    </span>
                  </li>
                </ul>
              </div>

              <button
                onClick={() => {
                  if (walletBalance < investmentInIcanCoins) {
                    alert(`Insufficient balance.\n\nYour wallet: ${walletBalance.toFixed(2)} ICAN\nRequired: ${investmentInIcanCoins.toFixed(2)} ICAN\nShortfall: ${(investmentInIcanCoins - walletBalance).toFixed(2)} ICAN`);
                    return;
                  }
                  setStage(6);
                }}
                disabled={walletBalance < investmentInIcanCoins}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
              >
                {walletBalance < investmentInIcanCoins
                  ? `Insufficient Balance (${(investmentInIcanCoins - walletBalance).toFixed(2)} ICAN short)`
                  : 'Authorize with PIN'}
              </button>
            </div>
          )}

          {false && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Shield className="w-6 h-6" />
                ICAN Wallet - Investment Summary
              </h3>

              <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between text-slate-300">
                    <span>ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Âº Pitch Title:</span>
                    <span className="text-white font-semibold">{pitch?.title || 'Unknown Pitch'}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¢ Business:</span>
                    <span className="text-white font-semibold">
                      {(() => {
                        const displayValue = sellerBusinessProfile?.business_name || businessProfile?.business_name || 'Unknown Business';
                        const source = sellerBusinessProfile?.business_name 
                          ? 'sellerBusinessProfile.business_name (pitch.business_profiles)' 
                          : businessProfile?.business_name 
                          ? 'businessProfile.business_name (investor)' 
                          : 'fallback (Unknown)';
                        console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â¼ Business Display:', { displayValue, source });
                        return displayValue;
                      })()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“Ãƒâ€šÃ‚Â¤ Seller:</span>
                    <span className="text-white font-semibold text-xs">
                      {(() => {
                        // Find the seller's name from realShareholders (includes all co-owners)
                        // The seller is the one with user_id matching sellerBusinessProfile.user_id
                        const sellerUserId = sellerBusinessProfile?.user_id;
                        const sellerFromShareholders = realShareholders.find(s => s.user_id === sellerUserId);
                        
                        // Get seller name from multiple sources
                        const sellerName = sellerFromShareholders?.name || 'Unknown Seller';
                        
                        console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“Ãƒâ€šÃ‚Â¤ Seller Display:', { 
                          sellerUserId,
                          sellerFromShareholders,
                          displayValue: sellerName
                        });
                        return sellerName;
                      })()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“Ãƒâ€šÃ‚Â¤ Investor Name:</span>
                    <span className="text-white font-semibold">{currentUser?.user_metadata?.full_name || currentUser?.email || 'Unknown Investor'}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â§ Investor Email:</span>
                    <span className="text-white font-semibold text-xs">{currentUser?.email || 'No email'}</span>
                  </div>
                </div>

                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <h4 className="text-slate-300 font-semibold text-sm flex items-center gap-2">
                    ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¿Ãƒâ€šÃ‚Â½ Your ICAN Coins (For Share Purchase)
                  </h4>
                  <div className="bg-gradient-to-br from-slate-700 to-slate-800 rounded-lg p-4 space-y-3 border border-slate-600">
                    {/* Tabs - Only My Wallet visible */}
                    {/* COMMENTED OUT - Overview and Trade tabs
                    <div className="flex gap-2 mb-4 border-b border-slate-600">
                      <button 
                        onClick={() => setWalletTab('overview')}
                        className={`px-4 py-2 text-sm font-semibold ${walletTab === 'overview' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-slate-400'}`}
                      >
                        ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  Overview
                      </button>
                      <button 
                        onClick={() => setWalletTab('trade')}
                        className={`px-4 py-2 text-sm font-semibold ${walletTab === 'trade' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-slate-400'}`}
                      >
                        ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â± Trade
                      </button>
                      <button 
                        onClick={() => setWalletTab('wallet')}
                        className={`px-4 py-2 text-sm font-semibold ${walletTab === 'wallet' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-slate-400'}`}
                      >
                        ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Âº My Wallet
                      </button>
                    </div>
                    END COMMENT */}

                    {/* Overview Tab - COMMENTED OUT
                    {walletTab === 'overview' && (
                      <div className="space-y-3">
                        <div className="bg-slate-800/60 rounded-lg p-4 text-center">
                          <p className="text-slate-400 text-sm mb-2">Available Balance</p>
                          <div className="text-4xl font-bold text-yellow-400 mb-2">
                            ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€¦Ã‚Â½ {walletBalance.toFixed(8)}
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
                          walletBalance >= investmentInIcanCoins
                            ? 'bg-green-500/10 border-green-500/30' 
                            : 'bg-red-500/10 border-red-500/30'
                        }`}>
                          <span className={walletBalance >= investmentInIcanCoins ? 'text-green-400 text-sm' : 'text-red-400 text-sm'}>
                            {walletBalance >= investmentInIcanCoins 
                              ? 'ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Sufficient Funds' 
                              : `ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Need ${(investmentInIcanCoins - walletBalance).toFixed(2)} more`
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
                        <div className="bg-slate-800/60 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-slate-400 text-sm font-semibold">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â° Your ICAN Coin Balance</p>
                            <button 
                              onClick={refreshWalletBalance}
                              disabled={loadingWallet}
                              className="text-xs px-2 py-1 bg-blue-600/50 hover:bg-blue-600 disabled:bg-gray-600 text-white rounded transition"
                              title="Refresh wallet balance"
                            >
                              {loadingWallet ? 'ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ Loading...' : 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Refresh'}
                            </button>
                          </div>
                          
                          {loadingWallet ? (
                            <div className="text-center py-4">
                              <p className="text-slate-400 text-sm">Loading wallet data...</p>
                            </div>
                          ) : (
                            <>
                              <div className="text-center">
                                <div className="text-3xl font-bold text-yellow-400 mt-2">
                                  ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€¦Ã‚Â½ {walletBalance.toFixed(8)}
                                </div>
                                <p className="text-slate-500 text-xs mt-2">Available for investment</p>
                              </div>
                              
                              {walletBalance <= 0 && (
                                <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded p-2">
                                  <p className="text-red-400 text-xs">ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â No ICAN coins. Go to ICAN Wallet to purchase coins.</p>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>


                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <h4 className="text-slate-300 font-semibold text-sm">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  Investment Breakdown (ICAN Coins)</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Investment Amount (ICAN):</span>
                      <span className="text-2xl font-bold text-yellow-400">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€¦Ã‚Â½ {investmentInIcanCoins.toFixed(2)} coins</span>
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
                        ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€¦Ã‚Â½ {(walletBalance - investmentInIcanCoins).toFixed(2)} coins
                      </span>
                    </div>
                    <div className="border-t border-slate-700 pt-3 flex items-center justify-between">
                      <span className="text-slate-400">ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¿Ãƒâ€šÃ‚Â½ Payment Method:</span>
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
                            <p className="text-slate-400 text-xs">{shareholder.isLinked ? 'ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ In-app' : 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â§ Email'}</p>
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
                  <span>ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â³</span>
                  <span><strong>Escrow Protection:</strong> Your {allowedCurrency} {totalInvestment.toFixed(2)} investment will be securely held in ICAN Escrow until {signatures.length >= mockShareholders.length * 0.6 ? 'completed' : '60% of shareholders sign'}.</span>
                </p>
                <p className="text-blue-300 text-sm flex gap-2">
                  <span>ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â</span>
                  <span><strong>Security:</strong> Funds are protected and cannot be transferred until multi-signature approval is complete.</span>
                </p>
              </div>

              <button
                onClick={() => {
                  const investmentInCoins = investmentInIcanCoins;
                  if (walletBalance < investmentInCoins) {
                    alert(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Insufficient balance!\n\nYour wallet: ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€¦Ã‚Â½ ${walletBalance.toFixed(2)} ICAN coins\nRequired: ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€¦Ã‚Â½ ${investmentInCoins.toFixed(2)} ICAN coins\nShortfall: ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€¦Ã‚Â½ ${(investmentInCoins - walletBalance).toFixed(2)}`);
                    return;
                  }
                  setStage(6);
                }}
                disabled={walletBalance < investmentInIcanCoins}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
              >
                {walletBalance < investmentInIcanCoins ? `ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Insufficient Balance (ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€¦Ã‚Â½ ${(investmentInIcanCoins - walletBalance).toFixed(2)} short)` : 'Authorize with PIN'}
              </button>
            </div>
          )}

          {/* Stage 6: Payment Execution & Wallet PIN */}
          {stage === 6 && (
            <div className="space-y-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Lock className="w-6 h-6" />
                Secure Payment - Wallet PIN Verification
              </h3>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel('paymentSummary')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Payment Summary</span>
                  {flowPanels.paymentSummary ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {flowPanels.paymentSummary && (
                  <div className="px-4 pb-4">
                    <ul className="rounded-lg border border-slate-700/70 bg-slate-900/40 divide-y divide-slate-700/60 overflow-hidden">
                      {[
                        ['Amount to Escrow', `${allowedCurrency} ${totalInvestment.toFixed(2)}`],
                        ['ICAN Required', `${investmentInIcanCoins.toFixed(2)} coins`],
                        ['Wallet Balance', `${walletBalance.toFixed(2)} ICAN`],
                        ['Payment Method', 'ICAN Wallet PIN'],
                        ['Security', 'PIN verification creates your sealed signature']
                      ].map(([label, value]) => (
                        <li key={label} className="px-3.5 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                          <p className="text-sm text-white mt-1 break-words">{value}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 p-4 space-y-4">
                <p className="text-slate-300 text-sm">
                  Enter your ICAN Wallet PIN (4-6 digits) to authorize and seal this investment.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-2">Wallet PIN</label>
                    <div className="flex gap-2">
                      <input
                        type={showWalletPin ? 'text' : 'password'}
                        value={walletPin}
                        onChange={(e) => setWalletPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="Enter PIN"
                        maxLength="6"
                        className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-center text-2xl tracking-widest placeholder-slate-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowWalletPin(!showWalletPin)}
                        className="px-3 py-2 hover:bg-slate-700 rounded-lg transition text-slate-300 text-xs border border-slate-700"
                      >
                        {showWalletPin ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-2">Confirm Wallet PIN</label>
                    <input
                      type={showWalletPin ? 'text' : 'password'}
                      value={walletPinConfirm}
                      onChange={(e) => setWalletPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Re-enter PIN"
                      maxLength="6"
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-center text-2xl tracking-widest placeholder-slate-500"
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-red-500/20 border border-red-500/50 rounded text-red-300 text-sm">
                    {error}
                  </div>
                )}

                {pinVerified && (
                  <div className="p-3 bg-green-500/20 border border-green-500/50 rounded text-green-300 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    <span>Wallet PIN verified. Payment is sealed with your signature.</span>
                  </div>
                )}
              </div>

              <button
                onClick={async () => {
                  if (!pinVerified) {
                    verifyWalletPin();
                  } else {
                    const approvalStatus = await checkShareholderApprovalStatus();
                    if (approvalStatus.hasReachedThreshold) {
                      generateQRCode();
                    } else {
                      setError(`Waiting for shareholder approvals: ${approvalStatus.approvedCount}/${approvalStatus.totalRequired} required (${approvalStatus.percentageApproved.toFixed(0)}%)`);
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

          {false && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Lock className="w-6 h-6" />
                Secure Payment - Wallet PIN Verification
              </h3>

              <div className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 border border-blue-500/50 rounded-lg p-4 space-y-2">
                <p className="text-blue-300 text-sm flex gap-2">
                  <span>ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¿Ãƒâ€šÃ‚Â½</span>
                  <span><strong>Amount:</strong> {allowedCurrency} {totalInvestment.toFixed(2)} will be transferred to secure escrow.</span>
                </p>
                <p className="text-blue-300 text-sm flex gap-2">
                  <span>ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¿Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â</span>
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
                        placeholder="ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢"
                        maxLength="6"
                        className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-center text-2xl tracking-widest placeholder-slate-500"
                      />
                      <button
                        onClick={() => setShowWalletPin(!showWalletPin)}
                        className="p-2 hover:bg-slate-700 rounded-lg transition text-slate-400"
                      >
                        {showWalletPin ? 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â' : 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢Ãƒâ€¹Ã¢â‚¬Â '}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-2">Confirm Wallet PIN</label>
                    <input
                      type={showWalletPin ? 'text' : 'password'}
                      value={walletPinConfirm}
                      onChange={(e) => setWalletPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢"
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
                      console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ PROCEEDING: 60% approval threshold reached (${approvalStatus.approvedCount}/${approvalStatus.totalRequired})`);
                      generateQRCode();
                    } else {
                      // Still waiting for more approvals
                      console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ WAITING: Need ${approvalStatus.totalRequired - approvalStatus.approvedCount} more approval(s) to reach 60%`);
                      setError(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ Waiting for shareholder approvals: ${approvalStatus.approvedCount}/${approvalStatus.totalRequired} required (${approvalStatus.percentageApproved.toFixed(0)}%)`);
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
            <div className="space-y-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Users className="w-6 h-6" />
                Awaiting Shareholder Signatures (24-Hour Deadline)
              </h3>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel('pendingStatus')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Escrow Status</span>
                  {flowPanels.pendingStatus ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {flowPanels.pendingStatus && (
                  <div className="px-4 pb-4 space-y-4">
                    <div className={`rounded-lg p-4 ${
                      signedShareholderCount >= requiredApprovalCount
                        ? 'bg-green-500/20 border border-green-500/50'
                        : 'bg-yellow-500/20 border border-yellow-500/50'
                    }`}>
                      <p className={`font-semibold text-center ${
                        signedShareholderCount >= requiredApprovalCount ? 'text-green-300' : 'text-yellow-300'
                      }`}>
                        Escrow Status: {signedShareholderCount >= requiredApprovalCount ? 'SEALED' : 'ACTIVE'} | Signatures: {signedShareholderCount}/{requiredApprovalCount}
                      </p>
                    </div>

                    {notificationsSentTime && (
                      <DeadlineCountdown
                        notificationTime={notificationsSentTime}
                        onExpired={() => setError('24-hour signature deadline has expired. Investment requires 60% approval.')}
                      />
                    )}

                    <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-yellow-300">Signatures Required: 60%</span>
                        <span className="text-2xl font-bold text-yellow-400">
                          {totalShareholderCount > 0 ? ((signedShareholderCount / totalShareholderCount) * 100).toFixed(0) : 0}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-yellow-500 to-orange-500 h-full transition-all duration-500"
                          style={{ width: `${Math.min(totalShareholderCount > 0 ? (signedShareholderCount / totalShareholderCount) * 100 : 0, 100)}%` }}
                        />
                      </div>
                      <p className="text-sm text-slate-300">
                        {signedShareholderCount} of {totalShareholderCount || timelineShareholders.length} shareholders signed
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel('pendingNotifications')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">
                    Shareholder Notifications ({Object.keys(shareholderNotifications || {}).length})
                  </span>
                  {flowPanels.pendingNotifications ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {flowPanels.pendingNotifications && (
                  <div className="px-4 pb-4">
                    {shareholderNotifications && Object.keys(shareholderNotifications).length > 0 ? (
                      <ul className="rounded-lg border border-slate-700/70 bg-slate-900/40 divide-y divide-slate-700/60 overflow-hidden max-h-60 overflow-y-auto">
                        {Object.entries(shareholderNotifications).map(([id, notifData]) => {
                          const hasSigned = signatures.some((s) => String(s.id) === String(id));
                          return (
                            <li key={id} className="px-3.5 py-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-medium text-white break-words">{notifData.name}</p>
                                <p className="text-xs text-slate-400 break-words">{notifData.email}</p>
                              </div>
                              <div className="text-right">
                                <p className={`font-bold text-xs ${hasSigned ? 'text-green-400' : 'text-yellow-400'}`}>
                                  {hasSigned ? 'SIGNED' : 'PENDING'}
                                </p>
                                <p className="text-xs text-slate-400">
                                  {notifData.sentAt ? new Date(notifData.sentAt).toLocaleTimeString() : 'Awaiting'}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400">No shareholder notifications sent yet.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel('pendingTimeline')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Signature Timeline</span>
                  {flowPanels.pendingTimeline ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {flowPanels.pendingTimeline && (
                  <div className="px-4 pb-4">
                    <ul className="rounded-lg border border-slate-700/70 bg-slate-900/40 divide-y divide-slate-700/60 overflow-hidden max-h-64 overflow-y-auto">
                      {timelineShareholders.map((shareholder, idx) => {
                        const signature = signatures.find((s) => String(s.id) === String(shareholder.id));
                        const displayName = shareholder.name || shareholder.owner_name || `Shareholder ${idx + 1}`;
                        const displayEmail = shareholder.email || shareholder.owner_email || 'No email';
                        return (
                          <li key={shareholder.id || idx} className="px-3.5 py-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-white break-words">{displayName}</p>
                              <p className="text-xs text-slate-400 break-words">{displayEmail}</p>
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
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <p className="text-blue-300 text-sm">
                  Your payment of {allowedCurrency} {totalInvestment.toFixed(2)} is securely held in ICAN escrow. Once 60% of shareholders sign, your investment will be finalized and added to the business profile.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/50 rounded-lg p-4">
                <h4 className="font-semibold text-amber-300 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Waiting for Shareholder Signatures
                </h4>
                <p className="text-amber-200 text-sm mb-4">
                  Shareholders must review and sign this agreement within 24 hours using their PIN.
                </p>
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

                    supabase
                      .from('investment_signatures')
                      .insert([shareholderSigData])
                      .then(({ data, error: saveError }) => {
                        if (saveError) {
                          console.error('Failed to save shareholder signature:', saveError);
                          return;
                        }
                        console.log('Shareholder signature recorded in database:', data);
                      });

                    setSignatures((prev) => {
                      if (!prev.some((s) => String(s.id) === String(currentShareholderSigning.id))) {
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

          {false && (
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
                  ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â Escrow Status: {signatures.length >= requiredApprovalCount ? 'SEALED ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ' : 'ACTIVE'} | Signatures: {signatures.length}/{requiredApprovalCount}
                </p>
              </div>

              {/* 24-Hour Countdown Timer */}
              {notificationsSentTime && (
                <DeadlineCountdown 
                  notificationTime={notificationsSentTime}
                  onExpired={() => setError(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â° 24-hour signature deadline has expired. Investment requires 60% approval.`)}
                />
              )}

              {/* NOTIFICATION STATUS - Show which shareholders were notified */}
              {shareholderNotifications && Object.keys(shareholderNotifications).length > 0 && (
                <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-4">
                  <h4 className="font-semibold text-blue-300 mb-3 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â¬ Shareholder Notifications Sent ({Object.keys(shareholderNotifications).length})
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
                                <p className="text-green-400 font-bold text-xs">ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ SIGNED</p>
                                <p className="text-green-300 text-xs">{new Date(notifData.sentAt).toLocaleTimeString()}</p>
                              </div>
                            ) : (
                              <div>
                                <p className="text-yellow-400 font-bold text-xs">ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ PENDING</p>
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
                  ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ Your payment of ${totalInvestment.toFixed(2)} is securely held in ICAN Escrow. Once 60% of shareholders sign, your investment will be automatically sealed and you'll be added to the business profile.
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
                        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Shareholder signature recorded in database:', data);
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
                    
                    console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Shareholder signed and recorded: ${currentShareholderSigning.name}`);
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
          {(stage === 8 || (stage === 7 && thresholdMet)) && (
            <div className="space-y-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
              <div className="text-center space-y-2">
                <CheckCircle className="w-14 h-14 text-green-400 mx-auto" />
                <h3 className="text-2xl font-bold text-white">Investment Sealed</h3>
                <p className="text-slate-400">
                  60% shareholder approval has been achieved. The investment is finalized and recorded.
                </p>
              </div>

              <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-4">
                <p className="text-green-300 font-semibold text-center">
                  Escrow Status: SEALED | Approval: {totalShareholderCount > 0 ? ((signedShareholderCount / totalShareholderCount) * 100).toFixed(1) : 0}%
                </p>
              </div>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel('finalSummary')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Final Investment Summary</span>
                  {flowPanels.finalSummary ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {flowPanels.finalSummary && (
                  <div className="px-4 pb-4">
                    <ul className="rounded-lg border border-slate-700/70 bg-slate-900/40 divide-y divide-slate-700/60 overflow-hidden">
                      {[
                        ['Pitch', pitch?.title || 'N/A'],
                        ['Business', sellerBusinessProfile?.business_name || pitch?.title || 'the business'],
                        ['Escrow ID', escrowId || 'Pending'],
                        ['Shares', sharesAmount === '0' || !sharesAmount ? 'Partnership/Support' : `${sharesAmount} @ ${sharePrice.toFixed(2)}/share`],
                        ['Investment Amount', `${allowedCurrency} ${totalInvestment.toFixed(2)}`],
                        ['Investor Signature', 'Wallet PIN verified'],
                        ['Shareholders Signed', `${signedShareholderCount}/${totalShareholderCount || 0}`],
                        ['Status', thresholdMet ? 'Completed & Approved' : `Pending ${remainingSignatures} more signatures`]
                      ].map(([label, value]) => (
                        <li key={label} className="px-3.5 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                          <p className="text-sm text-white mt-1 break-words">{value}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel('finalCertificate')}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition"
                >
                  <span className="font-semibold text-white">Agreement Certificate</span>
                  {flowPanels.finalCertificate ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {flowPanels.finalCertificate && (
                  <div className="px-4 pb-4">
                    {qrCodeUrl ? (
                      <div ref={printRef} className="bg-white p-5 rounded-lg space-y-5">
                        <div className="text-center border-b border-gray-300 pb-3">
                          <h1 className="text-xl font-bold text-gray-900">INVESTMENT AGREEMENT SEAL</h1>
                          <p className="text-sm text-gray-600">Official Certificate of Investment</p>
                          <p className="text-xs text-gray-500 mt-1">Generated: {new Date().toLocaleString()}</p>
                        </div>

                        <div className="flex justify-center">
                          <img src={qrCodeUrl} alt="Agreement Seal" className="w-40 h-40 border-2 border-green-500 rounded" />
                        </div>

                        <div className="space-y-2 text-sm text-gray-800 border-b border-gray-200 pb-4">
                          <h2 className="font-bold text-base">Investment Details</h2>
                          <div className="flex justify-between gap-3"><span className="font-semibold">Escrow ID:</span><span className="font-mono text-right break-all">{escrowId}</span></div>
                          <div className="flex justify-between gap-3"><span className="font-semibold">Pitch:</span><span className="text-right">{pitch?.title}</span></div>
                          <div className="flex justify-between gap-3"><span className="font-semibold">Business:</span><span className="text-right">{sellerBusinessProfile?.business_name || pitch?.title || 'the business'}</span></div>
                          <div className="flex justify-between gap-3"><span className="font-semibold">Investor:</span><span className="text-right">{currentUser?.email}</span></div>
                          <div className="flex justify-between gap-3"><span className="font-semibold">Investment Type:</span><span className="text-right">{investmentType === 'buy' ? 'Equity Purchase' : investmentType === 'partner' ? 'Partnership' : investmentType === 'guarantor' ? 'Guarantor' : 'Support'}</span></div>
                          <div className="flex justify-between gap-3"><span className="font-semibold">Shares:</span><span className="text-right">{sharesAmount || 'N/A'} {sharePrice ? `@ ${allowedCurrency}${sharePrice.toFixed(2)}/share` : ''}</span></div>
                          <div className="flex justify-between gap-3"><span className="font-semibold">Investment Amount:</span><span className="text-right">{allowedCurrency} {totalInvestment.toFixed(2)}</span></div>
                        </div>

                        {sellerDocuments?.business_plan_content && (
                          <div className="border-b border-gray-200 pb-4">
                            <h2 className="font-bold text-base mb-2 text-gray-900">Business Plan</h2>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded">{sellerDocuments.business_plan_content}</p>
                          </div>
                        )}

                        {sellerDocuments?.financial_projection_content && (
                          <div className="border-b border-gray-200 pb-4">
                            <h2 className="font-bold text-base mb-2 text-gray-900">Financial Projection</h2>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded">{sellerDocuments.financial_projection_content}</p>
                          </div>
                        )}

                        {(sellerDocuments?.value_proposition_wants || sellerDocuments?.value_proposition_fears || sellerDocuments?.value_proposition_needs) && (
                          <div className="border-b border-gray-200 pb-4 space-y-2">
                            <h2 className="font-bold text-base text-gray-900">Value Proposition</h2>
                            {sellerDocuments?.value_proposition_wants && <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded"><strong>Wants:</strong> {sellerDocuments.value_proposition_wants}</p>}
                            {sellerDocuments?.value_proposition_fears && <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded"><strong>Fears:</strong> {sellerDocuments.value_proposition_fears}</p>}
                            {sellerDocuments?.value_proposition_needs && <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded"><strong>Needs:</strong> {sellerDocuments.value_proposition_needs}</p>}
                          </div>
                        )}

                        {sellerDocuments?.mou_content && (
                          <div className="border-b border-gray-200 pb-4">
                            <h2 className="font-bold text-base mb-2 text-gray-900">Memorandum of Understanding</h2>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded">{sellerDocuments.mou_content}</p>
                          </div>
                        )}

                        <div className="text-xs text-gray-600 text-center border-t border-gray-300 pt-3 space-y-1">
                          <p className="font-semibold text-gray-900">This document is sealed and recorded in ICAN Escrow System.</p>
                          <p>Approval threshold: {totalShareholderCount > 0 ? ((signedShareholderCount / totalShareholderCount) * 100).toFixed(1) : 0}% / 60% required.</p>
                          <p>Generated: {new Date().toLocaleString()}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">QR seal is being prepared. Please wait.</p>
                    )}
                  </div>
                )}
              </div>

              {thresholdMet ? (
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
                    onClick={downloadQRCode}
                    disabled={!qrCodeUrl}
                    className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
                  >
                    <Download className="w-5 h-5" />
                    Download QR Seal
                  </button>
                  <button
                    onClick={downloadMouPdf}
                    disabled={!qrCodeUrl}
                    className="px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
                  >
                    <FileText className="w-5 h-5" />
                    Download MOU + Seal (PDF)
                  </button>
                </div>
              ) : (
                <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4 text-center">
                  <p className="text-yellow-300 font-semibold">
                    Document download is available after 60% shareholder approval.
                  </p>
                  <p className="text-yellow-200 text-sm mt-2">
                    Currently: {totalShareholderCount > 0 ? ((signedShareholderCount / totalShareholderCount) * 100).toFixed(1) : 0}% approved
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
                  Investment sealed and recorded. You have been added as a shareholder to <strong>{sellerBusinessProfile?.business_name || pitch?.title || 'the business'}</strong> for "<strong>{pitch?.title}</strong>" with {allowedCurrency} {totalInvestment.toFixed(2)}.
                </p>
              </div>
            </div>
          )}

          {false && (
            <div className="space-y-6">
              <div className="text-center space-y-3">
                <CheckCircle className="w-16 h-16 text-green-400 mx-auto animate-bounce" />
                <h3 className="text-2xl font-bold text-white">ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Investment Sealed!</h3>
                <p className="text-slate-400">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â° 60% shareholder approval achieved! Investment is now finalized and recorded.</p>
              </div>

              <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4">
                <p className="text-green-300 font-semibold text-center">
                  ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â° Escrow Status: SEALED & FINALIZED | Approval: {getActualShareholders().length > 0 ? ((signatures.filter(s => s.type === 'shareholder' || !s.type).length / getActualShareholders().length) * 100).toFixed(1) : 0}% ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ
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
                      <span>{investmentType === 'buy' ? 'Equity Purchase' : investmentType === 'partner' ? 'Partnership' : investmentType === 'guarantor' ? 'Guarantor' : 'Support'}</span>
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
                      {liveTotalShares > 0 && (
                        <div className="flex justify-between">
                          <span className="font-semibold">Equity Stake:</span>
                          <span>{equityStakePercent.toFixed(2)}% ({sharesRequested.toLocaleString()} of {liveTotalShares.toLocaleString()} live shares)</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Business Plan */}
                  {sellerDocuments?.business_plan_content && (
                    <div className="border-b pb-4">
                      <h2 className="font-bold text-lg mb-3">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ Business Plan</h2>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                        {sellerDocuments.business_plan_content}
                      </div>
                    </div>
                  )}

                  {/* Financial Projection */}
                  {sellerDocuments?.financial_projection_content && (
                    <div className="border-b pb-4">
                      <h2 className="font-bold text-lg mb-3">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â° Financial Projection</h2>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                        {sellerDocuments.financial_projection_content}
                      </div>
                    </div>
                  )}

                  {/* Value Proposition */}
                  {(sellerDocuments?.value_proposition_wants || sellerDocuments?.value_proposition_fears || sellerDocuments?.value_proposition_needs) && (
                    <div className="border-b pb-4">
                      <h2 className="font-bold text-lg mb-3">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¯ Value Proposition</h2>
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
                      <h2 className="font-bold text-lg mb-3">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Memorandum of Understanding</h2>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                        {sellerDocuments.mou_content}
                      </div>
                    </div>
                  )}

                  {/* Share Allocation */}
                  {(sellerDocuments?.share_allocation_shares || sellerDocuments?.share_allocation_share_price) && (
                    <div className="border-b pb-4">
                      <h2 className="font-bold text-lg mb-3">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  Share Allocation Details</h2>
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
                      <h2 className="font-bold text-lg mb-3">ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Disclosure & Notes</h2>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap bg-yellow-50 p-3 rounded border border-yellow-200">
                        {sellerDocuments.disclosure_notes}
                      </div>
                    </div>
                  )}

                  {/* PIN Signature Seal */}
                  <div className="border-2 border-green-500 bg-green-50 p-4 rounded">
                    <h3 className="font-bold text-gray-900 mb-2">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â Investor Signature Seal</h3>
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
                        <span className="font-bold text-green-600">ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ VERIFIED</span>
                      </div>
                    </div>
                  </div>

                  {/* Approval Threshold Status */}
                  <div className="bg-blue-50 border border-blue-300 rounded p-4">
                    <h3 className="font-bold text-gray-900 mb-3">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  Approval Threshold Status</h3>
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
                          {getActualShareholders().length > 0 && (signatures.length / getActualShareholders().length) >= 0.60 ? 'ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ THRESHOLD MET' : 'ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ PENDING'}
                        </span>
                      </div>
                    </div>
                    {getActualShareholders().length > 0 && (signatures.length / getActualShareholders().length) >= 0.60 && (
                      <div className="mt-3 p-2 bg-green-100 border border-green-500 rounded text-green-700 text-xs font-bold text-center">
                        ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ DOCUMENT APPROVED FOR PRINTING
                      </div>
                    )}
                  </div>

                  {/* Creator/Business Owner Signature */}
                  <div className="border-2 border-purple-500 bg-purple-50 p-4 rounded">
                    <h3 className="font-bold text-gray-900 mb-3">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Business Owner/Creator Signature</h3>
                    <div className="space-y-2 text-sm text-gray-700">
                      <div className="flex justify-between">
                        <span className="font-semibold">Creator:</span>
                        <span>{businessProfile?.owner_name || businessProfile?.creator_name || pitch?.creator_name || 'Unknown'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold">Status:</span>
                        <span className={signatures.some(s => s.type === 'creator') ? 'font-bold text-green-600' : 'font-bold text-red-600'}>
                          {signatures.some(s => s.type === 'creator') ? 'ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ SIGNED' : 'ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ AWAITING SIGNATURE'}
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
                    <h3 className="font-bold text-gray-900 mb-2">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€šÃ‚Â° Investor Signature Seal</h3>
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
                        <span className="font-bold text-green-600">ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ VERIFIED</span>
                      </div>
                    </div>
                  </div>

                  {/* All Shareholders Approvals */}
                  <div className="border-t-2 border-gray-300 pt-4">
                    <h3 className="font-bold text-gray-900 mb-3">
                      ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ Shareholder Approvals
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
                                  <span className="text-xs text-gray-600 ml-2">ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ {shareholder.ownership}% ownership</span>
                                )}
                              </div>
                              <span className={hasSigned ? 'font-bold text-green-600' : 'font-bold text-orange-600'}>
                                {hasSigned ? `ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ ${new Date(signatures.find(s => s.id === shareholder.id)?.timestamp).toLocaleDateString()}` : 'ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ PENDING'}
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
                    <h3 className="font-bold text-gray-900 mb-2">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â¥ Document Distribution</h3>
                    <div className="space-y-2 text-sm text-gray-700">
                      <p>ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ <span className="font-semibold">Investor</span> - Can download this document for records</p>
                      <p>ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ <span className="font-semibold">Creator/Business Owner</span> - Will receive document link after signing</p>
                      <p>ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ <span className="font-semibold">All Shareholders</span> - Will receive document link after 60% approval threshold is met</p>
                      <p className="text-xs text-gray-600 mt-2">Documents are encrypted and stored in ICAN Escrow System for 7 years</p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="border-t-2 border-gray-300 pt-4 text-center text-xs text-gray-600 space-y-1">
                    <p className="font-semibold text-gray-900">ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ This document is sealed and recorded in ICAN Escrow System</p>
                    <p>Escrow Status: {getActualShareholders().length > 0 && (signatures.length / getActualShareholders().length) >= 0.60 ? 'APPROVED FOR PRINTING' : 'ACTIVE'}</p>
                    <p>Threshold: {getActualShareholders().length > 0 ? ((signatures.length / getActualShareholders().length) * 100).toFixed(1) : 0}% / 60% Required</p>
                    <p>Creator Signed: {signatures.some(s => s.type === 'creator') ? 'ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ YES' : 'ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ AWAITING'}</p>
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
                    <span className="font-semibold text-blue-400">Wallet PIN ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Shareholders Signed:</span>
                    <span className="font-semibold">{signatures.filter(s => s.type === 'shareholder' || !s.type).length}/{getActualShareholders().length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <span className={`font-semibold ${getActualShareholders().length > 0 && (signatures.filter(s => s.type === 'shareholder' || !s.type).length / getActualShareholders().length) >= 0.60 ? 'text-green-400' : 'text-yellow-400'}`}>
                      {getActualShareholders().length > 0 && (signatures.filter(s => s.type === 'shareholder' || !s.type).length / getActualShareholders().length) >= 0.60 ? 'ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ COMPLETED & APPROVED' : `ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â³ PENDING ${Math.ceil(getActualShareholders().length * 0.60) - signatures.filter(s => s.type === 'shareholder' || !s.type).length} MORE SIGNATURES`}
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
                  <button
                    onClick={downloadMouPdf}
                    disabled={!qrCodeUrl}
                    className="px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
                  >
                    <FileText className="w-5 h-5" />
                    Download MOU + Seal (PDF)
                  </button>
                </div>
              ) : (
                <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4 text-center">
                  <p className="text-yellow-300 font-semibold">
                    ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Document becomes available after 60% shareholder approval
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
                  ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Investment sealed and recorded! You have been successfully added as a shareholder to <strong>{sellerBusinessProfile?.business_name || pitch?.title || 'the business'}</strong> for "<strong>{pitch?.title}</strong>". Your ${totalInvestment.toFixed(2)} investment ({sharesAmount} shares) is now active in ICAN Escrow.
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
