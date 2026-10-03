// Canvas overlays for the dumbbell front raise (front view).
//
// Body-anchored guides (shoulder line, tolerance band, arm lanes) use canvas
// pixel coordinates. The shared HUD (badge, counters, feedback, stance
// checklist) lives in ../common/hud.js.

import { FR_CFG } from './config';
import { raiseLines } from './poseChecks';
import { FR_PHASE } from './FrontRaiseFlow';
import {
  HUD_CYAN as CYAN, HUD_GREEN as GREEN, HUD_RED as RED, HUD_AMBER as AMBER,
  HUD_GREY as GREY, HUD_WHITE as WHITE,
  blink, line, dot, label,
  drawStanceGuides, drawStanceChecklist, drawActivityBadge, drawCounters,
  drawFeedback, drawRestOverlay, drawDebugRows,
} from '../common/hud';

const REASON_LABEL = {
  fr_setup: 'Stance check',
  fr_ready: 'Get ready',
  fr_out_of_frame: 'Out of frame',
  fr_turned_away: 'Turned away',
  fr_arms_resting: 'Arms resting',
  fr_resting_between_sets: 'Resting between sets',
  fr_complete: 'Session complete',
};
const WARN_REASONS = ['fr_turned_away', 'fr_out_of_frame'];

// ── Shoulder line + tolerance band + arm lanes ──────────────────────────────

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
  const wrists = [g.left, g.right].filter((a) => a.ok).map((a) => a.wrist);
  const inCount = wrists.filter((w) => inBand(w.y)).length;
  const lineColor = inCount === 2 ? GREEN : inCount === 1 ? AMBER : CYAN;

  ctx.save();

  // Tolerance band (hands should land here at the top).
  ctx.fillStyle = inCount === 2 ? 'rgba(0,255,80,0.16)' : 'rgba(0,200,255,0.10)';
  ctx.fillRect(x0, L.bandTopY, x1 - x0, L.bandBottomY - L.bandTopY);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,200,255,0.7)';
  line(ctx, x0, L.bandBottomY, x1, L.bandBottomY);

  // Upper limit — hands above this are too high.
  const tooHigh = wrists.some((w) => w.y < L.bandTopY);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = tooHigh ? blink() : 'rgba(255,90,90,0.8)';
  line(ctx, x0, L.bandTopY, x1, L.bandTopY);
  ctx.setLineDash([]);
  label(ctx, 'UPPER LIMIT', labelX, L.bandTopY - 4, mirrored, 'rgba(255,120,120,0.95)', { size: size - 1 });

  // The shoulder line itself.
  ctx.lineWidth = 3;
  ctx.strokeStyle = lineColor;
  line(ctx, x0, L.shoulderY, x1, L.shoulderY);
  label(ctx, 'SHOULDER LINE', labelX, L.shoulderY - 6, mirrored, lineColor, { size });

  // Arm lanes — wrists should stay inside these while the arms are raised.
  for (const a of [g.left, g.right]) {
    const outSign = a.shoulder.x >= g.shMid.x ? 1 : -1;
    const laneX = a.shoulder.x + outSign * FR_CFG.flare_tolerance * n;
    const flared = a.ok && a.wristOut > FR_CFG.flare_tolerance && a.wrist.y < L.returnY;
    ctx.lineWidth = flared ? 2 : 1;
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = flared ? blink() : 'rgba(0,200,255,0.45)';
    line(ctx, laneX, L.bandTopY, laneX, L.returnY);
  }
  ctx.setLineDash([]);

  // Start zone (arms must come back below this for the rep to finish).
  ctx.setLineDash([3, 6]);
  ctx.strokeStyle = GREY;
  ctx.lineWidth = 1;
  line(ctx, x0, L.returnY, x1, L.returnY);
  ctx.setLineDash([]);
  label(ctx, 'START ZONE', labelX, L.returnY + size + 2, mirrored, GREY, { size: size - 1 });

  for (const a of [g.left, g.right]) {
    if (!a.ok) continue;
    const w = a.wrist;
    const flared = a.wristOut > FR_CFG.flare_tolerance && w.y < L.returnY;
    const wColor = w.y < L.bandTopY || flared ? RED : inBand(w.y) ? GREEN : CYAN;
    dot(ctx, a.elbow.x, a.elbow.y, 5, WHITE);
    dot(ctx, w.x, w.y, 6, wColor);
  }
  ctx.restore();
}

export function drawDebugReadout(ctx, fr, w, h, mirrored) {
  const g = fr.geometry;
  const f = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
  const rows = [
    `phase ${fr.phase.replace('fr_', '')}  act ${fr.activity}`,
    `shoulderY ${g ? g.shY.toFixed(0) : '—'}px  norm ${g ? g.norm.toFixed(0) : '—'}px  torso ${g ? g.torsoDist.toFixed(0) : '—'}px`,
    `L wristDy ${f(g?.left.wristDy)} out ${f(g?.left.wristOut)} ${fr.armStates.left}`,
    `R wristDy ${f(g?.right.wristDy)} out ${f(g?.right.wristOut)} ${fr.armStates.right}`,
    `top ≤ ${FR_CFG.top_tolerance}  high ≥ −${FR_CFG.too_high_tolerance}  flare ≤ ${FR_CFG.flare_tolerance}`,
  ];
  if (fr.calib) {
    const c = fr.calib;
    rows.push(`calib sw ${c.sw.toFixed(0)} restE ${c.restElbow.left.toFixed(2)}/${c.restElbow.right.toFixed(2)} restW ${c.restWrist.left.toFixed(2)}/${c.restWrist.right.toFixed(2)}`);
  }
  drawDebugRows(ctx, rows, w, h, mirrored);
}

/** Full overlay for one frame (skeleton is drawn by the engine loop). */
export function drawFrontRaiseOverlay(ctx, fr, frame) {
  if (!fr) return;
  const { width: w, height: h } = frame;
  const mirrored = frame.mirrored !== false;
  const g = fr.geometry;
  const stanceOpts = { stanceMin: FR_CFG.stance_min, stanceMax: FR_CFG.stance_max };

  if (fr.phase === FR_PHASE.SETUP_STANCE) {
    if (g) drawStanceGuides(ctx, g, fr.stanceResult, h, { ...stanceOpts, narrowKey: 'fr_feet_narrow', wideKey: 'fr_feet_wide' });
    drawStanceChecklist(ctx, fr, w, h, mirrored, stanceOpts);
  } else if (g) {
    drawShoulderLine(ctx, g, fr.calib, mirrored, h);
  }

  drawActivityBadge(ctx, fr, w, h, mirrored, { reasonLabels: REASON_LABEL, warnReasons: WARN_REASONS });
  drawCounters(ctx, fr, w, h, mirrored);
  if (fr.phase === FR_PHASE.REST_BETWEEN_SETS) drawRestOverlay(ctx, fr, w, h, mirrored);
  drawFeedback(ctx, fr, w, h, mirrored);
  if (FR_CFG.debug) drawDebugReadout(ctx, fr, w, h, mirrored);
}
