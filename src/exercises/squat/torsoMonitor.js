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

/** True when vertical-gap check flags excessive forward lean (not side drift). */
export function isTorsoForwardBendFrame(landmarks) {
  const result = checkTorsoFrontVertical(landmarks);
  const cueKeys = result[9] || [];
  return cueKeys.includes('torso_bend');
}

// ── Per-rep monitor ───────────────────────────────────────────────────────────

export class TorsoBendRepMonitor {
  constructor() {
    this.resetAll();
  }

  resetAll() {
    this._bendOnsetT = -1;
    this._qualified = false;
    this._inRep = false;
  }

  onRepStart() {
    this._bendOnsetT = -1;
    this._qualified = false;
    this._inRep = true;
  }

  updateFrame(landmarks) {
    if (!this._inRep) return;

    const now = nowSec();
    const sustain = CFG.torso_bend_sustain_sec;

    if (!isTorsoForwardBendFrame(landmarks)) {
      this._bendOnsetT = -1;
      return;
    }

    if (this._bendOnsetT < 0) this._bendOnsetT = now;
    if (now - this._bendOnsetT >= sustain) {
      this._qualified = true;
    }
  }

  consumeEndOfRepFeedback() {
    const msg = this._qualified ? TORSO_FORWARD_BEND_MSG : null;
    this.resetAll();
    return msg;
  }

  onRepCancelled() {
    this.resetAll();
  }
}
