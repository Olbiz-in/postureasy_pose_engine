// Canvas overlay helpers. Pure drawing — no exercise logic lives here.

import { POSE_CONNECTIONS } from './poseLandmarker';

/**
 * Draw the pose skeleton (bones + joints) onto a 2D canvas context.
 * Landmarks are normalized (0..1); `width`/`height` are the canvas pixel size.
 */
export function drawSkeleton(ctx, landmarks, { width, height, color = '#22d3a6', jointColor = '#ffffff', lineWidth = 4, minVisibility = 0.5 } = {}) {
  if (!landmarks || !landmarks.length) return;

  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;

  for (const connection of POSE_CONNECTIONS) {
    const a = landmarks[connection.start];
    const b = landmarks[connection.end];
    if (!a || !b) continue;
    if ((a.visibility ?? 1) < minVisibility || (b.visibility ?? 1) < minVisibility) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
    ctx.stroke();
  }

  ctx.fillStyle = jointColor;
  const r = Math.max(3, lineWidth);
  for (const lm of landmarks) {
    if ((lm.visibility ?? 1) < minVisibility) continue;
    ctx.beginPath();
    ctx.arc(lm.x * width, lm.y * height, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Draw a horizontal reference line at a normalized y (e.g. depth target). */
export function drawHLine(ctx, yNorm, { width, height, color = 'rgba(255,255,255,0.6)', dash = [10, 8], label } = {}) {
  const y = yNorm * height;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
  if (label) {
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(label, 12, y - 6);
  }
  ctx.restore();
}
