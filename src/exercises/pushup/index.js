// Push-up (front view) — delegates to PushUpFlow (full fitness_posture state machine + voice).

import { formatTrackingResult } from '../../core/trackingSettings';
import { PushUpFlow, PUSHUP_PHASE } from './PushUpFlow';
import { drawPushUpToleranceLines, drawPushUpDepthGuide } from './draw';

function createPushUpTracker(options = {}) {
  const flow = new PushUpFlow(options);
  let lastRep = 0;
  let lastFr = null;

  return {
    reset() {
      flow.reset();
      lastRep = 0;
      lastFr = null;
    },

    update(landmarks, frame) {
      lastFr = flow.tick(landmarks);
      const state = flow.toTrackerState(lastFr);

      if (state.repCount > lastRep) {
        lastRep = state.repCount;
        const errors = lastFr.repCompleteErrors || [];
        state.repEvent = {
          index: lastRep,
          durationSec: null,
          errorKey: errors[0] || null,
          error: lastFr.activeFeedback || null,
          errors,
          good: errors.length === 0 && !lastFr.activeFeedback,
          metric: lastFr.elbowAngle ?? null,
        };
      }

      state.tracking = formatTrackingResult(state);
      return state;
    },

    draw(ctx, landmarks, frame) {
      if (!landmarks || !lastFr) return;
      if (lastFr.phase === PUSHUP_PHASE.EXERCISE_ACTIVE || lastFr.runAnalysis) {
        drawPushUpToleranceLines(ctx, landmarks, frame.width, frame.height);
        const rep = lastFr.pushupTracker;
        if (rep) {
          drawPushUpDepthGuide(ctx, landmarks, rep.smoothAngle, rep.state, frame.width, frame.height);
        }
      }
    },
  };
}

export default {
  id: 'pushup',
  name: 'Push-up',
  family: 'pushup',
  facing: 'front',
  aliases: [
    'push up', 'push-up', 'push ups', 'push-ups', 'pushup', 'pushups',
    'standard push-up', 'standard pushup', 'wide push-up', 'wide push-ups',
    'knee push-up', 'knee push-ups',
  ],
  create: createPushUpTracker,
};
