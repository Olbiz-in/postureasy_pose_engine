// Geometry + per-frame measurements for the lunge (front and side view).
//
// Everything works on smoothed PIXEL points (LandmarkSmoother output) and is
// pure: no timing, no state. Distances are divided by `norm` (torso length);
// signed deviations are measured against the calibrated standing baseline so a
// person's normal anatomical variation (natural knee line, slightly uneven
// hips, relaxed posture) is never reported as an error.

import { LM, jointAngle } from '../../core/landmarks.js';
import { LUNGE_CFG } from './config.js';
import { mid, dist, clamp, median } from '../common/math.js';

const SIDES = ['left', 'right'];

const LM_BY_SIDE = {
  left: {
    shoulder: LM.LEFT_SHOULDER, hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE,
    heel: LM.LEFT_HEEL, toe: LM.LEFT_FOOT_INDEX,
  },
  right: {
    shoulder: LM.RIGHT_SHOULDER, hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE,
    heel: LM.RIGHT_HEEL, toe: LM.RIGHT_FOOT_INDEX,
  },
};

const deg = (rad) => (rad * 180) / Math.PI;

/**
 * Side view: which body side faces the camera. Decided from landmark
 * visibility only, then LOCKED by the flow at calibration — it is never
 * re-derived mid-set, so a flickering far-side leg cannot flip the tracking.
 */
export function pickProfile(pts) {
  const score = (side) => ['shoulder', 'hip', 'knee', 'ankle']
    .reduce((s, k) => s + (pts.get(LM_BY_SIDE[side][k])?.v ?? 0), 0);
  return score('left') >= score('right') ? 'left' : 'right';
}

/**
 * Snapshot of everything the checks need. Returns null when the core
 * (both shoulders + both hips) is unavailable. Legs degrade individually.
 */
export function buildGeometry(pts, calib = null, view = 'front', profile = null) {
  const P = (i) => pts.get(i) || null;
  const ls = P(LM.LEFT_SHOULDER);
  const rs = P(LM.RIGHT_SHOULDER);
  const lh = P(LM.LEFT_HIP);
  const rh = P(LM.RIGHT_HIP);
  if (!ls || !rs || !lh || !rh) return null;

  const legs = {};
  for (const side of SIDES) {
    const m = LM_BY_SIDE[side];
    legs[side] = {
      side,
      hip: side === 'left' ? lh : rh,
      knee: P(m.knee),
      ankle: P(m.ankle),
      heel: P(m.heel),
      toe: P(m.toe),
    };
  }

  const shMid = mid(ls, rs);
  const hipMid = mid(lh, rh);
  const torso = Math.max(dist(shMid, hipMid), 1);
  const norm = calib?.torso ? clamp(torso, calib.torso * 0.6, calib.torso * 1.6) : torso;
  const sw = Math.abs(ls.x - rs.x);

  const side = view === 'side' ? profile : null;
  const refHip = view === 'side' ? (side ? legs[side].hip : null) : hipMid;
  const refAnkle = view === 'side'
    ? (side ? legs[side].ankle : null)
    : (legs.left.ankle && legs.right.ankle ? mid(legs.left.ankle, legs.right.ankle) : null);
  const refShoulder = view === 'side' ? (side ? (side === 'left' ? ls : rs) : null) : shMid;

  return {
    view,
    profile: side,
    ls, rs, lh, rh,
    legs,
    nose: P(LM.NOSE),
    shMid,
    hipMid,
    sw,
    torso,
    norm,
    swRatio: sw / torso,
    tilt: (lh.y - rh.y) / norm, // signed: + = left hip lower in the image
    refHip,
    refAnkle,
    refShoulder,
    // Hip → ankle height in pixels; the depth signal.
    standHeight: refHip && refAnkle ? refAnkle.y - refHip.y : null,
  };
}

// ── Depth ────────────────────────────────────────────────────────────────────

/** 0 = standing at the calibrated height, 1 = hip at ankle height; null if unmeasurable. */
export function depthOf(g, calib) {
  if (!calib?.standH || g?.standHeight == null) return null;
  return clamp((calib.standH - g.standHeight) / calib.standH, -0.2, 1.2);
}

// ── Facing direction (side view) ─────────────────────────────────────────────

/** +1 = facing image-right, −1 = image-left, 0 = unknown. */
export function facingSign(g) {
  if (!g?.profile) return 0;
  const leg = g.legs[g.profile];
  if (leg.toe && leg.heel) {
    const d = (leg.toe.x - leg.heel.x) / g.torso;
    if (Math.abs(d) >= LUNGE_CFG.side_dir_toe_min) return Math.sign(d);
  }
  if (g.nose) {
    const d = (g.nose.x - g.shMid.x) / g.torso;
    if (Math.abs(d) >= LUNGE_CFG.side_dir_nose_min) return Math.sign(d);
  }
  return 0;
}

// ── Front-view measurements ──────────────────────────────────────────────────

/**
 * Inward knee deviation of one leg from its own hip→ankle line, / norm, minus
 * the person's standing baseline. + = knee collapsing toward the midline.
 * Independent per leg — a hidden leg yields null, never the other leg's value.
 */
export function kneeValgus(g, side, calib) {
  const l = g.legs[side];
  if (!l.knee || !l.ankle) return null;
  const dy = l.ankle.y - l.hip.y;
  if (dy < 0.3 * g.norm) return null;
  const t = (l.knee.y - l.hip.y) / dy;
  if (t < 0.2 || t > 1.2) return null;
  const out = Math.sign(l.hip.x - g.hipMid.x);
  if (!out) return null;
  const lineX = l.hip.x + t * (l.ankle.x - l.hip.x);
  return (-out * (l.knee.x - lineX)) / g.norm - (calib?.valgus0?.[side] ?? 0);
}

export function frontMeasures(g, calib) {
  const ankleMid = g.legs.left.ankle && g.legs.right.ankle ? mid(g.legs.left.ankle, g.legs.right.ankle) : null;
  return {
    valgusLeft: kneeValgus(g, 'left', calib),
    valgusRight: kneeValgus(g, 'right', calib),
    // + = hips drifting toward image-right of the feet.
    hipShift: ankleMid ? (g.hipMid.x - ankleMid.x) / g.norm - (calib?.hipShift0 ?? 0) : null,
    pelvisTilt: Math.abs(g.tilt - (calib?.tilt0 ?? 0)),
    trunkSway: (g.shMid.x - g.hipMid.x) / g.norm - (calib?.trunk0 ?? 0),
  };
}

// ── Side-view measurements ───────────────────────────────────────────────────

/** Torso inclination from vertical in degrees (+ = leaning toward the facing direction). */
export function torsoLeanDeg(g, dir) {
  if (!g.refShoulder || !g.refHip || !dir) return null;
  const forward = (g.refShoulder.x - g.refHip.x) * dir;
  const up = g.refHip.y - g.refShoulder.y;
  if (up <= 0) return null;
  return deg(Math.atan2(forward, up));
}

function legKneeDeg(l) {
  if (!l.knee || !l.ankle) return null;
  return jointAngle(l.hip, l.knee, l.ankle);
}

/** Shin (ankle → knee) tilt from vertical in degrees (+ = knee ahead of the ankle). */
export function shinTiltDeg(l, dir) {
  if (!l?.knee || !l?.ankle || !dir) return null;
  const forward = (l.knee.x - l.ankle.x) * dir;
  const up = l.ankle.y - l.knee.y;
  if (up <= 0) return null;
  return deg(Math.atan2(forward, up));
}

export function sideMeasures(g, calib) {
  const dir = calib?.dir || facingSign(g);
  const lean = torsoLeanDeg(g, dir);
  return {
    leanDeg: lean == null ? null : lean - (calib?.lean0 ?? 0),
    kneeDeg: { left: legKneeDeg(g.legs.left), right: legKneeDeg(g.legs.right) },
    shinDeg: { left: shinTiltDeg(g.legs.left, dir), right: shinTiltDeg(g.legs.right, dir) },
  };
}

// ── Which leg is in front ────────────────────────────────────────────────────

/**
 * One frame's vote for the leading leg ('left' | 'right' | null). Null when the
 * feet are not separated enough or an ankle is missing — never a guess.
 *  - side view : the ankle further along the facing direction leads.
 *  - front view: the planted front foot sits closer to the camera, i.e. lower
 *                in the image than the (heel-raised) rear foot.
 */
export function legVote(g, calib) {
  const la = g.legs.left.ankle;
  const ra = g.legs.right.ankle;
  if (!la || !ra) return null;
  if (g.view === 'side') {
    const dir = calib?.dir || facingSign(g);
    if (!dir) return null;
    const sep = ((la.x - ra.x) * dir) / g.norm;
    return Math.abs(sep) >= LUNGE_CFG.leg_sep_side ? (sep > 0 ? 'left' : 'right') : null;
  }
  const sep = (la.y - ra.y) / g.norm;
  return Math.abs(sep) >= LUNGE_CFG.leg_sep_front ? (sep > 0 ? 'left' : 'right') : null;
}

// ── Setup (calibration) checks ───────────────────────────────────────────────

/**
 * Validate the standing pose before calibration. Each rule has its own pass
 * flag (checklist) and a cue key when it fails. Calibration only completes
 * while `ok` holds.
 */
export function evaluateSetup(g, view, frame) {
  const cueKeys = [];
  const C = LUNGE_CFG;
  const L = g.legs;

  const visible = view === 'side'
    ? !!(g.profile && L[g.profile].knee && L[g.profile].ankle)
    : !!(L.left.knee && L.right.knee && L.left.ankle && L.right.ankle);
  if (!visible) cueKeys.push('lunge_body_not_visible');

  let feetInFrame = true;
  if (visible && frame?.height) {
    const ankles = view === 'side' ? [L[g.profile].ankle] : [L.left.ankle, L.right.ankle];
    const limit = frame.height * (1 - C.frame_margin);
    feetInFrame = ankles.every((a) => a.y <= limit);
    if (!feetInFrame) cueKeys.push('lunge_feet_cut');
  }

  let viewOk;
  let dir = 0;
  if (view === 'side') {
    dir = facingSign(g);
    viewOk = g.swRatio <= C.side_sw_ratio_max && dir !== 0;
    if (!viewOk) cueKeys.push('lunge_turn_side');
  } else {
    viewOk = g.swRatio >= C.front_sw_ratio_min;
    if (!viewOk) cueKeys.push('lunge_face_front');
  }

  let upright = false;
  let leanValue = null;
  const heightRatio = g.standHeight != null ? g.standHeight / g.norm : null;
  if (visible) {
    const tall = heightRatio != null && heightRatio >= C.stand_height_min;
    if (view === 'side') {
      leanValue = dir ? torsoLeanDeg(g, dir) : null;
      upright = tall && (leanValue == null || Math.abs(leanValue) <= C.upright_torso_deg_max);
    } else {
      leanValue = Math.abs(g.shMid.x - g.hipMid.x) / g.torso;
      upright = tall && leanValue <= C.upright_lean_max;
    }
    if (viewOk && !upright) cueKeys.push('lunge_not_upright');
  }

  return {
    ok: cueKeys.length === 0,
    cueKeys,
    checks: { visible: visible && feetInFrame, view: viewOk, upright },
    values: { swRatio: g.swRatio, heightRatio, lean: leanValue, dir },
  };
}

/** One standing-pose sample for calibration (geometry built with calib = null). */
export function calibrationSample(g) {
  const m = g.view === 'side' ? null : frontMeasures(g, null);
  return {
    standH: g.standHeight,
    torso: g.torso,
    sw: g.sw,
    swRatio: g.swRatio,
    tilt: g.tilt,
    hipShift: m?.hipShift ?? null,
    trunk: m?.trunkSway ?? null,
    valgusLeft: m?.valgusLeft ?? null,
    valgusRight: m?.valgusRight ?? null,
    lean: g.view === 'side' ? torsoLeanDeg(g, facingSign(g)) : null,
    dir: g.view === 'side' ? facingSign(g) : 0,
  };
}

const med = (samples, key) => {
  const v = samples.map((s) => s[key]).filter((x) => x != null && Number.isFinite(x));
  return v.length ? median(v) : null;
};

/** Standing-height spread of the sample window / torso — calibration needs the person still. */
export function sampleStillness(samples) {
  const h = samples.map((s) => s.standH).filter((x) => x != null);
  if (h.length < 2) return Infinity;
  return (Math.max(...h) - Math.min(...h)) / Math.max(med(samples, 'torso') || 1, 1);
}

export function makeCalibration(samples, view, profile) {
  const votes = samples.reduce((s, x) => s + (x.dir || 0), 0);
  return {
    view,
    profile: view === 'side' ? profile : null,
    standH: med(samples, 'standH'),
    torso: med(samples, 'torso'),
    sw: med(samples, 'sw'),
    swRatio: med(samples, 'swRatio'),
    tilt0: med(samples, 'tilt') ?? 0,
    hipShift0: med(samples, 'hipShift') ?? 0,
    trunk0: med(samples, 'trunk') ?? 0,
    valgus0: { left: med(samples, 'valgusLeft') ?? 0, right: med(samples, 'valgusRight') ?? 0 },
    lean0: med(samples, 'lean') ?? 0,
    dir: view === 'side' ? (Math.sign(votes) || 0) : 0,
    samples: samples.length,
  };
}
