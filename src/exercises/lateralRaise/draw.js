// Canvas overlays for the dumbbell lateral raise (front view).
//
// Body-anchored guides (shoulder line, tolerance band) use canvas pixel
// coordinates. The shared HUD (badge, counters, feedback, stance checklist)
// lives in ../common/hud.js.

import { LR_CFG } from './config';
import { raiseLines } from './poseChecks';
import { LR_PHASE } from './LateralRaiseFlow';
import {
  HUD_CYAN as CYAN, HUD_GREEN as GREEN, HUD_RED as RED, HUD_AMBER as AMBER,
  HUD_WHITE as WHITE,
  blink, line, dot, label,
  drawStanceGuides, drawStanceChecklist, drawActivityBadge, drawCounters,
  drawFeedback, drawRestOverlay, drawDebugRows,
} from '../common/hud';

const REASON_LABEL = {
  lr_setup: 'Stance check',
  lr_ready: 'Get ready',
  lr_out_of_frame: 'Out of frame',
  lr_turned_away: 'Turned away',
  lr_arms_resting: 'Arms resting',
  lr_resting_between_sets: 'Resting between sets',
  lr_complete: 'Session complete',
};
const WARN_REASONS = ['lr_turned_away', 'lr_out_of_frame'];

// ── Shoulder line + tolerance band ──────────────────────────────────────────

export function drawShoulderLine(ctx, g, calib, mirrored, h) {
  if (!g) return;
  const L = raiseLines(g);
  const n = g.norm;
  const xs = [g.ls.x, g.rs.x];
  for (const a of [g.left, g.right]) if (a.ok) xs.push(a.elbow.x, a.wrist.x);
  const x0 = Math.min(...xs) - 0.4 * n;
  const x1 = Math.max(...xs) + 0.4 * n;
  const labelX = mirrored ? x1 : x0;
  const bandLabelX = mirrored ? x0 : x1;
  const size = Math.max(10, Math.round(h * 0.02));

  const inBand = (y) => y >= L.bandTopY && y <= L.bandBottomY;
  const arms = [g.left, g.right].filter((a) => a.ok);
  // An arm is "in" only when its elbow AND wrist are both inside the band.
  const inCount = arms.filter((a) => inBand(a.elbow.y) && inBand(a.wrist.y)).length;
  const lineColor = inCount === 2 ? GREEN : inCount === 1 ? AMBER : CYAN;

  ctx.save();

  // Upper / lower offset lines — elbows and wrists must land between them at the top.
  const elbowOver = arms.some((a) => a.elbow.y < L.bandTopY || a.wrist.y < L.bandTopY);
  ctx.fillStyle = inCount === 2 ? 'rgba(0,255,80,0.16)' : 'rgba(0,200,255,0.10)';
  ctx.fillRect(x0, L.bandTopY, x1 - x0, L.bandBottomY - L.bandTopY);
  ctx.lineWidth = 2;
  ctx.strokeStyle = elbowOver ? blink() : 'rgba(0,200,255,0.85)';
  line(ctx, x0, L.bandTopY, x1, L.bandTopY);
  ctx.strokeStyle = 'rgba(0,200,255,0.85)';
  line(ctx, x0, L.bandBottomY, x1, L.bandBottomY);
  const bandLabel = { size: size - 1, align: 'right' };
  label(ctx, 'UPPER', bandLabelX, L.bandTopY - 4, mirrored, elbowOver ? RED : CYAN, bandLabel);
  label(ctx, 'LOWER', bandLabelX, L.bandBottomY + size, mirrored, CYAN, bandLabel);

  // The shoulder line itself.
  ctx.lineWidth = 3;
  ctx.strokeStyle = lineColor;
  line(ctx, x0, L.shoulderY, x1, L.shoulderY);
  label(ctx, 'SHOULDER LINE', labelX, L.shoulderY - 6, mirrored, lineColor, { size });

  const jointColor = (p) => (p.y < L.bandTopY ? RED : inBand(p.y) ? GREEN : CYAN);
  for (const a of arms) {
    dot(ctx, a.elbow.x, a.elbow.y, 6, jointColor(a.elbow));
    dot(ctx, a.wrist.x, a.wrist.y, 7, WHITE);
    dot(ctx, a.wrist.x, a.wrist.y, 5, jointColor(a.wrist));
  }
  ctx.restore();
}

// ── Left / right evenness guide ─────────────────────────────────────────────
//
// While the arms move, the two elbows (and the two wrists) are joined by a
// level line, and each joint gets a bracket of the allowed height difference
// centred on the pair's mean height: both joints inside their brackets ⇔ the
// pair is within tolerance.

function drawLevelPair(ctx, a, b, tolPx, mirrored, size, text) {
  const mean = (a.y + b.y) / 2;
  const half = tolPx / 2;
  const even = Math.abs(a.y - b.y) <= tolPx;
  const color = even ? GREEN : AMBER;
  const tick = Math.max(6, size * 0.6);

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.setLineDash([6, 5]);
  line(ctx, a.x, a.y, b.x, b.y);
  ctx.setLineDash([]);
  for (const p of [a, b]) {
    const inside = Math.abs(p.y - mean) <= half;
    ctx.strokeStyle = inside ? GREEN : AMBER;
    line(ctx, p.x, mean - half, p.x, mean + half);
    line(ctx, p.x - tick, mean - half, p.x + tick, mean - half);
    line(ctx, p.x - tick, mean + half, p.x + tick, mean + half);
  }
  ctx.restore();
  label(ctx, `${text} ${even ? 'LEVEL' : 'UNEVEN'}`, (a.x + b.x) / 2, mean - half - 4, mirrored, color, {
    size: size - 1, align: 'center',
  });
}

export function drawSymmetryGuide(ctx, g, fr, mirrored, h) {
  if (!g || fr.phase !== LR_PHASE.ACTIVE) return;
  const L = g.left;
  const R = g.right;
  if (!L.ok || !R.ok) return;
  const moving = fr.armStates?.left === 'UP' || fr.armStates?.right === 'UP';
  if (!moving) return;
  const size = Math.max(10, Math.round(h * 0.02));
  drawLevelPair(ctx, L.elbow, R.elbow, LR_CFG.symmetry_max * g.norm, mirrored, size, 'ELBOWS');
  drawLevelPair(ctx, L.wrist, R.wrist, LR_CFG.symmetry_wrist_max * g.norm, mirrored, size, 'WRISTS');
}

export function drawDebugReadout(ctx, fr, w, h, mirrored) {
  const g = fr.geometry;
  const f = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
  const rows = [
    `phase ${fr.phase.replace('lr_', '')}  act ${fr.activity}`,
    `shoulderY ${g ? g.shY.toFixed(0) : '—'}px  norm ${g ? g.norm.toFixed(0) : '—'}px`,
    `L elbowDy ${f(g?.left.elbowDy)} wristDy ${f(g?.left.wristDy)} ${fr.armStates.left}`,
    `R elbowDy ${f(g?.right.elbowDy)} wristDy ${f(g?.right.wristDy)} ${fr.armStates.right}`,
    `band −${LR_CFG.elbow_above_tolerance}…+${LR_CFG.top_tolerance}`,
    `L−R elbow ${f(g?.left.ok && g?.right.ok ? Math.abs(g.left.elbowDy - g.right.elbowDy) : null)}/${LR_CFG.symmetry_max}`
      + `  wrist ${f(g?.left.ok && g?.right.ok ? Math.abs(g.left.wristDy - g.right.wristDy) : null)}/${LR_CFG.symmetry_wrist_max}`,
  ];
  if (fr.calib) {
    const c = fr.calib;
    rows.push(`calib sw ${c.sw.toFixed(0)} restE ${c.restElbow.left.toFixed(2)}/${c.restElbow.right.toFixed(2)} restW ${c.restWrist.left.toFixed(2)}/${c.restWrist.right.toFixed(2)}`);
  }
  drawDebugRows(ctx, rows, w, h, mirrored);
}

/** Full overlay for one frame (skeleton is drawn by the engine loop). */
export function drawLateralRaiseOverlay(ctx, fr, frame) {
  if (!fr) return;
  const { width: w, height: h } = frame;
  const mirrored = frame.mirrored !== false;
  const g = fr.geometry;
  const stanceOpts = { stanceMin: LR_CFG.stance_min, stanceMax: LR_CFG.stance_max };

  if (fr.phase === LR_PHASE.SETUP_STANCE) {
    if (g) drawStanceGuides(ctx, g, fr.stanceResult, h, { ...stanceOpts, narrowKey: 'lr_feet_narrow', wideKey: 'lr_feet_wide' });
    drawStanceChecklist(ctx, fr, w, h, mirrored, stanceOpts);
  } else if (g) {
    drawShoulderLine(ctx, g, fr.calib, mirrored, h);
    drawSymmetryGuide(ctx, g, fr, mirrored, h);
  }

  drawActivityBadge(ctx, fr, w, h, mirrored, { reasonLabels: REASON_LABEL, warnReasons: WARN_REASONS });
  drawCounters(ctx, fr, w, h, mirrored);
  if (fr.phase === LR_PHASE.REST_BETWEEN_SETS) drawRestOverlay(ctx, fr, w, h, mirrored);
  drawFeedback(ctx, fr, w, h, mirrored);
  if (LR_CFG.debug) drawDebugReadout(ctx, fr, w, h, mirrored);
}
