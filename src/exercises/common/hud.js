// Canvas HUD shared by the front-view dumbbell exercises.
//
// Body-anchored guides use canvas pixel coordinates. HUD elements (badge,
// counters, feedback) are placed in SCREEN coordinates: the front-view canvas
// is CSS-mirrored, so x is flipped and text is counter-flipped when
// `mirrored` is true.
//
// Every widget reads the standard flow frame result (`fr`): activity,
// activityReason, timerPaused, currentSet, targetSets, setRepCount,
// targetReps, banner, mistake, feedback, status, statusKind, sustainedCues,
// setsCompleted, restRemainingSec, stanceResult, stanceHoldPct.

import { nowSec } from '../../core/landmarks';

export const HUD_CYAN = 'rgb(0,200,255)';
export const HUD_GREEN = 'rgb(0,255,80)';
export const HUD_RED = 'rgb(255,40,40)';
export const HUD_AMBER = 'rgb(255,190,0)';
export const HUD_GREY = 'rgba(200,200,200,0.6)';
export const HUD_WHITE = 'rgb(255,255,255)';
export const HUD_PANEL = 'rgba(11,17,32,0.72)';

export function blink() {
  return Math.floor(nowSec() * 4) % 2 === 0 ? 'rgb(255,0,0)' : 'rgb(120,0,0)';
}

export function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function fontPx(h, scale = 1) {
  return Math.round(Math.max(12, h * 0.028) * scale);
}

/** Text at a CANVAS point, readable on a mirrored canvas. */
export function label(ctx, text, x, y, mirrored, color, { size = 11, align = 'left' } = {}) {
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
export function screenText(ctx, text, sx, sy, w, mirrored, color, { size = 14, weight = 700, align = 'left' } = {}) {
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
export function screenBox(ctx, sx, sy, bw, bh, w, mirrored, fill) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(mirrored ? w - sx - bw : sx, sy, bw, bh);
  ctx.restore();
}

export function measure(ctx, text, size, weight = 700) {
  ctx.save();
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  ctx.restore();
  return tw;
}

// ── Stance check ────────────────────────────────────────────────────────────

/** Min / max foot rails around the ankles. */
export function drawStanceGuides(ctx, g, stance, h, { stanceMin, stanceMax, narrowKey, wideKey }) {
  if (!g?.feetOk) return;
  const cx = g.shMid.x;
  const halfMin = (stanceMin * g.sw) / 2;
  const halfMax = (stanceMax * g.sw) / 2;
  const halfLen = Math.max(8, 0.03 * h);
  const keys = new Set(stance?.cueKeys || []);
  const narrow = keys.has(narrowKey);
  const wide = keys.has(wideKey);
  const ok = !narrow && !wide;

  ctx.save();
  for (const [d, ankle] of [[-1, g.la.x < g.ra.x ? g.la : g.ra], [1, g.la.x < g.ra.x ? g.ra : g.la]]) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = narrow ? blink() : HUD_CYAN;
    line(ctx, cx + d * halfMin, ankle.y - halfLen, cx + d * halfMin, ankle.y + halfLen);
    ctx.strokeStyle = wide ? blink() : HUD_CYAN;
    line(ctx, cx + d * halfMax, ankle.y - halfLen, cx + d * halfMax, ankle.y + halfLen);
    dot(ctx, ankle.x, ankle.y, 5, ok ? HUD_GREEN : HUD_RED);
  }
  ctx.restore();
}

const DEFAULT_STANCE_ROWS = [
  ['Facing the camera', 'facing'],
  ['Standing upright', 'upright'],
  ['Feet shoulder width', 'feet'],
  ['Arms down at sides', 'armsDown'],
];

/** Pass/fail list of the stance rules + hold progress bar. */
export function drawStanceChecklist(ctx, fr, w, h, mirrored, { stanceMin, stanceMax, rows = DEFAULT_STANCE_ROWS }) {
  const st = fr.stanceResult;
  const checks = st?.checks || {};
  const size = fontPx(h, 0.85);
  const items = rows.map(([text, key]) => [text, checks[key]]);
  const pad = 10;
  const rowH = size + 8;
  const bw = Math.max(...items.map(([t]) => measure(ctx, `✓  ${t}`, size, 600))) + pad * 2;
  const bh = rowH * items.length + pad * 2 + size + 6;
  const sx = 14;
  const sy = Math.round(h * 0.16);

  screenBox(ctx, sx, sy, bw, bh, w, mirrored, HUD_PANEL);
  screenText(ctx, 'STANCE CHECK', sx + pad, sy + pad + size - 2, w, mirrored, HUD_WHITE, { size, weight: 800 });
  items.forEach(([text, pass], i) => {
    const y = sy + pad + size + 6 + (i + 1) * rowH - 6;
    screenText(ctx, `${pass ? '✓' : '✗'}  ${text}`, sx + pad, y, w, mirrored, pass ? HUD_GREEN : HUD_AMBER, { size, weight: 600 });
  });
  if (st?.values?.stanceRatio != null) {
    const r = st.values.stanceRatio.toFixed(2);
    screenText(
      ctx, `Feet ratio ${r} (${stanceMin}–${stanceMax})`,
      sx, sy + bh + size + 4, w, mirrored, HUD_GREY, { size: size - 2, weight: 600 },
    );
  }
  if (fr.stanceHoldPct != null) {
    const barW = bw;
    screenBox(ctx, sx, sy + bh + size + 12, barW, 6, w, mirrored, 'rgba(255,255,255,0.15)');
    screenBox(ctx, sx, sy + bh + size + 12, barW * fr.stanceHoldPct, 6, w, mirrored, HUD_GREEN);
  }
}

// ── HUD: activity badge, counters, feedback, rest ───────────────────────────

/**
 * EXERCISING / NOT DOING EXERCISE badge with a short reason.
 * `reasonLabels` maps activityReason → text; `warnReasons` get the orange fill.
 */
export function drawActivityBadge(ctx, fr, w, h, mirrored, { reasonLabels = {}, warnReasons = [] } = {}) {
  const exercising = fr.activity === 'exercising';
  const text = exercising ? 'EXERCISING' : 'NOT DOING EXERCISE';
  const size = fontPx(h, 0.9);
  const tw = measure(ctx, text, size, 800);
  const sx = 14;
  const sy = 12;
  const idleWarn = warnReasons.includes(fr.activityReason);
  const fill = exercising ? 'rgba(0,170,70,0.9)' : idleWarn ? 'rgba(230,120,0,0.9)' : 'rgba(90,90,90,0.9)';
  screenBox(ctx, sx, sy, tw + 20, size + 14, w, mirrored, fill);
  screenText(ctx, text, sx + 10, sy + size + 4, w, mirrored, HUD_WHITE, { size, weight: 800 });

  const reason = exercising ? '' : reasonLabels[fr.activityReason] || '';
  if (reason) {
    screenText(ctx, reason, sx + 2, sy + size * 2 + 16, w, mirrored, HUD_WHITE, { size: size - 2, weight: 600 });
  }
  if (fr.timerPaused) {
    screenText(ctx, 'Timer paused', sx + 2, sy + size * 3 + 22, w, mirrored, HUD_AMBER, { size: size - 2, weight: 700 });
  }
}

/** "Set X of Y · Rep N of M" (top-right). */
export function drawCounters(ctx, fr, w, h, mirrored) {
  const size = fontPx(h, 1.05);
  const setPart = fr.targetSets > 0 ? `Set ${fr.currentSet} of ${fr.targetSets}` : `Set ${fr.currentSet}`;
  const repPart = fr.targetReps > 0 ? `Rep ${fr.setRepCount} of ${fr.targetReps}` : `Rep ${fr.setRepCount}`;
  const text = `${setPart} · ${repPart}`;
  const tw = measure(ctx, text, size, 800);
  const sx = w - 14 - tw - 20;
  screenBox(ctx, sx, 12, tw + 20, size + 14, w, mirrored, HUD_PANEL);
  screenText(ctx, text, sx + 10, 12 + size + 4, w, mirrored, HUD_WHITE, { size, weight: 800 });
}

/** Banner (rep / set events), mistake box, and the bottom status line. */
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
    screenText(ctx, banner, cx, h * 0.2 + 4, w, mirrored, HUD_WHITE, { size: bSize, weight: 800, align: 'center' });
  }
  if (mistake) drawMistake(ctx, mistake, w, h, mirrored);
  if (!text) return;
  const warn = fr.statusKind === 'warn' || fr.statusKind === 'fail' || fr.sustainedCues?.length;
  const tw = measure(ctx, text, size, 700);
  const y = h - 24;
  screenBox(ctx, cx - tw / 2 - 12, y - size - 6, tw + 24, size + 16, w, mirrored, HUD_PANEL);
  screenText(ctx, text, cx, y, w, mirrored, warn ? HUD_AMBER : HUD_WHITE, { size, weight: 700, align: 'center' });
}

export function drawMistake(ctx, text, w, h, mirrored) {
  const size = fontPx(h, 1.25);
  const msg = `⚠ ${text}`;
  const tw = Math.min(measure(ctx, msg, size, 800), w - 60);
  const bx = w / 2 - tw / 2 - 16;
  const by = h * 0.3 - size;
  const bh = size + 22;
  screenBox(ctx, bx - 3, by - 3, tw + 38, bh + 6, w, mirrored, HUD_RED);
  screenBox(ctx, bx, by, tw + 32, bh, w, mirrored, 'rgba(90,0,0,0.88)');
  screenText(ctx, msg, w / 2, by + size + 6, w, mirrored, HUD_WHITE, { size, weight: 800, align: 'center' });
}

export function drawRestOverlay(ctx, fr, w, h, mirrored) {
  const size = fontPx(h, 1.6);
  const done = fr.setsCompleted;
  screenBox(ctx, 0, h * 0.35, w, size * 3 + 20, w, mirrored, 'rgba(0,0,0,0.5)');
  screenText(ctx, `Set ${done} complete`, w / 2, h * 0.35 + size + 8, w, mirrored, HUD_GREEN, { size, weight: 800, align: 'center' });
  const sub = fr.restRemainingSec > 0
    ? `Rest ${fr.restRemainingSec}s — or press Start Next Set`
    : 'Stand in your stance, arms down, to begin';
  screenText(ctx, sub, w / 2, h * 0.35 + size * 2 + 14, w, mirrored, HUD_WHITE, { size: Math.round(size * 0.55), weight: 600, align: 'center' });
}

/** Monospace-ish debug box (bottom-left) with one text row per line. */
export function drawDebugRows(ctx, rows, w, h, mirrored) {
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
