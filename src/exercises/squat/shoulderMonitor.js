// ─── shoulderMonitor.js ────────────────────────────────────────────────────────
// Shoulder-level (uneven shoulders) tracking during squat reps — uses
// checkShoulderLevel (poseLogic). Voice only after rep, same pattern as
// kneeMonitor.js / torsoMonitor.js.

import { CFG, nowSec } from './config.js';
import { checkShoulderLevel } from './poseLogic';

export const SHOULDER_LEVEL_DEFAULTS = {
  shoulder_level_sustain_sec: 1.0,
};

for (const [k, v] of Object.entries(SHOULDER_LEVEL_DEFAULTS)) {
  if (CFG[k] == null) CFG[k] = v;
}

export const SHOULDER_LEVEL_MSG = {
  shoulder_high_left:  'Your left shoulder is too high. Level your shoulders.',
  shoulder_high_right: 'Your right shoulder is too high. Level your shoulders.',
};

/** Which shoulder (if any) is currently too high, per checkShoulderLevel. */
function shoulderLevelIssue(landmarks) {
  const result = checkShoulderLevel(landmarks);
  const cues = result[8] || [];
  if (cues.includes('shoulder_high_left')) return 'shoulder_high_left';
  if (cues.includes('shoulder_high_right')) return 'shoulder_high_right';
  return null;
}

// ── Per-rep monitor ───────────────────────────────────────────────────────────

export class ShoulderLevelRepMonitor {
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
    const sustain = CFG.shoulder_level_sustain_sec;
    const issue = shoulderLevelIssue(landmarks);

    if (!issue) {
      this._onsetT = -1;
      this._onsetKey = null;
      return;
    }

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
    return key ? (SHOULDER_LEVEL_MSG[key] || null) : null;
  }

  onRepCancelled() {
    this.resetAll();
  }
}
