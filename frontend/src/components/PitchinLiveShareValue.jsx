/**
 * PitchinLiveShareValue
 *
 * Self-contained component rendered inside PitchIn ONLY for business owners.
 * Shows:
 *  1. Live share price (computed from all linked data sources)
 *  2. Price vs original declared price (% change)
 *  3. Breakdown: which app contributed what
 *  4. Blockchain anchor status (green chain icon when on-chain)
 *  5. "Link Data Sources" management panel
 *  6. 30-day share price sparkline from snapshots
 *
 * Not rendered anywhere outside PitchIn — regular users never see this.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp, TrendingDown, Link2, Link2Off, RefreshCw,
  Shield, ShieldCheck, ChevronDown, ChevronUp, Loader,
  Building2, Tractor, Bike, ShoppingCart, Coins,
  FileText, CheckCircle2, Wallet, PieChart, Pencil, Users
} from 'lucide-react';
import BusinessTeamMembersModal from './BusinessTeamMembersModal';
import {
  calculateLiveShareValue,
  saveDataLink,
  removeDataLink,
  getBusinessDataLinks,
  getSharePriceHistory,
  setBusinessTotalShares,
  getBusinessTransactionsByContributor
} from '../services/pitchinValuationService';
import { CountryService } from '../services/countryService';
import icanCoinService from '../services/icanCoinService';
import { supabase } from '../lib/supabase/client';
import { useMarketSnapshot, useIcanPriceByCountry } from '../hooks/useIcanPrice';

const PCT = (n) => `${Number(n || 0) >= 0 ? '+' : ''}${Number(n || 0).toFixed(2)}%`;

const REPORTING_BUCKET_LABELS = {
  sold_income: 'Sales income',
  capital_asset: 'Capital asset',
  bought_stock: 'Stock bought',
  operating_expense: 'Operating expense',
  salary_expense: 'Salary expense',
  tax_expense: 'Tax expense',
  loan_inflow: 'Loan inflow',
  dividend_payout: 'Dividend payout',
  owner_equity: 'Owner equity'
};

// Convert UGX share price → icaneracoin units using live market price
// 1 icaneracoin = marketPrice UGX (floor 5,000)
const ICAN_PER_SHARE = (ugx, marketPrice) => {
  const price  = Math.max(Number(marketPrice) || 5000, 5000);
  const amount = (Number(ugx) || 0) / price;
  const dec = amount >= 100 ? 2 : amount >= 1 ? 4 : amount >= 0.001 ? 6 : 8;
  return `${amount.toFixed(dec)} icaneracoin`;
};

// Convert UGX → local currency using CountryService built-in rates (no external API)
// CountryService.icanToLocal(1, country, ugx) = 1 × ugx × exchangeRate = ugx in local
// Currencies that have no decimal places (like UGX, JPY)
const NO_DECIMAL_CURRENCIES = new Set(['UGX','TZS','RWF','BIF','SSP','DJF','XAF','XOF','JPY','KRW','IDR','VND']);

const fmtLocal = (ugx, countryCode) => {
  const local = CountryService.icanToLocal(1, countryCode || 'UG', Number(ugx) || 0);
  const code  = CountryService.getCurrencyCode(countryCode || 'UG');
  const dec   = NO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: code,
      minimumFractionDigits: dec, maximumFractionDigits: dec,
    }).format(local);
  } catch {
    return `${code} ${local.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
  }
};

// Format a value that is already in the target currency (e.g. RPC-returned price_local)
// — no re-conversion, unlike fmtLocal which starts from a UGX amount.
const fmtExact = (amount, currencyCode) => {
  const code = currencyCode || 'USD';
  const dec  = NO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: code,
      minimumFractionDigits: dec, maximumFractionDigits: dec,
    }).format(Number(amount) || 0);
  } catch {
    return `${code} ${(Number(amount) || 0).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
  }
};

const SOURCE_APPS = [
  {
    key: 'cmms',
    label: 'CMMS Company',
    description: 'Physical inventory & asset value',
    icon: Building2,
    color: 'blue',
    placeholder: 'CMMS Company ID (UUID)',
    breakdownKey: 'cmms_inventory_value'
  },
  {
    key: 'farm-agent',
    label: 'AgriBone Farm',
    description: 'Produce, land & service sales',
    icon: Tractor,
    color: 'green',
    placeholder: 'Farm ID or owner user ID',
    breakdownKey: 'farm_revenue',
    walletSourceApp: 'farm-agent'
  },
  {
    key: 'mybodaguy',
    label: 'MyBodaGuy Stage',
    description: 'Boda fleet delivery revenue',
    icon: Bike,
    color: 'orange',
    placeholder: 'Stage ID or chairperson user ID',
    breakdownKey: 'boda_revenue',
    walletSourceApp: 'mybodaguy'
  },
  {
    key: 'digital-city-era',
    label: 'SupermarketEra Store',
    description: 'POS & retail transaction volume',
    icon: ShoppingCart,
    color: 'purple',
    placeholder: 'Store owner user ID',
    breakdownKey: 'supermarket_revenue'
  }
];

// Real record count for a source card, pulled from valuation.sourceStats — the
// same live query results shown in the Wallet/Manual/CMMS ledgers above.
const getSourceRecordCount = (app, sourceStats) => {
  if (!sourceStats) return null;
  if (app.key === 'cmms') return sourceStats.cmms.itemCount;
  if (app.key === 'digital-city-era') return sourceStats.supermarket.orderCount;
  if (app.walletSourceApp) return sourceStats.wallet.bySourceApp?.[app.walletSourceApp]?.count || 0;
  return null;
};

const colorMap = {
  blue:   { bg: 'bg-blue-900/30',   border: 'border-blue-700/50',   text: 'text-blue-300',   badge: 'bg-blue-800/60', dot: 'bg-blue-400' },
  green:  { bg: 'bg-green-900/30',  border: 'border-green-700/50',  text: 'text-green-300',  badge: 'bg-green-800/60', dot: 'bg-green-400' },
  orange: { bg: 'bg-orange-900/30', border: 'border-orange-700/50', text: 'text-orange-300', badge: 'bg-orange-800/60', dot: 'bg-orange-400' },
  purple: { bg: 'bg-purple-900/30', border: 'border-purple-700/50', text: 'text-purple-300', badge: 'bg-purple-800/60', dot: 'bg-purple-400' }
};

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ history }) {
  if (!history || history.length < 2) return null;
  const prices = history.map(h => parseFloat(h.share_price_ugx));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const W = 320, H = 48, PAD = 4;

  const points = prices.map((p, i) => {
    const x = PAD + (i / (prices.length - 1)) * (W - 2 * PAD);
    const y = PAD + ((max - p) / range) * (H - 2 * PAD);
    return `${x},${y}`;
  }).join(' ');

  const trend = prices[prices.length - 1] >= prices[0];
  const color = trend ? '#22c55e' : '#ef4444';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-10 sm:h-12 overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PitchinLiveShareValue({ businessProfile, ownerUserId }) {
  const [valuation, setValuation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [links, setLinks] = useState({});
  const [linksError, setLinksError] = useState('');
  const [linkInputs, setLinkInputs] = useState({});
  const [linkSaving, setLinkSaving] = useState('');
  const [history, setHistory] = useState([]);
  const [discovered, setDiscovered] = useState({});   // { appKey: [{id, label}] }
  const [discovering, setDiscovering] = useState(false);
  const [showManualTx, setShowManualTx] = useState(false);
  const [showWalletTx, setShowWalletTx] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [contributors, setContributors] = useState([]);
  const [contributorsError, setContributorsError] = useState(null);
  const [loadingContributors, setLoadingContributors] = useState(false);
  const [expandedContributorId, setExpandedContributorId] = useState(null);
  const [userCountry, setUserCountry] = useState('UG');
  const [showShareEditor, setShowShareEditor] = useState(false);
  const [shareInput, setShareInput] = useState('');
  const [savingShares, setSavingShares] = useState(false);
  const [shareError, setShareError] = useState('');

  // Country is whatever the user picked at sign-up (user_accounts.country_code),
  // never guessed from browser locale — that's what forces local-currency display
  // to actually match their real country instead of a VPN/browser-language guess.
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user?.id) return;
      return icanCoinService.getUserCountry(user.id).then(setUserCountry);
    }).catch(() => {});
  }, []);

  // Synchronous: CountryService has built-in exchange rates — no API fetch needed
  const FMT = useCallback((ugx) => fmtLocal(ugx, userCountry), [userCountry]);

  // ── Live icaneracoin market health (global price engine, inflation-shield stats) ──
  const { snapshot: marketSnapshot } = useMarketSnapshot();
  const { price: countryPrice } = useIcanPriceByCountry(userCountry);
  const prevGlobalPriceRef = useRef(null);
  const [liveTick, setLiveTick] = useState('');

  useEffect(() => {
    const curr = parseFloat(marketSnapshot?.price_ugx);
    if (!Number.isFinite(curr)) return;
    const prev = prevGlobalPriceRef.current;
    if (prev != null && curr !== prev) {
      setLiveTick(curr > prev ? 'ticked up just now' : 'ticked down just now');
    }
    prevGlobalPriceRef.current = curr;
  }, [marketSnapshot?.price_ugx]);

  const businessProfileId = businessProfile?.id;

  // ── Discover which entities the owner has in each linked app ─────────────
  const discoverEntities = useCallback(async () => {
    setDiscovering(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const result = {};

      // ── CMMS: two-step query matching CMSSModule.jsx exactly ─────────────────
      // Step 1: memberships via cmms_users_with_roles (no company_name column in view)
      const { data: cmmsMemberships } = await supabase
        .from('cmms_users_with_roles')
        .select('cmms_company_id, effective_role, is_creator')
        .ilike('email', user.email)
        .eq('is_active', true)
        .limit(20);

      if (cmmsMemberships?.length > 0) {
        // Step 2: resolve company names from cmms_company_profiles
        const companyIds = [...new Set(cmmsMemberships.map(m => m.cmms_company_id).filter(Boolean))];
        const { data: companyProfiles } = await supabase
          .from('cmms_company_profiles')
          .select('id, company_name')
          .in('id', companyIds);

        const nameMap = new Map((companyProfiles || []).map(p => [p.id, p.company_name]));

        result['cmms'] = cmmsMemberships
          .filter(r => {
            if (!r.cmms_company_id) return false;
            const role = (r.effective_role || '').toLowerCase();
            return r.is_creator === true || role.includes('admin');
          })
          .map(r => ({
            id:      r.cmms_company_id,
            label:   nameMap.get(r.cmms_company_id) || r.cmms_company_id,
            isAdmin: true,
            role:    r.effective_role || 'admin'
          }));
      }

      // ── FarmAgent: entity IS the business owner (valuation queries ican_coin_transactions
      //   by recipient_user_id = businessOwnerUserId, not a farm_id).
      //   Link by email — no farms table query needed.
      result['farm-agent'] = [{
        id:    user.id,
        label: user.email
      }];

      // ── MyBodaGuy: wallet earnings already auto-included; linking a company
      //   by the owner's email for display / explicit inclusion.
      const { data: bodaCompanies } = await supabase
        .from('companies')
        .select('id, name')
        .eq('created_by', user.id)
        .limit(10);

      result['mybodaguy'] = bodaCompanies?.length
        ? bodaCompanies.map(r => ({ id: r.id, label: r.name || user.email }))
        : [{ id: user.id, label: user.email }];

      // ── SupermarketEra: only admin users in the digital-city-era `users` table
      //   can link their store. Match by email (users.id is VARCHAR there).
      const { data: dceUser } = await supabase
        .from('users')
        .select('id, email, role')
        .ilike('email', user.email)
        .maybeSingle();

      if (dceUser && (dceUser.role || '').toLowerCase() === 'admin') {
        result['digital-city-era'] = [{
          id:       dceUser.id || user.id,
          label:    dceUser.email || user.email,
          autoLink: true
        }];
      }
      // If not admin, result['digital-city-era'] stays undefined → shows "must be admin" fallback

      setDiscovered(result);
    } catch {}
    finally { setDiscovering(false); }
  }, []);

  useEffect(() => {
    if (showLinkPanel) discoverEntities();
  }, [showLinkPanel, discoverEntities]);

  // Load the per-contributor breakdown the first time Manual Transactions is
  // opened — lets the owner see who (owner, co-owner, or team member) recorded
  // what, not just the combined totals.
  useEffect(() => {
    if (!showManualTx || !businessProfileId) return;
    let cancelled = false;
    (async () => {
      setLoadingContributors(true);
      try {
        const { contributors: rows, error } = await getBusinessTransactionsByContributor(businessProfileId);
        if (cancelled) return;
        setContributors(rows);
        setContributorsError(error);
      } finally {
        if (!cancelled) setLoadingContributors(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showManualTx, businessProfileId]);

  const loadValuation = useCallback(async () => {
    if (!businessProfileId || !ownerUserId) return;
    setLoading(true);
    setError('');
    try {
      const result = await calculateLiveShareValue(businessProfileId, ownerUserId, {
        saveSnapshot: true
      });
      setValuation(result);
    } catch (err) {
      setError(err.message || 'Valuation failed');
    } finally {
      setLoading(false);
    }
  }, [businessProfileId, ownerUserId]);

  const loadLinks = useCallback(async () => {
    if (!businessProfileId) return;
    try {
      const rows = await getBusinessDataLinks(businessProfileId);
      const map = {};
      rows.forEach(r => { map[r.source_app] = r; });
      setLinks(map);
      setLinksError('');
    } catch (err) {
      console.error('[PitchinLiveShareValue] Failed to load data links from Supabase:', err);
      setLinksError(err.message || 'Failed to load linked sources');
    }
  }, [businessProfileId]);

  const loadHistory = useCallback(async () => {
    if (!businessProfileId) return;
    try {
      const h = await getSharePriceHistory(businessProfileId, 30);
      setHistory(h);
    } catch {}
  }, [businessProfileId]);

  useEffect(() => {
    loadLinks();
    loadHistory();
    loadValuation();
  }, [loadLinks, loadHistory, loadValuation]);

  // Live-refresh: recompute the valuation whenever a transaction tagged to
  // this business changes, so "icaneracoin per share" moves the moment a
  // Manual Transaction is recorded elsewhere in the app — without this, the
  // card only updates on mount or a manual refresh click, even though the
  // Manual Transactions breakdown and this share price come from the exact
  // same underlying query and are never actually out of sync server-side.
  useEffect(() => {
    if (!businessProfileId) return;
    const channel = supabase
      .channel(`pitchin-valuation:${businessProfileId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ican_transactions',
          filter: `business_profile_id=eq.${businessProfileId}`
        },
        () => {
          loadValuation();
          loadHistory();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [businessProfileId, loadValuation, loadHistory]);

  const handleSaveLink = async (sourceApp, resolvedEntityId, resolvedEntityName) => {
    const entityId = resolvedEntityId || (linkInputs[sourceApp] || '').trim();
    if (!entityId) return;
    setLinkSaving(sourceApp);
    try {
      const appDef = SOURCE_APPS.find(a => a.key === sourceApp);
      const entityName = resolvedEntityName || appDef?.label;
      await saveDataLink(businessProfileId, sourceApp, entityId, entityName);
      await loadLinks();
      await loadValuation();
    } catch (err) {
      alert('Failed to save link: ' + err.message);
    } finally {
      setLinkSaving('');
    }
  };

  const handleRemoveLink = async (sourceApp) => {
    try {
      await removeDataLink(businessProfileId, sourceApp);
      await loadLinks();
      await loadValuation();
    } catch (err) {
      alert('Failed to remove link: ' + err.message);
    }
  };

  const handleSaveShares = async () => {
    const shares = parseInt(shareInput, 10);
    if (!Number.isFinite(shares) || shares <= 0) {
      setShareError('Enter a whole number greater than 0');
      return;
    }
    setSavingShares(true);
    setShareError('');
    try {
      await setBusinessTotalShares(businessProfileId, shares, ownerUserId);
      await loadValuation();
      setShowShareEditor(false);
      setShareInput('');
    } catch (err) {
      setShareError(err.message || 'Failed to save');
    } finally {
      setSavingShares(false);
    }
  };

  if (!businessProfileId) return null;

  const priceUp = valuation ? valuation.priceChangePercent >= 0 : true;
  const TrendIcon = priceUp ? TrendingUp : TrendingDown;
  const trendColor = priceUp ? 'text-green-400' : 'text-red-400';

  const linkedCount = SOURCE_APPS.filter(app => links[app.key]).length;
  const linkedContributionTotal = SOURCE_APPS.reduce((sum, app) => {
    if (!links[app.key] || !app.breakdownKey || !valuation?.breakdown) return sum;
    return sum + (Number(valuation.breakdown[app.breakdownKey]) || 0);
  }, 0);

  return (
    <>
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/80 backdrop-blur-sm overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-700/40">
        <div className="flex items-center gap-2 flex-wrap">
          <Coins size={16} className="text-amber-400 shrink-0" />
          <span className="text-sm sm:text-base font-bold text-white">Live Share Value</span>
          {valuation?.blockchainVerified && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-700/40 rounded-full px-2 py-0.5">
              <ShieldCheck size={10} />
              On-chain
            </span>
          )}
          {valuation && !valuation.blockchainVerified && (
            <span className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800/40 border border-slate-700/40 rounded-full px-2 py-0.5">
              <Shield size={10} />
              Hashed
            </span>
          )}
        </div>
        <button
          onClick={loadValuation}
          disabled={loading}
          aria-label="Refresh valuation"
          className="p-2.5 -m-1 rounded-lg hover:bg-slate-700/50 active:bg-slate-700/70 text-slate-400 hover:text-white transition-colors shrink-0"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── icaneracoin Live Market Health — stability + real-time trend ── */}
      <div className="px-4 pt-3 sm:px-6 sm:pt-4">
        <div className="rounded-xl border border-amber-700/30 bg-gradient-to-r from-amber-950/30 to-slate-900/40 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-xs sm:text-sm font-bold text-amber-300">icaneracoin — Live Market</span>
            </div>
            {countryPrice && (
              <div className={`flex items-center gap-1 text-xs sm:text-sm font-bold ${countryPrice.appreciation_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {countryPrice.appreciation_pct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {PCT(countryPrice.appreciation_pct)}
                {liveTick && <span className="text-[10px] text-slate-500 font-normal ml-1">· {liveTick}</span>}
              </div>
            )}
          </div>

          {countryPrice ? (
            <>
              <p className="text-lg sm:text-xl xl:text-2xl font-extrabold text-white mt-2 tabular-nums">
                {fmtExact(countryPrice.price_local, countryPrice.currency_code)}
                <span className="text-xs sm:text-sm text-slate-500 font-medium ml-2">per icaneracoin</span>
              </p>
              <p className="text-[11px] sm:text-xs xl:text-sm text-slate-400 mt-1.5 leading-relaxed">
                Anchored to a self-adjusting 5,000 UGX floor that rises with currency depreciation and never falls.{' '}
                {countryPrice.is_protected
                  ? `Up ${PCT(countryPrice.appreciation_pct)} since launch — beating ${countryPrice.country_name || 'local'} inflation (${Number(countryPrice.local_inflation || 0).toFixed(1)}%) by ${PCT(countryPrice.net_protection)}.`
                  : `Local inflation (${Number(countryPrice.local_inflation || 0).toFixed(1)}%) is currently outpacing the ${PCT(countryPrice.appreciation_pct)} rise — the floor is still catching up.`}
                {countryPrice.inflation_as_of_year && (
                  <span className="text-slate-600">
                    {' '}(World Bank{countryPrice.inflation_source === 'world_bank_fp_cpi_totl_zg' ? '' : ' est.'}, {countryPrice.inflation_as_of_year})
                  </span>
                )}
              </p>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-2">
              <Loader size={11} className="animate-spin" />
              Loading live market data…
            </div>
          )}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-5 lg:divide-x lg:divide-slate-700/40 lg:items-start">

      {/* ── Share price display ── */}
      <div className="px-4 pt-4 pb-2 sm:px-6 sm:pt-5 sm:pb-3 lg:col-span-3 xl:px-8 xl:pt-8">
        {loading && !valuation ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
            <Loader size={14} className="animate-spin" />
            Computing live valuation…
          </div>
        ) : error ? (
          <p className="text-red-400 text-xs sm:text-sm py-2">{error}</p>
        ) : valuation ? (
          <>
            {valuation.needsShareSetup ? (
              <div className="rounded-xl border border-amber-700/40 bg-amber-900/15 p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <PieChart size={14} className="text-amber-400 shrink-0" />
                  <span className="text-sm sm:text-base font-bold text-amber-300">Set up shares to see live price per share</span>
                </div>
                <p className="text-xs sm:text-sm text-slate-400 mb-3">
                  Business value is <span className="text-white font-semibold">{FMT(valuation.businessValueUgx)}</span>.
                  Tell PitchIn how many total shares this business has, and it'll divide that value automatically —
                  and keep recalculating live as revenue, assets and expenses change.
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={shareInput}
                    onChange={e => setShareInput(e.target.value)}
                    placeholder="e.g. 1000000"
                    className="flex-1 min-w-0 text-[16px] sm:text-sm bg-slate-900/60 border border-amber-700/40 rounded-lg px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={handleSaveShares}
                    disabled={savingShares || !shareInput}
                    className={`text-xs sm:text-sm px-4 py-2 rounded-lg font-semibold transition-all shrink-0 ${savingShares ? 'bg-amber-800 text-amber-300' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
                  >
                    {savingShares ? '…' : 'Set Shares'}
                  </button>
                </div>
                {shareError && <p className="text-xs text-red-400 mt-1.5">{shareError}</p>}
              </div>
            ) : (
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-extrabold text-white tabular-nums break-words">
                    {FMT(valuation.sharePriceUgx)}
                  </p>
                  <p className="text-xs sm:text-sm xl:text-base text-amber-400 mt-0.5 tabular-nums">
                    {ICAN_PER_SHARE(valuation.sharePriceUgx, valuation.breakdown?.ican_market_price)} per share
                  </p>
                  {showShareEditor ? (
                    <div className="flex gap-2 mt-2 max-w-xs">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        autoFocus
                        value={shareInput}
                        onChange={e => setShareInput(e.target.value)}
                        placeholder={String(valuation.totalShares)}
                        className="flex-1 min-w-0 text-[16px] sm:text-xs bg-slate-900/60 border border-slate-700/50 rounded-lg px-2.5 py-1.5 text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        onClick={handleSaveShares}
                        disabled={savingShares || !shareInput}
                        className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-amber-600 hover:bg-amber-500 text-white shrink-0"
                      >
                        {savingShares ? '…' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setShowShareEditor(false); setShareInput(''); setShareError(''); }}
                        className="text-xs px-2 py-1.5 rounded-lg text-slate-400 hover:text-white shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setShowShareEditor(true); setShareInput(String(valuation.totalShares)); }}
                      className="flex items-center gap-1 text-[11px] sm:text-xs text-slate-500 hover:text-slate-300 mt-1 transition-colors"
                    >
                      <Pencil size={9} />
                      {valuation.totalShares.toLocaleString()} total shares
                    </button>
                  )}
                  {shareError && showShareEditor && <p className="text-xs text-red-400 mt-1">{shareError}</p>}
                </div>
                <div className="text-right shrink-0">
                  <div className={`flex items-center gap-1 justify-end text-sm sm:text-base xl:text-lg font-bold ${trendColor}`}>
                    <TrendIcon size={14} />
                    {PCT(valuation.priceChangePercent)}
                  </div>
                  <p className="text-xs sm:text-sm xl:text-base text-slate-500">vs declared price</p>
                </div>
              </div>
            )}

            {/* Sparkline */}
            {history.length >= 2 && (
              <div className="mt-3 sm:mt-4 xl:mt-6">
                <Sparkline history={history} />
              </div>
            )}

            {/* Key metrics strip */}
            <div className="grid grid-cols-3 gap-1.5 sm:gap-3 xl:gap-4 mt-3 sm:mt-4 xl:mt-6">
              {[
                { label: 'Business Value', value: FMT(valuation.businessValueUgx) },
                { label: 'Net Profit',     value: FMT(valuation.netProfitUgx) },
                { label: 'ICAN Holdings',  value: FMT(valuation.icanHoldingsValue) }
              ].map(m => (
                <div key={m.label} className="rounded-lg bg-slate-800/60 border border-slate-700/30 px-2 py-2 sm:px-3 sm:py-3 xl:px-4 xl:py-4">
                  <p className="text-[10px] sm:text-xs xl:text-sm text-slate-500 truncate">{m.label}</p>
                  <p className="text-xs sm:text-sm xl:text-base font-bold text-white mt-0.5 tabular-nums break-words">{m.value}</p>
                </div>
              ))}
            </div>

            {/* Breakdown toggle */}
            <button
              onClick={() => setShowBreakdown(v => !v)}
              className="flex items-center gap-1 text-xs sm:text-sm text-slate-400 hover:text-white mt-3 py-2 -my-1 transition-colors"
            >
              {showBreakdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showBreakdown ? 'Hide' : 'Show'} source breakdown
            </button>

            {showBreakdown && (
              <div className="mt-2 space-y-1 text-xs sm:text-sm sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-0 sm:space-y-0">
                {[
                  { label: 'Manual Sales Income',          value: valuation.breakdown.ican_sold_income,     color: 'text-amber-400' },
                  { label: 'Manual Capital Assets',        value: valuation.breakdown.ican_capital_assets,  color: 'text-amber-400' },
                  { label: 'AgriBone Wallet Revenue',     value: valuation.breakdown.farm_revenue,         color: 'text-green-400' },
                  { label: 'MyBodaGuy Wallet Revenue',     value: valuation.breakdown.boda_revenue,         color: 'text-orange-400' },
                  { label: 'SupermarketEra Revenue',       value: valuation.breakdown.supermarket_revenue,  color: 'text-purple-400' },
                  { label: 'ICAN Wallet Revenue',          value: valuation.breakdown.ican_wallet_revenue,  color: 'text-cyan-400' },
                  { label: 'CMMS Inventory Value',         value: valuation.breakdown.cmms_inventory_value, color: 'text-blue-400' },
                  { label: `icaneracoin (${valuation.breakdown.ican_holdings_ican?.toFixed(4)} @ ${FMT(valuation.breakdown.ican_market_price)})`,
                    value: valuation.breakdown.ican_holdings_ugx, color: 'text-yellow-400' },
                  { label: 'COGS (Stock Bought)',          value: -valuation.breakdown.ican_bought_stock,   color: 'text-red-400' },
                  { label: 'Operating Expenses',           value: -valuation.breakdown.ican_operating_exp,  color: 'text-red-400' },
                  { label: 'Salary Expenses',              value: -valuation.breakdown.ican_salary_exp,     color: 'text-red-400' },
                ].filter(r => r.value !== 0).map(row => (
                  <div key={row.label} className="flex justify-between items-center gap-2 py-1.5 border-b border-slate-800/50">
                    <span className="text-slate-400 truncate flex-1">{row.label}</span>
                    <span className={`font-semibold tabular-nums shrink-0 ${row.color}`}>
                      {row.value >= 0 ? '+' : ''}{FMT(Math.abs(row.value))}
                    </span>
                  </div>
                ))}

                {valuation.blockchainTxHash && (
                  <div className="mt-2 p-2 sm:p-3 rounded-lg bg-emerald-900/20 border border-emerald-700/30 sm:col-span-2">
                    <p className="text-emerald-400 font-semibold">Blockchain proof</p>
                    <p className="text-slate-400 break-all mt-0.5">{valuation.blockchainTxHash}</p>
                  </div>
                )}
                {valuation.dataHash && !valuation.blockchainTxHash && (
                  <div className="mt-2 p-2 sm:p-3 rounded-lg bg-slate-800/40 border border-slate-700/30 sm:col-span-2">
                    <p className="text-slate-400 font-semibold">Data hash (SHA-256)</p>
                    <p className="text-slate-500 break-all mt-0.5 text-[10px]">{valuation.dataHash}</p>
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* ── Link Data Sources panel ── */}
      <div className="border-t lg:border-t-0 border-slate-700/40 mt-2 lg:mt-0 lg:col-span-2">
        <button
          onClick={() => setShowLinkPanel(v => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3.5 sm:px-6 sm:py-4 text-sm sm:text-base text-slate-300 hover:text-white hover:bg-slate-800/40 active:bg-slate-800/60 transition-colors"
        >
          <span className="flex items-center gap-2 flex-wrap min-w-0">
            <Link2 size={14} className="shrink-0" />
            <span className="truncate">Link Data Sources</span>
            <span className="flex items-center gap-1 shrink-0" aria-hidden="true">
              {SOURCE_APPS.map(app => (
                <span
                  key={app.key}
                  title={`${app.label} — ${links[app.key] ? 'linked' : 'not linked'}`}
                  className={`h-1.5 w-1.5 rounded-full transition-colors ${links[app.key] ? colorMap[app.color].dot : 'bg-slate-700'}`}
                />
              ))}
            </span>
            <span className="text-xs text-slate-500 shrink-0">
              2 auto + {linkedCount}/{SOURCE_APPS.length} linked
            </span>
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {linkedContributionTotal > 0 && (
              <span className="text-xs font-semibold text-emerald-400 tabular-nums">
                +{FMT(linkedContributionTotal)}
              </span>
            )}
            {showLinkPanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </button>

        {showLinkPanel && (
          <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-3">

            {linksError && (
              <div className="rounded-lg border border-red-700/40 bg-red-900/20 px-3 py-2 text-[11px] sm:text-xs text-red-300">
                Couldn't load linked sources from Supabase: {linksError}. Check that the <code className="text-red-200">pitchin_business_data_links</code> table (PITCHIN_LIVE_SHARE_VALUE_MIGRATION.sql) has been deployed and RLS allows this user to read it.
              </div>
            )}

            {/* ── Always-active sources (no linking required) ── */}
            <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/15 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                <span className="text-xs sm:text-sm font-bold text-emerald-300">Always Active — Auto-Linked</span>
              </div>
              <div className="space-y-3">

                {/* ── Manual Transactions (ican_transactions ledger) ── */}
                <div>
                  <button
                    onClick={() => setShowManualTx(v => !v)}
                    className="w-full flex items-start gap-2 text-left"
                  >
                    <FileText size={11} className="text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs sm:text-sm text-slate-200 font-medium">Manual Transactions</p>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {valuation?.sourceStats && (
                            <span className="text-[10px] sm:text-xs text-slate-500">
                              {valuation.sourceStats.manual.count} entr{valuation.sourceStats.manual.count === 1 ? 'y' : 'ies'}
                            </span>
                          )}
                          {showManualTx ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
                        </span>
                      </div>
                      <p className="text-[10px] sm:text-xs text-slate-500">Entries recorded and tagged to this business via "Record Transaction" — by you and your team.</p>
                    </div>
                  </button>

                  {showManualTx && (
                    <div className="mt-1.5 pl-[19px]">
                      {valuation?.breakdown ? (
                        (() => {
                          const rows = [
                            { label: 'Sales income',      value: valuation.breakdown.ican_sold_income,    sign: '+' },
                            { label: 'Capital assets',    value: valuation.breakdown.ican_capital_assets, sign: '+' },
                            { label: 'Stock bought',      value: valuation.breakdown.ican_bought_stock,   sign: '-' },
                            { label: 'Operating expense', value: valuation.breakdown.ican_operating_exp,  sign: '-' },
                            { label: 'Salary expense',    value: valuation.breakdown.ican_salary_exp,     sign: '-' },
                          ].filter(r => Number(r.value) > 0);

                          return rows.length > 0 ? (
                            <div className="rounded-lg bg-slate-900/50 border border-slate-700/30 divide-y divide-slate-800/60 overflow-hidden">
                              {rows.map(r => (
                                <div key={r.label} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                                  <span className="text-[10px] sm:text-xs text-slate-400">{r.label}</span>
                                  <span className={`text-[10px] sm:text-xs font-semibold tabular-nums shrink-0 ${r.sign === '+' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {r.sign}{FMT(r.value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] sm:text-xs text-slate-600 italic">No manual entries recorded yet.</p>
                          );
                        })()
                      ) : (
                        <div className="flex items-center gap-2 text-[10px] sm:text-xs text-slate-500">
                          <Loader size={10} className="animate-spin" />
                          Loading transaction data…
                        </div>
                      )}

                      {/* ── By contributor — who recorded what ── */}
                      <div className="mt-3 pt-2.5 border-t border-slate-800/60">
                        <p className="text-[10px] sm:text-xs font-semibold text-slate-400 mb-1.5 flex items-center gap-1.5">
                          <Users size={10} className="text-blue-400" /> By contributor
                        </p>
                        {loadingContributors ? (
                          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-slate-500">
                            <Loader size={10} className="animate-spin" />
                            Loading contributors…
                          </div>
                        ) : contributorsError ? (
                          <div className="rounded-lg border border-red-700/40 bg-red-900/20 px-2.5 py-2 text-[10px] sm:text-xs text-red-300">
                            Couldn't load contributor breakdown: {contributorsError}. Make sure BUSINESS_TRANSACTIONS_BY_CONTRIBUTOR.sql has been deployed to Supabase, and that you're the owner or a shareholder of this business.
                          </div>
                        ) : contributors.length === 0 ? (
                          <p className="text-[10px] sm:text-xs text-slate-600 italic">No entries recorded yet.</p>
                        ) : (
                          <div className="rounded-lg bg-slate-900/50 border border-slate-700/30 divide-y divide-slate-800/60 overflow-hidden">
                            {contributors.map(c => {
                              const isOpen = expandedContributorId === c.userId;
                              return (
                                <div key={c.userId || c.email}>
                                  <button
                                    onClick={() => setExpandedContributorId(isOpen ? null : c.userId)}
                                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-slate-800/40 transition-colors"
                                  >
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-[10px] sm:text-xs text-slate-200 font-medium truncate">{c.name}</span>
                                      <span className="block text-[9px] sm:text-[10px] text-slate-500">
                                        {c.count} entr{c.count === 1 ? 'y' : 'ies'}
                                      </span>
                                    </span>
                                    <span className={`text-[10px] sm:text-xs font-semibold tabular-nums shrink-0 ${c.netUgx >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                      {c.netUgx >= 0 ? '+' : ''}{FMT(c.netUgx)}
                                    </span>
                                    {isOpen ? <ChevronUp size={11} className="text-slate-500 shrink-0" /> : <ChevronDown size={11} className="text-slate-500 shrink-0" />}
                                  </button>

                                  {isOpen && (
                                    <div className="bg-slate-950/40 divide-y divide-slate-800/40">
                                      {c.entries.map(e => (
                                        <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                                          <span className="min-w-0 flex-1">
                                            <span className="block text-[10px] text-slate-300 truncate">
                                              {e.description || REPORTING_BUCKET_LABELS[e.reporting_bucket] || 'Entry'}
                                            </span>
                                            <span className="block text-[9px] text-slate-600">
                                              {new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </span>
                                          </span>
                                          <span className="text-[10px] font-semibold tabular-nums text-slate-400 shrink-0">
                                            {FMT(e.amount)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Wallet Transactions (ican_coin_transactions, all apps) ── */}
                <div className="pt-3 border-t border-emerald-800/20">
                  <button
                    onClick={() => setShowWalletTx(v => !v)}
                    className="w-full flex items-start gap-2 text-left"
                  >
                    <Wallet size={11} className="text-cyan-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs sm:text-sm text-slate-200 font-medium">Wallet Transactions</p>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {valuation?.sourceStats && (
                            <span className="text-[10px] sm:text-xs text-slate-500">
                              {valuation.sourceStats.wallet.count} entr{valuation.sourceStats.wallet.count === 1 ? 'y' : 'ies'}
                            </span>
                          )}
                          {showWalletTx ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
                        </span>
                      </div>
                      <p className="text-[10px] sm:text-xs text-slate-500">
                        icaneracoin earned into your wallet. The native ICAN wallet always counts — AgriBone, MyBodaGuy & SupermarketEra only count once linked below.
                      </p>
                    </div>
                  </button>

                  {showWalletTx && (
                    <div className="mt-1.5 pl-[19px]">
                      {valuation?.sourceStats ? (
                        (() => {
                          const labels = {
                            'mybodaguy':         'MyBodaGuy',
                            'farm-agent':        'AgriBone',
                            'digital-city-era':  'SupermarketEra',
                            'ican':              'ICAN wallet'
                          };
                          const rows = Object.entries(valuation.sourceStats.wallet.bySourceApp || {})
                            .filter(([, v]) => v.count > 0)
                            .map(([key, v]) => ({ label: labels[key] || key, count: v.count, value: v.valueUgx, counted: v.counted }))
                            .sort((a, b) => (b.counted - a.counted) || (b.value - a.value));

                          return rows.length > 0 ? (
                            <div className="rounded-lg bg-slate-900/50 border border-slate-700/30 divide-y divide-slate-800/60 overflow-hidden">
                              {rows.map(r => (
                                <div key={r.label} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                                  <span className={`text-[10px] sm:text-xs ${r.counted ? 'text-slate-400' : 'text-slate-500'}`}>
                                    {r.label} <span className="text-slate-600">· {r.count}</span>
                                    {!r.counted && <span className="ml-1.5 text-amber-500/80">not linked</span>}
                                  </span>
                                  <span className={`text-[10px] sm:text-xs font-semibold tabular-nums shrink-0 ${r.counted ? 'text-emerald-400' : 'text-slate-600'}`}>
                                    +{FMT(r.value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] sm:text-xs text-slate-600 italic">No wallet earnings recorded yet.</p>
                          );
                        })()
                      ) : (
                        <div className="flex items-center gap-2 text-[10px] sm:text-xs text-slate-500">
                          <Loader size={10} className="animate-spin" />
                          Loading wallet data…
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Team Members — who else can tag transactions to this business ── */}
                <div className="pt-3 border-t border-emerald-800/20">
                  <button
                    onClick={() => setShowTeamModal(true)}
                    className="w-full flex items-start gap-2 text-left"
                  >
                    <Users size={11} className="text-blue-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs sm:text-sm text-slate-200 font-medium">Team Members</p>
                        <span className="text-[10px] sm:text-xs text-blue-400 font-semibold shrink-0">Manage →</span>
                      </div>
                      <p className="text-[10px] sm:text-xs text-slate-500">Give other ICAN accounts access to record transactions for this business.</p>
                    </div>
                  </button>
                </div>

              </div>
            </div>

            <p className="text-[10px] sm:text-xs text-slate-600 px-0.5">
              These sources only count toward your share price once linked — link below to include inventory, farm produce, boda fleet & store sales.
            </p>

            {discovering && (
              <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-400 py-1">
                <Loader size={11} className="animate-spin" />
                Searching your accounts across apps…
              </div>
            )}

            <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0 lg:grid-cols-1 lg:space-y-3 xl:grid-cols-2 xl:space-y-0">
              {SOURCE_APPS.map(app => {
                const linked      = links[app.key];
                const cols        = colorMap[app.color];
                const Icon        = app.icon;
                const appEntities = discovered[app.key] || [];
                const isSaving    = linkSaving === app.key;
                const recordCount = getSourceRecordCount(app, valuation?.sourceStats);

                return (
                  <div key={app.key} className={`rounded-xl border p-3 sm:p-4 ${cols.bg} ${cols.border}`}>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <Icon size={14} className={cols.text} />
                      <span className={`text-xs sm:text-sm font-bold ${cols.text}`}>{app.label}</span>
                      {/* CMMS requires admin badge */}
                      {app.key === 'cmms' && (
                        <span className="text-[10px] text-slate-500 bg-slate-800/60 rounded px-1.5 py-0.5 ml-1">
                          Admin required
                        </span>
                      )}
                      {linked && (
                        <span className={`ml-auto text-[10px] rounded-full px-2 py-0.5 ${cols.badge} ${cols.text}`}>
                          Linked
                        </span>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-slate-500 mb-2">{app.description}</p>

                    <div className={`flex items-center justify-between gap-2 text-[11px] sm:text-xs rounded-lg px-2.5 py-1.5 mb-2 ${cols.badge}`}>
                      <span className={cols.text}>
                        Contributing to valuation
                        {recordCount != null && <span className="text-slate-500"> · {recordCount} record{recordCount === 1 ? '' : 's'}</span>}
                      </span>
                      <span className="font-bold text-white tabular-nums shrink-0">
                        {valuation ? FMT(valuation.breakdown?.[app.breakdownKey] || 0) : '—'}
                      </span>
                    </div>

                    {linked ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm text-slate-300 flex-1 truncate">
                          {linked.source_entity_name || linked.source_entity_id}
                        </span>
                        <button
                          onClick={() => handleRemoveLink(app.key)}
                          className="flex items-center gap-1 text-xs sm:text-sm text-red-400 hover:text-red-300 active:text-red-200 transition-colors py-2 -my-1 px-1 -mx-1"
                        >
                          <Link2Off size={11} />
                          Unlink
                        </button>
                      </div>
                    ) : appEntities.length > 0 && !discovering ? (
                      /* Smart entity picker — one button per discovered account */
                      <div className="space-y-1.5">
                        {appEntities.map(entity => (
                          <div
                            key={entity.id}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs sm:text-sm transition-all bg-slate-900/70 border-slate-700/50 hover:border-slate-500 hover:bg-slate-800 ${isSaving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            onClick={() => !isSaving && handleSaveLink(app.key, entity.id, entity.label)}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="truncate font-medium text-white">{entity.label}</p>
                              {app.key === 'cmms' && (
                                <p className="text-[10px] text-emerald-400">Role: {entity.role} ✓</p>
                              )}
                            </div>
                            <span className={`ml-2 shrink-0 font-semibold ${cols.text}`}>
                              {isSaving ? '…' : entity.autoLink ? 'Connect' : 'Link'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : !discovering ? (
                      /* Fallback: manual input when no account discovered */
                      <div className="space-y-1.5">
                        <p className="text-[10px] sm:text-xs text-slate-500">
                          {app.key === 'cmms' && 'No CMMS company found where you are admin.'}
                          {app.key === 'digital-city-era' && 'You must be a SupermarketEra admin to link this store.'}
                          {app.key !== 'cmms' && app.key !== 'digital-city-era' && `No ${app.label} account found — paste the ID manually:`}
                        </p>
                        {/* CMMS and SupermarketEra require verified admin — no manual ID input */}
                        {app.key !== 'cmms' && app.key !== 'digital-city-era' && (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={linkInputs[app.key] || ''}
                              onChange={e => setLinkInputs(prev => ({ ...prev, [app.key]: e.target.value }))}
                              placeholder={app.placeholder}
                              className="flex-1 min-w-0 text-[16px] sm:text-xs bg-slate-900/60 border border-slate-700/50 rounded-lg px-2.5 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-slate-500"
                            />
                            <button
                              onClick={() => handleSaveLink(app.key)}
                              disabled={isSaving || !linkInputs[app.key]?.trim()}
                              className={`text-xs sm:text-sm px-3 py-2 rounded-lg font-semibold transition-all shrink-0 ${isSaving ? 'bg-slate-700 text-slate-400' : 'bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white'}`}
                            >
                              {isSaving ? '…' : 'Link'}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      </div>
    </div>

    {showTeamModal && (
      <BusinessTeamMembersModal
        profile={{ id: businessProfileId, business_name: businessProfile?.business_name || businessProfile?.name }}
        onClose={() => setShowTeamModal(false)}
      />
    )}
    </>
  );
}
