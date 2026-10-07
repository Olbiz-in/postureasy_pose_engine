// Dumbbell lateral raise (front view) — coaching state machine.
//
// Phases:
//   SETUP_STANCE       — upright, feet ≈ shoulder width, arms down, facing the
//                        camera, held ~1 s → calibration (shoulder width,
//                        resting elbow / wrist height, shoulder tilt baseline)
//   READY              — short settle (lets the stance voice line finish)
//   ACTIVE             — rep counting per set; says "Rep N" after each rep
//   REST_BETWEEN_SETS  — not scored; resumes via continueNextSet() or
//                        automatically once back in stance after the rest time
//   COMPLETE           — all sets done, or finish() (Stop) was called
//
// Only rep windows are scored. Time spent NOT DOING EXERCISE (arms resting,
// turned away, out of frame) never counts toward active time or any metric.

import { VoiceManager } from '../../core/voiceManager.js';
import { nowSec } from '../../core/landmarks.js';
import {
  LR_CFG, LR_FEEDBACK, LR_VOICE_MSG, LR_STANCE_PRIORITY, LR_TRACKED_LANDMARKS,
  LR_COLOR_GREEN, LR_COLOR_AMBER, LR_COLOR_RED, LR_COLOR_GREY,
} from './config.js';
import { LandmarkSmoother } from '../common/landmarkSmoother.js';
import { RepeatMistakeGate } from '../common/repeatMistakeGate.js';
import { firstByPriority, median, clamp, fmt } from '../common/math.js';
import { buildGeometry, evaluateStance, facingRatio, armLift } from './poseChecks.js';
import { LateralRaiseRepTracker, summarizeLateralRaise } from './LateralRaiseRepTracker.js';

export const LR_PHASE = {
  SETUP_STANCE: 'lr_setup_stance',
  READY: 'lr_ready',
  ACTIVE: 'lr_active',
  REST_BETWEEN_SETS: 'lr_rest_between_sets',
  COMPLETE: 'lr_complete',
};

export const LR_ACTIVITY = {
  EXERCISING: 'exercising',
  NOT_EXERCISING: 'not_exercising',
};

const VOICE_CD_MS = 10_000;
const LIVE_CUE_SUSTAIN_SEC = 0.3;
const LIVE_MISTAKE_HOLD_SEC = 1.5;
const REP_MISTAKE_HOLD_SEC = 3.0;
const INSTRUCTION_CONFIRM_SEC = 0.4;
const INSTRUCTION_MIN_WAIT_SEC = 2.5;
const FEEDBACK_HOLD_SEC = 2.5;
const MAX_SW_DECAY = 0.998;
const CALIB_MAX_SAMPLES = 60;

export class LateralRaiseFlow {
  constructor({ targetReps = 10, targetSets = 3, restSeconds = null, voice = true } = {}) {
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps > 0 ? targetReps : 0;
    this._targetSets = targetSets > 0 ? targetSets : (this._targetReps > 0 ? 1 : 0);
    this._restSec = restSeconds > 0 ? restSeconds : null;
    this._rep = new LateralRaiseRepTracker();
    this._smoother = new LandmarkSmoother(LR_CFG, LR_TRACKED_LANDMARKS);
    this._resetState();
  }

  _resetState() {
    this._phase = LR_PHASE.SETUP_STANCE;
    this._smoother.reset();
    this._calib = null;
    this._maxSw = 0;
    this._stancePassSince = -1;
    this._calibSamples = [];
    this._setupBeginSent = false;
    this._lastInstructionKey = '';
    this._lastInstructionAt = -1;
    this._pendingInstructionKey = '';
    this._pendingInstructionSince = -1;

    this._readyStart = -1;
    this._currentSet = 1;
    this._setsCompleted = 0;
    this._restStart = -1;
    this._restResumeSince = -1;

    this._activity = LR_ACTIVITY.NOT_EXERCISING;
    this._activityReason = 'lr_setup';
    this._lastMoveAt = -Infinity;
    this._notExSince = -1;
    this._lostSince = -1;

    this._activeSec = 0;
    this._sessionSec = 0;
    this._lastTickAt = -1;

    this._cueOnset = new Map();
    this._mistakeGate = new RepeatMistakeGate();
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

  // ── Voice helpers ────────────────────────────────────────────────────────
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
    this._speak(LR_VOICE_MSG[key], { key: `lr_instr_${key}`, cooldownMs: VOICE_CD_MS });
  }

  _sustained(keys, now) {
    const active = new Set(keys.filter(Boolean));
    for (const k of active) if (!this._cueOnset.has(k)) this._cueOnset.set(k, now);
    for (const k of [...this._cueOnset.keys()]) if (!active.has(k)) this._cueOnset.delete(k);
    return [...active].filter((k) => now - this._cueOnset.get(k) >= LIVE_CUE_SUSTAIN_SEC);
  }

  /** Form mistakes are overlay-only for lateral raise — never voiced. */
  _setMistake(key, now, holdSec) {
    const text = LR_FEEDBACK[key];
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

  setTargetReps(n) {
    this._targetReps = n > 0 ? n : 0;
  }

  /** Skip the rest countdown and start the next set now. */
  continueNextSet() {
    if (this._phase !== LR_PHASE.REST_BETWEEN_SETS) return false;
    this._startNextSet(nowSec());
    return true;
  }

  /** Stop: close the session and return the summary of everything done so far. */
  finish() {
    if (this._phase !== LR_PHASE.COMPLETE) {
      this._stoppedEarly = true;
      this._stoppedInPhase = this._phase;
      this._rep.abortInProgress();
      this._phase = LR_PHASE.COMPLETE;
      this._final = this.summary();
    }
    return this._final || this.summary();
  }

  summary() {
    const s = summarizeLateralRaise(this._rep.attempts, {
      activeSec: this._activeSec,
      sessionSec: this._sessionSec,
      setsCompleted: this._setsCompleted,
      targetSets: this._targetSets,
      targetReps: this._targetReps,
      stoppedEarly: this._stoppedEarly,
    });
    const phase = this._stoppedEarly ? this._stoppedInPhase : this._phase;
    s.partialSetReps = phase === LR_PHASE.ACTIVE ? this._rep.setCount : 0;
    s.currentSet = this._currentSet;
    return s;
  }

  // ── Frame tick ───────────────────────────────────────────────────────────
  tick(landmarks, w, h) {
    const now = nowSec();
    const dt = this._lastTickAt < 0 ? 0 : clamp(now - this._lastTickAt, 0, 0.25);
    this._lastTickAt = now;
    this._frameNo += 1;

    const pts = this._smoother.update(landmarks, w, h, now);
    const g = buildGeometry(pts, this._calib);
    if (g) this._lostSince = -1;
    else if (this._lostSince < 0) this._lostSince = now;
    const lostLong = !g && this._lostSince >= 0 && now - this._lostSince >= LR_CFG.person_lost_sec;

    let fr;
    switch (this._phase) {
      case LR_PHASE.SETUP_STANCE:
        fr = this._tickSetup(g, now);
        break;
      case LR_PHASE.READY:
        fr = this._tickReady(g, now);
        break;
      case LR_PHASE.ACTIVE:
        fr = this._tickActive(g, now, dt, lostLong);
        break;
      case LR_PHASE.REST_BETWEEN_SETS:
        fr = this._tickRest(g, now);
        break;
      default:
        fr = this._result(g, now, {
          status: this._stoppedEarly ? 'Session stopped' : 'All sets complete!',
          activityReason: 'lr_complete',
        });
    }

    const counting = this._phase !== LR_PHASE.COMPLETE && this._phase !== LR_PHASE.SETUP_STANCE;
    const longIdle = this._isLongIdle(now);
    if (counting && !longIdle) this._sessionSec += dt;
    fr.timerPaused = longIdle;

    if (LR_CFG.debug) this._debugLog(fr, g, now);
    return fr;
  }

  _result(g, now, overrides = {}) {
    const rep = this._rep;
    return {
      phase: this._phase,
      poseDetected: !!g,
      geometry: g,
      calib: this._calib,
      status: '',
      statusKind: 'info',
      boneColor: LR_COLOR_GREEN,
      activity: LR_ACTIVITY.NOT_EXERCISING,
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
      armStates: { left: rep.armState('left'), right: rep.armState('right') },
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
      this._speak(LR_VOICE_MSG.setup_begin, { key: 'lr_setup_begin', cooldownMs: 0, immediate: true });
    }

    if (!g) {
      this._stancePassSince = -1;
      this._calibSamples = [];
      this._maybeIssueInstruction('lr_no_person', now);
      return this._result(g, now, {
        status: LR_FEEDBACK.lr_no_person, statusKind: 'fail',
        activityReason: 'lr_out_of_frame',
        stanceResult: { ok: false, cueKeys: ['lr_no_person'], checks: {} },
      });
    }

    this._maxSw = Math.max(g.sw, this._maxSw * MAX_SW_DECAY);
    const st = evaluateStance(g, this._maxSw);

    if (!st.ok) {
      this._stancePassSince = -1;
      this._calibSamples = [];
      const key = firstByPriority(st.cueKeys, LR_STANCE_PRIORITY);
      this._maybeIssueInstruction(key, now);
      return this._result(g, now, {
        status: LR_FEEDBACK[key] || 'Adjust your stance', statusKind: 'warn',
        boneColor: LR_COLOR_AMBER,
        feedback: LR_FEEDBACK[key] || '',
        activityReason: 'lr_setup',
        stanceResult: { ...st, primaryKey: key },
      });
    }

    this._maybeIssueInstruction(null, now);
    if (this._stancePassSince < 0) this._stancePassSince = now;
    this._calibSamples.push({
      sw: g.sw,
      torso: g.torsoDist,
      tilt: (g.ls.y - g.rs.y) / g.sw,
      eL: (g.left.elbow.y - g.left.lineY) / g.sw,
      eR: (g.right.elbow.y - g.right.lineY) / g.sw,
      wL: (g.left.wrist.y - g.left.lineY) / g.sw,
      wR: (g.right.wrist.y - g.right.lineY) / g.sw,
    });
    if (this._calibSamples.length > CALIB_MAX_SAMPLES) this._calibSamples.shift();

    if (now - this._stancePassSince >= LR_CFG.stance_hold_sec) {
      this._calibrate();
      this._phase = LR_PHASE.READY;
      this._readyStart = now;
      this._speakQueued(LR_VOICE_MSG.lr_stance_ok, { key: 'lr_stance_ok' });
      this._setFeedback(LR_FEEDBACK.lr_stance_ok, now, 3);
      return this._result(g, now, {
        status: LR_FEEDBACK.lr_stance_ok, statusKind: 'ok',
        feedback: LR_FEEDBACK.lr_stance_ok,
        stanceResult: st,
      });
    }

    return this._result(g, now, {
      status: 'Stance looks good — hold still…', statusKind: 'ok',
      activityReason: 'lr_setup',
      stanceResult: st,
      stanceHoldPct: clamp((now - this._stancePassSince) / LR_CFG.stance_hold_sec, 0, 1),
    });
  }

  _calibrate() {
    const s = this._calibSamples;
    const m = (k) => median(s.map((x) => x[k]));
    this._calib = {
      sw: m('sw'),
      torso: m('torso'),
      tilt0: m('tilt'),
      restElbow: { left: clamp(m('eL'), 0.5, 1.6), right: clamp(m('eR'), 0.5, 1.6) },
      restWrist: { left: clamp(m('wL'), 1.0, 2.6), right: clamp(m('wR'), 1.0, 2.6) },
    };
    this._calibSamples = [];
  }

  // ── READY ────────────────────────────────────────────────────────────────
  _tickReady(g, now) {
    const elapsed = now - this._readyStart;
    if (elapsed >= LR_CFG.ready_min_sec && (!this._voiceBusy() || elapsed >= LR_CFG.ready_max_sec)) {
      this._rep.startSet(this._currentSet);
      this._mistakeGate.reset();
      this._phase = LR_PHASE.ACTIVE;
      this._lastMoveAt = -Infinity;
      this._notExSince = now;
      this._activityReason = 'lr_arms_resting';
      return this._result(g, now, { status: 'Raise both arms — rep 1', statusKind: 'ok' });
    }
    this._activityReason = 'lr_ready';
    return this._result(g, now, {
      status: 'Get ready…', statusKind: 'ok',
      feedback: this._currentFeedback(now) || 'Get ready…',
    });
  }

  // ── ACTIVE ───────────────────────────────────────────────────────────────
  _setActivity(exercising, reason, now) {
    const next = exercising ? LR_ACTIVITY.EXERCISING : LR_ACTIVITY.NOT_EXERCISING;
    if (next !== this._activity) {
      this._activity = next;
      if (exercising) {
        this._notExSince = -1;
      } else {
        this._notExSince = now;
      }
    }
    this._activityReason = reason;
  }

  _isLongIdle(now) {
    return this._phase === LR_PHASE.ACTIVE
      && this._activity === LR_ACTIVITY.NOT_EXERCISING
      && this._notExSince >= 0
      && now - this._notExSince >= LR_CFG.long_idle_seconds;
  }

  _tickActive(g, now, dt, lostLong) {
    const rep = this._rep;

    if (!g) {
      if (lostLong) rep.abortInProgress();
      this._setActivity(false, 'lr_out_of_frame', now);
      return this._result(g, now, {
        status: LR_FEEDBACK.lr_out_of_frame, statusKind: 'warn',
        activity: this._activity, activityReason: 'lr_out_of_frame',
        boneColor: LR_COLOR_GREY,
      });
    }

    if (facingRatio(g, this._calib) < LR_CFG.turn_ratio) {
      rep.abortInProgress();
      this._setActivity(false, 'lr_turned_away', now);
      return this._result(g, now, {
        status: 'Face the camera to continue', statusKind: 'warn',
        activity: this._activity, activityReason: 'lr_turned_away',
        boneColor: LR_COLOR_GREY,
      });
    }

    const res = rep.update(g, this._calib, now);
    if (rep.inProgress) this._lastMoveAt = now;
    this._mistakeGate.track(rep.inProgress);
    const exercising = rep.inProgress || now - this._lastMoveAt <= LR_CFG.idle_seconds;
    this._setActivity(exercising, exercising ? 'lr_rep_in_progress' : 'lr_arms_resting', now);
    if (exercising) this._activeSec += dt;

    const sustained = rep.inProgress ? this._sustained(res.liveKeys, now) : this._sustained([], now);
    const shownLive = this._mistakeGate.filter(sustained);
    const primaryLive = shownLive.includes('lr_wrist_above')
      ? 'lr_wrist_above'
      : shownLive[0] || null;
    if (primaryLive) {
      this._setFeedback(LR_FEEDBACK[primaryLive], now, 1.0);
      this._setMistake(primaryLive, now, LIVE_MISTAKE_HOLD_SEC);
    } else if (res.topSides.length && !this._currentFeedback(now)) {
      this._setFeedback('Top reached — lower with control', now, 1.0);
    }

    let repCompleted = null;
    const attempt = res.attempt;
    if (attempt) {
      if (attempt.counted) repCompleted = attempt;
      const setDone = this._onAttempt(attempt, now);
      if (setDone) return this._onSetComplete(g, now, attempt, repCompleted);
    }

    let boneColor = LR_COLOR_GREEN;
    if (sustained.length) boneColor = LR_COLOR_RED;
    else if (!exercising) boneColor = LR_COLOR_GREY;

    let status;
    if (this._isLongIdle(now)) status = LR_FEEDBACK.lr_long_idle;
    else if (!rep.inProgress) status = `Raise both arms — rep ${rep.setCount + 1}`;
    else if (res.topSides.length || rep.armState('left') === 'UP') status = 'Elbows to the shoulder line…';
    else status = 'Raise both arms…';

    return this._result(g, now, {
      status,
      statusKind: shownLive.length ? 'warn' : 'ok',
      boneColor,
      activity: this._activity,
      activityReason: this._activityReason,
      sustainedCues: sustained,
      repCompleted,
      attemptCompleted: attempt,
      liftProgress: this._liftProgress(g),
    });
  }

  _liftProgress(g) {
    const lifts = ['left', 'right']
      .map((s) => armLift(g[s], this._calib)?.elbow)
      .filter((v) => v != null);
    return lifts.length ? clamp(Math.min(...lifts), 0, 1) : 0;
  }

  /** @returns {boolean} true when this attempt finished the current set. */
  _onAttempt(a, now) {
    const rep = this._rep;
    const issue = this._mistakeGate.endRep(a.issues)[0] || null;
    const setDone = this._targetReps > 0 && rep.setCount >= this._targetReps;

    // The count is the only thing lateral raise ever says during the workout.
    this._speak(`Rep ${a.repInSet}`, {
      key: `lr_rep_${this._currentSet}_${a.repInSet}`, cooldownMs: 0, immediate: true,
    });

    const setPart = this._targetSets > 0 ? `Set ${this._currentSet} of ${this._targetSets}, ` : '';
    const repPart = this._targetReps > 0 ? `Rep ${a.repInSet} of ${this._targetReps}` : `Rep ${a.repInSet}`;
    this._setBanner(`${setPart}${repPart}${a.clean ? ' ✓' : ''}`, now, 2.0);
    if (issue) this._setFeedback(LR_FEEDBACK[issue], now);
    else if (!a.issues.length) this._setFeedback('Good rep!', now);
    if (issue) this._setMistake(issue, now, REP_MISTAKE_HOLD_SEC);
    return setDone;
  }

  _onSetComplete(g, now, attempt, repCompleted) {
    this._setsCompleted += 1;
    const finished = this._targetSets > 0 && this._setsCompleted >= this._targetSets;
    this._setActivity(false, finished ? 'lr_complete' : 'lr_resting_between_sets', now);

    if (finished) {
      this._phase = LR_PHASE.COMPLETE;
      this._final = this.summary();
      this._setBanner('All sets complete!', now, 60);
      return this._result(g, now, {
        status: 'All sets complete!', statusKind: 'ok',
        repCompleted, attemptCompleted: attempt,
        activityReason: 'lr_complete',
      });
    }

    this._phase = LR_PHASE.REST_BETWEEN_SETS;
    this._restStart = now;
    this._restResumeSince = -1;
    const n = this._setsCompleted;
    this._setBanner(`Set ${n} complete`, now, 4);
    return this._result(g, now, {
      status: `Set ${n} complete — rest`, statusKind: 'ok',
      repCompleted, attemptCompleted: attempt,
      activityReason: 'lr_resting_between_sets',
      restRemainingSec: this._restDuration(),
    });
  }

  // ── REST_BETWEEN_SETS ────────────────────────────────────────────────────
  _restDuration() {
    return this._restSec ?? LR_CFG.rest_default_sec;
  }

  _startNextSet(now) {
    this._currentSet += 1;
    this._phase = LR_PHASE.READY;
    this._readyStart = now;
    this._restResumeSince = -1;
    this._setBanner(`Set ${this._currentSet}${this._targetSets ? ` of ${this._targetSets}` : ''}`, now, 2);
  }

  _tickRest(g, now) {
    const remaining = Math.max(0, this._restDuration() - (now - this._restStart));
    let inStance = false;
    if (g && this._calib) {
      const st = evaluateStance(g, g.norm);
      inStance = st.ok;
    }
    if (inStance) {
      if (this._restResumeSince < 0) this._restResumeSince = now;
    } else {
      this._restResumeSince = -1;
    }

    if (remaining <= 0 && inStance && now - this._restResumeSince >= LR_CFG.rest_resume_hold_sec) {
      this._startNextSet(now);
      return this._result(g, now, { status: 'Starting next set…', statusKind: 'ok' });
    }

    const status = remaining > 0
      ? `Rest — next set in ${Math.ceil(remaining)} s`
      : 'Stand in your stance, arms down, to start the next set';
    return this._result(g, now, {
      status, statusKind: 'info',
      activityReason: 'lr_resting_between_sets',
      boneColor: LR_COLOR_GREY,
      restRemainingSec: Math.ceil(remaining),
    });
  }

  // ── Debug ────────────────────────────────────────────────────────────────
  _debugLog(fr, g, now) {
    const n = Math.max(1, Math.round(LR_CFG.debug_log_every_n));
    if (this._frameNo % n !== 0) return;
    if (!this._debugHeaderSent) {
      this._debugHeaderSent = true;
      // eslint-disable-next-line no-console
      console.log('[LR] t,phase,activity,shoulderY,L_elbowY,L_wristY,R_elbowY,R_wristY,L_elbowDy,L_wristDy,R_elbowDy,R_wristDy,L_state,R_state,sw,norm,reps,setReps');
    }
    const L = g?.left;
    const R = g?.right;
    // eslint-disable-next-line no-console
    console.log([
      '[LR]', fmt(now, 2), fr.phase, fr.activity,
      fmt(g?.shY, 1),
      fmt(L?.elbow?.y, 1), fmt(L?.wrist?.y, 1),
      fmt(R?.elbow?.y, 1), fmt(R?.wrist?.y, 1),
      fmt(L?.elbowDy), fmt(L?.wristDy), fmt(R?.elbowDy), fmt(R?.wristDy),
      fr.armStates.left, fr.armStates.right,
      fmt(g?.sw, 1), fmt(g?.norm, 1),
      fr.repCount, fr.setRepCount,
    ].join(','));
  }

  reset() {
    this._voice.cancel();
    this._voice.resetCooldowns();
    this._rep = new LateralRaiseRepTracker();
    this._resetState();
  }
}
