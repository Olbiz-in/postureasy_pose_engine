import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createLiveVoiceState,
  getVoiceCue,
  tickLiveVoiceWithoutSpeak,
} from '../src/exercises/lateralRaise/liveVoice.js';
import { LR_LIVE_VOICE, LR_CFG, resetLateralRaiseCfg } from '../src/exercises/lateralRaise/config.js';
import { LateralRaiseRepTracker } from '../src/exercises/lateralRaise/LateralRaiseRepTracker.js';

const FPS = 30;
const REST_E = 0.95;
const REST_W = 1.7;
const CALIB = { tilt0: 0, restElbow: { left: REST_E, right: REST_E }, restWrist: { left: REST_W, right: REST_W } };

function lift(t) {
  if (t <= 0) return 0;
  if (t < 1) return t;
  if (t < 1.4) return 1;
  if (t < 2.4) return 2.4 - t;
  return 0;
}

function arm(side, f) {
  return { side, ok: true, elbowDy: REST_E * (1 - f), wristDy: REST_W * (1 - f) };
}

function runFrames(tr, t0, durationSec, { rightScale = 1, lag = 0, peakScale = 1 } = {}) {
  const events = [];
  let attempt = null;
  for (let i = 0; i <= durationSec * FPS; i += 1) {
    const t = i / FPS;
    const lf = lift(t) * peakScale;
    const rf = lift(t - lag) * rightScale * peakScale;
    const g = {
      left: arm('left', lf),
      right: arm('right', rf),
      tilt: 0,
    };
    const r = tr.update(g, CALIB, t0 + t);
    if (r.peakCounted) events.push({ type: 'peak', at: t0 + t, ...r.peakCounted });
    if (r.attempt) {
      attempt = r.attempt;
      events.push({ type: 'final', at: t0 + t, attempt });
    }
  }
  return { events, attempt, endAt: t0 + durationSec };
}

beforeEach(() => resetLateralRaiseCfg());

describe('getVoiceCue selection', () => {
  test('1. mistake in only one rep then absent → no cue (streak reset)', () => {
    let state = createLiveVoiceState();
    let r = getVoiceCue(['lr_elbow_too_high'], state);
    assert.equal(r.cue, null);
    state = r.newState;
    r = getVoiceCue([], state);
    assert.equal(r.cue, null);
    assert.equal(r.newState.byKey.lr_elbow_too_high.streak, 0);
  });

  test('2. elbow_too_high on reps 1–2 → cue on 2; blocked 3–5; eligible again from 6', () => {
    let state = createLiveVoiceState();
    let r = getVoiceCue(['lr_elbow_too_high'], state);
    assert.equal(r.cue, null);
    state = r.newState;

    r = getVoiceCue(['lr_elbow_too_high'], state);
    assert.equal(r.cueKey, 'lr_elbow_too_high');
    assert.equal(r.cue, LR_LIVE_VOICE.CUE_TEXT.lr_elbow_too_high);
    state = r.newState;
    assert.equal(state.byKey.lr_elbow_too_high.streak, 0);

    for (const rep of [3, 4, 5]) {
      r = getVoiceCue(['lr_elbow_too_high'], state);
      assert.equal(r.cue, null, `no cue on rep ${rep}`);
      state = r.newState;
    }

    // Rep 6: cooldown cleared after check-then-decrement on 3–5; need streak 2 again.
    // After rep 5, streak is building during cooldown. By rep 6 streak should be high.
    r = getVoiceCue(['lr_elbow_too_high'], state);
    assert.equal(r.cueKey, 'lr_elbow_too_high');
  });

  test('3. elbow + asymmetry both eligible → only elbow spoken; asymmetry later', () => {
    let state = createLiveVoiceState();
    // Build streak 2 for both
    state = getVoiceCue(['lr_elbow_too_high', 'lr_asymmetry'], state).newState;
    let r = getVoiceCue(['lr_elbow_too_high', 'lr_asymmetry'], state);
    assert.equal(r.cueKey, 'lr_elbow_too_high');
    state = r.newState;
    // Elbow on cooldown; asymmetry still has streak — keep it present through cooldown
    for (let i = 0; i < 3; i += 1) {
      r = getVoiceCue(['lr_asymmetry'], state);
      // May or may not speak on first eligible after elbow cooldown path
      state = r.newState;
      if (r.cueKey === 'lr_asymmetry') break;
    }
    // Ensure asymmetry eventually speaks (or already did)
    if (r.cueKey !== 'lr_asymmetry') {
      r = getVoiceCue(['lr_asymmetry'], state);
    }
    assert.equal(r.cueKey, 'lr_asymmetry');
  });

  test('4. lr_incomplete alone is never spoken', () => {
    let state = createLiveVoiceState();
    state = getVoiceCue(['lr_incomplete'], state).newState;
    const r = getVoiceCue(['lr_incomplete'], state);
    assert.equal(r.cue, null);
    assert.equal(r.cueKey, null);
  });

  test('4b. wrist_too_high twice in a row is spoken', () => {
    let state = createLiveVoiceState();
    state = getVoiceCue(['lr_wrist_too_high'], state).newState;
    const r = getVoiceCue(['lr_wrist_too_high'], state);
    assert.equal(r.cueKey, 'lr_wrist_too_high');
    assert.equal(r.cue, 'Lower your wrists');
  });

  test('5. perfect rep → no cue; praise only every N perfects', () => {
    let state = createLiveVoiceState();
    let r = getVoiceCue([], state);
    assert.equal(r.cue, null);
    assert.equal(r.praise, null); // 1st perfect
    state = r.newState;
    r = getVoiceCue([], state);
    assert.equal(r.praise, null); // 2nd
    state = r.newState;
    r = getVoiceCue([], state);
    assert.equal(r.praise, LR_LIVE_VOICE.PRAISE_TEXT); // 3rd
    assert.ok(r.praise);
  });

  test('tick without speak keeps streak when cue is dropped', () => {
    let state = createLiveVoiceState();
    state = getVoiceCue(['lr_not_high_enough'], state).newState;
    state = tickLiveVoiceWithoutSpeak(['lr_not_high_enough'], state);
    assert.ok(state.byKey.lr_not_high_enough.streak >= 1);
    assert.equal(state.byKey.lr_not_high_enough.cooldownRepsLeft, 0);
  });
});

describe('peak announce + finalize', () => {
  test('raise past threshold → peak event before final; one count', () => {
    const tr = new LateralRaiseRepTracker();
    const { events, attempt } = runFrames(tr, 0, 3.5);
    const peaks = events.filter((e) => e.type === 'peak');
    const finals = events.filter((e) => e.type === 'final');
    assert.equal(peaks.length, 1);
    assert.equal(finals.length, 1);
    assert.ok(peaks[0].at < finals[0].at, 'Rep N at peak, before arms-down finalize');
    assert.equal(attempt.index, 1);
    assert.equal(tr.count, 1);
  });

  test('jitter around threshold does not double-count (lock until reset)', () => {
    const tr = new LateralRaiseRepTracker();
    // Reach peak and wobble near the top without fully resetting.
    let t = 0;
    let peaks = 0;
    for (let i = 0; i < 90; i += 1) {
      t = i / FPS;
      const f = t < 1 ? t : 0.92 + 0.08 * Math.sin(i); // stay high
      const g = { left: arm('left', f), right: arm('right', f), tilt: 0 };
      const r = tr.update(g, CALIB, t);
      if (r.peakCounted) peaks += 1;
    }
    assert.equal(peaks, 1);
    assert.equal(tr.count, 1);
  });

  test('raise below count_min_lift → no count, no peak', () => {
    const tr = new LateralRaiseRepTracker();
    // 0.35 clears lift_start (0.25) but stays under count_min_lift (0.55).
    const { events, attempt } = runFrames(tr, 0, 3.5, { peakScale: 0.35 });
    assert.equal(events.filter((e) => e.type === 'peak').length, 0);
    assert.equal(attempt, null);
    assert.equal(tr.count, 0);
  });

  test('partial raise past count line → counts + lr_not_high_enough', () => {
    const tr = new LateralRaiseRepTracker();
    // 0.70 ≥ count_min_lift (0.55) but below full band (~0.90 lift).
    const { events, attempt } = runFrames(tr, 0, 3.5, { peakScale: 0.7 });
    assert.equal(events.filter((e) => e.type === 'peak').length, 1);
    assert.ok(attempt);
    assert.equal(tr.count, 1);
    assert.equal(attempt.clean, false);
    assert.ok(attempt.issues.includes('lr_not_high_enough'));
    assert.equal(attempt.fullRom, false);
  });

  test('finalizeOpenRep after peak without lowering still records the rep', () => {
    const tr = new LateralRaiseRepTracker();
    // Go up to peak only
    for (let i = 0; i <= 1.2 * FPS; i += 1) {
      const t = i / FPS;
      const f = Math.min(1, t);
      tr.update({ left: arm('left', f), right: arm('right', f), tilt: 0 }, CALIB, t);
    }
    assert.equal(tr.count, 1);
    assert.ok(tr.hasOpenRep);
    const attempt = tr.finalizeOpenRep(CALIB, 2);
    assert.ok(attempt);
    assert.equal(attempt.index, 1);
    assert.equal(tr.hasOpenRep, false);
  });
});
