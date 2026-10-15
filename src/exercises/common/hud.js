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
import { ankleStance } from './frontStance';

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

const MIN_FONT_PX = 10;

/**
 * Base text size for a w×h canvas. Follows the height on landscape frames
 * and is capped by the width on portrait ones, so text keeps the same
 * proportion on any orientation / resolution (SD → UHD).
 */
export function fontPx(h, scale = 1, w = Infinity) {
  const base = Math.min(h, w * 1.25);
  return Math.round(Math.max(12, base * 0.028) * scale);
}

/** Edge margin for HUD boxes. */
export function hudMargin(w, h) {
  return Math.max(8, Math.round(Math.min(w, h) * 0.025));
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

function wrapWords(ctx, text, size, weight, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && measure(ctx, next, size, weight) > maxW) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Largest size ≤ `size` at which `text` fits in `maxLines` word-wrapped lines
 * no wider than `maxW`.
 * @returns {{ size: number, lines: string[], width: number }}
 */
export function fitText(ctx, text, size, weight, maxW, maxLines = 1) {
  let s = Math.max(MIN_FONT_PX, size);
  for (;;) {
    const lines = maxLines > 1 ? wrapWords(ctx, text, s, weight, maxW) : [String(text)];
    const widest = Math.max(0, ...lines.map((l) => measure(ctx, l, s, weight)));
    if ((lines.length <= maxLines && widest <= maxW) || s <= MIN_FONT_PX) {
      return { size: s, lines, width: Math.min(widest, maxW) };
    }
    s = Math.max(MIN_FONT_PX, Math.floor(s * 0.9));
  }
}

/**
 * Horizontally centred, word-wrapped text box whose bottom edge sits at
 * `bottomY`; it never exceeds the frame width.
 * @returns {number} y of the box's top edge
 */
export function drawTextBox(ctx, text, bottomY, w, h, mirrored, {
  size, weight = 700, color = HUD_WHITE, fill = HUD_PANEL, border = null, maxLines = 3,
} = {}) {
  const margin = hudMargin(w, h);
  const bd = border ? 3 : 0;
  const pad = Math.max(6, Math.round(size * 0.5));
  const fit = fitText(ctx, text, size, weight, Math.max(20, w - 2 * (margin + pad + bd)), maxLines);
  const lineH = Math.round(fit.size * 1.25);
  const bw = fit.width + 2 * pad;
  const bh = lineH * fit.lines.length + pad;
  const bx = (w - bw) / 2;
  const by = bottomY - bd - bh;
  if (border) screenBox(ctx, bx - bd, by - bd, bw + 2 * bd, bh + 2 * bd, w, mirrored, border);
  screenBox(ctx, bx, by, bw, bh, w, mirrored, fill);
  fit.lines.forEach((ln, i) => {
    const baseline = by + pad / 2 + i * lineH + Math.round(fit.size * 0.95);
    screenText(ctx, ln, w / 2, baseline, w, mirrored, color, { size: fit.size, weight, align: 'center' });
  });
  return by - bd;
}

// ── Stance check ────────────────────────────────────────────────────────────

/** Min / max rails per ankle; each ankle turns red when it is outside its own rails. */
export function drawStanceGuides(ctx, g, stance, h, { stanceMin, stanceMax }) {
  if (!g?.feetOk) return;
  const cx = g.shMid.x;
  const halfMin = (stanceMin * g.sw) / 2;
  const halfMax = (stanceMax * g.sw) / 2;
  const halfLen = Math.max(8, 0.03 * h);
  const ankles = ankleStance(g, stanceMin, stanceMax);

  ctx.save();
  for (const [d, s] of [[-1, ankles.left], [1, ankles.right]]) {
    const { ankle, status } = s;
    ctx.lineWidth = 2;
    ctx.strokeStyle = status === 'narrow' ? blink() : HUD_CYAN;
    line(ctx, cx + d * halfMin, ankle.y - halfLen, cx + d * halfMin, ankle.y + halfLen);
    ctx.strokeStyle = status === 'wide' ? blink() : HUD_CYAN;
    line(ctx, cx + d * halfMax, ankle.y - halfLen, cx + d * halfMax, ankle.y + halfLen);
    dot(ctx, ankle.x, ankle.y, 5, status === 'ok' ? HUD_GREEN : HUD_RED);
  }
  ctx.restore();
}

const DEFAULT_STANCE_ROWS = [
  ['Standing upright', 'upright'],
  ['Feet shoulder width', 'feet'],
  ['Arms down at sides', 'armsDown'],
];

/** Pass/fail list of the stance rules + hold progress bar. */
export function drawStanceChecklist(ctx, fr, w, h, mirrored, { stanceMin, stanceMax, rows = DEFAULT_STANCE_ROWS }) {
  const st = fr.stanceResult;
  const checks = st?.checks || {};
  const items = rows.map(([text, key]) => [text, checks[key]]);
  const pad = 10;
  const sx = 14;
  const widestRow = items.map(([t]) => `✓  ${t}`).reduce((a, b) => (a.length >= b.length ? a : b), '');
  const size = fitText(ctx, widestRow, fontPx(h, 0.85, w), 600, w - 2 * sx - pad * 2).size;
  const rowH = size + 8;
  const bw = Math.max(...items.map(([t]) => measure(ctx, `✓  ${t}`, size, 600))) + pad * 2;
  const bh = rowH * items.length + pad * 2 + size + 6;
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
  const sx = 14;
  // Shares the top row with the counters: at most half the width each.
  const size = fitText(ctx, text, fontPx(h, 0.9, w), 800, w / 2 - sx - 20).size;
  const tw = measure(ctx, text, size, 800);
  const sy = 12;
  const idleWarn = warnReasons.includes(fr.activityReason);
  const fill = exercising ? 'rgba(0,170,70,0.9)' : idleWarn ? 'rgba(230,120,0,0.9)' : 'rgba(90,90,90,0.9)';
  screenBox(ctx, sx, sy, tw + 20, size + 14, w, mirrored, fill);
  screenText(ctx, text, sx + 10, sy + size + 4, w, mirrored, HUD_WHITE, { size, weight: 800 });

  const reason = exercising ? '' : reasonLabels[fr.activityReason] || '';
  if (reason) {
    const rSize = fitText(ctx, reason, size - 2, 600, w / 2 - sx - 2).size;
    screenText(ctx, reason, sx + 2, sy + size * 2 + 16, w, mirrored, HUD_WHITE, { size: rSize, weight: 600 });
  }
  if (fr.timerPaused) {
    screenText(ctx, 'Timer paused', sx + 2, sy + size * 3 + 22, w, mirrored, HUD_AMBER, { size: size - 2, weight: 700 });
  }
}

/** "Set X of Y · Rep N of M" (top-right). */
export function drawCounters(ctx, fr, w, h, mirrored) {
  const setPart = fr.targetSets > 0 ? `Set ${fr.currentSet} of ${fr.targetSets}` : `Set ${fr.currentSet}`;
  const repPart = fr.targetReps > 0 ? `Rep ${fr.setRepCount} of ${fr.targetReps}` : `Rep ${fr.setRepCount}`;
  const text = `${setPart} · ${repPart}`;
  const size = fitText(ctx, text, fontPx(h, 1.05, w), 800, w / 2 - 14 - 20).size;
  const tw = measure(ctx, text, size, 800);
  const sx = w - 14 - tw - 20;
  screenBox(ctx, sx, 12, tw + 20, size + 14, w, mirrored, HUD_PANEL);
  screenText(ctx, text, sx + 10, 12 + size + 4, w, mirrored, HUD_WHITE, { size, weight: 800 });
}

/**
 * Bottom-anchored text stack, so nothing covers the face: status line at the
 * very bottom, the mistake box above it, the rep / set banner above that.
 * Every box word-wraps to the frame width.
 */
export function drawFeedback(ctx, fr, w, h, mirrored) {
  const banner = fr.banner;
  const mistake = fr.mistake;
  const feedback = fr.feedback && fr.feedback !== mistake ? fr.feedback : '';
  const text = feedback || fr.status || '';
  const margin = hudMargin(w, h);
  const gap = Math.max(4, Math.round(margin * 0.5));

  let bottom = h - margin;
  if (text) {
    const warn = fr.statusKind === 'warn' || fr.statusKind === 'fail' || fr.sustainedCues?.length;
    bottom = drawTextBox(ctx, text, bottom, w, h, mirrored, {
      size: fontPx(h, 1.0, w), weight: 700, color: warn ? HUD_AMBER : HUD_WHITE, maxLines: 2,
    }) - gap;
  }
  if (mistake) bottom = drawMistake(ctx, mistake, w, h, mirrored, bottom) - gap;
  if (banner) {
    drawTextBox(ctx, banner, bottom, w, h, mirrored, {
      size: fontPx(h, 1.3, w), weight: 800, fill: 'rgba(0,0,0,0.55)', maxLines: 2,
    });
  }
}

/**
 * Red mistake box, centred, bottom edge at `bottomY` (default: frame bottom).
 * @returns {number} y of the box's top edge
 */
export function drawMistake(ctx, text, w, h, mirrored, bottomY = h - hudMargin(w, h)) {
  return drawTextBox(ctx, `⚠ ${text}`, bottomY, w, h, mirrored, {
    size: fontPx(h, 1.2, w), weight: 800, fill: 'rgba(90,0,0,0.85)', border: HUD_RED, maxLines: 3,
  });
}

export function drawRestOverlay(ctx, fr, w, h, mirrored) {
  const margin = hudMargin(w, h);
  const done = fr.setsCompleted;
  const title = `Set ${done} complete`;
  const sub = fr.restRemainingSec > 0
    ? `Rest ${fr.restRemainingSec}s — or press Start Next Set`
    : 'Stand in your stance, arms down, to begin';
  const size = fitText(ctx, title, fontPx(h, 1.6, w), 800, w - 2 * margin).size;
  const sub1 = fitText(ctx, sub, Math.round(size * 0.55), 600, w - 2 * margin, 2);
  const subH = Math.round(sub1.size * 1.25);
  screenBox(ctx, 0, h * 0.35, w, size + 14 + subH * sub1.lines.length + 16, w, mirrored, 'rgba(0,0,0,0.5)');
  screenText(ctx, title, w / 2, h * 0.35 + size + 8, w, mirrored, HUD_GREEN, { size, weight: 800, align: 'center' });
  sub1.lines.forEach((ln, i) => {
    screenText(ctx, ln, w / 2, h * 0.35 + size + 14 + (i + 1) * subH, w, mirrored, HUD_WHITE, {
      size: sub1.size, weight: 600, align: 'center',
    });
  });
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
