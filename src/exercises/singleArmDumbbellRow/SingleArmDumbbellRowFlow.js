// Single-arm dumbbell row (side / three-quarter view) — coaching state machine.
//
// Phases:
//   SETUP_STANCE       — bent over on the bench, side-on, working arm hanging
//                        straight, held ~1 s → calibration of the working side
//                        (torso length, torso angle, hanging elbow / wrist
//                        depth below the torso line, elbow back offset, far
//                        shoulder offset)
//   READY              — short settle, then rep counting starts
//   ACTIVE             — rep counting per set
//   REST_BETWEEN_SETS  — not scored; resumes via continueNextSet() or
//                        automatically once back in the start position after
//                        the rest time
//   COMPLETE           — all sets done, or finish() (Stop) was called
//
// Working arm: the side whose shoulder / elbow / wrist / hip / knee are more
// visible (closest to the camera). It only changes when the other side leads
// by `side_switch_margin` for `side_switch_sec`, and never mid-rep. Each side
// keeps its own calibration; a side without one goes back to SETUP_STANCE.
//
// Readiness: while the working arm's mean landmark visibility (view
// confidence) is below `min_view_confidence` nothing is counted or scored —
// the arm is treated as hidden and a low-confidence state is exposed.
//
// Only rep windows are scored. Time spent NOT DOING EXERCISE (arm resting,
// standing up, out of frame) never counts toward active time or any metric.
//
// Voice policy: "starting position set", rep counts, set complete, rest
// prompts and next-set starts, plus form corrections. A correction is only
// spoken once the same mistake appears in two reps in a row
// (RepeatMistakeGate), with a per-key cooldown, a minimum gap between any two
// corrections, one at a time, and always queued — never cutting off the count.

import { VoiceManager } from '../../core/voiceManager.js';
import { nowSec } from '../../core/landmarks.js';
import {
  SR_CFG, SR_FEEDBACK, SR_VOICE_MSG, SR_SETUP_PRIORITY, SR_LIVE_PRIORITY, SR_TRACKED_LANDMARKS,
  SR_COLOR_GREEN, SR_COLOR_AMBER, SR_COLOR_RED, SR_COLOR_GREY,
} from './config.js';
import { LandmarkSmoother } from '../common/landmarkSmoother.js';
import { RepeatMistakeGate } from '../common/repeatMistakeGate.js';
import { firstByPriority, median, clamp, clamp01, fmt } from '../common/math.js';
import {
  buildRowGeometry, evaluateRowSetup, sideScores, viewConfidence, isBentOver, isSideOn, rowProgress,
} from './poseChecks.js';
import {
  SingleArmDumbbellRowRepTracker, SR_ARM_STATE, summarizeSingleArmDumbbellRow,
} from './SingleArmDumbbellRowRepTracker.js';

export const SR_PHASE = {
  SETUP_STANCE: 'sr_setup_stance',
  READY: 'sr_ready',
  ACTIVE: 'sr_active',
  REST_BETWEEN_SETS: 'sr_rest_between_sets',
  COMPLETE: 'sr_complete',
};

export const SR_ACTIVITY = {
  EXERCISING: 'exercising',
  NOT_EXERCISING: 'not_exercising',
};

const VOICE_CD_MS = 10_000;
const LIVE_CUE_GAP_SEC = 2.5;
const LIVE_CUE_SUSTAIN_SEC = 0.3;
const LIVE_MISTAKE_HOLD_SEC = 1.5;
const REP_MISTAKE_HOLD_SEC = 3.0;
const INSTRUCTION_CONFIRM_SEC = 0.4;
const INSTRUCTION_MIN_WAIT_SEC = 2.5;
const FEEDBACK_HOLD_SEC = 2.5;
const CALIB_MAX_SAMPLES = 60;
const CONFIDENCE_SMOOTHING = 0.3; // EMA weight of the newest view-confidence sample
const INVALID_START_SEC = 1.0; // arm held away from the start this long before rowing
const UPRIGHT_SLACK_DEG = 10; // extra torso angle allowed mid-set before "not in position"

const SIDE_LABEL = { left: 'Left', right: 'Right' };

export class SingleArmDumbbellRowFlow {
  constructor({ targetReps = 10, targetSets = 3, restSeconds = null, voice = true } = {}) {
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps > 0 ? targetReps : 0;
    this._targetSets = targetSets > 0 ? targetSets : (this._targetReps > 0 ? 1 : 0);
    this._restSec = restSeconds > 0 ? restSeconds : null;
    this._rep = new SingleArmDumbbellRowRepTracker();
    this._smoother = new LandmarkSmoother(SR_CFG, SR_TRACKED_LANDMARKS);
    this._resetState();
  }

  _resetState() {
    this._phase = SR_PHASE.SETUP_STANCE;
    this._smoother.reset();
    this._calib = null;
    this._calibBySide = {};
    this._stancePassSince = -1;
    this._calibSamples = [];
    this._setupBeginSent = false;
    this._pendingInstructionKey = '';
    this._pendingInstructionSince = -1;
    this._lastInstructionKey = '';
    this._lastInstructionAt = -1;

    this._side = null;
    this._sideCandidateSince = -1;
    this._confidence = 0;
    this._confidenceSum = 0;
    this._confidenceFrames = 0;

    this._readyStart = -1;
    this._currentSet = 1;
    this._setStarted = false;
    this._setsCompleted = 0;
    this._restStart = -1;
    this._restResumeSince = -1;
    this._restOverSpoken = false;

    this._activity = SR_ACTIVITY.NOT_EXERCISING;
    this._activityReason = 'sr_setup';
    this._lastMoveAt = -Infinity;
    this._notExSince = -1;
    this._lostSince = -1;
    this._invalidStartSince = -1;

    this._activeSec = 0;
    this._sessionSec = 0;
    this._lastTickAt = -1;

    this._cueOnset = new Map();
    this._mistakeGate = new RepeatMistakeGate();
    this._lastCorrectionAt = -1;
    this._mistake = '';
    this._mistakeUntil = -1;
    this._feedback = '';
    this._feedbackUntil = -1;
    this._banner = '';
    this._bannerUntil = -1;

    this._stoppedEarly = false;
    this._stoppedInPhase = null;
    this._final = null;
    this._frameNo = 0;
    this._debugHeaderSent = false;
  }

  // ── Voice / text helpers ─────────────────────────────────────────────────
  _speak(text, opts) {
    if (!this._voiceEnabled || !text) return false;
    return this._voice.speak(text, opts);
  }

  _speakQueued(text, opts) {
    if (!this._voiceEnabled || !text) return false;
    return this._voice.speakQueued(text, opts);
  }

  _voiceBusy() {
    return this._voiceEnabled && this._voice.isBusy();
  }

  /** Debounce, say once per key, then give the user time to correct. */
  _maybeIssueInstruction(key, now) {
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
    this._speak(SR_VOICE_MSG[key], { key: `sr_instr_${key}`, cooldownMs: VOICE_CD_MS });
  }

  /**
   * One spoken correction: per-key cooldown + a gap after the previous one,
   * queued so it never cuts off a rep count. `live` corrections are dropped
   * while anything else is being said, so they cannot pile up.
   */
  _speakCorrection(key, now, { live = false } = {}) {
    const msg = SR_VOICE_MSG[key];
    if (!msg) return;
    if (this._lastCorrectionAt >= 0 && now - this._lastCorrectionAt < LIVE_CUE_GAP_SEC) return;
    if (live && this._voiceBusy()) return;
    if (this._speakQueued(msg, { key: `sr_cue_${key}`, cooldownMs: VOICE_CD_MS })) {
      this._lastCorrectionAt = now;
    }
  }

  _sustained(keys, now) {
    const active = new Set(keys.filter(Boolean));
    for (const k of active) if (!this._cueOnset.has(k)) this._cueOnset.set(k, now);
    for (const k of [...this._cueOnset.keys()]) if (!active.has(k)) this._cueOnset.delete(k);
    return [...active].filter((k) => now - this._cueOnset.get(k) >= LIVE_CUE_SUSTAIN_SEC);
  }

  _setMistake(key, now, holdSec) {
    const text = SR_FEEDBACK[key];
    if (!text) return;
    this._mistake = text;
    this._mistakeUntil = now + holdSec;
  }

  _setFeedback(text, now, holdSec = FEEDBACK_HOLD_SEC) {
    this._feedback = text || '';
    this._feedbackUntil = now + holdSec;
  }

  _currentFeedback(now) {
    return now <= this._feedbackUntil ? this._feedback : '';
  }

  _setBanner(text, now, holdSec = 1.5) {
    this._banner = text;
    this._bannerUntil = now + holdSec;
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

  get workingSide() {
    return this._side;
  }

  setTargetReps(n) {
    this._targetReps = n > 0 ? n : 0;
  }

  /** Skip the rest countdown and start the next set now. */
  continueNextSet() {
    if (this._phase !== SR_PHASE.REST_BETWEEN_SETS) return false;
    this._startNextSet(nowSec());
    return true;
  }

  /** Stop: close the session and return the summary of everything done so far. */
  finish() {
    if (this._phase !== SR_PHASE.COMPLETE) {
      this._stoppedEarly = true;
      this._stoppedInPhase = this._phase;
      this._rep.abortInProgress();
      this._phase = SR_PHASE.COMPLETE;
      this._final = this.summary();
    }
    return this._final || this.summary();
  }

  summary() {
    const s = summarizeSingleArmDumbbellRow(this._rep.attempts, {
      activeSec: this._activeSec,
      sessionSec: this._sessionSec,
      setsCompleted: this._setsCompleted,
      targetSets: this._targetSets,
      targetReps: this._targetReps,
      stoppedEarly: this._stoppedEarly,
      confidence: this._confidenceFrames ? this._confidenceSum / this._confidenceFrames : null,
    });
    const phase = this._stoppedEarly ? this._stoppedInPhase : this._phase;
    s.partialSetReps = phase === SR_PHASE.ACTIVE ? this._rep.setCount : 0;
    s.currentSet = this._currentSet;
    s.workingSide = this._side;
    return s;
  }

  // ── Frame tick ───────────────────────────────────────────────────────────
  tick(landmarks, w, h) {
    const now = nowSec();
    const dt = this._lastTickAt < 0 ? 0 : clamp(now - this._lastTickAt, 0, 0.25);
    this._lastTickAt = now;
    this._frameNo += 1;

    this._updateSide(landmarks, now);
    const conf = viewConfidence(landmarks, this._side);
    this._confidence += CONFIDENCE_SMOOTHING * (conf - this._confidence);

    const pts = this._smoother.update(landmarks, w, h, now);
    const g = buildRowGeometry(pts, this._side);
    if (g) this._lostSince = -1;
    else if (this._lostSince < 0) this._lostSince = now;
    const lostLong = !g && this._lostSince >= 0 && now - this._lostSince >= SR_CFG.person_lost_sec;

    let fr;
    switch (this._phase) {
      case SR_PHASE.SETUP_STANCE:
        fr = this._tickSetup(g, now);
        break;
      case SR_PHASE.READY:
        fr = this._tickReady(g, now);
        break;
      case SR_PHASE.ACTIVE:
        fr = this._tickActive(g, now, dt, lostLong);
        break;
      case SR_PHASE.REST_BETWEEN_SETS:
        fr = this._tickRest(g, now);
        break;
      default:
        fr = this._result(g, now, {
          status: this._stoppedEarly ? 'Session stopped' : 'All sets complete!',
          activityReason: 'sr_complete',
        });
    }

    const counting = this._phase !== SR_PHASE.COMPLETE && this._phase !== SR_PHASE.SETUP_STANCE;
    const longIdle = this._isLongIdle(now);
    if (counting && !longIdle) this._sessionSec += dt;
    fr.timerPaused = longIdle;

    if (SR_CFG.debug) this._debugLog(fr, g, now);
    return fr;
  }

  // ── Working side ─────────────────────────────────────────────────────────
  _updateSide(landmarks, now) {
    if (!landmarks) {
      this._sideCandidateSince = -1;
      return;
    }
    const scores = sideScores(landmarks);
    const best = scores.left >= scores.right ? 'left' : 'right';
    if (!this._side) {
      this._side = best;
      this._rep.setSide(best);
      return;
    }
    const lead = scores[best] - scores[this._side];
    if (best === this._side || lead < SR_CFG.side_switch_margin || this._rep.inProgress) {
      this._sideCandidateSince = -1;
      return;
    }
    if (this._sideCandidateSince < 0) {
      this._sideCandidateSince = now;
      return;
    }
    if (now - this._sideCandidateSince >= SR_CFG.side_switch_sec) this._switchSide(best, now);
  }

  _switchSide(side, now) {
    this._side = side;
    this._sideCandidateSince = -1;
    this._rep.setSide(side);
    this._smoother.reset();
    this._cueOnset.clear();
    this._invalidStartSince = -1;
    this._stancePassSince = -1;
    this._calibSamples = [];
    this._calib = this._calibBySide[side] || null;
    this._setBanner(`${SIDE_LABEL[side]} arm`, now, 2.0);

    const counting = this._phase === SR_PHASE.READY || this._phase === SR_PHASE.ACTIVE;
    if (!counting) return;
    this._speakQueued(SR_VOICE_MSG.side(side), { key: `sr_side_${side}`, cooldownMs: VOICE_CD_MS });
    if (!this._calib) {
      this._phase = SR_PHASE.SETUP_STANCE;
      this._setActivity(false, 'sr_switching_side', now);
    }
  }

  _result(g, now, overrides = {}) {
    const rep = this._rep;
    const p = g && this._calib ? rowProgress(g.arm, this._calib) : null;
    return {
      phase: this._phase,
      poseDetected: !!g,
      geometry: g,
      calib: this._calib,
      side: this._side,
      confidence: this._confidence,
      lowConfidence: false,
      status: '',
      statusKind: 'info',
      boneColor: SR_COLOR_GREEN,
      activity: SR_ACTIVITY.NOT_EXERCISING,
      activityReason: this._activityReason,
      feedback: this._currentFeedback(now),
      banner: now <= this._bannerUntil ? this._banner : '',
      mistake: now <= this._mistakeUntil ? this._mistake : '',
      repCount: rep.count,
      setRepCount: rep.setCount,
      currentSet: this._currentSet,
      setsCompleted: this._setsCompleted,
      targetSets: this._targetSets,
      targetReps: this._targetReps,
      armState: rep.state,
      progress: p == null ? null : clamp01(p),
      stanceResult: null,
      sustainedCues: [],
      restRemainingSec: null,
      lastAttempt: rep.lastAttempt,
      repCompleted: null,
      attemptCompleted: null,
      ...overrides,
    };
  }

  // ── SETUP_STANCE ─────────────────────────────────────────────────────────
  _tickSetup(g, now) {
    if (!this._setupBeginSent) {
      this._setupBeginSent = true;
      this._speak(SR_VOICE_MSG.setup_begin, { key: 'sr_setup_begin', cooldownMs: 0, immediate: true });
    }

    if (!g) {
      this._stancePassSince = -1;
      this._calibSamples = [];
      this._maybeIssueInstruction('sr_no_person', now);
      return this._result(g, now, {
        status: SR_FEEDBACK.sr_no_person, statusKind: 'fail',
        activityReason: 'sr_out_of_frame',
        stanceResult: { ok: false, cueKeys: ['sr_no_person'], checks: {} },
      });
    }

    const st = evaluateRowSetup(g, this._confidence);

    if (!st.ok) {
      this._stancePassSince = -1;
      this._calibSamples = [];
      const key = firstByPriority(st.cueKeys, SR_SETUP_PRIORITY);
      this._maybeIssueInstruction(key, now);
      return this._result(g, now, {
        status: SR_FEEDBACK[key] || 'Get into your starting position', statusKind: 'warn',
        boneColor: SR_COLOR_AMBER,
        feedback: SR_FEEDBACK[key] || '',
        activityReason: 'sr_setup',
        stanceResult: { ...st, primaryKey: key },
      });
    }

    this._maybeIssueInstruction(null, now);
    if (this._stancePassSince < 0) this._stancePassSince = now;
    const a = g.arm;
    this._calibSamples.push({
      torso: g.T,
      elev: g.elev,
      depth: a.depth,
      back: a.back,
      wristDepth: a.wristDepth,
      sep: g.sep,
    });
    if (this._calibSamples.length > CALIB_MAX_SAMPLES) this._calibSamples.shift();

    if (now - this._stancePassSince >= SR_CFG.setup_hold_sec) {
      this._calibrate();
      this._phase = SR_PHASE.READY;
      this._readyStart = now;
      this._speakQueued(SR_VOICE_MSG.sr_stance_ok, { key: 'sr_stance_ok', cooldownMs: VOICE_CD_MS });
      this._setFeedback(SR_FEEDBACK.sr_stance_ok, now, 3);
      return this._result(g, now, {
        status: SR_FEEDBACK.sr_stance_ok, statusKind: 'ok',
        feedback: SR_FEEDBACK.sr_stance_ok,
        stanceResult: st,
      });
    }

    return this._result(g, now, {
      status: 'Starting position looks good — hold still…', statusKind: 'ok',
      activityReason: 'sr_setup',
      stanceResult: st,
      stanceHoldPct: clamp((now - this._stancePassSince) / SR_CFG.setup_hold_sec, 0, 1),
    });
  }

  _calibrate() {
    const s = this._calibSamples;
    const m = (k) => median(s.map((x) => x[k]));
    const seps = s.map((x) => x.sep).filter((v) => v != null);
    this._calib = {
      side: this._side,
      torso: m('torso'),
      elev0: m('elev'),
      // Hanging elbow / wrist below the torso line, × torso length.
      restDepth: clamp(m('depth'), 0.3, 1.2),
      restWristDepth: clamp(m('wristDepth'), 0.6, 2.2),
      // Hanging elbow offset along the back (+ = behind the shoulder).
      restBack: clamp(m('back'), -0.4, 0.4),
      // Far shoulder offset across the back; null when it was not visible enough.
      sep0: seps.length >= s.length / 2 ? median(seps) : null,
    };
    this._calibBySide[this._side] = this._calib;
    this._calibSamples = [];
  }

  // ── READY ────────────────────────────────────────────────────────────────
  _tickReady(g, now) {
    const elapsed = now - this._readyStart;
    if (elapsed >= SR_CFG.ready_min_sec && (!this._voiceBusy() || elapsed >= SR_CFG.ready_max_sec)) {
      // Recalibrating mid-set (working-side change) keeps the set's counts.
      if (!this._setStarted) {
        this._setStarted = true;
        this._rep.startSet(this._currentSet);
        this._mistakeGate.reset();
        if (this._currentSet > 1) {
          this._speakQueued(SR_VOICE_MSG.next_set(this._currentSet, this._targetSets), { key: `sr_next_set_${this._currentSet}` });
        }
      }
      this._phase = SR_PHASE.ACTIVE;
      this._lastMoveAt = -Infinity;
      this._notExSince = now;
      this._invalidStartSince = -1;
      this._activityReason = 'sr_arm_resting';
      return this._result(g, now, { status: `Row the dumbbell to your hip — rep ${this._rep.setCount + 1}`, statusKind: 'ok' });
    }
    this._activityReason = 'sr_ready';
    return this._result(g, now, {
      status: 'Get ready…', statusKind: 'ok',
      feedback: this._currentFeedback(now) || 'Get ready…',
    });
  }

  // ── ACTIVE ───────────────────────────────────────────────────────────────
  _setActivity(exercising, reason, now) {
    const next = exercising ? SR_ACTIVITY.EXERCISING : SR_ACTIVITY.NOT_EXERCISING;
    if (next !== this._activity) {
      this._activity = next;
      this._notExSince = exercising ? -1 : now;
    }
    this._activityReason = reason;
  }

  _isLongIdle(now) {
    return this._phase === SR_PHASE.ACTIVE
      && this._activity === SR_ACTIVITY.NOT_EXERCISING
      && this._notExSince >= 0
      && now - this._notExSince >= SR_CFG.long_idle_seconds;
  }

  /** Not tracking this frame (out of position / out of view): drop any rep in progress. */
  _notTracking(g, now, reason, status) {
    this._rep.abortInProgress();
    this._cueOnset.clear();
    this._invalidStartSince = -1;
    this._setActivity(false, reason, now);
    return this._result(g, now, {
      status, statusKind: 'warn',
      activity: this._activity, activityReason: reason,
      boneColor: SR_COLOR_GREY,
    });
  }

  _tickActive(g, now, dt, lostLong) {
    const rep = this._rep;

    if (!g) {
      if (lostLong) rep.abortInProgress();
      this._cueOnset.clear();
      this._setActivity(false, 'sr_out_of_frame', now);
      return this._result(g, now, {
        status: SR_FEEDBACK.sr_out_of_frame, statusKind: 'warn',
        activity: this._activity, activityReason: 'sr_out_of_frame',
        boneColor: SR_COLOR_GREY,
      });
    }

    if (!isBentOver(g, UPRIGHT_SLACK_DEG)) {
      return this._notTracking(g, now, 'sr_not_in_position', SR_FEEDBACK.sr_not_in_position);
    }
    if (!isSideOn(g)) {
      return this._notTracking(g, now, 'sr_not_side_on', SR_FEEDBACK.sr_not_side_on);
    }

    this._confidenceSum += this._confidence;
    this._confidenceFrames += 1;

    // Readiness gate: a poorly visible arm is treated as hidden — no counting,
    // no form metrics. The tracker drops the rep after `arm_missing_abort_sec`.
    const visible = this._confidence >= SR_CFG.min_view_confidence && g.arm.ok;
    const res = rep.update(g, this._calib, now, visible);

    if (!visible) {
      this._cueOnset.clear();
      this._invalidStartSince = -1;
      const exercising = rep.inProgress;
      this._setActivity(exercising, exercising ? 'sr_rep_in_progress' : 'sr_low_confidence', now);
      if (exercising) this._activeSec += dt;
      return this._result(g, now, {
        status: SR_FEEDBACK.sr_low_confidence, statusKind: 'warn',
        activity: this._activity, activityReason: this._activityReason,
        boneColor: SR_COLOR_GREY,
        lowConfidence: true,
      });
    }

    if (rep.inProgress) this._lastMoveAt = now;
    this._mistakeGate.track(rep.inProgress);
    const exercising = rep.inProgress || now - this._lastMoveAt <= SR_CFG.idle_seconds;
    this._setActivity(exercising, exercising ? 'sr_rep_in_progress' : 'sr_arm_resting', now);
    if (exercising) this._activeSec += dt;

    const sustained = this._sustained(rep.inProgress ? res.liveKeys : [], now);
    const shownLive = this._mistakeGate.filter(sustained);
    const primaryLive = shownLive.length ? firstByPriority(shownLive, SR_LIVE_PRIORITY) : null;
    if (primaryLive) {
      this._setFeedback(SR_FEEDBACK[primaryLive], now, 1.0);
      this._setMistake(primaryLive, now, LIVE_MISTAKE_HOLD_SEC);
      this._speakCorrection(primaryLive, now, { live: true });
    } else if (res.top && !this._currentFeedback(now)) {
      this._setFeedback('Top reached — control the way down', now, 1.0);
    }

    // Rowing from a position that never settled in the start zone.
    let invalidStart = false;
    if (rep.state === SR_ARM_STATE.WAIT_START) {
      if (this._invalidStartSince < 0) this._invalidStartSince = now;
      invalidStart = now - this._invalidStartSince >= INVALID_START_SEC;
    } else {
      this._invalidStartSince = -1;
    }
    if (invalidStart && !primaryLive) {
      this._setFeedback(SR_FEEDBACK.sr_invalid_start, now, 1.0);
      this._speakCorrection('sr_invalid_start', now, { live: true });
    }

    let repCompleted = null;
    const attempt = res.attempt;
    if (attempt) {
      if (attempt.counted) repCompleted = attempt;
      const setDone = this._onAttempt(attempt, now);
      if (setDone) return this._onSetComplete(g, now, attempt, repCompleted);
    }

    let boneColor = SR_COLOR_GREEN;
    if (sustained.length) boneColor = SR_COLOR_RED;
    else if (invalidStart) boneColor = SR_COLOR_AMBER;
    else if (!exercising) boneColor = SR_COLOR_GREY;

    let status;
    if (this._isLongIdle(now)) status = SR_FEEDBACK.sr_long_idle;
    else if (invalidStart) status = SR_FEEDBACK.sr_invalid_start;
    else if (!rep.inProgress) status = `Row the dumbbell to your hip — rep ${rep.setCount + 1}`;
    else if (rep.state === SR_ARM_STATE.TOP) status = 'Squeeze at the top…';
    else if (rep.state === SR_ARM_STATE.RETURNING) status = 'Lower all the way down…';
    else status = 'Pull your elbow up and back…';

    return this._result(g, now, {
      status,
      statusKind: shownLive.length || invalidStart ? 'warn' : 'ok',
      boneColor,
      activity: this._activity,
      activityReason: invalidStart ? 'sr_invalid_start' : this._activityReason,
      sustainedCues: sustained,
      repCompleted,
      attemptCompleted: attempt,
    });
  }

  /** @returns {boolean} true when this attempt finished the current set. */
  _onAttempt(a, now) {
    const rep = this._rep;
    const issue = this._mistakeGate.endRep(a.issues)[0] || null;
    const setDone = this._targetReps > 0 && rep.setCount >= this._targetReps;

    if (a.counted) {
      const setPart = this._targetSets > 0 ? `Set ${this._currentSet} of ${this._targetSets}, ` : '';
      const repPart = this._targetReps > 0 ? `Rep ${a.repInSet} of ${this._targetReps}` : `Rep ${a.repInSet}`;
      this._setBanner(`${setPart}${repPart}${a.clean ? ' ✓' : ''}`, now, 2.0);
      if (issue) this._setFeedback(SR_FEEDBACK[issue], now);
      else if (!a.issues.length) this._setFeedback('Good rep!', now);
      this._speakQueued(SR_VOICE_MSG.rep(a.repInSet), { key: `sr_rep_${this._currentSet}_${a.repInSet}_${a.attempt}` });
    } else {
      this._setBanner('Rep not counted', now, 2.0);
      if (issue) this._setFeedback(SR_FEEDBACK[issue], now);
    }

    if (issue) {
      this._setMistake(issue, now, REP_MISTAKE_HOLD_SEC);
      this._speakCorrection(issue, now);
    }
    return setDone;
  }

  _onSetComplete(g, now, attempt, repCompleted) {
    this._setsCompleted += 1;
    const finished = this._targetSets > 0 && this._setsCompleted >= this._targetSets;
    this._setActivity(false, finished ? 'sr_complete' : 'sr_resting_between_sets', now);
    this._rep.abortInProgress();

    if (finished) {
      this._phase = SR_PHASE.COMPLETE;
      this._final = this.summary();
      this._speakQueued(SR_VOICE_MSG.all_done, { key: 'sr_all_done' });
      this._setBanner('All sets complete!', now, 60);
      return this._result(g, now, {
        status: 'All sets complete!', statusKind: 'ok',
        repCompleted, attemptCompleted: attempt,
        activityReason: 'sr_complete',
      });
    }

    this._phase = SR_PHASE.REST_BETWEEN_SETS;
    this._restStart = now;
    this._restResumeSince = -1;
    this._restOverSpoken = false;
    const n = this._setsCompleted;
    this._setBanner(`Set ${n} complete`, now, 4);
    this._speakQueued(SR_VOICE_MSG.set_done(n), { key: `sr_set_done_${n}` });
    return this._result(g, now, {
      status: `Set ${n} complete — rest`, statusKind: 'ok',
      repCompleted, attemptCompleted: attempt,
      activityReason: 'sr_resting_between_sets',
      restRemainingSec: this._restDuration(),
    });
  }

  // ── REST_BETWEEN_SETS ────────────────────────────────────────────────────
  _restDuration() {
    return this._restSec ?? SR_CFG.rest_default_sec;
  }

  _startNextSet(now) {
    this._currentSet += 1;
    this._setStarted = false;
    this._restResumeSince = -1;
    if (this._calib) {
      this._phase = SR_PHASE.READY;
      this._readyStart = now;
    } else {
      this._phase = SR_PHASE.SETUP_STANCE;
      this._stancePassSince = -1;
      this._calibSamples = [];
    }
    this._setBanner(`Set ${this._currentSet}${this._targetSets ? ` of ${this._targetSets}` : ''}`, now, 2);
  }

  _tickRest(g, now) {
    const remaining = Math.max(0, this._restDuration() - (now - this._restStart));
    if (remaining <= 0 && !this._restOverSpoken) {
      this._restOverSpoken = true;
      this._speakQueued(SR_VOICE_MSG.rest_over(this._currentSet + 1), { key: `sr_rest_over_${this._currentSet}` });
    }

    const inStart = !!g && evaluateRowSetup(g, this._confidence).ok;
    if (inStart) {
      if (this._restResumeSince < 0) this._restResumeSince = now;
    } else {
      this._restResumeSince = -1;
    }

    if (remaining <= 0 && inStart && now - this._restResumeSince >= SR_CFG.rest_resume_hold_sec) {
      this._startNextSet(now);
      return this._result(g, now, { status: 'Starting next set…', statusKind: 'ok' });
    }

    const status = remaining > 0
      ? `Rest — next set in ${Math.ceil(remaining)} s`
      : 'Get back into your starting position to start the next set';
    return this._result(g, now, {
      status, statusKind: 'info',
      activityReason: 'sr_resting_between_sets',
      boneColor: SR_COLOR_GREY,
      restRemainingSec: Math.ceil(remaining),
    });
  }

  // ── Debug ────────────────────────────────────────────────────────────────
  _debugLog(fr, g, now) {
    const n = Math.max(1, Math.round(SR_CFG.debug_log_every_n));
    if (this._frameNo % n !== 0) return;
    if (!this._debugHeaderSent) {
      this._debugHeaderSent = true;
      // eslint-disable-next-line no-console
      console.log('[SR] t,phase,activity,side,confidence,torsoPx,torsoDeg,elbowDepth,elbowBack,wristDepth,extension,farShoulder,progressPct,state,reps,setReps,liveCues');
    }
    const a = g?.arm;
    // eslint-disable-next-line no-console
    console.log([
      '[SR]', fmt(now, 2), fr.phase, fr.activity, fr.side, fmt(fr.confidence),
      fmt(g?.T, 1), fmt(g?.elev, 1),
      fmt(a?.depth), fmt(a?.back), fmt(a?.wristDepth), fmt(a?.extension), fmt(g?.sep),
      fmt(fr.progress == null ? null : fr.progress * 100, 1), fr.armState,
      fr.repCount, fr.setRepCount,
      (this._rep.live.liveKeys || []).join('|'),
    ].join(','));
  }

  reset() {
    this._voice.cancel();
    this._voice.resetCooldowns();
    this._rep = new SingleArmDumbbellRowRepTracker();
    this._resetState();
  }
}
