import React, { useMemo, useState } from 'react';
import { MapPin, Search } from 'lucide-react';

/**
 * Find the office you need on Google Maps. The map is Google's public embed and only loads
 * when asked for, so opening Readiness does not contact Google by itself.
 */
export default function OfficesCard({ items, country }) {
  const authorities = useMemo(
    () => [...new Set(items.map((i) => i.authority).filter((a) => a && a !== 'You' && !/^your /i.test(a)))],
    [items],
  );
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('');

  const effective = query.trim() || (authorities[0] ? `${authorities[0]} office ${country === 'Other' ? '' : country}` : '');

  const search = (e) => {
    e.preventDefault();
    setActive(effective.trim());
  };

  return (
    <section className="gr-card gr-form" aria-label="Find an office">
      <div className="gr-status">
        <MapPin aria-hidden="true" />
        <div className="gr-status__body">
          <h3 className="gr-title gr-h">Find an office</h3>
          <p className="gr-sub">Look up the nearest branch of the authority you need, on Google Maps.</p>
        </div>
      </div>
      {authorities.length > 0 && (
        <div className="gr-subnav" role="group" aria-label="Authorities">
          {authorities.slice(0, 8).map((a) => (
            <button key={a} type="button" aria-pressed={active.startsWith(a)}
              onClick={() => { const q = `${a} office ${country === 'Other' ? '' : country}`.trim(); setQuery(q); setActive(q); }}>
              {a}
            </button>
          ))}
        </div>
      )}
      <form className="gr-grid2" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }} onSubmit={search}>
        <input className="gr-input" aria-label="Search the map" placeholder="e.g. URA office Kampala" value={query}
          onChange={(e) => setQuery(e.target.value)} maxLength={120} />
        <button type="submit" className="gr-btn gr-btn--primary" disabled={!effective.trim()}><Search aria-hidden="true" />Search</button>
      </form>
      {active && (
        <iframe
          className="gr-frame"
          title={`Map: ${active}`}
          src={`https://maps.google.com/maps?q=${encodeURIComponent(active)}&output=embed`}
          style={{ height: 300 }}
          sandbox="allow-scripts allow-same-origin allow-popups"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      )}
    </section>
  );
}
