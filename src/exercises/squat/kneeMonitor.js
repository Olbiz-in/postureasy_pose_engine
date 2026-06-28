// Per-rep knee tracking (valgus/varus) — ported from fitness_posture.
// Measures each knee's horizontal offset from the same-side shoulder, normalized
// by shoulder width, then flags a leg only if it stays out of tolerance for a
// sustained window. Side labels are mirror-aware for a selfie camera.

import { CFG, viewSide } from './config';
import { LM, nowSec } from '../../core/landmarks';

export function computeKneeAlignRatios(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lk = landmarks[LM.LEFT_KNEE];
  const rk = landmarks[LM.RIGHT_KNEE];

  const visMin = CFG.keypoint_vis_min;
  const ok = (lm) => lm && (lm.visibility == null || lm.visibility >= visMin);
  if (![ls, rs, lk, rk].every(ok)) return null;

  const sw = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  return { leftDx: (lk.x - ls.x) / sw, rightDx: (rk.x - rs.x) / sw, sw };
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
  if (side === 'left') {
    if (dx < lo) return { bad: true, direction: 'inward', dx };
    return { bad: true, direction: 'outward', dx };
  }
  if (dx < lo) return { bad: true, direction: 'outward', dx };
  return { bad: true, direction: 'inward', dx };
}

function smoothEma(prev, next, alpha) {
  return prev == null ? next : prev + alpha * (next - prev);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function legMessage(anatomicalSide, direction) {
  const which = `${capitalize(viewSide(anatomicalSide))} knee`;
  if (direction === 'outward') return `Your ${which} went too wide. Next rep, bring it slightly inward.`;
  if (direction === 'inward') return `Your ${which} caved in. Next rep, push it slightly outward.`;
  return null;
}

export function kneePostureMessage(qualifiedLegs) {
  if (!qualifiedLegs?.length) return null;
  if (qualifiedLegs.length === 2) {
    const [a, b] = qualifiedLegs;
    const la = viewSide(a.side);
    const lb = viewSide(b.side);
    if (a.direction === b.direction) {
      return a.direction === 'outward'
        ? `Your ${la} and ${lb} knees went too wide. Bring both knees inward.`
        : `Your ${la} and ${lb} knees caved in. Push both knees outward.`;
    }
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
