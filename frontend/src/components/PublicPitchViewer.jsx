import './pitchin-classic.css';
import React, { useState, useEffect, useRef } from 'react';
import { Heart, MessageCircle, Share2, Briefcase, X, Send, AlertCircle, Loader, Check, Sun, Moon, Compass, ChevronUp, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import { getPitchById, PITCH_PLAN_SECTIONS } from '../services/pitchingService';
import {
  likePitchDb,
  unlikePitchDb,
  hasUserLikedPitch,
  getPitchComments,
  addPitchComment,
  recordShare
} from '../services/pitchInteractionsService';
import { getLiveShareOffer } from '../services/pitchinValuationService';
import { LIVE_OFFER_BLOCKED_MESSAGE } from './Pitchin';
import ShareSigningFlow from './ShareSigningFlow';

// Rendered instead of the normal authenticated app (see main.jsx) when the
// URL is a shared pitch link (/pitchin/:pitchId) -- the whole point of a
// share link is that whoever receives it sees the actual video immediately,
// with no account required. Interacting further (like/comment/invest) is
// what actually needs an account, so only those specific actions prompt
// sign-in -- never the page load itself.
// Styles for the written-plan page. Colours are CSS variables switched by
// data-mode so light (parchment + burgundy) and dark (midnight + gold) share
// one set of rules.
const PLAN_CSS = `
.pp-root{--bg:#f6efdf;--surface:#fffaf0;--ink:#2a2118;--muted:#6a5a48;--accent:#7a1f2b;--accent2:#b8892b;--line:#e0d1b2;--shadow:0 10px 30px -12px rgba(90,60,20,.35);
  background:radial-gradient(1200px 500px at 50% -10%,rgba(184,137,43,.18),transparent 60%),var(--bg);color:var(--ink);font-family:Georgia,'Times New Roman',serif;transition:background .5s,color .5s}
.pp-root[data-mode=dark]{--bg:#0d1325;--surface:#151d36;--ink:#efe6d1;--muted:#a9a290;--accent:#e3b765;--accent2:#7fa8ff;--line:#2a3558;--shadow:0 10px 30px -12px rgba(0,0,0,.7);
  background:radial-gradient(1000px 500px at 50% -10%,rgba(127,168,255,.16),transparent 60%),radial-gradient(800px 400px at 100% 100%,rgba(227,183,101,.08),transparent 60%),var(--bg)}
.pp-progress{position:fixed;top:0;left:0;right:0;height:3px;z-index:50;transform-origin:left;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:transform .1s linear}
.pp-header{position:sticky;top:0;z-index:40;display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.pp-brand{font-weight:700;letter-spacing:.18em;text-transform:uppercase;font-size:13px;color:var(--accent)}
.pp-header-actions{display:flex;align-items:center;gap:8px}
.pp-icon-btn{background:none;border:0;padding:6px;border-radius:999px;color:var(--muted);cursor:pointer;transition:transform .3s,color .2s,background .2s}
.pp-icon-btn:hover{color:var(--accent);background:var(--line);transform:rotate(15deg)}
.pp-pill-solid{font:600 12px system-ui,sans-serif;padding:7px 14px;border-radius:999px;border:0;background:var(--accent);color:var(--bg);cursor:pointer;transition:transform .2s,filter .2s}
.pp-pill-solid:hover{transform:translateY(-1px);filter:brightness(1.1)}
.pp-main{max-width:760px;margin:0 auto;padding:44px 20px 80px}
.pp-hero{text-align:center}
.pp-avatar-ring{display:inline-block;padding:4px;border-radius:50%;background:conic-gradient(var(--accent),var(--accent2),var(--accent));animation:pp-spin 12s linear infinite}
.pp-avatar{display:block;width:84px;height:84px;border-radius:50%;object-fit:cover;border:3px solid var(--bg);animation:pp-spin 12s linear infinite reverse}
.pp-avatar-fallback{display:flex;align-items:center;justify-content:center;background:var(--surface);color:var(--accent);font-size:32px;font-weight:700}
.pp-eyebrow{margin-top:16px;font:600 12px system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
.pp-title{margin-top:10px;font-size:clamp(28px,6vw,46px);line-height:1.15;font-weight:700;background:linear-gradient(100deg,var(--ink) 30%,var(--accent) 50%,var(--ink) 70%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:pp-sheen 6s ease-in-out infinite}
.pp-kicker{font-style:italic;color:var(--muted);font-size:15px}
.pp-ornament{display:flex;align-items:center;justify-content:center;gap:14px;margin:22px auto;color:var(--accent2);max-width:320px}
.pp-ornament span{flex:1;height:1px;background:linear-gradient(90deg,transparent,var(--accent2),transparent);transform-origin:center;animation:pp-grow 1.2s .3s both}
.pp-ornament i{font-style:normal;font-size:14px;animation:pp-twinkle 3s ease-in-out infinite}
.pp-cover{display:block;width:100%;max-height:420px;object-fit:cover;border-radius:16px;margin:8px 0 22px;border:1px solid var(--line);box-shadow:var(--shadow)}
.pp-actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}
.pp-pill{display:inline-flex;align-items:center;gap:6px;font:600 13px system-ui,sans-serif;padding:8px 16px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer;box-shadow:var(--shadow);transition:transform .2s,border-color .2s,color .2s}
.pp-pill:hover{transform:translateY(-2px);border-color:var(--accent);color:var(--accent)}
.pp-pill:active{transform:scale(.96)}
.pp-liked{color:#e0334a;fill:#e0334a;animation:pp-beat .5s}
.pp-tiles{display:grid;gap:14px;margin-top:34px}
.pp-tiles-2{grid-template-columns:repeat(2,1fr)}
.pp-tiles-3{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
.pp-tile{position:relative;text-align:center;padding:20px 12px 16px;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;transition:transform .3s}
.pp-tile::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.pp-tile:hover{transform:translateY(-4px) rotate(-.4deg)}
.pp-tile-label{font:700 10px system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
.pp-tile-value{margin-top:6px;font-size:24px;font-weight:700;color:var(--accent);word-break:break-word}
.pp-sections{margin-top:44px;display:flex;flex-direction:column;gap:34px}
.pp-section{display:grid;grid-template-columns:56px 1fr;gap:16px;padding:22px 22px 22px 0;border-radius:14px;transition:background .3s,transform .3s}
.pp-section:hover{background:color-mix(in srgb,var(--surface) 70%,transparent);transform:translateX(4px)}
.pp-num{font-size:34px;font-weight:700;font-style:italic;text-align:center;color:var(--accent2);opacity:.85;line-height:1}
.pp-h2{font-size:22px;font-weight:700;color:var(--accent);margin-bottom:8px;position:relative;display:inline-block}
.pp-h2::after{content:'';position:absolute;left:0;bottom:-3px;height:2px;width:100%;background:var(--accent2);transform:scaleX(0);transform-origin:left;transition:transform .5s}
.pp-section:hover .pp-h2::after{transform:scaleX(1)}
.pp-body{white-space:pre-wrap;line-height:1.8;font-size:17px;color:var(--ink)}
.pp-dropcap::first-letter{float:left;font-size:3.4em;line-height:.9;padding:6px 10px 0 0;font-weight:700;color:var(--accent)}
.pp-note{text-align:center;font-style:italic;color:var(--muted);font-size:13px;margin-top:20px}
.pp-invest{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:16px;border:0;border-radius:14px;font:700 16px system-ui,sans-serif;letter-spacing:.04em;color:#fff;background:linear-gradient(110deg,var(--accent),#a8452f 55%,var(--accent2));background-size:200% 100%;cursor:pointer;box-shadow:var(--shadow);transition:transform .25s,background-position .6s}
.pp-root[data-mode=dark] .pp-invest{color:#1a1405;background-image:linear-gradient(110deg,var(--accent),#f3d58f 55%,var(--accent2))}
.pp-invest:hover{transform:translateY(-2px);background-position:100% 0}
.pp-invest:disabled{opacity:.6;cursor:wait}
.pp-invest::after{content:'';position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.45),transparent);transform:skewX(-20deg);animation:pp-shine 3.5s ease-in-out infinite}
.pp-next{display:flex;align-items:center;gap:12px;width:100%;margin-top:14px;padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);text-align:left;cursor:pointer;box-shadow:var(--shadow);transition:transform .25s,border-color .2s}
.pp-next:hover{transform:translateY(-2px);border-color:var(--accent)}
.pp-next small{display:block;font:700 10px system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
.pp-next strong{display:block;margin-top:2px;font-size:17px;color:var(--accent)}
.pp-explore{display:block;margin:16px auto 0;background:none;border:0;font:600 13px system-ui,sans-serif;color:var(--muted);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.pp-explore:hover{color:var(--accent)}
.pp-rise{opacity:0;animation:pp-rise .8s cubic-bezier(.2,.7,.2,1) forwards}
.pp-pop{opacity:0;animation:pp-pop .6s cubic-bezier(.3,1.4,.5,1) forwards}
@keyframes pp-rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes pp-pop{from{opacity:0;transform:scale(.85) translateY(12px)}to{opacity:1;transform:none}}
@keyframes pp-spin{to{transform:rotate(360deg)}}
@keyframes pp-sheen{0%,100%{background-position:100% 0}50%{background-position:0 0}}
@keyframes pp-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes pp-twinkle{0%,100%{opacity:.5;transform:scale(1) rotate(0)}50%{opacity:1;transform:scale(1.3) rotate(45deg)}}
@keyframes pp-beat{0%{transform:scale(1)}40%{transform:scale(1.5)}100%{transform:scale(1)}}
@keyframes pp-shine{0%,60%{left:-60%}100%{left:140%}}
@media (max-width:520px){.pp-section{grid-template-columns:36px 1fr;gap:10px}.pp-num{font-size:24px}.pp-body{font-size:16px}.pp-tiles-2{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.pp-root *,.pp-root *::before,.pp-root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition:none!important}.pp-rise,.pp-pop{opacity:1}}
`;

// A shared pitch is the first step of a flow, not a dead end (see
// PublicShareFlow): `nextPitch`/`onNext`/`onPrev` page through more pitches
// (swipe up/down, arrow keys, or the on-screen chevrons), and `onExplore`
// opens the Explore sheet of live updates and pitches.
const SWIPE_MIN_PX = 80;
const SWIPE_BLOCKED_BOTTOM_PX = 110; // keep the native video controls usable

const PublicPitchViewer = ({ pitchId, nextPitch = null, hasPrev = false, onNext, onPrev, onExplore }) => {
  const { user, loading: authLoading, signInWithWallet, signInWithGoogle } = useAuth();
  const [pitch, setPitch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [sharesCount, setSharesCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authView, setAuthView] = useState('signup');
  const [selectedForInvestment, setSelectedForInvestment] = useState(null);
  const [investLoading, setInvestLoading] = useState(false);
  const [planMode, setPlanMode] = useState(() => {
    try {
      const saved = localStorage.getItem('pitchPlanMode');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* storage unavailable */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [planProgress, setPlanProgress] = useState(0);
  const [planOffer, setPlanOffer] = useState(null);
  // Visitor invest authorisation: wallet account number + PIN, or Google.
  const [showInvestAuth, setShowInvestAuth] = useState(false);
  const [authId, setAuthId] = useState('');
  const [authPin, setAuthPin] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const pendingInvest = useRef(false);
  const videoRef = useRef(null);
  const autoInvestTriggered = useRef(false);
  const touchStart = useRef(null);
  const [showSwipeHint, setShowSwipeHint] = useState(true);

  const isPlan = Boolean(pitch && !pitch.video_url && pitch.plan_content);
  const flowBlocked = showComments || showAuthModal || showInvestAuth || Boolean(selectedForInvestment);

  useEffect(() => {
    const timer = setTimeout(() => setShowSwipeHint(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  // Arrow keys move through pitches on desktop (video pitches only -- a
  // written plan scrolls, so its arrows must keep scrolling).
  useEffect(() => {
    if (!pitch || isPlan || flowBlocked) return undefined;
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|VIDEO)$/.test(e.target?.tagName || '')) return;
      if (e.key === 'ArrowDown') onNext?.();
      else if (e.key === 'ArrowUp' && hasPrev) onPrev?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pitch, isPlan, flowBlocked, hasPrev, onNext, onPrev]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const data = await getPitchById(pitchId);
      if (cancelled) return;
      if (!data) {
        setNotFound(true);
      } else {
        setPitch(data);
        setLikesCount(data.likes_count || 0);
        setSharesCount(data.shares_count || 0);
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [pitchId]);

  // Live share price for the plan's terms tiles.
  useEffect(() => {
    let cancelled = false;
    if (!pitch?.plan_content) return undefined;
    const profileId = pitch.business_profile_id || pitch.business_profiles?.id;
    getLiveShareOffer(profileId, pitch.business_profiles?.user_id)
      .then((offer) => { if (!cancelled) setPlanOffer(offer); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pitch?.id]);

  // Once we know who's viewing, check whether they've already liked this
  // pitch so the heart shows the right state instead of always starting cold.
  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !pitch?.id) return undefined;
    hasUserLikedPitch(pitch.id, user.id).then((isLiked) => {
      if (!cancelled) setLiked(isLiked);
    });
    return () => { cancelled = true; };
  }, [user?.id, pitch?.id]);

  const requireAuth = (view = 'signup') => {
    setAuthView(view);
    setShowAuthModal(true);
  };

  const handleLike = async () => {
    if (authLoading) return;
    if (!user) { requireAuth('signup'); return; }
    if (liked) {
      const result = await unlikePitchDb(pitch.id, user.id);
      if (result.success) {
        setLiked(false);
        setLikesCount(result.data?.likes_count ?? ((c) => Math.max(0, c - 1)));
      }
    } else {
      const result = await likePitchDb(pitch.id, user.id, user.email);
      if (result.success) {
        setLiked(true);
        setLikesCount(result.data?.likes_count ?? ((c) => c + 1));
      }
    }
  };

  const openComments = async () => {
    if (authLoading) return;
    if (!user) { requireAuth('signup'); return; }
    setShowComments(true);
    if (comments.length === 0) {
      setLoadingComments(true);
      const data = await getPitchComments(pitch.id);
      setComments(data);
      setLoadingComments(false);
    }
  };

  const handleAddComment = async () => {
    if (authLoading) return;
    if (!user) { requireAuth('signup'); return; }
    if (!newComment.trim()) return;
    const userName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous';
    const result = await addPitchComment(pitch.id, user.id, userName, newComment.trim());
    if (result.success) {
      setComments((prev) => [
        { ...result.data, avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null },
        ...prev
      ]);
      setNewComment('');
    }
  };

  const handleShare = async () => {
    if (authLoading) return;
    if (!user) { requireAuth('signup'); return; }
    const shareUrl = `https://icanera.space/pitchin/${pitch.id}`;
    const shareData = {
      title: pitch.title || 'Check out this pitch!',
      text: pitch.description || 'Discover this amazing investment opportunity on IcanEra',
      url: shareUrl
    };
    try {
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
      const result = await recordShare(pitch.id, user?.id || null, 'link');
      if (result.success && result.data) {
        setSharesCount(result.data.shares_count);
      } else {
        setSharesCount((c) => c + 1);
      }
    } catch (error) {
      console.error('Error sharing pitch:', error);
    }
  };

  const handleInvest = async () => {
    if (authLoading) return;
    if (!user) { pendingInvest.current = true; setAuthError(''); setShowInvestAuth(true); return; }

    setInvestLoading(true);
    try {
      const businessProfileId = pitch.business_profile_id || pitch.business_profiles?.id;
      const businessOwnerUserId = pitch.business_profiles?.user_id;
      const offer = await getLiveShareOffer(businessProfileId, businessOwnerUserId);

      if (!offer.available) {
        alert(LIVE_OFFER_BLOCKED_MESSAGE[offer.reason] || LIVE_OFFER_BLOCKED_MESSAGE.default);
        return;
      }
      if (offer.sharesAvailable <= 0) {
        alert(`All ${offer.totalShares.toLocaleString()} shares in this business are already taken. There are no shares left to buy.`);
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
        live_computed_at: offer.computedAt
      });
    } catch (error) {
      console.warn('[PublicPitchViewer] Live share valuation failed:', error.message);
      alert('Live share value is unavailable for this business right now. Please try again in a moment.');
    } finally {
      setInvestLoading(false);
    }
  };

  // Lets a link like /pitchin/:id?invest=1 (used by the public business
  // board's "Invest Now" button) land the visitor straight into the real
  // invest flow instead of requiring a second click here -- fires the same
  // handleInvest a manual click would, exactly once.
  useEffect(() => {
    if (autoInvestTriggered.current) return;
    if (authLoading || !pitch) return;
    if (new URLSearchParams(window.location.search).get('invest') !== '1') return;
    autoInvestTriggered.current = true;
    handleInvest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch, authLoading]);

  const togglePlanMode = () => {
    const next = planMode === 'dark' ? 'light' : 'dark';
    setPlanMode(next);
    try { localStorage.setItem('pitchPlanMode', next); } catch { /* storage unavailable */ }
  };

  // Once a visitor has authorised (PIN or Google), carry straight on into the
  // invest flow they started instead of making them click Invest again.
  useEffect(() => {
    if (!user || !pendingInvest.current || !pitch) return;
    pendingInvest.current = false;
    setShowInvestAuth(false);
    handleInvest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, pitch?.id]);

  const handlePinAuthorise = async (e) => {
    e?.preventDefault();
    if (!authId.trim() || !/^\d{4,6}$/.test(authPin.trim())) {
      setAuthError('Enter your account number (or phone) and your 4-6 digit PIN.');
      return;
    }
    setAuthBusy(true);
    setAuthError('');
    try {
      await signInWithWallet(authId, authPin);
    } catch (err) {
      setAuthError(err.message || 'Could not verify your PIN. Try again.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleAuthorise = async () => {
    setAuthBusy(true);
    setAuthError('');
    try {
      // Returns to this same page; the ?invest=1 flag resumes the flow.
      const url = new URL(window.location.href);
      url.searchParams.set('invest', '1');
      window.history.replaceState({}, '', url.toString());
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err.message || 'Google sign-in failed. Try again.');
      setAuthBusy(false);
    }
  };

  const goToApp = () => {
    window.history.replaceState({}, '', '/');
    window.location.href = '/';
  };

  // Vertical swipe = next/previous pitch, the same gesture as the feed.
  // Touches that start on a button or the bottom strip (the video's own
  // controls) are left alone, as is everything while a panel is open.
  const handleTouchStart = (e) => {
    const t = e.touches[0];
    const ignore = isPlan || flowBlocked || !onNext
      || t.clientY > window.innerHeight - SWIPE_BLOCKED_BOTTOM_PX
      || e.target.closest?.('button, a, input, textarea');
    touchStart.current = ignore ? null : { x: t.clientX, y: t.clientY };
  };
  const handleTouchEnd = (e) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - start.y;
    const dx = t.clientX - start.x;
    if (Math.abs(dy) < SWIPE_MIN_PX || Math.abs(dy) < Math.abs(dx) * 1.5) return;
    if (dy < 0) onNext();
    else if (hasPrev) onPrev();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader className="w-10 h-10 text-white animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="pitchin-classic fixed inset-0 bg-black flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="w-14 h-14 text-slate-500" />
        <p className="text-white text-lg font-semibold">This pitch isn't available anymore</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onExplore}
            className="icon-btn-transparent px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-lg font-semibold transition inline-flex items-center gap-2"
          >
            <Compass className="w-4 h-4" /> Explore more
          </button>
          <button
            onClick={goToApp}
            className="icon-btn-transparent px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white rounded-lg font-semibold transition"
          >
            Open IcanEra
          </button>
        </div>
      </div>
    );
  }

  const bizName = pitch.business_profiles?.business_name || 'Pitcher';
  const bizPhoto = pitch.business_profiles?.avatar_url || pitch.business_profiles?.owner_avatar_url;

  // A written plan (no video) is shown as a readable web document, not as a
  // video player with nothing to play.
  const plan = isPlan ? pitch.plan_content : null;
  const planMoney = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  // Live share value when available; the typed dollar figures are the fallback.
  const planLive = planOffer?.available && Number(planOffer.sharePriceUgx) > 0 ? planOffer : null;
  const planUgx = (n) => `UGX ${Number(n).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
  const planTiles = plan ? [
    planLive && plan.shares
      ? { label: 'Seeking', value: planUgx(Number(plan.shares) * planLive.sharePriceUgx) }
      : plan.total_value ? { label: 'Seeking', value: planMoney(plan.total_value) } : null,
    plan.shares ? { label: 'Shares offered', value: Number(plan.shares).toLocaleString() } : null,
    planLive
      ? { label: 'Live price per share', value: planUgx(planLive.sharePriceUgx) }
      : plan.share_price ? { label: 'Price per share', value: planMoney(plan.share_price) } : null,
  ].filter(Boolean) : [];
  const planSections = plan ? PITCH_PLAN_SECTIONS.filter(({ key }) => plan[key]) : [];

  return (
    <div
      className={plan ? 'pp-root fixed inset-0 w-screen h-screen overflow-y-auto' : 'pitchin-classic fixed inset-0 bg-black w-screen h-screen overflow-hidden'}
      data-mode={plan ? planMode : undefined}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onScroll={plan ? (e) => { const el = e.currentTarget; const max = el.scrollHeight - el.clientHeight; setPlanProgress(max > 0 ? el.scrollTop / max : 0); } : undefined}
    >
      {plan && (
        <>
          <style>{PLAN_CSS}</style>
          <div className="pp-progress" style={{ transform: `scaleX(${planProgress})` }} />
          <header className="pp-header">
            <span className="pp-brand">IcanEra</span>
            <div className="pp-header-actions">
              {onExplore && (
                <button onClick={onExplore} className="pp-icon-btn" title="Explore more pitches and updates" aria-label="Explore">
                  <Compass className="w-5 h-5" />
                </button>
              )}
              <button onClick={togglePlanMode} className="pp-icon-btn" title={planMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label="Toggle light or dark mode">
                {planMode === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              {!authLoading && !user && (
                <button onClick={() => requireAuth('signup')} className="pp-pill-solid">Sign up</button>
              )}
              <button onClick={goToApp} className="pp-icon-btn" title="Open IcanEra" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
          </header>

          <main className="pp-main">
            <div className="pp-hero pp-rise" style={{ animationDelay: '0ms' }}>
              <div className="pp-avatar-ring">
                {bizPhoto ? (
                  <img src={bizPhoto} alt={bizName} className="pp-avatar" />
                ) : (
                  <div className="pp-avatar pp-avatar-fallback">{bizName.charAt(0).toUpperCase()}</div>
                )}
              </div>
              <p className="pp-eyebrow">{bizName}</p>
              <h1 className="pp-title">{pitch.title}</h1>
              <div className="pp-ornament" aria-hidden="true"><span /><i>❖</i><span /></div>
              <p className="pp-kicker">Investor Business Plan</p>
            </div>

            {plan.image_url && (
              <img src={plan.image_url} alt={pitch.title} className="pp-cover pp-pop" style={{ animationDelay: '60ms' }} />
            )}

            <div className="pp-actions pp-rise" style={{ animationDelay: '120ms' }}>
              <button onClick={handleLike} className="pp-pill">
                <Heart className={`w-4 h-4 ${liked ? 'pp-liked' : ''}`} /> {likesCount}
              </button>
              <button onClick={openComments} className="pp-pill">
                <MessageCircle className="w-4 h-4" /> {pitch.comments_count || 0}
              </button>
              <button onClick={handleShare} className="pp-pill">
                {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />} {copied ? 'Link copied' : sharesCount}
              </button>
            </div>

            {planTiles.length > 0 && (
              <div className={`pp-tiles pp-tiles-${planTiles.length}`}>
                {planTiles.map((t, i) => (
                  <div key={t.label} className="pp-tile pp-pop" style={{ animationDelay: `${220 + i * 110}ms` }}>
                    <p className="pp-tile-label">{t.label}</p>
                    <p className="pp-tile-value">{t.value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="pp-sections">
              {planSections.map(({ key, label }, i) => (
                <section key={key} className="pp-section pp-rise" style={{ animationDelay: `${360 + i * 140}ms` }}>
                  <div className="pp-num">{String(i + 1).padStart(2, '0')}</div>
                  <div>
                    <h2 className="pp-h2">{label}</h2>
                    <p className={`pp-body ${i === 0 ? 'pp-dropcap' : ''}`}>{plan[key]}</p>
                  </div>
                </section>
              ))}
            </div>

            {plan.has_mou && (
              <p className="pp-note">A memorandum of understanding is shared with investors on request.</p>
            )}

            <div className="pp-ornament" aria-hidden="true"><span /><i>❖</i><span /></div>
            <button onClick={handleInvest} disabled={investLoading} className="pp-invest">
              {investLoading ? <Loader className="w-5 h-5 animate-spin" /> : <Briefcase className="w-5 h-5" />}
              <span>Invest in {bizName}</span>
            </button>

            {nextPitch && onNext && (
              <button onClick={onNext} className="pp-next">
                <span style={{ flex: 1, minWidth: 0 }}>
                  <small>Up next</small>
                  <strong>{nextPitch.title || 'Another pitch'}</strong>
                </span>
                <ChevronDown className="w-5 h-5" style={{ transform: 'rotate(-90deg)', color: 'var(--accent)' }} />
              </button>
            )}
            {onExplore && (
              <button onClick={onExplore} className="pp-explore">Explore more pitches and updates</button>
            )}
          </main>
        </>
      )}

      {/* Top bar -- branding + close. Anonymous visitors get a sign-in nudge
          here too, not just on the gated action buttons below. */}
      {!plan && (<>
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 to-transparent">
        <span className="text-white font-bold text-sm tracking-wide">IcanEra</span>
        <div className="flex items-center gap-2">
          {onExplore && (
            <button
              onClick={onExplore}
              className="icon-btn-transparent inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white transition"
              title="Explore more pitches and updates"
            >
              <Compass className="w-4 h-4" /> Explore
            </button>
          )}
          {!authLoading && !user && (
            <button
              onClick={() => requireAuth('signup')}
              className="icon-btn-transparent text-xs font-semibold px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white transition"
            >
              Sign up
            </button>
          )}
          <button onClick={goToApp} className="icon-btn-transparent p-1 text-white" title="Open IcanEra">
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-purple-600 to-pink-600">
        {pitch.video_url ? (
          <video
            ref={videoRef}
            src={pitch.video_url}
            className="w-full h-full object-contain bg-black"
            controls
            autoPlay
            playsInline
            crossOrigin="anonymous"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <AlertCircle className="w-12 h-12 text-slate-300" />
          </div>
        )}
      </div>

      {/* Pitch info */}
      <div className="absolute left-4 right-24 bottom-24 z-20 pointer-events-none">
        <p className="text-white font-bold text-base drop-shadow-lg">{pitch.title}</p>
        <p className="text-white/80 text-sm drop-shadow-lg">{bizName}</p>
        {pitch.description && (
          <p className="text-white/70 text-xs mt-1 line-clamp-2 drop-shadow-lg">{pitch.description}</p>
        )}
      </div>

      {/* Previous / next pitch -- the on-screen twin of swipe and arrow keys.
          The glass lives on an inner span: the theme paints every <button>. */}
      {onNext && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-3">
          {hasPrev && (
            <button onClick={onPrev} className="icon-btn-transparent" title="Previous pitch" aria-label="Previous pitch">
              <span className="flex rounded-full p-2" style={{ backgroundColor: 'rgba(0,0,0,.5)', color: '#fff' }}>
                <ChevronUp className="w-5 h-5" />
              </span>
            </button>
          )}
          <button onClick={onNext} className="icon-btn-transparent" title="Next pitch" aria-label="Next pitch">
            <span className="flex rounded-full p-2" style={{ backgroundColor: 'rgba(0,0,0,.5)', color: '#fff' }}>
              <ChevronDown className="w-5 h-5" />
            </span>
          </button>
        </div>
      )}

      {onNext && showSwipeHint && (
        <div className="absolute left-0 right-0 bottom-44 z-20 flex justify-center pointer-events-none">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold animate-bounce"
            style={{ backgroundColor: 'rgba(0,0,0,.7)', color: '#fff' }}
          >
            <ChevronUp className="w-4 h-4" /> Swipe up for the next pitch
          </span>
        </div>
      )}

      {/* Right action rail */}
      <div className="absolute right-4 bottom-24 flex flex-col gap-5 z-30">
        <button onClick={handleLike} className="icon-btn-transparent flex flex-col items-center gap-1" title="Like">
          <Heart className={`w-7 h-7 drop-shadow-lg ${liked ? 'text-red-500 fill-red-500' : 'text-white'}`} />
          <span className="text-white text-xs font-bold drop-shadow-lg">{likesCount}</span>
        </button>

        <button onClick={openComments} className="icon-btn-transparent flex flex-col items-center gap-1" title="Comment">
          <MessageCircle className="w-7 h-7 text-white drop-shadow-lg" />
          <span className="text-white text-xs font-bold drop-shadow-lg">{pitch.comments_count || 0}</span>
        </button>

        <button onClick={handleShare} className="icon-btn-transparent flex flex-col items-center gap-1" title="Share">
          {copied ? <Check className="w-7 h-7 text-green-400 drop-shadow-lg" /> : <Share2 className="w-7 h-7 text-white drop-shadow-lg" />}
          <span className="text-white text-xs font-bold drop-shadow-lg">{sharesCount}</span>
        </button>

        <button onClick={handleInvest} disabled={investLoading} className="icon-btn-transparent flex flex-col items-center gap-1" title="Invest">
          {investLoading ? <Loader className="w-7 h-7 text-white animate-spin" /> : <Briefcase className="w-7 h-7 text-white drop-shadow-lg" />}
          <span className="text-white text-xs font-bold drop-shadow-lg">Invest</span>
        </button>

        <button
          onClick={() => { if (!authLoading && !user) requireAuth('signup'); }}
          className="icon-btn-transparent flex flex-col items-center gap-1"
          title="Pitcher"
        >
          {bizPhoto ? (
            <img
              src={bizPhoto}
              alt={bizName}
              className="w-10 h-10 rounded-full object-cover border border-white/30"
              onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
            />
          ) : null}
          <div
            className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-orange-400 items-center justify-center text-white font-bold border border-white/30"
            style={{ display: bizPhoto ? 'none' : 'flex' }}
          >
            {bizName.charAt(0).toUpperCase()}
          </div>
        </button>
      </div>
      </>)}

      {/* Comments panel */}
      {showComments && (
        <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-slate-800 rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h3 className="text-lg font-bold text-white">Comments</h3>
              <button onClick={() => setShowComments(false)} className="icon-btn-transparent text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loadingComments ? (
                <div className="flex justify-center py-8"><Loader className="w-6 h-6 text-slate-400 animate-spin" /></div>
              ) : comments.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No comments yet. Be the first!</p>
              ) : comments.map((comment) => (
                <div key={comment.id} className="bg-slate-700/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    {comment.avatar_url ? (
                      <img src={comment.avatar_url} alt={comment.user_name} className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                        {(comment.user_name || 'U')[0]?.toUpperCase()}
                      </div>
                    )}
                    <p className="text-white font-medium text-sm">{comment.user_name || 'Anonymous'}</p>
                  </div>
                  <p className="text-slate-300 text-sm pl-10">{comment.comment_text}</p>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-700">
              {user ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                    placeholder="Add a comment..."
                    className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-slate-400"
                  />
                  <button onClick={handleAddComment} disabled={!newComment.trim()} className="icon-btn-transparent bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white p-2 rounded-lg transition">
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => requireAuth('signup')}
                  className="icon-btn-transparent w-full bg-pink-500 hover:bg-pink-600 text-white rounded-lg font-semibold py-2.5 text-sm transition"
                >
                  Sign in to comment
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sign-in / sign-up overlay -- gates like/comment/invest, never the
          video itself. Closes back into this same viewer on success. */}
      {showAuthModal && (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <button
            onClick={() => setShowAuthModal(false)}
            className="icon-btn-transparent fixed top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-black/40 z-10"
          >
            <X className="w-6 h-6" />
          </button>
          {/* AuthPage/SignIn/SignUp size themselves for a full viewport
              (their own min-h-screen background + centering) -- wrapping them
              in a constrained box here would double-constrain and break that. */}
          <AuthPage initialView={authView} onAuthSuccess={() => setShowAuthModal(false)} />
        </div>
      )}

      {showInvestAuth && !user && (
        <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
          <form onSubmit={handlePinAuthorise} className="bg-slate-800 rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white">Continue to authorise</h3>
                <p className="text-sm text-slate-400 mt-0.5">Confirm it is you with your wallet PIN to invest in {bizName}.</p>
              </div>
              <button type="button" onClick={() => { pendingInvest.current = false; setShowInvestAuth(false); }} className="icon-btn-transparent text-slate-400 hover:text-white p-1" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              inputMode="numeric"
              value={authId}
              onChange={(e) => { setAuthId(e.target.value); setAuthError(''); }}
              placeholder="Account number or phone"
              className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-slate-400"
            />
            <input
              type="password"
              inputMode="numeric"
              value={authPin}
              onChange={(e) => { setAuthPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setAuthError(''); }}
              placeholder="PIN"
              className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-slate-400"
            />
            {authError && <p className="text-sm text-red-400">{authError}</p>}
            <button type="submit" disabled={authBusy} className="icon-btn-transparent w-full bg-pink-500 hover:bg-pink-600 disabled:opacity-60 text-white rounded-lg font-semibold py-2.5 text-sm transition flex items-center justify-center gap-2">
              {authBusy && <Loader className="w-4 h-4 animate-spin" />} Continue
            </button>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex-1 h-px bg-slate-700" /> No account yet? <span className="flex-1 h-px bg-slate-700" />
            </div>
            <button type="button" onClick={handleGoogleAuthorise} disabled={authBusy} className="icon-btn-transparent w-full bg-white hover:bg-slate-100 disabled:opacity-60 text-slate-900 rounded-lg font-semibold py-2.5 text-sm transition">
              Continue with Google
            </button>
            <button type="button" onClick={() => { setShowInvestAuth(false); requireAuth('signin'); }} className="icon-btn-transparent w-full text-xs text-slate-400 hover:text-white">
              Use email and password instead
            </button>
          </form>
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

export default PublicPitchViewer;
