import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { configureVoiceManager } from '../src/core/voiceManager.js';
import { LegRaiseFlow, LGR_PHASE } from '../src/exercises/legRaise/LegRaiseFlow.js';
import { LGR_FEEDBACK, LGR_VOICE_MSG, resetLegRaiseCfg } from '../src/exercises/legRaise/config.js';
import { Driver, makePose, repProfile, W, H, FPS } from './support/legRaisePose.js';

// Fake TTS: record everything that would be spoken.
const spoken = [];
configureVoiceManager({
  adapterFactory: () => ({
    isAvailable: () => true,
    isSpeaking: () => false,
    speak(text, { onEnd } = {}) { spoken.push(text); onEnd?.(); return true; },
    cancel() {},
  }),
});

const CORRECTIONS = new Set(Object.entries(LGR_VOICE_MSG)
  .filter(([k]) => /^lgr_(not_|too_|knees|hips)/.test(k)).map(([, v]) => v));
const corrections = () => spoken.filter((t) => CORRECTIONS.has(t));

function setup() {
  const flow = new LegRaiseFlow({ voice: true });
  const d = new Driver(flow);
  assert.equal(d.calibrate(), LGR_PHASE.ACTIVE, 'calibration should finish on a valid lying pose');
  return { flow, d };
}

beforeEach(() => {
  spoken.length = 0;
  resetLegRaiseCfg();
});

describe('registry', async () => {
  const reg = await import('../src/core/registry.js');
  await import('../src/exercises/index.js');

  test('leg raise resolves to the side tracker; other leg raises stay unsupported', () => {
    assert.equal(reg.resolveExerciseId('Leg Raise'), 'leg-raise-side');
    assert.equal(reg.resolveExerciseId('Lying Leg Raises'), 'leg-raise-side');
    assert.equal(reg.resolveExerciseId('Leg Raise', 'side'), 'leg-raise-side');
    assert.deepEqual(reg.availableViews('Leg Raise'), ['side']);
    assert.equal(reg.resolveExerciseId('Hanging Leg Raise'), null);
    assert.equal(reg.resolveExerciseId('Side Leg Raise'), null);
    assert.equal(reg.resolveExerciseId('Lateral Raise'), 'lateralraise');
  });

  test('tracker honours the ExerciseState contract', () => {
    const tracker = reg.getExercise('leg-raise-side').create({ voice: false });
    let t = 1000;
    let state;
    for (let i = 0; i < 90; i += 1) {
      state = tracker.update(makePose({ theta: 0 }), { width: W, height: H, timestamp: (t += 1000 / FPS) });
    }
    for (const key of ['repCount', 'phase', 'progress', 'formScore', 'ready', 'cues', 'feedback']) {
      assert.ok(key in state, `state.${key}`);
    }
    assert.equal(state.ready, true);
  });
});

describe('setup', () => {
  test('refuses to calibrate while the legs are raised, then passes once they rest', () => {
    const flow = new LegRaiseFlow({ voice: true });
    const d = new Driver(flow);
    for (let i = 0; i < 3 * FPS; i += 1) d.tick(makePose({ theta: 80 }));
    assert.equal(flow.phase, LGR_PHASE.SETUP);
    assert.equal(d.last.stanceResult.primaryKey, 'lgr_legs_not_down');
    assert.equal(d.calibrate(), LGR_PHASE.ACTIVE);
  });
});

describe('counting', () => {
  test('counts 90° → 45° reps, including the last one that ends in a hold', () => {
    const { flow, d } = setup();
    d.play(repProfile({ reps: 4 }));
    assert.equal(flow.repTracker.count, 4);
    for (const a of flow.repTracker.attempts) {
      assert.deepEqual(a.issues, [], `rep ${a.index} should be clean`);
      assert.ok(a.peakDeg >= 85 && a.peakDeg <= 95, `peak ${a.peakDeg}`);
      assert.ok(a.valleyDeg >= 40 && a.valleyDeg <= 50, `valley ${a.valleyDeg}`);
    }
    assert.equal(corrections().length, 0);
    assert.deepEqual(spoken.filter((t) => /^Rep /.test(t)), ['Rep 1', 'Rep 2', 'Rep 3', 'Rep 4']);
  });

  test('a shallow lift that never reaches the minimum angle is not counted', () => {
    const { flow, d } = setup();
    d.play(repProfile({ reps: 3, peak: 62, valley: 30 }));
    assert.equal(flow.repTracker.count, 0);
  });
});

describe('repeat-gated mistakes', () => {
  test('a first-time mistake is neither shown nor spoken', () => {
    const { flow, d } = setup();
    const overlays = [];
    // One rep that peaks at 75° (not high enough), then clean reps.
    d.play(repProfile({ reps: 1, peak: 75 }), undefined, (fr) => overlays.push(fr.mistake, fr.boneColor));
    assert.equal(flow.repTracker.count, 1);
    assert.deepEqual(flow.repTracker.lastRep.issues, ['lgr_not_high_enough']);
    assert.equal(corrections().length, 0, 'no voice on the first occurrence');
    assert.ok(overlays.every((v) => v === '' || v === 'rgb(0,255,0)'), 'no mistake text / red skeleton yet');
  });

  test('the same mistake in two consecutive reps is shown and spoken', () => {
    const { flow, d } = setup();
    const shown = [];
    d.play(repProfile({ reps: 3, peak: 75 }), undefined, (fr) => { if (fr.mistake) shown.push(fr.mistake); });
    assert.equal(flow.repTracker.count, 3);
    assert.ok(shown.length > 0, 'mistake text appears once repeated');
    assert.ok(shown.every((t) => t === LGR_FEEDBACK.lgr_not_high_enough));
    assert.ok(corrections().includes(LGR_VOICE_MSG.lgr_not_high_enough));
    // Spoken once per rep at most — never spammed.
    assert.ok(corrections().length <= 2, `spoke ${corrections().length} corrections`);
  });

  test('a mistake that does not repeat goes quiet again', () => {
    const { flow, d } = setup();
    d.play(repProfile({ reps: 1, peak: 75 }));
    d.play(repProfile({ reps: 2 }));
    d.play(repProfile({ reps: 1, peak: 75 }));
    assert.equal(corrections().length, 0);
    assert.ok(flow.repTracker.count >= 3);
  });
});

describe('form rules', () => {
  const twice = (opts, extra) => {
    const { flow, d } = setup();
    d.play(repProfile({ reps: 3, ...opts }), extra);
    return { flow, spokenFix: corrections() };
  };

  test('not lowering to ~45° is flagged', () => {
    const { flow, spokenFix } = twice({ valley: 70 });
    assert.ok(flow.repTracker.attempts.every((a) => a.issues.includes('lgr_not_lowering')));
    assert.ok(spokenFix.includes(LGR_VOICE_MSG.lgr_not_lowering));
  });

  test('dropping the legs below 45° toward the floor is flagged', () => {
    const { flow, spokenFix } = twice({ valley: 15 });
    assert.ok(flow.repTracker.attempts.some((a) => a.issues.includes('lgr_too_low')));
    assert.ok(spokenFix.includes(LGR_VOICE_MSG.lgr_too_low));
  });

  test('bent knees are flagged', () => {
    const { flow, spokenFix } = twice({}, (t, theta) => ({ kneeBend: theta > 20 ? 45 : 0 }));
    assert.ok(flow.repTracker.attempts.every((a) => a.issues.includes('lgr_knees_bent')));
    assert.ok(spokenFix.includes(LGR_VOICE_MSG.lgr_knees_bent));
  });

  test('hips lifting off the floor is flagged', () => {
    const { flow, spokenFix } = twice({}, (t, theta) => ({ hipLift: theta > 60 ? 28 : 0 }));
    assert.ok(flow.repTracker.attempts.some((a) => a.issues.includes('lgr_hips_lifting')));
    assert.ok(spokenFix.includes(LGR_VOICE_MSG.lgr_hips_lifting));
  });

  test('swinging the legs too fast is flagged', () => {
    const { flow } = twice({ stroke: 0.6 });
    assert.ok(flow.repTracker.attempts.slice(1).every((a) => a.issues.includes('lgr_too_fast')));
  });
});

