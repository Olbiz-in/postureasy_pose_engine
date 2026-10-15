// Rep counting + per-rep form analysis for the lying leg raise.
//
// The rep is a peak → valley cycle of the leg angle θ (0° = legs on the floor,
// 90° = vertical):
//
//   REST  legs below `rep_enter_deg` (start of the set / after a pause)
//   UP    legs rising; the peak is the highest θ seen
//   DOWN  legs lowering after the peak turned (θ fell `turn_amp_deg` from it);
//         the valley is the lowest θ seen
//
// A rep ENDS when the valley is confirmed — the legs turn back up (θ rose
// `turn_amp_deg` from the valley; the next rep then starts immediately, because
// the legs never touch the floor between reps) or hold still (`settle_sec`).
// It counts when the peak reached `count_min_deg`. Peak / valley / knee / hip
// readings then become the rep's issues and score.

import { LGR_CFG, LGR_ISSUE_PRIORITY, LGR_ISSUE_GROUP, LGR_SCORE_WEIGHTS } from './config.js';
import { scoreIssues } from '../../core/repScoring.js';
import { clamp01, round2, firstByPriority } from '../common/math.js';

export const LGR_STATE = {
  REST: 'rest',
  UP: 'up',
  DOWN: 'down',
};

export class LegRaiseRepTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this.attempts = [];
    this.lastRep = null;
    this.rearm();
  }

  /** Forget any cycle in progress; the legs must be below the start zone before the next rep. */
  rearm() {
    this.state = LGR_STATE.REST;
    this._armed = false;
    this._cycle = null;
    this._lastNow = -1;
    this._lostSince = -1;
    this._prevValleyAt = -1;
    this.theta = null;
  }

  get inProgress() {
    return this.state !== LGR_STATE.REST;
  }

  get peakDeg() {
    return this._cycle ? this._cycle.peak : null;
  }

  _begin(now, theta, startAt, fromRest = false) {
    this.state = LGR_STATE.UP;
    this._cycle = {
      startAt,
      // A set's first rep is timed from the start zone, not from the bottom of
      // the previous rep, so its duration is not comparable for tempo.
      fromRest,
      peak: theta,
      peakAt: now,
      valley: Infinity,
      valleyAt: now,
      bentSec: 0,
      hipSec: 0,
      maxTiltDelta: 0,
      minKnee: 180,
    };
  }

  /** Drop the cycle in progress (turned away / sat up / out of frame). */
  abort(now, reason = 'aborted') {
    const c = this._cycle;
    const had = this.inProgress && c;
    this.state = LGR_STATE.REST;
    this._armed = false;
    this._cycle = null;
    this._lostSince = -1;
    if (!had) return null;
    return { counted: false, incompleteReason: reason, peakDeg: Math.round(c.peak), finishedAt: now };
  }

  /**
   * Advance one frame.
   * @param {{theta:number, kneeAngle:number, tiltDelta:number}|null} m
   * @returns {{ started: boolean, counted: object|null, incomplete: object|null, liveKeys: string[] }}
   */
  step(m, now) {
    const out = { started: false, counted: null, incomplete: null, liveKeys: [] };
    const dt = this._lastNow < 0 ? 0 : Math.min(0.2, Math.max(0, now - this._lastNow));
    this._lastNow = now;
    const C = LGR_CFG;

    if (!m) {
      this.theta = null;
      if (this.inProgress) {
        if (this._lostSince < 0) this._lostSince = now;
        if (now - this._lostSince >= C.person_lost_sec) out.incomplete = this.abort(now, 'lost');
      }
      return out;
    }
    this._lostSince = -1;
    const th = m.theta;
    this.theta = th;

    if (this.state === LGR_STATE.REST) {
      if (!this._armed) {
        if (th < C.rep_enter_deg - 5) this._armed = true;
        return out;
      }
      if (th >= C.rep_enter_deg) {
        this._begin(now, th, now, true);
        out.started = true;
      }
      if (this.state === LGR_STATE.REST) return out;
    }

    const c = this._cycle;
    if (now - c.startAt > C.max_rep_sec) {
      out.incomplete = this.abort(now, 'timeout');
      return out;
    }

    // Faults that can be seen while the rep is under way.
    if (m.kneeAngle < C.knee_min_deg) {
      c.bentSec += dt;
      out.liveKeys.push('lgr_knees_bent');
    }
    c.minKnee = Math.min(c.minKnee, m.kneeAngle);
    if (Math.abs(m.tiltDelta) > C.hip_lift_deg) {
      c.hipSec += dt;
      out.liveKeys.push('lgr_hips_lifting');
    }
    c.maxTiltDelta = Math.max(c.maxTiltDelta, Math.abs(m.tiltDelta));

    if (this.state === LGR_STATE.UP) {
      if (th > c.peak) {
        c.peak = th;
        c.peakAt = now;
      }
      if (th <= c.peak - C.turn_amp_deg) {
        this.state = LGR_STATE.DOWN;
        c.valley = th;
        c.valleyAt = now;
        this._anchor = th;
        this._anchorAt = now;
      }
      return out;
    }

    // DOWN
    if (th < c.valley) {
      // The timestamp only moves on a real new low, so a slow settle toward the
      // bottom (smoothing tail) does not stretch the rep's duration.
      if (th < c.valley - 1) c.valleyAt = now;
      c.valley = th;
    }
    if (c.peak >= C.count_min_deg) {
      if (c.peak < C.top_min_deg) out.liveKeys.push('lgr_not_high_enough');
      if (th < C.too_low_deg) out.liveKeys.push('lgr_too_low');
    }

    if (Math.abs(th - this._anchor) > C.settle_band_deg) {
      this._anchor = th;
      this._anchorAt = now;
    }

    if (th >= c.valley + C.turn_amp_deg) {
      // Legs are heading back up: this rep is done and the next one begins now.
      this._finish(c, now, out);
      this._begin(now, th, c.valleyAt);
      out.started = true;
    } else if (now - this._anchorAt >= C.settle_sec) {
      // Legs held still while lowering: the rep is over, wait for the next lift.
      this._finish(c, now, out);
      this.state = LGR_STATE.REST;
      this._armed = true;
      this._cycle = null;
    }
    return out;
  }

  _finish(c, now, out) {
    this._prevValleyAt = c.valleyAt;
    const C = LGR_CFG;
    const durationSec = round2(Math.max(0, c.valleyAt - c.startAt));
    if (durationSec < C.min_rep_sec) return; // jitter, not an attempt

    if (c.peak < C.count_min_deg) {
      out.incomplete = {
        counted: false,
        incompleteReason: 'too_low_peak',
        peakDeg: Math.round(c.peak),
        valleyDeg: Math.round(c.valley),
        durationSec,
        finishedAt: now,
      };
      return;
    }

    const issues = new Set();
    if (c.peak < C.top_min_deg) issues.add('lgr_not_high_enough');
    if (c.valley > C.bottom_max_deg) issues.add('lgr_not_lowering');
    if (c.valley < C.too_low_deg) issues.add('lgr_too_low');
    if (c.bentSec >= C.fault_min_sec) issues.add('lgr_knees_bent');
    if (c.hipSec >= C.fault_min_sec) issues.add('lgr_hips_lifting');
    if (!c.fromRest && durationSec < C.min_tempo_sec) issues.add('lgr_too_fast');
    const keys = LGR_ISSUE_PRIORITY.filter((k) => issues.has(k));

    const { score, groups } = scoreIssues(keys, (k) => LGR_ISSUE_GROUP[k], LGR_SCORE_WEIGHTS);
    const span = C.top_target_deg - C.bottom_target_deg;
    const romPct = Math.round(100 * clamp01((c.peak - c.valley) / span));

    this.count += 1;
    const attempt = {
      attempt: this.attempts.length + 1,
      index: this.count,
      counted: true,
      peakDeg: Math.round(c.peak),
      valleyDeg: Math.round(c.valley),
      romPct,
      durationSec,
      minKnee: Math.round(c.minKnee),
      hipShiftDeg: round2(c.maxTiltDelta),
      issues: keys,
      primaryIssue: firstByPriority(keys, LGR_ISSUE_PRIORITY),
      groups,
      score,
      clean: keys.length === 0,
      finishedAt: now,
    };
    this.attempts.push(attempt);
    this.lastRep = attempt;
    out.counted = attempt;
  }
}
