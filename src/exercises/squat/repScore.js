// Per-rep squat score + metrics, shared by the front and side view trackers.

import { SquatRepTracker } from './SquatRepTracker';
import { scoreIssues, clampPct } from '../../core/repScoring';

export const SQUAT_SCORE_WEIGHTS = {
  depth: 25,
  knee: 15,
  torso: 15,
  hip: 10,
  balance: 10,
  feet: 10,
  tempo: 10,
  shoulder: 5,
};

const FAST_SPEED_KEYS = new Set(['squat_rep_fast', 'squat_descend_fast', 'squat_ascend_fast']);
const FULL_DEPTH_PEAK = 1 - SquatRepTracker.FULL_FRAC;
const BALANCE_LIMIT = SquatRepTracker.MAX_LR_ASYM_FRAC * 0.8;

export function squatIssueGroup(key) {
  if (key === 'squat_go_deeper' || key === 'squat_too_deep') return 'depth';
  if (key === 'squat_imbalance') return 'balance';
  if (key.startsWith('squat_')) return 'tempo';
  if (key.startsWith('knee_')) return 'knee';
  if (key.startsWith('torso_')) return 'torso';
  if (key.startsWith('hip_')) return 'hip';
  if (key.startsWith('toe_') || key.startsWith('ankle_')) return 'feet';
  if (key.startsWith('shoulder_')) return 'shoulder';
  return null;
}

/** Score one finished rep from SquatRepTracker.repMetrics. */
export function scoreSquatRep(m) {
  const issues = [...(m?.voice_keys || [])];
  if (m && FAST_SPEED_KEYS.has(m.speed_cue) && !issues.includes(m.speed_cue)) issues.push(m.speed_cue);
  const asym = m?.left_right_asym ?? 0;
  if (asym > BALANCE_LIMIT) issues.push('squat_imbalance');

  const { score, groups } = scoreIssues(issues, squatIssueGroup, SQUAT_SCORE_WEIGHTS);
  const peak = m?.peak_depth_pct ?? 0;
  return {
    score,
    groups,
    issues,
    depthPct: clampPct((peak / FULL_DEPTH_PEAK) * 100),
    fullDepth: !!m?.full_depth,
    tooDeep: !!m?.too_deep,
    symmetryPct: clampPct((1 - asym / SquatRepTracker.MAX_LR_ASYM_FRAC) * 100),
    descendSec: m?.descend_sec ?? null,
    ascendSec: m?.ascend_sec ?? null,
  };
}
