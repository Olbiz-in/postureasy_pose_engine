// Side-view forward torso lean during squat reps — same sustain timing as front
// TorsoBendRepMonitor, using profile lean angle instead of front vGap ratio.

import { CFG, nowSec } from '../squat/config.js';
import { TORSO_FORWARD_BEND_MSG } from '../squat/torsoMonitor.js';
import { pickVisibleSide, checkTorsoLeanSide } from './SideSquatRepTracker.js';

export function isSideTorsoForwardBendFrame(landmarks) {
  const vis = pickVisibleSide(landmarks);
  if (!vis) return false;
  const torso = checkTorsoLeanSide(vis, true);
  return !torso.ok;
}

export class TorsoBendSideRepMonitor {
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
    const sustain = CFG.torso_bend_sustain_sec ?? 1.0;

    if (!isSideTorsoForwardBendFrame(landmarks)) {
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
