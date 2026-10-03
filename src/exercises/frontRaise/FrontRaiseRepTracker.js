// Rep counting + per-rep form scoring for the dumbbell front raise.
//
// Each arm runs its own line-based cycle (no angles):
//   WAIT_DOWN → arm must first be in the start zone (after start / abort)
//   DOWN      → resting; leaves when the wrist lift reaches `lift_start`
//   UP        → rising / at the top; TOP is reached when the wrist comes
//               within `top_tolerance` of the shoulder line; the cycle ends
//               once wrist AND elbow drop back under `lift_return`
//
// The two arm cycles are paired into one attempt, and every attempt is a
// counted rep — partial range of motion included. Full ROM (both arms reached
// the top within `pair_window_sec`) only affects the issues list, the score
// and whether the rep is "clean". Every attempt gets a weighted 0–100 score.

import { FR_CFG, FR_SCORE_WEIGHTS, FR_ISSUE_PRIORITY } from './config';
import { armLift } from './poseChecks';
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
    peakLift: 0,
    minWristDy: Infinity,
    maxWristOut: 0,
    tooHighSec: 0,
    flaredSec: 0,
    lost: false,
    partial: false,
    consumed: false,
  };
}

export function selectPrimaryIssue(keys) {
  return firstByPriority(keys, FR_ISSUE_PRIORITY);
}

export class FrontRaiseRepTracker {
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
      startAt: now, x0: g.shMid.x, td0: g.torsoDist,
      maxTilt: 0, maxSway: 0, maxLean: 0, leanSec: 0,
    };
  }

  /** @returns {boolean} true while the torso is leaning back past tolerance. */
  _updateWindow(g, calib, dt) {
    const w = this._window;
    if (!w) return false;
    const tilt = Math.abs(g.tilt - (calib?.tilt0 ?? 0));
    const sway = Math.abs(g.shMid.x - w.x0) / g.norm;
    const lean = Math.max(0, (w.td0 - g.torsoDist) / w.td0);
    w.maxTilt = Math.max(w.maxTilt, tilt);
    w.maxSway = Math.max(w.maxSway, sway);
    w.maxLean = Math.max(w.maxLean, lean);
    const leaning = lean > FR_CFG.lean_tolerance;
    if (leaning) w.leanSec += dt;
    return leaning;
  }

  _stepArm(side, a, g, calib, now, dt) {
    const arm = this._arms[side];
    const res = { done: null, top: false, liveKeys: [] };

    if (!a.ok) {
      if (arm.state === 'UP' && arm.cycle) {
        if (arm.missingSince < 0) arm.missingSince = now;
        if (now - arm.missingSince >= FR_CFG.arm_missing_abort_sec) {
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
    const inStartZone = lift.wrist <= FR_CFG.lift_return && lift.elbow <= FR_CFG.lift_return;

    if (arm.state === 'WAIT_DOWN') {
      if (inStartZone) arm.state = 'DOWN';
      return res;
    }

    if (arm.state === 'DOWN') {
      if (lift.wrist < FR_CFG.lift_start) return res;
      arm.state = 'UP';
      arm.cycle = newCycle(side, now);
      this._openWindow(g, now);
    }

    const c = arm.cycle;
    if (!c.reachedTop && now - c.startAt > FR_CFG.max_cycle_sec) {
      this._arms[side] = newArm();
      return res;
    }
    c.peakLift = Math.max(c.peakLift, lift.wrist);
    c.minWristDy = Math.min(c.minWristDy, a.wristDy);
    if (!c.reachedTop && a.wristDy <= FR_CFG.top_tolerance) {
      c.reachedTop = true;
      c.topAt = now;
      res.top = true;
    }
    if (-a.wristDy > FR_CFG.too_high_tolerance) {
      c.tooHighSec += dt;
      res.liveKeys.push('fr_too_high');
    }
    if (lift.wrist >= FR_CFG.flare_check_lift) {
      c.maxWristOut = Math.max(c.maxWristOut, a.wristOut);
      if (a.wristOut > FR_CFG.flare_tolerance) {
        c.flaredSec += dt;
        res.liveKeys.push('fr_arms_flared');
      }
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
    if (this._updateWindow(g, calib, dt)) liveKeys.add('fr_leaning_back');

    let attempt = null;
    const p = this._pending;
    if (p && p.left && p.right) {
      attempt = this._resolve(calib, now);
    } else if (p && now - p.firstAt > FR_CFG.pair_window_sec) {
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
    const restW = calib?.restWrist?.[c.side] ?? FR_CFG.rest_wrist_default;
    const tol = FR_CFG.top_tolerance;
    const reach = c.minWristDy <= tol ? 1 : clamp01((restW - c.minWristDy) / Math.max(restW - tol, 0.1));
    const maxWristAbove = Math.max(0, -c.minWristDy);
    const overshoot = ramp(maxWristAbove, FR_CFG.too_high_tolerance, FR_CFG.too_high_zero_at);
    return {
      side: c.side,
      reachedTop: c.reachedTop && !c.lost,
      complete: !c.partial && !c.lost,
      lost: c.lost,
      peakWristDy: round2(c.minWristDy),
      maxWristAbove,
      maxWristOut: c.maxWristOut,
      romPct: reach * 100,
      romScore: Math.max(0, reach * 100 - 50 * overshoot),
      tooHigh: c.tooHighSec >= FR_CFG.flag_min_sec,
      flared: c.flaredSec >= FR_CFG.flag_min_sec,
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
      issues.add(anyTop || arms.length < 2 || arms.some((a) => a.lost) ? 'fr_incomplete' : 'fr_not_high_enough');
    }
    if (arms.some((a) => !a.reachedTop)) issues.add('fr_not_high_enough');
    if (arms.some((a) => a.tooHigh)) issues.add('fr_too_high');
    if (arms.some((a) => a.flared)) issues.add('fr_arms_flared');

    const symDiff = L && R ? Math.abs(p.left.minWristDy - p.right.minWristDy) : null;
    if (symDiff != null && symDiff > FR_CFG.symmetry_max) issues.add('fr_asymmetry');
    const tilt = win?.maxTilt ?? 0;
    const sway = win?.maxSway ?? 0;
    const lean = win?.maxLean ?? 0;
    if (tilt > FR_CFG.shoulder_tilt_max) issues.add('fr_shoulder_tilt');
    if (sway > FR_CFG.body_sway_max) issues.add('fr_body_sway');
    if ((win?.leanSec ?? 0) >= FR_CFG.flag_min_sec) issues.add('fr_leaning_back');

    // ── Component scores (0–100) ────────────────────────────────────────────
    const romPct = ((L?.romPct ?? 0) + (R?.romPct ?? 0)) / 2;
    const romScore = ((L?.romScore ?? 0) + (R?.romScore ?? 0)) / 2;
    const maxWristOut = Math.max(0, ...arms.map((a) => a.maxWristOut));
    const pathPct = 100 * (1 - ramp(maxWristOut, FR_CFG.flare_tolerance, FR_CFG.flare_zero_at));
    const symmetryPct = symDiff == null ? 0 : 100 * (1 - ramp(symDiff, 0, FR_CFG.symmetry_zero_at));
    const tiltScore = 1 - ramp(tilt, FR_CFG.shoulder_tilt_max, FR_CFG.shoulder_tilt_zero_at);
    const swayScore = 1 - ramp(sway, FR_CFG.body_sway_max, FR_CFG.body_sway_zero_at);
    const leanScore = 1 - ramp(lean, FR_CFG.lean_tolerance, FR_CFG.lean_zero_at);
    const stabilityPct = 100 * (tiltScore + swayScore + leanScore) / 3;

    const W = FR_SCORE_WEIGHTS;
    const wSum = (W.rom || 0) + (W.path || 0) + (W.symmetry || 0) + (W.stability || 0) || 1;
    const score = Math.round(
      ((W.rom || 0) * romScore
        + (W.path || 0) * pathPct
        + (W.symmetry || 0) * symmetryPct
        + (W.stability || 0) * stabilityPct) / wSum,
    );

    const keys = FR_ISSUE_PRIORITY.filter((k) => issues.has(k));
    const clean = fullRom
      && score >= FR_CFG.clean_score_min
      && !issues.has('fr_too_high')
      && !issues.has('fr_arms_flared')
      && !issues.has('fr_incomplete');

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
        path: Math.round(pathPct),
        symmetry: Math.round(symmetryPct),
        stability: Math.round(stabilityPct),
      },
      romPct: Math.round(romPct),
      pathPct: Math.round(pathPct),
      symmetryPct: Math.round(symmetryPct),
      stabilityPct: Math.round(stabilityPct),
      issues: keys,
      primaryIssue: selectPrimaryIssue(keys),
      shoulderTilt: round2(tilt),
      bodySway: round2(sway),
      lean: round2(lean),
      symmetryDiff: symDiff == null ? null : round2(symDiff),
      left: L,
      right: R,
      durationSec: round2(Math.max(0, now - startAt)),
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
export function summarizeFrontRaise(attempts, {
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
    pathPct: r(avg(list.map((a) => a.pathPct))),
    symmetryPct: r(avg(list.map((a) => a.symmetryPct))),
    stabilityPct: r(avg(list.map((a) => a.stabilityPct))),
    activeSec: Math.round(activeSec),
    sessionSec: Math.round(sessionSec),
    avgRepSec: counted.length ? Math.round(avg(counted.map((a) => a.durationSec)) * 10) / 10 : null,
    mistakes: {
      tooHigh: has('fr_too_high'),
      notHighEnough: has('fr_not_high_enough'),
      armsFlared: has('fr_arms_flared'),
      leaningBack: has('fr_leaning_back'),
      incomplete: has('fr_incomplete'),
      asymmetry: has('fr_asymmetry'),
      shoulderTilt: has('fr_shoulder_tilt'),
      bodySway: has('fr_body_sway'),
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
