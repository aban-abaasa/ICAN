// Prosperity Architect - weekly schedule optimiser (Human Capital pillar).
//
// Pure functions, no network and no randomness: the same preferences always give the
// same plan. It lays out a recurring week that protects spiritual and physical
// alignment first, then places high-value work in the user's peak hours, and scores
// the result so the number on screen means something.
//
// Days are 0 = Sunday ... 6 = Saturday (the same convention the database uses).
// Times are 'HH:MM' strings in the user's local time.

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const CATEGORIES = {
  spiritual: { label: 'Spiritual alignment', pillar: 'spiritual' },
  physical: { label: 'Physical alignment', pillar: 'physical' },
  high_value_work: { label: 'High-value work', pillar: 'value' },
  networking: { label: 'Networking', pillar: 'planning' },
  review: { label: 'Weekly review', pillar: 'planning' },
  learning: { label: 'Learning', pillar: 'value' },
  family: { label: 'Family & community', pillar: 'recovery' },
  rest: { label: 'Rest & recovery', pillar: 'recovery' },
  custom: { label: 'Custom', pillar: null },
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const PILLARS = {
  value: { label: 'Value creation', weight: 0.30 },
  spiritual: { label: 'Spiritual alignment', weight: 0.22 },
  physical: { label: 'Physical alignment', weight: 0.22 },
  recovery: { label: 'Rest & recovery', weight: 0.12 },
  planning: { label: 'Planning & network', weight: 0.14 },
};

export const DEFAULT_PREFERENCES = {
  chronotype: 'morning', // morning | variable | evening
  wakeTime: '06:00',
  sleepTime: '22:30',
  workStart: '08:00',
  workEnd: '17:00',
  workDays: [1, 2, 3, 4, 5],
  spiritualMinutes: 30,
  physicalSessions: 3,
  physicalMinutes: 45,
  valueMinutes: 120, // protected high-value work per working day
  networkingSessions: 2,
  learningMinutes: 30, // 0 = none
  weeklyReview: true,
};

// ---------------------------------------------------------------- time helpers

export const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':');
  const hours = Number(h);
  const minutes = Number(m);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return NaN;
  return hours * 60 + minutes;
};

export const fromMinutes = (total) => {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

// '06:30' or '06:30:00' -> '6:30 AM'
export const formatClock = (hhmm) => {
  const mins = toMinutes(hhmm);
  if (!Number.isFinite(mins)) return '';
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const formatRange = (startTime, durationMinutes) =>
  `${formatClock(startTime)} – ${formatClock(fromMinutes(toMinutes(startTime) + durationMinutes))}`;

export const formatDuration = (minutes) => {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

export const describeDays = (days = []) => {
  const set = [...new Set(days)].sort((a, b) => a - b);
  const key = set.join(',');
  if (set.length === 7) return 'Daily';
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  return set.map((d) => DAY_SHORT[d]).join(', ');
};

// ---------------------------------------------------------------- preferences

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const asInt = (value, fallback) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback);

/**
 * Fill gaps, clamp ranges and repair impossible combinations. Returns the cleaned
 * preferences plus human-readable notes about anything that was changed.
 */
export function normalizePreferences(input = {}) {
  const notes = [];
  const p = { ...DEFAULT_PREFERENCES, ...(input || {}) };

  p.chronotype = ['morning', 'variable', 'evening'].includes(p.chronotype) ? p.chronotype : 'morning';
  p.workDays = [...new Set((Array.isArray(p.workDays) ? p.workDays : DEFAULT_PREFERENCES.workDays)
    .map(Number).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (p.workDays.length === 0) {
    p.workDays = [...DEFAULT_PREFERENCES.workDays];
    notes.push('Pick at least one working day; weekdays were used.');
  }

  let wake = toMinutes(p.wakeTime);
  let sleep = toMinutes(p.sleepTime);
  let workStart = toMinutes(p.workStart);
  let workEnd = toMinutes(p.workEnd);
  if (!Number.isFinite(wake)) wake = toMinutes(DEFAULT_PREFERENCES.wakeTime);
  if (!Number.isFinite(sleep)) sleep = toMinutes(DEFAULT_PREFERENCES.sleepTime);
  if (!Number.isFinite(workStart)) workStart = toMinutes(DEFAULT_PREFERENCES.workStart);
  if (!Number.isFinite(workEnd)) workEnd = toMinutes(DEFAULT_PREFERENCES.workEnd);

  // The planner works inside a single waking day, so bedtime must come after waking.
  if (sleep <= wake + 8 * 60) {
    sleep = Math.min(23 * 60 + 30, wake + 16 * 60);
    notes.push('Bedtime was moved so you have a full waking day after your wake time.');
  }
  if (workStart < wake + 30) {
    workStart = wake + 60;
    notes.push('Work now starts an hour after you wake.');
  }
  if (workEnd > sleep - 150) {
    workEnd = sleep - 150;
    notes.push('Work now ends 2½ hours before bedtime to protect your evening.');
  }
  if (workEnd - workStart < 120) {
    workStart = wake + 60;
    workEnd = Math.min(sleep - 150, workStart + 8 * 60);
    notes.push('Your working hours were too short to plan around; a standard day was used.');
  }

  p.wakeTime = fromMinutes(wake);
  p.sleepTime = fromMinutes(sleep);
  p.workStart = fromMinutes(workStart);
  p.workEnd = fromMinutes(workEnd);
  p.spiritualMinutes = clamp(asInt(p.spiritualMinutes, 30), 0, 180);
  p.physicalSessions = clamp(asInt(p.physicalSessions, 3), 0, 7);
  p.physicalMinutes = clamp(asInt(p.physicalMinutes, 45), 15, 180);
  p.valueMinutes = clamp(asInt(p.valueMinutes, 120), 30, 360);
  p.networkingSessions = clamp(asInt(p.networkingSessions, 2), 0, 5);
  p.learningMinutes = clamp(asInt(p.learningMinutes, 30), 0, 180);
  p.weeklyReview = Boolean(p.weeklyReview);

  return { preferences: p, notes };
}

// ------------------------------------------------------------------- placement

const GAP = 10; // minutes of breathing room between blocks
const STEP = 5;

const overlaps = (aStart, aEnd, bStart, bEnd, gap) => aStart < bEnd + gap && bStart < aEnd + gap;

/** Earliest free start for `duration` inside any of the windows, or null. */
function findSlot(busy, windows, duration, gap = GAP) {
  for (const [from, to] of windows) {
    for (let start = from; start + duration <= to; start += STEP) {
      if (!busy.some(([s, e]) => overlaps(start, start + duration, s, e, gap))) return start;
    }
  }
  return null;
}

// Evenly spread n sessions across the week, skipping Sunday where possible.
const SPREAD = { 1: [3], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: ALL_DAYS };

const RATIONALE = {
  spiritual: 'Anchors the day before anything competes for your attention.',
  hvw_morning: 'Your sharpest hours go to the work that creates the most value.',
  hvw_variable: 'Placed after the morning warm-up, when focus is usually steady.',
  hvw_evening: 'Held for the afternoon, when an evening-type mind peaks.',
  physical: 'Spaced across the week so every session has recovery around it.',
  networking: 'Mid-week afternoons suit calls and meetings; deep work stays untouched.',
  review: 'Closes the week: what worked, what moves forward, what stops.',
  learning: 'A small daily dose compounds; set apart from work and from sleep.',
};

/**
 * Build the recurring weekly plan.
 * @returns {{ blocks: Block[], preferences, notes: string[] }}
 * Block = { key, category, title, startTime, durationMinutes, daysOfWeek, rationale }
 */
export function optimizeWeek(rawPreferences = {}) {
  const { preferences: prefs, notes } = normalizePreferences(rawPreferences);
  const wake = toMinutes(prefs.wakeTime);
  const sleep = toMinutes(prefs.sleepTime);
  const workStart = toMinutes(prefs.workStart);
  const workEnd = toMinutes(prefs.workEnd);
  const lunch = [12 * 60 + 30, 13 * 60 + 30];
  const hasLunch = workStart <= lunch[0] && workEnd >= lunch[1];

  // Per-day state: blocks placed so far, and whether it is a working day.
  const days = ALL_DAYS.map((day) => {
    const isWork = prefs.workDays.includes(day);
    return { day, isWork, placed: hasLunch && isWork ? [[...lunch]] : [], placements: [] };
  });
  // Personal blocks (spiritual, physical, learning) must stay clear of the working day.
  const personalBusy = (d) => (d.isWork ? [...d.placed, [workStart, workEnd]] : d.placed);

  const add = (d, category, title, start, duration, rationale) => {
    d.placed.push([start, start + duration]);
    d.placements.push({ category, title, start, duration, rationale });
  };

  // 1. Spiritual alignment: every day, first thing.
  if (prefs.spiritualMinutes > 0) {
    for (const d of days) {
      const start = findSlot(personalBusy(d), [[wake + 10, wake + 150], [wake, wake + 240]], prefs.spiritualMinutes);
      if (start !== null) add(d, 'spiritual', 'Spiritual alignment', start, prefs.spiritualMinutes, RATIONALE.spiritual);
    }
  }

  // 2. High-value work: working days, in the chronotype's peak window.
  const peak = {
    morning: [[workStart, workStart + 240]],
    variable: [[workStart + 60, workStart + 300]],
    evening: [[Math.max(workStart, 13 * 60 + 30), workEnd]],
  }[prefs.chronotype];
  for (const d of days.filter((x) => x.isWork)) {
    const start = findSlot(d.placed, [...peak, [workStart, workEnd]], prefs.valueMinutes);
    if (start !== null) add(d, 'high_value_work', 'High-value work', start, prefs.valueMinutes, RATIONALE[`hvw_${prefs.chronotype}`]);
  }

  // 3. Physical alignment: spread across the week, outside working hours.
  if (prefs.physicalSessions > 0) {
    const beforeWork = [wake, workStart];
    const afterWork = [workEnd, sleep - 90];
    const workdayWindows = prefs.chronotype === 'morning' ? [beforeWork, afterWork] : [afterWork, beforeWork];
    const offDayWindows = prefs.chronotype === 'morning'
      ? [[wake + 60, wake + 300], [wake + 300, sleep - 90]]
      : [[wake + 120, sleep - 90]];
    const chosen = SPREAD[prefs.physicalSessions] || ALL_DAYS;
    for (const dayIndex of chosen) {
      const d = days[dayIndex];
      const start = findSlot(personalBusy(d), d.isWork ? workdayWindows : offDayWindows, prefs.physicalMinutes);
      if (start !== null) add(d, 'physical', 'Physical alignment', start, prefs.physicalMinutes, RATIONALE.physical);
    }
  }

  // 4. Weekly review: last working day, closing the week.
  if (prefs.weeklyReview) {
    const lastWorkDay = days.filter((x) => x.isWork).pop();
    if (lastWorkDay) {
      const start = findSlot(lastWorkDay.placed, [[workEnd - 90, workEnd]], 45, 0);
      if (start !== null) add(lastWorkDay, 'review', 'Weekly review & planning', start, 45, RATIONALE.review);
    }
  }

  // 5. Networking: mid-week afternoons first, on working days.
  if (prefs.networkingSessions > 0) {
    const order = [2, 4, 3, 1, 5, 6, 0];
    const candidates = [...order.filter((x) => prefs.workDays.includes(x)),
      ...prefs.workDays.filter((x) => !order.includes(x))];
    let placed = 0;
    for (const dayIndex of candidates) {
      if (placed >= prefs.networkingSessions) break;
      const d = days[dayIndex];
      const start = findSlot(d.placed, [[Math.max(workStart, 14 * 60), workEnd], [workStart, workEnd]], 60);
      if (start !== null) {
        add(d, 'networking', 'Networking & relationships', start, 60, RATIONALE.networking);
        placed += 1;
      }
    }
  }

  // 6. Learning: a daily evening slot between dinner and wind-down.
  if (prefs.learningMinutes > 0) {
    for (const d of days) {
      const from = d.isWork ? Math.max(workEnd + 45, sleep - 180) : sleep - 180;
      const start = findSlot(personalBusy(d), [[from, sleep - 60]], prefs.learningMinutes);
      if (start !== null) add(d, 'learning', 'Learning & skill growth', start, prefs.learningMinutes, RATIONALE.learning);
    }
  }

  // Group identical placements on different days into one recurring block.
  const grouped = new Map();
  for (const d of days) {
    for (const p of d.placements) {
      const key = `${p.category}|${fromMinutes(p.start)}|${p.duration}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key, category: p.category, title: p.title, startTime: fromMinutes(p.start),
          durationMinutes: p.duration, daysOfWeek: [], rationale: p.rationale,
        });
      }
      grouped.get(key).daysOfWeek.push(d.day);
    }
  }
  const order = ['spiritual', 'high_value_work', 'physical', 'networking', 'review', 'learning'];
  const blocks = [...grouped.values()].sort((a, b) =>
    order.indexOf(a.category) - order.indexOf(b.category) || toMinutes(a.startTime) - toMinutes(b.startTime));

  const unplaced = [];
  if (prefs.spiritualMinutes > 0 && !blocks.some((b) => b.category === 'spiritual')) unplaced.push('spiritual time');
  if (prefs.physicalSessions > 0 && !blocks.some((b) => b.category === 'physical')) unplaced.push('physical sessions');
  if (unplaced.length) notes.push(`There was no room for ${unplaced.join(' and ')}. Try shorter blocks or earlier wake time.`);

  return { blocks, preferences: prefs, notes };
}

// --------------------------------------------------------------------- scoring

/** Convert saved schedule rows (database shape) into blocks the scorer understands. */
export function itemsToBlocks(items = []) {
  return items
    .filter((i) => i.is_active && i.recurrence === 'weekly')
    .map((i) => ({
      category: i.category,
      startTime: String(i.start_time).slice(0, 5),
      durationMinutes: i.duration_minutes,
      daysOfWeek: i.days_of_week || [],
    }));
}

const dayMinutes = (blocks, category) => {
  const perDay = Array(7).fill(0);
  for (const b of blocks) {
    if (b.category !== category) continue;
    for (const d of b.daysOfWeek) perDay[d] += b.durationMinutes;
  }
  return perDay;
};

/**
 * Score any set of blocks against the user's preferences. 0-100 overall plus a
 * 0-100 reading for each pillar. Used for the plan the optimiser proposes and,
 * with itemsToBlocks(), for what the user has actually put in their schedule.
 */
export function scoreBlocks(blocks = [], rawPreferences = {}) {
  const { preferences: prefs } = normalizePreferences(rawPreferences);
  const workStart = toMinutes(prefs.workStart);
  const sleep = toMinutes(prefs.sleepTime);
  const wake = toMinutes(prefs.wakeTime);

  // Spiritual: share of days with at least 15 minutes set aside.
  const spiritualDays = dayMinutes(blocks, 'spiritual').filter((m) => m >= 15).length;
  const spiritual = Math.round((spiritualDays / 7) * 100);

  // Physical: weekly minutes against ~150 min/week of moderate activity.
  const physicalMinutes = dayMinutes(blocks, 'physical').reduce((a, b) => a + b, 0);
  const physical = Math.round(clamp(physicalMinutes / 150, 0, 1) * 100);

  // Value: protected minutes on working days against the target, with full credit
  // only for blocks that start inside the user's peak window.
  const peakStart = { morning: workStart, variable: workStart + 60, evening: Math.max(workStart, 13 * 60 + 30) }[prefs.chronotype];
  const peakEnd = { morning: workStart + 240, variable: workStart + 300, evening: 24 * 60 }[prefs.chronotype];
  let valueSum = 0;
  for (const day of prefs.workDays) {
    let credited = 0;
    for (const b of blocks) {
      if (b.category !== 'high_value_work' || !b.daysOfWeek.includes(day)) continue;
      const start = toMinutes(b.startTime);
      credited += b.durationMinutes * (start >= peakStart && start < peakEnd ? 1 : 0.8);
    }
    valueSum += clamp(credited / prefs.valueMinutes, 0, 1);
  }
  const value = Math.round((valueSum / prefs.workDays.length) * 100);

  // Recovery: a protected sleep window of 7+ hours.
  const sleepHours = (24 * 60 - (sleep - wake)) / 60;
  const recovery = Math.round(clamp(sleepHours / 7, 0, 1) * 100);

  // Planning & connection: a weekly review (60%) and networking against target (40%).
  // A habit the user opted out of counts as met rather than as a gap.
  const hasReview = blocks.some((b) => b.category === 'review');
  const networkSessions = dayMinutes(blocks, 'networking').filter((m) => m > 0).length;
  const reviewPart = prefs.weeklyReview ? (hasReview ? 60 : 0) : 60;
  const networkPart = prefs.networkingSessions > 0
    ? clamp(networkSessions / prefs.networkingSessions, 0, 1) * 40
    : 40;
  const planning = Math.round(reviewPart + networkPart);

  const breakdown = { value, spiritual, physical, recovery, planning };
  const overall = Object.entries(PILLARS)
    .reduce((sum, [key, { weight }]) => sum + breakdown[key] * weight, 0);
  return { overall: Math.round(overall), breakdown };
}

const blockSignature = (b) => `${b.category}|${String(b.startTime).slice(0, 5)}|${[...b.daysOfWeek].sort().join(',')}`;

/** True when an active weekly item already matches a proposed block exactly. */
export function isBlockScheduled(block, items = []) {
  const sig = blockSignature(block);
  return items.some((i) => i.is_active && i.recurrence === 'weekly'
    && blockSignature({ category: i.category, startTime: i.start_time, daysOfWeek: i.days_of_week || [] }) === sig);
}

/**
 * Shape the result like the legacy `scheduleData` the dashboards consume
 * ({ optimizationScore, recommendations[], nextActions[] }) plus the breakdown.
 */
export function buildScheduleData({ blocks, score, items = [] }) {
  const line = (b) => `${b.title || CATEGORIES[b.category]?.label}: ${formatRange(b.startTime, b.durationMinutes)} (${describeDays(b.daysOfWeek)})`;
  const pending = blocks.filter((b) => !isBlockScheduled(b, items));
  return {
    optimizationScore: score.overall,
    breakdown: score.breakdown,
    recommendations: blocks.map(line),
    nextActions: pending.length
      ? pending.slice(0, 5).map((b) => `Add to schedule: ${line(b)}`)
      : ['Your plan is fully scheduled. Review it every Friday.'],
  };
}

/** The pillar with the most room to improve, for a one-line nudge. */
export function weakestPillar(breakdown) {
  const [key] = Object.entries(breakdown).sort((a, b) => a[1] - b[1])[0];
  return { key, label: PILLARS[key].label, value: breakdown[key] };
}
