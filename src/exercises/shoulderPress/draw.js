// Canvas overlays for the standing shoulder press (front view).
// Every checked joint gets push-up-style tolerance rails so the allowed band
// is always visible (feet, torso lean, shoulder level, elbow out, wrist stack,
// top wrist width, height / depth). Geometry is already in canvas pixels.
//
// The front-view canvas is CSS-mirrored, so text is drawn counter-flipped when
// `mirrored` is true to stay readable.

import { nowSec } from '../../core/landmarks';
import { SP_CFG } from './config';
import {
  pressLines,
  checkStance,
  checkTorsoLean,
  checkShoulderLevel,
  checkForearms,
  checkElbowTuck,
  checkTopWidth,
  checkSymmetry,
} from './poseChecks';

const CYAN = 'rgb(0,200,255)';
const GREEN = 'rgb(0,255,80)';
const RED = 'rgb(255,0,0)';
const AMBER = 'rgb(255,190,0)';
const GREY = 'rgba(200,200,200,0.55)';
const MINT = 'rgba(100,255,200,0.95)';
const LAVENDER = 'rgb(180,170,220)';

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

/** Draw text at canvas point (x, y), readable on a mirrored canvas. */
function label(ctx, text, x, y, mirrored, color, align = 'left') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.translate(x, y);
  if (mirrored) ctx.scale(-1, 1);
  ctx.textAlign = align;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Outward pixel direction (+1 / -1) for an anatomical side. */
function dir(g, side) {
  return side === 'left' ? g.outSign : -g.outSign;
}

function halfLenPx(h) {
  return Math.max(8, SP_CFG.line_half_len_ratio * h);
}

// ── Stance: allowed ankle positions around the shoulder midline ─────────────

export function drawStanceGuides(ctx, g, stance, h) {
  const st = stance || checkStance(g, 1);
  if (!g.feetOk || !st || st.skipped) return;
  const halfLen = halfLenPx(h);
  const cx = g.shMid.x;
  const halfMin = (st.min * g.sw) / 2;
  const halfMax = (st.max * g.sw) / 2;
  const narrow = st.status === 'narrow';
  const wide = st.status === 'wide';

  ctx.save();
  for (const side of ['left', 'right']) {
    const d = dir(g, side);
    const ankle = side === 'left' ? g.la : g.ra;
    const y0 = ankle.y - halfLen;
    const y1 = ankle.y + halfLen;
    ctx.lineWidth = 2;
    ctx.strokeStyle = narrow ? blink() : CYAN;
    line(ctx, cx + d * halfMin, y0, cx + d * halfMin, y1);
    ctx.strokeStyle = wide ? blink() : CYAN;
    line(ctx, cx + d * halfMax, y0, cx + d * halfMax, y1);
    ctx.lineWidth = 1;
    ctx.strokeStyle = st.ok ? GREEN : RED;
    line(ctx, cx + (d * g.sw) / 2, y0, cx + (d * g.sw) / 2, y1);
    dot(ctx, ankle.x, ankle.y, 4, st.ok ? GREEN : RED);
  }
  ctx.restore();
}

// ── Torso lean: plumb + horizontal tolerance rails at shoulder mid ──────────

export function drawTorsoLeanGuides(ctx, g, torso, h) {
  const t = torso || checkTorsoLean(g);
  if (!t) return;
  const halfLen = halfLenPx(h);
  const tolPx = SP_CFG.torso_lean_ratio_max * g.sw;
  const hx = g.hipMid.x;

  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = GREY;
  ctx.lineWidth = 1;
  line(ctx, hx, g.hipMid.y, hx, g.shY - 0.3 * g.sw);
  ctx.setLineDash([]);

  ctx.lineWidth = 2;
  ctx.strokeStyle = t.ok ? CYAN : blink();
  line(ctx, hx - tolPx, g.shY - halfLen, hx - tolPx, g.shY + halfLen);
  line(ctx, hx + tolPx, g.shY - halfLen, hx + tolPx, g.shY + halfLen);

  // Ideal center rail
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.ok ? GREEN : RED;
  line(ctx, hx, g.shY - halfLen, hx, g.shY + halfLen);

  const torsoColor = t.ok ? (t.near ? AMBER : GREEN) : RED;
  ctx.strokeStyle = torsoColor;
  ctx.lineWidth = 2;
  line(ctx, g.hipMid.x, g.hipMid.y, g.shMid.x, g.shMid.y);
  dot(ctx, g.shMid.x, g.shMid.y, 5, torsoColor);
  ctx.restore();
}

// ── Shoulder level: horizontal tolerance band around mean shoulder Y ────────

export function drawShoulderLevelGuides(ctx, g, shoulder, h) {
  const sh = shoulder || checkShoulderLevel(g);
  if (!sh) return;
  const tolPx = SP_CFG.shoulder_level_ratio_max * g.sw;
  const midY = (g.ls.y + g.rs.y) / 2;
  const x0 = Math.min(g.ls.x, g.rs.x) - 0.15 * g.sw;
  const x1 = Math.max(g.ls.x, g.rs.x) + 0.15 * g.sw;

  ctx.save();
  // Allowed Y band (upper / lower rails)
  ctx.lineWidth = 2;
  ctx.strokeStyle = sh.ok ? CYAN : blink();
  line(ctx, x0, midY - tolPx, x1, midY - tolPx);
  line(ctx, x0, midY + tolPx, x1, midY + tolPx);

  // Ideal level line through mean Y
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = sh.ok ? GREEN : RED;
  line(ctx, x0, midY, x1, midY);
  ctx.setLineDash([]);

  // Shoulder-to-shoulder connector + dots
  ctx.lineWidth = 2;
  ctx.strokeStyle = sh.ok ? 'rgba(0,255,80,0.85)' : blink();
  line(ctx, g.ls.x, g.ls.y, g.rs.x, g.rs.y);
  dot(ctx, g.ls.x, g.ls.y, 5, Math.abs(g.ls.y - midY) <= tolPx ? GREEN : RED);
  dot(ctx, g.rs.x, g.rs.y, 5, Math.abs(g.rs.y - midY) <= tolPx ? GREEN : RED);

  // Short vertical rails at each shoulder showing tolerance height
  for (const s of [g.ls, g.rs]) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = GREY;
    line(ctx, s.x, midY - tolPx - 2, s.x, midY + tolPx + 2);
  }
  ctx.restore();
}

/** @deprecated Prefer drawTorsoLeanGuides + drawShoulderLevelGuides. */
export function drawTorsoGuide(ctx, g, torso, shoulder, h) {
  drawTorsoLeanGuides(ctx, g, torso, h);
  drawShoulderLevelGuides(ctx, g, shoulder, h);
}

// ── Wrist stack over elbow (forearm rails) ──────────────────────────────────

function drawForearmRails(ctx, g, side, band, h) {
  if (!band) return;
  const d = dir(g, side);
  const elbow = side === 'left' ? g.le : g.re;
  const wrist = side === 'left' ? g.lw : g.rw;
  const halfLen = halfLenPx(h);
  const xLo = elbow.x + d * band.lo * g.sw;
  const xHi = elbow.x + d * band.hi * g.sw;
  const xIdeal = elbow.x; // stacked = wrist x ≈ elbow x in outward frame (dx≈0)
  const y0 = wrist.y - halfLen;
  const y1 = wrist.y + halfLen;
  const inCross = band.dx < band.lo;
  const outCross = band.dx > band.hi;

  ctx.lineWidth = 2;
  ctx.strokeStyle = inCross ? blink() : CYAN;
  line(ctx, xLo, y0, xLo, y1);
  ctx.strokeStyle = outCross ? blink() : CYAN;
  line(ctx, xHi, y0, xHi, y1);

  // Ideal center rail (wrist stacked above elbow)
  ctx.lineWidth = 1;
  ctx.strokeStyle = band.ok ? GREEN : RED;
  line(ctx, xIdeal, y0, xIdeal, y1);

  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = GREY;
  line(ctx, elbow.x, elbow.y, elbow.x, wrist.y);
  ctx.setLineDash([]);

  ctx.lineWidth = 2;
  ctx.strokeStyle = band.ok ? 'rgb(120,180,230)' : RED;
  line(ctx, elbow.x, wrist.y, wrist.x, wrist.y);
  dot(ctx, wrist.x, wrist.y, 5, band.ok ? GREEN : RED);
  dot(ctx, elbow.x, elbow.y, 4, CYAN);
}

export function drawWristStackGuides(ctx, g, forearm, h) {
  const f = forearm?.left ? forearm : checkForearms(g);
  if (!f?.left) return;
  ctx.save();
  drawForearmRails(ctx, g, 'left', f.left, h);
  drawForearmRails(ctx, g, 'right', f.right, h);
  ctx.restore();
}

// ── Elbow min-out (tuck) rails relative to each shoulder ────────────────────

function drawElbowOutRail(ctx, g, side, elbowCheck, h) {
  const d = dir(g, side);
  const shoulder = side === 'left' ? g.ls : g.rs;
  const elbow = side === 'left' ? g.le : g.re;
  const halfLen = halfLenPx(h);
  const min = elbowCheck?.min ?? SP_CFG.elbow_tuck_min_ratio;
  const xMin = shoulder.x + d * min * g.sw;
  const out = side === 'left' ? elbowCheck?.lOut : elbowCheck?.rOut;
  const tucked = out != null ? out < min : elbowCheck?.cueKeys?.includes(
    side === 'left' ? 'sp_elbow_left_tucked' : 'sp_elbow_right_tucked',
  );

  ctx.lineWidth = 2;
  ctx.strokeStyle = tucked ? blink() : MINT;
  line(ctx, xMin, elbow.y - halfLen, xMin, elbow.y + halfLen);

  // Ideal open position slightly outside the min rail
  const xIdeal = shoulder.x + d * Math.max(min, 0.35) * g.sw;
  ctx.lineWidth = 1;
  ctx.strokeStyle = tucked ? RED : GREEN;
  line(ctx, xIdeal, elbow.y - halfLen * 0.6, xIdeal, elbow.y + halfLen * 0.6);

  ctx.lineWidth = 1;
  ctx.strokeStyle = GREY;
  line(ctx, shoulder.x, shoulder.y, elbow.x, elbow.y);
  dot(ctx, elbow.x, elbow.y, 5, tucked ? RED : GREEN);
}

export function drawElbowOutGuides(ctx, g, elbow, h) {
  const e = elbow?.min != null ? elbow : checkElbowTuck(g);
  ctx.save();
  drawElbowOutRail(ctx, g, 'left', e, h);
  drawElbowOutRail(ctx, g, 'right', e, h);
  ctx.restore();
}

// ── Top wrist width rails (must stay over shoulder, not flare out) ──────────

function drawTopWidthRail(ctx, g, side, topCheck, h) {
  const d = dir(g, side);
  const shoulder = side === 'left' ? g.ls : g.rs;
  const wrist = side === 'left' ? g.lw : g.rw;
  const halfLen = halfLenPx(h);
  const max = topCheck?.max ?? SP_CFG.top_wide_ratio_max;
  const xMax = shoulder.x + d * max * g.sw;
  const out = side === 'left' ? topCheck?.lOut : topCheck?.rOut;
  const tooWide = out != null ? out > max : topCheck?.cueKeys?.includes(
    side === 'left' ? 'sp_top_wide_left' : 'sp_top_wide_right',
  );

  ctx.lineWidth = 2;
  ctx.strokeStyle = tooWide ? blink() : LAVENDER;
  line(ctx, xMax, wrist.y - halfLen, xMax, wrist.y + halfLen);

  // Ideal: wrist stacked over shoulder
  ctx.lineWidth = 1;
  ctx.strokeStyle = tooWide ? RED : GREEN;
  line(ctx, shoulder.x, wrist.y - halfLen * 0.6, shoulder.x, wrist.y + halfLen * 0.6);

  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = GREY;
  line(ctx, shoulder.x, shoulder.y, wrist.x, wrist.y);
  ctx.setLineDash([]);
  dot(ctx, wrist.x, wrist.y, 5, tooWide ? RED : GREEN);
}

export function drawWristTopWidthGuides(ctx, g, top, h) {
  const t = top?.max != null ? top : checkTopWidth(g);
  ctx.save();
  drawTopWidthRail(ctx, g, 'left', t, h);
  drawTopWidthRail(ctx, g, 'right', t, h);
  ctx.restore();
}

// ── Left/right wrist evenness (symmetry) ────────────────────────────────────

export function drawWristSymmetryGuides(ctx, g, symmetry, h) {
  const s = symmetry || checkSymmetry(g);
  const tolPx = SP_CFG.symmetry_ratio_max * g.sw;
  const midY = (g.lw.y + g.rw.y) / 2;
  const x0 = Math.min(g.lw.x, g.rw.x);
  const x1 = Math.max(g.lw.x, g.rw.x);

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = s.ok ? CYAN : blink();
  line(ctx, x0, midY - tolPx, x1, midY - tolPx);
  line(ctx, x0, midY + tolPx, x1, midY + tolPx);

  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = s.ok ? GREEN : RED;
  line(ctx, g.lw.x, g.lw.y, g.rw.x, g.rw.y);
  ctx.setLineDash([]);
  dot(ctx, g.lw.x, g.lw.y, 4, s.ok ? GREEN : RED);
  dot(ctx, g.rw.x, g.rw.y, 4, s.ok ? GREEN : RED);
  ctx.restore();
}

export function drawArmGuides(ctx, g, posture, h) {
  if (!g) return;
  drawWristStackGuides(ctx, g, posture?.forearm, h);
  drawElbowOutGuides(ctx, g, posture?.elbow, h);
  drawWristTopWidthGuides(ctx, g, posture?.top, h);
  drawWristSymmetryGuides(ctx, g, posture?.symmetry, h);
}

/**
 * Full tolerance overlay for ready / exercise / done — every joint band visible.
 * Stance is optional (usually locked after setup).
 */
export function drawAllToleranceGuides(ctx, g, h, mirrored, {
  posture = null,
  showStance = false,
  showShoulders = true,
  showArms = true,
  armLenRef = null,
} = {}) {
  if (!g) return;

  if (showStance) drawStanceGuides(ctx, g, null, h);
  if (showShoulders) {
    drawTorsoLeanGuides(ctx, g, null, h);
    drawShoulderLevelGuides(ctx, g, null, h);
  }
  if (showArms) drawArmGuides(ctx, g, posture, h);
  if (armLenRef != null) drawPressLines(ctx, g, armLenRef, mirrored);
}

// ── Height / depth reference lines ──────────────────────────────────────────

export function drawPressLines(ctx, g, armLenRef, mirrored) {
  const L = pressLines(g, armLenRef);
  const xs = [g.ls.x, g.rs.x, g.le.x, g.re.x, g.lw.x, g.rw.x];
  const x0 = Math.min(...xs) - 0.35 * g.sw;
  const x1 = Math.max(...xs) + 0.35 * g.sw;
  const labelX = mirrored ? x1 : x0;
  const lowerWristY = Math.max(g.lw.y, g.rw.y);
  const deepestElbowY = Math.max(g.le.y, g.re.y);
  const reachedTop = lowerWristY <= L.topY;
  const tooDeep = deepestElbowY > L.tooDeepY;

  ctx.save();

  // Target height the wrists should reach.
  ctx.setLineDash([10, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = reachedTop ? GREEN : CYAN;
  line(ctx, x0, L.topY, x1, L.topY);
  ctx.setLineDash([]);
  label(ctx, 'TARGET HEIGHT', labelX, L.topY - 6, mirrored, reachedTop ? GREEN : CYAN);

  // Elbow zone at the bottom: between depthHighY and tooDeepY.
  ctx.fillStyle = 'rgba(0,255,80,0.08)';
  ctx.fillRect(x0, L.depthHighY, x1 - x0, L.tooDeepY - L.depthHighY);
  ctx.lineWidth = 1;
  ctx.strokeStyle = CYAN;
  line(ctx, x0, L.depthHighY, x1, L.depthHighY);
  ctx.strokeStyle = 'rgba(0,255,80,0.9)';
  ctx.setLineDash([4, 4]);
  line(ctx, x0, L.shoulderY, x1, L.shoulderY);
  ctx.setLineDash([]);
  label(ctx, 'ELBOWS HERE', labelX, L.depthHighY - 4, mirrored, CYAN);

  // Too-deep line.
  ctx.lineWidth = 2;
  ctx.strokeStyle = tooDeep ? blink() : 'rgb(0,90,220)';
  line(ctx, x0, L.tooDeepY, x1, L.tooDeepY);
  label(ctx, 'TOO LOW', labelX, L.tooDeepY + 14, mirrored, tooDeep ? RED : 'rgb(90,150,255)');

  for (const e of [g.le, g.re]) {
    const inZone = e.y >= L.depthHighY && e.y <= L.tooDeepY;
    dot(ctx, e.x, e.y, 5, e.y > L.tooDeepY ? RED : inZone ? GREEN : CYAN);
  }
  // Wrist dots vs target height
  for (const w of [g.lw, g.rw]) {
    dot(ctx, w.x, w.y, 4, w.y <= L.topY ? GREEN : CYAN);
  }
  ctx.restore();
}

// ── Height bar + score chip (screen-right / screen-top) ─────────────────────

export function drawHeightBar(ctx, progress, w, h, mirrored) {
  const barW = 18;
  const margin = 14;
  const x = mirrored ? margin : w - margin - barW;
  const y0 = Math.round(h * 0.22);
  const y1 = Math.round(h * 0.78);
  const p = Math.max(0, Math.min(1, progress || 0));

  ctx.save();
  ctx.fillStyle = 'rgba(40,40,40,0.85)';
  ctx.fillRect(x - 2, y0 - 2, barW + 4, y1 - y0 + 4);
  const fillTop = y1 - p * (y1 - y0);
  ctx.fillStyle = p >= 1 ? 'rgb(0,170,70)' : 'rgb(0,120,200)';
  ctx.fillRect(x, fillTop, barW, y1 - fillTop);
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 2;
  line(ctx, x - 5, y0, x + barW + 5, y0);
  label(ctx, 'HEIGHT', x + barW / 2, y0 - 10, mirrored, 'rgb(220,220,220)', 'center');
  ctx.restore();
}

export function drawScoreChip(ctx, summary, lastRep, w, mirrored) {
  if (!summary || !summary.reps) return;
  const text = `Form ${summary.formScore}%  ·  Rep ${lastRep?.index ?? summary.reps}: ${lastRep?.score ?? summary.lastScore}%`;
  const x = mirrored ? w - 14 : 14;
  const color = summary.formScore >= 80 ? GREEN : summary.formScore >= 60 ? AMBER : RED;
  ctx.save();
  ctx.font = '700 14px system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(11,17,32,0.72)';
  if (mirrored) ctx.fillRect(x - tw - 6, 12, tw + 12, 24);
  else ctx.fillRect(x - 6, 12, tw + 12, 24);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.translate(x, 29);
  if (mirrored) ctx.scale(-1, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
