import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Rocket, Sparkles } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { getAllPitches } from '../../services/pitchingService';
import { getOrCreateGuestLikeKey } from '../../services/landingMessagesService';
import { recordMockTrade, fetchRecentMockTrades, subscribeToMockTrades } from '../../services/landingMockTradeService';
import { fmtRelativeTime } from './relativeTime';

const fmtMoney = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const PitchinPreview = ({ onGetStarted, authId = null }) => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const [pitches, setPitches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [amounts, setAmounts] = useState({});
  const [results, setResults] = useState({});
  const [activity, setActivity] = useState([]);
  const [videoErrors, setVideoErrors] = useState({});
  const guestKey = useMemo(() => getOrCreateGuestLikeKey(), []);

  useEffect(() => {
    getAllPitches(6, 0)
      .then((rows) => setPitches(rows || []))
      .catch((err) => console.error('[PitchinPreview] failed to load pitches:', err))
      .finally(() => setLoading(false));
  }, []);

  const loadActivity = useCallback(() => {
    fetchRecentMockTrades(6)
      .then((rows) => setActivity(rows.filter((r) => r.kind === 'pitch_invest')))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadActivity();
    return subscribeToMockTrades((row) => {
      if (row.kind === 'pitch_invest') setActivity((prev) => [row, ...prev].slice(0, 6));
    });
  }, [loadActivity]);

  const handleSimulate = async (pitch) => {
    const amount = Number(amounts[pitch.id]);
    if (!amount || amount <= 0) return;

    const equityPercent = pitch.target_funding
      ? Math.min((amount / pitch.target_funding) * (pitch.equity_offering || 0), pitch.equity_offering || 0)
      : 0;
    const remaining = Math.max((pitch.target_funding || 0) - (pitch.raised_amount || 0), 0);
    const nearlyFunded = remaining > 0 && amount > remaining;

    const computedResult = { equityPercent, remaining, nearlyFunded };
    setResults((prev) => ({ ...prev, [pitch.id]: computedResult }));

    recordMockTrade({
      kind: 'pitch_invest',
      targetType: 'pitch',
      targetId: String(pitch.id),
      guestKey,
      authId,
      inputAmount: amount,
      computedResult,
    });
  };

  return (
    <section id="pitchin-preview" className="relative py-10 md:py-16 lg:py-20 2xl:py-24 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto">
        <div className="text-center mb-8 md:mb-12">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs md:text-sm font-bold mb-4 ${isDarkTheme ? 'border-fuchsia-300/40 bg-fuchsia-900/25 text-fuchsia-200' : 'border-fuchsia-400/50 bg-fuchsia-100 text-fuchsia-800'}`}>
            <Rocket className="w-4 h-4" />
            PitchIn
          </div>
          <h2 className={`text-2xl md:text-4xl font-black ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Invest In Businesses You Believe In</h2>
          <p className={`mt-2 text-sm md:text-base ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>Browse real pitches and try a mock investment — no account, no risk. Sign in to make it real.</p>
        </div>

        {loading ? (
          <div className="grid gap-5 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-64 rounded-2xl border animate-pulse ${isDarkTheme ? 'border-slate-700/40 bg-slate-800/40' : 'border-slate-200 bg-slate-100'}`} />
            ))}
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-3">
            {pitches.map((pitch) => {
              const result = results[pitch.id];
              const progressPct = pitch.target_funding
                ? Math.min(((pitch.raised_amount || 0) / pitch.target_funding) * 100, 100)
                : 0;
              return (
                <div key={pitch.id} className={`flex flex-col rounded-2xl border overflow-hidden ${isDarkTheme ? 'border-slate-700/40 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
                  <div className={`relative aspect-video ${isDarkTheme ? 'bg-slate-800' : 'bg-slate-100'}`}>
                    {pitch.video_url && !videoErrors[pitch.id] ? (
                      <video
                        src={pitch.video_url}
                        poster={pitch.thumbnail_url || undefined}
                        className="w-full h-full object-cover"
                        controls
                        muted
                        playsInline
                        preload="none"
                        crossOrigin="anonymous"
                        onError={() => setVideoErrors((prev) => ({ ...prev, [pitch.id]: true }))}
                      />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${isDarkTheme ? 'from-fuchsia-900/40 to-purple-900/40' : 'from-fuchsia-100 to-purple-100'}`}>
                        <Rocket className={`w-8 h-8 ${isDarkTheme ? 'text-fuchsia-300/60' : 'text-fuchsia-500/60'}`} />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col flex-1 p-5">
                  <h3 className={`text-base font-bold line-clamp-2 ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{pitch.title}</h3>
                  <p className={`mt-1 text-xs ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>{pitch.business_profiles?.business_name || pitch.category}</p>
                  <p className={`mt-2 text-sm line-clamp-3 flex-1 ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>{pitch.description}</p>

                  <div className="mt-3">
                    <div className={`h-1.5 w-full rounded-full overflow-hidden ${isDarkTheme ? 'bg-slate-800' : 'bg-slate-200'}`}>
                      <div className="h-full bg-gradient-to-r from-fuchsia-500 to-purple-500" style={{ width: `${progressPct}%` }} />
                    </div>
                    <p className={`mt-1 text-[11px] ${isDarkTheme ? 'text-slate-500' : 'text-slate-500'}`}>
                      {fmtMoney(pitch.raised_amount)} raised of {fmtMoney(pitch.target_funding)} · {pitch.equity_offering || 0}% offered
                    </p>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      placeholder="Amount ($)"
                      value={amounts[pitch.id] || ''}
                      onChange={(e) => setAmounts((prev) => ({ ...prev, [pitch.id]: e.target.value }))}
                      className={`w-full rounded-lg border px-3 py-2 text-sm ${isDarkTheme ? 'border-slate-700 bg-slate-800 text-white placeholder:text-slate-500' : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400'}`}
                    />
                    <button
                      onClick={() => handleSimulate(pitch)}
                      className="shrink-0 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 px-3 py-2 text-xs font-bold text-white transition-colors"
                    >
                      Simulate
                    </button>
                  </div>

                  {result && (
                    <div className={`mt-3 rounded-lg border p-2.5 text-xs ${isDarkTheme ? 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200' : 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800'}`}>
                      <Sparkles className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
                      ≈ {result.equityPercent.toFixed(2)}% equity if this round closes at current terms
                      {result.nearlyFunded && ' — this pitch may already be close to fully funded (illustrative only)'}
                    </div>
                  )}

                  <button
                    onClick={() => onGetStarted?.('signin')}
                    className={`mt-3 text-xs font-bold underline decoration-dotted ${isDarkTheme ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}
                  >
                    Sign in to make this real →
                  </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activity.length > 0 && (
          <div className={`mt-8 rounded-2xl border p-4 ${isDarkTheme ? 'border-slate-700/40 bg-slate-900/40' : 'border-slate-200 bg-slate-50'}`}>
            <p className={`text-xs font-bold uppercase tracking-wide mb-2 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Recent simulated activity</p>
            <div className="flex flex-wrap gap-2">
              {activity.map((row) => (
                <span key={row.id} className={`text-[11px] px-2.5 py-1 rounded-full ${isDarkTheme ? 'bg-slate-800 text-slate-300' : 'bg-white text-slate-600 border border-slate-200'}`}>
                  Someone simulated a ${Number(row.input_amount).toLocaleString()} investment · {fmtRelativeTime(row.created_at)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default PitchinPreview;
