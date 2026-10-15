import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { DumbbellCurlRepTracker, summarizeDumbbellCurl } from '../src/exercises/dumbbellCurl/DumbbellCurlRepTracker.js';
import { DC_CFG, resetDumbbellCurlCfg } from '../src/exercises/dumbbellCurl/config.js';

const FPS = 30;
const REST = 1.05;
const T = 100;
const SW = 80;
const CALIB = {
  sw: SW,
  torso: T,
  tilt0: 0,
  restSpan: { left: REST, right: REST },
  restElbow: { left: 0.6, right: 0.6 },
  restElbowOut: { left: 0, right: 0 },
};

// Curl progress over one rep: up 1 s, squeeze 0.4 s, down 1 s.
function curl(t) {
  if (t <= 0) return 0;
  if (t < 1) return t;
  if (t < 1.4) return 1;
  if (t < 2.4) return 2.4 - t;
  return 0;
}

function arm(side, p) {
  const out = side === 'left' ? 1 : -1;
  const shoulder = { x: 200 + out * SW / 2, y: 100 };
  const span = REST - p * (REST - DC_CFG.top_line_offset);
  return {
    side,
    ok: true,
    shoulder,
    elbow: { x: shoulder.x, y: 160 },
    wrist: { x: shoulder.x, y: 100 + span * T },
    hip: { x: shoulder.x, y: 200 },
    lineY: 100,
    span,
    elbowDy: 0.6,
    elbowOut: 0,
  };
}

function geometry(pL, pR) {
  return {
    norm: SW,
    T,
    shMid: { x: 200, y: 100 },
    torsoDist: T,
    vertTorso: T,
    tilt: 0,
    left: arm('left', pL),
    right: arm('right', pR),
  };
}

/** One both-arms rep; the right arm starts `lag` seconds after the left. */
function runRep(tr, t0, { lag = 0 } = {}) {
  const live = new Set();
  const attempts = [];
  const end = 2.4 + lag + 1.5;
  for (let i = 0; i <= end * FPS; i += 1) {
    const t = i / FPS;
    const r = tr.update(geometry(curl(t), curl(t - lag)), CALIB, t0 + t);
    r.liveKeys.forEach((k) => live.add(k));
    attempts.push(...r.attempts);
  }
  return { attempt: attempts[attempts.length - 1], live, endAt: t0 + end };
}

function settle(tr, t0) {
  for (let i = 0; i <= 0.5 * FPS; i += 1) tr.update(geometry(0, 0), CALIB, t0 + i / FPS);
  return t0 + 0.5;
}

beforeEach(() => resetDumbbellCurlCfg());

describe('dumbbell curl arm symmetry', () => {
  test('both arms together → clean, no dc_arms_uneven', () => {
    const tr = new DumbbellCurlRepTracker();
    const { attempt, live } = runRep(tr, settle(tr, 0));
    assert.ok(attempt?.counted);
    assert.ok(!live.has('dc_arms_uneven'));
    assert.ok(!attempt.issues.includes('dc_arms_uneven'));
    assert.equal(attempt.clean, true);
  });

  test('left arm first, right arm clearly late → dc_arms_uneven (live and at rep end)', () => {
    DC_CFG.pair_window_sec = 1.0;
    const tr = new DumbbellCurlRepTracker();
    const { attempt, live } = runRep(tr, settle(tr, 0), { lag: 0.5 });
    assert.ok(attempt?.counted);
    assert.ok(live.has('dc_arms_uneven'));
    assert.ok(attempt.issues.includes('dc_arms_uneven'));
    assert.ok(attempt.armGap > DC_CFG.arm_sync_tolerance);
    assert.equal(attempt.clean, false);
    assert.ok(attempt.symmetryPct < 100);
  });

  test('a small natural lag (0.1 s) stays within tolerance', () => {
    const tr = new DumbbellCurlRepTracker();
    const { attempt, live } = runRep(tr, settle(tr, 0), { lag: 0.1 });
    assert.ok(!live.has('dc_arms_uneven'));
    assert.ok(!attempt.issues.includes('dc_arms_uneven'));
    assert.equal(attempt.clean, true);
  });

  test('a wider tolerance accepts the same lag', () => {
    DC_CFG.pair_window_sec = 1.0;
    DC_CFG.arm_sync_tolerance = 0.55;
    const tr = new DumbbellCurlRepTracker();
    const { attempt } = runRep(tr, settle(tr, 0), { lag: 0.5 });
    assert.ok(!attempt.issues.includes('dc_arms_uneven'));
  });

  test('alternate mode never flags dc_arms_uneven', () => {
    DC_CFG.curl_mode = 'alternate';
    const tr = new DumbbellCurlRepTracker();
    const { live } = runRep(tr, settle(tr, 0), { lag: 1.5 });
    assert.ok(!live.has('dc_arms_uneven'));
    assert.ok(tr.attempts.every((a) => !a.issues.includes('dc_arms_uneven')));
  });

  test('summary counts uneven reps', () => {
    DC_CFG.pair_window_sec = 1.0;
    const tr = new DumbbellCurlRepTracker();
    let t = settle(tr, 0);
    t = settle(tr, runRep(tr, t).endAt);
    runRep(tr, t, { lag: 0.5 });
    const s = summarizeDumbbellCurl(tr.attempts);
    assert.equal(s.mistakes.armsUneven, 1);
    assert.equal(s.cleanReps, 1);
  });
});
