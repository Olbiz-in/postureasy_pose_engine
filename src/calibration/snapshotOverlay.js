// Still-photo tolerance overlay for the calibration editor.
//
// The live trackers are time-based state machines (stance holds, calibration,
// sustain windows), so a single photo never reaches their rep overlays. This
// module runs each exercise's pure checks + draw helpers directly on one set
// of landmarks, reading the same live CFG objects the sliders mutate, so a
// redraw after every slider change shows exactly the band the tracker uses.

import { LM, jointAngle } from '../core/landmarks';
import { createPoseLandmarker } from '../core/poseLandmarker';
import { drawSkeleton } from '../core/drawSkeleton';
import { trackingSettings, getPushUpDepthBand } from '../core/trackingSettings';
import {
  HUD_CYAN, HUD_GREEN, HUD_RED, HUD_GREY,
  line, dot, drawStanceGuides,
} from '../exercises/common/hud';

import {
  runAllStanceChecks, checkShoulderAnkleWidth, checkStanceToeAngles,
} from '../exercises/squat/poseLogic';
import { drawAllStanceToleranceGuides, drawHipCenterGuides } from '../exercises/squat/draw';

import {
  pushupShoulderWidth, checkWristAlignment, checkElbowAlignment,
  checkWristElbowCollinearity, checkHandOrientation,
} from '../exercises/pushup/PushUpRepTracker';
import { drawPushUpToleranceLines } from '../exercises/pushup/draw';

import {
  buildGeometry as buildPressGeometry, checkStance as checkPressStance, checkTorsoLean,
  checkShoulderLevel as checkPressShoulderLevel, checkForearms, checkElbowTuck, checkTopWidth,
  checkSymmetry as checkPressSymmetry,
} from '../exercises/shoulderPress/poseChecks';
import { drawAllToleranceGuides } from '../exercises/shoulderPress/draw';

import { LR_CFG, LR_TRACKED_LANDMARKS } from '../exercises/lateralRaise/config';
import {
  buildGeometry as buildLateralGeometry, evaluateStance as evaluateLateralStance,
  raiseLines as lateralLines,
} from '../exercises/lateralRaise/poseChecks';
import { drawShoulderLine as drawLateralShoulderLine } from '../exercises/lateralRaise/draw';

import { FR_CFG, FR_TRACKED_LANDMARKS } from '../exercises/frontRaise/config';
import {
  buildGeometry as buildFrontGeometry, evaluateStance as evaluateFrontRaiseStance,
  raiseLines as frontLines,
} from '../exercises/frontRaise/poseChecks';
import { drawShoulderLine as drawFrontShoulderLine } from '../exercises/frontRaise/draw';

import { DC_CFG, DC_TRACKED_LANDMARKS } from '../exercises/dumbbellCurl/config';
import { buildCurlGeometry, evaluateCurlStance, curlLines } from '../exercises/dumbbellCurl/poseChecks';
import { drawCurlLines } from '../exercises/dumbbellCurl/draw';

export const CALIBRATION_FAMILIES = [
  'squat', 'pushup', 'shoulderpress', 'lateralraise', 'frontraise', 'dumbbellcurl',
];

// ── Pose detection on a still image ─────────────────────────────────────────

let imageLandmarkerPromise = null;

function getImageLandmarker() {
  if (!imageLandmarkerPromise) {
    imageLandmarkerPromise = createPoseLandmarker({ runningMode: 'IMAGE' }).catch((err) => {
      imageLandmarkerPromise = null;
      throw err;
    });
  }
  return imageLandmarkerPromise;
}

/**
 * Detect one pose on an HTMLImageElement / canvas / ImageBitmap.
 * @returns {Promise<Array<{x:number,y:number,z:number,visibility:number}>|null>}
 *          normalized landmarks, or null when no person was found
 */
export async function detectPoseInImage(image) {
  const landmarker = await getImageLandmarker();
  const result = landmarker.detect(image);
  return result?.landmarks?.[0] || null;
}

// ── Shared still-photo guides ───────────────────────────────────────────────

function pixelPoints(landmarks, indices, minVis, w, h) {
  const out = new Map();
  for (const i of indices) {
    const lm = landmarks[i];
    const v = lm ? (lm.visibility == null ? 1 : lm.visibility) : 0;
    out.set(i, lm && v >= minVis ? { x: lm.x * w, y: lm.y * h, v, held: false } : null);
  }
  return out;
}

/** Plumb line from the hip center with ± lean rails at shoulder height. */
function drawUprightGuides(ctx, g, leanMax, h) {
  const tolPx = leanMax * g.sw;
  const halfLen = Math.max(10, 0.04 * h);
  const hx = g.hipMid.x;
  const ok = Math.abs(g.shMid.x - g.hipMid.x) <= tolPx;
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = HUD_GREY;
  ctx.lineWidth = 1;
  line(ctx, hx, g.hipMid.y, hx, g.shY - halfLen);
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = ok ? HUD_CYAN : HUD_RED;
  line(ctx, hx - tolPx, g.shY - halfLen, hx - tolPx, g.shY + halfLen);
  line(ctx, hx + tolPx, g.shY - halfLen, hx + tolPx, g.shY + halfLen);
  ctx.strokeStyle = ok ? HUD_GREEN : HUD_RED;
  line(ctx, g.hipMid.x, g.hipMid.y, g.shMid.x, g.shMid.y);
  dot(ctx, g.shMid.x, g.shMid.y, 5, ok ? HUD_GREEN : HUD_RED);
  ctx.restore();
  return ok;
}

/** Horizontal band around the mean height of two points; ok when their gap ≤ maxGapPx. */
function drawLevelBand(ctx, a, b, maxGapPx, pad) {
  const midY = (a.y + b.y) / 2;
  const half = maxGapPx / 2;
  const x0 = Math.min(a.x, b.x) - pad;
  const x1 = Math.max(a.x, b.x) + pad;
  const ok = Math.abs(a.y - b.y) <= maxGapPx;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ok ? 'rgba(0,200,255,0.8)' : HUD_RED;
  line(ctx, x0, midY - half, x1, midY - half);
  line(ctx, x0, midY + half, x1, midY + half);
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = ok ? HUD_GREEN : HUD_RED;
  line(ctx, a.x, a.y, b.x, b.y);
  ctx.setLineDash([]);
  dot(ctx, a.x, a.y, 4, ok ? HUD_GREEN : HUD_RED);
  dot(ctx, b.x, b.y, 4, ok ? HUD_GREEN : HUD_RED);
  ctx.restore();
  return ok;
}

function stanceChecks(st) {
  const c = st?.checks || {};
  return [
    { label: 'Facing the camera', ok: !!c.facing },
    { label: 'Standing upright', ok: !!c.upright },
    { label: 'Feet width', ok: !!c.feet },
  ];
}

// ── Per-exercise overlays ───────────────────────────────────────────────────

function drawSquat(ctx, landmarks, { width: w, height: h }) {
  const checks = runAllStanceChecks(landmarks);
  const cues = new Set(checks.allCues);
  drawAllStanceToleranceGuides(ctx, landmarks, checks, w, h, cues);
  drawHipCenterGuides(
    ctx, checks.hip.x, checks.hip.y, checks.kneeX, checks.kneeY, checks.hip.sw, checks.hip.dx, w, h, cues,
  );
  return [
    { label: 'Feet vs shoulder width', ok: checkShoulderAnkleWidth(landmarks).ok },
    { label: 'Knees over ankles', ok: checks.kn.ok },
    { label: 'Toes pointing forward', ok: checkStanceToeAngles(landmarks).ok },
    { label: 'Torso centered', ok: checks.torso.ok },
    { label: 'Hips centered', ok: checks.hip.ok },
    { label: 'Shoulders level', ok: checks.shlvl.ok },
  ];
}

function drawPushUp(ctx, landmarks, { width: w, height: h }) {
  drawPushUpToleranceLines(ctx, landmarks, w, h);
  const sw = pushupShoulderWidth(landmarks);
  const angleOf = (s, e, wr) => jointAngle(landmarks[s], landmarks[e], landmarks[wr]);
  const angles = [
    angleOf(LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST),
    angleOf(LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST),
  ].filter((a) => a != null);
  const elbowAngle = angles.length ? angles.reduce((a, b) => a + b, 0) / angles.length : null;
  const band = getPushUpDepthBand();
  return [
    { label: 'Wrists in band', ok: checkWristAlignment(landmarks, sw).ok },
    { label: 'Elbows in band', ok: checkElbowAlignment(landmarks, sw).ok },
    { label: 'Forearms straight', ok: checkWristElbowCollinearity(landmarks, sw).ok },
    { label: 'Hands facing forward', ok: checkHandOrientation(landmarks, sw).ok },
    elbowAngle != null && {
      label: `Elbow angle ${Math.round(elbowAngle)}° (bottom target ${band.min}–${band.max}°)`,
      ok: elbowAngle >= band.min && elbowAngle <= band.max,
      info: true,
    },
  ].filter(Boolean);
}

function drawShoulderPress(ctx, landmarks, { width: w, height: h, mirrored }) {
  const g = buildPressGeometry(landmarks, w, h);
  if (!g) return null;
  const armLenRef = Math.max(g.leftArmLen, g.rightArmLen);
  drawAllToleranceGuides(ctx, g, h, mirrored, { showStance: true, armLenRef });
  const stance = checkPressStance(g, 1);
  return [
    { label: 'Feet shoulder width', ok: stance.ok && !stance.skipped },
    { label: 'No side bend', ok: checkTorsoLean(g).ok },
    { label: 'Shoulders level', ok: checkPressShoulderLevel(g).ok },
    { label: 'Wrists stacked over elbows', ok: checkForearms(g).ok },
    { label: 'Elbows out enough', ok: checkElbowTuck(g).ok },
    { label: 'Wrists not too wide', ok: checkTopWidth(g).ok },
    { label: 'Left/right even', ok: checkPressSymmetry(g).ok },
  ];
}

function drawRaise(ctx, landmarks, frame, spec) {
  const { width: w, height: h, mirrored } = frame;
  const { cfg, tracked, build, stance, prefix, drawLine, lines, symmetryPoint } = spec;
  const g = build(pixelPoints(landmarks, tracked, cfg.min_visibility, w, h), null);
  if (!g) return null;
  const st = stance(g, g.sw);
  drawStanceGuides(ctx, g, st, h, {
    stanceMin: cfg.stance_min, stanceMax: cfg.stance_max,
    narrowKey: `${prefix}feet_narrow`, wideKey: `${prefix}feet_wide`,
  });
  drawUprightGuides(ctx, g, cfg.upright_lean_max, h);
  const tiltOk = drawLevelBand(ctx, g.ls, g.rs, cfg.shoulder_tilt_max * g.norm, 0.15 * g.norm);
  drawLine(ctx, g, null, mirrored, h);

  const out = [...stanceChecks(st), { label: 'Shoulders level', ok: tiltOk }];
  const arms = [g.left, g.right].filter((a) => a.ok);
  if (arms.length === 2) {
    const a = symmetryPoint(g.left);
    const b = symmetryPoint(g.right);
    out.push({ label: 'Left/right height even', ok: Math.abs(a.y - b.y) <= cfg.symmetry_max * g.norm });
  }
  const L = lines(g, null);
  out.push(...spec.extraChecks(g, L, arms));
  return out;
}

function drawLateralRaise(ctx, landmarks, frame) {
  return drawRaise(ctx, landmarks, frame, {
    cfg: LR_CFG,
    tracked: LR_TRACKED_LANDMARKS,
    build: buildLateralGeometry,
    stance: evaluateLateralStance,
    prefix: 'lr_',
    drawLine: drawLateralShoulderLine,
    lines: lateralLines,
    symmetryPoint: (a) => a.elbow,
    extraChecks: (g, L, arms) => [
      { label: 'Wrists under wrist limit', ok: arms.every((a) => a.wrist.y >= L.wristLimitY) },
      { label: 'Elbows not above band', ok: arms.every((a) => a.elbow.y >= L.bandTopY) },
    ],
  });
}

function drawFrontRaise(ctx, landmarks, frame) {
  return drawRaise(ctx, landmarks, frame, {
    cfg: FR_CFG,
    tracked: FR_TRACKED_LANDMARKS,
    build: buildFrontGeometry,
    stance: evaluateFrontRaiseStance,
    prefix: 'fr_',
    drawLine: drawFrontShoulderLine,
    lines: frontLines,
    symmetryPoint: (a) => a.wrist,
    extraChecks: (g, L, arms) => [
      { label: 'Wrists under upper limit', ok: arms.every((a) => a.wrist.y >= L.bandTopY) },
      { label: 'Arms inside lanes', ok: arms.every((a) => a.wristOut <= FR_CFG.flare_tolerance) },
    ],
  });
}

function drawDumbbellCurl(ctx, landmarks, { width: w, height: h, mirrored }) {
  const g = buildCurlGeometry(pixelPoints(landmarks, DC_TRACKED_LANDMARKS, DC_CFG.min_visibility, w, h), null);
  if (!g) return null;
  // No live calibration on a photo: resting heights fall back to the config defaults.
  const calib = {
    sw: g.sw,
    torso: g.torsoDist,
    restSpan: { left: DC_CFG.rest_span_default, right: DC_CFG.rest_span_default },
    restElbow: { left: DC_CFG.rest_elbow_default, right: DC_CFG.rest_elbow_default },
    restElbowOut: { left: g.left.elbowOut ?? 0, right: g.right.elbowOut ?? 0 },
  };
  const st = evaluateCurlStance(g, g.sw);
  drawStanceGuides(ctx, g, st, h, {
    stanceMin: DC_CFG.stance_min, stanceMax: DC_CFG.stance_max,
    narrowKey: 'dc_feet_narrow', wideKey: 'dc_feet_wide',
  });
  drawUprightGuides(ctx, g, DC_CFG.upright_lean_max, h);
  const tiltOk = drawLevelBand(ctx, g.ls, g.rs, DC_CFG.shoulder_tilt_max * g.norm, 0.15 * g.norm);
  drawCurlLines(ctx, { geometry: g, calib, sustainedCues: [] }, mirrored, h);

  const arms = [g.left, g.right].filter((a) => a.ok);
  return [
    ...stanceChecks(st),
    { label: 'Shoulders level', ok: tiltOk },
    {
      label: 'Wrists under upper limit',
      ok: arms.every((a) => a.wrist.y >= curlLines(g, a, calib).upperY),
    },
  ];
}

const DRAWERS = {
  squat: drawSquat,
  pushup: drawPushUp,
  shoulderpress: drawShoulderPress,
  lateralraise: drawLateralRaise,
  frontraise: drawFrontRaise,
  dumbbellcurl: drawDumbbellCurl,
};

/**
 * Draw the skeleton + every tolerance guide for `family` on one photo's
 * landmarks. The caller draws the photo itself first.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} family  one of CALIBRATION_FAMILIES
 * @param {Array} landmarks normalized landmarks from detectPoseInImage
 * @param {{width:number,height:number,mirrored?:boolean}} frame
 * @returns {{ok:boolean, reason?:string, checks:Array<{label:string,ok:boolean,info?:boolean}>}}
 */
export function drawCalibrationOverlay(ctx, family, landmarks, { width, height, mirrored = true }) {
  if (!landmarks) return { ok: false, reason: 'No person found in this photo', checks: [] };
  const draw = DRAWERS[family];
  if (!draw) return { ok: false, reason: 'This exercise has no photo calibration yet', checks: [] };

  drawSkeleton(ctx, landmarks, {
    width,
    height,
    color: '#22d3a6',
    lineWidth: Math.max(2, trackingSettings.skeletonLineWidth),
    jointRadius: trackingSettings.skeletonJointRadius,
  });
  const checks = draw(ctx, landmarks, { width, height, mirrored });
  if (!checks) {
    return { ok: false, reason: 'Shoulders and hips must be clearly visible', checks: [] };
  }
  return { ok: true, checks };
}
