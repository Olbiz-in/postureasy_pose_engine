// Dumbbell lateral raise (front view) — thresholds, score weights, coaching
// text and voice lines.
//
// NO joint angles are used anywhere for this exercise. Every rule compares the
// vertical (y) position of a landmark against a horizontal shoulder line, or
// uses a simple distance ratio. Image y grows downward, so "above" = smaller y.
//
// All distances are divided by the shoulder width captured during the stance
// calibration (live shoulder width before calibration), so the thresholds do
// not depend on camera distance or resolution. Offsets from the shoulder line
// are signed: positive = BELOW the line, negative = ABOVE it.

import { LM } from '../../core/landmarks';

export const LR_REQUIRED_CORE = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
];
export const LR_ARM_LANDMARKS = {
  left: { shoulder: LM.LEFT_SHOULDER, elbow: LM.LEFT_ELBOW, wrist: LM.LEFT_WRIST },
  right: { shoulder: LM.RIGHT_SHOULDER, elbow: LM.RIGHT_ELBOW, wrist: LM.RIGHT_WRIST },
};
export const LR_TRACKED_LANDMARKS = [
  LM.NOSE,
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export const LR_CFG_DEFAULTS = {
  // ── Landmark quality / smoothing ─────────────────────────────────────────
  min_visibility: 0.5,
  smoothing: 'one_euro', // 'one_euro' | 'moving_average' | 'none'
  one_euro_min_cutoff: 1.2, // Hz — lower = smoother when still
  one_euro_beta: 0.01, // higher = less lag on fast moves (pixel space)
  one_euro_d_cutoff: 1.0,
  moving_average_frames: 5,
  // A landmark hidden by a dumbbell keeps its last smoothed value this long.
  occlusion_hold_sec: 0.35,
  // An arm hidden longer than this mid-rep aborts that arm's cycle (→ incomplete).
  arm_missing_abort_sec: 1.0,
  person_lost_sec: 0.6,

  // ── Stance check (SETUP_STANCE) ──────────────────────────────────────────
  stance_hold_sec: 1.0, // every check must pass continuously this long
  stance_min: 0.8, // ankle distance / shoulder width
  stance_max: 1.4,
  upright_lean_max: 0.25, // |shoulder-center x − hip-center x| / sw
  hip_above_ankle_min: 1.5, // (ankle y − hip y) / sw; smaller = crouching
  torso_height_min: 0.9, // (hip y − shoulder y) / sw; smaller = bent over
  arms_down_hip_margin: 0.25, // wrist may sit this far (/ sw) above the hip line
  arms_down_below_shoulder_min: 0.9, // …or at least this far below the shoulder line
  facing_min_ratio: 0.85, // live sw / max sw seen during setup
  facing_sw_torso_min: 0.45, // sw / shoulder-to-hip distance (absolute sideways guard)

  // ── Shoulder line / rep detection ────────────────────────────────────────
  line_mode: 'average', // 'average' (one line, both shoulders) | 'per_side'
  // TOP ("touched the line"): elbow at most this far BELOW the shoulder line.
  top_tolerance: 0.10,
  // Lift fraction: 0 = calibrated resting elbow height, 1 = elbow on the line.
  // Elbow height follows 1 − cos(arm raise), so 0.25 ≈ 40°, 0.35 ≈ 50°.
  lift_start: 0.25, // arm has left the start zone (rep begins)
  lift_return: 0.15, // arm is back in the start zone (hysteresis vs lift_start)
  attempt_min_lift: 0.35, // arm cycles lower than this are ignored as noise
  pair_window_sec: 0.7, // both arms must finish their cycles this close together
  max_cycle_sec: 10, // an arm stuck mid-rep this long without reaching the top is reset
  // Defaults used until the calibration provides personal resting heights.
  rest_elbow_default: 0.95,
  rest_wrist_default: 1.7,

  // ── Form rules ───────────────────────────────────────────────────────────
  wrist_above_tolerance: 0.05, // wrist above the line by more than this → flag
  elbow_above_tolerance: 0.12, // elbow above the line by more than this → flag
  flag_min_sec: 0.12, // a fault must persist this long inside a rep to count
  shoulder_tilt_max: 0.10, // |Δ shoulder y| / sw vs calibrated baseline
  body_sway_max: 0.15, // shoulder-center x drift / sw during a rep
  symmetry_max: 0.15, // |left − right peak elbow height| / sw

  // Where each component score reaches 0 (linear ramp from its tolerance).
  wrist_above_zero_at: 0.30,
  elbow_above_zero_at: 0.40,
  shoulder_tilt_zero_at: 0.30,
  body_sway_zero_at: 0.45,
  symmetry_zero_at: 0.40,
  clean_score_min: 75,

  // ── Activity detection ───────────────────────────────────────────────────
  idle_seconds: 2.0, // arms resting this long → NOT DOING EXERCISE
  turn_ratio: 0.6, // live sw / calibrated sw below this → turned away
  long_idle_seconds: 30, // pause the session timer + show a hint

  // ── Flow timing ──────────────────────────────────────────────────────────
  ready_min_sec: 1.5, // settle after the stance passes before "Do rep 1"
  ready_max_sec: 6.0,
  rest_default_sec: 30, // rest before auto-resume (Start Next Set skips it)
  rest_resume_hold_sec: 1.5, // stance held this long to auto-resume after rest

  // ── Debug ────────────────────────────────────────────────────────────────
  debug: false, // console per-frame values + on-canvas readout
  debug_log_every_n: 1, // log every Nth frame
};

/** Live mutable config — tolerance sliders write here directly. */
export const LR_CFG = { ...LR_CFG_DEFAULTS };

export function resetLateralRaiseCfg() {
  Object.assign(LR_CFG, LR_CFG_DEFAULTS);
}

/** Toggle the per-frame debug log + on-canvas readout. */
export function setLateralRaiseDebug(on) {
  LR_CFG.debug = !!on;
  return LR_CFG.debug;
}

// Weights of the per-rep form score (normalized, so they need not sum to 100).
export const LR_SCORE_WEIGHTS_DEFAULTS = {
  rom: 30,
  wrist: 25,
  symmetry: 20,
  stability: 25,
};
export const LR_SCORE_WEIGHTS = { ...LR_SCORE_WEIGHTS_DEFAULTS };

export function resetLateralRaiseWeights() {
  Object.assign(LR_SCORE_WEIGHTS, LR_SCORE_WEIGHTS_DEFAULTS);
}

// Rep-level issue priority — decides which single message is shown / voiced.
export const LR_ISSUE_PRIORITY = [
  'lr_incomplete',
  'lr_wrist_above',
  'lr_not_high_enough',
  'lr_elbow_too_high',
  'lr_asymmetry',
  'lr_shoulder_tilt',
  'lr_body_sway',
];

// Stance-check cue priority — one corrective message at a time.
export const LR_STANCE_PRIORITY = [
  'lr_no_person',
  'lr_feet_not_visible',
  'lr_facing',
  'lr_not_upright',
  'lr_feet_narrow',
  'lr_feet_wide',
  'lr_arms_not_down',
];

export const LR_FEEDBACK = {
  lr_no_person: 'Stand in front of the camera',
  lr_feet_not_visible: 'Step back — feet not visible',
  lr_facing: 'Face the camera directly',
  lr_not_upright: 'Stand up straight',
  lr_feet_narrow: 'Move your feet apart to shoulder width',
  lr_feet_wide: 'Feet too wide — bring them in to shoulder width',
  lr_arms_not_down: 'Lower your arms to your sides',
  lr_stance_ok: 'Your stance is correct. Start the exercise.',

  lr_incomplete: 'Incomplete rep — raise both arms together',
  lr_wrist_above: 'Lower your hands, wrists should stay below shoulder level',
  lr_not_high_enough: 'Raise your elbows up to the shoulder line',
  lr_elbow_too_high: 'Elbows too high — stop at shoulder level',
  lr_asymmetry: 'Raise both arms to the same height',
  lr_shoulder_tilt: 'Keep your shoulders level — don\'t shrug',
  lr_body_sway: 'Keep your body still — don\'t swing',

  lr_turned_away: 'Turned away',
  lr_arms_resting: 'Arms resting',
  lr_out_of_frame: 'Out of frame',
  lr_long_idle: 'Paused — start your next rep or press Stop',
};

export const LR_VOICE_MSG = {
  setup_begin: 'Stand facing the camera with your feet shoulder width apart and your arms down at your sides.',
  lr_no_person: 'Please stand in front of the camera.',
  lr_feet_not_visible: 'Step back so your full body, including your feet, is visible.',
  lr_facing: 'Please turn and face the camera.',
  lr_not_upright: 'Stand up straight.',
  lr_feet_narrow: 'Move your feet apart to shoulder width.',
  lr_feet_wide: 'Your feet are too wide. Bring them in to shoulder width.',
  lr_arms_not_down: 'Lower your arms down to your sides.',
  lr_stance_ok: 'Your stance is correct. Start the exercise.',

  // Form mistakes (lr_wrist_above, lr_incomplete, …) are overlay-only — no voice lines.
  lr_turned_away: 'Please face the camera.',
  lr_long_idle: 'Are you still there? Start your next rep, or press Stop to finish.',
};

export const LR_COLOR_GREEN = 'rgb(0,255,0)';
export const LR_COLOR_AMBER = 'rgb(255,190,0)';
export const LR_COLOR_RED = 'rgb(255,0,0)';
export const LR_COLOR_GREY = 'rgb(170,170,170)';
