import React, { useState } from 'react';
import { Wand2, ChevronDown, CalendarPlus, Check, Clock, Bell, Loader2, Info } from 'lucide-react';
import { describeDays, formatDuration, formatRange, isBlockScheduled } from '../../../utils/growthOptimizer';
import {
  CATEGORY_ICONS, DayChips, DayDots, Field, Segmented, Stepper, Switch, WeekGrid, pillarOf,
} from './parts';

const CHRONOTYPES = [
  { value: 'morning', label: 'Early bird', hint: 'Sharpest before noon' },
  { value: 'variable', label: 'Steady', hint: 'Mid-morning focus' },
  { value: 'evening', label: 'Night owl', hint: 'Peaks in the afternoon' },
];
const REMIND_OPTIONS = [0, 5, 10, 15, 30, 60];

const remindLabel = (m) => (m === 0 ? 'At start time' : m === 60 ? '1 hour before' : `${m} min before`);

export default function PlanTab({
  preferences, setPreferences, plan, items, busy, onOptimize, onAddBlocks, remindBefore, setRemindBefore, backendReady,
}) {
  const [rhythmOpen, setRhythmOpen] = useState(!plan);
  const set = (patch) => setPreferences({ ...preferences, ...patch });
  const pending = plan ? plan.blocks.filter((b) => !isBlockScheduled(b, items)) : [];

  return (
    <div className="gr-form" role="tabpanel" aria-label="Plan">
      <details className="gr-card gr-fold" open={rhythmOpen} onToggle={(e) => setRhythmOpen(e.currentTarget.open)}>
        <summary>
          <span>
            <span className="gr-eyebrow">Step 1</span>
            <span className="gr-title gr-h" style={{ display: 'block' }}>Your rhythm</span>
          </span>
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="gr-fold__body gr-form">
          <Field label="When are you sharpest?">
            <Segmented label="Chronotype" value={preferences.chronotype} onChange={(v) => set({ chronotype: v })} options={CHRONOTYPES} />
          </Field>

          <div className="gr-grid2">
            <Field label="Wake up" htmlFor="gr-wake">
              <input id="gr-wake" className="gr-input" type="time" value={preferences.wakeTime} onChange={(e) => set({ wakeTime: e.target.value })} />
            </Field>
            <Field label="Bedtime" htmlFor="gr-sleep">
              <input id="gr-sleep" className="gr-input" type="time" value={preferences.sleepTime} onChange={(e) => set({ sleepTime: e.target.value })} />
            </Field>
            <Field label="Work starts" htmlFor="gr-ws">
              <input id="gr-ws" className="gr-input" type="time" value={preferences.workStart} onChange={(e) => set({ workStart: e.target.value })} />
            </Field>
            <Field label="Work ends" htmlFor="gr-we">
              <input id="gr-we" className="gr-input" type="time" value={preferences.workEnd} onChange={(e) => set({ workEnd: e.target.value })} />
            </Field>
          </div>

          <Field label="Working days">
            <DayChips value={preferences.workDays} onChange={(workDays) => set({ workDays })} label="Working days" />
          </Field>

          <div className="gr-orn" aria-hidden="true">◆</div>

          <div className="gr-grid2">
            <Stepper label="High-value work" unit="min / workday" value={preferences.valueMinutes} min={30} max={360} step={15}
              onChange={(valueMinutes) => set({ valueMinutes })} hint="Protected, in your peak hours." />
            <Stepper label="Spiritual time" unit="min / day" value={preferences.spiritualMinutes} min={0} max={180} step={5}
              onChange={(spiritualMinutes) => set({ spiritualMinutes })} hint="Prayer, scripture, stillness." />
            <Stepper label="Workouts" unit="/ week" value={preferences.physicalSessions} min={0} max={7}
              onChange={(physicalSessions) => set({ physicalSessions })} hint="Spaced for recovery." />
            <Stepper label="Workout length" unit="min" value={preferences.physicalMinutes} min={15} max={180} step={5}
              onChange={(physicalMinutes) => set({ physicalMinutes })} />
            <Stepper label="Networking" unit="/ week" value={preferences.networkingSessions} min={0} max={5}
              onChange={(networkingSessions) => set({ networkingSessions })} />
            <Stepper label="Learning" unit="min / day" value={preferences.learningMinutes} min={0} max={180} step={5}
              onChange={(learningMinutes) => set({ learningMinutes })} />
          </div>
          <Switch checked={preferences.weeklyReview} onChange={(weeklyReview) => set({ weeklyReview })}>
            Close each week with a review &amp; planning block
          </Switch>
        </div>
      </details>

      <button type="button" className="gr-btn gr-btn--primary gr-btn--block" onClick={onOptimize} disabled={busy.optimizing}>
        {busy.optimizing ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
        {busy.optimizing ? 'Designing your week…' : plan ? 'Optimize again' : 'Optimize my week'}
      </button>

      {plan?.notes?.length > 0 && (
        <div className="gr-alert" role="note">
          <Info aria-hidden="true" />
          <div>{plan.notes.map((n) => <p key={n}>{n}</p>)}</div>
        </div>
      )}

      {plan && (
        <section className="gr-form" id="gr-plan-result" aria-label="Proposed week">
          <div className="gr-sectionhead">
            <div>
              <p className="gr-eyebrow">Step 2</p>
              <h3 className="gr-title gr-h">Your proposed week</h3>
            </div>
            <span className="gr-chip">{plan.score.overall}/100 potential</span>
          </div>

          <WeekGrid blocks={plan.blocks.map((b) => ({ ...b, id: b.key }))} />

          <div className="gr-list">
            {plan.blocks.map((block) => {
              const Icon = CATEGORY_ICONS[block.category];
              const scheduled = isBlockScheduled(block, items);
              return (
                <article key={block.key} className="gr-block" data-pillar={pillarOf(block.category)}>
                  <div className="gr-block__head">
                    <h4 className="gr-block__title"><Icon aria-hidden="true" /><span>{block.title}</span></h4>
                    {scheduled
                      ? <span className="gr-chip gr-chip--ok"><Check aria-hidden="true" />Scheduled</span>
                      : <span className="gr-chip">{formatDuration(block.durationMinutes)}</span>}
                  </div>
                  <div className="gr-block__meta">
                    <span><Clock aria-hidden="true" />{formatRange(block.startTime, block.durationMinutes)}</span>
                    <span>{describeDays(block.daysOfWeek)}</span>
                  </div>
                  <p className="gr-block__why">{block.rationale}</p>
                  <div className="gr-block__foot">
                    <DayDots days={block.daysOfWeek} />
                    {!scheduled && (
                      <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm"
                        disabled={!backendReady || busy.adding} onClick={() => onAddBlocks([block])}>
                        <CalendarPlus aria-hidden="true" />Add to schedule
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="gr-card gr-form">
            <Field label="Reminder" htmlFor="gr-remind" hint="Sent to this app and, if turned on, to your phone.">
              <select id="gr-remind" className="gr-select" value={remindBefore} onChange={(e) => setRemindBefore(Number(e.target.value))}>
                {REMIND_OPTIONS.map((m) => <option key={m} value={m}>{remindLabel(m)}</option>)}
              </select>
            </Field>
            <button type="button" className="gr-btn gr-btn--primary gr-btn--block"
              disabled={!backendReady || busy.adding || pending.length === 0} onClick={() => onAddBlocks(pending)}>
              {busy.adding ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Bell aria-hidden="true" />}
              {pending.length === 0 ? 'Everything is on your schedule' : `Schedule all ${pending.length} block${pending.length === 1 ? '' : 's'} with reminders`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

