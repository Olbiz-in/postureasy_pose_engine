// Squat rep tracker — ported from the battle-tested fitness_posture engine.
// Counts reps from hip↔knee vertical gap dynamics, tracks depth, left/right
// symmetry, and per-rep speed classification. Unit-agnostic: works directly in
// MediaPipe normalized coordinates.

import { CFG } from './config';
import { nowSec } from '../../core/landmarks';

export class SquatRepTracker {
  static ENTER_FRAC = 0.40;
  static FULL_FRAC = 0.25;
  static RETURN_FRAC = 0.92;
  static MIN_STAND_GAP = 0.05;
  static MIN_DOWN_SEC = 0.18;
  static MAX_LR_ASYM_FRAC = 0.45;
  static TOO_DEEP_GAP = -0.02;

  static DESCEND_FAST_MAX = 2.0;
  static DESCEND_SLOW_MIN = 4.0;
  static ASCEND_FAST_MAX = 2.0;
  static ASCEND_SLOW_MIN = 4.0;
  static REP_FAST_MAX = 4.0;
  static REP_SLOW_MIN = 7.0;
  static REP_PERFECT_MIN = 4.0;
  static REP_PERFECT_MAX = 7.0;

  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this._inSquat = false;
    this._reachedFull = false;
    this._tooDeep = false;
    this._lastCountT = -999;
    this._lastPartialT = -999;

    this._standGap = 0;
    this._lastRawGap = 0;
    this._depthPct = 0;
    this._downStartT = -999;
    this._repMinGap = 999;
    this._repMaxLrAsym = 0;
    this.repMetrics = [];
    this._fixedStartLineY = null;
    this._timeStartT = -1;
    this._bottomT = -1;
    this._lastRepTotalSec = 0;
  }

  // ── calibration / depth ────────────────────────────────────────────────────
  get isCalibrated() { return this._standGap >= SquatRepTracker.MIN_STAND_GAP; }
  get calibrationPct() {
    if (this._standGap <= 0) return 0;
    return Math.min(100, Math.round((this._standGap / SquatRepTracker.MIN_STAND_GAP) * 100));
  }
  get depthPct() { return this._depthPct; }
  get tooDeep() { return this._tooDeep; }
  get inSquat() { return this._inSquat; }
  get reachedFull() { return this._reachedFull; }
  get fixedStartLineY() { return this._fixedStartLineY; }

  justCounted() { return nowSec() - this._lastCountT < 1.0; }
  allDone() {
    const g = CFG.squat_max_reps;
    return g > 0 && this.count >= g;
  }

  _legsBalanced(leftGap, rightGap) {
    if (leftGap == null || rightGap == null) return true;
    const denom = Math.max(this._standGap, SquatRepTracker.MIN_STAND_GAP);
    return Math.abs(leftGap - rightGap) / denom <= SquatRepTracker.MAX_LR_ASYM_FRAC;
  }

  _classifySpeed(descendSec, ascendSec, totalSec, atBottom) {
    const R = SquatRepTracker;
    if (totalSec < R.REP_FAST_MAX) return 'rep_fast';
    if (totalSec > R.REP_SLOW_MIN) return 'rep_slow';
    if (atBottom && descendSec > 0 && descendSec < R.DESCEND_FAST_MAX) return 'descend_fast';
    if (descendSec > R.DESCEND_SLOW_MIN) return 'descend_slow';
    if (atBottom && ascendSec > 0 && ascendSec < R.ASCEND_FAST_MAX) return 'ascend_fast';
    if (ascendSec > R.ASCEND_SLOW_MIN) return 'ascend_slow';
    if (totalSec >= R.REP_PERFECT_MIN && totalSec <= R.REP_PERFECT_MAX) return 'pace_perfect';
    return null;
  }

  /**
   * Advance the tracker by one frame.
   * All arguments are in normalized (0..1) image coordinates.
   * @returns {object|null} rep metrics for a rep that JUST completed, else null.
   */
  update(hipY, kneeY, footY, shoulderW, leftGap, rightGap) {
    const rawGap = kneeY - hipY;
    this._lastRawGap = rawGap;
    this._tooDeep = rawGap < SquatRepTracker.TOO_DEEP_GAP;

    if (rawGap > this._standGap) {
      this._standGap = rawGap;
      if (this._fixedStartLineY === null) {
        const ratio = Math.max(0.05, Math.min(0.95, CFG.squat_time_line_ratio));
        const anchor = (CFG.squat_time_line_anchor || 'knee').trim().toLowerCase();
        if (anchor === 'foot' && footY != null) {
          const base = Math.max(1e-6, footY - kneeY);
          this._fixedStartLineY = Math.max(0, Math.min(1, footY - base * ratio));
        } else {
          const base = Math.max(1e-6, kneeY - hipY);
          this._fixedStartLineY = Math.max(0, Math.min(1, kneeY - base * ratio));
        }
      }
    }

    if (!this.isCalibrated) { this._depthPct = 0; return null; }

    const sg = this._standGap;
    const enterThresh = sg * SquatRepTracker.ENTER_FRAC;
    const fullThresh = sg * SquatRepTracker.FULL_FRAC;
    const returnThresh = sg * SquatRepTracker.RETURN_FRAC;

    this._depthPct = Math.max(0, Math.min(1, 1 - rawGap / sg));

    if (leftGap != null && rightGap != null) {
      this._repMaxLrAsym = Math.max(
        this._repMaxLrAsym,
        Math.abs(leftGap - rightGap) / Math.max(sg, SquatRepTracker.MIN_STAND_GAP),
      );
    }

    const now = nowSec();
    let completedRep = null;

    if (!this._inSquat) {
      if (rawGap <= enterThresh && this._legsBalanced(leftGap, rightGap)) {
        this._inSquat = true;
        this._reachedFull = false;
        this._downStartT = now;
        this._timeStartT = -1;
        this._bottomT = -1;
        this._repMinGap = rawGap;
        this._repMaxLrAsym = 0;
      }
    } else {
      if (this._timeStartT < 0 && this._fixedStartLineY !== null && hipY >= this._fixedStartLineY) {
        this._timeStartT = now;
      }
      this._repMinGap = Math.min(this._repMinGap, rawGap);
      if (rawGap <= fullThresh || rawGap <= 0) {
        this._reachedFull = true;
        if (this._bottomT < 0) this._bottomT = now;
      }

      if (rawGap >= returnThresh) {
        if ((now - this._downStartT) < SquatRepTracker.MIN_DOWN_SEC || !this._legsBalanced(leftGap, rightGap)) {
          this._resetRepState();
          return null;
        }

        const g = CFG.squat_max_reps;
        if (g <= 0 || this.count < g) {
          this.count++;
          this._lastCountT = now;
          const t0 = this._timeStartT >= 0 ? this._timeStartT : this._downStartT;
          const repActiveSec = Math.max(0, now - t0);
          const totalRepSec = Math.max(0, now - this._downStartT);
          this._lastRepTotalSec = totalRepSec;
          const bottomT = this._bottomT >= 0 ? this._bottomT : now;
          const descendSec = Math.max(0, bottomT - this._downStartT);
          const ascendSec = Math.max(0, now - bottomT);
          const speedCue = this._classifySpeed(descendSec, ascendSec, totalRepSec, true);
          if (!this._reachedFull) this._lastPartialT = now;

          const repMinGap = this._repMinGap < 900 ? this._repMinGap : rawGap;
          const repDepthPeak = Math.max(0, Math.min(1, 1 - repMinGap / Math.max(sg, 1e-6)));
          completedRep = {
            rep_index: this.count,
            active_time_sec: +repActiveSec.toFixed(3),
            total_rep_sec: +totalRepSec.toFixed(3),
            descend_sec: +descendSec.toFixed(3),
            ascend_sec: +ascendSec.toFixed(3),
            speed_cue: speedCue || 'ok',
            peak_depth_pct: +repDepthPeak.toFixed(4),
            full_depth: this._reachedFull,
            too_deep: repMinGap < SquatRepTracker.TOO_DEEP_GAP,
            left_right_asym: +this._repMaxLrAsym.toFixed(5),
          };
          this.repMetrics.push(completedRep);
        }

        this._resetRepState();
      }
    }
    return completedRep;
  }

  _resetRepState() {
    this._inSquat = false;
    this._reachedFull = false;
    this._repMinGap = 999;
    this._repMaxLrAsym = 0;
    this._timeStartT = -1;
    this._bottomT = -1;
  }
}
