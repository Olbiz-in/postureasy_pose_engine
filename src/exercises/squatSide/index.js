// Side-view squat — delegates to SquatSideFlow (same state machine as front view).

import { formatTrackingResult } from '../../core/trackingSettings';
import { SquatSideFlow, SIDE_PHASE } from './SquatSideFlow.js';
import { drawSideSquatTorsoTolerance } from './draw.js';
import {
  drawStandingGuideBox,
  drawSquatRepOverlay,
  drawTempoGateOverlay,
} from '../squat/draw';

function createSideSquatTracker(options = {}) {
  const flow = new SquatSideFlow(options);
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

      const vis = lastFr.sideVis || lastFr.stanceData?.vis;
      if (vis && lastFr.stanceData) {
        const inSquat = lastFr.phase === SIDE_PHASE.EXERCISE_ACTIVE
          && lastFr.squatTracker?.inSquat;
        drawSideSquatTorsoTolerance(ctx, vis, frame.width, frame.height, inSquat);
      }

      if (lastFr.squatTracker && lastFr.phase === SIDE_PHASE.EXERCISE_ACTIVE && vis) {
        drawSquatRepOverlay(
          ctx,
          lastFr.squatTracker,
          vis.hip.x,
          vis.hip.y,
          vis.knee.x,
          vis.knee.y,
          lastFr.shoulderW || vis.legLen,
          frame.width,
          frame.height,
        );
        drawTempoGateOverlay(ctx, lastFr.squatTracker, frame.width, frame.height);
      }
    },
  };
}

export default {
  id: 'squat-side',
  name: 'Squat (side view)',
  family: 'squat',
  facing: 'side',
  aliases: ['squat side', 'side squat', 'side-squat'],
  create: createSideSquatTracker,
};
