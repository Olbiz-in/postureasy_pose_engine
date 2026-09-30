// Per-landmark smoothing for the lateral raise, in canvas pixel space.
//
// Low-visibility points are never fed to the filter. A point that disappears
// (e.g. hidden behind a dumbbell) keeps its last smoothed value for
// `occlusion_hold_sec`, then reads as invalid.

import { LR_CFG, LR_TRACKED_LANDMARKS } from './config';

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

class OneEuro1D {
  constructor() {
    this.x = null;
    this.dx = 0;
  }

  filter(value, dt) {
    if (this.x == null || !(dt > 0)) {
      this.x = value;
      this.dx = 0;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    const aD = alpha(LR_CFG.one_euro_d_cutoff, dt);
    this.dx = aD * rawDx + (1 - aD) * this.dx;
    const cutoff = LR_CFG.one_euro_min_cutoff + LR_CFG.one_euro_beta * Math.abs(this.dx);
    const a = alpha(cutoff, dt);
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }
}

class MovingAverage1D {
  constructor() {
    this.buf = [];
  }

  filter(value) {
    this.buf.push(value);
    const n = Math.max(1, Math.round(LR_CFG.moving_average_frames));
    while (this.buf.length > n) this.buf.shift();
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }
}

function makeAxis() {
  if (LR_CFG.smoothing === 'moving_average') return new MovingAverage1D();
  if (LR_CFG.smoothing === 'none') return { filter: (v) => v };
  return new OneEuro1D();
}

export class LandmarkSmoother {
  constructor() {
    this.reset();
  }

  reset() {
    this._mode = LR_CFG.smoothing;
    this._pts = new Map(); // index → { fx, fy, x, y, v, seenAt }
    this._lastT = -1;
  }

  /**
   * @returns {Map<number, {x:number,y:number,v:number,held:boolean}|null>}
   *          smoothed pixel points for LR_TRACKED_LANDMARKS (null = invalid)
   */
  update(landmarks, w, h, now) {
    if (this._mode !== LR_CFG.smoothing) this.reset();
    const dt = this._lastT < 0 ? 0 : Math.min(0.25, Math.max(0, now - this._lastT));
    this._lastT = now;
    const out = new Map();
    const minVis = LR_CFG.min_visibility;

    for (const i of LR_TRACKED_LANDMARKS) {
      const lm = landmarks?.[i];
      const v = lm ? (lm.visibility == null ? 1 : lm.visibility) : 0;
      let p = this._pts.get(i);

      if (lm && v >= minVis) {
        if (!p) {
          p = { fx: makeAxis(), fy: makeAxis() };
          this._pts.set(i, p);
        }
        p.x = p.fx.filter(lm.x * w, dt);
        p.y = p.fy.filter(lm.y * h, dt);
        p.v = v;
        p.seenAt = now;
        out.set(i, { x: p.x, y: p.y, v, held: false });
      } else if (p && now - p.seenAt <= LR_CFG.occlusion_hold_sec) {
        out.set(i, { x: p.x, y: p.y, v, held: true });
      } else {
        if (p) this._pts.delete(i);
        out.set(i, null);
      }
    }
    return out;
  }
}
