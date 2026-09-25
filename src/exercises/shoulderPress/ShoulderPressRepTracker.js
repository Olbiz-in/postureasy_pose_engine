// Rep counting + per-rep form scoring for the standing dumbbell shoulder press.
//
// A rep is one full cycle: BOTTOM (dumbbells at shoulder height) → TOP (arms
// extended overhead) → BOTTOM. The rep is finalized a moment after the
// dumbbells return to the bottom so the real lowest point — which is reached
// after the elbow-angle threshold is crossed — is included in the depth check.
//
// Each finalized rep gets a 0–100 form score: 100 minus the weight of every
// error group seen in that rep (see SP_SCORE_WEIGHTS). The session form score
// is the mean of all rep scores, i.e. "form accuracy %" over N reps.

import {
  SP_CFG, SP_SCORE_WEIGHTS, SP_CUE_GROUP, SP_LIVE_PRIORITY,
} from './config';
import { isRacked, isOverhead, armsResting, elbowDrop } from './poseChecks';

const ANGLE_SMOOTH_FRAMES = 5;
const BOTTOM_SETTLE_MAX_SEC = 0.8; // max wait at the bottom before finalizing the rep
const BOTTOM_TURNAROUND_DEG = 8; // angle rise that marks the start of the next press
const ARM_LEN_RATIO_DEFAULT = 1.6; // arm length / shoulder width before it is measured
const ARM_LEN_RATIO_MIN = 1.0;
const ARM_LEN_RATIO_MAX = 2.6;
const ARM_LEN_DECAY = 0.9995;

const REP_LEVEL_PRIORITY = ['sp_too_deep', 'sp_not_low_enough', 'sp_press_higher', 'sp_rep_fast'];

export function selectPrimaryError(keys) {
  const set = new Set(keys);
  for (const k of REP_LEVEL_PRIORITY) if (set.has(k)) return k;
  for (const k of SP_LIVE_PRIORITY) if (set.has(k)) return k;
  return keys[0] || null;
}

export function scoreForErrors(keys) {
  const groups = new Set();
  for (const k of keys) {
    const g = SP_CUE_GROUP[k];
    if (g) groups.add(g);
  }
  let score = 100;
  for (const g of groups) score -= SP_SCORE_WEIGHTS[g] || 0;
  return { score: Math.max(0, score), groups: [...groups] };
}

function newCycle() {
  return {
    cueSec: new Map(), // cue key → seconds active inside this rep
    repLevel: new Set(), // rep-level errors (partial press, shallow dip)
    maxAngle: 0,
    bestRise: -Infinity, // highest (lower-wrist) rise / arm length reached at the top
    reachedTop: false,
    leftBottomAt: -1,
  };
}

export class ShoulderPressRepTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this.state = 'WAITING'; // WAITING | BOTTOM | TOP
    this.smoothAngle = 0;
    this._buf = [];
    this._armLenRatio = 0;
    this._cycle = newCycle();
    this._pending = null; // bottom-settle window after TOP → BOTTOM
    this._bottomPeak = 0; // highest angle since entering BOTTOM (partial press detection)
    this._topTrough = 180; // lowest angle since entering TOP (shallow dip detection)
    this._lastNow = -1;
    this.repResults = [];
    this.lastRep = null;
  }

  /** Personal arm length (px) scaled to the current shoulder width. */
  armLenRef(g) {
    const ratio = this._armLenRatio || ARM_LEN_RATIO_DEFAULT;
    return ratio * g.sw;
  }

  _updateArmLength(g) {
    const ratio = ((g.leftArmLen + g.rightArmLen) / 2) / g.sw;
    if (!Number.isFinite(ratio)) return;
    const clamped = Math.max(ARM_LEN_RATIO_MIN, Math.min(ARM_LEN_RATIO_MAX, ratio));
    this._armLenRatio = Math.max(clamped, (this._armLenRatio || clamped) * ARM_LEN_DECAY);
  }

  _smooth(angle) {
    this._buf.push(angle);
    if (this._buf.length > ANGLE_SMOOTH_FRAMES) this._buf.shift();
    this.smoothAngle = this._buf.reduce((a, b) => a + b, 0) / this._buf.length;
    return this.smoothAngle;
  }

  /** Wrist rise of the LOWER wrist above the shoulder line, as a fraction of arm length. */
  wristRise(g) {
    const lowerWristY = Math.max(g.lw.y, g.rw.y);
    return (g.shY - lowerWristY) / this.armLenRef(g);
  }

  /** 0..1 press progress for the UI bar (shoulder line → top target). */
  progress(g) {
    if (!g) return 0;
    const rise = this.wristRise(g);
    return Math.max(0, Math.min(1, rise / SP_CFG.top_height_ratio));
  }

  _isBottom(g, angle) {
    if (!isRacked(g)) return false;
    if (angle <= SP_CFG.bottom_angle_max) return true;
    const drop = elbowDrop(g);
    const atLine = Math.min(drop.left, drop.right) >= -SP_CFG.depth_elbow_high_ratio;
    return angle <= SP_CFG.bottom_angle_relaxed_max && atLine;
  }

  _finalize(now) {
    const p = this._pending;
    const c = this._cycle;
    this._pending = null;

    const errors = new Set(c.repLevel);
    for (const [k, sec] of c.cueSec) {
      if (sec >= SP_CFG.rep_error_min_sec) errors.add(k);
    }
    if (p.maxDrop > SP_CFG.depth_elbow_low_ratio) errors.add('sp_too_deep');
    else if (p.maxDrop < -SP_CFG.depth_elbow_high_ratio) errors.add('sp_not_low_enough');
    if (!(c.maxAngle >= SP_CFG.lockout_angle_min && c.bestRise >= SP_CFG.top_height_ratio)) {
      errors.add('sp_press_higher');
    }
    if (p.repSec > 0 && p.repSec < SP_CFG.rep_min_sec) errors.add('sp_rep_fast');
    // The two depth faults are mutually exclusive for a single rep.
    if (errors.has('sp_too_deep')) errors.delete('sp_not_low_enough');

    const keys = [...errors];
    const { score, groups } = scoreForErrors(keys);
    this.count += 1;
    const result = {
      index: this.count,
      score,
      errors: keys,
      primaryError: selectPrimaryError(keys),
      groups,
      durationSec: p.repSec > 0 ? Math.round(p.repSec * 100) / 100 : null,
      maxAngle: Math.round(c.maxAngle),
      heightPct: Math.round(Math.max(0, c.bestRise) * 100),
      maxElbowDrop: Math.round(p.maxDrop * 100) / 100,
      finishedAt: now,
    };
    this.repResults.push(result);
    this.lastRep = result;
    this._cycle = newCycle();
    this._cycle.leftBottomAt = now;
    this._bottomPeak = this.smoothAngle;
    return result;
  }

  /**
   * Advance the state machine for one frame.
   * @param g         geometry from buildGeometry (never null here)
   * @param now       seconds
   * @param cueKeys   live posture cue keys active on this frame
   * @returns {{ rep: object|null, event: string|null, liveDepthCue: string|null }}
   */
  update(g, now, cueKeys = []) {
    const dt = this._lastNow < 0 ? 0 : Math.min(0.2, Math.max(0, now - this._lastNow));
    this._lastNow = now;
    this._updateArmLength(g);
    const angle = this._smooth(g.angle);
    const drop = elbowDrop(g);
    const maxDrop = Math.max(drop.left, drop.right);

    let rep = null;
    let event = null;
    const liveDepthCue = this.state !== 'WAITING'
      && this._cycle.reachedTop
      && isRacked(g)
      && maxDrop > SP_CFG.depth_elbow_low_ratio
      ? 'sp_too_deep'
      : null;

    if (this.state !== 'WAITING') {
      for (const k of cueKeys) this._cycle.cueSec.set(k, (this._cycle.cueSec.get(k) || 0) + dt);
      if (liveDepthCue) this._cycle.cueSec.set(liveDepthCue, (this._cycle.cueSec.get(liveDepthCue) || 0) + dt);
    }

    // ── Bottom-settle window: find the true lowest point, then finalize ──
    if (this._pending) {
      const p = this._pending;
      p.maxDrop = Math.max(p.maxDrop, maxDrop);
      p.minAngle = Math.min(p.minAngle, angle);
      const turnedAround = angle > p.minAngle + BOTTOM_TURNAROUND_DEG;
      if (turnedAround || now - p.since >= BOTTOM_SETTLE_MAX_SEC || !isRacked(g)) {
        rep = this._finalize(now);
      }
    }

    switch (this.state) {
      case 'WAITING': {
        if (this._isBottom(g, angle)) {
          this.state = 'BOTTOM';
          this._cycle = newCycle();
          this._bottomPeak = angle;
        }
        break;
      }

      case 'BOTTOM': {
        if (armsResting(g) && !this._pending) {
          this.state = 'WAITING';
          break;
        }
        if (this._isBottom(g, angle)) {
          this._cycle.leftBottomAt = now;
          // Came back down after a press that never reached the top.
          if (this._bottomPeak >= SP_CFG.partial_up_angle && angle <= SP_CFG.bottom_angle_max - 5) {
            event = 'sp_press_higher';
            this._cycle.repLevel.add('sp_press_higher');
            this._bottomPeak = angle;
          }
        }
        this._bottomPeak = Math.max(this._bottomPeak, angle);

        if (angle >= SP_CFG.top_angle_min && isOverhead(g, this.armLenRef(g))) {
          if (this._pending) rep = rep || this._finalize(now);
          // A full press supersedes an earlier aborted attempt in this cycle.
          this._cycle.repLevel.delete('sp_press_higher');
          this.state = 'TOP';
          this._cycle.reachedTop = true;
          this._topTrough = angle;
        }
        break;
      }

      case 'TOP': {
        const c = this._cycle;
        // Dumbbells brought straight down to the sides — abandon this cycle.
        if (armsResting(g)) {
          this.state = 'WAITING';
          this._cycle = newCycle();
          break;
        }
        c.maxAngle = Math.max(c.maxAngle, angle);
        c.bestRise = Math.max(c.bestRise, this.wristRise(g));
        this._topTrough = Math.min(this._topTrough, angle);

        // Dipped part-way and pressed back up without reaching shoulder height.
        if (this._topTrough <= SP_CFG.partial_down_angle && angle >= SP_CFG.top_angle_min + 3) {
          event = 'sp_not_low_enough';
          c.repLevel.add('sp_not_low_enough');
          this._topTrough = angle;
        }

        if (this._isBottom(g, angle)) {
          this.state = 'BOTTOM';
          const start = c.leftBottomAt;
          this._pending = {
            since: now,
            repSec: start > 0 ? now - start : 0,
            maxDrop,
            minAngle: angle,
          };
          this._bottomPeak = angle;
        }
        break;
      }

      default:
        break;
    }

    return { rep, event, liveDepthCue };
  }

  /** Aggregate form accuracy over every finalized rep. */
  summary() {
    const n = this.repResults.length;
    if (!n) return { reps: 0, formScore: 100, goodReps: 0, lastScore: null, scores: [] };
    const scores = this.repResults.map((r) => r.score);
    const avg = scores.reduce((a, b) => a + b, 0) / n;
    return {
      reps: n,
      formScore: Math.round(avg),
      goodReps: this.repResults.filter((r) => r.errors.length === 0).length,
      lastScore: scores[n - 1],
      scores,
    };
  }
}
