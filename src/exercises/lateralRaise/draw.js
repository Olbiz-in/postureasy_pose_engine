// Canvas overlays for the dumbbell lateral raise (front view).
//
// Body-anchored guides (shoulder line, tolerance band, stance rails) use
// canvas pixel coordinates. HUD elements (badge, counters, feedback) are
// placed in SCREEN coordinates: the front-view canvas is CSS-mirrored, so x is
// flipped and text is counter-flipped when `mirrored` is true.

import { nowSec } from '../../core/landmarks';
import { LR_CFG } from './config';
import { raiseLines } from './poseChecks';
import { LR_PHASE, LR_ACTIVITY } from './LateralRaiseFlow';

const CYAN = 'rgb(0,200,255)';
const GREEN = 'rgb(0,255,80)';
const RED = 'rgb(255,40,40)';
const AMBER = 'rgb(255,190,0)';
const GREY = 'rgba(200,200,200,0.6)';
const WHITE = 'rgb(255,255,255)';
const PANEL = 'rgba(11,17,32,0.72)';

const REASON_LABEL = {
  lr_setup: 'Stance check',
  lr_ready: 'Get ready',
  lr_out_of_frame: 'Out of frame',
  lr_turned_away: 'Turned away',
  lr_arms_resting: 'Arms resting',
  lr_resting_between_sets: 'Resting between sets',
  lr_complete: 'Session complete',
};

function blink() {
  return Math.floor(nowSec() * 4) % 2 === 0 ? 'rgb(255,0,0)' : 'rgb(120,0,0)';
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function fontPx(h, scale = 1) {
  return Math.round(Math.max(12, h * 0.028) * scale);
}

/** Text at a CANVAS point, readable on a mirrored canvas. */
function label(ctx, text, x, y, mirrored, color, { size = 11, align = 'left' } = {}) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.translate(x, y);
  if (mirrored) ctx.scale(-1, 1);
  ctx.textAlign = align;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Text at a SCREEN point (sx measured from the visible left edge). */
function screenText(ctx, text, sx, sy, w, mirrored, color, { size = 14, weight = 700, align = 'left' } = {}) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.translate(mirrored ? w - sx : sx, sy);
  if (mirrored) ctx.scale(-1, 1);
  ctx.textAlign = align;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Filled rect at SCREEN coords. */
function screenBox(ctx, sx, sy, bw, bh, w, mirrored, fill) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(mirrored ? w - sx - bw : sx, sy, bw, bh);
  ctx.restore();
}

function measure(ctx, text, size, weight = 700) {
  ctx.save();
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  ctx.restore();
  return tw;
}

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

// ── Stance check ────────────────────────────────────────────────────────────

export function drawStanceGuides(ctx, g, stance, h) {
  if (!g?.feetOk) return;
  const cx = g.shMid.x;
  const halfMin = (LR_CFG.stance_min * g.sw) / 2;
  const halfMax = (LR_CFG.stance_max * g.sw) / 2;
  const halfLen = Math.max(8, 0.03 * h);
  const keys = new Set(stance?.cueKeys || []);
  const narrow = keys.has('lr_feet_narrow');
  const wide = keys.has('lr_feet_wide');
  const ok = !narrow && !wide;

  ctx.save();
  for (const [d, ankle] of [[-1, g.la.x < g.ra.x ? g.la : g.ra], [1, g.la.x < g.ra.x ? g.ra : g.la]]) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = narrow ? blink() : CYAN;
    line(ctx, cx + d * halfMin, ankle.y - halfLen, cx + d * halfMin, ankle.y + halfLen);
    ctx.strokeStyle = wide ? blink() : CYAN;
    line(ctx, cx + d * halfMax, ankle.y - halfLen, cx + d * halfMax, ankle.y + halfLen);
    dot(ctx, ankle.x, ankle.y, 5, ok ? GREEN : RED);
  }
  ctx.restore();
}

export function drawStanceChecklist(ctx, fr, w, h, mirrored) {
  const st = fr.stanceResult;
  const checks = st?.checks || {};
  const size = fontPx(h, 0.85);
  const rows = [
    ['Facing the camera', checks.facing],
    ['Standing upright', checks.upright],
    ['Feet shoulder width', checks.feet],
    ['Arms down at sides', checks.armsDown],
  ];
  const pad = 10;
  const rowH = size + 8;
  const bw = Math.max(...rows.map(([t]) => measure(ctx, `✓  ${t}`, size, 600))) + pad * 2;
  const bh = rowH * rows.length + pad * 2 + size + 6;
  const sx = 14;
  const sy = Math.round(h * 0.16);

  screenBox(ctx, sx, sy, bw, bh, w, mirrored, PANEL);
  screenText(ctx, 'STANCE CHECK', sx + pad, sy + pad + size - 2, w, mirrored, WHITE, { size, weight: 800 });
  rows.forEach(([text, pass], i) => {
    const y = sy + pad + size + 6 + (i + 1) * rowH - 6;
    screenText(ctx, `${pass ? '✓' : '✗'}  ${text}`, sx + pad, y, w, mirrored, pass ? GREEN : AMBER, { size, weight: 600 });
  });
  if (st?.values?.stanceRatio != null) {
    const r = st.values.stanceRatio.toFixed(2);
    screenText(
      ctx, `Feet ratio ${r} (${LR_CFG.stance_min}–${LR_CFG.stance_max})`,
      sx, sy + bh + size + 4, w, mirrored, GREY, { size: size - 2, weight: 600 },
    );
  }
  if (fr.stanceHoldPct != null) {
    const barW = bw;
    screenBox(ctx, sx, sy + bh + size + 12, barW, 6, w, mirrored, 'rgba(255,255,255,0.15)');
    screenBox(ctx, sx, sy + bh + size + 12, barW * fr.stanceHoldPct, 6, w, mirrored, GREEN);
  }
}

// ── HUD: activity badge, counters, feedback, rest ───────────────────────────

export function drawActivityBadge(ctx, fr, w, h, mirrored) {
  const exercising = fr.activity === LR_ACTIVITY.EXERCISING;
  const text = exercising ? 'EXERCISING' : 'NOT DOING EXERCISE';
  const size = fontPx(h, 0.9);
  const tw = measure(ctx, text, size, 800);
  const sx = 14;
  const sy = 12;
  const idleWarn = fr.activityReason === 'lr_turned_away' || fr.activityReason === 'lr_out_of_frame';
  const fill = exercising ? 'rgba(0,170,70,0.9)' : idleWarn ? 'rgba(230,120,0,0.9)' : 'rgba(90,90,90,0.9)';
  screenBox(ctx, sx, sy, tw + 20, size + 14, w, mirrored, fill);
  screenText(ctx, text, sx + 10, sy + size + 4, w, mirrored, WHITE, { size, weight: 800 });

  const reason = exercising ? '' : REASON_LABEL[fr.activityReason] || '';
  if (reason) {
    screenText(ctx, reason, sx + 2, sy + size * 2 + 16, w, mirrored, WHITE, { size: size - 2, weight: 600 });
  }
  if (fr.timerPaused) {
    screenText(ctx, 'Timer paused', sx + 2, sy + size * 3 + 22, w, mirrored, AMBER, { size: size - 2, weight: 700 });
  }
}

export function drawCounters(ctx, fr, w, h, mirrored) {
  const size = fontPx(h, 1.05);
  const setPart = fr.targetSets > 0 ? `Set ${fr.currentSet} of ${fr.targetSets}` : `Set ${fr.currentSet}`;
  const repPart = fr.targetReps > 0 ? `Rep ${fr.setRepCount} of ${fr.targetReps}` : `Rep ${fr.setRepCount}`;
  const text = `${setPart} · ${repPart}`;
  const tw = measure(ctx, text, size, 800);
  const sx = w - 14 - tw - 20;
  screenBox(ctx, sx, 12, tw + 20, size + 14, w, mirrored, PANEL);
  screenText(ctx, text, sx + 10, 12 + size + 4, w, mirrored, WHITE, { size, weight: 800 });
}

export function drawFeedback(ctx, fr, w, h, mirrored) {
  const size = fontPx(h, 1.0);
  const banner = fr.banner;
  const mistake = fr.mistake;
  const feedback = fr.feedback && fr.feedback !== mistake ? fr.feedback : '';
  const text = feedback || fr.status || '';
  const cx = w / 2;

  if (banner) {
    const bSize = fontPx(h, 1.5);
    const tw = measure(ctx, banner, bSize, 800);
    screenBox(ctx, cx - tw / 2 - 14, h * 0.2 - bSize, tw + 28, bSize + 18, w, mirrored, 'rgba(0,0,0,0.55)');
    screenText(ctx, banner, cx, h * 0.2 + 4, w, mirrored, WHITE, { size: bSize, weight: 800, align: 'center' });
  }
  if (mistake) drawMistake(ctx, mistake, w, h, mirrored);
  if (!text) return;
  const warn = fr.statusKind === 'warn' || fr.statusKind === 'fail' || fr.sustainedCues?.length;
  const tw = measure(ctx, text, size, 700);
  const y = h - 24;
  screenBox(ctx, cx - tw / 2 - 12, y - size - 6, tw + 24, size + 16, w, mirrored, PANEL);
  screenText(ctx, text, cx, y, w, mirrored, warn ? AMBER : WHITE, { size, weight: 700, align: 'center' });
}

function drawMistake(ctx, text, w, h, mirrored) {
  const size = fontPx(h, 1.25);
  const label = `⚠ ${text}`;
  const tw = Math.min(measure(ctx, label, size, 800), w - 60);
  const bx = w / 2 - tw / 2 - 16;
  const by = h * 0.3 - size;
  const bh = size + 22;
  screenBox(ctx, bx - 3, by - 3, tw + 38, bh + 6, w, mirrored, RED);
  screenBox(ctx, bx, by, tw + 32, bh, w, mirrored, 'rgba(90,0,0,0.88)');
  screenText(ctx, label, w / 2, by + size + 6, w, mirrored, WHITE, { size, weight: 800, align: 'center' });
}

export function drawRestOverlay(ctx, fr, w, h, mirrored) {
  const size = fontPx(h, 1.6);
  const done = fr.setsCompleted;
  screenBox(ctx, 0, h * 0.35, w, size * 3 + 20, w, mirrored, 'rgba(0,0,0,0.5)');
  screenText(ctx, `Set ${done} complete`, w / 2, h * 0.35 + size + 8, w, mirrored, GREEN, { size, weight: 800, align: 'center' });
  const sub = fr.restRemainingSec > 0
    ? `Rest ${fr.restRemainingSec}s — or press Start Next Set`
    : 'Stand in your stance, arms down, to begin';
  screenText(ctx, sub, w / 2, h * 0.35 + size * 2 + 14, w, mirrored, WHITE, { size: Math.round(size * 0.55), weight: 600, align: 'center' });
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
  const size = Math.max(10, Math.round(h * 0.022));
  const bw = Math.max(...rows.map((r) => measure(ctx, r, size, 500))) + 16;
  const bh = rows.length * (size + 4) + 10;
  const sx = 14;
  const sy = h - bh - 60;
  screenBox(ctx, sx, sy, bw, bh, w, mirrored, 'rgba(0,0,0,0.65)');
  rows.forEach((r, i) => {
    screenText(ctx, r, sx + 8, sy + 6 + (i + 1) * (size + 4) - 4, w, mirrored, 'rgb(180,255,180)', { size, weight: 500 });
  });
}

/** Full overlay for one frame (skeleton is drawn by the engine loop). */
export function drawLateralRaiseOverlay(ctx, fr, frame) {
  if (!fr) return;
  const { width: w, height: h } = frame;
  const mirrored = frame.mirrored !== false;
  const g = fr.geometry;

  if (fr.phase === LR_PHASE.SETUP_STANCE) {
    if (g) drawStanceGuides(ctx, g, fr.stanceResult, h);
    drawStanceChecklist(ctx, fr, w, h, mirrored);
  } else if (g) {
    drawShoulderLine(ctx, g, fr.calib, mirrored, h);
  }

  drawActivityBadge(ctx, fr, w, h, mirrored);
  drawCounters(ctx, fr, w, h, mirrored);
  if (fr.phase === LR_PHASE.REST_BETWEEN_SETS) drawRestOverlay(ctx, fr, w, h, mirrored);
  drawFeedback(ctx, fr, w, h, mirrored);
  if (LR_CFG.debug) drawDebugReadout(ctx, fr, w, h, mirrored);
}
