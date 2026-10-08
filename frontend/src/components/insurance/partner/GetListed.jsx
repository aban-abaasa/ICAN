import React, { useMemo } from 'react';
import { ArrowRight, Check, Circle, Clock, Eye, EyeOff, Sparkles, X } from 'lucide-react';
import { listingHealth, journeySteps } from '../../../utils/insurerListing';
import { ScoreRing } from '../../profile/growth/parts';
import { Alert, Chip } from '../common';

const STEP_ICON = { done: Check, wait: Clock, bad: X, current: Sparkles, todo: Circle };

/** Seven steps from "interested" to "customers can find me", as a tracker anyone can read at a glance. */
export function Journey({ steps }) {
  return (
    <ol className="ip-steps" aria-label="Steps to get listed">
      {steps.map((s, i) => {
        const Icon = STEP_ICON[s.state] || Circle;
        return (
          <li key={s.key} className={`ip-step is-${s.state}`} aria-current={s.state === 'current' || s.state === 'wait' ? 'step' : undefined}>
            <span className="ip-step__dot">{s.state === 'todo' ? i + 1 : <Icon aria-hidden="true" />}</span>
            <span className="ip-step__t">{s.label}</span>
            <span className="ip-step__s">{s.sub}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The first screen of the insurer console: where you are on the way to a public listing, how strong the
 * listing is, the single best thing to do next, and everything else as a checklist you can jump from.
 */
export default function GetListed({ insurer, plans, applications, goTab }) {
  const steps = useMemo(() => journeySteps({ applications, insurer, plans }), [applications, insurer, plans]);
  const health = useMemo(() => (insurer ? listingHealth({ insurer, plans }) : null), [insurer, plans]);

  if (!insurer) {
    const applied = (applications || []).length > 0;
    return (
      <div className="gr-form">
        <article className="gr-card gr-form">
          <div>
            <p className="gr-eyebrow">Insurance partners</p>
            <h3 className="gr-title gr-h">{applied ? 'Your application is on its way' : 'List your insurance company on IcanEra'}</h3>
            <p className="gr-sub" style={{ marginTop: 6 }}>
              Get found by people, riders and businesses who need cover. Support checks your licence once, then your plans and profile
              go in the public directory, with your licence and regulator shown on every plan.
            </p>
          </div>
          <Journey steps={steps} />
          <button type="button" className="gr-btn gr-btn--primary gr-btn--block" onClick={() => goTab('apply')}>
            {applied ? 'See my application' : 'Apply with my licence'}<ArrowRight aria-hidden="true" />
          </button>
        </article>
      </div>
    );
  }

  const { score, level, visible, blockers, missing, next, checks } = health;
  return (
    <div className="gr-form">
      <article className="gr-card gr-form">
        <div className="ip-health">
          <ScoreRing value={score} label="Listing strength" />
          <div style={{ minWidth: 0 }}>
            <p className="gr-eyebrow">{insurer.display_name}</p>
            <h3 className="gr-title gr-h">{visible ? 'You are in the public directory' : 'Customers cannot find you yet'}</h3>
            <p className="gr-sub">Listing strength: <b>{level}</b>. {missing.length === 0 ? 'Nothing left to fix.' : `${missing.length} thing${missing.length === 1 ? '' : 's'} to improve.`}</p>
            <div className="ip-chips" style={{ marginTop: 6 }}>
              {visible ? <Chip tone="ok"><Eye aria-hidden="true" />Visible</Chip> : <Chip tone="warn"><EyeOff aria-hidden="true" />Not visible</Chip>}
              {insurer.status === 'verified' && <Chip tone="ok">Verified</Chip>}
            </div>
          </div>
        </div>
        {!visible && blockers.map((b) => <Alert key={b} tone="warn">{b}</Alert>)}
        <Journey steps={steps} />
      </article>

      {next && (
        <article className="gr-card gr-form ip-next" aria-label="Best next step">
          <p className="gr-eyebrow">Best next step{next.required ? ' · required' : ''}</p>
          <h4 className="gr-title gr-h">{next.label}</h4>
          <p className="gr-sub">{next.hint}</p>
          <div><button type="button" className="gr-btn gr-btn--primary gr-btn--sm" onClick={() => goTab(next.tab)}>Do this now<ArrowRight aria-hidden="true" /></button></div>
        </article>
      )}

      <article className="gr-card gr-form">
        <p className="gr-eyebrow">Everything that makes a listing trusted</p>
        <ul className="ip-checks">
          {checks.map((c) => (
            <li key={c.key} className={`ip-check ${c.done ? 'is-done' : 'is-open'}`}>
              {c.done ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
              <div>
                <b>{c.label}{c.required && !c.done ? ' (required)' : ''}</b>
                {!c.done && <small>{c.hint}</small>}
              </div>
              {!c.done && <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm ip-check__go" onClick={() => goTab(c.tab)}>Fix</button>}
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
