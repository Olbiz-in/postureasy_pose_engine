// Canvas overlay for the lying leg raise (side view).
//
// The skeleton itself (and its green/red colour) is drawn by the engine loop.
// This adds the angle guide (90° top band, 45° bottom band, the live leg line),
// red joint markers for CONFIRMED mistakes only, the setup checklist and the
// shared HUD (feedback / mistake box). Nothing mistake-related is drawn until
// the flow has confirmed the mistake in two consecutive reps.

import { LGR_CFG } from './config.js';
import { LGR_PHASE } from './LegRaiseFlow.js';
import { LGR_STATE } from './LegRaiseRepTracker.js';
import { legDirection } from './poseChecks.js';
import {
  HUD_CYAN as CYAN, HUD_GREEN as GREEN, HUD_RED as RED, HUD_WHITE as WHITE, HUD_PANEL as PANEL,
  blink, line, dot, label, fontPx, fitText, measure, screenBox, screenText,
  drawStanceChecklist, drawFeedback, drawDebugRows,
} from '../common/hud.js';

const SETUP_ROWS = [
  ['Body visible, side-on', 'visible'],
  ['Lying flat on your back', 'lying'],
  ['Legs resting on the floor', 'legsDown'],
];

const MOVEMENT_LABEL = {
  [LGR_STATE.REST]: 'READY',
  [LGR_STATE.UP]: 'LIFTING',
  [LGR_STATE.DOWN]: 'LOWERING',
};

function wedge(ctx, g, a0, a1, radius, fill) {
  const steps = 14;
  ctx.beginPath();
  ctx.moveTo(g.H.x, g.H.y);
  for (let i = 0; i <= steps; i++) {
    const d = legDirection(g, a0 + ((a1 - a0) * i) / steps);
    ctx.lineTo(g.H.x + d.x * radius, g.H.y + d.y * radius);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Target rays + tolerance wedges around the hip, and the live leg line. */
export function drawAngleGuide(ctx, fr, mirrored, h) {
  const g = fr.geometry;
  if (!g) return;
  const C = LGR_CFG;
  const R = g.legLen * 1.05;
  const size = Math.max(10, Math.round(h * 0.022));

  const topLo = C.top_target_deg - C.top_band_deg;
  const topHi = C.top_target_deg + C.top_band_deg;
  const botLo = C.bottom_target_deg - C.bottom_band_deg;
  const botHi = C.bottom_target_deg + C.bottom_band_deg;
  const th = g.theta;
  const inTop = th >= topLo && th <= topHi;
  const inBottom = th >= botLo && th <= botHi;

  ctx.save();
  wedge(ctx, g, topLo, topHi, R, inTop ? 'rgba(0,255,80,0.22)' : 'rgba(0,255,80,0.09)');
  wedge(ctx, g, botLo, botHi, R, inBottom ? 'rgba(0,200,255,0.24)' : 'rgba(0,200,255,0.09)');

  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  for (const [deg, color, text] of [
    [C.top_target_deg, GREEN, `${C.top_target_deg}°`],
    [C.bottom_target_deg, CYAN, `${C.bottom_target_deg}°`],
  ]) {
    const d = legDirection(g, deg);
    ctx.strokeStyle = color;
    line(ctx, g.H.x, g.H.y, g.H.x + d.x * R, g.H.y + d.y * R);
    label(ctx, text, g.H.x + d.x * (R + 6), g.H.y + d.y * (R + 6), mirrored, color, { size });
  }
  ctx.setLineDash([]);

  // Floor line (0°) along the torso.
  ctx.strokeStyle = 'rgba(200,200,200,0.5)';
  ctx.lineWidth = 1;
  line(ctx, g.H.x, g.H.y, g.H.x + g.along.x * R, g.H.y + g.along.y * R);

  // Live leg line + current angle.
  ctx.lineWidth = 4;
  ctx.strokeStyle = inTop ? GREEN : inBottom ? CYAN : WHITE;
  line(ctx, g.H.x, g.H.y, g.A.x, g.A.y);
  dot(ctx, g.A.x, g.A.y, 6, inTop ? GREEN : inBottom ? CYAN : WHITE);
  label(ctx, `${Math.round(th)}°`, g.H.x + g.up.x * 18 + g.along.x * 18, g.H.y + g.up.y * 18 + g.along.y * 18, mirrored, WHITE, { size: size + 3 });
  ctx.restore();
}

/** Red markers on the joints of confirmed (repeated) mistakes only. */
export function drawFaultMarkers(ctx, fr) {
  const g = fr.geometry;
  if (!g || !fr.redJoints?.length) return;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = blink();
  for (const name of fr.redJoints) {
    const p = g[name];
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.stroke();
    dot(ctx, p.x, p.y, 6, RED);
  }
  ctx.restore();
}

function drawRepPanel(ctx, fr, w, h, mirrored) {
  const text = `Rep ${fr.repCount} · ${MOVEMENT_LABEL[fr.movement] || ''}`;
  const size = fitText(ctx, text, fontPx(h, 1.05, w), 800, w - 2 * 14 - 20).size;
  const tw = measure(ctx, text, size, 800);
  const sx = w - 14 - tw - 20;
  screenBox(ctx, sx, 12, tw + 20, size + 14, w, mirrored, PANEL);
  screenText(ctx, text, sx + 10, 12 + size + 4, w, mirrored, WHITE, { size, weight: 800 });
}

function drawDebugReadout(ctx, fr, w, h, mirrored) {
  const g = fr.geometry;
  const f = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));
  drawDebugRows(ctx, [
    `${fr.phase.replace('lgr_', '')} ${fr.movement}  theta ${f(g?.theta)}°  knee ${f(g?.kneeAngle)}°`,
    `tilt ${f(g?.tilt)}° Δ ${f(g?.tiltDelta)}°  len ${f(g?.lengthRatio)}`,
    `peak ${f(fr.peakDeg)}°  top ≥ ${LGR_CFG.top_min_deg}  bottom ≤ ${LGR_CFG.bottom_max_deg}  too low < ${LGR_CFG.too_low_deg}`,
  ], w, h, mirrored);
}

/** Full overlay for one frame (the skeleton is drawn by the engine loop). */
export function drawLegRaiseOverlay(ctx, fr, frame) {
  if (!fr) return;
  const { width: w, height: h } = frame;
  const mirrored = frame.mirrored !== false;

  if (fr.phase === LGR_PHASE.SETUP) {
    drawStanceChecklist(ctx, fr, w, h, mirrored, { rows: SETUP_ROWS });
  } else {
    drawAngleGuide(ctx, fr, mirrored, h);
    drawFaultMarkers(ctx, fr);
    drawRepPanel(ctx, fr, w, h, mirrored);
  }
  drawFeedback(ctx, fr, w, h, mirrored);
  if (LGR_CFG.debug) drawDebugReadout(ctx, fr, w, h, mirrored);
}
