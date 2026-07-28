// ─── useSquatFlow.js ──────────────────────────────────────────────────────────
// Sequential AI coaching state machine for squat workflow.
//
// States:
//   WAITING_FOR_PERSON  — no human detected yet
//   CHECKING_BOUNDARY   — human present, verify full body in yellow box
//   STANCE_FOOT_WIDTH   — ankle width ≈ shoulder width (first stance rule)
//   STANCE_TOE_ANGLE    — left/right toe angle (only after foot width locked)
//   READY_TO_START      — speak start cues, then begin exercise
//   EXERCISE_ACTIVE     — squat tracking + 4 feedback types
//   DONE                — all reps complete
//
// IMPORTANT RULES (per spec):
//   1. After CHECKING_BOUNDARY passes ONCE, never re-validate full body again.
//   2. Stance order is strict: FOOT_WIDTH → lock → TOE_ANGLE → start.
//   3. Voice repeated message cooldown = 10 seconds.
//   4. Exercise voice: too fast, too slow, too deep, standing up too early,
//      plus per-rep posture warnings (speed → knee → torso, one voice only).
//   5. Only ONE live feedback active at a time.

import {
  validateFullBodyVisibility, validateStage2Framing, runAllStanceChecks,
  checkShoulderAnkleWidth, checkStanceToeAngles, isAnkleWidthSignificantlyOut,
  calibrateTorsoFromLandmarks, resetTorsoCalibration,
} from './poseLogic';
import { SquatRepTracker } from './SquatRepTracker.js';
import { KneeAngleRepMonitor } from './kneeMonitor.js';
import { TorsoBendRepMonitor } from './torsoMonitor.js';
import { ShoulderLevelRepMonitor } from './shoulderMonitor.js';
import { getRepSpeedWarningKey, selectRepPostureWarning } from './warningPriority';
import { LM, CFG, nowSec, COLOR_GREEN, COLOR_AMBER, COLOR_RED } from './config.js';
import { VoiceManager } from '../../core/voiceManager.js';
import { lockTempoGateAtStance } from './draw.js';

// ── Phase constants ───────────────────────────────────────────────────────────
export const PHASE = {
  BODY_NOT_VISIBLE:      'body_not_visible',
  WAITING_FOR_PERSON:    'waiting_for_person',
  CHECKING_BOUNDARY:     'checking_boundary',
  STANCE_FOOT_WIDTH:     'stance_foot_width',
  STANCE_TOE_ANGLE:      'stance_toe_angle',
  READY_TO_START:        'ready_to_start',
  EXERCISE_ACTIVE:       'exercise_active',
  DONE:                  'done',
};

// ── Timing constants ──────────────────────────────────────────────────────────
const BOUNDARY_STABLE_SEC      = 1.0;  // hold in box before confirming
const STANCE_PASS_HOLD_SEC     = 1.2;  // must hold a valid stance before advancing
const STANCE_ANNOUNCE_SEC      = 2.8;  // min time in a stance step before it can pass
const STANCE_ANNOUNCE_MAX_SEC  = 7.0;  // don't block forever if TTS never ends
const READY_TO_START_DELAY_SEC = 4.5;  // wait for "do rep one" announcement

// Trainer-like correction pacing: a real trainer gives ONE instruction, then
// watches and waits for the user to actually attempt the correction before
// saying anything else. These two constants control that behaviour:
const INSTRUCTION_CONFIRM_SEC   = 0.4; // ignore single-frame noise before trusting a "problem" reading
const INSTRUCTION_MIN_WAIT_SEC  = 2.5; // min silence after an instruction before repeating/switching it

const VOICE_CD_MS = 10000;             // 10 second voice cooldown (spec)

// ── Voice messages ────────────────────────────────────────────────────────────
const VOICE_MSG = {
  body_not_visible: 'Please ensure your full body is visible.',
  move_back:        'Move back so your entire body is in the frame.',
  head_legs_visible:'Your head and both legs must be visible.',
  no_person:        'Please ensure your full body is visible.',
  inside_box:       'Move back so your entire body is in the frame.',
  head_not_visible: 'Your head and both legs must be visible.',
  feet_not_visible: 'Your head and both legs must be visible.',
  stance_begin:     'I am going to check your stance.',
  foot_width_ok:    'Your foot width is okay.',
  stance_narrow:    'Move your feet farther apart.',
  stance_wide:      'Bring your feet slightly closer together.',
  stance_width_hint:'Place your feet approximately shoulder-width apart.',
  stance_ok:        'Your stance looks good. Let\'s begin the exercise.',
  do_rep_one:       'Do rep one.',
  calibrate:        'Stand tall and straight so I can calibrate your squat depth.',
  too_fast:         'Too fast.',
  too_slow:         'Too slow.',
  too_deep:         'You are squatting too deep.',
  too_early:        'You are standing up too early.',
  done:             'Congratulations. You finished every rep.',
};

const STANCE_PASSED_ALL = { foot_width: true, toe_angle: true };

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
  constructor({ targetReps = 0, voice = true } = {}) {
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps;
    this._sq = new SquatRepTracker();
    this._kneeMon = new KneeAngleRepMonitor();
    this._torsoMon = new TorsoBendRepMonitor();
    this._shoulderMon = new ShoulderLevelRepMonitor();
    this._wasInSquat = false;
    this._phase = PHASE.WAITING_FOR_PERSON;
    this._repCount = 0;
    this._activeFeedback = '';
    this._stancePassedChecks = {};
    this._currentStanceCheck = null;
    this._boundaryStableStart = -1;
    this._stancePassHoldStart = -1;
    this._stanceStepEnteredAt = -1;
    this._readyStart = -1;
    this._stanceBeginVoiceSent = false;
    this._footWidthOkVoiceSent = false;
    this._stanceOkVoiceSent = false;
    this._doRepOneVoiceSent = false;
    this._doneVoiceSent = false;
    this._lastInstructionKey = '';
    this._lastInstructionAt = -1;
    this._pendingInstructionKey = '';
    this._pendingInstructionSince = -1;
    this._stillSince = -1;
    this._prevStanceSnapshot = null;
    this._lockedAnkleRatio = null;
    this._lastSeenRep = 0;
    CFG.squat_max_reps = targetReps;
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
    this._stillSince = -1;
    this._prevStanceSnapshot = null;
    this._advancePhase(phase);
  }

  _stanceSnapshot(landmarks) {
    const ids = [
      LM.NOSE,
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
      LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX,
    ];
    return ids.map((id) => {
      const lm = landmarks[id];
      return lm ? { x: lm.x, y: lm.y } : null;
    });
  }

  _isStandingStill(landmarks, now) {
    const snap = this._stanceSnapshot(landmarks);
    const prev = this._prevStanceSnapshot;
    this._prevStanceSnapshot = snap;
    if (!prev) {
      this._stillSince = -1;
      return false;
    }

    let total = 0;
    let count = 0;
    for (let i = 0; i < snap.length; i++) {
      const a = snap[i];
      const b = prev[i];
      if (!a || !b) continue;
      total += Math.hypot(a.x - b.x, a.y - b.y);
      count++;
    }
    if (count === 0) {
      this._stillSince = -1;
      return false;
    }

    // Reuse the existing frame-margin tolerance as the stillness threshold.
    const avgMotion = total / count;
    if (avgMotion > CFG.keypoint_frame_margin) {
      this._stillSince = -1;
      return false;
    }
    if (this._stillSince < 0) this._stillSince = now;
    return (now - this._stillSince) >= STANCE_PASS_HOLD_SEC;
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
      drawGuideBox: fr.drawGuideBox,
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

    // ═══════════════════════════════════════════════════════════════════════
    // GLOBAL GATE — the very first check on every frame
    // Freeze all squat processing until required landmarks are visible again.
    // ═══════════════════════════════════════════════════════════════════════
    const bodyGate = validateFullBodyVisibility(landmarks);
    if (!bodyGate.ready) {
      let voiceKey = 'body_not_visible';
      let voiceMsg = VOICE_MSG.body_not_visible;
      if (bodyGate.message === VOICE_MSG.head_legs_visible) {
        voiceKey = 'head_legs_visible';
        voiceMsg = VOICE_MSG.head_legs_visible;
      } else if (bodyGate.message === VOICE_MSG.move_back) {
        voiceKey = 'move_back';
        voiceMsg = VOICE_MSG.move_back;
      }
      this._speak(voiceMsg, { key: voiceKey, cooldownMs: VOICE_CD_MS });
      return _baseResult(PHASE.BODY_NOT_VISIBLE, {
        bodyState: 'BODY_NOT_VISIBLE',
        bodyNotVisible: true,
        poseDetected: false,
        landmarks: null,
        status: bodyGate.message,
        statusKind: 'fail',
        drawGuideBox: true,
        boneColor: COLOR_AMBER,
        stanceData: null,
        squatTracker: this._sq,
        runAnalysis: false,
        activeFeedback: bodyGate.message,
        repCount: this._repCount,
        currentStanceCheck: this._currentStanceCheck,
        resumePhase: visiblePhase,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE: WAITING_FOR_PERSON — strict landmark availability check
    // ═══════════════════════════════════════════════════════════════════════
    if (visiblePhase === PHASE.WAITING_FOR_PERSON) {
      // Person detected → advance
      this._advancePhase(PHASE.CHECKING_BOUNDARY);
      return _baseResult(PHASE.CHECKING_BOUNDARY, {
        poseDetected: true, landmarks,
        status: 'Person detected', statusKind: 'info',
        drawGuideBox: true, boneColor: COLOR_GREEN,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE: CHECKING_BOUNDARY — only check here, never again after passing
    // ═══════════════════════════════════════════════════════════════════════
    if (visiblePhase === PHASE.CHECKING_BOUNDARY) {
      const v = validateStage2Framing(landmarks, w, h);

      if (v.ready) {
        if (this._boundaryStableStart < 0) this._boundaryStableStart = now;
        const stable = now - this._boundaryStableStart;

        if (stable >= BOUNDARY_STABLE_SEC) {
          // Boundary passed — start foot-width stance check first
          this._boundaryStableStart = -1;
          this._stanceBeginVoiceSent = false;
          this._footWidthOkVoiceSent = false;
          this._lockedAnkleRatio = null;
          this._setStancePassedChecks({});
          this._currentStanceCheck = 'foot_width';
          this._enterStanceStep(PHASE.STANCE_FOOT_WIDTH, now);
          return _baseResult(PHASE.STANCE_FOOT_WIDTH, {
            poseDetected: true, landmarks,
            status: 'Checking foot width…', statusKind: 'info',
            drawGuideBox: false, boneColor: COLOR_GREEN,
            stanceData: checkShoulderAnkleWidth(landmarks),
            currentStanceCheck: 'foot_width',
          });
        }

        // Not yet stable
        return _baseResult(cur, {
          poseDetected: true, landmarks,
          status: 'Full body detected. Hold still…', statusKind: 'ok',
          drawGuideBox: true, boneColor: COLOR_GREEN,
        });
      } else {
        // Not in box yet — guide user (only 2 voice variants: head + feet)
        this._boundaryStableStart = -1;
        const kind = v.kind || 'poor_detection';

        let line2 = null;
        if (kind === 'head') line2 = VOICE_MSG.head_not_visible;
        else if (kind === 'feet' || kind === 'legs') line2 = VOICE_MSG.feet_not_visible;

        // Always say "please come inside the box" + specific issue (cooldown 10s each)
        this._speak(VOICE_MSG.inside_box, { key: 'inside_box', cooldownMs: VOICE_CD_MS });
        if (line2) {
          this._speak(line2, { key: 'kind_' + kind, cooldownMs: VOICE_CD_MS });
        }

        return _baseResult(cur, {
          poseDetected: true, landmarks,
          status: v.message || 'Stand inside the yellow box.',
          statusKind: 'fail',
          drawGuideBox: true, boneColor: COLOR_AMBER,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FROM HERE ONWARDS: never re-check person or boundary.
    // If landmarks vanish, just show last-known and keep waiting silently.
    // ═══════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════════
    // STANCE_FOOT_WIDTH — ankle width ≈ shoulder width (must pass first)
    // ═══════════════════════════════════════════════════════════════════════
    if (visiblePhase === PHASE.STANCE_FOOT_WIDTH) {
      if (!this._stanceBeginVoiceSent) {
        this._stanceBeginVoiceSent = true;
        console.log('[Flow] Speaking stance-begin announcement');
        this._speak(VOICE_MSG.stance_begin, {
          key: 'stance_begin', cooldownMs: 0, immediate: true,
        });
      }

      const widthCheck = checkShoulderAnkleWidth(landmarks);
      const still = this._isStandingStill(landmarks, now);
      const stepReady = this._stanceStepReady(now);

      if (!still) {
        this._stancePassHoldStart = -1;
        return _baseResult(cur, {
          poseDetected: true, landmarks,
          status: 'Stand still…', statusKind: 'info',
          drawGuideBox: false,
          boneColor: COLOR_AMBER,
          stanceData: widthCheck,
          stancePassedChecks: { ...this._stancePassedChecks },
          currentStanceCheck: 'foot_width',
          activeFeedback: '',
        });
      }

      if (!widthCheck.ok) {
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
          currentStanceCheck: 'foot_width',
          activeFeedback: widthCheck.feedback,
        });
      }

      // Width corrected: acknowledge once, then proceed only after the user settles.
      if (this._lastInstructionKey) {
        this._lastInstructionKey = '';
        this._lastInstructionAt = -1;
      }
      this._maybeIssueInstruction(null, '', now);

      if (widthCheck.ok && stepReady) {
        if (this._stancePassHoldStart < 0) this._stancePassHoldStart = now;
        if (now - this._stancePassHoldStart >= STANCE_PASS_HOLD_SEC) {
          // Lock accepted ankle-width range, then advance to toe-angle only
          this._lockedAnkleRatio = widthCheck.ratio;
          this._setStancePassedChecks({ foot_width: true });
          this._footWidthOkVoiceSent = true;
          this._currentStanceCheck = 'toe_angle';
          // Queued (not immediate) so we don't cancel the stance intro mid-sentence
          this._speakQueued(VOICE_MSG.foot_width_ok, { key: 'foot_width_ok' });
          this._enterStanceStep(PHASE.STANCE_TOE_ANGLE, now);
          return _baseResult(PHASE.STANCE_TOE_ANGLE, {
            poseDetected: true, landmarks,
            status: VOICE_MSG.foot_width_ok, statusKind: 'ok',
            drawGuideBox: false, boneColor: COLOR_GREEN,
            stanceData: checkStanceToeAngles(landmarks),
            stancePassedChecks: { foot_width: true },
            currentStanceCheck: 'toe_angle',
            activeFeedback: VOICE_MSG.foot_width_ok,
          });
        }
      } else if (widthCheck.ok && !stepReady) {
        // Valid, but still announcing / showing the foot-width step
        this._stancePassHoldStart = -1;
      }

      const waitingAnnounce = widthCheck.ok && !stepReady;
      return _baseResult(cur, {
        poseDetected: true, landmarks,
        status: waitingAnnounce
          ? 'Checking foot width…'
          : (widthCheck.ok ? 'Foot width OK — hold…' : widthCheck.feedback),
        statusKind: widthCheck.ok ? 'ok' : 'warn',
        drawGuideBox: false,
        boneColor: widthCheck.ok ? COLOR_GREEN : COLOR_AMBER,
        stanceData: widthCheck,
        stancePassedChecks: { ...this._stancePassedChecks },
        currentStanceCheck: 'foot_width',
        activeFeedback: widthCheck.ok ? '' : widthCheck.feedback,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STANCE_TOE_ANGLE — only active after foot width is locked
    // ═══════════════════════════════════════════════════════════════════════
    if (visiblePhase === PHASE.STANCE_TOE_ANGLE) {
      // Soft re-check: only coach foot width again if significantly outside lock
      if (isAnkleWidthSignificantlyOut(landmarks, this._lockedAnkleRatio)) {
        this._stancePassHoldStart = -1;
        const widthCheck = checkShoulderAnkleWidth(landmarks);
        const voiceKey = widthCheck.status === 'narrow' ? 'stance_narrow' : 'stance_wide';
        this._speak(widthCheck.feedback, { key: voiceKey + '_relock', cooldownMs: VOICE_CD_MS });
        return _baseResult(cur, {
          poseDetected: true, landmarks,
          status: widthCheck.feedback, statusKind: 'warn',
          drawGuideBox: false, boneColor: COLOR_AMBER,
          stanceData: { ...widthCheck, stanceMode: 'width' },
          stancePassedChecks: { foot_width: true },
          currentStanceCheck: 'toe_angle',
          activeFeedback: widthCheck.feedback,
        });
      }

      const toeCheck = checkStanceToeAngles(landmarks);
      const still = this._isStandingStill(landmarks, now);
      const stepReady = this._stanceStepReady(now);

      if (!still) {
        this._stancePassHoldStart = -1;
        return _baseResult(cur, {
          poseDetected: true, landmarks,
          status: 'Stand still…', statusKind: 'info',
          drawGuideBox: false,
          boneColor: COLOR_AMBER,
          stanceData: toeCheck,
          stancePassedChecks: { foot_width: true, toe_angle: false },
          currentStanceCheck: 'toe_angle',
          activeFeedback: '',
        });
      }

      if (!toeCheck.ok) {
        const instructionKey = toeCheck.instructionKeys.join('|');
        const instructionText = toeCheck.feedback;
        this._maybeIssueInstruction(instructionKey, instructionText, now);

        return _baseResult(cur, {
          poseDetected: true, landmarks,
          status: instructionText || 'Adjust your toes.',
          statusKind: 'warn',
          drawGuideBox: false,
          boneColor: COLOR_AMBER,
          stanceData: toeCheck,
          stancePassedChecks: { foot_width: true, toe_angle: false },
          currentStanceCheck: 'toe_angle',
          activeFeedback: instructionText || 'Adjust your toes.',
        });
      }

      if (this._lastInstructionKey) {
        this._lastInstructionKey = '';
        this._lastInstructionAt = -1;
      }
      this._maybeIssueInstruction(null, '', now);

      if (toeCheck.ok && stepReady) {
        if (this._stancePassHoldStart < 0) this._stancePassHoldStart = now;
        if (now - this._stancePassHoldStart >= STANCE_PASS_HOLD_SEC) {
          this._stancePassHoldStart = -1;
          this._setStancePassedChecks(STANCE_PASSED_ALL);
          this._stanceOkVoiceSent = true;
          this._doRepOneVoiceSent = false;
          this._readyStart = now;
          this._currentStanceCheck = null;
          this._speakQueued(VOICE_MSG.stance_ok, { key: 'stance_ok' });
          this._advancePhase(PHASE.READY_TO_START);
          return _baseResult(PHASE.READY_TO_START, {
            poseDetected: true, landmarks,
            status: VOICE_MSG.stance_ok, statusKind: 'ok',
            drawGuideBox: false, boneColor: COLOR_GREEN,
            stanceData: toeCheck,
            stancePassedChecks: { ...STANCE_PASSED_ALL },
            activeFeedback: VOICE_MSG.stance_ok,
          });
        }
      } else if (toeCheck.ok && !stepReady) {
        // Wait for "foot width is okay" to finish before allowing toe pass
        this._stancePassHoldStart = -1;
      }

      const waitingAnnounce = toeCheck.ok && !stepReady;
      return _baseResult(cur, {
        poseDetected: true, landmarks,
        status: waitingAnnounce
          ? 'Checking toe angle…'
          : (toeCheck.ok ? 'Toe angle OK — hold…' : toeCheck.feedback),
        statusKind: toeCheck.ok ? 'ok' : 'warn',
        drawGuideBox: false,
        boneColor: toeCheck.ok ? COLOR_GREEN : COLOR_AMBER,
        stanceData: toeCheck,
        stancePassedChecks: { foot_width: true, toe_angle: !!(toeCheck.ok && stepReady) },
        currentStanceCheck: 'toe_angle',
        activeFeedback: toeCheck.ok ? '' : toeCheck.feedback,
      });
    }

    // Exercise-phase form checks (unchanged) — not used during stance setup
    const checks = runAllStanceChecks(landmarks);

    // ═══════════════════════════════════════════════════════════════════════
    // READY_TO_START — speak start cues + "do rep one"
    // ═══════════════════════════════════════════════════════════════════════
    if (visiblePhase === PHASE.READY_TO_START) {
      const elapsed = now - this._readyStart;

      // Stance-ok already spoken on toe-angle pass; queue "Do rep one"
      if (!this._doRepOneVoiceSent && elapsed >= 2.0) {
        this._doRepOneVoiceSent = true;
        console.log('[Flow] Queuing "Do rep one"');
        this._speakQueued(VOICE_MSG.do_rep_one, { key: 'do_rep_one' });
      }

      // After full delay, lock tempo gate + calibrate torso reference + advance
      if (elapsed < READY_TO_START_DELAY_SEC) {
        return _baseResult(PHASE.READY_TO_START, {
          poseDetected: true, landmarks,
          status: 'Starting exercise…', statusKind: 'ok',
          drawGuideBox: false, boneColor: COLOR_GREEN,
          stanceData: checks,
          stancePassedChecks: { ...STANCE_PASSED_ALL },
          activeFeedback: 'Get ready…',
        });
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
        if (lastRep && !lastRep.full_depth) {
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
        const speedKey    = getRepSpeedWarningKey(sq);
        const kneeMsg     = kneeMon.consumeEndOfRepFeedback();
        const torsoMsg    = torsoMon.consumeEndOfRepFeedback();
        const shoulderMsg = shoulderMon.consumeEndOfRepFeedback();
        const warning     = selectRepPostureWarning({ speedKey, kneeMsg, torsoMsg, shoulderMsg });
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
      else if (sq.tooDeep) {
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

      return _baseResult(PHASE.EXERCISE_ACTIVE, {
        poseDetected: true, landmarks,
        status: feedbackText || (sq._inSquat ? 'Squatting…' : (sq.isCalibrated ? 'Standing' : `Calibrating (${sq.calibrationPct}%)`)),
        statusKind: feedbackText ? 'warn' : 'ok',
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
    this._wasInSquat   = false;
    // Clear torso calibration so the next session re-captures standing height.
    resetTorsoCalibration();
    this._phase = PHASE.WAITING_FOR_PERSON;

    this._boundaryStableStart = -1;
    this._stancePassHoldStart = -1;
    this._stanceStepEnteredAt = -1;
    this._readyStart          = -1;

    this._stanceBeginVoiceSent = false;
    this._footWidthOkVoiceSent = false;
    this._stanceOkVoiceSent = false;
    this._doRepOneVoiceSent = false;
    this._doneVoiceSent     = false;
    this._lastInstructionKey = '';
    this._lastInstructionAt = -1;
    this._pendingInstructionKey = '';
    this._pendingInstructionSince = -1;
    this._stillSince = -1;
    this._prevStanceSnapshot = null;
    this._lockedAnkleRatio  = null;
    this._lastSeenRep       = 0;

    this._repCount = 0;
    this._activeFeedback = '';
    this._setStancePassedChecks({});
    this._currentStanceCheck = (null);
    CFG.squat_max_reps = this._targetReps;
    console.log('[Flow] Reset to WAITING_FOR_PERSON');
  }
}
