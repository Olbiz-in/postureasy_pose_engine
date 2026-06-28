// Push-up rep counting, state machine, and posture evaluation (front view).
// Faithful port of the fitness_posture pushUpTracker — works directly in
// MediaPipe normalized coordinates.

import { LM, nowSec } from '../../core/landmarks';
import {
  PUSHUP_CFG,
  PUSHUP_DOWN_THRESHOLD,
  PUSHUP_UP_THRESHOLD,
  PUSHUP_MIN_VIS,
  PUSHUP_REQUIRED_LM_INDICES,
  PUSHUP_POSTURE_LM_INDICES,
} from './config';
import {
  evalWristAlignmentBands,
  evalElbowAlignmentBands,
  wristCueKey,
  elbowCueKey,
  isNearWristBand,
} from './alignBands';

export function calculateElbowAngle(shoulder, elbow, wrist) {
  const radians =
    Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x) -
    Math.atan2(shoulder.y - elbow.y, shoulder.x - elbow.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

export function pushupShoulderWidth(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  return Math.max(Math.abs(ls.x - rs.x), 1e-6);
}

export function pushupLandmarksVisible(landmarks) {
  if (!landmarks) return false;
  for (const idx of PUSHUP_REQUIRED_LM_INDICES) {
    if ((landmarks[idx]?.visibility ?? 0) < PUSHUP_MIN_VIS) return false;
  }
  return true;
}

export function pushupPostureLandmarksVisible(landmarks) {
  if (!landmarks) return false;
  for (const idx of PUSHUP_POSTURE_LM_INDICES) {
    if ((landmarks[idx]?.visibility ?? 0) < PUSHUP_CFG.min_visibility) return false;
  }
  return true;
}

function inBand(dx, alignMax, inner, outer) {
  return -(alignMax + inner) <= dx && dx <= alignMax + outer;
}

function nearBand(dx, alignMax, inner, outer) {
  const lo = -(alignMax + inner);
  const hi = alignMax + outer;
  if (!(lo <= dx && dx <= hi)) return false;
  const span = hi - lo;
  const margin = span * (1.0 - PUSHUP_CFG.near_limit_fraction) * 0.5;
  return dx <= lo + margin || dx >= hi - margin;
}

function sideDx(point, shoulder, sw) {
  return (point.x - shoulder.x) / sw;
}

export function checkWristAlignment(landmarks, sw) {
  if (sw == null) sw = pushupShoulderWidth(landmarks);
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lw = landmarks[LM.LEFT_WRIST];
  const rw = landmarks[LM.RIGHT_WRIST];
  const lDx = sideDx(lw, ls, sw);
  const rDx = sideDx(rw, rs, sw);
  const bands = evalWristAlignmentBands(lDx, rDx);
  const cueKeys = [];
  if (!bands.left.ok && bands.left.cueKey) cueKeys.push(wristCueKey('left', bands.left.cueKey));
  if (!bands.right.ok && bands.right.cueKey) cueKeys.push(wristCueKey('right', bands.right.cueKey));
  return { ok: bands.left.ok && bands.right.ok, near: isNearWristBand(lDx, rDx), lDx, rDx, cueKeys, bands };
}

export function checkElbowAlignment(landmarks, sw) {
  if (sw == null) sw = pushupShoulderWidth(landmarks);
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const le = landmarks[LM.LEFT_ELBOW];
  const re = landmarks[LM.RIGHT_ELBOW];
  const lDx = sideDx(le, ls, sw);
  const rDx = sideDx(re, rs, sw);
  const bands = evalElbowAlignmentBands(lDx, rDx);
  const cueKeys = [];
  if (!bands.left.ok && bands.left.cueKey) cueKeys.push(elbowCueKey('left', bands.left.cueKey));
  if (!bands.right.ok && bands.right.cueKey) cueKeys.push(elbowCueKey('right', bands.right.cueKey));
  return { ok: bands.left.ok && bands.right.ok, lDx, rDx, cueKeys, bands };
}

export function checkWristElbowCollinearity(landmarks, sw) {
  if (sw == null) sw = pushupShoulderWidth(landmarks);
  const le = landmarks[LM.LEFT_ELBOW];
  const re = landmarks[LM.RIGHT_ELBOW];
  const lw = landmarks[LM.LEFT_WRIST];
  const rw = landmarks[LM.RIGHT_WRIST];
  const lDev = Math.abs(lw.x - le.x) / sw;
  const rDev = Math.abs(rw.x - re.x) / sw;
  const tol = PUSHUP_CFG.wrist_elbow_collinear_ratio_max;
  const lOk = lDev <= tol;
  const rOk = rDev <= tol;
  const cueKeys = [];
  if (!lOk) cueKeys.push('forearm_left');
  if (!rOk) cueKeys.push('forearm_right');
  const nearMargin = tol * (1.0 - PUSHUP_CFG.near_limit_fraction);
  const near = (lOk && lDev >= tol - nearMargin) || (rOk && rDev >= tol - nearMargin);
  return { ok: lOk && rOk, near, lDev, rDev, cueKeys };
}

export function checkHandOrientation(landmarks, sw) {
  if (sw == null) sw = pushupShoulderWidth(landmarks);
  const lw = landmarks[LM.LEFT_WRIST];
  const rw = landmarks[LM.RIGHT_WRIST];
  const li = landmarks[LM.LEFT_INDEX];
  const ri = landmarks[LM.RIGHT_INDEX];
  const lRot = (li.x - lw.x) / sw;
  const rRot = (ri.x - rw.x) / sw;
  const lIn = PUSHUP_CFG.hand_rotation_ratio_max + PUSHUP_CFG.hand_left_inner_offset_ratio;
  const rIn = PUSHUP_CFG.hand_rotation_ratio_max + PUSHUP_CFG.hand_right_inner_offset_ratio;
  const lOk = inBand(lRot, PUSHUP_CFG.hand_rotation_ratio_max, PUSHUP_CFG.hand_left_inner_offset_ratio, PUSHUP_CFG.hand_left_outer_offset_ratio);
  const rOk = inBand(rRot, PUSHUP_CFG.hand_rotation_ratio_max, PUSHUP_CFG.hand_right_inner_offset_ratio, PUSHUP_CFG.hand_right_outer_offset_ratio);
  const cueKeys = [];
  if (!lOk) cueKeys.push(lRot < -lIn ? 'hand_left_inner' : 'hand_left_outer');
  if (!rOk) cueKeys.push(rRot < -rIn ? 'hand_right_outer' : 'hand_right_inner');
  const near =
    nearBand(lRot, PUSHUP_CFG.hand_rotation_ratio_max, PUSHUP_CFG.hand_left_inner_offset_ratio, PUSHUP_CFG.hand_left_outer_offset_ratio) ||
    nearBand(rRot, PUSHUP_CFG.hand_rotation_ratio_max, PUSHUP_CFG.hand_right_inner_offset_ratio, PUSHUP_CFG.hand_right_outer_offset_ratio);
  return { ok: lOk && rOk, near, lRot, rRot, cueKeys };
}

export function checkShoulderLineTooDeep(landmarks, pushupState) {
  if (pushupState !== 'DOWN') return { ok: true, near: false, cueKeys: [], shY: 0, lineY: 0 };
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const le = landmarks[LM.LEFT_ELBOW];
  const re = landmarks[LM.RIGHT_ELBOW];
  const lw = landmarks[LM.LEFT_WRIST];
  const rw = landmarks[LM.RIGHT_WRIST];
  const shY = (ls.y + rs.y) * 0.5;
  const elY = (le.y + re.y) * 0.5;
  const wrY = (lw.y + rw.y) * 0.5;
  const lineY = elY + (wrY - elY) * PUSHUP_CFG.shoulder_deep_line_ratio;
  const touching = shY >= lineY - PUSHUP_CFG.shoulder_deep_touch_ratio;
  const near = shY >= lineY - PUSHUP_CFG.shoulder_deep_touch_ratio - 0.01;
  if (touching) return { ok: false, near: false, cueKeys: ['pushup_shoulder_deep'], shY, lineY };
  return { ok: true, near, cueKeys: [], shY, lineY };
}

export function checkPushUpDepth(elbowAngle, pushupState, landmarks) {
  if (pushupState !== 'DOWN') return { ok: true, near: false, cueKeys: [], label: 'GOOD FORM', colorKey: 'green' };
  const tooDeepAngle = elbowAngle < PUSHUP_CFG.depth_too_deep_threshold;
  const inRange = PUSHUP_CFG.depth_target_min <= elbowAngle && elbowAngle <= PUSHUP_CFG.depth_target_max;
  let shoulderTouching = false;
  let shoulderNear = false;
  const shoulderCues = [];
  if (landmarks != null) {
    const sh = checkShoulderLineTooDeep(landmarks, pushupState);
    shoulderTouching = !sh.ok;
    shoulderNear = sh.near;
    shoulderCues.push(...sh.cueKeys);
  }
  const tooDeep = tooDeepAngle || shoulderTouching;
  const cues = tooDeepAngle ? ['pushup_too_deep'] : [];
  cues.push(...shoulderCues);
  if (tooDeep) return { ok: false, near: false, cueKeys: cues, label: 'TOO DEEP', colorKey: 'red' };
  if (inRange && !shoulderNear) return { ok: true, near: false, cueKeys: [], label: 'GOOD FORM', colorKey: 'green' };
  if (elbowAngle > PUSHUP_CFG.depth_target_max) return { ok: true, near: true, cueKeys: [], label: 'GOOD FORM', colorKey: 'yellow' };
  const near = elbowAngle < PUSHUP_CFG.depth_target_min || shoulderNear;
  return { ok: true, near, cueKeys: [], label: 'GOOD FORM', colorKey: near ? 'yellow' : 'green' };
}

export function evaluatePushUpPosture(landmarks, elbowAngle, pushupState) {
  const sw = pushupShoulderWidth(landmarks);
  const wrist = checkWristAlignment(landmarks, sw);
  const elbow = checkElbowAlignment(landmarks, sw);
  const forearm = checkWristElbowCollinearity(landmarks, sw);
  const hand = checkHandOrientation(landmarks, sw);
  const depth = checkPushUpDepth(elbowAngle, pushupState, landmarks);

  const allCues = [...wrist.cueKeys, ...elbow.cueKeys, ...forearm.cueKeys, ...hand.cueKeys, ...depth.cueKeys];

  let primaryMessage;
  let primaryColorKey;
  if (!depth.ok) {
    primaryMessage = 'TOO DEEP';
    primaryColorKey = 'red';
  } else if (!hand.ok) {
    primaryMessage = 'HAND ROTATED';
    primaryColorKey = 'red';
  } else if (!wrist.ok || !elbow.ok || !forearm.ok) {
    primaryMessage = 'ELBOW MISALIGNED';
    primaryColorKey = 'red';
  } else {
    primaryMessage = 'GOOD FORM';
    primaryColorKey = 'green';
  }

  const anyBad = allCues.length > 0;
  const anyNear = wrist.near || forearm.near || hand.near || depth.near;
  const skeletonColorKey = anyBad ? 'red' : anyNear ? 'yellow' : 'green';

  return {
    primaryMessage,
    primaryColorKey,
    cueKeys: allCues,
    skeletonColorKey,
    wristOk: wrist.ok,
    elbowOk: elbow.ok,
    forearmOk: forearm.ok,
    handOk: hand.ok,
    depthOk: depth.ok,
  };
}

export class PushUpRepTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this.state = 'UP'; // 'UP' | 'DOWN'
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
    const ls = landmarks[LM.LEFT_SHOULDER];
    const le = landmarks[LM.LEFT_ELBOW];
    const lw = landmarks[LM.LEFT_WRIST];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const re = landmarks[LM.RIGHT_ELBOW];
    const rw = landmarks[LM.RIGHT_WRIST];
    const leftAngle = calculateElbowAngle(ls, le, lw);
    const rightAngle = calculateElbowAngle(rs, re, rw);
    this._pushAngle((leftAngle + rightAngle) / 2);
    this._smoothAngle = this._angleBuffer.reduce((a, b) => a + b, 0) / this._angleBuffer.length;
    return this._smoothAngle;
  }

  /** @returns {boolean} true on the frame a rep just completed (DOWN→UP). */
  detectAndCount(angle) {
    if (!Number.isFinite(angle) || angle < 1) return false;
    const prevState = this.state;
    if (this.state === 'UP' && angle < PUSHUP_DOWN_THRESHOLD) this.state = 'DOWN';
    if (this.state === 'DOWN' && angle > PUSHUP_UP_THRESHOLD) this.state = 'UP';
    if (prevState === 'DOWN' && this.state === 'UP') {
      this.count++;
      this._lastCountT = nowSec();
      return true;
    }
    return false;
  }
}
