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
  HUD_GREY as GREY, HUD_WHITE as WHITE,
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
  const L = raiseLines(g, calib);
  const n = g.norm;
  const xs = [g.ls.x, g.rs.x];
  for (const a of [g.left, g.right]) if (a.ok) xs.push(a.elbow.x, a.wrist.x);
  const x0 = Math.min(...xs) - 0.4 * n;
  const x1 = Math.max(...xs) + 0.4 * n;
  const labelX = mirrored ? x1 : x0;
  const size = Math.max(10, Math.round(h * 0.02));

  const inBand = (y) => y >= L.bandTopY && y <= L.bandBottomY;
  const elbows = [g.left, g.right].filter((a) => a.ok).map((a) => a.elbow);
  const inCount = elbows.filter((e) => inBand(e.y)).length;
  const lineColor = inCount === 2 ? GREEN : inCount === 1 ? AMBER : CYAN;

  ctx.save();

  // Tolerance band (elbows should land here at the top).
  ctx.fillStyle = inCount === 2 ? 'rgba(0,255,80,0.16)' : 'rgba(0,200,255,0.10)';
  ctx.fillRect(x0, L.bandTopY, x1 - x0, L.bandBottomY - L.bandTopY);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,200,255,0.7)';
  line(ctx, x0, L.bandTopY, x1, L.bandTopY);
  line(ctx, x0, L.bandBottomY, x1, L.bandBottomY);

  // The shoulder line itself.
  ctx.lineWidth = 3;
  ctx.strokeStyle = lineColor;
  line(ctx, x0, L.shoulderY, x1, L.shoulderY);
  label(ctx, 'SHOULDER LINE', labelX, L.shoulderY - 6, mirrored, lineColor, { size });

  // Wrists must stay under this line.
  const wristOver = [g.left, g.right].some((a) => a.ok && a.wrist.y < L.wristLimitY);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = wristOver ? blink() : 'rgba(255,90,90,0.8)';
  line(ctx, x0, L.wristLimitY, x1, L.wristLimitY);
  ctx.setLineDash([]);
  label(ctx, 'WRIST LIMIT', labelX, L.wristLimitY - 4, mirrored, 'rgba(255,120,120,0.95)', { size: size - 1 });

  // Start zone (arms must come back below this for the rep to finish).
  ctx.setLineDash([3, 6]);
  ctx.strokeStyle = GREY;
  ctx.lineWidth = 1;
  line(ctx, x0, L.returnY, x1, L.returnY);
  ctx.setLineDash([]);
  label(ctx, 'START ZONE', labelX, L.returnY + size + 2, mirrored, GREY, { size: size - 1 });

  for (const a of [g.left, g.right]) {
    if (!a.ok) continue;
    const e = a.elbow;
    const eColor = e.y < L.bandTopY ? RED : inBand(e.y) ? GREEN : CYAN;
    dot(ctx, e.x, e.y, 6, eColor);
    dot(ctx, a.wrist.x, a.wrist.y, 5, a.wrist.y < L.wristLimitY ? RED : WHITE);
  }
  ctx.restore();
}

export function drawDebugReadout(ctx, fr, w, h, mirrored) {
  const g = fr.geometry;
  const f = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
  const rows = [
    `phase ${fr.phase.replace('lr_', '')}  act ${fr.activity}`,
    `shoulderY ${g ? g.shY.toFixed(0) : '—'}px  norm ${g ? g.norm.toFixed(0) : '—'}px`,
    `L elbowDy ${f(g?.left.elbowDy)} wristDy ${f(g?.left.wristDy)} ${fr.armStates.left}`,
    `R elbowDy ${f(g?.right.elbowDy)} wristDy ${f(g?.right.wristDy)} ${fr.armStates.right}`,
    `top ≤ ${LR_CFG.top_tolerance}  wrist ≥ −${LR_CFG.wrist_above_tolerance}  elbow ≥ −${LR_CFG.elbow_above_tolerance}`,
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
  }

  drawActivityBadge(ctx, fr, w, h, mirrored, { reasonLabels: REASON_LABEL, warnReasons: WARN_REASONS });
  drawCounters(ctx, fr, w, h, mirrored);
  if (fr.phase === LR_PHASE.REST_BETWEEN_SETS) drawRestOverlay(ctx, fr, w, h, mirrored);
  drawFeedback(ctx, fr, w, h, mirrored);
  if (LR_CFG.debug) drawDebugReadout(ctx, fr, w, h, mirrored);
}
