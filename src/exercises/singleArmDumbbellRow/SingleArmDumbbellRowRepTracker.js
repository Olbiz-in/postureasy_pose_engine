// Rep counting + per-rep form scoring for the single-arm dumbbell row.
//
// The working arm runs one torso-line cycle (no joint angles):
//   WAIT_START → the arm must first hang in the start zone (after a set start,
//                an abort or a working-side change)
//   START      → hanging; the cycle opens when row progress reaches `lift_start`
//   PULLING    → elbow travelling up and back toward the hip
//   TOP        → elbow inside the TOP band at the torso line (`top_tolerance`)
//   RETURNING  → lowering. The cycle closes when the elbow (and the wrist,
//                when visible) is back in the start zone ('bottom'), or when a
//                new pull starts before that ('reversal' = not lowered fully).
//
// Counting uses the same attempt schema as the other set-based trackers:
//   - cycles that never reach `attempt_min_rom`, or last less than
//     `min_cycle_sec`, are pose noise and ignored entirely
//   - a cycle lowered back to the start with ROM ≥ `min_count_rom` is a
//     counted rep — partial ROM included, as in the raises; full ROM = TOP
//   - anything else (short pulses, not lowered) is an attempt that is not
//     counted, as in the curl
//   - the arm hidden mid-rep drops the cycle without scoring: low landmark
//     confidence is not a form mistake
//
// Torso stability and shrug are measured against the posture just before the
// rep started, so settling between reps is fine.

import { SR_CFG, SR_SCORE_WEIGHTS, SR_ISSUE_PRIORITY } from './config';
import { armMetrics } from './poseChecks';
import { clamp01, ramp, round2, avg, median, firstByPriority } from '../common/math';

const REST_HISTORY_SEC = 1.0;
const CONSISTENCY_HISTORY = 3;

export const SR_ARM_STATE = {
  WAIT_START: 'WAIT_START',
  START: 'START',
  PULLING: 'PULLING',
  TOP: 'TOP',
  RETURNING: 'RETURNING',
};
const S = SR_ARM_STATE;

function newBody() {
  return {
    frames: 0,
    maxAngle: 0,
    angleSec: 0,
    rotationFrames: 0,
    maxRotation: 0,
    rotationSec: 0,
    maxShrug: 0,
    shrugSec: 0,
  };
}

function newCycle(now, startAt, progress) {
  return {
    startAt, // last moment the arm was in the start zone
    topAt: -1,
    peakAt: now,
    valleyAt: now,
    endAt: -1,
    reachedTop: false,
    peak: progress,
    valley: progress, // lowest progress since the current peak
    pathChecked: false,
    maxBack: -Infinity,
    closedBy: null, // 'bottom' | 'reversal'
    body: newBody(),
  };
}

export function selectPrimaryIssue(keys) {
  return firstByPriority(keys, SR_ISSUE_PRIORITY);
}

export class SingleArmDumbbellRowRepTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this.attempts = [];
    this.lastAttempt = null;
    this.setIndex = 1;
    this.setCount = 0;
    this.side = null;
    this._recentRom = [];
    this._lastNow = -1;
    this.abortInProgress();
    this.live = { state: this._state, progress: null, liveKeys: [] };
  }

  /** Start a new set: per-set rep counter restarts, the arm must hang first. */
  startSet(index) {
    this.setIndex = index;
    this.setCount = 0;
    this.abortInProgress();
  }

  /** Working arm for the following attempts; a change drops any rep in progress. */
  setSide(side) {
    if (side === this.side) return;
    this.side = side;
    this._recentRom = [];
    this.abortInProgress();
  }

  get inProgress() {
    return !!this._cycle;
  }

  get state() {
    return this._state;
  }

  /** Drop the current cycle without scoring (out of frame, low confidence, side change). */
  abortInProgress() {
    this._state = S.WAIT_START;
    this._cycle = null;
    this._missingSince = -1;
    this._lastInStartAt = -1;
    this._restHist = [];
    this._base = null;
  }

  // ── Body baseline ─────────────────────────────────────────────────────────

  _recordRest(g, now) {
    this._restHist.push({ t: now, elev: g.elev, sep: g.sep, T: g.T });
    while (this._restHist.length && now - this._restHist[0].t > REST_HISTORY_SEC) this._restHist.shift();
  }

  /** Posture from ~`body_baseline_lookback_sec` before the rep started. */
  _pickBaseline(g, now, calib) {
    const h = this._restHist;
    let pick = h.length ? h[0] : { elev: g.elev, sep: g.sep, T: g.T };
    const cutoff = now - SR_CFG.body_baseline_lookback_sec;
    for (const e of h) if (e.t <= cutoff) pick = e;
    return { ...pick, sep: pick.sep ?? calib?.sep0 ?? null };
  }

  _bodyMetrics(g) {
    const b = this._base;
    return {
      angle: Math.abs(g.elev - b.elev),
      rotation: g.sep != null && b.sep != null ? Math.abs(g.sep - b.sep) : null,
      shrug: (g.T - b.T) / b.T,
    };
  }

  _applyBody(c, m, dt) {
    const b = c.body;
    b.frames += 1;
    b.maxAngle = Math.max(b.maxAngle, m.angle);
    if (m.angle > SR_CFG.torso_angle_tolerance_deg) b.angleSec += dt;
    if (m.rotation != null) {
      b.rotationFrames += 1;
      b.maxRotation = Math.max(b.maxRotation, m.rotation);
      if (m.rotation > SR_CFG.rotation_tolerance) b.rotationSec += dt;
    }
    b.maxShrug = Math.max(b.maxShrug, m.shrug);
    if (m.shrug > SR_CFG.shrug_tolerance) b.shrugSec += dt;
  }

  // ── Frame update ──────────────────────────────────────────────────────────

  /**
   * Advance one frame. `visible` = the working arm passed the view-confidence
   * gate; when false the frame is treated as the arm being hidden.
   * @returns {{ attempt: object|null, top: boolean, liveKeys: string[], progress: number|null }}
   */
  update(g, calib, now, visible = true) {
    const dt = this._lastNow < 0 ? 0 : Math.min(0.2, Math.max(0, now - this._lastNow));
    this._lastNow = now;
    const res = { attempt: null, top: false, liveKeys: [], progress: null };
    const m = visible ? armMetrics(g, calib) : null;

    if (!m) {
      if (this._cycle) {
        if (this._missingSince < 0) this._missingSince = now;
        if (now - this._missingSince >= SR_CFG.arm_missing_abort_sec) this.abortInProgress();
      }
      return this._publish(res);
    }
    this._missingSince = -1;
    res.progress = m.progress;

    if (!this._cycle) {
      this._recordRest(g, now);
      if (m.inStart) this._lastInStartAt = now;
    }

    if (this._state === S.WAIT_START) {
      if (m.inStart) this._state = S.START;
      return this._publish(res);
    }

    if (this._state === S.START) {
      if (m.progress < SR_CFG.lift_start) return this._publish(res);
      this._state = S.PULLING;
      this._cycle = newCycle(now, this._lastInStartAt >= 0 ? this._lastInStartAt : now, m.progress);
      this._base = this._pickBaseline(g, now, calib);
    }

    const c = this._cycle;
    if (!c.reachedTop && now - c.startAt > SR_CFG.max_cycle_sec) {
      this.abortInProgress();
      return this._publish(res);
    }

    if (m.progress > c.peak) {
      c.peak = m.progress;
      c.peakAt = now;
      c.valley = m.progress;
      c.valleyAt = now;
    } else if (m.progress < c.valley) {
      c.valley = m.progress;
      c.valleyAt = now;
    }

    const body = this._bodyMetrics(g);
    this._applyBody(c, body, dt);
    const torsoMoving = body.angle > SR_CFG.torso_angle_tolerance_deg
      || (body.rotation != null && body.rotation > SR_CFG.rotation_tolerance);
    if (torsoMoving) res.liveKeys.push('sr_torso_rotation');
    if (body.shrug > SR_CFG.shrug_tolerance) res.liveKeys.push('sr_shoulder_shrug');

    if (m.progress >= SR_CFG.path_check_lift) {
      c.pathChecked = true;
      c.maxBack = Math.max(c.maxBack, m.backTravel);
    }

    if (m.inStart) {
      res.attempt = this._close(c, 'bottom', now, calib);
      this._state = S.START;
      this._lastInStartAt = now;
      return this._publish(res);
    }

    switch (this._state) {
      case S.PULLING:
        if (m.top) {
          this._enterTop(c, now, res);
        } else if (c.peak - m.progress >= SR_CFG.top_exit_drop) {
          this._state = S.RETURNING;
        }
        break;
      case S.TOP:
        if (!m.top && c.peak - m.progress >= SR_CFG.top_exit_drop) this._state = S.RETURNING;
        break;
      case S.RETURNING:
        if (m.progress - c.valley >= SR_CFG.reversal_rise) {
          if (c.peak - c.valley >= SR_CFG.reversal_drop) {
            // Came down part-way, then started the next pull without lowering.
            const valleyAt = c.valleyAt;
            res.attempt = this._close(c, 'reversal', now, calib);
            this._cycle = newCycle(now, valleyAt, m.progress);
            this._state = S.PULLING;
          } else {
            this._state = S.PULLING;
          }
        }
        break;
      default:
        break;
    }

    // Elbow path near the top: still not travelling back toward the hip.
    if (this._state === S.TOP && m.backTravel < SR_CFG.elbow_back_min) res.liveKeys.push('sr_elbow_flare');

    return this._publish(res);
  }

  _enterTop(c, now, res) {
    this._state = S.TOP;
    if (!c.reachedTop) {
      c.reachedTop = true;
      c.topAt = now;
      res.top = true;
    }
  }

  _publish(res) {
    this.live = { state: this._state, progress: res.progress, liveKeys: res.liveKeys };
    return res;
  }

  _close(c, closedBy, now, calib) {
    c.closedBy = closedBy;
    c.endAt = now;
    this._cycle = null;
    return this._resolve(c, calib);
  }

  // ── Attempts ──────────────────────────────────────────────────────────────

  _resolve(c) {
    const durationSec = Math.max(0, c.endAt - c.startAt);
    const romFrac = c.reachedTop ? 1 : clamp01(c.peak);
    if (romFrac < SR_CFG.attempt_min_rom || durationSec < SR_CFG.min_cycle_sec) return null;

    const lowered = c.closedBy === 'bottom';
    const counted = lowered && romFrac >= SR_CFG.min_count_rom;
    const fullRom = c.reachedTop && lowered;
    const pullSec = Math.max(0, (c.reachedTop ? c.topAt : c.peakAt) - c.startAt);
    const lowerSec = Math.max(0, c.endAt - c.peakAt);
    const b = c.body;
    const backTravel = c.pathChecked ? c.maxBack : null;
    const rotationMeasured = b.frames > 0 && b.rotationFrames >= b.frames / 2;

    const issues = new Set();
    if (!c.reachedTop) issues.add('sr_insufficient_rom');
    if (!lowered) issues.add('sr_incomplete_return');
    if (backTravel != null && backTravel < SR_CFG.elbow_back_min) issues.add('sr_elbow_flare');
    if (b.angleSec >= SR_CFG.flag_min_sec || (rotationMeasured && b.rotationSec >= SR_CFG.flag_min_sec)) {
      issues.add('sr_torso_rotation');
    }
    if (b.shrugSec >= SR_CFG.flag_min_sec) issues.add('sr_shoulder_shrug');
    if (pullSec < SR_CFG.momentum_pull_sec) issues.add('sr_momentum');
    if (lowered && (durationSec < SR_CFG.min_rep_sec || lowerSec < SR_CFG.min_lower_sec)) issues.add('sr_too_fast');

    // ── Component scores (0–100); null = not measurable for this rep ────────
    const ext = lowered ? 1 : clamp01(1 - c.valley);
    const share = clamp01(SR_CFG.rom_return_share);
    const romScore = 100 * ((1 - share) * romFrac + share * ext);
    const pathPct = backTravel == null
      ? null
      : 100 * (1 - ramp(SR_CFG.elbow_back_min - backTravel, 0, SR_CFG.elbow_path_zero_at));
    const angleS = 1 - ramp(b.maxAngle, SR_CFG.torso_angle_tolerance_deg, SR_CFG.torso_angle_zero_at_deg);
    const rotS = rotationMeasured ? 1 - ramp(b.maxRotation, SR_CFG.rotation_tolerance, SR_CFG.rotation_zero_at) : null;
    const stabilityPct = 100 * (rotS == null ? angleS : (angleS + rotS) / 2);
    const shoulderPct = 100 * (1 - ramp(b.maxShrug, SR_CFG.shrug_tolerance, SR_CFG.shrug_zero_at));
    const tempoPct = 100 * Math.min(
      ramp(pullSec, SR_CFG.momentum_pull_sec / 2, SR_CFG.momentum_pull_sec),
      lowered ? ramp(lowerSec, SR_CFG.min_lower_sec / 2, SR_CFG.min_lower_sec) : 1,
      lowered ? ramp(durationSec, SR_CFG.min_rep_sec / 2, SR_CFG.min_rep_sec) : 1,
    );
    const prevRom = this._recentRom.length ? median(this._recentRom) : null;
    const consistencyPct = prevRom == null
      ? null
      : 100 * (1 - ramp(Math.abs(romFrac - prevRom), 0, SR_CFG.consistency_zero_at));

    const W = SR_SCORE_WEIGHTS;
    const parts = [
      [W.rom, romScore],
      [W.path, pathPct],
      [W.stability, stabilityPct],
      [W.shoulder, shoulderPct],
      [W.tempo, tempoPct],
      [W.consistency, consistencyPct],
    ].filter(([w, v]) => v != null && w > 0);
    const wSum = parts.reduce((s, [w]) => s + w, 0) || 1;
    const score = Math.round(parts.reduce((s, [w, v]) => s + w * v, 0) / wSum);

    const keys = SR_ISSUE_PRIORITY.filter((k) => issues.has(k));
    const clean = counted
      && fullRom
      && score >= SR_CFG.clean_score_min
      && !issues.has('sr_momentum')
      && !issues.has('sr_torso_rotation')
      && !issues.has('sr_elbow_flare');

    if (counted) {
      this.count += 1;
      this.setCount += 1;
      this._recentRom.push(romFrac);
      while (this._recentRom.length > CONSISTENCY_HISTORY) this._recentRom.shift();
    }

    const r = (v) => (v == null ? null : Math.round(v));
    const result = {
      attempt: this.attempts.length + 1,
      index: counted ? this.count : null,
      set: this.setIndex,
      repInSet: counted ? this.setCount : null,
      side: this.side,
      counted,
      fullRom,
      clean,
      score,
      components: {
        rom: r(romScore),
        path: r(pathPct),
        stability: r(stabilityPct),
        shoulder: r(shoulderPct),
        tempo: r(tempoPct),
        consistency: r(consistencyPct),
      },
      romPct: Math.round(romFrac * 100),
      extensionPct: Math.round(ext * 100),
      pathPct: r(pathPct),
      stabilityPct: r(stabilityPct),
      shoulderPct: r(shoulderPct),
      tempoPct: r(tempoPct),
      consistencyPct: r(consistencyPct),
      rotationMeasured,
      issues: keys,
      primaryIssue: selectPrimaryIssue(keys),
      closedBy: c.closedBy,
      peak: round2(c.peak),
      elbowBackTravel: backTravel == null ? null : round2(backTravel),
      body: {
        torsoAngleDeg: Math.round(b.maxAngle * 10) / 10,
        rotation: rotationMeasured ? round2(b.maxRotation) : null,
        shrug: round2(b.maxShrug),
      },
      pullSec: round2(pullSec),
      lowerSec: round2(lowerSec),
      durationSec: round2(durationSec),
      finishedAt: c.endAt,
    };
    this.attempts.push(result);
    this.lastAttempt = result;
    return result;
  }
}

/**
 * Cumulative session metrics over every attempt (all sets, both arms). Pure —
 * safe to call at any time, including after an early Stop. Averages skip
 * values that were not measurable for a rep (null).
 */
export function summarizeSingleArmDumbbellRow(attempts, {
  activeSec = 0,
  sessionSec = 0,
  setsCompleted = 0,
  targetSets = 0,
  targetReps = 0,
  stoppedEarly = false,
  confidence = null,
} = {}) {
  const list = attempts || [];
  const n = list.length;
  const counted = list.filter((a) => a.counted);
  const clean = list.filter((a) => a.clean);
  const full = list.filter((a) => a.fullRom);
  const has = (k) => list.filter((a) => a.issues.includes(k)).length;

  let best = null;
  let worst = null;
  for (const a of list) {
    if (!best || a.romPct > best.romPct) best = a;
    if (!worst || a.romPct < worst.romPct) worst = a;
  }
  const r = (v) => (v == null ? null : Math.round(v));
  const avgOf = (k, from = list) => r(avg(from.map((a) => a[k]).filter((v) => v != null)));
  const avgSec = (k) => (counted.length ? Math.round(avg(counted.map((a) => a[k])) * 10) / 10 : null);
  const formScore = avgOf('score');
  const accuracy = n ? Math.round((clean.length / n) * 100) : null;
  const rom = avgOf('romPct');

  return {
    attempts: n,
    repsCompleted: counted.length,
    cleanReps: clean.length,
    fullRomReps: full.length,
    setsCompleted,
    targetSets,
    targetReps,
    stoppedEarly,
    formScore,
    accuracy,
    romPct: rom,
    romBest: best ? { attempt: best.attempt, rep: best.index, romPct: best.romPct } : null,
    romWorst: worst ? { attempt: worst.attempt, rep: worst.index, romPct: worst.romPct } : null,
    completenessPct: n ? Math.round((full.length / n) * 100) : null,
    extensionPct: avgOf('extensionPct'),
    pathPct: avgOf('pathPct'),
    stabilityPct: avgOf('stabilityPct'),
    shoulderPct: avgOf('shoulderPct'),
    tempoPct: avgOf('tempoPct'),
    consistencyPct: avgOf('consistencyPct'),
    rotationMeasuredReps: list.filter((a) => a.rotationMeasured).length,
    confidence: confidence == null ? null : round2(confidence),
    sides: {
      left: counted.filter((a) => a.side === 'left').length,
      right: counted.filter((a) => a.side === 'right').length,
    },
    activeSec: Math.round(activeSec),
    sessionSec: Math.round(sessionSec),
    avgRepSec: avgSec('durationSec'),
    avgPullSec: avgSec('pullSec'),
    avgLowerSec: avgSec('lowerSec'),
    mistakes: {
      insufficientRom: has('sr_insufficient_rom'),
      elbowFlare: has('sr_elbow_flare'),
      torsoRotation: has('sr_torso_rotation'),
      shoulderShrug: has('sr_shoulder_shrug'),
      incompleteReturn: has('sr_incomplete_return'),
      momentum: has('sr_momentum'),
      tooFast: has('sr_too_fast'),
    },
    perRep: list.map((a) => ({
      attempt: a.attempt,
      rep: a.index,
      set: a.set,
      side: a.side,
      counted: a.counted,
      clean: a.clean,
      score: a.score,
      romPct: a.romPct,
      pathPct: a.pathPct,
      stabilityPct: a.stabilityPct,
      durationSec: a.durationSec,
      issues: a.issues,
      primaryIssue: a.primaryIssue,
    })),
    summaryLine: n
      ? `Form Score ${formScore}/100, Accuracy ${accuracy}%, Range of Motion ${rom}%`
      : 'No reps recorded',
  };
}
