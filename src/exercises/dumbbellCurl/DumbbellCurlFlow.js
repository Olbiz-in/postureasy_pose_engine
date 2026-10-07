// Dumbbell curl (front view) — coaching state machine.
//
// Phases:
//   SETUP_STANCE       — upright, feet ≈ shoulder width, arms hanging down,
//                        facing the camera, held ~1 s → calibration (shoulder
//                        width, torso length, resting wrist / elbow height,
//                        REST_SPAN per arm, resting elbow–hip offset, tilt)
//   READY              — short settle, then rep counting starts
//   ACTIVE             — rep counting per set
//   REST_BETWEEN_SETS  — not scored; resumes via continueNextSet() or
//                        automatically once back in stance after the rest time
//   COMPLETE           — all sets done, or finish() (Stop) was called
//
// Only rep windows are scored. Time spent NOT DOING EXERCISE (arms resting,
// turned away, out of frame) never counts toward active time or any metric.
//
// Voice policy: only "stance correct", rep counts, set complete, rest prompts
// and next-set starts are spoken (the app speaks the final summary). Form
// mistakes and stance corrections are on-screen text only.

import { VoiceManager } from '../../core/voiceManager.js';
import { nowSec } from '../../core/landmarks.js';
import {
  DC_CFG, DC_FEEDBACK, DC_VOICE_MSG, DC_STANCE_PRIORITY, DC_LIVE_PRIORITY, DC_TRACKED_LANDMARKS,
  DC_COLOR_GREEN, DC_COLOR_AMBER, DC_COLOR_RED, DC_COLOR_GREY,
} from './config.js';
import { LandmarkSmoother } from '../common/landmarkSmoother.js';
import { RepeatMistakeGate } from '../common/repeatMistakeGate.js';
import { firstByPriority, median, clamp, clamp01, fmt } from '../common/math.js';
import { buildCurlGeometry, evaluateCurlStance, facingRatio, curlProgress } from './poseChecks.js';
import { DumbbellCurlRepTracker, summarizeDumbbellCurl } from './DumbbellCurlRepTracker.js';

export const DC_PHASE = {
  SETUP_STANCE: 'dc_setup_stance',
  READY: 'dc_ready',
  ACTIVE: 'dc_active',
  REST_BETWEEN_SETS: 'dc_rest_between_sets',
  COMPLETE: 'dc_complete',
};

export const DC_ACTIVITY = {
  EXERCISING: 'exercising',
  NOT_EXERCISING: 'not_exercising',
};

const LIVE_CUE_SUSTAIN_SEC = 0.3;
const LIVE_MISTAKE_HOLD_SEC = 1.5;
const REP_MISTAKE_HOLD_SEC = 3.0;
const FEEDBACK_HOLD_SEC = 2.5;
const MAX_SW_DECAY = 0.998;
const CALIB_MAX_SAMPLES = 60;

export class DumbbellCurlFlow {
  constructor({ targetReps = 10, targetSets = 3, restSeconds = null, voice = true } = {}) {
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps > 0 ? targetReps : 0;
    this._targetSets = targetSets > 0 ? targetSets : (this._targetReps > 0 ? 1 : 0);
    this._restSec = restSeconds > 0 ? restSeconds : null;
    this._rep = new DumbbellCurlRepTracker();
    this._smoother = new LandmarkSmoother(DC_CFG, DC_TRACKED_LANDMARKS);
    this._resetState();
  }

  _resetState() {
    this._phase = DC_PHASE.SETUP_STANCE;
    this._smoother.reset();
    this._calib = null;
    this._maxSw = 0;
    this._stancePassSince = -1;
    this._calibSamples = [];

    this._readyStart = -1;
    this._currentSet = 1;
    this._setsCompleted = 0;
    this._restStart = -1;
    this._restResumeSince = -1;
    this._restOverSpoken = false;

    this._activity = DC_ACTIVITY.NOT_EXERCISING;
    this._activityReason = 'dc_setup';
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

  // ── Voice / text helpers ─────────────────────────────────────────────────
  _speakQueued(text, opts) {
    if (!this._voiceEnabled || !text) return false;
    return this._voice.speakQueued(text, opts);
  }

  _voiceBusy() {
    return this._voiceEnabled && this._voice.isBusy();
  }

  _issueText(key) {
    if (key === 'dc_incomplete' && this._rep.mode === 'alternate') return DC_FEEDBACK.dc_incomplete_alt;
    return DC_FEEDBACK[key] || '';
  }

  _sustained(keys, now) {
    const active = new Set(keys.filter(Boolean));
    for (const k of active) if (!this._cueOnset.has(k)) this._cueOnset.set(k, now);
    for (const k of [...this._cueOnset.keys()]) if (!active.has(k)) this._cueOnset.delete(k);
    return [...active].filter((k) => now - this._cueOnset.get(k) >= LIVE_CUE_SUSTAIN_SEC);
  }

  /** Form mistakes are on-screen only — never voiced. */
  _setMistake(key, now, holdSec) {
    const text = this._issueText(key);
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
    if (this._phase !== DC_PHASE.REST_BETWEEN_SETS) return false;
    this._startNextSet(nowSec());
    return true;
  }

  /** Stop: close the session and return the summary of everything done so far. */
  finish() {
    if (this._phase !== DC_PHASE.COMPLETE) {
      this._stoppedEarly = true;
      this._stoppedInPhase = this._phase;
      this._rep.finalize(this._calib, nowSec());
      this._phase = DC_PHASE.COMPLETE;
      this._final = this.summary();
    }
    return this._final || this.summary();
  }

  summary() {
    const s = summarizeDumbbellCurl(this._rep.attempts, {
      activeSec: this._activeSec,
      sessionSec: this._sessionSec,
      setsCompleted: this._setsCompleted,
      targetSets: this._targetSets,
      targetReps: this._targetReps,
      stoppedEarly: this._stoppedEarly,
      mode: this._rep.mode,
    });
    const phase = this._stoppedEarly ? this._stoppedInPhase : this._phase;
    s.partialSetReps = phase === DC_PHASE.ACTIVE ? this._rep.setCount : 0;
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
    const g = buildCurlGeometry(pts, this._calib);
    if (g) this._lostSince = -1;
    else if (this._lostSince < 0) this._lostSince = now;
    const lostLong = !g && this._lostSince >= 0 && now - this._lostSince >= DC_CFG.person_lost_sec;

    let fr;
    switch (this._phase) {
      case DC_PHASE.SETUP_STANCE:
        fr = this._tickSetup(g, now);
        break;
      case DC_PHASE.READY:
        fr = this._tickReady(g, now);
        break;
      case DC_PHASE.ACTIVE:
        fr = this._tickActive(g, now, dt, lostLong);
        break;
      case DC_PHASE.REST_BETWEEN_SETS:
        fr = this._tickRest(g, now);
        break;
      default:
        fr = this._result(g, now, {
          status: this._stoppedEarly ? 'Session stopped' : 'All sets complete!',
          activityReason: 'dc_complete',
        });
    }

    const counting = this._phase !== DC_PHASE.COMPLETE && this._phase !== DC_PHASE.SETUP_STANCE;
    const longIdle = this._isLongIdle(now);
    if (counting && !longIdle) this._sessionSec += dt;
    fr.timerPaused = longIdle;

    if (DC_CFG.debug) this._debugLog(fr, g, now);
    return fr;
  }

  _armProgress(g) {
    const p = (side) => {
      const v = g ? curlProgress(g[side], this._calib) : null;
      return v == null ? null : clamp01(v);
    };
    return { left: p('left'), right: p('right') };
  }

  _result(g, now, overrides = {}) {
    const rep = this._rep;
    return {
      phase: this._phase,
      poseDetected: !!g,
      geometry: g,
      calib: this._calib,
      mode: rep.mode,
      status: '',
      statusKind: 'info',
      boneColor: DC_COLOR_GREEN,
      activity: DC_ACTIVITY.NOT_EXERCISING,
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
      armProgress: this._calib ? this._armProgress(g) : { left: null, right: null },
      stanceResult: null,
      sustainedCues: [],
      restRemainingSec: null,
      lastAttempt: rep.lastAttempt,
      repsCompleted: [],
      attemptsCompleted: [],
      ...overrides,
    };
  }

  // ── SETUP_STANCE ─────────────────────────────────────────────────────────
  _tickSetup(g, now) {
    if (!g) {
      this._stancePassSince = -1;
      this._calibSamples = [];
      return this._result(g, now, {
        status: DC_FEEDBACK.dc_no_person, statusKind: 'fail',
        activityReason: 'dc_out_of_frame',
        stanceResult: { ok: false, cueKeys: ['dc_no_person'], checks: {} },
      });
    }

    this._maxSw = Math.max(g.sw, this._maxSw * MAX_SW_DECAY);
    const st = evaluateCurlStance(g, this._maxSw);

    if (!st.ok) {
      this._stancePassSince = -1;
      this._calibSamples = [];
      const key = firstByPriority(st.cueKeys, DC_STANCE_PRIORITY);
      return this._result(g, now, {
        status: DC_FEEDBACK[key] || 'Adjust your stance', statusKind: 'warn',
        boneColor: DC_COLOR_AMBER,
        feedback: DC_FEEDBACK[key] || '',
        activityReason: 'dc_setup',
        stanceResult: { ...st, primaryKey: key },
      });
    }

    if (this._stancePassSince < 0) this._stancePassSince = now;
    const L = g.left;
    const R = g.right;
    this._calibSamples.push({
      sw: g.sw,
      torso: g.torsoDist,
      tilt: (g.ls.y - g.rs.y) / g.sw,
      sL: L.span, sR: R.span,
      eL: L.elbowDy, eR: R.elbowDy,
      oL: L.elbowOut, oR: R.elbowOut,
      wyL: L.wrist.y, wyR: R.wrist.y,
      eyL: L.elbow.y, eyR: R.elbow.y,
    });
    if (this._calibSamples.length > CALIB_MAX_SAMPLES) this._calibSamples.shift();

    if (now - this._stancePassSince >= DC_CFG.stance_hold_sec) {
      this._calibrate();
      this._phase = DC_PHASE.READY;
      this._readyStart = now;
      this._speakQueued(DC_VOICE_MSG.dc_stance_ok, { key: 'dc_stance_ok' });
      this._setFeedback(DC_FEEDBACK.dc_stance_ok, now, 3);
      return this._result(g, now, {
        status: DC_FEEDBACK.dc_stance_ok, statusKind: 'ok',
        feedback: DC_FEEDBACK.dc_stance_ok,
        stanceResult: st,
      });
    }

    return this._result(g, now, {
      status: 'Stance looks good — hold still…', statusKind: 'ok',
      activityReason: 'dc_setup',
      stanceResult: st,
      stanceHoldPct: clamp((now - this._stancePassSince) / DC_CFG.stance_hold_sec, 0, 1),
    });
  }

  _calibrate() {
    const s = this._calibSamples;
    const m = (k) => median(s.map((x) => x[k]));
    this._calib = {
      sw: m('sw'),
      torso: m('torso'),
      tilt0: m('tilt'),
      // REST_SPAN: resting wrist-to-shoulder vertical distance, × torso length.
      restSpan: { left: clamp(m('sL'), 0.6, 1.6), right: clamp(m('sR'), 0.6, 1.6) },
      restElbow: { left: clamp(m('eL'), 0.25, 1.0), right: clamp(m('eR'), 0.25, 1.0) },
      restElbowOut: { left: clamp(m('oL'), -0.6, 0.8), right: clamp(m('oR'), -0.6, 0.8) },
      // Pixel values at calibration time (reference / debug only).
      restWristY: { left: m('wyL'), right: m('wyR') },
      restElbowY: { left: m('eyL'), right: m('eyR') },
    };
    this._calibSamples = [];
  }

  // ── READY ────────────────────────────────────────────────────────────────
  _tickReady(g, now) {
    const elapsed = now - this._readyStart;
    if (elapsed >= DC_CFG.ready_min_sec && (!this._voiceBusy() || elapsed >= DC_CFG.ready_max_sec)) {
      this._rep.startSet(this._currentSet);
      this._mistakeGate.reset();
      this._phase = DC_PHASE.ACTIVE;
      this._lastMoveAt = -Infinity;
      this._notExSince = now;
      if (this._currentSet > 1) {
        this._speakQueued(DC_VOICE_MSG.next_set(this._currentSet, this._targetSets), { key: `dc_next_set_${this._currentSet}` });
      }
      this._activityReason = 'dc_arms_resting';
      return this._result(g, now, { status: 'Curl both dumbbells up — rep 1', statusKind: 'ok' });
    }
    this._activityReason = 'dc_ready';
    return this._result(g, now, {
      status: 'Get ready…', statusKind: 'ok',
      feedback: this._currentFeedback(now) || 'Get ready…',
    });
  }

  // ── ACTIVE ───────────────────────────────────────────────────────────────
  _setActivity(exercising, reason, now) {
    const next = exercising ? DC_ACTIVITY.EXERCISING : DC_ACTIVITY.NOT_EXERCISING;
    if (next !== this._activity) {
      this._activity = next;
      this._notExSince = exercising ? -1 : now;
    }
    this._activityReason = reason;
  }

  _isLongIdle(now) {
    return this._phase === DC_PHASE.ACTIVE
      && this._activity === DC_ACTIVITY.NOT_EXERCISING
      && this._notExSince >= 0
      && now - this._notExSince >= DC_CFG.long_idle_seconds;
  }

  _idleStatus(rep) {
    const next = rep.setCount + 1;
    return rep.mode === 'alternate' ? `Curl one arm — rep ${next}` : `Curl both dumbbells up — rep ${next}`;
  }

  _tickActive(g, now, dt, lostLong) {
    const rep = this._rep;

    if (!g) {
      if (lostLong) rep.abortInProgress();
      this._setActivity(false, 'dc_out_of_frame', now);
      return this._result(g, now, {
        status: DC_FEEDBACK.dc_out_of_frame, statusKind: 'warn',
        activity: this._activity, activityReason: 'dc_out_of_frame',
        boneColor: DC_COLOR_GREY,
      });
    }

    if (facingRatio(g, this._calib) < DC_CFG.turn_ratio) {
      rep.abortInProgress();
      this._setActivity(false, 'dc_turned_away', now);
      return this._result(g, now, {
        status: DC_FEEDBACK.dc_turned_away, statusKind: 'warn',
        activity: this._activity, activityReason: 'dc_turned_away',
        boneColor: DC_COLOR_GREY,
      });
    }

    const res = rep.update(g, this._calib, now);
    if (rep.inProgress) this._lastMoveAt = now;
    this._mistakeGate.track(rep.inProgress);
    const exercising = rep.inProgress || now - this._lastMoveAt <= DC_CFG.idle_seconds;
    this._setActivity(exercising, exercising ? 'dc_rep_in_progress' : 'dc_arms_resting', now);
    if (exercising) this._activeSec += dt;

    const sustained = this._sustained(rep.inProgress ? res.liveKeys : [], now);
    const shownLive = this._mistakeGate.filter(sustained);
    const primaryLive = shownLive.length ? firstByPriority(shownLive, DC_LIVE_PRIORITY) : null;
    if (primaryLive) {
      this._setFeedback(DC_FEEDBACK[primaryLive], now, 1.0);
      this._setMistake(primaryLive, now, LIVE_MISTAKE_HOLD_SEC);
    } else if (res.topSides.length && !this._currentFeedback(now)) {
      this._setFeedback('Top reached — lower slowly all the way down', now, 1.0);
    }

    const repsCompleted = [];
    for (const attempt of res.attempts) {
      if (attempt.counted) repsCompleted.push(attempt);
      const setDone = this._onAttempt(attempt, now);
      if (setDone) return this._onSetComplete(g, now, res.attempts, repsCompleted);
    }

    let boneColor = DC_COLOR_GREEN;
    if (sustained.length) boneColor = DC_COLOR_RED;
    else if (!exercising) boneColor = DC_COLOR_GREY;

    let status;
    if (this._isLongIdle(now)) status = DC_FEEDBACK.dc_long_idle;
    else if (!rep.inProgress) status = this._idleStatus(rep);
    else if (res.topSides.length) status = 'Squeeze at the top…';
    else status = 'Curl up to the target line…';

    return this._result(g, now, {
      status,
      statusKind: shownLive.length ? 'warn' : 'ok',
      boneColor,
      activity: this._activity,
      activityReason: this._activityReason,
      sustainedCues: sustained,
      repsCompleted,
      attemptsCompleted: res.attempts,
    });
  }

  /** @returns {boolean} true when this attempt finished the current set. */
  _onAttempt(a, now) {
    const rep = this._rep;
    const repIssues = a.issues.length ? a.issues : (a.counted ? [] : ['dc_incomplete']);
    const issue = this._mistakeGate.endRep(repIssues)[0] || null;
    const setDone = this._targetReps > 0 && rep.setCount >= this._targetReps;

    if (a.counted) {
      const setPart = this._targetSets > 0 ? `Set ${this._currentSet} of ${this._targetSets}, ` : '';
      const repPart = this._targetReps > 0 ? `Rep ${a.repInSet} of ${this._targetReps}` : `Rep ${a.repInSet}`;
      this._setBanner(`${setPart}${repPart}${a.clean ? ' ✓' : ''}`, now, 2.0);
      if (issue) this._setFeedback(this._issueText(issue), now);
      else if (!repIssues.length) this._setFeedback('Good rep!', now);
      this._speakQueued(DC_VOICE_MSG.rep(a.repInSet), { key: `dc_rep_${this._currentSet}_${a.repInSet}_${a.attempt}` });
    } else {
      this._setBanner('Rep not counted', now, 2.0);
      if (issue) this._setFeedback(this._issueText(issue), now);
    }

    if (issue) this._setMistake(issue, now, REP_MISTAKE_HOLD_SEC);
    return setDone;
  }

  _onSetComplete(g, now, attempts, repsCompleted) {
    this._setsCompleted += 1;
    const finished = this._targetSets > 0 && this._setsCompleted >= this._targetSets;
    this._setActivity(false, finished ? 'dc_complete' : 'dc_resting_between_sets', now);
    this._rep.abortInProgress();

    if (finished) {
      this._phase = DC_PHASE.COMPLETE;
      this._final = this.summary();
      this._speakQueued(DC_VOICE_MSG.all_done, { key: 'dc_all_done' });
      this._setBanner('All sets complete!', now, 60);
      return this._result(g, now, {
        status: 'All sets complete!', statusKind: 'ok',
        repsCompleted, attemptsCompleted: attempts,
        activityReason: 'dc_complete',
      });
    }

    this._phase = DC_PHASE.REST_BETWEEN_SETS;
    this._restStart = now;
    this._restResumeSince = -1;
    this._restOverSpoken = false;
    const n = this._setsCompleted;
    this._setBanner(`Set ${n} complete`, now, 4);
    this._speakQueued(DC_VOICE_MSG.set_done(n), { key: `dc_set_done_${n}` });
    return this._result(g, now, {
      status: `Set ${n} complete — rest`, statusKind: 'ok',
      repsCompleted, attemptsCompleted: attempts,
      activityReason: 'dc_resting_between_sets',
      restRemainingSec: this._restDuration(),
    });
  }

  // ── REST_BETWEEN_SETS ────────────────────────────────────────────────────
  _restDuration() {
    return this._restSec ?? DC_CFG.rest_default_sec;
  }

  _startNextSet(now) {
    this._currentSet += 1;
    this._phase = DC_PHASE.READY;
    this._readyStart = now;
    this._restResumeSince = -1;
    this._setBanner(`Set ${this._currentSet}${this._targetSets ? ` of ${this._targetSets}` : ''}`, now, 2);
  }

  _tickRest(g, now) {
    const remaining = Math.max(0, this._restDuration() - (now - this._restStart));
    if (remaining <= 0 && !this._restOverSpoken) {
      this._restOverSpoken = true;
      this._speakQueued(DC_VOICE_MSG.rest_over(this._currentSet + 1), { key: `dc_rest_over_${this._currentSet}` });
    }

    let inStance = false;
    if (g && this._calib) inStance = evaluateCurlStance(g, g.norm).ok;
    if (inStance) {
      if (this._restResumeSince < 0) this._restResumeSince = now;
    } else {
      this._restResumeSince = -1;
    }

    if (remaining <= 0 && inStance && now - this._restResumeSince >= DC_CFG.rest_resume_hold_sec) {
      this._startNextSet(now);
      return this._result(g, now, { status: 'Starting next set…', statusKind: 'ok' });
    }

    const status = remaining > 0
      ? `Rest — next set in ${Math.ceil(remaining)} s`
      : 'Stand in your stance, arms down, to start the next set';
    return this._result(g, now, {
      status, statusKind: 'info',
      activityReason: 'dc_resting_between_sets',
      boneColor: DC_COLOR_GREY,
      restRemainingSec: Math.ceil(remaining),
    });
  }

  // ── Debug ────────────────────────────────────────────────────────────────
  _debugLog(fr, g, now) {
    const n = Math.max(1, Math.round(DC_CFG.debug_log_every_n));
    if (this._frameNo % n !== 0) return;
    if (!this._debugHeaderSent) {
      this._debugHeaderSent = true;
      // eslint-disable-next-line no-console
      console.log('[DC] t,phase,activity,mode,L_shoulderY,L_elbowY,L_wristY,L_progressPct,L_state,R_shoulderY,R_elbowY,R_wristY,R_progressPct,R_state,torsoPx,swPx,reps,setReps,liveCues');
    }
    const arm = (a, side) => {
      const p = g ? curlProgress(a, this._calib) : null;
      return [
        fmt(a?.lineY, 1), fmt(a?.ok ? a.elbow.y : null, 1), fmt(a?.ok ? a.wrist.y : null, 1),
        fmt(p == null ? null : p * 100, 1), fr.armStates[side],
      ];
    };
    // eslint-disable-next-line no-console
    console.log([
      '[DC]', fmt(now, 2), fr.phase, fr.activity, fr.mode,
      ...arm(g?.left, 'left'),
      ...arm(g?.right, 'right'),
      fmt(g?.T, 1), fmt(g?.norm, 1),
      fr.repCount, fr.setRepCount,
      (this._rep.live.liveKeys || []).join('|'),
    ].join(','));
  }

  reset() {
    this._voice.cancel();
    this._voice.resetCooldowns();
    this._rep = new DumbbellCurlRepTracker();
    this._resetState();
  }
}
