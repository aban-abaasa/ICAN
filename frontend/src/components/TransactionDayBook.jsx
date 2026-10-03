/**
 * TransactionDayBook
 *
 * A classic "day book": transactions grouped per day, each day a closed ledger
 * leaf that opens when tapped to show that day's entries. Used by Pitchin's
 * Manual Transactions so an owner can scan a busy business day by day instead of
 * scrolling one long list.
 *
 * Entries that involve two accounts (a helper recording on behalf of the
 * company, a co-owner's entry…) carry a lock — they can never be deleted — and
 * the owner can archive them instead (compacts the stored detail; the entry
 * keeps counting toward the share value).
 *
 * Styling lives in index.css under `.ls-day*` and uses the `.ls-classic` tokens,
 * so it must render inside PitchinLiveShareValue.
 */

import React, { useMemo, useState, useId } from 'react';
import { ChevronDown, Lock, Archive, Loader } from 'lucide-react';

const DAYS_PER_PAGE = 14;
const UNDATED = 'undated';

const pad = (n) => String(n).padStart(2, '0');

// Local calendar day, so an entry made at 23:50 stays on the day the user saw.
const dayKeyOf = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return UNDATED;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const todayKey = () => dayKeyOf(new Date().toISOString());
const yesterdayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dayKeyOf(d.toISOString());
};

function groupByDay(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = dayKeyOf(entry.created_at);
    if (!map.has(key)) {
      map.set(key, { key, date: key === UNDATED ? null : new Date(entry.created_at), entries: [], net: 0, locked: 0 });
    }
    const day = map.get(key);
    day.entries.push(entry);
    day.net += Number(entry.signedAmount) || 0;
    if (entry.involves_two_accounts) day.locked += 1;
  }
  const days = Array.from(map.values());
  days.forEach((d) => d.entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
  // Newest day first; undated entries (should not happen) sink to the bottom.
  days.sort((a, b) => {
    if (a.key === UNDATED) return 1;
    if (b.key === UNDATED) return -1;
    return b.key.localeCompare(a.key);
  });
  return days;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Why an entry is permanent (ican_transactions.lock_reason).
const LOCK_LABELS = {
  helper:       { label: 'Helper entry',  hint: 'Entered by a helper on behalf of the company' },
  cmms:         { label: 'CMMS',          hint: 'Booked from CMMS' },
  wallet:       { label: 'IcanEra wallet', hint: 'An IcanEra wallet movement' },
  co_owner:     { label: 'Co-owner',      hint: 'Recorded by someone other than the company owner' },
  counterparty: { label: 'Two accounts',  hint: 'Involves two accounts' }
};
const lockInfo = (reason) => LOCK_LABELS[reason] || { label: 'Permanent', hint: 'Involves two accounts' };

export default function TransactionDayBook({
  entries,
  fmt,
  bucketLabels = {},
  showWho = false,
  canArchive = false,
  onArchive,
  archivingId = null
}) {
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [openDays, setOpenDays] = useState(() => new Set());
  const [visibleDays, setVisibleDays] = useState(DAYS_PER_PAGE);

  const days = useMemo(() => groupByDay(entries || []), [entries]);
  const today = todayKey();
  const yesterday = yesterdayKey();
  const currentYear = new Date().getFullYear();

  const toggle = (key) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (days.length === 0) {
    return <p className="ls-day__empty">No entries recorded yet.</p>;
  }

  return (
    <div className="ls-daybook">
      {days.slice(0, visibleDays).map((day) => {
        const isOpen = openDays.has(day.key);
        const panelId = `${baseId}-${day.key}`;
        const rel = day.key === today ? 'Today' : day.key === yesterday ? 'Yesterday' : null;
        const netTone = day.net > 0 ? 'ls-tone-up' : day.net < 0 ? 'ls-tone-down' : '';

        return (
          <section key={day.key} className={`ls-day ${isOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className="ls-day__head"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggle(day.key)}
            >
              <span className="ls-day__leaf" aria-hidden="true">
                <b>{day.date ? day.date.getDate() : '—'}</b>
                <i>{day.date ? day.date.toLocaleDateString(undefined, { month: 'short' }) : ''}</i>
              </span>

              <span className="ls-day__title">
                <span className="ls-day__date">
                  {day.date
                    ? day.date.toLocaleDateString(undefined, {
                        weekday: 'long', day: 'numeric', month: 'long',
                        // The year only earns its space on days outside this one.
                        ...(day.date.getFullYear() !== currentYear && { year: 'numeric' })
                      })
                    : 'Undated'}
                  {rel && <em className="ls-day__rel">{rel}</em>}
                </span>
                <span className="ls-day__meta">
                  {plural(day.entries.length, 'entry', 'entries')}
                  {day.locked > 0 && (
                    <span className="ls-day__lockcount">
                      <Lock size={10} aria-hidden="true" /> {day.locked} permanent
                    </span>
                  )}
                </span>
              </span>

              <span className={`ls-day__net ${netTone}`}>
                {day.net > 0 ? '+' : day.net < 0 ? '−' : ''}{fmt(Math.abs(day.net))}
              </span>
              <ChevronDown size={16} className="ls-day__chev" aria-hidden="true" />
            </button>

            {isOpen && (
              <ul id={panelId} className="ls-day__lines">
                {day.entries.map((e) => {
                  const sign = e.signedAmount > 0 ? '+' : e.signedAmount < 0 ? '−' : '';
                  const tone = e.signedAmount > 0 ? 'ls-tone-up' : e.signedAmount < 0 ? 'ls-tone-down' : 'ls-tone-gold';
                  const label = e.description || bucketLabels[e.reporting_bucket] || 'Entry';
                  const archived = !!e.archived_at;
                  const busy = archivingId === e.id;
                  const time = new Date(e.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

                  return (
                    <li key={e.id} className="ls-day__line">
                      <span className="ls-day__time">{time}</span>
                      <span className="ls-day__what">
                        <span className="ls-day__desc">{label}</span>
                        <span className="ls-day__sub">
                          {showWho && e.contributor_name && <span>{e.contributor_name}</span>}
                          {e.reporting_bucket && bucketLabels[e.reporting_bucket] && e.description && (
                            <span>{bucketLabels[e.reporting_bucket]}</span>
                          )}
                          {e.involves_two_accounts && (
                            <span
                              className="ls-pill ls-pill--lock"
                              title={`${lockInfo(e.lock_reason || (e.entered_on_behalf ? 'helper' : '')).hint} — it can never be deleted`}
                            >
                              <Lock size={9} aria-hidden="true" /> {lockInfo(e.lock_reason || (e.entered_on_behalf ? 'helper' : '')).label}
                            </span>
                          )}
                          {archived && (
                            <span className="ls-pill ls-pill--archived" title="Detail compacted to save space; still counted in the share value">
                              <Archive size={9} aria-hidden="true" /> Archived
                            </span>
                          )}
                        </span>
                      </span>
                      <span className={`ls-day__amt ${tone}`}>{sign}{fmt(Math.abs(Number(e.amount) || 0))}</span>
                      {canArchive && e.involves_two_accounts && !archived && onArchive && (
                        <button
                          type="button"
                          className="ls-day__archive"
                          disabled={busy}
                          onClick={() => onArchive(e)}
                          aria-label={`Archive ${label}`}
                          title="Archive — frees storage, keeps the amount in your figures"
                        >
                          {busy ? <Loader size={13} className="animate-spin" aria-hidden="true" /> : <Archive size={13} aria-hidden="true" />}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {days.length > visibleDays && (
        <button
          type="button"
          className="ls-day__older"
          onClick={() => setVisibleDays((n) => n + DAYS_PER_PAGE)}
        >
          Show older days · {days.length - visibleDays} more
        </button>
      )}
    </div>
  );
}
