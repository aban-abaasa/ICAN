import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Upload, SwitchCamera, Square, RotateCcw, Scissors, CheckCircle, Smartphone, Loader2, Play } from 'lucide-react';
import { drawIcanEraWatermark, applyWatermarkToVideoBlob } from '../utils/videoWatermark';
import {
  pickRecorderFormat,
  isVideoFile,
  probeVideo,
  formatBytes,
  formatDuration,
  videoExtension,
  createBlobTask,
} from '../utils/videoFormat';

// The capture + preview half of the pitch recorder.
//  - Opens the camera as soon as the screen appears, so the person sees themselves BEFORE recording.
//  - One big record button, a countdown to the time limit, switch camera and "choose from gallery" within reach.
//  - Records in whatever format the phone supports (WebM on Android, MP4 on iPhone/Safari).
//  - Falls back to the phone's own camera app when the browser can't record (or camera access is refused).
//  - After recording or picking a file: a full preview with play controls, size/length, Retake, Trim and Next.
// It hands the finished clip to its parent through onVideoReady; the parent owns the rest of the publish flow.

export const MAX_RECORD_SECONDS = 180;
export const MAX_UPLOAD_MB = 100;

const CAMERA_PROBLEM = {
  denied: 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.',
  notfound: 'No camera was found on this device.',
  unsupported: "This browser can't record video here. You can use your phone's camera app instead.",
  error: "The camera couldn't start. Try again, or use your phone's camera app.",
};

export default function PitchCameraStage({
  cameraMode = 'front',
  previewUrl,
  videoMeta,
  onClose,
  onVideoReady,
  onRetake,
  onTrim,
  onNext,
}) {
  const videoRef = useRef(null);      // hidden element that plays the live camera stream
  const canvasRef = useRef(null);     // what the person sees AND what gets recorded (so the mark is baked in)
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const rafRef = useRef(null);
  const startedAtRef = useRef(0);
  const previewVideoRef = useRef(null);
  const openSeqRef = useRef(0);       // ignores a camera that finished opening after we asked for another

  const [camState, setCamState] = useState('opening'); // opening | ready | denied | notfound | unsupported | error
  const [facing, setFacing] = useState(cameraMode === 'back' ? 'environment' : 'user');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [fileError, setFileError] = useState('');
  const [readingFile, setReadingFile] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  const stopCamera = useCallback(() => {
    openSeqRef.current += 1;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startDrawLoop = useCallback(() => {
    const draw = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && video.videoWidth) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawIcanEraWatermark(ctx, canvas.width, canvas.height);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    draw();
  }, []);

  const openCamera = useCallback(async (facingMode) => {
    stopCamera();
    const seq = openSeqRef.current;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
      setCamState('unsupported');
      return;
    }
    setCamState('opening');
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    try {
      let stream;
      try {
        // 720p portrait: sharp enough for a pitch, light enough for modest phones to encode smoothly.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode }, width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30 } },
          audio,
        });
      } catch (err) {
        if (err?.name !== 'OverconstrainedError') throw err;
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio });
      }
      if (seq !== openSeqRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      video.muted = true;
      await video.play().catch(() => {});
      startDrawLoop();
      setCamState('ready');
      navigator.mediaDevices.enumerateDevices()
        .then((d) => setHasMultipleCameras(d.filter((x) => x.kind === 'videoinput').length > 1))
        .catch(() => {});
    } catch (err) {
      if (seq !== openSeqRef.current) return;
      console.warn('Camera could not start:', err?.name, err?.message);
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') setCamState('denied');
      else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') setCamState('notfound');
      else setCamState('error');
    }
  }, [startDrawLoop, stopCamera]);

  // Show the viewfinder whenever there is no clip yet (first open and after Retake); release the camera once there is one.
  useEffect(() => {
    if (!previewUrl) openCamera(facing);
    else stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl]);
  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; try { recorder.stop(); } catch { /* noop */ } }
    stopCamera();
  }, [stopCamera]);

  const finishRecording = useCallback((recorder, startedAt) => {
    const type = (recorder.mimeType || pickRecorderFormat()?.mime || 'video/webm').split(';')[0];
    const blob = new Blob(chunksRef.current, { type });
    chunksRef.current = [];
    stopCamera();
    setIsRecording(false);
    if (blob.size === 0) { setFileError('Nothing was recorded. Please try again.'); openCamera(facing); return; }
    onVideoReady({ blob, durationSec: (Date.now() - startedAt) / 1000, source: 'camera', needsWatermark: false });
  }, [facing, onVideoReady, openCamera, stopCamera]);

  const startRecording = () => {
    if (camState !== 'ready' || !canvasRef.current || !streamRef.current) return;
    setFileError('');
    try {
      const fmt = pickRecorderFormat();
      const canvasStream = canvasRef.current.captureStream(30);
      streamRef.current.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
      const recorder = new MediaRecorder(canvasStream, fmt ? { mimeType: fmt.mime, videoBitsPerSecond: 2_500_000 } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      const startedAt = Date.now();
      recorder.onstop = () => finishRecording(recorder, startedAt);
      recorder.onerror = () => { setFileError('Recording stopped unexpectedly. Please try again.'); setIsRecording(false); };
      recorderRef.current = recorder;
      startedAtRef.current = startedAt;
      recorder.start(1000); // a chunk every second, so a long take isn't held as one piece
      setElapsed(0);
      setIsRecording(true);
    } catch (err) {
      console.error('Could not start recording:', err);
      setCamState('unsupported');
    }
  };

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  // Timer + automatic stop at the time limit.
  useEffect(() => {
    if (!isRecording) return undefined;
    const id = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsed(secs);
      if (secs >= MAX_RECORD_SECONDS) stopRecording();
    }, 250);
    return () => clearInterval(id);
  }, [isRecording, stopRecording]);

  // Frames freeze when the browser hides the page, so keep what was recorded so far instead of a frozen tail.
  useEffect(() => {
    const onHide = () => { if (document.hidden && isRecording) stopRecording(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [isRecording, stopRecording]);

  const switchCamera = () => {
    if (isRecording) return;
    const next = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    openCamera(next);
  };

  // Picked from the gallery, or filmed with the phone's own camera app.
  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // the same file can be chosen again after Retake
    if (!file) return;
    setFileError('');
    if (!isVideoFile(file)) {
      setFileError('That file is not a video. Please choose an MP4, MOV or WebM video.');
      return;
    }
    const sizeMB = file.size / 1024 / 1024;
    if (sizeMB > MAX_UPLOAD_MB) {
      setFileError(`This video is ${sizeMB.toFixed(0)} MB. The limit is ${MAX_UPLOAD_MB} MB, so please trim it or pick a shorter clip.`);
      return;
    }
    setReadingFile(true);
    const info = await probeVideo(file);
    setReadingFile(false);
    const durationSec = info?.durationSec ?? null;
    // The IcanEra mark is stamped on in the background while the person fills in the pitch details.
    const task = createBlobTask(
      ({ signal, onProgress }) => applyWatermarkToVideoBlob(file, { onProgress, signal }),
      { timeoutMs: Math.max(60000, (durationSec || 60) * 2500) }
    );
    onVideoReady({ blob: file, durationSec, source: 'upload', needsWatermark: true, task, width: info?.width, height: info?.height });
  };

  // ---------- preview helpers ----------
  const togglePlay = () => {
    const v = previewVideoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  };
  // MediaRecorder files report an infinite length and can't be scrubbed until the browser has seen the end.
  const fixRecordedDuration = (e) => {
    const v = e.currentTarget;
    if (v.duration === Infinity) {
      v.currentTime = 1e101;
      v.ontimeupdate = () => { v.ontimeupdate = null; v.currentTime = 0; };
    }
  };

  useEffect(() => { setPlaying(false); setPreviewFailed(false); }, [previewUrl]);

  const timeLeft = Math.max(0, MAX_RECORD_SECONDS - elapsed);

  // ================= PREVIEW =================
  if (previewUrl) {
    const meta = [
      videoMeta?.durationSec ? formatDuration(videoMeta.durationSec) : null,
      videoMeta?.size ? formatBytes(videoMeta.size) : null,
      videoMeta?.type ? videoExtension({ type: videoMeta.type }).toUpperCase() : null,
    ].filter(Boolean).join(' · ');

    return (
      <div className="flex h-full w-full flex-col bg-black text-white">
        <div className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 active:bg-white/20">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Preview</p>
            {meta && <p className="truncate text-xs text-white/60">{meta}</p>}
          </div>
        </div>

        <div className="relative min-h-0 flex-1 bg-black">
          {previewFailed ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
              <Smartphone className="h-8 w-8 text-white/50" />
              <p className="text-sm text-white/80">This phone can't preview this video format.</p>
              <p className="text-xs text-white/50">It can still be uploaded and will play for viewers on supported devices.</p>
            </div>
          ) : (
            <>
              <video
                key={previewUrl}
                ref={previewVideoRef}
                src={previewUrl}
                playsInline
                preload="metadata"
                controls
                className="h-full w-full bg-black object-contain"
                onLoadedMetadata={fixRecordedDuration}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setPreviewFailed(true)}
              />
              {!playing && (
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label="Play preview"
                  className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 ring-1 ring-white/30 active:scale-95"
                >
                  <Play className="ml-1 h-7 w-7 fill-white text-white" />
                </button>
              )}
            </>
          )}
        </div>

        {fileError && <p className="px-4 pt-2 text-center text-xs text-red-300" role="alert">{fileError}</p>}

        <div className="flex items-center gap-2 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onRetake} className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-white/10 px-4 text-sm font-medium active:bg-white/20">
            <RotateCcw className="h-4 w-4" /> Retake
          </button>
          <button type="button" onClick={onTrim} className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-white/10 px-4 text-sm font-medium active:bg-white/20">
            <Scissors className="h-4 w-4" /> Trim
          </button>
          <button type="button" onClick={onNext} className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-sm font-bold active:from-green-600 active:to-emerald-600">
            <CheckCircle className="h-5 w-5" /> Next
          </button>
        </div>
      </div>
    );
  }

  // ================= CAMERA =================
  const cameraBlocked = camState !== 'ready' && camState !== 'opening';

  return (
    <div className="relative flex h-full w-full flex-col bg-black text-white">
      {/* the stream source stays hidden; the canvas is what is shown and recorded */}
      <video ref={videoRef} className="hidden" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full bg-black object-contain" />

      {/* time-limit bar */}
      {isRecording && (
        <div className="absolute inset-x-0 top-0 z-30 h-1 bg-white/20">
          <div className="h-full bg-red-500 transition-[width] duration-300" style={{ width: `${Math.min(100, (elapsed / MAX_RECORD_SECONDS) * 100)}%` }} />
        </div>
      )}

      {/* top row: close + timer */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {!isRecording && onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 backdrop-blur active:bg-black/70">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div className="flex-1" />
        {isRecording && (
          <div className="flex items-center gap-2 rounded-full border border-red-500/50 bg-black/55 px-3 py-1.5 backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            <span className="text-xs font-semibold tabular-nums">{formatDuration(elapsed)}</span>
            <span className="text-xs text-white/60">· {formatDuration(timeLeft)} left</span>
          </div>
        )}
        <div className="flex-1" />
        {!isRecording && <div className="h-11 w-11" aria-hidden="true" />}
      </div>

      {camState === 'opening' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/70" aria-label="Opening camera" />
        </div>
      )}

      {cameraBlocked && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <Camera className="h-10 w-10 text-white/40" />
          <p className="text-sm text-white/85">{CAMERA_PROBLEM[camState]}</p>
          <div className="flex w-full max-w-xs flex-col gap-2 pt-1">
            {(camState === 'denied' || camState === 'error') && (
              <button type="button" onClick={() => openCamera(facing)} className="min-h-[48px] rounded-xl bg-white/15 text-sm font-medium active:bg-white/25">Try again</button>
            )}
            <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold active:bg-emerald-700">
              <Smartphone className="h-4 w-4" /> Use phone camera
              <input type="file" accept="video/*" capture={facing === 'environment' ? 'environment' : 'user'} onChange={handleFile} className="hidden" />
            </label>
          </div>
        </div>
      )}

      {/* bottom controls */}
      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/70 to-transparent">
        {fileError && <p className="mb-3 text-center text-xs text-red-300" role="alert">{fileError}</p>}
        {readingFile && <p className="mb-3 text-center text-xs text-white/70">Reading your video…</p>}
        {!isRecording && camState === 'ready' && (
          <p className="mb-3 text-center text-xs text-white/70">Tap to record · up to {formatDuration(MAX_RECORD_SECONDS)}</p>
        )}

        <div className="mx-auto flex max-w-sm items-center justify-between">
          {/* choose a video from the gallery */}
          <label
            aria-label="Choose a video from your phone"
            className={`flex h-12 w-12 cursor-pointer flex-col items-center justify-center rounded-full bg-white/15 backdrop-blur active:bg-white/25 ${isRecording ? 'invisible' : ''}`}
          >
            <Upload className="h-5 w-5" />
            <input type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.3gp,.mkv" onChange={handleFile} className="hidden" />
          </label>

          {/* record / stop */}
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={camState !== 'ready'}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            className="flex h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-white disabled:opacity-40 active:scale-95"
          >
            {isRecording
              ? <Square className="h-7 w-7 fill-red-500 text-red-500" />
              : <span className="h-[56px] w-[56px] rounded-full bg-red-500" />}
          </button>

          {/* flip camera */}
          <button
            type="button"
            onClick={switchCamera}
            disabled={!hasMultipleCameras || camState !== 'ready'}
            aria-label={`Switch to ${facing === 'user' ? 'back' : 'front'} camera`}
            className={`flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur active:bg-white/25 disabled:opacity-30 ${isRecording ? 'invisible' : ''}`}
          >
            <SwitchCamera className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
