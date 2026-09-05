// The IcanEra "burned-in" video watermark — the same pattern TikTok/Instagram
// use so a clip still carries the platform's mark after it's downloaded and
// reshared elsewhere. Two entry points:
//   - drawIcanEraWatermark(ctx, w, h): stamps one frame. Called every tick
//     inside PitchVideoRecorder's live canvas.captureStream() draw loop, so
//     videos recorded in-app are watermarked as they're recorded — no
//     separate pass needed.
//   - applyWatermarkToVideoBlob(file): re-encodes an already-exported video
//     file (the "choose from device" upload path, which never touches the
//     live canvas) by decoding it into an offscreen <video>, redrawing every
//     frame onto a canvas with the same watermark, and re-capturing that
//     canvas via MediaRecorder. This is the only way to burn a mark into
//     pixels that didn't come from our own recorder.

const WORDMARK = 'IcanEra';

function drawDiamondGlyph(ctx, cx, cy, r) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = r * 0.6;
  const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#b9d6ff');
  grad.addColorStop(1, '#8a6ee0');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.85, cy - r * 0.2);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.85, cy - r * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  ctx.restore();
}

/** Stamps the IcanEra mark onto the bottom-right of whatever's currently on `ctx`. */
export function drawIcanEraWatermark(ctx, width, height) {
  if (!width || !height) return;
  const pad = Math.max(10, Math.round(width * 0.035));
  const fontSize = Math.max(13, Math.round(width * 0.03));
  const glyphR = fontSize * 0.5;

  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.font = `700 ${fontSize}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = fontSize * 0.3;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';

  const textX = width - pad;
  const textY = height - pad;
  ctx.fillText(WORDMARK, textX, textY);

  const textWidth = ctx.measureText(WORDMARK).width;
  const diamondCx = textX - textWidth - glyphR * 1.8;
  const diamondCy = textY - fontSize * 0.42;
  drawDiamondGlyph(ctx, diamondCx, diamondCy, glyphR);
  ctx.restore();
}

function pickSupportedMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  if (typeof MediaRecorder === 'undefined') return null;
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || null;
}

/**
 * Re-encodes a video file/blob with the IcanEra mark burned into every
 * frame. Falls back to returning the original blob untouched if the
 * browser lacks the needed APIs (old Safari, etc.) rather than blocking
 * the upload — a missing watermark is better than a broken pitch.
 * @param {Blob|File} inputBlob
 * @param {{ onProgress?: (fraction: number) => void }} [opts]
 * @returns {Promise<Blob>}
 */
export function applyWatermarkToVideoBlob(inputBlob, { onProgress } = {}) {
  return new Promise((resolve) => {
    const mimeType = pickSupportedMimeType();
    if (!mimeType || typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
      console.warn('[videoWatermark] MediaRecorder/captureStream unsupported — uploading without a re-encoded watermark.');
      resolve(inputBlob);
      return;
    }

    const cleanup = [];
    const runCleanup = () => cleanup.forEach((fn) => { try { fn(); } catch { /* noop */ } });
    const failSafe = (err) => {
      console.warn('[videoWatermark] Watermarking failed, uploading the original clip instead:', err?.message || err);
      runCleanup();
      resolve(inputBlob);
    };

    const objectUrl = URL.createObjectURL(inputBlob);
    cleanup.push(() => URL.revokeObjectURL(objectUrl));

    const video = document.createElement('video');
    video.src = objectUrl;
    video.muted = false;
    video.playsInline = true;
    video.style.position = 'fixed';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.style.top = '-9999px';
    document.body.appendChild(video);
    cleanup.push(() => video.remove());

    const timeout = setTimeout(() => failSafe(new Error('Timed out waiting for video metadata')), 15000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 720;
        canvas.height = video.videoHeight || 1280;
        const ctx = canvas.getContext('2d');

        const canvasStream = canvas.captureStream(30);

        // Tap the video's decoded audio via Web Audio instead of connecting
        // it to speakers, so processing stays silent — routing to
        // ctx.destination would make every upload audibly play out loud.
        let audioTrack = null;
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          const audioCtx = new AudioCtx();
          const source = audioCtx.createMediaElementSource(video);
          const dest = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          audioTrack = dest.stream.getAudioTracks()[0] || null;
          cleanup.push(() => audioCtx.close().catch(() => {}));
        } catch (audioErr) {
          console.warn('[videoWatermark] Could not tap audio track, output will be silent:', audioErr?.message);
        }

        const outputStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...(audioTrack ? [audioTrack] : []),
        ]);

        const recorder = new MediaRecorder(outputStream, { mimeType, videoBitsPerSecond: 4_000_000 });
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

        let rafId = null;
        const drawLoop = () => {
          if (video.paused || video.ended) return;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          drawIcanEraWatermark(ctx, canvas.width, canvas.height);
          if (video.duration) onProgress?.(Math.min(1, video.currentTime / video.duration));
          rafId = requestAnimationFrame(drawLoop);
        };
        cleanup.push(() => rafId && cancelAnimationFrame(rafId));

        recorder.onstop = () => {
          runCleanup();
          if (chunks.length === 0) {
            resolve(inputBlob);
            return;
          }
          resolve(new Blob(chunks, { type: 'video/webm' }));
        };
        recorder.onerror = (e) => failSafe(e.error || e);

        video.onended = () => {
          if (recorder.state !== 'inactive') recorder.stop();
        };
        video.onerror = () => failSafe(new Error('Source video failed to decode'));

        video.play().then(() => {
          recorder.start();
          drawLoop();
        }).catch(failSafe);
      } catch (err) {
        failSafe(err);
      }
    };

    video.load();
  });
}
