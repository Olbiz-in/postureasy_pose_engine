// ─── torsoAngleLogic.js ──────────────────────────────────────────────────────
// Forward torso bend during squat reps — uses checkTorsoFrontVertical (calibrated
// vGap ratio + smoothing in poseLogic). Voice only after rep via warningPriority.

import { CFG, nowSec } from './config.js';
import { checkTorsoFrontVertical } from './poseLogic';

export const TORSO_BEND_DEFAULTS = {
  torso_bend_sustain_sec: 1.0,
};

for (const [k, v] of Object.entries(TORSO_BEND_DEFAULTS)) {
  if (CFG[k] == null) CFG[k] = v;
}

export const TORSO_FORWARD_BEND_MSG =
  'You are bending too much forward. Stay straight during squat.';

// Horizontal drift: the whole upper body (chest/shoulders) shifted sideways
// relative to the hips, i.e. the torso is leaning/turned left or right —
// distinct from forward bend, but was previously detected and drawn
// (red-blink tolerance rail) yet never spoken. Direction is already
// mirror-corrected inside checkTorsoFrontVertical via cueForView().
export const TORSO_SIDE_LEAN_MSG = {
  torso_x_left:  'Your upper body is leaning to the left. Stay straight.',
  torso_x_right: 'Your upper body is leaning to the right. Stay straight.',
};

/** True when vertical-gap check flags excessive forward lean (not side drift). */
export function isTorsoForwardBendFrame(landmarks) {
  const result = checkTorsoFrontVertical(landmarks);
  const cueKeys = result[9] || [];
  return cueKeys.includes('torso_bend');
}

/**
 * Classifies the current frame's torso issue, if any.
 * Forward bend takes priority over side lean when both happen at once
 * (matches the existing knee > torso ordering style used elsewhere).
 */
function torsoIssueForFrame(landmarks) {
  const result = checkTorsoFrontVertical(landmarks);
  const cueKeys = result[9] || [];
  if (cueKeys.includes('torso_bend')) return 'torso_bend';
  if (cueKeys.includes('torso_x_left')) return 'torso_x_left';
  if (cueKeys.includes('torso_x_right')) return 'torso_x_right';
  return null;
}

// ── Per-rep monitor ───────────────────────────────────────────────────────────

export class TorsoBendRepMonitor {
  constructor() {
    this.resetAll();
  }

  resetAll() {
    this._onsetT = -1;
    this._onsetKey = null;
    this._qualifiedKey = null;
    this._inRep = false;
  }

  onRepStart() {
    this.resetAll();
    this._inRep = true;
  }

  updateFrame(landmarks) {
    if (!this._inRep) return;

    const now = nowSec();
    const sustain = CFG.torso_bend_sustain_sec;
    const issue = torsoIssueForFrame(landmarks);

    if (!issue) {
      this._onsetT = -1;
      this._onsetKey = null;
      return;
    }

    // Track sustain per-issue so a quick switch (e.g. bend -> side lean)
    // doesn't inherit the other issue's elapsed time.
    if (this._onsetKey !== issue) {
      this._onsetKey = issue;
      this._onsetT = now;
    }
    if (!this._qualifiedKey && now - this._onsetT >= sustain) {
      this._qualifiedKey = issue;
    }
  }

  consumeEndOfRepFeedback() {
    const key = this._qualifiedKey;
    this.resetAll();
    if (!key) return null;
    if (key === 'torso_bend') return TORSO_FORWARD_BEND_MSG;
    return TORSO_SIDE_LEAN_MSG[key] || null;
  }

  onRepCancelled() {
    this.resetAll();
  }
}
