// Synthetic MediaPipe landmarks for a person doing lunges, plus helpers that
// drive a LungeFlow with a deterministic clock. Pixel model on a 640×480 frame
// (torso 120 px, standing hip→ankle height 210 px).

import { LM } from '../../src/core/landmarks.js';

export const W = 640;
export const H = 480;
export const FPS = 30;

const CX = 320;
const SHOULDER_HALF = 45;
const HIP_HALF = 28;
const TORSO = 120;
const ANKLE_Y = 440;
const STAND_H = 210;
const SHIN = STAND_H / 2;

export function blankLandmarks() {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
}

function put(lms, index, px, py, vis = 0.99) {
  lms[index] = { x: px / W, y: py / H, z: 0, visibility: vis };
}

/**
 * @param {object} o
 * @param {'front'|'side'} o.view
 * @param {number} o.depth            0 standing … ~0.4 full lunge
 * @param {'left'|'right'} [o.lead]   leading leg while lunging (front/side cue)
 * @param {{left?:number,right?:number}} [o.valgus]  inward knee offset / torso (front)
 * @param {number} [o.hipShift]       hip drift / torso (front, + = image right)
 * @param {number} [o.trunkSway]      shoulder-over-hip offset / torso (front)
 * @param {number} [o.pelvisTilt]     (left hip y − right hip y) / torso (front)
 * @param {number} [o.leanPx]         shoulders ahead of hips in px (side, − = leaning back)
 * @param {number} [o.shinPx]         front knee ahead of the front ankle at full depth, px (side)
 * @param {Object<number,number>} [o.vis]  per-landmark visibility overrides
 */
export function makePose({
  view = 'front', depth = 0, lead = 'left', valgus = {}, hipShift = 0, trunkSway = 0,
  pelvisTilt = 0, leanPx = 0, shinPx = 10, vis = {},
} = {}) {
  const lms = blankLandmarks();
  const lunging = depth > 0.03;
  const hipY = ANKLE_Y - STAND_H * (1 - depth);
  const shY = hipY - TORSO;

  if (view === 'front') {
    const hx = CX + hipShift * TORSO;
    const sx = hx + trunkSway * TORSO;
    const tilt = pelvisTilt * TORSO;
    const ankleY = {
      left: ANKLE_Y + (lunging ? (lead === 'left' ? 12 : -8) : 0),
      right: ANKLE_Y + (lunging ? (lead === 'right' ? 12 : -8) : 0),
    };
    put(lms, LM.NOSE, sx, shY - 40);
    put(lms, LM.LEFT_SHOULDER, sx + SHOULDER_HALF, shY);
    put(lms, LM.RIGHT_SHOULDER, sx - SHOULDER_HALF, shY);
    for (const [side, sign, hipLm, kneeLm, ankleLm, heelLm, toeLm] of [
      ['left', 1, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX],
      ['right', -1, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX],
    ]) {
      const hipPx = hx + sign * HIP_HALF;
      const hy = hipY + (side === 'left' ? tilt / 2 : -tilt / 2);
      const anklePx = CX + sign * 30;
      const ay = ankleY[side];
      const t = 0.5;
      const lineX = hipPx + t * (anklePx - hipPx);
      // Inward = toward the midline = −sign.
      const kneeX = lineX - sign * (valgus[side] ?? 0) * TORSO;
      put(lms, hipLm, hipPx, hy);
      put(lms, kneeLm, kneeX, hy + t * (ay - hy));
      put(lms, ankleLm, anklePx, ay);
      put(lms, heelLm, anklePx, ay + 6);
      put(lms, toeLm, anklePx, ay + 10);
    }
  } else {
    // Side view, facing image-right. Left side faces the camera.
    const hx = CX;
    const sx = hx + leanPx;
    const sep = lunging ? 60 : 0;
    const ankleX = {
      left: CX + (lead === 'left' ? sep : -sep),
      right: CX + (lead === 'right' ? sep : -sep),
    };
    put(lms, LM.NOSE, sx + 18, shY - 40);
    put(lms, LM.LEFT_SHOULDER, sx + 4, shY);
    put(lms, LM.RIGHT_SHOULDER, sx - 4, shY, 0.7);
    for (const [side, hipLm, kneeLm, ankleLm, heelLm, toeLm, v] of [
      ['left', LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX, 0.99],
      ['right', LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX, 0.7],
    ]) {
      const front = lunging && side === lead;
      const ax = ankleX[side];
      // Front knee stays (about) above its ankle at shin height; rear knee drops toward the floor.
      const kneeX = front ? ax + shinPx * depth / 0.35 : (hx + ax) / 2 - 10 * depth / 0.35;
      const kneeY = front ? ANKLE_Y - SHIN : (hipY + ANKLE_Y) / 2 + 30 * depth / 0.35;
      put(lms, hipLm, hx + (side === 'left' ? 2 : -2), hipY, v);
      put(lms, kneeLm, kneeX, kneeY, v);
      put(lms, ankleLm, ax, ANKLE_Y, v);
      put(lms, heelLm, ax - 10, ANKLE_Y + 6, v);
      put(lms, toeLm, ax + 30, ANKLE_Y + 10, v);
    }
  }

  for (const [i, v] of Object.entries(vis)) lms[Number(i)].visibility = v;
  return lms;
}

/** Smooth 0 → peak → 0 profile over `dur` seconds. */
export function depthAt(t, dur, peak) {
  if (t <= 0 || t >= dur) return 0;
  return peak * (1 - Math.cos((2 * Math.PI * t) / dur)) / 2;
}

/** Deterministic pseudo-random in [-1, 1) — no flaky tests. */
export function noise(i) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Drives a flow with a fake clock. */
export class Driver {
  constructor(flow, view) {
    this.flow = flow;
    this.view = view;
    this.t = 100; // seconds
    this.frames = [];
  }

  tick(landmarks) {
    const fr = this.flow.tick(landmarks, W, H, this.t);
    this.frames.push(fr);
    this.t += 1 / FPS;
    return fr;
  }

  /** Hold `sec` seconds with a constant pose. */
  hold(sec, poseOpts = {}) {
    let fr;
    for (let i = 0; i < Math.round(sec * FPS); i += 1) fr = this.tick(makePose({ view: this.view, ...poseOpts }));
    return fr;
  }

  /** Stand until the flow is counting (calibration + ready). */
  calibrate() {
    this.hold(1.6);
    this.hold(1.4);
    return this.flow.phase;
  }

  /**
   * One lunge: depth follows depthAt(); `opts(depth, tNorm)` may return extra
   * pose options per frame (mistakes, visibility drops, noise…).
   */
  rep({ peak = 0.36, dur = 2.4, lead = 'left', pose = () => ({}) } = {}) {
    const n = Math.round(dur * FPS);
    const out = [];
    for (let i = 0; i <= n; i += 1) {
      const t = i / FPS;
      const depth = depthAt(t, dur, peak);
      const extra = pose(depth, t / dur) || {};
      out.push(this.tick(makePose({ view: this.view, depth, lead, ...extra })));
    }
    // Settle upright between reps.
    this.hold(0.6);
    return out;
  }

  get last() {
    return this.frames[this.frames.length - 1];
  }
}
