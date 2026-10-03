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
  FRONT_RAISE_TOLERANCE_GROUPS,
  DUMBBELL_CURL_TOLERANCE_GROUPS,
  getSquatToleranceConfig,
  getPushUpToleranceConfig,
  getShoulderPressToleranceConfig,
  getLateralRaiseToleranceConfig,
  getFrontRaiseToleranceConfig,
  getDumbbellCurlToleranceConfig,
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

export {
  FR_CFG,
  FR_CFG_DEFAULTS,
  FR_SCORE_WEIGHTS,
  FR_SCORE_WEIGHTS_DEFAULTS,
  resetFrontRaiseCfg,
  resetFrontRaiseWeights,
  setFrontRaiseDebug,
} from './exercises/frontRaise/config.js';
export { FR_PHASE, FR_ACTIVITY } from './exercises/frontRaise/FrontRaiseFlow.js';
export { summarizeFrontRaise } from './exercises/frontRaise/FrontRaiseRepTracker.js';

export {
  DC_CFG,
  DC_CFG_DEFAULTS,
  DC_SCORE_WEIGHTS,
  DC_SCORE_WEIGHTS_DEFAULTS,
  DC_CURL_MODES,
  resetDumbbellCurlCfg,
  resetDumbbellCurlWeights,
  setDumbbellCurlDebug,
  setDumbbellCurlMode,
} from './exercises/dumbbellCurl/config.js';
export { DC_PHASE, DC_ACTIVITY } from './exercises/dumbbellCurl/DumbbellCurlFlow.js';
export { summarizeDumbbellCurl } from './exercises/dumbbellCurl/DumbbellCurlRepTracker.js';
