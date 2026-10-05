import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, CalendarDays, Wand2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  DEFAULT_PREFERENCES, PILLARS, buildScheduleData, itemsToBlocks, normalizePreferences, optimizeWeek,
  scoreBlocks, weakestPillar,
} from '../../utils/growthOptimizer';
import {
  blockToItemInput, clearGrowthNotifications, createScheduleItem, createScheduleItems, deleteGrowthNotification,
  deleteScheduleItem, getCurrentUserId, isBackendMissing, listGrowthNotifications, listScheduleItems, loadGrowthProfile,
  markAllGrowthNotificationsRead, markGrowthNotificationRead, saveGrowthProfile, sendTestReminder,
  subscribeToGrowthNotifications, updateScheduleItem,
} from '../../services/growthScheduleService';
import AlertsTab from './growth/AlertsTab';
import PlanTab from './growth/PlanTab';
import ScheduleTab from './growth/ScheduleTab';
import { PillarBars, ScoreRing } from './growth/parts';
import './growth/growth.css';

const NUDGES = {
  value: 'protect a deep-work block in your peak hours',
  spiritual: 'set aside a few quiet minutes each morning',
  physical: 'schedule up to three workouts a week',
  recovery: 'protect a bedtime that gives you 7+ hours of sleep',
  planning: 'close the week with a short review and one networking call',
};
const ZERO = { value: 0, spiritual: 0, physical: 0, recovery: 0, planning: 0 };
const BACKEND_MISSING_TEXT = 'Saving, reminders and alerts are not switched on for this server yet. You can still design a plan here. '
  + 'An administrator needs to apply the growth scheduler migration.';

const sortItems = (rows) => [...rows].sort((a, b) =>
  String(a.start_time).localeCompare(String(b.start_time)) || String(a.created_at).localeCompare(String(b.created_at)));

/**
 * Prosperity Architect: design a week that creates value while keeping spiritual and
 * physical alignment, put it on a real schedule, and get reminded.
 * Self-contained (Supabase + notifications). `onScheduleData` lets a host dashboard
 * mirror the result as { optimizationScore, recommendations[], nextActions[] }.
 */
export default function GrowthPanel({ onScheduleData }) {
  const { user } = useAuth();
  const [userId, setUserId] = useState(user?.id || null);
  const [tab, setTab] = useState('plan');
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [plan, setPlan] = useState(null); // { blocks, score, notes }
  const [items, setItems] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backendReady, setBackendReady] = useState(true);
  const [busy, setBusy] = useState({ optimizing: false, adding: false });
  const [remindBefore, setRemindBefore] = useState(10);
  const [banner, setBanner] = useState(null); // { kind: 'err' | 'warn' | 'ok', text }
  const [toast, setToast] = useState(null); // { title, text }

  const failure = useCallback((err) => {
    if (isBackendMissing(err)) setBackendReady(false);
    else setBanner({ kind: 'err', text: err.message || 'Something went wrong. Please try again.' });
  }, []);

  useEffect(() => {
    if (userId) return;
    getCurrentUserId().then(setUserId).catch(() => {});
  }, [userId]);

  // Initial load from Supabase.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [profile, rows, inbox] = await Promise.all([loadGrowthProfile(), listScheduleItems(), listGrowthNotifications()]);
        if (cancelled) return;
        if (profile?.preferences && Object.keys(profile.preferences).length) {
          setPreferences(normalizePreferences(profile.preferences).preferences);
        }
        const saved = profile?.lastOptimization;
        if (saved?.blocks?.length && saved?.score) setPlan({ blocks: saved.blocks, score: saved.score, notes: saved.notes || [] });
        setItems(sortItems(rows));
        setNotifications(inbox);
      } catch (err) {
        if (!cancelled) failure(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [failure]);

  // Live reminders while the panel is open.
  useEffect(() => {
    if (!userId) return undefined;
    return subscribeToGrowthNotifications(userId, (row) => {
      setNotifications((prev) => (prev.some((n) => n.id === row.id) ? prev : [row, ...prev]));
      setToast({ title: row.title, text: row.message });
      listScheduleItems().then((rows) => setItems(sortItems(rows))).catch(() => {});
    });
  }, [userId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(timer);
  }, [toast]);

  // What is actually on the calendar drives the score; the plan shows what is possible.
  const scheduleScore = useMemo(() => scoreBlocks(itemsToBlocks(items), preferences), [items, preferences]);
  const hasSchedule = items.some((i) => i.is_active && i.recurrence === 'weekly');
  const hero = hasSchedule ? scheduleScore : plan?.score || null;
  const heroLabel = hasSchedule ? 'Schedule score' : plan ? 'Plan potential' : 'Not started';

  useEffect(() => {
    if (!onScheduleData || loading || !hero) return;
    onScheduleData(buildScheduleData({ blocks: plan?.blocks || itemsToBlocks(items), score: hero, items }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, plan, loading]);

  const handleOptimize = async () => {
    setBusy((b) => ({ ...b, optimizing: true }));
    setBanner(null);
    const result = optimizeWeek(preferences);
    const score = scoreBlocks(result.blocks, result.preferences);
    setPreferences(result.preferences);
    setPlan({ blocks: result.blocks, score, notes: result.notes });
    requestAnimationFrame(() => document.getElementById('gr-plan-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    if (backendReady) {
      try {
        await saveGrowthProfile({
          preferences: result.preferences,
          optimization: { blocks: result.blocks, score, notes: result.notes, generatedAt: new Date().toISOString() },
          score: score.overall,
        });
      } catch (err) {
        if (isBackendMissing(err)) setBackendReady(false);
        else setBanner({ kind: 'warn', text: `Your plan is ready, but it could not be saved: ${err.message}` });
      }
    }
    setBusy((b) => ({ ...b, optimizing: false }));
  };

  const handleAddBlocks = async (blocks) => {
    setBusy((b) => ({ ...b, adding: true }));
    setBanner(null);
    try {
      const created = await createScheduleItems(blocks.map((b) => blockToItemInput(b, { remindBefore })));
      setItems((prev) => sortItems([...prev, ...created]));
      setToast({
        title: `${created.length} block${created.length === 1 ? '' : 's'} added to your schedule`,
        text: 'Reminders are on. Check the Schedule and Alerts tabs.',
      });
    } catch (err) {
      failure(err);
    }
    setBusy((b) => ({ ...b, adding: false }));
  };

  const handleCreate = async (values) => {
    const row = await createScheduleItem(values);
    setItems((prev) => sortItems([...prev, row]));
  };
  const handleUpdate = async (id, patch) => {
    const row = await updateScheduleItem(id, patch);
    setItems((prev) => sortItems(prev.map((i) => (i.id === id ? row : i))));
  };
  const handleDelete = async (id) => {
    await deleteScheduleItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleMarkRead = (id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    markGrowthNotificationRead(id).catch(failure);
  };
  const handleMarkAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    markAllGrowthNotificationsRead().catch(failure);
  };
  const handleDeleteNotification = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    deleteGrowthNotification(id).catch(failure);
  };
  const handleClear = () => {
    setNotifications([]);
    clearGrowthNotifications().catch(failure);
  };
  const handleTest = async () => {
    await sendTestReminder();
  };

  const unread = notifications.filter((n) => !n.is_read).length;
  const weak = hero ? weakestPillar(hero.breakdown) : null;

  const tabs = [
    { id: 'plan', label: 'Plan', Icon: Wand2 },
    { id: 'schedule', label: 'Schedule', Icon: CalendarDays, count: items.length || null },
    { id: 'alerts', label: 'Alerts', Icon: Bell, count: unread || null },
  ];
  const onTabKey = (e) => {
    const i = tabs.findIndex((t) => t.id === tab);
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i + tabs.length - 1) % tabs.length] : null;
    if (next) { e.preventDefault(); setTab(next.id); document.getElementById(`gr-tab-${next.id}`)?.focus(); }
  };

  return (
    <section className="gr" aria-label="Prosperity Architect">
      <header className="gr-card gr-hero">
        <div className="gr-hero__top">
          <ScoreRing value={hero ? hero.overall : 0} label={heroLabel} />
          <div className="gr-hero__copy">
            <p className="gr-eyebrow">Human capital</p>
            <h2 className="gr-title">Prosperity Architect</h2>
            <p className="gr-small">{heroLabel}</p>
            <p className="gr-nudge">
              {!hero && 'Design a week that creates value while keeping you spiritually and physically aligned.'}
              {hero && weak.value >= 90 && 'Beautifully balanced. Keep your reminders on and review every Friday.'}
              {hero && weak.value < 90 && (<>Biggest opportunity: <b>{PILLARS[weak.key].label}</b> ({weak.value}). Try to {NUDGES[weak.key]}.</>)}
            </p>
          </div>
        </div>
        <PillarBars breakdown={hero ? hero.breakdown : ZERO} />
      </header>

      {!backendReady && (
        <div className="gr-alert gr-alert--warn" role="status"><AlertTriangle aria-hidden="true" /><span>{BACKEND_MISSING_TEXT}</span></div>
      )}
      {banner && (
        <div className={`gr-alert gr-alert--${banner.kind === 'err' ? 'err' : banner.kind === 'ok' ? 'ok' : 'warn'}`} role="alert">
          <AlertTriangle aria-hidden="true" /><span>{banner.text}</span>
          <button type="button" className="gr-icon-btn gr-alert__x" style={{ width: 32, height: 32 }} onClick={() => setBanner(null)} aria-label="Dismiss"><X aria-hidden="true" /></button>
        </div>
      )}

      <div className="gr-tabs" role="tablist" aria-label="Prosperity Architect sections" onKeyDown={onTabKey}>
        {tabs.map(({ id, label, Icon, count }) => (
          <button key={id} id={`gr-tab-${id}`} type="button" role="tab" className="gr-tab" aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>
            <Icon aria-hidden="true" />{label}{count ? <span className="gr-badge">{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'plan' && (
        <PlanTab preferences={preferences} setPreferences={setPreferences} plan={plan} items={items} busy={busy}
          onOptimize={handleOptimize} onAddBlocks={handleAddBlocks} remindBefore={remindBefore}
          setRemindBefore={setRemindBefore} backendReady={backendReady} />
      )}
      {tab === 'schedule' && (
        <ScheduleTab items={items} loading={loading} backendReady={backendReady} onCreate={handleCreate}
          onUpdate={handleUpdate} onDelete={handleDelete} onGoToPlan={() => setTab('plan')} />
      )}
      {tab === 'alerts' && (
        <AlertsTab items={items} notifications={notifications} loading={loading} backendReady={backendReady}
          onMarkRead={handleMarkRead} onMarkAllRead={handleMarkAllRead} onDelete={handleDeleteNotification}
          onClear={handleClear} onTest={handleTest} />
      )}

      {toast && (
        <div className="gr-toast" role="status">
          <Bell aria-hidden="true" />
          <div><b>{toast.title}</b><span>{toast.text}</span></div>
          <button type="button" className="gr-icon-btn" style={{ width: 32, height: 32, marginLeft: 'auto' }} onClick={() => setToast(null)} aria-label="Dismiss"><X aria-hidden="true" /></button>
        </div>
      )}
    </section>
  );
}
