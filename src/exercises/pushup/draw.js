// Canvas overlays for the push-up front view: arm tolerance rails, depth guide
// and depth bar. Ported from fitness_posture pushUpDrawUtils (skeleton itself is
// drawn by the engine loop, recolored via state.skeletonColor).

import { LM, nowSec } from '../../core/landmarks';
import { PUSHUP_CFG } from './config';
import { pushupShoulderWidth, checkWristAlignment, checkElbowAlignment } from './PushUpRepTracker';

function blinkRedYellow() {
  return Math.floor(nowSec() * 4) % 2 === 0 ? 'rgb(255,0,0)' : 'rgb(120,0,0)';
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function inBand(dx, alignMax, inner, outer) {
  return -(alignMax + inner) <= dx && dx <= alignMax + outer;
}

function drawArmTolSide(ctx, shoulder, joint, handPoint, sw, dxSigned, band, ok, centerColor, connectorColor, w, h) {
  const sx = clamp(Math.round(shoulder.x * w), 0, w - 1);
  const jx = clamp(Math.round(joint.x * w), 0, w - 1);
  const jy = clamp(Math.round(joint.y * h), 0, h - 1);
  const hx = handPoint ? clamp(Math.round(handPoint.x * w), 0, w - 1) : jx;
  const hy = handPoint ? clamp(Math.round(handPoint.y * h), 0, h - 1) : jy;

  const halfLen = Math.max(4, Math.round(PUSHUP_CFG.line_half_len_ratio * h));
  const y0 = Math.max(0, jy - halfLen);
  const y1 = Math.min(h - 1, jy + halfLen);

  const xLo = clamp(Math.round(sx + band.lo * sw * w), 0, w - 1);
  const xHi = clamp(Math.round(sx + band.hi * sw * w), 0, w - 1);
  const xIdeal = clamp(Math.round(sx + band.center * sw * w), 0, w - 1);

  const loCross = dxSigned < band.lo;
  const hiCross = dxSigned > band.hi;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = loCross ? blinkRedYellow() : 'rgb(0,200,255)';
  line(ctx, xLo, y0, xLo, y1);
  ctx.strokeStyle = hiCross ? blinkRedYellow() : 'rgb(0,200,255)';
  line(ctx, xHi, y0, xHi, y1);
  ctx.lineWidth = 1;
  ctx.strokeStyle = ok ? centerColor : 'rgb(255,0,0)';
  line(ctx, xIdeal, y0, xIdeal, y1);
  ctx.strokeStyle = 'rgba(200,200,200,0.5)';
  line(ctx, sx, y0, sx, y1);
  ctx.fillStyle = ok ? centerColor : 'rgb(255,0,0)';
  ctx.beginPath();
  ctx.arc(jx, jy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = connectorColor;
  ctx.lineWidth = 2;
  line(ctx, xIdeal, jy, jx, jy);
  if (handPoint) {
    ctx.strokeStyle = 'rgb(180,170,220)';
    line(ctx, jx, jy, hx, hy);
  }
  ctx.restore();
}

export function drawPushUpToleranceLines(ctx, landmarks, w, h) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const le = landmarks[LM.LEFT_ELBOW];
  const re = landmarks[LM.RIGHT_ELBOW];
  const lw = landmarks[LM.LEFT_WRIST];
  const rw = landmarks[LM.RIGHT_WRIST];
  const li = landmarks[LM.LEFT_INDEX];
  const ri = landmarks[LM.RIGHT_INDEX];
  if (
    Math.min(ls.visibility, rs.visibility, le.visibility, re.visibility, lw.visibility, rw.visibility, li.visibility, ri.visibility) < 0.2
  ) {
    return;
  }

  const sw = pushupShoulderWidth(landmarks);
  const wrist = checkWristAlignment(landmarks, sw);
  drawArmTolSide(ctx, ls, lw, li, sw, wrist.lDx, wrist.bands.left, wrist.bands.left.ok, 'rgb(0,255,0)', 'rgb(120,180,230)', w, h);
  drawArmTolSide(ctx, rs, rw, ri, sw, wrist.rDx, wrist.bands.right, wrist.bands.right.ok, 'rgb(0,255,0)', 'rgb(120,180,230)', w, h);

  const elbow = checkElbowAlignment(landmarks, sw);
  drawArmTolSide(ctx, ls, le, lw, sw, elbow.lDx, elbow.bands.left, elbow.bands.left.ok, 'rgb(100,255,200)', 'rgb(180,170,220)', w, h);
  drawArmTolSide(ctx, rs, re, rw, sw, elbow.rDx, elbow.bands.right, elbow.bands.right.ok, 'rgb(100,255,200)', 'rgb(180,170,220)', w, h);
}

function angleToBarY(angleDeg, barTop, barBot) {
  const lo = 40;
  const hi = 180;
  const t = clamp((angleDeg - lo) / (hi - lo), 0, 1);
  return Math.round(barBot - t * (barBot - barTop));
}

export function drawPushUpDepthBar(ctx, elbowAngle, pushupState, w, h) {
  const barW = 22;
  const margin = 14;
  const x1 = w - margin;
  const x0 = x1 - barW;
  const y0 = Math.round(h * 0.22);
  const y1 = Math.round(h * 0.78);

  ctx.save();
  ctx.fillStyle = 'rgb(40,40,40)';
  ctx.fillRect(x0 - 2, y0 - 2, barW + 4, y1 - y0 + 4);

  const tooY = angleToBarY(PUSHUP_CFG.depth_too_deep_threshold, y0, y1);
  const minY = angleToBarY(PUSHUP_CFG.depth_target_min, y0, y1);
  const maxY = angleToBarY(PUSHUP_CFG.depth_target_max, y0, y1);

  ctx.fillStyle = 'rgb(0,0,180)';
  ctx.fillRect(x0, tooY, barW, y1 - tooY);
  ctx.fillStyle = 'rgb(0,140,0)';
  ctx.fillRect(x0, Math.min(minY, maxY), barW, Math.abs(maxY - minY));

  const tooDeepActive = pushupState === 'DOWN' && elbowAngle < PUSHUP_CFG.depth_too_deep_threshold;
  ctx.strokeStyle = tooDeepActive ? blinkRedYellow() : 'rgb(0,60,200)';
  ctx.lineWidth = 2;
  line(ctx, x0 - 6, tooY, x1 + 6, tooY);
  ctx.strokeStyle = 'rgb(0,200,255)';
  ctx.lineWidth = 1;
  line(ctx, x0 - 4, minY, x1 + 4, minY);
  line(ctx, x0 - 4, maxY, x1 + 4, maxY);

  if (pushupState === 'DOWN' && elbowAngle > 0) {
    const curY = angleToBarY(elbowAngle, y0, y1);
    ctx.fillStyle = 'rgb(255,255,255)';
    ctx.beginPath();
    ctx.arc((x0 + x1) / 2, curY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgb(0,220,255)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc((x0 + x1) / 2, curY, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgb(200,200,200)';
  ctx.font = '11px sans-serif';
  ctx.fillText('DEPTH', Math.max(0, x0 - 8), y0 - 10);
  ctx.restore();
}

export function drawPushUpDepthGuide(ctx, landmarks, elbowAngle, pushupState, w, h) {
  if (pushupState !== 'DOWN') {
    drawPushUpDepthBar(ctx, elbowAngle, pushupState, w, h);
    return;
  }
  const le = landmarks[LM.LEFT_ELBOW];
  const re = landmarks[LM.RIGHT_ELBOW];
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lw = landmarks[LM.LEFT_WRIST];
  const rw = landmarks[LM.RIGHT_WRIST];

  const sw = pushupShoulderWidth(landmarks);
  const eyPx = clamp(Math.round(((le.y + re.y) * 0.5) * h), 0, h - 1);
  const exPx = clamp(Math.round(((le.x + re.x) * 0.5) * w), 0, w - 1);
  const lw2 = Math.max(60, Math.round(sw * w * 1.1));
  const x0 = Math.max(0, exPx - lw2);
  const x1 = Math.min(w - 1, exPx + lw2);

  const shY = (ls.y + rs.y) * 0.5;
  const elY = (le.y + re.y) * 0.5;
  const wrY = (lw.y + rw.y) * 0.5;
  const lineY = elY + (wrY - elY) * PUSHUP_CFG.shoulder_deep_line_ratio;
  const shTooDeep = shY >= lineY - PUSHUP_CFG.shoulder_deep_touch_ratio;
  const tooDeep = elbowAngle > 0 && (elbowAngle < PUSHUP_CFG.depth_too_deep_threshold || shTooDeep);
  const inRange = elbowAngle > 0 && PUSHUP_CFG.depth_target_min <= elbowAngle && elbowAngle <= PUSHUP_CFG.depth_target_max;

  let col;
  if (tooDeep) col = blinkRedYellow();
  else if (inRange) col = 'rgb(0,255,80)';
  else col = 'rgb(0,200,255)';

  ctx.save();
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  line(ctx, x0, eyPx, x1, eyPx);
  ctx.fillStyle = col;
  ctx.font = '11px sans-serif';
  ctx.fillText(
    elbowAngle > 0
      ? `Depth ${Math.round(elbowAngle)}° (target ${Math.round(PUSHUP_CFG.depth_target_min)}-${Math.round(PUSHUP_CFG.depth_target_max)})`
      : 'Depth: measuring…',
    Math.max(0, x0),
    Math.max(16, eyPx - 8),
  );
  ctx.restore();

  drawPushUpDepthBar(ctx, elbowAngle, pushupState, w, h);
}

export { inBand };
