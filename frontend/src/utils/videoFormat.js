// Small helpers for pitch videos: which format this browser can record, whether a picked file is a video,
// readable size/length text, and a cancellable "background task" wrapper used while a clip is prepared.

// Best first. Chrome/Android/Firefox record WebM; Safari/iOS only record MP4, so the old hard-coded
// 'video/webm;codecs=vp9' made recording fail silently on iPhones.
const RECORDER_FORMATS = [
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
];

/** The first MediaRecorder format this browser supports, or null (let the browser choose its default). */
export function pickRecorderFormat() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  return RECORDER_FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime)) || null;
}

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', '3gp', '3gpp', 'avi', 'ogv'];

const extOfName = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

/** Phones sometimes hand over a video with an empty or odd MIME type, so the file extension counts too. */
export function isVideoFile(file) {
  if (!file) return false;
  if ((file.type || '').startsWith('video/')) return true;
  return VIDEO_EXTENSIONS.includes(extOfName(file.name));
}

const MIME_TO_EXT = { 'video/webm': 'webm', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v', 'video/3gpp': '3gp', 'video/x-matroska': 'mkv' };

export function videoExtension(blob) {
  const fromType = MIME_TO_EXT[(blob?.type || '').split(';')[0]];
  return fromType || extOfName(blob?.name) || 'webm';
}

/** Wraps a Blob in a File with a real name + extension, so the stored object has a sensible key and type. */
export function toNamedVideoFile(blob, base = 'pitch') {
  const ext = videoExtension(blob);
  const type = (blob.type || '').split(';')[0] || (ext === 'mp4' ? 'video/mp4' : 'video/webm');
  return new File([blob], `${base}-${Date.now()}.${ext}`, { type });
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Length / size of a video file. Resolves with null when the browser can't read it (e.g. HEVC .mov on desktop Chrome). */
export function probeVideo(blob, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement('video');
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => done({
      durationSec: Number.isFinite(el.duration) ? el.duration : null,
      width: el.videoWidth || null,
      height: el.videoHeight || null,
    });
    el.onerror = () => done(null);
    el.src = url;
  });
}

/**
 * A job that prepares a video in the background (e.g. stamping the IcanEra mark on a picked file) while the
 * person carries on filling in their pitch. `promise` always resolves with a usable Blob; if the work is
 * aborted or runs past `timeoutMs` it falls back to the original.
 */
export function createBlobTask(run, { timeoutMs = 120000 } = {}) {
  const controller = new AbortController();
  const listeners = new Set();
  const task = {
    progress: 0,
    abort: () => controller.abort(),
    timeoutMs,
    onProgress(cb) {
      listeners.add(cb);
      cb(task.progress);
      return () => listeners.delete(cb);
    },
  };
  task.promise = run({
    signal: controller.signal,
    onProgress: (fraction) => {
      task.progress = Math.max(0, Math.min(1, fraction || 0));
      listeners.forEach((cb) => cb(task.progress));
    },
  });
  return task;
}
