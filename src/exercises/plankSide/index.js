// Side-view plank — a timed hold, not a rep exercise. The hold timer only runs
// while the body is in plank position; form faults (hips sagging / piking,
// bent knees, shoulders off the support point, head out of line) are voiced
// live, with "move your hips up / down" taking priority.

import { nowSec } from '../../core/landmarks';
import { VoiceManager } from '../../core/voiceManager.js';
import {
  PLANK_SIDE_CFG as CFG,
  PLANK_FAULT_PRIORITY,
  PLANK_MINOR_FAULTS,
  PLANK_FEEDBACK,
  PLANK_CUE_TEXT,
  FORM_COLORS,
} from './config';
import {
  detectVisibleSide,
  plankLandmarksVisible,
  sidePoints,
  computePlankMetrics,
  isInPlankPosition,
} from './plankPose';

const VOICE_MSG = {
  no_profile: 'Turn sideways so your whole body is visible to the camera.',
  get_into: 'Get into your plank position, side on to the camera.',
  started: 'Timer started. Hold your plank.',
  paused: 'Timer paused. Get back into your plank.',
  resumed: 'Back in position. Keep holding.',
  corrected: 'Good. Hold that position.',
  final: 'Ten seconds left.',
};

const METRIC_KEYS = ['bodyTiltDeg', 'hipDev', 'hipAngle', 'kneeAngle', 'stackOffset', 'headDev'];

export function formatHoldForSpeech(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const minPart = m ? `${m} minute${m === 1 ? '' : 's'}` : '';
  const secPart = r ? `${r} second${r === 1 ? '' : 's'}` : '';
  return [minPart, secPart].filter(Boolean).join(' ') || '0 seconds';
}

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

class MetricSmoother {
  constructor() {
    this.reset();
  }

  reset() {
    this.buf = {};
  }

  push(metrics) {
    const n = Math.max(1, Math.round(CFG.metric_smoothing_frames));
    const out = { ...metrics };
    for (const key of METRIC_KEYS) {
      const v = metrics[key];
      if (v == null || !Number.isFinite(v)) {
        this.buf[key] = [];
        out[key] = null;
        continue;
      }
      const b = (this.buf[key] ||= []);
      b.push(v);
      while (b.length > n) b.shift();
      out[key] = b.reduce((a, x) => a + x, 0) / b.length;
    }
    return out;
  }
}

/** Hysteresis + time debounce: a fault must persist to fire and stay clear to reset. */
class FaultGate {
  constructor() {
    this.reset();
  }

  reset() {
    this.active = false;
    this.onsetT = null;
    this.clearT = null;
    this.count = 0;
    this.activeSec = 0;
  }

  update(over, clear, t, dt) {
    if (!this.active) {
      if (over) {
        if (this.onsetT == null) this.onsetT = t;
        if (t - this.onsetT >= CFG.fault_confirm_sec) {
          this.active = true;
          this.count++;
          this.clearT = null;
        }
      } else {
        this.onsetT = null;
      }
    } else {
      if (clear) {
        if (this.clearT == null) this.clearT = t;
        if (t - this.clearT >= CFG.fault_clear_sec) {
          this.active = false;
          this.onsetT = null;
        }
      } else {
        this.clearT = null;
      }
    }
    if (this.active) this.activeSec += dt;
    return this.active;
  }
}

function faultConditions(m) {
  const sag = CFG.hip_sag_ratio;
  const pike = CFG.hip_pike_ratio;
  const clr = CFG.hip_clear_fraction;
  const stack = CFG.shoulder_stack_ratio;
  const hd = m.headDev;
  return {
    pk_hips_sagging: [m.hipDev > sag, m.hipDev < sag * clr],
    pk_hips_piking: [-m.hipDev > pike, -m.hipDev < pike * clr],
    pk_knees_bent: [m.kneeAngle < CFG.knee_bent_deg, m.kneeAngle >= CFG.knee_bent_deg + 5],
    pk_shoulders_forward: [m.stackOffset > stack, m.stackOffset < stack * 0.75],
    pk_shoulders_back: [m.stackOffset < -stack, m.stackOffset > -stack * 0.75],
    pk_head_dropping: [hd != null && hd > CFG.head_drop_ratio, hd == null || hd < CFG.head_drop_ratio * 0.75],
    pk_head_raised: [hd != null && -hd > CFG.head_up_ratio, hd == null || -hd < CFG.head_up_ratio * 0.75],
  };
}

function feedbackFor(key, plankType) {
  const msg = PLANK_FEEDBACK[key];
  if (!msg || plankType !== 'high') return msg;
  return msg.replace('your elbows', 'your hands');
}

function createPlankSideTracker(options = {}) {
  const voiceEnabled = options.voice !== false;
  const voice = new VoiceManager();
  const smoother = new MetricSmoother();
  const gates = Object.fromEntries(PLANK_FAULT_PRIORITY.map((k) => [k, new FaultGate()]));

  let targetSec = Number(options.targetSeconds) > 0 ? Number(options.targetSeconds) : CFG.default_target_sec;
  let lastT = -1;
  let holding = false;
  let everHeld = false;
  let enterT = null;
  let exitT = null;
  let holdSec = 0;
  let goodSec = 0;
  let minorSec = 0;
  let hipDevSec = 0;
  let complete = false;
  let lastMilestone = 0;
  let finalWarned = false;
  let lastPrimary = '';
  let voicedFault = false;
  let faultSince = 0;
  let lastFaultVoiceT = null;
  let lastPts = null;
  let lastMetrics = null;
  let pauseCount = 0;

  const speak = (text, opts) => (voiceEnabled ? voice.speak(text, opts) : false);
  const speakQueued = (text, opts) => (voiceEnabled ? voice.speakQueued(text, opts) : false);

  function resetFaults() {
    for (const g of Object.values(gates)) {
      g.active = false;
      g.onsetT = null;
      g.clearT = null;
    }
    lastPrimary = '';
  }

  function activeFaults() {
    return PLANK_FAULT_PRIORITY.filter((k) => gates[k].active);
  }

  // Major-fault time scores 0; minor-only (head) time earns half credit.
  function formScore() {
    if (holdSec < 1) return 100;
    return Math.max(0, Math.round(((goodSec - 0.5 * minorSec) / holdSec) * 100));
  }

  function bodyLinePct() {
    if (holdSec < 1) return null;
    const meanDev = hipDevSec / holdSec;
    return Math.max(0, Math.min(100, Math.round((1 - meanDev / (CFG.hip_sag_ratio * 2)) * 100)));
  }

  function summary() {
    const faults = {};
    const faultCounts = {};
    for (const [k, g] of Object.entries(gates)) {
      if (g.count > 0) {
        faults[k] = +g.activeSec.toFixed(1);
        faultCounts[k] = g.count;
      }
    }
    const errors = Object.keys(faults).filter((k) => faults[k] >= 1);
    errors.sort((a, b) => faults[b] - faults[a]);
    return {
      holdSec: +holdSec.toFixed(1),
      goodSec: +goodSec.toFixed(1),
      minorSec: +minorSec.toFixed(1),
      targetSec,
      targetPct: targetSec > 0 ? Math.min(100, Math.round((holdSec / targetSec) * 100)) : null,
      completed: complete,
      formScore: formScore(),
      bodyLinePct: bodyLinePct(),
      pauseCount,
      faults,
      faultCounts,
      errors,
      primaryErrorKey: errors[0] || null,
      primaryError: errors[0] ? PLANK_CUE_TEXT[errors[0]] : null,
    };
  }

  function voiceMilestones() {
    const every = CFG.milestone_every_sec;
    const remaining = targetSec > 0 ? targetSec - holdSec : Infinity;
    if (targetSec > 0 && !finalWarned && targetSec > CFG.final_warning_sec + 5 && remaining <= CFG.final_warning_sec) {
      finalWarned = true;
      speakQueued(VOICE_MSG.final, { key: 'pk_final' });
      return;
    }
    const step = Math.floor(holdSec / every);
    if (step > lastMilestone) {
      lastMilestone = step;
      if (remaining > CFG.final_warning_sec + 2 && !voice.isBusy()) {
        speakQueued(formatHoldForSpeech(step * every), { key: `pk_ms_${step}` });
      }
    }
  }

  function voiceFaults(primary, plankType, t) {
    if (primary) {
      if (primary !== lastPrimary) {
        faultSince = t;
        lastFaultVoiceT = null;
      }
      const repeatSec = PLANK_MINOR_FAULTS.has(primary) ? CFG.minor_fault_voice_repeat_sec : CFG.fault_voice_repeat_sec;
      const due = lastFaultVoiceT == null
        ? t - faultSince >= CFG.fault_voice_delay_sec
        : t - lastFaultVoiceT >= repeatSec;
      if (due && speak(feedbackFor(primary, plankType), { key: `pk_fault_${primary}`, cooldownMs: 0, immediate: true })) {
        lastFaultVoiceT = t;
        voicedFault = true;
      }
    } else if (lastPrimary && voicedFault) {
      voicedFault = false;
      speak(VOICE_MSG.corrected, { key: 'pk_corrected', cooldownMs: 6000 });
    }
    lastPrimary = primary || '';
  }

  function baseState(extra) {
    return {
      repCount: 0,
      progress: targetSec > 0 ? Math.min(1, holdSec / targetSec) : 0,
      formScore: formScore(),
      feedback: null,
      repEvent: null,
      holdSec: +holdSec.toFixed(1),
      targetSec,
      holdComplete: complete,
      plank: {
        holdSec: +holdSec.toFixed(1),
        goodSec: +goodSec.toFixed(1),
        targetSec,
        remainingSec: targetSec > 0 ? Math.max(0, Math.ceil(targetSec - holdSec)) : null,
        holding,
        paused: everHeld && !holding && !complete,
        complete,
        formScore: formScore(),
        plankType: lastMetrics?.plankType ?? null,
        hipDev: lastMetrics?.hipDev != null ? +lastMetrics.hipDev.toFixed(3) : null,
        hipAngle: lastMetrics?.hipAngle != null ? +lastMetrics.hipAngle.toFixed(1) : null,
      },
      ...extra,
    };
  }

  return {
    setTargetSeconds(sec) {
      targetSec = Number(sec) > 0 ? Number(sec) : 0;
    },

    finish() {
      return summary();
    },

    reset() {
      smoother.reset();
      for (const g of Object.values(gates)) g.reset();
      lastT = -1;
      holding = false;
      everHeld = false;
      enterT = null;
      exitT = null;
      holdSec = 0;
      goodSec = 0;
      minorSec = 0;
      hipDevSec = 0;
      complete = false;
      lastMilestone = 0;
      finalWarned = false;
      lastPrimary = '';
      voicedFault = false;
      faultSince = 0;
      lastFaultVoiceT = null;
      lastPts = null;
      lastMetrics = null;
      pauseCount = 0;
      voice.cancel();
      voice.resetCooldowns();
    },

    update(landmarks, frame = {}) {
      const t = Number.isFinite(frame.timestamp) ? frame.timestamp / 1000 : nowSec();
      const dt = lastT < 0 ? 0 : Math.min(0.25, Math.max(0, t - lastT));
      lastT = t;
      const w = frame.width || 640;
      const h = frame.height || 480;

      const side = landmarks ? detectVisibleSide(landmarks) : 'left';
      const visible = plankLandmarksVisible(landmarks, side);
      let metrics = null;
      if (visible) {
        lastPts = sidePoints(landmarks, side, w, h);
        const raw = computePlankMetrics(lastPts);
        metrics = raw ? smoother.push(raw) : null;
      } else {
        lastPts = null;
        smoother.reset();
      }
      lastMetrics = metrics;

      // Position gate with enter / exit grace so a single bad frame never pauses.
      const inPosRaw = !complete && metrics != null && isInPlankPosition(metrics);
      if (!holding) {
        exitT = null;
        if (inPosRaw) {
          if (enterT == null) enterT = t;
          if (t - enterT >= CFG.position_enter_sec) {
            holding = true;
            enterT = null;
            speak(everHeld ? VOICE_MSG.resumed : VOICE_MSG.started, {
              key: everHeld ? 'pk_resumed' : 'pk_started',
              cooldownMs: everHeld ? 4000 : 0,
              immediate: true,
            });
            everHeld = true;
          }
        } else {
          enterT = null;
        }
      } else if (!inPosRaw) {
        if (exitT == null) exitT = t;
        if (t - exitT >= CFG.position_exit_sec) {
          holding = false;
          exitT = null;
          resetFaults();
          if (!complete) {
            pauseCount++;
            speak(VOICE_MSG.paused, { key: 'pk_paused', cooldownMs: 4000, immediate: true });
          }
        }
      } else {
        exitT = null;
      }

      if (!visible) {
        if (!complete) speak(VOICE_MSG.no_profile, { key: 'pk_no_profile', cooldownMs: 10_000 });
        return baseState({
          phase: complete ? 'complete' : 'idle',
          ready: false,
          flowPhase: holding ? 'pk_active' : 'pk_idle',
          cues: [{ level: 'info', text: 'Turn sideways so your whole body is visible' }],
          postureResult: { cueKeys: [] },
          skeletonColor: FORM_COLORS.green,
        });
      }

      let faults = [];
      if (holding && metrics) {
        const conds = faultConditions(metrics);
        for (const key of PLANK_FAULT_PRIORITY) {
          const [over, clear] = conds[key];
          gates[key].update(over, clear, t, dt);
        }
        faults = activeFaults();
        holdSec += dt;
        if (!faults.some((k) => !PLANK_MINOR_FAULTS.has(k))) {
          goodSec += dt;
          if (faults.length) minorSec += dt;
        }
        if (Number.isFinite(metrics.hipDev)) hipDevSec += Math.abs(metrics.hipDev) * dt;
        if (targetSec > 0 && holdSec >= targetSec) {
          holdSec = targetSec;
          complete = true;
          holding = false;
          resetFaults();
          faults = [];
          voice.cancel();
        } else {
          voiceFaults(faults[0], metrics.plankType, t);
          voiceMilestones();
        }
      } else if (!everHeld && !complete) {
        speak(VOICE_MSG.get_into, { key: 'pk_get_into', cooldownMs: 10_000 });
      }

      const hipNear =
        metrics &&
        holding &&
        !faults.length &&
        (metrics.hipDev > CFG.hip_sag_ratio * CFG.hip_near_fraction ||
          -metrics.hipDev > CFG.hip_pike_ratio * CFG.hip_near_fraction);

      const cues = [];
      if (complete) {
        cues.push({ level: 'ok', text: `Target reached — ${fmtClock(holdSec)} held` });
      } else if (!holding) {
        cues.push({
          level: everHeld ? 'warn' : 'info',
          text: everHeld ? 'Timer paused — get back into your plank' : 'Get into plank position, side-on to the camera',
        });
      } else if (faults.length) {
        for (const key of faults.slice(0, 2)) {
          cues.push({ level: PLANK_MINOR_FAULTS.has(key) ? 'warn' : 'bad', text: PLANK_CUE_TEXT[key] });
        }
      } else if (hipNear) {
        cues.push({
          level: 'warn',
          text: metrics.hipDev > 0 ? 'Hips starting to drop — brace your core' : 'Hips creeping up — lower slightly',
        });
      } else {
        cues.push({ level: 'ok', text: 'Strong line — shoulders, hips and ankles straight' });
      }

      const major = faults.some((k) => !PLANK_MINOR_FAULTS.has(k));
      const skeletonColor = major
        ? FORM_COLORS.red
        : faults.length || hipNear
          ? FORM_COLORS.yellow
          : FORM_COLORS.green;

      return baseState({
        phase: complete ? 'complete' : holding ? 'holding' : everHeld ? 'paused' : 'idle',
        ready: true,
        flowPhase: holding ? 'pk_active' : 'pk_idle',
        cues,
        postureResult: { cueKeys: faults },
        skeletonColor,
      });
    },

    draw(ctx, landmarks, frame, state) {
      if (!lastPts || !state) return;
      const { shoulder: sh, hip, ankle } = lastPts;
      const faults = state.postureResult?.cueKeys || [];
      const sag = faults.includes('pk_hips_sagging');
      const pike = faults.includes('pk_hips_piking');
      ctx.save();

      // Ideal body line shoulder → ankle.
      ctx.strokeStyle = 'rgba(120,200,255,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(ankle.x, ankle.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Actual line through the hip.
      ctx.strokeStyle = state.skeletonColor || FORM_COLORS.green;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(hip.x, hip.y);
      ctx.lineTo(ankle.x, ankle.y);
      ctx.stroke();

      // Arrow at the hip pointing the way to move.
      if (sag || pike) {
        const dir = sag ? -1 : 1;
        const len = 46;
        const x = hip.x;
        const y0 = hip.y + dir * 14;
        const y1 = y0 + dir * len;
        ctx.strokeStyle = FORM_COLORS.red;
        ctx.fillStyle = FORM_COLORS.red;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y1 + dir * 12);
        ctx.lineTo(x - 10, y1);
        ctx.lineTo(x + 10, y1);
        ctx.closePath();
        ctx.fill();
      }

      // Hold-timer badge (counter-mirrored so the text reads correctly).
      const p = state.plank || {};
      const label = p.complete
        ? `DONE ${fmtClock(p.holdSec)}`
        : p.paused
          ? `PAUSED ${fmtClock(p.holdSec)}`
          : `HOLD ${fmtClock(p.holdSec || 0)}${p.targetSec ? ` / ${fmtClock(p.targetSec)}` : ''}`;
      ctx.font = 'bold 20px sans-serif';
      const tw = ctx.measureText(label).width;
      const bx = 12;
      const by = 12;
      if (frame?.mirrored) {
        ctx.translate(frame.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, tw + 20, 32);
      ctx.fillStyle = p.paused ? FORM_COLORS.yellow : p.complete ? FORM_COLORS.green : '#fff';
      ctx.fillText(label, bx + 10, by + 23);
      ctx.restore();
    },
  };
}

export default {
  id: 'plank-side',
  name: 'Plank (side view)',
  family: 'plank',
  facing: 'side',
  timed: true,
  aliases: [
    'plank',
    'planks',
    'plank hold',
    'forearm plank',
    'elbow plank',
    'front plank',
    'high plank',
    'straight arm plank',
    'side view plank',
  ],
  create: createPlankSideTracker,
};
