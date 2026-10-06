// Per-rep push-up (side view) score + metrics.

import { scoreIssues, clampPct } from '../../core/repScoring';
import { SIDE_PUSHUP_CFG as CFG } from './config';

export const SIDE_PUSHUP_SCORE_WEIGHTS = {
  back: 30,
  depth: 20,
  extension: 20,
  hand: 10,
  tempo: 10,
};

const REP_FAST_SEC = 1.0;

export function sidePushupIssueGroup(key) {
  if (key === 'back_sagging' || key === 'back_piking') return 'back';
  if (key === 'pushup_too_deep' || key === 'pushup_shoulder_deep' || key === 'pushup_not_deep_enough') return 'depth';
  if (key === 'pushup_partial_extension') return 'extension';
  if (key === 'hand_too_forward' || key === 'hand_too_low') return 'hand';
  if (key === 'pushup_rep_fast') return 'tempo';
  return null;
}

export function scoreSidePushUpRep({ errors, durationSec, minAngle, hipDevMean }) {
  const issues = [...(errors || [])];
  if (durationSec != null && durationSec < REP_FAST_SEC) issues.push('pushup_rep_fast');
  const { score, groups } = scoreIssues(issues, sidePushupIssueGroup, SIDE_PUSHUP_SCORE_WEIGHTS);
  return {
    score,
    groups,
    issues,
    minElbowAngle: Math.round(minAngle),
    depthPct: clampPct(((180 - minAngle) / (180 - CFG.depth_target_max)) * 100),
    backPct: clampPct((1 - hipDevMean / (CFG.back_hip_dev_ratio_max * 2)) * 100),
  };
}
