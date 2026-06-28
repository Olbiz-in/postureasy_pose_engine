// Push-up arm-alignment bands with a natural outward bias from the shoulder line.
// Ideal form: wrist/elbow sit slightly outside the shoulder — not stacked.
// Ported verbatim from fitness_posture pushUpAlignBands.

import { PUSHUP_CFG } from './config';

/** Left arm (mirrored camera): outward = +dx (joint x > shoulder x). */
export function evalLeftArmAlignBand(dx, bias, alignMax, innerTol, outerTol) {
  const center = bias;
  const lo = center - (alignMax + innerTol);
  const hi = center + (alignMax + outerTol);
  const ok = lo <= dx && dx <= hi;
  let cueKey = null;
  if (!ok) cueKey = dx < lo ? 'inner' : 'outer';
  return { ok, lo, hi, center, cueKey };
}

/** Right arm (mirrored camera): outward = -dx (joint x < shoulder x). */
export function evalRightArmAlignBand(dx, bias, alignMax, innerTol, outerTol) {
  const center = -bias;
  const lo = center - (alignMax + outerTol);
  const hi = center + (alignMax + innerTol);
  const ok = lo <= dx && dx <= hi;
  let cueKey = null;
  if (!ok) cueKey = dx < lo ? 'outer' : 'inner';
  return { ok, lo, hi, center, cueKey };
}

function nearBiasedBand(dx, lo, hi) {
  if (dx < lo || dx > hi) return false;
  const span = hi - lo;
  const margin = span * (1.0 - PUSHUP_CFG.near_limit_fraction) * 0.5;
  return dx <= lo + margin || dx >= hi - margin;
}

export function evalWristAlignmentBands(lDx, rDx) {
  const left = evalLeftArmAlignBand(
    lDx,
    PUSHUP_CFG.wrist_left_outward_bias_ratio,
    PUSHUP_CFG.wrist_align_ratio_max,
    PUSHUP_CFG.wrist_left_inner_offset_ratio,
    PUSHUP_CFG.wrist_left_outer_offset_ratio,
  );
  const right = evalRightArmAlignBand(
    rDx,
    PUSHUP_CFG.wrist_right_outward_bias_ratio,
    PUSHUP_CFG.wrist_align_ratio_max,
    PUSHUP_CFG.wrist_right_inner_offset_ratio,
    PUSHUP_CFG.wrist_right_outer_offset_ratio,
  );
  return { left, right };
}

export function evalElbowAlignmentBands(lDx, rDx) {
  const left = evalLeftArmAlignBand(
    lDx,
    PUSHUP_CFG.elbow_left_outward_bias_ratio,
    PUSHUP_CFG.elbow_align_ratio_max,
    PUSHUP_CFG.elbow_left_inner_offset_ratio,
    PUSHUP_CFG.elbow_left_outer_offset_ratio,
  );
  const right = evalRightArmAlignBand(
    rDx,
    PUSHUP_CFG.elbow_right_outward_bias_ratio,
    PUSHUP_CFG.elbow_align_ratio_max,
    PUSHUP_CFG.elbow_right_inner_offset_ratio,
    PUSHUP_CFG.elbow_right_outer_offset_ratio,
  );
  return { left, right };
}

export function wristCueKey(side, cueDir) {
  if (side === 'left') return cueDir === 'inner' ? 'wrist_left_inner' : 'wrist_left_outer';
  return cueDir === 'outer' ? 'wrist_right_outer' : 'wrist_right_inner';
}

export function elbowCueKey(side, cueDir) {
  if (side === 'left') return cueDir === 'inner' ? 'elbow_left_inner' : 'elbow_left_outer';
  return cueDir === 'outer' ? 'elbow_right_outer' : 'elbow_right_inner';
}

export function isNearWristBand(lDx, rDx) {
  const { left, right } = evalWristAlignmentBands(lDx, rDx);
  return nearBiasedBand(lDx, left.lo, left.hi) || nearBiasedBand(rDx, right.lo, right.hi);
}
