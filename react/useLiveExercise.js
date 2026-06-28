// React hook: owns the webcam, the PoseLandmarker, and the per-frame loop.
// Returns refs to bind to a <video>/<canvas> plus the live exercise state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPoseLandmarker } from '../core/poseLandmarker';
import { drawSkeleton } from '../core/drawSkeleton';
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
  active = false,
  mirrored = true,
  voice = false,
  uiHz = 8,
  onRepCountChange,
  onStateChange,
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

  const exerciseId = resolveExerciseId(exerciseName);

  const onRepCountChangeRef = useRef(onRepCountChange);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onRepCountChangeRef.current = onRepCountChange; }, [onRepCountChange]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
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
    trackerRef.current = def.create();
    setState(IDLE_STATE);
    lastRepRef.current = 0;
    setStatus('loading');
    setError(null);

    async function init() {
      try {
        if (!landmarkerRef.current) {
          landmarkerRef.current = await createPoseLandmarker();
        }
        if (cancelled) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;

        setStatus('running');
        loop();
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Unable to start camera / pose model');
        setStatus('error');
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

        const frame = { width: canvas.width, height: canvas.height, timestamp: ts };
        const next = tracker.update(landmarks, frame);

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (landmarks) drawSkeleton(ctx, landmarks, { width: canvas.width, height: canvas.height });
        if (typeof tracker.draw === 'function') tracker.draw(ctx, landmarks, frame, next);

        if (next.repCount !== lastRepRef.current) {
          lastRepRef.current = next.repCount;
          onRepCountChangeRef.current?.(next.repCount);
        }
        if (next.feedback && voice) speak(next.feedback);

        const now = performance.now();
        if (now - lastUiAtRef.current >= 1000 / uiHz) {
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
      stop();
    };
  }, [active, exerciseId, voice, uiHz, stop]);

  // Release the (heavy) landmarker only when the hook unmounts entirely.
  useEffect(() => () => {
    try { landmarkerRef.current?.close?.(); } catch { /* noop */ }
    landmarkerRef.current = null;
  }, []);

  return { videoRef, canvasRef, status, error, state, mirrored, exerciseId, stop };
}
