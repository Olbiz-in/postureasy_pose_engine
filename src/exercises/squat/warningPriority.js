// ─── warningPriority.js ───────────────────────────────────────────────────────
// Centralized per-rep warning selection — exactly one voice cue after each rep.
//
// Priority (highest first):
//   1. Speed (too fast / too slow)
//   2. Knee (inward / outward)
//   3. Torso forward bend

export const REP_WARNING_VOICE = {
  too_fast: 'Too fast.',
  too_slow: 'Too slow.',
};

/**
 * Resolve speed warning key for the rep that just finished.
 * Uses active tempo-gate warning first, then last tempo classification.
 */
export function getRepSpeedWarningKey(squatTracker) {
  const active = squatTracker.activeSpeedWarning;
  if (active) return active;

  const tempo = squatTracker.lastTempoResult;
  if (tempo === 'fast') return 'squat_rep_fast';
  if (tempo === 'slow') return 'squat_rep_slow';
  return null;
}

export function speedKeyToMessage(speedKey) {
  if (!speedKey) return null;
  if (speedKey.includes('fast')) return REP_WARNING_VOICE.too_fast;
  if (speedKey.includes('slow')) return REP_WARNING_VOICE.too_slow;
  return null;
}

/**
 * @param {{ speedKey?: string|null, kneeMsg?: string|null, torsoMsg?: string|null }} candidates
 * @returns {{ key: string, text: string, kind: 'speed'|'knee'|'torso' }|null}
 */
export function selectRepPostureWarning({ speedKey, kneeMsg, torsoMsg }) {
  const speedMsg = speedKeyToMessage(speedKey);
  if (speedMsg) {
    return { key: 'rep_speed', text: speedMsg, kind: 'speed' };
  }
  if (kneeMsg) {
    return { key: 'knee_posture', text: kneeMsg, kind: 'knee' };
  }
  if (torsoMsg) {
    return { key: 'torso_posture', text: torsoMsg, kind: 'torso' };
  }
  return null;
}
