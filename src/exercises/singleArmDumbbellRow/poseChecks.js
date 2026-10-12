// Side / three-quarter view checks for the single-arm dumbbell row.
//
// Every rule measures the working arm in the torso's own frame (see
// config.js): depth below the TORSO LINE (hip → shoulder) and travel back
// along it, both divided by the live torso length T. Nothing depends on a
// universal joint angle, the torso angle, or the camera distance.

import { SR_CFG, SR_SIDE_LANDMARKS } from './config';
import { dist } from '../common/math';

export const SR_OTHER_SIDE = { left: 'right', right: 'left' };

const SIDE_SCORE_NAMES = ['shoulder', 'elbow', 'wrist', 'hip', 'knee'];
const REQUIRED_NAMES = ['shoulder', 'elbow', 'wrist', 'hip'];

const vis = (p) => (p ? (p.visibility == null ? 1 : p.visibility) : 0);

// ── Working side / view confidence (raw landmarks) ──────────────────────────

/** Summed raw visibility of each side's shoulder, elbow, wrist, hip and knee. */
export function sideScores(landmarks) {
  const out = { left: 0, right: 0 };
  if (!landmarks) return out;
  for (const side of ['left', 'right']) {
    for (const name of SIDE_SCORE_NAMES) out[side] += vis(landmarks[SR_SIDE_LANDMARKS[side][name]]);
  }
  return out;
}

/** Mean raw visibility (0–1) of the working shoulder, elbow, wrist and hip. */
export function viewConfidence(landmarks, side) {
  if (!landmarks || !side) return 0;
  const lm = SR_SIDE_LANDMARKS[side];
  return REQUIRED_NAMES.reduce((s, name) => s + vis(landmarks[lm[name]]), 0) / REQUIRED_NAMES.length;
}

// ── Geometry ────────────────────────────────────────────────────────────────

/**
 * Snapshot of everything the checks need for the working `side`, built from
 * smoothed pixel points. Returns null when that side's shoulder or hip is not
 * available. The arm (`arm.ok` = elbow, `arm.wristOk`) and the far shoulder
 * (`sep`) degrade individually.
 */
export function buildRowGeometry(pts, side) {
  if (!side) return null;
  const P = (i) => pts.get(i) || null;
  const lm = SR_SIDE_LANDMARKS[side];
  const om = SR_SIDE_LANDMARKS[SR_OTHER_SIDE[side]];
  const shoulder = P(lm.shoulder);
  const hip = P(lm.hip);
  if (!shoulder || !hip) return null;
  const elbow = P(lm.elbow);
  const wrist = P(lm.wrist);
  const knee = P(lm.knee);
  const otherShoulder = P(om.shoulder);

  const T = Math.max(dist(shoulder, hip), 1);
  const u = { x: (shoulder.x - hip.x) / T, y: (shoulder.y - hip.y) / T };
  // Normal on the floor side of the back (image y grows downward).
  const n = u.x >= 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
  // Torso above horizontal, degrees (0 = flat back, 90 = standing upright).
  const elev = (Math.atan2(-u.y, Math.abs(u.x)) * 180) / Math.PI;

  const frame = (p) => {
    const dx = p.x - shoulder.x;
    const dy = p.y - shoulder.y;
    return { depth: (dx * n.x + dy * n.y) / T, back: -(dx * u.x + dy * u.y) / T };
  };

  const e = elbow ? frame(elbow) : null;
  const upperLen = elbow ? dist(shoulder, elbow) : 0;
  const foreLen = elbow && wrist ? dist(elbow, wrist) : 0;
  const arm = {
    side,
    ok: !!elbow,
    wristOk: !!(elbow && wrist),
    shoulder,
    elbow,
    wrist,
    depth: e ? e.depth : null,
    back: e ? e.back : null,
    wristDepth: elbow && wrist ? frame(wrist).depth : null,
    // 1 = arm fully straight; distance ratio, not an angle.
    extension: elbow && wrist ? dist(shoulder, wrist) / Math.max(upperLen + foreLen, 1) : null,
    held: !!(elbow?.held || wrist?.held),
  };

  // The far shoulder's offset across the back drifts when the torso rotates
  // open. Only trusted while that shoulder is clearly (not held) visible.
  const farOk = !!otherShoulder && !otherShoulder.held && otherShoulder.v >= SR_CFG.rotation_min_visibility;

  return {
    side,
    shoulder,
    hip,
    elbow,
    wrist,
    knee,
    otherShoulder,
    T,
    u,
    n,
    elev,
    arm,
    sep: farOk ? frame(otherShoulder).depth : null,
    // Shoulder span / torso length: large when the user faces the camera.
    span: otherShoulder ? dist(shoulder, otherShoulder) / T : null,
  };
}

/** Pixel point at (depth, back) in the body frame — both × T from the shoulder. */
export function bodyPoint(g, depth, back) {
  return {
    x: g.shoulder.x + (g.n.x * depth - g.u.x * back) * g.T,
    y: g.shoulder.y + (g.n.y * depth - g.u.y * back) * g.T,
  };
}

// ── Start position (SETUP_STANCE) ───────────────────────────────────────────

export function isSideOn(g) {
  return g.span == null || g.span <= SR_CFG.view_span_max;
}

export function isBentOver(g, slackDeg = 0) {
  return g.elev <= SR_CFG.torso_angle_max_deg + slackDeg;
}

/**
 * Every start-position rule, each with its own pass flag, so the overlay can
 * show a checklist. `confidence` is the raw working-side view confidence.
 */
export function evaluateRowSetup(g, confidence) {
  const cueKeys = [];
  const a = g.arm;
  const visible = confidence >= SR_CFG.min_view_confidence && a.ok && a.wristOk;
  const sideOn = isSideOn(g);
  if (!visible) cueKeys.push('sr_arm_not_visible');
  else if (!sideOn) cueKeys.push('sr_not_side_on');

  const bentOver = isBentOver(g);
  if (!bentOver) cueKeys.push('sr_not_bent_over');

  const armDown = visible
    && a.depth >= SR_CFG.setup_elbow_depth_min
    && a.wristDepth > a.depth
    && a.extension >= SR_CFG.start_extension_min;
  if (!armDown) cueKeys.push('sr_arm_not_down');

  return {
    ok: cueKeys.length === 0,
    cueKeys,
    checks: { view: visible && sideOn, bentOver, armDown },
    values: { confidence, elev: g.elev, span: g.span, depth: a.depth, extension: a.extension },
  };
}

// ── Row progress ────────────────────────────────────────────────────────────

export function restDepth(calib) {
  return calib?.restDepth ?? SR_CFG.rest_depth_default;
}

/** Row progress (0 = calibrated hanging start, 1 = elbow in the TOP band); unclamped. */
export function rowProgress(arm, calib) {
  if (!arm?.ok) return null;
  const rest = restDepth(calib);
  return (rest - arm.depth) / Math.max(rest - SR_CFG.top_tolerance, 0.1);
}

/** Wrist lift (0 = calibrated hanging wrist, 1 = wrist on the torso line); unclamped. */
export function wristLift(arm, calib) {
  if (!arm?.wristOk) return null;
  const rest = calib?.restWristDepth ?? SR_CFG.rest_wrist_depth_default;
  return (rest - arm.wristDepth) / Math.max(rest, 0.2);
}

/**
 * Everything the rep tracker needs for the working arm this frame, or null
 * when the elbow is unavailable.
 *   progress    row progress (unclamped)
 *   top         elbow within top_tolerance of the torso line (or above it)
 *   inStart     elbow (and wrist, when visible) back in the start zone
 *   backTravel  elbow travel back toward the hip vs the calibrated start, × T
 */
export function armMetrics(g, calib) {
  const a = g?.arm;
  if (!a?.ok) return null;
  const progress = rowProgress(a, calib);
  const wl = wristLift(a, calib);
  return {
    progress,
    top: a.depth <= SR_CFG.top_tolerance,
    inStart: progress <= SR_CFG.lift_return && (wl == null || wl <= SR_CFG.lift_return),
    backTravel: a.back - (calib?.restBack ?? 0),
  };
}

/** Reference depths / back offsets (× T) for the overlay. */
export function rowLines(calib) {
  const rest = restDepth(calib);
  const tol = SR_CFG.top_tolerance;
  return {
    topDepth: tol,
    restDepth: rest,
    startDepth: rest - SR_CFG.lift_return * Math.max(rest - tol, 0.1),
    laneBack: (calib?.restBack ?? 0) + SR_CFG.elbow_back_min,
  };
}
