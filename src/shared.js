// App-safe entry: summaries and spoken lines. No camera, no MediaPipe.
export { summarizeReps, summarizeHolds, repSummaryConfig } from './repSummary.js';
export {
  setIntroLine,
  primeSetIntro,
  holdDurationWords,
  setCompleteLine,
  holdSetCompleteLine,
  formAccuracyLine,
  nextSetHintLine,
  setIncompleteLine,
  setNotCountedLine,
  sessionStoppedLine,
} from './core/sessionVoice.js';
export {
  EXERCISES,
  exerciseDef,
  resolveExerciseId,
  availableViews,
  isSupported,
  isTimedExercise,
  exerciseFamily,
  managesOwnSets,
  isFlowComplete,
  isFlowRest,
  repsOnlyVoice,
} from './catalog.js';
