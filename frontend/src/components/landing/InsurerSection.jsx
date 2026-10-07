import React from 'react';
import { BadgeCheck, FileCheck2, ShieldCheck, Wallet } from 'lucide-react';
import { useTheme, isDarkFamilyTheme } from '../../context/ThemeContext';
import InsurerApplication from '../insurance/InsurerApplication';

/**
 * Landing page "Insurance" section: licensed insurance companies apply to sell cover on IcanEra and
 * ICAN support approves them (Dev panel > Insurance). Like the franchise form, no account is needed to
 * apply; once approved, the company needs an IcanEra account with the same email to be set up.
 */
const InsurerSection = ({ onGetStarted }) => {
  const { actualTheme } = useTheme();
  const dark = isDarkFamilyTheme(actualTheme);
  const title = dark ? 'text-white' : 'text-slate-900';
  const body = dark ? 'text-slate-400' : 'text-slate-600';
  const card = dark ? 'border-slate-700/40 bg-slate-900/60' : 'border-slate-200 bg-white';

  const steps = [
    ['Send your application', 'Give your licence number, expiry, regulator and the cover you offer. No account needed.'],
    ['Support approves you', 'We check your licence with the regulator. Check the decision any time with your reference.'],
    ['Create your IcanEra account', 'Sign up with the same email you applied with, then add your business profile.'],
    ['Register and sell', 'Register the business as an insurer and you are verified straight away. Premiums are paid in ICAN into your business wallet.'],
  ];
  const perks = [
    [BadgeCheck, 'Verified badge', 'Customers see your licence and regulator on every plan.'],
    [Wallet, 'Paid in full, in ICAN', 'You take home exactly the premium you set, tithe-free.'],
    [ShieldCheck, 'People, riders and businesses', 'Sell to individuals, BodaGoEra riders, fleets and companies.'],
  ];

  return (
    <section id="insurance" className="relative scroll-mt-24 py-10 md:py-16 lg:py-20 2xl:py-24 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-6xl 2xl:max-w-[1400px] mx-auto">
        <div className="text-center mb-8 md:mb-12">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs md:text-sm font-bold mb-4 ${dark ? 'border-teal-300/40 bg-teal-900/25 text-teal-200' : 'border-teal-500/40 bg-teal-100 text-teal-900'}`}>
            <ShieldCheck className="w-4 h-4" /> Insurance partners
          </div>
          <h2 className={`text-2xl md:text-4xl lg:text-5xl font-black leading-tight ${title}`}>Sell insurance on IcanEra</h2>
          <p className={`mt-3 max-w-2xl mx-auto text-sm md:text-base leading-relaxed ${body}`}>
            Licensed insurance companies can apply to offer cover to people, riders and businesses across IcanEra and BodaGoEra. Once ICAN support approves you, you publish plans, collect premiums and handle claims in one place.
          </p>
          <div className={`mt-4 inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs md:text-sm font-semibold ${dark ? 'border-sky-400/30 bg-sky-900/20 text-sky-200' : 'border-sky-300 bg-sky-50 text-sky-900'}`}>
            <FileCheck2 className="w-4 h-4 shrink-0" />
            For licensed insurers only. We verify your licence before you go live.
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {perks.map(([Icon, h, t]) => (
            <div key={h} className={`rounded-2xl border p-5 ${card}`}>
              <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${dark ? 'bg-teal-300/15 text-teal-300' : 'bg-teal-100 text-teal-800'}`}><Icon className="h-5 w-5" /></div>
              <h3 className={`text-base font-bold ${title}`}>{h}</h3>
              <p className={`mt-2 text-sm leading-relaxed ${body}`}>{t}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-5">
          <div className={`lg:col-span-2 rounded-2xl border p-5 ${card}`}>
            <h3 className={`text-sm font-black uppercase tracking-wider ${title}`}>How it works</h3>
            <ol className="mt-3 space-y-3">
              {steps.map(([h, t], i) => (
                <li key={h} className="flex items-start gap-3">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${dark ? 'bg-teal-300 text-slate-950' : 'bg-teal-800 text-white'}`}>{i + 1}</span>
                  <div><p className={`text-sm font-bold ${title}`}>{h}</p><p className={`text-xs ${body}`}>{t}</p></div>
                </li>
              ))}
            </ol>
          </div>

          <div id="insurance-apply" className={`lg:col-span-3 scroll-mt-24 rounded-2xl border p-5 md:p-7 ${card}`}>
            <InsurerApplication dark={dark} onGetStarted={onGetStarted} />
          </div>
        </div>
      </div>
    </section>
  );
};

export default InsurerSection;
