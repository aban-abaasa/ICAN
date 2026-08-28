import React, { useState, useEffect, useRef } from 'react';
import { Heart, MessageCircle, Share2, Briefcase, X, Send, AlertCircle, Loader, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import { getPitchById } from '../services/pitchingService';
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
const PublicPitchViewer = ({ pitchId }) => {
  const { user, loading: authLoading } = useAuth();
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
  const videoRef = useRef(null);

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
    const shareUrl = `https://icanera.space/pitchin/${pitch.id}`;
    const shareData = {
      title: pitch.title || 'Check out this pitch!',
      text: pitch.description || 'Discover this amazing investment opportunity on ICANEra',
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
    if (!user) { requireAuth('signup'); return; }

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

  const goToApp = () => {
    window.history.replaceState({}, '', '/');
    window.location.href = '/';
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
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="w-14 h-14 text-slate-500" />
        <p className="text-white text-lg font-semibold">This pitch isn't available anymore</p>
        <button
          onClick={goToApp}
          className="icon-btn-transparent px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white rounded-lg font-semibold transition"
        >
          Open ICANEra
        </button>
      </div>
    );
  }

  const bizName = pitch.business_profiles?.business_name || 'Pitcher';
  const bizPhoto = pitch.business_profiles?.avatar_url || pitch.business_profiles?.owner_avatar_url;

  return (
    <div className="fixed inset-0 bg-black w-screen h-screen overflow-hidden">
      {/* Top bar -- branding + close. Anonymous visitors get a sign-in nudge
          here too, not just on the gated action buttons below. */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 to-transparent">
        <span className="text-white font-bold text-sm tracking-wide">ICANEra</span>
        <div className="flex items-center gap-2">
          {!authLoading && !user && (
            <button
              onClick={() => requireAuth('signup')}
              className="icon-btn-transparent text-xs font-semibold px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white transition"
            >
              Sign up
            </button>
          )}
          <button onClick={goToApp} className="icon-btn-transparent p-1 text-white" title="Open ICANEra">
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

        <div className="flex flex-col items-center gap-1">
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
        </div>
      </div>

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
