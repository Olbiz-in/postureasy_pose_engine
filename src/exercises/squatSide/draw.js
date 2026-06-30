// Side-view squat canvas overlays — torso lean tolerance + tempo gate lock.

import { CFG } from '../squat/config.js';
import { SIDE_SQUAT_CFG } from './config';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function lockSideTempoGateAtStance(squatTracker, vis, h) {
  if (squatTracker.tempoGateY !== null || !vis) return;
  const midHipYPx = vis.hip.y * h;
  const gateY = midHipYPx + CFG.tempo_gate_offset_ratio * h;
  const hystPx = CFG.tempo_gate_hysteresis_ratio * h;
  squatTracker.setTempoGate(gateY, hystPx);
}

/**
 * Draw torso lean tolerance: vertical reference at hip + max-lean boundary line.
 */
export function drawSideSquatTorsoTolerance(ctx, vis, w, h, inSquat) {
  if (!vis) return;
  const { shoulder, hip } = vis;
  const sx = shoulder.x * w;
  const sy = shoulder.y * h;
  const hx = hip.x * w;
  const hy = hip.y * h;

  const dx = hx - sx;
  const dy = hy - sy;
  const seg = Math.max(Math.hypot(dx, dy), 1e-6);
  const leanDeg = (Math.acos(Math.max(0, Math.min(1, Math.max(0, dy) / seg))) * 180) / Math.PI;
  const maxOk = SIDE_SQUAT_CFG.torso_lean_max_deg + SIDE_SQUAT_CFG.torso_lean_tolerance;
  const ok = leanDeg <= maxOk;

  const legLen = Math.max(Math.hypot(hip.x - vis.ankle.x, hip.y - vis.ankle.y) * h, 40);
  const refTop = clamp(hy - legLen * 0.55, 0, h - 1);
  const refBot = clamp(hy + legLen * 0.15, 0, h - 1);

  // Vertical reference through hip
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgb(120,200,255)';
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(hx, refTop);
  ctx.lineTo(hx, refBot);
  ctx.stroke();
  ctx.setLineDash([]);

  // Max lean boundary — rotate from vertical by maxOk degrees
  const rad = (maxOk * Math.PI) / 180;
  const bx = hx + Math.sin(rad) * legLen * 0.5;
  const by = hy - Math.cos(rad) * legLen * 0.5;
  ctx.strokeStyle = ok ? 'rgb(210,80,255)' : 'rgb(255,0,0)';
  ctx.lineWidth = ok ? 2 : 2.5;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // Live shoulder–hip line
  ctx.strokeStyle = ok ? 'rgb(0,255,0)' : 'rgb(255,80,80)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(hx, hy);
  ctx.stroke();

  ctx.fillStyle = ok ? 'rgb(210,80,255)' : 'rgb(255,100,100)';
  ctx.font = '11px monospace';
  const label = `Torso ${leanDeg.toFixed(0)}° / ${maxOk.toFixed(0)}°`;
  ctx.fillText(label, clamp(hx + 8, 8, w - 120), clamp(hy - 10, 14, h - 8));

  if (inSquat && !ok) {
    ctx.fillStyle = 'rgb(255,80,80)';
    ctx.fillText('Lean back', clamp(hx + 8, 8, w - 90), clamp(hy + 14, 20, h - 4));
  }
  ctx.restore();
}
