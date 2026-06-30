// ─── useSquatFlow.js ──────────────────────────────────────────────────────────
// Sequential AI coaching state machine for squat workflow.
//
// States:
//   WAITING_FOR_PERSON  — no human detected yet
//   CHECKING_BOUNDARY   — human present, verify full body in yellow box
//   STANCE_FEET_POSITION — adjust feet placement (one-at-a-time)
//   STANCE_FEET_ROTATION — adjust foot rotation
//   STANCE_SHOULDERS    — straighten shoulders / spine
//   STANCE_CONFIRMATION — recheck all three stance items
//   READY_TO_START      — speak "stance correct, starting exercise"
//   EXERCISE_ACTIVE     — squat tracking + 4 feedback types
//   DONE                — all reps complete
//
// IMPORTANT RULES (per spec):
//   1. After CHECKING_BOUNDARY passes ONCE, never re-validate full body again.
//   2. Stance order is strict: FEET_POSITION → FEET_ROTATION → SHOULDERS.
//   3. After all 3 pass, one full re-pass (STANCE_CONFIRMATION).
//   4. Voice repeated message cooldown = 10 seconds.
//   5. Exercise voice: too fast, too slow, too deep, standing up too early,
//      plus per-rep posture warnings (speed → knee → torso, one voice only).
//   6. Only ONE live feedback active at a time.

import {
  validateStage2Framing, runAllStanceChecks,
  calibrateTorsoFromLandmarks, resetTorsoCalibration,
} from './poseLogic';
import { SquatRepTracker } from './SquatRepTracker.js';
import { KneeAngleRepMonitor } from './kneeMonitor.js';
import { TorsoBendRepMonitor } from './torsoMonitor.js';
import { getRepSpeedWarningKey, selectRepPostureWarning } from './warningPriority';
import { LM, VOICE_CUES, CFG, nowSec, COLOR_GREEN, COLOR_AMBER, COLOR_RED } from './config.js';
import { VoiceManager } from '../../core/voiceManager.js';
import { lockTempoGateAtStance } from './draw.js';

// ── Phase constants ───────────────────────────────────────────────────────────
export const PHASE = {
  WAITING_FOR_PERSON:    'waiting_for_person',
  CHECKING_BOUNDARY:     'checking_boundary',
  STANCE_FEET_POSITION:  'stance_feet_position',
  STANCE_FEET_ROTATION:  'stance_feet_rotation',
  STANCE_SHOULDERS:      'stance_shoulders',
  STANCE_CONFIRMATION:   'stance_confirmation',
  READY_TO_START:        'ready_to_start',
  EXERCISE_ACTIVE:       'exercise_active',
  DONE:                  'done',
};

// Map our 3 stance categories to runAllStanceChecks() result keys
const CAT_TO_CHECK = {
  feet_position:  'shoulder_foot',  // ankle alignment under shoulders
  feet_rotation:  'foot_index',     // toe rotation
  shoulders:      'shoulder_level', // shoulder height balance
};

const CAT_TO_RESULT_KEY = {
  feet_position:  'sf',
  feet_rotation:  'fi',
  shoulders:      'shlvl',
};

const CAT_GENERIC_VOICE = {
  feet_position:  'Adjust your feet.',
  feet_rotation:  'Rotate your feet to face forward.',
  shoulders:      'Straighten your shoulders. Stand upright.',
};

// ── Timing constants ──────────────────────────────────────────────────────────
const BOUNDARY_STABLE_SEC      = 1.0;  // hold in box before confirming
const STANCE_PASS_HOLD_SEC     = 0.8;  // hold passing for advance
const CONFIRMATION_HOLD_SEC    = 1.5;  // all-3-passing for confirmation
const READY_TO_START_DELAY_SEC = 4.5;  // wait for "do rep one" announcement

const VOICE_CD_MS = 10000;             // 10 second voice cooldown (spec)

// ── Voice messages ────────────────────────────────────────────────────────────
const VOICE_MSG = {
  no_person:        'No person detected.',
  inside_box:       'Please come inside the box.',
  head_not_visible: 'Head is not visible.',
  feet_not_visible: 'Feet are not visible.',
  full_body_ok:     'Full body detected. Please do not move. I am going to check your stance.',
  stance_ok:        'Don\'t move. Your stance is correct. We are going to start the exercise.',
  do_rep_one:       'Do rep one.',
  calibrate:        'Stand tall and straight so I can calibrate your squat depth.',
  too_fast:         'Too fast.',
  too_slow:         'Too slow.',
  too_deep:         'You are squatting too deep.',
  too_early:        'You are standing up too early.',
  done:             'Congratulations. You finished every rep.',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function _baseResult(phase, overrides = {}) {
  return {
    phase,
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
    this._wasInSquat = false;
    this._phase = PHASE.WAITING_FOR_PERSON;
    this._repCount = 0;
    this._activeFeedback = '';
    this._stancePassedChecks = {};
    this._currentStanceCheck = null;
    this._boundaryStableStart = -1;
    this._stancePassHoldStart = -1;
    this._confirmationStart = -1;
    this._readyStart = -1;
    this._fullBodyVoiceSent = false;
    this._stanceOkVoiceSent = false;
    this._doRepOneVoiceSent = false;
    this._doneVoiceSent = false;
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

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE: WAITING_FOR_PERSON — strict landmark availability check
    // ═══════════════════════════════════════════════════════════════════════
    if (cur === PHASE.WAITING_FOR_PERSON) {
      if (!landmarks) {
        this._speak(VOICE_MSG.no_person, { key: 'no_person', cooldownMs: VOICE_CD_MS });
        return _baseResult(cur, {
          poseDetected: false, landmarks: null,
          status: 'No person detected', statusKind: 'fail',
          drawGuideBox: true,
        });
      }
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
    if (cur === PHASE.CHECKING_BOUNDARY) {
      if (!landmarks) {
        // Drop back to waiting for person if landmarks lost during boundary check
        this._boundaryStableStart = -1;
        this._advancePhase(PHASE.WAITING_FOR_PERSON);
        return _baseResult(PHASE.WAITING_FOR_PERSON, {
          poseDetected: false, landmarks: null,
          status: 'No person detected', statusKind: 'fail',
          drawGuideBox: true,
        });
      }

      const v = validateStage2Framing(landmarks, w, h);

      if (v.ready) {
        if (this._boundaryStableStart < 0) this._boundaryStableStart = now;
        const stable = now - this._boundaryStableStart;

        if (stable >= BOUNDARY_STABLE_SEC) {
          // Boundary passed — speak full body confirmation and lock setup phase forever
          if (!this._fullBodyVoiceSent) {
            this._fullBodyVoiceSent = true;
            console.log('[Flow] Boundary passed — speaking full-body confirmation (immediate)');
            this._speak(VOICE_MSG.full_body_ok, {
              key: 'full_body_ok', cooldownMs: 0, immediate: true,
            });
            // Hold here until announcement should reasonably be done
            return _baseResult(cur, {
              poseDetected: true, landmarks,
              status: 'Full body detected', statusKind: 'ok',
              drawGuideBox: true, boneColor: COLOR_GREEN,
              stanceData: runAllStanceChecks(landmarks),
            });
          }

          // 4.5s after announcement starts → advance to stance feet position
          if (stable >= BOUNDARY_STABLE_SEC + READY_TO_START_DELAY_SEC) {
            this._boundaryStableStart = -1;
            this._stancePassHoldStart = -1;
            this._setStancePassedChecks({});
            this._currentStanceCheck = ('feet_position');
            this._advancePhase(PHASE.STANCE_FEET_POSITION);
          }

          return _baseResult(cur, {
            poseDetected: true, landmarks,
            status: 'Hold still…', statusKind: 'ok',
            drawGuideBox: true, boneColor: COLOR_GREEN,
            stanceData: runAllStanceChecks(landmarks),
          });
        }

        // Not yet stable
        return _baseResult(cur, {
          poseDetected: true, landmarks,
          status: 'Full body detected. Hold still…', statusKind: 'ok',
          drawGuideBox: true, boneColor: COLOR_GREEN,
          stanceData: runAllStanceChecks(landmarks),
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
          stanceData: runAllStanceChecks(landmarks),
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FROM HERE ONWARDS: never re-check person or boundary.
    // If landmarks vanish, just show last-known and keep waiting silently.
    // ═══════════════════════════════════════════════════════════════════════
    if (!landmarks) {
      return _baseResult(cur, {
        poseDetected: false, landmarks: null,
        status: 'Waiting for pose…', statusKind: 'info',
        drawGuideBox: false,
      });
    }

    const checks = runAllStanceChecks(landmarks);

    // ═══════════════════════════════════════════════════════════════════════
    // STANCE PHASES — one category at a time, strict order
    // ═══════════════════════════════════════════════════════════════════════
    const runStanceCategory = (category, nextPhase) => {
      const checkName = CAT_TO_CHECK[category];
      const passed    = checks.checkOk[checkName];

      if (passed) {
        if (this._stancePassHoldStart < 0) this._stancePassHoldStart = now;
        if (now - this._stancePassHoldStart >= STANCE_PASS_HOLD_SEC) {
          // Mark this category passed
          const newPassed = { ...this._stancePassedChecks, [category]: true };
          this._setStancePassedChecks(newPassed);
          this._stancePassHoldStart = -1;
          if (nextPhase === PHASE.STANCE_CONFIRMATION) {
            this._confirmationStart = -1;
          }
          this._currentStanceCheck = (stanceCategoryFor(nextPhase));
          this._advancePhase(nextPhase);
        }
      } else {
        this._stancePassHoldStart = -1;
        // Speak the first cue for this failing check (10s cooldown)
        const resKey   = CAT_TO_RESULT_KEY[category];
        const cues     = checks[resKey]?.cues || [];
        const firstCue = cues[0];
        const msg = (firstCue && VOICE_CUES[firstCue]?.[0]) || CAT_GENERIC_VOICE[category];
        this._speak(msg, { key: 'stance_' + category, cooldownMs: VOICE_CD_MS });
      }

      return _baseResult(cur, {
        poseDetected: true, landmarks,
        status: passed
          ? `${labelFor(category)} ✓`
          : `Fixing: ${labelFor(category)}`,
        statusKind: passed ? 'ok' : 'warn',
        drawGuideBox: false,
        boneColor: passed ? COLOR_GREEN : COLOR_AMBER,
        stanceData: checks,
        stancePassedChecks: { ...this._stancePassedChecks, ...(passed ? { [category]: this._stancePassedChecks[category] } : {}) },
        currentStanceCheck: category,
      });
    };

    if (cur === PHASE.STANCE_FEET_POSITION) {
      return runStanceCategory('feet_position', PHASE.STANCE_FEET_ROTATION);
    }
    if (cur === PHASE.STANCE_FEET_ROTATION) {
      return runStanceCategory('feet_rotation', PHASE.STANCE_SHOULDERS);
    }
    if (cur === PHASE.STANCE_SHOULDERS) {
      return runStanceCategory('shoulders', PHASE.STANCE_CONFIRMATION);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STANCE_CONFIRMATION — all 3 must be passing simultaneously for hold
    // ═══════════════════════════════════════════════════════════════════════
    if (cur === PHASE.STANCE_CONFIRMATION) {
      const allOk = checks.checkOk.shoulder_foot &&
                    checks.checkOk.foot_index    &&
                    checks.checkOk.shoulder_level;

      if (allOk) {
        if (this._confirmationStart < 0) this._confirmationStart = now;

        if (now - this._confirmationStart >= CONFIRMATION_HOLD_SEC) {
          this._confirmationStart = -1;
          this._stanceOkVoiceSent = false;
          this._doRepOneVoiceSent = false;
          this._readyStart = now;
          this._currentStanceCheck = (null);
          this._advancePhase(PHASE.READY_TO_START);
        }

        return _baseResult(cur, {
          poseDetected: true, landmarks,
          status: 'Confirming stance…', statusKind: 'ok',
          drawGuideBox: false, boneColor: COLOR_GREEN,
          stanceData: checks,
          stancePassedChecks: { feet_position: true, feet_rotation: true, shoulders: true },
          currentStanceCheck: null,
        });
      } else {
        // Drop back to whichever category failed first
        this._confirmationStart   = -1;
        this._stancePassHoldStart = -1;
        let backPhase = PHASE.STANCE_FEET_POSITION;
        let backCat   = 'feet_position';
        if (checks.checkOk.shoulder_foot && !checks.checkOk.foot_index) {
          backPhase = PHASE.STANCE_FEET_ROTATION; backCat = 'feet_rotation';
        } else if (checks.checkOk.shoulder_foot && checks.checkOk.foot_index && !checks.checkOk.shoulder_level) {
          backPhase = PHASE.STANCE_SHOULDERS; backCat = 'shoulders';
        }
        this._setStancePassedChecks(prev => {
          const next = { ...prev };
          delete next[backCat];
          return next;
        });
        this._currentStanceCheck = (backCat);
        this._advancePhase(backPhase);

        return _baseResult(backPhase, {
          poseDetected: true, landmarks,
          status: `Re-check: ${labelFor(backCat)}`, statusKind: 'warn',
          drawGuideBox: false, boneColor: COLOR_AMBER,
          stanceData: checks,
          stancePassedChecks: { feet_position: true, feet_rotation: true, shoulders: true, [backCat]: false },
          currentStanceCheck: backCat,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // READY_TO_START — speak "stance correct" + "do rep one"
    // ═══════════════════════════════════════════════════════════════════════
    if (cur === PHASE.READY_TO_START) {
      const elapsed = now - this._readyStart;

      if (!this._stanceOkVoiceSent) {
        this._stanceOkVoiceSent = true;
        console.log('[Flow] Speaking stance-correct announcement');
        this._speak(VOICE_MSG.stance_ok, { key: 'stance_ok', cooldownMs: 0, immediate: true });
      }

      // Queue "Do rep one" after the first sentence has had ~3.5s
      if (!this._doRepOneVoiceSent && elapsed >= 3.5) {
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
          stancePassedChecks: { feet_position: true, feet_rotation: true, shoulders: true },
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

      // ── Knee / torso posture (only while descending/ascending, not at stand) ──
      const kneeMon  = this._kneeMon;
      const torsoMon = this._torsoMon;
      if (sq._inSquat) {
        if (!wasInSquat) {
          kneeMon.onRepStart();
          torsoMon.onRepStart();
        }
        kneeMon.updateFrame(landmarks);
        torsoMon.updateFrame(landmarks);
      } else if (wasInSquat && sq.count === prevCount) {
        kneeMon.onRepCancelled();
        torsoMon.onRepCancelled();
      }
      this._wasInSquat = sq._inSquat;

      // ── Rep completed ──────────────────────────────────────────────
      if (sq.count > prevCount) {
        const n = sq.count;
        this._repCount = n;
        this._lastSeenRep = n;

        // Check most recent rep metric for "standing up too early" (partial)
        const lastRep = sq.repMetrics[sq.repMetrics.length - 1];
        if (lastRep && !lastRep.full_depth) {
          console.log(`[Flow] Rep ${n} was partial → "standing up too early"`);
          this._speak(VOICE_MSG.too_early, { key: 'too_early', cooldownMs: VOICE_CD_MS });
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
            stancePassedChecks: { feet_position: true, feet_rotation: true, shoulders: true },
          });
        }

        // Per-rep posture voice: speed → knee → torso (exactly one).
        const speedKey = getRepSpeedWarningKey(sq);
        const kneeMsg  = kneeMon.consumeEndOfRepFeedback();
        const torsoMsg = torsoMon.consumeEndOfRepFeedback();
        const warning  = selectRepPostureWarning({ speedKey, kneeMsg, torsoMsg });
        if (warning) {
          console.log(`[Flow] Rep ${n} warning (${warning.kind}) → "${warning.text}"`);
          this._speak(warning.text, { key: warning.key, cooldownMs: VOICE_CD_MS });
          this._activeFeedback = (warning.text);
        }

        // Prompt next rep after each completed rep.
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
        stancePassedChecks: { feet_position: true, feet_rotation: true, shoulders: true },
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
      stancePassedChecks: { feet_position: true, feet_rotation: true, shoulders: true },
    });
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  reset() {
    this._voice.cancel();
    this._voice.resetCooldowns();
    this._sq       = new SquatRepTracker();
    this._kneeMon  = new KneeAngleRepMonitor();
    this._torsoMon = new TorsoBendRepMonitor();
    this._wasInSquat   = false;
    // Clear torso calibration so the next session re-captures standing height.
    resetTorsoCalibration();
    this._phase = PHASE.WAITING_FOR_PERSON;

    this._boundaryStableStart = -1;
    this._stancePassHoldStart = -1;
    this._confirmationStart   = -1;
    this._readyStart          = -1;

    this._fullBodyVoiceSent = false;
    this._stanceOkVoiceSent = false;
    this._doRepOneVoiceSent = false;
    this._doneVoiceSent     = false;
    this._lastSeenRep       = 0;

    this._repCount = 0;
    this._activeFeedback = '';
    this._setStancePassedChecks({});
    this._currentStanceCheck = (null);
    CFG.squat_max_reps = this._targetReps;
    console.log('[Flow] Reset to WAITING_FOR_PERSON');
  }
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function labelFor(category) {
  return { feet_position: 'Feet Position',
           feet_rotation: 'Feet Rotation',
           shoulders:     'Shoulders' }[category] || category;
}

function stanceCategoryFor(phase) {
  if (phase === PHASE.STANCE_FEET_POSITION) return 'feet_position';
  if (phase === PHASE.STANCE_FEET_ROTATION) return 'feet_rotation';
  if (phase === PHASE.STANCE_SHOULDERS)     return 'shoulders';
  return null;
}
