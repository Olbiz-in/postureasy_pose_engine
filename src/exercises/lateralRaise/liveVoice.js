// Live mistake voice for lateral raise — pure, easy to unit-test.
//
// Rep count is spoken separately at the PEAK. This module only picks a single
// post-rep cue (or praise) after the rep is finalized on the way down.

import { LR_LIVE_VOICE } from './config.js';

function emptyEntry() {
  return { streak: 0, cooldownRepsLeft: 0 };
}

/** Fresh per-session voice state (do not reset between sets). */
export function createLiveVoiceState(cfg = LR_LIVE_VOICE) {
  const byKey = {};
  for (const key of cfg.PRIORITY) byKey[key] = emptyEntry();
  return {
    byKey,
    perfectSincePraise: 0,
    lastSpokenKey: null,
  };
}

function cloneState(state) {
  const byKey = {};
  for (const [k, v] of Object.entries(state.byKey || {})) {
    byKey[k] = { streak: v.streak || 0, cooldownRepsLeft: v.cooldownRepsLeft || 0 };
  }
  return {
    byKey,
    perfectSincePraise: state.perfectSincePraise || 0,
    lastSpokenKey: state.lastSpokenKey ?? null,
  };
}

function isSpeakable(key, cfg) {
  return cfg.PRIORITY.includes(key) && !cfg.NEVER_SPEAK.includes(key);
}

/**
 * Step 1–2 of the per-rep algorithm: update streaks, then (after selection)
 * callers decrement cooldowns. Exported for peak-cancel flows that need
 * streak updates without committing a spoken cue.
 */
export function advanceLiveVoiceStreaks(repMistakes, state, cfg = LR_LIVE_VOICE) {
  const next = cloneState(state);
  const made = new Set((repMistakes || []).filter((k) => isSpeakable(k, cfg)));
  for (const key of cfg.PRIORITY) {
    if (!next.byKey[key]) next.byKey[key] = emptyEntry();
    if (made.has(key)) next.byKey[key].streak += 1;
    else next.byKey[key].streak = 0;
  }
  return next;
}

/** Highest-priority eligible cue key, or null. */
export function pickLiveVoiceCue(state, cfg = LR_LIVE_VOICE) {
  const need = cfg.REQUIRED_CONSECUTIVE;
  for (const key of cfg.PRIORITY) {
    const e = state.byKey?.[key];
    if (!e) continue;
    if (e.streak >= need && (e.cooldownRepsLeft || 0) === 0) return key;
  }
  return null;
}

/** After a cue actually starts playing — set cooldown, clear streak. */
export function markLiveVoiceSpoken(state, key, cfg = LR_LIVE_VOICE) {
  const next = cloneState(state);
  if (!key || !next.byKey[key]) return next;
  next.byKey[key].cooldownRepsLeft = cfg.COOLDOWN_REPS;
  next.byKey[key].streak = 0;
  next.lastSpokenKey = key;
  return next;
}

/**
 * Decrement cooldowns after eligibility is resolved for this rep
 * (check-then-decrement → spoken on N blocks N+1..N+3, free again on N+4).
 * Pass skipKeys for cues marked spoken this same turn so they keep a full
 * COOLDOWN_REPS before the first decrement.
 */
export function decrementLiveVoiceCooldowns(state, { skipKeys = [] } = {}) {
  const skip = new Set(skipKeys);
  const next = cloneState(state);
  for (const key of Object.keys(next.byKey)) {
    if (skip.has(key)) continue;
    if (next.byKey[key].cooldownRepsLeft > 0) next.byKey[key].cooldownRepsLeft -= 1;
  }
  return next;
}

function pickPraise(repMistakes, state, cfg) {
  if (!cfg.PRAISE_ENABLED) return { praise: null, perfectSincePraise: state.perfectSincePraise || 0 };
  const perfect = !repMistakes || repMistakes.length === 0;
  if (!perfect) return { praise: null, perfectSincePraise: 0 };
  const n = (state.perfectSincePraise || 0) + 1;
  const every = Math.max(1, cfg.PRAISE_EVERY_PERFECT || 3);
  if (n >= every) return { praise: cfg.PRAISE_TEXT, perfectSincePraise: 0 };
  return { praise: null, perfectSincePraise: n };
}

/**
 * Pure per-rep voice decision.
 * @param {string[]} repMistakes  mistakesMade for the finished rep
 * @param {object} state          from createLiveVoiceState()
 * @param {object} [cfg]
 * @returns {{ cue: string|null, cueKey: string|null, praise: string|null, newState: object }}
 *
 * `newState` already includes spoken cooldown when `cue` is set. If the flow
 * drops the cue (next rep peak wins), keep streaks via advanceLiveVoiceStreaks
 * + decrement only — do not use this newState; call getVoiceCueCommit separately
 * only when the cue utterance actually starts.
 */
export function getVoiceCue(repMistakes, state, cfg = LR_LIVE_VOICE) {
  let next = advanceLiveVoiceStreaks(repMistakes, state, cfg);
  const cueKey = pickLiveVoiceCue(next, cfg);
  let cue = null;
  if (cueKey) {
    cue = cfg.CUE_TEXT[cueKey] || null;
    next = markLiveVoiceSpoken(next, cueKey, cfg);
  }
  const { praise, perfectSincePraise } = pickPraise(repMistakes, next, cfg);
  // Praise only when no mistake cue this rep.
  const praiseOut = cue ? null : praise;
  next = { ...next, perfectSincePraise: cue ? 0 : perfectSincePraise };
  next = decrementLiveVoiceCooldowns(next, { skipKeys: cueKey ? [cueKey] : [] });
  return { cue, cueKey: cueKey || null, praise: praiseOut, newState: next };
}

/**
 * Apply streak/cooldown tick without committing a spoken cue (cue was dropped
 * or none). Still advances streaks + decrements cooldowns.
 */
export function tickLiveVoiceWithoutSpeak(repMistakes, state, cfg = LR_LIVE_VOICE) {
  let next = advanceLiveVoiceStreaks(repMistakes, state, cfg);
  const { perfectSincePraise } = pickPraise(repMistakes, next, cfg);
  next = { ...next, perfectSincePraise };
  next = decrementLiveVoiceCooldowns(next);
  return next;
}
