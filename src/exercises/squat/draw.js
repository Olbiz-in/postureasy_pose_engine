// ─── drawUtils.js ─────────────────────────────────────────────────────────────
// Canvas 2D drawing functions — direct port of all Python cv2 drawing code.
// All colours are converted from BGR (Python) to CSS rgb(r,g,b).

import { CFG, LM, nowSec, bgr, cueForView, COLOR_GREEN, COLOR_RED, COLOR_AMBER } from './config.js';
import { getGuideBoxRect, getTorsoCalibration } from './poseLogic';

// ---------------------------------------------------------------------------
// Blink helper (replaces Python _blink_red_yellow)
// ---------------------------------------------------------------------------
// Tolerance-violation indicator — high-contrast RED blink (visible from distance).
// Pre-existing `sustainedCues` gating is intentionally bypassed so the rail flashes
// red the instant the tolerance is exceeded.
export function blinkRedYellow(_sustainedCues, _key = '') {
  const t = nowSec();
  // Alternate bright red ↔ dark red ~4Hz.
  return Math.floor(t * 4) % 2 === 0 ? 'rgb(255,0,0)' : 'rgb(120,0,0)';
}

// ---------------------------------------------------------------------------
// drawStandingGuideBox — yellow guide box (Stage 2)
// ---------------------------------------------------------------------------
export function drawStandingGuideBox(ctx, w, h) {
  const [x1, y1, x2, y2] = getGuideBoxRect(w, h);
  ctx.save();
  ctx.strokeStyle = 'rgb(0,255,255)';
  ctx.lineWidth   = 2;
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  ctx.fillStyle  = 'rgb(0,255,255)';
  ctx.font       = '14px monospace';
  ctx.fillText('Stand here — head to feet inside box', x1, Math.max(20, y1 - 10));
  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawPositioningFeedback — Stage 2/3 status text
// ---------------------------------------------------------------------------
export function drawPositioningFeedback(ctx, message, colorCss) {
  ctx.save();
  ctx.font      = 'bold 18px monospace';
  ctx.fillStyle = colorCss;
  const maxChars = 46;
  const words    = message.replace(/—/g, '-').split(' ');
  const lines    = [];
  let current    = '';
  for (const word of words) {
    const trial = (current ? current + ' ' : '') + word;
    if (trial.length <= maxChars) { current = trial; }
    else { if (current) lines.push(current); current = word; }
  }
  if (current) lines.push(current);

  let y = 34;
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    ctx.font = i === 0 ? 'bold 18px monospace' : '14px monospace';
    ctx.fillText(lines[i], 14, y);
    y += i === 0 ? 28 : 22;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawStage1VoiceStatus — bottom hint during voice gates
// ---------------------------------------------------------------------------
export function drawStage1VoiceStatus(ctx, h, statusLine, showYHint = true) {
  ctx.save();
  ctx.font      = '12px monospace';
  ctx.fillStyle = 'rgb(160,200,255)';
  if (showYHint) {
    ctx.fillText('Headphones = no echo | Wait for "I\'m listening" before you speak', 14, h - 68);
    ctx.fillStyle = 'rgb(160,220,255)';
    ctx.fillText('Press Y on keyboard to start immediately', 14, h - 44);
  } else {
    ctx.fillText('Wait for "I\'m listening", then say yes', 14, h - 44);
  }
  ctx.fillStyle = 'rgb(180,255,180)';
  ctx.font      = 'bold 13px monospace';
  ctx.fillText(statusLine, 14, h - 18);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawPassTick — green tick mark with label
// ---------------------------------------------------------------------------
export function drawPassTick(ctx, x, y, label = '') {
  ctx.save();
  ctx.strokeStyle = 'rgb(0,255,0)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(x,      y + 10);
  ctx.lineTo(x + 8,  y + 20);
  ctx.lineTo(x + 22, y + 2);
  ctx.stroke();
  if (label) {
    ctx.fillStyle = 'rgb(0,220,0)';
    ctx.font      = '11px monospace';
    ctx.fillText(label, x, y + 26);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawStancePassTicks — right-side tick column for Stage 4 sub-checks
// ---------------------------------------------------------------------------
export function drawStancePassTicks(ctx, w, stance) {
  const tx = w - 130;
  const rows = [
    ['shoulder_level', 'Shoulders', 52],
    ['shoulder_foot',  'Ankle',     92],
    ['foot_index',     'Toe',      132],
    ['knee',           'Knee',     172],
    ['hip',            'Hip',      212],
    ['torso',          'Torso',    252],
  ];
  for (const [name, label, ty] of rows) {
    if (stance[name]) drawPassTick(ctx, tx, ty, label);
  }
}

// ---------------------------------------------------------------------------
// drawShoulderFootGuides — ankle tolerance rails
// ---------------------------------------------------------------------------
export function drawShoulderFootGuides(ctx, landmarks, w, h, sustainedCues) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];
  if (Math.min(ls.visibility, rs.visibility, la.visibility, ra.visibility) < 0.2) return;

  const sw = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  const leftDx  = (la.x - ls.x) / sw;
  const rightDx = (ra.x - rs.x) / sw;
  const lIn  = CFG.shoulder_foot_align_ratio_max + CFG.sf_left_inner_offset_ratio;
  const lOut = CFG.shoulder_foot_align_ratio_max + CFG.sf_left_outer_offset_ratio;
  const rIn  = CFG.shoulder_foot_align_ratio_max + CFG.sf_right_inner_offset_ratio;
  const rOut = CFG.shoulder_foot_align_ratio_max + CFG.sf_right_outer_offset_ratio;
  const leftOk  = -lIn <= leftDx  && leftDx  <= lOut;
  const rightOk = -rIn <= rightDx && rightDx <= rOut;

  _drawRailSide(ctx, ls, la, lIn, lOut, leftDx,  leftOk,  sw, w, h,
    CFG.sf_line_half_len_ratio, 'rgb(0,255,0)', 'rgb(0,0,255)',
    sustainedCues, cueForView('ankle_left_inner'), cueForView('ankle_left_outer'));
  _drawRailSide(ctx, rs, ra, rIn, rOut, rightDx, rightOk, sw, w, h,
    CFG.sf_line_half_len_ratio, 'rgb(0,255,0)', 'rgb(0,0,255)',
    sustainedCues, cueForView('ankle_right_outer'), cueForView('ankle_right_inner'));
}

export function drawFootIndexGuides(ctx, landmarks, w, h, sustainedCues) {
  const ls  = landmarks[LM.LEFT_SHOULDER];
  const rs  = landmarks[LM.RIGHT_SHOULDER];
  const lfi = landmarks[LM.LEFT_FOOT_INDEX];
  const rfi = landmarks[LM.RIGHT_FOOT_INDEX];
  if (Math.min(ls.visibility, rs.visibility, lfi.visibility, rfi.visibility) < 0.2) return;

  const sw = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  const leftDx  = (lfi.x - ls.x) / sw;
  const rightDx = (rfi.x - rs.x) / sw;
  const lIn  = CFG.foot_index_align_ratio_max + CFG.fi_left_inner_offset_ratio;
  const lOut = CFG.foot_index_align_ratio_max + CFG.fi_left_outer_offset_ratio;
  const rIn  = CFG.foot_index_align_ratio_max + CFG.fi_right_inner_offset_ratio;
  const rOut = CFG.foot_index_align_ratio_max + CFG.fi_right_outer_offset_ratio;
  const leftOk  = -lIn <= leftDx  && leftDx  <= lOut;
  const rightOk = -rIn <= rightDx && rightDx <= rOut;

  _drawRailSide(ctx, ls, lfi, lIn, lOut, leftDx,  leftOk,  sw, w, h,
    CFG.fi_line_half_len_ratio, 'rgb(80,255,80)', 'rgb(0,80,255)',
    sustainedCues, cueForView('toe_left_inner'), cueForView('toe_left_outer'));
  _drawRailSide(ctx, rs, rfi, rIn, rOut, rightDx, rightOk, sw, w, h,
    CFG.fi_line_half_len_ratio, 'rgb(80,255,80)', 'rgb(0,80,255)',
    sustainedCues, cueForView('toe_right_outer'), cueForView('toe_right_inner'));
}

export function drawKneeGuides(ctx, landmarks, w, h, sustainedCues) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lk = landmarks[LM.LEFT_KNEE];
  const rk = landmarks[LM.RIGHT_KNEE];
  if (Math.min(ls.visibility, rs.visibility, lk.visibility, rk.visibility) < 0.2) return;

  const sw = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  const leftDx  = (lk.x - ls.x) / sw;
  const rightDx = (rk.x - rs.x) / sw;
  const lIn  = CFG.knee_align_ratio_max + CFG.kn_left_inner_offset_ratio;
  const lOut = CFG.knee_align_ratio_max + CFG.kn_left_outer_offset_ratio;
  const rIn  = CFG.knee_align_ratio_max + CFG.kn_right_inner_offset_ratio;
  const rOut = CFG.knee_align_ratio_max + CFG.kn_right_outer_offset_ratio;
  const leftOk  = -lIn <= leftDx  && leftDx  <= lOut;
  const rightOk = -rIn <= rightDx && rightDx <= rOut;

  _drawRailSide(ctx, ls, lk, lIn, lOut, leftDx,  leftOk,  sw, w, h,
    CFG.kn_line_half_len_ratio, 'rgb(100,255,200)', 'rgb(0,120,255)',
    sustainedCues, cueForView('knee_left_inner'), cueForView('knee_left_outer'));
  _drawRailSide(ctx, rs, rk, rIn, rOut, rightDx, rightOk, sw, w, h,
    CFG.kn_line_half_len_ratio, 'rgb(100,255,200)', 'rgb(0,120,255)',
    sustainedCues, cueForView('knee_right_outer'), cueForView('knee_right_inner'));
}

// Shared rail drawing helper
function _drawRailSide(ctx, shoulder, point, inRatio, outRatio, dxSigned, ok, sw, w, h,
                       halfLenRatio, okColor, failColor, sustainedCues, innerKey, outerKey) {
  const sx = clamp(Math.round(shoulder.x * w), 0, w - 1);
  const px = clamp(Math.round(point.x * w),    0, w - 1);
  const py = clamp(Math.round(point.y * h),    0, h - 1);
  const halfLen = Math.max(4, Math.round(halfLenRatio * h));
  const y0 = Math.max(0, py - halfLen);
  const y1 = Math.min(h - 1, py + halfLen);
  const col = ok ? okColor : failColor;
  const xLo = clamp(Math.round(sx - inRatio  * sw * w), 0, w - 1);
  const xHi = clamp(Math.round(sx + outRatio * sw * w), 0, w - 1);
  const loCross = dxSigned < -inRatio;
  const hiCross = dxSigned > outRatio;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = loCross ? blinkRedYellow(sustainedCues, innerKey) : 'rgb(0,200,255)';
  _line(ctx, xLo, y0, xLo, y1);
  ctx.strokeStyle = hiCross ? blinkRedYellow(sustainedCues, outerKey) : 'rgb(0,200,255)';
  _line(ctx, xHi, y0, xHi, y1);
  ctx.lineWidth   = 1;
  ctx.strokeStyle = col;
  _line(ctx, sx, y0, sx, y1);
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(sx, py, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgb(120,180,230)';
  ctx.lineWidth   = 2;
  _line(ctx, sx, py, px, py);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawHipCenterGuides
// ---------------------------------------------------------------------------
export function drawHipCenterGuides(ctx, hipX, hipY, kneeX, kneeY, swN, dxRatio, w, h, sustainedCues) {
  const xh = clamp(Math.round(hipX  * w), 0, w - 1);
  const xk = clamp(Math.round(kneeX * w), 0, w - 1);
  const yh = clamp(Math.round(hipY  * h), 0, h - 1);
  const yk = clamp(Math.round(kneeY * h), 0, h - 1);
  const y0 = Math.min(yh, yk), y1 = Math.max(yh, yk);
  const tol = CFG.hip_align_ratio_max + CFG.hip_offset_ratio;
  const tolPx = Math.max(2, Math.round(tol * swN * w));
  const ok  = dxRatio <= tol;
  const mainCol = ok ? 'rgb(0,255,0)' : 'rgb(255,0,0)';
  const dxSigned = (kneeX - hipX) / Math.max(swN, 1e-6);
  const loCross  = dxSigned < -tol;
  const hiCross  = dxSigned > tol;

  ctx.save();
  ctx.lineWidth   = 2;
  ctx.strokeStyle = mainCol;
  _line(ctx, xh, y0, xh, y1);
  ctx.strokeStyle = loCross ? blinkRedYellow(sustainedCues, cueForView('hip_left'))  : 'rgb(255,120,255)';
  _line(ctx, Math.max(0, xh - tolPx), y0, Math.max(0, xh - tolPx), y1);
  ctx.strokeStyle = hiCross ? blinkRedYellow(sustainedCues, cueForView('hip_right')) : 'rgb(255,120,255)';
  _line(ctx, Math.min(w-1, xh + tolPx), y0, Math.min(w-1, xh + tolPx), y1);
  ctx.fillStyle = 'rgb(255,255,255)'; ctx.beginPath(); ctx.arc(xh, yh, 6, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgb(255,200,0)';   ctx.beginPath(); ctx.arc(xh, yk, 5, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = mainCol;            ctx.beginPath(); ctx.arc(xk, yk, 5, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgb(200,200,80)'; ctx.lineWidth = 2; _line(ctx, xh, yk, xk, yk);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawTorsoFrontGuides
// ---------------------------------------------------------------------------
export function drawTorsoFrontGuides(ctx, shX, shY, hipX, hipY, swN, dxRatio, vGapRatio, w, h, sustainedCues) {
  const sx  = clamp(Math.round(shX  * w), 0, w - 1);
  const sy  = clamp(Math.round(shY  * h), 0, h - 1);
  const hx  = clamp(Math.round(hipX * w), 0, w - 1);
  const hy  = clamp(Math.round(hipY * h), 0, h - 1);
  const xTol   = CFG.torso_horizontal_align_ratio_max + CFG.torso_horizontal_offset_ratio;
  const xTolPx = Math.max(2, Math.round(xTol * swN * w));
  const vMin   = Math.max(0.01, Math.min(1.0,
    CFG.torso_vertical_gap_min_ratio - CFG.torso_vertical_gap_offset_ratio));

  // ── Fixed torso reference height ─────────────────────────────────────────
  // After calibration the reference height (pixels) is derived from the stored
  // normalised standing height, not from the current frame.  This keeps the
  // violet threshold line stationary even when the user bends forward and the
  // live shoulder-to-hip distance shrinks due to 2-D foreshortening.
  const calib = getTorsoCalibration();
  const calibLocked = calib !== null;
  const refHeightPx = calibLocked
    ? Math.max(1, Math.round(calib.standingHeightNorm * h))
    : Math.max(1, Math.abs(hy - sy));   // fallback: dynamic height (pre-calibration)

  // yTarget is the threshold line: vMin fraction of the FIXED reference height
  // above the current hip position.  Clamped only to canvas bounds (not to the
  // current shoulder position) so it remains visible even when shoulders drop.
  const yTarget = clamp(Math.round(hy - vMin * refHeightPx), 0, h - 1);

  const xOk = dxRatio <= xTol;
  const vOk = vGapRatio >= vMin;
  const mainCol  = (xOk && vOk) ? 'rgb(0,255,0)' : 'rgb(255,0,0)';
  const dxSigned = (shX - hipX) / Math.max(swN, 1e-6);
  const loCross  = dxSigned < -xTol;
  const hiCross  = dxSigned > xTol;

  ctx.save();

  // Current torso body line (hip → shoulder, dynamic)
  ctx.lineWidth   = 2;
  ctx.strokeStyle = mainCol;
  _line(ctx, hx, sy, hx, hy);

  // Horizontal-drift tolerance rails
  ctx.strokeStyle = loCross ? blinkRedYellow(sustainedCues, cueForView('torso_x_left'))  : 'rgb(255,180,0)';
  _line(ctx, Math.max(0, hx - xTolPx), sy, Math.max(0, hx - xTolPx), hy);
  ctx.strokeStyle = hiCross ? blinkRedYellow(sustainedCues, cueForView('torso_x_right')) : 'rgb(255,180,0)';
  _line(ctx, Math.min(w-1, hx + xTolPx), sy, Math.min(w-1, hx + xTolPx), hy);

  // ── FIXED threshold line (violet) ────────────────────────────────────────
  // Colour: bright violet when calibrated and OK; brighter / thicker when
  // calibrated+locked; blinks red when the forward-bend threshold is crossed.
  const lineHalfW = calibLocked ? 50 : 35;   // wider when locked so it's easy to see
  const vCol = !vOk
    ? blinkRedYellow(sustainedCues, 'torso_bend')
    : (calibLocked ? 'rgb(210,80,255)' : 'rgb(180,120,255)');
  ctx.strokeStyle = vCol;
  ctx.lineWidth   = calibLocked ? 2.5 : 2;
  _line(ctx, Math.max(0, hx - lineHalfW), yTarget, Math.min(w-1, hx + lineHalfW), yTarget);

  // Debug label: show calibration state + current vGapRatio
  ctx.font = '10px monospace';
  if (calibLocked) {
    ctx.fillStyle = vOk ? 'rgb(210,80,255)' : 'rgb(255,100,100)';
    ctx.fillText(
      `[ref] ${(vGapRatio * 100).toFixed(0)}%`,
      Math.max(0, hx - lineHalfW),
      Math.max(12, yTarget - 3),
    );
    // Show current shoulder position as a horizontal tick for easy comparison
    const shLineCol = vOk ? 'rgb(0,220,255)' : 'rgb(255,80,80)';
    ctx.strokeStyle = shLineCol;
    ctx.lineWidth   = 1.5;
    _line(ctx, Math.max(0, hx - lineHalfW + 4), sy, Math.min(w-1, hx + lineHalfW - 4), sy);
    ctx.fillStyle = shLineCol;
    ctx.fillText('sh', Math.max(0, hx + lineHalfW - 20), Math.max(12, sy - 3));
  }

  // Hip centre dot (white) and shoulder dot (green/red)
  ctx.fillStyle = 'rgb(255,255,255)'; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = mainCol;            ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgb(150,200,240)'; ctx.lineWidth = 2; _line(ctx, hx, hy, sx, sy);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawShoulderLevelGuides
// ---------------------------------------------------------------------------
export function drawShoulderLevelGuides(ctx, lsX, lsY, rsX, rsY, swN, dyRatio, w, h, sustainedCues) {
  const lx = clamp(Math.round(lsX * w), 0, w - 1);
  const ly = clamp(Math.round(lsY * h), 0, h - 1);
  const rx = clamp(Math.round(rsX * w), 0, w - 1);
  const ry = clamp(Math.round(rsY * h), 0, h - 1);
  const yRef  = clamp(Math.round((ly + ry) * 0.5), 0, h - 1);
  const tol   = CFG.shoulder_level_align_ratio_max + CFG.shoulder_level_offset_ratio;
  const tolPx = Math.max(1, Math.round(tol * swN * h));
  const yTop  = Math.max(0, yRef - tolPx);
  const yBot  = Math.min(h - 1, yRef + tolPx);
  const touchTop = ly <= yTop || ry <= yTop;
  const touchBot = ly >= yBot || ry >= yBot;
  const cross    = touchTop || touchBot;
  const shlvlKey = cueForView(ly < ry ? 'shoulder_high_left' : 'shoulder_high_right');
  const refCol   = cross ? blinkRedYellow(sustainedCues, shlvlKey) : 'rgb(120,200,255)';

  ctx.save();
  ctx.lineWidth   = 2;
  ctx.strokeStyle = refCol;
  _line(ctx, lx, yRef, rx, yRef);
  ctx.strokeStyle = touchTop ? blinkRedYellow(sustainedCues, shlvlKey) : 'rgb(255,180,80)';
  _line(ctx, lx, yTop, rx, yTop);
  ctx.strokeStyle = touchBot ? blinkRedYellow(sustainedCues, shlvlKey) : 'rgb(255,180,80)';
  _line(ctx, lx, yBot, rx, yBot);
  const ptCol = cross ? blinkRedYellow(sustainedCues, shlvlKey) : 'rgb(0,255,0)';
  ctx.fillStyle = ptCol;
  ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(rx, ry, 4, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgb(180,180,180)'; ctx.lineWidth = 1;
  _line(ctx, lx, ly, lx, yRef);
  _line(ctx, rx, ry, rx, yRef);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawStanceAnkleWidthGuides — STANCE_CHECK only
// Visualizes ankle width vs shoulder width with a tolerance band.
// ---------------------------------------------------------------------------
export function drawStanceAnkleWidthGuides(ctx, stanceData, w, h) {
  if (!stanceData || stanceData.stanceMode !== 'width') return;
  const { ls, rs, la, ra, shoulderWidth, ankleWidth, ok, tolerance } = stanceData;
  if (!ls || !rs || !la || !ra) return;
  if (Math.min(ls.visibility ?? 1, rs.visibility ?? 1, la.visibility ?? 1, ra.visibility ?? 1) < 0.2) {
    return;
  }

  const sw = Math.max(shoulderWidth, 1e-6);
  const lx = clamp(Math.round(la.x * w), 0, w - 1);
  const rx = clamp(Math.round(ra.x * w), 0, w - 1);
  const ay = clamp(Math.round(((la.y + ra.y) * 0.5) * h), 0, h - 1);

  // Width-only overlay: target span = shoulder width ± tol, centered on ankles
  const midX = Math.round((lx + rx) * 0.5);
  const targetHalf = (sw * 0.5) * w;
  const tolPx = Math.max(2, Math.round(tolerance * sw * w));
  const bandLo = clamp(Math.round(midX - targetHalf - tolPx), 0, w - 1);
  const bandHi = clamp(Math.round(midX + targetHalf + tolPx), 0, w - 1);
  const targetLo = clamp(Math.round(midX - targetHalf), 0, w - 1);
  const targetHi = clamp(Math.round(midX + targetHalf), 0, w - 1);

  const halfLen = Math.max(10, Math.round(0.035 * h));
  const y0 = Math.max(0, ay - halfLen);
  const y1 = Math.min(h - 1, ay + halfLen);
  const mainCol = ok ? 'rgb(0,255,0)' : 'rgb(255,140,0)';

  ctx.save();

  // Tolerance outer rails (cyan) and ideal shoulder-width rails (white)
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgb(0,200,255)';
  _line(ctx, bandLo, y0, bandLo, y1);
  _line(ctx, bandHi, y0, bandHi, y1);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  _line(ctx, targetLo, y0, targetLo, y1);
  _line(ctx, targetHi, y0, targetHi, y1);

  // Current ankle span
  ctx.strokeStyle = mainCol;
  ctx.lineWidth = 3;
  _line(ctx, lx, ay, rx, ay);

  // Ankle markers
  ctx.fillStyle = mainCol;
  ctx.beginPath(); ctx.arc(lx, ay, 7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(rx, ay, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgb(255,255,255)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(lx, ay, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(rx, ay, 7, 0, Math.PI * 2); ctx.stroke();

  // Optional shoulder reference width (debug)
  const slx = clamp(Math.round(ls.x * w), 0, w - 1);
  const srx = clamp(Math.round(rs.x * w), 0, w - 1);
  const sy = clamp(Math.round(((ls.y + rs.y) * 0.5) * h), 0, h - 1);
  ctx.strokeStyle = 'rgba(180,180,255,0.85)';
  ctx.lineWidth = 2;
  _line(ctx, slx, sy, srx, sy);
  ctx.fillStyle = 'rgba(180,180,255,0.9)';
  ctx.beginPath(); ctx.arc(slx, sy, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(srx, sy, 4, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = mainCol;
  ctx.font = '12px monospace';
  const pct = ((ankleWidth / sw) * 100).toFixed(0);
  ctx.fillText(`Stance ${pct}% shoulder width`, Math.max(8, midX - 90), Math.max(16, ay - halfLen - 8));

  ctx.restore();
}

// ---------------------------------------------------------------------------
// drawAllStanceToleranceGuides — combined (exercise-phase form overlays)
// ---------------------------------------------------------------------------
export function drawAllStanceToleranceGuides(ctx, landmarks, stanceData, w, h, sustainedCues) {
  const { hip, torso, shlvl, kneeX, kneeY } = stanceData;
  drawShoulderFootGuides(ctx, landmarks, w, h, sustainedCues);
  drawFootIndexGuides(ctx, landmarks, w, h, sustainedCues);
  drawKneeGuides(ctx, landmarks, w, h, sustainedCues);
  drawHipCenterGuides(ctx, hip.x, hip.y, kneeX, kneeY, hip.sw, hip.dx, w, h, sustainedCues);
  drawTorsoFrontGuides(ctx, torso.shX, torso.shY, torso.hipX, torso.hipY, torso.sw, torso.dx, torso.vGap, w, h, sustainedCues);
  drawShoulderLevelGuides(ctx, shlvl.lsx, shlvl.lsy, shlvl.rsx, shlvl.rsy, shlvl.sw, shlvl.dy, w, h, sustainedCues);
}

// ---------------------------------------------------------------------------
// Squat rep overlay — shared geometry + individually toggleable draw parts
// ---------------------------------------------------------------------------
export function squatRepGeometry(squat, hipX, hipY, kneeX, kneeY, swN, w, h) {
  const kneeYPx = clamp(Math.round(kneeY * h), 0, h - 1);
  const hipYPx  = clamp(Math.round(hipY  * h), 0, h - 1);
  const cx      = clamp(Math.round(((hipX + kneeX) * 0.5) * w), 0, w - 1);
  const lw      = Math.max(70, Math.round(swN * w * 1.3));
  const x0      = Math.max(0, cx - lw);
  const x1      = Math.min(w - 1, cx + lw);
  const tooDeepY = clamp(kneeYPx - Math.round(squat.constructor.TOO_DEEP_GAP * h), 0, h - 1);
  let partialY = kneeYPx;
  let fullY = kneeYPx;
  if (squat.isCalibrated) {
    const sgPx = Math.round(squat._standGap * h);
    partialY = clamp(kneeYPx - Math.round(sgPx * squat.constructor.ENTER_FRAC), 0, h - 1);
    fullY    = clamp(kneeYPx - Math.round(sgPx * squat.constructor.FULL_FRAC),  0, h - 1);
  }
  return { kneeYPx, hipYPx, cx, x0, x1, tooDeepY, partialY, fullY, w, h, swN };
}

export function drawSquatStartLine(ctx, squat, geom) {
  const fixedLineN = squat.fixedStartLineY;
  if (fixedLineN === null) return;
  const { cx, kneeYPx, w, h, swN } = geom;
  const lineY = clamp(Math.round(fixedLineN * h), 0, h - 1);
  const lineW = Math.max(60, Math.round(swN * w * CFG.squat_between_line_width_ratio));
  ctx.save();
  ctx.strokeStyle = 'rgb(180,180,255)';
  ctx.lineWidth   = 2;
  _line(ctx, Math.max(0, cx - lineW), lineY, Math.min(w - 1, cx + lineW), lineY);
  const dKneePx = Math.max(0, kneeYPx - lineY);
  ctx.fillStyle = 'rgb(180,180,255)'; ctx.font = '11px monospace';
  ctx.fillText(`start line (fixed) d_knee=${dKneePx}px`, Math.max(0, cx - lineW), Math.max(16, lineY - 6));
  ctx.restore();
}

export function drawSquatPartialDepthLine(ctx, geom) {
  const { x0, x1, partialY } = geom;
  ctx.save();
  ctx.strokeStyle = 'rgb(255,200,0)'; ctx.lineWidth = 1;
  _line(ctx, x0, partialY, x1, partialY);
  ctx.restore();
}

export function drawSquatFullDepthLine(ctx, squat, geom) {
  const { x0, x1, fullY } = geom;
  ctx.save();
  ctx.strokeStyle = squat._fullDepth ? 'rgb(0,255,80)' : 'rgb(255,220,0)';
  ctx.lineWidth   = 2;
  _line(ctx, x0, fullY, x1, fullY);
  ctx.restore();
}

export function drawSquatTooDeepLine(ctx, squat, geom) {
  const { x0, x1, tooDeepY } = geom;
  const sustainedEmpty = new Set();
  const tooDeepCol = squat.tooDeep ? blinkRedYellow(sustainedEmpty) : 'rgb(0,60,200)';
  ctx.save();
  ctx.strokeStyle = tooDeepCol; ctx.lineWidth = 2;
  _line(ctx, x0, tooDeepY, x1, tooDeepY);
  ctx.fillStyle = tooDeepCol; ctx.font = '11px monospace';
  ctx.fillText('Too deep', Math.max(0, x1 - 120), Math.max(14, tooDeepY - 6));
  ctx.restore();
}

export function drawSquatHipKneeTracker(ctx, squat, geom) {
  const { cx, hipYPx, kneeYPx } = geom;
  ctx.save();
  const hipDotCol = squat.tooDeep ? 'rgb(0,0,220)' : (squat._fullDepth ? 'rgb(0,255,80)' : 'rgb(0,220,255)');
  ctx.fillStyle   = hipDotCol;
  ctx.beginPath(); ctx.arc(cx, hipYPx, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgb(255,255,255)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, hipYPx, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgb(80,80,80)'; ctx.lineWidth = 1;
  _line(ctx, cx, Math.min(hipYPx, kneeYPx), cx, Math.max(hipYPx, kneeYPx));
  ctx.restore();
}

export function drawSquatRepCounter(ctx, squat) {
  const t = nowSec();
  const maxReps = CFG.squat_max_reps;
  let repCol = 'rgb(255,255,255)';
  if (squat.justCounted())  repCol = Math.floor(t * 6) % 2 === 0 ? 'rgb(0,255,100)' : 'rgb(0,200,255)';
  else if (squat.allDone()) repCol = 'rgb(0,255,80)';
  ctx.save();
  ctx.font      = 'bold 24px monospace';
  ctx.fillStyle = repCol;
  const repText = maxReps > 0 ? `Reps: ${squat.count} / ${maxReps}` : `Reps: ${squat.count}`;
  ctx.fillText(repText, 14, 34);
  ctx.restore();
}

export function drawSquatProgressDots(ctx, squat, w) {
  const maxReps = CFG.squat_max_reps;
  if (maxReps <= 0) return;
  ctx.save();
  const dotR = 11;
  const dotSp = 28;
  const dotsX0 = w - maxReps * dotSp - 12;
  const dotsY  = 42;
  for (let i = 0; i < maxReps; i++) {
    const dx = dotsX0 + i * dotSp + dotR;
    if (i < squat.count) {
      ctx.fillStyle = 'rgb(0,210,80)'; ctx.beginPath(); ctx.arc(dx, dotsY, dotR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgb(0,255,120)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(dx, dotsY, dotR, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgb(50,50,50)'; ctx.beginPath(); ctx.arc(dx, dotsY, dotR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgb(110,110,110)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(dx, dotsY, dotR, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawSquatRepOverlay(ctx, squat, hipX, hipY, kneeX, kneeY, swN, w, h) {
  const geom = squatRepGeometry(squat, hipX, hipY, kneeX, kneeY, swN, w, h);
  drawSquatStartLine(ctx, squat, geom);
  drawSquatPartialDepthLine(ctx, geom);
  drawSquatFullDepthLine(ctx, squat, geom);
  drawSquatTooDeepLine(ctx, squat, geom);
  drawSquatHipKneeTracker(ctx, squat, geom);
  drawSquatRepCounter(ctx, squat);
  drawSquatProgressDots(ctx, squat, w);
}

// ---------------------------------------------------------------------------
// Tempo gate overlay — individually toggleable draw parts
// ---------------------------------------------------------------------------
export function drawTempoGateLine(ctx, squat, w, h) {
  if (squat.tempoGateY === null) return;
  const gateY = clamp(Math.round(squat.tempoGateY), 0, h - 1);
  const cyan  = 'rgb(0,255,255)';
  ctx.save();
  ctx.strokeStyle = cyan; ctx.lineWidth = 1;
  ctx.setLineDash([14, 10]);
  _line(ctx, 0, gateY, w - 1, gateY);
  ctx.setLineDash([]);
  ctx.fillStyle = cyan; ctx.font = '15px monospace';
  ctx.fillText('Tempo Gate', 8, Math.max(20, gateY - 8));
  ctx.restore();
}

export function drawTempoGateHipDot(ctx, squat, w, h) {
  if (squat.tempoGateY === null) return;
  const hipX = clamp(Math.round(squat._lastMidHipXPx), 0, w - 1);
  const hipY = clamp(Math.round(squat._lastMidHipYPx), 0, h - 1);
  ctx.save();
  ctx.fillStyle = 'rgb(255,255,255)'; ctx.beginPath(); ctx.arc(hipX, hipY, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgb(40,40,40)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hipX, hipY, 6, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

export function drawTempoTimer(ctx, squat, w) {
  if (squat.tempoGateY === null || squat.tempoState !== 'below') return;
  const elapsed = squat.tempoLiveElapsed();
  const timerText = `${elapsed.toFixed(1)}s`;
  let timerCol;
  if (elapsed > CFG.tempo_max_sec)       timerCol = 'rgb(255,0,0)';
  else if (elapsed < CFG.tempo_min_sec)  timerCol = 'rgb(255,140,0)';
  else                                    timerCol = 'rgb(255,255,255)';
  ctx.save();
  ctx.font      = 'bold 30px monospace';
  ctx.fillStyle = timerCol;
  const tw = ctx.measureText(timerText).width;
  ctx.fillText(timerText, Math.max(8, (w - tw) / 2), 52);
  ctx.restore();
}

export function drawTempoResultBanner(ctx, squat, w, h) {
  if (!squat.tempoResultVisible()) return;
  const d      = squat.lastTempoDuration;
  const result = squat.lastTempoResult;
  let msg, col;
  if (result === 'good')      { msg = `Good tempo — ${d.toFixed(1)}s`; col = 'rgb(0,255,0)'; }
  else if (result === 'fast') { msg = `Too fast — ${d.toFixed(1)}s`;   col = 'rgb(255,0,0)'; }
  else                        { msg = `Too slow — ${d.toFixed(1)}s`;   col = 'rgb(255,140,0)'; }
  ctx.save();
  ctx.font      = 'bold 26px monospace';
  ctx.fillStyle = col;
  const tw = ctx.measureText(msg).width;
  ctx.fillText(msg, Math.max(8, (w - tw) / 2), Math.max(40, h / 2));
  ctx.restore();
}

export function drawTempoGateOverlay(ctx, squat, w, h) {
  drawTempoGateLine(ctx, squat, w, h);
  drawTempoGateHipDot(ctx, squat, w, h);
  drawTempoTimer(ctx, squat, w);
  drawTempoResultBanner(ctx, squat, w, h);
}

// ---------------------------------------------------------------------------
// lockTempoGateAtStance
// ---------------------------------------------------------------------------
export function lockTempoGateAtStance(squatTracker, landmarks, h) {
  if (squatTracker.tempoGateY !== null) return;
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  const midHipYPx = (lh.y + rh.y) * 0.5 * h;
  const gateY  = midHipYPx + CFG.tempo_gate_offset_ratio * h;
  const hystPx = CFG.tempo_gate_hysteresis_ratio * h;
  squatTracker.setTempoGate(gateY, hystPx);
}

// ---------------------------------------------------------------------------
// Skeleton drawing using @mediapipe/drawing_utils (via CDN window globals)
// ---------------------------------------------------------------------------
export function drawSkeleton(ctx, landmarks, boneColor) {
  if (!window.drawConnectors || !window.drawLandmarks || !window.POSE_CONNECTIONS) return;
  window.drawConnectors(ctx, landmarks, window.POSE_CONNECTIONS,
    { color: boneColor, lineWidth: 2 });
  window.drawLandmarks(ctx, landmarks,
    { color: boneColor, lineWidth: 1, radius: 3 });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function _line(ctx, x1, y1, x2, y2) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
