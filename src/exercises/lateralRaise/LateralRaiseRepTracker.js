// Rep counting + per-rep form scoring for the dumbbell lateral raise.
//
// Each arm runs its own line-based cycle (no angles):
//   WAIT_DOWN → arm must first be in the start zone (after start / abort)
//   DOWN      → resting; leaves when the elbow lift reaches `lift_start`
//   UP        → rising / at the top; TOP is reached when the elbow AND the
//               wrist have both crossed the LOWER line (`top_tolerance` below
//               the shoulder line); the cycle ends once elbow AND wrist drop
//               back under `lift_return`
//
// The two arm cycles are paired into one attempt, and every attempt is a
// counted rep — partial range of motion included. A rep is "clean" only when
// both elbows AND both wrists land inside the band: past the LOWER line (else
// it is a half rep), never above the UPPER line (`elbow_above_tolerance`;
// above it = overshoot, an injury risk). Every attempt gets a weighted 0–100 score.

import { LR_CFG, LR_SCORE_WEIGHTS, LR_ISSUE_PRIORITY } from './config';
import { armLift, armLevelDiff } from './poseChecks';
import { clamp01, ramp, round2, avg, firstByPriority } from '../common/math';

const SIDES = ['left', 'right'];

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
    elbowTop: false,
    wristTop: false,
    peakLift: 0,
    minElbowDy: Infinity,
    minWristDy: Infinity,
    elbowAboveSec: 0,
    wristAboveSec: 0,
    lost: false,
    partial: false,
    consumed: false,
  };
}

export function selectPrimaryIssue(keys) {
  return firstByPriority(keys, LR_ISSUE_PRIORITY);
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
    this._window = {
      startAt: now,
      maxTilt: 0,
      maxLevelRatio: 0,
      unevenSec: 0,
      soloSince: -1, // one arm moving while the other is still down
      maxSoloSec: 0,
    };
  }

  /** @returns {string[]} live symmetry keys for this frame */
  _updateWindow(g, calib, now, dt) {
    const w = this._window;
    if (!w) return [];
    const keys = [];
    const tilt = Math.abs(g.tilt - (calib?.tilt0 ?? 0));
    w.maxTilt = Math.max(w.maxTilt, tilt);

    // Timing: exactly one arm in its UP cycle = that side started / finished alone.
    const up = SIDES.filter((s) => this._arms[s].state === 'UP');
    const solo = up.length === 1;
    if (solo) {
      if (w.soloSince < 0) w.soloSince = now;
      const soloSec = now - w.soloSince;
      w.maxSoloSec = Math.max(w.maxSoloSec, soloSec);
      if (soloSec > LR_CFG.sync_max_sec) keys.push('lr_arms_out_of_sync');
    } else {
      w.soloSince = -1;
    }

    // Height evenness while both arms move: elbows level with each other,
    // wrists level with each other. (A late arm is reported as timing above.)
    const { ratio } = armLevelDiff(g);
    if (ratio != null && !solo) {
      w.maxLevelRatio = Math.max(w.maxLevelRatio, ratio);
      if (ratio > 1) {
        w.unevenSec += dt;
        keys.push('lr_asymmetry');
      }
    }
    return keys;
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
    if (a.elbowDy <= LR_CFG.top_tolerance) c.elbowTop = true;
    if (a.wristDy <= LR_CFG.top_tolerance) c.wristTop = true;
    if (!c.reachedTop && c.elbowTop && c.wristTop) {
      c.reachedTop = true;
      c.topAt = now;
      res.top = true;
    }
    if (-a.elbowDy > LR_CFG.elbow_above_tolerance) {
      c.elbowAboveSec += dt;
      res.liveKeys.push('lr_elbow_too_high');
    }
    if (-a.wristDy > LR_CFG.elbow_above_tolerance) {
      c.wristAboveSec += dt;
      res.liveKeys.push('lr_wrist_too_high');
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
    this._updateWindow(g, calib, now, dt).forEach((k) => liveKeys.add(k));

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
    const restW = calib?.restWrist?.[c.side] ?? LR_CFG.rest_wrist_default;
    const tol = LR_CFG.top_tolerance;
    const reachOf = (minDy, rest) => (minDy <= tol ? 1 : clamp01((rest - minDy) / Math.max(rest - tol, 0.1)));
    // The rep is only as complete as the lower of the two joints.
    const reach = Math.min(reachOf(c.minElbowDy, restE), reachOf(c.minWristDy, restW));
    const maxElbowAbove = Math.max(0, -c.minElbowDy);
    const maxWristAbove = Math.max(0, -c.minWristDy);
    const overshoot = ramp(
      Math.max(maxElbowAbove, maxWristAbove), LR_CFG.elbow_above_tolerance, LR_CFG.elbow_above_zero_at,
    );
    return {
      side: c.side,
      reachedTop: c.reachedTop && !c.lost,
      elbowReachedTop: c.elbowTop && !c.lost,
      wristReachedTop: c.wristTop && !c.lost,
      complete: !c.partial && !c.lost,
      lost: c.lost,
      peakElbowDy: round2(c.minElbowDy),
      peakWristDy: round2(c.minWristDy),
      maxElbowAbove,
      maxWristAbove,
      romPct: reach * 100,
      romScore: Math.max(0, reach * 100 - 50 * overshoot),
      elbowTooHigh: c.elbowAboveSec >= LR_CFG.flag_min_sec,
      wristTooHigh: c.wristAboveSec >= LR_CFG.flag_min_sec,
      topAt: c.topAt,
      endAt: c.endAt,
    };
  }

  _resolve(calib, now) {
    const p = this._pending;
    const win = this._window;
    this._pending = null;
    this._window = null;

    const L = this._armResult(p.left, calib);
    const R = this._armResult(p.right, calib);
    const arms = [L, R].filter(Boolean);
    const fullRom = !!(L && R && L.complete && R.complete && L.reachedTop && R.reachedTop);

    const issues = new Set();
    if (!fullRom) {
      const anyTop = arms.some((a) => a.reachedTop);
      issues.add(anyTop || arms.length < 2 || arms.some((a) => a.lost) ? 'lr_incomplete' : 'lr_not_high_enough');
    }
    if (arms.some((a) => !a.elbowReachedTop)) issues.add('lr_not_high_enough');
    // Elbow made it into the band but the wrist stayed below it → half rep.
    if (arms.some((a) => a.elbowReachedTop && !a.wristReachedTop)) {
      issues.add('lr_wrist_not_high_enough');
      if (!arms.some((a) => !a.elbowReachedTop)) issues.delete('lr_not_high_enough');
    }
    if (arms.some((a) => a.elbowTooHigh)) issues.add('lr_elbow_too_high');
    if (arms.some((a) => a.wristTooHigh)) issues.add('lr_wrist_too_high');

    const symDiff = L && R ? Math.abs(p.left.minElbowDy - p.right.minElbowDy) : null;
    if (symDiff != null && symDiff > LR_CFG.symmetry_max) issues.add('lr_asymmetry');
    if ((win?.unevenSec ?? 0) >= LR_CFG.symmetry_min_sec) issues.add('lr_asymmetry');
    // Start / finish lag between the two arms.
    const lagSec = L && R && p.left && p.right
      ? Math.max(Math.abs(p.left.startAt - p.right.startAt), win?.maxSoloSec ?? 0)
      : null;
    if (lagSec != null && lagSec > LR_CFG.sync_max_sec) issues.add('lr_arms_out_of_sync');
    const tilt = win?.maxTilt ?? 0;
    if (tilt > LR_CFG.shoulder_tilt_max) issues.add('lr_shoulder_tilt');

    // ── Component scores (0–100) ────────────────────────────────────────────
    const romPct = ((L?.romPct ?? 0) + (R?.romPct ?? 0)) / 2;
    const romScore = ((L?.romScore ?? 0) + (R?.romScore ?? 0)) / 2;
    const levelRatio = win?.maxLevelRatio ?? 0;
    const symmetryPct = symDiff == null ? 0 : 100 * Math.min(
      1 - ramp(symDiff, 0, LR_CFG.symmetry_zero_at),
      1 - ramp(levelRatio, 1, LR_CFG.symmetry_zero_at / LR_CFG.symmetry_max),
      1 - ramp(lagSec ?? 0, LR_CFG.sync_max_sec, LR_CFG.sync_zero_at_sec),
    );
    const stabilityPct = 100 * (1 - ramp(tilt, LR_CFG.shoulder_tilt_max, LR_CFG.shoulder_tilt_zero_at));

    const W = LR_SCORE_WEIGHTS;
    const wSum = (W.rom || 0) + (W.symmetry || 0) + (W.stability || 0) || 1;
    const score = Math.round(
      ((W.rom || 0) * romScore
        + (W.symmetry || 0) * symmetryPct
        + (W.stability || 0) * stabilityPct) / wSum,
    );

    const keys = LR_ISSUE_PRIORITY.filter((k) => issues.has(k));
    const clean = fullRom
      && score >= LR_CFG.clean_score_min
      && !issues.has('lr_elbow_too_high')
      && !issues.has('lr_wrist_too_high')
      && !issues.has('lr_incomplete');

    this.count += 1;
    this.setCount += 1;
    const startAt = win?.startAt ?? Math.min(...[p.left, p.right].filter(Boolean).map((c) => c.startAt));
    const result = {
      attempt: this.attempts.length + 1,
      index: this.count,
      set: this.setIndex,
      repInSet: this.setCount,
      counted: true,
      fullRom,
      clean,
      score,
      components: {
        rom: Math.round(romScore),
        symmetry: Math.round(symmetryPct),
        stability: Math.round(stabilityPct),
      },
      romPct: Math.round(romPct),
      symmetryPct: Math.round(symmetryPct),
      stabilityPct: Math.round(stabilityPct),
      issues: keys,
      primaryIssue: selectPrimaryIssue(keys),
      shoulderTilt: Math.round(tilt * 100) / 100,
      symmetryDiff: symDiff == null ? null : Math.round(symDiff * 100) / 100,
      maxLevelRatio: round2(levelRatio),
      syncLagSec: lagSec == null ? null : round2(lagSec),
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
      elbowTooHigh: has('lr_elbow_too_high'),
      wristTooHigh: has('lr_wrist_too_high'),
      notHighEnough: has('lr_not_high_enough'),
      wristNotHighEnough: has('lr_wrist_not_high_enough'),
      incomplete: has('lr_incomplete'),
      asymmetry: has('lr_asymmetry'),
      outOfSync: has('lr_arms_out_of_sync'),
      shoulderTilt: has('lr_shoulder_tilt'),
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
