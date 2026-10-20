// Single-arm dumbbell row (side / three-quarter view) — delegates to
// SingleArmDumbbellRowFlow.
//
// Like the lateral raise, this tracker owns its sets (REST_BETWEEN_SETS is
// part of the flow), so it exposes two extra methods for the app:
//   finish()          → stop now and return the cumulative session summary
//   continueNextSet() → skip the rest countdown and start the next set

import { exerciseDef } from '../../catalog.js';
import { formatTrackingResult } from '../../core/trackingSettings';
import { SingleArmDumbbellRowFlow, SR_PHASE, SR_ACTIVITY } from './SingleArmDumbbellRowFlow';
import { SR_ARM_STATE } from './SingleArmDumbbellRowRepTracker';
import { SR_FEEDBACK } from './config';
import { drawSingleArmDumbbellRowOverlay } from './draw';

const UP_STATES = new Set([SR_ARM_STATE.PULLING, SR_ARM_STATE.TOP]);

function toTrackerState(flow, fr) {
  const summary = fr.phase === SR_PHASE.COMPLETE ? flow.finish() : flow.summary();
  const level = fr.statusKind === 'fail' || fr.statusKind === 'warn' ? 'warn' : 'ok';
  const setupPhase = fr.phase === SR_PHASE.SETUP_STANCE;
  const cues = [{ level, text: fr.feedback || fr.status || 'Tracking…' }];
  if (fr.phase === SR_PHASE.ACTIVE && fr.activity !== SR_ACTIVITY.EXERCISING) {
    cues.push({ level: 'info', text: 'Not doing exercise' });
  }
  return {
    exerciseId: 'singleArmDumbbellRow',
    managesSets: true,
    repCount: fr.repCount,
    setRepCount: fr.setRepCount,
    currentSet: fr.currentSet,
    targetSets: fr.targetSets,
    targetReps: fr.targetReps,
    setsCompleted: fr.setsCompleted,
    phase: fr.phase === SR_PHASE.ACTIVE ? (UP_STATES.has(fr.armState) ? 'up' : 'down') : fr.phase,
    flowPhase: fr.phase,
    repPhase: fr.armState,
    progress: fr.lowConfidence ? 0 : fr.progress ?? 0,
    formScore: summary.formScore ?? 100,
    srSummary: summary,
    workingSide: fr.side,
    confidence: fr.confidence,
    lowConfidence: !!fr.lowConfidence,
    activity: fr.activity,
    activityReason: fr.activityReason,
    timerPaused: !!fr.timerPaused,
    activeSec: summary.activeSec,
    sessionSec: summary.sessionSec,
    restRemainingSec: fr.restRemainingSec,
    ready: fr.phase !== SR_PHASE.SETUP_STANCE,
    posture: fr.sustainedCues?.length ? 'incorrect' : 'correct',
    cues,
    feedback: fr.feedback || null,
    skeletonColor: fr.boneColor,
    postureResult: { cueKeys: fr.sustainedCues || [] },
    stanceData: setupPhase && fr.stanceResult ? { allCues: fr.stanceResult.cueKeys || [] } : null,
    lastRep: fr.lastAttempt,
  };
}

function createSingleArmDumbbellRowTracker(options = {}) {
  const flow = new SingleArmDumbbellRowFlow(options);
  let lastRep = 0;
  let lastFr = null;

  return {
    reset() {
      flow.reset();
      lastRep = 0;
      lastFr = null;
    },

    setTargetReps(n) {
      flow.setTargetReps(n);
    },

    finish() {
      return flow.finish();
    },

    continueNextSet() {
      return flow.continueNextSet();
    },

    summary() {
      return flow.summary();
    },

    update(landmarks, frame) {
      lastFr = flow.tick(landmarks, frame.width, frame.height);
      const state = toTrackerState(flow, lastFr);

      const done = lastFr.repCompleted;
      if (done && state.repCount > lastRep) {
        lastRep = state.repCount;
        state.repEvent = {
          index: done.index,
          set: done.set,
          repInSet: done.repInSet,
          side: done.side,
          durationSec: done.durationSec,
          errorKey: done.primaryIssue,
          error: done.primaryIssue ? SR_FEEDBACK[done.primaryIssue] || null : null,
          errors: done.issues,
          good: done.clean,
          metric: done.score,
          score: done.score,
          romPct: done.romPct,
        };
      }
      if (lastFr.attemptCompleted) state.attemptEvent = lastFr.attemptCompleted;

      state.tracking = formatTrackingResult(state);
      return state;
    },

    draw(ctx, landmarks, frame) {
      drawSingleArmDumbbellRowOverlay(ctx, lastFr, frame);
    },
  };
}

export default {
  ...exerciseDef('singleArmDumbbellRow'),
  create: createSingleArmDumbbellRowTracker,
};
