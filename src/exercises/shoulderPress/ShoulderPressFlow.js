// Standing dumbbell shoulder press (front view) — coaching state machine.
//
// Phases:
//   WAITING_FOR_PERSON — waiting for a front-facing, full-body person
//   FEET_CHECK         — feet under shoulders (width only; no centering)
//   SHOULDER_CHECK     — clear side bend / shoulder drop (light bend allowed)
//   GET_READY          — wait for the dumbbells to be held at shoulder height
//   READY_TO_START     — short settle, then queue "Do rep one" (squat/pushup pattern)
//   EXERCISE_ACTIVE    — rep counting + live cues; "Do rep N" after each completed rep
//   DONE               — target reps reached (when a target is given)
//
// Feet and shoulders pass once and lock. Live cues never use immediate TTS so
// they cannot cancel a queued "Do rep N". "Too deep" only after arms reached top.

import { VoiceManager } from '../../core/voiceManager.js';
import { nowSec } from '../../core/landmarks.js';
import {
  SP_CFG, SP_VOICE_MSG, SP_FEEDBACK, SP_LIVE_PRIORITY,
  SP_COLOR_GREEN, SP_COLOR_AMBER, SP_COLOR_RED,
} from './config.js';
import {
  buildGeometry, evaluateFeet, evaluateShoulderSetup, evaluatePressPosture,
  earShoulderGaps, armZone, isRacked,
} from './poseChecks.js';
import { ShoulderPressRepTracker } from './ShoulderPressRepTracker.js';

export const SP_PHASE = {
  WAITING_FOR_PERSON: 'sp_waiting_for_person',
  FEET_CHECK: 'sp_feet_check',
  SHOULDER_CHECK: 'sp_shoulder_check',
  GET_READY: 'sp_get_ready',
  READY_TO_START: 'sp_ready_to_start',
  EXERCISE_ACTIVE: 'sp_exercise_active',
  DONE: 'sp_done',
  // Alias kept so older UI that still keys on STANCE_CHECK keeps working.
  STANCE_CHECK: 'sp_feet_check',
};

const VOICE_CD_MS = 10_000;
const LIVE_CUE_GAP_SEC = 2.5;
const SETUP_PASS_HOLD_SEC = 1.2;
const SETUP_ANNOUNCE_SEC = 2.5;
const SETUP_ANNOUNCE_MAX_SEC = 7.0;
const INSTRUCTION_CONFIRM_SEC = 0.4;
const INSTRUCTION_MIN_WAIT_SEC = 2.5;
const RACK_HOLD_SEC = 0.6;
const READY_DELAY_SEC = 2.0; // squat/pushup-style settle before "Do rep one"
const PERSON_LOST_SEC = 0.6;
const BASELINE_MAX_SAMPLES = 30;
const DO_REP_ONE_MSG = 'Do rep one.';

const FEET_PRIORITY = ['sp_stance_narrow', 'sp_stance_wide'];
const SHOULDER_PRIORITY = [
  'sp_torso_lean_left', 'sp_torso_lean_right',
  'sp_shoulder_high_left', 'sp_shoulder_high_right',
];

function firstByPriority(keys, priority) {
  const set = new Set(keys);
  for (const k of priority) if (set.has(k)) return k;
  return keys[0] || null;
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function _baseResult(phase, overrides = {}) {
  return {
    phase,
    poseDetected: false,
    status: '',
    statusKind: 'info',
    boneColor: SP_COLOR_GREEN,
    activeFeedback: '',
    repCount: 0,
    elbowAngle: 0,
    pressState: 'WAITING',
    geometry: null,
    stanceResult: null,
    shoulderResult: null,
    postureResult: null,
    sustainedCues: [],
    lastRep: null,
    repCompleted: null,
    ...overrides,
  };
}

export class ShoulderPressFlow {
  constructor({ targetReps = 0, voice = true } = {}) {
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps > 0 ? targetReps : 0;
    this._rep = new ShoulderPressRepTracker();
    this._resetState();
  }

  _resetState() {
    this._phase = SP_PHASE.WAITING_FOR_PERSON;
    this._lostSince = -1;
    this._setupEnteredAt = -1;
    this._setupPassSince = -1;
    this._feetBeginSent = false;
    this._shoulderBeginSent = false;
    this._feetLocked = false;
    this._shouldersLocked = false;
    this._rackSince = -1;
    this._readyStart = -1;
    this._doRepOneVoiceSent = false;
    this._baselineSamples = { left: [], right: [] };
    this._baseline = null;
    this._cueOnset = new Map();
    this._lastLiveCueAt = -1;
    this._lastInstructionKey = '';
    this._lastInstructionAt = -1;
    this._pendingInstructionKey = '';
    this._pendingInstructionSince = -1;
    this._activeFeedback = '';
    this._doneVoiceSent = false;
    this._halfwayVoiceSent = false;
    this._lastSeenRep = 0;
  }

  // ── Voice helpers ────────────────────────────────────────────────────────
  _speak(text, opts) {
    if (!this._voiceEnabled) return false;
    return this._voice.speak(text, opts);
  }

  _speakQueued(text, opts) {
    if (!this._voiceEnabled) return false;
    return this._voice.speakQueued(text, opts);
  }

  _voiceBusy() {
    return this._voiceEnabled && this._voice.isBusy();
  }

  /** Debounce, say once per key, then give time to correct. */
  _maybeIssueInstruction(key, text, now) {
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
    this._speak(text, { key: `sp_instr_${key}`, cooldownMs: VOICE_CD_MS });
  }

  _sustained(keys, now) {
    const active = new Set(keys.filter(Boolean));
    for (const k of active) if (!this._cueOnset.has(k)) this._cueOnset.set(k, now);
    for (const k of [...this._cueOnset.keys()]) if (!active.has(k)) this._cueOnset.delete(k);
    return [...active].filter((k) => now - this._cueOnset.get(k) >= SP_CFG.cue_sustain_sec);
  }

  /**
   * Live correction — same as squat/pushup: cooldown + gap, NEVER immediate,
   * so a queued "Do rep N" is not cancelled mid-flight.
   */
  _speakLiveCue(key, now) {
    const msg = SP_VOICE_MSG[key];
    if (!msg) return;
    if (this._lastLiveCueAt >= 0 && now - this._lastLiveCueAt < LIVE_CUE_GAP_SEC) return;
    if (this._speak(msg, { key: `sp_live_${key}`, cooldownMs: VOICE_CD_MS })) {
      this._lastLiveCueAt = now;
    }
  }

  _setupReady(now) {
    const inStep = now - this._setupEnteredAt;
    const held = this._setupPassSince >= 0 && now - this._setupPassSince >= SETUP_PASS_HOLD_SEC;
    const announced = inStep >= SETUP_ANNOUNCE_SEC
      && (!this._voiceBusy() || inStep >= SETUP_ANNOUNCE_MAX_SEC);
    return held && announced;
  }

  _enterSetupStep(phase, now) {
    this._phase = phase;
    this._setupEnteredAt = now;
    this._setupPassSince = -1;
    this._lastInstructionKey = '';
    this._pendingInstructionKey = '';
    this._pendingInstructionSince = -1;
  }

  setTargetReps(n) {
    this._targetReps = n > 0 ? n : 0;
  }

  // ── Public state for the engine / UI ─────────────────────────────────────
  toTrackerState(fr) {
    const level = fr.statusKind === 'fail' || fr.statusKind === 'warn' ? 'warn' : 'ok';
    const summary = this._rep.summary();
    const active = fr.phase === SP_PHASE.EXERCISE_ACTIVE;
    const setupPhase = fr.phase === SP_PHASE.FEET_CHECK || fr.phase === SP_PHASE.SHOULDER_CHECK;
    return {
      exerciseId: 'shoulderpress',
      repCount: fr.repCount ?? this._rep.count,
      phase: active ? (fr.pressState === 'TOP' ? 'up' : 'down') : fr.phase,
      progress: fr.geometry ? this._rep.progress(fr.geometry) : 0,
      formScore: summary.formScore,
      formSummary: summary,
      ready: [SP_PHASE.EXERCISE_ACTIVE, SP_PHASE.DONE, SP_PHASE.READY_TO_START].includes(fr.phase),
      posture: fr.sustainedCues?.length ? 'incorrect' : 'correct',
      cues: [{ level, text: fr.activeFeedback || fr.status || 'Tracking…' }],
      feedback: fr.activeFeedback || null,
      skeletonColor: fr.boneColor,
      elbowAngle: fr.elbowAngle,
      flowPhase: fr.phase,
      pressState: fr.pressState,
      postureResult: { cueKeys: fr.sustainedCues || [] },
      stanceData: setupPhase && (fr.stanceResult || fr.shoulderResult)
        ? { allCues: (fr.stanceResult?.cueKeys || fr.shoulderResult?.cueKeys || []) }
        : null,
      lastRep: fr.lastRep,
    };
  }

  // ── Frame tick ───────────────────────────────────────────────────────────
  tick(landmarks, w, h) {
    const now = nowSec();
    const g = landmarks ? buildGeometry(landmarks, w, h) : null;
    const rep = this._rep;
    const common = { repCount: rep.count, pressState: rep.state, lastRep: rep.lastRep };

    if (g) this._lostSince = -1;
    else if (this._lostSince < 0) this._lostSince = now;
    const lostLong = !g && this._lostSince >= 0 && now - this._lostSince >= PERSON_LOST_SEC;

    switch (this._phase) {
      case SP_PHASE.WAITING_FOR_PERSON:
        return this._tickWaiting(g, now, common);
      case SP_PHASE.FEET_CHECK:
        return this._tickFeet(g, now, lostLong, common);
      case SP_PHASE.SHOULDER_CHECK:
        return this._tickShoulders(g, now, lostLong, common);
      case SP_PHASE.GET_READY:
        return this._tickGetReady(g, now, lostLong, common);
      case SP_PHASE.READY_TO_START:
        return this._tickReadyToStart(g, now, lostLong, common);
      case SP_PHASE.EXERCISE_ACTIVE:
        return this._tickActive(g, now, lostLong, common);
      default:
        return _baseResult(SP_PHASE.DONE, {
          ...common,
          poseDetected: !!g, geometry: g,
          status: 'Exercise complete!', statusKind: 'ok',
          activeFeedback: 'Well done!',
        });
    }
  }

  _tickWaiting(g, now, common) {
    if (!g) {
      this._speak(SP_VOICE_MSG.no_person, { key: 'sp_no_person', cooldownMs: VOICE_CD_MS });
      return _baseResult(SP_PHASE.WAITING_FOR_PERSON, {
        ...common, status: 'No person detected', statusKind: 'fail',
      });
    }
    if (!g.facingFront) {
      this._speak('Please face the camera directly.', { key: 'sp_face_camera', cooldownMs: VOICE_CD_MS });
      return _baseResult(SP_PHASE.WAITING_FOR_PERSON, {
        ...common, poseDetected: true, geometry: g,
        status: 'Face the camera', statusKind: 'warn',
      });
    }
    if (!g.feetOk) {
      this._speak(SP_VOICE_MSG.feet_not_visible, { key: 'sp_feet_not_visible', cooldownMs: VOICE_CD_MS });
      return _baseResult(SP_PHASE.WAITING_FOR_PERSON, {
        ...common, poseDetected: true, geometry: g,
        status: 'Step back — feet not visible', statusKind: 'warn',
      });
    }

    this._enterSetupStep(SP_PHASE.FEET_CHECK, now);
    if (!this._feetBeginSent) {
      this._feetBeginSent = true;
      this._speak(SP_VOICE_MSG.feet_begin, { key: 'sp_feet_begin', cooldownMs: 0, immediate: true });
    }
    return _baseResult(SP_PHASE.FEET_CHECK, {
      ...common, poseDetected: true, geometry: g,
      status: 'Checking your feet…', statusKind: 'ok',
    });
  }

  _tickFeet(g, now, lostLong, common) {
    if (!g) {
      if (lostLong) this._phase = SP_PHASE.WAITING_FOR_PERSON;
      this._setupPassSince = -1;
      return _baseResult(SP_PHASE.FEET_CHECK, {
        ...common, status: 'Stay in front of the camera', statusKind: 'warn',
      });
    }
    if (!g.feetOk) {
      this._setupPassSince = -1;
      this._maybeIssueInstruction('feet_not_visible', SP_VOICE_MSG.feet_not_visible, now);
      return _baseResult(SP_PHASE.FEET_CHECK, {
        ...common, poseDetected: true, geometry: g,
        status: 'Step back — feet not visible', statusKind: 'warn',
      });
    }

    const feet = evaluateFeet(g);
    if (!feet.ok) {
      this._setupPassSince = -1;
      const key = firstByPriority(feet.cueKeys, FEET_PRIORITY);
      this._maybeIssueInstruction(key, SP_VOICE_MSG[key], now);
      return _baseResult(SP_PHASE.FEET_CHECK, {
        ...common, poseDetected: true, geometry: g, stanceResult: feet,
        boneColor: SP_COLOR_AMBER,
        status: SP_FEEDBACK[key] || 'Adjust your feet', statusKind: 'warn',
        activeFeedback: SP_FEEDBACK[key] || '',
      });
    }

    this._maybeIssueInstruction(null, '', now);
    if (this._setupPassSince < 0) this._setupPassSince = now;

    if (this._setupReady(now)) {
      this._feetLocked = true;
      this._enterSetupStep(SP_PHASE.SHOULDER_CHECK, now);
      this._speakQueued(SP_VOICE_MSG.feet_ok, { key: 'sp_feet_ok' });
      if (!this._shoulderBeginSent) {
        this._shoulderBeginSent = true;
        this._speakQueued(SP_VOICE_MSG.shoulder_begin, { key: 'sp_shoulder_begin' });
      }
      return _baseResult(SP_PHASE.SHOULDER_CHECK, {
        ...common, poseDetected: true, geometry: g, stanceResult: feet,
        status: 'Feet locked. Checking shoulders…', statusKind: 'ok',
      });
    }

    return _baseResult(SP_PHASE.FEET_CHECK, {
      ...common, poseDetected: true, geometry: g, stanceResult: feet,
      status: 'Feet look good — hold still…', statusKind: 'ok',
    });
  }

  _tickShoulders(g, now, lostLong, common) {
    if (!g) {
      if (lostLong) this._phase = SP_PHASE.WAITING_FOR_PERSON;
      this._setupPassSince = -1;
      return _baseResult(SP_PHASE.SHOULDER_CHECK, {
        ...common, status: 'Stay in front of the camera', statusKind: 'warn',
      });
    }

    const sh = evaluateShoulderSetup(g);
    const gaps = earShoulderGaps(g);

    if (!sh.ok) {
      this._setupPassSince = -1;
      const key = firstByPriority(sh.cueKeys, SHOULDER_PRIORITY);
      this._maybeIssueInstruction(key, SP_VOICE_MSG[key], now);
      return _baseResult(SP_PHASE.SHOULDER_CHECK, {
        ...common, poseDetected: true, geometry: g, shoulderResult: sh,
        boneColor: SP_COLOR_AMBER,
        status: SP_FEEDBACK[key] || 'Stand taller', statusKind: 'warn',
        activeFeedback: SP_FEEDBACK[key] || '',
      });
    }

    this._maybeIssueInstruction(null, '', now);
    if (gaps) {
      const s = this._baselineSamples;
      s.left.push(gaps.left);
      s.right.push(gaps.right);
      if (s.left.length > BASELINE_MAX_SAMPLES) { s.left.shift(); s.right.shift(); }
    }
    if (this._setupPassSince < 0) this._setupPassSince = now;

    if (this._setupReady(now)) {
      const s = this._baselineSamples;
      this._baseline = s.left.length >= 5
        ? { left: median(s.left), right: median(s.right) }
        : null;
      this._shouldersLocked = true;
      this._phase = SP_PHASE.GET_READY;
      this._rackSince = -1;
      this._speakQueued(SP_VOICE_MSG.shoulder_ok, { key: 'sp_shoulder_ok' });
      this._speakQueued(SP_VOICE_MSG.get_in_position, { key: 'sp_get_in_position' });
      return _baseResult(SP_PHASE.GET_READY, {
        ...common, poseDetected: true, geometry: g, shoulderResult: sh,
        status: 'Shoulders locked. Dumbbells to shoulder height', statusKind: 'ok',
      });
    }

    return _baseResult(SP_PHASE.SHOULDER_CHECK, {
      ...common, poseDetected: true, geometry: g, shoulderResult: sh,
      status: 'Shoulders look good — hold still…', statusKind: 'ok',
    });
  }

  _tickGetReady(g, now, lostLong, common) {
    if (!g) {
      if (lostLong) this._rackSince = -1;
      return _baseResult(SP_PHASE.GET_READY, {
        ...common, status: 'Stay in front of the camera', statusKind: 'warn',
      });
    }

    const racked = isRacked(g) && g.angle <= SP_CFG.bottom_angle_relaxed_max;
    if (!racked) {
      this._rackSince = -1;
      if (!this._voiceBusy()) {
        this._speak(SP_VOICE_MSG.get_in_position, { key: 'sp_get_in_position_repeat', cooldownMs: 8000 });
      }
      return _baseResult(SP_PHASE.GET_READY, {
        ...common, poseDetected: true, geometry: g,
        status: 'Bring the dumbbells to shoulder height', statusKind: 'ok',
        activeFeedback: 'Get ready…',
      });
    }

    if (this._rackSince < 0) this._rackSince = now;
    if (now - this._rackSince >= RACK_HOLD_SEC) {
      this._rep.reset();
      this._cueOnset.clear();
      this._lastSeenRep = 0;
      this._doRepOneVoiceSent = false;
      this._readyStart = now;
      this._phase = SP_PHASE.READY_TO_START;
      this._speakQueued(SP_VOICE_MSG.ready || 'Get ready to press.', { key: 'sp_ready' });
      return _baseResult(SP_PHASE.READY_TO_START, {
        ...common, repCount: 0, poseDetected: true, geometry: g,
        status: 'Starting…', statusKind: 'ok',
      });
    }
    return _baseResult(SP_PHASE.GET_READY, {
      ...common, poseDetected: true, geometry: g,
      status: 'Hold at shoulder height…', statusKind: 'ok',
    });
  }

  /** Squat / push-up pattern: settle, queue "Do rep one", then start counting. */
  _tickReadyToStart(g, now, lostLong, common) {
    if (!g) {
      if (lostLong) {
        this._phase = SP_PHASE.GET_READY;
        this._rackSince = -1;
        this._readyStart = -1;
      }
      return _baseResult(SP_PHASE.READY_TO_START, {
        ...common, status: 'Stay in front of the camera', statusKind: 'warn',
      });
    }

    const elapsed = now - this._readyStart;

    if (!this._doRepOneVoiceSent && elapsed >= READY_DELAY_SEC) {
      this._doRepOneVoiceSent = true;
      this._speakQueued(SP_VOICE_MSG.do_rep_one || DO_REP_ONE_MSG, { key: 'sp_do_rep_one' });
      this._phase = SP_PHASE.EXERCISE_ACTIVE;
      return _baseResult(SP_PHASE.EXERCISE_ACTIVE, {
        ...common, repCount: 0, poseDetected: true, geometry: g,
        status: 'Press up — do rep one', statusKind: 'ok',
      });
    }

    return _baseResult(SP_PHASE.READY_TO_START, {
      ...common, poseDetected: true, geometry: g,
      status: 'Starting exercise…', statusKind: 'ok',
      activeFeedback: 'Get ready…',
    });
  }

  _tickActive(g, now, lostLong, common) {
    const rep = this._rep;
    if (!g) {
      if (lostLong) {
        this._speak(SP_VOICE_MSG.no_person, { key: 'sp_no_person', cooldownMs: VOICE_CD_MS });
      }
      return _baseResult(SP_PHASE.EXERCISE_ACTIVE, {
        ...common, status: 'Hold position…', statusKind: 'info',
        elbowAngle: rep.smoothAngle,
      });
    }
    if (!g.facingFront) {
      this._speak('Please face the camera directly.', { key: 'sp_face_camera', cooldownMs: VOICE_CD_MS });
      return _baseResult(SP_PHASE.EXERCISE_ACTIVE, {
        ...common, poseDetected: true, geometry: g,
        status: 'Face the camera', statusKind: 'warn', elbowAngle: rep.smoothAngle,
      });
    }
    if (g.handsClipped) {
      this._speak(SP_VOICE_MSG.hands_out_of_frame, { key: 'sp_hands_clipped', cooldownMs: 15_000 });
    }

    const zone = armZone(g);
    const inPress = rep.state !== 'WAITING';
    const posture = inPress ? evaluatePressPosture(g, { baseline: this._baseline, zone }) : null;
    const prevCount = rep.count;
    const res = rep.update(g, now, posture?.cueKeys || []);
    const liveKeys = [...(posture?.cueKeys || []), res.liveDepthCue].filter(Boolean);
    const sustained = inPress ? this._sustained(liveKeys, now) : this._sustained([], now);

    let feedbackText = '';

    // Rep-level events (aborted press / shallow dip) — queued, never immediate.
    if (res.event) {
      feedbackText = SP_FEEDBACK[res.event] || '';
      this._speakQueued(SP_VOICE_MSG[res.event], { key: `sp_evt_${res.event}`, cooldownMs: 6000 });
      this._lastLiveCueAt = now;
    }

    // Live correction — one message, highest priority; does not cancel "Do rep N".
    const primary = firstByPriority(sustained, SP_LIVE_PRIORITY);
    if (primary && !res.event) {
      feedbackText = SP_FEEDBACK[primary] || feedbackText;
      this._speakLiveCue(primary, now);
    }

    // ── Rep completed — same pattern as squat / push-up ────────────────────
    if (rep.count > prevCount || res.rep) {
      const result = res.rep || rep.lastRep;
      const done = this._onRepComplete(result, now);
      if (done) {
        return _baseResult(SP_PHASE.DONE, {
          ...common, repCount: rep.count, pressState: rep.state, lastRep: rep.lastRep,
          poseDetected: true, geometry: g, elbowAngle: rep.smoothAngle,
          status: 'Exercise complete!', statusKind: 'ok', activeFeedback: 'Well done!',
          repCompleted: result,
        });
      }
    }

    if (feedbackText) this._activeFeedback = feedbackText;
    else if (!sustained.length) this._activeFeedback = '';

    let boneColor = SP_COLOR_GREEN;
    if (sustained.length) boneColor = SP_COLOR_RED;
    else if (posture?.skeletonColorKey === 'red' || posture?.skeletonColorKey === 'yellow') boneColor = SP_COLOR_AMBER;

    let status;
    if (!inPress) status = 'Bring the dumbbells to shoulder height';
    else if (rep.state === 'TOP') status = 'Lower with control…';
    else status = 'Press up…';

    return _baseResult(SP_PHASE.EXERCISE_ACTIVE, {
      ...common,
      repCount: rep.count,
      pressState: rep.state,
      lastRep: rep.lastRep,
      poseDetected: true,
      geometry: g,
      boneColor,
      elbowAngle: rep.smoothAngle,
      postureResult: posture,
      sustainedCues: sustained,
      status: this._activeFeedback || status,
      statusKind: sustained.length || res.event ? 'warn' : 'ok',
      activeFeedback: this._activeFeedback,
      repCompleted: res.rep,
    });
  }

  /**
   * After every completed rep: queue optional fault, then "Do rep N" (squat/pushup).
   * @returns {boolean} true when the target rep count has been reached.
   */
  _onRepComplete(result, now) {
    if (!result) return false;
    const n = result.index;
    // Guard against double-fire in the same frame.
    if (n <= this._lastSeenRep) return false;
    this._lastSeenRep = n;

    const target = this._targetReps;

    // Rep-level faults known only at finalize — queue so they play before "Do rep N".
    const repLevel = ['sp_press_higher', 'sp_not_low_enough', 'sp_rep_fast', 'sp_too_deep'];
    const err = result.primaryError;
    if (err && repLevel.includes(err) && SP_VOICE_MSG[err]) {
      this._speakQueued(SP_VOICE_MSG[err], { key: `sp_rep_${err}_${n}`, cooldownMs: VOICE_CD_MS });
      this._activeFeedback = SP_FEEDBACK[err] || this._activeFeedback;
      this._lastLiveCueAt = now;
    }

    if (target > 0 && n >= target) {
      this._phase = SP_PHASE.DONE;
      if (!this._doneVoiceSent) {
        this._doneVoiceSent = true;
        const s = this._rep.summary();
        this._speakQueued(
          `${SP_VOICE_MSG.done} Your form accuracy is ${s.formScore} percent.`,
          { key: 'sp_done' },
        );
      }
      return true;
    }

    if (target > 0 && !this._halfwayVoiceSent && n >= Math.ceil(target / 2)) {
      this._halfwayVoiceSent = true;
      this._speakQueued(SP_VOICE_MSG.halfway, { key: 'sp_halfway' });
    }

    // Prompt next rep — identical wording to squat / push-up.
    const nextRep = n + 1;
    this._speakQueued(`Do rep ${nextRep}.`, { key: `sp_do_rep_${nextRep}` });
    return false;
  }

  reset() {
    this._voice.cancel();
    this._voice.resetCooldowns();
    this._rep = new ShoulderPressRepTracker();
    this._resetState();
  }
}
