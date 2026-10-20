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
  isTimedExercise,
  exerciseFamily,
  managesOwnSets,
  isFlowComplete,
  isFlowRest,
  repsOnlyVoice,
  listExercises,
} from './core/registry';

export { default as LiveExercise } from './react/LiveExercise.jsx';
export { useLiveExercise } from './react/useLiveExercise.js';

export { VoiceManager, configureVoiceManager } from './core/voiceManager.js';
export { setIntroLine, primeSetIntro, holdDurationWords,
  setCompleteLine, holdSetCompleteLine, formAccuracyLine, nextSetHintLine,
  setIncompleteLine, setNotCountedLine, sessionStoppedLine,
} from './core/sessionVoice.js';
export { summarizeReps, summarizeHolds, repSummaryConfig } from './repSummary.js';

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
  SINGLE_ARM_DUMBBELL_ROW_TOLERANCE_GROUPS,
  LUNGE_TOLERANCE_GROUPS,
  getSquatToleranceConfig,
  getPushUpToleranceConfig,
  getShoulderPressToleranceConfig,
  getLateralRaiseToleranceConfig,
  getFrontRaiseToleranceConfig,
  getDumbbellCurlToleranceConfig,
  getSingleArmDumbbellRowToleranceConfig,
  getLungeToleranceConfig,
} from './exercises/toleranceDefinitions.js';

export {
  CALIBRATION_FAMILIES,
  detectPoseInImage,
  drawCalibrationOverlay,
} from './calibration/snapshotOverlay.js';

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

export {
  LUNGE_CFG,
  LUNGE_CFG_DEFAULTS,
  LUNGE_SCORE_WEIGHTS,
  resetLungeCfg,
} from './exercises/lunge/config.js';
export { LUNGE_PHASE } from './exercises/lunge/LungeFlow.js';

export {
  LGR_CFG,
  LGR_CFG_DEFAULTS,
  LGR_SCORE_WEIGHTS,
  resetLegRaiseCfg,
  setLegRaiseDebug,
} from './exercises/legRaise/config.js';
export { LGR_PHASE } from './exercises/legRaise/LegRaiseFlow.js';

export {
  SR_CFG,
  SR_CFG_DEFAULTS,
  SR_SCORE_WEIGHTS,
  SR_SCORE_WEIGHTS_DEFAULTS,
  resetSingleArmDumbbellRowCfg,
  resetSingleArmDumbbellRowWeights,
  setSingleArmDumbbellRowDebug,
} from './exercises/singleArmDumbbellRow/config.js';
export { SR_PHASE, SR_ACTIVITY } from './exercises/singleArmDumbbellRow/SingleArmDumbbellRowFlow.js';
export { summarizeSingleArmDumbbellRow } from './exercises/singleArmDumbbellRow/SingleArmDumbbellRowRepTracker.js';
