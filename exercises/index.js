// Exercise catalog. Register every exercise here — this is the only file that
// grows as you add the 2nd, 10th, or 100th exercise.

import { registerExercise } from '../core/registry';
import squat from './squat/index.js';

registerExercise(squat);

// Future: import pushup from './pushup/index.js'; registerExercise(pushup); ...

export { squat };
