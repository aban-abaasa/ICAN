// Google Drive file picker for Readiness: lets someone choose files straight from their Drive
// (or upload from the phone or computer they are holding) and get the link back, instead of
// copying and pasting it.
//
// Privacy by design:
//   - The only scope requested is drive.file: the app sees nothing but the files the person
//     picks, never the rest of their Drive.
//   - The access token stays in this module's memory. It is never stored and never sent to
//     our server. Only the link to each picked file is saved, by the caller.
//   - Each picked address is rebuilt from the file's id and type (classifyDriveDoc), not taken
//     from what the picker reported.
//
// Needs a Google Cloud OAuth web client and a browser API key (see GROWTH_SECURITY_READINESS_DEPLOY.md).
// Until those are set, isDrivePickerConfigured() is false and the UI offers copy and paste instead.

import { classifyDriveDoc } from '../utils/googleLinks';
import { getSupabaseClient } from '../lib/supabase/client';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GSI_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';

export class DrivePickerError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DrivePickerError';
    this.code = code;
  }
}

const clean = (value) => String(value || '').trim().replace(/^["']|["']$/g, '');

/** Public client settings: the runtime config file wins, then the build-time variables. */
export function getDriveConfig() {
  const runtime = (typeof window !== 'undefined' && window.__APP_RUNTIME_CONFIG__) || {};
  const env = import.meta.env || {};
  const clientId = clean(runtime.googleClientId || env.VITE_GOOGLE_CLIENT_ID);
  const apiKey = clean(runtime.googleApiKey || env.VITE_GOOGLE_API_KEY);
  const appId = clean(runtime.googleAppId || env.VITE_GOOGLE_APP_ID);
  return { clientId, apiKey, appId, ok: Boolean(clientId && apiKey) };
}

export const isDrivePickerConfigured = () => getDriveConfig().ok;

const scriptPromises = new Map();
function loadScript(src) {
  if (scriptPromises.has(src)) return scriptPromises.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromises.delete(src); // let a later tap retry after a network blip
      script.remove();
      reject(new DrivePickerError('Could not reach Google. Check your connection and try again.', 'network'));
    };
    document.head.appendChild(script);
  });
  scriptPromises.set(src, promise);
  return promise;
}

let pickerApiPromise = null;
function loadPickerApi() {
  if (!pickerApiPromise) {
    pickerApiPromise = loadScript(GAPI_SRC)
      .then(() => new Promise((resolve, reject) => {
        window.gapi.load('picker', { callback: resolve, onerror: () => reject(new DrivePickerError('Google Drive could not start. Try again.', 'network')) });
      }))
      .catch((err) => { pickerApiPromise = null; throw err; });
  }
  return pickerApiPromise;
}

let cachedToken = null; // { value, expiresAt, owner } kept in memory only

// The signed-in ICAN user, read from the local session (no network). A cached Google token is
// reused only for the same person, so a shared device never hands one person's Drive access
// to the next person who signs in without the page reloading.
async function currentOwner() {
  try {
    const { data } = await getSupabaseClient().auth.getSession();
    return data?.session?.user?.id || '';
  } catch {
    return '';
  }
}

async function getAccessToken(clientId) {
  const owner = await currentOwner();
  if (owner && cachedToken && cachedToken.owner === owner && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  cachedToken = null;
  await loadScript(GSI_SRC);
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new DrivePickerError(response.error === 'access_denied'
            ? 'Google Drive access was not allowed. You can still paste a link instead.'
            : 'Google would not sign you in. Try again, or paste a link instead.', response.error || 'auth'));
          return;
        }
        cachedToken = owner ? { value: response.access_token, expiresAt: Date.now() + Math.max(60, Number(response.expires_in) - 60) * 1000, owner } : null;
        resolve(response.access_token);
      },
      error_callback: (err) => {
        const message = {
          popup_failed_to_open: 'The Google sign-in window did not open. Allow pop-ups for this site, or paste a link instead.',
          popup_closed: 'Google sign-in was closed before it finished. Try again, or paste a link instead.',
        }[err?.type] || 'Google sign-in failed. Try again, or paste a link instead.';
        reject(new DrivePickerError(message, err?.type || 'auth'));
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

/**
 * Open the Google Drive picker. Resolves with the chosen files as
 * [{ id, name, mimeType, link }] where `link` is a classifyGoogleUrl result, or [] when the
 * person closes the picker. Rejects with a DrivePickerError carrying a plain-English message.
 */
export async function pickFromGoogleDrive({ multiselect = true } = {}) {
  const config = getDriveConfig();
  if (!config.ok) throw new DrivePickerError('Google Drive is not switched on for this server yet. Paste a link instead.', 'not_configured');

  const [token] = await Promise.all([getAccessToken(config.clientId), loadPickerApi()]);
  const picker = window.google.picker;

  return new Promise((resolve) => {
    const myDrive = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true);
    const shared = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setOwnedByMe(false);
    // Upload tab: send a file from this phone or computer to Drive and get its link in one step.
    const upload = new picker.DocsUploadView().setIncludeFolders(true);

    const builder = new picker.PickerBuilder()
      .addView(myDrive)
      .addView(shared)
      .addView(upload)
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setOrigin(`${window.location.protocol}//${window.location.host}`)
      .setTitle('Choose from Google Drive')
      .setCallback((data) => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.CANCEL) return resolve([]);
        if (action !== picker.Action.PICKED) return undefined;
        const docs = data[picker.Response.DOCUMENTS] || [];
        resolve(docs.map((doc) => {
          const raw = { id: doc[picker.Document.ID], name: doc[picker.Document.NAME], mimeType: doc[picker.Document.MIME_TYPE] };
          return { ...raw, link: classifyDriveDoc(raw) };
        }));
        return undefined;
      });
    if (config.appId) builder.setAppId(config.appId);
    if (multiselect) builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
    builder.build().setVisible(true);
  });
}
