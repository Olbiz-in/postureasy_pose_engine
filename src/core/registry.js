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

/**
 * Resolve any plan/display name (e.g. "Bodyweight Squat") to a registered id.
 *
 * When `view` ('front' | 'side') is supplied, the result is the registered
 * exercise in the SAME family whose `facing` matches the requested view, if one
 * exists; otherwise the base resolution is returned. This lets the app flip a
 * single front/side toggle and have the engine pick the right tracker variant.
 */
export function resolveExerciseId(nameOrId, view) {
  const key = norm(nameOrId);
  let baseId = _exercises.has(nameOrId) ? nameOrId : _aliasIndex.get(key) || null;

  // Family fallback: any plan exercise whose name reads as a push-up or squat
  // variant (e.g. "Decline Push-ups", "Goblet Squat") maps to that family so the
  // matching tracker is used. Unrelated movements stay unsupported.
  if (!baseId) {
    if (key.includes('squat')) baseId = _aliasIndex.get('squat') || 'squat';
    else if (key.includes('push')) baseId = _aliasIndex.get('pushup') || 'pushup';
  }

  if (!baseId || !_exercises.has(baseId) || !view) return baseId;

  const base = _exercises.get(baseId);
  const family = base?.family || baseId;
  for (const def of _exercises.values()) {
    if ((def.family || def.id) === family && def.facing === view) return def.id;
  }
  return baseId;
}

/** All registered facings ('front'/'side'/…) available for an exercise family. */
export function availableViews(nameOrId) {
  const baseId = resolveExerciseId(nameOrId);
  if (!baseId) return [];
  const base = _exercises.get(baseId);
  const family = base?.family || baseId;
  const views = new Set();
  for (const def of _exercises.values()) {
    if ((def.family || def.id) === family && def.facing) views.add(def.facing);
  }
  return [...views];
}

export function isSupported(nameOrId) {
  return resolveExerciseId(nameOrId) != null;
}

export function listExercises() {
  return [..._exercises.values()].map(({ id, name, facing }) => ({ id, name, facing }));
}
