// Side-view push-up rep counting + posture evaluation.
// Faithful port of fitness_posture sidePushupTracker.

import { LM, nowSec } from '../../core/landmarks';
import {
  SIDE_PUSHUP_CFG as CFG,
  SIDE_PUSHUP_DOWN_THRESHOLD,
  SIDE_PUSHUP_UP_THRESHOLD,
  SIDE_PUSHUP_MIN_VIS,
} from './config';

const SIDE_NAMES = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'];

const SIDE_LM = {
  left: {
    shoulder: LM.LEFT_SHOULDER,
    elbow: LM.LEFT_ELBOW,
    wrist: LM.LEFT_WRIST,
    hip: LM.LEFT_HIP,
    knee: LM.LEFT_KNEE,
    ankle: LM.LEFT_ANKLE,
  },
  right: {
    shoulder: LM.RIGHT_SHOULDER,
    elbow: LM.RIGHT_ELBOW,
    wrist: LM.RIGHT_WRIST,
    hip: LM.RIGHT_HIP,
    knee: LM.RIGHT_KNEE,
    ankle: LM.RIGHT_ANKLE,
  },
};

export function calculateElbowAngle(shoulder, elbow, wrist) {
  const radians =
    Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x) -
    Math.atan2(shoulder.y - elbow.y, shoulder.x - elbow.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

function lm(landmarks, side, name) {
  return landmarks[SIDE_LM[side][name]];
}

export function detectVisibleSide(landmarks) {
  if (!landmarks) return 'left';
  let leftVis = 0;
  let rightVis = 0;
  for (const k of SIDE_NAMES) {
    leftVis += lm(landmarks, 'left', k).visibility;
    rightVis += lm(landmarks, 'right', k).visibility;
  }
  return leftVis >= rightVis ? 'left' : 'right';
}

export function sidePushupLandmarksVisible(landmarks) {
  if (!landmarks) return false;
  const side = detectVisibleSide(landmarks);
  for (const name of SIDE_NAMES) {
    if (lm(landmarks, side, name).visibility < SIDE_PUSHUP_MIN_VIS) return false;
  }
  return true;
}

export function sidePushupPostureLandmarksVisible(landmarks, visibleSide) {
  if (!landmarks || !visibleSide) return false;
  for (const name of SIDE_NAMES) {
    if (lm(landmarks, visibleSide, name).visibility < CFG.min_visibility) return false;
  }
  return true;
}

function torsoLength(landmarks, side) {
  const sh = lm(landmarks, side, 'shoulder');
  const hip = lm(landmarks, side, 'hip');
  return Math.max(Math.hypot(sh.x - hip.x, sh.y - hip.y), 1e-6);
}

function footLandmark(landmarks, side) {
  const knee = lm(landmarks, side, 'knee');
  const ankle = lm(landmarks, side, 'ankle');
  return knee.visibility >= CFG.min_visibility ? knee : ankle;
}

function hipLineMetrics(landmarks, side) {
  const sh = lm(landmarks, side, 'shoulder');
  const hip = lm(landmarks, side, 'hip');
  const foot = footLandmark(landmarks, side);
  const torso = torsoLength(landmarks, side);
  const ax = sh.x;
  const ay = sh.y;
  const bx = foot.x;
  const by = foot.y;
  const px = hip.x;
  const py = hip.y;
  const segLen = Math.max(Math.hypot(bx - ax, by - ay), 1e-6);
  const signed = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / segLen;
  const signedRatio = signed / torso;
  const absRatio = Math.abs(signedRatio);
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (segLen * segLen)));
  const closest = { x: ax + t * (bx - ax), y: ay + t * (by - ay) };
  return { signedRatio, absRatio, torso, sh, hip, foot, closest };
}

function torsoAngle(landmarks, side) {
  const sh = lm(landmarks, side, 'shoulder');
  const hip = lm(landmarks, side, 'hip');
  const foot = footLandmark(landmarks, side);
  return calculateElbowAngle(sh, hip, foot);
}

export function checkBackStraight(landmarks, visibleSide) {
  const angle = torsoAngle(landmarks, visibleSide);
  const { signedRatio: signedDev, absRatio: dev } = hipLineMetrics(landmarks, visibleSide);
  const lo = CFG.back_straight_target_deg - CFG.back_straight_tol_deg;
  const hi = CFG.back_straight_target_deg + CFG.back_straight_tol_deg;
  const devOk = dev <= CFG.back_hip_dev_ratio_max;
  const angleOk = lo <= angle && angle <= hi;
  const inBand = angleOk && devOk;
  const cueKeys = [];
  const devViolation = dev > CFG.back_hip_dev_ratio_max;
  if (angle < CFG.back_sag_threshold_deg || (devViolation && signedDev > 0)) {
    cueKeys.push('back_sagging');
  } else if (angle > CFG.back_pike_threshold_deg || (devViolation && signedDev <= 0)) {
    cueKeys.push('back_piking');
  }
  const span = hi - lo;
  const margin = span * (1.0 - CFG.back_near_limit_fraction) * 0.5;
  const nearDev = dev >= CFG.back_hip_dev_ratio_max * CFG.back_near_limit_fraction;
  const near = inBand && (angle <= lo + margin || angle >= hi - margin || nearDev);
  if (cueKeys.length) {
    const label = cueKeys.includes('back_sagging') ? 'BACK SAGGING' : 'BACK PIKING';
    return { ok: false, near: false, cueKeys, label, colorKey: 'red', angle, dev, signedDev };
  }
  if (!inBand) {
    const nearEdge = angle < lo || angle > hi || nearDev;
    return { ok: false, near: nearEdge, cueKeys: [], label: 'BACK NOT STRAIGHT', colorKey: 'yellow', angle, dev, signedDev };
  }
  return { ok: true, near, cueKeys: [], label: 'Back: OK', colorKey: 'green', angle, dev, signedDev };
}

function tooDeepLineY(landmarks, visibleSide) {
  const el = lm(landmarks, visibleSide, 'elbow');
  const wr = lm(landmarks, visibleSide, 'wrist');
  return el.y + (wr.y - el.y) * CFG.shoulder_deep_line_ratio;
}

export function checkShoulderLineTooDeep(landmarks, visibleSide, pushupState) {
  if (pushupState !== 'DOWN') return { ok: true, near: false, cueKeys: [], shY: 0, lineY: 0 };
  const sh = lm(landmarks, visibleSide, 'shoulder');
  const lineY = tooDeepLineY(landmarks, visibleSide);
  const touching = sh.y >= lineY - CFG.shoulder_deep_touch_ratio;
  const near = sh.y >= lineY - CFG.shoulder_deep_touch_ratio - 0.01;
  if (touching) return { ok: false, near: false, cueKeys: ['pushup_shoulder_deep'], shY: sh.y, lineY };
  return { ok: true, near, cueKeys: [], shY: sh.y, lineY };
}

export function checkPushUpDepth(elbowAngle, pushupState, landmarks, visibleSide) {
  if (pushupState !== 'DOWN') return { ok: true, near: false, cueKeys: [], label: 'GOOD FORM', colorKey: 'green' };
  const tooDeepAngle = elbowAngle < CFG.depth_too_deep_threshold;
  const inRange = CFG.depth_target_min <= elbowAngle && elbowAngle <= CFG.depth_target_max;
  let shoulderTouching = false;
  let shoulderNear = false;
  const shoulderCues = [];
  if (landmarks != null && visibleSide) {
    const sh = checkShoulderLineTooDeep(landmarks, visibleSide, pushupState);
    shoulderTouching = !sh.ok;
    shoulderNear = sh.near;
    shoulderCues.push(...sh.cueKeys);
  }
  const tooDeep = tooDeepAngle || shoulderTouching;
  const cues = tooDeepAngle ? ['pushup_too_deep'] : [];
  cues.push(...shoulderCues);
  if (tooDeep) return { ok: false, near: false, cueKeys: cues, label: 'TOO DEEP', colorKey: 'red' };
  if (inRange && !shoulderNear) return { ok: true, near: false, cueKeys: [], label: 'GOOD FORM', colorKey: 'green' };
  if (elbowAngle > CFG.depth_target_max) return { ok: false, near: true, cueKeys: ['pushup_not_deep_enough'], label: 'NOT DEEP ENOUGH', colorKey: 'yellow' };
  const near = elbowAngle < CFG.depth_target_min || shoulderNear;
  return { ok: true, near, cueKeys: [], label: 'GOOD FORM', colorKey: near ? 'yellow' : 'green' };
}

export function checkFullExtension(elbowAngle, pushupState) {
  if (pushupState !== 'UP') return { ok: true, near: false, cueKeys: [], label: 'Extension: OK', colorKey: 'green' };
  const ok = elbowAngle >= CFG.full_extension_min_deg;
  const nearLo = CFG.full_extension_min_deg - CFG.partial_extension_tol_deg;
  const near = ok && elbowAngle < CFG.full_extension_min_deg + CFG.partial_extension_tol_deg;
  if (!ok) {
    return { ok: false, near: elbowAngle >= nearLo, cueKeys: ['pushup_partial_extension'], label: 'PARTIAL REP', colorKey: 'red' };
  }
  return { ok: true, near, cueKeys: [], label: 'Extension: OK', colorKey: 'green' };
}

export function checkHandPlacement(landmarks, visibleSide) {
  const sh = lm(landmarks, visibleSide, 'shoulder');
  const wr = lm(landmarks, visibleSide, 'wrist');
  const torso = torsoLength(landmarks, visibleSide);
  let forward = (wr.x - sh.x) / torso;
  if (visibleSide === 'right') forward = -forward;
  const low = (wr.y - sh.y) / torso;
  const cueKeys = [];
  if (forward > CFG.hand_forward_ratio_max) cueKeys.push('hand_too_forward');
  if (low > CFG.hand_low_ratio_max) cueKeys.push('hand_too_low');
  const ok = cueKeys.length === 0;
  const near =
    forward > CFG.hand_forward_ratio_max * CFG.near_limit_fraction ||
    low > CFG.hand_low_ratio_max * CFG.near_limit_fraction;
  const label = ok ? 'Hand: OK' : 'HAND PLACEMENT';
  return { ok, near: near && ok, cueKeys, label, colorKey: ok ? (near ? 'yellow' : 'green') : 'red' };
}

export function evaluateSidePushUpPosture(landmarks, elbowAngle, pushupState, visibleSide) {
  const back = checkBackStraight(landmarks, visibleSide);
  const depth = checkPushUpDepth(elbowAngle, pushupState, landmarks, visibleSide);
  const ext = checkFullExtension(elbowAngle, pushupState);
  const hand = checkHandPlacement(landmarks, visibleSide);
  const allCues = [...back.cueKeys, ...depth.cueKeys, ...ext.cueKeys, ...hand.cueKeys];

  let primaryMessage;
  let primaryColorKey;
  if (!back.ok) {
    primaryMessage = back.label;
    primaryColorKey = back.colorKey;
  } else if (!depth.ok) {
    primaryMessage = depth.label;
    primaryColorKey = depth.colorKey;
  } else if (!ext.ok) {
    primaryMessage = ext.label;
    primaryColorKey = ext.colorKey;
  } else if (!hand.ok) {
    primaryMessage = hand.label;
    primaryColorKey = hand.colorKey;
  } else {
    primaryMessage = 'GOOD FORM';
    primaryColorKey = 'green';
  }

  const anyBad = allCues.length > 0;
  const anyNear = back.near || depth.near || ext.near || hand.near;
  const skeletonColorKey = anyBad ? 'red' : anyNear ? 'yellow' : 'green';

  return {
    primaryMessage,
    primaryColorKey,
    cueKeys: allCues,
    skeletonColorKey,
    backOk: back.ok,
    depthOk: depth.ok,
    extensionOk: ext.ok,
    handOk: hand.ok,
    backAngle: back.angle,
    hipDevRatio: back.dev,
    signedHipDev: back.signedDev,
  };
}

export class SidePushUpRepTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this.state = 'UP';
    this.visibleSide = 'left';
    this._smoothAngle = 0;
    this._angleBuffer = [];
    this._lastCountT = -999;
  }

  get smoothAngle() {
    return this._smoothAngle;
  }

  justCounted() {
    return nowSec() - this._lastCountT < 1.0;
  }

  _pushAngle(v) {
    this._angleBuffer.push(v);
    if (this._angleBuffer.length > 5) this._angleBuffer.shift();
  }

  updateAngle(landmarks) {
    this.visibleSide = detectVisibleSide(landmarks);
    const sh = lm(landmarks, this.visibleSide, 'shoulder');
    const el = lm(landmarks, this.visibleSide, 'elbow');
    const wr = lm(landmarks, this.visibleSide, 'wrist');
    const raw = calculateElbowAngle(sh, el, wr);
    this._pushAngle(raw);
    this._smoothAngle = this._angleBuffer.reduce((a, b) => a + b, 0) / this._angleBuffer.length;
    return this._smoothAngle;
  }

  detectAndCount(angle) {
    if (!Number.isFinite(angle) || angle < 1) return false;
    const prevState = this.state;
    if (this.state === 'UP' && angle < SIDE_PUSHUP_DOWN_THRESHOLD) this.state = 'DOWN';
    if (this.state === 'DOWN' && angle > SIDE_PUSHUP_UP_THRESHOLD) this.state = 'UP';
    if (prevState === 'DOWN' && this.state === 'UP') {
      this.count++;
      this._lastCountT = nowSec();
      return true;
    }
    return false;
  }
}

export function getHipLineMetrics(landmarks, visibleSide) {
  return hipLineMetrics(landmarks, visibleSide);
}

export function getTooDeepLineY(landmarks, visibleSide) {
  return tooDeepLineY(landmarks, visibleSide);
}

export function getSideLm(landmarks, visibleSide, name) {
  return lm(landmarks, visibleSide, name);
}

export { SIDE_LM };
