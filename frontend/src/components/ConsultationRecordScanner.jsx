import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Loader, ScanLine, X } from 'lucide-react';
import { parseRecordCode } from '../utils/consultationAttachments';

// Camera scanner for the QR printed on a patient's record (and on the check-in
// pass they were shown after submitting). Reception points the phone at it and
// the Records tab jumps straight to that patient. Same getUserMedia + jsQR
// frame loop as the visitor check-in scanner (CMSSVisitorManagementPanel.jsx).
// Only a code that parses as a record reference is accepted - any other QR
// (a wifi poster, a payment code) is ignored and scanning carries on.
export default function ConsultationRecordScanner({ onCode, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  // Kept in a ref so a parent re-render never restarts the camera.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stream = null;
    let frame = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
        const code = found ? parseRecordCode(found.data) : null;
        if (code) { onCodeRef.current(code); return; }
      }
      frame = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStarting(false);
        frame = requestAnimationFrame(tick);
      } catch {
        setError('The camera could not be opened. Allow camera access, or type the reference code instead.');
        setStarting(false);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="Scan a patient record QR code">
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-slate-900 p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-white"><ScanLine className="h-4 w-4 text-cyan-300" /> Scan a record QR</p>
          <button type="button" onClick={onClose} aria-label="Close scanner" className="rounded-lg p-1 text-slate-300 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        <div className="relative aspect-square overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          {starting && <div className="absolute inset-0 flex items-center justify-center text-slate-300"><Loader className="h-6 w-6 animate-spin" /></div>}
          {!starting && !error && <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-cyan-300/70" />}
        </div>
        <canvas ref={canvasRef} className="hidden" />
        <p className="text-center text-xs text-slate-400">
          {error || 'Point the camera at the QR code on the patient\'s printed record or check-in pass.'}
        </p>
      </div>
    </div>
  );
}
