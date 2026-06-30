// ─── usePushUpFlow.js ─────────────────────────────────────────────────────────
// Push-up exercise state machine hook.
// Simpler than squats — no stance phases, upper body tracking only.
//
// States:
//   WAITING_FOR_PERSON  — no upper body detected
//   READY_TO_START      — upper body visible, brief setup delay + voice announcement
//   EXERCISE_ACTIVE     — rep counting + posture feedback
//   DONE                — all target reps complete
//
// Voice is the primary feedback channel (same 10-second cooldown as squat).
// Zero imports from any squat file.

import { VoiceManager } from '../../core/voiceManager.js';
import { nowSec }          from '../../core/landmarks.js';
import {
  PUSHUP_CFG, PUSHUP_VOICE_MSG,
  PUSHUP_COLOR_GREEN, PUSHUP_COLOR_AMBER, PUSHUP_COLOR_RED,
} from './config.js';
import {
  PushUpRepTracker,
  pushupLandmarksVisible, pushupPostureLandmarksVisible,
  evaluatePushUpPosture,
} from './PushUpRepTracker.js';
import {
  createEmptyRepAccumulator,
  accumulateRepPostureErrors,
  selectHighestPriorityPostureError,
  selectTooDeepCaptureKey,
  partitionPushUpCueKeys,
} from './repErrorPriority.js';

// ── Phase constants ────────────────────────────────────────────────────────────
export const PUSHUP_PHASE = {
  WAITING_FOR_PERSON: 'pu_waiting_for_person',
  READY_TO_START:     'pu_ready_to_start',
  EXERCISE_ACTIVE:    'pu_exercise_active',
  DONE:               'pu_done',
};

const VOICE_CD_MS     = 10_000;  // 10-second cooldown (same spec as squats)
const READY_DELAY_SEC = 3.5;     // delay after voice announcement before exercise starts
const DO_REP_ONE_MSG  = 'Do rep one.';

function selectLiveErrorKey(postureResult) {
  if (!postureResult?.cueKeys?.length) return null;
  const { tooDeep, posture } = partitionPushUpCueKeys(postureResult.cueKeys);
  if (tooDeep.length) return selectTooDeepCaptureKey(tooDeep);
  return selectHighestPriorityPostureError(posture);
}

function _baseResult(phase, overrides = {}) {
  return {
    phase,
    poseDetected:   false,
    landmarks:      null,
    status:         '',
    statusKind:     'info',
    boneColor:      PUSHUP_COLOR_GREEN,
    activeFeedback: '',
    repCount:       0,
    elbowAngle:     0,
    pushupState:    'UP',
    postureResult:  null,
    sustainedCues:  null,
    runAnalysis:    false,
    pushupTracker:  null,
    ...overrides,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export class PushUpFlow {
  constructor({ targetReps = 0, voice = true } = {}) {
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps;
    this._rep = new PushUpRepTracker();
    this._repAccum = createEmptyRepAccumulator();
    this._phase = PUSHUP_PHASE.WAITING_FOR_PERSON;
    this._repCount = 0;
    this._activeFeedback = '';
    this._readyStart = -1;
    this._readyVoiceSent = false;
    this._doneVoiceSent = false;
    this._lastLiveCueKey = '';
    PUSHUP_CFG.pushup_max_reps = targetReps;
  }

  _speak(text, opts) {
    if (!this._voiceEnabled) return false;
    return this._voice.speak(text, opts);
  }

  _speakQueued(text, opts) {
    if (!this._voiceEnabled) return false;
    return this._voice.speakQueued(text, opts);
  }

  _advancePhase(newPhase) {
    if (this._phase === newPhase) return;
    this._phase = newPhase;
  }

  setTargetReps(n) {
    this._targetReps = n;
    PUSHUP_CFG.pushup_max_reps = n;
  }

  toTrackerState(fr) {
    const level = fr.statusKind === 'fail' || fr.statusKind === 'warn' ? 'warn' : 'ok';
    const colors = { ok: 'rgb(34,211,166)', warn: 'rgb(245,158,11)', fail: 'rgb(239,68,68)' };
    return {
      exerciseId: 'pushup',
      repCount: fr.repCount ?? this._repCount,
      phase: fr.pushupState === 'DOWN' ? 'down' : fr.pushupState === 'UP' ? 'up' : fr.phase,
      progress: fr.elbowAngle ? Math.max(0, Math.min(1, (180 - fr.elbowAngle) / 100)) : 0,
      formScore: 100,
      ready: [PUSHUP_PHASE.EXERCISE_ACTIVE, PUSHUP_PHASE.DONE].includes(fr.phase),
      posture: fr.postureResult?.primaryColorKey === 'red' ? 'incorrect' : 'correct',
      cues: [{ level, text: fr.activeFeedback || fr.status || 'Tracking…' }],
      feedback: fr.activeFeedback || null,
      skeletonColor: fr.boneColor || colors[level] || colors.ok,
      elbowAngle: fr.elbowAngle,
      flowPhase: fr.phase,
      pushupTracker: fr.pushupTracker,
      postureResult: fr.postureResult,
    };
  }

  tick(landmarks) {
  
    const now = nowSec();
    const rep = this._rep;
    const cur = this._phase;

    // ══ WAITING_FOR_PERSON ══════════════════════════════════════════════════
    if (cur === PUSHUP_PHASE.WAITING_FOR_PERSON) {
      if (!landmarks || !pushupLandmarksVisible(landmarks)) {
        this._speak(PUSHUP_VOICE_MSG.no_person, { key: 'pu_no_person', cooldownMs: VOICE_CD_MS });
        return _baseResult(cur, {
          status: 'No person detected', statusKind: 'fail',
          pushupTracker: rep,
        });
      }
      // Upper body visible → move to ready
      this._readyStart    = now;
      this._readyVoiceSent = false;
      this._advancePhase(PUSHUP_PHASE.READY_TO_START);
      return _baseResult(PUSHUP_PHASE.READY_TO_START, {
        poseDetected: true, landmarks,
        status: 'Position detected', statusKind: 'ok',
        pushupTracker: rep,
      });
    }

    // ══ READY_TO_START ═══════════════════════════════════════════════════════
    if (cur === PUSHUP_PHASE.READY_TO_START) {
      if (!landmarks || !pushupLandmarksVisible(landmarks)) {
        // Lost person → back to waiting
        this._readyStart = -1;
        this._advancePhase(PUSHUP_PHASE.WAITING_FOR_PERSON);
        return _baseResult(PUSHUP_PHASE.WAITING_FOR_PERSON, {
          status: 'No person detected', statusKind: 'fail',
          pushupTracker: rep,
        });
      }

      const elapsed = now - this._readyStart;

      // Speak announcement once after a brief 0.5s settle
      if (!this._readyVoiceSent && elapsed >= 0.5) {
        this._readyVoiceSent = true;
        console.log('[PushUpFlow] Speaking upper-body-ok announcement');
        this._speak(PUSHUP_VOICE_MSG.upper_body_ok, {
          key: 'pu_upper_body_ok', cooldownMs: 0, immediate: true,
        });
      }

      // After delay, queue "Do rep one" and start (same rep prompt as squat)
      if (this._readyVoiceSent && elapsed >= READY_DELAY_SEC) {
        this._speakQueued(DO_REP_ONE_MSG, { key: 'pu_do_rep_one' });
        this._advancePhase(PUSHUP_PHASE.EXERCISE_ACTIVE);
        return _baseResult(PUSHUP_PHASE.EXERCISE_ACTIVE, {
          poseDetected: true, landmarks,
          status: 'Starting…', statusKind: 'ok',
          runAnalysis: true, pushupTracker: rep,
        });
      }

      return _baseResult(cur, {
        poseDetected: true, landmarks,
        status: 'Get into push-up position…', statusKind: 'ok',
        activeFeedback: 'Get ready…',
        pushupTracker: rep,
      });
    }

    // ══ EXERCISE_ACTIVE — rep flow matches squat: live cues during rep, next-rep prompt on complete ══
    if (cur === PUSHUP_PHASE.EXERCISE_ACTIVE) {
      if (!landmarks) {
        return _baseResult(cur, {
          status: 'Hold position…', statusKind: 'info',
          repCount: rep.count, pushupState: rep.state,
          elbowAngle: rep.smoothAngle, runAnalysis: false,
          pushupTracker: rep,
        });
      }

      let elbowAngle = rep.smoothAngle;
      let postureResult = null;
      let feedbackText = '';
      let repCompleteErrors = null;

      if (pushupLandmarksVisible(landmarks)) {
        elbowAngle = rep.updateAngle(landmarks);
        const stateBefore = rep.state;
        const prevCount   = rep.count;

        rep.detectAndCount(elbowAngle);

        if (stateBefore !== 'DOWN' && rep.state === 'DOWN') {
          this._repAccum = createEmptyRepAccumulator();
          this._lastLiveCueKey = '';
        }

        if (pushupPostureLandmarksVisible(landmarks)) {
          const evalState = stateBefore === 'DOWN' ? 'DOWN' : rep.state;
          postureResult = evaluatePushUpPosture(landmarks, elbowAngle, evalState);
          if (stateBefore === 'DOWN' || rep.state === 'DOWN') {
            accumulateRepPostureErrors(this._repAccum, postureResult);
          }
        }

        // ── Rep completed — prompt next rep immediately (squat pattern) ─────
        if (stateBefore === 'DOWN' && rep.state === 'UP' && rep.count > prevCount) {
          const n = rep.count;
          this._repCount = n;
          repCompleteErrors = [...this._repAccum.cues, ...this._repAccum.tooDeepKeys];

          const target = this._targetReps;
          if (target > 0 && n >= target) {
            if (!this._doneVoiceSent) {
              this._doneVoiceSent = true;
              this._speakQueued(PUSHUP_VOICE_MSG.done, { key: 'pu_done' });
            }
            this._advancePhase(PUSHUP_PHASE.DONE);
            this._repAccum = createEmptyRepAccumulator();
            this._lastLiveCueKey = '';
            return _baseResult(PUSHUP_PHASE.DONE, {
              poseDetected: true, landmarks,
              status: 'Exercise complete!', statusKind: 'ok',
              repCount: n, elbowAngle, pushupState: rep.state,
              activeFeedback: 'Well done!', runAnalysis: false,
              pushupTracker: rep, postureResult, repCompleteErrors,
            });
          }

          const nextRep = n + 1;
          this._speakQueued(`Do rep ${nextRep}.`, { key: `pu_do_rep_${nextRep}` });
          this._repAccum = createEmptyRepAccumulator();
          this._lastLiveCueKey = '';
          this._activeFeedback = '';
        }
      } else if (pushupPostureLandmarksVisible(landmarks)) {
        postureResult = evaluatePushUpPosture(landmarks, elbowAngle, rep.state);
      }

      // ── Live feedback during the rep (immediate voice, squat-style cooldown) ──
      if (rep.state === 'DOWN' && postureResult) {
        const liveKey = selectLiveErrorKey(postureResult);
        if (liveKey) {
          const liveMsg = PUSHUP_VOICE_MSG[liveKey];
          if (liveMsg) {
            feedbackText = liveMsg;
            this._activeFeedback = liveMsg;
            this._speak(liveMsg, { key: `pu_live_${liveKey}`, cooldownMs: VOICE_CD_MS });
            this._lastLiveCueKey = liveKey;
          }
        } else {
          this._lastLiveCueKey = '';
        }
      }

      let boneColor = PUSHUP_COLOR_GREEN;
      if (postureResult) {
        if (postureResult.skeletonColorKey === 'red') boneColor = PUSHUP_COLOR_RED;
        else if (postureResult.skeletonColorKey === 'yellow') boneColor = PUSHUP_COLOR_AMBER;
      }

      return _baseResult(cur, {
        poseDetected: true, landmarks, boneColor,
        status: feedbackText || this._activeFeedback || (rep.state === 'DOWN' ? 'Lowering…' : 'Pushing up…'),
        statusKind: postureResult?.primaryColorKey === 'red' ? 'warn' : 'ok',
        repCount: rep.count, elbowAngle, pushupState: rep.state,
        postureResult,
        activeFeedback: feedbackText || this._activeFeedback,
        runAnalysis: true,
        pushupTracker: rep,
        repCompleteErrors,
      });
    }

    // ══ DONE ══════════════════════════════════════════════════════════════════
    return _baseResult(PUSHUP_PHASE.DONE, {
      poseDetected: !!landmarks, landmarks,
      status: 'Exercise complete!', statusKind: 'ok',
      repCount: rep.count, activeFeedback: 'Well done!',
      pushupTracker: rep,
    });
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  reset() {
    this._voice.cancel();
    this._voice.resetCooldowns();
    this._rep  = new PushUpRepTracker();
    this._repAccum = createEmptyRepAccumulator();
    this._phase        = PUSHUP_PHASE.WAITING_FOR_PERSON;
    this._readyStart   = -1;
    this._readyVoiceSent = false;
    this._doneVoiceSent  = false;
    this._repCount = 0;
    this._activeFeedback = '';
    this._lastLiveCueKey = '';
    PUSHUP_CFG.pushup_max_reps = this._targetReps;
    console.log('[PushUpFlow] Reset to WAITING_FOR_PERSON');
  }
}
