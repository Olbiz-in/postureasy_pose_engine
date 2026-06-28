// Push-up (front view) exercise definition — implements the engine's
// ExerciseDefinition/Tracker contract on top of the proven push-up tracker,
// posture evaluator and per-rep single-error selector.

import { LM, nowSec } from '../../core/landmarks';
import {
  PUSHUP_CFG,
  PUSHUP_FEEDBACK,
  FORM_COLORS,
} from './config';
import {
  PushUpRepTracker,
  pushupLandmarksVisible,
  pushupPostureLandmarksVisible,
  evaluatePushUpPosture,
} from './PushUpRepTracker';
import {
  createEmptyRepAccumulator,
  accumulateRepPostureErrors,
  selectHighestPriorityPostureError,
  selectTooDeepCaptureKey,
  postureGroupLabelForKey,
} from './repErrorPriority';
import { drawPushUpToleranceLines, drawPushUpDepthGuide } from './draw';

function createPushUpTracker() {
  const rep = new PushUpRepTracker();
  let accum = createEmptyRepAccumulator();
  let formScore = 100;
  let downStartT = -1;
  let lastPosture = null;
  let pendingFeedback = null;

  function progressFor(angle) {
    const lo = PUSHUP_CFG.depth_target_min; // ~80
    return Math.max(0, Math.min(1, (180 - angle) / (180 - lo)));
  }

  return {
    reset() {
      rep.reset();
      accum = createEmptyRepAccumulator();
      formScore = 100;
      downStartT = -1;
      lastPosture = null;
      pendingFeedback = null;
    },

    update(landmarks) {
      if (!landmarks || !pushupLandmarksVisible(landmarks)) {
        return {
          repCount: rep.count,
          phase: 'idle',
          progress: 0,
          formScore: Math.round(formScore),
          ready: false,
          cues: [{ level: 'info', text: 'Get your upper body fully in frame' }],
          feedback: null,
          repEvent: null,
          skeletonColor: FORM_COLORS.green,
        };
      }

      const elbowAngle = rep.updateAngle(landmarks);
      const stateBefore = rep.state;
      const completed = rep.detectAndCount(elbowAngle);

      if (stateBefore !== 'DOWN' && rep.state === 'DOWN') {
        accum = createEmptyRepAccumulator();
        downStartT = nowSec();
      }

      let posture = null;
      if (pushupPostureLandmarksVisible(landmarks)) {
        const evalState = stateBefore === 'DOWN' ? 'DOWN' : rep.state;
        posture = evaluatePushUpPosture(landmarks, elbowAngle, evalState);
        if (stateBefore === 'DOWN' || rep.state === 'DOWN') {
          accumulateRepPostureErrors(accum, posture);
        }
      }
      lastPosture = posture;

      let repEvent = null;
      let feedback = null;
      if (completed) {
        const n = rep.count;
        const durationSec = downStartT > 0 ? +(nowSec() - downStartT).toFixed(2) : null;
        let errorKey = null;
        if (accum.tooDeep) {
          errorKey = selectTooDeepCaptureKey(accum.tooDeepKeys);
        } else {
          errorKey = selectHighestPriorityPostureError(accum.cues);
        }
        const allErrorKeys = [...accum.tooDeepKeys, ...accum.cues];
        const good = errorKey == null;
        feedback = errorKey ? PUSHUP_FEEDBACK[errorKey] || postureGroupLabelForKey(errorKey) : `Rep ${n} — nice work!`;
        pendingFeedback = feedback;
        formScore = Math.max(0, Math.min(100, formScore - (good ? 0 : 10) + (good ? 4 : 0)));

        repEvent = {
          index: n,
          durationSec,
          errorKey,
          error: errorKey ? postureGroupLabelForKey(errorKey) : null,
          errors: allErrorKeys,
          good,
          metric: +elbowAngle.toFixed(1),
        };
        accum = createEmptyRepAccumulator();
        downStartT = -1;
      }

      // Live cues
      const cues = [];
      if (posture && posture.primaryColorKey === 'red') {
        cues.push({ level: 'bad', text: posture.primaryMessage });
      } else if (rep.state === 'DOWN') {
        cues.push({ level: posture && posture.depthOk ? 'ok' : 'info', text: 'Lower with control' });
      } else {
        cues.push({ level: 'ok', text: 'Push up to full extension' });
      }

      const skeletonColor = posture ? FORM_COLORS[posture.skeletonColorKey] || FORM_COLORS.green : FORM_COLORS.green;

      return {
        repCount: rep.count,
        phase: rep.state === 'DOWN' ? 'down' : 'up',
        progress: progressFor(elbowAngle),
        formScore: Math.round(formScore),
        ready: true,
        cues,
        feedback,
        repEvent,
        skeletonColor,
        elbowAngle: +elbowAngle.toFixed(1),
      };
    },

    draw(ctx, landmarks, frame) {
      if (!landmarks) return;
      drawPushUpToleranceLines(ctx, landmarks, frame.width, frame.height);
      drawPushUpDepthGuide(ctx, landmarks, rep.smoothAngle, rep.state, frame.width, frame.height);
    },

    get lastFeedback() {
      return pendingFeedback;
    },
  };
}

export default {
  id: 'pushup',
  name: 'Push-up',
  family: 'pushup',
  facing: 'front',
  aliases: [
    'push up',
    'push-up',
    'push ups',
    'push-ups',
    'pushup',
    'pushups',
    'standard push-up',
    'standard pushup',
    'wide push-up',
    'wide push-ups',
    'knee push-up',
    'knee push-ups',
  ],
  create: createPushUpTracker,
};
