// Side-view squat pose logic. Setup only needs the camera to notice the
// shoulder and ankle on the visible side. There is no guide box.

import { CFG } from '../squat/config.js';
import { pickVisibleSide, checkTorsoLeanSide } from './SideSquatRepTracker.js';

function landmarkNoticed(lm, visMin) {
  if (!lm) return false;
  const v = lm.visibility == null ? 1 : lm.visibility;
  return v >= visMin && Number.isFinite(lm.x) && Number.isFinite(lm.y);
}

/**
 * Side-view setup gate. The camera only has to notice one shoulder and the
 * ankle on that side (hip and knee in between). No guide box, and the head
 * does not have to be in frame.
 */
export function validateSideBody(landmarks) {
  if (!landmarks) {
    return {
      ready: false,
      message: 'Please stand in front of the camera.',
      kind: 'body_not_visible',
      gateHead: false, gateUpper: false, gateLower: false, vis: null,
    };
  }

  const vis = pickVisibleSide(landmarks);
  const visMin = CFG.keypoint_vis_min;
  const shoulderOk = vis && landmarkNoticed(vis.shoulder, visMin);
  const ankleOk = vis && landmarkNoticed(vis.ankle, visMin);
  const chainOk = vis
    && landmarkNoticed(vis.hip, visMin)
    && landmarkNoticed(vis.knee, visMin);

  if (shoulderOk && ankleOk && chainOk) {
    return {
      ready: true, message: '', kind: 'ok',
      gateHead: true, gateUpper: true, gateLower: true, vis,
    };
  }

  let message = 'Please stand in front of the camera.';
  if (vis && !ankleOk) message = 'Step back so your ankle is visible.';
  else if (vis && !shoulderOk) message = 'Step back so your shoulder is visible.';
  else if (vis) message = 'Step back so your body is visible.';

  return {
    ready: false, message, kind: 'body_not_visible',
    gateHead: false, gateUpper: !!shoulderOk, gateLower: !!ankleOk, vis: vis || null,
  };
}

function kneeAngleDeg(hip, knee, ankle) {
  const ax = hip.x - knee.x;
  const ay = hip.y - knee.y;
  const bx = ankle.x - knee.x;
  const by = ankle.y - knee.y;
  const mag = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (mag < 1e-6) return 180;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Setup only: the visible leg should be straight before the set starts. */
export function checkSideLegStraight(landmarks) {
  const vis = pickVisibleSide(landmarks);
  if (!vis) {
    return {
      ok: false, angle: 0, vis: null, key: 'legs_not_visible',
      feedback: 'Step back so your leg is visible.',
      allCues: ['legs_not_visible'],
    };
  }
  const angle = kneeAngleDeg(vis.hip, vis.knee, vis.ankle);
  const ok = angle >= 155;
  return {
    ok,
    angle,
    vis,
    key: ok ? null : 'legs_bent',
    feedback: ok ? 'Your leg looks straight.' : 'Straighten your leg.',
    allCues: ok ? [] : ['legs_bent'],
  };
}

/** Same camera-notice gate as validateSideBody. Width and height are ignored. */
export function validateSideStage2Framing(landmarks, _w, _h) {
  return validateSideBody(landmarks);
}

/** Standing-straight check (replaces front-view stance width/foot checks). */
export function checkSideStandingStraight(landmarks) {
  const vis = pickVisibleSide(landmarks);
  if (!vis) {
    return { ok: false, cues: [], lean: 0, vis: null };
  }
  const torso = checkTorsoLeanSide(vis, false);
  return {
    ok: torso.ok,
    cues: torso.ok ? [] : ['torso_lean'],
    lean: torso.lean,
    vis,
  };
}

export function runSideStandingCheck(landmarks) {
  const standing = checkSideStandingStraight(landmarks);
  const vis = standing.vis || pickVisibleSide(landmarks);
  return {
    standing,
    vis,
    allCues: standing.cues,
    checkOk: { standing_straight: standing.ok },
    torso: {
      ok: standing.ok,
      lean: standing.lean,
      cues: standing.cues,
      label: standing.ok ? 'Standing straight: OK' : 'Stand taller — lean back slightly',
      colorKey: standing.ok ? 'green' : 'red',
    },
  };
}

/** Live form cues during reps — maps side torso lean to front-view cue keys. */
export function runSideFormChecks(landmarks, inSquat) {
  const vis = pickVisibleSide(landmarks);
  if (!vis) return { allCues: [], vis: null, skelOk: true };
  const torso = checkTorsoLeanSide(vis, inSquat);
  const allCues = torso.cueKeys.map((k) => (k === 'torso_lean' ? 'torso_bend' : k));
  return { allCues, vis, skelOk: torso.ok, torso };
}

export function getSideSquatCoords(landmarks) {
  const vis = pickVisibleSide(landmarks);
  if (!vis) return null;
  const hipY = vis.hip.y;
  const kneeY = vis.knee.y;
  const legGap = kneeY - hipY;
  const sw = Math.max(vis.legLen, 0.08);
  return {
    vis,
    hipX: vis.hip.x,
    hipY,
    kneeX: vis.knee.x,
    kneeY,
    footY: vis.ankle.y,
    sw,
    leftGap: legGap,
    rightGap: legGap,
  };
}
