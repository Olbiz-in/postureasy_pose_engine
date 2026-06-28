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

function getFileset(wasmBase) {
  if (!filesetPromise) {
    filesetPromise = FilesetResolver.forVisionTasks(wasmBase);
  }
  return filesetPromise;
}

/**
 * Create a PoseLandmarker configured for streaming video.
 * @returns {Promise<import('@mediapipe/tasks-vision').PoseLandmarker>}
 */
export async function createPoseLandmarker(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const vision = await getFileset(cfg.wasmBase);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: cfg.modelUrl, delegate: cfg.delegate },
    runningMode: 'VIDEO',
    numPoses: cfg.numPoses,
    minPoseDetectionConfidence: cfg.minPoseDetectionConfidence,
    minPosePresenceConfidence: cfg.minPosePresenceConfidence,
    minTrackingConfidence: cfg.minTrackingConfidence,
    outputSegmentationMasks: false,
  });
}

/** Connection pairs for drawing the skeleton (re-exported for convenience). */
export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;
