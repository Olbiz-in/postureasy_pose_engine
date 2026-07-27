// ─── poseLogic.js ─────────────────────────────────────────────────────────────
// Pure pose-analysis functions — direct JS port of all Python gate checks,
// validation, and stance-check functions.  No React, no canvas.

import {
  CFG, LM,
  GATE_HEAD, GATE_UPPER, GATE_LOWER,
  FEET_LANDMARKS, KNEE_LANDMARKS, LEFT_SIDE, RIGHT_SIDE,
  MSG_HEAD, MSG_LEGS, MSG_FEET, MSG_TOO_CLOSE, MSG_TOO_FAR,
  MSG_SIDE_VIEW, MSG_POOR_DETECTION,
  cueForView, viewSide,
} from './config.js';

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/**
 * True when landmark is in-frame with visibility >= threshold.
 * Stricter bottom margin for feet landmarks.
 */
export function landmarkConfident(lm, visMin, frameMargin, bottomMargin) {
  const bottom = bottomMargin != null ? bottomMargin : frameMargin;
  return (
    lm.visibility >= visMin &&
    lm.x > frameMargin && lm.x < 1.0 - frameMargin &&
    lm.y > frameMargin && lm.y < 1.0 - bottom
  );
}

/**
 * Returns the Set of landmark ids from `gate` that fail the confidence check.
 */
export function gateMissing(landmarks, gate, visMin, frameMargin, strictBottom) {
  const bottom = strictBottom ? CFG.keypoint_bottom_margin : null;
  const missing = new Set();
  for (const id of gate) {
    if (!landmarkConfident(landmarks[id], visMin, frameMargin, bottom)) {
      missing.add(id);
    }
  }
  return missing;
}

export function shoulderSpan(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  return Math.abs(ls.x - rs.x);
}

export function headOrUpperDetected(landmarks, visMin, frameMargin) {
  const relaxed = Math.max(0.35, visMin * 0.75);
  for (const id of [LM.NOSE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER]) {
    if (landmarkConfident(landmarks[id], relaxed, frameMargin)) return true;
  }
  return false;
}

export function oneSideObscured(missingIds) {
  let leftMiss = 0, rightMiss = 0;
  for (const id of missingIds) {
    if (LEFT_SIDE.has(id)) leftMiss++;
    if (RIGHT_SIDE.has(id)) rightMiss++;
  }
  const min = CFG.side_view_min_missing_on_one_side;
  return (leftMiss >= min && rightMiss <= 1) || (rightMiss >= min && leftMiss <= 1);
}

// ---------------------------------------------------------------------------
// Positioning feedback message (from Python _positioning_feedback)
// ---------------------------------------------------------------------------
export function positioningFeedback(
  missingIds, gateHead, gateUpper, gateLower,
  landmarks, visMin, frameMargin, skipSideView
) {
  if (!skipSideView && oneSideObscured(missingIds)) {
    return [MSG_SIDE_VIEW, 'side_view'];
  }
  for (const id of missingIds) {
    if (FEET_LANDMARKS.has(id)) return [MSG_FEET, 'feet'];
  }
  for (const id of missingIds) {
    if (KNEE_LANDMARKS.has(id)) return [MSG_LEGS, 'legs'];
  }
  if (!gateHead) return [MSG_HEAD, 'head'];

  const lowerMissCount = gateMissing(landmarks, GATE_LOWER, visMin, frameMargin, true).size;
  if (
    !gateLower &&
    lowerMissCount >= CFG.too_close_min_missing_lower &&
    (gateUpper ||
      headOrUpperDetected(landmarks, visMin, frameMargin) ||
      shoulderSpan(landmarks) >= CFG.too_close_shoulder_span_min)
  ) {
    return [MSG_TOO_CLOSE, 'too_close'];
  }
  if (!gateLower) return [MSG_LEGS, 'legs'];

  const span = shoulderSpan(landmarks);
  if (span <= CFG.too_far_shoulder_span_max && missingIds.size >= CFG.too_far_min_missing) {
    return [MSG_TOO_FAR, 'too_far'];
  }
  if (!gateUpper) return [MSG_POOR_DETECTION, 'poor_detection'];
  return [MSG_TOO_CLOSE, 'too_close'];
}

// ---------------------------------------------------------------------------
// validate_pose_for_analysis (from Python)
// ---------------------------------------------------------------------------
export function validatePoseForAnalysis(landmarks, skipSideView = false) {
  const visMin = CFG.keypoint_vis_min;
  const margin = CFG.keypoint_frame_margin;

  const headMissing  = gateMissing(landmarks, GATE_HEAD,  visMin, margin, false);
  const upperMissing = gateMissing(landmarks, GATE_UPPER, visMin, margin, false);
  const lowerMissing = gateMissing(landmarks, GATE_LOWER, visMin, margin, true);

  const gateHead  = headMissing.size  === 0;
  const gateUpper = upperMissing.size === 0;
  const gateLower = lowerMissing.size === 0;

  if (gateHead && gateUpper && gateLower) {
    return { ready: true, message: '', kind: 'ok', gateHead: true, gateUpper: true, gateLower: true };
  }

  const missingIds = new Set([...headMissing, ...upperMissing, ...lowerMissing]);
  const [message, kind] = positioningFeedback(
    missingIds, gateHead, gateUpper, gateLower, landmarks, visMin, margin, skipSideView
  );
  return { ready: false, message, kind, gateHead, gateUpper, gateLower };
}

// ---------------------------------------------------------------------------
// Guide box helpers (from Python get_guide_box_rect / _body_fits_guide_box)
// ---------------------------------------------------------------------------
export function getGuideBoxRect(w, h) {
  const shortSide = Math.min(w, h);
  const isPortrait = h > w;
  const isMobileLike = shortSide <= 600;

  // On mobile portrait, expand the guide box so it covers almost the full screen.
  const widthRatio = (isMobileLike && isPortrait)
    ? Math.max(CFG.guide_box_width_ratio, 0.90)
    : CFG.guide_box_width_ratio;
  const heightRatio = (isMobileLike && isPortrait)
    ? Math.max(CFG.guide_box_height_ratio, 0.93)
    : CFG.guide_box_height_ratio;
  const topRatio = (isMobileLike && isPortrait)
    ? Math.min(CFG.guide_box_top_ratio, 0.03)
    : CFG.guide_box_top_ratio;

  const boxW = Math.floor(w * widthRatio);
  const boxH = Math.floor(h * heightRatio);
  const cx = Math.floor(w / 2);
  const top = Math.floor(h * topRatio);
  const x1 = Math.max(0, cx - Math.floor(boxW / 2));
  const y1 = Math.max(0, top);
  const x2 = Math.min(w - 1, cx + Math.floor(boxW / 2));
  const y2 = Math.min(h - 1, y1 + boxH);
  return [x1, y1, x2, y2];
}

export function bodyFitsGuideBox(landmarks, w, h) {
  const [x1, y1, x2, y2] = getGuideBoxRect(w, h);
  const padX = CFG.guide_box_inner_pad_ratio / Math.max(w, 1);
  const padY = CFG.guide_box_inner_pad_ratio / Math.max(h, 1);
  const nx1 = x1 / w + padX;
  const ny1 = y1 / h + padY;
  const nx2 = x2 / w - padX;
  const ny2 = y2 / h - padY;

  const fitIds = [
    LM.NOSE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
    LM.LEFT_HEEL, LM.RIGHT_HEEL,
    LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX,
  ];
  for (const id of fitIds) {
    const lm = landmarks[id];
    if (lm.x < nx1 || lm.x > nx2 || lm.y < ny1 || lm.y > ny2) {
      return [false, MSG_TOO_CLOSE, 'box_overflow'];
    }
  }
  const nose = landmarks[LM.NOSE];
  const footY = Math.max(
    landmarks[LM.LEFT_ANKLE].y, landmarks[LM.RIGHT_ANKLE].y,
    landmarks[LM.LEFT_HEEL].y,  landmarks[LM.RIGHT_HEEL].y,
    landmarks[LM.LEFT_FOOT_INDEX].y, landmarks[LM.RIGHT_FOOT_INDEX].y,
  );
  const boxHNorm = (y2 - y1) / Math.max(h, 1);
  const bodyHNorm = footY - nose.y;
  if (bodyHNorm < boxHNorm * CFG.guide_box_min_body_fill_ratio) {
    return [false, MSG_TOO_FAR, 'too_far'];
  }
  return [true, '', 'ok'];
}

// ---------------------------------------------------------------------------
// Stage 2 and 3 validation
// ---------------------------------------------------------------------------
export function validateStage2Framing(landmarks, w, h) {
  const v = validatePoseForAnalysis(landmarks, true);
  if (!v.ready) return v;
  const [boxOk, boxMsg, boxKind] = bodyFitsGuideBox(landmarks, w, h);
  if (boxOk) return v;
  return { ready: false, message: boxMsg, kind: boxKind,
           gateHead: v.gateHead, gateUpper: v.gateUpper, gateLower: v.gateLower };
}

export function checkFrontFacing(landmarks) {
  const v = validatePoseForAnalysis(landmarks);
  if (v.ready) return [true, ''];
  if (v.kind === 'side_view') return [false, MSG_SIDE_VIEW];
  const visMin = CFG.keypoint_vis_min;
  const margin = CFG.keypoint_frame_margin;
  const missing = new Set([
    ...gateMissing(landmarks, GATE_HEAD,  visMin, margin, false),
    ...gateMissing(landmarks, GATE_UPPER, visMin, margin, false),
    ...gateMissing(landmarks, GATE_LOWER, visMin, margin, true),
  ]);
  if (oneSideObscured(missing)) return [false, MSG_SIDE_VIEW];
  return [false, MSG_SIDE_VIEW];
}

// ---------------------------------------------------------------------------
// Torso calibration singleton
// ---------------------------------------------------------------------------
// Captures the baseline standing torso height once (normalised coords) when the
// user is confirmed standing straight.  Both detection and drawing reference
// this FIXED value so the threshold line never collapses during forward bending.

const _torsoCalib = {
  locked:              false,
  standingHeightNorm:  null,   // |hipY − shY| (normalised) when standing upright
  lockedHipYNorm:      null,   // hip-centre Y at calibration moment
  lockedShoulderYNorm: null,   // shoulder-centre Y at calibration moment
  _emaVGapRatio:       null,   // EMA of the fixed-reference vGapRatio
};

const TORSO_EMA_ALPHA = 0.25;  // smoothing factor  (0 = no update, 1 = no memory)

/**
 * calibrateTorsoFromLandmarks — lock the standing reference from current pose.
 * Call exactly once when the user is confirmed in the upright standing position
 * (i.e. just before EXERCISE_ACTIVE begins).
 */
export function calibrateTorsoFromLandmarks(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  const shY  = (ls.y + rs.y) * 0.5;
  const hipY = (lh.y + rh.y) * 0.5;
  // Minimum of 0.05 guards against bad frames at calibration time.
  const height = Math.max(0.05, Math.abs(hipY - shY));

  _torsoCalib.locked              = true;
  _torsoCalib.standingHeightNorm  = height;
  _torsoCalib.lockedHipYNorm      = hipY;
  _torsoCalib.lockedShoulderYNorm = shY;
  _torsoCalib._emaVGapRatio       = 1.0;
}

/**
 * resetTorsoCalibration — clear calibration (call on exercise reset / restart).
 */
export function resetTorsoCalibration() {
  _torsoCalib.locked              = false;
  _torsoCalib.standingHeightNorm  = null;
  _torsoCalib.lockedHipYNorm      = null;
  _torsoCalib.lockedShoulderYNorm = null;
  _torsoCalib._emaVGapRatio       = null;
}

/**
 * getTorsoCalibration — returns the calibration object if locked, else null.
 * Read-only accessor used by drawUtils for the fixed reference line.
 */
export function getTorsoCalibration() {
  return _torsoCalib.locked ? _torsoCalib : null;
}

// ---------------------------------------------------------------------------
// Stance-phase ONLY: ankle width ≈ shoulder width
// (Exercise-phase form checks below are unchanged.)
// ---------------------------------------------------------------------------

/**
 * Compare ankle stance width to shoulder width.
 * This is the sole validation rule used during STANCE_CHECK.
 *
 * @returns {{
 *   ok: boolean,
 *   status: 'ok'|'narrow'|'wide',
 *   feedback: string,
 *   shoulderWidth: number,
 *   ankleWidth: number,
 *   ratio: number,
 *   tolerance: number,
 *   ls: object, rs: object, la: object, ra: object,
 *   allCues: string[],
 *   checkOk: object,
 *   skelOk: boolean,
 *   stanceMode: 'width',
 * }}
 */
export function checkShoulderAnkleWidth(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];

  const shoulderWidth = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  const ankleWidth = Math.abs(la.x - ra.x);
  const ratio = ankleWidth / shoulderWidth;
  const tolerance = CFG.shoulder_ankle_tolerance;

  let status = 'ok';
  let feedback = 'Great! Your stance looks good.';
  let ok = true;

  if (ratio < 1 - tolerance) {
    status = 'narrow';
    feedback = 'Please spread your feet slightly.';
    ok = false;
  } else if (ratio > 1 + tolerance) {
    status = 'wide';
    feedback = 'Please bring your feet closer together.';
    ok = false;
  }

  return {
    ok,
    status,
    feedback,
    shoulderWidth,
    ankleWidth,
    ratio,
    tolerance,
    ls, rs, la, ra,
    allCues: ok ? [] : [status === 'narrow' ? 'stance_narrow' : 'stance_wide'],
    checkOk: { shoulder_ankle_width: ok },
    skelOk: ok,
    stanceMode: 'width',
  };
}

// ---------------------------------------------------------------------------
// Stance checks (from Python check_shoulder_foot_vertical etc.)
// Used during EXERCISE_ACTIVE form monitoring — not for STANCE_CHECK.
// ---------------------------------------------------------------------------

export function checkShoulderFootVertical(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];

  const sw = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  const leftDx  = (la.x - ls.x) / sw;
  const rightDx = (ra.x - rs.x) / sw;

  const lLo = -(CFG.shoulder_foot_align_ratio_max + CFG.sf_left_inner_offset_ratio);
  const lHi = +(CFG.shoulder_foot_align_ratio_max + CFG.sf_left_outer_offset_ratio);
  const rLo = -(CFG.shoulder_foot_align_ratio_max + CFG.sf_right_inner_offset_ratio);
  const rHi = +(CFG.shoulder_foot_align_ratio_max + CFG.sf_right_outer_offset_ratio);

  const issues = []; const cueKeys = [];
  if (!(lLo <= leftDx && leftDx <= lHi)) {
    issues.push(`${viewSide('left')} foot not under ${viewSide('left')} shoulder`);
    cueKeys.push(cueForView(leftDx < lLo ? 'ankle_left_inner' : 'ankle_left_outer'));
  }
  if (!(rLo <= rightDx && rightDx <= rHi)) {
    issues.push(`${viewSide('right')} foot not under ${viewSide('right')} shoulder`);
    cueKeys.push(cueForView(rightDx < rLo ? 'ankle_right_outer' : 'ankle_right_inner'));
  }
  if (issues.length) {
    return ['Shoulder-Foot: ' + issues.join('; '), 'red', Math.abs(leftDx), Math.abs(rightDx), cueKeys,
            sw, ls.x, rs.x, la, ra];
  }
  return ['Shoulder-Foot: OK', 'green', Math.abs(leftDx), Math.abs(rightDx), [],
          sw, ls.x, rs.x, la, ra];
}

export function checkShoulderFootIndexVertical(landmarks) {
  const ls  = landmarks[LM.LEFT_SHOULDER];
  const rs  = landmarks[LM.RIGHT_SHOULDER];
  const lfi = landmarks[LM.LEFT_FOOT_INDEX];
  const rfi = landmarks[LM.RIGHT_FOOT_INDEX];

  const sw    = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  const leftDx  = (lfi.x - ls.x) / sw;
  const rightDx = (rfi.x - rs.x) / sw;

  const lLo = -(CFG.foot_index_align_ratio_max + CFG.fi_left_inner_offset_ratio);
  const lHi = +(CFG.foot_index_align_ratio_max + CFG.fi_left_outer_offset_ratio);
  const rLo = -(CFG.foot_index_align_ratio_max + CFG.fi_right_inner_offset_ratio);
  const rHi = +(CFG.foot_index_align_ratio_max + CFG.fi_right_outer_offset_ratio);

  const issues = []; const cueKeys = [];
  if (!(lLo <= leftDx && leftDx <= lHi)) {
    issues.push(`${viewSide('left')} foot index not under ${viewSide('left')} shoulder`);
    cueKeys.push(cueForView(leftDx < lLo ? 'toe_left_inner' : 'toe_left_outer'));
  }
  if (!(rLo <= rightDx && rightDx <= rHi)) {
    issues.push(`${viewSide('right')} foot index not under ${viewSide('right')} shoulder`);
    cueKeys.push(cueForView(rightDx < rLo ? 'toe_right_outer' : 'toe_right_inner'));
  }
  if (issues.length) {
    return ['FootIdx: ' + issues.join('; '), 'red', Math.abs(leftDx), Math.abs(rightDx), cueKeys,
            sw, ls.x, rs.x, lfi, rfi];
  }
  return ['FootIdx: OK', 'green', Math.abs(leftDx), Math.abs(rightDx), [],
          sw, ls.x, rs.x, lfi, rfi];
}

export function checkShoulderKneeVertical(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lk = landmarks[LM.LEFT_KNEE];
  const rk = landmarks[LM.RIGHT_KNEE];

  const sw    = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  const leftDx  = (lk.x - ls.x) / sw;
  const rightDx = (rk.x - rs.x) / sw;

  const lLo = -(CFG.knee_align_ratio_max + CFG.kn_left_inner_offset_ratio);
  const lHi = +(CFG.knee_align_ratio_max + CFG.kn_left_outer_offset_ratio);
  const rLo = -(CFG.knee_align_ratio_max + CFG.kn_right_inner_offset_ratio);
  const rHi = +(CFG.knee_align_ratio_max + CFG.kn_right_outer_offset_ratio);

  const issues = []; const cueKeys = [];
  if (!(lLo <= leftDx && leftDx <= lHi)) {
    issues.push(`${viewSide('left')} knee not under ${viewSide('left')} shoulder`);
    cueKeys.push(cueForView(leftDx < lLo ? 'knee_left_inner' : 'knee_left_outer'));
  }
  if (!(rLo <= rightDx && rightDx <= rHi)) {
    issues.push(`${viewSide('right')} knee not under ${viewSide('right')} shoulder`);
    cueKeys.push(cueForView(rightDx < rLo ? 'knee_right_outer' : 'knee_right_inner'));
  }
  if (issues.length) {
    return ['Knee: ' + issues.join('; '), 'red', Math.abs(leftDx), Math.abs(rightDx), cueKeys,
            sw, ls.x, rs.x, lk, rk];
  }
  return ['Knee: OK', 'green', Math.abs(leftDx), Math.abs(rightDx), [],
          sw, ls.x, rs.x, lk, rk];
}

export function checkHipCenterVertical(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  const lk = landmarks[LM.LEFT_KNEE];
  const rk = landmarks[LM.RIGHT_KNEE];

  const sw     = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  const hipX   = (lh.x + rh.x) * 0.5;
  const hipY   = (lh.y + rh.y) * 0.5;
  const kneeX  = (lk.x + rk.x) * 0.5;
  const kneeY  = (lk.y + rk.y) * 0.5;
  const dxRatio = Math.abs(kneeX - hipX) / sw;
  const tol = CFG.hip_align_ratio_max + CFG.hip_offset_ratio;
  const ok = dxRatio <= tol;

  if (ok) {
    return ['Hip: center over knee line OK', 'green', dxRatio, hipX, hipY, kneeX, kneeY, sw, []];
  }
  const hipCue = cueForView(kneeX < hipX ? 'hip_left' : 'hip_right');
  return ['Hip ALERT: crossed tolerance', 'red', dxRatio, hipX, hipY, kneeX, kneeY, sw, [hipCue]];
}

export function checkTorsoFrontVertical(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];

  const sw   = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  const shX  = (ls.x + rs.x) * 0.5;
  const shY  = (ls.y + rs.y) * 0.5;
  const hipX = (lh.x + rh.x) * 0.5;
  const hipY = (lh.y + rh.y) * 0.5;

  const dxRatio = Math.abs(shX - hipX) / sw;
  const xTol    = CFG.torso_horizontal_align_ratio_max + CFG.torso_horizontal_offset_ratio;
  const xOk     = dxRatio <= xTol;

  // ── Vertical-gap ratio with FIXED calibrated reference ──────────────────
  // When calibration is locked (exercise phase) we divide the CURRENT vertical
  // shoulder-to-hip distance by the STANDING baseline height captured at
  // calibration time.  This prevents 2-D foreshortening (user bending toward
  // the camera) from shrinking the denominator and fooling the check.
  //
  // Without calibration (stance-check phases) we fall back to the original
  // self-normalising cos(tilt) computation so stance checking still works.
  const currentVertGap = Math.abs(hipY - shY);
  let vGapRatio;

  if (_torsoCalib.locked && _torsoCalib.standingHeightNorm) {
    // Fixed-reference ratio: drops below vMin when shoulders approach hips.
    const rawRatio = currentVertGap / _torsoCalib.standingHeightNorm;
    // EMA smoothing — suppresses single-frame noise while reacting within ~4 frames.
    if (_torsoCalib._emaVGapRatio === null) {
      _torsoCalib._emaVGapRatio = rawRatio;
    } else {
      _torsoCalib._emaVGapRatio =
        TORSO_EMA_ALPHA * rawRatio + (1 - TORSO_EMA_ALPHA) * _torsoCalib._emaVGapRatio;
    }
    // Allow slightly above 1.0 (camera zoom / framing drift) but cap at 1.2.
    vGapRatio = Math.max(0, Math.min(1.2, _torsoCalib._emaVGapRatio));
  } else {
    // Original dynamic ratio (cos of tilt angle) — used during stance phases.
    const torsoLen = Math.max(Math.hypot(hipX - shX, hipY - shY), 1e-6);
    vGapRatio = Math.max(0, Math.min(1, currentVertGap / torsoLen));
  }

  const vMin = Math.max(0.01, Math.min(1.0,
    CFG.torso_vertical_gap_min_ratio - CFG.torso_vertical_gap_offset_ratio));
  const vOk = vGapRatio >= vMin;

  if (xOk && vOk) {
    return ['Torso: front bend tolerance OK', 'green', dxRatio, vGapRatio, shX, shY, hipX, hipY, sw, []];
  }
  const issues = []; const cueKeys = [];
  if (!xOk) {
    issues.push('horizontal drift');
    cueKeys.push(cueForView(shX < hipX ? 'torso_x_left' : 'torso_x_right'));
  }
  if (!vOk) {
    issues.push('too much front bend');
    cueKeys.push('torso_bend');
  }
  return ['Torso ALERT: ' + issues.join('; '), 'red', dxRatio, vGapRatio, shX, shY, hipX, hipY, sw, cueKeys];
}

export function checkShoulderLevel(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const sw      = Math.max(Math.abs(ls.x - rs.x), 1e-6);
  const dyRatio = Math.abs(ls.y - rs.y) / sw;
  const tol     = CFG.shoulder_level_align_ratio_max + CFG.shoulder_level_offset_ratio;
  const ok      = dyRatio <= tol;

  if (ok) {
    return ['Shoulder level: OK', 'green', dyRatio, ls.x, ls.y, rs.x, rs.y, sw, []];
  }
  const shlvlCue = cueForView(ls.y < rs.y ? 'shoulder_high_left' : 'shoulder_high_right');
  return ['Shoulder ALERT: uneven height', 'red', dyRatio, ls.x, ls.y, rs.x, rs.y, sw, [shlvlCue]];
}

export function skeletonPoseAllPass(
  leftRatio, rightRatio, alignRatioMax,
  leftInner, leftOuter, rightInner, rightOuter
) {
  const lMax = alignRatioMax + Math.max(leftInner, leftOuter);
  const rMax = alignRatioMax + Math.max(rightInner, rightOuter);
  return leftRatio <= lMax && rightRatio <= rMax;
}

// ---------------------------------------------------------------------------
// Full Stage 4B check results (helper used in PoseCamera)
// ---------------------------------------------------------------------------
export function runAllStanceChecks(landmarks) {
  const [sfLabel, sfColorKey, sfLeft, sfRight, sfCues, sfSW, , , ,] =
    checkShoulderFootVertical(landmarks);
  const [fiLabel, fiColorKey, fiLeft, fiRight, fiCues, fiSW, , , ,] =
    checkShoulderFootIndexVertical(landmarks);
  const [knLabel, knColorKey, knLeft, knRight, knCues, knSW, , , ,] =
    checkShoulderKneeVertical(landmarks);
  const [hipLabel, hipColorKey, hipDx, hipX, hipY, kneeX, kneeY, hipSW, hipCues] =
    checkHipCenterVertical(landmarks);
  const [torsoLabel, torsoColorKey, torsoDx, torsoVGap, shX, shY, tHipX, tHipY, torsoSW, torsoCues] =
    checkTorsoFrontVertical(landmarks);
  const [shlvlLabel, shlvlColorKey, shlvlDy, lsx, lsy, rsx, rsy, shlvlSW, shlvlCues] =
    checkShoulderLevel(landmarks);

  const sfOk = skeletonPoseAllPass(sfLeft, sfRight, CFG.shoulder_foot_align_ratio_max,
    CFG.sf_left_inner_offset_ratio, CFG.sf_left_outer_offset_ratio,
    CFG.sf_right_inner_offset_ratio, CFG.sf_right_outer_offset_ratio);
  const fiOk = skeletonPoseAllPass(fiLeft, fiRight, CFG.foot_index_align_ratio_max,
    CFG.fi_left_inner_offset_ratio, CFG.fi_left_outer_offset_ratio,
    CFG.fi_right_inner_offset_ratio, CFG.fi_right_outer_offset_ratio);
  const knOk = skeletonPoseAllPass(knLeft, knRight, CFG.knee_align_ratio_max,
    CFG.kn_left_inner_offset_ratio, CFG.kn_left_outer_offset_ratio,
    CFG.kn_right_inner_offset_ratio, CFG.kn_right_outer_offset_ratio);
  const hipOk   = hipDx   <= (CFG.hip_align_ratio_max + CFG.hip_offset_ratio);
  const vMin    = Math.max(0.01, Math.min(1.0,
    CFG.torso_vertical_gap_min_ratio - CFG.torso_vertical_gap_offset_ratio));
  const torsoOk = torsoDx <= (CFG.torso_horizontal_align_ratio_max + CFG.torso_horizontal_offset_ratio)
                  && torsoVGap >= vMin;
  const shlvlOk = shlvlDy <= (CFG.shoulder_level_align_ratio_max + CFG.shoulder_level_offset_ratio);

  return {
    sf:    { label: sfLabel,    colorKey: sfColorKey,    left: sfLeft,    right: sfRight,    cues: sfCues,    ok: sfOk    },
    fi:    { label: fiLabel,    colorKey: fiColorKey,    left: fiLeft,    right: fiRight,    cues: fiCues,    ok: fiOk    },
    kn:    { label: knLabel,    colorKey: knColorKey,    left: knLeft,    right: knRight,    cues: knCues,    ok: knOk    },
    hip:   { label: hipLabel,   colorKey: hipColorKey,   dx: hipDx,       x: hipX,          y: hipY,          cues: hipCues,   ok: hipOk,   sw: hipSW  },
    torso: { label: torsoLabel, colorKey: torsoColorKey, dx: torsoDx,     vGap: torsoVGap,  shX, shY, hipX: tHipX, hipY: tHipY, cues: torsoCues, ok: torsoOk, sw: torsoSW },
    shlvl: { label: shlvlLabel, colorKey: shlvlColorKey, dy: shlvlDy,     lsx, lsy,         rsx, rsy,          cues: shlvlCues, ok: shlvlOk, sw: shlvlSW  },
    kneeX, kneeY,
    allCues: [...sfCues, ...fiCues, ...knCues, ...hipCues, ...torsoCues, ...shlvlCues],
    skelOk: sfOk && fiOk && knOk && hipOk && torsoOk && shlvlOk,
    checkOk: { shoulder_level: shlvlOk, shoulder_foot: sfOk, foot_index: fiOk, knee: knOk, hip: hipOk, torso: torsoOk },
  };
}

// ---------------------------------------------------------------------------
// Speech helpers (from Python _normalize_speech / _speech_has_yes etc.)
// ---------------------------------------------------------------------------
export function normalizeSpeech(text) {
  return text.toLowerCase().trim()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
}

export function speechHasYes(text) {
  const t = normalizeSpeech(text);
  if (!t) return false;

  // Accept common yes confirmations, including when STT inserts extra words.
  const yesWords = new Set(['yes', 'yeah', 'yep', 'yup', 'ya', 'yea', 'ok', 'okay', 'sure', 'alright']);
  if (yesWords.has(t)) return true;

  // Handle "y e s" style transcripts (after normalizeSpeech keeps spaces).
  if (/\by\s*e\s*s\b/.test(t)) return true;

  return t.split(' ').some(w => yesWords.has(w));
}

export function speechHasStart(text) {
  const t = normalizeSpeech(text);
  if (!t) return false;
  if (['start', 'begin', 'go'].includes(t)) return true;
  if (t.startsWith('start ') || t.startsWith('lets start')) return true;
  return t.split(' ').some(w => ['start', 'begin'].includes(w));
}

export function matchesTrainingStart(text) {
  const t = normalizeSpeech(text);
  if (speechHasYes(text)) return true;
  if (speechHasStart(text)) return true;
  return t.includes('start training') || t.includes('start the training');
}

export function matchesStancePermission(text) {
  const t = normalizeSpeech(text);
  if (speechHasYes(text)) return true;
  return t.includes('check my stance') || t.includes('check stance');
}

export function matchesExercisePermission(text) {
  if (speechHasYes(text)) return true;
  if (speechHasStart(text)) return true;
  const t = normalizeSpeech(text);
  return t.includes('start exercise') || t.includes('start the exercise');
}
