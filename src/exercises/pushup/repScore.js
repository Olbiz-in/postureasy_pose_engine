// Per-rep push-up (front view) score + metrics.

import { getPushUpDepthBand } from '../../core/trackingSettings';
import { scoreIssues, clampPct } from '../../core/repScoring';
import { PUSHUP_UP_THRESHOLD } from './config';

export const PUSHUP_SCORE_WEIGHTS = {
  elbow: 20,
  depth: 20,
  wrist: 15,
  forearm: 15,
  hand: 10,
  symmetry: 10,
  tempo: 10,
};

const REP_FAST_SEC = 1.0;
const UNEVEN_ARMS_DEG = 15;

export function pushupIssueGroup(key) {
  if (key === 'pushup_too_deep' || key === 'pushup_shoulder_deep') return 'depth';
  if (key === 'pushup_uneven') return 'symmetry';
  if (key === 'pushup_rep_fast') return 'tempo';
  const prefix = key.split('_')[0];
  return ['wrist', 'elbow', 'hand', 'forearm'].includes(prefix) ? prefix : null;
}

/** Per-rep accumulator fed every frame between leaving the top and the next lockout. */
export function createPushUpRepWindow() {
  let startT = -1;
  let minAngle = 180;
  let diffSum = 0;
  let diffN = 0;
  return {
    observe(t, angle, leftAngle, rightAngle) {
      if (startT < 0) {
        if (!(angle < PUSHUP_UP_THRESHOLD)) return;
        startT = t;
      }
      minAngle = Math.min(minAngle, angle);
      if (Number.isFinite(leftAngle) && Number.isFinite(rightAngle)) {
        diffSum += Math.abs(leftAngle - rightAngle);
        diffN += 1;
      }
    },
    close(t, errors) {
      const durationSec = startT >= 0 ? +(t - startT).toFixed(2) : null;
      const armDiff = diffN ? diffSum / diffN : 0;
      const issues = [...(errors || [])];
      if (armDiff > UNEVEN_ARMS_DEG) issues.push('pushup_uneven');
      if (durationSec != null && durationSec < REP_FAST_SEC) issues.push('pushup_rep_fast');
      const { score, groups } = scoreIssues(issues, pushupIssueGroup, PUSHUP_SCORE_WEIGHTS);
      const target = getPushUpDepthBand().max;
      const result = {
        score,
        groups,
        issues,
        durationSec,
        minElbowAngle: Math.round(minAngle),
        depthPct: clampPct(((180 - minAngle) / Math.max(1, 180 - target)) * 100),
        symmetryPct: clampPct(100 - armDiff * (100 / (UNEVEN_ARMS_DEG * 2))),
      };
      startT = -1;
      minAngle = 180;
      diffSum = 0;
      diffN = 0;
      return result;
    },
  };
}
