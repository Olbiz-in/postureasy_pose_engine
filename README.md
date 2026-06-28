# @postureasy/pose-engine

Browser-side, real-time pose-tracking engine for PosturEasy. Wraps **MediaPipe
Tasks Vision** (`PoseLandmarker`) and exposes a **scalable exercise registry** so
that adding the 2nd — or 100th — exercise is a self-contained module, not a
change to the engine or the app.

## Why this is a standalone package

- **Clean boundary** — the app depends only on the public API in `src/index.js`.
- **Extractable** — it is already its own workspace package; promoting it to its
  own Git repo / npm publish is a folder move, no rewrite.
- **Zero extra network bandwidth** — inference runs 100% locally in the browser.
  The only network use is a one-time, cached download of the WASM runtime + model.
  Nothing is streamed per frame.

## Runtime architecture

```
webcam ─► PoseLandmarker (WASM/GPU, local) ─► normalized landmarks (33 pts)
                                                   │
                                  ┌────────────────┴───────────────┐
                                  ▼                                ▼
                         exercise tracker.update()          drawSkeleton()
                         → { reps, formScore, cues }         (canvas overlay)
```

## Public API

```js
import {
  LiveExercise,        // drop-in React component (video + overlay + HUD)
  useLiveExercise,     // headless hook (bring your own UI)
  isSupported,         // (name) => boolean
  resolveExerciseId,   // (planName) => engineId | null
  listExercises,
} from '@postureasy/pose-engine';
```

```jsx
<LiveExercise
  exerciseName="Bodyweight Squat"   // resolved via aliases
  active={isRunning}
  voice
  onRepCountChange={(reps) => setReps(reps)}
  onStateChange={(s) => setFormScore(s.formScore)}
/>
```

## Adding an exercise (the scale unit)

1. Create `src/exercises/<id>/index.js` exporting an `ExerciseDefinition`:

```js
export default {
  id: 'pushup',
  name: 'Push-up',
  facing: 'side',
  aliases: ['push up', 'push-ups', 'pushups'],
  create() {
    return {
      reset() { /* clear per-session state */ },
      update(landmarks, frame) {
        // return the standard ExerciseState:
        return { repCount, phase, progress, formScore, ready, cues, feedback };
      },
      draw(ctx, landmarks, frame, state) { /* optional custom overlay */ },
    };
  },
};
```

2. Register it in `src/exercises/index.js`:

```js
import pushup from './pushup/index.js';
registerExercise(pushup);
```

That's it — `<LiveExercise exerciseName="Push-up" />` now works. For families of
similar movements (squat-like, push-like, hold-like), build a shared template in
`src/exercises/_templates/` and have each exercise supply only its config.

## Contracts

See `src/core/registry.js` for the full `ExerciseDefinition`, `Tracker`, and
`ExerciseState` contracts.
