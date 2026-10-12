// Exercise catalog. Register every exercise here — this is the only file that
// grows as you add the 2nd, 10th, or 100th exercise.

import { registerExercise } from '../core/registry';
import squat from './squat/index.js';
import squatSide from './squatSide/index.js';
import pushup from './pushup/index.js';
import pushupSide from './pushupSide/index.js';
import shoulderPress from './shoulderPress/index.js';
import lateralRaise from './lateralRaise/index.js';
import frontRaise from './frontRaise/index.js';
import dumbbellCurl from './dumbbellCurl/index.js';
import singleArmDumbbellRow from './singleArmDumbbellRow/index.js';
import plankSide from './plankSide/index.js';
import { lungeFront as lunge, lungeSide } from './lunge/index.js';

registerExercise(squat);
registerExercise(squatSide);
registerExercise(pushup);
registerExercise(pushupSide);
registerExercise(shoulderPress);
registerExercise(lateralRaise);
registerExercise(frontRaise);
registerExercise(dumbbellCurl);
registerExercise(singleArmDumbbellRow);
registerExercise(plankSide);
registerExercise(lunge);
registerExercise(lungeSide);

export {
  squat, squatSide, pushup, pushupSide, shoulderPress, lateralRaise, frontRaise, dumbbellCurl,
  singleArmDumbbellRow, plankSide, lunge, lungeSide,
};
