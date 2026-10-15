// Side-view geometry for the lying leg raise. Pure functions — debouncing and
// the rep state machine live in LegRaiseRepTracker / LegRaiseFlow.
//
// All points are smoothed canvas-pixel positions (see LandmarkSmoother).

import { LM } from '../../core/landmarks.js';
import { LGR_CFG } from './config.js';
import { median, clamp } from '../common/math.js';

const SIDE_LM = {
  left: { shoulder: LM.LEFT_SHOULDER, hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE },
  right: { shoulder: LM.RIGHT_SHOULDER, hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE },
};
const NAMES = ['shoulder', 'hip', 'knee', 'ankle'];
const RAD = 180 / Math.PI;

/** Camera-facing side = the one whose four joints are seen most confidently. */
export function pickProfile(pts) {
  const score = (side) => NAMES.reduce((s, n) => s + (pts.get(SIDE_LM[side][n])?.v ?? 0), 0);
  return score('left') >= score('right') ? 'left' : 'right';
}

function angleAt(a, b, c) {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const m = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (m === 0) return 180;
  return Math.acos(clamp((abx * cbx + aby * cby) / m, -1, 1)) * RAD;
}

/**
 * Snapshot of everything the checks need. Returns null when any of the four
 * joints on the profile side is missing, or the body is degenerate.
 *
 *   theta      leg angle vs the torso line, + = above the floor (see config.js)
 *   kneeAngle  hip-knee-ankle interior angle (180 = dead straight)
 *   tilt       torso tilt from horizontal, + = hip higher than shoulder (deg)
 *   tiltDelta  tilt − calibrated tilt (deg) — hips / back leaving the floor
 */
export function buildGeometry(pts, profile, calib = null) {
  const idx = SIDE_LM[profile];
  const P = (n) => pts.get(idx[n]) || null;
  const S = P('shoulder');
  const H = P('hip');
  const K = P('knee');
  const A = P('ankle');
  if (!S || !H || !K || !A) return null;

  const tx = H.x - S.x;
  const ty = H.y - S.y;
  const torsoLen = Math.hypot(tx, ty);
  const lx = A.x - H.x;
  const ly = A.y - H.y;
  const legLen = Math.hypot(lx, ly);
  if (torsoLen < 8 || legLen < 8) return null;

  // Unit vectors along the torso (toward the feet) and "up" (perpendicular, y < 0).
  const ux = tx / torsoLen;
  const uy = ty / torsoLen;
  const up = tx >= 0 ? { x: uy, y: -ux } : { x: -uy, y: ux };

  const theta = Math.atan2(lx * up.x + ly * up.y, lx * ux + ly * uy) * RAD;
  const tilt = Math.atan2(-ty, Math.abs(tx)) * RAD;

  return {
    profile,
    S, H, K, A,
    torsoLen,
    legLen,
    along: { x: ux, y: uy }, // torso direction (toward the feet)
    up,
    theta,
    kneeAngle: angleAt(H, K, A),
    tilt,
    tiltDelta: calib ? tilt - calib.tilt0 : 0,
    lengthRatio: calib?.torsoLen ? torsoLen / calib.torsoLen : 1,
  };
}

/** Unit direction of a leg at angle `deg` above the torso line. */
export function legDirection(g, deg) {
  const r = deg / RAD;
  return {
    x: Math.cos(r) * g.along.x + Math.sin(r) * g.up.x,
    y: Math.cos(r) * g.along.y + Math.sin(r) * g.up.y,
  };
}

// ── Setup ───────────────────────────────────────────────────────────────────

/**
 * Setup rules, each with its own pass flag so the overlay can show a checklist.
 * @returns {{ ok: boolean, cueKeys: string[], checks: object }}
 */
export function evaluateSetup(g) {
  const C = LGR_CFG;
  const visible = !!g;
  const lying = visible && Math.abs(g.tilt) <= C.lying_torso_max_deg;
  const legsDown = visible && g.theta <= C.legs_down_max_deg && g.theta >= C.legs_down_min_deg;
  const checks = { visible, lying, legsDown };

  const cueKeys = [];
  if (!visible) cueKeys.push('lgr_body_not_visible');
  else if (!lying) cueKeys.push('lgr_not_lying');
  else if (!legsDown) cueKeys.push('lgr_legs_not_down');
  return { ok: cueKeys.length === 0, cueKeys, checks };
}

export function calibrationSample(g) {
  return { theta: g.theta, tilt: g.tilt, torsoLen: g.torsoLen, legLen: g.legLen, knee: g.kneeAngle };
}

/** Leg-angle range of the samples — a large spread means the person is still moving. */
export function sampleStillness(samples) {
  if (!samples.length) return 0;
  const t = samples.map((s) => s.theta);
  return Math.max(...t) - Math.min(...t);
}

export function makeCalibration(samples, profile) {
  const m = (k) => median(samples.map((s) => s[k]));
  return {
    profile,
    tilt0: m('tilt'),
    torsoLen: m('torsoLen'),
    legLen: m('legLen'),
    theta0: m('theta'),
  };
}
