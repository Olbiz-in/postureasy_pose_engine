import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeLateralRaise,
  buildSessionMistakeReport,
} from '../src/exercises/lateralRaise/LateralRaiseRepTracker.js';
import {
  classifyIssues,
  issueSeverity,
  repAccuracyPct,
  LR_ACCURACY_CHECKS,
  LR_ACCURACY,
  accuracyPenaltyPctForKey,
} from '../src/exercises/lateralRaise/config.js';

/**
 * Sample session from exported JSON (10 reps):
 * - Reps 3, 7, 10 → major mistakes
 * - Rep 6 → perfect (no mistakes)
 * - Rest → minor-only (lr_wrist_too_high)
 */
const SAMPLE_ATTEMPTS = [
  { attempt: 1, index: 1, set: 1, counted: true, clean: false, score: 99, romPct: 100, issues: ['lr_wrist_too_high'] },
  { attempt: 2, index: 2, set: 1, counted: true, clean: false, score: 92, romPct: 100, issues: ['lr_wrist_too_high'] },
  {
    attempt: 3, index: 3, set: 1, counted: true, clean: false, score: 59, romPct: 89,
    issues: ['lr_incomplete', 'lr_not_high_enough', 'lr_elbow_too_high', 'lr_wrist_too_high', 'lr_arms_out_of_sync', 'lr_asymmetry'],
  },
  { attempt: 4, index: 4, set: 1, counted: true, clean: false, score: 98, romPct: 100, issues: ['lr_wrist_too_high'] },
  { attempt: 5, index: 5, set: 1, counted: true, clean: false, score: 94, romPct: 100, issues: ['lr_wrist_too_high'] },
  { attempt: 6, index: 6, set: 1, counted: true, clean: true, score: 97, romPct: 100, issues: [] },
  {
    attempt: 7, index: 7, set: 1, counted: true, clean: false, score: 42, romPct: 73,
    issues: ['lr_incomplete', 'lr_not_high_enough', 'lr_elbow_too_high', 'lr_wrist_too_high', 'lr_arms_out_of_sync', 'lr_asymmetry', 'lr_shoulder_tilt'],
  },
  { attempt: 8, index: 8, set: 1, counted: true, clean: false, score: 99, romPct: 100, issues: ['lr_wrist_too_high'] },
  { attempt: 9, index: 9, set: 1, counted: true, clean: false, score: 92, romPct: 100, issues: ['lr_wrist_too_high'] },
  {
    attempt: 10, index: 10, set: 1, counted: true, clean: false, score: 59, romPct: 90,
    issues: ['lr_incomplete', 'lr_not_high_enough', 'lr_elbow_too_high', 'lr_wrist_too_high', 'lr_arms_out_of_sync', 'lr_asymmetry'],
  },
];

describe('lateral raise severity + accuracy', () => {
  test('severity map: wrist too high / shoulder tilt are minor; unknown defaults major', () => {
    assert.equal(issueSeverity('lr_wrist_too_high'), 'minor');
    assert.equal(issueSeverity('lr_shoulder_tilt'), 'minor');
    assert.equal(issueSeverity('lr_incomplete'), 'major');
    assert.equal(issueSeverity('lr_wrist_not_high_enough'), 'major');
    assert.equal(issueSeverity('lr_unknown_future_key'), 'major');
  });

  test('accuracy config: 8 slots; skip incomplete; major 25% / minor 12.5%', () => {
    assert.equal(LR_ACCURACY.TOTAL_CHECKS, 8);
    assert.equal(LR_ACCURACY.PENALTY_MULTIPLIER, 2);
    assert.equal(LR_ACCURACY.MINOR_PENALTY_MULTIPLIER, 1);
    assert.equal(LR_ACCURACY_CHECKS.includes('lr_incomplete'), false);
    assert.equal(LR_ACCURACY_CHECKS.length, 7);
    assert.equal(accuracyPenaltyPctForKey('lr_asymmetry'), 25);
    assert.equal(accuracyPenaltyPctForKey('lr_wrist_too_high'), 12.5);
  });

  test('repAccuracyPct: strict penalty; incomplete ignored; floor at 0', () => {
    assert.equal(repAccuracyPct([]), 100);
    // one minor → 100 − 12.5 = 87.5
    assert.equal(repAccuracyPct(['lr_wrist_too_high']), 87.5);
    // incomplete alone does not reduce accuracy
    assert.equal(repAccuracyPct(['lr_incomplete']), 100);
    // major + incomplete → only the major (25%)
    assert.equal(repAccuracyPct(['lr_incomplete', 'lr_asymmetry']), 75);
    // many majors clamp to 0
    assert.equal(repAccuracyPct([
      'lr_incomplete', 'lr_not_high_enough', 'lr_elbow_too_high',
      'lr_wrist_too_high', 'lr_arms_out_of_sync', 'lr_asymmetry',
    ]), 0);
  });

  test('classifyIssues: minor-only is accurate; major is not; includes accuracyPct', () => {
    assert.deepEqual(classifyIssues([]), {
      hasMajor: false, hasMinor: false, perfect: true, accurate: true, accuracyPct: 100,
    });
    const minor = classifyIssues(['lr_wrist_too_high']);
    assert.equal(minor.hasMajor, false);
    assert.equal(minor.hasMinor, true);
    assert.equal(minor.perfect, false);
    assert.equal(minor.accurate, true);
    assert.equal(minor.accuracyPct, 87.5);

    const mixed = classifyIssues(['lr_incomplete', 'lr_wrist_too_high']);
    assert.equal(mixed.hasMajor, true);
    assert.equal(mixed.hasMinor, true);
    assert.equal(mixed.perfect, false);
    assert.equal(mixed.accurate, false);
    // incomplete skipped for continuous pct → same as minor-only
    assert.equal(mixed.accuracyPct, 87.5);
  });

  test('sample session → continuous accuracy 63%, accurateReps 7, form/rom unchanged', () => {
    const s = summarizeLateralRaise(SAMPLE_ATTEMPTS, {
      setsCompleted: 1, targetSets: 3, targetReps: 10,
    });

    assert.equal(s.repsCompleted, 10);
    assert.equal(s.accurateReps, 7);
    // 6×87.5 + 100 + 0+0+0 = 625 → 62.5 → 63
    assert.equal(s.accuracy, 63);
    assert.equal(s.perfectReps, 1);
    assert.equal(s.cleanReps, 1);
    assert.equal(s.minorOnlyReps, 6);
    assert.equal(s.majorReps, 3);
    assert.equal(s.formScore, 83);
    assert.equal(s.romPct, 95);

    const r3 = s.perRep.find((r) => r.rep === 3);
    const r6 = s.perRep.find((r) => r.rep === 6);
    const r1 = s.perRep.find((r) => r.rep === 1);
    assert.equal(r3.accurate, false);
    assert.equal(r3.hasMajor, true);
    assert.equal(r3.accuracyPct, 0);
    assert.equal(r6.clean, true);
    assert.equal(r6.accurate, true);
    assert.equal(r6.accuracyPct, 100);
    assert.equal(r1.accurate, true);
    assert.equal(r1.hasMinor, true);
    assert.equal(r1.hasMajor, false);
    assert.equal(r1.accuracyPct, 88); // round(87.5)
  });

  test('empty session → accuracy 0 (no division by zero)', () => {
    const s = summarizeLateralRaise([]);
    assert.equal(s.accuracy, 0);
    assert.equal(s.accurateReps, 0);
    assert.equal(s.perfectReps, 0);
  });

  test('export glossary includes severity; rep rows keep accurate flags + accuracyPct', () => {
    const s = summarizeLateralRaise(SAMPLE_ATTEMPTS);
    const report = buildSessionMistakeReport(SAMPLE_ATTEMPTS, {
      formScore: s.formScore, accuracy: s.accuracy,
    });
    assert.equal(report.mistakes.lr_wrist_too_high.severity, 'minor');
    assert.equal(report.mistakes.lr_incomplete.severity, 'major');
    assert.ok(report.mistakes.lr_wrist_too_high.meaning);
    assert.equal(report.accuracy, 63);
    assert.equal(report.perfectReps, 1);
    assert.equal(report.accurateReps, 7);
    assert.equal(report.reps[0].accurate, true);
    assert.equal(report.reps[0].accuracyPct, 88);
    assert.equal(report.reps[2].accurate, false);
    assert.equal(report.reps[2].accuracyPct, 0);
    assert.equal(report.reps[5].clean, true);
  });
});
