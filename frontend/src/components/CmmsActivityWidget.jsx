import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import {
  Building2, Users, Package, ClipboardList, AlertTriangle,
  TrendingUp, TrendingDown, Minus, ShoppingCart, Activity, ChevronRight, ChevronLeft,
  Wallet, UserCheck, DoorOpen, Briefcase, CheckSquare, FileText, ArrowLeftRight
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';

// Abbreviates any count or amount (K/M/B/T) so the real number always
// fits on the card without CSS truncation ever having to hide a digit --
// used for every number on this widget, not just currency, since
// inventory item counts, transaction counts, and pending/urgent counts
// can all grow large as a business grows. UGX is a small-unit currency
// (billions are an everyday amount, not an edge case), so the billion
// tier matters here -- without it, a value like 9.82 billion rendered as
// "9820.8M", wide enough to overflow the card on narrower screens.
// Whole values read clean ("5K", "2M"), only picking up a decimal when
// it's actually meaningful ("5.4K").
const fmtShort = (n) => {
  const v = Math.abs(n || 0);
  const sign = n < 0 ? '-' : '';
  const round1 = (x) => Math.round(x * 10) / 10;
  const clean = (x) => (Number.isInteger(x) ? x.toFixed(0) : x.toFixed(1));
  if (v >= 1_000_000_000_000) return `${sign}${clean(round1(v / 1_000_000_000_000))}T`;
  if (v >= 1_000_000_000) return `${sign}${clean(round1(v / 1_000_000_000))}B`;
  if (v >= 1_000_000) return `${sign}${clean(round1(v / 1_000_000))}M`;
  if (v >= 1_000) return `${sign}${clean(round1(v / 1_000))}K`;
  return `${sign}${v.toFixed(0)}`;
};

const relTime = (iso) => {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const DAY_LABEL = (isoDate) => new Date(isoDate).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);

const SmChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-md px-2.5 py-1.5 shadow-lg text-[11px]">
      <p className="text-slate-400">{new Date(p.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
      <p className="text-emerald-400 font-semibold">UGX {fmtShort(p.total)}</p>
    </div>
  );
};

// Section label: the small uppercase caption above every slide's content,
// the one repeating typographic element that ties the card together.
const SectionLabel = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-1.5 mb-2.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide min-w-0">
    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
    <span className="truncate">{children}</span>
  </div>
);

/**
 * Real, auto-sliding "what's happening right now" card for the home
 * screen -- the spot directly above "Record Every Transaction". Shows
 * CMMS company activity (when the viewer has CMMS access) and/or their
 * Supermarketa store's sales/approvals (resolved independently via
 * fn_get_supermarketa_dashboard_summary, same shared-DB pattern as the
 * CMMS RPC). Renders nothing until it actually has real data to show.
 */
const CmmsActivityWidget = ({ hasCmmsAccess, cmmsCompanyId, cmmsIsAdmin, onOpenCmms }) => {
  const [cmmsSummary, setCmmsSummary] = useState(null);
  const [smSummary, setSmSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const jobs = [];

      if (hasCmmsAccess && cmmsCompanyId) {
        jobs.push(
          supabase.rpc('fn_get_cmms_dashboard_summary', { p_company_id: cmmsCompanyId })
            .then(({ data }) => { if (!cancelled) setCmmsSummary(data || null); })
            .catch(() => { if (!cancelled) setCmmsSummary(null); })
        );
      } else if (!cancelled) {
        setCmmsSummary(null);
      }

      jobs.push(
        supabase.rpc('fn_get_supermarketa_dashboard_summary')
          .then(({ data }) => { if (!cancelled) setSmSummary(data || null); })
          .catch(() => { if (!cancelled) setSmSummary(null); })
      );

      await Promise.all(jobs);
      if (!cancelled) setLoading(false);
    };

    load();
    const poll = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [hasCmmsAccess, cmmsCompanyId]);

  const slides = useMemo(() => {
    const out = [];

    if (cmmsSummary) {
      out.push({
        key: 'cmms-snapshot',
        render: () => (
          <div>
            {/* Departments/Team are short plain counts, safe side by side.
                Inventory value gets its own full-width line below -- a
                currency string needs more room than a 3-way grid column
                could reliably give it, which was letting "UGX ..." spill
                past the card on narrower phones. */}
            <div className="grid grid-cols-2 divide-x divide-slate-800">
              <div className="flex flex-col gap-0.5 pr-3">
                <span className="text-2xl font-bold text-white leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.total_departments)}</span>
                <span className="text-[11px] text-slate-400">Departments</span>
              </div>
              <div className="flex flex-col gap-0.5 pl-3">
                <span className="text-2xl font-bold text-white leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.total_users)}</span>
                <span className="text-[11px] text-slate-400">Team</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800">
              <span className="text-xl font-bold text-white leading-none tabular-nums whitespace-nowrap">UGX {fmtShort(cmmsSummary.total_inventory_value)}</span>
              <span className="block text-[11px] text-slate-400 mt-0.5">Inventory value</span>
            </div>
          </div>
        )
      });

      out.push({
        key: 'cmms-inventory-health',
        render: () => (
          <div>
            <SectionLabel icon={AlertTriangle}>Inventory needs attention</SectionLabel>
            <div className="flex gap-6">
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-amber-400 leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.low_stock_items)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Low stock</p>
              </div>
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-red-400 leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.out_of_stock_items)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Out of stock</p>
              </div>
            </div>
          </div>
        )
      });

      out.push({
        key: 'cmms-requisitions',
        render: () => (
          <div>
            <SectionLabel icon={ClipboardList}>Requisitions awaiting approval</SectionLabel>
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-3xl font-bold text-white leading-none tabular-nums flex-shrink-0">{fmtShort(cmmsSummary.pending_requisitions)}</span>
              {cmmsSummary.urgent_requisitions > 0 && (
                <span className="text-[11px] font-semibold text-red-400 border border-red-500/30 rounded px-1.5 py-0.5 truncate">{fmtShort(cmmsSummary.urgent_requisitions)} urgent</span>
              )}
            </div>
            {cmmsIsAdmin && cmmsSummary.pending_requisitions > 0 && (
              <button
                onClick={() => onOpenCmms?.('approvals')}
                className="mt-3 flex items-center gap-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 active:scale-95 rounded-md px-3.5 py-1.5 transition"
              >
                Approve now <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )
      });

      out.push({
        key: 'cmms-payroll',
        render: () => (
          <div>
            <SectionLabel icon={Wallet}>Payroll</SectionLabel>
            <div className="flex gap-6">
              <div className="min-w-0">
                <span className="block text-xl font-bold text-emerald-400 leading-none tabular-nums whitespace-nowrap">UGX {fmtShort(cmmsSummary.salary_paid_today_ugx)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Paid today</p>
              </div>
              <div className="min-w-0">
                <span className="block text-xl font-bold text-amber-400 leading-none tabular-nums whitespace-nowrap">UGX {fmtShort(cmmsSummary.salary_owed_ugx)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">
                  Still owed{cmmsSummary.salary_owed_count > 0 ? ` (${fmtShort(cmmsSummary.salary_owed_count)})` : ''}
                </p>
              </div>
            </div>
          </div>
        )
      });

      out.push({
        key: 'cmms-staff-attendance',
        render: () => (
          <div>
            <SectionLabel icon={UserCheck}>Staff attendance today</SectionLabel>
            <div className="flex gap-6">
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-white leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.staff_checked_in_today)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Checked in</p>
              </div>
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-white leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.staff_checked_out_today)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Checked out</p>
              </div>
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-emerald-400 leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.staff_currently_on_site)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">On site now</p>
              </div>
            </div>
          </div>
        )
      });

      out.push({
        key: 'cmms-visitors',
        render: () => (
          <div>
            <SectionLabel icon={DoorOpen}>Visitors today</SectionLabel>
            <span className="block text-3xl font-bold text-white leading-none tabular-nums">{fmtShort(cmmsSummary.visitors_checked_in_today)}</span>
            <p className="text-[11px] text-slate-400 mt-1">Checked in at the front desk</p>
          </div>
        )
      });

      out.push({
        key: 'cmms-jobs',
        render: () => (
          <div>
            <SectionLabel icon={Briefcase}>
              {fmtShort(cmmsSummary.open_job_postings)} open job posting{cmmsSummary.open_job_postings === 1 ? '' : 's'}
            </SectionLabel>
            <div className="flex gap-6">
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-white leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.job_posting_views)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Views</p>
              </div>
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-white leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.job_applications_total)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Applicants</p>
              </div>
              {cmmsSummary.job_applications_today > 0 && (
                <div className="min-w-0">
                  <span className="block text-2xl font-bold text-emerald-400 leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.job_applications_today)}</span>
                  <p className="text-[11px] text-slate-400 mt-1 truncate">New today</p>
                </div>
              )}
            </div>
          </div>
        )
      });

      out.push({
        key: 'cmms-tasks',
        render: () => (
          <div>
            <SectionLabel icon={CheckSquare}>Tasks</SectionLabel>
            <div className="flex gap-6">
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-white leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.tasks_assigned_today)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Assigned today</p>
              </div>
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-emerald-400 leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.tasks_completed_today)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Completed today</p>
              </div>
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-slate-300 leading-none tabular-nums whitespace-nowrap">{fmtShort(cmmsSummary.tasks_open)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Still open</p>
              </div>
            </div>
          </div>
        )
      });

      out.push({
        key: 'cmms-reports',
        render: () => (
          <div>
            <SectionLabel icon={FileText}>Reports submitted today</SectionLabel>
            <div className="flex gap-6">
              <div className="min-w-0">
                <span className="block text-3xl font-bold text-white leading-none tabular-nums">{fmtShort(cmmsSummary.reports_submitted_today)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Submitted today</p>
              </div>
              <div className="min-w-0">
                <span className="block text-3xl font-bold text-amber-400 leading-none tabular-nums">{fmtShort(cmmsSummary.reports_open)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Still open</p>
              </div>
            </div>
          </div>
        )
      });

      out.push({
        key: 'cmms-transactions',
        render: () => (
          <div>
            <SectionLabel icon={ArrowLeftRight}>Transactions today</SectionLabel>
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-2xl font-bold text-white leading-none tabular-nums whitespace-nowrap">UGX {fmtShort(cmmsSummary.transactions_today_ugx)}</span>
              <span className="text-[11px] text-slate-400 truncate flex-shrink">{fmtShort(cmmsSummary.transactions_today_count)} transaction{cmmsSummary.transactions_today_count === 1 ? '' : 's'}</span>
            </div>
          </div>
        )
      });

      out.push({
        key: 'cmms-recent-activity',
        render: () => (
          <div>
            <SectionLabel icon={Activity}>Recent CMMS activity</SectionLabel>
            {cmmsSummary.recent_activity?.length > 0 ? (
              <ul className="space-y-2.5">
                {cmmsSummary.recent_activity.slice(0, 4).map((a, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0 mt-1.5" />
                    <span className="text-slate-200 flex-1 truncate">{a.description}</span>
                    <span className="text-[11px] text-slate-500 flex-shrink-0 tabular-nums">{relTime(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">No recent activity yet</p>
            )}
          </div>
        )
      });
    }

    if (smSummary) {
      const changePct = smSummary.yesterday_sales_ugx > 0
        ? ((smSummary.today_sales_ugx - smSummary.yesterday_sales_ugx) / smSummary.yesterday_sales_ugx) * 100
        : (smSummary.today_sales_ugx > 0 ? 100 : 0);

      out.push({
        key: 'sm-sales',
        render: () => (
          <div>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <SectionLabel icon={ShoppingCart}>
                {smSummary.supermarket_name || 'Supermarketa'} — today's sales
              </SectionLabel>
              <span className={`flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${
                changePct > 0 ? 'text-emerald-400 border-emerald-500/30' : changePct < 0 ? 'text-red-400 border-red-500/30' : 'text-slate-400 border-slate-600'
              }`}>
                {changePct > 0 ? <TrendingUp className="w-3 h-3" /> : changePct < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                {changePct > 0 ? '+' : ''}{changePct.toFixed(0)}%
              </span>
            </div>
            <div className="flex items-baseline gap-2 mb-2 min-w-0">
              <span className="text-2xl font-bold text-white leading-none tabular-nums whitespace-nowrap">UGX {fmtShort(smSummary.today_sales_ugx)}</span>
              <span className="text-[11px] text-slate-400 truncate flex-shrink">{fmtShort(smSummary.today_transactions_count)} sales vs yesterday</span>
            </div>
            {smSummary.last7days_sales?.length > 0 && (
              <div className="h-16">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 64 }}>
                  <BarChart data={smSummary.last7days_sales} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="day" tickFormatter={DAY_LABEL} tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<SmChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="total" radius={[2, 2, 0, 0]}>
                      {smSummary.last7days_sales.map((d, i) => (
                        <Cell key={i} fill={i === smSummary.last7days_sales.length - 1 ? '#10b981' : '#33415580'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )
      });

      out.push({
        key: 'sm-approvals',
        render: () => (
          <div>
            <SectionLabel icon={ClipboardList}>
              {smSummary.supermarket_name || 'Supermarketa'} — pending approvals
            </SectionLabel>
            <div className="flex gap-6">
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-white leading-none tabular-nums whitespace-nowrap">{fmtShort(smSummary.pending_purchase_orders)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Purchase orders</p>
              </div>
              <div className="min-w-0">
                <span className="block text-2xl font-bold text-white leading-none tabular-nums whitespace-nowrap">{fmtShort(smSummary.pending_supplier_applications)}</span>
                <p className="text-[11px] text-slate-400 mt-1 truncate">Supplier applications</p>
              </div>
            </div>
            <p className="mt-2.5 text-[11px] text-slate-500">Review these in your Supermarketa manager portal.</p>
          </div>
        )
      });
    }

    return out;
  }, [cmmsSummary, smSummary, cmmsIsAdmin, onOpenCmms]);

  const intervalRef = useRef(null);
  const touchStartRef = useRef(null);

  useEffect(() => {
    setSlideIndex(0);
  }, [slides.length]);

  // Auto-advance, but restarted from zero on every manual swipe/tap so a
  // slide someone just picked isn't yanked away a moment later.
  const restartAutoAdvance = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (slides.length <= 1) return;
    intervalRef.current = setInterval(() => setSlideIndex((i) => (i + 1) % slides.length), 4500);
  };

  useEffect(() => {
    restartAutoAdvance();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  const goToSlide = (i) => {
    setSlideIndex(((i % slides.length) + slides.length) % slides.length);
    restartAutoAdvance();
  };

  const handleTouchStart = (e) => {
    touchStartRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStartRef.current == null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current;
    touchStartRef.current = null;
    if (Math.abs(deltaX) < 35) return; // treat as a tap, not a swipe
    goToSlide(slideIndex + (deltaX < 0 ? 1 : -1));
  };

  if (loading || slides.length === 0) return null;

  const urgentCount =
    (cmmsIsAdmin ? (cmmsSummary?.urgent_requisitions || 0) : 0) +
    (smSummary?.pending_purchase_orders || 0) +
    (smSummary?.pending_supplier_applications || 0);
  const urgent = urgentCount > 0;

  return (
    // A theme-aware colored panel (dash-card-blue, see index.css) instead
    // of a flat bg-slate-900 surface -- plain Tailwind slate/gray classes
    // get force-flattened to a single color by ThemeContext's dynamic
    // override stylesheet, which is why this used to render as a colorless
    // white/gray box in every theme. dash-card-blue tints the theme's own
    // bg/bgSecondary CSS vars instead of fighting that override, so it
    // stays legible and on-brand in light, dark, and every custom theme.
    <div
      className="dash-card dash-card-blue mx-4 mt-4"
      style={urgent
        ? { paddingTop: 0, borderLeftColor: '#f59e0b', borderLeftWidth: '3px' }
        : { paddingTop: 0 }}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="w-4 h-4 flex-shrink-0" style={{ color: '#3b82f6' }} />
          <h3 className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: 'var(--color-textSecondary)' }}>Business Activity</h3>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {urgent && (
            <span className="text-[11px] font-semibold text-amber-400 whitespace-nowrap">
              {fmtShort(urgentCount)} <span className="hidden min-[400px]:inline">pending</span>
            </span>
          )}
          {hasCmmsAccess && (
            <button
              onClick={() => onOpenCmms?.()}
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
            >
              Open CMMS <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Swipeable slide area -- touch-action: pan-y lets the page still
          scroll vertically while horizontal drags are read as slide swipes. */}
      <div
        className="relative select-none px-4 py-4"
        style={{ touchAction: 'pan-y' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {slides.length > 1 && (
          <button
            onClick={() => goToSlide(slideIndex - 1)}
            aria-label="Previous"
            className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 items-center justify-center w-6 h-6 rounded text-slate-500 hover:text-slate-300 transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}

        <div key={slides[slideIndex % slides.length].key} className="animate-[fadein_0.4s_ease-out] min-h-[92px]">
          {slides[slideIndex % slides.length].render()}
        </div>

        {slides.length > 1 && (
          <>
            <button
              onClick={() => goToSlide(slideIndex + 1)}
              aria-label="Next"
              className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 items-center justify-center w-6 h-6 rounded text-slate-500 hover:text-slate-300 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="absolute top-0 right-4 text-[10px] text-slate-600 tabular-nums">
              {slideIndex + 1}/{slides.length}
            </span>
          </>
        )}
      </div>

      <style>{`
        @keyframes fadein { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
};

export default CmmsActivityWidget;
