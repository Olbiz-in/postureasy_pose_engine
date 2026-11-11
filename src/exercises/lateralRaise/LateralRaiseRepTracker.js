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
// Peak count fires when BOTH elbows reach `count_min_lift` (partial reps count).
// A rep is "clean" / full stretch only when both elbows AND both wrists land
// inside the shoulder band: past the LOWER line (else partial / half-rep),
// never above the UPPER line (`elbow_above_tolerance`; overshoot = injury risk).
// Every counted attempt gets a weighted 0–100 score.

import {
  LR_CFG, LR_SCORE_WEIGHTS, LR_ISSUE_PRIORITY, LR_ISSUE_MEANING, LR_LIVE_VOICE,
  issueSeverity, classifyIssues,
} from './config';
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
    /** Sticky: elbow cleared the count-min lift (enough to COUNT). */
    elbowCountOk: false,
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
    this._peakHoldFrames = 0;
    this._repLocked = false;
    this._openRep = null; // counted at peak; finalized when arms return
    this.live = { left: null, right: null, liveKeys: [] };
  }

  /** Start a new set: per-set rep counter restarts, arms must be down first. */
  startSet(index) {
    this.setIndex = index;
    this.setCount = 0;
    this.abortInProgress();
  }

  /** True while a peak-counted rep is waiting to be finalized on the way down. */
  get hasOpenRep() {
    return !!this._openRep;
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
    this._peakHoldFrames = 0;
    this._repLocked = false;
    // Open peak-counted rep is finalized by the flow via finalizeOpenRep().
  }

  /**
   * If Stop arrives between peak and arms-down, finalize the open rep with
   * whatever arm/window data we have so far.
   */
  finalizeOpenRep(calib, now) {
    if (!this._openRep) return null;
    if (!this._pending) this._pending = { left: null, right: null, firstAt: now };
    for (const side of SIDES) {
      const arm = this._arms[side];
      if (!this._pending[side] && arm.cycle) {
        this._pending[side] = { ...arm.cycle, endAt: now, partial: true };
      }
    }
    for (const s of SIDES) this._arms[s] = newArm();
    this._peakHoldFrames = 0;
    this._repLocked = false;
    return this._resolve(calib, now);
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
    // Count line (partial OK) vs full shoulder-band stretch.
    if (lift.elbow >= LR_CFG.count_min_lift) c.elbowCountOk = true;
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
   * Both arms are in UP and each elbow has cleared `count_min_lift` at least
   * once this cycle (sticky). Partial raises still count; full stretch is
   * scored later via the shoulder band.
   */
  _bothElbowsReachedCountMin() {
    return SIDES.every((s) => {
      const arm = this._arms[s];
      return arm.state === 'UP' && arm.cycle && arm.cycle.elbowCountOk;
    });
  }

  _bothArmsReset(g, calib) {
    if (!g?.left?.ok || !g?.right?.ok) return false;
    const resetLift = LR_LIVE_VOICE.RESET_THRESHOLD;
    for (const side of SIDES) {
      const lift = armLift(g[side], calib);
      if (!lift || lift.elbow > resetLift) return false;
    }
    return true;
  }

  /** Count + lock when both elbows have held the count line for N frames. */
  _tickPeakCount(g, calib, now) {
    if (this._repLocked) {
      if (this._bothArmsReset(g, calib)) {
        this._repLocked = false;
        this._peakHoldFrames = 0;
      }
      return null;
    }
    if (this._bothElbowsReachedCountMin()) {
      this._peakHoldFrames += 1;
      const need = Math.max(1, Math.round(LR_LIVE_VOICE.VALID_FRAMES));
      if (this._peakHoldFrames >= need) {
        this.count += 1;
        this.setCount += 1;
        this._openRep = {
          index: this.count,
          set: this.setIndex,
          repInSet: this.setCount,
          countedAt: now,
        };
        this._repLocked = true;
        this._peakHoldFrames = 0;
        this._openWindow(g, now);
        return { ...this._openRep };
      }
      return null;
    }
    this._peakHoldFrames = 0;
    return null;
  }

  /**
   * Advance one frame.
   * @returns {{ attempt: object|null, peakCounted: object|null, topSides: string[], liveKeys: string[] }}
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

    const peakCounted = this._tickPeakCount(g, calib, now);

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
    if (this._window && !this.inProgress && !this._openRep) this._window = null;

    this.live = {
      left: this._arms.left.state,
      right: this._arms.right.state,
      liveKeys: [...liveKeys],
    };
    return { attempt, peakCounted, topSides, liveKeys: [...liveKeys] };
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
    // clean = perfect (no mistakes). Binary accurate = no major. Continuous
    // accuracyPct = weighted checks passed / total checks (skips lr_incomplete).
    const { hasMajor, hasMinor, perfect, accurate, accuracyPct } = classifyIssues(keys);

    // Peak path: count already happened. Partials that never peaked are dropped.
    const open = this._openRep;
    if (!open) {
      this._pending = null;
      this._window = null;
      return null;
    }
    this._openRep = null;
    const startAt = win?.startAt ?? Math.min(...[p.left, p.right].filter(Boolean).map((c) => c.startAt));
    const result = {
      attempt: this.attempts.length + 1,
      index: open.index,
      set: open.set,
      repInSet: open.repInSet,
      counted: true,
      countedAtPeak: true,
      fullRom,
      clean: perfect,
      accurate,
      accuracyPct: Math.round(accuracyPct),
      hasMajor,
      hasMinor,
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

/** One-time glossary: mistake key → { meaning, severity } (put at top of JSON). */
export function mistakeMeanings() {
  const out = {};
  for (const key of LR_ISSUE_PRIORITY) {
    out[key] = {
      meaning: LR_ISSUE_MEANING[key] || key,
      severity: issueSeverity(key),
    };
  }
  return out;
}

/** Per-rep checklist: only keys (meanings live once at session top). */
export function mistakeChecklist(issues = []) {
  const made = new Set(issues || []);
  const mistakesMade = LR_ISSUE_PRIORITY.filter((k) => made.has(k));
  const cls = classifyIssues(mistakesMade);
  return {
    mistakesMade,
    mistakesNotMade: LR_ISSUE_PRIORITY.filter((k) => !made.has(k)),
    hasMajor: cls.hasMajor,
    hasMinor: cls.hasMinor,
    accurate: cls.accurate,
    accuracyPct: Math.round(cls.accuracyPct),
  };
}

/** Compact JSON blob for one finished rep (console / debug). */
export function buildRepMistakeReport(attempt) {
  if (!attempt) return null;
  const check = mistakeChecklist(attempt.issues);
  return {
    set: attempt.set,
    rep: attempt.repInSet,
    globalRep: attempt.index,
    clean: !!attempt.clean,
    accurate: attempt.accurate ?? check.accurate,
    accuracyPct: attempt.accuracyPct ?? check.accuracyPct,
    hasMajor: attempt.hasMajor ?? check.hasMajor,
    hasMinor: attempt.hasMinor ?? check.hasMinor,
    score: attempt.score,
    romPct: attempt.romPct,
    primaryIssue: attempt.primaryIssue || null,
    mistakesMade: check.mistakesMade,
    mistakesNotMade: check.mistakesNotMade,
  };
}

/** Full-session JSON: glossary once at top, then every rep (keys only). */
export function buildSessionMistakeReport(attempts = [], meta = {}) {
  const list = attempts || [];
  const counted = list.filter((a) => a.counted);
  const perfect = list.filter((a) => a.clean || classifyIssues(a.issues).perfect);
  const accurate = list.filter((a) => (a.accurate != null ? a.accurate : classifyIssues(a.issues).accurate));
  const minorOnly = list.filter((a) => {
    const c = a.hasMajor != null
      ? { hasMajor: a.hasMajor, hasMinor: a.hasMinor }
      : classifyIssues(a.issues);
    return c.hasMinor && !c.hasMajor;
  });
  const major = list.filter((a) => (a.hasMajor != null ? a.hasMajor : classifyIssues(a.issues).hasMajor));
  return {
    mistakes: mistakeMeanings(),
    setsCompleted: meta.setsCompleted ?? null,
    targetSets: meta.targetSets ?? null,
    targetReps: meta.targetReps ?? null,
    repsCompleted: counted.length,
    cleanReps: perfect.length,
    perfectReps: perfect.length,
    accurateReps: accurate.length,
    minorOnlyReps: minorOnly.length,
    majorReps: major.length,
    formScore: meta.formScore ?? null,
    accuracy: meta.accuracy ?? null,
    reps: list.map((a) => buildRepMistakeReport(a)),
  };
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
  const classified = list.map((a) => {
    const c = classifyIssues(a.issues || []);
    return {
      perfect: c.perfect,
      accurate: a.accurate != null ? !!a.accurate : c.accurate,
      accuracyPct: a.accuracyPct != null ? a.accuracyPct : c.accuracyPct,
      hasMajor: a.hasMajor != null ? !!a.hasMajor : c.hasMajor,
      hasMinor: a.hasMinor != null ? !!a.hasMinor : c.hasMinor,
    };
  });
  const baseIdx = counted.length
    ? list.map((a, i) => (a.counted ? i : -1)).filter((i) => i >= 0)
    : list.map((_, i) => i);
  const perfectReps = baseIdx.filter((i) => classified[i].perfect).length;
  const accurateReps = baseIdx.filter((i) => classified[i].accurate).length;
  const minorOnlyReps = baseIdx.filter((i) => classified[i].hasMinor && !classified[i].hasMajor).length;
  const majorReps = baseIdx.filter((i) => classified[i].hasMajor).length;
  const has = (k) => list.filter((a) => (a.issues || []).includes(k)).length;

  let best = null;
  let worst = null;
  for (const a of list) {
    if (!best || a.romPct > best.romPct) best = a;
    if (!worst || a.romPct < worst.romPct) worst = a;
  }
  const r = (v) => (v == null ? null : Math.round(v));
  const formScore = r(avg(list.map((a) => a.score)));
  const repsDone = baseIdx.length;
  // Continuous accuracy: average of per-rep (weighted checks passed / total).
  // Falls back to recomputing from issues so older attempt blobs still work.
  const accuracy = repsDone
    ? Math.round(avg(baseIdx.map((i) => {
      const a = list[i];
      if (a.accuracyPct != null) return a.accuracyPct;
      return classified[i].accuracyPct;
    })))
    : 0;
  const rom = r(avg(list.map((a) => a.romPct)));

  return {
    attempts: n,
    repsCompleted: counted.length,
    cleanReps: perfectReps,
    perfectReps,
    accurateReps,
    minorOnlyReps,
    majorReps,
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
    perRep: list.map((a, i) => ({
      attempt: a.attempt,
      rep: a.index,
      set: a.set,
      counted: a.counted,
      clean: a.clean != null ? a.clean : classified[i].perfect,
      accurate: classified[i].accurate,
      accuracyPct: Math.round(classified[i].accuracyPct),
      hasMajor: classified[i].hasMajor,
      hasMinor: classified[i].hasMinor,
      score: a.score,
      romPct: a.romPct,
      issues: a.issues,
      ...mistakeChecklist(a.issues),
    })),
    mistakeReport: buildSessionMistakeReport(list, {
      setsCompleted, targetSets, targetReps, formScore, accuracy,
    }),
    summaryLine: n
      ? `Form Score ${formScore}/100, Accuracy ${accuracy}%, Range of Motion ${rom}%`
      : 'No reps recorded',
  };
}
