// Canvas overlays for the dumbbell curl (front view).
//
// Body-anchored guides (per-arm reference lines) use canvas pixel
// coordinates. The shared HUD (badge, counters, feedback, stance checklist)
// lives in ../common/hud.js.

import { DC_CFG } from './config';
import { curlLines, topProgressAt } from './poseChecks';
import { DC_PHASE } from './DumbbellCurlFlow';
import {
  HUD_CYAN as CYAN, HUD_GREEN as GREEN, HUD_RED as RED, HUD_AMBER as AMBER,
  HUD_GREY as GREY, HUD_WHITE as WHITE, HUD_PANEL as PANEL,
  blink, line, dot, label, fontPx, screenText, screenBox,
  drawStanceGuides, drawStanceChecklist, drawActivityBadge, drawCounters,
  drawFeedback, drawRestOverlay, drawDebugRows,
} from '../common/hud';

const REASON_LABEL = {
  dc_setup: 'Stance check',
  dc_ready: 'Get ready',
  dc_out_of_frame: 'Out of frame',
  dc_turned_away: 'Turned away',
  dc_arms_resting: 'Arms resting',
  dc_resting_between_sets: 'Resting between sets',
  dc_complete: 'Session complete',
};
const WARN_REASONS = ['dc_turned_away', 'dc_out_of_frame'];

const STANCE_ROWS = [
  ['Facing the camera', 'facing'],
  ['Standing upright', 'upright'],
  ['Feet shoulder width', 'feet'],
  ['Arms hanging at sides', 'armsDown'],
];

// ── Reference lines ─────────────────────────────────────────────────────────

/** Lines for one arm, drawn as a segment centered on that arm's shoulder. */
function drawArmLines(ctx, g, a, calib, fr, mirrored, h, withLabels) {
  const L = curlLines(g, a, calib);
  const half = 0.55 * g.norm;
  const cx = a.shoulder.x;
  const x0 = cx - half;
  const x1 = cx + half;
  // Labels go on the arm's outer side of the screen.
  const outer = Math.sign(a.shoulder.x - g.shMid.x) || 1;
  const labelX = outer > 0 ? x1 + 4 : x0 - 4;
  const align = (outer > 0) !== mirrored ? 'left' : 'right';
  const size = Math.max(10, Math.round(h * 0.019));

  const wristY = a.ok ? a.wrist.y : null;
  const crossed = wristY != null && wristY < L.upperY;
  const atTop = wristY != null && !crossed && wristY <= L.topTolY;
  const extended = wristY != null && wristY >= L.bottomZoneY;

  ctx.save();

  // Good top zone: between the upper tolerance line and the target line.
  ctx.fillStyle = crossed ? 'rgba(255,40,40,0.18)' : atTop ? 'rgba(0,255,80,0.20)' : 'rgba(0,200,255,0.10)';
  ctx.fillRect(x0, L.upperY, x1 - x0, L.targetY - L.upperY);

  // Upper tolerance line — the wrist must stay below it.
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = crossed ? blink() : 'rgba(255,90,90,0.9)';
  line(ctx, x0, L.upperY, x1, L.upperY);
  ctx.setLineDash([]);

  // Top target line — the wrist must reach it.
  ctx.lineWidth = 3;
  ctx.strokeStyle = atTop ? GREEN : CYAN;
  line(ctx, x0, L.targetY, x1, L.targetY);

  // Top tolerance edge (thin).
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,200,255,0.5)';
  line(ctx, x0, L.topTolY, x1, L.topTolY);

  // Bottom line (calibrated resting wrist) + extension zone edge.
  ctx.setLineDash([3, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = extended ? 'rgba(0,255,80,0.8)' : GREY;
  line(ctx, x0, L.bottomY, x1, L.bottomY);
  ctx.lineWidth = 1;
  ctx.strokeStyle = GREY;
  line(ctx, x0, L.bottomZoneY, x1, L.bottomZoneY);
  ctx.setLineDash([]);

  if (withLabels) {
    label(ctx, 'UPPER LIMIT', labelX, L.upperY + 4, mirrored, 'rgba(255,120,120,0.95)', { size: size - 1, align });
    label(ctx, 'TARGET', labelX, L.targetY + 4, mirrored, atTop ? GREEN : CYAN, { size, align });
    label(ctx, 'BOTTOM', labelX, L.bottomY + 4, mirrored, GREY, { size: size - 1, align });
  }

  if (a.ok) {
    const e = a.elbow;
    const elbowMoving = (fr.sustainedCues || []).includes('dc_elbow_moving');
    // Resting elbow height tick + elbow marker.
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    line(ctx, e.x - 10, L.restElbowY, e.x + 10, L.restElbowY);
    dot(ctx, e.x, e.y, 6, elbowMoving ? RED : e.y < L.elbowLiftY ? AMBER : CYAN);
    dot(ctx, a.wrist.x, a.wrist.y, 6, crossed ? RED : atTop ? GREEN : WHITE);
  }
  ctx.restore();
}

export function drawCurlLines(ctx, fr, mirrored, h) {
  const g = fr.geometry;
  if (!g || !fr.calib) return;
  // Only one arm gets labels to keep the overlay readable.
  const labelSide = mirrored ? 'left' : 'right';
  for (const side of ['left', 'right']) {
    drawArmLines(ctx, g, g[side], fr.calib, fr, mirrored, h, side === labelSide);
  }
}

// ── Per-arm curl progress bars ──────────────────────────────────────────────

export function drawProgressBars(ctx, fr, w, h, mirrored) {
  const size = fontPx(h, 0.8);
  const bw = Math.max(14, Math.round(w * 0.025));
  const top = Math.round(h * 0.40);
  const bh = Math.round(h * 0.30);
  // On a mirrored (selfie) view the user's left arm appears on screen-left.
  const screenLeftSide = mirrored ? 'left' : 'right';
  for (const side of ['left', 'right']) {
    const p = fr.armProgress?.[side];
    const sx = side === screenLeftSide ? 14 : w - 14 - bw;
    screenBox(ctx, sx - 4, top - size - 10, bw + 8, bh + size * 2 + 22, w, mirrored, PANEL);
    screenBox(ctx, sx, top, bw, bh, w, mirrored, 'rgba(255,255,255,0.12)');
    if (p != null) {
      const fill = p >= topProgressAt(side, fr.calib) ? GREEN : p >= DC_CFG.curl_start ? CYAN : 'rgba(200,200,200,0.8)';
      const ph = Math.round(bh * p);
      screenBox(ctx, sx, top + bh - ph, bw, ph, w, mirrored, fill);
    }
    screenText(ctx, side === 'left' ? 'L' : 'R', sx + bw / 2, top - 6, w, mirrored, WHITE, { size, weight: 800, align: 'center' });
    screenText(
      ctx, p == null ? '—' : `${Math.round(p * 100)}%`, sx + bw / 2, top + bh + size + 6, w, mirrored,
      p == null ? GREY : WHITE, { size: size - 1, weight: 700, align: 'center' },
    );
  }
}

// ── Debug ───────────────────────────────────────────────────────────────────

export function drawDebugReadout(ctx, fr, w, h, mirrored) {
  const g = fr.geometry;
  const f = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
  const armRow = (side) => {
    const a = g?.[side];
    const p = fr.armProgress?.[side];
    return `${side === 'left' ? 'L' : 'R'} sh ${f(a?.lineY, 0)} el ${f(a?.ok ? a.elbow.y : null, 0)} wr ${f(a?.ok ? a.wrist.y : null, 0)}px  span ${f(a?.span)}  ${p == null ? '—' : Math.round(p * 100)}%  ${fr.armStates[side]}`;
  };
  const rows = [
    `phase ${fr.phase.replace('dc_', '')}  act ${fr.activity}  mode ${fr.mode}`,
    armRow('left'),
    armRow('right'),
    `T ${f(g?.T, 0)}px  SW ${f(g?.norm, 0)}px  target ${DC_CFG.top_line_offset}+${DC_CFG.top_tolerance}  upper −${DC_CFG.upper_allowance}  bottom ±${DC_CFG.bottom_tolerance}`,
  ];
  if (fr.calib) {
    const c = fr.calib;
    rows.push(`calib REST_SPAN ${f(c.restSpan.left)}/${f(c.restSpan.right)}  restElbow ${f(c.restElbow.left)}/${f(c.restElbow.right)}  elbowOut ${f(c.restElbowOut.left)}/${f(c.restElbowOut.right)}`);
  }
  if (fr.sustainedCues?.length) rows.push(`cues ${fr.sustainedCues.join(' ')}`);
  drawDebugRows(ctx, rows, w, h, mirrored);
}

/** Full overlay for one frame (skeleton is drawn by the engine loop). */
export function drawDumbbellCurlOverlay(ctx, fr, frame) {
  if (!fr) return;
  const { width: w, height: h } = frame;
  const mirrored = frame.mirrored !== false;
  const g = fr.geometry;
  const stanceOpts = { stanceMin: DC_CFG.stance_min, stanceMax: DC_CFG.stance_max };

  if (fr.phase === DC_PHASE.SETUP_STANCE) {
    if (g) drawStanceGuides(ctx, g, fr.stanceResult, h, { ...stanceOpts, narrowKey: 'dc_feet_narrow', wideKey: 'dc_feet_wide' });
    drawStanceChecklist(ctx, fr, w, h, mirrored, { ...stanceOpts, rows: STANCE_ROWS });
  } else if (g) {
    drawCurlLines(ctx, fr, mirrored, h);
  }

  drawActivityBadge(ctx, fr, w, h, mirrored, { reasonLabels: REASON_LABEL, warnReasons: WARN_REASONS });
  drawCounters(ctx, fr, w, h, mirrored);
  if (fr.phase === DC_PHASE.ACTIVE || fr.phase === DC_PHASE.READY) drawProgressBars(ctx, fr, w, h, mirrored);
  if (fr.phase === DC_PHASE.REST_BETWEEN_SETS) drawRestOverlay(ctx, fr, w, h, mirrored);
  drawFeedback(ctx, fr, w, h, mirrored);
  if (DC_CFG.debug) drawDebugReadout(ctx, fr, w, h, mirrored);
}
