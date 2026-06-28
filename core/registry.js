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

/** Resolve any plan/display name (e.g. "Bodyweight Squat") to a registered id. */
export function resolveExerciseId(nameOrId) {
  const key = norm(nameOrId);
  if (_exercises.has(nameOrId)) return nameOrId;
  return _aliasIndex.get(key) || null;
}

export function isSupported(nameOrId) {
  return resolveExerciseId(nameOrId) != null;
}

export function listExercises() {
  return [..._exercises.values()].map(({ id, name, facing }) => ({ id, name, facing }));
}
