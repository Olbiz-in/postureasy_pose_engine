import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { configureVoiceManager } from '../src/core/voiceManager.js';
import { LM } from '../src/core/landmarks.js';
import { LungeFlow, LUNGE_PHASE } from '../src/exercises/lunge/LungeFlow.js';
import { LUNGE_STATE } from '../src/exercises/lunge/LungeRepTracker.js';
import {
  LUNGE_CFG, LUNGE_FEEDBACK, LUNGE_COLOR_RED, resetLungeCfg,
} from '../src/exercises/lunge/config.js';
import { Driver, makePose, depthAt, noise, W, H, FPS } from './support/lungePose.js';

// ── Fake TTS: record everything that would be spoken ─────────────────────────
const spoken = [];
configureVoiceManager({
  adapterFactory: () => ({
    isAvailable: () => true,
    isSpeaking: () => false,
    speak(text, { onEnd } = {}) { spoken.push(text); onEnd?.(); return true; },
    cancel() {},
  }),
});

const CORRECTION = /^(Keep|Increase|Lower into|Maintain|Match)/;
const corrections = () => spoken.filter((t) => CORRECTION.test(t));

function setup(view) {
  const flow = new LungeFlow({ view, voice: true });
  const d = new Driver(flow, view);
  assert.equal(d.calibrate(), LUNGE_PHASE.ACTIVE, `${view}: calibration should finish on a valid standing pose`);
  return { flow, d };
}

const lastRep = (flow) => flow.repTracker.lastRep;

beforeEach(() => {
  spoken.length = 0;
  resetLungeCfg();
});

// ── Registry / integration ───────────────────────────────────────────────────
describe('registry', async () => {
  const reg = await import('../src/core/registry.js');
  await import('../src/exercises/index.js'); // registers every built-in exercise

  test('lunge aliases resolve and expose both views', () => {
    assert.equal(reg.resolveExerciseId('Lunge'), 'lunge');
    assert.equal(reg.resolveExerciseId('Lunges'), 'lunge');
    assert.equal(reg.resolveExerciseId('Dumbbell Reverse Lunges'), 'lunge');
    assert.equal(reg.resolveExerciseId('Lunge', 'side'), 'lunge-side');
    assert.equal(reg.resolveExerciseId('Lunge', 'front'), 'lunge');
    assert.deepEqual([...reg.availableViews('Lunge')].sort(), ['front', 'side']);
    assert.equal(reg.isSupported('lunges'), true);
  });

  test('moving lunge variants stay unsupported; existing exercises unchanged', () => {
    assert.equal(reg.resolveExerciseId('Walking Lunge'), null);
    assert.equal(reg.resolveExerciseId('Jumping Lunges'), null);
    assert.equal(reg.resolveExerciseId('Lateral Lunge'), null);
    assert.equal(reg.resolveExerciseId('walking lunges'), 'squat'); // pre-existing alias
    assert.equal(reg.resolveExerciseId('Squat'), 'squat');
    assert.equal(reg.resolveExerciseId('Squat', 'side'), 'squat-side');
    assert.equal(reg.resolveExerciseId('Push-ups'), 'pushup');
    assert.equal(reg.resolveExerciseId('Dumbbell Lateral Raise'), 'lateralraise');
    assert.equal(reg.resolveExerciseId('Front Raise'), 'frontraise');
  });

  test('tracker honours the ExerciseState contract and emits one repEvent per rep', () => {
    const tracker = reg.getExercise('lunge').create({ voice: false });
    let t = 1000;
    const frame = () => ({ width: W, height: H, timestamp: (t += 1000 / FPS) });
    let state;
    for (let i = 0; i < 90; i += 1) state = tracker.update(makePose({ view: 'front' }), frame());
    for (const key of ['repCount', 'phase', 'progress', 'formScore', 'ready', 'cues', 'feedback']) {
      assert.ok(key in state, `state.${key}`);
    }
    assert.equal(state.ready, true);

    const events = [];
    for (let i = 0; i <= 84; i += 1) {
      state = tracker.update(makePose({ view: 'front', depth: depthAt(i / FPS, 2.8, 0.36) }), frame());
      if (state.repEvent) events.push(state.repEvent);
    }
    for (let i = 0; i < 30; i += 1) {
      state = tracker.update(makePose({ view: 'front' }), frame());
      if (state.repEvent) events.push(state.repEvent);
    }
    assert.equal(state.repCount, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].index, 1);
    assert.ok(events[0].score >= 90 && events[0].romPct >= 85);
    assert.ok(Array.isArray(events[0].issues));

    tracker.reset();
    const after = tracker.update(makePose({ view: 'front' }), frame());
    assert.equal(after.repCount, 0);
    assert.equal(after.ready, false);
  });
});

// ── Calibration / view validation ────────────────────────────────────────────
describe('calibration and readiness', () => {
  for (const view of ['front', 'side']) {
    test(`${view}: succeeds only after the pose is held, then enters ACTIVE`, () => {
      const flow = new LungeFlow({ view, voice: false });
      const d = new Driver(flow, view);
      d.hold(0.7);
      assert.equal(flow.phase, LUNGE_PHASE.SETUP, 'not enough hold time yet');
      d.hold(0.9);
      assert.equal(flow.phase, LUNGE_PHASE.READY);
      assert.ok(flow.calibration.standH > 150);
      d.hold(1.4);
      assert.equal(flow.phase, LUNGE_PHASE.ACTIVE);
    });
  }

  test('wrong camera view never calibrates and says how to fix it', () => {
    const asSide = new Driver(new LungeFlow({ view: 'side', voice: false }), 'front'); // front pose, side tracker
    asSide.hold(3);
    assert.equal(asSide.flow.phase, LUNGE_PHASE.SETUP);
    assert.equal(asSide.last.stanceResult.primaryKey, 'lunge_turn_side');
    assert.equal(asSide.last.status, LUNGE_FEEDBACK.lunge_turn_side);

    const asFront = new Driver(new LungeFlow({ view: 'front', voice: false }), 'side');
    asFront.hold(3);
    assert.equal(asFront.flow.phase, LUNGE_PHASE.SETUP);
    assert.equal(asFront.last.stanceResult.primaryKey, 'lunge_face_front');
  });

  test('knees/ankles not visible, or feet cut off, never calibrate', () => {
    const hidden = new Driver(new LungeFlow({ view: 'front', voice: false }), 'front');
    for (let i = 0; i < 90; i += 1) {
      hidden.tick(makePose({ view: 'front', vis: { [LM.LEFT_KNEE]: 0.1, [LM.RIGHT_KNEE]: 0.1 } }));
    }
    assert.equal(hidden.flow.phase, LUNGE_PHASE.SETUP);
    assert.equal(hidden.last.stanceResult.primaryKey, 'lunge_body_not_visible');

    const cut = new Driver(new LungeFlow({ view: 'front', voice: false }), 'front');
    for (let i = 0; i < 90; i += 1) {
      const lms = makePose({ view: 'front' });
      lms[LM.LEFT_ANKLE].y = 0.995;
      lms[LM.RIGHT_ANKLE].y = 0.995;
      cut.tick(lms);
    }
    assert.equal(cut.flow.phase, LUNGE_PHASE.SETUP);
    assert.equal(cut.last.stanceResult.primaryKey, 'lunge_feet_cut');
  });

  test('a moving person cannot complete calibration', () => {
    const d = new Driver(new LungeFlow({ view: 'front', voice: false }), 'front');
    for (let i = 0; i < 120; i += 1) d.tick(makePose({ view: 'front', depth: 0.07 * Math.sin((2 * Math.PI * i) / FPS) }));
    assert.equal(d.flow.phase, LUNGE_PHASE.SETUP);
  });

  test('no person: stays in setup, asks to stand in front of the camera', () => {
    const d = new Driver(new LungeFlow({ view: 'front', voice: false }), 'front');
    for (let i = 0; i < 60; i += 1) d.tick(null);
    assert.equal(d.flow.phase, LUNGE_PHASE.SETUP);
    assert.equal(d.last.status, LUNGE_FEEDBACK.lunge_no_person);
  });

  test('moving the camera while standing triggers recalibration but keeps the rep count', () => {
    const { flow, d } = setup('front');
    d.rep();
    assert.equal(flow.repTracker.count, 1);
    // Person suddenly much closer: standing hip-to-ankle height jumps +35 %.
    for (let i = 0; i < Math.round(2.2 * FPS); i += 1) {
      const lms = makePose({ view: 'front' });
      for (const l of lms) l.y = 0.5 + (l.y - 0.5) * 1.35;
      d.tick(lms);
    }
    assert.equal(flow.phase, LUNGE_PHASE.SETUP);
    assert.equal(flow.repTracker.count, 1);
  });
});

// ── Rep counting ─────────────────────────────────────────────────────────────
for (const view of ['front', 'side']) {
  describe(`${view} view rep counting`, () => {
    test('one complete lunge = exactly one rep, through every phase', () => {
      const { flow, d } = setup(view);
      const frames = d.rep();
      const seen = new Set(frames.map((f) => f.movement));
      for (const s of Object.values(LUNGE_STATE)) assert.ok(seen.has(s), `phase ${s} visited`);
      assert.equal(flow.repTracker.count, 1);
      assert.equal(d.frames.filter((f) => f.repCompleted).length, 1);
      assert.ok(lastRep(flow).romPct >= 85);
      assert.ok(lastRep(flow).descentSec > 0.6);
      assert.ok(spoken.includes('Rep 1'));
    });

    test('three lunges = three reps, no double counting', () => {
      const { flow, d } = setup(view);
      d.rep(); d.rep(); d.rep();
      assert.equal(flow.repTracker.count, 3);
      assert.deepEqual(d.frames.filter((f) => f.repCompleted).map((f) => f.repCompleted.index), [1, 2, 3]);
    });

    test('partial reps and tiny movements are not counted', () => {
      const { flow, d } = setup(view);
      d.rep({ peak: 0.16 }); // went down, not far enough
      assert.equal(flow.repTracker.count, 0);
      assert.equal(flow.repTracker.lastAttempt.incompleteReason, 'too_shallow');
      assert.equal(flow.repTracker.lastAttempt.counted, false);
      assert.equal(flow.repTracker.lastAttempt.score, null);
      const before = flow.repTracker.attempts.length;
      d.rep({ peak: 0.06 }); // below the entry threshold: not even an attempt
      assert.equal(flow.repTracker.count, 0);
      assert.equal(flow.repTracker.attempts.length, before);
    });

    test('landmark jitter while standing never produces a rep', () => {
      const { flow, d } = setup(view);
      for (let i = 0; i < 6 * FPS; i += 1) d.tick(makePose({ view, depth: 0.02 * noise(i) }));
      assert.equal(flow.repTracker.count, 0);
      assert.equal(flow.repTracker.attempts.length, 0);
    });

    test('a bounce on the way up stays one rep', () => {
      const { flow, d } = setup(view);
      const profile = (t) => {
        // down to .36, up to .24, back to .34, then all the way up
        const k = [[0, 0], [1.2, 0.36], [1.8, 0.24], [2.4, 0.34], [3.6, 0]];
        for (let i = 1; i < k.length; i += 1) {
          if (t <= k[i][0]) return k[i - 1][1] + ((k[i][1] - k[i - 1][1]) * (t - k[i - 1][0])) / (k[i][0] - k[i - 1][0]);
        }
        return 0;
      };
      for (let i = 0; i <= 3.6 * FPS; i += 1) d.tick(makePose({ view, depth: profile(i / FPS) }));
      d.hold(0.6);
      assert.equal(flow.repTracker.count, 1);
    });

    test('missing landmarks while standing: no reps, no crash, tracking resumes', () => {
      const { flow, d } = setup(view);
      for (let i = 0; i < 3 * FPS; i += 1) d.tick(null);
      assert.equal(flow.repTracker.count, 0);
      assert.equal(flow.phase, LUNGE_PHASE.ACTIVE);
      d.rep();
      assert.equal(flow.repTracker.count, 1);
    });

    test('brief landmark loss mid-rep still yields exactly one rep', () => {
      const { flow, d } = setup(view);
      const n = Math.round(2.8 * FPS);
      for (let i = 0; i <= n; i += 1) {
        const gap = i >= 36 && i < 43; // ~0.23 s, shorter than the occlusion hold
        d.tick(gap ? null : makePose({ view, depth: depthAt(i / FPS, 2.8, 0.36) }));
      }
      d.hold(0.6);
      assert.equal(flow.repTracker.count, 1);
    });

    test('long loss mid-rep drops the attempt (no count, no false rep afterwards)', () => {
      const { flow, d } = setup(view);
      const n = Math.round(2.8 * FPS);
      for (let i = 0; i <= n; i += 1) {
        const gap = i >= 30 && i < 80; // 1.7 s
        d.tick(gap ? null : makePose({ view, depth: depthAt(i / FPS, 2.8, 0.36) }));
      }
      d.hold(1);
      assert.equal(flow.repTracker.count, 0);
      assert.equal(flow.repTracker.lastAttempt?.incompleteReason, 'lost');
      d.rep();
      assert.equal(flow.repTracker.count, 1, 'a normal rep afterwards counts again');
    });
  });
}

describe('left / right leg tracking', () => {
  for (const view of ['front', 'side']) {
    test(`${view}: front leg is identified per rep and counted per leg`, () => {
      const { flow, d } = setup(view);
      d.rep({ lead: 'left' });
      d.rep({ lead: 'right' });
      d.rep({ lead: 'left' });
      const legs = flow.repTracker.attempts.map((a) => a.frontLeg);
      assert.deepEqual(legs, ['left', 'right', 'left']);
      assert.deepEqual(flow.repTracker.legCounts, { left: 2, right: 1 });
    });
  }

  test('side: a hidden far leg yields an unknown front leg, never a guessed one', () => {
    const { flow, d } = setup('side');
    d.rep({ lead: 'right', pose: () => ({ vis: { [LM.RIGHT_ANKLE]: 0.1 } }) });
    assert.equal(flow.repTracker.count, 1);
    assert.equal(lastRep(flow).frontLeg, null);
    assert.deepEqual(flow.repTracker.legCounts, { left: 0, right: 0 });
  });

  test('side: the camera-facing side is locked and never switches when it disappears', () => {
    const { flow, d } = setup('side');
    assert.equal(flow.calibration.profile, 'left');
    const hideLeft = Object.fromEntries([
      LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE,
    ].map((i) => [i, 0.1]));
    d.rep({ pose: () => ({ vis: { ...hideLeft, [LM.RIGHT_ANKLE]: 0.99, [LM.RIGHT_KNEE]: 0.99, [LM.RIGHT_HIP]: 0.99 } }) });
    assert.equal(flow.repTracker.count, 0);
    assert.equal(flow.calibration.profile, 'left');
  });
});

// ── Form detection, repeated-mistake rule, feedback ──────────────────────────
describe('correct form', () => {
  for (const view of ['front', 'side']) {
    test(`${view}: clean reps raise no issues, warnings, red indicators or corrections`, () => {
      const { flow, d } = setup(view);
      for (let i = 0; i < 4; i += 1) d.rep({ lead: i % 2 ? 'right' : 'left' });
      assert.equal(flow.repTracker.count, 4);
      for (const a of flow.repTracker.attempts) {
        assert.deepEqual(a.issues, [], `rep ${a.index}`);
        assert.equal(a.warning ?? null, null);
        assert.ok(a.score >= 90, `score ${a.score}`);
        assert.equal(a.clean, true);
      }
      assert.equal(d.frames.some((f) => f.boneColor === LUNGE_COLOR_RED), false);
      assert.equal(d.frames.some((f) => f.mistake), false);
      assert.deepEqual(corrections(), []);
    });
  }

  test('natural standing asymmetry is calibrated out, not flagged', () => {
    const flow = new LungeFlow({ view: 'front', voice: false });
    const d = new Driver(flow, 'front');
    // A person whose knees sit a little inward and hips a little uneven when standing.
    const quirks = { valgus: { left: 0.12, right: 0.1 }, pelvisTilt: 0.06, trunkSway: 0.08 };
    for (let i = 0; i < 3.2 * FPS; i += 1) d.tick(makePose({ view: 'front', ...quirks }));
    assert.equal(flow.phase, LUNGE_PHASE.ACTIVE);
    d.rep({ pose: () => quirks });
    d.rep({ pose: () => quirks });
    for (const a of flow.repTracker.attempts) assert.deepEqual(a.issues, []);
  });
});

describe('repeated-mistake rule (two consecutive completed reps)', () => {
  const kneeLeft = (d) => (d > 0.05 ? { valgus: { left: 0.38 } } : {});
  const hip = (d) => (d > 0.05 ? { hipShift: 0.45 } : {});
  const warnings = (flow) => flow.repTracker.attempts.map((a) => a.warning ?? null);

  test('first occurrence is recorded and shown red, but not warned; second triggers the warning', () => {
    const { flow, d } = setup('front');
    const rep1 = d.rep({ pose: kneeLeft });
    assert.deepEqual(lastRep(flow).issues, ['lunge_knee_collapse_left']);
    assert.equal(lastRep(flow).warning, null);
    assert.ok(rep1.some((f) => f.boneColor === LUNGE_COLOR_RED), 'red indicator is live even before the warning');
    assert.ok(rep1.some((f) => f.redJoints.includes(LM.LEFT_KNEE)));
    assert.equal(rep1.some((f) => f.mistake), false, 'no corrective text on the first occurrence');
    assert.deepEqual(corrections(), []);

    const rep2 = d.rep({ pose: kneeLeft });
    assert.equal(lastRep(flow).warning, 'lunge_knee_collapse_left');
    assert.ok(rep2.some((f) => f.mistake === LUNGE_FEEDBACK.lunge_knee_collapse_left));
    assert.deepEqual(corrections(), [LUNGE_FEEDBACK.lunge_knee_collapse_left], 'spoken exactly once');
  });

  test('a clean rep in between resets that mistake\'s counter', () => {
    const { flow, d } = setup('front');
    d.rep({ pose: kneeLeft }); // 1: mistake
    d.rep({ pose: kneeLeft }); // 2: warn
    d.rep(); // 3: clean → reset
    d.rep({ pose: kneeLeft }); // 4: first again → no warning
    assert.deepEqual(warnings(flow), [null, 'lunge_knee_collapse_left', null, null]);
    d.rep({ pose: kneeLeft }); // 5: second consecutive → warn
    assert.equal(warnings(flow)[4], 'lunge_knee_collapse_left');
  });

  test('different mistake types keep independent counters', () => {
    const { flow, d } = setup('front');
    d.rep({ pose: kneeLeft }); // 1: knee
    d.rep({ pose: hip }); // 2: hip (knee gone → knee counter resets; hip is a first occurrence)
    assert.deepEqual(warnings(flow), [null, null]);
    assert.ok(flow.repTracker.attempts[1].issues.includes('lunge_hip_shift'));
    d.rep({ pose: hip }); // 3: hip twice in a row → warn hip only
    assert.equal(warnings(flow)[2], 'lunge_hip_shift');
    assert.equal(corrections().length, 1);
    assert.equal(corrections()[0], LUNGE_FEEDBACK.lunge_hip_shift);
  });

  test('left and right knee collapse are separate mistake types', () => {
    const { flow, d } = setup('front');
    d.rep({ pose: kneeLeft });
    d.rep({ pose: (x) => (x > 0.05 ? { valgus: { right: 0.38 } } : {}) });
    assert.deepEqual(warnings(flow), [null, null]);
  });

  test('one correction at a time: the highest-priority repeated mistake wins', () => {
    const { flow, d } = setup('front');
    const both = (x) => (x > 0.05 ? { valgus: { left: 0.38 }, hipShift: 0.45 } : {});
    d.rep({ pose: both });
    d.rep({ pose: both });
    assert.equal(lastRep(flow).warning, 'lunge_knee_collapse_left');
    assert.equal(corrections().length, 1);
  });

  test('shallow depth: counted, flagged, warned only when repeated', () => {
    const { flow, d } = setup('front');
    d.rep({ peak: 0.26 });
    assert.equal(flow.repTracker.count, 1);
    assert.deepEqual(lastRep(flow).issues, ['lunge_shallow']);
    assert.equal(lastRep(flow).warning, null);
    assert.ok(lastRep(flow).romPct < 70);
    d.rep({ peak: 0.26 });
    assert.equal(lastRep(flow).warning, 'lunge_shallow');
    assert.ok(corrections().includes('Increase your lunge depth.'));
  });

  test('fast uncontrolled descent is flagged as tempo', () => {
    const { flow, d } = setup('front');
    d.rep({ dur: 1.5 });
    assert.equal(flow.repTracker.count, 1);
    assert.ok(lastRep(flow).issues.includes('lunge_too_fast'));
    d.rep({ dur: 1.5 });
    assert.equal(lastRep(flow).warning, 'lunge_too_fast');
    assert.ok(corrections().includes('Lower into the lunge with control.'));
  });

  test('front: pelvis tilt, trunk sway and hip shift are detected independently', () => {
    const { flow, d } = setup('front');
    d.rep({ pose: (x) => (x > 0.05 ? { pelvisTilt: 0.4 } : {}) });
    assert.deepEqual(lastRep(flow).issues, ['lunge_pelvis_tilt']);
    d.rep({ pose: (x) => (x > 0.05 ? { trunkSway: 0.5 } : {}) });
    assert.deepEqual(lastRep(flow).issues, ['lunge_trunk_sway']);
  });

  test('side: excessive forward lean is flagged, normal lean is not', () => {
    const { flow, d } = setup('side');
    d.rep({ pose: (x) => (x > 0.05 ? { leanPx: 45 } : {}) }); // ~21°, normal
    assert.deepEqual(lastRep(flow).issues, []);
    d.rep({ pose: (x) => (x > 0.05 ? { leanPx: 115 } : {}) }); // ~44°
    assert.deepEqual(lastRep(flow).issues, ['lunge_torso_lean']);
    assert.equal(lastRep(flow).warning, null);
    d.rep({ pose: (x) => (x > 0.05 ? { leanPx: 115 } : {}) });
    assert.equal(lastRep(flow).warning, 'lunge_torso_lean');
    assert.ok(lastRep(flow).metrics.torsoLeanDeg >= 35);
  });

  test('a single noisy frame never flags a mistake', () => {
    const { flow, d } = setup('front');
    d.rep({ pose: (x, tn) => (Math.abs(tn - 0.5) < 0.004 ? { valgus: { left: 0.6 } } : {}) });
    assert.equal(flow.repTracker.count, 1);
    assert.deepEqual(lastRep(flow).issues, []);
    assert.equal(d.frames.some((f) => f.boneColor === LUNGE_COLOR_RED), false);
  });

  test('voice: same correction is not repeated within its cooldown', () => {
    const { d } = setup('front');
    for (let i = 0; i < 4; i += 1) d.rep({ pose: kneeLeft });
    assert.equal(corrections().filter((t) => t === LUNGE_FEEDBACK.lunge_knee_collapse_left).length, 1);
  });
});

// ── Metrics and scoring ──────────────────────────────────────────────────────
describe('metrics, ROM and score', () => {
  test('front: per-rep metrics are recorded and a flawed rep scores lower than a clean one', () => {
    const { flow, d } = setup('front');
    d.rep();
    const clean = lastRep(flow);
    d.rep({ pose: (x) => (x > 0.05 ? { valgus: { right: 0.45 }, hipShift: 0.3 } : {}) });
    const flawed = lastRep(flow);
    assert.ok(flawed.score < clean.score - 15, `${flawed.score} vs ${clean.score}`);
    assert.ok(flawed.metrics.kneeValgusRight >= 0.3);
    assert.ok(flawed.components.knee < 60);
    // ROM stays a separate measure: equal depth → equal ROM even though form differs.
    assert.ok(Math.abs(flawed.romPct - clean.romPct) <= 3);
    assert.ok('symmetryPct' in flawed && 'components' in flawed);
  });

  test('side: knee flexion, depth and torso metrics; ROM tracks depth, not form', () => {
    const { flow, d } = setup('side');
    d.rep({ peak: 0.36 });
    const deep = lastRep(flow);
    d.rep({ peak: 0.25 });
    const shallow = lastRep(flow);
    assert.ok(deep.metrics.frontKneeDeg <= 110, `front knee ${deep.metrics.frontKneeDeg}`);
    assert.ok(deep.metrics.rearKneeDeg != null);
    assert.ok(deep.romPct > shallow.romPct + 15);
    assert.ok(deep.score > shallow.score);
  });

  test('left/right consistency: very different depths on opposite legs are flagged', () => {
    const { flow, d } = setup('front');
    d.rep({ lead: 'left', peak: 0.38 });
    d.rep({ lead: 'right', peak: 0.25 });
    assert.ok(lastRep(flow).issues.includes('lunge_asymmetry'));
    assert.ok(lastRep(flow).symmetryPct < 70);
    assert.equal(flow.repTracker.attempts[0].symmetryPct, null, 'nothing to compare the first rep with');
  });

  test('unmeasurable metrics are excluded from the score instead of counted as perfect', () => {
    const { flow, d } = setup('side');
    d.rep({ pose: () => ({ vis: { [LM.RIGHT_ANKLE]: 0.1 } }) }); // front leg unknown
    assert.equal(lastRep(flow).components.kneeFlex, null);
    assert.equal(lastRep(flow).metrics.frontKneeDeg, null);
  });
});

// ── Reset ────────────────────────────────────────────────────────────────────
describe('reset', () => {
  test('clears reps, calibration, gate history, smoothing and scores', () => {
    const { flow, d } = setup('front');
    const kneeLeft = (x) => (x > 0.05 ? { valgus: { left: 0.38 } } : {});
    d.rep({ pose: kneeLeft });
    assert.equal(flow.repTracker.count, 1);
    flow.reset();
    assert.equal(flow.phase, LUNGE_PHASE.SETUP);
    assert.equal(flow.calibration, null);
    assert.equal(flow.repTracker.count, 0);
    assert.equal(flow.repTracker.attempts.length, 0);
    assert.equal(flow.scoredReps, 0);
    assert.equal(flow.formScore, 100);

    // The mistake from before the reset must not count toward "two in a row".
    const d2 = new Driver(flow, 'front');
    assert.equal(d2.calibrate(), LUNGE_PHASE.ACTIVE);
    spoken.length = 0;
    d2.rep({ pose: kneeLeft });
    assert.equal(lastRep(flow).warning ?? null, null);
    assert.deepEqual(corrections(), []);
  });

  test('the config is restorable', () => {
    LUNGE_CFG.depth_count = 0.5;
    resetLungeCfg();
    assert.equal(LUNGE_CFG.depth_count, 0.22);
  });
});
