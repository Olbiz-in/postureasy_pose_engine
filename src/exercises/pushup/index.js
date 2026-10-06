// Push-up (front view) — delegates to PushUpFlow (full fitness_posture state machine + voice).

import { LM, nowSec } from '../../core/landmarks';
import { formatTrackingResult } from '../../core/trackingSettings';
import { createScoreAverager } from '../../core/repScoring';
import { PushUpFlow, PUSHUP_PHASE } from './PushUpFlow';
import { calculateElbowAngle, pushupLandmarksVisible } from './PushUpRepTracker';
import { createPushUpRepWindow } from './repScore';
import { drawPushUpToleranceLines, drawPushUpDepthGuide } from './draw';

function createPushUpTracker(options = {}) {
  const flow = new PushUpFlow(options);
  let lastRep = 0;
  let lastFr = null;
  const repWindow = createPushUpRepWindow();
  const scores = createScoreAverager();

  return {
    reset() {
      flow.reset();
      lastRep = 0;
      lastFr = null;
      repWindow.close(nowSec());
      scores.reset();
    },

    setTargetReps(n) {
      flow.setTargetReps(n);
    },

    update(landmarks, frame) {
      lastFr = flow.tick(landmarks);
      const state = flow.toTrackerState(lastFr);
      const t = nowSec();

      if (lastFr.phase === PUSHUP_PHASE.EXERCISE_ACTIVE && pushupLandmarksVisible(landmarks)) {
        const left = calculateElbowAngle(landmarks[LM.LEFT_SHOULDER], landmarks[LM.LEFT_ELBOW], landmarks[LM.LEFT_WRIST]);
        const right = calculateElbowAngle(landmarks[LM.RIGHT_SHOULDER], landmarks[LM.RIGHT_ELBOW], landmarks[LM.RIGHT_WRIST]);
        repWindow.observe(t, lastFr.elbowAngle, left, right);
      }

      if (state.repCount > lastRep) {
        lastRep = state.repCount;
        const errors = lastFr.repCompleteErrors || [];
        const scored = repWindow.close(t, errors);
        scores.push(scored.score);
        state.repEvent = {
          index: lastRep,
          errorKey: errors[0] || null,
          error: lastFr.activeFeedback || null,
          errors,
          good: errors.length === 0 && !lastFr.activeFeedback,
          metric: lastFr.elbowAngle ?? null,
          ...scored,
        };
      }
      state.formScore = scores.value;

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
