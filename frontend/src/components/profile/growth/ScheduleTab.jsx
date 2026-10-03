import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Pencil, Trash2, Pause, Play, Bell, BellOff, Clock, CalendarDays, ChevronDown, Loader2,
} from 'lucide-react';
import { DAY_SHORT, describeDays, formatDuration, formatRange } from '../../../utils/growthOptimizer';
import BlockForm from './BlockForm';
import { CATEGORY_ICONS, DAY_ORDER, DayDots, WeekGrid, pillarOf } from './parts';

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Monday of the current week, then the seven dates Monday..Sunday.
const currentWeek = () => {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return DAY_ORDER.map((dow, i) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return { dow, date, iso: isoOf(date) };
  });
};

const occursOn = (item, dow, iso) => (item.recurrence === 'weekly' ? item.days_of_week.includes(dow) : item.on_date === iso);

const whenText = (item) => {
  if (item.recurrence === 'weekly') return describeDays(item.days_of_week);
  const [y, m, d] = String(item.on_date).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

const reminderText = (item) => {
  if (!item.reminders_enabled) return 'No reminder';
  const m = item.remind_before_minutes;
  if (m === 0) return 'Reminds at start';
  if (m >= 1440) return 'Reminds 1 day before';
  return m >= 60 ? `Reminds ${m / 60} h before` : `Reminds ${m} min before`;
};

const nextText = (item) => {
  if (!item.is_active || !item.reminders_enabled || !item.next_start_at) return null;
  return new Date(item.next_start_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

function BlockCard({ item, confirming, onConfirm, onEdit, onToggle, onDelete, working }) {
  const Icon = CATEGORY_ICONS[item.category] || CATEGORY_ICONS.custom;
  const start = String(item.start_time).slice(0, 5);
  const next = nextText(item);
  return (
    <article className={`gr-block ${item.is_active ? '' : 'is-paused'}`} data-pillar={pillarOf(item.category)}>
      <div className="gr-block__head">
        <h4 className="gr-block__title"><Icon aria-hidden="true" /><span>{item.title}</span></h4>
        {!item.is_active && <span className="gr-chip gr-chip--warn">Paused</span>}
      </div>
      <div className="gr-block__meta">
        <span><Clock aria-hidden="true" />{formatRange(start, item.duration_minutes)}</span>
        <span>{formatDuration(item.duration_minutes)}</span>
        <span><CalendarDays aria-hidden="true" />{whenText(item)}</span>
      </div>
      <div className="gr-block__meta">
        <span>{item.reminders_enabled ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}{reminderText(item)}</span>
        {next && <span>Next reminder: {next}</span>}
      </div>
      {item.notes && <p className="gr-block__why">{item.notes}</p>}
      <div className="gr-block__foot">
        {item.recurrence === 'weekly' ? <DayDots days={item.days_of_week} /> : <span />}
        {confirming ? (
          <div className="gr-block__actions" role="group" aria-label={`Delete ${item.title}?`}>
            <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={() => onConfirm(null)}>Keep</button>
            <button type="button" className="gr-btn gr-btn--danger gr-btn--sm" disabled={working} onClick={() => onDelete(item)}>
              {working ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}Delete
            </button>
          </div>
        ) : (
          <div className="gr-block__actions">
            <button type="button" className="gr-icon-btn" disabled={working} onClick={() => onToggle(item)}
              aria-label={item.is_active ? `Pause ${item.title}` : `Resume ${item.title}`} title={item.is_active ? 'Pause' : 'Resume'}>
              {item.is_active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </button>
            <button type="button" className="gr-icon-btn" onClick={() => onEdit(item)} aria-label={`Edit ${item.title}`} title="Edit">
              <Pencil aria-hidden="true" />
            </button>
            <button type="button" className="gr-icon-btn gr-icon-btn--danger" onClick={() => onConfirm(item.id)}
              aria-label={`Delete ${item.title}`} title="Delete">
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export default function ScheduleTab({ items, loading, backendReady, onCreate, onUpdate, onDelete, onGoToPlan }) {
  const week = useMemo(currentWeek, []);
  const todayIso = isoOf(new Date());
  const [selected, setSelected] = useState(() => week.find((w) => w.iso === todayIso)?.dow ?? 1);
  const [form, setForm] = useState(null); // null | { item?: Item }
  const [confirmId, setConfirmId] = useState(null);
  const [workingId, setWorkingId] = useState(null);
  const [actionError, setActionError] = useState('');
  // On wide screens the day agenda is replaced by the week grid, so the full list
  // (the place to edit, pause and delete) starts open there and folded on phones.
  const [listOpen, setListOpen] = useState(() => typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(min-width: 720px)').matches));
  const formRef = useRef(null);

  useEffect(() => {
    if (form && formRef.current) formRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [form]);

  const selectedDay = week.find((w) => w.dow === selected) || week[0];
  const dayItems = items
    .filter((i) => occursOn(i, selectedDay.dow, selectedDay.iso))
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));

  const gridBlocks = items.flatMap((i) => {
    const base = { id: i.id, title: i.title, category: i.category, startTime: String(i.start_time).slice(0, 5), durationMinutes: i.duration_minutes, paused: !i.is_active };
    if (i.recurrence === 'weekly') return [{ ...base, daysOfWeek: i.days_of_week }];
    const day = week.find((w) => w.iso === i.on_date);
    return day ? [{ ...base, daysOfWeek: [day.dow] }] : [];
  });

  const run = async (id, fn) => {
    setWorkingId(id);
    setActionError('');
    try { await fn(); } catch (err) { setActionError(err.message || 'That did not work. Please try again.'); }
    setWorkingId(null);
  };

  const handleSubmit = async (values) => {
    if (form?.item) await onUpdate(form.item.id, values);
    else await onCreate(values);
    setForm(null);
  };
  const handleToggle = (item) => run(item.id, () => onUpdate(item.id, { is_active: !item.is_active }));
  const handleDelete = (item) => run(item.id, async () => { await onDelete(item.id); setConfirmId(null); });

  const card = (item) => (
    <BlockCard key={item.id} item={item} confirming={confirmId === item.id} onConfirm={setConfirmId}
      onEdit={(it) => setForm({ item: it })} onToggle={handleToggle} onDelete={handleDelete} working={workingId === item.id} />
  );

  return (
    <div className="gr-form" role="tabpanel" aria-label="Schedule">
      <div className="gr-sectionhead">
        <div>
          <p className="gr-eyebrow">This week</p>
          <h3 className="gr-title gr-h">Your schedule</h3>
        </div>
        <button type="button" className="gr-btn gr-btn--primary gr-btn--sm" disabled={!backendReady} onClick={() => setForm({})}>
          <Plus aria-hidden="true" />Add block
        </button>
      </div>

      {form && (
        <div ref={formRef}>
          <BlockForm key={form.item?.id || 'new'} item={form.item} onSubmit={handleSubmit} onCancel={() => setForm(null)} />
        </div>
      )}

      {actionError && <div className="gr-alert gr-alert--err" role="alert">{actionError}</div>}

      {loading ? (
        <><div className="gr-skel" /><div className="gr-skel" /></>
      ) : items.length === 0 ? (
        <div className="gr-card gr-empty">
          <CalendarDays aria-hidden="true" />
          <h4 className="gr-title">Nothing scheduled yet</h4>
          <p className="gr-sub">Let the Architect design your week, or add your first block by hand.</p>
          <div className="gr-row-actions">
            <button type="button" className="gr-btn gr-btn--primary gr-btn--sm" onClick={onGoToPlan}>Design my week</button>
            <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" disabled={!backendReady} onClick={() => setForm({})}>Add a block</button>
          </div>
        </div>
      ) : (
        <>
          {/* Wide screens: the whole week at a glance */}
          <div className="gr-card gr-week-card" style={{ padding: 8 }}>
            <WeekGrid blocks={gridBlocks} today={new Date().getDay()} />
          </div>

          {/* Phones: one day at a time */}
          <div className="gr-agenda gr-agenda--phone">
            <div className="gr-daypick" role="group" aria-label="Choose a day">
              {week.map((w) => (
                <button key={w.dow} type="button" aria-pressed={w.dow === selected}
                  className={w.iso === todayIso ? 'is-today' : ''} onClick={() => setSelected(w.dow)}
                  aria-label={`${w.date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}${w.iso === todayIso ? ', today' : ''}`}>
                  {DAY_SHORT[w.dow]}<b>{w.date.getDate()}</b>
                </button>
              ))}
            </div>
            {dayItems.length === 0
              ? <p className="gr-sub" style={{ textAlign: 'center', padding: '14px 0' }}>Nothing planned for {selectedDay.date.toLocaleDateString([], { weekday: 'long' })}. A clear day is also a plan.</p>
              : <div className="gr-list">{dayItems.map(card)}</div>}
          </div>

          <details className="gr-card gr-fold" open={listOpen} onToggle={(e) => setListOpen(e.currentTarget.open)}>
            <summary>
              <span className="gr-title gr-h">All blocks <span className="gr-small">({items.length})</span></span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <div className="gr-fold__body gr-list">{items.map(card)}</div>
          </details>
        </>
      )}
    </div>
  );
}
