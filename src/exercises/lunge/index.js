// Lunge — front-view and side-view exercise definitions (one family, two
// facings). Both wrap the same LungeFlow; only the `view` differs.
//
// The app runs the sets (like squat / push-up): the tracker reports repCount,
// emits one `repEvent` per counted rep and an `attemptEvent` for every attempt
// (including incomplete ones, which are never counted).

import { formatTrackingResult } from '../../core/trackingSettings.js';
import { LungeFlow, LUNGE_PHASE } from './LungeFlow.js';
import { LUNGE_STATE } from './LungeRepTracker.js';
import { LUNGE_FEEDBACK } from './config.js';
import { drawLungeOverlay } from './draw.js';

export function lungeRepEvent(a) {
  const primary = a.warning || null;
  return {
    index: a.index,
    durationSec: a.durationSec,
    descentSec: a.descentSec,
    ascentSec: a.ascentSec,
    // Every issue detected in the rep (same convention as the other trackers);
    // `warning` is the one that was actually announced (seen in 2 consecutive reps).
    errorKey: a.primaryIssue,
    error: a.primaryIssue ? LUNGE_FEEDBACK[a.primaryIssue] || null : null,
    errors: a.issues,
    issues: a.issues,
    groups: a.groups,
    warning: primary,
    warned: a.confirmedIssues || [],
    good: a.clean,
    metric: a.romPct,
    score: a.score,
    depthPct: a.depthPct,
    romPct: a.romPct,
    symmetryPct: a.symmetryPct,
    frontLeg: a.frontLeg,
    components: a.components,
    metrics: a.metrics,
    view: a.view,
  };
}

function toTrackerState(flow, fr, view) {
  const active = fr.phase === LUNGE_PHASE.ACTIVE;
  const warn = fr.statusKind === 'fail' || fr.statusKind === 'warn';
  const cues = [];
  if (fr.mistake) cues.push({ level: 'bad', text: fr.mistake });
  cues.push({ level: warn ? 'warn' : 'ok', text: fr.feedback || fr.status || 'Tracking…' });

  const inLunge = fr.movement && fr.movement !== LUNGE_STATE.STANDING;
  return {
    exerciseId: view === 'side' ? 'lunge-side' : 'lunge',
    repCount: fr.repCount,
    phase: active ? (inLunge ? 'down' : 'up') : fr.phase,
    movementPhase: active ? fr.movement : null,
    flowPhase: fr.phase,
    progress: fr.progress,
    formScore: fr.formScore,
    ready: active,
    posture: fr.sustainedCues.length ? 'incorrect' : 'correct',
    cues,
    feedback: fr.feedback || null,
    skeletonColor: fr.boneColor,
    // Confirmed (gated) mistakes only — used for mistake snapshots.
    postureResult: { cueKeys: fr.shownCues },
    stanceData: !active && fr.stanceResult ? { allCues: fr.stanceResult.cueKeys || [] } : null,
    legCounts: fr.legCounts,
    depth: fr.depth,
    lastRep: fr.lastRep,
  };
}

function createLungeTracker(view, options = {}) {
  const flow = new LungeFlow({ view, targetReps: options.targetReps, voice: options.voice });
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

    update(landmarks, frame) {
      const now = Number.isFinite(frame?.timestamp) ? frame.timestamp / 1000 : undefined;
      lastFr = flow.tick(landmarks, frame.width, frame.height, now);
      const state = toTrackerState(flow, lastFr, view);

      const done = lastFr.repCompleted;
      if (done && state.repCount > lastRep) {
        lastRep = state.repCount;
        state.repEvent = lungeRepEvent(done);
      }
      if (lastFr.attemptCompleted) state.attemptEvent = lastFr.attemptCompleted;

      state.tracking = formatTrackingResult(state);
      return state;
    },

    draw(ctx, landmarks, frame) {
      drawLungeOverlay(ctx, lastFr, frame);
    },
  };
}

const ALIASES = [
  'lunge', 'lunges', 'bodyweight lunge', 'bodyweight lunges',
  'forward lunge', 'forward lunges', 'reverse lunge', 'reverse lunges',
  'dumbbell lunge', 'dumbbell lunges', 'static lunge', 'static lunges',
];

export const lungeFront = {
  id: 'lunge',
  name: 'Lunge',
  family: 'lunge',
  facing: 'front',
  aliases: ALIASES,
  create: (options) => createLungeTracker('front', options),
};

export const lungeSide = {
  id: 'lunge-side',
  name: 'Lunge (side view)',
  family: 'lunge',
  facing: 'side',
  aliases: ['lunge side', 'lunge-side'],
  create: (options) => createLungeTracker('side', options),
};

export default lungeFront;
