import React, { useState } from 'react';
import { Laptop, Loader2, LogOut, Monitor, Smartphone, Tablet } from 'lucide-react';
import { describeUserAgent } from '../../../utils/securityHelpers';
import { formatTimeAgo } from '../../../services/universalNotificationsService';
import { revokeSession, signOutOtherDevices } from '../../../services/securityService';

const KIND_ICON = { phone: Smartphone, tablet: Tablet, desktop: Laptop };

/** Every device signed in to this account, from Supabase's own session table. */
export default function DevicesCard({ sessions, onChanged }) {
  const [workingId, setWorkingId] = useState(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const others = sessions.filter((s) => !s.is_current);
  const visible = showAll ? sessions : sessions.slice(0, 5);

  const act = async (id, fn) => {
    setWorkingId(id);
    setError('');
    try { await fn(); await onChanged(); } catch (err) { setError(err.message); }
    setWorkingId(null);
  };

  return (
    <section className="gr-card gr-form" aria-label="Devices and sessions">
      <div className="gr-sectionhead">
        <div>
          <p className="gr-eyebrow">Where you are signed in</p>
          <h3 className="gr-title gr-h">Devices &amp; sessions</h3>
        </div>
        <span className="gr-chip">{sessions.length} signed in</span>
      </div>

      {error && <div className="gr-alert gr-alert--err" role="alert">{error}</div>}

      {sessions.length === 0 ? (
        <p className="gr-sub">No sessions to show.</p>
      ) : (
        <div className="gr-list">
          {visible.map((s) => {
            const d = describeUserAgent(s.user_agent);
            const Icon = KIND_ICON[d.kind] || Monitor;
            return (
              <div key={s.id} className={`gr-device ${s.is_current ? 'is-current' : ''}`}>
                <span className="gr-device__icon"><Icon aria-hidden="true" /></span>
                <div>
                  <div className="gr-device__t">
                    {d.label}
                    {s.is_current && <span className="gr-chip gr-chip--ok">This device</span>}
                    {s.aal === 'aal2' && <span className="gr-chip">2-step</span>}
                  </div>
                  <div className="gr-device__m">
                    {s.ip ? `${s.ip} · ` : ''}Active {formatTimeAgo(s.last_active_at).toLowerCase()} · signed in {new Date(s.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                  </div>
                </div>
                {!s.is_current && (
                  <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" disabled={workingId === s.id}
                    onClick={() => act(s.id, () => revokeSession(s.id))} aria-label={`Sign out ${d.label}`}>
                    {workingId === s.id ? <Loader2 className="gr-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}Sign out
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {sessions.length > 5 && (
        <button type="button" className="gr-link" style={{ justifySelf: 'start' }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${sessions.length}`}
        </button>
      )}

      {others.length > 0 && (
        <button type="button" className="gr-btn gr-btn--danger" disabled={workingId === 'others'}
          onClick={() => act('others', signOutOtherDevices)}>
          {workingId === 'others' ? <Loader2 className="gr-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
          Sign out all {others.length} other device{others.length === 1 ? '' : 's'}
        </button>
      )}
    </section>
  );
}
