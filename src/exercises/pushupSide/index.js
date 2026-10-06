// Side-view push-up exercise definition. Tracks back straightness, depth, full
// extension and hand placement, counting reps from the visible-side elbow angle.

import { nowSec } from '../../core/landmarks';
import { VoiceManager } from '../../core/voiceManager.js';
import { createScoreAverager } from '../../core/repScoring';
import { SIDE_PUSHUP_CFG, SIDE_PUSHUP_FEEDBACK, FORM_COLORS, SIDE_PUSHUP_UP_THRESHOLD } from './config';
import { scoreSidePushUpRep } from './repScore';
import {
  SidePushUpRepTracker,
  sidePushupLandmarksVisible,
  sidePushupPostureLandmarksVisible,
  evaluateSidePushUpPosture,
  detectVisibleSide,
  getHipLineMetrics,
  getTooDeepLineY,
  getSideLm,
} from './SidePushUpRepTracker';

const VOICE_CD_MS = 10_000;

const VOICE_MSG = {
  no_profile: 'Turn sideways so your full profile is visible.',
  ready: 'Upper body detected. Begin your push-up.',
  done: 'Congratulations. You finished every rep.',
};

// Single-error-per-rep priority (highest first).
const SIDE_PUSHUP_PRIORITY = [
  { label: 'Back not straight', keys: ['back_sagging', 'back_piking'] },
  { label: 'Too deep', keys: ['pushup_too_deep', 'pushup_shoulder_deep'] },
  { label: 'Partial rep', keys: ['pushup_partial_extension'] },
  { label: 'Not deep enough', keys: ['pushup_not_deep_enough'] },
  { label: 'Hand placement', keys: ['hand_too_forward', 'hand_too_low'] },
];

function selectPrimaryError(keys) {
  const set = new Set(keys);
  for (const group of SIDE_PUSHUP_PRIORITY) {
    for (const key of group.keys) {
      if (set.has(key)) return { key, label: group.label };
    }
  }
  return null;
}

function createSidePushUpTracker(options = {}) {
  const voiceEnabled = options.voice !== false;
  const voice = new VoiceManager();
  const rep = new SidePushUpRepTracker();
  let repErrorKeys = new Set();
  const scores = createScoreAverager();
  let downStartT = -1;
  let cycleStartT = -1;
  let cycleMinAngle = 180;
  let hipDevSum = 0;
  let hipDevN = 0;
  let readyVoiceSent = false;
  let doneVoiceSent = false;
  let lastLiveCueKey = '';

  const speak = (text, opts) => {
    if (!voiceEnabled) return false;
    return voice.speak(text, opts);
  };
  const speakQueued = (text, opts) => {
    if (!voiceEnabled) return false;
    return voice.speakQueued(text, opts);
  };

  function progressFor(angle) {
    const lo = SIDE_PUSHUP_CFG.depth_target_min;
    return Math.max(0, Math.min(1, (180 - angle) / (180 - lo)));
  }

  return {
    reset() {
      rep.reset();
      repErrorKeys = new Set();
      scores.reset();
      downStartT = -1;
      cycleStartT = -1;
      cycleMinAngle = 180;
      hipDevSum = 0;
      hipDevN = 0;
      readyVoiceSent = false;
      doneVoiceSent = false;
      lastLiveCueKey = '';
      voice.cancel();
      voice.resetCooldowns();
    },

    update(landmarks) {
      if (!landmarks || !sidePushupLandmarksVisible(landmarks)) {
        speak(VOICE_MSG.no_profile, { key: 'side_pu_no_profile', cooldownMs: VOICE_CD_MS });
        return {
          repCount: rep.count,
          phase: 'idle',
          progress: 0,
          formScore: scores.value,
          ready: false,
          cues: [{ level: 'info', text: 'Turn sideways so your full profile is visible' }],
          feedback: null,
          repEvent: null,
          skeletonColor: FORM_COLORS.green,
        };
      }

      if (!readyVoiceSent) {
        readyVoiceSent = true;
        speak(VOICE_MSG.ready, { key: 'side_pu_ready', cooldownMs: 0, immediate: true });
      }

      const elbowAngle = rep.updateAngle(landmarks);
      const visibleSide = rep.visibleSide;
      const stateBefore = rep.state;
      const completed = rep.detectAndCount(elbowAngle);

      if (stateBefore !== 'DOWN' && rep.state === 'DOWN') {
        repErrorKeys = new Set();
        downStartT = nowSec();
      }
      if (cycleStartT < 0 && elbowAngle < SIDE_PUSHUP_UP_THRESHOLD) cycleStartT = nowSec();
      if (cycleStartT >= 0) cycleMinAngle = Math.min(cycleMinAngle, elbowAngle);

      let posture = null;
      if (sidePushupPostureLandmarksVisible(landmarks, visibleSide)) {
        const evalState = stateBefore === 'DOWN' ? 'DOWN' : rep.state;
        posture = evaluateSidePushUpPosture(landmarks, elbowAngle, evalState, visibleSide);
        for (const key of posture.cueKeys) repErrorKeys.add(key);
        if (cycleStartT >= 0 && Number.isFinite(posture.hipDevRatio)) {
          hipDevSum += posture.hipDevRatio;
          hipDevN += 1;
        }

        // Live voice during the rep
        const primaryKey = posture.cueKeys[0];
        if (primaryKey && primaryKey !== lastLiveCueKey) {
          const msg = SIDE_PUSHUP_FEEDBACK[primaryKey];
          if (msg) {
            speak(msg, { key: `side_pu_live_${primaryKey}`, cooldownMs: VOICE_CD_MS });
          }
        }
        lastLiveCueKey = primaryKey || '';
      } else {
        lastLiveCueKey = '';
      }

      let repEvent = null;
      let feedback = null;
      if (completed) {
        const n = rep.count;
        const startT = cycleStartT >= 0 ? cycleStartT : downStartT;
        const durationSec = startT > 0 ? +(nowSec() - startT).toFixed(2) : null;
        const primary = selectPrimaryError(repErrorKeys);
        const good = primary == null;
        feedback = primary ? SIDE_PUSHUP_FEEDBACK[primary.key] || primary.label : `Rep ${n} — nice work!`;
        const scored = scoreSidePushUpRep({
          errors: [...repErrorKeys],
          durationSec,
          minAngle: cycleMinAngle,
          hipDevMean: hipDevN ? hipDevSum / hipDevN : 0,
        });
        scores.push(scored.score);

        if (primary) {
          speakQueued(SIDE_PUSHUP_FEEDBACK[primary.key] || primary.label, {
            key: `side_pu_rep_${n}_${primary.key}`,
          });
        } else {
          speakQueued(`Rep ${n}. Nice work!`, { key: `side_pu_rep_${n}_good` });
        }

        const target = SIDE_PUSHUP_CFG.pushup_max_reps;
        if (target > 0 && n >= target && !doneVoiceSent) {
          doneVoiceSent = true;
          speakQueued(VOICE_MSG.done, { key: 'side_pu_done' });
        } else if (n < target || target <= 0) {
          speakQueued(`Do rep ${n + 1}.`, { key: `side_pu_do_rep_${n + 1}` });
        }

        repEvent = {
          index: n,
          durationSec,
          errorKey: primary ? primary.key : null,
          error: primary ? primary.label : null,
          errors: [...repErrorKeys],
          good,
          metric: +elbowAngle.toFixed(1),
          ...scored,
        };
        repErrorKeys = new Set();
        downStartT = -1;
        cycleStartT = -1;
        cycleMinAngle = 180;
        hipDevSum = 0;
        hipDevN = 0;
      }

      const cues = [];
      if (posture && posture.primaryColorKey === 'red') {
        cues.push({ level: 'bad', text: posture.primaryMessage });
      } else if (posture && posture.primaryColorKey === 'yellow') {
        cues.push({ level: 'warn', text: posture.primaryMessage });
      } else if (rep.state === 'DOWN') {
        cues.push({ level: 'ok', text: 'Lower with control — keep your back straight' });
      } else {
        cues.push({ level: 'ok', text: 'Push to full extension' });
      }

      const skeletonColor = posture ? FORM_COLORS[posture.skeletonColorKey] || FORM_COLORS.green : FORM_COLORS.green;

      return {
        repCount: rep.count,
        phase: rep.state === 'DOWN' ? 'down' : 'up',
        progress: progressFor(elbowAngle),
        formScore: scores.value,
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
      const w = frame.width;
      const h = frame.height;
      const side = detectVisibleSide(landmarks);
      const sh = getSideLm(landmarks, side, 'shoulder');
      const { hip, foot } = getHipLineMetrics(landmarks, side);
      ctx.save();
      // Back reference line: shoulder → hip → foot
      ctx.strokeStyle = 'rgba(120,200,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sh.x * w, sh.y * h);
      ctx.lineTo(hip.x * w, hip.y * h);
      ctx.lineTo(foot.x * w, foot.y * h);
      ctx.stroke();
      // Too-deep line at shoulder level
      if (rep.state === 'DOWN') {
        const lineY = getTooDeepLineY(landmarks, side) * h;
        ctx.strokeStyle = 'rgb(0,60,200)';
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        ctx.lineTo(w, lineY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgb(120,200,255)';
        ctx.font = '11px sans-serif';
        ctx.fillText('Too-deep line', 12, lineY - 6);
      }
      ctx.restore();
    },
  };
}

export default {
  id: 'pushup-side',
  name: 'Push-up (side view)',
  family: 'pushup',
  facing: 'side',
  aliases: ['pushup side', 'push-up side', 'side push-up', 'side pushup'],
  create: createSidePushUpTracker,
};
