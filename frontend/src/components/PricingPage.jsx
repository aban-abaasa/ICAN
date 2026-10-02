import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ShieldCheck, Wallet, Clock } from 'lucide-react';
import { useTheme, isDarkFamilyTheme } from '../context/ThemeContext';
import ThemeSwitcher from './ThemeSwitcher';
import icanCoinBlockchainService from '../services/icanCoinBlockchainService';
import { useIcanPrice } from '../hooks/useIcanPrice';
import { getLocalCurrencyCode, formatCurrency } from '../services/currencyService';

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
      'CMMS content posting',
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

const FAQ = [
  { q: 'How does the free trial work?', a: 'Your first 30 days are free. To start, keep at least the first renewal amount in your business wallet. Nothing is charged during the trial.' },
  { q: 'How am I billed after the trial?', a: 'Monthly, straight from your business IcanEra Coin wallet. No card is needed. The price is flat for your tier, not per employee.' },
  { q: 'What if my wallet is short at renewal?', a: 'Pitchin stays on for a 5-day grace period so you can top up before anything is paused.' },
  { q: 'What if my team grows?', a: 'Your headcount decides the tier. When you cross a tier boundary you move to the next flat price, with no per-seat charges in between.' },
  { q: 'What counts toward storage?', a: `Pitchin videos, up to ${MAX_PITCH_VIDEO_MB} MB each. Going past your monthly pool is billed at ${OVERAGE_IC_PER_MB} IC/MB.` },
];

const tierFor = (employees) => TIERS.find((t) => employees <= t.max) || TIERS[TIERS.length - 1];

const formatMB = (mb) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb.toLocaleString()} MB`);

const PricingPage = ({ onBack, onGetStarted }) => {
  const { actualTheme } = useTheme();
  const isDarkTheme = isDarkFamilyTheme(actualTheme);
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

  // Show the equivalent in the visitor's own currency at the LIVE price; fall
  // back to UGX (the base currency) until/unless a local rate resolves.
  const localCode = getLocalCurrencyCode();
  const { price: localPrice } = useIcanPrice(localCode);
  const useLocal = Number(localPrice?.price_local) > 0;
  const perIC = useLocal ? Number(localPrice.price_local) : icToUGX;
  const perICCode = useLocal ? localCode : 'UGX';

  const activeTier = useMemo(() => tierFor(employees), [employees]);

  const cardBg = isDarkTheme ? 'bg-slate-900 border-amber-300/30 shadow-[4px_4px_0_0_rgba(0,0,0,0.35)]' : 'bg-[#fffdf6] border-[#1f1a12]/35 shadow-[4px_4px_0_0_rgba(31,26,18,0.12)]';
  const mutedText = isDarkTheme ? 'text-slate-400' : 'text-slate-600';
  const headingText = isDarkTheme ? 'text-white' : 'text-slate-900';

  return (
    <div className={`min-h-screen ${
      isDarkTheme
        ? 'bg-slate-950 text-slate-100'
        : 'bg-[#f7f3e8] text-slate-900'
    }`}>
      <nav className={`sticky top-0 w-full z-50 border-b ${isDarkTheme ? 'bg-slate-950 border-slate-800' : 'bg-white border-stone-200'}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 sm:gap-4">
          <button
            onClick={onBack}
            className={`flex items-center gap-1.5 text-sm font-semibold transition-colors ${isDarkTheme ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div
            className="ml-auto text-xl font-black tracking-tight sm:text-2xl"
            style={{
              color: 'var(--color-secondary)',
              textShadow: isDarkTheme ? '0 0 14px rgba(129, 140, 248, 0.35)' : '0 1px 0 rgba(255,255,255,0.5)',
            }}
          >
            IcanEra
          </div>
          <ThemeSwitcher />
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-9 sm:py-12 md:py-16">
        <div className="text-center max-w-3xl mx-auto mb-8 sm:mb-10">
          <p className={`mb-3 text-xs font-semibold uppercase tracking-[0.16em] ${isDarkTheme ? 'text-emerald-300' : 'text-emerald-800'}`}>IcanEra CMMS plans</p>
          <h1 className={`font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl md:text-5xl ${headingText}`}>
            Corporate plans that grow with your team
          </h1>
          <p className={`mt-4 text-base leading-7 sm:text-lg ${mutedText}`}>
            One monthly price for your team&rsquo;s size, with no per-seat fee. Compare the CMMS tools and support included in each tier.
          </p>
          <p className={`mt-5 inline-flex max-w-full items-center rounded-full border px-3.5 py-2 text-center text-xs font-semibold leading-5 sm:text-sm ${isDarkTheme ? 'border-emerald-800 bg-emerald-950/50 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
            30-day free trial, then monthly billing from your IcanEra Coin wallet
          </p>
          <p className={`mx-auto mt-2 max-w-xl text-xs leading-5 ${mutedText}`}>
            Starting a trial requires at least {STARTING_PRICE_IC} IC in your business wallet to cover the first renewal.
          </p>
        </div>

        <ul className="mx-auto mb-8 grid max-w-4xl gap-3 sm:grid-cols-3">
          {[
            { Icon: Clock, t: '30 days free', d: 'Start with no charge' },
            { Icon: Wallet, t: 'Pay from your wallet', d: 'No card, no per-seat fees' },
            { Icon: ShieldCheck, t: '5-day grace period', d: 'Nothing paused if you top up late' },
          ].map(({ Icon, t, d }) => (
            <li key={t} className={`flex items-center gap-3 rounded-sm border px-4 py-3 ${isDarkTheme ? 'border-amber-300/25 bg-slate-900' : 'border-[#1f1a12]/25 bg-[#fffdf6]'}`}>
              <Icon className={`h-5 w-5 flex-shrink-0 ${isDarkTheme ? 'text-emerald-300' : 'text-emerald-800'}`} />
              <div>
                <p className={`text-sm font-bold ${headingText}`}>{t}</p>
                <p className={`text-xs ${mutedText}`}>{d}</p>
              </div>
            </li>
          ))}
        </ul>

        {/* Employee slider */}
        <div className={`ican-cove-card mb-8 rounded-sm border-2 p-5 sm:p-6 md:p-8 ${cardBg}`}>
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
            <p className={`text-base font-semibold ${headingText}`}>How many employees are on your team?</p>
            <p className={`text-xs ${mutedText}`}>Your headcount sets the tier, not a per-person price</p>
          </div>
          <input
            type="range"
            min={1}
            max={150}
            value={employees}
            onChange={(e) => setEmployees(parseInt(e.target.value, 10))}
            className="w-full accent-emerald-700"
            aria-label="Number of employees"
          />
          <div className={`flex justify-between mt-2 text-xs ${mutedText}`}>
            <span>1</span>
            <span>100+</span>
          </div>
          <div className={`mt-5 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between ${isDarkTheme ? 'border-slate-700' : 'border-stone-200'}`}>
            <p className={`text-sm ${headingText}`}>
              A team of <strong>{employees > 100 ? '100+' : employees}</strong> employees lands in the{' '}
              <strong className={isDarkTheme ? 'text-emerald-300' : 'text-emerald-800'}>{activeTier.name}</strong> plan.
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
            const tierStyle = {
              team: isDarkTheme
                ? { card: 'border-violet-900 bg-violet-950/25', ring: 'ring-violet-500', label: 'text-violet-300', button: 'bg-violet-400 text-slate-950 hover:bg-violet-300' }
                : { card: 'border-violet-200 bg-violet-50', ring: 'ring-violet-700', label: 'text-violet-800', button: 'bg-violet-800 text-white hover:bg-violet-700' },
              business: isDarkTheme
                ? { card: 'border-sky-900 bg-sky-950/25', ring: 'ring-sky-500', label: 'text-sky-300', button: 'bg-sky-400 text-slate-950 hover:bg-sky-300' }
                : { card: 'border-sky-200 bg-sky-50', ring: 'ring-sky-700', label: 'text-sky-800', button: 'bg-sky-800 text-white hover:bg-sky-700' },
              corporate: isDarkTheme
                ? { card: 'border-amber-900 bg-amber-950/25', ring: 'ring-amber-500', label: 'text-amber-300', button: 'bg-amber-300 text-slate-950 hover:bg-amber-200' }
                : { card: 'border-amber-200 bg-amber-50', ring: 'ring-amber-700', label: 'text-amber-900', button: 'bg-amber-700 text-white hover:bg-amber-800' },
              contract: isDarkTheme
                ? { card: 'border-teal-900 bg-teal-950/25', ring: 'ring-teal-500', label: 'text-teal-300', button: 'bg-teal-400 text-slate-950 hover:bg-teal-300' }
                : { card: 'border-teal-200 bg-teal-50', ring: 'ring-teal-700', label: 'text-teal-900', button: 'bg-teal-800 text-white hover:bg-teal-700' },
            }[tier.key];
            return (
              <div
                key={tier.key}
                className={`relative flex flex-col rounded-sm border-2 p-5 shadow-[4px_4px_0_0_rgba(31,26,18,0.12)] transition-transform hover:-translate-y-0.5 sm:p-6 ${tierStyle.card} ${isActive ? `ring-2 ${tierStyle.ring}` : ''}`}
              >
                {tier.popular && (
                  <div className={`absolute -top-3 left-5 rounded-sm border-2 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${isDarkTheme ? 'border-slate-700 bg-slate-800 text-slate-200' : 'border-stone-200 bg-white text-slate-700'}`}>
                    Most popular
                  </div>
                )}
                {isActive && (
                  <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${tierStyle.label}`}>Matches your team</p>
                )}
                <h3 className={`font-serif text-xl font-bold ${headingText}`}>{tier.name}</h3>
                <p className={`mb-4 border-b-4 border-double pb-3 text-xs ${isDarkTheme ? 'border-white/15' : 'border-[#1f1a12]/20'} ${mutedText}`}>{tier.range}</p>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className={`font-serif text-4xl font-bold ${headingText}`}>
                    {tier.price != null ? tier.price.toFixed(2) : 'Custom'}
                  </span>
                  {tier.price != null && <span className={`text-xs ${mutedText}`}>IC / mo flat</span>}
                </div>
                <p className={`text-xs mb-5 min-h-[16px] ${mutedText}`}>
                  {tier.price != null ? `≈ ${formatCurrency(tier.price * perIC, perICCode)} (live rate)` : 'Volume pricing, negotiated'}
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
                      ? `inline-flex items-center justify-center rounded-sm px-4 py-3 text-sm font-bold transition-colors ${tierStyle.button}`
                      : `inline-flex items-center justify-center rounded-sm border-2 px-4 py-3 text-sm font-bold transition-colors ${isDarkTheme ? 'border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700' : 'border-stone-200 bg-stone-100 text-slate-800 hover:bg-stone-200'}`
                  }
                >
                  {tier.cta}
                </button>
              </div>
            );
          })}
        </div>

        <section className="mx-auto mt-12 max-w-3xl" aria-labelledby="pricing-faq">
          <h2 id="pricing-faq" className={`mb-4 border-b-4 border-double pb-2 font-serif text-2xl font-bold ${headingText} ${isDarkTheme ? 'border-white/15' : 'border-[#1f1a12]/25'}`}>Questions, answered</h2>
          <div className="space-y-2">
            {FAQ.map((item) => (
              <details key={item.q} className={`group rounded-sm border px-4 py-3 ${isDarkTheme ? 'border-amber-300/25 bg-slate-900' : 'border-[#1f1a12]/25 bg-[#fffdf6]'}`}>
                <summary className={`cursor-pointer list-none text-sm font-bold ${headingText}`}>{item.q}</summary>
                <p className={`mt-2 text-sm leading-6 ${mutedText}`}>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

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
