// Dumbbell front raise (front view) — delegates to FrontRaiseFlow.
//
// Like the lateral raise, this tracker owns its sets (REST_BETWEEN_SETS is
// part of the flow), so the tracker exposes two extra methods for the app:
//   finish()          → stop now and return the cumulative session summary
//   continueNextSet() → skip the rest countdown and start the next set

import { formatTrackingResult } from '../../core/trackingSettings';
import { FrontRaiseFlow, FR_PHASE, FR_ACTIVITY } from './FrontRaiseFlow';
import { FR_FEEDBACK } from './config';
import { drawFrontRaiseOverlay } from './draw';

function toTrackerState(flow, fr) {
  const summary = fr.phase === FR_PHASE.COMPLETE ? flow.finish() : flow.summary();
  const level = fr.statusKind === 'fail' || fr.statusKind === 'warn' ? 'warn' : 'ok';
  const setupPhase = fr.phase === FR_PHASE.SETUP_STANCE;
  const cues = [{ level, text: fr.feedback || fr.status || 'Tracking…' }];
  if (fr.phase === FR_PHASE.ACTIVE && fr.activity !== FR_ACTIVITY.EXERCISING) {
    cues.push({ level: 'info', text: 'Not doing exercise' });
  }
  return {
    exerciseId: 'frontraise',
    managesSets: true,
    repCount: fr.repCount,
    setRepCount: fr.setRepCount,
    currentSet: fr.currentSet,
    targetSets: fr.targetSets,
    targetReps: fr.targetReps,
    setsCompleted: fr.setsCompleted,
    phase: fr.phase === FR_PHASE.ACTIVE
      ? (fr.armStates.left === 'UP' || fr.armStates.right === 'UP' ? 'up' : 'down')
      : fr.phase,
    flowPhase: fr.phase,
    progress: fr.liftProgress ?? 0,
    formScore: summary.formScore ?? 100,
    frSummary: summary,
    activity: fr.activity,
    activityReason: fr.activityReason,
    timerPaused: !!fr.timerPaused,
    activeSec: summary.activeSec,
    sessionSec: summary.sessionSec,
    restRemainingSec: fr.restRemainingSec,
    ready: fr.phase !== FR_PHASE.SETUP_STANCE,
    posture: fr.sustainedCues?.length ? 'incorrect' : 'correct',
    cues,
    feedback: fr.feedback || null,
    skeletonColor: fr.boneColor,
    postureResult: { cueKeys: fr.sustainedCues || [] },
    stanceData: setupPhase && fr.stanceResult ? { allCues: fr.stanceResult.cueKeys || [] } : null,
    lastRep: fr.lastAttempt,
  };
}

function createFrontRaiseTracker(options = {}) {
  const flow = new FrontRaiseFlow(options);
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
          durationSec: done.durationSec,
          errorKey: done.primaryIssue,
          error: done.primaryIssue ? FR_FEEDBACK[done.primaryIssue] || null : null,
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
      drawFrontRaiseOverlay(ctx, lastFr, frame);
    },
  };
}

export default {
  id: 'frontraise',
  name: 'Dumbbell Front Raise',
  family: 'frontraise',
  facing: 'front',
  aliases: [
    'front raise', 'front raises',
    'dumbbell front raise', 'dumbbell front raises',
    'standing front raise', 'standing dumbbell front raise',
    'front delt raise',
    'db front raise',
  ],
  create: createFrontRaiseTracker,
};
