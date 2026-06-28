// Side-view squat: torso tolerance + hip-point depth tracking against a LOCKED
// ankle reference captured during calibration. Faithful port of fitness_posture
// sideSquatTracker (guide-box validation omitted — the engine relies on
// calibration rather than a fixed framing box).

import { LM, nowSec } from '../../core/landmarks';
import { SIDE_SQUAT_CFG as CFG } from './config';

const SIDE_CHAINS = {
  left: [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE],
  right: [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
};

function torsoLeanDeg(shoulder, hip) {
  const dx = hip.x - shoulder.x;
  const dy = hip.y - shoulder.y;
  const seg = Math.max(Math.hypot(dx, dy), 1e-9);
  const verticalComponent = Math.max(0, dy) / seg;
  return (Math.acos(Math.max(0, Math.min(1, verticalComponent))) * 180) / Math.PI;
}

function legSpan(hip, ankle) {
  return Math.max(Math.hypot(hip.x - ankle.x, hip.y - ankle.y), 1e-6);
}

export function pickVisibleSide(landmarks) {
  if (!landmarks) return null;
  const thr = CFG.visibility_threshold;
  let best = null;
  for (const [name, ids] of Object.entries(SIDE_CHAINS)) {
    const [sh, hip, knee, ankle] = ids.map((i) => landmarks[i]);
    const vis = [sh.visibility, hip.visibility, knee.visibility, ankle.visibility];
    if (Math.min(...vis) < thr * 0.5) continue;
    const score = vis.reduce((a, b) => a + b, 0) / vis.length;
    if (!best || score > best.score) {
      best = { name, shoulder: sh, hip, knee, ankle, legLen: legSpan(hip, ankle), score };
    }
  }
  return best;
}

export function sideSquatLandmarksVisible(landmarks) {
  return pickVisibleSide(landmarks) != null;
}

export function checkTorsoLeanSide(vis, inSquat) {
  const lean = torsoLeanDeg(vis.shoulder, vis.hip);
  const maxOk = CFG.torso_lean_max_deg + CFG.torso_lean_tolerance;
  const ok = lean <= maxOk;
  const cueKeys = inSquat && !ok ? ['torso_lean'] : [];
  return { ok, lean, cueKeys };
}

export function hipDepthZone(pct) {
  const enter = CFG.depth_enter_pct / 100;
  const partial = CFG.depth_partial_pct / 100;
  const tooDeep = CFG.depth_too_deep_pct / 100;
  if (pct < enter) return 'standing';
  if (pct < partial) return 'shallow';
  if (pct >= tooDeep) return 'too_deep';
  return 'normal';
}

export function checkSquatDepth(squat) {
  if (!squat.isCalibrated) {
    return { ok: true, cueKeys: [], label: 'Stand tall to calibrate', colorKey: 'yellow', depthZone: 'standing' };
  }
  const zone = squat.hipDepthZone;
  const pct = Math.round(squat.hipDepthPct * 100);
  if (squat.inSquat && zone === 'too_deep') {
    return { ok: false, cueKeys: ['squat_too_deep'], label: 'Too deep — rise up slightly', colorKey: 'red', depthZone: 'too_deep' };
  }
  if (squat.inSquat && zone === 'shallow') {
    return { ok: false, cueKeys: ['squat_go_deeper'], label: 'Partial — go a little deeper', colorKey: 'yellow', depthZone: 'shallow' };
  }
  if (squat.inSquat && zone === 'normal') {
    return { ok: true, cueKeys: [], label: `Good depth ${pct}%`, colorKey: 'green', depthZone: 'normal' };
  }
  return { ok: true, cueKeys: [], label: 'Stand ready', colorKey: 'green', depthZone: zone };
}

export function evaluateSideSquatPosture(vis, squat) {
  const inSquat = squat.inSquat;
  const torso = checkTorsoLeanSide(vis, inSquat);
  const depth = checkSquatDepth(squat);
  const formCues = [...torso.cueKeys, ...depth.cueKeys];

  let primaryMessage;
  let primaryColorKey;
  if (!torso.ok && inSquat) {
    primaryMessage = 'You are leaning too far forward';
    primaryColorKey = 'red';
  } else if (!depth.ok) {
    primaryMessage = depth.label;
    primaryColorKey = depth.colorKey;
  } else {
    primaryMessage = 'GOOD FORM';
    primaryColorKey = 'green';
  }

  let skeletonColorKey = 'green';
  if (formCues.includes('torso_lean') || depth.depthZone === 'too_deep') skeletonColorKey = 'red';
  else if (depth.depthZone === 'shallow') skeletonColorKey = 'yellow';

  return {
    primaryMessage,
    primaryColorKey,
    cueKeys: formCues,
    skeletonColorKey,
    torsoOk: torso.ok,
    depthOk: depth.ok,
    visibleSide: vis.name,
    leanDeg: torso.lean,
    depthZone: depth.depthZone,
    hipDepthPct: squat.hipDepthPct,
  };
}

export class SideSquatRepTracker {
  static MIN_DOWN_SEC = 0.15;
  static MIN_REP_GAP_SEC = 0.3;

  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this.state = 'UP';

    this._standGap = 0;
    this._ankleRefY = 0;
    this._standHipY = 0;
    this._calibFrames = 0;
    this._calibrationLocked = false;

    this._hipDepthBuf = [];
    this._smoothHipDepth = 0;
    this._hipDepthZone = 'standing';

    this._peakRawHipDepth = 0;
    this._hitPartialLine = false;
    this._hitTooDeepLine = false;
    this._downStartT = -999;
    this._lastCountT = -999;
    this._lastRepPartial = false;
    this._lastRepTooDeep = false;
    this._lastRepGood = false;
    this._repJustCompleted = false;
  }

  get isCalibrated() {
    return this._standGap >= CFG.stand_gap_min;
  }
  get standGap() {
    return this._standGap;
  }
  get ankleRefY() {
    return this._ankleRefY;
  }
  get calibrationLocked() {
    return this._calibrationLocked;
  }
  get hipDepthPct() {
    return this._smoothHipDepth;
  }
  get hipDepthZone() {
    return this._hipDepthZone;
  }
  get tooDeep() {
    return this.inSquat && this._hipDepthZone === 'too_deep';
  }
  get inNormalZone() {
    return this.inSquat && this._hipDepthZone === 'normal';
  }
  get inSquat() {
    return this.state === 'DOWN';
  }
  get lastRepTooDeep() {
    return this._lastRepTooDeep;
  }
  get lastRepPartial() {
    return this._lastRepPartial;
  }
  get lastRepGood() {
    return this._lastRepGood;
  }
  get repJustCompleted() {
    return this._repJustCompleted;
  }

  justCounted() {
    return nowSec() - this._lastCountT < 1.0;
  }

  _hipDepthFromHip(hipY) {
    if (this._standGap <= 0 || this._ankleRefY <= 0) return 0;
    const rawGap = this._ankleRefY - hipY;
    return Math.max(0, Math.min(1, (this._standGap - rawGap) / this._standGap));
  }

  _classifyCompletedRep() {
    const partial = CFG.depth_partial_pct / 100;
    const tooDeep = CFG.depth_too_deep_pct / 100;
    const peak = this._peakRawHipDepth;
    this._lastRepTooDeep = this._hitTooDeepLine || peak >= tooDeep;
    this._lastRepPartial = !this._lastRepTooDeep && !this._hitPartialLine && peak < partial;
    this._lastRepGood = !this._lastRepTooDeep && !this._lastRepPartial;
  }

  _resetRepDepthFlags() {
    this._peakRawHipDepth = 0;
    this._hitPartialLine = false;
    this._hitTooDeepLine = false;
  }

  _trackRepDepth(rawDepth) {
    this._peakRawHipDepth = Math.max(this._peakRawHipDepth, rawDepth);
    const zone = hipDepthZone(rawDepth);
    if (zone === 'normal' || zone === 'too_deep') this._hitPartialLine = true;
    if (zone === 'too_deep') this._hitTooDeepLine = true;
  }

  /**
   * Advance one frame.
   * @returns {boolean} true on the frame a rep just completed.
   */
  update(hipY, ankleY, countingEnabled = true) {
    if (!this._calibrationLocked) {
      const rawGap = ankleY - hipY;
      if (rawGap > this._standGap) {
        this._standGap = rawGap;
        this._ankleRefY = ankleY;
        this._standHipY = hipY;
        this._calibFrames = 0;
      } else if (this.isCalibrated) {
        this._calibFrames++;
        if (this._calibFrames >= CFG.calib_lock_frames) this._calibrationLocked = true;
      }
    }

    const rawDepth = this._hipDepthFromHip(hipY);
    this._hipDepthBuf.push(rawDepth);
    if (this._hipDepthBuf.length > CFG.depth_smooth_frames) this._hipDepthBuf.shift();
    this._smoothHipDepth = this._hipDepthBuf.reduce((a, b) => a + b, 0) / this._hipDepthBuf.length;
    this._hipDepthZone = hipDepthZone(this._smoothHipDepth);

    this._repJustCompleted = false;
    if (!this.isCalibrated) return false;

    const now = nowSec();
    const enterThr = CFG.depth_enter_pct / 100;
    const returnThr = CFG.depth_return_pct / 100;

    if (this.state === 'UP') {
      if (this._smoothHipDepth >= enterThr) {
        this.state = 'DOWN';
        this._downStartT = now;
        this._resetRepDepthFlags();
        this._trackRepDepth(rawDepth);
      }
    } else {
      this._trackRepDepth(rawDepth);
      if (this._smoothHipDepth <= returnThr) {
        const held = now - this._downStartT >= SideSquatRepTracker.MIN_DOWN_SEC;
        const gapOk = now - this._lastCountT >= SideSquatRepTracker.MIN_REP_GAP_SEC;
        if (held && gapOk) {
          this._classifyCompletedRep();
          this._lastCountT = now;
          this._repJustCompleted = true;
          if (countingEnabled && this._lastRepGood) {
            const g = CFG.squat_max_reps;
            if (g <= 0 || this.count < g) this.count += 1;
          }
        }
        this.state = 'UP';
        this._resetRepDepthFlags();
      }
    }
    return this._repJustCompleted;
  }
}
