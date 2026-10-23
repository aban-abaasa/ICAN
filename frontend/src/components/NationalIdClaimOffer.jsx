import React, { useState } from 'react';
import NationalIdVerifyDialog from './NationalIdVerifyDialog';
import { isIdTakenResult } from '../utils/nationalId';

/**
 * Sits beside an error message. When that message is the "this ID is already linked to another wallet" answer, it offers the
 * real owner a way to ask for the ID to be moved to them (a reviewer decides, see backend/NATIONAL_ID_OWNERSHIP.sql).
 * Renders nothing for any other message, so it can be dropped next to any ID error.
 *
 *   message       the error text being shown
 *   country/value what the person just typed, carried into the request
 */
export default function NationalIdClaimOffer({ message, country = '', value = '', walletName = '', className = 'wa-link', onSent }) {
  const [open, setOpen] = useState(false);
  if (!isIdTakenResult({ success: false, error: message })) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>This is my ID — ask for it</button>
      {open && (
        <NationalIdVerifyDialog
          mode="claim"
          initialCountry={country}
          initialValue={value}
          walletName={walletName}
          onClose={() => setOpen(false)}
          onDone={onSent}
        />
      )}
    </>
  );
}
