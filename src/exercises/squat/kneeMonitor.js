// Per-rep knee tracking for front-view squats.
// Measures each knee's horizontal offset from the same-side ankle, normalized
// by shoulder width, then flags a leg only if it stays out of tolerance for a
// sustained window. Side labels are mirror-aware for a selfie camera.

import { CFG } from './config';
import { LM, nowSec } from '../../core/landmarks';

export function computeKneeAlignRatios(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lk = landmarks[LM.LEFT_KNEE];
  const rk = landmarks[LM.RIGHT_KNEE];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];

  const visMin = CFG.keypoint_vis_min;
  const ok = (lm) => lm && (lm.visibility == null || lm.visibility >= visMin);
  if (![ls, rs, lk, rk, la, ra].every(ok)) return null;

  const sw = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  return { leftDx: (lk.x - la.x) / sw, rightDx: (rk.x - ra.x) / sw, sw };
}

export function kneeAlignBand(side) {
  const max = CFG.knee_align_ratio_max;
  if (side === 'left') {
    return { lo: -(max + CFG.kn_left_inner_offset_ratio), hi: +(max + CFG.kn_left_outer_offset_ratio) };
  }
  return { lo: -(max + CFG.kn_right_inner_offset_ratio), hi: +(max + CFG.kn_right_outer_offset_ratio) };
}

export function classifyKneeAlign(dx, side) {
  const { lo, hi } = kneeAlignBand(side);
  if (dx >= lo && dx <= hi) return { bad: false, direction: null, dx };
  // The live preview is mirrored (selfie-style) for the user, but `dx` is
  // computed from the raw (unmirrored) camera coordinates that MediaPipe
  // sees. A raw-space correction of "+x" (dx < lo, needs to increase)
  // renders as the knee needing to move towards screen-LEFT on the mirrored
  // preview; a raw-space "-x" correction (dx > hi) renders as screen-RIGHT.
  if (dx < lo) return { bad: true, direction: 'left', dx };
  return { bad: true, direction: 'right', dx };
}

function smoothEma(prev, next, alpha) {
  return prev == null ? next : prev + alpha * (next - prev);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function legMessage(anatomicalSide, direction) {
  const which = `${capitalize(anatomicalSide)} knee`;
  if (direction === 'left') return `Move your ${which} towards the left.`;
  if (direction === 'right') return `Move your ${which} towards the right.`;
  return null;
}

export function kneePostureMessage(qualifiedLegs) {
  if (!qualifiedLegs?.length) return null;
  if (qualifiedLegs.length === 2) {
    return qualifiedLegs.map((leg) => legMessage(leg.side, leg.direction)).filter(Boolean).join(' ');
  }
  return legMessage(qualifiedLegs[0].side, qualifiedLegs[0].direction);
}

export class KneeAngleRepMonitor {
  constructor() {
    this.resetAll();
  }

  resetAll() {
    this._smoothLeftDx = null;
    this._smoothRightDx = null;
    this._leftOnsetT = -1;
    this._rightOnsetT = -1;
    this._qualifiedLegs = [];
    this._inRep = false;
  }

  onRepStart() {
    this.resetAll();
    this._inRep = true;
  }

  _updateLegTimer(anatomicalSide, legState, onsetKey, now) {
    const sustain = CFG.knee_angle_sustain_sec;
    if (!legState.bad) { this[onsetKey] = -1; return; }
    if (this[onsetKey] < 0) this[onsetKey] = now;
    if (now - this[onsetKey] < sustain) return;
    if (!this._qualifiedLegs.some((q) => q.side === anatomicalSide)) {
      this._qualifiedLegs.push({ side: anatomicalSide, direction: legState.direction });
    }
  }

  updateFrame(landmarks) {
    if (!this._inRep) return;
    const ratios = computeKneeAlignRatios(landmarks);
    if (!ratios) { this._leftOnsetT = -1; this._rightOnsetT = -1; return; }

    const alpha = CFG.knee_angle_smooth_alpha;
    const leftDx = smoothEma(this._smoothLeftDx, ratios.leftDx, alpha);
    const rightDx = smoothEma(this._smoothRightDx, ratios.rightDx, alpha);
    this._smoothLeftDx = leftDx;
    this._smoothRightDx = rightDx;

    const now = nowSec();
    this._updateLegTimer('left', classifyKneeAlign(leftDx, 'left'), '_leftOnsetT', now);
    this._updateLegTimer('right', classifyKneeAlign(rightDx, 'right'), '_rightOnsetT', now);
  }

  /** True while at least one leg is currently flagged (for live cueing). */
  hasActiveFlag() {
    return this._qualifiedLegs.length > 0;
  }

  consumeEndOfRepFeedback() {
    const msg = this._qualifiedLegs.length ? kneePostureMessage(this._qualifiedLegs) : null;
    this.resetAll();
    return msg;
  }

  onRepCancelled() {
    this.resetAll();
  }
}
