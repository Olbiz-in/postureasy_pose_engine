// Canvas overlays for the single-arm dumbbell row (side / three-quarter view).
//
// Body-anchored guides are drawn in the torso frame (see config.js) in canvas
// pixel coordinates: the torso line, the TOP band along it, the START line
// (calibrated hanging elbow) and the ELBOW LANE the elbow should pass behind
// near the top. The shared HUD (badge, counters, feedback, position
// checklist) lives in ../common/hud.js.

import { SR_CFG } from './config';
import { bodyPoint, rowLines } from './poseChecks';
import { SR_PHASE } from './SingleArmDumbbellRowFlow';
import { SR_ARM_STATE } from './SingleArmDumbbellRowRepTracker';
import {
  HUD_CYAN as CYAN, HUD_GREEN as GREEN, HUD_RED as RED, HUD_AMBER as AMBER,
  HUD_GREY as GREY, HUD_WHITE as WHITE, HUD_PANEL as PANEL,
  blink, line, dot, label, fontPx, screenText, screenBox,
  drawStanceChecklist, drawActivityBadge, drawCounters,
  drawFeedback, drawRestOverlay, drawDebugRows,
} from '../common/hud';

const REASON_LABEL = {
  sr_setup: 'Position check',
  sr_ready: 'Get ready',
  sr_out_of_frame: 'Out of frame',
  sr_low_confidence: 'Arm not clearly visible',
  sr_not_in_position: 'Out of row position',
  sr_not_side_on: 'Not side-on',
  sr_switching_side: 'Switching arm',
  sr_invalid_start: 'Set start position',
  sr_arm_resting: 'Arm resting',
  sr_resting_between_sets: 'Resting between sets',
  sr_complete: 'Session complete',
};
const WARN_REASONS = ['sr_out_of_frame', 'sr_low_confidence', 'sr_not_in_position', 'sr_not_side_on', 'sr_invalid_start'];

const SETUP_ROWS = [
  ['Side-on, working arm visible', 'view'],
  ['Bent over, supported on the bench', 'bentOver'],
  ['Arm hanging straight', 'armDown'],
];

// Extent of the guides along the back, × torso length (− = toward the head).
const GUIDE_FRONT = -0.35;
const GUIDE_BACK = 0.65;

function segment(ctx, a, b) {
  line(ctx, a.x, a.y, b.x, b.y);
}

/** Filled quad between two depths across the guide extent. */
function band(ctx, g, d0, d1, fill) {
  const pts = [
    bodyPoint(g, d0, GUIDE_FRONT), bodyPoint(g, d0, GUIDE_BACK),
    bodyPoint(g, d1, GUIDE_BACK), bodyPoint(g, d1, GUIDE_FRONT),
  ];
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fill();
}

// ── Torso-frame guides ──────────────────────────────────────────────────────

export function drawRowGuides(ctx, fr, mirrored, h) {
  const g = fr.geometry;
  if (!g) return;
  const a = g.arm;
  const cues = new Set(fr.sustainedCues || []);
  const size = Math.max(10, Math.round(h * 0.019));
  const L = rowLines(fr.calib);
  const atTop = fr.armState === SR_ARM_STATE.TOP;
  const torsoBad = cues.has('sr_torso_rotation');
  const flare = cues.has('sr_elbow_flare');
  const shrug = cues.has('sr_shoulder_shrug');
  // Labels go on the side of the guides away from the head.
  const labelAt = (depth) => bodyPoint(g, depth, GUIDE_BACK + 0.04);
  const align = (g.u.x < 0) !== mirrored ? 'left' : 'right';

  ctx.save();

  // Torso line (back), extended a little past the hip and shoulder.
  const head = bodyPoint(g, 0, -0.25);
  const tail = { x: g.hip.x - g.u.x * 0.1 * g.T, y: g.hip.y - g.u.y * 0.1 * g.T };
  ctx.lineWidth = 4;
  ctx.strokeStyle = torsoBad ? blink() : 'rgba(0,200,255,0.75)';
  segment(ctx, tail, head);

  if (fr.calib) {
    // TOP band: elbow within top_tolerance of the torso line.
    band(ctx, g, 0, L.topDepth, atTop ? 'rgba(0,255,80,0.22)' : 'rgba(0,200,255,0.12)');
    ctx.lineWidth = 3;
    ctx.strokeStyle = atTop ? GREEN : CYAN;
    segment(ctx, bodyPoint(g, L.topDepth, GUIDE_FRONT), bodyPoint(g, L.topDepth, GUIDE_BACK));

    // START line: calibrated hanging elbow + the start-zone edge.
    const inStart = fr.armState === SR_ARM_STATE.START || fr.armState === SR_ARM_STATE.WAIT_START;
    ctx.setLineDash([3, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = inStart ? 'rgba(0,255,80,0.8)' : GREY;
    segment(ctx, bodyPoint(g, L.restDepth, GUIDE_FRONT), bodyPoint(g, L.restDepth, GUIDE_BACK));
    ctx.lineWidth = 1;
    ctx.strokeStyle = GREY;
    segment(ctx, bodyPoint(g, L.startDepth, GUIDE_FRONT), bodyPoint(g, L.startDepth, GUIDE_BACK));

    // ELBOW LANE: near the top the elbow should be behind this line (hip side).
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = flare ? blink() : 'rgba(255,190,0,0.8)';
    segment(ctx, bodyPoint(g, -0.05, L.laneBack), bodyPoint(g, L.startDepth, L.laneBack));
    ctx.setLineDash([]);

    const top = labelAt(L.topDepth);
    const rest = labelAt(L.restDepth);
    const lane = bodyPoint(g, L.startDepth + 0.08, L.laneBack);
    label(ctx, 'TOP', top.x, top.y + 4, mirrored, atTop ? GREEN : CYAN, { size, align });
    label(ctx, 'START', rest.x, rest.y + 4, mirrored, GREY, { size: size - 1, align });
    label(ctx, 'ELBOW LANE', lane.x, lane.y + 4, mirrored, flare ? RED : AMBER, { size: size - 1, align: 'center' });
  }

  // Working arm, highlighted over the engine skeleton.
  if (a.ok) {
    const armColor = flare ? RED : atTop ? GREEN : CYAN;
    ctx.lineWidth = 6;
    ctx.strokeStyle = armColor;
    segment(ctx, g.shoulder, a.elbow);
    if (a.wristOk) segment(ctx, a.elbow, a.wrist);
    dot(ctx, a.elbow.x, a.elbow.y, 7, armColor);
    if (a.wristOk) dot(ctx, a.wrist.x, a.wrist.y, 6, WHITE);
  }
  dot(ctx, g.shoulder.x, g.shoulder.y, 7, shrug ? RED : WHITE);
  dot(ctx, g.hip.x, g.hip.y, 6, torsoBad ? RED : WHITE);
  if (g.knee) dot(ctx, g.knee.x, g.knee.y, 5, 'rgba(255,255,255,0.7)');

  const sideText = `${fr.side === 'left' ? 'LEFT' : 'RIGHT'} ARM`;
  label(ctx, sideText, g.shoulder.x, g.shoulder.y - 14, mirrored, WHITE, { size, align: 'center' });

  ctx.restore();
}

// ── Working-arm row progress bar ────────────────────────────────────────────

export function drawProgressBar(ctx, fr, w, h, mirrored) {
  const size = fontPx(h, 0.8);
  const bw = Math.max(14, Math.round(w * 0.025));
  const top = Math.round(h * 0.40);
  const bh = Math.round(h * 0.30);
  const sx = w - 14 - bw;
  const p = fr.lowConfidence ? null : fr.progress;
  screenBox(ctx, sx - 4, top - size - 10, bw + 8, bh + size * 2 + 22, w, mirrored, PANEL);
  screenBox(ctx, sx, top, bw, bh, w, mirrored, 'rgba(255,255,255,0.12)');
  if (p != null) {
    const fill = fr.armState === SR_ARM_STATE.TOP || p >= 1
      ? GREEN
      : p >= SR_CFG.lift_start ? CYAN : 'rgba(200,200,200,0.8)';
    const ph = Math.round(bh * p);
    screenBox(ctx, sx, top + bh - ph, bw, ph, w, mirrored, fill);
  }
  screenText(ctx, fr.side === 'left' ? 'L' : 'R', sx + bw / 2, top - 6, w, mirrored, WHITE, { size, weight: 800, align: 'center' });
  screenText(
    ctx, p == null ? '—' : `${Math.round(p * 100)}%`, sx + bw / 2, top + bh + size + 6, w, mirrored,
    p == null ? GREY : WHITE, { size: size - 1, weight: 700, align: 'center' },
  );
}

// ── Debug ───────────────────────────────────────────────────────────────────

export function drawDebugReadout(ctx, fr, w, h, mirrored) {
  const g = fr.geometry;
  const a = g?.arm;
  const f = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
  const rows = [
    `phase ${fr.phase.replace('sr_', '')}  act ${fr.activity}  side ${fr.side}  conf ${f(fr.confidence)}  ${fr.armState}`,
    `T ${f(g?.T, 0)}px  torso ${f(g?.elev, 1)}°  span ${f(g?.span)}  far ${f(g?.sep)}`,
    `elbow depth ${f(a?.depth)} back ${f(a?.back)}  wrist depth ${f(a?.wristDepth)}  ext ${f(a?.extension)}  ${fr.progress == null ? '—' : Math.round(fr.progress * 100)}%`,
    `top ≤${SR_CFG.top_tolerance}  start ${SR_CFG.lift_start}/${SR_CFG.lift_return}  count ≥${SR_CFG.min_count_rom}  lane +${SR_CFG.elbow_back_min}`,
  ];
  if (fr.calib) {
    const c = fr.calib;
    rows.push(`calib ${c.side} restDepth ${f(c.restDepth)} restBack ${f(c.restBack)} wrist ${f(c.restWristDepth)} torso ${f(c.elev0, 1)}° far ${f(c.sep0)}`);
  }
  if (fr.sustainedCues?.length) rows.push(`cues ${fr.sustainedCues.join(' ')}`);
  drawDebugRows(ctx, rows, w, h, mirrored);
}

/** Full overlay for one frame (skeleton is drawn by the engine loop). */
export function drawSingleArmDumbbellRowOverlay(ctx, fr, frame) {
  if (!fr) return;
  const { width: w, height: h } = frame;
  const mirrored = frame.mirrored !== false;
  const g = fr.geometry;

  if (fr.phase === SR_PHASE.SETUP_STANCE) {
    if (g) drawRowGuides(ctx, fr, mirrored, h);
    drawStanceChecklist(ctx, fr, w, h, mirrored, { rows: SETUP_ROWS });
  } else if (g) {
    drawRowGuides(ctx, fr, mirrored, h);
  }

  drawActivityBadge(ctx, fr, w, h, mirrored, { reasonLabels: REASON_LABEL, warnReasons: WARN_REASONS });
  drawCounters(ctx, fr, w, h, mirrored);
  if (fr.phase === SR_PHASE.ACTIVE || fr.phase === SR_PHASE.READY) drawProgressBar(ctx, fr, w, h, mirrored);
  if (fr.phase === SR_PHASE.REST_BETWEEN_SETS) drawRestOverlay(ctx, fr, w, h, mirrored);
  drawFeedback(ctx, fr, w, h, mirrored);
  if (SR_CFG.debug) drawDebugReadout(ctx, fr, w, h, mirrored);
}
