// Side-view plank geometry: visible-side detection, position gate and the raw
// per-frame form metrics. Pure functions — debouncing lives in the tracker.

import { LM } from '../../core/landmarks';
import { PLANK_SIDE_CFG as CFG } from './config';

const SIDE_LM = {
  left: {
    ear: LM.LEFT_EAR,
    shoulder: LM.LEFT_SHOULDER,
    elbow: LM.LEFT_ELBOW,
    wrist: LM.LEFT_WRIST,
    hip: LM.LEFT_HIP,
    knee: LM.LEFT_KNEE,
    ankle: LM.LEFT_ANKLE,
  },
  right: {
    ear: LM.RIGHT_EAR,
    shoulder: LM.RIGHT_SHOULDER,
    elbow: LM.RIGHT_ELBOW,
    wrist: LM.RIGHT_WRIST,
    hip: LM.RIGHT_HIP,
    knee: LM.RIGHT_KNEE,
    ankle: LM.RIGHT_ANKLE,
  },
};

const SIDE_SCORE_NAMES = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'];
const REQUIRED_NAMES = ['shoulder', 'elbow', 'hip', 'knee', 'ankle'];

const vis = (p) => (p ? (p.visibility == null ? 1 : p.visibility) : 0);

export function detectVisibleSide(landmarks) {
  let left = 0;
  let right = 0;
  for (const name of SIDE_SCORE_NAMES) {
    left += vis(landmarks[SIDE_LM.left[name]]);
    right += vis(landmarks[SIDE_LM.right[name]]);
  }
  return left >= right ? 'left' : 'right';
}

export function plankLandmarksVisible(landmarks, side) {
  if (!landmarks) return false;
  return REQUIRED_NAMES.every((name) => vis(landmarks[SIDE_LM[side][name]]) >= CFG.min_visibility);
}

/** Visible-side landmarks converted to canvas pixels. */
export function sidePoints(landmarks, side, w, h) {
  const out = {};
  for (const [name, idx] of Object.entries(SIDE_LM[side])) {
    const p = landmarks[idx];
    out[name] = p ? { x: p.x * w, y: p.y * h, v: vis(p) } : null;
  }
  return out;
}

function angleAt(a, b, c) {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const m = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (m === 0) return 180;
  const cos = Math.max(-1, Math.min(1, (abx * cbx + aby * cby) / m));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Signed vertical offset of p from the line a→b at p.x (+ = p is lower on screen). */
function offsetBelowLine(p, a, b) {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-6) return 0;
  const lineY = a.y + ((b.y - a.y) * (p.x - a.x)) / dx;
  return p.y - lineY;
}

/**
 * Raw metrics for one frame. Returns null when the geometry is degenerate.
 *   bodyTiltDeg   shoulder→ankle angle from horizontal
 *   hipDev        hip offset from the shoulder→ankle line / body length (+ sag)
 *   hipAngle      shoulder-hip-ankle interior angle
 *   kneeAngle     hip-knee-ankle interior angle
 *   elbowAngle    shoulder-elbow-wrist (null when the wrist is hidden)
 *   plankType     'forearm' | 'high'
 *   stackOffset   shoulder ahead (+) / behind (−) the support point / torso
 *   headDev       ear offset from the hip→shoulder line / torso (+ dropping), or null
 *   armsSupporting shoulders above the support point
 */
export function computePlankMetrics(pts) {
  const { shoulder: sh, hip, ankle, knee, elbow, wrist, ear } = pts;
  const bodyLen = Math.hypot(ankle.x - sh.x, ankle.y - sh.y);
  const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y);
  if (bodyLen < 1 || torso < 1) return null;

  const bodyTiltDeg = (Math.atan2(Math.abs(ankle.y - sh.y), Math.abs(ankle.x - sh.x)) * 180) / Math.PI;
  const hipDev = offsetBelowLine(hip, sh, ankle) / bodyLen;
  const hipAngle = angleAt(sh, hip, ankle);
  const kneeAngle = angleAt(hip, knee, ankle);

  const wristOk = wrist && wrist.v >= CFG.min_visibility;
  const elbowAngle = wristOk ? angleAt(sh, elbow, wrist) : null;
  const plankType = elbowAngle == null || elbowAngle <= CFG.forearm_plank_max_elbow_deg ? 'forearm' : 'high';
  const support = plankType === 'forearm' ? elbow : wrist;

  // Head direction along the body: +1 when the head points toward +x.
  const facing = sh.x >= hip.x ? 1 : -1;
  const stackOffset = ((sh.x - support.x) * facing) / torso;
  const armsSupporting = support.y > sh.y;

  let headDev = null;
  if (ear && ear.v >= CFG.ear_min_visibility) {
    headDev = offsetBelowLine(ear, hip, sh) / torso;
  }

  return {
    bodyTiltDeg,
    hipDev,
    hipAngle,
    kneeAngle,
    elbowAngle,
    plankType,
    stackOffset,
    headDev,
    armsSupporting,
    facing,
  };
}

/** True when the body is in a plank: horizontal, propped on the arms, legs not folded. */
export function isInPlankPosition(m) {
  return (
    m.bodyTiltDeg <= CFG.max_body_tilt_deg &&
    m.armsSupporting &&
    m.kneeAngle >= CFG.min_knee_in_position_deg
  );
}

export { SIDE_LM };
