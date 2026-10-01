import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import {
  calculateLiveShareValue,
  getBusinessTransactionsByContributor,
} from '../services/pitchinValuationService';

// Live figures for the investor-pitch plan: the real share price/valuation
// (same engine Pitchin uses), CMMS inventory, CMMS reports and every recorded
// business transaction. Refreshes the moment any of those tables change
// (Supabase realtime) and re-checks once a minute while the plan is open, so
// it still updates if realtime isn't enabled on a table. Free-plan friendly:
// one channel, debounced refreshes, no polling while the tab is hidden.
const POLL_MS = 60_000;
const DEBOUNCE_MS = 1_500;

const emptyLive = {
  valuation: null,
  inventory: { items: [], count: 0, valueUgx: 0, lowStock: 0 },
  reports: { total: 0, open: 0, resolved: 0, recent: [] },
  transactions: { count: 0, netUgx: 0, recent: [] },
};

export default function usePitchPlanLiveData({ businessProfileId, ownerUserId, cmmsCompanyId, enabled = true }) {
  const [live, setLive] = useState(emptyLive);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [tick, setTick] = useState(0); // bumps on every refresh so the UI can flash "just updated"
  const inFlight = useRef(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!businessProfileId || inFlight.current) return;
    inFlight.current = true;
    try {
      const [valuation, inv, rep, tx, issued] = await Promise.all([
        calculateLiveShareValue(businessProfileId, ownerUserId, { saveSnapshot: false }).catch((e) => {
          console.warn('[PlanLive] valuation failed:', e.message);
          return null;
        }),
        cmmsCompanyId
          ? supabase.rpc('fn_get_company_inventory', { p_company_id: cmmsCompanyId }).then((r) => r.data || [])
          : Promise.resolve([]),
        cmmsCompanyId
          ? supabase
              .from('cmms_company_reports')
              .select('id, report_title, report_category, severity, status, created_at')
              .eq('cmms_company_id', cmmsCompanyId)
              .order('created_at', { ascending: false })
              .limit(200)
              .then((r) => r.data || [])
          : Promise.resolve([]),
        getBusinessTransactionsByContributor(businessProfileId),
        supabase.rpc('fn_get_business_issued_shares', { p_business_profile_id: businessProfileId }).then((r) => parseInt(r.data) || 0, () => 0),
      ]);

      const items = (inv || []).map((i) => {
        const qty = parseFloat(i.quantity_in_stock ?? i.current_stock ?? i.quantity) || 0;
        const price = parseFloat(i.unit_price ?? i.unit_cost ?? i.cost_per_unit) || 0;
        return {
          id: i.id,
          name: i.item_name,
          category: i.category,
          qty,
          price,
          value: qty * price,
          low: i.reorder_level != null && qty <= parseFloat(i.reorder_level),
        };
      });
      const inventory = {
        items,
        count: items.length,
        valueUgx: items.reduce((s, i) => s + i.value, 0),
        lowStock: items.filter((i) => i.low).length,
        lowItems: items.filter((i) => i.low).slice(0, 5).map((i) => i.name),
        topCategories: Object.entries(items.reduce((m, i) => { const k = i.category || 'General'; m[k] = (m[k] || 0) + i.value; return m; }, {}))
          .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name),
      };

      const reports = {
        total: rep.length,
        open: rep.filter((r) => r.status === 'open' || r.status === 'in_review').length,
        resolved: rep.filter((r) => r.status === 'resolved' || r.status === 'closed').length,
        recent: rep.slice(0, 5),
        critical: rep.filter((r) => (r.severity === 'high' || r.severity === 'critical') && r.status !== 'resolved' && r.status !== 'closed').length,
        openCategories: Object.entries(rep.filter((r) => r.status === 'open' || r.status === 'in_review').reduce((m, r) => { m[r.report_category] = (m[r.report_category] || 0) + 1; return m; }, {}))
          .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} (${n})`),
      };

      const allEntries = (tx.contributors || [])
        .flatMap((c) => c.entries || [])
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const transactions = {
        count: allEntries.length,
        netUgx: (tx.contributors || []).reduce((s, c) => s + c.netUgx, 0),
        recent: allEntries.slice(0, 6),
      };

      setLive({ valuation, inventory, reports, transactions, sharesIssued: issued });
      setUpdatedAt(new Date());
      setTick((t) => t + 1);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [businessProfileId, ownerUserId, cmmsCompanyId]);

  const refreshSoon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    if (!enabled || !businessProfileId) return undefined;
    setLoading(true);
    load();

    const channel = supabase.channel(`pitch-plan-live-${businessProfileId}`);
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'ican_transactions', filter: `business_profile_id=eq.${businessProfileId}` }, refreshSoon);
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'business_profiles', filter: `id=eq.${businessProfileId}` }, refreshSoon);
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'investor_shares', filter: `business_profile_id=eq.${businessProfileId}` }, refreshSoon);
    if (cmmsCompanyId) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'cmms_inventory_items', filter: `cmms_company_id=eq.${cmmsCompanyId}` }, refreshSoon);
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'cmms_company_reports', filter: `cmms_company_id=eq.${cmmsCompanyId}` }, refreshSoon);
    }
    channel.subscribe();

    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);

    return () => {
      clearTimeout(timer.current);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [enabled, businessProfileId, cmmsCompanyId, load, refreshSoon]);

  return { live, loading, updatedAt, tick, refresh: load };
}
