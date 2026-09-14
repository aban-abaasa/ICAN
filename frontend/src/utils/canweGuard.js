import getBackendUrl from '../lib/backendUrl';

// Must match the field names rendered by components/security/CanweFields.jsx.
const TRAP_FIELDS = ['admin_pass', 'root_token', 'backup_key', 'website'];

/**
 * Call this first inside any onSubmit that also renders <CanweFields />,
 * before doing any real auth/network work. Reads the trap fields straight
 * off the DOM form element (they aren't wired into React state — no
 * onChange handler exists for them) so a scripted client that fills every
 * <input> it finds still gets caught even though our own JS never touches
 * those values in the happy path.
 *
 * Returns true if a trap field was filled (caller should stop and show a
 * normal-looking generic error) or false to proceed as usual. Reporting
 * happens fire-and-forget — never block or slow down a real user's submit
 * on this network call.
 *
 * @param {HTMLFormElement} formEl
 * @param {string} formContext e.g. 'sign-in' | 'sign-up'
 */
export function checkCanweFields(formEl, formContext = 'unknown-form') {
  if (!formEl) return false;

  const data = new FormData(formEl);
  const trippedField = TRAP_FIELDS.find((name) => {
    const value = data.get(name);
    return value !== null && String(value).trim() !== '';
  });

  if (!trippedField) return false;

  const backendUrl = getBackendUrl();
  fetch(`${backendUrl}/api/security/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [trippedField]: data.get(trippedField), formContext }),
    keepalive: true,
  }).catch(() => {
    // Never let a reporting failure surface to the user or the console in
    // a way that hints anything unusual happened.
  });

  return true;
}

export default checkCanweFields;
