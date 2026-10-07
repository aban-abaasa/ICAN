import React from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { coverTypeLabel, coveredBy, fmtDate } from '../../utils/insuranceCatalog';
import { Chip } from './common';

/**
 * The insurance requirements for this person's country and situation, ticked off from the cover they
 * actually hold (personally and through their businesses). Nothing here is self-declared: an item is
 * only done while a live policy covers it, and it un-ticks itself when the policy ends.
 */
export default function InsuranceCompliance({ items, covers, loading, onGetCover }) {
  const total = items.length;
  const done = items.filter((i) => coveredBy(i, covers)).length;
  const requiredLeft = items.filter((i) => i.required && !coveredBy(i, covers)).length;

  if (total === 0) return null;

  return (
    <section className="gr-card gr-form" aria-label="Insurance compliance">
      <div className="gr-sectionhead">
        <div>
          <p className="gr-eyebrow">Insurance compliance</p>
          <h3 className="gr-title gr-h">{loading ? 'Checking your cover…' : `${done} of ${total} covered`}</h3>
        </div>
        {!loading && (requiredLeft > 0 ? <Chip tone="warn">{requiredLeft} required to go</Chip> : <Chip tone="ok">Every required cover is in place</Chip>)}
      </div>
      <div className="gr-progress" role="progressbar" aria-valuenow={total ? Math.round((done / total) * 100) : 0} aria-valuemin={0} aria-valuemax={100} aria-label="Insurance cover in place">
        <i style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
      </div>

      <div className="gr-list">
        {items.map((item) => {
          const cover = coveredBy(item, covers);
          return (
            <article key={item.key} className={`gr-item ${cover ? 'is-done' : ''}`}>
              <span className="gr-tick" aria-pressed={!!cover} aria-label={cover ? 'Covered' : 'Not covered'} role="img" style={{ cursor: 'default' }}>
                <ShieldCheck aria-hidden="true" />
              </span>
              <div style={{ minWidth: 0 }} className="gr-form">
                <div>
                  <h4 className="gr-block__title" style={{ fontSize: '.98rem' }}><span>{item.title}</span></h4>
                  <div className="gr-block__meta" style={{ marginTop: 4 }}>
                    <Chip>{item.required ? 'Required' : 'Recommended'}</Chip>
                    {item.authority && <span>{item.authority}</span>}
                    {item.covers.map((t) => <Chip key={t}>{coverTypeLabel(t)}</Chip>)}
                  </div>
                </div>
                {item.why && <p className="gr-block__why">{item.why}</p>}
                {cover ? (
                  <p className="gr-small" style={{ color: 'var(--gr-ok)' }}>
                    Covered by {cover.insurer} · {cover.plan} · until {fmtDate(cover.ends_at)}{cover.state === 'grace' ? ' (renew now)' : ''}
                  </p>
                ) : (
                  <div className="gr-block__actions" style={{ gap: 8 }}>
                    <button type="button" className="gr-btn gr-btn--primary gr-btn--sm" onClick={() => onGetCover(item.covers[0])}>Find cover</button>
                    {item.link && <a className="gr-btn gr-btn--ghost gr-btn--sm" href={item.link} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />Official site</a>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
