import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Camera, Film, SwitchCamera, RotateCcw, Scissors, Smartphone,
  Loader2, Play, Pause, Timer, Volume2, VolumeX,
} from 'lucide-react';
import './pitch-camera-stage.css';
import PitchSlideshowBuilder from './PitchSlideshowBuilder';
import { drawIcanEraWatermark, applyWatermarkToVideoBlob } from '../utils/videoWatermark';
import {
  pickRecorderFormat,
  isVideoFile,
  isImageFile,
  probeVideo,
  formatBytes,
  formatDuration,
  videoExtension,
  createBlobTask,
} from '../utils/videoFormat';

// The capture + preview half of the pitch recorder, in the Pitchin "Ebony & Gold" classic style.
//  - Full screen: the camera (and later the preview) fills the whole screen and the controls float over it as small,
//    transparent icons. The recording has the same shape as the screen, so what you see is what you record.
//  - Opens the camera as soon as the screen appears, so the person sees themselves BEFORE recording.
//  - Record button whose ring fills toward the time limit, optional 3-2-1 countdown, pause/resume, a live microphone
//    level, switch camera and "Library". The screen is kept awake while recording.
//  - Library takes a video, or several pictures: pictures open the photo-pitch builder (pictures + audio -> video).
//  - Records in whatever format the phone supports (WebM on Android, MP4 on iPhone/Safari).
//  - Falls back to the phone's own camera app when the browser can't record (or camera access is refused).
//  - After recording or building: a preview with play/scrub controls, size/length/format, Retake, Trim, Next.
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

const readTimerPref = () => { try { return localStorage.getItem(TIMER_KEY) === '1'; } catch { return false; } };
const buzz = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };
const even = (v) => Math.max(2, Math.round(v / 2) * 2);

// Recording shape: the screen's own proportions (so the full-screen picture is exactly what is recorded), kept
// within sensible limits, and never bigger than the camera can really deliver (no blurry upscaling).
const outputSize = (landscape, sourceLongSide, screenAr) => {
  const big = sourceLongSide >= 1280;
  if (landscape) return big ? { w: 1280, h: 720 } : { w: 960, h: 540 };
  const ar = Math.min(9 / 16, Math.max(0.42, screenAr || 9 / 16));
  const long = big ? 1280 : 960;
  return { w: even(long * ar), h: long };
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
  const rootRef = useRef(null);
  const videoRef = useRef(null);      // hidden element that plays the live camera stream
  const canvasRef = useRef(null);     // what the person sees AND what gets recorded (so the mark is baked in)
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const rafRef = useRef(null);
  const previewVideoRef = useRef(null);
  const openSeqRef = useRef(0);       // ignores a camera that finished opening after we asked for another
  const audioRef = useRef(null);      // { ctx, analyser, data } for the microphone level
  const meterRef = useRef(null);
  const levelRef = useRef(0);
  const wakeRef = useRef(null);
  const countRef = useRef(null);      // countdown interval
  const accMsRef = useRef(0);         // recorded time in finished segments (pause/resume)
  const segStartRef = useRef(null);   // start of the running segment, null while paused
  const finalMsRef = useRef(0);
  const fixingRef = useRef(false);
  const screenArRef = useRef(9 / 16);

  const [camState, setCamState] = useState('opening'); // opening | ready | denied | notfound | unsupported | error
  const [landscape, setLandscape] = useState(false);
  const [screenAr, setScreenAr] = useState(9 / 16);
  const [canvasAr, setCanvasAr] = useState(9 / 16);
  const [facing, setFacing] = useState(cameraMode === 'back' ? 'environment' : 'user');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [count, setCount] = useState(null);
  const [useCountdown, setUseCountdown] = useState(readTimerPref);
  const [elapsed, setElapsed] = useState(0);
  const [fileError, setFileError] = useState('');
  const [readingFile, setReadingFile] = useState(false);
  const [slideFiles, setSlideFiles] = useState(null); // pictures chosen from the library -> photo-pitch builder
  const [playing, setPlaying] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);

  const elapsedMs = () => accMsRef.current + (segStartRef.current ? Date.now() - segStartRef.current : 0);

  const releaseAwake = () => { try { wakeRef.current?.release(); } catch { /* already released */ } wakeRef.current = null; };
  const holdAwake = async () => { try { wakeRef.current = (await navigator.wakeLock?.request('screen')) || null; } catch { /* optional */ } };

  // follow the size of the screen area (and the phone being turned, while idle)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      screenArRef.current = width / height;
      setScreenAr(width / height);
      if (!isRecording && !previewUrl) setLandscape(width > height * 1.1);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [isRecording, previewUrl, slideFiles]);

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

  // Sizes the recording canvas for the screen shape and what the camera really delivers.
  const landscapeRef = useRef(landscape);
  landscapeRef.current = landscape;
  const applyCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!canvas || !track) return;
    const s = track.getSettings?.() || {};
    const { w, h } = outputSize(landscapeRef.current, Math.max(s.width || 0, s.height || 0), screenArRef.current);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    setCanvasAr(w / h);
  }, []);

  useEffect(() => { if (!isRecording) applyCanvasSize(); }, [landscape, screenAr, isRecording, applyCanvasSize]);

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
    const wide = landscapeRef.current;
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: wide ? 1280 : 720 },
            height: { ideal: wide ? 720 : 1280 },
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

  // Show the viewfinder whenever there is no clip yet (first open and after Retake); release the camera once there
  // is one, or while the photo-pitch builder is open.
  useEffect(() => {
    if (!previewUrl && !slideFiles) openCamera(facing);
    else stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl, slideFiles]);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; try { recorder.stop(); } catch { /* noop */ } }
    releaseAwake();
    stopCamera();
  }, [stopCamera]);

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

  // A video from the library, or one filmed with the phone's own camera app.
  const acceptVideoFile = async (file) => {
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

  // Library: one video, or several pictures (which open the photo-pitch builder).
  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = ''; // the same files can be chosen again after Retake
    if (!files.length) return;
    setFileError('');
    const videos = files.filter(isVideoFile);
    const pictures = files.filter(isImageFile);
    if (videos.length) { await acceptVideoFile(videos[0]); return; }
    if (pictures.length) { setSlideFiles(pictures); return; }
    setFileError('Please choose a video, or pictures for a photo pitch.');
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

  // ================= PHOTO PITCH =================
  if (slideFiles) {
    return (
      <PitchSlideshowBuilder
        initialFiles={slideFiles}
        onCancel={() => setSlideFiles(null)}
        onDone={({ blob, durationSec, width, height }) => {
          setSlideFiles(null);
          onVideoReady({ blob, durationSec, source: 'slideshow', needsWatermark: false, width, height });
        }}
      />
    );
  }

  // ================= PREVIEW =================
  if (previewUrl) {
    const meta = [
      videoMeta?.durationSec ? formatDuration(videoMeta.durationSec) : null,
      videoMeta?.size ? formatBytes(videoMeta.size) : null,
      videoMeta?.type ? videoExtension({ type: videoMeta.type }).toUpperCase() : null,
    ].filter(Boolean).join('  ·  ');
    const videoAr = videoMeta?.width && videoMeta?.height ? videoMeta.width / videoMeta.height : null;
    // fill the screen when the video is shaped like it; otherwise show it whole
    const contain = !videoAr || Math.abs(videoAr - screenAr) > 0.06;
    const total = dur > 0 ? dur : (videoMeta?.durationSec || 0);

    return (
      <div className="pcs" ref={rootRef}>
        {previewFailed ? (
          <div className="pcs-preview-fail">
            <Smartphone size={30} color="#c4a052" />
            <p>This phone can't preview this video format.</p>
            <small>It can still be uploaded, and will play for viewers on supported devices.</small>
          </div>
        ) : (
          <video
            key={previewUrl}
            ref={previewVideoRef}
            src={previewUrl}
            className={`pcs-video ${contain ? 'is-contain' : ''}`}
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
        )}
        <div className="pcs-scrim-top" />
        <div className="pcs-scrim-bottom" />

        <div className="pcs-top">
          <button type="button" onClick={onClose} aria-label="Close" className="pcs-ico"><ArrowLeft /></button>
          <div className="grow">
            <h2 className="pcs-title">Your Pitch</h2>
            {meta && <p className="pcs-meta">{meta}</p>}
          </div>
          <div className="end">
            {!previewFailed && (
              <button type="button" className="pcs-ico" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted ? <VolumeX /> : <Volume2 />}
              </button>
            )}
          </div>
        </div>

        {!previewFailed && !playing && (
          <button type="button" onClick={togglePlay} aria-label="Play preview" className="pcs-playbtn">
            <Play size={26} fill="currentColor" style={{ marginLeft: 3 }} />
          </button>
        )}

        <div className="pcs-bottom">
          {fileError && <p className="pcs-error" role="alert">{fileError}</p>}
          {!previewFailed && (
            <div className="pcs-scrub">
              <button type="button" className="pcs-ico" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} style={{ width: 36, height: 36 }}>
                {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
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
            </div>
          )}
          <div className="pcs-actions">
            <div className="tools">
              <button type="button" onClick={onRetake} className="pcs-ico"><RotateCcw /><span className="cap">Retake</span></button>
              <button type="button" onClick={onTrim} className="pcs-ico"><Scissors /><span className="cap">Trim</span></button>
            </div>
            <button type="button" onClick={onNext} className="pcs-pill primary">Next <ArrowRight size={18} /></button>
          </div>
        </div>
      </div>
    );
  }

  // ================= CAMERA =================
  const cameraBlocked = camState !== 'ready' && camState !== 'opening';
  const frac = isRecording ? Math.min(1, elapsed / MAX_RECORD_SECONDS) : 0;
  const coverFits = Math.abs(canvasAr - screenAr) < 0.06; // same shape as the screen: fill it, nothing cropped away
  const idle = !isRecording && count === null;
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
    <div className={`pcs ${isRecording ? 'is-rec' : ''}`} ref={rootRef}>
      {/* the stream source stays hidden; the canvas is what is shown and recorded */}
      <video ref={videoRef} className="hidden" style={{ display: 'none' }} autoPlay playsInline muted />
      <canvas ref={canvasRef} className={`pcs-canvas ${coverFits ? '' : 'is-contain'}`} />
      <div className="pcs-scrim-top" />
      <div className="pcs-scrim-bottom" />
      <div className="pcs-brackets" aria-hidden="true">
        <span className="pcs-corner tl" /><span className="pcs-corner tr" /><span className="pcs-corner bl" /><span className="pcs-corner br" />
      </div>

      <div className="pcs-top">
        {idle ? (
          <button type="button" onClick={onClose} aria-label="Close" className="pcs-ico"><ArrowLeft /></button>
        ) : <div style={{ width: 44 }} aria-hidden="true" />}

        <div className="grow">
          {isRecording ? (
            <span className={`pcs-recpill ${paused ? 'is-paused' : ''}`}>
              <i />
              <span>{formatDuration(elapsed)}</span>
              <em>/ {formatDuration(MAX_RECORD_SECONDS)} · {formatDuration(Math.max(0, MAX_RECORD_SECONDS - elapsed))} left</em>
            </span>
          ) : (
            <>
              <h2 className="pcs-title">Record Your Pitch</h2>
              <span className="pcs-sub">Pitchin</span>
            </>
          )}
        </div>

        <div className="end">
          {idle && camState === 'ready' && (
            <>
              <button
                type="button"
                onClick={toggleCountdown}
                aria-pressed={useCountdown}
                aria-label={useCountdown ? '3 second countdown on' : '3 second countdown off'}
                className="pcs-ico"
              >
                <Timer />
                {useCountdown && <span className="badge">3</span>}
              </button>
              <button
                type="button"
                onClick={switchCamera}
                disabled={!hasMultipleCameras}
                aria-label={`Switch to ${facing === 'user' ? 'back' : 'front'} camera`}
                className="pcs-ico"
              >
                <SwitchCamera />
              </button>
            </>
          )}
        </div>
      </div>

      {camState === 'opening' && (
        <div className="pcs-overlay" style={{ background: 'transparent' }}>
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

      {cameraBlocked && (
        <div className="pcs-blocked">
          <Camera size={34} color="#c4a052" />
          <p>{CAMERA_PROBLEM[camState]}</p>
          {(camState === 'denied' || camState === 'error') && (
            <button type="button" onClick={() => openCamera(facing)} className="pcs-pill">Try again</button>
          )}
          <label className="pcs-pill primary">
            <Smartphone size={16} /> Use phone camera
            <input type="file" accept="video/*" capture={facing === 'environment' ? 'environment' : 'user'} onChange={handleFiles} className="hidden" style={{ display: 'none' }} />
          </label>
          <label className="pcs-pill">
            <Film size={16} /> Choose from library
            <input type="file" accept="video/*,image/*" multiple onChange={handleFiles} className="hidden" style={{ display: 'none' }} />
          </label>
        </div>
      )}

      <div className="pcs-bottom">
        {fileError && <p className="pcs-error" role="alert">{fileError}</p>}
        {readingFile && <p className="pcs-hint">Reading your video…</p>}
        {!fileError && !readingFile && hint && <p className="pcs-hint">{hint}</p>}
        {camState === 'ready' && <div className="pcs-meter" aria-hidden="true"><div ref={meterRef} className="pcs-meter-fill" /></div>}

        <div className="pcs-row">
          {/* choose a video, or pictures for a photo pitch */}
          <label className={`pcs-ico left ${idle ? '' : 'is-hidden'}`} aria-label="Choose a video or pictures from your phone">
            <Film />
            <span className="cap">Library</span>
            <input type="file" accept="video/*,image/*,.mp4,.mov,.m4v,.webm,.3gp,.mkv" multiple onChange={handleFiles} className="hidden" style={{ display: 'none' }} />
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

          {/* pause while recording */}
          {isRecording ? (
            <button type="button" onClick={togglePause} className="pcs-ico right" aria-label={paused ? 'Resume recording' : 'Pause recording'}>
              {paused ? <Play fill="currentColor" /> : <Pause fill="currentColor" />}
              <span className="cap">{paused ? 'Resume' : 'Pause'}</span>
            </button>
          ) : <span className="pcs-ico right is-hidden" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}
