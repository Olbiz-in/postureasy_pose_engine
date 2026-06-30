// Global live-tracking display + tolerance settings consumed by the engine loop
// and the PosturEasy UI tolerance panel.

export const trackingSettings = {
  /** Skeleton bone line width (matches fitness_posture default of 2). */
  skeletonLineWidth: 2,
  /** Joint dot radius scales with line width. */
  skeletonJointRadius: 3,
  /**
   * Angle tolerance in degrees — e.g. target 90° with tolerance 10 → 80–100° band.
   * Applied to push-up depth validation at runtime.
   */
  angleToleranceDeg: 10,
  /** Push-up / squat bottom target angle (degrees) for depth band center. */
  depthTargetAngleDeg: 90,
};

let _listeners = [];

export function configureTrackingSettings(overrides = {}) {
  Object.assign(trackingSettings, overrides);
  _listeners.forEach((fn) => fn(trackingSettings));
}

export function subscribeTrackingSettings(listener) {
  _listeners.push(listener);
  return () => { _listeners = _listeners.filter((fn) => fn !== listener); };
}

/** Effective push-up elbow depth band from angle tolerance settings. */
export function getPushUpDepthBand() {
  const center = trackingSettings.depthTargetAngleDeg;
  const tol = trackingSettings.angleToleranceDeg;
  return {
    min: center - tol,
    max: center + tol,
    tooDeep: center - tol - 10,
  };
}

/** Standard tracking result shape for UI / API consumers. */
export function formatTrackingResult(state) {
  if (!state) return null;
  return {
    exercise: state.exerciseId || state.exercise || null,
    reps: state.repCount ?? 0,
    posture: state.posture || (state.formScore >= 80 ? 'correct' : state.formScore >= 50 ? 'warning' : 'incorrect'),
    feedback: state.feedback || state.cues?.[0]?.text || null,
    angle: state.elbowAngle ?? state.angle ?? null,
    confidence: state.confidence ?? (state.ready ? 0.95 : 0.5),
    formScore: state.formScore,
    phase: state.phase,
    cues: state.cues,
  };
}
