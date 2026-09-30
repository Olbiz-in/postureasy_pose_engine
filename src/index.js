// Public API for @postureasy/pose-engine.
// Importing this module also registers all built-in exercises (side effect).

import './exercises/index.js';

export { LM, nowSec, jointAngle, midpoint, shoulderWidth, isVisible } from './core/landmarks';
export { createPoseLandmarker, configurePoseEngine, POSE_CONNECTIONS } from './core/poseLandmarker';
export { drawSkeleton, drawHLine } from './core/drawSkeleton';
export {
  registerExercise,
  getExercise,
  resolveExerciseId,
  availableViews,
  isSupported,
  listExercises,
} from './core/registry';

export { default as LiveExercise } from './react/LiveExercise.jsx';
export { useLiveExercise } from './react/useLiveExercise.js';

export { VoiceManager, configureVoiceManager } from './core/voiceManager.js';

export {
  trackingSettings,
  configureTrackingSettings,
  subscribeTrackingSettings,
  getPushUpDepthBand,
  formatTrackingResult,
} from './core/trackingSettings.js';

export {
  SQUAT_TOLERANCE_GROUPS,
  PUSHUP_TOLERANCE_GROUPS,
  SHOULDER_PRESS_TOLERANCE_GROUPS,
  LATERAL_RAISE_TOLERANCE_GROUPS,
  getSquatToleranceConfig,
  getPushUpToleranceConfig,
  getShoulderPressToleranceConfig,
  getLateralRaiseToleranceConfig,
} from './exercises/toleranceDefinitions.js';

export {
  LR_CFG,
  LR_CFG_DEFAULTS,
  LR_SCORE_WEIGHTS,
  LR_SCORE_WEIGHTS_DEFAULTS,
  resetLateralRaiseCfg,
  resetLateralRaiseWeights,
  setLateralRaiseDebug,
} from './exercises/lateralRaise/config.js';
export { LR_PHASE, LR_ACTIVITY } from './exercises/lateralRaise/LateralRaiseFlow.js';
export { summarizeLateralRaise } from './exercises/lateralRaise/LateralRaiseRepTracker.js';
