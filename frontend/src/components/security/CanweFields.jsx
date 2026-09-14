import React from 'react';

/**
 * Hidden trap fields for auth forms — deliberately named "Canwe" rather
 * than anything that reads as a security term, so grepping the shipped
 * bundle for the obvious keyword doesn't reveal what this component does.
 *
 * A real user never sees or fills these: they carry no visible label, sit
 * off-screen (not just `display:none`, which some scrapers deliberately
 * skip), are excluded from tab order, and are marked aria-hidden so screen
 * readers skip them too. An automated
 * form-filler that blindly populates every <input> it finds — or a human
 * attacker's browser autofill/password manager offering to fill "helpful"
 * looking fields — will still catch on `name="admin_pass"` / `root_token`.
 *
 * Usage: drop <CanweFields /> anywhere inside a <form>, then before calling
 * your real auth logic in onSubmit, call checkCanweFields(formEl or
 * formValues) from ../../utils/canweGuard — see SignIn.jsx for the wiring.
 */
const CanweFields = () => (
  <div
    aria-hidden="true"
    style={{
      position: 'absolute',
      width: 1,
      height: 1,
      padding: 0,
      margin: -1,
      overflow: 'hidden',
      clip: 'rect(0,0,0,0)',
      whiteSpace: 'nowrap',
      border: 0,
      left: '-9999px',
    }}
  >
    {/* Classic honeytoken fields — a script filling every input it sees
        trips one of these; no real ICAN form ever reads their values. */}
    <label htmlFor="admin_pass">Do not fill this field</label>
    <input id="admin_pass" name="admin_pass" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />

    <label htmlFor="root_token">Do not fill this field</label>
    <input id="root_token" name="root_token" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />

    <label htmlFor="backup_key">Do not fill this field</label>
    <input id="backup_key" name="backup_key" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />

    {/* Generic spam-bot bait names — many scripts specifically look for a
        field called "website" or a second email confirmation to fill. */}
    <label htmlFor="website">Do not fill this field</label>
    <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
  </div>
);

export default CanweFields;
