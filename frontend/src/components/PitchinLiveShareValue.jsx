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

import React, { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import {
  TrendingUp, TrendingDown, Link2, Link2Off, RefreshCw,
  Shield, ShieldCheck, ChevronDown, ChevronUp, Loader,
  Building2, Tractor, Bike, ShoppingCart, Coins,
  FileText, CheckCircle2, Wallet, PieChart, Pencil, Users, Lock
} from 'lucide-react';
import BusinessTeamMembersModal from './BusinessTeamMembersModal';
import PitchinValueGrowth from './PitchinValueGrowth';
import TransactionDayBook from './TransactionDayBook';
import {
  calculateLiveShareValue,
  saveDataLink,
  removeDataLink,
  getBusinessDataLinks,
  setBusinessTotalShares,
  getBusinessTransactionsByContributor
} from '../services/pitchinValuationService';
import { getBusinessTeamMembers } from '../services/pitchingService';
import { archiveTransaction } from '../services/supabaseTransactions';
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
  return `${amount.toFixed(dec)} IcanEra`;
};

// Convert UGX → local currency using CountryService built-in rates (no external API)
// CountryService.icanToLocal(1, country, ugx) = 1 × ugx × exchangeRate = ugx in local
// Currencies that have no decimal places (like UGX, JPY)
const NO_DECIMAL_CURRENCIES = new Set(['UGX','TZS','RWF','BIF','SSP','DJF','XAF','XOF','JPY','KRW','IDR','VND']);

const fmtLocal = (ugx, countryCode) => {
  // icanToLocal treats a falsy price as "use the 5,000 base rate", so an amount
  // of exactly 0 would be shown as 5,000 — a zero must stay a zero.
  const amount = Number(ugx) || 0;
  const local = amount === 0 ? 0 : CountryService.icanToLocal(1, countryCode || 'UG', amount);
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
    label: 'SupermartKera Store',
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

// Scalloped rosette: 24 points, alternating outer / inner radius.
const SEAL_PATH = (() => {
  const n = 24, outer = 46, inner = 41.5;
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 ? inner : outer;
    d += `${i ? 'L' : 'M'}${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
})();

// The certificate seal — lettering says whether the figure is anchored on-chain
// or carries its SHA-256 hash.
function Seal({ verified }) {
  const ringId = `ls-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const label = verified ? 'ON-CHAIN \u2022 VERIFIED \u2022 ' : 'SHA-256 \u2022 HASHED \u2022 ';
  return (
    <svg viewBox="0 0 100 100" className="ls-seal" role="img" aria-label={verified ? 'Valuation anchored on-chain' : 'Valuation protected by a SHA-256 hash'}>
      <defs>
        <path id={ringId} d="M50,50 m-30,0 a30,30 0 1,1 60,0 a30,30 0 1,1 -60,0" />
      </defs>
      <path d={SEAL_PATH} className="ls-seal__scallop" />
      <circle cx="50" cy="50" r="38" className="ls-seal__ring" />
      <g className="ls-seal__spin">
        <text className="ls-seal__text">
          <textPath href={`#${ringId}`} textLength="186" lengthAdjust="spacing">{label}</textPath>
        </text>
      </g>
      <g transform="translate(35 35) scale(1.25)" className="ls-seal__icon">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </g>
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PitchinLiveShareValue({ businessProfile, ownerUserId, readOnly = false }) {
  const [valuation, setValuation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [links, setLinks] = useState({});
  const [linksError, setLinksError] = useState('');
  const [linkInputs, setLinkInputs] = useState({});
  const [linkSaving, setLinkSaving] = useState('');
  const [discovered, setDiscovered] = useState({});   // { appKey: [{id, label}] }
  const [discovering, setDiscovering] = useState(false);
  const [showManualTx, setShowManualTx] = useState(false);
  const [showWalletTx, setShowWalletTx] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [contributors, setContributors] = useState([]);
  const [contributorsError, setContributorsError] = useState(null);
  const [loadingContributors, setLoadingContributors] = useState(false);
  const [expandedContributorId, setExpandedContributorId] = useState(null);
  const [helpers, setHelpers] = useState([]);           // business_team_members: may enter data on behalf of the company
  const [entriesView, setEntriesView] = useState('day'); // 'day' | 'contributor'
  const [archivingId, setArchivingId] = useState(null);
  const [userCountry, setUserCountry] = useState('UG');
  const [showShareEditor, setShowShareEditor] = useState(false);
  const [shareInput, setShareInput] = useState('');
  const [savingShares, setSavingShares] = useState(false);
  const [shareError, setShareError] = useState('');
  const [showMarketInfo, setShowMarketInfo] = useState(false);

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
            return r.is_creator === true
              || role.includes('admin')
              || role.includes('owner');
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

      // ── SupermartKera: link the actual supermarket UUID, not the internal
      //   public user ID. The valuation service uses this UUID to read POS
      //   transactions from `transactions.supermarket_id`.
      const { data: ownedStores } = await supabase
        .from('supermarkets')
        .select('id, name')
        .eq('owner_user_id', user.id)
        .limit(20);

      if (ownedStores?.length) {
        result['digital-city-era'] = ownedStores.map(store => ({
          id: store.id,
          label: store.name || user.email,
          autoLink: true
        }));
      }

      // Legacy fallback: some stores were created before owner_user_id was
      // consistently populated. Resolve through the internal users row.
      const { data: dceUser } = await supabase
        .from('users')
        .select('id, email, role, supermarket_id')
        .ilike('email', user.email)
        .maybeSingle();

      if (!result['digital-city-era'] && dceUser && (dceUser.role || '').toLowerCase() === 'admin') {
        const { data: assignedStore } = await supabase
          .from('supermarkets')
          .select('id, name')
          .eq('id', dceUser.supermarket_id)
          .maybeSingle();
        result['digital-city-era'] = [{
          id:       assignedStore?.id || dceUser.id || user.id,
          label:    assignedStore?.name || dceUser.email || user.email,
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
  // opened — lets the owner see who (owner, co-owner, helper) recorded what,
  // not just the combined totals. Also the source of the day book.
  const loadContributors = useCallback(async () => {
    if (!businessProfileId) return;
    setLoadingContributors(true);
    try {
      const { contributors: rows, error } = await getBusinessTransactionsByContributor(businessProfileId);
      setContributors(rows);
      setContributorsError(error);
    } finally {
      setLoadingContributors(false);
    }
  }, [businessProfileId]);

  // The owner's helper roster (people assigned to enter data on the company's behalf).
  const loadHelpers = useCallback(async () => {
    if (!businessProfileId || readOnly) return;
    setHelpers(await getBusinessTeamMembers(businessProfileId));
  }, [businessProfileId, readOnly]);

  useEffect(() => {
    if (!showManualTx) return;
    loadContributors();
    loadHelpers();
  }, [showManualTx, loadContributors, loadHelpers]);

  // Every contributor's entries in one list — the day book groups these by date.
  const allEntries = useMemo(() => contributors.flatMap((c) => c.entries), [contributors]);

  const loadValuation = useCallback(async () => {
    if (!businessProfileId || !ownerUserId) return;
    setLoading(true);
    setError('');
    try {
      const result = await calculateLiveShareValue(businessProfileId, ownerUserId, {
        saveSnapshot: !readOnly
      });
      setValuation(result);
    } catch (err) {
      setError(err.message || 'Valuation failed');
    } finally {
      setLoading(false);
    }
  }, [businessProfileId, ownerUserId, readOnly]);

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

  useEffect(() => {
    loadLinks();
    loadValuation();
  }, [loadLinks, loadValuation]);

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
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [businessProfileId, loadValuation]);

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

  // Two-account entries can never be deleted; the owner archives them instead.
  const handleArchiveEntry = async (entry) => {
    const label = entry.description || REPORTING_BUCKET_LABELS[entry.reporting_bucket] || 'this entry';
    if (!window.confirm(
      `Archive "${label}"?\n\nIt stays in your books and keeps counting toward the share value, but its extra detail ` +
      '(notes, quantities, product names) is removed to save space. This cannot be undone.'
    )) return;
    setArchivingId(entry.id);
    try {
      const result = await archiveTransaction(entry.id);
      if (!result.success) {
        alert('Could not archive: ' + (result.error?.message || 'unknown error'));
        return;
      }
      await loadContributors();
    } finally {
      setArchivingId(null);
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
  const marketUp = countryPrice ? countryPrice.appreciation_pct >= 0 : true;

  const linkedCount = SOURCE_APPS.filter(app => links[app.key]).length;
  const linkedContributionTotal = SOURCE_APPS.reduce((sum, app) => {
    if (!links[app.key] || !app.breakdownKey || !valuation?.breakdown) return sum;
    return sum + (Number(valuation.breakdown[app.breakdownKey]) || 0);
  }, 0);

  const sharePriceText = valuation && !valuation.needsShareSetup ? FMT(valuation.sharePriceUgx) : '';
  // A price that rounds to nothing reads as a broken "UGX 0" — say why instead.
  const noValueYet = !!valuation && !valuation.needsShareSetup && Number(valuation.sharePriceUgx) < 1;
  const hasSide = !!valuation || !readOnly;

  const b = valuation?.breakdown || {};
  const n = (v) => Number(v) || 0;
  const statementRows = valuation ? [
    { label: 'Business value',   value: FMT(valuation.businessValueUgx) },
    { label: 'Net profit',       value: FMT(valuation.netProfitUgx) },
    { label: 'IcanEra holdings', value: FMT(valuation.icanHoldingsValue) }
  ] : [];
  const breakdownRows = valuation ? [
    { label: 'Manual sales income',       value: n(b.ican_sold_income),     tone: 'gold' },
    { label: 'Manual capital assets',     value: n(b.ican_capital_assets),  tone: 'gold' },
    { label: 'AgriBone wallet revenue',   value: n(b.farm_revenue),         tone: 'up' },
    { label: 'MyBodaGuy wallet revenue',  value: n(b.boda_revenue),         tone: 'orange' },
    { label: 'SupermartKera revenue',     value: n(b.supermarket_revenue),  tone: 'purple' },
    { label: 'IcanEra wallet revenue',    value: n(b.ican_wallet_revenue),  tone: 'cyan' },
    { label: 'CMMS inventory value',      value: n(b.cmms_inventory_value), tone: 'blue' },
    { label: `IcanEra (${n(b.ican_holdings_ican).toFixed(4)} @ ${FMT(b.ican_market_price)})`,
      value: n(b.ican_holdings_ugx), tone: 'gold' },
    { label: 'COGS (stock bought)',       value: -n(b.ican_bought_stock),   tone: 'down' },
    { label: 'Operating expenses',        value: -n(b.ican_operating_exp),  tone: 'down' },
    { label: 'Salary expenses',           value: -n(b.ican_salary_exp),     tone: 'down' }
  ].filter(r => r.value !== 0) : [];

  return (
    <>
    <div className="ls-classic">

      {/* ── Header ── */}
      <div className="ls-head">
        <div className="ls-head__main">
          <Coins size={18} className="ls-head__coin" />
          <span className="ls-title">Live Share Value</span>
          {readOnly && <span className="ls-chip">Shareholder view</span>}
          {valuation?.blockchainVerified && (
            <span className="ls-chip ls-chip--ok"><ShieldCheck size={11} /> On-chain</span>
          )}
          {valuation && !valuation.blockchainVerified && (
            <span className="ls-chip"><Shield size={11} /> Hashed</span>
          )}
        </div>
        <button type="button" onClick={loadValuation} disabled={loading} aria-label="Refresh valuation" className="ls-iconbtn">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── IcanEra live market — a ticker tape, with the explanation tucked away on phones ── */}
      <section className="ls-tape" aria-label="IcanEra live market">
        <div className="ls-tape__head">
          <div className="ls-tape__row">
            <span className="ls-tape__name">
              <span className="ls-live" aria-hidden="true" />
              IcanEra — Live Market
            </span>
            {countryPrice && (
              <span className={`ls-tape__chg ${marketUp ? 'is-up' : 'is-down'}`}>
                {marketUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {PCT(countryPrice.appreciation_pct)}
              </span>
            )}
          </div>
          {countryPrice ? (
            <>
              <p className="ls-tape__price">
                {fmtExact(countryPrice.price_local, countryPrice.currency_code)}
                <small>per IcanEra</small>
              </p>
              {liveTick && <p className="ls-tape__tick">{liveTick}</p>}
              <button
                type="button"
                className="ls-tape__more"
                aria-expanded={showMarketInfo}
                onClick={() => setShowMarketInfo(v => !v)}
              >
                {showMarketInfo ? 'Hide details' : 'How is this price protected?'}
                <ChevronDown size={14} />
              </button>
            </>
          ) : (
            <div className="ls-state" style={{ padding: '.6rem 0 0', color: '#b8ab8c' }}>
              <Loader size={12} className="animate-spin" />
              Loading live market data…
            </div>
          )}
        </div>
        {countryPrice && (
          <p className={`ls-tape__text ${showMarketInfo ? 'is-open' : ''}`}>
            Anchored to a self-adjusting 5,000 UGX floor that rises with currency depreciation and never falls.{' '}
            {countryPrice.is_protected
              ? `Up ${PCT(countryPrice.appreciation_pct)} since launch — beating ${countryPrice.country_name || 'local'} inflation (${Number(countryPrice.local_inflation || 0).toFixed(1)}%) by ${PCT(countryPrice.net_protection)}.`
              : `Local inflation (${Number(countryPrice.local_inflation || 0).toFixed(1)}%) is currently outpacing the ${PCT(countryPrice.appreciation_pct)} rise — the floor is still catching up.`}
            {countryPrice.inflation_as_of_year && (
              <span>
                {' '}(World Bank{countryPrice.inflation_source === 'world_bank_fp_cpi_totl_zg' ? '' : ' est.'}, {countryPrice.inflation_as_of_year})
              </span>
            )}
          </p>
        )}
      </section>

      <div className={`ls-grid ${hasSide ? 'ls-grid--split' : ''}`}>

      {/* ── Certificate + growth ── */}
      <div className="ls-col ls-col--main">
        {loading && !valuation ? (
          <div className="ls-state">
            <Loader size={15} className="animate-spin" />
            Computing live valuation…
          </div>
        ) : error ? (
          <p className="ls-state ls-state--err">{error}</p>
        ) : valuation ? (
          <>
            {valuation.needsShareSetup ? (
              readOnly ? (
                <div className="ls-notice">
                  <div className="ls-notice__head">
                    <Shield size={16} />
                    <strong>Share count not configured</strong>
                  </div>
                  <p>The business owner must configure the total shares before a live price per share can be displayed.</p>
                </div>
              ) : (
                <div className="ls-notice ls-notice--accent">
                  <div className="ls-notice__head">
                    <PieChart size={16} />
                    <strong>Set up shares to see live price per share</strong>
                  </div>
                  <p>
                    Business value is <b>{FMT(valuation.businessValueUgx)}</b>.
                    Tell PitchIn how many total shares this business has, and it'll divide that value automatically —
                    and keep recalculating live as revenue, assets and expenses change.
                  </p>
                  <div className="ls-shareedit">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={shareInput}
                      onChange={e => setShareInput(e.target.value)}
                      placeholder="e.g. 1000000"
                    />
                    <button type="button" className="ls-btn" onClick={handleSaveShares} disabled={savingShares || !shareInput}>
                      {savingShares ? '…' : 'Set Shares'}
                    </button>
                  </div>
                  {shareError && <p className="ls-err">{shareError}</p>}
                </div>
              )
            ) : (
              <section className="ls-cert" aria-label="Value of one share">
                <p className="ls-eyebrow">Value of one share · today</p>
                <p className="ls-price" style={{ '--ls-len': Math.max(6, sharePriceText.length) }}>
                  {sharePriceText}
                </p>
                <p className="ls-cert__ican">
                  {ICAN_PER_SHARE(valuation.sharePriceUgx, valuation.breakdown?.ican_market_price)} per share
                </p>

                <div className="ls-orn" aria-hidden="true">◆</div>

                <div className="ls-cert__foot">
                  <div className="ls-cert__facts">
                    <div className={`ls-delta ${priceUp ? 'is-up' : 'is-down'}`}>
                      <TrendIcon size={16} />
                      {PCT(valuation.priceChangePercent)}
                      <span>vs declared price</span>
                    </div>

                    {showShareEditor ? (
                      <div className="ls-shareedit">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          autoFocus
                          value={shareInput}
                          onChange={e => setShareInput(e.target.value)}
                          placeholder={String(valuation.totalShares)}
                        />
                        <button type="button" className="ls-btn" onClick={handleSaveShares} disabled={savingShares || !shareInput}>
                          {savingShares ? '…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="ls-btn ls-btn--ghost"
                          onClick={() => { setShowShareEditor(false); setShareInput(''); setShareError(''); }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : readOnly ? (
                      <p className="ls-shares">{valuation.totalShares.toLocaleString()} total shares</p>
                    ) : (
                      <button
                        type="button"
                        className="ls-shares--btn ls-shares"
                        onClick={() => { setShowShareEditor(true); setShareInput(String(valuation.totalShares)); }}
                      >
                        <Pencil size={12} />
                        {valuation.totalShares.toLocaleString()} total shares
                      </button>
                    )}
                    {shareError && showShareEditor && <p className="ls-err">{shareError}</p>}
                  </div>
                  <Seal verified={!!valuation.blockchainVerified} />
                </div>

                {noValueYet && (
                  <p className="ls-cert__note">
                    {readOnly
                      ? 'This business has not recorded enough activity to give one share a value yet. It will appear here as sales, assets and linked apps are added.'
                      : 'No value recorded yet. Record sales or assets, or link an app below, and the value of one share starts to grow.'}
                  </p>
                )}
              </section>
            )}

            {/* Real value growth — daily snapshots + today's live price */}
            {!valuation.needsShareSetup && (
              <PitchinValueGrowth
                businessProfileId={businessProfileId}
                current={{
                  priceUgx: valuation.sharePriceUgx,
                  businessValueUgx: valuation.businessValueUgx,
                  declaredPriceUgx: valuation.originalPriceUgx
                }}
                fmt={FMT}
                fmtIcan={(ugx) => ICAN_PER_SHARE(ugx, valuation.breakdown?.ican_market_price)}
                annualInflationPct={countryPrice ? Number(countryPrice.local_inflation) : null}
                refreshToken={valuation.sharePriceUgx}
              />
            )}
          </>
        ) : null}
      </div>

      {/* ── Statement of value + source links ── */}
      <aside className="ls-col ls-col--side">
        {valuation && (
          <div className="ls-statement">
            <p className="ls-eyebrow ls-sect__title">Statement of value</p>
            <dl className="ls-ledger">
              {statementRows.map(m => (
                <div key={m.label} className="ls-ledger__row">
                  <dt>{m.label}</dt>
                  <span className="ls-leader" aria-hidden="true" />
                  <dd>{m.value}</dd>
                </div>
              ))}
            </dl>

            <button type="button" className="ls-more" aria-expanded={showBreakdown} onClick={() => setShowBreakdown(v => !v)}>
              {showBreakdown ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showBreakdown ? 'Hide' : 'Show'} source breakdown
            </button>

            {showBreakdown && (
              <>
                <dl className="ls-ledger ls-ledger--sub">
                  {breakdownRows.map(row => (
                    <div key={row.label} className="ls-ledger__row">
                      <dt>{row.label}</dt>
                      <span className="ls-leader" aria-hidden="true" />
                      <dd className={`ls-tone-${row.tone}`}>
                        {row.value >= 0 ? '+' : '−'}{FMT(Math.abs(row.value))}
                      </dd>
                    </div>
                  ))}
                </dl>

                {valuation.blockchainTxHash && (
                  <div className="ls-hash ls-hash--ok">
                    <b>Blockchain proof</b>
                    <code>{valuation.blockchainTxHash}</code>
                  </div>
                )}
                {valuation.dataHash && !valuation.blockchainTxHash && (
                  <div className="ls-hash">
                    <b>Data hash (SHA-256)</b>
                    <code>{valuation.dataHash}</code>
                  </div>
                )}
              </>
            )}
          </div>
        )}

      {/* ── Link Data Sources panel ── */}
      {!readOnly && (
      <div className="ls-sources">
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
                      <p className="text-[10px] sm:text-xs text-slate-500">Entries recorded and tagged to this business via "Record Transaction" — by you and the helpers you assign.</p>
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

                      {/* ── Helpers — people assigned to enter data on behalf of the company ── */}
                      <div className="mt-3 pt-2.5 border-t border-slate-800/60">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                            <Users size={10} className="text-blue-400" /> Transaction helpers
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowTeamModal(true)}
                            className="text-[10px] sm:text-xs text-blue-400 font-semibold py-1 pl-2"
                          >
                            Manage →
                          </button>
                        </div>
                        {helpers.length === 0 ? (
                          <p className="text-[10px] sm:text-xs text-slate-600 italic">
                            No helpers yet. Assign someone to enter data on behalf of the company.
                          </p>
                        ) : (
                          <div className="rounded-lg bg-slate-900/50 border border-slate-700/30 divide-y divide-slate-800/60 overflow-hidden">
                            {helpers.map((h) => {
                              const recorded = contributors.find((c) => c.userId === h.user_id)?.count || 0;
                              return (
                                <div key={h.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-[10px] sm:text-xs text-slate-200 font-medium truncate">{h.member_name}</span>
                                    <span className="block text-[9px] sm:text-[10px] text-slate-500 truncate">{h.member_email}</span>
                                  </span>
                                  <span className="text-[10px] sm:text-xs text-slate-500 shrink-0">
                                    {recorded} entr{recorded === 1 ? 'y' : 'ies'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <p className="mt-1.5 flex items-start gap-1 text-[10px] sm:text-xs text-slate-600">
                          <Lock size={10} className="shrink-0 mt-0.5 text-amber-500/80" />
                          Helper entries are permanent — they can't be deleted, only archived by you.
                        </p>
                      </div>

                      {/* ── Entries — day by day (default) or by who recorded them ── */}
                      <div className="mt-3 pt-2.5 border-t border-slate-800/60">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                            <FileText size={10} className="text-amber-400" /> Entries
                          </p>
                          <div className="ls-tabs" role="tablist" aria-label="Group entries">
                            {[{ key: 'day', label: 'By day' }, { key: 'contributor', label: 'By contributor' }].map((v) => (
                              <button
                                key={v.key}
                                type="button"
                                role="tab"
                                aria-selected={entriesView === v.key}
                                className={`ls-tab ${entriesView === v.key ? 'is-active' : ''}`}
                                onClick={() => setEntriesView(v.key)}
                              >
                                {v.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {loadingContributors && contributors.length === 0 ? (
                          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-slate-500">
                            <Loader size={10} className="animate-spin" />
                            Loading entries…
                          </div>
                        ) : contributorsError ? (
                          <div className="rounded-lg border border-red-700/40 bg-red-900/20 px-2.5 py-2 text-[10px] sm:text-xs text-red-300">
                            Couldn't load the entries: {contributorsError}. Make sure BUSINESS_TRANSACTIONS_BY_CONTRIBUTOR.sql and MANUAL_TRANSACTION_HELPERS.sql have been deployed to Supabase, and that you're the owner or a shareholder of this business.
                          </div>
                        ) : entriesView === 'day' ? (
                          <TransactionDayBook
                            entries={allEntries}
                            fmt={FMT}
                            bucketLabels={REPORTING_BUCKET_LABELS}
                            showWho
                            canArchive
                            onArchive={handleArchiveEntry}
                            archivingId={archivingId}
                          />
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
                                    <div className="p-2">
                                      <TransactionDayBook
                                        entries={c.entries}
                                        fmt={FMT}
                                        bucketLabels={REPORTING_BUCKET_LABELS}
                                        canArchive
                                        onArchive={handleArchiveEntry}
                                        archivingId={archivingId}
                                      />
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
                        IcanEra earned into your wallet. The native IcanEra wallet always counts — AgriBone, MyBodaGuy & SupermartKera only count once linked below.
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
                            'digital-city-era':  'SupermartKera',
                            'ican':              'IcanEra wallet'
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
                          {app.key === 'digital-city-era' && 'You must be a SupermartKera admin to link this store.'}
                          {app.key !== 'cmms' && app.key !== 'digital-city-era' && `No ${app.label} account found — paste the ID manually:`}
                        </p>
                        {/* CMMS and SupermartKera require verified admin — no manual ID input */}
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
      )}
      </aside>

      </div>
    </div>


    {!readOnly && showTeamModal && (
      <BusinessTeamMembersModal
        profile={{ id: businessProfileId, business_name: businessProfile?.business_name || businessProfile?.name }}
        title="Transaction Helpers"
        includeCmms
        onClose={() => { setShowTeamModal(false); loadHelpers(); }}
      />
    )}
    </>
  );
}
