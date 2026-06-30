// Side-view squat pose logic — mirrors front-view framing/stance checks with
// profile-specific landmark selection. Reuses guide-box geometry from squat/poseLogic.

import { LM } from '../../core/landmarks';
import {
  CFG,
  MSG_HEAD,
  MSG_LEGS,
  MSG_FEET,
  MSG_TOO_CLOSE,
  MSG_TOO_FAR,
  MSG_POOR_DETECTION,
} from '../squat/config.js';
import { getGuideBoxRect } from '../squat/poseLogic.js';
import { pickVisibleSide, checkTorsoLeanSide } from './SideSquatRepTracker.js';

function landmarkConfident(lm, visMin, frameMargin, bottomMargin) {
  const bottom = bottomMargin != null ? bottomMargin : frameMargin;
  return (
    lm.visibility >= visMin
    && lm.x > frameMargin && lm.x < 1.0 - frameMargin
    && lm.y > frameMargin && lm.y < 1.0 - bottom
  );
}

function sideBodyFitsGuideBox(landmarks, vis, w, h) {
  const [x1, y1, x2, y2] = getGuideBoxRect(w, h);
  const padX = CFG.guide_box_inner_pad_ratio / Math.max(w, 1);
  const padY = CFG.guide_box_inner_pad_ratio / Math.max(h, 1);
  const nx1 = x1 / w + padX;
  const ny1 = y1 / h + padY;
  const nx2 = x2 / w - padX;
  const ny2 = y2 / h - padY;

  const nose = landmarks[LM.NOSE];
  const ankle = vis.ankle;
  for (const lm of [nose, ankle]) {
    if (lm.x < nx1 || lm.x > nx2 || lm.y < ny1 || lm.y > ny2) {
      return [false, MSG_TOO_CLOSE, 'box_overflow'];
    }
  }

  const boxHNorm = (y2 - y1) / Math.max(h, 1);
  const bodyHNorm = ankle.y - nose.y;
  if (bodyHNorm < boxHNorm * CFG.guide_box_min_body_fill_ratio) {
    return [false, MSG_TOO_FAR, 'too_far'];
  }
  return [true, '', 'ok'];
}

/**
 * Full-body visibility + guide-box check for side profile (same messages as front view).
 */
export function validateSideStage2Framing(landmarks, w, h) {
  const visMin = CFG.keypoint_vis_min;
  const margin = CFG.keypoint_frame_margin;
  const bottom = CFG.keypoint_bottom_margin;

  if (!landmarks) {
    return {
      ready: false, message: MSG_POOR_DETECTION, kind: 'poor_detection',
      gateHead: false, gateUpper: false, gateLower: false, vis: null,
    };
  }

  const nose = landmarks[LM.NOSE];
  if (!landmarkConfident(nose, visMin, margin, null)) {
    return {
      ready: false, message: MSG_HEAD, kind: 'head',
      gateHead: false, gateUpper: true, gateLower: true, vis: null,
    };
  }

  const vis = pickVisibleSide(landmarks);
  if (!vis) {
    return {
      ready: false, message: MSG_POOR_DETECTION, kind: 'poor_detection',
      gateHead: true, gateUpper: false, gateLower: false, vis: null,
    };
  }

  const chain = [vis.shoulder, vis.hip, vis.knee, vis.ankle];
  for (const lm of chain) {
    const isLower = lm === vis.ankle || lm === vis.knee;
    if (!landmarkConfident(lm, visMin * 0.5, margin, isLower ? bottom : null)) {
      const msg = isLower ? MSG_FEET : MSG_LEGS;
      const kind = isLower ? 'feet' : 'legs';
      return {
        ready: false, message: msg, kind,
        gateHead: true, gateUpper: !isLower, gateLower: isLower, vis,
      };
    }
  }

  const [boxOk, boxMsg, boxKind] = sideBodyFitsGuideBox(landmarks, vis, w, h);
  if (!boxOk) {
    return {
      ready: false, message: boxMsg, kind: boxKind,
      gateHead: true, gateUpper: true, gateLower: true, vis,
    };
  }

  return {
    ready: true, message: '', kind: 'ok',
    gateHead: true, gateUpper: true, gateLower: true, vis,
  };
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
