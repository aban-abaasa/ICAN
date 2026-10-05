import React, { useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';
import { CATEGORIES, CATEGORY_KEYS } from '../../../utils/growthOptimizer';
import { DayChips, Field, Segmented, Switch } from './parts';

const REMIND_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440];
const remindLabel = (m) => {
  if (m === 0) return 'At start time';
  if (m === 1440) return '1 day before';
  if (m >= 60) return `${m / 60} hour${m === 60 ? '' : 's'} before`;
  return `${m} min before`;
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fromItem = (item) => ({
  title: item.title,
  category: item.category,
  notes: item.notes || '',
  recurrence: item.recurrence,
  days_of_week: item.days_of_week?.length ? [...item.days_of_week] : [1, 2, 3, 4, 5],
  on_date: item.on_date || todayIso(),
  start_time: String(item.start_time).slice(0, 5),
  duration_minutes: item.duration_minutes,
  remind_before_minutes: item.remind_before_minutes,
  reminders_enabled: item.reminders_enabled,
});

const EMPTY = {
  title: '', category: 'custom', notes: '', recurrence: 'weekly', days_of_week: [1, 2, 3, 4, 5], on_date: todayIso(),
  start_time: '09:00', duration_minutes: 60, remind_before_minutes: 10, reminders_enabled: true,
};

/** Add or edit one time block. `onSubmit` returns a promise; a rejection is shown inline. */
export default function BlockForm({ item, onSubmit, onCancel }) {
  const [values, setValues] = useState(item ? fromItem(item) : EMPTY);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (patch) => setValues((v) => ({ ...v, ...patch }));

  const validate = () => {
    if (!values.title.trim()) return 'Give this block a name.';
    if (values.recurrence === 'weekly' && values.days_of_week.length === 0) return 'Choose at least one day.';
    if (values.recurrence === 'once' && !values.on_date) return 'Choose a date.';
    if (!values.start_time) return 'Choose a start time.';
    const d = Number(values.duration_minutes);
    if (!Number.isFinite(d) || d < 5 || d > 720) return 'Length must be between 5 minutes and 12 hours.';
    return '';
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError('');
    setSaving(true);
    try {
      await onSubmit({ ...values, title: values.title.trim(), duration_minutes: Number(values.duration_minutes) });
    } catch (err) {
      setError(err.message || 'Could not save this block.');
      setSaving(false);
    }
  };

  return (
    <form className="gr-card gr-form" onSubmit={submit} noValidate aria-label={item ? 'Edit block' : 'New block'}>
      <div className="gr-sectionhead">
        <h3 className="gr-title gr-h">{item ? 'Edit block' : 'New block'}</h3>
        <button type="button" className="gr-icon-btn" onClick={onCancel} aria-label="Close form"><X aria-hidden="true" /></button>
      </div>

      <Field label="Name" htmlFor="gr-f-title">
        <input id="gr-f-title" className="gr-input" value={values.title} maxLength={120} autoFocus={!item}
          aria-invalid={Boolean(error) && !values.title.trim()} placeholder="e.g. Morning prayer, Deep work, Gym"
          onChange={(e) => set({ title: e.target.value })} />
      </Field>

      <Field label="Kind" htmlFor="gr-f-cat">
        <select id="gr-f-cat" className="gr-select" value={values.category} onChange={(e) => set({ category: e.target.value })}>
          {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
        </select>
      </Field>

      <Field label="Repeats">
        <Segmented label="Repeats" value={values.recurrence} onChange={(recurrence) => set({ recurrence })}
          options={[{ value: 'weekly', label: 'Every week' }, { value: 'once', label: 'One time' }]} />
      </Field>

      {values.recurrence === 'weekly' ? (
        <Field label="On">
          <DayChips value={values.days_of_week} onChange={(days_of_week) => set({ days_of_week })} />
        </Field>
      ) : (
        <Field label="Date" htmlFor="gr-f-date">
          <input id="gr-f-date" className="gr-input" type="date" min={todayIso()} value={values.on_date}
            onChange={(e) => set({ on_date: e.target.value })} />
        </Field>
      )}

      <div className="gr-grid2">
        <Field label="Starts" htmlFor="gr-f-start">
          <input id="gr-f-start" className="gr-input" type="time" value={values.start_time} onChange={(e) => set({ start_time: e.target.value })} />
        </Field>
        <Field label="Length (min)" htmlFor="gr-f-len">
          <input id="gr-f-len" className="gr-input" type="number" inputMode="numeric" min={5} max={720} step={5}
            value={values.duration_minutes} onChange={(e) => set({ duration_minutes: e.target.value })} />
        </Field>
      </div>

      <Switch checked={values.reminders_enabled} onChange={(reminders_enabled) => set({ reminders_enabled })}>
        Remind me about this block
      </Switch>
      {values.reminders_enabled && (
        <Field label="Remind me" htmlFor="gr-f-remind">
          <select id="gr-f-remind" className="gr-select" value={values.remind_before_minutes}
            onChange={(e) => set({ remind_before_minutes: Number(e.target.value) })}>
            {REMIND_OPTIONS.map((m) => <option key={m} value={m}>{remindLabel(m)}</option>)}
          </select>
        </Field>
      )}

      <Field label="Notes (optional)" htmlFor="gr-f-notes">
        <textarea id="gr-f-notes" className="gr-textarea" maxLength={1000} value={values.notes}
          placeholder="What does a good session look like?" onChange={(e) => set({ notes: e.target.value })} />
      </Field>

      {error && <div className="gr-alert gr-alert--err" role="alert">{error}</div>}

      <div className="gr-grid2">
        <button type="button" className="gr-btn gr-btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="gr-btn gr-btn--primary" disabled={saving}>
          {saving ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          {item ? 'Save changes' : 'Add block'}
        </button>
      </div>
    </form>
  );
}
