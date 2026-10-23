import React, { useState } from 'react';
import { BadgeCheck, Clock, ShieldAlert } from 'lucide-react';
import NationalIdVerifyDialog from './NationalIdVerifyDialog';
import useNationalIdStatus from '../hooks/useNationalIdStatus';
import { idVerificationState, maskedNationalId } from '../utils/nationalId';

/**
 * "My national ID" on the wallet's settings tab: what is saved, whether a reviewer has confirmed it is really theirs,
 * and the way to ask. Renders nothing until backend/NATIONAL_ID_PER_COUNTRY.sql is installed, or for an account that is
 * exempt from the ID rule.
 *
 * The ID number itself is never shown or kept by the browser: only its type and last four characters.
 */
export default function NationalIdStatusCard() {
  const { status, refresh } = useNationalIdStatus(true);
  const [dialog, setDialog] = useState(null); // 'verify' | 'claim' | null

  const state = idVerificationState(status);
  if (state === 'unavailable' || status?.authenticated === false || status?.exempt) return null;
  // No ID and no request: the wallet-creation form and the "add your national ID" dialog ask for one. This card is for
  // people who have one saved, or who have a request open or turned down (such as a claim for an ID someone else saved first).
  if (state === 'none') return null;

  const idLine = status.hasId ? maskedNationalId(status.idType, status.last4) : 'No ID saved on this wallet';
  const check = status.check;

  const view = {
    verified: {
      Icon: BadgeCheck, tone: '#2f9e72', title: 'Verified',
      body: `This ID is confirmed as yours${status.nameOnId ? `, in the name ${status.nameOnId}` : ''}. People who pay you see “ID verified”. Your wallet name is tied to it.`
    },
    pending: {
      Icon: Clock, tone: '#c4a052', title: 'Waiting for a reviewer',
      body: check?.kind === 'claim'
        ? 'You asked for this ID to be moved to your wallet. Until a reviewer decides, it stays where it is.'
        : 'A reviewer is checking your photos. You can keep using your wallet.'
    },
    rejected: {
      Icon: ShieldAlert, tone: '#b91c1c', title: 'Not approved',
      body: `${check?.reviewNote ? `Reason: ${check.reviewNote}. ` : ''}You can send a new request with clearer photos.`
    },
    unverified: {
      Icon: ShieldAlert, tone: '#c4a052', title: 'Not verified yet',
      body: status.requireVerified && status.enforced
        ? 'Wallets whose ID is not verified cannot send or withdraw money. Verify yours to keep using it.'
        : 'Anyone can type an ID number, so prove this one is yours. Until then people who pay you see “ID not verified”.'
    }
  }[state];

  const canAsk = state === 'unverified' || state === 'rejected';
  const mode = status.hasId ? 'verify' : 'claim';

  return (
    <section className="glass-card p-4" aria-labelledby="national-id-card-title">
      <div className="flex items-start gap-3">
        <view.Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: view.tone }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id="national-id-card-title" className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            National ID · <span style={{ color: view.tone }}>{view.title}</span>
          </h3>
          <p className="mt-0.5 text-xs text-gray-400">{idLine}</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-textSecondary)' }}>{view.body}</p>
          {canAsk && (
            <button
              type="button"
              onClick={() => setDialog(mode)}
              className="mt-3 inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-semibold"
              style={{ border: '1px solid rgba(196,160,82,0.6)', color: '#c4a052' }}
            >
              {status.hasId ? 'Verify my ID' : 'Ask for my ID'}
            </button>
          )}
        </div>
      </div>

      {dialog && (
        <NationalIdVerifyDialog
          mode={dialog}
          walletName={status.walletName || ''}
          initialCountry={status.accountCountry || ''}
          onClose={() => { setDialog(null); refresh(); }}
          onDone={() => refresh()}
        />
      )}
    </section>
  );
}
