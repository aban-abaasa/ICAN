import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import icanCoinBlockchainService from '../services/icanCoinBlockchainService';

// Pitchin's real, enforced per-video cap — see PitchVideoRecorder.jsx handleUploadVideo()
// ("Validate file size - maximum 100MB"). Anything larger is rejected before upload.
const MAX_PITCH_VIDEO_MB = 100;

// Storage overage rate: not billed anywhere in the codebase today (R2 storage is
// currently unmetered to users) — this is a proposed rate, not a pulled-from-code fact.
const OVERAGE_IC_PER_MB = 0.005;

// Flat monthly price, in IcanEra Coins — NOT multiplied by employee count.
// Employee count only decides which tier a business qualifies for; the price
// itself is a flat subscription fee for that tier, starting at 10 IC/mo.
const TIERS = [
  {
    key: 'team',
    name: 'Team',
    max: 10,
    range: '0–10 employees',
    price: 10.00,
    storageMB: 2000,
    cta: 'Start 30-day free trial',
    popular: false,
    features: [
      'CMS content posting',
      '2,000 MB Pitchin video storage / business / mo',
      'Employee self-service portal',
      'Staff attendance check-in/out',
      'Public visitor check-in (QR code, no account needed)',
      'Shared team feed',
      'Standard support',
    ],
  },
  {
    key: 'business',
    name: 'Business',
    max: 30,
    range: '11–30 employees',
    price: 20.00,
    storageMB: 5000,
    cta: 'Start 30-day free trial',
    popular: false,
    features: [
      'Everything in Team, plus:',
      '5,000 MB Pitchin video storage / business / mo',
      'Job postings with applicant pipeline (screen → interview → hire)',
      'Public application status follow-up (reference code, no account)',
      'Live video interviews for candidates',
      'Task tracking with progress updates & notifications',
      'Payroll runs paid from your IcanEra wallet',
      'Employee rewards points',
      'Priority support',
    ],
  },
  {
    key: 'corporate',
    name: 'Corporate',
    max: 100,
    range: '31–100 employees',
    price: 30.00,
    storageMB: 15000,
    cta: 'Start 30-day free trial',
    popular: true,
    features: [
      'Everything in Business, plus:',
      '15,000 MB Pitchin video storage / business / mo',
      'Business Opportunities & Bidding marketplace — source outside companies & freelancers',
      'Convert a winning bid into a paid Service Provider Contract',
      'Secure report sharing with OTP-protected links',
      'Salary advance requests & payday advisory',
      'Admin-configurable roles & permissions',
      'Dedicated account manager',
    ],
  },
  {
    key: 'contract',
    name: 'Contract',
    max: Infinity,
    range: '101+ employees',
    price: null,
    storageMB: null,
    cta: 'Request a contract',
    popular: false,
    features: [
      'Everything in Corporate, plus:',
      'Unlimited Pitchin video storage',
      'Custom integrations & API',
      'SLA guarantee',
      'Onboarding & training',
    ],
  },
];

const STARTING_PRICE_IC = TIERS[0].price;

const tierFor = (employees) => TIERS.find((t) => employees <= t.max) || TIERS[TIERS.length - 1];

const formatMB = (mb) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb.toLocaleString()} MB`);

const PricingPage = ({ onBack, onGetStarted }) => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const [employees, setEmployees] = useState(5);
  const [livePrice, setLivePrice] = useState(null); // { priceUGX, source }

  useEffect(() => {
    let cancelled = false;
    icanCoinBlockchainService.getCurrentPrice().then((data) => {
      if (!cancelled) setLivePrice(data);
    });
    return () => { cancelled = true; };
  }, []);

  // Falls back to the engine's own 5,000 UGX default until the live RPC
  // resolves — see icanCoinBlockchainService.getCurrentPrice().
  const icToUGX = livePrice?.priceUGX ?? 5000;

  const activeTier = useMemo(() => tierFor(employees), [employees]);

  const cardBg = isDarkTheme ? 'bg-slate-900/80 border-slate-600/40' : 'bg-white border-slate-300/70';
  const mutedText = isDarkTheme ? 'text-slate-400' : 'text-slate-600';
  const headingText = isDarkTheme ? 'text-white' : 'text-slate-900';

  return (
    <div className={`min-h-screen ${
      isDarkTheme
        ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100'
        : 'bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100 text-slate-900'
    }`}>
      <nav className={`sticky top-0 w-full z-50 backdrop-blur-md border-b ${isDarkTheme ? 'bg-slate-950/70 border-slate-700/40' : 'bg-white/70 border-slate-300/70'}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <button
            onClick={onBack}
            className={`flex items-center gap-1.5 text-sm font-semibold transition-colors ${isDarkTheme ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div
            className="text-2xl font-black tracking-tight ml-auto"
            style={{
              color: 'var(--color-secondary)',
              textShadow: isDarkTheme ? '0 0 14px rgba(129, 140, 248, 0.35)' : '0 1px 0 rgba(255,255,255,0.5)',
            }}
          >
            IcanEra
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h1 className={`text-3xl md:text-5xl font-black leading-tight ${headingText}`}>
            Corporate plans that scale with your team
          </h1>
          <p className={`mt-4 text-base md:text-lg leading-relaxed ${mutedText}`}>
            One flat monthly price per plan &mdash; not a per-seat fee. Your team size decides
            which tier you&rsquo;re on; everyone on that tier gets full access to IcanEra&rsquo;s CMS.
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-500">
            30 days free, then billed automatically from your IcanEra Coin wallet
          </p>
          <p className={`mt-1 text-xs ${mutedText}`}>
            Requires at least {STARTING_PRICE_IC} IC already in your business wallet to start &mdash; keeps your first renewal from failing on day 30
          </p>
        </div>

        {/* Employee slider */}
        <div className={`ican-cove-card border p-6 md:p-8 mb-12 ${cardBg}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <p className={`text-sm font-bold ${headingText}`}>How many employees will post content?</p>
            <p className={`text-xs ${mutedText}`}>This decides your tier, not your price per person</p>
          </div>
          <input
            type="range"
            min={1}
            max={150}
            value={employees}
            onChange={(e) => setEmployees(parseInt(e.target.value, 10))}
            className="w-full accent-purple-500"
            aria-label="Number of employees"
          />
          <div className={`flex justify-between mt-2 text-xs ${mutedText}`}>
            <span>1</span>
            <span>100+</span>
          </div>
          <div className={`flex flex-wrap items-center gap-2 mt-5 pt-4 border-t ${isDarkTheme ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <p className={`text-sm ${headingText}`}>
              A team of <strong>{employees > 100 ? '100+' : employees}</strong> employees lands in the{' '}
              <strong className="text-purple-400">{activeTier.name}</strong> plan.
            </p>
            <p className={`ml-auto text-sm font-semibold ${mutedText}`}>
              {activeTier.price != null ? `${activeTier.price.toFixed(2)} IC/mo flat` : 'Contact sales for a custom quote'}
            </p>
          </div>
          <p className={`mt-2 text-xs ${mutedText}`}>
            Includes{' '}
            <strong className={headingText}>
              {activeTier.storageMB != null ? `${formatMB(activeTier.storageMB)} Pitchin video storage for your business` : 'unlimited Pitchin video storage for your business'}
            </strong>{' '}
            this month
          </p>
        </div>

        {/* Pricing grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {TIERS.map((tier) => {
            const isActive = tier.key === activeTier.key;
            return (
              <div
                key={tier.key}
                className={`relative flex flex-col ican-cove-panel border-2 p-6 ${cardBg} ${
                  isActive ? 'border-purple-400/70' : isDarkTheme ? 'border-slate-600/40' : 'border-slate-300/70'
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-6 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[11px] font-bold uppercase tracking-wide px-3 py-1 rounded-full shadow-lg shadow-purple-500/40">
                    Most popular
                  </div>
                )}
                {isActive && (
                  <p className="text-[11px] font-bold uppercase tracking-wide text-purple-400 mb-2">Matches your team</p>
                )}
                <h3 className={`text-lg font-black ${headingText}`}>{tier.name}</h3>
                <p className={`text-xs mb-4 ${mutedText}`}>{tier.range}</p>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className={`text-3xl font-black ${headingText}`}>
                    {tier.price != null ? tier.price.toFixed(2) : 'Custom'}
                  </span>
                  {tier.price != null && <span className={`text-xs ${mutedText}`}>IC / mo flat</span>}
                </div>
                <p className={`text-xs mb-5 min-h-[16px] ${mutedText}`}>
                  {tier.price != null ? `≈ ${Math.round(tier.price * icToUGX).toLocaleString()} UGX (live rate)` : 'Volume pricing, negotiated'}
                </p>

                <div className="flex flex-col gap-2.5 mb-6 flex-1">
                  {tier.features.map((f) => (
                    f.endsWith(':') ? (
                      <p key={f} className={`text-xs italic ${mutedText}`}>{f}</p>
                    ) : (
                      <div key={f} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-500" />
                        <span className={headingText}>{f}</span>
                      </div>
                    )
                  ))}
                </div>

                <button
                  onClick={() => onGetStarted?.(tier.key)}
                  className={
                    isActive || tier.popular
                      ? 'inline-flex items-center justify-center px-4 py-3 rounded-full font-bold text-sm bg-gradient-to-r from-yellow-500 to-yellow-400 hover:from-yellow-400 hover:to-yellow-300 text-slate-900 shadow-lg hover:shadow-xl hover:shadow-yellow-500/50 transition-all duration-300'
                      : `inline-flex items-center justify-center px-4 py-3 rounded-full font-bold text-sm transition-all duration-300 ${isDarkTheme ? 'bg-slate-800/60 text-slate-100 hover:bg-slate-700/60' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`
                  }
                >
                  {tier.cta}
                </button>
              </div>
            );
          })}
        </div>

        <p className={`text-center mt-10 text-xs leading-relaxed ${mutedText}`}>
          Flat monthly price per tier, starting at {STARTING_PRICE_IC} IC &middot; Save 15&ndash;20% with annual billing<br />
          Each Pitchin video is capped at {MAX_PITCH_VIDEO_MB} MB per upload &middot; Storage beyond your monthly pool is billed at {OVERAGE_IC_PER_MB} IC/MB ({OVERAGE_IC_PER_MB * 1000} IC per GB)<br />
          First 30 days are free. After that, your plan is billed monthly straight out of your business&rsquo;s IcanEra Coin wallet &mdash; no card needed.
          If your wallet balance is short at renewal, Pitchin stays on for a 5-day grace period so you can top up before anything is paused.
        </p>
      </div>
    </div>
  );
};

export default PricingPage;
