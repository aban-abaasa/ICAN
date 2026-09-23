import React, { useEffect, useRef, useState } from 'react';
import { Lock, X, AlertCircle, Loader, ShieldOff, Clock as ClockIcon, TrendingUp, FileText, ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import { supabase } from '../lib/supabase/client';
import { getPitchById } from '../services/pitchingService';
import { getLiveShareOffer } from '../services/pitchinValuationService';
import {
  checkPrivatePitchInviteStatus,
  openPrivatePitchInvite,
  materializePrivatePitchForInvestment,
} from '../services/privatePitchInviteService';
import ShareSigningFlow from './ShareSigningFlow';

const DEAD_MESSAGES = {
  not_found: "This invitation link doesn't exist.",
  revoked: 'This invitation has been withdrawn by the business.',
  expired: 'This invitation has expired.',
  locked: 'Too many incorrect PINs -- this invitation has been locked. Contact the business for a new link.',
  error: "This invitation couldn't be loaded. Please try again.",
};

const formatCountdown = (expiresAt) => {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remMins = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${remMins}m`;
  return `${remMins}m`;
};

const PinPad = ({ onSubmit, submitting, attemptsLeft, error }) => {
  const [digits, setDigits] = useState(['', '', '', '']);
  const [shake, setShake] = useState(false);
  const refs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  useEffect(() => {
    if (error) {
      setShake(true);
      setDigits(['', '', '', '']);
      refs[0].current?.focus();
      const t = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const handleChange = (index, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < 3) refs[index + 1].current?.focus();
    if (digit && index === 3 && next.every((d) => d !== '')) onSubmit(next.join(''));
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) refs[index - 1].current?.focus();
  };

  return (
    <div>
      <div className={`flex justify-center gap-3 ${shake ? 'animate-[shake_0.4s]' : ''}`} style={{ animationName: shake ? 'invite-pin-shake' : undefined }}>
        <style>{'@keyframes invite-pin-shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }'}</style>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={refs[i]}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            inputMode="numeric"
            maxLength={1}
            disabled={submitting}
            className="w-14 h-16 text-center text-2xl font-mono font-bold bg-white/10 text-white rounded-xl border border-white/20 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
          />
        ))}
      </div>
      {submitting && <p className="text-center text-white/60 text-sm mt-4 flex items-center justify-center gap-2"><Loader className="w-4 h-4 animate-spin" /> Checking PIN...</p>}
      {error && !submitting && (
        <p className="text-center text-red-300 text-sm mt-4">
          Incorrect PIN.{attemptsLeft != null ? ` ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.` : ''}
        </p>
      )}
    </div>
  );
};

/**
 * Standalone route /invite/:token (see main.jsx) -- the investor-facing side
 * of backend/PITCHIN_PRIVATE_INVESTOR_INVITES.sql. Unlike /pitchin/:id, this
 * page shows nothing real until the PIN is verified server-side; everything
 * after that reuses the exact same live valuation + ShareSigningFlow engine
 * the public flow uses, via materializePrivatePitchForInvestment + the
 * existing getPitchById/getLiveShareOffer -- no signing/escrow logic here.
 */
const PrivatePitchInviteViewer = ({ token }) => {
  const { user, loading: authLoading } = useAuth();
  const [probe, setProbe] = useState(null); // fn_check_private_pitch_invite_status result
  const [checking, setChecking] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(null);
  const [content, setContent] = useState(null); // fn_open_private_pitch_invite success payload
  const [ownerUserId, setOwnerUserId] = useState(null);
  const [businessName, setBusinessName] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [investLoading, setInvestLoading] = useState(false);
  const [selectedForInvestment, setSelectedForInvestment] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    checkPrivatePitchInviteStatus(token).then((result) => { setProbe(result); setChecking(false); });
  }, [token]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Business name/logo + owner user id for the live share offer -- same
  // public RPC pitchingService.js already relies on for the public feed.
  useEffect(() => {
    if (!content?.businessProfileId) return;
    supabase.rpc('fn_get_public_business_profiles', { p_business_profile_ids: [content.businessProfileId] })
      .then(({ data }) => {
        const biz = data?.[0];
        if (biz) { setBusinessName(biz.business_name); setOwnerUserId(biz.user_id); }
      });
  }, [content?.businessProfileId]);

  const handlePinSubmit = async (pin) => {
    setUnlocking(true);
    setPinError(false);
    const result = await openPrivatePitchInvite(token, pin);
    setUnlocking(false);
    if (!result.success) {
      if (result.reason === 'wrong_pin') {
        setPinError(true);
        setAttemptsLeft(result.attemptsLeft);
      } else {
        setProbe({ status: result.reason });
      }
      return;
    }
    setContent(result);
  };

  const requireAuth = () => setShowAuthModal(true);

  const handleInvest = async () => {
    if (authLoading) return;
    if (!user) { requireAuth(); return; }
    setInvestLoading(true);
    try {
      const materialized = await materializePrivatePitchForInvestment(content.inviteId);
      if (!materialized.success) {
        alert(materialized.error || 'This invitation is no longer available.');
        return;
      }
      const pitch = await getPitchById(materialized.pitchId);
      if (!pitch) throw new Error('Could not load this opportunity.');
      const offer = await getLiveShareOffer(content.businessProfileId, ownerUserId);
      if (!offer.available) {
        alert('Live share value is unavailable for this business right now. Please try again in a moment.');
        return;
      }
      if (offer.sharesAvailable <= 0) {
        alert(`All ${offer.totalShares.toLocaleString()} shares in this business are already taken.`);
        return;
      }
      setSelectedForInvestment({
        ...pitch,
        live_share_price_ugx: offer.sharePriceUgx,
        live_total_shares: offer.totalShares,
        live_shares_issued: offer.sharesIssued,
        live_shares_available: offer.sharesAvailable,
        live_business_value_ugx: offer.businessValueUgx,
        live_ican_market_price_ugx: offer.icanMarketPriceUgx,
        live_computed_at: offer.computedAt,
      });
    } catch (error) {
      console.warn('[PrivatePitchInviteViewer] invest failed:', error.message);
      alert('Something went wrong preparing this investment. Please try again.');
    } finally {
      setInvestLoading(false);
    }
  };

  const goToApp = () => { window.history.replaceState({}, '', '/'); window.location.href = '/'; };

  if (checking) {
    return (
      <div className="fixed inset-0 bg-[#0a0710] flex items-center justify-center">
        <Loader className="w-8 h-8 text-amber-300 animate-spin" />
      </div>
    );
  }

  if (!content && probe?.status !== 'active') {
    return (
      <div className="fixed inset-0 bg-[#0a0710] flex flex-col items-center justify-center gap-4 p-6 text-center">
        <ShieldOff className="w-14 h-14 text-slate-500" />
        <p className="text-white text-lg font-semibold">{DEAD_MESSAGES[probe?.status] || DEAD_MESSAGES.error}</p>
        <button onClick={goToApp} className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-semibold transition">
          Open IcanEra
        </button>
      </div>
    );
  }

  if (!content) {
    // Locked -- PIN entry.
    return (
      <div className="fixed inset-0 bg-[#0a0710] overflow-y-auto">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_25%,rgba(212,175,120,0.12),transparent_70%)] pointer-events-none" />
        <div className="relative min-h-screen flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="w-16 h-16 rounded-full border border-amber-300/30 flex items-center justify-center mb-6">
            <Lock className="w-7 h-7 text-amber-300" />
          </div>
          <p className="text-[11px] tracking-[0.4em] text-amber-200/70 uppercase mb-2">Exclusive Invitation</p>
          <h1 className="text-white text-xl font-bold mb-1">
            {probe?.investor_name ? `Prepared exclusively for ${probe.investor_name}` : 'A private investment opportunity'}
          </h1>
          <p className="text-white/50 text-sm mb-8">Enter the 4-digit PIN you were given to view it.</p>

          <PinPad onSubmit={handlePinSubmit} submitting={unlocking} attemptsLeft={attemptsLeft} error={pinError} />

          {probe?.expires_at && (
            <p className="text-white/40 text-xs mt-8 flex items-center gap-1.5">
              <ClockIcon className="w-3.5 h-3.5" /> Expires in {formatCountdown(probe.expires_at)}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Unlocked.
  const offerKnown = Boolean(ownerUserId);
  return (
    <div className="fixed inset-0 bg-[#0a0710] overflow-y-auto">
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
        <span className="text-amber-200 font-bold text-sm tracking-wide">IcanEra · Private Invitation</span>
        <button onClick={goToApp} className="p-1 text-white/70 hover:text-white"><X className="w-6 h-6" /></button>
      </div>

      <div className="max-w-xl mx-auto px-5 pt-20 pb-16">
        {content.investorName && (
          <p className="text-amber-200/80 text-sm font-semibold mb-1">Prepared exclusively for {content.investorName}</p>
        )}
        <h1 className="text-white text-2xl font-bold mb-2">{content.title}</h1>
        {businessName && <p className="text-white/50 text-sm mb-4">{businessName}</p>}

        {content.customMessage && (
          <div className="bg-amber-500/10 border border-amber-400/20 rounded-xl p-4 mb-5">
            <p className="text-amber-100/90 text-sm whitespace-pre-wrap">{content.customMessage}</p>
          </div>
        )}

        {content.videoUrl && (
          <video src={content.videoUrl} poster={content.thumbnailUrl || undefined} controls playsInline className="w-full rounded-xl mb-5 bg-black" />
        )}

        {!content.videoUrl && content.deckUrl && (
          <div className="mb-5">
            <iframe
              title="Pitch deck"
              src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(content.deckUrl)}`}
              className="w-full aspect-video rounded-xl border border-white/10 bg-white"
            />
            <a
              href={content.deckUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200"
            >
              <FileText className="w-3.5 h-3.5" /> Open the deck in a new tab <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {content.pitchType && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-200">{content.pitchType}</span>}
          {content.category && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white/10 text-white/70">{content.category}</span>}
        </div>

        {content.description && <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap mb-6">{content.description}</p>}

        <button
          onClick={handleInvest}
          disabled={investLoading || !offerKnown}
          className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold transition flex items-center justify-center gap-2"
        >
          {investLoading ? <Loader className="w-5 h-5 animate-spin" /> : <TrendingUp className="w-5 h-5" />}
          Invest Now
        </button>
        <p className="text-white/30 text-xs text-center mt-3 flex items-center justify-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" /> Signing in is required to invest -- your details are never shared with anyone else who might have this link.
        </p>
      </div>

      {showAuthModal && (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <button onClick={() => setShowAuthModal(false)} className="fixed top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-black/40 z-10">
            <X className="w-6 h-6" />
          </button>
          <AuthPage initialView="signup" onAuthSuccess={() => setShowAuthModal(false)} />
        </div>
      )}

      {selectedForInvestment && (
        <ShareSigningFlow
          pitch={selectedForInvestment}
          onClose={() => setSelectedForInvestment(null)}
          onInvestmentSubmitted={() => setSelectedForInvestment(null)}
          businessProfile={null}
          currentUser={user}
        />
      )}
    </div>
  );
};

export default PrivatePitchInviteViewer;
