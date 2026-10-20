// Lying leg raise (side view) — coaching state machine.
//
// Phases:
//   SETUP   — lying flat on the back, side-on to the camera, legs resting on
//             the floor, held still ~1 s → calibration (camera-facing side,
//             torso tilt baseline). Cannot complete unless every check passes.
//   READY   — short settle (lets the setup voice line finish)
//   ACTIVE  — rep counting (LegRaiseRepTracker). Says "Rep N" after each rep.
//
// A form mistake is only shown (text, red skeleton / joint markers) and voiced
// once the SAME mistake appears in two consecutive reps (RepeatMistakeGate).
// Until then nothing is overlaid and nothing is said about it — detection,
// scoring and the session summary still record every mistake.
//
// Sets are run by the app (like squat / push-up / lunge): this flow only counts
// reps and scores them.

import { VoiceManager } from '../../core/voiceManager.js';
import { primeSetIntro } from '../../core/sessionVoice.js';
import { nowSec } from '../../core/landmarks.js';
import { createScoreAverager } from '../../core/repScoring.js';
import { LandmarkSmoother } from '../common/landmarkSmoother.js';
import { RepeatMistakeGate } from '../common/repeatMistakeGate.js';
import { clamp, firstByPriority } from '../common/math.js';
import {
  LGR_CFG, LGR_FEEDBACK, LGR_VOICE_MSG, LGR_TRACKED_LANDMARKS,
  LGR_ISSUE_PRIORITY, LGR_SETUP_PRIORITY,
  LGR_COLOR_GREEN, LGR_COLOR_AMBER, LGR_COLOR_RED, LGR_COLOR_GREY,
} from './config.js';
import {
  pickProfile, buildGeometry, evaluateSetup, calibrationSample, makeCalibration, sampleStillness,
} from './poseChecks.js';
import { LegRaiseRepTracker, LGR_STATE } from './LegRaiseRepTracker.js';

export const LGR_PHASE = {
  SETUP: 'lgr_setup',
  READY: 'lgr_ready',
  ACTIVE: 'lgr_active',
};

const INSTRUCTION_CONFIRM_SEC = 0.4;
const INSTRUCTION_MIN_WAIT_SEC = 2.5;
const FEEDBACK_HOLD_SEC = 2.5;
const LIVE_MISTAKE_HOLD_SEC = 1.5;
const REP_MISTAKE_HOLD_SEC = 3.0;

// Joints circled on the overlay for each (confirmed) mistake.
export const LGR_ISSUE_JOINTS = {
  lgr_not_high_enough: ['A'],
  lgr_not_lowering: ['A'],
  lgr_too_low: ['A'],
  lgr_knees_bent: ['K'],
  lgr_hips_lifting: ['H'],
  lgr_too_fast: [],
};

export class LegRaiseFlow {
  constructor({ targetReps = 0, voice = true, setNumber = 1, setIntro = true, targetSeconds = 0 } = {}) {
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps > 0 ? targetReps : 0;
    this._smoother = new LandmarkSmoother(LGR_CFG, LGR_TRACKED_LANDMARKS);
    this._rep = new LegRaiseRepTracker();
    this._mistakeGate = new RepeatMistakeGate({ pick: (k) => firstByPriority(k, LGR_ISSUE_PRIORITY) });
    this._scores = createScoreAverager();
    this._resetState();
    primeSetIntro(this._voice, {
      enabled: this._voiceEnabled, setIntro, setNumber, targetReps: this._targetReps, targetSeconds,
    });
  }

  _resetState() {
    this._phase = LGR_PHASE.SETUP;
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

    this._cueOnset = new Map();
    this._spokenThisRep = new Set();
    this._lastCorrectionAt = -Infinity;

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
    this._speak(LGR_VOICE_MSG[key], { key: `lgr_instr_${key}`, cooldownMs: LGR_CFG.voice_cooldown_ms });
  }

  /** At most one spoken correction per rep per mistake type, spaced `voice_gap_sec` apart. */
  _speakCorrection(key, now) {
    if (this._spokenThisRep.has(key)) return;
    this._spokenThisRep.add(key);
    if (now - this._lastCorrectionAt < LGR_CFG.voice_gap_sec) return;
    const ok = this._speak(LGR_VOICE_MSG[key], {
      key: `lgr_fix_${key}`, cooldownMs: LGR_CFG.voice_cooldown_ms,
    });
    if (ok) this._lastCorrectionAt = now;
  }

  // ── Text helpers ─────────────────────────────────────────────────────────
  _sustained(keys, now) {
    const active = new Set(keys.filter(Boolean));
    for (const k of active) if (!this._cueOnset.has(k)) this._cueOnset.set(k, now);
    for (const k of [...this._cueOnset.keys()]) if (!active.has(k)) this._cueOnset.delete(k);
    return [...active].filter((k) => now - this._cueOnset.get(k) >= LGR_CFG.live_sustain_sec);
  }

  _setMistake(key, now, holdSec) {
    const text = LGR_FEEDBACK[key];
    if (!text) return;
    this._mistake = text;
    this._mistakeUntil = now + holdSec;
  }

  _setFeedback(text, now, holdSec = FEEDBACK_HOLD_SEC) {
    this._feedback = text || '';
    this._feedbackUntil = now + holdSec;
  }

  // ── Public API ───────────────────────────────────────────────────────────
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
    this._lastNow = now;
    const frame = { width: w, height: h };

    const pts = this._smoother.update(landmarks, w, h, now);
    // The camera-facing side is picked during SETUP and locked at calibration.
    const profile = this._calib?.profile ?? this._setupProfile ?? pickProfile(pts);
    const g = buildGeometry(pts, profile, this._calib);

    switch (this._phase) {
      case LGR_PHASE.SETUP:
        return this._tickSetup(g, now, frame, profile);
      case LGR_PHASE.READY:
        return this._tickReady(g, now);
      default:
        return this._tickActive(g, now);
    }
  }

  _result(g, now, overrides = {}) {
    const rep = this._rep;
    return {
      view: 'side',
      phase: this._phase,
      poseDetected: !!g,
      geometry: g,
      calib: this._calib,
      status: '',
      statusKind: 'info',
      boneColor: LGR_COLOR_GREEN,
      feedback: now <= this._feedbackUntil ? this._feedback : '',
      mistake: now <= this._mistakeUntil ? this._mistake : '',
      repCount: rep.count,
      movement: rep.state,
      theta: g ? g.theta : null,
      peakDeg: rep.peakDeg,
      progress: g ? clamp(g.theta / LGR_CFG.top_target_deg, 0, 1) : 0,
      formScore: this._scores.value,
      stanceResult: null,
      stanceHoldPct: null,
      sustainedCues: [],
      shownCues: [],
      liveCues: [],
      redJoints: [],
      repCompleted: null,
      attemptCompleted: null,
      lastRep: rep.lastRep,
      ...overrides,
    };
  }

  // ── SETUP ────────────────────────────────────────────────────────────────
  _tickSetup(g, now, frame, profile) {
    if (!this._setupBeginSent) {
      this._setupBeginSent = true;
      this._speak(LGR_VOICE_MSG.setup_begin, { key: 'lgr_setup_begin', cooldownMs: 0, immediate: true });
    }

    const fail = (key, kind, extra = {}) => {
      this._passSince = -1;
      this._setupProfile = null;
      this._samples = [];
      this._maybeInstruction(key, now);
      return this._result(g, now, {
        status: LGR_FEEDBACK[key], statusKind: kind,
        boneColor: kind === 'fail' ? LGR_COLOR_GREY : LGR_COLOR_AMBER,
        feedback: LGR_FEEDBACK[key], ...extra,
      });
    };

    if (!g) {
      return fail('lgr_body_not_visible', 'fail', {
        stanceResult: { ok: false, cueKeys: ['lgr_body_not_visible'], checks: { visible: false } },
      });
    }

    const st = evaluateSetup(g);
    if (!st.ok) {
      const key = firstByPriority(st.cueKeys, LGR_SETUP_PRIORITY);
      return fail(key, 'warn', { stanceResult: { ...st, primaryKey: key } });
    }

    this._maybeInstruction(null, now);
    if (this._passSince < 0) {
      this._passSince = now;
      this._setupProfile = profile; // lock the camera-facing side for this attempt
    }
    this._samples.push(calibrationSample(g));
    if (this._samples.length > LGR_CFG.calib_max_samples) this._samples.shift();

    // Calibration needs a still person; restart the window on movement.
    if (sampleStillness(this._samples) > LGR_CFG.calib_still_max_deg) {
      this._samples = [calibrationSample(g)];
      this._passSince = now;
    }

    const holdPct = clamp((now - this._passSince) / LGR_CFG.calib_hold_sec, 0, 1);
    if (holdPct >= 1 && this._samples.length >= LGR_CFG.calib_min_samples) {
      this._calib = makeCalibration(this._samples, profile);
      this._samples = [];
      this._phase = LGR_PHASE.READY;
      this._readyStart = now;
      this._speakQueued(LGR_VOICE_MSG.lgr_ready, { key: 'lgr_ready' });
      this._setFeedback(LGR_FEEDBACK.lgr_ready, now, 3);
      return this._result(g, now, {
        status: LGR_FEEDBACK.lgr_ready, statusKind: 'ok', stanceResult: st, stanceHoldPct: 1,
        feedback: LGR_FEEDBACK.lgr_ready,
      });
    }

    return this._result(g, now, {
      status: 'Position looks good — hold still…', statusKind: 'ok',
      stanceResult: st, stanceHoldPct: holdPct,
    });
  }

  // ── READY ────────────────────────────────────────────────────────────────
  _tickReady(g, now) {
    const elapsed = now - this._readyStart;
    const voiceBusy = this._voiceEnabled && this._voice.isBusy();
    if (elapsed >= LGR_CFG.ready_sec && (!voiceBusy || elapsed >= LGR_CFG.ready_sec + 5)) {
      this._phase = LGR_PHASE.ACTIVE;
      this._rep.rearm();
      this._cueOnset.clear();
      return this._result(g, now, { status: 'Lift your legs to 90° — rep 1', statusKind: 'ok' });
    }
    return this._result(g, now, {
      status: 'Get ready…', statusKind: 'ok',
      feedback: now <= this._feedbackUntil ? this._feedback : 'Get ready…',
    });
  }

  // ── ACTIVE ───────────────────────────────────────────────────────────────
  _tickActive(g, now) {
    const rep = this._rep;

    if (!g) {
      const res = rep.step(null, now);
      this._afterStep(res, now);
      return this._result(g, now, {
        status: LGR_FEEDBACK.lgr_out_of_frame, statusKind: 'warn', boneColor: LGR_COLOR_GREY,
        attemptCompleted: res.incomplete, ...this._repOutputs(res),
      });
    }

    if (Math.abs(g.tiltDelta) > LGR_CFG.not_lying_deg) {
      const a = rep.abort(now, 'sat_up');
      return this._result(g, now, {
        status: LGR_FEEDBACK.lgr_sat_up, statusKind: 'warn', boneColor: LGR_COLOR_GREY,
        attemptCompleted: a,
      });
    }
    if (g.lengthRatio < LGR_CFG.turned_away_ratio) {
      const a = rep.abort(now, 'turned_away');
      return this._result(g, now, {
        status: LGR_FEEDBACK.lgr_turned_away, statusKind: 'warn', boneColor: LGR_COLOR_GREY,
        attemptCompleted: a,
      });
    }

    const res = rep.step({ theta: g.theta, kneeAngle: g.kneeAngle, tiltDelta: g.tiltDelta }, now);
    const out = this._afterStep(res, now);

    // Live indicators: text + voice + red skeleton ONLY for mistakes the
    // previous completed rep also had. A first occurrence stays invisible.
    const sustained = this._sustained(rep.inProgress ? res.liveKeys : [], now);
    const shown = this._mistakeGate.filter(sustained);
    const primary = firstByPriority(shown, LGR_ISSUE_PRIORITY);
    if (primary) {
      this._setFeedback(LGR_FEEDBACK[primary], now, 1.0);
      this._setMistake(primary, now, LIVE_MISTAKE_HOLD_SEC);
      this._speakCorrection(primary, now);
    }

    const confirmed = new Set([...shown, ...(out.shownKey ? [out.shownKey] : [])]);
    const boneColor = shown.length ? LGR_COLOR_RED : LGR_COLOR_GREEN;

    return this._result(g, now, {
      status: this._statusText(rep, primary || out.shownKey),
      statusKind: shown.length ? 'warn' : 'ok',
      boneColor,
      sustainedCues: shown,
      shownCues: shown,
      liveCues: sustained,
      redJoints: [...new Set([...confirmed].flatMap((k) => LGR_ISSUE_JOINTS[k] || []))],
      ...this._repOutputs(res),
    });
  }

  _repOutputs(res) {
    return {
      repCompleted: res.counted || null,
      attemptCompleted: res.counted || res.incomplete || null,
      formScore: this._scores.value,
      repCount: this._rep.count,
      lastRep: this._rep.lastRep,
    };
  }

  _statusText(rep, shownKey) {
    if (shownKey) return LGR_FEEDBACK[shownKey];
    switch (rep.state) {
      case LGR_STATE.UP: return 'Lift your legs up to 90°…';
      case LGR_STATE.DOWN: return 'Lower slowly to about 45° — don\'t touch the floor';
      default: return `Lift your legs to 90° — rep ${rep.count + 1}`;
    }
  }

  /** Counted rep: voice the count, run the repeat-mistake gate, record the score. */
  _afterStep(res, now) {
    const out = { shownKey: null };
    const a = res.counted;
    if (a) {
      this._scores.push(a.score);
      // Only mistakes the previous rep also had survive.
      const repeated = this._mistakeGate.endRep(a.issues);
      const primary = firstByPriority(repeated, LGR_ISSUE_PRIORITY);

      this._speak(`Rep ${a.index}`, { key: `lgr_rep_${a.index}`, cooldownMs: 0, immediate: true });
      if (primary) {
        out.shownKey = primary;
        this._setFeedback(LGR_FEEDBACK[primary], now);
        this._setMistake(primary, now, REP_MISTAKE_HOLD_SEC);
        this._speakCorrection(primary, now);
      } else if (!a.issues.length) {
        this._setFeedback('Good rep!', now);
      }
      // Only the single highest-priority confirmed mistake is shown or spoken per rep.
      a.confirmedIssues = repeated;
      a.warning = primary;
      this._spokenThisRep.clear();
    }
    if (res.started) {
      this._mistakeGate.startRep();
      this._spokenThisRep.clear();
    }
    return out;
  }
}
