// Per-landmark smoothing in canvas pixel space, shared by the front-view
// dumbbell exercises.
//
// Low-visibility points are never fed to the filter. A point that disappears
// (e.g. hidden behind a dumbbell) keeps its last smoothed value for
// `cfg.occlusion_hold_sec`, then reads as invalid.
//
// `cfg` is the exercise's live config object and is read on every frame, so
// tolerance sliders take effect immediately. Fields used: min_visibility,
// smoothing, one_euro_min_cutoff, one_euro_beta, one_euro_d_cutoff,
// moving_average_frames, occlusion_hold_sec.

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

class OneEuro1D {
  constructor(cfg) {
    this.cfg = cfg;
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
    const aD = alpha(this.cfg.one_euro_d_cutoff, dt);
    this.dx = aD * rawDx + (1 - aD) * this.dx;
    const cutoff = this.cfg.one_euro_min_cutoff + this.cfg.one_euro_beta * Math.abs(this.dx);
    const a = alpha(cutoff, dt);
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }
}

class MovingAverage1D {
  constructor(cfg) {
    this.cfg = cfg;
    this.buf = [];
  }

  filter(value) {
    this.buf.push(value);
    const n = Math.max(1, Math.round(this.cfg.moving_average_frames));
    while (this.buf.length > n) this.buf.shift();
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }
}

function makeAxis(cfg) {
  if (cfg.smoothing === 'moving_average') return new MovingAverage1D(cfg);
  if (cfg.smoothing === 'none') return { filter: (v) => v };
  return new OneEuro1D(cfg);
}

export class LandmarkSmoother {
  /**
   * @param {object} cfg              live exercise config (see header)
   * @param {number[]} trackedLandmarks landmark indices to smooth
   */
  constructor(cfg, trackedLandmarks) {
    this._cfg = cfg;
    this._tracked = trackedLandmarks;
    this.reset();
  }

  reset() {
    this._mode = this._cfg.smoothing;
    this._pts = new Map(); // index → { fx, fy, x, y, v, seenAt }
    this._lastT = -1;
  }

  /**
   * @returns {Map<number, {x:number,y:number,v:number,held:boolean}|null>}
   *          smoothed pixel points for the tracked landmarks (null = invalid)
   */
  update(landmarks, w, h, now) {
    const cfg = this._cfg;
    if (this._mode !== cfg.smoothing) this.reset();
    const dt = this._lastT < 0 ? 0 : Math.min(0.25, Math.max(0, now - this._lastT));
    this._lastT = now;
    const out = new Map();
    const minVis = cfg.min_visibility;

    for (const i of this._tracked) {
      const lm = landmarks?.[i];
      const v = lm ? (lm.visibility == null ? 1 : lm.visibility) : 0;
      let p = this._pts.get(i);

      if (lm && v >= minVis) {
        if (!p) {
          p = { fx: makeAxis(cfg), fy: makeAxis(cfg) };
          this._pts.set(i, p);
        }
        p.x = p.fx.filter(lm.x * w, dt);
        p.y = p.fy.filter(lm.y * h, dt);
        p.v = v;
        p.seenAt = now;
        out.set(i, { x: p.x, y: p.y, v, held: false });
      } else if (p && now - p.seenAt <= cfg.occlusion_hold_sec) {
        out.set(i, { x: p.x, y: p.y, v, held: true });
      } else {
        if (p) this._pts.delete(i);
        out.set(i, null);
      }
    }
    return out;
  }
}
