// React hook: owns the webcam, the PoseLandmarker, and the per-frame loop.
// Returns refs to bind to a <video>/<canvas> plus the live exercise state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPoseLandmarker } from '../core/poseLandmarker';
import { drawSkeleton } from '../core/drawSkeleton';
import { trackingSettings } from '../core/trackingSettings';
import { resolveExerciseId, getExercise } from '../core/registry';

const IDLE_STATE = {
  repCount: 0,
  phase: 'idle',
  progress: 0,
  formScore: 100,
  ready: false,
  cues: [],
  feedback: null,
};

function speak(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* speech is best-effort */
  }
}

export function useLiveExercise({
  exerciseName,
  view,
  active = false,
  mirrored = true,
  voice = false,
  uiHz = 8,
  /** Planned rep count for this set — forwarded to the exercise flow. */
  targetReps = 0,
  /** When set, play this video URL instead of opening the webcam (debug / offline). */
  videoSrc = null,
  onRepCountChange,
  onStateChange,
  onRepComplete,
} = {}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkerRef = useRef(null);
  const trackerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const lastUiAtRef = useRef(0);
  const lastRepRef = useRef(0);

  const [status, setStatus] = useState('idle'); // idle|loading|running|error|unsupported
  const [error, setError] = useState(null);
  const [state, setState] = useState(IDLE_STATE);

  const exerciseId = resolveExerciseId(exerciseName, view);

  const onRepCountChangeRef = useRef(onRepCountChange);
  const onStateChangeRef = useRef(onStateChange);
  const onRepCompleteRef = useRef(onRepComplete);
  const mirroredRef = useRef(mirrored);
  useEffect(() => { mirroredRef.current = mirrored; }, [mirrored]);
  useEffect(() => { onRepCountChangeRef.current = onRepCountChange; }, [onRepCountChange]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onRepCompleteRef.current = onRepComplete; }, [onRepComplete]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try { video.pause(); } catch { /* noop */ }
      video.removeAttribute('src');
      video.srcObject = null;
      try { video.load(); } catch { /* noop */ }
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;

    if (!exerciseId) {
      setStatus('unsupported');
      return undefined;
    }

    let cancelled = false;
    const def = getExercise(exerciseId);
    const reps = Number(targetReps) > 0 ? Number(targetReps) : 0;
    trackerRef.current = def.create({ voice, targetReps: reps });
    setState(IDLE_STATE);
    lastRepRef.current = 0;
    lastTsRef.current = 0;
    setStatus('loading');
    setError(null);

    function fail(message, err) {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.error('[pose-engine] live tracking failed:', err || message);
      setError(message);
      setStatus('error');
    }

    async function init() {
      // 1) Pose model (transparently falls back GPU → CPU inside).
      try {
        if (!landmarkerRef.current) {
          landmarkerRef.current = await createPoseLandmarker();
        }
      } catch (err) {
        fail(err?.message || 'Could not load the pose model.', err);
        return;
      }
      if (cancelled) return;

      const video = videoRef.current;
      if (!video) return;

      // 2) Source: uploaded debug video OR webcam.
      try {
        if (videoSrc) {
          video.srcObject = null;
          video.loop = true;
          video.muted = true;
          video.playsInline = true;
          video.src = videoSrc;
          await new Promise((resolve, reject) => {
            const onReady = () => {
              cleanup();
              resolve();
            };
            const onErr = () => {
              cleanup();
              reject(new Error('Could not load the uploaded video.'));
            };
            const cleanup = () => {
              video.removeEventListener('loadeddata', onReady);
              video.removeEventListener('error', onErr);
            };
            if (video.readyState >= 2) {
              resolve();
              return;
            }
            video.addEventListener('loadeddata', onReady);
            video.addEventListener('error', onErr);
          });
          if (cancelled) return;
          await video.play();
        } else {
          if (!navigator.mediaDevices?.getUserMedia) {
            fail('This browser has no camera access. Use a recent Chrome/Edge over http://localhost or HTTPS.');
            return;
          }
          let stream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
              audio: false,
            });
          } catch (err) {
            const name = err?.name || '';
            const msg =
              name === 'NotAllowedError' || name === 'SecurityError'
                ? 'Camera permission was blocked. Allow camera access for this site and retry.'
                : name === 'NotReadableError'
                  ? 'The camera is in use by another app. Close it (Zoom, Teams, Camera app…) and retry.'
                  : name === 'NotFoundError' || name === 'OverconstrainedError'
                    ? 'No camera was found. Connect a webcam and retry.'
                    : err?.message || 'Could not start the camera.';
            fail(msg, err);
            return;
          }
          if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
          streamRef.current = stream;
          video.loop = false;
          video.srcObject = stream;
          await video.play();
        }
        if (cancelled) return;
        setStatus('running');
        loop();
      } catch (err) {
        fail(
          videoSrc
            ? (err?.message || 'Could not play the uploaded video.')
            : (err?.message || 'Could not start the video preview.'),
          err,
        );
      }
    }

    function loop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = landmarkerRef.current;
      const tracker = trackerRef.current;
      if (!video || !canvas || !landmarker || !tracker) return;

      if (video.readyState >= 2 && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

        let ts = performance.now();
        if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
        lastTsRef.current = ts;

        let landmarks = null;
        try {
          const result = landmarker.detectForVideo(video, ts);
          landmarks = result?.landmarks?.[0] || null;
        } catch {
          /* skip this frame on transient detector errors */
        }

        const frame = { width: canvas.width, height: canvas.height, timestamp: ts, mirrored: mirroredRef.current };
        const ctx = canvas.getContext('2d');

        let next = null;
        try {
          next = tracker.update(landmarks, frame);
        } catch (err) {
          console.error('[useLiveExercise] tracker.update failed:', err);
          next = { repCount: lastRepRef.current, cues: [{ level: 'warn', text: 'Tracking error — retrying…' }] };
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (landmarks && next) {
          drawSkeleton(ctx, landmarks, {
            width: canvas.width,
            height: canvas.height,
            color: next.skeletonColor || '#22d3a6',
            lineWidth: trackingSettings.skeletonLineWidth,
            jointRadius: trackingSettings.skeletonJointRadius,
          });
        }
        if (next && typeof tracker.draw === 'function') {
          try {
            tracker.draw(ctx, landmarks, frame, next);
          } catch (err) {
            console.error('[useLiveExercise] tracker.draw failed:', err);
          }
        }

        if (next?.repCount !== lastRepRef.current) {
          lastRepRef.current = next.repCount;
          onRepCountChangeRef.current?.(next.repCount);
        }
        if (next?.repEvent) onRepCompleteRef.current?.(next.repEvent);

        const now = performance.now();
        if (next && now - lastUiAtRef.current >= 1000 / uiHz) {
          lastUiAtRef.current = now;
          setState(next);
          onStateChangeRef.current?.(next);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    init();
    return () => {
      cancelled = true;
      try { trackerRef.current?.reset?.(); } catch { /* noop */ }
      stop();
    };
  }, [active, exerciseId, voice, uiHz, videoSrc, targetReps, stop]);

  // Keep the live tracker in sync if the planned rep count changes mid-session.
  useEffect(() => {
    const tracker = trackerRef.current;
    if (!tracker || typeof tracker.setTargetReps !== 'function') return;
    tracker.setTargetReps(Number(targetReps) > 0 ? Number(targetReps) : 0);
  }, [targetReps]);

  // Release the (heavy) landmarker only when the hook unmounts entirely.
  useEffect(() => () => {
    try { landmarkerRef.current?.close?.(); } catch { /* noop */ }
    landmarkerRef.current = null;
  }, []);

  return { videoRef, canvasRef, status, error, state, mirrored, exerciseId, stop };
}
