// Exercise registry — the single unit of scale.
//
// Adding a new exercise (even the 100th) means: write a module that exports an
// `ExerciseDefinition`, then `registerExercise(def)`. Nothing else in the engine
// or the app needs to change.
//
// ── ExerciseDefinition contract ──────────────────────────────────────────────
//   id            string            unique slug, e.g. "squat"
//   name          string            human label, e.g. "Squat"
//   aliases       string[]          plan/display names that map to this exercise
//   facing        "front"|"side"|"any"   recommended camera orientation
//   create()      () => Tracker     factory returning a fresh per-session tracker
//
// ── Tracker contract (returned by create()) ──────────────────────────────────
//   update(landmarks, frame) => ExerciseState
//        landmarks : MediaPipe normalized landmark array (or null if no person)
//        frame     : { width, height, timestamp }  canvas pixel size + ms clock
//   reset()                  reset all per-session state
//   draw?(ctx, landmarks, frame, state)   optional custom canvas overlay
//
// ── ExerciseState (standard shape every tracker returns) ─────────────────────
//   repCount      number            completed reps
//   phase         string            "idle" | "down" | "up" | exercise-specific
//   progress      number 0..1       movement completion (drives the depth bar)
//   formScore     number 0..100     rolling form quality
//   cues          {level,text}[]    live coaching cues (level: ok|info|warn|bad)
//   feedback      string|null       end-of-rep feedback to announce, once
//   ready         boolean           true once calibrated / person detected
//
// Timed (hold) exercises set `timed: true` on the definition, accept
// `targetSeconds` in create(), keep repCount at 0 and additionally report
// holdSec / targetSec / holdComplete. Their tracker exposes finish() → summary.

import {
  resolveExerciseId as resolveCatalogId,
  availableViews as catalogViews,
  isTimedExercise as catalogTimed,
  managesOwnSets as catalogManagesSets,
  isFlowComplete as catalogFlowComplete,
  isFlowRest as catalogFlowRest,
  repsOnlyVoice as catalogRepsOnly,
  exerciseFamily as catalogFamily,
} from '../catalog.js';

const _exercises = new Map();
const _aliasIndex = new Map();

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

export function registerExercise(def) {
  if (!def || !def.id) throw new Error('registerExercise: definition.id is required');
  if (typeof def.create !== 'function') throw new Error(`Exercise "${def.id}" must provide create()`);

  _exercises.set(def.id, def);
  _aliasIndex.set(norm(def.id), def.id);
  _aliasIndex.set(norm(def.name), def.id);
  for (const alias of def.aliases || []) _aliasIndex.set(norm(alias), def.id);
  return def;
}

export function getExercise(id) {
  return _exercises.get(id) || null;
}

/**
 * Resolve any plan/display name (e.g. "Bodyweight Squat") to a registered id.
 * The name list and the family fallbacks live in catalog.js. This only returns
 * an id the live engine has actually registered.
 */
export function resolveExerciseId(nameOrId, view) {
  const id = resolveCatalogId(nameOrId, view);
  return id && _exercises.has(id) ? id : null;
}

/** All registered facings ('front'/'side'/…) available for an exercise family. */
export function availableViews(nameOrId) {
  return resolveExerciseId(nameOrId) ? catalogViews(nameOrId) : [];
}

export function isSupported(nameOrId) {
  return resolveExerciseId(nameOrId) != null;
}

export function listExercises() {
  return [..._exercises.values()].map(({ id, name, facing, timed }) => ({ id, name, facing, timed: !!timed }));
}

/** True when the exercise is a timed hold (seconds) rather than a rep count. */
export function isTimedExercise(nameOrId) {
  return resolveExerciseId(nameOrId) ? catalogTimed(nameOrId) : false;
}

export function exerciseFamily(nameOrId) {
  return resolveExerciseId(nameOrId) ? catalogFamily(nameOrId) : null;
}

/** Tracker runs every set, including rest, inside one camera session. */
export function managesOwnSets(nameOrId) {
  return resolveExerciseId(nameOrId) ? catalogManagesSets(nameOrId) : false;
}

export function isFlowComplete(nameOrId, phase) {
  return resolveExerciseId(nameOrId) ? catalogFlowComplete(nameOrId, phase) : false;
}

export function isFlowRest(nameOrId, phase) {
  return resolveExerciseId(nameOrId) ? catalogFlowRest(nameOrId, phase) : false;
}

/** Lateral / front raise speak rep counts only. */
export function repsOnlyVoice(nameOrId) {
  return resolveExerciseId(nameOrId) ? catalogRepsOnly(nameOrId) : false;
}
