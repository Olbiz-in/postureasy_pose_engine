// Thin, robust wrapper around MediaPipe Tasks Vision PoseLandmarker.
//
// All inference runs locally in the browser (WebAssembly/WebGL). The only
// network usage is a one-time download of the WASM runtime + the model file,
// which the browser caches — there is NO per-frame network traffic.

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const DEFAULTS = {
  // Pin the WASM runtime + model to a known version for reproducible builds.
  wasmBase: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm',
  modelUrl:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  delegate: 'GPU',
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

let filesetPromise = null;
let _overrides = {};

/**
 * Override where the WASM runtime + model are loaded from. Call once at app
 * startup — e.g. to self-host the assets locally instead of hitting a CDN:
 *
 *   configurePoseEngine({ wasmBase: '/mediapipe/wasm', modelUrl: '/mediapipe/models/pose_landmarker_lite.task' })
 */
export function configurePoseEngine(overrides = {}) {
  _overrides = { ..._overrides, ...overrides };
  filesetPromise = null; // re-resolve against the new wasmBase
}

function getFileset(wasmBase) {
  if (!filesetPromise) {
    filesetPromise = FilesetResolver.forVisionTasks(wasmBase);
  }
  return filesetPromise;
}

/** Coerce MediaPipe's varied throw shapes (string | Event | Error) into an Error. */
function toError(err, context) {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  const msg = err?.message || err?.reason || err?.toString?.() || 'unknown error';
  return new Error(`${context}: ${msg}`);
}

/**
 * Create a PoseLandmarker configured for streaming video.
 *
 * The GPU (WebGL) delegate is preferred but is not available on every browser /
 * driver; if it fails to initialize we transparently fall back to the CPU
 * delegate so live tracking still works.
 * @returns {Promise<import('@mediapipe/tasks-vision').PoseLandmarker>}
 */
export async function createPoseLandmarker(options = {}) {
  const cfg = { ...DEFAULTS, ..._overrides, ...options };

  let vision;
  try {
    vision = await getFileset(cfg.wasmBase);
  } catch (err) {
    filesetPromise = null; // allow a retry on the next attempt
    throw toError(err, 'Failed to load the pose-detection runtime (check your connection)');
  }

  const build = (delegate) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: cfg.modelUrl, delegate },
      runningMode: 'VIDEO',
      numPoses: cfg.numPoses,
      minPoseDetectionConfidence: cfg.minPoseDetectionConfidence,
      minPosePresenceConfidence: cfg.minPosePresenceConfidence,
      minTrackingConfidence: cfg.minTrackingConfidence,
      outputSegmentationMasks: false,
    });

  try {
    return await build(cfg.delegate);
  } catch (gpuErr) {
    if (cfg.delegate === 'CPU') throw toError(gpuErr, 'Failed to load the pose model');
    // eslint-disable-next-line no-console
    console.warn('[pose-engine] GPU delegate failed, falling back to CPU:', gpuErr);
    try {
      return await build('CPU');
    } catch (cpuErr) {
      throw toError(cpuErr, 'Failed to load the pose model');
    }
  }
}

/** Connection pairs for drawing the skeleton (re-exported for convenience). */
export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;
