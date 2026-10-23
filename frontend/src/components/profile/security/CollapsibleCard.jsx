import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './collapse.css';

// Whether the person last left this card open or closed, on this device. Only a convenience: any storage failure just means
// the card starts from its default.
const storageKey = (id) => `ican_security_open_${id}`;
const readChoice = (id) => {
  try {
    const value = window.localStorage.getItem(storageKey(id));
    return value === '1' ? true : value === '0' ? false : null;
  } catch { return null; }
};
const saveChoice = (id, open) => {
  try { window.localStorage.setItem(storageKey(id), open ? '1' : '0'); } catch { /* storage unavailable */ }
};

/**
 * A Security card that folds down to one row: icon, title, status chip and a one-line summary. The whole row is the button.
 *
 * `defaultOpen` is what the card does until the person makes their own choice, and it keeps following the card's state, so a
 * card opens by itself while an action is under way or a message needs reading, and never hides one. Once the person opens or
 * closes it, that choice is remembered. The body stays mounted when closed, so a half-finished form keeps what was typed.
 */
export default function CollapsibleCard({ id, icon: Icon, eyebrow, title, chip, summary, defaultOpen = false, children }) {
  const [choice, setChoice] = useState(() => readChoice(id));
  const open = choice ?? defaultOpen;
  const uid = useId();
  const headId = `${uid}-head`;
  const bodyId = `${uid}-body`;

  const toggle = () => {
    setChoice(!open);
    saveChoice(id, !open);
  };

  return (
    <section className="gr-card gr-collapse" data-open={open ? 'true' : 'false'} aria-label={title}>
      <h3 className="gr-collapse__h">
        <button type="button" id={headId} className="gr-collapse__head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          {Icon && <Icon className="gr-collapse__icon" aria-hidden="true" />}
          <span className="gr-collapse__text">
            {eyebrow && <span className="gr-eyebrow">{eyebrow}</span>}
            <span className="gr-title gr-h">{title}</span>
            {(chip || (summary && !open)) && (
              <span className="gr-collapse__meta">
                {chip}
                {summary && !open && <span className="gr-collapse__summary">{summary}</span>}
              </span>
            )}
          </span>
          <ChevronDown className="gr-collapse__chev" aria-hidden="true" />
        </button>
      </h3>
      <div id={bodyId} className="gr-collapse__body" role="region" aria-labelledby={headId} inert={open ? undefined : ''}>
        <div className="gr-collapse__inner">
          <div className="gr-form">{children}</div>
        </div>
      </div>
    </section>
  );
}
