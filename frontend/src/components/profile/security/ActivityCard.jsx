import React, { useState } from 'react';
import { History } from 'lucide-react';
import { describeAction } from '../../../utils/securityHelpers';
import { formatTimeAgo } from '../../../services/universalNotificationsService';
import CollapsibleCard from './CollapsibleCard';

/** Sign-in and security history from Supabase's audit log, with first-time locations flagged. */
export default function ActivityCard({ activity }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? activity : activity.slice(0, 8);
  const newIps = activity.filter((a) => a.is_new_ip).length;

  const latest = activity[0];
  return (
    <CollapsibleCard
      id="activity"
      icon={History}
      eyebrow="Last 180 days"
      title="Recent activity"
      chip={newIps > 0 ? <span className="gr-chip gr-chip--warn">{newIps} new location{newIps === 1 ? '' : 's'}</span> : null}
      summary={latest ? `${describeAction(latest.action).label} · ${formatTimeAgo(latest.created_at).toLowerCase()}` : 'Nothing recorded yet'}
    >

      {activity.length === 0 ? (
        <p className="gr-sub">Nothing recorded yet. Sign-ins, password changes and security changes will appear here.</p>
      ) : (
        <div className="gr-timeline">
          {rows.map((a) => {
            const info = describeAction(a.action);
            const when = new Date(a.created_at);
            return (
              <div key={a.id} className="gr-event" data-tone={a.is_new_ip ? 'warn' : info.tone}>
                <span className="gr-event__dot" aria-hidden="true" />
                <div>
                  <p className="gr-event__t">
                    {info.label}{' '}
                    {a.is_new_ip && <span className="gr-chip gr-chip--warn">New location</span>}
                  </p>
                  <p className="gr-event__m">
                    {a.ip ? `From ${a.ip} · ` : ''}{when.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
                <span className="gr-small">{formatTimeAgo(a.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}

      {activity.length > 8 && (
        <button type="button" className="gr-link" style={{ justifySelf: 'start' }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${activity.length}`}
        </button>
      )}
      <p className="gr-hint">Do not recognise something? Change your password and sign out your other devices.</p>
    </CollapsibleCard>
  );
}
