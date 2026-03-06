/**
 * videoCompressor.js
 *
 * Browser-side video compression using ffmpeg.wasm (single-threaded core).
 * Loaded lazily — the ~10 MB WASM binary is only fetched the first time it's needed.
 *
 * Target output specs (tuned for Supabase 50 MB Free-Tier limit):
 *   • Resolution : capped at 1280 × 720 (preserves aspect ratio)
 *   • Video      : H.264  CRF 28  preset fast
 *   • Audio      : AAC 64 kbps
 *   • Container  : MP4 (faststart — stream-friendly)
 *
 * Typical real-world results:
 *   1-min  1080p  raw ≈ 200 MB  →  compressed ≈ 25–40 MB
 *   30-sec  720p  raw ≈  80 MB  →  compressed ≈ 10–15 MB
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// We load from unpkg CDN so the 10 MB WASM file is never part of your JS bundle.
// Change CORE_VERSION if you want to pin to a specific release.
const CORE_VERSION = '0.12.6';
const CORE_CDN = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

// Singleton — reuse the same loaded instance across uploads in a session.
let ffmpegInstance = null;
let loadPromise = null;   // avoid double-loading on concurrent calls

/**
 * Load (or reuse) the ffmpeg instance.
 * @returns {Promise<FFmpeg>}
 */
const getFFmpeg = async () => {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  if (!loadPromise) {
    loadPromise = (async () => {
      const ff = new FFmpeg();

      // Fetch WASM from CDN and expose as Blob URL
      // (avoids CORS issues and works on any host)
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${CORE_CDN}/ffmpeg-core.js`,   'text/javascript'),
        toBlobURL(`${CORE_CDN}/ffmpeg-core.wasm`, 'application/wasm'),
      ]);

      await ff.load({ coreURL, wasmURL });
      ffmpegInstance = ff;
      return ff;
    })();
  }

  return loadPromise;
};

/**
 * Compress a video File in the browser using ffmpeg.wasm.
 *
 * @param {File}   file             - The original video File object
 * @param {Object} options
 * @param {(ratio: number) => void} [options.onProgress] - Called with 0–1 progress
 * @param {(msg:  string) => void}  [options.onLog]      - Raw ffmpeg log lines (optional)
 * @param {number} [options.maxWidthPx=1280]  - Maximum output width in pixels
 * @param {number} [options.maxHeightPx=720]  - Maximum output height in pixels
 * @param {number} [options.crf=28]           - H.264 quality (lower = better, 18–35 = sane)
 * @param {string} [options.preset='fast']    - Encoding speed preset
 * @param {number} [options.audioBitrateK=64] - Audio bitrate (kbps)
 *
 * @returns {Promise<File>} Compressed MP4 File
 */
export const compressVideo = async (file, options = {}) => {
  const {
    onProgress,
    onLog,
    maxWidthPx  = 1280,
    maxHeightPx = 720,
    crf         = 28,
    preset      = 'fast',
    audioBitrateK = 64,
  } = options;

  const ff = await getFFmpeg();

  // Wire up optional callbacks (remove previous listeners first)
  if (onLog) {
    ff.on('log', ({ message }) => onLog(message));
  }

  const progressHandler = ({ progress }) => {
    const ratio = Math.max(0, Math.min(1, progress));
    onProgress?.(ratio);
  };
  ff.on('progress', progressHandler);

  // Derive a safe extension from the file name / mime type
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const inputName  = `input.${ext}`;
  const outputName = 'output.mp4';

  try {
    // Write input into ffmpeg's virtual FS
    await ff.writeFile(inputName, await fetchFile(file));

    // Scale filter: shrink if larger than max, keep aspect ratio, stay even-numbered
    const scaleFilter =
      `scale='if(gt(iw,${maxWidthPx}),${maxWidthPx},iw)':'if(gt(ih,${maxHeightPx}),${maxHeightPx},ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2`;

    await ff.exec([
      '-i', inputName,
      '-vf', scaleFilter,
      '-c:v', 'libx264',
      '-crf', String(crf),
      '-preset', preset,
      '-c:a', 'aac',
      '-b:a', `${audioBitrateK}k`,
      '-movflags', '+faststart',
      '-y',         // overwrite output if exists
      outputName,
    ]);

    const data = await ff.readFile(outputName);

    // Clean up virtual FS to free WASM memory
    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});

    const compressedBlob = new Blob([data.buffer], { type: 'video/mp4' });
    const compressedFile = new File(
      [compressedBlob],
      file.name.replace(/\.[^.]+$/, '') + '-compressed.mp4',
      { type: 'video/mp4' }
    );

    console.log(
      `✓ Video compressed: ${(file.size / 1024 / 1024).toFixed(1)} MB` +
      ` → ${(compressedFile.size / 1024 / 1024).toFixed(1)} MB`
    );

    return compressedFile;
  } finally {
    ff.off('progress', progressHandler);
  }
};

/**
 * Convenience: returns true if the file should be compressed before upload.
 * We compress any video over THRESHOLD_MB (regardless of whether it's already
 * under the Supabase limit) so quality/size stays consistent.
 *
 * @param {File}   file
 * @param {number} [thresholdMB=5]
 */
export const shouldCompress = (file, thresholdMB = 5) => {
  if (!file?.type?.startsWith('video/')) return false;
  return file.size > thresholdMB * 1024 * 1024;
};
