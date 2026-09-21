import React, { useEffect, useState } from 'react';
import { UserPlus, Copy, Link2, Share2, CheckCircle2, Clock, ChevronDown } from 'lucide-react';
import { loadReferralStats, buildReferralLink } from '../services/referralService';
import { formatICAN } from '../services/icanWalletService';

const FRIEND_STATE = {
  joined: { label: 'Joined — waiting for first deposit', cls: 'bg-gray-500/20 text-gray-300' },
  pending: { label: 'Reward pending', cls: 'bg-amber-500/20 text-amber-300' },
  paid: { label: 'Reward paid', cls: 'bg-emerald-500/20 text-emerald-300' },
  rejected: { label: 'Not eligible', cls: 'bg-red-500/20 text-red-300' },
};

/**
 * "Refer Friends" card for the ICAN wallet overview. Earns the referrer a % of
 * their friend's first deposit, paid in ICAN (see services/referralService.js).
 * The title + "Earn X% … live coin price" line are always visible; clicking the
 * header opens the code, share buttons, stats and friends list.
 * cardStyle / innerStyle / buttonStyle come from ICANWallet's walletUi so the
 * card follows the wallet's theme.
 */
export default function ReferralCard({ cardStyle, innerStyle, buttonStyle }) {
  const [open, setOpen] = useState(false); // collapsed until clicked
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      setStats(await loadReferralStats());
    } catch (e) {
      console.error('[ReferralCard] load failed:', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 2000);
  };

  const copy = async (text, done) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(done);
    } catch {
      flash('Could not copy');
    }
  };

  const share = async (code) => {
    const text = `Join me on IcanEra! Sign up with my link: ${buildReferralLink(code)} (my referral code: ${code})`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Join IcanEra', text }); return; } catch { /* dismissed — fall through to WhatsApp */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  // The line under the title — always visible, collapsed or not.
  let description = null;
  if (loading) description = 'Loading your referral info…';
  else if (failed) description = "Couldn't load your referral info.";
  else if (stats && !stats.enabled) description = 'Referral rewards are paused right now. Your code and link stay valid.';
  else if (stats) {
    description = (
      <>
        Earn <b className="text-white">{stats.reward_percent}%</b> of your friend's first deposit, paid straight into your wallet
        {stats.max_reward_ican != null && <> (up to {formatICAN(stats.max_reward_ican)} ICAN per friend)</>}.
        {stats.min_deposit_ican > 0 && <> Their deposit must be at least {formatICAN(stats.min_deposit_ican)} ICAN.</>}
        {stats.live_price_ugx > 0 && <> Rewards are valued at the live coin price (1 ICAN ≈ UGX {Math.round(stats.live_price_ugx).toLocaleString()} today).</>}
      </>
    );
  }

  return (
    <div className="solid-card p-6" style={cardStyle}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-start justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="text-lg font-semibold flex items-center gap-2 text-white">
            <UserPlus className="w-5 h-5 text-emerald-400" /> Refer Friends
          </span>
          <span className="block text-sm text-gray-300 mt-1 font-normal">{description}</span>
        </span>
        <ChevronDown className={`w-5 h-5 mt-1 shrink-0 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {failed && (
        <button onClick={load} className="mt-2 text-sm text-cyan-400 font-medium hover:underline">Try again</button>
      )}

      {open && !loading && !failed && stats && (
        <div className="mt-4">
          {stats.code && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 rounded-lg px-3 py-2 text-center font-mono font-bold tracking-widest text-white" style={innerStyle}>
                  {stats.code}
                </div>
                <button onClick={() => copy(stats.code, 'Code copied!')} aria-label="Copy referral code"
                  className="p-2.5 rounded-lg transition-all hover:translate-y-[-1px]" style={buttonStyle}>
                  <Copy className="w-4 h-4 text-white" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button onClick={() => copy(buildReferralLink(stats.code), 'Link copied!')}
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white transition-all hover:translate-y-[-1px]" style={buttonStyle}>
                  <Link2 className="w-4 h-4" /> Copy link
                </button>
                <button onClick={() => share(stats.code)}
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 transition-all">
                  <Share2 className="w-4 h-4" /> Share
                </button>
              </div>
              <p className="h-4 text-xs text-center text-emerald-400 mb-2">{notice}</p>
            </>
          )}

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat value={String(stats.friends_joined)} label="Joined" style={innerStyle} />
            <Stat value={String(stats.friends_deposited)} label="Deposited" style={innerStyle} />
            <Stat
              value={`${formatICAN(stats.earned_ican)} ICAN`}
              label={`≈ UGX ${Math.round(stats.earned_ugx).toLocaleString()}`}
              highlight style={innerStyle}
            />
          </div>
          {stats.pending_ican > 0 && (
            <p className="text-xs text-amber-300 flex items-center justify-center gap-1 mt-2">
              <Clock className="w-3 h-3" /> {formatICAN(stats.pending_ican)} ICAN (≈ UGX {Math.round(stats.pending_ugx).toLocaleString()}) pending approval
            </p>
          )}

          {stats.friends.length > 0 && (
            <ul className="mt-4 divide-y divide-white/10">
              {stats.friends.map((f, i) => {
                const st = FRIEND_STATE[f.state] || FRIEND_STATE.joined;
                return (
                  <li key={`${f.created_at}-${i}`} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{f.first_name}</p>
                      <p className="text-[11px] text-gray-400">{new Date(f.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${st.cls}`}>
                        {f.state === 'paid' && <CheckCircle2 className="w-3 h-3" />}{st.label}
                      </span>
                      {f.reward_ican != null && f.state !== 'rejected' && (
                        <p className="text-xs font-semibold text-emerald-400 mt-0.5">
                          +{formatICAN(f.reward_ican)} ICAN{f.reward_ugx != null && <span className="font-normal text-gray-400"> · UGX {Math.round(f.reward_ugx).toLocaleString()}</span>}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, highlight, style }) {
  return (
    <div className="rounded-lg py-2 px-1" style={style}>
      <p className={`text-lg font-bold ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
      <p className="text-[11px] text-gray-400">{label}</p>
    </div>
  );
}
