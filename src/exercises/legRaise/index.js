// Lying leg raise (side view) — delegates to LegRaiseFlow.
//
// Like squat / push-up / lunge, the app runs the sets: the tracker reports
// repCount, emits one `repEvent` per counted rep and an `attemptEvent` for
// every attempt (incomplete ones are never counted).

import { formatTrackingResult } from '../../core/trackingSettings.js';
import { LegRaiseFlow, LGR_PHASE } from './LegRaiseFlow.js';
import { LGR_STATE } from './LegRaiseRepTracker.js';
import { LGR_FEEDBACK } from './config.js';
import { drawLegRaiseOverlay } from './draw.js';

export function legRaiseRepEvent(a) {
  return {
    index: a.index,
    durationSec: a.durationSec,
    // Every issue detected in the rep (same convention as the other trackers);
    // `warning` is the one that was actually announced (seen in 2 consecutive reps).
    errorKey: a.primaryIssue,
    error: a.primaryIssue ? LGR_FEEDBACK[a.primaryIssue] || null : null,
    errors: a.issues,
    issues: a.issues,
    groups: a.groups,
    warning: a.warning || null,
    warned: a.confirmedIssues || [],
    good: a.clean,
    metric: a.romPct,
    score: a.score,
    romPct: a.romPct,
    peakDeg: a.peakDeg,
    valleyDeg: a.valleyDeg,
    minKnee: a.minKnee,
    view: 'side',
  };
}

function toTrackerState(fr) {
  const active = fr.phase === LGR_PHASE.ACTIVE;
  const warn = fr.statusKind === 'fail' || fr.statusKind === 'warn';
  const cues = [];
  if (fr.mistake) cues.push({ level: 'bad', text: fr.mistake });
  cues.push({ level: warn ? 'warn' : 'ok', text: fr.feedback || fr.status || 'Tracking…' });

  return {
    exerciseId: 'leg-raise-side',
    repCount: fr.repCount,
    phase: active ? (fr.movement === LGR_STATE.DOWN ? 'down' : 'up') : fr.phase,
    movementPhase: active ? fr.movement : null,
    flowPhase: fr.phase,
    progress: fr.progress,
    formScore: fr.formScore,
    ready: active,
    posture: fr.shownCues.length ? 'incorrect' : 'correct',
    cues,
    feedback: fr.feedback || null,
    skeletonColor: fr.boneColor,
    // Confirmed (repeat-gated) mistakes only — used for mistake snapshots.
    postureResult: { cueKeys: fr.shownCues },
    // Every detected mistake, ungated — mistake snapshots capture first occurrences too.
    mistakeCues: fr.liveCues,
    stanceData: !active && fr.stanceResult ? { allCues: fr.stanceResult.cueKeys || [] } : null,
    legAngle: fr.theta != null ? Math.round(fr.theta) : null,
    lastRep: fr.lastRep,
  };
}

function createLegRaiseTracker(options = {}) {
  const flow = new LegRaiseFlow({ targetReps: options.targetReps, voice: options.voice });
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
      const state = toTrackerState(lastFr);

      const done = lastFr.repCompleted;
      if (done && state.repCount > lastRep) {
        lastRep = state.repCount;
        state.repEvent = legRaiseRepEvent(done);
      }
      if (lastFr.attemptCompleted) state.attemptEvent = lastFr.attemptCompleted;

      state.tracking = formatTrackingResult(state);
      return state;
    },

    draw(ctx, landmarks, frame) {
      drawLegRaiseOverlay(ctx, lastFr, frame);
    },
  };
}

export default {
  id: 'leg-raise-side',
  name: 'Leg Raise (side view)',
  family: 'legraise',
  facing: 'side',
  aliases: [
    'leg raise', 'leg raises',
    'lying leg raise', 'lying leg raises',
    'lying straight leg raise', 'straight leg raise', 'straight leg raises',
    'floor leg raise', 'flat leg raise',
    'leg raise side', 'leg-raise-side', 'leg-raise',
  ],
  create: createLegRaiseTracker,
};
