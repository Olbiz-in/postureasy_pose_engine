// Rep counting + per-rep form scoring for the dumbbell lateral raise.
//
// Each arm runs its own line-based cycle (no angles):
//   WAIT_DOWN → arm must first be in the start zone (after start / abort)
//   DOWN      → resting; leaves when the elbow lift reaches `lift_start`
//   UP        → rising / at the top; TOP is reached ("half rep") when the elbow
//               comes within `top_tolerance` of the shoulder line; the cycle
//               ends once elbow AND wrist drop back under `lift_return`
//
// The two arm cycles are paired into one attempt. An attempt is a counted rep
// only when BOTH arms reached the top and finished within `pair_window_sec`
// of each other; otherwise it is recorded as incomplete / not high enough.
// Every attempt gets a list of issues and a weighted 0–100 score.

import { LR_CFG, LR_SCORE_WEIGHTS, LR_ISSUE_PRIORITY } from './config';
import { armLift } from './poseChecks';

const SIDES = ['left', 'right'];

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** 0 at or below `from`, 1 at or above `to`. */
function ramp(v, from, to) {
  if (!(to > from)) return v > from ? 1 : 0;
  return clamp01((v - from) / (to - from));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function newArm() {
  return { state: 'WAIT_DOWN', cycle: null, missingSince: -1 };
}

function newCycle(side, now) {
  return {
    side,
    startAt: now,
    endAt: -1,
    topAt: -1,
    reachedTop: false,
    peakLift: 0,
    minElbowDy: Infinity,
    minWristDy: Infinity,
    wristAboveSec: 0,
    elbowAboveSec: 0,
    lost: false,
    partial: false,
    consumed: false,
  };
}

export function selectPrimaryIssue(keys) {
  const set = new Set(keys);
  for (const k of LR_ISSUE_PRIORITY) if (set.has(k)) return k;
  return keys[0] || null;
}

export class LateralRaiseRepTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this.attempts = [];
    this.lastAttempt = null;
    this.setIndex = 1;
    this.setCount = 0;
    this._arms = { left: newArm(), right: newArm() };
    this._pending = null;
    this._window = null;
    this._lastNow = -1;
    this.live = { left: null, right: null, liveKeys: [] };
  }

  /** Start a new set: per-set rep counter restarts, arms must be down first. */
  startSet(index) {
    this.setIndex = index;
    this.setCount = 0;
    this.abortInProgress();
  }

  /** Any arm mid-cycle, or a finished arm waiting for its partner. */
  get inProgress() {
    if (this._pending) return true;
    return SIDES.some((s) => this._arms[s].state === 'UP' && !this._arms[s].cycle?.consumed);
  }

  armState(side) {
    return this._arms[side].state;
  }

  /** Drop the current cycle without scoring (turned away / out of frame). */
  abortInProgress() {
    for (const s of SIDES) this._arms[s] = newArm();
    this._pending = null;
    this._window = null;
  }

  _openWindow(g, now) {
    if (this._window) return;
    this._window = { startAt: now, x0: g.shMid.x, maxTilt: 0, maxSway: 0 };
  }

  _updateWindow(g, calib) {
    const w = this._window;
    if (!w) return;
    const tilt = Math.abs(g.tilt - (calib?.tilt0 ?? 0));
    const sway = Math.abs(g.shMid.x - w.x0) / g.norm;
    w.maxTilt = Math.max(w.maxTilt, tilt);
    w.maxSway = Math.max(w.maxSway, sway);
  }

  _stepArm(side, a, g, calib, now, dt) {
    const arm = this._arms[side];
    const res = { done: null, top: false, liveKeys: [] };

    if (!a.ok) {
      if (arm.state === 'UP' && arm.cycle) {
        if (arm.missingSince < 0) arm.missingSince = now;
        if (now - arm.missingSince >= LR_CFG.arm_missing_abort_sec) {
          const c = arm.cycle;
          c.lost = true;
          c.endAt = now;
          this._arms[side] = newArm();
          res.done = c;
        }
      }
      return res;
    }
    arm.missingSince = -1;
    const lift = armLift(a, calib);
    const inStartZone = lift.elbow <= LR_CFG.lift_return && lift.wrist <= LR_CFG.lift_return;

    if (arm.state === 'WAIT_DOWN') {
      if (inStartZone) arm.state = 'DOWN';
      return res;
    }

    if (arm.state === 'DOWN') {
      if (lift.elbow < LR_CFG.lift_start) return res;
      arm.state = 'UP';
      arm.cycle = newCycle(side, now);
      this._openWindow(g, now);
    }

    const c = arm.cycle;
    if (!c.reachedTop && now - c.startAt > LR_CFG.max_cycle_sec) {
      this._arms[side] = newArm();
      return res;
    }
    c.peakLift = Math.max(c.peakLift, lift.elbow);
    c.minElbowDy = Math.min(c.minElbowDy, a.elbowDy);
    c.minWristDy = Math.min(c.minWristDy, a.wristDy);
    if (!c.reachedTop && a.elbowDy <= LR_CFG.top_tolerance) {
      c.reachedTop = true;
      c.topAt = now;
      res.top = true;
    }
    if (-a.wristDy > LR_CFG.wrist_above_tolerance) {
      c.wristAboveSec += dt;
      res.liveKeys.push('lr_wrist_above');
    }
    if (-a.elbowDy > LR_CFG.elbow_above_tolerance) {
      c.elbowAboveSec += dt;
      res.liveKeys.push('lr_elbow_too_high');
    }

    if (inStartZone) {
      c.endAt = now;
      arm.state = 'DOWN';
      arm.cycle = null;
      res.done = c;
    }
    return res;
  }

  _onCycleDone(c, now) {
    if (c.consumed) return;
    if (!this._pending) this._pending = { left: null, right: null, firstAt: now };
    this._pending[c.side] = c;
  }

  /**
   * Advance one frame.
   * @returns {{ attempt: object|null, topSides: string[], liveKeys: string[] }}
   */
  update(g, calib, now) {
    const dt = this._lastNow < 0 ? 0 : Math.min(0.2, Math.max(0, now - this._lastNow));
    this._lastNow = now;

    const topSides = [];
    const liveKeys = new Set();
    for (const side of SIDES) {
      const r = this._stepArm(side, g[side], g, calib, now, dt);
      if (r.top) topSides.push(side);
      r.liveKeys.forEach((k) => liveKeys.add(k));
      if (r.done) this._onCycleDone(r.done, now);
    }
    this._updateWindow(g, calib);

    let attempt = null;
    const p = this._pending;
    if (p && p.left && p.right) {
      attempt = this._resolve(calib, now);
    } else if (p && now - p.firstAt > LR_CFG.pair_window_sec) {
      const other = p.left ? 'right' : 'left';
      const otherArm = this._arms[other];
      if (otherArm.state === 'UP' && otherArm.cycle && !otherArm.cycle.consumed) {
        otherArm.cycle.consumed = true;
        p[other] = { ...otherArm.cycle, partial: true };
      }
      attempt = this._resolve(calib, now);
    }
    if (this._window && !this.inProgress) this._window = null;

    this.live = {
      left: this._arms.left.state,
      right: this._arms.right.state,
      liveKeys: [...liveKeys],
    };
    return { attempt, topSides, liveKeys: [...liveKeys] };
  }

  _armResult(c, calib) {
    if (!c) return null;
    const restE = calib?.restElbow?.[c.side] ?? LR_CFG.rest_elbow_default;
    const tol = LR_CFG.top_tolerance;
    const reach = c.minElbowDy <= tol ? 1 : clamp01((restE - c.minElbowDy) / Math.max(restE - tol, 0.1));
    const maxElbowAbove = Math.max(0, -c.minElbowDy);
    const maxWristAbove = Math.max(0, -c.minWristDy);
    const overshoot = ramp(maxElbowAbove, LR_CFG.elbow_above_tolerance, LR_CFG.elbow_above_zero_at);
    return {
      side: c.side,
      reachedTop: c.reachedTop && !c.lost,
      complete: !c.partial && !c.lost,
      lost: c.lost,
      peakElbowDy: round2(c.minElbowDy),
      peakWristDy: round2(c.minWristDy),
      maxElbowAbove,
      maxWristAbove,
      romPct: reach * 100,
      romScore: Math.max(0, reach * 100 - 50 * overshoot),
      wristAbove: c.wristAboveSec >= LR_CFG.flag_min_sec,
      elbowTooHigh: c.elbowAboveSec >= LR_CFG.flag_min_sec,
      topAt: c.topAt,
      endAt: c.endAt,
    };
  }

  _resolve(calib, now) {
    const p = this._pending;
    const win = this._window;
    this._pending = null;
    this._window = null;

    const strong = [p.left, p.right].some(
      (c) => c && (c.reachedTop || c.peakLift >= LR_CFG.attempt_min_lift),
    );
    if (!strong) return null;

    const L = this._armResult(p.left, calib);
    const R = this._armResult(p.right, calib);
    const arms = [L, R].filter(Boolean);
    const counted = !!(L && R && L.complete && R.complete && L.reachedTop && R.reachedTop);

    const issues = new Set();
    if (!counted) {
      const anyTop = arms.some((a) => a.reachedTop);
      issues.add(anyTop || arms.length < 2 || arms.some((a) => a.lost) ? 'lr_incomplete' : 'lr_not_high_enough');
    }
    if (arms.some((a) => !a.reachedTop)) issues.add('lr_not_high_enough');
    if (arms.some((a) => a.wristAbove)) issues.add('lr_wrist_above');
    if (arms.some((a) => a.elbowTooHigh)) issues.add('lr_elbow_too_high');

    const symDiff = L && R ? Math.abs(p.left.minElbowDy - p.right.minElbowDy) : null;
    if (symDiff != null && symDiff > LR_CFG.symmetry_max) issues.add('lr_asymmetry');
    const tilt = win?.maxTilt ?? 0;
    const sway = win?.maxSway ?? 0;
    if (tilt > LR_CFG.shoulder_tilt_max) issues.add('lr_shoulder_tilt');
    if (sway > LR_CFG.body_sway_max) issues.add('lr_body_sway');

    // ── Component scores (0–100) ────────────────────────────────────────────
    const romPct = ((L?.romPct ?? 0) + (R?.romPct ?? 0)) / 2;
    const romScore = ((L?.romScore ?? 0) + (R?.romScore ?? 0)) / 2;
    const maxWristAbove = Math.max(0, ...arms.map((a) => a.maxWristAbove));
    const wristScore = 100 * (1 - ramp(maxWristAbove, LR_CFG.wrist_above_tolerance, LR_CFG.wrist_above_zero_at));
    const symmetryPct = symDiff == null ? 0 : 100 * (1 - ramp(symDiff, 0, LR_CFG.symmetry_zero_at));
    const tiltScore = 1 - ramp(tilt, LR_CFG.shoulder_tilt_max, LR_CFG.shoulder_tilt_zero_at);
    const swayScore = 1 - ramp(sway, LR_CFG.body_sway_max, LR_CFG.body_sway_zero_at);
    const stabilityPct = 100 * (tiltScore + swayScore) / 2;

    const W = LR_SCORE_WEIGHTS;
    const wSum = (W.rom || 0) + (W.wrist || 0) + (W.symmetry || 0) + (W.stability || 0) || 1;
    const score = Math.round(
      ((W.rom || 0) * romScore
        + (W.wrist || 0) * wristScore
        + (W.symmetry || 0) * symmetryPct
        + (W.stability || 0) * stabilityPct) / wSum,
    );

    const keys = LR_ISSUE_PRIORITY.filter((k) => issues.has(k));
    const clean = counted
      && score >= LR_CFG.clean_score_min
      && !issues.has('lr_wrist_above')
      && !issues.has('lr_incomplete');

    if (counted) {
      this.count += 1;
      this.setCount += 1;
    }
    const startAt = win?.startAt ?? Math.min(...[p.left, p.right].filter(Boolean).map((c) => c.startAt));
    const result = {
      attempt: this.attempts.length + 1,
      index: counted ? this.count : null,
      set: this.setIndex,
      repInSet: counted ? this.setCount : null,
      counted,
      clean,
      score,
      components: {
        rom: Math.round(romScore),
        wrist: Math.round(wristScore),
        symmetry: Math.round(symmetryPct),
        stability: Math.round(stabilityPct),
      },
      romPct: Math.round(romPct),
      symmetryPct: Math.round(symmetryPct),
      stabilityPct: Math.round(stabilityPct),
      issues: keys,
      primaryIssue: selectPrimaryIssue(keys),
      shoulderTilt: Math.round(tilt * 100) / 100,
      bodySway: Math.round(sway * 100) / 100,
      symmetryDiff: symDiff == null ? null : Math.round(symDiff * 100) / 100,
      left: L,
      right: R,
      durationSec: Math.round(Math.max(0, now - startAt) * 100) / 100,
      finishedAt: now,
    };
    this.attempts.push(result);
    this.lastAttempt = result;
    return result;
  }
}

function avg(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Cumulative session metrics over every attempt (all sets). Pure — safe to
 * call at any time, including after an early Stop.
 */
export function summarizeLateralRaise(attempts, {
  activeSec = 0,
  sessionSec = 0,
  setsCompleted = 0,
  targetSets = 0,
  targetReps = 0,
  stoppedEarly = false,
} = {}) {
  const list = attempts || [];
  const n = list.length;
  const counted = list.filter((a) => a.counted);
  const clean = list.filter((a) => a.clean);
  const has = (k) => list.filter((a) => a.issues.includes(k)).length;

  let best = null;
  let worst = null;
  for (const a of list) {
    if (!best || a.romPct > best.romPct) best = a;
    if (!worst || a.romPct < worst.romPct) worst = a;
  }
  const r = (v) => (v == null ? null : Math.round(v));
  const formScore = r(avg(list.map((a) => a.score)));
  const accuracy = n ? Math.round((clean.length / n) * 100) : null;
  const rom = r(avg(list.map((a) => a.romPct)));

  return {
    attempts: n,
    repsCompleted: counted.length,
    cleanReps: clean.length,
    setsCompleted,
    targetSets,
    targetReps,
    stoppedEarly,
    formScore,
    accuracy,
    romPct: rom,
    romBest: best ? { attempt: best.attempt, rep: best.index, romPct: best.romPct } : null,
    romWorst: worst ? { attempt: worst.attempt, rep: worst.index, romPct: worst.romPct } : null,
    symmetryPct: r(avg(list.map((a) => a.symmetryPct))),
    stabilityPct: r(avg(list.map((a) => a.stabilityPct))),
    activeSec: Math.round(activeSec),
    sessionSec: Math.round(sessionSec),
    avgRepSec: counted.length ? Math.round(avg(counted.map((a) => a.durationSec)) * 10) / 10 : null,
    mistakes: {
      wristAboveShoulder: has('lr_wrist_above'),
      elbowTooHigh: has('lr_elbow_too_high'),
      notHighEnough: has('lr_not_high_enough'),
      incomplete: has('lr_incomplete'),
      asymmetry: has('lr_asymmetry'),
      shoulderTilt: has('lr_shoulder_tilt'),
      bodySway: has('lr_body_sway'),
    },
    perRep: list.map((a) => ({
      attempt: a.attempt,
      rep: a.index,
      set: a.set,
      counted: a.counted,
      clean: a.clean,
      score: a.score,
      romPct: a.romPct,
      issues: a.issues,
    })),
    summaryLine: n
      ? `Form Score ${formScore}/100, Accuracy ${accuracy}%, Range of Motion ${rom}%`
      : 'No reps recorded',
  };
}
