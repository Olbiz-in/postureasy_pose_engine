// Side-view squat exercise definition. Counts reps from hip depth against a
// locked ankle reference and flags forward torso lean + too-deep / partial reps.

import { nowSec } from '../../core/landmarks';
import { SIDE_SQUAT_CFG, SIDE_SQUAT_FEEDBACK, FORM_COLORS } from './config';
import {
  SideSquatRepTracker,
  pickVisibleSide,
  evaluateSideSquatPosture,
} from './SideSquatRepTracker';

function createSideSquatTracker() {
  const rep = new SideSquatRepTracker();
  let repCueKeys = new Set();
  let formScore = 100;
  let downStartT = -1;
  let wasInSquat = false;

  return {
    reset() {
      rep.reset();
      repCueKeys = new Set();
      formScore = 100;
      downStartT = -1;
      wasInSquat = false;
    },

    update(landmarks) {
      const vis = landmarks ? pickVisibleSide(landmarks) : null;
      if (!vis) {
        return {
          repCount: rep.count,
          phase: 'idle',
          progress: 0,
          formScore: Math.round(formScore),
          ready: false,
          cues: [{ level: 'info', text: 'Turn sideways so your profile is fully visible' }],
          feedback: null,
          repEvent: null,
          skeletonColor: FORM_COLORS.green,
        };
      }

      const completed = rep.update(vis.hip.y, vis.ankle.y, true);

      if (rep.inSquat && !wasInSquat) {
        repCueKeys = new Set();
        downStartT = nowSec();
      }
      wasInSquat = rep.inSquat;

      const posture = evaluateSideSquatPosture(vis, rep);
      for (const key of posture.cueKeys) repCueKeys.add(key);

      let repEvent = null;
      let feedback = null;
      if (completed) {
        const durationSec = downStartT > 0 ? +(nowSec() - downStartT).toFixed(2) : null;
        let errorKey = null;
        if (rep.lastRepTooDeep) errorKey = 'squat_too_deep';
        else if (rep.lastRepPartial) errorKey = 'squat_go_deeper';
        else if (repCueKeys.has('torso_lean')) errorKey = 'torso_lean';
        const good = rep.lastRepGood && !repCueKeys.has('torso_lean');
        feedback = errorKey ? SIDE_SQUAT_FEEDBACK[errorKey] : `Rep ${rep.count} — great depth!`;
        formScore = Math.max(0, Math.min(100, formScore - (good ? 0 : 10) + (good ? 4 : 0)));
        repEvent = {
          index: rep.count,
          durationSec,
          errorKey,
          error: errorKey
            ? errorKey === 'torso_lean'
              ? 'Forward lean'
              : errorKey === 'squat_too_deep'
                ? 'Too deep'
                : 'Partial rep'
            : null,
          errors: [...repCueKeys],
          good,
          metric: +(rep.hipDepthPct * 100).toFixed(1),
          counted: rep.lastRepGood,
        };
        repCueKeys = new Set();
        downStartT = -1;
      }

      const cues = [];
      if (!rep.isCalibrated) {
        cues.push({ level: 'info', text: 'Stand tall and still to calibrate' });
      } else if (posture.primaryColorKey === 'red') {
        cues.push({ level: 'bad', text: posture.primaryMessage });
      } else if (posture.primaryColorKey === 'yellow') {
        cues.push({ level: 'warn', text: posture.primaryMessage });
      } else if (rep.inSquat) {
        cues.push({ level: 'ok', text: 'Good depth — drive back up' });
      } else {
        cues.push({ level: 'ok', text: 'Ready — begin your squat' });
      }

      const skeletonColor = FORM_COLORS[posture.skeletonColorKey] || FORM_COLORS.green;

      return {
        repCount: rep.count,
        phase: rep.inSquat ? 'down' : 'up',
        progress: Math.max(0, Math.min(1, rep.hipDepthPct)),
        formScore: Math.round(formScore),
        ready: rep.isCalibrated,
        cues,
        feedback,
        repEvent,
        skeletonColor,
        depthZone: posture.depthZone,
      };
    },

    draw(ctx, landmarks, frame) {
      if (!landmarks || !rep.isCalibrated || rep.standGap <= 0 || rep.ankleRefY <= 0) return;
      const w = frame.width;
      const h = frame.height;
      const partialY = (rep.ankleRefY - rep.standGap * (1 - SIDE_SQUAT_CFG.depth_partial_pct / 100)) * h;
      const tooDeepY = (rep.ankleRefY - rep.standGap * (1 - SIDE_SQUAT_CFG.depth_too_deep_pct / 100)) * h;
      ctx.save();
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = 'rgb(34,211,166)';
      ctx.beginPath();
      ctx.moveTo(0, partialY);
      ctx.lineTo(w, partialY);
      ctx.stroke();
      ctx.strokeStyle = 'rgb(239,68,68)';
      ctx.beginPath();
      ctx.moveTo(0, tooDeepY);
      ctx.lineTo(w, tooDeepY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgb(34,211,166)';
      ctx.fillText('Depth target', 12, partialY - 6);
      ctx.fillStyle = 'rgb(239,68,68)';
      ctx.fillText('Too deep', 12, tooDeepY + 14);
      ctx.restore();
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
