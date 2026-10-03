// Dumbbell curl (front view) — delegates to DumbbellCurlFlow.
//
// Like the lateral raise, this tracker owns its sets (REST_BETWEEN_SETS is
// part of the flow), so it exposes two extra methods for the app:
//   finish()          → stop now and return the cumulative session summary
//   continueNextSet() → skip the rest countdown and start the next set

import { formatTrackingResult } from '../../core/trackingSettings';
import { DumbbellCurlFlow, DC_PHASE, DC_ACTIVITY } from './DumbbellCurlFlow';
import { DC_FEEDBACK } from './config';
import { drawDumbbellCurlOverlay } from './draw';

function overallProgress(fr) {
  const vals = [fr.armProgress?.left, fr.armProgress?.right].filter((v) => v != null);
  if (!vals.length) return 0;
  return fr.mode === 'alternate' ? Math.max(...vals) : Math.min(...vals);
}

function toTrackerState(flow, fr) {
  const summary = fr.phase === DC_PHASE.COMPLETE ? flow.finish() : flow.summary();
  const level = fr.statusKind === 'fail' || fr.statusKind === 'warn' ? 'warn' : 'ok';
  const setupPhase = fr.phase === DC_PHASE.SETUP_STANCE;
  const cues = [{ level, text: fr.feedback || fr.status || 'Tracking…' }];
  if (fr.phase === DC_PHASE.ACTIVE && fr.activity !== DC_ACTIVITY.EXERCISING) {
    cues.push({ level: 'info', text: 'Not doing exercise' });
  }
  return {
    exerciseId: 'dumbbellcurl',
    managesSets: true,
    repCount: fr.repCount,
    setRepCount: fr.setRepCount,
    currentSet: fr.currentSet,
    targetSets: fr.targetSets,
    targetReps: fr.targetReps,
    setsCompleted: fr.setsCompleted,
    phase: fr.phase === DC_PHASE.ACTIVE
      ? (fr.armStates.left === 'UP' || fr.armStates.right === 'UP' ? 'up' : 'down')
      : fr.phase,
    flowPhase: fr.phase,
    curlMode: fr.mode,
    progress: overallProgress(fr),
    armProgress: fr.armProgress,
    formScore: summary.formScore ?? 100,
    dcSummary: summary,
    activity: fr.activity,
    activityReason: fr.activityReason,
    timerPaused: !!fr.timerPaused,
    activeSec: summary.activeSec,
    sessionSec: summary.sessionSec,
    restRemainingSec: fr.restRemainingSec,
    ready: fr.phase !== DC_PHASE.SETUP_STANCE,
    posture: fr.sustainedCues?.length ? 'incorrect' : 'correct',
    cues,
    feedback: fr.feedback || null,
    skeletonColor: fr.boneColor,
    postureResult: { cueKeys: fr.sustainedCues || [] },
    stanceData: setupPhase && fr.stanceResult ? { allCues: fr.stanceResult.cueKeys || [] } : null,
    lastRep: fr.lastAttempt,
  };
}

function toRepEvent(done) {
  const errorKey = done.primaryIssue;
  return {
    index: done.index,
    set: done.set,
    repInSet: done.repInSet,
    side: done.side,
    durationSec: done.durationSec,
    errorKey,
    error: errorKey ? DC_FEEDBACK[errorKey] || null : null,
    errors: done.issues,
    good: done.clean,
    metric: done.score,
    score: done.score,
    romPct: done.romPct,
  };
}

function createDumbbellCurlTracker(options = {}) {
  const flow = new DumbbellCurlFlow(options);
  let lastFr = null;
  // More than one rep can finish in the same frame ('alternate' mode, both
  // arms together); emit one repEvent per frame so none is dropped.
  let repQueue = [];

  return {
    reset() {
      flow.reset();
      lastFr = null;
      repQueue = [];
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

      if (lastFr.repsCompleted?.length) repQueue.push(...lastFr.repsCompleted);
      const done = repQueue.shift();
      if (done) state.repEvent = toRepEvent(done);
      if (lastFr.attemptsCompleted?.length) {
        state.attemptEvent = lastFr.attemptsCompleted[lastFr.attemptsCompleted.length - 1];
      }

      state.tracking = formatTrackingResult(state);
      return state;
    },

    draw(ctx, landmarks, frame) {
      drawDumbbellCurlOverlay(ctx, lastFr, frame);
    },
  };
}

export default {
  id: 'dumbbellcurl',
  name: 'Dumbbell Curl',
  family: 'dumbbellcurl',
  facing: 'front',
  aliases: [
    'dumbbell curl', 'dumbbell curls',
    'dumbbell bicep curl', 'dumbbell bicep curls',
    'dumbbell biceps curl', 'dumbbell biceps curls',
    'bicep curl', 'bicep curls', 'biceps curl', 'biceps curls',
    'standing dumbbell curl', 'standing dumbbell curls',
    'db curl', 'db curls',
    'hammer curl', 'hammer curls',
    'dumbbell hammer curl', 'dumbbell hammer curls',
  ],
  create: createDumbbellCurlTracker,
};
