// Side-view squat flow — mirrors SquatFlow state machine with profile-specific
// pose checks. Same voice timing, rep counting (SquatRepTracker), and feedback.

import {
  validateSideStage2Framing,
  runSideStandingCheck,
  runSideFormChecks,
  getSideSquatCoords,
} from './poseLogicSide.js';
import { SquatRepTracker } from '../squat/SquatRepTracker.js';
import { KneeAngleRepMonitor } from '../squat/kneeMonitor.js';
import { TorsoBendSideRepMonitor } from './torsoMonitorSide.js';
import { getRepSpeedWarningKey, selectRepPostureWarning } from '../squat/warningPriority';
import { CFG, nowSec, COLOR_GREEN, COLOR_AMBER, COLOR_RED } from '../squat/config.js';
import { VoiceManager } from '../../core/voiceManager.js';
import { lockSideTempoGateAtStance } from './draw.js';

export const SIDE_PHASE = {
  WAITING_FOR_PERSON:      'waiting_for_person',
  CHECKING_BOUNDARY:       'checking_boundary',
  STANCE_STANDING_STRAIGHT:'stance_standing_straight',
  READY_TO_START:          'ready_to_start',
  EXERCISE_ACTIVE:         'exercise_active',
  DONE:                    'done',
};

const STANDING_GENERIC_VOICE = 'Straighten your back. Stand upright.';

const BOUNDARY_STABLE_SEC      = 1.0;
const STANCE_PASS_HOLD_SEC     = 0.8;
const READY_TO_START_DELAY_SEC = 4.5;
const VOICE_CD_MS = 10000;

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
    sideVis:            null,
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

export class SquatSideFlow {
  constructor({ targetReps = 0, voice = true } = {}) {
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps;
    this._sq = new SquatRepTracker();
    this._kneeMon = new KneeAngleRepMonitor();
    this._torsoMon = new TorsoBendSideRepMonitor();
    this._wasInSquat = false;
    this._phase = SIDE_PHASE.WAITING_FOR_PERSON;
    this._repCount = 0;
    this._activeFeedback = '';
    this._boundaryStableStart = -1;
    this._stancePassHoldStart = -1;
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
    const active = fr.phase === SIDE_PHASE.EXERCISE_ACTIVE;
    const cueText = fr.activeFeedback || fr.status || (active ? 'Tracking…' : 'Get ready…');
    const formScore = active && fr.squatTracker && !fr.squatTracker.isCalibrated
      ? Math.max(10, fr.squatTracker.calibrationPct)
      : (level === 'warn' ? 72 : 100);
    return {
      exerciseId: 'squat-side',
      repCount: fr.repCount ?? this._repCount,
      phase: active ? (fr.squatTracker?.inSquat ? 'down' : 'up') : fr.phase,
      progress: fr.squatTracker?.depthPct ?? 0,
      formScore,
      ready: [SIDE_PHASE.EXERCISE_ACTIVE, SIDE_PHASE.DONE].includes(fr.phase),
      posture: fr.statusKind === 'ok' ? 'correct' : 'warning',
      cues: [{ level, text: cueText }],
      feedback: fr.activeFeedback || null,
      skeletonColor: fr.boneColor || colors[level] || colors.ok,
      drawGuideBox: fr.drawGuideBox,
      flowPhase: fr.phase,
      stanceData: fr.stanceData,
      sideVis: fr.sideVis,
      squatTracker: fr.squatTracker,
      runAnalysis: fr.runAnalysis,
    };
  }

  tick(landmarks, w, h) {
    const now = nowSec();
    const sq = this._sq;
    const cur = this._phase;

    if (cur === SIDE_PHASE.WAITING_FOR_PERSON) {
      if (!landmarks) {
        this._speak(VOICE_MSG.no_person, { key: 'side_no_person', cooldownMs: VOICE_CD_MS });
        return _baseResult(cur, {
          poseDetected: false, landmarks: null,
          status: 'No person detected', statusKind: 'fail',
          drawGuideBox: true,
        });
      }
      this._advancePhase(SIDE_PHASE.CHECKING_BOUNDARY);
      return _baseResult(SIDE_PHASE.CHECKING_BOUNDARY, {
        poseDetected: true, landmarks,
        status: 'Person detected', statusKind: 'info',
        drawGuideBox: true, boneColor: COLOR_GREEN,
      });
    }

    if (cur === SIDE_PHASE.CHECKING_BOUNDARY) {
      if (!landmarks) {
        this._boundaryStableStart = -1;
        this._advancePhase(SIDE_PHASE.WAITING_FOR_PERSON);
        return _baseResult(SIDE_PHASE.WAITING_FOR_PERSON, {
          poseDetected: false, landmarks: null,
          status: 'No person detected', statusKind: 'fail',
          drawGuideBox: true,
        });
      }

      const v = validateSideStage2Framing(landmarks, w, h);

      if (v.ready) {
        if (this._boundaryStableStart < 0) this._boundaryStableStart = now;
        const stable = now - this._boundaryStableStart;

        if (stable >= BOUNDARY_STABLE_SEC) {
          if (!this._fullBodyVoiceSent) {
            this._fullBodyVoiceSent = true;
            this._speak(VOICE_MSG.full_body_ok, {
              key: 'side_full_body_ok', cooldownMs: 0, immediate: true,
            });
            return _baseResult(cur, {
              poseDetected: true, landmarks,
              status: 'Full body detected', statusKind: 'ok',
              drawGuideBox: true, boneColor: COLOR_GREEN,
              stanceData: runSideStandingCheck(landmarks),
              sideVis: v.vis,
            });
          }

          if (stable >= BOUNDARY_STABLE_SEC + READY_TO_START_DELAY_SEC) {
            this._boundaryStableStart = -1;
            this._stancePassHoldStart = -1;
            this._advancePhase(SIDE_PHASE.STANCE_STANDING_STRAIGHT);
          }

          return _baseResult(cur, {
            poseDetected: true, landmarks,
            status: 'Hold still…', statusKind: 'ok',
            drawGuideBox: true, boneColor: COLOR_GREEN,
            stanceData: runSideStandingCheck(landmarks),
            sideVis: v.vis,
          });
        }

        return _baseResult(cur, {
          poseDetected: true, landmarks,
          status: 'Full body detected. Hold still…', statusKind: 'ok',
          drawGuideBox: true, boneColor: COLOR_GREEN,
          stanceData: runSideStandingCheck(landmarks),
          sideVis: v.vis,
        });
      }

      this._boundaryStableStart = -1;
      const kind = v.kind || 'poor_detection';
      let line2 = null;
      if (kind === 'head') line2 = VOICE_MSG.head_not_visible;
      else if (kind === 'feet' || kind === 'legs') line2 = VOICE_MSG.feet_not_visible;

      this._speak(VOICE_MSG.inside_box, { key: 'side_inside_box', cooldownMs: VOICE_CD_MS });
      if (line2) {
        this._speak(line2, { key: 'side_kind_' + kind, cooldownMs: VOICE_CD_MS });
      }

      return _baseResult(cur, {
        poseDetected: true, landmarks,
        status: v.message || 'Stand inside the yellow box.',
        statusKind: 'fail',
        drawGuideBox: true, boneColor: COLOR_AMBER,
        stanceData: runSideStandingCheck(landmarks),
        sideVis: v.vis,
      });
    }

    if (!landmarks) {
      return _baseResult(cur, {
        poseDetected: false, landmarks: null,
        status: 'Waiting for pose…', statusKind: 'info',
        drawGuideBox: false,
      });
    }

    const checks = runSideStandingCheck(landmarks);
    const coords = getSideSquatCoords(landmarks);

    if (cur === SIDE_PHASE.STANCE_STANDING_STRAIGHT) {
      const passed = checks.checkOk.standing_straight;

      if (passed) {
        if (this._stancePassHoldStart < 0) this._stancePassHoldStart = now;
        if (now - this._stancePassHoldStart >= STANCE_PASS_HOLD_SEC) {
          this._stancePassHoldStart = -1;
          this._stanceOkVoiceSent = false;
          this._doRepOneVoiceSent = false;
          this._readyStart = now;
          this._advancePhase(SIDE_PHASE.READY_TO_START);
        }
      } else {
        this._stancePassHoldStart = -1;
        this._speak(STANDING_GENERIC_VOICE, {
          key: 'side_standing_straight', cooldownMs: VOICE_CD_MS,
        });
      }

      return _baseResult(cur, {
        poseDetected: true, landmarks,
        status: passed ? 'Standing straight ✓' : 'Fixing: stand straight',
        statusKind: passed ? 'ok' : 'warn',
        drawGuideBox: false,
        boneColor: passed ? COLOR_GREEN : COLOR_AMBER,
        stanceData: checks,
        sideVis: checks.vis,
        stancePassedChecks: { standing_straight: passed },
        currentStanceCheck: 'standing_straight',
      });
    }

    if (cur === SIDE_PHASE.READY_TO_START) {
      const elapsed = now - this._readyStart;

      if (!this._stanceOkVoiceSent) {
        this._stanceOkVoiceSent = true;
        this._speak(VOICE_MSG.stance_ok, { key: 'side_stance_ok', cooldownMs: 0, immediate: true });
      }

      if (!this._doRepOneVoiceSent && elapsed >= 3.5) {
        this._doRepOneVoiceSent = true;
        this._speakQueued(VOICE_MSG.do_rep_one, { key: 'side_do_rep_one' });
      }

      if (elapsed < READY_TO_START_DELAY_SEC) {
        return _baseResult(SIDE_PHASE.READY_TO_START, {
          poseDetected: true, landmarks,
          status: 'Starting exercise…', statusKind: 'ok',
          drawGuideBox: false, boneColor: COLOR_GREEN,
          stanceData: checks,
          sideVis: checks.vis,
          stancePassedChecks: { standing_straight: true },
          activeFeedback: 'Get ready…',
        });
      }

      if (coords) {
        lockSideTempoGateAtStance(sq, coords.vis, h);
      }
      this._lastSeenRep = 0;
      this._advancePhase(SIDE_PHASE.EXERCISE_ACTIVE);
    }

    if (this._phase === SIDE_PHASE.EXERCISE_ACTIVE) {
      if (!coords) {
        return _baseResult(SIDE_PHASE.EXERCISE_ACTIVE, {
          poseDetected: true, landmarks,
          status: 'Waiting for profile…', statusKind: 'info',
          squatTracker: sq, repCount: sq.count,
        });
      }

      const {
        hipX, hipY, kneeX, kneeY, footY, sw, leftGap, rightGap,
      } = coords;

      const prevCount = sq.count;
      const wasInSquat = this._wasInSquat;
      const formChecks = runSideFormChecks(landmarks, sq._inSquat);

      sq.update(hipY, kneeY, footY, sw, leftGap, rightGap);
      sq.observeRepFormCues(formChecks.allCues);
      sq.trackTempo(hipY * h, hipX * w);

      const kneeMon = this._kneeMon;
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

      if (sq.count > prevCount) {
        const n = sq.count;
        this._repCount = n;
        this._lastSeenRep = n;

        const lastRep = sq.repMetrics[sq.repMetrics.length - 1];
        if (lastRep && !lastRep.full_depth) {
          this._speakQueued(VOICE_MSG.too_early, { key: 'side_too_early' });
          this._activeFeedback = VOICE_MSG.too_early;
        }

        const target = this._targetReps;
        if (target > 0 && n >= target) {
          if (!this._doneVoiceSent) {
            this._doneVoiceSent = true;
            this._speakQueued(VOICE_MSG.done, { key: 'side_done' });
          }
          this._advancePhase(SIDE_PHASE.DONE);
          return _baseResult(SIDE_PHASE.DONE, {
            poseDetected: true, landmarks,
            status: 'Exercise complete!', statusKind: 'ok',
            drawGuideBox: false, boneColor: COLOR_GREEN,
            squatTracker: sq, runAnalysis: false,
            activeFeedback: 'Well done!', repCount: n,
            hipX, hipY, kneeX, kneeY, shoulderW: sw,
            stanceData: checks,
            sideVis: coords.vis,
            stancePassedChecks: { standing_straight: true },
          });
        }

        const speedKey = getRepSpeedWarningKey(sq);
        const kneeMsg = kneeMon.consumeEndOfRepFeedback();
        const torsoMsg = torsoMon.consumeEndOfRepFeedback();
        const warning = selectRepPostureWarning({ speedKey, kneeMsg, torsoMsg });
        if (warning) {
          this._speakQueued(warning.text, { key: 'side_' + warning.key });
          this._activeFeedback = warning.text;
        }

        const nextRep = n + 1;
        this._speakQueued(`Do rep ${nextRep}.`, { key: `side_do_rep_${nextRep}` });
      }

      let feedbackText = '';
      let feedbackKey = '';

      if (!sq.isCalibrated && !sq._inSquat) {
        feedbackText = `Stand tall to calibrate (${sq.calibrationPct}%)`;
        feedbackKey = 'calibrate';
        this._activeFeedback = feedbackText;
        this._speak(VOICE_MSG.calibrate, { key: 'side_calibrate', cooldownMs: VOICE_CD_MS });
      } else if (sq.tooDeep) {
        feedbackText = VOICE_MSG.too_deep;
        feedbackKey = 'too_deep';
      } else {
        const sw2 = sq.activeSpeedWarning;
        if (sw2) {
          if (sw2.includes('fast')) {
            feedbackText = VOICE_MSG.too_fast;
            feedbackKey = 'too_fast';
          } else if (sw2.includes('slow')) {
            feedbackText = VOICE_MSG.too_slow;
            feedbackKey = 'too_slow';
          }
        }
      }

      if (feedbackText) {
        this._activeFeedback = feedbackText;
        if (feedbackKey === 'too_deep') {
          this._speak(feedbackText, { key: 'side_' + feedbackKey, cooldownMs: VOICE_CD_MS });
        }
      }

      let boneColor = COLOR_GREEN;
      if (sq.tooDeep) boneColor = COLOR_RED;
      else if (sq._inSquat && formChecks.allCues.length > 0) boneColor = COLOR_AMBER;

      return _baseResult(SIDE_PHASE.EXERCISE_ACTIVE, {
        poseDetected: true, landmarks,
        status: feedbackText || (sq._inSquat ? 'Squatting…' : (sq.isCalibrated ? 'Standing' : `Calibrating (${sq.calibrationPct}%)`)),
        statusKind: feedbackText ? 'warn' : 'ok',
        drawGuideBox: false, boneColor,
        stanceData: checks,
        sideVis: coords.vis,
        squatTracker: sq, runAnalysis: true,
        activeFeedback: this._activeFeedback,
        repCount: sq.count,
        hipX, hipY, kneeX, kneeY, shoulderW: sw,
        stancePassedChecks: { standing_straight: true },
        currentStanceCheck: null,
      });
    }

    return _baseResult(SIDE_PHASE.DONE, {
      poseDetected: true, landmarks,
      status: 'Exercise complete!', statusKind: 'ok',
      drawGuideBox: false, boneColor: COLOR_GREEN,
      squatTracker: sq, runAnalysis: false,
      activeFeedback: 'Well done!',
      repCount: sq.count,
      stanceData: checks,
      sideVis: coords?.vis,
      stancePassedChecks: { standing_straight: true },
    });
  }

  reset() {
    this._voice.cancel();
    this._voice.resetCooldowns();
    this._sq = new SquatRepTracker();
    this._kneeMon = new KneeAngleRepMonitor();
    this._torsoMon = new TorsoBendSideRepMonitor();
    this._wasInSquat = false;
    this._phase = SIDE_PHASE.WAITING_FOR_PERSON;
    this._boundaryStableStart = -1;
    this._stancePassHoldStart = -1;
    this._readyStart = -1;
    this._fullBodyVoiceSent = false;
    this._stanceOkVoiceSent = false;
    this._doRepOneVoiceSent = false;
    this._doneVoiceSent = false;
    this._lastSeenRep = 0;
    this._repCount = 0;
    this._activeFeedback = '';
    CFG.squat_max_reps = this._targetReps;
  }
}
