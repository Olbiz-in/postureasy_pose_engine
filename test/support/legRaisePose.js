// Synthetic MediaPipe landmarks for a person doing lying leg raises, filmed from
// the side (head image-left, feet image-right, left side facing the camera),
// plus a driver that feeds a LegRaiseFlow with a deterministic clock.

import { LM } from '../../src/core/landmarks.js';

export const W = 640;
export const H = 480;
export const FPS = 30;

const FLOOR_Y = 380;
const SHOULDER_X = 180;
const HIP_X = 300;
const THIGH = 75;
const SHIN = 75;

export function blankLandmarks() {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
}

function put(lms, index, px, py, vis = 0.99) {
  lms[index] = { x: px / W, y: py / H, z: 0, visibility: vis };
}

/**
 * @param {object} o
 * @param {number} o.theta        leg angle above the floor (deg)
 * @param {number} [o.kneeBend]   knee pushed off the leg line, px (bends the knee)
 * @param {number} [o.hipLift]    hip raised off the floor, px
 */
export function makePose({ theta = 0, kneeBend = 0, hipLift = 0 } = {}) {
  const lms = blankLandmarks();
  const r = (theta * Math.PI) / 180;
  const hipY = FLOOR_Y - hipLift;
  const dx = Math.cos(r);
  const dy = -Math.sin(r);
  const nx = -dy; // perpendicular to the leg
  const ny = dx;

  put(lms, LM.NOSE, SHOULDER_X - 50, FLOOR_Y - 20);
  for (const [sh, hip, knee, ankle, v] of [
    [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, 0.99],
    [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, 0.6],
  ]) {
    put(lms, sh, SHOULDER_X, FLOOR_Y, v);
    put(lms, hip, HIP_X, hipY, v);
    put(lms, knee, HIP_X + dx * THIGH + nx * kneeBend, hipY + dy * THIGH + ny * kneeBend, v);
    put(lms, ankle, HIP_X + dx * (THIGH + SHIN), hipY + dy * (THIGH + SHIN), v);
  }
  return lms;
}

/** Piecewise-linear angle profile: [[t0, deg0], [t1, deg1], …] (seconds). */
export function profile(points) {
  return (t) => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i += 1) {
      const [t1, v1] = points[i];
      const [t0, v0] = points[i - 1];
      if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
    return points[points.length - 1][1];
  };
}

/**
 * A set of `reps` leg raises: floor → peak, then lower to `valley`, lift again…
 * Each stroke takes `stroke` seconds. Ends lowered to `valley` and held `hold` s.
 */
export function repProfile({ reps, peak = 90, valley = 45, stroke = 1.5, hold = 1.2, lead = 0.5 }) {
  const pts = [[0, 0], [lead, 0]];
  let t = lead;
  t += stroke * (peak / 90);
  pts.push([t, peak]);
  for (let i = 0; i < reps; i += 1) {
    t += stroke * ((peak - valley) / 45);
    pts.push([t, valley]);
    if (i < reps - 1) {
      t += stroke * ((peak - valley) / 45);
      pts.push([t, peak]);
    }
  }
  pts.push([t + hold, valley]);
  return { fn: profile(pts), duration: t + hold };
}

export class Driver {
  constructor(flow) {
    this.flow = flow;
    this.t = 1000;
    this.last = null;
  }

  tick(pose) {
    this.t += 1 / FPS;
    this.last = this.flow.tick(pose, W, H, this.t);
    return this.last;
  }

  /** Lie flat with legs down until the setup passes (or give up after `maxSec`). */
  calibrate(maxSec = 8) {
    for (let i = 0; i < maxSec * FPS && this.flow.phase !== 'lgr_active'; i += 1) {
      this.tick(makePose({ theta: 0 }));
    }
    return this.flow.phase;
  }

  /** Play an angle profile; `extra(t, theta)` may add kneeBend / hipLift. */
  play({ fn, duration }, extra = () => ({}), onFrame = () => {}) {
    const frames = Math.ceil(duration * FPS);
    for (let i = 0; i <= frames; i += 1) {
      const t = i / FPS;
      const theta = fn(t);
      const fr = this.tick(makePose({ theta, ...extra(t, theta) }));
      onFrame(fr, t);
    }
  }
}
