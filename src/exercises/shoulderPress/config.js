// Standing dumbbell shoulder press (front view) — thresholds, tolerances,
// coaching text and voice lines.
//
// All distance tolerances are ratios of the live shoulder width measured in
// PIXEL space (so they are independent of camera resolution / aspect ratio).
// Horizontal "outward" offsets are measured away from the body midline, so
// left/right checks are anatomical and do not depend on camera mirroring.

import { LM } from '../../core/landmarks';

export const SP_REQUIRED_UPPER = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
];
export const SP_REQUIRED_FEET = [LM.LEFT_ANKLE, LM.RIGHT_ANKLE];

export const SP_CFG_DEFAULTS = {
  min_visibility: 0.5,

  // ── Stance (feet) ────────────────────────────────────────────────────────
  // Setup only checks ankle width vs shoulder width — NOT body centering.
  // ankle width / shoulder width must sit within [1 - narrow, 1 + wide].
  stance_narrow_tolerance: 0.35,
  stance_wide_tolerance: 0.45,
  // Kept for overlays / soft diagnostics; not used as a hard setup gate.
  feet_level_ratio_max: 0.12,

  // ── Shoulders / torso bend (setup only; light bend is allowed) ───────────
  // |shoulder-mid x - hip-mid x| / sw — side bend of the upper body.
  torso_lean_ratio_max: 0.18,
  // |left shoulder y - right shoulder y| / sw.
  shoulder_level_ratio_max: 0.12,
  // Ear→shoulder vertical gap must stay above this fraction of the standing
  // baseline captured during the stance check (0 disables the shrug check).
  shrug_ratio_min: 0.55,

  // ── Arm path ─────────────────────────────────────────────────────────────
  // Wrist must stay stacked over the elbow: signed outward wrist-vs-elbow / sw.
  forearm_inner_tolerance: 0.15,
  forearm_outer_tolerance: 0.15,
  // Bottom position: elbow must sit at least this far outside the shoulder
  // (outward / sw). Smaller → elbows tucked in front of the chest.
  elbow_tuck_min_ratio: 0.25,
  // Top position: wrist may not be further outside the shoulder than this.
  top_wide_ratio_max: 0.55,
  // |left wrist y - right wrist y| / sw while moving → one arm lagging.
  symmetry_ratio_max: 0.25,

  // ── Depth (how low the dumbbells come) ───────────────────────────────────
  // Elbows should come down to the shoulder line. They may stop at most
  // `depth_elbow_high_ratio` above it (else: not low enough) and must not
  // drop more than `depth_elbow_low_ratio` below it (else: too deep).
  depth_elbow_high_ratio: 0.15,
  depth_elbow_low_ratio: 0.35,

  // ── Height (how high the dumbbells go) ───────────────────────────────────
  // Wrists should rise at least this fraction of the arm length above the
  // shoulder line, with the elbow extended past `lockout_angle_min`.
  top_height_ratio: 0.85,
  lockout_angle_min: 160,

  // ── Rep state machine (elbow angle, degrees) ─────────────────────────────
  bottom_angle_max: 110,
  bottom_angle_relaxed_max: 125, // accepted when elbows already reached the shoulder line
  top_angle_min: 150,
  partial_up_angle: 130, // left bottom this far but came back → "press higher"
  partial_down_angle: 125, // left top this far but went back up → "lower more"

  // ── Tempo ────────────────────────────────────────────────────────────────
  rep_min_sec: 1.2,

  // ── Noise filtering ──────────────────────────────────────────────────────
  cue_sustain_sec: 0.35, // live cue must persist this long before it is real
  rep_error_min_sec: 0.25, // cue must persist this long inside a rep to cost points

  // ── Drawing ──────────────────────────────────────────────────────────────
  near_limit_fraction: 0.85,
  line_half_len_ratio: 0.03,
};

/** Live mutable config — tolerance sliders write here directly. */
export const SP_CFG = { ...SP_CFG_DEFAULTS };

export function resetShoulderPressCfg() {
  Object.assign(SP_CFG, SP_CFG_DEFAULTS);
}

// Points deducted from a rep's 100-point form score, per error group.
export const SP_SCORE_WEIGHTS = {
  depth: 20,
  height: 20,
  forearm: 15,
  elbow: 10,
  symmetry: 10,
  torso: 10,
  shoulder: 5,
  stance: 5,
  tempo: 5,
};

// Cue key → score group. Order of SP_LIVE_PRIORITY decides which single cue
// is voiced when several are active at once.
export const SP_CUE_GROUP = {
  sp_too_deep: 'depth',
  sp_not_low_enough: 'depth',
  sp_press_higher: 'height',
  sp_torso_lean_left: 'torso',
  sp_torso_lean_right: 'torso',
  sp_uneven_left_low: 'symmetry',
  sp_uneven_right_low: 'symmetry',
  sp_forearm_left_inner: 'forearm',
  sp_forearm_left_outer: 'forearm',
  sp_forearm_right_inner: 'forearm',
  sp_forearm_right_outer: 'forearm',
  sp_elbow_left_tucked: 'elbow',
  sp_elbow_right_tucked: 'elbow',
  sp_top_wide_left: 'forearm',
  sp_top_wide_right: 'forearm',
  sp_shrug: 'shoulder',
  sp_shoulder_high_left: 'shoulder',
  sp_shoulder_high_right: 'shoulder',
  sp_stance_narrow: 'stance',
  sp_stance_wide: 'stance',
  sp_rep_fast: 'tempo',
};

// Live cues during reps only — setup stance/shoulder locks are never re-voiced.
export const SP_LIVE_PRIORITY = [
  'sp_too_deep',
  'sp_uneven_left_low', 'sp_uneven_right_low',
  'sp_forearm_left_inner', 'sp_forearm_left_outer',
  'sp_forearm_right_inner', 'sp_forearm_right_outer',
  'sp_elbow_left_tucked', 'sp_elbow_right_tucked',
  'sp_top_wide_left', 'sp_top_wide_right',
  'sp_shrug',
];

// Short on-screen text per cue.
export const SP_FEEDBACK = {
  sp_too_deep: 'Too low — stop at shoulder height',
  sp_not_low_enough: 'Lower to shoulder height',
  sp_press_higher: 'Press all the way up',
  sp_torso_lean_left: 'Leaning left — stand straight',
  sp_torso_lean_right: 'Leaning right — stand straight',
  sp_uneven_left_low: 'Left arm lagging — press evenly',
  sp_uneven_right_low: 'Right arm lagging — press evenly',
  sp_forearm_left_inner: 'Left wrist drifting in — stack over elbow',
  sp_forearm_left_outer: 'Left wrist drifting out — stack over elbow',
  sp_forearm_right_inner: 'Right wrist drifting in — stack over elbow',
  sp_forearm_right_outer: 'Right wrist drifting out — stack over elbow',
  sp_elbow_left_tucked: 'Open your left elbow out',
  sp_elbow_right_tucked: 'Open your right elbow out',
  sp_top_wide_left: 'Left dumbbell too wide at the top',
  sp_top_wide_right: 'Right dumbbell too wide at the top',
  sp_shrug: 'Shoulders down — don\'t shrug',
  sp_shoulder_high_left: 'Left shoulder high — level shoulders',
  sp_shoulder_high_right: 'Right shoulder high — level shoulders',
  sp_stance_narrow: 'Feet too close — widen stance',
  sp_stance_wide: 'Feet too wide — bring them in',
  sp_rep_fast: 'Too fast — control the weight',
};

export const SP_VOICE_MSG = {
  no_person: 'Please stand in front of the camera.',
  feet_not_visible: 'Step back so your full body, including your feet, is visible.',
  hands_out_of_frame: 'Step back a little so your hands stay in view at the top.',
  feet_begin: 'First I will check your feet. Place them about shoulder width apart.',
  feet_ok: 'Your feet look good under your shoulders.',
  shoulder_begin: 'Now I will check your shoulders. Stand tall without a big side bend.',
  shoulder_ok: 'Your shoulders look good.',
  get_in_position: 'Bring the dumbbells up to shoulder height, palms facing forward.',
  ready: 'Get ready to press.',
  do_rep_one: 'Do rep one.',
  halfway: 'You are halfway. Keep going.',
  done: 'Congratulations. You finished every rep.',

  sp_stance_narrow: 'Move your feet a little farther apart, under your shoulders.',
  sp_stance_wide: 'Bring your feet slightly closer together, under your shoulders.',
  sp_torso_lean_left: 'You are bending too far to your left. Stand straighter.',
  sp_torso_lean_right: 'You are bending too far to your right. Stand straighter.',
  sp_shoulder_high_left: 'Your left shoulder is dropping too much. Level your shoulders.',
  sp_shoulder_high_right: 'Your right shoulder is dropping too much. Level your shoulders.',

  sp_too_deep: 'Too low. Don\'t go down so far, stop when your elbows reach shoulder height.',
  sp_not_low_enough: 'Lower the dumbbells until your elbows reach shoulder height.',
  sp_press_higher: 'Press all the way up and extend your arms.',
  sp_uneven_left_low: 'Your left arm is lagging. Press both dumbbells evenly.',
  sp_uneven_right_low: 'Your right arm is lagging. Press both dumbbells evenly.',
  sp_forearm_left_inner: 'Keep your left wrist straight above your elbow. It is drifting inward.',
  sp_forearm_left_outer: 'Keep your left wrist straight above your elbow. It is drifting outward.',
  sp_forearm_right_inner: 'Keep your right wrist straight above your elbow. It is drifting inward.',
  sp_forearm_right_outer: 'Keep your right wrist straight above your elbow. It is drifting outward.',
  sp_elbow_left_tucked: 'Open your left elbow out to the side.',
  sp_elbow_right_tucked: 'Open your right elbow out to the side.',
  sp_top_wide_left: 'Bring your left dumbbell in, over your shoulder.',
  sp_top_wide_right: 'Bring your right dumbbell in, over your shoulder.',
  sp_shrug: 'Keep your shoulders down, away from your ears.',
  sp_rep_fast: 'Too fast. Control the weight up and down.',
};

export const SP_COLOR_GREEN = 'rgb(0,255,0)';
export const SP_COLOR_AMBER = 'rgb(255,190,0)';
export const SP_COLOR_RED = 'rgb(255,0,0)';
export const SP_COLOR_CYAN = 'rgb(0,200,255)';
