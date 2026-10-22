// ─── useSquatFlow.js ──────────────────────────────────────────────────────────
// Sequential AI coaching state machine for squat workflow.
//
// States (same order as shoulder press / lateral raise / front raise):
//   WAITING_FOR_PERSON  — camera has noticed shoulders and ankles
//   FEET_CHECK          — ankles about shoulder width; locks once, then stops
//   UPRIGHT_CHECK       — standing tall; locks once, then stops
//   READY_TO_START      — stance is done; begin the exercise immediately
//   EXERCISE_ACTIVE     — squat tracking; exercising vs standing idle
//   DONE                — all reps complete
//
// IMPORTANT RULES:
//   1. No guide box and no head/toe requirement. If the camera notices the
//      shoulders and ankles, that is enough to start setup.
//   2. Feet are checked once. Standing straight is checked once. After both
//      pass, those checks are not repeated and the exercise starts.
//   3. Voice repeated message cooldown = 10 seconds.
//   4. Exercise voice: too fast, too slow, too deep, standing up too early,
//      plus per-rep posture warnings (speed → knee → torso, one voice only).
//   5. Only ONE live feedback active at a time.

import {
  validateFullBodyVisibility, runAllStanceChecks,
  checkShoulderAnkleWidth, evaluateSquatUpright,
  calibrateTorsoFromLandmarks, resetTorsoCalibration,
} from './poseLogic';
import { SquatRepTracker } from './SquatRepTracker.js';
import { KneeAngleRepMonitor } from './kneeMonitor.js';
import { TorsoBendRepMonitor } from './torsoMonitor.js';
import { ShoulderLevelRepMonitor } from './shoulderMonitor.js';
import { getRepSpeedWarningKey, listRepPostureWarnings } from './warningPriority';
import { LM, CFG, nowSec, COLOR_GREEN, COLOR_AMBER, COLOR_RED } from './config.js';
import { VoiceManager } from '../../core/voiceManager.js';
import { primeSetIntro } from '../../core/sessionVoice.js';
import { RepeatMistakeGate } from '../common/repeatMistakeGate.js';
import { lockTempoGateAtStance } from './draw.js';

// ── Phase constants ───────────────────────────────────────────────────────────
export const PHASE = {
  BODY_NOT_VISIBLE:      'body_not_visible',
  WAITING_FOR_PERSON:    'waiting_for_person',
  FEET_CHECK:            'feet_check',
  UPRIGHT_CHECK:         'upright_check',
  READY_TO_START:        'ready_to_start',
  EXERCISE_ACTIVE:       'exercise_active',
  DONE:                  'done',
};

// ── Timing constants ──────────────────────────────────────────────────────────
const STANCE_PASS_HOLD_SEC     = 1.2;  // must hold a valid check before it locks
const STANCE_ANNOUNCE_SEC      = 2.5;  // min time in a step before it can pass
const STANCE_ANNOUNCE_MAX_SEC  = 7.0;  // don't block forever if TTS never ends

// If the full-body gate fails for at least this long, treat it as the user
// actually leaving/re-entering the frame (as opposed to a single-frame
// landmark flicker) and discard any in-flight rep state on return so a stale
// pose snapshot can't falsely complete/miscount a rep.
const BODY_GONE_RESET_SEC     = 0.6;

// Trainer-like correction pacing: a real trainer gives ONE instruction, then
// watches and waits for the user to actually attempt the correction before
// saying anything else. These two constants control that behaviour:
const INSTRUCTION_CONFIRM_SEC   = 0.4; // ignore single-frame noise before trusting a "problem" reading
const INSTRUCTION_MIN_WAIT_SEC  = 2.5; // min silence after an instruction before repeating/switching it

const VOICE_CD_MS = 10000;             // 10 second voice cooldown (spec)

// ── Voice messages ────────────────────────────────────────────────────────────
const VOICE_MSG = {
  body_not_visible: 'Please stand in front of the camera.',
  ankles_not_visible: 'Step back so both ankles are visible.',
  shoulders_not_visible: 'Step back so your shoulders are visible.',
  body_partial:     'Step back so your body is visible.',
  no_person:        'Please stand in front of the camera.',
  feet_begin:       'Place your feet about shoulder width apart.',
  feet_ok:          'Your feet look good.',
  stance_narrow:    'Move your feet farther apart.',
  stance_wide:      'Bring your feet slightly closer together.',
  upright_begin:    'Now stand tall and straight.',
  not_upright:      'Stand up tall and straight.',
  shoulder_uneven:  'Level your shoulders and stand straight.',
  upright_ok:       'You are standing straight. Let\'s begin the exercise.',
  do_rep_one:       'Do rep one.',
  calibrate:        'Stand tall and straight so I can calibrate your squat depth.',
  too_fast:         'Too fast.',
  too_slow:         'Too slow.',
  too_deep:         'You are squatting too deep.',
  too_early:        'You are standing up too early.',
  done:             'Congratulations. You finished every rep.',
};

const STANCE_PASSED_ALL = { feet: true, upright: true };

// ── Helpers ───────────────────────────────────────────────────────────────────
function _baseResult(phase, overrides = {}) {
  return {
    phase,
    bodyState:          phase === PHASE.BODY_NOT_VISIBLE ? 'BODY_NOT_VISIBLE' : 'BODY_VISIBLE',
    bodyNotVisible:     phase === PHASE.BODY_NOT_VISIBLE,
    poseDetected:       false,
    landmarks:          null,
    status:             '',
    statusKind:         'info',
    drawGuideBox:       false,
    boneColor:          COLOR_GREEN,
    stanceData:         null,
    squatTracker:       null,
    runAnalysis:        false,
    activeFeedback:     '',
    repCount:           0,
    hipX: null, hipY: null, kneeX: null, kneeY: null, shoulderW: null,
    stancePassedChecks: {},
    currentStanceCheck: null,
    ...overrides,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export class SquatFlow {
  constructor({ targetReps = 0, voice = true, setNumber = 1, setIntro = true, targetSeconds = 0 } = {}) {
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps;
    this._sq = new SquatRepTracker();
    this._kneeMon = new KneeAngleRepMonitor();
    this._torsoMon = new TorsoBendRepMonitor();
    this._shoulderMon = new ShoulderLevelRepMonitor();
    this._mistakeGate = new RepeatMistakeGate();
    this._wasInSquat = false;
    this._phase = PHASE.WAITING_FOR_PERSON;
    this._repCount = 0;
    this._activeFeedback = '';
    this._stancePassedChecks = {};
    this._currentStanceCheck = null;
    this._stancePassHoldStart = -1;
    this._stanceStepEnteredAt = -1;
    this._readyStart = -1;
    this._doRepOneVoiceSent = false;
    this._doneVoiceSent = false;
    this._lastInstructionKey = '';
    this._lastInstructionAt = -1;
    this._pendingInstructionKey = '';
    this._pendingInstructionSince = -1;
    this._lastSeenRep = 0;
    this._bodyNotVisibleSince = -1;
    CFG.squat_max_reps = targetReps;
    primeSetIntro(this._voice, {
      enabled: this._voiceEnabled, setIntro, setNumber, targetReps: this._targetReps, targetSeconds,
    });
  }

  _speak(text, opts) {
    if (!this._voiceEnabled) return false;
    return this._voice.speak(text, opts);
  }

  _speakQueued(text, opts) {
    if (!this._voiceEnabled) return false;
    return this._voice.speakQueued(text, opts);
  }

  /** True once the current stance step has been shown/announced long enough to advance. */
  _stanceStepReady(now) {
    if (this._stanceStepEnteredAt < 0) return false;
    const elapsed = now - this._stanceStepEnteredAt;
    if (elapsed < STANCE_ANNOUNCE_SEC) return false;
    // Wait for intro/confirmation TTS to finish, but never soft-lock the flow.
    if (
      this._voiceEnabled &&
      this._voice.isBusy() &&
      elapsed < STANCE_ANNOUNCE_MAX_SEC
    ) {
      return false;
    }
    return true;
  }

  _enterStanceStep(phase, now) {
    this._stancePassHoldStart = -1;
    this._stanceStepEnteredAt = now;
    this._lastInstructionKey = '';
    this._lastInstructionAt = -1;
    this._pendingInstructionKey = '';
    this._pendingInstructionSince = -1;
    this._advancePhase(phase);
  }

  _issueInstruction(key, text, now) {
    this._lastInstructionKey = key;
    this._lastInstructionAt = now;
    this._stancePassHoldStart = -1;
    return this._speak(text, { key, cooldownMs: VOICE_CD_MS });
  }

  /**
   * Trainer-like correction gate for stance instructions.
   *
   * A real trainer: (1) ignores a flickering/one-frame reading, (2) says the
   * correction exactly once, (3) then watches and waits — they do NOT repeat
   * the same cue over and over, and they do NOT immediately switch to a
   * different cue just because the measurement jittered across the
   * tolerance boundary for a moment.
   *
   * `problemKey` must be a stable identifier for the current issue (e.g.
   * "toe_left_right"), or falsy when there is currently no problem.
   */
  _maybeIssueInstruction(problemKey, text, now) {
    if (!problemKey) {
      this._pendingInstructionKey = '';
      this._pendingInstructionSince = -1;
      return;
    }

    // Debounce: require the same problem to be read consistently for a short
    // window before treating it as real (filters single-frame landmark noise
    // right at the tolerance boundary, which previously caused instructions
    // to flip-flop between opposite directions).
    if (this._pendingInstructionKey !== problemKey) {
      this._pendingInstructionKey = problemKey;
      this._pendingInstructionSince = now;
      return;
    }
    if (now - this._pendingInstructionSince < INSTRUCTION_CONFIRM_SEC) return;

    // Already told the user this exact thing — wait for them to react
    // instead of nagging.
    if (this._lastInstructionKey === problemKey) return;

    // Switching to a different instruction (e.g. width -> toe, or left ->
    // right) still requires a minimum silence since the last one so the
    // user has real time to attempt the correction first.
    if (this._lastInstructionKey && (now - this._lastInstructionAt) < INSTRUCTION_MIN_WAIT_SEC) return;

    this._issueInstruction(problemKey, text, now);
  }

  _setStancePassedChecks(updater) {
    if (typeof updater === 'function') this._stancePassedChecks = updater(this._stancePassedChecks);
    else this._stancePassedChecks = updater;
  }

  _advancePhase(newPhase) {
    if (this._phase === newPhase) return;
    this._phase = newPhase;
  }

  setTargetReps(n) {
    this._targetReps = n;
    CFG.squat_max_reps = n;
  }

  toTrackerState(fr) {
    const level = fr.statusKind === 'fail' || fr.statusKind === 'warn' ? 'warn' : 'ok';
    const colors = { ok: 'rgb(34,211,166)', warn: 'rgb(245,158,11)', fail: 'rgb(239,68,68)' };
    const active = fr.phase === PHASE.EXERCISE_ACTIVE;
    const cueText = fr.activeFeedback || fr.status || (active ? 'Tracking…' : 'Get ready…');
    const formScore = active && fr.squatTracker && !fr.squatTracker.isCalibrated
      ? Math.max(10, fr.squatTracker.calibrationPct)
      : (level === 'warn' ? 72 : 100);
    return {
      exerciseId: 'squat',
      repCount: fr.repCount ?? this._repCount,
      phase: active ? (fr.squatTracker?.inSquat ? 'down' : 'up') : fr.phase,
      progress: fr.squatTracker?.depthPct ?? 0,
      formScore,
      ready: [PHASE.EXERCISE_ACTIVE, PHASE.DONE].includes(fr.phase),
      posture: fr.statusKind === 'ok' ? 'correct' : 'warning',
      cues: [{ level, text: cueText }],
      feedback: fr.activeFeedback || null,
      skeletonColor: fr.boneColor || colors[level] || colors.ok,
      drawGuideBox: false,
      activity: fr.activity || (active ? 'not_exercising' : null),
      flowPhase: fr.phase,
      stanceData: fr.stanceData,
      squatTracker: fr.squatTracker,
      runAnalysis: fr.runAnalysis,
    };
  }

  tick(landmarks, w, h) {
  
    const now = nowSec();
    const sq  = this._sq;
    const cur = this._phase;
    const visiblePhase = cur === PHASE.BODY_NOT_VISIBLE ? PHASE.WAITING_FOR_PERSON : cur;
    const stanceLocked = cur === PHASE.READY_TO_START
      || cur === PHASE.EXERCISE_ACTIVE
      || cur === PHASE.DONE;

    // ═══════════════════════════════════════════════════════════════════════
    // SETUP GATE — only before stance locks.
    // Shoulders and ankles noticed by the camera are enough. No guide box,
    // and the head does not have to be in frame. After feet + standing
    // straight have both passed, this gate is not run again.
    // ═══════════════════════════════════════════════════════════════════════
    if (!stanceLocked) {
      const bodyGate = validateFullBodyVisibility(landmarks);
      if (!bodyGate.ready) {
        if (this._bodyNotVisibleSince < 0) this._bodyNotVisibleSince = now;
        const voiceKey = bodyGate.voiceKey || 'body_not_visible';
        const voiceMsg = VOICE_MSG[voiceKey] || bodyGate.message;
        this._speak(voiceMsg, { key: voiceKey, cooldownMs: VOICE_CD_MS });
        return _baseResult(PHASE.BODY_NOT_VISIBLE, {
          bodyState: 'BODY_NOT_VISIBLE',
          bodyNotVisible: true,
          poseDetected: false,
          landmarks: null,
          status: voiceMsg,
          statusKind: 'fail',
          drawGuideBox: false,
          boneColor: COLOR_AMBER,
          stanceData: null,
          squatTracker: this._sq,
          runAnalysis: false,
          activeFeedback: voiceMsg,
          repCount: this._repCount,
          currentStanceCheck: this._currentStanceCheck,
          resumePhase: visiblePhase,
        });
      }
    } else if (!landmarks) {
      if (this._bodyNotVisibleSince < 0) this._bodyNotVisibleSince = now;
      this._speak(VOICE_MSG.no_person, { key: 'no_person', cooldownMs: VOICE_CD_MS });
      return _baseResult(cur, {
        bodyState: 'BODY_NOT_VISIBLE',
        bodyNotVisible: true,
        poseDetected: false,
        landmarks: null,
        status: VOICE_MSG.no_person,
        statusKind: 'fail',
        drawGuideBox: false,
        boneColor: COLOR_AMBER,
        squatTracker: this._sq,
        runAnalysis: false,
        activeFeedback: VOICE_MSG.no_person,
        repCount: this._repCount,
        stancePassedChecks: { ...STANCE_PASSED_ALL },
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RECOVERY — the body was hidden long enough to be a real "left the
    // frame" event (not a single-frame detector flicker). If this happened
    // mid-exercise, any in-flight rep timing/position state is now stale and
    // comparing it against the freshly-reappeared pose could falsely
    // complete or miscount a rep — discard it and pick the exercise back up
    // cleanly from the current rep count instead.
    // ═══════════════════════════════════════════════════════════════════════
    if (this._bodyNotVisibleSince >= 0) {
      const goneSec = now - this._bodyNotVisibleSince;
      this._bodyNotVisibleSince = -1;
      if (goneSec >= BODY_GONE_RESET_SEC && cur === PHASE.EXERCISE_ACTIVE) {
        sq.cancelInProgressRep();
        this._wasInSquat = false;
        this._kneeMon.onRepCancelled();
        this._torsoMon.onRepCancelled();
        this._shoulderMon.onRepCancelled();
        this._speakQueued(`Let's continue. Do rep ${sq.count + 1}.`, { key: 'resume_after_gap' });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE: WAITING_FOR_PERSON — body is in frame, start the feet check
    // ═══════════════════════════════════════════════════════════════════════
    if (visiblePhase === PHASE.WAITING_FOR_PERSON) {
      this._speak(VOICE_MSG.feet_begin, { key: 'feet_begin', cooldownMs: 0, immediate: true });
      this._setStancePassedChecks({});
      this._currentStanceCheck = 'feet';
      this._enterStanceStep(PHASE.FEET_CHECK, now);
      return _baseResult(PHASE.FEET_CHECK, {
        poseDetected: true, landmarks,
        status: 'Checking your feet…', statusKind: 'info',
        drawGuideBox: false, boneColor: COLOR_GREEN,
        stanceData: checkShoulderAnkleWidth(landmarks),
        currentStanceCheck: 'feet',
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FEET_CHECK — each stance width must hold, same idea as shoulder press
    // ═══════════════════════════════════════════════════════════════════════
    if (visiblePhase === PHASE.FEET_CHECK) {
      const widthCheck = checkShoulderAnkleWidth(landmarks);
      const stepReady = this._stanceStepReady(now);

      if (!widthCheck.ok) {
        this._stancePassHoldStart = -1;
        const instructionKey = widthCheck.status === 'narrow' ? 'stance_narrow' : 'stance_wide';
        this._maybeIssueInstruction(instructionKey, widthCheck.feedback, now);
        return _baseResult(cur, {
          poseDetected: true, landmarks,
          status: widthCheck.feedback,
          statusKind: 'warn',
          drawGuideBox: false,
          boneColor: COLOR_AMBER,
          stanceData: widthCheck,
          stancePassedChecks: { ...this._stancePassedChecks },
          currentStanceCheck: 'feet',
          activeFeedback: widthCheck.feedback,
        });
      }

      this._maybeIssueInstruction(null, '', now);

      if (stepReady) {
        if (this._stancePassHoldStart < 0) this._stancePassHoldStart = now;
        if (now - this._stancePassHoldStart >= STANCE_PASS_HOLD_SEC) {
          this._setStancePassedChecks({ feet: true });
          this._currentStanceCheck = 'upright';
          this._speakQueued(VOICE_MSG.feet_ok, { key: 'feet_ok' });
          this._speakQueued(VOICE_MSG.upright_begin, { key: 'upright_begin' });
          this._enterStanceStep(PHASE.UPRIGHT_CHECK, now);
          return _baseResult(PHASE.UPRIGHT_CHECK, {
            poseDetected: true, landmarks,
            status: 'Feet locked. Stand straight…', statusKind: 'ok',
            drawGuideBox: false, boneColor: COLOR_GREEN,
            stanceData: evaluateSquatUpright(landmarks),
            stancePassedChecks: { feet: true },
            currentStanceCheck: 'upright',
            activeFeedback: VOICE_MSG.feet_ok,
          });
        }
      } else {
        this._stancePassHoldStart = -1;
      }

      return _baseResult(cur, {
        poseDetected: true, landmarks,
        status: stepReady ? 'Feet look good — hold still…' : 'Checking your feet…',
        statusKind: 'ok',
        drawGuideBox: false,
        boneColor: COLOR_GREEN,
        stanceData: widthCheck,
        stancePassedChecks: { ...this._stancePassedChecks },
        currentStanceCheck: 'feet',
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UPRIGHT_CHECK — tall, level, not already in a squat
    // ═══════════════════════════════════════════════════════════════════════
    if (visiblePhase === PHASE.UPRIGHT_CHECK) {
      const upright = evaluateSquatUpright(landmarks);
      const stepReady = this._stanceStepReady(now);

      if (!upright.ok) {
        this._stancePassHoldStart = -1;
        const instructionKey = upright.key || 'not_upright';
        this._maybeIssueInstruction(instructionKey, VOICE_MSG[instructionKey] || upright.feedback, now);
        return _baseResult(cur, {
          poseDetected: true, landmarks,
          status: upright.feedback,
          statusKind: 'warn',
          drawGuideBox: false,
          boneColor: COLOR_AMBER,
          stanceData: upright,
          stancePassedChecks: { feet: true },
          currentStanceCheck: 'upright',
          activeFeedback: upright.feedback,
        });
      }

      this._maybeIssueInstruction(null, '', now);

      if (stepReady) {
        if (this._stancePassHoldStart < 0) this._stancePassHoldStart = now;
        if (now - this._stancePassHoldStart >= STANCE_PASS_HOLD_SEC) {
          this._stancePassHoldStart = -1;
          this._setStancePassedChecks(STANCE_PASSED_ALL);
          this._doRepOneVoiceSent = false;
          this._readyStart = now;
          this._currentStanceCheck = null;
          this._speakQueued(VOICE_MSG.upright_ok, { key: 'upright_ok' });
          this._advancePhase(PHASE.READY_TO_START);
          return _baseResult(PHASE.READY_TO_START, {
            poseDetected: true, landmarks,
            status: VOICE_MSG.upright_ok, statusKind: 'ok',
            drawGuideBox: false, boneColor: COLOR_GREEN,
            stanceData: upright,
            stancePassedChecks: { ...STANCE_PASSED_ALL },
            activeFeedback: VOICE_MSG.upright_ok,
          });
        }
      } else {
        this._stancePassHoldStart = -1;
      }

      return _baseResult(cur, {
        poseDetected: true, landmarks,
        status: stepReady ? 'Standing straight — hold…' : 'Checking that you are standing straight…',
        statusKind: 'ok',
        drawGuideBox: false,
        boneColor: COLOR_GREEN,
        stanceData: upright,
        stancePassedChecks: { feet: true, upright: false },
        currentStanceCheck: 'upright',
      });
    }

    // Exercise-phase form checks (unchanged) — not used during stance setup
    const checks = runAllStanceChecks(landmarks);

    // ═══════════════════════════════════════════════════════════════════════
    // READY_TO_START — speak start cues + "do rep one"
    // ═══════════════════════════════════════════════════════════════════════
    if (visiblePhase === PHASE.READY_TO_START) {
      // Stance is already locked. Do not re-check feet or posture.
      // Start the exercise on this frame.
      if (!this._doRepOneVoiceSent) {
        this._doRepOneVoiceSent = true;
        console.log('[Flow] Queuing "Do rep one"');
        this._speakQueued(VOICE_MSG.do_rep_one, { key: 'do_rep_one' });
      }

      lockTempoGateAtStance(sq, landmarks, h);
      calibrateTorsoFromLandmarks(landmarks);
      this._lastSeenRep = 0;
      this._advancePhase(PHASE.EXERCISE_ACTIVE);
      // fall through to EXERCISE_ACTIVE on the same frame
    }

    // ═══════════════════════════════════════════════════════════════════════
    // EXERCISE_ACTIVE — squat tracking + 4 feedback types
    // ═══════════════════════════════════════════════════════════════════════
    if (this._phase === PHASE.EXERCISE_ACTIVE) {
      const lh = landmarks[LM.LEFT_HIP];
      const rh = landmarks[LM.RIGHT_HIP];
      const lk = landmarks[LM.LEFT_KNEE];
      const rk = landmarks[LM.RIGHT_KNEE];
      const la = landmarks[LM.LEFT_ANKLE];
      const ra = landmarks[LM.RIGHT_ANKLE];
      const ls = landmarks[LM.LEFT_SHOULDER];
      const rs = landmarks[LM.RIGHT_SHOULDER];

      const hipX   = (lh.x + rh.x) * 0.5;
      const hipY   = (lh.y + rh.y) * 0.5;
      const kneeX  = (lk.x + rk.x) * 0.5;
      const kneeY  = (lk.y + rk.y) * 0.5;
      const footY  = Math.max(la.y, ra.y);
      const sw     = Math.max(Math.abs(ls.x - rs.x), 0.001);
      const leftGap  = lk.y - lh.y;
      const rightGap = rk.y - rh.y;

      const prevCount = sq.count;
      const wasInSquat = this._wasInSquat;

      sq.update(hipY, kneeY, footY, sw, leftGap, rightGap);
      sq.observeRepFormCues(checks.allCues);
      sq.trackTempo(hipY * h, hipX * w);

      // ── Knee / torso / shoulder posture (only while descending/ascending) ──
      const kneeMon     = this._kneeMon;
      const torsoMon    = this._torsoMon;
      const shoulderMon = this._shoulderMon;
      if (sq._inSquat) {
        if (!wasInSquat) {
          kneeMon.onRepStart();
          torsoMon.onRepStart();
          shoulderMon.onRepStart();
          this._mistakeGate.startRep();
        }
        kneeMon.updateFrame(landmarks);
        torsoMon.updateFrame(landmarks);
        shoulderMon.updateFrame(landmarks);
      } else if (wasInSquat && sq.count === prevCount) {
        kneeMon.onRepCancelled();
        torsoMon.onRepCancelled();
        shoulderMon.onRepCancelled();
      }
      this._wasInSquat = sq._inSquat;

      // ── Rep completed ──────────────────────────────────────────────
      if (sq.count > prevCount) {
        const n = sq.count;
        this._repCount = n;
        this._lastSeenRep = n;

        // All end-of-rep voice lines are queued so feedback finishes before "Do rep N".
        const lastRep = sq.repMetrics[sq.repMetrics.length - 1];
        const speedKey    = getRepSpeedWarningKey(sq);
        const kneeMsg     = kneeMon.consumeEndOfRepFeedback();
        const torsoMsg    = torsoMon.consumeEndOfRepFeedback();
        const shoulderMsg = shoulderMon.consumeEndOfRepFeedback();
        const warnings    = listRepPostureWarnings({ speedKey, kneeMsg, torsoMsg, shoulderMsg });
        const tooEarly    = !!(lastRep && !lastRep.full_depth);
        const repeated    = new Set(this._mistakeGate.endRep([
          tooEarly && VOICE_MSG.too_early,
          lastRep?.too_deep && VOICE_MSG.too_deep,
          ...warnings.map((w) => w.text),
        ]));
        if (tooEarly && repeated.has(VOICE_MSG.too_early)) {
          console.log(`[Flow] Rep ${n} was partial → "standing up too early"`);
          this._speakQueued(VOICE_MSG.too_early, { key: 'too_early' });
          this._activeFeedback = (VOICE_MSG.too_early);
        }

        // Check target reps
        const target = this._targetReps;
        if (target > 0 && n >= target) {
          if (!this._doneVoiceSent) {
            this._doneVoiceSent = true;
            this._speakQueued(VOICE_MSG.done, { key: 'done' });
          }
          this._advancePhase(PHASE.DONE);
          return _baseResult(PHASE.DONE, {
            poseDetected: true, landmarks,
            status: 'Exercise complete!', statusKind: 'ok',
            drawGuideBox: false, boneColor: COLOR_GREEN,
            squatTracker: sq, runAnalysis: false,
            activeFeedback: 'Well done!', repCount: n,
            hipX, hipY, kneeX, kneeY, shoulderW: sw,
            stanceData: checks,
            stancePassedChecks: { ...STANCE_PASSED_ALL },
          });
        }

        // Per-rep posture voice: speed → knee → torso → shoulder (exactly one).
        const warning = warnings.find((w) => repeated.has(w.text));
        if (warning) {
          console.log(`[Flow] Rep ${n} warning (${warning.kind}) → "${warning.text}"`);
          this._speakQueued(warning.text, { key: warning.key });
          this._activeFeedback = (warning.text);
        }

        // Prompt next rep only after any feedback above has finished playing.
        const nextRep = n + 1;
        this._speakQueued(`Do rep ${nextRep}.`, { key: `do_rep_${nextRep}` });
      }

      // ── Priority-based real-time feedback (one at a time) ──────────
      let feedbackText = '';
      let feedbackKey  = '';

      // P0 — Depth calibration (must stand tall before reps count)
      if (!sq.isCalibrated && !sq._inSquat) {
        feedbackText = `Stand tall to calibrate (${sq.calibrationPct}%)`;
        feedbackKey  = 'calibrate';
        this._activeFeedback = feedbackText;
        this._speak(VOICE_MSG.calibrate, { key: feedbackKey, cooldownMs: VOICE_CD_MS });
      }
      // P1 — Excessive depth (live)
      else if (sq.tooDeep && this._mistakeGate.claim(VOICE_MSG.too_deep)) {
        feedbackText = VOICE_MSG.too_deep;
        feedbackKey  = 'too_deep';
      }
      // P2 — Speed warnings (live + per-rep)
      else {
        const sw2 = sq.activeSpeedWarning;
        if (sw2) {
          // Map any "fast" → too_fast, any "slow" → too_slow
          if (sw2.includes('fast')) {
            feedbackText = VOICE_MSG.too_fast;
            feedbackKey  = 'too_fast';
          } else if (sw2.includes('slow')) {
            feedbackText = VOICE_MSG.too_slow;
            feedbackKey  = 'too_slow';
          }
          if (!this._mistakeGate.claim(feedbackText)) {
            feedbackText = '';
            feedbackKey  = '';
          }
        }
      }

      // Speed/deep cues update UI live; voice for speed/knee/torso is per-rep only.
      if (feedbackText) {
        this._activeFeedback = (feedbackText);
        if (feedbackKey === 'too_deep') {
          this._speak(feedbackText, { key: feedbackKey, cooldownMs: VOICE_CD_MS });
        }
      }

      // Bone color
      let boneColor = COLOR_GREEN;
      if (sq.tooDeep) boneColor = COLOR_RED;
      else if (sq._inSquat && checks.allCues.length > 0) boneColor = COLOR_AMBER;

      const working = !!sq._inSquat;
      return _baseResult(PHASE.EXERCISE_ACTIVE, {
        poseDetected: true, landmarks,
        status: feedbackText || (working ? 'Exercising' : (sq.isCalibrated ? 'Not exercising' : `Stand tall to calibrate (${sq.calibrationPct}%)`)),
        statusKind: feedbackText ? 'warn' : 'ok',
        activity: working ? 'exercising' : 'not_exercising',
        drawGuideBox: false, boneColor,
        stanceData: checks,
        squatTracker: sq, runAnalysis: true,
        activeFeedback: this._activeFeedback,
        repCount: sq.count,
        hipX, hipY, kneeX, kneeY, shoulderW: sw,
        stancePassedChecks: { ...STANCE_PASSED_ALL },
        currentStanceCheck: null,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DONE
    // ═══════════════════════════════════════════════════════════════════════
    return _baseResult(PHASE.DONE, {
      poseDetected: true, landmarks,
      status: 'Exercise complete!', statusKind: 'ok',
      drawGuideBox: false, boneColor: COLOR_GREEN,
      squatTracker: sq, runAnalysis: false,
      activeFeedback: 'Well done!',
      repCount: sq.count,
      stanceData: checks,
      stancePassedChecks: { ...STANCE_PASSED_ALL },
    });
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  reset() {
    this._voice.cancel();
    this._voice.resetCooldowns();
    this._sq          = new SquatRepTracker();
    this._kneeMon     = new KneeAngleRepMonitor();
    this._torsoMon    = new TorsoBendRepMonitor();
    this._shoulderMon = new ShoulderLevelRepMonitor();
    this._mistakeGate.reset();
    this._wasInSquat   = false;
    // Clear torso calibration so the next session re-captures standing height.
    resetTorsoCalibration();
    this._phase = PHASE.WAITING_FOR_PERSON;

    this._stancePassHoldStart = -1;
    this._stanceStepEnteredAt = -1;
    this._readyStart          = -1;

    this._doRepOneVoiceSent = false;
    this._doneVoiceSent     = false;
    this._lastInstructionKey = '';
    this._lastInstructionAt = -1;
    this._pendingInstructionKey = '';
    this._pendingInstructionSince = -1;
    this._lastSeenRep       = 0;
    this._bodyNotVisibleSince = -1;

    this._repCount = 0;
    this._activeFeedback = '';
    this._setStancePassedChecks({});
    this._currentStanceCheck = (null);
    CFG.squat_max_reps = this._targetReps;
    console.log('[Flow] Reset to WAITING_FOR_PERSON');
  }
}
