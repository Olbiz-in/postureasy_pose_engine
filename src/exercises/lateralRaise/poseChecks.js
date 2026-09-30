// Front-view checks for the dumbbell lateral raise.
//
// Angle-free by design: every rule compares landmark y against a horizontal
// shoulder line, or uses a distance ratio. Signed offsets from the line are
// "+ = below the line" (image y grows downward). Distances are divided by
// `norm` — the calibrated shoulder width once available, else the live one.

import { LM } from '../../core/landmarks';
import { LR_CFG } from './config';

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

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
  // farther after calibration keeps the ratios valid. Torso length barely
  // changes while raising the arms or turning, unlike the live shoulder span.
  const scale = calib?.torso ? Math.max(0.5, Math.min(2, torsoDist / calib.torso)) : 1;
  const norm = calib?.sw ? calib.sw * scale : sw;

  const lineY = (side) => {
    if (LR_CFG.line_mode === 'per_side') return side === 'left' ? ls.y : rs.y;
    return shY;
  };

  const arm = (side, shoulder, elbow, wrist) => {
    const ok = !!(elbow && wrist);
    const ly = lineY(side);
    return {
      side,
      ok,
      shoulder,
      elbow,
      wrist,
      lineY: ly,
      elbowDy: ok ? (elbow.y - ly) / norm : null,
      wristDy: ok ? (wrist.y - ly) / norm : null,
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

function armDown(g, a) {
  if (!a.ok) return false;
  const nearHip = a.wrist.y >= g.hipY - LR_CFG.arms_down_hip_margin * g.sw;
  const wellBelowShoulder = (a.wrist.y - a.lineY) / g.sw >= LR_CFG.arms_down_below_shoulder_min;
  return nearHip || wellBelowShoulder;
}

/**
 * Every stance rule, each with its own pass flag, so the overlay can show a
 * checklist. `maxSw` is the widest shoulder span seen so far during setup.
 */
export function evaluateStance(g, maxSw) {
  const cueKeys = [];
  const sw = g.sw;

  const facingRatio = maxSw > 0 ? sw / maxSw : 1;
  const swTorso = sw / g.torsoDist;
  const facing = facingRatio >= LR_CFG.facing_min_ratio && swTorso >= LR_CFG.facing_sw_torso_min;
  if (!facing) cueKeys.push('lr_facing');

  const lean = Math.abs(g.shMid.x - g.hipMid.x) / sw;
  const torsoH = (g.hipY - g.shY) / sw;
  const ankleY = g.feetOk ? (g.la.y + g.ra.y) / 2 : null;
  const hipAboveAnkle = ankleY != null ? (ankleY - g.hipY) / sw : null;
  const upright = lean <= LR_CFG.upright_lean_max
    && torsoH >= LR_CFG.torso_height_min
    && (hipAboveAnkle == null || hipAboveAnkle >= LR_CFG.hip_above_ankle_min);
  if (!upright) cueKeys.push('lr_not_upright');

  let stanceRatio = null;
  let feet = false;
  if (!g.feetOk) {
    cueKeys.push('lr_feet_not_visible');
  } else {
    stanceRatio = Math.abs(g.la.x - g.ra.x) / sw;
    if (stanceRatio < LR_CFG.stance_min) cueKeys.push('lr_feet_narrow');
    else if (stanceRatio > LR_CFG.stance_max) cueKeys.push('lr_feet_wide');
    else feet = true;
  }

  const armsDown = armDown(g, g.left) && armDown(g, g.right);
  if (!armsDown) cueKeys.push('lr_arms_not_down');

  return {
    ok: cueKeys.length === 0,
    cueKeys,
    checks: { facing, upright, feet, armsDown },
    values: { facingRatio, swTorso, lean, torsoH, hipAboveAnkle, stanceRatio },
  };
}

// ── Activity helpers ────────────────────────────────────────────────────────

/** Live shoulder width vs the (distance-corrected) calibrated width; drops when the body turns. */
export function facingRatio(g, calib) {
  if (!calib?.sw) return 1;
  return g.sw / g.norm;
}

/**
 * Lift fraction of one arm: 0 at the calibrated resting elbow height,
 * 1 with the elbow on the shoulder line, >1 above it. Also for the wrist.
 */
export function armLift(a, calib) {
  if (!a.ok) return null;
  const restE = calib?.restElbow?.[a.side] ?? LR_CFG.rest_elbow_default;
  const restW = calib?.restWrist?.[a.side] ?? LR_CFG.rest_wrist_default;
  return {
    elbow: (restE - a.elbowDy) / Math.max(restE, 0.2),
    wrist: (restW - a.wristDy) / Math.max(restW, 0.2),
  };
}

/** Horizontal reference lines (pixel y) for the overlay. */
export function raiseLines(g, calib) {
  const n = g.norm;
  const restE = calib
    ? (calib.restElbow.left + calib.restElbow.right) / 2
    : LR_CFG.rest_elbow_default;
  return {
    shoulderY: g.shY,
    bandTopY: g.shY - LR_CFG.elbow_above_tolerance * n,
    bandBottomY: g.shY + LR_CFG.top_tolerance * n,
    wristLimitY: g.shY - LR_CFG.wrist_above_tolerance * n,
    returnY: g.shY + restE * (1 - LR_CFG.lift_return) * n,
  };
}
