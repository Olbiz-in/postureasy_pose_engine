// Plain exercise catalog. No camera, no MediaPipe.
// The live trackers register these same records. Mobile reads this file
// directly so it does not keep a second copy of names, views, or set rules.

export const EXERCISES = [
  {
    id: 'squat', name: 'Squat', family: 'squat', facing: 'front',
    aliases: ['squat', 'squats', 'bodyweight squat', 'bodyweight squats', 'air squat', 'air squats', 'goblet squat', 'walking lunges'],
  },
  {
    id: 'squat-side', name: 'Squat (side view)', family: 'squat', facing: 'side',
    aliases: ['squat side', 'side squat', 'side-squat'],
  },
  {
    id: 'pushup', name: 'Push-up', family: 'pushup', facing: 'front',
    aliases: ['push up', 'push-up', 'push ups', 'push-ups', 'pushup', 'pushups', 'standard push-up', 'standard pushup',
      'wide push-up', 'wide push-ups', 'knee push-up', 'knee push-ups'],
  },
  {
    id: 'pushup-side', name: 'Push-up (side view)', family: 'pushup', facing: 'side',
    aliases: ['pushup side', 'push-up side', 'side push-up', 'side pushup'],
  },
  {
    id: 'shoulderpress', name: 'Dumbbell Shoulder Press', family: 'shoulderpress', facing: 'front',
    aliases: ['shoulder press', 'shoulder presses', 'dumbbell shoulder press', 'dumbbell shoulder presses',
      'standing dumbbell shoulder press', 'standing shoulder press', 'dumbbell overhead press', 'overhead press',
      'overhead dumbbell press', 'db shoulder press', 'seated dumbbell shoulder press'],
  },
  {
    id: 'lateralraise', name: 'Dumbbell Lateral Raise', family: 'lateralraise', facing: 'front',
    managesSets: true, completePhase: 'lr_complete', restPhase: 'lr_rest_between_sets', repsOnlyVoice: true,
    aliases: ['lateral raise', 'lateral raises', 'dumbbell lateral raise', 'dumbbell lateral raises', 'standing lateral raise',
      'standing dumbbell lateral raise', 'side lateral raise', 'side raise', 'side raises', 'db lateral raise'],
  },
  {
    id: 'frontraise', name: 'Dumbbell Front Raise', family: 'frontraise', facing: 'front',
    managesSets: true, completePhase: 'fr_complete', restPhase: 'fr_rest_between_sets', repsOnlyVoice: true,
    aliases: ['front raise', 'front raises', 'dumbbell front raise', 'dumbbell front raises', 'standing front raise',
      'standing dumbbell front raise', 'front delt raise', 'db front raise'],
  },
  {
    id: 'dumbbellcurl', name: 'Dumbbell Curl', family: 'dumbbellcurl', facing: 'front',
    managesSets: true, completePhase: 'dc_complete', restPhase: 'dc_rest_between_sets',
    aliases: ['dumbbell curl', 'dumbbell curls', 'dumbbell bicep curl', 'dumbbell bicep curls', 'dumbbell biceps curl',
      'dumbbell biceps curls', 'bicep curl', 'bicep curls', 'biceps curl', 'biceps curls', 'standing dumbbell curl',
      'standing dumbbell curls', 'db curl', 'db curls', 'hammer curl', 'hammer curls', 'dumbbell hammer curl', 'dumbbell hammer curls'],
  },
  {
    id: 'singleArmDumbbellRow', name: 'Single-Arm Dumbbell Row', family: 'singlearmdumbbellrow', facing: 'side',
    managesSets: true, completePhase: 'sr_complete', restPhase: 'sr_rest_between_sets',
    aliases: ['single-arm dumbbell row', 'single-arm dumbbell rows', 'single arm dumbbell row', 'single arm dumbbell rows',
      'one-arm dumbbell row', 'one-arm dumbbell rows', 'one arm dumbbell row', 'one arm dumbbell rows', 'dumbbell row',
      'dumbbell rows', 'single-arm row', 'single arm row', 'one-arm row', 'one arm row', 'single-arm db row', 'one-arm db row', 'db row'],
  },
  {
    id: 'plank-side', name: 'Plank (side view)', family: 'plank', facing: 'side', timed: true,
    aliases: ['plank', 'planks', 'plank hold', 'forearm plank', 'elbow plank', 'front plank', 'high plank',
      'straight arm plank', 'side view plank'],
  },
  {
    id: 'lunge', name: 'Lunge', family: 'lunge', facing: 'front',
    aliases: ['lunge', 'lunges', 'bodyweight lunge', 'bodyweight lunges', 'forward lunge', 'forward lunges',
      'reverse lunge', 'reverse lunges', 'dumbbell lunge', 'dumbbell lunges', 'static lunge', 'static lunges'],
  },
  {
    id: 'lunge-side', name: 'Lunge (side view)', family: 'lunge', facing: 'side',
    aliases: ['lunge side', 'lunge-side'],
  },
  {
    id: 'leg-raise-side', name: 'Leg Raise (side view)', family: 'legraise', facing: 'side',
    aliases: ['leg raise', 'leg raises', 'lying leg raise', 'lying leg raises', 'lying straight leg raise', 'straight leg raise',
      'straight leg raises', 'floor leg raise', 'flat leg raise', 'leg raise side', 'leg-raise-side', 'leg-raise'],
  },
];

const norm = (s) => String(s || '').trim().toLowerCase();

const byId = new Map(EXERCISES.map((def) => [def.id, def]));
const aliasIndex = new Map();
for (const def of EXERCISES) {
  aliasIndex.set(norm(def.id), def.id);
  aliasIndex.set(norm(def.name), def.id);
  for (const alias of def.aliases) aliasIndex.set(norm(alias), def.id);
}

function record(nameOrId) {
  const id = resolveExerciseId(nameOrId);
  return id ? byId.get(id) || null : null;
}

export function exerciseDef(id) {
  const rec = byId.get(id);
  if (!rec) throw new Error(`Unknown exercise "${id}"`);
  return { ...rec, aliases: [...rec.aliases], timed: !!rec.timed, managesSets: !!rec.managesSets };
}

export function resolveExerciseId(nameOrId, view) {
  const key = norm(nameOrId);
  let baseId = byId.has(nameOrId) ? nameOrId : aliasIndex.get(key) || null;

  if (!baseId) {
    if (/\bplanks?\b/.test(key)) {
      if (!/side|jack|walk|tap|twist|rotat|reach|knee|up\b|to\b|copenhagen|reverse|saw|dip/.test(key)) {
        baseId = aliasIndex.get('plank') || null;
      }
    } else if (/(shoulder|overhead)\s*press/.test(key)) baseId = aliasIndex.get('shoulder press') || null;
    else if (/lateral\s*raise/.test(key)) baseId = aliasIndex.get('lateral raise') || null;
    else if (/front\s*raise/.test(key) && !/alternat|seated|plate|barbell|cable/.test(key)) baseId = aliasIndex.get('front raise') || null;
    else if (/\b(single|one|1)[\s-]*arm\b.*\brows?\b/.test(key) && !/cable|barbell|machine|landmine|band|seated|upright|t-bar|inverted/.test(key)) {
      baseId = aliasIndex.get('single arm dumbbell row') || null;
    } else if (/\blunges?\b/.test(key) && !/walking|jump|lateral|side|curtsy|cossack|bulgarian|overhead|barbell|smith|machine/.test(key)) {
      baseId = aliasIndex.get('lunge') || null;
    } else if (/\bleg\s*raises?\b/.test(key) && !/hanging|captain|standing|side|lateral|seated|donkey|single|one[\s-]*leg|incline|decline|bench|cable|machine|weighted|dumbbell|band/.test(key)) {
      baseId = aliasIndex.get('leg raise') || null;
    } else if (key.includes('squat')) baseId = aliasIndex.get('squat') || 'squat';
    else if (key.includes('push')) baseId = aliasIndex.get('pushup') || 'pushup';
    else if (/(dumbbell|bicep|biceps|hammer)\s*curl/.test(key) && !/concentration|preacher|cable|barbell|spider|incline/.test(key)) {
      baseId = aliasIndex.get('dumbbell curl') || null;
    }
  }

  if (!baseId || !byId.has(baseId) || !view) return baseId;
  const family = byId.get(baseId)?.family || baseId;
  const match = EXERCISES.find((def) => def.family === family && def.facing === view);
  return match ? match.id : baseId;
}

export function availableViews(nameOrId) {
  const baseId = resolveExerciseId(nameOrId);
  if (!baseId) return [];
  const family = byId.get(baseId)?.family || baseId;
  const views = new Set();
  for (const def of EXERCISES) {
    if (def.family === family && def.facing) views.add(def.facing);
  }
  return [...views];
}

export function isSupported(nameOrId) {
  return resolveExerciseId(nameOrId) != null;
}

export function isTimedExercise(nameOrId) {
  return !!record(nameOrId)?.timed;
}

export function exerciseFamily(nameOrId) {
  return record(nameOrId)?.family || null;
}

/** Tracker runs every set, including rest, inside one camera session. */
export function managesOwnSets(nameOrId) {
  return !!record(nameOrId)?.managesSets;
}

export function isFlowComplete(nameOrId, phase) {
  const expected = record(nameOrId)?.completePhase;
  return !!expected && expected === phase;
}

export function isFlowRest(nameOrId, phase) {
  const expected = record(nameOrId)?.restPhase;
  return !!expected && expected === phase;
}

/** Lateral / front raise speak rep counts only. */
export function repsOnlyVoice(nameOrId) {
  return !!record(nameOrId)?.repsOnlyVoice;
}
