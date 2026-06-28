// Squat exercise definition — implements the engine's ExerciseDefinition/Tracker
// contract on top of the proven SquatRepTracker + knee-form monitor.

import { LM, midpoint, shoulderWidth, isVisible } from '../../core/landmarks';
import { drawHLine } from '../../core/drawSkeleton';
import { SquatRepTracker } from './SquatRepTracker';
import { KneeAngleRepMonitor } from './kneeMonitor';

const REQUIRED = [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER];

const SPEED_CUE_TEXT = {
  rep_fast: 'Slow down — aim for 2–4s per rep',
  rep_slow: 'Pick up the pace — push with power',
  descend_fast: 'Lower more slowly',
  ascend_fast: 'Control the way up',
  ascend_slow: 'Drive up with more power',
  descend_slow: 'Descend a bit faster',
};

function createSquatTracker() {
  const rep = new SquatRepTracker();
  const knee = new KneeAngleRepMonitor();

  let formScore = 100;
  let lastInSquat = false;
  let pendingFeedback = null;

  function applyRepPenalty(metrics, kneeMsg) {
    let penalty = 0;
    if (!metrics.full_depth) penalty += 8;
    if (metrics.too_deep) penalty += 5;
    if (metrics.left_right_asym > SquatRepTracker.MAX_LR_ASYM_FRAC * 0.8) penalty += 6;
    if (!['ok', 'pace_perfect'].includes(metrics.speed_cue)) penalty += 5;
    if (kneeMsg) penalty += 8;
    // Reward clean reps by letting the score recover gradually.
    formScore = Math.max(0, Math.min(100, formScore - penalty + (penalty === 0 ? 4 : 0)));
  }

  return {
    reset() {
      rep.reset();
      knee.resetAll();
      formScore = 100;
      lastInSquat = false;
      pendingFeedback = null;
    },

    update(landmarks) {
      if (!landmarks || !REQUIRED.every((i) => isVisible(landmarks[i]))) {
        return {
          repCount: rep.count,
          phase: 'idle',
          progress: 0,
          formScore: Math.round(formScore),
          ready: false,
          cues: [{ level: 'info', text: 'Step back so your full body is visible' }],
          feedback: null,
        };
      }

      const hip = midpoint(landmarks[LM.LEFT_HIP], landmarks[LM.RIGHT_HIP]);
      const kneeMid = midpoint(landmarks[LM.LEFT_KNEE], landmarks[LM.RIGHT_KNEE]);
      const ankleMid = midpoint(landmarks[LM.LEFT_ANKLE], landmarks[LM.RIGHT_ANKLE]);
      const sw = shoulderWidth(landmarks);
      const leftGap = landmarks[LM.LEFT_KNEE].y - landmarks[LM.LEFT_HIP].y;
      const rightGap = landmarks[LM.RIGHT_KNEE].y - landmarks[LM.RIGHT_HIP].y;

      const completed = rep.update(hip.y, kneeMid.y, ankleMid ? ankleMid.y : null, sw, leftGap, rightGap);

      // Drive the knee monitor across the rep lifecycle.
      if (rep.inSquat && !lastInSquat) knee.onRepStart();
      if (rep.inSquat) knee.updateFrame(landmarks);
      lastInSquat = rep.inSquat;

      let feedback = null;
      if (completed) {
        const kneeMsg = knee.consumeEndOfRepFeedback();
        applyRepPenalty(completed, kneeMsg);
        feedback = kneeMsg
          || (!completed.full_depth ? 'Go a little deeper for a full rep' : null)
          || (SPEED_CUE_TEXT[completed.speed_cue] || null)
          || `Rep ${completed.rep_index} — nice work!`;
        pendingFeedback = feedback;
      }

      // Live cues
      const cues = [];
      if (!rep.isCalibrated) {
        cues.push({ level: 'info', text: `Stand tall to calibrate (${rep.calibrationPct}%)` });
      } else if (rep.tooDeep) {
        cues.push({ level: 'warn', text: 'Too deep — rise up slightly' });
      } else if (rep.inSquat && knee.hasActiveFlag()) {
        cues.push({ level: 'warn', text: 'Track knees over your toes' });
      } else if (rep.inSquat) {
        cues.push({ level: rep.reachedFull ? 'ok' : 'info', text: rep.reachedFull ? 'Good depth — drive up' : 'Keep lowering' });
      } else {
        cues.push({ level: 'ok', text: 'Ready — begin your squat' });
      }

      return {
        repCount: rep.count,
        phase: rep.inSquat ? 'down' : 'up',
        progress: rep.depthPct,
        formScore: Math.round(formScore),
        ready: rep.isCalibrated,
        cues,
        feedback,
      };
    },

    draw(ctx, landmarks, frame) {
      if (rep.fixedStartLineY != null) {
        drawHLine(ctx, rep.fixedStartLineY, {
          width: frame.width,
          height: frame.height,
          color: 'rgba(34, 211, 166, 0.55)',
          label: 'Start line',
        });
      }
    },

    get lastFeedback() {
      return pendingFeedback;
    },
  };
}

export default {
  id: 'squat',
  name: 'Squat',
  facing: 'front',
  aliases: ['squat', 'squats', 'bodyweight squat', 'bodyweight squats', 'air squat', 'air squats', 'goblet squat'],
  create: createSquatTracker,
};
