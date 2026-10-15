// Canvas overlay for the lunge (front + side view).
//
// The skeleton itself (and its green/red colour) is drawn by the engine loop;
// this adds the depth guide, red joint markers for active faults, the setup
// checklist and the shared HUD (feedback / mistake box / counters).

import { LM } from '../../core/landmarks.js';
import { LUNGE_CFG } from './config.js';
import { LUNGE_PHASE } from './LungeFlow.js';
import { LUNGE_STATE } from './LungeRepTracker.js';
import { torsoLeanDeg, shinTiltDeg } from './poseChecks.js';
import {
  HUD_CYAN as CYAN, HUD_GREEN as GREEN, HUD_RED as RED, HUD_AMBER as AMBER,
  HUD_GREY as GREY, HUD_WHITE as WHITE, HUD_PANEL as PANEL,
  blink, line, dot, label, fontPx, fitText, measure, screenBox, screenText,
  drawStanceChecklist, drawFeedback, drawDebugRows,
} from '../common/hud.js';

const SETUP_ROWS = [
  ['Full body visible', 'visible'],
  ['Correct camera view', 'view'],
  ['Standing upright', 'upright'],
];

const MOVEMENT_LABEL = {
  [LUNGE_STATE.STANDING]: 'STANDING',
  [LUNGE_STATE.DESCENDING]: 'DESCENDING',
  [LUNGE_STATE.BOTTOM]: 'BOTTOM',
  [LUNGE_STATE.ASCENDING]: 'ASCENDING',
};

/** Pixel position of a MediaPipe landmark index from the geometry snapshot. */
function jointPoint(g, index) {
  switch (index) {
    case LM.LEFT_SHOULDER: return g.ls;
    case LM.RIGHT_SHOULDER: return g.rs;
    case LM.LEFT_HIP: return g.lh;
    case LM.RIGHT_HIP: return g.rh;
    case LM.LEFT_KNEE: return g.legs.left.knee;
    case LM.RIGHT_KNEE: return g.legs.right.knee;
    case LM.LEFT_ANKLE: return g.legs.left.ankle;
    case LM.RIGHT_ANKLE: return g.legs.right.ankle;
    default: return null;
  }
}

/** Depth guide: minimum (counts) and target hip heights for this person. */
export function drawDepthGuide(ctx, fr, mirrored, h) {
  const g = fr.geometry;
  const calib = fr.calib;
  if (!g || !calib || !g.refAnkle || !g.refHip) return;
  const C = LUNGE_CFG;
  const yAt = (depth) => g.refAnkle.y - calib.standH * (1 - depth);
  const yCount = yAt(C.depth_count);
  const yTarget = yAt(C.depth_target);
  const x0 = g.refHip.x - 0.7 * g.norm;
  const x1 = g.refHip.x + 0.7 * g.norm;
  const labelX = mirrored ? x1 : x0;
  const size = Math.max(10, Math.round(h * 0.02));
  const hipY = g.refHip.y;
  const reached = hipY >= yTarget ? GREEN : hipY >= yCount ? AMBER : CYAN;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.strokeStyle = 'rgba(255,190,0,0.9)';
  line(ctx, x0, yCount, x1, yCount);
  label(ctx, 'MIN DEPTH', labelX, yCount - 4, mirrored, AMBER, { size: size - 1 });
  ctx.strokeStyle = 'rgba(0,255,80,0.9)';
  line(ctx, x0, yTarget, x1, yTarget);
  label(ctx, 'TARGET', labelX, yTarget - 4, mirrored, GREEN, { size: size - 1 });
  ctx.setLineDash([]);
  dot(ctx, g.refHip.x, hipY, 7, reached);
  ctx.restore();
}

/**
 * Tolerance wedge around a reference direction from `origin`: the allowed zone
 * (centerDeg ± tolDeg from vertical, + = toward `dir`), its center line, and
 * the measured segment origin → `tip`, green inside the zone and red outside.
 */
function drawAngleZone(ctx, origin, tip, dir, centerDeg, tolDeg, valueDeg, text, mirrored, size) {
  const len = Math.max(Math.hypot(tip.x - origin.x, tip.y - origin.y) * 1.15, 20);
  const at = (d) => {
    const r = (d * Math.PI) / 180;
    return { x: origin.x + dir * len * Math.sin(r), y: origin.y - len * Math.cos(r) };
  };
  const a = at(centerDeg - tolDeg);
  const b = at(centerDeg + tolDeg);
  const c = at(centerDeg);
  const ok = valueDeg == null || Math.abs(valueDeg - centerDeg) <= tolDeg;

  ctx.save();
  ctx.fillStyle = ok ? 'rgba(0,255,80,0.12)' : 'rgba(255,40,40,0.16)';
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  line(ctx, origin.x, origin.y, a.x, a.y);
  line(ctx, origin.x, origin.y, b.x, b.y);
  ctx.strokeStyle = CYAN;
  line(ctx, origin.x, origin.y, c.x, c.y);
  ctx.setLineDash([]);

  ctx.lineWidth = 3;
  ctx.strokeStyle = ok ? GREEN : blink();
  line(ctx, origin.x, origin.y, tip.x, tip.y);
  dot(ctx, tip.x, tip.y, 6, ok ? GREEN : RED);

  const v = valueDeg == null ? '' : ` ${Math.round(Math.abs(valueDeg - centerDeg))}°/${Math.round(tolDeg)}°`;
  label(ctx, `${text}${v}`, c.x + dir * 8, c.y - 4, mirrored, ok ? GREEN : RED, { size });
  ctx.restore();
}

/** Side view: torso (hip → shoulder) and front shin (ankle → knee) vertical guides. */
export function drawVerticalGuides(ctx, fr, mirrored, h) {
  const g = fr.geometry;
  const calib = fr.calib;
  if (fr.view !== 'side' || !g || !calib?.dir) return;
  const C = LUNGE_CFG;
  const dir = calib.dir;
  const size = Math.max(10, Math.round(h * 0.019));

  if (g.refHip && g.refShoulder) {
    const lean = torsoLeanDeg(g, dir);
    const lean0 = calib.lean0 ?? 0;
    drawAngleZone(ctx, g.refHip, g.refShoulder, dir, lean0, C.torso_lean_max_deg, lean, 'TORSO', mirrored, size);
  }

  const goingDown = fr.movement === LUNGE_STATE.DESCENDING || fr.movement === LUNGE_STATE.BOTTOM;
  const leg = fr.frontLeg ? g.legs[fr.frontLeg] : null;
  if (goingDown && leg?.knee && leg?.ankle) {
    const shin = shinTiltDeg(leg, dir);
    drawAngleZone(ctx, leg.ankle, leg.knee, dir, 0, C.shin_vertical_max_deg, shin, 'SHIN', mirrored, size);
  }
}

/** Red markers on the joints of every sustained fault (visual indicator only). */
export function drawFaultMarkers(ctx, fr) {
  const g = fr.geometry;
  if (!g || !fr.redJoints?.length) return;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = blink();
  for (const idx of fr.redJoints) {
    const p = jointPoint(g, idx);
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

  const legs = `L ${fr.legCounts.left} · R ${fr.legCounts.right}`;
  const small = Math.round(size * 0.75);
  const lw = measure(ctx, legs, small, 700);
  screenText(ctx, legs, w - 14 - lw, 12 + size + 14 + small + 4, w, mirrored, GREY, { size: small, weight: 700 });
}

function drawDebugReadout(ctx, fr, w, h, mirrored) {
  const g = fr.geometry;
  const f = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
  drawDebugRows(ctx, [
    `${fr.view} ${fr.phase.replace('lunge_', '')} ${fr.movement}`,
    `depth ${f(fr.depth)}  count ≥ ${LUNGE_CFG.depth_count}  target ≥ ${LUNGE_CFG.depth_target}`,
    `norm ${g ? g.norm.toFixed(0) : '—'}px  standH ${fr.calib ? fr.calib.standH.toFixed(0) : '—'}px  swRatio ${f(g?.swRatio)}`,
    `sustained ${fr.sustainedCues.join(',') || '—'}`,
  ], w, h, mirrored);
}

/** Full overlay for one frame (the skeleton is drawn by the engine loop). */
export function drawLungeOverlay(ctx, fr, frame) {
  if (!fr) return;
  const { width: w, height: h } = frame;
  const mirrored = frame.mirrored !== false;

  if (fr.phase === LUNGE_PHASE.SETUP) {
    drawStanceChecklist(ctx, fr, w, h, mirrored, { rows: SETUP_ROWS });
  } else {
    drawDepthGuide(ctx, fr, mirrored, h);
    drawVerticalGuides(ctx, fr, mirrored, h);
    drawFaultMarkers(ctx, fr);
    drawRepPanel(ctx, fr, w, h, mirrored);
  }
  drawFeedback(ctx, fr, w, h, mirrored);
  if (LUNGE_CFG.debug) drawDebugReadout(ctx, fr, w, h, mirrored);
}
