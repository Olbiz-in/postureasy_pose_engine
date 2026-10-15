import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { LateralRaiseRepTracker, summarizeLateralRaise } from '../src/exercises/lateralRaise/LateralRaiseRepTracker.js';
import { LR_CFG, resetLateralRaiseCfg } from '../src/exercises/lateralRaise/config.js';
import { armLevelDiff } from '../src/exercises/lateralRaise/poseChecks.js';

const FPS = 30;
const REST_E = 0.95;
const REST_W = 1.7;
const CALIB = { tilt0: 0, restElbow: { left: REST_E, right: REST_E }, restWrist: { left: REST_W, right: REST_W } };

// Lift fraction over one rep: up 1 s, hold 0.4 s at the top, down 1 s.
function lift(t) {
  if (t <= 0) return 0;
  if (t < 1) return t;
  if (t < 1.4) return 1;
  if (t < 2.4) return 2.4 - t;
  return 0;
}

// Fraction 1 puts elbow and wrist exactly on the shoulder line (inside the band).
function arm(side, f) {
  return { side, ok: true, elbowDy: REST_E * (1 - f), wristDy: REST_W * (1 - f) };
}

/**
 * Run one rep. `right` maps the left arm's lift fraction / time to the right's.
 * @returns {{ attempt: object, live: Set<string> }}
 */
function runRep(tr, t0, { lag = 0, rightScale = 1 } = {}) {
  const live = new Set();
  let attempt = null;
  const end = 2.4 + Math.max(lag, 0) + 1.5;
  for (let i = 0; i <= end * FPS; i += 1) {
    const t = i / FPS;
    const g = {
      left: arm('left', lift(t)),
      right: arm('right', lift(t - lag) * rightScale),
      tilt: 0,
    };
    const r = tr.update(g, CALIB, t0 + t);
    r.liveKeys.forEach((k) => live.add(k));
    if (r.attempt) attempt = r.attempt;
  }
  return { attempt, live, endAt: t0 + end };
}

beforeEach(() => resetLateralRaiseCfg());

describe('lateral raise symmetry', () => {
  test('both arms together and level → clean, full symmetry', () => {
    const { attempt, live } = runRep(new LateralRaiseRepTracker(), 0);
    assert.ok(attempt, 'rep should be counted');
    assert.deepEqual(attempt.issues, []);
    assert.equal(attempt.clean, true);
    assert.equal(attempt.symmetryPct, 100);
    assert.equal(live.size, 0);
  });

  test('one arm clearly lower than the other → lr_asymmetry (live and at rep end)', () => {
    const { attempt, live } = runRep(new LateralRaiseRepTracker(), 0, { rightScale: 0.75 });
    assert.ok(live.has('lr_asymmetry'));
    assert.ok(attempt.issues.includes('lr_asymmetry'));
    assert.ok(attempt.symmetryPct < 100);
    assert.equal(attempt.clean, false);
  });

  test('wrists uneven while elbows stay within tolerance → still lr_asymmetry', () => {
    const tr = new LateralRaiseRepTracker();
    let attempt = null;
    const live = new Set();
    for (let i = 0; i <= 4 * FPS; i += 1) {
      const t = i / FPS;
      const f = lift(t);
      const right = arm('right', f);
      right.wristDy += 0.35 * f; // right wrist droops at the top, elbow level
      const r = tr.update({ left: arm('left', f), right, tilt: 0 }, CALIB, t);
      r.liveKeys.forEach((k) => live.add(k));
      if (r.attempt) attempt = r.attempt;
    }
    assert.ok(live.has('lr_asymmetry'));
    assert.ok(attempt.issues.includes('lr_asymmetry'));
  });

  test('one arm starting ~1 s late → lr_arms_out_of_sync', () => {
    const { attempt, live } = runRep(new LateralRaiseRepTracker(), 0, { lag: 1.0 });
    assert.ok(live.has('lr_arms_out_of_sync'));
    assert.ok(attempt.issues.includes('lr_arms_out_of_sync'));
    assert.ok(attempt.syncLagSec > LR_CFG.sync_max_sec);
    assert.equal(attempt.clean, false);
  });

  test('a small natural lag (0.1 s) is tolerated', () => {
    const { attempt, live } = runRep(new LateralRaiseRepTracker(), 0, { lag: 0.1 });
    assert.ok(!live.has('lr_arms_out_of_sync'));
    assert.ok(!live.has('lr_asymmetry'));
    assert.ok(!attempt.issues.includes('lr_arms_out_of_sync'));
    assert.ok(!attempt.issues.includes('lr_asymmetry'));
    assert.equal(attempt.clean, true);
  });

  test('summary counts uneven and out-of-sync reps', () => {
    const tr = new LateralRaiseRepTracker();
    let t = 0;
    t = runRep(tr, t).endAt;
    t = runRep(tr, t, { rightScale: 0.75 }).endAt;
    runRep(tr, t, { lag: 1.0 });
    assert.equal(tr.attempts.length, 3);
    const s = summarizeLateralRaise(tr.attempts);
    assert.equal(s.mistakes.asymmetry >= 1, true);
    assert.equal(s.mistakes.outOfSync, 1);
    assert.equal(s.cleanReps, 1);
  });

  test('armLevelDiff reports the larger difference relative to its tolerance', () => {
    const g = {
      left: { ok: true, elbowDy: 0, wristDy: 0 },
      right: { ok: true, elbowDy: LR_CFG.symmetry_max / 2, wristDy: LR_CFG.symmetry_wrist_max * 2 },
    };
    const d = armLevelDiff(g);
    assert.equal(d.ratio, 2);
    assert.deepEqual(armLevelDiff({ left: { ok: false }, right: g.right }).ratio, null);
  });
});
