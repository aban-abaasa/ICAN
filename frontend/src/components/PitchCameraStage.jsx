import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Camera, Images, SwitchCamera, RotateCcw, Scissors, Smartphone,
  Loader2, Play, Pause, Timer, Mic, Volume2, VolumeX,
} from 'lucide-react';
import './pitch-camera-stage.css';
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

// The capture + preview half of the pitch recorder, in the Pitchin "Ebony & Gold" classic style.
//  - Opens the camera as soon as the screen appears, so the person sees themselves BEFORE recording.
//  - The picture is always cropped to a fixed portrait (phone) or landscape (desktop) frame. Phones often hand
//    over a wide landscape camera stream; cropping it keeps the recording upright and filling the feed player
//    instead of a thin strip with black bars.
//  - Big record button whose gold ring fills toward the time limit, optional 3-2-1 countdown, pause/resume,
//    a live microphone level, switch camera and "choose from gallery". The screen is kept awake while recording.
//  - Records in whatever format the phone supports (WebM on Android, MP4 on iPhone/Safari).
//  - Falls back to the phone's own camera app when the browser can't record (or camera access is refused).
//  - After recording or picking a file: a preview with play/scrub controls, size/length/format, Retake, Trim, Next.
// It hands the finished clip to its parent through onVideoReady; the parent owns the rest of the publish flow.

export const MAX_RECORD_SECONDS = 180;
export const MAX_UPLOAD_MB = 100;

const TIMER_KEY = 'pitchin-record-countdown';

const CAMERA_PROBLEM = {
  denied: 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.',
  notfound: 'No camera was found on this device.',
  unsupported: "This browser can't record video here. You can use your phone's camera app instead.",
  error: "The camera couldn't start. Try again, or use your phone's camera app.",
};

const pickShape = () => (typeof window !== 'undefined' && window.innerWidth > window.innerHeight * 1.1 ? 'landscape' : 'portrait');

const readTimerPref = () => { try { return localStorage.getItem(TIMER_KEY) === '1'; } catch { return false; } };
const buzz = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

// Output size: never bigger than the camera can really deliver (no blurry upscaling, less for modest phones to encode).
const outputSize = (shape, sourceLongSide) => {
  const big = sourceLongSide >= 1280;
  if (shape === 'landscape') return big ? { w: 1280, h: 720 } : { w: 960, h: 540 };
  return big ? { w: 720, h: 1280 } : { w: 540, h: 960 };
};

const RING_R = 38;
const RING_C = 2 * Math.PI * RING_R;

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
  const previewVideoRef = useRef(null);
  const openSeqRef = useRef(0);       // ignores a camera that finished opening after we asked for another
  const shapeRef = useRef(pickShape());
  const audioRef = useRef(null);      // { ctx, analyser, data } for the microphone level
  const meterRef = useRef(null);
  const levelRef = useRef(0);
  const wakeRef = useRef(null);
  const countRef = useRef(null);      // countdown interval
  const accMsRef = useRef(0);         // recorded time in finished segments (pause/resume)
  const segStartRef = useRef(null);   // start of the running segment, null while paused
  const finalMsRef = useRef(0);
  const fixingRef = useRef(false);

  const [camState, setCamState] = useState('opening'); // opening | ready | denied | notfound | unsupported | error
  const [shape, setShape] = useState(shapeRef.current);
  const [facing, setFacing] = useState(cameraMode === 'back' ? 'environment' : 'user');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [count, setCount] = useState(null);
  const [useCountdown, setUseCountdown] = useState(readTimerPref);
  const [elapsed, setElapsed] = useState(0);
  const [fileError, setFileError] = useState('');
  const [readingFile, setReadingFile] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);

  const elapsedMs = () => accMsRef.current + (segStartRef.current ? Date.now() - segStartRef.current : 0);

  const releaseAwake = () => { try { wakeRef.current?.release(); } catch { /* already released */ } wakeRef.current = null; };
  const holdAwake = async () => { try { wakeRef.current = (await navigator.wakeLock?.request('screen')) || null; } catch { /* optional */ } };

  const cancelCountdown = useCallback(() => {
    if (countRef.current) clearInterval(countRef.current);
    countRef.current = null;
    setCount(null);
  }, []);

  const stopCamera = useCallback(() => {
    openSeqRef.current += 1;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    audioRef.current?.ctx?.close?.().catch(() => {});
    audioRef.current = null;
    levelRef.current = 0;
    if (countRef.current) clearInterval(countRef.current);
    countRef.current = null;
    setCount(null);
  }, []);

  // Sizes the recording canvas for the chosen shape and what the camera really delivers.
  const applyCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!canvas || !track) return;
    const s = track.getSettings?.() || {};
    const { w, h } = outputSize(shapeRef.current, Math.max(s.width || 0, s.height || 0));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }, []);

  const startDrawLoop = useCallback(() => {
    const draw = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && video.videoWidth) {
        const ctx = canvas.getContext('2d');
        const cw = canvas.width;
        const ch = canvas.height;
        // "cover": fill the frame and crop the overflow, centred
        const scale = Math.max(cw / video.videoWidth, ch / video.videoHeight);
        const dw = video.videoWidth * scale;
        const dh = video.videoHeight * scale;
        ctx.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        drawIcanEraWatermark(ctx, cw, ch);
      }
      // microphone level, written straight to the DOM so it doesn't re-render the screen 60 times a second
      const audio = audioRef.current;
      if (audio && meterRef.current) {
        audio.analyser.getByteTimeDomainData(audio.data);
        let sum = 0;
        for (let i = 0; i < audio.data.length; i++) { const v = (audio.data[i] - 128) / 128; sum += v * v; }
        const level = Math.min(1, Math.sqrt(sum / audio.data.length) * 4);
        levelRef.current = Math.max(level, levelRef.current * 0.86);
        meterRef.current.style.transform = `scaleX(${levelRef.current.toFixed(3)})`;
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
    const landscape = shapeRef.current === 'landscape';
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: landscape ? 1280 : 720 },
            height: { ideal: landscape ? 720 : 1280 },
            frameRate: { ideal: 30 },
          },
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
      applyCanvasSize();

      // microphone level meter (a read-only tap: nothing is routed to the speakers)
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const tracks = stream.getAudioTracks();
        if (AudioCtx && tracks.length) {
          const ctx = new AudioCtx();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          ctx.createMediaStreamSource(new MediaStream(tracks)).connect(analyser);
          ctx.resume?.().catch(() => {});
          audioRef.current = { ctx, analyser, data: new Uint8Array(analyser.fftSize) };
        }
      } catch { /* the meter is a nicety; recording works without it */ }

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
  }, [applyCanvasSize, startDrawLoop, stopCamera]);

  // Show the viewfinder whenever there is no clip yet (first open and after Retake); release the camera once there is one.
  useEffect(() => {
    if (!previewUrl) openCamera(facing);
    else stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl]);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; try { recorder.stop(); } catch { /* noop */ } }
    releaseAwake();
    stopCamera();
  }, [stopCamera]);

  // Follow the phone being turned (only while idle: a take keeps the shape it started with).
  useEffect(() => {
    const onResize = () => {
      if (isRecording || previewUrl) return;
      const next = pickShape();
      if (next === shapeRef.current) return;
      shapeRef.current = next;
      setShape(next);
      applyCanvasSize();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [applyCanvasSize, isRecording, previewUrl]);

  const finishRecording = useCallback((recorder) => {
    const type = (recorder.mimeType || pickRecorderFormat()?.mime || 'video/webm').split(';')[0];
    const blob = new Blob(chunksRef.current, { type });
    chunksRef.current = [];
    const canvas = canvasRef.current;
    const width = canvas?.width;
    const height = canvas?.height;
    releaseAwake();
    stopCamera();
    setIsRecording(false);
    setPaused(false);
    if (blob.size === 0) { setFileError('Nothing was recorded. Please try again.'); openCamera(facing); return; }
    buzz(20);
    onVideoReady({ blob, durationSec: finalMsRef.current / 1000, source: 'camera', needsWatermark: false, width, height });
  }, [facing, onVideoReady, openCamera, stopCamera]);

  const beginRecording = () => {
    if (!canvasRef.current || !streamRef.current) return;
    setFileError('');
    try {
      audioRef.current?.ctx?.resume?.().catch(() => {});
      const fmt = pickRecorderFormat();
      const canvasStream = canvasRef.current.captureStream(30);
      streamRef.current.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
      const recorder = new MediaRecorder(canvasStream, fmt ? { mimeType: fmt.mime, videoBitsPerSecond: 2_500_000 } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => finishRecording(recorder);
      recorder.onerror = () => { setFileError('Recording stopped unexpectedly. Please try again.'); setIsRecording(false); releaseAwake(); };
      recorderRef.current = recorder;
      accMsRef.current = 0;
      segStartRef.current = Date.now();
      recorder.start(1000); // a chunk every second, so a long take isn't held as one piece
      setElapsed(0);
      setPaused(false);
      setIsRecording(true);
      buzz(20);
      holdAwake(); // a sleeping screen would end the take
    } catch (err) {
      console.error('Could not start recording:', err);
      setCamState('unsupported');
    }
  };

  const startRecording = () => {
    if (count !== null) { cancelCountdown(); return; } // a second tap cancels the countdown
    if (camState !== 'ready' || !canvasRef.current || !streamRef.current) return;
    if (!useCountdown) { beginRecording(); return; }
    let n = 3;
    setCount(n);
    buzz(8);
    countRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countRef.current);
        countRef.current = null;
        setCount(null);
        beginRecording();
      } else {
        setCount(n);
        buzz(8);
      }
    }, 1000);
  };

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    finalMsRef.current = elapsedMs();
    recorder.stop();
  }, []);

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (paused) {
      recorder.resume();
      segStartRef.current = Date.now();
      setPaused(false);
    } else {
      recorder.pause();
      accMsRef.current = elapsedMs();
      segStartRef.current = null;
      setPaused(true);
    }
    buzz(10);
  };

  // Timer + automatic stop at the time limit.
  useEffect(() => {
    if (!isRecording) return undefined;
    const id = setInterval(() => {
      const secs = Math.floor(elapsedMs() / 1000);
      setElapsed(secs);
      if (secs >= MAX_RECORD_SECONDS) stopRecording();
    }, 250);
    return () => clearInterval(id);
  }, [isRecording, stopRecording]);

  // Frames freeze when the browser hides the page, so keep what was recorded so far instead of a frozen tail.
  useEffect(() => {
    const onHide = () => {
      if (!document.hidden) return;
      if (isRecording) stopRecording();
      else cancelCountdown();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [cancelCountdown, isRecording, stopRecording]);

  const switchCamera = () => {
    if (isRecording || count !== null) return;
    const next = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    openCamera(next);
  };

  const toggleCountdown = () => {
    const next = !useCountdown;
    setUseCountdown(next);
    try { localStorage.setItem(TIMER_KEY, next ? '1' : '0'); } catch { /* not remembered */ }
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
    setDur(Number.isFinite(v.duration) ? v.duration : 0);
    if (v.duration === Infinity) {
      fixingRef.current = true;
      v.currentTime = 1e101;
      v.ontimeupdate = () => { v.ontimeupdate = null; v.currentTime = 0; fixingRef.current = false; };
    }
  };

  useEffect(() => { setPlaying(false); setPreviewFailed(false); setCur(0); setDur(0); }, [previewUrl]);

  const framePct = (value) => `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;

  // ================= PREVIEW =================
  if (previewUrl) {
    const meta = [
      videoMeta?.durationSec ? formatDuration(videoMeta.durationSec) : null,
      videoMeta?.size ? formatBytes(videoMeta.size) : null,
      videoMeta?.type ? videoExtension({ type: videoMeta.type }).toUpperCase() : null,
    ].filter(Boolean).join('  ·  ');
    const ar = videoMeta?.width && videoMeta?.height
      ? Math.max(0.5, Math.min(1.9, videoMeta.width / videoMeta.height))
      : (shape === 'landscape' ? 16 / 9 : 9 / 16);
    const total = dur > 0 ? dur : (videoMeta?.durationSec || 0);

    return (
      <div className="pcs">
        <div className="pcs-head">
          <button type="button" onClick={onClose} aria-label="Close" className="pcs-iconbtn"><ArrowLeft size={20} /></button>
          <div className="pcs-title">
            <h2>Your Pitch</h2>
            {meta && <p className="pcs-meta">{meta}</p>}
          </div>
          <div className="pcs-head-spacer" aria-hidden="true" />
        </div>

        <div className="pcs-stagewrap">
          <div className="pcs-frame" style={{ '--pcs-ar': ar }}>
            {previewFailed ? (
              <div className="pcs-preview-fail">
                <Smartphone size={30} color="#c4a052" />
                <p>This phone can't preview this video format.</p>
                <small>It can still be uploaded, and will play for viewers on supported devices.</small>
              </div>
            ) : (
              <>
                <video
                  key={previewUrl}
                  ref={previewVideoRef}
                  src={previewUrl}
                  className="pcs-video"
                  playsInline
                  preload="metadata"
                  muted={muted}
                  onClick={togglePlay}
                  onLoadedMetadata={fixRecordedDuration}
                  onDurationChange={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDur(e.currentTarget.duration); }}
                  onTimeUpdate={(e) => { if (!fixingRef.current) setCur(e.currentTarget.currentTime); }}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onError={() => setPreviewFailed(true)}
                />
                {!playing && (
                  <button type="button" onClick={togglePlay} aria-label="Play preview" className="pcs-playbtn">
                    <Play size={28} fill="currentColor" style={{ marginLeft: 3 }} />
                  </button>
                )}
                <div className="pcs-scrub">
                  <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                    {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                  </button>
                  <time>{formatDuration(cur)}</time>
                  <input
                    className="pcs-range"
                    type="range"
                    min={0}
                    max={total || 1}
                    step={0.05}
                    value={Math.min(cur, total || 1)}
                    aria-label="Seek"
                    style={{ '--pcs-fill': framePct(total ? (cur / total) * 100 : 0) }}
                    onChange={(e) => {
                      const t = Number(e.target.value);
                      setCur(t);
                      if (previewVideoRef.current) previewVideoRef.current.currentTime = t;
                    }}
                  />
                  <time>{formatDuration(total)}</time>
                  <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'}>
                    {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="pcs-deck">
          {fileError && <p className="pcs-error" role="alert">{fileError}</p>}
          <div className="pcs-actions">
            <button type="button" onClick={onRetake} className="pcs-pill"><RotateCcw size={16} /> Retake</button>
            <button type="button" onClick={onTrim} className="pcs-pill"><Scissors size={16} /> Trim</button>
            <button type="button" onClick={onNext} className="pcs-pill primary">Next <ArrowRight size={18} /></button>
          </div>
        </div>
      </div>
    );
  }

  // ================= CAMERA =================
  const cameraBlocked = camState !== 'ready' && camState !== 'opening';
  const frac = isRecording ? Math.min(1, elapsed / MAX_RECORD_SECONDS) : 0;
  const hint = count !== null
    ? 'Tap to cancel'
    : paused
      ? 'Paused. Tap play to continue'
      : isRecording
        ? 'Recording. Speak clearly and look at the lens'
        : camState === 'ready'
          ? `Tap to record · up to ${formatDuration(MAX_RECORD_SECONDS)}`
          : '';

  return (
    <div className="pcs">
      {/* the stream source stays hidden; the canvas is what is shown and recorded */}
      <video ref={videoRef} className="hidden" style={{ display: 'none' }} autoPlay playsInline muted />

      <div className="pcs-head">
        {!isRecording && count === null ? (
          <button type="button" onClick={onClose} aria-label="Close" className="pcs-iconbtn"><ArrowLeft size={20} /></button>
        ) : <div className="pcs-head-spacer" aria-hidden="true" />}

        <div className="pcs-title">
          {isRecording ? (
            <span className={`pcs-recpill ${paused ? 'is-paused' : ''}`}>
              <i />
              <span>{formatDuration(elapsed)}</span>
              <em>/ {formatDuration(MAX_RECORD_SECONDS)} · {formatDuration(Math.max(0, MAX_RECORD_SECONDS - elapsed))} left</em>
            </span>
          ) : (
            <>
              <h2>Record Your Pitch</h2>
              <span className="pcs-eyebrow">Pitchin</span>
            </>
          )}
        </div>

        {!isRecording && count === null && camState === 'ready' ? (
          <button
            type="button"
            onClick={toggleCountdown}
            aria-pressed={useCountdown}
            aria-label={useCountdown ? '3 second countdown on' : '3 second countdown off'}
            className="pcs-iconbtn pcs-timerchip"
          >
            <Timer size={20} />
            {useCountdown && <b>3s</b>}
          </button>
        ) : <div className="pcs-head-spacer" aria-hidden="true" />}
      </div>

      <div className="pcs-stagewrap">
        <div className={`pcs-frame ${isRecording ? 'is-rec' : ''}`} style={{ '--pcs-ar': shape === 'landscape' ? 16 / 9 : 9 / 16 }}>
          <canvas ref={canvasRef} className="pcs-canvas" />
          <div className="pcs-vignette" />
          <span className="pcs-corner tl" /><span className="pcs-corner tr" /><span className="pcs-corner bl" /><span className="pcs-corner br" />

          {camState === 'opening' && (
            <div className="pcs-overlay">
              <Loader2 size={30} className="animate-spin" color="#e6c980" aria-label="Opening camera" />
            </div>
          )}

          {count !== null && (
            <div className="pcs-overlay" aria-live="assertive">
              <div key={count} className="pcs-count">{count}</div>
            </div>
          )}

          {paused && (
            <div className="pcs-overlay">
              <div className="pcs-paused">Paused<small>Take a breath</small></div>
            </div>
          )}

          {camState === 'ready' && (
            <div className="pcs-meter" aria-hidden="true">
              <Mic size={14} />
              <div className="pcs-meter-track"><div ref={meterRef} className="pcs-meter-fill" /></div>
            </div>
          )}

          {cameraBlocked && (
            <div className="pcs-blocked">
              <Camera size={34} color="#c4a052" />
              <p>{CAMERA_PROBLEM[camState]}</p>
              {(camState === 'denied' || camState === 'error') && (
                <button type="button" onClick={() => openCamera(facing)} className="pcs-pill">Try again</button>
              )}
              <label className="pcs-pill primary" style={{ flex: 'none' }}>
                <Smartphone size={16} /> Use phone camera
                <input type="file" accept="video/*" capture={facing === 'environment' ? 'environment' : 'user'} onChange={handleFile} className="hidden" style={{ display: 'none' }} />
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="pcs-deck">
        {fileError && <p className="pcs-error" role="alert">{fileError}</p>}
        {readingFile && <p className="pcs-hint">Reading your video…</p>}
        {!fileError && !readingFile && hint && <p className="pcs-hint">{hint}</p>}

        <div className="pcs-row">
          {/* choose a video from the gallery */}
          <label className={`pcs-side left ${isRecording || count !== null ? 'is-hidden' : ''}`} aria-label="Choose a video from your phone">
            <span className="pcs-iconbtn"><Images size={20} /></span>
            <span className="pcs-cap">Library</span>
            <input type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.3gp,.mkv" onChange={handleFile} className="hidden" style={{ display: 'none' }} />
          </label>

          {/* record / stop, with the time-limit ring */}
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={camState !== 'ready'}
            aria-label={isRecording ? 'Stop recording' : count !== null ? 'Cancel countdown' : 'Start recording'}
            className={`pcs-rec ${isRecording ? 'is-rec' : ''} ${count !== null ? 'is-count' : ''}`}
          >
            <svg viewBox="0 0 84 84" aria-hidden="true">
              <circle className="trk" cx="42" cy="42" r={RING_R} />
              <circle className="prg" cx="42" cy="42" r={RING_R} strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - frac)} />
            </svg>
            <span className="core" />
          </button>

          {/* flip camera, or pause while recording */}
          {isRecording ? (
            <button type="button" onClick={togglePause} className="pcs-side right" aria-label={paused ? 'Resume recording' : 'Pause recording'}>
              <span className="pcs-iconbtn" aria-hidden="true">{paused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}</span>
              <span className="pcs-cap">{paused ? 'Resume' : 'Pause'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={switchCamera}
              disabled={!hasMultipleCameras || camState !== 'ready' || count !== null}
              className={`pcs-side right ${count !== null ? 'is-hidden' : ''}`}
              aria-label={`Switch to ${facing === 'user' ? 'back' : 'front'} camera`}
              style={!hasMultipleCameras || camState !== 'ready' ? { opacity: 0.35, cursor: 'default' } : undefined}
            >
              <span className="pcs-iconbtn" aria-hidden="true"><SwitchCamera size={20} /></span>
              <span className="pcs-cap">Flip</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
