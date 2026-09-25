// Standing dumbbell shoulder press (front view) — delegates to ShoulderPressFlow.

import { formatTrackingResult } from '../../core/trackingSettings';
import { ShoulderPressFlow, SP_PHASE } from './ShoulderPressFlow';
import { SP_FEEDBACK } from './config';
import {
  drawStanceGuides, drawTorsoLeanGuides, drawShoulderLevelGuides,
  drawAllToleranceGuides, drawHeightBar, drawScoreChip,
} from './draw';

function createShoulderPressTracker(options = {}) {
  const flow = new ShoulderPressFlow(options);
  let lastRep = 0;
  let lastFr = null;
  let lastState = null;

  return {
    reset() {
      flow.reset();
      lastRep = 0;
      lastFr = null;
      lastState = null;
    },

    setTargetReps(n) {
      flow.setTargetReps(n);
    },

    update(landmarks, frame) {
      lastFr = flow.tick(landmarks, frame.width, frame.height);
      const state = flow.toTrackerState(lastFr);

      const done = lastFr.repCompleted;
      if (done && state.repCount > lastRep) {
        lastRep = state.repCount;
        state.repEvent = {
          index: done.index,
          durationSec: done.durationSec,
          errorKey: done.primaryError,
          error: done.primaryError ? SP_FEEDBACK[done.primaryError] || null : null,
          errors: done.errors,
          good: done.errors.length === 0,
          metric: done.score,
          score: done.score,
          heightPct: done.heightPct,
        };
      }

      state.tracking = formatTrackingResult(state);
      lastState = state;
      return state;
    },

    draw(ctx, landmarks, frame) {
      const fr = lastFr;
      const g = fr?.geometry;
      if (!landmarks || !g) return;
      const mirrored = frame.mirrored !== false;
      const { width: w, height: h } = frame;

      if (fr.phase === SP_PHASE.FEET_CHECK) {
        drawStanceGuides(ctx, g, fr.stanceResult?.stance, h);
        return;
      }

      if (fr.phase === SP_PHASE.SHOULDER_CHECK) {
        drawTorsoLeanGuides(ctx, g, fr.shoulderResult?.torso, h);
        drawShoulderLevelGuides(ctx, g, fr.shoulderResult?.shoulder, h);
        return;
      }

      if (
        fr.phase === SP_PHASE.GET_READY
        || fr.phase === SP_PHASE.READY_TO_START
        || fr.phase === SP_PHASE.EXERCISE_ACTIVE
        || fr.phase === SP_PHASE.DONE
      ) {
        const armLen = flow._rep.armLenRef(g);
        drawAllToleranceGuides(ctx, g, h, mirrored, {
          posture: fr.postureResult,
          showStance: false,
          showShoulders: true,
          showArms: true,
          armLenRef: armLen,
        });
        drawHeightBar(ctx, lastState?.progress ?? 0, w, h, mirrored);
        drawScoreChip(ctx, lastState?.formSummary, fr.lastRep, w, mirrored);
      }
    },
  };
}

export default {
  id: 'shoulderpress',
  name: 'Dumbbell Shoulder Press',
  family: 'shoulderpress',
  facing: 'front',
  aliases: [
    'shoulder press', 'shoulder presses',
    'dumbbell shoulder press', 'dumbbell shoulder presses',
    'standing dumbbell shoulder press', 'standing shoulder press',
    'dumbbell overhead press', 'overhead press', 'overhead dumbbell press',
    'db shoulder press', 'seated dumbbell shoulder press',
  ],
  create: createShoulderPressTracker,
};
