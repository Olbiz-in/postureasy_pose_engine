// ─── SquatTracker.js ──────────────────────────────────────────────────────────
// Direct JS port of Python SquatRepTracker class.
// Uses performance.now()/1000 for all timing.

import { CFG, nowSec } from './config.js';

// ---------------------------------------------------------------------------
// SquatRepVoiceGate — only speak after same mistake on 2 consecutive reps
// ---------------------------------------------------------------------------
export class SquatRepVoiceGate {
  constructor() {
    this._streak = {};
    this._lastRepSeen = 0;
  }

  reset() {
    this._streak = {};
    this._lastRepSeen = 0;
  }

  onRepCompleted(repCount, mistakeKeys) {
    if (repCount <= this._lastRepSeen) return [];
    this._lastRepSeen = repCount;
    const present = new Set(mistakeKeys);

    for (const key of Object.keys(this._streak)) {
      if (!present.has(key)) delete this._streak[key];
    }

    const toSpeak = [];
    for (const key of mistakeKeys) {
      const streak = (this._streak[key] || 0) + 1;
      if (streak >= 2) {
        toSpeak.push(key);
        this._streak[key] = 0;
      } else {
        this._streak[key] = streak;
      }
    }
    return toSpeak;
  }
}

// ---------------------------------------------------------------------------
// ViolationTracker — per-key onset timer for sustained-cue logic
// ---------------------------------------------------------------------------
export class ViolationTracker {
  constructor() {
    this._onset = {};
  }

  update(activeKeys) {
    const now = nowSec();
    for (const k of Object.keys(this._onset)) {
      if (!activeKeys.has(k)) delete this._onset[k];
    }
    for (const k of activeKeys) {
      if (!(k in this._onset)) this._onset[k] = now;
    }
  }

  getSustained(minSec) {
    const now = nowSec();
    return new Set(
      Object.entries(this._onset)
        .filter(([, t]) => now - t >= minSec)
        .map(([k]) => k)
    );
  }

  reset() {
    this._onset = {};
  }
}

// ---------------------------------------------------------------------------
// SquatRepTracker
// ---------------------------------------------------------------------------
export class SquatRepTracker {
  static ENTER_FRAC  = 0.40;
  static FULL_FRAC   = 0.25;
  static RETURN_FRAC = 0.92;
  static MIN_STAND_GAP  = 0.05;
  static MIN_DOWN_SEC   = 0.18;
  static MAX_LR_ASYM_FRAC = 0.45;
  static TOO_DEEP_GAP    = -0.02;

  static DESCEND_FAST_MAX = 2.0;
  static DESCEND_SLOW_MIN = 4.0;
  static ASCEND_FAST_MAX  = 2.0;
  static ASCEND_SLOW_MIN  = 4.0;
  static REP_FAST_MAX     = 1.5;
  static REP_SLOW_MIN     = 4.0;
  static REP_PERFECT_MIN  = 1.5;
  static REP_PERFECT_MAX  = 4.0;
  static SPEED_WARN_HOLD_SEC = 2.5;

  static TEMPO_IDLE     = 'idle';
  static TEMPO_BELOW_GATE = 'below';
  static TEMPO_COMPLETE  = 'complete';

  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this._inSquat = false;
    this._reachedFull = false;
    this._tooDeep = false;
    this._lastCountT  = -999;
    this._lastPartialT = -999;

    this._standGap  = 0;
    this._lastRawGap = 0;
    this._depthPct  = 0;
    this._downStartT = -999;
    this._repMinGap  = 999;
    this._repMaxLrAsym = 0;
    this.repMetrics  = [];
    this.repMistakeNotes = [];
    this.totalActiveTimeSec = 0;
    this._goalSummaryPrinted = false;
    this._fixedStartLineY = null;
    this._timeStartT = -1;
    this._repCueCounts = {};
    this._bottomT = -1;
    this._speedWarnKey  = null;
    this._speedWarnUntil = -999;
    this._lastRepTotalSec = 0;

    // Tempo gate
    this._tempoGateY = null;
    this._tempoHysteresisPx = 0;
    this._tempoState = SquatRepTracker.TEMPO_IDLE;
    this._tempoDownTime = 0;
    this._tempoUpTime   = 0;
    this.lastTempoDuration = 0;
    this.lastTempoResult   = null;
    this._tempoCompleteShowUntil = -999;
    this._lastMidHipYPx = 0;
    this._lastMidHipXPx = 0;
    this._pendingTempoVoiceKey = null;
    this._prevRepCountForTempo = 0;
  }

  // ── tempo gate ──────────────────────────────────────────────────────────
  get tempoGateY() { return this._tempoGateY; }
  get tempoState() { return this._tempoState; }

  setTempoGate(gateYPixels, hysteresisPx) {
    if (this._tempoGateY !== null) return;
    this._tempoGateY = parseFloat(gateYPixels);
    this._tempoHysteresisPx = Math.max(1, parseFloat(hysteresisPx));
  }

  trackTempo(midHipYPx, midHipXPx) {
    if (this._tempoGateY === null) return;
    this._lastMidHipYPx = midHipYPx;
    this._lastMidHipXPx = midHipXPx;
    const gate = this._tempoGateY;
    const hyst = this._tempoHysteresisPx;
    const now  = nowSec();

    if (this._tempoState === SquatRepTracker.TEMPO_IDLE) {
      if (midHipYPx > gate + hyst) {
        this._tempoState    = SquatRepTracker.TEMPO_BELOW_GATE;
        this._tempoDownTime = now;
      }
    } else if (this._tempoState === SquatRepTracker.TEMPO_BELOW_GATE) {
      if (midHipYPx < gate - hyst) {
        this._tempoUpTime = now;
        this.lastTempoDuration = Math.max(0, this._tempoUpTime - this._tempoDownTime);
        this._classifyTempoGate();
        this._tempoState = SquatRepTracker.TEMPO_COMPLETE;
        this._tempoCompleteShowUntil = now + 3.0;
      }
    } else if (this._tempoState === SquatRepTracker.TEMPO_COMPLETE) {
      if (now >= this._tempoCompleteShowUntil) {
        this._tempoState = SquatRepTracker.TEMPO_IDLE;
      }
    }
  }

  _classifyTempoGate() {
    // NEW timing logic — this is now the SOLE source of fast/slow warnings.
    // d = total seconds from hip crossing BELOW the gate (descent start)
    //     to hip crossing back ABOVE the gate (ascent finish).
    //   <1.5s   → Fast Squat
    //   1.5-4s  → Perfect Squat
    //   >4s  → Slow Squat
    const d    = this.lastTempoDuration;
    const tMin = CFG.tempo_min_sec;   // 1.5
    const tMax = CFG.tempo_max_sec;   // 4.0
    if (d < tMin) {
      this.lastTempoResult = 'fast';
      this._pendingTempoVoiceKey = 'squat_rep_fast';
      this._setSpeedWarning('squat_rep_fast', 4.0);
    } else if (d <= tMax) {
      this.lastTempoResult = 'good';
      this._pendingTempoVoiceKey = 'squat_tempo_good';
      // No warning for perfect (1.5-4s)
    } else {
      this.lastTempoResult = 'slow';
      this._pendingTempoVoiceKey = 'squat_rep_slow';
      this._setSpeedWarning('squat_rep_slow', 4.0);
    }
  }

  popPendingTempoVoice() {
    const key = this._pendingTempoVoiceKey;
    this._pendingTempoVoiceKey = null;
    return key;
  }

  tempoLiveElapsed() {
    if (this._tempoState !== SquatRepTracker.TEMPO_BELOW_GATE) return 0;
    return Math.max(0, nowSec() - this._tempoDownTime);
  }

  tempoResultVisible() {
    return this._tempoState === SquatRepTracker.TEMPO_COMPLETE &&
           nowSec() < this._tempoCompleteShowUntil;
  }

  _resetTempoOnRepCounted() {
    this._tempoState    = SquatRepTracker.TEMPO_IDLE;
    this._tempoDownTime = 0;
    this._tempoUpTime   = 0;
  }

  // ── speed warning ────────────────────────────────────────────────────────
  _setSpeedWarning(key, holdSec) {
    if (!key) return;
    this._speedWarnKey   = key;
    this._speedWarnUntil = nowSec() + (holdSec != null ? holdSec : SquatRepTracker.SPEED_WARN_HOLD_SEC);
  }

  get activeSpeedWarning() {
    return nowSec() < this._speedWarnUntil ? this._speedWarnKey : null;
  }

  // ── calibration / depth ─────────────────────────────────────────────────
  get isCalibrated() { return this._standGap >= SquatRepTracker.MIN_STAND_GAP; }
  get calibrationPct() {
    if (this._standGap <= 0) return 0;
    return Math.min(100, Math.round(this._standGap / SquatRepTracker.MIN_STAND_GAP * 100));
  }
  get depthPct() { return this._depthPct; }
  get inSquat() { return this._inSquat; }
  get tooDeep() { return this._tooDeep; }
  get partialWarn() { return nowSec() - this._lastPartialT < 2.0; }
  get fixedStartLineY() { return this._fixedStartLineY; }
  get _fullDepth() { return this._reachedFull; }  // compat with draw code

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
    if (totalSec < R.REP_FAST_MAX) return 'squat_rep_fast';
    if (totalSec > R.REP_SLOW_MIN) return 'squat_rep_slow';
    if (atBottom && descendSec > 0 && descendSec < R.DESCEND_FAST_MAX) return 'squat_descend_fast';
    if (descendSec > R.DESCEND_SLOW_MIN) return 'squat_descend_slow';
    if (atBottom && ascendSec > 0 && ascendSec < R.ASCEND_FAST_MAX)  return 'squat_ascend_fast';
    if (ascendSec > R.ASCEND_SLOW_MIN) return 'squat_ascend_slow';
    if (totalSec >= R.REP_PERFECT_MIN && totalSec <= R.REP_PERFECT_MAX &&
        descendSec >= R.DESCEND_FAST_MAX && descendSec <= R.DESCEND_SLOW_MIN &&
        ascendSec  >= R.ASCEND_FAST_MAX  && ascendSec  <= R.ASCEND_SLOW_MIN) {
      return 'squat_pace_perfect';
    }
    return null;
  }

  _liveSpeedCue(now, rawGap, fullThresh, returnThresh) {
    if (!this._inSquat) return null;
    const elapsedDown = now - this._downStartT;
    const atBottom = this._bottomT >= 0 || rawGap <= fullThresh || rawGap <= 0;

    if (atBottom) {
      if (this._bottomT < 0) this._bottomT = now;
      const descendSec = this._bottomT - this._downStartT;
      const ascendSec  = now - this._bottomT;
      if (descendSec < SquatRepTracker.DESCEND_FAST_MAX) return 'squat_descend_fast';
      if (ascendSec < SquatRepTracker.ASCEND_FAST_MAX && rawGap >= returnThresh * 0.88) return 'squat_ascend_fast';
      if (ascendSec > SquatRepTracker.ASCEND_SLOW_MIN) return 'squat_ascend_slow';
      return null;
    }
    if (elapsedDown > SquatRepTracker.DESCEND_SLOW_MIN) return 'squat_descend_slow';
    return null;
  }

  // ── main update (called every frame in Stage 5) ──────────────────────────
  update(hipY, kneeY, footY, shoulderW, leftGap, rightGap) {
    const rawGap = kneeY - hipY;
    this._lastRawGap = rawGap;
    this._tooDeep    = rawGap < SquatRepTracker.TOO_DEEP_GAP;

    if (rawGap > this._standGap) {
      this._standGap = rawGap;
      if (this._fixedStartLineY === null) {
        const ratio  = Math.max(0.05, Math.min(0.95, CFG.squat_time_line_ratio));
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

    const sg           = this._standGap;
    const enterThresh  = sg * SquatRepTracker.ENTER_FRAC;
    const fullThresh   = sg * SquatRepTracker.FULL_FRAC;
    const returnThresh = sg * SquatRepTracker.RETURN_FRAC;

    this._depthPct = Math.max(0, Math.min(1, 1 - rawGap / sg));

    if (leftGap != null && rightGap != null) {
      this._repMaxLrAsym = Math.max(
        this._repMaxLrAsym,
        Math.abs(leftGap - rightGap) / Math.max(sg, SquatRepTracker.MIN_STAND_GAP)
      );
    }

    const now = nowSec();

    if (!this._inSquat) {
      if (rawGap <= enterThresh && this._legsBalanced(leftGap, rightGap)) {
        this._inSquat     = true;
        this._reachedFull = false;
        this._downStartT  = now;
        this._timeStartT  = -1;
        this._bottomT     = -1;
        this._repMinGap   = rawGap;
        this._repMaxLrAsym = 0;
        this._repCueCounts = {};
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

      // Live mid-squat speed cues DISABLED — fast/slow are now determined ONLY
      // by the tempo-gate full crossing (hip-below → hip-above the reference line).
      // Still track _bottomT for depth metrics.
      if ((rawGap <= fullThresh || rawGap <= 0) && this._bottomT < 0) {
        this._bottomT = now;
      }

      if (rawGap >= returnThresh) {
        if ((now - this._downStartT) < SquatRepTracker.MIN_DOWN_SEC ||
            !this._legsBalanced(leftGap, rightGap)) {
          this._inSquat      = false;
          this._reachedFull  = false;
          this._repMinGap    = 999;
          this._repMaxLrAsym = 0;
          this._timeStartT   = -1;
          this._bottomT      = -1;
          return null;
        }

        const g = CFG.squat_max_reps;
        let completedRep = null;
        if (g <= 0 || this.count < g) {
          const prevCount = this.count;
          this.count++;
          if (this.count > prevCount) this._resetTempoOnRepCounted();
          this._lastCountT = now;
          const t0 = this._timeStartT >= 0 ? this._timeStartT : this._downStartT;
          const repActiveSec = Math.max(0, now - t0);
          const totalRepSec  = Math.max(0, now - this._downStartT);
          this._lastRepTotalSec = totalRepSec;
          const bottomT    = this._bottomT >= 0 ? this._bottomT : now;
          const descendSec = Math.max(0, bottomT - this._downStartT);
          const ascendSec  = Math.max(0, now - bottomT);
          // Keep classification for rep metrics, but DO NOT trigger speed warning
          // here — speed warnings now come exclusively from the tempo gate.
          const repSpeedKey = this._classifySpeed(descendSec, ascendSec, totalRepSec, true);
          this.totalActiveTimeSec += repActiveSec;
          if (!this._reachedFull) this._lastPartialT = now;

          const repMinGap   = this._repMinGap < 900 ? this._repMinGap : rawGap;
          const repDepthPeak = Math.max(0, Math.min(1, 1 - repMinGap / Math.max(sg, 1e-6)));
          const repData = {
            rep_index:       this.count,
            active_time_sec: +repActiveSec.toFixed(3),
            total_rep_sec:   +totalRepSec.toFixed(3),
            descend_sec:     +descendSec.toFixed(3),
            ascend_sec:      +ascendSec.toFixed(3),
            speed_cue:       repSpeedKey || 'ok',
            peak_depth_pct:  +repDepthPeak.toFixed(4),
            full_depth:      this._reachedFull,
            too_deep:        repMinGap < SquatRepTracker.TOO_DEEP_GAP,
            min_gap:         +repMinGap.toFixed(5),
            left_right_asym: +this._repMaxLrAsym.toFixed(5),
            ...this._repFormDict(repActiveSec),
          };
          repData.voice_keys = this._collectRepVoiceKeys(repData);
          this.repMetrics.push(repData);
          this.repMistakeNotes.push(this._buildRepMistakeNote(repData));
          completedRep = repData;
        }

        this._inSquat      = false;
        this._reachedFull  = false;
        this._repMinGap    = 999;
        this._repMaxLrAsym = 0;
        this._timeStartT   = -1;
        this._bottomT      = -1;
        this._repCueCounts = {};
        return completedRep;
      }
    }
    return null;
  }

  observeRepFormCues(cueKeys) {
    if (!this._inSquat) return;
    for (const key of cueKeys) {
      this._repCueCounts[key] = (this._repCueCounts[key] || 0) + 1;
    }
  }

  _collectRepVoiceKeys(repData) {
    const keys = [];
    if (repData.too_deep) keys.push('squat_too_deep');
    if (!repData.full_depth) keys.push('squat_go_deeper');
    const speed = repData.speed_cue;
    const tempoKeys = new Set(['squat_rep_fast', 'squat_rep_slow', 'squat_tempo_good']);
    if (speed && speed !== 'ok' && speed !== 'squat_pace_perfect' &&
        !(this._tempoGateY !== null && tempoKeys.has(speed))) {
      keys.push(speed);
    }
    if (Object.keys(this._repCueCounts).length) {
      const ranked = Object.entries(this._repCueCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      for (const [k] of ranked) {
        if (!keys.includes(k)) keys.push(k);
      }
    }
    return keys;
  }

  _dominantStatus(prefix, posKey, negKey, okText = 'ok') {
    const scoped = Object.entries(this._repCueCounts)
      .filter(([k]) => k.startsWith(prefix));
    if (!scoped.length) return okText;
    const best = scoped.sort((a, b) => b[1] - a[1])[0][0];
    if (best.endsWith(posKey)) return posKey;
    if (best.endsWith(negKey)) return negKey;
    return 'needs_correction';
  }

  _repFormDict(activeTimeSec) {
    let torsoState = 'ok';
    if ((this._repCueCounts['torso_bend'] || 0) > 0) torsoState = 'forward_lean';
    else if ((this._repCueCounts['torso_x_left'] || 0) > 0 ||
             (this._repCueCounts['torso_x_right'] || 0) > 0) torsoState = 'side_lean';

    let shoulderState = 'ok';
    if ((this._repCueCounts['shoulder_high_left'] || 0) > 0 ||
        (this._repCueCounts['shoulder_high_right'] || 0) > 0) shoulderState = 'lean';

    let hipState = 'ok';
    if ((this._repCueCounts['hip_left'] || 0) > 0) hipState = 'shift_left';
    else if ((this._repCueCounts['hip_right'] || 0) > 0) hipState = 'shift_right';

    return {
      timing_sec:    +activeTimeSec.toFixed(4),
      shoulder_lean: shoulderState,
      torso:         torsoState,
      knee:          this._dominantStatus('knee_', 'outer', 'inner'),
      foot:          this._dominantStatus('toe_',  'outer', 'inner'),
      ankle:         this._dominantStatus('ankle_','outer', 'inner'),
      hip:           hipState,
    };
  }

  _buildRepMistakeNote(repData) {
    const mistakes = [];
    if (repData.too_deep) mistakes.push('too deep');
    if (!repData.full_depth) mistakes.push('not full depth');
    if ((repData.left_right_asym || 0) > SquatRepTracker.MAX_LR_ASYM_FRAC * 0.80) {
      mistakes.push('sliding/imbalance');
    }
    const speed = repData.speed_cue || 'ok';
    if (speed && !['ok', 'squat_pace_perfect'].includes(speed)) {
      mistakes.push(speed.replace('squat_', '').replace(/_/g, ' '));
    }
    return mistakes.length ? mistakes.join(', ') : 'no mistakes';
  }
}
