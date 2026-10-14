// Background publishing of pitch videos.
//
// Publishing used to block the recorder screen: the creator waited through the upload, and leaving the
// Pitchin tab (which unmounts it) lost the video. This keeps the work in module scope instead, so it
// continues while the person browses, switches tabs, or loses signal for a moment.
//
// Steps per job: prepare (optional, e.g. IcanEra mark on a picked file) -> upload to R2 with progress
// -> create the pitch row already pointing at the video. The row is only created once the video is safe
// in storage, so a failed upload never leaves a half-made pitch behind, and a retry after a failed save
// does not upload the video again.
//
// A refresh or closed tab still loses an in-memory video, so a leave-page warning is held while jobs run.

import { uploadVideo, createPitch } from './pitchingService';
import { toNamedVideoFile } from '../utils/videoFormat';

const UPLOAD_ATTEMPTS = 3;
const DONE_VISIBLE_MS = 6000;
const KEEP_FINISHED_MS = 10 * 60 * 1000;

let jobs = [];
let snapshot = [];
const listeners = new Set();
const secrets = new Map(); // job id -> { blob, task, fields, uploadedUrl, controller }

const emit = () => {
  const now = Date.now();
  jobs = jobs.filter((j) => !(j.finishedAt && now - j.finishedAt > KEEP_FINISHED_MS));
  snapshot = jobs.map((j) => ({ ...j }));
  listeners.forEach((l) => l());
  syncLeaveGuard();
};

const patch = (id, changes) => {
  const job = jobs.find((j) => j.id === id);
  if (!job) return;
  Object.assign(job, changes);
  emit();
};

export const subscribePitchUploads = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getPitchUploads = () => snapshot;

const isActive = (j) => ['preparing', 'uploading', 'saving'].includes(j.status);

const warnBeforeLeave = (e) => { e.preventDefault(); e.returnValue = ''; };
let guarding = false;
function syncLeaveGuard() {
  if (typeof window === 'undefined') return;
  const need = jobs.some(isActive);
  if (need && !guarding) { window.addEventListener('beforeunload', warnBeforeLeave); guarding = true; }
  if (!need && guarding) { window.removeEventListener('beforeunload', warnBeforeLeave); guarding = false; }
}

// Wait for the connection to come back instead of burning retries while offline.
const waitOnline = (signal) => new Promise((resolve) => {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) { resolve(); return; }
  const finish = () => { window.removeEventListener('online', finish); resolve(); };
  window.addEventListener('online', finish);
  signal?.addEventListener('abort', finish, { once: true });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeProgressReporter(id, base = 0, span = 1) {
  let last = 0;
  let lastPercent = -1;
  return (fraction) => {
    const percent = Math.floor(fraction * 100);
    const now = Date.now();
    if (percent === lastPercent || (now - last < 150 && fraction < 1)) return;
    last = now;
    lastPercent = percent;
    patch(id, { progress: Math.max(0, Math.min(1, base + fraction * span)) });
  };
}

async function prepare(id, secret) {
  if (secret.finalBlob) return;
  if (!secret.task) { secret.finalBlob = secret.blob; return; }
  patch(id, { status: 'preparing', progress: secret.task.progress || 0 });
  const unsubscribe = secret.task.onProgress(makeProgressReporter(id));
  // If the clip is still being stamped in a tab that went to the background, don't wait forever.
  const timer = setTimeout(() => secret.task.abort(), secret.task.timeoutMs);
  try {
    secret.finalBlob = (await secret.task.promise) || secret.blob;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

async function upload(id, secret) {
  if (secret.uploadedUrl) return;
  const file = toNamedVideoFile(secret.finalBlob, 'pitch');
  patch(id, { status: 'uploading', progress: 0, sizeBytes: file.size });
  let lastError = 'Upload failed';
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    await waitOnline(secret.controller.signal);
    if (secret.controller.signal.aborted) throw Object.assign(new Error('Upload cancelled'), { cancelled: true });
    const result = await uploadVideo(file, null, {
      onProgress: makeProgressReporter(id),
      signal: secret.controller.signal,
    });
    if (result.cancelled) throw Object.assign(new Error('Upload cancelled'), { cancelled: true });
    if (result.success && result.url) { secret.uploadedUrl = result.url; return; }
    lastError = result.error || lastError;
    if (/sign in|not authenticated/i.test(lastError)) break; // retrying will not fix being signed out
    if (attempt < UPLOAD_ATTEMPTS) { patch(id, { progress: 0 }); await sleep(1500 * attempt); }
  }
  throw new Error(lastError);
}

async function run(id) {
  const secret = secrets.get(id);
  if (!secret) return;
  secret.controller = new AbortController();
  patch(id, { error: null });
  try {
    await prepare(id, secret);
    await upload(id, secret);
    patch(id, { status: 'saving', progress: 1 });
    const saved = await createPitch({ ...secret.fields, video_url: secret.uploadedUrl });
    if (!saved.success) throw new Error(saved.error || 'Could not publish the pitch');
    secrets.delete(id);
    patch(id, { status: 'done', progress: 1, pitch: saved.data, finishedAt: Date.now() });
    setTimeout(() => patch(id, { hidden: true }), DONE_VISIBLE_MS);
  } catch (err) {
    if (err?.cancelled) {
      secrets.delete(id);
      jobs = jobs.filter((j) => j.id !== id);
      emit();
      return;
    }
    console.error('Pitch upload failed:', err);
    patch(id, { status: 'error', error: err?.message || 'Something went wrong', finishedAt: null });
  }
}

/**
 * Starts publishing a pitch in the background and returns straight away.
 * @param {{ title: string, blob: Blob, task?: object, fields: object }} job
 *   fields = the pitch columns (business_profile_id, title, ...) without video_url.
 */
export function enqueuePitchUpload({ title, blob, task = null, fields }) {
  const id = `pitch-upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  secrets.set(id, { blob, task, fields, finalBlob: null, uploadedUrl: null, controller: new AbortController() });
  jobs.push({
    id, title: title || 'Your pitch', status: 'preparing', progress: 0, sizeBytes: blob?.size || 0,
    error: null, pitch: null, hidden: false, followedUp: false, startedAt: Date.now(), finishedAt: null,
  });
  emit();
  run(id);
  return id;
}

export const retryPitchUpload = (id) => {
  const job = jobs.find((j) => j.id === id);
  if (job?.status === 'error' && secrets.has(id)) run(id);
};

export const cancelPitchUpload = (id) => {
  const job = jobs.find((j) => j.id === id);
  if (!job) return;
  const secret = secrets.get(id);
  if (job.status === 'error') {
    secrets.delete(id);
    jobs = jobs.filter((j) => j.id !== id);
    emit();
  } else if (secret && (job.status === 'preparing' || job.status === 'uploading')) {
    secret.task?.abort();
    secret.controller.abort();
  }
};

export const dismissPitchUpload = (id) => {
  const job = jobs.find((j) => j.id === id);
  if (!job || isActive(job)) return;
  if (job.status === 'error') { cancelPitchUpload(id); return; }
  patch(id, { hidden: true });
};

/** Pitches that finished publishing and haven't been acted on yet (refresh the feed, open the agreement). */
export function takeFinishedPitchUploads() {
  const finished = jobs.filter((j) => j.status === 'done' && !j.followedUp && j.pitch);
  if (finished.length === 0) return [];
  finished.forEach((j) => { j.followedUp = true; });
  emit();
  return finished.map((j) => j.pitch);
}
