// Lunge coaching state machine (front + side view share this flow; the view
// only selects the geometry / measurements).
//
// Phases:
//   SETUP   — view + visibility + upright + stillness checks; calibrates the
//             standing hip-to-ankle height, torso length and the person's
//             natural alignment baselines. Cannot complete unless every check
//             passes continuously.
//   READY   — short settle, then counting starts
//   ACTIVE  — rep counting (LungeRepTracker), live red indicators, corrective
//             cues gated by RepeatMistakeGate, voice with cooldowns
//
// Sets are run by the app (like squat / push-up): this flow only counts reps
// and scores them. Resetting (or a new session) clears all of it.

import { VoiceManager } from '../../core/voiceManager.js';
import { primeSetIntro } from '../../core/sessionVoice.js';
import { nowSec } from '../../core/landmarks.js';
import { createScoreAverager } from '../../core/repScoring.js';
import { LandmarkSmoother } from '../common/landmarkSmoother.js';
import { RepeatMistakeGate } from '../common/repeatMistakeGate.js';
import { clamp, firstByPriority } from '../common/math.js';
import {
  LUNGE_CFG, LUNGE_FEEDBACK, LUNGE_VOICE_MSG, LUNGE_TRACKED_LANDMARKS,
  LUNGE_ISSUE_PRIORITY, LUNGE_SETUP_PRIORITY, LUNGE_ISSUE_JOINTS, LUNGE_LEG_JOINTS,
  LUNGE_COLOR_GREEN, LUNGE_COLOR_AMBER, LUNGE_COLOR_RED, LUNGE_COLOR_GREY,
} from './config.js';
import {
  buildGeometry, pickProfile, depthOf, frontMeasures, sideMeasures, legVote,
  evaluateSetup, calibrationSample, makeCalibration, sampleStillness,
} from './poseChecks.js';
import { LungeRepTracker, LUNGE_STATE } from './LungeRepTracker.js';

export const LUNGE_PHASE = {
  SETUP: 'lunge_setup',
  READY: 'lunge_ready',
  ACTIVE: 'lunge_active',
};

const INSTRUCTION_CONFIRM_SEC = 0.4;
const INSTRUCTION_MIN_WAIT_SEC = 2.5;
const FEEDBACK_HOLD_SEC = 2.5;
const LIVE_MISTAKE_HOLD_SEC = 1.5;
const REP_MISTAKE_HOLD_SEC = 3.0;
const MIN_CALIB_SAMPLES = 8;

export class LungeFlow {
  constructor({ view = 'front', targetReps = 0, voice = true, setNumber = 1, setIntro = true, targetSeconds = 0 } = {}) {
    this._view = view === 'side' ? 'side' : 'front';
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps > 0 ? targetReps : 0;
    this._smoother = new LandmarkSmoother(LUNGE_CFG, LUNGE_TRACKED_LANDMARKS);
    this._rep = new LungeRepTracker(this._view);
    this._mistakeGate = new RepeatMistakeGate({ pick: (k) => firstByPriority(k, LUNGE_ISSUE_PRIORITY) });
    this._scores = createScoreAverager();
    this._resetState();
    primeSetIntro(this._voice, {
      enabled: this._voiceEnabled, setIntro, setNumber, targetReps: this._targetReps, targetSeconds,
    });
  }

  _resetState() {
    this._phase = LUNGE_PHASE.SETUP;
    this._smoother.reset();
    this._rep.reset();
    this._mistakeGate.reset();
    this._scores.reset();

    this._calib = null;
    this._samples = [];
    this._passSince = -1;
    this._setupProfile = null;
    this._readyStart = -1;

    this._setupBeginSent = false;
    this._lastInstructionKey = '';
    this._lastInstructionAt = -1;
    this._pendingInstructionKey = '';
    this._pendingInstructionSince = -1;

    this._wasInRep = false;
    this._cueOnset = new Map();
    this._spokenThisRep = new Set();
    this._lastCorrectionAt = -Infinity;
    this._driftSince = -1;

    this._mistake = '';
    this._mistakeUntil = -1;
    this._feedback = '';
    this._feedbackUntil = -1;
    this._lastNow = -1;
  }

  // ── Voice ────────────────────────────────────────────────────────────────
  _speak(text, opts) {
    if (!this._voiceEnabled || !text) return false;
    return this._voice.speak(text, opts);
  }

  _speakQueued(text, opts) {
    if (!this._voiceEnabled || !text) return false;
    return this._voice.speakQueued(text, opts);
  }

  /** Setup instruction: debounced, said once per key, then the user gets time to fix it. */
  _maybeInstruction(key, now) {
    if (!key) {
      this._pendingInstructionKey = '';
      this._pendingInstructionSince = -1;
      return;
    }
    if (this._pendingInstructionKey !== key) {
      this._pendingInstructionKey = key;
      this._pendingInstructionSince = now;
      return;
    }
    if (now - this._pendingInstructionSince < INSTRUCTION_CONFIRM_SEC) return;
    if (this._lastInstructionKey === key) return;
    if (this._lastInstructionKey && now - this._lastInstructionAt < INSTRUCTION_MIN_WAIT_SEC) return;
    this._lastInstructionKey = key;
    this._lastInstructionAt = now;
    this._speak(LUNGE_VOICE_MSG[key], { key: `lunge_instr_${key}`, cooldownMs: LUNGE_CFG.voice_cooldown_ms });
  }

  /**
   * Spoken form correction. At most one per rep per mistake type, never two
   * different corrections within voice_gap_sec, and the VoiceManager enforces
   * the per-key cooldown on top.
   */
  _speakCorrection(key, now) {
    if (this._spokenThisRep.has(key)) return;
    this._spokenThisRep.add(key);
    if (now - this._lastCorrectionAt < LUNGE_CFG.voice_gap_sec) return;
    const ok = this._speak(LUNGE_VOICE_MSG[key], {
      key: `lunge_fix_${key}`, cooldownMs: LUNGE_CFG.voice_cooldown_ms,
    });
    if (ok) this._lastCorrectionAt = now;
  }

  // ── Text helpers ─────────────────────────────────────────────────────────
  _sustained(keys, now) {
    const active = new Set(keys.filter(Boolean));
    for (const k of active) if (!this._cueOnset.has(k)) this._cueOnset.set(k, now);
    for (const k of [...this._cueOnset.keys()]) if (!active.has(k)) this._cueOnset.delete(k);
    return [...active].filter((k) => now - this._cueOnset.get(k) >= LUNGE_CFG.live_sustain_sec);
  }

  _setMistake(key, now, holdSec) {
    const text = LUNGE_FEEDBACK[key];
    if (!text) return;
    this._mistake = text;
    this._mistakeUntil = now + holdSec;
  }

  _setFeedback(text, now, holdSec = FEEDBACK_HOLD_SEC) {
    this._feedback = text || '';
    this._feedbackUntil = now + holdSec;
  }

  // ── Public API ───────────────────────────────────────────────────────────
  get view() {
    return this._view;
  }

  get phase() {
    return this._phase;
  }

  get calibration() {
    return this._calib;
  }

  get repTracker() {
    return this._rep;
  }

  get formScore() {
    return this._scores.value;
  }

  get scoredReps() {
    return this._scores.count;
  }

  setTargetReps(n) {
    this._targetReps = n > 0 ? n : 0;
  }

  reset() {
    this._voice.cancel();
    this._voice.resetCooldowns();
    this._resetState();
  }

  // ── Frame tick ───────────────────────────────────────────────────────────
  tick(landmarks, w, h, now = nowSec()) {
    const dt = this._lastNow < 0 ? 0 : clamp(now - this._lastNow, 0, 0.25);
    this._lastNow = now;
    const frame = { width: w, height: h };

    const pts = this._smoother.update(landmarks, w, h, now);
    // The camera-facing side is picked once (SETUP) and locked at calibration.
    const profile = this._view === 'side'
      ? (this._calib?.profile ?? this._setupProfile ?? pickProfile(pts))
      : null;
    const g = buildGeometry(pts, this._calib, this._view, profile);

    switch (this._phase) {
      case LUNGE_PHASE.SETUP:
        return this._tickSetup(g, now, frame, profile);
      case LUNGE_PHASE.READY:
        return this._tickReady(g, now);
      default:
        return this._tickActive(g, now, dt);
    }
  }

  _result(g, now, overrides = {}) {
    const rep = this._rep;
    return {
      view: this._view,
      phase: this._phase,
      poseDetected: !!g,
      geometry: g,
      calib: this._calib,
      status: '',
      statusKind: 'info',
      boneColor: LUNGE_COLOR_GREEN,
      feedback: now <= this._feedbackUntil ? this._feedback : '',
      mistake: now <= this._mistakeUntil ? this._mistake : '',
      repCount: rep.count,
      movement: rep.state,
      frontLeg: rep.activeLeg,
      depth: rep.depth,
      progress: 0,
      formScore: this._scores.value,
      legCounts: { ...rep.legCounts },
      stanceResult: null,
      stanceHoldPct: null,
      sustainedCues: [],
      shownCues: [],
      redJoints: [],
      repCompleted: null,
      attemptCompleted: null,
      lastRep: rep.lastRep,
      ...overrides,
    };
  }

  // ── SETUP ────────────────────────────────────────────────────────────────
  _toSetup() {
    this._phase = LUNGE_PHASE.SETUP;
    this._calib = null;
    this._samples = [];
    this._passSince = -1;
    this._setupProfile = null;
    this._driftSince = -1;
    this._smoother.reset();
    this._rep.rearm(); // counts survive a recalibration
    this._spokenThisRep.clear();
    this._wasInRep = false;
    this._cueOnset.clear();
  }

  _tickSetup(g, now, frame, profile) {
    if (!this._setupBeginSent) {
      this._setupBeginSent = true;
      this._speak(this._view === 'side' ? LUNGE_VOICE_MSG.setup_side : LUNGE_VOICE_MSG.setup_front, {
        key: 'lunge_setup_begin', cooldownMs: 0, immediate: true,
      });
    }

    const fail = (key, kind, extra = {}) => {
      this._passSince = -1;
      this._setupProfile = null;
      this._samples = [];
      this._maybeInstruction(key, now);
      return this._result(g, now, {
        status: LUNGE_FEEDBACK[key], statusKind: kind, boneColor: kind === 'fail' ? LUNGE_COLOR_GREY : LUNGE_COLOR_AMBER,
        feedback: LUNGE_FEEDBACK[key], ...extra,
      });
    };

    if (!g) {
      return fail('lunge_no_person', 'fail', { stanceResult: { ok: false, cueKeys: ['lunge_no_person'], checks: {} } });
    }

    const st = evaluateSetup(g, this._view, frame);
    if (!st.ok) {
      const key = firstByPriority(st.cueKeys, LUNGE_SETUP_PRIORITY);
      return fail(key, 'warn', { stanceResult: { ...st, primaryKey: key } });
    }

    this._maybeInstruction(null, now);
    if (this._passSince < 0) {
      this._passSince = now;
      this._setupProfile = profile; // lock the camera-facing side for this attempt
    }
    this._samples.push(calibrationSample(g));
    if (this._samples.length > LUNGE_CFG.calib_max_samples) this._samples.shift();

    // Calibration needs a still person; restart the window on movement.
    if (sampleStillness(this._samples) > LUNGE_CFG.calib_still_max) {
      this._samples = [calibrationSample(g)];
      this._passSince = now;
    }

    const holdPct = clamp((now - this._passSince) / LUNGE_CFG.calib_hold_sec, 0, 1);
    if (holdPct >= 1 && this._samples.length >= MIN_CALIB_SAMPLES) {
      this._calib = makeCalibration(this._samples, this._view, profile);
      this._samples = [];
      this._phase = LUNGE_PHASE.READY;
      this._readyStart = now;
      this._speakQueued(LUNGE_VOICE_MSG.lunge_ready, { key: 'lunge_ready' });
      this._setFeedback(LUNGE_FEEDBACK.lunge_ready, now, 3);
      return this._result(g, now, {
        status: LUNGE_FEEDBACK.lunge_ready, statusKind: 'ok', stanceResult: st, stanceHoldPct: 1,
        feedback: LUNGE_FEEDBACK.lunge_ready,
      });
    }

    return this._result(g, now, {
      status: 'Stance looks good — hold still…', statusKind: 'ok',
      stanceResult: st, stanceHoldPct: holdPct,
    });
  }

  // ── READY ────────────────────────────────────────────────────────────────
  _tickReady(g, now) {
    if (now - this._readyStart >= LUNGE_CFG.ready_sec) {
      this._phase = LUNGE_PHASE.ACTIVE;
      this._rep.rearm();
      this._wasInRep = false;
      return this._result(g, now, { status: 'Start your first lunge', statusKind: 'ok' });
    }
    return this._result(g, now, {
      status: 'Get ready…', statusKind: 'ok',
      feedback: now <= this._feedbackUntil ? this._feedback : 'Get ready…',
    });
  }

  // ── ACTIVE ───────────────────────────────────────────────────────────────
  _turnedAway(g) {
    const c = this._calib;
    if (this._view === 'front') return g.swRatio < c.swRatio * 0.6;
    return g.swRatio > Math.max(c.swRatio * 2.2, LUNGE_CFG.side_sw_ratio_max + 0.15);
  }

  _tickActive(g, now, dt) {
    const rep = this._rep;

    if (!g) {
      const res = rep.step({ depth: null }, now);
      this._afterStep(res, now);
      return this._result(g, now, {
        status: LUNGE_FEEDBACK.lunge_out_of_frame, statusKind: 'warn', boneColor: LUNGE_COLOR_GREY,
        movement: rep.state, attemptCompleted: res.incomplete, ...this._repOutputs(res),
      });
    }

    if (this._turnedAway(g)) {
      const a = rep.abort(now, 'turned_away');
      this._afterStep({ counted: null, incomplete: a, liveKeys: [] }, now);
      return this._result(g, now, {
        status: LUNGE_FEEDBACK.lunge_turned_away, statusKind: 'warn', boneColor: LUNGE_COLOR_GREY,
        attemptCompleted: a,
      });
    }

    // Camera moved / person moved much closer or farther while standing → recalibrate.
    if (!rep.inProgress && g.standHeight != null) {
      const ratio = g.standHeight / this._calib.standH;
      const C = LUNGE_CFG;
      if (ratio < C.restand_drift_min || ratio > C.restand_drift_max) {
        if (this._driftSince < 0) this._driftSince = now;
        if (now - this._driftSince >= C.restand_drift_sec) {
          this._toSetup();
          return this._result(g, now, {
            status: LUNGE_FEEDBACK.lunge_camera_moved, statusKind: 'warn', boneColor: LUNGE_COLOR_AMBER,
          });
        }
      } else {
        this._driftSince = -1;
        if (rep.state === LUNGE_STATE.STANDING && ratio > 0.94) {
          this._calib.standH += C.restand_blend * (g.standHeight - this._calib.standH);
        }
      }
    }

    const depth = depthOf(g, this._calib);
    const m = this._view === 'side' ? sideMeasures(g, this._calib) : frontMeasures(g, this._calib);
    const res = rep.step({ depth, m, vote: legVote(g, this._calib) }, now);

    const inRep = rep.inProgress;
    if (inRep && !this._wasInRep) {
      this._mistakeGate.startRep();
      this._spokenThisRep.clear();
    }
    this._wasInRep = inRep;

    const out = this._afterStep(res, now);

    // Live indicators: red on any sustained fault (visual only); text + voice
    // only for mistakes the previous completed rep also had.
    const sustained = this._sustained(inRep ? res.liveKeys : [], now);
    const shown = this._mistakeGate.filter(sustained);
    const primary = firstByPriority(shown, LUNGE_ISSUE_PRIORITY);
    if (primary) {
      this._setFeedback(LUNGE_FEEDBACK[primary], now, 1.0);
      this._setMistake(primary, now, LIVE_MISTAKE_HOLD_SEC);
      this._speakCorrection(primary, now);
    }

    const boneColor = sustained.length ? LUNGE_COLOR_RED : LUNGE_COLOR_GREEN;

    return this._result(g, now, {
      status: this._statusText(rep, primary || out.shownKey, depth),
      statusKind: shown.length ? 'warn' : 'ok',
      boneColor,
      movement: rep.state,
      depth: rep.depth,
      progress: depth == null ? 0 : clamp(depth / LUNGE_CFG.depth_full, 0, 1),
      sustainedCues: sustained,
      shownCues: shown,
      redJoints: [...new Set([...shown, ...(out.shownKey ? [out.shownKey] : [])]
        .flatMap((k) => this._issueJoints(k)))],
      ...this._repOutputs(res),
    });
  }

  _issueJoints(key) {
    if (key !== 'lunge_front_shin') return LUNGE_ISSUE_JOINTS[key] || [];
    const leg = this._rep.activeLeg ?? this._rep.lastRep?.frontLeg;
    return LUNGE_LEG_JOINTS[leg] || [];
  }

  _repOutputs(res) {
    return {
      repCompleted: res.counted || null,
      attemptCompleted: res.counted || res.incomplete || null,
      formScore: this._scores.value,
      repCount: this._rep.count,
      legCounts: { ...this._rep.legCounts },
      lastRep: this._rep.lastRep,
    };
  }

  _statusText(rep, shownKey, depth) {
    if (shownKey) return LUNGE_FEEDBACK[shownKey];
    switch (rep.state) {
      case LUNGE_STATE.DESCENDING: return 'Lower into the lunge…';
      case LUNGE_STATE.BOTTOM: return 'Good depth — drive back up';
      case LUNGE_STATE.ASCENDING: return 'Stand up with control…';
      default: return depth != null && depth >= LUNGE_CFG.depth_enter ? 'Stand tall' : `Lunge — rep ${rep.count + 1}`;
    }
  }

  /** Counted rep: voice the count, run the repeat-mistake gate, record the score. */
  _afterStep(res, now) {
    const out = { shownKey: null };
    if (res.incomplete) {
      this._spokenThisRep.clear();
      this._setFeedback(
        res.incomplete.incompleteReason === 'too_shallow' ? LUNGE_FEEDBACK.lunge_incomplete : '',
        now, 1.5,
      );
    }
    const a = res.counted;
    if (!a) return out;

    this._scores.push(a.score);
    // Two consecutive completed reps: only mistakes the previous rep also had survive.
    const repeated = this._mistakeGate.endRep(a.issues);
    const primary = firstByPriority(repeated, LUNGE_ISSUE_PRIORITY);

    this._speak(`Rep ${a.index}`, { key: `lunge_rep_${a.index}`, cooldownMs: 0, immediate: true });
    if (primary) {
      out.shownKey = primary;
      this._setFeedback(LUNGE_FEEDBACK[primary], now);
      this._setMistake(primary, now, REP_MISTAKE_HOLD_SEC);
      this._speakCorrection(primary, now);
    } else if (!a.issues.length) {
      this._setFeedback('Good rep!', now);
    }
    // Contradictory corrections are impossible: only the single highest-priority
    // confirmed mistake is ever shown or spoken for a rep.
    a.confirmedIssues = repeated;
    a.warning = primary;
    this._spokenThisRep.clear();
    return out;
  }
}
