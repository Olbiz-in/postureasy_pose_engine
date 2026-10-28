// Side push-up overlays: back reference line, too-deep shoulder line, depth bar,
// and live elbow-angle / phase readout so counting thresholds are visible.

import { getPushUpDepthBand } from '../../core/trackingSettings';
import { nowSec } from '../../core/landmarks';
import { SIDE_PUSHUP_CFG as CFG } from './config';
import {
  detectVisibleSide,
  getHipLineMetrics,
  getTooDeepLineY,
  getSideLm,
  sidePushupPostureLandmarksVisible,
} from './SidePushUpRepTracker';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function blinkRedYellow() {
  return Math.floor(nowSec() * 4) % 2 === 0 ? 'rgb(255,0,0)' : 'rgb(120,0,0)';
}

function angleToBarY(angleDeg, barTop, barBot) {
  const lo = 40;
  const hi = 180;
  const t = clamp((angleDeg - lo) / (hi - lo), 0, 1);
  return Math.round(barBot - t * (barBot - barTop));
}

function drawDepthBar(ctx, elbowAngle, pushupState, w, h) {
  const band = getPushUpDepthBand();
  const barW = 22;
  const margin = 14;
  const x1 = w - margin;
  const x0 = x1 - barW;
  const y0 = Math.round(h * 0.22);
  const y1 = Math.round(h * 0.78);

  ctx.save();
  ctx.fillStyle = 'rgb(40,40,40)';
  ctx.fillRect(x0 - 2, y0 - 2, barW + 4, y1 - y0 + 4);

  const tooY = angleToBarY(band.tooDeep, y0, y1);
  const minY = angleToBarY(band.min, y0, y1);
  const maxY = angleToBarY(band.max, y0, y1);
  const downY = angleToBarY(CFG.down_threshold, y0, y1);
  const upY = angleToBarY(CFG.up_threshold, y0, y1);

  ctx.fillStyle = 'rgb(0,0,180)';
  ctx.fillRect(x0, tooY, barW, y1 - tooY);
  ctx.fillStyle = 'rgb(0,140,0)';
  ctx.fillRect(x0, Math.min(minY, maxY), barW, Math.abs(maxY - minY));

  const tooDeepActive = pushupState === 'DOWN' && elbowAngle > 0 && elbowAngle < band.tooDeep;
  ctx.strokeStyle = tooDeepActive ? blinkRedYellow() : 'rgb(0,60,200)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0 - 6, tooY);
  ctx.lineTo(x1 + 6, tooY);
  ctx.stroke();

  ctx.strokeStyle = 'rgb(0,200,255)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 - 4, minY);
  ctx.lineTo(x1 + 4, minY);
  ctx.moveTo(x0 - 4, maxY);
  ctx.lineTo(x1 + 4, maxY);
  ctx.stroke();

  // Count gates (amber) — distinct from the green form-depth band
  ctx.strokeStyle = 'rgb(245,158,11)';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x0 - 4, downY);
  ctx.lineTo(x1 + 4, downY);
  ctx.moveTo(x0 - 4, upY);
  ctx.lineTo(x1 + 4, upY);
  ctx.stroke();
  ctx.setLineDash([]);

  if (elbowAngle > 0) {
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

function drawHud(ctx, elbowAngle, pushupState, w) {
  const band = getPushUpDepthBand();
  const phase = pushupState === 'DOWN' ? 'DOWN' : 'UP';
  const angleTxt = elbowAngle > 0 ? `${Math.round(elbowAngle)}°` : '—';
  const lines = [
    `Elbow ${angleTxt}  ·  ${phase}`,
    `Count: ↓ below ${Math.round(CFG.down_threshold)}° → ↑ above ${Math.round(CFG.up_threshold)}°`,
    `Form depth: ${Math.round(band.min)}–${Math.round(band.max)}°`,
  ];
  ctx.save();
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(10, 10, 288, 54);
  ctx.fillStyle = pushupState === 'DOWN' ? 'rgb(125,211,252)' : 'rgb(167,243,208)';
  ctx.fillText(lines[0], 18, 28);
  ctx.fillStyle = 'rgb(230,230,230)';
  ctx.fillText(lines[1], 18, 46);
  ctx.fillText(lines[2], 18, 62);
  ctx.restore();
  void w;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} landmarks
 * @param {{ width: number, height: number }} frame
 * @param {{ state?: string, elbowAngle?: number, visibleSide?: string }} meta
 */
export function drawSidePushUpGuides(ctx, landmarks, frame, meta = {}) {
  if (!landmarks) return;
  const w = frame.width;
  const h = frame.height;
  const side = meta.visibleSide || detectVisibleSide(landmarks);
  const elbowAngle = Number(meta.elbowAngle) || 0;
  const pushupState = meta.state === 'DOWN' ? 'DOWN' : 'UP';

  drawDepthBar(ctx, elbowAngle, pushupState, w, h);
  drawHud(ctx, elbowAngle, pushupState, w);

  if (!sidePushupPostureLandmarksVisible(landmarks, side)) return;

  const sh = getSideLm(landmarks, side, 'shoulder');
  const { hip, foot } = getHipLineMetrics(landmarks, side);
  ctx.save();
  ctx.strokeStyle = 'rgba(120,200,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sh.x * w, sh.y * h);
  ctx.lineTo(hip.x * w, hip.y * h);
  ctx.lineTo(foot.x * w, foot.y * h);
  ctx.stroke();

  if (pushupState === 'DOWN') {
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
}
