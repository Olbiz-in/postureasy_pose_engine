// Rep counting + per-rep form scoring for the dumbbell curl (front view).
//
// Each arm runs its own line-based cycle (no angles):
//   WAIT_DOWN → the wrist must first be in the bottom zone (after start / abort)
//   DOWN      → extended; leaves when curl progress reaches `curl_start`
//   UP        → curling / at the top. TOP ("half rep") is reached when the
//               wrist comes within `top_tolerance` of the TOP TARGET LINE.
//               The cycle ends when the wrist is back in the bottom zone
//               ('bottom'), when a new curl starts before that ('reversal' =
//               not lowering fully), or when the arm stays hidden ('lost').
//
// curl_mode 'both': the two arm cycles are paired into one attempt, counted
// only when BOTH arms reached the top and returned to the bottom within
// `pair_window_sec` of each other; otherwise it is INCOMPLETE.
// curl_mode 'alternate': every arm cycle is its own attempt.
//
// Body stability (sway, lean, shrug) is measured against the posture just
// before the rep started, so stepping closer / farther between reps is fine.

import { DC_CFG, DC_SCORE_WEIGHTS, DC_ISSUE_PRIORITY } from './config';
import { armMetrics, topProgressAt } from './poseChecks';
import { clamp01, ramp, round2, avg, firstByPriority } from '../common/math';

const SIDES = ['left', 'right'];
const OTHER = { left: 'right', right: 'left' };
const REST_HISTORY_SEC = 1.0;

function newArm() {
  return { state: 'WAIT_DOWN', cycle: null, missingSince: -1 };
}

function newBody() {
  return { maxSway: 0, maxLean: 0, maxShrug: 0, maxTilt: 0, swingSec: 0, shrugSec: 0, tiltSec: 0 };
}

function newCycle(side, now, progress) {
  return {
    side,
    startAt: now,
    endAt: -1,
    topAt: -1,
    reachedTop: false,
    peak: progress,
    valley: progress, // lowest progress since the current peak
    closedBy: null, // 'bottom' | 'reversal' | 'lost'
    maxOverUpper: 0,
    overUpperSec: 0,
    maxElbowLift: 0,
    maxElbowFlare: 0,
    elbowSec: 0,
    body: newBody(),
    partial: false,
    consumed: false,
  };
}

function mergeBodies(cycles) {
  const out = newBody();
  for (const c of cycles) {
    for (const k of Object.keys(out)) out[k] = Math.max(out[k], c.body[k]);
  }
  return out;
}

export function selectPrimaryIssue(keys) {
  return firstByPriority(keys, DC_ISSUE_PRIORITY);
}

export class DumbbellCurlRepTracker {
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
    this._restHist = [];
    this._base = null;
    this._lastPeak = { left: null, right: null };
    this._lastNow = -1;
    this._lockMode();
    this.live = { left: 'WAIT_DOWN', right: 'WAIT_DOWN', progress: { left: null, right: null }, liveKeys: [] };
  }

  // A mode change mid-set would strand a half-paired attempt, so
  // DC_CFG.curl_mode is only read when a set starts.
  _lockMode() {
    this._mode = DC_CFG.curl_mode === 'alternate' ? 'alternate' : 'both';
  }

  get mode() {
    return this._mode;
  }

  /** Start a new set: per-set rep counter restarts, arms must be down first. */
  startSet(index) {
    this.setIndex = index;
    this.setCount = 0;
    this.abortInProgress();
    this._lockMode();
  }

  /** Any arm mid-cycle, or a finished arm waiting for its partner. */
  get inProgress() {
    if (this._pending) return true;
    return SIDES.some((s) => this._arms[s].state === 'UP' && !this._arms[s].cycle?.consumed);
  }

  armState(side) {
    return this._arms[side].state;
  }

  /** Drop the current cycles without scoring (turned away / out of frame). */
  abortInProgress() {
    for (const s of SIDES) this._arms[s] = newArm();
    this._pending = null;
    this._base = null;
    this._restHist = [];
  }

  /**
   * Stop: score a finished arm still waiting for its partner (so no finished
   * work is lost), then drop anything still mid-curl.
   * @returns {object[]} attempts recorded by this call
   */
  finalize(calib, now) {
    const out = [];
    if (this._pending) {
      this._attachPartnerAsPartial(now);
      const a = this._resolvePending(calib);
      if (a) out.push(a);
    }
    this.abortInProgress();
    return out;
  }

  // ── Body baseline ─────────────────────────────────────────────────────────

  _recordRest(g, now) {
    this._restHist.push({ t: now, x: g.shMid.x, td: g.torsoDist, vt: g.vertTorso });
    while (this._restHist.length && now - this._restHist[0].t > REST_HISTORY_SEC) this._restHist.shift();
  }

  /** Posture from ~`body_baseline_lookback_sec` before the rep started. */
  _pickBaseline(g, now) {
    const h = this._restHist;
    if (!h.length) return { x: g.shMid.x, td: g.torsoDist, vt: g.vertTorso };
    const cutoff = now - DC_CFG.body_baseline_lookback_sec;
    let pick = h[0];
    for (const e of h) if (e.t <= cutoff) pick = e;
    return pick;
  }

  _bodyMetrics(g, calib) {
    const b = this._base;
    return {
      sway: Math.abs(g.shMid.x - b.x) / g.norm,
      lean: Math.max(0, (b.td - g.torsoDist) / b.td),
      shrug: (g.vertTorso - b.vt) / b.td,
      tilt: Math.abs(g.tilt - (calib?.tilt0 ?? 0)),
    };
  }

  _applyBody(c, m, dt) {
    const b = c.body;
    b.maxSway = Math.max(b.maxSway, m.sway);
    b.maxLean = Math.max(b.maxLean, m.lean);
    b.maxShrug = Math.max(b.maxShrug, m.shrug);
    b.maxTilt = Math.max(b.maxTilt, m.tilt);
    if (m.sway > DC_CFG.sway_tolerance || m.lean > DC_CFG.lean_tolerance) b.swingSec += dt;
    if (m.shrug > DC_CFG.shrug_tolerance) b.shrugSec += dt;
    if (m.tilt > DC_CFG.shoulder_tilt_max) b.tiltSec += dt;
  }

  // ── Per-arm cycle ─────────────────────────────────────────────────────────

  _stepArm(side, a, g, calib, now, dt) {
    const arm = this._arms[side];
    const res = { done: [], top: false, liveKeys: [], progress: null };
    const m = armMetrics(a, g, calib);

    if (!m) {
      if (arm.state === 'UP' && arm.cycle) {
        if (arm.missingSince < 0) arm.missingSince = now;
        if (now - arm.missingSince >= DC_CFG.arm_missing_abort_sec) {
          const c = arm.cycle;
          c.closedBy = 'lost';
          c.endAt = now;
          this._arms[side] = newArm();
          res.done.push(c);
        }
      }
      return res;
    }
    arm.missingSince = -1;
    res.progress = m.progress;

    if (arm.state === 'WAIT_DOWN') {
      if (m.inBottom) arm.state = 'DOWN';
      return res;
    }

    if (arm.state === 'DOWN') {
      if (m.progress < DC_CFG.curl_start) return res;
      arm.state = 'UP';
      arm.cycle = newCycle(side, now, m.progress);
    }

    const c = arm.cycle;
    if (!c.reachedTop && now - c.startAt > DC_CFG.max_cycle_sec) {
      this._arms[side] = newArm();
      return res;
    }

    if (m.progress > c.peak) {
      c.peak = m.progress;
      c.valley = m.progress;
    } else if (m.progress < c.valley) {
      c.valley = m.progress;
    }

    if (!c.reachedTop && m.top) {
      c.reachedTop = true;
      c.topAt = now;
      res.top = true;
    }
    if (m.overUpper > 0) {
      c.overUpperSec += dt;
      c.maxOverUpper = Math.max(c.maxOverUpper, m.overUpper);
      res.liveKeys.push('dc_too_high');
    }
    c.maxElbowLift = Math.max(c.maxElbowLift, m.elbowLift);
    c.maxElbowFlare = Math.max(c.maxElbowFlare, m.elbowFlare);
    if (m.elbowLift > DC_CFG.elbow_lift_tolerance || m.elbowFlare > DC_CFG.elbow_flare_tolerance) {
      c.elbowSec += dt;
      res.liveKeys.push('dc_elbow_moving');
    }

    if (m.inBottom) {
      c.closedBy = 'bottom';
      c.endAt = now;
      arm.state = 'DOWN';
      arm.cycle = null;
      res.done.push(c);
      return res;
    }

    // Came down part-way, then started the next curl without extending.
    if (c.peak - c.valley >= DC_CFG.reversal_drop && m.progress - c.valley >= DC_CFG.reversal_rise) {
      c.closedBy = 'reversal';
      c.endAt = now;
      res.done.push(c);
      arm.cycle = newCycle(side, now, m.progress);
    }
    return res;
  }

  /**
   * Advance one frame.
   * @returns {{ attempts: object[], topSides: string[], liveKeys: string[],
   *             progress: {left:number|null, right:number|null} }}
   */
  update(g, calib, now) {
    const dt = this._lastNow < 0 ? 0 : Math.min(0.2, Math.max(0, now - this._lastNow));
    this._lastNow = now;

    const topSides = [];
    const liveKeys = new Set();
    const progress = { left: null, right: null };
    const done = [];
    for (const side of SIDES) {
      const r = this._stepArm(side, g[side], g, calib, now, dt);
      progress[side] = r.progress;
      if (r.top) topSides.push(side);
      r.liveKeys.forEach((k) => liveKeys.add(k));
      done.push(...r.done);
    }

    const upSides = SIDES.filter((s) => this._arms[s].state === 'UP' && this._arms[s].cycle);
    if (!upSides.length) {
      this._recordRest(g, now);
      this._base = null;
    } else {
      if (!this._base) this._base = this._pickBaseline(g, now);
      const body = this._bodyMetrics(g, calib);
      for (const s of upSides) this._applyBody(this._arms[s].cycle, body, dt);
      if (body.sway > DC_CFG.sway_tolerance || body.lean > DC_CFG.lean_tolerance) liveKeys.add('dc_swinging');
      if (body.shrug > DC_CFG.shrug_tolerance) liveKeys.add('dc_shrugging');
      if (body.tilt > DC_CFG.shoulder_tilt_max) liveKeys.add('dc_shoulders_uneven');
    }

    const attempts = [];
    for (const c of done) {
      const a = this._onCycleDone(c, calib, now);
      if (a) attempts.push(a);
    }

    const p = this._pending;
    if (p && p.left && p.right) {
      const a = this._resolvePending(calib);
      if (a) attempts.push(a);
    } else if (p && now - p.firstAt > DC_CFG.pair_window_sec) {
      this._attachPartnerAsPartial(now);
      const a = this._resolvePending(calib);
      if (a) attempts.push(a);
    }

    this.live = {
      left: this._arms.left.state,
      right: this._arms.right.state,
      progress,
      liveKeys: [...liveKeys],
    };
    return { attempts, topSides, liveKeys: [...liveKeys], progress };
  }

  // ── Attempts ──────────────────────────────────────────────────────────────

  _onCycleDone(c, calib, now) {
    if (c.consumed) return null;
    if (this.mode === 'alternate') return this._resolve([c], calib, 'alternate');

    let flushed = null;
    if (this._pending?.[c.side]) flushed = this._resolvePending(calib);
    if (!this._pending) this._pending = { left: null, right: null, firstAt: now };
    this._pending[c.side] = c;
    return flushed;
  }

  /** 'both' mode: the partner arm is still mid-curl after the pair window. */
  _attachPartnerAsPartial(now) {
    const p = this._pending;
    const other = p.left ? 'right' : 'left';
    const otherArm = this._arms[other];
    if (otherArm.state === 'UP' && otherArm.cycle && !otherArm.cycle.consumed) {
      otherArm.cycle.consumed = true;
      p[other] = { ...otherArm.cycle, body: { ...otherArm.cycle.body }, partial: true, endAt: now };
    }
  }

  _resolvePending(calib) {
    const p = this._pending;
    this._pending = null;
    return this._resolve([p.left, p.right].filter(Boolean), calib, 'both');
  }

  _armResult(c, calib) {
    const topAt = topProgressAt(c.side, calib);
    const reach = c.reachedTop ? 1 : clamp01(c.peak / Math.max(topAt, 0.1));
    const lowered = c.closedBy === 'bottom';
    const ext = lowered ? 1 : clamp01(1 - c.valley);
    const share = clamp01(DC_CFG.rom_extension_share);
    const overshoot = ramp(c.maxOverUpper, 0, DC_CFG.too_high_zero_at);
    const liftScore = 1 - ramp(c.maxElbowLift, DC_CFG.elbow_lift_tolerance, DC_CFG.elbow_lift_zero_at);
    const flareScore = 1 - ramp(c.maxElbowFlare, DC_CFG.elbow_flare_tolerance, DC_CFG.elbow_flare_zero_at);
    const lost = c.closedBy === 'lost';
    return {
      side: c.side,
      reachedTop: c.reachedTop && !lost,
      closedBy: c.closedBy,
      lost,
      partial: !!c.partial,
      notLowered: c.closedBy === 'reversal',
      full: c.reachedTop && lowered && !c.partial,
      peak: round2(c.peak),
      romPct: Math.round(clamp01(c.peak) * 100),
      extensionPct: Math.round(ext * 100),
      romScore: Math.max(0, 100 * ((1 - share) * reach + share * ext) - 50 * overshoot),
      tooHigh: c.overUpperSec >= DC_CFG.flag_min_sec,
      maxOverUpper: round2(c.maxOverUpper),
      elbowMoving: c.elbowSec >= DC_CFG.flag_min_sec,
      maxElbowLift: round2(c.maxElbowLift),
      maxElbowFlare: round2(c.maxElbowFlare),
      elbowScore: 100 * (liftScore + flareScore) / 2,
      startAt: c.startAt,
      topAt: c.topAt,
      endAt: c.endAt,
    };
  }

  _symmetry(arms, L, R, both) {
    const hScore = (d) => 1 - ramp(d, 0, DC_CFG.symmetry_zero_at);
    if (both) {
      if (!L || !R) return { pct: 0, heightDiff: null, timingDiff: null };
      const heightDiff = Math.abs(Math.min(1, L.peak) - Math.min(1, R.peak));
      const timingDiff = L.topAt >= 0 && R.topAt >= 0
        ? Math.abs(L.topAt - R.topAt)
        : Math.abs(L.endAt - R.endAt);
      const tScore = 1 - ramp(timingDiff, DC_CFG.symmetry_timing_max_sec, DC_CFG.symmetry_timing_zero_at_sec);
      const tShare = clamp01(DC_CFG.symmetry_timing_share);
      return { pct: 100 * ((1 - tShare) * hScore(heightDiff) + tShare * tScore), heightDiff, timingDiff };
    }
    const a = arms[0];
    const otherPeak = this._lastPeak[OTHER[a.side]];
    if (otherPeak == null) return { pct: null, heightDiff: null, timingDiff: null };
    const heightDiff = Math.abs(Math.min(1, a.peak) - Math.min(1, otherPeak));
    return { pct: 100 * hScore(heightDiff), heightDiff, timingDiff: null };
  }

  _resolve(cycles, calib, mode) {
    const strong = cycles.some((c) => c.reachedTop || c.peak >= DC_CFG.attempt_min_progress);
    if (!strong) return null;

    const both = mode === 'both';
    const arms = cycles.map((c) => this._armResult(c, calib));
    const L = arms.find((a) => a.side === 'left') || null;
    const R = arms.find((a) => a.side === 'right') || null;
    const counted = both ? !!(L && R && L.full && R.full) : arms[0].full;

    const issues = new Set();
    if (!counted) {
      const incomplete = both
        ? arms.length < 2 || arms.some((a) => a.lost || a.partial) || (arms.some((a) => a.full) && !arms.every((a) => a.full))
        : arms.some((a) => a.lost);
      if (incomplete) issues.add('dc_incomplete');
    }
    if (arms.some((a) => !a.lost && !a.partial && !a.reachedTop)) issues.add('dc_not_high_enough');
    if (arms.some((a) => a.notLowered)) issues.add('dc_not_lowering');
    if (arms.some((a) => a.tooHigh)) issues.add('dc_too_high');
    if (arms.some((a) => a.elbowMoving)) issues.add('dc_elbow_moving');

    const body = mergeBodies(cycles);
    if (body.swingSec >= DC_CFG.flag_min_sec) issues.add('dc_swinging');
    if (body.shrugSec >= DC_CFG.flag_min_sec) issues.add('dc_shrugging');
    if (body.tiltSec >= DC_CFG.flag_min_sec) issues.add('dc_shoulders_uneven');

    // ── Component scores (0–100) ────────────────────────────────────────────
    const pairAvg = (k) => (both ? ((L?.[k] ?? 0) + (R?.[k] ?? 0)) / 2 : arms[0][k]);
    const romScore = pairAvg('romScore');
    const romPct = pairAvg('romPct');
    const extensionPct = pairAvg('extensionPct');
    const elbowPct = Math.min(...arms.map((a) => a.elbowScore));
    const sym = this._symmetry(arms, L, R, both);
    const swayS = 1 - ramp(body.maxSway, DC_CFG.sway_tolerance, DC_CFG.sway_zero_at);
    const leanS = 1 - ramp(body.maxLean, DC_CFG.lean_tolerance, DC_CFG.lean_zero_at);
    const shrugS = 1 - ramp(body.maxShrug, DC_CFG.shrug_tolerance, DC_CFG.shrug_zero_at);
    const tiltS = 1 - ramp(body.maxTilt, DC_CFG.shoulder_tilt_max, DC_CFG.shoulder_tilt_zero_at);
    const stabilityPct = 100 * (swayS + leanS + shrugS + tiltS) / 4;

    const W = DC_SCORE_WEIGHTS;
    const parts = [
      [W.rom, romScore],
      [W.elbow, elbowPct],
      [W.symmetry, sym.pct],
      [W.stability, stabilityPct],
    ].filter(([w, v]) => v != null && w > 0);
    const wSum = parts.reduce((s, [w]) => s + w, 0) || 1;
    const score = Math.round(parts.reduce((s, [w, v]) => s + w * v, 0) / wSum);

    const keys = DC_ISSUE_PRIORITY.filter((k) => issues.has(k));
    const clean = counted
      && score >= DC_CFG.clean_score_min
      && !issues.has('dc_too_high')
      && !issues.has('dc_incomplete')
      && !issues.has('dc_not_lowering');

    if (counted) {
      this.count += 1;
      this.setCount += 1;
    }
    for (const a of arms) if (!a.lost && !a.partial) this._lastPeak[a.side] = a.peak;

    const startAt = Math.min(...arms.map((a) => a.startAt));
    const endAt = Math.max(...arms.map((a) => a.endAt));
    const result = {
      attempt: this.attempts.length + 1,
      index: counted ? this.count : null,
      set: this.setIndex,
      repInSet: counted ? this.setCount : null,
      mode,
      side: both ? 'both' : arms[0].side,
      counted,
      clean,
      score,
      components: {
        rom: Math.round(romScore),
        elbow: Math.round(elbowPct),
        symmetry: sym.pct == null ? null : Math.round(sym.pct),
        stability: Math.round(stabilityPct),
      },
      romPct: Math.round(romPct),
      extensionPct: Math.round(extensionPct),
      symmetryPct: sym.pct == null ? null : Math.round(sym.pct),
      elbowPct: Math.round(elbowPct),
      stabilityPct: Math.round(stabilityPct),
      issues: keys,
      primaryIssue: selectPrimaryIssue(keys),
      body: {
        sway: round2(body.maxSway),
        lean: round2(body.maxLean),
        shrug: round2(body.maxShrug),
        tilt: round2(body.maxTilt),
      },
      symmetryDiff: sym.heightDiff == null ? null : round2(sym.heightDiff),
      timingDiffSec: sym.timingDiff == null ? null : round2(sym.timingDiff),
      left: L,
      right: R,
      durationSec: round2(Math.max(0, endAt - startAt)),
      finishedAt: endAt,
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
export function summarizeDumbbellCurl(attempts, {
  activeSec = 0,
  sessionSec = 0,
  setsCompleted = 0,
  targetSets = 0,
  targetReps = 0,
  stoppedEarly = false,
  mode = 'both',
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
  const avgOf = (k) => r(avg(list.map((a) => a[k]).filter((v) => v != null)));
  const formScore = avgOf('score');
  const accuracy = n ? Math.round((clean.length / n) * 100) : null;
  const rom = avgOf('romPct');

  return {
    attempts: n,
    repsCompleted: counted.length,
    cleanReps: clean.length,
    setsCompleted,
    targetSets,
    targetReps,
    stoppedEarly,
    mode,
    formScore,
    accuracy,
    romPct: rom,
    romBest: best ? { attempt: best.attempt, rep: best.index, romPct: best.romPct } : null,
    romWorst: worst ? { attempt: worst.attempt, rep: worst.index, romPct: worst.romPct } : null,
    extensionPct: avgOf('extensionPct'),
    symmetryPct: avgOf('symmetryPct'),
    elbowPct: avgOf('elbowPct'),
    stabilityPct: avgOf('stabilityPct'),
    activeSec: Math.round(activeSec),
    sessionSec: Math.round(sessionSec),
    avgRepSec: counted.length ? Math.round(avg(counted.map((a) => a.durationSec)) * 10) / 10 : null,
    mistakes: {
      notHighEnough: has('dc_not_high_enough'),
      tooHigh: has('dc_too_high'),
      elbowMoving: has('dc_elbow_moving'),
      notLowering: has('dc_not_lowering'),
      swinging: has('dc_swinging'),
      shrugging: has('dc_shrugging'),
      shouldersUneven: has('dc_shoulders_uneven'),
      incomplete: has('dc_incomplete'),
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
      extensionPct: a.extensionPct,
      issues: a.issues,
    })),
    summaryLine: n
      ? `Form Score ${formScore}/100, Accuracy ${accuracy}%, Range of Motion ${rom}%`
      : 'No reps recorded',
  };
}
