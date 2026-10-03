// Front-view checks for the dumbbell front raise.
//
// Angle-free by design: every rule compares landmark y against a horizontal
// shoulder line, or uses a distance ratio. Signed offsets from the line are
// "+ = below the line" (image y grows downward). Distances are divided by
// `norm` — the calibrated shoulder width once available, else the live one.

import { LM } from '../../core/landmarks';
import { FR_CFG } from './config';
import { mid, dist } from '../common/math';
import { evaluateFrontStance } from '../common/frontStance';

/**
 * Snapshot of everything the checks need, built from smoothed pixel points.
 * Returns null when the core (both shoulders + both hips) is not available.
 * Arms and ankles degrade individually (`arm.ok`, `feetOk`).
 */
export function buildGeometry(pts, calib = null) {
  const P = (i) => pts.get(i) || null;
  const ls = P(LM.LEFT_SHOULDER);
  const rs = P(LM.RIGHT_SHOULDER);
  const lh = P(LM.LEFT_HIP);
  const rh = P(LM.RIGHT_HIP);
  if (!ls || !rs || !lh || !rh) return null;

  const le = P(LM.LEFT_ELBOW);
  const re = P(LM.RIGHT_ELBOW);
  const lw = P(LM.LEFT_WRIST);
  const rw = P(LM.RIGHT_WRIST);
  const la = P(LM.LEFT_ANKLE);
  const ra = P(LM.RIGHT_ANKLE);

  const sw = Math.max(Math.abs(ls.x - rs.x), 1);
  const shMid = mid(ls, rs);
  const hipMid = mid(lh, rh);
  const shY = shMid.y;
  const torsoDist = Math.max(dist(shMid, hipMid), 1);
  // Calibrated shoulder width, rescaled by torso length so stepping closer /
  // farther after calibration keeps the ratios valid.
  const scale = calib?.torso ? Math.max(0.5, Math.min(2, torsoDist / calib.torso)) : 1;
  const norm = calib?.sw ? calib.sw * scale : sw;

  const lineY = (side) => {
    if (FR_CFG.line_mode === 'per_side') return side === 'left' ? ls.y : rs.y;
    return shY;
  };

  const arm = (side, shoulder, elbow, wrist) => {
    const ok = !!(elbow && wrist);
    const ly = lineY(side);
    // + = wrist farther from the body midline than its shoulder (drifting out).
    const outSign = shoulder.x >= shMid.x ? 1 : -1;
    return {
      side,
      ok,
      shoulder,
      elbow,
      wrist,
      lineY: ly,
      elbowDy: ok ? (elbow.y - ly) / norm : null,
      wristDy: ok ? (wrist.y - ly) / norm : null,
      wristOut: ok ? ((wrist.x - shoulder.x) * outSign) / norm : null,
    };
  };

  return {
    ls, rs, lh, rh, le, re, lw, rw, la, ra,
    sw,
    norm,
    shMid,
    hipMid,
    shY,
    hipY: hipMid.y,
    torsoDist,
    feetOk: !!(la && ra),
    left: arm('left', ls, le, lw),
    right: arm('right', rs, re, rw),
    // Raw shoulder tilt, signed: + = left shoulder lower in the image.
    tilt: (ls.y - rs.y) / norm,
  };
}

// ── Stance (SETUP_STANCE) ───────────────────────────────────────────────────

/**
 * Every stance rule, each with its own pass flag, so the overlay can show a
 * checklist. `maxSw` is the widest shoulder span seen so far during setup.
 */
export function evaluateStance(g, maxSw) {
  return evaluateFrontStance(g, maxSw, FR_CFG, 'fr_');
}

// ── Activity helpers ────────────────────────────────────────────────────────

/** Live shoulder width vs the (distance-corrected) calibrated width; drops when the body turns. */
export function facingRatio(g, calib) {
  if (!calib?.sw) return 1;
  return g.sw / g.norm;
}

/**
 * Lift fraction of one arm: 0 at the calibrated resting wrist height,
 * 1 with the wrist on the shoulder line, >1 above it. Also for the elbow.
 */
export function armLift(a, calib) {
  if (!a.ok) return null;
  const restE = calib?.restElbow?.[a.side] ?? FR_CFG.rest_elbow_default;
  const restW = calib?.restWrist?.[a.side] ?? FR_CFG.rest_wrist_default;
  return {
    elbow: (restE - a.elbowDy) / Math.max(restE, 0.2),
    wrist: (restW - a.wristDy) / Math.max(restW, 0.2),
  };
}

/** Horizontal reference lines (pixel y) for the overlay. */
export function raiseLines(g, calib) {
  const n = g.norm;
  const restW = calib
    ? (calib.restWrist.left + calib.restWrist.right) / 2
    : FR_CFG.rest_wrist_default;
  return {
    shoulderY: g.shY,
    bandTopY: g.shY - FR_CFG.too_high_tolerance * n,
    bandBottomY: g.shY + FR_CFG.top_tolerance * n,
    returnY: g.shY + restW * (1 - FR_CFG.lift_return) * n,
  };
}
