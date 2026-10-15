// Turns pictures (and optional audio) into a video, entirely in the browser.
//
// The pictures are drawn onto a canvas with a gentle zoom and a cross-fade between them, the IcanEra mark is
// stamped on every frame, and the canvas (plus the audio, if any) is recorded with MediaRecorder. That makes the
// build run in real time: a 30 second video takes about 30 seconds.

import { drawIcanEraWatermark } from './videoWatermark';
import { pickRecorderFormat } from './videoFormat';

export const SLIDE_W = 720;
export const SLIDE_H = 1280;
export const MAX_SLIDESHOW_SECONDS = 180;
const FADE_SECONDS = 0.6;
const MAX_SOURCE_WIDTH = 1280; // big phone photos would otherwise hold ~50 MB each in memory

/** Decodes a picture (honouring its EXIF rotation) at a size that is safe to keep in memory. */
export async function loadSlideImage(file) {
  try {
    const probe = await createImageBitmap(file);
    if (probe.width <= MAX_SOURCE_WIDTH) return probe;
    probe.close?.();
    return await createImageBitmap(file, { resizeWidth: MAX_SOURCE_WIDTH, resizeQuality: 'medium' });
  } catch {
    // older browsers: fall back to an <img>
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This picture could not be read')); };
      img.src = url;
    });
  }
}

const sizeOf = (img) => ({ w: img.width || img.naturalWidth, h: img.height || img.naturalHeight });

function drawFitted(ctx, img, W, H, mode, zoom, panX) {
  const { w, h } = sizeOf(img);
  const scale = (mode === 'fill' ? Math.max(W / w, H / h) : Math.min(W / w, H / h)) * zoom;
  const dw = w * scale;
  const dh = h * scale;
  const slackX = Math.max(0, dw - W) / 2;
  ctx.drawImage(img, (W - dw) / 2 + panX * slackX, (H - dh) / 2, dw, dh);
}

// "Fit" shows the whole picture; the bars are filled with a soft, darkened blur of the same picture
// (a tiny copy scaled up, which works even where canvas filters don't).
const tinyCache = new WeakMap();
function drawBackdrop(ctx, img, W, H) {
  let tiny = tinyCache.get(img);
  if (!tiny) {
    tiny = document.createElement('canvas');
    tiny.width = 18;
    tiny.height = 32;
    const t = tiny.getContext('2d');
    const { w, h } = sizeOf(img);
    const s = Math.max(tiny.width / w, tiny.height / h);
    t.drawImage(img, (tiny.width - w * s) / 2, (tiny.height - h * s) / 2, w * s, h * s);
    tinyCache.set(img, tiny);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tiny, 0, 0, W, H);
  ctx.fillStyle = 'rgba(8, 6, 3, 0.5)';
  ctx.fillRect(0, 0, W, H);
}

function drawSlide(ctx, img, index, progress, mode, W, H) {
  if (mode === 'fit') drawBackdrop(ctx, img, W, H);
  const zoomIn = index % 2 === 0;
  const zoom = 1 + 0.06 * (zoomIn ? progress : 1 - progress);
  drawFitted(ctx, img, W, H, mode, zoom, (index % 2 ? 1 : -1) * (progress - 0.5) * 0.4);
}

/** Paints the picture shown at time `t` (seconds) with the mark. `perSec` is how long each picture stays. */
export function paintSlideshowFrame(ctx, images, mode, t, perSec, W = SLIDE_W, H = SLIDE_H) {
  const n = images.length;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!n) return;
  const index = Math.min(n - 1, Math.max(0, Math.floor(t / perSec)));
  const local = t - index * perSec;
  const progress = Math.min(1, Math.max(0, local / perSec));
  if (index > 0 && local < FADE_SECONDS) {
    drawSlide(ctx, images[index - 1], index - 1, 1, mode, W, H);
    ctx.globalAlpha = local / FADE_SECONDS;
    drawSlide(ctx, images[index], index, progress, mode, W, H);
    ctx.globalAlpha = 1;
  } else {
    drawSlide(ctx, images[index], index, progress, mode, W, H);
  }
  drawIcanEraWatermark(ctx, W, H);
}

/**
 * Records the slideshow. Resolves with the finished video Blob.
 * @param {{ canvas: HTMLCanvasElement, images: Array, mode: 'fit'|'fill', perSec: number, totalSec: number,
 *           audio?: Blob|null, onProgress?: (fraction: number) => void, signal?: AbortSignal }} opts
 */
export async function renderSlideshow({ canvas, images, mode, perSec, totalSec, audio = null, onProgress, signal }) {
  const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });
  if (signal?.aborted) throw abortError();

  const ctx = canvas.getContext('2d');
  canvas.width = SLIDE_W;
  canvas.height = SLIDE_H;
  paintSlideshowFrame(ctx, images, mode, 0, perSec); // a real first frame before recording starts

  const fmt = pickRecorderFormat();
  const stream = canvas.captureStream(30);
  let audioCtx = null;
  let audioEl = null;
  let audioUrl = null;

  if (audio) {
    // Tap the audio through Web Audio into the recording; nothing is sent to the speakers while building.
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioCtx();
    await audioCtx.resume?.();
    audioUrl = URL.createObjectURL(audio);
    audioEl = new Audio();
    audioEl.src = audioUrl;
    audioEl.preload = 'auto';
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaElementSource(audioEl).connect(dest);
    dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    const recorder = new MediaRecorder(stream, fmt ? { mimeType: fmt.mime, videoBitsPerSecond: 2_500_000 } : undefined);
    let raf = null;
    let finished = false;

    const cleanup = () => {
      finished = true;
      if (raf) cancelAnimationFrame(raf);
      try { audioEl?.pause(); } catch { /* noop */ }
      audioCtx?.close?.().catch(() => {});
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      stream.getTracks().forEach((t) => t.stop());
    };

    recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
    recorder.onerror = () => { cleanup(); reject(new Error('Recording the video failed')); };
    recorder.onstop = () => {
      if (finished && !chunks.length) return;
      cleanup();
      resolve(new Blob(chunks, { type: (recorder.mimeType || fmt?.mime || 'video/webm').split(';')[0] }));
    };

    signal?.addEventListener('abort', () => {
      if (finished) return;
      recorder.onstop = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* noop */ }
      cleanup();
      reject(abortError());
    }, { once: true });

    recorder.start(1000);
    audioEl?.play().catch(() => {});
    const t0 = performance.now();
    const tick = () => {
      if (finished) return;
      const t = (performance.now() - t0) / 1000;
      paintSlideshowFrame(ctx, images, mode, Math.min(t, totalSec - 0.001), perSec);
      onProgress?.(Math.min(1, t / totalSec));
      if (t >= totalSec) {
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
  });
}
