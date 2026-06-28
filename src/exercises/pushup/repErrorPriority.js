// Single-error-per-rep selection by fixed priority. Selection only — does not
// affect rep counting or posture detection. Ported from fitness_posture.

export const PUSHUP_POSTURE_PRIORITY_GROUPS = [
  {
    group: 'wrist',
    label: 'Wrist misalignment',
    keys: ['wrist_left_inner', 'wrist_left_outer', 'wrist_right_inner', 'wrist_right_outer'],
  },
  {
    group: 'elbow',
    label: 'Elbow misalignment',
    keys: ['elbow_left_inner', 'elbow_left_outer', 'elbow_right_inner', 'elbow_right_outer'],
  },
  {
    group: 'hand',
    label: 'Hand rotation',
    keys: ['hand_left_inner', 'hand_left_outer', 'hand_right_inner', 'hand_right_outer'],
  },
  {
    group: 'forearm',
    label: 'Forearm misalignment',
    keys: ['forearm_left', 'forearm_right'],
  },
];

export const PUSHUP_TOO_DEEP_KEYS = ['pushup_too_deep', 'pushup_shoulder_deep'];

export function isPushUpTooDeepKey(key) {
  return PUSHUP_TOO_DEEP_KEYS.includes(key);
}

export function partitionPushUpCueKeys(cueKeys) {
  const posture = [];
  const tooDeep = [];
  for (const key of cueKeys || []) {
    if (isPushUpTooDeepKey(key)) tooDeep.push(key);
    else posture.push(key);
  }
  return { posture, tooDeep };
}

export function selectHighestPriorityPostureError(cueKeys) {
  const set = new Set(cueKeys);
  for (const { keys } of PUSHUP_POSTURE_PRIORITY_GROUPS) {
    for (const key of keys) {
      if (set.has(key)) return key;
    }
  }
  return null;
}

export function selectTooDeepCaptureKey(tooDeepKeys) {
  const set = new Set(tooDeepKeys);
  if (set.has('pushup_too_deep')) return 'pushup_too_deep';
  if (set.has('pushup_shoulder_deep')) return 'pushup_shoulder_deep';
  return 'pushup_too_deep';
}

export function postureGroupLabelForKey(key) {
  for (const { label, keys } of PUSHUP_POSTURE_PRIORITY_GROUPS) {
    if (keys.includes(key)) return label;
  }
  if (isPushUpTooDeepKey(key)) return 'Too deep';
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function createEmptyRepAccumulator() {
  return { cues: new Set(), tooDeep: false, tooDeepKeys: new Set() };
}

export function accumulateRepPostureErrors(accumulator, postureResult) {
  if (!accumulator || !postureResult) return accumulator;
  const { posture, tooDeep } = partitionPushUpCueKeys(postureResult.cueKeys);
  for (const key of posture) accumulator.cues.add(key);
  for (const key of tooDeep) accumulator.tooDeepKeys.add(key);
  if (!postureResult.depthOk || tooDeep.length > 0) accumulator.tooDeep = true;
  return accumulator;
}
