// Front-view posture checks for the standing dumbbell shoulder press.
//
// Every check works on a pixel-space geometry snapshot (see buildGeometry) so
// ratios are not distorted by the camera aspect ratio. "Outward" offsets are
// measured away from the body midline using the anatomical shoulder order, so
// the same code is correct for mirrored and non-mirrored feeds.

import { LM, jointAngle } from '../../core/landmarks';
import { SP_CFG, SP_REQUIRED_UPPER, SP_REQUIRED_FEET } from './config';

function vis(lm) {
  return lm ? (lm.visibility == null ? 1 : lm.visibility) : 0;
}

function toPx(lm, w, h) {
  return lm ? { x: lm.x * w, y: lm.y * h, v: vis(lm) } : null;
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function allVisible(landmarks, indices, minVis = SP_CFG.min_visibility) {
  if (!landmarks) return false;
  return indices.every((i) => vis(landmarks[i]) >= minVis);
}

export function upperBodyVisible(landmarks) {
  return allVisible(landmarks, SP_REQUIRED_UPPER);
}

export function feetVisible(landmarks) {
  return allVisible(landmarks, SP_REQUIRED_FEET);
}

/**
 * Pixel-space snapshot of everything the checks need. Returns null when the
 * required upper-body landmarks are missing.
 */
export function buildGeometry(landmarks, w, h) {
  if (!upperBodyVisible(landmarks)) return null;
  const P = (i) => toPx(landmarks[i], w, h);

  const ls = P(LM.LEFT_SHOULDER);
  const rs = P(LM.RIGHT_SHOULDER);
  const le = P(LM.LEFT_ELBOW);
  const re = P(LM.RIGHT_ELBOW);
  const lw = P(LM.LEFT_WRIST);
  const rw = P(LM.RIGHT_WRIST);
  const lh = P(LM.LEFT_HIP);
  const rh = P(LM.RIGHT_HIP);
  const la = P(LM.LEFT_ANKLE);
  const ra = P(LM.RIGHT_ANKLE);
  const nose = P(LM.NOSE);
  const lear = P(LM.LEFT_EAR);
  const rear = P(LM.RIGHT_EAR);

  const sw = Math.max(Math.abs(ls.x - rs.x), 1);
  // +1 when the anatomical left shoulder has the larger x in the image.
  const outSign = ls.x >= rs.x ? 1 : -1;
  const shMid = mid(ls, rs);
  const hipMid = mid(lh, rh);
  const torsoLen = Math.max(dist(shMid, hipMid), 1);

  const leftAngle = jointAngle(ls, le, lw) ?? 0;
  const rightAngle = jointAngle(rs, re, rw) ?? 0;

  const minVis = SP_CFG.min_visibility;
  return {
    w, h, sw, outSign, torsoLen,
    ls, rs, le, re, lw, rw, lh, rh, la, ra, nose, lear, rear,
    shMid, hipMid,
    shY: shMid.y,
    leftAngle,
    rightAngle,
    angle: (leftAngle + rightAngle) / 2,
    leftArmLen: dist(ls, le) + dist(le, lw),
    rightArmLen: dist(rs, re) + dist(re, rw),
    feetOk: la.v >= minVis && ra.v >= minVis,
    earsOk: (lear?.v ?? 0) >= minVis && (rear?.v ?? 0) >= minVis,
    noseOk: (nose?.v ?? 0) >= minVis,
    // Hands above the top edge — the press will be cut off at lockout.
    handsClipped: lw.y < 0.01 * h || rw.y < 0.01 * h,
    // Shoulder width collapses when the user turns sideways.
    facingFront: sw / torsoLen >= 0.35,
  };
}

/** Signed horizontal offset of `point` from `ref`, positive = away from the midline. */
export function outward(g, side, point, ref) {
  const s = side === 'left' ? g.outSign : -g.outSign;
  return ((point.x - ref.x) * s) / g.sw;
}

function nearEdge(value, lo, hi) {
  const span = hi - lo;
  const margin = span * (1 - SP_CFG.near_limit_fraction) * 0.5;
  return value <= lo + margin || value >= hi - margin;
}

// ── Stance ──────────────────────────────────────────────────────────────────

export function checkStance(g, multiplier = 1) {
  if (!g.feetOk) return { ok: true, skipped: true, cueKeys: [], near: false };
  const ratio = Math.abs(g.la.x - g.ra.x) / g.sw;
  const min = 1 - SP_CFG.stance_narrow_tolerance * multiplier;
  const max = 1 + SP_CFG.stance_wide_tolerance * multiplier;
  const feetDy = Math.abs(g.la.y - g.ra.y) / g.sw;
  const feetDyMax = SP_CFG.feet_level_ratio_max * multiplier;

  const cueKeys = [];
  let status = 'ok';
  // Setup gate is width-only (feet under shoulders). Centering is never checked.
  if (ratio < min) { status = 'narrow'; cueKeys.push('sp_stance_narrow'); }
  else if (ratio > max) { status = 'wide'; cueKeys.push('sp_stance_wide'); }

  return {
    ok: cueKeys.length === 0,
    status,
    ratio, min, max,
    feetDy, feetDyMax,
    cueKeys,
    near: status === 'ok' && nearEdge(ratio, min, max),
  };
}

// ── Torso / shoulders ───────────────────────────────────────────────────────

export function checkTorsoLean(g) {
  // Positive → shoulders shifted toward the anatomical left side.
  const lean = ((g.shMid.x - g.hipMid.x) * g.outSign) / g.sw;
  const tol = SP_CFG.torso_lean_ratio_max;
  const cueKeys = [];
  if (lean > tol) cueKeys.push('sp_torso_lean_left');
  else if (lean < -tol) cueKeys.push('sp_torso_lean_right');
  return {
    ok: cueKeys.length === 0,
    lean, tol, cueKeys,
    near: cueKeys.length === 0 && Math.abs(lean) >= tol * SP_CFG.near_limit_fraction,
  };
}

export function checkShoulderLevel(g) {
  const dy = (g.ls.y - g.rs.y) / g.sw; // negative → left shoulder higher
  const tol = SP_CFG.shoulder_level_ratio_max;
  const cueKeys = [];
  if (Math.abs(dy) > tol) cueKeys.push(dy < 0 ? 'sp_shoulder_high_left' : 'sp_shoulder_high_right');
  return { ok: cueKeys.length === 0, dy, tol, cueKeys };
}

/** Ear→shoulder vertical gap per side, as a ratio of shoulder width. */
export function earShoulderGaps(g) {
  if (!g.earsOk) return null;
  return {
    left: (g.ls.y - g.lear.y) / g.sw,
    right: (g.rs.y - g.rear.y) / g.sw,
  };
}

export function checkShrug(g, baseline) {
  const min = SP_CFG.shrug_ratio_min;
  if (!baseline || !(min > 0)) return { ok: true, skipped: true, cueKeys: [] };
  const gaps = earShoulderGaps(g);
  if (!gaps) return { ok: true, skipped: true, cueKeys: [] };
  const lRatio = baseline.left > 0 ? gaps.left / baseline.left : 1;
  const rRatio = baseline.right > 0 ? gaps.right / baseline.right : 1;
  const ratio = Math.min(lRatio, rRatio);
  const cueKeys = ratio < min ? ['sp_shrug'] : [];
  return { ok: cueKeys.length === 0, ratio, min, cueKeys };
}

// ── Arm position / path ─────────────────────────────────────────────────────

/** Coarse movement zone from the averaged elbow angle. */
export function armZone(g) {
  if (g.angle >= SP_CFG.top_angle_min) return 'top';
  if (g.angle <= SP_CFG.bottom_angle_relaxed_max) return 'bottom';
  return 'mid';
}

/** Elbow height relative to the shoulder line (+ = below shoulders), per side. */
export function elbowDrop(g) {
  return {
    left: (g.le.y - g.ls.y) / g.sw,
    right: (g.re.y - g.rs.y) / g.sw,
  };
}

/** Dumbbells held in the start ("rack") position: wrists above elbows, elbows near shoulder height. */
export function isRacked(g) {
  const drop = elbowDrop(g);
  return g.lw.y < g.le.y && g.rw.y < g.re.y && drop.left < 0.9 && drop.right < 0.9;
}

/** Both wrists above the head. */
export function isOverhead(g, armLenRef) {
  const lineY = g.noseOk ? g.nose.y : g.shY - 0.5 * armLenRef;
  return g.lw.y < lineY && g.rw.y < lineY;
}

/** Arms hanging / resting — not in a press position at all. */
export function armsResting(g) {
  const lowL = g.lw.y > g.ls.y + 0.2 * g.sw;
  const lowR = g.rw.y > g.rs.y + 0.2 * g.sw;
  return lowL && lowR && !isRacked(g);
}

function forearmBand(side) {
  return {
    lo: -SP_CFG.forearm_inner_tolerance,
    hi: SP_CFG.forearm_outer_tolerance,
    side,
  };
}

export function checkForearms(g) {
  const lDx = outward(g, 'left', g.lw, g.le);
  const rDx = outward(g, 'right', g.rw, g.re);
  const lBand = forearmBand('left');
  const rBand = forearmBand('right');
  const cueKeys = [];
  if (lDx < lBand.lo) cueKeys.push('sp_forearm_left_inner');
  else if (lDx > lBand.hi) cueKeys.push('sp_forearm_left_outer');
  if (rDx < rBand.lo) cueKeys.push('sp_forearm_right_inner');
  else if (rDx > rBand.hi) cueKeys.push('sp_forearm_right_outer');
  const near =
    (lDx >= lBand.lo && lDx <= lBand.hi && nearEdge(lDx, lBand.lo, lBand.hi)) ||
    (rDx >= rBand.lo && rDx <= rBand.hi && nearEdge(rDx, rBand.lo, rBand.hi));
  return {
    ok: cueKeys.length === 0,
    left: { dx: lDx, ...lBand, ok: lDx >= lBand.lo && lDx <= lBand.hi },
    right: { dx: rDx, ...rBand, ok: rDx >= rBand.lo && rDx <= rBand.hi },
    cueKeys,
    near,
  };
}

export function checkElbowTuck(g) {
  const lOut = outward(g, 'left', g.le, g.ls);
  const rOut = outward(g, 'right', g.re, g.rs);
  const min = SP_CFG.elbow_tuck_min_ratio;
  const cueKeys = [];
  if (lOut < min) cueKeys.push('sp_elbow_left_tucked');
  if (rOut < min) cueKeys.push('sp_elbow_right_tucked');
  return { ok: cueKeys.length === 0, lOut, rOut, min, cueKeys };
}

export function checkTopWidth(g) {
  const lOut = outward(g, 'left', g.lw, g.ls);
  const rOut = outward(g, 'right', g.rw, g.rs);
  const max = SP_CFG.top_wide_ratio_max;
  const cueKeys = [];
  if (lOut > max) cueKeys.push('sp_top_wide_left');
  if (rOut > max) cueKeys.push('sp_top_wide_right');
  return { ok: cueKeys.length === 0, lOut, rOut, max, cueKeys };
}

export function checkSymmetry(g) {
  const dy = (g.lw.y - g.rw.y) / g.sw; // positive → left wrist lower
  const tol = SP_CFG.symmetry_ratio_max;
  const cueKeys = [];
  if (Math.abs(dy) > tol) cueKeys.push(dy > 0 ? 'sp_uneven_left_low' : 'sp_uneven_right_low');
  return {
    ok: cueKeys.length === 0,
    dy, tol, cueKeys,
    near: cueKeys.length === 0 && Math.abs(dy) >= tol * SP_CFG.near_limit_fraction,
  };
}

// ── Depth / height reference lines (pixel y) ────────────────────────────────

export function pressLines(g, armLenRef) {
  const shY = g.shY;
  return {
    shoulderY: shY,
    depthHighY: shY - SP_CFG.depth_elbow_high_ratio * g.sw,
    tooDeepY: shY + SP_CFG.depth_elbow_low_ratio * g.sw,
    topY: shY - SP_CFG.top_height_ratio * armLenRef,
  };
}

/**
 * Live posture during reps. Feet / torso lean / shoulder level are locked in
 * setup and are intentionally NOT re-checked here (only press-path cues).
 */
export function evaluatePressPosture(g, { baseline, zone }) {
  const shrug = checkShrug(g, baseline);
  const symmetry = checkSymmetry(g);
  const forearm = zone === 'top' ? { ok: true, cueKeys: [], near: false } : checkForearms(g);
  const elbow = zone === 'bottom' ? checkElbowTuck(g) : { ok: true, cueKeys: [] };
  const top = zone === 'top' ? checkTopWidth(g) : { ok: true, cueKeys: [] };

  const cueKeys = [
    ...symmetry.cueKeys,
    ...forearm.cueKeys,
    ...elbow.cueKeys,
    ...top.cueKeys,
    ...shrug.cueKeys,
  ];
  const near = !!(symmetry.near || forearm.near);

  return {
    cueKeys,
    skeletonColorKey: cueKeys.length ? 'red' : near ? 'yellow' : 'green',
    shrug, symmetry, forearm, elbow, top,
  };
}

/** Feet phase: ankle width ≈ shoulder width only (no centering). */
export function evaluateFeet(g) {
  const stance = checkStance(g, 1);
  return {
    ok: stance.ok && !stance.skipped,
    cueKeys: stance.cueKeys,
    stance,
  };
}

/**
 * Shoulder phase after feet lock: only flag a clear side bend / drop.
 * Light asymmetry stays within the (slider-adjustable) tolerances.
 */
export function evaluateShoulderSetup(g) {
  const torso = checkTorsoLean(g);
  const shoulder = checkShoulderLevel(g);
  const cueKeys = [...torso.cueKeys, ...shoulder.cueKeys];
  return { ok: cueKeys.length === 0, cueKeys, torso, shoulder };
}

/** @deprecated Use evaluateFeet / evaluateShoulderSetup. Kept for any old callers. */
export function evaluateStance(g) {
  const feet = evaluateFeet(g);
  const shoulders = evaluateShoulderSetup(g);
  const cueKeys = [...feet.cueKeys, ...shoulders.cueKeys];
  return {
    ok: feet.ok && shoulders.ok,
    cueKeys,
    stance: feet.stance,
    torso: shoulders.torso,
    shoulder: shoulders.shoulder,
  };
}
