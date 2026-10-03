// Front-view checks for the dumbbell curl.
//
// Angle-free by design: every rule compares a landmark's y against a
// horizontal reference line, or uses a distance ratio. Vertical distances
// are divided by the torso length T, horizontal ones by the shoulder width
// SW (both distance-corrected once calibrated). See config.js for the lines.

import { LM } from '../../core/landmarks';
import { DC_CFG } from './config';
import { mid, dist, clamp } from '../common/math';
import { evaluateFrontStance } from '../common/frontStance';

/**
 * Snapshot of everything the checks need, built from smoothed pixel points.
 * Returns null when the core (both shoulders + both hips) is not available.
 * Arms and ankles degrade individually (`arm.ok`, `feetOk`).
 */
export function buildCurlGeometry(pts, calib = null) {
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
  // Calibrated sizes rescaled by the live torso length, so stepping closer /
  // farther after calibration keeps every ratio valid. The torso barely
  // changes while curling or turning, unlike the live shoulder span.
  const scale = calib?.torso ? clamp(torsoDist / calib.torso, 0.5, 2) : 1;
  const norm = calib?.sw ? calib.sw * scale : sw;
  const T = calib?.torso ? calib.torso * scale : torsoDist;

  const arm = (side, shoulder, elbow, wrist, hip) => {
    const ok = !!(elbow && wrist);
    const lineY = DC_CFG.line_mode === 'average' ? shY : shoulder.y;
    // +1 when this side's shoulder is on the +x side of the body center.
    const out = Math.sign(shoulder.x - shMid.x) || (side === 'left' ? 1 : -1);
    return {
      side,
      ok,
      shoulder,
      elbow,
      wrist,
      hip,
      lineY,
      // Signed vertical offsets below the shoulder line, in T (+ = below).
      span: ok ? (wrist.y - lineY) / T : null,
      elbowDy: ok ? (elbow.y - lineY) / T : null,
      // Elbow horizontal offset outside the same-side hip, in SW (+ = outward).
      elbowOut: ok ? ((elbow.x - hip.x) * out) / norm : null,
      held: !!(elbow?.held || wrist?.held),
    };
  };

  return {
    ls, rs, lh, rh, le, re, lw, rw, la, ra,
    sw,
    norm,
    T,
    shMid,
    hipMid,
    shY,
    hipY: hipMid.y,
    torsoDist,
    vertTorso: hipMid.y - shY,
    feetOk: !!(la && ra),
    left: arm('left', ls, le, lw, lh),
    right: arm('right', rs, re, rw, rh),
    // Raw shoulder tilt, signed: + = left shoulder lower in the image.
    tilt: (ls.y - rs.y) / norm,
  };
}

// ── Stance (SETUP_STANCE) ───────────────────────────────────────────────────

export function evaluateCurlStance(g, maxSw) {
  return evaluateFrontStance(g, maxSw, DC_CFG, 'dc_');
}

// ── Activity helpers ────────────────────────────────────────────────────────

/** Live shoulder width vs the (distance-corrected) calibrated width; drops when the body turns. */
export function facingRatio(g, calib) {
  if (!calib?.sw) return 1;
  return g.sw / g.norm;
}

// ── Per-arm curl metrics ────────────────────────────────────────────────────

export function restSpan(side, calib) {
  return calib?.restSpan?.[side] ?? DC_CFG.rest_span_default;
}

/** Curl progress (0 = resting, 1 = wrist on the top target line); unclamped. */
export function curlProgress(a, calib) {
  if (!a?.ok) return null;
  const rest = restSpan(a.side, calib);
  return (rest - a.span) / Math.max(rest - DC_CFG.top_line_offset, 0.2);
}

/** Progress value at which the wrist enters the TOP tolerance zone. */
export function topProgressAt(side, calib) {
  const rest = restSpan(side, calib);
  const range = Math.max(rest - DC_CFG.top_line_offset, 0.2);
  return (rest - DC_CFG.top_line_offset - DC_CFG.top_tolerance) / range;
}

/**
 * Everything the rep tracker needs for one arm this frame, or null when the
 * arm's landmarks are unavailable.
 *   progress    curl progress (unclamped)
 *   top         wrist within top_tolerance of the TOP TARGET LINE (or above it)
 *   inBottom    wrist within bottom_tolerance of the resting level (extended)
 *   overUpper   how far the wrist is above the UPPER TOLERANCE LINE, in SW (+ = crossed)
 *   elbowLift   elbow rise above its resting height, in T (+ = higher)
 *   elbowFlare  elbow moved outward vs its resting elbow–hip offset, in SW (+ = out)
 */
export function armMetrics(a, g, calib) {
  if (!a?.ok) return null;
  const rest = restSpan(a.side, calib);
  const restE = calib?.restElbow?.[a.side] ?? DC_CFG.rest_elbow_default;
  const restOut = calib?.restElbowOut?.[a.side] ?? a.elbowOut;
  const upperY = a.lineY - DC_CFG.upper_allowance * g.norm;
  return {
    progress: curlProgress(a, calib),
    top: a.span <= DC_CFG.top_line_offset + DC_CFG.top_tolerance,
    inBottom: a.span >= rest - DC_CFG.bottom_tolerance,
    overUpper: (upperY - a.wrist.y) / g.norm,
    elbowLift: restE - a.elbowDy,
    elbowFlare: a.elbowOut - restOut,
  };
}

/** Horizontal reference lines (pixel y) for one arm, for the overlay. */
export function curlLines(g, a, calib) {
  const T = g.T;
  const rest = restSpan(a.side, calib);
  const restE = calib?.restElbow?.[a.side] ?? DC_CFG.rest_elbow_default;
  return {
    shoulderY: a.lineY,
    upperY: a.lineY - DC_CFG.upper_allowance * g.norm,
    targetY: a.lineY + DC_CFG.top_line_offset * T,
    topTolY: a.lineY + (DC_CFG.top_line_offset + DC_CFG.top_tolerance) * T,
    bottomY: a.lineY + rest * T,
    bottomZoneY: a.lineY + (rest - DC_CFG.bottom_tolerance) * T,
    restElbowY: a.lineY + restE * T,
    elbowLiftY: a.lineY + (restE - DC_CFG.elbow_lift_tolerance) * T,
  };
}
