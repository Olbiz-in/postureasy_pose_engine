// Squat (front view) — delegates to SquatFlow (full fitness_posture state machine + voice).

import { LM, midpoint, shoulderWidth } from '../../core/landmarks';
import { formatTrackingResult } from '../../core/trackingSettings';
import { SquatFlow, PHASE } from './SquatFlow';
import {
  drawStandingGuideBox,
  drawStanceAnkleWidthGuides,
  drawAllStanceToleranceGuides,
  drawSquatRepOverlay,
  drawTempoGateOverlay,
} from './draw';

function createSquatTracker(options = {}) {
  const flow = new SquatFlow(options);
  let lastRep = 0;
  let lastFr = null;

  return {
    reset() {
      flow.reset();
      lastRep = 0;
      lastFr = null;
    },

    update(landmarks, frame) {
      lastFr = flow.tick(landmarks, frame.width, frame.height);
      const state = flow.toTrackerState(lastFr);

      if (state.repCount > lastRep) {
        lastRep = state.repCount;
        const metrics = lastFr.squatTracker?.repMetrics?.at(-1);
        const errors = metrics?.voice_keys || [];
        state.repEvent = {
          index: lastRep,
          durationSec: metrics?.total_rep_sec ?? null,
          activeSec: metrics?.active_time_sec ?? null,
          errorKey: errors[0] || null,
          error: lastFr.activeFeedback || null,
          errors,
          good: errors.length === 0 && !lastFr.activeFeedback,
          metric: metrics?.peak_depth_pct ?? null,
          speedCue: metrics?.speed_cue ?? null,
        };
      }

      state.tracking = formatTrackingResult(state);
      return state;
    },

    draw(ctx, landmarks, frame) {
      if (!landmarks || !lastFr) return;

      if (lastFr.drawGuideBox) {
        drawStandingGuideBox(ctx, frame.width, frame.height);
      }

      // STANCE_CHECK: only ankle↔shoulder width overlay (no knee/heel/torso guides)
      if (lastFr.phase === PHASE.STANCE_CHECK && lastFr.stanceData?.stanceMode === 'width') {
        drawStanceAnkleWidthGuides(ctx, lastFr.stanceData, frame.width, frame.height);
      }
      // Exercise / ready overlays keep the existing multi-guide form visualization
      else if (
        lastFr.stanceData &&
        lastFr.stanceData.stanceMode !== 'width' &&
        (lastFr.phase === PHASE.EXERCISE_ACTIVE || lastFr.phase === PHASE.READY_TO_START || lastFr.phase === PHASE.DONE)
      ) {
        const sustained = new Set(lastFr.stanceData.allCues || []);
        drawAllStanceToleranceGuides(
          ctx, landmarks, lastFr.stanceData, frame.width, frame.height, sustained,
        );
      }

      if (lastFr.squatTracker && lastFr.phase === PHASE.EXERCISE_ACTIVE) {
        const hip = midpoint(landmarks[LM.LEFT_HIP], landmarks[LM.RIGHT_HIP]);
        const kneeMid = midpoint(landmarks[LM.LEFT_KNEE], landmarks[LM.RIGHT_KNEE]);
        const sw = shoulderWidth(landmarks);
        drawSquatRepOverlay(
          ctx, lastFr.squatTracker, hip.x, hip.y, kneeMid.x, kneeMid.y, sw, frame.width, frame.height,
        );
        drawTempoGateOverlay(ctx, lastFr.squatTracker, frame.width, frame.height);
      }
    },
  };
}

export default {
  id: 'squat',
  name: 'Squat',
  family: 'squat',
  facing: 'front',
  aliases: [
    'squat', 'squats', 'bodyweight squat', 'bodyweight squats',
    'air squat', 'air squats', 'goblet squat', 'walking lunges',
  ],
  create: createSquatTracker,
};
