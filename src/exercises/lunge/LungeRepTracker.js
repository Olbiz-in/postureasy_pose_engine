// Rep counting + per-rep form scoring for the lunge (front and side view).
//
// One movement state machine drives both views; only the per-frame form
// measurements differ. The input is a depth signal (fraction of the calibrated
// standing hip-to-ankle height) plus the view's measurements.
//
//   STANDING    depth < depth_return; leaves when depth ≥ depth_enter
//   DESCENDING  going down, has not yet reached depth_count
//   BOTTOM      reached depth_count (the repetition is now "valid")
//   ASCENDING   depth fell turn_drop below the peak; a rep is finished (and
//               counted) only once depth is back under depth_return
//
// A rep is counted only if it reached depth_count, lasted min_rep_sec, did not
// follow another count within min_gap_sec and (side view) the front knee really
// flexed. Anything else is an "incomplete attempt": recorded, never counted.
// A bounce inside ASCENDING returns to the lunge instead of ending the rep, so
// a single movement can never be counted twice.
//
// Per-frame faults use hysteresis latches; a rep only carries an issue if the
// fault stayed latched for fault_min_sec, so one noisy frame never flags.

import {
  LUNGE_CFG, LUNGE_SCORE_WEIGHTS, LUNGE_ISSUE_PRIORITY, LUNGE_ISSUE_GROUP,
} from './config.js';
import { clamp, clamp01, ramp, round2, firstByPriority } from '../common/math.js';

export const LUNGE_STATE = {
  STANDING: 'standing',
  DESCENDING: 'descending',
  BOTTOM: 'bottom',
  ASCENDING: 'ascending',
};

const SIDES = ['left', 'right'];
const other = (side) => (side === 'left' ? 'right' : 'left');

/** Faults evaluated every frame while a rep is in progress (config read live). */
function frameRules(view) {
  const C = LUNGE_CFG;
  if (view === 'side') {
    return [
      { key: 'lunge_torso_lean', get: (m) => m.leanDeg, on: C.torso_lean_max_deg },
    ];
  }
  const abs = (v) => (v == null ? null : Math.abs(v));
  return [
    { key: 'lunge_knee_collapse_left', get: (m) => m.valgusLeft, on: C.knee_valgus_max },
    { key: 'lunge_knee_collapse_right', get: (m) => m.valgusRight, on: C.knee_valgus_max },
    { key: 'lunge_hip_shift', get: (m) => abs(m.hipShift), on: C.hip_shift_max },
    { key: 'lunge_pelvis_tilt', get: (m) => m.pelvisTilt, on: C.pelvis_tilt_max },
    { key: 'lunge_trunk_sway', get: (m) => abs(m.trunkSway), on: C.trunk_sway_max },
  ];
}

function newRep(now, depth) {
  return {
    startAt: now,
    peak: depth,
    peakAt: now,
    low: depth,
    reachedCount: false,
    leg: null,
    faultSec: {},
    maxVal: {},
    minKnee: { left: null, right: null },
    zz: { dir: 0, ext: depth, reversals: 0 },
  };
}

export class LungeRepTracker {
  constructor(view = 'front') {
    this.view = view;
    this.reset();
  }

  reset() {
    this.count = 0;
    this.attempts = [];
    this.lastRep = null;
    this.lastAttempt = null;
    this.legCounts = { left: 0, right: 0 };
    this.state = LUNGE_STATE.STANDING;
    this.depth = 0;
    this._rep = null;
    this._needStand = false;
    this._lastCountAt = -Infinity;
    this._byLeg = { left: null, right: null };
    this._lostSince = -1;
    this._lastNow = -1;
    this._latch = {};
  }

  /** Clear in-progress movement state but keep counts, attempts and leg history (recalibration). */
  rearm() {
    this.state = LUNGE_STATE.STANDING;
    this._rep = null;
    this._needStand = false;
    this._latch = {};
    this._lostSince = -1;
    this._lastNow = -1;
  }

  get inProgress() {
    return this._rep != null;
  }

  /** Front leg locked for the current rep ('left' | 'right' | null). */
  get activeLeg() {
    return this._rep?.leg ?? null;
  }

  /** Drop the rep in progress without scoring (recalibration, turned away…). */
  abort(now, reason = 'aborted') {
    if (!this._rep) return null;
    return this._finish(now, reason);
  }

  /**
   * Advance one frame.
   * @param {{ depth: number|null, m: object|null, vote: string|null }} s
   * @returns {{ counted: object|null, incomplete: object|null, liveKeys: string[] }}
   */
  step(s, now) {
    const C = LUNGE_CFG;
    const dt = this._lastNow < 0 ? 0 : clamp(now - this._lastNow, 0, 0.25);
    this._lastNow = now;
    const out = { counted: null, incomplete: null, liveKeys: [] };

    // No usable pose: change nothing, invent nothing. A rep that stays unmeasured
    // too long is dropped as incomplete.
    if (s.depth == null) {
      if (this._rep) {
        if (this._lostSince < 0) this._lostSince = now;
        if (now - this._lostSince >= C.person_lost_sec) {
          out.incomplete = this._finish(now, 'lost');
        }
      }
      return out;
    }
    this._lostSince = -1;

    const d = s.depth;
    this.depth = d;

    if (this._needStand) {
      if (d > C.depth_return) return out;
      this._needStand = false;
    }

    if (!this._rep) {
      if (d < C.depth_enter) return out;
      this._rep = newRep(now, d);
      this._latch = {};
      this.state = LUNGE_STATE.DESCENDING;
    }

    const r = this._rep;
    if (d > r.peak) {
      r.peak = d;
      r.peakAt = now;
    }
    this._zigzag(r, d);
    if (!r.leg && d >= C.lock_depth && s.vote) r.leg = s.vote;
    out.liveKeys = this._measure(r, s.m, dt);

    if (now - r.startAt > C.max_rep_sec) {
      out.incomplete = this._finish(now, 'timeout');
      return out;
    }

    switch (this.state) {
      case LUNGE_STATE.DESCENDING:
        if (d >= C.depth_count) {
          r.reachedCount = true;
          this.state = LUNGE_STATE.BOTTOM;
        } else if (d <= r.peak - C.turn_drop) {
          this._turn(r, d);
        }
        break;
      case LUNGE_STATE.BOTTOM:
        if (d <= r.peak - C.turn_drop) this._turn(r, d);
        break;
      case LUNGE_STATE.ASCENDING:
        if (d <= C.depth_return) {
          const res = this._finish(now, null);
          if (res.counted) out.counted = res;
          else out.incomplete = res;
        } else if (d >= r.low + C.turn_drop) {
          // Bounce / re-descent: same movement, never a second rep.
          this.state = r.reachedCount ? LUNGE_STATE.BOTTOM : LUNGE_STATE.DESCENDING;
          if (d > r.peak) { r.peak = d; r.peakAt = now; }
        } else {
          r.low = Math.min(r.low, d);
        }
        break;
      default:
        break;
    }
    return out;
  }

  _turn(r, d) {
    this.state = LUNGE_STATE.ASCENDING;
    r.low = d;
  }

  /** Counts direction reversals of the depth signal that exceed wobble_amp. */
  _zigzag(r, d) {
    const z = r.zz;
    const amp = LUNGE_CFG.wobble_amp;
    if (z.dir === 0) {
      if (Math.abs(d - z.ext) >= amp) {
        z.dir = d > z.ext ? 1 : -1;
        z.ext = d;
      }
      return;
    }
    if (z.dir === 1) {
      if (d > z.ext) z.ext = d;
      else if (z.ext - d >= amp) { z.reversals += 1; z.dir = -1; z.ext = d; }
    } else if (d < z.ext) z.ext = d;
    else if (d - z.ext >= amp) { z.reversals += 1; z.dir = 1; z.ext = d; }
  }

  /** Update fault latches / per-rep maxima. @returns {string[]} faults latched this frame */
  _measure(r, m, dt) {
    if (!m) return [];
    const C = LUNGE_CFG;
    const live = [];
    for (const rule of frameRules(this.view)) {
      const v = rule.get(m);
      if (v == null || !Number.isFinite(v)) continue;
      r.maxVal[rule.key] = Math.max(r.maxVal[rule.key] ?? -Infinity, v);
      if (!this._latch[rule.key] && v > rule.on) this._latch[rule.key] = true;
      else if (this._latch[rule.key] && v < rule.on * C.hysteresis) this._latch[rule.key] = false;
      if (this._latch[rule.key]) {
        r.faultSec[rule.key] = (r.faultSec[rule.key] ?? 0) + dt;
        live.push(rule.key);
      }
    }
    if (this.view === 'side' && m.kneeDeg) {
      for (const s of SIDES) {
        const k = m.kneeDeg[s];
        if (k != null) r.minKnee[s] = r.minKnee[s] == null ? k : Math.min(r.minKnee[s], k);
      }
    }
    return live;
  }

  _finish(now, forcedReason) {
    const C = LUNGE_CFG;
    const r = this._rep;
    this._rep = null;
    this._latch = {};
    this.state = LUNGE_STATE.STANDING;

    const dur = now - r.startAt;
    let reason = forcedReason;
    if (!reason) {
      if (!r.reachedCount) reason = 'too_shallow';
      else if (dur < C.min_rep_sec) reason = 'too_short';
      else if (now - this._lastCountAt < C.min_gap_sec) reason = 'debounced';
      else if (this.view === 'side' && !this._kneeFlexed(r)) reason = 'no_knee_bend';
    }
    if (forcedReason) this._needStand = true;

    const attempt = this._result(r, now, reason);
    this.attempts.push(attempt);
    this.lastAttempt = attempt;
    if (attempt.counted) {
      this.count += 1;
      attempt.index = this.count;
      this.lastRep = attempt;
      this._lastCountAt = now;
      if (attempt.frontLeg) {
        this.legCounts[attempt.frontLeg] += 1;
        this._byLeg[attempt.frontLeg] = { peak: r.peak };
      }
    }
    return attempt;
  }

  /** Side view veto: the front knee must have actually bent (if it could be measured). */
  _kneeFlexed(r) {
    const vals = r.leg ? [r.minKnee[r.leg]] : [r.minKnee.left, r.minKnee.right];
    const measured = vals.filter((v) => v != null);
    // Unknown front leg with only one knee measurable: that knee may be the rear
    // one, so it proves nothing — do not veto on it.
    if (!measured.length || measured.length < vals.length) return true;
    return Math.min(...measured) <= LUNGE_CFG.side_knee_count_max_deg;
  }

  _result(r, now, reason) {
    const C = LUNGE_CFG;
    const counted = !reason;
    const view = this.view;
    const dur = now - r.startAt;
    const descentSec = Math.max(0, r.peakAt - r.startAt);
    const ascentSec = Math.max(0, now - r.peakAt);
    const romPct = Math.round(100 * clamp01(r.peak / C.depth_full));
    const base = {
      attempt: this.attempts.length + 1,
      view,
      counted,
      incompleteReason: reason || null,
      frontLeg: r.leg,
      peakDepth: round2(r.peak),
      romPct,
      depthPct: romPct,
      durationSec: round2(dur),
      descentSec: round2(descentSec),
      ascentSec: round2(ascentSec),
      finishedAt: now,
    };
    if (!counted) {
      return {
        ...base, index: null, clean: false, score: null, issues: [], groups: [], primaryIssue: null,
        components: {}, metrics: {}, symmetryPct: null,
      };
    }

    const maxOf = (key) => (r.maxVal[key] == null ? null : Math.max(0, r.maxVal[key]));
    const sec = (key) => r.faultSec[key] ?? 0;
    const issues = new Set();
    for (const key of Object.keys(r.faultSec)) if (sec(key) >= C.fault_min_sec) issues.add(key);
    if (r.peak < C.depth_target) issues.add('lunge_shallow');
    if (descentSec < C.descent_min_sec) issues.add('lunge_too_fast');
    const extraReversals = Math.max(0, r.zz.reversals - 1);
    if (extraReversals >= C.wobble_max_reversals) issues.add('lunge_unsteady');

    // Left/right consistency: compare with the last rep led by the other leg.
    let symDiff = null;
    if (r.leg && this._byLeg[other(r.leg)]) {
      const q = this._byLeg[other(r.leg)].peak;
      symDiff = Math.abs(r.peak - q) / Math.max(r.peak, q, 1e-6);
      if (view === 'front' && symDiff > C.asym_max) issues.add('lunge_asymmetry');
    }
    const symmetryPct = symDiff == null ? null : Math.round(100 * (1 - ramp(symDiff, 0, C.asym_zero_at)));

    // ── Component scores (0–100); null = not measured, excluded from the score ──
    const fromRamp = (v, tol, zero) => (v == null ? null : 100 * (1 - ramp(v, tol, zero)));
    const wobbleScore = 100 * (1 - clamp01(extraReversals / (C.wobble_max_reversals + 2)));
    const c = {
      depth: 100 * clamp01(r.peak / C.depth_target),
      tempo: 100 * clamp01(descentSec / C.descent_min_sec),
    };
    let metrics;
    if (view === 'front') {
      const valgus = [maxOf('lunge_knee_collapse_left'), maxOf('lunge_knee_collapse_right')].filter((v) => v != null);
      c.knee = valgus.length ? fromRamp(Math.max(...valgus), C.knee_valgus_max, C.knee_valgus_zero_at) : null;
      c.hip = fromRamp(maxOf('lunge_hip_shift'), C.hip_shift_max, C.hip_shift_zero_at);
      c.pelvis = fromRamp(maxOf('lunge_pelvis_tilt'), C.pelvis_tilt_max, C.pelvis_tilt_zero_at);
      const sway = fromRamp(maxOf('lunge_trunk_sway'), C.trunk_sway_max, C.trunk_sway_zero_at);
      c.balance = sway == null ? wobbleScore : (sway + wobbleScore) / 2;
      c.symmetry = symmetryPct;
      metrics = {
        kneeValgusLeft: maxOf('lunge_knee_collapse_left') == null ? null : round2(maxOf('lunge_knee_collapse_left')),
        kneeValgusRight: maxOf('lunge_knee_collapse_right') == null ? null : round2(maxOf('lunge_knee_collapse_right')),
        hipShift: maxOf('lunge_hip_shift') == null ? null : round2(maxOf('lunge_hip_shift')),
        pelvisTilt: maxOf('lunge_pelvis_tilt') == null ? null : round2(maxOf('lunge_pelvis_tilt')),
        trunkSway: maxOf('lunge_trunk_sway') == null ? null : round2(maxOf('lunge_trunk_sway')),
      };
    } else {
      const leg = r.leg;
      const frontKnee = leg ? r.minKnee[leg] : null;
      const rearKnee = leg ? r.minKnee[other(leg)] : null;
      c.kneeFlex = frontKnee == null ? null : fromRamp(frontKnee, C.front_knee_good_deg, C.front_knee_zero_deg);
      c.torso = fromRamp(maxOf('lunge_torso_lean'), C.torso_lean_max_deg, C.torso_lean_zero_deg);
      c.balance = wobbleScore;
      metrics = {
        frontKneeDeg: frontKnee == null ? null : Math.round(frontKnee),
        rearKneeDeg: rearKnee == null ? null : Math.round(rearKnee),
        torsoLeanDeg: maxOf('lunge_torso_lean') == null ? null : Math.round(maxOf('lunge_torso_lean')),
      };
    }

    const W = LUNGE_SCORE_WEIGHTS[view];
    let num = 0;
    let den = 0;
    const components = {};
    for (const [key, w] of Object.entries(W)) {
      const v = c[key];
      if (v == null || !(w > 0)) { components[key] = null; continue; }
      components[key] = Math.round(v);
      num += w * v;
      den += w;
    }
    const score = den ? Math.round(num / den) : 0;

    const keys = LUNGE_ISSUE_PRIORITY.filter((k) => issues.has(k));
    const groups = [...new Set(keys.map((k) => LUNGE_ISSUE_GROUP[k]).filter(Boolean))];
    return {
      ...base,
      index: null, // assigned by _finish
      clean: score >= C.clean_score_min && keys.length === 0,
      score,
      components,
      metrics,
      symmetryPct,
      issues: keys,
      groups,
      primaryIssue: firstByPriority(keys, LUNGE_ISSUE_PRIORITY),
    };
  }
}
